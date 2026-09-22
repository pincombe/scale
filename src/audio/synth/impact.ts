// Noise-and-body recipes: booms, whooshes, bow twangs, arrow thuds, knight landings, purchase chunk,
// fire breath, inhale, rubble and embers.
import { expLerp } from '../sfxMath';
import {
  ahr,
  bufferSrc,
  crackleBuffer,
  filterNode,
  gainNode,
  lfo,
  noiseHit,
  noiseSrc,
  partial,
  perc,
  rand,
  rubbleBuffer,
  thump,
  toSend,
  type Out,
} from './kit';

/** Crit boom: a sine kick sweeping 120 → 38 Hz with a low-passed noise punch (8 ms late, so its
 * peak doesn't stack on the clang's transient). */
export function boom(o: Out, amp: number): number {
  const t = o.t + 0.008;
  const out = gainNode(o, amp * 0.55, o.dest);
  toSend(o, out);
  const end = thump(o, t, rand(110, 130), 38, 0.4, 1, 0.2, out);
  noiseHit(o, t, 'lowpass', 260, 0.8, 1.6, 0.002, 0.07, out);
  return end;
}

/**
 * Whoosh: looping noise through a resonant band-pass that sweeps f1 → f2 → f3 while the level
 * swells and fades, optionally panned across the stage (pan1 → pan2) as it moves.
 */
export function whoosh(
  o: Out,
  at: number,
  dur: number,
  f1: number,
  f2: number,
  f3: number,
  q: number,
  amp: number,
  pan1: number,
  pan2: number,
): number {
  const ctx = o.ctx;
  const g = ctx.createGain();
  let tail: AudioNode = g;
  if ((pan1 !== 0 || pan2 !== 0) && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan1, at);
    p.pan.linearRampToValueAtTime(pan2, at + dur);
    g.connect(p);
    tail = p;
  }
  tail.connect(o.dest);
  toSend(o, tail);
  const peakAt = at + dur * 0.45;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(amp, peakAt);
  g.gain.setTargetAtTime(0, peakAt, dur * 0.18);
  const bp = filterNode(o, 'bandpass', f1, q, g);
  bp.frequency.setValueAtTime(f1, at);
  bp.frequency.exponentialRampToValueAtTime(f2, peakAt);
  bp.frequency.exponentialRampToValueAtTime(f3, at + dur);
  const end = at + dur * 1.35;
  noiseSrc(o, at, end - at, bp);
  return end;
}

/**
 * Bow twang: a sawtooth string that bends down 8% into pitch through a low-pass that snaps shut
 * (3 kHz → 400 Hz in 120 ms), plus a string-slap click.
 */
export function twang(o: Out, at: number, f: number, amp: number, to: AudioNode): number {
  const ctx = o.ctx;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f * 1.08, at);
  osc.frequency.exponentialRampToValueAtTime(f, at + 0.04);
  const lp = filterNode(o, 'lowpass', 3000, 4, null);
  lp.frequency.setValueAtTime(rand(2600, 3600), at);
  lp.frequency.exponentialRampToValueAtTime(400, at + 0.12);
  const g = gainNode(o, 0, to);
  const end = perc(g.gain, at, amp, 0.002, 0.06);
  osc.connect(lp);
  lp.connect(g);
  osc.start(at);
  osc.stop(end);
  noiseHit(o, at, 'bandpass', 3200, 1.5, amp * 0.9, 0.0005, 0.004, to);
  return end;
}

/** Arrow impact: a woody "thk" (band-passed click) over a small low thump. */
export function arrowThud(o: Out, at: number, amp: number, to: AudioNode): number {
  noiseHit(o, at, 'bandpass', rand(1200, 1900), 2, amp * 1.4, 0.0008, 0.008, to);
  return thump(o, at, rand(170, 210), 65, 0.05, amp, 0.035, to);
}

/** Knight landing after a tail swipe: a comic "bonk" (bouncy low sine) with a little armor rattle. */
export function knightLand(o: Out, at: number, amp: number, to: AudioNode): number {
  const f = rand(150, 230);
  // Bounce: drops, rebounds up a little, drops again.
  const osc = o.ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(f * 1.6, at);
  osc.frequency.exponentialRampToValueAtTime(f * 0.6, at + 0.07);
  osc.frequency.exponentialRampToValueAtTime(f * 0.9, at + 0.11);
  osc.frequency.exponentialRampToValueAtTime(f * 0.5, at + 0.2);
  const g = gainNode(o, 0, to);
  const end = perc(g.gain, at, amp, 0.003, 0.06);
  osc.connect(g);
  osc.start(at);
  osc.stop(end);
  noiseHit(o, at, 'lowpass', 700, 0.7, amp * 1.2, 0.002, 0.025, to);
  // Armor rattle: three tiny ticks.
  for (let i = 0; i < 3; i++) {
    const rt = at + 0.03 + i * rand(0.025, 0.045);
    partial(o, rand(2400, 3800), amp * 0.18 * (1 - i * 0.25), rt, 0.001, 0.018, to);
  }
  return end;
}

/**
 * Purchase "ka-chunk": a latch click, then 35 ms later a heavy low thump with a short band of
 * low-mid noise (a strongbox lid dropping).
 */
export function chunk(o: Out, at: number, amp: number, to: AudioNode): number {
  noiseHit(o, at, 'bandpass', rand(2200, 3000), 2.5, amp * 1.6, 0.0005, 0.006, to);
  const t2 = at + 0.035;
  noiseHit(o, t2, 'bandpass', rand(500, 700), 1.2, amp * 1.8, 0.001, 0.03, to);
  return thump(o, t2, 150, 55, 0.08, amp * 1.2, 0.05, to);
}

/**
 * Fire breath (1.5 s at size 0..1): a band-passed roar sweeping up then settling, a darker
 * half-speed noise rumble, crackle through a high-pass, and a 9–13 Hz flutter on the level.
 * Small dragons get a thin comic "pfff"; big ones a furnace.
 */
export function fireBreath(o: Out, dur: number, size: number, amp: number): number {
  const t = o.t;
  const end = t + dur + 0.6;
  const out = gainNode(o, 0, o.dest);
  toSend(o, out);
  // Level envelope (attack, hold, release).
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(amp * 0.5, t + 0.1);
  out.gain.setValueAtTime(amp * 0.5, t + dur - 0.2);
  out.gain.setTargetAtTime(0, t + dur - 0.2, 0.12);
  // Flame flutter.
  const flutter = gainNode(o, 1, out);
  lfo(o, flutter.gain, rand(9, 13), 0.22, t, end);

  const sc = expLerp(1.7, 0.5, size);
  const bp = filterNode(o, 'bandpass', 700 * sc, 0.7, flutter);
  bp.frequency.setValueAtTime(600 * sc, t);
  bp.frequency.exponentialRampToValueAtTime(1400 * sc, t + 0.3);
  bp.frequency.exponentialRampToValueAtTime(900 * sc, t + dur * 0.7);
  bp.frequency.exponentialRampToValueAtTime(500 * sc, t + dur);
  noiseSrc(o, t, end - t, bp);

  const rumbleG = gainNode(o, 0.3 + 1.6 * size, flutter);
  const lp = filterNode(o, 'lowpass', 220 * Math.sqrt(sc), 0.9, rumbleG);
  noiseSrc(o, t, end - t, lp, 0.5);

  const crG = gainNode(o, 0.9, out);
  const hp = filterNode(o, 'highpass', 1500, 0.7, crG);
  bufferSrc(o, crackleBuffer(o.ctx), t, end - t, hp, rand(0.9, 1.2), rand(0, 1));
  return end;
}

/**
 * Inhale before fire: band-passed noise sweeping 300 Hz → 2.2 kHz (scaled by size) while it swells,
 * cut off sharply at the end: the dragon drawing breath.
 */
export function inhale(o: Out, dur: number, size: number, amp: number): number {
  const t = o.t;
  const sc = expLerp(1.8, 0.55, size);
  const g = gainNode(o, 0, o.dest);
  toSend(o, g);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp * 0.12, t + dur * 0.3);
  g.gain.linearRampToValueAtTime(amp * 0.55, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const bp = filterNode(o, 'bandpass', 300 * sc, 1.3, g);
  bp.frequency.setValueAtTime(300 * sc, t);
  bp.frequency.exponentialRampToValueAtTime(2200 * sc, t + dur);
  noiseSrc(o, t, dur + 0.02, bp);
  // A second, narrower band a fifth up gives the throat some tone.
  const bp2 = filterNode(o, 'bandpass', 450 * sc, 6, g);
  bp2.frequency.setValueAtTime(450 * sc, t);
  bp2.frequency.exponentialRampToValueAtTime(3300 * sc, t + dur);
  noiseSrc(o, t, dur + 0.02, bp2);
  return t + dur + 0.05;
}

/** Corpse crumbling: the rubble grain buffer through a low-pass, over a sub rumble. */
export function crumble(o: Out, at: number, size: number, amp: number): number {
  const out = gainNode(o, amp * 0.5, o.dest);
  toSend(o, out);
  const lp = filterNode(o, 'lowpass', expLerp(2600, 900, size), 0.7, out);
  bufferSrc(o, rubbleBuffer(o.ctx), at, 1.75, lp, rand(0.85, 1.15) * expLerp(1.25, 0.8, size));
  thump(o, at, expLerp(90, 55, size), 34, 0.6, 0.5 + 0.4 * size, 0.35, out);
  return at + 1.8;
}

/** Ember hiss: high-passed noise swelling then dying away, sprinkled with fine crackle. */
export function emberHiss(o: Out, at: number, amp: number): number {
  const g = gainNode(o, 0, o.dest);
  toSend(o, g);
  ahr(g.gain, at, amp * 0.1, 0.45, 0.2, 0.45);
  const hp = filterNode(o, 'highpass', 4200, 0.6, g);
  const dur = 0.65 + 0.45 * 4.5;
  noiseSrc(o, at, dur, hp);
  const cg = gainNode(o, 0, o.dest);
  ahr(cg.gain, at, amp * 0.3, 0.3, 0.4, 0.35);
  const chp = filterNode(o, 'highpass', 2500, 0.6, cg);
  bufferSrc(o, crackleBuffer(o.ctx), at, dur, chp, 1.4, rand(0, 1));
  return at + dur;
}
