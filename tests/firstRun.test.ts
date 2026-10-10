import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyDb, seedKb } from '../src/backend/firstRun';
import { WebStore } from '../src/backend/db';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'webs-first-run-'));

describe('migrateLegacyDb', () => {
  it('copies a live WAL-mode database consistently, leaves the original alone, and runs only once', () => {
    const dir = tmp();
    const oldFile = path.join(dir, 'old', 'webs.db'), newFile = path.join(dir, 'new', 'webs.db');
    fs.mkdirSync(path.dirname(oldFile));
    const store = new WebStore(oldFile); // the "old app", still running with the file open
    store.save({ id: 'w1', query: 'q', model: { query: 'q', phase: 'done', status: '', error: null, kb: [], context: null, clusters: [{ title: 'A', slots: [{ type: 'concept', title: 't', body: 'b' }] }], edges: [] } as any });
    store.setSetting('settings', { generation: { clusterCount: 3 } });
    store.saveFile('w1', { id: 'f', mimeType: 'image/png', dataURL: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`, created: 1 });
    const before = fs.statSync(oldFile).mtimeMs;

    expect(migrateLegacyDb(oldFile, newFile)).toBe('migrated');
    const moved = new WebStore(newFile);
    expect(moved.list().map(w => w.id)).toEqual(['w1']);
    expect(moved.getSetting('settings')).toEqual({ generation: { clusterCount: 3 } });
    expect(moved.files('w1')).toHaveLength(1);
    expect(moved.get('w1')!.query).toBe('q');
    moved.close();

    expect(fs.statSync(oldFile).mtimeMs).toBe(before); // untouched
    expect(store.list()).toHaveLength(1);
    expect(migrateLegacyDb(oldFile, newFile)).toBe('already-present'); // never overwrites
    store.close();
  });

  it('does nothing when there is no earlier install, and never overwrites a new database', () => {
    const dir = tmp();
    expect(migrateLegacyDb(path.join(dir, 'missing.db'), path.join(dir, 'x', 'new.db'))).toBe('no-legacy');
    expect(fs.existsSync(path.join(dir, 'x', 'new.db'))).toBe(false);
    const existing = path.join(dir, 'existing.db');
    new DatabaseSync(existing).close();
    const old = path.join(dir, 'old.db');
    new DatabaseSync(old).close();
    expect(migrateLegacyDb(old, existing)).toBe('already-present');
  });

  it('handles paths containing a quote', () => {
    const dir = tmp();
    const oldFile = path.join(dir, "it's old.db"), newFile = path.join(dir, "it's new", 'webs.db');
    new WebStore(oldFile).close();
    expect(migrateLegacyDb(oldFile, newFile)).toBe('migrated');
    expect(new WebStore(newFile).list()).toEqual([]);
  });
});

describe('seedKb', () => {
  const sample = () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, 'topic'));
    fs.writeFileSync(path.join(d, 'topic', 'note.md'), 'A note.');
    fs.writeFileSync(path.join(d, 'root.md'), 'Another note.');
    return d;
  };

  it('creates a missing folder from the samples', async () => {
    const target = path.join(tmp(), 'Webs', 'KB');
    expect(await seedKb(sample(), target)).toBe(true);
    expect(fs.readFileSync(path.join(target, 'topic', 'note.md'), 'utf8')).toBe('A note.');
    expect(fs.existsSync(path.join(target, 'root.md'))).toBe(true);
  });

  it('seeds an existing but empty folder, including one holding only non-notes', async () => {
    const target = tmp();
    fs.writeFileSync(path.join(target, 'readme.txt'), 'not a note');
    expect(await seedKb(sample(), target)).toBe(true);
    expect(fs.existsSync(path.join(target, 'root.md'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'readme.txt'), 'utf8')).toBe('not a note'); // kept
  });

  it("never touches a folder that already has the user's notes (even nested)", async () => {
    const target = tmp();
    fs.mkdirSync(path.join(target, 'mine'));
    fs.writeFileSync(path.join(target, 'mine', 'mine.md'), 'my own notes');
    expect(await seedKb(sample(), target)).toBe(false);
    expect(fs.readdirSync(target)).toEqual(['mine']);
  });

  it('does nothing if the samples are missing', async () => {
    const target = path.join(tmp(), 'KB');
    expect(await seedKb(path.join(tmp(), 'nope'), target)).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });
});
