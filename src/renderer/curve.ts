// Connections are gently bowed rather than ruled straight. An arrow is given four points (its two ends and two on a shallow
// bow between them) and Excalidraw's "round" arrow style draws a smooth curve through them. The bow's side and depth come
// from the arrow's id, so every line leans its own way but the same line always leans the same way. This file is the
// geometry only, including the exact curve Excalidraw draws (Catmull-Rom through the points, ends doubled), so the pulse
// painted along a line and clicks on it follow the line you can see.

import { noise } from './layout/noise';

export interface P { x: number; y: number }

/** Excalidraw's "round" arrow: smooth curve through the points. */
export const ROUND = { type: 2 } as const;

/** A line shorter than this stays straight (a bow would only make it wobble). */
const MIN_BOW_LENGTH = 90;
/** The bow is this share of the line's length (with a steady variation), and never more than MAX_BOW px. */
const BOW_SHARE = 0.075, MAX_BOW = 80;

/** How far (signed, perpendicular to the line) the line `key` of the given length bows. */
export function bowOf(key: string, length: number): number {
  if (length < MIN_BOW_LENGTH) return 0;
  const side = noise(key, 'side') < 0 ? -1 : 1;
  const depth = 0.7 + 0.6 * Math.abs(noise(key, 'depth'));
  return side * Math.min(MAX_BOW, length * BOW_SHARE * depth);
}

/** The points of an arrow from `a` to `b`, relative to `a`: the ends and two on a bow between them. */
export function bowedPoints(a: P, b: P, key: string): number[][] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const bow = bowOf(key, len);
  if (!bow || !len) return [[0, 0], [dx / 3, dy / 3], [(2 * dx) / 3, (2 * dy) / 3], [dx, dy]];
  const nx = -dy / len, ny = dx / len;
  return [[0, 0], [dx / 3 + nx * bow, dy / 3 + ny * bow], [(2 * dx) / 3 + nx * bow * 0.8, (2 * dy) / 3 + ny * bow * 0.8], [dx, dy]];
}

type Bez = [number[], number[], number[], number[]];

/** The cubic segments Excalidraw (rough.js) draws through `pts`: Catmull-Rom with the end points doubled. */
export function curveBeziers(pts: ReadonlyArray<ReadonlyArray<number>>): Bez[] {
  if (pts.length < 3) return [];
  if (pts.length === 3) return [[[...pts[0]], [...pts[1]], [...pts[2]], [...pts[2]]]];
  const p: number[][] = [[...pts[0]], [...pts[0]]];
  for (let i = 1; i < pts.length; i++) { p.push([...pts[i]]); if (i === pts.length - 1) p.push([...pts[i]]); }
  const out: Bez[] = [];
  for (let i = 1; i + 2 < p.length; i++) {
    out.push([
      p[i],
      [p[i][0] + (p[i + 1][0] - p[i - 1][0]) / 6, p[i][1] + (p[i + 1][1] - p[i - 1][1]) / 6],
      [p[i + 1][0] + (p[i][0] - p[i + 2][0]) / 6, p[i + 1][1] + (p[i][1] - p[i + 2][1]) / 6],
      p[i + 1],
    ]);
  }
  return out;
}

const at = (b: Bez, t: number): number[] => {
  const u = 1 - t, a = u * u * u, c = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * b[0][0] + c * b[1][0] + d * b[2][0] + e * b[3][0], a * b[0][1] + c * b[1][1] + d * b[2][1] + e * b[3][1]];
};

/** The curve through `pts` as a polyline (relative coordinates), `perSegment` samples per cubic. */
export function sampleCurve(pts: ReadonlyArray<ReadonlyArray<number>>, perSegment = 14): number[][] {
  const segs = curveBeziers(pts);
  if (!segs.length) return pts.map(p => [...p]);
  const out: number[][] = [[...segs[0][0]]];
  for (const s of segs) for (let k = 1; k <= perSegment; k++) out.push(at(s, k / perSegment));
  return out;
}

/** The middle of the curve through `pts` (relative coordinates): where a label sits. */
export function curveMiddle(pts: ReadonlyArray<ReadonlyArray<number>>): number[] {
  const line = sampleCurve(pts, 20), len = polylineLength(line);
  return pointAlong(line, len / 2);
}

export const polylineLength = (line: ReadonlyArray<ReadonlyArray<number>>): number => { let n = 0; for (let i = 1; i < line.length; i++) n += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return n; };

/** The point `distance` along a polyline. */
export function pointAlong(line: ReadonlyArray<ReadonlyArray<number>>, distance: number): number[] {
  let left = Math.max(0, distance);
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (left <= d && d > 0) { const t = left / d; return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t]; }
    left -= d;
  }
  return [...line[line.length - 1]];
}

/** The piece of a polyline between fractions `from` and `to` (0–1 of its length), with the points on it. */
export function slicePolyline(line: ReadonlyArray<ReadonlyArray<number>>, from: number, to: number): number[][] {
  const total = polylineLength(line);
  if (total === 0 || to <= from) return [];
  const a = from * total, b = to * total, out: number[][] = [pointAlong(line, a)];
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    run += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (run > a && run < b) out.push([...line[i]]);
  }
  out.push(pointAlong(line, b));
  return out;
}

type El = Record<string, any>;

/** A connection we draw as a curve: ours (a tether, or a line flagged as directed), bound at both ends. */
export const isCurved = (e: El): boolean => e.type === 'arrow' && !e.isDeleted && !!e.startBinding && !!e.endBinding && (e.customData?.kind === 'tether' || !!e.customData?.directed);

/** An arrow's visible path in scene coordinates: the curve if it is one, else its straight segments. */
export function arrowPath(e: El): number[][] {
  const pts: number[][] = e.points ?? [];
  const rel = e.roundness && pts.length >= 3 ? sampleCurve(pts) : pts;
  return rel.map(p => [e.x + p[0], e.y + p[1]]);
}
