// A searchable index over KB passages (paragraphs of markdown), with BM25 scoring.
//
// A passage is a blank-line-separated paragraph; the nearest heading above it is kept as context and
// is searchable too. Built per search from the files on disk (the KB is small and local) and cached
// until a file changes.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { moduleOf } from '../kb';
import { terms, words, stem } from './text';

export interface IndexedPassage {
  id: string;
  source: string;
  module: string;
  heading: string;
  text: string;
  tf: Map<string, number>;
  termSet: Set<string>;
  length: number;
}

const K1 = 1.2, B = 0.75;

export class PassageIndex {
  readonly df = new Map<string, number>();
  readonly avgLength: number;
  private readonly surfaces = new Map<string, Map<string, number>>();

  constructor(readonly passages: IndexedPassage[]) {
    let total = 0;
    for (const p of passages) {
      total += p.length;
      for (const t of p.termSet) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      for (const w of words(`${p.heading} ${p.text}`)) {
        const t = stem(w);
        const m = this.surfaces.get(t) ?? new Map<string, number>();
        m.set(w, (m.get(w) ?? 0) + 1);
        this.surfaces.set(t, m);
      }
    }
    this.avgLength = passages.length ? total / passages.length : 0;
  }

  idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    return Math.log(1 + (this.passages.length - n + 0.5) / (n + 0.5));
  }

  /** The most common original spelling of a stemmed term, for showing to people. */
  surface(term: string): string {
    const m = this.surfaces.get(term);
    if (!m) return term;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  /** BM25 of a passage against weighted query terms. */
  bm25(p: IndexedPassage, weights: ReadonlyMap<string, number>): number {
    let score = 0;
    for (const [t, w] of weights) {
      const f = p.tf.get(t);
      if (!f) continue;
      score += w * this.idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * p.length) / (this.avgLength || 1))));
    }
    return score;
  }

  /** An index over ready-made passages (e.g. search hits from a library), in the order given. */
  static fromEntries(entries: Array<{ id: string; source: string; module: string; heading: string; text: string }>): PassageIndex {
    return new PassageIndex(entries.map(e => {
      const ts = terms(`${e.heading} ${e.text}`);
      const tf = new Map<string, number>();
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { ...e, tf, termSet: new Set(tf.keys()), length: ts.length };
    }));
  }

  static fromDocs(docs: Array<{ source: string; text: string }>): PassageIndex {
    const passages: IndexedPassage[] = [];
    for (const doc of docs) {
      let heading = '';
      let n = 0;
      for (const para of doc.text.split(/\n\s*\n/)) {
        let text = para.trim();
        if (!text) continue;
        const h = /^#{1,6}\s+(.*)$/m.exec(text.split('\n')[0]);
        if (h) {
          heading = h[1].trim();
          text = text.split('\n').slice(1).join('\n').trim();
          if (!text) continue; // a bare heading carries no content
        }
        const ts = terms(`${heading} ${text}`);
        const tf = new Map<string, number>();
        for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
        passages.push({
          id: `${doc.source}#${n++}`, source: doc.source, module: moduleOf(doc.source), heading, text,
          tf, termSet: new Set(tf.keys()), length: ts.length,
        });
      }
    }
    return new PassageIndex(passages);
  }
}

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return listMarkdown(full);
    return e.name.endsWith('.md') ? [full] : [];
  }));
  return nested.flat();
}

const cache = new Map<string, { signature: string; index: PassageIndex }>();

/** Index every enabled markdown file under `dir`; reuses the previous index if no file has changed. */
export async function loadIndex(dir: string, disabledModules: string[] = []): Promise<PassageIndex> {
  const files = (await listMarkdown(dir)).filter(f => !disabledModules.includes(moduleOf(path.relative(dir, f)))).sort();
  const stats = await Promise.all(files.map(f => fs.stat(f).then(s => `${f}:${s.mtimeMs}:${s.size}`, () => `${f}:gone`)));
  const signature = stats.join('|');
  const key = `${dir}\0${disabledModules.join(',')}`;
  const hit = cache.get(key);
  if (hit && hit.signature === signature) return hit.index;
  const docs = await Promise.all(files.map(async f => ({ source: path.relative(dir, f), text: await fs.readFile(f, 'utf8').catch(() => '') })));
  const index = PassageIndex.fromDocs(docs);
  cache.set(key, { signature, index });
  return index;
}
