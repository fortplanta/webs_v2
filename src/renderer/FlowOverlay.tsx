import { useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { edgeLength, flowEdges, MAX_EDGES, MIN_ZOOM, obstacles, pulseAt, pulsePath, STILL_PULSE, type FlowEdge, type Pulse, type Rect } from './flow';
import type { El } from './sceneEdit';

const cssColor = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Shows which way each connection runs: a faint brightening that travels along the line from its origin to its target
 * (see flow.ts). It is painted on a canvas laid over Excalidraw, behind cards and labels, ignoring the pointer. It
 * stops when the window is hidden, when zoomed far out, and (as a still highlight) for people who prefer reduced motion.
 */
export function FlowOverlay({ api, hidden }: { api: ExcalidrawImperativeAPI | null; hidden?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!api || !el || hidden) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let edges: FlowEdge[] = [], blocks: Rect[] = [], dirty = true, raf = 0, w = 0, h = 0, dpr = 1;
    const colour = cssColor('--color-flow-pulse', '#FFFFFF');

    const size = () => {
      const r = el.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = r.width; h = r.height;
      el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
      dirty = true;
    };
    const off = api.onChange(() => { dirty = true; if (still && !raf) raf = requestAnimationFrame(draw); });
    const ro = new ResizeObserver(() => { size(); if (!raf) raf = requestAnimationFrame(draw); });
    ro.observe(el);
    size();

    function draw(now: number) {
      raf = 0;
      const a = api!.getAppState();
      if (dirty) { const els = api!.getSceneElements() as unknown as El[]; edges = flowEdges(els); blocks = obstacles(els); dirty = false; }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      const z = a.zoom.value;
      const tx = (x: number) => (x + a.scrollX) * z, ty = (y: number) => (y + a.scrollY) * z;

      const visible = z < MIN_ZOOM ? [] : edges.filter(e => Math.max(tx(e.x1), tx(e.x2)) > 0 && Math.min(tx(e.x1), tx(e.x2)) < w && Math.max(ty(e.y1), ty(e.y2)) > 0 && Math.min(ty(e.y1), ty(e.y2)) < h);
      if (visible.length && visible.length <= MAX_EDGES) {
        // pulses pass behind cards and the labels on lines: clip those out (everything except the rectangles)
        ctx!.save();
        ctx!.beginPath();
        ctx!.rect(0, 0, w, h);
        for (const b of blocks) ctx!.rect(tx(b.x), ty(b.y), b.width * z, b.height * z);
        ctx!.clip('evenodd');
        ctx!.lineCap = 'round';
        const seconds = now / 1000;
        for (const e of visible) {
          const p: Pulse | null = still ? STILL_PULSE : pulseAt(e, seconds, edgeLength(e) * z);
          if (!p || p.alpha < 0.01) continue;
          const seg = pulsePath(e, p);
          if (seg.length < 2) continue;
          const sx = tx(seg[0][0]), sy = ty(seg[0][1]), ex = tx(seg[seg.length - 1][0]), ey = ty(seg[seg.length - 1][1]);
          // brightest at the head, fading to nothing behind it
          const g = ctx!.createLinearGradient(sx, sy, ex, ey);
          g.addColorStop(0, withAlpha(colour, 0)); g.addColorStop(1, withAlpha(colour, p.alpha));
          ctx!.strokeStyle = g;
          ctx!.lineWidth = Math.max(1, e.width * z);
          ctx!.beginPath(); ctx!.moveTo(sx, sy); for (let i = 1; i < seg.length; i++) ctx!.lineTo(tx(seg[i][0]), ty(seg[i][1])); ctx!.stroke();
        }
        ctx!.restore();
      }
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    }
    const onVisible = () => { if (!document.hidden && !raf) raf = requestAnimationFrame(draw); };
    document.addEventListener('visibilitychange', onVisible);
    raf = requestAnimationFrame(draw);
    return () => { off(); ro.disconnect(); document.removeEventListener('visibilitychange', onVisible); cancelAnimationFrame(raf); };
  }, [api, hidden]);

  if (hidden) return null;
  return <canvas ref={canvas} className="flow" aria-hidden />;
}

/** "#rrggbb" or "rgb(...)" with an alpha. */
function withAlpha(colour: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  if (m) { const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`; }
  const rgb = /rgba?\(([^)]+)\)/.exec(colour);
  return rgb ? `rgba(${rgb[1].split(',').slice(0, 3).join(',')},${alpha})` : `rgba(255,255,255,${alpha})`;
}
