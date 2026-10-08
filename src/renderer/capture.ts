// Turning pasted text and inbox captures into fragments. Pure, so it's easy to test and to extend.

import type { GeneratedFragment } from '../backend/events';
import type { InboxItem } from '../types/capture';
import { clip, hostLabel, isHttpUrl } from './boxes';

const MAX_BODY = 4000;

/** Excalidraw's own clipboard payload — let Excalidraw paste its own elements. */
export function looksLikeExcalidrawClipboard(text: string): boolean {
  return text.trimStart().startsWith('{"type":"excalidraw/clipboard"');
}

function firstWords(text: string, n: number): string {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  const words = line.replace(/^[#>*\-\s"“]+/, '').split(/\s+/).filter(Boolean);
  const t = words.slice(0, n).join(' ');
  return words.length > n ? `${t}…` : t;
}

function urlTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return clip(`${hostLabel(url)}${path}`, 48);
  } catch { return clip(url, 48); }
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Text pasted onto the canvas. A lone URL becomes a source link; anything else a concept card to edit. */
export function fragmentFromPaste(raw: string): GeneratedFragment | null {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  if (!/\s/.test(text) && isHttpUrl(text)) {
    return { type: 'source', title: urlTitle(text), body: text, tags: [], link: text };
  }
  return { type: 'concept', title: firstWords(text, 6) || 'pasted text', body: clip(text, MAX_BODY), tags: [] };
}

/** An inbox capture, filed onto the canvas. */
export function fragmentFromCapture(item: InboxItem): GeneratedFragment {
  const tags = ['captured'];
  if (item.kind === 'pointer') {
    const url = item.url ?? '';
    const at = item.startSeconds !== undefined ? ` ▶ ${mmss(item.startSeconds)}` : '';
    return { type: 'source', title: item.title || urlTitle(url), body: `${url}${at}`, tags, link: url };
  }
  const text = item.text ?? '';
  return {
    type: item.url ? 'source' : 'concept',
    title: item.title || firstWords(text, 6) || 'captured text',
    body: clip(text, MAX_BODY),
    tags,
    ...(item.url ? { link: item.url } : {}),
  };
}
