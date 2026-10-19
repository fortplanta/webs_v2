// Sound, synthesised with Web Audio: no audio files and no dependency, in the family of the brand book's relay "tick"
// (a dry mechanical click: a low sine thump, a woody overtone and a short band-passed noise tick). Everything is short,
// quiet and dry. It is opt-out: on by default with a switch in Settings and in ⌘K, a volume, never while the window is
// hidden, and hover ticks only for a real pointer. Browsers keep audio silent until the first click or key press, so
// the context is unlocked then.

export type VoiceName = 'tick' | 'tock' | 'arrive' | 'link' | 'branch' | 'cut' | 'done' | 'error';

type Part =
  | { kind: 'osc'; wave: OscillatorType; from: number; to?: number; glide?: number; gain: number; attack?: number; decay: number; at?: number }
  | { kind: 'noise'; filter: BiquadFilterType; freq: number; q?: number; dur: number; gain: number; at?: number };

export interface Voice { parts: Part[]; /** Shortest gap between two plays, in seconds: a burst of events must not become a buzz. */ minGap: number }

export const VOICES: Record<VoiceName, Voice> = {
  // the brand book's relay tick
  tick: { minGap: 0.045, parts: [
    { kind: 'osc', wave: 'sine', from: 300, to: 110, glide: 0.05, gain: 0.13, attack: 0.004, decay: 0.09 },
    { kind: 'osc', wave: 'triangle', from: 520, to: 300, glide: 0.03, gain: 0.04, attack: 0.003, decay: 0.05 },
    { kind: 'noise', filter: 'bandpass', freq: 800, q: 0.8, dur: 0.012, gain: 0.035 },
  ] },
  // a press: lower and a little heavier
  tock: { minGap: 0.04, parts: [
    { kind: 'osc', wave: 'sine', from: 220, to: 80, glide: 0.06, gain: 0.16, attack: 0.004, decay: 0.11 },
    { kind: 'osc', wave: 'triangle', from: 400, to: 220, glide: 0.04, gain: 0.05, attack: 0.003, decay: 0.06 },
    { kind: 'noise', filter: 'bandpass', freq: 600, q: 0.8, dur: 0.014, gain: 0.04 },
  ] },
  // something new has landed on the canvas: a soft rising blip with a faint shimmer
  arrive: { minGap: 0.12, parts: [
    { kind: 'osc', wave: 'sine', from: 420, to: 640, glide: 0.07, gain: 0.05, attack: 0.006, decay: 0.17 },
    { kind: 'osc', wave: 'sine', from: 840, to: 1260, glide: 0.07, gain: 0.018, attack: 0.006, decay: 0.12 },
    { kind: 'noise', filter: 'bandpass', freq: 2000, q: 1.2, dur: 0.01, gain: 0.01 },
  ] },
  // two things joined: tick, then tock
  link: { minGap: 0.1, parts: [
    { kind: 'osc', wave: 'sine', from: 300, to: 110, glide: 0.05, gain: 0.11, attack: 0.004, decay: 0.08 },
    { kind: 'noise', filter: 'bandpass', freq: 800, q: 0.8, dur: 0.012, gain: 0.03 },
    { kind: 'osc', wave: 'sine', from: 240, to: 85, glide: 0.06, gain: 0.13, attack: 0.004, decay: 0.1, at: 0.075 },
    { kind: 'noise', filter: 'bandpass', freq: 650, q: 0.8, dur: 0.012, gain: 0.03, at: 0.075 },
  ] },
  // a new branch: a short upward pop
  branch: { minGap: 0.1, parts: [
    { kind: 'osc', wave: 'sine', from: 200, to: 520, glide: 0.08, gain: 0.09, attack: 0.005, decay: 0.14 },
    { kind: 'noise', filter: 'bandpass', freq: 1400, q: 1, dur: 0.01, gain: 0.015 },
  ] },
  // a snip: a bright noise burst and a quickly falling blip
  cut: { minGap: 0.1, parts: [
    { kind: 'noise', filter: 'highpass', freq: 3500, dur: 0.05, gain: 0.07 },
    { kind: 'osc', wave: 'sine', from: 2600, to: 1700, glide: 0.04, gain: 0.03, attack: 0.002, decay: 0.06 },
  ] },
  // finished: two soft notes, rising (the one place with a little delight)
  done: { minGap: 0.5, parts: [
    { kind: 'osc', wave: 'sine', from: 392, gain: 0.06, attack: 0.01, decay: 0.5 },
    { kind: 'osc', wave: 'sine', from: 587.33, gain: 0.055, attack: 0.01, decay: 0.65, at: 0.11 },
  ] },
  // something went wrong: two low dull thumps
  error: { minGap: 0.4, parts: [
    { kind: 'osc', wave: 'sine', from: 140, to: 90, glide: 0.08, gain: 0.14, attack: 0.004, decay: 0.16 },
    { kind: 'osc', wave: 'sine', from: 120, to: 78, glide: 0.08, gain: 0.14, attack: 0.004, decay: 0.2, at: 0.13 },
  ] },
};

/** The audio calls a voice needs, so the sounds can be built and checked without a browser. */
export interface AudioLike {
  currentTime: number;
  sampleRate: number;
  createOscillator(): any;
  createGain(): any;
  createBiquadFilter(): any;
  createBuffer(channels: number, length: number, rate: number): any;
  createBufferSource(): any;
}

/** Schedule `voice` to start at `t` into `dest`, at `level` (0–1 of its own loudness). */
export function schedule(ctx: AudioLike, dest: unknown, voice: Voice, t: number, level = 1): void {
  for (const p of voice.parts) {
    const start = t + (p.at ?? 0);
    if (p.kind === 'osc') {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = p.wave;
      osc.frequency.setValueAtTime(p.from, start);
      if (p.to !== undefined) osc.frequency.exponentialRampToValueAtTime(p.to, start + (p.glide ?? 0.05));
      const peak = Math.max(0.0001, p.gain * level);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + (p.attack ?? 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, start + (p.attack ?? 0.004) + p.decay);
      osc.connect(g); g.connect(dest);
      osc.start(start); osc.stop(start + (p.attack ?? 0.004) + p.decay + 0.02);
    } else {
      const len = Math.max(1, Math.floor(ctx.sampleRate * p.dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); // a click that dies away at once
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = p.filter; f.frequency.value = p.freq; if (p.q !== undefined) f.Q.value = p.q;
      const g = ctx.createGain();
      g.gain.value = p.gain * level;
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(start);
    }
  }
}

const KEY_ON = 'webs-sound', KEY_VOL = 'webs-volume';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: the setting just does not persist */ } };

type Listener = () => void;

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private last = new Map<VoiceName, number>();
  private listeners = new Set<Listener>();
  enabled = read(KEY_ON) !== 'off';
  /** 0–1. A light touch by default: these are accents, not notifications. */
  volume = (() => { const v = Number(read(KEY_VOL)); return Number.isFinite(v) && read(KEY_VOL) !== null ? Math.min(1, Math.max(0, v)) : 0.7; })();

  /** Browsers keep audio silent until the first gesture: call this from one. Safe to call repeatedly. */
  unlock = () => {
    const AC = typeof window !== 'undefined' ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC();
        // a compressor so a burst of sounds can never clip
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12;
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(comp); comp.connect(this.ctx.destination);
      } catch { this.ctx = null; return; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  };

  /** Play a voice, unless sound is off, the window is hidden, audio is not unlocked yet, or the same voice just played. `level` scales it (0–1). */
  play(name: VoiceName, level = 1): void {
    if (!this.enabled || !this.ctx || !this.master || (typeof document !== 'undefined' && document.hidden)) return;
    const voice = VOICES[name], t = this.ctx.currentTime;
    const prev = this.last.get(name) ?? -Infinity;
    if (t - prev < voice.minGap) return;
    this.last.set(name, t);
    schedule(this.ctx as unknown as AudioLike, this.master, voice, t + 0.001, level);
  }

  setEnabled(on: boolean) {
    this.enabled = on; write(KEY_ON, on ? 'on' : 'off');
    this.unlock();
    this.emit();
    if (on) this.play('tick');
  }
  toggle() { this.setEnabled(!this.enabled); }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v)); write(KEY_VOL, String(this.volume));
    if (this.master) this.master.gain.value = this.volume;
    this.emit();
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const l of this.listeners) l(); }
}

export const sound = new Sound();

// ── the same sounds for ordinary interface use ────────────────────────────────────────────────────────────

/** What ticks when a real pointer moves onto it (menus and lists, where it is a small acknowledgement, never on every control). */
export const HOVER_SELECTOR = '.popmenu-item, .palette-item, .menu-item, .selbar-btn, .library .open, .cat-item';
/** What gives a soft tock when pressed. */
export const PRESS_SELECTOR = 'button:not(:disabled), [role="menuitem"]:not([disabled]), .palette-item';

/** Wire sound into the page once: unlock on the first gesture, tick on hover over menus, tock on press. Returns a cleanup. */
export function attachInterfaceSounds(root: Document = document): () => void {
  const fine = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const unlock = () => sound.unlock();
  let over: Element | null = null;
  const onOver = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.(HOVER_SELECTOR) ?? null;
    if (el && el !== over && fine) sound.play('tick', 0.55);
    over = el;
  };
  const onDown = (e: PointerEvent) => {
    unlock();
    if (e.button === 0 && (e.target as Element | null)?.closest?.(PRESS_SELECTOR)) sound.play('tock', 0.6);
  };
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('keydown', unlock, true);
  root.addEventListener('mouseover', onOver);
  return () => { root.removeEventListener('pointerdown', onDown, true); root.removeEventListener('keydown', unlock, true); root.removeEventListener('mouseover', onOver); };
}
