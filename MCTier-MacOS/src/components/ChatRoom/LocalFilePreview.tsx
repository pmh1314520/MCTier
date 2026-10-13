import { useEffect, useRef, useState } from 'react';
import { tl } from '../../i18n';

export function LocalFilePreview({ url, name, kind }: { url: string; name: string; kind: 'slides' | 'archive' }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState(false);
  const syncTheme = () => frame.current?.contentWindow?.postMessage({
    type: 'mctier-preview-theme', dark: document.documentElement.dataset.theme !== 'light',
  }, '*');
  useEffect(() => {
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  async function load() {
    syncTheme();
    const target = frame.current?.contentWindow;
    try {
      const response = await fetch(url);
      if (!response.ok) throw Error('FILE_READ_FAILED');
      const data = await response.arrayBuffer();
      if (data.byteLength > 64 * 1024 * 1024) throw Error('FILE_LIMIT');
      if (target !== frame.current?.contentWindow) return;
      target?.postMessage({ type: 'mctier-preview', data, name, kind, dark: document.documentElement.dataset.theme !== 'light', english: !tl('中', 'en').includes('中') }, '*', [data]);
    } catch { setError(true); }
  }
  if (error) return <div role="alert">{tl('文件预览加载失败', 'Unable to load file preview')}</div>;
  return <iframe ref={frame} title={name} className="file-preview-pdf" sandbox="allow-scripts" src="/file-preview/index.html" onLoad={() => void load()} onError={() => setError(true)} />;
}
