// The game's sounds as complete compositions of synth recipes. Each takes an `Out` (context, dest,
// reverb send, start time) and returns its end time. sfx.ts plays them live; sfxMeasure.ts renders
// them offline to meter peak/RMS, so what is measured is exactly what is heard.
import { crashesFor, expLerp, horsesFor, pentaHz } from './sfxMath';
import { filterNode, gainNode, noiseHit, pick, rand, thump, toSend, type Out } from './synth/kit';
import { bell, clang, coin, ping, shimmer } from './synth/metal';
import { arrowThud, boom, crumble, emberHiss, fireBreath, inhale, knightLand, twang, whoosh } from './synth/impact';
import { dizzy, dragonVocal } from './synth/dragonVoice';
import { arpeggio, bonusChime, birdPhrase, fanfare, meleeBeat, purchase, uiClick, uiDeny, uiHover } from './synth/tones';
import { grain } from './synth/grains';
import { armoredRush, flourish, footfall, gallop, groundHit, lanceCrash, snareRoll, warCry, warHorn } from './synth/war';
import {
  avalanche,
  brightChime,
  deepRumble,
  flashImpact,
  glassShimmer,
  panSweep,
  riseWhoosh,
  stage,
  stoneGrind,
  tremor,
  waxSeal,
  windRush,
  woodTick,
} from './synth/epic';

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

// ---- M2: bosses, the Wyrm Gauge, the eye, the zoom, abilities, lancers, champions, heraldry ----

const A2 = 110;
const D3 = pentaHz(-5);
const A3 = pentaHz(-2);
const D4 = pentaHz(0);
const A4 = pentaHz(3);

/**
 * The boss is summoned: a deep war horn from far off (A2 → D3, an octave-down horn under it, dark
 * and drowned in the stone hall), and on the second note one huge drum-like hit on the ground.
 */
export function sBossHorn(o: Out): number {
  const t = o.t;
  const far = filterNode(o, 'lowpass', 1500, 0.6, o.dest);
  toSend(o, far);
  const horns = gainNode(o, 0.17, far);
  const notes = [
    { f: A2, dur: 0.95 },
    { f: D3, dur: 1.75 },
  ];
  let end = warHorn(o, notes, t, 1, 0.25, horns);
  end = Math.max(end, warHorn(o, notes.map((n) => ({ f: n.f / 2, dur: n.dur })), t + 0.03, 0.55, 0.1, horns));
  const hit = gainNode(o, 0.15, o.dest);
  toSend(o, hit);
  return Math.max(end, groundHit(o, t + 0.95, 1, hit));
}

/**
 * The boss's entrance (`dur` = its enter phase): giant footfalls closing in, then its call: the
 * dragon voice a fourth down with a bigger throat, drawn out.
 */
export function sBossEntrance(o: Out, size: number, dur: number): number {
  const t = o.t;
  const feet = gainNode(o, 0.22, o.dest);
  toSend(o, feet);
  const n = Math.max(2, Math.min(5, Math.round(dur / 0.55)));
  let end = t;
  for (let i = 0; i < n; i++) end = Math.max(end, footfall(o, t + 0.15 + i * 0.58, 0.55 + (0.45 * i) / (n - 1), feet));
  const call = dragonVocal({ ...o, t: t + Math.max(0.5, dur * 0.85) }, 'call', Math.max(size, 0.9), 0.55, {
    pitch: 0.72,
    formant: 0.82,
    stretch: 1.45,
  });
  return Math.max(end, call);
}

/** A boss-clock tick (`tock` alternates the pair; `level` from bossTickLevel). */
export function sBossTick(o: Out, tock: boolean, level: number): number {
  return woodTick(o, o.t, tock, 0.4 * level, o.dest);
}

/**
 * The boss escapes: a mocking "hah-hah-haah" in the boss's voice, pitched down, receding (a
 * low-pass closing, panning off to the right), a last growl further off and its steps fading.
 */
export function sBossEscape(o: Out, size: number): number {
  const t = o.t;
  const lp = filterNode(o, 'lowpass', 6000, 0.7, null);
  lp.frequency.setValueAtTime(6000, t + 0.3);
  lp.frequency.exponentialRampToValueAtTime(650, t + 2.6);
  const pan = panSweep(o, t, 2.8, 0, 0.55, o.dest);
  lp.connect(pan);
  toSend(o, lp);
  const v = { ...o, dest: lp };
  const s = Math.max(size, 0.9);
  let end = dragonVocal(v, 'mock', s, 0.75, { pitch: 0.75, formant: 0.85, stretch: 1.25 });
  end = Math.max(end, dragonVocal({ ...v, t: t + 1.75 }, 'growl', s, 0.4, { pitch: 0.6, formant: 0.75, stretch: 1.3 }));
  const feet = gainNode(o, 0.22, lp);
  for (let i = 0; i < 3; i++) end = Math.max(end, footfall(o, t + 0.9 + i * 0.62, 1 - i * 0.3, feet));
  return end;
}

/**
 * The boss dies: the biggest death roar yet (two death roars layered, a fourth and an octave-plus
 * down, drawn out), then the collapse: a ground-shaking hit, rubble pouring in two waves, a deep
 * rumble, and embers.
 */
export function sBossDeath(o: Out, size: number): number {
  const t = o.t;
  const s = Math.max(size, 0.9);
  let end = dragonVocal(o, 'death', s, 0.75, { pitch: 0.72, formant: 0.8, stretch: 1.6 });
  end = Math.max(end, dragonVocal({ ...o, t: t + 0.04 }, 'death', s, 0.5, { pitch: 0.42, formant: 0.6, stretch: 1.75 }));
  const fall = t + 1.05;
  const hit = gainNode(o, 0.11, o.dest);
  toSend(o, hit);
  end = Math.max(end, groundHit(o, fall, 1, hit));
  end = Math.max(end, crumble(o, fall + 0.05, 1, 0.4));
  end = Math.max(end, crumble(o, fall + 0.45, 1, 0.25));
  end = Math.max(end, deepRumble(o, fall, 2.2, 0.12, stage(o, 1)));
  return Math.max(end, emberHiss(o, fall + 0.8, 1));
}

/** After an ordinary kill, the ground answers: a tremor scaled by the Wyrm Gauge `g` (0..1). */
export function sTremor(o: Out, g: number): number {
  return tremor(o, o.t, g, 0.15, stage(o, 1));
}

/**
 * The eye in the hills opens: stone grinding far away and a huge, slow growl under it (the
 * dragon voice more than an octave down, heard through a mile of air). `amp` 1 = the first time.
 */
export function sEyeOpen(o: Out, amp: number): number {
  const t = o.t;
  const far = filterNode(o, 'lowpass', 700, 0.7, o.dest);
  toSend(o, far);
  const g = gainNode(o, amp * 0.78, far);
  let end = stoneGrind(o, t, 2.8, 0.55, g);
  end = Math.max(end, dragonVocal({ ...o, dest: g, t: t + 0.35 }, 'growl', 1, 0.75, { pitch: 0.42, formant: 0.55, stretch: 2.6 }));
  return end;
}

/**
 * Zoom, rally: the army's horns (three, in fifths and octaves, D → A, tongued), a rush of
 * armored feet to the center, and the ground beginning to tremble.
 */
export function sRallyHorns(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.176, o.dest);
  toSend(o, out);
  let end = warHorn(o, [{ f: D3, dur: 0.32 }, { f: A3, dur: 1.1 }], t, 1, 0.55, out);
  end = Math.max(end, warHorn(o, [{ f: A3, dur: 0.3 }, { f: D4, dur: 1.05 }], t + 0.07, 0.8, 0.6, out));
  return Math.max(end, warHorn(o, [{ f: D4, dur: 0.29 }, { f: A4, dur: 1.0 }], t + 0.13, 0.5, 0.65, out));
}

/** Armored feet rushing in for `dur` s (the zoom's rally, Charge!), `rate` steps/s at the peak. */
export function sArmyRush(o: Out, dur: number, rate: number): number {
  return armoredRush(o, o.t, dur, rate, 0.25, 0.25, stage(o, 1));
}

/** Zoom, fusion: the rising whoosh-rumble, `dur` s long, cut dead on the flash. */
export function sFusionRise(o: Out, dur: number): number {
  return riseWhoosh(o, o.t, dur, 0.34, stage(o, 1));
}

/** Zoom, flash: the massive transient impact (the music supplies the tonal sub). */
export function sFlashImpact(o: Out): number {
  return flashImpact(o, o.t, 0.18, stage(o, 1));
}

/** Zoom, pull-back: the long rush of wind, rising through air for `dur` s. */
export function sWindRush(o: Out, dur: number): number {
  return windRush(o, o.t, dur, 0.5, stage(o, 1));
}

/** Zoom, reveal: the world wyrm's head rising over the ridge, a deep rumble of shifting rock. */
export function sRevealRumble(o: Out): number {
  return deepRumble(o, o.t, 2.4, 0.21, stage(o, 1));
}

/**
 * Zoom, roar: an enormous roar. Three layers of the dragon voice (the bellow an octave down, a
 * sub-throat further still, a snarl on top) spread across the stereo field, with an avalanche
 * letting go under it.
 */
export function sColossalRoar(o: Out): number {
  const t = o.t;
  const layers = [
    { pitch: 0.5, formant: 0.72, stretch: 1.55, amp: 0.95, pan: 0, at: 0 },
    { pitch: 0.33, formant: 0.52, stretch: 1.7, amp: 0.77, pan: -0.25, at: 0.05 },
    { pitch: 0.85, formant: 0.95, stretch: 1.4, amp: 0.42, pan: 0.25, at: 0.1 },
  ];
  let end = t;
  for (const l of layers) {
    const p = panSweep(o, t, 0.1, l.pan, l.pan, o.dest);
    end = Math.max(end, dragonVocal({ ...o, dest: p, t: t + l.at }, 'roar', 1, l.amp, l));
  }
  return Math.max(end, avalanche(o, t + 0.6, 3.4, 0.34, stage(o, 1)));
}

/** Zoom, card: a soft bright chime. */
export function sCardChime(o: Out): number {
  return brightChime(o, o.t, 0.07, true, stage(o, 1));
}

/**
 * Charge!: a battle horn blast ("ta-taaa", A3 → D4, with a horn a fifth under), a war cry from
 * the ranks. (sArmyRush plays the charging feet alongside.)
 */
export function sChargeHorn(o: Out): number {
  const t = o.t;
  const out = gainNode(o, 0.19, o.dest);
  toSend(o, out);
  let end = warHorn(o, [{ f: A3, dur: 0.16 }, { f: D4, dur: 0.75 }], t, 1, 0.9, out);
  end = Math.max(end, warHorn(o, [{ f: D3, dur: 0.16 }, { f: A3, dur: 0.75 }], t + 0.01, 0.6, 0.7, out));
  return Math.max(end, warCry(o, t + 0.5, 1.3, 0.75, stage(o, 1)));
}

/** Rally: a quick martial snare roll with an accent. */
export function sRallyRoll(o: Out): number {
  return snareRoll(o, o.t, 1.0, 0.2, stage(o, 1));
}

/** A Rally auto-strike: a thinner, duller clang (they come ~8/s; the caller thins them further). */
export function sAutoStrike(o: Out): number {
  return clang(o, { f0: clangRoot(), bright: rand(0, 0.2), amp: rand(0.42, 0.55) });
}

/**
 * Dragonbane Volley, loosed: a crackle of bowstrings along the line, then the whoosh of hundreds
 * of arrows (three bands of air, low to high, flying `panA` → `panB` over `flight` s).
 */
export function sArrowStorm(o: Out, flight: number, panA: number, panB: number): number {
  const t = o.t;
  const g = gainNode(o, 0.17, o.dest);
  let end = t;
  for (let i = 0; i < 6; i++) end = Math.max(end, twang(o, t + i * rand(0.03, 0.055), rand(140, 240), 1, g));
  const dur = Math.max(0.5, flight * 0.95);
  end = Math.max(end, whoosh(o, t + 0.06, dur, 900, 2000, 800, 1.4, 0.31, panA, panB));
  end = Math.max(end, whoosh(o, t + 0.1, dur, 1800, 3600, 1500, 2, 0.28, panA, panB));
  return Math.max(end, whoosh(o, t + 0.14, dur, 3500, 6500, 3000, 2.5, 0.14, panA * 0.5, panB));
}

/** Dragonbane Volley, landing: a rain of hundreds of arrow strikes and a pummeling under them. */
export function sArrowRain(o: Out): number {
  const t = o.t;
  const out = stage(o, 0.3);
  let end = grain(o, 'rain', t, out, rand(0.95, 1.05));
  for (let i = 0; i < 4; i++) end = Math.max(end, grain(o, 'thk', t + rand(0, 0.12), out, rand(0.85, 1.15)));
  return Math.max(end, thump(o, t, 150, 50, 0.1, 0.6, 0.12, out));
}

/** Lancers charging: galloping hooves (`riders` → 1..4 horses) building over `travel` s. */
export function sGallop(o: Out, riders: number, travel: number, panA: number, panB: number): number {
  return gallop(o, o.t, travel, horsesFor(riders), 0.28, panA, panB, stage(o, 1));
}

/** The lances hit home: a heavy crash (1..3 of them for a wide charge). */
export function sLanceCrash(o: Out, riders: number): number {
  return lanceCrash(o, o.t, crashesFor(riders), 0.17, stage(o, 1));
}

/** A champion joins: a short, proud brass flourish in D. */
export function sChampionJoin(o: Out): number {
  return flourish(o, o.t, 0.024, stage(o, 1));
}

/** A champion's blow, blended into the footmen's beat: a heavier, lower clang. */
export function sChampionHit(o: Out): number {
  return clang(o, { f0: pentaHz(pick([0, 1, 2])) * rand(0.995, 1.005), bright: rand(0.25, 0.45), amp: 0.5 });
}

/** A champion's special: a lunge whoosh, then a heavy blow (a bright clang over a boom). */
export function sChampionSpecial(o: Out): number {
  const t = o.t;
  let end = whoosh(o, t, 0.2, 420, 2400, 900, 1.8, 0.35, -0.1, 0.15);
  const hit = { ...o, t: t + 0.11 };
  end = Math.max(end, clang(hit, { f0: pentaHz(pick([0, 3])), bright: 0.9, amp: 0.75 }));
  return Math.max(end, boom(hit, 0.4));
}

/** Heraldry bought: a wax seal pressed, then a bright chime. */
export function sHeraldry(o: Out): number {
  const t = o.t;
  const out = stage(o, 1);
  const end = waxSeal(o, t, 0.34, out);
  return Math.max(end, brightChime(o, t + 0.13, 0.055, false, out));
}

/** Scales gained: a glassy, iridescent shimmer. */
export function sScales(o: Out): number {
  return glassShimmer(o, o.t, 0.065, stage(o, 1));
}
