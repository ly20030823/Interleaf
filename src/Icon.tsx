import type { CSSProperties } from 'react';
const paths: Record<string, string[]> = {
  book: ['M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z', 'M13 7a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3'],
  grid: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  folder: ['M3 7V5h6l2 2h10v13H3z'], plus: ['M12 5v14M5 12h14'], search: ['M21 21l-5-5', 'M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0'],
  upload: ['M12 16V3M7 8l5-5 5 5', 'M4 14v6h16v-6'], down: ['M12 3v13M7 11l5 5 5-5', 'M4 17v4h16v-4'],
  arrow: ['M19 12H5M11 6l-6 6 6 6'], chevron: ['m9 5 7 7-7 7'], check: ['m5 12 4 4L19 6'], close: ['M6 6l12 12M18 6 6 18'],
  clock: ['M12 7v5l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'], settings: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8', 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z'],
  file: ['M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h6'], quote: ['M4 13h6v7H3v-7c0-4 2-6 6-7M15 13h6v7h-7v-7c0-4 2-6 6-7'],
  translate: ['M3 5h12M9 3v2M6 5c0 6 6 9 9 10M12 5c0 6-6 9-9 10', 'm13 21 4-10 4 10M15 17h4'], highlighter: ['m4 15 11-11 5 5L9 20H4zM3 22h10'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'], trash: ['M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  edit: ['m15 3 6 6-12 12H3v-6zM12 6l6 6'], columns: ['M3 4h18v16H3zM9 4v16M15 4v16'], tag: ['M3 3h8l10 10-8 8L3 11zM7 7h.01'],
  spark: ['m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2z'], eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
};
export function Icon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{(paths[name] || paths.file).map((d, i) => <path key={i} d={d} />)}</svg>; }
