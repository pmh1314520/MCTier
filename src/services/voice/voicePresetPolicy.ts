/**
 * 音色预设的链路策略（纯函数，便于单测）。
 *
 * 「原声」不需要任何处理节点，因此不应该接 WebAudio 图：一旦接了，发出去的就不是
 * 采集到的原始轨道，而是 MediaStreamDestination 产出的轨道。桌面端已经取消了降噪 /
 * 回声消除 / 自动增益，把这条 WebAudio 桥接一并去掉，「原声」才真的是端到端原声。
 *
 * 这一层还有一个实际影响：Linux（WebKitGTK + GStreamer）下开麦即整页卡死的死锁栈卡在
 * `gst_pad_push_event`，而 WebAudio 输出轨道要多跨一次 WebAudio↔GStreamer 桥接。
 * 绕开它之后「原声」通话不再经过这段管线，可用来判断死锁到底在桥接还是在 addTrack 本身
 * （见 issue #42 第 4 条）。
 */

import type { VoicePreset } from './voiceChanger';

/** 该音色是否完全不需要处理节点（可直接发送原始麦克风轨道）。 */
export function isBypassPreset(preset: VoicePreset): boolean {
  return preset === 'none';
}

/**
 * 从 `previous` 切到 `next` 是否必须重建输出流（即输出轨道会变）。
 *
 * 只有跨越「旁路 ↔ 变声」边界时轨道才会变；在变声内部换音色由引擎原地改图，
 * 输出轨道不变，因此不需要 replaceTrack，也不需要重新协商。
 */
export function requiresOutputRebuild(previous: VoicePreset, next: VoicePreset): boolean {
  return isBypassPreset(previous) !== isBypassPreset(next);
}
