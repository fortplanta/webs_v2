// Merge freshly generated elements into the live Excalidraw scene.
// Elements whose generated content is unchanged are left exactly as the user has them (position,
// style). Elements whose content changed (ghost → filled) take the new look but keep the user's position.

import { convertToExcalidrawElements } from '@excalidraw/excalidraw';

type El = Record<string, any>;

/** Convert skeletons, then give bound label text deterministic ids (`<containerId>-label`). */
export function convertWithStableIds(skeletons: unknown[]): El[] {
  const els = convertToExcalidrawElements(skeletons as any, { regenerateIds: false }) as unknown as El[];
  // Safeguard: structured box data must survive conversion.
  const data = new Map((skeletons as El[]).filter(k => k.customData).map(k => [k.id as string, k.customData]));
  const rename = new Map<string, string>();
  for (const el of els) if (el.type === 'text' && el.containerId) rename.set(el.id, `${el.containerId}-label`);
  const mapped = els.map(el => {
    const next = { ...el };
    if (data.has(el.id) && !el.customData) next.customData = data.get(el.id);
    if (rename.has(el.id)) next.id = rename.get(el.id);
    if (Array.isArray(el.boundElements)) {
      next.boundElements = el.boundElements.map((b: El) => (rename.has(b.id) ? { ...b, id: rename.get(b.id) } : b));
    }
    return next;
  });
  return routeArrows(mapped);
}

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

export function signature(el: El): string {
  return [el.type, el.backgroundColor, el.strokeStyle, el.strokeColor, el.text ?? '', el.width, el.height].join('|');
}

export interface MergeResult {
  elements: El[];
  signatures: Map<string, string>;
}

export function mergeScene(prev: readonly El[], next: El[], applied: Map<string, string>): MergeResult {
  const prevById = new Map(prev.map(e => [e.id as string, e]));
  const nextById = new Map(next.map(e => [e.id as string, e]));
  const signatures = new Map<string, string>();

  const merged = next.map(el => {
    const sig = signature(el);
    signatures.set(el.id, sig);
    const old = prevById.get(el.id);
    if (old && applied.get(el.id) === sig) return old; // unchanged by us → keep user's version

    // New or changed: adopt the generated look, but follow wherever the user moved the container
    // (a label that is new still belongs to a container the user may have dragged).
    const anchorPrev = prevById.get(el.containerId ?? el.id);
    const anchorNext = nextById.get(el.containerId ?? el.id);
    if (!anchorPrev || !anchorNext) return el;
    return { ...el, x: el.x + (anchorPrev.x - anchorNext.x), y: el.y + (anchorPrev.y - anchorNext.y) };
  });

  // Keep anything the user added themselves.
  const ours = new Set(next.map(e => e.id));
  for (const e of prev) if (!ours.has(e.id) && !isGenerated(e.id)) merged.push(e);

  return { elements: merged, signatures };
}

function isGenerated(id: string): boolean {
  return /^(seed|kb-\d+|cluster-\d+|frag-\d+-\d+|edge-\d+)(-label)?$/.test(id);
}
