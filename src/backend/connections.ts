// Connections: the user links two cards; the model gives its opinion on the link. It never decides for the user (an
// arrow the user drew stays), it just says whether the link holds up, whether it is well known or a lateral leap, and
// puts a short verb on it. Its note is held to the no-new-numbers rule, and shown as the model's opinion.

import { WebsError } from './errors';
import type { ConnectRequest, ConnectResult, ConnectionVerdict, GeneratedFragment } from './events';
import { ollamaLlm, type LlmService } from './llm';
import { checkNumbers, NARRATOR_VOICE, sentenceCase } from './narration';
import { configuredProvider } from './provider';
import { parseJsonObject } from './parse';
import { callJson } from './repair';

const SYSTEM = `You judge a link between two cards on a research canvas, from your general knowledge.

${NARRATOR_VOICE}

Reply with one JSON object and nothing else:
{"link": "solid | stretch | none", "tier": "obvious | lateral", "verb": "1-5 words", "note": "one or two sentences"}

- "link": "solid" if the link holds up, "stretch" if it is a reach or only partly true, "none" if you can see no real link.
- "tier": "obvious" if it is a well-known, direct relationship; "lateral" if it is an unexpected connection that takes some thought to see.
- "verb": a short verb phrase for the arrow from card A to card B, e.g. "led to", "is the opposite of", "is an example of". Lowercase.
- "note": why it holds or doesn't. Plain, honest, in your voice. If the user explained the link, judge their explanation fairly. Never invent quotations, citations, statistics, dates or numbers.`;

const text = (c: GeneratedFragment) => `"${c.title}" (${c.type}): ${(c.original ?? c.body).slice(0, 600)}`;

export function parseVerdict(raw: string, sources: string): ConnectionVerdict {
  const o = parseJsonObject(raw);
  const link = ['solid', 'stretch', 'none'].includes(o.link) ? o.link : null;
  if (!link) throw new WebsError('bad-json', 'The model did not say whether the link holds.');
  const verb = String(o.verb ?? '').trim().toLowerCase().replace(/[."]+$/g, '').split(/\s+/).slice(0, 6).join(' ');
  let note = sentenceCase(String(o.note ?? '').trim().slice(0, 400));
  if (note && !checkNumbers(note, sources).ok) note = ''; // an opinion that brings in figures of its own is dropped, the verdict stays
  return { link, tier: o.tier === 'lateral' ? 'lateral' : 'obvious', verb: verb || 'relates to', note };
}

export async function judgeConnection(req: ConnectRequest, opts: { signal?: AbortSignal; llm?: LlmService } = {}): Promise<ConnectResult> {
  const llm = opts.llm ?? configuredProvider() ?? ollamaLlm;
  const explanation = (req.explanation ?? '').trim().slice(0, 400);
  const user = `Card A: ${text(req.a)}\nCard B: ${text(req.b)}\n\n${explanation ? `The user says they are connected like this: "${explanation}"` : 'The user has not said how they are connected. Say whether you can see a real link.'}`;
  const sources = `${req.a.title} ${req.a.original ?? req.a.body} ${req.b.title} ${req.b.original ?? req.b.body} ${explanation}`;
  try {
    return { ok: true, verdict: await callJson(llm, { system: SYSTEM, user, json: true, maxTokens: 300, temperature: 0.3 }, raw => parseVerdict(raw, sources), opts.signal) };
  } catch (err) {
    if (err instanceof WebsError && err.code === 'cancelled') return { ok: false, message: 'Cancelled.' };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

