import type { El } from './sceneEdit';

export type Hit = { id: string; kind: 'fragment' | 'cluster' | 'image' | 'edge' };

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Point-in-box, honouring the element's rotation (about its own center). */
function inside(e: El, x: number, y: number): boolean {
  let px = x, py = y;
  if (e.angle) {
    const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
    const c = Math.cos(-e.angle), s = Math.sin(-e.angle);
    px = cx + (x - cx) * c - (y - cy) * s;
    py = cy + (x - cx) * s + (y - cy) * c;
  }
  return px >= e.x && px <= e.x + e.width && py >= e.y && py <= e.y + e.height;
}

/**
 * What editable thing (if any) is at scene point (x, y)? Follows stacking order — the topmost wins, as it
 * does on screen — so a thread drawn behind a card never steals clicks meant for that card.
 */
export function hitTest(elements: readonly El[], x: number, y: number, zoom: number): Hit | null {
  // A line gets a generous grab margin in empty space, but over a card it must nearly touch the pointer: zoomed out, a
  // wide margin would otherwise let a line passing close to a card steal clicks meant for the card.
  const overCard = elements.some(e => !e.isDeleted && e.type === 'rectangle' && ['fragment', 'cluster', 'image-card'].includes(e.customData?.kind) && inside(e, x, y));
  const tolerance = (overCard ? 3 : 10) / (zoom || 1);
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    if (e.isDeleted) continue;

    if (e.type === 'arrow' && Array.isArray(e.points) && e.points.length >= 2) {
      for (let k = 0; k < e.points.length - 1; k++) {
        const [a, b] = [e.points[k], e.points[k + 1]];
        if (distToSegment(x, y, e.x + a[0], e.y + a[1], e.x + b[0], e.y + b[1]) <= tolerance) return { id: e.id, kind: 'edge' };
      }
      continue;
    }
    if (e.type === 'text' && e.containerId) {
      const owner = elements.find(o => o.id === e.containerId && !o.isDeleted);
      if (owner?.type === 'arrow' && inside(e, x, y)) return { id: owner.id, kind: 'edge' };
      continue;
    }
    const k = e.customData?.kind;
    const kind = k === 'image-card' ? 'image' : k;
    if (e.type !== 'rectangle' || (kind !== 'fragment' && kind !== 'cluster' && kind !== 'image')) continue;
    if (inside(e, x, y)) return { id: e.id, kind };
  }
  return null;
}
