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
  private processedMessageIds: Set<string> = new Set(); // 存储已处理的消息ID
  private lastPlayerMessages: Map<string, string> = new Map(); // 存储每个玩家的最后一条消息内容
  private isInitialized: boolean = false; // 标记是否已初始化

  /**
   * 初始化服务
   */
  initialize(peerIps: string[], currentPlayerId: string): void {
    // 更新玩家IPs和ID
    this.peerIps = peerIps;
    this.currentPlayerId = currentPlayerId;
    
    // 只在第一次初始化时设置时间戳和清空消息ID
    if (!this.isInitialized) {
      this.processedMessageIds.clear();
      this.lastPlayerMessages.clear();
      // 设置初始时间戳为当前时间，只接收加入后的消息
      this.lastMessageTimestamp = Math.floor(Date.now() / 1000);
      this.isInitialized = true;
      
      console.log('✅ [P2PChatService] 首次初始化完成，玩家IPs:', peerIps);
      console.log('📅 [P2PChatService] 初始时间戳:', this.lastMessageTimestamp, '（只接收此时间后的消息）');
    } else {
      console.log('🔄 [P2PChatService] 更新配置，玩家IPs:', peerIps);
      console.log('📅 [P2PChatService] 保持现有时间戳:', this.lastMessageTimestamp);
    }
  }
  
  /**
   * 重置服务状态（退出大厅时调用）
   */
  reset(): void {
    this.stopPolling();
    this.lastMessageTimestamp = 0;
    this.processedMessageIds.clear();
    this.lastPlayerMessages.clear();
    this.peerIps = [];
    this.currentPlayerId = '';
    this.onMessageCallback = undefined;
    this.isInitialized = false;
    console.log('🔄 [P2PChatService] 服务已重置');
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
    
    // 每500毫秒轮询一次，实现秒发秒收的低延迟
    this.pollingInterval = window.setInterval(() => {
      this.pollMessages();
    }, 500);
    
    console.log('✅ [P2PChatService] 开始轮询消息（500ms间隔）');
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
        
        // 打印原始消息时间戳用于调试
        console.log('📅 [P2PChatService] 原始消息时间戳:', messages.map(m => ({
          id: m.id,
          player: m.player_name,
          timestamp: m.timestamp,
          content: m.content.substring(0, 20)
        })));

        // 按时间戳排序消息，确保顺序正确
        messages.sort((a, b) => a.timestamp - b.timestamp);
        
        console.log('📅 [P2PChatService] 排序后消息顺序:', messages.map(m => ({
          id: m.id,
          player: m.player_name,
          timestamp: m.timestamp
        })));

        // 更新最后消息时间戳
        const maxTimestamp = Math.max(...messages.map(m => m.timestamp));
        this.lastMessageTimestamp = maxTimestamp;

        // 处理每条消息
        for (const msg of messages) {
          // 关键修复：跳过自己发送的消息
          if (msg.player_id === this.currentPlayerId) {
            console.log('🚫 [P2PChatService] 跳过自己发送的消息:', msg.id);
            continue;
          }

          // 去重：跳过已处理的消息ID
          if (this.processedMessageIds.has(msg.id)) {
            console.log('📭 [P2PChatService] 跳过已处理的消息ID:', msg.id);
            continue;
          }

          // 【修复】增强去重：判断新消息是否与该玩家最后一条消息内容重复
          const lastContent = this.lastPlayerMessages.get(msg.player_name);
          if (lastContent === msg.content) {
            console.log('📭 [P2PChatService] 跳过重复内容的消息:', `${msg.player_name}: ${msg.content.substring(0, 20)}...`);
            // 仍然记录消息ID，避免重复处理
            this.processedMessageIds.add(msg.id);
            continue;
          }
          
          // 记录消息ID和该玩家的最后一条消息内容
          this.processedMessageIds.add(msg.id);
          this.lastPlayerMessages.set(msg.player_name, msg.content);
          console.log('✅ [P2PChatService] 接收新消息:', `${msg.player_name}: ${msg.content.substring(0, 20)}...`);

          // 转换为前端消息格式
          const chatMessage: ChatMessage = {
            id: msg.id,
            playerId: msg.player_id,
            playerName: msg.player_name,
            content: msg.content,
            timestamp: msg.timestamp * 1000, // 转换为毫秒
            type: msg.message_type,
            imageData: msg.image_data ? this.arrayToBase64(msg.image_data) : undefined,
          };

          // 回调通知新消息
          if (this.onMessageCallback) {
            this.onMessageCallback(chatMessage);
          }

          // 【修复】只有在不在聊天室界面时才播放音效
          const isInChatRoom = (window as any).__isInChatRoom__;
          if (!isInChatRoom) {
            try {
              const { audioService } = await import('../audio/AudioService');
              await audioService.play('newMessage');
              console.log('🔔 [P2PChatService] 播放新消息音效');
            } catch (error) {
              console.error('❌ [P2PChatService] 播放新消息音效失败:', error);
            }
          } else {
            console.log('🔕 [P2PChatService] 在聊天室中，跳过播放音效');
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
  async sendTextMessage(content: string): Promise<void> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
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
  async sendImageMessage(imageDataUrl: string): Promise<void> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
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
      this.lastPlayerMessages.clear();
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
    this.lastPlayerMessages.clear();
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
