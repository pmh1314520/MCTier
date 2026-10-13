import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fileToChatImageDataUrl } from '../chat/imageData';

export interface EmojiCategory {
  id: string;
  name: string;
  builtin?: boolean;
}

export interface EmojiItem {
  id: string;
  categoryId: string;
  name: string;
  mime: string;
  dataUrl: string;
  createdAt: number;
  builtin?: boolean;
}

interface NativeBuiltinEmoji {
  id: string;
  name: string;
  path: string;
}

export interface BuiltinEmojiProgress {
  downloaded: number;
  total: number;
  error?: string;
}

const DB_NAME = 'mctier-emoji-library-v1';
const STORE = 'items';
const CATEGORY_KEY = 'mctier.emoji.categories.v1';
const RECENT_KEY = 'mctier.emoji.recent.v1';
const MAX_CUSTOM_ITEMS = 300;
const MAX_RECENT = 32;
let builtinLoad: Promise<EmojiItem[]> | null = null;
const builtinProgressListeners = new Set<(progress: BuiltinEmojiProgress) => void>();
let builtinProgress: BuiltinEmojiProgress = { downloaded: 0, total: 0 };
function publishBuiltinProgress(progress: BuiltinEmojiProgress) {
  builtinProgress = progress;
  builtinProgressListeners.forEach(listener => listener(progress));
}

const defaultCategories: EmojiCategory[] = [
  { id: 'recent', name: '最近', builtin: true },
  { id: 'builtin', name: '内置', builtin: true },
  { id: 'custom', name: '自定义', builtin: true },
];

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allCustom(): Promise<EmojiItem[]> {
  const db = await openDb();
  return new Promise<EmojiItem[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as EmojiItem[]);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

async function put(item: EmojiItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function remove(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export function getEmojiCategories(): EmojiCategory[] {
  try {
    const stored = JSON.parse(localStorage.getItem(CATEGORY_KEY) || '[]') as EmojiCategory[];
    return [...defaultCategories, ...stored.filter((category) => category.id && category.name && !defaultCategories.some((item) => item.id === category.id))];
  } catch {
    return defaultCategories;
  }
}

export function createEmojiCategory(name: string): EmojiCategory {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) throw new Error('CATEGORY_NAME');
  const categories = getEmojiCategories();
  if (categories.some((category) => category.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('CATEGORY_DUPLICATE');
  const category = { id: uid('category'), name: trimmed };
  localStorage.setItem(CATEGORY_KEY, JSON.stringify([...categories.filter((item) => !item.builtin), category]));
  return category;
}

export function renameEmojiCategory(id: string, name: string): EmojiCategory {
  const categories = getEmojiCategories();
  const target = categories.find((category) => category.id === id && !category.builtin);
  const trimmed = name.trim().slice(0, 20);
  if (!target || !trimmed) throw new Error('CATEGORY_NAME');
  if (categories.some((category) => category.id !== id && category.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('CATEGORY_DUPLICATE');
  const updated = { ...target, name: trimmed };
  localStorage.setItem(CATEGORY_KEY, JSON.stringify(categories.filter((category) => !category.builtin).map((category) => category.id === id ? updated : category)));
  return updated;
}

export async function deleteEmojiCategory(id: string): Promise<void> {
  const categories = getEmojiCategories();
  if (!categories.some((category) => category.id === id && !category.builtin)) throw new Error('CATEGORY_BUILTIN');
  for (const item of (await allCustom()).filter((emoji) => emoji.categoryId === id)) {
    await put({ ...item, categoryId: 'custom' });
  }
  localStorage.setItem(CATEGORY_KEY, JSON.stringify(categories.filter((category) => !category.builtin && category.id !== id)));
}

export function isCustomEmoji(item: EmojiItem): boolean {
  return !item.builtin && item.categoryId !== 'builtin';
}

export function getEmojiDestinationCategories(): EmojiCategory[] {
  return getEmojiCategories().filter((category) => category.id !== 'recent' && category.id !== 'builtin');
}

export async function updateCustomEmoji(id: string, name: string, categoryId: string): Promise<EmojiItem> {
  const item = (await allCustom()).find((candidate) => candidate.id === id);
  const trimmedName = name.trim().slice(0, 80);
  const validDestination = getEmojiDestinationCategories().some((category) => category.id === categoryId);
  if (!item || !isCustomEmoji(item)) throw new Error('EMOJI_BUILTIN');
  if (!trimmedName) throw new Error('EMOJI_NAME');
  if (!validDestination) throw new Error('EMOJI_CATEGORY');
  const updated = { ...item, name: trimmedName, categoryId };
  await put(updated);
  return updated;
}

export async function deleteCustomEmoji(id: string): Promise<void> {
  const item = (await allCustom()).find((candidate) => candidate.id === id);
  if (!item || !isCustomEmoji(item)) throw new Error('EMOJI_BUILTIN');
  await remove(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(getRecentEmojiIds().filter((itemId) => itemId !== id)));
}

export async function syncBuiltinEmojiItems(_retry = false, onProgress?: (progress: BuiltinEmojiProgress) => void, signal?: AbortSignal): Promise<EmojiItem[]> {
  const detach = () => { if (onProgress) builtinProgressListeners.delete(onProgress); };
  if (onProgress && !signal?.aborted) { builtinProgressListeners.add(onProgress); onProgress(builtinProgress); }
  signal?.addEventListener('abort', detach, { once: true });
  try {
    if (!builtinLoad) {
      builtinLoad = (async () => {
        const unlisten = await listen<BuiltinEmojiProgress>('builtin-emoji-progress', event => publishBuiltinProgress({
          ...event.payload, downloaded: Math.max(builtinProgress.downloaded, event.payload.downloaded),
        }));
        try {
          try {
            const items = await invoke<NativeBuiltinEmoji[]>('sync_builtin_emoji');
            publishBuiltinProgress({ downloaded: items.length, total: items.length });
            return items;
          } catch (error) {
            publishBuiltinProgress({ ...builtinProgress, error: String(error) });
            throw error;
          }
        } finally { unlisten(); }
      })().then((items) => items.map((item) => ({
      id: item.id,
      categoryId: 'builtin',
      name: item.name,
      mime: 'image/gif',
      dataUrl: convertFileSrc(item.path),
      createdAt: 0,
      builtin: true,
      }))).catch(error => { builtinLoad = null; throw error; });
    }
    return await builtinLoad;
  } finally {
    detach();
    signal?.removeEventListener('abort', detach);
  }
}

export async function getEmojiItems(): Promise<EmojiItem[]> {
  const custom = await allCustom();
  const builtin = await syncBuiltinEmojiItems().catch(() => []);
  return [...builtin, ...custom].sort((a, b) => b.createdAt - a.createdAt);
}

export const getCustomEmojiItems = allCustom;

export async function importEmojiFiles(files: Iterable<File>, categoryId = 'custom'): Promise<number> {
  const existing = await allCustom();
  let imported = 0;
  for (const file of files) {
    if (existing.length + imported >= MAX_CUSTOM_ITEMS) break;
    try {
      const dataUrl = await fileToChatImageDataUrl(file);
      await put({ id: uid('emoji'), categoryId, name: file.name.slice(0, 80), mime: dataUrl.slice(5, dataUrl.indexOf(';')), dataUrl, createdAt: Date.now() + imported });
      imported += 1;
    } catch {
      // Invalid and oversized files are skipped so a batch can continue.
    }
  }
  return imported;
}

export async function addDataUrlAsEmoji(dataUrl: string, categoryId = 'custom', name = '聊天图片'): Promise<EmojiItem> {
  if ((await allCustom()).length >= MAX_CUSTOM_ITEMS) throw new Error('EMOJI_CAPACITY');
  const response = await fetch(dataUrl);
  const normalized = await fileToChatImageDataUrl(await response.blob());
  const item = { id: uid('emoji'), categoryId, name, mime: normalized.slice(5, normalized.indexOf(';')), dataUrl: normalized, createdAt: Date.now() };
  await put(item);
  return item;
}

export function getRecentEmojiIds(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]; } catch { return []; }
}

export function rememberRecentEmoji(id: string) {
  localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...getRecentEmojiIds().filter((item) => item !== id)].slice(0, MAX_RECENT)));
}
