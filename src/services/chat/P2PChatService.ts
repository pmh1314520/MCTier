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

// 本机聊天服务器端口（服务器现在仅绑定在虚拟网卡 IP 上，不再监听 0.0.0.0，
// 因此自订阅也必须连接到本机的虚拟 IP，而不是 127.0.0.1）
const CHAT_SERVER_PORT = 14540;

class P2PChatService {
  private selfEventSource: EventSource | null = null; // 仅订阅“自己”的消息流
  private selfReconnectTimer: number | null = null;
  private reconcileTimer: number | null = null; // 周期性对账拉取定时器（补偿推送失败的消息）
  private isListening: boolean = false;
  private onMessageCallback?: (message: ChatMessage) => void;
  private peerIps: string[] = [];
  private currentPlayerId: string = '';
  private myVirtualIp: string = ''; // 本机虚拟IP，用于连接本机聊天服务器
  private seenMessageIds: Set<string> = new Set(); // 基于消息ID去重，避免重复回调
  private seenMessageOrder: string[] = []; // 维护去重集合的插入顺序，便于裁剪
  private lastMessageTs: number = 0; // 已处理消息的最大时间戳(秒)，用于断线重连后按 since 补拉

  /**
   * 初始化服务
   */
  initialize(peerIps: string[], currentPlayerId: string, myVirtualIp: string): void {
    // 更新玩家IPs和ID（发送消息时仍需要 peerIps）
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
    // 同时启动周期性对账拉取，作为推送失败/SSE 抖动时的兜底，确保消息最终一致
    this.startReconcileLoop();
  }

  /**
   * 启动周期性对账拉取（关键可靠性保障）
   *
   * 发送方是「一次性 HTTP 推送」，若某次推送因瞬时网络抖动/对端服务器未就绪而失败，
   * 接收方将永久收不到那条消息（SSE 重连补拉只查本机，补不回从未到达的消息）。
   * 由于每个发送方都会把自己发的消息存在本机，这里周期性地从所有 peer 拉取最近窗口的
   * 消息（按已见最大时间戳回退一个窗口），交给 handleMessage（按 ID 去重），
   * 即可把任何推送失败的消息补回来。窗口化拉取避免每轮重复全量传输图片。
   */
  private startReconcileLoop(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = window.setInterval(() => {
      void this.reconcileOnce();
    }, 10000); // 每 10 秒对账一次
  }

  private stopReconcileLoop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  /**
   * 执行一次对账：并发从所有 peer 拉取最近窗口的消息并按 ID 去重补入
   */
  private async reconcileOnce(): Promise<void> {
    const ips = this.peerIps.filter((ip) => ip && ip !== this.myVirtualIp);
    if (ips.length === 0) return;

    // 以「已见最大时间戳」回退 20 秒为窗口，覆盖瞬时失败；ID 去重保证不重复回调。
    const sinceSec = this.lastMessageTs > 20 ? this.lastMessageTs - 20 : 0;

    const collected: BackendChatMessage[] = [];
    await Promise.all(
      ips.map(async (ip) => {
        try {
          const url = `http://${ip}:${CHAT_SERVER_PORT}/api/chat/messages${sinceSec > 0 ? `?since=${sinceSec}` : ''}`;
          const resp = await fetch(url);
          if (!resp.ok) return;
          const msgs: BackendChatMessage[] = await resp.json();
          if (Array.isArray(msgs)) collected.push(...msgs);
        } catch {
          // 单个 peer 拉取失败忽略，下一轮继续
        }
      })
    );

    if (collected.length === 0) return;
    collected.sort((a, b) => a.timestamp - b.timestamp);
    for (const m of collected) {
      this.handleMessage(m);
    }
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

    if (!this.myVirtualIp) {
      console.warn('⚠️ [P2PChatService] 虚拟IP未就绪，稍后重试连接本机消息流');
      this.scheduleSelfReconnect();
      return;
    }

    const streamUrl = `http://${this.myVirtualIp}:${CHAT_SERVER_PORT}/api/chat/stream`;
    console.log(`📡 [P2PChatService] 连接到本机消息流: ${streamUrl}`);

    try {
      const eventSource = new EventSource(streamUrl);

      eventSource.onopen = () => {
        console.log('✅ [P2PChatService] 本机消息流已连接');
        // 断线重连后，按 since 补拉断连期间错过的消息（去重保证不重复回调）
        this.catchUpMissedMessages();
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
        this.scheduleSelfReconnect();
      };

      this.selfEventSource = eventSource;
    } catch (error) {
      console.error('❌ [P2PChatService] 创建本机消息流连接失败:', error);
      this.scheduleSelfReconnect();
    }
  }

  /**
   * 安排在 2 秒后重连本机消息流（仅在仍处于监听状态时）
   */
  private scheduleSelfReconnect(): void {
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
  }

  /**
   * 断线/Lagged 后，从本机服务器按 since 补拉错过的消息，交给 handleMessage（ID去重）
   */
  private async catchUpMissedMessages(): Promise<void> {
    if (!this.myVirtualIp) return;
    try {
      const since = this.lastMessageTs;
      const url = `http://${this.myVirtualIp}:${CHAT_SERVER_PORT}/api/chat/messages${since > 0 ? `?since=${since}` : ''}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const msgs: BackendChatMessage[] = await resp.json();
      if (Array.isArray(msgs) && msgs.length > 0) {
        console.log(`🔁 [P2PChatService] 重连补拉到 ${msgs.length} 条消息`);
        // 按时间戳升序处理，保证顺序
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        for (const m of msgs) {
          this.handleMessage(m);
        }
      }
    } catch (error) {
      console.warn('⚠️ [P2PChatService] 补拉消息失败（忽略）:', error);
    }
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(msg: BackendChatMessage): void {
    // 记录已见到的最大时间戳(秒)，用于重连后按 since 补拉
    if (msg.timestamp && msg.timestamp > this.lastMessageTs) {
      this.lastMessageTs = msg.timestamp;
    }

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

    this.stopReconcileLoop();

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
   * 同步聊天历史：从各 peer 的本机服务器拉取消息历史，聚合进本地。
   * 由于消息 ID 现已全局一致 + handleMessage 按 ID 去重并跳过自己的消息，
   * 从多个 peer 聚合不会产生重复。常用于新加入大厅的玩家补齐进房前的聊天记录。
   */
  async syncHistory(peerIps?: string[]): Promise<void> {
    const ips = (peerIps ?? this.peerIps).filter((ip) => ip && ip !== this.myVirtualIp);
    if (ips.length === 0) return;
    console.log('🗂️ [P2PChatService] 开始同步聊天历史，来源:', ips);

    const all: BackendChatMessage[] = [];
    await Promise.all(
      ips.map(async (ip) => {
        try {
          const resp = await fetch(`http://${ip}:${CHAT_SERVER_PORT}/api/chat/messages`);
          if (!resp.ok) return;
          const msgs: BackendChatMessage[] = await resp.json();
          if (Array.isArray(msgs)) all.push(...msgs);
        } catch {
          // 单个 peer 拉取失败忽略
        }
      })
    );

    if (all.length === 0) return;
    // 按时间戳升序，保证历史顺序；handleMessage 内部按 ID 去重
    all.sort((a, b) => a.timestamp - b.timestamp);
    for (const m of all) {
      this.handleMessage(m);
    }
    console.log(`🗂️ [P2PChatService] 历史同步完成，处理 ${all.length} 条（去重后回调新消息）`);
  }

  /**
   * 发送文本消息，返回送达统计 {delivered, total}
   */
  async sendTextMessage(content: string): Promise<{ delivered: number; total: number }> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
    }

    try {
      const res = await invoke<{ delivered: number; total: number }>('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '', // 后端会自动填充
        content,
        messageType: 'text',
        imageData: null,
        peerIps: this.peerIps,
      });
      console.log('✅ [P2PChatService] 文本消息已发送', res);
      return res ?? { delivered: 0, total: 0 };
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
