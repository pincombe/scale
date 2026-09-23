// A sea of cloud filling the valleys below the range (the Mountain's big scale cue: the peaks'
// feet are lost in it, the slopes poke through it). One tileable strip per bank, baked soft at
// the layer's reference resolution (DPR 1: vapor never needs more) and scrolled slowly; tops lit
// warm by the afterglow, the body falling into violet shadow and then into the haze below.
//
// Coordinates: the bank's own layer units (x right, height up), drawn through the caller's
// parallax transform. Cheap per frame: 2-3 drawImage calls.
import type { Palette } from '../palette';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';
import { Noise } from '../../lib/noise';
import { Rng } from '../../lib/rng';
import { TAU } from '../../lib/math';

export interface CloudSeaDef {
  /** Top of the bank (layer units above the ground line), billow amplitude, depth below the top. */
  top: number;
  billow: number;
  depth: number;
  /** Tile width (layer units) and drift (units / s). */
  tile: number;
  speed: number;
  /** Lit tops 0..1 and body tone 0 (haze) .. 1 (depth tint). */
  lit: number;
  tone: number;
  /** 0..1: how opaque the vapor stays below its lit top (1 = a solid floor of cloud). */
  floor: number;
  seed: number;
}

/** Bake resolution: px per layer unit at DPR 1 for a 900 px tall view (scaled by view height). */
const PX_PER_UNIT_900 = 100;

export class CloudSea {
  canvas: HTMLCanvasElement | null = null;
  private palette: Palette | null = null;
  private k = 0;
  /** Canvas covers heights [top + pad, top - depth] (units). */
  private y0 = 0;
  private y1 = 0;

  constructor(readonly def: CloudSeaDef) {}

  /** Bake for a palette and view height (no-op when current). */
  ensure(pal: Palette, viewH: number): void {
    const k = Math.max(40, Math.min(160, (PX_PER_UNIT_900 * viewH) / 900));
    if (this.canvas && this.palette === pal && Math.abs(k - this.k) < this.k * 0.25) return;
    this.bake(pal, k);
  }

  ready(pal: Palette): boolean {
    return this.canvas !== null && this.palette === pal;
  }

  free(): void {
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.palette = null;
  }

  bytes(): number {
    return this.canvas ? this.canvas.width * this.canvas.height * 4 : 0;
  }

  private bake(pal: Palette, k: number): void {
    const d = this.def;
    const pad = d.billow * 2.6 + 0.12;
    this.y0 = -(d.top + pad);
    this.y1 = -(d.top - d.depth);
    const w = Math.ceil(d.tile * k);
    const h = Math.ceil((this.y1 - this.y0) * k);
    const c = this.canvas ?? makeCanvas(1, 1);
    c.width = w;
    c.height = h;
    const ctx = context2d(c);
    ctx.setTransform(k, 0, 0, k, 0, -this.y0 * k);
    this.k = k;
    this.palette = pal;
    this.canvas = c;

    const n = new Noise(d.seed);
    const rng = new Rng(d.seed * 131);
    // Periodic billows along the top: lobes on a periodic noise envelope, repeated at +-tile.
    const period = (x: number, f: number, s: number): number => n.simplex2(Math.cos((x / d.tile) * TAU) * f, Math.sin((x / d.tile) * TAU) * f + s);
    const topAt = (x: number): number => d.top + d.billow * (0.6 * period(x, 1.3, 3.1) + 0.4 * period(x, 3.1, 7.7));
    const path = new Path2D();
    const step = 0.04;
    path.moveTo(-0.5, -(d.top - d.depth - 0.2));
    for (let x = -0.5; x <= d.tile + 0.5; x += step) path.lineTo(x, -topAt(x));
    path.lineTo(d.tile + 0.5, -(d.top - d.depth - 0.2));
    path.closePath();
    // Billow lobes along the top, so the edge is round puffs, not a line.
    const lobes = Math.round(d.tile / (d.billow * 1.5 + 0.08));
    for (let i = 0; i < lobes; i++) {
      const x = ((i + rng.float() * 0.8) / lobes) * d.tile;
      const r = (d.billow * (0.5 + 0.9 * rng.float()) + 0.04) * (0.6 + 0.6 * Math.max(0, period(x, 2.2, 1.4)));
      const y = -topAt(x) + r * 0.55;
      for (const o of [-d.tile, 0, d.tile]) {
        path.moveTo(x + o + r * 1.9, y);
        path.ellipse(x + o, y, r * 1.9, r, 0, 0, TAU);
      }
    }
    const hazeBody = mixHex(pal.haze, pal.depthTint ?? pal.haze, d.tone);
    const topCol = mixHex(mixHex(hazeBody, pal.rim, 0.55 * d.lit), '#ffffff', 0.08 * d.lit);
    const shade = mixHex(hazeBody, pal.silhouette, 0.12);
    const body = ctx.createLinearGradient(0, -(d.top + d.billow), 0, -(d.top - d.depth));
    body.addColorStop(0, topCol);
    body.addColorStop(0.1, mixHex(topCol, shade, 0.45));
    body.addColorStop(0.3, shade);
    // The vapor thins with depth: what lies below shows through as it sinks into the haze.
    body.addColorStop(0.55, rgba(hazeBody, 0.8 * d.floor + 0.2));
    body.addColorStop(0.8, rgba(hazeBody, 0.55 * d.floor));
    body.addColorStop(1, rgba(hazeBody, 0));
    // Soft vapor edge: the halo of a blurred fill, then the body over it.
    ctx.save();
    ctx.shadowColor = rgba(topCol, 0.55);
    ctx.shadowBlur = Math.max(2, 0.05 * k);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.restore();
    // Lit rims on the billows: the top edges again, shifted, light only where it stays exposed.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgba(topCol, 0.5 * d.lit);
    ctx.fill(path);
    ctx.translate(0.01, 0.035);
    ctx.fillStyle = body;
    ctx.fill(path);
    ctx.translate(-0.01, -0.035);
    // Shadowed hollows between billows: faint horizontal striations.
    for (let i = 0; i < 40; i++) {
      const x = rng.float() * d.tile;
      const y = -d.top + d.billow * (0.4 + rng.float() * 2.2);
      const len = 0.3 + rng.float() * 1.1;
      ctx.fillStyle = rgba(shade, 0.18 + 0.2 * rng.float());
      ctx.fillRect(x - len / 2, y, len, 0.012 + 0.02 * rng.float());
      if (x - len / 2 < 0) ctx.fillRect(x - len / 2 + d.tile, y, len, 0.02);
      if (x + len / 2 > d.tile) ctx.fillRect(x - len / 2 - d.tile, y, len, 0.02);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Tile the bank across layer-x [x0, x1] (caller applied the layer transform), scrolled by t. */
  draw(ctx: CanvasRenderingContext2D, x0: number, x1: number, t: number): void {
    const c = this.canvas;
    if (!c) return;
    const d = this.def;
    let off = (t * d.speed) % d.tile;
    if (off < 0) off += d.tile;
    const i0 = Math.floor((x0 - off) / d.tile);
    const i1 = Math.floor((x1 - off) / d.tile);
    const h = this.y1 - this.y0;
    // Overlap tiles by ~1 px so the seam never shows.
    const tw = d.tile + 1 / this.k;
    for (let i = i0; i <= i1; i++) ctx.drawImage(c, off + i * d.tile, this.y0, tw, h);
  }
}
