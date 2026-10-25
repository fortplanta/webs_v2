import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCompanionInbox, markCompanion } from '../src/backend/companion/inbox';
import { appendJournal, writeResult } from '../src/backend/companion/journal';
import { fragmentFromCompanion } from '../src/renderer/capture';

describe('the companion inbox', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinbox-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = (n: number) => new Date(2026, 9, 26, 10, n).toISOString();

  appendJournal({ id: 'aaaaaaaa-1', at: at(1), status: 'running', action: 'devils-advocate', text: 'we should rewrite it' }, dir);
  writeResult({ id: 'aaaaaaaa-1', title: "Devil's advocate", markdown: '## The case against\n\nIt is risky.', finishedAt: at(2), mode: 'shift', action: 'devils-advocate', text: 'we should rewrite it', source: { url: 'https://x.test/a' } }, dir);
  appendJournal({ id: 'aaaaaaaa-1', at: at(2), status: 'done', title: "Devil's advocate" }, dir);
  appendJournal({ id: 'bbbbbbbb-2', at: at(3), status: 'running', mode: 'control', action: 'note', text: 'remember this' }, dir);
  appendJournal({ id: 'bbbbbbbb-2', at: at(4), status: 'kept', label: 'Keep as a note' }, dir);
  appendJournal({ id: 'cccccccc-3', at: at(5), status: 'running', action: 'x', text: 'bad' }, dir);
  appendJournal({ id: 'cccccccc-3', at: at(6), status: 'error', error: 'offline' }, dir);
  appendJournal({ id: 'dddddddd-4', at: at(7), status: 'running', action: 'x', text: 'half' }, dir);

  it('lists finished answers and kept selections, newest first, and leaves out errors and unfinished runs', () => {
    const items = listCompanionInbox(dir);
    expect(items.map(i => i.id)).toEqual(['bbbbbbbb-2', 'aaaaaaaa-1']);
    expect(items[0]).toMatchObject({ kind: 'kept', title: 'Keep as a note', body: 'remember this' });
    expect(items[1]).toMatchObject({ kind: 'result', body: '## The case against\n\nIt is risky.', selection: 'we should rewrite it' });
  });

  it('forgets an item once it is filed or dismissed, and remembers that', () => {
    expect(markCompanion('aaaaaaaa-1', 'filed', dir)).toEqual({ ok: true });
    expect(listCompanionInbox(dir).map(i => i.id)).toEqual(['bbbbbbbb-2']);
    markCompanion('bbbbbbbb-2', 'dismissed', dir);
    expect(listCompanionInbox(dir)).toEqual([]);
    expect(markCompanion('../evil', 'filed', dir).ok).toBe(false);
  });

  it('turns an item into a card, dropping markdown heading marks and linking its source', () => {
    const f = fragmentFromCompanion({ id: 'a', at: '', kind: 'result', title: "Devil's advocate", body: '## The case against\n\nIt is risky.', action: 'devils-advocate', source: { url: 'https://x.test/a' } });
    expect(f).toMatchObject({ type: 'source', title: "Devil's advocate", link: 'https://x.test/a', tags: ['companion', 'devils-advocate'] });
    expect(f.body).toBe('The case against\n\nIt is risky.');
    expect(fragmentFromCompanion({ id: 'b', at: '', kind: 'kept', title: 'Kept', body: 'text', action: '' }).type).toBe('concept');
  });
});
