import { describe, it, expect } from 'vitest';
import { WebStore } from '../src/backend/db';
import { initialModel, reduce } from '../src/renderer/webModel';

function sampleModel(phase: 'running' | 'done' = 'done') {
  let m = initialModel('q');
  m = reduce(m, { type: 'overview', context: 'c', clusters: [{ title: 'A', slots: 2 }], edges: [] });
  m = reduce(m, { type: 'fragment', cluster: 0, slot: 0, fragment: { type: 'person', title: 't', body: 'b' } });
  return phase === 'done' ? reduce(m, { type: 'done' }) : m;
}

describe('WebStore', () => {
  it('round-trips a web and summarizes it', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'a', query: 'q', model: sampleModel(), scene: [{ id: 'x' }] }, 100);
    expect(s.get('a')).toMatchObject({ id: 'a', query: 'q', scene: [{ id: 'x' }], model: { phase: 'done' } });
    expect(s.list()).toEqual([{ id: 'a', query: 'q', updatedAt: 100, fragmentCount: 1 }]);
  });

  it('partial saves keep the fields they omit', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'a', query: 'q', model: sampleModel(), scene: [{ id: 'x' }] }, 1);
    s.save({ id: 'a', query: 'q', scene: [{ id: 'y' }] }, 2); // scene only
    s.save({ id: 'a', query: 'q', model: { ...sampleModel(), context: 'new' } }, 3); // model only
    const w = s.get('a')!;
    expect(w.scene).toEqual([{ id: 'y' }]);
    expect(w.model.context).toBe('new');
  });

  it('stores an interrupted run as cancelled, not running', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'a', query: 'q', model: sampleModel('running') });
    expect(s.get('a')!.model.phase).toBe('cancelled');
  });

  it('lists newest first, deletes, and returns null for unknown or model-less rows', () => {
    const s = new WebStore(':memory:');
    s.save({ id: 'old', query: 'o', model: sampleModel() }, 1);
    s.save({ id: 'new', query: 'n', model: sampleModel() }, 2);
    s.save({ id: 'scene-only', query: 's', scene: [] }, 3);
    expect(s.list().map(w => w.id)).toEqual(['new', 'old']); // model-less rows are hidden
    expect(s.get('scene-only')).toBeNull();
    s.delete('new');
    expect(s.get('new')).toBeNull();
    expect(s.get('nope')).toBeNull();
  });
});
