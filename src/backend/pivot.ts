// Pivot: grow one new collection out of an existing card.
//
// The card seeds a fresh retrieval over the KB (passages already on the canvas are excluded), and the
// collection chosen is one reached by a *different* route than the card's own — that difference is what
// makes it a new angle rather than more of the same. Like the lensed strategy, the KB-derived collection
// is emitted immediately and the model's title and cards replace the drafts as they arrive.

import { WebsError } from './errors';
import type { GeneratedFragment, PivotEvent, PivotRequest } from './events';
import type { LlmService } from './llm';
import { ollamaLlm } from './llm';
import { cardMeta, JsonObjectStream, parseJsonObject } from './parse';
import {
  buildPivotFragmentsMessage, buildPivotOverviewMessage, LENSED_FRAGMENTS_SYSTEM_PROMPT, PIVOT_OVERVIEW_SYSTEM_PROMPT, passageIds,
} from './prompts';
import type { Collection, Retrieval } from './retrieval/retrieve';
import { kbRetriever, type Retriever } from './retrieval/service';
import { jaccard, terms } from './retrieval/text';
import { provisionalFragment } from './strategies/lensed';

export interface PivotOptions {
  signal: AbortSignal;
  retriever?: Retriever;
  llm?: LlmService;
}

/** Prefer a route other than the card's own, and other than a plain "similar passages" match. */
export function pickCollection(retrieval: Retrieval, cardLens?: string): Collection | null {
  const cs = retrieval.collections.filter(c => c.passages.length > 0);
  return cs.find(c => c.lens !== 'direct' && c.lens !== cardLens) ?? cs.find(c => c.lens !== cardLens) ?? cs[0] ?? null;
}

async function* run(req: PivotRequest, opts: Required<PivotOptions>): AsyncGenerator<PivotEvent> {
  const { card } = req;
  const retrieval = await opts.retriever.retrieveFromCard({ title: card.title, body: card.body }, { exclude: new Set(req.usedPassageIds) });
  const collection = pickCollection(retrieval, card.lens);
  if (!collection) throw new WebsError('kb-empty', 'Nothing new in your knowledge base connects to this card. Add notes on related topics, or try another card.');

  const drafts = collection.passages.map(p => provisionalFragment(p, collection));
  yield { type: 'plan', title: collection.label, lens: collection.lens, edge: collection.verb, cards: drafts };

  try {
    yield { type: 'status', message: 'Naming…' };
    let title = collection.label, edge: string | undefined;
    const raw = await opts.llm.call({ system: PIVOT_OVERVIEW_SYSTEM_PROMPT, user: buildPivotOverviewMessage(card, collection), json: true, maxTokens: 300 }, opts.signal);
    try {
      const o = parseJsonObject(raw);
      if (typeof o.title === 'string' && o.title.trim()) title = o.title.trim();
      if (typeof o.edge === 'string' && o.edge.trim()) edge = o.edge.trim();
    } catch { /* keep the route's own label */ }
    yield { type: 'title', title, edge };

    yield { type: 'status', message: 'Writing cards…' };
    const ids = passageIds([collection])[0];
    const parser = new JsonObjectStream();
    const done = new Set<number>();
    const stream = opts.llm.stream({ system: LENSED_FRAGMENTS_SYSTEM_PROMPT, user: buildPivotFragmentsMessage(card, title, collection), maxTokens: 3000 }, opts.signal);
    for await (const chunk of stream) {
      for (const obj of parser.feed(chunk)) {
        const meta = cardMeta(obj);
        if (!meta) continue;
        const open = collection.passages.map((p, i) => ({ p, i })).filter(x => !done.has(x.i));
        const named = ids.indexOf(String((obj as any).passage ?? '').toUpperCase().replace(/[^P0-9]/g, ''));
        let hit = open.find(x => x.i === named);
        if (!hit) {
          const t = new Set(terms(`${meta.title} ${meta.bridge ?? ''}`));
          hit = open.map(x => ({ x, s: jaccard(t, new Set(x.p.terms)) })).sort((a, b) => b.s - a.s).find(y => y.s > 0.05)?.x;
        }
        if (!hit) continue;
        done.add(hit.i);
        const fragment: GeneratedFragment = { ...meta, body: hit.p.text, kbSources: [hit.p.source], kbPassageIds: [hit.p.id], lens: hit.p.lens, grounding: 1 };
        yield { type: 'card', slot: hit.i, fragment };
      }
    }
    if (done.size === 0) throw new WebsError('bad-json', 'The model returned no usable cards.');
  } catch (err) {
    if (err instanceof WebsError && err.code !== 'cancelled') {
      throw new WebsError(err.code, `${err.message} Showing your knowledge-base excerpts instead.`);
    }
    throw err;
  }
}

/** Runs a pivot, ending with exactly one 'done' or 'error' event (none if cancelled). */
export async function* runPivot(req: PivotRequest, opts: PivotOptions): AsyncGenerator<PivotEvent> {
  try {
    yield* run(req, { signal: opts.signal, retriever: opts.retriever ?? kbRetriever, llm: opts.llm ?? ollamaLlm });
    yield { type: 'done' };
  } catch (err) {
    if (err instanceof WebsError) { if (err.code !== 'cancelled') yield { type: 'error', code: err.code, message: err.message }; }
    else yield { type: 'error', code: 'ollama-error', message: (err as Error).message };
  }
}
