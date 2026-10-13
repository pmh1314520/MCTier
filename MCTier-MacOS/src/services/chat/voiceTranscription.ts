import { Channel, invoke } from '@tauri-apps/api/core';

const TARGET_SAMPLE_RATE = 16_000;

function pcm16Wav(channel: Float32Array, sampleRate: number): number[] {
  const ratio = sampleRate / TARGET_SAMPLE_RATE;
  const sampleCount = Math.max(1, Math.floor(channel.length / ratio));
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true); view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const source = index * ratio;
    const left = Math.floor(source);
    const fraction = source - left;
    const value = channel[left] * (1 - fraction) + (channel[Math.min(channel.length - 1, left + 1)] ?? channel[left]) * fraction;
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true);
  }
  return Array.from(bytes);
}

export async function transcribeVoiceMessage(dataUrl: string, language: string, onProgress?: (completed: number, total: number) => void): Promise<string> {
  const response = await fetch(dataUrl);
  const encoded = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(encoded.slice(0));
    const mono = new Float32Array(decoded.length);
    for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
      const channel = decoded.getChannelData(channelIndex);
      for (let index = 0; index < mono.length; index += 1) mono[index] += channel[index] / decoded.numberOfChannels;
    }
    const progress = new Channel<{ completed: number; total: number }>();
    progress.onmessage = value => onProgress?.(value.completed, value.total);
    return await invoke<string>('transcribe_voice_message', {
      wavData: pcm16Wav(mono, decoded.sampleRate),
      language: language.startsWith('en') ? 'en-US' : 'zh-CN',
      progress,
    });
  } finally {
    await context.close();
  }
}
