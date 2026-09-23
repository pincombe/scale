import { describe, expect, it } from 'vitest';
import { Conductor, LOOKAHEAD, type Beat, type MusicInputs, type Performer, type Vowel } from './conductor';
import { F_BIG, type SEv } from './score';

interface Played {
  ev: SEv;
  t: number;
  dur: number;
  gain: number;
  /** Audio time when the conductor handed it over. */
  at: number;
}

class Fake implements Performer {
  now = 0;
  played: Played[] = [];
  drones: { t: number; midis: readonly number[] | null }[] = [];
  choirs: { t: number; midis: readonly number[] | null; level: number; vowel: Vowel }[] = [];
  faders: { t: number; level: number; dur: number }[] = [];
  releases: { t: number; fade: number }[] = [];
  shimmers: { t: number; level: number }[] = [];
  play(ev: SEv, t: number, dur: number, gain: number): void {
    this.played.push({ ev, t, dur, gain, at: this.now });
  }
  drone(t: number, midis: readonly number[] | null): void {
    this.drones.push({ t, midis });
  }
  choir(t: number, midis: readonly number[] | null, level: number, _tau: number, _glide: number, vowel: Vowel): void {
    this.choirs.push({ t, midis, level, vowel });
  }
  shimmer(t: number, level: number): void {
    this.shimmers.push({ t, level });
  }
  fader(t: number, level: number, dur: number): void {
    this.faders.push({ t, level, dur });
  }
  /** When each played sound was cut by a release (a release fades every voice alive when called). */
  cut = new Map<Played, number>();
  releaseAll(t: number, fade: number): void {
    this.releases.push({ t, fade });
    for (const p of this.played) if (p.t + p.dur > t && !this.cut.has(p)) this.cut.set(p, t);
  }
  openMid(): void {}
  /** The sound was cut before it finished (by a release called after it was created). */
  cutShort(p: Played): boolean {
    const at = this.cut.get(p);
    return at !== undefined && at < p.t + p.dur - 1e-6;
  }
}

function inputs(p: Partial<MusicInputs> = {}): MusicInputs {
  return { tier: 0, boss: false, energy: 0.4, tension: 0, urgency: 0, ...p };
}

/** Drive the conductor like the live 25 ms timer. */
function run(c: Conductor, f: Fake, from: number, to: number, inp: MusicInputs | ((t: number) => MusicInputs), dt = 0.025): number {
  let t = from;
  for (; t < to; t += dt) {
    f.now = t;
    c.update(t, typeof inp === 'function' ? inp(t) : inp);
  }
  return t;
}

function begin(seed = 1, inp = inputs()): { c: Conductor; f: Fake } {
  const f = new Fake();
  const c = new Conductor(f, seed);
  c.start(0, inp);
  return { c, f };
}

const pitched = (p: Played): boolean => ['lute', 'harp', 'flute', 'horn', 'echo'].includes(p.ev.inst);

describe('Conductor scheduling', () => {
  it('fades in after the first gesture with the tier intro and its drone', () => {
    const { c, f } = begin();
    expect(c.mode).toBe('song');
    expect(f.faders[0]!.level).toBe(0);
    expect(f.faders[1]!.level).toBe(1);
    expect(f.faders[1]!.dur).toBeGreaterThanOrEqual(3);
    expect(f.drones[0]!.midis).toEqual([50, 57]);
    run(c, f, 0, 1, inputs());
    expect(c.info.label).toBe('intro');
  });

  it('hands every event over once, in order, within the lookahead window, never late', () => {
    const { c, f } = begin(3);
    run(c, f, 0, 120, inputs({ energy: 0.7 }));
    expect(f.played.length).toBeGreaterThan(500);
    let last = -Infinity;
    for (const p of f.played) {
      expect(p.t).toBeGreaterThanOrEqual(p.at - 1e-9);
      expect(p.t).toBeLessThan(p.at + LOOKAHEAD + 1e-9);
      // Handed over in time order (strums and humanizing are a few ms).
      expect(p.t).toBeGreaterThan(last - 0.03);
      last = Math.max(last, p.t);
    }
    expect(c.stats.late).toBe(0);
  });

  it('plays sections back to back on the grid (no gaps, no overlaps)', () => {
    const { c, f } = begin(4);
    const starts: number[] = [];
    let label = '';
    for (let t = 0; t < 200; t += 0.025) {
      f.now = t;
      c.update(t, inputs());
      if (c.info.bar === 1 && c.info.label !== label) {
        label = c.info.label;
        starts.push(t);
      }
    }
    expect(c.stats.sections).toBeGreaterThan(8);
    // Every drum/bass downbeat lands on a multiple of the Meadow's bar from the song's start.
    const bar = (12 * 60) / 168 / 2;
    for (const p of f.played) {
      if (p.ev.inst !== 'doum' || p.ev.at % 12 !== 0) continue;
      const k = (p.t - 0.4) / bar;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });

  it('grows the arrangement with energy, on bar lines, with a crescendo into a new layer', () => {
    const { c, f } = begin(5, inputs({ energy: 0.2 }));
    const t1 = run(c, f, 0, 30, inputs({ energy: 0.2 }));
    expect(f.played.filter((p) => p.ev.role === 'pulse').length).toBe(0);
    const before = f.played.length;
    run(c, f, t1, 60, inputs({ energy: 0.9 }));
    const drums = f.played.slice(before).filter((p) => p.ev.role === 'pulse');
    expect(drums.length).toBeGreaterThan(10);
    // The first bar of drums crescendos in (gain < 1), later bars are full.
    expect(drums[0]!.gain).toBeLessThan(1);
    expect(drums[drums.length - 1]!.gain).toBe(1);
    const bar = (12 * 60) / 168 / 2;
    const first = drums[0]!;
    const k = (first.t - first.ev.dt - 0.4) / bar;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
  });

  it('rejoins the clock after a stall instead of bursting late notes', () => {
    const { c, f } = begin(6);
    run(c, f, 0, 20, inputs());
    const n = f.played.length;
    // The page froze for 5 s while the audio clock ran on.
    run(c, f, 25, 30, inputs());
    const after = f.played.slice(n);
    for (const p of after) expect(p.t).toBeGreaterThanOrEqual(p.at - 0.051);
    expect(after.length).toBeGreaterThan(5);
  });
});

describe('Conductor moods', () => {
  it('moves to a new tier on a bar line', () => {
    const { c, f } = begin(7);
    run(c, f, 0, 10.01, inputs());
    expect(c.currentMood).toBe('meadow');
    const r0 = f.releases.length;
    run(c, f, 10.01, 20, inputs({ tier: 1 }));
    expect(c.currentMood).toBe('mountain');
    const rel = f.releases[r0]!;
    const bar = (12 * 60) / 168 / 2;
    const k = (rel.t - 0.4) / bar;
    expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    expect(f.drones[f.drones.length - 1]!.midis).toEqual([38, 45]);
  });

  it('summons the boss with a roll and lands its downbeat a second later', () => {
    const { c, f } = begin(8);
    run(c, f, 0, 12, inputs());
    const n = f.played.length;
    f.now = 12;
    c.bossSummon(12);
    const roll = f.played[n]!;
    expect(roll.ev.inst).toBe('roll');
    expect(roll.t + roll.dur).toBeCloseTo(13.03, 6);
    run(c, f, 12, 16, inputs({ boss: true }));
    // The Meadow's voices fade under the roll; the roll itself plays out.
    expect(f.cutShort(roll)).toBe(false);
    expect(c.currentMood).toBe('boss');
    const boss = f.played.slice(n + 1);
    // Nothing from the Meadow after the summon; the boss starts on its downbeat.
    const firstBoss = boss.find((p) => p.ev.inst === 'doum')!;
    expect(firstBoss.t).toBeCloseTo(13.03, 6);
    expect(boss.every((p) => p.t >= 12.03 - 1e-9)).toBe(true);
    expect(f.releases.some((r) => Math.abs(r.t - 12.03) < 1e-9 && r.fade > 0.5)).toBe(true);
  });

  it('resolves a won fight into D major, then the tier theme returns', () => {
    const { c, f } = begin(9);
    run(c, f, 0, 5, inputs());
    c.bossSummon(5);
    run(c, f, 5, 20, inputs({ boss: true }));
    const n = f.played.length;
    c.bossDefeated(20, false);
    run(c, f, 20, 40, inputs());
    const after = f.played.slice(n);
    const dChord = after.filter((p) => p.ev.inst === 'horn' && p.ev.flags & F_BIG);
    expect(dChord.length).toBeGreaterThanOrEqual(6);
    expect(c.currentMood).toBe('meadow');
    expect(['A', 'A (ornamented)', 'A (harp)', 'A (low flute)', 'B']).toContain(c.info.label.startsWith('A') ? 'A' : c.info.label);
  });

  it('backs off when the boss escapes', () => {
    const { c, f } = begin(10);
    run(c, f, 0, 5, inputs());
    c.bossSummon(5);
    run(c, f, 5, 15, inputs({ boss: true }));
    c.bossEscaped(15);
    let sawRetreat = false;
    run(c, f, 15, 30, (t) => {
      if (c.info.label === 'retreat') sawRetreat = true;
      return inputs({ boss: t < 15.5 });
    });
    expect(sawRetreat).toBe(true);
    expect(c.currentMood).toBe('meadow');
  });

  it('catches a boss it was never told about (a load mid-fight)', () => {
    const { c, f } = begin(11);
    run(c, f, 0, 10, inputs({ boss: true }));
    expect(c.currentMood).toBe('boss');
  });
});

describe('Conductor zoom cue', () => {
  const BEATS: [Beat, number][] = [
    ['rally', 0],
    ['fusion', 1],
    ['flash', 2.2],
    ['pullback', 2.4],
    ['reveal', 6.4],
    ['roar', 7],
    ['card', 7.6],
    ['done', 9.5],
  ];

  function zoom(c: Conductor, f: Fake, t0: number, tierAfter = 1): number {
    let i = 0;
    let t = t0;
    for (; t < t0 + 14; t += 0.025) {
      while (i < BEATS.length && t >= t0 + BEATS[i]![1]) {
        f.now = t;
        c.beat(BEATS[i]![0], t);
        i++;
      }
      f.now = t;
      c.update(t, inputs({ tier: t >= t0 + 2.4 ? tierAfter : 0, energy: 0.1 }));
    }
    return t;
  }

  it('holds its breath at the rally, swells, hits, and enters the Mountain with the horn call', () => {
    const { c, f } = begin(12);
    run(c, f, 0, 20, inputs({ energy: 0.8 }));
    const n = f.played.length;
    zoom(c, f, 20);
    // The rally: the fader drops to silence within a quarter second.
    const drop = f.faders.find((x) => x.t >= 20 && x.level === 0)!;
    expect(drop.dur).toBeLessThanOrEqual(0.25);
    // Nothing of the song plays between the rally and the roar except the cue's own sounds, and
    // none of those is cut short by a later release; the horn call isn't either.
    const between = f.played.slice(n).filter((p) => p.t > 20.3 && p.t < 27);
    expect(between.every((p) => p.ev.role === 'melody')).toBe(true);
    for (const p of f.played.slice(n).filter((q) => q.t > 20.3)) expect(f.cutShort(p), `${p.ev.inst} at ${p.t}`).toBe(false);
    // Fusion swell, flash sub hit, the choir resolving A sus4 -> D major -> ... -> D minor.
    expect(f.played.some((p) => p.ev.inst === 'sub' && Math.abs(p.t - 22.23) < 0.04)).toBe(true);
    const chords = f.choirs.filter((x) => x.midis).map((x) => x.midis!.join());
    expect(chords[0]).toBe('45,52,57,62,64');
    expect(chords).toContain('45,50,57,62,66');
    expect(chords).toContain('50,57,62,65,69');
    // The roar starts the Mountain with the call, fortissimo; the card and done restore the level.
    expect(c.currentMood).toBe('mountain');
    const call = f.played.filter((p) => p.ev.flags & F_BIG && p.t > 27);
    expect(call.length).toBeGreaterThanOrEqual(8);
    expect(call[0]!.t).toBeGreaterThan(27.2);
    expect(f.faders[f.faders.length - 1]!.level).toBe(1);
    expect(f.shimmers.some((s) => s.level > 0)).toBe(true);
    expect(f.shimmers[f.shimmers.length - 1]!.level).toBe(0);
  });

  it('times its swells to the director\'s real beat gaps', () => {
    const { c, f } = begin(16);
    run(c, f, 0, 5, inputs());
    c.beat('rally', 5);
    c.beat('fusion', 6, 2);
    const roll = f.played.filter((p) => p.ev.inst === 'roll').pop()!;
    expect(roll.t + roll.dur).toBeCloseTo(8.03, 6);
    c.beat('flash', 8);
    c.beat('pullback', 8.2, 6);
    // The flash's own decay call is at 8.33; the pull-back's chord changes split its 6 s in thirds.
    const changes = f.choirs.filter((x) => x.t > 8.5 && x.midis);
    expect(changes).toHaveLength(2);
    expect(changes[0]!.t).toBeCloseTo(10.23, 6);
    expect(changes[1]!.t).toBeCloseTo(12.23, 6);
    c.beat('reveal', 14.2, 1);
    const roll2 = f.played.filter((p) => p.ev.inst === 'roll').pop()!;
    expect(roll2.t + roll2.dur).toBeCloseTo(15.23, 6);
  });

  it('marks the first boss\'s fall with one chord, then waits for the rally', () => {
    const { c, f } = begin(13);
    run(c, f, 0, 5, inputs());
    c.bossSummon(5);
    run(c, f, 5, 20, inputs({ boss: true }));
    const n = f.played.length;
    c.bossDefeated(20, true);
    run(c, f, 20, 21.5, inputs());
    const fall = f.played.slice(n);
    expect(fall.filter((p) => p.ev.flags & F_BIG).length).toBe(6);
    expect(fall.every((p) => p.t < 20.5)).toBe(true);
    for (const p of fall) expect(f.cutShort(p)).toBe(false);
    expect(c.mode).toBe('cue');
    // If the zoom never comes, the music comes back by itself.
    run(c, f, 21.5, 30, inputs());
    expect(c.mode).toBe('song');
  });

  it('survives a zoom with no beats at all (the stub director)', () => {
    const { c, f } = begin(14);
    run(c, f, 0, 10, inputs());
    c.beat('rally', 10);
    run(c, f, 10, 10.5, inputs({ tier: 1 }));
    c.zoomEnded(10.5);
    run(c, f, 10.5, 20, inputs({ tier: 1 }));
    expect(c.mode).toBe('song');
    expect(c.currentMood).toBe('mountain');
    expect(f.faders[f.faders.length - 1]!.level).toBe(1);
  });
});

describe('Conductor soak', () => {
  it('runs 20 minutes of play without stalling, drifting or leaking work', () => {
    const f = new Fake();
    const c = new Conductor(f, 99);
    c.start(0, inputs());
    let tier = 0;
    let boss = false;
    let sinceBoss = 0;
    const windows = new Map<number, number>();
    for (let t = 0; t < 1200; t += 0.025) {
      f.now = t;
      // A plausible session: the army grows, bosses come and go, a zoom at 3:30.
      const e = Math.min(1, (t % 240) / 200);
      if (!boss && t % 240 > 200 && sinceBoss > 30) {
        c.bossSummon(t);
        boss = true;
        sinceBoss = 0;
      } else if (boss && sinceBoss > 25) {
        boss = false;
        if (tier === 0 && t > 200) {
          c.bossDefeated(t, true);
          for (const [b, dt] of [
            ['rally', 1.6],
            ['fusion', 2.6],
            ['flash', 3.8],
            ['pullback', 4],
            ['reveal', 8],
            ['roar', 8.6],
            ['card', 9.2],
            ['done', 11.1],
          ] as [Beat, number][]) {
            const at = t + dt;
            for (let u = t; u < at; u += 0.025) {
              f.now = u;
              c.update(u, inputs({ tier, energy: e, boss: false }));
            }
            if (b === 'pullback') tier = 1;
            c.beat(b, at);
            t = at;
          }
        } else if (Math.floor(t) % 2 === 0) c.bossDefeated(t, false);
        else c.bossEscaped(t);
      }
      sinceBoss += 0.025;
      c.update(t, inputs({ tier, energy: e, tension: e > 0.7 ? e : 0, boss, urgency: boss ? Math.min(1, sinceBoss / 25) : 0 }));
      const w = Math.floor(t / 30);
      windows.set(w, f.played.length);
    }
    // Music every 30 s window: never stuck silent.
    let prev = 0;
    for (const [w, count] of windows) {
      if (w > 0) expect(count - prev, `window ${w}`).toBeGreaterThan(20);
      prev = count;
    }
    expect(c.stats.late).toBe(0);
    for (const p of f.played) {
      expect(Number.isFinite(p.t)).toBe(true);
      expect(Number.isFinite(p.dur)).toBe(true);
    }
    expect(tier).toBe(1);
    // Roughly 3-6 events a second: steady density, no runaway.
    expect(f.played.length / 1200).toBeGreaterThan(2);
    expect(f.played.length / 1200).toBeLessThan(12);
  });
});

describe('pitched events', () => {
  it('only pitched instruments carry pitches', () => {
    const { c, f } = begin(15);
    run(c, f, 0, 30, inputs({ energy: 1 }));
    for (const p of f.played) if (pitched(p)) expect(p.ev.midi).toBeGreaterThan(30);
  });
});
