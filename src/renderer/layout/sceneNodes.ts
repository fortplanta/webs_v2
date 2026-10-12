// Bridge between Excalidraw elements and the layout engine.
//
// A *node* is one movable unit on the canvas: a box with its bound label, or a whole group (an image card and its
// image). Arrows, lines and free drawing are never nodes — they follow the nodes they are bound to. A *tether* is a
// connector arrow flagged with `customData.kind === 'tether'`: it runs anchor → child and carries the maximum
// center distance.

import { routeArrows } from '../routeArrows';
import type { LayoutNode, Tether } from './engine';

type El = Record<string, any>;

export const TETHER_KIND = 'tether';
export const isTether = (e: El): boolean => e?.type === 'arrow' && e.customData?.kind === TETHER_KIND && !e.isDeleted;

const CONNECTORS = new Set(['arrow', 'line', 'freedraw']);
const live = (e: El) => !e.isDeleted;
const bump = (el: El): El => ({ ...el, version: (el.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });

export interface SceneNodes {
  nodes: LayoutNode[];
  tethers: Tether[];
  /** node id → ids of every element that moves with it. */
  members: Map<string, string[]>;
}

/** Axis-aligned bounds of an element, accounting for rotation. */
export function bounds(e: El): { x: number; y: number; w: number; h: number } {
  const w = e.width ?? 0, h = e.height ?? 0, a = e.angle ?? 0;
  if (!a) return { x: e.x, y: e.y, w, h };
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const bw = w * cos + h * sin, bh = w * sin + h * cos;
  return { x: e.x + w / 2 - bw / 2, y: e.y + h / 2 - bh / 2, w: bw, h: bh };
}

export function buildNodes(elements: readonly El[], pinned: ReadonlySet<string> = new Set()): SceneNodes {
  const els = elements.filter(live);
  const byId = new Map(els.map(e => [e.id as string, e]));

  // Which node does each element belong to?
  const nodeOf = new Map<string, string>();
  const unitKey = (e: El): string | null => {
    if (CONNECTORS.has(e.type)) return null;
    if (e.type === 'text' && e.containerId) {
      const c = byId.get(e.containerId);
      return !c || CONNECTORS.has(c.type) ? null : unitKey(c);
    }
    const g = e.groupIds?.length ? e.groupIds[e.groupIds.length - 1] : null;
    if (g) return `group:${g}`;
    const owner = e.customData?.card && byId.has(e.customData.card) ? byId.get(e.customData.card)! : null;
    if (owner && owner !== e) return unitKey(owner);
    return e.id;
  };
  const members = new Map<string, string[]>();
  for (const e of els) {
    const k = unitKey(e);
    if (!k) continue;
    nodeOf.set(e.id, k);
    members.set(k, [...(members.get(k) ?? []), e.id]);
  }

  const nodes: LayoutNode[] = [];
  for (const [id, ids] of members) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, locked = false, isPinned = false;
    for (const mid of ids) {
      const e = byId.get(mid)!;
      locked ||= !!e.locked;
      isPinned ||= pinned.has(mid);
      if (e.type === 'text' && e.containerId) continue; // inside its box
      const b = bounds(e);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    if (!isFinite(x0)) continue;
    nodes.push({ id, x: x0, y: y0, w: x1 - x0, h: y1 - y0, pinned: isPinned || undefined, locked: locked || undefined });
  }

  const tethers: Tether[] = [];
  for (const e of els) {
    if (!isTether(e) || !e.startBinding || !e.endBinding) continue;
    const anchor = nodeOf.get(e.startBinding.elementId), child = nodeOf.get(e.endBinding.elementId);
    const max = Number(e.customData.max);
    if (anchor && child && anchor !== child && max > 0) tethers.push({ anchor, child, max });
  }
  return { nodes, tethers, members };
}

/** Shift each node's members by its move, then re-route the arrows bound to anything that moved. */
export function applyMoves(elements: readonly El[], moves: ReadonlyMap<string, { dx: number; dy: number }>, members: ReadonlyMap<string, string[]>): El[] {
  if (!moves.size) return elements as El[];
  const delta = new Map<string, { dx: number; dy: number }>();
  for (const [node, m] of moves) for (const id of members.get(node) ?? []) delta.set(id, m);

  let out = elements.map(e => {
    const d = delta.get(e.id);
    return d ? bump({ ...e, x: e.x + d.dx, y: e.y + d.dy }) : e;
  });

  // Arrows with both ends bound: re-route clipped to the boxes. One end bound: carry that end along.
  const byId = new Map(out.map(e => [e.id as string, e]));
  const affected = new Set<string>();
  const carried = new Map<string, El>();
  for (const e of out) {
    if (e.type !== 'arrow' || e.isDeleted) continue;
    const s = e.startBinding && delta.get(e.startBinding.elementId), t = e.endBinding && delta.get(e.endBinding.elementId);
    if (!s && !t) continue;
    if (e.startBinding && e.endBinding && byId.has(e.startBinding.elementId) && byId.has(e.endBinding.elementId)) { affected.add(e.id); continue; }
    const pts: number[][] = e.points.map((p: number[]) => [...p]);
    let { x, y } = e;
    if (s) { x += s.dx; y += s.dy; for (let i = 1; i < pts.length; i++) { pts[i][0] -= s.dx; pts[i][1] -= s.dy; } }
    if (t) { const last = pts[pts.length - 1]; last[0] += t.dx; last[1] += t.dy; }
    carried.set(e.id, bump({ ...e, x, y, points: pts }));
  }
  if (carried.size) out = out.map(e => carried.get(e.id) ?? e);
  if (affected.size) {
    const routed = routeArrows(out);
    out = out.map((e, i) => {
      const r = routed[i];
      const isLabel = e.type === 'text' && e.containerId && affected.has(e.containerId);
      return (affected.has(e.id) || isLabel) && r !== e ? bump(r) : e;
    });
  }
  return out;
}
