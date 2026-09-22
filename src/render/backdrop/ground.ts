// The battlefield ground (depth 1, the stage plane at y = 0): a dark meadow mass below a grassy
// fringe whose backlit tips catch the sun. The fringe is a seamless tile baked at a chain of
// resolutions (a hand-made mip chain, each level drawn as vectors so it stays crisp) and tiled
// along the ground line through the world transform; the wind shears it.
import type { Palette } from '../palette';
import type { View } from '../types';
import type { Rect } from '../../lib/vec';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Rng } from '../../lib/rng';
import { TAU } from '../../lib/math';
import { toneColor } from './ridges';

/** Tile width (m), fringe height above and below the ground line (m). */
const TILE_W = 6;
const TOP = 0.52;
const BELOW = 0.08;
const LEVELS = 6;
const SAFE = 80;
/** Tuft tiles extend this far below their row line (tufts are scattered in depth). */
const TUFT_BELOW = 0.36;

interface Blade {
  x: number;
  /** Base y (m below the line). */
  y: number;
  h: number;
  w: number;
  lean: number;
  kind: number; // 0 blade, 1 seed stalk, 2 flower
}

function makeBlades(): Blade[] {
  const rng = new Rng(0x9a55);
  const out: Blade[] = [];
  const ph1 = rng.range(0, TAU);
  const ph2 = rng.range(0, TAU);
  // Periodic clumping so the tile is seamless.
  const clump = (x: number): number => 0.5 + 0.3 * Math.sin((TAU * 3 * x) / TILE_W + ph1) + 0.2 * Math.sin((TAU * 8 * x) / TILE_W + ph2);
  for (let i = 0; i < 520; i++) {
    const x = rng.float() * TILE_W;
    const c = clump(x);
    const r = rng.float();
    out.push({ x, y: 0, h: 0.035 + 0.2 * c * (0.35 + 0.65 * r * r), w: rng.range(0.008, 0.02), lean: rng.range(-0.25, 0.4), kind: 0 });
  }
  for (let i = 0; i < 22; i++) {
    const x = rng.float() * TILE_W;
    out.push({ x, y: 0, h: rng.range(0.24, 0.44), w: 0.005, lean: rng.range(-0.05, 0.3), kind: rng.float() < 0.55 ? 1 : 2 });
  }
  return out;
}

const BLADES = makeBlades();

/** Sparse tufts for the rows of meadow receding below the ground line. */
function makeTufts(): Blade[] {
  const rng = new Rng(0x7f7f);
  const out: Blade[] = [];
  for (let c = 0; c < 26; c++) {
    const cx = rng.float() * TILE_W;
    const n = 5 + rng.int(10);
    const hh = rng.range(0.08, 0.26);
    // Scatter tufts in depth within the row so rows read as bands, not lines.
    const dy = rng.range(0, TUFT_BELOW - 0.1);
    for (let i = 0; i < n; i++) {
      const x = cx + rng.range(-0.09, 0.09);
      out.push({ x: (x + TILE_W) % TILE_W, y: dy, h: hh * rng.range(0.4, 1), w: rng.range(0.01, 0.02), lean: rng.range(-0.35, 0.5) + (x - cx) * 3, kind: 0 });
    }
    if (rng.float() < 0.35) out.push({ x: cx, y: dy, h: hh * 1.6, w: 0.005, lean: rng.range(0, 0.3), kind: rng.float() < 0.5 ? 1 : 2 });
  }
  return out;
}

const TUFTS = makeTufts();

/** Rows of tufts below the line: screen depth (fraction of the ground band), scale, pan factor. */
const ROWS = [
  [0.1, 1.05, 1.08, 1.7],
  [0.26, 1.2, 1.2, 3.1],
  [0.48, 1.45, 1.38, 0.6],
  [0.78, 1.8, 1.62, 4.4],
] as const;

function addBlade(path: Path2D, b: Blade, ox: number): void {
  const x = b.x + ox;
  const y = b.y;
  const tipX = x + b.lean * b.h;
  const tipY = y - b.h;
  path.moveTo(x - b.w * 0.5, y + 0.04);
  path.quadraticCurveTo(x - b.w * 0.3 + b.lean * b.h * 0.15, y - b.h * 0.55, tipX, tipY);
  path.quadraticCurveTo(x + b.w * 0.3 + b.lean * b.h * 0.15, y - b.h * 0.5, x + b.w * 0.5, y + 0.04);
  path.closePath();
  if (b.kind === 1) {
    // Drooping seed head: a few grains along the tip.
    for (let k = 0; k < 4; k++) {
      const gx = tipX + 0.008 * k;
      const gy = tipY + 0.014 * k;
      path.moveTo(gx + 0.007, gy);
      path.ellipse(gx, gy, 0.007, 0.016, 0.5, 0, TAU);
    }
  } else if (b.kind === 2) {
    path.moveTo(tipX + 0.018, tipY);
    path.arc(tipX, tipY, 0.018, 0, TAU);
  }
}

function bakeTile(blades: readonly Blade[], below: number, k: number, dpr: number, color: string, rim: string, rimA: number): HTMLCanvasElement {
  const strip = below === BELOW;
  const c = makeCanvas(TILE_W * k, (TOP + below) * k);
  const ctx = context2d(c);
  ctx.setTransform(k, 0, 0, k, 0, TOP * k);
  const path = new Path2D();
  if (strip) path.rect(-0.1, 0, TILE_W + 0.2, BELOW + 0.1);
  for (const b of blades) {
    addBlade(path, b, 0);
    if (b.x < 0.3) addBlade(path, b, TILE_W);
    if (b.x > TILE_W - 0.3) addBlade(path, b, -TILE_W);
  }
  // Rim along the top edges (backlit tips): lit shape minus itself shifted down.
  const px = dpr / k; // 1 CSS px in meters at this level
  const d1 = Math.max(1.3 * px, 0.6 / k);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = rgba(rim, rimA);
  ctx.fill(path);
  ctx.translate(0, d1);
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.fillStyle = rgba(rim, rimA * 0.22);
  ctx.fill(path);
  ctx.translate(0, d1 * 2.5);
  ctx.fillStyle = color;
  ctx.fill(path);
  return c;
}

export class Ground {
  private tiles: HTMLCanvasElement[] = [];
  private tuftTiles: HTMLCanvasElement[] = [];
  private levelK: number[] = [];
  private fill: HTMLCanvasElement | null = null;
  private palette: Palette | null = null;
  private baseK = 0;
  private readonly tmp = { x: 0, y: 0 };

  /** (Re)bake for a palette and the reference device px/m. */
  bake(pal: Palette, refZoom: number, dpr: number): void {
    const k0 = refZoom * dpr * 1.15;
    if (this.palette === pal && Math.abs(k0 - this.baseK) < 1e-6) return;
    this.palette = pal;
    this.baseK = k0;
    const top = toneColor(pal, 0.93);
    const rim = mixHex(pal.rim, '#ffffff', 0.1);
    this.tiles = [];
    this.tuftTiles = [];
    this.levelK = [];
    for (let l = 0; l < LEVELS; l++) {
      const k = k0 / Math.pow(2, l);
      this.tiles.push(bakeTile(BLADES, BELOW, k, dpr, top, rim, 0.95));
      this.tuftTiles.push(bakeTile(TUFTS, TUFT_BELOW, k, dpr, pal.silhouette, rim, 0.6));
      this.levelK.push(k);
    }
    // Vertical fill below the fringe: a sunlit meadow edge sinking into dark.
    const f = makeCanvas(2, 256);
    const fc = context2d(f);
    const g = fc.createLinearGradient(0, 0, 0, 256);
    // A sunlit band just below the line (the meadow floor receding toward the light), then dark.
    const lit = toneColor(pal, 0.8);
    g.addColorStop(0, top);
    g.addColorStop(0.035, lit);
    g.addColorStop(0.2, mixHex(lit, top, 0.6));
    g.addColorStop(0.55, mixHex(top, pal.silhouette, 0.45));
    g.addColorStop(1, toneColor(pal, 0.95));
    fc.fillStyle = g;
    fc.fillRect(0, 0, 2, 256);
    this.fill = f;
  }

  /**
   * Draw the ground for this view: fill from the line to the bottom of `vis` (world rect of the
   * viewport incl. margin) and tile the fringe, sheared by `shear` (tip x offset per m of height).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    view: View,
    vis: Rect,
    shear: number,
    sunX: number,
    sunGlow: HTMLCanvasElement,
  ): void {
    if (!this.fill) return;
    const cam = view.camera;
    const tile = this.tiles[this.level(cam.zoomEff * view.dpr)]!;
    ctx.save();
    cam.apply(ctx);
    const bottom = vis.y + vis.h;
    if (bottom > 0) ctx.drawImage(this.fill, vis.x, BELOW * 0.4, vis.w, bottom);
    ctx.restore();

    // Sheen: the meadow floor catching the sun below it.
    const gy = cam.worldToScreen(cam.x, 0, this.tmp).y;
    const H = view.height;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(sunGlow, sunX - H * 0.75, gy - H * 0.035, H * 1.5, H * 0.2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    cam.apply(ctx);
    ctx.transform(1, 0, -shear, 1, 0, 0);
    const i0 = Math.floor((vis.x - TOP) / TILE_W);
    const i1 = Math.floor((vis.x + vis.w + TOP) / TILE_W);
    // Overlap neighbours by ~1 px so antialiased tile edges never show a seam.
    const tw = TILE_W + 1 / cam.zoomEff;
    for (let i = i0; i <= i1; i++) ctx.drawImage(tile, i * TILE_W, -TOP, tw, TOP + BELOW);
    ctx.restore();

    // Receding rows of tufts between the line and the bottom edge: nearer rows are lower, bigger
    // and pan faster, so the floor reads as a plane stretching toward the valley.
    const band = H - gy;
    if (band <= 4) return;
    for (let r = 0; r < ROWS.length; r++) {
      const row = ROWS[r]!;
      const y = gy + band * row[0];
      const z = cam.zoomEff * row[1];
      const panX = cam.refX + (cam.x - cam.refX) * row[2] + row[3];
      const t = this.tuftTiles[this.level(z * view.dpr)]!;
      const x0 = panX + (-SAFE - cam.stageCX) / z;
      const x1 = panX + (view.width + SAFE - cam.stageCX) / z;
      ctx.save();
      ctx.translate(cam.stageCX + cam.shakeX * row[2], y + cam.shakeY * row[2]);
      ctx.scale(z, z);
      ctx.transform(1, 0, -shear * 1.2, 1, 0, 0);
      ctx.translate(-panX, 0);
      const twr = TILE_W + 1 / z;
      for (let i = Math.floor((x0 - TOP) / TILE_W); i <= Math.floor((x1 + TOP) / TILE_W); i++) {
        ctx.drawImage(t, i * TILE_W, -TOP, twr, TOP + TUFT_BELOW);
      }
      ctx.restore();
    }
  }

  private level(need: number): number {
    let l = 0;
    while (l < LEVELS - 1 && this.levelK[l + 1]! >= need) l++;
    return l;
  }
}
