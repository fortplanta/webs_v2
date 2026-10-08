// Default strategy: instant KB hits → small overview call → streamed fragments.
// Replace or add strategies in ./index.ts; this file is one implementation of the Strategy contract.

import { WebsError } from '../errors';
import type { WebEvent } from '../events';
import { formatPassages } from '../kb';
import { buildFragmentsMessage, buildOverviewMessage, FRAGMENTS_SYSTEM_PROMPT, OVERVIEW_SYSTEM_PROMPT } from '../prompts';
import { JsonObjectStream, normalizeFragment, parseOverview, type Overview } from '../parse';
import type { Strategy, StrategyContext } from './types';

async function fetchOverview(ctx: StrategyContext, kbText: string): Promise<Overview> {
  const user = buildOverviewMessage(ctx.query, kbText, ctx.config);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await ctx.llm.call({ system: OVERVIEW_SYSTEM_PROMPT, user, json: true, maxTokens: 800 }, ctx.signal);
    try {
      return parseOverview(raw);
    } catch (err) {
      if (!(err instanceof WebsError) || err.code !== 'bad-json') throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

export const progressive: Strategy = async function* (ctx) {
  const q = ctx.query.trim();
  if (!q) throw new WebsError('bad-json', 'Enter a topic first.');

  // 1. KB — local, effectively instant.
  const passages = await ctx.kb.search(q);
  if (passages.length === 0) {
    throw new WebsError('kb-empty', 'No knowledge-base results for that query. Add notes to the kb/ folder or try different keywords.');
  }
  yield { type: 'kb', passages };
  const kbText = formatPassages(passages);

  // 2. Overview — short call: context, cluster titles, edges.
  yield { type: 'status', message: 'Outlining…' };
  const overview = await fetchOverview(ctx, kbText);
  const slots = ctx.config.fragmentsPerCluster;
  yield {
    type: 'overview',
    context: overview.context,
    clusters: overview.titles.map(title => ({ title, slots })),
    edges: overview.edges,
  };

  // 3. Fragments — streamed; each is emitted the moment its object closes.
  yield { type: 'status', message: 'Writing fragments…' };
  const filled = overview.titles.map(() => 0);
  const parser = new JsonObjectStream();
  let count = 0;
  const stream = ctx.llm.stream(
    { system: FRAGMENTS_SYSTEM_PROMPT, user: buildFragmentsMessage(q, kbText, overview.context, overview.titles, ctx.config), maxTokens: 4000 },
    ctx.signal,
  );
  for await (const chunk of stream) {
    for (const obj of parser.feed(chunk)) {
      const fragment = normalizeFragment(obj);
      if (!fragment) continue;
      const cluster = pickCluster((obj as any).cluster, filled, slots);
      if (cluster < 0) continue; // everything already full
      const event: WebEvent = { type: 'fragment', cluster, slot: filled[cluster]++, fragment };
      count++;
      yield event;
    }
  }
  if (count === 0) throw new WebsError('bad-json', 'The model returned no usable fragments.');
};

/** Use the model's cluster index when it has room; otherwise fall back to the first cluster with space. */
function pickCluster(hint: unknown, filled: number[], slots: number): number {
  if (typeof hint === 'number' && Number.isInteger(hint) && filled[hint] !== undefined && filled[hint] < slots) return hint;
  return filled.findIndex(n => n < slots);
}
