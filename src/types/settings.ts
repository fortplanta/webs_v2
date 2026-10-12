export type AiKind = 'openai' | 'anthropic';

export const AI_PRESETS: Record<string, { label: string; kind: AiKind; baseUrl: string; model: string }> = {
  openai: { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-4-5' },
  openrouter: { label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq: { label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  lmstudio: { label: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', model: '' },
};

/** The user's own AI provider, used only when the knowledge base has nothing (see strategies/ai.ts). */
export interface AiSettings {
  enabled: boolean;
  /** 'openai' = any OpenAI-compatible chat endpoint (OpenAI, OpenRouter, Groq, LM Studio, …); 'anthropic' = Claude. */
  kind: AiKind;
  baseUrl: string;
  model: string;
  /** Never sent to the renderer: reads back as '' (see SettingsBundle.aiKeySet). A non-empty value in a patch replaces the key. */
  apiKey: string;
  /** Also add AI collections when the knowledge base finds fewer than were asked for. */
  topUp: boolean;
}

export interface LibraryInfo {
  name: string;
  label: string;
  articles: number;
  passages: number;
  /** File size on disk. */
  bytes: number;
}

export interface Settings {
  /** Big offline reference libraries (Wikipedia, …): the second tier, consulted when your notes have nothing. */
  library: { dir: string; disabled: string[] };
  ai: AiSettings;
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
  /** Whether an API key is saved (the key itself never leaves the main process). */
  aiKeySet: boolean;
  libraries: LibraryInfo[];
}

/** Field-keyed messages, e.g. { 'ollama.baseUrl': 'Must be an http(s) URL.' }. */
export type SettingsErrors = Record<string, string>;

export type SaveSettingsResult =
  | { ok: true; bundle: SettingsBundle }
  | { ok: false; errors: SettingsErrors };

export type OllamaModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; message: string };

export type AiTestResult = { ok: true; message: string } | { ok: false; message: string };
