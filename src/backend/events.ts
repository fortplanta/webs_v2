// The contract between a fetch strategy (backend) and the canvas (renderer).
// A strategy is an async generator of these events; the UI renders each one as it arrives.
// Add new event kinds here, handle them in src/renderer/webModel.ts.

import type { FragmentType } from '../types/fragments';
import type { WebsErrorCode } from './errors';

export interface KbPassage {
  source: string; // path relative to the KB dir
  text: string;
  /** Present on passages chosen by the retrieval layer. */
  id?: string;
  heading?: string;
  /** Which route found it (see retrieval/lenses.ts), and — for bridge hops — the idea it came through. */
  lens?: string;
  via?: string[];
}

export interface GeneratedFragment {
  type: FragmentType;
  title: string;
  body: string;
  tags?: string[];
  list?: string[];
  era?: string;
  historicalEra?: string;
  /** Where this came from (http/https). Shown on the card and opens externally. */
  link?: string;
  /** One sentence on how this connects to the topic, naming the connecting idea. */
  bridge?: string;
  /** KB files this card is based on. */
  kbSources?: string[];
  /** 0–1: how much of the card's wording is found in its KB passage. Low = went beyond the KB. */
  grounding?: number;
  /** The retrieval route that surfaced it. */
  lens?: string;
  /** A placeholder built straight from a KB passage, awaiting the model's card. */
  draft?: boolean;
}

export interface OverviewEdge {
  source: number; // cluster index
  target: number; // cluster index
  label: string;
}

export type WebEvent =
  | { type: 'status'; message: string }
  | { type: 'kb'; passages: KbPassage[] }
  | { type: 'overview'; context: string; clusters: Array<{ title: string; slots: number; lens?: string }>; edges: OverviewEdge[] }
  | { type: 'fragment'; cluster: number; slot: number; fragment: GeneratedFragment }
  | { type: 'done' }
  | { type: 'error'; code: WebsErrorCode; message: string };
