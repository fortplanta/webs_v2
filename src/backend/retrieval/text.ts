// Text normalization shared by indexing, querying and grounding checks.
// Deliberately crude (a few suffix rules, English only): it only has to make "fence / fences / fencing"
// and "invent / invented / inventor"-style variants meet. Replace with a real stemmer or embeddings later;
// everything downstream works on the terms this module returns.

const STOPWORDS = new Set((
  'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your ' +
  'one two may many much often used use using also however although within without among around across per via'
).split(/\s+/).filter(Boolean));

const undouble = (w: string) => (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w) ? w.slice(0, -1) : w);

export function stem(word: string): string {
  let w = word;
  if (/^\d+$/.test(w) || w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 5) w = undouble(w.slice(0, -3));
  else if (w.endsWith('ed') && w.length > 4) w = undouble(w.slice(0, -2));
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1);
  return w;
}

/** Lowercased word tokens, before stemming/stopword removal. */
export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Stemmed content terms (stopwords and 1–2 letter words dropped; numbers kept, so years count). */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    const numeric = /^\d+$/.test(w);
    if (!numeric && (w.length < 3 || STOPWORDS.has(w))) continue;
    if (numeric && w.length < 2) continue;
    out.push(stem(w));
  }
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
