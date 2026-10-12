// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import PdfReader from './PdfReader';
import { emptyLibrary, newPaper } from './domain';
import { readPdf, translate } from './storage';

vi.mock('./storage', () => ({ readPdf: vi.fn(), translate: vi.fn() }));
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children, onLoadSuccess }: { children: ReactNode; onLoadSuccess: (pdf: unknown) => void }) => {
    useEffect(() => { onLoadSuccess({ numPages: 1, getOutline: async () => null, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800 }), getTextContent: async () => ({ items: [{ str: 'Research text' }] }) }) }); }, []);
    return <div>{children}</div>;
  },
  Page: () => <div className="react-pdf__Page__textContent"><span data-testid="first">First research passage.</span><span data-testid="second">Second research passage.</span></div>,
}));

let selectionRect: DOMRect;
const library = emptyLibrary();
const paper = newPaper({ fileKey: 'a'.repeat(64), fileName: 'example.pdf' });
const onExcerpt = vi.fn();
const props = { paper, settings: library.settings, fields: library.fields, onPage: vi.fn(), onExcerpt, jump: null, onError: vi.fn() };
async function openReader() {
  const result = render(<PdfReader {...props} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(110); });
  return result;
}
async function selectText(id: 'first' | 'second') {
  const range = document.createRange();
  range.selectNodeContents(screen.getByTestId(id));
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.mocked(readPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  vi.mocked(translate).mockResolvedValue('中文译文内容');
  selectionRect = new DOMRect(160, 180, 180, 20);
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: (entries: unknown[]) => void) {} observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} });
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: (entries: unknown[]) => void) {} observe() { this.callback([{ contentRect: { width: 600 } }]); } disconnect() {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId || 1; } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('selection-popover') ? new DOMRect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, 355, 360) : new DOMRect(100, 100, 600, 800);
  });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [selectionRect] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => selectionRect });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => true });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reading selection translation', () => {
  it('translates after pointer selection finishes, deduplicating selection events', async () => {
    await openReader();
    fireEvent.pointerDown(screen.getByTestId('first'), { button: 0, pointerId: 1 });
    await selectText('first');
    expect(translate).not.toHaveBeenCalled();
    fireEvent.pointerUp(document, { pointerId: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(translate).toHaveBeenCalledExactlyOnceWith('First research passage.', library.settings);
    expect(screen.getByText('中文译文内容')).toBeTruthy();
    await selectText('first');
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('retains a dragged position across selections and excerpts, resetting when closed', async () => {
    await openReader(); await selectText('first');
    const dialog = screen.getByRole('dialog', { name: '选区翻译' });
    const originalPosition = [dialog.style.left, dialog.style.top];
    const titlebar = dialog.querySelector('.translation-titlebar')!;
    fireEvent.pointerDown(titlebar, { button: 0, pointerId: 7, clientX: 180, clientY: 215 });
    fireEvent.pointerMove(titlebar, { pointerId: 7, clientX: 470, clientY: 390 });
    fireEvent.pointerUp(titlebar, { pointerId: 7 });
    const pinned = [dialog.style.left, dialog.style.top];
    expect(pinned).not.toEqual(originalPosition);
    expect(screen.getByText('位置已固定 · 拖动移动')).toBeTruthy();
    selectionRect = new DOMRect(240, 270, 180, 20);
    await selectText('second');
    expect([dialog.style.left, dialog.style.top]).toEqual(pinned);
    fireEvent.click(screen.getByRole('button', { name: '摘录' }));
    expect(onExcerpt).toHaveBeenCalledWith(expect.objectContaining({ text: 'Second research passage.', translation: '中文译文内容', kind: 'quote' }));
    expect(screen.getByRole('dialog', { name: '选区翻译' })).toBe(dialog);
    fireEvent.click(screen.getByTitle('关闭浮窗'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await selectText('second');
    const reopened = screen.getByRole('dialog', { name: '选区翻译' });
    expect([reopened.style.left, reopened.style.top]).not.toEqual(pinned);
    expect(screen.getByText('拖动标题栏移动')).toBeTruthy();
  });

  it('ignores stale results and pending requests after closing', async () => {
    const first = deferred(); const second = deferred(); const third = deferred();
    vi.mocked(translate).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    await openReader(); await selectText('first'); await selectText('second');
    await act(async () => { second.resolve('第二段译文'); });
    await act(async () => { first.resolve('过期译文'); });
    expect(screen.getByText('第二段译文')).toBeTruthy();
    expect(screen.queryByText('过期译文')).toBeNull();
    await selectText('first');
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { third.resolve('关闭后返回的译文'); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps PDF and zoom mounted when hidden while dismissing the popup', async () => {
    const result = await openReader();
    fireEvent.click(screen.getByTitle('放大')); await selectText('first');
    result.rerender(<PdfReader {...props} visible={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(result.container.querySelector('.reader')?.hasAttribute('hidden')).toBe(true);
    result.rerender(<PdfReader {...props} visible />);
    expect(screen.getByText('110%')).toBeTruthy();
    expect(readPdf).toHaveBeenCalledTimes(1);
    await selectText('second');
    expect(screen.getByText('拖动标题栏移动')).toBeTruthy();
  });
});
