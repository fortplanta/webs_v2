import { describe, expect, it } from 'vitest';
import { addMoves, ARRIVE_FLIGHT_MS, arrivalDelay, easeOutBack, flightOffset, flightOpacity, leanTargets, MAX_LEAN, stepSpring, stepSprings, type Spring } from '../src/renderer/motion';

/** Run a spring to rest from `x`, returning the positions it passed through. */
function run(x0: number, goal: number, dt = 1) {
  let x = x0, s: Spring | null = { gx: goal, gy: 0, vx: 0, vy: 0 }; const path = [x];
  for (let i = 0; i < 600 && s; i++) { const r = stepSpring(s, x, 0, dt); x += r.move.dx; s = r.next; path.push(x); }
  return { x, path, frames: path.length - 1, rested: !s };
}

describe('springs', () => {
  it('ease to the goal and come to rest exactly on it', () => {
    const { x, rested, frames } = run(0, 100);
    expect(rested).toBe(true);
    expect(x).toBeCloseTo(100, 6);
    expect(frames).toBeLessThan(60);                    // settles within a second
    expect(frames).toBeGreaterThan(8);                  // but not in a snap
  });

  it('overshoot a little and settle: calm, not bouncy', () => {
    const { path } = run(0, 100);
    const peak = Math.max(...path);
    expect(peak).toBeGreaterThan(100);                  // goes a touch past
    expect(peak).toBeLessThan(112);                     // never more than about 10%
    const after = path.slice(path.indexOf(peak));
    expect(Math.min(...after)).toBeGreaterThan(95);     // and does not swing back through the goal
  });

  it('take the same path whatever the frame rate (a slow frame moves further, not differently)', () => {
    const a = run(0, 100, 1).x, b = run(0, 100, 2).x;
    expect(a).toBeCloseTo(100, 4); expect(b).toBeCloseTo(100, 4);
  });

  it('carry on toward the goal after the layout stops asking, and are dropped for a node the user holds', () => {
    const pos = new Map([['a', { x: 0, y: 0 }], ['b', { x: 50, y: 50 }]]);
    let t = stepSprings(new Map(), pos, new Map([['a', { dx: 60, dy: 0 }], ['b', { dx: 0, dy: 40 }]]), new Set());
    expect(t.moves.get('a')!.dx).toBeGreaterThan(0);
    expect(t.springs.size).toBe(2);
    // next frame: nothing asked (the overlap is "resolved") but they are still on their way
    const moved = new Map([['a', { x: t.moves.get('a')!.dx, y: 0 }], ['b', { x: 50, y: 50 + t.moves.get('b')!.dy }]]);
    t = stepSprings(t.springs, moved, new Map(), new Set());
    expect(t.moves.size).toBe(2);
    // held: its spring is dropped
    t = stepSprings(t.springs, moved, new Map(), new Set(['a']));
    expect(t.springs.has('a')).toBe(false);
  });

  it('settle everything eventually', () => {
    let pos = new Map([['a', { x: 0, y: 0 }]]);
    let t = stepSprings(new Map(), pos, new Map([['a', { dx: 80, dy: -30 }]]), new Set());
    for (let i = 0; i < 400 && (t.moves.size || t.springs.size); i++) {
      const m = t.moves.get('a'); if (m) pos = new Map([['a', { x: pos.get('a')!.x + m.dx, y: pos.get('a')!.y + m.dy }]]);
      t = stepSprings(t.springs, pos, new Map(), new Set());
    }
    expect(t.springs.size).toBe(0);
    expect(pos.get('a')!.x).toBeCloseTo(80, 4); expect(pos.get('a')!.y).toBeCloseTo(-30, 4);
  });

  it('add moves together', () => {
    const sum = addMoves(new Map([['a', { dx: 1, dy: 2 }]]), new Map([['a', { dx: 3, dy: 4 }], ['b', { dx: 5, dy: 6 }]]));
    expect(sum.get('a')).toEqual({ dx: 4, dy: 6 }); expect(sum.get('b')).toEqual({ dx: 5, dy: 6 });
  });
});

describe('arrivals', () => {
  const f = { from: { dx: 300, dy: -200 }, start: 1000 };

  it('starts where the card grew from, ends in its place, and lands just past it first', () => {
    expect(flightOffset(f, 900)).toEqual({ dx: 300, dy: -200 });                    // not left yet
    expect(flightOffset(f, 1000 + ARRIVE_FLIGHT_MS).dx).toBeCloseTo(0);              // landed
    const offsets = Array.from({ length: 40 }, (_, i) => flightOffset(f, 1000 + (ARRIVE_FLIGHT_MS * i) / 39).dx);
    expect(offsets[0]).toBe(300);
    expect(Math.min(...offsets)).toBeLessThan(0);                                   // overshoots its place...
    expect(Math.min(...offsets)).toBeGreaterThan(-300 * 0.08);                      // ...by a few percent
    expect(easeOutBack(0)).toBe(0); expect(easeOutBack(1)).toBeCloseTo(1);
  });

  it('fades in over the first half of the flight, not at all before it leaves', () => {
    expect(flightOpacity(f, 500)).toBe(0);
    expect(flightOpacity(f, 1000 + ARRIVE_FLIGHT_MS / 4)).toBeCloseTo(0.5);
    expect(flightOpacity(f, 1000 + ARRIVE_FLIGHT_MS / 2)).toBe(1);
    expect(flightOpacity(f, 99_999)).toBe(1);
  });

  it('staggers a collection: header first, its cards after it, one after another and never for long', () => {
    expect(arrivalDelay(0, false)).toBe(0);
    expect(arrivalDelay(0, true)).toBeGreaterThan(arrivalDelay(0, false));
    expect(arrivalDelay(3, true)).toBeGreaterThan(arrivalDelay(2, true));
    expect(arrivalDelay(50, true)).toBe(arrivalDelay(9, true));                     // capped
  });
});

describe('leaning', () => {
  it('leans neighbours a little toward where a card is dragged, closer kin more, and never far', () => {
    const t = leanTargets({ dx: 100, dy: 0 }, new Map([['header', 1], ['sibling', 0.5]]));
    expect(t.get('header')!.dx).toBeCloseTo(12); expect(t.get('sibling')!.dx).toBeCloseTo(6);
    expect(t.get('header')!.dy).toBeCloseTo(0);
    const far = leanTargets({ dx: 3000, dy: 4000 }, new Map([['header', 1]]));
    expect(Math.hypot(far.get('header')!.dx, far.get('header')!.dy)).toBeCloseTo(MAX_LEAN);
    expect(far.get('header')!.dx / far.get('header')!.dy).toBeCloseTo(0.75);        // in the direction of the drag
    expect(leanTargets({ dx: 0.2, dy: 0 }, new Map([['header', 1]])).size).toBe(0); // a click is not a drag
  });
});
