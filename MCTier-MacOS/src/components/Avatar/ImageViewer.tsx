import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseOutlined, DownloadOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { tl } from '../../i18n';
import '../ChatRoom/ChatRoom.css';

export function ImageViewer({ src, name, onClose, download }: {
  src: string; name: string; onClose: () => void; download?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => previous?.focus();
  }, []);
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  return createPortal(<div className="image-preview-modal" role="dialog" aria-modal="true" aria-label={name}
    onClick={(e) => { e.stopPropagation(); onClose(); }}
    onContextMenu={(e) => e.stopPropagation()}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault(); buttons[(index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }
    }}>
    <button ref={close} type="button" className="image-preview-close" aria-label={tl('关闭图片预览', 'Close image preview')} title={tl('关闭图片预览', 'Close image preview')}><CloseOutlined /></button>
    <div className="image-preview-content" onClick={(e) => e.stopPropagation()}>
      <div className="image-preview-stage" onWheel={(e) => { setZoom(z => Math.min(4, Math.max(.5, z + (e.deltaY < 0 ? .15 : -.15)))); }}
        onPointerDown={(e) => { if (zoom <= 1) return; drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!drag.current) return; const old = drag.current; setPan(p => ({ x: p.x + e.clientX - old.x, y: p.y + e.clientY - old.y })); drag.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}>
        <img src={src} alt={name} draggable={false} onDoubleClick={reset} style={{ transform: `translate(${zoom > 1 ? pan.x : 0}px, ${zoom > 1 ? pan.y : 0}px) scale(${zoom})` }} />
      </div>
      <div className="image-preview-actions">
        <button type="button" title={tl('缩小', 'Zoom out')} onClick={() => setZoom(z => Math.max(.5, z - .25))}><MinusOutlined /></button>
        <button type="button" title={tl('重置缩放', 'Reset zoom')} onClick={reset}>{Math.round(zoom * 100)}%</button>
        <button type="button" title={tl('放大', 'Zoom in')} onClick={() => setZoom(z => Math.min(4, z + .25))}><PlusOutlined /></button>
      </div>
      {download && <button type="button" className="image-preview-download" onClick={download}><DownloadOutlined />{tl('下载', 'Download')}</button>}
    </div>
  </div>, document.body);
}
