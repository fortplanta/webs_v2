import { describe, it, expect, vi } from 'vitest';

vi.mock('@excalidraw/excalidraw', () => ({ convertToExcalidrawElements: (x: unknown) => x }));

import { initialModel, reduce, progress } from '../src/renderer/webModel';
import { mergeScene, signature } from '../src/renderer/sceneMerge';

describe('webModel reducer', () => {
  it('builds ghost slots from overview, fills them from fragment events, tracks progress', () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: 'c', clusters: [{ title: 'A', slots: 2 }], edges: [] });
    expect(progress(m)).toEqual({ filled: 0, total: 2 });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 1, fragment: { type: 'person', title: 't', body: 'b' } });
    expect(progress(m)).toEqual({ filled: 1, total: 2 });
    expect(m.clusters[0].slots[0]).toBeNull();
    expect(reduce(m, { type: 'done' }).phase).toBe('done');
  });
});

describe('mergeScene', () => {
  const rect = (id: string, x: number, bg: string) => ({ id, type: 'rectangle', x, y: 0, width: 10, height: 10, backgroundColor: bg });

  it('keeps user-moved elements whose content did not change', () => {
    const gen = rect('frag-0-0', 0, 'red');
    const applied = new Map([['frag-0-0', signature(gen)]]);
    const moved = { ...gen, x: 500 };
    const { elements } = mergeScene([moved], [gen], applied);
    expect(elements[0].x).toBe(500);
  });

  it('applies new content but keeps the user position (and moves the label with it)', () => {
    const ghost = rect('frag-0-0', 0, 'grey');
    const applied = new Map([['frag-0-0', signature(ghost)]]);
    const moved = { ...ghost, x: 500, y: 40 };
    const filled = rect('frag-0-0', 0, 'red');
    const label = { id: 'frag-0-0-label', type: 'text', containerId: 'frag-0-0', x: 5, y: 5, text: 'hi', width: 1, height: 1 };
    const { elements } = mergeScene([moved], [filled, label], applied);
    expect(elements.find(e => e.id === 'frag-0-0')).toMatchObject({ x: 500, y: 40, backgroundColor: 'red' });
    expect(elements.find(e => e.id === 'frag-0-0-label')).toMatchObject({ x: 505, y: 45 });
  });

  it('preserves user-drawn elements', () => {
    const mine = { id: 'abc', type: 'ellipse', x: 1, y: 1 };
    expect(mergeScene([mine], [], new Map()).elements).toContain(mine);
  });
});
