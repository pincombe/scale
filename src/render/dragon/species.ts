// Species parameter sets for the procedural dragon rig (pure data + resolution; no DOM).
//
// Every dragon in the game is the same rig (./rig.ts) fed a Morph: a flat set of numbers covering
// proportions, posture and optional features. A feature is "off" when its amount is 0, so a
// species is just two Morphs (its youngest and its biggest individuals) plus behavior tuning:
//
//   species  = { young, old, sizeLo, sizeHi, jitter, variants, weakSpots, behavior }
//   maturity = where state.dragon.size sits in [sizeLo, sizeHi] on a log scale (0..1)
//   morph    = lerp(young, old, maturity), then per-individual jitter and variants seeded by
//              state.dragon.seed, then a boss's overrides (./bosses.ts), then mutation overrides
//
// So within a tier the dragons grow up as they grow: the meadow newt starts as a chubby,
// big-eyed newt with axolotl gills and a soft crest, and ends as a horned, spiky-backed wyrm
// that still has comically small wings; the mountain wyvern (./wyvern.ts) starts as a gangly
// fledgling and ends as a walking crag. New tiers add a SpeciesDef (register it in SPECIES);
// mutations override single fields (e.g. heads: 3) through buildIndividual's `over`.
//
// Units: lengths are relative (the rig normalizes the rest pose so snout-to-tail = 1 body
// length). Head features are fractions of the head length. Angles are radians; in the rig's
// frame +x points to the tail (the dragon faces -x) and +y is down, so "raise" angles lift the
// part toward -y.
import { Rng } from '../../lib/rng';
import { clamp01, lerp } from '../../lib/math';
import { NO_DRESS, bossOf, type BossDef, type BossDress } from './bosses';
import { WYVERN } from './wyvern';

export interface Morph {
  // ---- spine lengths (relative) ----
  headLen: number;
  neckLen: number;
  bodyLen: number;
  tailLen: number;
  // ---- body tube: half-thickness at key points (same units), split above/below the spine ----
  thickNeck: number;
  thickShoulder: number;
  thickBelly: number;
  thickHip: number;
  thickTail: number;
  /** Share of the thickness above the spine (0.5 = centered; < 0.5 = belly hangs low). */
  backShare: number;
  /** Where the belly peaks between shoulder (0) and hip (1). */
  bellyAt: number;
  /** Belly clearance above the ground at rest. */
  clearance: number;
  /** Back arch (rad): the torso bows up in the middle. */
  arch: number;
  /** Torso tilt (rad, + = chest up, rump down): how proudly it stands. */
  tilt: number;
  // ---- rest posture ----
  neckRaise: number;
  /** S-curve of the neck: steep at the base, level at the head. */
  neckCurl: number;
  /** Head pitch at rest (+ = nose up). */
  headTilt: number;
  /** Tail root angle below the body line. */
  tailDroop: number;
  /** Total curl along the tail (- = the tip curls up). */
  tailCurl: number;
  // ---- head (fractions of headLen) ----
  cranium: number;
  snout: number;
  jaw: number;
  eyeSize: number;
  /** Eye position from the back of the skull (0) to the snout tip (1). */
  eyePos: number;
  brow: number;
  teeth: number;
  hornLen: number;
  hornPairs: number;
  hornCurl: number;
  hornWidth: number;
  /** Axolotl-style feathery gill stalks behind the jaw (length), 0 = none. */
  gills: number;
  gillCount: number;
  whiskers: number;
  /** Fan frill behind the jaw, 0 = none. */
  frill: number;
  // ---- legs ----
  /** 1 (bipedal wyvern) or 2 (four legs). */
  legPairs: number;
  /** Leg reach as a multiple of the hip height (> 1 = bent at rest). */
  legBend: number;
  /** Upper bone share of the leg reach. */
  legSplit: number;
  /** Hip radius (relative length units). */
  legWidth: number;
  /** Foot / toe length as a fraction of the leg reach. */
  footLen: number;
  toes: number;
  /** Claw length (fraction of a toe), 0 = round toe pads. */
  claws: number;
  /** Leg attach points between shoulder (0) and hip (1). */
  frontLegAt: number;
  backLegAt: number;
  // ---- wings ----
  /** Wing span (relative length units), 0 = wingless. */
  wingSpan: number;
  wingFingers: number;
  /** Wing root between shoulder (0) and hip (1). */
  wingAt: number;
  /** Membrane scallop depth between finger tips (0..1). */
  wingScallop: number;
  /** 0..1: how much the wings buzz (too small to fly) instead of flapping. */
  buzz: number;
  // ---- back and tail ----
  /** Dorsal crest height (length units), 0 = none. */
  crest: number;
  crestSpikes: number;
  /** 0 = soft wavy newt crest .. 1 = separate sharp spikes. */
  crestSharp: number;
  /** Crest extent along the spine (0 = head end .. 1 = tail tip). */
  crestFrom: number;
  crestTo: number;
  /** Newt paddle fin height along the tail, top and bottom (length units), 0 = none. */
  tailFin: number;
  /** Arrowhead spade at the tail tip (length units), 0 = none. */
  tailSpade: number;
  /** Spiked club at the tail tip (radius, length units), 0 = none. */
  tailClub: number;
  // ---- extra ----
  heads: number;
  // ---- M2: wing-arms (wyverns walk on their wing-wrists), rock, crowns, battle damage ----
  /** 1 = the wings are the forelegs (wing-arms that plant their wrists; legPairs then counts the hind legs). */
  wingWalk: number;
  /** Wing-arm reach as a multiple of the shoulder height (> 1: the elbow juts up when folded). */
  armBend: number;
  /** Upper-arm share of the wing-arm reach (bats and pterosaurs: short humerus, long forearm). */
  armSplit: number;
  /** Wing-arm bone radius at the shoulder (relative length units). */
  armWidth: number;
  /** Where the membrane's trailing edge meets the body (0 shoulder .. 1 hip); 0 = wingAt + 0.34. */
  wingRoot: number;
  /** Craggy rock plates along the back: height (length units), 0 = none. */
  plates: number;
  plateCount: number;
  /** Plate row extent along the spine (0 = head end .. 1 = tail tip). */
  plateFrom: number;
  plateTo: number;
  /** 0 = neat plates .. 1 = broken, jagged crags. */
  plateJag: number;
  /** A crown of stony spikes along the back of the skull: count (0 = none) and length (head units). */
  crownN: number;
  crownLen: number;
  /** Tail club style: 0 = round with spikes .. 1 = a craggy lump of rock. */
  clubJag: number;
  /** Horns snapped off: 0 = whole .. 1 = stumps (a jagged break). */
  hornBreak: number;
  /** Gnarled, knotted horns: 0 = smooth .. 1 = very gnarled. */
  hornGnarl: number;
}

export type MorphKey = keyof Morph;

/** How a species arrives: buzzing in low over the grass, gliding in on spread wings, or walking. */
export type EnterStyle = 'flutter' | 'glide' | 'walk';
/** How it retreats off stage right: scurrying away, taking to the air, or walking off. */
export type LeaveStyle = 'scuttle' | 'fly' | 'walk';
/**
 * Its tail attack. 'lash': a quick turnaround, the tail sweeping low through the front ranks.
 * 'slam': the coiled tail whips over the back and smashes down on the front line.
 */
export type SwipeStyle = 'lash' | 'slam';
/** Its fire breath: 'lunge' leans in low over its forelegs; 'rear' rears up on its hind legs, wings spread. */
export type BreathStyle = 'lunge' | 'rear';

/** Behavior tuning: how a species moves, independent of its shape. */
export interface BehaviorTuning {
  /** Idle breaths per second for a 1 m dragon (scaled by size^-0.25). */
  breathHz: number;
  /** Tail sway amplitude (rad) and frequency (Hz at 1 m). */
  swayAmp: number;
  swayHz: number;
  /** Seconds between blinks. */
  blinkMin: number;
  blinkMax: number;
  /** Relative weights of the idle micro-behaviors ('stretch': a wing display). */
  acts: { look: number; sniff: number; buzz: number; yawn: number; wag: number; stretch: number };
  enter: EnterStyle;
  leave: LeaveStyle;
  swipe: SwipeStyle;
  breath: BreathStyle;
  /** Kicks up snow (as well as dust) when it lands and stamps: a mountain creature. */
  snow: number;
  /** Eye glow colors an individual picks from. */
  eyes: readonly string[];
}

/** A loose-scale candidate: where on the body it may sit (the rig resolves it on the live pose). */
export interface WeakSpotSpec {
  /** Body fraction (0 shoulder .. 1 hip; < 0 up the neck, > 1 down the tail) + a random extra. */
  at: number;
  atVar: number;
  /** -1 belly edge .. +1 back edge, + a random extra. */
  side: number;
  sideVar: number;
  /** 'elbow': the near wing-arm's elbow joint instead of a body point. */
  on?: 'body' | 'elbow';
}

export interface SpeciesDef {
  id: string;
  /** Size (m) range across which the morph goes young -> old. */
  sizeLo: number;
  sizeHi: number;
  young: Morph;
  old: Morph;
  /** Per-individual variation: +- fraction of each value (relative). */
  jitter: Partial<Record<MorphKey, number>>;
  /** Seeded alternatives: each applies its `set` to an individual with probability p. */
  variants?: readonly { p: number; set: Partial<Morph> }[];
  /**
   * Loose-scale candidates, ordered by how far they sit from the torso's middle: small on-screen
   * dragons only use the first two (index.ts decides), so those must be well off-center.
   */
  weakSpots: readonly WeakSpotSpec[];
  /** Swipe-windup target on the tail: this far along it (0 root .. 1 tip). */
  swipeSpotT: number;
  /**
   * Small on screen, move the swipe target to the head (nape, then brow): for species whose loose
   * scale sits on the tail there (the newt), so mashing it can't stagger. Off: always the tail.
   */
  swipeHeadTiers: boolean;
  behavior: BehaviorTuning;
}

/** Integer-valued fields (rounded after morph + jitter). */
const INTEGER_KEYS: readonly MorphKey[] = ['hornPairs', 'gillCount', 'legPairs', 'toes', 'wingFingers', 'crestSpikes', 'heads', 'plateCount', 'crownN', 'wingWalk'];

/** The M2 fields, all off: species without wing-arms, rock or crowns spread this in. */
export const NO_M2_FEATURES = {
  wingWalk: 0,
  armBend: 0,
  armSplit: 0,
  armWidth: 0,
  wingRoot: 0,
  plates: 0,
  plateCount: 0,
  plateFrom: 0,
  plateTo: 0,
  plateJag: 0,
  crownN: 0,
  crownLen: 0,
  clubJag: 0,
  hornBreak: 0,
  hornGnarl: 0,
} as const satisfies Partial<Morph>;

// ---------------------------------------------------------------------------------------------
// The meadow newt (tier 0). Young: 0.5 m, a chubby big-eyed newt with gills, a soft wavy crest,
// a paddle tail and wings like two leaves, standing tall with its head up (it has to hold the
// stage at 1-3 m, where judges watch it most). Old: 40 m, a long-necked horned wyrm with a spiked
// back and a spade tail, whose wings never caught up.
// ---------------------------------------------------------------------------------------------
const NEWT_YOUNG: Morph = {
  headLen: 0.26,
  neckLen: 0.09,
  bodyLen: 0.33,
  tailLen: 0.38,
  thickNeck: 0.04,
  thickShoulder: 0.066,
  thickBelly: 0.074,
  thickHip: 0.058,
  thickTail: 0.046,
  backShare: 0.42,
  bellyAt: 0.55,
  clearance: 0.055,
  arch: 0.09,
  tilt: 0.12,
  neckRaise: 0.8,
  neckCurl: 0.3,
  headTilt: 0.04,
  tailDroop: 0.22,
  tailCurl: -0.75,
  cranium: 0.47,
  snout: 0.3,
  jaw: 0.17,
  eyeSize: 0.165,
  eyePos: 0.44,
  brow: 0.025,
  teeth: 0.25,
  hornLen: 0.18,
  hornPairs: 1,
  hornCurl: 0.25,
  hornWidth: 0.1,
  gills: 0.55,
  gillCount: 3,
  whiskers: 0,
  frill: 0,
  legPairs: 2,
  legBend: 1.55,
  legSplit: 0.52,
  legWidth: 0.034,
  footLen: 0.36,
  toes: 3,
  claws: 0,
  frontLegAt: 0.14,
  backLegAt: 0.86,
  wingSpan: 0.13,
  wingFingers: 2,
  wingAt: 0.1,
  wingScallop: 0.35,
  buzz: 1,
  crest: 0.024,
  crestSpikes: 11,
  crestSharp: 0.05,
  crestFrom: 0.05,
  crestTo: 0.62,
  tailFin: 0.032,
  tailSpade: 0,
  tailClub: 0,
  heads: 1,
  ...NO_M2_FEATURES,
};

const NEWT_OLD: Morph = {
  headLen: 0.145,
  neckLen: 0.15,
  bodyLen: 0.3,
  tailLen: 0.47,
  thickNeck: 0.036,
  thickShoulder: 0.056,
  thickBelly: 0.064,
  thickHip: 0.05,
  thickTail: 0.038,
  backShare: 0.44,
  bellyAt: 0.45,
  clearance: 0.075,
  arch: 0.11,
  tilt: 0.04,
  neckRaise: 0.78,
  neckCurl: 0.38,
  headTilt: -0.1,
  tailDroop: 0.16,
  tailCurl: -0.95,
  cranium: 0.37,
  snout: 0.2,
  jaw: 0.22,
  eyeSize: 0.075,
  eyePos: 0.5,
  brow: 0.075,
  teeth: 1,
  hornLen: 0.55,
  hornPairs: 2,
  hornCurl: 0.6,
  hornWidth: 0.13,
  gills: 0.2,
  gillCount: 3,
  whiskers: 0,
  frill: 0,
  legPairs: 2,
  legBend: 1.3,
  legSplit: 0.5,
  legWidth: 0.024,
  footLen: 0.34,
  toes: 3,
  claws: 0.9,
  frontLegAt: 0.12,
  backLegAt: 0.88,
  wingSpan: 0.22,
  wingFingers: 3,
  wingAt: 0.08,
  wingScallop: 0.45,
  buzz: 0.75,
  crest: 0.026,
  crestSpikes: 15,
  crestSharp: 0.95,
  crestFrom: 0.03,
  crestTo: 0.9,
  tailFin: 0.008,
  tailSpade: 0.06,
  tailClub: 0,
  heads: 1,
  ...NO_M2_FEATURES,
};

export const NEWT: SpeciesDef = {
  id: 'newt',
  sizeLo: 0.5,
  sizeHi: 40,
  young: NEWT_YOUNG,
  old: NEWT_OLD,
  jitter: {
    headLen: 0.08,
    neckLen: 0.2,
    tailLen: 0.1,
    thickBelly: 0.12,
    backShare: 0.06,
    neckRaise: 0.15,
    tailCurl: 0.3,
    cranium: 0.08,
    snout: 0.12,
    eyeSize: 0.12,
    brow: 0.4,
    hornLen: 0.35,
    hornCurl: 0.5,
    gills: 0.25,
    legBend: 0.06,
    wingSpan: 0.25,
    crest: 0.35,
    crestSpikes: 0.2,
    tailFin: 0.3,
  },
  // Loose scales near the silhouette's edge, away from the middle of the body (a click on the middle
  // is a normal hit; the glowing scale is the crit): tail root, along the tail, withers, back ridge.
  weakSpots: [
    { at: 1.4, atVar: 0.12, side: 0.55, sideVar: 0.25 },
    { at: 1.75, atVar: 0.25, side: 0.35, sideVar: 0.3 },
    { at: 0.1, atVar: 0.12, side: 0.62, sideVar: 0.25 },
    { at: 0.42, atVar: 0.2, side: 0.78, sideVar: 0.17 },
  ],
  swipeSpotT: 0.8,
  swipeHeadTiers: true,
  behavior: {
    breathHz: 0.42,
    swayAmp: 0.16,
    swayHz: 0.45,
    blinkMin: 1.8,
    blinkMax: 5,
    acts: { look: 3, sniff: 2.2, buzz: 1.4, yawn: 0.5, wag: 1, stretch: 0 },
    enter: 'flutter',
    leave: 'scuttle',
    swipe: 'lash',
    breath: 'lunge',
    snow: 0,
    eyes: ['#ffd35a', '#ffc04a', '#ffe38a', '#ffa640', '#ffd35a'],
  },
};

/** Registered species by DragonState.species key. Unknown keys fall back to the newt. */
export const SPECIES: Readonly<Record<string, SpeciesDef>> = { newt: NEWT, wyvern: WYVERN };

export function speciesOf(id: string): SpeciesDef {
  return SPECIES[id] ?? NEWT;
}

/** A resolved individual: the concrete morph plus identity. */
export interface Individual extends Morph {
  species: SpeciesDef;
  seed: number;
  /** Body length in meters. */
  size: number;
  /** 0 (youngest look) .. 1 (oldest look). */
  maturity: number;
  /** Eye glow color. */
  eye: string;
  /**
   * Loose-scale candidates: `at` is a body fraction (0 shoulder .. 1 hip; < 0 reaches up the
   * neck, > 1 down the tail), `side` runs -1 (belly edge) .. +1 (back edge); `on` 1 = the near
   * wing-arm's elbow instead. All sit off the body's center of mass so a crit takes aim.
   */
  weakSpots: readonly { at: number; side: number; on: number }[];
  /** Per-individual phase offsets so neighbors never move in lockstep. */
  phase: number;
  /** The boss this individual is dressed as, or null. */
  boss: BossDef | null;
  /** Boss dressings (moss, scars, cataracts, snow, torn wings); all 0 for ordinary dragons. */
  dress: BossDress;
  /** 0 ordinary .. 1 a boss: slower, grander acting. */
  grand: number;
  enter: EnterStyle;
  leave: LeaveStyle;
  swipe: SwipeStyle;
  breath: BreathStyle;
}

/** Where a size sits on the species' growth curve (log scale), 0..1. */
export function maturityOf(species: SpeciesDef, size: number): number {
  if (!(size > 0)) return 0;
  return clamp01(Math.log(size / species.sizeLo) / Math.log(species.sizeHi / species.sizeLo));
}

/**
 * Resolve an individual from species + seed + size (+ boss id). Deterministic for the same inputs.
 * `over` overrides fields last (mutations, debug), e.g. { heads: 3 }. An unknown boss id is an
 * ordinary dragon.
 */
export function buildIndividual(species: SpeciesDef, seed: number, size: number, over?: Partial<Morph>, bossId?: string | null): Individual {
  const rng = new Rng(seed ^ 0x5eed_d7a6);
  const m = maturityOf(species, size);
  const out = {} as Record<MorphKey, number>;
  const young = species.young as unknown as Record<MorphKey, number>;
  const old = species.old as unknown as Record<MorphKey, number>;
  // Correlated body-type factors so individuals read as "chubby" or "lanky" as a whole.
  const chub = 1 + (rng.float() * 2 - 1) * 0.1;
  const lanky = 1 + (rng.float() * 2 - 1) * 0.1;
  for (const k of Object.keys(young) as MorphKey[]) {
    let v = lerp(young[k], old[k], m);
    const j = species.jitter[k];
    if (j) v *= 1 + (rng.float() * 2 - 1) * j;
    if (k.startsWith('thick')) v *= chub;
    if (k === 'neckLen' || k === 'tailLen' || k === 'legBend') v *= lanky;
    out[k] = v;
  }
  // Seeded alternatives (a club or a spade...). Drawn from their own stream so the main one (and
  // every species without variants) is untouched.
  if (species.variants) {
    const vr = new Rng(seed ^ 0x7a61_a47);
    for (const v of species.variants) {
      if (vr.float() < v.p) for (const k of Object.keys(v.set) as MorphKey[]) out[k] = v.set[k]!;
    }
  }
  const boss = bossOf(bossId);
  if (boss) for (const k of Object.keys(boss.over) as MorphKey[]) out[k] = boss.over[k]!;
  if (over) for (const k of Object.keys(over) as MorphKey[]) out[k] = over[k]!;
  for (const k of INTEGER_KEYS) out[k] = Math.max(0, Math.round(out[k]));
  out.legPairs = Math.min(2, Math.max(1, out.legPairs));
  out.heads = Math.min(3, Math.max(1, out.heads));
  out.wingFingers = Math.min(4, Math.max(2, out.wingFingers));
  out.toes = Math.min(4, Math.max(2, out.toes));
  out.gillCount = Math.min(4, out.gillCount);
  out.hornPairs = Math.min(3, out.hornPairs);
  out.backShare = Math.min(0.6, Math.max(0.25, out.backShare));
  out.crestSharp = clamp01(out.crestSharp);
  out.buzz = clamp01(out.buzz);
  out.wingWalk = Math.min(1, out.wingWalk);
  out.plateCount = Math.min(16, out.plateCount);
  out.crownN = Math.min(10, out.crownN);
  out.plateJag = clamp01(out.plateJag);
  out.clubJag = clamp01(out.clubJag);
  out.hornBreak = clamp01(out.hornBreak);
  out.hornGnarl = clamp01(out.hornGnarl);

  // Weak spots: loose scales (plates) near the silhouette's edge, away from the middle of the body,
  // ordered by how far they sit from the torso's middle (small on-screen dragons use the first two).
  const spots: { at: number; side: number; on: number }[] = [];
  for (const w of species.weakSpots) {
    const at = w.at + rng.float() * w.atVar;
    const side = w.side + rng.float() * w.sideVar;
    spots.push({ at, side, on: w.on === 'elbow' ? 1 : 0 });
  }

  const b = species.behavior;
  const eye = b.eyes[rng.int(b.eyes.length)]!;
  const phase = rng.float() * 1000;
  return {
    ...(out as unknown as Morph),
    species,
    seed: seed >>> 0,
    size,
    maturity: m,
    eye: boss ? boss.eye : eye,
    weakSpots: spots,
    phase,
    boss,
    dress: boss ? boss.dress : NO_DRESS,
    grand: boss ? 1 : 0,
    enter: boss?.enter ?? b.enter,
    leave: boss?.leave ?? b.leave,
    swipe: b.swipe,
    breath: b.breath,
  };
}
