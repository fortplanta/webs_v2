// Keeps the canvas alive while the user works. Nodes the user is holding (dragging, resizing, rotating, drawing) stay exactly
// where the pointer puts them; everything else eases out of the way on springs and settles, the dragged card's neighbours lean
// toward it and ease back, curved connections follow their boxes, and new cards fly in from what they grew from (see frame.ts,
// which does the work of each frame). The loop runs only while something is moving.
//
// Automatic moves are not undoable (they'd double the undo stack for every drag) — undo reverts the user's own move
// and the layout simply re-resolves.

import { useEffect, useRef } from 'react';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { applyOpacity, opacityNow, stageArrivals } from '../arrival';
import { motionFrame, newMotionState } from './frame';

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
  /**
   * Call with the scene as it is and the scene about to replace it: new cards are set at their starting points, invisible, and
   * fly in from there. Returns the scene to show. Unchanged for people who prefer reduced motion.
   */
  stage(prev: readonly El[], next: El[]): El[];
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useLiveLayout(api: ExcalidrawImperativeAPI | null, enabled: boolean): LiveLayout {
  const raf = useRef(0);
  const live = useRef({ api, enabled });
  live.current = { api, enabled };
  const state = useRef(newMotionState());

  const tick = useRef((_now: number) => {});
  tick.current = (now: number) => {
    raf.current = 0;
    const { api: a, enabled: on } = live.current;
    if (!a) return;
    const elements = a.getSceneElementsIncludingDeleted() as unknown as El[];
    const r = motionFrame(elements, heldIds(a.getAppState() as any), state.current, now, on);
    state.current = r.state;
    if (r.elements !== elements) a.updateScene({ elements: r.elements as any, captureUpdate: CaptureUpdateAction.NEVER });
    if (r.active) raf.current = requestAnimationFrame(t => tick.current(t)); // more to do: next frame (else the next change pokes us again)
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const poke = useRef(() => { if (!raf.current) raf.current = requestAnimationFrame(t => tick.current(t)); });
  const stage = useRef((prev: readonly El[], next: El[]): El[] => {
    if (reduced()) return next;
    const now = performance.now();
    const { elements, arrivals } = stageArrivals(prev, next, now);
    // an arrival still in flight that the update replaced (a ghost slot filled in) keeps its look and place
    const inFlight = state.current.arrivals;
    state.current = { ...state.current, arrivals: [...inFlight, ...arrivals] };
    poke.current();
    return inFlight.length ? applyOpacity(elements, opacityNow(inFlight, now)) : elements;
  });
  return { poke: poke.current, stage: stage.current };
}
