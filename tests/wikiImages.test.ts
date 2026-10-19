import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchLeadImage, wikipediaOrigin } from '../src/backend/library/images';
import { LibraryDb } from '../src/backend/library/store';
import { libraryRetriever } from '../src/backend/library/service';
import { dataUrlToBlob } from '../src/renderer/images';
import { setSettingsOverrides } from '../src/backend/settings';
import { runStrategy } from '../src/backend/strategies';
import type { WebEvent } from '../src/backend/events';
import type { LlmService } from '../src/backend/llm';

afterEach(() => { vi.unstubAllGlobals(); setSettingsOverrides({}); });

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const summary = (over: Record<string, unknown> = {}) => ({ title: 'Zeppelin', thumbnail: { source: 'https://upload.wikimedia.org/x/320px-Z.jpg', width: 320, height: 200 }, content_urls: { desktop: { page: 'https://simple.wikipedia.org/wiki/Zeppelin' } }, ...over });
const stubFetch = (sum: unknown, img: { type?: string; bytes?: Buffer; ok?: boolean } = {}) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (String(url).includes('/api/rest_v1/')) return new Response(JSON.stringify(sum), { status: 200 });
  return new Response(img.bytes ?? png, { status: img.ok === false ? 404 : 200, headers: { 'content-type': img.type ?? 'image/jpeg' } });
}));

describe('wikipediaOrigin', () => {
  it('accepts only https Wikipedia hosts', () => {
    expect(wikipediaOrigin('https://simple.wikipedia.org/wiki/')).toBe('https://simple.wikipedia.org');
    expect(wikipediaOrigin('https://en.wikipedia.org/wiki/')).toBe('https://en.wikipedia.org');
    for (const bad of ['http://en.wikipedia.org/wiki/', 'https://evil.com/wiki/', 'https://en.wikipedia.org.evil.com/', 'nonsense', '']) expect(wikipediaOrigin(bad)).toBeNull();
  });
});

describe('fetchLeadImage', () => {
  it('returns the lead thumbnail as a data URL with a caption and a link back to the article', async () => {
    stubFetch(summary());
    const img = (await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'Zeppelin'))!;
    expect(img).toMatchObject({ mimeType: 'image/jpeg', width: 320, height: 200, caption: 'Zeppelin', link: 'https://simple.wikipedia.org/wiki/Zeppelin' });
    expect(img.dataURL.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
  it('tries the English article when the Simple English one has no picture', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith('https://simple.wikipedia.org/api/')) return new Response(JSON.stringify({ title: 'Airship' }), { status: 200 });
      if (url.startsWith('https://en.wikipedia.org/api/')) return new Response(JSON.stringify(summary({ title: 'Airship', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Airship' } } })), { status: 200 });
      return new Response(png, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    vi.stubGlobal('fetch', f);
    const img = await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'Airship');
    expect(img?.link).toBe('https://en.wikipedia.org/wiki/Airship');
    expect(f.mock.calls.some(c => String(c[0]).startsWith('https://en.wikipedia.org/api/'))).toBe(true);
    // an English library does not fall back to anything else
    const g = vi.fn(async () => new Response(JSON.stringify({ title: 'x' }), { status: 200 })); vi.stubGlobal('fetch', g);
    expect(await fetchLeadImage('https://en.wikipedia.org/wiki/', 'x')).toBeNull();
    expect(g).toHaveBeenCalledTimes(1);
  });
  it('accepts thumbnails served from either Wikimedia image host', async () => {
    stubFetch(summary({ thumbnail: { source: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Z.jpg/330px-Z.jpg?utm_source=x', width: 330, height: 235 } }));
    expect((await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'Zeppelin'))?.width).toBe(330);
  });
  it('never calls out for a non-Wikipedia library', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await fetchLeadImage('https://x.test/wiki/', 'Zeppelin')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('gives up quietly: no picture, a non-image, an image that is too big or too small, a failed download, being offline', async () => {
    stubFetch({ title: 'x' }); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
    stubFetch(summary({ thumbnail: { source: 'https://evil.example/a.jpg', width: 300, height: 300 } })); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
    stubFetch(summary({ thumbnail: { source: 'https://upload.wikimedia.org/a.png', width: 20, height: 20 } })); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
    stubFetch(summary(), { type: 'text/html' }); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
    stubFetch(summary(), { bytes: Buffer.alloc(2_000_000) }); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
    stubFetch(summary(), { ok: false }); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); }); expect(await fetchLeadImage('https://simple.wikipedia.org/wiki/', 'x')).toBeNull();
  });
});

describe('pictures in the lensed strategy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lead = (s: string) => `${s} is described here in a fairly long sentence so that it counts as real content. It continues with more detail that makes the passage worth indexing for search.`;
  const db = LibraryDb.create(path.join(dir, 'wp.db'), { name: 'wp', label: 'Simple English Wikipedia', urlBase: 'https://simple.wikipedia.org/wiki/', source: 't' });
  db.begin();
  db.addArticle('Zeppelin', [{ heading: '', text: lead('The zeppelin airship') }, { heading: 'Design', text: lead('The zeppelin frame and gas cells') }]);
  db.addArticle('Hindenburg', [{ heading: '', text: lead('The Hindenburg zeppelin disaster') }]);
  db.commit(); db.finish();

  const none = { retrieve: async (q: string) => ({ query: q, terms: [], collections: [], considered: 0 }), retrieveFromCard: async () => ({ query: '', terms: [], collections: [], considered: 0 }) };
  const offline: LlmService = { call: async () => { throw new Error('offline'); }, async *stream() { /* none */ } };
  const run = async (images: any) => {
    setSettingsOverrides({ library: { dir, disabled: [] } });
    const out: WebEvent[] = [];
    for await (const e of runStrategy('zeppelin', { strategy: 'lensed', signal: new AbortController().signal, retriever: none as any, llm: offline, ai: null, images, config: { clusterCount: 2, fragmentsPerCluster: 3 } })) out.push(e);
    return out;
  };
  const img = (caption: string) => ({ dataURL: 'data:image/png;base64,AAAA', mimeType: 'image/png', width: 300, height: 200, caption, link: `https://simple.wikipedia.org/wiki/${caption}` });

  it('fetches one picture per article (not per passage) for cards from the library, and emits each as it arrives', async () => {
    const calls: string[] = [];
    const out = await run(async (_base: string, title: string) => { calls.push(title); return img(title); });
    expect(calls.sort()).toEqual(['Hindenburg', 'Zeppelin']);                 // Zeppelin has two passages but one picture
    const pics = out.filter(e => e.type === 'image') as any[];
    expect(pics.map(p => p.image.caption).sort()).toEqual(['Hindenburg', 'Zeppelin']);
    expect(pics.every(p => Number.isInteger(p.cluster) && Number.isInteger(p.slot))).toBe(true);
  });
  it('is silent about articles with no picture, and does nothing when switched off', async () => {
    expect((await run(async () => null)).some(e => e.type === 'image')).toBe(false);
    expect((await run(null)).some(e => e.type === 'image')).toBe(false);
  });
  it('does not hold up the cards: the web is shown before a slow picture arrives', async () => {
    const out = await run(async (_b: string, title: string) => { await new Promise(r => setTimeout(r, 80)); return img(title); });
    const firstPic = out.findIndex(e => e.type === 'image');
    const lastCard = out.map((e, i) => (e.type === 'fragment' ? i : -1)).reduce((a, b) => Math.max(a, b));
    expect(firstPic).toBeGreaterThan(-1);
    expect(out.findIndex(e => e.type === 'overview')).toBeLessThan(firstPic);
    void lastCard;
  });
  it('is off for the notes: only library cards get pictures', async () => {
    const f = vi.fn();
    setSettingsOverrides({});
    const out: WebEvent[] = [];
    for await (const e of runStrategy('zeppelin', { strategy: 'lensed', signal: new AbortController().signal, retriever: none as any, llm: offline, ai: null, library: null, images: f, config: { clusterCount: 1, fragmentsPerCluster: 1 } })) out.push(e);
    expect(f).not.toHaveBeenCalled();
  });
  void libraryRetriever;
});

describe('dataUrlToBlob', () => {
  it('turns a data URL into a Blob with the right type and bytes, without fetch', async () => {
    const b = dataUrlToBlob(`data:image/png;base64,${png.toString('base64')}`);
    expect(b.type).toBe('image/png');
    expect(Buffer.from(await b.arrayBuffer()).equals(png)).toBe(true);
  });
});

import { fetchArticleMedia, imageSize, tileFor } from '../src/backend/library/images';
const pngOf = (w: number, h: number) => { const b = Buffer.alloc(40); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
describe('fetchArticleMedia', () => {
  const item = (title: string, caption: string, extra: Record<string, unknown> = {}) => ({ type: 'image', title: `File:${title}`, caption: { text: caption }, showInGallery: true, original: { width: 1200, height: 800 }, srcset: [{ src: `//upload.wikimedia.org/wikipedia/commons/thumb/a/a1/${title}/320px-${title}`, scale: '1x' }], ...extra });
  const list = { items: [
    item('Lead.jpg', 'The cathedral from the west', { leadImage: true }),
    item('Nave.jpg', 'The nave of the cathedral looking east towards the choir'),
    item('Window.jpg', 'Stained glass window in the south aisle of the cathedral'),
    item('Commons-logo.png', 'The Commons logo shown here for no reason'),
    item('NoCaption.jpg', ''),
    item('Plan.svg', 'A floor plan of the whole cathedral building'),
    { type: 'video', title: 'File:Bells_ringing.webm', caption: { text: 'The bells ringing' } },
  ] };
  const stub = (summary: Record<string, unknown>, tile = true) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/page/media-list/')) return new Response(JSON.stringify(list), { status: 200 });
    if (u.includes('/page/summary/')) return new Response(JSON.stringify(summary), { status: 200 });
    if (u.startsWith('https://tile.openstreetmap.org/')) return tile ? new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('', { status: 404 });
    return new Response(pngOf(500, 333), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }));

  it('picks up to two more pictures that have captions, skipping the lead, logos, vectors and captionless ones', async () => {
    stub({ title: 'Ely Cathedral', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ely_Cathedral' } } });
    const m = await fetchArticleMedia('https://en.wikipedia.org/wiki/', 'Ely Cathedral', 'The cathedral window is made of stained glass.');
    expect(m.extras.map(e => e.caption)).toEqual(['Stained glass window in the south aisle of the cathedral', 'The nave of the cathedral looking east towards the choir']); // best fit to the passage first
    expect(m.extras.map(e => e.n)).toEqual([1, 2]);
    expect(m.extras[0]).toMatchObject({ kind: 'extra', credit: 'Wikimedia Commons', link: 'https://en.wikipedia.org/wiki/Ely_Cathedral', width: 500, height: 333 });
    expect(m.extras[0].dataURL.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
  it('offers a clip as a link to Commons, never as something the app plays', async () => {
    stub({ title: 'Ely Cathedral' });
    const m = await fetchArticleMedia('https://en.wikipedia.org/wiki/', 'Ely Cathedral', 'The cathedral bells are rung by ringers.');
    expect(m.links).toEqual([{ kind: 'video', title: 'The bells ringing', url: 'https://commons.wikimedia.org/wiki/File%3ABells_ringing.webm' }]);
  });
  it('skips a clip whose caption has nothing to do with the card', async () => {
    stub({ title: 'Ely Cathedral' });
    expect((await fetchArticleMedia('https://en.wikipedia.org/wiki/', 'Ely Cathedral', 'Stained glass and stone.')).links).toEqual([]);
  });
  it('makes a map from the article\'s coordinates with the place marked inside one tile', async () => {
    stub({ title: 'Ely Cathedral', coordinates: { lat: 52.3987, lon: 0.2635 } });
    const m = await fetchArticleMedia('https://en.wikipedia.org/wiki/', 'Ely Cathedral', '');
    expect(m.map).toMatchObject({ kind: 'map', width: 256, height: 256, credit: '© OpenStreetMap contributors', caption: 'Where Ely Cathedral is' });
    expect(m.map!.marker!.x).toBeGreaterThanOrEqual(0); expect(m.map!.marker!.x).toBeLessThanOrEqual(1);
    stub({ title: 'x', coordinates: { lat: 52, lon: 0 } }, false);
    expect((await fetchArticleMedia('https://en.wikipedia.org/wiki/', 'x', '')).map).toBeNull(); // no tile, no map
  });
  it('is empty for a non-Wikipedia library and when offline', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await fetchArticleMedia('https://x.test/wiki/', 'x', '')).toEqual({ extras: [], map: null, links: [] });
    expect(f).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    expect(await fetchArticleMedia('https://en.wikipedia.org/wiki/', 'x', '')).toEqual({ extras: [], map: null, links: [] });
  });
  it('fills in from the English article when the Simple English one has few pictures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith('https://simple.wikipedia.org/api/rest_v1/page/media-list/')) return new Response(JSON.stringify({ items: [item('Lead.jpg', 'lead', { leadImage: true })] }), { status: 200 });
      if (u.startsWith('https://en.wikipedia.org/api/rest_v1/page/media-list/')) return new Response(JSON.stringify(list), { status: 200 });
      if (u.includes('/page/summary/')) return new Response(JSON.stringify({ title: 'Ely Cathedral', ...(u.startsWith('https://en.') ? { coordinates: { lat: 52.4, lon: 0.26 } } : {}) }), { status: 200 });
      if (u.startsWith('https://tile.')) return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      return new Response(pngOf(500, 333), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }));
    const m = await fetchArticleMedia('https://simple.wikipedia.org/wiki/', 'Ely Cathedral', 'stained glass');
    expect(m.extras).toHaveLength(2);
    expect(m.map).not.toBeNull(); // the coordinates came from the English summary
  });
  it('reads image sizes from headers', () => {
    expect(imageSize(pngOf(640, 480))).toEqual({ width: 640, height: 480 });
    const gif = Buffer.alloc(14); gif.write('GIF89a', 0, 'ascii'); gif.writeUInt16LE(120, 6); gif.writeUInt16LE(90, 8);
    expect(imageSize(gif)).toEqual({ width: 120, height: 90 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    expect(imageSize(jpeg)).toEqual({ width: 400, height: 300 });
    expect(imageSize(Buffer.from('not an image at all, nothing to see'))).toBeNull();
  });
  it('finds the right tile for a coordinate', () => {
    const t = tileFor(52.3987, 0.2635, 8);
    expect(t).toMatchObject({ x: 128, y: 84 });
  });
});
