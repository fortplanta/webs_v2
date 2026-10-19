import type { WebConfig } from '../config';
import type { WebEvent } from '../events';
import type { KbService } from '../kb';
import type { LlmService } from '../llm';
import type { Retriever } from '../retrieval/service';
import type { ArticleMedia, WebImage } from '../library/images';
import type { LibraryRetriever } from '../library/service';
import type { AiContext } from './ai';

export interface StrategyContext {
  query: string;
  signal: AbortSignal;
  config: WebConfig;
  kb: KbService;
  retriever: Retriever;
  llm: LlmService;
  /** Offline reference libraries (Wikipedia, …), consulted when the notes have nothing. */
  library: LibraryRetriever | null;
  /** Fetches an article's picture (Wikipedia libraries only); null when switched off. */
  images: ((urlBase: string, title: string, signal: AbortSignal) => Promise<WebImage | null>) | null;
  /** An article's other pictures, a map for a place, clips: the same Wikipedia switch as `images`. */
  media: ((urlBase: string, title: string, hint: string, signal: AbortSignal) => Promise<ArticleMedia>) | null;
  /** The user's own AI provider, when set up. */
  ai: AiContext | null;
}

/**
 * A fetch strategy decides what to retrieve and generate, in what order, and when to emit it.
 * Yield events as soon as they're ready — the canvas renders each one immediately.
 * Throw WebsError to report a failure; the runner converts it to an 'error' event.
 */
export type Strategy = (ctx: StrategyContext) => AsyncGenerator<WebEvent>;
