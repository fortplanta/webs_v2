// Runtime settings. Defaults come from env vars (so existing overrides keep working);
// values the user saves in the settings panel override them. Read at call time via getSettings(),
// so a change applies to the next generation with no restart.

import path from 'node:path';
import { defaultWebConfig } from './config';
import { AI_PRESETS, type Settings, type SettingsErrors, type SettingsPatch } from '../types/settings';

/** Seals/unseals the API key at rest. The main process installs one backed by the OS keychain (Electron safeStorage). */
export interface SecretCodec { encrypt(plain: string): string; decrypt(stored: string): string }
let codec: SecretCodec = { encrypt: s => `plain:${s}`, decrypt: s => (s.startsWith('plain:') ? s.slice(6) : s) };
export function setSecretCodec(next: SecretCodec): void { codec = next; }
export const sealSecret = (plain: string): string => (plain ? codec.encrypt(plain) : '');

export function defaultSettings(): Settings {
  const idleMs = Number(process.env.WEBS_LLM_IDLE_TIMEOUT_MS);
  return {
    library: { dir: process.env.WEBS_LIBRARY_DIR?.trim() || '', disabled: [] },
    images: { wikipedia: true },
    // On by default, with the free local Ollama: when your notes and libraries have nothing (or too little), it answers.
    ai: { enabled: true, kind: 'ollama', baseUrl: '', model: '', apiKey: '', topUp: true },
    ollama: {
      baseUrl: process.env.WEBS_LLM_BASE_URL?.trim() || 'http://localhost:11434',
      model: process.env.WEBS_LLM_MODEL?.trim() || 'qwen3:8b',
      idleTimeoutSec: Number.isFinite(idleMs) && idleMs > 0 ? idleMs / 1000 : 30,
    },
    kb: {
      dir: process.env.WEBS_KB_DIR?.trim() || path.resolve(process.cwd(), 'kb'),
      disabledModules: [],
    },
    generation: {
      strategy: process.env.WEBS_STRATEGY?.trim() || 'lensed',
      clusterCount: defaultWebConfig.clusterCount,
      fragmentsPerCluster: defaultWebConfig.fragmentsPerCluster,
    },
    capture: {
      url: process.env.WEBS_CAPTURE_URL?.trim() || '',
      token: process.env.WEBS_CAPTURE_TOKEN?.trim() || '',
    },
  };
}

let overrides: SettingsPatch = {};

export function setSettingsOverrides(next: SettingsPatch): void {
  overrides = next;
}

export function getSettingsOverrides(): SettingsPatch {
  return overrides;
}

export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  return {
    library: { ...base.library, ...patch.library },
    images: { ...base.images, ...patch.images },
    ai: { ...base.ai, ...patch.ai },
    ollama: { ...base.ollama, ...patch.ollama },
    kb: { ...base.kb, ...patch.kb },
    generation: { ...base.generation, ...patch.generation },
    capture: { ...base.capture, ...patch.capture },
  };
}

export function mergePatches(a: SettingsPatch, b: SettingsPatch): SettingsPatch {
  return { library: { ...a.library, ...b.library }, images: { ...a.images, ...b.images }, ai: { ...a.ai, ...b.ai }, ollama: { ...a.ollama, ...b.ollama }, kb: { ...a.kb, ...b.kb }, generation: { ...a.generation, ...b.generation }, capture: { ...a.capture, ...b.capture } };
}

/** The effective settings, with the API key unsealed. Backend use only: the renderer gets `publicSettings`. */
export function getSettings(): Settings {
  const s = mergeSettings(defaultSettings(), overrides);
  return s.ai.apiKey ? { ...s, ai: { ...s.ai, apiKey: codec.decrypt(s.ai.apiKey) } } : s;
}

/** Settings as the renderer may see them: no API key. */
export function publicSettings(s: Settings): Settings {
  return { ...s, ai: { ...s.ai, apiKey: '' } };
}

export interface Validated {
  value: SettingsPatch;
  errors: SettingsErrors;
}

const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Validates only the fields present in the patch. Invalid fields are reported and dropped. */
export function validatePatch(patch: SettingsPatch, strategies: string[]): Validated {
  const value: SettingsPatch = {};
  const errors: SettingsErrors = {};

  if (patch.images) value.images = patch.images.wikipedia !== undefined ? { wikipedia: !!patch.images.wikipedia } : {};

  if (patch.library) {
    const l: NonNullable<SettingsPatch['library']> = {};
    if (patch.library.dir !== undefined) l.dir = String(patch.library.dir).trim();
    if (patch.library.disabled !== undefined) {
      if (Array.isArray(patch.library.disabled) && patch.library.disabled.every(x => typeof x === 'string')) l.disabled = [...new Set(patch.library.disabled)];
      else errors['library.disabled'] = 'Invalid library list.';
    }
    value.library = l;
  }

  if (patch.ai) {
    const a: NonNullable<SettingsPatch['ai']> = {};
    if (patch.ai.enabled !== undefined) a.enabled = !!patch.ai.enabled;
    if (patch.ai.topUp !== undefined) a.topUp = !!patch.ai.topUp;
    if (patch.ai.kind !== undefined) {
      if (patch.ai.kind === 'ollama' || patch.ai.kind === 'openai' || patch.ai.kind === 'anthropic') a.kind = patch.ai.kind;
      else errors['ai.kind'] = 'Choose Ollama, OpenAI-compatible or Anthropic.';
    }
    if (patch.ai.baseUrl !== undefined) {
      const raw = String(patch.ai.baseUrl).trim().replace(/\/+$/, '');
      let ok = raw === ''; // empty = not used (Ollama uses its own server setting)
      if (!ok) { try { const u = new URL(raw); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* invalid */ } }
      if (ok) a.baseUrl = raw; else errors['ai.baseUrl'] = 'Enter a full http:// or https:// URL.';
    }
    if (patch.ai.model !== undefined) a.model = String(patch.ai.model).trim();
    // A new key is sealed here so it is never written to disk (or kept in memory settings) in the clear.
    if (patch.ai.apiKey !== undefined && String(patch.ai.apiKey).trim()) a.apiKey = sealSecret(String(patch.ai.apiKey).trim());
    value.ai = a;
  }

  if (patch.ollama) {
    const o: NonNullable<SettingsPatch['ollama']> = {};
    if (patch.ollama.baseUrl !== undefined) {
      const raw = String(patch.ollama.baseUrl).trim().replace(/\/+$/, '');
      let ok = false;
      try { const u = new URL(raw); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* invalid */ }
      if (ok) o.baseUrl = raw; else errors['ollama.baseUrl'] = 'Enter a full http:// or https:// URL.';
    }
    if (patch.ollama.model !== undefined) {
      const m = String(patch.ollama.model).trim();
      if (m) o.model = m; else errors['ollama.model'] = 'Choose or enter a model name.';
    }
    if (patch.ollama.idleTimeoutSec !== undefined) {
      const n = patch.ollama.idleTimeoutSec;
      if (typeof n === 'number' && Number.isFinite(n) && n >= 5 && n <= 600) o.idleTimeoutSec = n;
      else errors['ollama.idleTimeoutSec'] = 'Enter 5–600 seconds.';
    }
    value.ollama = o;
  }

  if (patch.kb) {
    const k: NonNullable<SettingsPatch['kb']> = {};
    if (patch.kb.dir !== undefined) {
      const d = String(patch.kb.dir).trim();
      if (d) k.dir = d; else errors['kb.dir'] = 'Choose a knowledge-base folder.';
    }
    if (patch.kb.disabledModules !== undefined) {
      if (Array.isArray(patch.kb.disabledModules) && patch.kb.disabledModules.every(x => typeof x === 'string')) {
        k.disabledModules = [...new Set(patch.kb.disabledModules)];
      } else errors['kb.disabledModules'] = 'Invalid module list.';
    }
    value.kb = k;
  }

  if (patch.generation) {
    const g: NonNullable<SettingsPatch['generation']> = {};
    if (patch.generation.strategy !== undefined) {
      if (strategies.includes(patch.generation.strategy)) g.strategy = patch.generation.strategy;
      else errors['generation.strategy'] = `Unknown strategy. Available: ${strategies.join(', ')}.`;
    }
    if (patch.generation.clusterCount !== undefined) {
      if (intIn(patch.generation.clusterCount, 1, 8)) g.clusterCount = patch.generation.clusterCount;
      else errors['generation.clusterCount'] = 'Enter a whole number from 1 to 8.';
    }
    if (patch.generation.fragmentsPerCluster !== undefined) {
      if (intIn(patch.generation.fragmentsPerCluster, 1, 6)) g.fragmentsPerCluster = patch.generation.fragmentsPerCluster;
      else errors['generation.fragmentsPerCluster'] = 'Enter a whole number from 1 to 6.';
    }
    value.generation = g;
  }

  if (patch.capture) {
    const c: NonNullable<SettingsPatch['capture']> = {};
    if (patch.capture.url !== undefined) {
      const raw = String(patch.capture.url).trim().replace(/\/+$/, '');
      let ok = raw === ''; // empty = disabled
      if (!ok) { try { const u = new URL(raw); ok = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* invalid */ } }
      if (ok) c.url = raw; else errors['capture.url'] = 'Enter a full http:// or https:// URL, or leave empty to disable.';
    }
    if (patch.capture.token !== undefined) c.token = String(patch.capture.token).trim();
    value.capture = c;
  }

  return { value, errors };
}
