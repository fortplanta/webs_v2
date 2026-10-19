// What a card can also be shown as. A card made from a source passage may carry figures, dates or a quotation; each is
// lifted straight from that passage (see backend/media.ts), so these companions can only say what the source says. AI-written
// cards get none: their wording is not a source. Pure, so it can be tested; CanvasView places the results.

import type { GeneratedFragment } from '../backend/events';
import { extractFacts, extractQuotes, extractTimeline, type Fact, type Quote, type TimelineEntry } from '../backend/media';

export type Derived =
  | { kind: 'facts'; facts: Fact[] }
  | { kind: 'timeline'; entries: TimelineEntry[] }
  | { kind: 'quote'; quote: Quote };

/** The most a web gets of each, so it stays a web of ideas and does not turn into a poster. */
export const BUDGET = { infographics: 3, quotes: 3 } as const;

/** The passage a card was made from: its original wording, else its body. */
export const sourceText = (f: GeneratedFragment) => f.original ?? f.body;

/** What `f` could also be shown as: at most one infographic (figures first, else dates) and one quotation. */
export function planDerived(f: GeneratedFragment): Derived[] {
  if (f.origin === 'ai' || f.dropped || f.draft || f.type === 'quote') return [];
  const text = sourceText(f);
  const out: Derived[] = [];
  const facts = extractFacts(text, 4).filter(x => x.kind === 'figure');
  if (facts.length >= 3) out.push({ kind: 'facts', facts });
  else {
    const entries = extractTimeline(text);
    if (entries.length >= 3) out.push({ kind: 'timeline', entries });
  }
  const quote = extractQuotes(text)[0];
  if (quote) out.push({ kind: 'quote', quote });
  return out;
}

/** The card a quotation becomes: the words exactly as the source has them, set large, credited to who said them and where. */
export function quoteCard(parent: GeneratedFragment, q: Quote): GeneratedFragment {
  const where = parent.sourceLabel && parent.kbSources?.[0] ? `${parent.kbSources[0]}` : parent.title;
  return {
    type: 'quote', title: q.speaker ?? 'quote', body: `“${q.quote}”`, bridge: q.speaker ? `${q.speaker}, in ${where}` : `from ${where}`,
    weight: 2, grounding: 1,
    ...(parent.origin ? { origin: parent.origin } : {}), ...(parent.sourceLabel ? { sourceLabel: parent.sourceLabel } : {}),
    ...(parent.kbSources ? { kbSources: parent.kbSources } : {}), ...(parent.link ? { link: parent.link } : {}),
  };
}

/** The card for a video or audio clip: a link that opens it on Commons. */
export function clipCard(link: { kind: 'video' | 'audio'; title: string; url: string }): GeneratedFragment {
  return {
    type: 'source', title: `${link.kind}: ${link.title}`.slice(0, 40), body: `A ${link.kind} clip from the article. It opens on Wikimedia Commons in your browser.`,
    origin: 'wiki', sourceLabel: 'Wikimedia Commons', link: link.url, weight: 1, grounding: 1,
  };
}
