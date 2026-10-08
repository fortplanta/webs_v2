import { useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { buildSkeletons } from './layout';
import { convertWithStableIds, mergeScene } from './sceneMerge';
import type { WebModel } from './webModel';

export function CanvasView({ model }: { model: WebModel }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const applied = useRef(new Map<string, string>());
  const framed = useRef({ kb: false, overview: false });

  useEffect(() => {
    if (!api) return;
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
  }, [api, model]);

  return (
    <div className="canvas">
      <Excalidraw excalidrawAPI={setApi} initialData={{ appState: { viewBackgroundColor: '#f8f8f8' } }} />
    </div>
  );
}
