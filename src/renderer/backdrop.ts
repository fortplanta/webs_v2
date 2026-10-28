// What is painted *behind* the cards: a dot field that drifts a little slower than the cards when you pan (so there is a sense
// of depth), a faint glow around the topic, a soft region behind each collection, and the soft light under each card (more
// when you hover or lift it). Pure geometry and timing here, so it can be tested; BackdropOverlay.tsx paints it.

import type { El } from './sceneEdit';

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

// ── the dot field ────────────────────────────────────────────────────────────────────────────────────────────────

/** The dots move at this share of the cards' pace, so they sit "further back". */
export const PARALLAX = 0.88;
const BASE_GAP = 96, MIN_SCREEN_GAP = 34;

/** Gap between dots in scene units: doubled as often as needed that they never crowd closer than MIN_SCREEN_GAP on screen. */
export function dotGap(zoom: number): number {
  let gap = BASE_GAP;
  while (gap * zoom < MIN_SCREEN_GAP) gap *= 2;
  return gap;
}

/** Screen positions of the dots across a `width` × `height` view. */
export function dots(view: { scrollX: number; scrollY: number; zoom: number; width: number; height: number }, parallax = PARALLAX): Pt[] {
  const gap = dotGap(view.zoom), sx = view.scrollX * parallax, sy = view.scrollY * parallax;
  const x0 = Math.floor(-sx / gap) - 1, x1 = Math.ceil((view.width / view.zoom - sx) / gap) + 1;
  const y0 = Math.floor(-sy / gap) - 1, y1 = Math.ceil((view.height / view.zoom - sy) / gap) + 1;
  const out: Pt[] = [];
  for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) out.push({ x: (i * gap + sx) * view.zoom, y: (j * gap + sy) * view.zoom });
  return out;
}

// ── regions ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const REGION_PAD = 90;

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The corners of every rectangle, each pushed `pad` outward: the hull of these is a region with room around its cards. */
export const paddedCorners = (rects: readonly Rect[], pad = REGION_PAD): Pt[] =>
  rects.flatMap(r => [{ x: r.x - pad, y: r.y - pad }, { x: r.x + r.width + pad, y: r.y - pad }, { x: r.x + r.width + pad, y: r.y + r.height + pad }, { x: r.x - pad, y: r.y + r.height + pad }]);

/**
 * A closed, rounded outline through a hull: start at the middle of the last edge, then curve through each vertex to the middle
 * of the next edge (quadratic, the vertex as control point). Returns the start and, for each vertex, [control, end].
 */
export function roundedOutline(hull: readonly Pt[]): { start: Pt; curves: Array<[Pt, Pt]> } | null {
  if (hull.length < 3) return null;
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const n = hull.length;
  return { start: mid(hull[n - 1], hull[0]), curves: hull.map((v, i) => [v, mid(v, hull[(i + 1) % n])]) };
}

export interface Region { index: number; rects: Rect[] }

/** One region per collection with at least one card on the canvas: its header and every card of it. */
export function regionsOf(elements: readonly El[]): Region[] {
  const by = new Map<number, Rect[]>();
  const cards = new Map<number, number>();
  for (const e of elements) {
    if (e.isDeleted || e.type !== 'rectangle') continue;
    const d = e.customData;
    if (d?.kind === 'cluster' && Number.isInteger(d.index)) by.set(d.index, [...(by.get(d.index) ?? []), { x: e.x, y: e.y, width: e.width, height: e.height }]);
    else if (d?.kind === 'fragment' && Number.isInteger(d.cluster)) { by.set(d.cluster, [...(by.get(d.cluster) ?? []), { x: e.x, y: e.y, width: e.width, height: e.height }]); cards.set(d.cluster, (cards.get(d.cluster) ?? 0) + 1); }
  }
  return [...by].filter(([i]) => (cards.get(i) ?? 0) > 0).sort((a, b) => a[0] - b[0]).map(([index, rects]) => ({ index, rects }));
}

/** A soft, restrained tint per collection (hue in degrees), echoing the card-type colours without shouting. */
const HUES = [160, 25, 195, 275, 40, 215, 340, 100];
export const regionHue = (index: number): number => HUES[((index % HUES.length) + HUES.length) % HUES.length];

// ── light under cards ────────────────────────────────────────────────────────────────────────────────────────────

/** How far a card is lifted (0 = at rest, 1 = fully lifted) moves toward `target`, taking about 0.18 s. */
export function liftToward(current: number, target: number, ms: number): number {
  const k = 1 - Math.exp((-15 * ms) / 1000);       // ~ 95% of the way in 0.2 s
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.004 ? target : next;
}

/** The glow under a card: how much light, how far it spreads and how far below the card it falls, for a lift of 0–1. */
export function cardGlow(lift: number): { alpha: number; blur: number; drop: number } {
  return { alpha: 0.035 + 0.11 * lift, blur: 22 + 22 * lift, drop: 6 + 12 * lift };
}

/** What lift a card should be moving toward: hovered or being dragged lifts fully, selected a little, otherwise at rest. */
export function liftTarget(state: { hovered: boolean; dragging: boolean; selected: boolean }): number {
  return state.dragging ? 1 : state.hovered ? 0.8 : state.selected ? 0.45 : 0;
}
