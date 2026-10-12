// How generated boxes look, shared by the initial layout and by manual edits so a card edited by
// hand is rendered exactly like a generated one.

import type { GeneratedFragment } from '../backend/events';
import type { FragmentType } from '../types/fragments';
import { cssVar } from './theme';

export const FRAG_W = 280;
export const FRAG_H = 192;
export const HEADER_H = 48;
export const GAP = 24;

/** Below this, a card's wording is mostly not found in its KB passage: flag it. */
export const GROUNDING_WARN = 0.4;

export const FRAGMENT_TYPES: FragmentType[] = ['person', 'concept', 'thesis', 'source', 'event', 'era', 'domain', 'quote'];

export interface LabelSpec {
  text: string;
  fontSize: number;
  strokeColor: string;
  fontFamily: number;
  textAlign?: string;
  verticalAlign?: string;
}

/** Structured data stored on a box (Excalidraw `customData`); the label is only a view of it. */
export type BoxData =
  | { kind: 'fragment'; cluster?: number; slot?: number; fragment: GeneratedFragment }
  | { kind: 'cluster'; index: number; title: string };

export function wrap(text: string, max: number): string {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars - 1).trimEnd() + '…' : text;
}

/** "example.com" for a URL; the input unchanged if it isn't one. */
export function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function isHttpUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

export function typeColors(type: FragmentType): { bg: string; text: string } {
  return {
    bg: cssVar(`--color-fragment-${type}-bg`, '#ffffff'),
    text: cssVar(`--color-fragment-${type}-text`, '#0a0a0a'),
  };
}

const baseName = (p: string) => p.split('/').pop() ?? p;

export function fragmentLook(f: GeneratedFragment): { backgroundColor: string; label: LabelSpec } {
  const { bg, text } = typeColors(f.type);
  const body = f.type === 'quote' ? f.body : clip(f.body, 130);
  const parts = [`${f.type.toUpperCase()}\n${f.title}\n\n${wrap(body, 36)}`];
  if (f.bridge) parts.push(wrap(`↳ ${clip(f.bridge, 80)}`, 36));
  if (f.origin === 'wiki') {
    const low = f.grounding !== undefined && f.grounding < GROUNDING_WARN;
    parts.push(low ? '⚠ goes beyond the article' : `W ${f.sourceLabel ?? 'Wikipedia'} · ${clip(f.kbSources?.[0] ?? '', 26)}`);
  } else if (f.origin === 'ai') {
    parts.push(`✦ AI${f.aiModel ? ` · ${clip(f.aiModel, 22)}` : ''} — not from your notes`);
  } else if (f.kbSources?.length) {
    parts.push(f.grounding !== undefined && f.grounding < GROUNDING_WARN ? '⚠ goes beyond your KB' : `▤ ${baseName(f.kbSources[0])}`);
  }
  if (f.link) parts.push(`↗ ${hostLabel(f.link)}`);
  return {
    backgroundColor: bg,
    label: { text: parts.join('\n\n'), fontSize: 12, strokeColor: text, fontFamily: 2, textAlign: 'left', verticalAlign: 'top' },
  };
}

/** Marks a collection written by the AI rather than found in the knowledge base. */
export const AI_MARK = '✦ ';
export const WIKI_MARK = 'W · ';

export function clusterLabel(title: string, origin?: 'ai' | 'wiki'): LabelSpec {
  return { text: (origin === 'ai' ? AI_MARK : origin === 'wiki' ? WIKI_MARK : '') + title.toUpperCase(), fontSize: 16, strokeColor: '#1a1a1a', fontFamily: 2 };
}

export function edgeLabel(text: string): LabelSpec {
  return { text, fontSize: 14, strokeColor: '#1a1a1a', fontFamily: 2 };
}

export function captionLabel(text: string): LabelSpec {
  return { text, fontSize: 12, strokeColor: cssVar('--color-image-card-caption', '#525252'), fontFamily: 2, textAlign: 'center', verticalAlign: 'bottom' };
}

/** Outline that tells AI-written boxes apart from ones built from the user's notes. */
export function originStroke(origin?: 'ai' | 'wiki'): { strokeColor: string; strokeStyle: 'dashed' | 'solid'; strokeWidth: number } | null {
  if (origin === 'ai') return { strokeColor: '#4a4a4a', strokeStyle: 'dashed', strokeWidth: 1 };
  if (origin === 'wiki') return { strokeColor: '#2f5d9e', strokeStyle: 'solid', strokeWidth: 2 };
  return null;
}
