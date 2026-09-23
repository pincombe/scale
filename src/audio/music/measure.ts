// Dev-only music meter (imported by lab.ts only, so it never ships). Renders the real score with
// the real conductor and performer into an OfflineAudioContext, through a copy of the engine's hall
// reverb, and measures what a player hears at music volume 1 (before the bus and master gains,
// like the SFX table in sfxMeasure.ts):
//   loudness  BS.1770 K-weighting; momentary (400 ms) max, short-term (3 s) median and max,
//             integrated (gated)
//   peak      sample peak, dBFS (the limiter starts at -6)
//   band      the 1-4 kHz band the clicks and crits live in: its momentary level, compared with a
//             real sword clang's (sfxSounds.sStrike) in the same band
// Zoom scenarios run on the director's own timeline (render/zoom/timeline.ts) and can mix the
// SFX's beat sounds in; boss scenarios run the timer out and can simulate the fx heartbeat locked
// to the music, to measure its margin.
import { Conductor, type Beat, type MusicInputs } from './conductor';
import { WebPerformer, type Layer } from './performer';
import type { Out } from '../synth/kit';
import * as S from '../sfxSounds';
import { bossUrgency, freeHeartPeriod, HEART_DUB } from '../../render/fx/dread';
import { zoomTimeline } from '../../render/zoom/timeline';

const RATE = 48000;
/** The engine's default gains (settings): music bus, SFX bus, master. */
const MUSIC_VOL = 0.6;
const SFX_VOL = 0.8;
const MASTER_VOL = 0.8;

type Cue = [number, (c: Conductor, t: number) => void];

export interface Scenario {
  name: string;
  secs: number;
  /** Measure from here (skip a fade-in or a setup)... */
  from: number;
  /** ...to here (default: the end). */
  to?: number;
  inputs: (t: number) => MusicInputs;
  /** Conductor calls at times (s). */
  cues?: Cue[];
  /** SFX mixed in at their own levels, as [time, recipe] (the zoom's diegetic half). */
  sfx?: [number, (o: Out) => number][];
  /** Mix at the engine's default volumes (music 0.6, SFX 0.8, master 0.8): what reaches the limiter. */
  defaults?: boolean;
  /** Simulate the fx boss heartbeat (locked to the music) over [from, to], into channels 2-3. */
  heart?: { from: number; to: number };
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
  /** Drum hits (doum + tak) per second in the window. */
  drums: number;
}

const base = (p: Partial<MusicInputs>): MusicInputs => ({ tier: 0, boss: false, energy: 0.4, tension: 0, urgency: 0, ...p });

/** The zoom's beats on the director's timeline, starting at `at`. */
function zoomCues(at: number): Cue[] {
  const tl = zoomTimeline(false).beats;
  const beats = (Object.keys(tl) as Beat[]).sort((a, b) => tl[a] - tl[b]);
  return beats.map((b, i) => {
    const nx = beats[i + 1];
    return [at + tl[b], (c: Conductor, t: number) => c.beat(b, t, nx ? tl[nx] - tl[b] : undefined)] as Cue;
  });
}

/** The SFX's half of the zoom (sfx.ts onBeat), on the same timeline. */
function zoomSfx(at: number): [number, (o: Out) => number][] {
  const tl = zoomTimeline(false).beats;
  return [
    [at + tl.rally, S.sRallyHorns],
    [at + tl.rally + 0.15, (o) => S.sArmyRush(o, 1.9, 34)],
    [at + tl.fusion, (o) => S.sFusionRise(o, tl.flash - tl.fusion)],
    [at + tl.flash, S.sFlashImpact],
    [at + tl.pullback, (o) => S.sWindRush(o, tl.reveal - tl.pullback)],
    [at + tl.reveal, S.sRevealRumble],
    [at + tl.roar, S.sColossalRoar],
    [at + tl.card + 0.05, S.sCardChime],
  ];
}

/** A boss summoned at `at`; its 30 s timer runs from its entrance (~2 s later) out. */
function bossFight(at: number, energy = 0.8): (t: number) => MusicInputs {
  const end = at + 2 + 30;
  return (t) => {
    const fighting = t > at && t < end;
    const u = fighting ? bossUrgency(Math.max(0.001, end - t)) : 0;
    return base({ energy, boss: fighting, urgency: u, heart: u });
  };
}

const ZOOM_AT = 6;

export const SCENARIOS: Scenario[] = [
  { name: 'meadow, first minute', secs: 40, from: 6, inputs: () => base({ energy: 0.12 }) },
  { name: 'meadow, full army', secs: 40, from: 6, inputs: () => base({ energy: 0.85 }) },
  { name: 'meadow, gauge nearly full', secs: 40, from: 6, inputs: () => base({ energy: 0.9, tension: 0.85 }) },
  { name: 'mountain', secs: 45, from: 6, inputs: () => base({ tier: 1, energy: 0.35 }) },
  { name: 'mountain, full', secs: 45, from: 6, inputs: () => base({ tier: 1, energy: 0.85 }) },
  { name: 'boss, calm', secs: 40, from: 8, to: 26, inputs: bossFight(5), cues: [[5, (c, t) => c.bossSummon(t)]] },
  { name: 'boss, last 10 s', secs: 40, from: 28, to: 36.5, inputs: bossFight(5), cues: [[5, (c, t) => c.bossSummon(t)]] },
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
    from: ZOOM_AT,
    inputs: (t) => base({ energy: t < ZOOM_AT + 2.2 ? 0.85 : 0.1, tier: t >= ZOOM_AT + 2.2 ? 1 : 0 }),
    cues: zoomCues(ZOOM_AT),
  },
  {
    name: 'zoom + SFX, default vols',
    secs: 26,
    from: ZOOM_AT,
    to: ZOOM_AT + 12,
    inputs: (t) => base({ energy: t < ZOOM_AT + 2.2 ? 0.85 : 0.1, tier: t >= ZOOM_AT + 2.2 ? 1 : 0 }),
    cues: zoomCues(ZOOM_AT),
    sfx: zoomSfx(ZOOM_AT),
    defaults: true,
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

export interface Render {
  l: Float32Array;
  r: Float32Array;
  /** The simulated heartbeat alone (scenarios with `heart`), and when each lub landed. */
  hl?: Float32Array;
  hr?: Float32Array;
  lubs: number[];
  /** Each lub's distance from its grid point (s; NaN while free-running). */
  offs?: number[];
  nodes: number;
  tickMs: number;
  drums: number;
}

export interface RenderOpts {
  /** Solo these music layers. */
  layers?: readonly Layer[];
  /** Keep the boss's low hits on the heartbeat's beats (to compare). */
  noClear?: boolean;
  /** No low-shelf dip under the heartbeat (to compare). */
  noDip?: boolean;
}

/** Render a scenario: the mix at 48 kHz (and the heartbeat alone), plus the node count and scheduling cost. */
export async function renderScenario(sc: Scenario, opts: RenderOpts = {}): Promise<Render> {
  const ctx = new OfflineAudioContext(sc.heart ? 4 : 2, Math.ceil(sc.secs * RATE), RATE);
  const merge = ctx.createChannelMerger(sc.heart ? 4 : 2);
  merge.connect(ctx.destination);
  const mix = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  mix.connect(split);
  split.connect(merge, 0, 0);
  split.connect(merge, 1, 1);
  const musicGain = sc.defaults ? MUSIC_VOL * MASTER_VOL : 1;
  const sfxGain = sc.defaults ? SFX_VOL * MASTER_VOL : 1;
  const dry = ctx.createGain();
  dry.gain.value = musicGain;
  dry.connect(mix);
  // One hall, shared as in the engine: the music's send (at music volume) and the SFX's.
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx);
  const ret = ctx.createGain();
  ret.gain.value = 0.5 * (sc.defaults ? MASTER_VOL : 1);
  verb.connect(ret);
  ret.connect(mix);
  const wet = ctx.createGain();
  wet.gain.value = sc.defaults ? MUSIC_VOL : 1;
  wet.connect(verb);
  const noise = noiseBuffer(ctx);
  const perf = new WebPerformer(ctx, dry, wet, noise, { offline: true, only: opts.layers });
  // Count the drum hits the conductor hands over inside the measured window.
  let drums = 0;
  const to = sc.to ?? sc.secs;
  const play = perf.play.bind(perf);
  perf.play = (ev, t, dur, gain) => {
    if ((ev.inst === 'doum' || ev.inst === 'tak') && t >= sc.from && t < to) drums++;
    play(ev, t, dur, gain);
  };
  const c = new Conductor(perf, 0x5ca1e);
  c.clearHeart = !opts.noClear;
  const sfxOut = ctx.createGain();
  sfxOut.gain.value = sfxGain;
  sfxOut.connect(mix);
  const sfxSend = ctx.createGain();
  sfxSend.gain.value = sc.defaults ? SFX_VOL : 1;
  sfxSend.connect(verb);
  for (const [at, fn] of sc.sfx ?? []) fn({ ctx, dest: sfxOut, send: sfxSend, noise, t: at });
  // The heartbeat alone, on its own channels (its margin is measured against the music).
  let heartOut: GainNode | null = null;
  if (sc.heart) {
    heartOut = ctx.createGain();
    const hs = ctx.createChannelSplitter(2);
    heartOut.connect(hs);
    hs.connect(merge, 0, 2);
    hs.connect(merge, 1, 3);
  }
  const cues = [...(sc.cues ?? [])];
  const lubs: number[] = [];
  const offs: number[] = [];
  let lastLub = -Infinity;
  let ticks = 0;
  // The bank renders once per page (live, it is spread over the first seconds): keep it out of the timing.
  while (perf.prefetchNext()) {
    /* build every buffer */
  }
  let busy = 0;
  c.start(0, sc.inputs(0), 2);
  // The fx heartbeat runs on the frame clock (60 Hz); the scheduler every 25 ms.
  const frame = 1 / 60;
  let nextTick = 0;
  for (let t = 0; t < sc.secs; t += frame) {
    while (cues.length > 0 && cues[0]![0] <= t) cues.shift()![1](c, t);
    const inp = sc.inputs(t);
    if (t >= nextTick) {
      const t0 = performance.now();
      c.update(t, inp);
      perf.cleanup(t);
      busy += performance.now() - t0;
      ticks++;
      nextTick += 0.025;
    }
    if (heartOut && sc.heart && t >= sc.heart.from && t < sc.heart.to && inp.boss) {
      const u = inp.heart ?? 0;
      const due = c.heartDue(lastLub, u, t);
      const at = Number.isFinite(due) ? due - 0.008 : lastLub + freeHeartPeriod(u);
      if (t >= at) {
        lastLub = t;
        lubs.push(t + 0.004);
        offs.push(Number.isFinite(due) ? t + 0.004 - due : NaN);
        S.sHeartbeat({ ctx, dest: heartOut, send: null, noise, t: t + 0.004 }, u, HEART_DUB);
        if (!opts.noDip) perf.heartDip(t + 0.004);
      }
    }
  }
  const buf = await ctx.startRendering();
  return {
    l: buf.getChannelData(0),
    r: buf.getChannelData(1),
    hl: sc.heart ? buf.getChannelData(2) : undefined,
    hr: sc.heart ? buf.getChannelData(3) : undefined,
    lubs,
    offs,
    nodes: perf.peakNodes + perf.graphNodes,
    tickMs: busy / Math.max(1, ticks),
    drums: drums / Math.max(0.1, to - sc.from),
  };
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

/** Mean-square per window (both channels summed), hop 100 ms, over [from, to] s. */
function windows(l: Float32Array, r: Float32Array, win: number, from: number, to = Infinity): number[] {
  const n = Math.floor(win * RATE);
  const hop = Math.floor(0.1 * RATE);
  const out: number[] = [];
  const end = Math.min(l.length, Math.floor(to * RATE));
  for (let i = Math.floor(from * RATE); i + n <= end; i += hop) {
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

export function analyze(name: string, x: Render, from: number, to: number, clickBand: number): MusicReport {
  const { l, r } = x;
  const kl = kWeight(l);
  const kr = kWeight(r);
  const mom = windows(kl, kr, 0.4, from, to).map(lufs);
  const st = windows(kl, kr, 3, from, to).map(lufs);
  const bl = band(l);
  const br = band(r);
  const bandMom = windows(bl, br, 0.4, from, to).map(db);
  const all = windows(l, r, 0.4, from, to);
  const bandAll = windows(bl, br, 0.4, from, to);
  let peak = 0;
  const a = Math.floor(from * RATE);
  const b = Math.min(l.length, Math.floor(to * RATE));
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  const bandMedian = median(bandMom);
  return {
    name,
    momentaryMax: Math.max(...mom),
    shortMedian: median(st),
    shortMax: Math.max(...st),
    integrated: integrated(windows(kl, kr, 0.4, from, to)),
    peak: 20 * Math.log10(peak || 1e-9),
    bandMedian,
    bandMax: Math.max(...bandMom),
    clickMargin: clickBand - bandMedian,
    bandShare: bandAll.reduce((p, q) => p + q, 0) / Math.max(1e-12, all.reduce((p, q) => p + q, 0)),
    nodes: x.nodes,
    tickMs: x.tickMs,
    drums: x.drums,
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
    const x = await renderScenario(sc, { layers });
    rows.push(analyze(sc.name, x, sc.from, sc.to ?? sc.secs, click));
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
      'drums/s': x.drums.toFixed(1),
    })),
  );
  console.log(`sword clang, 1-4 kHz momentary: ${f(click)} dBFS`);
  return rows;
}

/** 35-200 Hz: where the SFX heartbeat lives (a lowpassed thump at 44-72 Hz and its overtones). */
function lowBand(x: Float32Array): Float32Array {
  let y = biquad(x, pass('hp', 35, 0.7071));
  y = biquad(y, pass('lp', 200, 0.5412));
  return biquad(y, pass('lp', 200, 1.3066));
}

export interface HeartReport {
  name: string;
  lubs: number;
  /** Heartbeat minus music in 35-200 Hz over each lub's first 250 ms (dB): median and worst tenth. */
  median: number;
  low10: number;
  /** How far each lub landed from the music's beat grid (ms): max. */
  offGridMs: number;
}

/**
 * The boss heartbeat against the boss music, as the fx plays it (locked to the grid, every 2 beats
 * then every beat): its low-band margin with the music's low hits cleared off its beats and the
 * low end dipping under it, and without either (`raw`).
 */
export async function heartMargin(): Promise<HeartReport[]> {
  const sc: Scenario = { name: 'boss heartbeat', secs: 40, from: 8, to: 36.5, inputs: bossFight(5), cues: [[5, (c, t) => c.bossSummon(t)]], heart: { from: 5, to: 37 } };
  const out: HeartReport[] = [];
  for (const [name, opts] of [
    ['heartbeat: cleared beats + low dip', {}],
    ['heartbeat: cleared beats only', { noDip: true }],
    ['heartbeat: raw (neither)', { noClear: true, noDip: true }],
  ] as [string, RenderOpts][]) {
    const x = await renderScenario(sc, opts);
    const ml = lowBand(x.l);
    const mr = lowBand(x.r);
    const hl = lowBand(x.hl!);
    const hr = lowBand(x.hr!);
    const n = Math.floor(0.25 * RATE);
    const margins: number[] = [];
    let off = 0;
    for (let j = 0; j < x.lubs.length; j++) {
      const lub = x.lubs[j]!;
      if (lub < sc.from || lub > sc.to!) continue;
      const i0 = Math.floor(lub * RATE);
      let hs = 0;
      let ms = 0;
      for (let i = i0; i < i0 + n && i < ml.length; i++) {
        hs += hl[i]! * hl[i]! + hr[i]! * hr[i]!;
        ms += ml[i]! * ml[i]! + mr[i]! * mr[i]!;
      }
      margins.push(10 * Math.log10((hs + 1e-12) / (ms + 1e-12)));
      const d = x.offs?.[j];
      if (d !== undefined && Number.isFinite(d)) off = Math.max(off, Math.abs(d) * 1000);
    }
    const sorted = [...margins].sort((a, b) => a - b);
    out.push({ name, lubs: margins.length, median: median(margins), low10: sorted[Math.floor(sorted.length * 0.1)] ?? -120, offGridMs: off });
  }
  console.table(out.map((r) => ({ ...r, median: r.median.toFixed(1), low10: r.low10.toFixed(1), offGridMs: r.offGridMs.toFixed(1) })));
  return out;
}
