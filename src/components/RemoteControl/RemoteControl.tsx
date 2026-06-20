import React, { useEffect, useRef, useState, useCallback } from 'react';
import { App as AntdApp } from 'antd';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { remoteControlService } from '../../services/remoteControl/RemoteControlService';
import { codeToVk } from '../../services/remoteControl/keymap';
import './RemoteControl.css';

/**
 * 远程控制全局组件（挂载一次，常驻大厅界面）
 * - 被控端：收到请求弹授权框；被控中显示顶部横幅 + 停止按钮
 * - 控制端：收到对端视频后显示全屏控制窗，捕获鼠标/键盘转发
 */
export const RemoteControl: React.FC = () => {
  useTranslation();
  const { modal, message } = AntdApp.useApp();

  // 控制端：远程画面
  const [controllerStream, setControllerStream] = useState<MediaStream | null>(null);
  const [controllerPeer, setControllerPeer] = useState('');
  // 被控端：被控中
  const [controlledBy, setControlledBy] = useState<string | null>(null);
  // 控制端：等待对方接受
  const [waiting, setWaiting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // ===== 计算指针在远程屏幕中的归一化坐标（object-fit: contain 信箱映射） =====
  const toNormalized = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const surface = surfaceRef.current;
    const video = videoRef.current;
    if (!surface || !video || !video.videoWidth || !video.videoHeight) return null;
    const rect = surface.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const vidRatio = video.videoWidth / video.videoHeight;
    const boxRatio = cw / ch;
    let contentW = cw, contentH = ch, offX = 0, offY = 0;
    if (vidRatio > boxRatio) {
      // 视频更宽，左右占满，上下留黑边
      contentW = cw;
      contentH = cw / vidRatio;
      offY = (ch - contentH) / 2;
    } else {
      contentH = ch;
      contentW = ch * vidRatio;
      offX = (cw - contentW) / 2;
    }
    const px = clientX - rect.left - offX;
    const py = clientY - rect.top - offY;
    if (px < 0 || py < 0 || px > contentW || py > contentH) return null;
    return { x: px / contentW, y: py / contentH };
  }, []);

  // ===== 监听服务事件 =====
  useEffect(() => {
    const onIncoming = (e: Event) => {
      const { sessionId, from, fromName } = (e as CustomEvent).detail;
      modal.confirm({
        title: tl('远程控制请求', 'Remote Control Request'),
        content: tl(
          `${fromName} 请求远程控制你的电脑。接受后对方将能操作你的鼠标和键盘，你可随时停止。`,
          `${fromName} requests to remotely control your PC. Once accepted, they can operate your mouse and keyboard. You can stop anytime.`
        ),
        okText: tl('接受', 'Accept'),
        cancelText: tl('拒绝', 'Reject'),
        okButtonProps: { danger: true },
        centered: true,
        onOk: async () => {
          try {
            await remoteControlService.acceptControl(sessionId, from, fromName);
          } catch (err) {
            message.error(tl('屏幕采集被取消或失败', 'Screen capture was cancelled or failed'));
            remoteControlService.stopControl();
          }
        },
        onCancel: () => {
          remoteControlService.rejectControl(sessionId, from);
        },
      });
    };

    const onStream = (e: Event) => {
      const { stream, peerName } = (e as CustomEvent).detail;
      setWaiting(false);
      setControllerStream(stream);
      setControllerPeer(peerName || '');
    };

    const onControlledActive = (e: Event) => {
      const { peerName } = (e as CustomEvent).detail;
      setControlledBy(peerName || tl('对方', 'Peer'));
    };

    const onRejected = (e: Event) => {
      const reason = (e as CustomEvent).detail?.reason;
      setWaiting(false);
      if (reason === 'busy') message.warning(tl('对方正忙，无法发起远程控制', 'The peer is busy'));
      else if (reason === 'timeout') message.warning(tl('对方未响应远程控制请求', 'The peer did not respond'));
      else message.info(tl('对方拒绝了远程控制', 'The peer rejected remote control'));
    };

    const onEnded = () => {
      setControllerStream(null);
      setControllerPeer('');
      setControlledBy(null);
      setWaiting(false);
    };

    const onWaiting = () => setWaiting(true);

    window.addEventListener('rc-incoming-request', onIncoming);
    window.addEventListener('rc-stream', onStream);
    window.addEventListener('rc-controlled-active', onControlledActive);
    window.addEventListener('rc-rejected', onRejected);
    window.addEventListener('rc-ended', onEnded);
    window.addEventListener('rc-waiting', onWaiting);
    return () => {
      window.removeEventListener('rc-incoming-request', onIncoming);
      window.removeEventListener('rc-stream', onStream);
      window.removeEventListener('rc-controlled-active', onControlledActive);
      window.removeEventListener('rc-rejected', onRejected);
      window.removeEventListener('rc-ended', onEnded);
      window.removeEventListener('rc-waiting', onWaiting);
    };
  }, [modal, message]);

  // 绑定视频流
  useEffect(() => {
    if (controllerStream && videoRef.current) {
      videoRef.current.srcObject = controllerStream;
      videoRef.current.play().catch(() => {});
    }
  }, [controllerStream]);

  // 控制端键盘捕获
  useEffect(() => {
    if (!controllerStream) return;
    const onKey = (e: KeyboardEvent) => {
      const vk = codeToVk(e.code);
      if (!vk) return;
      e.preventDefault();
      e.stopPropagation();
      remoteControlService.sendInput({
        kind: e.type === 'keydown' ? 'keydown' : 'keyup',
        code: vk.code,
        extended: vk.extended,
      });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [controllerStream]);

  // ===== 控制端鼠标事件 =====
  const onMouseMove = (e: React.MouseEvent) => {
    const n = toNormalized(e.clientX, e.clientY);
    if (n) remoteControlService.sendInput({ kind: 'move', x: n.x, y: n.y });
  };
  const onMouseDown = (e: React.MouseEvent) => {
    const n = toNormalized(e.clientX, e.clientY);
    if (n) remoteControlService.sendInput({ kind: 'down', button: e.button, x: n.x, y: n.y });
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const n = toNormalized(e.clientX, e.clientY);
    if (n) remoteControlService.sendInput({ kind: 'up', button: e.button, x: n.x, y: n.y });
  };
  const onWheel = (e: React.WheelEvent) => {
    remoteControlService.sendInput({ kind: 'wheel', dx: -e.deltaX / 100, dy: -e.deltaY / 100 });
  };

  const stop = () => remoteControlService.stopControl();

  return (
    <>
      {/* 被控端：等待对方接受 */}
      {waiting && (
        <div className="rc-banner rc-waiting">
          <span className="rc-dot" />
          {tl('正在等待对方接受远程控制…', 'Waiting for the peer to accept…')}
          <button className="rc-banner-btn" onClick={stop}>{tl('取消', 'Cancel')}</button>
        </div>
      )}

      {/* 被控端：被控中横幅 */}
      {controlledBy && (
        <div className="rc-banner rc-controlled">
          <span className="rc-dot" />
          {tl(`${controlledBy} 正在远程控制你的电脑`, `${controlledBy} is controlling your PC`)}
          <button className="rc-banner-btn danger" onClick={stop}>{tl('停止被控', 'Stop')}</button>
        </div>
      )}

      {/* 控制端：全屏控制窗 */}
      {controllerStream && (
        <div className="rc-viewer">
          <div className="rc-viewer-bar">
            <span className="rc-viewer-title">
              {tl(`正在控制 ${controllerPeer} 的电脑`, `Controlling ${controllerPeer}'s PC`)}
            </span>
            <span className="rc-viewer-hint">
              {tl('鼠标键盘将直接操作对方电脑', 'Your mouse & keyboard control the remote PC')}
            </span>
            <button className="rc-viewer-stop" onClick={stop}>{tl('结束控制', 'End Control')}</button>
          </div>
          <div
            className="rc-surface"
            ref={surfaceRef}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          >
            <video ref={videoRef} className="rc-video" autoPlay playsInline muted />
          </div>
        </div>
      )}
    </>
  );
};
