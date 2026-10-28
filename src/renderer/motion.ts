// How things move on the canvas, as pure maths so it can be tested: springs that let a pushed card ease to its place and
// settle (a touch of overshoot, never a bounce), the flight a new card makes from the thing it grew out of, and the gentle
// lean of a card's neighbours when it is dragged. The hooks that apply these to the scene are in layout/useLiveLayout.ts.

export interface Move { dx: number; dy: number }

// ── springs ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Soft, slightly under-damped: about 5% overshoot, settled in under half a second. Per 60 fps frame. */
export const SPRING = { stiffness: 0.18, damping: 0.4 };
/** Softer and slower, for a neighbour leaning toward a card being dragged and easing back. */
export const LEAN_SPRING = { stiffness: 0.12, damping: 0.35 };
const REST_DIST = 0.25, REST_SPEED = 0.12;

/** A thing easing toward a goal: where it is headed and how fast it is going. */
export interface Spring { gx: number; gy: number; vx: number; vy: number }

/**
 * One step of a spring from (x, y). `dt` is in 60 fps frames (so a slow frame moves further, not differently). Returns the
 * move to make and the spring's next state, or `null` once it has come to rest on its goal.
 */
export function stepSpring(s: Spring, x: number, y: number, dt = 1, cfg = SPRING): { move: Move; next: Spring | null } {
  const keep = Math.pow(1 - cfg.damping, dt);
  const vx = (s.vx + (s.gx - x) * cfg.stiffness * dt) * keep, vy = (s.vy + (s.gy - y) * cfg.stiffness * dt) * keep;
  const move = { dx: vx * dt, dy: vy * dt };
  const nx = x + move.dx, ny = y + move.dy;
  const resting = Math.hypot(s.gx - nx, s.gy - ny) < REST_DIST && Math.hypot(vx, vy) < REST_SPEED;
  if (resting) return { move: { dx: s.gx - x, dy: s.gy - y }, next: null };
  return { move, next: { gx: s.gx, gy: s.gy, vx, vy } };
}

export interface SpringTick { moves: Map<string, Move>; springs: Map<string, Spring> }

/**
 * Carry the layout's corrections out with springs. `corrections` is how far each node would have to move to be clear of
 * what it overlaps (the whole correction, not a fraction); a node that is told to move aims for where that puts it and
 * keeps aiming even once it is clear, so it can ease in and settle instead of stopping dead. Nodes in `held` are the user's.
 */
export function stepSprings(springs: ReadonlyMap<string, Spring>, positions: ReadonlyMap<string, { x: number; y: number }>, corrections: ReadonlyMap<string, Move>, held: ReadonlySet<string>, dt = 1): SpringTick {
  const next = new Map<string, Spring>(), moves = new Map<string, Move>();
  const ids = new Set([...springs.keys(), ...corrections.keys()]);
  for (const id of ids) {
    const p = positions.get(id);
    if (!p || held.has(id)) continue;
    const c = corrections.get(id), old = springs.get(id);
    const spring: Spring = c && Math.hypot(c.dx, c.dy) > 1e-6 ? { gx: p.x + c.dx, gy: p.y + c.dy, vx: old?.vx ?? 0, vy: old?.vy ?? 0 } : old!;
    const r = stepSpring(spring, p.x, p.y, dt);
    if (r.move.dx || r.move.dy) moves.set(id, r.move);
    if (r.next) next.set(id, r.next);
  }
  return { moves, springs: next };
}

/** Add two sets of moves. */
export function addMoves(a: ReadonlyMap<string, Move>, b: ReadonlyMap<string, Move>): Map<string, Move> {
  const out = new Map(a);
  for (const [id, m] of b) { const o = out.get(id); out.set(id, o ? { dx: o.dx + m.dx, dy: o.dy + m.dy } : m); }
  return out;
}

// ── arrivals ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const ARRIVE_FLIGHT_MS = 760;
/** Share of the flight over which a new card fades in (it is fully there well before it lands). */
const FADE_SHARE = 0.5;

/** Ease-out with a small overshoot: lands just past its place and settles back. */
export const easeOutBack = (t: number, overshoot = 0.8): number => {
  const x = Math.min(1, Math.max(0, t)), c3 = overshoot + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2);
};

export interface Flight { /** Offset from its place at the start of the flight. */ from: Move; /** When it leaves (ms), after its turn in the queue. */ start: number }

/** How far through its flight a card is (0 before it leaves, 1 once landed). */
export const flightProgress = (f: Pick<Flight, 'start'>, now: number): number => Math.min(1, Math.max(0, (now - f.start) / ARRIVE_FLIGHT_MS));

/** Where it is, as an offset from its place: `from` at the start, nothing at the end. */
export function flightOffset(f: Flight, now: number): Move {
  const k = 1 - easeOutBack(flightProgress(f, now));
  return { dx: f.from.dx * k, dy: f.from.dy * k };
}

/** How opaque it is: 0 until it leaves, fully there after the first half of the flight. */
export const flightOpacity = (f: Pick<Flight, 'start'>, now: number): number => Math.min(1, flightProgress(f, now) / FADE_SHARE);

/** Each new thing waits its turn, so a collection fans out rather than appears at once. Cards follow their header. */
export const arrivalDelay = (order: number, isCard: boolean): number => (isCard ? 140 : 0) + Math.min(order, 9) * 70;

// ── leaning ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Most a neighbour leans toward a dragged card, in px. */
export const MAX_LEAN = 34;

/**
 * Where each neighbour of a dragged card leans: a share of how far the card has been taken from where it was picked up
 * (its header, and the cards hanging off it, follow a little), capped, so the whole cluster seems to give rather than the
 * one card sliding free of it. `kin` maps a neighbour to how closely it is tied (1 = the header or a child, less = a sibling).
 */
export function leanTargets(drag: Move, kin: ReadonlyMap<string, number>): Map<string, Move> {
  const out = new Map<string, Move>();
  const len = Math.hypot(drag.dx, drag.dy);
  if (len < 1) return out;
  for (const [id, share] of kin) {
    const want = Math.min(MAX_LEAN, len * 0.12 * share);
    out.set(id, { dx: (drag.dx / len) * want, dy: (drag.dy / len) * want });
  }
  return out;
}
