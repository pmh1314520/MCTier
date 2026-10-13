import React, { useEffect, useRef, useState, useCallback } from 'react';
import { App as AntdApp } from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { tl } from '../../i18n';
import { remoteControlService } from '../../services/remoteControl/RemoteControlService';
import { codeToVk } from '../../services/remoteControl/keymap';
import { RelativePointer } from '../../services/remoteControl/relativePointer';
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
  const [gameMouse, setGameMouse] = useState(false);
  const [pointerLocked, setPointerLocked] = useState(false);
  const gameMouseRef = useRef(false);
  const relativePointer = useRef(new RelativePointer(event => remoteControlService.sendInput(event)));
  const pressedKeys = useRef(new Map<string, { code: number; extended: boolean }>());
  const releaseInputs = useCallback(() => {
    relativePointer.current.release();
    for (const key of pressedKeys.current.values()) remoteControlService.sendInput({ kind: 'keyup', ...key });
    pressedKeys.current.clear();
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    const onLock = () => {
      const locked = !!surface && document.pointerLockElement === surface;
      if (locked && (!controllerStream || !gameMouseRef.current)) {
        document.exitPointerLock();
        return;
      }
      setPointerLocked(locked);
      if (!locked) releaseInputs();
    };
    const onBlur = () => {
      releaseInputs();
      if (surface && document.pointerLockElement === surface) document.exitPointerLock();
    };
    const onError = () => message.warning(tl('无法锁定鼠标，请再次点击远程画面重试', 'Could not lock the mouse. Click the remote screen to retry.'));
    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('pointerlockerror', onError);
    window.addEventListener('blur', onBlur);
    if (!controllerStream) {
      gameMouseRef.current = false;
      setGameMouse(false);
      setPointerLocked(false);
    }
    return () => {
      onBlur();
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('pointerlockerror', onError);
      window.removeEventListener('blur', onBlur);
    };
  }, [controllerStream, message, releaseInputs]);

  const toggleGameMouse = () => {
    releaseInputs();
    gameMouseRef.current = !gameMouseRef.current;
    setGameMouse(gameMouseRef.current);
    if (document.pointerLockElement === surfaceRef.current) document.exitPointerLock();
  };

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
        content: (
          <div style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>
            {tl(
              `${fromName} 请求远程控制你的设备。\n\n· 用途：接受后对方可实时看到你的屏幕并操作你的设备，你可随时点「停止被控」结束。\n· 风险提示：请仅在信任的人之间使用，避免屏幕上出现银行、验证码、隐私等敏感信息。\n· 禁止用途：严禁用于偷窥、窃取信息、非法控制等行为，违者自负法律责任。`,
              `${fromName} requests to remotely control your device.\n\n- Purpose: they will see your screen in real time and operate your device; you can click "Stop" anytime.\n- Risk: use only with people you trust; avoid showing bank info, verification codes or private data on screen.\n- Prohibited: spying, stealing information or unauthorized control are strictly forbidden; violators bear legal liability.`
            )}
          </div>
        ),
        okText: tl('接受', 'Accept'),
        cancelText: tl('拒绝', 'Reject'),
        okButtonProps: { danger: true },
        centered: true,
        onOk: async () => {
          try {
            await remoteControlService.acceptControl(sessionId, from, fromName);
          } catch (error) {
            // 权限缺失（如 macOS 辅助功能未授权）有明确的引导文案，必须透传
            // 给用户，不能全部吞成同一句"采集失败"。
            const detail = error instanceof Error && error.message ? error.message : String(error);
            const isAccessibility = detail.includes('辅助功能');
            const messageText = isAccessibility
              ? detail
              : tl('屏幕采集被取消或失败', 'Screen capture was cancelled or failed');
            if (isAccessibility) {
              modal.confirm({
                title: tl('需要辅助功能授权', 'Accessibility permission required'),
                content: detail,
                okText: tl('打开系统设置', 'Open System Settings'),
                cancelText: tl('取消', 'Cancel'),
                onOk: async () => {
                  try {
                    await invoke('open_accessibility_privacy_settings');
                  } catch (settingsError) {
                    message.error(String(settingsError));
                  }
                },
              });
            } else {
              message.error(messageText);
            }
            if (remoteControlService.isSessionForPeer(sessionId, from)) remoteControlService.stopControl();
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
      const video = videoRef.current;
      let receivedFrame = false;
      let frameRequest: number | null = null;
      const timeout = window.setTimeout(() => {
        if (!receivedFrame) {
          message.error(tl('远程画面连接超时，请重试', 'Remote video timed out. Please retry.'));
          remoteControlService.stopControl();
        }
      }, 30000);
      const onFrame = () => {
        receivedFrame = true;
        clearTimeout(timeout);
      };
      if (video.requestVideoFrameCallback) {
        frameRequest = video.requestVideoFrameCallback(onFrame);
      } else {
        video.addEventListener('playing', onFrame, { once: true });
      }
      video.srcObject = controllerStream;
      video.play().catch((error) => console.warn('远程画面播放失败', error));
      return () => {
        clearTimeout(timeout);
        video.removeEventListener('playing', onFrame);
        if (frameRequest !== null) video.cancelVideoFrameCallback(frameRequest);
        video.srcObject = null;
      };
    }
  }, [controllerStream, message]);

  // 控制端键盘捕获
  useEffect(() => {
    if (!controllerStream) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to the local pointer lock, never the remote game.
      if (gameMouseRef.current && (e.code === 'Escape' || document.pointerLockElement !== surfaceRef.current)) return;
      const vk = codeToVk(e.code);
      if (!vk) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'keydown') pressedKeys.current.set(e.code, vk);
      else pressedKeys.current.delete(e.code);
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
    if (gameMouseRef.current) {
      if (document.pointerLockElement === surfaceRef.current) relativePointer.current.move(e.movementX, e.movementY);
      return;
    }
    const n = toNormalized(e.clientX, e.clientY);
    if (n) remoteControlService.sendInput({ kind: 'move', x: n.x, y: n.y });
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (gameMouseRef.current) {
      e.preventDefault();
      if (document.pointerLockElement === surfaceRef.current) relativePointer.current.button(e.button, true);
      else {
        // Consume the click used to acquire the lock; it must not fire in-game.
        try { void surfaceRef.current?.requestPointerLock()?.catch(() => {}); }
        catch { message.warning(tl('当前环境不支持鼠标锁定', 'Mouse lock is unavailable in this environment')); }
      }
      return;
    }
    const n = toNormalized(e.clientX, e.clientY);
    if (n) remoteControlService.sendInput({ kind: 'down', button: e.button, x: n.x, y: n.y });
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (gameMouseRef.current) {
      if (document.pointerLockElement === surfaceRef.current) relativePointer.current.button(e.button, false);
      return;
    }
    const n = toNormalized(e.clientX, e.clientY);
    if (n) remoteControlService.sendInput({ kind: 'up', button: e.button, x: n.x, y: n.y });
  };
  const onWheel = (e: React.WheelEvent) => {
    if (gameMouseRef.current && document.pointerLockElement !== surfaceRef.current) return;
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
          {tl(`${controlledBy} 正在远程控制你的设备`, `${controlledBy} is controlling your device`)}
          <button className="rc-banner-btn danger" onClick={stop}>{tl('停止被控', 'Stop')}</button>
        </div>
      )}

      {/* 控制端：全屏控制窗 */}
      {controllerStream && (
        <div className="rc-viewer">
          <div className="rc-viewer-bar">
            <span className="rc-viewer-title">
              {tl(`正在控制 ${controllerPeer} 的设备`, `Controlling ${controllerPeer}'s device`)}
            </span>
            <span className="rc-viewer-hint">
              {gameMouse ? (pointerLocked ? tl('游戏鼠标已锁定 · Esc 释放鼠标', 'Game mouse locked · Esc to release') : tl('点击画面锁定鼠标 · 适用于 Minecraft 等 3D 游戏（双方需 3.8.0）', 'Click video to lock · For 3D games (both peers need 3.8.0)')) : tl('鼠标键盘将直接操作对方设备', 'Your mouse & keyboard control the remote device')}
            </span>
            <button className="rc-game-mouse" aria-pressed={gameMouse} onClick={toggleGameMouse}>
              {gameMouse ? tl('切回桌面鼠标', 'Desktop mouse') : tl('游戏鼠标', 'Game mouse')}
            </button>
            <button className="rc-viewer-stop" onClick={stop}>{tl('结束', 'End')}</button>
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
