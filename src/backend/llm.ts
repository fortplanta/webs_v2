// LLM client — runs in the Electron main process (Node), never in the renderer.
// `stream` is the provider seam: add Claude/other providers behind the same LlmService.
// Timeouts are idle-based: a long generation that keeps producing tokens is never killed.

import { WebsError } from './errors';

export interface LlmOptions {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  temperature?: number;
}

export interface LlmService {
  /** Yields content chunks as they are generated. */
  stream(opts: LlmOptions, signal?: AbortSignal): AsyncGenerator<string>;
  /** Convenience: collects the whole stream. */
  call(opts: LlmOptions, signal?: AbortSignal): Promise<string>;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_IDLE_MS = 30_000; // max silence between chunks
const DEFAULT_FIRST_TOKEN_MS = 60_000; // allows for a cold model load

export function llmModelName(): string {
  return process.env.WEBS_LLM_MODEL?.trim() || DEFAULT_MODEL;
}

function baseUrl(): string {
  return (process.env.WEBS_LLM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface OllamaChunk {
  message?: { content?: string };
  response?: string;
  done?: boolean;
}

export async function* streamOllama(
  { system, user, maxTokens = 3000, json = false, temperature = 0.7 }: LlmOptions,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const idleMs = envMs('WEBS_LLM_IDLE_TIMEOUT_MS', DEFAULT_IDLE_MS);
  const firstMs = envMs('WEBS_LLM_FIRST_TOKEN_TIMEOUT_MS', DEFAULT_FIRST_TOKEN_MS);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  };
  const onAbort = () => controller.abort();
  if (signal?.aborted) throw new WebsError('cancelled', 'Cancelled.');
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    arm(firstMs);
    const response = await fetch(`${baseUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: llmModelName(),
        stream: true,
        think: false,
        keep_alive: '30m',
        format: json ? 'json' : undefined,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: { num_predict: maxTokens, temperature },
      }),
    });

    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new WebsError('ollama-error', `Ollama returned ${response.status}. ${detail}`.trim());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm(idleMs);
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let chunk: OllamaChunk;
        try { chunk = JSON.parse(line); } catch { continue; }
        const text = chunk.message?.content ?? chunk.response ?? '';
        if (text) yield text;
      }
    }
  } catch (err) {
    if (err instanceof WebsError) throw err;
    if (signal?.aborted) throw new WebsError('cancelled', 'Cancelled.');
    if (timedOut) {
      throw new WebsError('ollama-timeout', `Ollama stopped responding for ${Math.round(idleMs / 1000)}s.`);
    }
    throw new WebsError('ollama-offline', `Could not reach Ollama at ${baseUrl()}. Is it running? (ollama serve)`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function callOllama(opts: LlmOptions, signal?: AbortSignal): Promise<string> {
  let out = '';
  for await (const chunk of streamOllama(opts, signal)) out += chunk;
  return out;
}

export const ollamaLlm: LlmService = { stream: streamOllama, call: callOllama };

/** Load the model into memory so the first real request doesn't pay the cold-start. Never throws. */
export async function warmUp(): Promise<void> {
  try {
    await fetch(`${baseUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llmModelName(), keep_alive: '30m' }),
    });
  } catch { /* Ollama offline — the real request will report it */ }
}
