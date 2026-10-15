import { useEffect, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { typeColors } from './boxes';
import { coverAmount, lodItems, tierFor, type LodItem } from './lod';
import type { El } from './sceneEdit';

/** Draws the zoomed-out view of the cards (see lod.ts). Listens to the canvas itself so panning doesn't re-render the app. */
export function LodOverlay({ api, hidden }: { api: ExcalidrawImperativeAPI | null; hidden?: boolean }) {
  const [state, setState] = useState<{ items: LodItem[]; zoom: number }>({ items: [], zoom: 1 });
  const frame = useRef(0);
  useEffect(() => {
    if (!api) return;
    const update = () => {
      frame.current = 0;
      const a = api.getAppState();
      const next = lodItems(api.getSceneElements() as unknown as El[], { scrollX: a.scrollX, scrollY: a.scrollY, zoom: a.zoom.value, width: a.width, height: a.height }, new Set(Object.keys(a.selectedElementIds)));
      setState(prev => (prev.items.length === 0 && next.length === 0 && prev.zoom === a.zoom.value ? prev : { items: next, zoom: a.zoom.value }));
    };
    const off = api.onChange(() => { if (!frame.current) frame.current = requestAnimationFrame(update); });
    update();
    return () => { off(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [api]);

  if (hidden || !state.items.length) return null;
  const tier = tierFor(state.zoom), opacity = coverAmount(state.zoom);
  return (
    <div className="lod" style={{ opacity }} aria-hidden>
      {state.items.map(it => {
        const c = typeColors(it.type).bg;
        if (tier === 'dots') {
          const d = it.weight === 3 ? 14 : it.weight === 2 ? 10 : 7;
          return (
            <span key={it.id} className="lod-cover" style={{ left: it.x, top: it.y, width: it.w, height: it.h }}>
              <span className="lod-dot" style={{ left: it.w / 2 - d / 2, top: it.h / 2 - d / 2, width: d, height: d, background: c }} />
              {it.weight === 3 && <i style={{ fontSize: it.fontPx }}>{it.title}</i>}
            </span>
          );
        }
        return (
          <div key={it.id} className="lod-card" style={{ left: it.x, top: it.y, width: it.w, height: it.h }}>
            <span className="lod-bar" style={{ background: c }} />
            <span className={`lod-title w${it.weight}`} style={{ fontSize: it.fontPx }}>{it.title}</span>
          </div>
        );
      })}
    </div>
  );
}
