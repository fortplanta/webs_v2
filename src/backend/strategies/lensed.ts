// "Lensed" strategy: retrieval chooses WHAT to show (themed collections from different routes through
// the KB, with a bridge to each); the model only names the collections and writes cards about the
// selected passages. Order of events, each rendered the moment it arrives:
//
//   overview      a skeleton built from the retrieval alone: collections, slots and default edges (instant)
//   fragment ×N   a card per passage straight from the KB text (instant) — so even with the LLM offline
//                 the user gets a real, grounded web
//   overview      the model's context, collection titles and edge labels
//   fragment ×N   the model's cards, replacing the excerpts one by one
//
// To change what is retrieved or how it is selected, edit src/backend/retrieval/ (config, lenses).

import { WebsError } from '../errors';
import type { GeneratedFragment, OverviewEdge } from '../events';
import {
  buildLensedFragmentsMessage, buildLensedOverviewMessage, LENSED_FRAGMENTS_SYSTEM_PROMPT, LENSED_OVERVIEW_SYSTEM_PROMPT, passageIds,
} from '../prompts';
import { JsonObjectStream, normalizeFragment, parseLensedOverview } from '../parse';
import { groundingScore } from '../retrieval/ground';
import type { Collection, SelectedPassage } from '../retrieval/retrieve';
import { jaccard, terms } from '../retrieval/text';
import type { Strategy } from './types';

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
const firstWords = (t: string, n: number) => t.split(/\s+/).slice(0, n).join(' ');

export function provisionalFragment(p: SelectedPassage, collection: Collection): GeneratedFragment {
  return {
    type: 'source',
    title: (p.heading || firstWords(p.text, 5)).toLowerCase(),
    body: clip(p.text, 400),
    tags: [p.lens],
    bridge: p.via?.length ? `Connected through “${p.via.slice(0, 2).join(', ')}”.` : `Surfaced by the “${collection.label}” route.`,
    kbSources: [p.source],
    grounding: 1,
    lens: p.lens,
    draft: true,
  };
}

export function defaultEdges(collections: Collection[]): OverviewEdge[] {
  return collections.slice(1).map((c, i) => ({ source: 0, target: i + 1, label: c.verb }));
}

/** The passage a card most plausibly came from, when the model's id is missing or wrong. */
function bestPassage(text: string, candidates: Array<{ id: string; p: SelectedPassage }>): { id: string; p: SelectedPassage } | null {
  const t = new Set(terms(text));
  let best: { id: string; p: SelectedPassage } | null = null, bestScore = 0;
  for (const c of candidates) {
    const s = jaccard(t, new Set(c.p.terms));
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return bestScore > 0.05 ? best : null;
}

export const lensed: Strategy = async function* (ctx) {
  const q = ctx.query.trim();
  if (!q) throw new WebsError('bad-json', 'Enter a topic first.');

  // 1. retrieval — local, deterministic, effectively instant
  const retrieval = await ctx.retriever.retrieve(q);
  const collections = retrieval.collections;
  if (collections.length === 0) {
    throw new WebsError('kb-empty', 'No knowledge-base results for that query. Add notes to the kb/ folder or try different keywords.');
  }
  const ids = passageIds(collections);
  const where = new Map<string, { cluster: number; slot: number; p: SelectedPassage }>();
  collections.forEach((c, ci) => c.passages.forEach((p, pi) => where.set(ids[ci][pi], { cluster: ci, slot: pi, p })));

  // 2. instant skeleton + excerpt cards (the selected passages ARE the cards, so no separate KB column)
  yield {
    type: 'overview', context: '',
    clusters: collections.map(c => ({ title: c.label, slots: c.passages.length, lens: c.lens })),
    edges: defaultEdges(collections),
  };
  for (const [, w] of where) yield { type: 'fragment', cluster: w.cluster, slot: w.slot, fragment: provisionalFragment(w.p, collections[w.cluster]) };

  // 3. the model: overview, then cards (a failure here leaves the KB-derived web on the canvas)
  try {
    yield { type: 'status', message: 'Outlining…' };
    let outline: ReturnType<typeof parseLensedOverview> | null = null;
    for (let attempt = 0; attempt < 2 && !outline; attempt++) {
      const raw = await ctx.llm.call({ system: LENSED_OVERVIEW_SYSTEM_PROMPT, user: buildLensedOverviewMessage(q, collections), json: true, maxTokens: 900 }, ctx.signal);
      try { outline = parseLensedOverview(raw, collections.length); } catch (err) {
        if (!(err instanceof WebsError) || err.code !== 'bad-json' || attempt === 1) throw err;
      }
    }
    const o = outline!;
    yield {
      type: 'overview', context: o.context,
      clusters: collections.map((c, i) => ({ title: o.titles[i] ?? c.label, slots: c.passages.length, lens: c.lens })),
      edges: o.edges.length ? o.edges : defaultEdges(collections),
    };

    yield { type: 'status', message: 'Writing cards…' };
    const parser = new JsonObjectStream();
    const done = new Set<string>();
    const stream = ctx.llm.stream(
      { system: LENSED_FRAGMENTS_SYSTEM_PROMPT, user: buildLensedFragmentsMessage(q, o.context, collections), maxTokens: 4500 },
      ctx.signal,
    );
    for await (const chunk of stream) {
      for (const obj of parser.feed(chunk)) {
        const f = normalizeFragment(obj);
        if (!f) continue;
        const open = [...where].filter(([id]) => !done.has(id)).map(([id, w]) => ({ id, p: w.p }));
        const named = String((obj as any).passage ?? '').toUpperCase().replace(/[^P0-9]/g, '');
        const hit = open.find(c => c.id === named) ?? bestPassage(`${f.title} ${f.body}`, open);
        if (!hit) continue;
        done.add(hit.id);
        const w = where.get(hit.id)!;
        const bridge = typeof (obj as any).bridge === 'string' ? clip((obj as any).bridge.trim(), 200) : undefined;
        const fragment: GeneratedFragment = {
          ...f, bridge: bridge || undefined, kbSources: [w.p.source], lens: w.p.lens,
          grounding: groundingScore(`${f.title} ${f.body}`, w.p.terms, retrieval.terms),
        };
        yield { type: 'fragment', cluster: w.cluster, slot: w.slot, fragment };
      }
    }
    if (done.size === 0) throw new WebsError('bad-json', 'The model returned no usable cards.');
  } catch (err) {
    if (err instanceof WebsError && err.code !== 'cancelled') {
      throw new WebsError(err.code, `${err.message} Showing your knowledge-base excerpts instead.`);
    }
    throw err;
  }
};
