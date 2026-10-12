// Turn a MediaWiki XML dump (.xml or .xml.bz2) into a library file. Streams: the compressed dump is fed through
// the system `bzcat` and pages are cut out of the stream as they complete, so memory stays flat however big the dump.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { LibraryDb, type LibraryMeta } from './store';
import { cleanWikitext, isDisambiguation, isRedirect, toPassages } from './wikitext';

export interface ImportOptions {
  dump: string;
  out: string;
  name: string;
  label: string;
  urlBase: string;
  /** Called about once a second. `fraction` is the share of the (compressed) dump read so far. */
  onProgress?: (p: { articles: number; passages: number; fraction: number; seconds: number }) => void;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Cut one `<page>` into what we need, or null if it isn't a real article. */
export function readPage(page: string): { title: string; wikitext: string } | null {
  if (!/<ns>0<\/ns>/.test(page) || /<redirect\b/.test(page)) return null;
  const title = /<title>([\s\S]*?)<\/title>/.exec(page)?.[1];
  const text = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(page)?.[1];
  if (!title || !text) return null;
  const wikitext = unxml(text);
  if (isRedirect(wikitext) || isDisambiguation(wikitext)) return null;
  return { title: unxml(title).trim(), wikitext };
}

export async function importDump(opts: ImportOptions): Promise<LibraryMeta> {
  const total = fs.statSync(opts.dump).size;
  const lib = LibraryDb.create(opts.out, { name: opts.name, label: opts.label, urlBase: opts.urlBase, source: opts.dump.split('/').pop() ?? opts.dump });
  const started = Date.now();
  let read = 0, pending = 0, last = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - last < 1000) return;
    last = now;
    opts.onProgress?.({ ...lib.counts, fraction: Math.min(1, read / total), seconds: (now - started) / 1000 });
  };

  const source = fs.createReadStream(opts.dump);
  source.on('data', c => { read += c.length; });
  let text: NodeJS.ReadableStream;
  let done: Promise<void> = Promise.resolve();
  if (opts.dump.endsWith('.bz2')) {
    const child = spawn('bzcat', [], { stdio: ['pipe', 'pipe', 'inherit'] });
    source.pipe(child.stdin);
    child.stdin.on('error', () => { /* bzcat closed early; the exit code reports it */ });
    text = child.stdout;
    done = new Promise((res, rej) => child.on('close', code => (code === 0 ? res() : rej(new Error(`bzcat exited with ${code}`)))));
  } else text = source;
  text.setEncoding('utf8');

  lib.begin();
  let buf = '';
  for await (const chunk of text as AsyncIterable<string>) {
    buf += chunk;
    for (;;) {
      const s = buf.indexOf('<page>');
      if (s < 0) { buf = buf.length > 20 ? buf.slice(-20) : buf; break; }
      const e = buf.indexOf('</page>', s);
      if (e < 0) { buf = buf.slice(s); break; }
      const page = readPage(buf.slice(s, e));
      buf = buf.slice(e + 7);
      if (!page) continue;
      const passages = toPassages(cleanWikitext(page.wikitext));
      if (passages.reduce((n, p) => n + p.text.length, 0) < 150) continue; // stubs
      lib.addArticle(page.title, passages);
      if (++pending >= 2000) { lib.commit(); lib.begin(); pending = 0; }
      report();
    }
  }
  await done;
  lib.commit();
  report(true);
  return lib.finish();
}
