// Shape of one generation as the renderer models it (and as it is persisted).

import type { GeneratedFragment, KbPassage, OverviewEdge } from '../backend/events';

export interface ClusterModel {
  title: string;
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
}
