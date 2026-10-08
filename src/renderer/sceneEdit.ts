// Pure scene edits for manual editing. They take a `build` function (skeletons → elements) so the
// logic is testable without Excalidraw's canvas-based measurement.

import type { WebModel } from '../types/web';
import { clusterLabel, fragmentLook, type BoxData, type LabelSpec } from './boxes';

export type El = Record<string, any>;
export type Build = (skeletons: unknown[]) => El[];

const bump = (el: El): El => ({ ...el, version: (el.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });
const labelIdFor = (id: string) => `${id}-label`;
const live = (e: El) => !e.isDeleted;

function labelOf(elements: El[], containerId: string): El | undefined {
  return elements.find(e => e.type === 'text' && e.containerId === containerId && live(e));
}

function buildLabel(geometry: { x: number; y: number; width: number; height: number }, spec: LabelSpec, build: Build, id: string, prev?: El): El {
  // Lay the label out inside a throwaway box with the target geometry, then adopt the text element.
  const tmp = build([{ type: 'rectangle', id: '__tmp', ...geometry, label: spec }]);
  const text = tmp.find(e => e.type === 'text');
  if (!text) throw new Error('Could not lay out label');
  return bump({ ...text, id, containerId: (prev?.containerId ?? undefined) as any, version: prev?.version ?? 0 });
}

export interface BoxPatch {
  backgroundColor?: string;
  customData?: unknown;
  /** undefined = leave the label; null = remove it. */
  label?: LabelSpec | null;
  /** Where to lay the label out (defaults to the box itself). */
  geometry?: { x: number; y: number; width: number; height: number };
}

export function updateBox(elements: El[], id: string, patch: BoxPatch, build: Build): El[] {
  const idx = elements.findIndex(e => e.id === id && live(e));
  if (idx < 0) return elements;
  const box = elements[idx];
  const out = [...elements];
  let bound: El[] = (box.boundElements ?? []).filter((b: El) => b.type !== 'text');
  const old = labelOf(elements, id);
  if (old) bound = [...bound, { type: 'text', id: old.id }];

  if (patch.label === null && old) {
    out[out.indexOf(old)] = bump({ ...old, isDeleted: true });
    bound = bound.filter(b => b.id !== old.id);
  } else if (patch.label) {
    const newId = old?.id ?? labelIdFor(id);
    const next = { ...buildLabel(patch.geometry ?? box as any, patch.label, build, newId, old), containerId: id };
    if (old) out[out.indexOf(old)] = next; else out.push(next);
    if (!bound.some(b => b.id === newId)) bound.push({ type: 'text', id: newId });
  }

  const nextBox = { ...box, boundElements: bound.length ? bound : null } as El;
  if (patch.backgroundColor !== undefined) nextBox.backgroundColor = patch.backgroundColor;
  if (patch.customData !== undefined) nextBox.customData = patch.customData;
  out[idx] = bump(nextBox);
  return out;
}

export interface NewBox {
  id: string;
  x: number; y: number; width: number; height: number;
  backgroundColor: string;
  customData: BoxData;
  label: LabelSpec;
}

export function addBox(elements: El[], box: NewBox, build: Build): El[] {
  const made = build([{
    type: 'rectangle', id: box.id, x: box.x, y: box.y, width: box.width, height: box.height,
    strokeColor: 'transparent', backgroundColor: box.backgroundColor, fillStyle: 'solid', roundness: null,
    customData: box.customData, label: box.label,
  }]);
  const fixed = made.map(e => (e.type === 'text' && e.containerId === box.id ? { ...e, id: labelIdFor(box.id) } : e))
    .map(e => (e.id === box.id ? { ...e, customData: box.customData, boundElements: (e.boundElements ?? []).map((b: El) => (b.type === 'text' ? { ...b, id: labelIdFor(box.id) } : b)) } : e));
  return [...elements, ...fixed];
}

/** Soft-delete a box/arrow with its label, and clear anything that pointed at it. */
export function removeBox(elements: El[], id: string): El[] {
  const gone = new Set([id, ...elements.filter(e => e.type === 'text' && e.containerId === id).map(e => e.id)]);
  return elements.map(e => {
    if (gone.has(e.id)) return bump({ ...e, isDeleted: true });
    let next = e;
    if (e.startBinding && gone.has(e.startBinding.elementId)) next = { ...next, startBinding: null };
    if (e.endBinding && gone.has(e.endBinding.elementId)) next = { ...next, endBinding: null };
    if (e.boundElements?.some((b: El) => gone.has(b.id))) next = { ...next, boundElements: e.boundElements.filter((b: El) => !gone.has(b.id)) };
    return next === e ? e : bump(next);
  });
}

/** Box a label should be centered in for a straight arrow. */
export function arrowCenterBox(arrow: El): { x: number; y: number; width: number; height: number } {
  const pts: number[][] = arrow.points ?? [[0, 0]];
  const xs = pts.map(p => arrow.x + p[0]), ys = pts.map(p => arrow.y + p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(Math.max(...xs) - Math.min(...xs), 40), height = Math.max(Math.max(...ys) - Math.min(...ys), 20);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** First position at or diagonally below `at` where a w×h box overlaps no existing box (or `at` if the canvas is packed). */
export function findFreeSpot(elements: El[], at: { x: number; y: number }, w: number, h: number, step = 48, tries = 40): { x: number; y: number } {
  const boxes = elements.filter(e => !e.isDeleted && e.type === 'rectangle');
  const clear = (x: number, y: number) => boxes.every(b => x + w <= b.x || b.x + b.width <= x || y + h <= b.y || b.y + b.height <= y);
  for (let i = 0; i < tries; i++) {
    const x = at.x + i * step, y = at.y + i * step;
    if (clear(x, y)) return { x, y };
  }
  return at;
}

/** Older saved scenes lack customData; rebuild it from the saved model so they become editable. */
export function hydrateScene(scene: El[], model: WebModel): El[] {
  const data = new Map<string, BoxData>();
  model.clusters.forEach((c, ci) => {
    data.set(`cluster-${ci}`, { kind: 'cluster', index: ci, title: c.title });
    c.slots.forEach((f, fi) => { if (f) data.set(`frag-${ci}-${fi}`, { kind: 'fragment', cluster: ci, slot: fi, fragment: f }); });
  });
  return scene.map(e => (data.has(e.id) && !e.customData?.kind ? { ...e, customData: data.get(e.id) } : e));
}

export { fragmentLook, clusterLabel };
