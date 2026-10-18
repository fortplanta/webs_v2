// The narrator: an editor's pass over what retrieval found. It finds the pattern, decides how the pieces add up to the
// question, and retells each piece in a voice — but it is never allowed to make anything up. Everything it writes is
// checked against the source passage before it reaches the canvas; what fails the check is dropped and the original
// stays. This file holds the voice and those checks.

export const NARRATOR_VOICE = `Your voice: a well-read friend who actually knows this stuff, telling you about it across a table. You sound authoritative because you are specific (you name the person, the year, the place, the mechanism, the case) and never because you sound formal. You sound casual because you talk like a person: plain words, contractions, a short sentence next to a longer one, now and then a dry aside. You respect the reader and you respect the material: never harsh, never lecturing, never breathless, never salesy, never cute at the expense of the facts. Open on the interesting thing, not on a definition. Say what happened or how it works; if it earns it, say in one line why it matters. When something is genuinely disputed, say who disagrees and about what, instead of hedging in general. Write about the subject itself, not about "the concept" or "the idea of" it, and never about the card or the text ("this card explores…"). Avoid school-essay filler: "plays a crucial role", "it is important to note", "highlights", "underscores", "sheds light on", "refers to", "a testament to", "in today's world", "delve", "tapestry", "journey", "fascinating".`;

/** Phrases that mark filler writing. Used to measure bland output and to ask for a rewrite when a card is full of them. */
export const FILLER_PHRASES = [
  'plays a crucial role', 'plays a key role', 'plays a vital role', 'it is important to note', "it's important to note", 'important to note that', 'highlights the', 'highlighting the', 'underscores', 'sheds light', 'a testament to', "in today's world", 'refers to the', 'delve', 'tapestry', 'fascinating', 'this concept', 'the concept of', 'the idea of', 'this thesis', 'this card', 'this event exemplifies', 'multifaceted', 'complex interplay', 'nuanced', 'ultimately', 'in conclusion',
] as const;

/** How many filler phrases `text` contains. */
export function fillerCount(text: string): number {
  const t = text.toLowerCase();
  return FILLER_PHRASES.filter(p => t.includes(p)).length;
}

const GLUE = new Set(('the this that these those there then they them their what when where which while who whom why how and but for nor not you your our its his her one two three four five six seven eight nine ten may can will would could should also') .split(' '));

const numbers = (t: string) => new Set((t.match(/\d[\d,.]*/g) ?? []).map(n => n.replace(/[,.]+$/, '').replace(/,/g, '')));

/** Capitalised words that are not simply the first word of a sentence: names of people, places, works. */
function names(t: string): Set<string> {
  const out = new Set<string>();
  for (const m of t.matchAll(/\b([A-Z][\p{L}'’-]{2,})\b/gu)) {
    const before = t.slice(0, m.index);
    if (/(^|[.!?]["”')\]]*\s+|\n\s*[-•]?\s*)$/.test(before)) continue; // sentence-initial: capitalised for grammar, not because it is a name
    const w = m[1].toLowerCase();
    if (!GLUE.has(w)) out.add(w);
  }
  return out;
}

export type Check = { ok: true } | { ok: false; reason: string };

/** `text` may only contain numbers and names that are in the source (or the question). Used for titles and hooks. */
export function checkClaims(text: string, source: string, question = ''): Check {
  const known = `${source} ${question}`;
  const knownNumbers = numbers(known);
  for (const n of numbers(text)) if (!knownNumbers.has(n)) return { ok: false, reason: `a number (${n}) that isn't in the source` };
  const knownLower = known.toLowerCase();
  for (const w of names(text)) if (!knownLower.includes(w)) return { ok: false, reason: `a name (${w}) that isn't in the source` };
  return { ok: true };
}

/**
 * A retelling is accepted only if it adds nothing and leaves nothing out: no new numbers or names, almost all of its
 * content words are the source's (so it is the same information, reworded), and it is about as long as the source.
 */
export function checkRetelling(source: string, retelling: string, question = ''): Check {
  const claims = checkClaims(retelling, source, question);
  if (!claims.ok) return claims;
  const ratio = retelling.length / Math.max(source.length, 1);
  if (ratio < 0.7) return { ok: false, reason: 'it was shorter than the source, so it left things out' };
  if (ratio > 1.5) return { ok: false, reason: 'it was much longer than the source, so it added things' };
  // nothing may be left out either: every number and name in the source must still be there
  const lower = retelling.toLowerCase(), has = numbers(retelling);
  for (const n of numbers(source)) if (!has.has(n)) return { ok: false, reason: `it dropped a number (${n}) from the source` };
  for (const w of names(source)) if (!lower.includes(w)) return { ok: false, reason: `it dropped a name (${w}) from the source` };
  return { ok: true };
}

/** Capital letters at the start of each sentence (models sometimes write everything lowercase). */
export function sentenceCase(text: string): string {
  return text.replace(/(^|[.!?]["”')\]]*\s+|\n\s*[-•]?\s*)(["“(]?)([a-z])/g, (_m, pre: string, quote: string, ch: string) => pre + quote + ch.toUpperCase());
}

/** Put back the capital letters of names the source has (models like to lowercase "Isaac Newton" or "Heidelbergensis"). */
export function restoreNames(text: string, source: string): string {
  let out = text;
  const proper = new Set<string>();
  for (const m of source.matchAll(/\b([A-Z][\p{L}'’-]{1,})\b/gu)) {
    const before = source.slice(0, m.index);
    if (/(^|[.!?]["”')\]]*\s+|\n\s*[-•]?\s*)$/.test(before)) continue; // sentence-initial: not a name, just a capital
    if (!GLUE.has(m[1].toLowerCase())) proper.add(m[1]);
  }
  for (const w of proper) out = out.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'giu'), w);
  return out;
}

/** How many content words two passages share: a cheap test of whether a link between them could be real. */
export function sharedTerms(a: Iterable<string>, b: Iterable<string>, ignore: Iterable<string> = []): number {
  const skip = new Set(ignore), set = new Set(b);
  let n = 0;
  for (const t of new Set(a)) if (!skip.has(t) && set.has(t)) n++;
  return n;
}

/** 1–3 from how well a passage matched, relative to the best in the set: how big and bright its card should be. */
export function weightFor(value: number, best: number): 1 | 2 | 3 {
  if (best <= 0) return 2;
  const r = value / best;
  return r >= 0.8 ? 3 : r >= 0.45 ? 2 : 1;
}

export const clampWeight = (n: unknown): 1 | 2 | 3 | undefined => (n === 1 || n === 2 || n === 3 ? n : undefined);


export interface Pair { a: string; b: string; shared: string[] }

/** Passage pairs that share real vocabulary beyond the question: where a link between cards could be true. Best first. */
export function candidatePairs(passages: Array<{ id: string; terms: string[] }>, questionTerms: Iterable<string> = [], limit = 8): Pair[] {
  const skip = new Set(questionTerms), pairs: Pair[] = [];
  for (let i = 0; i < passages.length; i++) for (let j = i + 1; j < passages.length; j++) {
    const b = new Set(passages[j].terms);
    const shared = [...new Set(passages[i].terms)].filter(t => !skip.has(t) && b.has(t));
    if (shared.length >= 3) pairs.push({ a: passages[i].id, b: passages[j].id, shared });
  }
  return pairs.sort((x, y) => y.shared.length - x.shared.length).slice(0, limit);
}

/**
 * The year a card is about, as the narrator gave it — kept only if the source passage states it. Every number in `when`
 * must be in the passage (so "1687" or "44 BCE" survive, a guessed "around 1700" does not), and it must read as a year.
 */
export function groundedWhen(when: string | undefined, source: string): string | undefined {
  const w = (when ?? '').trim();
  if (!w || !/^(?:c\.?\s*|circa\s+|about\s+)?\d{1,4}(?:\s*(?:BCE|BC|CE|AD))?(?:\s*[–-]\s*\d{1,4}(?:\s*(?:BCE|BC|CE|AD))?)?$/i.test(w)) return undefined;
  const known = numbers(source);
  for (const n of numbers(w)) if (!known.has(n)) return undefined;
  return w;
}

/** Looser than checkClaims: only that `text` brings no new numbers. For lenses that argue from general knowledge, where new names are fine but statistics and dates are not. */
export function checkNumbers(text: string, source: string): Check {
  const known = numbers(source);
  for (const n of numbers(text)) if (!known.has(n)) return { ok: false, reason: `a number (${n}) that isn't in the card` };
  return { ok: true };
}

const BROAD = new Set('europe europeans european asia asian asians africa african americas america american north south east west western eastern northern southern english french german latin greek roman christian christians church earth world'.split(' '));

/**
 * An AI-written card is allowed to use a specific name, year or figure only if it can be found in the reference
 * passages (or the question). A small local model asked to be vivid will happily invent a plausible case, so anything
 * it states as fact must be checkable; everything else has to be explanation. Small numbers in everyday examples
 * ("thirty times", "$15") are fine; years, percentages and anything of three digits or more are not.
 */
export function checkAiClaims(text: string, reference: string): Check {
  const ref = reference.toLowerCase();
  const knownNumbers = numbers(reference);
  for (const n of numbers(text)) if (n.length >= 3 && !knownNumbers.has(n)) return { ok: false, reason: `a year or figure (${n}) that is not in the reference passages` };
  const pct = /(\d[\d.]*)\s*(%|percent)/gi;
  for (const m of text.matchAll(pct)) if (!knownNumbers.has(m[1])) return { ok: false, reason: `a percentage (${m[1]}%) that is not in the reference passages` };
  for (const w of names(text)) if (!BROAD.has(w) && !ref.includes(w)) return { ok: false, reason: `a name (${w}) that is not in the reference passages` };
  return { ok: true };
}
