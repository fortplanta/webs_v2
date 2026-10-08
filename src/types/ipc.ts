import type { WebEvent } from '../backend/events';
import type { WebModel } from './web';
import type { KbModuleInfo, OllamaModelsResult, SaveSettingsResult, SettingsBundle, SettingsPatch } from './settings';

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

  getSettings(): Promise<SettingsBundle>;
  /** Validates and persists the changed fields; applies to the next generation. */
  saveSettings(patch: SettingsPatch): Promise<SaveSettingsResult>;
  /** Clears all saved overrides (env/built-in defaults apply again). */
  resetSettings(): Promise<SettingsBundle>;
  listOllamaModels(baseUrl: string): Promise<OllamaModelsResult>;
  listKbModules(dir: string): Promise<KbModuleInfo[]>;
  /** Native folder picker; resolves to null if cancelled. */
  pickKbFolder(): Promise<string | null>;
}
