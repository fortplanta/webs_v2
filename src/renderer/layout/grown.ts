// Where things go when a web is first drawn, made to look grown rather than stamped: the notes and collections sit on
// rings, but each is nudged off the ring by a steady amount of its own, bigger collections claim more of the circle and sit
// further out, and collections that are related (a tangent, or cards that refer to each other) are drawn toward one another
// by a small deterministic force simulation. Pure functions of the web's shape, so a rebuilt model lands in the same places.
// Positions are element centres, like organic.ts, whose rings and fans this builds on.

import { fanCenters, kbRing, type Pt } from './organic';
import { noise } from './noise';
import { FRAG_H } from '../boxes';

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const TOP = -90;

/** The notes a web was built from, in a ring around the topic, each a little off its place. */
export function grownKbRing(n: number): Pt[] {
  const base = kbRing(n);
  const step = 360 / Math.max(n, 1);
  return base.map((p, i) => {
    const a = Math.atan2(p.y, p.x) + rad(step * 0.22 * noise(`kb${i}`, 'a'));
    const r = Math.hypot(p.x, p.y) * (1 + 0.1 * noise(`kb${i}`, 'r'));
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

export interface HeaderSpec {
  /** How many cards it holds (bigger collections get more of the circle). */
  size: number;
}

/** Pairs of collections that belong near each other, and how strongly (1 = a tangent; more for many cross-references). */
export interface Tie { a: number; b: number; weight: number }

export interface GrownHeader extends Pt { /** Degrees: the way its cards fan out. */ angle: number }

/** Spring and repulsion strengths for the relaxation, and how long it runs. */
const ITER = 90;

/**
 * Header centres for the collections, with the direction each fans toward. Start: angular room in proportion to size
 * (with a steady wobble), radius jittered and pushed out by size. Then relax: headers push each other apart, are held
 * to their ring so the web stays centred on its topic, and ties pull related ones together.
 */
export function grownHeaders(specs: readonly HeaderSpec[], ties: readonly Tie[] = []): GrownHeader[] {
  const n = specs.length;
  if (n === 0) return [];
  const avg = specs.reduce((s, c) => s + Math.max(c.size, 1), 0) / n;
  const share = specs.map(c => 0.65 + 0.35 * (Math.max(c.size, 1) / avg));
  const total = share.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, n - 4);
  const rx0 = 860 + 90 * extra, ry0 = 620 + 65 * extra;

  let acc = 0;
  const pos: Pt[] = [];
  specs.forEach((c, i) => {
    const mid = acc + share[i] / 2; acc += share[i];
    const a = rad(TOP + (360 * mid) / total + (360 / n) * 0.16 * noise(`c${i}`, 'a'));
    const grow = 1 + 0.07 * Math.max(0, c.size - 3) + 0.13 * noise(`c${i}`, 'r');
    pos.push({ x: Math.cos(a) * rx0 * grow, y: Math.sin(a) * ry0 * grow });
  });
  const home = pos.map(p => ({ ...p }));

  const sep = 1250 + 30 * extra; // collections closer than this push apart
  const vel = pos.map(() => ({ x: 0, y: 0 }));
  for (let it = 0; it < ITER; it++) {
    const f = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y, d = Math.hypot(dx, dy) || 1;
      if (d >= sep) continue;
      const push = ((sep - d) / sep) * 0.35, ux = dx / d, uy = dy / d;
      f[i].x -= ux * push * sep * 0.2; f[i].y -= uy * push * sep * 0.2; f[j].x += ux * push * sep * 0.2; f[j].y += uy * push * sep * 0.2;
    }
    for (const t of ties) {
      if (!pos[t.a] || !pos[t.b] || t.a === t.b) continue;
      const dx = pos[t.b].x - pos[t.a].x, dy = pos[t.b].y - pos[t.a].y, d = Math.hypot(dx, dy) || 1;
      const rest = sep * 0.85, pull = (d - rest) * 0.05 * Math.min(2, t.weight), ux = dx / d, uy = dy / d;
      if (d <= rest) continue;
      f[t.a].x += ux * pull; f[t.a].y += uy * pull; f[t.b].x -= ux * pull; f[t.b].y -= uy * pull;
    }
    for (let i = 0; i < n; i++) {
      // held near where its ring would put it: the web stays centred on its topic
      f[i].x += (home[i].x - pos[i].x) * 0.06; f[i].y += (home[i].y - pos[i].y) * 0.06;
      vel[i].x = (vel[i].x + f[i].x) * 0.6; vel[i].y = (vel[i].y + f[i].y) * 0.6;
      pos[i].x += vel[i].x; pos[i].y += vel[i].y;
    }
  }

  // fan away from the topic (or, for a tangent's far end, away from the collection it grew out of), with a little swing
  const parentOf = new Map<number, number>();
  for (const t of ties) if (t.weight >= 1 && t.b > t.a && !parentOf.has(t.b)) parentOf.set(t.b, t.a);
  return pos.map((p, i) => {
    const from = parentOf.has(i) ? pos[parentOf.get(i)!] : { x: 0, y: 0 };
    const out = deg(Math.atan2(p.y - from.y, p.x - from.x));
    return { x: Math.round(p.x), y: Math.round(p.y), angle: out + 14 * noise(`c${i}`, 'f') };
  });
}

/** Like `fanCenters`, with each card off its exact slot by a steady amount: not quite the same angle or reach as its neighbour. */
export function grownFan(k: number, from: Pt, angle: number, cardH: number = FRAG_H, key = ''): Pt[] {
  const flat = fanCenters(k, from, angle, cardH);
  return flat.map((p, j) => {
    if (j === 0) { // the lead card barely moves: it must still read as the one pointing straight out
      const a = Math.atan2(p.y - from.y, p.x - from.x) + rad(4 * noise(`${key}:${j}`, 'a')), r = Math.hypot(p.x - from.x, p.y - from.y) * (1 + 0.04 * noise(`${key}:${j}`, 'r'));
      return { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
    }
    const a = Math.atan2(p.y - from.y, p.x - from.x) + rad(9 * noise(`${key}:${j}`, 'a')), r = Math.hypot(p.x - from.x, p.y - from.y) * (1 + 0.09 * noise(`${key}:${j}`, 'r'));
    return { x: from.x + Math.cos(a) * r, y: from.y + Math.sin(a) * r };
  });
}
