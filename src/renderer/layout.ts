// WebModel → Excalidraw element skeletons. Rebuilt on every model change; ids are stable so the
// canvas can merge updates in place (ghost slot → filled fragment) without disturbing user edits.
//
// Layout: KB source cards in a left column; a seed box on top; one column per cluster below it
// (header box = edge anchor, then fragment slots). Edges are labeled arrows between headers.

import { clip, clusterLabel, fragmentLook, FRAG_H, FRAG_W, GAP, HEADER_H, typeColors, wrap, edgeLabel } from './boxes';
import { cssVar } from './theme';
import type { WebModel } from './webModel';

export { FRAG_H, FRAG_W };
const SEED_H = 120;
const ARC_ROOM = 150; // space above the header row for arrows between non-adjacent clusters
const COL_GAP = 120;
const KB_H = 110;

type Skeleton = Record<string, unknown>;

export function buildSkeletons(m: WebModel): Skeleton[] {
  const out: Skeleton[] = [];
  const colCount = Math.max(m.clusters.length, 2);
  const totalW = colCount * FRAG_W + (colCount - 1) * COL_GAP;
  const clustersTop = SEED_H + 30 + ARC_ROOM;

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
      label: clusterLabel(cluster.title),
      customData: { kind: 'cluster', index: ci, title: cluster.title },
    });

    cluster.slots.forEach((frag, fi) => {
      const base = { type: 'rectangle', id: `frag-${ci}-${fi}`, x, y: clustersTop + HEADER_H + GAP + fi * (FRAG_H + GAP), width: FRAG_W, height: FRAG_H, roundness: null };
      if (!frag) {
        // Ghost slot: dashed outline, no text — shows where content will land.
        out.push({ ...base, strokeColor: 'rgba(0,0,0,0.25)', strokeStyle: 'dashed', backgroundColor: 'rgba(0,0,0,0.04)', fillStyle: 'solid' });
        return;
      }
      const look = fragmentLook(frag);
      out.push({
        ...base, strokeColor: 'transparent', backgroundColor: look.backgroundColor, fillStyle: 'solid',
        label: look.label,
        customData: { kind: 'fragment', cluster: ci, slot: fi, fragment: frag },
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
      ...(edge.label ? { label: edgeLabel(edge.label) } : {}),
    });
  });

  return out;
}
