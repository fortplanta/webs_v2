// Drives the camera (camera.ts) on Excalidraw: glide to a target view, stop the moment the user takes the view themselves.

import { useEffect, useRef } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { aim, type Cam, reaim, stepCam, type Target, type View } from '../camera';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface Camera {
  /** Glide to a view (or jump, for people who prefer reduced motion). */
  glideTo(target: Target): void;
  /** The user took hold of the view (scroll, drag, zoom): let go of it. */
  release(): void;
  /** The view as it is right now. */
  view(): View | null;
}

export function useCamera(api: ExcalidrawImperativeAPI | null): Camera {
  const live = useRef(api);
  live.current = api;
  const raf = useRef(0), cam = useRef<Cam | null>(null), last = useRef(0);

  const read = (): View | null => {
    const a = live.current?.getAppState();
    return a ? { scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom.value, width: a.width, height: a.height } : null;
  };
  const write = (t: Target) => live.current?.updateScene({ appState: { scrollX: t.scrollX, scrollY: t.scrollY, zoom: { value: t.zoom } } as any });

  const frame = useRef((now: number) => {
    raf.current = 0;
    const v = read();
    if (!v || !cam.current) return;
    const dt = last.current ? Math.min(3, Math.max(0.5, (now - last.current) / (1000 / 60))) : 1;
    last.current = now;
    const r = stepCam(cam.current, v, dt);
    cam.current = r.cam;
    write(r.view);
    if (r.cam) raf.current = requestAnimationFrame(t => frame.current(t)); else last.current = 0;
  });

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const api2 = useRef<Camera>({
    glideTo(target) {
      const v = read();
      if (!v) return;
      if (reduced()) { write(target); return; }
      cam.current = cam.current ? reaim(cam.current, v, target) : aim(v, target);
      if (!raf.current) raf.current = requestAnimationFrame(t => frame.current(t));
    },
    release() { cam.current = null; last.current = 0; cancelAnimationFrame(raf.current); raf.current = 0; },
    view: read,
  });
  return api2.current;
}
