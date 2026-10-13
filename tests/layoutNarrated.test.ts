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
