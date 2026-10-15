// Where things go in a freshly generated web. No columns: the topic sits in the middle, the notes it was built
// from circle it closely, and each collection is a header on a wider ring with its cards fanned outward around it
// (like petals). These are only *starting* positions — the live layout settles whatever still touches.
//
// Everything is a pure function of counts, so a rebuilt model lands in the same places and the canvas can merge
// updates in place. All positions are element centers unless stated.

import { FRAG_H, FRAG_W, GAP, HEADER_H } from '../boxes';

export interface Pt { x: number; y: number }

export const SEED_W = 440;
export const KB_W = FRAG_W;
export const KB_H = 110;
/** Distance from a header's center to its cards' centers. */
export const FAN_DIST = 400;

const rad = (deg: number) => (deg * Math.PI) / 180;
const TOP = -90;

/** Centers for `n` notes in a ring close around the topic. */
export function kbRing(n: number): Pt[] {
  const extra = Math.max(0, n - 6);
  const rx = 480 + 30 * extra, ry = 300 + 20 * extra;
  return Array.from({ length: n }, (_, i) => {
    const a = rad(TOP + 180 / Math.max(n, 1) + (360 * i) / Math.max(n, 1)); // offset half a step so none sits dead top
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  });
}

/** Header centers for `n` collections on a wider ring, with the outward angle (degrees) each fans toward. */
export function headerRing(n: number): Array<Pt & { angle: number }> {
  const extra = Math.max(0, n - 4);
  const rx = 860 + 90 * extra, ry = 620 + 65 * extra;
  return Array.from({ length: n }, (_, i) => {
    const deg = TOP + (360 * i) / Math.max(n, 1);
    // Fan along the ring's outward normal, not the polar angle, so squashed ends don't point oddly.
    const a = rad(deg);
    const normal = Math.atan2(Math.sin(a) / ry, Math.cos(a) / rx) * 180 / Math.PI;
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry, angle: normal };
  });
}

/**
 * Where each of a collection's `k` cards sits relative to the way it grows outward. Not an arc of equals: the first
 * card (the one that matters most) leads straight out, and the rest branch off either side of it, each a little
 * further out than the last. That is what lets the web decentralise: the collections circle the origin, but within a
 * collection the cards stagger and sprawl, and each becomes a point further growth can leave from in its own direction.
 */
export function fanSlots(k: number): Array<{ offset: number; reach: number }> {
  return Array.from({ length: k }, (_, j) => {
    if (j === 0) return { offset: 0, reach: 1 };
    const ring = Math.ceil(j / 2), side = j % 2 === 1 ? 1 : -1;
    return { offset: side * Math.min(100, 38 * ring), reach: 1 + 0.38 * ring };
  });
}

/** Angular offsets (degrees) of the cards from the outward direction, lead card first. */
export const fanAngles = (k: number): number[] => fanSlots(k).map(s => s.offset);

/** Card centers for a header at `from`, growing toward `angle` (degrees). Taller cards (`cardH`) are placed further out. Lead card first. */
export function fanCenters(k: number, from: Pt, angle: number, cardH: number = FRAG_H): Pt[] {
  const base = FAN_DIST + 40 * Math.max(0, k - 3) + Math.max(0, cardH - FRAG_H) * 0.6;
  return fanSlots(k).map(({ offset, reach }) => ({ x: from.x + Math.cos(rad(angle + offset)) * base * reach, y: from.y + Math.sin(rad(angle + offset)) * base * reach }));
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Bounding box (absolute) of a header at `from` and its `k` fanned cards. */
export function clusterFootprint(k: number, from: Pt, angle: number, cardH: number = FRAG_H): Rect {
  const rects: Rect[] = [{ x: from.x - FRAG_W / 2, y: from.y - HEADER_H / 2, width: FRAG_W, height: HEADER_H },
    ...fanCenters(k, from, angle, cardH).map(c => ({ x: c.x - FRAG_W / 2, y: c.y - cardH / 2, width: FRAG_W, height: cardH }))];
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  return { x: x0, y: y0, width: Math.max(...rects.map(r => r.x + r.width)) - x0, height: Math.max(...rects.map(r => r.y + r.height)) - y0 };
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/**
 * Where a collection of `k` cards grown from `source` should go: further along the way `source` itself grew, i.e. away
 * from `from` (what it hangs off: its collection's header, or the origin), as near the source as there's room. Growth
 * direction is local to each card, not "away from the middle of the canvas", so branches diverge. Without `from` it
 * falls back to away from the centre of everything. Tries that direction first, then swings to either side, then farther out.
 */
export function findClusterSpot(boxes: readonly Rect[], source: Rect, k: number, from?: Pt): { header: Pt; angle: number } {
  const all = boxes.length ? boxes : [source];
  const cx = from?.x ?? all.reduce((s, b) => s + b.x + b.width / 2, 0) / all.length, cy = from?.y ?? all.reduce((s, b) => s + b.y + b.height / 2, 0) / all.length;
  const sx = source.x + source.width / 2, sy = source.y + source.height / 2;
  const outward = Math.hypot(sx - cx, sy - cy) < 1 ? 0 : (Math.atan2(sy - cy, sx - cx) * 180) / Math.PI;
  const swings = [0, 30, -30, 60, -60, 90, -90, 135, -135, 180];
  let best: { header: Pt; angle: number } | null = null;
  for (const radius of [560, 760, 960, 1200]) {
    for (const s of swings) {
      const a = outward + s;
      const header = { x: sx + Math.cos(rad(a)) * radius, y: sy + Math.sin(rad(a)) * radius };
      const fanAngle = a; // fan away from the source along the same line
      const foot = clusterFootprint(k, header, fanAngle);
      if (!boxes.some(b => overlaps(foot, b, GAP))) return { header, angle: fanAngle };
      best ??= { header, angle: fanAngle };
    }
  }
  return best!;
}
