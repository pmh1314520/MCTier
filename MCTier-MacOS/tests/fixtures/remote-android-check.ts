import { invoke } from '@tauri-apps/api/core';
import { remoteControlService as service } from '../../src/services/remoteControl/RemoteControlService';
import { registerCapturePicker, type CaptureSource } from '../../src/services/screenShare/nativeCapture';
import { markSignalingSocketRegistered } from '../../src/services/signaling/registeredSocket';

const ws = new WebSocket('ws://127.0.0.1:47839/desktop');
const report = async (value: object) => {
  ws.send(JSON.stringify({ type: 'test-desktop-report', report: value }));
  service.stopControl(false);
  await invoke('quark_check_report', { report: value });
};
registerCapturePicker(choice => {
  if (!choice) return;
  void invoke<CaptureSource[]>('native_capture_sources').then(sources => {
    const source = sources.find(s => s.kind === 'monitor' && s.primary);
    if (!source) throw Error('No primary display');
    choice.resolve(source);
  }).catch(choice.reject);
});
ws.onopen = () => {
  markSignalingSocketRegistered(ws);
  service.initialize('desktop-check', 'Windows actual screen', ws);
  ws.send(JSON.stringify({ type: 'test-ready' }));
};
let chain = Promise.resolve();
ws.onmessage = event => {
  chain = chain.then(async () => {
    const m = JSON.parse(event.data);
    if (m.type === 'remote-control-request') {
      service.handleRequest(m.sessionId, m.from, m.fromName, m.to);
      await service.acceptControl(m.sessionId, m.from, m.fromName);
    } else if (m.type === 'remote-control-offer') {
      await service.handleOffer(m.sessionId, m.from, m.to, m.offer.sdp);
    } else if (m.type === 'remote-control-ice') {
      await service.handleIce(m.sessionId, m.from, m.to, m.candidate);
    } else if (m.type === 'test-complete') {
      const pc = (service as any).pc as RTCPeerConnection | null;
      const stats = pc ? [...(await pc.getStats()).values()].filter(s => s.type === 'outbound-rtp' && s.kind === 'video') : [];
      const inputs = (globalThis as any).remoteCheckInputs || 0;
      await report({ ok: m.ok && inputs > 0 && stats.some(s => s.framesEncoded > 0), android: m, inputs, stats });
    }
  }).catch(error => report({ ok: false, error: String(error) }));
};
