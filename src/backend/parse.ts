// Parsing helpers: an incremental JSON-object stream parser and normalizers for model output.

import type { FragmentType } from '../types/fragments';
import { WebsError } from './errors';
import type { LlmService } from './llm';
import { repairParse, repairViaModel } from './repair';
import type { GeneratedFragment, OverviewEdge } from './events';

const GENERATED_TYPES: FragmentType[] = ['person', 'concept', 'thesis', 'source', 'event', 'era', 'domain', 'quote'];

/**
 * Feed text chunks; get back each complete top-level JSON object as soon as its closing brace arrives.
 * Tolerates code fences, prose between objects, and pretty-printed (multi-line) objects.
 */
export class JsonObjectStream {
  private depth = 0;
  private inString = false;
  private escaped = false;
  private current = '';
  /** Objects that were not valid JSON even after local repair (see repairViaModel for a second chance). */
  rejected: string[] = [];

  /** The stream ended: an object still open was cut off. Close it off if what was written makes sense. */
  end(): unknown[] {
    if (this.depth === 0) return [];
    const fixed = repairParse(this.current);
    this.depth = 0; this.current = ''; this.inString = false;
    return fixed && typeof fixed === 'object' ? [fixed] : [];
  }

  feed(chunk: string): unknown[] {
    const out: unknown[] = [];
    for (const ch of chunk) {
      if (this.depth === 0) {
        if (ch === '{') { this.depth = 1; this.current = '{'; }
        continue;
      }
      this.current += ch;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === '\\') this.escaped = true;
        else if (ch === '"') this.inString = false;
      } else if (ch === '"') this.inString = true;
      else if (ch === '{') this.depth++;
      else if (ch === '}' && --this.depth === 0) {
        try { out.push(JSON.parse(this.current)); } catch {
          const fixed = repairParse(this.current);
          if (fixed && typeof fixed === 'object') out.push(fixed); else this.rejected.push(this.current);
        }
        this.current = '';
      }
    }
    return out;
  }
}

/**
 * Each JSON object in a model's stream, as it completes. Damaged ones are repaired on the spot; an object cut off at
 * the end is closed off; and the few that cannot be repaired locally get one try with the model.
 */
export async function* streamObjects(stream: AsyncIterable<string>, llm: LlmService, signal?: AbortSignal): AsyncGenerator<unknown> {
  const parser = new JsonObjectStream();
  for await (const chunk of stream) yield* parser.feed(chunk);
  yield* parser.end();
  for (const bad of parser.rejected.slice(0, 3)) {
    const fixed = await repairViaModel(llm, bad, signal);
    if (fixed && typeof fixed === 'object') yield fixed;
  }
}

/** Extract the single top-level JSON object from a (possibly fenced) response. */
export function parseJsonObject(raw: string): any {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0) throw new WebsError('bad-json', 'Model response contained no JSON object.');
  try {
    if (end <= start) throw new Error('unterminated');
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    const fixed = repairParse(raw.slice(start));
    if (fixed && typeof fixed === 'object' && !Array.isArray(fixed)) return fixed;
    throw new WebsError('bad-json', `Model response was not valid JSON (${(e as Error).message}).`);
  }
}

export function normalizeFragment(raw: any): GeneratedFragment | null {
  if (!raw || typeof raw.title !== 'string' || typeof raw.body !== 'string' || !raw.title || !raw.body) return null;
  const { cluster: _cluster, ...rest } = raw;
  return { ...rest, type: GENERATED_TYPES.includes(raw.type) ? raw.type : 'concept' };
}

/**
 * What the model contributes to a card built from a passage: its kind, a title, tags and the bridge sentence. The body
 * is not the model's to write — it is the passage itself, shown in full (see lensed.ts).
 */
export interface CardMeta { fits?: boolean; type: FragmentType; title: string; tags?: string[]; bridge?: string; weight?: 1 | 2 | 3; retelling?: string; when?: string; relates?: Array<{ to: string; verb: string }> }

export function cardMeta(raw: any): CardMeta | null {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  const bridge = (typeof raw.hook === 'string' ? raw.hook : typeof raw.bridge === 'string' ? raw.bridge : '').trim().slice(0, 300);
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean).slice(0, 4) : [];
  const retelling = typeof raw.retelling === 'string' ? raw.retelling.trim() : '';
  const relates = (Array.isArray(raw.relates) ? raw.relates : [])
    .map((r: any) => ({ to: String(r?.to ?? '').toUpperCase().replace(/[^P0-9]/g, ''), verb: String(r?.verb ?? '').trim().slice(0, 40) }))
    .filter((r: { to: string; verb: string }) => r.to && r.verb).slice(0, 3);
  const weight = Number(raw.weight);
  const when = typeof raw.when === 'string' || typeof raw.when === 'number' ? String(raw.when).trim().slice(0, 30) : '';
  return {
    ...(raw.fits === false ? { fits: false } : {}),
    type: GENERATED_TYPES.includes(raw.type) ? raw.type : 'concept', title: raw.title.trim(),
    ...(tags.length ? { tags } : {}), ...(bridge ? { bridge } : {}), ...(retelling ? { retelling } : {}), ...(when ? { when } : {}),
    ...(relates.length ? { relates } : {}), ...(weight === 1 || weight === 2 || weight === 3 ? { weight: weight as 1 | 2 | 3 } : {}),
  };
}

export interface Overview {
  context: string;
  titles: string[];
  edges: OverviewEdge[];
}

export function parseOverview(raw: string): Overview {
  const data = parseJsonObject(raw);
  if (!Array.isArray(data?.clusters) || data.clusters.length === 0) {
    throw new WebsError('bad-json', 'Overview is missing "clusters".');
  }
  const titles: string[] = data.clusters.map((c: any) => String(c?.title ?? c ?? '').trim());
  if (titles.some(t => !t)) throw new WebsError('bad-json', 'A cluster is missing a title.');

  const edges: OverviewEdge[] = (Array.isArray(data.edges) ? data.edges : [])
    .map((e: any) => ({ source: resolveIndex(e?.source, titles), target: resolveIndex(e?.target, titles), label: String(e?.label ?? '') }))
    .filter((e: OverviewEdge) => e.source >= 0 && e.target >= 0 && e.source !== e.target);

  return { context: String(data.context ?? ''), titles, edges };
}

/** Accepts a 0-based index or (as a fallback) an exact cluster title. */
function resolveIndex(ref: unknown, titles: string[]): number {
  if (typeof ref === 'number' && Number.isInteger(ref) && ref >= 0 && ref < titles.length) return ref;
  if (typeof ref === 'string') return titles.indexOf(ref);
  return -1;
}

/** Overview for the lensed strategy: one title per collection (by index) and edges between collections. */
export function parseLensedOverview(raw: string, count: number): { context: string; titles: Array<string | null>; edgeLabels: Array<string | null>; edges: OverviewEdge[]; skip: string[] } {
  const data = parseJsonObject(raw);
  const clusters: unknown[] = Array.isArray(data?.clusters) ? data.clusters : [];
  const titles = Array.from({ length: count }, (_, i) => {
    const c = clusters[i] as { title?: unknown } | string | undefined;
    const t = typeof c === 'string' ? c : typeof c?.title === 'string' ? c.title : '';
    return t.trim() || null;
  });
  // how each collection relates to the question itself (the label of its line from the origin)
  const edgeLabels = Array.from({ length: count }, (_, i) => { const l = (clusters[i] as { edge?: unknown } | undefined)?.edge; return typeof l === 'string' && l.trim() ? l.trim().slice(0, 40) : null; });
  const edges: OverviewEdge[] = (Array.isArray(data?.edges) ? data.edges : [])
    .map((e: any) => ({ source: Number(e?.source), target: Number(e?.target), label: String(e?.label ?? '').trim() }))
    .filter((e: OverviewEdge) => Number.isInteger(e.source) && Number.isInteger(e.target) && e.source >= 0 && e.target >= 0 && e.source < count && e.target < count && e.source !== e.target && e.label);
  const fromList = (Array.isArray(data?.skip) ? data.skip : []).map((x: unknown) => String(x).toUpperCase().replace(/[^P0-9]/g, '')).filter(Boolean);
  // a verdict for every passage ({"P1": "fits", "P2": "off-topic"}) makes the model actually look at each one
  const verdicts = data?.verdicts && typeof data.verdicts === 'object' ? Object.entries(data.verdicts as Record<string, unknown>) : [];
  const fromVerdicts = verdicts.filter(([, v]) => /^(off|no|skip|irrelevant|not)/i.test(String(v))).map(([id]) => id.toUpperCase().replace(/[^P0-9]/g, ''));
  const skip = [...new Set([...fromList, ...fromVerdicts])];
  return { context: String(data?.context ?? '').trim(), titles, edgeLabels, edges, skip };
}
