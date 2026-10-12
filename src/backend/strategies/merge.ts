/**
 * Runs async generators side by side and yields whatever comes next from any of them. A source that throws does not
 * stop the others; the first error is rethrown once every source has ended. If the consumer leaves early, the
 * sources are closed.
 */
export async function* interleave<T>(...sources: AsyncGenerator<T>[]): AsyncGenerator<T> {
  type Step = { i: number; r?: IteratorResult<T>; err?: unknown; failed?: true };
  const live = new Map<number, Promise<Step>>();
  const pull = (i: number) => live.set(i, sources[i].next().then(r => ({ i, r }), err => ({ i, err, failed: true as const })));
  sources.forEach((_, i) => pull(i));
  let firstError: { err: unknown } | null = null;
  try {
    while (live.size) {
      const step = await Promise.race(live.values());
      if (step.failed) { live.delete(step.i); firstError ??= { err: step.err }; }
      else if (step.r!.done) live.delete(step.i);
      else { yield step.r!.value; pull(step.i); }
    }
    if (firstError) throw firstError.err;
  } finally {
    await Promise.allSettled(sources.map(s => s.return?.(undefined as never)));
  }
}
