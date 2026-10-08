// Knowledge-base search. v1a: keyword-only over markdown files in the KB directory.
// `searchKnowledgeBase` / `searchPassages` are the contract — swap the bodies for semantic/hybrid later.
//
// KB layout: <kbDir>/<module>/*.md  (e.g. kb/philosophy/stoicism.md).
// Paragraphs (blank-line separated) are the retrieval unit.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KbPassage } from './events';

export interface KbService {
  search(query: string): Promise<KbPassage[]>;
}

const MAX_PASSAGES = 8;
const MAX_CHARS = 6000;
const STOPWORDS = new Set(
  'a an and are as at be by for from how in is it of on or that the to was what when where which who why with'.split(' '),
);

export function kbDir(): string {
  return process.env.WEBS_KB_DIR?.trim() || path.resolve(process.cwd(), 'kb');
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 2 && !STOPWORDS.has(t));
}

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async e => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return listMarkdown(full);
      return e.name.endsWith('.md') ? [full] : [];
    }),
  );
  return nested.flat();
}

/** Best-matching KB passages, structured. Empty if nothing matches or the KB is empty. */
export async function searchPassages(query: string, dir: string = kbDir()): Promise<KbPassage[]> {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];

  const scored: Array<KbPassage & { score: number }> = [];
  for (const file of await listMarkdown(dir)) {
    const raw = await fs.readFile(file, 'utf8').catch(() => '');
    const source = path.relative(dir, file);
    for (const para of raw.split(/\n\s*\n/)) {
      const text = para.trim();
      if (!text || /^#+\s/.test(text) && !text.includes('\n')) continue; // bare headings carry no content
      const tokens = tokenize(text);
      const score = terms.reduce((s, t) => s + tokens.filter(x => x === t || x.startsWith(t)).length, 0);
      if (score > 0) scored.push({ score, text, source });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const picked: KbPassage[] = [];
  let chars = 0;
  for (const p of scored.slice(0, MAX_PASSAGES)) {
    if (chars + p.text.length > MAX_CHARS) break;
    picked.push({ source: p.source, text: p.text });
    chars += p.text.length;
  }
  return picked;
}

export function formatPassages(passages: KbPassage[]): string {
  return passages.map(p => `[${p.source}]\n${p.text}`).join('\n\n');
}

/** Concatenated KB results as a single string. */
export async function searchKnowledgeBase(query: string, dir: string = kbDir()): Promise<string> {
  return formatPassages(await searchPassages(query, dir));
}

export const fileKb: KbService = { search: q => searchPassages(q) };
