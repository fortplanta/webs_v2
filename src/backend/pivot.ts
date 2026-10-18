// Pivot: grow one new collection out of an existing card.
//
// The card seeds a fresh retrieval over the KB (passages already on the canvas are excluded), and the
// collection chosen is one reached by a *different* route than the card's own — that difference is what
// makes it a new angle rather than more of the same. Like the lensed strategy, the KB-derived collection
// is emitted immediately and the model's title and cards replace the drafts as they arrive.

import { aiContext } from './provider';
import { WebsError } from './errors';
import { libraryRetriever, type LibraryRetriever } from './library/service';
import { sharedTerms } from './narration';
import { aiWeb, type AiContext } from './strategies/ai';
import type { GeneratedFragment, PivotEvent, PivotRequest } from './events';
import type { LlmService } from './llm';
import { ollamaLlm } from './llm';
import { cardMeta, parseJsonObject, streamObjects } from './parse';
import {
  buildPivotFragmentsMessage, buildPivotOverviewMessage, LENSED_FRAGMENTS_SYSTEM_PROMPT, PIVOT_OVERVIEW_SYSTEM_PROMPT, passageIds,
} from './prompts';
import type { Collection, Retrieval } from './retrieval/retrieve';
import { kbRetriever, type Retriever } from './retrieval/service';
import { jaccard, terms } from './retrieval/text';
import { libraryMarks, provisionalFragment, referenceOf, type Marks } from './strategies/lensed';

export interface PivotOptions {
  signal: AbortSignal;
  retriever?: Retriever;
  llm?: LlmService;
  /** Offline reference libraries, tried when the notes have nothing on topic. */
  library?: LibraryRetriever | null;
  /** The AI provider, tried last. */
  ai?: AiContext | null;
  /** A passage from the notes must share at least this many words with the card to count as on topic. */
  minShared?: number;
}

interface Ready { signal: AbortSignal; retriever: Retriever; llm: LlmService; library: LibraryRetriever | null; ai: AiContext | null; minShared: number }

/** Prefer a route other than the card's own, and other than a plain "similar passages" match. */
export function pickCollection(retrieval: Retrieval, cardLens?: string): Collection | null {
  const cs = retrieval.collections.filter(c => c.passages.length > 0);
  return cs.find(c => c.lens !== 'direct' && c.lens !== cardLens) ?? cs.find(c => c.lens !== cardLens) ?? cs[0] ?? null;
}

/** A different angle written by the AI provider, for when neither the notes nor the libraries have anything on topic. */
async function* aiPivot(req: PivotRequest, opts: Ready, ai: AiContext): AsyncGenerator<PivotEvent> {
  const { card } = req;
  const lib = opts.library ? await opts.library.retrieveFromCard({ title: card.title, body: card.body }, { exclude: new Set(req.usedPassageIds) }) : null;
  const reference = lib ? referenceOf(lib.retrieval.collections) : '';
  const drafts: GeneratedFragment[] = Array.from({ length: 3 }, () => ({ type: 'concept', title: 'writing…', body: '', draft: true, origin: 'ai', aiModel: ai.model }));
  for await (const e of aiWeb({ query: `${card.title}: a different angle on "${req.query ?? card.title}"`, signal: opts.signal, ai, start: 0, count: 1, perCollection: 3, avoid: [card.title], reference, seenTitles: [card.title] })) {
    if (e.type === 'ai-outline') yield { type: 'plan', title: e.clusters[0]?.title ?? 'another angle', lens: 'ai', edge: e.clusters[0]?.edge ?? 'leads to', cards: drafts };
    else if (e.type === 'fragment') yield { type: 'card', slot: e.slot, fragment: e.fragment };
    else if (e.type === 'status') yield e;
  }
}

async function* run(req: PivotRequest, opts: Ready): AsyncGenerator<PivotEvent> {
  const { card } = req;
  const exclude = new Set(req.usedPassageIds);
  const cardTerms = terms(`${card.title} ${card.body}`);
  // Passages that only share a common word with the card are not a different angle on it, they are noise.
  const onTopic = (r: Retrieval, min: number): Retrieval => ({ ...r, collections: r.collections.map(c => ({ ...c, passages: c.passages.filter(p => sharedTerms(p.terms, cardTerms) >= min) })).filter(c => c.passages.length > 0) });

  // 1. your notes
  let collection = pickCollection(onTopic(await opts.retriever.retrieveFromCard({ title: card.title, body: card.body }, { exclude }), opts.minShared), card.lens);
  // 2. the offline libraries
  let marks: Marks | undefined;
  if (!collection && opts.library) {
    const lib = await opts.library.retrieveFromCard({ title: card.title, body: card.body }, { exclude });
    if (lib) { collection = pickCollection(onTopic(lib.retrieval, Math.min(2, opts.minShared)), card.lens); if (collection) marks = libraryMarks(lib); }
  }
  // 3. the AI provider
  if (!collection) {
    if (opts.ai) { yield* aiPivot(req, opts, opts.ai); return; }
    throw new WebsError('kb-empty', 'Nothing in your notes or libraries connects to this card, and no AI provider is set up to write another angle. Add notes on related topics, or turn on an AI provider in Settings.');
  }

  const drafts = collection.passages.map(p => ({ ...provisionalFragment(p, collection!), ...marks?.of(p) }));
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
    const done = new Set<number>();
    const stream = opts.llm.stream({ system: LENSED_FRAGMENTS_SYSTEM_PROMPT, user: buildPivotFragmentsMessage(card, title, collection), maxTokens: 3000 }, opts.signal);
    {
      for await (const obj of streamObjects(stream, opts.llm, opts.signal)) {
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
        const fragment: GeneratedFragment = { ...meta, body: hit.p.text, kbSources: [hit.p.source], kbPassageIds: [hit.p.id], lens: hit.p.lens, grounding: 1, ...marks?.of(hit.p) };
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
    yield* run(req, { signal: opts.signal, retriever: opts.retriever ?? kbRetriever, llm: opts.llm ?? ollamaLlm, library: opts.library !== undefined ? opts.library : libraryRetriever, ai: opts.ai !== undefined ? opts.ai : aiContext(), minShared: opts.minShared ?? 4 });
    yield { type: 'done' };
  } catch (err) {
    if (err instanceof WebsError) { if (err.code !== 'cancelled') yield { type: 'error', code: err.code, message: err.message }; }
    else yield { type: 'error', code: 'ollama-error', message: (err as Error).message };
  }
}
