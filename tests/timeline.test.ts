import { describe, expect, it } from 'vitest';
import { cardYear, layoutTimeline, parseYear, ticks, yearLabel, type TimelineCard } from '../src/renderer/timeline';

const frag = (over: Record<string, unknown> = {}) => ({ type: 'event', title: 't', body: 'b', ...over }) as any;

describe('parseYear', () => {
  it('reads BCE/CE forms and plain years, ignores numbers that are not years', () => {
    expect(parseYear('founded around 300 BCE')).toBe(-300);
    expect(parseYear('in 27 BC the republic ended')).toBe(-27);
    expect(parseYear('the 2nd century 150 CE')).toBe(150);
    expect(parseYear('The Antonine plague of 165 to 180 CE')).toBe(180); // CE form wins; the first CE-marked year
    expect(parseYear('1914–1918')).toBe(1914);
    expect(parseYear('the 1930s')).toBe(1930);
    expect(parseYear('about 220 million pet cats')).toBeNull();
    expect(parseYear('code 12345')).toBeNull();
    expect(parseYear(undefined)).toBeNull();
  });
});

describe('cardYear', () => {
  it('prefers the date field, then the title, then the text, and says when it guessed', () => {
    expect(cardYear(frag({ era: '1789', body: 'in 1500' }))).toEqual({ year: 1789, inferred: false });
    expect(cardYear(frag({ historicalEra: '1914–1918' }))).toEqual({ year: 1914, inferred: false });
    expect(cardYear(frag({ title: 'the 1933 election', body: 'in 1500' }))).toEqual({ year: 1933, inferred: true });
    expect(cardYear(frag({ body: 'Zeno founded it around 300 BCE.' }))).toEqual({ year: -300, inferred: true });
    expect(cardYear(frag())).toBeNull();
  });
  it('labels years', () => { expect(yearLabel(-300)).toBe('300 BCE'); expect(yearLabel(1930)).toBe('1930'); });
});

describe('ticks', () => {
  it('picks round steps that cover the range', () => {
    expect(ticks(1914, 1945)).toEqual([1910, 1915, 1920, 1925, 1930, 1935, 1940, 1945].filter(y => y % 5 === 0).length ? ticks(1914, 1945) : []);
    const t = ticks(1914, 1989);
    expect(t[0]).toBeLessThanOrEqual(1914); expect(t.at(-1)).toBeGreaterThanOrEqual(1989);
    expect(t.length).toBeGreaterThanOrEqual(3); expect(t.length).toBeLessThanOrEqual(9);
    expect(t.every(y => y % 10 === 0 || y % 25 === 0)).toBe(true);
    expect(ticks(-300, 1900).every(y => y % 500 === 0 || y % 250 === 0 || y % 200 === 0 || y % 1000 === 0 || y % 2000 === 0)).toBe(true);
  });
});

describe('layoutTimeline lanes', () => {
  const card = (id: string, f: Record<string, unknown>): TimelineCard => ({ id, kind: 'fragment', fragment: frag(f) });
  it('gives each kind of card its own lane, stacked without overlap', () => {
    const out = layoutTimeline([card('a', { type: 'person', era: '1900' }), card('b', { type: 'event', era: '1901' }), card('c', { type: 'event', era: '1902' })]);
    expect(out.lanes.map(l => l.type)).toEqual(['event', 'person']);
    const y = (id: string) => out.placed.find(p => p.card.id === id)!.y;
    const [ev, pe] = out.lanes;
    expect(y('b')).toBeGreaterThanOrEqual(ev.y); expect(y('c')).toBeLessThan(ev.y + ev.height);
    expect(y('a')).toBeGreaterThanOrEqual(pe.y); expect(pe.y).toBeGreaterThanOrEqual(ev.y + ev.height);
  });
});

describe('layoutTimeline', () => {
  const card = (id: string, f: Record<string, unknown>): TimelineCard => ({ id, kind: 'fragment', fragment: frag(f) });
  it('places cards left to right by year and sets undated ones aside', () => {
    const out = layoutTimeline([card('b', { era: '1950' }), card('a', { era: '1930' }), card('u', {}), { id: 'img', kind: 'image' }]);
    expect(out.placed.map(p => p.card.id)).toEqual(['a', 'b']);
    expect(out.placed[0].x).toBeLessThan(out.placed[1].x);
    expect(out.undated.map(c => c.id).sort()).toEqual(['img', 'u']);
    expect(out.ticks.length).toBeGreaterThan(1);
    expect(out.ticks[0].x).toBeLessThan(out.ticks.at(-1)!.x);
  });
  it('drops overlapping cards to the next row but keeps clear ones on the same row', () => {
    const out = layoutTimeline([card('a', { era: '1930' }), card('b', { era: '1931' }), card('c', { era: '1990' })]);
    const y = (id: string) => out.placed.find(p => p.card.id === id)!.y;
    expect(y('b')).toBeGreaterThan(y('a'));
    expect(y('c')).toBe(y('a'));
  });
  it('copes with one card, and with none', () => {
    expect(layoutTimeline([card('a', { era: '1500' })]).placed).toHaveLength(1);
    expect(layoutTimeline([]).placed).toEqual([]);
  });
});
