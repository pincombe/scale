// Boss and gauge juice (WP 2.2): the dread that builds as the Wyrm Gauge fills, and the boss's
// arrival, fight, urgency, fall and escape. Created by fx/index.ts, updated from the fx.text layer;
// the tremor's sway goes through Camera.sway (applied in the next camera.update, 0 during a zoom).
//
//   tremor     every ordinary kill: TREMOR_DELAY s after the kill's own juice, the ground rolls in
//              proportion to the gauge (tuning.ts TREMOR_EXP): a low, rolling camera sway (not
//              trauma's sharp shake), a wave of dust puffs rising along the ground line from the
//              right edge of the stage to the left, and grit hopping out of the grass. The foreground
//              grass shivers with it (camera shake scales with parallax depth).
//   summon     (bossSummon) the sky darkens over ~1.5 s (post.grade over the backdrop only: cool,
//              desaturating, deepest at the top), the red vignette starts its slow heartbeat, and a heavy tremor rolls in as
//              the boss approaches. The eye in the hills opens too (backdrop/eyeTimeline.ts).
//   engage     (its timer starts: sel.bossClockRunning) a full kick, a short camera push, trauma,
//              shockwaves and a dust wave from its feet, a hard heartbeat and a faint crimson flash.
//   urgency    the timer's last HEART_URGENT_FROM s: the heartbeat races and the red deepens.
//   fall       (bossDefeated) BOSS_HIT_STOP + a long slow-mo, a big warm flash, rings scaled to the
//              corpse, an ember storm, light shafts and a collapse tremor; the sky clears at once.
//              The first boss's fall leads into the zoom: everything here yields to scene.zoom.active.
//   escape     (bossEscaped) the heartbeat stops after one last beat, the dark sky lingers, then
//              lifts slowly; a long tremor follows the boss off stage right.
// reduceFlashes: a steady red tint instead of a pulse, no crimson flash (post scales the others).
// reduceMotion: the tremor sway and push scale with camera.motionScale.
// Only BOSS_HIT_STOP/BOSS_SLOW_MO touch the time scale (tuning.ts; the sim mirrors them).
import type { Scene } from '../../app/scene';
import type { View } from '../types';
import type { PostLayer } from '../post';
import type { ParticleSpec } from '../particles';
import { CURVE_FADE, CURVE_PULSE, particleSpec } from '../particles';
import type { Palette } from '../palette';
import type { Presets } from './presets';
import { sel } from '../../core';
import { approach, clamp01 } from '../../lib/math';
import { mixHex } from '../../lib/color';
import { rect, vec2 } from '../../lib/vec';
import { BOSS_HIT_STOP, BOSS_SLOW_MO, BOSS_SLOW_MO_DUR } from './tuning';
import { fxSprites } from './sprites';
import {
  bossUrgency,
  heartPeriod,
  heartPulse,
  pushEnvelope,
  PUSH_DUR,
  TREMOR_DELAY,
  TREMOR_PX,
  tremorDuration,
  tremorEnvelope,
  tremorStrength,
} from './dread';

export interface BossFxDeps {
  post: PostLayer;
  presets(): Presets;
  /** Continuous emitter over the dragon's body (fx/index.ts EM_BODY). */
  emitBody(spec: ParticleSpec, rate: number, seconds: number, scale: number): void;
  /** Camera trauma, capped (fx/index.ts shake). */
  shake(t: number, cap: number): void;
}

export interface BossFx {
  update(v: View): void;
  /** Start a tremor now (debug). */
  tremor(strength: number): void;
  onHeartbeat(fn: (urgency: number) => void): () => void;
  status(): string;
}

// ---- tuning (visual only: nothing here touches the time scale) ----
/** Sky darkening: seconds to fully darken at the summon, to clear at the fall, to clear after an escape. */
const DARK_IN = 1.5;
const DARK_OUT_FALL = 1.1;
const DARK_OUT_ESCAPE = 2.6;
/** After an escape the dark sky lingers this long before it starts to lift. */
const ESCAPE_HOLD = 1.3;
/** Red vignette: resting alpha through the fight (calm -> urgent), and the pulse's extra gain. */
const RED_BASE = 0.2;
const RED_BASE_URGENT = 0.36;
const RED_PULSE = 0.85;
const RED_PULSE_URGENT = 1.3;
/** The engage beat hits this much harder than an ordinary one. */
const ENGAGE_BEAT = 1.9;
/** Camera push when the boss engages (punch zoom fraction at the envelope's peak). */
const PUSH = 0.085;
/** The dust wave crosses the stage in this many seconds of its tremor. */
const WAVE_T = 0.95;

export function createBossFx(scene: Scene, deps: BossFxDeps): BossFx {
  const { game, time, camera } = scene;
  const post = deps.post;
  const tmp = vec2();
  const box = rect();
  const vis = rect();

  // ---- palette-tinted specs: the tremor's rising dust and the grit hopping out of the grass ----
  let quakeDust: ParticleSpec | null = null;
  let grit: ParticleSpec | null = null;
  let groundRing: ParticleSpec | null = null;
  let specsFor: Palette | null = null;
  const specs = (): void => {
    if (specsFor === scene.palette && quakeDust) return;
    const p = scene.palette;
    specsFor = p;
    quakeDust = particleSpec({
      sprite: scene.atlas.tint(scene.sprites.dust, mixHex(p.haze, '#c8a484', 0.5)),
      life: 1.9,
      lifeVar: 0.35,
      speed: 95,
      speedVar: 0.5,
      angle: -Math.PI / 2,
      spread: 0.55,
      gravity: -10,
      drag: 1.5,
      size: 50,
      sizeEnd: 175,
      sizeVar: 0.4,
      curve: CURVE_PULSE,
      alpha: 0.5,
      rotVar: Math.PI,
      spinVar: 0.3,
    });
    groundRing = particleSpec({
      sprite: scene.atlas.tint(fxSprites(scene.atlas).groundRing, p.accent.glow),
      additive: true,
      life: 0.5,
      size: 60,
      sizeEnd: 400,
      curve: CURVE_FADE,
    });
    grit = particleSpec({
      sprite: scene.atlas.tint(scene.sprites.dust, mixHex(p.silhouette, p.ground, 0.5)),
      life: 0.7,
      lifeVar: 0.3,
      speed: 150,
      speedVar: 0.5,
      angle: -Math.PI / 2,
      spread: 0.45,
      gravity: 1100,
      drag: 0.6,
      ground: true,
      size: 6,
      sizeEnd: 4,
      sizeVar: 0.5,
      curve: CURVE_FADE,
      alpha: 0.9,
    });
  };

  // ---- state ----
  let clock = 0;
  /** Linear darkness 0..1 (eased on display), and until when an escape holds it. */
  let darkLin = 0;
  let darkHold = -1;
  let darkOutRate = 1 / DARK_OUT_FALL;
  /** Heartbeat: on while a boss fights; s since the last lub; its strength boost. */
  let heartOn = false;
  let heartT = 99;
  let beatGain = 1;
  let redBase = 0;
  let urgency = 0;
  /** The boss (dragon id) whose engage already played. */
  let engagedId = -1;
  let pushT = PUSH_DUR;
  // Tremor: one at a time (a stronger one replaces a fading one).
  let trStr = 0;
  let trT = 0;
  let trDur = 0;
  let trDir = -1;
  /** A tremor waiting to roll in (after a kill), its strength and when (clock). */
  let pendStr = 0;
  let pendAt = -1;
  let dustAcc = 0;
  let gritAcc = 0;
  /** The sway this frame's tremor asks of the camera (CSS px peak; Camera.sway). */
  let swayOut = 0;
  const beatFns: ((u: number) => void)[] = [];

  const startTremor = (strength: number, dir: number, dur = tremorDuration(strength)): void => {
    const cur = trDur > 0 && trT < trDur ? trStr * tremorEnvelope(trT / trDur) : 0;
    if (strength < cur) return;
    trStr = strength;
    trT = 0;
    trDur = dur;
    trDir = dir;
    dustAcc = gritAcc = 0;
  };

  const zooming = (): boolean => scene.zoom.active || game.state.zoom.stage !== null;

  /** A shockwave ring `px` CSS px across at the end of its `life`, at alpha `a` (big rings stay soft). */
  const wave = (x: number, y: number, px: number, life: number, a: number, ground = false): void => {
    const w = scene.particles.world;
    const k = 1 / camera.zoomEff;
    specs();
    const i = w.spawn(ground ? groundRing! : deps.presets().ring, x, y, 0, 0);
    w.size0[i] = px * 0.12 * k;
    w.size1[i] = px * k;
    w.life[i] = life;
    w.alpha[i] = a;
  };

  const beat = (gain: number): void => {
    heartT = 0;
    beatGain = gain;
    for (let i = 0; i < beatFns.length; i++) beatFns[i]!(urgency);
  };

  // ---- events ----
  game.on('dragonDeath', () => {
    const s = game.state;
    if (s.dragon.boss || s.wyrm.cleared || s.zoom.stage !== null) return;
    const str = tremorStrength(sel.gauge(s));
    if (str < 0.004) return;
    pendStr = str;
    pendAt = clock + TREMOR_DELAY;
  });

  game.on('bossSummon', () => {
    // The previous kill's tremor is superseded by the arrival's.
    pendAt = -1;
    startTremor(0.8, -1, 2.4);
    beat(1.2);
  });

  const engage = (): void => {
    const p = deps.presets();
    const w = scene.particles.world;
    const k = 1 / camera.zoomEff;
    scene.dragon.bounds(box);
    const fx = box.x + box.w * 0.45;
    post.kick(1);
    pushT = 0;
    deps.shake(0.5, 0.7);
    const bpx = box.w * camera.zoomEff;
    // Flat ellipses skimming the ground from its feet (the coach label draws over them).
    wave(fx, 0, Math.max(480, bpx * 1.5), 0.6, 0.5, true);
    wave(fx, 0, Math.max(260, bpx * 0.8), 0.36, 0.7, true);
    const n = 14;
    for (let j = 0; j < n; j++) w.burst(p.dust, box.x + Math.random() * box.w, 0, 1, -Math.PI / 2, k * 1.4);
    startTremor(0.7, -1, 1.8);
    beat(ENGAGE_BEAT);
    if (!scene.settings.get('reduceFlashes')) post.flash('#ff3b2e', 0.07, 0.5);
  };

  game.on('bossDefeated', () => {
    // Time effects first, unconditionally: the sim's JuiceClock applies them on this event too.
    time.hitStop(BOSS_HIT_STOP);
    time.slowMo(BOSS_SLOW_MO, BOSS_SLOW_MO_DUR);
    const s = game.state;
    heartOn = false;
    darkOutRate = 1 / DARK_OUT_FALL;
    darkHold = -1;
    if (!s.dragon.boss || s.dragon.phase !== 'dying') return;
    const p = deps.presets();
    const w = scene.particles.world;
    const k = 1 / camera.zoomEff;
    scene.dragon.bounds(box);
    const px = box.w * camera.zoomEff;
    const cx = box.x + box.w * 0.5;
    const cy = box.y + box.h * 0.55;
    const r = px / 300;
    // Light: a big warm flash (the dark sky breaks), a bloom, a white-hot glint.
    post.flash('#ffcf8a', 0.3, 1.25);
    post.kick(1);
    deps.shake(0.9, 1);
    const clampR = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
    w.burst(p.flareBig, cx, cy, 1, 0, k * clampR(r * 0.8, 1, 2));
    w.burst(p.bloom, cx, cy, 1, 0, k * clampR(r * 1.1, 1.2, 2.8));
    w.burst(p.glint, cx, cy, 1, 0, k * clampR(r, 1.6, 3));
    // Shockwaves sized to the corpse, softer as they grow (they expand in slow-mo: a slow boom).
    wave(cx, cy, Math.max(300, px * 0.9), 0.3, 0.45);
    wave(cx, cy, Math.max(520, px * 1.7), 0.55, 0.26);
    wave(cx, cy, Math.max(800, px * 2.8), 0.8, 0.16);
    wave(cx, 0, Math.max(900, px * 3.4), 1.0, 0.35, true);
    // The ember storm: a burst over the body, then the body pours embers while it collapses.
    for (let j = 0; j < 70; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.ember, tmp.x, tmp.y, 1, -Math.PI / 2, k * 1.6);
    }
    for (let j = 0; j < 30; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.sparkBig, tmp.x, tmp.y, 1, -Math.PI / 2, k * 0.9);
    }
    for (let j = 0; j < 12; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.smoke, tmp.x, tmp.y, 1, -Math.PI / 2, k * 2);
    }
    // Short enough to finish before the first zoom's rally (the emitters also stop at zoomBegin).
    deps.emitBody(p.ember, 160, 1.6, 1.5);
    // Light shafts rising from the corpse.
    for (let j = 0; j < 3; j++) {
      const bx = box.x + box.w * (0.25 + 0.25 * j);
      const i = w.spawn(p.beam, bx, 0, 0, -40 * k);
      const sz = k * clampR(0.9 + 0.3 * r, 1, 1.8) * (j === 1 ? 1.2 : 0.85);
      w.size0[i] *= sz;
      w.size1[i] *= sz;
      w.y[i] = -w.size0[i]! * 0.42;
    }
    startTremor(1, 1, 2.6);
  });

  game.on('bossEscaped', () => {
    heartOn = false;
    beat(1);
    darkHold = clock + ESCAPE_HOLD;
    darkOutRate = 1 / DARK_OUT_ESCAPE;
    startTremor(0.85, 1, 3.2);
  });

  game.on('resync', () => {
    const s = game.state;
    const up = !!s.dragon.boss && s.dragon.phase !== 'dying' && s.dragon.phase !== 'leave';
    darkLin = up ? 1 : 0;
    darkHold = -1;
    heartOn = up;
    redBase = up ? RED_BASE : 0;
    engagedId = up && sel.bossClockRunning(s) ? s.dragon.id : -1;
    pushT = PUSH_DUR;
    trDur = 0;
    pendAt = -1;
  });

  // ---- per frame ----
  const updateTremor = (v: View): void => {
    if (pendAt >= 0 && clock >= pendAt) {
      pendAt = -1;
      startTremor(pendStr, -1);
    }
    swayOut = 0;
    if (!(trDur > 0) || trT >= trDur) return;
    const dt = v.realDt;
    trT += dt;
    if (zooming()) {
      trDur = 0;
      return;
    }
    const u = trT / trDur;
    const env = tremorEnvelope(u);
    const str = trStr;
    // The sway (Camera.sway: low, rolling, x motionScale there), applied from the next camera update.
    swayOut = TREMOR_PX * (camera.viewH / 900) * (0.12 + 0.88 * str) * env;
    // Dust and grit: a wave front crossing the stage, then scattered puffs as it settles.
    specs();
    const w = scene.particles.world;
    const k = 1 / camera.zoomEff;
    camera.visibleRect(vis, 0);
    const x0 = vis.x;
    const x1 = vis.x + vis.w * (1 - camera.insetRight / Math.max(1, camera.viewW));
    const uw = trT / WAVE_T;
    const rate = (6 + 60 * str) * (uw < 1 ? 1 : env * 1.2);
    dustAcc += rate * dt;
    gritAcc += rate * 1.6 * str * dt;
    while (dustAcc >= 1) {
      dustAcc -= 1;
      const f = uw < 1 ? uw + (Math.random() - 0.5) * 0.12 : Math.random();
      const x = trDir < 0 ? x1 - f * (x1 - x0) : x0 + f * (x1 - x0);
      w.burst(quakeDust!, x, (2 + 6 * Math.random()) * k, 1, -Math.PI / 2, k * (0.6 + 0.8 * str));
    }
    while (gritAcc >= 1) {
      gritAcc -= 1;
      const f = uw < 1 ? uw + (Math.random() - 0.5) * 0.2 : Math.random();
      const x = trDir < 0 ? x1 - f * (x1 - x0) : x0 + f * (x1 - x0);
      w.burst(grit!, x, -1 * k, 1, -Math.PI / 2, k * (0.7 + 0.5 * str));
    }
  };

  const update = (v: View): void => {
    const dt = v.realDt;
    clock += dt;
    const s = game.state;
    const d = s.dragon;
    const zoom = zooming();
    const bossUp = !!d.boss && d.phase !== 'dying' && d.phase !== 'leave' && !zoom;

    // Sky.
    let target = bossUp ? 1 : 0;
    if (clock < darkHold && !zoom) target = 1;
    if (bossUp) darkOutRate = 1 / DARK_OUT_FALL;
    darkLin = approach(darkLin, target, (target > darkLin ? 1 / DARK_IN : zoom ? 3 : darkOutRate) * dt);
    post.dread.dark = darkLin * darkLin * (3 - 2 * darkLin);

    // Engage: the boss becomes hittable (its timer starts).
    if (bossUp && d.id !== engagedId && sel.bossClockRunning(s)) {
      engagedId = d.id;
      engage();
    }

    // Heartbeat and the red vignette: on exactly while a boss is up (an escape's or a fall's last
    // beat still plays out; a debug skip, a leave or a tier change stop it).
    heartOn = bossUp;
    urgency = bossUp && engagedId === d.id ? bossUrgency(sel.bossTimeLeft(s)) : 0;
    const baseTarget = heartOn ? RED_BASE + (RED_BASE_URGENT - RED_BASE) * urgency : 0;
    redBase = approach(redBase, baseTarget, (heartOn ? 0.5 : 0.35) * dt);
    heartT += dt;
    if (heartOn && heartT >= heartPeriod(urgency)) beat(1);
    let red = redBase;
    if (redBase > 0.002) {
      if (scene.settings.get('reduceFlashes')) red = redBase * 1.35;
      else {
        const gain = RED_PULSE + (RED_PULSE_URGENT - RED_PULSE) * urgency;
        red = redBase * (1 + gain * beatGain * heartPulse(heartT));
      }
    }
    post.dread.red = zoom ? Math.max(0, post.dread.red - dt * 2) : clamp01(red);

    // Camera push after the engage (held by re-arming the punch every frame).
    if (pushT < PUSH_DUR) {
      pushT += dt;
      if (!zoom) camera.punchZoom(PUSH * pushEnvelope(pushT));
    }

    updateTremor(v);
    camera.sway = zoom ? 0 : swayOut;
  };

  return {
    update,
    tremor(strength) {
      startTremor(clamp01(strength), -1);
    },
    onHeartbeat(fn) {
      beatFns.push(fn);
      return () => {
        const i = beatFns.indexOf(fn);
        if (i >= 0) beatFns.splice(i, 1);
      };
    },
    status() {
      const tr = trDur > 0 && trT < trDur ? `tremor ${trStr.toFixed(2)} ${(trT / trDur).toFixed(2)}` : 'still';
      return `dark ${post.dread.dark.toFixed(2)} red ${post.dread.red.toFixed(2)} urg ${urgency.toFixed(2)} ${tr}`;
    },
  };
}
