// Select a card and the rest of the canvas recedes a little, so the card and what it is tied to stand out. Which cards stay
// lit: the selected ones and every card joined to them by a line (a collection and its cards, cards that refer to each other).
// Pure, so it can be tested; FxOverlay.tsx paints the dimming.

import type { El } from './sceneEdit';

const CARD = new Set(['fragment', 'cluster', 'image-card']);

/** Most cards that can be selected for the dimming to apply (select a crowd and nothing is "the" focus). */
export const MAX_FOCUS = 3;
/** How dark the rest becomes at full focus (0–1). */
export const DIM_ALPHA = 0.52;

/**
 * The card rectangles to leave lit, or null when nothing should dim: no selection, a selection that includes anything but
 * cards (a line, a drawing), or more than MAX_FOCUS cards.
 */
export function focusSet(elements: readonly El[], selected: ReadonlySet<string>): Set<string> | null {
  if (!selected.size) return null;
  const byId = new Map(elements.filter(e => !e.isDeleted).map(e => [e.id as string, e]));
  const cardOf = (e: El | undefined): string | null => {
    if (!e) return null;
    if (e.type === 'rectangle' && CARD.has(e.customData?.kind)) return e.id;
    if (e.customData?.card && byId.has(e.customData.card)) return cardOf(byId.get(e.customData.card));       // its title, footer, dot
    if (e.containerId) return cardOf(byId.get(e.containerId));                                                // its bound label
    if (e.type === 'image') { const g = e.groupIds?.[e.groupIds.length - 1]; const owner = g && elements.find(o => !o.isDeleted && o.type === 'rectangle' && o.customData?.kind === 'image-card' && o.groupIds?.includes(g)); return owner ? owner.id : null; }
    return null;
  };
  const cards = new Set<string>();
  for (const id of selected) {
    const card = cardOf(byId.get(id));
    if (!card) return null;
    cards.add(card);
  }
  if (!cards.size || cards.size > MAX_FOCUS) return null;
  const lit = new Set(cards);
  for (const e of byId.values()) {
    if (e.type !== 'arrow' || !e.startBinding || !e.endBinding) continue;
    const a = e.startBinding.elementId, b = e.endBinding.elementId;
    if (cards.has(a) && CARD.has(byId.get(b)?.customData?.kind)) lit.add(b);
    if (cards.has(b) && CARD.has(byId.get(a)?.customData?.kind)) lit.add(a);
  }
  return lit;
}
