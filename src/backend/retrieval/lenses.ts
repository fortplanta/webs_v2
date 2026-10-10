// Retrieval routes ("lenses"): the different ways a passage can relate to a query. Each lens is a
// relationship type, not a topic — its cues are the words that tend to signal that relationship in text.
//
// Edit freely: add a lens, change cue words, reorder. A route with no supporting passages simply
// doesn't appear. `verb` is the default edge label from the anchor to a collection found by that route.

export interface Lens {
  id: string;
  label: string;
  verb: string;
  cues: string[];
}

export const DIRECT_LENS: Lens = { id: 'direct', label: 'The thing itself', verb: 'centers on', cues: [] };

/** Passages found by following an idea mentioned in the direct results to somewhere else. */
export const BRIDGE_LENS: Lens = { id: 'bridge', label: 'Connected ideas', verb: 'connects to', cues: [] };

export const defaultLenses: Lens[] = [
  DIRECT_LENS,
  { id: 'lineage', label: 'Origins and lineage', verb: 'traces back to',
    cues: ['invented', 'patented', 'origin', 'earlier', 'predecessor', 'precursor', 'inspired', 'developed', 'evolved', 'successor', 'improved', 'founded', 'originally', 'pioneered'] },
  { id: 'use', label: 'How it was used', verb: 'put to use in',
    cues: ['used', 'application', 'employed', 'adopted', 'purpose', 'enabled', 'applied', 'allowed', 'helped', 'method', 'practice'] },
  { id: 'consequence', label: 'What followed from it', verb: 'led to',
    cues: ['led', 'resulted', 'caused', 'impact', 'effect', 'consequence', 'changed', 'ended', 'transformed', 'result', 'lasting', 'ushered'] },
  { id: 'analogy', label: 'Echoes elsewhere', verb: 'echoed by',
    cues: ['similar', 'comparable', 'analogous', 'parallel', 'resembles', 'likewise', 'equivalent', 'counterpart', 'compared'] },
  { id: 'representation', label: 'How it is represented', verb: 'symbolized as',
    cues: ['symbol', 'symbolizes', 'art', 'depicted', 'portrayed', 'metaphor', 'represents', 'logo', 'emblem', 'literature', 'nickname', 'imagery', 'stands'] },
  { id: 'tension', label: 'Where it is contested', verb: 'contested by',
    cues: ['however', 'critics', 'opposed', 'conflict', 'controversy', 'dispute', 'versus', 'against', 'resisted', 'argue', 'debate', 'criticized'] },
];
