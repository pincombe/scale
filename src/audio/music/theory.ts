// Music theory for the score (pure, no WebAudio, unit-tested): note names <-> MIDI, modes, chord
// symbols, chord tones and voice-led voicings. MIDI 62 = D4 (the SFX's pentatonic root).

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Pitch class 0..11 of a MIDI note. */
export function pc(m: number): number {
  return ((m % 12) + 12) % 12;
}

/** 'F#5' -> 78, 'Bb3' -> 58, 'C4' -> 60. Throws on malformed input (themes are checked in tests). */
export function parseNote(s: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error(`music: bad note '${s}'`);
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** 78 -> 'F#5' (sharps). */
export function noteName(m: number): string {
  return NAMES[pc(m)]! + String(Math.floor(m / 12) - 1);
}

export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Semitone offsets of the modes the score uses. */
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const;

export interface Scale {
  /** Tonic pitch class (2 = D). */
  readonly tonic: number;
  readonly steps: readonly number[];
}

export function inScale(m: number, s: Scale): boolean {
  return s.steps.includes(pc(m - s.tonic));
}

/** The nearest scale note at or beyond `m` in direction `dir` (-1 down, +1 up). */
export function snap(m: number, s: Scale, dir = -1): number {
  let x = m;
  for (let i = 0; i < 12 && !inScale(x, s); i++) x += dir;
  return x;
}

/** Move `n` scale steps from `m` (snapped into the scale first). */
export function scaleStep(m: number, s: Scale, n: number): number {
  let x = snap(m, s, n >= 0 ? -1 : 1);
  const dir = n > 0 ? 1 : -1;
  for (let k = 0; k !== n; k += dir) {
    x += dir;
    for (let i = 0; i < 12 && !inScale(x, s); i++) x += dir;
  }
  return x;
}

// ---- Chords ----

const QUALITY: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 2],
  madd9: [0, 3, 7, 2],
};

export interface Chord {
  readonly name: string;
  /** Root pitch class. */
  readonly root: number;
  /** Bass pitch class (the root unless a slash chord). */
  readonly bass: number;
  /** Pitch classes, root first. */
  readonly pcs: readonly number[];
  /** Pitch class of the third, or -1 for sus/power chords. */
  readonly third: number;
}

function parsePc(s: string): number {
  return pc(LETTER[s[0]!]! + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0));
}

/** 'D', 'Bm', 'A7', 'Dsus4', 'C/D', 'Em7', 'F#sus4', 'D5'... Throws on unknown symbols. */
export function parseChord(sym: string): Chord {
  const m = /^([A-G][#b]?)([a-z0-9]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  const q = m ? QUALITY[m[2]!] : undefined;
  if (!m || !q) throw new Error(`music: bad chord '${sym}'`);
  const root = parsePc(m[1]!);
  const pcs = q.map((i) => pc(root + i));
  const third = q.includes(4) ? pc(root + 4) : q.includes(3) ? pc(root + 3) : -1;
  return { name: sym, root, bass: m[3] ? parsePc(m[3]) : root, pcs, third };
}

export function isChordTone(m: number, ch: Chord): boolean {
  return ch.pcs.includes(pc(m));
}

/** Every chord tone in [lo, hi], ascending. */
export function chordTones(ch: Chord, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (ch.pcs.includes(pc(m))) out.push(m);
  return out;
}

/** The chord tone nearest `m` (ties go down). */
export function nearestChordTone(m: number, ch: Chord): number {
  for (let d = 0; d < 12; d++) {
    if (ch.pcs.includes(pc(m - d))) return m - d;
    if (ch.pcs.includes(pc(m + d))) return m + d;
  }
  return m;
}

/** The lowest note with pitch class `p` at or above `lo`. */
export function pcAtOrAbove(p: number, lo: number): number {
  return lo + pc(p - lo);
}

/**
 * An `n`-note voicing of `ch` inside [lo, hi]. Without `prev` it is close position on the bass;
 * with `prev` each voice moves to the nearest free chord tone (smooth voice leading), then the root
 * and third are guaranteed by moving whichever voice travels least to supply them. Ascending.
 */
export function voicing(ch: Chord, n: number, lo: number, hi: number, prev: readonly number[] | null = null): number[] {
  const tones = chordTones(ch, lo, hi);
  if (tones.length === 0) return [];
  const out: number[] = [];
  if (!prev || prev.length === 0) {
    let i = tones.findIndex((t) => pc(t) === ch.bass);
    if (i < 0) i = 0;
    for (; out.length < n && i < tones.length; i++) out.push(tones[i]!);
    for (let j = tones.length - 1; out.length < n && j >= 0; j--) if (!out.includes(tones[j]!)) out.unshift(tones[j]!);
    return out.sort((a, b) => a - b);
  }
  const sorted = [...prev].sort((a, b) => a - b);
  for (let k = 0; k < n; k++) {
    const p = sorted[Math.min(k, sorted.length - 1)]!;
    let best = -1;
    let bestD = Infinity;
    for (const t of tones) {
      const d = Math.abs(t - p);
      if (!out.includes(t) && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    if (best >= 0) out.push(best);
  }
  for (const need of ch.third >= 0 ? [ch.root, ch.third] : [ch.root]) {
    if (out.some((m) => pc(m) === need)) continue;
    let bi = -1;
    let bm = 0;
    let bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      const cur = out[i]!;
      // Never give up the only root or third to supply the other.
      if (pc(cur) === ch.root && out.filter((x) => pc(x) === ch.root).length === 1) continue;
      if (pc(cur) === ch.third && out.filter((x) => pc(x) === ch.third).length === 1) continue;
      for (const t of tones) {
        if (pc(t) !== need || out.includes(t)) continue;
        const d = Math.abs(t - cur);
        if (d < bd) {
          bd = d;
          bi = i;
          bm = t;
        }
      }
    }
    if (bi >= 0) out[bi] = bm;
  }
  return out.sort((a, b) => a - b);
}
