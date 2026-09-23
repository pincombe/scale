// The score's shared vocabulary (pure): meters, section events, and a tiny text notation for the
// composed material. A melody line is "A5:4 F#5:2 | C6:6 r:6": a note (or `r` for a rest) with
// its length in steps (16ths); a bare token repeats the previous length; `|` asserts a bar line.
// Chords are one symbol per bar, or "G,A7" to split a bar in equal parts.
import { parseChord, parseNote, type Chord } from './theory';

export type MoodId = 'meadow' | 'mountain' | 'boss';
/** Pitched instruments (a KS pluck, the phrase flute, a horn voice, the distant echo horn). */
export type NoteInst = 'lute' | 'harp' | 'flute' | 'horn' | 'echo';
/** Pre-rendered percussion; `roll` is a crescendo that ends at `at + len`. */
export type HitKind = 'doum' | 'tak' | 'timp' | 'roll' | 'sub';
/**
 * Arrangement roles: the gate turns roles on and off at bar lines (energy, tension, and in a boss
 * fight the timer: 'pulse' gives way to 'urgent' as time runs out).
 */
export type Role = 'melody' | 'counter' | 'arp' | 'pad' | 'pulse' | 'heart' | 'echo' | 'bass' | 'urgent';

// Articulation flags.
/** Slurs into the next note (no release, a glide instead of a re-attack). */
export const F_LEGATO = 1;
export const F_ACCENT = 2;
/** A short brassy stab. */
export const F_STAB = 4;
/** A slow swell (pads). */
export const F_SWELL = 8;
/** Last note of a phrase (the flute voice releases after it). */
export const F_PHRASE_END = 16;
/** Damp a pluck at the end of its length instead of letting it ring. */
export const F_DAMP = 32;
/** Fortissimo statement (brighter, wider). */
export const F_BIG = 64;

export interface Meter {
  stepsPerBar: number;
  /** Seconds per step (a 16th). */
  secPerStep: number;
  /** Steps per felt beat (6 in 6/8, 4 in 4/4). */
  beatSteps: number;
}

/** One sound in a section. Times are steps from the section start; `dt` adds seconds (strums, humanizing). */
export interface SEv {
  at: number;
  dt: number;
  len: number;
  inst: NoteInst | HitKind;
  midi: number;
  vel: number;
  flags: number;
  role: Role;
}

export interface Section {
  mood: MoodId;
  /** Form slot: 'intro', 'A', 'B', 'episode', 'interlude', 'M', 'M2', 'echoes', 'ostinato', 'melody', 'break'. */
  kind: string;
  /** Debug label, e.g. 'A (ornamented)'. */
  label: string;
  bars: number;
  meter: Meter;
  /** Chords per bar (one or two). */
  chords: Chord[][];
  /** Sorted by `at`. */
  events: SEv[];
  /** Drone pitches for this section (null = none). */
  drone: readonly number[] | null;
  /** The section wants the choir hum (the Mountain) when the energy allows. */
  choir: boolean;
  /** Chords for the sustained hum when they differ from `chords` (open voicings, clear of the coins). */
  hum?: Chord[][];
}

/** A parsed melody note. */
export interface MNote {
  at: number;
  len: number;
  midi: number;
}

export function parseLine(src: string, stepsPerBar: number): MNote[] {
  const out: MNote[] = [];
  let at = 0;
  let len = stepsPerBar;
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '|') {
      if (at % stepsPerBar !== 0) throw new Error(`music: bar line at step ${at} in '${src}'`);
      continue;
    }
    const [p, l] = tok.split(':');
    if (l !== undefined) len = Number(l);
    if (!(len > 0)) throw new Error(`music: bad length in '${tok}'`);
    if (p !== 'r') out.push({ at, len, midi: parseNote(p!) });
    at += len;
  }
  if (at % stepsPerBar !== 0) throw new Error(`music: line ends mid-bar (${at} steps) in '${src}'`);
  return out;
}

/** 'D C G,A7 D' -> [[D], [C], [G, A7], [D]]. */
export function parseBars(src: string): Chord[][] {
  return src
    .trim()
    .split(/\s+/)
    .map((bar) => bar.split(',').map(parseChord));
}

/** The chord sounding at `step` of a bar (split bars divide evenly). */
export function chordAt(bar: readonly Chord[], step: number, stepsPerBar: number): Chord {
  const i = Math.min(bar.length - 1, Math.floor((step / stepsPerBar) * bar.length));
  return bar[Math.max(0, i)]!;
}

/** Total length of a melody line in steps. */
export function lineSteps(notes: readonly MNote[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.at + n.len);
  return end;
}
