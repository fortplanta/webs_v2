import { describe, expect, it } from 'vitest';
import { grownFan, grownHeaders, grownKbRing } from '../src/renderer/layout/grown';
import { noise } from '../src/renderer/layout/noise';
import { fanCenters } from '../src/renderer/layout/organic';
import { settle } from '../src/renderer/layout/engine';
import { FRAG_H, FRAG_W, HEADER_H } from '../src/renderer/boxes';
import { buildSkeletons, clusterTies } from '../src/renderer/layout';
import { initialModel, reduce } from '../src/renderer/webModel';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('noise', () => {
  it('is steady for a key, differs between keys and salts, and stays in [-1, 1]', () => {
    expect(noise('a')).toBe(noise('a'));
    expect(noise('a')).not.toBe(noise('b'));
    expect(noise('a', 'x')).not.toBe(noise('a', 'y'));
    const vals = Array.from({ length: 500 }, (_, i) => noise(`k${i}`));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(-1); expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(vals.reduce((s, v) => s + v, 0) / vals.length).toBeCloseTo(0, 0);       // not lopsided
    expect(new Set(vals.map(v => v.toFixed(7))).size).toBe(500);        // and genuinely varied
  });
});

describe('grown layout', () => {
  const sizes = (...k: number[]) => k.map(size => ({ size }));

  it('is deterministic, surrounds the topic, and keeps collections well apart', () => {
    expect(grownHeaders(sizes(3, 3, 3, 3))).toEqual(grownHeaders(sizes(3, 3, 3, 3)));
    for (const n of [1, 2, 3, 4, 6, 8, 10]) {
      const hs = grownHeaders(sizes(...Array(n).fill(3)));
      expect(hs).toHaveLength(n);
      for (const h of hs) expect(Math.hypot(h.x, h.y)).toBeGreaterThan(600);              // never crowding the topic
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(dist(hs[i], hs[j])).toBeGreaterThan(700);
    }
    expect(grownHeaders([])).toEqual([]);
  });

  it('is not a perfect ring: collections sit at different distances from the topic', () => {
    const radii = grownHeaders(sizes(3, 3, 3, 3, 3, 3)).map(h => Math.hypot(h.x, h.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(60);
  });

  it('gives bigger collections more of the circle and puts them further out', () => {
    const hs = grownHeaders(sizes(8, 2, 2, 2));
    const r = hs.map(h => Math.hypot(h.x, h.y));
    expect(r[0]).toBeGreaterThan(Math.min(r[1], r[2], r[3]));
  });

  it('draws related collections toward each other', () => {
    const base = grownHeaders(sizes(3, 3, 3, 3, 3, 3));
    const tied = grownHeaders(sizes(3, 3, 3, 3, 3, 3), [{ a: 0, b: 3, weight: 2 }]);   // opposite sides of the ring
    expect(dist(tied[0], tied[3])).toBeLessThan(dist(base[0], base[3]));
  });

  it('fans a tangent away from the collection it grew out of', () => {
    const hs = grownHeaders(sizes(3, 3, 3, 3), [{ a: 0, b: 2, weight: 1 }]);
    const away = (Math.atan2(hs[2].y - hs[0].y, hs[2].x - hs[0].x) * 180) / Math.PI;
    expect(Math.abs(((hs[2].angle - away + 540) % 360) - 180)).toBeLessThan(16);
  });

  it('jitters the notes around the ring but keeps them around the topic', () => {
    const ring = grownKbRing(6);
    expect(grownKbRing(6)).toEqual(ring);
    const radii = ring.map(p => Math.hypot(p.x, p.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(10);
    expect(Math.min(...radii)).toBeGreaterThan(250);
  });

  it('fans cards a little off their slots without changing which one leads or how many there are', () => {
    const from = { x: 0, y: 0 };
    const flat = fanCenters(5, from, 0), wob = grownFan(5, from, 0, FRAG_H, 'c1');
    expect(wob).toHaveLength(5);
    expect(grownFan(5, from, 0, FRAG_H, 'c1')).toEqual(wob);
    expect(grownFan(5, from, 0, FRAG_H, 'c2')).not.toEqual(wob);
    wob.forEach((p, i) => { expect(dist(p, flat[i])).toBeLessThan(0.2 * Math.hypot(flat[i].x, flat[i].y)); });
    expect(dist(wob[0], from)).toBeLessThan(Math.min(...wob.slice(1).map(p => dist(p, from))));   // the lead still sits nearest
    expect(Math.abs(wob[0].y)).toBeLessThan(60);                                                     // and still points straight out
  });

  it('starts a whole web nearly collision-free, and the solver finishes the job', () => {
    for (const [nk, per, sz] of [[0, 3, [3, 3, 3, 3]], [6, 3, [3, 3, 3, 3]], [12, 4, [4, 4, 4, 4, 4, 4]], [4, 3, [3, 3, 3, 3, 3, 3, 3, 3]]] as const) {
      const nodes = [{ id: 'seed', x: -220, y: -75, w: 440, h: 150 }] as any[];
      grownKbRing(nk).forEach((p, i) => nodes.push({ id: `kb${i}`, x: p.x - 140, y: p.y - 55, w: 280, h: 110 }));
      grownHeaders(sz.map(size => ({ size }))).forEach((h, ci) => {
        nodes.push({ id: `h${ci}`, x: h.x - FRAG_W / 2, y: h.y - HEADER_H / 2, w: FRAG_W, h: HEADER_H });
        grownFan(per, h, h.angle, FRAG_H, `c${ci}`).forEach((c, fi) => nodes.push({ id: `c${ci}-${fi}`, x: c.x - FRAG_W / 2, y: c.y - FRAG_H / 2, w: FRAG_W, h: FRAG_H }));
      });
      const out = settle(nodes, [], undefined, 600);
      expect(out.overlaps).toBe(0);
      const moved = out.nodes.reduce((s, n, i) => s + Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y), 0) / nodes.length;
      expect(moved).toBeLessThan(160);
    }
  });
});

describe('collection ties', () => {
  it('ties collections by tangents and by cards that refer to cards elsewhere', () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: '', clusters: [{ title: 'a', slots: 1 }, { title: 'b', slots: 1 }, { title: 'c', slots: 1 }], edges: [{ source: 0, target: 1, label: 'x' }] });
    const frag = (id: string, to?: string) => ({ type: 'concept' as const, title: id, body: 'b', kbPassageIds: [id], ...(to ? { relates: [{ to, verb: 'led to' }] } : {}) });
    m = reduce(m, { type: 'fragment', cluster: 0, slot: 0, fragment: frag('p0') });
    m = reduce(m, { type: 'fragment', cluster: 1, slot: 0, fragment: frag('p1') });
    m = reduce(m, { type: 'fragment', cluster: 2, slot: 0, fragment: frag('p2', 'p0') });
    const ties = clusterTies(m);
    expect(ties.find(t => t.a === 0 && t.b === 1)?.weight).toBe(1);
    expect(ties.find(t => t.a === 0 && t.b === 2)?.weight).toBeCloseTo(0.3);
    expect(ties.find(t => t.a === 1 && t.b === 2)).toBeUndefined();
  });

  it('builds the same scene positions twice', () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: '', clusters: [{ title: 'a', slots: 2 }, { title: 'b', slots: 2 }], edges: [] });
    const pos = (s: any[]) => s.map(e => [e.id, e.x, e.y]);
    expect(pos(buildSkeletons(m))).toEqual(pos(buildSkeletons(m)));
  });
});
