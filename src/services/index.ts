/**
 * MCTier 前端服务模块
 * 本文件作为前端服务的入口点，用于封装与后端的通信和 WebRTC 相关逻辑
 */

// WebRTC 服务
export { WebRTCClient, webrtcClient } from './webrtc';
export type { SignalingMessage, PeerConnection } from './webrtc';

// 快捷键服务
export { HotkeyManager, hotkeyManager } from './hotkey';
export type { HotkeyCallback } from './hotkey';

// 音效服务
export { audioService } from './audio/AudioService';
export type { SoundType } from './audio/AudioService';

// 文件共享服务
export { fileShareService, fileTransferService } from './fileShare';
