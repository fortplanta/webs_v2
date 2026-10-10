// Strategy registry. To change what is fetched, how, and when: add a Strategy and register it here,
// then select it in Settings or with WEBS_STRATEGY=<name> (default: lensed; 'progressive' is the simple
// keyword-only baseline, handy for comparing).

import { WebsError } from '../errors';
import type { WebEvent } from '../events';
import type { WebConfig } from '../config';
import { getSettings } from '../settings';
import { fileKb, type KbService } from '../kb';
import { ollamaLlm, type LlmService } from '../llm';
import { kbRetriever, type Retriever } from '../retrieval/service';
import { lensed } from './lensed';
import { progressive } from './progressive';
import type { Strategy } from './types';

export const strategies: Record<string, Strategy> = { lensed, progressive };

export interface RunOptions {
  signal: AbortSignal;
  strategy?: string;
  config?: WebConfig;
  kb?: KbService;
  retriever?: Retriever;
  llm?: LlmService;
}

/** Runs a strategy and guarantees the stream ends with exactly one 'done' or 'error' event (none if cancelled). */
export async function* runStrategy(query: string, opts: RunOptions): AsyncGenerator<WebEvent> {
  const { generation } = getSettings();
  const name = opts.strategy ?? generation.strategy;
  const strategy = strategies[name];
  if (!strategy) {
    yield { type: 'error', code: 'ollama-error', message: `Unknown strategy "${name}".` };
    return;
  }
  try {
    yield* strategy({
      query,
      signal: opts.signal,
      config: opts.config ?? { clusterCount: generation.clusterCount, fragmentsPerCluster: generation.fragmentsPerCluster },
      kb: opts.kb ?? fileKb,
      retriever: opts.retriever ?? kbRetriever,
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
