// How a fragment card looks on the canvas (the "Neuros" design): a near-black card with a bright title, quiet body text
// and a dim footer line saying where it came from. Excalidraw can only give one style per text element, so a card is
// three things grouped together — the box (its bound label is the body), a title text and a footer text — and every
// path that creates or edits a card goes through addCard/updateCard so they stay in step.

import type { GeneratedFragment } from '../backend/events';
import { clip, FRAG_H, FRAG_W, GROUNDING_WARN, hostLabel, originStroke, wrap, type LabelSpec } from './boxes';
import { addBox, updateBox, type Build, type El, type NewBox } from './sceneEdit';
import { cssVar } from './theme';

export const CARD_PAD = 12;
const TITLE_TOP = 10;
const FOOT_FROM_BOTTOM = 26;
const BODY_CHARS = 48;

export const groupFor = (cardId: string) => `grp-${cardId}`;
export const titleId = (cardId: string) => `${cardId}-title`;
export const footId = (cardId: string) => `${cardId}-foot`;

const baseName = (p: string) => p.split('/').pop() ?? p;

/** "CONCEPT · stoicism.md": what it is and where it came from. */
export function cardFooter(f: GeneratedFragment): string {
  const kind = f.type.toUpperCase();
  let source = '';
  if (f.origin === 'wiki') {
    source = f.grounding !== undefined && f.grounding < GROUNDING_WARN ? '⚠ goes beyond the article' : `W ${f.sourceLabel ?? 'Wikipedia'}`;
  } else if (f.origin === 'ai') {
    source = `✦ AI${f.aiModel ? ` · ${clip(f.aiModel, 18)}` : ''} — not from your notes`;
  } else if (f.kbSources?.length) {
    source = f.grounding !== undefined && f.grounding < GROUNDING_WARN ? '⚠ goes beyond your KB' : `▤ ${baseName(f.kbSources[0])}`;
  }
  if (f.link && f.origin !== 'wiki') source = [source, `↗ ${hostLabel(f.link)}`].filter(Boolean).join(' · ');
  return clip([kind, source].filter(Boolean).join(' · '), 52);
}

export interface CardLook {
  backgroundColor: string;
  stroke: { strokeColor: string; strokeStyle?: string; strokeWidth: number };
  /** Bound to the box. Starts with blank lines so the title (a separate text) has room above it. */
  body: LabelSpec;
  title: { text: string; fontSize: number; fontFamily: number; strokeColor: string };
  foot: { text: string; fontSize: number; fontFamily: number; strokeColor: string };
}

export function cardLook(f: GeneratedFragment): CardLook {
  const body = f.type === 'quote' ? f.body : clip(f.body, 150);
  const parts = [wrap(body, BODY_CHARS)];
  if (f.bridge) parts.push(wrap(`↳ ${clip(f.bridge, 90)}`, BODY_CHARS));
  return {
    backgroundColor: cssVar('--color-card-bg', '#101010'),
    stroke: originStroke(f.origin) ?? { strokeColor: cssVar('--color-card-border', '#1B1B1B'), strokeWidth: 1 },
    body: { text: `\n\n${parts.join('\n\n')}`, fontSize: 12, strokeColor: cssVar('--color-card-body', '#8C8C8C'), fontFamily: 8, textAlign: 'left', verticalAlign: 'top' },
    title: { text: clip(f.title, 34), fontSize: 14, fontFamily: 6, strokeColor: cssVar('--color-card-title', '#C4C4C4') },
    foot: { text: cardFooter(f), fontSize: 10, fontFamily: 2, strokeColor: cssVar('--color-card-foot', '#5B5B60') },
  };
}

type Box = { x: number; y: number; width: number; height: number };

/** Skeletons for the two free texts of a card at `box` (the layout builds these along with the box). */
export function cardTextSkeletons(cardId: string, box: Box, look: CardLook): Array<Record<string, unknown>> {
  const group = [groupFor(cardId)];
  return [
    { type: 'text', id: titleId(cardId), x: box.x + CARD_PAD, y: box.y + TITLE_TOP, ...look.title, groupIds: group, customData: { card: cardId, role: 'title' } },
    { type: 'text', id: footId(cardId), x: box.x + CARD_PAD, y: box.y + box.height - FOOT_FROM_BOTTOM, ...look.foot, groupIds: group, customData: { card: cardId, role: 'foot' } },
  ];
}

const bump = (e: El): El => ({ ...e, version: (e.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() });

/** Make the card, its label and its two texts one group, creating or refreshing the texts. */
export function syncCardTexts(elements: El[], cardId: string, f: GeneratedFragment, build: Build): El[] {
  const card = elements.find(e => e.id === cardId && !e.isDeleted);
  if (!card) return elements;
  const look = cardLook(f);
  const group = groupFor(cardId);
  const made = build(cardTextSkeletons(cardId, card as unknown as Box, look));
  let out = elements.map(e => {
    if (e.id === cardId || (e.type === 'text' && e.containerId === cardId)) return bump({ ...e, groupIds: [group] });
    return e;
  });
  for (const t of made) {
    const next = { ...t, groupIds: [group], customData: { card: cardId, role: t.id === titleId(cardId) ? 'title' : 'foot' } };
    const i = out.findIndex(e => e.id === t.id);
    if (i >= 0) out[i] = bump({ ...next, version: out[i].version, isDeleted: false });
    else out = [...out, next];
  }
  return out;
}

export interface NewCard extends Omit<NewBox, 'backgroundColor' | 'label' | 'width' | 'height'> {
  fragment: GeneratedFragment;
  width?: number;
  height?: number;
}

export function addCard(elements: El[], card: NewCard, build: Build): El[] {
  const look = cardLook(card.fragment);
  const { fragment, ...rest } = card;
  let out = addBox(elements, { width: FRAG_W, height: FRAG_H, ...rest, backgroundColor: look.backgroundColor, label: look.body, link: fragment.link }, build);
  out = out.map(e => (e.id === card.id ? { ...e, ...look.stroke } : e));
  return syncCardTexts(out, card.id, fragment, build);
}

/** Re-render a card after its fragment changed (editor, or the model's text replacing an excerpt). */
export function updateCard(elements: El[], id: string, fragment: GeneratedFragment, extraData: Record<string, unknown>, build: Build): El[] {
  const look = cardLook(fragment);
  let out = updateBox(elements, id, { backgroundColor: look.backgroundColor, customData: { ...extraData, fragment }, link: fragment.link ?? null, label: look.body }, build);
  out = out.map(e => (e.id === id ? bump({ ...e, ...look.stroke }) : e));
  return syncCardTexts(out, id, fragment, build);
}
