// Geometry for bound arrows. Kept free of Excalidraw imports so it can be used (and tested) anywhere.

import { bowedPoints, curveMiddle, isCurved, ROUND } from './curve';

type El = Record<string, any>;

/**
 * The converter binds arrows to their endpoints but leaves the geometry as a stub at the origin.
 * Route each bound arrow center-to-center, clipped to the endpoint boxes, and center its label.
 */
export function routeArrows(els: El[]): El[] {
  const byId = new Map(els.map(e => [e.id as string, e]));
  const clip = (box: El, toward: { x: number; y: number }) => {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const dx = toward.x - cx, dy = toward.y - cy;
    const t = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  };
  const mids = new Map<string, { x: number; y: number }>();

  const routed = els.map(el => {
    if (el.type !== 'arrow' || !el.startBinding || !el.endBinding) return el;
    const a = byId.get(el.startBinding.elementId), b = byId.get(el.endBinding.elementId);
    if (!a || !b) return el;

    const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const p1 = clip(a, cb), p2 = clip(b, ca);
    if (isCurved(el)) {
      // a gentle bow, not a ruled line (see curve.ts); the label sits at the middle of the curve
      const points = bowedPoints(p1, p2, el.id);
      const mid = curveMiddle(points);
      mids.set(el.id, { x: p1.x + mid[0], y: p1.y + mid[1] });
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      return { ...el, x: p1.x, y: p1.y, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), points, roundness: ROUND };
    }
    mids.set(el.id, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    return { ...el, x: p1.x, y: p1.y, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), points: [[0, 0], [p2.x - p1.x, p2.y - p1.y]] };
  });

  return routed.map(el => {
    const mid = el.type === 'text' && el.containerId ? mids.get(el.containerId) : undefined;
    return mid ? { ...el, x: mid.x - el.width / 2, y: mid.y - el.height / 2 } : el;
  });
}

const bumped = (e: El): El => ({ ...e, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/**
 * Re-aim our curved connections (and their labels) at where their boxes are now, leaving anything already right alone.
 * Excalidraw moves a bound arrow's ends itself when a box is dragged, but knows nothing of the bow in between, so a curve is
 * redrawn here. Returns the same array when nothing needed changing, so callers can tell.
 */
export function rerouteCurves(els: El[]): El[] {
  if (!els.some(isCurved)) return els;
  const routed = routeArrows(els);
  const byId = new Map(els.map(e => [e.id as string, e]));
  let changed = false;
  const out = els.map((e, i) => {
    const r = routed[i];
    if (isCurved(e)) {
      const same = near(e.x, r.x) && near(e.y, r.y) && e.points?.length === r.points.length && e.points.every((p: number[], k: number) => near(p[0], r.points[k][0]) && near(p[1], r.points[k][1])) && !!e.roundness;
      if (same) return e;
      changed = true; return bumped(r);
    }
    if (e.type === 'text' && e.containerId && isCurved(byId.get(e.containerId) ?? {}) && !(near(e.x, r.x) && near(e.y, r.y))) { changed = true; return bumped(r); }
    return e;
  });
  return changed ? out : els;
}
