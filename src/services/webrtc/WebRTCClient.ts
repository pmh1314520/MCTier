/**
 * WebRTC 客户端服务
 * 处理 P2P 音频连接和数据通道
 */

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { fileShareService } from '../fileShare/FileShareService';
import { fileTransferService } from '../fileShare/FileTransferService';
import { audioDevices } from '../voice/audioDevices';
import { tl } from '../../i18n';
import { voiceChangerService } from '../voice/voiceChangerService';
import { localVqeService } from '../voice/localVqeService';
import { appVersion, loadAppVersion } from '../version/appVersion';
import { p2pChatService } from '../chat/P2PChatService';
import {
  isSafeChatToken,
  isSafeIdentifier,
  isSafeResourceId,
  isSafeSessionId,
  isSafeServerNode,
  isSafeSignalingServer,
  isSafeVirtualDomain,
  isSafeVirtualIp,
  MAX_ANNOUNCEMENT_LENGTH,
  MAX_CHAT_TEXT_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MAX_PATH_SEGMENT_LENGTH,
  sanitizeIdentifier,
  sanitizeUntrustedText,
} from '../../security/trustBoundary';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'player-joined' | 'player-left' | 'status-update' | 'heartbeat' | 'chat-message';
  from?: string;
  to?: string;
  sdp?: string;
  candidate?: string;
  playerId?: string;
  playerName?: string;
  micEnabled?: boolean;
  timestamp?: number;
  content?: string;
  messageId?: string;
}

export interface PeerConnection {
  id: string;
  connection: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  fileTransferChannel?: RTCDataChannel; // 专用文件传输通道
  audioStream?: MediaStream;
  audioElement?: HTMLAudioElement;
  iceCandidateQueue: RTCIceCandidate[]; // ICE候选队列
  remoteDescriptionSet: boolean; // 远程描述是否已设置
  connectionTimeout?: number; // 连接超时定时器
  isNegotiating: boolean; // 是否正在协商中
  createdAt: number; // 连接创建时间
}

interface ChatPeerPayload {
  player_id: string;
  player_name: string;
  virtual_ip: string;
}

/**
 * WebRTC 客户端类
 */
export class WebRTCClient {
  private localStream: MediaStream | null = null;
  private rawMicStream: MediaStream | null = null;
  private peerConnections: Map<string, PeerConnection> = new Map();
  private localPlayerId: string = '';
  private localPlayerName: string = '';
  private lobbyName: string = '';
  private lobbyPassword: string = '';
  private heartbeatInterval: number | null = null;
  private websocket: WebSocket | null = null;
  private websocketHeartbeatInterval: number | null = null; // WebSocket 心跳定时器
  private websocketPongTimeout: number | null = null; // WebSocket pong 超时定时器
  private reconnectAttempts: number = 0;
  private reconnectTimeout: number | null = null;
  private websocketStableTimer: number | null = null;
  private websocketReconnectInFlight: boolean = false;
  private isIntentionalDisconnect: boolean = false;
  private reconnectingPeers: Set<string> = new Set();
  private reconnectTimers: Map<string, number> = new Map();
  private voiceHealthInterval: number | null = null;
  private voiceHealthCheckRunning = false;
  private voiceHealth: Map<string, { packets: number; noProgressSince: number }> = new Map();
  /** 正在进行「手动语音重连」的玩家，用于防止重复点击并驱动 UI 的加载态 */
  private manualReconnectingPeers: Set<string> = new Set();
  /** 麦克风的期望状态（界面/后端要求的状态） */
  private desiredMicEnabled: boolean = false;
  /** 麦克风的实际生效状态（音轨层面），用于与期望状态比对收敛 */
  private micActuallyEnabled: boolean = false;
  /** 麦克风开关操作的串行队列，避免快速连续切换时交叠执行导致状态错乱 */
  private micOpChain: Promise<void> = Promise.resolve();
  private knownPlayers: Set<string> = new Set();
  private pendingPlayerLeaveTimers: Map<string, number> = new Map();
  private playerLeaveResyncTimers: Map<string, number> = new Map();
  private authoritativePlayers: Set<string> = new Set();
  private authoritativeSnapshotVersion: number = 0;
  private websocketMessageQueue: Promise<void> = Promise.resolve();
  // 记录每个玩家的虚拟域名（playerId -> virtualDomain），
  // 因为信令服务器的 player-left 只携带 playerId，离开时需据此清理 hosts 映射
  private playerDomains: Map<string, string> = new Map();
  private readonly transientLeaveConfirmMs: number = 3000; // 减少到3秒，加快响应速度

  // ICE 服务器配置
  //
  // 【稳定性修复】MCTier 的所有成员都处于同一个 EasyTier 虚拟局域网（同一虚拟子网），
  // 彼此通过虚拟网卡的内网 IP（如 10.x.x.x）即可直连，本质上不需要公网 STUN 做 NAT 穿透。
  // 旧配置使用 Google 的 STUN（stun.l.google.com），在国内被墙：
  //   - 每次建立 / 重连 ICE 都要等它超时，拖慢连接、加剧断连重连；
  //   - 还可能选中不稳定的公网反射候选路径，导致语音忽断忽续。
  // 这里清空公网 STUN，只使用 host 候选，让连接固定走稳定的虚拟局域网直连路径。
  private iceServers: RTCIceServer[] = [];
  
  // 虚拟IP地址
  private virtualIp: string | null = null;
  
  // 虚拟域名
  private virtualDomain: string | null = null;
  
  // 是否使用域名访问
  private useDomain: boolean = false;
  
  // 信令服务器地址（创建者的虚拟IP）
  private signalingServerUrl: string = '';
  private chatToken: string = '';
  private chatTokenEpoch: number = 0;
  private chatHostId: string | undefined;
  private chatPeers: Map<string, ChatPeerPayload> = new Map();

  // 事件回调
  private onPlayerJoinedCallback?: (playerId: string, playerName: string, virtualIp?: string, virtualDomain?: string, useDomain?: boolean) => void;
  private onPlayerLeftCallback?: (playerId: string) => void;
  private onStatusUpdateCallback?: (playerId: string, micEnabled: boolean) => void;
  private onRemoteStreamCallback?: (playerId: string, stream: MediaStream) => void;
  private onLocalStreamCallback?: (stream: MediaStream | null) => void;
  private onChatMessageCallback?: (playerId: string, playerName: string, content: string, timestamp: number) => void;
  private onVersionErrorCallback?: (currentVersion: string, minimumVersion: string, downloadUrl: string) => void;
  // 房主/大厅管理相关回调
  private onLobbyMetaCallback?: (meta: { hostId?: string; maxPlayers?: number | null; isPublic?: boolean; mutedPlayers?: string[] }) => void;
  private onHostChangedCallback?: (hostId: string) => void;
  private onMuteChangedCallback?: (playerId: string, muted: boolean) => void;
  private onLobbyOptionsChangedCallback?: (maxPlayers: number | null, isPublic: boolean) => void;
  private onKickedCallback?: (reason: string) => void;
  // WebSocket 可能在 initialize() 返回前就推送首批玩家列表；先缓存，待 UI 注册回调后补发。
  private pendingPlayerJoined: Map<string, {
    playerName: string;
    virtualIp?: string;
    virtualDomain?: string;
    useDomain?: boolean;
  }> = new Map();

  /**
   * 初始化 WebRTC 客户端
   */
  async initialize(playerId: string, playerName: string, lobbyName: string, lobbyPassword: string, virtualDomain?: string, useDomain?: boolean, signalingServer?: string): Promise<void> {
    try {
      const safePlayerId = isSafeIdentifier(playerId) ? playerId : '';
      const safePlayerName = sanitizeUntrustedText(playerName, MAX_PLAYER_NAME_LENGTH).trim();
      const safeLobbyName = sanitizeUntrustedText(lobbyName, 128).trim();
      const safeLobbyPassword = sanitizeUntrustedText(lobbyPassword, 256);
      const safeVirtualDomain = isSafeVirtualDomain(virtualDomain) ? virtualDomain.trim() : undefined;
      const safeSignalingServer = signalingServer?.trim() || 'wss://mctier.pmhs.top/signaling';
      if (!safePlayerId || !safePlayerName || !safeLobbyName || !isSafeSignalingServer(safeSignalingServer)) {
        throw new Error('WebRTC 初始化参数无效');
      }

      console.log('🚀 开始初始化 WebRTC 客户端...');
      console.log('已读取 WebRTC 身份参数');
      
      // 重置麦克风的期望/实际状态，避免上一次大厅的残留状态导致本次关麦被误判为"无需操作"
      this.desiredMicEnabled = false;
      this.micActuallyEnabled = false;
      this.chatToken = '';
      this.chatTokenEpoch = 0;
      this.chatHostId = undefined;
      this.chatPeers.clear();
      p2pChatService.setChatToken(undefined);

      // 重置 Store 的语音状态为默认值
      try {
        const { useAppStore } = await import('../../stores');
        const store = useAppStore.getState();
        store.setMicEnabled(false);
        store.setGlobalMuted(false);
        // 清空静音列表
        store.clearPlayers(); // 这会同时清空 mutedPlayers
        console.log('✅ Store 语音状态已重置为默认值');
      } catch (error) {
        console.warn('⚠️ 重置 Store 语音状态失败:', error);
      }
      
      // 如果已经初始化过，先清理
      if (this.websocket || this.localStream || this.peerConnections.size > 0) {
        console.warn('⚠️ 检测到已存在的WebRTC实例，先进行清理...');
        await this.cleanup();
        // 等待一小段时间，确保清理完成
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      this.localPlayerId = safePlayerId;
      this.localPlayerName = safePlayerName;
      this.lobbyName = safeLobbyName;
      this.lobbyPassword = safeLobbyPassword;
      this.virtualDomain = safeVirtualDomain || null;
      this.useDomain = useDomain === true && !!safeVirtualDomain;
      
      // 重置断开标志和重连相关状态
      this.isIntentionalDisconnect = false;
      this.reconnectAttempts = 0;
      this.websocketReconnectInFlight = false;
      this.reconnectingPeers.clear();
      this.reconnectTimers.forEach(timer => clearTimeout(timer));
      this.reconnectTimers.clear();
      this.authoritativePlayers.clear();
      this.authoritativeSnapshotVersion = 0;
      this.websocketMessageQueue = Promise.resolve();
      this.startVoiceHealthMonitor();
      
      // 【优化】只在首次初始化时清空已知玩家列表
      // 信令服务器重连时不应该清空，避免重复建立连接
      this.knownPlayers.clear();
      this.playerDomains.clear();
      this.clearAllPendingPlayerLeaves();

      // 获取虚拟IP
      console.log('正在获取虚拟IP...');
      try {
        const virtualIp = await invoke<string | null>('get_virtual_ip');
        if (virtualIp) {
          if (!isSafeVirtualIp(virtualIp)) {
            throw new Error('虚拟IP无效');
          }
          this.virtualIp = virtualIp.trim();
          console.log('✅ 虚拟IP:', this.virtualIp);
        } else {
          console.warn('⚠️ 未获取到虚拟IP，WebRTC可能无法正常工作');
        }
      } catch (error) {
        console.error('❌ 获取虚拟IP失败:', error);
      }

      // 设置信令服务器地址（优先使用传入的参数，否则使用默认值）
      // 预取版本号：注册消息在 onopen 同步回调中发送，无法 await（见 src/services/version/appVersion.ts）
      await loadAppVersion();

      this.signalingServerUrl = safeSignalingServer;
      console.log('📡 连接到信令服务器:', this.signalingServerUrl);

      // 不再在初始化时获取麦克风，只有在用户开启麦克风时才获取
      console.log('⏭️ 跳过麦克风初始化，等待用户手动开启');
      // Warm LocalVQE after joining without requesting microphone permission.
      // The first open-mic action can then attach a track immediately.
      void localVqeService.preload().catch((error) => {
        console.warn('LocalVQE preload failed; WebRTC capture AEC/NS remains active:', error);
      });
      this.localStream = null;

      // 连接到WebSocket信令服务器（带重试，缓解二次加入时的瞬时 DNS 解析失败）
      console.log('正在连接到WebSocket信令服务器...');
      await this.connectToSignalingServerWithRetry();
      console.log('✅ 已连接到WebSocket信令服务器');

      // 监听后端信令消息（保留用于状态更新等）
      console.log('正在设置后端事件监听器...');
      await this.setupBackendListeners();
      console.log('✅ 后端事件监听器设置成功');

      // 启动心跳
      console.log('正在启动心跳...');
      this.startHeartbeat();
      console.log('✅ 心跳已启动');

      // 初始化屏幕共享服务
      console.log('正在初始化屏幕共享服务...');
      try {
        const { screenShareService } = await import('../screenShare/ScreenShareService');
        if (this.websocket) {
          screenShareService.initialize(this.localPlayerId, this.localPlayerName, this.websocket);
          console.log('✅ 屏幕共享服务初始化成功');
        }
      } catch (error) {
        console.error('❌ 屏幕共享服务初始化失败:', error);
        // 不中断流程，屏幕共享是可选功能
      }

      try {
        const { remoteControlService } = await import('../remoteControl/RemoteControlService');
        if (this.websocket) {
          remoteControlService.initialize(this.localPlayerId, this.localPlayerName, this.websocket);
          console.log('✅ 远程控制服务初始化成功');
        }
      } catch (error) {
        console.error('❌ 远程控制服务初始化失败:', error);
      }

      console.log('✅ WebRTC 客户端初始化完成');
    } catch (error) {
      console.error('❌ WebRTC 初始化失败:', error);
      // 清理已创建的资源
      await this.cleanup();
      throw new Error(tl(`无法初始化语音系统: ${error}`, `Failed to initialize the voice system: ${error}`));
    }
  }

  /**
   * 连接信令服务器（带重试）
   * 二次加入大厅时，虚拟网卡的 Magic DNS 可能短暂影响公网域名解析，
   * 导致信令域名出现 ERR_NAME_NOT_RESOLVED，这里做有限次重试以自愈。
   */
  private async connectToSignalingServerWithRetry(maxAttempts = 3): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.connectToSignalingServer();
        return;
      } catch (e) {
        lastErr = e;
        console.warn(`⚠️ 第 ${attempt}/${maxAttempts} 次连接信令服务器失败:`, e);
        // 清理失败的连接，避免句柄残留
        try {
          if (this.websocket) {
            this.websocket.onopen = null;
            this.websocket.onmessage = null;
            this.websocket.onerror = null;
            this.websocket.onclose = null;
            this.websocket.close();
            this.websocket = null;
          }
        } catch { /* ignore */ }
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('无法连接到信令服务器');
  }

  /**
   * 连接到WebSocket信令服务器
   */
  private async connectToSignalingServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('正在连接到信令服务器');
        
        const socket = new WebSocket(this.signalingServerUrl);
        let hasOpened = false;
        this.websocket = socket;
        
        this.websocket.onopen = () => {
          if (this.websocket !== socket) return;
          hasOpened = true;
          console.log('✅ 已连接到信令服务器');
          
          // 注册到服务器
          if (this.websocket) {
            this.websocket.send(JSON.stringify({
              type: 'register',
              clientId: this.localPlayerId,
              playerName: this.localPlayerName,
              virtualIp: this.virtualIp,
              virtualDomain: this.virtualDomain,
              useDomain: this.useDomain,
              lobbyName: this.lobbyName,
              lobbyPassword: this.lobbyPassword,
              clientVersion: appVersion(),
            }));
            console.log('📤 已发送注册消息');
          }
          
          // 启动 WebSocket 心跳保活
          this.startWebSocketHeartbeat();
          if (this.websocketStableTimer !== null) clearTimeout(this.websocketStableTimer);
          this.websocketStableTimer = window.setTimeout(() => {
            if (this.websocket === socket) this.reconnectAttempts = 0;
            this.websocketStableTimer = null;
          }, 6000);
          
          resolve();
        };
        
        this.websocket.onmessage = (event) => {
          if (this.websocket !== socket) return;
          try {
            if (typeof event.data !== 'string' || event.data.length > 512 * 1024) return;
            const message = JSON.parse(event.data);
            this.websocketMessageQueue = this.websocketMessageQueue
              .then(() => this.handleWebSocketMessage(message))
              .catch((error) => console.error('WebSocket message processing failed:', error));
          } catch (error) {
            console.error('❌ 解析WebSocket消息失败:', error);
          }
        };
        
        this.websocket.onerror = (error) => {
          if (this.websocket !== socket) return;
          console.error('❌ WebSocket连接错误:', error);
          if (!hasOpened) reject(new Error('无法连接到信令服务器'));
        };
        
        this.websocket.onclose = () => {
          if (this.websocket !== socket) return;
          this.websocket = null;
          this.resetRemoteControlOnSignalingDisconnect();
          if (this.websocketStableTimer !== null) {
            clearTimeout(this.websocketStableTimer);
            this.websocketStableTimer = null;
          }
          console.log('⚠️ 与信令服务器的连接已断开');
          
          // 停止 WebSocket 心跳
          this.stopWebSocketHeartbeat();
          
          // 如果不是主动断开，尝试重连
          if (this.isIntentionalDisconnect) {
            return;
          }

          if (!hasOpened) {
            reject(new Error('信令服务器在连接建立前断开'));
            return;
          }

          if (!this.isIntentionalDisconnect) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * this.reconnectAttempts, 5000); // 线性退避，最多5秒
            console.log(`🔄 将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
            if (this.reconnectTimeout !== null) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = window.setTimeout(() => {
              this.reconnectTimeout = null;
              void this.reconnectWebSocket();
            }, delay);
          }
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }

  private sendRegistration(): boolean {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return false;
    return this.sendWebSocketMessage({
      type: 'register',
      clientId: this.localPlayerId,
      playerName: this.localPlayerName,
      virtualIp: this.virtualIp,
      virtualDomain: this.virtualDomain,
      useDomain: this.useDomain,
      lobbyName: this.lobbyName,
      lobbyPassword: this.lobbyPassword,
      clientVersion: appVersion(),
    });
  }

  /**
   * 重连WebSocket
   */
  private async reconnectWebSocket(): Promise<void> {
    if (this.isIntentionalDisconnect || this.websocketReconnectInFlight) return;
    this.websocketReconnectInFlight = true;
    try {
      console.log('🔄 正在重连WebSocket...');
      
      // 清理旧的WebSocket连接
      if (this.websocket) {
        this.resetRemoteControlOnSignalingDisconnect();
        this.websocket.onopen = null;
        this.websocket.onmessage = null;
        this.websocket.onerror = null;
        this.websocket.onclose = null;
        
        if (this.websocket.readyState === WebSocket.OPEN || this.websocket.readyState === WebSocket.CONNECTING) {
          this.websocket.close();
        }
        this.websocket = null;
      }
      
      // 重新连接
      await this.connectToSignalingServer();

      // 刷新屏幕共享服务使用的WebSocket
      try {
        const { screenShareService } = await import('../screenShare/ScreenShareService');
        if (this.websocket) {
          screenShareService.initialize(this.localPlayerId, this.localPlayerName, this.websocket);
          console.log('✅ 屏幕共享服务WebSocket已刷新');
        }
      } catch (error) {
        console.error('❌ 刷新屏幕共享服务WebSocket失败:', error);
      }

      // 刷新远程控制服务使用的WebSocket
      try {
        const { remoteControlService } = await import('../remoteControl/RemoteControlService');
        if (this.websocket) {
          remoteControlService.initialize(this.localPlayerId, this.localPlayerName, this.websocket);
        }
      } catch (error) {
        console.error('❌ 刷新远程控制服务WebSocket失败:', error);
      }
      
      console.log('✅ WebSocket重连成功');
      
    } catch (error) {
      console.error('❌ WebSocket重连失败:', error);
      
      // 如果还没达到最大重连次数，继续尝试
      if (!this.isIntentionalDisconnect) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
        console.log(`🔄 将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
        
        if (this.reconnectTimeout !== null) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = window.setTimeout(() => {
          this.reconnectTimeout = null;
          void this.reconnectWebSocket();
        }, delay);
      }
    } finally {
      this.websocketReconnectInFlight = false;
    }
  }

  private clearPendingPlayerLeave(playerId: string): boolean {
    const pendingTimer = this.pendingPlayerLeaveTimers.get(playerId);
    const resyncTimer = this.playerLeaveResyncTimers.get(playerId);
    const hadPendingConfirmation = pendingTimer !== undefined || resyncTimer !== undefined;
    if (resyncTimer !== undefined) {
      clearTimeout(resyncTimer);
      this.playerLeaveResyncTimers.delete(playerId);
    }
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      this.pendingPlayerLeaveTimers.delete(playerId);
    }
    return hadPendingConfirmation;
  }

  private clearAllPendingPlayerLeaves(): void {
    this.pendingPlayerLeaveTimers.forEach((timer) => clearTimeout(timer));
    this.pendingPlayerLeaveTimers.clear();
    this.playerLeaveResyncTimers.forEach((timer) => clearTimeout(timer));
    this.playerLeaveResyncTimers.clear();
  }

  private schedulePlayerLeaveConfirmation(playerId: string): boolean {
    if (!playerId || this.isIntentionalDisconnect) return false;

    this.clearPendingPlayerLeave(playerId);
    const confirmTimer = window.setTimeout(() => {
      this.pendingPlayerLeaveTimers.delete(playerId);
      if (!this.knownPlayers.has(playerId)) return;

      const snapshotBefore = this.authoritativeSnapshotVersion;
      if (!this.sendRegistration()) {
        this.schedulePlayerLeaveConfirmation(playerId);
        return;
      }

      const resyncTimer = window.setTimeout(() => {
        this.playerLeaveResyncTimers.delete(playerId);
        if (!this.knownPlayers.has(playerId)) return;
        if (this.authoritativeSnapshotVersion > snapshotBefore && this.authoritativePlayers.has(playerId)) {
          this.clearPendingPlayerLeave(playerId);
          return;
        }
        this.schedulePlayerLeaveConfirmation(playerId);
      }, 6000);
      this.playerLeaveResyncTimers.set(playerId, resyncTimer);
    }, this.transientLeaveConfirmMs);

    this.pendingPlayerLeaveTimers.set(playerId, confirmTimer);
    return true;
  }

  private async removeConfirmedPlayer(playerId: string, virtualDomain?: string): Promise<void> {
    if (!this.knownPlayers.has(playerId)) return;

    this.clearPendingPlayerLeave(playerId);
    this.resetRemoteControlForPeer(playerId);
    try {
      const { audioService } = await import('../audio/AudioService');
      await audioService.play('userLeft');
    } catch (error) {
      console.error('播放玩家离开音效失败:', error);
    }

    const leftDomain = virtualDomain || this.playerDomains.get(playerId);
    if (leftDomain) {
      try {
        await invoke('remove_player_domain', { domain: leftDomain });
      } catch (error) {
        console.error(`删除玩家域名映射失败 (${leftDomain}):`, error);
      }
    }

    this.playerDomains.delete(playerId);
    fileShareService.handlePlayerLeft(playerId);
    this.knownPlayers.delete(playerId);
    this.removePeer(playerId);

    try {
      const { screenShareService } = await import('../screenShare/ScreenShareService');
      screenShareService.handlePlayerLeft(playerId);
    } catch (error) {
      console.error('清理离线玩家的屏幕共享中继失败:', error);
    }
  }

  private isPeerConnectedOrFresh(peer?: PeerConnection): boolean {
    if (!peer) return false;
    const state = peer.connection.connectionState;
    if (state === 'connected') return true;
    return state === 'connecting' && Date.now() - peer.createdAt < 15000;
  }

  private isExpectedChannelCloseError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const rtcError = (error as { error?: { message?: string } }).error;
    const message = rtcError?.message || '';
    return message.includes('User-Initiated Abort') || message.includes('on-close called');
  }

  private resetRemoteControlOnSignalingDisconnect(): void {
    void import('../remoteControl/RemoteControlService')
      .then(({ remoteControlService }) => remoteControlService.handleSignalingDisconnected())
      .catch((error) => console.error('清理信令断线后的远程控制会话失败:', error));
  }

  private resetRemoteControlForPeer(peerId: string): void {
    void import('../remoteControl/RemoteControlService')
      .then(({ remoteControlService }) => remoteControlService.handlePeerLeft(peerId))
      .catch((error) => console.error(`清理离线玩家 ${peerId} 的远程控制会话失败:`, error));
  }

  private isKnownPlayer(playerId: unknown, includeLocal = true): playerId is string {
    if (!isSafeIdentifier(playerId)) return false;
    const normalized = playerId;
    if (includeLocal && normalized === this.localPlayerId) return true;
    return this.knownPlayers.has(normalized);
  }

  private authenticatedPeerId(message: unknown, requireTarget = true): string | null {
    if (!message || typeof message !== 'object') return null;
    const input = message as Record<string, unknown>;
    const from = input.from;
    const to = input.to;
    if (!isSafeIdentifier(from) || from === this.localPlayerId || !this.knownPlayers.has(from)) {
      return null;
    }
    if (requireTarget && to !== this.localPlayerId) return null;
    if (!requireTarget && input.to !== undefined && to !== this.localPlayerId) {
      return null;
    }
    return from;
  }

  private safeRouteVersion(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000
      ? value
      : undefined;
  }

  private safeViewerCount(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value)
      ? Math.max(0, Math.min(100_000, value))
      : 0;
  }

  private safeScreenShareId(value: unknown): string | null {
    return isSafeResourceId(value) ? value : null;
  }

  private safeFileShareId(value: unknown): string | null {
    return isSafeResourceId(value) ? value : null;
  }

  private authenticatedSession(message: unknown): { peerId: string; sessionId: string } | null {
    const peerId = this.authenticatedPeerId(message);
    if (!peerId || !message || typeof message !== 'object') return null;
    const sessionId = (message as Record<string, unknown>).sessionId;
    return isSafeSessionId(sessionId) ? { peerId, sessionId } : null;
  }

  private isSafeSessionDescription(value: unknown, expectedType: 'offer' | 'answer'): value is RTCSessionDescriptionInit {
    if (!value || typeof value !== 'object') return false;
    const input = value as Record<string, unknown>;
    return input.type === expectedType && typeof input.sdp === 'string' && input.sdp.length > 0 && input.sdp.length <= 256 * 1024;
  }

  private isSafeIceCandidate(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const input = value as Record<string, unknown>;
    if (typeof input.candidate !== 'string' || input.candidate.length === 0 || input.candidate.length > 16 * 1024) return false;
    if (
      input.sdpMLineIndex != null &&
      (typeof input.sdpMLineIndex !== 'number' ||
        !Number.isSafeInteger(input.sdpMLineIndex) ||
        input.sdpMLineIndex < 0 ||
        input.sdpMLineIndex > 256)
    ) return false;
    return input.sdpMid == null || (typeof input.sdpMid === 'string' && input.sdpMid.length <= 128);
  }

  private parseChatPeer(raw: unknown): ChatPeerPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const input = raw as Record<string, unknown>;
    const playerId = input.playerId;
    const playerName = sanitizeUntrustedText(input.playerName, MAX_PLAYER_NAME_LENGTH).trim();
    const virtualIp = isSafeVirtualIp(input.virtualIp) ? input.virtualIp.trim() : '';
    if (
      !isSafeIdentifier(playerId) ||
      !playerName ||
      !virtualIp ||
      playerId === this.localPlayerId ||
      virtualIp === this.virtualIp
    ) {
      return null;
    }
    return { player_id: playerId, player_name: playerName, virtual_ip: virtualIp };
  }

  private chatPeerSnapshot(): ChatPeerPayload[] {
    return Array.from(this.chatPeers.values()).sort((left, right) =>
      left.player_id.localeCompare(right.player_id),
    );
  }

  private refreshP2PChatFrontend(): void {
    if (!this.virtualIp || !this.localPlayerId) return;
    const peers = this.chatPeerSnapshot();
    p2pChatService.initialize(
      peers.map((peer) => peer.virtual_ip),
      this.localPlayerId,
      this.virtualIp,
    );
    p2pChatService.setChatToken(this.chatToken || undefined);
  }

  private async configureChatSession(): Promise<void> {
    if (
      !this.chatToken ||
      this.chatTokenEpoch <= 0 ||
      !this.localPlayerId ||
      !this.localPlayerName ||
      !this.virtualIp
    ) {
      return;
    }
    const peers = this.chatPeerSnapshot();
    await invoke('configure_p2p_chat', {
      chatToken: this.chatToken,
      chatTokenEpoch: this.chatTokenEpoch,
      playerId: this.localPlayerId,
      playerName: this.localPlayerName,
      hostId: this.chatHostId,
      peers,
    });
    this.refreshP2PChatFrontend();
  }

  private async syncChatPeers(): Promise<void> {
    if (!this.chatToken || this.chatTokenEpoch <= 0) return;
    await invoke('update_p2p_chat_peers', {
      hostId: this.chatHostId,
      peers: this.chatPeerSnapshot(),
    });
    this.refreshP2PChatFrontend();
  }

  private acceptChatToken(token: unknown, epoch: unknown): 'accepted' | 'unchanged' | 'stale' | 'rejected' {
    if (!isSafeChatToken(token)) return 'rejected';
    const numericEpoch =
      typeof epoch === 'number' && Number.isSafeInteger(epoch) && epoch > 0 ? epoch : 0;
    if (numericEpoch === 0) return 'rejected';
    if (numericEpoch < this.chatTokenEpoch) return 'stale';
    if (numericEpoch === this.chatTokenEpoch && this.chatToken && token !== this.chatToken) {
      console.error('拒绝同一聊天 epoch 的不一致令牌');
      return 'rejected';
    }
    if (numericEpoch === this.chatTokenEpoch && token === this.chatToken) return 'unchanged';

    this.chatToken = token;
    this.chatTokenEpoch = numericEpoch;
    p2pChatService.setChatToken(token);
    return 'accepted';
  }

  private async failClosedChatSession(context: string, error?: unknown): Promise<void> {
    console.error(`${context}，关闭本地聊天/文件认证服务`, error);
    this.chatToken = '';
    this.chatTokenEpoch = 0;
    this.chatHostId = undefined;
    this.chatPeers.clear();
    p2pChatService.reset();
    try {
      await invoke('stop_p2p_chat');
    } catch (stopError) {
      console.error('清理本地聊天/文件认证服务失败:', stopError);
    }
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.close(1011, 'chat-auth-sync-failed');
    }
  }

  /**
   * 处理WebSocket消息
   */
  private async handleWebSocketMessage(message: any): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const messageType = sanitizeIdentifier(message.type, 64);
    if (!messageType) return;
    console.log(`📨 收到WebSocket消息: ${messageType}`);

    // 【健壮性】收到任何服务器消息都视为连接存活，重置 pong 超时，
    // 避免有正常流量时因 pong 偶尔延迟而误判断线重连
    this.handleWebSocketPong();

    try {
      switch (messageType) {
        case 'pong':
          // 收到 pong 响应（上方已重置超时，这里仅用于明确分支）
          break;
          
        case 'register-success':
          // 注册成功
          const registeredHostId = isSafeIdentifier(message.hostId) ? message.hostId : undefined;
          this.chatHostId = registeredHostId;
          const initialTokenStatus = this.acceptChatToken(
            message.chatToken,
            message.chatTokenEpoch,
          );
          if (initialTokenStatus === 'rejected' || initialTokenStatus === 'stale') {
            await this.failClosedChatSession('注册响应中的聊天认证状态无效');
            break;
          }
          if (this.authoritativeSnapshotVersion > 0) {
            try {
              await this.configureChatSession();
            } catch (error) {
              await this.failClosedChatSession('恢复聊天会话失败', error);
              break;
            }
          }
          console.log('✅ 注册成功');
          // 携带房主/人数上限/公开状态/禁言列表等大厅元数据
          if (this.onLobbyMetaCallback) {
            const mutedPlayers: string[] | undefined = Array.isArray(message.mutedPlayers)
              ? Array.from(new Set<string>((message.mutedPlayers as unknown[])
                .filter((id: unknown): id is string => isSafeIdentifier(id))))
              : undefined;
            const maxPlayers = typeof message.maxPlayers === 'number' && Number.isSafeInteger(message.maxPlayers)
              ? Math.max(1, Math.min(100_000, message.maxPlayers))
              : null;
            this.onLobbyMetaCallback({
              hostId: registeredHostId,
              maxPlayers,
              isPublic: typeof message.isPublic === 'boolean' ? message.isPublic : undefined,
              mutedPlayers,
            });
          }
          break;

        case 'chat-token-rotated':
          {
            const rotationStatus = this.acceptChatToken(message.chatToken, message.chatTokenEpoch);
            if (rotationStatus === 'rejected') {
              await this.failClosedChatSession('聊天令牌轮换状态无效');
              break;
            }
            if (rotationStatus === 'accepted') {
            try {
              await this.configureChatSession();
            } catch (error) {
                await this.failClosedChatSession('应用聊天令牌轮换失败', error);
                break;
              }
            }
          }
          break;
          
        case 'register-error':
          // 注册失败
          console.error('❌ 注册失败');
          // 不要抛出错误,只记录日志
          // 用户可能输入了错误的密码,应该让他们看到错误信息而不是断开连接
          break;
          
        case 'version-too-old':
          // 版本过低
          console.error('❌ 客户端版本过低');
          // 触发版本错误回调
          if (this.onVersionErrorCallback) {
            this.onVersionErrorCallback(
              sanitizeUntrustedText(message.currentVersion, 32),
              sanitizeUntrustedText(message.minimumVersion, 32),
              sanitizeUntrustedText(message.downloadUrl, 512),
            );
          }
          
          // 停止自动重连
          this.isIntentionalDisconnect = true;
          
          // 关闭WebSocket连接
          if (this.websocket) {
            this.websocket.close();
          }
          break;

        case 'host-changed':
          // 房主变更
          const changedHostId = message.hostId;
          if (!isSafeIdentifier(changedHostId) || !this.isKnownPlayer(changedHostId)) break;
          this.chatHostId = changedHostId;
          try {
            await this.syncChatPeers();
          } catch (error) {
            await this.failClosedChatSession('同步聊天房主身份失败', error);
            break;
          }
          console.log('👑 房主变更');
          this.onHostChangedCallback?.(changedHostId);
          break;

        case 'player-mute-changed':
          // 禁言状态变化
          const mutedPlayerId = message.playerId;
          if (!this.isKnownPlayer(mutedPlayerId, false) || typeof message.muted !== 'boolean') break;
          console.log('🔇 禁言状态变化');
          this.onMuteChangedCallback?.(mutedPlayerId, message.muted);
          break;

        case 'lobby-options-changed':
          // 大厅选项变化
          if (typeof message.isPublic !== 'boolean') break;
          const changedMaxPlayers = message.maxPlayers == null
            ? null
            : (typeof message.maxPlayers === 'number' && Number.isSafeInteger(message.maxPlayers)
              ? Math.max(1, Math.min(100_000, message.maxPlayers))
              : null);
          console.log('⚙️ 大厅选项变化');
          this.onLobbyOptionsChangedCallback?.(changedMaxPlayers, message.isPublic);
          break;

        case 'kicked':
          // 被房主踢出
          const kickReason = sanitizeUntrustedText(message.reason, MAX_ANNOUNCEMENT_LENGTH).trim();
          console.warn('👢 被房主移出大厅');
          this.isIntentionalDisconnect = true;
          this.chatToken = '';
          this.chatTokenEpoch = 0;
          this.chatHostId = undefined;
          this.chatPeers.clear();
          p2pChatService.reset();
          try {
            await invoke('stop_p2p_chat');
          } catch (error) {
            console.warn('停止被踢会话的聊天服务失败:', error);
          }
          this.onKickedCallback?.(kickReason || '你已被房主移出大厅');
          break;
          
        case 'players-list':
          // 收到当前在线玩家列表
          if (!Array.isArray(message.players)) {
            console.warn('⚠️ 收到无效的玩家列表，忽略');
            break;
          }
          if (message.players.length > 10_000) {
            console.warn('⚠️ 玩家列表过大，忽略');
            break;
          }
          const nextChatPeers = new Map<string, ChatPeerPayload>();
          const chatPeerIps = new Set<string>();
          for (const rawPlayer of message.players) {
            const peer = this.parseChatPeer(rawPlayer);
            if (!peer || nextChatPeers.has(peer.player_id) || chatPeerIps.has(peer.virtual_ip)) {
              continue;
            }
            nextChatPeers.set(peer.player_id, peer);
            chatPeerIps.add(peer.virtual_ip);
          }
          this.chatPeers = nextChatPeers;
          try {
            await this.configureChatSession();
          } catch (error) {
            await this.failClosedChatSession('配置权威聊天成员快照失败', error);
            break;
          }
          console.log(`当前在线玩家: ${message.players.length} 人`);
          // 自我域名映射：把自己的虚拟域名也写入 hosts，使本机也能用自己的域名访问（便于测试/本机服务）
          if (this.useDomain && this.virtualDomain && this.virtualIp) {
            try {
              await invoke('add_player_domain', { domain: this.virtualDomain, ip: this.virtualIp });
              console.log(`✅ 自身域名映射已添加: ${this.virtualDomain} -> ${this.virtualIp}`);
            } catch (error) {
              console.error('❌ 添加自身域名映射失败（请确认以管理员身份运行）:', error);
            }
          }
          // 【幽灵玩家清理·准备】players-list 是服务器在持有大厅读锁时构建的权威全量快照（不含自己），
          // 与所有 player-joined 广播互斥一致；因此"本次列表缺席但此前已知"的玩家一定是真离开了。
          // 先记录处理前的已知集合与本次列表出现的 ID，循环结束后据此清理残留幽灵。
          const knownBefore = new Set(this.knownPlayers);
          const listedIds = new Set<string>();
          const listedIps = new Set<string>();

          for (const rawPlayer of message.players) {
            if (!rawPlayer || typeof rawPlayer !== 'object') continue;
            const input = rawPlayer as Record<string, unknown>;
            const playerId = input.playerId;
            if (!isSafeIdentifier(playerId)) continue;
            if (!playerId) continue;
            const playerName = sanitizeUntrustedText(input.playerName, 64).trim() || tl('未知玩家', 'Unknown player');
            const virtualIp = isSafeVirtualIp(input.virtualIp) ? input.virtualIp.trim() : undefined;
            const virtualDomain = isSafeVirtualDomain(input.virtualDomain) ? input.virtualDomain.trim() : undefined;
            const player = {
              playerId,
              playerName,
              virtualIp,
              virtualDomain,
              useDomain: input.useDomain === true && !!virtualIp && !!virtualDomain,
            };
            console.log('  - 收到玩家条目');

            if (player.playerId === this.localPlayerId) {
              continue;
            }
            // 虚拟 IP 在大厅内唯一。服务端残留旧连接或重复广播本机身份时，
            // 不把同一台设备当成远端玩家，也不向自己的 IP 建立语音连接。
            if (player.virtualIp && this.virtualIp && player.virtualIp === this.virtualIp) {
              console.warn('⚠️ 忽略与本机虚拟 IP 相同的玩家条目');
              continue;
            }
            if (listedIds.has(player.playerId)) {
              console.warn('⚠️ 忽略重复的玩家身份条目');
              continue;
            }
            if (player.virtualIp && listedIps.has(player.virtualIp)) {
              console.warn('⚠️ 忽略重复的玩家虚拟 IP 条目');
              continue;
            }
            listedIds.add(player.playerId);
            if (player.virtualIp) listedIps.add(player.virtualIp);

            const wasPendingLeave = this.clearPendingPlayerLeave(player.playerId);
            if (wasPendingLeave) {
              console.log(`♻️ 玩家 ${player.playerId} 在players-list中恢复在线，取消离线确认`);
            }

            const isKnownPlayer = this.knownPlayers.has(player.playerId);
            this.knownPlayers.add(player.playerId);
            
            // 如果启用了域名访问且有虚拟域名，添加到hosts文件
            if (player.useDomain && player.virtualDomain && player.virtualIp) {
              // 记录域名，供该玩家离开时清理 hosts（player-left 只带 playerId）
              this.playerDomains.set(player.playerId, player.virtualDomain);
              try {
                console.log(`📝 添加玩家域名映射: ${player.virtualDomain} -> ${player.virtualIp}`);
                await invoke('add_player_domain', {
                  domain: player.virtualDomain,
                  ip: player.virtualIp,
                });
                console.log(`✅ 玩家域名映射已添加: ${player.virtualDomain}`);
              } catch (error) {
                console.error(`❌ 添加玩家域名映射失败:`, error);
                // 不中断流程，继续处理玩家列表
              }
            }
            
            // 触发回调，添加玩家到前端列表（避免重连时重复触发）
            if (!isKnownPlayer) {
              this.notifyPlayerJoined(player.playerId, player.playerName, player.virtualIp, player.virtualDomain, player.useDomain);
            }
            
            // 已知玩家仍在权威列表中时，只修复他的连接，不能触发“玩家离开”回调。
            // EasyTier 路由重算期间 connectionState 可能短暂变为 disconnected/failed，
            // 旧逻辑会把仍在线玩家从 UI 移除并重建连接，放大为多人语音短暂无声。
            if (isKnownPlayer) {
              const existingPeer = this.peerConnections.get(player.playerId);
              if (existingPeer) {
                const state = existingPeer.connection.connectionState;
                if (this.isPeerConnectedOrFresh(existingPeer)) {
                  console.log(`✅ 玩家 ${player.playerId} 的WebRTC连接已存在且状态正常 (${state})，跳过重复连接`);
                  continue;
                } else {
                  console.log(`⚠️ 玩家 ${player.playerId} 的WebRTC连接状态异常 (${state})，将重新建立连接`);
                  this.clearPeerReconnectState(player.playerId);
                  this.removePeerConnection(player.playerId);
                  this.schedulePeerReconnect(player.playerId, 'players-list发现异常连接', 500);
                }
              } else {
                console.log(`⚠️ 玩家 ${player.playerId} 在已知列表中但WebRTC连接不存在，将重新建立连接`);
                this.schedulePeerReconnect(player.playerId, 'players-list发现缺失连接', 500);
              }

              // 已知玩家的连接修复交给统一重连状态机。不能在这里删除连接后
              // 再按字典序等待，否则较小 ID 一方可能永久等不到新的 Offer。
              continue;
            }
            
            // 使用字符串比较决定谁主动发起连接，避免双方同时发送Offer
            // 只有当本地玩家ID字典序大于对方时才主动发起连接
            if (this.localPlayerId > player.playerId) {
              console.log(`📡 主动向 ${player.playerId} 发起连接（ID字典序较大）`);
              
              // 创建连接
              await this.createPeerConnection(player.playerId);
              
              // 等待ICE候选收集开始
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // 创建 Offer
              const pc = this.peerConnections.get(player.playerId);
              if (pc) {
                const offer = await pc.connection.createOffer();
                await pc.connection.setLocalDescription(offer);
                
                // 发送 Offer（失败自动重试一次）
                await this.sendOfferWithRetry(player.playerId, {
                  type: offer.type,
                  sdp: offer.sdp,
                }, '初次连接');
              }
            } else {
              console.log(`⏳ 等待 ${player.playerId} 主动发起连接（ID字典序较小）`);
            }
          }

          // 【幽灵玩家清理·执行】断线重连期间若有成员离开，重连拿到的权威列表里不会包含他，
          // 但本地 knownPlayers/玩家列表仍残留。这里据权威列表移除这些幽灵，避免永久残留。
          // 对缺席成员进行二次快照确认，避免并发重注册期间误删，同时保证真正离线者最终会被清理。
          this.authoritativePlayers = new Set(listedIds);
          this.authoritativeSnapshotVersion += 1;
          for (const oldId of knownBefore) {
            if (oldId === this.localPlayerId || listedIds.has(oldId)) continue;
            if (this.pendingPlayerLeaveTimers.has(oldId) || this.playerLeaveResyncTimers.has(oldId)) {
              console.log(`🧹 [离线确认] ${oldId} 仍不在最新权威列表，确认已离开`);
              await this.removeConfirmedPlayer(oldId);
              continue;
            }
            console.log(`⏳ [成员校验] ${oldId} 未出现在权威列表，启动二次确认`);
            this.schedulePlayerLeaveConfirmation(oldId);
          }
          
          // 【修复】自己加入大厅后，向所有人请求屏幕共享列表和文件共享列表
          console.log('📢 [WebRTCClient] 自己加入大厅，向所有人请求屏幕共享列表和文件共享列表...');
          this.sendWebSocketMessage({
            type: 'screen-share-list-request',
            from: this.localPlayerId,
          });
          
          // 【事件驱动】请求文件共享列表
          this.sendWebSocketMessage({
            type: 'file-share-list-request',
            from: this.localPlayerId,
          });
          
          // HTTP模式：不需要广播共享列表，客户端直接通过HTTP API查询
          break;
          
        case 'player-joined':
          // 有新玩家加入
           const joinedPlayerId = message.playerId;
          const joinedPlayerName = sanitizeUntrustedText(message.playerName, 64).trim() || tl('未知玩家', 'Unknown player');
          const joinedVirtualIp = isSafeVirtualIp(message.virtualIp) ? message.virtualIp.trim() : undefined;
          const joinedVirtualDomain = isSafeVirtualDomain(message.virtualDomain) ? message.virtualDomain.trim() : undefined;
          const joinedUseDomain = message.useDomain === true && !!joinedVirtualIp && !!joinedVirtualDomain;
           if (!isSafeIdentifier(joinedPlayerId)) break;
          console.log(`🎮 新玩家加入: ${joinedPlayerName} (${joinedPlayerId})`);

          if (joinedPlayerId === this.localPlayerId) {
            break;
          }
          if (joinedVirtualIp && this.virtualIp && joinedVirtualIp === this.virtualIp) {
            console.warn(`⚠️ 忽略与本机虚拟 IP 相同的加入事件: ${joinedPlayerName} (${joinedPlayerId})`);
            break;
          }

          const joinedChatPeer = this.parseChatPeer(message);
          if (joinedChatPeer) {
            this.chatPeers.set(joinedChatPeer.player_id, joinedChatPeer);
            try {
              await this.syncChatPeers();
            } catch (error) {
              await this.failClosedChatSession('同步新聊天成员失败', error);
              break;
            }
          }

          const isRecoveredPlayer = this.clearPendingPlayerLeave(joinedPlayerId);
          if (isRecoveredPlayer) {
            console.log(`♻️ 玩家 ${message.playerId} 在短时断线窗口内恢复，跳过离开/加入提示音`);
          }

          const alreadyKnown = this.knownPlayers.has(joinedPlayerId);
          if (alreadyKnown) {
            const existingPeer = this.peerConnections.get(joinedPlayerId);
            if (!this.isPeerConnectedOrFresh(existingPeer)) {
              console.log(`♻️ ${joinedPlayerId} 重新注册且语音连接异常，调度自动修复`);
              this.schedulePeerReconnect(joinedPlayerId, '玩家重新注册', 500);
            } else {
              console.log(`⏳ ${joinedPlayerId} 已在players-list中处理过，连接正常，跳过重复加入事件`);
            }
            break;
          }

          this.knownPlayers.add(joinedPlayerId);
          
          // 播放玩家加入音效（短时断线恢复不播放）
          if (!isRecoveredPlayer) {
            try {
              const { audioService } = await import('../audio/AudioService');
              await audioService.play('userJoined');
            } catch (error) {
              console.error('播放玩家加入音效失败:', error);
            }
          }
          
          // 如果启用了域名访问且有虚拟域名，添加到hosts文件
          if (joinedUseDomain && joinedVirtualDomain && joinedVirtualIp) {
            // 记录域名，供该玩家离开时清理 hosts（player-left 只带 playerId）
            this.playerDomains.set(joinedPlayerId, joinedVirtualDomain);
            try {
              console.log(`📝 添加玩家域名映射: ${joinedVirtualDomain} -> ${joinedVirtualIp}`);
              await invoke('add_player_domain', {
                domain: joinedVirtualDomain,
                ip: joinedVirtualIp,
              });
              console.log(`✅ 玩家域名映射已添加: ${joinedVirtualDomain}`);
            } catch (error) {
              console.error(`❌ 添加玩家域名映射失败:`, error);
              // 不中断流程，继续处理玩家加入
            }
          }
          
          // 触发回调
          this.notifyPlayerJoined(joinedPlayerId, joinedPlayerName, joinedVirtualIp, joinedVirtualDomain, joinedUseDomain);
          
          // HTTP模式：不需要向新玩家发送共享列表，客户端直接通过HTTP API查询
          // 只有当本地玩家ID字典序大于对方时才主动发起连接
          if (this.localPlayerId > joinedPlayerId) {
            console.log(`📡 主动向新玩家 ${joinedPlayerId} 发起连接（ID字典序较大）`);
            
            // 等待一小段时间，让新玩家完成初始化
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 创建连接
            await this.createPeerConnection(joinedPlayerId);
            
            // 等待ICE候选收集开始
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 创建 Offer
            const pc = this.peerConnections.get(joinedPlayerId);
            if (pc) {
              const offer = await pc.connection.createOffer();
              await pc.connection.setLocalDescription(offer);
              
              // 发送 Offer（失败自动重试一次）
              await this.sendOfferWithRetry(joinedPlayerId, {
                type: offer.type,
                sdp: offer.sdp,
              }, '新玩家连接');
            }
          } else {
            console.log(`⏳ 等待新玩家 ${joinedPlayerId} 主动发起连接（ID字典序较小）`);
          }
          break;
          
        case 'player-left':
          // 有玩家离开（增加短时断线缓冲，避免误报提示音）
           const leftPlayerId = message.playerId;
          if (leftPlayerId) {
            this.chatPeers.delete(leftPlayerId);
            if (this.chatHostId === leftPlayerId) this.chatHostId = undefined;
            try {
              await this.syncChatPeers();
            } catch (error) {
              await this.failClosedChatSession('撤销离开玩家的聊天权限失败', error);
              break;
            }
          }
           if (!isSafeIdentifier(leftPlayerId) || !this.knownPlayers.has(leftPlayerId)) {
            break;
          }
          console.log('👋 玩家离开事件');

          if (leftPlayerId === this.localPlayerId) {
            break;
          }

          this.resetRemoteControlForPeer(leftPlayerId);

          if (this.schedulePlayerLeaveConfirmation(leftPlayerId)) {
            break;
          }
          break;
          
        case 'offer':
          // 收到 offer
          console.log(`📥 收到 Offer from ${message.from}`);
          await this.handleWebSocketOffer(message);
          break;
          
        case 'answer':
          // 收到 answer
          console.log(`📥 收到 Answer from ${message.from}`);
          await this.handleWebSocketAnswer(message);
          break;
          
        case 'ice-candidate':
          // 收到 ICE 候选
          console.log(`🧊 收到 ICE Candidate from ${message.from}`);
          await this.handleWebSocketIceCandidate(message);
          break;

        case 'voice-reconnect':
          // 对方点击了「语音重连」：这里只负责拆掉与他的旧连接（不移除玩家本身），
          // 随后由对方作为发起方送来全新的 Offer 完成重建。
          // 必须双端同时拆掉旧连接，否则一端沿用旧 PeerConnection 会因指纹/ufrag
          // 不匹配而出现"连上了但没声音"。
          const reconnectPlayerId = message.from;
          if (this.isKnownPlayer(reconnectPlayerId, false) && (!message.to || message.to === this.localPlayerId)) {
            console.log('🔄 收到语音重连请求，拆除旧连接等待重建');
            this.clearPeerReconnectState(reconnectPlayerId);
            this.removePeerConnection(reconnectPlayerId);
          }
          break;
          
        case 'status-update':
          // 收到状态更新
          const statusPlayerId = message.clientId;
          if (!this.isKnownPlayer(statusPlayerId, false) || typeof message.micEnabled !== 'boolean') break;
          console.log('📢 收到状态更新');
          this.onStatusUpdateCallback?.(statusPlayerId, message.micEnabled);
          break;

        case 'chat-message':
          // 收到聊天消息
          const chatPlayerId = message.playerId;
          const chatPlayerName = sanitizeUntrustedText(message.playerName, 64).trim();
          const chatContent = sanitizeUntrustedText(message.content, MAX_CHAT_TEXT_LENGTH);
          const chatTimestamp = typeof message.timestamp === 'number' ? message.timestamp : Number.NaN;
          console.log('💬 收到聊天消息');
          if (this.onChatMessageCallback && this.isKnownPlayer(chatPlayerId, false) && chatPlayerName && chatContent && Number.isFinite(chatTimestamp) && chatTimestamp >= 0) {
            this.onChatMessageCallback(chatPlayerId, chatPlayerName, chatContent, chatTimestamp);
          }
          break;
          
        case 'file-share-list':
          // 收到文件共享列表更新
          console.log(`📁 收到文件共享列表更新`);
          try {
            if (message.shares && Array.isArray(message.shares)) {
              fileShareService.updateRemoteShares(message.shares);
              console.log(`✅ 文件共享列表已更新，共 ${message.shares.length} 个共享`);
            }
          } catch (error) {
            console.error('❌ 更新文件共享列表失败:', error);
          }
          break;
          
        case 'file-list-request':
          // 收到文件列表请求 (已废弃，使用HTTP API)
          console.log(`📂 收到文件列表请求 from ${message.from}, shareId: ${message.shareId} (已废弃)`);
          break;
          
        case 'file-list-response':
          // 收到文件列表响应 (已废弃，使用HTTP API)
          console.log(`📂 收到文件列表响应 from ${message.from}, shareId: ${message.shareId} (已废弃)`);
          break;
          
        case 'file-transfer-request':
          // 收到文件传输请求 (已废弃，使用HTTP API)
          console.log(`📥 收到文件传输请求 from ${message.from} (已废弃)`);
          break;
          
        case 'file-transfer-response':
          // Legacy WebSocket file-transfer signaling is disabled. Ignore it
          // rather than allowing an arbitrary peer to mutate local transfer UI.
          break;
          
        case 'file-chunk':
          // 已禁用：不再通过WebSocket传输文件数据块
          console.error('❌ 收到WebSocket文件数据块消息，但此功能已被禁用！所有文件传输必须通过P2P DataChannel进行！');
          break;
          
        case 'file-transfer-complete':
          // 已禁用：不再通过WebSocket发送传输完成消息
          console.error('❌ 收到WebSocket传输完成消息，但此功能已被禁用！所有文件传输必须通过P2P DataChannel进行！');
          break;
          
        case 'file-transfer-error':
          // 已禁用：不再通过WebSocket发送传输错误消息
          console.error('❌ 收到WebSocket传输错误消息，但此功能已被禁用！所有文件传输必须通过P2P DataChannel进行！');
          break;
          
        case 'share-added':
          // Legacy file-share signaling is disabled; the HTTP listing is the
          // sole source of truth for remote shares.
          break;
          
        case 'share-removed':
          break;
          
        case 'share-updated':
          break;
          
        case 'screen-share-start':
          // 收到屏幕共享开始通知
          {
            const peerId = this.authenticatedPeerId(message, false);
            const shareId = this.safeScreenShareId(message.shareId);
            const playerName = sanitizeUntrustedText(message.playerName, MAX_PLAYER_NAME_LENGTH).trim();
            if (!peerId || !shareId || !shareId.startsWith('share-') || !playerName || typeof message.hasPassword !== 'boolean') break;
            console.log('🖥️ 收到屏幕共享开始通知');
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const existing = activeShares.get(shareId);
              if (existing && existing.playerId !== peerId) break;
              if (!existing && activeShares.size >= 256) break;
              // Only the roster member that announced the share may own it.
              const share = {
                id: shareId,
                playerId: peerId,
                playerName,
                virtualIp: '',
                requirePassword: message.hasPassword,
                startTime: Date.now(),
                status: 'active' as const,
              };
              activeShares.set(share.id, share);
              window.dispatchEvent(new CustomEvent('screen-share-start', {
                detail: {
                  shareId: share.id,
                  playerId: share.playerId,
                  playerName: share.playerName,
                  hasPassword: share.requirePassword,
                },
              }));
            } catch (error) {
              console.error('❌ 处理屏幕共享开始失败:', error);
            }
          }
          break;
          
        case 'screen-share-error':
          // 收到屏幕共享错误（例如密码错误）
          {
            const peerId = this.authenticatedPeerId(message);
            const shareId = this.safeScreenShareId(message.shareId);
            const errorText = sanitizeUntrustedText(message.error, MAX_ANNOUNCEMENT_LENGTH).trim();
            if (!peerId || !shareId || !errorText) break;
            console.log(`❌ 收到屏幕共享错误: ${errorText}`);
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const share = screenShareService.getActiveShares().find((item) => item.id === shareId);
              if (!share || share.playerId !== peerId) break;
              // 这里可以通过事件通知前端显示错误
              window.dispatchEvent(new CustomEvent('screen-share-error', {
                detail: { shareId, error: errorText },
              }));
            } catch (error) {
              console.error('❌ 处理屏幕共享错误失败:', error);
            }
          }
          break;
          
        case 'screen-share-stop':
          // 收到屏幕共享停止通知
          {
            const peerId = this.authenticatedPeerId(message, false);
            const shareId = this.safeScreenShareId(message.shareId);
            if (!peerId || !shareId) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              if (!screenShareService.handleShareStop(shareId, peerId)) break;
              console.log(`✅ 屏幕共享已从列表移除`);
              window.dispatchEvent(new CustomEvent('screen-share-stop', { detail: { shareId } }));
            } catch (error) {
              console.error('❌ 处理屏幕共享停止失败:', error);
            }
          }
          break;
          
        case 'screen-share-offer':
          // 收到屏幕共享Offer
          {
            const session = this.authenticatedSession(message);
            const shareId = this.safeScreenShareId(message.shareId);
            const playerName = sanitizeUntrustedText(message.playerName, MAX_PLAYER_NAME_LENGTH).trim();
            const password = message.password === undefined
              ? undefined
              : typeof message.password === 'string'
                ? sanitizeUntrustedText(message.password, 256)
                : null;
            const routeVersion = this.safeRouteVersion(message.routeVersion);
            if (!session || !shareId || !playerName || password === null || !this.isSafeSessionDescription(message.offer, 'offer')) break;
            if (message.routeVersion !== undefined && routeVersion === undefined) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const share = activeShares.get(shareId);
              // An offer is accepted only by the owner of the announced share.
              if (!share || share.playerId !== this.localPlayerId) break;
              await screenShareService.handleOffer({
                shareId,
                playerId: session.peerId,
                playerName,
                requirePassword: false,
                password,
                sdp: message.offer.sdp,
                routeVersion,
              });
            } catch (error) {
              console.error('❌ 处理屏幕共享Offer失败:', error);
            }
          }
          break;
          
        case 'screen-share-answer':
          if (message.to !== this.localPlayerId || typeof message.from !== 'string' || typeof message.shareId !== 'string' || !message.answer?.sdp) break;
          // 收到屏幕共享Answer
          {
            const session = this.authenticatedSession(message);
            const shareId = this.safeScreenShareId(message.shareId);
            const routeVersion = this.safeRouteVersion(message.routeVersion);
            if (!session || !shareId || !this.isSafeSessionDescription(message.answer, 'answer')) break;
            if (message.routeVersion !== undefined && routeVersion === undefined) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const share = activeShares.get(shareId);
              if (!share || share.playerId !== session.peerId) break;
              await screenShareService.handleAnswer({
                shareId,
                sdp: message.answer.sdp,
                routeVersion,
              }, session.peerId);
            } catch (error) {
              console.error('❌ 处理屏幕共享Answer失败:', error);
            }
          }
          break;
          
        case 'screen-share-ice-candidate':
          if (message.to !== this.localPlayerId || typeof message.from !== 'string' || typeof message.shareId !== 'string' || !message.candidate) break;
          // 收到屏幕共享ICE候选
          {
            const session = this.authenticatedSession(message);
            const shareId = this.safeScreenShareId(message.shareId);
            const role = message.connectionRole;
            const routeVersion = this.safeRouteVersion(message.routeVersion);
            if (!session || !shareId || !['in', 'out'].includes(role) || !this.isSafeIceCandidate(message.candidate)) break;
            if (message.routeVersion !== undefined && routeVersion === undefined) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const share = activeShares.get(shareId);
              if (!share) break;
              // `out` candidates are sent to the owner; `in` candidates are
              // sent to a viewer. Do not let a peer inject into the other role.
              if ((role === 'out' && share.playerId !== this.localPlayerId) ||
                  (role === 'in' && share.playerId !== session.peerId)) break;
              await screenShareService.handleIceCandidate(
                shareId,
                message.candidate,
                session.peerId,
                role,
                routeVersion,
              );
            } catch (error) {
              console.error('❌ 处理屏幕共享ICE候选失败:', error);
            }
          }
          break;

        case 'screen-share-relay':
          {
            const session = this.authenticatedSession(message);
            const shareId = this.safeScreenShareId(message.shareId);
            const action = message.action;
            const routeVersion = this.safeRouteVersion(message.routeVersion);
            const upstreamId = message.upstreamId === undefined ? undefined : message.upstreamId;
            const downstreamId = message.downstreamId === undefined ? undefined : message.downstreamId;
            const playerName = message.playerName === undefined
              ? undefined
              : sanitizeUntrustedText(message.playerName, MAX_PLAYER_NAME_LENGTH).trim();
            const password = message.password === undefined ? undefined : sanitizeUntrustedText(message.password, 256);
            const reason = message.reason === undefined ? undefined : sanitizeUntrustedText(message.reason, MAX_ANNOUNCEMENT_LENGTH).trim();
            const validAction = ['join', 'health', 'ready', 'failure', 'accepted', 'route', 'child', 'detach'].includes(action);
            if (!session || !shareId || !validAction) break;
            if (message.routeVersion !== undefined && routeVersion === undefined) break;
            if (upstreamId !== undefined && !isSafeIdentifier(upstreamId)) break;
            if (downstreamId !== undefined && !isSafeIdentifier(downstreamId)) break;
            if (message.playerName !== undefined && !playerName) break;
            if (message.password !== undefined && typeof message.password !== 'string') break;
            if (message.reason !== undefined && !reason) break;
            if (action === 'join' && (!playerName || (message.password !== undefined && typeof message.password !== 'string'))) break;
            if (['ready', 'route', 'child', 'detach'].includes(action) && routeVersion === undefined) break;
            if (action === 'route' && !isSafeIdentifier(upstreamId)) break;
            if (['child', 'detach'] .includes(action) && !isSafeIdentifier(downstreamId)) break;
            if (action === 'health') {
              const sourceSequence = message.sourceSequence ?? message.sequence;
              const sentSequence = message.sentSequence ?? message.sequence;
              if (
                typeof sourceSequence !== 'number' || !Number.isSafeInteger(sourceSequence) || sourceSequence < 0 || sourceSequence > 1_000_000_000 ||
                typeof sentSequence !== 'number' || !Number.isSafeInteger(sentSequence) || sentSequence < 0 || sentSequence > 1_000_000_000 ||
                typeof message.limited !== 'boolean'
              ) break;
            }
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const share = activeShares.get(shareId);
              if (!share) break;
              if (['join', 'ready', 'failure'].includes(action) && share.playerId !== this.localPlayerId) break;
              if (['accepted', 'route', 'child', 'detach'].includes(action) && share.playerId !== session.peerId) break;
              await screenShareService.handleRelayControl({
                ...message,
                from: session.peerId,
                to: this.localPlayerId,
                shareId,
                routeVersion,
                upstreamId,
                downstreamId,
                playerName,
                password,
                reason,
              });
            } catch (error) {
              console.error('❌ 处理屏幕共享中继控制消息失败:', error);
            }
          }
          break;
          
        case 'screen-share-viewer-left':
          // 收到查看者离开通知
          {
            const peerId = this.authenticatedPeerId(message, false);
            const shareId = this.safeScreenShareId(message.shareId);
            if (!peerId || !shareId) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const share = activeShares.get(shareId);
              if (!share || share.playerId !== this.localPlayerId) break;
              screenShareService.handleViewerLeft(shareId, peerId);
            } catch (error) {
              console.error('❌ 处理查看者离开失败:', error);
            }
          }
          break;
          
        case 'screen-share-list-request':
          // 收到屏幕共享列表请求
          {
            const peerId = this.authenticatedPeerId(message, false);
            if (!peerId) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const myShares = screenShareService.getMyActiveShares().slice(0, 256);
              myShares.forEach(share => {
                const shareId = this.safeScreenShareId(share.id);
                const playerName = sanitizeUntrustedText(share.playerName, MAX_PLAYER_NAME_LENGTH).trim();
                if (!shareId || !shareId.startsWith('share-') || !playerName) return;
                this.sendWebSocketMessage({
                  type: 'screen-share-list-response',
                  from: this.localPlayerId,
                  to: peerId,
                  shareId,
                  playerName,
                  hasPassword: share.requirePassword === true,
                  viewerId: isSafeIdentifier(share.viewerId) ? share.viewerId : undefined,
                  viewerName: share.viewerName ? sanitizeUntrustedText(share.viewerName, MAX_PLAYER_NAME_LENGTH).trim() : undefined,
                  viewerCount: this.safeViewerCount(share.viewerCount),
                });
              });
            } catch (error) {
              console.error('❌ 处理屏幕共享列表请求失败:', error);
            }
          }
          break;
          
        case 'screen-share-list-response':
          // 收到屏幕共享列表响应
          {
            const peerId = this.authenticatedPeerId(message);
            const shareId = this.safeScreenShareId(message.shareId);
            const playerName = sanitizeUntrustedText(message.playerName, MAX_PLAYER_NAME_LENGTH).trim();
            const viewerId = message.viewerId === undefined ? undefined : message.viewerId;
            const viewerName = message.viewerName === undefined ? undefined : sanitizeUntrustedText(message.viewerName, MAX_PLAYER_NAME_LENGTH).trim();
            if (!peerId || !shareId || !shareId.startsWith('share-') || !playerName || typeof message.hasPassword !== 'boolean') break;
            if (viewerId !== undefined && !isSafeIdentifier(viewerId)) break;
            if (message.viewerName !== undefined && !viewerName) break;
            if (message.viewerCount !== undefined && (typeof message.viewerCount !== 'number' || !Number.isSafeInteger(message.viewerCount) || message.viewerCount < 0 || message.viewerCount > 100_000)) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const existing = activeShares.get(shareId);
              if (existing && existing.playerId !== peerId) break;
              if (!existing && activeShares.size >= 256) break;
              const share = {
                id: shareId,
                playerId: peerId,
                playerName,
                virtualIp: '',
                requirePassword: message.hasPassword,
                startTime: Date.now(),
                status: 'active' as const,
                viewerId,
                viewerName,
                viewerCount: this.safeViewerCount(message.viewerCount),
              };
              activeShares.set(share.id, share);
              window.dispatchEvent(new CustomEvent('screen-share-start', {
                detail: {
                  shareId: share.id,
                  playerId: share.playerId,
                  playerName: share.playerName,
                  hasPassword: share.requirePassword,
                  viewerId: share.viewerId,
                  viewerName: share.viewerName,
                  viewerCount: share.viewerCount,
                },
              }));
            } catch (error) {
              console.error('❌ 处理屏幕共享列表响应失败:', error);
            }
          }
          break;
          
        case 'screen-share-update':
          // 收到共享状态更新
          {
            const peerId = this.authenticatedPeerId(message, false);
            const shareId = this.safeScreenShareId(message.shareId);
            const viewerId = message.viewerId === undefined ? undefined : message.viewerId;
            const viewerName = message.viewerName === undefined ? undefined : sanitizeUntrustedText(message.viewerName, MAX_PLAYER_NAME_LENGTH).trim();
            const viewerCount = message.viewerCount === undefined
              ? (viewerId ? 1 : 0)
              : this.safeViewerCount(message.viewerCount);
            if (!peerId || !shareId || (viewerId !== undefined && !isSafeIdentifier(viewerId))) break;
            if (message.viewerName !== undefined && !viewerName) break;
            if (message.viewerCount !== undefined && (typeof message.viewerCount !== 'number' || !Number.isSafeInteger(message.viewerCount) || message.viewerCount < 0 || message.viewerCount > 100_000)) break;
            try {
              const { screenShareService } = await import('../screenShare/ScreenShareService');
              const activeShares = (screenShareService as any).activeShares as Map<string, any>;
              const share = activeShares.get(shareId);
              if (!share || share.playerId !== peerId) break;
              share.viewerId = viewerId;
              share.viewerName = viewerName;
              share.viewerCount = viewerCount;
              activeShares.set(shareId, share);
              screenShareService.handleShareUpdate(shareId, viewerId, viewerName, viewerCount, peerId);
              window.dispatchEvent(new CustomEvent('screen-share-update', {
                detail: { shareId, viewerId, viewerName, viewerCount },
              }));
            } catch (error) {
              console.error('❌ 处理共享状态更新失败:', error);
            }
          }
          break;

        case 'remote-control-request':
        case 'remote-control-accept':
        case 'remote-control-reject':
        case 'remote-control-offer':
        case 'remote-control-answer':
        case 'remote-control-ice':
        case 'remote-control-stop':
          try {
            if (typeof message.from !== 'string' || typeof message.to !== 'string' || message.to !== this.localPlayerId) {
              break;
            }
            const { remoteControlService } = await import('../remoteControl/RemoteControlService');
            const session = this.authenticatedSession(message);
            switch (message.type) {
              case 'remote-control-request': {
                const request = session;
                const fromName = sanitizeUntrustedText(message.fromName, MAX_PLAYER_NAME_LENGTH).trim();
                if (!request || !fromName) break;
                remoteControlService.handleRequest(request.sessionId, request.peerId, fromName, this.localPlayerId);
                break;
              }
              case 'remote-control-accept':
              {
                if (!session || !remoteControlService.isSessionForPeer(session.sessionId, session.peerId)) break;
                await remoteControlService.handleAccept(session.sessionId, session.peerId, this.localPlayerId);
                break;
              }
              case 'remote-control-reject': {
                if (!session || !remoteControlService.isSessionForPeer(session.sessionId, session.peerId)) break;
                const reason = sanitizeUntrustedText(message.reason, MAX_ANNOUNCEMENT_LENGTH).trim();
                remoteControlService.handleReject(session.sessionId, session.peerId, this.localPlayerId, reason || 'rejected');
                break;
              }
              case 'remote-control-offer': {
                if (!session || !remoteControlService.isSessionForPeer(session.sessionId, session.peerId) || !this.isSafeSessionDescription(message.offer, 'offer')) break;
                await remoteControlService.handleOffer(session.sessionId, session.peerId, this.localPlayerId, message.offer.sdp);
                break;
              }
              case 'remote-control-answer': {
                if (!session || !remoteControlService.isSessionForPeer(session.sessionId, session.peerId) || !this.isSafeSessionDescription(message.answer, 'answer')) break;
                await remoteControlService.handleAnswer(session.sessionId, session.peerId, this.localPlayerId, message.answer.sdp);
                break;
              }
              case 'remote-control-ice': {
                if (!session || !remoteControlService.isSessionForPeer(session.sessionId, session.peerId) || !this.isSafeIceCandidate(message.candidate)) break;
                await remoteControlService.handleIce(session.sessionId, session.peerId, this.localPlayerId, message.candidate);
                break;
              }
              case 'remote-control-stop': {
                if (!session || !remoteControlService.isSessionForPeer(session.sessionId, session.peerId)) break;
                remoteControlService.handleStop(session.sessionId, session.peerId, this.localPlayerId);
                break;
              }
            }
          } catch (error) {
            console.error('❌ 处理远程控制消息失败:', error);
          }
          break;
          
        case 'file-share-added':
          // 收到文件共享添加通知
          {
            const peerId = this.authenticatedPeerId(message, false);
            const shareId = this.safeFileShareId(message.shareId);
            const shareName = sanitizeUntrustedText(message.shareName, MAX_PATH_SEGMENT_LENGTH).trim();
            const playerName = sanitizeUntrustedText(message.playerName, MAX_PLAYER_NAME_LENGTH).trim();
            if (!peerId || !shareId || !shareName || !playerName || typeof message.hasPassword !== 'boolean') break;
            window.dispatchEvent(new CustomEvent('file-share-added', {
              detail: { shareId, shareName, playerId: peerId, playerName, hasPassword: message.hasPassword },
            }));
          }
          break;
          
        case 'file-share-removed':
          // 收到文件共享删除通知
          {
            const peerId = this.authenticatedPeerId(message, false);
            const shareId = this.safeFileShareId(message.shareId);
            if (!peerId || !shareId) break;
            window.dispatchEvent(new CustomEvent('file-share-removed', {
              detail: { shareId, playerId: peerId },
            }));
          }
          break;
          
        case 'file-share-list-request':
          // 收到文件共享列表请求
          {
            const peerId = this.authenticatedPeerId(message, false);
            if (!peerId) break;
            try {
              const localShares = await invoke<any[]>('get_local_shares');
              const shares = Array.isArray(localShares)
                ? localShares.slice(0, 256).flatMap((share) => {
                    if (!share || typeof share !== 'object') return [];
                    const shareId = this.safeFileShareId(share.id);
                    const shareName = sanitizeUntrustedText(share.name, MAX_PATH_SEGMENT_LENGTH).trim();
                    if (!shareId || !shareName) return [];
                    return [{ shareId, shareName, playerName: this.localPlayerName, hasPassword: !!share.password }];
                  })
                : [];
              if (shares.length > 0) {
                this.sendWebSocketMessage({
                  type: 'file-share-list-response',
                  from: this.localPlayerId,
                  to: peerId,
                  shares,
                });
              }
            } catch (error) {
              console.error('❌ 处理文件共享列表请求失败:', error);
            }
          }
          break;
          
        case 'file-share-list-response':
          // 收到文件共享列表响应
          {
            const peerId = this.authenticatedPeerId(message);
            if (!peerId || !Array.isArray(message.shares) || message.shares.length > 256) break;
            for (const rawShare of message.shares) {
              if (!rawShare || typeof rawShare !== 'object') continue;
              const share = rawShare as Record<string, unknown>;
              const shareId = this.safeFileShareId(share.shareId);
              const shareName = sanitizeUntrustedText(share.shareName, MAX_PATH_SEGMENT_LENGTH).trim();
              const playerName = sanitizeUntrustedText(share.playerName, MAX_PLAYER_NAME_LENGTH).trim();
              if (!shareId || !shareName || !playerName || typeof share.hasPassword !== 'boolean') continue;
              window.dispatchEvent(new CustomEvent('file-share-added', {
                detail: { shareId, shareName, playerId: peerId, playerName, hasPassword: share.hasPassword },
              }));
            }
          }
          break;
          
        default:
           console.warn(`未知消息类型: ${messageType}`);
      }
    } catch (error) {
      console.error(`❌ 处理WebSocket消息失败:`, error);
    }
  }

  /**
   * 处理WebSocket Offer
   */
  private async handleWebSocketOffer(message: any): Promise<void> {
    try {
      const peerId = this.authenticatedPeerId(message);
      if (!peerId || !this.isSafeSessionDescription(message.offer, 'offer')) {
        console.warn('⚠️ 忽略未认证或格式无效的 Offer');
        return;
      }
      
      console.log(`📥 处理 Offer from ${peerId}`);
      
      // 检查是否已经有连接
      let peer = this.peerConnections.get(peerId);
      
      if (peer) {
        // 如果已经有连接，检查连接状态
        const state = peer.connection.connectionState;
        const signalingState = peer.connection.signalingState;
        console.log(`已存在连接，连接状态: ${state}, 信令状态: ${signalingState}`);
        
        // 如果正在协商中，等待当前协商完成
        if (peer.isNegotiating) {
          console.log(`⏳ 正在协商中，等待当前协商完成...`);
          // 等待最多3秒
          let waitCount = 0;
          while (peer.isNegotiating && waitCount < 30) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
          }
          
          if (peer.isNegotiating) {
            console.warn(`⚠️ 等待协商超时，强制处理新的 Offer`);
            peer.isNegotiating = false;
          }
        }
        
        // 已建立或正在建立连接时，新 Offer 可能是 ICE 重启或双方兜底重连。
        // connecting 状态也必须处理，否则旧连接卡住后会永久忽略所有自愈 Offer。
        if (state === 'connected' || state === 'connecting') {
          console.log(`🔄 收到连接重协商 Offer，开始处理...`);
          
          try {
            // 标记正在协商
            peer.isNegotiating = true;
            
            // 检查当前信令状态，优先处理 offer 冲突（glare）
            const currentSignalingState = peer.connection.signalingState;
            if (currentSignalingState !== 'stable') {
              if (currentSignalingState === 'have-local-offer') {
                console.warn(`⚠️ 信令状态为 have-local-offer，执行 rollback 后处理远端 Offer`);
                await peer.connection.setLocalDescription({ type: 'rollback' });
              } else {
                console.warn(`⚠️ 信令状态不是 stable (${currentSignalingState})，等待状态恢复...`);
                let waitCount = 0;
                while (peer.connection.signalingState !== 'stable' && waitCount < 20) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                  waitCount++;
                }

                if (peer.connection.signalingState !== 'stable') {
                  console.error(`❌ 信令状态未恢复到 stable，无法处理重新协商`);
                  peer.isNegotiating = false;
                  return;
                }
              }
            }

            // 设置远程描述（重新协商）
            await peer.connection.setRemoteDescription(new RTCSessionDescription(message.offer));
            console.log(`✅ 已设置重新协商的 Remote Description from ${peerId}`);
            
            // 创建 answer
            const answer = await peer.connection.createAnswer();
            await peer.connection.setLocalDescription(answer);
            
            // 发送 answer 通过 WebSocket
            const answerSent = this.sendWebSocketMessage({
              type: 'answer',
              from: this.localPlayerId,
              to: peerId,
              answer: {
                type: answer.type,
                sdp: answer.sdp,
              },
            });

            if (answerSent) {
              console.log(`✅ 重新协商的 Answer 已发送 to ${peerId}`);
            } else {
              console.warn(`⚠️ 重新协商的 Answer 发送失败 to ${peerId}`);
            }
            
            // 标记协商完成
            peer.isNegotiating = false;
            return;
          } catch (error) {
            console.error(`❌ 处理重新协商的 Offer 失败:`, error);
            peer.isNegotiating = false;
            // 如果重新协商失败，继续执行下面的逻辑（清理并重新创建连接）
          }
        }
        
        // 如果连接失败或断开，先清理旧连接
        console.log(`清理旧连接...`);
        this.removePeerConnection(peerId);
      }
      
      // 创建新的 peer connection
      await this.createPeerConnection(peerId);
      
      peer = this.peerConnections.get(peerId);
      if (!peer) {
        throw new Error('创建 Peer connection 失败');
      }
      
      // 标记正在协商
      peer.isNegotiating = true;
      
      // 设置远程描述
      await peer.connection.setRemoteDescription(new RTCSessionDescription(message.offer));
      peer.remoteDescriptionSet = true;
      console.log(`✅ 已设置 Remote Description from ${peerId}`);
      
      // 处理队列中的ICE候选
      if (peer.iceCandidateQueue.length > 0) {
        console.log(`📦 处理队列中的 ${peer.iceCandidateQueue.length} 个 ICE Candidate`);
        for (const candidate of peer.iceCandidateQueue) {
          try {
            await peer.connection.addIceCandidate(candidate);
          } catch (error) {
            console.error(`添加队列中的 ICE Candidate 失败:`, error);
          }
        }
        peer.iceCandidateQueue = [];
      }
      
      // 等待ICE候选收集开始
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 创建 answer
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      
      // 发送 answer 通过 WebSocket
      const answerSent = this.sendWebSocketMessage({
        type: 'answer',
        from: this.localPlayerId,
        to: peerId,
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
      });

      if (answerSent) {
        console.log(`✅ Answer 已发送 to ${peerId}`);
      } else {
        console.warn(`⚠️ Answer 发送失败 to ${peerId}`);
      }
      
      // 标记协商完成
      peer.isNegotiating = false;
      
    } catch (error) {
      console.error(`❌ 处理 Offer 失败:`, error);
      
      // 确保清除协商标记
      const peer = this.peerConnections.get(message.from);
      if (peer) {
        peer.isNegotiating = false;
      }
    }
  }

  /**
   * 处理WebSocket Answer
   */
  private async handleWebSocketAnswer(message: any): Promise<void> {
    try {
      const peerId = this.authenticatedPeerId(message);
      if (!peerId || !this.isSafeSessionDescription(message.answer, 'answer')) {
        console.warn('⚠️ 忽略未认证或格式无效的 Answer');
        return;
      }
      const peer = this.peerConnections.get(peerId);
      
      if (!peer) {
        console.warn(`⚠️ 未找到 peer: ${peerId}`);
        return;
      }
      
      // 设置远程描述
      await peer.connection.setRemoteDescription(new RTCSessionDescription(message.answer));
      peer.remoteDescriptionSet = true;
      console.log(`✅ 已设置 Remote Description (Answer) from ${peerId}`);
      
      // 处理队列中的ICE候选
      if (peer.iceCandidateQueue.length > 0) {
        console.log(`📦 处理队列中的 ${peer.iceCandidateQueue.length} 个 ICE Candidate`);
        for (const candidate of peer.iceCandidateQueue) {
          try {
            await peer.connection.addIceCandidate(candidate);
          } catch (error) {
            console.error(`添加队列中的 ICE Candidate 失败:`, error);
          }
        }
        peer.iceCandidateQueue = [];
      }
      
    } catch (error) {
      console.error(`❌ 处理 Answer 失败:`, error);
    }
  }

  /**
   * 处理WebSocket ICE Candidate
   */
  private async handleWebSocketIceCandidate(message: any): Promise<void> {
    try {
      const peerId = this.authenticatedPeerId(message);
      if (!peerId || !this.isSafeIceCandidate(message.candidate)) {
        console.warn('⚠️ 忽略未认证或格式无效的 ICE Candidate');
        return;
      }
      const peer = this.peerConnections.get(peerId);
      
      if (!peer) {
        console.warn(`⚠️ 未找到 peer: ${peerId}，忽略 ICE Candidate`);
        return;
      }
      
      const candidate = new RTCIceCandidate(message.candidate);
      
      // 如果远程描述还没设置，将候选加入队列
      if (!peer.remoteDescriptionSet) {
        console.log(`📦 远程描述未设置，将 ICE Candidate 加入队列 (${peerId})`);
        peer.iceCandidateQueue.push(candidate);
        return;
      }
      
      // 添加 ICE 候选
      await peer.connection.addIceCandidate(candidate);
      console.log(`✅ ICE Candidate 已添加 from ${peerId}`);
      
    } catch (error) {
      console.error(`❌ 处理 ICE Candidate 失败:`, error);
    }
  }

  /**
   * 发送WebSocket消息（公开方法，供外部调用）
   */
  public sendWebSocketMessage(message: any): boolean {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return false;
    }
    const messageType = message.type;
    if (!isSafeIdentifier(messageType, 64)) return false;
    if (message.from !== undefined && message.from !== this.localPlayerId) {
      console.warn('⚠️ 拒绝发送伪造发送者身份的信令消息');
      return false;
    }
    if (message.to !== undefined && (!isSafeIdentifier(message.to) || message.to === this.localPlayerId || !this.knownPlayers.has(message.to))) {
      console.warn('⚠️ 拒绝发送给未知信令目标');
      return false;
    }
    if (messageType === 'status-update' && message.clientId !== this.localPlayerId) {
      console.warn('⚠️ 拒绝发送伪造客户端身份的状态消息');
      return false;
    }
    if (messageType === 'chat-message' && message.playerId !== this.localPlayerId) {
      console.warn('⚠️ 拒绝发送伪造玩家身份的聊天消息');
      return false;
    }

    if (!this.websocket) {
      console.error('❌ WebSocket实例不存在，无法发送消息:', messageType);
      return false;
    }

    if (this.websocket.readyState === WebSocket.OPEN) {
      try {
        const serialized = JSON.stringify(message);
        if (serialized.length > 512 * 1024) {
          console.warn('⚠️ 拒绝发送过大的信令消息');
          return false;
        }
        this.websocket.send(serialized);
        return true;
      } catch (error) {
        console.error('❌ 发送WebSocket消息失败:', error, messageType);
        return false;
      }
    }

    const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const stateName = stateNames[this.websocket.readyState] || 'UNKNOWN';
    console.error(`❌ WebSocket未就绪(${stateName})，无法发送消息:`, messageType);
    return false;
  }

  private async renegotiatePeer(peerId: string, pc: PeerConnection): Promise<void> {
    if (pc.connection.signalingState !== 'stable') {
      console.warn('⚠️ 跳过重协商 ' + peerId + '，当前信令状态:', pc.connection.signalingState);
      return;
    }

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ 跳过重协商 ' + peerId + '，WebSocket未就绪');
      return;
    }

    pc.isNegotiating = true;
    try {
      const offer = await pc.connection.createOffer();
      await pc.connection.setLocalDescription(offer);

      const sent = this.sendWebSocketMessage({
        type: 'offer',
        from: this.localPlayerId,
        to: peerId,
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
      });

      if (sent) {
        console.log('✅ 已发送重新协商 offer to ' + peerId);
      } else {
        console.warn('⚠️ 重新协商 offer 发送失败 to ' + peerId);
      }
    } catch (error) {
      console.error('❌ 重新协商失败 (' + peerId + '):', error);
    } finally {
      pc.isNegotiating = false;
    }
  }

  private async sendOfferWithRetry(peerId: string, offer: RTCSessionDescriptionInit, context: string): Promise<boolean> {
    const sent = this.sendWebSocketMessage({
      type: 'offer',
      from: this.localPlayerId,
      to: peerId,
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
    });

    if (sent) {
      console.log(`✅ ${context} Offer 已发送 to ${peerId}`);
      return true;
    }

    console.warn(`⚠️ ${context} Offer 首次发送失败，500ms 后重试: ${peerId}`);
    await new Promise(resolve => setTimeout(resolve, 500));

    const retrySent = this.sendWebSocketMessage({
      type: 'offer',
      from: this.localPlayerId,
      to: peerId,
      offer: {
        type: offer.type,
        sdp: offer.sdp,
      },
    });

    if (retrySent) {
      console.log(`✅ ${context} Offer 重试发送成功 to ${peerId}`);
      return true;
    }

    console.warn(`⚠️ ${context} Offer 重试仍失败 to ${peerId}`);
    return false;
  }

  /**
   * 设置后端事件监听器（用于状态更新等）
   */
  private async setupBackendListeners(): Promise<void> {
    try {
      // 监听状态更新事件
      await listen<SignalingMessage>('player-status-update', (event) => {
        try {
          console.log('收到 player-status-update 事件:', event.payload);
          const { playerId, micEnabled } = event.payload;
          if (playerId && micEnabled !== undefined) {
            this.handleStatusUpdate(playerId, micEnabled);
          }
        } catch (error) {
          console.error('处理 player-status-update 事件失败:', error);
        }
      });

      console.log('✅ 后端事件监听器已设置');
    } catch (error) {
      console.error('❌ 设置后端事件监听器失败:', error);
      throw error;
    }
  }

  /**
   * 移除对等连接（内部方法，不触发回调）
   */
  private schedulePeerReconnect(peerId: string, reason: string, delayMs: number): void {
    if (this.isIntentionalDisconnect) {
      return;
    }

    if (this.reconnectTimers.has(peerId)) {
      console.log(`[WebRTC] ${peerId} 已存在重连定时器，跳过重复调度（${reason}）`);
      return;
    }

    const timer = window.setTimeout(async () => {
      this.reconnectTimers.delete(peerId);
      if (!this.knownPlayers.has(peerId)) {
        console.log(`[WebRTC] ${peerId} 已离开大厅，取消过期重连任务`);
        return;
      }

      const currentPc = this.peerConnections.get(peerId);
      if (this.isPeerConnectedOrFresh(currentPc)) {
        console.log(`[WebRTC] ${peerId} 连接已恢复，取消重连（${reason}）`);
        return;
      }

      if (this.reconnectingPeers.has(peerId)) {
        console.log(`[WebRTC] ${peerId} 正在重连中，跳过重复重连（${reason}）`);
        return;
      }

      if (this.localPlayerId <= peerId) {
        // 较小 ID 一方默认等待对方主动重连；但为避免「对方未察觉故障」导致永久掉线，
        // 安排一个兜底定时器：若再过一段时间仍未连上，则强制由自己发起重连
        console.log(`[WebRTC] 等待 ${peerId} 主动重连（ID字典序较小），并设置兜底重连`);
        if (this.reconnectTimers.has(peerId)) return;
        const fallbackTimer = window.setTimeout(async () => {
          this.reconnectTimers.delete(peerId);
          if (this.isIntentionalDisconnect) return;
          if (!this.knownPlayers.has(peerId)) return;
          const pc = this.peerConnections.get(peerId);
          if (this.isPeerConnectedOrFresh(pc)) {
            return; // 已恢复
          }
          if (this.reconnectingPeers.has(peerId)) return;
          this.reconnectingPeers.add(peerId);
          try {
            console.log(`[WebRTC] 兜底强制重连 ${peerId}（对方迟迟未重连）`);
            await this.handleReconnect(peerId, true);
          } finally {
            this.reconnectingPeers.delete(peerId);
          }
        }, 6000);
        this.reconnectTimers.set(peerId, fallbackTimer);
        return;
      }

      this.reconnectingPeers.add(peerId);
      try {
        console.log(`[WebRTC] 触发重连 ${peerId}，原因: ${reason}`);
        await this.handleReconnect(peerId);
      } finally {
        this.reconnectingPeers.delete(peerId);
      }
    }, delayMs);

    this.reconnectTimers.set(peerId, timer);
  }

  private clearPeerReconnectState(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
    this.reconnectingPeers.delete(peerId);
  }

  private startVoiceHealthMonitor(): void {
    if (this.voiceHealthInterval !== null) return;
    this.voiceHealthInterval = window.setInterval(() => {
      void this.checkVoiceHealth();
    }, 10000);
  }

  private async checkVoiceHealth(): Promise<void> {
    if (this.voiceHealthCheckRunning || this.isIntentionalDisconnect) return;
    this.voiceHealthCheckRunning = true;
    try {
      const { useAppStore } = await import('../../stores');
      const state = useAppStore.getState();
      const now = Date.now();
      for (const [peerId, peer] of this.peerConnections) {
        if (peer.connection.connectionState !== 'connected' || !peer.audioElement) continue;
        const remotePlayer = state.players.find((player) => player.id === peerId);
        if (!remotePlayer?.micEnabled) {
          this.voiceHealth.delete(peerId);
          continue;
        }

        const stats = await peer.connection.getStats();
        let packets = 0;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio') {
            packets += Number(report.packetsReceived ?? 0);
          }
        });

        const previous = this.voiceHealth.get(peerId);
        if (!previous || packets > previous.packets) {
          this.voiceHealth.set(peerId, { packets, noProgressSince: 0 });
          continue;
        }
        const noProgressSince = previous.noProgressSince || now;
        this.voiceHealth.set(peerId, { packets, noProgressSince });
        if (now - noProgressSince >= 30000 && !this.reconnectingPeers.has(peerId)) {
          console.warn(`⚠️ ${peerId} 远端麦克风已开启但音频包 30 秒未增长，调度语音重建`);
          this.schedulePeerReconnect(peerId, '远端音频无数据', 500);
          this.voiceHealth.set(peerId, { packets, noProgressSince: now });
        }
      }
    } catch (error) {
      console.warn('语音健康检查失败:', error);
    } finally {
      this.voiceHealthCheckRunning = false;
    }
  }

  private removePeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        // 清除连接超时定时器
        if (pc.connectionTimeout) {
          clearTimeout(pc.connectionTimeout);
        }
        
        // 停止并清理音频播放
        if (pc.audioElement) {
          try {
            pc.audioElement.pause();
            pc.audioElement.srcObject = null;
            pc.audioElement.src = '';
            pc.audioElement.load(); // 重置音频元素
            pc.audioElement.remove(); // 从DOM中移除（如果已添加）
          } catch (audioError) {
            console.warn(`清理音频元素失败 (${peerId}):`, audioError);
          }
        }
        
        // 停止音频流的所有轨道
        if (pc.audioStream) {
          try {
            pc.audioStream.getTracks().forEach(track => {
              try {
                track.stop();
              } catch (trackError) {
                console.warn(`停止音频轨道失败:`, trackError);
              }
            });
          } catch (streamError) {
            console.warn(`停止音频流失败 (${peerId}):`, streamError);
          }
        }
        
        // 关闭数据通道
        if (pc.dataChannel) {
          try {
            // 移除所有事件监听器
            pc.dataChannel.onopen = null;
            pc.dataChannel.onclose = null;
            pc.dataChannel.onerror = null;
            pc.dataChannel.onmessage = null;
            
            // 只有在数据通道未关闭时才关闭
            if (pc.dataChannel.readyState !== 'closed') {
              pc.dataChannel.close();
            }
          } catch (dcError) {
            console.warn(`关闭数据通道失败 (${peerId}):`, dcError);
          }
        }
        
        // 关闭连接
        try {
          // 移除所有事件监听器
          pc.connection.onicecandidate = null;
          pc.connection.ontrack = null;
          pc.connection.onconnectionstatechange = null;
          pc.connection.oniceconnectionstatechange = null;
          pc.connection.onicegatheringstatechange = null;
          pc.connection.ondatachannel = null;
          
          // 只有在连接未关闭时才关闭
          if (pc.connection.connectionState !== 'closed') {
            pc.connection.close();
          }
        } catch (connError) {
          console.warn(`关闭连接失败 (${peerId}):`, connError);
        }
        
        this.peerConnections.delete(peerId);
        this.voiceHealth.delete(peerId);
        console.log(`✅ 已移除 peer connection: ${peerId}`);
      } catch (error) {
        console.error(`❌ 移除 peer connection 失败 (${peerId}):`, error);
        // 即使出错也要删除连接
        this.peerConnections.delete(peerId);
      }
    }
  }

  /**
   * 移除对等连接（公开方法，触发回调）
   */
  private removePeer(peerId: string): void {
    this.clearPeerReconnectState(peerId);
    this.removePeerConnection(peerId);
    
    // 触发回调
    if (this.onPlayerLeftCallback) {
      this.onPlayerLeftCallback(peerId);
    } else {
      this.pendingPlayerJoined.delete(peerId);
    }
  }

  /**
   * 处理重连
   */
  private async handleReconnect(peerId: string, forceInitiate: boolean = false): Promise<void> {
    try {
      console.log(`🔄 开始重连 ${peerId}...（forceInitiate=${forceInitiate}）`);
      
      // 检查是否已经在重连中
      const existingPeer = this.peerConnections.get(peerId);
      if (existingPeer && this.isPeerConnectedOrFresh(existingPeer)) {
        console.log(`⏳ ${peerId} 已经在重连中，跳过...`);
        return;
      }
      
      // 移除旧连接（不触发回调）
      this.removePeerConnection(peerId);
      
      // 等待一小段时间让旧连接完全关闭
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // ID字典序较大的一方主动重连；或在兜底场景下由较小一方强制发起，
      // 避免「较大一方未察觉故障」时双方都不重连导致永久掉线
      if (forceInitiate || this.localPlayerId > peerId) {
        console.log(`📡 主动重连 ${peerId}（${forceInitiate ? '兜底强制发起' : 'ID字典序较大'}）`);
        
        // 创建新连接
        await this.createPeerConnection(peerId);
        
        const pc = this.peerConnections.get(peerId);
        if (!pc) {
          throw new Error('创建 Peer Connection 失败');
        }
        
        // 等待ICE候选收集开始
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 创建并发送 offer（使用 ICE restart）
        const offer = await pc.connection.createOffer({ iceRestart: true });
        await pc.connection.setLocalDescription(offer);
        
        const sent = await this.sendOfferWithRetry(peerId, {
          type: offer.type,
          sdp: offer.sdp,
        }, '重连');
        if (!sent) throw new Error('重连 Offer 未送达');
      } else {
        console.log(`⏳ 等待 ${peerId} 主动重连（ID字典序较小）`);
      }
    } catch (error) {
      console.error(`❌ 重连失败 ${peerId}:`, error);
      if (!this.isIntentionalDisconnect && this.knownPlayers.has(peerId)) {
        this.schedulePeerReconnect(peerId, '重连失败后再次尝试', 5000);
      }
    }
  }

  /**
   * 处理状态更新
   */
  private handleStatusUpdate(playerId: string, micEnabled: boolean): void {
    try {
      console.log(`玩家状态更新: ${playerId}, 麦克风: ${micEnabled}`);

      // 触发回调
      if (this.onStatusUpdateCallback) {
        this.onStatusUpdateCallback(playerId, micEnabled);
      }
    } catch (error) {
      console.error('处理状态更新失败:', error);
    }
  }

  /**
   * 创建 Peer Connection
   */
  private async createPeerConnection(peerId: string): Promise<void> {
    try {
      console.log(`📡 创建 Peer Connection for ${peerId}...`);
      
      // 配置RTCPeerConnection - 使用与测试成功版本相同的配置
      const config: RTCConfiguration = {
        iceServers: this.iceServers,
        iceTransportPolicy: 'all',
      };
      
      const pc = new RTCPeerConnection(config);
      console.log('RTCPeerConnection 实例已创建');
      console.log('虚拟IP:', this.virtualIp || '未设置');
      console.log('ICE Servers:', config.iceServers);
      console.log('ICE Transport Policy:', config.iceTransportPolicy);

      // 添加本地音频轨道（如果有的话）
      if (this.localStream) {
        let trackCount = 0;
        this.localStream.getTracks().forEach((track) => {
          if (this.localStream) {
            pc.addTrack(track, this.localStream);
            trackCount++;
            console.log(`已添加音频轨道 ${trackCount}: ${track.kind}, enabled: ${track.enabled}`);
          }
        });
      } else {
        // 即使没有音频流，也添加一个空的音频轨道占位
        // 这样后续可以使用 replaceTrack 而不需要重新协商
        const emptyStream = new MediaStream();
        pc.addTransceiver('audio', {
          direction: 'sendrecv',
          streams: [emptyStream],
        });
        console.log('✅ 已添加空音频轨道占位');
      }

      // 处理 ICE 候选
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log(`🧊 ICE Candidate 生成 for ${peerId}:`);
          console.log('  - Type:', event.candidate.type);
          console.log('  - Protocol:', event.candidate.protocol);
          console.log('  - Address:', event.candidate.address);
          console.log('  - Port:', event.candidate.port);
          
          // 接受所有类型的ICE候选以支持跨局域网连接
          console.log(`✅ 接受 ${event.candidate.type} 类型的候选: ${event.candidate.address}`);
          
          try {
            // 通过 WebSocket 发送 ICE 候选
            this.sendWebSocketMessage({
              type: 'ice-candidate',
              from: this.localPlayerId,
              to: peerId,
              candidate: {
                candidate: event.candidate.candidate,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sdpMid: event.candidate.sdpMid,
              },
            });
            console.log(`✅ ICE Candidate 已发送 to ${peerId}`);
          } catch (error) {
            console.error(`❌ 发送 ICE Candidate 失败 to ${peerId}:`, error);
          }
        } else {
          console.log(`🧊 ICE 候选收集完成 for ${peerId}`);
        }
      };

      // 监听连接状态变化
      pc.onconnectionstatechange = async () => {
        console.log(`🔗 连接状态变化 (${peerId}): ${pc.connectionState}`);
        
        const peer = this.peerConnections.get(peerId);
        if (!peer) {
          console.warn(`⚠️ 连接状态变化时未找到 peer: ${peerId}`);
          return;
        }
        
        if (pc.connectionState === 'connected') {
          console.log(`✅ 与 ${peerId} 的连接已建立`);
          this.clearPeerReconnectState(peerId);
          
          // 清除连接超时定时器
          if (peer.connectionTimeout) {
            clearTimeout(peer.connectionTimeout);
            peer.connectionTimeout = undefined;
          }
        } else if (pc.connectionState === 'failed') {
          console.warn(`⚠️ 与 ${peerId} 的连接失败`);
          
          // 清除连接超时定时器
          if (peer.connectionTimeout) {
            clearTimeout(peer.connectionTimeout);
            peer.connectionTimeout = undefined;
          }
          
          // 清除旧的重连定时器
          this.clearPeerReconnectState(peerId);
          
          // 双方都进入独立重连状态机。调度器负责去重，并为较小 ID
          // 提供延迟兜底发起，避免一方故障时双方永久互等。
          console.log(`🔄 连接失败，调度重连 ${peerId}...`);
          this.schedulePeerReconnect(peerId, '连接失败', 4000);
        } else if (pc.connectionState === 'disconnected') {
          console.warn(`⚠️ 与 ${peerId} 的连接断开`);
          
          // 清除旧的重连定时器
          this.clearPeerReconnectState(peerId);
          
          // 给 ICE 留出恢复窗口，恢复失败后由双方状态机协同重建。
          console.log(`🔄 连接断开，调度重连 ${peerId}...`);
          this.schedulePeerReconnect(peerId, '连接断开', 6000);
        } else if (pc.connectionState === 'closed') {
          console.log(`🔒 与 ${peerId} 的连接已关闭`);
          this.removePeerConnection(peerId);
        }
      };

      // 监听 ICE 连接状态
      pc.oniceconnectionstatechange = () => {
        console.log(`❄️ ICE 连接状态 (${peerId}): ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
          console.error(`❌ ICE 连接失败 with ${peerId}`);
          this.schedulePeerReconnect(peerId, 'ICE连接失败', 4000);
        } else if (pc.iceConnectionState === 'disconnected') {
          this.schedulePeerReconnect(peerId, 'ICE连接断开', 5000);
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          console.log(`✅ ICE 连接成功 with ${peerId}`);
        }
      };
      
      // 监听 ICE gathering 状态
      pc.onicegatheringstatechange = () => {
        console.log(`🔍 ICE Gathering 状态 (${peerId}): ${pc.iceGatheringState}`);
      };

      // 处理远程音频流
      pc.ontrack = (event) => {
        console.log(`🎵 接收到远程音频流 from ${peerId}`);
        console.log('Stream ID:', event.streams[0]?.id);
        console.log('Track kind:', event.track.kind);
        console.log('Track enabled:', event.track.enabled);
        
        if (event.streams[0]) {
          try {
            // 创建音频元素播放远程音频
            const audioElement = new Audio();
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            audioElement.volume = 1.0;

            // 应用用户选定的输出设备（若浏览器支持 setSinkId）
            const preferredOutput = audioDevices.getOutputDeviceId();
            if (preferredOutput && typeof (audioElement as any).setSinkId === 'function') {
              (audioElement as any).setSinkId(preferredOutput).catch((e: any) => {
                console.warn('设置输出设备失败（使用默认）:', e);
              });
            }

            // 保存音频元素和流
            const peerConn = this.peerConnections.get(peerId);
            if (peerConn) {
              peerConn.audioStream = event.streams[0];
              peerConn.audioElement = audioElement;
              console.log(`✅ 音频元素已保存 for ${peerId}`);
              localVqeService.setReferenceStreams(
                Array.from(this.peerConnections.values())
                  .map((peer) => peer.audioStream)
                  .filter((stream): stream is MediaStream => Boolean(stream)),
              );
            }

            // 【修复】对新建立 / 重连的对端应用当前已有的静音和音量设置，
            // 否则后加入或重连的玩家会以默认 1.0 音量、未静音播放（旧逻辑写死 volume=1.0）
            this.applyCurrentAudioState(peerId, audioElement);
            
            // 监听播放事件
            audioElement.onplay = () => {
              console.log(`✅ 开始播放 ${peerId} 的音频`);
            };
            
            audioElement.onerror = (e) => {
              console.error(`❌ 播放 ${peerId} 的音频失败:`, e);
            };
            
            // 触发回调
            if (this.onRemoteStreamCallback) {
              this.onRemoteStreamCallback(peerId, event.streams[0]);
            }
          } catch (error) {
            console.error(`❌ 处理远程音频流失败 (${peerId}):`, error);
          }
        }
      };

      // 创建数据通道
      const dataChannel = pc.createDataChannel('status', {
        ordered: true,
        maxRetransmits: 3,
      });
      
      dataChannel.onopen = () => {
        console.log(`📢 数据通道已打开 with ${peerId}`);
      };
      
      dataChannel.onclose = () => {
        console.log(`📢 数据通道已关闭 with ${peerId}`);
      };
      
      dataChannel.onerror = (error) => {
        if (this.isExpectedChannelCloseError(error)) {
          console.log(`ℹ️ 数据通道正常关闭 with ${peerId}`);
          return;
        }

        console.error(`❌ 数据通道错误 with ${peerId}:`, error);
        // 数据通道错误不应该导致整个连接失败
        // 只记录错误，不触发重连
      };
      
      // 创建文件传输专用数据通道（大缓冲区，无序传输以提高速度）
      const fileTransferChannel = pc.createDataChannel('file-transfer', {
        ordered: false, // 无序传输，提高速度
        maxPacketLifeTime: 3000, // 3秒超时
      });
      
      // 设置大缓冲区阈值
      fileTransferChannel.bufferedAmountLowThreshold = 256 * 1024; // 256KB
      
      fileTransferChannel.onopen = () => {
        console.log(`📁 文件传输通道已打开 with ${peerId}`);
      };
      
      fileTransferChannel.onclose = () => {
        console.log(`📁 文件传输通道已关闭 with ${peerId}`);
      };
      
      fileTransferChannel.onerror = (error) => {
        if (this.isExpectedChannelCloseError(error)) {
          console.log(`ℹ️ 文件传输通道正常关闭 with ${peerId}`);
          return;
        }

        console.error(`❌ 文件传输通道错误 with ${peerId}:`, error);
      };
      
      fileTransferChannel.onmessage = (event) => {
        // 处理接收到的文件数据
        fileTransferService.handleDataChannelMessage(peerId, event.data);
      };
      
      // 监听对方创建的数据通道
      pc.ondatachannel = (event) => {
        console.log(`📥 收到数据通道 from ${peerId}: ${event.channel.label}`);
        const receivedChannel = event.channel;
        
        if (receivedChannel.label === 'file-transfer') {
          // 文件传输通道
          receivedChannel.bufferedAmountLowThreshold = 256 * 1024;
          
          receivedChannel.onopen = () => {
            console.log(`📁 接收的文件传输通道已打开 with ${peerId}`);
          };
          
          receivedChannel.onclose = () => {
            console.log(`📁 接收的文件传输通道已关闭 with ${peerId}`);
          };
          
          receivedChannel.onerror = (error) => {
            if (this.isExpectedChannelCloseError(error)) {
              console.log(`ℹ️ 接收的文件传输通道正常关闭 with ${peerId}`);
              return;
            }

            console.error(`❌ 接收的文件传输通道错误 with ${peerId}:`, error);
          };
          
          receivedChannel.onmessage = (event) => {
            fileTransferService.handleDataChannelMessage(peerId, event.data);
          };
          
          const peerConn = this.peerConnections.get(peerId);
          if (peerConn) {
            peerConn.fileTransferChannel = receivedChannel;
          }
        } else {
          // 状态通道
          receivedChannel.onopen = () => {
            console.log(`📢 接收的数据通道已打开 with ${peerId}`);
          };
          
          receivedChannel.onclose = () => {
            console.log(`📢 接收的数据通道已关闭 with ${peerId}`);
          };
          
          receivedChannel.onerror = (error) => {
            if (this.isExpectedChannelCloseError(error)) {
              console.log(`ℹ️ 接收的数据通道正常关闭 with ${peerId}`);
              return;
            }

            console.error(`❌ 接收的数据通道错误 with ${peerId}:`, error);
          };
          
          const peerConn = this.peerConnections.get(peerId);
          if (peerConn) {
            peerConn.dataChannel = receivedChannel;
          }
        }
      };

      // 保存连接
      const peerConnection: PeerConnection = {
        id: peerId,
        connection: pc,
        dataChannel,
        fileTransferChannel,
        iceCandidateQueue: [],
        remoteDescriptionSet: false,
        isNegotiating: false,
        createdAt: Date.now(),
      };
      
      this.peerConnections.set(peerId, peerConnection);
      
      // 设置连接超时（30秒）
      peerConnection.connectionTimeout = window.setTimeout(() => {
        const currentPc = this.peerConnections.get(peerId);
        if (currentPc && currentPc.connection.connectionState !== 'connected') {
          console.warn(`⏰ 连接超时 (${peerId})，状态: ${currentPc.connection.connectionState}`);
          
          console.log(`🔄 连接超时，调度重连 ${peerId}...`);
          this.schedulePeerReconnect(peerId, '连接超时', 2000);
        }
      }, 30000);

      console.log(`✅ Peer Connection 创建成功 for ${peerId}`);
    } catch (error) {
      console.error(`❌ 创建 Peer Connection 失败 for ${peerId}:`, error);
      throw error;
    }
  }

  /** 请求麦克风权限。拒绝后交给全局权限恢复界面处理，不做无意义的循环请求。 */
  private async requestMicrophonePermission(notifyPermissionRequired = true): Promise<MediaStream> {
    try {
      console.log('🎤 正在请求麦克风权限...');
      const preferredInput = audioDevices.getInputDeviceId();
      const audioConstraints: MediaTrackConstraints = {
        // Sonora owns AEC and noise suppression on the desktop path. Keeping
        // Chromium AEC enabled here would process the same speech twice and
        // is audible as clipped consonants and swallowed word endings.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (preferredInput) {
        (audioConstraints as any).deviceId = { ideal: preferredInput };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
      console.log('✅ 麦克风权限已获取');
      return stream;
    } catch (error: any) {
      if (notifyPermissionRequired && (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError')) {
        console.warn('⚠️ 麦克风权限被拒绝，显示权限恢复入口');
        window.dispatchEvent(new CustomEvent('mctier-microphone-permission-required', {
          detail: { resumeMic: this.desiredMicEnabled },
        }));
      }
      throw error;
    }
  }

  /** 供设置页和权限恢复弹窗主动重新触发系统授权。 */
  async requestMicrophoneAccess(notifyPermissionRequired = true): Promise<void> {
    const stream = await this.requestMicrophonePermission(notifyPermissionRequired);
    stream.getTracks().forEach(track => track.stop());
  }

  /**
   * 设置麦克风状态（对外入口，串行执行并向最新目标收敛）
   *
   * 【竞态修复】开麦/关麦是耗时操作（getUserMedia + 逐 peer 替换音轨 + 重协商，
   * 内部还有等待协商完成的轮询），而调用方多为「fire-and-forget」。若用户快速连续
   * 切换（连点按钮、F2 按住说话的按下/松开），两次操作会交叠执行：较慢的「开麦」
   * 可能在「关麦」之后才完成并把音轨重新加回去，导致界面显示已关麦、实际仍在传声，
   * 必须再手动开关一次才恢复正常。
   *
   * 这里记录「期望状态」并把实际操作串行化：同一时刻只有一个操作在跑，跑完后若期望
   * 状态又变了就继续收敛，保证最终实际状态与界面/后端一致。
   */
  async setMicEnabled(enabled: boolean): Promise<void> {
    this.desiredMicEnabled = enabled;
    const run = this.micOpChain.then(() => this.convergeMicState());
    // 保存链尾（吞掉异常，避免一次失败后整条链被 reject 而后续操作全部不执行）
    this.micOpChain = run.catch(() => { /* 错误已在内部记录 */ });
    return run;
  }

  /** 反复应用麦克风状态，直到实际状态与最新期望一致 */
  private async convergeMicState(): Promise<void> {
    // 最多收敛若干轮，避免极端情况下的无限循环
    for (let i = 0; i < 5; i++) {
      const target = this.desiredMicEnabled;
      if (target === this.micActuallyEnabled) {
        return; // 已是目标状态，无需重复操作
      }
      await this.applyMicState(target);
      if (this.desiredMicEnabled === this.micActuallyEnabled) {
        return;
      }
    }
    console.warn('⚠️ 麦克风状态收敛超过重试上限，当前实际状态:', this.micActuallyEnabled);
  }

  /**
   * 实际执行麦克风开/关
   * 第一次开麦时获取麦克风，之后只启用/禁用轨道，不释放资源
   */
  private async applyMicState(enabled: boolean): Promise<void> {
    try {
      console.log('🎤 设置麦克风状态:', enabled ? '开启' : '关闭');

      if (enabled) {
        console.log('正在获取麦克风权限...');

        // 使用带重试机制的权限请求
        const rawStream = await this.requestMicrophonePermission();

        console.log('✅ 麦克风权限已获取');
        // 应用变声器：对原始麦克风做实时变声，输出处理后的流用于发送
        if (this.rawMicStream) {
          this.rawMicStream.getTracks().forEach((t) => t.stop());
        }
        this.rawMicStream = rawStream;
        // AEC must see the original microphone waveform. Applying pitch/time
        // effects first breaks the relationship with the render reference.
        const cleanStream = await localVqeService.processStream(rawStream);
        const newStream = voiceChangerService.process(cleanStream);
        localVqeService.setReferenceStreams(
          Array.from(this.peerConnections.values())
            .map((peer) => peer.audioStream)
            .filter((stream): stream is MediaStream => Boolean(stream)),
        );
        const newAudioTrack = newStream.getAudioTracks()[0];

        for (const [peerId, pc] of this.peerConnections) {
          const transceivers = pc.connection.getTransceivers();
          const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio');

          if (audioTransceiver && audioTransceiver.sender) {
            await audioTransceiver.sender.replaceTrack(newAudioTrack);
            console.log('✅ 已替换 peer ' + peerId + ' 的音频轨道');
          } else {
            pc.connection.addTrack(newAudioTrack, newStream);
            console.log('✅ 已添加 peer ' + peerId + ' 的音频轨道');
            // 只有旧客户端没有预建 audio transceiver 时才需要协商。
            await this.renegotiatePeer(peerId, pc);
          }
        }

        if (this.localStream) {
          const oldTracks = this.localStream.getAudioTracks();
          oldTracks.forEach(track => track.stop());
        }

        this.localStream = newStream;
        try { this.onLocalStreamCallback?.(newStream); } catch { /* ignore */ }
      } else {
        // 先停止本地音轨（若有）
        if (this.localStream) {
          const audioTracks = this.localStream.getAudioTracks();
          console.log('正在停止并释放', audioTracks.length, '个音频轨道...');
          audioTracks.forEach((track, index) => {
            track.stop();
            console.log('轨道 ' + (index + 1) + ' 已停止并释放');
          });
        }

        // 【关键】无论 localStream 是否存在，都必须清空每个 peer 上正在发送的音频轨道。
        // 旧实现把这段放在 if (this.localStream) 内部，一旦状态出现漂移（localStream 已为空
        // 但 sender 上仍挂着轨道），关麦就会「看起来成功、实际仍在传声」。
        for (const [peerId, pc] of this.peerConnections) {
          const audioTransceiver = pc.connection.getTransceivers().find(t => t.receiver.track.kind === 'audio');

          if (audioTransceiver?.sender) {
            await audioTransceiver.sender.replaceTrack(null);
            console.log('✅ 已移除 peer ' + peerId + ' 的音频轨道');
          }
        }

        this.localStream = null;
        // 停止原始麦克风流并释放变声器
        if (this.rawMicStream) {
          this.rawMicStream.getTracks().forEach((t) => t.stop());
          this.rawMicStream = null;
        }
        // Keep the warmed model alive while the user is still in the lobby.
        await localVqeService.deactivate();
        voiceChangerService.dispose();
        try { this.onLocalStreamCallback?.(null); } catch { /* ignore */ }
        console.log('✅ 麦克风已关闭，资源已释放');
      }

      // 记录实际生效的状态，供收敛逻辑判断
      this.micActuallyEnabled = enabled;

      await this.broadcastStatusUpdate(enabled);
      console.log('✅ 麦克风状态已更新并广播');
    } catch (error) {
      console.error('❌ 设置麦克风状态失败:', error);
      throw error;
    }
  }


  /**
   * 根据当前 Store 中的全局静音 / 单人静音 / 单人音量设置，应用到指定玩家的音频元素。
   * 用于新建立连接或重连后，确保不会以默认（未静音、满音量）播放。
   */
  private applyCurrentAudioState(playerId: string, audioElement: HTMLAudioElement): void {
    // 动态导入 store，避免循环依赖；fire-and-forget，延迟极小可接受
    import('../../stores')
      .then(({ useAppStore }) => {
        const state = useAppStore.getState();
        const globalMuted: boolean = state.globalMuted;
        const mutedPlayers: Set<string> = state.mutedPlayers as Set<string>;
        const playerVolumes: Map<string, number> = state.playerVolumes as Map<string, number>;
        const myGroup: number = state.myVoiceGroup ?? 0;
        const theirGroup: number = state.playerVoiceGroups?.get(playerId) ?? 0;
        const sameVoiceGroup = theirGroup === myGroup;

        // 全局静音
        audioElement.muted = !!globalMuted;

        // 单人静音 / 单人音量
        if (!sameVoiceGroup || (mutedPlayers && mutedPlayers.has(playerId))) {
          audioElement.volume = 0;
        } else {
          const vol = playerVolumes && playerVolumes.has(playerId)
            ? playerVolumes.get(playerId)!
            : 1.0;
          audioElement.volume = Math.max(0, Math.min(1, vol));
        }

        console.log(`🎚️ 已对 ${playerId} 应用现有音频状态: muted=${audioElement.muted}, volume=${audioElement.volume}`);
      })
      .catch((err) => {
        console.warn('应用现有音频状态失败（使用默认值）:', err);
      });
  }

  /**
   * 静音指定玩家
   */
  mutePlayer(playerId: string): void {
    try {
      const pc = this.peerConnections.get(playerId);
      if (pc && pc.audioElement) {
        pc.audioElement.volume = 0;
        console.log(`已静音玩家: ${playerId}`);
      }
    } catch (error) {
      console.error('静音玩家失败:', error);
    }
  }

  /**
   * 取消静音指定玩家
   */
  unmutePlayer(playerId: string): void {
    try {
      const pc = this.peerConnections.get(playerId);
      if (pc && pc.audioElement) {
        pc.audioElement.volume = 1.0;
        console.log(`已取消静音玩家: ${playerId}`);
      }
    } catch (error) {
      console.error('取消静音玩家失败:', error);
    }
  }

  /**
   * 全局静音所有玩家
   */
  muteAllPlayers(): void {
    try {
      this.peerConnections.forEach((pc) => {
        if (pc.audioElement) {
          pc.audioElement.muted = true;
        }
      });
      console.log('已全局静音所有玩家');
    } catch (error) {
      console.error('全局静音失败:', error);
    }
  }

  /**
   * 取消全局静音
   */
  unmuteAllPlayers(): void {
    try {
      this.peerConnections.forEach((pc) => {
        if (pc.audioElement) {
          pc.audioElement.muted = false;
        }
      });
      console.log('已取消全局静音');
    } catch (error) {
      console.error('取消全局静音失败:', error);
    }
  }

  /**
   * 设置所有玩家的音量
   * @param volume 音量值 (0.0-1.0)
   */
  setVolume(volume: number): void {
    try {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      this.peerConnections.forEach((pc) => {
        if (pc.audioElement && !pc.audioElement.muted) {
          pc.audioElement.volume = clampedVolume;
        }
      });
      console.log(`已设置所有玩家音量: ${Math.round(clampedVolume * 100)}%`);
    } catch (error) {
      console.error('设置音量失败:', error);
    }
  }

  /**
   * 设置指定玩家的音量
   * @param playerId 玩家ID
   * @param volume 音量值 (0.0-1.0)
   */
  setPlayerVolume(playerId: string, volume: number): void {
    try {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      const pc = this.peerConnections.get(playerId);
      if (pc && pc.audioElement) {
        pc.audioElement.volume = clampedVolume;
        console.log(`已设置玩家 ${playerId} 音量: ${Math.round(clampedVolume * 100)}%`);
      }
    } catch (error) {
      console.error(`设置玩家 ${playerId} 音量失败:`, error);
    }
  }

  /**
   * 广播状态更新（通过WebSocket信令服务器）
   */
  private async broadcastStatusUpdate(micEnabled: boolean): Promise<void> {
    try {
      const sent = this.sendWebSocketMessage({
        type: 'status-update',
        clientId: this.localPlayerId,
        micEnabled,
      });

      if (sent) {
        console.log('✅ 状态更新已通过WebSocket广播: 麦克风' + (micEnabled ? '开启' : '关闭'));
      } else {
        console.warn('⚠️ 状态更新发送失败: 麦克风' + (micEnabled ? '开启' : '关闭'));
      }
    } catch (error) {
      console.error('❌ 广播状态更新失败:', error);
    }
  }


  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(async () => {
      try {
        await invoke('send_heartbeat', {
          playerId: this.localPlayerId,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error('发送心跳失败:', error);
      }
    }, 15000); // 【优化】改为每15秒发送一次心跳，提高检测频率，避免误判离开
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 启动 WebSocket 心跳保活
   * 优化：减少心跳间隔和超时时间，提高连接稳定性
   */
  private startWebSocketHeartbeat(): void {
    // 清理旧的心跳定时器
    this.stopWebSocketHeartbeat();
    
    // 每 15 秒发送一次 ping（从30秒优化为15秒）
    this.websocketHeartbeatInterval = window.setInterval(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        try {
          this.websocket.send(JSON.stringify({ type: 'ping' }));
          
          // 设置 pong 超时（5秒内没收到 pong 就认为连接断开，从10秒优化为5秒）
          this.websocketPongTimeout = window.setTimeout(() => {
            console.warn('⚠️ WebSocket 心跳超时（5秒未收到pong），主动断开重连');
            if (this.websocket) {
              this.websocket.close();
            }
          }, 5000);
        } catch (error) {
          console.error('❌ 发送 WebSocket ping 失败:', error);
        }
      }
    }, 15000);
    
    console.log('✅ WebSocket 心跳已启动（间隔15秒，超时5秒）');
  }

  /**
   * 停止 WebSocket 心跳保活
   */
  private stopWebSocketHeartbeat(): void {
    if (this.websocketHeartbeatInterval !== null) {
      clearInterval(this.websocketHeartbeatInterval);
      this.websocketHeartbeatInterval = null;
    }
    if (this.websocketPongTimeout !== null) {
      clearTimeout(this.websocketPongTimeout);
      this.websocketPongTimeout = null;
    }
  }

  /**
   * 处理 WebSocket pong 响应
   */
  private handleWebSocketPong(): void {
    // 收到服务器任意消息（含 pong），清除超时定时器，确认连接存活
    if (this.websocketPongTimeout !== null) {
      clearTimeout(this.websocketPongTimeout);
      this.websocketPongTimeout = null;
      console.log('✅ 连接存活确认，已清除心跳超时');
    }
  }

  /**
   * 设置事件回调
   */
  onPlayerJoined(callback: (playerId: string, playerName: string, virtualIp?: string, virtualDomain?: string, useDomain?: boolean) => void): void {
    this.onPlayerJoinedCallback = callback;
    for (const [playerId, player] of this.pendingPlayerJoined) {
      callback(playerId, player.playerName, player.virtualIp, player.virtualDomain, player.useDomain);
    }
    this.pendingPlayerJoined.clear();
  }

  private notifyPlayerJoined(
    playerId: string,
    playerName: string,
    virtualIp?: string,
    virtualDomain?: string,
    useDomain?: boolean,
  ): void {
    if (!isSafeIdentifier(playerId) || playerId === this.localPlayerId || !this.knownPlayers.has(playerId)) return;
    const safePlayerName = sanitizeUntrustedText(playerName, MAX_PLAYER_NAME_LENGTH).trim() || tl('未知玩家', 'Unknown player');
    const safeVirtualIp = isSafeVirtualIp(virtualIp) ? virtualIp.trim() : undefined;
    const safeVirtualDomain = isSafeVirtualDomain(virtualDomain) ? virtualDomain.trim() : undefined;
    const safeUseDomain = useDomain === true && !!safeVirtualIp && !!safeVirtualDomain;
    if (this.onPlayerJoinedCallback) {
      this.onPlayerJoinedCallback(playerId, safePlayerName, safeVirtualIp, safeVirtualDomain, safeUseDomain);
      return;
    }
    this.pendingPlayerJoined.set(playerId, {
      playerName: safePlayerName,
      virtualIp: safeVirtualIp,
      virtualDomain: safeVirtualDomain,
      useDomain: safeUseDomain,
    });
  }

  onPlayerLeft(callback: (playerId: string) => void): void {
    this.onPlayerLeftCallback = callback;
  }

  onStatusUpdate(callback: (playerId: string, micEnabled: boolean) => void): void {
    this.onStatusUpdateCallback = callback;
  }

  onRemoteStream(callback: (playerId: string, stream: MediaStream) => void): void {
    this.onRemoteStreamCallback = callback;
  }

  /** 本地麦克风流变化回调（开启时为流，关闭时为 null） */
  onLocalStream(callback: (stream: MediaStream | null) => void): void {
    this.onLocalStreamCallback = callback;
  }

  /** 将选定的输出设备应用到所有已存在的远程音频元素（用户切换扬声器时调用） */
  async applyOutputDeviceToAll(deviceId: string): Promise<void> {
    for (const [peerId, pc] of this.peerConnections) {
      const el = pc.audioElement as any;
      if (el && typeof el.setSinkId === 'function') {
        try {
          await el.setSinkId(deviceId || '');
        } catch (e) {
          console.warn(`应用输出设备到 ${peerId} 失败:`, e);
        }
      }
    }
  }

  onChatMessage(callback: (playerId: string, playerName: string, content: string, timestamp: number) => void): void {
    this.onChatMessageCallback = callback;
  }

  /**
   * 设置版本错误回调
   */
  onVersionError(callback: (currentVersion: string, minimumVersion: string, downloadUrl: string) => void): void {
    this.onVersionErrorCallback = callback;
  }

  // ==================== 房主/大厅管理 ====================
  onLobbyMeta(cb: (meta: { hostId?: string; maxPlayers?: number | null; isPublic?: boolean; mutedPlayers?: string[] }) => void): void {
    this.onLobbyMetaCallback = cb;
  }
  onHostChanged(cb: (hostId: string) => void): void {
    this.onHostChangedCallback = cb;
  }
  onMuteChanged(cb: (playerId: string, muted: boolean) => void): void {
    this.onMuteChangedCallback = cb;
  }
  onLobbyOptionsChanged(cb: (maxPlayers: number | null, isPublic: boolean) => void): void {
    this.onLobbyOptionsChangedCallback = cb;
  }
  onKicked(cb: (reason: string) => void): void {
    this.onKickedCallback = cb;
  }

  /** 踢出玩家（仅房主有效） */
  kickPlayer(targetId: string): boolean {
    const safeTargetId = sanitizeIdentifier(targetId);
    if (!this.knownPlayers.has(safeTargetId) || safeTargetId === this.localPlayerId) return false;
    return this.sendWebSocketMessage({ type: 'kick-player', from: this.localPlayerId, target: safeTargetId });
  }

  /**
   * 语音重连：只重建与指定玩家的语音链路，无需整个大厅退出重进。
   *
   * 适用场景：MC 联机与信令都正常，但与某一个人的语音单独失效（对方声音消失且长时间不恢复）。
   *
   * 实现要点：
   * 1. 先通知对端拆掉他那一侧的旧连接（双端同拆同建），否则一端沿用旧 PeerConnection
   *    会因指纹/ufrag 不匹配出现"看着已连接却没有声音"；
   * 2. 清掉自动重连的定时器，避免与自动重连逻辑互相打断；
   * 3. 以 forceInitiate=true 由点击方发起 Offer，绕过"ID 字典序较大者才发起"的规则，
   *    确保点击的人一定能把连接建起来，也不会出现双方同时发 Offer 的冲突。
   *
   * @param peerId 目标玩家 ID
   * @returns 是否成功启动重连流程
   */
  async reconnectPeerVoice(peerId: string): Promise<boolean> {
    const safePeerId = sanitizeIdentifier(peerId);
    if (!this.knownPlayers.has(safePeerId) || safePeerId === this.localPlayerId) {
      return false;
    }

    if (this.manualReconnectingPeers.has(safePeerId)) {
      console.log('⏳ 已在进行语音重连，忽略重复请求');
      return false;
    }

    this.manualReconnectingPeers.add(safePeerId);
    try {
      console.log('🔄 [语音重连] 开始重建语音连接');

      // 通知对方拆除旧连接（对端不识别该消息时会被忽略，此时退化为单端重建）
      this.sendWebSocketMessage({
        type: 'voice-reconnect',
        from: this.localPlayerId,
        to: safePeerId,
      });

      // 取消可能存在的自动重连调度，避免与手动重连冲突
      this.clearPeerReconnectState(safePeerId);

      // 给对端一点时间完成拆除，再发起新的 Offer
      await new Promise(resolve => setTimeout(resolve, 300));

      await this.handleReconnect(safePeerId, true);
      console.log('✅ [语音重连] 已发起新的连接协商');
      return true;
    } catch (error) {
      console.error('❌ [语音重连] 失败:', error);
      return false;
    } finally {
      // 释放并发闸门，留出足够时间避免用户狂点
      setTimeout(() => this.manualReconnectingPeers.delete(safePeerId), 3000);
    }
  }

  /** 指定玩家当前是否正在进行手动语音重连 */
  isManualReconnecting(peerId: string): boolean {
    return this.manualReconnectingPeers.has(sanitizeIdentifier(peerId));
  }
  /** 禁言/解除禁言玩家（仅房主有效） */
  setPlayerMuted(targetId: string, muted: boolean): boolean {
    const safeTargetId = sanitizeIdentifier(targetId);
    if (!this.knownPlayers.has(safeTargetId) || safeTargetId === this.localPlayerId || typeof muted !== 'boolean') return false;
    return this.sendWebSocketMessage({ type: 'mute-player', from: this.localPlayerId, target: safeTargetId, muted });
  }
  /** 转让房主（仅房主有效） */
  transferHost(targetId: string): boolean {
    const safeTargetId = sanitizeIdentifier(targetId);
    if (!this.knownPlayers.has(safeTargetId) || safeTargetId === this.localPlayerId) return false;
    return this.sendWebSocketMessage({ type: 'transfer-host', from: this.localPlayerId, target: safeTargetId });
  }
  /** 设置大厅选项（仅房主有效），maxPlayers 传 0 表示取消上限 */
  setLobbyOptions(opts: { maxPlayers?: number; isPublic?: boolean; description?: string; serverNode?: string }): boolean {
    const next: Record<string, unknown> = { type: 'set-lobby-options', from: this.localPlayerId };
    if (opts.maxPlayers !== undefined) {
      if (!Number.isSafeInteger(opts.maxPlayers) || opts.maxPlayers < 0 || opts.maxPlayers > 100_000) return false;
      next.maxPlayers = opts.maxPlayers;
    }
    if (opts.isPublic !== undefined) {
      if (typeof opts.isPublic !== 'boolean') return false;
      next.isPublic = opts.isPublic;
    }
    if (opts.description !== undefined) next.description = sanitizeUntrustedText(opts.description, 200);
    if (opts.serverNode !== undefined) {
      if (!isSafeServerNode(opts.serverNode) || opts.serverNode === 'custom') return false;
      next.serverNode = opts.serverNode;
    }
    return this.sendWebSocketMessage(next);
  }

  /**
   * 发送聊天消息
   */
  async sendChatMessage(content: string): Promise<void> {
    try {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket未连接');
      }

      const safeContent = sanitizeUntrustedText(content, MAX_CHAT_TEXT_LENGTH);
      if (!safeContent.trim()) throw new Error('消息内容不能为空');
      const message = {
        type: 'chat-message',
        from: this.localPlayerId,
        playerId: this.localPlayerId,
        playerName: this.localPlayerName,
        content: safeContent,
        timestamp: Date.now(),
      };

      this.sendWebSocketMessage(message);
      console.log('📤 聊天消息已发送');
    } catch (error) {
      console.error('❌ 发送聊天消息失败:', error);
      throw error;
    }
  }

  /**
   * 获取指定玩家的文件传输DataChannel
   */
  getFileTransferChannel(playerId: string): RTCDataChannel | null {
    const peer = this.peerConnections.get(playerId);
    if (peer && peer.fileTransferChannel && peer.fileTransferChannel.readyState === 'open') {
      return peer.fileTransferChannel;
    }
    return null;
  }

  /**
   * 获取所有已连接的玩家ID列表
   */
  getConnectedPlayers(): string[] {
    const connectedPlayers: string[] = [];
    for (const [playerId, peer] of this.peerConnections) {
      if (peer.connection.connectionState === 'connected') {
        connectedPlayers.push(playerId);
      }
    }
    return connectedPlayers;
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      console.log('🧹 开始清理 WebRTC 客户端...');
      
      // 标记为主动断开，防止自动重连
      this.isIntentionalDisconnect = true;

      try {
        const { remoteControlService } = await import('../remoteControl/RemoteControlService');
        remoteControlService.handleSignalingDisconnected();
      } catch (error) {
        console.error('清理远程控制会话失败:', error);
      }
      this.chatToken = '';
      this.chatTokenEpoch = 0;
      this.chatHostId = undefined;
      this.chatPeers.clear();
      p2pChatService.reset();
      try {
        await invoke('stop_p2p_chat');
      } catch (error) {
        console.warn('停止聊天服务失败:', error);
      }
      
      // 清理重连定时器
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      if (this.websocketStableTimer !== null) {
        clearTimeout(this.websocketStableTimer);
        this.websocketStableTimer = null;
      }
      
      // 清理所有peer重连状态
      this.reconnectTimers.forEach(timer => clearTimeout(timer));
      this.reconnectTimers.clear();
      if (this.voiceHealthInterval !== null) {
        clearInterval(this.voiceHealthInterval);
        this.voiceHealthInterval = null;
      }
      this.voiceHealth.clear();
      this.reconnectingPeers.clear();
      this.websocketReconnectInFlight = false;
      this.manualReconnectingPeers.clear();
      this.knownPlayers.clear();
      this.authoritativePlayers.clear();
      this.authoritativeSnapshotVersion = 0;
      this.playerDomains.clear();
      this.clearAllPendingPlayerLeaves();

      // 复位麦克风期望/实际状态，避免残留状态影响下次进入大厅
      this.desiredMicEnabled = false;
      this.micActuallyEnabled = false;
      
      // 重置重连计数
      this.reconnectAttempts = 0;
      
      // 停止心跳（先停止，避免在清理过程中发送消息）
      this.stopHeartbeat();
      console.log('✅ 心跳已停止');
      
      // 停止 WebSocket 心跳
      this.stopWebSocketHeartbeat();
      console.log('✅ WebSocket 心跳已停止');

      // 关闭所有 Peer Connections
      console.log(`正在关闭 ${this.peerConnections.size} 个 Peer Connection...`);
      this.peerConnections.forEach((pc, peerId) => {
        try {
          // 停止音频播放
          if (pc.audioElement) {
            pc.audioElement.pause();
            pc.audioElement.srcObject = null;
            console.log(`✅ 音频元素已清理 for ${peerId}`);
          }
          
          // 关闭连接
          pc.connection.close();
          console.log(`✅ 连接已关闭 for ${peerId}`);
          
          // 关闭数据通道
          if (pc.dataChannel) {
            pc.dataChannel.close();
            console.log(`✅ 数据通道已关闭 for ${peerId}`);
          }
        } catch (error) {
          console.error(`❌ 清理 ${peerId} 的连接失败:`, error);
        }
      });
      this.peerConnections.clear();
      console.log('✅ 所有 Peer Connection 已清理');

      // 停止本地音频流
      if (this.localStream) {
        const trackCount = this.localStream.getTracks().length;
        this.localStream.getTracks().forEach((track) => {
          track.stop();
        });
        this.localStream = null;
        console.log(`✅ 本地音频流已停止 (${trackCount} 个轨道)`);
      }
      // 停止原始麦克风流并释放变声器
      if (this.rawMicStream) {
        this.rawMicStream.getTracks().forEach((t) => t.stop());
        this.rawMicStream = null;
      }
      try { await localVqeService.dispose(); } catch { /* ignore */ }
      try { voiceChangerService.dispose(); } catch { /* ignore */ }
      try { this.onLocalStreamCallback?.(null); } catch { /* ignore */ }

      // 关闭 WebSocket 连接（最后关闭，确保所有清理消息都能发送）
      if (this.websocket) {
        // 移除所有事件监听器，避免在关闭过程中触发
        this.websocket.onopen = null;
        this.websocket.onmessage = null;
        this.websocket.onerror = null;
        this.websocket.onclose = null;
        
        // 如果连接是打开状态，先发送离开消息
        if (this.websocket.readyState === WebSocket.OPEN) {
          try {
            this.websocket.send(JSON.stringify({
              type: 'leave',
              clientId: this.localPlayerId,
            }));
            console.log('📤 已发送离开消息');
          } catch (error) {
            console.warn('⚠️ 发送离开消息失败:', error);
          }
        }
        
        // 关闭连接
        this.websocket.close();
        this.websocket = null;
        console.log('✅ WebSocket 连接已关闭');
      }

      // 清理所有状态
      this.localPlayerId = '';
      this.localPlayerName = '';
      this.virtualIp = null;
      
      // 清理文件共享服务
      console.log('正在清理文件共享服务...');
      try {
        fileShareService.cleanup();
        fileTransferService.cleanup();
        console.log('✅ 文件共享服务已清理');
      } catch (error) {
        console.error('❌ 清理文件共享服务失败:', error);
      }

      // 清理屏幕共享服务
      console.log('正在清理屏幕共享服务...');
      try {
        const { screenShareService } = await import('../screenShare/ScreenShareService');
        screenShareService.cleanup();
        console.log('✅ 屏幕共享服务已清理');
      } catch (error) {
        console.error('❌ 清理屏幕共享服务失败:', error);
      }
      
      console.log('✅ WebRTC 客户端清理完成');
    } catch (error) {
      console.error('❌ 清理 WebRTC 客户端失败:', error);
    }
  }
}

// 导出单例实例
export const webrtcClient = new WebRTCClient();
