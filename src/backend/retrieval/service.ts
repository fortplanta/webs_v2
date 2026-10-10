import { getSettings } from '../settings';
import { defaultRetrieveConfig, type RetrieveConfig } from './config';
import { loadIndex } from './index';
import { retrieve, type Retrieval } from './retrieve';

export interface Retriever {
  retrieve(query: string): Promise<Retrieval>;
}

/** Retrieval over the KB folder and enabled modules from Settings. */
export const kbRetriever: Retriever = {
  async retrieve(query) {
    const s = getSettings();
    const index = await loadIndex(s.kb.dir, s.kb.disabledModules);
    const cfg: RetrieveConfig = { ...defaultRetrieveConfig, clusterCount: s.generation.clusterCount, fragmentsPerCluster: s.generation.fragmentsPerCluster };
    return retrieve(index, query, cfg);
  },
};
