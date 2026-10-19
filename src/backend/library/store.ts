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

/** A word found in at least this many passages is "common": counting stops there (it keeps lookups fast in a library of millions). */
const COMMON_WORD = 150_000;

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

  private constructor(file: string, readOnly: boolean, durable = false) {
    this.db = new DatabaseSync(file, { readOnly });
    if (!readOnly) {
      // a small import is fastest with no journal; a many-hour one uses a write-ahead log so an interruption can be resumed
      this.db.exec(durable ? 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;' : 'PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
      this.db.exec(SCHEMA);
    }
    this.durable = durable;
  }
  private durable: boolean;

  /** Start a new library file (replacing any existing one). `durable` makes a long import resumable (see resume). */
  static create(file: string, meta: Pick<LibraryMeta, 'name' | 'label' | 'urlBase' | 'source'>, opts: { durable?: boolean } = {}): LibraryDb {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    const lib = new LibraryDb(file, false, opts.durable);
    for (const [k, v] of Object.entries(meta)) lib.setMeta(k, v);
    return lib;
  }

  static open(file: string): LibraryDb {
    return new LibraryDb(file, true);
  }

  /** Reopen an unfinished durable import to carry on from its last checkpoint; null if there is nothing to resume. */
  static resume(file: string): { lib: LibraryDb; pagesSeen: number } | null {
    if (!fs.existsSync(file)) return null;
    const lib = new LibraryDb(file, false, true);
    const get = (k: string) => (lib.db.prepare('SELECT value FROM meta WHERE key = ?').get(k) as { value: string } | undefined)?.value;
    const seen = Number(get('pagesSeen'));
    if (get('importedAt') || !Number.isFinite(seen)) { lib.db.close(); return null; } // finished, or not one of ours
    lib.articles = Number(get('progressArticles') ?? 0);
    lib.passages = Number(get('progressPassages') ?? 0);
    return { lib, pagesSeen: seen };
  }

  /** Record how far an import has got (inside the transaction about to be committed), so it can resume from here. */
  checkpoint(pagesSeen: number) {
    this.setMeta('pagesSeen', String(pagesSeen));
    this.setMeta('progressArticles', String(this.articles));
    this.setMeta('progressPassages', String(this.passages));
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
    if (this.durable) {
      this.db.prepare("DELETE FROM meta WHERE key IN ('pagesSeen','progressArticles','progressPassages')").run();
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;'); // one plain file, readable read-only
    }
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
   * The best-matching passages, ranked by BM25 (title matches count most). Passages with *every* word in their title come
   * first, then passages with every word anywhere; if that gives too few, passages with some of the words fill up the
   * list, using only the distinctive words (a word found in most of a huge library would drag in the world and take
   * forever to rank).
   */
  search(query: string, limit = 300): LibraryHit[] {
    type Row = { id: number; title: string; heading: string; seq: number; z: Uint8Array };
    const words = [...new Set(contentWords(query))].slice(0, 12).map(w => w.replace(/"/g, '')).filter(Boolean);
    if (!words.length) return [];
    const run = (q: string, n: number) => this.db.prepare(
      `SELECT p.id, p.title, p.heading, p.seq, p.z FROM fts JOIN passage p ON p.id = fts.rowid WHERE fts MATCH ? ORDER BY bm25(fts, 6.0, 2.0, 1.0) LIMIT ?`,
    ).all(q, n) as Row[];
    const out: Row[] = [], seen = new Set<number>();
    const add = (rows: Row[]) => { for (const r of rows) if (out.length < limit && !seen.has(r.id)) { seen.add(r.id); out.push(r); } };
    const quoted = words.map(w => `"${w}"`);
    add(run(`title : (${quoted.join(' AND ')})`, limit));
    if (out.length < limit) add(run(quoted.join(' AND '), limit));
    if (out.length < Math.min(limit, 60)) {
      const distinctive = quoted.filter((_, i) => this.docFreq(words[i]) < COMMON_WORD);
      if (distinctive.length) add(run(distinctive.join(' OR '), limit));
    }
    return out.map(r => ({ id: r.id, title: r.title, heading: r.heading, seq: r.seq, text: zlib.inflateRawSync(r.z).toString('utf8') }));
  }

  /** How many passages contain `word` (stemmed like the index), counted only up to COMMON_WORD: past that it is just "common". */
  docFreq(word: string): number {
    const w = word.replace(/"/g, '');
    if (!w) return 0;
    try { return (this.db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM fts WHERE fts MATCH ? LIMIT ?)').get(`"${w}"`, COMMON_WORD) as { n: number }).n; } catch { return 0; }
  }

  /** Close without finishing: an interrupted import stays resumable. */
  abandon() { try { this.db.close(); } catch { /* already closed */ } }

  close() { try { this.db.close(); } catch { /* already closed */ } }
}
