// The user's own AI provider ("bring your own model"): any OpenAI-compatible chat endpoint (OpenAI, OpenRouter,
// Groq, LM Studio, …) or Anthropic. Used only when the knowledge base has nothing (see strategies/ai.ts).
// Runs in the main process; the API key never reaches the renderer. Same seam as the Ollama client: an LlmService.

import { WebsError } from './errors';
import { callOllama, ollamaLlm, type LlmOptions, type LlmService } from './llm';
import { getSettings } from './settings';
import type { AiSettings, AiTestResult } from '../types/settings';

const FIRST_TOKEN_MS = 60_000;
const IDLE_MS = 30_000;

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/** Whether the provider can be used right now: switched on, a model chosen, and a key (unless it's a local server). */
export function aiReady(ai: AiSettings = getSettings().ai): boolean {
  if (!ai.enabled) return false;
  if (ai.kind === 'ollama') return true; // free and local: nothing to configure; if Ollama isn't running the request says so
  return !!ai.model && (!!ai.apiKey || isLocal(ai.baseUrl));
}

/** The model name shown on AI cards. */
export function aiModelName(): string {
  const s = getSettings();
  return s.ai.kind === 'ollama' ? s.ollama.model : s.ai.model;
}

function endpoint(ai: AiSettings): string {
  const base = ai.baseUrl.replace(/\/+$/, '');
  if (ai.kind === 'anthropic') return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  return `${base}/chat/completions`;
}

function request(ai: AiSettings, o: LlmOptions): { headers: Record<string, string>; body: string } {
  const maxTokens = o.maxTokens ?? 3000;
  if (ai.kind === 'anthropic') {
    return {
      headers: { 'Content-Type': 'application/json', 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, temperature: Math.min(1, o.temperature ?? 0.7), system: o.system, stream: true, messages: [{ role: 'user', content: o.user }] }),
    };
  }
  return {
    headers: { 'Content-Type': 'application/json', ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}) },
    body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, temperature: o.temperature ?? 0.7, stream: true, messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }] }),
  };
}

/** The text carried by one server-sent event's JSON payload, for either API. */
export function deltaText(kind: AiSettings['kind'], payload: any): string {
  if (kind === 'anthropic') return payload?.type === 'content_block_delta' ? String(payload.delta?.text ?? '') : '';
  const c = payload?.choices?.[0]?.delta?.content;
  return typeof c === 'string' ? c : '';
}

function httpError(status: number, detail: string, ai: AiSettings): WebsError {
  const host = (() => { try { return new URL(ai.baseUrl).host; } catch { return ai.baseUrl; } })();
  if (status === 401 || status === 403) return new WebsError('ai-error', `${host} rejected the API key. Check it in Settings.`);
  if (status === 404) return new WebsError('ai-error', `${host} doesn't know the model "${ai.model}". Check the model name in Settings.`);
  if (status === 429) return new WebsError('ai-error', `${host} is rate-limiting you (or the account is out of credit).`);
  return new WebsError('ai-error', `${host} returned ${status}. ${detail}`.trim());
}

async function* streamProvider(opts: LlmOptions, signal?: AbortSignal): AsyncGenerator<string> {
  const ai = getSettings().ai;
  if (!aiReady(ai)) throw new WebsError('ai-error', 'The AI provider is not set up. Add a model and API key in Settings.');
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
  const onAbort = () => controller.abort();
  if (signal?.aborted) throw new WebsError('cancelled', 'Cancelled.');
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    arm(FIRST_TOKEN_MS);
    const { headers, body } = request(ai, opts);
    const res = await fetch(endpoint(ai), { method: 'POST', headers, body, signal: controller.signal });
    if (!res.ok || !res.body) throw httpError(res.status, (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160), ai);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(IDLE_MS);
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let payload: any;
        try { payload = JSON.parse(data); } catch { continue; }
        if (payload?.error) throw new WebsError('ai-error', String(payload.error.message ?? payload.error).slice(0, 200));
        const text = deltaText(ai.kind, payload);
        if (text) yield text;
      }
    }
  } catch (err) {
    if (err instanceof WebsError) throw err;
    if (signal?.aborted) throw new WebsError('cancelled', 'Cancelled.');
    if (timedOut) throw new WebsError('ai-error', 'The AI provider stopped responding.');
    throw new WebsError('ai-error', `Could not reach ${ai.baseUrl}.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function callProvider(opts: LlmOptions, signal?: AbortSignal): Promise<string> {
  let out = '';
  for await (const chunk of streamProvider(opts, signal)) out += chunk;
  return out;
}

export const providerLlm: LlmService = { stream: streamProvider, call: callProvider };

/** The provider as an LlmService if it's usable, else null. */
export function configuredProvider(): LlmService | null {
  if (!aiReady()) return null;
  return getSettings().ai.kind === 'ollama' ? ollamaLlm : providerLlm;
}

/** Settings → "Test": one tiny request with the saved (or just-typed) settings. */
export async function testProvider(): Promise<AiTestResult> {
  const ai = getSettings().ai;
  if (ai.kind === 'ollama') {
    try {
      const reply = await callOllama({ system: 'Reply with the single word OK.', user: 'ping', maxTokens: 8, temperature: 0 }, AbortSignal.timeout(60_000));
      return { ok: true, message: `Connected · ${aiModelName()} replied${reply.trim() ? ` “${reply.trim().slice(0, 20)}”` : ''}.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (!ai.model) return { ok: false, message: 'Enter a model name first.' };
  if (!ai.apiKey && !isLocal(ai.baseUrl)) return { ok: false, message: 'Enter an API key first.' };
  try {
    const reply = await callProvider({ system: 'Reply with the single word OK.', user: 'ping', maxTokens: 8, temperature: 0 }, AbortSignal.timeout(20_000));
    return { ok: true, message: `Connected · ${ai.model} replied${reply.trim() ? ` “${reply.trim().slice(0, 20)}”` : ''}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** What a strategy needs to use the provider, or null if it isn't set up. */
export function aiContext(): { llm: LlmService; model: string; topUp: boolean } | null {
  const llm = configuredProvider();
  return llm ? { llm, model: aiModelName(), topUp: getSettings().ai.topUp } : null;
}
