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
