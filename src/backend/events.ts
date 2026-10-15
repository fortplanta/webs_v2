// The contract between a fetch strategy (backend) and the canvas (renderer).
// A strategy is an async generator of these events; the UI renders each one as it arrives.
// Add new event kinds here, handle them in src/renderer/webModel.ts.

import type { FragmentType } from '../types/fragments';
import type { WebsErrorCode } from './errors';
import type { WebImage } from './library/images';

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
  /** Ids of the KB passages it is based on (file#n), so later explorations can avoid repeating them. */
  kbPassageIds?: string[];
  /** 0–1: how much of the card's wording is found in its KB passage. Low = went beyond the KB. */
  grounding?: number;
  /** The retrieval route that surfaced it. */
  lens?: string;
  /** A placeholder built straight from a KB passage, awaiting the model's card. */
  draft?: boolean;
  /** The source passage as retrieved, when `body` is the narrator's retelling of it (it passed the no-invention check). */
  original?: string;
  /** True when `body` is a retelling. Absent/false: `body` is the source text itself. */
  retold?: boolean;
  /** Why a retelling was not used, if the narrator offered one and it was refused. */
  retellingRefused?: string;
  /** The narrator judged this passage not to bear on the question; it is set aside (not drawn) rather than forced into the story. */
  dropped?: boolean;
  /** 1–3: how much this card matters to the story (its size and brightness on the canvas). */
  weight?: 1 | 2 | 3;
  /** How this card relates to others, by their passage ids: "led to", "contradicts"… Drawn as labelled arrows. */
  relates?: Array<{ to: string; verb: string }>;
  /** Where the content comes from. Absent = your own notes; 'wiki' = an offline reference library (Wikipedia…); 'ai' = your AI provider's own knowledge. */
  origin?: 'ai' | 'wiki';
  /** For origin 'wiki': the library's name, e.g. "Simple English Wikipedia". */
  sourceLabel?: string;
  /** Which model wrote it, for origin 'ai'. */
  aiModel?: string;
}

/** A link between two collections: only where one genuinely arises from the other (a tangent). Every collection already hangs off the origin. */
export interface OverviewEdge {
  source: number; // cluster index
  target: number; // cluster index
  label: string;
}

export type WebEvent =
  | { type: 'status'; message: string }
  | { type: 'kb'; passages: KbPassage[] }
  | { type: 'overview'; context: string; clusters: Array<{ title: string; slots: number; lens?: string; origin?: 'wiki'; edge?: string }>; edges: OverviewEdge[] }
  | { type: 'fragment'; cluster: number; slot: number; fragment: GeneratedFragment }
  /** Collections written by the user's AI provider, from index `start` on (0 when the KB found nothing). */
  | { type: 'ai-outline'; start: number; context: string; clusters: Array<{ title: string; slots: number; edge?: string }>; edges: OverviewEdge[]; model: string }
  /** A picture for the card at (cluster, slot), fetched in the background; the canvas places it beside the card. */
  | { type: 'image'; cluster: number; slot: number; image: WebImage }
  /** Something went wrong with an optional part (e.g. the AI top-up); the web carries on without it. */
  | { type: 'warning'; message: string }
  | { type: 'done' }
  | { type: 'error'; code: WebsErrorCode; message: string };

// ── Pivot: grow one new collection out of an existing card ───────────────────────────────────────

export interface PivotRequest {
  /** The card to explore from. */
  card: GeneratedFragment;
  /** KB passage ids already on the canvas; a pivot never repeats them. */
  usedPassageIds: string[];
}

export type PivotEvent =
  | { type: 'status'; message: string }
  /** The new collection, straight from the KB (instant): route, default edge label, one draft card per passage. */
  | { type: 'plan'; title: string; lens: string; edge: string; cards: GeneratedFragment[] }
  /** The model's title and edge label. */
  | { type: 'title'; title: string; edge?: string }
  /** The model's card for slot `slot`, replacing the draft. */
  | { type: 'card'; slot: number; fragment: GeneratedFragment }
  | { type: 'done' }
  | { type: 'error'; code: WebsErrorCode; message: string };

// ── Lenses: another way of looking at one card ───────────────────────────────────────────────────

export type LensId = 'explain-simple' | 'vivid' | 'fact-check' | 'steelman' | 'challenge';

/** What the UI lists (the prompts themselves live in lenses.ts). */
export const LENS_CHOICES: Array<{ id: LensId; label: string; description: string; kind: 'rewrite' | 'argument' }> = [
  { id: 'explain-simple', label: 'Explain simply', description: 'The same thing, for someone new to it', kind: 'rewrite' },
  { id: 'vivid', label: 'Make it vivid', description: 'The same thing, as a scene you can picture', kind: 'rewrite' },
  { id: 'fact-check', label: 'Fact check', description: 'Where the claims are solid and where they are shaky', kind: 'argument' },
  { id: 'steelman', label: 'Steelman', description: 'The strongest case for this idea', kind: 'argument' },
  { id: 'challenge', label: 'Challenge', description: 'What could be wrong with this', kind: 'argument' },
];

export interface LensRequest { card: GeneratedFragment; lens: LensId }

export type LensResult =
  | { ok: true; fragment: GeneratedFragment; label: string }
  | { ok: false; message: string };

// ── Connections: a link between two cards, judged ────────────────────────────────────────────────

export interface ConnectRequest {
  a: GeneratedFragment;
  b: GeneratedFragment;
  /** The user's own account of how they connect. Empty: the model is asked whether it can see a link. */
  explanation?: string;
}

/** How well a link holds: 'solid' holds up, 'stretch' is a reach, 'none' the model sees no real link. Tier: well-known ('obvious') or 'lateral'. */
export interface ConnectionVerdict {
  link: 'solid' | 'stretch' | 'none';
  tier: 'obvious' | 'lateral';
  /** A short verb phrase for the arrow ("led to", "is the opposite of"). */
  verb: string;
  /** One or two sentences on why it holds or doesn't. The model's opinion, shown as such. */
  note: string;
}

export type ConnectResult = { ok: true; verdict: ConnectionVerdict } | { ok: false; message: string };
