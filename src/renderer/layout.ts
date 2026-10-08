// WebModel → Excalidraw element skeletons. Rebuilt on every model change; ids are stable so the
// canvas can merge updates in place (ghost slot → filled fragment) without disturbing user edits.
//
// Layout: KB source cards in a left column; a seed box on top; one column per cluster below it
// (header box = edge anchor, then fragment slots). Edges are labeled arrows between headers.

import type { FragmentType } from '../types/fragments';
import type { WebModel } from './webModel';

export const FRAG_W = 280;
export const FRAG_H = 150;
const HEADER_H = 48;
const SEED_H = 120;
const GAP = 24;
const COL_GAP = 120;
const KB_H = 110;

type Skeleton = Record<string, unknown>;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function typeColors(type: FragmentType): { bg: string; text: string } {
  return {
    bg: cssVar(`--color-fragment-${type}-bg`, '#ffffff'),
    text: cssVar(`--color-fragment-${type}-text`, '#0a0a0a'),
  };
}

function wrap(text: string, max: number): string {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars - 1).trimEnd() + '…' : text;
}

export function buildSkeletons(m: WebModel): Skeleton[] {
  const out: Skeleton[] = [];
  const colCount = Math.max(m.clusters.length, 2);
  const totalW = colCount * FRAG_W + (colCount - 1) * COL_GAP;
  const clustersTop = SEED_H + GAP * 3;

  // Seed
  const seedBg = cssVar('--color-seed-bg', '#D2F34C');
  const seedText = cssVar('--color-seed-text', '#0a0a0a');
  const seedBody = m.context ? `\n\n${wrap(clip(m.context, 400), Math.floor(totalW / 8))}` : '';
  out.push({
    type: 'rectangle', id: 'seed', x: 0, y: 0, width: totalW, height: SEED_H + (m.context ? 30 : 0),
    strokeColor: 'transparent', backgroundColor: seedBg, fillStyle: 'solid', roundness: null,
    label: { fontFamily: 2, text: `${m.query.toUpperCase()}${seedBody}`, fontSize: 16, strokeColor: seedText, textAlign: 'left', verticalAlign: 'top' },
  });

  // KB source cards
  const src = typeColors('source');
  m.kb.forEach((p, i) => {
    out.push({
      type: 'rectangle', id: `kb-${i}`,
      x: -(FRAG_W + COL_GAP), y: i * (KB_H + GAP), width: FRAG_W, height: KB_H,
      strokeColor: 'transparent', backgroundColor: src.bg, fillStyle: 'solid', roundness: null,
      label: { fontFamily: 2, text: `KB · ${clip(p.source, 30)}\n\n${wrap(clip(p.text, 110), 36)}`, fontSize: 11, strokeColor: src.text, textAlign: 'left', verticalAlign: 'top' },
    });
  });

  // Clusters
  m.clusters.forEach((cluster, ci) => {
    const x = ci * (FRAG_W + COL_GAP);
    out.push({
      type: 'rectangle', id: `cluster-${ci}`, x, y: clustersTop, width: FRAG_W, height: HEADER_H,
      strokeColor: '#1a1a1a', backgroundColor: 'transparent', roundness: null,
      label: { fontFamily: 2, text: cluster.title.toUpperCase(), fontSize: 16, strokeColor: '#1a1a1a' },
    });

    cluster.slots.forEach((frag, fi) => {
      const base = { type: 'rectangle', id: `frag-${ci}-${fi}`, x, y: clustersTop + HEADER_H + GAP + fi * (FRAG_H + GAP), width: FRAG_W, height: FRAG_H, roundness: null };
      if (!frag) {
        // Ghost slot: dashed outline, no text — shows where content will land.
        out.push({ ...base, strokeColor: 'rgba(0,0,0,0.25)', strokeStyle: 'dashed', backgroundColor: 'rgba(0,0,0,0.04)', fillStyle: 'solid' });
        return;
      }
      const { bg, text } = typeColors(frag.type);
      const body = frag.type === 'quote' ? frag.body : clip(frag.body, 150);
      out.push({
        ...base, strokeColor: 'transparent', backgroundColor: bg, fillStyle: 'solid',
        label: { fontFamily: 2, text: `${frag.type.toUpperCase()}\n${frag.title}\n\n${wrap(body, 36)}`, fontSize: 12, strokeColor: text, textAlign: 'left', verticalAlign: 'top' },
      });
    });
  });

  // Edges
  m.edges.forEach((edge, i) => {
    if (!m.clusters[edge.source] || !m.clusters[edge.target]) return;
    out.push({
      type: 'arrow', id: `edge-${i}`, x: 0, y: 0,
      start: { id: `cluster-${edge.source}` }, end: { id: `cluster-${edge.target}` },
      strokeColor: '#1a1a1a',
      ...(edge.label ? { label: { fontFamily: 2, text: edge.label, fontSize: 14 } } : {}),
    });
  });

  return out;
}
