import { describe, expect, it } from 'vitest';
import { Rng } from '../../lib/rng';
import { cadenceFigure, composeSection, luteTones, ornament, realize } from './composer';
import { Form, gateMargin } from './form';
import { chordAt, F_BIG, F_PHRASE_END, type MoodId, type Section } from './score';
import * as T from './themes';
import { inScale, noteName, parseChord, pc, type Scale } from './theory';

const RANGE: Record<string, [number, number]> = {
  flute: [60, 91],
  lute: [36, 79],
  harp: [36, 100],
  horn: [33, 84],
  echo: [55, 81],
};

const SCALE: Record<MoodId, Scale> = { meadow: T.MEADOW_SCALE, mountain: T.MOUNTAIN_SCALE, boss: T.BOSS_SCALE };

const KINDS: Record<MoodId, string[]> = {
  meadow: ['intro', 'A', 'B', 'episode', 'interlude'],
  mountain: ['intro', 'M', 'M2', 'echoes', 'interlude'],
  boss: ['ostinato', 'melody', 'break', 'victory', 'retreat'],
};

function compose(mood: MoodId, kind: string, v: number, seed: number, energy = 0.5, tension = 0, urgency = 0, big = false): Section {
  return composeSection(mood, kind, v, { rng: new Rng(seed), energy, tension, urgency, tier: mood === 'mountain' ? 1 : 0, big });
}

function all(): Section[] {
  const out: Section[] = [];
  for (const mood of ['meadow', 'mountain', 'boss'] as MoodId[]) {
    for (const kind of KINDS[mood]) {
      for (let v = 0; v < 4; v++) {
        for (const [e, t, u] of [
          [0.1, 0, 0],
          [0.6, 0.2, 0.3],
          [0.95, 0.8, 0.9],
        ] as const) {
          out.push(compose(mood, kind, v, 7 + v * 13, e, t, u));
        }
      }
    }
  }
  out.push(compose('mountain', 'M', 0, 3, 0.1, 0, 0, true));
  return out;
}

describe('composeSection', () => {
  const sections = all();

  it('produces sorted events inside the section, with sane velocities', () => {
    for (const s of sections) {
      const sps = s.meter.secPerStep;
      const total = s.bars * s.meter.stepsPerBar;
      let last = -Infinity;
      expect(s.events.length).toBeGreaterThan(0);
      for (const e of s.events) {
        const t = e.at + e.dt / sps;
        expect(t).toBeGreaterThanOrEqual(last - 1e-9);
        last = t;
        expect(e.at).toBeGreaterThanOrEqual(0);
        expect(e.at).toBeLessThan(total);
        expect(e.len).toBeGreaterThan(0);
        expect(e.vel).toBeGreaterThan(0);
        expect(e.vel).toBeLessThanOrEqual(1);
        expect(Math.abs(e.dt)).toBeLessThan(0.12);
        expect(Number.isFinite(e.midi)).toBe(true);
      }
    }
  });

  it('keeps every instrument in its range', () => {
    for (const s of sections) {
      for (const e of s.events) {
        const r = RANGE[e.inst];
        if (!r) continue;
        expect(e.midi, `${s.mood} ${s.label}: ${e.inst} ${noteName(e.midi)}`).toBeGreaterThanOrEqual(r[0]);
        expect(e.midi, `${s.mood} ${s.label}: ${e.inst} ${noteName(e.midi)}`).toBeLessThanOrEqual(r[1]);
      }
    }
  });

  it('writes melodies in the mood\'s mode (a chromatic note only as a chord tone)', () => {
    for (const s of sections) {
      if (s.kind === 'victory') continue; // the D major resolution
      const scale = SCALE[s.mood];
      const spb = s.meter.stepsPerBar;
      for (const e of s.events) {
        if (!RANGE[e.inst] || (e.role !== 'melody' && e.role !== 'echo')) continue;
        const bar = Math.min(s.bars - 1, Math.floor(e.at / spb));
        const ch = chordAt(s.chords[bar]!, e.at % spb, spb);
        expect(inScale(e.midi, scale) || ch.pcs.includes(pc(e.midi)), `${s.mood} ${s.label}: ${noteName(e.midi)} over ${ch.name}`).toBe(true);
      }
    }
  });

  it('keeps the busy lute and harp accompaniment in their own register (below the SFX band)', () => {
    for (const s of sections) for (const e of s.events) if (e.role === 'arp') expect(e.midi).toBeLessThanOrEqual(76);
  });

  it('is deterministic for a seed', () => {
    const a = compose('meadow', 'A', 1, 42);
    const b = compose('meadow', 'A', 1, 42);
    expect(a.events).toEqual(b.events);
    const c = compose('meadow', 'A', 1, 43);
    expect(c.events).not.toEqual(a.events);
  });

  it('episodes develop the head motif and cadence home (or onto the dominant when tense)', () => {
    for (let v = 0; v < 3; v++) {
      const s = compose('meadow', 'episode', v, 5, 0.5, 0);
      const mel = s.events.filter((e) => e.role === 'melody');
      expect(noteName(mel[mel.length - 1]!.midi)).toBe('D4');
      expect(mel[mel.length - 1]!.flags & F_PHRASE_END).toBeTruthy();
    }
    const tense = compose('meadow', 'episode', 0, 5, 0.5, 0.9);
    expect(tense.label).toContain('tension');
    const mel = tense.events.filter((e) => e.role === 'melody');
    expect(noteName(mel[mel.length - 1]!.midi)).toBe('E4');
  });

  it('answers the Meadow tune in its rests (call and response)', () => {
    const s = compose('meadow', 'A', 0, 9);
    const answer = s.events.filter((e) => e.inst === 'harp' && e.role === 'melody' && e.at >= 42 && e.at < 48);
    expect(answer.length).toBe(3);
    const h = compose('meadow', 'A', 2, 9);
    expect(h.label).toContain('harp');
    expect(h.events.some((e) => e.inst === 'flute' && e.at >= 42 && e.at < 48)).toBe(true);
  });

  it('opens the Mountain with the horn call in octaves when it is the arrival', () => {
    const s = compose('mountain', 'M', 0, 3, 0.1, 0, 0, true);
    const big = s.events.filter((e) => e.flags & F_BIG);
    expect(big.length).toBe(14);
    expect(big.every((e) => e.at < 32)).toBe(true);
    expect(big.map((e) => noteName(e.midi))).toContain('D3');
  });

  it('ends the Mountain echoes on the call\'s own cadence', () => {
    const s = compose('mountain', 'echoes', 0, 11);
    const echo = s.events.filter((e) => e.role === 'echo');
    expect(noteName(echo[echo.length - 1]!.midi)).toBe('D4');
  });

  it('drives the boss harder as time runs out', () => {
    const calm = compose('boss', 'ostinato', 0, 1, 0.5, 0, 0);
    const urgent = compose('boss', 'ostinato', 0, 1, 0.5, 0, 0.9);
    const hits = (s: Section): number => s.events.filter((e) => e.role === 'pulse').length;
    expect(hits(urgent)).toBeGreaterThan(hits(calm) * 1.5);
    expect(urgent.label).toContain('urgent');
  });

  it('resolves a won fight into D major', () => {
    const s = compose('boss', 'victory', 0, 1);
    const pcs = new Set(s.events.filter((e) => e.inst === 'horn' && e.at === 4).map((e) => pc(e.midi)));
    expect([...pcs].sort()).toEqual([2, 6, 9]);
  });
});

describe('cadences', () => {
  it('lands with chord tones on the beats and a leading note into the tonic', () => {
    const name = (xs: number[]): string[] => xs.map(noteName);
    const bar = (s: string) => s.split(',').map(parseChord);
    expect(name(cadenceFigure(bar('C'), 74, T.MEADOW_SCALE, 12))).toEqual(['G5', 'F#5', 'E5', 'C5']);
    expect(name(cadenceFigure(bar('Em,A7'), 74, T.MEADOW_SCALE, 12))).toEqual(['G5', 'F#5', 'E5', 'C#5']);
    for (const sym of ['Am', 'G', 'Em,A7', 'C', 'A']) {
      const fig = cadenceFigure(bar(sym), 74, T.MEADOW_SCALE, 12);
      const chords = bar(sym);
      expect(chords[0]!.pcs).toContain(pc(fig[0]!));
      expect(chordAt(chords, 6, 12).pcs.includes(pc(fig[2]!)) || inScale(fig[2]!, T.MEADOW_SCALE)).toBe(true);
      expect(Math.abs(fig[3]! - 74)).toBeLessThanOrEqual(2);
    }
  });
  it('keeps the Mountain echoes\' F natural below the coins', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = compose('mountain', 'echoes', seed, seed);
      for (const e of s.events) if ((e.inst === 'horn' || e.inst === 'echo') && pc(e.midi) === 5) expect(e.midi).toBeLessThan(74);
    }
  });
});

describe('motifs and variations', () => {
  it('realizes the head motif on chord tones with its contour', () => {
    const d = realize([[5, 0], [3, -1], [5, 1], [8, 1]], parseChord('D'), 81, 71, 88);
    expect(d.map(noteName)).toEqual(['A5', 'F#5', 'A5', 'D6']);
    // Too high near A5: the whole motif drops an octave, keeping its rising leap to the root.
    const g = realize([[5, 0], [3, -1], [5, 1], [8, 1]], parseChord('G'), 81, 64, 88);
    expect(g.map(noteName)).toEqual(['D5', 'B4', 'D5', 'G5']);
    // The sequence continues a third lower on Em (the episode's call on bar 3).
    const em = realize([[8, 0], [5, -1], [3, -1], [5, 1]], parseChord('Em'), 74, 64, 88);
    expect(em.map(noteName)).toEqual(['E5', 'B4', 'G4', 'B4']);
  });
  it('ornaments stay in the mode and keep the phrase length', () => {
    const rng = new Rng(3);
    const orn = ornament(T.MEADOW_A.melody, T.MEADOW_SCALE, rng, 1);
    expect(orn.length).toBeGreaterThan(T.MEADOW_A.melody.length);
    const end = (xs: { at: number; len: number }[]): number => Math.max(...xs.map((x) => x.at + x.len));
    expect(end(orn)).toBe(end(T.MEADOW_A.melody));
    for (const n of orn) expect(inScale(n.midi, T.MEADOW_SCALE)).toBe(true);
  });
  it('shapes lute chords from the bass up', () => {
    expect(luteTones(parseChord('D')).map(noteName)).toEqual(['D3', 'A3', 'D4', 'F#4']);
    expect(luteTones(parseChord('C/D')).map(noteName)).toEqual(['D3', 'G3', 'C4', 'E4']);
    expect(luteTones(parseChord('A7')).map(noteName)).toEqual(['A2', 'E3', 'G3', 'C#4']);
  });
});

describe('form', () => {
  it('walks the Meadow lap with rests, and skips them near the boss', () => {
    const f = new Form('meadow', 'intro');
    const kinds = Array.from({ length: 14 }, () => f.next(0.4, 0, 0).kind);
    expect(kinds.slice(0, 6)).toEqual(['intro', 'A', 'A', 'B', 'episode', 'interlude']);
    const tense = new Form('meadow', 'intro');
    const k2 = Array.from({ length: 14 }, () => tense.next(0.4, 0.8, 0).kind);
    expect(k2).not.toContain('interlude');
  });
  it('varies the themes each lap', () => {
    const f = new Form('meadow', 'intro');
    const steps = Array.from({ length: 40 }, () => f.next(0.4, 0, 0)).filter((s) => s.kind === 'A');
    expect(new Set(steps.map((s) => s.variant % 4)).size).toBe(4);
  });
  it('opens the Mountain arrival with the call', () => {
    const f = new Form('mountain', 'call');
    const first = f.next(0.1, 0, 0);
    expect(first).toEqual({ kind: 'M', variant: 0, big: true });
    expect(f.next(0.1, 0, 0).kind).toBe('echoes');
  });
  it('gates roles by energy and tension', () => {
    expect(gateMargin('meadow', 'pulse', 0.2, 0)).toBeLessThan(0);
    expect(gateMargin('meadow', 'pulse', 0.6, 0)).toBeGreaterThanOrEqual(0);
    expect(gateMargin('meadow', 'heart', 0.9, 0)).toBeLessThan(0);
    expect(gateMargin('meadow', 'heart', 0.1, 0.5)).toBeGreaterThanOrEqual(0);
    expect(gateMargin('meadow', 'melody', 0, 0)).toBeGreaterThanOrEqual(0);
    expect(gateMargin('boss', 'pulse', 0, 0)).toBeGreaterThanOrEqual(0);
  });
});
