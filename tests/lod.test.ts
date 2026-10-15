import { describe, expect, it } from 'vitest';
import { coverAmount, lodItems, tierFor } from '../src/renderer/lod';

const card = (id: string, x: number, y: number, f: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x, y, width: 290, height: 200, customData: { kind: 'fragment', fragment: { type: 'event', title: id, body: 'b', ...f } } }) as any;
const view = (zoom: number) => ({ scrollX: 0, scrollY: 0, zoom, width: 1000, height: 800 });

describe('level of detail', () => {
  it('only covers cards once they are properly small, fading the cover in rather than popping', () => {
    expect([1, 0.6, 0.4, 0.32, 0.3, 0.1].map(tierFor)).toEqual(['full', 'full', 'full', 'full', 'titles', 'titles']);
    expect(coverAmount(0.4)).toBe(0); expect(coverAmount(0.2)).toBe(1);
    expect(coverAmount(0.29)).toBeGreaterThan(0); expect(coverAmount(0.29)).toBeLessThan(1);
  });
  it('covers nothing at full detail', () => { expect(lodItems([card('a', 0, 0)], view(0.5))).toEqual([]); });
  it('maps cards to screen rectangles; titles are small, a little bigger for what matters more, and shrink with the zoom', () => {
    const [a, b] = lodItems([card('a', 100, 50, { weight: 3 }), card('b', 0, 0, { weight: 1 })], { ...view(0.3), scrollX: 10, scrollY: 20 });
    expect(a).toMatchObject({ x: 33, y: 21, w: 87, h: 60, weight: 3, fontPx: 11 });
    expect(a.fontPx).toBeGreaterThan(b.fontPx);
    expect(b.fontPx).toBeLessThanOrEqual(10);
  });
  it('drops the title when the card is too small to read it, keeping the colour block', () => {
    const [tiny] = lodItems([card('t', 0, 0)], view(0.1));
    expect(tiny).toMatchObject({ w: 29, fontPx: 0 });
  });
  it('skips selected, deleted, off-screen and non-card elements', () => {
    const items = lodItems([card('sel', 0, 0), { ...card('gone', 0, 0), isDeleted: true }, card('far', 9000, 0), { id: 'free', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 } as any, card('ok', 10, 10)], view(0.25), new Set(['sel']));
    expect(items.map(i => i.id)).toEqual(['ok']);
  });
});
