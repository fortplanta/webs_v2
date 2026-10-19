// Running a companion action: one skill, or a cascade of stages that each build on the last. Everything is run through
// the one global voice, so every action sounds the same; a skill only says what to do.

import { WebsError } from '../errors';
import type { LlmService } from '../llm';
import { loadCatalog, loadSkill, loadStage, loadVoice, type Catalog, type Stage } from './skills';

export interface CompanionSource { app?: string; url?: string; title?: string }

export interface CompanionRequest {
  /** The modifier combination that opened the wheel, as the catalog names it ("shift", "shift+command", …). */
  mode: string;
  /** A skill id (single-key modes), a wheel entry id (cascades), or a keep id. */
  action: string;
  /** The text that was dragged. */
  text: string;
  source?: CompanionSource;
}

export type CompanionEvent =
  | { type: 'start'; title: string; steps: number }
  | { type: 'status'; message: string }
  | { type: 'section'; id: string; title: string }
  | { type: 'text'; chunk: string }
  | { type: 'section-end'; id: string }
  | { type: 'done'; title: string; markdown: string }
  | { type: 'kept'; action: string; label: string }
  | { type: 'error'; message: string };

export interface RunDeps { llm: LlmService; signal?: AbortSignal; catalog?: Catalog; voice?: string; stage?: (id: string) => Stage | null; skill?: typeof loadSkill }

/** What the model is told about the selection. */
export function selectionBlock(text: string, source?: CompanionSource): string {
  const where = [source?.title && `title: ${source.title}`, source?.url && `address: ${source.url}`, source?.app && `app: ${source.app}`].filter(Boolean).join('\n');
  return `The selected content:\n"""\n${text.trim()}\n"""${where ? `\n\nWhere it came from:\n${where}` : ''}`;
}

/** The chain's stages, in the order they run. A stage "needs" what earlier stages *produce* (a product name, e.g. `brief`). */
export const STAGE_IDS = ['situation', 'system', 'patterns', 'diagnosis', 'decision-brief', 'options', 'assumptions', 'loops', 'package'];

/** Every stage that has to run to produce what is in `show` (stage ids or product names), dependencies first. */
export function stagesFor(show: readonly string[], load: (id: string) => Stage | null): string[] {
  const stages = new Map<string, Stage>(), byProduct = new Map<string, Stage>();
  for (const id of STAGE_IDS) { const st = load(id); if (st) { stages.set(st.id, st); byProduct.set(st.produces, st); } }
  const order: string[] = [], visiting = new Set<string>();
  const visit = (key: string) => {
    const st = stages.get(key) ?? byProduct.get(key);
    if (!st) throw new WebsError('bad-json', `Unknown stage "${key}".`);
    if (order.includes(st.id) || visiting.has(st.id)) return;
    visiting.add(st.id);
    for (const need of st.needs) visit(need);
    order.push(st.id);
  };
  show.forEach(visit);
  return order;
}

/** Run an action, streaming what the model writes. Ends with exactly one 'done', 'kept' or 'error'. */
export async function* runAction(req: CompanionRequest, deps: RunDeps): AsyncGenerator<CompanionEvent> {
  const catalog = deps.catalog ?? loadCatalog();
  const voice = deps.voice ?? loadVoice();
  const stageOf = deps.stage ?? ((id: string) => loadStage(id));
  const skillOf = deps.skill ?? loadSkill;
  const mode = catalog.modes[req.mode];
  if (!mode) { yield { type: 'error', message: `No wheel for ${req.mode}.` }; return; }
  if (!req.text.trim()) { yield { type: 'error', message: 'Nothing was selected.' }; return; }

  try {
    // actions that run nothing
    if (mode.keeps) {
      const keep = catalog.keeps[req.action];
      if (!keep || !mode.keeps.includes(req.action)) throw new WebsError('bad-json', `Unknown action "${req.action}".`);
      yield { type: 'kept', action: req.action, label: keep.label };
      return;
    }

    // one skill
    if (mode.skills) {
      if (!mode.skills.includes(req.action)) throw new WebsError('bad-json', `"${req.action}" is not on the ${mode.title} wheel.`);
      const skill = skillOf(req.action);
      if (!skill) throw new WebsError('bad-json', `Missing skill "${req.action}".`);
      yield { type: 'start', title: skill.name, steps: 1 };
      yield { type: 'section', id: skill.id, title: skill.name };
      let md = '';
      const system = `${voice}\n\nTHE SKILL: ${skill.name}\n${skill.body.replace('{level}', String(skill.level ?? 2))}`;
      for await (const chunk of deps.llm.stream({ system, user: selectionBlock(req.text, req.source), maxTokens: 4000, temperature: 0.7 }, deps.signal)) { md += chunk; yield { type: 'text', chunk }; }
      yield { type: 'section-end', id: skill.id };
      yield { type: 'done', title: skill.name, markdown: md.trim() };
      return;
    }

    // a cascade
    const cascade = mode.cascade ? catalog.cascades[mode.cascade] : undefined;
    if (!cascade) throw new WebsError('bad-json', `The ${mode.title} wheel has nothing to run.`);
    const entry = cascade.wheel.find(w => w.id === req.action);
    if (!entry) throw new WebsError('bad-json', `"${req.action}" is not on the ${mode.title} wheel.`);
    const run = stagesFor(entry.show, stageOf);
    const shown = new Set(entry.show);
    yield { type: 'start', title: `${cascade.name}: ${entry.label}`, steps: run.length };
    const artifacts = new Map<string, string>(); // product → what the stage wrote
    let out = '';
    for (const [i, id] of run.entries()) {
      const stage = stageOf(id)!;
      yield { type: 'status', message: `${stage.name} (${i + 1} of ${run.length})…` };
      const earlier = stage.needs.map(n => [n, artifacts.get(n)] as const).filter(([, v]) => v).map(([n, v]) => `### ${n}\n${v}`).join('\n\n');
      const user = `${selectionBlock(req.text, req.source)}${earlier ? `\n\nWhat the earlier stages produced:\n${earlier}` : ''}`;
      const system = `${voice}\n\nTHIS IS STAGE ${i + 1} OF ${run.length} IN A CHAIN: ${stage.name.toUpperCase()}\n${stage.body}`;
      const visible = shown.has(id) || shown.has(stage.produces);
      if (visible) yield { type: 'section', id, title: stage.name };
      let md = '';
      for await (const chunk of deps.llm.stream({ system, user, maxTokens: 3000, temperature: 0.6 }, deps.signal)) { md += chunk; if (visible) yield { type: 'text', chunk }; }
      artifacts.set(stage.produces, md.trim());
      if (visible) { yield { type: 'section-end', id }; out += `${out ? '\n\n' : ''}## ${stage.name}\n\n${md.trim()}`; }
    }
    yield { type: 'done', title: `${cascade.name}: ${entry.label}`, markdown: out };
  } catch (err) {
    if (err instanceof WebsError && err.code === 'cancelled') return;
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
