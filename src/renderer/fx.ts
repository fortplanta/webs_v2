// The canvas's small motions, as pure timing so they can be tested: a card that arrives gets a soft glint and an expanding
// halo (feedback: something landed, here); a web that is being written breathes at its origin (state: it is working);
// and a web that finishes gets one wider ring (the rare, deserved moment). All ease-out, all short, all faint.

export const ARRIVE_MS = 720;
export const DONE_MS = 1100;
/** One breath of the origin while a web is being written, in seconds (the brand's "generate" pulse is 2.5 s). */
export const BREATH_S = 2.5;

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export interface Halo { /** px added around the rectangle */ grow: number; /** 0–1 */ alpha: number; /** 0–1 brightness of the fill glint */ glint: number }

/** A card that arrived `ms` ago: a halo that widens and fades, and a glint over the card that is gone sooner. */
export function arrivalHalo(ms: number): Halo | null {
  if (ms < 0 || ms >= ARRIVE_MS) return null;
  const p = ms / ARRIVE_MS;
  return { grow: 2 + 16 * easeOut(p), alpha: 0.34 * (1 - easeOut(p)), glint: ms < 360 ? 0.07 * (1 - ms / 360) : 0 };
}

/** The origin's breathing while working: two faint rings whose strength swells and settles. */
export function breath(seconds: number): { inner: number; outer: number; grow: number } {
  const w = (Math.sin((2 * Math.PI * seconds) / BREATH_S - Math.PI / 2) + 1) / 2; // 0 → 1 → 0, starting calm
  return { inner: 0.05 + 0.13 * w, outer: 0.02 + 0.07 * w, grow: 5 + 5 * w };
}

/** The ring that marks a web finishing: wide, slow, once. */
export function doneRing(ms: number): Halo | null {
  if (ms < 0 || ms >= DONE_MS) return null;
  const p = ms / DONE_MS;
  return { grow: 6 + 46 * easeOut(p), alpha: 0.4 * (1 - easeOut(p)), glint: 0 };
}
