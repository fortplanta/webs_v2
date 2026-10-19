// The companion's record of everything it has been asked to do, shared with the Webs Companion app: an append-only journal
// (one JSON object per line; a run appears again with its new status as it moves on) and, for each finished run, a results
// file holding what was written. Nothing is lost whether or not Webs is open; Webs reads these into its inbox.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'kept';

export interface JournalEntry {
  id: string;
  at: string;
  status: RunStatus;
  mode?: string;
  action?: string;
  label?: string;
  text?: string;
  source?: { app?: string; url?: string; title?: string };
  title?: string;
  error?: string;
}

export interface RunResult { id: string; title: string; markdown: string; finishedAt: string; mode: string; action: string; text: string; source?: { app?: string; url?: string; title?: string } }

export const companionDir = () => process.env.WEBS_COMPANION_DIR || path.join(os.homedir(), 'Documents', 'Webs', 'Companion');

export function appendJournal(entry: JournalEntry, dir = companionDir()): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'journal.jsonl'), `${JSON.stringify(entry)}\n`);
  } catch (err) { console.warn('Could not write the companion journal:', err); }
}

export function writeResult(result: RunResult, dir = companionDir()): void {
  try {
    const folder = path.join(dir, 'results');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${result.id.replace(/[^a-zA-Z0-9-]/g, '')}.json`), JSON.stringify(result, null, 2));
  } catch (err) { console.warn('Could not save a companion result:', err); }
}

/** The journal, one entry per run (the latest line wins), oldest first. */
export function readJournal(dir = companionDir()): JournalEntry[] {
  let raw = '';
  try { raw = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8'); } catch { return []; }
  const byId = new Map<string, JournalEntry>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line) as JournalEntry; if (e?.id) byId.set(e.id, { ...byId.get(e.id), ...e }); } catch { /* a half-written line */ }
  }
  return [...byId.values()];
}

export function readResult(id: string, dir = companionDir()): RunResult | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'results', `${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`), 'utf8')) as RunResult; } catch { return null; }
}
