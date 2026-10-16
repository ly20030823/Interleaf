// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NoteMarkdown from './NoteMarkdown';
import { normalizeNoteMath } from './noteMath';

afterEach(cleanup);
const loss = String.raw`\mathcal L=\mathcal L^{(DI)}+\mathcal L^{(AD)}+\mathcal L^{(RE)}`;

describe('LaTeX note preview', () => {
  it('renders dollar and backslash inline and display formulas, including the reported loss equation', () => {
    const source = ['$' + loss + '$', '$$\n\\frac{a}{b}\n$$', String.raw`\(x_i^2 + \alpha\)`, String.raw`\[\begin{aligned}a&=b+c\\d&=e\end{aligned}\]`].join('\n\n');
    const { container } = render(<NoteMarkdown text={source} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(4);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(container.querySelector('.katex-error')).toBeNull();
    expect(container.querySelector('annotation')?.textContent).toBe(loss);
  });

  it('recognizes a legacy full-line parenthesized formula', () => {
    const source = '(' + loss + ')';
    const { container } = render(<NoteMarkdown text={source} />);
    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.querySelector('annotation')?.textContent).toBe(source);
  });

  it('preserves code examples, existing dollar formulas, escaped delimiters and unfinished input', () => {
    const source = [String.raw`示例：\`\(x^2\)\``, '```latex\n\\[x^2\\]\n```', '    ' + String.raw`\(x^2\)`, String.raw`$\text{保留 \( 原文}$`, String.raw`\\(不应成为公式\\)`, String.raw`未闭合 \(x^2`].join('\n\n');
    // Build a real Markdown code span, keeping the backslashes inside it literal.
    const codeSource = source.replaceAll('\\`', '`');
    expect(normalizeNoteMath(codeSource)).toBe(codeSource);
    const { container } = render(<NoteMarkdown text={codeSource} />);
    expect(container.querySelector('code')?.textContent).toBe(String.raw`\(x^2\)`);
  });

  it('keeps Markdown tables and lists and shows a bad formula without breaking the remaining note', () => {
    const { container } = render(<NoteMarkdown text={'| 符号 | 定义 |\n| --- | --- |\n| $x_i$ | 输入 |\n\n- [x] 已完成\n\n$\\notARealCommand{x}$\n\n后续笔记仍可阅读。'} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('input[type=checkbox]')).toBeTruthy();
    expect(container.querySelector('.katex')).toBeTruthy();
    expect(container.textContent).toContain('后续笔记仍可阅读。');
    expect(container.textContent).toContain('notARealCommand');
  });
});
