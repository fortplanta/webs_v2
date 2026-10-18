// Scene logic for a pivot: where the new collection goes, building it, and the "thread" linking it to
// the card it grew from. Pure (builders are injected) so it can be tested without Excalidraw.

import type { GeneratedFragment } from '../backend/events';
import { clusterLabel, edgeLabel, FRAG_H, FRAG_W, HEADER_H } from './boxes';
import { addCard, cardSize } from './card';
import { growthFrom } from './branch';
import { clusterFootprint, fanCenters, findClusterSpot } from './layout/organic';
import { cssVar } from './theme';
import { addBox, updateBox, type Build, type El } from './sceneEdit';

/** KB passages already represented by a card on the canvas — a pivot must not repeat them. */
export function usedPassageIds(elements: El[]): string[] {
  const ids = new Set<string>();
  for (const e of elements) {
    if (e.isDeleted || e.customData?.kind !== 'fragment') continue;
    for (const id of e.customData.fragment?.kbPassageIds ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Where a collection grown from `sourceId` goes: on along the way the card itself grew, as close to the source card
 * as there's free room, numbered after the last collection. `x`/`y` is the header's top-left; `angle` the direction
 * its cards fan toward.
 */
export function placePivot(elements: El[], sourceId: string, cards = 3, at?: { x: number; y: number }): { x: number; y: number; index: number; angle: number } | null {
  const live = elements.filter(e => !e.isDeleted && e.type !== 'text' && e.type !== 'arrow' && e.type !== 'line');
  const source = live.find(e => e.id === sourceId);
  if (!source) return null;
  const index = Math.max(-1, ...live.filter(e => e.customData?.kind === 'cluster').map(e => e.customData.index)) + 1;
  const box = (e: El) => ({ x: e.x, y: e.y, width: e.width, height: e.height });
  // Grow on in the direction this card itself grew: away from what it hangs off (its header), or from the origin.
  // dropped at a chosen point: the header goes there and the cards fan on away from the source
  if (at) {
    const sx = source.x + source.width / 2, sy = source.y + source.height / 2;
    return { x: at.x - FRAG_W / 2, y: at.y - HEADER_H / 2, index, angle: (Math.atan2(at.y - sy, at.x - sx) * 180) / Math.PI };
  }
  const { header, angle } = findClusterSpot(live.map(box), box(source), cards, growthFrom(elements, sourceId));
  return { x: header.x - FRAG_W / 2, y: header.y - HEADER_H / 2, index, angle };
}

/** The area a pivot of `cards` cards will cover, for bringing it into view. */
export function pivotFootprint(pos: { x: number; y: number; angle: number }, cards: number, cardH = FRAG_H) {
  return clusterFootprint(cards, { x: pos.x + FRAG_W / 2, y: pos.y + HEADER_H / 2 }, pos.angle, cardH);
}

export interface PivotSpec {
  id: string;
  x: number;
  y: number;
  index: number;
  /** Direction (degrees) the cards fan toward. */
  angle?: number;
  title: string;
  lens: string;
  fromCardId: string;
  cards: GeneratedFragment[];
}

/** The new header and one card per draft, fanned around it. Ids: `<id>` for the header, `<id>-c<i>` for cards. */
export function addPivotCluster(elements: El[], spec: PivotSpec, build: Build): { elements: El[]; headerId: string; cardIds: string[] } {
  const headerId = spec.id;
  let out = addBox(elements, {
    id: headerId, x: spec.x, y: spec.y, width: FRAG_W, height: HEADER_H, backgroundColor: 'transparent',
    label: clusterLabel(spec.title),
    customData: { kind: 'cluster', index: spec.index, title: spec.title, lens: spec.lens, pivotFrom: spec.fromCardId } as any,
  }, build);
  out = out.map(e => (e.id === headerId ? { ...e, strokeColor: cssVar('--color-header-stroke', '#2E2E2E'), roundness: null } : e));
  const sizes = spec.cards.map(cardSize);
  const tall = Math.max(...sizes.map(z => z.height), FRAG_H);
  const spots = fanCenters(spec.cards.length, { x: spec.x + FRAG_W / 2, y: spec.y + HEADER_H / 2 }, spec.angle ?? 0, tall);
  const cardIds = spec.cards.map((fragment, i) => {
    const id = `${spec.id}-c${i}`;
    out = addCard(out, {
      id, x: spots[i].x - sizes[i].width / 2, y: spots[i].y - sizes[i].height / 2, fragment,
      customData: { kind: 'fragment', cluster: spec.index, slot: i, fragment },
    }, build);
    return id;
  });
  return { elements: out, headerId, cardIds };
}

/** Move elements to the bottom of the stacking order (drawn first, so everything else sits over them). */
export function sendToBack(elements: El[], ids: string[]): El[] {
  const want = new Set(ids);
  return [...elements.filter(e => want.has(e.id)), ...elements.filter(e => !want.has(e.id))];
}

function clipToBox(box: El, toward: { x: number; y: number }) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const t = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Where to put a thread's label: in the free gap just before it reaches its target, not at the midpoint
 * (a long thread's midpoint usually lies behind a card, which would hide the label).
 */
export function threadLabelBox(arrow: El): { x: number; y: number; width: number; height: number } {
  const pts: number[][] = arrow.points ?? [[0, 0], [0, 0]];
  const end = pts[pts.length - 1], start = pts[0];
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1;
  const back = Math.min(70, len / 2); // distance before the target to centre the label
  const cx = arrow.x + end[0] - (dx / len) * back, cy = arrow.y + end[1] - (dy / len) * back;
  return { x: cx - 40, y: cy - 10, width: 80, height: 20 };
}

/**
 * A thread from one element to another: a bound arrow drawn *behind* everything, so a long link passes
 * under the cards between its ends instead of covering their text. Optionally labelled.
 */
export function addThread(
  elements: El[],
  spec: { id: string; fromId: string; toId: string; label?: string; look?: { strokeColor?: string; strokeStyle?: string; strokeWidth?: number; opacity?: number }; customData?: Record<string, unknown> },
  build: Build,
  makeArrow: (raw: El) => El,
): El[] {
  const from = elements.find(e => e.id === spec.fromId && !e.isDeleted), to = elements.find(e => e.id === spec.toId && !e.isDeleted);
  if (!from || !to) return elements;
  const p1 = clipToBox(from, { x: to.x + to.width / 2, y: to.y + to.height / 2 });
  const p2 = clipToBox(to, { x: from.x + from.width / 2, y: from.y + from.height / 2 });
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const arrow = makeArrow({
    type: 'arrow', id: spec.id, x: p1.x, y: p1.y, width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], [dx, dy]],
    startBinding: { elementId: from.id, focus: 0, gap: 4 }, endBinding: { elementId: to.id, focus: 0, gap: 4 },
    startArrowhead: null, endArrowhead: null, strokeColor: cssVar('--color-edge-stroke', '#6B6B6B'), strokeWidth: 1, opacity: 70, roundness: null, roughness: 0,
    ...spec.look, customData: { ...spec.customData, directed: true },
  });
  const bump = (e: El): El => ({ ...e, boundElements: [...(e.boundElements ?? []), { type: 'arrow', id: spec.id }], version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
  let out = elements.map(e => (e.id === from.id || e.id === to.id ? bump(e) : e));
  out = [...out, arrow];
  if (spec.label) out = updateBox(out, spec.id, { label: edgeLabel(spec.label), geometry: threadLabelBox(arrow) }, build);
  const label = out.find(e => e.type === 'text' && e.containerId === spec.id);
  return sendToBack(out, [spec.id, ...(label ? [label.id] : [])]);
}
