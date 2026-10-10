// Retrieval + selection. Pure and deterministic (no I/O, no LLM): same index and query → same result,
// which makes it easy to test and to tune.
//
//  1. Direct matches: BM25 on the query terms, with a relevance floor (nothing "surprising" gets in
//     unless it is first demonstrably relevant).
//  2. Routes: each lens turns a direct match into a candidate for that relationship when the passage
//     contains the lens's cue words.
//  3. Bridges: ideas that recur in the best direct passages are followed one hop to passages that
//     don't mention the query at all ("barbed wire → confinement → prison"). Damped, and marked as a hop.
//  4. Selection: anchor first, then greedily add whatever adds the most to the set already chosen.
//     value = rel·(w.rel + w.conn·connection + w.nov·novelty) − w.red·redundancy − w.dist·hops
//     Connection and novelty are *multiplied by* relevance, so they amplify a relevant passage but can
//     never make an irrelevant one win. Redundancy and extra hops are plain costs.

import type { KbPassage } from '../events';
import { BRIDGE_LENS, DIRECT_LENS, type Lens } from './lenses';
import { PassageIndex, type IndexedPassage } from './index';
import type { RetrieveConfig } from './config';
import { jaccard, terms } from './text';

export interface SelectedPassage extends KbPassage {
  id: string;
  lens: string;
  heading: string;
  /** Why it was chosen — kept so selection can be inspected and tuned. */
  score: { value: number; rel: number; conn: number; nov: number; red: number };
  /** Terms of the passage, for grounding checks. */
  terms: string[];
}

export interface Collection {
  lens: string;
  label: string;
  verb: string;
  passages: SelectedPassage[];
}

export interface Retrieval {
  query: string;
  terms: string[];
  collections: Collection[];
  /** How many passages cleared the relevance floor (before selection). */
  considered: number;
}

interface Candidate { p: IndexedPassage; lens: string; rel: number; conn: number; dist: number; via?: string[] }

function bridgeTermsFor(index: PassageIndex, top: IndexedPassage[], queryTerms: Set<string>, k: number): Map<string, number> {
  const topIds = new Set(top.map(p => p.id));
  const score = new Map<string, number>();
  for (const p of top) for (const [t, f] of p.tf) {
    if (queryTerms.has(t) || /^\d+$/.test(t)) continue;
    // must also occur somewhere else, or following it leads nowhere
    const elsewhere = index.passages.some(o => !topIds.has(o.id) && o.tf.has(t));
    if (!elsewhere) continue;
    score.set(t, (score.get(t) ?? 0) + f * index.idf(t));
  }
  const best = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  const max = best[0]?.[1] ?? 1;
  return new Map(best.map(([t, s]) => [t, s / max]));
}

export function retrieve(index: PassageIndex, query: string, cfg: RetrieveConfig): Retrieval {
  const q = [...new Set(terms(query))];
  const empty: Retrieval = { query, terms: q, collections: [], considered: 0 };
  if (q.length === 0 || index.passages.length === 0) return empty;

  // 1. direct matches
  const qWeights = new Map(q.map(t => [t, 1]));
  const scored = index.passages.map(p => ({ p, s: index.bm25(p, qWeights) }));
  const maxS = Math.max(...scored.map(x => x.s));
  if (!(maxS > 0)) return empty;
  const direct = scored.filter(x => x.s > 0 && x.s >= cfg.relevanceFloor * maxS).map(x => ({ p: x.p, rel: x.s / maxS }));
  const directIds = new Set(direct.map(d => d.p.id));

  // 2. routes
  const cands: Candidate[] = [];
  const lenses: Lens[] = cfg.lenses.filter(l => l.id !== BRIDGE_LENS.id);
  const cueTerms = new Map(lenses.map(l => [l.id, [...new Set(l.cues.flatMap(c => terms(c)))]]));
  for (const { p, rel } of direct) {
    for (const lens of lenses) {
      if (lens.id === DIRECT_LENS.id) { cands.push({ p, lens: lens.id, rel, conn: cfg.directConn, dist: 0 }); continue; }
      const hits = (cueTerms.get(lens.id) ?? []).filter(t => p.termSet.has(t)).length;
      if (hits > 0) cands.push({ p, lens: lens.id, rel, conn: Math.min(1, hits / cfg.cueHitsForFull), dist: 0 });
    }
  }

  // 3. bridges
  const top = [...direct].sort((a, b) => b.rel - a.rel).slice(0, 3).map(d => d.p);
  const bridge = bridgeTermsFor(index, top, new Set(q), cfg.bridgeTerms);
  if (bridge.size > 0) {
    for (const p of index.passages) {
      if (directIds.has(p.id)) continue;
      const hits = [...bridge.keys()].filter(t => p.termSet.has(t));
      if (hits.length === 0) continue;
      const strength = Math.min(1, hits.reduce((s, t) => s + (bridge.get(t) ?? 0), 0) / 2);
      // one weak shared word is a coincidence, not a connection: need two ideas, or one that clearly recurs
      if (hits.length < cfg.bridgeMinHits && strength < cfg.bridgeMinStrength) continue;
      cands.push({ p, lens: BRIDGE_LENS.id, rel: cfg.bridgeDamping * strength, conn: strength, dist: 1, via: hits.map(t => index.surface(t)) });
    }
  }

  // 4. selection
  const w = cfg.weights;
  const budget = cfg.clusterCount * cfg.fragmentsPerCluster;
  const picked: Array<Candidate & { value: number; nov: number; red: number }> = [];
  const chosen = new Set<string>(), sources = new Set<string>(), modules = new Set<string>();
  const perLens = new Map<string, number>();

  const next = (onlyDirect: boolean) => {
    let best: (Candidate & { value: number; nov: number; red: number }) | null = null;
    for (const c of cands) {
      if (chosen.has(c.p.id)) continue;
      if (onlyDirect && c.lens !== DIRECT_LENS.id) continue;
      if ((perLens.get(c.lens) ?? 0) >= cfg.fragmentsPerCluster) continue;
      if (!perLens.has(c.lens) && perLens.size >= cfg.clusterCount) continue;
      const nov = (sources.has(c.p.source) ? 0 : 0.6) + (modules.has(c.p.module) ? 0 : 0.4);
      const red = picked.reduce((m, s) => Math.max(m, jaccard(c.p.termSet, s.p.termSet)), 0);
      const lead = c.p.id.endsWith('#0') ? cfg.leadBonus : 0; // a document's opening paragraph tends to define its subject
      const value = onlyDirect ? c.rel + lead : c.rel * (w.rel + w.conn * c.conn + w.nov * nov) - w.red * red - w.dist * c.dist;
      if (!best || value > best.value) best = { ...c, value, nov, red };
    }
    return best;
  };
  const take = (c: NonNullable<ReturnType<typeof next>>) => {
    picked.push(c); chosen.add(c.p.id); sources.add(c.p.source); modules.add(c.p.module);
    perLens.set(c.lens, (perLens.get(c.lens) ?? 0) + 1);
  };

  const anchor = next(true); // the best direct match always opens the set
  if (!anchor) return { ...empty, considered: direct.length };
  take(anchor);
  while (picked.length < budget) {
    const c = next(false);
    if (!c || c.value < cfg.minValue) break;
    take(c);
  }

  // group into collections: the anchor's lens first, then by total value
  const byLens = new Map<string, typeof picked>();
  for (const c of picked) byLens.set(c.lens, [...(byLens.get(c.lens) ?? []), c]);
  const lensById = new Map<string, Lens>([...cfg.lenses, DIRECT_LENS, BRIDGE_LENS].map(l => [l.id, l]));
  const collections: Collection[] = [...byLens.entries()]
    .sort(([a, xs], [b, ys]) => (a === DIRECT_LENS.id ? -1 : b === DIRECT_LENS.id ? 1 : ys.reduce((s, y) => s + y.value, 0) - xs.reduce((s, x) => s + x.value, 0)))
    .map(([id, xs]) => {
      const lens = lensById.get(id)!;
      return {
        lens: id, label: lens.label, verb: lens.verb,
        passages: xs.map(c => ({
          id: c.p.id, source: c.p.source, text: c.p.text, heading: c.p.heading, lens: id, via: c.via,
          score: { value: round(c.value), rel: round(c.rel), conn: round(c.conn), nov: round(c.nov), red: round(c.red) },
          terms: [...c.p.termSet],
        })),
      };
    });

  return { query, terms: q, collections, considered: direct.length };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
