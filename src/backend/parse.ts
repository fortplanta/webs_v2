// Parsing helpers: an incremental JSON-object stream parser and normalizers for model output.

import type { FragmentType } from '../types/fragments';
import { WebsError } from './errors';
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
        try { out.push(JSON.parse(this.current)); } catch { /* skip malformed object */ }
        this.current = '';
      }
    }
    return out;
  }
}

/** Extract the single top-level JSON object from a (possibly fenced) response. */
export function parseJsonObject(raw: string): any {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new WebsError('bad-json', 'Model response contained no JSON object.');
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw new WebsError('bad-json', `Model response was not valid JSON (${(e as Error).message}).`);
  }
}

export function normalizeFragment(raw: any): GeneratedFragment | null {
  if (!raw || typeof raw.title !== 'string' || typeof raw.body !== 'string' || !raw.title || !raw.body) return null;
  const { cluster: _cluster, ...rest } = raw;
  return { ...rest, type: GENERATED_TYPES.includes(raw.type) ? raw.type : 'concept' };
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
export function parseLensedOverview(raw: string, count: number): { context: string; titles: Array<string | null>; edges: OverviewEdge[] } {
  const data = parseJsonObject(raw);
  const clusters: unknown[] = Array.isArray(data?.clusters) ? data.clusters : [];
  const titles = Array.from({ length: count }, (_, i) => {
    const c = clusters[i] as { title?: unknown } | string | undefined;
    const t = typeof c === 'string' ? c : typeof c?.title === 'string' ? c.title : '';
    return t.trim() || null;
  });
  const edges: OverviewEdge[] = (Array.isArray(data?.edges) ? data.edges : [])
    .map((e: any) => ({ source: Number(e?.source), target: Number(e?.target), label: String(e?.label ?? '').trim() }))
    .filter((e: OverviewEdge) => Number.isInteger(e.source) && Number.isInteger(e.target) && e.source >= 0 && e.target >= 0 && e.source < count && e.target < count && e.source !== e.target && e.label);
  return { context: String(data?.context ?? '').trim(), titles, edges };
}
