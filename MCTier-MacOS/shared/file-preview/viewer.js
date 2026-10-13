import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import JSZip from 'jszip';
import { Archive } from 'libarchive.js';
import { archiveWorkerSource } from './worker.generated.js';

const root = document.getElementById('content');
const status = document.getElementById('status');
let started = false;
let themeReceived = false;
async function preview({ data, name, kind, dark, english }) {
  if (started) return;
  started = true;
  if (!themeReceived) document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  status.textContent = english ? 'Loading preview...' : '正在加载预览…';
  try {
    if (!(data instanceof ArrayBuffer) || data.byteLength > 64 * 1024 * 1024) throw Error('FILE_LIMIT');
    if (kind === 'slides') {
      const zip = await JSZip.loadAsync(data);
      const entries = Object.values(zip.files);
      if (entries.length > 10000 || entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize || 0), 0) > 256 * 1024 * 1024) throw Error('EXPANSION_LIMIT');
      const count = entries.filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).length;
      if (!count || count > 200) throw Error('SLIDE_LIMIT');
      // The renderer runs in an isolated frame without app APIs or network access.
      await PptxViewer.open(data, root, { zipLimits: RECOMMENDED_ZIP_LIMITS, fitMode: 'contain', pdfjs: false, lazyMedia: true, lazySlides: true, listOptions: { windowed: true } });
    } else if (kind === 'archive') {
      const workerUrl = URL.createObjectURL(new Blob([archiveWorkerSource], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      worker.onerror = event => { console.error('Archive worker:', event.message); status.textContent = english ? 'Archive engine failed to load' : '压缩包预览引擎加载失败'; };
      Archive.init({ getWorker: () => worker });
      let timer;
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('ARCHIVE_TIMEOUT')), 20000); });
      let archive;
      try {
        archive = await Promise.race([Archive.open(new File([data], name)), deadline]);
        // Use the flat native listing: the library's object builder interprets
        // untrusted path components as object keys. Never extract archive contents.
        const entries = await Promise.race([archive.client.listFiles(), deadline]);
        if (entries.length > 10000) throw Error('ENTRY_LIMIT');
        const paths = new Map();
        for (const entry of entries) {
          const parts = entry.path.replaceAll('\\', '/').split('/').filter(Boolean);
          if (parts.length > 32 || parts.some(part => part === '..' || part.length > 255)) continue;
          for (let i = 1; i <= parts.length; i++) {
            const path = parts.slice(0, i).join('/');
            paths.set(path, { folder: i < parts.length || entry.type === 'DIR', size: i === parts.length ? entry.size : 0 });
          }
          if (paths.size > 20000) throw Error('TREE_LIMIT');
        }
        const list = document.createElement('ul');
        list.className = 'archive-tree';
        for (const [path, item] of [...paths].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
          const row = document.createElement('li');
          row.style.paddingInlineStart = `${12 + (path.split('/').length - 1) * 16}px`;
          const label = document.createElement('span');
          label.textContent = `${item.folder ? '▸ ' : '· '}${path.split('/').at(-1)}`;
          label.title = path;
          const size = document.createElement('small');
          size.textContent = item.folder ? '' : `${Number(item.size).toLocaleString()} B`;
          row.append(label, size); list.append(row);
        }
        if (paths.size) root.append(list);
        if (!paths.size) status.textContent = english ? 'Empty archive' : '压缩包为空';
      } finally {
        clearTimeout(timer); await archive?.close(); worker.terminate(); URL.revokeObjectURL(workerUrl);
      }
    }
    if (root.childElementCount) status.hidden = true;
  } catch (error) {
    console.error(error);
    status.textContent = english ? 'Preview failed. The file may be encrypted, damaged or exceed preview limits.' : '预览失败：文件可能已加密、损坏或超过预览限制。';
  }
}
window.addEventListener('message', event => {
  if (event.source === window.parent && event.data?.type === 'mctier-preview-theme' && typeof event.data.dark === 'boolean') {
    themeReceived = true;
    document.documentElement.dataset.theme = event.data.dark ? 'dark' : 'light';
  }
  if (event.source === window.parent && event.data?.type === 'mctier-preview') void preview(event.data);
});
if (location.search.includes('android=1')) {
  const query = new URLSearchParams(location.search);
  fetch('attachment').then(response => { if (!response.ok) throw Error('READ_FAILED'); return response.arrayBuffer(); })
    .then(data => preview({ data, name: query.get('name'), kind: query.get('kind'), dark: query.get('dark') === '1', english: query.get('en') === '1' }))
    .catch(() => { status.textContent = '无法读取文件 / Unable to read file'; });
}
