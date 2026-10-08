import { useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { buildSkeletons } from './layout';
import { convertWithStableIds, mergeScene } from './sceneMerge';
import type { WebModel } from './webModel';

interface Props {
  model: WebModel;
  /** A saved scene to show exactly as stored. When set, the canvas is not rebuilt from `model`. */
  restoredScene?: unknown[];
  /** Called (debounced) when the user's scene actually changes. */
  onSceneChange?: (elements: unknown[]) => void;
}

const SAVE_DEBOUNCE_MS = 800;

export function CanvasView({ model, restoredScene, onSceneChange }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const applied = useRef(new Map<string, string>());
  const framed = useRef({ kb: false, overview: false });
  const lastHash = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const restored = restoredScene !== undefined;

  useEffect(() => {
    if (!api || restored) return;
    const next = convertWithStableIds(buildSkeletons(model));
    const { elements, signatures } = mergeScene(api.getSceneElements() as any, next, applied.current);
    applied.current = signatures;
    api.updateScene({ elements: elements as any });

    // Re-frame once when the first content lands and once when the outline defines the layout.
    const stage = model.clusters.length > 0 ? 'overview' : 'kb';
    if (!framed.current[stage]) {
      framed.current[stage] = true;
      requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: true }));
    }
  }, [api, model, restored]);

  // A reopened web is shown as stored; just fit it to the viewport once.
  useEffect(() => {
    if (!api || !restored) return;
    requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 }));
  }, [api, restored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleChange(elements: readonly { id: string; version: number }[]) {
    if (!onSceneChange || elements.length === 0) return;
    // Pan/zoom/selection also fire onChange; only persist when an element actually changed.
    const hash = elements.map(e => `${e.id}:${e.version}`).join(',');
    if (lastHash.current === null) { lastHash.current = hash; if (restored) return; }
    if (hash === lastHash.current) return;
    lastHash.current = hash;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSceneChange(api ? (api.getSceneElementsIncludingDeleted() as unknown[]) : [...elements]), SAVE_DEBOUNCE_MS);
  }

  return (
    <div className="canvas">
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={handleChange as any}
        initialData={{
          elements: restored ? (restoredScene as any) : undefined,
          appState: { viewBackgroundColor: '#f8f8f8' },
        }}
      />
    </div>
  );
}
