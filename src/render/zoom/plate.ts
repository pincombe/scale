// The meadow's scale: the old tier's snapshot framed as one plate of the world wyrm's hide.
//
// The plate is a real scale of the Mountain's hide (backdrop/hide.ts: the same curves, at the same
// spot), chosen just in front of the colossus's toes, sitting a little proud of its row (its crown
// raised LIFT pitches) so more of its face shows; the next row's crowns still cut across its lower
// part like every other scale's, which is what makes it read as one of them. In it, the meadow: a
// dark rim with the rose rim light on its lit edge, the picture inset (sky, sun, range, horizon;
// the grass under the next row), a gloss on its crown and a polished sheen sweeping across it. At
// the end the backdrop keeps it, faintly warm, under the hero's feet (backdrop.markScale).
//
// The frame morphs from the picture's own rectangle (the screen, at the flash) into the scale: both
// are the same path (a move, then four cubics: two over the crown, one down each side to the root
// the rows in front hide), in the picture's normalized coordinates, so the morph is a plain
// interpolation of its points.
import type { Palette } from '../palette';
import { hideIndexAt, hideRowAt, hideScaleOf, scalePictureRect, scaleShape, traceScale, type ScaleShape } from '../backdrop/hide';
import { rect } from '../../lib/vec';
import { makeCanvas, context2d } from '../atlas';
import { mixHex, rgba } from '../../lib/color';

/** Where the plate is looked for, from the colossus's root (m): right of it, in front of the toes. */
const SEEK_DX = 0.13;
const SEEK_DY = 0.19;
/** Dark rim band, as a fraction of the plate's half-width. */
const RIM_FRAC = 0.045;
/** The root's depth below the crown's (unraised) top, in row pitches (the pattern's plates reach 2.15). */
const ROOT = 2.3;
/** The meadow's scale sits proud of its row by this many pitches (the backdrop's keepsake too). */
export const LIFT = 0.55;

/** Frame points: P0, then (C, C, P) x 4: over the crown to the apex, to the right shoulder, down to the root, up to P0. */
const NPTS = 13;

export class MeadowPlate {
  readonly s: ScaleShape = scaleShape();
  /** The picture's rect on the plate (world m): covers the plate at the snapshot's aspect. */
  x = 0;
  y = 0;
  w = 1;
  h = 1;
  /** Plate center (world m), and its root (the rounded point at the bottom). */
  cx = 0;
  cy = 0;
  rootY = 0;
  /** The raised crown's top, as a fraction of the picture's height. */
  crownV = 0;
  /** The middle of the face that shows (world y): between the crown and the next row's crowns. */
  faceY = 0;
  chosen = false;
  /** The plate's points in the picture's normalized coordinates, and the rectangle's. */
  private readonly plateN = new Float64Array(NPTS * 2);
  private readonly rectN = new Float64Array(NPTS * 2);
  private readonly cur = new Float64Array(NPTS * 2);
  private readonly probe: ScaleShape = scaleShape();
  private readonly pr = rect();

  // Baked sprites (per palette).
  private pal: Palette | null = null;
  shade: HTMLCanvasElement | null = null;
  gloss: HTMLCanvasElement | null = null;
  sheen: HTMLCanvasElement | null = null;
  rimLight = '#fff';
  rimDark = '#000';
  /** Behind the picture, where it ends under the rows in front: the meadow's dark ground. */
  ground = '#000';

  /**
   * Pick the scale in front of the colossus (root at world rootX, rootY): the widest near the spot
   * just ahead of the toes, rows 2-4 of the hide there. `aspect` = the snapshot's height / width.
   */
  choose(rootX: number, rootY: number, aspect: number): void {
    const tx = rootX + SEEK_DX;
    const ty = rootY + SEEK_DY;
    const n0 = hideRowAt(rootY + 0.07);
    const n1 = hideRowAt(rootY + 0.3);
    let best = -Infinity;
    const p = this.probe;
    for (let n = n0; n <= n1; n++) {
      const ic = hideIndexAt(n, tx);
      for (let i = ic - 2; i <= ic + 2; i++) {
        hideScaleOf(n, i, p);
        // Never under the boots (their soles end at the root line): its raised crown clear of them.
        if (p.top - LIFT * p.pitch < rootY + 0.03) continue;
        const d = Math.hypot((p.cx - tx) / 0.12, (p.top + (p.bottom - p.top) * 0.4 - ty) / 0.1);
        // Wide ones, and ones already proud of their row (more face shows).
        const score = p.sx * 6 - d + ((p.rowY - p.top) / p.pitch) * 0.8;
        if (score > best) {
          best = score;
          copyShape(p, this.s);
        }
      }
    }
    if (best === -Infinity) hideScaleOf(hideRowAt(ty), hideIndexAt(hideRowAt(ty), tx), this.s);
    const s = this.s;
    // The whole scale: its raised crown, then the sides straight down past the next row's crowns,
    // rounding in to the root they hide.
    const top = s.top - LIFT * s.pitch;
    const root = s.top + ROOT * s.pitch;
    this.rootY = root;
    // The picture: as wide as the plate, its top at the crown (shared with the backdrop's keepsake).
    const pr = scalePictureRect(s, LIFT, aspect, this.pr);
    const w = pr.w;
    const h = pr.h;
    this.x = pr.x;
    this.y = pr.y;
    this.w = w;
    this.h = h;
    // The face that shows: from the crown down to about the next row's crowns.
    this.cx = s.cx + s.lean * 0.3;
    this.cy = top + (s.rowY + s.pitch * 1.15 - top) * 0.5;
    this.crownV = (top - pr.y) / h;
    this.faceY = top + (s.rowY + s.pitch - top) * 0.45;
    const n = this.plateN;
    const ux = (xx: number): number => (xx - this.x) / w;
    const vy = (yy: number): number => (yy - this.y) / h;
    const cx = s.cx;
    const sx = s.sx;
    const ry = s.ry;
    const lean = s.lean;
    const shoulder = top + ry;
    const side = root - shoulder;
    setPt(n, 0, ux(cx - sx), vy(shoulder));
    setPt(n, 1, ux(cx - sx), vy(top + ry * 0.35));
    setPt(n, 2, ux(cx - sx * 0.45 + lean), vy(top));
    setPt(n, 3, ux(cx + lean * 0.6), vy(top));
    setPt(n, 4, ux(cx + sx * 0.45 + lean), vy(top));
    setPt(n, 5, ux(cx + sx), vy(top + ry * 0.35));
    setPt(n, 6, ux(cx + sx), vy(shoulder));
    setPt(n, 7, ux(cx + sx * 0.97), vy(shoulder + side * 0.62));
    setPt(n, 8, ux(cx + sx * 0.52), vy(root));
    setPt(n, 9, ux(cx + lean * 0.15), vy(root));
    setPt(n, 10, ux(cx - sx * 0.52), vy(root));
    setPt(n, 11, ux(cx - sx * 0.97), vy(shoulder + side * 0.62));
    setPt(n, 12, ux(cx - sx), vy(shoulder));
    // The rectangle in the same topology: the crown flattened onto the top edge, the sides down
    // the rectangle's own, the root in the middle of its bottom edge.
    const r = this.rectN;
    const apex = n[6]!;
    const mid = n[18]!;
    setPt(r, 0, 0, 0);
    setPt(r, 1, 0, 0);
    setPt(r, 2, apex * 0.5, 0);
    setPt(r, 3, apex, 0);
    setPt(r, 4, apex + (1 - apex) * 0.5, 0);
    setPt(r, 5, 1, 0);
    setPt(r, 6, 1, 0);
    setPt(r, 7, 1, 1);
    setPt(r, 8, 1, 1);
    setPt(r, 9, mid, 1);
    setPt(r, 10, 0, 1);
    setPt(r, 11, 0, 1);
    setPt(r, 12, 0, 0);
    this.chosen = true;
  }

  /** The plate as the backdrop draws it (world m): the pattern's plate, its crown raised. */
  tracePlate(ctx: CanvasRenderingContext2D, dx = 0, dy = 0): void {
    traceScale(ctx, this.s, dx, dy, LIFT);
  }

  /** The whole lifted scale (world m): the frame at 1 on the plate's own picture rect. */
  traceWhole(ctx: CanvasRenderingContext2D): void {
    this.traceFrame(ctx, this.x, this.y, this.w, this.h, 1);
  }

  /**
   * The frame at morph m (0 = the picture's rectangle, 1 = the plate) for the picture now at world
   * rect (rx, ry, rw, rh), scaled about the picture's center by (qx, qy) (an inset), shifted by (dx, dy).
   */
  traceFrame(ctx: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, m: number, qx = 1, qy = 1, dx = 0, dy = 0): void {
    const c = this.cur;
    const a = this.rectN;
    const b = this.plateN;
    const ox = rx + rw * 0.5 + dx;
    const oy = ry + rh * 0.5 + dy;
    for (let i = 0; i < NPTS * 2; i += 2) {
      const u = a[i]! + (b[i]! - a[i]!) * m;
      const v = a[i + 1]! + (b[i + 1]! - a[i + 1]!) * m;
      c[i] = ox + (u - 0.5) * rw * qx;
      c[i + 1] = oy + (v - 0.5) * rh * qy;
    }
    ctx.moveTo(c[0]!, c[1]!);
    ctx.bezierCurveTo(c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
    ctx.bezierCurveTo(c[8]!, c[9]!, c[10]!, c[11]!, c[12]!, c[13]!);
    ctx.bezierCurveTo(c[14]!, c[15]!, c[16]!, c[17]!, c[18]!, c[19]!);
    ctx.bezierCurveTo(c[20]!, c[21]!, c[22]!, c[23]!, c[24]!, c[25]!);
    ctx.closePath();
  }

  /** The dark rim's width (world m) at the plate. */
  get rim(): number {
    return this.s.sx * RIM_FRAC;
  }

  ensureArt(p: Palette, old: Palette): void {
    if (p === this.pal && this.shade) return;
    this.pal = p;
    this.rimLight = mixHex(p.rim, '#fff4e6', 0.35);
    this.rimDark = mixHex(p.silhouette, p.depthTint ?? p.haze, 0.1);
    this.ground = mixHex(old.silhouette, old.haze, 0.12);
    // Inner shade: the enamel's depth, darkest along the rim.
    const sh = this.shade ?? makeCanvas(160, 100);
    {
      const g = context2d(sh);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, 160, 100);
      g.setTransform(80, 0, 0, 50, 80, 50);
      const rg = g.createRadialGradient(0, -0.1, 0.2, 0, 0, 1.12);
      rg.addColorStop(0, rgba(p.silhouette, 0));
      rg.addColorStop(0.62, rgba(p.silhouette, 0.06));
      rg.addColorStop(0.86, rgba(p.silhouette, 0.36));
      rg.addColorStop(1, rgba(p.silhouette, 0.72));
      g.fillStyle = rg;
      g.fillRect(-1, -1, 2, 2);
    }
    this.shade = sh;
    // Gloss: the crown catching the sky, a soft band fading down.
    const gl = this.gloss ?? makeCanvas(4, 128);
    {
      const g = context2d(gl);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, 4, 128);
      const lg = g.createLinearGradient(0, 0, 0, 128);
      const c = mixHex(p.rim, '#ffffff', 0.55);
      lg.addColorStop(0, rgba(c, 0.55));
      lg.addColorStop(0.12, rgba(c, 0.22));
      lg.addColorStop(0.4, rgba(c, 0.05));
      lg.addColorStop(1, rgba(c, 0));
      g.fillStyle = lg;
      g.fillRect(0, 0, 4, 128);
    }
    this.gloss = gl;
    // The sheen: a narrow bright band with soft shoulders (swept across, additive).
    const sn = this.sheen ?? makeCanvas(128, 4);
    {
      const g = context2d(sn);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, 128, 4);
      const lg = g.createLinearGradient(0, 0, 128, 0);
      const c = mixHex(p.rim, '#ffffff', 0.7);
      lg.addColorStop(0, rgba(c, 0));
      lg.addColorStop(0.3, rgba(c, 0.18));
      lg.addColorStop(0.47, rgba(c, 0.85));
      lg.addColorStop(0.53, rgba(c, 0.85));
      lg.addColorStop(0.7, rgba(c, 0.18));
      lg.addColorStop(1, rgba(c, 0));
      g.fillStyle = lg;
      g.fillRect(0, 0, 128, 4);
    }
    this.sheen = sn;
  }

  release(): void {
    for (const c of [this.shade, this.gloss, this.sheen]) if (c) c.width = c.height = 0;
    this.shade = this.gloss = this.sheen = null;
    this.pal = null;
    this.chosen = false;
  }
}

function setPt(a: Float64Array, i: number, x: number, y: number): void {
  a[i * 2] = x;
  a[i * 2 + 1] = y;
}

function copyShape(a: ScaleShape, b: ScaleShape): void {
  b.n = a.n;
  b.i = a.i;
  b.cx = a.cx;
  b.sx = a.sx;
  b.lean = a.lean;
  b.top = a.top;
  b.ry = a.ry;
  b.bottom = a.bottom;
  b.rowY = a.rowY;
  b.pitch = a.pitch;
}
