import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultSettings, getSettings, mergePatches, setSettingsOverrides, validatePatch } from '../src/backend/settings';
import { listKbModules, searchPassages } from '../src/backend/kb';
import { callOllama, listOllamaModels } from '../src/backend/llm';
import { runStrategy } from '../src/backend/strategies';
import { WebStore } from '../src/backend/db';
import type { WebEvent } from '../src/backend/events';

afterEach(() => { setSettingsOverrides({}); vi.unstubAllGlobals(); });
const STRATS = ['progressive', 'other'];

describe('validatePatch', () => {
  it('accepts valid values and normalizes them', () => {
    const { value, errors } = validatePatch({ ollama: { baseUrl: ' http://host:1234/// ', model: ' m ', idleTimeoutSec: 45 }, generation: { clusterCount: 3, strategy: 'other' } }, STRATS);
    expect(errors).toEqual({});
    expect(value.ollama).toEqual({ baseUrl: 'http://host:1234', model: 'm', idleTimeoutSec: 45 });
    expect(value.generation).toEqual({ clusterCount: 3, strategy: 'other' });
  });
  it('reports each bad field by key and drops it', () => {
    const { value, errors } = validatePatch({
      ollama: { baseUrl: 'localhost:11434', model: '  ', idleTimeoutSec: 1 },
      kb: { dir: '' },
      generation: { strategy: 'nope', clusterCount: 0, fragmentsPerCluster: 2.5 },
    }, STRATS);
    expect(Object.keys(errors).sort()).toEqual(['generation.clusterCount', 'generation.fragmentsPerCluster', 'generation.strategy', 'kb.dir', 'ollama.baseUrl', 'ollama.idleTimeoutSec', 'ollama.model']);
    expect(value.ollama).toEqual({});
    expect(value.generation).toEqual({});
  });
  it('rejects non-http URL schemes', () => {
    expect(validatePatch({ ollama: { baseUrl: 'file:///etc/passwd' } }, STRATS).errors['ollama.baseUrl']).toBeDefined();
  });
});

describe('getSettings precedence', () => {
  it('overrides beat env defaults; env beats built-ins; patches merge field by field', () => {
    process.env.WEBS_LLM_MODEL = 'env-model';
    expect(getSettings().ollama.model).toBe('env-model');
    setSettingsOverrides(mergePatches({ ollama: { model: 'saved' } }, { ollama: { baseUrl: 'http://x:1' } }));
    expect(getSettings().ollama).toMatchObject({ model: 'saved', baseUrl: 'http://x:1' });
    delete process.env.WEBS_LLM_MODEL;
    expect(defaultSettings().ollama.model).toBe('qwen3:8b');
  });
});

describe('KB modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  fs.mkdirSync(path.join(dir, 'alpha')); fs.mkdirSync(path.join(dir, 'beta'));
  fs.writeFileSync(path.join(dir, 'alpha', 'a.md'), 'Zebra facts about stripes.');
  fs.writeFileSync(path.join(dir, 'beta', 'b.md'), 'Zebra migration across plains.');
  fs.writeFileSync(path.join(dir, 'root.md'), 'Zebra at the root.');

  it('lists modules with file counts, including root files', async () => {
    expect(await listKbModules(dir)).toEqual([{ name: '(root)', files: 1 }, { name: 'alpha', files: 1 }, { name: 'beta', files: 1 }]);
  });
  it('excludes disabled modules from search', async () => {
    const all = await searchPassages('zebra', dir, []);
    expect(all.map(p => p.source).sort()).toEqual([path.join('alpha', 'a.md'), path.join('beta', 'b.md'), 'root.md']);
    const some = await searchPassages('zebra', dir, ['beta', '(root)']);
    expect(some.map(p => p.source)).toEqual([path.join('alpha', 'a.md')]);
  });
  it('defaults to the saved settings', async () => {
    setSettingsOverrides({ kb: { dir, disabledModules: ['alpha', 'beta'] } });
    expect((await searchPassages('zebra')).map(p => p.source)).toEqual(['root.md']);
  });
});

describe('settings reach the runtime', () => {
  it('LLM client uses the configured URL, model and idle timeout', async () => {
    setSettingsOverrides({ ollama: { baseUrl: 'http://example.test:9', model: 'custom:1b' } });
    const calls: Array<{ url: string; model: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, model: JSON.parse(init.body as string).model });
      return new Response('{"message":{"content":"ok"}}\n');
    });
    expect(await callOllama({ system: 's', user: 'u' })).toBe('ok');
    expect(calls).toEqual([{ url: 'http://example.test:9/api/chat', model: 'custom:1b' }]);
  });

  it('strategy run uses the configured cluster/fragment counts', async () => {
    setSettingsOverrides({ generation: { clusterCount: 2, fragmentsPerCluster: 5 } });
    const evs: WebEvent[] = [];
    const llm = {
      call: async () => JSON.stringify({ context: 'c', clusters: [{ title: 'A' }, { title: 'B' }], edges: [] }),
      async *stream() { yield '{"cluster":0,"type":"person","title":"t","body":"b"}'; },
    };
    for await (const e of runStrategy('q', { signal: new AbortController().signal, kb: { search: async () => [{ source: 's', text: 't' }] }, llm })) evs.push(e);
    const ov = evs.find(e => e.type === 'overview') as Extract<WebEvent, { type: 'overview' }>;
    expect(ov.clusters.map(c => c.slots)).toEqual([5, 5]);
  });

  it('an unknown saved strategy yields an error event, not a crash', async () => {
    setSettingsOverrides({ generation: { strategy: 'gone' } });
    const evs: WebEvent[] = [];
    for await (const e of runStrategy('q', { signal: new AbortController().signal })) evs.push(e);
    expect(evs).toEqual([{ type: 'error', code: 'ollama-error', message: 'Unknown strategy "gone".' }]);
  });
});

describe('listOllamaModels', () => {
  it('returns sorted names, or a readable failure', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ models: [{ name: 'b:1' }, { name: 'a:2' }] })));
    expect(await listOllamaModels('http://h:1/')).toEqual({ ok: true, models: ['a:2', 'b:1'] });
    vi.stubGlobal('fetch', async () => { throw new Error('refused'); });
    expect(await listOllamaModels('http://h:1')).toEqual({ ok: false, message: "Can't reach Ollama at http://h:1." });
  });
});

describe('settings persistence', () => {
  it('round-trips, upserts and deletes a setting', () => {
    const s = new WebStore(':memory:');
    expect(s.getSetting('k')).toBeNull();
    s.setSetting('k', { a: 1 }); s.setSetting('k', { a: 2 });
    expect(s.getSetting('k')).toEqual({ a: 2 });
    s.deleteSetting('k');
    expect(s.getSetting('k')).toBeNull();
  });
});
