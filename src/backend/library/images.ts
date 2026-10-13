// Pictures for cards that come from a Wikipedia library: the article's lead image, fetched in the background through
// Wikipedia's public summary API. It is the one thing in the app that talks to wikipedia.org, it can be switched off in
// Settings, and only a thumbnail is downloaded (then saved with the web, so it works offline afterwards).

import { WebsError } from '../errors';

export interface WebImage {
  dataURL: string;
  mimeType: string;
  width: number;
  height: number;
  /** The article's title, used as the caption. */
  caption: string;
  /** The article's address, so the picture links back to its source. */
  link: string;
}

const MAX_BYTES = 1_500_000;
const USER_AGENT = 'Webs/0.1 (https://github.com/fortplanta/webs_v2; local research canvas)';

/** The wiki's origin for an article base like https://simple.wikipedia.org/wiki/, if it is a Wikipedia. */
export function wikipediaOrigin(urlBase: string): string | null {
  try {
    const u = new URL(urlBase);
    return u.protocol === 'https:' && /^[a-z-]+\.wikipedia\.org$/.test(u.hostname) ? u.origin : null;
  } catch { return null; }
}

/**
 * The article's lead picture. Many Simple English articles have none; the English article of the same name usually does,
 * so that is tried next (same title, same service).
 */
export async function fetchLeadImage(urlBase: string, title: string, signal?: AbortSignal): Promise<WebImage | null> {
  const origin = wikipediaOrigin(urlBase);
  if (!origin) return null;
  const own = await fetchFrom(origin, title, signal);
  if (own || origin !== 'https://simple.wikipedia.org') return own;
  return fetchFrom('https://en.wikipedia.org', title, signal);
}

async function fetchFrom(origin: string, title: string, signal?: AbortSignal): Promise<WebImage | null> {
  const page = encodeURIComponent(title.replace(/ /g, '_'));
  const timeout = AbortSignal.timeout(12_000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(`${origin}/api/rest_v1/page/summary/${page}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: sig });
    if (!res.ok) return null;
    const data = (await res.json()) as { thumbnail?: { source?: string; width?: number; height?: number }; content_urls?: { desktop?: { page?: string } }; title?: string };
    const t = data.thumbnail;
    if (!t?.source || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(t.source) || (t.width ?? 0) < 80 || (t.height ?? 0) < 60) return null;
    const img = await fetch(t.source, { headers: { 'User-Agent': USER_AGENT }, signal: sig });
    if (!img.ok) return null;
    const mimeType = (img.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) return null;
    const bytes = Buffer.from(await img.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return {
      dataURL: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType, width: t.width!, height: t.height!,
      caption: data.title ?? title, link: data.content_urls?.desktop?.page ?? `${origin}/wiki/${page}`,
    };
  } catch (err) {
    if (signal?.aborted) throw new WebsError('cancelled', 'Cancelled.');
    return null; // offline, blocked, no picture: the card simply has none
  }
}
