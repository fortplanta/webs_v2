import { describe, expect, it } from 'vitest';
import { coverAmount, lodItems, tierFor } from '../src/renderer/lod';

const card = (id: string, x: number, y: number, f: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x, y, width: 290, height: 200, customData: { kind: 'fragment', fragment: { type: 'event', title: id, body: 'b', ...f } } }) as any;
const view = (zoom: number) => ({ scrollX: 0, scrollY: 0, zoom, width: 1000, height: 800 });

describe('level of detail', () => {
  it('picks a tier by zoom, fading the cover in rather than popping', () => {
    expect([1, 0.6, 0.5, 0.3, 0.19].map(tierFor)).toEqual(['full', 'full', 'titles', 'titles', 'dots']);
    expect(coverAmount(0.6)).toBe(0); expect(coverAmount(0.3)).toBe(1);
    expect(coverAmount(0.5)).toBeGreaterThan(0); expect(coverAmount(0.5)).toBeLessThan(1);
  });
  it('covers nothing at full detail', () => { expect(lodItems([card('a', 0, 0)], view(1))).toEqual([]); });
  it('maps cards to screen rectangles, sized by weight', () => {
    const [a, b] = lodItems([card('a', 100, 50, { weight: 3 }), card('b', 0, 0, { weight: 1 })], { ...view(0.4), scrollX: 10, scrollY: 20 });
    expect(a).toMatchObject({ x: 44, y: 28, w: 116, h: 80, weight: 3, fontPx: 17 });
    expect(b.fontPx).toBe(12);
  });
  it('skips selected, deleted, off-screen and non-card elements', () => {
    const items = lodItems([card('sel', 0, 0), { ...card('gone', 0, 0), isDeleted: true }, card('far', 9000, 0), { id: 'free', type: 'rectangle', x: 0, y: 0, width: 5, height: 5 } as any, card('ok', 10, 10)], view(0.4), new Set(['sel']));
    expect(items.map(i => i.id)).toEqual(['ok']);
  });
});
