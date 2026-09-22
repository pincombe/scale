// Dev-only SFX meter (not imported by the game, so it never ships). Renders every sound in an
// OfflineAudioContext and reports peak, RMS, K-weighted short-term loudness, length, DC and NaNs.
// In the dev server console:  (await import('/src/audio/sfxMeasure.ts')).measureSfx()
import type { Out } from './synth/kit';
import * as S from './sfxSounds';
import { startWind } from './synth/ambience';

export interface SfxMeter {
  name: string;
  /** dBFS, worst of the runs. */
  peak: number;
  /** Max RMS over 50 ms windows, dBFS (mean of runs). */
  rms50: number;
  /** Max K-weighted RMS over 400 ms windows (≈ short-term LUFS), mean of runs. */
  lufs: number;
  /** Seconds until the sound stays below -60 dBFS. */
  len: number;
  /** Mean sample value over the active region. */
  dc: number;
  nans: number;
  /** Audio nodes the sound creates (max of the runs). */
  nodes: number;
}

interface Def {
  name: string;
  secs: number;
  play: (o: Out) => number;
}

const DEFS: Def[] = [
  { name: 'strike clang', secs: 1.5, play: S.sStrike },
  { name: 'crit', secs: 3, play: S.sCrit },
  { name: 'crit layers', secs: 3, play: S.sCritLayers },
  { name: 'ping (degraded)', secs: 2, play: S.sPing },
  { name: 'choke', secs: 0.6, play: (o) => S.sChoke(o, 0.5) },
  { name: 'melee x1', secs: 1, play: (o) => S.sMelee(o, 1) },
  { name: 'melee x8', secs: 1, play: (o) => S.sMelee(o, 8) },
  { name: 'melee x24', secs: 1, play: (o) => S.sMelee(o, 24) },
  { name: 'volley x5', secs: 2, play: (o) => S.sVolley(o, 5, 1.1, 0, 0.5) },
  { name: 'volley x30', secs: 2, play: (o) => S.sVolley(o, 30, 1.1, 0, 0.5) },
  { name: 'arrow hits x5', secs: 1, play: (o) => S.sArrowHits(o, 5) },
  { name: 'arrow hits x40', secs: 1, play: (o) => S.sArrowHits(o, 40) },
  { name: 'yelp newt', secs: 1, play: (o) => S.sYelp(o, 0) },
  { name: 'yelp horse', secs: 1.2, play: (o) => S.sYelp(o, 0.6) },
  { name: 'yelp barn', secs: 1.2, play: (o) => S.sYelp(o, 1) },
  { name: 'chirp newt', secs: 1, play: (o) => S.sChirp(o, 0) },
  { name: 'snort barn', secs: 1, play: (o) => S.sChirp(o, 1) },
  { name: 'call newt', secs: 1.5, play: (o) => S.sCall(o, 0) },
  { name: 'call barn', secs: 2, play: (o) => S.sCall(o, 1) },
  { name: 'inhale newt', secs: 1.6, play: (o) => S.sInhale(o, 0, 1.2) },
  { name: 'inhale barn', secs: 1.8, play: (o) => S.sInhale(o, 1, 1.2) },
  { name: 'growl newt', secs: 1.5, play: (o) => S.sGrowl(o, 0) },
  { name: 'growl barn', secs: 1.8, play: (o) => S.sGrowl(o, 1) },
  { name: 'fire newt', secs: 2.6, play: (o) => S.sBreath(o, 0, 1.5) },
  { name: 'fire barn', secs: 2.6, play: (o) => S.sBreath(o, 1, 1.5) },
  { name: 'swipe newt', secs: 2, play: (o) => S.sSwipe(o, 0, 3, 0) },
  { name: 'swipe barn', secs: 2, play: (o) => S.sSwipe(o, 1, 6, 0) },
  { name: 'stagger', secs: 1.6, play: S.sStagger },
  { name: 'death newt', secs: 3.5, play: (o) => S.sDeath(o, 0) },
  { name: 'death barn', secs: 3.5, play: (o) => S.sDeath(o, 1) },
  { name: 'coin (low)', secs: 1, play: (o) => S.sCoin(o, 5) },
  { name: 'coin (high)', secs: 1, play: (o) => S.sCoin(o, 15) },
  { name: 'bonus chime', secs: 2.5, play: S.sBonus },
  { name: 'purchase', secs: 2.5, play: (o) => S.sPurchase(o, false) },
  { name: 'upgrade', secs: 2.5, play: (o) => S.sPurchase(o, true) },
  { name: 'unlock arp', secs: 2, play: S.sUnlock },
  { name: 'fanfare', secs: 2.5, play: S.sMilestone },
  { name: 'ui hover', secs: 0.5, play: S.sUiHover },
  { name: 'ui click', secs: 0.5, play: S.sUiClick },
  { name: 'ui deny', secs: 0.8, play: S.sUiDeny },
  { name: 'bird', secs: 2, play: S.sBird },
  {
    name: 'wind bed (8 s)',
    secs: 12,
    play: (o) => {
      startWind(o.ctx, o.dest, 0);
      return 12;
    },
  },
];

const RATE = 48000;

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
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

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -120);

function windowMaxRms(d: Float32Array, win: number, from: number): number {
  let best = 0;
  const hop = Math.max(1, Math.floor(win / 4));
  for (let i = from; i + win <= d.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += d[j]! * d[j]!;
    const r = Math.sqrt(s / win);
    if (r > best) best = r;
  }
  return best;
}

async function renderOnce(def: Def): Promise<Omit<SfxMeter, 'name'>> {
  const len = Math.ceil(def.secs * RATE);
  const ctx = new OfflineAudioContext(2, len, RATE);
  const merger = ctx.createChannelMerger(2);
  merger.connect(ctx.destination);
  const sum = ctx.createGain();
  sum.channelCount = 1;
  sum.channelCountMode = 'explicit';
  sum.connect(merger, 0, 0);
  // K-weighting (ITU-R BS.1770): high-shelf +4 dB around 1.7 kHz, high-pass at 38 Hz.
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1681;
  shelf.gain.value = 4;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  sum.connect(shelf);
  shelf.connect(hp);
  hp.connect(merger, 0, 1);
  let nodes = 0;
  const c = ctx as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of ['createGain', 'createOscillator', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner', 'createWaveShaper']) {
    const orig = c[name]!;
    c[name] = (...args: unknown[]) => {
      nodes++;
      return orig.apply(ctx, args);
    };
  }
  const noise = makeNoise(ctx);
  def.play({ ctx, dest: sum, send: null, noise, t: 0.01 });
  const buf = await ctx.startRendering();
  const raw = buf.getChannelData(0);
  const kw = buf.getChannelData(1);
  let peak = 0;
  let nans = 0;
  let last = 0;
  let first = -1;
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i]!;
    if (!Number.isFinite(x)) {
      nans++;
      continue;
    }
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (a > 0.001) {
      last = i;
      if (first < 0) first = i;
    }
  }
  let dc = 0;
  if (first >= 0) {
    for (let i = first; i <= last; i++) dc += raw[i]!;
    dc /= last - first + 1;
  }
  const isBed = def.name.startsWith('wind');
  const from = isBed ? Math.floor(4 * RATE) : 0; // skip the bed's fade-in
  return {
    peak: db(peak),
    rms50: db(windowMaxRms(raw, Math.floor(0.05 * RATE), from)),
    lufs: db(windowMaxRms(kw, Math.floor(0.4 * RATE), from)) - 0.691,
    len: (last + 1) / RATE,
    dc,
    nans,
    nodes,
  };
}

/** Render every sound `runs` times; logs a table and returns the rows. */
export async function measureSfx(runs = 3): Promise<SfxMeter[]> {
  const rows: SfxMeter[] = [];
  for (const def of DEFS) {
    const r: SfxMeter = { name: def.name, peak: -120, rms50: 0, lufs: 0, len: 0, dc: 0, nans: 0, nodes: 0 };
    for (let k = 0; k < runs; k++) {
      const m = await renderOnce(def);
      r.peak = Math.max(r.peak, m.peak);
      r.rms50 += m.rms50 / runs;
      r.lufs += m.lufs / runs;
      r.len = Math.max(r.len, m.len);
      r.dc = Math.abs(m.dc) > Math.abs(r.dc) ? m.dc : r.dc;
      r.nans += m.nans;
      r.nodes = Math.max(r.nodes, m.nodes);
    }
    rows.push(r);
  }
  console.table(
    rows.map((r) => ({
      name: r.name,
      peak: r.peak.toFixed(1),
      rms50: r.rms50.toFixed(1),
      lufs: r.lufs.toFixed(1),
      len: r.len.toFixed(2),
      dc: r.dc.toExponential(1),
      nans: r.nans,
      nodes: r.nodes,
    })),
  );
  return rows;
}
