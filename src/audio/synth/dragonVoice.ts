// Dragon vocals: one source-filter voice whose pitch, formants, growl and grit scale with the
// dragon's size (0 = newt squeak, 1 = barn-sized rumble), driven by a few call shapes.
import { expLerp } from '../sfxMath';
import { filterNode, gainNode, lfo, noiseSrc, rand, softClip, toSend, type Out } from './kit';

export type VocalKind = 'yelp' | 'chirp' | 'call' | 'growl' | 'death';

interface Shape {
  dur: number;
  /** Pitch multipliers at evenly spaced points over `dur`. */
  pitch: readonly number[];
  /** Level (0..1) at the same points (first is the attack target, reached in `attack`). */
  amp: readonly number[];
  attack: number;
  /** 0..1 amplitude-modulation growl. */
  rough: number;
  /** 0..1 breath noise. */
  breath: number;
}

function shapeFor(kind: VocalKind, s: number): Shape {
  const big = s;
  switch (kind) {
    case 'yelp': {
      // "Yip!" for newts, a pained snarl for big ones.
      const up = rand(1.25, 1.5);
      return {
        dur: expLerp(0.16, 0.5, big) * rand(0.85, 1.15),
        pitch: [1, up, up * 0.9, 0.75],
        amp: [1, 0.9, 0.5, 0],
        attack: 0.01,
        rough: 0.15 + 0.6 * big,
        breath: 0.15 + 0.35 * big,
      };
    }
    case 'chirp': {
      // Idle: newts chirp (quick up-sweep), big dragons snort.
      const up = rand(1.3, 1.8);
      return {
        dur: expLerp(0.09, 0.45, big) * rand(0.8, 1.2),
        pitch: big < 0.5 ? [1, up, up * 1.05] : [1, 0.92, 0.8],
        amp: [1, 0.7, 0],
        attack: 0.008,
        rough: 0.1 + 0.5 * big,
        breath: big < 0.5 ? 0.1 : 0.9,
      };
    }
    case 'call':
      // Arrival: an inquisitive two-part call, rising.
      return {
        dur: expLerp(0.35, 1.1, big) * rand(0.9, 1.1),
        pitch: [0.85, 1.1, 0.95, 1.25, 1.1],
        amp: [0.7, 1, 0.6, 1, 0],
        attack: 0.03,
        rough: 0.1 + 0.55 * big,
        breath: 0.2 + 0.3 * big,
      };
    case 'growl':
      // Tail-swipe wind-up: a low rising snarl.
      return {
        dur: expLerp(0.6, 1.1, big),
        pitch: [0.62, 0.66, 0.72, 0.85, 0.95],
        amp: [0.35, 0.6, 0.8, 1, 0],
        attack: 0.08,
        rough: 0.55 + 0.4 * big,
        breath: 0.4 + 0.4 * big,
      };
    case 'death':
      // A long descending roar that runs out of air.
      return {
        dur: expLerp(0.9, 1.6, big),
        pitch: [1.1, 1.2, 0.95, 0.7, 0.5, 0.38],
        amp: [0.8, 1, 0.85, 0.6, 0.3, 0],
        attack: 0.05,
        rough: 0.4 + 0.5 * big,
        breath: 0.35 + 0.4 * big,
      };
  }
}

const FORMANTS = [700, 1150, 2500] as const;
const FORMANT_Q = [5, 7, 9] as const;
const FORMANT_G = [1, 0.7, 0.35] as const;

/**
 * Source-filter dragon voice. A sawtooth (plus a sub-octave sine for big dragons) with vibrato
 * follows the shape's pitch contour; three band-pass formants (scaled from ×2 for a newt to ×0.42
 * for a barn-dragon) and a low-pass body shape it; breath noise joins through the first formant; a
 * 22–40 Hz amplitude growl and a tanh soft-clip add grit as the dragon grows.
 */
export function dragonVocal(o: Out, kind: VocalKind, size: number, amp: number): number {
  const ctx = o.ctx;
  const t = o.t;
  const sh = shapeFor(kind, size);
  const f0 = expLerp(1250, 62, size) * rand(0.93, 1.07);
  const fs = expLerp(2.0, 0.42, size) * rand(0.95, 1.05);
  const dur = sh.dur;
  const end = t + dur + 0.08;
  const n = sh.pitch.length;
  const step = dur / (n - 1);

  // Output: level env → out → dest (+ reverb).
  // Level: big voices carry far more energy (sub, grit), so they are trimmed to sit ~4 dB above a
  // newt instead of ~12. A 30 Hz high-pass keeps sub-sonics and DC out of the limiter.
  const out = gainNode(o, amp * 0.55 * (1 - 0.5 * size * size), o.dest);
  toSend(o, out);
  const hp = filterNode(o, 'highpass', 30, 0.7, out);
  const env = gainNode(o, 0, hp);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(sh.amp[0]!, t + sh.attack);
  for (let i = 1; i < n; i++) env.gain.linearRampToValueAtTime(sh.amp[i]!, t + i * step);

  // Growl AM.
  const am = gainNode(o, 1 - sh.rough * 0.5, env);
  lfo(o, am.gain, expLerp(40, 22, size) * rand(0.9, 1.1), sh.rough * 0.5, t, end);

  // Grit.
  let sum: AudioNode = am;
  if (size > 0.35) {
    const ws = ctx.createWaveShaper();
    ws.curve = softClip(1 + 3 * size);
    ws.connect(am);
    sum = ws;
  }
  const mix = gainNode(o, 1, sum);

  // Source.
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0 * sh.pitch[0]!, t);
  for (let i = 1; i < n; i++) src.frequency.exponentialRampToValueAtTime(f0 * sh.pitch[i]!, t + i * step);
  lfo(o, src.frequency, rand(5, 8), f0 * 0.025, t, end);
  src.start(t);
  src.stop(end);

  // Formants (they glide a little with the pitch, like a mouth opening).
  for (let k = 0; k < FORMANTS.length; k++) {
    const g = gainNode(o, FORMANT_G[k]!, mix);
    const bp = filterNode(o, 'bandpass', FORMANTS[k]! * fs, FORMANT_Q[k]!, g);
    bp.frequency.setValueAtTime(FORMANTS[k]! * fs * Math.sqrt(sh.pitch[0]!), t);
    for (let i = 1; i < n; i++) {
      bp.frequency.exponentialRampToValueAtTime(FORMANTS[k]! * fs * Math.sqrt(sh.pitch[i]!), t + i * step);
    }
    src.connect(bp);
  }
  // Body: the raw source, low-passed.
  const bodyG = gainNode(o, 0.12, mix);
  const body = filterNode(o, 'lowpass', f0 * 4, 0.7, bodyG);
  src.connect(body);

  // Sub-octave for big dragons: the chest.
  if (size > 0.4) {
    const sub = ctx.createOscillator();
    const subHz = (p: number): number => Math.max(38, f0 * 0.5 * p);
    sub.frequency.setValueAtTime(subHz(sh.pitch[0]!), t);
    for (let i = 1; i < n; i++) sub.frequency.exponentialRampToValueAtTime(subHz(sh.pitch[i]!), t + i * step);
    const sg = gainNode(o, (size - 0.4) * 1.1, mix);
    sub.connect(sg);
    sub.start(t);
    sub.stop(end);
  }

  // Breath.
  if (sh.breath > 0) {
    const bg = gainNode(o, sh.breath * 0.8, mix);
    const bp = filterNode(o, 'bandpass', FORMANTS[0] * fs * 1.6, 0.9, bg);
    noiseSrc(o, t, end - t, bp);
  }
  return end;
}

/**
 * Stagger: a dizzy cartoon wobble. Two sines a fifth apart slide down an octave while a 6–8 Hz
 * vibrato swings them ±12% (the "birdies circling" sound), with a slow tremolo.
 */
export function dizzy(o: Out, amp: number): number {
  const t = o.t;
  const dur = 1.2;
  const end = t + dur + 0.1;
  const out = gainNode(o, amp * 0.1, o.dest);
  toSend(o, out);
  const env = gainNode(o, 0, out);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + 0.04);
  env.gain.setValueAtTime(1, t + dur * 0.55);
  env.gain.linearRampToValueAtTime(0, t + dur);
  const trem = gainNode(o, 0.8, env);
  lfo(o, trem.gain, 3.2, 0.2, t, end);
  const base = rand(620, 760);
  const voices = [1, 1.5] as const;
  for (let i = 0; i < voices.length; i++) {
    const osc = o.ctx.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    const f = base * voices[i]!;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.5, t + dur);
    lfo(o, osc.frequency, i === 0 ? 7 : 6.1, f * 0.12, t, end);
    const g = gainNode(o, i === 0 ? 1 : 0.35, trem);
    osc.connect(g);
    osc.start(t);
    osc.stop(end);
  }
  return end;
}
