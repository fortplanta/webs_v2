import type { WebEvent } from '../backend/events';

export interface WebsApi {
  /** Starts a generation; events arrive via onEvent until 'done' or 'error'. Returns a cancel function. */
  generate(query: string, onEvent: (event: WebEvent) => void): () => void;
  /** Ask the main process to preload the model. Safe to call repeatedly. */
  warmUp(): void;
}
