// The contract between a fetch strategy (backend) and the canvas (renderer).
// A strategy is an async generator of these events; the UI renders each one as it arrives.
// Add new event kinds here, handle them in src/renderer/webModel.ts.

import type { FragmentType } from '../types/fragments';
import type { WebsErrorCode } from './errors';

export interface KbPassage {
  source: string; // path relative to the KB dir
  text: string;
}

export interface GeneratedFragment {
  type: FragmentType;
  title: string;
  body: string;
  tags?: string[];
  list?: string[];
  era?: string;
  historicalEra?: string;
}

export interface OverviewEdge {
  source: number; // cluster index
  target: number; // cluster index
  label: string;
}

export type WebEvent =
  | { type: 'status'; message: string }
  | { type: 'kb'; passages: KbPassage[] }
  | { type: 'overview'; context: string; clusters: Array<{ title: string; slots: number }>; edges: OverviewEdge[] }
  | { type: 'fragment'; cluster: number; slot: number; fragment: GeneratedFragment }
  | { type: 'done' }
  | { type: 'error'; code: WebsErrorCode; message: string };
