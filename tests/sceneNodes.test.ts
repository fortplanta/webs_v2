import { describe, expect, it } from 'vitest';
import { applyMoves, buildNodes } from '../src/renderer/layout/sceneNodes';

const box = (id: string, x: number, y: number, extra: Record<string, any> = {}) => ({ id, type: 'rectangle', x, y, width: 100, height: 60, angle: 0, groupIds: [], version: 1, ...extra });
const label = (id: string, container: string) => ({ id, type: 'text', containerId: container, x: 10, y: 10, width: 50, height: 20, groupIds: [], version: 1 });
const arrow = (id: string, a: string, b: string, extra: Record<string, any> = {}) => ({ id, type: 'arrow', x: 100, y: 30, width: 100, height: 0, points: [[0, 0], [100, 0]], startBinding: { elementId: a }, endBinding: { elementId: b }, groupIds: [], version: 1, ...extra });

describe('buildNodes', () => {
  it('makes one node per box and folds bound labels into it', () => {
    const { nodes, members } = buildNodes([box('a', 0, 0), label('a-label', 'a'), box('b', 300, 0), arrow('e', 'a', 'b')]);
    expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
    expect(members.get('a')).toEqual(['a', 'a-label']);
  });
  it('treats a group as one node spanning its members', () => {
    const { nodes } = buildNodes([box('c', 0, 0, { groupIds: ['g'] }), box('i', 10, 10, { groupIds: ['g'], width: 200 })]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 'group:g', x: 0, y: 0, w: 210, h: 70 });
  });
  it('uses rotated bounds, skips deleted and arrow labels, carries locked/pinned', () => {
    const { nodes } = buildNodes([box('r', 0, 0, { angle: Math.PI / 2 }), box('gone', 5, 5, { isDeleted: true }), box('l', 400, 0, { locked: true }), box('a', 0, 300), box('b', 300, 300), arrow('e', 'a', 'b'), label('e-label', 'e')], new Set(['b']));
    const get = (id: string) => nodes.find(n => n.id === id)!;
    expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'l', 'r']);
    const r = get('r');
    expect([r.w, r.h, r.x, r.y].map(Math.round)).toEqual([60, 100, 20, -20]);
    expect(get('l').locked).toBe(true);
    expect(get('b').pinned).toBe(true);
  });
  it('reads tethers from flagged connectors only', () => {
    const els = [box('h', 0, 0), box('c', 300, 0), arrow('t', 'h', 'c', { customData: { kind: 'tether', max: 420 } }), arrow('plain', 'c', 'h')];
    expect(buildNodes(els).tethers).toEqual([{ anchor: 'h', child: 'c', max: 640 }]); // an older, shorter leash is raised to today's minimum
    const long = [els[0], els[1], arrow('t', 'h', 'c', { customData: { kind: 'tether', max: 900 } })];
    expect(buildNodes(long).tethers[0].max).toBe(900);
  });
});

describe('applyMoves', () => {
  it('moves members together and re-routes bound arrows', () => {
    const els = [box('a', 0, 0), label('a-label', 'a'), box('b', 300, 0), arrow('e', 'a', 'b')];
    const { members } = buildNodes(els);
    const out = applyMoves(els, new Map([['b', { dx: 0, dy: 200 }]]), members);
    expect(out.find(e => e.id === 'b')).toMatchObject({ y: 200, version: 2 });
    expect(out.find(e => e.id === 'a')).toBe(els[0]);
    const e = out.find(x => x.id === 'e')!;
    expect(e.points[1][1]).toBeGreaterThan(0); // now slopes down toward b
  });
  it('carries the bound end of a half-bound arrow', () => {
    const els = [box('a', 0, 0), { ...arrow('e', 'a', 'x'), endBinding: null }];
    const out = applyMoves(els, new Map([['a', { dx: 50, dy: 0 }]]), buildNodes(els).members);
    const e = out.find(x => x.id === 'e')!;
    expect(e.x).toBe(150);
    expect(e.points[1][0]).toBe(50); // far end stays put
  });
  it('is a no-op without moves', () => {
    const els = [box('a', 0, 0)];
    expect(applyMoves(els, new Map(), buildNodes(els).members)).toBe(els);
  });
});
