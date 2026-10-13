import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Spin } from 'antd';
import { LeftOutlined, RightOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { tl } from '../../i18n';
import './PdfPreview.css';

GlobalWorkerOptions.workerSrc = pdfWorker;

/** Canvas-only PDF content: no browser PDF toolbar, embedded scripts or external navigation. */
export default function PdfPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(640);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<{ submit: (password: string) => void } | null>(null);
  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(null);
    setPage(1);
    setZoom(1);
    setBusy(true);
    setError('');
    setChallenge(null);
    void (async () => {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > 64 * 1024 * 1024)
        throw new Error('PDF_READ_FAILED');
      const data = await response.arrayBuffer();
      if (data.byteLength > 64 * 1024 * 1024) throw new Error('PDF_LIMIT');
      if (disposed) return;
      task = getDocument({
        data,
        enableXfa: false,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      });
      task.onPassword = (submit: (password: string) => void) => {
        if (!disposed) {
          setChallenge({ submit });
          setBusy(false);
        }
      };
      const pdf = await task.promise;
      if (disposed) {
        void task.destroy();
        return;
      }
      setChallenge(null);
      setDocument(pdf);
    })().catch((e) => {
      if (!disposed) {
        console.warn('PDF preview unavailable', e);
        setBusy(false);
        setError(
          tl('无法预览此 PDF，请下载后查看', 'Unable to preview this PDF. Download it to view.')
        );
      }
    });
    return () => {
      disposed = true;
      abort.abort();
      void task?.destroy().catch(() => {});
    };
  }, [url]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(160, element.clientWidth - 32)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let disposed = false;
    let task: { cancel(): void; promise: Promise<void> } | undefined;
    setBusy(true);
    setError('');
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (disposed || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(
          (width / base.width) * zoom * Math.min(window.devicePixelRatio || 1, 2),
          Math.sqrt(16_000_000 / (base.width * base.height))
        );
        const viewport = pdfPage.getViewport({ scale });
        const element = canvas.current;
        element.width = Math.ceil(viewport.width);
        element.height = Math.ceil(viewport.height);
        element.style.width = `${width * zoom}px`;
        element.style.height = 'auto';
        task = pdfPage.render({ canvas: element, viewport });
        await task.promise;
        if (!disposed) setBusy(false);
      })
      .catch((e) => {
        if (!disposed && e?.name !== 'RenderingCancelledException') {
          setBusy(false);
          setError(
            tl(
              '页面渲染失败，请切换页面或下载文件',
              'Cannot render this page. Try another page or download the file.'
            )
          );
        }
      });
    return () => {
      disposed = true;
      task?.cancel();
    };
  }, [document, page, zoom, width]);
  const submitPassword = () => {
    if (challenge) {
      setBusy(true);
      challenge.submit(password);
      setPassword('');
      setChallenge(null);
    }
  };
  return (
    <div className="mctier-pdf-preview">
      <div
        className="mctier-pdf-toolbar"
        role="toolbar"
        aria-label={tl('PDF 阅读控件', 'PDF controls')}
      >
        <Button
          icon={<LeftOutlined />}
          disabled={!document || page <= 1}
          onClick={() => setPage((value) => value - 1)}
          aria-label={tl('上一页', 'Previous page')}
        />
        <span>
          {page} / {document?.numPages ?? '—'}
        </span>
        <Button
          icon={<RightOutlined />}
          disabled={!document || page >= document.numPages}
          onClick={() => setPage((value) => value + 1)}
          aria-label={tl('下一页', 'Next page')}
        />
        <Button
          icon={<MinusOutlined />}
          disabled={zoom <= 0.5}
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          aria-label={tl('缩小', 'Zoom out')}
        />
        <Button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</Button>
        <Button
          icon={<PlusOutlined />}
          disabled={zoom >= 3}
          onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
          aria-label={tl('放大', 'Zoom in')}
        />
      </div>
      {challenge && (
        <div className="mctier-pdf-password">
          <Input.Password
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={submitPassword}
            placeholder={tl('此 PDF 需要密码', 'PDF password required')}
          />
          <Button onClick={submitPassword}>{tl('解锁', 'Unlock')}</Button>
        </div>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      <div className="mctier-pdf-pages" ref={container}>
        {busy && (
          <div className="mctier-pdf-loading">
            <Spin />
          </div>
        )}
        <canvas
          ref={canvas}
          aria-label={tl(`PDF 第 ${page} 页`, `PDF page ${page}`)}
          style={{ display: document ? 'block' : 'none' }}
        />
      </div>
    </div>
  );
}
