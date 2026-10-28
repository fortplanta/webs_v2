import { describe, expect, it } from 'vitest';
import { cardGlow, convexHull, dotGap, dots, liftTarget, liftToward, paddedCorners, PARALLAX, regionHue, regionsOf, roundedOutline } from '../src/renderer/backdrop';

const view = { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 };

describe('dot field', () => {
  it('covers the view, evenly spaced', () => {
    const d = dots(view);
    expect(d.length).toBeGreaterThan(30);
    expect(d.some(p => p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 600)).toBe(true);
    const xs = [...new Set(d.map(p => Math.round(p.x)))].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBe(dotGap(1));
  });

  it('drifts slower than the cards when you pan, which is the depth', () => {
    const a = dots(view)[0], b = dots({ ...view, scrollX: -100 })[0];
    expect(Math.abs(a.x - b.x) % dotGap(1)).toBeCloseTo(100 * PARALLAX % dotGap(1), 5);
    expect(PARALLAX).toBeLessThan(1);
    // and with no parallax they pan exactly with the cards
    const c = dots(view, 1)[0], d = dots({ ...view, scrollX: -100 }, 1)[0];
    expect(Math.abs(c.x - d.x) % dotGap(1)).toBeCloseTo(100 % dotGap(1), 5);
  });

  it('thins out when zoomed far out, so it never turns into a haze', () => {
    expect(dotGap(1)).toBe(96);
    expect(dotGap(0.2) * 0.2).toBeGreaterThanOrEqual(34);
    expect(dots({ ...view, zoom: 0.1 }).length).toBeLessThan(2000);
  });
});

describe('regions', () => {
  const rect = (id: string, x: number, y: number, custom: any) => ({ id, type: 'rectangle', x, y, width: 100, height: 60, customData: custom });

  it('hulls a collection: header plus every card, each with room around it', () => {
    const els = [rect('cluster-0', 0, 0, { kind: 'cluster', index: 0 }), rect('f1', 400, 0, { kind: 'fragment', cluster: 0 }), rect('f2', 200, 300, { kind: 'fragment', cluster: 0 }), rect('cluster-1', 2000, 0, { kind: 'cluster', index: 1 })];
    const regions = regionsOf(els as any);
    expect(regions).toHaveLength(1);                      // a header with no cards gets no region
    expect(regions[0].rects).toHaveLength(3);
    const hull = convexHull(paddedCorners(regions[0].rects));
    expect(hull.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...hull.map(p => p.x))).toBeLessThan(0); expect(Math.max(...hull.map(p => p.x))).toBeGreaterThan(500);
  });

  it('leaves out deleted and other elements', () => {
    const els = [{ ...rect('f1', 0, 0, { kind: 'fragment', cluster: 0 }), isDeleted: true }, rect('x', 0, 0, { kind: 'image-card' })];
    expect(regionsOf(els as any)).toEqual([]);
  });

  it('builds a convex hull and a closed rounded outline through it', () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }, { x: 5, y: 2 }]);
    expect(hull).toHaveLength(4);
    const o = roundedOutline(hull)!;
    expect(o.curves).toHaveLength(4);
    expect(roundedOutline([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });

  it('tints each collection its own restrained hue', () => {
    expect(regionHue(0)).not.toBe(regionHue(1));
    expect(regionHue(8)).toBe(regionHue(0));
  });
});

describe('light under cards', () => {
  it('lifts toward its target and settles on it', () => {
    let l = 0;
    for (let i = 0; i < 60; i++) l = liftToward(l, 1, 16.7);
    expect(l).toBe(1);
    expect(liftToward(0, 1, 16.7)).toBeGreaterThan(0); expect(liftToward(0, 1, 16.7)).toBeLessThan(0.5);   // not a snap
    expect(liftToward(1, 0, 200)).toBeLessThan(0.1);                                                      // about a fifth of a second
  });

  it('glows more, wider and lower as a card lifts', () => {
    const a = cardGlow(0), b = cardGlow(1);
    expect(b.alpha).toBeGreaterThan(a.alpha); expect(b.blur).toBeGreaterThan(a.blur); expect(b.drop).toBeGreaterThan(a.drop);
    expect(a.alpha).toBeLessThan(0.06);           // at rest it is only a hint
  });

  it('lifts what is dragged most, then what is hovered, then what is selected', () => {
    expect(liftTarget({ hovered: true, dragging: true, selected: true })).toBe(1);
    expect(liftTarget({ hovered: true, dragging: false, selected: true })).toBeGreaterThan(liftTarget({ hovered: false, dragging: false, selected: true }));
    expect(liftTarget({ hovered: false, dragging: false, selected: false })).toBe(0);
  });
});
