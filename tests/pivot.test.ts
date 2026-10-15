import { describe, it, expect } from 'vitest';
import { PassageIndex } from '../src/backend/retrieval/index';
import { retrieve, retrieveTerms } from '../src/backend/retrieval/retrieve';
import { defaultRetrieveConfig } from '../src/backend/retrieval/config';
import { seedTerms } from '../src/backend/retrieval/seed';
import { terms } from '../src/backend/retrieval/text';
import { pickCollection, runPivot } from '../src/backend/pivot';
import { WebsError } from '../src/backend/errors';
import type { Retriever } from '../src/backend/retrieval/service';
import type { LlmService } from '../src/backend/llm';
import type { GeneratedFragment, PivotEvent } from '../src/backend/events';
import { addPivotCluster, addThread, pivotFootprint, placePivot, sendToBack, threadLabelBox, usedPassageIds } from '../src/renderer/pivot';
import { hitTest } from '../src/renderer/hit';
import type { El } from '../src/renderer/sceneEdit';

const docs = [
  { source: 'tech/widget.md', text: `# Widget: invention

The widget was invented in 1874 by a mechanic who patented the first design.

Widgets were used on farms to separate fields and manage livestock.` },
  { source: 'history/uses.md', text: `# Widgets at war

Armies used widgets to block roads, which slowed infantry and led to new tactics.

Prison planners adopted widgets for confinement because they are cheap and hard to climb.` },
  { source: 'culture/symbol.md', text: `# Widget symbolism

Critics argue the widget is a symbol of dispossession, while others dispute this.

Prison confinement is a recurring metaphor in poetry, depicted through bars and walls.` },
  { source: 'misc/unrelated.md', text: `# Gardening

Tomatoes grow best in warm soil and full sun.` },
];
const index = PassageIndex.fromDocs(docs);
const cfg = { ...defaultRetrieveConfig, clusterCount: 4, fragmentsPerCluster: 3 };

describe('retrieval options', () => {
  it('never selects excluded passages', () => {
    const all = retrieve(index, 'widget', cfg).collections.flatMap(c => c.passages.map(p => p.id));
    expect(all.length).toBeGreaterThan(2);
    const exclude = new Set(all.slice(0, 3));
    const r = retrieve(index, 'widget', cfg, { exclude });
    for (const p of r.collections.flatMap(c => c.passages)) expect(exclude.has(p.id)).toBe(false);
  });
  it('retrieveTerms is retrieve() minus the tokenizing', () => {
    const q = [...new Set(terms('widget prison'))];
    expect(JSON.stringify(retrieveTerms(index, 'widget prison', q, cfg).collections)).toBe(JSON.stringify(retrieve(index, 'widget prison', cfg).collections));
  });
  it('excluding everything relevant yields nothing', () => {
    const every = new Set(index.passages.map(p => p.id));
    expect(retrieve(index, 'widget', cfg, { exclude: every }).collections).toEqual([]);
  });
});

describe('seedTerms', () => {
  it('picks informative terms present in the KB, title weighted, ignoring absent and ubiquitous ones', () => {
    const seed = seedTerms(index, 'Prison confinement', 'The planners wrote about zeppelin travel and confinement of widgets.', 4);
    expect(seed).toContain('prison');
    expect(seed).toContain('confinement');
    expect(seed).not.toContain('zeppelin'); // not in the KB: can't steer anything
    expect(seed.length).toBeLessThanOrEqual(4);
    // a term in nearly every passage (here: "widget") is too common to steer
    expect(seedTerms(index, 'widget', 'widget widget widget', 6, 0.6)).not.toContain('widget');
  });
});

describe('pickCollection', () => {
  const col = (lens: string) => ({ lens, label: lens, verb: 'v', passages: [{ id: 'x', source: 's', text: 't', heading: '', lens, score: { value: 1, rel: 1, conn: 1, nov: 1, red: 0 }, terms: [] }] });
  const r = (...lenses: string[]) => ({ query: 'q', terms: [], collections: lenses.map(col), considered: 1 });
  it('prefers a route different from the card\'s own and from plain similarity', () => {
    expect(pickCollection(r('direct', 'use', 'tension'), 'use')?.lens).toBe('tension');
    expect(pickCollection(r('direct', 'use'), 'tension')?.lens).toBe('use');
  });
  it('falls back gracefully, and returns null when there is nothing', () => {
    expect(pickCollection(r('direct'), 'tension')?.lens).toBe('direct');
    expect(pickCollection(r('use'), 'use')?.lens).toBe('use');
    expect(pickCollection(r(), 'use')).toBeNull();
  });
});

describe('runPivot', () => {
  const card: GeneratedFragment = { type: 'concept', title: 'prison confinement', body: 'Prison planners adopted widgets for confinement.', lens: 'use', kbPassageIds: ['history/uses.md#1'] };
  const retriever: Retriever = {
    retrieve: async () => { throw new Error('unused'); },
    retrieveFromCard: async (c, opts) => {
      const q = seedTerms(index, c.title, c.body);
      return retrieveTerms(index, q.join(' '), q, cfg, opts);
    },
  };
  const collect = async (llm: LlmService, req = { card, usedPassageIds: ['history/uses.md#1'] }, signal = new AbortController().signal) => {
    const out: PivotEvent[] = [];
    for await (const e of runPivot(req, { signal, retriever, llm })) out.push(e);
    return out;
  };
  const picked = async () => {
    const r = await retriever.retrieveFromCard(card, { exclude: new Set(['history/uses.md#1']) });
    return pickCollection(r, card.lens)!;
  };
  const goodLlm = (): LlmService => ({
    call: async () => JSON.stringify({ title: 'Walls and Bars', edge: 'echoed in' }),
    async *stream() {
      const c = await picked();
      yield JSON.stringify({ passage: 'P1', type: 'concept', title: 'first', body: c.passages[0].text.split('. ')[0], bridge: 'A link.' }) + '\n';
    },
  });

  it('plans from the KB instantly — before any model call — never repeating used passages', async () => {
    let called = false;
    const llm: LlmService = { call: async () => { called = true; return '{}'; }, async *stream() { /* none */ } };
    const seen: PivotEvent[] = [];
    for await (const e of runPivot({ card, usedPassageIds: ['history/uses.md#1'] }, { signal: new AbortController().signal, retriever, llm })) { seen.push(e); if (e.type === 'status') break; }
    expect(called).toBe(false);
    expect(seen[0].type).toBe('plan');
    const plan = seen[0] as Extract<PivotEvent, { type: 'plan' }>;
    expect(plan.cards.length).toBeGreaterThan(0);
    expect(plan.cards.every(c => c.draft && c.kbPassageIds?.[0] !== 'history/uses.md#1')).toBe(true);
    expect(plan.lens).not.toBe('use'); // a different angle than the card's own route
    expect(plan.edge).toBeTruthy();
  });

  it('then names the collection and replaces drafts with grounded cards', async () => {
    const evs = await collect(goodLlm());
    expect(evs.map(e => e.type)).toEqual(['plan', 'status', 'title', 'status', 'card', 'done']);
    expect(evs.find(e => e.type === 'title')).toEqual({ type: 'title', title: 'Walls and Bars', edge: 'echoed in' });
    const c = evs.find(e => e.type === 'card') as Extract<PivotEvent, { type: 'card' }>;
    expect(c.slot).toBe(0);
    expect(c.fragment).toMatchObject({ bridge: 'A link.', lens: expect.any(String) });
    expect(c.fragment.grounding).toBeGreaterThan(0.5);
    expect(c.fragment.draft).toBeUndefined();
  });

  it('says so plainly when nothing new connects', async () => {
    const all = index.passages.map(p => p.id);
    const evs = await collect(goodLlm(), { card, usedPassageIds: all });
    expect(evs).toEqual([{ type: 'error', code: 'kb-empty', message: expect.stringContaining('Nothing new') }]);
  });

  it('keeps the planned collection when the model fails, and reports why', async () => {
    const llm: LlmService = { call: async () => { throw new WebsError('ollama-offline', 'Could not reach Ollama.'); }, async *stream() { /* none */ } };
    const evs = await collect(llm);
    expect(evs[0].type).toBe('plan');
    expect(evs.at(-1)).toMatchObject({ type: 'error', code: 'ollama-offline', message: expect.stringContaining('Showing your knowledge-base excerpts') });
  });

  it('keeps the route label if the model gives an unusable title, and stays silent when cancelled', async () => {
    const evs = await collect({ ...goodLlm(), call: async () => 'not json' });
    expect((evs.find(e => e.type === 'title') as any).title).toBeTruthy();
    const llm: LlmService = { call: async () => { throw new WebsError('cancelled', 'Cancelled.'); }, async *stream() { /* none */ } };
    const cancelled = await collect(llm);
    expect(cancelled.map(e => e.type)).toEqual(['plan', 'status']); // no error, no done
  });

  it('ties a card to its passage by what the model says about it when it gives a wrong id', async () => {
    const c = await picked();
    const llm: LlmService = { ...goodLlm(), async *stream() { yield JSON.stringify({ passage: 'P99', type: 'concept', title: 'x', bridge: c.passages[0].text.split('. ')[0] }) + '\n'; } };
    const evs = await collect(llm);
    const card0 = evs.find(e => e.type === 'card') as Extract<PivotEvent, { type: 'card' }>;
    expect(card0.fragment.kbSources?.[0]).toBe(c.passages[0].source);
  });
});

// ── scene logic ──────────────────────────────────────────────────────────────────────────────────

const build = (sk: unknown[]): El[] => (sk as El[]).flatMap(s => {
  const { label, ...box } = s;
  const out: El[] = [{ version: 1, ...box, boundElements: label ? [{ type: 'text', id: `${s.id}-t` }] : null }];
  if (label) out.push({ type: 'text', id: `${s.id}-t`, containerId: s.id, text: label.text, x: s.x + 5, y: s.y + 5, width: 10, height: 10, version: 1 });
  return out;
});
const rect = (id: string, x: number, y: number, extra: El = {}): El => ({ id, type: 'rectangle', x, y, width: 280, height: 150, version: 1, ...extra });
const frag = (cluster: number, slot: number, ids: string[] = []): El['customData'] => ({ kind: 'fragment', cluster, slot, fragment: { type: 'concept', title: 't', body: 'b', kbPassageIds: ids } });
const head = (i: number, y = 0): El => rect(`cluster-${i}`, i * 400, y, { height: 48, customData: { kind: 'cluster', index: i, title: `C${i}` } });

describe('pivot scene logic', () => {
  const scene = [head(0), head(1), rect('f0', 0, 80, { customData: frag(0, 0, ['a#0']) }), rect('f1', 400, 80, { customData: frag(1, 0, ['b#2', 'a#0']) }), rect('gone', 800, 0, { isDeleted: true, customData: frag(1, 1, ['zzz#1']) })];

  it('collects the KB passages already on the canvas, ignoring deleted cards', () => {
    expect(usedPassageIds(scene).sort()).toEqual(['a#0', 'b#2']);
  });

  it('places the new collection clear of everything, numbered next, and not on top of anything', () => {
    const pos = placePivot(scene, 'f0')!;
    expect(pos.index).toBe(2);
    const foot = pivotFootprint(pos, 3);
    for (const e of scene.filter(e => !e.isDeleted)) {
      const hit = foot.x < e.x + e.width && e.x < foot.x + foot.width && foot.y < e.y + e.height && e.y < foot.y + foot.height;
      expect(hit).toBe(false);
    }
    expect(placePivot([...scene, rect('free', 0, 500)], 'free')).toMatchObject({ index: 2 }); // no header needed
    expect(placePivot(scene, 'nope')).toBeNull();
  });

  it('builds a header and one card per draft, fanned around it and tagged', () => {
    const cards: GeneratedFragment[] = [{ type: 'source', title: 'a', body: 'x', draft: true }, { type: 'source', title: 'b', body: 'y', draft: true }];
    const r = addPivotCluster(scene, { id: 'pv-1', x: 1000, y: 0, index: 2, angle: 0, title: 'New angle', lens: 'tension', fromCardId: 'f0', cards }, build);
    expect(r.cardIds).toEqual(['pv-1-c0', 'pv-1-c1']);
    const header = r.elements.find(e => e.id === 'pv-1')!;
    expect(header.customData).toMatchObject({ kind: 'cluster', index: 2, lens: 'tension', pivotFrom: 'f0' });
    const c0 = r.elements.find(e => e.id === 'pv-1-c0')!, c1 = r.elements.find(e => e.id === 'pv-1-c1')!;
    expect(c0.customData).toMatchObject({ kind: 'fragment', cluster: 2, slot: 0 });
    const away = (c: any) => Math.hypot(c.x + c.width / 2 - (1000 + 140), c.y + c.height / 2 - (0 + 24));
    expect(away(c0)).toBeCloseTo(400); expect(away(c1)).toBeCloseTo(400); // equidistant from the header
    expect(c0.y).not.toBe(c1.y);                                         // spread around it, not stacked
  });

  it('links with a bound arrow drawn behind everything, with its label right after it', () => {
    const s = [rect('card', 0, 0), rect('mid', 400, 0), rect('target', 800, 0)];
    const out = addThread(s, { id: 'thread', fromId: 'card', toId: 'target', label: 'led to' }, build, raw => ({ version: 1, ...raw }));
    expect(out[0].id).toBe('thread');
    expect(out[1]).toMatchObject({ type: 'text', containerId: 'thread', text: 'led to' });
    const arrow = out[0];
    expect(arrow).toMatchObject({ startBinding: { elementId: 'card' }, endBinding: { elementId: 'target' }, endArrowhead: null, customData: { directed: true } });
    expect(arrow.x).toBe(280); // leaves the right edge of the source card
    expect(arrow.x + arrow.points[1][0]).toBe(800); // lands on the left edge of the target
    for (const id of ['card', 'target']) expect(out.find(e => e.id === id)!.boundElements).toEqual(expect.arrayContaining([{ type: 'arrow', id: 'thread' }]));
    expect(out.find(e => e.id === 'mid')!.boundElements ?? []).toEqual([]);
  });

  it('puts the thread label in the free gap before the target, not at the midpoint behind a card', () => {
    const s = [rect('card', 0, 0), rect('mid', 400, 0), rect('target', 800, 0)];
    const out = addThread(s, { id: 'thread', fromId: 'card', toId: 'target', label: 'led to' }, build, raw => ({ version: 1, ...raw }));
    const arrow = out[0];
    const box = threadLabelBox(arrow);
    const endX = arrow.x + arrow.points[1][0];
    expect(Math.abs(box.x + 40 - (endX - 70))).toBeLessThan(1); // 70px before the target
    expect(box.x + box.width).toBeLessThan(endX);
    const mid = s[1]; // the midpoint of this thread sits inside this card; the label must not
    expect(box.x > mid.x + mid.width).toBe(true);
    expect(out[1].x).toBeCloseTo(box.x + 5, 0); // the built label was laid out in that box
  });

  it('does nothing if an endpoint is missing', () => {
    const s = [rect('card', 0, 0)];
    expect(addThread(s, { id: 't', fromId: 'card', toId: 'missing' }, build, r => r)).toBe(s);
    expect(sendToBack([rect('a', 0, 0), rect('b', 0, 0)], ['b']).map(e => e.id)).toEqual(['b', 'a']);
  });
});

describe('hit-testing follows stacking order', () => {
  const card = rect('card', 0, 0, { customData: { kind: 'fragment' } });
  const thread = { id: 'thread', type: 'arrow', x: -100, y: 75, points: [[0, 0], [600, 0]], version: 1 } as El; // runs straight through the card

  it('a thread drawn behind a card does not steal clicks meant for the card', () => {
    expect(hitTest([thread, card], 140, 75, 1)).toEqual({ id: 'card', kind: 'fragment' });
  });
  it('a line drawn on top of a card still wins where it crosses it, and the card wins elsewhere', () => {
    expect(hitTest([card, thread], 140, 75, 1)).toEqual({ id: 'thread', kind: 'edge' });
    expect(hitTest([card, thread], 140, 20, 1)).toEqual({ id: 'card', kind: 'fragment' });
  });
  it('the thread is still reachable in the gaps where no card covers it', () => {
    expect(hitTest([thread, card], 420, 75, 1)).toEqual({ id: 'thread', kind: 'edge' });
  });
});
