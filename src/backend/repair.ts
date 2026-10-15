// Repairing model JSON. Local models routinely nearly-get JSON right: a trailing comma, a raw newline inside a string,
// single quotes, an unquoted key, a reply cut off mid-object. Throwing the whole answer away and asking again is slow
// and often fails the same way, so: first fix what can be fixed deterministically (repairParse), then, if that is not
// enough, ask the model to fix its own JSON without changing what it says (repairViaModel). Neither ever adds content:
// repair changes punctuation, and cuts off anything unfinished rather than guessing it.

import { WebsError } from './errors';
import type { LlmService } from './llm';

type Snapshot = { len: number; stack: string[] };

/** Rewrites lenient / damaged JSON as strict JSON text, or null if there is nothing JSON-like. Cuts back an unfinished tail. */
function normalize(raw: string): string[] {
  const text = raw.replace(/^﻿/, '');
  const start = text.search(/[{[]/);
  if (start < 0) return [];
  const out: string[] = [];
  const stack: string[] = [];
  const commas: Snapshot[] = [];
  let quote: string | null = null;
  const lastSignificant = () => { for (let k = out.length - 1; k >= 0; k--) if (!/\s/.test(out[k])) return out[k]; return ''; };
  const trimComma = () => { while (out.length && /[\s,]/.test(out[out.length - 1])) out.pop(); };
  let done = false;

  for (let i = start; i < text.length && !done; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        const next = text[i + 1] ?? '';
        if (quote === "'" && next === "'") out.push("'"); else out.push('\\', next);
        i++;
      } else if (ch === quote) {
        // an unescaped quote inside a string ("she said "hi" to him") is part of the text, unless what follows shows the string ended
        const next = text.slice(i + 1).match(/^\s*(.?)/)![1];
        if (quote === '"' && next !== '' && !',}]:'.includes(next)) out.push('\\"'); else { out.push('"'); quote = null; }
      }
      else if (ch === '"') out.push('\\"');
      else if (ch === '\n') out.push('\\n');
      else if (ch === '\t') out.push('\\t');
      else if (ch === '\r' || ch < ' ') continue;
      else out.push(ch);
      continue;
    }
    if (/\s/.test(ch)) { out.push(ch); continue; }
    if (ch === '"' || ch === "'") { quote = ch; out.push('"'); continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); out.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      trimComma();
      const top = stack.pop();
      out.push(top === '[' ? ']' : '}');
      if (!stack.length) done = true;
      continue;
    }
    if (ch === ',') { out.push(','); commas.push({ len: out.length, stack: [...stack] }); continue; }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      const after = text.slice(j).match(/^\s*(:)?/)![0];
      const prev = lastSignificant();
      if (after.includes(':') && (prev === '{' || prev === ',')) out.push(`"${word}"`);
      else if (word === 'true' || word === 'false' || word === 'null') out.push(word);
      else if (word === 'True') out.push('true'); else if (word === 'False') out.push('false'); else if (word === 'None') out.push('null');
      else out.push(`"${word}"`);
      i = j - 1;
      continue;
    }
    out.push(ch);
  }

  const close = (body: string[], st: string[], inString: boolean) => {
    let s = body.join('');
    if (inString) s += '"';
    s = s.replace(/[\s,]+$/, '');
    if (s.endsWith(':')) s += 'null';
    return s + [...st].reverse().map(c => (c === '[' ? ']' : '}')).join('');
  };
  const candidates = [close(out, stack, quote !== null)];
  // an unfinished tail ("a":1,"b" or a half-written value) may not close cleanly: cut back to the last whole item
  for (let k = commas.length - 1, tries = 0; k >= 0 && tries < 6; k--, tries++) candidates.push(close(out.slice(0, commas[k].len), commas[k].stack, false));
  return candidates;
}

/** Parses `raw` as JSON, repairing common damage. Returns undefined if even the repair cannot make sense of it. */
export function repairParse(raw: string): unknown | undefined {
  for (const candidate of normalize(raw)) {
    try { return JSON.parse(candidate); } catch { /* try the next, shorter candidate */ }
  }
  return undefined;
}

const REPAIR_SYSTEM = `You repair broken JSON. The user gives you text that was meant to be one JSON object but is not valid. Reply with the corrected JSON object only: no commentary, no code fences. Keep every key and every word of every value exactly as written; only fix punctuation, quoting, escaping and brackets. Never add, remove or rephrase content. If the text is cut off, end it where it was cut off and close the brackets.`;

/** Asks the model to fix its own broken JSON (temperature 0, content unchanged). Undefined if it cannot. */
export async function repairViaModel(llm: LlmService, bad: string, signal?: AbortSignal): Promise<unknown | undefined> {
  try {
    const reply = await llm.call({ system: REPAIR_SYSTEM, user: bad.slice(0, 6000), json: true, maxTokens: 3000, temperature: 0 }, signal);
    try { return JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { return repairParse(reply); }
  } catch (err) {
    if (err instanceof WebsError && err.code === 'cancelled') throw err;
    return undefined;
  }
}

/**
 * One JSON-returning model call that survives a bad reply: parse it; if that fails, repair it locally, then with the
 * model; only then ask the whole question again (once). `parse` throws WebsError('bad-json') for anything unusable.
 */
export async function callJson<T>(llm: LlmService, opts: Parameters<LlmService['call']>[0], parse: (raw: string) => T, signal?: AbortSignal): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm.call(opts, signal);
    try { return parse(raw); } catch (err) {
      if (!(err instanceof WebsError) || err.code !== 'bad-json') throw err;
      lastErr = err;
    }
    const fixed = await repairViaModel(llm, raw, signal);
    if (fixed !== undefined) {
      try { return parse(JSON.stringify(fixed)); } catch (err) {
        if (!(err instanceof WebsError) || err.code !== 'bad-json') throw err;
      }
    }
  }
  throw lastErr;
}
