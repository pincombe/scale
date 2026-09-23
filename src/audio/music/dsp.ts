// Offline DSP (pure, no WebAudio, unit-tested): the music's plucked strings and drums are rendered
// once into sample buffers, then played as one-shot buffer sources (2 nodes per note, no feedback
// loops, so no AudioWorklet is needed and it runs the same in Chrome, Safari and Firefox).
//   Strings: extended Karplus-Strong (noise burst with a pluck-position comb, a damping loop
//            filter, an allpass for exact fractional tuning; the lute's courses are doubled, the
//            bass courses in octaves).
//   Drums:   sums of decaying membrane modes with a tension pitch-drop and a mallet/hand noise.

/** Sample rate of the rendered buffers (every browser accepts 22.05 kHz; content stays below ~10 kHz). */
export const BUF_RATE = 22050;

/** xorshift32 noise in [-1, 1). */
function noise(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

export interface PluckSpec {
  /** Seconds for the fundamental to fall 60 dB. */
  t60: number;
  /** 0..1 excitation brightness (how hard and near the bridge it is plucked). */
  bright: number;
  /** Pluck position as a fraction of the string (comb notch). */
  pos: number;
  /** Loop filter weight on the previous sample (0.5 = classic average; lower = brighter sustain). */
  damp: number;
}

/**
 * Add one Karplus-Strong string into `out`, starting at sample `delay`. The loop is tuned exactly
 * at the fundamental (the damping filter's and the allpass's phase delays are solved at w, not
 * approximated at DC), and for high strings the damping filter is relaxed so that it never takes
 * more than 60% of the decay: plain KS detunes and dies within milliseconds above ~C6.
 */
function ksString(out: Float32Array, rate: number, freq: number, p: PluckSpec, amp: number, seed: number, delay: number): void {
  const n = rate / freq;
  const w = (2 * Math.PI) / n;
  const oneMinusCos = 1 - Math.cos(w);
  const mag = (x: number): number => Math.sqrt(1 - 2 * x * (1 - x) * oneMinusCos);
  const goal = Math.pow(10, -3 / (p.t60 * freq)); // loop gain per period
  const filterGoal = Math.pow(goal, 0.6);
  let s = p.damp;
  if (mag(s) < filterGoal) {
    const q = (1 - filterGoal * filterGoal) / (2 * oneMinusCos);
    s = q >= 0.25 ? 0.5 : (1 - Math.sqrt(1 - 4 * q)) / 2;
  }
  const rho = Math.min(0.99999, goal / mag(s));
  const pdAvg = Math.atan2(s * Math.sin(w), 1 - s + s * Math.cos(w)) / w;
  let len = Math.floor(n - pdAvg - 0.1);
  if (len < 2) len = 2;
  const dly = n - pdAvg - len; // the allpass's share of the delay, in [0.1, 1.1)
  const beta = (w * (1 - dly)) / 2;
  const c = Math.sin(beta) / Math.sin(w - beta);
  const line = new Float32Array(len);
  const rnd = noise(seed);
  const k = 0.08 + 0.85 * p.bright;
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < len; i++) {
    lp += (rnd() - lp) * k;
    line[i] = lp;
    mean += lp;
  }
  mean /= len;
  const tmp = new Float32Array(len);
  for (let i = 0; i < len; i++) tmp[i] = line[i]! - mean;
  const off = Math.max(1, Math.round(p.pos * len));
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const v = tmp[i]! - tmp[(i - off + len) % len]!;
    line[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const norm = amp / (peak || 1);
  for (let i = 0; i < len; i++) line[i]! *= norm;
  let idx = 0;
  let prev = 0;
  let apx = 0;
  let apy = 0;
  for (let i = delay; i < out.length; i++) {
    const x = line[idx]!;
    const avg = (1 - s) * x + s * prev;
    prev = x;
    const ap = c * avg + apx - c * apy;
    apx = avg;
    apy = ap;
    line[idx] = ap * rho;
    if (++idx >= len) idx = 0;
    out[i]! += x;
  }
}

/** DC-block, fade the last 20 ms, normalize the peak to `peak`. */
function finish(out: Float32Array, rate: number, peak: number): Float32Array {
  let x1 = 0;
  let y1 = 0;
  let pk = 0;
  for (let i = 0; i < out.length; i++) {
    const x = out[i]!;
    const y = x - x1 + 0.995 * y1;
    x1 = x;
    y1 = y;
    out[i] = y;
    if (Math.abs(y) > pk) pk = Math.abs(y);
  }
  const fade = Math.min(out.length, Math.floor(rate * 0.02));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade;
  const k = pk > 0 ? peak / pk : 1;
  for (let i = 0; i < out.length; i++) out[i]! *= k;
  return out;
}

/** t60 for a string at `freq`: higher strings die faster. */
function t60At(ref: number, freq: number): number {
  return ref * Math.pow(freq / 147, -0.42);
}

/**
 * Lute: two strings per course (unison, 3 cents apart, a hair late), the bass courses strung in
 * octaves like a real lute; bright, near-bridge pluck; ~1.6 s ring at D3.
 */
export function renderLute(freq: number, seed: number, rate = BUF_RATE): Float32Array {
  const t60 = t60At(1.6, freq);
  const out = new Float32Array(Math.ceil(rate * Math.min(2.6, t60 + 0.15)));
  const p: PluckSpec = { t60, bright: 0.3, pos: 0.22, damp: 0.5 };
  ksString(out, rate, freq, p, 1, seed, 0);
  const octave = freq < 180;
  const f2 = octave ? freq * 2 : freq * Math.pow(2, 3 / 1200);
  ksString(out, rate, f2, { ...p, t60: t60At(1.6, f2), bright: 0.28 }, octave ? 0.45 : 0.75, seed * 7 + 1, Math.floor(rate * 0.0022));
  return finish(out, rate, 0.9);
}

/** Harp: one softly plucked string near a third of its length; long ring (~3.4 s at D3). */
export function renderHarp(freq: number, seed: number, rate = BUF_RATE): Float32Array {
  const t60 = t60At(3.4, freq);
  const out = new Float32Array(Math.ceil(rate * Math.min(4, t60 + 0.1)));
  ksString(out, rate, freq, { t60, bright: 0.3, pos: 0.29, damp: 0.42 }, 1, seed, 0);
  return finish(out, rate, 0.9);
}

interface Mode {
  ratio: number;
  amp: number;
  t60: number;
}

/**
 * Damped modes with a pitch drop at the attack (skin tension relaxing): f(t) = f (1 + glide e^(-t/tau)).
 * Rotating phasors, the frequency refreshed every 32 samples during the glide.
 */
function modes(out: Float32Array, rate: number, f0: number, ms: readonly Mode[], glide: number, tau: number, amp: number): void {
  for (const m of ms) {
    const decay = Math.exp(-6.908 / (m.t60 * rate));
    let a = m.amp * amp;
    let re = 1;
    let im = 0;
    let cr = 1;
    let ci = 0;
    const stop = Math.min(out.length, Math.ceil(m.t60 * 1.3 * rate));
    for (let i = 0; i < stop; i++) {
      if ((i & 31) === 0) {
        const f = f0 * m.ratio * (1 + glide * Math.exp(-i / rate / tau));
        const w = (2 * Math.PI * f) / rate;
        cr = Math.cos(w);
        ci = Math.sin(w);
        // Renormalize the phasor (rounding drift).
        const mag = Math.hypot(re, im) || 1;
        re /= mag;
        im /= mag;
      }
      const nr = re * cr - im * ci;
      im = re * ci + im * cr;
      re = nr;
      out[i]! += im * a;
      a *= decay;
    }
  }
}

/** A noise burst through a one-pole low-pass (k small = darker), exponential decay tau (s). */
function burst(out: Float32Array, rate: number, amp: number, k: number, tau: number, seed: number, hp = 0): void {
  const rnd = noise(seed);
  const n = Math.min(out.length, Math.ceil(tau * 7 * rate));
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    lp += (rnd() - lp) * k;
    lp2 += (lp - lp2) * hp;
    out[i]! += (lp - lp2) * amp * Math.exp(-i / rate / tau);
  }
}

/** Soft saturation: adds the harmonics that let a sub be heard on laptop speakers. */
function saturate(out: Float32Array, drive: number): void {
  const norm = Math.tanh(drive);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]! * drive) / norm;
}

const TIMP_MODES: Mode[] = [
  { ratio: 1, amp: 1, t60: 3 },
  { ratio: 1.504, amp: 0.5, t60: 1.6 },
  { ratio: 1.742, amp: 0.22, t60: 1.1 },
  { ratio: 2, amp: 0.3, t60: 1.2 },
  { ratio: 2.245, amp: 0.12, t60: 0.8 },
  { ratio: 2.494, amp: 0.1, t60: 0.7 },
  { ratio: 0.62, amp: 0.45, t60: 0.2 },
];

/** Timpani at D2 (pitch other notes with playbackRate): ~3 s ring. */
export function renderTimpani(rate = BUF_RATE, freq = 73.42): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 3.2));
  modes(out, rate, freq, TIMP_MODES, 0.025, 0.09, 1);
  burst(out, rate, 0.35, 0.22, 0.012, 0x51a7);
  saturate(out, 1.3);
  return finish(out, rate, 0.9);
}

/** Where the crescendo of `renderRoll` ends (s into the buffer). */
export const ROLL_END = 3;

/** A 3 s timpani roll crescendo (single strokes summed at ~15/s), then its natural tail. */
export function renderRoll(stroke: Float32Array, rate = BUF_RATE): Float32Array {
  const out = new Float32Array(Math.ceil(rate * (ROLL_END + 1.2)));
  const rnd = noise(0x2011);
  const count = Math.floor(ROLL_END * 15);
  for (let k = 0; k < count; k++) {
    const x = k / count;
    const at = Math.floor(rate * (k / 15 + rnd() * 0.008 + 0.008));
    const a = (0.06 + 0.94 * x * x) * (0.85 + 0.15 * rnd());
    const n = Math.min(stroke.length, out.length - at);
    for (let i = 0; i < n; i++) out[at + i]! += stroke[i]! * a;
  }
  return finish(out, rate, 0.9);
}

/** Frame drum, open bass stroke ("doum"): a deep membrane with a strong pitch drop. */
export function renderDoum(rate = BUF_RATE): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 0.7));
  modes(
    out,
    rate,
    86,
    [
      { ratio: 1, amp: 1, t60: 0.5 },
      { ratio: 1.59, amp: 0.45, t60: 0.28 },
      { ratio: 2.14, amp: 0.3, t60: 0.2 },
      { ratio: 2.3, amp: 0.22, t60: 0.16 },
      { ratio: 2.65, amp: 0.16, t60: 0.12 },
    ],
    0.09,
    0.035,
    1,
  );
  burst(out, rate, 0.35, 0.3, 0.008, 0xd00);
  saturate(out, 1.6);
  return finish(out, rate, 0.9);
}

/** Frame drum, edge stroke ("tak"): short, woody, centered well below 1 kHz. */
export function renderTak(rate = BUF_RATE): Float32Array {
  const out = new Float32Array(Math.ceil(rate * 0.3));
  modes(
    out,
    rate,
    190,
    [
      { ratio: 1, amp: 0.3, t60: 0.12 },
      { ratio: 1.59, amp: 0.5, t60: 0.09 },
      { ratio: 2.14, amp: 0.45, t60: 0.07 },
      { ratio: 2.65, amp: 0.35, t60: 0.06 },
      { ratio: 3.16, amp: 0.25, t60: 0.05 },
    ],
    0.04,
    0.02,
    1,
  );
  burst(out, rate, 0.7, 0.35, 0.006, 0x7a4, 0.12);
  return finish(out, rate, 0.9);
}

/**
 * The zoom's sub at the flash: a tonal D1 (with its octave) swelling in behind the SFX's impact,
 * which owns the transient; saturated just enough to be heard on laptop speakers.
 */
export function renderSub(rate = BUF_RATE): Float32Array {
  const secs = 3.2;
  const len = Math.ceil(rate * secs);
  const out = new Float32Array(len);
  const w1 = (2 * Math.PI * 36.71) / rate;
  const w2 = w1 * 2;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    // Swell in behind the transient, ring out, and fade over the last 0.3 s (several periods).
    const tail = Math.min(1, (secs - t) / 0.3);
    const env = (1 - Math.exp(-t / 0.07)) * Math.exp(-t / 0.8) * tail;
    out[i] = (Math.sin(w1 * i) + 0.5 * Math.sin(w2 * i)) * env;
  }
  saturate(out, 1.5);
  return finish(out, rate, 0.9);
}
