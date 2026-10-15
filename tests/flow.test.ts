import { describe, expect, it } from 'vitest';
import { envelope, flowEdges, flowify, obstacles, PEAK_ALPHA, PERIOD_S, pulseAt } from '../src/renderer/flow';

const arrow = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'arrow', x: 10, y: 20, points: [[0, 0], [300, 400]], strokeWidth: 1, customData: { directed: true }, ...extra }) as any;

describe('flow edges', () => {
  it('reads origin and target from directed arrows only', () => {
    const edges = flowEdges([arrow('a'), arrow('plain', { customData: undefined }), arrow('tether', { customData: { kind: 'tether' } }), arrow('gone', { isDeleted: true }), arrow('short', { points: [[0, 0], [2, 2]] })]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ id: 'a', x1: 10, y1: 20, x2: 310, y2: 420, width: 1 });
    expect(edges[0].phase).toBeGreaterThanOrEqual(0); expect(edges[0].phase).toBeLessThan(1);
  });
  it('keeps lines out of step with each other, deterministically', () => {
    const [a, b] = flowEdges([arrow('one'), arrow('two')]);
    expect(a.phase).not.toBe(b.phase);
    expect(flowEdges([arrow('one')])[0].phase).toBe(a.phase);
  });
  it('lists what a pulse must pass behind: cards, pictures and labels on lines', () => {
    const els = [
      { id: 'card', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, customData: { kind: 'fragment' } },
      { id: 'free', type: 'rectangle', x: 0, y: 0, width: 99, height: 99 },
      { id: 'img', type: 'image', x: 1, y: 1, width: 5, height: 5 },
      { id: 'lbl', type: 'text', containerId: 'a1', x: 2, y: 2, width: 3, height: 3 },
      { id: 'other', type: 'text', x: 2, y: 2, width: 3, height: 3 },
      arrow('a1'),
    ] as any[];
    expect(obstacles(els)).toHaveLength(3);
  });
});

describe('pulse timing', () => {
  const e = { phase: 0 };
  it('travels from the origin to the target, then rests', () => {
    const start = pulseAt(e, 0.2, 500)!, mid = pulseAt(e, PERIOD_S * 0.3, 500)!, late = pulseAt(e, PERIOD_S * 0.55, 500)!;
    expect(start.to).toBeLessThan(mid.to); expect(mid.to).toBeLessThan(late.to);
    expect(late.to).toBeLessThanOrEqual(1);
    expect(pulseAt(e, PERIOD_S * 0.8, 500)).toBeNull(); // resting
  });
  it('stays faint: never brighter than the peak, and fades in and out at the ends', () => {
    let max = 0;
    for (let s = 0; s < PERIOD_S; s += 0.05) max = Math.max(max, pulseAt(e, s, 500)?.alpha ?? 0);
    expect(max).toBeLessThanOrEqual(PEAK_ALPHA); expect(max).toBeGreaterThan(PEAK_ALPHA * 0.9);
    expect(envelope(0)).toBe(0); expect(envelope(1)).toBeCloseTo(0, 6); expect(envelope(0.5)).toBe(1);
  });
  it('is a short glow on a long line and the whole line on a short one, and a phase shifts the cycle', () => {
    const long = pulseAt(e, PERIOD_S * 0.3, 900)!, short = pulseAt(e, PERIOD_S * 0.3, 40)!;
    expect(long.to - long.from).toBeLessThan(0.2);
    expect(short.from).toBeGreaterThanOrEqual(0);
    expect(pulseAt({ phase: 0.8 }, 0.2, 500)).toBeNull();
  });
});

describe('flowify', () => {
  it('turns arrowheads into plain directed lines, once, leaving tethers alone', () => {
    const scene = [arrow('x', { endArrowhead: 'arrow', customData: undefined }), arrow('t', { endArrowhead: null, customData: { kind: 'tether' } })] as any[];
    const out = flowify(scene);
    expect(out[0]).toMatchObject({ endArrowhead: null, customData: { directed: true } });
    expect(out[1]).toBe(scene[1]);
    expect(flowify(out)[0]).toBe(out[0]);
  });
});
