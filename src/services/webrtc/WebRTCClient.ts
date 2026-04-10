/**
 * WebRTC 客户端服务
 * 处理 P2P 音频连接和数据通道
 */

import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { fileShareService } from '../fileShare/FileShareService';
import { fileTransferService } from '../fileShare/FileTransferService';

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

/**
 * WebRTC 客户端类
 */
export class WebRTCClient {
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, PeerConnection> = new Map();
  private localPlayerId: string = '';
  private localPlayerName: string = '';
  private lobbyName: string = '';
  private lobbyPassword: string = '';
  private heartbeatInterval: number | null = null;
  private websocket: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout: number | null = null;
  private isIntentionalDisconnect: boolean = false;
  private reconnectingPeers: Set<string> = new Set();
  private reconnectTimers: Map<string, number> = new Map();
  private knownPlayers: Set<string> = new Set();
  private pendingPlayerLeaveTimers: Map<string, number> = new Map();
  private readonly transientLeaveConfirmMs: number = 10000;

  // ICE 服务器配置
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  
  // 虚拟IP地址
  private virtualIp: string | null = null;
  
  // 虚拟域名
  private virtualDomain: string | null = null;
  
  // 是否使用域名访问
  private useDomain: boolean = false;
  
  // 信令服务器地址（创建者的虚拟IP）
  private signalingServerUrl: string = '';

  // 事件回调
  private onPlayerJoinedCallback?: (playerId: string, playerName: string, virtualIp?: string, virtualDomain?: string, useDomain?: boolean) => void;
  private onPlayerLeftCallback?: (playerId: string) => void;
  private onStatusUpdateCallback?: (playerId: string, micEnabled: boolean) => void;
  private onRemoteStreamCallback?: (playerId: string, stream: MediaStream) => void;
  private onChatMessageCallback?: (playerId: string, playerName: string, content: string, timestamp: number) => void;
  private onVersionErrorCallback?: (currentVersion: string, minimumVersion: string, downloadUrl: string) => void;

  /**
   * 初始化 WebRTC 客户端
   */
  async initialize(playerId: string, playerName: string, lobbyName: string, lobbyPassword: string, virtualDomain?: string, useDomain?: boolean, signalingServer?: string): Promise<void> {
    try {
      console.log('🚀 开始初始化 WebRTC 客户端...');
      console.log('玩家ID:', playerId);
      console.log('玩家名称:', playerName);
      console.log('大厅名称:', lobbyName);
      
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
      
      this.localPlayerId = playerId;
      this.localPlayerName = playerName;
      this.lobbyName = lobbyName;
      this.lobbyPassword = lobbyPassword;
      this.virtualDomain = virtualDomain || null;
      this.useDomain = useDomain || false;
      
      // 重置断开标志
      this.isIntentionalDisconnect = false;
      this.reconnectAttempts = 0;
      this.reconnectingPeers.clear();
      this.reconnectTimers.forEach(timer => clearTimeout(timer));
      this.reconnectTimers.clear();
      this.knownPlayers.clear();
      this.clearAllPendingPlayerLeaves();

      // 获取虚拟IP
      console.log('正在获取虚拟IP...');
      try {
        const virtualIp = await invoke<string | null>('get_virtual_ip');
        if (virtualIp) {
          this.virtualIp = virtualIp;
          console.log('✅ 虚拟IP:', this.virtualIp);
        } else {
          console.warn('⚠️ 未获取到虚拟IP，WebRTC可能无法正常工作');
        }
      } catch (error) {
        console.error('❌ 获取虚拟IP失败:', error);
      }

      // 设置信令服务器地址（优先使用传入的参数，否则使用默认值）
      this.signalingServerUrl = signalingServer || 'wss://mctier.pmhs.top/signaling';
      console.log('📡 连接到信令服务器:', this.signalingServerUrl);

      // 不再在初始化时获取麦克风，只有在用户开启麦克风时才获取
      console.log('⏭️ 跳过麦克风初始化，等待用户手动开启');
      this.localStream = null;

      // 连接到WebSocket信令服务器
      console.log('正在连接到WebSocket信令服务器...');
      await this.connectToSignalingServer();
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
          screenShareService.initialize(playerId, playerName, this.websocket);
          console.log('✅ 屏幕共享服务初始化成功');
        }
      } catch (error) {
        console.error('❌ 屏幕共享服务初始化失败:', error);
        // 不中断流程，屏幕共享是可选功能
      }

      console.log('✅ WebRTC 客户端初始化完成');
    } catch (error) {
      console.error('❌ WebRTC 初始化失败:', error);
      // 清理已创建的资源
      await this.cleanup();
      throw new Error(`无法初始化语音系统: ${error}`);
    }
  }

  /**
   * 连接到WebSocket信令服务器
   */
  private async connectToSignalingServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`正在连接到信令服务器: ${this.signalingServerUrl}`);
        
        this.websocket = new WebSocket(this.signalingServerUrl);
        
        this.websocket.onopen = () => {
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
              clientVersion: '1.4.0',
            }));
            console.log('📤 已发送注册消息，玩家名称:', this.localPlayerName, '大厅:', this.lobbyName, '虚拟域名:', this.virtualDomain, '使用域名:', this.useDomain);
          }
          
          resolve();
        };
        
        this.websocket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('❌ 解析WebSocket消息失败:', error);
          }
        };
        
        this.websocket.onerror = (error) => {
          console.error('❌ WebSocket连接错误:', error);
          reject(new Error('无法连接到信令服务器'));
        };
        
        this.websocket.onclose = () => {
          console.log('⚠️ 与信令服务器的连接已断开');
          
          // 如果不是主动断开，尝试重连
          if (!this.isIntentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000); // 指数退避，最多10秒
            console.log(`🔄 将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
            
            this.reconnectTimeout = window.setTimeout(() => {
              this.reconnectWebSocket();
            }, delay);
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ 已达到最大重连次数，停止重连');
          }
        };
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 重连WebSocket
   */
  private async reconnectWebSocket(): Promise<void> {
    try {
      console.log('🔄 正在重连WebSocket...');
      
      // 清理旧的WebSocket连接
      if (this.websocket) {
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
      
      // 重连成功，重置重连计数
      this.reconnectAttempts = 0;
      console.log('✅ WebSocket重连成功');
      
    } catch (error) {
      console.error('❌ WebSocket重连失败:', error);
      
      // 如果还没达到最大重连次数，继续尝试
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
        console.log(`🔄 将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
        
        this.reconnectTimeout = window.setTimeout(() => {
          this.reconnectWebSocket();
        }, delay);
      }
    }
  }

  private clearPendingPlayerLeave(playerId: string): boolean {
    const pendingTimer = this.pendingPlayerLeaveTimers.get(playerId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingPlayerLeaveTimers.delete(playerId);
      return true;
    }
    return false;
  }

  private clearAllPendingPlayerLeaves(): void {
    this.pendingPlayerLeaveTimers.forEach((timer) => clearTimeout(timer));
    this.pendingPlayerLeaveTimers.clear();
  }

  private isExpectedChannelCloseError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const rtcError = (error as { error?: { message?: string } }).error;
    const message = rtcError?.message || '';
    return message.includes('User-Initiated Abort') || message.includes('on-close called');
  }

  /**
   * 处理WebSocket消息
   */
  private async handleWebSocketMessage(message: any): Promise<void> {
    console.log(`📨 收到WebSocket消息: ${message.type}`);
    
    try {
      switch (message.type) {
        case 'register-success':
          // 注册成功
          console.log('✅ 注册成功，大厅ID:', message.lobbyId);
          break;
          
        case 'register-error':
          // 注册失败
          console.error('❌ 注册失败:', message.message);
          // 不要抛出错误,只记录日志
          // 用户可能输入了错误的密码,应该让他们看到错误信息而不是断开连接
          break;
          
        case 'version-too-old':
          // 版本过低
          console.error('❌ 客户端版本过低');
          console.error('当前版本:', message.currentVersion);
          console.error('最低要求:', message.minimumVersion);
          console.error('下载地址:', message.downloadUrl);
          
          // 触发版本错误回调
          if (this.onVersionErrorCallback) {
            this.onVersionErrorCallback(message.currentVersion, message.minimumVersion, message.downloadUrl);
          }
          
          // 停止自动重连
          this.isIntentionalDisconnect = true;
          
          // 关闭WebSocket连接
          if (this.websocket) {
            this.websocket.close();
          }
          break;
          
        case 'players-list':
          // 收到当前在线玩家列表
          console.log(`当前在线玩家: ${message.players.length} 人`);
          for (const player of message.players) {
            console.log(`  - ${player.playerName} (${player.playerId})`);

            if (player.playerId === this.localPlayerId) {
              continue;
            }

            const wasPendingLeave = this.clearPendingPlayerLeave(player.playerId);
            if (wasPendingLeave) {
              console.log(`♻️ 玩家 ${player.playerId} 在players-list中恢复在线，取消离线确认`);
            }

            const isKnownPlayer = this.knownPlayers.has(player.playerId);
            this.knownPlayers.add(player.playerId);
            
            // 如果启用了域名访问且有虚拟域名，添加到hosts文件
            if (player.useDomain && player.virtualDomain && player.virtualIp) {
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
            if (!isKnownPlayer && this.onPlayerJoinedCallback) {
              this.onPlayerJoinedCallback(player.playerId, player.playerName, player.virtualIp, player.virtualDomain, player.useDomain);
            }
            
            if (isKnownPlayer) {
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
          console.log(`🎮 新玩家加入: ${message.playerName} (${message.playerId})`);

          if (message.playerId === this.localPlayerId) {
            break;
          }

          const isRecoveredPlayer = this.clearPendingPlayerLeave(message.playerId);
          if (isRecoveredPlayer) {
            console.log(`♻️ 玩家 ${message.playerId} 在短时断线窗口内恢复，跳过离开/加入提示音`);
          }

          const alreadyKnown = this.knownPlayers.has(message.playerId);
          if (alreadyKnown) {
            console.log(`⏳ ${message.playerId} 已在players-list中处理过，跳过重复加入事件`);
            break;
          }

          this.knownPlayers.add(message.playerId);
          
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
          if (message.useDomain && message.virtualDomain && message.virtualIp) {
            try {
              console.log(`📝 添加玩家域名映射: ${message.virtualDomain} -> ${message.virtualIp}`);
              await invoke('add_player_domain', {
                domain: message.virtualDomain,
                ip: message.virtualIp,
              });
              console.log(`✅ 玩家域名映射已添加: ${message.virtualDomain}`);
            } catch (error) {
              console.error(`❌ 添加玩家域名映射失败:`, error);
              // 不中断流程，继续处理玩家加入
            }
          }
          
          // 触发回调
          if (this.onPlayerJoinedCallback) {
            this.onPlayerJoinedCallback(message.playerId, message.playerName, message.virtualIp, message.virtualDomain, message.useDomain);
          }
          
          // HTTP模式：不需要向新玩家发送共享列表，客户端直接通过HTTP API查询
          // 只有当本地玩家ID字典序大于对方时才主动发起连接
          if (this.localPlayerId > message.playerId) {
            console.log(`📡 主动向新玩家 ${message.playerId} 发起连接（ID字典序较大）`);
            
            // 等待一小段时间，让新玩家完成初始化
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 创建连接
            await this.createPeerConnection(message.playerId);
            
            // 等待ICE候选收集开始
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 创建 Offer
            const pc = this.peerConnections.get(message.playerId);
            if (pc) {
              const offer = await pc.connection.createOffer();
              await pc.connection.setLocalDescription(offer);
              
              // 发送 Offer（失败自动重试一次）
              await this.sendOfferWithRetry(message.playerId, {
                type: offer.type,
                sdp: offer.sdp,
              }, '新玩家连接');
            }
          } else {
            console.log(`⏳ 等待新玩家 ${message.playerId} 主动发起连接（ID字典序较小）`);
          }
          break;
          
        case 'player-left':
          // 有玩家离开（增加短时断线缓冲，避免误报提示音）
          console.log(`👋 玩家离开事件: ${message.playerId}`);

          if (!message.playerId || message.playerId === this.localPlayerId) {
            break;
          }

          const existingLeaveTimer = this.pendingPlayerLeaveTimers.get(message.playerId);
          if (existingLeaveTimer) {
            clearTimeout(existingLeaveTimer);
          }

          const leaveTimer = window.setTimeout(async () => {
            this.pendingPlayerLeaveTimers.delete(message.playerId);

            if (!this.knownPlayers.has(message.playerId)) {
              return;
            }

            console.log(`🚪 玩家确认离开: ${message.playerId}`);

            // 播放玩家离开音效（仅在确认离开后）
            try {
              const { audioService } = await import('../audio/AudioService');
              await audioService.play('userLeft');
            } catch (error) {
              console.error('播放玩家离开音效失败:', error);
            }

            // 如果有虚拟域名，从hosts文件中删除
            if (message.virtualDomain) {
              try {
                console.log(`🗑️ 删除玩家域名映射: ${message.virtualDomain}`);
                await invoke('remove_player_domain', {
                  domain: message.virtualDomain,
                });
                console.log(`✅ 玩家域名映射已删除: ${message.virtualDomain}`);
              } catch (error) {
                console.error(`❌ 删除玩家域名映射失败:`, error);
                // 不中断流程，继续处理玩家离开
              }
            }

            // 清理该玩家的文件共享
            try {
              fileShareService.handlePlayerLeft(message.playerId);
              console.log(`✅ 已清理玩家 ${message.playerId} 的文件共享`);
            } catch (error) {
              console.error(`❌ 清理玩家文件共享失败:`, error);
            }

            this.knownPlayers.delete(message.playerId);
            this.removePeer(message.playerId);
          }, this.transientLeaveConfirmMs);

          this.pendingPlayerLeaveTimers.set(message.playerId, leaveTimer);
          console.log(`⏳ 玩家 ${message.playerId} 进入离线确认窗口: ${this.transientLeaveConfirmMs}ms`);
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
          
        case 'status-update':
          // 收到状态更新
          console.log(`📢 收到状态更新 from ${message.clientId}: 麦克风${message.micEnabled ? '开启' : '关闭'}`);
          if (this.onStatusUpdateCallback) {
            this.onStatusUpdateCallback(message.clientId, message.micEnabled);
          }
          break;
          
        case 'chat-message':
          // 收到聊天消息
          console.log(`💬 收到聊天消息 from ${message.playerName}: ${message.content}`);
          if (this.onChatMessageCallback && message.playerId && message.playerName && message.content && message.timestamp) {
            this.onChatMessageCallback(message.playerId, message.playerName, message.content, message.timestamp);
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
          // 收到文件传输响应
          console.log(`📥 收到文件传输响应 from ${message.from}, request:`, message.request);
          try {
            const requestId = message.request?.requestId;
            if (!requestId) {
              console.error('❌ 文件传输响应缺少requestId');
              return;
            }
            
            console.log(`📥 处理文件传输响应, requestId: ${requestId}, accepted: ${message.accepted}`);
            
            if (message.accepted) {
              console.log(`✅ 文件传输请求已被接受: ${requestId}`);
            } else {
              console.error(`❌ 文件传输请求被拒绝: ${requestId}, ${message.error}`);
              fileTransferService.handleTransferError(requestId, message.error || '传输被拒绝');
            }
          } catch (error) {
            console.error('❌ 处理文件传输响应失败:', error);
          }
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
          // 收到远程共享添加
          console.log(`📁 收到远程共享添加 from ${message.from}`);
          try {
            if (message.share) {
              fileShareService.handleRemoteShareAdded(message.share);
              console.log(`✅ 远程共享已添加: ${message.share.folderName}`);
            }
          } catch (error) {
            console.error('❌ 处理远程共享添加失败:', error);
          }
          break;
          
        case 'share-removed':
          // 收到远程共享移除
          console.log(`📁 收到远程共享移除 from ${message.from}, shareId: ${message.shareId}`);
          try {
            if (message.shareId) {
              fileShareService.handleRemoteShareRemoved(message.shareId);
              console.log(`✅ 远程共享已移除: ${message.shareId}`);
            }
          } catch (error) {
            console.error('❌ 处理远程共享移除失败:', error);
          }
          break;
          
        case 'share-updated':
          // 收到远程共享更新
          console.log(`📁 收到远程共享更新 from ${message.from}`);
          try {
            if (message.share) {
              fileShareService.handleRemoteShareUpdated(message.share);
              console.log(`✅ 远程共享已更新: ${message.share.folderName}`);
            }
          } catch (error) {
            console.error('❌ 处理远程共享更新失败:', error);
          }
          break;
          
        case 'screen-share-start':
          // 收到屏幕共享开始通知
          console.log(`🖥️ 收到屏幕共享开始通知 from ${message.playerName}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            // 将共享信息添加到本地列表
            const share = {
              id: message.shareId,
              playerId: message.from,
              playerName: message.playerName,
              virtualIp: '', // 将由前端填充
              requirePassword: message.hasPassword,
              startTime: Date.now(),
              status: 'active' as const,
            };
            // 直接添加到activeShares
            (screenShareService as any).activeShares.set(share.id, share);
            console.log(`✅ 屏幕共享已添加到列表: ${share.playerName}`);
            
            // 【事件驱动】触发自定义事件通知UI更新
            window.dispatchEvent(new CustomEvent('screen-share-start', {
              detail: {
                shareId: share.id,
                playerId: share.playerId,
                playerName: share.playerName,
                hasPassword: share.requirePassword,
              }
            }));
          } catch (error) {
            console.error('❌ 处理屏幕共享开始失败:', error);
          }
          break;
          
        case 'screen-share-error':
          // 收到屏幕共享错误（例如密码错误）
          console.log(`❌ 收到屏幕共享错误: ${message.error}`);
          // 这里可以通过事件通知前端显示错误
          window.dispatchEvent(new CustomEvent('screen-share-error', { 
            detail: { 
              shareId: message.shareId, 
              error: message.error 
            } 
          }));
          break;
          
        case 'screen-share-stop':
          // 收到屏幕共享停止通知
          console.log(`🖥️ 收到屏幕共享停止通知, shareId: ${message.shareId}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            // 从本地列表移除
            (screenShareService as any).activeShares.delete(message.shareId);
            console.log(`✅ 屏幕共享已从列表移除`);
            
            // 【事件驱动】触发自定义事件通知UI更新
            window.dispatchEvent(new CustomEvent('screen-share-stop', {
              detail: {
                shareId: message.shareId,
              }
            }));
          } catch (error) {
            console.error('❌ 处理屏幕共享停止失败:', error);
          }
          break;
          
        case 'screen-share-offer':
          // 收到屏幕共享Offer
          console.log(`🖥️ 收到屏幕共享Offer from ${message.from}, playerName: ${message.playerName}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            await screenShareService.handleOffer({
              shareId: message.shareId,
              playerId: message.from,
              playerName: message.playerName || '未知玩家', // 【修复】从消息中获取查看者名字
              requirePassword: false,
              password: message.password, // 【修复】传递密码字段
              sdp: message.offer.sdp,
            });
            console.log(`✅ 屏幕共享Offer已处理`);
          } catch (error) {
            console.error('❌ 处理屏幕共享Offer失败:', error);
          }
          break;
          
        case 'screen-share-answer':
          // 收到屏幕共享Answer
          console.log(`🖥️ 收到屏幕共享Answer from ${message.from}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            await screenShareService.handleAnswer({
              shareId: message.shareId,
              sdp: message.answer.sdp,
            }, message.from);
            console.log(`✅ 屏幕共享Answer已处理`);
          } catch (error) {
            console.error('❌ 处理屏幕共享Answer失败:', error);
          }
          break;
          
        case 'screen-share-ice-candidate':
          // 收到屏幕共享ICE候选
          console.log(`🖥️ 收到屏幕共享ICE候选 from ${message.from}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            await screenShareService.handleIceCandidate(message.shareId, message.candidate);
            console.log(`✅ 屏幕共享ICE候选已处理`);
          } catch (error) {
            console.error('❌ 处理屏幕共享ICE候选失败:', error);
          }
          break;
          
        case 'screen-share-viewer-left':
          // 收到查看者离开通知
          console.log(`👋 收到查看者离开通知, shareId: ${message.shareId}, from: ${message.from}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            screenShareService.handleViewerLeft(message.shareId, message.from);
            console.log(`✅ 查看者离开已处理`);
          } catch (error) {
            console.error('❌ 处理查看者离开失败:', error);
          }
          break;
          
        case 'screen-share-list-request':
          // 收到屏幕共享列表请求
          console.log(`📋 收到屏幕共享列表请求 from ${message.from}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            // 【修复】只返回自己创建的共享，不返回别人的共享
            const myShares = screenShareService.getMyActiveShares();
            
            // 如果有活跃的共享，发送给请求者
            if (myShares.length > 0) {
              console.log(`📤 发送 ${myShares.length} 个屏幕共享信息给 ${message.from}`);
              myShares.forEach(share => {
                this.sendWebSocketMessage({
                  type: 'screen-share-list-response',
                  from: this.localPlayerId,
                  to: message.from,
                  shareId: share.id,
                  playerName: share.playerName,
                  hasPassword: share.requirePassword,
                });
              });
            } else {
              console.log(`📭 我没有活跃的屏幕共享`);
            }
          } catch (error) {
            console.error('❌ 处理屏幕共享列表请求失败:', error);
          }
          break;
          
        case 'screen-share-list-response':
          // 收到屏幕共享列表响应
          console.log(`📥 收到屏幕共享列表响应 from ${message.from}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            // 将共享信息添加到本地列表
            const share = {
              id: message.shareId,
              playerId: message.from,
              playerName: message.playerName,
              virtualIp: '', // 将由前端填充
              requirePassword: message.hasPassword,
              startTime: Date.now(),
              status: 'active' as const,
            };
            // 直接添加到activeShares
            (screenShareService as any).activeShares.set(share.id, share);
            console.log(`✅ 屏幕共享已添加到列表: ${share.playerName}`);
            
            // 【事件驱动】触发自定义事件通知UI更新
            window.dispatchEvent(new CustomEvent('screen-share-start', {
              detail: {
                shareId: share.id,
                playerId: share.playerId,
                playerName: share.playerName,
                hasPassword: share.requirePassword,
              }
            }));
          } catch (error) {
            console.error('❌ 处理屏幕共享列表响应失败:', error);
          }
          break;
          
        case 'screen-share-update':
          // 收到共享状态更新
          console.log(`🔄 收到共享状态更新, shareId: ${message.shareId}, viewerId: ${message.viewerId}, viewerName: ${message.viewerName}`);
          try {
            const { screenShareService } = await import('../screenShare/ScreenShareService');
            // 更新本地共享列表中的查看者信息
            const share = (screenShareService as any).activeShares.get(message.shareId);
            if (share) {
              share.viewerId = message.viewerId;
              share.viewerName = message.viewerName;
              (screenShareService as any).activeShares.set(message.shareId, share);
              console.log(`✅ 共享状态已更新:`, { viewerId: message.viewerId, viewerName: message.viewerName });
              
              // 【事件驱动】触发自定义事件通知UI更新
              window.dispatchEvent(new CustomEvent('screen-share-update', {
                detail: {
                  shareId: message.shareId,
                  viewerId: message.viewerId,
                  viewerName: message.viewerName,
                }
              }));
            }
          } catch (error) {
            console.error('❌ 处理共享状态更新失败:', error);
          }
          break;
          
        case 'file-share-added':
          // 收到文件共享添加通知
          console.log(`📁 收到文件共享添加通知 from ${message.playerName}`);
          try {
            // 【事件驱动】触发自定义事件通知UI更新
            window.dispatchEvent(new CustomEvent('file-share-added', {
              detail: {
                shareId: message.shareId,
                shareName: message.shareName,
                playerId: message.from,
                playerName: message.playerName,
                hasPassword: message.hasPassword,
              }
            }));
            console.log(`✅ 文件共享添加事件已触发`);
          } catch (error) {
            console.error('❌ 处理文件共享添加失败:', error);
          }
          break;
          
        case 'file-share-removed':
          // 收到文件共享删除通知
          console.log(`📁 收到文件共享删除通知, shareId: ${message.shareId}`);
          try {
            // 【事件驱动】触发自定义事件通知UI更新
            window.dispatchEvent(new CustomEvent('file-share-removed', {
              detail: {
                shareId: message.shareId,
                playerId: message.from,
              }
            }));
            console.log(`✅ 文件共享删除事件已触发`);
          } catch (error) {
            console.error('❌ 处理文件共享删除失败:', error);
          }
          break;
          
        case 'file-share-list-request':
          // 收到文件共享列表请求
          console.log(`📋 收到文件共享列表请求 from ${message.from}`);
          try {
            // 获取本地共享列表
            const localShares = await invoke<any[]>('get_local_shares');
            
            if (localShares && localShares.length > 0) {
              console.log(`📤 发送 ${localShares.length} 个文件共享信息给 ${message.from}`);
              
              // 转换为前端格式
              const shares = localShares.map(share => ({
                shareId: share.id,
                shareName: share.name,
                playerName: this.localPlayerName,
                hasPassword: !!share.password,
              }));
              
              // 发送响应
              this.sendWebSocketMessage({
                type: 'file-share-list-response',
                from: this.localPlayerId,
                to: message.from,
                shares: shares,
              });
            } else {
              console.log(`📭 我没有活跃的文件共享`);
            }
          } catch (error) {
            console.error('❌ 处理文件共享列表请求失败:', error);
          }
          break;
          
        case 'file-share-list-response':
          // 收到文件共享列表响应
          console.log(`📥 收到文件共享列表响应 from ${message.from}, shares: ${message.shares?.length || 0}`);
          try {
            if (message.shares && Array.isArray(message.shares)) {
              // 为每个共享触发添加事件
              message.shares.forEach((share: any) => {
                window.dispatchEvent(new CustomEvent('file-share-added', {
                  detail: {
                    shareId: share.shareId,
                    shareName: share.shareName,
                    playerId: message.from,
                    playerName: share.playerName,
                    hasPassword: share.hasPassword,
                  }
                }));
              });
              console.log(`✅ 文件共享列表已添加到UI`);
            }
          } catch (error) {
            console.error('❌ 处理文件共享列表响应失败:', error);
          }
          break;
          
        default:
          console.warn(`未知消息类型: ${message.type}`);
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
      const peerId = message.from;
      
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
        
        // 如果连接已建立，这可能是重新协商的offer，需要处理
        if (state === 'connected') {
          console.log(`🔄 收到重新协商的 Offer，开始处理...`);
          
          try {
            // 标记正在协商
            peer.isNegotiating = true;
            
            // 检查信令状态，优先处理 offer 冲突（glare）
            if (signalingState !== 'stable') {
              if (signalingState === 'have-local-offer') {
                console.warn(`⚠️ 信令状态为 have-local-offer，执行 rollback 后处理远端 Offer`);
                await peer.connection.setLocalDescription({ type: 'rollback' });
              } else {
                console.warn(`⚠️ 信令状态不是 stable (${signalingState})，等待状态恢复...`);
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
        
        // 如果连接正在建立中，忽略新的offer
        if (state === 'connecting') {
          console.log(`连接正在建立中，忽略新的Offer`);
          return;
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
      const peerId = message.from;
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
      const peerId = message.from;
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
    if (!this.websocket) {
      console.error('❌ WebSocket实例不存在，无法发送消息:', message.type);
      return false;
    }

    if (this.websocket.readyState === WebSocket.OPEN) {
      try {
        this.websocket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('❌ 发送WebSocket消息失败:', error, message.type);
        return false;
      }
    }

    const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    const stateName = stateNames[this.websocket.readyState] || 'UNKNOWN';
    console.error(`❌ WebSocket未就绪(${stateName})，无法发送消息:`, message.type);
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

      const currentPc = this.peerConnections.get(peerId);
      if (currentPc && (currentPc.connection.connectionState === 'connected' || currentPc.connection.connectionState === 'connecting')) {
        console.log(`[WebRTC] ${peerId} 连接已恢复，取消重连（${reason}）`);
        return;
      }

      if (this.localPlayerId <= peerId) {
        console.log(`[WebRTC] 等待 ${peerId} 主动重连（ID字典序较小）`);
        return;
      }

      if (this.reconnectingPeers.has(peerId)) {
        console.log(`[WebRTC] ${peerId} 正在重连中，跳过重复重连（${reason}）`);
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
    this.removePeerConnection(peerId);
    
    // 触发回调
    if (this.onPlayerLeftCallback) {
      this.onPlayerLeftCallback(peerId);
    }
  }

  /**
   * 处理重连
   */
  private async handleReconnect(peerId: string): Promise<void> {
    try {
      console.log(`🔄 开始重连 ${peerId}...`);
      
      // 检查是否已经在重连中
      const existingPeer = this.peerConnections.get(peerId);
      if (existingPeer && existingPeer.connection.connectionState === 'connecting') {
        console.log(`⏳ ${peerId} 已经在重连中，跳过...`);
        return;
      }
      
      // 移除旧连接（不触发回调）
      this.removePeerConnection(peerId);
      
      // 等待一小段时间让旧连接完全关闭
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 只有ID字典序较大的一方才主动重连
      if (this.localPlayerId > peerId) {
        console.log(`📡 主动重连 ${peerId}（ID字典序较大）`);
        
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
        
        await this.sendOfferWithRetry(peerId, {
          type: offer.type,
          sdp: offer.sdp,
        }, '重连');
      } else {
        console.log(`⏳ 等待 ${peerId} 主动重连（ID字典序较小）`);
      }
    } catch (error) {
      console.error(`❌ 重连失败 ${peerId}:`, error);
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
          
          // 只有ID字典序较大的一方才主动重连，避免双方同时重连
          if (this.localPlayerId > peerId) {
            console.log(`🔄 连接失败，调度重连 ${peerId}...`);
            this.schedulePeerReconnect(peerId, '连接失败', 2000);
          } else {
            console.log(`⏳ 等待 ${peerId} 主动重连（ID字典序较小）`);
          }
        } else if (pc.connectionState === 'disconnected') {
          console.warn(`⚠️ 与 ${peerId} 的连接断开`);
          
          // 清除旧的重连定时器
          this.clearPeerReconnectState(peerId);
          
          // 等待8秒看是否能自动恢复（给ICE更多时间尝试重连）
          if (this.localPlayerId > peerId) {
            console.log(`🔄 连接断开，调度重连 ${peerId}...`);
            this.schedulePeerReconnect(peerId, '连接断开', 8000);
          } else {
            console.log(`⏳ 等待 ${peerId} 主动重连（ID字典序较小）`);
          }
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
            
            // 监听播放事件
            audioElement.onplay = () => {
              console.log(`✅ 开始播放 ${peerId} 的音频`);
            };
            
            audioElement.onerror = (e) => {
              console.error(`❌ 播放 ${peerId} 的音频失败:`, e);
            };
            
            // 保存音频元素和流
            const peerConn = this.peerConnections.get(peerId);
            if (peerConn) {
              peerConn.audioStream = event.streams[0];
              peerConn.audioElement = audioElement;
              console.log(`✅ 音频元素已保存 for ${peerId}`);
            }
            
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
          
          // 如果是ID字典序较大的一方，调度重连（避免立即重连导致频繁失败）
          if (this.localPlayerId > peerId) {
            console.log(`🔄 连接超时，调度重连 ${peerId}...`);
            this.schedulePeerReconnect(peerId, '连接超时', 2000);
          }
        }
      }, 30000);

      console.log(`✅ Peer Connection 创建成功 for ${peerId}`);
    } catch (error) {
      console.error(`❌ 创建 Peer Connection 失败 for ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * 设置麦克风状态
   * 第一次开麦时获取麦克风，之后只启用/禁用轨道，不释放资源
   */
  async setMicEnabled(enabled: boolean): Promise<void> {
    try {
      console.log('🎤 设置麦克风状态:', enabled ? '开启' : '关闭');

      if (enabled) {
        console.log('正在获取麦克风权限...');

        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        console.log('✅ 麦克风权限已获取');
        const newAudioTrack = newStream.getAudioTracks()[0];

        for (const [peerId, pc] of this.peerConnections) {
          if (pc.isNegotiating) {
            console.log('⏳ 等待 ' + peerId + ' 的协商完成...');
            let waitCount = 0;
            while (pc.isNegotiating && waitCount < 30) {
              await new Promise(resolve => setTimeout(resolve, 100));
              waitCount++;
            }
          }

          const transceivers = pc.connection.getTransceivers();
          const audioTransceiver = transceivers.find(t => t.receiver.track.kind === 'audio');

          if (audioTransceiver && audioTransceiver.sender) {
            await audioTransceiver.sender.replaceTrack(newAudioTrack);
            console.log('✅ 已替换 peer ' + peerId + ' 的音频轨道');
            await this.renegotiatePeer(peerId, pc);
          } else {
            pc.connection.addTrack(newAudioTrack, newStream);
            console.log('✅ 已添加 peer ' + peerId + ' 的音频轨道');
            await this.renegotiatePeer(peerId, pc);
          }
        }

        if (this.localStream) {
          const oldTracks = this.localStream.getAudioTracks();
          oldTracks.forEach(track => track.stop());
        }

        this.localStream = newStream;
      } else {
        if (this.localStream) {
          const audioTracks = this.localStream.getAudioTracks();
          console.log('正在停止并释放', audioTracks.length, '个音频轨道...');

          audioTracks.forEach((track, index) => {
            track.stop();
            console.log('轨道 ' + (index + 1) + ' 已停止并释放');
          });

          for (const [peerId, pc] of this.peerConnections) {
            if (pc.isNegotiating) {
              console.log('⏳ 等待 ' + peerId + ' 的协商完成...');
              let waitCount = 0;
              while (pc.isNegotiating && waitCount < 30) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
              }
            }

            const senders = pc.connection.getSenders();
            const audioSender = senders.find(sender => sender.track?.kind === 'audio');

            if (audioSender) {
              await audioSender.replaceTrack(null);
              console.log('✅ 已移除 peer ' + peerId + ' 的音频轨道');
              await this.renegotiatePeer(peerId, pc);
            }
          }

          this.localStream = null;
          console.log('✅ 麦克风已关闭，资源已释放');
        }
      }

      await this.broadcastStatusUpdate(enabled);
      console.log('✅ 麦克风状态已更新并广播');
    } catch (error) {
      console.error('❌ 设置麦克风状态失败:', error);
      throw error;
    }
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
   * 设置事件回调
   */
  onPlayerJoined(callback: (playerId: string, playerName: string, virtualIp?: string, virtualDomain?: string, useDomain?: boolean) => void): void {
    this.onPlayerJoinedCallback = callback;
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

  onChatMessage(callback: (playerId: string, playerName: string, content: string, timestamp: number) => void): void {
    this.onChatMessageCallback = callback;
  }

  /**
   * 设置版本错误回调
   */
  onVersionError(callback: (currentVersion: string, minimumVersion: string, downloadUrl: string) => void): void {
    this.onVersionErrorCallback = callback;
  }

  /**
   * 发送聊天消息
   */
  async sendChatMessage(content: string): Promise<void> {
    try {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket未连接');
      }

      const message = {
        type: 'chat-message',
        from: this.localPlayerId,
        playerId: this.localPlayerId,
        playerName: this.localPlayerName,
        content: content,
        timestamp: Date.now(),
      };

      this.sendWebSocketMessage(message);
      console.log('📤 聊天消息已发送:', content);
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
      
      // 清理重连定时器
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      
      // 清理所有peer重连状态
      this.reconnectTimers.forEach(timer => clearTimeout(timer));
      this.reconnectTimers.clear();
      this.reconnectingPeers.clear();
      this.knownPlayers.clear();
      
      // 重置重连计数
      this.reconnectAttempts = 0;
      
      // 停止心跳（先停止，避免在清理过程中发送消息）
      this.stopHeartbeat();
      console.log('✅ 心跳已停止');

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













