import { describe, expect, it } from 'vitest';
import { clusterFootprint, fanAngles, fanCenters, findClusterSpot, headerRing, kbRing, type Rect } from '../src/renderer/layout/organic';
import { settle } from '../src/renderer/layout/engine';
import { FRAG_H, FRAG_W, HEADER_H } from '../src/renderer/boxes';

describe('organic layout', () => {
  it('is deterministic and spreads headers around the ring from the top', () => {
    expect(headerRing(4)).toEqual(headerRing(4));
    const r = headerRing(4);
    expect(r[0].y).toBeLessThan(0);                 // first collection at the top
    expect(r[1].x).toBeGreaterThan(0);              // then clockwise
    expect(r[2].y).toBeGreaterThan(0);
    expect(r[3].x).toBeLessThan(0);
    expect(r[0].angle).toBeCloseTo(-90);            // fans straight up
  });

  it('branches cards off the outward direction: the lead one straight out and nearest, the rest staggered either side and further', () => {
    expect(fanAngles(1)).toEqual([0]);
    expect(fanAngles(5)).toEqual([0, 38, -38, 76, -76]);
    const cs = fanCenters(3, { x: 0, y: 0 }, 0);
    const d = cs.map(c => Math.hypot(c.x, c.y));
    expect(cs[0].y).toBeCloseTo(0); expect(cs[0].x).toBeGreaterThan(0);   // lead card straight out
    expect(d[1]).toBeGreaterThan(d[0]); expect(d[2]).toBeCloseTo(d[1]);     // the flankers sit further out, evenly either side
    expect(cs[1].y).toBeGreaterThan(0); expect(cs[2].y).toBeLessThan(0);
  });

  it('starts a whole web nearly collision-free, and the solver finishes the job', () => {
    for (const [nk, nc, per] of [[0, 4, 3], [6, 4, 3], [12, 6, 4], [4, 8, 3]] as const) {
      const nodes = [{ id: 'seed', x: -220, y: -75, w: 440, h: 150 }] as any[];
      kbRing(nk).forEach((p, i) => nodes.push({ id: `kb${i}`, x: p.x - 140, y: p.y - 55, w: 280, h: 110 }));
      headerRing(nc).forEach((h, ci) => {
        nodes.push({ id: `h${ci}`, x: h.x - FRAG_W / 2, y: h.y - HEADER_H / 2, w: FRAG_W, h: HEADER_H });
        fanCenters(per, h, h.angle).forEach((c, fi) => nodes.push({ id: `c${ci}-${fi}`, x: c.x - FRAG_W / 2, y: c.y - FRAG_H / 2, w: FRAG_W, h: FRAG_H }));
      });
      const out = settle(nodes, [], undefined, 400);
      expect(out.overlaps).toBe(0);
      // and it barely had to move anything
      const moved = out.nodes.reduce((s, n, i) => s + Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y), 0) / nodes.length;
      expect(moved).toBeLessThan(120);
    }
  });

  it('grows a pivot on in the direction the card itself grew (away from what it hangs off), not away from the canvas middle', () => {
    const source: Rect = { x: 900, y: -96, width: 280, height: 192 };
    const around: Rect[] = [{ x: -220, y: -75, width: 440, height: 150 }, source];
    const fromBelow = findClusterSpot(around, source, 3, { x: 1040, y: 700 });   // it hangs off something below it
    expect(fromBelow.header.y).toBeLessThan(0);                                  // so growth carries on upward
    expect(fromBelow.angle).toBeLessThan(-80); expect(fromBelow.angle).toBeGreaterThan(-100);
  });

  it('puts a pivot outward from the source, then swings or moves out when that spot is taken', () => {
    const source: Rect = { x: 900, y: -96, width: 280, height: 192 };
    const around: Rect[] = [{ x: -220, y: -75, width: 440, height: 150 }, source];
    const free = findClusterSpot(around, source, 3);
    expect(free.header.x).toBeGreaterThan(1040);                       // out to the right of the source
    expect(Math.abs(free.angle)).toBeLessThan(1);
    const foot = (spot: typeof free) => clusterFootprint(3, spot.header, spot.angle);
    const blocker = foot(free);
    const next = findClusterSpot([...around, blocker], source, 3);
    const nf = foot(next);
    const hit = nf.x < blocker.x + blocker.width && blocker.x < nf.x + nf.width && nf.y < blocker.y + blocker.height && blocker.y < nf.y + nf.height;
    expect(hit).toBe(false);
  });
});
