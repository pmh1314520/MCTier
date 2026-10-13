import { useEffect, useState } from 'react';
import { Select, Typography, message } from 'antd';
import { tl } from '../../i18n';
import { aiNoiseDevices, noiseProvider, nvidiaNoiseMode, setNvidiaNoiseMode, type NvidiaNoiseMode } from '../../services/voice/nvidiaNoise';
import { webrtcClient } from '../../services';
import type { MicrophoneDevice } from '../../services/voice/nativeMicrophone';

export function NvidiaNoiseSetting({ lobby = false }: { lobby?: boolean }) {
  const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
  const [mode, setMode] = useState(nvidiaNoiseMode(lobby));
  useEffect(() => {
    let disposed = false;
    const refresh = () => { void aiNoiseDevices().then(value => { if (!disposed) setDevices(value); }).catch(() => { if (!disposed) setDevices([]); }); };
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { disposed = true; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, []);
  const available = [...new Set(devices.map(noiseProvider))];
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: '12px 14px', minWidth: 0 }}>
    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
      <Typography.Text>{tl('AI 语音降噪（NVIDIA / AMD）', 'AI Noise Removal (NVIDIA / AMD)')}</Typography.Text>
      <div><Typography.Text type="secondary">{available.length ? available.map(value => value === 'amd' ? 'AMD Noise Suppression' : 'NVIDIA Broadcast / RTX Voice').join(' · ') : tl('未检测到降噪麦克风，将使用系统降噪', 'No AI microphone detected; using system noise suppression')}</Typography.Text></div>
      <div><Typography.Text type="secondary">{tl('AMD 用户请在 Adrenalin 的“音频和视频”中开启 Noise Suppression；NVIDIA 用户请先开启 Broadcast / RTX Voice。', 'AMD: enable Noise Suppression in Adrenalin Audio & Video. NVIDIA: enable Broadcast / RTX Voice first.')}</Typography.Text></div>
    </div>
    <Select<NvidiaNoiseMode> style={{ width: 165 }} value={mode} getPopupContainer={trigger => trigger.parentElement ?? document.body} aria-label={tl('AI 降噪方式', 'AI noise provider')}
      options={[{ value: 'auto', label: tl('自动选择', 'Automatic') }, { value: 'nvidia', label: 'NVIDIA' }, { value: 'amd', label: 'AMD' }, { value: 'off', label: tl('系统降噪', 'System processing') }]}
      onChange={value => {
        setMode(value); setNvidiaNoiseMode(value, lobby);
        void webrtcClient.refreshMicrophoneProcessing().catch(() => message.error(tl('切换降噪失败，请重新开启麦克风', 'Could not switch noise removal. Re-enable the microphone')));
      }} />
  </div>;
}
