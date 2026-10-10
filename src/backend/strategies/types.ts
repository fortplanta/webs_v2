import type { WebConfig } from '../config';
import type { WebEvent } from '../events';
import type { KbService } from '../kb';
import type { LlmService } from '../llm';
import type { Retriever } from '../retrieval/service';

export interface StrategyContext {
  query: string;
  signal: AbortSignal;
  config: WebConfig;
  kb: KbService;
  retriever: Retriever;
  llm: LlmService;
}

/**
 * A fetch strategy decides what to retrieve and generate, in what order, and when to emit it.
 * Yield events as soon as they're ready — the canvas renders each one immediately.
 * Throw WebsError to report a failure; the runner converts it to an 'error' event.
 */
export type Strategy = (ctx: StrategyContext) => AsyncGenerator<WebEvent>;
