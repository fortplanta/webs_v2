import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebEvent } from '../src/backend/events';
import { WebsError } from '../src/backend/errors';
import { ollamaLlm, type LlmService } from '../src/backend/llm';
import { aiContext, aiReady, deltaText, providerLlm, testProvider } from '../src/backend/provider';
import { getSettings, publicSettings, setSettingsOverrides, validatePatch } from '../src/backend/settings';
import { parseAiOutline } from '../src/backend/strategies/ai';
import { runStrategy } from '../src/backend/strategies';
import { interleave } from '../src/backend/strategies/merge';
import type { Retrieval } from '../src/backend/retrieval/retrieve';
import type { Retriever } from '../src/backend/retrieval/service';
import { initialModel, reduce } from '../src/renderer/webModel';

afterEach(() => { setSettingsOverrides({}); vi.unstubAllGlobals(); });

const collect = async (it: AsyncGenerator<WebEvent>) => { const out: WebEvent[] = []; for await (const e of it) out.push(e); return out; };
const sealed = (key: string) => validatePatch({ ai: { apiKey: key } }, []).value.ai!.apiKey!;
const useAi = (over: Record<string, unknown> = {}) => setSettingsOverrides({ ai: { enabled: true, kind: 'openai', baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: sealed('sk-secret'), topUp: false, ...over } as any });

const none: Retriever = { retrieve: async q => ({ query: q, terms: [], collections: [], considered: 0 }), retrieveFromCard: async () => ({ query: '', terms: [], collections: [], considered: 0 }) };
const passage = (n: number) => ({ id: `a.md#${n}`, source: 'a.md', text: `Passage ${n} about widgets.`, lens: 'direct', heading: `h${n}`, terms: ['widget'], score: { value: 1, rel: 1, conn: 0, nov: 1, red: 0 } });
const oneCollection: Retriever = {
  retrieve: async q => ({ query: q, terms: ['widget'], considered: 2, collections: [{ lens: 'direct', label: 'The thing itself', verb: 'led to', passages: [passage(0), passage(1)] }] }),
  retrieveFromCard: none.retrieveFromCard,
};

const outline = JSON.stringify({ context: 'About zeppelins.', clusters: [{ title: 'Airships', edge: 'led to' }, { title: 'Disasters', edge: 'ended with' }] });
const card = (cluster: number, title: string) => JSON.stringify({ cluster, type: 'concept', title, body: `${title} body.`, bridge: 'b', link: 'http://evil.example', kbSources: ['x.md'] }) + '\n';
const fakeAi = (over: Partial<LlmService> = {}): LlmService => ({
  call: async () => outline,
  async *stream() { yield card(0, 'rigid frame'); yield card(1, 'hindenburg') + card(0, 'gas cells'); },
  ...over,
});
const run = (retriever: Retriever, ai: any, config = { clusterCount: 2, fragmentsPerCluster: 2 }) =>
  collect(runStrategy('zeppelin', { strategy: 'lensed', signal: new AbortController().signal, retriever, ai, config, llm: { call: async () => { throw new WebsError('ollama-offline', 'offline'); }, async *stream() { /* none */ } } }));

describe('AI provider settings', () => {
  it('seals the key, never exposes it to the renderer, and unseals it for the backend', () => {
    useAi();
    expect(getSettings().ai.apiKey).toBe('sk-secret');
    expect(publicSettings(getSettings()).ai.apiKey).toBe('');
    expect(sealed('sk-secret')).not.toBe('sk-secret'); // not stored in the clear (plain: prefix with the default codec, enc1: in the app)
  });
  it('validates fields and ignores a blank key (leaving the saved one)', () => {
    const r = validatePatch({ ai: { kind: 'nope' as any, baseUrl: 'ftp://x', apiKey: '   ', model: ' m ', enabled: true } }, []);
    expect(Object.keys(r.errors).sort()).toEqual(['ai.baseUrl', 'ai.kind']);
    expect(r.value.ai).toEqual({ enabled: true, model: 'm' });
  });
  it('defaults to the free, local, open-source Ollama — on, with gap-filling on', () => {
    const ai = getSettings().ai;
    expect(ai).toMatchObject({ enabled: true, kind: 'ollama', topUp: true, apiKey: '' });
    expect(aiReady(ai)).toBe(true);
    const ctx = aiContext()!;
    expect(ctx.topUp).toBe(true);
    expect(ctx.llm).toBe(ollamaLlm);
    expect(ctx.model).toBe(getSettings().ollama.model);   // cards are labelled with the Ollama model that wrote them
    setSettingsOverrides({ ollama: { model: 'llama3.1:8b' } });
    expect(aiContext()!.model).toBe('llama3.1:8b');
    setSettingsOverrides({ ai: { enabled: false } });
    expect(aiContext()).toBeNull();
  });
  it('lets Ollama have no URL, and rejects unknown kinds', () => {
    expect(validatePatch({ ai: { kind: 'ollama', baseUrl: '' } }, []).errors).toEqual({});
    expect(validatePatch({ ai: { kind: 'gpt5' as any } }, []).errors['ai.kind']).toBeDefined();
  });
  it('a hosted provider is ready only with a model and a key (or a local server)', () => {
    useAi(); expect(aiReady()).toBe(true); expect(aiContext()).toMatchObject({ model: 'test-model', topUp: false });
    useAi({ apiKey: '' }); expect(aiReady()).toBe(false);
    useAi({ apiKey: '', baseUrl: 'http://localhost:1234/v1' }); expect(aiReady()).toBe(true);
    useAi({ model: '' }); expect(aiReady()).toBe(false);
    useAi({ enabled: false }); expect(aiContext()).toBeNull();
  });
});

describe('provider streaming', () => {
  const sse = (...events: string[]) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const x of events) c.enqueue(e.encode(x)); c.close(); } }));
  it('reads OpenAI-style deltas (split across chunks) with the key as a bearer token', async () => {
    useAi();
    const fetchMock = vi.fn(async () => sse('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"del', 'ta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await providerLlm.call({ system: 's', user: 'u' })).toBe('Hello');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as any).Authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'test-model', stream: true });
  });
  it('reads Anthropic events with x-api-key', async () => {
    useAi({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' });
    const fetchMock = vi.fn(async () => sse('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hi"}}\n\n', 'data: {"type":"message_stop"}\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await providerLlm.call({ system: 's', user: 'u' })).toBe('Hi');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as any)['x-api-key']).toBe('sk-secret');
    expect(deltaText('anthropic', { type: 'ping' })).toBe('');
  });
  it('turns provider failures into specific messages', async () => {
    useAi();
    for (const [status, text] of [[401, /rejected the API key/], [404, /model "test-model"/], [429, /rate-limiting/]] as const) {
      vi.stubGlobal('fetch', async () => new Response('x', { status }));
      await expect(providerLlm.call({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'ai-error', message: expect.stringMatching(text) });
    }
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed'); });
    await expect(providerLlm.call({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'ai-error', message: expect.stringContaining('Could not reach') });
  });
  it('tests the connection with one tiny request', async () => {
    useAi();
    vi.stubGlobal('fetch', async () => sse('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n'));
    expect(await testProvider()).toMatchObject({ ok: true, message: expect.stringContaining('test-model') });
    useAi({ model: '' });
    expect(await testProvider()).toMatchObject({ ok: false });
  });
});

describe('interleave', () => {
  async function* slow(label: string, ms: number, n: number) { for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, ms)); yield `${label}${i}`; } }
  it('yields from whichever source is ready, so a slow one never holds up a fast one', async () => {
    const out: string[] = [];
    for await (const x of interleave(slow('slow', 250, 1), slow('fast', 5, 3))) out.push(x);
    expect(out).toEqual(['fast0', 'fast1', 'fast2', 'slow0']);
  });
  it('lets the others finish when one fails, then rethrows', async () => {
    async function* bad(): AsyncGenerator<string> { yield 'x'; throw new Error('boom'); }
    const out: string[] = [];
    await expect((async () => { for await (const v of interleave(bad(), slow('ok', 5, 2))) out.push(v); })()).rejects.toThrow('boom');
    expect(out).toContain('ok1');
  });
});

describe('AI web', () => {
  it('parses an outline, keeping at most `count` titled collections', () => {
    expect(parseAiOutline(outline, 1)).toMatchObject({ titles: ['Airships'], edgeLabels: ['led to'] });
    expect(() => parseAiOutline('{"clusters":[]}', 2)).toThrow();
  });

  it('answers from the AI when the KB has nothing, marking every card and collection as AI', async () => {
    const evs = await run(none, { llm: fakeAi(), model: 'test-model', topUp: false });
    expect(evs.map(e => e.type)).toEqual(['status', 'ai-outline', 'status', 'fragment', 'fragment', 'fragment', 'done']);
    const o = evs.find(e => e.type === 'ai-outline') as any;
    expect(o).toMatchObject({ start: 0, model: 'test-model', clusters: [{ title: 'Airships', slots: 2 }, { title: 'Disasters', slots: 2 }] });
    expect(o.edges).toEqual([{ source: 0, target: 1, label: 'ended with' }]);
    const frags = evs.filter(e => e.type === 'fragment') as any[];
    expect(frags.map(f => [f.cluster, f.slot])).toEqual([[0, 0], [1, 0], [0, 1]]);
    for (const f of frags) {
      expect(f.fragment).toMatchObject({ origin: 'ai', aiModel: 'test-model' });
      expect(f.fragment.link).toBeUndefined();        // the model can't attach links…
      expect(f.fragment.kbSources).toBeUndefined();   // …or pretend to cite the KB
    }
  });

  it('says how to get an answer when there is neither KB content nor an AI provider', async () => {
    const evs = await run(none, null);
    expect(evs).toEqual([{ type: 'error', code: 'kb-empty', message: expect.stringContaining('AI provider') }]);
  });

  it('reports a failing provider as an error when it is the only source', async () => {
    const evs = await run(none, { llm: fakeAi({ call: async () => { throw new WebsError('ai-error', 'bad key'); } }), model: 'm', topUp: false });
    expect(evs.at(-1)).toEqual({ type: 'error', code: 'ai-error', message: 'bad key' });
  });

  it('does not use the AI when the KB found enough (KB first), even if one is set up', async () => {
    const ai = { llm: fakeAi({ call: vi.fn() as any }), model: 'm', topUp: true };
    const evs = await run(oneCollection, ai, { clusterCount: 1, fragmentsPerCluster: 2 });
    expect(ai.llm.call).not.toHaveBeenCalled();
    expect(evs.some(e => e.type === 'ai-outline')).toBe(false);
  });

  it('tops up a thin KB web without waiting: KB cards arrive before a slow AI answer', async () => {
    const slowAi = fakeAi({ call: async () => { await new Promise(r => setTimeout(r, 60)); return outline; } });
    const evs = await run(oneCollection, { llm: slowAi, model: 'm', topUp: true }, { clusterCount: 2, fragmentsPerCluster: 2 });
    const firstAi = evs.findIndex(e => e.type === 'ai-outline');
    const lastKbCard = evs.map((e, i) => (e.type === 'fragment' && !(e as any).fragment.origin ? i : -1)).reduce((a, b) => Math.max(a, b));
    expect(firstAi).toBeGreaterThan(-1);
    expect(lastKbCard).toBeLessThan(firstAi);                              // KB excerpts were already out
    expect((evs.find(e => e.type === 'ai-outline') as any).start).toBe(1); // AI collections go after the KB's
    expect((evs.find(e => e.type === 'ai-outline') as any).clusters).toHaveLength(1); // only the missing one
    expect(evs.filter(e => e.type === 'fragment' && (e as any).fragment.origin === 'ai').length).toBeGreaterThan(0); // the AI's cards still came through
    expect(evs.at(-1)).toMatchObject({ type: 'error', code: 'ollama-offline' }); // the (offline) local writer's failure is reported last, after the AI finished
  });

  it('keeps the KB web and warns when the AI top-up fails', async () => {
    const evs = await run(oneCollection, { llm: fakeAi({ call: async () => { throw new WebsError('ai-error', 'out of credit'); } }), model: 'm', topUp: true });
    expect(evs.some(e => e.type === 'warning' && /out of credit/.test((e as any).message))).toBe(true);
    expect(evs.filter(e => e.type === 'fragment').length).toBeGreaterThan(0);
  });
});

describe('canvas model with AI collections', () => {
  it('adds AI collections after the KB ones and keeps them through a later KB overview', () => {
    let m = initialModel('q');
    m = reduce(m, { type: 'overview', context: '', clusters: [{ title: 'kb', slots: 1 }], edges: [] });
    m = reduce(m, { type: 'ai-outline', start: 1, context: 'ctx', clusters: [{ title: 'ai', slots: 2 }], edges: [{ source: 0, target: 1, label: 'led to' }], model: 'gpt' });
    m = reduce(m, { type: 'fragment', cluster: 1, slot: 0, fragment: { type: 'concept', title: 't', body: 'b', origin: 'ai' } });
    expect(m.clusters.map(c => c.origin)).toEqual([undefined, 'ai']);
    m = reduce(m, { type: 'overview', context: 'model ctx', clusters: [{ title: 'KB titled', slots: 1 }], edges: [] }); // the local model's titles arrive later
    expect(m.clusters.map(c => c.title)).toEqual(['KB titled', 'ai']);
    expect(m.clusters[1].slots[0]?.origin).toBe('ai');
    expect(m.edges).toEqual([{ source: 0, target: 1, label: 'led to' }]);
    expect(m.aiModel).toBe('gpt');
    expect(reduce(m, { type: 'warning', message: 'w' }).warning).toBe('w');
  });
  it('an AI-only web builds its own collections and context', () => {
    const m = reduce(initialModel('q'), { type: 'ai-outline', start: 0, context: 'about it', clusters: [{ title: 'a', slots: 1 }, { title: 'b', slots: 1 }], edges: [{ source: 0, target: 1, label: 'x' }], model: 'm' });
    expect(m.context).toBe('about it');
    expect(m.clusters.map(c => [c.title, c.origin])).toEqual([['a', 'ai'], ['b', 'ai']]);
  });
});
