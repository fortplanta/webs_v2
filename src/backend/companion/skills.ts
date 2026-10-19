// The companion's skills: what each action asks the model to do, kept as plain files (skills/*.md) so they are easy to read
// and edit, with one global voice (skills/voice.md) that every action is run through. A skill file carries only the task;
// anything about tone, mannerism or phrasing lives in the voice, so every action sounds the same.

import fs from 'node:fs';
import path from 'node:path';

export interface Skill { id: string; name: string; mode?: string; hint?: string; level?: number; body: string }
export interface Stage { id: string; name: string; produces: string; needs: string[]; body: string }
export interface WheelEntry { id: string; label: string; show: string[] }
export interface Cascade { name: string; runs: string[]; show?: string[]; wheel: WheelEntry[] }
export interface Keep { label: string; hint: string }
export interface ModeDef { title: string; tagline: string; skills?: string[]; cascade?: string; keeps?: string[] }
export interface Catalog { version: number; modes: Record<string, ModeDef>; cascades: Record<string, Cascade>; keeps: Record<string, Keep> }

/** Where the skills live: WEBS_SKILLS_DIR, the packaged app's resources, or the repo's skills/ folder. */
export function skillsDir(): string {
  const candidates = [process.env.WEBS_SKILLS_DIR, (process as unknown as { resourcesPath?: string }).resourcesPath && path.join((process as unknown as { resourcesPath: string }).resourcesPath, 'skills'), path.resolve(process.cwd(), 'skills')];
  for (const c of candidates) if (c && fs.existsSync(path.join(c, 'catalog.json'))) return c;
  return path.resolve(process.cwd(), 'skills');
}

/** Front matter (`key: value` lines between two `---`) and the body after it. */
export function parseSkillFile(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

const read = (file: string) => fs.readFileSync(file, 'utf8');
const list = (s: string | undefined) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean);

export function loadCatalog(dir = skillsDir()): Catalog { return JSON.parse(read(path.join(dir, 'catalog.json'))) as Catalog; }

/** The global voice: every action's system prompt starts with this. */
export function loadVoice(dir = skillsDir()): string { return parseSkillFile(read(path.join(dir, 'voice.md'))).body; }

export function loadSkill(id: string, dir = skillsDir()): Skill | null {
  const file = path.join(dir, `${id.replace(/[^a-z0-9-]/gi, '')}.md`);
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseSkillFile(read(file));
  return { id: meta.id ?? id, name: meta.name ?? id, mode: meta.mode, hint: meta.hint, level: meta.level ? Number(meta.level) : undefined, body };
}

export function loadStage(id: string, dir = skillsDir()): Stage | null {
  const file = path.join(dir, 'stages', `${id.replace(/[^a-z0-9-]/gi, '')}.md`);
  if (!fs.existsSync(file)) return null;
  const { meta, body } = parseSkillFile(read(file));
  return { id: meta.id ?? id, name: meta.name ?? id, produces: meta.produces ?? id, needs: list(meta.needs), body };
}

/** The modifier keys held together, as the catalog names a mode: "shift", "shift+command", … (always in the order shift, command, control). */
export function modeKey(keys: Iterable<string>): string {
  const held = new Set(keys);
  return ['shift', 'command', 'control'].filter(k => held.has(k)).join('+');
}
