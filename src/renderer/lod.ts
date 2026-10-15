// Level of detail: zoomed out, a card's body text is a smudge, so a layer over the canvas replaces what can't be read
// with what can — the title in a readable size on a kind-coloured block, then, further out, just a dot. Nothing in the
// scene changes (the layer ignores the pointer, and the cards underneath stay live). Pure, so it can be tested.

import type { GeneratedFragment } from '../backend/events';
import type { El } from './sceneEdit';

/** Below FULL_ABOVE the body is covered; below DOT_BELOW the cards shrink to dots. The cover fades in over FADE. */
export const FULL_ABOVE = 0.55;
export const DOT_BELOW = 0.2;
const FADE = 0.1;

export type Tier = 'full' | 'titles' | 'dots';

export const tierFor = (zoom: number): Tier => (zoom >= FULL_ABOVE - FADE ? (zoom >= FULL_ABOVE ? 'full' : 'titles') : zoom < DOT_BELOW ? 'dots' : 'titles');

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
  /** Title size in screen pixels: constant-ish whatever the zoom, bigger for what matters more. */
  fontPx: number;
}

const FONT = { 1: 12, 2: 14, 3: 17 } as const;

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
    out.push({ id: e.id, x, y, w, h, type: f.type, title: f.title, weight, fontPx: FONT[weight] });
  }
  return out;
}
