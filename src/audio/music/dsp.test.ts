import { describe, expect, it } from 'vitest';
import { BUF_RATE, ROLL_END, renderDoum, renderHarp, renderLute, renderRoll, renderSub, renderTak, renderTimpani } from './dsp';
import { midiHz } from './theory';

/** Normalized autocorrelation at `lag` over [from, from + len). */
function ac(x: Float32Array, lag: number, from: number, len: number): number {
  let s = 0;
  let e1 = 0;
  let e2 = 0;
  for (let i = from; i < from + len; i++) {
    s += x[i]! * x[i + lag]!;
    e1 += x[i]! * x[i]!;
    e2 += x[i + lag]! * x[i + lag]!;
  }
  return s / Math.sqrt(e1 * e2 + 1e-20);
}

/** Pitch from the autocorrelation peak ten periods out (parabolic refinement): sub-cent resolution. */
function pitchOf(x: Float32Array, f0: number, from: number): number {
  const periods = 10;
  const T = (BUF_RATE / f0) * periods;
  const len = Math.min(4000, x.length - from - Math.ceil(T * 1.05) - 2);
  let best = -Infinity;
  let lag = 0;
  for (let l = Math.floor(T * 0.97); l <= Math.ceil(T * 1.03); l++) {
    const v = ac(x, l, from, len);
    if (v > best) {
      best = v;
      lag = l;
    }
  }
  const a = ac(x, lag - 1, from, len);
  const b = ac(x, lag, from, len);
  const c = ac(x, lag + 1, from, len);
  const shift = (0.5 * (a - c)) / (a - 2 * b + c);
  return (BUF_RATE * periods) / (lag + shift);
}

const cents = (f: number, ref: number): number => 1200 * Math.log2(f / ref);

function rms(x: Float32Array, t0: number, t1: number): number {
  const a = Math.floor(t0 * BUF_RATE);
  const b = Math.min(x.length, Math.floor(t1 * BUF_RATE));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
}

function sane(x: Float32Array): void {
  let peak = 0;
  for (const v of x) {
    expect(Number.isFinite(v)).toBe(true);
    peak = Math.max(peak, Math.abs(v));
  }
  expect(peak).toBeGreaterThan(0.5);
  expect(peak).toBeLessThanOrEqual(0.9001);
}

describe('Karplus-Strong strings', () => {
  it('tunes the harp to within 2 cents from D2 to D7', () => {
    for (const m of [38, 50, 62, 74, 86, 93, 98]) {
      const f = midiHz(m);
      const x = renderHarp(f, 7);
      sane(x);
      expect(Math.abs(cents(pitchOf(x, f, 2000), f)), `harp midi ${m}`).toBeLessThan(2);
    }
  }, 30000);

  it('tunes the lute (doubled courses) to within 3 cents', () => {
    for (const m of [43, 50, 57, 64, 73]) {
      const f = midiHz(m);
      const x = renderLute(f, 3);
      sane(x);
      expect(Math.abs(cents(pitchOf(x, f, 2000), f)), `lute midi ${m}`).toBeLessThan(3);
    }
  }, 30000);

  it('rings and decays like a string at every pitch (even the top of the harp)', () => {
    for (const m of [43, 62, 81, 98]) {
      const x = renderHarp(midiHz(m), 1);
      const early = rms(x, 0.02, 0.07);
      const mid = rms(x, 0.3, 0.35);
      const late = rms(x, x.length / BUF_RATE - 0.12, x.length / BUF_RATE - 0.06);
      expect(mid, `harp ${m} still ringing at 0.3 s`).toBeGreaterThan(early * 0.05);
      expect(mid).toBeLessThan(early);
      expect(late, `harp ${m} decayed by its end`).toBeLessThan(early * 0.03);
    }
  });

  it('has no DC offset', () => {
    const x = renderLute(midiHz(50), 2);
    let s = 0;
    for (const v of x) s += v;
    expect(Math.abs(s / x.length)).toBeLessThan(0.002);
  });
});

describe('drums', () => {
  it('renders sane percussion buffers', () => {
    for (const x of [renderDoum(), renderTak(), renderTimpani()]) {
      sane(x);
      expect(rms(x, x.length / BUF_RATE - 0.05, x.length / BUF_RATE)).toBeLessThan(rms(x, 0, 0.05) * 0.1);
    }
  });

  it('renders the flash sub as a tonal swell behind the SFX transient (no hit of its own)', () => {
    const x = renderSub();
    sane(x);
    // Soft attack: the first 10 ms are far below the body at 0.1-0.3 s; then it decays away.
    expect(rms(x, 0, 0.01)).toBeLessThan(rms(x, 0.1, 0.3) * 0.45);
    expect(rms(x, x.length / BUF_RATE - 0.1, x.length / BUF_RATE)).toBeLessThan(rms(x, 0.1, 0.3) * 0.1);
    // Tonal: a steady D1, one period ~ 1/36.7 s (zero crossings of the body agree within 2%).
    const a = Math.floor(0.4 * BUF_RATE);
    let cross = 0;
    for (let i = a; i < a + BUF_RATE / 2; i++) if (x[i - 1]! < 0 && x[i]! >= 0) cross++;
    expect(Math.abs(cross / 0.5 - 36.71) / 36.71).toBeLessThan(0.04);
  });

  it('builds the roll as a crescendo peaking at ROLL_END', () => {
    const r = renderRoll(renderTimpani());
    sane(r);
    const soft = rms(r, 0.2, 0.5);
    const loud = rms(r, ROLL_END - 0.3, ROLL_END);
    expect(loud).toBeGreaterThan(soft * 4);
    expect(r.length / BUF_RATE).toBeGreaterThan(ROLL_END + 0.5);
  });

  // ~30 ms on a laptop; the bound only catches something pathological (CI machines are slow and shared).
  it('renders the whole bank quickly (it is spread over scheduler ticks anyway)', () => {
    const t0 = performance.now();
    for (const m of [43, 48, 53, 58, 63, 68, 73]) renderLute(midiHz(m), m);
    for (const m of [43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93, 98]) renderHarp(midiHz(m), m);
    renderRoll(renderTimpani());
    renderDoum();
    renderTak();
    renderSub();
    expect(performance.now() - t0).toBeLessThan(3000);
  }, 30000);
});
