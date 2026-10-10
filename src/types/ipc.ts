import type { PivotEvent, PivotRequest, WebEvent } from '../backend/events';
import type { WebModel } from './web';
import type { CaptureTestResult, InboxResult } from './capture';
import type { KbModuleInfo, OllamaModelsResult, SaveSettingsResult, SettingsBundle, SettingsPatch } from './settings';

/** Excalidraw elements as stored; opaque to the backend. */
export type SceneElements = unknown[];

/** An image's pixel data (Excalidraw's BinaryFileData), stored apart from the scene JSON. */
export interface SavedFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

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
  files: SavedFile[];
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
  /** Grow a new collection from a card; events arrive until 'done' or 'error'. Returns a cancel function. */
  pivot(req: PivotRequest, onEvent: (event: PivotEvent) => void): () => void;
  listWebs(): Promise<SavedWebSummary[]>;
  loadWeb(id: string): Promise<SavedWeb | null>;
  saveWeb(input: SaveWebInput): Promise<void>;
  deleteWeb(id: string): Promise<void>;
  /** Persist one image's pixels for a web. Idempotent per file id. */
  saveFile(webId: string, file: SavedFile): Promise<{ ok: boolean; message?: string }>;

  getSettings(): Promise<SettingsBundle>;
  /** Validates and persists the changed fields; applies to the next generation. */
  saveSettings(patch: SettingsPatch): Promise<SaveSettingsResult>;
  /** Clears all saved overrides (env/built-in defaults apply again). */
  resetSettings(): Promise<SettingsBundle>;
  listOllamaModels(baseUrl: string): Promise<OllamaModelsResult>;
  listKbModules(dir: string): Promise<KbModuleInfo[]>;
  /** Native folder picker; resolves to null if cancelled. */
  pickKbFolder(): Promise<string | null>;

  /** Pending captures from the webs-capture service (empty-handed if not configured/reachable). */
  getInbox(): Promise<InboxResult>;
  /** Mark a capture as placed on the canvas (nodeId = the card's element id). */
  fileCapture(id: string, nodeId: string): Promise<{ ok: boolean; message?: string }>;
  dismissCapture(id: string): Promise<{ ok: boolean; message?: string }>;
  /** Test a service URL + token without saving them. */
  testCapture(url: string, token: string): Promise<CaptureTestResult>;
}
