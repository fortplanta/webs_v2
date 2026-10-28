// WebModel → Excalidraw element skeletons. Rebuilt on every model change; ids are stable so the
// canvas can merge updates in place (ghost slot → filled fragment) without disturbing user edits.
//
// Layout (see layout/organic.ts): the topic fixed in the middle (centralised), the notes it was built from in a ring
// around it, each collection a header on a wider ring. From there it decentralises: a collection's cards branch outward
// from their header, staggered, the most important one leading, and every card is a point new growth can leave from in
// its own direction. Cards hang off their header by a thin tether line (which also keeps them near it); headers are
// joined to the origin by labelled lines (and to each other only where one grows out of another).

import { cardLook, cardSize, cardTextSkeletons, groupFor } from './card';
import { clip, clusterLabel, FRAG_H, FRAG_W, HEADER_H, wrap, edgeLabel } from './boxes';
import { KB_H, KB_W, SEED_W } from './layout/organic';
import { grownFan, grownHeaders, grownKbRing, type Tie } from './layout/grown';
import { leash } from './layout/leash';
import { TETHER_KIND } from './tether';
import { cssVar } from './theme';

const EDGE = () => cssVar('--color-edge-stroke', '#6B6B6B');
import type { WebModel } from './webModel';

export { FRAG_H, FRAG_W };

type Skeleton = Record<string, unknown>;

/** Which collections belong near each other: a tangent ties two (weight 1), and each card that refers to a card elsewhere adds a little. */
export function clusterTies(m: WebModel): Tie[] {
  const clusterOf = new Map<string, number>();
  m.clusters.forEach((c, ci) => c.slots.forEach(s => s?.kbPassageIds?.forEach(id => clusterOf.set(id, ci))));
  const w = new Map<string, number>();
  const add = (a: number, b: number, weight: number) => { if (a === b || a < 0 || b < 0 || a >= m.clusters.length || b >= m.clusters.length) return; const k = a < b ? `${a}-${b}` : `${b}-${a}`; w.set(k, (w.get(k) ?? 0) + weight); };
  m.edges.forEach(e => add(e.source, e.target, 1));
  m.clusters.forEach((c, ci) => c.slots.forEach(s => s?.relates?.forEach(r => { const to = clusterOf.get(r.to); if (to !== undefined) add(ci, to, 0.3); })));
  return [...w].map(([k, weight]) => { const [a, b] = k.split('-').map(Number); return { a, b, weight }; });
}

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
    // The narrator's through-line (how the pieces add up to the question), in full, under the topic
    out.push({
      type: 'text', id: 'seed-sub', x: -seedW / 2, y: seedH / 2 + 10, text: wrap(m.context, 58),
      fontSize: 12, fontFamily: 8, strokeColor: cssVar('--color-seed-sub', '#7A7A7A'), groupIds: ['grp-seed'], customData: { card: 'seed', role: 'sub' },
    });
  }

  // The notes it was built from, in a ring around it
  const ring = grownKbRing(m.kb.length);
  m.kb.forEach((p, i) => {
    out.push({
      type: 'rectangle', roughness: 0, id: `kb-${i}`,
      x: ring[i].x - KB_W / 2, y: ring[i].y - KB_H / 2, width: KB_W, height: KB_H,
      strokeColor: cssVar('--color-card-border', '#1B1B1B'), strokeWidth: 1, backgroundColor: cssVar('--color-card-bg', '#101010'), fillStyle: 'solid', roundness: null,
      label: { fontFamily: 8, text: `KB · ${clip(p.source, 30)}${p.lens ? ` · ${p.lens}` : ''}\n\n${wrap(clip(p.text, 110), 40)}`, fontSize: 11, strokeColor: cssVar('--color-card-body', '#8C8C8C'), textAlign: 'left', verticalAlign: 'top' },
    });
  });

  // Collections: header on the outer ring, cards fanned outward around it
  const heads = grownHeaders(m.clusters.map(c => ({ size: c.slots.filter(s => !s?.dropped).length })), clusterTies(m));
  const arrows: Skeleton[] = [];
  const cardAt: Array<{ pid?: string; id: string }> = [];
  const hidden = new Set<number>(); // collections whose every card the narrator set aside
  m.clusters.forEach((cluster, ci) => {
    const h = heads[ci];
    // a slot nothing ever filled is only a placeholder while the web is still being written; it does not outlive that
    const settled = m.phase !== 'running';
    const visible = cluster.slots.map((f, i) => i).filter(i => !cluster.slots[i]?.dropped && !(settled && !cluster.slots[i]));
    if (visible.length === 0 && cluster.slots.length > 0) { hidden.add(ci); return; }
    out.push({
      type: 'rectangle', roughness: 0, id: `cluster-${ci}`, x: h.x - FRAG_W / 2, y: h.y - HEADER_H / 2, width: FRAG_W, height: HEADER_H,
      strokeColor: 'transparent', backgroundColor: 'transparent', roundness: null,
      label: clusterLabel(cluster.title, cluster.origin),
      customData: { kind: 'cluster', index: ci, title: cluster.title, ...(cluster.lens ? { lens: cluster.lens } : {}), ...(cluster.origin ? { origin: cluster.origin } : {}) },
    });

    const sizes = cluster.slots.map(f => (f ? cardSize(f) : { width: FRAG_W, height: FRAG_H }));
    cardAt.push(...visible.map(fi => ({ pid: cluster.slots[fi]?.kbPassageIds?.[0], id: `frag-${ci}-${fi}` })));
    // The card that matters most leads straight out; the rest branch off either side of it (see fanSlots)
    const spotsVisible = grownFan(visible.length, h, h.angle, Math.max(...visible.map(i => sizes[i].height), FRAG_H), `c${ci}`);
    const rank = [...visible].sort((a, b) => (cluster.slots[b]?.weight ?? 2) - (cluster.slots[a]?.weight ?? 2) || a - b);
    const spots = cluster.slots.map((_, fi) => spotsVisible[Math.max(rank.indexOf(fi), 0)]);
    cluster.slots.forEach((frag, fi) => {
      if (frag?.dropped || (settled && !frag)) return; // set aside by the narrator, or never written
      const base = { type: 'rectangle', roughness: 0, id: `frag-${ci}-${fi}`, x: spots[fi].x - sizes[fi].width / 2, y: spots[fi].y - sizes[fi].height / 2, width: sizes[fi].width, height: sizes[fi].height, roundness: null };
      if (!frag) {
        // Ghost slot: a faint dashed outline, no text — shows where content will land while the web is being written.
        out.push({ ...base, strokeColor: cssVar('--color-ghost', '#2A2A2A'), strokeStyle: 'dashed', backgroundColor: 'transparent', fillStyle: 'solid' });
      } else {
        const look = cardLook(frag);
        out.push({
          ...base, ...look.stroke, backgroundColor: look.backgroundColor, fillStyle: 'solid',
          groupIds: [groupFor(`frag-${ci}-${fi}`)],
          label: look.body,
          customData: { kind: 'fragment', cluster: ci, slot: fi, fragment: frag },
        });
        out.push(...cardTextSkeletons(`frag-${ci}-${fi}`, { x: base.x, y: base.y, width: base.width, height: base.height }, look, frag.type));
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

  // How cards relate to each other (the narrator's "led to", "contradicts"…), as labelled arrows between the cards themselves
  const byPassage = new Map(cardAt.filter(c => c.pid).map(c => [c.pid!, c.id]));
  const seen = new Set<string>();
  m.clusters.forEach((cluster, ci) => cluster.slots.forEach((frag, fi) => {
    (frag?.relates ?? []).forEach((r, k) => {
      const from = `frag-${ci}-${fi}`, to = byPassage.get(r.to);
      if (!to || to === from || seen.has(`${to}>${from}`)) return;
      seen.add(`${from}>${to}`);
      arrows.push({
        type: 'arrow', roughness: 0, id: `rel-${ci}-${fi}-${k}`, x: 0, y: 0, start: { id: from }, end: { id: to },
        strokeColor: cssVar('--color-relation-stroke', '#9A9A9A'), strokeWidth: 1, endArrowhead: null, opacity: 80, label: edgeLabel(r.verb), customData: { directed: true },
      });
    });
  }));

  // Every collection hangs directly off the origin: a labelled line from the question to its header...
  m.clusters.forEach((cluster, ci) => {
    if (hidden.has(ci)) return;
    arrows.push({
      type: 'arrow', roughness: 0, id: `origin-${ci}`, x: 0, y: 0, start: { id: 'seed' }, end: { id: `cluster-${ci}` },
      strokeColor: EDGE(), strokeWidth: 1, opacity: 70, endArrowhead: null, customData: { directed: true },
      ...(cluster.edge ? { label: edgeLabel(cluster.edge) } : {}),
    });
  });
  // ...and a line between two collections only where one genuinely grows out of the other (a tangent)
  m.edges.forEach((edge, i) => {
    if (!m.clusters[edge.source] || !m.clusters[edge.target] || hidden.has(edge.source) || hidden.has(edge.target)) return;
    arrows.push({
      type: 'arrow', roughness: 0, id: `edge-${i}`, x: 0, y: 0,
      start: { id: `cluster-${edge.source}` }, end: { id: `cluster-${edge.target}` },
      strokeColor: EDGE(), endArrowhead: null, customData: { directed: true },
      ...(edge.label ? { label: edgeLabel(edge.label) } : {}),
    });
  });

  return [...out, ...arrows];
}
