// One frame of the canvas's life, as a pure function of the scene and the clock: cards flying in, overlaps eased apart with
// springs, a dragged card's neighbours leaning toward it and easing back, and curved connections re-aimed at their boxes.
// The hook in useLiveLayout.ts calls this once per animation frame and writes the result to Excalidraw.

import { type Arrival, applyOpacity, stepArrivals } from '../arrival';
import { rerouteCurves } from '../routeArrows';
import { addMoves, LEAN_SPRING, leanTargets, type Move, type Spring, stepSpring, stepSprings } from '../motion';
import { defaultEngineConfig, step, type LayoutNode, type Tether } from './engine';
import { applyMoves, buildNodes } from './sceneNodes';

type El = Record<string, any>;

export interface Lean { offset: Move; velocity: { vx: number; vy: number } }

export interface MotionState {
  springs: Map<string, Spring>;
  lean: Map<string, Lean>;
  arrivals: Arrival[];
  /** Where each held node was when it was picked up. */
  pickedUp: Map<string, { x: number; y: number }>;
  /** Time of the last frame (ms), 0 before the first. */
  last: number;
}

export const newMotionState = (): MotionState => ({ springs: new Map(), lean: new Map(), arrivals: [], pickedUp: new Map(), last: 0 });

/** The layout's whole correction (not a fraction): springs do the easing. */
const WHOLE: typeof defaultEngineConfig = { ...defaultEngineConfig, gain: 1, maxStep: 1e9 };

export interface FrameResult {
  elements: El[];
  /** More frames are needed (something is still moving). */
  active: boolean;
}

/** Nodes tied to a held node, and how closely: its header and children fully, its siblings (cards on the same header) by half. */
export function kinOf(held: ReadonlySet<string>, tethers: readonly Tether[], skip: ReadonlySet<string>): Map<string, number> {
  const kin = new Map<string, number>();
  const put = (id: string, share: number) => { if (!held.has(id) && !skip.has(id)) kin.set(id, Math.max(kin.get(id) ?? 0, share)); };
  for (const t of tethers) {
    if (held.has(t.child)) { put(t.anchor, 1); for (const s of tethers) if (s.anchor === t.anchor && s.child !== t.child) put(s.child, 0.5); }
    if (held.has(t.anchor)) put(t.child, 1);
  }
  return kin;
}

export function motionFrame(elements: El[], heldElementIds: ReadonlySet<string>, state: MotionState, now: number, layoutOn: boolean): FrameResult & { state: MotionState } {
  const dt = state.last ? Math.min(3, Math.max(0.5, (now - state.last) / (1000 / 60))) : 1;
  let { springs, lean, arrivals, pickedUp } = state;
  const { nodes, tethers, members } = buildNodes(elements, heldElementIds);
  let moves = new Map<string, Move>();
  let busy = false;

  // cards in flight are not obstacles while they fly (they start on top of what they grew from)
  const flying = new Set(arrivals.map(a => a.node));
  const arrival = stepArrivals(arrivals, now);
  arrivals = arrival.remaining;
  moves = addMoves(moves, arrival.moves);
  if (arrivals.length) busy = true;

  if (layoutOn) {
    const solve: LayoutNode[] = nodes.filter(n => !flying.has(n.id));
    const tied = tethers.filter(t => !flying.has(t.anchor) && !flying.has(t.child));
    const r = step(solve, tied, WHOLE);
    const positions = new Map(solve.map(n => [n.id, { x: n.x, y: n.y }]));
    const held = new Set(solve.filter(n => n.pinned).map(n => n.id));
    const sp = stepSprings(springs, positions, r.moves, held, dt);
    springs = sp.springs;
    moves = addMoves(moves, sp.moves);
    if (springs.size || r.maxMove > 0) busy = true;

    // neighbours of a dragged card lean toward it, then ease back once it is let go
    const targets = new Map<string, Move>();
    if (held.size) {
      const byId = new Map(solve.map(n => [n.id, n]));
      pickedUp = new Map(pickedUp);
      for (const id of held) if (!pickedUp.has(id)) { const n = byId.get(id)!; pickedUp.set(id, { x: n.x, y: n.y }); }
      let dx = 0, dy = 0, k = 0;
      for (const id of held) { const n = byId.get(id), p = pickedUp.get(id); if (n && p) { dx += n.x - p.x; dy += n.y - p.y; k++; } }
      if (k) {
        const skip = new Set([...flying, ...solve.filter(n => n.locked).map(n => n.id)]);
        for (const [id, t] of leanTargets({ dx: dx / k, dy: dy / k }, kinOf(held, tied, skip))) targets.set(id, t);
      }
    } else if (pickedUp.size) pickedUp = new Map();
    const nextLean = new Map<string, Lean>();
    for (const id of new Set([...lean.keys(), ...targets.keys()])) {
      if (!positions.has(id)) continue;
      const cur = lean.get(id) ?? { offset: { dx: 0, dy: 0 }, velocity: { vx: 0, vy: 0 } };
      const goal = targets.get(id) ?? { dx: 0, dy: 0 };
      const rs = stepSpring({ gx: goal.dx, gy: goal.dy, vx: cur.velocity.vx, vy: cur.velocity.vy }, cur.offset.dx, cur.offset.dy, dt, LEAN_SPRING);
      if (rs.move.dx || rs.move.dy) moves = addMoves(moves, new Map([[id, rs.move]]));
      const offset = { dx: cur.offset.dx + rs.move.dx, dy: cur.offset.dy + rs.move.dy };
      if (rs.next) nextLean.set(id, { offset, velocity: { vx: rs.next.vx, vy: rs.next.vy } });
      else if (goal.dx || goal.dy) nextLean.set(id, { offset, velocity: { vx: 0, vy: 0 } }); // arrived and holding there
    }
    lean = nextLean;
    if (lean.size) busy = true;
  } else { springs = new Map(); lean = new Map(); pickedUp = new Map(); }

  let out = moves.size ? applyMoves(elements, moves, members) : elements;
  out = applyOpacity(out, arrival.opacity);
  if (layoutOn) out = rerouteCurves(out);
  return { elements: out, active: busy, state: { springs, lean, arrivals, pickedUp, last: now } };
}
