// The composed material (pure data). Everything sits on D, agreeing with the SFX's D major
// pentatonic (coins D5..A6, clangs A4..F#5):
//   Meadow   D Mixolydian, 6/8 lilt (168 eighths/min). A low-whistle tune over lute arpeggios and a
//            D-A drone, all below D5 so the SFX keep the high register.
//   Mountain D Dorian, 4/4 at 66. The horn call D-A-G-F | E-C-D is its leitmotif (first heard, huge,
//            when the world wyrm roars). The minor third F lives in the low brass, below the coins.
//   Boss     B minor (the key's dark side: every SFX note is consonant with it), 4/4 at 116, the
//            Meadow's head motif turned minor over a 3+3+2 drum ostinato. A win resolves to D major.
// Themes are 8-bar periods (antecedent ending open, consequent closing on the tonic); the composer
// varies, reharmonizes and develops them, so they recur without ever repeating exactly.
import { MODES, type Scale } from './theory';
import { parseBars, parseLine, type MNote, type Meter } from './score';
import type { Chord } from './theory';

export interface Theme {
  chords: Chord[][];
  melody: MNote[];
}

function theme(chords: string, melody: string, meter: Meter): Theme {
  return { chords: parseBars(chords), melody: parseLine(melody, meter.stepsPerBar) };
}

const D = 2;
const B = 11;

// ---- Meadow ----

export const MEADOW_METER: Meter = { stepsPerBar: 12, secPerStep: 60 / 168 / 2, beatSteps: 6 };
export const MEADOW_SCALE: Scale = { tonic: D, steps: MODES.mixolydian };

// The Meadow's tunes sit in D4-E5, a low whistle's sweet spot: the SFX own D5 and up (coins
// D5-A6, clang partials to 5 kHz), so the melody stays below them and never masks a click.
export const MEADOW_A = theme(
  'D C G D D C G,A7 D',
  'A4:4 F#4:2 A4:4 D5:2 | C5:6 G4:4 A4:2 | B4:4 G4:2 D4:4 G4:2 | A4:6 r:6 | ' +
    'A4:4 F#4:2 A4:4 D5:2 | E5:6 C5:4 D5:2 | B4:4 G4:2 A4:2 G4:2 E4:2 | F#4:2 E4:2 D4:8',
  MEADOW_METER,
);

/** Theme A with the modal (bVII-I) cadence: bars 7-8 replaced. */
export const MEADOW_A_MODAL = theme(
  'D C G D D C G,C D',
  'A4:4 F#4:2 A4:4 D5:2 | C5:6 G4:4 A4:2 | B4:4 G4:2 D4:4 G4:2 | A4:6 r:6 | ' +
    'A4:4 F#4:2 A4:4 D5:2 | E5:6 C5:4 D5:2 | B4:4 G4:2 G4:2 E4:2 C4:2 | D4:12',
  MEADOW_METER,
);

export const MEADOW_B = theme(
  'Bm G D A Bm G Em7,A7 D',
  'D4:2 E4:2 F#4:2 B4:6 | B4:2 A4:2 G4:2 D4:6 | F#4:4 A4:2 D5:4 A4:2 | E5:6 r:6 | ' +
    'B4:4 A4:2 F#4:4 D4:2 | G4:4 A4:2 B4:6 | G4:2 F#4:2 E4:2 A4:4 G4:2 | F#4:6 D4:6',
  MEADOW_METER,
);

/** Development progressions (the head motif is sequenced over them). The last one carries tension. */
export const MEADOW_EPISODES = [
  parseBars('G D/F# Em D C G/B Am D'),
  parseBars('Bm G D A Bm Em C D'),
  parseBars('C G/B Am G C D Em,A7 D'),
];
export const MEADOW_TENSION = parseBars('Bm Bm G G Em Em A A');
export const MEADOW_INTERLUDE = parseBars('D C/D G/D D');
export const MEADOW_DRONE = [50, 57] as const; // D3 A3

// ---- Mountain ----

export const MOUNTAIN_METER: Meter = { stepsPerBar: 16, secPerStep: 60 / 66 / 4, beatSteps: 4 };
export const MOUNTAIN_SCALE: Scale = { tonic: D, steps: MODES.dorian };

/** The Mountain theme; bars 1-2 are the horn call. */
export const MOUNTAIN_M = theme(
  'Dm Am,Dm C G Dm F G,Am Dm',
  'D4:4 A4:8 G4:2 F4:2 | E4:6 C4:2 D4:8 | G4:4 E4:2 G4:2 C5:8 | B4:6 A4:2 G4:8 | ' +
    'D4:4 A4:8 G4:2 F4:2 | C5:6 A4:2 F4:8 | G4:4 B4:4 A4:4 E4:4 | D4:16',
  MOUNTAIN_METER,
);

/** The answering period: higher and more lyrical. */
export const MOUNTAIN_M2 = theme(
  'F C G Dm F C G Dm',
  'A4:6 G4:2 A4:4 C5:4 | G4:6 E4:2 G4:8 | D5:6 C5:2 B4:4 G4:4 | A4:16 | ' +
    'C5:6 A4:2 F4:4 A4:4 | G4:6 E4:2 C4:8 | B3:4 D4:4 G4:4 B4:4 | A4:4 E4:4 D4:8',
  MOUNTAIN_METER,
);

/** Call fragments for the echo episodes (tonic-relative; the far horn answers them). */
export const MOUNTAIN_CALLS = [
  parseLine('D4:4 A4:12', 16),
  parseLine('A4:4 G4:2 F4:2 E4:8', 16),
  parseLine('D4:4 E4:2 F4:2 E4:4 D4:4', 16),
  parseLine('A4:6 C5:2 A4:8', 16),
];
export const MOUNTAIN_ECHO_CHORDS = [parseBars('Dm G Dm C Dm G F Dm'), parseBars('Dm C Dm C G G Dm Dm')];
export const MOUNTAIN_INTERLUDE = parseBars('Dm C/D Dm C/D');
export const MOUNTAIN_DRONE = [38, 45] as const; // D2 A2

// ---- Boss ----

export const BOSS_METER: Meter = { stepsPerBar: 16, secPerStep: 60 / 116 / 4, beatSteps: 4 };
export const BOSS_SCALE: Scale = { tonic: B, steps: MODES.aeolian };

export const BOSS_THEME = theme(
  'Bm Bm G A Bm Bm Em F#sus4',
  'F#4:6 D4:2 F#4:4 B4:4 | D5:6 C#5:2 B4:8 | B4:6 A4:2 G4:4 D4:4 | E4:6 F#4:2 A4:8 | ' +
    'F#4:6 D4:2 F#4:4 B4:4 | D5:6 E5:2 F#5:8 | G5:4 F#5:4 E5:4 B4:4 | C#5:8 B4:8',
  BOSS_METER,
);
export const BOSS_LOOP = parseBars('Bm Bm G A Bm Bm Em F#sus4');
export const BOSS_DRONE = [35, 42] as const; // B1 F#2

/** Frame-drum ostinati (one char per step): D doum, t tak, g ghost. A 3+3+2 drive. */
export const DRUM_BOSS = ['D..t..D..t..D.t.', 'D.gt.gD.gt.gD.tt', 'DgtgD.gtDgtgDttt'] as const;
export const DRUM_MEADOW = 'D...g.t...g.';
export const DRUM_MARCH = 'D.......D...t.t.';

// ---- The zoom cue (the choir's journey from the Meadow to the Mountain) ----

/** Fusion: an A sus4 swell rising a fourth into place (tension on the dominant). */
export const ZOOM_SWELL = [45, 52, 57, 62, 64]; // A2 E3 A3 D4 E4
/** Flash: resolves to D major (E4 -> F#4, E3 -> D3). */
export const ZOOM_FLASH = [45, 50, 57, 62, 66]; // A2 D3 A3 D4 F#4
/** Pull-back: D, then C/D and G/D (wonder), then the Mountain's D minor at the reveal. */
export const ZOOM_PULL = [
  [45, 50, 57, 62, 66],
  [50, 55, 60, 64, 67], // C/D
  [50, 55, 59, 62, 67], // G/D
];
export const ZOOM_REVEAL = [50, 57, 62, 65, 69]; // Dm: D3 A3 D4 F4 A4
/** The high shimmer over the pull-back (D6 A6 E7). */
export const ZOOM_SHIMMER = [86, 93, 100];
/** A harp glissando on the pentatonic (D5 -> D7): the meadow falling away. */
export const ZOOM_GLISS = [74, 76, 78, 81, 83, 86, 88, 90, 93, 95, 98];

/** The victory cadence after a boss falls (in D major): A for a beat, then D held. */
export const VICTORY_A = [45, 52, 57, 61, 64]; // A2 E3 A3 C#4 E4
export const VICTORY_D = [38, 50, 57, 62, 66, 69]; // D2 D3 A3 D4 F#4 A4
