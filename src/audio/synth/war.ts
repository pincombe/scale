// The army's instruments and its noise: war horns blown across the valley, a ground-shaking drum,
// a snare roll, a crowd's war cry, armored feet, galloping hooves, lance crashes, a brass flourish
// for a champion, and a giant's footfalls. Diegetic only: the music (audio/music) owns the score.
import { pentaHz } from '../sfxMath';
import { clank } from './metal';
import { brass } from './tones';
import { brownSrc, grain, type GrainKind } from './grains';
import {
  bufferSrc,
  crackleBuffer,
  filterNode,
  gainNode,
  lfo,
  noiseHit,
  noiseSrc,
  perc,
  rand,
  rubbleBuffer,
  softClip,
  thump,
  type Out,
} from './kit';

export interface HornNote {
  /** Hz. */
  f: number;
  /** Seconds. */
  dur: number;
}

/**
 * A war horn played as one breath through `notes` (each tongued: a dip in level, a scoop up into
 * pitch, a breathy blat). Three detuned sawtooths through a gentle tanh (the rasp) and a resonant
 * low-pass that opens with the level, the way brass brightens as it gets louder; slow vibrato on
 * held notes. `bright` 0..1: a distant ram's horn (dark) → a close battle horn (blaring).
 */
export function warHorn(o: Out, notes: readonly HornNote[], at: number, amp: number, bright: number, to: AudioNode): number {
  const ctx = o.ctx;
  let total = 0;
  for (const n of notes) total += n.dur;
  const end = at + total + 0.9;
  const env = gainNode(o, 0, to);
  const lp = filterNode(o, 'lowpass', notes[0]!.f * 1.4, 1.5, env);
  const sat = ctx.createWaveShaper();
  sat.curve = softClip(1.5 + bright);
  sat.connect(lp);
  const mix = gainNode(o, 0.34, sat);
  const dets = [0.9955, 1, 1.0062] as const;
  const oscs: OscillatorNode[] = [];
  for (let k = 0; k < dets.length; k++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.connect(mix);
    osc.start(at);
    osc.stop(end);
    oscs.push(osc);
  }
  // One vibrato LFO for all three (depth in Hz from the first note; fades in on held notes).
  const vib = lfo(o, oscs[0]!.frequency, rand(4.6, 5.4), 0, at, end);
  vib.connect(oscs[1]!.frequency);
  vib.connect(oscs[2]!.frequency);
  vib.gain.setValueAtTime(0, at);

  const open = 3 + 5 * bright;
  const hold = 2.2 + 2.6 * bright;
  const attack = 0.16 - 0.1 * bright;
  let tn = at;
  env.gain.setValueAtTime(0, at);
  for (let i = 0; i < notes.length; i++) {
    const { f, dur } = notes[i]!;
    const last = i === notes.length - 1;
    // Tongue: a quick dip between notes (the pitch changes inside it), then the swell.
    const tp = i > 0 ? tn + 0.025 : tn;
    if (i > 0) env.gain.linearRampToValueAtTime(amp * 0.28, tp);
    for (let k = 0; k < oscs.length; k++) {
      const fr = oscs[k]!.frequency;
      fr.setValueAtTime(f * dets[k]! * 0.93, tp);
      fr.exponentialRampToValueAtTime(f * dets[k]! * 1.004, tp + 0.07);
      fr.exponentialRampToValueAtTime(f * dets[k]!, tp + 0.14);
    }
    env.gain.linearRampToValueAtTime(amp, tn + attack + (i > 0 ? 0.03 : 0));
    env.gain.linearRampToValueAtTime(amp * 0.82, tn + Math.max(attack + 0.05, dur * 0.7));
    lp.frequency.setValueAtTime(f * 1.4, tn);
    lp.frequency.linearRampToValueAtTime(f * open, tn + attack);
    lp.frequency.linearRampToValueAtTime(f * hold, tn + Math.max(attack + 0.05, dur * 0.7));
    if (dur > 0.45) {
      vib.gain.setValueAtTime(0, tn + 0.25);
      vib.gain.linearRampToValueAtTime(f * 0.006, tn + Math.min(dur, 0.7));
    }
    noiseHit(o, tn, 'bandpass', f * 5, 1.2, amp * (0.35 + 0.4 * bright), 0.004, 0.035, to);
    tn += dur;
    if (last) {
      env.gain.setTargetAtTime(0, tn, 0.13);
      lp.frequency.setTargetAtTime(f * 1.2, tn, 0.1);
      vib.gain.setValueAtTime(0, tn + 0.2);
    } else {
      env.gain.linearRampToValueAtTime(amp * 0.7, tn);
      vib.gain.setValueAtTime(0, tn);
    }
  }
  return end;
}

/**
 * A single huge drum-like hit on the ground: a saturated 78 → 30 Hz body, a low skin of noise,
 * a slap on top, and a brown-noise boom that rolls away under it.
 */
export function groundHit(o: Out, at: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  const hp = filterNode(o, 'highpass', 28, 0.7, out);
  const sat = o.ctx.createWaveShaper();
  sat.curve = softClip(2.5);
  sat.connect(hp);
  const drive = gainNode(o, 0.9, sat);
  let end = thump(o, at, 78, 30, 0.42, 1, 0.5, drive);
  noiseHit(o, at, 'lowpass', 190, 1.4, 1.1, 0.002, 0.12, drive);
  noiseHit(o, at, 'bandpass', 900, 0.8, 0.5, 0.0008, 0.016, out);
  const tail = gainNode(o, 0, out);
  end = Math.max(end, perc(tail.gain, at, 0.9, 0.02, 0.5));
  const lp = filterNode(o, 'lowpass', 120, 0.8, tail);
  brownSrc(o, at, end - at, lp);
  return end;
}

/** A giant's footfall: a deep thud, a crunch of earth, stones rattling off. */
export function footfall(o: Out, at: number, amp: number, to: AudioNode): number {
  const g = gainNode(o, amp, to);
  let end = thump(o, at, 62, 27, 0.25, 1, 0.24, g);
  noiseHit(o, at, 'lowpass', 340, 0.9, 0.9, 0.003, 0.055, g);
  const rg = gainNode(o, 0, g);
  end = Math.max(end, perc(rg.gain, at + 0.02, 0.5, 0.01, 0.12));
  const lp = filterNode(o, 'lowpass', 1300, 0.7, rg);
  bufferSrc(o, rubbleBuffer(o.ctx), at + 0.02, end - at, lp, rand(1.1, 1.5), rand(0, 0.4));
  return end;
}

/**
 * A martial snare roll: strokes accelerating from ~9/s to ~22/s while they swell, closed by an
 * accent with a bass drum under it.
 */
export function snareRoll(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  const lp = filterNode(o, 'lowpass', 7000, 0.6, out);
  let t = at;
  let i = 0;
  while (t < at + dur) {
    const u = (t - at) / dur;
    const g = gainNode(o, 0.28 + 0.55 * u * u * (i % 2 ? 0.85 : 1), lp);
    grain(o, 'snare', t + rand(-0.004, 0.004), g, rand(0.96, 1.04));
    t += 0.11 - 0.066 * u;
    i++;
  }
  const acc = gainNode(o, 1.25, lp);
  let end = grain(o, 'snare', at + dur, acc, 0.94);
  end = Math.max(end, thump(o, at + dur, 96, 48, 0.1, 1.1, 0.12, out));
  return end;
}

/**
 * A war cry from the ranks, "hraaah": five rough voices (sawtooths at scattered pitches, rising
 * and falling) through the formants of an open "ah", with breath.
 */
export function warCry(o: Out, at: number, dur: number, amp: number, to: AudioNode): number {
  const ctx = o.ctx;
  const end = at + dur + 0.4;
  const env = gainNode(o, 0, to);
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(amp, at + 0.12);
  env.gain.linearRampToValueAtTime(amp * 0.8, at + dur * 0.8);
  env.gain.setTargetAtTime(0, at + dur * 0.8, 0.12);
  const forms = [
    [740, 6, 1],
    [1180, 8, 0.55],
    [2650, 10, 0.25],
  ] as const;
  const mix = gainNode(o, 0.35, null);
  for (const [f, q, g] of forms) {
    const fg = gainNode(o, g, env);
    const bp = filterNode(o, 'bandpass', f * rand(0.95, 1.05), q, fg);
    mix.connect(bp);
  }
  for (let k = 0; k < 5; k++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f = rand(105, 185);
    const t0 = at + rand(0, 0.06);
    osc.frequency.setValueAtTime(f * 0.88, t0);
    osc.frequency.exponentialRampToValueAtTime(f * 1.08, t0 + 0.18);
    osc.frequency.exponentialRampToValueAtTime(f * 0.9, at + dur);
    osc.connect(mix);
    osc.start(t0);
    osc.stop(end);
  }
  noiseSrc(o, at, end - at, gainNode(o, 0.4, mix));
  return end;
}

/**
 * A company of armored men running: footfalls (one grain each) thickening over `dur` at up to
 * `rate` steps/s, the ground rumbling under them, and mail jingling on top. `swell` shapes it:
 * the level climbs from `swell` to 1.
 */
export function armoredRush(o: Out, at: number, dur: number, rate: number, amp: number, swell: number, to: AudioNode): number {
  const end = at + dur + 0.35;
  const out = gainNode(o, 0, to);
  out.gain.setValueAtTime(amp * swell, at);
  out.gain.linearRampToValueAtTime(amp, at + dur * 0.8);
  out.gain.setTargetAtTime(0, at + dur, 0.1);
  const feet = gainNode(o, 0.55, out);
  const n = Math.round(rate * dur * 0.7);
  for (let i = 0; i < n; i++) {
    // More feet as the charge builds (density ramps up).
    const u = Math.sqrt(Math.random());
    grain(o, 'step', at + u * dur, feet, rand(0.72, 1.3));
  }
  const rumble = gainNode(o, 0.55, out);
  const lp = filterNode(o, 'lowpass', 130, 0.9, rumble);
  brownSrc(o, at, end - at, lp);
  const mail = gainNode(o, 0.05, out);
  lfo(o, mail.gain, rand(13, 17), 0.035, at, end, 'square');
  const hp = filterNode(o, 'highpass', 5200, 0.7, mail);
  noiseSrc(o, at, end - at, hp);
  return end;
}

/**
 * Galloping horses: each of `horses` runs a four-beat gallop (hind, hind, fore, fore, then the
 * suspension) at its own stride, all swelling over `dur` as they close in and panning `panA` →
 * `panB` with the charge, over a rising drum of turf.
 */
export function gallop(o: Out, at: number, dur: number, horses: number, amp: number, panA: number, panB: number, to: AudioNode): number {
  const ctx = o.ctx;
  const end = at + dur + 0.3;
  const out = gainNode(o, 0, null);
  out.gain.setValueAtTime(amp * 0.3, at);
  out.gain.linearRampToValueAtTime(amp, at + dur);
  out.gain.setTargetAtTime(0, at + dur + 0.05, 0.08);
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(panA, at);
    p.pan.linearRampToValueAtTime(panB, at + dur);
    p.connect(to);
    out.connect(p);
  } else out.connect(to);
  const beats = [0, 0.058, 0.142, 0.196] as const;
  const kinds: readonly GrainKind[] = ['hoof', 'hoof', 'hoofHard', 'hoofHard'];
  const hg = gainNode(o, 0.7 / Math.sqrt(horses), out);
  for (let h = 0; h < horses; h++) {
    const stride = rand(0.33, 0.38);
    const pitch = rand(0.88, 1.12);
    let s = at - rand(0, stride);
    while (s < at + dur + 0.1) {
      for (let b = 0; b < beats.length; b++) {
        const bt = s + beats[b]! * (stride / 0.355) + rand(-0.006, 0.006);
        if (bt < at || bt > at + dur + 0.12) continue;
        grain(o, kinds[b]!, bt, hg, pitch * rand(0.97, 1.03));
      }
      s += stride;
    }
  }
  const rumble = gainNode(o, 0.35 * Math.sqrt(horses), out);
  const lp = filterNode(o, 'lowpass', 150, 0.8, rumble);
  brownSrc(o, at, end - at, lp);
  return end;
}

/**
 * A lance crash: wood splintering (dense crackle, band-passed), a sharp crack, an iron clank, and
 * a heavy thump of horse and rider hitting home. `n` crashes (a wider charge) stagger ~50 ms apart.
 */
export function lanceCrash(o: Out, at: number, n: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  let end = at;
  for (let i = 0; i < n; i++) {
    const t = at + i * rand(0.04, 0.07);
    const a = i === 0 ? 1 : 0.6;
    const sg = gainNode(o, 0, out);
    end = Math.max(end, perc(sg.gain, t, 1.5 * a, 0.002, 0.08));
    const bp = filterNode(o, 'bandpass', rand(2200, 3000), 0.9, sg);
    bufferSrc(o, crackleBuffer(o.ctx), t, end - t, bp, rand(1.8, 2.3), rand(0, 1.5));
    noiseHit(o, t, 'highpass', 1500, 0.7, 1.1 * a, 0.0006, 0.012, out);
    noiseHit(o, t, 'bandpass', rand(520, 680), 1.4, 0.8 * a, 0.001, 0.045, out);
    end = Math.max(end, thump(o, t, 130, 42, 0.12, 1.05 * a, 0.17, out));
    if (i === 0) end = Math.max(end, clank(o, t + 0.004, pentaHz(1) * rand(0.99, 1.01), 0.55, out));
  }
  return end;
}

/**
 * A champion's heraldic flourish in D: a quick D-F#-A pickup, then D5 held over A and F# with a
 * timpani stroke under it (proud, short).
 */
export function flourish(o: Out, at: number, amp: number, to: AudioNode): number {
  const out = gainNode(o, amp, to);
  const d = 0.085;
  brass(o, pentaHz(0), at, d * 0.75, 0.9, out);
  brass(o, pentaHz(2), at + d, d * 0.75, 0.9, out);
  brass(o, pentaHz(3), at + d * 2, d * 0.75, 0.95, out);
  const hold = at + d * 3;
  let end = brass(o, pentaHz(5), hold, 0.62, 1.1, out);
  end = Math.max(end, brass(o, pentaHz(3), hold + 0.012, 0.62, 0.62, out));
  end = Math.max(end, brass(o, pentaHz(2), hold + 0.024, 0.62, 0.48, out));
  const drum = gainNode(o, 12, out);
  thump(o, hold, 98, 73, 0.12, 1, 0.2, drum); // ~D2 timpani
  noiseHit(o, hold, 'lowpass', 420, 0.7, 0.7, 0.002, 0.05, drum);
  return end;
}
