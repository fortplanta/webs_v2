// New cards do not just appear: each flies out from what it grew from (a collection's header from the topic, a card from its
// header) with a little overshoot, fading in as it goes, its connecting line stretching out behind it. `stageArrivals` takes a
// scene about to be shown and sets the new nodes at their starting points, invisible; `stepArrivals` then carries them to their
// places frame by frame. Pure functions of the scene and the clock.

import { arrivalDelay, flightOffset, flightOpacity, flightProgress, type Flight, type Move } from './motion';
import { applyMoves, buildNodes } from './layout/sceneNodes';
import { ORIGIN_IDS } from './origin';

type El = Record<string, any>;

export interface Arrival {
  node: string;
  /** Every element that moves with the node. */
  members: string[];
  flight: Flight;
  /** What has been added to the node's place so far (its flight offset as of the last frame). */
  applied: Move;
  /** Opacity each member should end at. */
  base: Map<string, number>;
  /** Connections to or from it: they fade in with the slower of their two ends. */
  lines: Array<{ id: string; base: number; ends: string[] }>;
}

/** A card is far enough from where it grew from to be worth a flight. */
const MIN_FLIGHT = 60;

const bump = (e: El): El => ({ ...e, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });

/** Which line to follow back to what a new node grew out of: its tether, then a thread, then any other. */
const rank = (a: El): number => (a.customData?.kind === 'tether' ? 0 : a.customData?.directed && /^(origin|edge)-/.test(a.id) ? 1 : a.customData?.directed ? 2 : 3);

export function stageArrivals(prev: readonly El[], next: El[], now: number): { elements: El[]; arrivals: Arrival[] } {
  const before = new Set(prev.filter(e => !e.isDeleted).map(e => e.id as string));
  const { nodes, members } = buildNodes(next);
  const nodeOfEl = new Map<string, string>();
  for (const [node, ids] of members) for (const id of ids) nodeOfEl.set(id, node);
  const byNode = new Map(nodes.map(n => [n.id, n]));
  const byId = new Map(next.map(e => [e.id as string, e]));

  const fresh = nodes.filter(n => !n.locked && !ORIGIN_IDS.has(n.id) && (members.get(n.id) ?? []).every(id => !before.has(id)));
  if (!fresh.length) return { elements: next, arrivals: [] };
  const freshIds = new Set(fresh.map(n => n.id));

  const arrows = next.filter(e => e.type === 'arrow' && !e.isDeleted && e.startBinding && e.endBinding);
  const anchorOf = (node: string): string | null => {
    const mine = arrows.filter(a => nodeOfEl.get(a.endBinding.elementId) === node && nodeOfEl.get(a.startBinding.elementId) && nodeOfEl.get(a.startBinding.elementId) !== node);
    mine.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : 1));
    return mine.length ? nodeOfEl.get(mine[0].startBinding.elementId)! : null;
  };
  const isCard = (node: string) => { const main = byId.get(node) ?? byId.get((members.get(node) ?? [])[0]); return main?.customData?.kind === 'fragment' || main?.customData?.kind === 'image-card' || /^frag-/.test(node); };

  const ordered = [...fresh].sort((a, b) => Number(isCard(a.id)) - Number(isCard(b.id)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const moves = new Map<string, Move>();
  const arrivals: Arrival[] = [];
  const perGroup = new Map<string, number>();
  for (const n of ordered) {
    const anchor = anchorOf(n.id);
    const a = anchor ? byNode.get(anchor) : null;
    if (!a) continue;
    const from = { dx: a.x + a.w / 2 - (n.x + n.w / 2), dy: a.y + a.h / 2 - (n.y + n.h / 2) };
    if (Math.hypot(from.dx, from.dy) < MIN_FLIGHT) continue;
    const group = `${isCard(n.id) ? 'c' : 'h'}:${anchor}`;
    const order = perGroup.get(group) ?? 0; perGroup.set(group, order + 1);
    moves.set(n.id, from);
    arrivals.push({ node: n.id, members: members.get(n.id) ?? [], flight: { from, start: now + arrivalDelay(order, isCard(n.id)) }, applied: from, base: new Map(), lines: [] });
  }
  if (!arrivals.length) return { elements: next, arrivals: [] };

  let out = applyMoves(next, moves, members);
  const flying = new Set(arrivals.map(a => a.node));
  const lineIds = new Set<string>();
  for (const a of out) {
    if (a.type !== 'arrow' || a.isDeleted || !a.startBinding || !a.endBinding) continue;
    const ends = [nodeOfEl.get(a.startBinding.elementId), nodeOfEl.get(a.endBinding.elementId)].filter((x): x is string => !!x && flying.has(x));
    if (!ends.length) continue;
    lineIds.add(a.id);
    const rec = { id: a.id as string, base: a.opacity ?? 100, ends };
    for (const e of ends) arrivals.find(r => r.node === e)!.lines.push(rec);
    for (const t of out) if (t.type === 'text' && t.containerId === a.id) { lineIds.add(t.id); for (const e of ends) arrivals.find(r => r.node === e)!.lines.push({ id: t.id, base: t.opacity ?? 100, ends }); }
  }
  const baseOf = new Map<string, number>();
  for (const r of arrivals) for (const id of r.members) { const e = byId.get(id); const o = e?.opacity ?? 100; r.base.set(id, o); baseOf.set(id, o); }
  out = out.map(e => (baseOf.has(e.id) || lineIds.has(e.id) ? bump({ ...e, opacity: 0 }) : e));
  return { elements: out, arrivals };
}

/** Opacity each element should have right now, for everything still in flight. */
export function opacityNow(arrivals: readonly Arrival[], now: number): Map<string, number> {
  const out = new Map<string, number>();
  const progress = new Map(arrivals.map(a => [a.node, flightOpacity(a.flight, now)]));
  for (const a of arrivals) {
    const k = progress.get(a.node)!;
    for (const [id, base] of a.base) out.set(id, Math.round(base * k));
    for (const line of a.lines) {
      const f = Math.min(...line.ends.map(e => progress.get(e) ?? 1));
      out.set(line.id, Math.min(out.get(line.id) ?? 100, Math.round(line.base * f)));
    }
  }
  return out;
}

export interface ArrivalStep { moves: Map<string, Move>; opacity: Map<string, number>; remaining: Arrival[] }

/** Carry every arrival on to where it should be at `now`. Lines fade in; once a flight is over its node is left exactly in place. */
export function stepArrivals(arrivals: readonly Arrival[], now: number): ArrivalStep {
  const moves = new Map<string, Move>(), remaining: Arrival[] = [];
  const opacity = opacityNow(arrivals, now);
  for (const a of arrivals) {
    const off = flightOffset(a.flight, now);
    const d = { dx: off.dx - a.applied.dx, dy: off.dy - a.applied.dy };
    if (d.dx || d.dy) moves.set(a.node, d);
    if (flightProgress(a.flight, now) < 1) remaining.push({ ...a, applied: off });
  }
  // a finished arrival's elements go back to their own opacity
  const live = new Set(remaining.map(a => a.node));
  for (const a of arrivals) if (!live.has(a.node)) { for (const [id, base] of a.base) opacity.set(id, base); for (const l of a.lines) if (!l.ends.some(e => live.has(e))) opacity.set(l.id, l.base); }
  return { moves, opacity, remaining };
}

/** Set opacities on the scene (only where they differ). Returns the same array when nothing changed. */
export function applyOpacity(elements: El[], opacity: ReadonlyMap<string, number>): El[] {
  if (!opacity.size) return elements;
  let changed = false;
  const out = elements.map(e => { const o = opacity.get(e.id); if (o === undefined || (e.opacity ?? 100) === o) return e; changed = true; return bump({ ...e, opacity: o }); });
  return changed ? out : elements;
}
