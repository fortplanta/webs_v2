import { describe, expect, it } from 'vitest';
import { ARRIVE_MS, arrivalHalo, BREATH_S, breath, DONE_MS, doneRing } from '../src/renderer/fx';

describe('canvas motion', () => {
  it('an arriving card gets a halo that widens and fades, and a glint that is gone sooner', () => {
    const a = arrivalHalo(0)!, b = arrivalHalo(ARRIVE_MS / 2)!, c = arrivalHalo(ARRIVE_MS - 1)!;
    expect(a.alpha).toBeGreaterThan(b.alpha); expect(b.alpha).toBeGreaterThan(c.alpha);
    expect(a.grow).toBeLessThan(b.grow); expect(b.grow).toBeLessThan(c.grow);
    expect(a.glint).toBeGreaterThan(0); expect(arrivalHalo(500)!.glint).toBe(0);
    expect(a.alpha).toBeLessThanOrEqual(0.4);                    // faint
    expect(arrivalHalo(ARRIVE_MS)).toBeNull(); expect(arrivalHalo(-5)).toBeNull();
  });
  it('the origin breathes slowly and calmly, never bright', () => {
    const lo = breath(0), hi = breath(BREATH_S / 2), back = breath(BREATH_S);
    expect(hi.inner).toBeGreaterThan(lo.inner);
    expect(back.inner).toBeCloseTo(lo.inner, 6);                  // one full breath returns to calm
    for (let s = 0; s < 6; s += 0.1) { const b = breath(s); expect(b.inner).toBeLessThanOrEqual(0.2); expect(b.outer).toBeLessThan(b.inner); }
  });
  it('a finished web gets one wide ring that fades out', () => {
    expect(doneRing(0)!.alpha).toBeGreaterThan(doneRing(DONE_MS / 2)!.alpha);
    expect(doneRing(DONE_MS / 2)!.grow).toBeGreaterThan(doneRing(0)!.grow);
    expect(doneRing(DONE_MS)).toBeNull();
  });
});
