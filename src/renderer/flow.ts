// Direction without arrowheads: a connection is a plain line (gently curved, see curve.ts), and which way it runs is shown by a slow, faint
// brightening that travels along it from its origin toward its target and then rests before the next. Pure geometry
// and timing, so it can be tested; FlowOverlay.tsx paints it.

import { arrowPath, polylineLength, slicePolyline } from './curve';
import type { El } from './sceneEdit';

/** Seconds for one cycle of a pulse (travel plus rest). Slow on purpose: a web may have dozens of lines. */
export const PERIOD_S = 7;
/** Share of the cycle the pulse is travelling; the rest is stillness. */
const ACTIVE = 0.6;
/** Brightest the pulse gets (alpha of its colour over the line). */
export const PEAK_ALPHA = 0.4;
/** The pulse is this long, in screen px, or the whole line if shorter. */
export const PULSE_PX = 90;
/** Give up animating when this many lines are on screen, or when zoomed out this far (they are specks by then). */
export const MAX_EDGES = 80;
export const MIN_ZOOM = 0.15;

export interface FlowEdge {
  id: string;
  /** Scene coordinates of the origin and the target. */
  x1: number; y1: number; x2: number; y2: number;
  /** The line itself in scene coordinates (a polyline; many points when the line is curved). */
  path: number[][];
  /** Stroke width in scene units. */
  width: number;
  /** 0–1, from the id: lines are out of step with each other so the canvas breathes rather than blinks. */
  phase: number;
}

export interface Rect { x: number; y: number; width: number; height: number }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10_000) / 10_000; };

/** Directed connections: arrows flagged `customData.directed` (see flowify), straight or curved, with both ends known. */
export function flowEdges(elements: readonly El[]): FlowEdge[] {
  const out: FlowEdge[] = [];
  for (const e of elements) {
    if (e.isDeleted || e.type !== 'arrow' || !e.customData?.directed) continue;
    const path = arrowPath(e);
    if (path.length < 2) continue;
    const a = path[0], b = path[path.length - 1];
    const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
    if (Math.hypot(x2 - x1, y2 - y1) < 8) continue;
    out.push({ id: e.id, x1, y1, x2, y2, path, width: e.strokeWidth ?? 1, phase: hash(e.id) });
  }
  return out;
}

/** Things a pulse must pass behind: cards, headers, pictures and the labels sitting on lines. */
export function obstacles(elements: readonly El[]): Rect[] {
  const arrows = new Set(elements.filter(e => !e.isDeleted && e.type === 'arrow').map(e => e.id));
  return elements.filter(e => !e.isDeleted && ((e.type === 'rectangle' && e.customData?.kind) || e.type === 'image' || (e.type === 'text' && e.containerId && arrows.has(e.containerId))))
    .map(e => ({ x: e.x, y: e.y, width: e.width, height: e.height }));
}

/** 0 → 1 → 0 across the journey, so a pulse fades in at the origin and out at the target. */
export const envelope = (t: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 2;

export interface Pulse {
  /** Where the bright part starts and ends along the line, as fractions 0–1 (tail first). */
  from: number; to: number;
  /** 0–PEAK_ALPHA. */
  alpha: number;
}

/**
 * The pulse on `edge` at `seconds` for a line that is `lengthPx` long on screen, or null while it rests. It travels from
 * the origin to the target; the head arrives at the target as the tail catches up.
 */
export function pulseAt(edge: Pick<FlowEdge, 'phase'>, seconds: number, lengthPx: number): Pulse | null {
  const cycle = ((seconds / PERIOD_S + edge.phase) % 1 + 1) % 1;
  if (cycle >= ACTIVE) return null;
  const t = cycle / ACTIVE;
  const len = Math.min(1, PULSE_PX / Math.max(lengthPx, 1));
  // head runs from 0 to 1 + len so the whole pulse leaves the line at the target end
  const head = t * (1 + len);
  return { from: Math.max(0, head - len), to: Math.min(1, head), alpha: PEAK_ALPHA * envelope(t) };
}

/** Where a still, reduced-motion line shows its direction: a faint brightening toward the target end. */
export const STILL_PULSE: Pulse = { from: 0.45, to: 1, alpha: 0.2 };

/**
 * Older saved webs drew arrowheads. Turn them into plain lines that carry the direction flag instead (idempotent).
 * Tethers never had a direction and are left alone.
 */
export function flowify(scene: El[]): El[] {
  return scene.map(e => {
    if (e.type !== 'arrow' || e.isDeleted || e.customData?.kind === 'tether') return e;
    if (e.endArrowhead !== 'arrow' && e.startArrowhead !== 'arrow') return e;
    return { ...e, startArrowhead: null, endArrowhead: null, customData: { ...e.customData, directed: true }, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) };
  });
}

/** The part of a line a pulse covers (scene coordinates, tail first), and how long the whole line is. */
export function pulsePath(edge: Pick<FlowEdge, 'path'>, pulse: Pick<Pulse, 'from' | 'to'>): number[][] { return slicePolyline(edge.path, pulse.from, pulse.to); }
export const edgeLength = (edge: Pick<FlowEdge, 'path'>): number => polylineLength(edge.path);
