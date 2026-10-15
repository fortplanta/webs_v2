// The AI provider's part of a web: collections written from the model's own knowledge, for when the knowledge base
// has nothing on the topic (or too little). Emits the same kind of events as the KB path — an outline first so the
// skeleton appears at once, then cards as they stream — but every card is marked origin 'ai', so the canvas can
// show it came from somewhere other than the user's notes. It never sends KB text anywhere: only the topic and,
// when topping up, the titles of the collections already on the canvas.

import { WebsError } from '../errors';
import type { GeneratedFragment, OverviewEdge, WebEvent } from '../events';
import type { LlmService } from '../llm';
import { AI_CARDS_SYSTEM_PROMPT, AI_OUTLINE_SYSTEM_PROMPT, buildAiCardsMessage, buildAiCollectionMessage, buildAiOutlineMessage } from '../prompts';
import { normalizeFragment, parseJsonObject, streamObjects } from '../parse';
import { callJson } from '../repair';

export interface AiContext {
  llm: LlmService;
  model: string;
  topUp: boolean;
}

interface Outline { context: string; titles: string[]; edgeLabels: string[] }

export function parseAiOutline(raw: string, count: number): Outline {
  const data = parseJsonObject(raw);
  const clusters: any[] = Array.isArray(data?.clusters) ? data.clusters : [];
  const titles: string[] = [], edgeLabels: string[] = [];
  for (const c of clusters.slice(0, count)) {
    const title = String(typeof c === 'string' ? c : c?.title ?? '').trim();
    if (!title) continue;
    titles.push(title);
    edgeLabels.push(String(c?.edge ?? '').trim() || 'relates to');
  }
  if (titles.length === 0) throw new WebsError('bad-json', 'The AI outline had no collections.');
  return { context: String(data?.context ?? '').trim(), titles, edgeLabels };
}

/** Only fields the AI may set; anything else the model invents (links, KB references) is dropped. */
function fromAi(raw: any, model: string): GeneratedFragment | null {
  const f = normalizeFragment(raw);
  if (!f) return null;
  const bridge = typeof raw.bridge === 'string' ? raw.bridge.trim().slice(0, 200) : '';
  return {
    type: f.type, title: f.title, body: f.body,
    ...(Array.isArray(f.tags) ? { tags: f.tags.map(String).slice(0, 4) } : {}),
    ...(Array.isArray(f.list) ? { list: f.list.map(String).slice(0, 6) } : {}),
    ...(typeof f.era === 'string' ? { era: f.era } : {}),
    ...(typeof f.historicalEra === 'string' ? { historicalEra: f.historicalEra } : {}),
    ...(bridge ? { bridge } : {}),
    origin: 'ai', aiModel: model,
  };
}

/**
 * Collections `start`…`start+count-1`. `avoid` are titles already on the canvas. Throws WebsError('ai-error' | 'bad-json');
 * the caller decides whether that is fatal (nothing else to show) or just a warning (the KB part still stands).
 */
export async function* aiWeb(opts: { query: string; signal: AbortSignal; ai: AiContext; start: number; count: number; perCollection: number; avoid?: string[] }): AsyncGenerator<WebEvent> {
  const { query, signal, ai, start, count, perCollection, avoid = [] } = opts;
  yield { type: 'status', message: `Nothing in your notes${start > 0 ? ' for the rest' : ''} — asking ${ai.model}…` };

  const o = await callJson(ai.llm, { system: AI_OUTLINE_SYSTEM_PROMPT, user: buildAiOutlineMessage(query, count, avoid), json: true, maxTokens: 900 }, raw => parseAiOutline(raw, count), signal);
  // Collection 0 of the whole web is the hub (the AI's own first collection when the KB had nothing).
  const hub = 0;
  // every collection hangs off the origin (its label is its own `edge`); links between collections are only for real tangents
  yield { type: 'ai-outline', start, context: o.context, clusters: o.titles.map((title, i) => ({ title, slots: perCollection, edge: o.edgeLabels[i] })), edges: [], model: ai.model };

  yield { type: 'status', message: `${ai.model} is writing cards…` };
  const used = o.titles.map(() => 0);
  const written_ = new Set<string>(); // titles already on the web, so the same card is never written twice
  const titleOf = (f: { title: string }) => f.title.toLowerCase().trim();
  let written = 0;
  {
    for await (const obj of streamObjects(ai.llm.stream({ system: AI_CARDS_SYSTEM_PROMPT, user: buildAiCardsMessage(query, o.context, o.titles, perCollection), maxTokens: 4500 }, signal), ai.llm, signal)) {
      const fragment = fromAi(obj, ai.model);
      if (!fragment) continue;
      let c = Number((obj as any).cluster);
      if (!Number.isInteger(c) || c < 0 || c >= o.titles.length || used[c] >= perCollection) c = used.findIndex(n => n < perCollection);
      if (c < 0) continue; // every slot filled
      if (written_.has(titleOf(fragment))) continue;
      written_.add(titleOf(fragment));
      yield { type: 'fragment', cluster: start + c, slot: used[c]++, fragment };
      written++;
    }
  }
  // Smaller local models often stop after a few cards however many were asked for: ask for what is missing, one collection at a time.
  for (let c = 0; c < o.titles.length; c++) {
    if (used[c] >= perCollection || signal.aborted) continue;
    yield { type: 'status', message: `${ai.model} is writing more for “${o.titles[c]}”…` };
    try {
      for await (const obj of streamObjects(ai.llm.stream({ system: AI_CARDS_SYSTEM_PROMPT, user: buildAiCollectionMessage(query, o.context, o.titles, c, perCollection - used[c], [...written_]), maxTokens: 2500 }, signal), ai.llm, signal)) {
        const fragment = fromAi(obj, ai.model);
        if (!fragment || used[c] >= perCollection) continue;
        if (written_.has(titleOf(fragment))) continue;
        written_.add(titleOf(fragment));
        yield { type: 'fragment', cluster: start + c, slot: used[c]++, fragment };
        written++;
      }
    } catch (err) {
      if (err instanceof WebsError && err.code === 'cancelled') throw err;
      if (written === 0) throw err; // nothing at all to show: let the caller say why
    }
  }
  if (written === 0) throw new WebsError('bad-json', 'The AI returned no usable cards.');
}
