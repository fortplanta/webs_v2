import { describe, it, expect } from 'vitest';
import { countOverlaps, defaultEngineConfig, settle, step, type EngineConfig, type LayoutNode, type Tether } from '../src/renderer/layout/engine';

const n = (id: string, x: number, y: number, w = 100, h = 60, extra: Partial<LayoutNode> = {}): LayoutNode => ({ id, x, y, w, h, ...extra });
const firm: EngineConfig = { ...defaultEngineConfig, gain: 1, maxStep: 1e9 }; // full correction, for exact assertions
const byId = (nodes: LayoutNode[], id: string) => nodes.find(x => x.id === id)!;
const centerDist = (a: LayoutNode, b: LayoutNode) => Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));

// small deterministic PRNG so "random" layouts are reproducible
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

describe('collisions', () => {
  it('does nothing when nodes are clear of each other (a settled layout stays still)', () => {
    const nodes = [n('a', 0, 0), n('b', 200, 0), n('c', 0, 200)];
    const r = step(nodes, []);
    expect(r.moves.size).toBe(0);
    expect(r.maxMove).toBe(0);
    expect(r.overlaps).toBe(0);
  });

  it('pushes two overlapping equal nodes apart symmetrically, leaving at least the gap', () => {
    const out = settle([n('a', 0, 0), n('b', 60, 10)], [], firm);
    const a = byId(out.nodes, 'a'), b = byId(out.nodes, 'b');
    expect(out.overlaps).toBe(0);
    expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(defaultEngineConfig.gap - 0.5); // pushed along x (the smaller overlap)
    // symmetric: the pair's midpoint hasn't moved
    expect((a.x + b.x) / 2 - 30).toBeCloseTo(0, 0);
  });

  it('never moves a pinned node; the other one gives way entirely', () => {
    const out = settle([n('drag', 0, 0, 100, 60, { pinned: true }), n('b', 60, 10)], [], firm);
    expect(byId(out.nodes, 'drag')).toMatchObject({ x: 0, y: 0 });
    expect(out.overlaps).toBe(0);
  });

  it('treats a locked node as an obstacle that others route around', () => {
    const out = settle([n('wall', 0, 0, 100, 60, { locked: true }), n('b', 20, 10)], [], firm);
    expect(byId(out.nodes, 'wall')).toMatchObject({ x: 0, y: 0 });
    expect(out.overlaps).toBe(0);
    expect(step([n('p', 0, 0, 100, 60, { pinned: true }), n('l', 20, 10, 100, 60, { locked: true })], []).moves.size).toBe(0); // both immovable: nothing to do
  });

  it('lets a node sit entirely inside another (a zone drawn around cards is not a collision)', () => {
    const zone = n('zone', 0, 0, 600, 400), card = n('card', 100, 100, 200, 100);
    expect(step([zone, card], []).moves.size).toBe(0);
    expect(countOverlaps([zone, card], 28)).toBe(0);
    // but partly overlapping the zone's edge is a collision
    expect(countOverlaps([zone, n('edge', 550, 100, 200, 100)], 28)).toBe(1);
    expect(countOverlaps([n('p', 0, 0), n('q', 100 + 28 - 1, 0)], 28)).toBe(0); // within slop of exactly the gap: not an overlap
  });

  it('propagates: dragging a node into a row pushes the row along without leaving overlaps', () => {
    const row = ['r1', 'r2', 'r3', 'r4'].map((id, i) => n(id, i * 130, 0)); // 30px apart: tight but legal at gap 28
    const out = settle([n('drag', 40, 5, 100, 60, { pinned: true }), ...row], [], firm);
    expect(out.overlaps).toBe(0);
    expect(byId(out.nodes, 'drag')).toMatchObject({ x: 40, y: 5 });
  });

  it('is deterministic', () => {
    const nodes = [n('a', 0, 0), n('b', 50, 20), n('c', 90, 10), n('d', 20, 80)];
    const pos = (list: LayoutNode[]) => JSON.stringify(settle(list, [], firm).nodes.map(x => [x.id, x.x, x.y]).sort());
    expect(pos(nodes)).toBe(pos(nodes)); // same input → same output
    expect(pos(nodes)).toBe(pos([...nodes].reverse())); // and the order nodes are listed in doesn't matter
  });

  it('coincident nodes separate (no NaN, deterministic direction)', () => {
    const out = settle([n('a', 10, 10), n('b', 10, 10)], [], firm);
    expect(out.overlaps).toBe(0);
    for (const x of out.nodes) { expect(Number.isFinite(x.x) && Number.isFinite(x.y)).toBe(true); }
  });
});

describe('softness', () => {
  it('moves only a fraction per step and glides to rest', () => {
    const start = [n('a', 0, 0), n('b', 60, 10)];
    const full = step(start, [], firm).moves.get('b')!.dx;
    const soft = step(start, [], defaultEngineConfig).moves.get('b')!.dx;
    expect(soft).toBeGreaterThan(0);
    expect(soft).toBeLessThan(full); // gentler than the full correction

    // successive steps shrink geometrically (an ease-out), never overshooting
    let nodes = start.map(x => ({ ...x }));
    let last = Infinity;
    for (let i = 0; i < 12; i++) {
      const r = step(nodes, [], defaultEngineConfig);
      if (r.maxMove === 0) break;
      expect(r.maxMove).toBeLessThanOrEqual(last + 1e-9);
      last = r.maxMove;
      nodes = nodes.map(x => { const m = r.moves.get(x.id); return m ? { ...x, x: x.x + m.dx, y: x.y + m.dy } : x; });
    }
    expect(countOverlaps(nodes, defaultEngineConfig.gap)).toBeLessThan(2);
  });

  it('caps how far a node moves in one step', () => {
    const r = step([n('a', 0, 0, 100, 60, { pinned: true }), n('b', 10, 10)], [], { ...defaultEngineConfig, gain: 1, maxStep: 5 });
    expect(r.maxMove).toBeLessThanOrEqual(5 + 1e-9);
  });

  it('a settled layout reports no movement at all', () => {
    const out = settle([n('a', 0, 0), n('b', 70, 10), n('c', 30, 90)], []);
    expect(step(out.nodes, []).maxMove).toBe(0);
  });
});

describe('stress', () => {
  it('resolves a dense random pile into a non-overlapping layout without exploding', () => {
    const rand = rng(7);
    const nodes = Array.from({ length: 40 }, (_, i) => n(`n${i}`, rand() * 500, rand() * 400, 120 + rand() * 120, 60 + rand() * 80));
    const out = settle(nodes, [], defaultEngineConfig, 1500);
    expect(out.overlaps).toBe(0);
    expect(out.steps).toBeLessThan(1500);
    const spread = Math.max(...out.nodes.map(x => Math.hypot(x.x, x.y)));
    expect(spread).toBeLessThan(5000); // spread out, not flung to infinity
    for (const x of out.nodes) expect(Number.isFinite(x.x) && Number.isFinite(x.y)).toBe(true);
  });

  it('keeps a pinned node fixed through a whole pile-up', () => {
    const rand = rng(3);
    const nodes = [n('drag', 200, 150, 140, 90, { pinned: true }), ...Array.from({ length: 25 }, (_, i) => n(`n${i}`, rand() * 450, rand() * 350, 100 + rand() * 100, 60 + rand() * 60))];
    const out = settle(nodes, [], defaultEngineConfig, 1500);
    expect(byId(out.nodes, 'drag')).toMatchObject({ x: 200, y: 150 });
    expect(out.overlaps).toBe(0);
  });

  it('is fast enough for interactive use at a few hundred nodes', () => {
    const rand = rng(11);
    const nodes = Array.from({ length: 250 }, (_, i) => n(`n${i}`, rand() * 3000, rand() * 2000, 140, 90));
    const t = performance.now();
    for (let i = 0; i < 5; i++) step(nodes, []);
    expect((performance.now() - t) / 5).toBeLessThan(60); // ms per step
  });
});

describe('tethers', () => {
  const T = (anchor: string, child: string, max: number): Tether => ({ anchor, child, max });

  it('leaves a child alone while it is within range', () => {
    expect(step([n('a', 0, 0), n('c', 300, 0)], [T('a', 'c', 500)]).moves.size).toBe(0);
  });

  it('pulls a child that has strayed back within its limit, mostly moving the child, not the anchor', () => {
    const out = settle([n('a', 0, 0), n('c', 1200, 0)], [T('a', 'c', 400)], firm);
    const a = byId(out.nodes, 'a'), c = byId(out.nodes, 'c');
    expect(centerDist(a, c)).toBeLessThanOrEqual(400 + 1);
    expect(Math.abs(a.x)).toBeLessThan(Math.abs(c.x - 1200)); // the anchor moved less than the child
  });

  it('drags the card along when the anchor is pulled away (anchor pinned)', () => {
    const start = [n('a', 0, 0, 100, 60, { pinned: true }), n('c', 200, 0)];
    const dragged = start.map(x => (x.id === 'a' ? { ...x, x: 900 } : x));
    const out = settle(dragged, [T('a', 'c', 300)], firm);
    expect(byId(out.nodes, 'a').x).toBe(900);
    expect(centerDist(byId(out.nodes, 'a'), byId(out.nodes, 'c'))).toBeLessThanOrEqual(301);
  });

  it('holds back a card you drag too far (a pinned child is clamped like a rubber band)', () => {
    const out = settle([n('a', 0, 0), n('c', 2000, 0, 100, 60, { pinned: true })], [T('a', 'c', 400)], firm);
    expect(centerDist(byId(out.nodes, 'a'), byId(out.nodes, 'c'))).toBeLessThanOrEqual(401);
  });

  it('pulls back softly: gradually over steps, not in one jump', () => {
    const start = [n('a', 0, 0), n('c', 1200, 0)];
    const r1 = step(start, [T('a', 'c', 400)], defaultEngineConfig);
    const full = step(start, [T('a', 'c', 400)], firm);
    expect(Math.abs(r1.moves.get('c')!.dx)).toBeLessThan(Math.abs(full.moves.get('c')!.dx));
  });

  it('anchors yield less than their cards when pushed', () => {
    const tethers = ['c1', 'c2', 'c3', 'c4'].map(c => T('hub', c, 600));
    const nodes = [n('hub', 0, 0), n('c1', 450, 0), n('c2', 450, 100), n('c3', 450, 200), n('c4', 450, 300), n('intruder', 20, 10)];
    const r = step(nodes, tethers, firm);
    // hub and intruder overlap; the lightly-weighted intruder moves more than the heavy hub
    expect(Math.hypot(r.moves.get('intruder')!.dx, r.moves.get('intruder')!.dy)).toBeGreaterThan(Math.hypot(r.moves.get('hub')?.dx ?? 0, r.moves.get('hub')?.dy ?? 0));
  });

  it('a cluster of cards around an anchor ends up non-overlapping and within range', () => {
    const cards = Array.from({ length: 6 }, (_, i) => n(`c${i}`, 60 + i * 5, 40 + i * 5, 120, 80)); // all piled near the anchor
    const out = settle([n('hub', 100, 100, 160, 50), ...cards], cards.map(c => T('hub', c.id, 480)), defaultEngineConfig, 1500);
    expect(out.overlaps).toBe(0);
    for (const c of cards) expect(centerDist(byId(out.nodes, 'hub'), byId(out.nodes, c.id))).toBeLessThanOrEqual(480 + 1);
  });

  it('ignores tethers that refer to missing nodes or to a node itself', () => {
    expect(step([n('a', 0, 0)], [T('a', 'ghost', 10), T('ghost', 'a', 10), T('a', 'a', 1)]).moves.size).toBe(0);
  });

  it('a locked anchor is not pulled; the child is', () => {
    const out = settle([n('a', 0, 0, 100, 60, { locked: true }), n('c', 1500, 0)], [T('a', 'c', 400)], firm);
    expect(byId(out.nodes, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(centerDist(byId(out.nodes, 'a'), byId(out.nodes, 'c'))).toBeLessThanOrEqual(401);
  });
});
