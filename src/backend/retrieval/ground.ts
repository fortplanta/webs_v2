import { terms } from './text';

/**
 * 0–1: the share of a generated card's content words that appear in the KB passage it is based on (or
 * in the query). A low score means the card says things the KB doesn't — useful to surface, not to hide.
 */
export function groundingScore(generated: string, passageTerms: Iterable<string>, queryTerms: Iterable<string> = []): number {
  const claim = new Set(terms(generated));
  if (claim.size === 0) return 1;
  const known = new Set([...passageTerms, ...queryTerms]);
  let hit = 0;
  for (const t of claim) if (known.has(t)) hit++;
  return Math.round((hit / claim.size) * 100) / 100;
}
