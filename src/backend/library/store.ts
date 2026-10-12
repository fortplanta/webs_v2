// A "library": a big read-only reference collection (Wikipedia, say) kept in one SQLite file. Passage text is
// deflate-compressed in an ordinary table; a contentless FTS5 table (Porter stemming) holds only the search index,
// so the file stays small and searching never loads the collection into memory. Your own notes stay in the
// in-memory KB; libraries are the second tier, consulted when your notes have nothing.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { contentWords } from '../retrieval/text';
import type { Passage } from './wikitext';

export interface LibraryMeta {
  name: string;
  label: string;
  /** Prefix for an article's web address, e.g. https://simple.wikipedia.org/wiki/ */
  urlBase: string;
  articles: number;
  passages: number;
  source: string;
  importedAt: string;
}

export interface LibraryHit {
  id: number;
  title: string;
  heading: string;
  /** Position within its article: 0 is the opening passage. */
  seq: number;
  text: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passage (id INTEGER PRIMARY KEY, title TEXT NOT NULL, heading TEXT NOT NULL, seq INTEGER NOT NULL, z BLOB NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(title, heading, body, content='', tokenize='porter unicode61 remove_diacritics 2');
`;

/** Quote each word so FTS syntax in the query can't break the search. `any` matches passages with at least one word (bm25 ranks by how many). */
export function ftsQuery(query: string, mode: 'any' | 'all' = 'any'): string | null {
  const ws = [...new Set(contentWords(query))].slice(0, 12);
  return ws.length ? ws.map(w => `"${w.replace(/"/g, '')}"`).join(mode === 'all' ? ' AND ' : ' OR ') : null;
}

export class LibraryDb {
  private db: DatabaseSync;
  private articles = 0;
  private passages = 0;

  private constructor(file: string, readOnly: boolean) {
    this.db = new DatabaseSync(file, { readOnly });
    if (!readOnly) { this.db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;'); this.db.exec(SCHEMA); }
  }

  /** Start a new library file (replacing any existing one). */
  static create(file: string, meta: Pick<LibraryMeta, 'name' | 'label' | 'urlBase' | 'source'>): LibraryDb {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.rmSync(file, { force: true });
    const lib = new LibraryDb(file, false);
    for (const [k, v] of Object.entries(meta)) lib.setMeta(k, v);
    return lib;
  }

  static open(file: string): LibraryDb {
    return new LibraryDb(file, true);
  }

  private setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  get counts(): { articles: number; passages: number } { return { articles: this.articles, passages: this.passages }; }

  begin() { this.db.exec('BEGIN'); }
  commit() { this.db.exec('COMMIT'); }

  addArticle(title: string, passages: Passage[]): void {
    if (!passages.length) return;
    const insert = this.db.prepare('INSERT INTO passage(title, heading, seq, z) VALUES(?,?,?,?)');
    const index = this.db.prepare('INSERT INTO fts(rowid, title, heading, body) VALUES(?,?,?,?)');
    for (const [seq, p] of passages.entries()) {
      const { lastInsertRowid } = insert.run(title, p.heading, seq, zlib.deflateRawSync(Buffer.from(p.text, 'utf8'), { level: 9 }));
      index.run(lastInsertRowid, title, p.heading, p.text);
      this.passages++;
    }
    this.articles++;
  }

  /** Record the totals and compact the index. Call once, after the last article. */
  finish(): LibraryMeta {
    this.setMeta('articles', String(this.articles));
    this.setMeta('passages', String(this.passages));
    this.setMeta('importedAt', new Date().toISOString());
    this.db.exec("INSERT INTO fts(fts) VALUES('optimize')");
    const meta = this.meta();
    this.db.close();
    return meta;
  }

  meta(): LibraryMeta {
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as Array<{ key: string; value: string }>;
    const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return { name: m.name ?? '', label: m.label ?? m.name ?? '', urlBase: m.urlBase ?? '', source: m.source ?? '', articles: Number(m.articles ?? 0), passages: Number(m.passages ?? 0), importedAt: m.importedAt ?? '' };
  }

  /**
   * The best-matching passages, ranked by BM25 (title matches count most). Passages containing *every* word come first;
   * if that gives too few, passages with some of the words fill up the list.
   */
  search(query: string, limit = 300): LibraryHit[] {
    const rows = (q: string | null, n: number) => (q ? this.db.prepare(
      `SELECT p.id, p.title, p.heading, p.seq, p.z FROM fts JOIN passage p ON p.id = fts.rowid WHERE fts MATCH ? ORDER BY bm25(fts, 6.0, 2.0, 1.0) LIMIT ?`,
    ).all(q, n) as Array<{ id: number; title: string; heading: string; seq: number; z: Uint8Array }> : []);
    const all = rows(ftsQuery(query, 'all'), limit);
    const out = all.length >= Math.min(limit, 60) ? all : [...all, ...rows(ftsQuery(query, 'any'), limit).filter(r => !all.some(a => a.id === r.id))].slice(0, limit);
    return out.map(r => ({ id: r.id, title: r.title, heading: r.heading, seq: r.seq, text: zlib.inflateRawSync(r.z).toString('utf8') }));
  }

  close() { try { this.db.close(); } catch { /* already closed */ } }
}
