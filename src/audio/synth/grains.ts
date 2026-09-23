// Grains: short one-shot samples synthesized once per context in plain JS (hoofbeats, armored
// footsteps, snare strokes, a patter of arrow strikes) plus a looping brown-noise bed for rumbles.
// Played as bare AudioBufferSourceNodes, a crowd of hundreds of feet or a galloping troop costs one
// node per hit instead of five or six, which keeps the M2 set pieces inside the node budget.
import type { Out } from './kit';

export type GrainKind = 'hoof' | 'hoofHard' | 'step' | 'snare' | 'rain' | 'thk';

const cache = new WeakMap<BaseAudioContext, Map<GrainKind, AudioBuffer>>();
const brownCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** xorshift32 → [0, 1). Seeded per kind so every context builds identical grains. */
function rng(seed: number): () => number {
  let s = seed | 0 || 0x1234567;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Normalize to `peak` and fade the last 3 ms so a grain never ends on a step. */
function finish(d: Float32Array, rate: number, peak: number): void {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]!));
  const k = m > 0 ? peak / m : 0;
  const fade = Math.min(d.length, Math.floor(rate * 0.003));
  for (let i = 0; i < d.length; i++) {
    const tail = d.length - 1 - i;
    d[i] = d[i]! * k * (tail < fade ? tail / fade : 1);
  }
}

/**
 * A hoof striking turf: a damped low "tok" (a 95–120 Hz body with a fast pitch drop) under a
 * clod-of-dirt noise burst. `hard` = the accented forefoot, brighter and heavier.
 */
function hoof(d: Float32Array, rate: number, hard: boolean): void {
  const r = rng(hard ? 0x51f00d : 0x40f00d);
  const f0 = hard ? 118 : 104;
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    const f = f0 * (1 + 1.4 * Math.exp(-t / 0.008));
    ph += (2 * Math.PI * f) / rate;
    const body = Math.sin(ph) * Math.exp(-t / (hard ? 0.05 : 0.04));
    lp += (r() * 2 - 1 - lp) * (hard ? 0.35 : 0.22);
    const dirt = lp * Math.exp(-t / 0.018) * (hard ? 0.9 : 0.7);
    const click = (r() * 2 - 1) * Math.exp(-t / 0.0012) * 0.5;
    d[i] = body + dirt + click;
  }
}

/** An armored footfall: a soft boot thud, a scuff, and a quick jingle of mail and plate. */
function step(d: Float32Array, rate: number): void {
  const r = rng(0x5739);
  let ph = 0;
  let lp = 0;
  let hp = 0;
  let prev = 0;
  const mail = [3100, 4270, 5530, 6890];
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    ph += (2 * Math.PI * 80 * (1 + Math.exp(-t / 0.01))) / rate;
    const thud = Math.sin(ph) * Math.exp(-t / 0.03);
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.12;
    const scuff = lp * Math.exp(-t / 0.035) * 0.8;
    hp = w - prev;
    prev = w;
    let jingle = 0;
    for (let k = 0; k < mail.length; k++) {
      const at = 0.012 + k * 0.017;
      if (t > at) jingle += Math.sin(2 * Math.PI * mail[k]! * (t - at)) * Math.exp(-(t - at) / 0.02) * 0.12;
    }
    d[i] = thud + scuff + hp * Math.exp(-t / 0.05) * 0.12 + jingle;
  }
}

/** A snare stroke: the head (a 190 Hz triangle-ish thump) and the rattling wires (bright noise). */
function snare(d: Float32Array, rate: number): void {
  const r = rng(0x5a7e);
  let ph = 0;
  let lp = 0;
  let prev = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    ph += (2 * Math.PI * 190 * (1 + 0.5 * Math.exp(-t / 0.006))) / rate;
    const head = Math.sin(ph) * Math.exp(-t / 0.028);
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.6;
    const wires = (lp - prev) * 1.6 * Math.exp(-t / 0.07);
    prev = lp;
    d[i] = head * 0.9 + wires;
  }
}

/** An arrowhead biting in: a woody band of noise and a tiny low knock. */
function thk(d: Float32Array, rate: number): void {
  const r = rng(0x7e4b);
  let ph = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / rate;
    ph += (2 * Math.PI * 190 * (1 + Math.exp(-t / 0.01))) / rate;
    const w = r() * 2 - 1;
    // Two one-poles: a crude band around 1.5 kHz.
    a += (w - a) * 0.35;
    b += (a - b) * 0.12;
    d[i] = (a - b) * 2.2 * Math.exp(-t / 0.009) + Math.sin(ph) * Math.exp(-t / 0.03) * 0.45;
  }
}

/**
 * A storm of arrows landing over ~1 s: hundreds of woody strikes, dense at the leading edge and
 * thinning out, with a low pummeling under the first half.
 */
function rain(d: Float32Array, rate: number): void {
  const r = rng(0x3a1a);
  const one = new Float32Array(Math.floor(rate * 0.05));
  thk(one, rate);
  const n = d.length;
  for (let k = 0; k < 260; k++) {
    // Front-loaded arrival times.
    const u = Math.pow(r(), 1.8);
    const at = Math.floor(u * (n - one.length));
    const amp = (0.25 + 0.75 * r()) * (1 - 0.6 * u);
    const stretch = 0.8 + r() * 0.5;
    for (let j = 0; j < one.length; j++) {
      const src = Math.floor(j * stretch);
      if (src >= one.length) break;
      d[at + j] = d[at + j]! + one[src]! * amp;
    }
  }
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    lp += (r() * 2 - 1 - lp) * 0.02;
    d[i] = d[i]! + lp * 6 * Math.max(0, 1 - t * 1.8);
  }
}

const LEN: Record<GrainKind, number> = { hoof: 0.12, hoofHard: 0.14, step: 0.14, snare: 0.22, rain: 1.1, thk: 0.06 };
const PEAK: Record<GrainKind, number> = { hoof: 0.8, hoofHard: 1, step: 0.9, snare: 0.9, rain: 0.9, thk: 0.9 };

/** The grain buffer of `kind` for this context (built once, then cached). */
export function grainBuffer(ctx: BaseAudioContext, kind: GrainKind): AudioBuffer {
  let m = cache.get(ctx);
  if (!m) cache.set(ctx, (m = new Map()));
  let b = m.get(kind);
  if (b) return b;
  const rate = ctx.sampleRate;
  b = ctx.createBuffer(1, Math.floor(rate * LEN[kind]), rate);
  const d = b.getChannelData(0);
  if (kind === 'hoof' || kind === 'hoofHard') hoof(d, rate, kind === 'hoofHard');
  else if (kind === 'step') step(d, rate);
  else if (kind === 'snare') snare(d, rate);
  else if (kind === 'thk') thk(d, rate);
  else rain(d, rate);
  finish(d, rate, PEAK[kind]);
  m.set(kind, b);
  return b;
}

/** Play one grain at `at` (one node). `rate` detunes it (and stretches it). Returns its end. */
export function grain(o: Out, kind: GrainKind, at: number, to: AudioNode, rate = 1): number {
  const buf = grainBuffer(o.ctx, kind);
  const src = o.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(to);
  src.start(at);
  return at + buf.duration / rate;
}

/**
 * 4 s of looping brown noise (integrated white noise with a leak), normalized: the raw material
 * of rumbles, tremors and avalanches (far more low end per node than low-passed white noise).
 */
export function brownBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = brownCache.get(ctx);
  if (b) return b;
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 4);
  const fade = Math.floor(rate * 0.25);
  const raw = new Float32Array(len + fade);
  const r = rng(0x6b0f);
  let x = 0;
  let peak = 0;
  for (let i = 0; i < raw.length; i++) {
    x = x * 0.996 + (r() * 2 - 1) * 0.06;
    raw[i] = x;
    peak = Math.max(peak, Math.abs(x));
  }
  // A one-pole high-pass at ~25 Hz: no sub-sonic heave (it only eats headroom and reads as DC).
  const R = 1 - (2 * Math.PI * 25) / rate;
  let px = 0;
  let py = 0;
  peak = 0;
  for (let i = 0; i < raw.length; i++) {
    const y = raw[i]! - px + R * py;
    px = raw[i]!;
    py = y;
    raw[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  let mean = 0;
  for (let i = 0; i < raw.length; i++) mean += raw[i]!;
  mean /= raw.length;
  b = ctx.createBuffer(1, len, rate);
  const d = b.getChannelData(0);
  const k = 0.95 / (peak || 1);
  for (let i = 0; i < len; i++) d[i] = (raw[i]! - mean) * k;
  // Crossfade the overhang into the head: a seamless loop.
  for (let i = 0; i < fade; i++) {
    const u = i / fade;
    d[i] = ((raw[i]! - mean) * u + (raw[len + i]! - mean) * (1 - u)) * k;
  }
  brownCache.set(ctx, b);
  return b;
}

/** A looping brown-noise source from `at` for `dur` s, at a random offset. */
export function brownSrc(o: Out, at: number, dur: number, to: AudioNode, rate = 1): AudioBufferSourceNode {
  const src = o.ctx.createBufferSource();
  src.buffer = brownBuffer(o.ctx);
  src.loop = true;
  src.playbackRate.value = rate;
  src.connect(to);
  src.start(at, Math.random() * 3.5);
  src.stop(at + dur);
  return src;
}
