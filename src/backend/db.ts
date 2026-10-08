// Local persistence (SQLite via Node's built-in node:sqlite — no native module to rebuild).
// One row per web: the generation model and the Excalidraw scene are stored as JSON, since the
// app always loads/saves a web as a whole. Schema changes go in MIGRATIONS (order matters).

import { DatabaseSync } from 'node:sqlite';
import type { SavedWeb, SavedWebSummary, SaveWebInput } from '../types/ipc';
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
];

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
    const model = input.model && input.model.phase === 'running' ? { ...input.model, phase: 'cancelled', status: '' } : input.model;
    this.db.prepare(
      `INSERT INTO webs (id, query, model, scene, created_at, updated_at)
       VALUES (?, ?, COALESCE(?, 'null'), COALESCE(?, '[]'), ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         query = excluded.query,
         model = COALESCE(?, model),
         scene = COALESCE(?, scene),
         updated_at = excluded.updated_at`,
    ).run(
      input.id, input.query,
      model ? JSON.stringify(model) : null, input.scene ? JSON.stringify(input.scene) : null,
      now, now,
      model ? JSON.stringify(model) : null, input.scene ? JSON.stringify(input.scene) : null,
    );
  }

  list(): SavedWebSummary[] {
    const rows = this.db.prepare('SELECT id, query, model, updated_at FROM webs WHERE model != \'null\' ORDER BY updated_at DESC').all() as Array<{ id: string; query: string; model: string; updated_at: number }>;
    return rows.map(r => {
      const m = JSON.parse(r.model) as WebModel | null;
      const fragmentCount = m ? m.clusters.reduce((n, c) => n + c.slots.filter(Boolean).length, 0) : 0;
      return { id: r.id, query: r.query, updatedAt: r.updated_at, fragmentCount };
    });
  }

  get(id: string): SavedWeb | null {
    const r = this.db.prepare('SELECT id, query, model, scene FROM webs WHERE id = ?').get(id) as { id: string; query: string; model: string; scene: string } | undefined;
    if (!r) return null;
    const model = JSON.parse(r.model) as WebModel | null;
    if (!model) return null;
    return { id: r.id, query: r.query, model, scene: JSON.parse(r.scene) };
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM webs WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
