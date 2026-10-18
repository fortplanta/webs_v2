import { describe, expect, it } from 'vitest';
import { cutTargets, modeFor, segmentsCross } from '../src/renderer/gesture';
import { branchSpot, connectionSeed, growthFrom } from '../src/renderer/branch';
import { nextEnabled } from '../src/renderer/PopMenu';
import { placePivot } from '../src/renderer/pivot';

const arrow = (id: string, x: number, y: number, dx: number, dy: number, extra: Record<string, unknown> = {}) => ({ id, type: 'arrow', x, y, points: [[0, 0], [dx, dy]], ...extra }) as any;
const box = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x, y, width: 280, height: 150, ...extra }) as any;

describe('gesture modes', () => {
  it('starts a link/branch on a card or header, and a cut in empty space', () => {
    expect(modeFor('fragment', null)).toBe('link'); expect(modeFor('cluster', null)).toBe('link');
    expect(modeFor(null, null)).toBe('cut'); expect(modeFor('edge', null)).toBe('cut');
  });
  it('lets a held key choose: K always cuts, L only links from a card', () => {
    expect(modeFor('fragment', 'k')).toBe('cut'); expect(modeFor(null, 'k')).toBe('cut');
    expect(modeFor('fragment', 'l')).toBe('link'); expect(modeFor(null, 'l')).toBeNull();
  });
});

describe('cutting', () => {
  it('finds the crossing segments', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 0 }, { x: 5, y: 9 })).toBe(false);
  });
  it('cuts the lines a stroke crosses: tethers are unstuck, other lines removed, and the line from the origin is safe', () => {
    const els = [arrow('link-a', 0, 0, 100, 0), arrow('tether-0-0', 0, 20, 100, 0, { customData: { kind: 'tether' } }), arrow('origin-1', 0, 40, 100, 0), arrow('far', 0, 500, 100, 0), arrow('gone', 0, 60, 100, 0, { isDeleted: true })];
    const cuts = cutTargets(els, { x: 50, y: -10 }, { x: 50, y: 70 });
    expect(cuts).toEqual([{ id: 'link-a', kind: 'link' }, { id: 'tether-0-0', kind: 'tether' }]);
  });
});

describe('growing from a connection', () => {
  const label = (arrowId: string, text: string) => ({ id: `${arrowId}-label`, type: 'text', containerId: arrowId, text }) as any;
  const els = [
    box('seed', -140, -75, { width: 280, height: 150 }), box('cluster-0', 800, -24, { height: 48, customData: { kind: 'cluster', title: 'Cultural symbolism' } }),
    box('frag-0-0', 1300, -80, { customData: { kind: 'fragment', fragment: { type: 'concept', title: 'secular symbolism', body: 'Stained glass in homes and shops.' } } }),
    { ...arrow('origin-0', 140, 0, 660, 0, { startBinding: { elementId: 'seed' }, endBinding: { elementId: 'cluster-0' } }) }, label('origin-0', 'reflected the values of'),
    { ...arrow('tether-0-0', 1080, 0, 220, 0, { customData: { kind: 'tether' }, startBinding: { elementId: 'cluster-0' }, endBinding: { elementId: 'frag-0-0' } }) },
  ];
  it('seeds a pivot with both ends and the label, growing on past the target', () => {
    const s = connectionSeed(els, 'origin-0', 'history of stained glass', 'It spread.')!;
    expect(s.target.id).toBe('cluster-0');
    expect(s.card.title).toBe('history of stained glass · reflected the values of · Cultural symbolism');
    expect(s.card.body).toContain('It spread.');
    expect(connectionSeed(els, 'nope', 'q', '')).toBeNull();
  });
  it('grows away from what a card hangs off, else from the origin', () => {
    expect(growthFrom(els, 'frag-0-0')).toEqual({ x: 800 + 140, y: 0 });
    expect(growthFrom(els, 'cluster-0')).toEqual({ x: 0, y: 0 });
  });
  it('puts a new branch on past the source, clear of everything', () => {
    const spot = branchSpot(els, 'frag-0-0', 290, 200)!;
    expect(spot.x).toBeGreaterThan(1300 + 280);
    for (const e of els.filter(e => e.type === 'rectangle')) {
      const hit = spot.x < e.x + e.width && e.x < spot.x + 290 && spot.y < e.y + e.height && e.y < spot.y + 200;
      expect(hit).toBe(false);
    }
    expect(branchSpot(els, 'missing', 290, 200)).toBeNull();
  });
  it('places a dropped pivot header exactly where it was dropped, fanning away from the source', () => {
    const pos = placePivot(els, 'frag-0-0', 3, { x: 1900, y: 400 })!;
    expect(pos.x + 140).toBe(1900); expect(pos.y + 24).toBe(400);
    expect(pos.angle).toBeGreaterThan(0); expect(pos.angle).toBeLessThan(90);
  });
});

describe('menu keyboard', () => {
  it('moves to the next enabled item and wraps', () => {
    const items = [{ disabled: false }, { disabled: true }, { disabled: false }];
    expect(nextEnabled(items, 0, 1)).toBe(2); expect(nextEnabled(items, 2, 1)).toBe(0);
    expect(nextEnabled(items, 0, -1)).toBe(2); expect(nextEnabled([{ disabled: true }], -1, 1)).toBe(-1);
  });
});
