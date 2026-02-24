/**
 * P2P聊天服务
 * 基于HTTP over WireGuard的点对点聊天
 * 使用SSE(Server-Sent Events)实现事件驱动的消息推送
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
  private eventSources: Map<string, EventSource> = new Map(); // 每个玩家一个EventSource
  private onMessageCallback?: (message: ChatMessage) => void;
  private peerIps: string[] = [];
  private currentPlayerId: string = '';
  private myVirtualIp: string = ''; // 自己的虚拟IP，用于过滤
  private lastMessageByPlayer: Map<string, string> = new Map(); // 【修改】记录每个玩家最近一次发送的消息内容

  /**
   * 初始化服务
   */
  initialize(peerIps: string[], currentPlayerId: string, myVirtualIp: string): void {
    // 【修复】先清理旧的连接，避免重复连接
    console.log('🔄 [P2PChatService] 清理旧连接...');
    this.stopListening();
    
    // 更新玩家IPs和ID
    this.peerIps = peerIps;
    this.currentPlayerId = currentPlayerId;
    this.myVirtualIp = myVirtualIp;
    
    console.log('✅ [P2PChatService] 初始化完成');
    console.log('  - 当前玩家ID:', currentPlayerId);
    console.log('  - 自己的虚拟IP:', myVirtualIp);
    console.log('  - 其他玩家IPs:', peerIps);
  }
  
  /**
   * 重置服务状态（退出大厅时调用）
   */
  reset(): void {
    this.stopListening();
    this.peerIps = [];
    this.currentPlayerId = '';
    this.myVirtualIp = '';
    this.onMessageCallback = undefined;
    this.lastMessageByPlayer.clear(); // 【修改】清理玩家消息记录
    console.log('🔄 [P2PChatService] 服务已重置');
  }

  /**
   * 设置消息接收回调
   */
  onMessage(callback: (message: ChatMessage) => void): void {
    this.onMessageCallback = callback;
  }

  /**
   * 开始监听消息（使用SSE）
   */
  startPolling(): void {
    console.log('✅ [P2PChatService] 开始监听消息（SSE事件驱动）');
    console.log('📊 [P2PChatService] 当前已有连接数:', this.eventSources.size);
    
    // 【修复】先完全清理所有旧连接
    if (this.eventSources.size > 0) {
      console.log('⚠️ [P2PChatService] 检测到旧连接，先清理所有连接');
      this.stopListening();
    }
    
    // 为每个玩家创建SSE连接
    for (const peerIp of this.peerIps) {
      // 跳过自己的IP（使用虚拟IP比较）
      if (peerIp === this.myVirtualIp) {
        console.log(`🚫 [P2PChatService] 跳过自己的IP: ${peerIp}`);
        continue;
      }
      
      // 【双重检查】确保没有重复连接
      if (this.eventSources.has(peerIp)) {
        console.error(`❌ [P2PChatService] 严重错误：清理后仍存在连接: ${peerIp}`);
        const oldEventSource = this.eventSources.get(peerIp);
        if (oldEventSource) {
          oldEventSource.close();
        }
        this.eventSources.delete(peerIp);
      }
      
      this.connectToPlayer(peerIp);
    }
    
    console.log('📊 [P2PChatService] 连接建立完成，当前连接数:', this.eventSources.size);
  }

  /**
   * 连接到指定玩家的SSE流
   */
  private connectToPlayer(peerIp: string): void {
    const url = `http://${peerIp}:14540/api/chat/stream`;
    console.log(`📡 [P2PChatService] 连接到玩家: ${url}`);
    
    try {
      const eventSource = new EventSource(url);
      
      eventSource.onopen = () => {
        console.log(`✅ [P2PChatService] SSE连接已建立: ${peerIp}`);
      };
      
      eventSource.onmessage = (event) => {
        // 跳过keep-alive消息
        if (event.data === 'keep-alive') {
          return;
        }
        
        try {
          const message: BackendChatMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ [P2PChatService] 解析消息失败:', error);
        }
      };
      
      eventSource.onerror = (error) => {
        console.warn(`⚠️ [P2PChatService] SSE连接错误: ${peerIp}`, error);
        // 连接断开，移除EventSource
        this.eventSources.delete(peerIp);
        eventSource.close();
        
        // 5秒后重连
        setTimeout(() => {
          if (this.peerIps.includes(peerIp)) {
            console.log(`🔄 [P2PChatService] 重新连接: ${peerIp}`);
            this.connectToPlayer(peerIp);
          }
        }, 5000);
      };
      
      this.eventSources.set(peerIp, eventSource);
    } catch (error) {
      console.error(`❌ [P2PChatService] 创建SSE连接失败: ${peerIp}`, error);
    }
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(msg: BackendChatMessage): void {
    // 跳过自己发送的消息
    if (msg.player_id === this.currentPlayerId) {
      console.log('🚫 [P2PChatService] 跳过自己发送的消息:', msg.id);
      return;
    }

    // 【修改】消息去重：检查该玩家最近一次发送的消息内容是否与当前消息相同
    const lastMessage = this.lastMessageByPlayer.get(msg.player_id);
    if (lastMessage === msg.content) {
      console.log('🚫 [P2PChatService] 跳过重复消息（内容相同）:', {
        playerId: msg.player_id,
        playerName: msg.player_name,
        content: msg.content.substring(0, 20) + '...',
      });
      return;
    }

    console.log('✅ [P2PChatService] 接收新消息:', `${msg.player_name}: ${msg.content.substring(0, 20)}...`);

    // 【修改】更新该玩家最近一次发送的消息内容
    this.lastMessageByPlayer.set(msg.player_id, msg.content);

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

    // 只有在不在聊天室界面时才播放音效
    const isInChatRoom = (window as any).__isInChatRoom__;
    if (!isInChatRoom) {
      this.playNewMessageSound();
    } else {
      console.log('🔕 [P2PChatService] 在聊天室中，跳过播放音效');
    }
  }

  /**
   * 播放新消息音效
   */
  private async playNewMessageSound(): Promise<void> {
    try {
      const { audioService } = await import('../audio/AudioService');
      await audioService.play('newMessage');
      console.log('🔔 [P2PChatService] 播放新消息音效');
    } catch (error) {
      console.error('❌ [P2PChatService] 播放新消息音效失败:', error);
    }
  }

  /**
   * 停止监听消息
   */
  stopPolling(): void {
    this.stopListening();
  }

  /**
   * 停止所有SSE连接
   */
  private stopListening(): void {
    for (const [peerIp, eventSource] of this.eventSources.entries()) {
      eventSource.close();
      console.log(`🛑 [P2PChatService] 关闭SSE连接: ${peerIp}`);
    }
    this.eventSources.clear();
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
      console.log('✅ [P2PChatService] 本地消息已清空');
    } catch (error) {
      console.error('❌ [P2PChatService] 清空消息失败:', error);
      throw error;
    }
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
