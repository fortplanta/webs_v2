import { describe, expect, it } from 'vitest';
import { buildSkeletons } from '../src/renderer/layout';
import { initialModel, reduce } from '../src/renderer/webModel';
import { cardSize } from '../src/renderer/card';

const frag = (title: string, over: Record<string, unknown> = {}) => ({ type: 'concept', title, body: 'A passage. '.repeat(10), kbPassageIds: [`p-${title}`], ...over }) as any;
const model = (slots: Array<any | null>[], context = 'The through-line.') => {
  let m = initialModel('q');
  m = reduce(m, { type: 'overview', context, clusters: slots.map((s, i) => ({ title: `c${i}`, slots: s.length })), edges: [] });
  slots.forEach((s, ci) => s.forEach((f, fi) => { if (f) m = reduce(m, { type: 'fragment', cluster: ci, slot: fi, fragment: f }); }));
  return m;
};
const ids = (sk: Array<Record<string, any>>) => sk.map(e => e.id as string);

describe('how collections hang together', () => {
  const built = () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: 'c', clusters: [{ title: 'a', slots: 1, edge: 'led to' }, { title: 'b', slots: 1, edge: 'contested by' }, { title: 'c', slots: 1 }], edges: [{ source: 1, target: 2, label: 'grew into' }] });
    for (let i = 0; i < 3; i++) m = reduce(m, { type: 'fragment', cluster: i, slot: 0, fragment: frag(`f${i}`) });
    return buildSkeletons(reduce(m, { type: 'done' })) as Array<Record<string, any>>;
  };
  it('every collection is joined to the origin, labelled with how it relates to the question', () => {
    const sk = built();
    const links = sk.filter(e => /^origin-/.test(e.id));
    expect(links.map(e => [e.start.id, e.end.id])).toEqual([['seed', 'cluster-0'], ['seed', 'cluster-1'], ['seed', 'cluster-2']]);
    expect(links.map(e => e.label?.text)).toEqual(['led to', 'contested by', undefined]);
    expect(links.every(e => e.endArrowhead === null && e.customData.directed)).toBe(true);
  });
  it('collections are joined to each other only by a stated tangent, never all to the first one', () => {
    const edges = built().filter(e => /^edge-/.test(e.id));
    expect(edges.map(e => [e.start.id, e.end.id, e.label.text])).toEqual([['cluster-1', 'cluster-2', 'grew into']]);
  });
});

describe('placeholders for cards that never arrived', () => {
  it('draws a faint placeholder and its line while the web is being written, and neither once it is finished', () => {
    const running = model([[frag('a'), null, null]]);
    expect(ids(buildSkeletons(running))).toEqual(expect.arrayContaining(['frag-0-1', 'tether-0-1', 'frag-0-2', 'tether-0-2']));
    const done = reduce(running, { type: 'done' });
    const sk = ids(buildSkeletons(done));
    expect(sk).toEqual(expect.arrayContaining(['frag-0-0', 'tether-0-0']));
    expect(sk.some(id => /frag-0-[12]|tether-0-[12]/.test(id))).toBe(false); // no lines to nothing
  });
  it('hides a collection none of whose cards ever arrived', () => {
    const done = reduce(model([[null, null], [frag('b')]]), { type: 'done' });
    expect(ids(buildSkeletons(done))).not.toContain('cluster-0');
  });
});

describe('layout of a narrated web', () => {
  it('does not draw passages the narrator set aside, nor a collection with nothing left', () => {
    const sk = buildSkeletons(model([[frag('a'), frag('b', { dropped: true })], [frag('c', { dropped: true })]]));
    expect(ids(sk)).toContain('frag-0-0');
    expect(ids(sk)).not.toContain('frag-0-1');
    expect(ids(sk)).not.toContain('cluster-1');
    expect(ids(sk).some(i => i.startsWith('tether-1-'))).toBe(false);
  });

  it('sizes a card by its weight, and by how much text it has', () => {
    const sk = buildSkeletons(model([[frag('hi', { weight: 3 }), frag('lo', { weight: 1 }), frag('long', { weight: 2, body: 'More text here. '.repeat(60) })]]));
    const box = (id: string) => sk.find(e => e.id === id) as any;
    expect(box('frag-0-0').width).toBeGreaterThan(box('frag-0-1').width);
    expect(box('frag-0-2').height).toBeGreaterThan(box('frag-0-1').height);
    expect(box('frag-0-2').height).toBe(cardSize(frag('long', { body: 'More text here. '.repeat(60) })).height);
  });

  it('draws a labelled arrow between two cards the narrator linked, once, and a kind mark on each card', () => {
    const sk = buildSkeletons(model([[frag('a', { relates: [{ to: 'p-b', verb: 'led to' }] }), frag('b', { relates: [{ to: 'p-a', verb: 'mirrors' }] })]]));
    const rel = sk.filter(e => String(e.id).startsWith('rel-')) as any[];
    expect(rel).toHaveLength(1);                                              // the reverse link is not drawn twice
    expect(rel[0]).toMatchObject({ start: { id: 'frag-0-0' }, end: { id: 'frag-0-1' }, label: { text: 'led to' } });
    expect(ids(sk)).toEqual(expect.arrayContaining(['frag-0-0-dot', 'frag-0-1-dot']));
  });

  it('shows the narrator\'s through-line in full under the topic', () => {
    const line = 'These pieces show how a hypothesis gets tested and then thrown out when the evidence disagrees with it, which is the whole point.';
    const sub = buildSkeletons(model([[frag('a')]], line)).find(e => e.id === 'seed-sub') as any;
    expect(sub.text.replace(/\s+/g, ' ')).toBe(line);
  });
});
