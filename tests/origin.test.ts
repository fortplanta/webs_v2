import { describe, expect, it } from 'vitest';
import { lockOrigin, originCenter } from '../src/renderer/origin';

describe('origin', () => {
  const scene = [{ id: 'seed', x: -180, y: -75, width: 360, height: 150 }, { id: 'seed-label', type: 'text' }, { id: 'seed-sub' }, { id: 'frag-0-0' }] as any[];
  it('locks the origin card, its label and its through-line, and nothing else, once', () => {
    const out = lockOrigin(scene);
    expect(out.filter(e => e.locked).map(e => e.id)).toEqual(['seed', 'seed-label', 'seed-sub']);
    expect(lockOrigin(out)[0]).toBe(out[0]);
  });
  it('finds the origin centre', () => {
    expect(originCenter(scene)).toEqual({ x: 0, y: 0 });
    expect(originCenter([{ id: 'x' }] as any)).toBeNull();
  });
});
