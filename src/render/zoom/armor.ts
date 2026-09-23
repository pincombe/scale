// The colossus's armor, for the close-ups: sabatons with lames and rivets, greaves with a ridge
// catching the light, poleyns, the tabard in the arms' field color with a gilt hem, the backplate's
// fauld, pauldron lames, the bascinet's visor, slit and breaths, the blade's fuller.
//
// A backlit knight is near-black; its plates read by the light caught on their edges, so the detail
// here is almost all edge light (the rim color at partial alpha) and rivet glints, drawn inside the
// silhouette's clip. Parts that overlap others (the front leg, the tabard, the torso, the shield)
// are re-painted in order with their own rim band, so up close the plates separate in depth; at
// `detail` 0 every re-paint is exactly the plain silhouette, so the colossus still becomes the
// crowd's hero pixel for pixel. Line widths live in screen px (crisp at any size); plates, rivets
// and curves live in figure units. Allocation-free per frame (colors are cached per palette).
import type { Palette } from '../palette';
import type { Heraldry } from '../crowd/api';
import type { Joints } from '../crowd/rig';
import { bladeLength, SHIELD_SCALE } from '../crowd/rig';
import { AlphaRamp, mixHex } from '../../lib/color';
import type { Colossus } from './colossus';
import { bootPoints, disc, local, LP, traceBoot, traceLeg, traceShield, traceSkirt, traceTorso } from './shapes';

/** Highlight line width in CSS px: never thinner than a crisp hairline, never a stripe. */
const LINE_MIN = 1.1;
const LINE_MAX = 2.6;

export class ArmorDetail {
  private pal: Palette | null = null;
  private her: Heraldry | null = null;
  private rimRamp: AlphaRamp | null = null;
  private glintRamp: AlphaRamp | null = null;
  private darkRamp: AlphaRamp | null = null;
  private tabard = '#301018';
  private trim = '#806020';
  private rivet = '#403040';
  private mid = '#888';

  private ensure(p: Palette, h: Heraldry, mid: string): void {
    if (p !== this.pal) {
      this.pal = p;
      this.rimRamp = new AlphaRamp(p.rim);
      this.glintRamp = new AlphaRamp(mixHex(p.rim, '#ffffff', 0.55));
      this.darkRamp = new AlphaRamp('#000000');
      this.rivet = mixHex(p.silhouette, p.rim, 0.22);
      this.her = null;
    }
    this.mid = mid;
    if (h !== this.her) {
      this.her = h;
      this.tabard = mixHex(h.field, p.silhouette, 0.8);
      this.trim = mixHex(h.tincture, p.silhouette, 0.66);
    }
  }

  /**
   * Draw the detail (inside the silhouette clip, figure transform [a c e; b d f] set). `rim` is the
   * silhouette's rim band in device px, `pxu` device px per figure unit.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    col: Colossus,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    pxu: number,
    dpr: number,
    p: Palette,
    h: Heraldry,
    detail: number,
    rim: number,
  ): void {
    this.ensure(p, h, col.midTone);
    const j = col.j;
    const lw = clampW(pxu, dpr);
    const lx = p.light.x;
    const ly = p.light.y;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. The far (back) leg.
    this.leg(ctx, j.bHipX, j.bHipY, j.bKnX, j.bKnY, j.bFtX, j.bFtY, lw, detail, 0.75);

    // 2. The near (front) leg, over it.
    this.repaint(ctx, col, REPAINT_LEG_A, a, b, c, d, e, f, lx, ly, rim, detail, p.silhouette);
    this.leg(ctx, j.aHipX, j.aHipY, j.aKnX, j.aKnY, j.aFtX, j.aFtY, lw, detail, 1);

    // 3. The tabard (the surcoat skirt), over both thighs: the arms' field color, a gilt hem.
    this.repaint(ctx, col, REPAINT_SKIRT, a, b, c, d, e, f, lx, ly, rim, detail, this.tabard);
    this.tabardDetail(ctx, j, lw, detail);

    // 4. The torso (the backplate and fauld; the shield covers the breastplate).
    this.repaint(ctx, col, REPAINT_TORSO, a, b, c, d, e, f, lx, ly, rim, detail, p.silhouette);
    this.torsoDetail(ctx, j, lw, detail);

    // 5. The helm, the near pauldron and arm.
    this.helmDetail(ctx, j, lw, detail);
    this.pauldron(ctx, j.nShX, j.nShY, j, lw, detail);
    this.couter(ctx, j.nElX, j.nElY, lw, detail);
    this.couter(ctx, j.fElX, j.fElY, lw, detail * 0.7);
    this.swordDetail(ctx, j, col.pose.weapon, lw, detail);

    // 6. The shield, in front of it all (its face is painted over it afterwards).
    this.repaint(ctx, col, REPAINT_SHIELD, a, b, c, d, e, f, lx, ly, rim, detail, p.silhouette);
    this.shieldDetail(ctx, j, col.pose.shield, lw, detail);
  }

  /**
   * Re-paint one part over what is already drawn: its own rim band (fading in with `detail`) and its
   * body (opaque, so it hides the detail of the parts behind it). At detail 0 this repaints exactly
   * what the silhouette passes painted there.
   */
  private repaint(
    ctx: CanvasRenderingContext2D,
    col: Colossus,
    part: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    lx: number,
    ly: number,
    rim: number,
    detail: number,
    body: string,
  ): void {
    const pal = this.pal!;
    ctx.save();
    ctx.beginPath();
    tracePart(ctx, col, part);
    ctx.clip();
    if (detail > 0.01) {
      ctx.globalAlpha = detail;
      ctx.fillStyle = pal.rim;
      ctx.fill();
      ctx.setTransform(a, b, c, d, e - lx * rim * 0.5, f - ly * rim * 0.5);
      ctx.fillStyle = this.mid;
      ctx.beginPath();
      tracePart(ctx, col, part);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(a, b, c, d, e - lx * rim * 1.05, f - ly * rim * 1.05);
    ctx.beginPath();
    tracePart(ctx, col, part);
    if (body !== pal.silhouette) {
      // A colored body (the tabard) fades in over the plain one.
      ctx.fillStyle = pal.silhouette;
      ctx.fill();
      ctx.globalAlpha = detail;
      ctx.fillStyle = body;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = body;
      ctx.fill();
    }
    ctx.setTransform(a, b, c, d, e, f);
    ctx.restore();
  }

  // ---------------------------------------------------------------- legs

  private leg(ctx: CanvasRenderingContext2D, hx: number, hy: number, kx: number, ky: number, fx: number, fy: number, lw: number, detail: number, bright: number): void {
    const rim = this.rimRamp!;
    const glint = this.glintRamp!;
    // Greave: shin axis (to the ankle, where the close-up greave ends) and its front (lit) normal.
    const ankX = fx + 0.6 * detail;
    const ankY = fy - 4.6 * detail;
    let sx = ankX - kx;
    let sy = ankY - ky;
    const sl = Math.sqrt(sx * sx + sy * sy) || 1;
    sx /= sl;
    sy /= sl;
    const nx = sy;
    const ny = -sx;
    // Thigh axis (the cuisse's lower lame and the poleyn's upper lame).
    let tx = kx - hx;
    let ty = ky - hy;
    const tl = Math.sqrt(tx * tx + ty * ty) || 1;
    tx /= tl;
    ty /= tl;

    ctx.lineWidth = lw;
    ctx.strokeStyle = rim.at(0.5 * detail * bright);
    ctx.beginPath();
    // The greave's ridge, just inside its front edge.
    ctx.moveTo(kx + sx * sl * 0.2 + nx * 3.1, ky + sy * sl * 0.2 + ny * 3.1);
    ctx.quadraticCurveTo(kx + sx * sl * 0.55 + nx * 3.6, ky + sy * sl * 0.55 + ny * 3.6, kx + sx * sl * 0.86 + nx * 2.7, ky + sy * sl * 0.86 + ny * 2.7);
    // Its top edge under the knee, and the flare over the ankle.
    arcAcross(ctx, kx + sx * sl * 0.15, ky + sy * sl * 0.15, sx, sy, nx, ny, 4.6, 0.9);
    arcAcross(ctx, kx + sx * sl * 0.9, ky + sy * sl * 0.9, sx, sy, nx, ny, 4.4, 1.1);
    // The cuisse's lowest lame, and the poleyn's plates above and below the knee.
    arcAcross(ctx, kx - tx * 4.6, ky - ty * 4.6, tx, ty, ty, -tx, 5.4, 1.1);
    arcAcross(ctx, kx - tx * 8.4, ky - ty * 8.4, tx, ty, ty, -tx, 5.8, 1.2);
    arcAcross(ctx, kx + sx * 3.4, ky + sy * 3.4, sx, sy, nx, ny, 4.8, 0.9);
    ctx.stroke();

    // The poleyn: a round cop on the knee, lit on its upper front.
    ctx.strokeStyle = rim.at(0.62 * detail * bright);
    ctx.beginPath();
    ctx.moveTo(kx + 4.3 * Math.cos(-2.3), ky + 4.3 * Math.sin(-2.3));
    ctx.arc(kx, ky, 4.3, -2.3, 0.55, false);
    ctx.stroke();

    // The sabaton.
    this.sabaton(ctx, fx, fy, kx, lw, detail, bright);

    // Rivets: the greave's top band, the knee cop, the ankle.
    ctx.fillStyle = this.rivet;
    ctx.globalAlpha = detail;
    ctx.beginPath();
    disc(ctx, kx + sx * sl * 0.2 + nx * 2.8, ky + sy * sl * 0.2 + ny * 2.8, 0.5);
    disc(ctx, kx + sx * sl * 0.2 - nx * 2.6, ky + sy * sl * 0.2 - ny * 2.6, 0.5);
    disc(ctx, kx, ky, 0.85);
    disc(ctx, fx - 0.4, fy - 4.4, 0.8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = glint.at(0.8 * detail * bright);
    ctx.beginPath();
    disc(ctx, kx + sx * sl * 0.2 + nx * 2.95, ky + sy * sl * 0.2 + ny * 2.8 - 0.15, 0.2);
    disc(ctx, kx + 0.3, ky - 0.3, 0.3);
    disc(ctx, fx - 0.15, fy - 4.65, 0.28);
    ctx.fill();
  }

  /** Lames across the instep and the toe, the sole's welt, rivets, a glint on the toe cap. */
  private sabaton(ctx: CanvasRenderingContext2D, fx: number, fy: number, kx: number, lw: number, detail: number, bright: number): void {
    const rim = this.rimRamp!;
    const b = bootPoints(fx, fy, kx, detail);
    const ix = b.ix;
    const iy = b.iy;
    const cx = b.cx;
    const cy = b.cy;
    const tx = b.tx;
    const ty = b.ty;
    const sole = fy - 0.9;
    ctx.lineWidth = lw;
    ctx.strokeStyle = rim.at(0.55 * detail * bright);
    ctx.beginPath();
    // Instep lames (over the top of the foot, behind the curve).
    for (let i = 0; i < 2; i++) {
      const u = 0.3 + i * 0.35;
      const x0 = b.hx + (ix - b.hx) * u;
      const y0 = b.hy + (iy - b.hy) * u;
      ctx.moveTo(x0, y0 + 0.4);
      ctx.quadraticCurveTo(x0 + 1.2, fy - 2.8, x0 + 0.7, sole);
    }
    // Lames down the curve to the toe: points on the boot's top curve, each plate edge bowed forward.
    for (let i = 0; i < 5; i++) {
      const s = 0.08 + i * 0.17;
      const v = 1 - s;
      const qx = v * v * ix + 2 * v * s * cx + s * s * tx;
      const qy = v * v * iy + 2 * v * s * cy + s * s * ty;
      if (qy > sole - 0.4) break;
      ctx.moveTo(qx - 0.35, qy + 0.35);
      ctx.quadraticCurveTo(qx + 0.9 - i * 0.2, (qy + sole) * 0.5, qx - 0.1 - i * 0.25, sole);
    }
    ctx.stroke();
    // The welt along the sole.
    ctx.strokeStyle = rim.at(0.28 * detail * bright);
    ctx.beginPath();
    ctx.moveTo(b.bx + 0.3, sole + 0.15);
    ctx.lineTo(b.sx - 0.6, sole + 0.15);
    ctx.stroke();
    // A glint along the toe cap's crest.
    ctx.strokeStyle = this.glintRamp!.at(0.85 * detail * bright);
    ctx.beginPath();
    {
      const s0 = 0.72;
      const s1 = 0.9;
      const v0 = 1 - s0;
      const v1 = 1 - s1;
      ctx.moveTo(v0 * v0 * ix + 2 * v0 * s0 * cx + s0 * s0 * tx - 0.5, v0 * v0 * iy + 2 * v0 * s0 * cy + s0 * s0 * ty + 0.55);
      ctx.lineTo(v1 * v1 * ix + 2 * v1 * s1 * cx + s1 * s1 * tx - 0.5, v1 * v1 * iy + 2 * v1 * s1 * cy + s1 * s1 * ty + 0.5);
    }
    ctx.stroke();
    // Rivets at the top of each lame.
    ctx.fillStyle = this.rivet;
    ctx.globalAlpha = detail;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const s = 0.08 + i * 0.17;
      const v = 1 - s;
      const qx = v * v * ix + 2 * v * s * cx + s * s * tx;
      const qy = v * v * iy + 2 * v * s * cy + s * s * ty;
      disc(ctx, qx + 0.35 - i * 0.12, qy + 1.25, 0.36);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.glintRamp!.at(0.7 * detail * bright);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const s = 0.08 + i * 0.17;
      const v = 1 - s;
      const qx = v * v * ix + 2 * v * s * cx + s * s * tx;
      const qy = v * v * iy + 2 * v * s * cy + s * s * ty;
      disc(ctx, qx + 0.45 - i * 0.12, qy + 1.12, 0.14);
    }
    ctx.fill();
  }

  // ---------------------------------------------------------------- body

  private tabardDetail(ctx: CanvasRenderingContext2D, j: Joints, lw: number, detail: number): void {
    const hx = j.hipX;
    const hy = j.hipY;
    const kneeMidX = (j.aKnX + j.bKnX) * 0.5;
    const kneeMidY = (j.aKnY + j.bKnY) * 0.5;
    const hemX = hx + (kneeMidX - hx) * 0.55;
    const hemY = hy + (kneeMidY - hy) * 0.55;
    // The gilt hem: a band along the bottom edge, in shade (backlit).
    ctx.globalAlpha = detail * 0.85;
    ctx.fillStyle = this.trim;
    ctx.beginPath();
    ctx.moveTo(hemX - j.fwX * 13.6, hemY - j.fwY * 13.6 + 2 - 1.6);
    ctx.lineTo(hemX + j.fwX * 13.6, hemY + j.fwY * 13.6 + 2 - 1.6);
    ctx.lineTo(hemX + j.fwX * 14, hemY + j.fwY * 14 + 2);
    ctx.lineTo(hemX - j.fwX * 14, hemY - j.fwY * 14 + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Folds fanning from the belt to the hem, catching the light on one side.
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.rimRamp!.at(0.22 * detail);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const u = -0.62 + i * 0.4;
      const tx0 = hx + j.upX * 5 + j.fwX * 9.5 * u;
      const ty0 = hy + j.upY * 5 + j.fwY * 9.5 * u;
      const tx1 = hemX + j.fwX * 13 * u;
      const ty1 = hemY + j.fwY * 13 * u + 0.4;
      ctx.moveTo(tx0, ty0);
      ctx.quadraticCurveTo((tx0 + tx1) * 0.5 + 0.8, (ty0 + ty1) * 0.5, tx1, ty1);
    }
    ctx.stroke();
    // The belt, with a buckle glint.
    ctx.strokeStyle = this.rimRamp!.at(0.4 * detail);
    ctx.beginPath();
    ctx.moveTo(hx + j.upX * 6.2 - j.fwX * 9.6, hy + j.upY * 6.2 - j.fwY * 9.6);
    ctx.lineTo(hx + j.upX * 6.2 + j.fwX * 9.6, hy + j.upY * 6.2 + j.fwY * 9.6);
    ctx.stroke();
  }

  private torsoDetail(ctx: CanvasRenderingContext2D, j: Joints, lw: number, detail: number): void {
    const hx = j.hipX;
    const hy = j.hipY;
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.rimRamp!.at(0.42 * detail);
    ctx.beginPath();
    // Fauld lames above the belt, and the backplate's edge.
    for (let i = 0; i < 2; i++) {
      const u = 8.5 + i * 3.2;
      ctx.moveTo(hx + j.upX * u - j.fwX * 9.2, hy + j.upY * u - j.fwY * 9.2);
      ctx.quadraticCurveTo(hx + j.upX * (u - 1.2), hy + j.upY * (u - 1.2), hx + j.upX * u + j.fwX * 10, hy + j.upY * u + j.fwY * 10);
    }
    ctx.moveTo(hx + j.upX * 12 - j.fwX * 9.2, hy + j.upY * 12 - j.fwY * 9.2);
    ctx.quadraticCurveTo(hx + j.upX * 22 - j.fwX * 10.6, hy + j.upY * 22 - j.fwY * 10.6, hx + j.upX * 29 - j.fwX * 8.4, hy + j.upY * 29 - j.fwY * 8.4);
    ctx.stroke();
  }

  private helmDetail(ctx: CanvasRenderingContext2D, j: Joints, lw: number, detail: number): void {
    const cs = Math.cos(j.headA);
    const sn = Math.sin(j.headA);
    const hx = j.headX;
    const hy = j.headY;
    const rim = this.rimRamp!;
    // The visor's hinge line (skull / snout) and the lower edge of the skull.
    ctx.lineWidth = lw;
    ctx.strokeStyle = rim.at(0.5 * detail);
    ctx.beginPath();
    local(hx, hy, cs, sn, 7.8, -12.5);
    ctx.moveTo(LP.x, LP.y);
    local(hx, hy, cs, sn, 5.6, -3);
    let qx = LP.x;
    let qy = LP.y;
    local(hx, hy, cs, sn, 9.5, 9.5);
    ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
    // The aventail: two scalloped rows at the neck.
    for (let r = 0; r < 2; r++) {
      const y = 9.4 + r * 2.2;
      local(hx, hy, cs, sn, -10.5 + r * 0.5, y);
      ctx.moveTo(LP.x, LP.y);
      for (let i = 0; i < 6; i++) {
        const x0 = -10.5 + r * 0.5 + i * 3.6;
        local(hx, hy, cs, sn, x0 + 1.8, y + 1.3);
        qx = LP.x;
        qy = LP.y;
        local(hx, hy, cs, sn, x0 + 3.6, y);
        ctx.quadraticCurveTo(qx, qy, LP.x, LP.y);
      }
    }
    ctx.stroke();
    // The sight: a dark slit with its lip catching the light.
    ctx.strokeStyle = this.darkRamp!.at(0.85 * detail);
    ctx.lineWidth = lw * 1.8;
    ctx.beginPath();
    local(hx, hy, cs, sn, 6.2, -3.2);
    ctx.moveTo(LP.x, LP.y);
    local(hx, hy, cs, sn, 13.4, -0.4);
    ctx.lineTo(LP.x, LP.y);
    ctx.stroke();
    // Breaths on the snout, and the visor's pivot.
    ctx.fillStyle = this.darkRamp!.at(0.9 * detail);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      local(hx, hy, cs, sn, 13.2 + (i % 2) * 1.5, 1.8 + i * 1.25);
      disc(ctx, LP.x, LP.y, 0.42);
    }
    ctx.fill();
    ctx.fillStyle = this.rivet;
    ctx.globalAlpha = detail;
    ctx.beginPath();
    local(hx, hy, cs, sn, 3.4, -6.2);
    disc(ctx, LP.x, LP.y, 1.15);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.glintRamp!.at(0.8 * detail);
    ctx.beginPath();
    local(hx, hy, cs, sn, 3.75, -6.6);
    disc(ctx, LP.x, LP.y, 0.4);
    ctx.fill();
  }

  private pauldron(ctx: CanvasRenderingContext2D, sx: number, sy: number, j: Joints, lw: number, detail: number): void {
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.rimRamp!.at(0.5 * detail);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const r = 8.1 - i * 1.1;
      const cx = sx - j.upX * (1.6 + i * 2.5);
      const cy = sy - j.upY * (1.6 + i * 2.5);
      ctx.moveTo(cx + r * Math.cos(0.15), cy + r * Math.sin(0.15));
      ctx.arc(cx, cy, r, 0.15, Math.PI - 0.15, false);
    }
    ctx.stroke();
    ctx.fillStyle = this.rivet;
    ctx.globalAlpha = detail;
    ctx.beginPath();
    disc(ctx, sx + j.fwX * 5.2 - j.upX * 1, sy + j.fwY * 5.2 - j.upY * 1, 0.55);
    disc(ctx, sx - j.fwX * 5.2 - j.upX * 1, sy - j.fwY * 5.2 - j.upY * 1, 0.55);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private couter(ctx: CanvasRenderingContext2D, ex: number, ey: number, lw: number, detail: number): void {
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.rimRamp!.at(0.5 * detail);
    ctx.beginPath();
    ctx.moveTo(ex + 3.2 * Math.cos(-2.4), ey + 3.2 * Math.sin(-2.4));
    ctx.arc(ex, ey, 3.2, -2.4, 0.4, false);
    ctx.stroke();
  }

  private swordDetail(ctx: CanvasRenderingContext2D, j: Joints, w: number, lw: number, detail: number): void {
    const dx = Math.cos(w);
    const dy = Math.sin(w);
    const px = -dy;
    const py = dx;
    const hx = j.fHX;
    const hy = j.fHY;
    const L = bladeLength('hero');
    ctx.lineWidth = lw;
    // The fuller down the blade, and the lit edge of the crossguard.
    ctx.strokeStyle = this.rimRamp!.at(0.38 * detail);
    ctx.beginPath();
    ctx.moveTo(hx + dx * 7.5, hy + dy * 7.5);
    ctx.lineTo(hx + dx * (5 + L * 0.72), hy + dy * (5 + L * 0.72));
    ctx.moveTo(hx + dx * 3 - px * 7.4, hy + dy * 3 - py * 7.4);
    ctx.lineTo(hx + dx * 3 + px * 7.4, hy + dy * 3 + py * 7.4);
    ctx.stroke();
  }

  private shieldDetail(ctx: CanvasRenderingContext2D, j: Joints, tilt: number, lw: number, detail: number): void {
    // The shield's edge plate: a lit line just inside its rim.
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.rimRamp!.at(0.3 * detail);
    ctx.beginPath();
    traceShield(ctx, j, tilt, SHIELD_SCALE * 0.95);
    ctx.stroke();
  }
}

/** Highlight line width in figure units for `pxu` device px per unit. */
function clampW(pxu: number, dpr: number): number {
  const want = 0.3 * pxu;
  const lo = LINE_MIN * dpr;
  const hi = LINE_MAX * dpr;
  return (want < lo ? lo : want > hi ? hi : want) / pxu;
}

/** A plate edge across a limb at (cx, cy): axis (ax, ay), across (nx, ny), half-width w, bowed by `bow` along the axis. */
function arcAcross(ctx: CanvasRenderingContext2D, cx: number, cy: number, ax: number, ay: number, nx: number, ny: number, w: number, bow: number): void {
  ctx.moveTo(cx - nx * w, cy - ny * w);
  ctx.quadraticCurveTo(cx + ax * bow * 2, cy + ay * bow * 2, cx + nx * w, cy + ny * w);
}

const REPAINT_LEG_A = 0;
const REPAINT_SKIRT = 1;
const REPAINT_TORSO = 2;
const REPAINT_SHIELD = 3;

function tracePart(ctx: CanvasRenderingContext2D, col: Colossus, part: number): void {
  const j = col.j;
  switch (part) {
    case REPAINT_LEG_A:
      traceLeg(ctx, j.aHipX, j.aHipY, j.aKnX, j.aKnY, j.aFtX, j.aFtY, col.shape);
      traceBoot(ctx, j.aFtX, j.aFtY, j.aKnX, col.shape);
      break;
    case REPAINT_SKIRT:
      traceSkirt(ctx, j);
      break;
    case REPAINT_TORSO:
      traceTorso(ctx, j);
      break;
    case REPAINT_SHIELD:
      traceShield(ctx, j, col.pose.shield, SHIELD_SCALE);
      break;
  }
}
