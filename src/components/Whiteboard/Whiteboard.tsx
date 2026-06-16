/**
 * 共享白板：在画布上自由绘制并实时同步给全队
 * - 坐标采用 0~1 归一化，保证不同屏幕尺寸下还原一致
 * - 一笔绘制完成后通过 P2P 控制消息广播；清空操作同步全员
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from 'antd';
import { useAppStore } from '../../stores';
import type { WhiteboardStroke } from '../../stores/appStore';
import { p2pChatService } from '../../services/chat/P2PChatService';
import './Whiteboard.css';

const COLORS = ['#52C41A', '#1677FF', '#FA541C', '#FAAD14', '#722ED1', '#000000', '#FFFFFF'];
const WIDTHS = [2, 4, 8];
const MAX_POINTS = 200; // 单笔画点数上限，超出则分片

interface WhiteboardProps {
  active: boolean;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useAppStore((s) => s.whiteboardStrokes);
  const addWhiteboardStroke = useAppStore((s) => s.addWhiteboardStroke);
  const clearWhiteboard = useAppStore((s) => s.clearWhiteboard);

  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const drawing = useRef(false);
  const currentPts = useRef<[number, number][]>([]);

  // 把单笔画绘制到 canvas
  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, s: WhiteboardStroke, w: number, h: number) => {
    if (!s.points || s.points.length === 0) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = p[0] * w;
      const y = p[1] * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (s.points.length === 1) {
      // 单点画成小圆点
      const x = s.points[0][0] * w;
      const y = s.points[0][1] * h;
      ctx.arc(x, y, s.width / 2, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }, []);

  // 重绘全部
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    strokes.forEach((s) => drawStroke(ctx, s, w, h));
  }, [strokes, drawStroke]);

  // 尺寸适配 + 重绘
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = Math.max(260, Math.round(parent.clientWidth * 0.6));
    }
    redraw();
  }, [active, redraw]);

  useEffect(() => {
    redraw();
  }, [strokes, redraw]);

  const getNorm = (e: React.PointerEvent): [number, number] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  const flushStroke = (pts: [number, number][]) => {
    if (pts.length === 0) return;
    const stroke: WhiteboardStroke = {
      op: 'stroke',
      id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color,
      width,
      points: pts,
    };
    addWhiteboardStroke(stroke);
    void p2pChatService.sendControlMessage('whiteboard', JSON.stringify(stroke));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drawing.current = true;
    currentPts.current = [getNorm(e)];
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const pt = getNorm(e);
    currentPts.current.push(pt);
    // 即时本地预览
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas && currentPts.current.length >= 2) {
      const w = canvas.width;
      const h = canvas.height;
      const a = currentPts.current[currentPts.current.length - 2];
      const b = pt;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0] * w, a[1] * h);
      ctx.lineTo(b[0] * w, b[1] * h);
      ctx.stroke();
    }
    // 分片：点数过多时先发一段，保留最后一个点续接
    if (currentPts.current.length >= MAX_POINTS) {
      const chunk = currentPts.current;
      currentPts.current = [pt];
      flushStroke(chunk);
    }
  };

  const onPointerUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const pts = currentPts.current;
    currentPts.current = [];
    flushStroke(pts);
  };

  const handleClear = () => {
    clearWhiteboard();
    void p2pChatService.sendControlMessage('whiteboard', JSON.stringify({ op: 'clear' }));
  };

  return (
    <div className="wb-wrap">
      <div className="wb-toolbar">
        <div className="wb-colors-row">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`wb-color ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
        <div className="wb-widths-row">
          {WIDTHS.map((wv) => (
            <button
              key={wv}
              className={`wb-width ${width === wv ? 'active' : ''}`}
              onClick={() => setWidth(wv)}
              title={`粗细 ${wv}`}
            >
              <span style={{ width: wv + 2, height: wv + 2 }} />
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <Button size="small" danger onClick={handleClear}>清空白板</Button>
        </div>
      </div>
      <div className="wb-canvas-box">
        <canvas
          ref={canvasRef}
          className="wb-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  );
};
