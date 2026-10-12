import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Document, Page, pdfjs, type DocumentProps } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { Icon } from './Icon';
import { normalizeSelection, type Paper, type Rect, type Settings, type NoteField, type Excerpt } from './domain';
import { readPdf, translate } from './storage';
import { clampFloatingPosition, type Point } from './floatingWindow';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
type Selection = { text: string; page: number; rects: Rect[]; x: number; y: number };
type PDFDocumentProxy = Parameters<NonNullable<DocumentProps['onLoadSuccess']>>[0];
function escapeHtml(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }

function PdfPage({ number, width, ratio, scrollRoot, query, excerpts }: { number: number; width: number; ratio: number; scrollRoot: React.RefObject<HTMLDivElement | null>; query: string; excerpts: Excerpt[] }) {
  const ref = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(false);
  useEffect(() => { const io = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { root: scrollRoot.current, rootMargin: '1200px' }); if (ref.current) io.observe(ref.current); return () => io.disconnect(); }, [scrollRoot]);
  const renderText = ({ str }: { str: string }) => { if (!query.trim()) return escapeHtml(str); const pattern = new RegExp(`(${query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'); return str.split(pattern).map((s, i) => i % 2 ? `<mark>${escapeHtml(s)}</mark>` : escapeHtml(s)).join(''); };
  return <div ref={ref} data-page={number} className="pdf-page" style={{ width, minHeight: width / ratio }}>
    {visible ? <Page pageNumber={number} width={width} renderTextLayer renderAnnotationLayer customTextRenderer={renderText} loading={<div className="page-placeholder">第 {number} 页 · 正在加载</div>} /> : <div className="page-placeholder">第 {number} 页</div>}
    <div className="highlight-layer">{excerpts.flatMap(e => e.rects.filter(r => r.page === number).map((r, i) => <span key={`${e.id}-${i}`} className={e.kind === 'quote' ? 'quote-mark' : 'highlight-mark'} style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />))}</div>
  </div>;
}

export default function PdfReader({ paper, settings, fields, onPage, onExcerpt, jump, onError, visible = true }: {
  paper: Paper; settings: Settings; fields: NoteField[]; onPage: (page: number) => void; onExcerpt: (excerpt: Excerpt) => void;
  jump: { page: number; sequence: number; y?: number } | null; onError: (error: unknown) => void; visible?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null); const scroll = useRef<HTMLDivElement>(null); const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [data, setData] = useState<Blob | null>(null); const [error, setError] = useState(''); const [count, setCount] = useState(0);
  const [page, setPage] = useState(paper.page); const [pageInput, setPageInput] = useState(String(paper.page)); const [zoom, setZoom] = useState(1); const [width, setWidth] = useState(700); const [ratio, setRatio] = useState(0.707);
  const [query, setQuery] = useState(''); const [texts, setTexts] = useState<string[]>([]); const [indexing, setIndexing] = useState(false); const [outline, setOutline] = useState<{ title: string; page: number }[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null); const [translation, setTranslation] = useState(''); const [translating, setTranslating] = useState(false); const [translateError, setTranslateError] = useState('');
  const popup = useRef<HTMLDivElement>(null);
  const [pinnedPosition, setPinnedPosition] = useState<Point | null>(null);
  const [popupSize, setPopupSize] = useState({ width: 355, height: 260 });
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);
  const capturedKey = useRef('');
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fieldId, setFieldId] = useState(fields[0]?.id || 'free'); const translationSequence = useRef(0); const latestSettings = useRef(settings); latestSettings.current = settings;
  const initialPage = useRef(paper.page); const [reload, setReload] = useState(0);
  useEffect(() => { let cancelled = false; setData(null); setError(''); readPdf(paper.fileKey).then(bytes => { if (!cancelled) setData(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })); }).catch(e => { if (!cancelled) setError(String(e)); }); return () => { cancelled = true; translationSequence.current++; }; }, [paper.fileKey, reload]);
  useEffect(() => { const el = root.current; if (!el) return; const ro = new ResizeObserver(entries => { if (entries[0].contentRect.width > 0) setWidth(Math.max(280, entries[0].contentRect.width - 56)); }); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useLayoutEffect(() => { if (!selection || !popup.current) return; const measure = () => { const box = popup.current?.getBoundingClientRect(); if (box) setPopupSize(previous => previous.width === box.width && previous.height === box.height ? previous : { width: box.width, height: box.height }); }; measure(); const observer = new ResizeObserver(measure); observer.observe(popup.current); return () => observer.disconnect(); }, [selection !== null]);
  useEffect(() => { if (!visible) close(); }, [visible]);
  useEffect(() => { if (!fields.some(f => f.id === fieldId)) setFieldId(fields[0]?.id || 'free'); }, [fields, fieldId]);
  // Blob remains reusable when PDF.js transfers its own copy to the worker.
  const file = data || undefined;
  const matches = useMemo(() => { const needle = query.trim().toLowerCase(); return needle ? texts.flatMap((t, i) => t.toLowerCase().includes(needle) ? [i + 1] : []) : []; }, [query, texts]);
  function goTo(next: number, y = 0) { const n = Math.max(1, Math.min(next, count || next)); const container = scroll.current; const target = container?.querySelector<HTMLElement>(`[data-page="${n}"]`); if (container && target) container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top + y * target.getBoundingClientRect().height - 50; setPage(n); setPageInput(String(n)); onPage(n); }
  useEffect(() => { if (count) { const timeout = setTimeout(() => goTo(initialPage.current), 100); return () => clearTimeout(timeout); } }, [count]);
  useEffect(() => { if (jump && count) goTo(jump.page, jump.y); }, [jump, count]);
  useEffect(() => { setPageInput(String(page)); }, [page]);
  const onLoad: DocumentProps['onLoadSuccess'] = async pdf => {
    pdfRef.current = pdf; setCount(pdf.numPages); setIndexing(true);
    try { const first = await pdf.getPage(1); const v = first.getViewport({ scale: 1 }); setRatio(v.width / v.height);
      const entries = await pdf.getOutline(); const items: { title: string; page: number }[] = [];
      async function walk(list: NonNullable<typeof entries>, depth: number) { for (const item of list) { try { const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest; if (dest) { const num = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0]); items.push({ title: '　'.repeat(Math.min(depth, 3)) + item.title, page: num + 1 }); } } catch { /* Broken PDF bookmarks must not prevent reading. */ } if (item.items.length) await walk(item.items, depth + 1); } }
      if (entries) await walk(entries, 0); if (pdfRef.current !== pdf) return; setOutline(items);
      const all: string[] = []; for (let i = 1; i <= pdf.numPages; i++) { if (pdfRef.current !== pdf) return; const content = await (await pdf.getPage(i)).getTextContent(); all.push(normalizeSelection(content.items.map(item => 'str' in item ? item.str : '').join(' '))); }
      if (pdfRef.current === pdf) setTexts(all);
    } catch { /* PDF rendering remains available when text indexing fails. */ } finally { if (pdfRef.current === pdf) setIndexing(false); }
  };
  async function doTranslate(value: Selection) {
    const seq = ++translationSequence.current; setTranslating(true); setTranslateError(''); setTranslation('');
    try { const result = await translate(value.text, latestSettings.current); if (seq === translationSequence.current) setTranslation(result); }
    catch (e) { if (seq === translationSequence.current) setTranslateError(String(e)); }
    finally { if (seq === translationSequence.current) setTranslating(false); }
  }
  function capture() {
    const sel = window.getSelection(); if (!sel?.rangeCount || sel.isCollapsed || !root.current) return;
    const range = sel.getRangeAt(0); const start = sel.anchorNode?.parentElement; const end = sel.focusNode?.parentElement;
    if (!start?.closest('.react-pdf__Page__textContent') || !end?.closest('.react-pdf__Page__textContent') || !root.current.contains(start) || !root.current.contains(end)) return;
    const text = normalizeSelection(sel.toString()); if (!text) return;
    const rects: Rect[] = []; const pages = root.current.querySelectorAll<HTMLElement>('.pdf-page');
    for (const rect of range.getClientRects()) { if (rect.width < 1 || rect.height < 1) continue; for (const el of pages) { const box = el.getBoundingClientRect(); const left = Math.max(rect.left, box.left); const top = Math.max(rect.top, box.top); const right = Math.min(rect.right, box.right); const bottom = Math.min(rect.bottom, box.bottom); if (right <= left || bottom <= top) continue; const r = { page: Number(el.dataset.page), x: (left - box.left) / box.width, y: (top - box.top) / box.height, w: (right - left) / box.width, h: (bottom - top) / box.height }; if (!rects.some(a => a.page === r.page && Math.abs(a.x - r.x) < 0.001 && Math.abs(a.y - r.y) < 0.001 && Math.abs(a.w - r.w) < 0.001)) rects.push(r); } }
    const box = range.getBoundingClientRect(); const bounds = root.current.getBoundingClientRect(); const value = { text, page: rects[0]?.page || page, rects, x: Math.max(bounds.left + 12, Math.min(box.left, bounds.right - 370)), y: Math.max(bounds.top + 65, Math.min(box.bottom + 12, window.innerHeight - 360)) };
    const key = JSON.stringify([text, value.page, rects]);
    if (key === capturedKey.current) return;
    capturedKey.current = key;
    translationSequence.current++; setTranslating(false); setTranslation(''); setTranslateError(''); setSelection(value); if (latestSettings.current.autoTranslate) void doTranslate(value);
  }
  function add(kind: Excerpt['kind']) { if (!selection) return; onExcerpt({ id: crypto.randomUUID(), text: selection.text, ...(translation ? { translation } : {}), page: selection.page, rects: selection.rects, fieldId, createdAt: new Date().toISOString(), kind }); }
  function close() { translationSequence.current++; if (captureTimer.current) clearTimeout(captureTimer.current); capturedKey.current = ''; drag.current = null; setDragging(false); setPinnedPosition(null); setSelection(null); setTranslating(false); setTranslation(''); setTranslateError(''); window.getSelection()?.removeAllRanges(); }
  const popupPosition = selection ? clampFloatingPosition(pinnedPosition || selection, popupSize, viewport) : { x: 8, y: 8 };
  function beginDrag(event: PointerEvent<HTMLDivElement>) { if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return; event.preventDefault(); event.stopPropagation(); if (captureTimer.current) clearTimeout(captureTimer.current); drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: popupPosition }; setPinnedPosition(popupPosition); setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }
  function moveDrag(event: PointerEvent<HTMLDivElement>) { const current = drag.current; if (!current || event.pointerId !== current.pointerId) return; setPinnedPosition(clampFloatingPosition({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y }, popupSize, viewport)); }
  function endDrag(event: PointerEvent<HTMLDivElement>) { if (drag.current?.pointerId !== event.pointerId) return; drag.current = null; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  useEffect(() => {
    if (!visible) return;
    let selecting = false;
    const schedule = () => { if (captureTimer.current) clearTimeout(captureTimer.current); captureTimer.current = setTimeout(capture, 180); };
    const down = (event: globalThis.PointerEvent) => { const target = event.target instanceof HTMLElement ? event.target : null; selecting = !!target?.closest('.react-pdf__Page__textContent') && !!root.current?.contains(target); if (selecting && captureTimer.current) clearTimeout(captureTimer.current); };
    const up = () => { if (selecting) { selecting = false; schedule(); } };
    const changed = () => { if (!selecting && !drag.current) schedule(); };
    document.addEventListener('pointerdown', down); document.addEventListener('pointerup', up); document.addEventListener('selectionchange', changed);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('pointerup', up); document.removeEventListener('selectionchange', changed); if (captureTimer.current) clearTimeout(captureTimer.current); };
  }, [visible, page]);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); if (event.altKey && event.key.toLowerCase() === 't' && selection) { event.preventDefault(); void doTranslate(selection); } }; document.addEventListener('keydown', handle); return () => document.removeEventListener('keydown', handle); }, [selection]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function trackScroll() { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { if (!scroll.current) return; const top = scroll.current.getBoundingClientRect().top + 80; const els = [...scroll.current.querySelectorAll<HTMLElement>('[data-page]')]; const el = els.find(e => e.getBoundingClientRect().bottom > top); if (el) { const n = Number(el.dataset.page); setPage(n); onPage(n); } }, 180); }
  useEffect(() => () => { pdfRef.current = null; if (timer.current) clearTimeout(timer.current); }, []);
  return <div className="reader" ref={root} hidden={!visible}>
    <div className="pdf-tools">
      <div className="pdf-page-control"><button title="上一页" disabled={page <= 1} onClick={() => goTo(page - 1)}><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} size={15} /></button><input aria-label="PDF 页码" value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={() => goTo(Number(pageInput) || 1)} onKeyDown={e => { if (e.key === 'Enter') goTo(Number(pageInput) || 1); }} /><span>/ {count || '—'}</span><button title="下一页" disabled={page >= count} onClick={() => goTo(page + 1)}><Icon name="chevron" size={15} /></button></div>
      <span className="tool-separator" /><button title="缩小" onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}>−</button><button className="zoom" title="恢复适合宽度" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button><button title="放大" onClick={() => setZoom(z => Math.min(2.5, z + 0.1))}>＋</button>
      {outline.length > 0 && <select aria-label="PDF 目录" className="outline" value="" onChange={e => goTo(Number(e.target.value))}><option value="">目录</option>{outline.map((o, i) => <option key={i} value={o.page}>{o.title}</option>)}</select>}
      <div className="pdf-search"><Icon name="search" size={15} /><input aria-label="搜索原文" placeholder="搜索原文" value={query} onChange={e => setQuery(e.target.value)} />{query && <button title="下一个匹配页面" onClick={() => goTo(matches.find(n => n > page) || matches[0] || page)}>{indexing ? '…' : `${matches.length} 页`} <Icon name="chevron" size={12} /></button>}</div>
    </div>
    <div className="pdf-scroll" ref={scroll} onScroll={trackScroll}>
      {error ? <div className="pdf-error"><Icon name="file" size={32} /><h3>原文暂时无法打开</h3><p>{error}</p><button className="button" onClick={() => setReload(n => n + 1)}>重新打开</button></div> : !file ? <div className="loading">正在打开原文…</div> : <Document file={file} onLoadSuccess={onLoad} onLoadError={e => setError(e.message)} onItemClick={({ pageNumber }) => goTo(pageNumber || 1)} loading={<div className="loading">正在解析论文…</div>} error={<div className="loading">无法解析 PDF，请检查原件。</div>}><div className="pdf-pages">{Array.from({ length: count }, (_, i) => <PdfPage key={i} number={i + 1} width={width * zoom} ratio={ratio} scrollRoot={scroll} query={query} excerpts={paper.excerpts} />)}</div></Document>}
    </div>
    <div className="pdf-foot"><span>PDF 原文 · {paper.fileName}</span><span>{texts.length > 0 && texts.every(t => !t) ? '此 PDF 没有可选文字，需先进行 OCR' : '选中文字可翻译、摘录或高亮'}</span></div>
    {visible && selection && createPortal(<div ref={popup} role="dialog" aria-label="选区翻译" className={`selection-popover ${dragging ? 'dragging' : ''}`} style={{ left: popupPosition.x, top: popupPosition.y }} onMouseDown={e => e.stopPropagation()}>
      <div className="translation-titlebar" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}><Icon name="translate" size={16} /><strong>划词翻译</strong><span>{pinnedPosition ? '位置已固定 · 拖动移动' : '拖动标题栏移动'}</span><button className="icon-button" title="关闭浮窗" onClick={close}><Icon name="close" size={15} /></button></div>
      <div className="selection-body">
      <div className="selection-actions"><button disabled={translating} onClick={() => void doTranslate(selection)}><Icon name="translate" size={16} />{translating ? '翻译中…' : translation ? '重新翻译' : '翻译'}</button><button onClick={() => add('quote')}><Icon name="quote" size={15} />摘录</button><button onClick={() => add('highlight')}><Icon name="highlighter" size={16} />高亮</button></div>
      <p className="selection-original">{selection.text}</p>
      {translating && <p className="translation-loading">正在翻译选中的文字…</p>}
      {translateError && <div className="translation-error">{translateError}<button onClick={() => void doTranslate(selection)}>重试</button></div>}
      {translation && <div className="translation-result"><span className="eyebrow">中文译文</span><p>{translation}</p><button onClick={() => void navigator.clipboard.writeText(translation).catch(onError)}>复制译文</button></div>}
      <div className="selection-destination"><span>保存至</span><select aria-label="摘录保存栏目" value={fieldId} onChange={e => setFieldId(e.target.value)}>{fields.map(f => <option value={f.id} key={f.id}>{f.label}</option>)}</select><span>第 {selection.page} 页</span></div>
      </div>
    </div>, document.body)}
  </div>;
}
