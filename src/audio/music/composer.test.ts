import { describe, expect, it } from 'vitest';
import { Rng } from '../../lib/rng';
import { cadenceFigure, composeSection, luteTones, ornament, realize } from './composer';
import { Form, gateMargin } from './form';
import { chordAt, F_BIG, F_PHRASE_END, F_STAB, type MoodId, type Section } from './score';
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

  it('composes an urgent layer under every boss bar (the conductor swaps it in as time runs out)', () => {
    for (const kind of ['ostinato', 'melody', 'break']) {
      const s = compose('boss', kind, 0, 1);
      const drums = (role: string): number => s.events.filter((e) => e.role === role && (e.inst === 'doum' || e.inst === 'tak')).length;
      expect(drums('urgent'), kind).toBeGreaterThan(drums('pulse') * 1.5);
      if (kind === 'break') continue;
      // Stabs land in every bar once urgent ('pad' on odd bars, 'urgent' on even ones).
      for (let bar = 0; bar < s.bars; bar++) {
        expect(s.events.some((e) => e.flags & F_STAB && Math.floor(e.at / 16) === bar && (e.role === 'pad' || e.role === 'urgent'))).toBe(true);
      }
    }
    // In the melody the low horns join the tune at the octave as the timer runs out.
    const m = compose('boss', 'melody', 0, 1);
    expect(m.events.filter((e) => e.role === 'urgent' && e.inst === 'horn' && !(e.flags & F_STAB)).length).toBe(T.BOSS_THEME.melody.length);
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

describe('the Mountain over a long stay', () => {
  it('keeps resting, develops the call, climbs to E Dorian, and rarely repeats M (16 minutes at full energy)', () => {
    const form = new Form('mountain', 'call');
    const bar = 16 * T.MOUNTAIN_METER.secPerStep;
    const labels: string[] = [];
    let time = 0;
    for (let n = 0; time < 960; n++) {
      const st = form.next(0.95, 0, 0);
      const sec = composeSection('mountain', st.kind, st.variant, { rng: new Rng(n + 1), energy: 0.95, tension: 0, urgency: 0, tier: 1, big: st.big, key: st.key });
      labels.push(sec.label);
      time += sec.bars * bar;
    }
    const count = (re: RegExp): number => labels.filter((l) => re.test(l)).length;
    expect(count(/^interlude/)).toBeGreaterThanOrEqual(6);
    expect(count(/^episode/)).toBeGreaterThanOrEqual(4);
    expect(count(/^M( |$)/)).toBeLessThanOrEqual(7);
    expect(count(/E Dorian/)).toBeGreaterThanOrEqual(8);
    // The theme is never stated the same way twice in a row, and never back to back.
    const ms = labels.filter((l) => /^M( |$)/.test(l));
    for (let i = 1; i < ms.length; i++) expect(ms[i]).not.toBe(ms[i - 1]);
    for (let i = 1; i < labels.length; i++) expect(labels[i]).not.toBe(labels[i - 1]);
  });

  it('voices the D laps\' sustained chords open (no F natural against the coins) and moves the E laps whole', () => {
    for (const kind of ['M', 'M2', 'episode', 'echoes', 'interlude']) {
      for (let v = 0; v < 4; v++) {
        const d = composeSection('mountain', kind, v, { rng: new Rng(v + 3), energy: 0.9, tension: 0, urgency: 0, tier: 1, key: 0 });
        for (const e of d.events) if ((e.role === 'pad' || e.role === 'counter') && e.midi > 47) expect(pc(e.midi), `${d.label} ${e.role} ${noteName(e.midi)}`).not.toBe(5);
        for (const bar of d.hum ?? d.chords) for (const ch of bar) expect(ch.pcs).not.toContain(5);
        const e = composeSection('mountain', kind, v, { rng: new Rng(v + 3), energy: 0.9, tension: 0, urgency: 0, tier: 1, key: 2 });
        expect(e.label).toContain('E Dorian');
        expect(e.drone).toEqual([40, 47]);
        e.chords.forEach((bar, i) => bar.forEach((ch, j) => expect(ch.root).toBe(pc(d.chords[i]![j]!.root + 2))));
        for (const x of e.events) if (x.role === 'melody' || x.role === 'echo') expect(inScale(x.midi, { tonic: 4, steps: T.MOUNTAIN_SCALE.steps }) || e.chords.some((b) => b.some((ch) => ch.pcs.includes(pc(x.midi))))).toBe(true);
      }
    }
  });

  it('develops the horn call in its episodes: the head sequenced up (or down), then its rising fifth', () => {
    const s = composeSection('mountain', 'episode', 0, { rng: new Rng(1), energy: 0.5, tension: 0, urgency: 0, tier: 1, key: 0 });
    // The top voice at each of the call's onsets (the low horns double bars 3-4 an octave down).
    const top = (bar: number): string[] =>
      [0, 4, 12, 14].map((at) => noteName(Math.max(...s.events.filter((e) => e.inst === 'horn' && e.role === 'melody' && e.at === bar * 16 + at).map((e) => e.midi))));
    expect(top(0)).toEqual(['D4', 'A4', 'G4', 'F4']);
    expect(top(1)).toEqual(['F4', 'C5', 'B4', 'A4']);
    expect(top(2)).toEqual(['G4', 'D5', 'C5', 'B4']);
    expect(top(3)).toEqual(['A4', 'E5', 'D5', 'C5']);
    // Bars 5-6: the rising fifth, near horn then far horn.
    expect(s.events.filter((e) => e.at >= 64 && e.at < 96 && (e.role === 'melody' || e.role === 'echo') && e.inst !== 'harp').map((e) => `${e.inst}:${noteName(e.midi)}`)).toEqual([
      'horn:C4',
      'horn:G4',
      'echo:D4',
      'echo:A4',
    ]);
    const last = s.events.filter((e) => e.role === 'melody' && e.inst === 'horn').pop()!;
    expect(pc(last.midi)).toBe(2);
  });
});

describe('the boss melody', () => {
  it('turns down into the low horns for its last three bars (clear of the coins and clangs)', () => {
    for (const n of T.BOSS_THEME.melody) if (n.at >= 80) expect(n.midi, noteName(n.midi)).toBeLessThanOrEqual(67);
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
    expect(first).toEqual({ kind: 'M', variant: 0, big: true, key: 0 });
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
