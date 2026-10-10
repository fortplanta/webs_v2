import type { PassageIndex } from './index';
import { terms } from './text';

/**
 * The few terms that best characterize a piece of text *within this KB*: frequent in the text (the title
 * counts triple), informative (rare across the KB), and actually present in the KB at all. Used to turn a
 * card into a query. Terms in more than `maxShare` of passages are too common to steer anything.
 */
export function seedTerms(index: PassageIndex, title: string, body: string, k = 6, maxShare = 0.6): string[] {
  const tf = new Map<string, number>();
  for (const t of terms(title)) tf.set(t, (tf.get(t) ?? 0) + 3);
  for (const t of terms(body)) tf.set(t, (tf.get(t) ?? 0) + 1);
  const n = index.passages.length || 1;
  return [...tf.entries()]
    .filter(([t]) => (index.df.get(t) ?? 0) > 0 && (index.df.get(t) ?? 0) / n <= maxShare)
    .map(([t, f]) => [t, f * index.idf(t)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([t]) => t);
}
