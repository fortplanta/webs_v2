import { describe, expect, it } from 'vitest';
import { judgeConnection, parseVerdict } from '../src/backend/connections';
import type { LlmService } from '../src/backend/llm';
import { addLink, hasLink, linkLook } from '../src/renderer/link';
import type { El } from '../src/renderer/sceneEdit';

const card = (title: string, body: string) => ({ type: 'concept', title, body }) as any;
const A = card('stoicism', 'Stoics taught that virtue is the only good, in 300 BCE.'), B = card('cbt', 'Cognitive therapy teaches people to question automatic thoughts.');
const llm = (...replies: string[]): LlmService & { calls: number } => {
  const s = { calls: 0, stream: async function* () { yield ''; }, call: async () => replies[Math.min(s.calls++, replies.length - 1)] };
  return s;
};

describe('connection verdicts', () => {
  it('reads the verdict and shortens the verb', () => {
    const v = parseVerdict('{"link":"solid","tier":"lateral","verb":"Inspired the whole of modern therapy today.","note":"Beck cited the Stoics."}', 'x');
    expect(v).toEqual({ link: 'solid', tier: 'lateral', verb: 'inspired the whole of modern therapy', note: 'Beck cited the Stoics.' });
  });
  it('drops a note that brings in figures of its own, but keeps the verdict', () => {
    expect(parseVerdict('{"link":"stretch","tier":"obvious","verb":"led to","note":"About 87 percent of therapists agree."}', 'stoicism 300')).toMatchObject({ link: 'stretch', note: '' });
  });
  it('needs a verdict', () => { expect(() => parseVerdict('{"verb":"led to"}', 'x')).toThrow(); });
  it('retries once on bad JSON, then reports', async () => {
    const ok = llm('not json', '{"link":"solid","tier":"obvious","verb":"led to","note":"Yes."}');
    expect(await judgeConnection({ a: A, b: B }, { llm: ok })).toMatchObject({ ok: true, verdict: { link: 'solid' } });
    expect(ok.calls).toBe(2);
    expect((await judgeConnection({ a: A, b: B }, { llm: llm('nope') })).ok).toBe(false);
  });
});

const build = (sk: unknown[]): El[] => (sk as El[]).flatMap(s => {
  const { label, ...box } = s as El;
  return [{ version: 1, ...box, boundElements: label ? [{ type: 'text', id: `${s.id}-t` }] : null }, ...(label ? [{ type: 'text', id: `${s.id}-t`, containerId: s.id, text: label.text, x: 0, y: 0, width: 10, height: 10, version: 1 }] : [])];
});
const rect = (id: string, x: number): El => ({ id, type: 'rectangle', x, y: 0, width: 280, height: 150, version: 1 });

describe('links on the canvas', () => {
  const verdict = { link: 'solid', tier: 'lateral', verb: 'echoes', note: 'n' } as const;
  it('adds a labelled arrow that carries the verdict, and is found afterwards', () => {
    const { elements, id } = addLink([rect('a', 0), rect('b', 600)], { from: 'a', to: 'b', verdict, by: 'user', explanation: 'same idea' }, build, raw => ({ version: 1, ...raw }));
    const arrow = elements.find(e => e.id === id)!;
    expect(arrow).toMatchObject({ endArrowhead: null, strokeWidth: 2, strokeStyle: 'solid', customData: { kind: 'link', directed: true, by: 'user', tier: 'lateral', link: 'solid', note: 'n', explanation: 'same idea' } });
    expect(elements.find(e => e.containerId === id)).toMatchObject({ text: 'echoes' });
    expect(hasLink(elements, 'b', 'a')).toBe(true);
    expect(hasLink(elements, 'a', 'zzz')).toBe(false);
  });
  it('dashes a stretch and dims a link the model does not believe', () => {
    expect(linkLook({ link: 'stretch', tier: 'obvious' })).toMatchObject({ strokeStyle: 'dashed', strokeWidth: 1, opacity: 90 });
    expect(linkLook({ link: 'none', tier: 'obvious' }).opacity).toBeLessThan(90);
  });
});
