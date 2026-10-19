import { describe, expect, it } from 'vitest';
import { BUDGET, clipCard, planDerived, quoteCard } from '../src/renderer/derived';
import { factsLayout, timelineLayout, wrapText, yearText } from '../src/renderer/infographic';

const frag = (body: string, over: Record<string, unknown> = {}) => ({ type: 'event', title: 'gutenberg bible', body, origin: 'wiki', sourceLabel: 'Simple English Wikipedia', kbSources: ['Gutenberg Bible'], link: 'https://simple.wikipedia.org/wiki/Gutenberg_Bible', ...over }) as any;
const figures = 'About 180 copies were made. Each page held 42 lines, and 2,500 letters could be set in a day. It sold for 30 florins.';
const dates = 'It was printed in 1455 in Mainz. Luther posted his theses in 1517 in Wittenberg. The first newspaper appeared in 1605 in Strasbourg.';

describe('planDerived', () => {
  it('shows three or more figures as a figures card, else three or more dates as a timeline, never both', () => {
    expect(planDerived(frag(figures)).map(d => d.kind)).toEqual(['facts']);
    expect(planDerived(frag(dates)).map(d => d.kind)).toEqual(['timeline']);
    expect(planDerived(frag(figures + ' ' + dates)).map(d => d.kind)).toEqual(['facts']);
    expect(planDerived(frag('A story with one figure, 180 copies, and little else.'))).toEqual([]);
  });
  it('offers a quotation alongside, verbatim', () => {
    const d = planDerived(frag('Voltaire wrote: "I disapprove of what you say, but I will defend to the death your right to say it." That is all.'));
    expect(d.map(x => x.kind)).toEqual(['quote']);
  });
  it('uses the original wording of a retold card, and nothing for AI-written, set-aside, draft or quote cards', () => {
    expect(planDerived(frag('A retelling with no figures at all.', { original: figures })).map(d => d.kind)).toEqual(['facts']);
    for (const over of [{ origin: 'ai' }, { dropped: true }, { draft: true }, { type: 'quote' }]) expect(planDerived(frag(figures, over))).toEqual([]);
  });
  it('keeps a budget so a web stays a web of ideas', () => { expect(BUDGET.infographics).toBeLessThanOrEqual(3); expect(BUDGET.quotes).toBeLessThanOrEqual(3); });
});

describe('the cards a quotation and a clip become', () => {
  it('sets the quotation large with the words exactly as the source has them, credited to who said it and where', () => {
    const q = quoteCard(frag('x'), { quote: 'I will defend to the death your right to say it', speaker: 'Voltaire' });
    expect(q).toMatchObject({ type: 'quote', title: 'Voltaire', body: '“I will defend to the death your right to say it”', bridge: 'Voltaire, in Gutenberg Bible', origin: 'wiki', link: 'https://simple.wikipedia.org/wiki/Gutenberg_Bible' });
    expect(quoteCard(frag('x'), { quote: 'q' }).bridge).toBe('from Gutenberg Bible');
  });
  it('makes a link card for a clip that opens on Commons', () => {
    expect(clipCard({ kind: 'video', title: 'The bells ringing', url: 'https://commons.wikimedia.org/wiki/File%3AB.webm' })).toMatchObject({ type: 'source', link: 'https://commons.wikimedia.org/wiki/File%3AB.webm', origin: 'wiki', sourceLabel: 'Wikimedia Commons' });
  });
});

describe('infographic layouts', () => {
  it('lays figures out two across, inside the picture', () => {
    const l = factsLayout([{ value: '180', label: 'copies', kind: 'figure' }, { value: '42', label: 'lines', kind: 'figure' }, { value: '2,500', label: 'letters', kind: 'figure' }]);
    expect(l.tiles.map(t => [t.x > 0, t.y > 0])).toHaveLength(3);
    expect(l.tiles[1].x).toBeGreaterThan(l.tiles[0].x); expect(l.tiles[2].y).toBeGreaterThan(l.tiles[0].y);
    for (const t of l.tiles) { expect(t.x + t.w).toBeLessThanOrEqual(l.width); expect(t.y + t.h).toBeLessThanOrEqual(l.height); }
  });
  it('spaces a timeline evenly in order, labels alternating above and below', () => {
    const l = timelineLayout([{ year: -44, label: 'a', text: 'a' }, { year: 1455, label: 'b', text: 'b' }, { year: 1517, label: 'c', text: 'c' }]);
    expect(l.marks.map(m => m.year)).toEqual(['44 BCE', '1455', '1517']);
    expect(l.marks.map(m => m.up)).toEqual([true, false, true]);
    expect(l.marks[1].x - l.marks[0].x).toBe(l.marks[2].x - l.marks[1].x);
    expect(l.marks.at(-1)!.x).toBeLessThan(l.width);
    expect(yearText(-509)).toBe('509 BCE');
  });
  it('wraps labels and ends with an ellipsis when they do not fit', () => {
    expect(wrapText('the first printing press in Europe', 14, 2)).toEqual(['the first', 'printing press…']);
    expect(wrapText('short', 14, 2)).toEqual(['short']);
  });
});

import { cardLook, cardSize } from '../src/renderer/card';
describe('how a quotation card looks', () => {
  const q = quoteCard(frag('x'), { quote: 'I disapprove of what you say, but I will defend to the death your right to say it', speaker: 'Voltaire' });
  const plain = { type: 'concept', title: 'same words', body: q.body, weight: 2 } as any;
  it('is set in the display face, larger and brighter than body text, and grows to hold it', () => {
    const look = cardLook(q), ref = cardLook(plain);
    expect(look.body.fontFamily).toBe(7);
    expect(look.body.fontSize).toBeGreaterThan(ref.body.fontSize);
    expect(look.body.strokeColor).not.toBe(ref.body.strokeColor);
    expect(cardSize(q).height).toBeGreaterThan(150);
    expect(cardLook(plain).body.fontFamily).toBe(8);
  });
});
