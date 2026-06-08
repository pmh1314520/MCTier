/**
 * 音频设备选择持久化
 * - 记录用户选定的麦克风(输入)与扬声器(输出)设备
 * - 供 WebRTCClient 获取麦克风约束、以及音频播放元素设置输出设备使用
 */

const INPUT_KEY = 'mctier_audio_input_device';
const OUTPUT_KEY = 'mctier_audio_output_device';

export const audioDevices = {
  getInputDeviceId(): string {
    try {
      return localStorage.getItem(INPUT_KEY) || '';
    } catch {
      return '';
    }
  },
  setInputDeviceId(id: string): void {
    try {
      if (id) localStorage.setItem(INPUT_KEY, id);
      else localStorage.removeItem(INPUT_KEY);
    } catch { /* ignore */ }
  },
  getOutputDeviceId(): string {
    try {
      return localStorage.getItem(OUTPUT_KEY) || '';
    } catch {
      return '';
    }
  },
  setOutputDeviceId(id: string): void {
    try {
      if (id) localStorage.setItem(OUTPUT_KEY, id);
      else localStorage.removeItem(OUTPUT_KEY);
    } catch { /* ignore */ }
  },
};
