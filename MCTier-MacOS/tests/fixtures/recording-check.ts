import { invoke } from '@tauri-apps/api/core';
import { openMicrophone } from '../../src/services/voice/nativeMicrophone';
import { screenRecording } from '../../src/services/screenRecording';
import { registerCapturePicker, type CaptureSource } from '../../src/services/screenShare/nativeCapture';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let frame = 0;
setInterval(() => { ctx.fillStyle = `hsl(${frame++ * 7 % 360} 70% 50%)`; ctx.fillRect(0, 0, 480, 240); ctx.fillStyle = 'white'; ctx.font = '32px sans-serif'; ctx.fillText(`MCTier ${frame}`, 40, 120); }, 100);
const reports: unknown[] = [];
(async () => {
  const sources = await invoke<CaptureSource[]>('native_capture_sources');
  let selected = sources.find(s => s.kind === 'monitor' && s.primary)!;
  registerCapturePicker(choice => { if (choice) choice.resolve(selected); });
  const tone = new AudioContext(); await tone.resume();
  const oscillator = tone.createOscillator(), gain = tone.createGain();
  oscillator.frequency.value = 440; gain.gain.value = 0.025;
  oscillator.connect(gain).connect(tone.destination); oscillator.start();
  for (const mode of ['system', 'mic', 'both', 'system-transition', 'silent', 'window']) {
    (window as any).__recordingDiagnostics = [];
    if (mode === 'window') selected = sources.find(s => s.kind === 'window' && s.name.includes('recording verification')) ?? sources.find(s => s.kind === 'window')!;
    if (!selected) throw Error('No capture source');
    await screenRecording.start({ resolution: 1080, frameRate: 60, bitrateMbps: 16, systemAudio: ['system', 'both', 'system-transition'].includes(mode), microphone: ['mic', 'both'].includes(mode), countdown: 0 });
    if (screenRecording.getSnapshot().phase !== 'recording') throw Error(JSON.stringify(screenRecording.getSnapshot()));
    const load = setInterval(() => { const end = performance.now() + 40; while (performance.now() < end) { /* Intentionally simulate renderer load during capture. */ } }, 180);
    if (mode === 'both') {
      const call = await openMicrophone();
      const message = await openMicrophone();
      const encoded = new MediaRecorder(message);
      let bytes = 0;
      encoded.ondataavailable = e => { bytes += e.data.size; };
      encoded.start(); await wait(1400);
      const done = new Promise<void>(resolve => encoded.addEventListener('stop', () => resolve(), {once:true}));
      encoded.stop(); await done;
      message.getTracks().forEach(track => track.stop());
      if (bytes === 0 || call.getAudioTracks()[0].readyState !== 'live') throw Error('Concurrent chat recording failed');
      await screenRecording.stop();
      if (call.getAudioTracks()[0].readyState !== 'live') throw Error('Stopping video stopped the call microphone');
      call.getTracks().forEach(track => track.stop());
      reports.push({ mode: 'concurrent-call-and-message', voiceBytes: bytes, ...screenRecording.getSnapshot() });
      clearInterval(load);
      continue;
    }
    if (mode === 'system-transition') {
      await wait(1200); await tone.suspend(); await wait(2000); await tone.resume(); await wait(1800);
    } else await wait(mode === 'both' ? 40000 : 5000);
    screenRecording.pause();
    if (screenRecording.getSnapshot().phase !== 'paused') throw Error('Pause failed');
    await wait(700);
    screenRecording.pause();
    if (screenRecording.getSnapshot().phase !== 'recording') throw Error('Resume failed');
    await wait(2500); clearInterval(load);
    await screenRecording.stop();
    const result = screenRecording.getSnapshot();
    if (result.error || !result.path || result.bytes < 1000) throw Error(JSON.stringify(result));
    reports.push({ mode, ...result, diagnostics: (window as any).__recordingDiagnostics });
    if ((window as any).__recordingDiagnostics?.some((d: {stage: string; detail: string}) => d.stage === 'realtime' && !d.detail.includes('underrun=0,'))) throw Error(`Audio discontinuity in ${mode}`);
  }
  oscillator.stop(); await tone.close();
  await invoke('open_file_location', { path: screenRecording.getSnapshot().path });
  await invoke('recording_check_report', { report: { ok: true, reports } });
})().catch(async error => { await invoke('recording_check_report', { report: { ok: false, error: String(error), reports } }); });
