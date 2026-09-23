// The conductor (timing and form; no WebAudio, unit-tested against a fake performer). It keeps the
// song position on the audio clock (never game time: hit-stop and slow-mo don't touch the music),
// composes one section at a time, and streams its events to the performer LOOKAHEAD seconds
// ahead. Changes of mood land on bar lines; the boss arrives on a timpani roll; the zoom's beats
// drive a cue sequence (held breath, choir swell, sub hit, shimmer, the horn call).
import { Rng } from '../../lib/rng';
import { composeSection } from './composer';
import { choirMargin, Form, gateMargin, type Entry } from './form';
import { F_ACCENT, F_BIG, F_SWELL, type HitKind, type MoodId, type NoteInst, type Role, type SEv, type Section } from './score';
import * as T from './themes';
import { voicing } from './theory';

/** How far ahead events are handed to the performer (s). The scheduler runs every ~25 ms. */
export const LOOKAHEAD = 0.2;
/** Events later than this (a stalled page) are dropped, or clipped if long. */
const LATE = 0.05;
/** The music's level under the zoom's title card. */
export const CARD_LEVEL = 0.72;

export type Vowel = 'oo' | 'oh' | 'ah';
export type Beat = 'rally' | 'fusion' | 'flash' | 'pullback' | 'reveal' | 'roar' | 'card' | 'done';

/** What the game tells the music, every scheduler tick. */
export interface MusicInputs {
  tier: number;
  /** A boss is fighting (not dying or leaving). */
  boss: boolean;
  /** 0..1, smoothed: army size and progress through the tier. */
  energy: number;
  /** 0..1: the Wyrm Gauge nearly full. */
  tension: number;
  /** 0..1: the boss timer running out (or the boss nearly dead). */
  urgency: number;
}

export interface Performer {
  /** A note or hit at audio time `t`, lasting `dur` s (a roll ends at t + dur). */
  play(ev: SEv, t: number, dur: number, gain: number): void;
  drone(t: number, midis: readonly number[] | null, level: number, fade: number): void;
  choir(t: number, midis: readonly number[] | null, level: number, tau: number, glide: number, vowel: Vowel, rise?: number, vowelTime?: number): void;
  shimmer(t: number, level: number, fade: number): void;
  /** The music's master level, ramped linearly over `dur`. */
  fader(t: number, level: number, dur: number): void;
  /** Fade every sounding voice (and the drone, choir, shimmer) out over `fade` s from `t`. */
  releaseAll(t: number, fade: number): void;
  /** Lift the SFX carve in the midrange (the zoom has no clicks to protect). */
  openMid(t: number, open: boolean): void;
}

const ROLES: readonly Role[] = ['melody', 'counter', 'arp', 'pad', 'pulse', 'heart', 'echo', 'bass'];
const DRONE_LEVEL: Record<MoodId, number> = { meadow: 0.8, mountain: 1, boss: 0.9 };

export function moodOfTier(tier: number): MoodId {
  return tier >= 1 ? 'mountain' : 'meadow';
}

/** A one-off cue sound. */
function cue(inst: NoteInst | HitKind, midi: number, vel: number, flags = 0): SEv {
  return { at: 0, dt: 0, len: 0, inst, midi, vel, flags, role: 'melody' };
}

export class Conductor {
  mode: 'off' | 'song' | 'cue' = 'off';
  /** For the debug watch. */
  readonly info = { mood: 'silent', label: '', bar: 0, bars: 0, chord: '', bpm: 0 };
  readonly stats = { emitted: 0, late: 0, sections: 0 };

  private mood: MoodId = 'meadow';
  private form: Form | null = null;
  private sec: Section | null = null;
  private secStart = 0;
  private evi = 0;
  private openBar = -1;
  private boost = 0;
  private switchAt = -1;
  private sw: { mood: MoodId; entry: Entry; fade: number; delay: number } = { mood: 'meadow', entry: 'intro', fade: 1, delay: 0 };
  private readonly on = {} as Record<Role, boolean>;
  private readonly fading = {} as Record<Role, number>;
  private readonly held = {} as Record<Role, number>;
  private droneKey = '';
  private choirOn = false;
  private choirPrev: number[] | null = null;
  private inp: MusicInputs = { tier: 0, boss: false, energy: 0, tension: 0, urgency: 0 };
  private cueAt = 0;
  private cueStage = '';
  private bossSeen = -1;
  private bossGone = -1;

  constructor(
    private readonly perf: Performer,
    private readonly seed: number,
  ) {
    this.resetGates('meadow');
  }

  get currentMood(): MoodId {
    return this.mood;
  }

  /** Begin playing (after the first gesture): the tier's intro, fading in over `fadeIn` s. */
  start(now: number, inp: MusicInputs, fadeIn = 5): void {
    this.inp = inp;
    if (this.mode !== 'off') return;
    const at = now + 0.4;
    this.perf.fader(now, 0, 0);
    this.perf.fader(at, 1, fadeIn);
    this.startSong(inp.boss ? 'boss' : moodOfTier(inp.tier), inp.boss ? 'ostinato' : 'intro', at);
  }

  stop(now: number): void {
    if (this.mode === 'off') return;
    this.mode = 'off';
    this.sec = null;
    this.switchAt = -1;
    this.perf.fader(now, 0, 0.4);
    this.perf.releaseAll(now + 0.45, 0.05);
    this.info.mood = 'silent';
  }

  /** Call every scheduler tick with the audio clock. */
  update(now: number, inp: MusicInputs): void {
    this.inp = inp;
    if (this.mode === 'off') return;
    if (this.mode === 'cue') {
      // A cinematic that stalls (or a zoom with no beats) must not leave the game silent.
      if (now - this.cueAt > (this.cueStage === 'fall' ? 6 : 9)) this.resumeAfterCue(now);
      return;
    }
    this.reconcile(now);
    this.pump(now);
  }

  // ---- Game moments ----

  /** The gauge filled: the tier's music falls away under a roll, the boss music lands 1 s later. */
  bossSummon(now: number): void {
    if (this.mode !== 'song' || this.mood === 'boss') return;
    const t = now + 0.03;
    // Release first, then the roll (a release fades every voice alive when it is called), and the
    // switch itself releases nothing (fade -1).
    this.perf.releaseAll(t, 0.9);
    this.perf.play(cue('roll', 42, 0.85), t, 1, 1);
    this.schedule(t, 'boss', 'ostinato', -1, 1);
  }

  /**
   * The boss fell. Before the first zoom (it follows by itself) one great D major chord marks the
   * fall and the music holds its breath for the rally; otherwise a full cadence into D major, and
   * the tier's theme returns lifted.
   */
  bossDefeated(now: number, autoZoom: boolean): void {
    if (this.mode === 'off') return;
    if (autoZoom) {
      const t = this.mood === 'boss' && this.mode === 'song' ? Math.min(this.nextBeat(now), now + 0.35) : now + 0.05;
      this.enterCue(now, 'fall');
      for (const m of T.VICTORY_D) this.perf.play(cue('horn', m, 0.42, F_BIG), t, 0.75, 1);
      this.perf.play(cue('timp', 38, 0.75, F_ACCENT), t, 3, 1);
      this.perf.play(cue('doum', 0, 0.75), t, 0.5, 1);
      return;
    }
    if (this.mode !== 'song') return;
    this.schedule(this.mood === 'boss' ? this.nextBeat(now) : now + 0.05, 'boss', 'victory', 0.15, 0);
  }

  /** The boss got away: the drums fall back on the next bar, then the tier's music resumes. */
  bossEscaped(now: number): void {
    if (this.mode !== 'song' || this.mood !== 'boss') return;
    this.schedule(this.nextBarLine(now), 'boss', 'retreat', 0.5, 0);
  }

  /**
   * A zoom beat (scene.zoom.onBeat, or the debug sequence). `next` = seconds until the following
   * beat (from the director's beatTimes), so a swell can peak exactly on the flash and a roll land
   * on the roar; without it the nominal gaps are assumed. Tolerates missing or repeated beats.
   */
  beat(b: Beat, now: number, next?: number): void {
    if (this.mode === 'off') return;
    const t = now + 0.03;
    const p = this.perf;
    const gap = (nominal: number, lo: number, hi: number): number =>
      next !== undefined && Number.isFinite(next) && next > 0 ? Math.min(hi, Math.max(lo, next)) : nominal;
    switch (b) {
      case 'rally':
        if (this.mode === 'cue' && this.cueStage !== 'fall') return;
        this.enterCue(now, 'rally');
        p.fader(t, 0, 0.22);
        p.releaseAll(t + 0.24, 0.04);
        break;
      case 'fusion': {
        this.enterCue(now, 'fusion');
        const d = gap(1.2, 0.5, 3);
        p.fader(t, 1, 0.05);
        p.openMid(t, true);
        // The pile rises: an A sus4 swell sliding up a fourth into place, "oo" opening to "ah",
        // cresting just as the flash lands; a timpani roll under it ends on the flash.
        p.choir(t, T.ZOOM_SWELL, 0.95, d * 0.42, d * 0.9, 'oo', 5, 0.3);
        p.choir(t + 0.15, T.ZOOM_SWELL, 0.95, d * 0.42, d * 0.75, 'ah', 0, d);
        p.play(cue('roll', 33, 0.75), t, d, 1);
        break;
      }
      case 'flash':
        this.enterCue(now, 'flash');
        p.fader(t, 1, 0.02);
        p.play(cue('sub', 26, 0.6), t, 2.5, 1);
        p.play(cue('timp', 38, 0.55, F_ACCENT), t, 3, 1);
        p.play(cue('doum', 0, 0.6), t, 0.5, 1);
        // The chord peaks and resolves: A sus4 -> D major.
        p.choir(t, T.ZOOM_FLASH, 1.15, 0.02, 0.1, 'ah', 0, 0.1);
        p.choir(t + 0.3, T.ZOOM_FLASH, 0.85, 0.9, 0.1, 'ah');
        break;
      case 'pullback': {
        this.enterCue(now, 'pullback');
        const d = gap(4, 1.5, 8);
        p.shimmer(t, 1, 1.4);
        for (let i = 0; i < T.ZOOM_GLISS.length; i++) p.play(cue('harp', T.ZOOM_GLISS[i]!, 0.5 - i * 0.015), t + i * 0.075, 2, 1);
        // Wonder: D, then C over D and G over D as the meadow becomes a scale on a flank.
        p.choir(t + d / 3, T.ZOOM_PULL[1]!, 0.78, 0.6, 0.5, 'ah', 0, 1);
        p.choir(t + (2 * d) / 3, T.ZOOM_PULL[2]!, 0.74, 0.6, 0.5, 'oh', 0, 1);
        break;
      }
      case 'reveal': {
        this.enterCue(now, 'reveal');
        const d = gap(0.6, 0.3, 2);
        // The Mountain's minor: the choir darkens, the shimmer fades, a roll lands on the roar and
        // low horns swell toward it.
        p.choir(t, T.ZOOM_REVEAL, 0.82, 0.3, 0.35, 'oh', 0, 0.6);
        p.shimmer(t, 0, 2.2);
        p.play(cue('roll', 38, 0.8), t, d, 1);
        p.play(cue('horn', 38, 0.55, F_SWELL), t, d + 0.5, 1);
        p.play(cue('horn', 45, 0.5, F_SWELL), t, d + 0.5, 1);
        break;
      }
      case 'roar':
        if (this.mode !== 'cue') return;
        this.cueStage = 'roar';
        // The horn call enters, huge; the choir sinks away beneath it.
        p.choir(t + 0.5, T.ZOOM_REVEAL, 0.45, 1.2, 0.3, 'oh');
        p.choir(t + 3.2, null, 0, 1.2, 0, 'oh');
        this.startSong(moodOfTier(this.inp.tier), 'call', t + 0.25);
        break;
      case 'card':
        if (this.mode === 'cue') this.resumeAfterCue(now);
        p.fader(t, CARD_LEVEL, 1.5);
        break;
      case 'done':
        if (this.mode === 'cue') this.resumeAfterCue(now);
        p.fader(t, 1, 2);
        p.openMid(t, false);
        break;
    }
  }

  /** The zoom ended (zoomEnd): whatever beats arrived, play resumes with the tier's music. */
  zoomEnded(now: number): void {
    if (this.mode === 'cue') this.resumeAfterCue(now);
    else if (this.mode === 'song') {
      this.perf.fader(now + 0.05, 1, 2);
      this.perf.openMid(now + 0.05, false);
    }
  }

  // ---- Internals ----

  private enterCue(now: number, stage: string): void {
    if (this.mode === 'song') this.perf.releaseAll(now + 0.03, 0.2);
    this.mode = 'cue';
    this.sec = null;
    this.switchAt = -1;
    this.cueAt = now;
    this.cueStage = stage;
    this.choirOn = false;
    this.info.mood = 'zoom';
    this.info.label = stage;
  }

  private resumeAfterCue(now: number): void {
    const t = now + 0.05;
    this.perf.fader(t, 1, 1.5);
    this.perf.openMid(t, false);
    this.perf.choir(t, null, 0, 0.4, 0, 'oh');
    this.perf.shimmer(t, 0, 0.6);
    this.startSong(moodOfTier(this.inp.tier), 'call', t + 0.1);
  }

  /** Switch songs at `at` (the old song's sustained voices fade over `fade` s; -1 = none), starting the new one `delay` s later. */
  private schedule(at: number, mood: MoodId, entry: Entry, fade: number, delay: number): void {
    this.switchAt = at;
    this.sw = { mood, entry, fade, delay };
  }

  private resetGates(mood: MoodId): void {
    for (const r of ROLES) {
      this.on[r] = gateMargin(mood, r, this.inp.energy, this.inp.tension) >= 0;
      this.fading[r] = 0;
      this.held[r] = 99;
    }
  }

  private startSong(mood: MoodId, entry: Entry, at: number): void {
    this.mode = 'song';
    this.mood = mood;
    this.form = new Form(mood, entry);
    this.sec = null;
    this.switchAt = -1;
    this.droneKey = '';
    this.choirOn = false;
    this.choirPrev = null;
    this.resetGates(mood);
    this.compose(at);
  }

  /** Mood from state: catches a boss or a tier we were never told about (a load, a debug jump). */
  private reconcile(now: number): void {
    const sec = this.sec;
    if (this.switchAt >= 0 || !sec || sec.kind === 'victory' || sec.kind === 'retreat') return;
    const inBoss = this.mood === 'boss';
    if (this.inp.boss && !inBoss) {
      if (this.bossSeen < 0) this.bossSeen = now;
      if (now - this.bossSeen > 0.5) this.schedule(this.nextBarLine(now), 'boss', 'ostinato', 0.6, 0);
      return;
    }
    this.bossSeen = -1;
    if (!this.inp.boss && inBoss) {
      if (this.bossGone < 0) this.bossGone = now;
      if (now - this.bossGone > 3) this.schedule(this.nextBarLine(now), moodOfTier(this.inp.tier), 'episode', 1, 0);
      return;
    }
    this.bossGone = -1;
    const want = moodOfTier(this.inp.tier);
    if (!inBoss && want !== this.mood) this.schedule(this.nextBarLine(now), want, 'intro', 1.5, 0);
  }

  /** The first bar line of the current section that nothing has been emitted past. */
  private nextBarLine(now: number): number {
    const sec = this.sec;
    if (!sec) return now + LOOKAHEAD;
    const bd = sec.meter.secPerStep * sec.meter.stepsPerBar;
    const k = Math.ceil((now + LOOKAHEAD - this.secStart) / bd - 1e-9);
    return this.secStart + Math.max(0, Math.min(sec.bars, k)) * bd;
  }

  private nextBeat(now: number): number {
    const sec = this.sec;
    if (!sec) return now + 0.05;
    const bt = sec.meter.secPerStep * sec.meter.beatSteps;
    return this.secStart + Math.max(0, Math.ceil((now + LOOKAHEAD - this.secStart) / bt - 1e-9)) * bt;
  }

  /** Emit everything due before the horizon: bar openings, events, section changes, switches. */
  private pump(now: number): void {
    const horizon = now + LOOKAHEAD;
    for (let guard = 0; guard < 512; guard++) {
      const sec = this.sec;
      if (!sec) return;
      const sps = sec.meter.secPerStep;
      const bd = sps * sec.meter.stepsPerBar;
      const limit = this.switchAt >= 0 ? Math.min(horizon, this.switchAt) : horizon;
      const e = sec.events[this.evi];
      const evT = e ? this.secStart + e.at * sps + e.dt : Infinity;
      const barT = this.openBar + 1 < sec.bars ? this.secStart + (this.openBar + 1) * bd : Infinity;
      if (Math.min(evT, barT) < limit) {
        if (barT <= evT) this.open(this.openBar + 1, barT);
        else {
          const bar = Math.floor(e!.at / sec.meter.stepsPerBar);
          while (this.openBar < bar && this.openBar + 1 < sec.bars) this.open(this.openBar + 1, this.secStart + (this.openBar + 1) * bd);
          this.evi++;
          this.emit(e!, evT, now, sec);
        }
        continue;
      }
      if (this.switchAt >= 0 && this.switchAt < horizon) {
        const at = this.switchAt;
        if (this.sw.fade >= 0) this.perf.releaseAll(at, this.sw.fade);
        this.startSong(this.sw.mood, this.sw.entry, at + this.sw.delay);
        continue;
      }
      const end = this.secStart + sec.bars * bd;
      if (!e && barT === Infinity && end < horizon) {
        // A page that stalled while audio kept running rejoins the clock instead of bursting.
        this.compose(end < now - LATE ? now + 0.05 : end);
        continue;
      }
      return;
    }
  }

  private compose(start: number): void {
    const prev = this.sec;
    if (prev && this.mood === 'boss' && (prev.kind === 'victory' || prev.kind === 'retreat')) {
      // The fight is over: the tier's song returns (lifted for a while after a win).
      this.mood = moodOfTier(this.inp.tier);
      this.form = new Form(this.mood, prev.kind === 'victory' ? 'theme' : 'episode');
      this.boost = prev.kind === 'victory' ? 0.3 : 0;
      this.droneKey = '';
      this.resetGates(this.mood);
    }
    const step = this.form!.next(this.inp.energy, this.inp.tension, this.inp.urgency);
    const n = ++this.stats.sections;
    const sec = composeSection(this.mood, step.kind, step.variant, {
      rng: new Rng((this.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0),
      energy: Math.min(1, this.inp.energy + this.boost),
      tension: this.inp.tension,
      urgency: this.inp.urgency,
      tier: this.inp.tier,
      big: step.big,
    });
    this.boost *= 0.5;
    this.sec = sec;
    this.secStart = start;
    this.evi = 0;
    this.openBar = -1;
    const key = sec.drone ? sec.drone.join() : '';
    if (key !== this.droneKey) {
      this.droneKey = key;
      this.perf.drone(start, sec.drone, DRONE_LEVEL[sec.mood], n === 1 ? 4 : 1.5);
    }
  }

  private open(bar: number, at: number): void {
    this.openBar = bar;
    const sec = this.sec!;
    const e = Math.min(1, this.inp.energy + this.boost * 0.5);
    const t = this.inp.tension;
    for (const r of ROLES) {
      this.fading[r] = 0;
      if (++this.held[r] < 2) continue;
      const m = gateMargin(sec.mood, r, e, t);
      if (!this.on[r] && m >= 0) {
        this.on[r] = true;
        this.fading[r] = 1;
        this.held[r] = 0;
      } else if (this.on[r] && m < -0.08) {
        this.on[r] = false;
        this.fading[r] = -1;
        this.held[r] = 0;
      }
    }
    // The Mountain's choir hum, voice-led from chord to chord.
    const want = sec.choir && choirMargin(sec.mood, e) >= (this.choirOn ? -0.08 : 0);
    if (want) {
      const v = voicing(sec.chords[bar]![0]!, 4, 50, 69, this.choirPrev);
      this.perf.choir(at, v, 0.5 + 0.35 * e, this.choirOn ? 0.3 : 1.4, this.choirOn ? 0.4 : 0, 'oo');
      this.choirPrev = v;
      this.choirOn = true;
    } else if (this.choirOn) {
      this.perf.choir(at, null, 0, 0.9, 0, 'oo');
      this.choirOn = false;
      this.choirPrev = null;
    }
    const info = this.info;
    info.mood = sec.mood;
    info.label = sec.label;
    info.bar = bar + 1;
    info.bars = sec.bars;
    info.chord = sec.chords[bar]!.map((c) => c.name).join(' ');
    info.bpm = Math.round(60 / (sec.meter.secPerStep * sec.meter.beatSteps));
  }

  private emit(e: SEv, t: number, now: number, sec: Section): void {
    const f = this.fading[e.role];
    if (!this.on[e.role] && f !== -1) return;
    const spb = sec.meter.stepsPerBar;
    const x = (e.at % spb) / spb;
    const g = f === 1 ? 0.35 + 0.65 * x : f === -1 ? 1 - 0.75 * x : 1;
    let dur = e.len * sec.meter.secPerStep;
    let at = t;
    if (at < now - LATE) {
      const left = at + dur - now;
      if (dur < 0.6 || left < 0.3) {
        this.stats.late++;
        return;
      }
      dur = left;
      at = now;
    }
    this.stats.emitted++;
    this.perf.play(e, at, dur, g);
  }
}
