import { describe, expect, it } from 'vitest';
import { arrowPath, bowedPoints, bowOf, curveBeziers, curveMiddle, isCurved, polylineLength, sampleCurve, slicePolyline } from '../src/renderer/curve';
import { routeArrows } from '../src/renderer/routeArrows';
import { flowEdges, pulsePath } from '../src/renderer/flow';
import { hitTest } from '../src/renderer/hit';
import { cutTargets } from '../src/renderer/gesture';

const box = (id: string, x: number, y: number, w = 100, h = 60): any => ({ id, type: 'rectangle', x, y, width: w, height: h, customData: { kind: 'fragment' } });
const arrow = (id: string, a: string, b: string, custom: any = { directed: true }): any => ({ id, type: 'arrow', x: 0, y: 0, width: 0, height: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: a }, endBinding: { elementId: b }, customData: custom });
const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);

describe('bowed connections', () => {
  it('leans a steady amount its own way: same line, same bow; different lines differ; short lines stay straight', () => {
    expect(bowOf('a', 600)).toBe(bowOf('a', 600));
    const bows = Array.from({ length: 40 }, (_, i) => bowOf(`line${i}`, 600));
    expect(bows.some(b => b > 0) && bows.some(b => b < 0)).toBe(true);        // some lean each way
    expect(Math.max(...bows.map(Math.abs))).toBeLessThanOrEqual(80);
    expect(bowOf('a', 40)).toBe(0);
  });

  it('keeps both ends where they were and bows between them', () => {
    const pts = bowedPoints({ x: 100, y: 100 }, { x: 700, y: 100 }, 'k');
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual([0, 0]); expect(pts[3]).toEqual([600, 0]);
    expect(Math.abs(pts[1][1])).toBeGreaterThan(5);                            // off the straight line
    const mid = curveMiddle(pts);
    expect(mid[0]).toBeGreaterThan(250); expect(mid[0]).toBeLessThan(350);     // and the middle is still about halfway along
  });

  it('draws the curve Excalidraw draws: through every point, starting and ending on the ends', () => {
    const pts = bowedPoints({ x: 0, y: 0 }, { x: 600, y: 200 }, 'k');
    const segs = curveBeziers(pts);
    expect(segs).toHaveLength(3);
    expect(segs[0][0]).toEqual(pts[0]); expect(segs[2][3]).toEqual(pts[3]);
    expect(segs[0][3]).toEqual(pts[1]); expect(segs[1][3]).toEqual(pts[2]);   // each joins the next at a point
    const line = sampleCurve(pts);
    expect(line[0]).toEqual(pts[0]); expect(dist(line[line.length - 1], pts[3])).toBeLessThan(1e-6);
    expect(polylineLength(line)).toBeGreaterThan(Math.hypot(600, 200));       // longer than the chord: it bows
    expect(polylineLength(line)).toBeLessThan(Math.hypot(600, 200) * 1.1);    // but only gently
  });

  it('slices a line for the pulse', () => {
    const line = [[0, 0], [100, 0], [100, 100]];
    expect(slicePolyline(line, 0, 1)).toEqual([[0, 0], [100, 0], [100, 100]]);
    expect(slicePolyline(line, 0, 0.5)).toEqual([[0, 0], [100, 0]]);
    expect(slicePolyline(line, 0.25, 0.75)).toEqual([[50, 0], [100, 0], [100, 50]]);
    expect(slicePolyline(line, 0.5, 0.5)).toEqual([]);
  });

  it('routes our connections as curves clipped to their boxes, but leaves a hand-drawn arrow straight', () => {
    const els = [box('a', 0, 0), box('b', 600, 40), arrow('origin-0', 'a', 'b'), arrow('tether-0-0', 'a', 'b', { kind: 'tether', max: 900 }), arrow('mine', 'a', 'b', null)];
    const out = routeArrows(els);
    const [, , o, t, m] = out;
    expect(isCurved(o)).toBe(true); expect(isCurved(m)).toBe(false);
    expect(o.points).toHaveLength(4); expect(o.roundness).toEqual({ type: 2 });
    expect(t.points).toHaveLength(4);
    expect(m.points).toHaveLength(2); expect(m.roundness).toBeUndefined();
    expect(o.x).toBeGreaterThanOrEqual(100 - 1);                                // leaves the edge of box a, not its middle
    expect(routeArrows(out).map(e => e.points)).toEqual(out.map(e => e.points)); // idempotent
  });

  it('puts a label at the middle of the curve', () => {
    const label = { id: 'origin-0-label', type: 'text', containerId: 'origin-0', x: 0, y: 0, width: 60, height: 20 };
    const out = routeArrows([box('a', 0, 0), box('b', 800, 0), arrow('origin-0', 'a', 'b'), label]);
    const a = out[2], l = out[3];
    const mid = curveMiddle(a.points);
    expect(l.x + 30).toBeCloseTo(a.x + mid[0]); expect(l.y + 10).toBeCloseTo(a.y + mid[1]);
  });

  it('is what clicks, cuts and the pulse follow', () => {
    const els = routeArrows([box('a', 0, 0), box('b', 800, 0), arrow('origin-0', 'a', 'b', { directed: true }), arrow('tether-0-0', 'a', 'b', { kind: 'tether', max: 900 })]);
    const t = els[3];
    const path = arrowPath(t);
    const mid = path[Math.floor(path.length / 2)];
    expect(hitTest(els, mid[0], mid[1], 1)?.kind).toBe('edge');                // on the curve
    const chordMid = { x: (path[0][0] + path[path.length - 1][0]) / 2, y: (path[0][1] + path[path.length - 1][1]) / 2 };
    const farOff = Math.hypot(mid[0] - chordMid.x, mid[1] - chordMid.y) > 15;
    expect(farOff).toBe(true);                                                  // the bow really leaves the chord
    expect(cutTargets(els, { x: mid[0] + 2, y: mid[1] - 40 }, { x: mid[0] + 2, y: mid[1] + 40 }).map(c => c.id)).toContain('tether-0-0');
    const edge = flowEdges(els).find(e => e.id === 'origin-0')!;
    expect(edge.path.length).toBeGreaterThan(4);
    const seg = pulsePath(edge, { from: 0.4, to: 0.6 });
    expect(seg.length).toBeGreaterThan(1);
    for (const p of seg) expect(p[1]).toBeGreaterThan(-100);
  });
});
