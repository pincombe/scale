// Metallic and bell-like recipes: sword clang, footman clanks, weak-spot ping, crit shimmer, coins, chimes.
import { filterNode, gainNode, noiseHit, partial, perc, rand, thump, toSend, type Out } from './kit';

/** Inharmonic plate/blade modes (roughly a free bar), jittered per hit. */
const CLANG_RATIOS = [1, 2.32, 4.25, 6.63] as const;
const CLANG_AMPS = [1, 0.62, 0.45, 0.32] as const;
const CLANG_TAUS = [0.15, 0.1, 0.07, 0.048] as const;

export interface ClangOpts {
  /** Fundamental (Hz): a pentatonic note so rapid clicking sounds tuned, not random. */
  f0: number;
  /** 0..1: opens the low-pass and the transient. */
  bright: number;
  /** Output level multiplier (1 = a normal click). */
  amp: number;
}

/**
 * Sword on dragon hide: four jittered inharmonic sine modes (one doubled and detuned so it beats
 * like real metal) with a tiny downward "ting" glide, through a brightness low-pass; a high-passed
 * noise transient for the edge; and a dull pitch-dropping thump for the hide being hit.
 */
export function clang(o: Out, p: ClangOpts): number {
  const t = o.t;
  const out = gainNode(o, p.amp * 0.17, o.dest);
  toSend(o, out);
  const lp = filterNode(o, 'lowpass', 2400 + 6500 * p.bright, 0.6, out);
  const decay = rand(0.8, 1.3);
  let end = t;
  for (let i = 0; i < CLANG_RATIOS.length; i++) {
    const f = p.f0 * CLANG_RATIOS[i]! * rand(0.965, 1.035);
    if (f > 16000) continue;
    const osc = o.ctx.createOscillator();
    osc.frequency.setValueAtTime(f * 1.012, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = o.ctx.createGain();
    const tau = CLANG_TAUS[i]! * decay;
    const stop = perc(g.gain, t, CLANG_AMPS[i]! * rand(0.7, 1.1), 0.0015, tau);
    osc.connect(g);
    g.connect(lp);
    osc.start(t);
    osc.stop(stop);
    if (stop > end) end = stop;
    // The second mode gets a detuned twin: the slow beating that makes metal shimmer.
    if (i === 1) partial(o, f * rand(1.003, 1.006), CLANG_AMPS[1] * 0.5, t, 0.0015, tau * 1.2, lp);
  }
  noiseHit(o, t, 'highpass', 2200 + 2600 * p.bright, 0.7, 0.7 + 0.6 * p.bright, 0.001, 0.006, out);
  thump(o, t + 0.002, 210, 70, 0.06, 0.9, 0.035, out);
  return end;
}

/**
 * One small footman clank (a sword on a shield in the crowd): two short, high inharmonic modes
 * and a noise tick (the caller low-passes the whole beat). `amp` is per clank; the caller spreads several over ~150 ms.
 */
export function clank(o: Out, at: number, f0: number, amp: number, to: AudioNode): number {
  const g = gainNode(o, amp, to);
  let end = partial(o, f0, 1, at, 0.001, rand(0.035, 0.06), g);
  end = Math.max(end, partial(o, f0 * rand(2.6, 2.9), 0.6, at, 0.001, rand(0.02, 0.035), g));
  noiseHit(o, at, 'bandpass', rand(2500, 4500), 1.2, 0.9, 0.001, 0.004, g);
  return end;
}

/**
 * Weak-spot ping: a glassy sine that chirps up 10% into its note in 15 ms ("pwing"), plus a quiet
 * 2.76× overtone.
 */
export function ping(o: Out, f: number, amp: number): number {
  const t = o.t;
  const out = gainNode(o, amp * 0.16, o.dest);
  toSend(o, out);
  const osc = o.ctx.createOscillator();
  osc.frequency.setValueAtTime(f * 0.9, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.015);
  const g = o.ctx.createGain();
  const end = perc(g.gain, t, 1, 0.002, 0.22);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(end);
  partial(o, f * 2.76, 0.25, t, 0.002, 0.08, out);
  return end;
}

/**
 * Crit shimmer: a sparkle of high pentatonic sines (the first two as detuned pairs that beat), staggered
 * over 150 ms, mostly into the reverb.
 */
export function shimmer(o: Out, notes: readonly number[], amp: number): number {
  const t = o.t;
  const out = gainNode(o, amp * 0.035, o.dest);
  toSend(o, out);
  let end = t;
  for (let i = 0; i < notes.length; i++) {
    const at = t + 0.01 + i * rand(0.018, 0.03);
    const tau = rand(0.14, 0.26);
    const f = notes[i]!;
    end = Math.max(end, partial(o, f, 1, at, 0.004, tau, out));
    if (i < 2) partial(o, f * 1.004 + 2, 0.6, at, 0.004, tau * 0.8, out);
  }
  return end;
}

/**
 * Coin clink: two sines (1, 2.02) with a hard 5 kHz noise tick, then a quieter
 * re-strike 25–45 ms later: the coin bouncing onto the pile.
 */
export function coin(o: Out, f: number, amp: number): number {
  const t = o.t;
  const out = gainNode(o, amp * 0.1, o.dest);
  toSend(o, out);
  let end = t;
  end = partial(o, f, 1, t, 0.001, 0.075, out);
  partial(o, f * 2.02, 0.45, t, 0.001, 0.04, out);
  noiseHit(o, t, 'highpass', 5000, 0.7, 1.8, 0.0005, 0.003, out);
  // The bounce: the fundamental and its octave-ish mode only.
  const b = t + rand(0.025, 0.045);
  const a = rand(0.3, 0.45);
  end = Math.max(end, partial(o, f, a, b, 0.001, 0.06, out));
  partial(o, f * 2.02, a * 0.4, b, 0.001, 0.03, out);
  return end;
}

/**
 * Bell / chime note: church-bell partials (hum 0.5, 1, 2, 2.76) with longer low modes, at an
 * absolute time `at`, into `to` (callers low-pass the bus around 6 kHz).
 */
export function bell(o: Out, f: number, amp: number, at: number, len: number, to: AudioNode): number {
  let end = partial(o, f, amp, at, 0.002, 0.3 * len, to);
  end = Math.max(end, partial(o, f * 0.5, amp * 0.18, at, 0.004, 0.4 * len, to));
  partial(o, f * 2, amp * 0.4, at, 0.002, 0.16 * len, to);
  partial(o, f * 2.76, amp * 0.3, at, 0.001, 0.09 * len, to);
  return end;
}
