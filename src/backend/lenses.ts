// Lenses: look at one card another way. Each makes a new card beside it and never touches the original.
//
// Two kinds, and the canvas says which is which:
//  - rewrites ("explain simply", "make it vivid") say what the card already says in another register. They are held to
//    the narrator's rule: no new numbers or names, or the result is refused.
//  - arguments ("fact check", "steelman", "challenge") reason from the model's general knowledge. They are marked as the
//    AI's, never as the source's, and may not bring new numbers (no invented statistics, dates or citations).

import { WebsError } from './errors';
import type { GeneratedFragment, LensId, LensRequest, LensResult } from './events';
import { llmModelName, ollamaLlm, type LlmService } from './llm';
import { checkClaims, checkNumbers, NARRATOR_VOICE, sentenceCase, type Check } from './narration';
import { aiModelName, configuredProvider } from './provider';

interface LensDef {
  id: LensId;
  label: string;
  description: string;
  /** 'rewrite' stays inside the card's own information; 'argument' reasons beyond it (and is marked as AI). */
  kind: 'rewrite' | 'argument';
  type: GeneratedFragment['type'];
  prompt: string;
}

const RULES = `Never invent quotations, citations, statistics, dates, URLs or numbers. Write plain prose in one or two short paragraphs, no headings, no bullet points, no markdown, no preamble. Capitalise names properly.`;

export const LENSES: LensDef[] = [
  { id: 'explain-simple', label: 'Explain simply', description: 'The same thing, for someone new to it', kind: 'rewrite', type: 'concept',
    prompt: `Explain the card to a curious ten-year-old: short sentences, everyday words, one small comparison if it helps. Say only what the card says: no new facts, names or numbers. ${RULES}` },
  { id: 'vivid', label: 'Make it vivid', description: 'The same thing, as a scene you can picture', kind: 'rewrite', type: 'concept',
    prompt: `Retell the card so a reader can picture it: concrete, sensory, a little atmosphere. Say only what the card says: no new facts, names or numbers, and no invented details of the scene. ${RULES}` },
  { id: 'fact-check', label: 'Fact check', description: 'Where the claims are solid and where they are shaky', kind: 'argument', type: 'source',
    prompt: `Fact-check the card from your general knowledge. Start with one verdict sentence ("Holds up", "Mostly holds up, with caveats" or "Doubtful"), then say which claims are well established, which are contested or oversimplified, and which you cannot judge. If you are not sure, say so. ${RULES}` },
  { id: 'steelman', label: 'Steelman', description: 'The strongest case for this idea', kind: 'argument', type: 'thesis',
    prompt: `Make the strongest honest case for the idea in the card, as its smartest defender would: the best reasons, the best evidence of the kind that exists, the likeliest objections answered. Do not overclaim. ${RULES}` },
  { id: 'challenge', label: 'Challenge', description: 'What could be wrong with this', kind: 'argument', type: 'thesis',
    prompt: `Challenge the card as a fair-minded critic would: the strongest objections, what it leaves out, what would have to be true for it to be wrong. Only claim things that are well established; where you are only suggesting a possibility, say "might" or ask the question. Do not invent people, events or counter-evidence. ${RULES}` },
];

export const lensById = (id: string) => LENSES.find(l => l.id === id);

const SYSTEM = (def: LensDef) => `You look at one card from a research canvas through a single lens.\n\n${NARRATOR_VOICE}\n\nThe lens: ${def.label}. ${def.prompt}\n\nReply with the text of the new card only.`;

const cardText = (c: GeneratedFragment) => `Card: "${c.title}"\n${c.original ?? c.body}${c.bridge ? `\nWhy it matters: ${c.bridge}` : ''}`;

/** The text the lens must stay within (a rewrite) or add no numbers to (an argument). */
const sourceOf = (c: GeneratedFragment) => `${c.title} ${c.original ?? c.body} ${c.bridge ?? ''}`;

const clean = (raw: string) => sentenceCase(raw.replace(/^```\w*\n?|```$/g, '').replace(/^["“]|["”]$/g, '').replace(/\*+/g, '').trim());

function verdict(def: LensDef, text: string, card: GeneratedFragment): Check {
  return def.kind === 'rewrite' ? checkClaims(text, sourceOf(card)) : checkNumbers(text, sourceOf(card));
}

/** Which service answers, and what to call the model on the card: the user's provider if set, else local Ollama. */
function service(): { llm: LlmService; model: string } {
  const provider = configuredProvider();
  return provider ? { llm: provider, model: aiModelName() } : { llm: ollamaLlm, model: llmModelName() };
}

export async function runLens(req: LensRequest, opts: { signal?: AbortSignal; llm?: LlmService; model?: string } = {}): Promise<LensResult> {
  const def = lensById(req.lens);
  if (!def) return { ok: false, message: `Unknown lens "${req.lens}".` };
  const { card } = req;
  const { llm, model } = opts.llm ? { llm: opts.llm, model: opts.model ?? 'model' } : service();
  let reason = '';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const user = attempt === 0 ? cardText(card)
        : `${cardText(card)}\n\nYour last attempt was refused because it contained ${reason}. Try again without it.`;
      const text = clean(await llm.call({ system: SYSTEM(def), user, maxTokens: 700, temperature: 0.6 }, opts.signal));
      if (text.length < 20) { reason = 'almost nothing'; continue; }
      const check = verdict(def, text, card);
      if (!check.ok) { reason = check.reason; continue; }
      const fragment: GeneratedFragment = def.kind === 'rewrite'
        // a rewrite keeps the card's own provenance: it is the same information in another voice
        ? { type: card.type, title: `${def.label.toLowerCase()}: ${card.title}`, body: text, retold: true, original: card.original ?? card.body, weight: 1,
            ...(card.origin ? { origin: card.origin } : {}), ...(card.sourceLabel ? { sourceLabel: card.sourceLabel } : {}), ...(card.kbSources ? { kbSources: card.kbSources } : {}), ...(card.link ? { link: card.link } : {}), grounding: 1 }
        : { type: def.type, title: `${def.label.toLowerCase()}: ${card.title}`, body: text, weight: 1, origin: 'ai', aiModel: model, lens: def.id, bridge: def.description };
      return { ok: true, fragment, label: def.label };
    }
    return { ok: false, message: `The model's ${def.label.toLowerCase()} kept bringing in things that aren't in the card (${reason}), so it was refused. Try again, or try a different model.` };
  } catch (err) {
    if (err instanceof WebsError && err.code === 'cancelled') return { ok: false, message: 'Cancelled.' };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
