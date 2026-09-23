// Generative, adaptive music (WP 2.6, PLAN §5): a composed score (themes.ts) varied and developed
// live (composer.ts, form.ts), scheduled on the audio clock (conductor.ts) and played by
// synthesized instruments (performer.ts, dsp.ts) on the engine's music bus and hall reverb.
//
// Silent on the title; after the first gesture the Meadow fades in. The music reads game state
// every scheduler tick (tier, boss, the Wyrm Gauge, army size) and reacts to bossSummon /
// bossDefeated / bossEscaped, zoomBegin / zoomEnd and the zoom director's beats. It runs on audio
// time only, so hit-stop and slow-mo never touch it; the engine suspends it with the tab.
import type { Scene } from '../../app/scene';
import { sel, type GameState } from '../../core';
import { clamp, smoothstep } from '../../lib/math';
import type { MusicApi } from './api';
import { Conductor, type Beat, type MusicInputs } from './conductor';
import { WebPerformer } from './performer';

const TICK_MS = 25;

/** The zoom's beats at their nominal times (s): the debug sequence, until the director drives them. */
const NOMINAL_BEATS: readonly (readonly [Beat, number])[] = [
  ['rally', 0],
  ['fusion', 1],
  ['flash', 2.2],
  ['pullback', 2.4],
  ['reveal', 6.4],
  ['roar', 7],
  ['card', 7.6],
  ['done', 9.5],
];

/** Army size and how far into the tier (the gauge): what the arrangement grows with. */
function energyOf(s: GameState, gauge: number): number {
  let units = 0;
  for (const k in s.units) units += s.units[k as keyof typeof s.units] ?? 0;
  const army = Math.min(1, Math.log1p(units) / Math.log1p(60));
  return clamp(0.08 + 0.62 * army + 0.3 * gauge, 0, 1);
}

/** 0..1 as the boss clock runs out or the boss nears death. */
function urgencyOf(s: GameState): number {
  const w = s.wyrm;
  const d = s.dragon;
  const left = w && w.bossDur > 0 ? w.bossT / w.bossDur : 1;
  const hp = d.maxHp.gt(0) ? d.hp.div(d.maxHp).toNumber() : 1;
  return Math.max(smoothstep(0.4, 0.1, left), smoothstep(0.45, 0.15, hp));
}

export function createMusic(scene: Scene): MusicApi {
  return new Music(scene).api;
}

class Music {
  readonly api: MusicApi;
  private perf: WebPerformer | null = null;
  private cond: Conductor | null = null;
  private wetVol: GainNode | null = null;
  private readonly inp: MusicInputs = { tier: 0, boss: false, energy: 0, tension: 0, urgency: 0 };
  private energy = -1;
  private lastT = 0;
  private urgencyAt = 0;
  private prefetching = true;
  private ticks = 0;
  private enabled = true;
  // Debug overrides (null / -1 = follow the game).
  private tierOv: number | null = null;
  private bossOv: boolean | null = null;
  private energyOv = -1;
  private tensionOv = -1;
  // Scheduler CPU (ms per tick, excluding the one-off buffer renders).
  private cpuAvg = 0;
  private cpuMax = 0;

  constructor(private readonly scene: Scene) {
    const self = this;
    this.api = {
      get playing() {
        return self.cond !== null && self.cond.mode !== 'off';
      },
      get mood() {
        return self.cond ? self.cond.info.mood : 'silent';
      },
      duck(db: number, seconds: number) {
        const ctx = self.scene.audio.ctx;
        if (ctx && self.perf) self.perf.duck(ctx.currentTime, db, seconds);
      },
    };
    const g = scene.game;
    // Events arrive in the game's drain, before the next scheduler tick: read the state first, so
    // the conductor sees the tier and boss the event is about (zoomEnd must arrive in the new tier).
    g.on('bossSummon', () => this.cond?.bossSummon(this.fresh()));
    g.on('bossDefeated', () => this.cond?.bossDefeated(this.fresh(), g.state.zoom.count === 0));
    g.on('bossEscaped', () => this.cond?.bossEscaped(this.fresh()));
    g.on('zoomBegin', () => this.cond?.beat('rally', this.fresh()));
    g.on('zoomEnd', () => this.cond?.zoomEnded(this.fresh()));
    // A new tier (or a load): the arrangement restarts from the new state's energy, not the old.
    g.on('zoomSwitch', () => (this.energy = -1));
    g.on('resync', () => (this.energy = -1));
    scene.settings.onChange(() => this.applyVolume(false));
    // Audio exists only after the first gesture: the title stays silent until then.
    scene.audio.onReady(() => this.boot());
    this.registerDebug();
  }

  private now(): number {
    return this.scene.audio.now;
  }

  /** The audio clock, with the inputs brought up to date (for event handlers). */
  private fresh(): number {
    const now = this.now();
    if (this.cond) this.readInputs(now);
    return now;
  }

  private boot(): void {
    if (this.perf) return;
    const audio = this.scene.audio;
    const ctx = audio.ctx;
    const noise = audio.noiseBuffer();
    if (!ctx || !noise) return;
    // The shared hall reverb returns to the master, not the music bus: scale our send by musicVolume.
    this.wetVol = ctx.createGain();
    this.wetVol.connect(audio.reverbSend);
    this.applyVolume(true);
    this.perf = new WebPerformer(ctx, audio.music, this.wetVol, noise);
    this.cond = new Conductor(this.perf, (Math.random() * 4294967296) >>> 0);
    this.scene.zoom.onBeat((b) => this.cond?.beat(b, this.fresh(), this.untilNextBeat(b)));
    window.setInterval(() => this.tick(), TICK_MS);
  }

  /** Seconds from beat `b` to the next one, from the director's beatTimes (undefined without them). */
  private untilNextBeat(b: Beat): number | undefined {
    const bt = this.scene.zoom.beatTimes;
    const i = NOMINAL_BEATS.findIndex(([x]) => x === b);
    const nx = NOMINAL_BEATS[i + 1];
    return bt && i >= 0 && nx ? bt[nx[0]] - bt[b] : undefined;
  }

  private applyVolume(immediate: boolean): void {
    const ctx = this.scene.audio.ctx;
    if (!ctx || !this.wetVol) return;
    const v = this.scene.settings.get('musicVolume');
    const p = this.wetVol.gain;
    if (immediate) p.value = v;
    else p.setTargetAtTime(v, ctx.currentTime, 0.03);
  }

  private audible(): boolean {
    const s = this.scene.settings.all;
    return !s.muted && s.masterVolume * s.musicVolume >= 0.001;
  }

  private tick(): void {
    const ctx = this.scene.audio.ctx;
    const cond = this.cond;
    const perf = this.perf;
    if (!ctx || ctx.state !== 'running' || !cond || !perf) return;
    // The instrument bank renders one buffer every 4th tick (strings first: the intro needs them).
    if (this.prefetching && ++this.ticks % 4 === 0) this.prefetching = perf.prefetchNext();
    const t0 = performance.now();
    const now = ctx.currentTime;
    this.readInputs(now);
    perf.setAudible(this.audible(), now);
    if (this.enabled && cond.mode === 'off' && this.energy >= 0 && cond.stats.sections === 0) cond.start(now, this.inp);
    cond.update(now, this.inp);
    perf.cleanup(now);
    const ms = performance.now() - t0;
    this.cpuAvg += (ms - this.cpuAvg) * 0.02;
    this.cpuMax = Math.max(this.cpuMax * 0.999, ms);
  }

  private readInputs(now: number): void {
    const s = this.scene.game.state;
    const dt = clamp(now - this.lastT, 0, 0.25);
    this.lastT = now;
    const d = s.dragon;
    const boss = this.bossOv ?? (d.boss !== null && d.boss !== undefined && d.phase !== 'dying' && d.phase !== 'leave');
    // Energy climbs over ~40 s and sinks slower, so the arrangement grows and never twitches.
    const gauge = sel.gauge(s);
    const target = energyOf(s, gauge);
    if (this.energy < 0) this.energy = target;
    else this.energy += clamp(target - this.energy, -0.012 * dt, 0.022 * dt);
    const inp = this.inp;
    inp.tier = this.tierOv ?? s.tier;
    inp.boss = boss;
    inp.energy = this.energyOv >= 0 ? this.energyOv : this.energy;
    // Tension rises through the last third of the gauge (0 once the boss is beaten).
    inp.tension = this.tensionOv >= 0 ? this.tensionOv : s.wyrm.cleared ? 0 : smoothstep(0.6, 1, gauge);
    if (!boss) inp.urgency = 0;
    else if (now - this.urgencyAt > 0.25 && this.bossOv === null) {
      this.urgencyAt = now;
      inp.urgency = urgencyOf(s);
    }
  }

  private setEnabled(on: boolean): void {
    this.enabled = on;
    const c = this.cond;
    if (!c) return;
    if (!on) c.stop(this.now());
    else if (c.mode === 'off') c.start(this.now(), this.inp, 2);
  }

  /** Debug: the zoom's beats at nominal times (optionally after a boss's fall). */
  private playZoom(fall: boolean): void {
    const c = this.cond;
    if (!c) return;
    if (fall) {
      this.bossOv = null;
      c.bossDefeated(this.now(), true);
    }
    const from = this.tierOv ?? this.scene.game.state.tier;
    const lead = fall ? 1.6 : 0;
    for (const [b, at] of NOMINAL_BEATS) {
      window.setTimeout(() => {
        // The new tier is in state from the pull-back on.
        if (b === 'pullback') this.tierOv = Math.min(1, from + 1);
        this.cond?.beat(b, this.fresh());
      }, (lead + at) * 1000);
    }
  }

  private registerDebug(): void {
    const dbg = this.scene.debug;
    if (!dbg.enabled) return;
    // Console / agent handle (debug only): __scaleMusic.cond.info, .perf.nodes, .tick() ...
    (window as unknown as { __scaleMusic?: Music }).__scaleMusic = this;
    dbg.section('Music');
    dbg.watch('music', () => {
      const c = this.cond;
      if (!c) return 'silent until the first gesture';
      const i = c.info;
      return i.mood === 'zoom' ? `zoom · ${i.label}` : `${i.mood} · ${i.label} · bar ${i.bar}/${i.bars} · ${i.chord} · ${i.bpm} bpm`;
    });
    dbg.watch('music in', () => {
      const i = this.inp;
      return `tier ${i.tier}${this.tierOv !== null ? '*' : ''} energy ${i.energy.toFixed(2)} tension ${i.tension.toFixed(2)}${i.boss ? ` BOSS ${i.urgency.toFixed(2)}` : ''}`;
    });
    dbg.watch('music voices', () => {
      const p = this.perf;
      return p ? `${p.voices} voices · nodes ${p.nodes + p.graphNodes} (peak ${p.peakNodes + p.graphNodes}) · dropped ${p.dropped}` : '-';
    });
    dbg.watch('music cpu', () => `${this.cpuAvg.toFixed(3)} ms/tick (max ${this.cpuMax.toFixed(2)}) ≈ ${((this.cpuAvg * 40) / 60).toFixed(3)} ms/frame`);
    dbg.button('music: Meadow', () => (this.tierOv = 0));
    dbg.button('music: Mountain', () => (this.tierOv = 1));
    dbg.button('music: tier from game', () => (this.tierOv = null));
    dbg.button('music: boss arrives', () => {
      this.bossOv = true;
      this.cond?.bossSummon(this.now());
    });
    dbg.button('music: boss defeated', () => {
      this.bossOv = null;
      this.cond?.bossDefeated(this.now(), false);
    });
    dbg.button('music: boss escaped', () => {
      this.bossOv = null;
      this.cond?.bossEscaped(this.now());
    });
    dbg.button('music: zoom beats', () => this.playZoom(false));
    dbg.button('music: boss falls, then zoom', () => this.playZoom(true));
    dbg.slider('music energy (left = auto)', -0.05, 1, 0.05, () => Math.max(-0.05, this.energyOv), (v) => (this.energyOv = v < 0 ? -1 : v));
    dbg.slider('music tension (left = auto)', -0.05, 1, 0.05, () => Math.max(-0.05, this.tensionOv), (v) => (this.tensionOv = v < 0 ? -1 : v));
    dbg.toggle('music on', () => this.enabled, (v) => this.setEnabled(v));
  }
}
