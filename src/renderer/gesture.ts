// The link/branch/cut gesture, modelled on Blender's Node Wrangler. Drag from a card to another card to link them, from
// a card into empty space to branch out of it (a new card, or a new angle), and, starting in empty space, drag across
// connections to cut them. Held with the right mouse button, or with L (link, branch) or K (knife, cut) held down while
// dragging with the left. Pure geometry and decisions, so they can be tested; CanvasView wires the pointer to them.

import type { El } from './sceneEdit';

export interface Pt { x: number; y: number }

/** Below this many screen pixels a right-button press is a click (a context menu), not a drag. */
export const DRAG_PX = 6;

export type GestureMode = 'link' | 'cut';

/** What a gesture started on `startKind` does: from a card or header it links/branches; from empty canvas it cuts. */
export function modeFor(startKind: 'fragment' | 'cluster' | 'image' | 'edge' | null, held: 'l' | 'k' | null): GestureMode | null {
  if (held === 'k') return 'cut';
  if (held === 'l') return startKind && startKind !== 'edge' ? 'link' : null;
  return startKind && startKind !== 'edge' ? 'link' : 'cut';
}

/** Do segments p1–p2 and p3–p4 cross? */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export interface Cut { id: string; kind: 'tether' | 'link' }

/**
 * The connections a stroke from `a` to `b` (scene coordinates) crosses. Tethers are "unstuck", other lines removed.
 * A line from the origin to a collection is never cut: it is what keeps a collection part of the web.
 */
export function cutTargets(elements: readonly El[], a: Pt, b: Pt): Cut[] {
  const out: Cut[] = [];
  for (const e of elements) {
    if (e.isDeleted || e.type !== 'arrow' || !Array.isArray(e.points) || e.points.length < 2) continue;
    if (/^origin-\d+$/.test(e.id)) continue;
    for (let k = 0; k < e.points.length - 1; k++) {
      const p = { x: e.x + e.points[k][0], y: e.y + e.points[k][1] }, q = { x: e.x + e.points[k + 1][0], y: e.y + e.points[k + 1][1] };
      if (segmentsCross(a, b, p, q)) { out.push({ id: e.id, kind: e.customData?.kind === 'tether' ? 'tether' : 'link' }); break; }
    }
  }
  return out;
}
