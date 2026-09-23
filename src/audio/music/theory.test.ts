import { describe, expect, it } from 'vitest';
import { chordTones, inScale, MODES, midiHz, nearestChordTone, noteName, parseChord, parseNote, pc, scaleStep, snap, voicing } from './theory';
import { chordAt, parseBars, parseLine } from './score';
import * as T from './themes';
import type { MNote } from './score';
import type { Chord, Scale } from './theory';

describe('notes', () => {
  it('parses and names notes (D4 = 62, the SFX root)', () => {
    expect(parseNote('D4')).toBe(62);
    expect(parseNote('A4')).toBe(69);
    expect(parseNote('F#5')).toBe(78);
    expect(parseNote('Bb3')).toBe(58);
    expect(parseNote('C-1')).toBe(0);
    for (let m = 24; m < 108; m++) expect(parseNote(noteName(m))).toBe(m);
    expect(midiHz(69)).toBeCloseTo(440, 6);
    expect(() => parseNote('H2')).toThrow();
  });
});

describe('scales', () => {
  const mix: Scale = { tonic: 2, steps: MODES.mixolydian };
  it('D Mixolydian has C natural and F#; D Dorian has F and B', () => {
    expect(inScale(parseNote('C5'), mix)).toBe(true);
    expect(inScale(parseNote('C#5'), mix)).toBe(false);
    expect(inScale(parseNote('F#5'), mix)).toBe(true);
    const dor: Scale = { tonic: 2, steps: MODES.dorian };
    expect(inScale(parseNote('F4'), dor)).toBe(true);
    expect(inScale(parseNote('B4'), dor)).toBe(true);
    expect(inScale(parseNote('F#4'), dor)).toBe(false);
  });
  it('steps through the mode', () => {
    expect(scaleStep(74, mix, 1)).toBe(76); // D5 -> E5
    expect(scaleStep(74, mix, -1)).toBe(72); // D5 -> C5 (b7)
    expect(scaleStep(74, mix, 7)).toBe(86);
    expect(scaleStep(74, mix, -7)).toBe(62);
    expect(snap(73, mix, -1)).toBe(72);
    expect(snap(73, mix, 1)).toBe(74);
  });
});

describe('chords', () => {
  it('parses qualities and slash chords', () => {
    const a7 = parseChord('A7');
    expect(a7.pcs).toEqual([9, 1, 4, 7]);
    expect(a7.third).toBe(1);
    const sus = parseChord('F#sus4');
    expect(sus.pcs).toEqual([6, 11, 1]);
    expect(sus.third).toBe(-1);
    const slash = parseChord('C/D');
    expect(slash.root).toBe(0);
    expect(slash.bass).toBe(2);
    expect(parseChord('Bm').pcs).toEqual([11, 2, 6]);
    expect(parseChord('Em7').pcs).toEqual([4, 7, 11, 2]);
    expect(() => parseChord('Dxyz')).toThrow();
  });
  it('finds chord tones', () => {
    const d = parseChord('D');
    expect(chordTones(d, 60, 72)).toEqual([62, 66, 69]);
    expect(nearestChordTone(64, d)).toBe(62);
    expect(nearestChordTone(68, d)).toBe(69);
  });
  it('voices chords in range, root and third present, moving little', () => {
    let prev: number[] | null = null;
    let travel = 0;
    for (const sym of ['Dm', 'C', 'G', 'Dm', 'F', 'Am', 'G', 'Dm']) {
      const ch = parseChord(sym);
      const v = voicing(ch, 3, 45, 62, prev);
      expect(v).toHaveLength(3);
      for (const m of v) {
        expect(m).toBeGreaterThanOrEqual(45);
        expect(m).toBeLessThanOrEqual(62);
        expect(ch.pcs).toContain(pc(m));
      }
      expect(v.some((m) => pc(m) === ch.root)).toBe(true);
      expect(v.some((m) => pc(m) === ch.third)).toBe(true);
      if (prev) for (let i = 0; i < 3; i++) travel += Math.abs(v[i]! - prev[i]!);
      prev = v;
    }
    // Smooth voice leading: well under a fourth per voice per change on average.
    expect(travel / (7 * 3)).toBeLessThan(3.5);
  });
});

describe('notation', () => {
  it('parses lengths, rests and bar lines', () => {
    const n = parseLine('A5:4 F#5:2 A5 D6:4 | C6:6 r:6', 12);
    expect(n.map((x) => x.at)).toEqual([0, 4, 6, 8, 12]);
    expect(n[2]!.len).toBe(2);
    expect(() => parseLine('A5:4 | A5:8', 12)).toThrow();
    expect(() => parseLine('A5:5', 12)).toThrow();
    const bars = parseBars('D G,A7 D');
    expect(bars[1]!.map((c) => c.name)).toEqual(['G', 'A7']);
    expect(chordAt(bars[1]!, 5, 12).name).toBe('G');
    expect(chordAt(bars[1]!, 6, 12).name).toBe('A7');
  });
});

/** Strong beats: the two dotted quarters in 6/8, beats 1 and 3 in 4/4. */
function strong(at: number, spb: number): boolean {
  return spb === 12 ? at % 6 === 0 : at % 8 === 0;
}

function checkTheme(name: string, th: { chords: Chord[][]; melody: MNote[] }, spb: number, scale: Scale, tonic: number): void {
  describe(`theme ${name}`, () => {
    it('fills its bars exactly', () => {
      const last = th.melody[th.melody.length - 1]!;
      expect(last.at + last.len).toBe(th.chords.length * spb);
    });
    it('stays in its mode (chromatic notes only as chord tones)', () => {
      for (const n of th.melody) {
        const ch = chordAt(th.chords[Math.floor(n.at / spb)]!, n.at % spb, spb);
        expect(inScale(n.midi, scale) || ch.pcs.includes(pc(n.midi)), `${noteName(n.midi)} at ${n.at}`).toBe(true);
      }
    });
    it('puts chord tones on the strong beats', () => {
      for (const n of th.melody) {
        if (!strong(n.at, spb)) continue;
        const ch = chordAt(th.chords[Math.floor(n.at / spb)]!, n.at % spb, spb);
        expect(ch.pcs.includes(pc(n.midi)), `${noteName(n.midi)} over ${ch.name} at step ${n.at}`).toBe(true);
      }
    });
    it('cadences on the tonic', () => {
      expect(pc(th.melody[th.melody.length - 1]!.midi)).toBe(tonic);
      expect(th.chords[th.chords.length - 1]![0]!.pcs).toContain(tonic);
    });
  });
}

checkTheme('Meadow A', T.MEADOW_A, 12, T.MEADOW_SCALE, 2);
checkTheme('Meadow A (modal cadence)', T.MEADOW_A_MODAL, 12, T.MEADOW_SCALE, 2);
checkTheme('Meadow B', T.MEADOW_B, 12, T.MEADOW_SCALE, 2);
checkTheme('Mountain M', T.MOUNTAIN_M, 16, T.MOUNTAIN_SCALE, 2);
checkTheme('Mountain M2', T.MOUNTAIN_M2, 16, T.MOUNTAIN_SCALE, 2);
checkTheme('Boss', T.BOSS_THEME, 16, T.BOSS_SCALE, 11);

describe('the material', () => {
  it('the Meadow antecedent ends open (on the fifth), the consequent closed', () => {
    const at4 = T.MEADOW_A.melody.filter((n) => n.at < 48);
    expect(noteName(at4[at4.length - 1]!.midi)).toBe('A4');
  });
  it('the Meadow tune agrees with the SFX: only the pentatonic and the modal C/G', () => {
    for (const th of [T.MEADOW_A, T.MEADOW_B]) for (const n of th.melody) expect([0, 2, 4, 6, 7, 9, 11]).toContain(pc(n.midi));
  });
  it('the boss key holds every SFX pentatonic note (D E F# A B)', () => {
    for (const p of [2, 4, 6, 9, 11]) expect(inScale(p + 60, T.BOSS_SCALE)).toBe(true);
  });
  it('the Mountain keeps its minor third below the coins (F only under D5)', () => {
    for (const th of [T.MOUNTAIN_M, T.MOUNTAIN_M2]) for (const n of th.melody) if (pc(n.midi) === 5) expect(n.midi).toBeLessThan(74);
  });
  it('every progression parses to known chords', () => {
    for (const p of [...T.MEADOW_EPISODES, T.MEADOW_TENSION, T.MEADOW_INTERLUDE, ...T.MOUNTAIN_ECHO_CHORDS, T.MOUNTAIN_INTERLUDE, T.BOSS_LOOP]) {
      expect(p.length).toBeGreaterThanOrEqual(4);
    }
  });
});
