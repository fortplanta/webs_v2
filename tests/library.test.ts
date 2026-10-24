import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importDump, readPage } from '../src/backend/library/importer';
import { LibraryDb, ftsQuery } from '../src/backend/library/store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const lead = (about: string) => `${about} is described here in a fairly long sentence so that it counts as real content. It continues with more detail that makes the passage worth indexing for search.`;
const page = (title: string, text: string, extra = '<ns>0</ns>') => `<page><title>${title}</title>${extra}<revision><text xml:space="preserve">${text}</text></revision></page>`;
const xml = `<mediawiki>${[
  page('Zeppelin', `{{Infobox}}\n'''Zeppelin''' airships. ${lead('The zeppelin airship')} Count [[Ferdinand von Zeppelin|Zeppelin]] built them.\n\n== History ==\n${lead('Early zeppelin flights')}\n\n== References ==\n<ref>x</ref>`),
  page('Cats', lead('The domestic cat')),
  page('Old name', '#REDIRECT [[Zeppelin]]'),
  page('Talk:Zeppelin', lead('A talk page'), '<ns>1</ns>'),
  page('Tiny', 'Too short.'),
  page('Fish &amp; chips', lead('Fish and chips')),
  page('Foo', `Foo may mean:\n{{disambig}}\n${lead('Foo')}`),
].join('\n')}</mediawiki>`;

describe('readPage', () => {
  it('keeps real articles and drops redirects, other namespaces and disambiguation pages', () => {
    expect(readPage(page('A', 'text'))).toEqual({ title: 'A', wikitext: 'text' });
    expect(readPage(page('B &amp; C', 'x'))?.title).toBe('B & C');
    expect(readPage(page('R', '#REDIRECT [[A]]'))).toBeNull();
    expect(readPage(page('T', 'x', '<ns>1</ns>'))).toBeNull();
    expect(readPage(page('D', '{{disambig}} x'))).toBeNull();
    expect(readPage('<page><title>Z</title><ns>0</ns><redirect title="A" /><revision><text>x</text></revision></page>')).toBeNull();
  });
});

describe('library import and search', () => {
  const dump = path.join(dir, 'dump.xml'), out = path.join(dir, 'test.db');
  fs.writeFileSync(dump, xml);

  it('imports articles as passages (no references, redirects, stubs), reporting progress', async () => {
    const seen: number[] = [];
    const meta = await importDump({ dump, out, name: 'test', label: 'Test Wiki', urlBase: 'https://x.test/wiki/', onProgress: p => seen.push(p.fraction) });
    expect(meta).toMatchObject({ name: 'test', label: 'Test Wiki', articles: 3, source: 'dump.xml' }); // Zeppelin, Cats, Fish & chips
    expect(meta.passages).toBe(4);       // Zeppelin lead + History, Cats, Fish & chips
    expect(seen.at(-1)).toBe(1);
  });

  it('finds passages by stemmed words, ranking title matches first, and returns the original text', () => {
    const lib = LibraryDb.open(out);
    const hits = lib.search('zeppelins and airships');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toBe('Zeppelin');
    expect(hits[0].text).toContain('Count Zeppelin built them.');   // links resolved
    expect(hits.some(h => /References/.test(h.heading))).toBe(false);
    expect(lib.search('fish chips')[0].title).toBe('Fish & chips');
    expect(lib.search('quantum chromodynamics')).toEqual([]);
    expect(lib.meta().label).toBe('Test Wiki');
    lib.close();
  });

  it('puts the article named exactly what was asked first and flags it', () => {
    const lib = LibraryDb.open(out);
    const hits = lib.search('the zeppelin');
    expect(hits[0]).toMatchObject({ title: 'Zeppelin', exactTitle: true });
    expect(hits.filter(h => h.exactTitle).every(h => h.title === 'Zeppelin')).toBe(true);
    expect(lib.search('fish cat').some(h => h.exactTitle)).toBe(false);
    lib.close();
  });

  it('puts passages with every query word ahead of ones with only some', () => {
    const lib = LibraryDb.open(out);
    const hits = lib.search('fish cat');           // 'Fish & chips' and 'Cats' each match one word, none match both
    expect(hits.map(h => h.title).sort()).toEqual(['Cats', 'Fish & chips']);
    lib.close();
  });

  it('is read-only when opened for search', () => {
    const lib = LibraryDb.open(out);
    expect(() => lib.addArticle('x', [{ heading: '', text: 'y' }])).toThrow();
    lib.close();
  });

  it('builds a safe FTS query from arbitrary text', () => {
    expect(ftsQuery('the "cat" AND (dog) OR *')).toBe('"cat" OR "dog"');
    expect(ftsQuery('the "cat" AND (dog)', 'all')).toBe('"cat" AND "dog"');
    expect(ftsQuery('a of the')).toBeNull();
  });
});

// ── the library tier in the strategy ────────────────────────────────────────────────────────────────────────
import { libraryRetriever, listLibraries, passageKey, withPrimaryLeads } from '../src/backend/library/service';
import { setSettingsOverrides } from '../src/backend/settings';
import { runStrategy } from '../src/backend/strategies';
import type { WebEvent } from '../src/backend/events';
import type { Retriever } from '../src/backend/retrieval/service';
import type { LlmService } from '../src/backend/llm';
import { initialModel, reduce } from '../src/renderer/webModel';

describe('library tier', () => {
  const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libs-'));
  const db = LibraryDb.create(path.join(libDir, 'wiki.db'), { name: 'wiki', label: 'Test Wiki', urlBase: 'https://x.test/wiki/', source: 't' });
  db.begin();
  db.addArticle('Zeppelin', [{ heading: '', text: lead('The zeppelin airship') }, { heading: 'Design', text: lead('The zeppelin frame and gas cells') }]);
  db.addArticle('Graf Zeppelin', [{ heading: '', text: lead('The Graf Zeppelin airship was a passenger zeppelin') }]);
  db.commit(); db.finish();
  fs.writeFileSync(path.join(libDir, '_ignored.db'), 'not a db');
  afterAll(() => { setSettingsOverrides({}); fs.rmSync(libDir, { recursive: true, force: true }); });

  const none: Retriever = { retrieve: async q => ({ query: q, terms: [], collections: [], considered: 0 }), retrieveFromCard: async () => ({ query: '', terms: [], collections: [], considered: 0 }) };
  const offline: LlmService = { call: async () => { const { WebsError } = await import('../src/backend/errors'); throw new WebsError('ollama-offline', 'offline'); }, async *stream() { /* none */ } };
  const collect = async (it: AsyncGenerator<WebEvent>) => { const out: WebEvent[] = []; for await (const e of it) out.push(e); return out; };

  it('adds the exact-title lead to the first collection once, even if two libraries have it', () => {
    const e = (src: string, id: string) => ({ id, source: src, heading: '', text: 'Lead text.', exact: true });
    const r = { query: 'q', terms: [], considered: 0, collections: [{ lens: 'direct', label: 'x', verb: 'led to', passages: [{ id: 'a:Other#7', source: 'a:Other', text: 't', heading: '', lens: 'direct', terms: [], score: { value: 2, rel: 1, conn: 0, nov: 1, red: 0 } }] }] } as any;
    const out = withPrimaryLeads(r, [e('a:Press', 'a:Press#0'), e('b:Press', 'b:Press#0')], 3);
    expect(out.collections[0].passages.map((p: any) => p.id)).toEqual(['a:Press#0', 'a:Other#7']);
    expect(withPrimaryLeads(out, [e('a:Press', 'a:Press#0')], 3)).toBe(out);
  });

  it('lists libraries, skipping files that are not libraries', () => {
    expect(listLibraries(libDir)).toMatchObject([{ name: 'wiki', label: 'Test Wiki', articles: 2, passages: 3 }]);
    expect(listLibraries('')).toEqual([]);
    expect(listLibraries('/nonexistent')).toEqual([]);
  });

  it('retrieves through the normal pipeline and keys an article\'s lead as #0 (retrieval favours it)', async () => {
    setSettingsOverrides({ library: { dir: libDir, disabled: [] } });
    const r = (await libraryRetriever.retrieve('zeppelin airship'))!;
    const all = r.retrieval.collections.flatMap(c => c.passages);
    expect(all.length).toBeGreaterThan(0);
    const lead = all.find(p => p.source === 'wiki:Zeppelin' && p.id.endsWith('#0'))!;
    expect(lead.id).toBe(passageKey('wiki', 'Zeppelin', 0, 1));
    expect(lead.id.endsWith('#0')).toBe(true);
    expect(passageKey('wiki', 'Zeppelin', 1, 2)).toBe('wiki:Zeppelin#2'); // only an article's opening passage is #0; the rest are keyed by row
    expect(r.libraries.get('wiki')?.label).toBe('Test Wiki');
    setSettingsOverrides({ library: { dir: libDir, disabled: ['wiki'] } });
    expect(await libraryRetriever.retrieve('zeppelin airship')).toBeNull();   // switched off in Settings
    setSettingsOverrides({});
    expect(await libraryRetriever.retrieve('zeppelin airship')).toBeNull();   // no folder configured
  });

  it('builds the web from the library when the notes have nothing, marking cards as Wikipedia with a real link', async () => {
    setSettingsOverrides({ library: { dir: libDir, disabled: [] } });
    const evs = await collect(runStrategy('zeppelin airship', { strategy: 'lensed', signal: new AbortController().signal, retriever: none, llm: offline, ai: null, config: { clusterCount: 2, fragmentsPerCluster: 2 } }));
    expect(evs.some(e => e.type === 'status' && /Test Wiki/.test((e as any).message))).toBe(true);
    const overview = evs.find(e => e.type === 'overview') as any;
    expect(overview.clusters.every((c: any) => c.origin === 'wiki')).toBe(true);
    const frags = evs.filter(e => e.type === 'fragment') as any[];
    expect(frags.length).toBeGreaterThan(0);
    for (const f of frags) {
      expect(f.fragment).toMatchObject({ origin: 'wiki', sourceLabel: 'Test Wiki' });
      expect(f.fragment.link).toMatch(/^https:\/\/x\.test\/wiki\/(Graf_Zeppelin|Zeppelin)$/);
      expect(f.fragment.kbSources[0]).toMatch(/Zeppelin/);
    }
    // the canvas model keeps the marks
    let m = initialModel('q');
    for (const e of evs) m = reduce(m, e);
    expect(m.clusters.every(c => c.origin === 'wiki')).toBe(true);
    expect(m.clusters[0].slots[0]?.origin).toBe('wiki');
  });

  it('tops a thin library web up with the AI when that is on (the library used to end the search)', async () => {
    setSettingsOverrides({ library: { dir: libDir, disabled: [] } });
    const outline = JSON.stringify({ context: 'About zeppelins.', clusters: [{ title: 'Risks', edge: 'led to' }, { title: 'Money', edge: 'paid for' }, { title: 'People', edge: 'affected' }] });
    const aiCard = (cluster: number) => JSON.stringify({ cluster, type: 'concept', title: `ai card ${cluster}`, body: 'Body.', bridge: 'b' }) + '\n';
    const ai = { llm: { call: async () => outline, async *stream() { yield aiCard(0) + aiCard(1) + aiCard(2); } } as LlmService, model: 'test-model', topUp: true };
    const evs = await collect(runStrategy('zeppelin airship', { strategy: 'lensed', signal: new AbortController().signal, retriever: none, llm: offline, ai, config: { clusterCount: 4, fragmentsPerCluster: 1 } }));
    const frags = evs.filter(e => e.type === 'fragment') as any[];
    expect(frags.some(f => f.fragment.origin === 'wiki')).toBe(true);
    expect(frags.filter(f => f.fragment.origin === 'ai').length).toBeGreaterThan(0);
    expect(evs.some(e => e.type === 'ai-outline')).toBe(true);
  });

  it('prefers the notes: the library is never searched when the notes have results', async () => {
    setSettingsOverrides({ library: { dir: libDir, disabled: [] } });
    const library = { retrieve: async () => { throw new Error('should not be searched'); } };
    const withNotes: Retriever = { ...none, retrieve: async q => ({ query: q, terms: ['x'], considered: 1, collections: [{ lens: 'direct', label: 'L', verb: 'v', passages: [{ id: 'n.md#0', source: 'n.md', text: 'note text', lens: 'direct', heading: '', terms: ['x'], score: { value: 1, rel: 1, conn: 0, nov: 1, red: 0 } }] }] }) };
    const evs = await collect(runStrategy('x', { strategy: 'lensed', signal: new AbortController().signal, retriever: withNotes, llm: offline, ai: null, library, config: { clusterCount: 1, fragmentsPerCluster: 1 } }));
    expect(evs.filter(e => e.type === 'fragment').every((e: any) => !e.fragment.origin)).toBe(true);
  });

  it('falls through to the AI (then to an error) when the library has nothing either', async () => {
    setSettingsOverrides({ library: { dir: libDir, disabled: [] } });
    const evs = await collect(runStrategy('quantum chromodynamics', { strategy: 'lensed', signal: new AbortController().signal, retriever: none, llm: offline, ai: null }));
    expect(evs).toEqual([{ type: 'error', code: 'kb-empty', message: expect.stringContaining('libraries') }]);
  });
});

describe('importing a dump that is still downloading, and resuming', () => {
  const many = (n: number) => `<mediawiki>${Array.from({ length: n }, (_, i) => page(`Article ${i}`, lead(`Subject number ${i}`))).join('\n')}</mediawiki>`;
  const meta = (file: string) => { const lib = LibraryDb.open(file); const m = lib.meta(); lib.close(); return m; };

  it('reads parts as they grow and finishes when the last is complete', async () => {
    const xmlText = many(12), cut = Math.floor(xmlText.length / 2);
    const a = path.join(dir, 'grow.partA'), b = path.join(dir, 'grow.partB');
    const bytes = Buffer.from(xmlText), partA = bytes.subarray(0, cut), partB = bytes.subarray(cut);
    fs.writeFileSync(a, partA.subarray(0, 100)); // only a little of it exists to begin with
    const out = path.join(dir, 'grow.db');
    const running = importDump({ dump: 'grow.xml', out, name: 'grow', label: 'Grow', urlBase: 'https://x.test/wiki/', follow: [{ file: a, size: partA.length }, { file: b, size: partB.length }] });
    await new Promise(r => setTimeout(r, 300));
    fs.appendFileSync(a, partA.subarray(100));  // the rest of part A arrives...
    await new Promise(r => setTimeout(r, 300));
    fs.writeFileSync(b, partB);                 // ...then part B appears whole
    const m = await running;
    expect(m.articles).toBe(12);
    const db = LibraryDb.open(out);
    expect(db.search('subject number 7').some(h => h.title === 'Article 7')).toBe(true);
    db.close();
  }, 20000);

  it('picks an interrupted import up where it stopped, ending with exactly what an uninterrupted one gives', async () => {
    const file = path.join(dir, 'resume.xml');
    fs.writeFileSync(file, many(30));
    const out = path.join(dir, 'resume.db');
    const base = { dump: file, out, name: 'resume', label: 'R', urlBase: 'https://x.test/wiki/' };
    await expect(importDump({ ...base, resume: true, maxPages: 11 })).rejects.toThrow('stopped early'); // "killed" after 11 pages
    const resumed = LibraryDb.resume(out);
    expect(resumed?.pagesSeen).toBe(11);
    resumed!.lib.abandon();
    const m = await importDump({ ...base, resume: true });
    expect(m.articles).toBe(30);
    const whole = path.join(dir, 'whole.db');
    const full = await importDump({ ...base, out: whole });
    expect(m.passages).toBe(full.passages);
    const db = LibraryDb.open(out);
    expect(db.search('subject number 29').some(h => h.title === 'Article 29')).toBe(true);
    expect(db.search('subject number 3').filter(h => h.title === 'Article 3')).toHaveLength(1); // nothing imported twice
    db.close();
    expect(fs.existsSync(`${out}-wal`)).toBe(false);   // finished: one plain, read-only-openable file
  }, 20000);

  it('does not list a library whose import has not finished', async () => {
    const lib = path.join(dir, 'unfinished'); fs.mkdirSync(lib);
    const l = LibraryDb.create(path.join(lib, 'half.db'), { name: 'half', label: 'Half', urlBase: 'https://x.test/wiki/', source: 't' }, { durable: true });
    l.begin(); l.addArticle('A', [{ heading: '', text: lead('Something') }]); l.checkpoint(1); l.commit();
    expect(listLibraries(lib)).toEqual([]);   // still being built
    l.abandon();
  });

  it('has nothing to resume from a finished or missing library', async () => {
    expect(LibraryDb.resume(path.join(dir, 'nope.db'))).toBeNull();
    expect(LibraryDb.resume(path.join(dir, 'whole.db'))).toBeNull();
  });
});
