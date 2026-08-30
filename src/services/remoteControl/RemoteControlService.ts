/**
 * 远程控制服务（电脑 ⇄ 电脑）
 * - 控制端(controller)：接收被控端屏幕视频，捕获本地鼠标/键盘并通过数据通道发送
 * - 被控端(controlled)：采集本机屏幕作为视频源，接收输入事件并经 Rust SendInput 注入
 *
 * 信令复用现有 WebSocket（信令服务器对未知类型按 from/to 通用转发，无需改服务端）。
 * 视频与输入走 WebRTC：视频 track（被控端→控制端），输入走可靠 DataChannel（控制端→被控端）。
 */

import { invoke } from '@tauri-apps/api/core';
import { isSafeIdentifier, isSafeSessionId, sanitizeUntrustedText } from '../../security/trustBoundary';

export type RemoteInputEvent =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'down'; button: number; x: number; y: number }
  | { kind: 'up'; button: number; x: number; y: number }
  | { kind: 'wheel'; dx: number; dy: number }
  | { kind: 'keydown'; code: number; extended?: boolean }
  | { kind: 'keyup'; code: number; extended?: boolean };

type Role = 'idle' | 'controller' | 'controlled';

type PendingControlRequest = {
  sessionId: string;
  from: string;
  fromName: string;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

class RemoteControlService {
  private playerId = '';
  private playerName = '';
  private ws: WebSocket | null = null;

  private role: Role = 'idle';
  private sessionId = '';
  private peerId = '';        // 对端 playerId
  private peerName = '';
  private pc: RTCPeerConnection | null = null;
  private inputChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private pendingInput: RemoteInputEvent[] = [];
  private flushTimer: number | null = null;
  private pendingIce: Array<{ sessionId: string; peerId: string; candidate: RTCIceCandidateInit }> = [];
  private requestTimer: number | null = null;
  private pendingRequest: PendingControlRequest | null = null;

  initialize(playerId: string, playerName: string, ws: WebSocket): void {
    this.playerId = playerId;
    this.playerName = playerName;
    this.ws = ws;
  }

  isActive(): boolean {
    return this.role !== 'idle';
  }

  getRole(): Role {
    return this.role;
  }

  getPeerName(): string {
    return this.peerName;
  }

  /** Whether a signaling message belongs to the currently negotiated peer session. */
  isSessionForPeer(sessionId: string, peerId: string): boolean {
    return this.role !== 'idle' && this.sessionId === sessionId && this.peerId === peerId;
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private createSessionId(): string {
    if (!globalThis.crypto?.randomUUID) {
      throw new Error('当前运行环境不支持安全的远程控制会话 ID');
    }
    return `rc-${this.playerId}-${globalThis.crypto.randomUUID()}`;
  }

  private isCurrentPeerMessage(sessionId: string, from: string, to: string): boolean {
    return this.isCurrentPeerSession(sessionId, from) && to === this.playerId;
  }

  private isCurrentPeerSession(sessionId: string, peerId: string, pc?: RTCPeerConnection | null): boolean {
    return this.role !== 'idle'
      && sessionId === this.sessionId
      && peerId === this.peerId
      && (pc === undefined || this.pc === pc);
  }

  // ==================== 控制端：发起请求 ====================
  requestControl(targetId: string, targetName: string): void {
    if (this.role !== 'idle') {
      throw new Error('已有进行中的远程控制会话');
    }
    if (!isSafeIdentifier(targetId) || targetId === this.playerId) {
      throw new Error('远程控制目标无效');
    }
    const safeTargetName = sanitizeUntrustedText(targetName, 64).trim();
    if (!safeTargetName) throw new Error('远程控制目标名称无效');
    const nextSessionId = this.createSessionId();
    this.role = 'controller';
    this.sessionId = nextSessionId;
    this.peerId = targetId;
    this.peerName = safeTargetName;
    this.send({
      type: 'remote-control-request',
      from: this.playerId,
      to: targetId,
      sessionId: this.sessionId,
      fromName: this.playerName,
    });
    // 90 秒内对方未接受则超时（首次需在手机上授予无障碍与录屏权限，留足时间）
    this.requestTimer = window.setTimeout(() => {
      if (this.role === 'controller' && this.sessionId === nextSessionId && !this.pc) {
        this.send({
          type: 'remote-control-stop',
          from: this.playerId,
          to: targetId,
          sessionId: nextSessionId,
        });
        this.finishReject('timeout');
      }
    }, 90000);
  }

  // ==================== 被控端：接受/拒绝 ====================
  async acceptControl(sessionId: string, controllerId: string, controllerName: string): Promise<void> {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(controllerId) || controllerId === this.playerId) {
      throw new Error('远程控制会话无效');
    }
    const safeControllerName = sanitizeUntrustedText(controllerName, 64).trim();
    if (!safeControllerName) throw new Error('远程控制者名称无效');
    const pending = this.pendingRequest;
    if (!pending || pending.sessionId !== sessionId || pending.from !== controllerId || this.role !== 'idle') {
      throw new Error('远程控制请求已失效');
    }
    this.role = 'controlled';
    this.sessionId = sessionId;
    this.peerId = controllerId;
    this.peerName = safeControllerName;
    this.pendingRequest = null;
    try {
      // 在用户手势内采集屏幕（getDisplayMedia 需要用户激活）。
      // 先保存在局部变量，避免旧授权 Promise 覆盖后续新会话的 localStream。
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
        } as any,
        audio: false,
      });
      // 用户授权期间对端可能已经停止或会话被本地清理，不能把迟到的媒体流重新挂回旧会话。
      if (!this.isCurrentPeerMessage(sessionId, controllerId, this.playerId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.localStream = stream;
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        vt.contentHint = 'motion';
        vt.onended = () => {
          if (this.isCurrentPeerSession(sessionId, controllerId) && this.localStream === stream) this.stopControl();
        };
      }
      this.send({
        type: 'remote-control-accept',
        from: this.playerId,
        to: controllerId,
        sessionId,
      });
      // 等待控制端发来的 offer（在 handleOffer 中应答）
    } catch (error) {
      // Permission denial and capture setup errors must not leave the service stuck in controlled.
      if (!this.isCurrentPeerMessage(sessionId, controllerId, this.playerId)) return;
      try {
        this.send({
          type: 'remote-control-reject',
          from: this.playerId,
          to: controllerId,
          sessionId,
          reason: 'capture-failed',
        });
      } catch { /* ignore signaling teardown races */ }
      this.cleanup();
      throw error;
    }
  }

  rejectControl(sessionId: string, controllerId: string): void {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(controllerId) || controllerId === this.playerId) return;
    const pending = this.pendingRequest;
    if (!pending || pending.sessionId !== sessionId || pending.from !== controllerId) return;
    this.send({
      type: 'remote-control-reject',
      from: this.playerId,
      to: controllerId,
      sessionId,
      reason: 'rejected',
    });
    this.pendingRequest = null;
  }

  // ==================== 通用：停止 ====================
  stopControl(notifyPeer = true): void {
    if (notifyPeer && this.peerId) {
      this.send({
        type: 'remote-control-stop',
        from: this.playerId,
        to: this.peerId,
        sessionId: this.sessionId,
      });
    }
    this.cleanup();
    window.dispatchEvent(new CustomEvent('rc-ended', { detail: {} }));
  }

  private cleanup(): void {
    if (this.requestTimer !== null) {
      clearTimeout(this.requestTimer);
      this.requestTimer = null;
    }
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingInput = [];
    this.pendingIce = [];
    this.pendingRequest = null;
    if (this.inputChannel) {
      try { this.inputChannel.onmessage = null; this.inputChannel.close(); } catch { /* ignore */ }
      this.inputChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.ondatachannel = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch { /* ignore */ }
      this.pc = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.role = 'idle';
    this.sessionId = '';
    this.peerId = '';
    this.peerName = '';
  }

  // ==================== 信令处理（由 WebRTCClient 调用） ====================

  /** 被控端收到控制请求 */
  handleRequest(sessionId: string, from: string, fromName: string, to: string): void {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId) return;
    const safeFromName = sanitizeUntrustedText(fromName, 64).trim();
    if (!safeFromName) return;
    if (this.role !== 'idle') {
      // 忙：自动拒绝
      this.send({ type: 'remote-control-reject', from: this.playerId, to: from, sessionId, reason: 'busy' });
      return;
    }
    if (this.pendingRequest) {
      this.send({ type: 'remote-control-reject', from: this.playerId, to: from, sessionId, reason: 'busy' });
      return;
    }
    this.pendingRequest = { sessionId, from, fromName: safeFromName };
    window.dispatchEvent(new CustomEvent('rc-incoming-request', { detail: { sessionId, from, fromName: safeFromName } }));
  }

  /** 控制端收到被控端接受 -> 建立连接并发 offer */
  async handleAccept(sessionId: string, from: string, to: string): Promise<void> {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId) return;
    if (this.role !== 'controller' || !this.isCurrentPeerMessage(sessionId, from, to) || this.pc) return;
    const expectedSessionId = sessionId;
    const expectedPeerId = from;
    if (this.requestTimer !== null) { clearTimeout(this.requestTimer); this.requestTimer = null; }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    const ch = pc.createDataChannel('rc-input', { ordered: true });
    this.inputChannel = ch;
    ch.onopen = () => this.startFlush(expectedSessionId, expectedPeerId, pc, ch);

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      if (this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc) && e.streams && e.streams[0]) {
        window.dispatchEvent(new CustomEvent('rc-stream', { detail: { stream: e.streams[0], peerName: this.peerName } }));
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendIce(expectedSessionId, expectedPeerId, pc, e.candidate);
    };
    pc.onconnectionstatechange = () => {
      if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.stopControl(false);
    };

    try {
      const offer = await pc.createOffer();
      if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) {
        pc.close();
        return;
      }
      await pc.setLocalDescription(offer);
      if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) {
        pc.close();
        return;
      }
      this.send({
        type: 'remote-control-offer',
        from: this.playerId, to: expectedPeerId, sessionId: expectedSessionId,
        offer: { type: offer.type, sdp: offer.sdp },
      });
    } catch (error) {
      if (this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) this.stopControl(false);
      throw error;
    }
  }

  /** 被控端收到 offer -> 加屏幕轨、建数据通道、应答 */
  async handleOffer(sessionId: string, from: string, to: string, sdp: string): Promise<void> {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId ||
        typeof sdp !== 'string' || sdp.length === 0 || sdp.length > 256 * 1024 ||
        this.role !== 'controlled' || !this.isCurrentPeerMessage(sessionId, from, to) || this.pc) return;
    const expectedSessionId = sessionId;
    const expectedPeerId = from;
    try {
      let stream = this.localStream;
      if (!stream) {
        // 兜底：理论上 acceptControl 已采集
        const capturedStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false } as any);
        if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId)) {
          capturedStream.getTracks().forEach((track) => track.stop());
          return;
        }
        this.localStream = capturedStream;
        stream = capturedStream;
      }
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream!));

      pc.ondatachannel = (e) => {
        if (e.channel.label === 'rc-input' && this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) {
          this.inputChannel = e.channel;
          e.channel.onmessage = (ev) => this.onInputMessage(ev.data, expectedSessionId, expectedPeerId, pc, e.channel);
        } else {
          e.channel.close();
        }
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) this.sendIce(expectedSessionId, expectedPeerId, pc, e.candidate);
      };
      pc.onconnectionstatechange = () => {
        if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.stopControl(false);
      };

      await pc.setRemoteDescription({ type: 'offer', sdp });
      if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) {
        pc.close();
        return;
      }
      await this.flushPendingIce(expectedSessionId, expectedPeerId, pc);
      const answer = await pc.createAnswer();
      if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) {
        pc.close();
        return;
      }
      await pc.setLocalDescription(answer);
      if (!this.isCurrentPeerSession(expectedSessionId, expectedPeerId, pc)) {
        pc.close();
        return;
      }
      this.send({
        type: 'remote-control-answer',
        from: this.playerId, to: expectedPeerId, sessionId: expectedSessionId,
        answer: { type: answer.type, sdp: answer.sdp },
      });
      window.dispatchEvent(new CustomEvent('rc-controlled-active', { detail: { peerName: this.peerName } }));
    } catch (error) {
      if (this.isCurrentPeerSession(expectedSessionId, expectedPeerId)) this.stopControl(false);
      throw error;
    }
  }

  /** 控制端收到 answer */
  async handleAnswer(sessionId: string, from: string, to: string, sdp: string): Promise<void> {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId ||
        typeof sdp !== 'string' || sdp.length === 0 || sdp.length > 256 * 1024 ||
        this.role !== 'controller' || !this.isCurrentPeerMessage(sessionId, from, to) || !this.pc) return;
    const pc = this.pc;
    if (pc.signalingState !== 'have-local-offer' || !this.isCurrentPeerSession(sessionId, from, pc)) return;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp });
      if (!this.isCurrentPeerSession(sessionId, from, pc)) return;
      await this.flushPendingIce(sessionId, from, pc);
    } catch (error) {
      if (this.isCurrentPeerSession(sessionId, from, pc)) this.stopControl(false);
      throw error;
    }
  }

  /** 双方：收到对端 ICE */
  async handleIce(sessionId: string, from: string, to: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId ||
        !candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length === 0 ||
        candidate.candidate.length > 16 * 1024 ||
        (candidate.sdpMLineIndex != null &&
          (typeof candidate.sdpMLineIndex !== 'number' || !Number.isSafeInteger(candidate.sdpMLineIndex) ||
            candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 256)) ||
        (candidate.sdpMid != null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 128)) ||
        !this.isCurrentPeerMessage(sessionId, from, to)) return;
    if (this.pendingIce.length >= 256) return;
    const pc = this.pc;
    if (!pc || !pc.remoteDescription) {
      this.pendingIce.push({ sessionId, peerId: from, candidate });
      return;
    }
    if (!this.isCurrentPeerSession(sessionId, from, pc)) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      if (this.isCurrentPeerSession(sessionId, from, pc)) console.warn('rc ice 失败', e);
    }
  }

  /** 控制端被拒绝 */
  private finishReject(reason: string): void {
    window.dispatchEvent(new CustomEvent('rc-rejected', { detail: { reason } }));
    this.cleanup();
  }

  handleReject(sessionId: string, from: string, to: string, reason: string): void {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId ||
        this.role !== 'controller' || !this.isCurrentPeerMessage(sessionId, from, to)) return;
    const safeReason = sanitizeUntrustedText(reason, 200).trim();
    this.finishReject(safeReason || 'rejected');
  }

  /** 对端停止 */
  handleStop(sessionId: string, from: string, to: string): void {
    if (!isSafeSessionId(sessionId) || !isSafeIdentifier(from) || from === this.playerId || to !== this.playerId) return;
    if (this.role === 'idle') {
      const pending = this.pendingRequest;
      if (pending && pending.sessionId === sessionId && pending.from === from && to === this.playerId) {
        this.pendingRequest = null;
        window.dispatchEvent(new CustomEvent('rc-ended', { detail: { reason: 'peer-stopped' } }));
      }
      return;
    }
    if (!this.isCurrentPeerMessage(sessionId, from, to)) return;
    this.cleanup();
    window.dispatchEvent(new CustomEvent('rc-ended', { detail: {} }));
  }

  private async flushPendingIce(sessionId: string, peerId: string, pc: RTCPeerConnection): Promise<void> {
    if (!pc.remoteDescription || !this.isCurrentPeerSession(sessionId, peerId, pc)) return;
    const list = this.pendingIce.filter((item) => item.sessionId === sessionId && item.peerId === peerId);
    this.pendingIce = this.pendingIce.filter((item) => item.sessionId !== sessionId || item.peerId !== peerId);
    for (const item of list) {
      if (!this.isCurrentPeerSession(sessionId, peerId, pc)) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(item.candidate));
      } catch (e) {
        if (this.isCurrentPeerSession(sessionId, peerId, pc)) console.warn('rc ice flush 失败', e);
      }
    }
  }

  private sendIce(sessionId: string, peerId: string, pc: RTCPeerConnection, candidate: RTCIceCandidate): void {
    if (!this.isCurrentPeerSession(sessionId, peerId, pc)) return;
    this.send({
      type: 'remote-control-ice',
      from: this.playerId, to: peerId, sessionId,
      candidate: { candidate: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid },
    });
  }

  // ==================== 输入（控制端 -> 被控端） ====================
  sendInput(ev: RemoteInputEvent): void {
    if (this.role !== 'controller') return;
    this.pendingInput.push(ev);
  }

  private startFlush(sessionId: string, peerId: string, pc: RTCPeerConnection, channel: RTCDataChannel): void {
    if (!this.isCurrentPeerSession(sessionId, peerId, pc) || this.inputChannel !== channel || this.flushTimer !== null) return;
    const timer = window.setInterval(() => {
      if (!this.isCurrentPeerSession(sessionId, peerId, pc) || this.inputChannel !== channel || channel.readyState !== 'open') {
        if (this.flushTimer === timer) {
          clearInterval(timer);
          this.flushTimer = null;
        }
        return;
      }
      if (this.pendingInput.length === 0) return;
      const batch = this.pendingInput;
      this.pendingInput = [];
      try { channel.send(JSON.stringify(batch)); } catch { /* ignore */ }
    }, 16);
    this.flushTimer = timer;
  }

  private async onInputMessage(
    data: any,
    sessionId: string,
    peerId: string,
    pc: RTCPeerConnection,
    channel: RTCDataChannel,
  ): Promise<void> {
    if (this.role !== 'controlled' || this.inputChannel !== channel || channel.readyState !== 'open' || !this.isCurrentPeerSession(sessionId, peerId, pc)) return;
    try {
      const events = JSON.parse(typeof data === 'string' ? data : String(data));
      if (Array.isArray(events) && events.length && this.isCurrentPeerSession(sessionId, peerId, pc)) {
        await invoke('remote_inject_input', { events });
      }
    } catch (e) {
      console.warn('注入输入失败', e);
    }
  }

  handlePeerLeft(peerId: string): void {
    let ended = false;
    if (this.pendingRequest?.from === peerId) {
      this.pendingRequest = null;
      ended = true;
    }
    if (this.role !== 'idle' && this.peerId === peerId) {
      this.cleanup();
      ended = true;
    }
    if (ended) window.dispatchEvent(new CustomEvent('rc-ended', { detail: { reason: 'peer-left' } }));
  }

  handleSignalingDisconnected(): void {
    if (this.role === 'idle' && !this.pendingRequest) return;
    this.cleanup();
    window.dispatchEvent(new CustomEvent('rc-ended', { detail: { reason: 'signaling-disconnected' } }));
  }
}

export const remoteControlService = new RemoteControlService();
