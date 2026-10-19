// Beyond paragraphs: what a passage is made of that is better shown another way. Everything here is lifted straight out
// of the source text (a figure, a year with what happened in it, a quotation) and never produced by a model, so a
// figure card or a timeline can only ever say what the source says. Pure functions over text.

const STOP = new Set('a an the of in on at to for and or but with by from as is are was were be been it its this that these those which who whom had have has before after than'.split(' '));
/** Where a label ends: the thing counted is what comes before one of these ("180 copies were made" counts copies). */
const CUT = new Set('in on at by for with from were was had have has is are been who that which and or but to of'.split(' '));
/** Inside a noun phrase "and", "or" and "of" belong to it ("complete or nearly complete ones"). */
const CUT_NP = new Set('in on at by for with from were was had have has is are been who that which but to'.split(' '));

/** Sentences of a passage (a rough split, good enough for figures and dates). */
export function sentences(text: string): string[] {
  // a list is one item per line: keep each its own sentence, without its bullet or number
  return text.split(/\n+/).map(line => line.replace(/^\s*(?:[-•*–]|\d{1,2}[.)])\s+/, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    .flatMap(line => line.split(/(?<=[.!?])["”')\]]*\s+(?=[A-Z0-9“"(])/).map(s => s.trim()).filter(Boolean));
}

const trimLabel = (words: string[]) => {
  const out = [...words];
  while (out.length && STOP.has(out[out.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) out.pop();
  return out.join(' ').replace(/[,;:()"“”]+$/g, '').trim();
};

export interface Fact { value: string; label: string; /** 'figure' (a quantity), 'year' */ kind: 'figure' | 'year' }

const UNIT = '%|percent|million|billion|trillion|thousand|hundred';
const NUMBER = new RegExp(`(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)(?:\\s?(${UNIT})\\b|(?![\\w.]))`, 'gi');

/**
 * Up to `max` figures from a passage, each with the few words that say what it counts, exactly as written ("180" ·
 * "copies"; "1455" · "Gutenberg Bible was printed"). Quantities come before years; a year is only a fact when something
 * happened in it.
 */
export function extractFacts(text: string, max = 4): Fact[] {
  const found: Array<Fact & { rank: number }> = [];
  for (const s of sentences(text)) {
    for (const m of s.matchAll(NUMBER)) {
      const raw = m[1], unit = m[2] ?? '';
      const n = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(n)) continue;
      const after = s.slice((m.index ?? 0) + m[0].length).trim().split(/\s+/).slice(0, 4);
      const before = s.slice(0, m.index ?? 0).trim().split(/\s+/).slice(-4);
      const asYear = !unit && Number.isInteger(n) && n >= 1000 && n <= 2100 && !/,/.test(raw);
      if (asYear) {
        // what happened that year: the words leading up to it, or, when it opens the sentence, the words after it
        const lead = trimLabel(s.slice(0, m.index ?? 0).replace(/\b(?:in|by|since|around|from|until|during|after|before|circa)\s*$/i, '').trim().split(/\s+/).slice(-6));
        const tail = trimLabel(s.slice((m.index ?? 0) + m[0].length).replace(/^[\s,;:]+/, '').split(/[.;]/)[0].split(/\s+/).slice(0, 7));
        const label = lead.split(' ').length >= 3 ? lead : tail;
        if (label.length >= 6) found.push({ value: raw, label, kind: 'year', rank: 3 });
        continue;
      }
      if (n < 2 && !unit) continue; // "1 of the" is not a fact
      // what it counts: the noun phrase right after it ("180 copies", "42-line Bible" → "line Bible"); when a verb follows
      // ("200 were made"), the short clause around it instead, as written
      const compound = (s[(m.index ?? 0) + m[0].length] ?? '') === '-';
      const afterWords = after.map(w => w.replace(/^-+/, ''));
      const stop = afterWords.findIndex(w => /[.,;:)]$/.test(w));
      const run = (stop >= 0 ? afterWords.slice(0, stop + 1) : afterWords.slice(0, 4)).map(w => w.replace(/[.,;:)]+$/g, ''));
      const startsWithVerb = run.length > 0 && CUT.has(run[0].toLowerCase());
      const cut = run.findIndex((w, i) => i > 0 && CUT_NP.has(w.toLowerCase()));
      let label = startsWithVerb ? '' : trimLabel(cut >= 0 ? run.slice(0, cut) : run);
      if (compound && label.length < 3) label = '';
      if (label.length < 3) {
        const clause = [...before.slice(-3), raw, ...afterWords.slice(0, stop >= 0 ? stop + 1 : 3).map(w => w.replace(/[.,;:)]+$/g, ''))].join(' ');
        label = trimLabel(clause.split(' '));
      }
      if (label.length < 3) continue;
      found.push({ value: `${raw}${unit ? ` ${unit.toLowerCase()}` : ''}`, label, kind: 'figure', rank: unit ? 1 : 2 });
    }
  }
  const seen = new Set<string>();
  return found.sort((a, b) => a.rank - b.rank).filter(f => (seen.has(f.value) ? false : (seen.add(f.value), true))).slice(0, max).map(({ rank: _r, ...f }) => f);
}

export interface TimelineEntry { year: number; label: string; text: string }

const YEAR = /\b(\d{1,4})\s?(BCE|BC|CE|AD)\b|\b(1[0-9]{3}|20[0-9]{2})\b/;

/** Dated sentences in order, for a mini timeline: needs at least three distinct years. Labels are the sentence's own words, trimmed. */
export function extractTimeline(text: string, min = 3): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const s of sentences(text)) {
    const m = YEAR.exec(s);
    if (!m) continue;
    const bce = m[2] && /^B/i.test(m[2]);
    const year = m[3] ? Number(m[3]) : (bce ? -1 : 1) * Number(m[1]);
    const words = s.replace(m[0], '').replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+/, '').replace(/\s*[:–—]\s*/, ' ').trim().split(' ');
    let label = '';
    for (const w of words) { if ((label + ' ' + w).trim().length > 58) break; label = (label + ' ' + w).trim(); }
    label = trimLabel(label.split(' '));
    if (label.length >= 8) out.push({ year, label, text: s });
  }
  const byYear = new Map<number, TimelineEntry>();
  for (const e of out) if (!byYear.has(e.year)) byYear.set(e.year, e);
  const list = [...byYear.values()].sort((a, b) => a.year - b.year);
  return list.length >= min ? list.slice(0, 6) : [];
}

export interface Quote { quote: string; speaker?: string }

const NAME = "[A-Z][\\p{L}.'’-]+(?:\\s[A-Z][\\p{L}.'’-]+){0,3}";
const SAID = 'said|says|wrote|writes|argued|stated|called|declared|explained|told';

/** Quotations of real length in a passage, verbatim, with who said them when the sentence says so. */
export function extractQuotes(text: string, minWords = 9, maxWords = 60): Quote[] {
  const out: Quote[] = [];
  for (const m of text.matchAll(/[“"]([^”"]{20,400})[”"]/g)) {
    const quote = m[1].trim();
    const words = quote.split(/\s+/).length;
    if (words < minWords || words > maxWords) continue;
    const around = text.slice(Math.max(0, (m.index ?? 0) - 110), (m.index ?? 0) + m[0].length + 110);
    const who = new RegExp(`(${NAME})\\s(?:${SAID})\\b`, 'u').exec(around) ?? new RegExp(`\\b(?:${SAID})\\s(${NAME})`, 'u').exec(around);
    out.push({ quote, ...(who ? { speaker: who[1] } : {}) });
  }
  return out;
}
