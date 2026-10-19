import { describe, expect, it } from 'vitest';
import { loadCatalog, loadSkill, loadStage, loadVoice, modeKey, parseSkillFile } from '../src/backend/companion/skills';
import { runAction, selectionBlock, stagesFor, STAGE_IDS, type CompanionEvent } from '../src/backend/companion/run';
import type { LlmService } from '../src/backend/llm';

const catalog = loadCatalog();
const voice = loadVoice();

/** A model that answers each request with the first line of its system prompt, so a test can see what it was asked. */
function fakeLlm() {
  const calls: Array<{ system: string; user: string }> = [];
  const llm: LlmService = {
    stream: async function* (o) { calls.push({ system: o.system, user: o.user }); yield 'answer to '; yield o.system.split('\n').find(l => /THE SKILL|STAGE \d/.test(l)) ?? 'x'; },
    call: async () => '',
  };
  return { llm, calls };
}
const run = async (req: Parameters<typeof runAction>[0], llm: LlmService) => { const out: CompanionEvent[] = []; for await (const e of runAction(req, { llm })) out.push(e); return out; };

describe('the skill files', () => {
  it('reads front matter and body', () => {
    expect(parseSkillFile('---\nid: x\nname: X thing\nlevel: 3\n---\nDo it.\nTwice.')).toEqual({ meta: { id: 'x', name: 'X thing', level: '3' }, body: 'Do it.\nTwice.' });
    expect(parseSkillFile('no front matter')).toEqual({ meta: {}, body: 'no front matter' });
  });
  it('every skill on a wheel exists, with a name, a body and the mode it is listed under', () => {
    for (const [key, mode] of Object.entries(catalog.modes)) for (const id of mode.skills ?? []) {
      const s = loadSkill(id)!;
      expect(s, `${key}/${id}`).toBeTruthy();
      expect(s.name.length).toBeGreaterThan(2); expect(s.name.length).toBeLessThanOrEqual(24); // fits a wheel segment
      expect(s.body.length).toBeGreaterThan(100);
      expect(s.mode).toBe(key);
    }
  });
  it('keeps tone out of the skills: that is the voice\'s job', () => {
    for (const mode of Object.values(catalog.modes)) for (const id of mode.skills ?? []) {
      const body = loadSkill(id)!.body.toLowerCase();
      for (const phrase of ['keep the tone', 'tone:', 'tone and format', 'brutally honest', 'zero fluff']) expect(body, `${id}: ${phrase}`).not.toContain(phrase);
    }
  });
  it('the global voice is the one place that says how to sound', () => {
    expect(voice).toMatch(/smart friend at a bar/i);
    expect(voice).toMatch(/fights, performance and stagecraft/i);
    expect(voice).toMatch(/who's winning/i);
    expect(voice).toMatch(/never invent/i);
  });
  it('every stage exists and what it needs is produced by an earlier stage', () => {
    const produced = new Set<string>();
    for (const id of STAGE_IDS) {
      const st = loadStage(id)!;
      expect(st, id).toBeTruthy();
      for (const n of st.needs) expect(produced.has(n), `${id} needs ${n}`).toBe(true);
      produced.add(st.produces);
    }
  });
  it('every wheel entry of every cascade names real stages', () => {
    for (const c of Object.values(catalog.cascades)) for (const w of c.wheel) expect(() => stagesFor(w.show, id => loadStage(id))).not.toThrow();
  });
});

describe('modes', () => {
  it('names a combination of held keys in a fixed order', () => {
    expect(modeKey(['command', 'shift'])).toBe('shift+command');
    expect(modeKey(['control', 'shift', 'command'])).toBe('shift+command+control');
    expect(modeKey(['control'])).toBe('control');
  });
  it('has a wheel for every combination of the three keys, and no skill on two wheels', () => {
    for (const k of ['shift', 'command', 'control', 'shift+command', 'command+control', 'shift+control', 'shift+command+control']) expect(catalog.modes[k], k).toBeTruthy();
    const all = Object.values(catalog.modes).flatMap(m => m.skills ?? []);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(16);
  });
});

describe('running an action', () => {
  const src = { app: 'Safari', url: 'https://en.wikipedia.org/wiki/Prospect_theory', title: 'Prospect theory' };

  it('runs a skill through the global voice, with the selection and where it came from', async () => {
    const { llm, calls } = fakeLlm();
    const ev = await run({ mode: 'shift', action: 'devils-advocate', text: 'Losses loom larger than gains.', source: src }, llm);
    expect(calls).toHaveLength(1);
    expect(calls[0].system.startsWith(voice)).toBe(true);
    expect(calls[0].system).toContain("THE SKILL: Devil's advocate");
    expect(calls[0].user).toContain('Losses loom larger than gains.');
    expect(calls[0].user).toContain('address: https://en.wikipedia.org/wiki/Prospect_theory');
    expect(ev.map(e => e.type)).toEqual(['start', 'section', 'text', 'text', 'section-end', 'done']);
    expect(ev.at(-1)).toMatchObject({ type: 'done', title: "Devil's advocate" });
  });
  it('fills in the depth level a skill asks for', async () => {
    const { llm, calls } = fakeLlm();
    await run({ mode: 'command', action: 'deep-research', text: 'An idea.' }, llm);
    expect(calls[0].system).toContain('Depth level: 2.');
  });
  it('every skill on the three single-key wheels runs', async () => {
    for (const mode of ['shift', 'command', 'control']) for (const action of catalog.modes[mode].skills!) {
      const { llm } = fakeLlm();
      expect((await run({ mode, action, text: 'Something to think about.' }, llm)).at(-1)?.type).toBe('done');
    }
  });
  it('refuses an action that is not on the wheel, an unknown wheel, and nothing selected', async () => {
    const { llm } = fakeLlm();
    expect((await run({ mode: 'shift', action: 'bottleneck', text: 'x' }, llm)).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('not on the Challenge wheel') });
    expect((await run({ mode: 'alt', action: 'x', text: 'x' }, llm)).at(-1)).toMatchObject({ type: 'error' });
    expect((await run({ mode: 'shift', action: 'analyze', text: '  ' }, llm)).at(-1)).toMatchObject({ type: 'error', message: 'Nothing was selected.' });
  });
  it('keeps run nothing: they are recorded and that is all', async () => {
    const { llm, calls } = fakeLlm();
    const ev = await run({ mode: 'shift+control', action: 'send-to-webs', text: 'x' }, llm);
    expect(ev).toEqual([{ type: 'kept', action: 'send-to-webs', label: 'Send to Webs' }]);
    expect(calls).toHaveLength(0);
  });
});

describe('cascades', () => {
  it('works out the stages a result needs, dependencies first', () => {
    const load = (id: string) => loadStage(id);
    expect(stagesFor(['diagnosis'], load)).toEqual(['situation', 'system', 'patterns', 'diagnosis']);
    expect(stagesFor(['situation'], load)).toEqual(['situation']);
    expect(stagesFor(['options'], load)).toEqual(['situation', 'system', 'patterns', 'diagnosis', 'decision-brief', 'options']);
    expect(stagesFor(['package'], load)).toEqual(STAGE_IDS);
  });
  it('runs every stage the wheel entry needs, each through the voice, each handed what came before, and shows only what was asked for', async () => {
    const { llm, calls } = fakeLlm();
    const ev = await run({ mode: 'command+control', action: 'options', text: 'A messy brief.' }, llm);
    expect(calls).toHaveLength(6);                                  // the options table needs the whole diagnosis and the brief first
    for (const c of calls) expect(c.system.startsWith(voice)).toBe(true);
    expect(calls[0].user).not.toContain('What the earlier stages produced');
    expect(calls[1].user).toContain('### situation');               // stage two sees stage one
    expect(calls[5].user).toContain('### brief');
    const sections = ev.filter(e => e.type === 'section');
    expect(sections).toEqual([{ type: 'section', id: 'options', title: 'Options table' }]);
    expect(ev.filter(e => e.type === 'status')).toHaveLength(6);
    const done = ev.at(-1) as Extract<CompanionEvent, { type: 'done' }>;
    expect(done.markdown.startsWith('## Options table')).toBe(true);
    expect(done.markdown).not.toContain('Situation card');
  });
  it('the full diagnosis shows its four stages, in order', async () => {
    const { llm } = fakeLlm();
    const ev = await run({ mode: 'shift+command', action: 'all', text: 'A conflict between two teammates.' }, llm);
    expect(ev.filter(e => e.type === 'section').map(e => (e as { id: string }).id)).toEqual(['situation', 'system', 'patterns', 'diagnosis']);
  });
  it('the whole machine runs all nine stages and shows them all', async () => {
    const { llm, calls } = fakeLlm();
    const ev = await run({ mode: 'shift+command+control', action: 'all', text: 'A launch decision.' }, llm);
    expect(calls).toHaveLength(9);
    expect(ev.filter(e => e.type === 'section')).toHaveLength(9);
  });
});

it('describes the selection for the model', () => {
  expect(selectionBlock(' hello ')).toBe('The selected content:\n"""\nhello\n"""');
});
