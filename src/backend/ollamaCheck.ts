// A health check for the local model, for when generation misbehaves ("is Ollama even running? is the model pulled? does
// it answer in JSON?"). Each step says what it found and, when something is wrong, what to do about it. Pure over an
// injected fetch, so it can be tested without Ollama; scripts/check-ollama.ts runs it for real.

import { repairParse } from './repair';

export type Status = 'pass' | 'warn' | 'fail';
export interface Step { name: string; status: Status; detail: string; ms?: number }
export interface CheckOptions { baseUrl: string; model: string; fetch?: typeof fetch; now?: () => number }

const matches = (installed: string, wanted: string) => installed === wanted || installed === `${wanted}:latest` || (!wanted.includes(':') && installed.startsWith(`${wanted}:`));

export async function checkOllama(opts: CheckOptions): Promise<Step[]> {
  const f = opts.fetch ?? fetch, now = opts.now ?? Date.now;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const steps: Step[] = [];
  const add = (s: Step) => { steps.push(s); return s; };
  const post = (path: string, body: unknown, timeoutMs = 120_000) => f(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });

  // 1. is it running?
  let t = now();
  let installed: string[] = [];
  try {
    const res = await f(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) { add({ name: 'Ollama is running', status: 'fail', detail: `${base} answered ${res.status}. Is that really Ollama?`, ms: now() - t }); return steps; }
    installed = ((await res.json()) as { models?: Array<{ name?: string }> }).models?.map(m => m.name ?? '').filter(Boolean) ?? [];
    let version = '';
    try { version = ((await (await f(`${base}/api/version`, { signal: AbortSignal.timeout(2000) })).json()) as { version?: string }).version ?? ''; } catch { /* older servers have no version endpoint */ }
    add({ name: 'Ollama is running', status: 'pass', detail: `${base}${version ? ` (version ${version})` : ''}, ${installed.length} model${installed.length === 1 ? '' : 's'} installed`, ms: now() - t });
  } catch {
    add({ name: 'Ollama is running', status: 'fail', detail: `Can't reach ${base}. Start it with "ollama serve" (or open the Ollama app), or fix the address in Settings.` });
    return steps;
  }

  // 2. is the model there?
  if (!installed.some(m => matches(m, opts.model))) {
    add({ name: `Model "${opts.model}" is installed`, status: 'fail', detail: `Not found. Run "ollama pull ${opts.model}"${installed.length ? `, or pick one you have: ${installed.join(', ')}` : ''}.` });
    return steps;
  }
  add({ name: `Model "${opts.model}" is installed`, status: 'pass', detail: installed.find(m => matches(m, opts.model))! });

  // 3. does it answer (and how fast)?
  t = now();
  try {
    const res = await post('/api/chat', { model: opts.model, stream: false, think: false, keep_alive: '5m', messages: [{ role: 'user', content: 'Reply with the single word OK.' }], options: { num_predict: 24, temperature: 0 } });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const data = (await res.json()) as { message?: { content?: string }; load_duration?: number; eval_count?: number; eval_duration?: number };
    const reply = data.message?.content ?? '';
    const loadS = (data.load_duration ?? 0) / 1e9, tps = data.eval_count && data.eval_duration ? data.eval_count / (data.eval_duration / 1e9) : 0;
    const speed = tps ? `${tps.toFixed(0)} tokens/s` : 'speed unknown';
    if (/<think>/i.test(reply)) add({ name: 'Model answers', status: 'warn', detail: `It answered, but showed its thinking (<think>) although thinking is switched off, so cards may contain it. Update Ollama or use a model without a thinking mode. ${speed}.`, ms: now() - t });
    else if (!reply.trim()) add({ name: 'Model answers', status: 'fail', detail: 'It returned an empty reply.', ms: now() - t });
    else add({ name: 'Model answers', status: tps && tps < 8 ? 'warn' : 'pass', detail: `${speed}${loadS > 1 ? `, ${loadS.toFixed(1)}s to load into memory (the first generation after a pause pays this)` : ''}${tps && tps < 8 ? '. That is slow: a web will take a while. A smaller model would feel better.' : ''}`, ms: now() - t });
  } catch (err) {
    add({ name: 'Model answers', status: 'fail', detail: `The request failed: ${(err as Error).message}`, ms: now() - t });
    return steps;
  }

  // 4. does JSON mode give JSON? (the whole app runs on it)
  t = now();
  try {
    const res = await post('/api/chat', { model: opts.model, stream: false, think: false, format: 'json', messages: [{ role: 'user', content: 'Reply with a JSON object with the keys "ok" (true) and "words" (an array of three colours).' }], options: { num_predict: 80, temperature: 0 } });
    const reply = ((await res.json()) as { message?: { content?: string } }).message?.content ?? '';
    let strict = true;
    try { JSON.parse(reply); } catch { strict = false; }
    const fixed = strict ? undefined : repairParse(reply);
    if (strict) add({ name: 'JSON mode', status: 'pass', detail: 'Replies parse as JSON.', ms: now() - t });
    else if (fixed) add({ name: 'JSON mode', status: 'warn', detail: 'The reply was not strict JSON but could be repaired. Generation will cope, though a bigger model is steadier.', ms: now() - t });
    else add({ name: 'JSON mode', status: 'fail', detail: `The reply was not JSON: "${reply.slice(0, 80)}". Webs needs a model that can follow a JSON format.`, ms: now() - t });
  } catch (err) {
    add({ name: 'JSON mode', status: 'fail', detail: `The request failed: ${(err as Error).message}`, ms: now() - t });
  }

  // 5. does it stream?
  t = now();
  try {
    const res = await post('/api/chat', { model: opts.model, stream: true, think: false, messages: [{ role: 'user', content: 'Count from one to ten in words.' }], options: { num_predict: 60, temperature: 0 } });
    if (!res.ok || !res.body) throw new Error(`${res.status}`);
    const reader = res.body.getReader();
    let chunks = 0, first = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (value?.length) { chunks++; if (!first) first = now() - t; } }
    add({ name: 'Streaming', status: chunks > 2 ? 'pass' : 'warn', detail: chunks > 2 ? `First words after ${first} ms (${chunks} chunks), so cards appear as they are written.` : 'The reply came in one piece, so cards will appear all at once.', ms: now() - t });
  } catch (err) {
    add({ name: 'Streaming', status: 'fail', detail: `The request failed: ${(err as Error).message}`, ms: now() - t });
  }
  return steps;
}

export const exitCode = (steps: Step[]) => (steps.some(s => s.status === 'fail') ? 1 : 0);
