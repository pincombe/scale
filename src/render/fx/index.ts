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
// Others can reuse them via scene.fx.burst?.(name, wx, wy, intensity) (see FxPreset in ./api.ts).
//
// ---- Reactions ----
//   strike       sparks, flare, slash streak across the impact, click number, tiny shake + zoom punch
//     crit       + hit-stop 70-80 ms, white-gold sparks, glint, double shockwave, X-slash, big gold
//                  number that slams in, kick (chromatic split), small warm flash
//     stagger    + STAGGERED! callout, big ring, ember burst
//   armyHit      small sparks per blow/arrow, ONE aggregated army number (merges), shake ~ damage/maxHp
//   dragonDeath  hit-stop, short slow-mo beat (~0.55 s), warm flash, kick, flare, shockwaves, embers + smoke + dust,
//                  smoldering embers over the dying body, big +gold number, and the coin fountain:
//                  coins burst from the corpse, then home to the HUD 'gold' anchor; every arrival
//                  pulses the counter and fires onCoinLanded. All coins land ~0.6-1.4 s after death.
//   goldGain     (stagger) a few coins from the weak spot + gold number
//   milestone / unlock(unit) / purchase(upgrade)   gold shimmer and light shafts rising over the army
//
// Timing: world effects run on scaled time (they freeze in hit-stop and crawl in slow-mo); numbers
// and the coin flight run on wall time so the reward always arrives on schedule.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { DamageKind, FxApi, FxPreset } from './api';
import type { Decimal } from '../../core/decimal';
import type { Palette } from '../palette';
import { createPost, type PostLayer } from '../post';
import type { ParticleSpec, ParticleSystem } from '../particles';
import { rect, vec2 } from '../../lib/vec';
import { buildPresets, type Presets } from './presets';
import { fxSprites } from './sprites';
import { NK_ARMY, NK_CALLOUT, NK_CLICK, NK_CRIT, NK_GOLD, NK_REWARD, NumberPool } from './numbers';
import { coinCount, coinDelay, damageFrac, hitTrauma } from './tuning';

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
  let landed = 0;
  let deathClock = -1;
  let firstLand = -1;
  let lastLand = -1;
  let clock = 0;
  let glints = 0;

  const coins = (sx: number, sy: number, n: number, spreadPx: number): void => {
    const s = P().coin;
    const scr = screen();
    const target = scene.ui.anchor('gold', tmp2);
    const tx = target ? target.x : 36;
    const ty = target ? target.y : 32;
    const hs = Math.max(0.7, Math.min(1.3, camera.viewH / 900));
    for (let j = 0; j < n; j++) {
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * s.spread;
      const sp = s.speed * (1 + s.speedVar * (Math.random() * 2 - 1)) * hs;
      const i = scr.spawn(s, sx + (Math.random() - 0.5) * spreadPx, sy + (Math.random() - 0.5) * spreadPx * 0.4, Math.cos(a) * sp, Math.sin(a) * sp);
      scr.grav[i] *= hs;
      scr.tag[i] = TAG_GOLD;
      // Arrival order is staggered so they land as a run of clinks, not one clump.
      scr.homeTo(i, tx, ty, coinDelay(j, n) + Math.random() * 0.04, 1.6);
    }
  };

  // particles.screen's single onArrive slot belongs to fx (coins); others subscribe through
  // FxApi.onCoinLanded.
  scene.particles.screen.onArrive = (sys, i) => {
    if (sys.tag[i] === TAG_GOLD) landed++;
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
      w.burst(p.flareBig, e.x, e.y, 1, 0, k * 0.38);
      w.burst(p.glint, e.x, e.y, 1, 0, k * 1.5);
      w.burst(p.ember, e.x, e.y, 8, -Math.PI / 2, k);
      ring(e.x, e.y, k, 1, 0.3);
      ring(e.x, e.y, k, 1.8, 0.5);
      const a = -0.6 + (Math.random() - 0.5) * 0.3;
      slash(e.x, e.y, a, k, 1.35);
      slash(e.x, e.y, a + 1.25 + Math.PI, k, 1.2);
      numbers.spawn(NK_CRIT, e.x, e.y - 24 * k, e.damage);
      // Hit-stop only on crits (<= 80 ms; infra ignores one within 0.3 s of the last) and kills.
      time.hitStop(e.stagger ? 0.08 : 0.07);
      camera.addTrauma(hitTrauma(f, 'crit'));
      post.kick(0.55);
      post.flash(scene.palette.accent.glow, 0.12, 0.2);
    } else {
      w.burst(p.spark, e.x, e.y, 14, -Math.PI / 2, k);
      w.burst(p.flare, e.x, e.y, 1, 0, k);
      const a = (slashFlip ? -0.55 : 0.55) + (Math.random() - 0.5) * 0.35;
      slash(e.x, e.y, slashFlip ? a : a + Math.PI, k);
      numbers.spawn(NK_CLICK, e.x, e.y - 10 * k, e.damage);
      camera.addTrauma(hitTrauma(f, 'click'));
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
      camera.addTrauma(0.3);
      post.kick(0.8);
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
    camera.addTrauma(hitTrauma(f, 'army'));
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
    const sz = Math.max(0.75, Math.min(2.2, Math.sqrt(px / 140)));

    w.burst(p.flareBig, cx, cy, 1, 0, k * sz * 0.6);
    w.burst(p.glint, cx, cy, 1, 0, k * 2.4 * sz);
    ring(cx, cy, k, 1.6 * sz, 0.45);
    ring(cx, cy, k, 3.2 * sz, 0.8);
    for (let j = 0; j < 44; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.ember, tmp.x, tmp.y, 1, -Math.PI / 2, k * 1.25);
    }
    for (let j = 0; j < 14; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.sparkBig, tmp.x, tmp.y, 1, -Math.PI / 2, k * 0.8);
    }
    for (let j = 0; j < 8; j++) {
      scene.dragon.impactPoint(tmp);
      w.burst(p.smoke, tmp.x, tmp.y, 1, -Math.PI / 2, k * sz * 0.8);
    }
    for (let j = 0; j < 14; j++) w.burst(p.dust, box.x + Math.random() * box.w, -0.02 * box.h, 1, -Math.PI / 2, k * sz);
    // The body smolders while it collapses (the dying phase), in slow-mo.
    emit(p.ember, EM_BODY, 0, 0, 0, 0, 34, 1.5, 1.1);

    numbers.spawn(NK_REWARD, cx, box.y - 20 * k, e.gold);

    camera.worldToScreen(cx, cy, tmp);
    deathClock = clock;
    firstLand = lastLand = -1;
    coins(tmp.x, tmp.y, coinCount(e.gold), Math.min(160, px * 0.5));

    time.hitStop(0.08);
    time.slowMo(0.25, 0.55);
    camera.addTrauma(hitTrauma(1, 'kill'));
    post.kick(1);
    post.flash(scene.palette.accent.glow, 0.34, 0.5);
  });

  game.on('goldGain', (e) => {
    if (e.source !== 'stagger') return;
    if (!scene.dragon.weakSpot(tmp)) scene.dragon.headPoint(tmp);
    const wx = tmp.x;
    const wy = tmp.y;
    numbers.spawn(NK_GOLD, wx, wy - 50 / camera.zoomEff, e.amount);
    camera.worldToScreen(wx, wy, tmp);
    coins(tmp.x, tmp.y, 6, 20);
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
    w.burst(p.glint, box.x + box.w * 0.5, box.y + box.h * 0.4, 1, 0, k * 1.6 * strength);
  };

  game.on('milestone', () => {
    armyShimmer(1);
    post.flash(scene.palette.accent.gold, 0.08, 0.35);
  });
  game.on('unlock', (e) => {
    if (e.kind === 'unit') armyShimmer(1);
  });
  game.on('purchase', (e) => {
    if (e.kind === 'upgrade') armyShimmer(0.6);
  });
  game.on('resync', () => {
    numbers.clear();
    eActive.fill(0);
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

  const landedFns: ((n: number) => void)[] = [];
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
  dbg.watch('numbers', () => String(numbers.count));
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
      // The coin flight runs on wall time: top up the screen system (its layer advances by the
      // scaled dt) so slow-mo and hit-stop never delay the reward. See the report / BUILD_LOG.
      const extra = v.realDt - v.dt;
      if (extra > 1e-5) screen().update(extra);
      if (landed > 0) {
        const n = landed;
        landed = 0;
        if (deathClock >= 0) {
          const t = clock - deathClock;
          if (firstLand < 0) firstLand = t;
          lastLand = t;
        }
        glints += n;
        scene.ui.pulse('gold');
        for (let j = 0; j < landedFns.length; j++) landedFns[j]!(n);
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
