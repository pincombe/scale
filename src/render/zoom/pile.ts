// STAND-IN until the crowd implements rally/setFused (WP 2.9): the fused pile. The whole army heaped
// on the hero's spot as one mound of rim-lit knights (the crowd's own rig, arms flung up), with
// light leaking between the bodies, then rising in a column as the pile lifts, just before the
// flash. Baked once per zoom at the flash framing's resolution; drawn in the old tier's meters.
// With the real crowd pile the zoom keeps the light (glow, column) and drops the heap.
import { Joints, Pose, drawFigure, solve, type FigureKind } from '../crowd/rig';
import type { Palette } from '../palette';
import { context2d, makeCanvas } from '../atlas';
import { mixHex } from '../../lib/color';
import { Rng } from '../../lib/rng';
import { KNIGHT_HEIGHT } from '../world';

/** The heap's extent in meters (half-width at the base, height) for n knights. */
function heapSize(n: number): { w: number; h: number } {
  const k = Math.sqrt(Math.max(4, Math.min(160, n)));
  return { w: 1.4 + k * 0.62, h: 1.5 + k * 0.42 };
}

export class Pile {
  canvas: HTMLCanvasElement | null = null;
  /** Meters: the heap's half-width and height (the canvas spans [-w, w] x [-h, 0.2]). */
  w = 1;
  h = 1;
  private pxm = 1;

  /** Bake a heap of `n` knights at `pxm` device px per meter. */
  bake(n: number, pxm: number, p: Palette): void {
    const size = heapSize(n);
    this.w = size.w;
    this.h = size.h;
    const k = Math.min(pxm, 1600 / (2 * size.w + 1));
    this.pxm = k;
    const W = Math.ceil((2 * this.w + 0.6) * k);
    const H = Math.ceil((this.h + 1.4) * k);
    if (!this.canvas || this.canvas.width !== W || this.canvas.height !== H) {
      this.release();
      this.canvas = makeCanvas(W, H);
    }
    const g = context2d(this.canvas);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const rng = new Rng(0x9d1e + n);
    const pose = new Pose();
    const j = new Joints();
    const count = Math.max(10, Math.min(60, Math.round(10 + Math.sqrt(n) * 4.5)));
    const unit = KNIGHT_HEIGHT / 100;
    const mid = mixHex(p.rim, p.silhouette, 0.58);
    // Back to front: the top of the heap first (smaller, further), the base last.
    const place = new Float64Array(count * 4);
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      const row = 1 - u;
      const yy = -row * (this.h - 1.5);
      const half = this.w * (0.25 + 0.75 * u) * (1 - row * 0.35);
      place[i * 4] = rng.range(-half, half);
      place[i * 4 + 1] = yy + rng.range(-0.25, 0.2);
      place[i * 4 + 2] = rng.range(-0.75, 0.75) * (0.4 + row);
      place[i * 4 + 3] = 0.85 + 0.25 * rng.float();
    }
    const kinds: FigureKind[] = ['foot', 'foot', 'bearer', 'archer'];
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < count; i++) {
        const x = place[i * 4]!;
        const y = place[i * 4 + 1]!;
        const rot = place[i * 4 + 2]!;
        const sc = place[i * 4 + 3]!;
        const r2 = new Rng(0x51 + i * 7);
        pose.hipX = r2.range(-3, 3);
        pose.hipY = -46 + r2.range(-6, 3);
        pose.lean = r2.range(-0.4, 0.4);
        pose.head = r2.range(-0.5, 0.2);
        pose.aFootX = r2.range(2, 16);
        pose.bFootX = r2.range(-16, -2);
        pose.aFootY = r2.range(-8, 0);
        pose.bFootY = r2.range(-8, 0);
        // Arms flung up: the army reaching for the sky as it fuses.
        pose.nHandX = r2.range(-6, 16);
        pose.nHandY = -95 + r2.range(-10, 20);
        pose.fHandX = r2.range(-4, 12);
        pose.fHandY = -110 + r2.range(-6, 18);
        pose.weapon = -1.57 + r2.range(-0.6, 0.6);
        pose.shield = r2.range(-0.5, 0.5);
        pose.pole = -1.57 + r2.range(-0.3, 0.3);
        pose.bow = r2.range(-0.6, 0.3);
        solve(pose, j);
        const kind = kinds[i % kinds.length]!;
        const s = unit * sc * k;
        const off = pass === 0 ? 0 : pass === 1 ? 0.55 : 1.15;
        const cs = Math.cos(rot);
        const sn = Math.sin(rot);
        const ox = (x + this.w + 0.3) * k - p.light.x * off * 1.6;
        const oy = (y + this.h + 1.2) * k - p.light.y * off * 1.6;
        g.setTransform(cs * s, sn * s, -sn * s, cs * s, ox, oy);
        const color = pass === 0 ? p.rim : pass === 1 ? mid : p.silhouette;
        g.fillStyle = color;
        g.strokeStyle = color;
        drawFigure(g, kind, pose, j, 1.25 / Math.max(0.1, s));
      }
    }
  }

  release(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
  }

  bytes(): number {
    return this.canvas ? this.canvas.width * this.canvas.height * 4 : 0;
  }

  /**
   * Draw the heap standing at world (x, y) through the device transform [A C E; B D F] (world m ->
   * device px). `grow` 0..1 gathers it (it swells up from the ground), `lift` 0..1 stretches it up
   * as it rises into the colossus.
   */
  draw(ctx: CanvasRenderingContext2D, A: number, B: number, C: number, D: number, E: number, F: number, x: number, y: number, grow: number, lift: number, alpha: number): void {
    const c = this.canvas;
    if (!c || alpha <= 0.002 || grow <= 0.002) return;
    const k = this.pxm;
    const sx = (0.55 + 0.45 * grow) * (1 - 0.18 * lift);
    const sy = grow * (1 + 0.55 * lift);
    // World placement: the canvas's (w + 0.3, h + 1.2) meters is the heap's base center.
    const ex = A * x + C * y + E;
    const fy = B * x + D * y + F;
    ctx.setTransform((A * sx) / k, (B * sx) / k, (C * sy) / k, (D * sy) / k, ex, fy);
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, -(this.w + 0.3) * k, -(this.h + 1.2) * k);
    ctx.globalAlpha = 1;
  }
}
