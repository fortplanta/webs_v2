// Growing the web from a point: where a new card goes, and what a pivot from a connection is seeded with. Pure over
// scene elements, so it can be tested.

import type { GeneratedFragment } from '../backend/events';
import { findClusterSpot, type Pt } from './layout/organic';
import { originCenter } from './origin';
import type { El } from './sceneEdit';
import { findFreeSpot } from './sceneEdit';

const centre = (e: El): Pt => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });

/** What an element hangs off (its tether anchor), or the origin: the point growth from it runs away from. */
export function growthFrom(elements: readonly El[], id: string): Pt | undefined {
  const tether = elements.find(e => !e.isDeleted && e.type === 'arrow' && e.customData?.kind === 'tether' && e.endBinding?.elementId === id);
  const anchor = tether ? elements.find(e => !e.isDeleted && e.id === tether.startBinding?.elementId) : undefined;
  return anchor ? centre(anchor) : originCenter(elements) ?? undefined;
}

/** Top-left for a new card (size w × h) growing out of `sourceId`: on along the way the source itself grew, clear of everything. */
export function branchSpot(elements: readonly El[], sourceId: string, w: number, h: number): Pt | null {
  const live = elements.filter(e => !e.isDeleted && e.type !== 'text' && e.type !== 'arrow' && e.type !== 'line');
  const source = live.find(e => e.id === sourceId);
  if (!source) return null;
  const box = (e: El) => ({ x: e.x, y: e.y, width: e.width, height: e.height });
  const { header } = findClusterSpot(live.map(box), box(source), 1, growthFrom(elements, sourceId));
  return findFreeSpot([...elements], { x: header.x - w / 2, y: header.y - h / 2 }, w, h);
}

/** An element described as a card, for seeding a pivot: a card as it is, a header by its title, the origin by the question. */
function describe(e: El, query: string, context: string): GeneratedFragment {
  const d = e.customData ?? {};
  if (e.id === 'seed') return { type: 'concept', title: query, body: context };
  if (d.kind === 'fragment' && d.fragment) return d.fragment;
  return { type: 'concept', title: String(d.title ?? d.caption ?? 'this'), body: '' };
}

/**
 * Pivot "from a connection": the new angle grows on past the connection's target, seeded with what the line says,
 * both ends and its label ("glass canon → contested by → critics"). Returns the element to grow from and the seed.
 */
export function connectionSeed(elements: readonly El[], arrowId: string, query: string, context: string): { target: El; card: GeneratedFragment } | null {
  const arrow = elements.find(e => e.id === arrowId && !e.isDeleted && e.type === 'arrow');
  if (!arrow) return null;
  const from = elements.find(e => e.id === arrow.startBinding?.elementId && !e.isDeleted), to = elements.find(e => e.id === arrow.endBinding?.elementId && !e.isDeleted);
  if (!from || !to) return null;
  const label = elements.find(e => e.type === 'text' && e.containerId === arrow.id && !e.isDeleted)?.text ?? '';
  const a = describe(from, query, context), b = describe(to, query, context);
  return { target: to, card: { type: 'concept', title: [a.title, label, b.title].filter(Boolean).join(' · '), body: [a.body, b.body].filter(Boolean).join('\n\n') } };
}
