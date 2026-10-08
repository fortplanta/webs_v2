// Runtime settings. Defaults come from env vars (so existing overrides keep working);
// values the user saves in the settings panel override them. Read at call time via getSettings(),
// so a change applies to the next generation with no restart.

import path from 'node:path';
import { defaultWebConfig } from './config';
import type { Settings, SettingsErrors, SettingsPatch } from '../types/settings';

export function defaultSettings(): Settings {
  const idleMs = Number(process.env.WEBS_LLM_IDLE_TIMEOUT_MS);
  return {
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
      strategy: process.env.WEBS_STRATEGY?.trim() || 'progressive',
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
    ollama: { ...base.ollama, ...patch.ollama },
    kb: { ...base.kb, ...patch.kb },
    generation: { ...base.generation, ...patch.generation },
    capture: { ...base.capture, ...patch.capture },
  };
}

export function mergePatches(a: SettingsPatch, b: SettingsPatch): SettingsPatch {
  return { ollama: { ...a.ollama, ...b.ollama }, kb: { ...a.kb, ...b.kb }, generation: { ...a.generation, ...b.generation }, capture: { ...a.capture, ...b.capture } };
}

export function getSettings(): Settings {
  return mergeSettings(defaultSettings(), overrides);
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
