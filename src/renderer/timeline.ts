// The Timeline view's logic: which year a card belongs to, where it sits along the axis, and where the ticks go.
// Pure functions over plain data (no DOM), so they can be tested.

import type { GeneratedFragment } from '../backend/events';

export interface TimelineCard {
  id: string;
  kind: 'fragment' | 'image';
  fragment?: GeneratedFragment;
  /** For image cards. */
  imageUrl?: string;
  caption?: string;
  /** Collection index and title, when the card belongs to one. */
  cluster?: number;
}

/** A year in the text, as a signed number (BCE negative), or null. Looks at BCE/CE forms first, then plain 4-digit years. */
export function parseYear(text: string | undefined): number | null {
  if (!text) return null;
  const bce = /(\d{1,4})\s*(?:BCE|BC|B\.C\.E?\.?)(?![A-Za-z])/i.exec(text);
  if (bce) return -Number(bce[1]);
  const ce = /(\d{1,4})\s*(?:CE|AD|A\.D\.)(?![A-Za-z])/i.exec(text);
  if (ce) return Number(ce[1]);
  const plain = /(?<![\d,.])(1[0-9]{3}|20[0-9]{2})(?![\d])/.exec(text);
  return plain ? Number(plain[1]) : null;
}

export interface Dated { year: number; /** true when found in the card's text rather than its date field */ inferred: boolean }

/** A card's year: its date field if it has one, otherwise the first year its title or text mentions. */
export function cardYear(f: GeneratedFragment): Dated | null {
  const own = parseYear(f.era) ?? parseYear(f.historicalEra);
  if (own !== null) return { year: own, inferred: false };
  const guess = parseYear(f.title) ?? parseYear(f.body);
  return guess !== null ? { year: guess, inferred: true } : null;
}

export const yearLabel = (y: number) => (y < 0 ? `${-y} BCE` : y === 0 ? '0' : String(y));

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];

/** Round tick years covering [min, max], about `target` of them. */
export function ticks(min: number, max: number, target = 6): number[] {
  const span = Math.max(max - min, 1);
  const step = STEPS.find(s => span / s <= target) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  for (let y = Math.floor(min / step) * step; y <= Math.ceil(max / step) * step; y += step) out.push(y);
  return out;
}

export interface Placed { card: TimelineCard; x: number; y: number; year: number; inferred: boolean }
export interface Lane { type: string; y: number; height: number }
export interface TimelineLayout {
  placed: Placed[];
  /** Horizontal bands, one per card kind (events, people, ideas…), like the rows of a Gantt chart. */
  lanes: Lane[];
  undated: TimelineCard[];
  ticks: Array<{ year: number; x: number }>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Width of the dated area, in px. */
  width?: number;
  padX?: number;
  cardW?: number;
  rowH?: number;
  top?: number;
}

const LANE_ORDER = ['era', 'event', 'person', 'thesis', 'concept', 'source', 'domain', 'quote'];

/** Cards by year along x; where two would overlap, the later one drops to the next free row. */
export function layoutTimeline(cards: TimelineCard[], opts: LayoutOptions = {}): TimelineLayout {
  const { width = 3 * 1280, padX = 200, cardW = 260, rowH = 210, top = 150 } = opts;
  const dated = cards.flatMap(card => {
    const d = card.kind === 'fragment' && card.fragment ? cardYear(card.fragment) : null;
    return d ? [{ card, ...d }] : [];
  });
  const undated = cards.filter(c => !dated.some(d => d.card.id === c.id));
  if (!dated.length) return { placed: [], lanes: [], undated, ticks: [], width: 1280, height: 640 };

  const years = dated.map(d => d.year);
  const lo = Math.min(...years), hi = Math.max(...years);
  const tk = ticks(lo, hi);
  const min = Math.min(lo, tk[0]), max = Math.max(hi, tk[tk.length - 1]);
  const span = Math.max(max - min, 1);
  const xOf = (y: number) => padX + ((y - min) / span) * (width - 2 * padX);

  // One lane per kind of card; inside a lane, cards that would overlap drop to the next row.
  const kindOf = (c: TimelineCard) => c.fragment?.type ?? 'concept';
  const present = LANE_ORDER.filter(k => dated.some(d => kindOf(d.card) === k));
  for (const d of dated) if (!present.includes(kindOf(d.card))) present.push(kindOf(d.card));
  const placed: Placed[] = [];
  const lanes: Lane[] = [];
  let y = top;
  for (const type of present) {
    const rowEnds: number[] = [];
    const inLane = dated.filter(d => kindOf(d.card) === type).sort((a, b) => a.year - b.year || (a.card.id < b.card.id ? -1 : 1));
    const base = y;
    for (const d of inLane) {
      const left = xOf(d.year) - cardW / 2;
      let row = rowEnds.findIndex(end => end + 24 <= left);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = left + cardW;
      placed.push({ card: d.card, x: left, y: base + row * rowH, year: d.year, inferred: d.inferred });
    }
    const height = Math.max(rowEnds.length, 1) * rowH;
    lanes.push({ type, y: base, height });
    y += height;
  }
  return { placed, lanes, undated, ticks: tk.map(year => ({ year, x: xOf(year) })), width, height: y + 120 };
}
