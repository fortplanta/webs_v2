export interface View { scrollX: number; scrollY: number; zoom: number; width: number; height: number }
export interface Bounds { x: number; y: number; width: number; height: number }

// Screen-pixel room to leave around revealed content: the canvas has toolbars along the top and bottom.
const PAD_X = 24, PAD_TOP = 96, PAD_BOTTOM = 96;

/**
 * A view that shows `bounds`, or null if they're already fully visible. Moves as little as possible:
 * it never zooms in, zooms out only if the content can't otherwise fit, and otherwise just scrolls
 * the minimum needed — so the rest of the canvas stays where the user had it.
 * (Excalidraw: sceneX = clientX / zoom - scrollX.)
 */
export function revealView(view: View, bounds: Bounds): { scrollX: number; scrollY: number; zoom: number } | null {
  const left = -view.scrollX, top = -view.scrollY, right = left + view.width / view.zoom, bottom = top + view.height / view.zoom;
  if (bounds.x >= left && bounds.y >= top && bounds.x + bounds.width <= right && bounds.y + bounds.height <= bottom) return null;

  // Zoom out only as far as needed: `fit` is the zoom at which the bounds plus their screen-pixel
  // padding exactly fill the view. Never zoom in.
  const fit = Math.min((view.width - 2 * PAD_X) / bounds.width, (view.height - PAD_TOP - PAD_BOTTOM) / bounds.height);
  const zoom = Math.max(0.1, Math.min(view.zoom, fit));
  // Keep the current view's center fixed across a zoom change.
  const cx = left + view.width / view.zoom / 2, cy = top + view.height / view.zoom / 2;
  const w = view.width / zoom, h = view.height / zoom;
  let l = cx - w / 2, t = cy - h / 2;

  // Then scroll the minimum so the bounds (with padding) are inside.
  const px = PAD_X / zoom, ptop = PAD_TOP / zoom, pbottom = PAD_BOTTOM / zoom;
  if (bounds.x - px < l) l = bounds.x - px; else if (bounds.x + bounds.width + px > l + w) l = bounds.x + bounds.width + px - w;
  if (bounds.y - ptop < t) t = bounds.y - ptop; else if (bounds.y + bounds.height + pbottom > t + h) t = bounds.y + bounds.height + pbottom - h;
  return { zoom, scrollX: 0 - l, scrollY: 0 - t }; // (0 - x avoids a negative zero)
}
