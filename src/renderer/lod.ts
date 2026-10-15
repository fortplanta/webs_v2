// Level of detail: zoomed far out, a card's body text is a smudge, so a layer over the canvas replaces it with what can
// be read: the title on a kind-coloured block, shrinking with the card. One look, no modes. Nothing in the scene changes
// (the layer ignores the pointer, and the cards underneath stay live). Pure, so it can be tested.

import type { GeneratedFragment } from '../backend/events';
import type { El } from './sceneEdit';

/** Below FULL_ABOVE the body is covered, fading in over FADE: cards stay fully readable until they are properly small. */
export const FULL_ABOVE = 0.32;
const FADE = 0.06;

export type Tier = 'full' | 'titles';

export const tierFor = (zoom: number): Tier => (zoom >= FULL_ABOVE ? 'full' : 'titles');

/** 0 at full detail, 1 once the cover is fully in: lets the cover fade rather than pop. */
export const coverAmount = (zoom: number) => Math.min(1, Math.max(0, (FULL_ABOVE - zoom) / FADE));

export interface View { scrollX: number; scrollY: number; zoom: number; width: number; height: number }

export interface LodItem {
  id: string;
  /** Screen rectangle of the card. */
  x: number; y: number; w: number; h: number;
  type: GeneratedFragment['type'];
  title: string;
  weight: 1 | 2 | 3;
  /** Title size in screen pixels: it follows the zoom a little (so it stays in proportion to the card), bigger for what matters more. 0 when there is no room to read anything. */
  fontPx: number;
}

const FONT = { 1: 10, 2: 11, 3: 12 } as const;
const MIN_FONT = 7, MIN_WIDTH = 44;

/** The cards on screen that need a cover at this zoom, minus `skip` (the selected ones, which keep their outline). Empty at full detail. */
export function lodItems(elements: readonly El[], view: View, skip: ReadonlySet<string> = new Set()): LodItem[] {
  if (tierFor(view.zoom) === 'full') return [];
  const out: LodItem[] = [];
  for (const e of elements) {
    if (e.isDeleted || e.type !== 'rectangle' || e.customData?.kind !== 'fragment' || skip.has(e.id)) continue;
    const f = e.customData.fragment as GeneratedFragment | undefined;
    if (!f) continue;
    const x = (e.x + view.scrollX) * view.zoom, y = (e.y + view.scrollY) * view.zoom, w = e.width * view.zoom, h = e.height * view.zoom;
    if (x + w < 0 || y + h < 0 || x > view.width || y > view.height) continue; // off screen
    const weight = f.weight ?? 2;
    const fontPx = Math.round(FONT[weight] * Math.min(1, Math.max(0.5, view.zoom / FULL_ABOVE)));
    out.push({ id: e.id, x, y, w, h, type: f.type, title: f.title, weight, fontPx: w >= MIN_WIDTH && fontPx >= MIN_FONT ? fontPx : 0 });
  }
  return out;
}
