import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { searchKnowledgeBase } from '../src/backend/kb';
import { JsonObjectStream, parseOverview } from '../src/backend/parse';
import { callOllama } from '../src/backend/llm';
import { runStrategy } from '../src/backend/strategies';
import type { WebEvent } from '../src/backend/events';
import type { LlmService } from '../src/backend/llm';

const kb = path.resolve(__dirname, '../kb');

describe('searchKnowledgeBase', () => {
  it('finds relevant passages', async () => {
    expect(await searchKnowledgeBase('Marcus Aurelius stoicism', kb)).toContain('Meditations');
  });
  it('returns empty string when nothing matches or dir missing', async () => {
    expect(await searchKnowledgeBase('quantum chromodynamics', kb)).toBe('');
    expect(await searchKnowledgeBase('stoicism', '/nonexistent')).toBe('');
  });
});

describe('JsonObjectStream', () => {
  it('emits objects as they close, across arbitrary chunk boundaries, ignoring fences/prose', () => {
    const s = new JsonObjectStream();
    const text = '```json\n{"a":"x}y","b":{"c":1}}\nnoise\n{\n  "a": "\\"q\\""\n}\n```';
    const got: unknown[] = [];
    for (const ch of text) got.push(...s.feed(ch));
    expect(got).toEqual([{ a: 'x}y', b: { c: 1 } }, { a: '"q"' }]);
  });
});

describe('parseOverview', () => {
  it('resolves indexes, falls back to titles, drops invalid edges', () => {
    const o = parseOverview(JSON.stringify({ context: 'c', clusters: [{ title: 'A' }, { title: 'B' }], edges: [{ source: 0, target: 1, label: 'l' }, { source: 'B', target: 'A', label: 'm' }, { source: 0, target: 9, label: 'bad' }, { source: 1, target: 1, label: 'self' }] }));
    expect(o.edges.map(e => [e.source, e.target])).toEqual([[0, 1], [1, 0]]);
  });
});

function fakeLlm(overview: unknown, lines: string[]): LlmService {
  return {
    call: async () => JSON.stringify(overview),
    async *stream() { for (const l of lines) yield l; },
  };
}
const collect = async (it: AsyncGenerator<WebEvent>) => { const out: WebEvent[] = []; for await (const e of it) out.push(e); return out; };
const frag = (cluster: number, title: string) => JSON.stringify({ cluster, type: 'person', title, body: 'b' }) + '\n';
const overview = { context: 'ctx', clusters: [{ title: 'A' }, { title: 'B' }], edges: [{ source: 0, target: 1, label: 'led to' }] };

describe('progressive strategy', () => {
  const cfg = { clusterCount: 2, fragmentsPerCluster: 2 };
  const kbOk = { search: async () => [{ source: 's.md', text: 't' }] };

  it('emits kb → overview → fragments (as they stream) → done', async () => {
    const llm = fakeLlm(overview, [frag(0, 'a1'), frag(0, 'a2') + frag(1, 'b1'), frag(1, 'b2')]);
    const evs = await collect(runStrategy('q', { signal: new AbortController().signal, config: cfg, kb: kbOk, llm }));
    expect(evs.map(e => e.type)).toEqual(['kb', 'status', 'overview', 'status', 'fragment', 'fragment', 'fragment', 'fragment', 'done']);
    const slots = evs.filter(e => e.type === 'fragment').map((e: any) => [e.cluster, e.slot]);
    expect(slots).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  });

  it('falls back to a cluster with room when the model over-fills or mislabels', async () => {
    const llm = fakeLlm(overview, [frag(0, 'a1'), frag(0, 'a2'), frag(0, 'a3'), frag(7, 'x')]);
    const evs = await collect(runStrategy('q', { signal: new AbortController().signal, config: cfg, kb: kbOk, llm }));
    expect(evs.filter(e => e.type === 'fragment').map((e: any) => e.cluster)).toEqual([0, 0, 1, 1]);
  });

  it('reports kb-empty immediately, before any LLM call', async () => {
    const llm = { call: vi.fn(), stream: vi.fn() } as unknown as LlmService;
    const evs = await collect(runStrategy('q', { signal: new AbortController().signal, config: cfg, kb: { search: async () => [] }, llm }));
    expect(evs).toEqual([{ type: 'error', code: 'kb-empty', message: expect.any(String) }]);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('errors if the model yields no usable fragments', async () => {
    const evs = await collect(runStrategy('q', { signal: new AbortController().signal, config: cfg, kb: kbOk, llm: fakeLlm(overview, ['nothing here']) }));
    expect(evs.at(-1)).toMatchObject({ type: 'error', code: 'bad-json' });
  });
});

describe('callOllama errors', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.WEBS_LLM_FIRST_TOKEN_TIMEOUT_MS; });
  it('maps connection failure to ollama-offline', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
    await expect(callOllama({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'ollama-offline' });
  });
  it('maps silence to ollama-timeout', async () => {
    process.env.WEBS_LLM_FIRST_TOKEN_TIMEOUT_MS = '20';
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))));
    await expect(callOllama({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'ollama-timeout' });
  });
  it('maps caller abort to cancelled', async () => {
    const ac = new AbortController();
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))));
    const p = callOllama({ system: 's', user: 'u' }, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('streams chunks split across reads', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) {
      c.enqueue(enc.encode('{"message":{"content":"He"}}\n{"message":{"con'));
      c.enqueue(enc.encode('tent":"llo"}}\n{"done":true}\n'));
      c.close();
    } });
    vi.stubGlobal('fetch', async () => new Response(body));
    expect(await callOllama({ system: 's', user: 'u' })).toBe('Hello');
  });
});
