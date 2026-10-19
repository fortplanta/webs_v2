// Figures and dates drawn as pictures, in the app's own type and colours, so a figure card or a timeline reads at a glance
// and sits on the canvas like any picture. The layouts are pure (and tested); the drawing needs a canvas.

import type { Fact, TimelineEntry } from '../backend/media';

export interface Tile { x: number; y: number; w: number; h: number; value: string; label: string }
export interface FactsLayout { width: number; height: number; tiles: Tile[] }

const PAD = 14, GAP = 10, TILE_W = 150, TILE_H = 88;

/** Tiles for 3–4 figures, two across. */
export function factsLayout(facts: readonly Fact[]): FactsLayout {
  const cols = facts.length >= 4 || facts.length === 2 ? 2 : 2;
  const rows = Math.ceil(facts.length / cols);
  const tiles = facts.map((f, i) => ({ x: PAD + (i % cols) * (TILE_W + GAP), y: PAD + Math.floor(i / cols) * (TILE_H + GAP), w: TILE_W, h: TILE_H, value: f.value, label: f.label }));
  return { width: PAD * 2 + cols * TILE_W + (cols - 1) * GAP, height: PAD * 2 + rows * TILE_H + (rows - 1) * GAP, tiles };
}

export interface Mark { x: number; year: string; label: string; up: boolean }
export interface TimelineLayout { width: number; height: number; axisY: number; marks: Mark[] }

export const yearText = (y: number) => (y < 0 ? `${-y} BCE` : String(y));

/** Dated entries spaced evenly along a line (time is not to scale: the order is the point), labels alternating above and below. */
export function timelineLayout(entries: readonly TimelineEntry[]): TimelineLayout {
  const n = entries.length, step = 118, width = PAD * 2 + Math.max(1, n - 1) * step + 120;
  const marks = entries.map((e, i) => ({ x: PAD + 60 + i * step, year: yearText(e.year), label: e.label, up: i % 2 === 0 }));
  return { width, height: 210, axisY: 105, marks };
}

/** Word-wrap `text` into at most `lines` lines of about `chars` characters, ending with an ellipsis if it does not fit. */
export function wrapText(text: string, chars: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > chars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > lines) { const kept = out.slice(0, lines); kept[lines - 1] = kept[lines - 1].replace(/[\s,.;:]+$/, '') + '…'; return kept; }
  return out;
}

// ── drawing (browser only) ────────────────────────────────────────────────────────────────────────────────

const css = (name: string, fallback: string) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const SCALE = 2;

function canvasFor(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * SCALE; c.height = h * SCALE;
  const g = c.getContext('2d')!;
  g.scale(SCALE, SCALE);
  g.textRendering = 'optimizeSpeed'; // no ligatures: this face's "nt" ligature drew "into" as "io" on a canvas
  g.fillStyle = css('--color-card-bg', '#101010');
  g.fillRect(0, 0, w, h);
  return { c, g };
}

const done = (c: HTMLCanvasElement, width: number, height: number) => new Promise<{ dataURL: string; mimeType: string; width: number; height: number }>(resolve => resolve({ dataURL: c.toDataURL('image/png'), mimeType: 'image/png', width, height }));

/** Fit `text` on one line at `size` px by shrinking, down to a floor. */
function fit(g: CanvasRenderingContext2D, text: string, width: number, size: number, font: string, floor = 14) {
  let s = size;
  for (; s > floor; s -= 1) { g.font = `${font.replace('$', String(s))}`; if (g.measureText(text).width <= width) break; }
  return s;
}

export async function drawFacts(facts: readonly Fact[]) {
  await document.fonts?.ready;
  const lay = factsLayout(facts);
  const { c, g } = canvasFor(lay.width, lay.height);
  for (const t of lay.tiles) {
    g.fillStyle = '#171717';
    g.beginPath(); g.roundRect(t.x, t.y, t.w, t.h, 6); g.fill();
    g.fillStyle = css('--color-card-title-hi', '#F2F2F2');
    fit(g, t.value, t.w - 20, 32, '500 $px "Neue Montreal", Helvetica, Arial, sans-serif');
    g.textBaseline = 'alphabetic';
    g.fillText(t.value, t.x + 10, t.y + 40);
    g.fillStyle = css('--color-card-body', '#8C8C8C');
    g.font = '400 12px "Neue Montreal", Helvetica, Arial, sans-serif';
    wrapText(t.label, 22, 2).forEach((line, i) => g.fillText(line, t.x + 10, t.y + 62 + i * 15));
  }
  return done(c, lay.width, lay.height);
}

export async function drawTimeline(entries: readonly TimelineEntry[]) {
  await document.fonts?.ready;
  const lay = timelineLayout(entries);
  const { c, g } = canvasFor(lay.width, lay.height);
  g.strokeStyle = '#3A3A3A'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(PAD, lay.axisY); g.lineTo(lay.width - PAD, lay.axisY); g.stroke();
  for (const m of lay.marks) {
    g.fillStyle = css('--color-card-title-hi', '#F2F2F2');
    g.beginPath(); g.arc(m.x, lay.axisY, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3A3A3A'; g.beginPath(); g.moveTo(m.x, lay.axisY + (m.up ? -6 : 6)); g.lineTo(m.x, lay.axisY + (m.up ? -22 : 22)); g.stroke();
    g.textAlign = 'center';
    g.font = '500 17px "Neue Montreal", Helvetica, Arial, sans-serif';
    g.fillStyle = css('--color-card-title-hi', '#F2F2F2');
    g.fillText(m.year, m.x, lay.axisY + (m.up ? -30 : 46));
    g.font = '400 11px "Neue Montreal", Helvetica, Arial, sans-serif';
    g.fillStyle = css('--color-card-body', '#8C8C8C');
    const lines = wrapText(m.label, 20, 3);
    lines.forEach((line, i) => g.fillText(line, m.x, m.up ? lay.axisY - 50 - (lines.length - 1 - i) * 14 : lay.axisY + 62 + i * 14));
  }
  return done(c, lay.width, lay.height);
}

/** A map tile with the place marked and the credit on it, darkened to sit on the canvas. */
export async function drawMap(tileDataURL: string, marker: { x: number; y: number }) {
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('tile')); img.src = tileDataURL; });
  const size = 256;
  const { c, g } = canvasFor(size, size);
  g.filter = 'invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.95) saturate(0.7)';
  g.drawImage(img, 0, 0, size, size);
  g.filter = 'none';
  const x = marker.x * size, y = marker.y * size;
  g.fillStyle = 'rgba(255,106,43,0.25)'; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#FF6A2B'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#F2F2F2'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke();
  g.font = '400 9px "Neue Montreal", Helvetica, Arial, sans-serif';
  g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText('© OpenStreetMap contributors', size - 6, size - 6);
  return done(c, size, size);
}
