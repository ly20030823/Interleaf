// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { emptyLibrary, newPaper } from './domain';
import { loadLibrary, saveLibrary } from './storage';

vi.mock('./storage', () => ({ desktop: false, loadLibrary: vi.fn(), saveLibrary: vi.fn(), backup: vi.fn(), restore: vi.fn(), exportText: vi.fn(), importFiles: vi.fn() }));
vi.mock('./PdfReader', () => ({ default: ({ visible }: { visible: boolean }) => <div className="reader" hidden={!visible}><input aria-label="阅读状态占位" defaultValue="阅读位置" /></div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('previews formulas while keeping the original LaTeX editable and saved verbatim', async () => {
  const library = emptyLibrary();
  const original = String.raw`总损失：\(\mathcal{L}=\mathcal{L}^{(DI)}+\mathcal{L}^{(AD)}+\mathcal{L}^{(RE)}\)`;
  library.papers.push({ ...newPaper({ fileKey: 'a'.repeat(64), fileName: 'Formula example.pdf' }), status: 'reading', notes: { method: original } });
  vi.mocked(loadLibrary).mockResolvedValue(library);
  vi.mocked(saveLibrary).mockResolvedValue();
  const result = render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByText('Formula example'));
  fireEvent.click(screen.getByRole('button', { name: '预览笔记' }));
  expect(result.container.querySelector('.katex')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '编辑笔记' }));
  expect((screen.getByLabelText('核心方法') as HTMLTextAreaElement).value).toBe(original);
  await act(async () => { fireEvent.keyDown(document, { ctrlKey: true, key: 's' }); });
  expect(vi.mocked(saveLibrary).mock.lastCall?.[0].papers[0].notes.method).toBe(original);
});

it('switches between PDF-only, notes-only and split view without losing notes or mounted state', async () => {
  const library = emptyLibrary();
  library.papers.push({ ...newPaper({ fileKey: 'a'.repeat(64), fileName: 'Panel example.pdf' }), status: 'reading' });
  vi.mocked(loadLibrary).mockResolvedValue(library);
  vi.mocked(saveLibrary).mockResolvedValue();
  const result = render(<App />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.doubleClick(screen.getByText('Panel example'));
  const notes = result.container.querySelector<HTMLElement>('.notes-pane')!;
  const notesScroll = result.container.querySelector<HTMLElement>('.notes-scroll')!;
  const pdf = result.container.querySelector<HTMLElement>('.reader')!;
  const pdfState = screen.getByLabelText('阅读状态占位') as HTMLInputElement;
  pdfState.value = '第 8 页 · 125%'; notesScroll.scrollTop = 320;
  fireEvent.change(screen.getByLabelText('研究问题'), { target: { value: '我自己填写的研究问题' } });
  const notesButton = screen.getByRole('button', { name: '笔记面板' });
  const pdfButton = screen.getByRole('button', { name: '原文面板' });
  fireEvent.click(notesButton);
  expect(notes.hidden).toBe(true); expect(pdf.hidden).toBe(false);
  expect(result.container.querySelector('[role="separator"]')).toBeNull();
  fireEvent.click(pdfButton);
  expect(notes.hidden).toBe(false); expect(pdf.hidden).toBe(true);
  expect(notes.style.width).toBe('100%');
  expect((screen.getByLabelText('研究问题') as HTMLTextAreaElement).value).toBe('我自己填写的研究问题');
  fireEvent.click(pdfButton);
  expect(notes.hidden).toBe(false); expect(pdf.hidden).toBe(false);
  expect(notes.style.width).toBe('36%');
  expect(notesScroll.scrollTop).toBe(320);
  expect(screen.getByLabelText('阅读状态占位')).toBe(pdfState);
  expect(pdfState.value).toBe('第 8 页 · 125%');
  fireEvent.click(pdfButton); fireEvent.click(notesButton);
  expect(notes.hidden).toBe(true); expect(pdf.hidden).toBe(false);
});
