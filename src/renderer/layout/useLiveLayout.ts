// Keeps the canvas free of overlaps while the user works. Nodes the user is holding (dragging, resizing, rotating,
// drawing) stay exactly where the pointer puts them; everything else glides out of the way a little each frame and
// stays where it was pushed. When the user lets go the same loop carries on until nothing is left to resolve.
//
// Automatic moves are not undoable (they'd double the undo stack for every drag) — undo reverts the user's own move
// and the layout simply re-resolves.

import { useEffect, useRef } from 'react';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { defaultEngineConfig, step } from './engine';
import { applyMoves, buildNodes } from './sceneNodes';

type El = Record<string, any>;

/** Ids the user is currently manipulating, which the layout must not move. */
export function heldIds(app: Record<string, any>): Set<string> {
  const held = new Set<string>();
  const interacting = app.selectedElementsAreBeingDragged || app.isResizing || app.isRotating;
  if (interacting) for (const id of Object.keys(app.selectedElementIds ?? {})) held.add(id);
  if (app.newElement) held.add(app.newElement.id);
  if (app.editingTextElement) held.add(app.editingTextElement.id);
  return held;
}

export interface LiveLayout {
  /** Call from Excalidraw's onChange. */
  poke(): void;
}

export function useLiveLayout(api: ExcalidrawImperativeAPI | null, enabled: boolean): LiveLayout {
  const raf = useRef(0);
  const live = useRef({ api, enabled });
  live.current = { api, enabled };

  const tick = useRef(() => {});
  tick.current = () => {
    raf.current = 0;
    const { api: a, enabled: on } = live.current;
    if (!a || !on) return;
    const elements = a.getSceneElementsIncludingDeleted() as unknown as El[];
    const { nodes, tethers, members } = buildNodes(elements, heldIds(a.getAppState() as any));
    const r = step(nodes, tethers, defaultEngineConfig);
    if (r.maxMove === 0) return; // at rest: stop looping (the next change pokes us again)
    a.updateScene({ elements: applyMoves(elements, r.moves, members) as any, captureUpdate: CaptureUpdateAction.NEVER });
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const poke = useRef(() => {
    if (!raf.current) raf.current = requestAnimationFrame(() => tick.current());
  });
  return { poke: poke.current };
}
