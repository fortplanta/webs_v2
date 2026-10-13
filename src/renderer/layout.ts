// WebModel → Excalidraw element skeletons. Rebuilt on every model change; ids are stable so the
// canvas can merge updates in place (ghost slot → filled fragment) without disturbing user edits.
//
// Layout (see layout/organic.ts): the topic in the middle, the notes it was built from in a ring around it, each
// collection a header on a wider ring with its cards fanned outward. Cards hang off their header by a thin tether
// line (which also keeps them near it); headers are joined by labelled edges.

import { clip, clusterLabel, fragmentLook, FRAG_H, FRAG_W, HEADER_H, originStroke, typeColors, wrap, edgeLabel } from './boxes';
import { fanCenters, headerRing, KB_H, KB_W, kbRing, SEED_W } from './layout/organic';
import { leash } from './layout/leash';
import { TETHER_KIND } from './tether';
import { cssVar } from './theme';

const EDGE = () => cssVar('--color-edge-stroke', '#6B6B6B');
const HEADER_STROKE = () => cssVar('--color-header-stroke', '#2E2E2E');
import type { WebModel } from './webModel';

export { FRAG_H, FRAG_W };
const SEED_H = 120;

type Skeleton = Record<string, unknown>;

export function buildSkeletons(m: WebModel): Skeleton[] {
  const out: Skeleton[] = [];
  const seedH = SEED_H + (m.context ? 30 : 0);

  // Seed, in the middle
  const seedBg = cssVar('--color-seed-bg', '#D2F34C');
  const seedText = cssVar('--color-seed-text', '#0a0a0a');
  const seedBody = m.context ? `\n\n${wrap(clip(m.context, 400), Math.floor(SEED_W / 8))}` : '';
  out.push({
    type: 'rectangle', id: 'seed', x: -SEED_W / 2, y: -seedH / 2, width: SEED_W, height: seedH,
    strokeColor: 'transparent', backgroundColor: seedBg, fillStyle: 'solid', roundness: null,
    label: { fontFamily: 2, text: `${m.query.toUpperCase()}${seedBody}`, fontSize: 16, strokeColor: seedText, textAlign: 'left', verticalAlign: 'top' },
  });

  // The notes it was built from, in a ring around it
  const src = typeColors('source');
  const ring = kbRing(m.kb.length);
  m.kb.forEach((p, i) => {
    out.push({
      type: 'rectangle', id: `kb-${i}`,
      x: ring[i].x - KB_W / 2, y: ring[i].y - KB_H / 2, width: KB_W, height: KB_H,
      strokeColor: 'transparent', backgroundColor: src.bg, fillStyle: 'solid', roundness: null,
      label: { fontFamily: 2, text: `KB · ${clip(p.source, 30)}${p.lens ? ` · ${p.lens}` : ''}\n\n${wrap(clip(p.text, 110), 36)}`, fontSize: 11, strokeColor: src.text, textAlign: 'left', verticalAlign: 'top' },
    });
  });

  // Collections: header on the outer ring, cards fanned outward around it
  const heads = headerRing(m.clusters.length);
  const arrows: Skeleton[] = [];
  m.clusters.forEach((cluster, ci) => {
    const h = heads[ci];
    out.push({
      type: 'rectangle', id: `cluster-${ci}`, x: h.x - FRAG_W / 2, y: h.y - HEADER_H / 2, width: FRAG_W, height: HEADER_H,
      strokeColor: HEADER_STROKE(), backgroundColor: 'transparent', roundness: null,
      ...(originStroke(cluster.origin) ?? {}),
      label: clusterLabel(cluster.title, cluster.origin),
      customData: { kind: 'cluster', index: ci, title: cluster.title, ...(cluster.lens ? { lens: cluster.lens } : {}), ...(cluster.origin ? { origin: cluster.origin } : {}) },
    });

    const spots = fanCenters(cluster.slots.length, h, h.angle);
    cluster.slots.forEach((frag, fi) => {
      const base = { type: 'rectangle', id: `frag-${ci}-${fi}`, x: spots[fi].x - FRAG_W / 2, y: spots[fi].y - FRAG_H / 2, width: FRAG_W, height: FRAG_H, roundness: null };
      if (!frag) {
        // Ghost slot: dashed outline, no text — shows where content will land.
        out.push({ ...base, strokeColor: 'rgba(0,0,0,0.25)', strokeStyle: 'dashed', backgroundColor: 'rgba(0,0,0,0.04)', fillStyle: 'solid' });
      } else {
        const look = fragmentLook(frag);
        out.push({
          ...base, strokeColor: 'transparent', backgroundColor: look.backgroundColor, fillStyle: 'solid',
          ...(originStroke(frag.origin) ?? {}),
          label: look.label,
          customData: { kind: 'fragment', cluster: ci, slot: fi, fragment: frag },
        });
      }
      // A thin line from header to card; it also stops the card drifting far from its header.
      const dist = Math.hypot(spots[fi].x - h.x, spots[fi].y - h.y);
      arrows.push({
        type: 'arrow', id: `tether-${ci}-${fi}`, x: 0, y: 0, start: { id: `cluster-${ci}` }, end: { id: `frag-${ci}-${fi}` },
        startArrowhead: null, endArrowhead: null, strokeColor: EDGE(), strokeWidth: 1, strokeStyle: 'dotted', opacity: 55,
        customData: { kind: TETHER_KIND, max: leash(dist) },
      });
    });
  });

  // Labelled edges between collections, and the topic's link to the first one
  m.edges.forEach((edge, i) => {
    if (!m.clusters[edge.source] || !m.clusters[edge.target]) return;
    arrows.push({
      type: 'arrow', id: `edge-${i}`, x: 0, y: 0,
      start: { id: `cluster-${edge.source}` }, end: { id: `cluster-${edge.target}` },
      strokeColor: EDGE(),
      ...(edge.label ? { label: edgeLabel(edge.label) } : {}),
    });
  });
  if (m.clusters.length) {
    arrows.push({ type: 'arrow', id: 'seed-link', x: 0, y: 0, start: { id: 'seed' }, end: { id: 'cluster-0' }, strokeColor: EDGE(), strokeWidth: 1, opacity: 70 });
  }

  return [...out, ...arrows];
}
