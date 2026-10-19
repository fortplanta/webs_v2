// Turn a MediaWiki XML dump (.xml or .xml.bz2) into a library file. Streams: the compressed dump is fed through
// the system `bzcat` and pages are cut out of the stream as they complete, so memory stays flat however big the dump.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { LibraryDb, type LibraryMeta } from './store';
import { cleanWikitext, isDisambiguation, isRedirect, toPassages } from './wikitext';

export interface ImportOptions {
  dump: string;
  out: string;
  name: string;
  label: string;
  urlBase: string;
  /** The dump as parts still being downloaded, read in order as they grow (instead of reading `dump` from disk). */
  follow?: FollowPart[];
  /** Pick up an interrupted import where it stopped (the file must have been started with `follow` or `resume`). */
  resume?: boolean;
  /** Stop after this many pages (to test resuming). */
  maxPages?: number;
  /** Called about once a second. `fraction` is the share of the (compressed) dump read so far; `skipping` while catching up to where a resumed import stopped. */
  onProgress?: (p: { articles: number; passages: number; fraction: number; seconds: number; skipping?: boolean }) => void;
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

/** A dump that is still being downloaded: parts read in order, each waited on until it has reached its full size. */
export interface FollowPart { file: string; size: number }

/** Bytes of `parts` as they arrive on disk (the downloads keep appending), ending when every part is complete. */
async function* follow(parts: FollowPart[], onBytes: (n: number) => void): AsyncGenerator<Buffer> {
  for (const part of parts) {
    let offset = 0;
    while (offset < part.size) {
      let have = 0;
      try { have = fs.statSync(part.file).size; } catch { /* not started yet */ }
      if (have > offset) {
        const fh = await fs.promises.open(part.file, 'r');
        try {
          while (offset < Math.min(have, part.size)) {
            const buf = Buffer.alloc(Math.min(1 << 20, Math.min(have, part.size) - offset));
            const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
            if (bytesRead === 0) break;
            offset += bytesRead; onBytes(bytesRead);
            yield buf.subarray(0, bytesRead);
          }
        } finally { await fh.close(); }
      } else await new Promise(r => setTimeout(r, 1500));
    }
  }
}

export async function importDump(opts: ImportOptions): Promise<LibraryMeta> {
  const parts = opts.follow;
  const total = parts ? parts.reduce((n, p) => n + p.size, 0) : fs.statSync(opts.dump).size;
  const meta = { name: opts.name, label: opts.label, urlBase: opts.urlBase, source: opts.dump.split('/').pop() ?? opts.dump };
  // a long import is durable and can be picked up again where it stopped
  const resumed = opts.resume ? LibraryDb.resume(opts.out) : null;
  const lib = resumed?.lib ?? LibraryDb.create(opts.out, meta, { durable: !!opts.resume || !!parts });
  const skip = resumed?.pagesSeen ?? 0;
  const started = Date.now();
  let read = 0, pending = 0, last = 0, seen = 0;
  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - last < 1000) return;
    last = now;
    opts.onProgress?.({ ...lib.counts, fraction: Math.min(1, read / total), seconds: (now - started) / 1000, skipping: seen < skip });
  };

  const compressed = parts ? opts.dump.endsWith('.bz2') : opts.dump.endsWith('.bz2');
  const source: NodeJS.ReadableStream = parts ? Readable.from(follow(parts, n => { read += n; })) : fs.createReadStream(opts.dump).on('data', c => { read += (c as Buffer).length; });
  let text: NodeJS.ReadableStream;
  let done: Promise<void> = Promise.resolve();
  if (compressed) {
    const child = spawn('bzcat', [], { stdio: ['pipe', 'pipe', 'inherit'] });
    source.pipe(child.stdin);
    child.stdin.on('error', () => { /* bzcat closed early; the exit code reports it */ });
    text = child.stdout;
    done = new Promise((res, rej) => child.on('close', code => (code === 0 ? res() : rej(new Error(`bzcat exited with ${code}`)))));
  } else text = source;
  text.setEncoding('utf8');

  lib.begin();
  let buf = '';
  outer: for await (const chunk of text as AsyncIterable<string>) {
    buf += chunk;
    for (;;) {
      const s = buf.indexOf('<page>');
      if (s < 0) { buf = buf.length > 20 ? buf.slice(-20) : buf; break; }
      const e = buf.indexOf('</page>', s);
      if (e < 0) { buf = buf.slice(s); break; }
      const raw = buf.slice(s, e);
      buf = buf.slice(e + 7);
      seen++;
      if (seen <= skip) { if (seen % 5000 === 0) report(); continue; } // already imported before the interruption
      if (opts.maxPages && seen > opts.maxPages) { lib.checkpoint(seen - 1); break outer; } // a way to stop early (tests)
      const page = readPage(raw);
      if (page) {
        const passages = toPassages(cleanWikitext(page.wikitext));
        if (passages.reduce((n, p) => n + p.text.length, 0) >= 150) { lib.addArticle(page.title, passages); pending++; } // else a stub
      }
      if (pending >= 2000) { lib.checkpoint(seen); lib.commit(); lib.begin(); pending = 0; }
      report();
    }
  }
  if (opts.maxPages && seen > opts.maxPages) { lib.commit(); report(true); lib.abandon(); return Promise.reject(new Error('stopped early')); }
  await done;
  lib.commit();
  report(true);
  return lib.finish();
}
