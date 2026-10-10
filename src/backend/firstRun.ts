// First-run helpers for the packaged app: bring existing data across, and give a new install a KB to
// start from. Pure file operations (paths are passed in), so they can be tested without Electron.

import { DatabaseSync } from 'node:sqlite';
import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type MigrateResult = 'migrated' | 'already-present' | 'no-legacy';

/**
 * Copy an earlier install's database to its new home, once. A SQLite snapshot (VACUUM INTO) is used rather
 * than a file copy, so it is consistent even if the old app is still running with the file open (WAL mode).
 * The original is never modified.
 */
export function migrateLegacyDb(oldFile: string, newFile: string): MigrateResult {
  if (existsSync(newFile)) return 'already-present';
  if (!existsSync(oldFile)) return 'no-legacy';
  mkdirSync(path.dirname(newFile), { recursive: true });
  const target = `'${newFile.replace(/'/g, "''")}'`;
  let db = new DatabaseSync(oldFile, { readOnly: true });
  try {
    try { db.exec(`VACUUM INTO ${target}`); } catch {
      db.close();
      db = new DatabaseSync(oldFile); // some SQLite builds won't VACUUM from a read-only handle
      db.exec(`VACUUM INTO ${target}`);
    }
  } finally {
    db.close();
  }
  return 'migrated';
}

async function hasMarkdown(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) return true;
    if (e.isDirectory() && (await hasMarkdown(path.join(dir, e.name)))) return true;
  }
  return false;
}

/**
 * Create `targetDir` from the bundled sample notes if it doesn't exist or holds no notes. A folder that
 * already has notes (the user's own KB) is never touched. Returns whether anything was copied.
 */
export async function seedKb(sampleDir: string, targetDir: string): Promise<boolean> {
  if (await hasMarkdown(targetDir)) return false;
  if (!(await fs.stat(sampleDir).then(s => s.isDirectory(), () => false))) return false;
  await fs.cp(sampleDir, targetDir, { recursive: true });
  return true;
}
