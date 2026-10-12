// MediaWiki markup → plain text passages. Deliberately pragmatic (regex and a few small scanners rather than a full
// parser): it has to produce readable, searchable prose from millions of articles, not render them. Templates,
// tables, references and media are dropped; links keep their visible text; headings become section boundaries.

const SKIP_SECTIONS = new Set([
  'references', 'reference', 'notes', 'footnotes', 'see also', 'other websites', 'external links', 'further reading',
  'sources', 'bibliography', 'related pages', 'gallery', 'citations',
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', '#039': "'" };
const decodeEntities = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (/^#\d+$/.test(e) ? String.fromCodePoint(Number(e.slice(1))) : m));

/** Remove `open … close` spans with nesting (e.g. `{{ … {{ … }} … }}`), starting a fresh scan at each outermost opener. */
function stripNested(text: string, open: string, close: string, keep?: (inner: string) => string): string {
  let out = '', i = 0;
  for (;;) {
    const start = text.indexOf(open, i);
    if (start < 0) return out + text.slice(i);
    out += text.slice(i, start);
    let depth = 0, j = start;
    for (; j < text.length; j++) {
      if (text.startsWith(open, j)) { depth++; j += open.length - 1; }
      else if (text.startsWith(close, j)) { depth--; j += close.length - 1; if (depth === 0) break; }
    }
    if (depth !== 0) return out; // unbalanced: drop the rest rather than leak markup
    if (keep) out += keep(text.slice(start + open.length, j - close.length + 1));
    i = j + 1;
  }
}

const isMedia = (target: string) => /^(file|image|media|category|template|wikipedia|help|portal|special|talk|user)\s*:/i.test(target) || /^[a-z]{2,3}(-[a-z]+)?:/i.test(target);

function stripTables(text: string): string {
  const out: string[] = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('{|')) { depth++; continue; }
    if (depth > 0) { if (line.trimStart().startsWith('|}')) depth--; continue; }
    out.push(line);
  }
  return out.join('\n');
}

/** Plain text with `## Heading` lines and blank-line-separated paragraphs. */
export function cleanWikitext(raw: string): string {
  let t = decodeEntities(raw);
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<(ref|gallery|math|timeline|imagemap|syntaxhighlight|source|score|noinclude|includeonly|references)\b[^>]*?\/>/gi, '');
  t = t.replace(/<(ref|gallery|math|timeline|imagemap|syntaxhighlight|source|score|noinclude|includeonly|references|table)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  t = stripNested(t, '{{', '}}');
  t = stripTables(t);
  // [[File:…|caption with [[links]]]] and categories vanish; ordinary links keep their label
  t = stripNested(t, '[[', ']]', inner => {
    const target = inner.split('|')[0].trim();
    if (isMedia(target)) return '';
    const label = inner.includes('|') ? inner.slice(inner.lastIndexOf('|') + 1) : target.replace(/#.*/, '') || target;
    return label.trim();
  });
  t = t.replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, '$1').replace(/\[(?:https?:)?\/\/\S+\]/g, '');
  t = t.replace(/'{2,5}/g, '');
  t = t.replace(/__[A-Z]+__/g, '');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  t = t.replace(/^[*#;:]+\s*/gm, '- ').replace(/^- *$/gm, ''); // lists first, so the '#' of a heading marker isn't taken for a list
  t = t.replace(/^(={2,6})\s*(.+?)\s*\1\s*$/gm, (_m, eq: string, h: string) => `\n\n${'#'.repeat(eq.length)} ${h.trim()}\n\n`);
  t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

export interface Passage { heading: string; text: string }

const TARGET = 900, MAX = 1400, MIN = 80;

/** Split cleaned text into passages: lead first, then each (non-boilerplate) section, paragraphs grouped to about a paragraph or two. */
export function toPassages(clean: string): Passage[] {
  const out: Passage[] = [];
  let heading = '', skip = false;
  let buf: string[] = [];
  const flush = () => {
    if (!skip && buf.length) {
      let cur = '';
      for (const para of buf) {
        if (cur && cur.length + para.length > TARGET) { if (cur.length >= MIN) out.push({ heading, text: cur }); cur = ''; }
        cur = cur ? `${cur}\n${para}` : para;
      }
      if (cur.length >= MIN) out.push({ heading, text: cur });
    }
    buf = [];
  };
  for (const block of clean.split(/\n\s*\n/)) {
    const h = /^#{1,5}\s+(.*)$/.exec(block.trim());
    if (h) { flush(); heading = h[1].trim(); skip = SKIP_SECTIONS.has(heading.toLowerCase()); continue; }
    const para = block.trim();
    if (para.length < 25) continue; // stray fragments (captions, leftover markup)
    // a very long paragraph is split at sentence ends so no passage is huge
    if (para.length > MAX) {
      let cur = '';
      for (const s of para.split(/(?<=[.!?])\s+/)) { if (cur && cur.length + s.length > TARGET) { buf.push(cur); cur = ''; } cur = cur ? `${cur} ${s}` : s; }
      if (cur) buf.push(cur);
    } else buf.push(para);
  }
  flush();
  return out;
}

export function isRedirect(raw: string): boolean {
  return /^\s*#redirect/i.test(raw);
}

export function isDisambiguation(raw: string): boolean {
  return /\{\{\s*(disambig|disambiguation|dab|surname|given name|geodis)/i.test(raw);
}
