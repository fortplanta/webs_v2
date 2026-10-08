// Renderer-side state for one generation. Pure reducer over backend WebEvents.

import type { WebEvent } from '../backend/events';
import type { ClusterModel, WebModel } from '../types/web';

export type { ClusterModel, WebModel };

export function initialModel(query: string): WebModel {
  return { query, phase: 'running', status: 'Searching knowledge base…', error: null, kb: [], context: null, clusters: [], edges: [] };
}

export function reduce(m: WebModel, ev: WebEvent): WebModel {
  switch (ev.type) {
    case 'status':
      return { ...m, status: ev.message };
    case 'kb':
      return { ...m, kb: ev.passages };
    case 'overview':
      return {
        ...m,
        context: ev.context,
        edges: ev.edges,
        clusters: ev.clusters.map(c => ({ title: c.title, slots: Array.from({ length: c.slots }, () => null) })),
      };
    case 'fragment': {
      const clusters = m.clusters.map((c, i) =>
        i === ev.cluster ? { ...c, slots: c.slots.map((s, j) => (j === ev.slot ? ev.fragment : s)) } : c,
      );
      return { ...m, clusters };
    }
    case 'done':
      return { ...m, phase: 'done', status: '' };
    case 'error':
      return { ...m, phase: 'error', status: '', error: ev.message };
  }
}

export function progress(m: WebModel): { filled: number; total: number } {
  let filled = 0, total = 0;
  for (const c of m.clusters) for (const s of c.slots) { total++; if (s) filled++; }
  return { filled, total };
}
