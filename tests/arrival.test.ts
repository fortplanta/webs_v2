import { describe, expect, it } from 'vitest';
import { applyOpacity, opacityNow, stageArrivals, stepArrivals } from '../src/renderer/arrival';
import { motionFrame, newMotionState, kinOf } from '../src/renderer/layout/frame';
import { ARRIVE_FLIGHT_MS } from '../src/renderer/motion';
import { routeArrows, rerouteCurves } from '../src/renderer/routeArrows';
import { isCurved } from '../src/renderer/curve';
import { buildNodes } from '../src/renderer/layout/sceneNodes';

type El = Record<string, any>;
const rect = (id: string, x: number, y: number, w = 280, h = 120, extra: El = {}): El => ({ id, type: 'rectangle', x, y, width: w, height: h, opacity: 100, version: 1, ...extra });
const arrow = (id: string, a: string, b: string, custom: El): El => ({ id, type: 'arrow', x: 0, y: 0, width: 0, height: 0, points: [[0, 0], [1, 1]], opacity: 55, version: 1, startBinding: { elementId: a }, endBinding: { elementId: b }, customData: custom });

/** seed + header + two cards on tethers, with their lines */
const web = (): El[] => routeArrows([
  rect('seed', -220, -75, 440, 150, { locked: true }),
  rect('cluster-0', 900, -24, 280, 48, { customData: { kind: 'cluster', index: 0 } }),
  rect('frag-0-0', 1300, -60, 280, 120, { customData: { kind: 'fragment' } }),
  rect('frag-0-1', 1300, 150, 280, 120, { customData: { kind: 'fragment' } }),
  arrow('origin-0', 'seed', 'cluster-0', { directed: true }),
  arrow('tether-0-0', 'cluster-0', 'frag-0-0', { kind: 'tether', max: 900 }),
  arrow('tether-0-1', 'cluster-0', 'frag-0-1', { kind: 'tether', max: 900 }),
]);
const at = (els: El[], id: string) => els.find(e => e.id === id)!;

describe('arrivals', () => {
  it('start new nodes at what they grew from, invisible, with their lines, and leave the origin and old nodes alone', () => {
    const final = web();
    const prev = final.filter(e => e.id === 'seed');
    const { elements, arrivals } = stageArrivals(prev, final, 1000);
    expect(arrivals.map(a => a.node).sort()).toEqual(['cluster-0', 'frag-0-0', 'frag-0-1']);
    expect(at(elements, 'seed').x).toBe(-220);
    // header starts on the topic, cards start on their header's final place
    const h = at(elements, 'cluster-0');
    expect(h.x + h.width / 2).toBeCloseTo(0, 0); expect(h.opacity).toBe(0);
    const c = at(elements, 'frag-0-0');
    expect(c.x + c.width / 2).toBeCloseTo(900 + 140, 0);
    expect(at(elements, 'tether-0-0').opacity).toBe(0);
    expect(at(elements, 'origin-0').opacity).toBe(0);
  });

  it('staggers: the header leaves first, then its cards one after another', () => {
    const { arrivals } = stageArrivals(web().filter(e => e.id === 'seed'), web(), 0);
    const start = (id: string) => arrivals.find(a => a.node === id)!.flight.start;
    expect(start('cluster-0')).toBeLessThan(start('frag-0-0'));
    expect(start('frag-0-0')).toBeLessThan(start('frag-0-1'));
  });

  it('does not animate anything already there, or when there is nothing to grow from', () => {
    const final = web();
    expect(stageArrivals(final, final, 0).arrivals).toEqual([]);
    expect(stageArrivals([], [rect('lonely', 0, 0)], 0).arrivals).toEqual([]);   // no line back to anything
  });

  it('carries every node to exactly its place, fully opaque, and then stops', () => {
    const final = web();
    const { elements, arrivals } = stageArrivals(final.filter(e => e.id === 'seed'), final, 0);
    let els = elements;
    let state = { ...newMotionState(), arrivals };
    let active = true, frames = 0;
    for (let t = 0; active && frames < 400; t += 16.7, frames++) {
      const r = motionFrame(els, new Set(), state, t, false);
      els = r.elements; state = r.state; active = r.active;
    }
    expect(active).toBe(false);
    expect(frames).toBeLessThan(120);
    for (const id of ['cluster-0', 'frag-0-0', 'frag-0-1']) {
      expect(at(els, id).x).toBeCloseTo(at(final, id).x, 3); expect(at(els, id).y).toBeCloseTo(at(final, id).y, 3); expect(at(els, id).opacity).toBe(100);
    }
    for (const id of ['origin-0', 'tether-0-0', 'tether-0-1']) expect(at(els, id).opacity).toBe(at(final, id).opacity);   // back to their own
  });

  it('fades lines in with the slower end, and puts everything back to its own opacity at the end', () => {
    const final = web();
    const { arrivals } = stageArrivals(final.filter(e => e.id === 'seed'), final, 0);
    const mid = opacityNow(arrivals, arrivals.find(a => a.node === 'frag-0-0')!.flight.start + ARRIVE_FLIGHT_MS / 4);
    expect(mid.get('frag-0-0')).toBe(50);
    expect(mid.get('tether-0-0')).toBeLessThanOrEqual(mid.get('frag-0-0')! * 0.55 + 1);
    const done = stepArrivals(arrivals, 1e6);
    expect(done.remaining).toEqual([]);
    expect(done.opacity.get('frag-0-0')).toBe(100); expect(done.opacity.get('tether-0-0')).toBe(55);
  });

  it('keeps an update that replaces a flying card (a ghost filled in) at its current opacity', () => {
    const els = [rect('a', 0, 0), rect('b', 500, 0)];
    const op = new Map([['a', 40]]);
    const out = applyOpacity(els, op);
    expect(out[0].opacity).toBe(40); expect(out[1]).toBe(els[1]);
    expect(applyOpacity(out, op)).toBe(out);   // nothing to change: same array
  });
});

describe('the frame', () => {
  it('eases overlapping cards apart on springs and comes to rest clear of each other', () => {
    let els: El[] = [rect('seed', -2000, -2000, 10, 10, { locked: true }), rect('a', 0, 0), rect('b', 100, 20)];
    let state = newMotionState();
    let active = true, frames = 0;
    const first = motionFrame(els, new Set(), state, 0, true);
    expect(first.active).toBe(true);
    for (let t = 0; active && frames < 600; t += 16.7, frames++) { const r = motionFrame(els, new Set(), state, t, true); els = r.elements; state = r.state; active = r.active; }
    expect(active).toBe(false);
    const [a, b] = [at(els, 'a'), at(els, 'b')];
    const clear = a.x + a.width + 20 <= b.x || b.x + b.width + 20 <= a.x || a.y + a.height + 20 <= b.y || b.y + b.height + 20 <= a.y;
    expect(clear).toBe(true);
    expect(frames).toBeGreaterThan(5);        // eased, not snapped
  });

  it('leaves a held card where the user put it, and leans its header toward it, then eases back', () => {
    const final = web().filter(e => !e.id.startsWith('frag-0-1') && e.id !== 'tether-0-1');
    let els = final; let state = newMotionState();
    const held = new Set(['frag-0-0']);
    const header0 = at(els, 'cluster-0').x;
    // the user drags the card 300px right over a few frames
    for (let i = 1; i <= 12; i++) {
      els = els.map(e => (e.id === 'frag-0-0' ? { ...e, x: e.x + 25 } : e));
      const r = motionFrame(els, held, state, i * 16.7, true); els = r.elements; state = r.state;
    }
    expect(at(els, 'frag-0-0').x).toBeCloseTo(1300 + 300, 3);                  // exactly where the pointer took it
    expect(at(els, 'cluster-0').x).toBeGreaterThan(header0);                    // header leaned toward it
    expect(at(els, 'cluster-0').x - header0).toBeLessThanOrEqual(34 + 1);       // but not far
    expect(at(els, 'seed').x).toBe(-220);                                       // the origin never moves
    // let go: it eases back to where it was
    let active = true;
    for (let i = 13; active && i < 400; i++) { const r = motionFrame(els, new Set(), state, i * 16.7, true); els = r.elements; state = r.state; active = r.active; }
    expect(at(els, 'cluster-0').x).toBeCloseTo(header0, 0);
  });

  it('redraws curved lines when a box has moved and leaves them alone when it has not', () => {
    const els = web();
    const moved = els.map(e => (e.id === 'frag-0-0' ? { ...e, x: e.x + 200, y: e.y + 100 } : e));
    const out = rerouteCurves(moved);
    expect(out).not.toBe(moved);
    expect(isCurved(at(out, 'tether-0-0'))).toBe(true);
    const t = at(out, 'tether-0-0'), end = t.points[t.points.length - 1];
    expect(t.x + end[0]).toBeGreaterThan(1300 - 5);                              // ends on the card's new edge
    expect(rerouteCurves(out)).toBe(out);
  });

  it('knows who a dragged card leans its neighbours toward', () => {
    const { tethers } = buildNodes(web());
    const kin = kinOf(new Set(['frag-0-0']), tethers, new Set());
    expect(kin.get('cluster-0')).toBe(1); expect(kin.get('frag-0-1')).toBe(0.5); expect(kin.has('frag-0-0')).toBe(false);
    expect(kinOf(new Set(['cluster-0']), tethers, new Set()).get('frag-0-0')).toBe(1);
    expect(kinOf(new Set(['frag-0-0']), tethers, new Set(['cluster-0'])).has('cluster-0')).toBe(false);
  });
});
