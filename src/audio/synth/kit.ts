// Synth building blocks shared by every SFX recipe. Recipes take an `Out` and build one-shot nodes
// into it, so the exact same code runs live (AudioContext) and in the offline meter (sfxMeasure).

export interface Out {
  ctx: BaseAudioContext;
  /** Dry input of this sound (the caller's per-sound gain → panner → sfx bus). */
  dest: AudioNode;
  /** Reverb send for this sound (already scaled by the caller), or null for a dry sound. */
  send: AudioNode | null;
  /** Shared 1 s white-noise buffer. */
  noise: AudioBuffer;
  /** Start time on the audio clock. */
  t: number;
}

export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(Math.random() * xs.length)]!;
}

export function gainNode(o: Out, value: number, to: AudioNode | null): GainNode {
  const g = o.ctx.createGain();
  g.gain.value = value;
  if (to) g.connect(to);
  return g;
}

/**
 * Switch a filter's params to k-rate (one coefficient update per 128-sample block instead of per
 * sample). Sweeps sound identical, and automated filters get several times cheaper. Harmless where
 * `automationRate` isn't supported.
 */
export function kRate(f: BiquadFilterNode): BiquadFilterNode {
  try {
    f.frequency.automationRate = 'k-rate';
    f.Q.automationRate = 'k-rate';
  } catch {
    /* not supported: stays a-rate */
  }
  return f;
}

export function filterNode(o: Out, type: BiquadFilterType, freq: number, q: number, to: AudioNode | null): BiquadFilterNode {
  const f = kRate(o.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  if (to) f.connect(to);
  return f;
}

/** Route `node` into the reverb send (if this sound has one). */
export function toSend(o: Out, node: AudioNode): void {
  if (o.send) node.connect(o.send);
}

/** Decay length in time constants: 5τ ≈ -43 dB, then a 5 ms fade to true zero. */
export const DECAY_TAUS = 5;

/**
 * Percussive envelope: 0 → peak in `attack`, exponential decay with time constant `tau` for 5τ,
 * then a 5 ms linear fade to 0 so the source can stop without a click. Returns that end time.
 */
export function perc(p: AudioParam, t: number, peak: number, attack: number, tau: number): number {
  const a = peak > 1e-6 ? peak : 1e-6;
  const decayEnd = t + attack + tau * DECAY_TAUS;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(a, t + attack);
  p.exponentialRampToValueAtTime(a * Math.exp(-DECAY_TAUS), decayEnd);
  p.linearRampToValueAtTime(0, decayEnd + 0.005);
  return decayEnd + 0.005;
}

/** Attack / hold / release envelope (linear attack, exponential release). Ends near silence at t+a+h+r*5. */
export function ahr(p: AudioParam, t: number, peak: number, a: number, h: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + h);
  p.setTargetAtTime(0, t + a + h, r);
}

/**
 * A decaying sine (or other waveform) partial: osc → gain env → `to`. Starts at `at` (absolute),
 * stops once it has decayed ~60 dB. Returns the stop time.
 */
export function partial(
  o: Out,
  freq: number,
  amp: number,
  at: number,
  attack: number,
  tau: number,
  to: AudioNode,
  type: OscillatorType = 'sine',
): number {
  const osc = o.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = o.ctx.createGain();
  const end = perc(g.gain, at, amp, attack, tau);
  osc.connect(g);
  g.connect(to);
  osc.start(at);
  osc.stop(end);
  return end;
}

/** A noise source (looping, random offset) starting at `at` and stopping at `at + dur`. */
export function noiseSrc(o: Out, at: number, dur: number, to: AudioNode, rate = 1): AudioBufferSourceNode {
  const src = o.ctx.createBufferSource();
  src.buffer = o.noise;
  src.loop = true;
  src.playbackRate.value = rate;
  src.connect(to);
  src.start(at, Math.random() * 0.9);
  src.stop(at + dur);
  return src;
}

/** Filtered noise burst with a percussive envelope. Returns the end time. */
export function noiseHit(
  o: Out,
  at: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
  amp: number,
  attack: number,
  tau: number,
  to: AudioNode,
): number {
  const g = gainNode(o, 0, to);
  const dur = perc(g.gain, at, amp, attack, tau) - at;
  const f = filterNode(o, type, freq, q, g);
  noiseSrc(o, at, dur, f);
  return at + dur;
}

/** Pitch-dropping sine thump (kick-drum style): the weight under hits, booms and landings. */
export function thump(o: Out, at: number, f1: number, f2: number, drop: number, amp: number, tau: number, to: AudioNode): number {
  const osc = o.ctx.createOscillator();
  osc.frequency.setValueAtTime(f1, at);
  osc.frequency.exponentialRampToValueAtTime(f2, at + drop);
  const g = o.ctx.createGain();
  const end = perc(g.gain, at, amp, 0.003, tau);
  osc.connect(g);
  g.connect(to);
  osc.start(at);
  osc.stop(end);
  return end;
}

/** A low-frequency oscillator summed into `param` (depth in the param's units). */
export function lfo(o: Out, param: AudioParam, freq: number, depth: number, at: number, end: number, type: OscillatorType = 'sine'): GainNode {
  const osc = o.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = o.ctx.createGain();
  g.gain.value = depth;
  osc.connect(g);
  g.connect(param);
  osc.start(at);
  osc.stop(end);
  return g;
}

// ---- Cached buffers and curves (per context) ----

const crackleCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const rubbleCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const shaperCache = new Map<number, Float32Array<ArrayBuffer>>();

/** 2 s of sparse crackle: random tiny decaying clicks (fire, embers). */
export function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = crackleCache.get(ctx);
  if (b) return b;
  const rate = ctx.sampleRate;
  b = ctx.createBuffer(1, rate * 2, rate);
  const d = b.getChannelData(0);
  let s = 0x2545f491;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const clicksPerSec = 70;
  let env = 0;
  let amp = 0;
  let decay = 0.99;
  for (let i = 0; i < d.length; i++) {
    if (rnd() < clicksPerSec / rate) {
      amp = 0.25 + rnd() * 0.75;
      env = 1;
      decay = Math.exp(-1 / (rate * (0.0006 + rnd() * 0.003)));
    }
    d[i] = (rnd() * 2 - 1) * env * amp;
    env *= decay;
  }
  crackleCache.set(ctx, b);
  return b;
}

/** 1.8 s of rubble: dense low grains thinning out over time (a dragon crumbling). */
export function rubbleBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = rubbleCache.get(ctx);
  if (b) return b;
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 1.8);
  b = ctx.createBuffer(1, len, rate);
  const d = b.getChannelData(0);
  let s = 0x68e31da4;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  let env = 0;
  let amp = 0;
  let decay = 0.99;
  let lp = 0;
  let k = 0.2;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const density = 90 * (1 - u) * (1 - u) + 6;
    if (rnd() < density / rate) {
      amp = (0.35 + rnd() * 0.65) * (1 - 0.6 * u);
      env = 1;
      decay = Math.exp(-1 / (rate * (0.006 + rnd() * 0.03)));
      k = 0.05 + rnd() * 0.25;
    }
    lp += ((rnd() * 2 - 1) - lp) * k;
    d[i] = lp * env * amp * 2.2;
    env *= decay;
  }
  // Fade the last 50 ms so the buffer never ends on a step.
  const fade = Math.floor(rate * 0.05);
  for (let i = 0; i < fade; i++) d[len - 1 - i]! *= i / fade;
  rubbleCache.set(ctx, b);
  return b;
}

/** Normalised tanh soft-clip curve for WaveShaper (drive k rounded to 0.5 steps). */
export function softClip(k: number): Float32Array<ArrayBuffer> {
  const key = Math.round(k * 2) / 2;
  let c = shaperCache.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  const norm = Math.tanh(key);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(key * x) / norm;
  }
  shaperCache.set(key, c);
  return c;
}

/** Play a cached buffer through `to`. */
export function bufferSrc(o: Out, buf: AudioBuffer, at: number, dur: number, to: AudioNode, rate = 1, offset = 0): AudioBufferSourceNode {
  const src = o.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  src.connect(to);
  src.start(at, offset);
  src.stop(at + dur);
  return src;
}
