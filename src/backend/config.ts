// Structural knobs a strategy may read. Nothing here is topic-specific.

export interface WebConfig {
  clusterCount: number;
  fragmentsPerCluster: number;
}

export const defaultWebConfig: WebConfig = { clusterCount: 4, fragmentsPerCluster: 3 };
