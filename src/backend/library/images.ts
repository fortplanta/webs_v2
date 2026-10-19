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
  /** 'lead' (the default), another picture from the article, or a map of the place it is about. */
  kind?: 'lead' | 'extra' | 'map';
  /** Which picture of the article this is (0 = lead), so each gets its own place and id. */
  n?: number;
  /** For a map: where the place is, as fractions (0–1) across and down the picture. */
  marker?: { x: number; y: number };
  /** Who the picture is credited to, when it is not the article itself. */
  credit?: string;
}

/** A video or audio clip an article carries: shown as a card that opens it on Commons, never played in the app. */
export interface MediaLink {
  kind: 'video' | 'audio';
  title: string;
  url: string;
}

export interface ArticleMedia {
  extras: WebImage[];
  map: WebImage | null;
  links: MediaLink[];
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


// ── More from the same article: its other pictures, a map for a place, clips ───────────────────────────────

const GOOD_IMAGE = /\.(jpe?g|png|webp)$/i;
const BORING = /icon|logo|flag_of|commons|symbol|edit-|question_book|wiktionary|wikiquote|wikisource|ambox|stub|disambig|padlock|portal|blank|placeholder|map_of_the_world/i;
const MAX_EXTRA_BYTES = 900_000;
const MAP_ZOOM = 8;

interface MediaItem { type?: string; title?: string; caption?: { text?: string }; showInGallery?: boolean; leadImage?: boolean; original?: { width?: number; height?: number }; srcset?: Array<{ src?: string; scale?: string }> }

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** Slippy-map tile (and where in it a point falls) for a coordinate. */
export function tileFor(lat: number, lon: number, zoom = MAP_ZOOM): { x: number; y: number; px: number; py: number } {
  const n = 2 ** zoom, rad = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x: Math.floor(fx), y: Math.floor(fy), px: fx - Math.floor(fx), py: fy - Math.floor(fy) };
}

async function getJson<T>(url: string, sig: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: sig });
    return res.ok ? ((await res.json()) as T) : null;
  } catch { return null; }
}

async function getImage(url: string, sig: AbortSignal, max: number): Promise<{ dataURL: string; mimeType: string; bytes: Buffer } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: sig });
    if (!res.ok) return null;
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeType)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > max) return null;
    return { dataURL: `data:${mimeType};base64,${bytes.toString('base64')}`, mimeType, bytes };
  } catch { return null; }
}

/** Pixel size of a PNG, JPEG, GIF or WebP from its header bytes (the media list does not say), or null. */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  try {
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    }
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * The rest of what an article offers, besides its lead picture: up to two more pictures whose captions fit the passage
 * (a picture with no caption says nothing about what it shows, so it is skipped), a map when the article is about a
 * place, and any video or audio clips as links. `hint` is the passage the card shows, used to pick relevant pictures.
 * Same hosts as the lead picture, plus one OpenStreetMap tile for a map.
 */
export async function fetchArticleMedia(urlBase: string, title: string, hint: string, signal?: AbortSignal): Promise<ArticleMedia> {
  const out: ArticleMedia = { extras: [], map: null, links: [] };
  const own = wikipediaOrigin(urlBase);
  if (!own) return out;
  const timeout = AbortSignal.timeout(25_000);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const page = encodeURIComponent(title.replace(/ /g, '_'));
    // The article's own wiki first; a Simple English article is short and often has few pictures, so the English one of the same name fills in.
    const origins = own === 'https://simple.wikipedia.org' ? [own, 'https://en.wikipedia.org'] : [own];
    const wanted = words(hint + ' ' + title);
    let link = `${own}/wiki/${page}`, coords: { lat?: number; lon?: number } | undefined;
    const seenTitles = new Set<string>();

    for (const origin of origins) {
      const [list, summary] = await Promise.all([
        getJson<{ items?: MediaItem[] }>(`${origin}/api/rest_v1/page/media-list/${page}`, sig),
        getJson<{ coordinates?: { lat?: number; lon?: number }; content_urls?: { desktop?: { page?: string } } }>(`${origin}/api/rest_v1/page/summary/${page}`, sig),
      ]);
      if (summary?.content_urls?.desktop?.page && out.extras.length === 0) link = summary.content_urls.desktop.page;
      coords = coords ?? summary?.coordinates;
      const items = list?.items ?? [];

      const candidates = items
        .filter(i => i.type === 'image' && i.showInGallery !== false && !i.leadImage && i.title && !seenTitles.has(i.title) && GOOD_IMAGE.test(i.title) && !BORING.test(i.title) && (i.caption?.text ?? '').trim().length >= 12)
        .map(i => ({ i, score: [...words(i.caption!.text!)].filter(w => wanted.has(w)).length }))
        .sort((a, b) => b.score - a.score);
      for (const { i } of candidates) {
        if (out.extras.length >= 2) break;
        seenTitles.add(i.title!);
        const set = i.srcset ?? [];
        const src = (set.find(x => x.scale === '1x') ?? set[0])?.src;
        const url = src ? (src.startsWith('//') ? `https:${src}` : src) : '';
        if (!/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url)) continue;
        const img = await getImage(url, sig, MAX_EXTRA_BYTES);
        if (!img) continue;
        const size = imageSize(img.bytes);
        if (!size || size.width < 200 || size.height < 120) continue;
        out.extras.push({ dataURL: img.dataURL, mimeType: img.mimeType, width: size.width, height: size.height, caption: i.caption!.text!.replace(/\s+/g, ' ').trim().slice(0, 120), link, kind: 'extra', n: 1 + out.extras.length, credit: 'Wikimedia Commons' });
      }
      for (const i of items) {
        // a clip only if its caption is about what the card is about
        const about = [...words(i.caption?.text ?? '')].some(w => wanted.has(w));
        if ((i.type === 'video' || i.type === 'audio') && i.title && about && out.links.length < 1) out.links.push({ kind: i.type, title: (i.caption?.text ?? i.title.replace(/^File:/, '').replace(/_/g, ' ')).slice(0, 90), url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(i.title.replace(/ /g, '_'))}` });
      }
      if (out.extras.length >= 2) break;
    }

    // a place's coordinates live on the English article even when the pictures came from the Simple English one
    if (!coords && origins.length > 1) coords = (await getJson<{ coordinates?: { lat?: number; lon?: number } }>(`${origins[1]}/api/rest_v1/page/summary/${page}`, sig))?.coordinates;
    if (typeof coords?.lat === 'number' && typeof coords?.lon === 'number' && Math.abs(coords.lat) <= 85) {
      const t = tileFor(coords.lat, coords.lon);
      const img = await getImage(`https://tile.openstreetmap.org/${MAP_ZOOM}/${t.x}/${t.y}.png`, sig, 400_000);
      if (img) out.map = { dataURL: img.dataURL, mimeType: img.mimeType, width: 256, height: 256, caption: `Where ${title} is`, link, kind: 'map', n: 3, marker: { x: t.px, y: t.py }, credit: '© OpenStreetMap contributors' };
    }
    return out;
  } catch {
    if (signal?.aborted) throw new WebsError('cancelled', 'Cancelled.');
    return out;
  }
}
