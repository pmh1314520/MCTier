import { invoke } from '@tauri-apps/api/core';
import { WebRTCClient } from '../../src/services/webrtc/WebRTCClient';
import { markSignalingSocketRegistered } from '../../src/services/signaling/registeredSocket';
import { sendingAudioTransceiver } from '../../src/services/webrtc/audioTransceiver';
import { openMicrophone } from '../../src/services/voice/nativeMicrophone';

// Production call negotiation and playback over an in-process signaling transport.
// No connections to users or physical microphone capture.
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const left = new WebRTCClient() as any, right = new WebRTCClient() as any;
const clients = [left, right];
const report: any = { signals: [], candidates: [] };
const streams: MediaStream[] = [];
const context = new AudioContext();
const ids = ['b'.repeat(64), 'a'.repeat(64)];
async function main() {
  await context.resume();
  const discovery = await invoke<string | null>('audio_check_ice_server');
  report.discovery = discovery;
  const oneSided = (globalThis as any).audioCheckOneSidedIce;
  report.oneSidedDiscovery = oneSided;
  clients.forEach((client, i) => {
    client.iceServers = discovery && (!oneSided || i === 0) ? [{ urls: discovery }] : [];
    client.localPlayerId = ids[i];
    client.serverSessionGeneration = '7';
    client.knownPlayers.add(ids[1 - i]);
    client.peerSessionGenerations.set(ids[1 - i], '7');
    let incoming = Promise.resolve();
    const socket = { readyState: WebSocket.OPEN, send(text: string) {
      const message = JSON.parse(text);
      // The signaling server stamps its authoritative numeric generation.
      message.sessionGeneration = 7;
      report.signals.push(message.type);
      if (message.type === 'ice-candidate') {
        report.candidates.push(message.candidate.candidate);
        if (oneSided && i === 1) return; // The unmodified peer has no usable advertised route.
        if (discovery && !message.candidate.candidate.includes(' typ srflx ')) return;
      }
      incoming = incoming.then(() => clients[1-i].handleWebSocketMessage(message));
    } } as WebSocket;
    client.websocket = socket;
    markSignalingSocketRegistered(socket);
  });
  await left.createPeerConnection(ids[1]);
  await left.makePeerOffer(ids[1], left.peerConnections.get(ids[1]));
  // Users join with microphones off, then enable them after negotiation.
  for (let i = 0; i < 100 && right.peerConnections.get(ids[0])?.connection.connectionState !== 'connected'; i++) await wait(50);
  report.beforeMic = clients.map((client, i) => ({ state: client.peerConnections.get(ids[1-i])?.connection.connectionState,
    transceivers: client.peerConnections.get(ids[1-i])?.connection.getTransceivers().map((t: RTCRtpTransceiver) => ({ mid: t.mid, direction: t.currentDirection })) }));
  const captured = await openMicrophone(); streams.push(captured);
  const osc = context.createOscillator(); osc.frequency.value = 660;
  const gain = context.createGain(); gain.gain.value = 0.05;
  const dest = context.createMediaStreamDestination(); streams.push(dest.stream);
  osc.connect(gain).connect(dest); osc.start();
  for (let i = 0; i < 2; i++) {
    clients[i].localStream = streams[i];
    await sendingAudioTransceiver(clients[i].peerConnections.get(ids[1-i]).connection)!.sender.replaceTrack(streams[i].getAudioTracks()[0]);
  }
  await wait(2500);
  report.peers = await Promise.all(clients.map(async (client, i) => {
    const peer = client.peerConnections.get(ids[1-i]);
    const stats = [...(await peer.connection.getStats()).values()];
    return { state: peer.connection.connectionState, playing: !peer.audioElement?.paused, muted: peer.audioElement?.muted,
      inbound: stats.filter((s: any) => s.type === 'inbound-rtp').map((s: any) => ({ packets: s.packetsReceived, energy: s.totalAudioEnergy })),
      outbound: stats.filter((s: any) => s.type === 'outbound-rtp').map((s: any) => ({ packets: s.packetsSent })),
    };
  }));
  report.ok = report.peers.every((p: any) => p.state === 'connected' && p.playing && !p.muted && p.inbound.some((s: any) => s.packets > 0 && s.energy > 0));
  if (!report.ok) throw new Error('Call has no bidirectional audio before moderation');
  // Exercise the production signaling handler and microphone stop/enable chain
  // against a real sender, rather than merely checking the UI mute flag.
  left.chatHostId = ids[1];
  left.micActuallyEnabled = left.desiredMicEnabled = true;
  left.rawMicStream = captured;
  left.requestMicrophonePermission = () => openMicrophone();
  left.syncChatPeers = async () => {};
  await left.handleWebSocketMessage({ type: 'player-mute-changed', playerId: ids[0], muted: true });
  await left.micOpChain;
  const leftSender = sendingAudioTransceiver(left.peerConnections.get(ids[1]).connection)!.sender;
  report.hostMute = { senderDetached: leftSender.track === null, captureEnded: captured.getAudioTracks()[0].readyState === 'ended', micEnabled: left.micActuallyEnabled };
  if (!report.hostMute.senderDetached || !report.hostMute.captureEnded || report.hostMute.micEnabled) throw new Error('Host mute did not stop the real sender and capture');
  let blocked = false;
  try { await left.setMicEnabled(true); } catch { blocked = true; }
  if (!blocked) throw new Error('Muted participant could re-enable microphone');
  await wait(400); // Drain audio already received before the mute event.
  const remoteEnergy = async () => [...(await right.peerConnections.get(ids[0]).connection.getStats()).values()]
    .filter((s: any) => s.type === 'inbound-rtp').reduce((sum: number, s: any) => sum + (s.totalAudioEnergy || 0), 0);
  const silentStart = await remoteEnergy();
  await wait(600);
  report.mutedEnergyDelta = (await remoteEnergy()) - silentStart;
  if (report.mutedEnergyDelta > 0.00001) throw new Error('Remote side still received speech after host mute');
  await left.handleWebSocketMessage({ type: 'host-changed', hostId: ids[0] });
  if (left.hostMutedLocal || left.desiredMicEnabled || leftSender.track) throw new Error('Promotion retained restriction or opened mic without user action');
  const resumedStart = await remoteEnergy();
  await left.setMicEnabled(true);
  streams.push(left.localStream);
  await wait(900);
  report.promotedHostEnergyDelta = (await remoteEnergy()) - resumedStart;
  if (report.promotedHostEnergyDelta <= 0.00001) throw new Error('Promoted host could not speak after enabling microphone');
}
void main().catch(e => { report.error = String(e); report.ok = false; }).finally(async () => {
  clients.forEach((client, i) => client.removePeerConnection(ids[1-i]));
  streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  await context.close();
  await invoke('audio_check_report', { report });
});
