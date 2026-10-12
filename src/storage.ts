import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { emptyLibrary, validateLibrary, type Library, type Settings } from './domain';

export const desktop = isTauri();
let dbPromise: Promise<IDBDatabase> | undefined;
function db() { return dbPromise ||= new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('paper-journal', 1); r.onupgradeneeded = () => { r.result.createObjectStore('data'); r.result.createObjectStore('pdfs'); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function get<T>(store: string, key: string): Promise<T | undefined> { const d = await db(); return new Promise((resolve, reject) => { const r = d.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function put(store: string, key: string, data: unknown) { const d = await db(); return new Promise<void>((resolve, reject) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(data, key); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); }); }
export async function loadLibrary(): Promise<Library> { const data = desktop ? await invoke<Library | null>('load_library') : await get<Library>('data', 'library'); return data ? validateLibrary(data) : emptyLibrary(); }
let saveQueue: Promise<void> = Promise.resolve();
export function saveLibrary(library: Library): Promise<void> { const snapshot = JSON.parse(JSON.stringify(library)); const work = saveQueue.catch(() => {}).then(() => desktop ? invoke<void>('save_library', { library: snapshot }) : put('data', 'library', snapshot)); saveQueue = work; return work; }
export async function waitForSaves() { await saveQueue; }
async function fileKey(bytes: Uint8Array) { const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>); return Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function importFiles(files?: File[]): Promise<{ fileKey: string; fileName: string }[]> {
  if (desktop && !files) { const paths = await open({ multiple: true, filters: [{ name: 'PDF 论文', extensions: ['pdf'] }] }); if (!paths) return []; return invoke('import_pdfs', { paths: Array.isArray(paths) ? paths : [paths] }); }
  const result = [];
  for (const file of files || []) { if (file.size > 100 * 1024 * 1024) throw new Error('单篇 PDF 请控制在 100 MB 以内。'); const bytes = new Uint8Array(await file.arrayBuffer()); if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error(`${file.name} 不是有效的 PDF。`); const key = await fileKey(bytes); if (desktop) await invoke('import_pdf_bytes', { bytes: Array.from(bytes) }); else await put('pdfs', key, bytes); result.push({ fileKey: key, fileName: file.name }); }
  return result;
}
export async function readPdf(key: string): Promise<Uint8Array> { if (desktop) return new Uint8Array(await invoke<number[]>('read_pdf', { fileKey: key })); const result = await get<Uint8Array>('pdfs', key); if (!result) throw new Error('找不到 PDF 原件，请重新导入。'); return new Uint8Array(result); }
export async function translate(text: string, settings: Settings): Promise<string> {
  if (!text.trim() || text.length > 5000) throw new Error('一次请选择 1～5000 个字符。');
  if (desktop) return invoke('translate_google', { text, settings });
  const key = `translation:${settings.googleHost}:${settings.targetLanguage}:${text}`; const cached = await get<string>('data', key); if (cached) return cached;
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: settings.targetLanguage, dt: 't', q: text });
  const response = await fetch(`/translation/${settings.googleHost}?${params}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Google 暂时无法连接，请稍后重试或切换翻译源。');
  const json = await response.json(); const result = json?.[0]?.map((part: unknown[]) => typeof part?.[0] === 'string' ? part[0] : '').join('');
  if (!result) throw new Error('Google 没有返回译文，请重试。'); await put('data', key, result); return result;
}
export async function exportText(name: string, text: string) {
  if (desktop) { const path = await save({ defaultPath: name }); if (path) await invoke('write_export', { path, content: text }); }
  else download(name, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}
function download(name: string, blob: Blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function base64(bytes: Uint8Array) { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); }
export async function backup(library: Library) { await waitForSaves(); const name = `纸间备份-${new Date().toISOString().slice(0, 10)}.paperjournal`; if (desktop) { const path = await save({ defaultPath: name, filters: [{ name: '纸间完整备份', extensions: ['paperjournal'] }] }); if (path) await invoke('export_backup', { path }); } else { const pdfs: Record<string, string> = {}; for (const key of new Set(library.papers.map(p => p.fileKey))) pdfs[key] = base64(await readPdf(key)); download(name, new Blob([JSON.stringify({ format: 'paper-journal-backup', version: 1, library, pdfs })], { type: 'application/json' })); } }
export async function restore(file?: File): Promise<Library | null> {
  await waitForSaves();
  if (desktop && !file) { const path = await open({ multiple: false, filters: [{ name: '纸间完整备份', extensions: ['paperjournal'] }] }); if (!path) return null; return validateLibrary(await invoke('restore_backup', { path })); }
  if (!file) return null;
  const pack = JSON.parse(await file.text()); if (pack.format !== 'paper-journal-backup' || pack.version !== 1 || !pack.pdfs || typeof pack.pdfs !== 'object') throw new Error('备份文件格式不正确。'); const library = validateLibrary(pack.library);
  const attachments = new Map<string, Uint8Array>(); for (const key of new Set(library.papers.map(p => p.fileKey))) { if (typeof pack.pdfs[key] !== 'string') throw new Error('备份缺少论文原件。'); const bytes = Uint8Array.from(atob(pack.pdfs[key]), c => c.charCodeAt(0)); if (await fileKey(bytes) !== key || !new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('备份中的 PDF 校验失败。'); attachments.set(key, bytes); }
  if (desktop) throw new Error('桌面版请通过文件选择窗口恢复备份。');
  const d = await db(); await new Promise<void>((resolve, reject) => { const t = d.transaction(['data', 'pdfs'], 'readwrite'); for (const [key, bytes] of attachments) t.objectStore('pdfs').put(bytes, key); t.objectStore('data').put(library, 'library'); t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); }); return library;
}
