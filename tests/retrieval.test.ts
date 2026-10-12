import { describe, it, expect } from 'vitest';
import { PassageIndex } from '../src/backend/retrieval/index';
import { retrieve } from '../src/backend/retrieval/retrieve';
import { defaultRetrieveConfig, type RetrieveConfig } from '../src/backend/retrieval/config';
import { groundingScore } from '../src/backend/retrieval/ground';
import { jaccard, stem, terms } from '../src/backend/retrieval/text';
import { runStrategy } from '../src/backend/strategies';
import { parseLensedOverview } from '../src/backend/parse';
import { initialModel, reduce } from '../src/renderer/webModel';
import { fragmentLook } from '../src/renderer/boxes';
import type { WebEvent } from '../src/backend/events';
import type { Retriever } from '../src/backend/retrieval/service';
import type { LlmService } from '../src/backend/llm';

// A tiny synthetic corpus about "widgets" (the topic itself is irrelevant to the algorithm).
const docs = [
  { source: 'tech/widget.md', text: `# Widget: invention

The widget was invented in 1874 by a mechanic who patented the first design.

Earlier predecessors of the widget existed but were never widely used.

Widgets were used in farms to separate fields and manage livestock.` },
  { source: 'history/uses.md', text: `# Widgets at war

Armies used widgets to block roads, which slowed infantry and led to new tactics.

Prison planners adopted widgets for confinement because they are cheap and hard to climb.` },
  { source: 'culture/symbol.md', text: `# Widget symbolism

A famous logo shows a candle wrapped in a widget; the widget symbolizes imprisonment.

Critics argue the widget is a symbol of dispossession, while others dispute this.

In poetry and art the widget is depicted as a metaphor for isolation, a recurring imagery of enclosure.` },
  { source: 'society/prison.md', text: `# Confinement

Prison perimeters often use razor coils because confinement must be cheap.

Border barriers use razor coils too, and confinement at borders is debated.` },
  { source: 'misc/unrelated.md', text: `# Gardening

Tomatoes grow best in warm soil and full sun, and need regular watering.` },
];
const index = PassageIndex.fromDocs(docs);
const cfg = (over: Partial<RetrieveConfig> = {}): RetrieveConfig => ({ ...defaultRetrieveConfig, ...over });

describe('text normalization', () => {
  it('makes plural / -ing / -ed variants meet, keeps years, drops stopwords', () => {
    expect(new Set(['fence', 'fences', 'fencing', 'fenced'].map(stem)).size).toBe(1);
    expect(stem('invented')).toBe(stem('invent'));
    expect(terms('The widgets were invented in 1874')).toEqual(['widget', 'invent', '1874']);
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
  });
});

describe('PassageIndex', () => {
  it('splits paragraphs, tracks headings, skips bare headings, makes ids', () => {
    const p = index.passages.filter(x => x.source === 'tech/widget.md');
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({ id: 'tech/widget.md#0', heading: 'Widget: invention', module: 'tech' });
    expect(p[2].id).toBe('tech/widget.md#2');
  });
  it('scores relevant passages above irrelevant ones, and gives rare terms more weight', () => {
    const w = new Map([['widget', 1]]);
    const rel = index.passages.find(p => p.id === 'tech/widget.md#0')!;
    const irr = index.passages.find(p => p.source === 'misc/unrelated.md')!;
    expect(index.bm25(rel, w)).toBeGreaterThan(0);
    expect(index.bm25(irr, w)).toBe(0);
    expect(index.idf('tomato')).toBeGreaterThan(index.idf('widget'));
  });
  it('shows people the original spelling of a stemmed term', () => {
    expect(index.surface(stem('widgets'))).toMatch(/^widgets?$/);
  });
});

describe('retrieve', () => {
  it('is deterministic and returns nothing for empty or unmatched queries', () => {
    expect(JSON.stringify(retrieve(index, 'widget', cfg()))).toBe(JSON.stringify(retrieve(index, 'widget', cfg())));
    expect(retrieve(index, 'the and of', cfg()).collections).toEqual([]);
    expect(retrieve(index, 'zeppelin', cfg()).collections).toEqual([]);
    expect(retrieve(PassageIndex.fromDocs([]), 'widget', cfg()).collections).toEqual([]);
  });

  it('opens with the direct collection, anchored on a strongly relevant passage — whatever route it would also fit', () => {
    const r = retrieve(index, 'widget', cfg());
    expect(r.collections[0].lens).toBe('direct');
    expect(r.collections[0].passages[0].score.rel).toBe(1);
  });

  it('routes passages by relationship type when their cue words are present', () => {
    const r = retrieve(index, 'widget', cfg({ clusterCount: 8 })); // room for every route, so none loses out on the cap
    const lensOf = (id: string) => r.collections.find(c => c.passages.some(p => p.id === id))?.lens;
    expect(lensOf('tech/widget.md#0')).toBe('lineage');          // "invented", "patented"
    expect(lensOf('culture/symbol.md#2')).toBe('representation'); // "depicted", "metaphor", "imagery"
    expect(lensOf('culture/symbol.md#1')).toBe('tension');        // "critics", "dispute"
  });

  it('never selects irrelevant passages, however novel they are', () => {
    const r = retrieve(index, 'widget', cfg());
    expect(r.collections.flatMap(c => c.passages).some(p => p.source === 'misc/unrelated.md')).toBe(false);
  });

  it('follows an idea one hop to passages that never mention the query, and marks them', () => {
    const r = retrieve(index, 'widget confinement', cfg({ clusterCount: 6 }));
    const bridged = r.collections.flatMap(c => c.passages).filter(p => p.lens === 'bridge');
    // society/prison.md talks about confinement/razor coils/borders, reached via ideas shared with the direct hits
    expect(r.collections.flatMap(c => c.passages).some(p => p.source === 'society/prison.md')).toBe(true);
    for (const p of bridged) expect(p.via?.length).toBeGreaterThan(0);
  });

  it('refuses a bridge built on a single weak shared word', () => {
    const lax = retrieve(index, 'widget', cfg({ bridgeMinHits: 1, bridgeMinStrength: 0 }));
    const strict = retrieve(index, 'widget', cfg());
    const count = (r: ReturnType<typeof retrieve>) => r.collections.flatMap(c => c.passages).filter(p => p.lens === 'bridge').length;
    expect(count(strict)).toBeLessThanOrEqual(count(lax));
    // the unrelated gardening passage shares no ideas, so even the lax setting can't bridge to it
    expect(lax.collections.flatMap(c => c.passages).some(p => p.source === 'misc/unrelated.md')).toBe(false);
  });

  it('respects the size budget: ≤ clusterCount collections, ≤ fragmentsPerCluster passages each, no repeats', () => {
    for (const [clusterCount, fragmentsPerCluster] of [[2, 1], [3, 2], [6, 4]]) {
      const r = retrieve(index, 'widget', cfg({ clusterCount, fragmentsPerCluster }));
      expect(r.collections.length).toBeLessThanOrEqual(clusterCount);
      for (const c of r.collections) expect(c.passages.length).toBeLessThanOrEqual(fragmentsPerCluster);
      const ids = r.collections.flatMap(c => c.passages.map(p => p.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('prefers a passage that adds something new over a near-duplicate of one already chosen', () => {
    const dup = PassageIndex.fromDocs([
      { source: 'a.md', text: 'Widgets were invented in 1874 and patented by a mechanic in Illinois.' },
      { source: 'b.md', text: 'Widgets were invented in 1874 and patented by a mechanic in Illinois, it is said.' },
      { source: 'c.md', text: 'Critics argue widgets symbolize dispossession, and the symbol is disputed.' },
    ]);
    const r = retrieve(dup, 'widgets', cfg({ clusterCount: 2, fragmentsPerCluster: 1 }));
    const sources = r.collections.flatMap(c => c.passages.map(p => p.source));
    expect(sources).toContain('c.md'); // chosen instead of the second near-copy
    expect(sources.filter(s => s === 'a.md' || s === 'b.md')).toHaveLength(1);
  });

  it('exposes why each passage was chosen', () => {
    const p = retrieve(index, 'widget', cfg()).collections[0].passages[0];
    expect(Object.keys(p.score).sort()).toEqual(['conn', 'nov', 'red', 'rel', 'value']);
    expect(p.terms.length).toBeGreaterThan(0);
  });
});

describe('groundingScore', () => {
  const passage = terms('The widget was invented in 1874 by a mechanic in Illinois.');
  it('is high for a faithful restatement and low for invented specifics', () => {
    expect(groundingScore('A mechanic invented the widget in 1874.', passage)).toBeGreaterThanOrEqual(0.8);
    expect(groundingScore('A sailor invented the widget in 1903 in Norway.', passage)).toBeLessThan(0.6);
  });
  it('treats the query terms as known, and empty text as grounded', () => {
    expect(groundingScore('widgets', [], ['widget'])).toBe(1);
    expect(groundingScore('', passage)).toBe(1);
  });
});

describe('parseLensedOverview', () => {
  it('maps titles by index, pads missing ones, and keeps only valid labelled edges', () => {
    const o = parseLensedOverview(JSON.stringify({ context: ' c ', clusters: [{ title: 'A' }, { title: ' ' }], edges: [{ source: 0, target: 1, label: 'led to' }, { source: 0, target: 9, label: 'x' }, { source: 1, target: 1, label: 'self' }, { source: 0, target: 2, label: '' }] }), 3);
    expect(o).toEqual({ context: 'c', titles: ['A', null, null], edges: [{ source: 0, target: 1, label: 'led to' }] });
  });
});

describe('lensed strategy', () => {
  const retriever: Retriever = { retrieve: async q => retrieve(index, q, cfg({ clusterCount: 3, fragmentsPerCluster: 2 })) };
  const collect = async (llm: LlmService) => {
    const out: WebEvent[] = [];
    for await (const e of runStrategy('widget', { strategy: 'lensed', signal: new AbortController().signal, retriever, llm, ai: null })) out.push(e);
    return out;
  };
  // The model's cards are built from the real selection, so what P1/P2 mean is whatever retrieval chose.
  const picked = () => retrieve(index, 'widget', cfg({ clusterCount: 3, fragmentsPerCluster: 2 })).collections.flatMap(c => c.passages);
  const goodLlm = (): LlmService => ({
    call: async () => JSON.stringify({ context: 'About widgets.', clusters: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }], edges: [{ source: 0, target: 1, label: 'led to' }] }),
    async *stream() {
      const [p1, p2] = picked();
      yield JSON.stringify({ passage: 'P1', type: 'concept', title: 'first card', body: p1.text.split('. ')[0], bridge: 'The invention itself.' }) + '\n';
      yield JSON.stringify({ passage: 'P2', type: 'event', title: 'second card', body: p2.text.split('. ')[0], bridge: 'Another route.' }) + '\n';
    },
  });

  it('shows retrieval results instantly — skeleton and excerpt cards — before any model call', async () => {
    let llmCalled = false;
    const llm: LlmService = { call: async () => { llmCalled = true; throw new Error('should not matter'); }, async *stream() { /* none */ } };
    const gen = runStrategy('widget', { strategy: 'lensed', signal: new AbortController().signal, retriever, llm, ai: null });
    const seen: WebEvent[] = [];
    // take events until the first status ("Outlining…"): everything before it must exist without the model
    for await (const e of gen) { seen.push(e); if (e.type === 'status') break; }
    expect(llmCalled).toBe(false);
    expect(seen[0].type).toBe('overview'); // the skeleton is the first thing on screen
    const overview = seen.find(e => e.type === 'overview') as Extract<WebEvent, { type: 'overview' }>;
    expect(overview.clusters.every(c => c.slots >= 1 && c.lens)).toBe(true);
    expect(overview.edges.length).toBe(overview.clusters.length - 1);
    const cards = seen.filter(e => e.type === 'fragment') as Array<Extract<WebEvent, { type: 'fragment' }>>;
    expect(cards.length).toBe(overview.clusters.reduce((n, c) => n + c.slots, 0));
    expect(cards[0].fragment).toMatchObject({ type: 'source', grounding: 1, draft: true });
    expect(cards[0].fragment.kbSources?.[0]).toMatch(/\.md$/);
  });

  it('upgrades excerpt cards in place with the model\'s cards, scored for grounding', async () => {
    const evs = await collect(goodLlm());
    const frags = evs.filter(e => e.type === 'fragment') as Array<Extract<WebEvent, { type: 'fragment' }>>;
    const written = frags.filter(f => f.fragment.bridge === 'The invention itself.');
    expect(written).toHaveLength(1);
    expect(written[0].fragment.grounding).toBeGreaterThan(0.5);
    expect(written[0].fragment.draft).toBeUndefined();
    expect(evs.at(-1)).toEqual({ type: 'done' });
    // the second overview carries the model's titles and edges
    const overviews = evs.filter(e => e.type === 'overview') as Array<Extract<WebEvent, { type: 'overview' }>>;
    expect(overviews).toHaveLength(2);
    expect(overviews[1].clusters.map(c => c.title)).toEqual(['First', 'Second', 'Third'].slice(0, overviews[1].clusters.length));
    expect(overviews[1].edges).toEqual([{ source: 0, target: 1, label: 'led to' }]);
  });

  it('flags cards that go beyond their passage', async () => {
    const llm: LlmService = { ...goodLlm(), async *stream() { yield JSON.stringify({ passage: 'P1', type: 'concept', title: 'x', body: 'A sailor from Norway sailed to Mars in 1903.', bridge: 'b' }) + '\n'; } };
    const evs = await collect(llm);
    const w = (evs.filter(e => e.type === 'fragment') as any[]).find(f => f.fragment.bridge === 'b');
    expect(w.fragment.grounding).toBeLessThan(0.4);
  });

  it('ties a card to its passage by content when the model gives a wrong id', async () => {
    const target = picked().find(p => p.source === 'tech/widget.md')!;
    const llm: LlmService = { ...goodLlm(), async *stream() { yield JSON.stringify({ passage: 'P99', type: 'concept', title: 'a card', body: target.text, bridge: 'wrongid' }) + '\n'; } };
    const evs = await collect(llm);
    const w = (evs.filter(e => e.type === 'fragment') as any[]).find(f => f.fragment.bridge === 'wrongid');
    expect(w.fragment.kbSources[0]).toBe(target.source);
  });

  it('keeps the KB-derived web on screen when the model is unreachable, and says so', async () => {
    const llm: LlmService = { call: async () => { const { WebsError } = await import('../src/backend/errors'); throw new WebsError('ollama-offline', 'Could not reach Ollama.'); }, async *stream() { /* none */ } };
    const evs = await collect(llm);
    expect(evs.filter(e => e.type === 'fragment').length).toBeGreaterThan(0);
    expect(evs.at(-1)).toMatchObject({ type: 'error', code: 'ollama-offline', message: expect.stringContaining('Showing your knowledge-base excerpts') });
  });

  it('reports kb-empty before doing anything else when nothing matches', async () => {
    const none: Retriever = { retrieve: async q => retrieve(index, 'zeppelin', cfg()) };
    const evs: WebEvent[] = [];
    for await (const e of runStrategy('zeppelin', { strategy: 'lensed', signal: new AbortController().signal, retriever: none, llm: goodLlm(), ai: null })) evs.push(e);
    expect(evs).toEqual([{ type: 'error', code: 'kb-empty', message: expect.any(String) }]);
  });
});

describe('canvas side', () => {
  it('progress counts written cards only, not draft excerpts', async () => {
    const { progress } = await import('../src/renderer/webModel');
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: '', clusters: [{ title: 'A', slots: 3 }], edges: [] });
    for (let i = 0; i < 3; i++) m = reduce(m, { type: 'fragment', cluster: 0, slot: i, fragment: { type: 'source', title: 't', body: 'b', draft: true } });
    expect(progress(m)).toEqual({ filled: 0, total: 3 });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 1, fragment: { type: 'concept', title: 't', body: 'b' } });
    expect(progress(m)).toEqual({ filled: 1, total: 3 });
  });

  it('a later overview updates titles/edges/context without wiping cards that already arrived', () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: '', clusters: [{ title: 'Route', slots: 2, lens: 'use' }], edges: [] });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 1, fragment: { type: 'source', title: 't', body: 'b' } });
    m = reduce(m, { type: 'overview', context: 'Ctx', clusters: [{ title: 'Model title', slots: 2 }], edges: [{ source: 0, target: 0, label: 'x' }] });
    expect(m.clusters[0]).toMatchObject({ title: 'Model title', lens: 'use' });
    expect(m.clusters[0].slots[1]).toMatchObject({ title: 't' });
    expect(m.context).toBe('Ctx');
    // an empty context never erases a real one
    expect(reduce(m, { type: 'overview', context: '', clusters: [{ title: 'T', slots: 2 }], edges: [] }).context).toBe('Ctx');
    // a different slot count is a different layout: reset
    expect(reduce(m, { type: 'overview', context: 'c', clusters: [{ title: 'T', slots: 3 }], edges: [] }).clusters[0].slots).toEqual([null, null, null]);
  });

  it('shows the bridge and the KB source on a card, and flags cards beyond the KB', () => {
    const base = { type: 'concept' as const, title: 't', body: 'body', bridge: 'Connected through confinement.', kbSources: ['society/confinement.md'] };
    expect(fragmentLook({ ...base, grounding: 0.9 }).label.text).toContain('↳ Connected through confinement.');
    expect(fragmentLook({ ...base, grounding: 0.9 }).label.text).toContain('▤ confinement.md');
    expect(fragmentLook({ ...base, grounding: 0.2 }).label.text).toContain('⚠ goes beyond your KB');
    expect(fragmentLook({ ...base, grounding: 0.2 }).label.text).not.toContain('▤');
    expect(fragmentLook({ type: 'concept', title: 't', body: 'b' }).label.text).not.toMatch(/[↳▤⚠]/);
  });
});
