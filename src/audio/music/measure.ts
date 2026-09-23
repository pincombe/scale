// Dev-only music meter (imported by lab.ts only, so it never ships). Renders the real score with
// the real conductor and performer into an OfflineAudioContext, through a copy of the engine's hall
// reverb, and measures what a player hears at music volume 1 (before the bus and master gains,
// like the SFX table in sfxMeasure.ts):
//   loudness  BS.1770 K-weighting; momentary (400 ms) max, short-term (3 s) median and max,
//             integrated (gated)
//   peak      sample peak, dBFS (the limiter starts at -6)
//   band      the 1-4 kHz band the clicks and crits live in: its momentary level, compared with a
//             real sword clang's (sfxSounds.sStrike) in the same band
import { Conductor, type Beat, type MusicInputs } from './conductor';
import { WebPerformer, type Layer } from './performer';
import * as S from '../sfxSounds';

const RATE = 48000;

export interface Scenario {
  name: string;
  secs: number;
  /** Measure from here (skip a fade-in or a setup). */
  from: number;
  inputs: (t: number) => MusicInputs;
  /** Conductor calls at times (s). */
  cues?: [number, (c: Conductor, t: number) => void][];
}

export interface MusicReport {
  name: string;
  momentaryMax: number;
  shortMedian: number;
  shortMax: number;
  integrated: number;
  peak: number;
  bandMedian: number;
  bandMax: number;
  /** Clang band level (momentary) minus the music's band median: how far the clicks stand out. */
  clickMargin: number;
  /** Share of the music's energy in 1-4 kHz. */
  bandShare: number;
  nodes: number;
  /** JS scheduling cost per 25 ms tick (conductor + node creation), ms. */
  tickMs: number;
}

const base = (p: Partial<MusicInputs>): MusicInputs => ({ tier: 0, boss: false, energy: 0.4, tension: 0, urgency: 0, ...p });

const ZOOM_BEATS: [Beat, number][] = [
  ['rally', 0],
  ['fusion', 1],
  ['flash', 2.2],
  ['pullback', 2.4],
  ['reveal', 6.4],
  ['roar', 7],
  ['card', 7.6],
  ['done', 9.5],
];

export const SCENARIOS: Scenario[] = [
  { name: 'meadow, first minute', secs: 40, from: 6, inputs: () => base({ energy: 0.12 }) },
  { name: 'meadow, full army', secs: 40, from: 6, inputs: () => base({ energy: 0.85 }) },
  { name: 'meadow, gauge nearly full', secs: 40, from: 6, inputs: () => base({ energy: 0.9, tension: 0.85 }) },
  { name: 'mountain', secs: 45, from: 6, inputs: () => base({ tier: 1, energy: 0.35 }) },
  { name: 'mountain, full', secs: 45, from: 6, inputs: () => base({ tier: 1, energy: 0.85 }) },
  {
    name: 'boss (Meadow)',
    secs: 40,
    from: 8,
    inputs: (t) => base({ energy: 0.8, boss: t > 5, urgency: t > 25 ? 0.9 : 0 }),
    cues: [[5, (c, t) => c.bossSummon(t)]],
  },
  {
    name: 'boss won, theme returns',
    secs: 30,
    from: 10,
    inputs: (t) => base({ energy: 0.8, boss: t > 3 && t < 10 }),
    cues: [
      [3, (c, t) => c.bossSummon(t)],
      [10, (c, t) => c.bossDefeated(t, false)],
    ],
  },
  {
    name: 'the zoom (rally to done)',
    secs: 26,
    from: 6,
    inputs: (t) => base({ energy: t < 8.4 ? 0.85 : 0.1, tier: t >= 8.4 ? 1 : 0 }),
    cues: ZOOM_BEATS.map(([b, at]) => [6 + at, (c: Conductor, t: number) => c.beat(b, t)] as [number, (c: Conductor, t: number) => void]),
  },
];

/** The engine's hall impulse (a copy of engine.ts makeImpulse: 2.6 s, decay 3.2). */
function impulse(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const pre = Math.floor(0.012 * ctx.sampleRate);
  const taps = [0.013, 0.019, 0.027, 0.037, 0.049, 0.061];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let s = ch === 0 ? 0x9e3779b9 : 0x7f4a7c15;
    let lp = 0;
    for (let i = pre; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const white = ((s >>> 0) / 4294967296) * 2 - 1;
      const t = (i - pre) / (len - pre);
      lp += (white - lp) * (0.9 - 0.75 * t);
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
    for (let k = 0; k < taps.length; k++) {
      const at = Math.floor((taps[k]! + (ch ? 0.0023 : 0)) * ctx.sampleRate);
      if (at < len) d[at] = (d[at] ?? 0) + (k % 2 ? -1 : 1) * (0.7 - k * 0.08);
    }
  }
  return buf;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x1234567;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

/** Render a scenario: [left, right] at 48 kHz, plus the node count and scheduling cost. */
export async function renderScenario(sc: Scenario, layers?: readonly Layer[]): Promise<{ l: Float32Array; r: Float32Array; nodes: number; tickMs: number }> {
  const ctx = new OfflineAudioContext(2, Math.ceil(sc.secs * RATE), RATE);
  const dry = ctx.createGain();
  dry.connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  const ret = ctx.createGain();
  ret.gain.value = 0.5;
  const wet = ctx.createGain();
  wet.connect(verb);
  verb.connect(ret);
  ret.connect(ctx.destination);
  const perf = new WebPerformer(ctx, dry, wet, noiseBuffer(ctx), { offline: true, only: layers });
  const c = new Conductor(perf, 0x5ca1e);
  const cues = [...(sc.cues ?? [])];
  let ticks = 0;
  // The bank renders once per page (live, it is spread over the first seconds): keep it out of the timing.
  while (perf.prefetchNext()) {
    /* build every buffer */
  }
  const t0 = performance.now();
  c.start(0, sc.inputs(0), 2);
  for (let t = 0; t < sc.secs; t += 0.025) {
    while (cues.length > 0 && cues[0]![0] <= t) cues.shift()![1](c, t);
    c.update(t, sc.inputs(t));
    perf.cleanup(t);
    ticks++;
  }
  const tickMs = (performance.now() - t0) / ticks;
  const buf = await ctx.startRendering();
  return { l: buf.getChannelData(0), r: buf.getChannelData(1), nodes: perf.peakNodes + perf.graphNodes, tickMs };
}

// ---- Analysis ----

type Bq = [number, number, number, number, number];

function biquad(x: Float32Array, [b0, b1, b2, a1, a2]: Bq): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i]! + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i]!;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** RBJ low/high-pass at `f` (Hz), quality `q`, normalized. */
function pass(kind: 'lp' | 'hp', f: number, q: number): Bq {
  const w = (2 * Math.PI * f) / RATE;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const b = kind === 'lp' ? [(1 - cs) / 2, 1 - cs, (1 - cs) / 2] : [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  return [b[0]! / a0, b[1]! / a0, b[2]! / a0, (-2 * cs) / a0, (1 - al) / a0];
}

/** BS.1770 K-weighting at 48 kHz. */
const K1: Bq = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const K2: Bq = [1, -2, 1, -1.99004745483398, 0.99007225036621];

function kWeight(x: Float32Array): Float32Array {
  return biquad(biquad(x, K1), K2);
}

/** 4th-order Butterworth band 1-4 kHz. */
function band(x: Float32Array): Float32Array {
  let y = biquad(x, pass('hp', 1000, 0.5412));
  y = biquad(y, pass('hp', 1000, 1.3066));
  y = biquad(y, pass('lp', 4000, 0.5412));
  return biquad(y, pass('lp', 4000, 1.3066));
}

/** Mean-square per window (both channels summed), hop 100 ms, starting at `from` s. */
function windows(l: Float32Array, r: Float32Array, win: number, from: number): number[] {
  const n = Math.floor(win * RATE);
  const hop = Math.floor(0.1 * RATE);
  const out: number[] = [];
  for (let i = Math.floor(from * RATE); i + n <= l.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += l[j]! * l[j]! + r[j]! * r[j]!;
    out.push(s / n);
  }
  return out;
}

const lufs = (ms: number): number => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -120);
const db = (ms: number): number => (ms > 0 ? 10 * Math.log10(ms) : -120);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? -120;
}

/** Gated integrated loudness (BS.1770: -70 LUFS absolute gate, then -10 LU relative). */
function integrated(blocks: number[]): number {
  const abs = blocks.filter((m) => lufs(m) > -70);
  if (abs.length === 0) return -120;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((m) => lufs(m) > lufs(mean) - 10);
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

export function analyze(name: string, l: Float32Array, r: Float32Array, from: number, clickBand: number, nodes: number, tickMs: number): MusicReport {
  const kl = kWeight(l);
  const kr = kWeight(r);
  const mom = windows(kl, kr, 0.4, from).map(lufs);
  const st = windows(kl, kr, 3, from).map(lufs);
  const bl = band(l);
  const br = band(r);
  const bandMom = windows(bl, br, 0.4, from).map(db);
  const all = windows(l, r, 0.4, from);
  const bandAll = windows(bl, br, 0.4, from);
  let peak = 0;
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  const bandMedian = median(bandMom);
  return {
    name,
    momentaryMax: Math.max(...mom),
    shortMedian: median(st),
    shortMax: Math.max(...st),
    integrated: integrated(windows(kl, kr, 0.4, from)),
    peak: 20 * Math.log10(peak || 1e-9),
    bandMedian,
    bandMax: Math.max(...bandMom),
    clickMargin: clickBand - bandMedian,
    bandShare: bandAll.reduce((a, b) => a + b, 0) / Math.max(1e-12, all.reduce((a, b) => a + b, 0)),
    nodes,
    tickMs,
  };
}

/** A sword clang's momentary level in the 1-4 kHz band (the thing the music must not mask). */
export async function clickBandLevel(): Promise<number> {
  let sum = 0;
  const runs = 5;
  for (let k = 0; k < runs; k++) {
    const ctx = new OfflineAudioContext(2, RATE, RATE);
    const g = ctx.createGain();
    g.connect(ctx.destination);
    S.sStrike({ ctx, dest: g, send: null, noise: noiseBuffer(ctx), t: 0.01 });
    const buf = await ctx.startRendering();
    const x = buf.getChannelData(0);
    const y = buf.getChannelData(1);
    sum += Math.max(...windows(band(x), band(y), 0.4, 0).map(db));
  }
  return sum / runs;
}

/** Render and meter every scenario (or those whose name contains `only`; `layers` solos). Logs a table. */
export async function measureMusic(only = '', layers?: readonly Layer[]): Promise<MusicReport[]> {
  const click = await clickBandLevel();
  const rows: MusicReport[] = [];
  for (const sc of SCENARIOS) {
    if (only && !sc.name.includes(only)) continue;
    const { l, r, nodes, tickMs } = await renderScenario(sc, layers);
    rows.push(analyze(sc.name, l, r, sc.from, click, nodes, tickMs));
  }
  const f = (x: number): string => x.toFixed(1);
  console.table(
    rows.map((x) => ({
      name: x.name,
      'M max': f(x.momentaryMax),
      'ST med': f(x.shortMedian),
      'ST max': f(x.shortMax),
      int: f(x.integrated),
      peak: f(x.peak),
      'band med': f(x.bandMedian),
      'band max': f(x.bandMax),
      'click margin': f(x.clickMargin),
      'band %': (x.bandShare * 100).toFixed(1),
      nodes: x.nodes,
      'ms/tick': x.tickMs.toFixed(3),
    })),
  );
  console.log(`sword clang, 1-4 kHz momentary: ${f(click)} dBFS`);
  return rows;
}
