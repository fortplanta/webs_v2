// A link the user draws between two cards, and how the model's verdict shows on it: a lateral leap is brighter and
// heavier, a well-known link plain, a stretch dashed. Pure helpers over the scene (builders injected), so they can be tested.

import type { ConnectionVerdict } from '../backend/events';
import { addThread } from './pivot';
import type { Build, El } from './sceneEdit';
import { cssVar } from './theme';

export const LINK_KIND = 'link';

export const linkId = (a: string, b: string) => `link-${a}-${b}`;

/** The look for a verdict (kept separate so the editor and tests can read it). */
export function linkLook(v: Pick<ConnectionVerdict, 'link' | 'tier'>) {
  return {
    strokeColor: v.tier === 'lateral' ? cssVar('--color-card-title-hi', '#F2F2F2') : cssVar('--color-relation-stroke', '#9A9A9A'),
    strokeWidth: v.tier === 'lateral' ? 2 : 1,
    strokeStyle: v.link === 'solid' ? 'solid' : 'dashed',
    opacity: v.link === 'none' ? 45 : 90,
  };
}

/** True if two cards are already joined by a live link (either way round). */
export const hasLink = (elements: readonly El[], a: string, b: string) =>
  elements.some(e => !e.isDeleted && e.type === 'arrow' && e.customData?.kind === LINK_KIND && ((e.startBinding?.elementId === a && e.endBinding?.elementId === b) || (e.startBinding?.elementId === b && e.endBinding?.elementId === a)));

export function addLink(elements: El[], spec: { from: string; to: string; verdict: ConnectionVerdict; by: 'user' | 'model'; explanation?: string }, build: Build, makeArrow: (raw: El) => El): { elements: El[]; id: string } {
  const id = linkId(spec.from, spec.to);
  const base = elements.filter(e => e.id !== id && e.containerId !== id); // a soft-deleted link between the same cards would clash
  const out = addThread(base, {
    id, fromId: spec.from, toId: spec.to, label: spec.verdict.verb, look: linkLook(spec.verdict),
    customData: { kind: LINK_KIND, by: spec.by, tier: spec.verdict.tier, link: spec.verdict.link, note: spec.verdict.note, ...(spec.explanation ? { explanation: spec.explanation } : {}) },
  }, build, makeArrow);
  return { elements: out, id };
}
