// The earth and the air at M2 scale: tremors, stone grinding, the zoom's rise, impact, wind rush
// and deep rumbles, an avalanche, plus the small bright things (a wax seal, a glassy shimmer, a
// wooden clock tick, the title-card chime). Tonal weight (sub-bass swells, choirs) is the music's.
import { pentaHz } from '../sfxMath';
import { bell } from './metal';
import { brownSrc } from './grains';
import { whoosh } from './impact';
import {
  bufferSrc,
  filterNode,
  gainNode,
  lfo,
  noiseHit,
  noiseSrc,
  partial,
  perc,
  rand,
  rubbleBuffer,
  softClip,
  thump,
  toSend,
  type Out,
} from './kit';

/** A tanh stage (harmonics that let a rumble be heard on laptop speakers). */
function saturate(o: Out, drive: number, to: AudioNode): WaveShaperNode {
  const ws = o.ctx.createWaveShaper();
  ws.curve = softClip(drive);
  ws.connect(to);
  return ws;
}

/**
 * The ground trembling after a kill. `g` is the Wyrm Gauge (0..1: the timbre, shake and pebbles),
 * `strength` 0..1 the tremor's strength and `dur` its length (both from render/fx/dread, so the
 * rumble swells and dies with the camera's sway): at first a faint low murmur; near full a
 * shaking, sub-heavy rumble with pebbles rattling and a deep thud. Band-limited below ~200 Hz so
 * it never muddies the fight.
 */
export function tremor(o: Out, at: number, g: number, strength: number, dur: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, 0, to);
  const lvl = amp * (0.1 + 0.9 * strength);
  // Envelope like the sway's: a soft swell over the first 18%, then a long decay.
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(lvl, at + dur * 0.18);
  out.gain.setTargetAtTime(0, at + dur * 0.18, dur * 0.17);
  const end = at + dur + 0.1;
  // The shake: a 6–9 Hz wobble on the rumble's level, deeper when the gauge is high.
  const shake = gainNode(o, 1 - 0.3 * g, out);
  lfo(o, shake.gain, rand(6, 9), 0.3 * g, at, end);
  const hp = filterNode(o, 'highpass', 26, 0.7, shake);
  const sat = saturate(o, 2 + g, hp);
  const drive = gainNode(o, 1.3, sat);
  const lp = filterNode(o, 'lowpass', 70 + 110 * g, 1.1, drive);
  brownSrc(o, at, end - at, lp, 0.7);
  if (g > 0.3) {
    const pg = gainNode(o, 0, out);
    perc(pg.gain, at + 0.08, (g - 0.3) * 0.5, 0.05, dur * 0.18);
    const php = filterNode(o, 'bandpass', 1100, 0.6, pg);
    bufferSrc(o, rubbleBuffer(o.ctx), at + 0.08, dur, php, rand(1.2, 1.6), rand(0, 0.5));
  }
  if (g > 0.55) thump(o, at, 50, 30, 0.3, (g - 0.55) * 1.4, 0.28, hp);
  return end;
}

/**
 * Stone grinding: brown noise through a low band, chopped by a jittery 11–15 Hz square (stone
 * catching on stone) and a slow heave, with rubble scraping, swelling in and out over `dur`.
 */
export function stoneGrind(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const end = at + dur + 0.3;
  const env = gainNode(o, 0, to);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(amp, at + dur * 0.35);
  env.gain.linearRampToValueAtTime(amp * 0.7, at + dur * 0.7);
  env.gain.linearRampToValueAtTime(0, at + dur);
  const chop = gainNode(o, 0.65, env);
  lfo(o, chop.gain, rand(11, 15), 0.3, at, end, 'square');
  lfo(o, chop.gain, rand(0.6, 0.9), 0.2, at, end);
  const bp = filterNode(o, 'bandpass', 210, 1.6, chop);
  bp.frequency.setValueAtTime(170, at);
  bp.frequency.linearRampToValueAtTime(260, at + dur);
  brownSrc(o, at, end - at, bp, 1.8);
  const rg = gainNode(o, 0.9, env);
  const lp = filterNode(o, 'lowpass', 850, 0.7, rg);
  bufferSrc(o, rubbleBuffer(o.ctx), at, dur, lp, 0.5, rand(0, 0.8));
  return end;
}

/**
 * A slow, deep rumble (`dur` s): saturated brown noise under 90 Hz with a heaving 3–4 Hz shake,
 * plus rocks shifting (rubble grains slowed right down).
 */
export function deepRumble(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const end = at + dur + 0.5;
  const env = gainNode(o, 0, to);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(amp, at + Math.min(0.8, dur * 0.35));
  env.gain.setValueAtTime(amp, at + dur * 0.6);
  env.gain.setTargetAtTime(0, at + dur * 0.6, dur * 0.15);
  const shake = gainNode(o, 0.8, env);
  lfo(o, shake.gain, rand(3, 4), 0.2, at, end);
  const hp = filterNode(o, 'highpass', 26, 0.7, shake);
  const sat = saturate(o, 2.5, hp);
  const drive = gainNode(o, 1.4, sat);
  const lp = filterNode(o, 'lowpass', 90, 1.2, drive);
  brownSrc(o, at, end - at, lp, 0.7);
  const rg = gainNode(o, 0.5, env);
  const rlp = filterNode(o, 'lowpass', 800, 0.7, rg);
  bufferSrc(o, rubbleBuffer(o.ctx), at + 0.3, dur, rlp, 0.6, rand(0, 0.5));
  return end;
}

/**
 * The fusion's rise (`dur` s, ends on the flash): noise through a band sweeping 150 Hz → 2.6 kHz
 * and an air band on top, over a rumble climbing out of the ground, all swelling exponentially and
 * cut dead at the end so the impact lands in a hole.
 */
export function riseWhoosh(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const stop = at + dur;
  const end = stop + 0.05;
  const env = gainNode(o, 0, to);
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(amp * 0.15, at + dur * 0.35);
  env.gain.exponentialRampToValueAtTime(amp, stop - 0.02);
  env.gain.linearRampToValueAtTime(0, stop + 0.03);
  const bp = filterNode(o, 'bandpass', 150, 1.4, env);
  bp.frequency.setValueAtTime(150, at);
  bp.frequency.exponentialRampToValueAtTime(2600, stop);
  noiseSrc(o, at, end - at, bp);
  const ag = gainNode(o, 0.3, env);
  const hp = filterNode(o, 'highpass', 1500, 0.7, ag);
  hp.frequency.setValueAtTime(1500, at);
  hp.frequency.exponentialRampToValueAtTime(6000, stop);
  noiseSrc(o, at, end - at, hp);
  const rg = gainNode(o, 1.6, env);
  const lp = filterNode(o, 'lowpass', 90, 1, rg);
  lp.frequency.setValueAtTime(90, at);
  lp.frequency.exponentialRampToValueAtTime(260, stop);
  brownSrc(o, at, end - at, lp);
  return end;
}

/**
 * The flash: a massive transient. A broadband crack, a low noise body, a saturated thud dropping
 * to 30 Hz (fast: the music holds the sub), and the blast rolling away with debris.
 */
export function flashImpact(o: Out, at: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  noiseHit(o, at, 'highpass', 1200, 0.7, 1.3, 0.0005, 0.03, out);
  noiseHit(o, at, 'lowpass', 520, 0.7, 1.7, 0.002, 0.17, out);
  const hp = filterNode(o, 'highpass', 28, 0.7, out);
  const sat = saturate(o, 3, hp);
  let end = thump(o, at, 125, 30, 0.28, 1.25, 0.32, sat);
  const air = gainNode(o, 0, out);
  end = Math.max(end, perc(air.gain, at + 0.01, 0.45, 0.03, 0.55));
  const bp = filterNode(o, 'bandpass', 650, 0.6, air);
  noiseSrc(o, at, end - at, bp);
  const dg = gainNode(o, 0, out);
  perc(dg.gain, at + 0.05, 0.7, 0.02, 0.35);
  const dlp = filterNode(o, 'lowpass', 1600, 0.7, dg);
  bufferSrc(o, rubbleBuffer(o.ctx), at + 0.05, end - at, dlp, 1.1, rand(0, 0.3));
  return end;
}

/**
 * Rising through air (`dur` s): two wind bands, one per side, sweeping up as the camera climbs,
 * gusting, with a thin hiss on top, a few streaks whipping past, and the ground's rumble falling
 * away underneath in the first second.
 */
export function windRush(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const ctx = o.ctx;
  const end = at + dur + 0.6;
  const env = gainNode(o, 0, to);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(amp, at + dur * 0.35);
  env.gain.linearRampToValueAtTime(amp * 0.55, at + dur * 0.85);
  env.gain.setTargetAtTime(0, at + dur * 0.85, dur * 0.12);
  const gust = gainNode(o, 0.75, env);
  lfo(o, gust.gain, rand(0.45, 0.65), 0.18, at, end);
  lfo(o, gust.gain, rand(1.6, 2.1), 0.07, at, end);
  const sides = [-0.55, 0.55] as const;
  for (let k = 0; k < 2; k++) {
    let tail: AudioNode = gust;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = sides[k]!;
      p.connect(gust);
      tail = p;
    }
    const f0 = k === 0 ? 220 : 270;
    const bp = filterNode(o, 'bandpass', f0, 0.9, tail);
    bp.frequency.setValueAtTime(f0, at);
    bp.frequency.exponentialRampToValueAtTime(f0 * (k === 0 ? 7 : 8), at + dur * 0.7);
    bp.frequency.exponentialRampToValueAtTime(f0 * 5, at + dur);
    noiseSrc(o, at, end - at, bp);
  }
  const hg = gainNode(o, 0.14, gust);
  const hp = filterNode(o, 'highpass', 2500, 0.7, hg);
  hp.frequency.setValueAtTime(2500, at);
  hp.frequency.exponentialRampToValueAtTime(6000, at + dur);
  noiseSrc(o, at, end - at, hp);
  // The ground falling away.
  const rg = gainNode(o, 0, to);
  rg.gain.setValueAtTime(amp * 1.2, at);
  rg.gain.setTargetAtTime(0, at + 0.1, 0.35);
  const rlp = filterNode(o, 'lowpass', 120, 0.8, rg);
  brownSrc(o, at, 1.6, rlp);
  // Streaks.
  for (let i = 0; i < 3; i++) {
    const t = at + dur * (0.18 + 0.22 * i) + rand(-0.1, 0.1);
    const dir = i % 2 ? 1 : -1;
    whoosh({ ...o, dest: to }, t, rand(0.35, 0.5), 500, 2300, 600, 2, amp * 0.3, 0.6 * dir, -0.6 * dir);
  }
  return end;
}

/**
 * An avalanche (`dur` s): snow and rock letting go, a roaring low mass building then thinning,
 * the powder's hiss, and rubble tumbling in two streams.
 */
export function avalanche(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const end = at + dur + 0.6;
  const env = gainNode(o, 0, to);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(amp, at + dur * 0.4);
  env.gain.setTargetAtTime(0, at + dur * 0.55, dur * 0.18);
  const lg = gainNode(o, 1.2, env);
  const lp = filterNode(o, 'lowpass', 300, 0.8, lg);
  lp.frequency.setValueAtTime(320, at);
  lp.frequency.linearRampToValueAtTime(160, at + dur);
  brownSrc(o, at, end - at, lp);
  const mg = gainNode(o, 0.2, env);
  const bp = filterNode(o, 'bandpass', 900, 0.5, mg);
  noiseSrc(o, at, end - at, bp);
  const hg = gainNode(o, 0.05, env);
  const hp = filterNode(o, 'highpass', 3200, 0.7, hg);
  noiseSrc(o, at, end - at, hp);
  const rg = gainNode(o, 0.7, env);
  const rlp = filterNode(o, 'lowpass', 1800, 0.7, rg);
  bufferSrc(o, rubbleBuffer(o.ctx), at + 0.1, dur, rlp, 0.8, 0);
  bufferSrc(o, rubbleBuffer(o.ctx), at + 0.4, dur - 0.3, rlp, 0.65, 0.9);
  return end;
}

/**
 * A wax seal pressed: the stamp landing (a small dull thud and a pat of noise) and the wax giving
 * under it (a short band of noise squelching down).
 */
export function waxSeal(o: Out, at: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  let end = thump(o, at, 175, 72, 0.045, 1, 0.045, out);
  noiseHit(o, at, 'lowpass', 750, 0.7, 0.9, 0.001, 0.02, out);
  const sg = gainNode(o, 0, out);
  end = Math.max(end, perc(sg.gain, at + 0.012, 0.8, 0.008, 0.035));
  const bp = filterNode(o, 'bandpass', 1100, 3.5, sg);
  bp.frequency.setValueAtTime(1100, at + 0.012);
  bp.frequency.exponentialRampToValueAtTime(380, at + 0.11);
  noiseSrc(o, at + 0.012, end - at, bp);
  return end;
}

/** Bright bells climbing D6 → A6 (→ D7): the chime after a seal, and the title card's glint. */
export function brightChime(o: Out, at: number, amp: number, three: boolean, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  const lp = filterNode(o, 'lowpass', 7500, 0.5, out);
  let end = bell(o, pentaHz(10), 1, at, 0.9, lp);
  end = Math.max(end, bell(o, pentaHz(13), 0.7, at + 0.11, 1.1, lp));
  if (three) end = Math.max(end, bell(o, pentaHz(15), 0.4, at + 0.22, 1.4, lp));
  return end;
}

/**
 * A glassy, iridescent shimmer: high pentatonic sines (D6–D7) tumbling in, each with a slightly
 * sharp twin so they beat and swirl, over a thin band of air sweeping up.
 */
export function glassShimmer(o: Out, at: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  const lp = filterNode(o, 'lowpass', 9500, 0.5, out);
  const steps = [10, 12, 11, 13, 12, 14, 13, 15] as const;
  let end = at;
  let t = at;
  for (let i = 0; i < steps.length; i++) {
    const f = pentaHz(steps[i]!);
    const tau = rand(0.28, 0.5);
    const a = 1 - i * 0.07;
    end = Math.max(end, partial(o, f, a, t, 0.006, tau, lp));
    partial(o, f * rand(1.004, 1.007) + 1.3, a * 0.6, t, 0.006, tau * 0.9, lp);
    t += rand(0.045, 0.085);
  }
  const ng = gainNode(o, 0, lp);
  const na = at + 0.02;
  end = Math.max(end, na + 0.9);
  ng.gain.setValueAtTime(0, na);
  ng.gain.linearRampToValueAtTime(0.08, na + 0.25);
  ng.gain.linearRampToValueAtTime(0, na + 0.9);
  const bp = filterNode(o, 'bandpass', 3500, 5, ng);
  bp.frequency.setValueAtTime(3500, na);
  bp.frequency.exponentialRampToValueAtTime(9500, na + 0.9);
  noiseSrc(o, na, 0.9, bp);
  return end;
}

/**
 * A wooden clock tick (a hard block: a narrow click over a short triangle knock). `tock` = the
 * lower of the pair (A5 vs D6).
 */
export function woodTick(o: Out, at: number, tock: boolean, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  noiseHit(o, at, 'bandpass', tock ? 1600 : 2400, 4, 1, 0.0005, 0.003, out);
  return partial(o, pentaHz(tock ? 8 : 10), 0.55, at, 0.0008, 0.018, out, 'triangle');
}

/** Route through a moving panner (pan a → b over `dur`); plain `to` where panners don't exist. */
export function panSweep(o: Out, at: number, dur: number, a: number, b: number, to: AudioNode): AudioNode {
  if (typeof o.ctx.createStereoPanner !== 'function') return to;
  const p = o.ctx.createStereoPanner();
  p.pan.setValueAtTime(a, at);
  p.pan.linearRampToValueAtTime(b, at + dur);
  p.connect(to);
  return p;
}

/** A dry-and-wet output stage for a composition: gain → `o.dest`, and into the reverb send. */
export function stage(o: Out, amp: number): GainNode {
  const g = gainNode(o, amp, o.dest);
  toSend(o, g);
  return g;
}
