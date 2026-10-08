export interface Settings {
  ollama: { baseUrl: string; model: string; idleTimeoutSec: number };
  kb: { dir: string; disabledModules: string[] };
  generation: { strategy: string; clusterCount: number; fragmentsPerCluster: number };
  /** The webs-capture service. Empty url = capture inbox disabled (no network traffic). */
  capture: { url: string; token: string };
}

export type SettingsPatch = {
  [K in keyof Settings]?: Partial<Settings[K]>;
};

export interface KbModuleInfo {
  name: string;
  files: number;
}

export interface SettingsBundle {
  settings: Settings;
  defaults: Settings;
  strategies: string[];
  modules: KbModuleInfo[];
}

/** Field-keyed messages, e.g. { 'ollama.baseUrl': 'Must be an http(s) URL.' }. */
export type SettingsErrors = Record<string, string>;

export type SaveSettingsResult =
  | { ok: true; bundle: SettingsBundle }
  | { ok: false; errors: SettingsErrors };

export type OllamaModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; message: string };
