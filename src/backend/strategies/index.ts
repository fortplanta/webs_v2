// Strategy registry. To change what is fetched, how, and when: add a Strategy and register it here,
// then select it with WEBS_STRATEGY=<name> (default: progressive).

import { WebsError } from '../errors';
import type { WebEvent } from '../events';
import { defaultWebConfig, type WebConfig } from '../config';
import { fileKb, type KbService } from '../kb';
import { ollamaLlm, type LlmService } from '../llm';
import { progressive } from './progressive';
import type { Strategy } from './types';

export const strategies: Record<string, Strategy> = { progressive };

export interface RunOptions {
  signal: AbortSignal;
  strategy?: string;
  config?: WebConfig;
  kb?: KbService;
  llm?: LlmService;
}

/** Runs a strategy and guarantees the stream ends with exactly one 'done' or 'error' event (none if cancelled). */
export async function* runStrategy(query: string, opts: RunOptions): AsyncGenerator<WebEvent> {
  const name = opts.strategy ?? (process.env.WEBS_STRATEGY?.trim() || 'progressive');
  const strategy = strategies[name];
  if (!strategy) {
    yield { type: 'error', code: 'ollama-error', message: `Unknown strategy "${name}".` };
    return;
  }
  try {
    yield* strategy({
      query,
      signal: opts.signal,
      config: opts.config ?? defaultWebConfig,
      kb: opts.kb ?? fileKb,
      llm: opts.llm ?? ollamaLlm,
    });
    yield { type: 'done' };
  } catch (err) {
    if (err instanceof WebsError) {
      if (err.code !== 'cancelled') yield { type: 'error', code: err.code, message: err.message };
    } else {
      yield { type: 'error', code: 'ollama-error', message: (err as Error).message };
    }
  }
}
