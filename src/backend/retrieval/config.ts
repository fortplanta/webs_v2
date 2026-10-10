// Everything tunable about retrieval and selection, in one place.

import { defaultLenses, type Lens } from './lenses';

export interface RetrieveConfig {
  /** Max collections (themed groups) and passages per collection. */
  clusterCount: number;
  fragmentsPerCluster: number;
  /** A passage must score at least this fraction of the best direct match to count as relevant at all. */
  relevanceFloor: number;
  /** Cue words a passage needs to match for a lens connection to count as fully established. */
  cueHitsForFull: number;
  /** Flat connection strength credited to plain direct matches. */
  directConn: number;
  /** How many connecting ideas to extract from the top direct passages, and how much to trust the hop. */
  bridgeTerms: number;
  bridgeDamping: number;
  /** A bridge needs this many distinct connecting ideas, or one whose strength is at least bridgeMinStrength. */
  bridgeMinHits: number;
  bridgeMinStrength: number;
  /** Added when choosing the anchor, for a document's opening paragraph. */
  leadBonus: number;
  /** Selection value = rel·(rel + conn·connection + nov·novelty) − red·redundancy − dist·hops. */
  weights: { rel: number; conn: number; nov: number; red: number; dist: number };
  /** Stop adding passages once the best remaining candidate is worth less than this. */
  minValue: number;
  lenses: Lens[];
}

export const defaultRetrieveConfig: RetrieveConfig = {
  clusterCount: 4,
  fragmentsPerCluster: 3,
  relevanceFloor: 0.2,
  cueHitsForFull: 2,
  directConn: 0.4,
  bridgeTerms: 6,
  bridgeDamping: 0.6,
  bridgeMinHits: 2,
  bridgeMinStrength: 0.5,
  leadBonus: 0.05,
  weights: { rel: 1, conn: 0.6, nov: 0.35, red: 0.8, dist: 0.25 },
  minValue: 0.2,
  lenses: defaultLenses,
};
