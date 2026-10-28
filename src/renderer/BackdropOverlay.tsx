import { useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { cardGlow, convexHull, dots, liftTarget, liftToward, paddedCorners, PARALLAX, regionHue, regionsOf, roundedOutline } from './backdrop';
import { hitTest } from './hit';
import type { El } from './sceneEdit';

const cardKinds = new Set(['fragment', 'image-card']);
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** A tile of faint noise, painted once and repeated over the canvas: the surface has a grain, not a flat fill. */
function grainTile(): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(128, 128);
  let seed = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = 120 + ((seed >>> 24) % 100);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 9;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * The surface the cards sit on, painted on a canvas *behind* Excalidraw (whose own background is transparent): a dot field that
 * drifts a little slower than the cards when you pan, a faint glow around the topic, a soft region behind each collection, and
 * light under each card that deepens when you hover, select or drag it (see backdrop.ts). It ignores the pointer and changes
 * nothing in the scene.
 */
export function BackdropOverlay({ api, hidden }: { api: ExcalidrawImperativeAPI | null; hidden?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!api || !el || hidden) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lifts = new Map<string, number>();
    const grain = grainTile();
    const pattern = grain ? ctx.createPattern(grain, 'repeat') : null;
    let hovered: string | null = null, raf = 0, w = 0, h = 0, dpr = 1, last = 0, pending: { x: number; y: number } | null = null;
    const bg = css('--color-canvas', '#000000'), dotColour = css('--color-canvas-dot', '#1B1B1B'), cardBg = css('--color-card-bg', '#101010');

    const size = () => { const r = el.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; w = r.width; h = r.height; el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); };
    const ro = new ResizeObserver(() => { size(); kick(); });
    ro.observe(el);
    size();

    // which card the pointer is over (looked up once per frame, not per event)
    const host = el.parentElement;
    const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); pending = { x: e.clientX - r.left, y: e.clientY - r.top }; kick(); };
    const onLeave = () => { pending = null; hovered = null; kick(); };
    host?.addEventListener('pointermove', onMove, true);
    host?.addEventListener('pointerleave', onLeave);
    const off = api.onChange(() => kick());

    function lookup(els: El[], a: { zoom: { value: number }; scrollX: number; scrollY: number }) {
      if (!pending) return;
      const sx = pending.x / a.zoom.value - a.scrollX, sy = pending.y / a.zoom.value - a.scrollY;
      const hit = hitTest(els, sx, sy, a.zoom.value);
      hovered = hit && hit.kind !== 'edge' ? hit.id : null;
      pending = null;
    }

    function draw(now: number) {
      raf = 0;
      const ms = last ? Math.min(100, now - last) : 16.7; last = now;
      const a = api!.getAppState();
      const els = api!.getSceneElements() as unknown as El[];
      lookup(els, a);
      const z = a.zoom.value, sx = a.scrollX, sy = a.scrollY;
      const X = (x: number) => (x + sx) * z, Y = (y: number) => (y + sy) * z;

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.fillStyle = bg; ctx!.fillRect(0, 0, w, h);

      // a faint glow around the topic: the middle of the web is where it started
      const seed = els.find(e => e.id === 'seed' && !e.isDeleted);
      if (seed) {
        const cx = X(seed.x + seed.width / 2), cy = Y(seed.y + seed.height / 2), r = 1100 * z;
        const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(255,255,255,0.045)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx!.fillStyle = g; ctx!.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      }

      // dots, drifting slower than the cards
      ctx!.fillStyle = dotColour;
      const dot = Math.max(1.2, 1.6 * Math.sqrt(z));
      for (const p of dots({ scrollX: sx, scrollY: sy, zoom: z, width: w, height: h }, still ? 1 : PARALLAX)) ctx!.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot);

      // a soft region behind each collection
      for (const region of regionsOf(els)) {
        const outline = roundedOutline(convexHull(paddedCorners(region.rects)));
        if (!outline) continue;
        const hue = regionHue(region.index);
        ctx!.beginPath();
        ctx!.moveTo(X(outline.start.x), Y(outline.start.y));
        for (const [c, p] of outline.curves) ctx!.quadraticCurveTo(X(c.x), Y(c.y), X(p.x), Y(p.y));
        ctx!.closePath();
        ctx!.save();
        ctx!.shadowColor = `hsla(${hue},40%,65%,0.08)`; ctx!.shadowBlur = 46 * z * dpr;
        ctx!.fillStyle = `hsla(${hue},38%,62%,0.034)`; ctx!.fill();
        ctx!.restore();
        ctx!.strokeStyle = `hsla(${hue},38%,70%,0.06)`; ctx!.lineWidth = 1; ctx!.stroke();
      }

      // light under each card, deeper for the one you hover, select or drag
      const selected = new Set(Object.keys(a.selectedElementIds ?? {}));
      let moving = false;
      if (z >= 0.12) {
        for (const e of els) {
          if (e.isDeleted || e.type !== 'rectangle' || !cardKinds.has(e.customData?.kind)) continue;
          const target = still ? 0 : liftTarget({ hovered: hovered === e.id, dragging: !!(a as any).selectedElementsAreBeingDragged && selected.has(e.id), selected: selected.has(e.id) });
          const cur = lifts.get(e.id) ?? 0, next = still ? target : liftToward(cur, target, ms);
          if (next !== target) moving = true;
          if (next === 0) lifts.delete(e.id); else lifts.set(e.id, next);
          const glow = cardGlow(next), fade = (e.opacity ?? 100) / 100;
          if (fade <= 0) continue;
          ctx!.save();
          ctx!.shadowColor = `rgba(255,255,255,${glow.alpha * fade})`; ctx!.shadowBlur = glow.blur * z * dpr; ctx!.shadowOffsetY = glow.drop * z * dpr;
          ctx!.fillStyle = cardBg;
          ctx!.fillRect(X(e.x), Y(e.y), e.width * z, e.height * z);
          ctx!.restore();
        }
      }

      if (pattern) { ctx!.fillStyle = pattern; ctx!.fillRect(0, 0, w, h); }
      if (moving && !document.hidden) raf = requestAnimationFrame(draw);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(draw); }
    kick();
    return () => { off(); ro.disconnect(); host?.removeEventListener('pointermove', onMove, true); host?.removeEventListener('pointerleave', onLeave); cancelAnimationFrame(raf); raf = 0; };
  }, [api, hidden]);

  if (hidden) return null;
  return <canvas ref={canvas} className="backdrop" aria-hidden />;
}
