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

// 本机聊天服务器监听地址（服务器绑定 0.0.0.0:14540，通过回环访问最稳定，
// 不依赖虚拟网卡或其它网卡，避免 Clash 等多网卡环境下的路由问题）
const SELF_STREAM_URL = 'http://127.0.0.1:14540/api/chat/stream';

class P2PChatService {
  private selfEventSource: EventSource | null = null; // 仅订阅“自己”的消息流
  private selfReconnectTimer: number | null = null;
  private isListening: boolean = false;
  private onMessageCallback?: (message: ChatMessage) => void;
  private peerIps: string[] = [];
  private currentPlayerId: string = '';
  private seenMessageIds: Set<string> = new Set(); // 基于消息ID去重，避免重复回调
  private seenMessageOrder: string[] = []; // 维护去重集合的插入顺序，便于裁剪

  /**
   * 初始化服务
   */
  initialize(peerIps: string[], currentPlayerId: string, myVirtualIp: string): void {
    // 更新玩家IPs和ID（发送消息时仍需要 peerIps）
    this.peerIps = peerIps;
    this.currentPlayerId = currentPlayerId;

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
    this.onMessageCallback = undefined;
    this.seenMessageIds.clear();
    this.seenMessageOrder = [];
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
   *
   * 【修复】只订阅“自己”的本机聊天流。其他玩家通过 HTTP POST 把消息发送到本机的
   * /api/chat/send，本机服务器再把消息广播到本机 SSE 订阅者（也就是自己），
   * 从而保证一定能收到别人发来的消息（旧逻辑订阅其他人的流，在 2 人大厅时收不到消息）。
   */
  startPolling(): void {
    // 幂等：已经在监听且连接正常时，不重复建立连接（避免玩家列表变化时频繁断开重连）
    if (
      this.isListening &&
      this.selfEventSource &&
      this.selfEventSource.readyState !== EventSource.CLOSED
    ) {
      console.log('ℹ️ [P2PChatService] 已在监听自身消息流，跳过重复建立');
      return;
    }

    console.log('✅ [P2PChatService] 开始监听消息（订阅本机消息流，SSE事件驱动）');
    this.isListening = true;
    this.connectToSelfStream();
  }

  /**
   * 连接到本机聊天服务器的 SSE 流
   */
  private connectToSelfStream(): void {
    // 清理可能存在的旧连接
    if (this.selfEventSource) {
      try {
        this.selfEventSource.close();
      } catch {
        // 忽略关闭异常
      }
      this.selfEventSource = null;
    }

    console.log(`📡 [P2PChatService] 连接到本机消息流: ${SELF_STREAM_URL}`);

    try {
      const eventSource = new EventSource(SELF_STREAM_URL);

      eventSource.onopen = () => {
        console.log('✅ [P2PChatService] 本机消息流已连接');
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
        console.warn('⚠️ [P2PChatService] 本机消息流连接错误，将重连', error);
        try {
          eventSource.close();
        } catch {
          // 忽略关闭异常
        }
        this.selfEventSource = null;

        // 2秒后重连（仅在仍处于监听状态时）
        if (this.selfReconnectTimer) {
          clearTimeout(this.selfReconnectTimer);
        }
        this.selfReconnectTimer = window.setTimeout(() => {
          this.selfReconnectTimer = null;
          if (this.isListening) {
            console.log('🔄 [P2PChatService] 重新连接本机消息流');
            this.connectToSelfStream();
          }
        }, 2000);
      };

      this.selfEventSource = eventSource;
    } catch (error) {
      console.error('❌ [P2PChatService] 创建本机消息流连接失败:', error);
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

    // 【修复】基于消息ID去重（每条消息ID唯一），避免重复回调；
    // 旧逻辑用“内容相同”去重，会误杀用户连续发送的相同文本（如连续两条“哈哈”）。
    if (this.seenMessageIds.has(msg.id)) {
      console.log('🚫 [P2PChatService] 跳过重复消息（ID相同）:', msg.id);
      return;
    }
    this.seenMessageIds.add(msg.id);
    this.seenMessageOrder.push(msg.id);
    // 限制去重集合大小，避免长时间运行内存增长
    if (this.seenMessageOrder.length > 1000) {
      const oldest = this.seenMessageOrder.shift();
      if (oldest) {
        this.seenMessageIds.delete(oldest);
      }
    }

    console.log('✅ [P2PChatService] 接收新消息:', `${msg.player_name}: ${msg.message_type === 'text' ? msg.content.substring(0, 20) + '...' : '[图片]'}`);

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
    this.isListening = false;

    if (this.selfReconnectTimer) {
      clearTimeout(this.selfReconnectTimer);
      this.selfReconnectTimer = null;
    }

    if (this.selfEventSource) {
      try {
        this.selfEventSource.close();
      } catch {
        // 忽略关闭异常
      }
      this.selfEventSource = null;
      console.log('🛑 [P2PChatService] 已关闭本机消息流连接');
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
   * 【优化】使用更高效的数据转换方式
   */
  async sendImageMessage(imageDataUrl: string): Promise<void> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
    }

    try {
      // 从Data URL中提取Base64数据
      const base64Data = imageDataUrl.split(',')[1];
      
      // 【优化】使用Uint8Array直接转换，避免中间字符串
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      
      // 分块处理，提高性能
      const chunkSize = 8192;
      for (let i = 0; i < binaryString.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, binaryString.length);
        for (let j = i; j < end; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }
      }

      const startTime = performance.now();
      
      await invoke('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '', // 后端会自动填充
        content: '[图片]',
        messageType: 'image',
        imageData: Array.from(bytes),
        peerIps: this.peerIps,
      });
      
      const elapsed = performance.now() - startTime;
      console.log(`✅ [P2PChatService] 图片消息已发送 (耗时: ${elapsed.toFixed(2)}ms, 大小: ${(bytes.length / 1024).toFixed(2)}KB)`);
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
   * 【优化】直接使用JPEG格式，因为前端已经统一转换为JPEG
   */
  private arrayToBase64(data: number[]): string {
    const bytes = new Uint8Array(data);
    let binary = '';
    const chunkSize = 8192; // 分块处理，提高性能
    
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    const base64 = btoa(binary);
    // 前端已统一转换为JPEG格式
    return `data:image/jpeg;base64,${base64}`;
  }
}

export const p2pChatService = new P2PChatService();
