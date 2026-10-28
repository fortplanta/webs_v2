// The view glides rather than jumps. A zoom, a fit or a "bring this into view" sets a target and the camera eases to it on a
// critically damped spring (no overshoot: a camera that wobbles is seasick, not alive). It works in terms of the point at the
// middle of the screen and the log of the zoom, so a zoom feels like it comes toward you instead of sliding sideways, and
// equal steps in zoom feel equal. Pure maths; hooks/useCamera.ts drives it.
//
// Excalidraw: sceneX = clientX / zoom − scrollX, so the scene point at the middle of the screen is width / (2·zoom) − scrollX.

export interface View { scrollX: number; scrollY: number; zoom: number; width: number; height: number }
export interface Target { scrollX: number; scrollY: number; zoom: number }

export const MIN_ZOOM = 0.1, MAX_ZOOM = 4;

/** What the camera is aiming at and how fast it is going, in (centre x, centre y, ln zoom). */
export interface Cam { cx: number; cy: number; lz: number; vx: number; vy: number; vz: number; gx: number; gy: number; gz: number }

const STIFF = 0.07, DAMP = 0.4;
const REST = { dist: 0.4, zoom: 0.0006, speed: 0.05 };

export const centreOf = (v: View): { cx: number; cy: number } => ({ cx: v.width / (2 * v.zoom) - v.scrollX, cy: v.height / (2 * v.zoom) - v.scrollY });

export function viewFor(cx: number, cy: number, zoom: number, width: number, height: number): Target {
  return { zoom, scrollX: width / (2 * zoom) - cx, scrollY: height / (2 * zoom) - cy };
}

/** A camera at `view`, aiming at `target`. */
export function aim(view: View, target: Target): Cam {
  const c = centreOf(view), g = centreOf({ ...view, ...target });
  return { cx: c.cx, cy: c.cy, lz: Math.log(view.zoom), vx: 0, vy: 0, vz: 0, gx: g.cx, gy: g.cy, gz: Math.log(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target.zoom))) };
}

/** Re-aim a moving camera (keeping its momentum) at a new target. */
export function reaim(cam: Cam, view: View, target: Target): Cam {
  const a = aim(view, target);
  return { ...a, cx: cam.cx, cy: cam.cy, lz: cam.lz, vx: cam.vx, vy: cam.vy, vz: cam.vz };
}

export interface CamStep { cam: Cam | null; view: Target }

/** One step (`dt` in 60 fps frames). `cam` is null once it has come to rest on the target. */
export function stepCam(cam: Cam, size: { width: number; height: number }, dt = 1): CamStep {
  const keep = Math.pow(1 - DAMP, dt);
  const vx = (cam.vx + (cam.gx - cam.cx) * STIFF * dt) * keep, vy = (cam.vy + (cam.gy - cam.cy) * STIFF * dt) * keep, vz = (cam.vz + (cam.gz - cam.lz) * STIFF * dt) * keep;
  const next = { ...cam, cx: cam.cx + vx * dt, cy: cam.cy + vy * dt, lz: cam.lz + vz * dt, vx, vy, vz };
  const resting = Math.hypot(next.gx - next.cx, next.gy - next.cy) < REST.dist && Math.abs(next.gz - next.lz) < REST.zoom && Math.hypot(vx, vy) < REST.speed && Math.abs(vz) < 0.0002;
  const at = resting ? { cx: cam.gx, cy: cam.gy, lz: cam.gz } : next;
  return { cam: resting ? null : next, view: viewFor(at.cx, at.cy, Math.exp(at.lz), size.width, size.height) };
}

/** Zoom by `factor` about the middle of the screen. */
export function zoomBy(view: View, factor: number): Target {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor)), c = centreOf(view);
  return viewFor(c.cx, c.cy, zoom, view.width, view.height);
}

export interface Box { x: number; y: number; width: number; height: number }

/**
 * The view that shows all of `box` with room around it (screen px: the canvas has toolbars along the top and bottom). Never
 * zooms in past 1:1, so a small web is not blown up.
 */
export function fitTarget(view: View, box: Box, factor = 0.9, pad = { x: 24, top: 96, bottom: 96 }): Target {
  const w = Math.max(1, view.width - 2 * pad.x), h = Math.max(1, view.height - pad.top - pad.bottom);
  const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min(w / Math.max(box.width, 1), h / Math.max(box.height, 1)) * factor));
  // centre the box in the free area (the toolbars make the free area off-centre by (top − bottom) / 2)
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2 + (pad.top - pad.bottom) / (2 * zoom);
  return viewFor(cx, cy, zoom, view.width, view.height);
}
