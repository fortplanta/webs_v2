import { useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { ARRIVE_MS, arrivalHalo, breath, DONE_MS, doneRing } from './fx';
import { sound } from './sound';
import type { El } from './sceneEdit';

type Rect = { x: number; y: number; w: number; h: number };
const cardKinds = new Set(['fragment', 'image-card']);

/**
 * Faint life on the canvas, painted over it and ignoring the pointer: a glint and halo where a card arrives, the origin
 * breathing while a web is written, and one wide ring when it finishes (with the matching sounds). Nothing here changes
 * the scene. With reduced motion there is no movement, only the sounds.
 */
export function FxOverlay({ api, phase, hidden }: { api: ExcalidrawImperativeAPI | null; phase: 'running' | 'done' | 'error' | 'cancelled'; hidden?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  const prevPhase = useRef(phase);
  const doneAt = useRef(0);
  const wake = useRef<() => void>(() => undefined);
  phaseRef.current = phase;

  // a web finishing or failing
  useEffect(() => {
    if (prevPhase.current === 'running' && phase === 'done') { doneAt.current = performance.now(); sound.play('done'); }
    if (prevPhase.current === 'running' && phase === 'error') sound.play('error');
    prevPhase.current = phase;
    wake.current();
  }, [phase]);

  useEffect(() => {
    const el = canvas.current;
    if (!api || !el || hidden) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const known = new Set<string>();
    let primed = false;
    const arrivals = new Map<string, number>();
    let raf = 0, w = 0, h = 0, dpr = 1, lastArrival = 0;

    const size = () => { const r = el.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; w = r.width; h = r.height; el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); };
    const ro = new ResizeObserver(() => { size(); kick(); });
    ro.observe(el);
    size();

    const rectOf = (e: El, a: ReturnType<typeof api.getAppState>): Rect => ({ x: (e.x + a.scrollX) * a.zoom.value, y: (e.y + a.scrollY) * a.zoom.value, w: e.width * a.zoom.value, h: e.height * a.zoom.value });

    const off = api.onChange(elements => {
      let fresh = 0;
      const now = performance.now();
      for (const e of elements as unknown as El[]) {
        if (e.isDeleted || e.type !== 'rectangle' || !cardKinds.has(e.customData?.kind)) continue;
        if (!known.has(e.id)) { known.add(e.id); if (primed) { arrivals.set(e.id, now); fresh++; } }
      }
      // the first change is the scene as it was opened: nothing in it has "arrived"
      if (!primed && elements.length) primed = true;
      if (fresh && now - lastArrival > 100) { lastArrival = now; sound.play('arrive'); }
      if (fresh) kick();
    });

    function halo(r: Rect, grow: number, alpha: number, glint: number) {
      const pad = grow;
      if (glint > 0.001) { ctx!.fillStyle = `rgba(255,255,255,${glint})`; ctx!.fillRect(r.x, r.y, r.w, r.h); }
      ctx!.strokeStyle = `rgba(255,255,255,${alpha})`; ctx!.lineWidth = 1.5;
      ctx!.strokeRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad);
    }

    function draw(now: number) {
      raf = 0;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w, h);
      const a = api!.getAppState();
      const els = api!.getSceneElements() as unknown as El[];
      let busy = false;
      if (!still) {
        for (const [id, t0] of arrivals) {
          const hl = arrivalHalo(now - t0);
          if (!hl) { arrivals.delete(id); continue; }
          const e = els.find(x => x.id === id && !x.isDeleted);
          if (e) halo(rectOf(e, a), hl.grow * a.zoom.value, hl.alpha, hl.glint);
          busy = true;
        }
        const seed = els.find(x => x.id === 'seed' && !x.isDeleted);
        if (seed) {
          const r = rectOf(seed, a);
          if (phaseRef.current === 'running') {
            const b = breath(now / 1000);
            halo(r, b.grow * a.zoom.value, b.inner, 0); halo(r, b.grow * 2.2 * a.zoom.value, b.outer, 0);
            busy = true;
          }
          const ring = doneRing(now - doneAt.current);
          if (ring) { halo(r, ring.grow * a.zoom.value, ring.alpha, 0); busy = true; }
        }
      }
      if (busy && !document.hidden) raf = requestAnimationFrame(draw);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(draw); }
    wake.current = kick;
    kick();
    return () => { off(); ro.disconnect(); cancelAnimationFrame(raf); raf = 0; wake.current = () => undefined; };
  }, [api, hidden]);

  if (hidden) return null;
  return <canvas ref={canvas} className="fx" aria-hidden />;
}
