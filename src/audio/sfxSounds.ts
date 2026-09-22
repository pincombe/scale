// The game's sounds as complete compositions of synth recipes. Each takes an `Out` (context, dest,
// reverb send, start time) and returns its end time. sfx.ts plays them live; sfxMeasure.ts renders
// them offline to meter peak/RMS, so what is measured is exactly what is heard.
import { expLerp, pentaHz } from './sfxMath';
import { gainNode, noiseHit, pick, rand, type Out } from './synth/kit';
import { bell, clang, coin, ping, shimmer } from './synth/metal';
import { arrowThud, boom, crumble, emberHiss, fireBreath, inhale, knightLand, twang, whoosh } from './synth/impact';
import { dizzy, dragonVocal } from './synth/dragonVoice';
import { arpeggio, bonusChime, birdPhrase, fanfare, meleeBeat, purchase, uiClick, uiDeny, uiHover } from './synth/tones';

/** Clang roots: A4 B4 D5 E5 F#5 (pentatonic steps). Never the same root twice in a row. */
const CLANG_STEPS = [3, 4, 5, 6, 7] as const;
let lastClang = -1;

function clangRoot(): number {
  const n = CLANG_STEPS.length;
  let i = Math.floor(Math.random() * n);
  if (i === lastClang) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
  lastClang = i;
  return pentaHz(CLANG_STEPS[i]!) * rand(0.995, 1.005);
}

/** A normal click: sword clang, randomized per hit. */
export function sStrike(o: Out): number {
  return clang(o, { f0: clangRoot(), bright: rand(0.2, 0.6), amp: rand(0.85, 1.05) });
}

/** The crit's clang (played on the strike path, so a crit is never silent). */
export function sCritClang(o: Out): number {
  return clang(o, { f0: clangRoot(), bright: 1, amp: 0.85 });
}

/** The crit's extra layers: weak-spot ping + shimmer + low boom (capped separately). */
export function sCritLayers(o: Out): number {
  let end = ping(o, pentaHz(pick([13, 14, 15])), 1);
  const base = pick([13, 14, 15]);
  const notes = [base, base + 2, base + 1, base + 4, base + 3].map((s) => pentaHz(s));
  end = Math.max(end, shimmer(o, notes, 1.1));
  return Math.max(end, boom(o, 0.42));
}

/** Degraded crit layer when the full layers are over their cap: just a lighter ping. */
export function sPing(o: Out): number {
  return ping(o, pentaHz(pick([13, 14, 15])), 0.7);
}

/** A whole crit (clang + layers), for the meter and debug. */
export function sCrit(o: Out): number {
  return Math.max(sCritClang(o), sCritLayers(o));
}

/** The wind-up choked off by a stagger: a short glottal "hk-k". */
export function sChoke(o: Out, size: number): number {
  const f = expLerp(1500, 420, size);
  const g = gainNode(o, 1.8, o.dest);
  noiseHit(o, o.t, 'bandpass', f, 3, 1, 0.002, 0.02, g);
  return noiseHit(o, o.t + 0.06, 'bandpass', f * 0.8, 3, 0.6, 0.002, 0.025, g);
}

/** Footman melee beat: density (not loudness) scales with `hits` (≤ 24). */
export function sMelee(o: Out, hits: number): number {
  const n = Math.max(1, Math.min(6, Math.round(1 + Math.sqrt(Math.max(0, hits - 1)) * 1.3)));
  const spread = 0.04 + 0.12 * Math.min(1, hits / 16);
  return meleeBeat(o, n, spread, 1);
}

/** Archer volley: staggered bow twangs, then the arrows' whoosh flying across (pan a → b). */
export function sVolley(o: Out, arrows: number, flight: number, panA: number, panB: number): number {
  const n = Math.max(1, Math.min(4, Math.round(Math.sqrt(arrows))));
  const g = gainNode(o, 0.2 / Math.sqrt(n), o.dest);
  let end = o.t;
  for (let i = 0; i < n; i++) {
    const at = o.t + (i === 0 ? 0 : rand(0.02, 0.14));
    end = Math.max(end, twang(o, at, rand(150, 230), 1, g));
  }
  const w = Math.min(1, 0.55 + arrows * 0.03);
  end = Math.max(end, whoosh(o, o.t + 0.05, Math.max(0.3, flight * 0.95), 1800, 3400, 1500, 3, 0.1 * w, panA, panB));
  return end;
}

/** Arrows landing: a patter of woody thuds, denser with more arrows (≤ 40). */
export function sArrowHits(o: Out, hits: number): number {
  const n = Math.max(1, Math.min(8, Math.round(1 + Math.sqrt(hits) * 1.1)));
  const g = gainNode(o, 0.22 / Math.sqrt(n), o.dest);
  let end = o.t;
  for (let i = 0; i < n; i++) end = Math.max(end, arrowThud(o, o.t + (i === 0 ? 0 : rand(0, 0.16)), rand(0.6, 1), g));
  return end;
}

export function sYelp(o: Out, size: number): number {
  return dragonVocal(o, 'yelp', size, 0.62);
}

export function sChirp(o: Out, size: number): number {
  return dragonVocal(o, 'chirp', size, 0.4);
}

export function sCall(o: Out, size: number): number {
  return dragonVocal(o, 'call', size, 0.45);
}

/** Wind-up before fire: the inhale, with a low growl riding it for big dragons. */
export function sInhale(o: Out, size: number, dur: number): number {
  let end = inhale(o, dur, size, expLerp(0.45, 0.8, size));
  if (size > 0.45) end = Math.max(end, dragonVocal(o, 'growl', size, 0.25 * size));
  return end;
}

/** Wind-up before a tail swipe: a rising snarl. */
export function sGrowl(o: Out, size: number): number {
  return dragonVocal(o, 'growl', size, 0.6);
}

export function sBreath(o: Out, size: number, dur: number): number {
  return fireBreath(o, dur, size, expLerp(0.38, 0.73, size));
}

/**
 * Tail swipe: a big band-passed whoosh sweeping right → left across the army, then comic bonks as
 * `knights` land (0.45–1.2 s later), each with a little armor rattle.
 */
export function sSwipe(o: Out, size: number, knights: number, pan: number): number {
  const f = 1 - 0.45 * size;
  let end = whoosh(o, o.t, 0.42 + 0.2 * size, 260 * f, 1300 * f, 320 * f, 1.6, 1.8, pan + 0.25, pan - 0.35);
  const g = gainNode(o, 0.2, o.dest);
  const n = Math.max(1, Math.min(6, knights));
  for (let i = 0; i < n; i++) {
    const at = o.t + rand(0.45, 1.15);
    end = Math.max(end, knightLand(o, at, rand(0.6, 1) / Math.sqrt(n * 0.6 + 0.4), g));
  }
  return end;
}

export function sStagger(o: Out): number {
  return dizzy(o, 1);
}

/** Dragon death: a descending roar, the body crumbling, then embers hissing out. */
export function sDeath(o: Out, size: number): number {
  let end = dragonVocal(o, 'death', size, 0.42);
  end = Math.max(end, crumble(o, o.t + 0.35, size, 0.8 - 0.25 * size));
  return Math.max(end, emberHiss(o, o.t + 0.5, 1));
}

/** One coin clink at a pentatonic step (the caller climbs the run). */
export function sCoin(o: Out, step: number, amp = 1): number {
  return coin(o, pentaHz(step) * rand(0.997, 1.003), amp);
}

export function sBonus(o: Out): number {
  return bonusChime(o);
}

/** Purchase chime at pentatonic `step` (default: a random mid note). */
export function sPurchase(o: Out, grand: boolean, step = pick([10, 11, 12])): number {
  return purchase(o, grand, step);
}

export function sUnlock(o: Out): number {
  return arpeggio(o);
}

export function sMilestone(o: Out): number {
  return fanfare(o);
}

export function sUiHover(o: Out): number {
  return uiHover(o);
}

export function sUiClick(o: Out): number {
  return uiClick(o);
}

export function sUiDeny(o: Out): number {
  return uiDeny(o);
}

export function sBird(o: Out): number {
  return birdPhrase(o, 1);
}

/** A lone bell (debug / fallback). */
export function sBell(o: Out, step: number): number {
  const g = gainNode(o, 0.1, o.dest);
  return bell(o, pentaHz(step), 1, o.t, 1, g);
}
