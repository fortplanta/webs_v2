import { describe, expect, it } from 'vitest';
import { runLens } from '../src/backend/lenses';
import type { GeneratedFragment } from '../src/backend/events';
import type { LlmService } from '../src/backend/llm';

const card: GeneratedFragment = { type: 'person', title: 'isaac newton', body: 'Isaac Newton published the Principia in 1687. It set out the laws of motion.', origin: 'wiki', sourceLabel: 'Simple English Wikipedia', kbSources: ['simple:Isaac Newton'] };
const llmSaying = (...replies: string[]): LlmService & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    stream: async function* () { yield ''; },
    call: async opts => { calls.push(opts.user); return replies[Math.min(calls.length - 1, replies.length - 1)]; },
  };
};

describe('lenses', () => {
  it('a rewrite keeps the card\'s provenance and is marked retold', async () => {
    const llm = llmSaying('Isaac Newton wrote a famous book called the Principia in 1687. In it he explained how things move.');
    const r = await runLens({ card, lens: 'explain-simple' }, { llm });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fragment).toMatchObject({ retold: true, origin: 'wiki', sourceLabel: 'Simple English Wikipedia', original: card.body, weight: 1 });
    expect(r.fragment.title).toBe('explain simply: isaac newton');
  });
  it('refuses a rewrite that adds a number, retrying once with the reason', async () => {
    const llm = llmSaying('Newton wrote the Principia in 1688, a big book.', 'Newton wrote the Principia in 1687, a big book.');
    const r = await runLens({ card, lens: 'vivid' }, { llm });
    expect(r.ok).toBe(true);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain('1688');
  });
  it('gives up with a message when it keeps inventing', async () => {
    const r = await runLens({ card, lens: 'vivid' }, { llm: llmSaying('Newton, born in 1642, wrote it in 1688 or so.') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/aren't in the card/);
  });
  it('an argument is marked as the AI\'s, not the source\'s, and may use new names but not new numbers', async () => {
    const r = await runLens({ card, lens: 'challenge' }, { llm: llmSaying('Leibniz developed calculus independently, so crediting Newton alone for this era of mathematics overlooks a bitter rivalry.'), model: 'qwen3:8b' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fragment).toMatchObject({ origin: 'ai', aiModel: 'qwen3:8b', lens: 'challenge', type: 'thesis' });
    expect(r.fragment.kbSources).toBeUndefined();
    const bad = await runLens({ card, lens: 'steelman' }, { llm: llmSaying('Studies show 87 percent of physicists agree with this long claim here.') });
    expect(bad.ok).toBe(false);
  });
  it('turns a provider failure into a message', async () => {
    const llm: LlmService = { stream: async function* () { yield ''; }, call: async () => { throw new Error('Ollama is not running'); } };
    const r = await runLens({ card, lens: 'fact-check' }, { llm });
    expect(r).toEqual({ ok: false, message: 'Ollama is not running' });
  });
});
