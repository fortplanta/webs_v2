// Merge freshly generated elements into the live Excalidraw scene.
// Elements whose generated content is unchanged are left exactly as the user has them (position,
// style). Elements whose content changed (ghost → filled) take the new look but keep the user's position.

import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { routeArrows } from './routeArrows';

export { routeArrows };

type El = Record<string, any>;

/** Convert skeletons, then give bound label text deterministic ids (`<containerId>-label`). */
export function convertWithStableIds(skeletons: unknown[]): El[] {
  const els = convertToExcalidrawElements(skeletons as any, { regenerateIds: false }) as unknown as El[];
  // Safeguard: structured box data must survive conversion.
  const data = new Map((skeletons as El[]).filter(k => k.customData).map(k => [k.id as string, k.customData]));
  const rename = new Map<string, string>();
  const byId = new Map(els.map(e => [e.id as string, e]));
  for (const el of els) if (el.type === 'text' && el.containerId) rename.set(el.id, `${el.containerId}-label`);
  const mapped = els.map(el => {
    const next = { ...el };
    if (data.has(el.id) && !el.customData) next.customData = data.get(el.id);
    if (rename.has(el.id)) next.id = rename.get(el.id);
    if (el.type === 'text' && el.containerId && byId.get(el.containerId)?.groupIds?.length) next.groupIds = byId.get(el.containerId)!.groupIds;
    if (Array.isArray(el.boundElements)) {
      next.boundElements = el.boundElements.map((b: El) => (rename.has(b.id) ? { ...b, id: rename.get(b.id) } : b));
    }
    return next;
  });
  return behindCards(routeArrows(mapped));
}

/** Connector lines (and their labels) first, so every card is drawn over them. Stable otherwise. */
export function behindCards(els: El[]): El[] {
  const arrowIds = new Set(els.filter(e => e.type === 'arrow').map(e => e.id as string));
  const isLine = (e: El) => arrowIds.has(e.id) || (e.type === 'text' && arrowIds.has(e.containerId));
  return [...els.filter(isLine), ...els.filter(e => !isLine(e))];
}

export function signature(el: El): string {
  // A tether's geometry follows its cards; only whether we generated it matters (so an unstuck one stays gone).
  if (el.type === 'arrow' && el.customData?.kind === 'tether') return 'tether';
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
    const anchorId = el.containerId ?? el.customData?.card ?? el.id; // a label or a card's own text follows its card
    const anchorPrev = prevById.get(anchorId);
    const anchorNext = nextById.get(anchorId);
    if (!anchorPrev || !anchorNext) return el;
    return { ...el, x: el.x + (anchorPrev.x - anchorNext.x), y: el.y + (anchorPrev.y - anchorNext.y) };
  });

  // Keep anything the user added themselves.
  const ours = new Set(next.map(e => e.id));
  for (const e of prev) if (!ours.has(e.id) && !isGenerated(e.id)) merged.push(e);

  // Boxes the user (or the layout) has moved keep their place, so generated lines must be re-aimed at where the boxes
  // actually are rather than where this build would have put them. Lines the user drew are left alone.
  const routed = routeArrows(merged);
  const aim = (e: El) => isGenerated(e.id) || (e.type === 'text' && !!e.containerId && isGenerated(e.containerId));
  return { elements: merged.map((e, i) => (aim(e) && e.type !== 'rectangle' ? routed[i] : e)), signatures };
}

function isGenerated(id: string): boolean {
  return /^(seed|seed-sub|seed-link|kb-\d+|cluster-\d+|frag-\d+-\d+(-title|-foot|-dot)?|rel-\d+-\d+-\d+|tether-\d+-\d+|edge-\d+)(-label)?$/.test(id);
}
