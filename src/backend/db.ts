// Local persistence (SQLite via Node's built-in node:sqlite — no native module to rebuild).
// One row per web: the generation model and the Excalidraw scene are stored as JSON, since the
// app always loads/saves a web as a whole. Schema changes go in MIGRATIONS (order matters).

import { DatabaseSync } from 'node:sqlite';
import type { SavedFile, SavedWeb, SavedWebSummary, SaveWebInput } from '../types/ipc';
import type { WebModel } from '../types/web';

const MIGRATIONS: string[] = [
  `CREATE TABLE webs (
     id         TEXT PRIMARY KEY,
     query      TEXT NOT NULL,
     model      TEXT NOT NULL DEFAULT 'null',
     scene      TEXT NOT NULL DEFAULT '[]',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX webs_updated ON webs (updated_at DESC);`,
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  // fragment_count is what the library shows. Once the scene carries structured box data
  // (customData), manual edits change the count, so the scene becomes its source.
  `ALTER TABLE webs ADD COLUMN fragment_count INTEGER;
   ALTER TABLE webs ADD COLUMN count_from_scene INTEGER NOT NULL DEFAULT 0;`,
  // Image pixels live beside the scene, keyed by Excalidraw's content-hash file id. No FK to webs: a
  // file can arrive a moment before the first model save has created the row; deleteWeb removes them.
  `CREATE TABLE web_files (
     web_id  TEXT NOT NULL,
     id      TEXT NOT NULL,
     mime    TEXT NOT NULL,
     data    BLOB NOT NULL,
     created INTEGER NOT NULL,
     PRIMARY KEY (web_id, id)
   );`,
];

const FILE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon']);
const MAX_FILE_BYTES = 16 * 1024 * 1024; // sanity bound; the renderer keeps images far below this
const DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/;

function countModelFragments(model: WebModel): number {
  return model.clusters.reduce((n, c) => n + c.slots.filter(Boolean).length, 0);
}

/** null if the scene has no structured box data (older scenes, or none yet). */
function countSceneFragments(scene: unknown[]): number | null {
  let hasData = false, count = 0;
  for (const e of scene as Array<{ isDeleted?: boolean; customData?: { kind?: string } }>) {
    const kind = e?.customData?.kind;
    if (kind !== 'fragment' && kind !== 'cluster') continue;
    hasData = true;
    if (kind === 'fragment' && !e.isDeleted) count++;
  }
  return hasData ? count : null;
}

export class WebStore {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  save(input: SaveWebInput, now = Date.now()): void {
    // A run that was interrupted (app closed mid-generation) must not reopen as "running".
    const model = input.model && input.model.phase === 'running' ? { ...input.model, phase: 'cancelled' as const, status: '' } : input.model;
    const prev = this.db.prepare('SELECT fragment_count, count_from_scene FROM webs WHERE id = ?').get(input.id) as { fragment_count: number | null; count_from_scene: number } | undefined;
    const sceneCount = input.scene ? countSceneFragments(input.scene) : null;
    let fragmentCount = prev?.fragment_count ?? null;
    let fromScene = prev?.count_from_scene ?? 0;
    if (sceneCount !== null) { fragmentCount = sceneCount; fromScene = 1; }
    else if (model && !fromScene) fragmentCount = countModelFragments(model);

    this.db.prepare(
      `INSERT INTO webs (id, query, model, scene, created_at, updated_at, fragment_count, count_from_scene)
       VALUES (?, ?, COALESCE(?, 'null'), COALESCE(?, '[]'), ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         fragment_count = excluded.fragment_count,
         count_from_scene = excluded.count_from_scene,
         query = excluded.query,
         model = COALESCE(?, model),
         scene = COALESCE(?, scene),
         updated_at = excluded.updated_at`,
    ).run(
      input.id, input.query,
      model ? JSON.stringify(model) : null, input.scene ? JSON.stringify(input.scene) : null,
      now, now, fragmentCount, fromScene,
      model ? JSON.stringify(model) : null, input.scene ? JSON.stringify(input.scene) : null,
    );
  }

  list(): SavedWebSummary[] {
    const rows = this.db.prepare('SELECT id, query, model, updated_at, fragment_count FROM webs WHERE model != \'null\' ORDER BY updated_at DESC').all() as Array<{ id: string; query: string; model: string; updated_at: number; fragment_count: number | null }>;
    return rows.map(r => ({
      id: r.id, query: r.query, updatedAt: r.updated_at,
      // Rows saved before fragment_count existed fall back to counting the model.
      fragmentCount: r.fragment_count ?? countModelFragments(JSON.parse(r.model) as WebModel),
    }));
  }

  get(id: string): SavedWeb | null {
    const r = this.db.prepare('SELECT id, query, model, scene FROM webs WHERE id = ?').get(id) as { id: string; query: string; model: string; scene: string } | undefined;
    if (!r) return null;
    const model = JSON.parse(r.model) as WebModel | null;
    if (!model) return null;
    return { id: r.id, query: r.query, model, scene: JSON.parse(r.scene), files: this.files(id) };
  }

  saveFile(webId: string, file: SavedFile): void {
    const m = DATA_URL.exec(file.dataURL);
    if (!m) throw new Error('Image data must be a base64 data URL.');
    if (!FILE_MIMES.has(m[1])) throw new Error(`Unsupported image type ${m[1]}.`);
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Image is too large to store.');
    this.db.prepare(
      `INSERT INTO web_files (web_id, id, mime, data, created) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(web_id, id) DO NOTHING`,
    ).run(webId, file.id, m[1], bytes, file.created);
  }

  files(webId: string): SavedFile[] {
    const rows = this.db.prepare('SELECT id, mime, data, created FROM web_files WHERE web_id = ?').all(webId) as Array<{ id: string; mime: string; data: Uint8Array; created: number }>;
    return rows.map(r => ({ id: r.id, mimeType: r.mime, created: r.created, dataURL: `data:${r.mime};base64,${Buffer.from(r.data).toString('base64')}` }));
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM webs WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM web_files WHERE web_id = ?').run(id);
  }

  getSetting<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  close(): void {
    this.db.close();
  }
}
