// The companion's journal, read as Webs' inbox: finished answers and kept selections that have not yet been put on a canvas
// (or dismissed). Which ones are done with is remembered in a small file beside the journal, so it holds across restarts.

import fs from 'node:fs';
import path from 'node:path';
import type { CompanionItem } from '../../types/companion';
import { companionDir, readJournal, readResult } from './journal';

type Handled = Record<string, { state: 'filed' | 'dismissed'; at: string }>;

const stateFile = (dir: string) => path.join(dir, 'inbox-state.json');

function readHandled(dir: string): Handled {
  try { const h = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')); return h && typeof h === 'object' ? h as Handled : {}; } catch { return {}; }
}

/** Things waiting to be placed, newest first. */
export function listCompanionInbox(dir = companionDir()): CompanionItem[] {
  const handled = readHandled(dir);
  const items: CompanionItem[] = [];
  for (const e of readJournal(dir)) {
    if (handled[e.id]) continue;
    if (e.status === 'done') {
      const r = readResult(e.id, dir);
      if (!r?.markdown.trim()) continue;
      items.push({ id: e.id, at: r.finishedAt || e.at, kind: 'result', title: r.title || e.title || 'Companion answer', body: r.markdown, action: r.action, selection: r.text, source: r.source });
    } else if (e.status === 'kept' && e.text?.trim()) {
      items.push({ id: e.id, at: e.at, kind: 'kept', title: e.label || 'Kept', body: e.text, action: e.action ?? '', source: e.source });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function markCompanion(id: string, state: 'filed' | 'dismissed', dir = companionDir()): { ok: boolean; message?: string } {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) return { ok: false, message: 'Unknown item.' };
  try {
    const handled = readHandled(dir);
    handled[id] = { state, at: new Date().toISOString() };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile(dir), JSON.stringify(handled));
    return { ok: true };
  } catch (err) { return { ok: false, message: err instanceof Error ? err.message : String(err) }; }
}
