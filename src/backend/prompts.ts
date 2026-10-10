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

import type { Collection } from './retrieval/retrieve';

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

/** Passage ids (P1, P2, …) are assigned in collection order and used to tie model output back to the KB. */
export function passageIds(collections: Collection[]): string[][] {
  let n = 0;
  return collections.map(c => c.passages.map(() => `P${++n}`));
}

function renderCollections(collections: Collection[]): string {
  const ids = passageIds(collections);
  return collections.map((c, ci) => `Collection ${ci} — ${c.label}\n` + c.passages.map((p, pi) => `  [${ids[ci][pi]}] (${p.source}${p.heading ? ` · ${p.heading}` : ''}${p.via ? ` · reached through "${p.via.slice(0, 3).join(', ')}"` : ''})\n  ${clip(p.text, 900)}`).join('\n')).join('\n\n');
}

export const LENSED_OVERVIEW_SYSTEM_PROMPT = `You are a knowledge canvas planner. You are given a topic and collections of passages from the user's knowledge base, each collection reached by a different route. You name the collections and describe how they relate.

${JSON_ONLY} Your response must start with { and end with }.`;

export function buildLensedOverviewMessage(query: string, collections: Collection[]): string {
  return `Topic: "${query}"

${renderCollections(collections)}

Return ONLY valid JSON matching this exact shape:

{
  "context": "2-3 sentences grounding the topic, using only what the passages say",
  "clusters": [ { "title": "2-4 words naming what this collection shows about the topic" } ],
  "edges": [ { "source": 0, "target": 1, "label": "verb phrase" } ]
}

Rules:
- Exactly ${collections.length} clusters, in the same order as the collections above.
- "source" and "target" are 0-based collection indexes. Connect collection 0 to each of the others, and add a link between two others only when the passages clearly support it.
- Edge labels are verb phrases, not nouns: "led to", "put to use in", "contested by".
- Use only the passages above; do not add outside facts.
- Return raw JSON only. Start with { and end with }.`;
}

export const LENSED_FRAGMENTS_SYSTEM_PROMPT = `You are a knowledge canvas writer. You turn passages from the user's knowledge base into short cards, one JSON object per line, and you never go beyond what the passages say.

CRITICAL: Output ONLY JSON objects, one per line (JSON Lines). No array wrapper. No markdown code fences. No preamble. No commentary.`;

export function buildLensedFragmentsMessage(query: string, context: string, collections: Collection[]): string {
  const ids = passageIds(collections);
  return `Topic: "${query}"
Overview: ${context}

${renderCollections(collections)}

Write exactly one card for every passage, in order (${ids.flat().join(', ')}), one JSON object per line:

{"passage": "P1", "type": "person | concept | thesis | source | event | era | domain | quote", "title": "card title (2-5 words, lowercase)", "body": "2-3 sentences", "bridge": "one sentence on how this connects to the topic", "tags": ["tag1", "tag2"]}

Rules:
- "passage" is the id of the passage the card is based on. Use each id once.
- "body" restates what that passage says. Do not add facts, names, dates or numbers that are not in the passage.
- "bridge" names the idea that connects this card to the topic "${query}" (for passages reached through an idea, name that idea). One sentence.
- Choose "type" by what the card actually is: person, concept, thesis (a contested claim), source (a document or reference), event, era, domain, or quote (verbatim text from the passage only).
- "tags": 2-4 lowercase words. Omit for quotes.
- Output JSON Lines only. Each object on its own line.`;
}
