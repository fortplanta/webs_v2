// Prompt templates for the default strategy. Topic-agnostic: the only topic content is the
// user's query and the KB excerpts, both injected at call time.

import type { WebConfig } from './config';

const JSON_ONLY = `CRITICAL: Return ONLY valid JSON. No markdown code fences. No preamble. No explanation. No trailing text.`;

export const OVERVIEW_SYSTEM_PROMPT = `You are a knowledge canvas planner. The user gives you a topic and you return a JSON object outlining it.

${JSON_ONLY} Your response must start with { and end with }.`;

export const FRAGMENTS_SYSTEM_PROMPT = `You are a knowledge canvas generator. The user gives you a topic and an outline, and you write intellectual fragments for it, one JSON object per line.

CRITICAL: Output ONLY JSON objects, one per line (JSON Lines). No array wrapper. No markdown code fences. No preamble. No commentary.`;

function kbSection(kbContext: string): string {
  const ctx = kbContext.trim();
  if (!ctx) return '';
  return `Knowledge base excerpts (the user's curated sources — prefer these facts over your own recall, and do not contradict them):

<kb>
${ctx}
</kb>

`;
}

export function buildOverviewMessage(query: string, kbContext: string, cfg: WebConfig): string {
  return `Topic: "${query}"

${kbSection(kbContext)}Return ONLY valid JSON matching this exact shape:

{
  "context": "2-3 sentences grounding the topic",
  "clusters": [ { "title": "cluster theme (2-4 words)" } ],
  "edges": [ { "source": 0, "target": 1, "label": "verb phrase" } ]
}

Rules:
- Return exactly ${cfg.clusterCount} clusters. Each is a distinct angle on the topic.
- "source" and "target" are 0-based indexes into "clusters".
- Edge labels must be verb phrases, not nouns: "shaped by", "resulted in", "challenged by", "enabled", "inspired".
- Every cluster must appear in at least one edge.
- Return raw JSON only. Start with { and end with }.`;
}

export function buildFragmentsMessage(
  query: string,
  kbContext: string,
  context: string,
  clusterTitles: string[],
  cfg: WebConfig,
): string {
  const numbered = clusterTitles.map((t, i) => `${i}: ${t}`).join('\n');
  return `Topic: "${query}"
Overview: ${context}

Clusters:
${numbered}

${kbSection(kbContext)}Write ${cfg.fragmentsPerCluster} fragments for each cluster. Output one JSON object per line, in this shape:

{"cluster": 0, "type": "person | concept | thesis | source | event | era | domain | quote", "title": "fragment title (2-5 words, lowercase)", "body": "2-4 sentences of substantive content", "tags": ["tag1", "tag2"], "list": ["optional"], "era": "optional", "historicalEra": "optional"}

Rules:
- Write cluster 0's fragments first, then cluster 1's, and so on. Exactly ${cfg.fragmentsPerCluster} per cluster (${cfg.clusterCount * cfg.fragmentsPerCluster} lines total).
- "cluster" is the 0-based index from the list above.
- Every fragment must have a "body" with 2-4 sentences of meaningful content.
- Fragment type guide — choose based on what each fragment actually IS:
  · "person"  — a specific individual
  · "concept" — an idea, theory, framework, or movement
  · "thesis"  — a contested claim, argument, or proposition
  · "source"  — a specific book, paper, film, or primary document
  · "event"   — a specific happening, turning point, or occurrence
  · "era"     — a period, epoch, age, or decade
  · "domain"  — a field of study or broad area of knowledge
  · "quote"   — a verbatim quotation; body = quote text + "— Author, Work, Year"
  Use a diverse mix of types within each cluster. Do NOT make everything "concept".
- "tags": required on all fragments except "quote". 2-4 tags, lowercase, short words.
- "list": optional. Only for concept, thesis, domain, source. 3-6 items if used.
- "era": only for event and era types. A year or short date range.
- "historicalEra": optional for any type. Omit if there is no clear historical anchor.
- Quote fragments: body only (verbatim quote + attribution). No tags, no list, no era.
- Only quote text that appears in the knowledge base excerpts or that you are certain is verbatim.
- Output JSON Lines only. Each object on its own line.`;
}

// ── "lensed" strategy: the passages are chosen by retrieval; the model only titles and writes ──────────

import { NARRATOR_VOICE } from './narration';
import type { Collection } from './retrieval/retrieve';

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

/** Passage ids (P1, P2, …) are assigned in collection order and used to tie model output back to the KB. */
export function passageIds(collections: Collection[]): string[][] {
  let n = 0;
  return collections.map(c => c.passages.map(() => `P${++n}`));
}

function renderCollections(collections: Collection[], full = false): string {
  const ids = passageIds(collections);
  return collections.map((c, ci) => `Collection ${ci} — ${c.label}\n` + c.passages.map((p, pi) => `  [${ids[ci][pi]}] (${p.source}${p.heading ? ` · ${p.heading}` : ''}${p.via ? ` · reached through "${p.via.slice(0, 3).join(', ')}"` : ''})\n  ${full ? p.text : clip(p.text, 900)}`).join('\n')).join('\n\n');
}

export const LENSED_OVERVIEW_SYSTEM_PROMPT = `You are the narrator of a knowledge canvas. You are given a question and collections of passages from the user's own sources, each collection reached by a different route. Your job is to see what the pieces add up to: find the pattern, decide the through-line, and name each collection. ${NARRATOR_VOICE}

${JSON_ONLY} Your response must start with { and end with }.`;

export function buildLensedOverviewMessage(query: string, collections: Collection[]): string {
  return `Topic: "${query}"

${renderCollections(collections)}

Return ONLY valid JSON matching this exact shape:

{
  "context": "the through-line: 2-4 sentences in your voice on how these pieces add up to the question, using only what the passages say",
  "verdicts": { "P1": "fits", "P2": "off-topic" },
  "clusters": [ { "title": "2-4 words, in your voice, naming what this collection shows about the question", "edge": "verb phrase: how this collection relates to the question itself" } ],
  "edges": [ { "source": 1, "target": 2, "label": "verb phrase" } ]
}

Rules:
- First judge EVERY passage and give a verdict for each id in "verdicts": "fits" or "off-topic". A passage fits only if it is really about the question's subject. It does NOT fit just because it shares a word with the question ("true", "scientist", "find") while being about something else, like a film, a recipe or an animal. Be strict: an honest short story beats a stretched long one.
- Build the through-line and titles from the passages you did not skip.
- Exactly ${collections.length} clusters, in the same order as the collections above.
- Every collection hangs directly off the question, so each cluster's "edge" says how it relates to the question itself.
- "edges" links two collections to each other, by 0-based index, and only when one genuinely arises from the other (a tangent that has its roots in it). Usually it is empty. Never link a collection to the first one just because it is first.
- Edge labels are verb phrases, not nouns: "led to", "put to use in", "contested by".
- Use only the passages above. Do not add facts, names, dates or numbers that are not in them; you are connecting what is there, not extending it.
- Return raw JSON only. Start with { and end with }.`;
}

export const LENSED_FRAGMENTS_SYSTEM_PROMPT = `You are the narrator of a knowledge canvas, now at the card level. For each passage you give a title, a one-sentence hook, a retelling of the passage in your voice, and how it relates to other passages. ${NARRATOR_VOICE}

THE RULE THAT MATTERS MOST: you never make anything up. A retelling says exactly what the passage says — every fact, name, date and number it contains, and nothing it doesn't. It may reword, reorder and connect, and it must cover the whole passage (no teasers, no summaries that leave things out). If you are not sure, copy the passage's own wording.

CRITICAL: Output ONLY JSON objects, one per line (JSON Lines). No array wrapper. No markdown code fences. No preamble. No commentary.`;

export function buildLensedFragmentsMessage(query: string, context: string, collections: Collection[], skip: string[] = [], pairs: Array<{ a: string; b: string; shared: string[] }> = []): string {
  const ids = passageIds(collections);
  return `Question: "${query}"
The through-line so far: ${context}

${renderCollections(collections, true)}
${skip.length ? `\nAlready set aside as not fitting (do not output them): ${skip.join(', ')}\n` : ''}${pairs.length ? `\nPassages that share vocabulary, so a link between them might be real (use them for "relates" only if it truly is): ${pairs.map(p => `${p.a}~${p.b} (${p.shared.slice(0, 4).join(', ')})`).join('; ')}\n` : ''}
For every passage, in order (${ids.flat().filter(id => !skip.includes(id)).join(', ')}), give one JSON object per line:

{"passage": "P1", "fits": true, "type": "person | concept | thesis | source | event | era | domain | quote", "title": "2-6 words, in your voice, lowercase", "hook": "one sentence on why this matters for the question", "weight": 3, "when": "1687", "relates": [{"to": "P3", "verb": "led to"}], "tags": ["tag1", "tag2"], "retelling": "the whole passage, retold in your voice"}

Rules:
- "passage" is the id of the passage. Use each id once.
- "fits" is false if the passage doesn't actually help answer the question; then give only {"passage": "P4", "fits": false}. Don't force a connection.
- "retelling" is in normal sentence case (capital letters at the start of sentences and for names). It keeps EVERY fact, name and number in the passage and adds none, and it is about as long as the passage: do not shorten it into a summary. If the passage is a list, keep it a list.
- "title" and "hook" may use only names and numbers that appear in the passage or the question.
- "hook" is the sharp "so what" in your voice: what this passage changes about how to see the question. Not "this concept highlights…", not a restatement of the passage.
- "retelling" is where your voice lives: same facts, but the way a person who knows the subject would tell it, with the interesting thing first, plain words, and no filler. Keep names, numbers and dates exactly. You may reorder and tighten, but never add anything.
- "weight" is 1, 2 or 3: how central this passage is to the through-line (3 = the heart of it, 1 = supporting detail).
- "when" is optional: the year (or "44 BCE", or "1914–1918") this passage is mainly about, ONLY if the passage itself states it. Never work one out or guess one; leave it out otherwise.
- "relates" is optional: up to 2 links to OTHER passages when one clearly led to, caused, answers, contradicts or builds on the other, preferably from the vocabulary-sharing pairs listed above. "to" is a passage id; "verb" is a short verb phrase. Leave it out when unsure.
- "type": person, concept, thesis (a contested claim), source (a document or reference), event, era, domain, or quote (verbatim text).
- "tags": 2-4 lowercase words. Omit for quotes.
- Output JSON Lines only. Each object on its own line.`;
}

// ── pivot ─────────────────────────────────────────────────────────────────────────────────────────

export const PIVOT_OVERVIEW_SYSTEM_PROMPT = `You name a new collection of knowledge-base passages that explores a different angle on an existing card.

${JSON_ONLY} Your response must start with { and end with }.`;

function cardBlock(card: { title: string; body: string }): string {
  return `Source card: "${card.title}"\n${clip(card.body, 500)}`;
}

export function buildPivotOverviewMessage(card: { title: string; body: string }, collection: Collection): string {
  return `${cardBlock(card)}

New collection, reached through the route "${collection.label}":

${renderCollections([collection])}

Return ONLY valid JSON in this exact shape:

{ "title": "2-4 words naming the angle these passages open up", "edge": "verb phrase linking the source card to this collection" }

Rules:
- The title names what the passages show that the source card does not.
- The edge is a verb phrase, not a noun: "led to", "put to use in", "contested by".
- Use only the passages above. Return raw JSON only. Start with { and end with }.`;
}

export function buildPivotFragmentsMessage(card: { title: string; body: string }, title: string, collection: Collection): string {
  const ids = passageIds([collection]);
  return `${cardBlock(card)}

New collection: "${title}", exploring a different angle on that card.

${renderCollections([collection])}

For every passage, in order (${ids.flat().join(', ')}), give one JSON object per line:

{"passage": "P1", "type": "person | concept | thesis | source | event | era | domain | quote", "title": "card title (2-5 words, lowercase)", "bridge": "one sentence on how this connects to the source card", "tags": ["tag1", "tag2"]}

Rules:
- "passage" is the id of the passage the card is for. Use each id once.
- Do NOT include the passage text or a summary of it; it is shown on the card as it is.
- "bridge" names the idea that connects this passage to the source card "${card.title}". One sentence.
- Choose "type" by what the passage actually is: person, concept, thesis (a contested claim), source (a document or reference), event, era, domain, or quote (verbatim text).
- "tags": 2-4 lowercase words. Omit for quotes.
- Output JSON Lines only. Each object on its own line.`;
}

// ── AI provider: answers from the model's own knowledge when the KB has nothing ────────────────────────

export const AI_OUTLINE_SYSTEM_PROMPT = `You are a knowledge canvas planner. The user's own notes had nothing on this topic, so you outline it from your general knowledge: distinct angles on it, each becoming a themed collection of cards.

${JSON_ONLY} Your response must start with { and end with }.`;

export function buildAiOutlineMessage(query: string, count: number, avoid: string[]): string {
  const have = avoid.length ? `\nThe canvas already has collections on: ${avoid.map(a => `"${a}"`).join(', ')}. Choose different angles.\n` : '';
  return `Topic: "${query}"
${have}
Return ONLY valid JSON matching this exact shape:

{
  "context": "2-3 sentences grounding the topic",
  "clusters": [ { "title": "2-4 words naming this angle", "edge": "verb phrase linking this angle to the topic" } ]
}

Rules:
- Exactly ${count} clusters, each a distinct angle on the topic.
- "edge" is a verb phrase, not a noun: "led to", "put to use in", "contested by", "shaped by".
- Be accurate. Do not invent facts; if the topic is unfamiliar or ambiguous, stay general and say so in "context".
- Return raw JSON only. Start with { and end with }.`;
}

export const AI_CARDS_SYSTEM_PROMPT = `You are a knowledge canvas writer. You write cards from your general knowledge, one JSON object per line. You never invent quotations, citations, statistics or URLs.

${NARRATOR_VOICE}

Authority comes from being right, then from being specific. Explain how the thing works or why it happens; make it vivid with an everyday example anyone can picture (a movie ticket you already paid for, a paperclip bent back and forth); and use a real named case only when it is famous and well documented and you are certain of it (the Concorde for sunk costs, say). NEVER invent a case, a company's or person's motives, a quotation, a date, a figure or a "study". A plain, correct explanation beats a vivid made-up one every time. If the accepted account is contested, say so plainly. Every card must say something the other cards do not: never reuse a sentence, a closing line or a structure across cards, and do not end on a summary or a moral.

Write in normal sentence case, with capital letters for names and the start of sentences. Don't begin a card with a definition ("X is…", "X refers to…"); begin with what happens, what it looks like, or what goes wrong.

CRITICAL: Output ONLY JSON objects, one per line (JSON Lines). No array wrapper. No markdown code fences. No preamble. No commentary.`;

/** The reference block: real text the model must take every name, date and figure from. */
export function referenceBlock(reference: string): string {
  return reference.trim()
    ? `Reference passages from an encyclopedia. Take every name, date and figure from these and nowhere else; you may explain and connect them, but do not go beyond them:\n${reference.trim()}\n`
    : `No reference passages were found. So use NO specific names, dates, places or figures at all: explain the mechanism in general terms, and make it vivid with an everyday hypothetical framed as one ("Say you've paid for a movie ticket…").\n`;
}

export function buildAiCardsMessage(query: string, context: string, titles: string[], perCollection: number, reference = ''): string {
  const numbered = titles.map((t, i) => `${i}: ${t}`).join('\n');
  return `Topic: "${query}"
Overview: ${context}

${referenceBlock(reference)}
Collections:
${numbered}

Write exactly ${perCollection} cards for each collection, collection 0 first, one JSON object per line:

{"cluster": 0, "type": "person | concept | thesis | source | event | era | domain | quote", "title": "card title (2-5 words, lowercase)", "body": "4-6 sentences in your voice: open on the concrete thing (a mechanism, a pictureable example, or a famous documented case you are certain of), explain how or why it works, and end on what follows from it", "bridge": "one sharp sentence on what this adds to the topic", "tags": ["tag1", "tag2"]}

Rules:
- "cluster" is the 0-based collection index from the list above.
- Be accurate first. Names, years and figures come only from the reference passages; otherwise explain the mechanism or use an everyday hypothetical framed as one. Never invent motives, events, quotes or figures.
- Every card differs from the others in what it says and how it ends.
- Write about the subject itself, never "the concept of" it. No filler ("plays a crucial role", "highlights", "it is important to note").
- Do NOT include quotations, URLs, citations or statistics you cannot be certain of. Do not use the "quote" type unless the quotation is famous and certain.
- Choose "type" by what the card actually is: person, concept, thesis (a contested claim), source (a specific work), event, era, or domain.
- "tags": 2-4 lowercase words.
- Output JSON Lines only. Each object on its own line.`;
}

/** Cards for one collection only: asked for when a model stopped short of what a whole-web request wanted. */
export function buildAiCollectionMessage(query: string, context: string, titles: string[], index: number, count: number, have: string[], reference = '', refused: string[] = []): string {
  return `Topic: "${query}"
Overview: ${context}

${referenceBlock(reference)}${refused.length ? `\nYour earlier cards were refused because they contained: ${[...new Set(refused)].slice(0, 4).join('; ')}. Do not repeat that: stick to the reference passages, or explain the mechanism without specifics.\n` : ''}
Collection: "${titles[index]}" (one of: ${titles.join('; ')})
${have.length ? `Cards already written for it (do not repeat them): ${have.join('; ')}\n` : ''}
Write exactly ${count} card${count === 1 ? '' : 's'} for this collection, one JSON object per line:

{"cluster": ${index}, "type": "person | concept | thesis | source | event | era | domain | quote", "title": "card title (2-5 words, lowercase)", "body": "4-6 sentences in your voice: open on the concrete thing (a mechanism, a pictureable example, or a famous documented case you are certain of), explain how or why it works, and end on what follows from it", "bridge": "one sharp sentence on what this adds to the topic", "tags": ["tag1", "tag2"]}

Rules:
- Be accurate first. Names, years and figures come only from the reference passages; otherwise explain the mechanism or use an everyday hypothetical framed as one. Never invent motives, events, quotes or figures.
- Every card differs from the others in what it says and how it ends.
- Write about the subject itself, never "the concept of" it. No filler ("plays a crucial role", "highlights", "it is important to note").
- Do NOT include quotations, URLs, citations or statistics you cannot be certain of.
- Choose "type" by what the card actually is: person, concept, thesis (a contested claim), source (a specific work), event, era, or domain.
- "tags": 2-4 lowercase words.
- Output JSON Lines only. Each object on its own line.`;
}
