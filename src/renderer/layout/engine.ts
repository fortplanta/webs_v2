// Soft collision resolution and tethers for a "node canvas". Pure and deterministic: no DOM, no Excalidraw.
//
// Nodes are axis-aligned boxes. Each call to step() relaxes the layout a little:
//   - overlapping nodes (closer than `gap`) are pushed apart along the axis of least overlap, shared by
//     inverse mass, so a node you are dragging (pinned) never yields and anchors yield less than their cards;
//   - a tether keeps a child within `max` of its anchor (center to center), pulling the child back toward it.
// A step applies only a fraction (`gain`) of the correction, capped at `maxStep`, so repeated steps make
// nodes glide out of the way instead of snapping. When nothing overlaps and no tether is stretched, nothing moves.

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Being dragged/resized: never pushed by collisions (but a tether can still hold it back). */
  pinned?: boolean;
  /** Fixed in place: an obstacle that others route around. */
  locked?: boolean;
}

export interface Tether {
  anchor: string;
  child: string;
  /** Largest allowed distance between the two nodes' centers. */
  max: number;
}

export interface EngineConfig {
  /** Minimum clear space between two nodes. */
  gap: number;
  /** Relaxation passes per step. */
  iterations: number;
  /** Fraction of the computed correction applied per step (0–1). Lower = softer, slower glide. */
  gain: number;
  /** Most a node may move in one step, in px. */
  maxStep: number;
  /** Below this, a step counts as at rest. */
  epsilon: number;
  /**
   * Penetration (beyond `gap`) smaller than this is ignored — neither corrected nor counted. Keeps float noise
   * from looking like an overlap, and must exceed epsilon/gain so a soft step can always finish the job.
   */
  slop: number;
  /** Extra weight per tethered child, so an anchor is pushed less than the cards attached to it. */
  anchorMass: number;
}

export const defaultEngineConfig: EngineConfig = { gap: 28, iterations: 6, gain: 0.35, maxStep: 48, epsilon: 0.4, slop: 1.5, anchorMass: 0.6 };

export interface Move { dx: number; dy: number }

export interface StepResult {
  moves: Map<string, Move>;
  /** Largest move this step, in px (0 when at rest). */
  maxMove: number;
  /** Pairs of nodes that were closer than `gap` going in. */
  overlaps: number;
}

const cx = (n: LayoutNode) => n.x + n.w / 2;
const cy = (n: LayoutNode) => n.y + n.h / 2;

function contains(a: LayoutNode, b: LayoutNode): boolean {
  return a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
}

/** Overlap of two nodes inflated by gap/2 each: positive on both axes means they collide. */
function overlapOf(a: LayoutNode, b: LayoutNode, gap: number): { ox: number; oy: number } {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
  return { ox, oy };
}

export function countOverlaps(nodes: readonly LayoutNode[], gap: number, slop = defaultEngineConfig.slop): number {
  let n = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (contains(a, b) || contains(b, a)) continue;
      const { ox, oy } = overlapOf(a, b, gap);
      if (ox > slop && oy > slop) n++;
    }
  }
  return n;
}

export function step(input: readonly LayoutNode[], tethers: readonly Tether[], cfg: EngineConfig = defaultEngineConfig): StepResult {
  // Stable order → deterministic results.
  const nodes = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(n => ({ ...n }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const orig = new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  const overlaps = countOverlaps(nodes, cfg.gap, cfg.slop);

  const live = tethers.filter(t => byId.has(t.anchor) && byId.has(t.child) && t.anchor !== t.child);
  const childCount = new Map<string, number>();
  for (const t of live) childCount.set(t.anchor, (childCount.get(t.anchor) ?? 0) + 1);

  // Collision weights: pinned/locked don't move. Anchors are heavier than their cards.
  const heavy = (n: LayoutNode) => 1 + cfg.anchorMass * (childCount.get(n.id) ?? 0);
  const invCollide = (n: LayoutNode) => (n.pinned || n.locked ? 0 : 1 / heavy(n));
  // Tether weights: the child takes the pull, the anchor yields a little (heavier = less), a pinned/locked anchor not at all.
  const invTether = (n: LayoutNode, isAnchor: boolean) => (n.locked ? 0 : isAnchor ? (n.pinned ? 0 : 1 / heavy(n)) : 1);

  for (let it = 0; it < cfg.iterations; it++) {
    // collisions (all pairs; node counts here are small)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (contains(a, b) || contains(b, a)) continue;
        const { ox, oy } = overlapOf(a, b, cfg.gap);
        if (ox <= cfg.slop || oy <= cfg.slop) continue;
        const wa = invCollide(a), wb = invCollide(b);
        if (wa + wb === 0) continue;
        const shareA = wa / (wa + wb), shareB = wb / (wa + wb);
        if (ox < oy) {
          const dir = cx(b) === cx(a) ? (a.id < b.id ? 1 : -1) : Math.sign(cx(b) - cx(a));
          a.x -= dir * ox * shareA; b.x += dir * ox * shareB;
        } else {
          const dir = cy(b) === cy(a) ? (a.id < b.id ? 1 : -1) : Math.sign(cy(b) - cy(a));
          a.y -= dir * oy * shareA; b.y += dir * oy * shareB;
        }
      }
    }
    // tethers
    for (const t of live) {
      const a = byId.get(t.anchor)!, c = byId.get(t.child)!;
      const dx = cx(c) - cx(a), dy = cy(c) - cy(a);
      const d = Math.hypot(dx, dy);
      if (d <= t.max || d === 0) continue;
      // Never fight the pointer: a card being held goes wherever the user takes it. Once let go it is eased back.
      if (c.pinned) continue;
      const wa = invTether(a, true), wc = invTether(c, false);
      if (wa + wc === 0) continue;
      const excess = d - t.max, ux = dx / d, uy = dy / d;
      c.x -= ux * excess * (wc / (wa + wc)); c.y -= uy * excess * (wc / (wa + wc));
      a.x += ux * excess * (wa / (wa + wc)); a.y += uy * excess * (wa / (wa + wc));
    }
  }

  const moves = new Map<string, Move>();
  let maxMove = 0;
  for (const n of nodes) {
    const o = orig.get(n.id)!;
    let dx = (n.x - o.x) * cfg.gain, dy = (n.y - o.y) * cfg.gain;
    const len = Math.hypot(dx, dy);
    if (len > cfg.maxStep) { dx *= cfg.maxStep / len; dy *= cfg.maxStep / len; }
    if (Math.hypot(dx, dy) < 1e-9) continue;
    moves.set(n.id, { dx, dy });
    maxMove = Math.max(maxMove, Math.hypot(dx, dy));
  }
  // A tiny move only counts as "at rest" when nothing is left to fix; otherwise a soft step could stall just short of done.
  const stretched = live.some(t => {
    const a = byId.get(t.anchor)!, c = byId.get(t.child)!;
    return Math.hypot(cx(c) - cx(a), cy(c) - cy(a)) > t.max + cfg.slop;
  });
  const settled = overlaps === 0 && !stretched;
  return { moves, maxMove: settled && maxMove < cfg.epsilon ? 0 : maxMove, overlaps };
}

export interface SettleResult {
  nodes: LayoutNode[];
  steps: number;
  /** Pairs still closer than `gap` at the end (0 unless the layout is over-constrained). */
  overlaps: number;
}

/** Run steps until at rest (or `maxSteps`). Used for initial layouts and placements, and in tests. */
export function settle(input: readonly LayoutNode[], tethers: readonly Tether[], cfg: EngineConfig = defaultEngineConfig, maxSteps = 400): SettleResult {
  let nodes = input.map(n => ({ ...n }));
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const r = step(nodes, tethers, cfg);
    if (r.maxMove === 0) break;
    nodes = nodes.map(n => { const m = r.moves.get(n.id); return m ? { ...n, x: n.x + m.dx, y: n.y + m.dy } : n; });
  }
  return { nodes, steps, overlaps: countOverlaps(nodes, cfg.gap, cfg.slop) };
}
