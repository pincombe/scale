// Juice (WP 1.4): every click, hit and kill should feel great. createFx(scene) returns the FxApi
// (./api.ts) plus the layers 'fx.text' (slot 5: damage numbers and callouts) and 'post' (slot 6:
// ../post.ts). Effects key off game events, the scene.dragon / scene.crowd services and the camera,
// never off another module's internals.
//
// ---- Presets (./presets.ts; authored in screen px, pass scale = 1 / camera.zoomEff in world) ----
//   spark       click sparks: white -> gold -> fire streaks fountaining up          (world, additive)
//   sparkBig    crit sparks: bigger, faster, white-gold, all directions              (world, additive)
//   sparkSmall  dim little sparks for army blows                                     (world, additive)
//   flare       brief bloom at an impact; flareBig for crits and kills               (world, additive)
//   glint       4-point star glint                                                   (world, additive)
//   slash       crescent streak; set particle rot to orient it                       (world, additive)
//   ring        expanding shockwave ring                                             (world, additive)
//   ember       rising fire embers, hot white -> ember red                           (world, additive)
//   dust        low ground puff that skids on the ground                             (world, normal)
//   smoke       dark rising smoke                                                    (world, normal)
//   shimmer     gold motes floating up (milestones, upgrades)                        (world, additive)
//   beam        soft vertical light shaft (spawned with rot -PI/2)                   (world, additive)
//   coin        spinning coin (96-frame flip ramp) for the HUD fountain              (screen, normal)
//   coinGlint   glint where coins land on the HUD                                    (screen, additive)
// Others can reuse them via scene.fx.burst(name, wx, wy, intensity) (see FxPreset in ./api.ts).
//
// ---- Reactions ----
//   strike       sparks, flare, slash streak across the impact, click number, tiny shake + zoom punch
//     crit       + white-gold sparks, glint, double shockwave, X-slash, a big gold number that slams
//                  in (rapid crits merge into it), kick (chromatic split). A decaying "crit heat"
//                  damps the kick and shake of a crit spree, and hit-stop (70 ms) only lands on the
//                  first crit after a CRIT_STOP_GAP pause: isolated crits punch, sprees feel like
//                  power, not an earthquake. No full-screen flash on crits.
//     stagger    + STAGGERED! callout, big ring, ember burst, gentle warm flash
//   armyHit      small sparks per blow/arrow, ONE aggregated army number (merges), shake ~ damage/maxHp
//   dragonDeath  hit-stop, short slow-mo beat, then visuals scaled by killScale (corpse screen size +
//                  reward): warm gold flash, kick, amber bloom, shockwaves, embers + smoke + dust,
//                  smoldering embers over the dying body, big +gold number, and the coin fountain:
//                  coins burst from the corpse, then home to the HUD 'gold' anchor (retargeted if it
//                  moves); every arrival pulses the counter and fires onCoinLanded(count, value),
//                  each coin carrying an exact Decimal share of the reward. All land ~0.6-1.4 s
//                  after death.
//   goldGain     (stagger) a few coins from the weak spot + gold number
//   milestone / unlock(unit) / purchase(upgrade)   gold shimmer and light shafts rising over the army
//                  (merged: one shimmer per frame however many events a purchase emits)
//
// Timing: world effects run on scaled time (they freeze in hit-stop and crawl in slow-mo); numbers
// and the coin flight (particles.screen runs on the real clock) use wall time so the reward always
// arrives on schedule.
//
// Time effects (constants in tuning.ts, imported by the balance sim too): crit hit-stop
// CRIT_HIT_STOP (STAGGER_HIT_STOP on a stagger), at most once per CRIT_STOP_GAP; kill
// KILL_HIT_STOP + slowMo(KILL_SLOW_MO, KILL_SLOW_MO_DUR); kicks: isolated crit 0.55 (none in a
// spree), stagger 0.8, kill 0.35-1 by killScale.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { DamageKind, FxApi, FxPreset } from './api';
import { D, type Decimal } from '../../core/decimal';
import type { Palette } from '../palette';
import { createPost, type PostLayer } from '../post';
import { PF_HOMING, type ParticleSpec, type ParticleSystem } from '../particles';
import { rect, vec2 } from '../../lib/vec';
import { buildPresets, type Presets } from './presets';
import { fxSprites } from './sprites';
import { NK_ARMY, NK_CALLOUT, NK_CLICK, NK_CRIT, NK_GOLD, NK_REWARD, NumberPool } from './numbers';
import {
  CRIT_COOL,
  CRIT_HIT_STOP,
  CRIT_STOP_GAP,
  KILL_HIT_STOP,
  killScale,
  KILL_SLOW_MO,
  KILL_SLOW_MO_DUR,
  STAGGER_HIT_STOP,
  coinCount,
  coinDelay,
  coinShares,
  critDamp,
  damageFrac,
  heatAfterCrit,
  hitTrauma,
} from './tuning';

export interface FxRender {
  api: FxApi;
  text: Layer;
  post: PostLayer;
}

const TAG_GOLD = 1;
const KIND_ID: Record<DamageKind, number> = { click: NK_CLICK, crit: NK_CRIT, army: NK_ARMY, gold: NK_GOLD };

// ---- Emitters: spawn a preset continuously over a region for a while (shimmer, smolder) ----
const EMAX = 16;
const EM_RECT = 0;
const EM_BODY = 1;

export function createFx(scene: Scene): FxRender {
  const post = createPost(scene);
  const { game, time, camera } = scene;

  let presets: Presets | null = null;
  let presetsFor: Palette | null = null;
  const P = (): Presets => {
    if (!presets || presetsFor !== scene.palette) {
      presets = buildPresets(scene.atlas, scene.sprites, scene.palette);
      presetsFor = scene.palette;
    }
    return presets;
  };

  let coinIcon: HTMLCanvasElement | null = null;
  let glowGold: HTMLCanvasElement | null = null;
  const numbers = new NumberPool(
    () => {
      if (!coinIcon) coinIcon = scene.atlas.canvas(fxSprites(scene.atlas).coin);
      return coinIcon;
    },
    () => {
      if (!glowGold) glowGold = scene.atlas.canvas(scene.atlas.tint(scene.sprites.glow, scene.palette.accent.gold, 0.5));
      return glowGold;
    },
  );

  const eActive = new Uint8Array(EMAX);
  const eMode = new Uint8Array(EMAX);
  const eSpec: (ParticleSpec | null)[] = new Array<ParticleSpec | null>(EMAX).fill(null);
  const eX = new Float64Array(EMAX);
  const eY = new Float64Array(EMAX);
  const eW = new Float64Array(EMAX);
  const eH = new Float64Array(EMAX);
  const eRate = new Float32Array(EMAX);
  const eLeft = new Float32Array(EMAX);
  const eAcc = new Float32Array(EMAX);
  const eScale = new Float32Array(EMAX);

  const emit = (spec: ParticleSpec, mode: number, x: number, y: number, w: number, h: number, rate: number, seconds: number, scale = 1): void => {
    let slot = -1;
    for (let i = 0; i < EMAX; i++) {
      if (!eActive[i]) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return;
    eActive[slot] = 1;
    eSpec[slot] = spec;
    eMode[slot] = mode;
    eX[slot] = x;
    eY[slot] = y;
    eW[slot] = w;
    eH[slot] = h;
    eRate[slot] = rate;
    eLeft[slot] = seconds;
    eAcc[slot] = 0;
    eScale[slot] = scale;
  };

  const tmp = vec2();
  const tmp2 = vec2();
  const tmp3 = vec2();
  const box = rect();
  const world = (): ParticleSystem => scene.particles.world;
  const screen = (): ParticleSystem => scene.particles.screen;

  const updateEmitters = (dt: number): void => {
    if (dt <= 0) return;
    const w = world();
    const k = 1 / camera.zoomEff;
    for (let i = 0; i < EMAX; i++) {
      if (!eActive[i]) continue;
      eLeft[i] -= dt;
      if (eLeft[i]! <= 0) {
        eActive[i] = 0;
        continue;
      }
      eAcc[i] += eRate[i]! * dt;
      const spec = eSpec[i]!;
      while (eAcc[i]! >= 1) {
        eAcc[i] -= 1;
        let x: number;
        let y: number;
        if (eMode[i] === EM_BODY) {
          scene.dragon.impactPoint(tmp);
          x = tmp.x;
          y = tmp.y;
        } else {
          x = eX[i]! + Math.random() * eW[i]!;
          y = eY[i]! + Math.random() * eH[i]!;
        }
        w.burst(spec, x, y, 1, spec.angle, k * eScale[i]!);
      }
    }
  };

  /** One slash streak across (x, y) at `angle` (rad), sized in screen px * k. */
  const slash = (x: number, y: number, angle: number, k: number, size = 1): void => {
    const w = world();
    const s = P().slash;
    const sp = 110 * k;
    const i = w.spawn(s, x, y, Math.cos(angle) * sp, Math.sin(angle) * sp);
    w.rot[i] = angle;
    w.size0[i] *= k * size;
    w.size1[i] *= k * size;
  };

  /** A ring with custom size/life (the preset is a quick one). */
  const ring = (x: number, y: number, k: number, size: number, life: number): void => {
    const w = world();
    const i = w.spawn(P().ring, x, y, 0, 0);
    w.size0[i] *= k * size * 0.5;
    w.size1[i] *= k * size;
    w.life[i] = life;
  };

  let slashFlip = false;

  // ---- coins ----
  const ZERO = D(0);
  let landed = 0;
  let landedValue: Decimal = D(0);
  /** Decimal share carried by each screen particle slot (gold coins only). */
  const coinValue: (Decimal | null)[] = new Array<Decimal | null>(scene.particles.screen.capacity).fill(null);
  let coinTx = -1;
  let coinTy = -1;
  let deathClock = -1;
  let firstLand = -1;
  let lastLand = -1;
  let clock = 0;
  let glints = 0;

  const coins = (sx: number, sy: number, want: number, spreadPx: number, total: Decimal): void => {
    const s = P().coin;
    const scr = screen();
    const target = scene.ui.anchor('gold', tmp2);
    const tx = target ? target.x : 36;
    const ty = target ? target.y : 32;
    coinTx = tx;
    coinTy = ty;
    const shares = coinShares(total, want);
    const n = shares.count;
    const hs = Math.max(0.7, Math.min(1.3, camera.viewH / 900));
    for (let j = 0; j < n; j++) {
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * s.spread;
      const sp = s.speed * (1 + s.speedVar * (Math.random() * 2 - 1)) * hs;
      const i = scr.spawn(s, sx + (Math.random() - 0.5) * spreadPx, sy + (Math.random() - 0.5) * spreadPx * 0.4, Math.cos(a) * sp, Math.sin(a) * sp);
      scr.grav[i] *= hs;
      scr.tag[i] = TAG_GOLD;
      coinValue[i] = j === n - 1 ? shares.last : shares.each;
      // Arrival order is staggered so they land as a run of clinks, not one clump.
      scr.homeTo(i, tx, ty, coinDelay(j, n) + Math.random() * 0.04, 1.6);
    }
  };

  // particles.screen's single onArrive slot belongs to fx (coins); others subscribe through
  // FxApi.onCoinLanded.
  scene.particles.screen.onArrive = (sys, i) => {
    if (sys.tag[i] !== TAG_GOLD) return;
    landed++;
    const v = coinValue[i];
    if (v) {
      landedValue = landedValue.add(v);
      coinValue[i] = null;
    }
  };

  /** Add trauma, but never push it past `cap` (sprees saturate instead of escalating). */
  const shake = (t: number, cap: number): void => {
    const room = cap - camera.trauma;
    if (room > 0) camera.addTrauma(t < room ? t : room);
  };

  // ---- crit heat: a spree of crits damps kick/shake and skips hit-stop ----
  let critHeat = 0;
  let lastCrit = -10;

  /**
   * Where a strike's number starts (world): above small dragons (so it never covers them), and
   * pushed off the head toward the tail (the dragon faces left, so +x) when it would cover it.
   */
  const numberAnchor = (x: number, y: number, liftPx: number): void => {
    const z = camera.zoomEff;
    const k = 1 / z;
    scene.dragon.bounds(box);
    let ny = y - liftPx * k;
    if (box.h * z < 140) ny = Math.min(ny, box.y - 28 * k);
    scene.dragon.headPoint(tmp3);
    let nx = x;
    const dx = (nx - tmp3.x) * z;
    if (dx > -60 && dx < 60) nx = tmp3.x + 60 * k;
    tmp2.x = nx;
    tmp2.y = ny;
  };

  // ---- event reactions ----
  const frac = (damage: Decimal): number => damageFrac(damage, game.state.dragon.maxHp);

  game.on('strike', (e) => {
    const p = P();
    const w = world();
    const k = 1 / camera.zoomEff;
    const f = frac(e.damage);
    slashFlip = !slashFlip;
    if (e.crit) {
      w.burst(p.sparkBig, e.x, e.y, 26, -Math.PI / 2, k);
      w.burst(p.spark, e.x, e.y, 14, -Math.PI / 2, k);
      w.burst(p.flareBig, e.x, e.y, 1, 0, k * 0.34);
      w.burst(p.glint, e.x, e.y, 1, 0, k * 1.15);
      w.burst(p.ember, e.x, e.y, 8, -Math.PI / 2, k);
      ring(e.x, e.y, k, 1, 0.3);
      ring(e.x, e.y, k, 1.8, 0.5);
      const a = -0.6 + (Math.random() - 0.5) * 0.3;
      slash(e.x, e.y, a, k, 1.35);
      slash(e.x, e.y, a + 1.25 + Math.PI, k, 1.2);
      numberAnchor(e.x, e.y, 36);
      numbers.crit(tmp2.x, tmp2.y, e.damage);
      const damp = critDamp(critHeat);
      critHeat = heatAfterCrit(critHeat);
      // Hit-stop and the chromatic kick only on the first crit after a pause (and on kills):
      // an isolated crit punches; a spree gets sparks, a merged number, damped shake, zoom punch.
      if (clock - lastCrit >= CRIT_STOP_GAP) {
        time.hitStop(e.stagger ? STAGGER_HIT_STOP : CRIT_HIT_STOP);
        post.kick(0.55);
      } else camera.punchZoom(0.02);
      lastCrit = clock;
      shake(hitTrauma(f, 'crit') * damp, 0.25 + 0.4 * damp);
    } else {
      w.burst(p.spark, e.x, e.y, 14, -Math.PI / 2, k);
      w.burst(p.flare, e.x, e.y, 1, 0, k);
      const a = (slashFlip ? -0.55 : 0.55) + (Math.random() - 0.5) * 0.35;
      slash(e.x, e.y, slashFlip ? a : a + Math.PI, k);
      numberAnchor(e.x, e.y, 30);
      numbers.click(tmp2.x, tmp2.y, e.damage);
      shake(hitTrauma(f, 'click'), 0.35);
      camera.punchZoom(0.014);
    }
    if (e.stagger) {
      if (!scene.dragon.weakSpot(tmp)) scene.dragon.headPoint(tmp);
      scene.dragon.bounds(box);
      // Above the dragon, clear of the crit number rising from the weak spot.
      numbers.spawn(NK_CALLOUT, box.x + box.w * 0.5, Math.min(tmp.y - 110 * k, box.y - 70 * k), null, 'STAGGERED!');
      ring(tmp.x, tmp.y, k, 2.6, 0.6);
      w.burst(p.ember, tmp.x, tmp.y, 24, -Math.PI / 2, k * 1.3);
      w.burst(p.glint, tmp.x, tmp.y, 1, 0, k * 2.2);
      shake(0.3, 0.6);
      post.kick(0.8);
      post.flash(scene.palette.accent.gold, 0.08, 0.3);
    }
  });

  game.on('armyHit', (e) => {
    const p = P();
    const w = world();
    const k = 1 / camera.zoomEff;
    const melee = e.unit === 'footman';
    const n = Math.min(e.hits, melee ? 6 : 8);
    for (let j = 0; j < n; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.sparkSmall, tmp.x, tmp.y, melee ? 3 : 2, -Math.PI / 2, k);
    }
    // Army numbers float above the dragon's back, apart from the click numbers at the cursor.
    scene.dragon.bounds(box);
    numbers.army(0, box.x + box.w * (0.3 + 0.4 * Math.random()), box.y - 14 * k, e.damage);
    const f = frac(e.damage);
    shake(hitTrauma(f, 'army'), 0.35);
    if (f > 0.08) camera.punchZoom(0.008);
  });

  game.on('dragonDeath', (e) => {
    const p = P();
    const w = world();
    const k = 1 / camera.zoomEff;
    scene.dragon.bounds(box);
    const cx = box.x + box.w * 0.5;
    const cy = box.y + box.h * 0.55;
    const px = box.w * camera.zoomEff;
    // Magnitude: a newt's death is a crisp warm pop; the big bloom is saved for big dragons.
    const m = killScale(px, e.gold);
    const sz = Math.max(0.6, Math.min(2.2, Math.sqrt(px / 140)));

    w.burst(p.bloom, cx, cy, 1, 0, k * (0.24 + 1.0 * m));
    if (m > 0.3) w.burst(p.glint, cx, cy, 1, 0, k * (0.6 + 0.8 * m));
    ring(cx, cy, k, 0.7 + 1.3 * m, 0.4);
    if (m > 0.25) ring(cx, cy, k, 1.6 + 2 * m, 0.8);
    const embers = Math.round(20 + 40 * m);
    for (let j = 0; j < embers; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.ember, tmp.x, tmp.y, 1, -Math.PI / 2, k * (1 + 0.3 * m));
    }
    const sparks = Math.round(6 + 10 * m);
    for (let j = 0; j < sparks; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.sparkBig, tmp.x, tmp.y, 1, -Math.PI / 2, k * (0.55 + 0.3 * m));
    }
    const smoke = Math.round(3 + 6 * m);
    for (let j = 0; j < smoke; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.smoke, tmp.x, tmp.y, 1, -Math.PI / 2, k * sz * 0.8);
    }
    const dust = Math.round(6 + 10 * m);
    for (let j = 0; j < dust; j++) w.burst(p.dust, box.x + Math.random() * box.w, -0.02 * box.h, 1, -Math.PI / 2, k * sz);
    // The body smolders while it collapses (the dying phase), in slow-mo.
    emit(p.ember, EM_BODY, 0, 0, 0, 0, 20 + 20 * m, 1.5, 1.1);

    // Above the coin fountain (numbers draw under particles.screen), clear of small corpses.
    numbers.spawn(NK_REWARD, cx, box.y - Math.max(20, 110 - box.h * camera.zoomEff) * k, e.gold);

    camera.worldToScreen(cx, cy, tmp);
    deathClock = clock;
    firstLand = lastLand = -1;
    coins(tmp.x, tmp.y, coinCount(e.gold), Math.min(160, px * 0.5), e.gold);

    time.hitStop(KILL_HIT_STOP);
    time.slowMo(KILL_SLOW_MO, KILL_SLOW_MO_DUR);
    shake(hitTrauma(1, 'kill') * (0.6 + 0.4 * m), 0.5 + 0.25 * m);
    post.kick(0.35 + 0.65 * m);
    // Warm and gentle: gold, never a white-out.
    post.flash(scene.palette.accent.gold, 0.06 + 0.12 * m, 0.45);
  });

  game.on('goldGain', (e) => {
    if (e.source !== 'stagger') return;
    if (!scene.dragon.weakSpot(tmp)) scene.dragon.headPoint(tmp);
    const wx = tmp.x;
    const wy = tmp.y;
    numbers.spawn(NK_GOLD, wx, wy - 50 / camera.zoomEff, e.amount);
    camera.worldToScreen(wx, wy, tmp);
    coins(tmp.x, tmp.y, 6, 20, e.amount);
  });

  const armyShimmer = (strength: number): void => {
    const p = P();
    const w = world();
    const k = 1 / camera.zoomEff;
    scene.crowd.bounds(box);
    emit(p.shimmer, EM_RECT, box.x, box.y + box.h * 0.2, box.w, box.h * 0.8, 70 * strength, 1.1, 1);
    const beams = strength >= 1 ? 3 : 1;
    for (let j = 0; j < beams; j++) {
      const bx = box.x + box.w * (beams === 1 ? 0.5 : 0.18 + 0.32 * j);
      const i = w.spawn(p.beam, bx, 0, 0, -30 * k);
      w.size0[i] *= k * strength;
      w.size1[i] *= k * strength;
      w.y[i] = -w.size0[i]! * 0.42;
    }
  };

  // One purchase can emit several milestones (+ an unlock): merge them into one shimmer per frame.
  let shimmerPending = 0;
  let shimmerFlash = false;
  game.on('milestone', () => {
    shimmerPending = 1;
    shimmerFlash = true;
  });
  game.on('unlock', (e) => {
    if (e.kind === 'unit') shimmerPending = 1;
  });
  game.on('purchase', (e) => {
    if (e.kind === 'upgrade' && shimmerPending < 0.6) shimmerPending = 0.6;
  });
  game.on('resync', () => {
    numbers.clear();
    eActive.fill(0);
    shimmerPending = 0;
    shimmerFlash = false;
    // Drop in-flight coins silently (no landing, no clink): the HUD snaps to state.
    const scr = screen();
    for (let i = 0; i < scr.capacity; i++) {
      if (scr.life[i] !== 0 && scr.tag[i] === TAG_GOLD) {
        scr.flags[i] &= ~PF_HOMING;
        scr.tag[i] = 0;
        scr.age[i] = scr.life[i]!;
      }
      coinValue[i] = null;
    }
    landed = 0;
    landedValue = ZERO;
  });

  // ---- API ----
  const burst = (preset: FxPreset, wx: number, wy: number, intensity = 1): void => {
    const p = P();
    const w = world();
    const k = 1 / camera.zoomEff;
    const c = (n: number): number => Math.max(1, Math.round(n * intensity));
    switch (preset) {
      case 'sparks':
        w.burst(p.spark, wx, wy, c(10), -Math.PI / 2, k);
        break;
      case 'sparksBig':
        w.burst(p.sparkBig, wx, wy, c(20), -Math.PI / 2, k);
        break;
      case 'embers':
        w.burst(p.ember, wx, wy, c(14), -Math.PI / 2, k);
        break;
      case 'dust':
        w.burst(p.dust, wx, wy, c(6), -Math.PI / 2, k);
        break;
      case 'smoke':
        w.burst(p.smoke, wx, wy, c(4), -Math.PI / 2, k);
        break;
      case 'shockwave':
        ring(wx, wy, k, intensity, 0.3 + 0.15 * intensity);
        break;
      case 'flare':
        w.burst(p.flare, wx, wy, 1, 0, k * intensity);
        break;
      case 'glint':
        w.burst(p.glint, wx, wy, 1, 0, k * intensity);
        break;
      case 'shimmer':
        w.burst(p.shimmer, wx, wy, c(12), -Math.PI / 2, k);
        break;
      case 'slash':
        slash(wx, wy, -0.5, k, intensity);
        break;
    }
  };

  const landedFns: ((n: number, value?: Decimal) => void)[] = [];
  const api: FxApi = {
    damageNumber(wx, wy, amount, kind) {
      if (kind === 'army') numbers.army(1, wx, wy, amount);
      else numbers.spawn(KIND_ID[kind], wx, wy, amount);
    },
    flash: (color, alpha, seconds) => post.flash(color, alpha, seconds),
    kick: (strength) => post.kick(strength),
    onCoinLanded(fn) {
      landedFns.push(fn);
      return () => {
        const i = landedFns.indexOf(fn);
        if (i >= 0) landedFns.splice(i, 1);
      };
    },
    burst,
  };

  // ---- debug ----
  const dbg = scene.debug;
  dbg.section('FX');
  dbg.watch('numbers', () => `${numbers.count} live, ${(numbers.memBytes / 1048576).toFixed(1)} MB`);
  dbg.watch('crit heat', () => critHeat.toFixed(2));
  dbg.watch('coins land', () => (firstLand < 0 ? '-' : `${firstLand.toFixed(2)}-${lastLand.toFixed(2)} s`));
  dbg.button('crit', () => {
    const d = scene.dragon;
    const p = d.weakSpot(tmp) ?? d.impactPoint(tmp);
    game.dispatch({ type: 'strike', weak: true, aimed: true, x: p.x, y: p.y });
  });
  dbg.button('stagger', () => {
    game.dispatch({ type: 'debug', op: 'phase', phase: 'windup', attack: 'breath' });
    const d = scene.dragon;
    const p = d.weakSpot(tmp) ?? d.headPoint(tmp);
    game.dispatch({ type: 'strike', weak: true, aimed: true, x: p.x, y: p.y });
  });
  dbg.button('milestone fx', () => {
    armyShimmer(1);
    post.flash(scene.palette.accent.gold, 0.08, 0.35);
  });

  // ---- the fx.text layer ----
  const text: Layer = {
    name: 'fx.text',
    visible: true,
    update(v: View) {
      clock += v.realDt;
      numbers.setDpr(v.dpr);
      numbers.update(v.realDt);
      updateEmitters(v.dt);
      critHeat = critHeat > 0 ? Math.max(0, critHeat - CRIT_COOL * v.realDt) : 0;
      if (shimmerPending > 0) {
        armyShimmer(shimmerPending);
        if (shimmerFlash) post.flash(scene.palette.accent.gold, 0.06, 0.35);
        shimmerPending = 0;
        shimmerFlash = false;
      }
      // Coins follow the gold counter if it moves (or appears after they were launched).
      const anchor = scene.ui.anchor('gold', tmp3);
      if (anchor && (anchor.x !== coinTx || anchor.y !== coinTy) && screen().count > 0) {
        coinTx = anchor.x;
        coinTy = anchor.y;
        screen().retarget(TAG_GOLD, coinTx, coinTy);
      }
      if (landed > 0) {
        const n = landed;
        const value = landedValue;
        landed = 0;
        landedValue = ZERO;
        if (deathClock >= 0) {
          const t = clock - deathClock;
          if (firstLand < 0) firstLand = t;
          lastLand = t;
        }
        glints += n;
        scene.ui.pulse('gold');
        for (let j = 0; j < landedFns.length; j++) landedFns[j]!(n, value);
      }
      if (glints > 0) {
        glints = 0;
        const a = scene.ui.anchor('gold', tmp2);
        if (a) screen().burst(P().coinGlint, a.x + (Math.random() - 0.5) * 10, a.y + (Math.random() - 0.5) * 10, 1, 0, 1);
      }
    },
    draw(ctx: CanvasRenderingContext2D, v: View) {
      numbers.draw(ctx, v.camera, v.dpr);
    },
  };

  return { api, text, post };
}
