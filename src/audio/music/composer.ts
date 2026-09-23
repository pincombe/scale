// The composer (pure, seeded, unit-tested): builds one Section of the score at a time from the
// composed material in themes.ts. Themes are restated with variations (ornaments, a new lead
// instrument, answers in the melody's rests); episodes develop the Meadow's head motif by sequence
// over new progressions; the Mountain's echoes trade call fragments between a near and a far horn.
// Every role is composed here; the conductor's energy gate decides per bar which roles sound.
import type { Rng } from '../../lib/rng';
import {
  chordAt,
  F_ACCENT,
  F_BIG,
  F_DAMP,
  F_LEGATO,
  F_PHRASE_END,
  F_STAB,
  F_SWELL,
  type HitKind,
  type Meter,
  type MNote,
  type MoodId,
  type NoteInst,
  type Role,
  type SEv,
  type Section,
} from './score';
import { chordTones, inScale, isChordTone, parseChord, pc, scaleStep, transposeChord, voicing, type Chord, type Scale } from './theory';
import * as T from './themes';

export interface ComposeCtx {
  rng: Rng;
  /** 0..1: army and progress (density, extra layers). */
  energy: number;
  /** 0..1: the Wyrm Gauge nearing full. */
  tension: number;
  /** 0..1: a boss fight running out of time (or nearly won). */
  urgency: number;
  tier: number;
  /** The Mountain's first theme after the zoom: the horn call, fortissimo. */
  big?: boolean;
  /** Transposition in semitones (the Mountain's E Dorian laps: 2). */
  key?: number;
}

/** Builds sections into a reusable event list. */
class Builder {
  readonly ev: SEv[] = [];
  constructor(
    readonly meter: Meter,
    readonly rng: Rng,
  ) {}

  /** Humanize: a few ms of timing jitter (seconds). */
  j(ms: number): number {
    return (this.rng.float() * 2 - 1) * ms * 0.001;
  }

  add(at: number, len: number, inst: NoteInst | HitKind, midi: number, vel: number, role: Role, flags = 0, dt = 0): void {
    this.ev.push({ at, dt, len, inst, midi, vel: Math.max(0, Math.min(1, vel)), flags, role });
  }

  /**
   * A melody line starting at step `at0`. Slurs steps and small leaps into the next note, marks
   * phrase ends at rests, and shapes each 4-bar phrase with a gentle arch and downbeat accents.
   */
  line(notes: readonly MNote[], at0: number, inst: NoteInst, role: Role, vel: number, transpose = 0, flags = 0): void {
    const bar = this.meter.stepsPerBar;
    const phrase = bar * 4;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      const nx = notes[i + 1];
      let f = flags;
      const gap = nx ? nx.at - (n.at + n.len) : Infinity;
      // Any rest is a breath: the phrase ends there (the flute voice releases).
      if (gap > 0.01) f |= F_PHRASE_END;
      else if (nx && Math.abs(nx.midi - n.midi) <= 4 && nx.midi !== n.midi && n.len >= 1) f |= F_LEGATO;
      const pos = (n.at % phrase) / phrase;
      let v = vel * (0.9 + 0.16 * Math.sin(Math.PI * pos));
      if (n.at % bar === 0) v *= 1.06;
      this.add(at0 + n.at, n.len, inst, n.midi + transpose, v * (0.96 + this.rng.float() * 0.08), role, f, this.j(5));
    }
  }

  /** Drum pattern chars per step: D doum, t tak, g ghost tak. */
  drums(pattern: string, at0: number, bars: number, vel: number, role: Role = 'pulse'): void {
    const n = pattern.length;
    for (let b = 0; b < bars; b++) {
      for (let s = 0; s < n; s++) {
        const c = pattern[s];
        const at = at0 + b * n + s;
        if (c === 'D') this.add(at, 1, 'doum', 0, vel * (s === 0 ? 1 : 0.86), role, 0, s === 0 ? 0 : this.j(3));
        else if (c === 't') this.add(at, 1, 'tak', 0, vel * 0.62, role, 0, this.j(4));
        else if (c === 'g') this.add(at, 1, 'tak', 0, vel * 0.26, role, 0, this.j(6));
      }
    }
  }

  /** Voice-led sustained chords, one per chord segment, starting at bar `b0` of `chords`. */
  pads(chords: readonly Chord[][], at0: number, inst: NoteInst, lo: number, hi: number, n: number, vel: number, role: Role, flags = F_SWELL): void {
    const bar = this.meter.stepsPerBar;
    let prev: number[] | null = null;
    for (let b = 0; b < chords.length; b++) {
      const segs = chords[b]!;
      const segLen = bar / segs.length;
      for (let k = 0; k < segs.length; k++) {
        const v = voicing(segs[k]!, n, lo, hi, prev);
        prev = v;
        for (const m of v) this.add(at0 + b * bar + k * segLen, segLen, inst, m, vel, role, flags, this.j(8));
      }
    }
  }

  /** The Meadow's lute: broken chords in 6/8 (sparse, flowing, or flowing with 16th turns). */
  luteArp(chords: readonly Chord[][], at0: number, density: number, vel: number): void {
    const bar = this.meter.stepsPerBar;
    for (let b = 0; b < chords.length; b++) {
      const t0 = at0 + b * bar;
      const tones = (step: number): number[] => luteTones(chordAt(chords[b]!, step, bar));
      if (density === 0) {
        const lo = tones(0);
        this.add(t0, 6, 'lute', lo[0]!, vel, 'arp', F_ACCENT);
        const hi = tones(6);
        this.add(t0 + 6, 6, 'lute', hi[1]!, vel * 0.72, 'arp', 0, 0.004);
        this.add(t0 + 6, 6, 'lute', hi[2]!, vel * 0.66, 'arp', 0, 0.024);
        continue;
      }
      const order = [0, 1, 2, 3, 2, 1];
      for (let i = 0; i < 6; i++) {
        const step = i * 2;
        const t = tones(step);
        const accent = step === 0 ? 1.1 : step === 6 ? 0.95 : 0.8;
        if (density >= 2 && i === 3) {
          // A quick turn off the top note: up a step and back (16ths).
          const top = t[3]!;
          this.add(t0 + step, 1, 'lute', top, vel * 0.85, 'arp', 0, this.j(4));
          this.add(t0 + step + 1, 1, 'lute', scaleStep(top, T.MEADOW_SCALE, 1), vel * 0.6, 'arp', 0, this.j(4));
          continue;
        }
        this.add(t0 + step, 2, 'lute', t[order[i]!]!, vel * accent * (0.94 + this.rng.float() * 0.1), 'arp', step === 0 ? F_ACCENT : 0, this.j(6));
      }
    }
  }

  /** An upward harp sweep in 16ths from about D4, on the chord at step `at`. */
  sweep(ch: Chord, at: number, count: number, vel: number, role: Role, lo = 62): void {
    const tones = chordTones(ch, lo, lo + 26);
    for (let i = 0; i < count && i < tones.length; i++) {
      this.add(at + i, i === count - 1 ? 8 : 2, 'harp', tones[i]!, vel * (0.7 + 0.3 * (i / count)), role, 0, this.j(3));
    }
  }

  /** Harp broken chords in 8ths from the bass up and back (the Mountain's lyre). */
  harpArp(chords: readonly Chord[][], at0: number, vel: number): void {
    const bar = this.meter.stepsPerBar;
    const order = [0, 1, 2, 3, 4, 3, 2, 1];
    for (let b = 0; b < chords.length; b++) {
      for (let i = 0; i < bar / 2; i++) {
        const step = i * 2;
        const ch = chordAt(chords[b]!, step, bar);
        const tones = chordTones(ch, pcFloor(ch.bass, 50), 81);
        const m = tones[order[i % 8]!] ?? tones[0]!;
        this.add(at0 + b * bar + step, 4, 'harp', m, vel * (step % 8 === 0 ? 1 : 0.8), 'counter', 0, this.j(6));
      }
    }
  }

  sort(): SEv[] {
    const sps = this.meter.secPerStep;
    this.ev.sort((a, b) => a.at + a.dt / sps - (b.at + b.dt / sps));
    return this.ev;
  }
}

/** The lowest note of pitch class `p` at or above `lo`. */
function pcFloor(p: number, lo: number): number {
  return lo + pc(p - lo);
}

/** Lute chord shape: bass in G2..F#3, then chord tones stacked about a fourth or more apart. */
export function luteTones(ch: Chord): number[] {
  const bass = pcFloor(ch.bass, 43);
  const out = [bass];
  let last = bass;
  for (const gap of [5, 3, 3]) {
    let m = last + gap;
    while (!isChordTone(m, ch)) m++;
    out.push(m);
    last = m;
  }
  return out;
}

// ---- Motifs ----

/** A motif: chord-tone slots (1 root, 3 third, 5 fifth, 8 root above) with a direction from the previous note. */
type Motif = readonly (readonly [slot: number, dir: number])[];

const HEAD: Motif = [[5, 0], [3, -1], [5, 1], [8, 1]];
const HEAD_INV: Motif = [[8, 0], [5, -1], [3, -1], [5, 1]];
const ANSWER: Motif = [[8, 0], [5, -1], [3, -1]];

function slotPc(ch: Chord, slot: number): number {
  if (slot === 3) return ch.third >= 0 ? ch.third : ch.pcs[1]!;
  if (slot === 5) return ch.pcs.length >= 3 ? ch.pcs[2]! : ch.pcs[1]!;
  return ch.root;
}

function place(p: number, from: number, dir: number): number {
  if (dir > 0) return from + 1 + pc(p - from - 1);
  if (dir < 0) return from - 1 - pc(from - 1 - p);
  const up = from + pc(p - from);
  return up - from <= 6 ? up : up - 12;
}

/**
 * Realize a motif over a chord near `ref` inside [lo, hi]. The whole motif moves by octaves to fit
 * (so its contour survives); only a motif wider than the range folds single notes.
 */
export function realize(m: Motif, ch: Chord, ref: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  let prev = ref;
  for (const [slot, dir] of m) {
    const x = place(slotPc(ch, slot), prev, dir);
    out.push(x);
    prev = x;
  }
  let best = 0;
  let bestMiss = Infinity;
  for (const k of [0, -12, 12, -24, 24]) {
    let miss = 0;
    for (const x of out) miss += Math.max(0, lo - (x + k), x + k - hi);
    if (miss < bestMiss) {
      bestMiss = miss;
      best = k;
    }
  }
  for (let i = 0; i < out.length; i++) {
    let x = out[i]! + best;
    while (x > hi) x -= 12;
    while (x < lo) x += 12;
    out[i] = x;
  }
  return out;
}

/**
 * A cadence bar in the head rhythm (q e q e) falling into `target`: chord tones on both beats, a
 * passing tone between them, and a leading note (a chord tone if one neighbors the target, e.g.
 * C# over A7, or the Mixolydian b7 over C) into the landing.
 */
export function cadenceFigure(bar: readonly Chord[], target: number, scale: Scale, spb: number): number[] {
  const at0 = chordAt(bar, 0, spb);
  const at6 = chordAt(bar, spb / 2, spb);
  const at10 = chordAt(bar, spb - 2, spb);
  let n0 = target + 4;
  let bestD = Infinity;
  for (const m of chordTones(at0, target + 2, target + 6)) {
    if (Math.abs(m - (target + 4)) < bestD) {
      bestD = Math.abs(m - (target + 4));
      n0 = m;
    }
  }
  if (!inScale(n0, scale) && !isChordTone(n0, at0)) n0 = scaleStep(target, scale, 2);
  const n1 = scaleStep(n0, scale, -1);
  const below = chordTones(at6, target + 1, Math.min(target + 5, n1 - 1));
  const n2 = below.length > 0 ? below[below.length - 1]! : scaleStep(target, scale, 1);
  let n3 = scaleStep(target, scale, -1);
  let best = -Infinity;
  for (const m of [target + 2, target + 1, target - 1, target - 2]) {
    const ct = isChordTone(m, at10);
    if (!ct && !inScale(m, scale)) continue;
    const score = (ct ? 10 : 0) + (m !== n2 ? 5 : 0) - Math.abs(m - n2) * 0.1;
    if (score > best) {
      best = score;
      n3 = m;
    }
  }
  return [n0, n1, n2, n3];
}

// ---- Variations ----

/** Irish-style flute ornaments: cuts (a grace from the step above) on long notes, rolls on the longest. */
export function ornament(notes: readonly MNote[], scale: Scale, rng: Rng, p: number): MNote[] {
  const out: MNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    const last = i === notes.length - 1;
    if (!last && n.len >= 4 && n.midi < 86 && rng.chance(p)) {
      const up = scaleStep(n.midi, scale, 1);
      if (n.len >= 6 && rng.chance(0.5)) {
        // Roll: main, cut above, main, tap below, main.
        out.push({ at: n.at, len: 1, midi: n.midi });
        out.push({ at: n.at + 1, len: 0.5, midi: up });
        out.push({ at: n.at + 1.5, len: 0.5, midi: n.midi });
        out.push({ at: n.at + 2, len: 0.5, midi: scaleStep(n.midi, scale, -1) });
        out.push({ at: n.at + 2.5, len: n.len - 2.5, midi: n.midi });
        continue;
      }
      out.push({ at: n.at, len: 0.5, midi: up });
      out.push({ at: n.at + 0.5, len: n.len - 0.5, midi: n.midi });
      continue;
    }
    // A passing tone through a third.
    const nx = notes[i + 1];
    if (nx && n.len >= 4 && nx.at === n.at + n.len && Math.abs(nx.midi - n.midi) >= 3 && Math.abs(nx.midi - n.midi) <= 4 && rng.chance(p * 0.6)) {
      const mid = scaleStep(n.midi, scale, nx.midi > n.midi ? 1 : -1);
      out.push({ at: n.at, len: n.len - 1, midi: n.midi });
      out.push({ at: n.at + n.len - 1, len: 1, midi: mid });
      continue;
    }
    out.push(n);
  }
  return out;
}

/** Rests of at least `min` steps inside the line: [start, length]. */
function rests(notes: readonly MNote[], total: number, min: number): [number, number][] {
  const out: [number, number][] = [];
  let end = 0;
  for (const n of notes) {
    if (n.at - end >= min) out.push([end, n.at - end]);
    end = Math.max(end, n.at + n.len);
  }
  if (total - end >= min) out.push([end, total - end]);
  return out;
}

// ---- Sections ----

const SEC: Record<MoodId, Meter> = { meadow: T.MEADOW_METER, mountain: T.MOUNTAIN_METER, boss: T.BOSS_METER };

function section(mood: MoodId, kind: string, label: string, chords: Chord[][], b: Builder, drone: readonly number[] | null, choir = false): Section {
  return { mood, kind, label, bars: chords.length, meter: b.meter, chords, events: b.sort(), drone, choir };
}

/** Compose one section of `mood`. `kind` and `variant` come from the form (form.ts). */
export function composeSection(mood: MoodId, kind: string, variant: number, ctx: ComposeCtx): Section {
  if (mood === 'meadow') return meadow(kind, variant, ctx);
  if (mood === 'mountain') return mountain(kind, variant, ctx);
  return boss(kind, variant, ctx);
}

function meadowBed(b: Builder, chords: Chord[][], ctx: ComposeCtx, quiet: boolean): void {
  const e = ctx.energy;
  const density = quiet || e < 0.3 ? 0 : e < 0.62 ? 1 : 2;
  b.luteArp(chords, 0, density, 0.5 + 0.18 * e);
  if (quiet) return;
  b.pads(chords, 0, 'horn', 45, 62, 3, 0.2 + 0.12 * e, 'pad');
  for (let bar = 0; bar < chords.length; bar++) {
    const t0 = bar * 12;
    b.drums(T.DRUM_MEADOW, t0, 1, 0.34 + 0.2 * e);
    // Heartbeat (the gauge filling): a low D, then a softer A below it.
    b.add(t0, 6, 'timp', 38, 0.24 + 0.2 * ctx.tension, 'heart');
    b.add(t0 + 2, 6, 'timp', 33, 0.15 + 0.12 * ctx.tension, 'heart');
    if (bar % 4 === 0) b.sweep(chords[bar]![0]!, t0, 6, 0.3 + 0.12 * e, 'counter', 50);
  }
}

function meadow(kind: string, v: number, ctx: ComposeCtx): Section {
  const b = new Builder(T.MEADOW_METER, ctx.rng);
  const drone = T.MEADOW_DRONE;
  const vel = 0.62 + 0.2 * ctx.energy;
  if (kind === 'intro') {
    const chords = T.MEADOW_INTERLUDE.slice(0, 2);
    b.sweep(chords[0]![0]!, 0, 6, 0.36, 'melody', 50);
    b.luteArp(chords.slice(1), 12, 0, 0.44);
    b.add(18, 12, 'harp', 62, 0.3, 'melody');
    b.add(20, 10, 'harp', 57, 0.24, 'melody');
    return section('meadow', kind, 'intro', chords, b, drone);
  }
  if (kind === 'interlude') {
    const chords = T.MEADOW_INTERLUDE;
    meadowBed(b, chords, ctx, true);
    // A slow harp line falling through the bars, like a breath out.
    const line = [74, 72, 71, 69];
    for (let i = 0; i < 4; i++) b.add(i * 12 + 6, 12, 'harp', line[i]! - (v % 2) * 12, 0.26, 'melody', 0, b.j(6));
    return section('meadow', kind, 'interlude', chords, b, drone);
  }
  if (kind === 'episode') {
    const tense = ctx.tension >= 0.45;
    const chords = tense ? T.MEADOW_TENSION : T.MEADOW_EPISODES[v % T.MEADOW_EPISODES.length]!;
    meadowBed(b, chords, ctx, false);
    // Bars 1-4: the head motif sequenced down the progression, flute calling, harp answering an
    // octave below. Each call starts on the fifth nearest the last call's start (a true sequence).
    let callRef = 69;
    for (let bar = 0; bar < 4; bar++) {
      const ch = chords[bar]![0]!;
      const call = bar % 2 === 0;
      const notes = realize(bar < 2 ? HEAD : HEAD_INV, ch, call ? callRef : callRef - 12, call ? 60 : 48, call ? 79 : 67);
      const lens = [4, 2, 4, 2];
      let at = bar * 12;
      for (let i = 0; i < 4; i++) {
        const f = i === 3 ? F_PHRASE_END : Math.abs(notes[i + 1]! - notes[i]!) <= 4 ? F_LEGATO : 0;
        b.add(at, lens[i]!, call ? 'flute' : 'harp', notes[i]!, (call ? vel : vel * 0.8) * (i === 0 ? 1.05 : 0.95), 'melody', f, b.j(5));
        at += lens[i]!;
      }
      if (call) callRef = notes[0]!;
    }
    // Bars 5-6: fragmentation, the last two notes of the motif passed between them.
    for (let bar = 4; bar < 6; bar++) {
      const ch = chords[bar]![0]!;
      const flute = bar === 4;
      const [hi, lo] = realize([[8, 0], [5, -1]], ch, flute ? 72 : 64, flute ? 60 : 48, flute ? 79 : 67);
      const inst: NoteInst = flute ? 'flute' : 'harp';
      b.add(bar * 12, 6, inst, hi!, vel * 0.9, 'melody', F_LEGATO, b.j(5));
      b.add(bar * 12 + 6, 6, inst, lo!, vel * 0.8, 'melody', F_PHRASE_END, b.j(5));
    }
    // Bar 7: a cadence figure into bar 8's landing: the tonic (D4), or E4 over the dominant when
    // the gauge is nearly full (the next section resolves it).
    const target = tense ? 64 : 62;
    const fig = cadenceFigure(chords[6]!, target, T.MEADOW_SCALE, 12);
    const lens = [4, 2, 4, 2];
    for (let i = 0; i < 4; i++) b.add(72 + [0, 4, 6, 10][i]!, lens[i]!, 'flute', fig[i]!, vel * (0.95 - i * 0.05), 'melody', F_LEGATO, b.j(4));
    b.add(84, 12, 'flute', target, vel * 0.9, 'melody', F_PHRASE_END, b.j(4));
    return section('meadow', kind, tense ? 'episode (tension)' : `episode ${(v % 3) + 1}`, chords, b, drone);
  }
  // Themes A and B.
  const th = kind === 'B' ? T.MEADOW_B : v % 2 === 1 ? T.MEADOW_A_MODAL : T.MEADOW_A;
  meadowBed(b, th.chords, ctx, false);
  const recipe = v % 4;
  let lead: NoteInst = 'flute';
  let mel: MNote[] = th.melody;
  let label = kind;
  if (recipe === 1) {
    mel = ornament(mel, T.MEADOW_SCALE, ctx.rng, 0.55);
    label += ' (ornamented)';
  } else if (recipe === 2) {
    lead = 'harp';
    label += ' (harp)';
  } else if (recipe === 3) {
    mel = ornament(mel, T.MEADOW_SCALE, ctx.rng, 0.35);
    label += ' (doubled)';
  }
  b.line(mel, 0, lead, 'melody', lead === 'harp' ? vel * 0.85 : vel);
  // The harp doubles the tune an octave below once the army has grown.
  if (recipe === 3) b.line(th.melody, 0, 'harp', 'counter', vel * 0.5, -12);
  // Answers in the melody's rests: the harp replies an octave down (or the flute, when the harp leads).
  for (const [at, len] of rests(th.melody, th.chords.length * 12, 6)) {
    const bar = Math.floor(at / 12);
    const ch = chordAt(th.chords[bar]!, at % 12, 12);
    const notes = realize(ANSWER, ch, lead === 'harp' ? 69 : 64, lead === 'harp' ? 60 : 50, lead === 'harp' ? 76 : 69);
    const n = Math.min(notes.length, Math.floor(len / 2));
    for (let i = 0; i < n; i++) {
      b.add(at + i * 2, i === n - 1 ? len - i * 2 : 2, lead === 'harp' ? 'flute' : 'harp', notes[i]!, vel * 0.72, 'melody', i === n - 1 ? F_PHRASE_END : F_LEGATO, b.j(5));
    }
  }
  return section('meadow', kind, label, th.chords, b, drone);
}

/** Transposition (0, +7, -5, +5, -7) that best fits a call fragment to a chord. */
function fitCall(frag: readonly MNote[], ch: Chord, scale: Scale): number {
  let best = 0;
  let bestScore = -Infinity;
  for (const tr of [0, 7, -5, 5, -7]) {
    let s = 0;
    for (const n of frag) {
      const m = n.midi + tr;
      if (!inScale(m, scale)) s -= 10;
      // The Dorian minor third stays below D5, clear of the coins' F#.
      if (pc(m) === 5 && m >= 74) s -= 20;
      if (isChordTone(m, ch)) s += n.len;
    }
    if (isChordTone(frag[0]!.midi + tr, ch)) s += 4;
    s -= Math.abs(tr) * 0.1;
    if (s > bestScore) {
      bestScore = s;
      best = tr;
    }
  }
  return best;
}

/**
 * A sustained-voicing copy of a chord with its F natural (a semitone under the coins' F#) moved to
 * E: Dm becomes Dsus2 (open), F becomes A minor over the F in the bass (Fmaj7 without its root).
 * Melodies keep their F; the pads, the choir hum and the harp's arpeggios use these.
 */
export function openChord(ch: Chord): Chord {
  if (!ch.pcs.includes(5)) return ch;
  const pcs = [...new Set(ch.pcs.map((p) => (p === 5 ? 4 : p)))];
  if (ch.root === 5) return { ...ch, pcs, root: 9, third: 0 };
  return { ...ch, pcs, third: ch.third === 5 ? -1 : ch.third };
}

const PITCHED = new Set<string>(['lute', 'harp', 'flute', 'horn', 'echo', 'timp', 'roll']);

/** Move a composed section to another key (the Mountain's E Dorian laps): pitches, chords, drone. */
function transpose(sec: Section, n: number): Section {
  if (!n) return sec;
  for (const e of sec.events) if (PITCHED.has(e.inst)) e.midi += n;
  sec.chords = sec.chords.map((bar) => bar.map((c) => transposeChord(c, n)));
  if (sec.hum) sec.hum = sec.hum.map((bar) => bar.map((c) => transposeChord(c, n)));
  if (sec.drone) sec.drone = sec.drone.map((m) => m + n);
  sec.label += ` · ${transposeChord(parseChord('D'), n).name} Dorian`;
  return sec;
}

function mountainBed(b: Builder, chords: Chord[][], ctx: ComposeCtx, harp: boolean): void {
  const e = ctx.energy;
  // In the D laps the sustained voices stay open (no F natural against the coins); E Dorian has none.
  const held = ctx.key ? chords : chords.map((bar) => bar.map(openChord));
  b.pads(held, 0, 'horn', 45, 62, 3, 0.26 + 0.1 * e, 'pad');
  // Bass: the chord's bass under the drone when it moves off D (an F down here is only the root).
  for (let bar = 0; bar < chords.length; bar++) {
    const ch = chords[bar]![0]!;
    if (ch.bass !== 2) b.add(bar * 16, 16, 'horn', pcFloor(ch.bass, 36), 0.26, 'bass', F_SWELL);
    b.drums(T.DRUM_MARCH, bar * 16, 1, 0.3 + 0.14 * e);
    if (bar % 4 === 0) b.add(bar * 16, 8, 'timp', 38, 0.36 + 0.16 * e, 'heart');
    if (bar % 4 === 3) b.add(bar * 16 + 8, 8, 'roll', 38, 0.3 + 0.14 * e + 0.2 * ctx.tension, 'heart');
  }
  if (harp) b.harpArp(held, 0, 0.26 + 0.1 * e);
}

/** The hum's chords: open in the D laps. */
function humOf(chords: Chord[][], ctx: ComposeCtx): Chord[][] | undefined {
  return ctx.key ? undefined : chords.map((bar) => bar.map(openChord));
}

function mountain(kind: string, v: number, ctx: ComposeCtx): Section {
  const b = new Builder(T.MOUNTAIN_METER, ctx.rng);
  const drone = T.MOUNTAIN_DRONE;
  const vel = 0.6 + 0.18 * ctx.energy;
  const done = (label: string, chords: Chord[][], choir: boolean): Section => {
    const sec = section('mountain', kind, label, chords, b, drone, choir);
    sec.hum = humOf(chords, ctx);
    return transpose(sec, ctx.key ?? 0);
  };
  if (kind === 'intro') {
    const chords = T.MOUNTAIN_INTERLUDE.slice(0, 2);
    b.line(T.MOUNTAIN_CALLS[0]!, 4, 'echo', 'echo', 0.5);
    b.add(24, 8, 'roll', 38, 0.34, 'melody');
    return done('intro', chords, false);
  }
  if (kind === 'interlude') {
    const chords = T.MOUNTAIN_INTERLUDE;
    b.pads(ctx.key ? chords : chords.map((bar) => bar.map(openChord)), 0, 'horn', 50, 65, 3, 0.2, 'pad');
    b.add(56, 8, 'roll', 38, 0.28, 'melody');
    for (let i = 0; i < 3; i++) b.add(i * 16 + 8, 12, 'harp', [81, 79, 76][i]!, 0.22, 'melody', 0, b.j(8));
    return done('interlude', chords, true);
  }
  if (kind === 'echoes') {
    const chords = T.MOUNTAIN_ECHO_CHORDS[v % T.MOUNTAIN_ECHO_CHORDS.length]!;
    mountainBed(b, chords, ctx, false);
    for (let bar = 0; bar < 8; bar += 2) {
      const frag = T.MOUNTAIN_CALLS[ctx.rng.int(T.MOUNTAIN_CALLS.length)]!;
      const tr = fitCall(frag, chords[bar]![0]!, T.MOUNTAIN_SCALE);
      b.line(frag, bar * 16, 'horn', 'melody', vel, tr);
      if (bar < 6) {
        const tr2 = fitCall(frag, chords[bar + 1]![0]!, T.MOUNTAIN_SCALE);
        b.line(frag, bar * 16 + 16, 'echo', 'echo', vel * 0.62, tr2);
      }
    }
    // The last echo carries the call's own ending home: E-C-D.
    b.line([{ at: 0, len: 4, midi: 64 }, { at: 4, len: 4, midi: 60 }, { at: 8, len: 8, midi: 62 }], 112, 'echo', 'echo', vel * 0.62);
    return done(`echoes ${(v % 2) + 1}`, chords, false);
  }
  if (kind === 'episode') {
    // Development: the call's head (root, up a fifth, down by steps) sequenced over each chord,
    // climbing or sinking with the progression, the horns doubling at the octave as it builds;
    // then its rising fifth alone, passed from the near horn to the far one; a cadence; home.
    const chords = T.MOUNTAIN_EPISODES[v % T.MOUNTAIN_EPISODES.length]!;
    const S = T.MOUNTAIN_SCALE;
    mountainBed(b, chords, ctx, true);
    let r = 62;
    for (let bar = 0; bar < 4; bar++) {
      if (bar > 0) r = place(chords[bar]![0]!.root, r, 0);
      const notes = [r, scaleStep(r, S, 4), scaleStep(r, S, 3), scaleStep(r, S, 2)];
      const line = [0, 4, 12, 14].map((at, i) => ({ at, len: [4, 8, 2, 2][i]!, midi: notes[i]! }));
      const v2 = vel * (0.9 + 0.05 * bar);
      b.line(line, bar * 16, 'horn', 'melody', v2);
      if (bar >= 2) b.line(line, bar * 16, 'horn', 'melody', v2 * 0.55, -12);
    }
    for (let bar = 4; bar < 6; bar++) {
      const f = place(chords[bar]![0]!.root, 62, 0);
      const line = [
        { at: 0, len: 4, midi: f },
        { at: 4, len: 12, midi: scaleStep(f, S, 4) },
      ];
      b.line(line, bar * 16, bar === 4 ? 'horn' : 'echo', bar === 4 ? 'melody' : 'echo', bar === 4 ? vel : vel * 0.65);
    }
    const fig = cadenceFigure(chords[6]!, 62, S, 16);
    b.line(fig.map((m, i) => ({ at: i * 4, len: 4, midi: m })), 96, 'horn', 'melody', vel * 0.95);
    b.line([{ at: 0, len: 16, midi: 62 }], 112, 'horn', 'melody', vel);
    b.line([{ at: 0, len: 16, midi: 50 }], 112, 'horn', 'melody', vel * 0.5);
    return done(`episode ${(v % 2) + 1}`, chords, true);
  }
  // Themes: M (plain, echoed, octaves, reharmonized) and its answer M2 (plain, echoed, octaves).
  const recipe = kind === 'M2' ? v % 3 : v % 4;
  const th = kind === 'M2' ? T.MOUNTAIN_M2 : recipe === 3 ? T.MOUNTAIN_M_REHARM : T.MOUNTAIN_M;
  mountainBed(b, th.chords, ctx, kind === 'M2' || recipe >= 2);
  let label = kind;
  if (ctx.big && kind === 'M') {
    // The horn call, fortissimo in octaves, the timpani under its first note.
    const call = th.melody.filter((n) => n.at < 32);
    b.line(call, 0, 'horn', 'melody', 0.85, 0, F_BIG);
    b.line(call, 0, 'horn', 'melody', 0.75, -12, F_BIG);
    b.add(0, 8, 'timp', 38, 0.8, 'melody');
    b.add(16, 8, 'timp', 33, 0.65, 'melody');
    b.line(th.melody.filter((n) => n.at >= 32), 0, 'horn', 'melody', vel);
    label = 'M (the call)';
  } else if (recipe === 1) {
    // Call and response inside the theme: the far horn takes a phrase (M: bars 5-6; M2: 3-4, 7-8).
    const far = (at: number): boolean => (kind === 'M' ? at >= 64 && at < 96 : at % 64 >= 32);
    b.line(th.melody.filter((n) => !far(n.at)), 0, 'horn', 'melody', vel);
    b.line(th.melody.filter((n) => far(n.at)), 0, 'echo', 'melody', vel * 0.7);
    label += ' (echoed)';
  } else if (recipe === 2) {
    b.line(th.melody, 0, 'horn', 'melody', vel);
    b.line(th.melody, 0, 'horn', 'melody', vel * 0.55, -12);
    label += ' (octaves)';
  } else {
    b.line(th.melody, 0, 'horn', 'melody', vel);
    if (recipe === 3) label += ' (reharmonized)';
  }
  return done(label, th.chords, kind === 'M2' || recipe === 3);
}

/**
 * The boss bed. Every bar carries two drum layers: the ordinary 3+3+2 drive ('pulse') and the
 * urgent one, every 16th alive ('urgent'), with the stabs on every bar and the timpani on each
 * accent; the conductor swaps them at the next bar line when the timer's last seconds come.
 */
function bossBed(b: Builder, chords: Chord[][], ctx: ComposeCtx, v: number): void {
  const plucked: NoteInst = ctx.tier >= 1 ? 'harp' : 'lute';
  for (let bar = 0; bar < chords.length; bar++) {
    const t0 = bar * 16;
    const ch = chords[bar]![0]!;
    b.drums(T.DRUM_BOSS[v % 2]!, t0, 1, 0.74, 'pulse');
    b.drums(T.DRUM_BOSS[2]!, t0, 1, 0.84, 'urgent');
    // Timpani strokes are damped (as a timpanist would) before the heartbeat's next lub.
    b.add(t0, 3, 'timp', pcFloor(ch.root, 33), 0.7, 'heart', F_ACCENT | F_DAMP);
    const accents: Role = v % 2 === 1 ? 'heart' : 'urgent';
    b.add(t0 + 6, 3, 'timp', pcFloor(ch.pcs[2] ?? ch.root, 38), 0.46, accents, F_DAMP);
    b.add(t0 + 12, 3, 'timp', pcFloor(ch.root, 33), 0.52, accents, F_DAMP);
    // Ostinato in 8ths: root, fifth below, root, third... and a scale step above the third.
    const root = pcFloor(ch.root, 52);
    const fifthBelow = root - 5 - (isChordTone(root - 5, ch) ? 0 : 1);
    const third = root + 1 + pc((ch.third >= 0 ? ch.third : ch.pcs[1]!) - root - 1);
    const pattern8 = [root, fifthBelow, root, third, root, fifthBelow, root, scaleStep(third, T.BOSS_SCALE, 1)];
    for (let i = 0; i < 8; i++) b.add(t0 + i * 2, 2, plucked, pattern8[i]!, i === 0 ? 0.62 : 0.44, 'arp', i === 0 ? F_ACCENT : 0, b.j(3));
    // Horn stabs on the 3+3+2 accents: every other bar, and every bar once time runs short.
    const vc = voicing(ch, 3, 59, 71);
    const stabs: Role = bar % 2 === 1 ? 'pad' : 'urgent';
    for (const at of [0, 6, 12]) for (const m of vc) b.add(t0 + at, 2, 'horn', m, stabs === 'pad' ? 0.5 : 0.56, stabs, F_STAB, b.j(3));
    b.add(t0, 16, 'horn', pcFloor(ch.root, 40), 0.36, 'bass');
  }
}

function boss(kind: string, v: number, ctx: ComposeCtx): Section {
  const b = new Builder(T.BOSS_METER, ctx.rng);
  const drone = T.BOSS_DRONE;
  if (kind === 'victory') {
    // A for a beat, then D major held: timpani roll into the hit, a strum, a harp glissando.
    const chords = [[parseChord('A')], [parseChord('D')], [parseChord('D')]];
    for (const m of T.VICTORY_A) b.add(0, 4, 'horn', m, 0.34, 'melody', F_ACCENT);
    for (const m of T.VICTORY_D) b.add(4, 28, 'horn', m, 0.4, 'melody', F_BIG);
    b.add(0, 4, 'roll', 33, 0.55, 'melody');
    b.add(4, 16, 'timp', 38, 0.72, 'melody', F_ACCENT);
    b.add(4, 1, 'doum', 0, 0.7, 'melody');
    [50, 57, 62, 66, 69].forEach((m, i) => b.add(4, 16, 'lute', m, 0.45, 'melody', 0, i * 0.022));
    // The glissando an octave below the zoom's: after a later boss the clicks go on.
    T.ZOOM_GLISS.forEach((m, i) => b.add(6 + i * 0.5, 8, 'harp', m - 12, 0.32, 'melody', 0, 0));
    return section('boss', kind, 'victory', chords, b, null);
  }
  if (kind === 'retreat') {
    // It got away: the drums fall back, the harmony hangs unresolved (G, then F# sus).
    const chords = [[T.BOSS_LOOP[2]![0]!], [T.BOSS_LOOP[7]![0]!]];
    b.add(0, 1, 'doum', 0, 0.55, 'melody');
    b.add(8, 1, 'doum', 0, 0.36, 'melody');
    b.add(16, 1, 'doum', 0, 0.24, 'melody');
    b.pads(chords, 0, 'horn', 50, 66, 3, 0.32, 'pad');
    return section('boss', kind, 'retreat', chords, b, drone);
  }
  if (kind === 'break') {
    const chords = T.BOSS_LOOP.slice(0, 2);
    b.drums('D.....D.....D.t.', 0, 1, 0.66, 'pulse');
    b.drums('D.tD.tD.t.ttDttt', 16, 1, 0.72, 'pulse');
    b.drums(T.DRUM_BOSS[2]!, 0, 2, 0.84, 'urgent');
    b.add(0, 3, 'timp', 35, 0.66, 'heart', F_DAMP);
    b.add(24, 8, 'roll', 35, 0.6, 'heart');
    b.add(0, 32, 'horn', 47, 0.36, 'bass');
    return section('boss', kind, 'break', chords, b, drone);
  }
  if (kind === 'melody') {
    const chords = T.BOSS_THEME.chords;
    bossBed(b, chords, ctx, v);
    const vel = 0.72;
    b.line(T.BOSS_THEME.melody, 0, 'horn', 'melody', vel);
    // The low horns double the tune: always in the second statement, and as the timer runs out.
    b.line(T.BOSS_THEME.melody, 0, 'horn', v % 2 === 1 ? 'melody' : 'urgent', vel * 0.6, -12);
    return section('boss', kind, v % 2 ? 'melody (octaves)' : 'melody', chords, b, drone, ctx.tier >= 1);
  }
  // Ostinato: the loop's first or second half.
  const chords = T.BOSS_LOOP.slice((v % 2) * 4, (v % 2) * 4 + 4);
  bossBed(b, chords, ctx, v);
  return section('boss', 'ostinato', 'ostinato', chords, b, drone);
}

/** Every meter by mood (the conductor's grid). */
export function meterOf(mood: MoodId): Meter {
  return SEC[mood];
}
