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
  /** The article's title is the question itself ("Printing press" for "the printing press"). */
  exactTitle?: boolean;
}

/** A word found in at least this many passages is "common": counting stops there (it keeps lookups fast in a library of millions). */
const COMMON_WORD = 60_000;
/** Searches matching fewer passages than this are ranked by BM25; bigger ones are too slow to rank. */
const RANKABLE = 4_000;

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
   * The best-matching passages. An article called exactly what was asked about comes first; then articles with every word in
   * their title; then passages with every word. How long a search takes depends on how many passages *match*, because ranking
   * by BM25 scores every match: "confirmation bias" matches a few thousand and answers in under a second, while "confirmation"
   * alone matches a million and takes over a minute. So a one-word query for a common word is not ranked (the exact-title
   * article and a first batch of title matches are all that vague a question can honestly give), and the fall-back that widens
   * to "some of the words" is only used when it stays small.
   */
  search(query: string, limit = 300): LibraryHit[] {
    type Row = { id: number; title: string; heading: string; seq: number; z: Uint8Array };
    const words = [...new Set(contentWords(query))].slice(0, 12).map(w => w.replace(/"/g, '')).filter(Boolean);
    if (!words.length) return [];
    const sql = (q: string, n: number, ranked: boolean) => this.db.prepare(
      `SELECT p.id, p.title, p.heading, p.seq, p.z FROM fts JOIN passage p ON p.id = fts.rowid WHERE fts MATCH ? ${ranked ? 'ORDER BY bm25(fts, 6.0, 2.0, 1.0)' : ''} LIMIT ?`,
    ).all(q, n) as Row[];
    /** Few enough matches to rank them all? (counting is cheap, ranking is not) */
    const small = (q: string) => (this.db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM fts WHERE fts MATCH ? LIMIT ?)').get(q, RANKABLE) as { n: number }).n < RANKABLE;
    const run = (q: string, n: number) => sql(q, n, small(q));
    const out: Row[] = [], seen = new Set<number>();
    const add = (rows: Row[]) => { for (const r of rows) if (out.length < limit && !seen.has(r.id)) { seen.add(r.id); out.push(r); } };
    const quoted = words.map(w => `"${w}"`);
    const asked = new Set(words);
    const isExact = (title: string) => { const t = new Set(contentWords(title)); return t.size === asked.size && [...asked].every(w => t.has(w)); };

    // 1. an article called exactly this, then 2. articles with every word in their title (title column only: small lists)
    const exact = run(`title : "${words.join(" ")}"`, 60).filter(r => isExact(r.title)).sort((a, b) => a.seq - b.seq);
    add(exact);
    add(run(`title : (${quoted.join(' AND ')})`, limit));

    // 3. every word in the passage, when that is a list short enough to rank
    if (out.length < limit) {
      const q = quoted.join(' AND ');
      if (small(q)) add(sql(q, limit, true));
    }
    // 4. too few: some of the distinctive words, again only when that stays small
    if (out.length < Math.min(limit, 60)) {
      const distinctive = quoted.filter((_, i) => this.docFreq(words[i]) < COMMON_WORD);
      if (distinctive.length >= 2) { const q = distinctive.join(' OR '); if (small(q)) add(sql(q, limit, true)); }
    }

    const exactIds = new Set(exact.map(r => r.id));
    return out.map(r => ({ id: r.id, title: r.title, heading: r.heading, seq: r.seq, text: zlib.inflateRawSync(r.z).toString('utf8'), ...(exactIds.has(r.id) ? { exactTitle: true } : {}) }));
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
