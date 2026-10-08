export interface View { scrollX: number; scrollY: number; zoom: number; width: number; height: number }
export interface Bounds { x: number; y: number; width: number; height: number }

/**
 * A view that shows `bounds`, or null if they're already fully visible. Never zooms in; zooms out
 * only as far as needed. (Excalidraw: sceneX = clientX / zoom - scrollX.)
 */
export function revealView(view: View, bounds: Bounds, margin = 0.85): { scrollX: number; scrollY: number; zoom: number } | null {
  const left = -view.scrollX, top = -view.scrollY, right = left + view.width / view.zoom, bottom = top + view.height / view.zoom;
  if (bounds.x >= left && bounds.y >= top && bounds.x + bounds.width <= right && bounds.y + bounds.height <= bottom) return null;
  const fit = Math.min((view.width * margin) / bounds.width, (view.height * margin) / bounds.height);
  const zoom = Math.max(0.1, Math.min(view.zoom, fit));
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  return { zoom, scrollX: view.width / 2 / zoom - cx, scrollY: view.height / 2 / zoom - cy };
}
