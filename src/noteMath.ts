import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';

const parser = unified().use(remarkParse).use(remarkMath);
type SyntaxNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: SyntaxNode[] };
const literalNodes = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'link', 'image', 'html', 'definition']);

function escaped(text: string, index: number) {
  let slashes = 0;
  while (index > 0 && text[--index] === '\\') slashes++;
  return slashes % 2 === 1;
}

function convert(text: string) {
  let output = ''; let copied = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== '\\' || escaped(text, i) || !['(', '['].includes(text[i + 1])) continue;
    const display = text[i + 1] === '[';
    const closing = display ? '\\]' : '\\)';
    let end = text.indexOf(closing, i + 2);
    while (end >= 0 && escaped(text, end)) end = text.indexOf(closing, end + 2);
    if (end < 0) continue;
    const math = text.slice(i + 2, end).trim();
    if (!math || (!display && /\n\s*\n/.test(math))) continue;
    output += text.slice(copied, i) + (display ? `\n$$\n${math}\n$$\n` : `$${math}$`);
    copied = end + 2; i = end + 1;
  }
  output += text.slice(copied);
  // Older pasted notes sometimes contain a whole formula in plain parentheses.
  return output.replace(/^([ \t]*)\((\\(?:mathcal|mathrm|mathbf|frac|sqrt|sum|prod|int|alpha|beta|gamma|delta|theta|lambda|sigma|omega)\b[^\n]*)\)[ \t]*$/gm,
    (_, indent: string, math: string) => `${indent}$(${math})$`);
}

/** Normalize only for rendering; stored notes and Markdown exports keep their original source. */
export function normalizeNoteMath(source: string): string {
  if (!/\\[([a-zA-Z]/.test(source)) return source;
  const ranges: { start: number; end: number }[] = [];
  function collect(node: SyntaxNode) {
    if (literalNodes.has(node.type) && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      ranges.push({ start: node.position.start.offset, end: node.position.end.offset }); return;
    }
    node.children?.forEach(collect);
  }
  collect(parser.parse(source));
  ranges.sort((a, b) => a.start - b.start);
  let result = ''; let cursor = 0;
  for (const range of ranges) { result += convert(source.slice(cursor, range.start)) + source.slice(range.start, range.end); cursor = range.end; }
  return result + convert(source.slice(cursor));
}
