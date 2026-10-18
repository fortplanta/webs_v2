// Searching the libraries folder: every `*.db` there is a library (see store.ts). Hits from the enabled libraries
// are turned into a small in-memory index and run through the same retrieval (lenses, bridges, set-level selection)
// as the user's own notes, so a Wikipedia web is built exactly like a notes web — just from a different source.

import fs from 'node:fs';
import path from 'node:path';
import type { LibraryInfo } from '../../types/settings';
import { getSettings } from '../settings';
import { PassageIndex } from '../retrieval/index';
import { defaultRetrieveConfig, type RetrieveConfig } from '../retrieval/config';
import { retrieve, retrieveTerms, type Retrieval, type RetrieveOptions } from '../retrieval/retrieve';
import { terms } from '../retrieval/text';
import { LibraryDb, type LibraryMeta } from './store';

/** Candidate passages pulled from each library before retrieval picks the best. */
const CANDIDATES = 300;

export interface LibraryRetrieval {
  retrieval: Retrieval;
  /** Library name → its details, for labelling and linking the passages. */
  libraries: Map<string, LibraryMeta>;
}

export interface LibraryRetriever {
  retrieve(query: string): Promise<LibraryRetrieval | null>;
  /** Passages about the same subject as a card, for exploring it from another angle. */
  retrieveFromCard(card: { title: string; body: string }, opts: RetrieveOptions): Promise<LibraryRetrieval | null>;
}

const isLibraryFile = (f: string) => f.endsWith('.db') && !f.startsWith('_') && !f.startsWith('.');

export function listLibraries(dir: string): LibraryInfo[] {
  if (!dir) return [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter(isLibraryFile).sort(); } catch { return []; }
  const out: LibraryInfo[] = [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const db = LibraryDb.open(file);
      const m = db.meta();
      db.close();
      out.push({ name: m.name || f.replace(/\.db$/, ''), label: m.label, articles: m.articles, passages: m.passages, bytes: fs.statSync(file).size });
    } catch { /* not a library (or unreadable): skip it */ }
  }
  return out;
}

/** The id lead passages get, so retrieval's "opening paragraph" bonus (ids ending #0) applies to an article's lead. */
export const passageKey = (name: string, title: string, seq: number, rowid: number) => `${name}:${title}#${seq === 0 ? 0 : rowid}`;

/** Open every enabled library, run `fn`, and close them again. */
async function withLibraries<T>(fn: (open: Array<{ db: LibraryDb; meta: LibraryMeta }>, generation: { clusterCount: number; fragmentsPerCluster: number }) => T | null): Promise<T | null> {
  const { library, generation } = getSettings();
  if (!library.dir) return null;
  const open: Array<{ db: LibraryDb; meta: LibraryMeta }> = [];
  try {
    for (const info of listLibraries(library.dir)) {
      if (library.disabled.includes(info.name)) continue;
      const db = LibraryDb.open(path.join(library.dir, `${info.name}.db`));
      open.push({ db, meta: db.meta() });
    }
    if (!open.length) return null;
    return fn(open, generation);
  } finally {
    for (const o of open) o.db.close();
  }
}

/**
 * Candidate passages for `query`, kept only if they are really about it, not just sharing a common word ("sunk" and
 * "cost" turn up in an article on barbed wire; "fallacy" is what a question is about). Words are weighted by how rare
 * they are in the libraries, and a passage must carry the rarest word and most of the weight.
 */
function aboutQuery(open: Array<{ db: LibraryDb; meta: LibraryMeta }>, query: string) {
  const entries = open.flatMap(({ db, meta }) => db.search(query, CANDIDATES).map(h => ({
    id: passageKey(meta.name, h.title, h.seq, h.id), source: `${meta.name}:${h.title}`, module: meta.name, heading: h.heading, text: h.text,
  })));
  if (!entries.length) return [];
  const want = [...new Set(terms(query))];
  const total = open.reduce((n, o) => n + o.meta.passages, 0);
  const idf = new Map(want.map(t => [t, Math.log((total + 1) / (open.reduce((n, o) => n + o.db.docFreq(t), 0) + 1))]));
  const sum = [...idf.values()].reduce((a, b) => a + b, 0);
  const rarest = want.reduce((best, t) => ((idf.get(t) ?? 0) > (idf.get(best) ?? 0) ? t : best), want[0]);
  return entries.filter(e => {
    const has = new Set(terms(`${e.source.split(':')[1] ?? ''} ${e.heading} ${e.text}`));
    if (want.length > 1 && !has.has(rarest)) return false;
    const covered = want.filter(t => has.has(t)).reduce((n, t) => n + (idf.get(t) ?? 0), 0);
    return sum <= 0 || covered / sum >= 0.7;
  });
}

export const libraryRetriever: LibraryRetriever = {
  retrieve: query => withLibraries((open, generation) => {
    const about = aboutQuery(open, query);
    if (!about.length) return null;
    const cfg: RetrieveConfig = { ...defaultRetrieveConfig, clusterCount: generation.clusterCount, fragmentsPerCluster: generation.fragmentsPerCluster, minCoverage: 0 };
    return { retrieval: retrieve(PassageIndex.fromEntries(about), query, cfg), libraries: new Map(open.map(o => [o.meta.name, o.meta])) };
  }),

  // The card's subject searched for in the libraries, then run through the same routes and bridges as a typed question,
  // so a pivot from a Wikipedia card finds other Wikipedia material on the subject from a different angle.
  retrieveFromCard: (card, opts) => withLibraries((open, generation) => {
    const about = aboutQuery(open, card.title).filter(e => !opts.exclude?.has(e.id));
    if (!about.length) return null;
    const cfg: RetrieveConfig = { ...defaultRetrieveConfig, clusterCount: 4, fragmentsPerCluster: generation.fragmentsPerCluster, minCoverage: 0 };
    const q = [...new Set(terms(card.title))];
    return { retrieval: retrieveTerms(PassageIndex.fromEntries(about), card.title, q, cfg, opts), libraries: new Map(open.map(o => [o.meta.name, o.meta])) };
  }),
};
