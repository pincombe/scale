// Tuned recipes: purchase, unlock arpeggio, milestone fanfare, stagger bonus chime, UI ticks, birds.
import { pentaHz } from '../sfxMath';
import { bell, clank } from './metal';
import { chunk } from './impact';
import { filterNode, gainNode, lfo, noiseHit, partial, perc, pick, rand, thump, toSend, type Out } from './kit';

/**
 * Purchase: the "ka-chunk" then a two-note bell chime (pentatonic `step` and the note 2–3 steps up;
 * upgrades add a third). The caller climbs `step` during a buying spree.
 */
export function purchase(o: Out, grand: boolean, step: number): number {
  const t = o.t;
  const out = gainNode(o, 0.2, o.dest);
  chunk(o, t, 1, out);
  const bells = gainNode(o, grand ? 0.62 : 0.5, out);
  toSend(o, bells);
  const s = step;
  let end = bell(o, pentaHz(s), 1, t + 0.05, 0.9, bells);
  end = Math.max(end, bell(o, pentaHz(s + (grand ? 3 : 2)), 0.7, t + (grand ? 0.13 : 0.11), 1, bells));
  if (grand) end = Math.max(end, bell(o, pentaHz(s + 5), 0.5, t + 0.21, 1.1, bells));
  return end;
}

/**
 * Unlock: a quick rising pentatonic arpeggio (5 notes, 70 ms apart) of plucked tones (triangle +
 * octave sine through a closing low-pass), the last note ringing into the reverb.
 */
export function arpeggio(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.15, o.dest);
  toSend(o, out);
  const start = pick([5, 7, 8]);
  const steps = pick([
    [0, 2, 3, 5, 7],
    [0, 1, 3, 5, 8],
    [0, 2, 4, 5, 7],
  ] as const);
  let end = t;
  for (let i = 0; i < steps.length; i++) {
    const at = t + i * 0.07;
    const f = pentaHz(start + steps[i]!);
    const last = i === steps.length - 1;
    const lp = filterNode(o, 'lowpass', f * 6, 0.8, out);
    lp.frequency.setValueAtTime(f * 8, at);
    lp.frequency.exponentialRampToValueAtTime(f * 2, at + 0.3);
    end = Math.max(end, partial(o, f, 0.8, at, 0.002, last ? 0.35 : 0.14, lp, 'triangle'));
    partial(o, f * 2, 0.3, at, 0.002, last ? 0.25 : 0.08, lp);
  }
  return end;
}

/**
 * Brass note: two detuned sawtooths with a lip "blip" (starting 3% flat), through a low-pass whose
 * cutoff blares open on the attack and settles, like a horn's bright attack. Long notes get vibrato.
 */
function brass(o: Out, f: number, at: number, dur: number, amp: number, to: AudioNode): number {
  const ctx = o.ctx;
  const end = at + dur + 0.5;
  const g = gainNode(o, 0, to);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(amp, at + 0.025);
  g.gain.setTargetAtTime(amp * 0.75, at + 0.025, 0.08);
  g.gain.setValueAtTime(amp * 0.75, at + dur);
  g.gain.setTargetAtTime(0, at + dur, 0.07);
  const lp = filterNode(o, 'lowpass', f * 1.2, 1.4, g);
  lp.frequency.setValueAtTime(f * 1.2, at);
  lp.frequency.linearRampToValueAtTime(f * 7, at + 0.04);
  lp.frequency.setTargetAtTime(f * 3.5, at + 0.04, 0.12);
  lp.frequency.setValueAtTime(f * 3.5, at + dur);
  lp.frequency.setTargetAtTime(f * 1.2, at + dur, 0.06);
  for (const det of [0.997, 1.003]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * det * 0.97, at);
    osc.frequency.exponentialRampToValueAtTime(f * det, at + 0.03);
    if (dur > 0.3) {
      const v = lfo(o, osc.frequency, 5.5, 0, at, end);
      v.gain.setValueAtTime(0, at + 0.2);
      v.gain.linearRampToValueAtTime(f * 0.007, at + 0.5);
    }
    osc.connect(lp);
    osc.start(at);
    osc.stop(end);
  }
  return end;
}

/**
 * Milestone fanfare: "ta-ta-ta-taaa" on brass (A4 A4 A4 → D5 with a third and fifth below
 * filling the held chord), a timpani thump under the held note, into the hall reverb.
 */
export function fanfare(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.03, o.dest);
  toSend(o, out);
  const A4 = pentaHz(3);
  const D5 = pentaHz(5);
  const d = 0.1;
  brass(o, A4, t, d * 0.7, 1, out);
  brass(o, A4, t + d, d * 0.7, 1, out);
  brass(o, A4, t + d * 2, d * 0.7, 1, out);
  const hold = t + d * 3;
  let end = brass(o, D5, hold, 0.75, 1.1, out);
  end = Math.max(end, brass(o, A4, hold + 0.01, 0.75, 0.6, out));
  end = Math.max(end, brass(o, pentaHz(2), hold + 0.02, 0.75, 0.5, out)); // F#4
  const drum = gainNode(o, 0.4, o.dest);
  toSend(o, drum);
  thump(o, hold, 110, 70, 0.15, 1, 0.18, drum);
  noiseHit(o, hold, 'lowpass', 400, 0.7, 0.8, 0.002, 0.05, drum);
  return end;
}

/** Stagger bonus: three bright bells climbing (a "cha-ching" for the bonus gold). */
export function bonusChime(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.095, o.dest);
  toSend(o, out);
  const s = pick([12, 13]);
  let end = t;
  for (let i = 0; i < 3; i++) end = Math.max(end, bell(o, pentaHz(s + i * 2), 1 - i * 0.15, t + i * 0.075, 0.7, out));
  return end;
}

/** UI hover: a barely-there high tick. */
export function uiHover(o: Out): number {
  const out = gainNode(o, 0.06, o.dest);
  return partial(o, rand(2300, 2600), 1, o.t, 0.001, 0.012, out);
}

/** UI click: a soft wooden tock (band-passed click over a short falling sine). */
export function uiClick(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.3, o.dest);
  noiseHit(o, t, 'bandpass', rand(1700, 2100), 2, 0.9, 0.0005, 0.005, out);
  const osc = o.ctx.createOscillator();
  osc.frequency.setValueAtTime(rand(760, 840), t);
  osc.frequency.exponentialRampToValueAtTime(520, t + 0.04);
  const g = gainNode(o, 0, out);
  perc(g.gain, t, 0.8, 0.001, 0.018);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + 0.15);
  return t + 0.15;
}

/** UI deny (can't afford): a muffled low double-bonk. */
export function uiDeny(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.2, o.dest);
  const lp = filterNode(o, 'lowpass', 900, 0.7, out);
  partial(o, 190, 0.8, t, 0.002, 0.04, lp, 'triangle');
  return partial(o, 150, 0.8, t + 0.08, 0.002, 0.05, lp, 'triangle');
}

/**
 * A distant bird phrase: 2–5 chirps, each a sine sweeping up (or a fast trill), soft and wet.
 */
export function birdPhrase(o: Out, amp: number): number {
  const t = o.t;
  const out = gainNode(o, amp * 0.03, o.dest);
  toSend(o, out);
  const lp = filterNode(o, 'lowpass', 5500, 0.5, out);
  const species = Math.random();
  const n = 2 + Math.floor(Math.random() * 4);
  const base = rand(2600, 3600);
  let at = t;
  for (let i = 0; i < n; i++) {
    const osc = o.ctx.createOscillator();
    const g = gainNode(o, 0, lp);
    const len = species < 0.5 ? rand(0.05, 0.09) : rand(0.12, 0.2);
    const f = base * rand(0.95, 1.08) * (i === n - 1 ? 0.9 : 1);
    if (species < 0.5) {
      // Tweet: quick up-sweep.
      osc.frequency.setValueAtTime(f * 0.75, at);
      osc.frequency.exponentialRampToValueAtTime(f * 1.25, at + len);
    } else {
      // Warble: a trill.
      osc.frequency.value = f;
      lfo(o, osc.frequency, rand(22, 30), f * 0.08, at, at + len + 0.02);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.01);
    g.gain.linearRampToValueAtTime(0, at + len);
    osc.connect(g);
    osc.start(at);
    osc.stop(at + len + 0.02);
    at += len + rand(0.05, 0.14);
  }
  return at + 0.1;
}

/** Footman melee beat: `n` clanks spread over `spread` s, each at its own pitch and level. */
export function meleeBeat(o: Out, n: number, spread: number, amp: number): number {
  const out = gainNode(o, amp, o.dest);
  toSend(o, out);
  let end = o.t;
  // Level per clank falls as 1/sqrt(n): more footmen = denser, not louder.
  const per = 0.11 / Math.sqrt(n);
  for (let i = 0; i < n; i++) {
    const at = o.t + (n === 1 ? 0 : Math.random() * spread);
    end = Math.max(end, clank(o, at, rand(900, 1700), per * rand(0.6, 1.1), out));
  }
  // A soft scuffle of boots and shields under the beat.
  noiseHit(o, o.t, 'lowpass', 500, 0.7, 0.05 * Math.min(1.5, 0.6 + n * 0.12), 0.01, 0.05, out);
  return end;
}
