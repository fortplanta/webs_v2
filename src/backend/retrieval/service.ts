import { getSettings } from '../settings';
import { defaultRetrieveConfig, type RetrieveConfig } from './config';
import { loadIndex } from './index';
import { retrieve, retrieveTerms, type Retrieval, type RetrieveOptions } from './retrieve';
import { seedTerms } from './seed';

export interface Retriever {
  retrieve(query: string): Promise<Retrieval>;
  /** Passages related to a card (not a typed query), skipping those already used. Collections are ordered best-first. */
  retrieveFromCard(card: { title: string; body: string }, opts: RetrieveOptions): Promise<Retrieval>;
}

/** Retrieval over the KB folder and enabled modules from Settings. */
export const kbRetriever: Retriever = {
  async retrieve(query) {
    const s = getSettings();
    const index = await loadIndex(s.kb.dir, s.kb.disabledModules);
    const cfg: RetrieveConfig = { ...defaultRetrieveConfig, clusterCount: s.generation.clusterCount, fragmentsPerCluster: s.generation.fragmentsPerCluster };
    return retrieve(index, query, cfg);
  },
  async retrieveFromCard(card, opts) {
    const s = getSettings();
    const index = await loadIndex(s.kb.dir, s.kb.disabledModules);
    // Several routes are considered so the caller can pick a different angle; only one becomes a collection.
    const cfg: RetrieveConfig = { ...defaultRetrieveConfig, clusterCount: 4, fragmentsPerCluster: s.generation.fragmentsPerCluster, minCoverage: 0 };
    const q = seedTerms(index, card.title, card.body);
    return retrieveTerms(index, q.join(' '), q, cfg, opts);
  },
};
