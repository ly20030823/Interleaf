export type Status = 'unread' | 'reading' | 'read';
export interface NoteField { id: string; label: string }
export interface Folder { id: string; name: string; parentId: string | null }
export interface Rect { page: number; x: number; y: number; w: number; h: number }
export interface Excerpt { id: string; text: string; translation?: string; page: number; rects: Rect[]; fieldId: string; createdAt: string; kind: 'quote' | 'highlight' }
export interface Paper {
  id: string; fileKey: string; fileName: string; title: string; authors: string; year: string; venue: string;
  status: Status; folderIds: string[]; tags: string; notes: Record<string, string>; excerpts: Excerpt[];
  addedAt: string; updatedAt: string; readAt: string | null; page: number;
}
export interface Settings { googleHost: 'google' | 'googleapi'; autoTranslate: boolean; targetLanguage: 'zh-CN' | 'zh-TW'; proxy: string; translationModeVersion?: 1 }
export interface Library { version: 1; papers: Paper[]; folders: Folder[]; fields: NoteField[]; settings: Settings }
export const DEFAULT_FIELDS: NoteField[] = [
  { id: 'question', label: '研究问题' }, { id: 'contribution', label: '主要贡献' },
  { id: 'method', label: '核心方法' }, { id: 'results', label: '实验与结果' },
  { id: 'limitations', label: '局限与不足' }, { id: 'ideas', label: '对我的启发' }, { id: 'free', label: '自由笔记' },
];
export const STATUS_LABEL: Record<Status, string> = { unread: '待读', reading: '阅读中', read: '已读' };
export function emptyLibrary(): Library { return { version: 1, papers: [], folders: [], fields: DEFAULT_FIELDS.map(f => ({ ...f })), settings: { googleHost: 'googleapi', autoTranslate: true, targetLanguage: 'zh-CN', proxy: '', translationModeVersion: 1 } }; }
export function newPaper(file: { fileKey: string; fileName: string }): Paper {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), ...file, title: file.fileName.replace(/\.pdf$/i, ''), authors: '', year: '', venue: '', status: 'unread', folderIds: [], tags: '', notes: {}, excerpts: [], addedAt: now, updatedAt: now, readAt: null, page: 1 };
}
export function normalizeSelection(text: string): string { return text.replace(/([a-zA-Z])-\s*\r?\n\s*([a-zA-Z])/g, '$1$2').replace(/\s+/g, ' ').trim(); }
export function descendantIds(folders: Folder[], id: string): Set<string> {
  const ids = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); changed = true; } }
  return ids;
}
function cell(value: string): string { return '"' + value.replace(/"/g, '""').replace(/^[=+@-]/, "'$&") + '"'; }
export function exportCsv(papers: Paper[], library: Library): string {
  const head = ['论文标题', '作者', '年份', '会议 / 期刊', '状态', '分类', '标签', '读完日期', ...library.fields.map(f => f.label)];
  return '\uFEFF' + [head, ...papers.map(p => [p.title, p.authors, p.year, p.venue, STATUS_LABEL[p.status], p.folderIds.map(id => library.folders.find(f => f.id === id)?.name || '').filter(Boolean).join('；'), p.tags, p.readAt?.slice(0, 10) || '', ...library.fields.map(f => p.notes[f.id] || '')])].map(row => row.map(cell).join(',')).join('\r\n');
}
export function exportMarkdown(paper: Paper, library: Library): string {
  return `# ${paper.title}\n\n${[paper.authors, paper.year, paper.venue].filter(Boolean).join(' · ')}\n\n` + library.fields.map(f => `## ${f.label}\n\n${paper.notes[f.id] || ''}\n\n` + paper.excerpts.filter(e => e.fieldId === f.id).map(e => `> ${e.text.replace(/\n/g, '\n> ')}\n\n${e.translation ? e.translation + '\n\n' : ''}来源：PDF 第 ${e.page} 页\n\n`).join('')).join('');
}
export function validateLibrary(input: unknown): Library {
  const x = input as Library;
  const str = (v: unknown) => typeof v === 'string';
  if (!x || x.version !== 1 || !Array.isArray(x.papers) || !Array.isArray(x.folders) || !Array.isArray(x.fields) || !x.settings) throw new Error('这不是有效的纸间备份。');
  if (!x.fields.length || x.fields.some(f => !f || !str(f.id) || !str(f.label) || !f.label.trim())) throw new Error('笔记栏目格式不正确。');
  if (new Set(x.fields.map(f => f.id)).size !== x.fields.length || new Set(x.folders.map(f => f?.id)).size !== x.folders.length || new Set(x.papers.map(p => p?.id)).size !== x.papers.length) throw new Error('备份中存在重复记录编号。');
  if (x.folders.some(f => !f || !str(f.id) || !str(f.name) || (f.parentId !== null && !str(f.parentId)))) throw new Error('分类格式不正确。');
  for (const f of x.folders) { const visited = new Set([f.id]); let parent = f.parentId; while (parent) { if (visited.has(parent)) throw new Error('分类不能循环嵌套。'); visited.add(parent); const found = x.folders.find(a => a.id === parent); if (!found) throw new Error('分类的上级不存在。'); parent = found.parentId; } }
  for (const p of x.papers) {
    if (!p || ![p.id, p.fileKey, p.fileName, p.title, p.authors, p.year, p.venue, p.tags, p.addedAt, p.updatedAt].every(str) || !/^[a-f0-9]{64}$/.test(p.fileKey) || !['unread', 'reading', 'read'].includes(p.status) || !Array.isArray(p.folderIds) || p.folderIds.some(id => !x.folders.some(f => f.id === id)) || !p.notes || typeof p.notes !== 'object' || Object.values(p.notes).some(v => !str(v)) || !Array.isArray(p.excerpts) || !Number.isInteger(p.page) || p.page < 1 || (p.readAt !== null && !str(p.readAt))) throw new Error('论文记录格式不正确。');
    for (const e of p.excerpts) if (!e || ![e.id, e.text, e.fieldId, e.createdAt].every(str) || (e.translation !== undefined && !str(e.translation)) || !['quote', 'highlight'].includes(e.kind) || !Number.isInteger(e.page) || e.page < 1 || !Array.isArray(e.rects) || e.rects.some(r => !r || !Number.isInteger(r.page) || r.page < 1 || ![r.x, r.y, r.w, r.h].every(n => Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error('摘录位置格式不正确。');
  }
  if (!['google', 'googleapi'].includes(x.settings.googleHost) || !['zh-CN', 'zh-TW'].includes(x.settings.targetLanguage) || typeof x.settings.autoTranslate !== 'boolean' || !str(x.settings.proxy)) throw new Error('翻译设置格式不正确。');
  return { ...x, settings: { ...x.settings, autoTranslate: x.settings.translationModeVersion === 1 ? x.settings.autoTranslate : true, translationModeVersion: 1 } };
}
