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
import type { GeneratedFragment, OverviewEdge, WebEvent } from '../events';
import {
  buildLensedFragmentsMessage, buildLensedOverviewMessage, LENSED_FRAGMENTS_SYSTEM_PROMPT, LENSED_OVERVIEW_SYSTEM_PROMPT, passageIds,
} from '../prompts';
import { candidatePairs, checkClaims, checkRetelling, clampWeight, groundedWhen, restoreNames, sentenceCase, sharedTerms, weightFor } from '../narration';
import { cardMeta, parseLensedOverview, streamObjects } from '../parse';
import { callJson } from '../repair';
import type { LibraryRetrieval } from '../library/service';
import { wikipediaOrigin } from '../library/images';
import type { Collection, SelectedPassage } from '../retrieval/retrieve';
import { jaccard, terms } from '../retrieval/text';
import { aiWeb } from './ai';
import { interleave } from './merge';
import type { Strategy } from './types';

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
const firstWords = (t: string, n: number) => t.split(/\s+/).slice(0, n).join(' ');

export function provisionalFragment(p: SelectedPassage, collection: Collection, best = 0): GeneratedFragment {
  return {
    type: 'source',
    title: (p.heading || firstWords(p.text, 5)).toLowerCase(),
    body: p.text, // the whole passage, never a teaser
    tags: [p.lens],
    bridge: p.via?.length ? `Connected through “${p.via.slice(0, 2).join(', ')}”.` : `Surfaced by the “${collection.label}” route.`,
    kbSources: [p.source],
    kbPassageIds: [p.id],
    grounding: 1,
    lens: p.lens,
    weight: weightFor(p.score.value, best),
    draft: true,
  };
}

/**
 * Links between collections: only a tangent, where one genuinely arises from the other. The model proposes them, and a
 * link is believed only if the two collections share real vocabulary beyond the question (the same test as a link
 * between cards). Every collection hangs off the origin anyway; this is for the rarer case of one growing out of another.
 */
export function tangentEdges(proposed: OverviewEdge[], collections: Collection[], questionTerms: Iterable<string>): OverviewEdge[] {
  const terms = collections.map(c => c.passages.flatMap(p => p.terms));
  return proposed.filter(e => sharedTerms(terms[e.source] ?? [], terms[e.target] ?? [], questionTerms) >= 4);
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

/** Encyclopedia/notes text on the topic, for the AI to take names, dates and figures from (and be checked against). */
export function referenceOf(collections: Collection[], maxChars = 5500): string {
  const seen = new Set<string>(), parts: string[] = [];
  let n = 0;
  for (const c of collections) for (const p of c.passages) {
    if (seen.has(p.id) || n > maxChars) continue;
    seen.add(p.id);
    const t = p.text.slice(0, 900);
    parts.push(`- (${p.source.split(':').pop()}) ${t}`);
    n += t.length;
  }
  return parts.join('\n');
}

export const lensed: Strategy = async function* (ctx) {
  const q = ctx.query.trim();
  if (!q) throw new WebsError('bad-json', 'Enter a topic first.');

  // 1. retrieval — local, deterministic, effectively instant. Your notes first; if they have nothing, the offline
  // reference libraries (Wikipedia, …); only if neither has anything does the AI write the whole web.
  const notes = await ctx.retriever.retrieve(q);
  const lib = notes.collections.length === 0 && ctx.library ? await ctx.library.retrieve(q) : null;
  const fromLibrary = !!lib && lib.retrieval.collections.length > 0;
  const retrieval = fromLibrary ? lib!.retrieval : notes;
  const marks = fromLibrary ? libraryMarks(lib!) : undefined;
  const collections = retrieval.collections;
  const wanted = ctx.config.clusterCount;

  if (collections.length === 0) {
    if (!ctx.ai) {
      throw new WebsError('kb-empty', 'No results for that query in your notes or your libraries. Add notes to the kb/ folder, try different keywords, or set up an AI provider in Settings to answer from its own knowledge.');
    }
    yield* aiWeb({ query: q, signal: ctx.signal, ai: ctx.ai, start: 0, count: wanted, perCollection: ctx.config.fragmentsPerCluster, reference: '' });
    return;
  }
  if (fromLibrary) yield { type: 'status', message: `Nothing in your notes — using ${[...lib!.libraries.values()].map(l => l.label).join(', ')}…` };

  // Whatever the local tier found, if it is fewer collections than asked for the AI can fill the gap (when that is on),
  // running alongside the local web so neither waits for the other.
  const missing = wanted - collections.length;
  const ai = ctx.ai?.topUp ? ctx.ai : null;
  const seenTitles = new Set<string>(); // every card title on the web so far, so a later wave of AI cards never repeats one
  const topUp = (start: number, count: number, avoid: string[]) => (async function* (): AsyncGenerator<WebEvent> {
    try {
      yield* aiWeb({ query: q, signal: ctx.signal, ai: ai!, start, count, perCollection: ctx.config.fragmentsPerCluster, avoid, reference: referenceOf(collections), seenTitles: [...seenTitles] });
    } catch (err) {
      if (err instanceof WebsError && err.code !== 'cancelled') yield { type: 'warning', message: `Couldn't add AI collections: ${err.message}` };
      else throw err;
    }
  })();

  // The narrator may set passages aside once it has read them, so how much of the local web survives is only known at
  // the end. Watch which cards stay, and if the web ended up thinner than asked for, the AI writes the rest then.
  const kept = new Map<string, boolean>(); // "cluster:slot" → still on the canvas
  async function* watched(src: AsyncGenerator<WebEvent>): AsyncGenerator<WebEvent> {
    for await (const e of src) {
      if (e.type === 'fragment' && e.cluster < collections.length) kept.set(`${e.cluster}:${e.slot}`, !e.fragment.dropped);
      if (e.type === 'fragment' && !e.fragment.draft) seenTitles.add(e.fragment.title);
      yield e;
    }
  }
  const local = watched(kbWeb(ctx, q, retrieval, marks));
  const first = ai && missing > 0 ? interleave(local, topUp(collections.length, missing, collections.map(c => c.label))) : local;
  for await (const e of first) { if (e.type === 'fragment' && !e.fragment.draft) seenTitles.add(e.fragment.title); yield e; }

  if (ai) {
    const survivingLocal = new Set([...kept].filter(([, v]) => v).map(([k]) => k.split(':')[0])).size;
    const have = survivingLocal + Math.max(0, missing);
    const short = wanted - have;
    if (short > 0 && !ctx.signal.aborted) {
      yield { type: 'status', message: `Some of what was found didn't fit — asking ${ai.model} for ${short} more…` };
      yield* topUp(collections.length + Math.max(0, missing), short, collections.map(c => c.label));
    }
  }
};

/** What marks a card as coming from a reference library rather than the user's notes. */
export interface Marks { origin: 'wiki'; of(p: SelectedPassage): Partial<GeneratedFragment>; /** Where this passage's article lives, for fetching its picture. */ article(p: SelectedPassage): { urlBase: string; title: string } | null }

export function libraryMarks(lib: LibraryRetrieval): Marks {
  return {
    origin: 'wiki',
    of(p) {
      const i = p.source.indexOf(':');
      const meta = lib.libraries.get(p.source.slice(0, i));
      const title = p.source.slice(i + 1);
      return {
        origin: 'wiki', sourceLabel: meta?.label, kbSources: [title],
        ...(meta?.urlBase ? { link: meta.urlBase + encodeURIComponent(title.replace(/ /g, '_')) } : {}),
      };
    },
    article(p) {
      const i = p.source.indexOf(':');
      const meta = lib.libraries.get(p.source.slice(0, i));
      return meta?.urlBase && wikipediaOrigin(meta.urlBase) ? { urlBase: meta.urlBase, title: p.source.slice(i + 1) } : null;
    },
  };
}

/** The knowledge-base web: instant skeleton and excerpts, then the local model's cards. `marks` is set for library sources. */
async function* kbWeb(ctx: Parameters<Strategy>[0], q: string, retrieval: Awaited<ReturnType<Parameters<Strategy>[0]['retriever']['retrieve']>>, marks?: Marks): AsyncGenerator<WebEvent> {
  // Pictures are fetched alongside the cards, never in front of them.
  if (marks && ctx.images) yield* interleave(kbCards(ctx, q, retrieval, marks), pictures(ctx, retrieval.collections, marks));
  else yield* kbCards(ctx, q, retrieval, marks);
}

/**
 * What an article adds beyond its text, fetched alongside the cards, never in front of them: its lead picture, then (from
 * the heaviest card that came from it) a couple more pictures that fit the passage, a map when it is about a place, and a
 * clip as a link. Three articles at a time, with a budget so a web does not drown in pictures.
 */
async function* pictures(ctx: Parameters<Strategy>[0], collections: Collection[], marks: Marks): AsyncGenerator<WebEvent> {
  const fetchImage = ctx.images!;
  const chosen = new Map<string, { cluster: number; slot: number; urlBase: string; title: string; weight: number; text: string }>();
  collections.forEach((c, ci) => c.passages.forEach((p, pi) => {
    const a = marks.article(p);
    if (!a) return;
    const weight = p.score.value;
    const key = `${a.urlBase}${a.title}`;
    if (!chosen.has(key) || weight > chosen.get(key)!.weight) chosen.set(key, { cluster: ci, slot: pi, ...a, weight, text: p.text });
  }));
  const budget = { extras: 6, maps: 2, links: 2 };
  const jobs = [...chosen.values()].sort((a, b) => b.weight - a.weight);
  const work = async (job: (typeof jobs)[number]): Promise<WebEvent[]> => {
    const out: WebEvent[] = [];
    const lead = await fetchImage(job.urlBase, job.title, ctx.signal).catch(() => null);
    if (lead) out.push({ type: 'image', cluster: job.cluster, slot: job.slot, image: { ...lead, kind: 'lead', n: 0 } });
    if (ctx.media) {
      const more = await ctx.media(job.urlBase, job.title, job.text, ctx.signal).catch(() => null);
      for (const img of more?.extras ?? []) if (budget.extras > 0) { budget.extras--; out.push({ type: 'image', cluster: job.cluster, slot: job.slot, image: img }); }
      if (more?.map && budget.maps > 0) { budget.maps--; out.push({ type: 'image', cluster: job.cluster, slot: job.slot, image: more.map }); }
      for (const link of more?.links ?? []) if (budget.links > 0) { budget.links--; out.push({ type: 'media-link', cluster: job.cluster, slot: job.slot, link }); }
    }
    return out;
  };
  const running = new Map<number, Promise<{ i: number; events: WebEvent[] }>>();
  let next = 0;
  const launch = () => {
    while (running.size < 3 && next < jobs.length) {
      const i = next++;
      running.set(i, work(jobs[i]).then(events => ({ i, events }), () => ({ i, events: [] as WebEvent[] }))); // a picture that can't be fetched is simply absent
    }
  };
  launch();
  while (running.size) {
    const { i, events } = await Promise.race(running.values());
    running.delete(i);
    yield* events;
    launch();
  }
}

async function* kbCards(ctx: Parameters<Strategy>[0], q: string, retrieval: Awaited<ReturnType<Parameters<Strategy>[0]['retriever']['retrieve']>>, marks?: Marks): AsyncGenerator<WebEvent> {
  const collections = retrieval.collections;
  const ids = passageIds(collections);
  const where = new Map<string, { cluster: number; slot: number; p: SelectedPassage }>();
  collections.forEach((c, ci) => c.passages.forEach((p, pi) => where.set(ids[ci][pi], { cluster: ci, slot: pi, p })));

  const bestScore = Math.max(...[...where.values()].map(w => w.p.score.value), 0);

  // 2. instant skeleton + excerpt cards (the selected passages ARE the cards, so no separate KB column)
  yield {
    type: 'overview', context: '',
    clusters: collections.map(c => ({ title: c.label, slots: c.passages.length, lens: c.lens, edge: c.verb, ...(marks ? { origin: marks.origin } : {}) })),
    edges: [],
  };
  for (const [, w] of where) yield { type: 'fragment', cluster: w.cluster, slot: w.slot, fragment: { ...provisionalFragment(w.p, collections[w.cluster], bestScore), ...marks?.of(w.p) } };

  // 3. the model: overview, then cards (a failure here leaves the KB-derived web on the canvas)
  try {
    yield { type: 'status', message: 'Outlining…' };
    const o = await callJson(ctx.llm, { system: LENSED_OVERVIEW_SYSTEM_PROMPT, user: buildLensedOverviewMessage(q, collections), json: true, maxTokens: 900 }, raw => parseLensedOverview(raw, collections.length), ctx.signal);
    yield {
      type: 'overview', context: o.context,
      clusters: collections.map((c, i) => ({ title: o.titles[i] ?? c.label, slots: c.passages.length, lens: c.lens, edge: o.edgeLabels[i] ?? c.verb, ...(marks ? { origin: marks.origin } : {}) })),
      edges: tangentEdges(o.edges, collections, retrieval.terms),
    };

    // The narrator's first judgement: passages that don't bear on the question are set aside, not forced into the story.
    const done = new Set<string>();
    const skipped = o.skip.filter(id => where.has(id));
    for (const id of skipped) {
      done.add(id);
      const w = where.get(id)!;
      yield { type: 'fragment', cluster: w.cluster, slot: w.slot, fragment: { ...provisionalFragment(w.p, collections[w.cluster], bestScore), ...marks?.of(w.p), dropped: true } };
    }
    if (skipped.length) yield { type: 'status', message: `Set aside ${skipped.length} passage${skipped.length === 1 ? '' : 's'} that didn't fit the question…` };

    const pairs = candidatePairs([...where].filter(([id]) => !done.has(id)).map(([id, w]) => ({ id, terms: w.p.terms })), retrieval.terms);

    yield { type: 'status', message: 'Writing cards…' };
    const stream = ctx.llm.stream(
      { system: LENSED_FRAGMENTS_SYSTEM_PROMPT, user: buildLensedFragmentsMessage(q, o.context, collections, skipped, pairs), maxTokens: 6000 },
      ctx.signal,
    );
    {
      for await (const obj of streamObjects(stream, ctx.llm, ctx.signal)) {
        const named = String((obj as any).passage ?? '').toUpperCase().replace(/[^P0-9]/g, '');
        if ((obj as any).fits === false && where.has(named) && !done.has(named)) {
          done.add(named);
          const w = where.get(named)!;
          yield { type: 'fragment', cluster: w.cluster, slot: w.slot, fragment: { ...provisionalFragment(w.p, collections[w.cluster], bestScore), ...marks?.of(w.p), dropped: true } };
          continue;
        }
        const meta = cardMeta(obj);
        if (!meta) continue;
        const open = [...where].filter(([id]) => !done.has(id)).map(([id, w]) => ({ id, p: w.p }));
        const hit = open.find(c => c.id === named) ?? bestPassage(`${meta.title} ${meta.bridge ?? ''}`, open);
        if (!hit) continue;
        done.add(hit.id);
        const w = where.get(hit.id)!;
        // The narrator's words are used only if they pass the no-invention check; otherwise the passage itself stays.
        const hook = meta.bridge && checkClaims(meta.bridge, w.p.text, q).ok ? meta.bridge : undefined;
        const title = checkClaims(meta.title, w.p.text, q).ok ? meta.title : (w.p.heading.length >= 12 ? w.p.heading : firstWords(w.p.text, 5).toLowerCase());
        const retelling = meta.retelling ? restoreNames(sentenceCase(meta.retelling), w.p.text) : undefined;
        const verdict = retelling ? checkRetelling(w.p.text, retelling, q) : null;
        const retold = !!(retelling && verdict?.ok);
        // a link is believable only if the two passages really share vocabulary beyond the question itself
        const relates = (meta.relates ?? [])
          .filter(r => r.to !== hit.id && where.has(r.to) && sharedTerms(w.p.terms, where.get(r.to)!.p.terms, retrieval.terms) >= 3)
          .map(r => ({ to: where.get(r.to)!.p.id, verb: r.verb }));
        const era = groundedWhen(meta.when, w.p.text);
        const fragment: GeneratedFragment = {
          type: meta.type, title, ...(era ? { era } : {}), ...(meta.tags ? { tags: meta.tags } : {}), ...(hook ? { bridge: hook } : {}),
          body: retold ? retelling! : w.p.text,
          ...(retold ? { retold: true, original: w.p.text } : {}),
          ...(verdict && !verdict.ok ? { retellingRefused: verdict.reason } : {}),
          weight: clampWeight(meta.weight) ?? weightFor(w.p.score.value, bestScore),
          ...(relates.length ? { relates } : {}),
          kbSources: [w.p.source], kbPassageIds: [w.p.id], lens: w.p.lens, grounding: 1,
          ...marks?.of(w.p),
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
}
