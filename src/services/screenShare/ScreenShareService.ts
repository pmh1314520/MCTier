/**
 * 屏幕共享服务
 * 基于WebRTC实现P2P屏幕共享
 */

import type { ScreenShare } from '../../types';

interface ScreenShareOffer {
  shareId: string;
  playerId: string;
  playerName: string;
  requirePassword: boolean;
  sdp: string;
}

interface ScreenShareAnswer {
  shareId: string;
  sdp: string;
}

class ScreenShareService {
  private localStream: MediaStream | null = null;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private activeShares: Map<string, ScreenShare> = new Map();
  // 事件回调（预留，暂未使用）
  // private onShareListUpdateCallback?: (shares: ScreenShare[]) => void;
  private currentPlayerId: string = '';
  private currentPlayerName: string = '';
  private ws: WebSocket | null = null;

  /**
   * 初始化服务
   */
  initialize(playerId: string, playerName: string, ws: WebSocket): void {
    this.currentPlayerId = playerId;
    this.currentPlayerName = playerName;
    this.ws = ws;
    
    // 监听WebSocket消息
    this.setupWebSocketListeners();
    
    console.log('✅ [ScreenShareService] 初始化完成');
  }

  /**
   * 设置共享列表更新回调（预留，暂未使用）
   */
  onShareListUpdate(_callback: (shares: ScreenShare[]) => void): void {
    // TODO: 实现共享列表更新回调
    console.log('屏幕共享列表更新回调已设置（暂未实现）');
  }

  /**
   * 开始共享屏幕
   */
  async startSharing(requirePassword: boolean, password?: string): Promise<string> {
    try {
      console.log('🖥️ [ScreenShareService] 开始捕获屏幕...');
      
      // 捕获屏幕
      this.localStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
        } as any,
        audio: false,
      });

      console.log('✅ [ScreenShareService] 屏幕捕获成功');

      // 生成共享ID
      const shareId = `share-${this.currentPlayerId}-${Date.now()}`;

      // 创建共享信息
      const share: ScreenShare = {
        id: shareId,
        playerId: this.currentPlayerId,
        playerName: this.currentPlayerName,
        virtualIp: '', // 将由后端填充
        requirePassword,
        password,
        startTime: Date.now(),
        status: 'active',
      };

      this.activeShares.set(shareId, share);

      // 监听屏幕共享停止事件
      this.localStream.getVideoTracks()[0].onended = () => {
        console.log('🛑 [ScreenShareService] 用户停止了屏幕共享');
        this.stopSharing(shareId);
      };

      // 通知其他玩家
      this.broadcastShareStart(share);

      console.log('✅ [ScreenShareService] 屏幕共享已启动:', shareId);
      return shareId;
    } catch (error) {
      console.error('❌ [ScreenShareService] 启动屏幕共享失败:', error);
      throw error;
    }
  }

  /**
   * 停止共享屏幕
   */
  stopSharing(shareId: string): void {
    console.log('🛑 [ScreenShareService] 停止屏幕共享:', shareId);

    // 停止本地流
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // 关闭所有相关的PeerConnection
    this.peerConnections.forEach((pc, key) => {
      if (key.startsWith(shareId)) {
        pc.close();
        this.peerConnections.delete(key);
      }
    });

    // 移除共享信息
    this.activeShares.delete(shareId);

    // 通知其他玩家
    this.broadcastShareStop(shareId);

    console.log('✅ [ScreenShareService] 屏幕共享已停止');
  }

  /**
   * 请求查看屏幕
   */
  async requestViewScreen(shareId: string, password?: string): Promise<MediaStream> {
    try {
      console.log('👀 [ScreenShareService] 请求查看屏幕:', shareId);

      // 创建PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      const connectionKey = `${shareId}-viewer-${Date.now()}`;
      this.peerConnections.set(connectionKey, pc);

      // 等待远程流的Promise
      const streamPromise = new Promise<MediaStream>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('等待屏幕共享响应超时'));
        }, 30000); // 增加到30秒超时

        // 监听远程流
        pc.ontrack = (event) => {
          console.log('✅ [ScreenShareService] 收到远程屏幕流');
          clearTimeout(timeout);
          
          if (event.streams && event.streams[0]) {
            // 将流保存到全局变量供ScreenViewer使用
            (window as any).__screenShareStream__ = event.streams[0];
            resolve(event.streams[0]);
          } else {
            reject(new Error('未收到有效的媒体流'));
          }
        };

        // 监听ICE候选
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            this.sendWebSocketMessage({
              type: 'screen-share-ice-candidate',
              data: {
                shareId,
                candidate: event.candidate,
              },
            });
          }
        };

        // 监听连接状态
        pc.onconnectionstatechange = () => {
          console.log(`🔗 [ScreenShareService] 连接状态: ${pc.connectionState}`);
          
          if (pc.connectionState === 'failed') {
            clearTimeout(timeout);
            reject(new Error('WebRTC连接失败'));
          } else if (pc.connectionState === 'disconnected') {
            console.warn('⚠️ [ScreenShareService] 连接断开');
          }
        };
      });

      // 创建Offer
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false,
      });

      await pc.setLocalDescription(offer);

      // 发送Offer到共享者
      const offerMessage = {
        shareId,
        playerId: this.currentPlayerId,
        playerName: this.currentPlayerName,
        requirePassword: !!password,
        password: password,
        sdp: offer.sdp!,
      };

      this.sendWebSocketMessage({
        type: 'screen-share-offer',
        data: offerMessage,
      });

      console.log('📤 [ScreenShareService] Offer已发送');

      // 等待流
      return await streamPromise;
    } catch (error) {
      console.error('❌ [ScreenShareService] 请求查看屏幕失败:', error);
      throw error;
    }
  }

  /**
   * 获取当前所有共享
   */
  getActiveShares(): ScreenShare[] {
    return Array.from(this.activeShares.values());
  }

  /**
   * 设置WebSocket监听器
   */
  private setupWebSocketListeners(): void {
    if (!this.ws) return;

    // 注意：实际的消息监听应该在WebRTC客户端中统一处理
    // 这里只是示例，实际实现需要与现有的WebSocket集成
  }

  /**
   * 广播共享开始
   */
  private broadcastShareStart(share: ScreenShare): void {
    this.sendWebSocketMessage({
      type: 'screen-share-start',
      data: {
        shareId: share.id,
        playerId: share.playerId,
        playerName: share.playerName,
        requirePassword: share.requirePassword,
        startTime: share.startTime,
      },
    });
  }

  /**
   * 广播共享停止
   */
  private broadcastShareStop(shareId: string): void {
    this.sendWebSocketMessage({
      type: 'screen-share-stop',
      data: { shareId },
    });
  }

  /**
   * 发送WebSocket消息
   */
  private sendWebSocketMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * 处理收到的Offer
   */
  async handleOffer(offer: ScreenShareOffer): Promise<void> {
    try {
      console.log('📨 [ScreenShareService] 收到查看请求:', offer);

      if (!this.localStream) {
        console.error('❌ [ScreenShareService] 没有活动的屏幕共享');
        return;
      }

      // 创建PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      const connectionKey = `${offer.shareId}-sharer-${offer.playerId}`;
      this.peerConnections.set(connectionKey, pc);

      // 添加本地流
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });

      // 设置远程描述
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: offer.sdp,
      });

      // 创建Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 发送Answer
      const answerMessage: ScreenShareAnswer = {
        shareId: offer.shareId,
        sdp: answer.sdp!,
      };

      this.sendWebSocketMessage({
        type: 'screen-share-answer',
        data: answerMessage,
        targetPlayerId: offer.playerId,
      });

      // 监听ICE候选
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendWebSocketMessage({
            type: 'screen-share-ice-candidate',
            data: {
              shareId: offer.shareId,
              candidate: event.candidate,
            },
            targetPlayerId: offer.playerId,
          });
        }
      };

      console.log('✅ [ScreenShareService] 已响应查看请求');
    } catch (error) {
      console.error('❌ [ScreenShareService] 处理Offer失败:', error);
    }
  }

  /**
   * 处理收到的Answer
   */
  async handleAnswer(answer: ScreenShareAnswer, viewerPlayerId: string): Promise<void> {
    try {
      console.log('📨 [ScreenShareService] 收到Answer');

      const connectionKey = `${answer.shareId}-viewer-${viewerPlayerId}`;
      const pc = this.peerConnections.get(connectionKey);

      if (!pc) {
        console.error('❌ [ScreenShareService] 找不到对应的PeerConnection');
        return;
      }

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answer.sdp,
      });

      console.log('✅ [ScreenShareService] Answer已设置');
    } catch (error) {
      console.error('❌ [ScreenShareService] 处理Answer失败:', error);
    }
  }

  /**
   * 处理ICE候选
   */
  async handleIceCandidate(shareId: string, candidate: RTCIceCandidateInit): Promise<void> {
    try {
      // 查找对应的PeerConnection
      for (const [key, pc] of this.peerConnections.entries()) {
        if (key.startsWith(shareId)) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          console.log('✅ [ScreenShareService] ICE候选已添加');
          break;
        }
      }
    } catch (error) {
      console.error('❌ [ScreenShareService] 处理ICE候选失败:', error);
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    console.log('🧹 [ScreenShareService] 清理资源...');

    // 停止所有共享
    this.activeShares.forEach((_, shareId) => {
      this.stopSharing(shareId);
    });

    // 关闭所有PeerConnection
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();

    this.activeShares.clear();
    this.ws = null;

    console.log('✅ [ScreenShareService] 资源已清理');
  }
}

export const screenShareService = new ScreenShareService();
