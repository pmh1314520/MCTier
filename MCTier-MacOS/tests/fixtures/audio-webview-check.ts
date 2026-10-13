import { invoke } from '@tauri-apps/api/core';
import { nativeMicrophoneLevel, openMicrophone } from '../../src/services/voice/nativeMicrophone';
import { microphoneLevelPercent } from '../../src/services/voice/microphoneLevel';
import { WebRTCClient } from '../../src/services/webrtc/WebRTCClient';

// Real WebView2 + production native bridge; the Rust fixture supplies a quiet sine
// over binary IPC. No physical microphone, network service, or saved user profile.
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const limit = <T>(promise: Promise<T>, label: string, ms = 5000): Promise<T> => Promise.race([
  promise, wait(ms).then(() => { throw new Error(`${label} timed out`); }),
]);
const report: Record<string, unknown> = {};
const contexts: AudioContext[] = [];
const streams: MediaStream[] = [];
const peers: RTCPeerConnection[] = [];
let audio = new Audio();
function meter(stream: MediaStream, context: AudioContext) {
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(1024);
  return () => {
    analyser.getFloatTimeDomainData(data);
    return Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
  };
}
async function main() {
  const context = new AudioContext({ sampleRate: 48000 }); contexts.push(context);
  report.initialContext = context.state;
  await limit(context.resume(), 'meter context resume');
  report.runningContext = context.state;
  const stream = await limit(openMicrophone(), 'production microphone bridge'); streams.push(stream);
  const level = meter(stream, context);
  let peak = 0;
  for (let i = 0; i < 25; i++) { await wait(40); peak = Math.max(peak, level()); }
  report.bridgeRms = peak;
  report.nativeTestMeter = microphoneLevelPercent(nativeMicrophoneLevel(stream) ?? 0);
  if ((report.nativeTestMeter as number) < 20) throw new Error('Native microphone test meter did not respond to PCM');
  if (peak < 0.01) throw new Error('Production bridge has no PCM energy');

  const discovery = await invoke<string | null>('audio_check_ice_server');
  report.discovery = discovery;
  const rtcConfig = { iceServers: discovery ? [{ urls: discovery }] : [] };
  const left = new RTCPeerConnection(rtcConfig);
  const right = new RTCPeerConnection(rtcConfig); peers.push(left, right);
  const iceLeft: RTCIceCandidateInit[] = [], iceRight: RTCIceCandidateInit[] = [];
  const candidates: string[] = []; report.candidates = candidates;
  const usable = (candidate: RTCIceCandidate) => !discovery || candidate.type === 'srflx';
  left.onicecandidate = e => { if (e.candidate) { candidates.push(e.candidate.candidate); if (!usable(e.candidate)) return; if (right.remoteDescription) void right.addIceCandidate(e.candidate); else iceRight.push(e.candidate.toJSON()); } };
  right.onicecandidate = e => { if (e.candidate && usable(e.candidate)) { if (left.remoteDescription) void left.addIceCandidate(e.candidate); else iceLeft.push(e.candidate.toJSON()); } };
  const receiveLeft = new Promise<MediaStream>(resolve => { left.ontrack = e => resolve(new MediaStream([e.track])); });
  const receiveRight = new Promise<MediaStream>(resolve => { right.ontrack = e => resolve(new MediaStream([e.track])); });
  left.addTrack(stream.getAudioTracks()[0], stream);
  const oscillator = context.createOscillator(); oscillator.frequency.value = 660;
  const gain = context.createGain(); gain.gain.value = 0.05;
  const output = context.createMediaStreamDestination(); streams.push(output.stream);
  oscillator.connect(gain).connect(output); oscillator.start();
  right.addTrack(output.stream.getAudioTracks()[0], output.stream);
  await left.setLocalDescription(await left.createOffer());
  await right.setRemoteDescription(left.localDescription!);
  await Promise.all(iceRight.map(candidate => right.addIceCandidate(candidate)));
  await right.setLocalDescription(await right.createAnswer());
  await left.setRemoteDescription(right.localDescription!);
  await Promise.all(iceLeft.map(candidate => left.addIceCandidate(candidate)));
  const [incomingLeft, incomingRight] = await limit(Promise.all([receiveLeft, receiveRight]), 'bidirectional ontrack');
  const leftLevel = meter(incomingLeft, context), rightLevel = meter(incomingRight, context);
  let leftPeak = 0, rightPeak = 0;
  // Exercise actual call attachment, persisted output routing and playback policy.
  const savedOutput = localStorage.getItem('mctier_audio_output_device');
  report.savedOutput = savedOutput;
  report.savedOutputName = localStorage.getItem('mctier_audio_output_device_name');
  report.savedInput = localStorage.getItem('mctier_audio_input_device');
  const client = new WebRTCClient() as any;
  const peer = { id: 'test-peer', connection: left, iceCandidateQueue: [], createdAt: Date.now() };
  client.peerConnections.set('test-peer', peer);
  client.attachRemoteAudio('test-peer', left, incomingLeft.getAudioTracks()[0]);
  audio = client.peerConnections.get('test-peer').audioElement;
  for (let i = 0; i < 60 && audio.paused; i++) await wait(50);
  report.actualSinkId = audio.sinkId;
  report.playbackError = client.peerConnections.get('test-peer').lastPlaybackError;
  report.muted = audio.muted; report.volume = audio.volume;
  report.playing = !audio.paused;
  for (let i = 0; i < 60; i++) { await wait(50); leftPeak = Math.max(leftPeak, leftLevel()); rightPeak = Math.max(rightPeak, rightLevel()); }
  report.receivedDesktopRms = leftPeak; report.receivedPeerRms = rightPeak;
  report.outputSessions = await invoke('audio_check_outputs');
  report.browserOutputs = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audiooutput').map(device => ({ id: device.deviceId, label: device.label }));
  const stats = await left.getStats();
  report.rtp = [...stats.values()].filter(row => ['inbound-rtp', 'outbound-rtp'].includes(row.type)).map(row => ({ type: row.type, kind: row.kind, packetsSent: row.packetsSent, packetsReceived: row.packetsReceived }));
  const pair = [...stats.values()].find(row => row.type === 'candidate-pair' && row.nominated && row.state === 'succeeded');
  report.selectedLocal = pair ? stats.get(pair.localCandidateId) : null;
  report.selectedRemote = pair ? stats.get(pair.remoteCandidateId) : null;
  if (discovery && !candidates.some(candidate => candidate.includes(' typ srflx ') && candidate.includes(discovery.split(':')[1]))) throw new Error('Missing native-interface ICE candidate');
  if (leftPeak < 0.005 || rightPeak < 0.005 || audio.paused || audio.muted || audio.volume === 0) throw new Error('Bidirectional audio or playback is silent');
  report.ok = true;
}
void main().catch(error => { report.error = String(error); report.ok = false; }).finally(async () => {
  audio.pause(); audio.srcObject = null;
  peers.forEach(peer => peer.close());
  streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  report.nativeMeterAfterStop = streams.map(stream => nativeMicrophoneLevel(stream) ?? null);
  await Promise.all(contexts.map(context => context.close()));
  await invoke('audio_check_report', { report });
});
