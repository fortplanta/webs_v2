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
    case 'overview': {
      // A later overview (e.g. the model's titles after an instant retrieval skeleton) updates the
      // collections in place; it must not wipe cards that already arrived — nor collections the AI added.
      const kept = m.clusters.slice(ev.clusters.length).filter(c => c.origin === 'ai');
      return {
        ...m,
        context: ev.context || m.context,
        edges: [...ev.edges, ...m.edges.filter(e => Math.max(e.source, e.target) >= ev.clusters.length)],
        clusters: [
          ...ev.clusters.map((c, i) => {
            const prev = m.clusters[i];
            const slots = prev && prev.slots.length === c.slots ? prev.slots : Array.from({ length: c.slots }, () => null);
            return { title: c.title, lens: c.lens ?? prev?.lens, ...(c.origin ?? prev?.origin ? { origin: c.origin ?? prev?.origin } : {}), slots };
          }),
          ...kept,
        ],
      };
    }
    case 'ai-outline': {
      const clusters = m.clusters.slice(0, ev.start);
      ev.clusters.forEach((c, i) => {
        const prev = m.clusters[ev.start + i];
        clusters.push({ title: c.title, origin: 'ai', slots: prev?.slots.length === c.slots ? prev.slots : Array.from({ length: c.slots }, () => null) });
      });
      return {
        ...m,
        context: m.context || ev.context || null,
        aiModel: ev.model,
        clusters,
        edges: [...m.edges.filter(e => Math.max(e.source, e.target) < ev.start), ...ev.edges],
      };
    }
    case 'warning':
      return { ...m, warning: ev.message };
    case 'image':
      return m; // pictures go straight onto the canvas (see CanvasView), not into the saved model
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

/** Cards written so far / cards expected. Draft placeholders (KB excerpts awaiting the model) don't count as written. */
export function progress(m: WebModel): { filled: number; total: number } {
  let filled = 0, total = 0;
  for (const c of m.clusters) for (const s of c.slots) { total++; if (s && !s.draft) filled++; }
  return { filled, total };
}
