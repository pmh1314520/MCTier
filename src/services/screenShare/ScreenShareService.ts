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
  password?: string; // 【修复】添加密码字段用于验证
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
  // 存储接收到的远程流（用于查看者）
  private remoteStreams: Map<string, MediaStream> = new Map();
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
    
    console.log('✅ [ScreenShareService] 初始化完成', {
      playerId: this.currentPlayerId,
      playerName: this.currentPlayerName,
      wsReady: this.ws?.readyState === WebSocket.OPEN
    });
  }

  /**
   * 设置共享列表更新回调（预留，暂未使用）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      console.log('🔐 [ScreenShareService] 收到密码:', password ? '***' : 'undefined');

      // 从shareId中提取共享者的playerId
      // shareId格式: share-{playerId}-{timestamp}
      const shareIdParts = shareId.split('-');
      if (shareIdParts.length < 3) {
        throw new Error('无效的shareId格式');
      }
      // 提取playerId (去掉"share-"前缀和时间戳后缀)
      const sharerPlayerId = shareIdParts.slice(1, -1).join('-');
      console.log('📍 [ScreenShareService] 共享者PlayerId:', sharerPlayerId);

      // 【修复】清理同一个shareId的旧连接，避免状态冲突
      for (const [key, oldPc] of this.peerConnections.entries()) {
        if (key.startsWith(`${shareId}-viewer-`)) {
          console.log('🧹 [ScreenShareService] 清理旧的PeerConnection:', key);
          oldPc.close();
          this.peerConnections.delete(key);
        }
      }

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
          console.error('❌ [ScreenShareService] 等待屏幕共享响应超时（30秒）');
          reject(new Error('等待屏幕共享响应超时，请检查密码是否正确或信令服务器是否正常'));
        }, 30000); // 30秒超时

        // 【修复】监听screen-share-error事件（密码错误）
        const handleError = (event: any) => {
          const { shareId: errorShareId, error } = event.detail;
          if (errorShareId === shareId) {
            console.error('❌ [ScreenShareService] 收到屏幕共享错误:', error);
            clearTimeout(timeout);
            window.removeEventListener('screen-share-error', handleError);
            reject(new Error(error || '查看屏幕失败'));
          }
        };
        
        window.addEventListener('screen-share-error', handleError);

        // 监听远程流
        pc.ontrack = (event) => {
          console.log('✅ [ScreenShareService] 收到远程屏幕流');
          clearTimeout(timeout);
          window.removeEventListener('screen-share-error', handleError);
          
          if (event.streams && event.streams[0]) {
            const stream = event.streams[0];
            
            // 将流保存到服务中，供独立窗口访问
            this.remoteStreams.set(shareId, stream);
            
            console.log('📺 [ScreenShareService] 流已保存到服务中');
            resolve(stream);
          } else {
            reject(new Error('未收到有效的媒体流'));
          }
        };

        // 监听ICE候选
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            this.sendWebSocketMessage({
              type: 'screen-share-ice-candidate',
              from: this.currentPlayerId,
              to: sharerPlayerId,
              shareId,
              candidate: {
                candidate: event.candidate.candidate,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sdpMid: event.candidate.sdpMid,
              },
            });
          }
        };

        // 监听连接状态
        pc.onconnectionstatechange = () => {
          console.log(`🔗 [ScreenShareService] 连接状态: ${pc.connectionState}`);
          
          if (pc.connectionState === 'failed') {
            clearTimeout(timeout);
            window.removeEventListener('screen-share-error', handleError);
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
      this.sendWebSocketMessage({
        type: 'screen-share-offer',
        from: this.currentPlayerId,
        to: sharerPlayerId,
        shareId,
        playerName: this.currentPlayerName, // 【修复】发送查看者名字
        password: password, // 【修复】发送密码用于验证
        offer: {
          type: offer.type,
          sdp: offer.sdp!,
        },
      });

      console.log('📤 [ScreenShareService] Offer已发送，包含密码:', password ? '***' : 'undefined');
      console.log('📤 [ScreenShareService] 查看者名字:', this.currentPlayerName);

      // 等待流
      return await streamPromise;
    } catch (error) {
      console.error('❌ [ScreenShareService] 请求查看屏幕失败:', error);
      throw error;
    }
  }

  /**
   * 获取已保存的远程流（供独立窗口使用）
   */
  getRemoteStream(shareId: string): MediaStream | null {
    const stream = this.remoteStreams.get(shareId);
    if (stream) {
      console.log('✅ [ScreenShareService] 从服务中获取到流:', shareId);
      return stream;
    }
    console.warn('⚠️ [ScreenShareService] 未找到流:', shareId);
    return null;
  }

  /**
   * 停止查看屏幕（清理viewer的PeerConnection）
   */
  stopViewingScreen(shareId: string): void {
    console.log('🛑 [ScreenShareService] 停止查看屏幕:', shareId);

    // 【新增】清除查看者标记
    const share = this.activeShares.get(shareId);
    if (share && share.viewerId === this.currentPlayerId) {
      console.log('� [ScreenShareService] 清除查看者标记');
      share.viewerId = undefined;
      share.viewerName = undefined;
      this.activeShares.set(shareId, share);
      
      // 通知共享者更新状态
      this.sendWebSocketMessage({
        type: 'screen-share-viewer-left',
        from: this.currentPlayerId,
        shareId: shareId,
      });
    }

    // 关闭所有viewer相关的PeerConnection
    const keysToDelete: string[] = [];
    this.peerConnections.forEach((pc, key) => {
      if (key.startsWith(`${shareId}-viewer-`)) {
        console.log('🔌 [ScreenShareService] 关闭PeerConnection:', key);
        pc.close();
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.peerConnections.delete(key));

    // 移除远程流
    this.remoteStreams.delete(shareId);

    console.log('✅ [ScreenShareService] 已清理查看资源');
  }

  /**
   * 获取当前所有共享
   */
  getActiveShares(): ScreenShare[] {
    const shares = Array.from(this.activeShares.values());
    console.log('📋 [ScreenShareService] 获取活跃共享列表:', shares.map(s => ({
      id: s.id,
      playerId: s.playerId,
      playerName: s.playerName,
      requirePassword: s.requirePassword,
      hasPassword: !!s.password
    })));
    return shares;
  }

  /**
   * 【新增】获取自己创建的共享（用于响应列表请求）
   */
  getMyActiveShares(): ScreenShare[] {
    const myShares = Array.from(this.activeShares.values()).filter(
      share => share.playerId === this.currentPlayerId
    );
    console.log('📋 [ScreenShareService] 获取我的活跃共享列表:', myShares.map(s => ({
      id: s.id,
      playerId: s.playerId,
      playerName: s.playerName,
      requirePassword: s.requirePassword,
      hasPassword: !!s.password
    })));
    return myShares;
  }

  /**
   * 广播共享开始
   */
  private broadcastShareStart(share: ScreenShare): void {
    console.log('📢 [ScreenShareService] 广播共享开始', {
      shareId: share.id,
      playerId: share.playerId,
      playerName: share.playerName,
      requirePassword: share.requirePassword
    });
    
    this.sendWebSocketMessage({
      type: 'screen-share-start',
      from: this.currentPlayerId,
      shareId: share.id,
      playerName: share.playerName,
      hasPassword: share.requirePassword,
    });
  }

  /**
   * 广播共享停止
   */
  private broadcastShareStop(shareId: string): void {
    this.sendWebSocketMessage({
      type: 'screen-share-stop',
      from: this.currentPlayerId,
      shareId: shareId,
    });
  }

  /**
   * 广播共享状态更新
   */
  private broadcastShareUpdate(share: ScreenShare): void {
    console.log('📢 [ScreenShareService] 广播共享状态更新', {
      shareId: share.id,
      viewerId: share.viewerId,
      viewerName: share.viewerName
    });
    
    this.sendWebSocketMessage({
      type: 'screen-share-update',
      from: this.currentPlayerId,
      shareId: share.id,
      viewerId: share.viewerId,
      viewerName: share.viewerName,
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

      const share = this.activeShares.get(offer.shareId);
      if (!share) {
        console.error('❌ [ScreenShareService] 找不到对应的共享');
        this.sendWebSocketMessage({
          type: 'screen-share-error',
          from: this.currentPlayerId,
          to: offer.playerId,
          shareId: offer.shareId,
          error: '共享不存在',
        });
        return;
      }

      // 【新增】检查是否已有人在查看
      if (share.viewerId && share.viewerId !== offer.playerId) {
        console.warn('⚠️ [ScreenShareService] 已有玩家在查看:', share.viewerName);
        this.sendWebSocketMessage({
          type: 'screen-share-error',
          from: this.currentPlayerId,
          to: offer.playerId,
          shareId: offer.shareId,
          error: `该屏幕正在被 ${share.viewerName} 查看，暂时无法同时观看`,
        });
        return;
      }

      // 【修复】验证密码
      if (share.requirePassword) {
        console.log('🔐 [ScreenShareService] 该共享需要密码验证');
        console.log('🔐 [ScreenShareService] 共享密码:', share.password ? '***' : 'undefined');
        console.log('🔐 [ScreenShareService] 收到密码:', offer.password ? '***' : 'undefined');
        console.log('🔐 [ScreenShareService] 密码匹配:', offer.password === share.password);
        
        if (!offer.password || offer.password !== share.password) {
          console.error('❌ [ScreenShareService] 密码验证失败');
          console.error('❌ [ScreenShareService] 期望密码:', share.password);
          console.error('❌ [ScreenShareService] 收到密码:', offer.password);
          // 发送错误消息给查看者
          this.sendWebSocketMessage({
            type: 'screen-share-error',
            from: this.currentPlayerId,
            to: offer.playerId,
            shareId: offer.shareId,
            error: '密码错误',
          });
          return;
        }
        console.log('✅ [ScreenShareService] 密码验证成功');
      }

      // 【新增】标记该共享正在被查看
      share.viewerId = offer.playerId;
      share.viewerName = offer.playerName;
      this.activeShares.set(offer.shareId, share);
      console.log('👁️ [ScreenShareService] 标记共享正在被查看:', {
        shareId: offer.shareId,
        viewerId: offer.playerId,
        viewerName: offer.playerName
      });

      // 【新增】广播共享状态更新
      this.broadcastShareUpdate(share);

      // 创建PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      const connectionKey = `${offer.shareId}-sharer-${offer.playerId}`;
      this.peerConnections.set(connectionKey, pc);

      // 【新增】监听连接断开，清除查看者标记
      pc.onconnectionstatechange = () => {
        console.log(`🔗 [ScreenShareService] 连接状态变化: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          console.log('🔌 [ScreenShareService] 查看者断开连接，清除标记');
          const currentShare = this.activeShares.get(offer.shareId);
          if (currentShare && currentShare.viewerId === offer.playerId) {
            currentShare.viewerId = undefined;
            currentShare.viewerName = undefined;
            this.activeShares.set(offer.shareId, currentShare);
            // 广播状态更新
            this.broadcastShareUpdate(currentShare);
          }
        }
      };

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
      this.sendWebSocketMessage({
        type: 'screen-share-answer',
        from: this.currentPlayerId,
        to: offer.playerId,
        shareId: offer.shareId,
        answer: {
          type: answer.type,
          sdp: answer.sdp!,
        },
      });

      // 监听ICE候选
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendWebSocketMessage({
            type: 'screen-share-ice-candidate',
            from: this.currentPlayerId,
            to: offer.playerId,
            shareId: offer.shareId,
            candidate: {
              candidate: event.candidate.candidate,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sdpMid: event.candidate.sdpMid,
            },
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
  async handleAnswer(answer: ScreenShareAnswer, _viewerPlayerId: string): Promise<void> {
    try {
      console.log('📨 [ScreenShareService] 收到Answer');

      // 查找对应的PeerConnection
      // 需要遍历所有连接，找到匹配的viewer连接
      let foundPc: RTCPeerConnection | null = null;
      for (const [key, pc] of this.peerConnections.entries()) {
        if (key.startsWith(`${answer.shareId}-viewer-`)) {
          foundPc = pc;
          break;
        }
      }

      if (!foundPc) {
        console.error('❌ [ScreenShareService] 找不到对应的PeerConnection');
        return;
      }

      // 检查信令状态，只有在'have-local-offer'状态时才能设置Answer
      const signalingState = foundPc.signalingState;
      console.log(`🔍 [ScreenShareService] 当前信令状态: ${signalingState}`);

      if (signalingState !== 'have-local-offer') {
        console.error(`❌ [ScreenShareService] 信令状态错误: ${signalingState}，无法设置Answer`);
        console.error('💡 只有在have-local-offer状态时才能设置Answer');
        return;
      }

      await foundPc.setRemoteDescription({
        type: 'answer',
        sdp: answer.sdp,
      });

      console.log('✅ [ScreenShareService] Answer已设置');
    } catch (error) {
      console.error('❌ [ScreenShareService] 处理Answer失败:', error);
      console.error('错误详情:', error);
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
   * 处理查看者离开
   */
  handleViewerLeft(shareId: string, viewerId: string): void {
    console.log('👋 [ScreenShareService] 查看者离开:', { shareId, viewerId });
    
    const share = this.activeShares.get(shareId);
    if (share && share.viewerId === viewerId) {
      share.viewerId = undefined;
      share.viewerName = undefined;
      this.activeShares.set(shareId, share);
      console.log('🔓 [ScreenShareService] 已清除查看者标记');
      
      // 广播状态更新
      this.broadcastShareUpdate(share);
    }
  }

  /**
   * 处理共享状态更新
   */
  handleShareUpdate(shareId: string, viewerId?: string, viewerName?: string): void {
    console.log('🔄 [ScreenShareService] 收到共享状态更新:', { shareId, viewerId, viewerName });
    
    // 这个方法主要用于其他客户端接收共享状态更新
    // 实际的共享对象由WebRTCClient管理，这里只是记录日志
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
    this.remoteStreams.clear();
    this.ws = null;

    console.log('✅ [ScreenShareService] 资源已清理');
  }
}

export const screenShareService = new ScreenShareService();
