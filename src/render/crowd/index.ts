// Crowd STUB (WP 0.2). The knight-crowd WP (1.3) replaces this folder: sprite sheets, formation,
// strike / flung / cheer animations, banners, squads past ~300 sprites.
//
// Contract kept by any replacement: createCrowd(scene) returns { layer, view }: a Layer named
// 'crowd' (slot 2) and a CrowdView (./api.ts). The army stands at x < CLASH_X facing right,
// feet on y = 0, knights KNIGHT_HEIGHT tall. Counts come from state.units every frame (state is
// the truth); events only trigger one-shot animations. On 'resync', snap without march-ins.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { CrowdView } from './api';
import type { Palette } from '../palette';
import type { Rect, Vec2 } from '../../lib/vec';
import { CLASH_X, KNIGHT_HEIGHT } from '../world';
import { hash2f } from '../../lib/math';
import { outCubic, pulse } from '../../lib/ease';
import { CURVE_HOLD, particleSpec, type ParticleSpec } from '../particles';

export interface CrowdRender {
  layer: Layer;
  view: CrowdView;
}

const MAX_FOOTMEN = 240;
const MAX_ARCHERS = 90;
const HERO_X = CLASH_X - 0.95;
const COL_W = 0.62;
const ROWS = 3;
const SPRITE_W = 128;
const SPRITE_H = 192;
/** Figure height inside the sprite canvas (px); the rest is headroom for swords and plumes. */
const FIG_H = 150;

type Kind = 'hero' | 'footman' | 'archer';

/** Paint a knight silhouette facing right into a SPRITE_W x SPRITE_H canvas, feet at the bottom. */
function paintKnight(ctx: CanvasRenderingContext2D, kind: Kind, p: Palette): void {
  const s = FIG_H / 150;
  const base = SPRITE_H - 2;
  const cx = SPRITE_W * 0.45;
  const shape = (dx: number, dy: number, fill: string): void => {
    ctx.fillStyle = fill;
    ctx.save();
    ctx.translate(cx + dx, base + dy);
    ctx.scale(s, s);
    // Legs.
    ctx.fillRect(-13, -52, 10, 52);
    ctx.fillRect(3, -52, 10, 52);
    // Tabard / torso.
    ctx.beginPath();
    ctx.moveTo(-20, -50);
    ctx.lineTo(20, -50);
    ctx.lineTo(16, -104);
    ctx.lineTo(-16, -104);
    ctx.closePath();
    ctx.fill();
    // Shoulders.
    ctx.beginPath();
    ctx.ellipse(0, -104, 22, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // Helm.
    ctx.beginPath();
    ctx.moveTo(-12, -110);
    ctx.lineTo(-12, -136);
    ctx.quadraticCurveTo(0, -146, 12, -136);
    ctx.lineTo(13, -110);
    ctx.closePath();
    ctx.fill();
    // Shield (kite) on the near side.
    ctx.beginPath();
    ctx.moveTo(-26, -98);
    ctx.lineTo(-4, -98);
    ctx.lineTo(-6, -70);
    ctx.lineTo(-15, -56);
    ctx.lineTo(-24, -70);
    ctx.closePath();
    ctx.fill();
    if (kind === 'archer') {
      // Bow held forward.
      ctx.lineWidth = 4;
      ctx.strokeStyle = fill;
      ctx.beginPath();
      ctx.arc(20, -96, 30, -1.25, 1.25);
      ctx.stroke();
      ctx.fillRect(16, -100, 10, 6);
    } else {
      // Sword raised forward.
      ctx.save();
      ctx.translate(20, -92);
      ctx.rotate(-0.95);
      ctx.fillRect(-3, -4, 10, 8);
      ctx.fillRect(4, -9, 4, 18);
      ctx.beginPath();
      ctx.moveTo(8, -3);
      ctx.lineTo(kind === 'hero' ? 62 : 52, 0);
      ctx.lineTo(8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };
  // Rim toward the light, then the silhouette on top.
  shape(p.light.x * 2.4, p.light.y * 2.4, p.rim);
  shape(0, 0, p.silhouette);
  // Helm slit and (hero) plume in color.
  ctx.save();
  ctx.translate(cx, base);
  ctx.scale(s, s);
  ctx.fillStyle = p.rim;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(3, -128, 9, 2.5);
  ctx.globalAlpha = 1;
  if (kind === 'hero') {
    ctx.fillStyle = p.accent.banner;
    ctx.beginPath();
    ctx.moveTo(-2, -140);
    ctx.quadraticCurveTo(-30, -160, -44, -134);
    ctx.quadraticCurveTo(-24, -146, -4, -132);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paintArrow(ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette): void {
  const y = h / 2;
  ctx.strokeStyle = p.silhouette;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, y);
  ctx.lineTo(w - 8, y);
  ctx.stroke();
  ctx.fillStyle = p.silhouette;
  ctx.beginPath();
  ctx.moveTo(w, y);
  ctx.lineTo(w - 10, y - 4);
  ctx.lineTo(w - 10, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = p.accent.banner;
  ctx.fillRect(2, y - 4, 9, 3);
  ctx.fillRect(2, y + 1, 9, 3);
}

export function createCrowd(scene: Scene): CrowdRender {
  const footSpawn = new Float32Array(MAX_FOOTMEN).fill(-100);
  const footLunge = new Float32Array(MAX_FOOTMEN).fill(-100);
  const archSpawn = new Float32Array(MAX_ARCHERS).fill(-100);
  let heroLunge = -100;
  let cheer = -100;
  let shownFoot = 0;
  let shownArch = 0;
  let snap = true;
  let now = 0;
  let sprites: { hero: number; footman: number; archer: number; arrow: number } | null = null;
  let arrowSpec: ParticleSpec | null = null;
  const tmp: Vec2 = { x: 0, y: 0 };

  const ensureSprites = (p: Palette): void => {
    if (sprites) return;
    const atlas = scene.atlas;
    sprites = {
      hero: atlas.register('crowd.hero', SPRITE_W, SPRITE_H, (ctx) => paintKnight(ctx, 'hero', p)),
      footman: atlas.register('crowd.footman', SPRITE_W, SPRITE_H, (ctx) => paintKnight(ctx, 'footman', p)),
      archer: atlas.register('crowd.archer', SPRITE_W, SPRITE_H, (ctx) => paintKnight(ctx, 'archer', p)),
      arrow: atlas.register('crowd.arrow', 64, 10, (ctx, w, h) => paintArrow(ctx, w, h, p)),
    };
    arrowSpec = particleSpec({ sprite: sprites.arrow, align: true, life: 1, lifeVar: 0, size: 0.85, sizeEnd: 0.85, sizeVar: 0.05, curve: CURVE_HOLD, speedVar: 0, spread: 0 });
  };

  const footX = (i: number): number => HERO_X - 1.15 - Math.floor(i / ROWS) * COL_W - (i % ROWS) * 0.21;
  const rowY = (i: number): number => (i % ROWS) * 0.09;
  const archBase = (): number => footX(Math.max(0, shownFoot - 1)) - 1.4;
  const archX = (i: number): number => archBase() - Math.floor(i / ROWS) * COL_W * 0.9 - (i % ROWS) * 0.2;

  const game = scene.game;
  game.on('strike', () => (heroLunge = now));
  game.on('resync', () => (snap = true));
  game.on('dragonDeath', () => (cheer = now));
  game.on('armyHit', (e) => {
    if (e.unit !== 'footman') return;
    const n = Math.min(e.hits, shownFoot);
    for (let i = 0; i < n; i++) footLunge[i] = now + hash2f(i, Math.floor(now * 10)) * 0.12;
  });
  game.on('volley', (e) => {
    if (!arrowSpec || shownArch === 0) return;
    const ps = scene.particles.world;
    const g = 22;
    const T = e.flight;
    for (let j = 0; j < e.arrows; j++) {
      const a = j % shownArch;
      const sx = archX(a) + 0.35;
      const sy = rowY(a) - 1.45;
      scene.dragon.impactPoint(tmp);
      const vx = (tmp.x - sx) / T;
      const vy = (tmp.y - sy) / T - 0.5 * g * T;
      const i = ps.spawn(arrowSpec, sx, sy, vx, vy);
      ps.life[i] = T;
      ps.grav[i] = g;
    }
  });

  const view: CrowdView = {
    heroPoint(out) {
      out.x = HERO_X + 0.1;
      out.y = -1.15;
      return out;
    },
    frontX() {
      return HERO_X + 0.55;
    },
    bounds(out: Rect) {
      const left = shownArch > 0 ? archX(shownArch - 1) - 0.5 : shownFoot > 0 ? footX(shownFoot - 1) - 0.5 : HERO_X - 0.6;
      out.x = left;
      out.y = -KNIGHT_HEIGHT - 0.3;
      out.w = HERO_X + 0.55 - left;
      out.h = KNIGHT_HEIGHT + 0.5;
      return out;
    },
  };

  const drawKnight = (ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, scale: number): void => {
    // Sprite: figure FIG_H px tall standing on the canvas bottom edge; 1.8 m in world units.
    const h = (KNIGHT_HEIGHT * scale * SPRITE_H) / FIG_H;
    const w = (h * SPRITE_W) / SPRITE_H;
    ctx.drawImage(img, x - w * 0.45, y - h, w, h);
  };

  const layer: Layer = {
    name: 'crowd',
    visible: true,
    update(v: View) {
      ensureSprites(v.palette);
      now = v.time;
      const s = v.state;
      const nf = Math.min(MAX_FOOTMEN, s.units.footman);
      const na = Math.min(MAX_ARCHERS, s.units.archer);
      if (snap) {
        footSpawn.fill(-100);
        archSpawn.fill(-100);
        snap = false;
      } else {
        for (let i = shownFoot; i < nf; i++) footSpawn[i] = now + (i - shownFoot) * 0.06;
        for (let i = shownArch; i < na; i++) archSpawn[i] = now + (i - shownArch) * 0.06;
      }
      shownFoot = nf;
      shownArch = na;
    },
    draw(ctx: CanvasRenderingContext2D, v: View) {
      if (!sprites) return;
      const atlas = scene.atlas;
      const t = v.time;
      v.camera.apply(ctx);
      const cheerK = t - cheer < 0.9 ? t - cheer : -1;

      // Archers (furthest back), then footmen, back row first, then the hero in front.
      const archImg = atlas.canvases[sprites.archer]!;
      for (let r = 0; r < ROWS; r++) {
        for (let i = r; i < shownArch; i += ROWS) {
          const march = Math.min(1, Math.max(0, (t - archSpawn[i]!) / 0.9));
          const x = archX(i) - 5 * (1 - outCubic(march));
          let y = rowY(i) - 0.03 * Math.abs(Math.sin(t * 2.2 + i * 1.7));
          if (march < 1) y -= 0.06 * Math.abs(Math.sin(t * 14 + i));
          if (cheerK >= 0) y -= 0.3 * pulse(Math.min(1, cheerK / 0.45 + hash2f(i, 3) * 0.3));
          drawKnight(ctx, archImg, x, y, 0.97 + 0.06 * hash2f(i, 1));
        }
      }
      const footImg = atlas.canvases[sprites.footman]!;
      for (let r = 0; r < ROWS; r++) {
        for (let i = r; i < shownFoot; i += ROWS) {
          const march = Math.min(1, Math.max(0, (t - footSpawn[i]!) / 0.9));
          let x = footX(i) - 5 * (1 - outCubic(march));
          let y = rowY(i) - 0.03 * Math.abs(Math.sin(t * 2.5 + i * 1.3));
          if (march < 1) y -= 0.06 * Math.abs(Math.sin(t * 14 + i));
          const lk = (t - footLunge[i]!) / 0.28;
          if (lk >= 0 && lk < 1) x += 0.45 * pulse(lk);
          if (cheerK >= 0) y -= 0.3 * pulse(Math.min(1, cheerK / 0.45 + hash2f(i, 2) * 0.3));
          drawKnight(ctx, footImg, x, y, 0.96 + 0.08 * hash2f(i, 0));
        }
      }
      const hk = (t - heroLunge) / 0.22;
      const hx = HERO_X + (hk >= 0 && hk < 1 ? 0.5 * pulse(hk) : 0);
      const hy = cheerK >= 0 ? -0.35 * pulse(Math.min(1, cheerK / 0.5)) : 0;
      drawKnight(ctx, atlas.canvases[sprites.hero]!, hx, hy, 1.04);
    },
  };

  return { layer, view };
}
