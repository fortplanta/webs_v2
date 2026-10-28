import { describe, expect, it } from 'vitest';
import { DIM_ALPHA, focusSet, MAX_FOCUS } from '../src/renderer/focus';

const card = (id: string, kind = 'fragment', extra: any = {}): any => ({ id, type: 'rectangle', x: 0, y: 0, width: 100, height: 60, customData: { kind }, ...extra });
const line = (id: string, a: string, b: string): any => ({ id, type: 'arrow', startBinding: { elementId: a }, endBinding: { elementId: b } });

const scene = [
  card('cluster-0', 'cluster'), card('f1'), card('f2'), card('f3'), card('other'),
  line('t1', 'cluster-0', 'f1'), line('t2', 'cluster-0', 'f2'), line('t3', 'cluster-0', 'f3'), line('rel', 'f1', 'other'),
  { id: 'f1-title', type: 'text', customData: { card: 'f1' } }, { id: 'f1-label', type: 'text', containerId: 'f1' },
];

describe('focus', () => {
  it('lights the selected card and the cards tied to it, and nothing else', () => {
    expect([...focusSet(scene, new Set(['f1']))!].sort()).toEqual(['cluster-0', 'f1', 'other']);
    expect([...focusSet(scene, new Set(['f2']))!].sort()).toEqual(['cluster-0', 'f2']);
  });

  it('lights a collection with its cards when its header is selected', () => {
    expect([...focusSet(scene, new Set(['cluster-0']))!].sort()).toEqual(['cluster-0', 'f1', 'f2', 'f3']);
  });

  it('treats a selected title, label or footer as its card', () => {
    expect(focusSet(scene, new Set(['f1', 'f1-title', 'f1-label']))!.has('f1')).toBe(true);
    expect(focusSet(scene, new Set(['f1-title']))!.has('f1')).toBe(true);
  });

  it('does nothing without a selection, for a selection that is not all cards, or a crowd', () => {
    expect(focusSet(scene, new Set())).toBeNull();
    expect(focusSet(scene, new Set(['f1', 't1']))).toBeNull();                     // a line is selected too
    expect(focusSet(scene, new Set(['f1', 'f2', 'f3', 'other']))).toBeNull();      // more than MAX_FOCUS cards
    expect(MAX_FOCUS).toBeGreaterThanOrEqual(2);
    expect(focusSet(scene, new Set(['nope']))).toBeNull();
    expect(DIM_ALPHA).toBeLessThan(0.7);                                           // it recedes, it does not black out
  });

  it('ignores deleted elements', () => {
    const gone = scene.map(e => (e.id === 'rel' ? { ...e, isDeleted: true } : e));
    expect([...focusSet(gone, new Set(['f1']))!].sort()).toEqual(['cluster-0', 'f1']);
  });
});
