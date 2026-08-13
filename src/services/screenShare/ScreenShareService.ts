/**
 * 屏幕共享服务
 * 基于WebRTC实现P2P屏幕共享
 */

import type { ScreenShare } from '../../types';
import { buildRelayTopology } from './relayTopology';

interface ScreenShareOffer {
  shareId: string;
  playerId: string;
  playerName: string;
  requirePassword: boolean;
  password?: string;
  sdp: string;
  routeVersion?: number;
}

interface ScreenShareAnswer {
  shareId: string;
  sdp: string;
  routeVersion?: number;
}

const isNullish = (value: unknown): value is null | undefined => value === null || value === undefined;

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
  private viewerOrder: Map<string, string[]> = new Map();
  private viewerNames: Map<string, Map<string, string>> = new Map();
  private readyViewers: Map<string, Set<string>> = new Map();
  private assignedUpstreams: Map<string, Map<string, string>> = new Map();
  private assignedRouteVersions: Map<string, Map<string, number>> = new Map();
  private expectedDownstreams: Map<string, Map<string, number>> = new Map();
  private routeVersions: Map<string, number> = new Map();
  private pendingViewRequests: Map<string, { resolve: (stream: MediaStream) => void; reject: (error: Error) => void; timer: number }> = new Map();
  private currentPasswords: Map<string, string | undefined> = new Map();
  private viewingUpstreams: Map<string, string> = new Map();
  private pendingRelayOffers: Map<string, ScreenShareOffer> = new Map();
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private relayProtocolConfirmed: Set<string> = new Set();
  private viewingRouteVersions: Map<string, number> = new Map();
  private directViewFallbacks: Set<string> = new Set();
  private unhealthyRelays: Map<string, Map<string, { until: number; failures: number }>> = new Map();
  private unhealthyRelayEdges: Map<string, Map<string, { until: number; failures: number }>> = new Map();
  private pendingDetachUpstreams: Map<string, Map<string, string>> = new Map();
  private viewingHealthTimers: Map<string, number> = new Map();
  private relayRecoveryTimers: Map<string, number> = new Map();
  private upstreamHealth: Map<string, { upstreamId: string; routeVersion?: number; sourceSequence: number; sentSequence: number; limited: boolean; receivedAt: number }> = new Map();
  private sourceFrameSequences: Map<string, number> = new Map();
  private outboundHealthTimers: Map<string, number> = new Map();

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
          // 【优化】提高帧率和分辨率，确保画质清晰流畅
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
        } as any,
        audio: false,
      });

      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        // 【优化】设置为detail模式，优先保证画质清晰
        videoTrack.contentHint = 'detail';
      }

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
      this.viewerOrder.set(shareId, []);
      this.viewerNames.set(shareId, new Map());
      this.readyViewers.set(shareId, new Set());
      this.assignedUpstreams.set(shareId, new Map());
      this.assignedRouteVersions.set(shareId, new Map());
      this.expectedDownstreams.set(shareId, new Map());
      this.routeVersions.set(shareId, 0);
      this.unhealthyRelays.set(shareId, new Map());
      this.unhealthyRelayEdges.set(shareId, new Map());
      this.pendingDetachUpstreams.set(shareId, new Map());

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
        this.stopOutboundHealthHeartbeat(key);
        pc.close();
        this.peerConnections.delete(key);
      }
    });

    // 移除共享信息
    this.activeShares.delete(shareId);
    this.viewerOrder.delete(shareId);
    this.viewerNames.delete(shareId);
    this.readyViewers.delete(shareId);
    this.assignedUpstreams.delete(shareId);
    this.assignedRouteVersions.delete(shareId);
    this.expectedDownstreams.delete(shareId);
    this.routeVersions.delete(shareId);
    this.unhealthyRelays.delete(shareId);
    this.unhealthyRelayEdges.delete(shareId);
    this.pendingDetachUpstreams.delete(shareId);
    const recoveryTimer = this.relayRecoveryTimers.get(shareId);
    if (recoveryTimer) window.clearTimeout(recoveryTimer);
    this.relayRecoveryTimers.delete(shareId);
    const healthTimer = this.viewingHealthTimers.get(shareId);
    if (healthTimer) window.clearInterval(healthTimer);
    this.viewingHealthTimers.delete(shareId);

    // 通知其他玩家
    this.broadcastShareStop(shareId);

    console.log('✅ [ScreenShareService] 屏幕共享已停止');
  }

  /**
   * 请求查看屏幕
   */
  async requestViewScreen(shareId: string, password?: string): Promise<MediaStream> {
    const share = this.activeShares.get(shareId);
    if (!share) throw new Error('共享不存在或已结束');
    this.currentPasswords.set(shareId, password);
    this.directViewFallbacks.delete(shareId);

    const previous = this.pendingViewRequests.get(shareId);
    if (previous) {
      window.clearTimeout(previous.timer);
      previous.reject(new Error('新的观看请求已替代旧请求'));
    }

    const streamPromise = new Promise<MediaStream>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingViewRequests.delete(shareId);
        reject(new Error('等待屏幕共享路由超时，请检查组网连接'));
      }, 30000);
      this.pendingViewRequests.set(shareId, { resolve, reject, timer });
    });

    this.sendWebSocketMessage({
      type: 'screen-share-relay',
      action: 'join',
      from: this.currentPlayerId,
      to: share.playerId,
      shareId,
      playerName: this.currentPlayerName,
      password,
    });
    window.setTimeout(() => {
      // 收到 accepted/route 只代表控制面可用，不代表视频帧已经到达。
      // 链式连接 5 秒内仍没有媒体时，直连共享者作为可靠性兜底。
      if (!this.pendingViewRequests.has(shareId) || this.viewingUpstreams.has(shareId)) return;
      void this.requestViewScreenDirect(shareId, password).then((stream) => {
        const pending = this.pendingViewRequests.get(shareId);
        const legacyEntry = Array.from(this.peerConnections.entries()).find(([key]) => key.startsWith(shareId + '-viewer-'));
        if (!pending) {
          if (legacyEntry) {
            legacyEntry[1].close();
            this.peerConnections.delete(legacyEntry[0]);
          }
          return;
        }
        this.directViewFallbacks.add(shareId);
        this.remoteStreams.set(shareId, stream);
        const directTrack = stream.getVideoTracks()[0];
        const previousHealthTimer = this.viewingHealthTimers.get(shareId);
        if (previousHealthTimer) window.clearInterval(previousHealthTimer);
        this.viewingHealthTimers.delete(shareId);
        if (legacyEntry && directTrack) {
          this.startViewingHealthMonitor(shareId, legacyEntry[1], directTrack, share.playerId, this.viewingRouteVersions.get(shareId));
        }
        for (const [key, relayPc] of this.peerConnections.entries()) {
          if (!key.startsWith(shareId + '-in-')) continue;
          relayPc.close();
          this.peerConnections.delete(key);
        }
        this.viewingUpstreams.set(shareId, share.playerId);
        const routeVersion = this.viewingRouteVersions.get(shareId);
        if (!isNullish(routeVersion)) {
          this.sendWebSocketMessage({
            type: 'screen-share-relay', action: 'failure', from: this.currentPlayerId,
            to: share.playerId, shareId, routeVersion, reason: 'direct-fallback',
          });
        }
        window.clearTimeout(pending.timer);
        this.pendingViewRequests.delete(shareId);
        pending.resolve(stream);
      }).catch((error) => {
        const pending = this.pendingViewRequests.get(shareId);
        if (!pending) return;
        window.clearTimeout(pending.timer);
        this.pendingViewRequests.delete(shareId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    }, 5000);
    return streamPromise;
  }

  /** 旧版直连实现保留作协议兼容回退，新版由共享者下发中继路由。 */
  private async requestViewScreenDirect(shareId: string, password?: string): Promise<MediaStream> {
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
      // 【稳定性修复】成员都在同一 EasyTier 虚拟局域网，使用 host 候选直连即可，
      // 移除被墙的 Google STUN，避免连接/重连卡顿与超时失败
      const pc = new RTCPeerConnection({
        iceServers: [],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
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
          const stream = event.streams?.[0] ?? new MediaStream([event.track]);
          const resolveWhenMediaArrives = async () => {
            await this.waitForDecodedVideoFrame(pc, event.track, 8000);
            clearTimeout(timeout);
            window.removeEventListener('screen-share-error', handleError);
            console.log('📺 [ScreenShareService] 已收到视频数据，流已保存');
            resolve(stream);
          };
          if (!event.track.muted) {
            void resolveWhenMediaArrives().catch(reject);
          } else {
            event.track.addEventListener('unmute', () => void resolveWhenMediaArrives().catch(reject), { once: true });
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
              connectionRole: 'out',
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
            console.warn('⚠️ [ScreenShareService] 连接断开，等待重连...');
            // 【优化】不立即失败，给予重连机会
          } else if (pc.connectionState === 'connected') {
            console.log('✅ [ScreenShareService] 连接已建立');
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

  getLocalStream(shareId: string): MediaStream | null {
    const share = this.activeShares.get(shareId);
    return share?.playerId === this.currentPlayerId ? this.localStream : null;
  }

  /**
   * 停止查看屏幕（清理viewer的PeerConnection）
   */
  stopViewingScreen(shareId: string): void {
    console.log('🛑 [ScreenShareService] 停止查看屏幕:', shareId);

    const share = this.activeShares.get(shareId);
    if (share?.playerId === this.currentPlayerId) {
      // 兼容旧版本曾把“自己看自己”加入观看者列表的状态。
      // 本地直出不应占用观看者名额，停止时主动清理并广播最新人数。
      this.handleViewerLeft(shareId, this.currentPlayerId);
    } else if (share) {
      this.sendWebSocketMessage({
        type: 'screen-share-viewer-left',
        from: this.currentPlayerId,
        shareId,
      });
    }

    const pending = this.pendingViewRequests.get(shareId);
    if (pending) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('已停止观看屏幕'));
      this.pendingViewRequests.delete(shareId);
    }

    const keysToDelete: string[] = [];
    this.peerConnections.forEach((pc, key) => {
      if (key.startsWith(`${shareId}-in-`) || key.startsWith(`${shareId}-out-`) || key.startsWith(`${shareId}-viewer-`)) {
        console.log('🔌 [ScreenShareService] 关闭PeerConnection:', key);
        pc.close();
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => {
      this.stopOutboundHealthHeartbeat(key);
      this.peerConnections.delete(key);
    });

    this.remoteStreams.delete(shareId);
    this.upstreamHealth.delete(shareId);
    this.sourceFrameSequences.delete(shareId);
    this.viewingUpstreams.delete(shareId);
    this.viewingRouteVersions.delete(shareId);
    const healthTimer = this.viewingHealthTimers.get(shareId);
    if (healthTimer) window.clearInterval(healthTimer);
    this.viewingHealthTimers.delete(shareId);
    this.relayProtocolConfirmed.delete(shareId);
    this.directViewFallbacks.delete(shareId);
    this.expectedDownstreams.delete(shareId);
    this.currentPasswords.delete(shareId);
    for (const key of this.pendingRelayOffers.keys()) {
      if (key.startsWith(shareId + ':')) this.pendingRelayOffers.delete(key);
    }
    for (const key of this.pendingIceCandidates.keys()) {
      if (key.startsWith(shareId + '-')) this.pendingIceCandidates.delete(key);
    }

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
      viewerCount: share.viewerCount,
    });
  }

  /** 处理链式中继控制面。共享者是唯一拓扑协调者。 */
  async handleRelayControl(message: any): Promise<void> {
    const shareId = message.shareId as string;
    const share = this.activeShares.get(shareId);
    if (!share) return;
    const ownerId = share.playerId;

    if (message.action === 'join' && this.currentPlayerId === ownerId) {
      if (share.requirePassword && message.password !== share.password) {
        this.sendWebSocketMessage({ type: 'screen-share-error', from: this.currentPlayerId, to: message.from, shareId, error: '密码错误' });
        return;
      }
      const order = this.viewerOrder.get(shareId) ?? [];
      if (!order.includes(message.from)) order.push(message.from);
      this.viewerOrder.set(shareId, order);
      const names = this.viewerNames.get(shareId) ?? new Map<string, string>();
      names.set(message.from, message.playerName || '玩家');
      this.viewerNames.set(shareId, names);
      this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'accepted', from: this.currentPlayerId, to: message.from, shareId });
      this.rebuildRelayRoutes(shareId);
      return;
    }

    if (message.action === 'health' && message.to === this.currentPlayerId) {
      this.upstreamHealth.set(shareId, {
        upstreamId: message.from,
        routeVersion: isNullish(message.routeVersion) ? undefined : Number(message.routeVersion),
        sourceSequence: Number(message.sourceSequence ?? message.sequence ?? 0),
        sentSequence: Number(message.sentSequence ?? message.sequence ?? 0),
        limited: Boolean(message.limited),
        receivedAt: Date.now(),
      });
      return;
    }

    if (message.action === 'ready' && this.currentPlayerId === ownerId) {
      if (!(this.viewerOrder.get(shareId) ?? []).includes(message.from)) return;
      const assignedVersion = this.assignedRouteVersions.get(shareId)?.get(message.from);
      if (isNullish(assignedVersion) || assignedVersion !== Number(message.routeVersion || 0)) return;
      const ready = this.readyViewers.get(shareId) ?? new Set<string>();
      ready.add(message.from);
      this.readyViewers.set(shareId, ready);
      const pendingDetach = this.pendingDetachUpstreams.get(shareId)?.get(message.from);
      if (pendingDetach && pendingDetach !== this.assignedUpstreams.get(shareId)?.get(message.from)) {
        if (pendingDetach === this.currentPlayerId) {
          const oldKey = shareId + '-out-' + message.from;
          this.stopOutboundHealthHeartbeat(oldKey);
          this.peerConnections.get(oldKey)?.close();
          this.peerConnections.delete(oldKey);
          this.expectedDownstreams.get(shareId)?.delete(message.from);
        } else {
          this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'detach', from: this.currentPlayerId, to: pendingDetach, shareId, downstreamId: message.from, routeVersion: Number(message.routeVersion || 0) });
        }
        this.pendingDetachUpstreams.get(shareId)?.delete(message.from);
      } else if (pendingDetach) {
        this.pendingDetachUpstreams.get(shareId)?.delete(message.from);
      }
      this.rebuildRelayRoutes(shareId);
      return;
    }

    if (message.action === 'failure' && this.currentPlayerId === ownerId) {
      const order = this.viewerOrder.get(shareId) ?? [];
      if (!order.includes(message.from)) return;
      const assignedUpstream = this.assignedUpstreams.get(shareId)?.get(message.from);
      if (message.upstreamId && assignedUpstream && message.upstreamId !== assignedUpstream) return;
      const assignedVersion = this.assignedRouteVersions.get(shareId)?.get(message.from);
      if (!isNullish(message.routeVersion) && assignedVersion !== Number(message.routeVersion)) return;
      this.markRelayFailure(shareId, message.from, assignedUpstream, message.reason || 'connection');
      if (assignedUpstream === this.currentPlayerId) {
        const oldKey = shareId + '-out-' + message.from;
        this.stopOutboundHealthHeartbeat(oldKey);
        this.peerConnections.get(oldKey)?.close();
        this.peerConnections.delete(oldKey);
        this.expectedDownstreams.get(shareId)?.delete(message.from);
      } else if (assignedUpstream) {
        this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'detach', from: this.currentPlayerId, to: assignedUpstream, shareId, downstreamId: message.from, routeVersion: assignedVersion });
      }
      // The failed edge is removed from the assignment before rebuilding;
      // healthy replacement routes are confirmed with a real decoded frame.
      this.readyViewers.get(shareId)?.delete(message.from);
      this.assignedUpstreams.get(shareId)?.delete(message.from);
      this.assignedRouteVersions.get(shareId)?.delete(message.from);
      this.rebuildRelayRoutes(shareId);
      return;
    }

    if (message.from !== ownerId) return;

    if (message.action === 'accepted' && message.to === this.currentPlayerId) {
      this.relayProtocolConfirmed.add(shareId);
      return;
    }

    if (message.action === 'route' && message.to === this.currentPlayerId && message.upstreamId) {
      this.relayProtocolConfirmed.add(shareId);
      await this.connectRelayUpstream(shareId, message.upstreamId, Number(message.routeVersion || 0));
      return;
    }

    if (message.action === 'child' && message.to === this.currentPlayerId && message.downstreamId) {
      const expected = this.expectedDownstreams.get(shareId) ?? new Map<string, number>();
      expected.set(message.downstreamId, Number(message.routeVersion || 0));
      this.expectedDownstreams.set(shareId, expected);
      const pendingKey = shareId + ':' + message.downstreamId;
      const pending = this.pendingRelayOffers.get(pendingKey);
      if (pending) {
        this.pendingRelayOffers.delete(pendingKey);
        await this.handleOffer(pending);
      }
      return;
    }

    if (message.action === 'detach' && message.to === this.currentPlayerId && message.downstreamId) {
      this.expectedDownstreams.get(shareId)?.delete(message.downstreamId);
      const key = shareId + '-out-' + message.downstreamId;
      this.stopOutboundHealthHeartbeat(key);
      this.peerConnections.get(key)?.close();
      this.peerConnections.delete(key);
    }
  }

  private markRelayFailure(shareId: string, viewerId: string, upstreamId?: string, reason = 'connection'): void {
    const now = Date.now();
    const relayMap = this.unhealthyRelays.get(shareId) ?? new Map<string, { until: number; failures: number }>();
    const previous = relayMap.get(viewerId);
    const failures = (previous?.failures ?? 0) + 1;
    relayMap.set(viewerId, { failures, until: now + Math.min(60_000, 4_000 * (2 ** Math.min(failures - 1, 4))) });
    this.unhealthyRelays.set(shareId, relayMap);

    if (upstreamId) {
      if (upstreamId !== this.currentPlayerId) {
        const upstreamHealth = relayMap.get(upstreamId);
        const upstreamFailures = (upstreamHealth?.failures ?? 0) + 1;
        relayMap.set(upstreamId, { failures: upstreamFailures, until: now + Math.min(60_000, 4_000 * (2 ** Math.min(upstreamFailures - 1, 4))) });
      }
      const edgeMap = this.unhealthyRelayEdges.get(shareId) ?? new Map<string, { until: number; failures: number }>();
      const edgeId = upstreamId + '>' + viewerId;
      const previousEdge = edgeMap.get(edgeId);
      const edgeFailures = (previousEdge?.failures ?? 0) + 1;
      edgeMap.set(edgeId, { failures: edgeFailures, until: now + Math.min(60_000, 4_000 * (2 ** Math.min(edgeFailures - 1, 4))) });
      this.unhealthyRelayEdges.set(shareId, edgeMap);
      console.warn('[ScreenShareService] 中继边暂时隔离:', { shareId, edgeId, reason, failures: edgeFailures });
    }
    this.scheduleRelayRecovery(shareId);
  }

  private scheduleRelayRecovery(shareId: string): void {
    const previous = this.relayRecoveryTimers.get(shareId);
    if (previous) window.clearTimeout(previous);
    const expiries = [
      ...Array.from(this.unhealthyRelays.get(shareId)?.values() ?? []).map((entry) => entry.until),
      ...Array.from(this.unhealthyRelayEdges.get(shareId)?.values() ?? []).map((entry) => entry.until),
    ].filter((until) => until > Date.now());
    if (expiries.length === 0) return;
    const timer = window.setTimeout(() => {
      this.relayRecoveryTimers.delete(shareId);
      this.rebuildRelayRoutes(shareId);
      this.scheduleRelayRecovery(shareId);
    }, Math.max(250, Math.min(...expiries) - Date.now() + 100));
    this.relayRecoveryTimers.set(shareId, timer);
  }

  private isRelayAvailable(shareId: string, relayId: string): boolean {
    const entry = this.unhealthyRelays.get(shareId)?.get(relayId);
    if (!entry) return true;
    if (entry.until <= Date.now()) {
      this.unhealthyRelays.get(shareId)?.delete(relayId);
      return true;
    }
    return false;
  }

  private isRelayEdgeAvailable(shareId: string, upstreamId: string, viewerId: string): boolean {
    const edgeId = upstreamId + '>' + viewerId;
    const entry = this.unhealthyRelayEdges.get(shareId)?.get(edgeId);
    if (!entry) return true;
    if (entry.until <= Date.now()) {
      this.unhealthyRelayEdges.get(shareId)?.delete(edgeId);
      return true;
    }
    return false;
  }

  private rebuildRelayRoutes(shareId: string): void {
    const share = this.activeShares.get(shareId);
    if (!share || share.playerId !== this.currentPlayerId) return;
    const order = this.viewerOrder.get(shareId) ?? [];
    const ready = this.readyViewers.get(shareId) ?? new Set<string>();
    const assigned = this.assignedUpstreams.get(shareId) ?? new Map<string, string>();
    const assignedVersions = this.assignedRouteVersions.get(shareId) ?? new Map<string, number>();
    const version = (this.routeVersions.get(shareId) ?? 0) + 1;
    this.routeVersions.set(shareId, version);

    // Keep topology selection pure and covered by regression tests. The owner
    // normally serves two viewers; ready viewers serve at most one child each.
    const unavailableRelayIds = new Set(
      order.filter((viewerId) => !this.isRelayAvailable(shareId, viewerId)),
    );
    const unavailableEdges = new Set<string>();
    for (const upstreamId of [this.currentPlayerId, ...order]) {
      for (const viewerId of order) {
        if (!this.isRelayEdgeAvailable(shareId, upstreamId, viewerId)) {
          unavailableEdges.add(`${upstreamId}>${viewerId}`);
        }
      }
    }
    const parentByViewer = buildRelayTopology({
      ownerId: this.currentPlayerId,
      viewerOrder: order,
      readyViewerIds: ready,
      unavailableRelayIds,
      unavailableEdges,
    });

    for (const viewerId of order) {
      const upstream = parentByViewer.get(viewerId)!;
      const oldUpstream = assigned.get(viewerId);
      const routeChanged = oldUpstream !== upstream || !this.isRelayEdgeAvailable(shareId, upstream, viewerId);
      if (!routeChanged) continue;
      if (oldUpstream && oldUpstream !== upstream) {
        const pending = this.pendingDetachUpstreams.get(shareId) ?? new Map<string, string>();
        pending.set(viewerId, oldUpstream);
        this.pendingDetachUpstreams.set(shareId, pending);
      }
      if (upstream === this.currentPlayerId) {
        const expected = this.expectedDownstreams.get(shareId) ?? new Map<string, number>();
        expected.set(viewerId, version);
        this.expectedDownstreams.set(shareId, expected);
      } else {
        this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'child', from: this.currentPlayerId, to: upstream, shareId, downstreamId: viewerId, routeVersion: version });
      }
      this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'route', from: this.currentPlayerId, to: viewerId, shareId, upstreamId: upstream, routeVersion: version });
      assigned.set(viewerId, upstream);
      assignedVersions.set(viewerId, version);
      ready.delete(viewerId);
    }
    for (const [viewerId, oldUpstream] of Array.from(assigned.entries())) {
      if (order.includes(viewerId)) continue;
      if (oldUpstream === this.currentPlayerId) {
        this.expectedDownstreams.get(shareId)?.delete(viewerId);
        const key = shareId + '-out-' + viewerId;
        this.peerConnections.get(key)?.close();
        this.peerConnections.delete(key);
      } else {
        this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'detach', from: this.currentPlayerId, to: oldUpstream, shareId, downstreamId: viewerId, routeVersion: version });
      }
      assigned.delete(viewerId);
      assignedVersions.delete(viewerId);
    }
    this.assignedUpstreams.set(shareId, assigned);
    this.assignedRouteVersions.set(shareId, assignedVersions);
    share.viewerCount = order.length;
    share.viewerId = order[0];
    share.viewerName = order[0] ? this.viewerNames.get(shareId)?.get(order[0]) : undefined;
    this.activeShares.set(shareId, share);
    this.broadcastShareUpdate(share);
  }

  private async connectRelayUpstream(shareId: string, upstreamId: string, routeVersion: number): Promise<void> {
    // A new owner-issued route supersedes a temporary direct fallback.
    this.directViewFallbacks.delete(shareId);
    const currentUpstream = this.viewingUpstreams.get(shareId);
    const currentPc = currentUpstream ? this.peerConnections.get(shareId + '-in-' + currentUpstream) : undefined;
    if (currentUpstream === upstreamId && currentPc?.connectionState === 'connected' && this.viewingRouteVersions.get(shareId) === routeVersion) {
      const ownerId = this.activeShares.get(shareId)?.playerId;
      if (ownerId) this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'ready', from: this.currentPlayerId, to: ownerId, shareId, routeVersion });
      return;
    }
    const previousHealthTimer = this.viewingHealthTimers.get(shareId);
    if (previousHealthTimer) window.clearInterval(previousHealthTimer);
    this.viewingHealthTimers.delete(shareId);
    this.viewingRouteVersions.set(shareId, routeVersion);

    const pc = new RTCPeerConnection({
      iceServers: [], iceTransportPolicy: 'all', bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require',
    });
    const key = shareId + '-in-' + upstreamId;
    const stalePc = this.peerConnections.get(key);
    if (stalePc) stalePc.close();
    this.peerConnections.set(key, pc);
    pc.addTransceiver('video', { direction: 'recvonly' });

    let failureTimer: number | undefined;
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendWebSocketMessage({
        type: 'screen-share-ice-candidate', from: this.currentPlayerId, to: upstreamId, shareId,
        connectionRole: 'out',
        routeVersion,
        candidate: event.candidate.toJSON(),
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && failureTimer) {
        window.clearTimeout(failureTimer);
        failureTimer = undefined;
      } else if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && !failureTimer) {
        failureTimer = window.setTimeout(() => {
          if (pc.connectionState !== 'connected' && this.viewingRouteVersions.get(shareId) === routeVersion) {
            const ownerId = this.activeShares.get(shareId)?.playerId;
            if (ownerId) this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'failure', from: this.currentPlayerId, to: ownerId, shareId, upstreamId, routeVersion, reason: 'connection' });
          }
        }, pc.connectionState === 'failed' ? 0 : 3500);
      }
    };
    pc.ontrack = (event) => {
      if (this.viewingRouteVersions.get(shareId) !== routeVersion) {
        pc.close();
        if (this.peerConnections.get(key) === pc) this.peerConnections.delete(key);
        return;
      }
      const track = event.track;
      let stableStream = this.remoteStreams.get(shareId);
      if (!stableStream) {
        stableStream = new MediaStream();
        this.remoteStreams.set(shareId, stableStream);
      }

      let mediaActivated = false;
      const activateMedia = () => {
        if (mediaActivated || this.directViewFallbacks.has(shareId)) return;
        if (this.viewingRouteVersions.get(shareId) !== routeVersion || track.readyState !== 'live') return;
        mediaActivated = true;
        stableStream.getVideoTracks().forEach((oldTrack) => stableStream!.removeTrack(oldTrack));
        stableStream.addTrack(track);

        // Only forward a verified track. Keeping the old track until this point
        // prevents a failed reroute from replacing a working picture with black.
        this.peerConnections.forEach((downstreamPc, connectionKey) => {
          if (!connectionKey.startsWith(shareId + '-out-')) return;
          downstreamPc.getSenders().filter((sender) => sender.track?.kind === 'video').forEach((sender) => {
            void sender.replaceTrack(track);
          });
        });

        this.viewingUpstreams.set(shareId, upstreamId);
        if (currentUpstream && currentUpstream !== upstreamId) {
          const oldKey = shareId + '-in-' + currentUpstream;
          this.peerConnections.get(oldKey)?.close();
          this.peerConnections.delete(oldKey);
        }
        for (const [legacyKey, legacyPc] of this.peerConnections.entries()) {
          if (!legacyKey.startsWith(shareId + '-viewer-')) continue;
          legacyPc.close();
          this.peerConnections.delete(legacyKey);
        }
        const pending = this.pendingViewRequests.get(shareId);
        if (pending) {
          window.clearTimeout(pending.timer);
          this.pendingViewRequests.delete(shareId);
          pending.resolve(stableStream);
        }
        const ownerId = this.activeShares.get(shareId)?.playerId;
        if (ownerId) this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'ready', from: this.currentPlayerId, to: ownerId, shareId, routeVersion });
        this.startViewingHealthMonitor(shareId, pc, track, upstreamId, routeVersion);

        const expected = this.expectedDownstreams.get(shareId) ?? new Map<string, number>();
        for (const downstreamId of expected.keys()) {
          const pendingKey = shareId + ':' + downstreamId;
          const pendingOffer = this.pendingRelayOffers.get(pendingKey);
          if (pendingOffer) {
            this.pendingRelayOffers.delete(pendingKey);
            void this.handleOffer(pendingOffer);
          }
        }
      };
      void this.waitForDecodedVideoFrame(pc, track, 4500).then(activateMedia).catch(() => {
        if (this.viewingRouteVersions.get(shareId) !== routeVersion || this.directViewFallbacks.has(shareId)) return;
        const ownerId = this.activeShares.get(shareId)?.playerId;
        if (ownerId) {
          this.sendWebSocketMessage({
            type: 'screen-share-relay', action: 'failure', from: this.currentPlayerId,
            to: ownerId, shareId, upstreamId, routeVersion, reason: 'no-frame',
          });
        }
      });
    };

    const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);
    this.sendWebSocketMessage({
      type: 'screen-share-offer', from: this.currentPlayerId, to: upstreamId, shareId,
      playerName: this.currentPlayerName, routeVersion, offer: { type: offer.type, sdp: offer.sdp! },
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

  private startOutboundHealthHeartbeat(shareId: string, downstreamId: string, pc: RTCPeerConnection, connectionKey: string, routeVersion?: number): void {
    this.stopOutboundHealthHeartbeat(connectionKey);
    let previousSourceSequence = -1;
    let previousSentSequence = -1;
    const sendHealth = () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') return;
      void pc.getStats().then((stats) => {
        let sentSequence = 0;
        let limited = false;
        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video' && !report.isRemote) {
            sentSequence = Math.max(sentSequence, Number(report.framesSent ?? report.packetsSent ?? report.framesEncoded ?? 0));
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
            const available = Number(report.availableOutgoingBitrate ?? 0);
            if (available > 0 && available < 300_000) limited = true;
          }
        });
        // Relays advertise how many source frames they have actually received,
        // independently of what their own encoder managed to send downstream.
        // This distinguishes a static desktop from a saturated relay uplink.
        const sourceSequence = this.sourceFrameSequences.get(shareId) ?? sentSequence;
        if (previousSourceSequence >= 0 && sourceSequence > previousSourceSequence && sentSequence <= previousSentSequence) {
          limited = true;
        }
        previousSourceSequence = Math.max(previousSourceSequence, sourceSequence);
        previousSentSequence = Math.max(previousSentSequence, sentSequence);
        this.sendWebSocketMessage({
          type: 'screen-share-relay', action: 'health', from: this.currentPlayerId, to: downstreamId,
          shareId, routeVersion, sequence: sourceSequence, sourceSequence, sentSequence, limited,
        });
      }).catch(() => { /* connection state cleanup handles closure */ });
    };
    sendHealth();
    this.outboundHealthTimers.set(connectionKey, window.setInterval(sendHealth, 2000));
  }

  private stopOutboundHealthHeartbeat(connectionKey: string): void {
    const timer = this.outboundHealthTimers.get(connectionKey);
    if (timer) window.clearInterval(timer);
    this.outboundHealthTimers.delete(connectionKey);
  }

  /** Wait until Chromium reports a decoded inbound video frame, not merely an attached track. */
  private async waitForDecodedVideoFrame(pc: RTCPeerConnection, track: MediaStreamTrack, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (track.readyState !== 'live') throw new Error('视频轨道已结束');
      const stats = await pc.getStats(track);
      let decoded = false;
      stats.forEach((report) => {
        if (report.type !== 'inbound-rtp' || report.kind !== 'video' || report.isRemote) return;
        const framesDecoded = Number(report.framesDecoded ?? 0);
        const framesReceived = Number(report.framesReceived ?? 0);
        if (framesDecoded > 0 || (!('framesDecoded' in report) && framesReceived > 0)) decoded = true;
      });
      if (decoded) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
    }
    throw new Error('等待首个视频帧超时');
  }

  private startViewingHealthMonitor(shareId: string, pc: RTCPeerConnection, track: MediaStreamTrack, upstreamId: string, routeVersion?: number): void {
    const previous = this.viewingHealthTimers.get(shareId);
    if (previous) window.clearInterval(previous);
    let lastDecoded = -1;
    let lastAdvertisedSource = -1;
    let lastSourceDecoded = -1;
    let badChecks = 0;
    const monitorStartedAt = Date.now();
    const timer = window.setInterval(() => {
      void pc.getStats(track).then((stats) => {
        if (this.viewingUpstreams.get(shareId) !== upstreamId || this.viewingRouteVersions.get(shareId) !== routeVersion || track.readyState !== 'live') return;
        let decoded = -1;
        stats.forEach((report) => {
          if (report.type !== 'inbound-rtp' || report.kind !== 'video' || report.isRemote) return;
          decoded = Math.max(decoded, Number(report.framesDecoded ?? report.framesReceived ?? 0));
        });
        if (decoded >= 0) {
          if (lastSourceDecoded >= 0 && decoded > lastSourceDecoded) {
            const currentSourceSequence = this.sourceFrameSequences.get(shareId) ?? 0;
            this.sourceFrameSequences.set(shareId, currentSourceSequence + decoded - lastSourceDecoded);
          }
          lastSourceDecoded = decoded;
        }
        const health = this.upstreamHealth.get(shareId);
        const matchingHealth = health && health.upstreamId === upstreamId && (isNullish(routeVersion) || isNullish(health.routeVersion) || health.routeVersion === routeVersion);
        if (decoded < 0 || decoded > lastDecoded) {
          lastDecoded = decoded;
          badChecks = 0;
        } else if (matchingHealth) {
          const heartbeatFresh = Date.now() - health.receivedAt < 5500;
          const sourceAdvanced = health.sourceSequence > lastAdvertisedSource;
          if (heartbeatFresh && !sourceAdvanced) {
            // The upstream source is static, so an unchanged decoded frame is healthy.
            badChecks = 0;
          } else if (heartbeatFresh && sourceAdvanced) {
            badChecks += 1;
          } else if (Date.now() - health.receivedAt > 9000) {
            badChecks += 1;
          }
          lastAdvertisedSource = Math.max(lastAdvertisedSource, health.sourceSequence);
        } else if (!matchingHealth && !isNullish(routeVersion) && Date.now() - monitorStartedAt > 12_000) {
          badChecks += 1;
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          badChecks += 1;
        }
        if (badChecks >= 3) {
          window.clearInterval(timer);
          if (this.viewingHealthTimers.get(shareId) === timer) this.viewingHealthTimers.delete(shareId);
          const ownerId = this.activeShares.get(shareId)?.playerId;
          if (ownerId) {
            this.sendWebSocketMessage({ type: 'screen-share-relay', action: 'failure', from: this.currentPlayerId, to: ownerId, shareId, upstreamId, routeVersion, reason: matchingHealth && health?.limited ? 'bandwidth' : 'stalled' });
          }
        }
      }).catch(() => { /* 连接关闭时由 connectionstate 处理 */ });
    }, 2000);
    this.viewingHealthTimers.set(shareId, timer);
  }

  /**
   * 处理收到的Offer
   */
  async handleOffer(offer: ScreenShareOffer): Promise<void> {
    try {
      console.log('📨 [ScreenShareService] 收到查看请求:', offer);
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

      const isOwner = share.playerId === this.currentPlayerId;
      const expectedVersion = this.expectedDownstreams.get(offer.shareId)?.get(offer.playerId);
      const isLegacyDirectOffer = isOwner && isNullish(offer.routeVersion);
      if (!isLegacyDirectOffer && (isNullish(expectedVersion) || expectedVersion !== Number(offer.routeVersion || 0))) {
        this.pendingRelayOffers.set(offer.shareId + ':' + offer.playerId, offer);
        return;
      }
      if (isLegacyDirectOffer && share.requirePassword && offer.password !== share.password) {
        this.sendWebSocketMessage({ type: 'screen-share-error', from: this.currentPlayerId, to: offer.playerId, shareId: offer.shareId, error: '密码错误' });
        return;
      }

      const sourceStream = isOwner ? this.localStream : this.remoteStreams.get(offer.shareId);
      if (!sourceStream || sourceStream.getVideoTracks().length === 0) {
        this.pendingRelayOffers.set(offer.shareId + ':' + offer.playerId, offer);
        return;
      }

      // 创建PeerConnection
      // 【稳定性修复】同一虚拟局域网内 host 候选直连，移除被墙的 Google STUN
      const pc = new RTCPeerConnection({
        iceServers: [],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      const connectionKey = `${offer.shareId}-out-${offer.playerId}`;
      this.stopOutboundHealthHeartbeat(connectionKey);
      this.peerConnections.get(connectionKey)?.close();
      this.peerConnections.set(connectionKey, pc);

      // 必须在 setLocalDescription 前监听，否则首批 host ICE 候选可能已经生成并被漏掉。
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendWebSocketMessage({
            type: 'screen-share-ice-candidate',
            from: this.currentPlayerId,
            to: offer.playerId,
            shareId: offer.shareId,
            connectionRole: 'in',
            routeVersion: offer.routeVersion,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // 【修复】监听连接断开，但不立即清除查看者标记（避免误判）
      // 只有在真正关闭时才清除标记
      pc.onconnectionstatechange = () => {
        console.log(`🔗 [ScreenShareService] 连接状态变化: ${pc.connectionState}`);
        
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          this.stopOutboundHealthHeartbeat(connectionKey);
          const failedPc = this.peerConnections.get(connectionKey);
          if (failedPc === pc) {
            try { failedPc.close(); } catch { /* 忽略 */ }
            this.peerConnections.delete(connectionKey);
          }
        } else if (pc.connectionState === 'disconnected') {
          console.warn('⚠️ [ScreenShareService] 连接断开，暂时保留查看者标记（可能会重连）');
        }
      };

      sourceStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, sourceStream);

        if (track.kind === 'video') {
          const params = sender.getParameters();
          // 【优化】设置高码率和稳定帧率，确保画质清晰流畅
          params.degradationPreference = 'balanced';
          params.encodings = [{ 
            maxBitrate: 4_000_000,
            maxFramerate: 30,
            scaleResolutionDownBy: 1.0, // 不降低分辨率
            priority: 'high', // 高优先级
          }];
          sender.setParameters(params).catch((error) => {
            console.warn('⚠️ [ScreenShareService] 设置发送参数失败，继续默认参数', error);
          });
        }
      });

      // 设置远程描述
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: offer.sdp,
      });
      await this.flushPendingIce(connectionKey, pc);

      // 创建Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.startOutboundHealthHeartbeat(offer.shareId, offer.playerId, pc, connectionKey, offer.routeVersion);

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
        routeVersion: offer.routeVersion,
      });

      console.log('✅ [ScreenShareService] 已响应查看请求');
    } catch (error) {
      console.error('❌ [ScreenShareService] 处理Offer失败:', error);
    }
  }

  /**
   * 处理收到的Answer
   */
  async handleAnswer(answer: ScreenShareAnswer, upstreamPlayerId: string): Promise<void> {
    try {
      console.log('📨 [ScreenShareService] 收到Answer');

      const inboundKey = `${answer.shareId}-in-${upstreamPlayerId}`;
      const legacyKey = Array.from(this.peerConnections.keys()).find((key) => key.startsWith(`${answer.shareId}-viewer-`));
      const connectionKey = isNullish(answer.routeVersion) && legacyKey ? legacyKey : inboundKey;
      const foundPc = this.peerConnections.get(connectionKey) ?? null;

      if (!foundPc) {
        console.error('❌ [ScreenShareService] 找不到对应的PeerConnection');
        return;
      }
      if (!isNullish(answer.routeVersion) && this.viewingRouteVersions.get(answer.shareId) !== answer.routeVersion) return;

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
      await this.flushPendingIce(connectionKey, foundPc);

      console.log('✅ [ScreenShareService] Answer已设置');
    } catch (error) {
      console.error('❌ [ScreenShareService] 处理Answer失败:', error);
      console.error('错误详情:', error);
    }
  }

  /**
   * 处理ICE候选
   */
  async handleIceCandidate(shareId: string, candidate: RTCIceCandidateInit, remotePlayerId: string, connectionRole?: 'in' | 'out', routeVersion?: number): Promise<void> {
    try {
      const outboundKey = `${shareId}-out-${remotePlayerId}`;
      const inboundKey = `${shareId}-in-${remotePlayerId}`;
      const legacyViewerKey = Array.from(this.peerConnections.keys()).find((key) => key.startsWith(`${shareId}-viewer-`));
      const connectionKey = connectionRole === 'in'
        ? isNullish(routeVersion) && legacyViewerKey
          ? legacyViewerKey
          : inboundKey
        : connectionRole === 'out'
          ? outboundKey
          : this.peerConnections.has(outboundKey)
            ? outboundKey
            : this.peerConnections.has(inboundKey)
              ? inboundKey
              : legacyViewerKey ?? inboundKey;
      if (!isNullish(routeVersion)) {
        if (connectionKey === inboundKey && this.viewingRouteVersions.get(shareId) !== routeVersion) return;
        if (connectionKey === outboundKey && this.expectedDownstreams.get(shareId)?.get(remotePlayerId) !== routeVersion) return;
      }
      const pc = this.peerConnections.get(connectionKey);
      if (!pc || !pc.remoteDescription) {
        const pending = this.pendingIceCandidates.get(connectionKey) ?? [];
        pending.push(candidate);
        this.pendingIceCandidates.set(connectionKey, pending);
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('✅ [ScreenShareService] ICE候选已添加');
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
    if (!share) return;
    const outKey = `${shareId}-out-${viewerId}`;
    this.stopOutboundHealthHeartbeat(outKey);
    this.peerConnections.get(outKey)?.close();
    this.peerConnections.delete(outKey);
    this.expectedDownstreams.get(shareId)?.delete(viewerId);

    if (share.playerId === this.currentPlayerId) {
      const order = this.viewerOrder.get(shareId) ?? [];
      const nextOrder = order.filter((id) => id !== viewerId);
      this.viewerOrder.set(shareId, nextOrder);
      this.viewerNames.get(shareId)?.delete(viewerId);
      this.readyViewers.get(shareId)?.delete(viewerId);
      this.assignedUpstreams.get(shareId)?.delete(viewerId);
      this.assignedRouteVersions.get(shareId)?.delete(viewerId);
      this.rebuildRelayRoutes(shareId);
    }
  }

  handlePlayerLeft(playerId: string): void {
    for (const share of Array.from(this.activeShares.values())) {
      if (share.playerId === playerId) {
        if (this.viewingUpstreams.has(share.id)) this.stopViewingScreen(share.id);
        this.activeShares.delete(share.id);
        window.dispatchEvent(new CustomEvent('screen-share-stop', { detail: { shareId: share.id } }));
        continue;
      }

      if (this.viewingUpstreams.get(share.id) === playerId) {
        this.sendWebSocketMessage({
          type: 'screen-share-relay', action: 'failure', from: this.currentPlayerId, to: share.playerId,
          shareId: share.id, upstreamId: playerId,
        });
      }
      if (share.playerId === this.currentPlayerId || this.expectedDownstreams.get(share.id)?.has(playerId)) {
        this.handleViewerLeft(share.id, playerId);
      }
    }
  }

  /**
   * 处理共享状态更新
   */
  handleShareUpdate(shareId: string, viewerId?: string, viewerName?: string, viewerCount?: number): void {
    const share = this.activeShares.get(shareId);
    if (!share) return;
    share.viewerId = viewerId;
    share.viewerName = viewerName;
    share.viewerCount = viewerCount ?? (viewerId ? 1 : 0);
    this.activeShares.set(shareId, share);
  }

  private async flushPendingIce(connectionKey: string, pc: RTCPeerConnection): Promise<void> {
    const candidates = this.pendingIceCandidates.get(connectionKey) ?? [];
    this.pendingIceCandidates.delete(connectionKey);
    for (const candidate of candidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    console.log('🧹 [ScreenShareService] 清理资源...');

    // 停止所有共享
    this.getMyActiveShares().forEach((share) => this.stopSharing(share.id));

    // 关闭所有PeerConnection
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.outboundHealthTimers.forEach((timer) => window.clearInterval(timer));
    this.outboundHealthTimers.clear();
    this.viewingHealthTimers.forEach((timer) => window.clearInterval(timer));
    this.viewingHealthTimers.clear();

    this.activeShares.clear();
    this.remoteStreams.clear();
    this.upstreamHealth.clear();
    this.sourceFrameSequences.clear();
    this.viewerOrder.clear();
    this.viewerNames.clear();
    this.readyViewers.clear();
    this.assignedUpstreams.clear();
    this.assignedRouteVersions.clear();
    this.expectedDownstreams.clear();
    this.routeVersions.clear();
    this.unhealthyRelays.clear();
    this.unhealthyRelayEdges.clear();
    this.pendingDetachUpstreams.clear();
    this.relayRecoveryTimers.forEach((timer) => window.clearTimeout(timer));
    this.relayRecoveryTimers.clear();
    this.pendingViewRequests.forEach((request) => window.clearTimeout(request.timer));
    this.pendingViewRequests.clear();
    this.currentPasswords.clear();
    this.viewingUpstreams.clear();
    this.viewingRouteVersions.clear();
    this.pendingRelayOffers.clear();
    this.pendingIceCandidates.clear();
    this.relayProtocolConfirmed.clear();
    this.ws = null;

    console.log('✅ [ScreenShareService] 资源已清理');
  }
}

export const screenShareService = new ScreenShareService();
