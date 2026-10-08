// How generated boxes look, shared by the initial layout and by manual edits so a card edited by
// hand is rendered exactly like a generated one.

import type { GeneratedFragment } from '../backend/events';
import type { FragmentType } from '../types/fragments';
import { cssVar } from './theme';

export const FRAG_W = 280;
export const FRAG_H = 150;
export const HEADER_H = 48;
export const GAP = 24;

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

export function fragmentLook(f: GeneratedFragment): { backgroundColor: string; label: LabelSpec } {
  const { bg, text } = typeColors(f.type);
  const body = f.type === 'quote' ? f.body : clip(f.body, 150);
  return {
    backgroundColor: bg,
    label: {
      text: `${f.type.toUpperCase()}\n${f.title}\n\n${wrap(body, 36)}${f.link ? `\n\n↗ ${hostLabel(f.link)}` : ''}`,
      fontSize: 12, strokeColor: text, fontFamily: 2, textAlign: 'left', verticalAlign: 'top',
    },
  };
}

export function clusterLabel(title: string): LabelSpec {
  return { text: title.toUpperCase(), fontSize: 16, strokeColor: '#1a1a1a', fontFamily: 2 };
}

export function edgeLabel(text: string): LabelSpec {
  return { text, fontSize: 14, strokeColor: '#1a1a1a', fontFamily: 2 };
}
