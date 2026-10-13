import JSZip from 'jszip';

export const MAX_CHAT_ATTACHMENT_BYTES = 64 * 1024 * 1024;

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export type ChatFileKind = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'word' | 'sheet' | 'slides' | 'archive' | 'other';

const safeId = /^[A-Za-z0-9_-]{12,128}$/;
const safeMime = /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/;

export function parseChatAttachment(value: unknown): ChatAttachment | null {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch { return null; }
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const item = candidate as Record<string, unknown>;
  if (typeof item.id !== 'string' || !safeId.test(item.id)) return null;
  if (typeof item.name !== 'string' || !item.name || [...item.name].length > 180 || /[\x00-\x1f\\/:]/.test(item.name)) return null;
  if (typeof item.mime !== 'string' || item.mime.length > 128 || !safeMime.test(item.mime)) return null;
  if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_CHAT_ATTACHMENT_BYTES) return null;
  return { id: item.id, name: item.name, mime: item.mime.toLowerCase(), size: item.size };
}

export function chatFileKind(file: ChatAttachment): ChatFileKind {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.mime.startsWith('image/')) return 'image';
  if (file.mime.startsWith('audio/')) return 'audio';
  if (file.mime.startsWith('video/')) return 'video';
  if (file.mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'xlsb', 'ods', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slides';
  if (file.mime.startsWith('text/') || ['json', 'xml', 'js', 'ts', 'tsx', 'jsx', 'css', 'rs', 'kt', 'java', 'py', 'go', 'c', 'h', 'cpp', 'hpp', 'toml', 'yaml', 'yml'].includes(ext)) return 'text';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst'].includes(ext)) return 'archive';
  return 'other';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const xmlDocument = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('OFFICE_XML_INVALID');
  return document;
};

const xmlText = (xml: string, tags: string[]) => {
  const document = xmlDocument(xml);
  return tags.flatMap((tag) => Array.from(document.getElementsByTagName(tag)))
    .map((node) => node.textContent?.trim() ?? '').filter(Boolean);
};

export async function previewOfficeFile(blob: Blob, kind: ChatFileKind, fileName = ''): Promise<{ title: string; sections: string[] }> {
  if (blob.size > MAX_CHAT_ATTACHMENT_BYTES) throw new Error('OFFICE_PREVIEW_TOO_LARGE');
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (kind === 'sheet' && ['csv', 'tsv'].includes(extension)) {
    const delimiter = extension === 'tsv' ? '\t' : ',';
    const rows = (await blob.text()).slice(0, 2 * 1024 * 1024).split(/\r?\n/).slice(0, 500).map((line) => {
      if (delimiter === '\t') return line;
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
        else if (character === '"') quoted = !quoted;
        else if (character === ',' && !quoted) { cells.push(cell); cell = ''; }
        else cell += character;
      }
      cells.push(cell);
      return cells.slice(0, 50).join('\t');
    });
    return { title: 'Spreadsheet', sections: [`--- 1 ---\n${rows.join('\n')}`] };
  }
  if (['doc', 'xls', 'xlsb', 'ppt', 'rtf'].includes(extension)) throw new Error('LEGACY_OFFICE_NATIVE_PREVIEW');
  const zip = await JSZip.loadAsync(blob);
  const assertEntryBudget = (names: string[]) => {
    let total = 0;
    for (const name of names) {
      const entry = zip.file(name);
      const size = Number((entry as unknown as { _data?: { uncompressedSize?: number } } | null)?._data?.uncompressedSize);
      if (!Number.isFinite(size) || size < 0 || size > 8 * 1024 * 1024) throw new Error('OFFICE_ENTRY_TOO_LARGE');
      total += size;
      if (total > 32 * 1024 * 1024) throw new Error('OFFICE_PREVIEW_BUDGET_EXCEEDED');
    }
  };
  if (['odt', 'ods', 'odp'].includes(extension)) {
    assertEntryBudget(['content.xml']);
    const xml = await zip.file('content.xml')?.async('text');
    if (!xml) throw new Error('OPEN_DOCUMENT_CONTENT_MISSING');
    const document = xmlDocument(xml);
    if (extension === 'ods') {
      const sheets = Array.from(document.getElementsByTagName('table:table')).slice(0, 50);
      return { title: 'OpenDocument Spreadsheet', sections: sheets.map((sheet, index) => {
        const rows = Array.from(sheet.getElementsByTagName('table:table-row')).slice(0, 500).map((row) =>
          Array.from(row.getElementsByTagName('table:table-cell')).slice(0, 50).map((cell) => cell.textContent?.trim() ?? '').join('\t'),
        );
        return `--- ${index + 1} ---\n${rows.join('\n')}`;
      }) };
    }
    if (extension === 'odp') {
      const pages = Array.from(document.getElementsByTagName('draw:page')).slice(0, 200);
      return { title: 'OpenDocument Presentation', sections: pages.map((page, index) => `--- ${index + 1} ---\n${page.textContent?.trim() ?? ''}`) };
    }
    return { title: 'OpenDocument Text', sections: Array.from(document.getElementsByTagName('text:p')).slice(0, 600).map((node) => node.textContent?.trim() ?? '').filter(Boolean) };
  }
  if (kind === 'word') {
    assertEntryBudget(['word/document.xml']);
    const xml = await zip.file('word/document.xml')?.async('text');
    if (!xml) throw new Error('DOCX_DOCUMENT_MISSING');
    const document = xmlDocument(xml);
    const paragraphs = Array.from(document.getElementsByTagName('w:p')).slice(0, 600).map((paragraph) =>
      Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent ?? '').join('').trim(),
    ).filter(Boolean);
    return { title: 'Word', sections: paragraphs };
  }
  if (kind === 'slides') {
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    assertEntryBudget(slides.slice(0, 200));
    const sections: string[] = [];
    for (const [index, name] of slides.slice(0, 200).entries()) {
      const xml = await zip.file(name)!.async('text');
      const text = xmlText(xml, ['a:t']);
      sections.push(`--- ${index + 1} ---\n${text.join('\n')}`);
    }
    return { title: 'PowerPoint', sections };
  }
  if (kind === 'sheet') {
    const sheets = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    assertEntryBudget(['xl/sharedStrings.xml', ...sheets.slice(0, 50)].filter((name) => zip.file(name)));
    const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('text');
    const shared = sharedXml ? xmlText(sharedXml, ['si']) : [];
    const sections: string[] = [];
    for (const [index, name] of sheets.slice(0, 50).entries()) {
      const xml = await zip.file(name)!.async('text');
      const document = xmlDocument(xml);
      const rows = Array.from(document.getElementsByTagName('row')).slice(0, 500).map((row) =>
        Array.from(row.getElementsByTagName('c')).slice(0, 50).map((cell) => {
          const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
          const type = cell.getAttribute('t');
          if (type === 's') return shared[Number(raw)] ?? '';
          if (type === 'inlineStr') return Array.from(cell.getElementsByTagName('t')).map((node) => node.textContent ?? '').join('');
          if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
          return raw || cell.getElementsByTagName('f')[0]?.textContent || '';
        }).join('\t'),
      );
      sections.push(`--- ${index + 1} ---\n${rows.join('\n')}`);
    }
    return { title: 'Excel', sections };
  }
  throw new Error('UNSUPPORTED_OFFICE_KIND');
}
