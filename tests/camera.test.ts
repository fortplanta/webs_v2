import { describe, expect, it } from 'vitest';
import { aim, centreOf, fitTarget, reaim, stepCam, viewFor, zoomBy, type View } from '../src/renderer/camera';

const view: View = { scrollX: 100, scrollY: -50, zoom: 0.5, width: 1200, height: 800 };

/** Run the camera to rest, returning each frame's view. */
function glide(from: View, to: { scrollX: number; scrollY: number; zoom: number }, dt = 1) {
  let cam: ReturnType<typeof aim> | null = aim(from, to); const frames = [] as Array<{ scrollX: number; scrollY: number; zoom: number }>;
  for (let i = 0; i < 400 && cam; i++) { const r = stepCam(cam, from, dt); frames.push(r.view); cam = r.cam; }
  return { frames, rested: !cam };
}

describe('camera', () => {
  it('converts between a view and the scene point at its middle', () => {
    const c = centreOf(view);
    const back = viewFor(c.cx, c.cy, view.zoom, view.width, view.height);
    expect(back.scrollX).toBeCloseTo(view.scrollX); expect(back.scrollY).toBeCloseTo(view.scrollY);
  });

  it('glides to its target, ending exactly on it, in well under a second', () => {
    const to = { scrollX: -800, scrollY: 300, zoom: 0.25 };
    const { frames, rested } = glide(view, to);
    expect(rested).toBe(true);
    const end = frames[frames.length - 1];
    expect(end.scrollX).toBeCloseTo(to.scrollX, 3); expect(end.scrollY).toBeCloseTo(to.scrollY, 3); expect(end.zoom).toBeCloseTo(to.zoom, 6);
    expect(frames.length).toBeLessThan(70);
    expect(frames.length).toBeGreaterThan(15);             // eased, not a jump
  });

  it('never overshoots: a camera that wobbles is seasick', () => {
    const to = { scrollX: -800, scrollY: 300, zoom: 0.25 };
    const { frames } = glide(view, to);
    const zooms = frames.map(f => f.zoom);
    expect(Math.min(...zooms)).toBeGreaterThanOrEqual(0.25 - 1e-6);      // never past the zoom it aims for
    const cx = frames.map(f => centreOf({ ...view, ...f }).cx), goal = centreOf({ ...view, ...to }).cx, start = centreOf(view).cx;
    const lo = Math.min(start, goal), hi = Math.max(start, goal);
    expect(Math.min(...cx)).toBeGreaterThanOrEqual(lo - 1); expect(Math.max(...cx)).toBeLessThanOrEqual(hi + 1);
  });

  it('keeps the same pace whatever the frame rate', () => {
    const to = { scrollX: -800, scrollY: 300, zoom: 0.25 };
    expect(glide(view, to, 2).frames.length).toBeLessThan(glide(view, to, 1).frames.length);
    const end = glide(view, to, 2).frames.at(-1)!;
    expect(end.scrollX).toBeCloseTo(-800, 3);
  });

  it('can be re-aimed mid-glide, keeping its momentum', () => {
    let cam: ReturnType<typeof aim> | null = aim(view, { scrollX: -800, scrollY: 300, zoom: 0.25 });
    let v = view;
    for (let i = 0; i < 10; i++) { const r = stepCam(cam!, view, 1); cam = r.cam; v = { ...view, ...r.view }; }
    const moving = reaim(cam!, v, { scrollX: 500, scrollY: 0, zoom: 1 });
    expect(moving.vx).toBe(cam!.vx);
    expect(moving.gz).toBeCloseTo(0);                       // ln 1
  });

  it('zooms about the middle of the screen and stays within limits', () => {
    const t = zoomBy(view, 1.25);
    expect(t.zoom).toBeCloseTo(0.625);
    const a = centreOf(view), b = centreOf({ ...view, ...t });
    expect(b.cx).toBeCloseTo(a.cx); expect(b.cy).toBeCloseTo(a.cy);
    expect(zoomBy({ ...view, zoom: 4 }, 1.25).zoom).toBe(4);
    expect(zoomBy({ ...view, zoom: 0.1 }, 0.5).zoom).toBeCloseTo(0.1);
  });

  it('fits a box with room for the toolbars, centred, never past 1:1', () => {
    const big = fitTarget(view, { x: -1700, y: -1300, width: 3400, height: 2600 });
    expect(big.zoom).toBeGreaterThan(0.1); expect(big.zoom).toBeLessThan(0.3);
    const wide = { ...view, ...big };
    // the whole box is on screen
    const left = -wide.scrollX, top = -wide.scrollY, right = left + wide.width / wide.zoom, bottom = top + wide.height / wide.zoom;
    expect(left).toBeLessThan(-1700); expect(right).toBeGreaterThan(1700); expect(top).toBeLessThan(-1300); expect(bottom).toBeGreaterThan(1300);
    expect(fitTarget(view, { x: 0, y: 0, width: 100, height: 80 }).zoom).toBe(1);
  });
});
