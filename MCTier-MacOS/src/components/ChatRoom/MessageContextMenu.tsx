import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { contextMenuPosition } from '../../utils/contextMenuPosition';

export function MessageContextMenu({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const place = () => {
      const bounds = menu.getBoundingClientRect();
      const position = contextMenuPosition(x, y, bounds.width, bounds.height, window.innerWidth, window.innerHeight);
      Object.assign(menu.style, { left: `${position.left}px`, top: `${position.top}px` });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [x, y]);
  // Transformed chat ancestors must not change the viewport coordinate space.
  return createPortal(<div ref={ref} className="chat-message-context-menu" style={{ left: x, top: y, maxWidth: 'calc(100vw - 16px)' }}
    role="menu" onMouseDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>{children}</div>, document.body);
}
