import { describe, expect, it } from 'vitest';
import { checkOllama, exitCode } from '../src/backend/ollamaCheck';

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body), body: null }) as unknown as Response;
const stream = (n: number) => ({ ok: true, status: 200, body: new ReadableStream({ start(c) { for (let i = 0; i < n; i++) c.enqueue(new TextEncoder().encode('{}\n')); c.close(); } }) }) as unknown as Response;

/** A fake Ollama: `chat` answers non-streaming chat requests by their `format`. */
function fake(o: { models?: string[]; reply?: string; jsonReply?: string; chunks?: number; down?: boolean } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (o.down) throw new Error('ECONNREFUSED');
    const path = new URL(url).pathname;
    if (path === '/api/tags') return json({ models: (o.models ?? ['qwen3:8b']).map(name => ({ name })) });
    if (path === '/api/version') return json({ version: '0.9.0' });
    const body = JSON.parse(String(init?.body));
    if (body.stream) return stream(o.chunks ?? 12);
    return json({ message: { content: body.format === 'json' ? (o.jsonReply ?? '{"ok":true,"words":["red","green","blue"]}') : (o.reply ?? 'OK') }, eval_count: 100, eval_duration: 2e9, load_duration: 0.1e9 });
  }) as unknown as typeof fetch;
}
const run = (o: Parameters<typeof fake>[0] = {}, model = 'qwen3:8b') => checkOllama({ baseUrl: 'http://x:11434/', model, fetch: fake(o) });

describe('checkOllama', () => {
  it('passes a healthy setup', async () => {
    const steps = await run();
    expect(steps.map(s => s.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(steps[2].detail).toContain('50 tokens/s');
    expect(exitCode(steps)).toBe(0);
  });
  it('says how to start Ollama when it is not running', async () => {
    const steps = await run({ down: true });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'fail' });
    expect(steps[0].detail).toContain('ollama serve');
    expect(exitCode(steps)).toBe(1);
  });
  it('says how to pull a missing model and lists what is installed', async () => {
    const steps = await run({ models: ['llama3:8b'] }, 'qwen3:8b');
    expect(steps.at(-1)).toMatchObject({ status: 'fail' });
    expect(steps.at(-1)!.detail).toContain('ollama pull qwen3:8b');
    expect(steps.at(-1)!.detail).toContain('llama3:8b');
  });
  it('accepts a model name without its tag', async () => { expect((await run({ models: ['qwen3:8b'] }, 'qwen3'))[1].status).toBe('pass'); });
  it('warns when the model shows its thinking, when JSON needs repair, and when it does not stream', async () => {
    expect((await run({ reply: '<think>hmm</think>OK' }))[2].status).toBe('warn');
    expect((await run({ jsonReply: '{"ok": true,}' }))[3].status).toBe('warn');
    expect((await run({ chunks: 1 }))[4].status).toBe('warn');
  });
  it('fails when JSON mode returns prose', async () => {
    const steps = await run({ jsonReply: 'Sure! Here are some colours.' });
    expect(steps[3].status).toBe('fail');
    expect(exitCode(steps)).toBe(1);
  });
});
