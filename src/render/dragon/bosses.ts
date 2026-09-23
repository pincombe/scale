// Tier bosses as data: a boss is its tier's species (state.dragon.species) dressed up. Core makes it
// bigger and tougher and names it (DragonState.boss); here it gets morph overrides (heavier, more
// horns, rock), dressings the painter adds (moss, scars, cataracts, snow, torn wings), its own
// eyes, a slower tempo and grander entrance and exit styles. Each is dressed for one species: on
// another (a debug edit), it keeps only its grandeur. Unknown ids are ordinary dragons.
// Type-only imports: species.ts imports this module's values.
import type { EnterStyle, LeaveStyle, Morph } from './species';

export interface BossDress {
  /** Moss and lichen tufts along the crest and back, beard strands under the jaw (0..1). */
  moss: number;
  /** Healed claw scars across the flank, neck and face (count, 0 = none). */
  scars: number;
  /** Milky, pale-glowing cataract eyes (0..1). */
  cataract: number;
  /** A mantle of snow on the back plates and along the back (0..1). */
  snow: number;
  /** Torn wing membranes: holes and a ragged trailing edge (0..1). */
  torn: number;
  /** Extra eye glow (0 = ordinary). */
  eyeGlow: number;
}

export const NO_DRESS: BossDress = { moss: 0, scars: 0, cataract: 0, snow: 0, torn: 0, eyeGlow: 0 };

export interface BossDef {
  id: string;
  /** The species it is dressed for: on any other species the dressing is ignored. */
  species: string;
  /** Morph overrides, applied over the species' (after jitter and variants). */
  over: Partial<Morph>;
  dress: BossDress;
  /** Eye color. */
  eye: string;
  /** Animation tempo multiplier: < 1 = slower, heavier, more dignified. */
  tempo: number;
  /** Entrance and exit styles (override the species'). */
  enter?: EnterStyle;
  leave?: LeaveStyle;
}

/**
 * The Elder Newt (end of the Meadow): ancient and heavy. A lichen-and-moss crest, a gnarled crown
 * of broken horns, old scars, pale glowing cataract eyes; it walks in, slow and dignified.
 */
const ELDER_NEWT: BossDef = {
  id: 'elderNewt',
  species: 'newt',
  over: {
    thickShoulder: 0.068,
    thickBelly: 0.078,
    thickHip: 0.06,
    // Up on long, heavy legs (a long, slow stride when it walks), belly well off the ground.
    clearance: 0.085,
    legBend: 1.5,
    neckRaise: 0.66,
    headTilt: -0.14,
    tailDroop: 0.2,
    cranium: 0.4,
    brow: 0.11,
    eyeSize: 0.085,
    teeth: 0.7,
    hornLen: 0.62,
    hornPairs: 3,
    hornCurl: 0.38,
    hornWidth: 0.17,
    hornBreak: 0.5,
    hornGnarl: 0.9,
    crownN: 4,
    crownLen: 0.2,
    gills: 0.28,
    whiskers: 0.55,
    crest: 0.03,
    crestSharp: 0.35,
    crestSpikes: 13,
    legWidth: 0.034,
    claws: 1,
    wingSpan: 0.17,
    buzz: 0.4,
    tailSpade: 0.05,
  },
  dress: { moss: 1, scars: 4, cataract: 1, snow: 0, torn: 0, eyeGlow: 0.3 },
  eye: '#a8c8d8',
  tempo: 0.62,
  enter: 'walk',
  leave: 'walk',
};

/**
 * Grimmaw of the Peaks (end of the Mountain): a colossal wyvern. A mantle of snow on its back
 * plates, a jagged crown of rock, glowing eyes, a torn wing membrane; it glides in and roars.
 */
const GRIMMAW: BossDef = {
  id: 'grimmaw',
  species: 'wyvern',
  over: {
    thickShoulder: 0.066,
    thickBelly: 0.064,
    thickNeck: 0.04,
    plates: 0.09,
    plateCount: 10,
    plateJag: 1,
    crownN: 9,
    crownLen: 0.5,
    hornLen: 0.72,
    hornWidth: 0.17,
    hornCurl: 0.45,
    brow: 0.12,
    wingSpan: 0.56,
    tailClub: 0.062,
    tailSpade: 0,
    clubJag: 1,
    crest: 0.03,
    teeth: 1,
  },
  dress: { moss: 0, scars: 3, cataract: 0, snow: 1, torn: 1, eyeGlow: 1 },
  eye: '#ff5c22',
  tempo: 0.75,
  enter: 'glide',
  leave: 'fly',
};

export const BOSSES: Readonly<Record<string, BossDef>> = { elderNewt: ELDER_NEWT, grimmaw: GRIMMAW };

/** The boss for DragonState.boss (null or an unknown id: an ordinary dragon). */
export function bossOf(id: string | null | undefined): BossDef | null {
  return id ? BOSSES[id] ?? null : null;
}
