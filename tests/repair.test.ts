import { describe, expect, it } from 'vitest';
import { parseJsonObject, streamObjects, JsonObjectStream } from '../src/backend/parse';
import { callJson, repairParse, repairViaModel } from '../src/backend/repair';
import type { LlmService } from '../src/backend/llm';

const llm = (...replies: string[]): LlmService & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, stream: async function* () { yield ''; }, call: async o => { calls.push(o.system.slice(0, 20)); return replies[Math.min(calls.length - 1, replies.length - 1)]; } };
};

describe('repairParse', () => {
  it('fixes the usual local-model damage without changing the content', () => {
    expect(repairParse('{"a": 1, "b": [1, 2,],}')).toEqual({ a: 1, b: [1, 2] });
    expect(repairParse("{'title': 'it\\'s fine', \"n\": 2}")).toEqual({ title: "it's fine", n: 2 });
    expect(repairParse('{title: "x", ok: True, none: None}')).toEqual({ title: 'x', ok: true, none: null });
    expect(repairParse('{"body": "line one\nline two\twith tab"}')).toEqual({ body: 'line one\nline two\twith tab' });
    expect(repairParse('```json\n{"a": 1} // done\n```')).toEqual({ a: 1 });
    expect(repairParse('{"a": /* why */ 1}')).toEqual({ a: 1 });
    expect(repairParse('{"quote": "she said "hello" to him", "n": 1}')).toEqual({ quote: 'she said "hello" to him', n: 1 });
  });
  it('closes a reply that was cut off, and drops the unfinished item rather than guessing it', () => {
    expect(repairParse('{"title": "x", "body": "the whole thing so f')).toEqual({ title: 'x', body: 'the whole thing so f' });
    expect(repairParse('{"title": "x", "tags": ["a", "b"')).toEqual({ title: 'x', tags: ['a', 'b'] });
    expect(repairParse('{"title": "x", "weight":')).toEqual({ title: 'x', weight: null });
    expect(repairParse('{"title": "x", "relates"')).toEqual({ title: 'x' });
  });
  it('gives up on text with no JSON in it', () => { expect(repairParse('Sorry, I cannot help with that.')).toBeUndefined(); });
});

describe('parsing with repair', () => {
  it('parseJsonObject accepts a damaged object', () => { expect(parseJsonObject('Here: {"context": "c", "titles": ["a",],')).toEqual({ context: 'c', titles: ['a'] }); });
  it('the stream repairs an object that closes badly, and closes off the last one if cut off', () => {
    const p = new JsonObjectStream();
    const got = [...p.feed('{"a": 1,}\n{"b": 2, "c": [1,2,]}\n{"d": "unfin'), ...p.end()];
    expect(got).toEqual([{ a: 1 }, { b: 2, c: [1, 2] }, { d: 'unfin' }]);
  });
  it('asks the model once to fix an object it cannot repair locally', async () => {
    async function* chunks() { yield '{"title": "good"}\n'; yield '{"title" "broken" ]]}\n'; }
    const m = llm('{"title": "fixed"}');
    const got: unknown[] = [];
    for await (const o of streamObjects(chunks(), m)) got.push(o);
    expect(got).toEqual([{ title: 'good' }, { title: 'fixed' }]);
    expect(m.calls).toHaveLength(1);
  });
  it('repairViaModel returns undefined when the model is no help', async () => {
    expect(await repairViaModel(llm('no idea'), '{{{')).toBeUndefined();
  });
});

describe('callJson', () => {
  const parse = (raw: string) => { const o = parseJsonObject(raw); if (!o.ok) throw Object.assign(new (require('../src/backend/errors').WebsError)('bad-json', 'no ok'), {}); return o; };
  it('returns a good answer straight away', async () => { const m = llm('{"ok": true}'); expect(await callJson(m, { system: 's', user: 'u' }, parse)).toEqual({ ok: true }); expect(m.calls).toHaveLength(1); });
  it('fixes a damaged answer locally with no second call', async () => { const m = llm('{"ok": true,}'); expect(await callJson(m, { system: 's', user: 'u' }, parse)).toEqual({ ok: true }); expect(m.calls).toHaveLength(1); });
  it('uses the model\'s repair when the answer is unusable, then asks again only if that fails too', async () => {
    const m = llm('I think the answer is yes', '{"ok": true}');
    expect(await callJson(m, { system: 'ask', user: 'u' }, parse)).toEqual({ ok: true });
    expect(m.calls).toHaveLength(2);
    await expect(callJson(llm('nope'), { system: 's', user: 'u' }, parse)).rejects.toThrow();
  });
});
