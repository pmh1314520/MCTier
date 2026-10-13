import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { tl } from '../../i18n';

/** Measure intrinsic text width again whenever the viewport, text or font changes. */
export function AnnouncementBar({ text }: { text: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useLayoutEffect(() => {
    const box = viewport.current;
    const label = content.current;
    if (!box || !label) return;
    let active = true;
    const measure = () => {
      if (active) setOverflow(Math.max(0, label.scrollWidth - box.clientWidth));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(label);
    measure();
    void document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, [text]);

  return (
    <div className="mini-announcement">
      <span className="mini-announce-icon" title={tl('大厅公告', 'Lobby announcement')}>
        {/* Material Rounded Campaign, matching Android Icons.Rounded.Campaign. */}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M18 12c0 .55.45 1 1 1h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1m-1.41 4.82c-.33.44-.24 1.05.2 1.37.53.39 1.09.81 1.62 1.21.44.33 1.06.24 1.38-.2 0-.01.01-.01.01-.02.33-.44.24-1.06-.2-1.38-.53-.4-1.09-.82-1.61-1.21-.44-.33-1.06-.23-1.39.21 0 .01-.01.02-.01.02m3.22-12.01c0-.01-.01-.01-.01-.02-.33-.44-.95-.53-1.38-.2-.53.4-1.1.82-1.62 1.22-.44.33-.52.95-.19 1.38 0 .01.01.01.01.02.33.44.94.53 1.38.2.53-.39 1.09-.82 1.62-1.22.43-.32.51-.94.19-1.38M8 9H4c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v3c0 .55.45 1 1 1s1-.45 1-1v-3h1l5 3V6zm7.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34" />
        </svg>
      </span>
      <div className="mini-announce-viewport" ref={viewport}>
        <span ref={content} key={text}
          className={`mini-announce-marquee${overflow > 0 ? ' is-overflowing' : ''}`}
          style={{ '--announce-offset': `${-overflow}px`, '--announce-duration': `${Math.max(4, overflow / 30)}s` } as CSSProperties}>
          {text}
        </span>
      </div>
    </div>
  );
}
