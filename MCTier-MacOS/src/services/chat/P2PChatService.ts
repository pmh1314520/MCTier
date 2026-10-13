/**
 * P2P聊天服务
 * 基于HTTP over WireGuard的点对点聊天
 * 使用SSE(Server-Sent Events)实现事件驱动的消息推送
 * 不依赖中心服务器，直接在虚拟局域网中传输
 */

import { invoke } from '@tauri-apps/api/core';
import type { ChatMessage } from '../../types';
import { isWithinRecallWindow } from './recallPolicy';
import {
  isSafeChatToken,
  isSafeVirtualIp,
  MAX_ANNOUNCEMENT_LENGTH,
  MAX_CHAT_TEXT_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_TODO_ITEMS,
  MAX_TODO_TEXT_LENGTH,
  sanitizeIdentifier,
  sanitizeImageDataUrl,
  sanitizeTodoItems,
  sanitizeUntrustedText,
} from '../../security/trustBoundary';

interface BackendChatMessage {
  id: string;
  player_id: string;
  player_name: string;
  content: string;
  message_type: string;
  timestamp: number;
  image_data?: number[]; // Uint8Array转换为number[]
  recipient_id?: string | null;
}
import { MAX_VOICE_BYTES, voiceMetadata, voiceDataUrl } from './voiceMessage';
import { bytesToImageDataUrl } from './imageData';
import { parseChatAttachment, type ChatAttachment } from './fileAttachment';

// 本机聊天服务器端口（服务器现在仅绑定在虚拟网卡 IP 上，不再监听 0.0.0.0，
// 因此自订阅也必须连接到本机的虚拟 IP，而不是 127.0.0.1）
const CHAT_SERVER_PORT = 14540;

class P2PChatService {
  private selfStreamAbortController: AbortController | null = null;
  private selfReconnectTimer: number | null = null;
  private historyReconcileTimer: number | null = null;
  private historyReconcileInFlight = false;
  private historySince = 0;
  private listeningGeneration = 0;
  private lastFullHistory = 0;
  private streamWatchdog: number | null = null;
  private lastStreamActivity = 0;
  private isListening: boolean = false;
  private onMessageCallback?: (message: ChatMessage) => void;
  private peerIps: string[] = [];
  private currentPlayerId: string = '';
  private myVirtualIp: string = ''; // 本机虚拟IP，用于连接本机聊天服务器
  private chatToken: string = '';
  private seenMessageIds: Set<string> = new Set(); // 基于消息ID去重，避免重复回调
  private reconciledMessageIds: Set<string> = new Set();
  private seenMessageOrder: string[] = []; // 维护去重集合的插入顺序，便于裁剪
  private pendingRecalls: Map<string, string> = new Map();
  private onAvatarCallback?: (playerId: string, avatarData?: string) => void;

  private isSafeImageBytes(value: unknown): value is number[] {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= MAX_IMAGE_BYTES &&
      value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    );
  }

  /**
   * 初始化服务
   */
  initialize(peerIps: string[], currentPlayerId: string, myVirtualIp: string): void {
    // 更新玩家IPs和ID（发送消息时仍需要 peerIps）
    const localIp = isSafeVirtualIp(myVirtualIp) ? myVirtualIp.trim() : '';
    this.peerIps = Array.from(new Set(
      (Array.isArray(peerIps) ? peerIps : [])
        .filter((ip): ip is string => isSafeVirtualIp(ip))
        .map((ip) => ip.trim())
        .filter((ip) => ip !== localIp),
    ));
    this.currentPlayerId = sanitizeIdentifier(currentPlayerId);
    this.myVirtualIp = localIp;

    console.log('✅ [P2PChatService] 初始化完成');
  }

  /**
   * Set the per-lobby credential received from signaling. It is intentionally
   * kept out of URLs and logs; the authenticated SSE stream sends it only as
   * a request header.
   */
  setChatToken(token: unknown): void {
    const nextToken = isSafeChatToken(token) ? token : '';
    if (nextToken === this.chatToken) return;

    const wasListening = this.isListening;
    this.stopListening();
    this.chatToken = nextToken;
    if (wasListening && nextToken) {
      this.startPolling();
    }
  }
  
  /**
   * 重置服务状态（退出大厅时调用）
   */
  reset(): void {
    this.stopListening();
    this.peerIps = [];
    this.currentPlayerId = '';
    this.myVirtualIp = '';
    this.chatToken = '';
    this.onMessageCallback = undefined;
    this.onAvatarCallback = undefined;
    this.seenMessageIds.clear();
    this.reconciledMessageIds.clear();
    this.seenMessageOrder = [];
    this.pendingRecalls.clear();
    this.historySince = 0;
    this.lastFullHistory = 0;
    console.log('🔄 [P2PChatService] 服务已重置');
  }

  /**
   * 设置消息接收回调
   */
  onMessage(callback: (message: ChatMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onAvatar(callback: (playerId: string, avatarData?: string) => void): void {
    this.onAvatarCallback = callback;
  }

  startPolling(): void {
    this.isListening = true;
    void this.connectToSelfStream();
    this.scheduleHistoryReconcile();
    if (!this.streamWatchdog) this.streamWatchdog = window.setInterval(() => {
      if (!this.isListening) return;
      if (this.selfStreamAbortController && Date.now() - this.lastStreamActivity > 45000) {
        this.selfStreamAbortController.abort();
        this.selfStreamAbortController = null;
      }
      if (!this.selfStreamAbortController) void this.connectToSelfStream();
    }, 10000);
  }

  /**
   * SSE is low latency but inherently lossy across reconnects. Reconcile from
   * the authenticated native history endpoint so a message or avatar sent
   * while the stream was being replaced is delivered to the renderer too.
   */
  private scheduleHistoryReconcile(): void {
    if (!this.isListening) return;
    const generation = this.listeningGeneration;
    if (this.historyReconcileTimer) window.clearTimeout(this.historyReconcileTimer);
    this.historyReconcileTimer = window.setTimeout(() => {
      this.historyReconcileTimer = null;
      if (!this.isListening || generation !== this.listeningGeneration) return;
      void this.reconcileHistory().finally(() => {
        if (generation === this.listeningGeneration) this.scheduleHistoryReconcile();
      });
    }, 2500);
  }

  private async reconcileHistory(): Promise<void> {
    if (this.historyReconcileInFlight || !this.isListening || !this.currentPlayerId) return;
    this.historyReconcileInFlight = true;
    const generation = this.listeningGeneration;
    // Timestamps originate on different peers. Periodic full bounded-history
    // reads recover messages missed by a cursor advanced by a faster clock.
    const full = Date.now() - this.lastFullHistory >= 30000;
    try {
      const messages = await invoke<BackendChatMessage[]>('get_p2p_chat_messages', {
        peerIps: this.peerIps,
        since: full ? null : Math.max(0, this.historySince - 2),
      });
      if (!this.isListening || generation !== this.listeningGeneration) return;
      if (!Array.isArray(messages)) return;
      if (full) this.lastFullHistory = Date.now();
      const snapshotIds = full ? new Set<string>() : null;
      for (const message of messages) {
        if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
          this.historySince = Math.max(this.historySince, message.timestamp);
        }
        this.handleMessage(message);
        const id = sanitizeIdentifier(message.id);
        if (this.seenMessageIds.has(id) || this.reconciledMessageIds.has(id)) snapshotIds?.add(id);
      }
      // Multiple peers can contribute more than the rolling 1,000-ID window.
      // Keep the last bounded snapshot too, so full recovery never replays it.
      if (snapshotIds) this.reconciledMessageIds = snapshotIds;
    } catch (error) {
      console.warn('⚠️ [P2PChatService] 聊天历史对账失败:', error instanceof Error ? error.message : '请求失败');
    } finally {
      if (generation === this.listeningGeneration) this.historyReconcileInFlight = false;
    }
  }

  /**
   * 连接到本机聊天服务器的 SSE 流
   */
  private async connectToSelfStream(): Promise<void> {
    if (this.selfStreamAbortController || !this.isListening) return;
    if (!this.myVirtualIp || !isSafeVirtualIp(this.myVirtualIp)) {
      console.warn('⚠️ [P2PChatService] 虚拟IP未就绪，等待后续初始化');
      return;
    }
    // EventSource cannot set a custom header. Refuse an unauthenticated
    // connection instead of falling back to a token-bearing query string.
    if (!isSafeChatToken(this.chatToken)) {
      console.warn('⚠️ [P2PChatService] 聊天认证令牌未就绪，等待信令下发');
      return;
    }

    const streamUrl = `http://${this.myVirtualIp}:${CHAT_SERVER_PORT}/api/chat/stream`;
    const controller = new AbortController();
    this.selfStreamAbortController = controller;
    this.lastStreamActivity = Date.now();
    console.log('📡 [P2PChatService] 连接到本机认证消息流');

    try {
      const response = await fetch(streamUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          'x-mctier-chat-token': this.chatToken,
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`聊天消息流返回 HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('聊天消息流缺少响应体');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (this.isListening && this.selfStreamAbortController === controller) {
        const { done, value } = await reader.read();
        if (controller.signal.aborted || this.selfStreamAbortController !== controller) return;
        if (done) break;
        this.lastStreamActivity = Date.now();
        buffer += decoder.decode(value, { stream: true });
        buffer = this.consumeSseFrames(buffer);
      }
      buffer += decoder.decode();
      if (!controller.signal.aborted && this.selfStreamAbortController === controller) this.consumeSseFrames(buffer);
    } catch (error) {
      if (!controller.signal.aborted && this.isListening) {
        const detail = error instanceof Error ? error.message : '连接失败';
        console.warn(`⚠️ [P2PChatService] 本机消息流连接错误，将重连: ${detail}`);
      }
    } finally {
      if (this.selfStreamAbortController === controller) {
        this.selfStreamAbortController = null;
        if (this.isListening) this.scheduleSelfReconnect();
      }
    }
  }

  private consumeSseFrames(buffer: string): string {
    const frames = buffer.split(/\r?\n\r?\n/);
    const remainder = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data || data === 'keep-alive') continue;
      try {
        this.handleMessage(JSON.parse(data) as BackendChatMessage);
      } catch (error) {
        console.warn('⚠️ [P2PChatService] 忽略无效消息流帧:', error instanceof Error ? error.message : '解析失败');
      }
    }
    return remainder;
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
   * 处理接收到的消息
   */
  private handleMessage(msg: BackendChatMessage): void {
    if (!msg || typeof msg !== 'object') return;

    const messageId = sanitizeIdentifier(msg.id);
    const playerId = sanitizeIdentifier(msg.player_id);
    const messageType = sanitizeIdentifier(msg.message_type, 32).toLowerCase();
    const playerName = sanitizeUntrustedText(msg.player_name, 64).trim();
    const contentLimit = messageType === 'todo' ? MAX_TODO_ITEMS * (MAX_TODO_TEXT_LENGTH + 128) : MAX_CHAT_TEXT_LENGTH;
    const content = messageType === 'avatar'
      ? (msg.content === '' ? '' : sanitizeImageDataUrl(msg.content) ?? '')
      : sanitizeUntrustedText(msg.content, contentLimit);
    const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Number.NaN;

    if (!messageId || !playerId || !Number.isFinite(timestamp) || timestamp < 0) return;
    if (msg.recipient_id && msg.recipient_id !== this.currentPlayerId) return;
    if (!['text', 'image', 'voice', 'file', 'announce', 'voicegroup', 'todo', 'recall', 'avatar'].includes(messageType)) return;
    if (messageType === 'voice' && (!voiceMetadata(content) || !Array.isArray(msg.image_data) || msg.image_data.length === 0 || msg.image_data.length > MAX_VOICE_BYTES || !msg.image_data.every(b => Number.isInteger(b) && b >= 0 && b <= 255))) return;
    if (messageType !== 'announce' && messageType !== 'voicegroup' && messageType !== 'todo' && messageType !== 'recall' && messageType !== 'avatar' && !playerName) return;
    if (messageType === 'image' && !this.isSafeImageBytes(msg.image_data)) return;
    const attachment = messageType === 'file' ? parseChatAttachment(content) : null;
    if (messageType === 'file' && (!attachment || msg.image_data != null)) return;

    const safeMessage: BackendChatMessage = {
      ...msg,
      id: messageId,
      player_id: playerId,
      player_name: playerName,
      content,
      message_type: messageType,
      timestamp,
      image_data: messageType === 'image' || messageType === 'voice' ? msg.image_data : undefined,
    };

    // 控制消息（公告 / 语音小队 / 待办）：不计入聊天，分发到状态后返回
    const mtype = safeMessage.message_type;
    if (
      mtype === 'announce' ||
      mtype === 'voicegroup' ||
      mtype === 'todo' ||
      mtype === 'recall' ||
      mtype === 'avatar'
    ) {
      if (safeMessage.player_id === this.currentPlayerId) return;
      // 按消息 ID 去重：避免对账/SSE 重复投递导致控制消息反复触发（如剪贴板反复弹窗、白板重复笔画）
      if (this.seenMessageIds.has(safeMessage.id) || this.reconciledMessageIds.has(safeMessage.id)) return;
      this.seenMessageIds.add(safeMessage.id);
      this.seenMessageOrder.push(safeMessage.id);
      if (this.seenMessageOrder.length > 1000) {
        const oldest = this.seenMessageOrder.shift();
        if (oldest) this.seenMessageIds.delete(oldest);
      }
      void this.handleControlMessage(mtype, safeMessage);
      return;
    }

    // 跳过自己发送的消息
    if (safeMessage.player_id === this.currentPlayerId) {
      console.log('🚫 [P2PChatService] 跳过自己发送的消息');
      return;
    }

    // 【修复】基于消息ID去重（每条消息ID唯一），避免重复回调；
    // 旧逻辑用“内容相同”去重，会误杀用户连续发送的相同文本（如连续两条“哈哈”）。
    if (this.seenMessageIds.has(safeMessage.id) || this.reconciledMessageIds.has(safeMessage.id)) {
      console.log('🚫 [P2PChatService] 跳过重复消息（ID相同）');
      return;
    }
    this.seenMessageIds.add(safeMessage.id);
    this.seenMessageOrder.push(safeMessage.id);
    // 限制去重集合大小，避免长时间运行内存增长
    if (this.seenMessageOrder.length > 1000) {
      const oldest = this.seenMessageOrder.shift();
      if (oldest) {
        this.seenMessageIds.delete(oldest);
      }
    }

    console.log('✅ [P2PChatService] 接收新消息:', safeMessage.message_type);

    // 转换为前端消息格式
    const chatMessage: ChatMessage = {
      id: safeMessage.id,
      playerId: safeMessage.player_id,
      playerName: safeMessage.player_name,
      content: safeMessage.content,
      timestamp: safeMessage.timestamp * 1000, // 转换为毫秒
      ...(safeMessage.recipient_id ? { recipientId: safeMessage.recipient_id } : {}),
      type: messageType === 'voice' ? 'voice' : safeMessage.message_type === 'image' ? 'image' : messageType === 'file' ? 'file' : 'text',
      imageData: messageType === 'voice' ? voiceDataUrl(safeMessage.image_data!, voiceMetadata(content)!.mime) : safeMessage.image_data ? bytesToImageDataUrl(new Uint8Array(safeMessage.image_data)) : undefined,
      attachment: attachment ?? undefined,
    };
    if (this.pendingRecalls.get(safeMessage.id) === safeMessage.player_id && isWithinRecallWindow(chatMessage.timestamp)) {
      chatMessage.content = '';
      chatMessage.imageData = undefined;
      chatMessage.attachment = undefined;
      chatMessage.type = 'text';
      chatMessage.recalled = true;
      this.pendingRecalls.delete(safeMessage.id);
    }

    // 回调通知新消息
    if (this.onMessageCallback) {
      this.onMessageCallback(chatMessage);
    }

    // The registered UI callback applies conversation/mention notification
    // rules. Do not play the same notification again here.
    if (!this.onMessageCallback && !(window as any).__isInChatRoom__) {
      this.playNewMessageSound();
    }
  }

  /**
   * 处理控制消息（公告 / 语音小队 / 剪贴板 / 待办 / 白板），更新全局状态
   */
  private async handleControlMessage(type: string, msg: BackendChatMessage): Promise<void> {
    try {
      const { useAppStore } = await import('../../stores/appStore');
      const store = useAppStore.getState();
      if (type === 'announce') {
        if (store.hostId && msg.player_id !== store.hostId) return;
        store.setAnnouncement(sanitizeUntrustedText(msg.content, MAX_ANNOUNCEMENT_LENGTH).trim());
      } else if (type === 'voicegroup') {
        const g = Number.parseInt((msg.content ?? '0').trim(), 10);
        store.setPlayerVoiceGroup(msg.player_id, Number.isFinite(g) ? Math.max(0, Math.min(4, g)) : 0);
      } else if (type === 'todo') {
        // 多人协同待办：内容为待办列表 JSON，收到后覆盖本地（后写覆盖），实现全队同步
        try {
          const parsed = JSON.parse(msg.content ?? '[]');
          if (Array.isArray(parsed) && parsed.length <= MAX_TODO_ITEMS) {
            const safeTodos = sanitizeTodoItems(parsed);
            if (safeTodos.length === parsed.length) store.setTodos(safeTodos);
          }
        } catch (e) {
          console.warn('⚠️ [P2PChatService] 解析待办同步内容失败:', e);
        }
      } else if (type === 'recall') {
        const targetId = sanitizeIdentifier(msg.content);
        if (!targetId) return;
        const targetExists = store.chatMessages.some((message) => message.id === targetId);
        if (!store.recallChatMessage(targetId, msg.player_id) && !targetExists) {
          this.pendingRecalls.set(targetId, msg.player_id);
        }
      } else if (type === 'avatar') {
        const avatarData = sanitizeImageDataUrl(msg.content);
        if (avatarData || msg.content === '') this.onAvatarCallback?.(msg.player_id, avatarData);
      }
    } catch (error) {
      console.warn('⚠️ [P2PChatService] 处理控制消息失败:', error);
    }
  }

  /**
   * 发送控制消息（公告/语音小队/待办）
   */
  async sendControlMessage(
    type: 'announce' | 'voicegroup' | 'todo',
    content: string
  ): Promise<void> {
    if (!this.currentPlayerId) return;
    try {
      await invoke('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '',
        content,
        messageType: type,
        imageData: null,
        peerIps: this.peerIps,
      });
    } catch (error) {
      console.error('❌ [P2PChatService] 发送控制消息失败:', error);
    }
  }

  async sendAvatar(avatarData?: string): Promise<void> {
    if (!this.currentPlayerId) return;
    await invoke('send_p2p_chat_message', {
      playerId: this.currentPlayerId,
      playerName: '',
      content: avatarData ?? '',
      messageType: 'avatar',
      imageData: null,
      peerIps: this.peerIps,
    });
  }

  /**
   * 处理新消息音效
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
    this.listeningGeneration++;
    if (this.streamWatchdog) window.clearInterval(this.streamWatchdog);
    this.streamWatchdog = null;

    if (this.selfReconnectTimer) {
      clearTimeout(this.selfReconnectTimer);
      this.selfReconnectTimer = null;
    }
    if (this.selfStreamAbortController) {
      this.selfStreamAbortController.abort();
      this.selfStreamAbortController = null;
      console.log('🛑 [P2PChatService] 已关闭本机消息流连接');
    }
    if (this.historyReconcileTimer) {
      window.clearTimeout(this.historyReconcileTimer);
      this.historyReconcileTimer = null;
    }
    this.historyReconcileInFlight = false;
  }

  /**
   * 发送文本消息，返回送达统计 {delivered, total}
   */
  async sendTextMessage(content: string, messageId?: string, recipientId?: string): Promise<{ delivered: number; total: number }> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
    }

    const safeContent = sanitizeUntrustedText(content, MAX_CHAT_TEXT_LENGTH);
    const safeMessageId = messageId ? sanitizeIdentifier(messageId) : undefined;
    if (!safeContent.trim()) throw new Error('消息内容不能为空');
    if (messageId && !safeMessageId) throw new Error('消息ID无效');

    try {
      const res = await invoke<{ delivered: number; total: number }>('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '', // 后端会自动填充
        content: safeContent,
        messageType: 'text',
        imageData: null,
        messageId: safeMessageId,
        peerIps: this.peerIps,
        recipientId: recipientId || null,
      });
      console.log('✅ [P2PChatService] 文本消息已发送', res);
      return res ?? { delivered: 0, total: 0 };
    } catch (error) {
      console.error('❌ [P2PChatService] 发送文本消息失败:', error);
      throw error;
    }
  }

  async sendVoiceMessage(blob: Blob, duration: number, messageId: string, recipientId?: string) {
    const sessionPlayer = this.currentPlayerId;
    const sessionToken = this.chatToken;
    const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
    if (!sessionPlayer || this.currentPlayerId !== sessionPlayer || this.chatToken !== sessionToken) throw new Error('聊天会话已变化，请重新发送语音');
    return invoke<{ delivered: number; total: number }>('send_p2p_chat_message', {
      playerId: this.currentPlayerId, playerName: '', messageType: 'voice',
      content: JSON.stringify({ mime: blob.type, duration }),
      imageData: data,
      messageId, recipientId: recipientId || null, peerIps: this.peerIps,
    });
  }

  async sendFileMessage(attachment: ChatAttachment, messageId: string, recipientId?: string) {
    const safe = parseChatAttachment(attachment);
    if (!this.currentPlayerId || !safe) throw new Error('文件附件元数据无效');
    return invoke<{ delivered: number; total: number }>('send_p2p_chat_message', {
      playerId: this.currentPlayerId, playerName: '', messageType: 'file',
      content: JSON.stringify(safe), imageData: null, messageId,
      recipientId: recipientId || null, peerIps: this.peerIps,
    });
  }

  /**
   * 发送图片消息（Base64格式）
   * 【优化】使用更高效的数据转换方式
   */
  async sendImageMessage(imageDataUrl: string, content = '[图片]', messageId?: string, recipientId?: string,
    onPrepared?: (image: { imageData?: string; attachment?: ChatAttachment }) => void): Promise<void> {
    if (!this.currentPlayerId) {
      throw new Error('未初始化：缺少玩家ID');
    }

    const sessionPlayer = this.currentPlayerId;
    const sessionToken = this.chatToken;
    if (imageDataUrl.length > Math.ceil(64 * 1024 * 1024 / 3) * 4 + 64) throw new Error('图片超过 64 MiB');
    const source = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(imageDataUrl);
    const safeContent = sanitizeUntrustedText(content, 256).trim() || '[图片]';
    const safeMessageId = messageId ? sanitizeIdentifier(messageId) : undefined;
    if (!source || source[1].length > Math.ceil(64 * 1024 * 1024 / 3) * 4) throw new Error('图片数据格式无效或超过 64 MiB');
    if (messageId && !safeMessageId) throw new Error('消息ID无效');

    try {
      // 从Data URL中提取Base64数据
      const prepared = await invoke<{ imageDataUrl: string | null; attachment: ChatAttachment | null }>('prepare_chat_image', {
        imageData: source[1], recipientId: recipientId || null,
      });
      if (this.currentPlayerId !== sessionPlayer || this.chatToken !== sessionToken) throw new Error('聊天会话已变化，请重新发送图片');
      if (prepared.attachment) {
        const attachment = parseChatAttachment(prepared.attachment);
        if (!attachment) throw new Error('图片附件无效');
        onPrepared?.({ attachment });
        const receipt = await this.sendFileMessage(attachment, messageId || `msg-${this.currentPlayerId}-${Date.now()}`, recipientId);
        if (receipt.total > 0 && receipt.delivered === 0) throw new Error('图片未送达，请检查连接后重试');
        return;
      }
      const safeImageDataUrl = sanitizeImageDataUrl(prepared.imageDataUrl);
      if (!safeImageDataUrl) throw new Error('优化后的图片无效');
      onPrepared?.({ imageData: safeImageDataUrl });
      const base64Data = safeImageDataUrl.split(',')[1];
      
      // 【优化】使用Uint8Array直接转换，避免中间字符串
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
        throw new Error('图片大小超出限制');
      }
      
      // 分块处理，提高性能
      const chunkSize = 8192;
      for (let i = 0; i < binaryString.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, binaryString.length);
        for (let j = i; j < end; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }
      }

      const startTime = performance.now();
      
      const receipt = await invoke<{ delivered: number; total: number }>('send_p2p_chat_message', {
        playerId: this.currentPlayerId,
        playerName: '', // 后端会自动填充
        content: safeContent,
        messageType: 'image',
        imageData: Array.from(bytes),
        messageId: safeMessageId,
        peerIps: this.peerIps,
        recipientId: recipientId || null,
      });
      if (receipt.total > 0 && receipt.delivered === 0) throw new Error('图片未送达，请检查连接后重试');
      
      const elapsed = performance.now() - startTime;
      console.log(`✅ [P2PChatService] 图片消息已发送 (耗时: ${elapsed.toFixed(2)}ms, 大小: ${(bytes.length / 1024).toFixed(2)}KB)`);
    } catch (error) {
      console.error('❌ [P2PChatService] 发送图片消息失败:', error);
      throw error;
    }
  }

  /** 广播撤回控制消息。接收方会校验撤回者是否为原发送者。 */
  async recallMessage(messageId: string, recipientId?: string): Promise<void> {
    if (!this.currentPlayerId) throw new Error('未初始化：缺少玩家ID');
    const targetId = sanitizeIdentifier(messageId);
    if (!targetId) throw new Error('消息ID无效');
    await invoke('send_p2p_chat_message', {
      playerId: this.currentPlayerId,
      playerName: '',
      content: targetId,
      messageType: 'recall',
      imageData: null,
      messageId: `recall-${this.currentPlayerId}-${Date.now()}`,
      peerIps: this.peerIps,
      recipientId: recipientId || null,
    });
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

}

export const p2pChatService = new P2PChatService();
