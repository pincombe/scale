// Dragon STUB (WP 0.2). The dragon-rig WP (1.2) replaces this folder with the procedural rig.
//
// Contract kept by any replacement: createDragon(scene) returns { layer, view }: a Layer named
// 'dragon' (slot 1) and a DragonView (./api.ts) that input, fx, crowd and the director use.
// The dragon's rest-pose front sits at world x = CLASH_X on the ground (y = 0), facing left,
// body length = state.dragon.size meters.
//
// This stub: static Path2D parts (body, head, tail) in body-length units, animated only through
// transforms (no per-frame allocation); rim light = the silhouette filled once offset toward the
// light in the rim color, then again in the silhouette color.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { DragonView } from './api';
import type { Rect, Vec2 } from '../../lib/vec';
import { CLASH_X } from '../world';
import { TICK_DT } from '../../core/formulas';
import { clamp01 } from '../../lib/math';
import { inOutSine, outCubic, pulse, inQuad } from '../../lib/ease';
import { CURVE_FADE, CURVE_PULSE, particleSpec } from '../particles';

export interface DragonRender {
  layer: Layer;
  view: DragonView;
}

// ---- shape, in body-length units; origin = rest-pose front at ground level; facing -x ----
const BODY = { cx: 0.5, cy: -0.25, rx: 0.27, ry: 0.13 };
const HEAD_PIVOT = { x: 0.24, y: -0.33 };
const TAIL_PIVOT = { x: 0.74, y: -0.27 };
const WEAK = { x: 0.27, y: -0.22, r: 0.05 };
const MOUTH = { x: -0.22, y: -0.03 }; // relative to the head pivot

function bodyPath(): Path2D {
  const p = new Path2D();
  p.ellipse(BODY.cx, BODY.cy, BODY.rx, BODY.ry, 0, 0, Math.PI * 2);
  // Neck.
  p.moveTo(0.3, -0.33);
  p.quadraticCurveTo(0.25, -0.37, 0.2, -0.38);
  p.lineTo(0.2, -0.28);
  p.quadraticCurveTo(0.27, -0.25, 0.33, -0.2);
  p.closePath();
  // Legs (front pair, back pair), with splayed feet.
  const leg = (x: number, lean: number): void => {
    p.moveTo(x - 0.04, -0.2);
    p.lineTo(x + 0.04, -0.2);
    p.lineTo(x + 0.03 + lean, -0.02);
    p.lineTo(x + 0.07 + lean, 0);
    p.lineTo(x - 0.06 + lean, 0);
    p.lineTo(x - 0.03 + lean, -0.03);
    p.closePath();
  };
  leg(0.34, -0.02);
  leg(0.66, 0.02);
  // Dorsal spikes.
  for (let i = 0; i < 7; i++) {
    const u = 0.3 + i * 0.065;
    const t = (u - BODY.cx) / BODY.rx;
    const top = BODY.cy - BODY.ry * Math.sqrt(Math.max(0, 1 - t * t));
    const h = 0.045 + 0.02 * Math.sin(i * 1.7);
    p.moveTo(u - 0.028, top + 0.012);
    p.lineTo(u + 0.012, top - h);
    p.lineTo(u + 0.03, top + 0.014);
    p.closePath();
  }
  // Folded wing.
  p.moveTo(0.4, -0.33);
  p.quadraticCurveTo(0.52, -0.56, 0.62, -0.5);
  p.quadraticCurveTo(0.6, -0.42, 0.68, -0.34);
  p.quadraticCurveTo(0.55, -0.37, 0.4, -0.33);
  p.closePath();
  return p;
}

function headPath(): Path2D {
  // Relative to HEAD_PIVOT; the snout points to -x.
  const p = new Path2D();
  p.ellipse(-0.12, -0.04, 0.1, 0.066, -0.08, 0, Math.PI * 2);
  p.moveTo(-0.18, -0.07);
  p.quadraticCurveTo(-0.24, -0.05, -0.245, -0.02);
  p.lineTo(-0.15, 0.015);
  p.closePath();
  // Horns sweeping back.
  p.moveTo(-0.1, -0.09);
  p.quadraticCurveTo(-0.02, -0.15, 0.04, -0.17);
  p.quadraticCurveTo(-0.02, -0.12, -0.05, -0.07);
  p.closePath();
  p.moveTo(-0.06, -0.085);
  p.quadraticCurveTo(0.02, -0.12, 0.07, -0.12);
  p.quadraticCurveTo(0.02, -0.09, -0.02, -0.06);
  p.closePath();
  return p;
}

function tailPath(): Path2D {
  // Relative to TAIL_PIVOT; tapers out to +x and curls up into a spade.
  const p = new Path2D();
  p.moveTo(-0.03, -0.07);
  p.quadraticCurveTo(0.14, -0.05, 0.25, 0.08);
  p.quadraticCurveTo(0.29, 0.12, 0.33, 0.1);
  p.lineTo(0.37, 0.06);
  p.lineTo(0.36, 0.13);
  p.lineTo(0.31, 0.15);
  p.quadraticCurveTo(0.2, 0.14, 0.1, 0.07);
  p.quadraticCurveTo(0.03, 0.03, -0.03, 0.06);
  p.closePath();
  return p;
}

export function createDragon(scene: Scene): DragonRender {
  const body = bodyPath();
  const head = headPath();
  const tail = tailPath();

  // Pose (recomputed in update, read by draw and the view). Units: world m / radians.
  const pose = { ox: CLASH_X, oy: 0, L: 0.5, rot: 0, puff: 0, headRot: 0, tailRot: 0, alpha: 1, glow: 1, weakOn: true };
  let curId = -1;
  let flinch = 0;
  let flinchV = 0;
  let fireAcc = 0;
  let emberAcc = 0;
  let hot = 0; // hit flash 0..1
  const tmp: Vec2 = { x: 0, y: 0 };

  let fireSpec: ReturnType<typeof particleSpec> | null = null;
  let emberSpec: ReturnType<typeof particleSpec> | null = null;
  let weakSprite = -1;
  let eyeSprite = -1;

  const ensureSprites = (): void => {
    if (fireSpec) return;
    const { atlas, sprites, palette } = scene;
    const fire = atlas.ramp(sprites.glow, ['#ffffff', '#fff2b0', palette.accent.fire, palette.accent.ember, '#5a1a08'], 8, 0.6);
    fireSpec = particleSpec({ sprite: fire, ramp: 8, additive: true, life: 0.55, lifeVar: 0.3, speed: 3.2, speedVar: 0.35, spread: 0.22, size: 0.1, sizeEnd: 0.42, sizeVar: 0.35, drag: 1.5, gravity: -0.6, curve: CURVE_FADE, alpha: 0.9 });
    emberSpec = particleSpec({ sprite: atlas.tint(sprites.ember, palette.accent.ember, 0.5), additive: true, life: 1.3, lifeVar: 0.4, speed: 0.4, speedVar: 0.6, angle: -Math.PI / 2, spread: 0.9, size: 0.035, sizeEnd: 0.01, radius: 0.2, gravity: -0.5, drag: 0.6, curve: CURVE_PULSE });
    weakSprite = atlas.tint(sprites.glow, palette.accent.weak, 0.8);
    eyeSprite = atlas.tint(sprites.ember, palette.accent.fire, 0.9);
  };

  // Hit reactions: recoil away from the army (+x), brighter rim for a moment.
  scene.game.on('strike', (e) => {
    flinchV += e.crit ? 0.9 : 0.45;
    hot = Math.max(hot, e.crit ? 1 : 0.55);
  });
  scene.game.on('armyHit', () => {
    flinchV += 0.2;
    hot = Math.max(hot, 0.3);
  });

  /** World -> body units (inverse pose). */
  const toLocal = (wx: number, wy: number, out: Vec2): Vec2 => {
    const L = pose.L;
    let u = (wx - (pose.ox + flinch * L)) / L;
    let v = (wy - pose.oy) / L;
    // Undo the rotation about the body center.
    const du = u - BODY.cx;
    const dv = v - BODY.cy;
    const c = Math.cos(-pose.rot);
    const s = Math.sin(-pose.rot);
    u = BODY.cx + du * c - dv * s;
    v = BODY.cy + du * s + dv * c;
    out.x = u;
    out.y = v;
    return out;
  };

  /** Body units -> world (forward pose). */
  const toWorld = (u: number, v: number, out: Vec2): Vec2 => {
    const L = pose.L;
    const du = u - BODY.cx;
    const dv = v - BODY.cy;
    const c = Math.cos(pose.rot);
    const s = Math.sin(pose.rot);
    out.x = pose.ox + flinch * L + (BODY.cx + du * c - dv * s) * L;
    out.y = pose.oy + (BODY.cy + du * s + dv * c) * L;
    return out;
  };

  const headLocal = (hx: number, hy: number, out: Vec2): Vec2 => {
    const c = Math.cos(pose.headRot);
    const s = Math.sin(pose.headRot);
    out.x = HEAD_PIVOT.x + hx * c - hy * s;
    out.y = HEAD_PIVOT.y + hx * s + hy * c;
    return out;
  };

  const view: DragonView = {
    hitTest(wx, wy) {
      const p = toLocal(wx, wy, tmp);
      const pxPerUnit = scene.camera.zoomEff * pose.L;
      if (pose.weakOn) {
        const r = Math.max(WEAK.r * 1.5, 16 / pxPerUnit);
        const dx = p.x - WEAK.x;
        const dy = p.y - WEAK.y;
        if (dx * dx + dy * dy <= r * r) return 'weak';
      }
      const pad = 10 / pxPerUnit;
      const ex = (p.x - BODY.cx) / (BODY.rx * (1 + pose.puff) + pad);
      const ey = (p.y - BODY.cy) / (BODY.ry * (1 + pose.puff) + pad);
      if (ex * ex + ey * ey <= 1) return 'body';
      // Head, neck, tail and legs: generous boxes.
      if (p.x >= -0.05 - pad && p.x <= 0.3 && p.y >= -0.5 - pad && p.y <= -0.25 + pad) return 'body';
      if (p.x >= 0.7 && p.x <= 1.12 + pad && p.y >= -0.36 - pad && p.y <= -0.1 + pad) return 'body';
      if (p.x >= 0.25 && p.x <= 0.75 && p.y >= -0.2 && p.y <= pad) return 'body';
      return null;
    },
    impactPoint(out) {
      // Uniform point in an inner ellipse of the body.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.8;
      return toWorld(BODY.cx + Math.cos(a) * r * BODY.rx, BODY.cy + Math.sin(a) * r * BODY.ry, out);
    },
    weakSpot(out) {
      if (!pose.weakOn) return null;
      return toWorld(WEAK.x, WEAK.y, out);
    },
    headPoint(out) {
      const h = headLocal(MOUTH.x, MOUTH.y, out);
      return toWorld(h.x, h.y, out);
    },
    bounds(out: Rect) {
      const L = scene.game.state.dragon.size;
      out.x = CLASH_X - 0.02 * L;
      out.y = -0.6 * L;
      out.w = 1.14 * L;
      out.h = 0.6 * L;
      return out;
    },
  };

  const layer: Layer = {
    name: 'dragon',
    visible: true,
    update(v: View) {
      ensureSprites();
      const d = v.state.dragon;
      if (d.id !== curId) {
        curId = d.id;
        flinch = flinchV = 0;
        hot = 0;
      }
      const L = d.size;
      const t = Math.min(d.phaseT + v.alpha * TICK_DT, d.phaseDur);
      const k = d.phaseDur > 0 ? clamp01(t / d.phaseDur) : 1;
      const time = v.time;
      pose.L = L;
      pose.ox = CLASH_X;
      pose.oy = 0;
      pose.rot = 0;
      pose.puff = 0.02 * Math.sin(time * 2.4);
      pose.headRot = 0.05 * Math.sin(time * 1.3);
      pose.tailRot = 0.12 * Math.sin(time * 1.9);
      pose.alpha = 1;
      pose.glow = 0.75 + 0.25 * Math.sin(time * 5);
      pose.weakOn = true;

      switch (d.phase) {
        case 'enter':
          pose.ox += L * 1.8 * (1 - outCubic(k));
          pose.oy = -Math.abs(Math.sin(time * 16)) * 0.03 * L * (1 - k);
          pose.weakOn = k > 0.6;
          break;
        case 'windup': {
          const w = inOutSine(k);
          pose.puff += 0.14 * w;
          pose.headRot += (d.attack === 'breath' ? 0.35 : 0.1) * outCubic(k);
          pose.tailRot += d.attack === 'swipe' ? -0.6 * w : 0;
          pose.glow = 1 + 1.8 * w * (0.8 + 0.2 * Math.sin(time * 30));
          break;
        }
        case 'breath':
          pose.puff += 0.14 * (1 - k);
          pose.headRot -= 0.18 * pulse(Math.min(1, k * 1.3));
          pose.glow = 1.3;
          break;
        case 'swipe':
          pose.rot = -0.12 * pulse(k);
          pose.tailRot += 1.1 * pulse(k) - 0.6 * (1 - k) * (1 - k);
          break;
        case 'stagger':
          pose.rot = 0.09 * Math.sin(t * 17) * (1 - k);
          pose.headRot -= 0.25 * (1 - k);
          pose.glow = 0.5;
          break;
        case 'dying':
          pose.rot = 0.45 * outCubic(k);
          pose.oy = 0.22 * L * inQuad(k);
          pose.headRot -= 0.5 * outCubic(k);
          pose.alpha = 1 - inQuad(clamp01((k - 0.35) / 0.65));
          pose.weakOn = false;
          break;
        default:
          break;
      }

      // Flinch spring (omega 11/s, zeta 0.7), in body lengths.
      const dt = v.dt;
      if (dt > 0) {
        flinchV += (-121 * flinch - 15.4 * flinchV) * dt;
        flinch += flinchV * dt;
        hot = Math.max(0, hot - dt * 5);
      }

      // Fire from the mouth during breath; embers rising off the corpse while dying.
      const world = scene.particles.world;
      if (d.phase === 'breath' && dt > 0 && fireSpec) {
        fireAcc += dt * 90;
        const n = Math.floor(fireAcc);
        fireAcc -= n;
        if (n > 0) {
          const m = view.headPoint(tmp);
          world.burst(fireSpec, m.x, m.y, n, Math.PI + 0.25, L);
        }
      }
      if (d.phase === 'dying' && dt > 0 && emberSpec) {
        emberAcc += dt * 45 * (1 - k);
        const n = Math.floor(emberAcc);
        emberAcc -= n;
        if (n > 0) {
          view.impactPoint(tmp);
          world.burst(emberSpec, tmp.x, tmp.y, n, -Math.PI / 2, L);
        }
      }
    },
    draw(ctx: CanvasRenderingContext2D, v: View) {
      const cam = v.camera;
      const p = v.palette;
      const L = pose.L;
      if (pose.alpha <= 0.01) return;
      ctx.globalAlpha = pose.alpha;
      cam.apply(ctx);
      ctx.translate(pose.ox + flinch * L, pose.oy);
      ctx.scale(L, L);
      // Rotate about the body center.
      ctx.translate(BODY.cx, BODY.cy);
      ctx.rotate(pose.rot);
      ctx.translate(-BODY.cx, -BODY.cy);

      // Rim offset: light direction in body units (screen px / px-per-unit).
      const ppu = cam.zoomEff * L;
      const rimPx = p.rimWidth * (1 + hot * 1.5);
      const rx = (p.light.x * rimPx) / ppu;
      const ry = (p.light.y * rimPx) / ppu;

      for (let pass = 0; pass < 2; pass++) {
        const ox = pass === 0 ? rx : 0;
        const oy = pass === 0 ? ry : 0;
        ctx.fillStyle = pass === 0 ? p.rim : p.silhouette;
        // Tail.
        ctx.save();
        ctx.translate(TAIL_PIVOT.x + ox, TAIL_PIVOT.y + oy);
        ctx.rotate(pose.tailRot);
        ctx.fill(tail);
        ctx.restore();
        // Body (puffs about its center).
        ctx.save();
        ctx.translate(BODY.cx + ox, BODY.cy + oy);
        ctx.scale(1 + pose.puff, 1 + pose.puff * 1.3);
        ctx.translate(-BODY.cx, -BODY.cy);
        ctx.fill(body);
        ctx.restore();
        // Head.
        ctx.save();
        ctx.translate(HEAD_PIVOT.x + ox, HEAD_PIVOT.y + oy);
        ctx.rotate(pose.headRot);
        ctx.fill(head);
        if (pass === 1) {
          // Eye.
          ctx.globalCompositeOperation = 'lighter';
          const es = Math.max(0.035, 7 / ppu);
          ctx.drawImage(scene.atlas.canvases[eyeSprite]!, -0.13 - es / 2, -0.07 - es / 2, es, es);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
      }

      // Weak spot: a pulsing glow (never smaller than ~22 px so it stays clickable-looking).
      if (pose.weakOn) {
        ctx.globalCompositeOperation = 'lighter';
        const s = Math.max(WEAK.r * 3.2, 24 / ppu) * pose.glow;
        ctx.globalAlpha = pose.alpha * Math.min(1, 0.55 + 0.25 * pose.glow);
        ctx.drawImage(scene.atlas.canvases[weakSprite]!, WEAK.x - s / 2, WEAK.y - s / 2, s, s);
        ctx.globalCompositeOperation = 'source-over';
      }
    },
  };

  return { layer, view };
}
