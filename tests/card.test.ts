import { describe, expect, it } from 'vitest';
import { FRAG_H } from '../src/renderer/boxes';
import { cardLook, cardSize } from '../src/renderer/card';

const frag = (body: string, over: Record<string, unknown> = {}) => ({ type: 'concept', title: 't', body, ...over }) as any;
const long = 'Fields of study can be grouped into large categories like natural sciences, social sciences, formal sciences, humanities, and applied sciences. Each of these categories has smaller parts called disciplines. For example, biology is part of natural sciences, and economics belongs to social sciences. These disciplines can be divided even further. For instance, biology includes smaller areas like molecular biology, ecology and genetics.';

describe('card text', () => {
  it('shows the whole body: nothing is clipped or cut off with an ellipsis', () => {
    const text = cardLook(frag(long)).body.text.replace(/\s+/g, ' ');
    expect(text).toContain('molecular biology, ecology and genetics.');
    expect(text).not.toContain('…');
  });
  it('keeps a passage\'s own line breaks and list items', () => {
    const text = cardLook(frag('Intro line.\n\n- first item\n- second item')).body.text;
    expect(text).toContain('- first item\n- second item');
  });
  it('shows the whole bridge too', () => {
    const bridge = 'This connects the idea of grouping fields of study into disciplines to how the topic is organised across many sciences.';
    expect(cardLook(frag('b', { bridge })).body.text.replace(/\s+/g, ' ')).toContain(bridge);
  });
});

describe('cardSize', () => {
  it('grows with the text and never drops below the standard height', () => {
    expect(cardSize(frag('short')).height).toBe(FRAG_H);
    const tall = cardSize(frag(long + ' ' + long));
    expect(tall.height).toBeGreaterThan(cardSize(frag(long)).height);
    expect(cardSize(frag(long)).height).toBeGreaterThan(FRAG_H);
    expect(tall.width).toBe(cardSize(frag('x')).width);
  });
  it('draws no coloured outline for any source: a hairline only', () => {
    for (const origin of [undefined, 'ai', 'wiki']) {
      const s = cardLook(frag('b', { origin })).stroke;
      expect(s.strokeColor).toBe('#1B1B1B');
      expect((s as any).strokeStyle).toBeUndefined();
    }
  });
});
