// Searching the libraries folder: every `*.db` there is a library (see store.ts). Hits from the enabled libraries
// are turned into a small in-memory index and run through the same retrieval (lenses, bridges, set-level selection)
// as the user's own notes, so a Wikipedia web is built exactly like a notes web — just from a different source.

import fs from 'node:fs';
import path from 'node:path';
import type { LibraryInfo } from '../../types/settings';
import { getSettings } from '../settings';
import { PassageIndex } from '../retrieval/index';
import { defaultRetrieveConfig, type RetrieveConfig } from '../retrieval/config';
import { retrieve, type Retrieval } from '../retrieval/retrieve';
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

export const libraryRetriever: LibraryRetriever = {
  async retrieve(query) {
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
      const entries = open.flatMap(({ db, meta }) => db.search(query, CANDIDATES).map(h => ({
        id: passageKey(meta.name, h.title, h.seq, h.id), source: `${meta.name}:${h.title}`, module: meta.name, heading: h.heading, text: h.text,
      })));
      if (!entries.length) return null;
      const cfg: RetrieveConfig = { ...defaultRetrieveConfig, clusterCount: generation.clusterCount, fragmentsPerCluster: generation.fragmentsPerCluster };
      const retrieval = retrieve(PassageIndex.fromEntries(entries), query, cfg);
      return { retrieval, libraries: new Map(open.map(o => [o.meta.name, o.meta])) };
    } finally {
      for (const o of open) o.db.close();
    }
  },
};
