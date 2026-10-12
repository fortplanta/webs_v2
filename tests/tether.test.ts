import { describe, expect, it } from 'vitest';
import { buildNodes } from '../src/renderer/layout/sceneNodes';
import { addTether, MIN_TETHER, removeTether, tetherLimit, tetherOf } from '../src/renderer/tether';

const box = (id: string, x: number, y: number) => ({ id, type: 'rectangle', x, y, width: 280, height: 192, groupIds: [], version: 1, boundElements: null as any });
const make = (raw: any) => ({ version: 1, groupIds: [], ...raw });

describe('tethers', () => {
  const scene = () => [box('h', 0, 0), box('c', 500, 0), box('d', 0, 700)];

  it('binds a flagged connector anchor → card that the layout reads back', () => {
    const out = addTether(scene(), 'h', 'c', make);
    const t = tetherOf(out, 'c')!;
    expect(t.startBinding.elementId).toBe('h');
    expect(t.customData).toMatchObject({ kind: 'tether' });
    expect(buildNodes(out).tethers).toEqual([{ anchor: 'h', child: 'c', max: t.customData.max }]);
    expect(out.find(e => e.id === 'h')!.boundElements).toContainEqual({ type: 'arrow', id: t.id });
  });

  it('allows some give but never less than the minimum', () => {
    expect(tetherLimit(box('a', 0, 0), box('b', 500, 0))).toBe(600);
    expect(tetherLimit(box('a', 0, 0), box('b', 10, 10))).toBe(MIN_TETHER);
  });

  it('gives a card one anchor: sticking again replaces the first', () => {
    let out = addTether(scene(), 'h', 'c', make);
    out = addTether(out, 'd', 'c', make);
    expect(buildNodes(out).tethers.map(t => t.anchor)).toEqual(['d']);
  });

  it('refuses self-tethers, loops and missing elements', () => {
    const s = scene();
    expect(addTether(s, 'h', 'h', make)).toBe(s);
    expect(addTether(s, 'h', 'nope', make)).toBe(s);
    const one = addTether(s, 'h', 'c', make);
    expect(addTether(one, 'c', 'h', make)).toBe(one);
  });

  it('unsticks, clearing the bound references', () => {
    const out = removeTether(addTether(scene(), 'h', 'c', make), 'c');
    expect(tetherOf(out, 'c')).toBeUndefined();
    expect(buildNodes(out).tethers).toEqual([]);
    expect(out.find(e => e.id === 'c')!.boundElements).toEqual([]);
    expect(addTether(out, 'h', 'c', make)).toHaveLength(4); // can stick again
  });
});
