// Build a library from a MediaWiki dump:
//   npm run library:import -- <dump.xml.bz2> [--name simplewiki] [--label "Simple English Wikipedia"] [--url https://simple.wikipedia.org/wiki/] [--out <dir>]
// Writes <out>/<name>.db (default out: ~/Documents/Webs/Libraries). Webs picks libraries up from that folder.

import os from 'node:os';
import path from 'node:path';
import { importDump } from '../src/backend/library/importer';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const dump = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!dump) { console.error('Usage: npm run library:import -- <dump.xml.bz2> [--name n] [--label "Label"] [--url https://…/wiki/] [--out dir]'); process.exit(1); }

const name = flag('name', 'simplewiki');
const out = path.join(flag('out', path.join(os.homedir(), 'Documents', 'Webs', 'Libraries')), `${name}.db`);
const fmt = (s: number) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;

console.log(`Importing ${dump}\n      →  ${out}`);
const meta = await importDump({
  dump, out, name,
  label: flag('label', 'Simple English Wikipedia'),
  urlBase: flag('url', 'https://simple.wikipedia.org/wiki/'),
  onProgress: p => {
    const eta = p.fraction > 0.01 ? ` · ~${fmt((p.seconds / p.fraction) * (1 - p.fraction))} left` : '';
    process.stdout.write(`\r  ${(p.fraction * 100).toFixed(1)}%  ${p.articles.toLocaleString()} articles, ${p.passages.toLocaleString()} passages · ${fmt(p.seconds)}${eta}   `);
  },
});
console.log(`\nDone: ${meta.articles.toLocaleString()} articles, ${meta.passages.toLocaleString()} passages.`);
