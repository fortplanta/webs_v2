import type { WebEvent } from '../backend/events';
import type { WebModel } from './web';

/** Excalidraw elements as stored; opaque to the backend. */
export type SceneElements = unknown[];

export interface SavedWebSummary {
  id: string;
  query: string;
  updatedAt: number;
  fragmentCount: number;
}

export interface SavedWeb {
  id: string;
  query: string;
  model: WebModel;
  scene: SceneElements;
}

/** Partial update: omit a field to leave it as stored. */
export interface SaveWebInput {
  id: string;
  query: string;
  model?: WebModel;
  scene?: SceneElements;
}

export interface WebsApi {
  /** Starts a generation; events arrive via onEvent until 'done' or 'error'. Returns a cancel function. */
  generate(query: string, onEvent: (event: WebEvent) => void): () => void;
  /** Ask the main process to preload the model. Safe to call repeatedly. */
  warmUp(): void;
  listWebs(): Promise<SavedWebSummary[]>;
  loadWeb(id: string): Promise<SavedWeb | null>;
  saveWeb(input: SaveWebInput): Promise<void>;
  deleteWeb(id: string): Promise<void>;
}
