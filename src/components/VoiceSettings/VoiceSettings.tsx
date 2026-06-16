/**
 * 语音设备设置
 * - 选择麦克风(输入)与扬声器(输出)设备
 * - 麦克风试音：实时电平条
 * - 扬声器试音：在选定输出设备上播放测试音
 * 说明：输入设备会在下次开启/重开麦克风时生效；输出设备对已连接对端实时生效。
 *
 * 该模块导出两部分：
 * - VoiceDevicePanel：可内嵌的设置面板（用于「大厅动态设置」中集成）
 * - VoiceSettings：独立弹窗（兼容旧调用，内部复用 VoiceDevicePanel）
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, Select, Button, Typography, Space, Progress, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { audioDevices } from '../../services/voice/audioDevices';
import { webrtcClient } from '../../services';

const { Text } = Typography;

interface DeviceOption {
  value: string;
  label: string;
}

interface VoiceDevicePanelProps {
  /** 面板是否处于激活状态（如所在弹窗是否打开），用于控制设备枚举与试音清理 */
  active?: boolean;
}

/**
 * 语音设备设置面板（无弹窗外壳，可内嵌）
 */
export const VoiceDevicePanel: React.FC<VoiceDevicePanelProps> = ({ active = true }) => {
  useTranslation();
  const [inputs, setInputs] = useState<DeviceOption[]>([]);
  const [outputs, setOutputs] = useState<DeviceOption[]>([]);
  const [inputId, setInputId] = useState<string>('');
  const [outputId, setOutputId] = useState<string>('');
  const [supportsOutput, setSupportsOutput] = useState(true);

  // 麦克风试音电平
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const testStreamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  // 下拉框渲染到自身父节点，避免在透明窗口/弹窗中出现层级错误（显示在弹窗背后无法点击）
  const popupContainer = (triggerNode: HTMLElement) =>
    (triggerNode.parentElement as HTMLElement) || document.body;

  const loadDevices = async () => {
    try {
      // 触发一次权限请求，否则设备 label 为空
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch { /* 用户可能拒绝，仍尝试枚举 */ }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const ins: DeviceOption[] = [{ value: '', label: tl('系统默认麦克风', 'System Default Microphone') }];
      const outs: DeviceOption[] = [{ value: '', label: tl('系统默认扬声器', 'System Default Speaker') }];
      devices.forEach((d) => {
        if (d.kind === 'audioinput') {
          ins.push({ value: d.deviceId, label: d.label || `${tl('麦克风', 'Microphone')} ${ins.length}` });
        } else if (d.kind === 'audiooutput') {
          outs.push({ value: d.deviceId, label: d.label || `${tl('扬声器', 'Speaker')} ${outs.length}` });
        }
      });
      setInputs(ins);
      setOutputs(outs);
      setSupportsOutput(typeof (HTMLMediaElement.prototype as any).setSinkId === 'function');
    } catch (e) {
      message.error(`${tl('枚举音频设备失败', 'Failed to enumerate audio devices')}：${e}`);
    }
  };

  const stopMicTest = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setTesting(false);
    setLevel(0);
  };

  useEffect(() => {
    if (active) {
      setInputId(audioDevices.getInputDeviceId());
      setOutputId(audioDevices.getOutputDeviceId());
      void loadDevices();
    } else {
      stopMicTest();
    }
    return () => stopMicTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const handleInputChange = (id: string) => {
    setInputId(id);
    audioDevices.setInputDeviceId(id);
    // 若正在试音，使用新设备重启
    if (testing) {
      stopMicTest();
      void startMicTest(id);
    }
    message.success(tl('麦克风已切换，将在下次开启麦克风时生效', 'Microphone switched, effective next time you enable it'));
  };

  const handleOutputChange = async (id: string) => {
    setOutputId(id);
    audioDevices.setOutputDeviceId(id);
    try {
      await webrtcClient.applyOutputDeviceToAll(id);
      message.success(tl('扬声器已切换并对当前通话生效', 'Speaker switched and applied to the current call'));
    } catch {
      message.success(tl('扬声器已切换', 'Speaker switched'));
    }
  };

  const startMicTest = async (deviceId?: string) => {
    try {
      const id = deviceId !== undefined ? deviceId : inputId;
      const constraints: MediaStreamConstraints = {
        audio: id ? { deviceId: { ideal: id } } : true,
        video: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      setTesting(true);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(100, Math.round(rms * 300)));
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    } catch (e) {
      message.error(`${tl('无法打开麦克风试音', 'Unable to start microphone test')}：${e}`);
    }
  };

  // 扬声器试音：播放一段测试音并路由到选定输出设备
  const testOutput = async () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.15;
      osc.frequency.value = 660;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();

      const audio = new Audio();
      audio.srcObject = dest.stream;
      if (outputId && typeof (audio as any).setSinkId === 'function') {
        await (audio as any).setSinkId(outputId).catch(() => {});
      }
      await audio.play().catch(() => {});
      setTimeout(() => {
        osc.stop();
        audio.pause();
        audio.srcObject = null;
        ctx.close().catch(() => {});
      }, 600);
    } catch (e) {
      message.error(`${tl('扬声器试音失败', 'Speaker test failed')}：${e}`);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Text strong>{tl('麦克风（输入）', 'Microphone (Input)')}</Text>
        <Select
          style={{ width: '100%', marginTop: 6 }}
          value={inputId}
          onChange={handleInputChange}
          options={inputs}
          getPopupContainer={popupContainer}
        />
        <div style={{ marginTop: 10 }}>
          <Space>
            {!testing ? (
              <Button size="small" onClick={() => void startMicTest()}>{tl('开始试音', 'Start Test')}</Button>
            ) : (
              <Button size="small" danger onClick={stopMicTest}>{tl('停止试音', 'Stop Test')}</Button>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>{tl('说话并观察下方电平', 'Speak and watch the level below')}</Text>
          </Space>
          <Progress percent={level} showInfo={false} strokeColor={level > 60 ? '#52c41a' : '#1677ff'} style={{ marginTop: 6 }} />
        </div>
      </div>

      <div>
        <Text strong>{tl('扬声器（输出）', 'Speaker (Output)')}</Text>
        {supportsOutput ? (
          <>
            <Select
              style={{ width: '100%', marginTop: 6 }}
              value={outputId}
              onChange={handleOutputChange}
              options={outputs}
              getPopupContainer={popupContainer}
            />
            <div style={{ marginTop: 10 }}>
              <Button size="small" onClick={() => void testOutput()}>{tl('扬声器试音', 'Test Speaker')}</Button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 6 }}>
            <Text type="secondary">{tl('当前环境不支持切换输出设备，将使用系统默认扬声器。', 'Switching output device is not supported here; the system default speaker will be used.')}</Text>
          </div>
        )}
      </div>
    </Space>
  );
};

interface VoiceSettingsProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 语音设备设置独立弹窗（兼容旧调用）
 */
export const VoiceSettings: React.FC<VoiceSettingsProps> = ({ visible, onClose }) => {
  useTranslation();
  return (
    <Modal title={tl('语音设备设置', 'Voice Device Settings')} open={visible} onCancel={onClose} footer={[
      <Button key="close" type="primary" onClick={onClose}>{tl('完成', 'Done')}</Button>,
    ]} width={460} centered>
      <VoiceDevicePanel active={visible} />
    </Modal>
  );
};
