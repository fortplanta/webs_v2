import { describe, expect, it } from 'vitest';
import { candidatePairs, checkClaims, checkRetelling, clampWeight, restoreNames, sentenceCase, sharedTerms, weightFor } from '../src/backend/narration';
import { parseLensedOverview } from '../src/backend/parse';
import { runStrategy } from '../src/backend/strategies';
import type { LlmService } from '../src/backend/llm';
import type { WebEvent } from '../src/backend/events';
import type { Retriever } from '../src/backend/retrieval/service';

const source = 'Stoicism was founded by Zeno of Citium in Athens around 300 BCE. It teaches that virtue is the only good and that we should focus on what is within our control.';

describe('checkClaims', () => {
  it('accepts text that only uses names and numbers from the source or the question', () => {
    expect(checkClaims('Zeno of Citium and the year 300', source).ok).toBe(true);
    expect(checkClaims('what resilience means for Stoicism', source, 'stoicism and resilience').ok).toBe(true);
    expect(checkClaims('Sentence-initial words are fine. Even so, it holds.', source).ok).toBe(true);
  });
  it('refuses a number or a name the source does not contain', () => {
    expect(checkClaims('founded in 301 BCE', source)).toMatchObject({ ok: false, reason: expect.stringContaining('301') });
    expect(checkClaims('founded by Zeno, a student of Plato', source)).toMatchObject({ ok: false, reason: expect.stringContaining('plato') });
  });
});

describe('checkRetelling', () => {
  it('accepts a faithful reworded retelling of about the same length', () => {
    const r = 'Around 300 BCE in Athens, Zeno of Citium started Stoicism. The big idea: virtue is the only real good, so put your energy into what you actually control.';
    expect(checkRetelling(source, r)).toEqual({ ok: true });
  });
  it('refuses one that adds a fact, leaves things out, or pads', () => {
    expect(checkRetelling(source, source.replace('300 BCE', '300 BCE, after a shipwreck in 312'))).toMatchObject({ ok: false });
    expect(checkRetelling(source, 'Zeno founded Stoicism in Athens.')).toMatchObject({ ok: false, reason: expect.stringContaining('shorter') });
    expect(checkRetelling(source, source.replace('300 BCE', 'the third century')).ok).toBe(false); // dropped a number
    expect(checkRetelling(source, source + ' ' + source + ' ' + source)).toMatchObject({ ok: false, reason: expect.stringContaining('longer') });
  });
});

describe('small helpers', () => {
  it('capitalises sentence starts and counts shared vocabulary beyond the question', () => {
    expect(sentenceCase('it began. then it grew! "and so on". ok')).toBe('It began. Then it grew! "And so on". Ok');
    expect(sharedTerms(['a', 'b', 'c', 'x'], ['b', 'c', 'x', 'y'], ['x'])).toBe(2);
  });
});

describe('names, links and verdicts', () => {
  it('restores the capital letters of names the source has', () => {
    const src = 'Isaac Newton (1642–1727) wrote about Heidelbergensis and motion.';
    expect(restoreNames('isaac newton wrote about heidelbergensis and motion', src)).toBe('isaac Newton wrote about Heidelbergensis and motion'); // 'Isaac' opens the source's sentence, so only sentence-case fixes it
    const two = 'The result was clear. Then Newton and the Royal Society agreed.';
    expect(restoreNames('the result was clear. then newton and the royal society agreed.', two)).toBe('the result was clear. then Newton and the Royal Society agreed.'); // never capitalises ordinary words like "the"/"then"
    expect(sentenceCase(restoreNames('the result was clear. then newton agreed.', two))).toBe('The result was clear. Then Newton agreed.');
  });
  it('offers only pairs of passages that share real vocabulary, best first', () => {
    const ps = [{ id: 'P1', terms: ['a', 'b', 'c', 'q'] }, { id: 'P2', terms: ['a', 'b', 'c', 'd'] }, { id: 'P3', terms: ['x', 'y'] }, { id: 'P4', terms: ['a', 'b', 'c', 'd', 'e'] }];
    const pairs = candidatePairs(ps, ['q']);
    expect(pairs.map(p => `${p.a}~${p.b}`)).toEqual(['P2~P4', 'P1~P2', 'P1~P4']);
  });
  it('reads the narrator\'s verdicts: every off-topic passage is set aside', () => {
    const raw = JSON.stringify({ context: 'c', verdicts: { P1: 'fits', P2: 'off-topic', P3: 'not relevant' }, skip: ['p4'], clusters: [{ title: 'A' }], edges: [] });
    expect(parseLensedOverview(raw, 1).skip.sort()).toEqual(['P2', 'P3', 'P4']);
  });
});

describe('weights', () => {
  it('scales a passage against the best match', () => {
    expect(weightFor(10, 10)).toBe(3); expect(weightFor(5, 10)).toBe(2); expect(weightFor(1, 10)).toBe(1); expect(weightFor(1, 0)).toBe(2);
    expect(clampWeight(2)).toBe(2); expect(clampWeight(7)).toBeUndefined(); expect(clampWeight('3')).toBeUndefined();
  });
});

describe('the narrator in the lensed strategy', () => {
  const passage = (n: number, text: string, value: number) => ({ id: `a.md#${n}`, source: 'a.md', text, lens: 'direct', heading: `h${n}`, terms: ['stoic'], score: { value, rel: 1, conn: 0, nov: 1, red: 0 } });
  const p0 = { ...passage(0, source, 10), terms: ['zeno', 'citium', 'athen', 'virtu', 'good', 'control', 'stoic'] }, p1 = { ...passage(1, 'Epictetus, a former slave, taught that people are disturbed not by things but by their judgments about things. His student Arrian recorded the Discourses on virtue, what is good and what we control.', 4), terms: ['epictetus', 'slave', 'arrian', 'virtu', 'good', 'control', 'stoic'] };
  const retriever: Retriever = {
    retrieve: async q => ({ query: q, terms: ['stoic'], considered: 2, collections: [{ lens: 'direct', label: 'The thing itself', verb: 'led to', passages: [p0, p1] }] }),
    retrieveFromCard: async () => ({ query: '', terms: [], collections: [], considered: 0 }),
  };
  const outlineWith = (skip: string[] = []) => JSON.stringify({ context: 'Stoicism is a short list of ideas about what is yours to control.', skip, clusters: [{ title: 'where it started' }], edges: [] });
  const run = async (cards: object[], skip: string[] = []) => {
    const llm: LlmService = { call: async () => outlineWith(skip), async *stream() { for (const c of cards) yield JSON.stringify(c) + '\n'; } };
    const out: WebEvent[] = [];
    for await (const e of runStrategy('stoicism', { strategy: 'lensed', signal: new AbortController().signal, retriever, llm, ai: null, library: null, config: { clusterCount: 1, fragmentsPerCluster: 2 } })) out.push(e);
    return (out.filter(e => e.type === 'fragment') as any[]).map(e => e.fragment);
  };
  const faithful = 'Around 300 BCE in Athens, Zeno of Citium started Stoicism. The big idea: virtue is the only real good, so put your energy into what you actually control.';

  it('puts the passages up first, untouched and weighted by how well they matched', async () => {
    const frags = await run([]);
    expect(frags.map(f => f.body)).toEqual([source, p1.text]);
    expect(frags.map(f => f.weight)).toEqual([3, 1]);
    expect(frags.every(f => f.draft && !f.retold)).toBe(true);
  });

  it('uses a faithful retelling as the card text and keeps the original beside it', async () => {
    const frags = await run([{ passage: 'P1', type: 'concept', title: 'zeno starts it', hook: 'Where the whole thing begins.', weight: 3, retelling: faithful, relates: [{ to: 'P2', verb: 'led to' }] }]);
    const card = frags.find(f => f.retold)!;
    expect(card).toMatchObject({ body: faithful, original: source, title: 'zeno starts it', bridge: 'Where the whole thing begins.', weight: 3 });
    expect(card.relates).toEqual([{ to: 'a.md#1', verb: 'led to' }]); // by passage id, which survives reloads
  });

  it('refuses a retelling that invents something: the original text stays, and says why', async () => {
    const invented = faithful.replace('300 BCE', '312 BCE');
    const card = (await run([{ passage: 'P1', type: 'concept', title: 'zeno starts it', retelling: invented }])).find(f => f.title === 'zeno starts it')!;
    expect(card.body).toBe(source);
    expect(card.retold).toBeUndefined();
    expect(card.retellingRefused).toMatch(/312/);
  });

  it('replaces a title or hook that smuggles in a name or number the source lacks', async () => {
    const card = (await run([{ passage: 'P1', type: 'concept', title: 'plato in 400', hook: 'It all traces back to Plato in 400.' }])).find(f => f.kbPassageIds?.[0] === 'a.md#0' && !f.draft)!;
    expect(card.title).toBe('stoicism was founded by zeno'); // falls back to the passage's own opening words
    expect(card.bridge).toBeUndefined();      // and no hook rather than a made-up one
  });

  it('sets aside passages the narrator judges do not fit, from its first look and from its card pass', async () => {
    const early = await run([], ['P2']);
    expect(early.some(f => f.dropped && f.kbPassageIds?.[0] === 'a.md#1')).toBe(true);
    expect(early.some(f => f.dropped && f.kbPassageIds?.[0] === 'a.md#0')).toBe(false);
    const late = await run([{ passage: 'P2', fits: false }]);
    expect(late.filter(f => f.dropped).map(f => f.kbPassageIds[0])).toEqual(['a.md#1']);
    expect(late.filter(f => !f.dropped && !f.draft)).toHaveLength(0);
  });

  it('fixes a retelling written all in lowercase before checking it, and still refuses a short one', async () => {
    const lower = faithful.toLowerCase().replace('zeno of citium', 'Zeno of Citium').replace('athens', 'Athens').replace('bce', 'BCE');
    const ok = (await run([{ passage: 'P1', type: 'concept', title: 'a', retelling: lower }])).find(f => f.retold);
    expect(ok?.body.startsWith('Around 300 BCE')).toBe(true);
    const bad = (await run([{ passage: 'P1', type: 'concept', title: 'a', retelling: 'Zeno started Stoicism around 300 BCE in Athens.' }])).find(f => f.retellingRefused);
    expect(bad?.retellingRefused).toMatch(/shorter/);
  });

  it('keeps a link between cards only if they share real vocabulary', async () => {
    const p2 = { ...passage(2, 'Penguins live in the cold south and eat fish near the ice.', 3), terms: ['penguin', 'cold', 'south', 'fish', 'ice'] };
    const r: Retriever = { ...retriever, retrieve: async q => ({ query: q, terms: ['stoic'], considered: 3, collections: [{ lens: 'direct', label: 'x', verb: 'v', passages: [p0, p1, p2] }] }) };
    const llm: LlmService = { call: async () => outlineWith(), async *stream() { yield JSON.stringify({ passage: 'P1', type: 'concept', title: 'zeno', relates: [{ to: 'P2', verb: 'led to' }, { to: 'P3', verb: 'led to' }] }) + '\n'; } };
    const out: WebEvent[] = [];
    for await (const e of runStrategy('stoicism', { strategy: 'lensed', signal: new AbortController().signal, retriever: r, llm, ai: null, library: null, config: { clusterCount: 1, fragmentsPerCluster: 3 } })) out.push(e);
    const card = (out.filter(e => e.type === 'fragment') as any[]).map(e => e.fragment).find(f => !f.draft)!;
    expect(card.relates).toEqual([{ to: 'a.md#1', verb: 'led to' }]); // P2 shares vocabulary; P3 (penguins) does not
  });

  it('ignores links to passages that do not exist and links to itself', async () => {
    const card = (await run([{ passage: 'P1', type: 'concept', title: 'zeno starts it', relates: [{ to: 'P1', verb: 'is' }, { to: 'P9', verb: 'led to' }] }])).find(f => !f.draft)!;
    expect(card.relates).toBeUndefined();
  });
});

import { groundedWhen } from '../src/backend/narration';
describe('groundedWhen', () => {
  const src = 'Newton published the Principia in 1687. The Roman republic ended in 27 BCE.';
  it('keeps a year the passage states and drops one it does not', () => {
    expect(groundedWhen('1687', src)).toBe('1687');
    expect(groundedWhen('27 BCE', src)).toBe('27 BCE');
    expect(groundedWhen('1700', src)).toBeUndefined();
    expect(groundedWhen('sometime in the 1600s', src)).toBeUndefined();
    expect(groundedWhen(undefined, src)).toBeUndefined();
  });

  it('asks the AI for more when the narrator set aside so much that the web is thinner than asked for', async () => {
    const mk = (n: number, text: string) => ({ id: `a.md#${n}`, source: 'a.md', text, lens: 'direct', heading: `h${n}`, terms: ['stoic'], score: { value: 5, rel: 1, conn: 0, nov: 1, red: 0 } });
    const retriever: Retriever = {
      retrieve: async q => ({ query: q, terms: ['stoic'], considered: 2, collections: [{ lens: 'direct', label: 'The thing itself', verb: 'led to', passages: [mk(0, 'One stoic passage here.'), mk(1, 'Another stoic passage here.')] }] }),
      retrieveFromCard: async () => ({ query: '', terms: [], collections: [], considered: 0 }),
    };
    const outlineWith = (skip: string[]) => JSON.stringify({ context: 'Context.', skip, clusters: [{ title: 'where it started' }], edges: [] });
    const aiOutline = JSON.stringify({ context: 'About it.', clusters: [{ title: 'Another angle', edge: 'led to' }] });
    const aiCard = JSON.stringify({ cluster: 0, type: 'concept', title: 'an ai card', body: 'Body.', bridge: 'b' }) + '\n';
    const llm: LlmService = {
      // the local web: the narrator sets both passages aside; the AI answers with an outline and one card
      call: async o => (/canvas planner/.test(o.system) ? aiOutline : outlineWith(['P1', 'P2'])),
      async *stream(o) { if (/canvas writer/.test(o.system) && /^Collection:/m.test(o.user)) { yield aiCard; return; } if (/canvas writer/.test(o.system)) { yield aiCard; return; } },
    };
    const ai = { llm, model: 'm', topUp: true };
    const out: WebEvent[] = [];
    for await (const e of runStrategy('stoicism', { strategy: 'lensed', signal: new AbortController().signal, retriever, llm, ai, library: null, config: { clusterCount: 2, fragmentsPerCluster: 1 } })) out.push(e);
    expect(out.some(e => e.type === 'status' && /didn't fit/.test((e as any).message))).toBe(true);
    const outlines = out.filter(e => e.type === 'ai-outline') as any[];
    expect(outlines.length).toBeGreaterThanOrEqual(1);
    expect((out.filter(e => e.type === 'fragment') as any[]).some(e => e.fragment.origin === 'ai')).toBe(true);
  });
});

import { tangentEdges } from '../src/backend/strategies/lensed';
describe('tangentEdges', () => {
  const col = (terms: string[]) => ({ lens: 'direct', label: 'x', verb: 'v', passages: [{ id: 'p', source: 's', text: '', lens: 'direct', heading: '', terms, score: { value: 1, rel: 1, conn: 0, nov: 1, red: 0 } }] }) as any;
  it('believes a link between collections only when they share real vocabulary beyond the question', () => {
    const cols = [col(['glass', 'window', 'abbey', 'monk', 'saint']), col(['abbey', 'monk', 'saint', 'window', 'glass']), col(['mirror', 'myth', 'beauty', 'flaw', 'glass'])];
    const edges = [{ source: 0, target: 1, label: 'grew out of' }, { source: 0, target: 2, label: 'led to' }];
    expect(tangentEdges(edges, cols, ['glass'])).toEqual([edges[0]]);
  });
});

import { checkAiClaims, fillerCount } from '../src/backend/narration';
import { referenceOf } from '../src/backend/strategies/lensed';
describe('grounding AI-written cards', () => {
  const ref = 'Johannes Gutenberg made the first printing press in the 15th century. Friedrich Koenig patented a steam press in 1810 in London.';
  it('lets a card use names, years and figures that the reference passages contain', () => {
    expect(checkAiClaims('Friedrich Koenig patented a steam press in 1810. Say you print 30 pages a day.', ref).ok).toBe(true);
  });
  it('refuses an invented year, percentage or name', () => {
    expect(checkAiClaims('The press was banned in 1477.', ref)).toMatchObject({ ok: false, reason: expect.stringContaining('1477') });
    expect(checkAiClaims('Some 40% of Europeans could read.', ref)).toMatchObject({ ok: false, reason: expect.stringContaining('40') });
    expect(checkAiClaims('Then Aldus Manutius opened a shop.', ref)).toMatchObject({ ok: false, reason: expect.stringContaining('aldus') });
  });
  it('treats everything as unverifiable when there are no reference passages: only general explanation passes', () => {
    expect(checkAiClaims('You keep watching because you already paid for the ticket.', '').ok).toBe(true);
    expect(checkAiClaims('In 1971 the Washington Post kept going.', '').ok).toBe(false);
  });
  it('counts school-essay filler', () => {
    expect(fillerCount('This concept plays a crucial role and highlights the need.')).toBeGreaterThanOrEqual(3);
    expect(fillerCount('Bend a paperclip thirty times and it snaps.')).toBe(0);
  });
  it('builds the reference from the passages found, once each, capped', () => {
    const p = (id: string, text: string) => ({ id, source: `lib:${id}`, text, lens: 'direct', heading: '', terms: [], score: { value: 1, rel: 1, conn: 0, nov: 1, red: 0 } }) as any;
    const out = referenceOf([{ lens: 'direct', label: 'a', verb: 'v', passages: [p('One', 'first text'), p('One', 'first text')] }, { lens: 'direct', label: 'b', verb: 'v', passages: [p('Two', 'x'.repeat(2000))] }] as any, 100);
    expect(out.split('\n')).toHaveLength(2);
    expect(out).toContain('(One) first text');
  });
});
