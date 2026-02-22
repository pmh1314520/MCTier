/**
 * P2P聊天服务
 * 基于HTTP over WireGuard的点对点聊天
 * 不依赖中心服务器，直接在虚拟局域网中传输
 */

import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '../../types';

interface BackendChatMessage {
  id: string;
  player_id: string;
  player_name: string;
  content: string;
  message_type: 'text' | 'image';
  timestamp: number;
  image_data?: number[]; // Uint8Array转换为number[]
}

class P2PChatService {
  private pollingInterval: number | null = null;
  private lastMessageTimestamp: number = 0;
  private onMessageCallback?: (message: ChatMessage) => void;
  private peerIps: string[] = [];
  private currentPlayerId: string = '';
  private processedMessageIds: Set<string> = new Set();
  private sentMessageIds: Set<string> = new Set(); // 记录自己发送的消息ID

  /**
   * 初始化服务
   */
  initialize(peerIps: string[], currentPlayerId: string): void {
    this.peerIps = peerIps;
    this.currentPlayerId = currentPlayerId;
    this.processedMessageIds.clear();
    this.sentMessageIds.clear();
    console.log('✅ [P2PChatService] 初始化完成，玩家IPs:', peerIps);
  }

  /**
   * 设置消息接收回调
   */
  onMessage(callback: (message: ChatMessage) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * 开始轮询消息
   */
  startPolling(): void {
    if (this.pollingInterval !== null) {
      console.warn('⚠️ [P2PChatService] 轮询已在运行');
      return;
    }

    // 立即获取一次消息
    this.pollMessages();
    
    // 每2秒轮询一次
    this.pollingInterval = window.setInterval(() => {
      this.pollMessages();
    }, 2000);
    
    console.log('✅ [P2PChatService] 开始轮询消息');
  }

  /**
   * 停止轮询消息
   */
  stopPolling(): void {
    if (this.pollingInterval !== null) {
      window.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('🛑 [P2PChatService] 停止轮询消息');
    }
  }

  /**
   * 轮询消息
   */
  private async pollMessages(): Promise<void> {
    if (this.peerIps.length === 0) {
      return;
    }

    try {
      const messages = await invoke<BackendChatMessage[]>('get_p2p_chat_messages', {
        peerIps: this.peerIps,
        since: this.lastMessageTimestamp > 0 ? this.lastMessageTimestamp : undefined,
      });

      if (messages.length > 0) {
        console.log(`📨 [P2PChatService] 收到 ${messages.length} 条新消息`);

        // 更新最后消息时间戳
        const maxTimestamp = Math.max(...messages.map(m => m.timestamp));
        this.lastMessageTimestamp = maxTimestamp;

        // 处理每条消息
        for (const msg of messages) {
          // 去重：跳过已处理的消息
          if (this.processedMessageIds.has(msg.id)) {
            continue;
          }
          this.processedMessageIds.add(msg.id);

          // 跳过自己发送的消息（通过sentMessageIds判断）
          if (this.sentMessageIds.has(msg.id)) {
            console.log('📭 [P2PChatService] 跳过自己发送的消息（已在本地显示）:', msg.id);
            continue;
          }

          // 跳过自己发送的消息（通过playerId判断，双重保险）
          if (msg.player_id === this.currentPlayerId) {
            console.log('📭 [P2PChatService] 跳过自己发送的消息:', msg.id);
            continue;
          }

          // 转换为前端消息格式
          const chatMessage: ChatMessage = {
            id: msg.id,
            playerId: msg.player_id,
            playerName: msg.player_name,
            content: msg.content,
            timestamp: msg.timestamp,
            type: msg.message_type,
            imageData: msg.image_data ? this.arrayToBase64(msg.image_data) : undefined,
          };

          // 回调通知新消息
          if (this.onMessageCallback) {
            this.onMessageCallback(chatMessage);
          }
        }
      }
    } catch (error) {
      console.error('❌ [P2PChatService] 轮询消息失败:', error);
    }
  }

  /**
   * 发送文本消息
   */
  async sendTextMessage(content: string, messageId?: string): Promise<void> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
    }

    // 如果提供了messageId，记录到sentMessageIds
    if (messageId) {
      this.sentMessageIds.add(messageId);
    }

    try {
      await invoke('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '', // 后端会自动填充
        content,
        messageType: 'text',
        imageData: null,
        peerIps: this.peerIps,
      });
      console.log('✅ [P2PChatService] 文本消息已发送');
    } catch (error) {
      console.error('❌ [P2PChatService] 发送文本消息失败:', error);
      throw error;
    }
  }

  /**
   * 发送图片消息（Base64格式）
   */
  async sendImageMessage(imageDataUrl: string, messageId?: string): Promise<void> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
    }

    // 如果提供了messageId，记录到sentMessageIds
    if (messageId) {
      this.sentMessageIds.add(messageId);
    }

    try {
      // 从Data URL中提取Base64数据
      const base64Data = imageDataUrl.split(',')[1];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      await invoke('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '', // 后端会自动填充
        content: '[图片]',
        messageType: 'image',
        imageData: Array.from(bytes),
        peerIps: this.peerIps,
      });
      console.log('✅ [P2PChatService] 图片消息已发送');
    } catch (error) {
      console.error('❌ [P2PChatService] 发送图片消息失败:', error);
      throw error;
    }
  }

  /**
   * 清空本地消息
   */
  async clearMessages(): Promise<void> {
    try {
      await invoke('clear_p2p_chat_messages');
      this.lastMessageTimestamp = 0;
      this.processedMessageIds.clear();
      console.log('✅ [P2PChatService] 本地消息已清空');
    } catch (error) {
      console.error('❌ [P2PChatService] 清空消息失败:', error);
      throw error;
    }
  }

  /**
   * 重置时间戳（用于重新加载所有消息）
   */
  resetTimestamp(): void {
    this.lastMessageTimestamp = 0;
    this.processedMessageIds.clear();
  }

  /**
   * 将number数组转换为Base64 Data URL
   */
  private arrayToBase64(data: number[]): string {
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    // 假设是PNG格式，实际应该从数据中检测
    return `data:image/png;base64,${base64}`;
  }
}

export const p2pChatService = new P2PChatService();
