// The origin: the card holding the user's question. It is the one fixed point of a web. It is locked where it first
// landed (the layout puts it at the scene's centre and nothing moves it again: not the user, not the layout solver,
// which treats it as an obstacle), and everything else grows outward from it, so over time the web spreads in the world
// around it, not around whatever happens to be on screen.

import type { El } from './sceneEdit';
import type { Pt } from './layout/organic';

/** The origin card, its label and the through-line under it. */
export const ORIGIN_IDS: ReadonlySet<string> = new Set(['seed', 'seed-label', 'seed-sub']);

/** Lock the origin in place (idempotent). Older saved webs get it too when opened. */
export function lockOrigin(elements: El[]): El[] {
  return elements.map(e => (ORIGIN_IDS.has(e.id) && !e.locked ? { ...e, locked: true, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e));
}

/** Centre of the origin card, if the scene has one. */
export function originCenter(elements: readonly El[]): Pt | null {
  const e = elements.find(x => x.id === 'seed' && !x.isDeleted);
  return e ? { x: e.x + e.width / 2, y: e.y + e.height / 2 } : null;
}
