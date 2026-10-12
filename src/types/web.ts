// Shape of one generation as the renderer models it (and as it is persisted).

import type { GeneratedFragment, KbPassage, OverviewEdge } from '../backend/events';

export interface ClusterModel {
  title: string;
  /** The retrieval route this collection came from, if any. */
  lens?: string;
  /** 'ai' for a collection written by the AI provider rather than found in the knowledge base. */
  origin?: 'ai';
  slots: Array<GeneratedFragment | null>;
}

export interface WebModel {
  query: string;
  phase: 'running' | 'done' | 'error' | 'cancelled';
  status: string;
  error: string | null;
  kb: KbPassage[];
  context: string | null;
  clusters: ClusterModel[];
  edges: OverviewEdge[];
  /** A non-fatal problem worth showing (e.g. the AI top-up failed). */
  warning?: string | null;
  /** Model name when any part was written by the AI provider. */
  aiModel?: string;
}
