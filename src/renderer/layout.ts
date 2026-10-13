// WebModel → Excalidraw element skeletons. Rebuilt on every model change; ids are stable so the
// canvas can merge updates in place (ghost slot → filled fragment) without disturbing user edits.
//
// Layout (see layout/organic.ts): the topic in the middle, the notes it was built from in a ring around it, each
// collection a header on a wider ring with its cards fanned outward. Cards hang off their header by a thin tether
// line (which also keeps them near it); headers are joined by labelled edges.

import { cardLook, cardTextSkeletons, groupFor } from './card';
import { clip, clusterLabel, FRAG_H, FRAG_W, HEADER_H, originStroke, wrap, edgeLabel } from './boxes';
import { fanCenters, headerRing, KB_H, KB_W, kbRing, SEED_W } from './layout/organic';
import { leash } from './layout/leash';
import { TETHER_KIND } from './tether';
import { cssVar } from './theme';

const EDGE = () => cssVar('--color-edge-stroke', '#6B6B6B');
import type { WebModel } from './webModel';

export { FRAG_H, FRAG_W };

type Skeleton = Record<string, unknown>;

export function buildSkeletons(m: WebModel): Skeleton[] {
  const out: Skeleton[] = [];
  // The topic, in the middle: a light label in display type, with the one-line gist beneath it
  const seedLines = wrap(m.query, 20).split('\n');
  const seedH = 28 + seedLines.length * 38;
  const seedW = 360;
  out.push({
    type: 'rectangle', roughness: 0, id: 'seed', x: -seedW / 2, y: -seedH / 2, width: seedW, height: seedH,
    strokeColor: 'transparent', backgroundColor: cssVar('--color-seed-bg', '#F2F2F2'), fillStyle: 'solid', roundness: null,
    groupIds: ['grp-seed'],
    label: { fontFamily: 7, text: seedLines.join('\n'), fontSize: 32, strokeColor: cssVar('--color-seed-text', '#3A3A3A'), textAlign: 'center', verticalAlign: 'middle' },
  });
  if (m.context) {
    out.push({
      type: 'text', id: 'seed-sub', x: -seedW / 2 + 4, y: seedH / 2 + 8, text: clip(m.context.split(/(?<=[.!?])\s/)[0], 70),
      fontSize: 12, fontFamily: 2, strokeColor: cssVar('--color-seed-sub', '#7A7A7A'), groupIds: ['grp-seed'], customData: { card: 'seed', role: 'sub' },
    });
  }

  // The notes it was built from, in a ring around it
  const ring = kbRing(m.kb.length);
  m.kb.forEach((p, i) => {
    out.push({
      type: 'rectangle', roughness: 0, id: `kb-${i}`,
      x: ring[i].x - KB_W / 2, y: ring[i].y - KB_H / 2, width: KB_W, height: KB_H,
      strokeColor: cssVar('--color-card-border', '#1B1B1B'), strokeWidth: 1, backgroundColor: cssVar('--color-card-bg', '#101010'), fillStyle: 'solid', roundness: null,
      label: { fontFamily: 8, text: `KB · ${clip(p.source, 30)}${p.lens ? ` · ${p.lens}` : ''}\n\n${wrap(clip(p.text, 110), 40)}`, fontSize: 11, strokeColor: cssVar('--color-card-body', '#8C8C8C'), textAlign: 'left', verticalAlign: 'top' },
    });
  });

  // Collections: header on the outer ring, cards fanned outward around it
  const heads = headerRing(m.clusters.length);
  const arrows: Skeleton[] = [];
  m.clusters.forEach((cluster, ci) => {
    const h = heads[ci];
    out.push({
      type: 'rectangle', roughness: 0, id: `cluster-${ci}`, x: h.x - FRAG_W / 2, y: h.y - HEADER_H / 2, width: FRAG_W, height: HEADER_H,
      strokeColor: 'transparent', backgroundColor: 'transparent', roundness: null,
      ...(originStroke(cluster.origin) ?? {}),
      label: clusterLabel(cluster.title, cluster.origin),
      customData: { kind: 'cluster', index: ci, title: cluster.title, ...(cluster.lens ? { lens: cluster.lens } : {}), ...(cluster.origin ? { origin: cluster.origin } : {}) },
    });

    const spots = fanCenters(cluster.slots.length, h, h.angle);
    cluster.slots.forEach((frag, fi) => {
      const base = { type: 'rectangle', roughness: 0, id: `frag-${ci}-${fi}`, x: spots[fi].x - FRAG_W / 2, y: spots[fi].y - FRAG_H / 2, width: FRAG_W, height: FRAG_H, roundness: null };
      if (!frag) {
        // Ghost slot: dashed outline, no text — shows where content will land.
        out.push({ ...base, strokeColor: 'rgba(0,0,0,0.25)', strokeStyle: 'dashed', backgroundColor: 'rgba(0,0,0,0.04)', fillStyle: 'solid' });
      } else {
        const look = cardLook(frag);
        out.push({
          ...base, ...look.stroke, backgroundColor: look.backgroundColor, fillStyle: 'solid',
          groupIds: [groupFor(`frag-${ci}-${fi}`)],
          label: look.body,
          customData: { kind: 'fragment', cluster: ci, slot: fi, fragment: frag },
        });
        out.push(...cardTextSkeletons(`frag-${ci}-${fi}`, { x: base.x, y: base.y, width: FRAG_W, height: FRAG_H }, look));
      }
      // A thin line from header to card; it also stops the card drifting far from its header.
      const dist = Math.hypot(spots[fi].x - h.x, spots[fi].y - h.y);
      arrows.push({
        type: 'arrow', roughness: 0, id: `tether-${ci}-${fi}`, x: 0, y: 0, start: { id: `cluster-${ci}` }, end: { id: `frag-${ci}-${fi}` },
        startArrowhead: null, endArrowhead: null, strokeColor: EDGE(), strokeWidth: 1, strokeStyle: 'dotted', opacity: 55,
        customData: { kind: TETHER_KIND, max: leash(dist) },
      });
    });
  });

  // Labelled edges between collections, and the topic's link to the first one
  m.edges.forEach((edge, i) => {
    if (!m.clusters[edge.source] || !m.clusters[edge.target]) return;
    arrows.push({
      type: 'arrow', roughness: 0, id: `edge-${i}`, x: 0, y: 0,
      start: { id: `cluster-${edge.source}` }, end: { id: `cluster-${edge.target}` },
      strokeColor: EDGE(),
      ...(edge.label ? { label: edgeLabel(edge.label) } : {}),
    });
  });
  if (m.clusters.length) {
    arrows.push({ type: 'arrow', roughness: 0, id: 'seed-link', x: 0, y: 0, start: { id: 'seed' }, end: { id: 'cluster-0' }, strokeColor: EDGE(), strokeWidth: 1, opacity: 70 });
  }

  return [...out, ...arrows];
}
