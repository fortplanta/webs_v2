// How a fragment card looks on the canvas (the "Neuros" design): a near-black card with a bright title, quiet body text
// and a dim footer line saying where it came from. Excalidraw can only give one style per text element, so a card is
// three things grouped together — the box (its bound label is the body), a title text and a footer text — and every
// path that creates or edits a card goes through addCard/updateCard so they stay in step.

import type { GeneratedFragment } from '../backend/events';
import { clip, FRAG_H, GROUNDING_WARN, hostLabel, typeColors, wrap, wrapParagraphs, type LabelSpec } from './boxes';
import { addBox, updateBox, type Build, type El, type NewBox } from './sceneEdit';
import { cssVar } from './theme';

export const CARD_PAD = 12;
const TITLE_TOP = 10;
const FOOT_FROM_BOTTOM = 26;
const FOOT_AREA = 34;

/** How much a card matters to the story sets its size and brightness: the heart of it is wide and bright, supporting detail smaller and quieter. */
const WEIGHTS = {
  1: { width: 250, title: 13, body: 11, titleColor: ['--color-card-title-lo', '#8C8C8C'], bodyColor: ['--color-card-body-lo', '#5F5F5F'] },
  2: { width: 290, title: 14, body: 12, titleColor: ['--color-card-title', '#C4C4C4'], bodyColor: ['--color-card-body', '#8C8C8C'] },
  3: { width: 340, title: 16, body: 13, titleColor: ['--color-card-title-hi', '#F2F2F2'], bodyColor: ['--color-card-body-hi', '#B4B4B4'] },
} as const;
const weightOf = (f: GeneratedFragment) => WEIGHTS[f.weight ?? 2];
/** Characters per line for this card's text, from its width and font size (Neue Montreal Light is about 0.45 em wide). */
const charsPerLine = (f: GeneratedFragment) => Math.floor((weightOf(f).width - 2 * CARD_PAD) / (weightOf(f).body * 0.47));

export const groupFor = (cardId: string) => `grp-${cardId}`;
export const titleId = (cardId: string) => `${cardId}-title`;
export const footId = (cardId: string) => `${cardId}-foot`;
export const dotId = (cardId: string) => `${cardId}-dot`;

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
  return clip([kind, source, f.retold ? 'retold' : ''].filter(Boolean).join(' · '), 56);
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
  // The whole text, always: a card grows to fit what it says rather than teasing it.
  const w = weightOf(f), chars = charsPerLine(f);
  const parts = [wrapParagraphs(f.body, chars)];
  if (f.bridge) parts.push(wrap(`↳ ${f.bridge}`, chars));
  return {
    backgroundColor: cssVar('--color-card-bg', '#101010'),
    // A hairline, never a coloured outline: a card is outlined only while it is selected. Where it came from is in its footer.
    stroke: { strokeColor: cssVar('--color-card-border', '#1B1B1B'), strokeWidth: 1 },
    body: { text: `\n\n${parts.join('\n\n')}`, fontSize: w.body, strokeColor: cssVar(w.bodyColor[0], w.bodyColor[1]), fontFamily: 8, textAlign: 'left', verticalAlign: 'top' },
    title: { text: clip(f.title, 40), fontSize: w.title, fontFamily: 6, strokeColor: cssVar(w.titleColor[0], w.titleColor[1]) },
    foot: { text: cardFooter(f), fontSize: 10, fontFamily: 2, strokeColor: cssVar('--color-card-foot', '#5B5B60') },
  };
}

type Box = { x: number; y: number; width: number; height: number };

/** The box a card needs for its text: width from its weight, height from the number of lines (never less than FRAG_H). */
export function cardSize(f: GeneratedFragment): { width: number; height: number } {
  const lines = cardLook(f).body.text.split('\n').length;
  return { width: weightOf(f).width, height: Math.max(FRAG_H, Math.ceil(lines * weightOf(f).body * 1.25 + 8 + FOOT_AREA)) };
}

/** Skeletons for the two free texts of a card at `box` (the layout builds these along with the box). */
export function cardTextSkeletons(cardId: string, box: Box, look: CardLook, type?: GeneratedFragment['type']): Array<Record<string, unknown>> {
  const group = [groupFor(cardId)];
  return [
    // a small mark in the card's kind colour (person, event, thesis…) so kinds can be scanned without coloured fills
    ...(type ? [{ type: 'rectangle', roughness: 0, id: dotId(cardId), x: box.x + box.width - CARD_PAD - 8, y: box.y + TITLE_TOP + 3, width: 8, height: 8, strokeColor: 'transparent', backgroundColor: typeColors(type).bg, fillStyle: 'solid', roundness: null, groupIds: group, customData: { card: cardId, role: 'dot' } }] : []),
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
  const made = build(cardTextSkeletons(cardId, card as unknown as Box, look, f.type));
  let out = elements.map(e => {
    if (e.id === cardId || (e.type === 'text' && e.containerId === cardId)) return bump({ ...e, groupIds: [group] });
    return e;
  });
  for (const t of made) {
    const next = { ...t, groupIds: [group], customData: { card: cardId, role: t.id === titleId(cardId) ? 'title' : t.id === footId(cardId) ? 'foot' : 'dot' } };
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
  let out = addBox(elements, { ...cardSize(fragment), ...rest, backgroundColor: look.backgroundColor, label: look.body, link: fragment.link }, build);
  out = out.map(e => (e.id === card.id ? { ...e, ...look.stroke } : e));
  return syncCardTexts(out, card.id, fragment, build);
}

/** Re-render a card after its fragment changed (editor, or the model's text replacing an excerpt). */
export function updateCard(elements: El[], id: string, fragment: GeneratedFragment, extraData: Record<string, unknown>, build: Build): El[] {
  const look = cardLook(fragment);
  // the box follows its text: grow or shrink to fit before the label is laid out
  const size = cardSize(fragment);
  elements = elements.map(e => (e.id === id ? bump({ ...e, width: size.width, height: size.height }) : e));
  let out = updateBox(elements, id, { backgroundColor: look.backgroundColor, customData: { ...extraData, fragment }, link: fragment.link ?? null, label: look.body }, build);
  out = out.map(e => (e.id === id ? bump({ ...e, ...look.stroke }) : e));
  return syncCardTexts(out, id, fragment, build);
}
