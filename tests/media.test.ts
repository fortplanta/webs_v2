import { describe, expect, it } from 'vitest';
import { extractFacts, extractQuotes, extractTimeline } from '../src/backend/media';

const press = 'Johannes Gutenberg made the first printing press in the 15th century. The Gutenberg Bible was printed in 1455 and about 180 copies were made. Each page held 42 lines, and a skilled team could set 2,500 letters in a day. By 1500, more than 20 million books had been printed in Europe. Martin Luther posted his theses in 1517.';

describe('extractFacts', () => {
  it('lifts figures and what they count, as written, with quantities before years', () => {
    const facts = extractFacts(press, 5);
    expect(facts.map(f => f.value)).toEqual(expect.arrayContaining(['20 million', '180', '42', '2,500']));
    const copies = facts.find(f => f.value === '180')!;
    expect(copies).toMatchObject({ label: 'copies', kind: 'figure' });
    expect(facts.find(f => f.value === '20 million')!.label).toBe('books');
    expect(facts.some(f => f.value === '15')).toBe(false);   // "15th century" is not a quantity
    expect(facts.find(f => f.value === '1455')!.label).toBe('The Gutenberg Bible was printed');
    // everything shown is a substring of the source
    for (const f of facts) { expect(press).toContain(f.value.replace(/ (million|percent|%)$/i, '')); }
    expect(facts.findIndex(f => f.kind === 'figure')).toBeLessThan(facts.findIndex(f => f.kind === 'year') === -1 ? 99 : facts.findIndex(f => f.kind === 'year'));
  });
  it('ignores bare small numbers and gives nothing for text without figures', () => {
    expect(extractFacts('He was one of the 1 people there and left.')).toEqual([]);
    expect(extractFacts('A story about ideas and the people who had them.')).toEqual([]);
  });
});

describe('extractTimeline', () => {
  it('orders dated sentences, one per year, and needs at least three years', () => {
    const t = extractTimeline(press);
    expect(t.map(e => e.year)).toEqual([1455, 1500, 1517]);
    expect(t[0].label.length).toBeLessThanOrEqual(58);
    for (const e of t) expect(press).toContain(e.text);
    expect(extractTimeline('It happened in 1455 and again in 1500.')).toEqual([]);
  });
  it('reads BCE years', () => {
    const t = extractTimeline('Rome began the republic in 509 BCE after kings. Julius Caesar was killed in 44 BCE by senators. Augustus became emperor in 27 BCE and ended it.');
    expect(t.map(e => e.year)).toEqual([-509, -44, -27]);
  });
});

describe('extractQuotes', () => {
  const text = 'Critics were harsh. Voltaire wrote: "I disapprove of what you say, but I will defend to the death your right to say it." Short ones like "good luck" are not quotes worth a card.';
  it('finds quotations of real length, verbatim, with who said them', () => {
    const q = extractQuotes(text);
    expect(q).toHaveLength(1);
    expect(q[0].quote).toBe('I disapprove of what you say, but I will defend to the death your right to say it.');
    expect(q[0].speaker).toBe('Voltaire');
    expect(text).toContain(q[0].quote);
  });
});

describe('real-world passages', () => {
  const specs = 'The Gutenberg Bible (also known as the 42-line Bible or the Mazarin Bible) is a printed version of the Latin Vulgate. Fewer than 200 were made, and 49 complete or nearly complete ones are known. It has 1286 pages. The earliest known book with movable type was published 78 years before in Korea.';
  it('labels what a figure counts: a noun phrase, a compound\'s noun, or the clause when a verb follows', () => {
    const f = Object.fromEntries(extractFacts(specs, 6).map(x => [x.value, x.label]));
    expect(f['42']).toBe('line Bible');
    expect(f['200']).toBe('Fewer than 200 were made');
    expect(f['49']).toBe('complete or nearly complete');
    expect(f['78']).toBe('years');
    for (const label of Object.values(f)) expect(specs).toContain(label.split(' ')[0]);
  });
  it('reads a dated list one item per line, without its bullets, colons or year', () => {
    const list = '- 1382: John Wycliffe first translates the Bible from Latin\n- 1454: A movement begins to translate the Bible into many other languages. The mass production of Bibles begins.\n- 1517: Martin Luther writes the Ninety-Five Theses.';
    const t = extractTimeline(list);
    expect(t.map(e => e.year)).toEqual([1382, 1454, 1517]);
    expect(t[0].label).toBe('John Wycliffe first translates the Bible from Latin');
    expect(t[1].label.startsWith('A movement begins')).toBe(true);
    for (const e of t) expect(e.label).not.toMatch(/^[-:–\s]|:/);
  });
});
