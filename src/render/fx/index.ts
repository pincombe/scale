// FX STUB (WP 0.2). The juice WP (1.4) replaces this folder (and render/post.ts): particle
// presets, damage numbers, hit-stop, screen shake, coins flying to the HUD, sword arcs.
//
// Contract kept by any replacement: createFx(scene) returns { api, text, post }: the FxApi
// (./api.ts) plus the layers 'fx.text' (slot 5) and 'post' (slot 6). The stub already wires the
// basic reactions (sparks + numbers on hits, coins to the 'gold' anchor, slow-mo on kills) so the
// skeleton plays; it's the place to make them spectacular.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { DamageKind, FxApi } from './api';
import type { Decimal } from '../../core/decimal';
import { fmt } from '../../core/format';
import { createPost, type PostLayer } from '../post';
import { CURVE_FADE, CURVE_FLASH, CURVE_HOLD, particleSpec, type ParticleSpec, type ParticleSystem } from '../particles';
import { outBack, outCubic } from '../../lib/ease';
import { rect, vec2 } from '../../lib/vec';

export interface FxRender {
  api: FxApi;
  text: Layer;
  post: PostLayer;
}

const MAX_NUMBERS = 64;
const KIND_ID: Record<DamageKind, number> = { click: 0, crit: 1, army: 2, gold: 3 };
const FONT = ['700 26px "Cinzel Variable", serif', '800 46px "Cinzel Variable", serif', '600 20px "Cinzel Variable", serif', '700 26px "Cinzel Variable", serif'];
const FILL = ['#fff4dc', '#ffd35a', '#ffcfa0', '#ffe27a'];
const LIFE = [0.75, 1.1, 0.7, 1.2];
const RISE = [58, 84, 40, 70];
const TAG_GOLD = 1;

interface Specs {
  spark: ParticleSpec;
  flare: ParticleSpec;
  ember: ParticleSpec;
  coin: ParticleSpec;
}

export function createFx(scene: Scene): FxRender {
  const post = createPost(scene);

  // Damage-number pool (struct of arrays; the text is formatted once, at spawn).
  const nActive = new Uint8Array(MAX_NUMBERS);
  const nX = new Float64Array(MAX_NUMBERS);
  const nY = new Float64Array(MAX_NUMBERS);
  const nAge = new Float32Array(MAX_NUMBERS);
  const nKind = new Uint8Array(MAX_NUMBERS);
  const nDrift = new Float32Array(MAX_NUMBERS);
  const nText: string[] = new Array<string>(MAX_NUMBERS).fill('');
  let nHead = 0;

  const landedFns: ((n: number) => void)[] = [];
  let landed = 0;
  const tmp = vec2();
  const box = rect();

  let specs: Specs | null = null;
  const ensureSpecs = (): Specs => {
    if (specs) return specs;
    const { atlas, sprites, palette } = scene;
    // Authored in screen px; world bursts pass scale = 1 / zoom.
    specs = {
      spark: particleSpec({
        sprite: atlas.ramp(sprites.spark, ['#ffffff', palette.accent.gold, palette.accent.fire], 4, 0.5),
        ramp: 4,
        additive: true,
        align: true,
        life: 0.3,
        lifeVar: 0.4,
        speed: 900,
        speedVar: 0.5,
        angle: -0.5,
        spread: 1.4,
        drag: 5,
        gravity: 1400,
        size: 34,
        sizeEnd: 10,
        curve: CURVE_FADE,
      }),
      flare: particleSpec({ sprite: atlas.tint(sprites.glow, palette.accent.glow, 0.7), additive: true, life: 0.14, lifeVar: 0.1, size: 110, sizeEnd: 170, sizeVar: 0.1, curve: CURVE_FLASH, alpha: 0.9 }),
      ember: particleSpec({ sprite: atlas.tint(sprites.ember, palette.accent.fire, 0.6), additive: true, life: 0.7, lifeVar: 0.4, speed: 320, speedVar: 0.6, angle: -1.2, spread: 1.2, drag: 2, gravity: 700, size: 9, sizeEnd: 3 }),
      coin: particleSpec({ sprite: sprites.coin, life: 2.6, lifeVar: 0.1, speed: 560, speedVar: 0.4, angle: -Math.PI / 2, spread: 1.05, gravity: 1500, size: 22, sizeEnd: 18, sizeVar: 0.18, curve: CURVE_HOLD, spinVar: 3 }),
    };
    return specs;
  };

  const spawnNumber = (wx: number, wy: number, amount: Decimal, kind: DamageKind): void => {
    const i = nHead;
    nHead = (nHead + 1) % MAX_NUMBERS;
    nActive[i] = 1;
    nX[i] = wx;
    nY[i] = wy;
    nAge[i] = 0;
    nKind[i] = KIND_ID[kind];
    nDrift[i] = (Math.random() - 0.5) * 36;
    nText[i] = (kind === 'gold' ? '+' : '') + fmt(amount);
  };

  const coins = (screen: ParticleSystem, sx: number, sy: number, n: number): void => {
    const s = ensureSpecs();
    const target = scene.ui.anchor('gold', tmp);
    for (let k = 0; k < n; k++) {
      const a = s.coin.angle + s.coin.spread * (Math.random() * 2 - 1);
      const sp = s.coin.speed * (1 + s.coin.speedVar * (Math.random() * 2 - 1));
      const i = screen.spawn(s.coin, sx, sy, Math.cos(a) * sp, Math.sin(a) * sp);
      screen.tag[i] = TAG_GOLD;
      if (target) screen.homeTo(i, target.x, target.y, 0.42 + Math.random() * 0.35, 1);
    }
  };

  const corpseScreen = (): void => {
    scene.dragon.bounds(box);
    scene.camera.worldToScreen(box.x + box.w * 0.5, box.y + box.h * 0.55, tmp);
  };

  scene.particles.screen.onArrive = (sys, i) => {
    if (sys.tag[i] === TAG_GOLD) landed++;
  };

  const { game, time, camera } = scene;

  game.on('strike', (e) => {
    const s = ensureSpecs();
    const world = scene.particles.world;
    const k = 1 / camera.zoomEff;
    spawnNumber(e.x, e.y - 12 * k, e.damage, e.crit ? 'crit' : 'click');
    world.burst(s.spark, e.x, e.y, e.crit ? 22 : 10, -0.5, k);
    world.burst(s.flare, e.x, e.y, 1, 0, k * (e.crit ? 1.6 : 1));
    if (e.crit) {
      world.burst(s.ember, e.x, e.y, 10, -1.2, k);
      time.hitStop(0.06);
      camera.addTrauma(0.32);
      api.kick(0.5);
      api.flash(scene.palette.accent.glow, 0.12, 0.18);
    } else {
      camera.addTrauma(0.14);
    }
  });

  game.on('armyHit', (e) => {
    const s = ensureSpecs();
    const world = scene.particles.world;
    const k = 1 / camera.zoomEff;
    const n = Math.min(e.hits, 5);
    for (let j = 0; j < n; j++) {
      scene.dragon.impactPoint(tmp);
      world.burst(s.spark, tmp.x, tmp.y, 3, -0.5, k * 0.7);
    }
    scene.dragon.impactPoint(tmp);
    spawnNumber(tmp.x, tmp.y, e.damage, 'army');
    camera.addTrauma(0.05);
  });

  game.on('dragonDeath', (e) => {
    const s = ensureSpecs();
    corpseScreen();
    const sx = tmp.x;
    const sy = tmp.y;
    const mag = Math.max(0, Math.log10(Math.max(1, e.gold.toNumber())));
    coins(scene.particles.screen, sx, sy, Math.min(36, Math.round(6 + 3 * mag)));
    scene.particles.screen.burst(s.flare, sx, sy, 1, 0, 2.2);
    scene.dragon.bounds(box);
    spawnNumber(box.x + box.w * 0.5, box.y - 0.1 * box.h, e.gold, 'gold');
    time.slowMo(0.25, 1.0);
    camera.addTrauma(0.55);
    api.kick(1);
    api.flash(scene.palette.accent.glow, 0.28, 0.35);
  });

  game.on('goldGain', (e) => {
    if (e.source !== 'stagger') return;
    corpseScreen();
    coins(scene.particles.screen, tmp.x, tmp.y, 6);
    if (!scene.dragon.weakSpot(tmp)) scene.dragon.headPoint(tmp);
    spawnNumber(tmp.x, tmp.y, e.amount, 'gold');
  });

  const api: FxApi = {
    damageNumber: spawnNumber,
    flash: (color, alpha, seconds) => post.flash(color, alpha, seconds),
    kick: (strength) => post.kick(strength),
    onCoinLanded(fn) {
      landedFns.push(fn);
      return () => {
        const i = landedFns.indexOf(fn);
        if (i >= 0) landedFns.splice(i, 1);
      };
    },
  };

  const text: Layer = {
    name: 'fx.text',
    visible: true,
    update(v: View) {
      for (let i = 0; i < MAX_NUMBERS; i++) {
        if (!nActive[i]) continue;
        nAge[i] += v.dt;
        if (nAge[i]! >= LIFE[nKind[i]!]!) nActive[i] = 0;
      }
      if (landed > 0) {
        const n = landed;
        landed = 0;
        scene.ui.pulse('gold');
        for (let j = 0; j < landedFns.length; j++) landedFns[j]!(n);
      }
    },
    draw(ctx: CanvasRenderingContext2D, v: View) {
      const cam = v.camera;
      const dpr = v.dpr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(24,10,4,0.85)';
      for (let i = 0; i < MAX_NUMBERS; i++) {
        if (!nActive[i]) continue;
        const kind = nKind[i]!;
        const t = nAge[i]! / LIFE[kind]!;
        cam.worldToScreen(nX[i]!, nY[i]!, tmp);
        const pop = kind === 1 ? 1.25 : 1;
        const sc = pop * (0.35 + 0.65 * outBack(Math.min(1, t / 0.16)));
        const x = tmp.x + nDrift[i]! * t;
        const y = tmp.y - RISE[kind]! * outCubic(t);
        ctx.globalAlpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
        ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * x, dpr * y);
        ctx.font = FONT[kind]!;
        ctx.lineWidth = kind === 1 ? 6 : 4.5;
        ctx.strokeText(nText[i]!, 0, 0);
        ctx.fillStyle = FILL[kind]!;
        ctx.fillText(nText[i]!, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
  };

  return { api, text, post };
}
