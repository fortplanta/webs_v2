import { describe, it, expect } from 'vitest';
import { addBox, arrowCenterBox, findFreeSpot, hydrateScene, relight, removeBox, updateBox, type El } from '../src/renderer/sceneEdit';
import { hitTest } from '../src/renderer/hit';
import { clusterLabel, fragmentLook } from '../src/renderer/boxes';
import { WebStore } from '../src/backend/db';
import { initialModel, reduce } from '../src/renderer/webModel';

// Stand-in for Excalidraw's converter: a box plus a bound text element.
const build = (skeletons: unknown[]): El[] =>
  (skeletons as El[]).flatMap(s => {
    const { label, ...box } = s;
    const out: El[] = [{ version: 1, ...box, boundElements: label ? [{ type: 'text', id: `${s.id}-t` }] : null }];
    if (label) out.push({ type: 'text', id: `${s.id}-t`, containerId: s.id, text: label.text, x: s.x + 5, y: s.y + 5, width: 10, height: 10, version: 1 });
    return out;
  });

const frag = { type: 'person' as const, title: 'old', body: 'old body' };
const rect = (id: string, extra: El = {}): El => ({ id, type: 'rectangle', x: 0, y: 0, width: 280, height: 150, version: 1, ...extra });
const label = (id: string, text: string): El => ({ id: `${id}-label`, type: 'text', containerId: id, text, x: 5, y: 5, width: 10, height: 10, version: 1 });

describe('updateBox', () => {
  const base = [rect('f', { customData: { kind: 'fragment', fragment: frag }, boundElements: [{ type: 'text', id: 'f-label' }, { type: 'arrow', id: 'a' }] }), label('f', 'PERSON old')];

  it('re-renders the label, recolors, stores data, bumps versions and keeps arrow bindings', () => {
    const next = { ...frag, type: 'event' as const, title: 'new' };
    const look = fragmentLook(next);
    const out = updateBox(base, 'f', { backgroundColor: '#abc', customData: { kind: 'fragment', fragment: next }, label: look.label }, build);
    const box = out.find(e => e.id === 'f')!;
    expect(box).toMatchObject({ backgroundColor: '#abc', customData: { fragment: { title: 'new' } }, version: 2 });
    expect(box.boundElements).toEqual(expect.arrayContaining([{ type: 'arrow', id: 'a' }, { type: 'text', id: 'f-label' }]));
    expect(out.filter(e => e.type === 'text')).toHaveLength(1);
    expect(out.find(e => e.id === 'f-label')).toMatchObject({ containerId: 'f', version: 2 });
    expect(out.find(e => e.id === 'f-label')!.text).toContain('EVENT');
  });

  it('adds a label to an unlabeled box and removes one on null', () => {
    const bare = [rect('g')];
    const withLabel = updateBox(bare, 'g', { label: clusterLabel('Hi') }, build);
    expect(withLabel.find(e => e.id === 'g-label')).toMatchObject({ containerId: 'g', text: 'Hi' });
    expect(withLabel.find(e => e.id === 'g')!.boundElements).toEqual([{ type: 'text', id: 'g-label' }]);
    const cleared = updateBox(withLabel, 'g', { label: null }, build);
    expect(cleared.find(e => e.id === 'g-label')!.isDeleted).toBe(true);
    expect(cleared.find(e => e.id === 'g')!.boundElements).toBeNull();
  });

  it('reuses the id of a natively-created arrow label instead of duplicating it', () => {
    const arrow: El = { id: 'a', type: 'arrow', x: 0, y: 0, width: 100, height: 0, points: [[0, 0], [100, 0]], boundElements: [{ type: 'text', id: 'native' }], version: 1 };
    const native: El = { id: 'native', type: 'text', containerId: 'a', text: 'old', version: 1 };
    const out = updateBox([arrow, native], 'a', { label: { text: 'led to', fontSize: 14, strokeColor: '#000', fontFamily: 2 }, geometry: arrowCenterBox(arrow) }, build);
    expect(out.filter(e => e.type === 'text' && !e.isDeleted).map(e => e.id)).toEqual(['native']);
    expect(out.find(e => e.id === 'native')!.text).toBe('led to');
  });

  it('is a no-op for unknown or deleted ids', () => {
    expect(updateBox(base, 'zzz', { backgroundColor: 'x' }, build)).toBe(base);
  });
});

describe('addBox / removeBox', () => {
  it('adds a box carrying its data and a stable label id', () => {
    const look = fragmentLook(frag);
    const out = addBox([], { id: 'm-1', x: 10, y: 20, width: 280, height: 150, backgroundColor: look.backgroundColor, label: look.label, customData: { kind: 'fragment', fragment: frag } }, build);
    expect(out.find(e => e.id === 'm-1')).toMatchObject({ x: 10, y: 20, customData: { kind: 'fragment' } });
    expect(out.find(e => e.id === 'm-1-label')).toMatchObject({ containerId: 'm-1' });
  });

  it('soft-deletes a box and label, unbinds arrows, and cleans bound-element refs', () => {
    const scene = [
      rect('f', { boundElements: [{ type: 'text', id: 'f-label' }, { type: 'arrow', id: 'a' }] }), label('f', 't'),
      { id: 'a', type: 'arrow', x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: 'f' }, endBinding: { elementId: 'other' }, version: 1 },
      rect('other', { boundElements: [{ type: 'arrow', id: 'a' }] }),
    ];
    const out = removeBox(scene, 'f');
    expect(out.filter(e => e.isDeleted).map(e => e.id).sort()).toEqual(['f', 'f-label']);
    const arrow = out.find(e => e.id === 'a')!;
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toEqual({ elementId: 'other' });

    const delArrow = removeBox(scene, 'a');
    expect(delArrow.find(e => e.id === 'a')!.isDeleted).toBe(true);
    expect(delArrow.find(e => e.id === 'other')!.boundElements).toEqual([]);
  });
});

describe('hitTest', () => {
  const els: El[] = [
    rect('frag', { x: 0, y: 100, customData: { kind: 'fragment' } }),
    rect('head', { x: 400, y: 0, height: 48, customData: { kind: 'cluster' } }),
    rect('free', { x: 800, y: 0 }), // user-drawn: no customData
    { id: 'arrow', type: 'arrow', x: 300, y: 24, points: [[0, 0], [100, 0]], version: 1 },
    { ...label('arrow', 'led to'), x: 330, y: 10, width: 40, height: 20 },
  ];
  it('finds fragments, clusters and arrows (line and label), and ignores everything else', () => {
    expect(hitTest(els, 50, 150, 1)).toEqual({ id: 'frag', kind: 'fragment' });
    expect(hitTest(els, 450, 20, 1)).toEqual({ id: 'head', kind: 'cluster' });
    expect(hitTest(els, 350, 28, 1)).toEqual({ id: 'arrow', kind: 'edge' });
    expect(hitTest(els, 350, 15, 1)).toEqual({ id: 'arrow', kind: 'edge' }); // on the label
    expect(hitTest(els, 850, 20, 1)).toBeNull(); // user-drawn shape
    expect(hitTest(els, 350, 80, 1)).toBeNull(); // empty space
  });
  it('widens the arrow target as you zoom out and skips deleted elements', () => {
    expect(hitTest(els, 350, 40, 1)).toBeNull();
    expect(hitTest(els, 350, 40, 0.4)).toEqual({ id: 'arrow', kind: 'edge' });
    expect(hitTest([{ ...els[0], isDeleted: true }], 50, 150, 1)).toBeNull();
  });
});

describe('hydrateScene', () => {
  it('backfills structured data on older saved scenes without touching newer ones', () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: 'c', clusters: [{ title: 'A', slots: 2 }], edges: [] });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 0, fragment: frag });
    const scene = [rect('cluster-0'), rect('frag-0-0'), rect('frag-0-1'), rect('frag-0-0b'), rect('cluster-0x', { customData: { kind: 'cluster', title: 'keep' } })];
    const out = hydrateScene(scene, m);
    expect(out[0].customData).toEqual({ kind: 'cluster', index: 0, title: 'A' });
    expect(out[1].customData).toMatchObject({ kind: 'fragment', cluster: 0, slot: 0, fragment: { title: 'old' } });
    expect(out[2].customData).toBeUndefined(); // empty slot: nothing to edit
    expect(out[4].customData.title).toBe('keep');
  });
});

describe('library fragment count follows manual edits', () => {
  const doneModel = () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: 'c', clusters: [{ title: 'A', slots: 2 }], edges: [] });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 0, fragment: frag });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 1, fragment: frag });
    return reduce(m, { type: 'done' });
  };
  const f = (id: string, deleted = false) => ({ id, customData: { kind: 'fragment' }, isDeleted: deleted });

  it('counts from the model until the scene carries box data, then from the scene', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'a', query: 'q', model: doneModel() });
    expect(s.list()[0].fragmentCount).toBe(2);
    s.save({ id: 'a', query: 'q', scene: [f('1'), f('2'), f('3'), f('4', true)] }); // one added, one deleted
    expect(s.list()[0].fragmentCount).toBe(3);
    s.save({ id: 'a', query: 'q', model: doneModel() }); // a later model save must not reset it
    expect(s.list()[0].fragmentCount).toBe(3);
    s.save({ id: 'a', query: 'q', scene: [{ id: 'cluster', customData: { kind: 'cluster' } }, f('1', true)] });
    expect(s.list()[0].fragmentCount).toBe(0);
  });

  it('ignores scenes with no box data (legacy / user-drawn only)', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'a', query: 'q', model: doneModel(), scene: [{ id: 'x' }] });
    expect(s.list()[0].fragmentCount).toBe(2);
  });
});

describe('findFreeSpot', () => {
  const boxes = [rect('a', { x: 0, y: 0 }), rect('b', { x: 400, y: 0 }), rect('gone', { x: 48, y: 48, isDeleted: true })];
  it('keeps a clear position, nudges off an occupied one, ignores deleted boxes, and gives up gracefully', () => {
    expect(findFreeSpot(boxes, { x: 1000, y: 0 }, 280, 150)).toEqual({ x: 1000, y: 0 });
    const moved = findFreeSpot(boxes, { x: 100, y: 20 }, 280, 150);
    expect(moved).not.toEqual({ x: 100, y: 20 });
    expect(boxes.filter(b => !b.isDeleted).every(b => moved.x + 280 <= b.x || b.x + b.width <= moved.x || moved.y + 150 <= b.y || b.y + b.height <= moved.y)).toBe(true);
    const wall = [rect('w', { x: -9999, y: -9999, width: 99999, height: 99999 })];
    expect(findFreeSpot(wall, { x: 5, y: 5 }, 280, 150)).toEqual({ x: 5, y: 5 });
  });
});

describe('relight (old dark ink on the new black canvas)', () => {
  const ink = '#1a1a1a';
  it('recolours legacy lines, headers and their labels; leaves everything else alone', () => {
    const scene: El[] = [
      { id: 'e', type: 'arrow', strokeColor: ink },
      { id: 'e-label', type: 'text', containerId: 'e', strokeColor: ink },
      { id: 'h', type: 'rectangle', strokeColor: ink, customData: { kind: 'cluster' } },
      { id: 'h-label', type: 'text', containerId: 'h', strokeColor: ink },
      { id: 'card', type: 'rectangle', strokeColor: 'transparent', customData: { kind: 'fragment' } },
      { id: 'mine', type: 'arrow', strokeColor: '#ff0000' },
      { id: 'gone', type: 'arrow', strokeColor: ink, isDeleted: true },
    ];
    const out = relight(scene);
    const col = (id: string) => out.find(e => e.id === id)!.strokeColor;
    for (const id of ['e', 'e-label', 'h', 'h-label']) expect(col(id)).not.toBe(ink);
    expect(col('e')).toBe('#6B6B6B');            // token fallbacks outside a browser
    expect(col('card')).toBe('transparent');
    expect(col('mine')).toBe('#ff0000');
    expect(col('gone')).toBe(ink);
    expect(relight(out)).toEqual(out);          // idempotent
  });
});
