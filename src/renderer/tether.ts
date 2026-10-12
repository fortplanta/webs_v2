// Tethers: a card that is stuck to an anchor (a theme label, say) may be dragged around but never far from it.
// A tether is a thin connector line bound anchor → card, flagged in `customData`, so the connection is visible and
// the layout engine can read the limit straight off the scene (see layout/sceneNodes.ts). A card has one anchor.

import { leash } from './layout/leash';
import { sendToBack } from './pivot';
import type { El } from './sceneEdit';

export const TETHER_KIND = 'tether';
export { MIN_TETHER } from './layout/leash';

export const isTetherEl = (e: El): boolean => e?.type === 'arrow' && e.customData?.kind === TETHER_KIND && !e.isDeleted;

const bump = (e: El): El => ({ ...e, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
const center = (e: El) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

/** How far a card may stray: its present distance plus generous give (see layout/leash.ts). */
export function tetherLimit(anchor: El, child: El): number {
  const a = center(anchor), c = center(child);
  return leash(Math.hypot(c.x - a.x, c.y - a.y));
}

/** The tether connecting `childId` to its anchor, if any. */
export function tetherOf(elements: readonly El[], childId: string): El | undefined {
  return elements.find(e => isTetherEl(e) && e.endBinding?.elementId === childId);
}

/** True if `id` is (transitively) tethered below `ancestorId` — sticking them the other way round would make a loop. */
function isBelow(elements: readonly El[], id: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  for (let cur = id; !seen.has(cur);) {
    seen.add(cur);
    const t = tetherOf(elements, cur);
    if (!t) return false;
    cur = t.startBinding.elementId;
    if (cur === ancestorId) return true;
  }
  return false;
}

/** Detach `childId` from its anchor (soft-deletes the line and clears the bindings that pointed at it). */
export function removeTether(elements: El[], childId: string): El[] {
  const t = tetherOf(elements, childId);
  if (!t) return elements;
  return elements.map(e => {
    if (e.id === t.id) return bump({ ...e, isDeleted: true });
    if (e.boundElements?.some((b: El) => b.id === t.id)) return bump({ ...e, boundElements: e.boundElements.filter((b: El) => b.id !== t.id) });
    return e;
  });
}

export const tetherId = (childId: string) => `${childId}-tether`;

/**
 * Stick `childId` to `anchorId`. Replaces any earlier anchor; refuses (returns the scene unchanged) for missing
 * elements, self-tethers and loops. `makeArrow` turns a raw arrow into a complete element (Excalidraw's restore).
 */
export function addTether(elements: El[], anchorId: string, childId: string, makeArrow: (raw: El) => El, max?: number): El[] {
  const anchor = elements.find(e => e.id === anchorId && !e.isDeleted), child = elements.find(e => e.id === childId && !e.isDeleted);
  if (!anchor || !child || anchorId === childId || isBelow(elements, anchorId, childId)) return elements;

  let out = removeTether(elements, childId);
  const id = tetherId(childId);
  out = out.filter(e => e.id !== id); // a stale soft-deleted line with the same id would clash
  const a = center(anchor), c = center(child);
  const arrow = makeArrow({
    type: 'arrow', id, x: a.x, y: a.y, width: Math.abs(c.x - a.x), height: Math.abs(c.y - a.y), points: [[0, 0], [c.x - a.x, c.y - a.y]],
    startBinding: { elementId: anchorId, focus: 0, gap: 4 }, endBinding: { elementId: childId, focus: 0, gap: 4 },
    startArrowhead: null, endArrowhead: null, strokeColor: '#1a1a1a', strokeWidth: 1, strokeStyle: 'dotted', opacity: 55, roundness: null,
    customData: { kind: TETHER_KIND, max: max ?? tetherLimit(anchor, child) },
  });
  out = out.map(e => (e.id === anchorId || e.id === childId ? bump({ ...e, boundElements: [...(e.boundElements ?? []), { type: 'arrow', id }] }) : e));
  return sendToBack([...out, arrow], [id]);
}
