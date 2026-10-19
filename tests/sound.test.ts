import { describe, expect, it } from 'vitest';
import { schedule, VOICES, type AudioLike, type VoiceName } from '../src/renderer/sound';

/** A stand-in for AudioContext that records what a voice asks of it. */
function fakeCtx() {
  const calls: Array<{ node: string; args?: unknown[] }> = [];
  const param = (name: string) => ({ value: 0, setValueAtTime: (...a: unknown[]) => calls.push({ node: `${name}.set`, args: a }), exponentialRampToValueAtTime: (...a: unknown[]) => calls.push({ node: `${name}.ramp`, args: a }) });
  const connectable = (kind: string) => ({ connect: (n: unknown) => { calls.push({ node: `${kind}.connect` }); return n; } });
  const ctx: AudioLike = {
    currentTime: 0, sampleRate: 48000,
    createOscillator: () => { const n: any = { ...connectable('osc'), type: '', frequency: param('freq'), start: (t: number) => calls.push({ node: 'osc.start', args: [t] }), stop: (t: number) => calls.push({ node: 'osc.stop', args: [t] }) }; return n; },
    createGain: () => ({ ...connectable('gain'), gain: param('gain') }),
    createBiquadFilter: () => ({ ...connectable('filter'), type: '', frequency: { value: 0 }, Q: { value: 0 } }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({ ...connectable('src'), buffer: null, start: (t: number) => calls.push({ node: 'src.start', args: [t] }) }),
  };
  return { ctx, calls };
}

describe('the voices', () => {
  const names = Object.keys(VOICES) as VoiceName[];

  it('every voice is short, quiet and well-formed', () => {
    for (const name of names) {
      const v = VOICES[name];
      expect(v.parts.length).toBeGreaterThan(0);
      expect(v.minGap).toBeGreaterThan(0);
      let end = 0;
      for (const p of v.parts) {
        expect(p.gain).toBeGreaterThan(0); expect(p.gain).toBeLessThanOrEqual(0.2); // accents, never loud
        if (p.kind === 'osc') {
          expect(p.from).toBeGreaterThan(20); expect(p.from).toBeLessThan(8000);
          if (p.to !== undefined) expect(p.to).toBeGreaterThan(20);
          end = Math.max(end, (p.at ?? 0) + (p.attack ?? 0.004) + p.decay);
        } else end = Math.max(end, (p.at ?? 0) + p.dur);
      }
      expect(end).toBeLessThan(0.8);
    }
  });

  it('a tick is the brand book relay: a falling thump, a wooden overtone and a click', () => {
    const t = VOICES.tick.parts;
    expect(t[0]).toMatchObject({ kind: 'osc', wave: 'sine', from: 300, to: 110 });
    expect(t[1]).toMatchObject({ kind: 'osc', wave: 'triangle', from: 520, to: 300 });
    expect(t[2]).toMatchObject({ kind: 'noise', filter: 'bandpass', freq: 800 });
  });

  it('schedules every part with ordered, finite times and scales loudness by level', () => {
    for (const name of names) {
      const { ctx, calls } = fakeCtx();
      schedule(ctx, {}, VOICES[name], 1, 0.5);
      const starts = calls.filter(c => c.node === 'osc.start' || c.node === 'src.start').map(c => c.args![0] as number);
      expect(starts).toHaveLength(VOICES[name].parts.length);
      for (const s of starts) { expect(Number.isFinite(s)).toBe(true); expect(s).toBeGreaterThanOrEqual(1); }
      for (const c of calls.filter(c => c.node === 'gain.set' || c.node === 'gain.ramp')) for (const a of c.args!) expect(Number.isFinite(a as number)).toBe(true);
      const stops = calls.filter(c => c.node === 'osc.stop').map(c => c.args![0] as number);
      stops.forEach((s, i) => expect(s).toBeGreaterThan(starts[i] ?? 0));
    }
    const loud = fakeCtx(), soft = fakeCtx();
    schedule(loud.ctx, {}, VOICES.tock, 0, 1); schedule(soft.ctx, {}, VOICES.tock, 0, 0.25);
    const peak = (c: typeof loud) => Math.max(...c.calls.filter(x => x.node === 'gain.ramp').map(x => x.args![0] as number));
    expect(peak(soft)).toBeLessThan(peak(loud));
  });

  it('delays the second half of a two-part voice (link is tick then tock)', () => {
    const { ctx, calls } = fakeCtx();
    schedule(ctx, {}, VOICES.link, 0, 1);
    const starts = calls.filter(c => c.node === 'osc.start').map(c => c.args![0] as number);
    expect(starts[1] - starts[0]).toBeCloseTo(0.075);
  });
});
