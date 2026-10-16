import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeNoteMath } from './noteMath';

export default function NoteMarkdown({ text }: { text: string }) {
  const source = useMemo(() => normalizeNoteMath(text), [text]);
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, strict: false, maxExpand: 1000, maxSize: 20 }]]}>{source || '*尚未记录*'}</ReactMarkdown></div>;
}
