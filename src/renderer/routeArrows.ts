// Geometry for bound arrows. Kept free of Excalidraw imports so it can be used (and tested) anywhere.

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
    mids.set(el.id, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    return { ...el, x: p1.x, y: p1.y, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), points: [[0, 0], [p2.x - p1.x, p2.y - p1.y]] };
  });

  return routed.map(el => {
    const mid = el.type === 'text' && el.containerId ? mids.get(el.containerId) : undefined;
    return mid ? { ...el, x: mid.x - el.width / 2, y: mid.y - el.height / 2 } : el;
  });
}
