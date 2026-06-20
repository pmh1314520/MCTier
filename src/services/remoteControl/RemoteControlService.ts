/**
 * 远程控制服务（电脑 ⇄ 电脑）
 * - 控制端(controller)：接收被控端屏幕视频，捕获本地鼠标/键盘并通过数据通道发送
 * - 被控端(controlled)：采集本机屏幕作为视频源，接收输入事件并经 Rust SendInput 注入
 *
 * 信令复用现有 WebSocket（信令服务器对未知类型按 from/to 通用转发，无需改服务端）。
 * 视频与输入走 WebRTC：视频 track（被控端→控制端），输入走可靠 DataChannel（控制端→被控端）。
 */

import { invoke } from '@tauri-apps/api/core';

export type RemoteInputEvent =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'down'; button: number; x: number; y: number }
  | { kind: 'up'; button: number; x: number; y: number }
  | { kind: 'wheel'; dx: number; dy: number }
  | { kind: 'keydown'; code: number; extended?: boolean }
  | { kind: 'keyup'; code: number; extended?: boolean };

type Role = 'idle' | 'controller' | 'controlled';

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
  private pendingIce: RTCIceCandidateInit[] = [];
  private requestTimer: number | null = null;

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

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // ==================== 控制端：发起请求 ====================
  requestControl(targetId: string, targetName: string): void {
    if (this.role !== 'idle') {
      throw new Error('已有进行中的远程控制会话');
    }
    this.role = 'controller';
    this.sessionId = `rc-${this.playerId}-${Date.now()}`;
    this.peerId = targetId;
    this.peerName = targetName;
    this.send({
      type: 'remote-control-request',
      from: this.playerId,
      to: targetId,
      sessionId: this.sessionId,
      fromName: this.playerName,
    });
    // 25 秒内对方未接受则超时
    this.requestTimer = window.setTimeout(() => {
      if (this.role === 'controller' && !this.pc) {
        this.handleReject('timeout');
      }
    }, 25000);
  }

  // ==================== 被控端：接受/拒绝 ====================
  async acceptControl(sessionId: string, controllerId: string, controllerName: string): Promise<void> {
    this.role = 'controlled';
    this.sessionId = sessionId;
    this.peerId = controllerId;
    this.peerName = controllerName;
    // 在用户手势内采集屏幕（getDisplayMedia 需要用户激活）
    this.localStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 60 },
        width: { ideal: 1920, max: 3840 },
        height: { ideal: 1080, max: 2160 },
      } as any,
      audio: false,
    });
    const vt = this.localStream.getVideoTracks()[0];
    if (vt) {
      vt.contentHint = 'motion';
      vt.onended = () => this.stopControl();
    }
    this.send({
      type: 'remote-control-accept',
      from: this.playerId,
      to: controllerId,
      sessionId,
    });
    // 等待控制端发来的 offer（在 handleOffer 中应答）
  }

  rejectControl(sessionId: string, controllerId: string): void {
    this.send({
      type: 'remote-control-reject',
      from: this.playerId,
      to: controllerId,
      sessionId,
      reason: 'rejected',
    });
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
  handleRequest(sessionId: string, from: string, fromName: string): void {
    if (this.role !== 'idle') {
      // 忙：自动拒绝
      this.send({ type: 'remote-control-reject', from: this.playerId, to: from, sessionId, reason: 'busy' });
      return;
    }
    window.dispatchEvent(new CustomEvent('rc-incoming-request', { detail: { sessionId, from, fromName } }));
  }

  /** 控制端收到被控端接受 -> 建立连接并发 offer */
  async handleAccept(sessionId: string): Promise<void> {
    if (this.role !== 'controller' || sessionId !== this.sessionId) return;
    if (this.requestTimer !== null) { clearTimeout(this.requestTimer); this.requestTimer = null; }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    const ch = pc.createDataChannel('rc-input', { ordered: true });
    this.inputChannel = ch;
    ch.onopen = () => this.startFlush();

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) {
        window.dispatchEvent(new CustomEvent('rc-stream', { detail: { stream: e.streams[0], peerName: this.peerName } }));
      }
    };
    pc.onicecandidate = (e) => { if (e.candidate) this.sendIce(e.candidate); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.stopControl(false);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({
      type: 'remote-control-offer',
      from: this.playerId, to: this.peerId, sessionId,
      offer: { type: offer.type, sdp: offer.sdp },
    });
  }

  /** 被控端收到 offer -> 加屏幕轨、建数据通道、应答 */
  async handleOffer(sessionId: string, sdp: string): Promise<void> {
    if (this.role !== 'controlled' || sessionId !== this.sessionId) return;
    if (!this.localStream) {
      // 兜底：理论上 acceptControl 已采集
      this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false } as any);
    }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    pc.ondatachannel = (e) => {
      if (e.channel.label === 'rc-input') {
        this.inputChannel = e.channel;
        e.channel.onmessage = (ev) => this.onInputMessage(ev.data);
      }
    };
    pc.onicecandidate = (e) => { if (e.candidate) this.sendIce(e.candidate); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.stopControl(false);
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    await this.flushPendingIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({
      type: 'remote-control-answer',
      from: this.playerId, to: this.peerId, sessionId,
      answer: { type: answer.type, sdp: answer.sdp },
    });
    window.dispatchEvent(new CustomEvent('rc-controlled-active', { detail: { peerName: this.peerName } }));
  }

  /** 控制端收到 answer */
  async handleAnswer(sessionId: string, sdp: string): Promise<void> {
    if (this.role !== 'controller' || sessionId !== this.sessionId || !this.pc) return;
    if (this.pc.signalingState !== 'have-local-offer') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
    await this.flushPendingIce();
  }

  /** 双方：收到对端 ICE */
  async handleIce(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.pendingIce.push(candidate);
      return;
    }
    try { await this.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) { console.warn('rc ice 失败', e); }
  }

  /** 控制端被拒绝 */
  handleReject(reason: string): void {
    window.dispatchEvent(new CustomEvent('rc-rejected', { detail: { reason } }));
    this.cleanup();
  }

  /** 对端停止 */
  handleStop(): void {
    this.cleanup();
    window.dispatchEvent(new CustomEvent('rc-ended', { detail: {} }));
  }

  private async flushPendingIce(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) {
      try { await this.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('rc ice flush 失败', e); }
    }
  }

  private sendIce(candidate: RTCIceCandidate): void {
    this.send({
      type: 'remote-control-ice',
      from: this.playerId, to: this.peerId, sessionId: this.sessionId,
      candidate: { candidate: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid },
    });
  }

  // ==================== 输入（控制端 -> 被控端） ====================
  sendInput(ev: RemoteInputEvent): void {
    if (this.role !== 'controller') return;
    this.pendingInput.push(ev);
  }

  private startFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setInterval(() => {
      if (!this.inputChannel || this.inputChannel.readyState !== 'open') return;
      if (this.pendingInput.length === 0) return;
      const batch = this.pendingInput;
      this.pendingInput = [];
      try { this.inputChannel.send(JSON.stringify(batch)); } catch { /* ignore */ }
    }, 16);
  }

  private async onInputMessage(data: any): Promise<void> {
    try {
      const events = JSON.parse(typeof data === 'string' ? data : String(data));
      if (Array.isArray(events) && events.length) {
        await invoke('remote_inject_input', { events });
      }
    } catch (e) {
      console.warn('注入输入失败', e);
    }
  }
}

export const remoteControlService = new RemoteControlService();
