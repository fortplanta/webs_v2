// Deterministic "randomness" for the canvas: a number in [-1, 1] that depends only on a key, so a web rebuilt from the same
// model lands in the same places and the canvas can merge updates in place, yet no two things sit at quite the same angle.

const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** A steady value in [-1, 1] for `key` (and `salt`, to get independent values for one key). */
export function noise(key: string, salt = ''): number {
  let t = (hash(`${key}|${salt}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2) - 1;
}
