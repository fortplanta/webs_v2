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
