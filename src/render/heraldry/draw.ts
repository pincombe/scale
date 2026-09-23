// drawCoat(): paints a Coat on any 2D context, in three shapes: a heater shield (the Heraldry panel,
// the colossus), a banner (flags) and a kite (the hero's shield). Everything is vector, drawn in a
// unit frame 100 tall, so it is gorgeous at 220 px and still reads at 15 px: the level of detail
// follows the on-screen size (lines of partition, diaper, engraving and small parts drop out as it
// shrinks; limbs grow bolder).
//
// Not for per-frame use: it builds gradients and clip paths. Bake it (banners, the hero's shield)
// or redraw on change (the UI panel).
import type { Coat, CoatCharge, CoatRegion, Line, Motif, Tincture } from './coat';
import { INK, PAINT } from './tinctures';
import { T_DETAIL, T_GOLD, T_GULES, T_HOLE, T_LINE, T_SHADE, chargeArt } from './charges';

export type CoatShape = 'heater' | 'banner' | 'kite';

export interface CoatOpts {
  /** Default 'heater'. */
  shape?: CoatShape;
  /** Banner width / height (default 1.25). */
  aspect?: number;
  /** Mirror left-right: charges face the other way (a flag's reverse, a right-facing bearer). */
  mirror?: boolean;
  /** On-screen height in device px, for the level of detail (default: size x the context's scale). */
  px?: number;
  /** Force a level of detail (0 tiny, 1 small, 2 full). */
  lod?: 0 | 1 | 2;
  /** Draw the crest crown above a heater shield when the coat has one (default true). */
  crest?: boolean;
  /** Painted finish: sheen, rim and texture (default true). */
  finish?: boolean;
  /** Banner: no bordure along the fly edge (a swallowtail flag cuts it). */
  openFly?: boolean;
  /** Banner: x of the principal charge as a fraction of the width, after mirroring (default 0.5). */
  focus?: number;
}

export const HEATER_ASPECT = 0.86;
/** The hero's kite shield (crowd rig): 24 x 42 figure units. */
export const KITE_ASPECT = 24 / 42;
/** How far a crest crown rises above a heater's top edge, as a fraction of `size`. */
export const CREST_RISE = 0.3;

/** Level of detail for an on-screen height in device px. */
export function lodFor(px: number): 0 | 1 | 2 {
  return px < 28 ? 0 : px < 72 ? 1 : 2;
}

// ---- shapes ----------------------------------------------------------------------------------

function cubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, n: number): void {
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
  }
}

/** The outline of a shape inset by `i` units, as a closed polygon (unit frame, height 100). */
function outline(shape: CoatShape, W: number, i: number, openFly: boolean): number[] {
  const out: number[] = [];
  if (shape === 'banner') {
    const x0 = -W / 2 + i;
    const x1 = W / 2 - (openFly ? 0 : i);
    out.push(x0, -50 + i, x1, -50 + i, x1, 50 - i, x0, 50 - i);
    return out;
  }
  if (shape === 'heater') {
    const x0 = -W / 2 + i;
    const x1 = W / 2 - i;
    const y0 = -50 + i;
    const y1 = 50 - i * 1.55;
    const ys = y0 + (y1 - y0) * 0.4;
    out.push(x0, y0, x1, y0, x1, ys);
    cubic(out, x1, ys, x1, ys + (y1 - ys) * 0.58, x1 * 0.52, y1 - (y1 - ys) * 0.16, 0, y1, 18);
    cubic(out, 0, y1, x0 * 0.52, y1 - (y1 - ys) * 0.16, x0, ys + (y1 - ys) * 0.58, x0, ys, 18);
    return out;
  }
  // Kite: the crowd rig's shield (rig.ts shieldPath) normalized to height 100.
  const k = 100 / 42;
  const sx = (W / 2 - i) / (12 * k);
  const sy = (50 - i) / 50;
  const P = (x: number, y: number): [number, number] => [x * k * sx, (y - 4) * k * sy];
  const q = (out2: number[], a: [number, number], c: [number, number], b: [number, number]): void => {
    for (let s = 1; s <= 16; s++) {
      const t = s / 16;
      const u = 1 - t;
      out2.push(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]);
    }
  };
  const a = P(-12, -15);
  out.push(a[0], a[1]);
  q(out, a, P(0, -19), P(12, -15));
  q(out, P(12, -15), P(12, 3), P(0, 25));
  q(out, P(0, 25), P(-12, 3), P(-12, -15));
  return out;
}

function toPath(pts: readonly number[], p = new Path2D()): Path2D {
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
  p.closePath();
  return p;
}

/** Evenly spaced points along a polyline (closed or open), `n` of them, starting at offset `t0` (0..1 of a step). */
function along(pts: readonly number[], closed: boolean, n: number, t0: number): number[] {
  const m = pts.length / 2;
  const segs = closed ? m : m - 1;
  let total = 0;
  const len: number[] = [];
  for (let s = 0; s < segs; s++) {
    const a = s * 2;
    const b = ((s + 1) % m) * 2;
    const l = Math.hypot(pts[b]! - pts[a]!, pts[b + 1]! - pts[a + 1]!);
    len.push(l);
    total += l;
  }
  const out: number[] = [];
  const step = closed ? total / n : total / Math.max(1, n - 1 + 2 * t0);
  for (let k = 0; k < n; k++) {
    let d = (k + t0) * step;
    for (let s = 0; s < segs; s++) {
      if (d <= len[s]! || s === segs - 1) {
        const a = s * 2;
        const b = ((s + 1) % m) * 2;
        const f = len[s]! > 0 ? Math.min(1, d / len[s]!) : 0;
        out.push(pts[a]! + (pts[b]! - pts[a]!) * f, pts[a + 1]! + (pts[b + 1]! - pts[a + 1]!) * f);
        break;
      }
      d -= len[s]!;
    }
  }
  return out;
}

// ---- lines of partition ----------------------------------------------------------------------

/** Amplitude (units) of a line's teeth, for regions that must cover them. */
function lineAmp(line: Line, lod: number): number {
  if (lod === 0) return 0;
  switch (line) {
    case 'indented': return 3.2;
    case 'dancetty': return 6.5;
    case 'wavy': return 3.2;
    case 'engrailed': return 3.4;
    case 'embattled': return 4.6;
    default: return 0;
  }
}

/**
 * Append a horizontal edge at y from xa to xb (either direction) in a line of partition. `dir` = +1
 * puts the teeth's points below y (toward +y). The pattern is centred on x = 0.
 */
function edge(p: Path2D, xa: number, xb: number, y: number, line: Line, dir: number, lod: number, move: boolean): void {
  if (move) p.moveTo(xa, y);
  const amp = lineAmp(line, lod);
  if (amp === 0) {
    p.lineTo(xb, y);
    return;
  }
  const period = line === 'indented' ? 7 : line === 'dancetty' ? 19 : line === 'wavy' ? 17 : line === 'engrailed' ? 11 : 11;
  const sgn = xb >= xa ? 1 : -1;
  const L = Math.abs(xb - xa);
  const steps = Math.ceil(L / period) * 12;
  const h = amp / 2;
  const f = (x: number): number => {
    const ph = (((x / period) % 1) + 1.5) % 1; // 0..1, 0.5 at x = 0
    switch (line) {
      case 'indented':
      case 'dancetty':
        return (Math.abs(ph - 0.5) * 4 - 1) * h * dir;
      case 'wavy':
        return Math.cos((ph - 0.5) * Math.PI * 2) * h * dir;
      case 'engrailed': {
        // Scallops: arcs whose points aim toward -dir (into the chief), cusps toward +dir.
        const u = (ph - 0.5) * 2;
        return (h - Math.sqrt(Math.max(0, 1 - u * u)) * amp) * dir;
      }
      case 'embattled':
        return (ph < 0.5 ? -h : h) * dir;
      default:
        return 0;
    }
  };
  if (line === 'embattled') {
    // Square crenels: walk the step edges exactly.
    let x = xa;
    let prev = f(x + sgn * 1e-3);
    p.lineTo(x, y + prev);
    const half = period / 2;
    let next = Math.floor(x / half) * half + (sgn > 0 ? half : 0);
    if (sgn < 0 && next >= x) next -= half;
    while ((xb - next) * sgn > 0) {
      p.lineTo(next, y + prev);
      const cur = f(next + sgn * 1e-3);
      p.lineTo(next, y + cur);
      prev = cur;
      next += sgn * half;
    }
    p.lineTo(xb, y + prev);
    return;
  }
  for (let s = 0; s <= steps; s++) {
    const x = xa + ((xb - xa) * s) / steps;
    p.lineTo(x, y + f(x));
  }
}

// ---- paint -----------------------------------------------------------------------------------

type Fill = string | CanvasGradient;

interface St {
  ctx: CanvasRenderingContext2D;
  /** Device px per unit (unit frame: 100 = the shape's height). */
  ppu: number;
  lod: 0 | 1 | 2;
  W: number;
  grads: Map<string, CanvasGradient>;
}

const mixCache = new Map<string, string>();

function mix(a: string, b: string, t: number): string {
  const k = a + b + t;
  let s = mixCache.get(k);
  if (!s) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (sh: number): number => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    s = '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
    mixCache.set(k, s);
  }
  return s;
}

/** A sheen gradient for a tincture over the box (x0, y0)-(x1, y1): lit top-left, shaded bottom-right. */
function sheen(ctx: CanvasRenderingContext2D, t: Tincture, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const p = PAINT[t];
  const metal = t === 'or' || t === 'argent';
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  if (metal) {
    g.addColorStop(0, p.light);
    g.addColorStop(0.42, p.base);
    g.addColorStop(0.62, mix(p.base, p.light, 0.25));
    g.addColorStop(1, p.dark);
  } else {
    g.addColorStop(0, mix(p.base, p.light, 0.55));
    g.addColorStop(0.5, p.base);
    g.addColorStop(1, mix(p.base, p.dark, 0.6));
  }
  return g;
}

/** Field fill: one gradient per tincture across the whole shape, so the light falls consistently. */
function fieldFill(st: St, t: Tincture): Fill {
  if (st.lod === 0) return PAINT[t].base;
  let g = st.grads.get(t);
  if (!g) {
    g = sheen(st.ctx, t, -st.W / 2, -50, st.W / 2, 50);
    st.grads.set(t, g);
  }
  return g;
}

/** Half-width and centre of a closed polygon at height y (0 width when y misses it). */
function spanAt(pts: readonly number[], y: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  const m = pts.length / 2;
  for (let i = 0; i < m; i++) {
    const ax = pts[i * 2]!;
    const ay = pts[i * 2 + 1]!;
    const bx = pts[((i + 1) % m) * 2]!;
    const by = pts[((i + 1) % m) * 2 + 1]!;
    if ((ay <= y && by >= y) || (by <= y && ay >= y)) {
      const x = ay === by ? ax : ax + ((bx - ax) * (y - ay)) / (by - ay);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      if (ay === by) {
        if (bx < lo) lo = bx;
        if (bx > hi) hi = bx;
      }
    }
  }
  return hi > lo ? (hi - lo) / 2 : 0;
}

/**
 * Draw a charge fitted into the box centred on (x, y), w x h (unit frame). With `fit` (the field's
 * outline polygon), the charge also shrinks, top anchored, until its silhouette profile clears the
 * shield's narrowing sides (a castle's base in a heater's point).
 */
function drawCharge(st: St, c: CoatCharge, x: number, y: number, w: number, h: number, fit: readonly number[] | null = null): void {
  const px = Math.min(w, h) * st.ppu;
  if (px < 2.5) return;
  const lod = Math.min(st.lod, lodFor(px)) as 0 | 1 | 2;
  const art = chargeArt(c.kind, c.rank, c.detail !== null, lod);
  const bw = art.x1 - art.x0;
  const bh = art.y1 - art.y0;
  let k = Math.min(w / bw, h / bh);
  if (fit) {
    // Shrink until the profile clears the sides; the centre rises by a fifth of the height lost,
    // so a wide-footed charge (a castle, a crown) settles into the shield's broad upper part.
    const k0 = k;
    const at = (kk: number): number => y - (k0 - kk) * bh * 0.2;
    const pr = art.profile;
    for (let it = 0; it < 8; it++) {
      let kk = k;
      const top = at(k) - (bh * k) / 2;
      for (let i = 0; i < pr.length; i += 2) {
        const yy = top + pr[i]! * bh * k;
        const need = pr[i + 1]! * (bw / 2) * k;
        const avail = spanAt(fit, yy) - 3;
        if (need > avail) kk = Math.min(kk, k * Math.max(0.6, avail / need));
      }
      if (kk >= k * 0.999) break;
      k = kk;
    }
    y = at(k);
  }
  const ctx = st.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-(art.x0 + art.x1) / 2, -(art.y0 + art.y1) / 2);
  const dpu = st.ppu * k; // device px per charge unit
  const chPx = bh * dpu;
  // Outline weight (device px, the visible half): bold like engraved heraldry, never clogging.
  const olPx = lod === 0 ? 0.5 : lod === 1 ? Math.min(1.5, 0.7 + chPx * 0.01) : Math.min(5, Math.max(1.4, chPx * 0.0095));
  const ol = (olPx * 2) / dpu;
  const flat = lod === 0;
  const main: Fill = flat ? PAINT[c.tincture].base : sheen(ctx, c.tincture, art.x0, art.y0, art.x1, art.y1);
  const detT = c.detail ?? c.tincture;
  const det: Fill = c.detail === null ? main : flat ? PAINT[detT].base : sheen(ctx, detT, art.x0, art.y0, art.x1, art.y1);
  const shadeC = c.tincture === 'sable' ? mix(PAINT.sable.base, PAINT.sable.light, 0.3) : mix(PAINT[c.tincture].base, PAINT[c.tincture].dark, 0.38);
  let gold: Fill | null = null;
  let gules: Fill | null = null;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  for (const g of art.groups) {
    if (g.paths.length === 0) continue;
    let fill: Fill;
    switch (g.tint) {
      case T_DETAIL: fill = det; break;
      case T_SHADE: fill = shadeC; break;
      case T_GOLD: fill = gold ??= flat ? PAINT.or.base : sheen(ctx, 'or', art.x0, art.y0, art.x1, art.y1); break;
      case T_GULES: fill = gules ??= flat ? PAINT.gules.base : sheen(ctx, 'gules', art.x0, art.y0, art.x1, art.y1); break;
      case T_HOLE: fill = PAINT.sable.dark; break;
      default: fill = main;
    }
    if (g.outline && ol > 0) {
      ctx.lineWidth = ol;
      for (const p of g.paths) ctx.stroke(p);
    }
    ctx.fillStyle = fill;
    for (const p of g.paths) ctx.fill(p);
  }
  if (art.lines.length > 0) {
    // Engraving: about half the outline's weight, at least a hairline.
    const lw = Math.max(0.6, Math.min(2.4, olPx * 0.55));
    for (const l of art.lines) {
      ctx.lineWidth = Math.max(lw / dpu, Math.min(l.width, (lw * 1.6) / dpu));
      ctx.strokeStyle = l.tint === T_LINE ? PAINT[c.tincture].line : INK;
      if (l.clip) {
        ctx.save();
        ctx.clip(l.clip);
        if (l.clipOut) ctx.clip(l.clipOut, 'evenodd');
        ctx.stroke(l.path);
        ctx.restore();
      } else ctx.stroke(l.path);
    }
  }
  ctx.restore();
}

/** A damask lattice over the current clip, in a tone of the tincture: felt more than seen. */
function diaper(st: St, t: Tincture, x0: number, y0: number, x1: number, y1: number): void {
  if (st.lod < 2) return;
  const ctx = st.ctx;
  const p = PAINT[t];
  const metal = t === 'or' || t === 'argent';
  const tone = metal ? p.dark : p.light;
  ctx.save();
  ctx.globalAlpha = metal ? 0.3 : 0.26;
  ctx.strokeStyle = tone;
  ctx.lineWidth = Math.max(0.6 / st.ppu, 0.35);
  const s = 7;
  const h = y1 - y0;
  const path = new Path2D();
  for (let x = x0 - h; x < x1 + h; x += s) {
    path.moveTo(x, y0);
    path.lineTo(x + h, y1);
    path.moveTo(x, y1);
    path.lineTo(x + h, y0);
  }
  ctx.stroke(path);
  // A tiny quatrefoil dot in every other lozenge.
  ctx.globalAlpha = metal ? 0.38 : 0.34;
  ctx.fillStyle = tone;
  const dots = new Path2D();
  const r = 0.75;
  let row = 0;
  for (let y = Math.floor(y0 / s) * s; y < y1 + s; y += s, row++) {
    for (let x = Math.floor(x0 / s) * s + (row % 2 ? s / 2 : 0); x < x1 + s; x += s * 2) {
      dots.moveTo(x + r, y + s / 2);
      dots.arc(x, y + s / 2, r, 0, Math.PI * 2);
    }
  }
  ctx.fill(dots);
  ctx.restore();
}

/** One small motif centred on (x, y), size s, appended to p. */
function motif(p: Path2D, m: Motif, x: number, y: number, s: number): void {
  const h = s / 2;
  switch (m) {
    case 'crosslet': {
      // A cross crosslet: each arm ends in a short crossbar.
      const t = s * 0.1;
      p.rect(x - t, y - h, t * 2, s);
      p.rect(x - h, y - t, s, t * 2);
      const c = h * 0.62;
      const e = h * 0.3;
      p.rect(x - e, y - c - t, e * 2, t * 2);
      p.rect(x - e, y + c - t, e * 2, t * 2);
      p.rect(x - c - t, y - e, t * 2, e * 2);
      p.rect(x + c - t, y - e, t * 2, e * 2);
      break;
    }
    case 'mullet': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? h * 0.42 : h;
        if (i === 0) p.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        else p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      p.closePath();
      break;
    }
    case 'goutte': {
      p.moveTo(x, y - h);
      p.quadraticCurveTo(x + h * 0.15, y - h * 0.2, x + h * 0.55, y + h * 0.3);
      p.arc(x, y + h * 0.35, h * 0.55, 0, Math.PI);
      p.quadraticCurveTo(x - h * 0.15, y - h * 0.2, x, y - h);
      p.closePath();
      break;
    }
    case 'trefoil': {
      const r = h * 0.38;
      for (const [dx, dy] of [[0, -0.45], [-0.42, 0.1], [0.42, 0.1]] as const) {
        p.moveTo(x + dx * h + r, y + dy * h);
        p.arc(x + dx * h, y + dy * h, r, 0, Math.PI * 2);
      }
      p.rect(x - h * 0.07, y, h * 0.14, h);
      break;
    }
    case 'billet':
      p.rect(x - h * 0.42, y - h * 0.75, h * 0.84, h * 1.5);
      break;
    case 'fleur': {
      // A small fleur-de-lis: the centre petal, two curling side petals, the band.
      p.moveTo(x, y - h);
      p.quadraticCurveTo(x + h * 0.32, y - h * 0.35, x + h * 0.08, y + h * 0.2);
      p.lineTo(x - h * 0.08, y + h * 0.2);
      p.quadraticCurveTo(x - h * 0.32, y - h * 0.35, x, y - h);
      p.closePath();
      for (const sg of [-1, 1]) {
        p.moveTo(x + sg * h * 0.08, y + h * 0.15);
        p.quadraticCurveTo(x + sg * h * 0.95, y - h * 0.55, x + sg * h * 0.85, y + h * 0.2);
        p.quadraticCurveTo(x + sg * h * 0.55, y - h * 0.05, x + sg * h * 0.1, y + h * 0.4);
        p.closePath();
      }
      p.rect(x - h * 0.45, y + h * 0.22, h * 0.9, h * 0.2);
      p.moveTo(x - h * 0.12, y + h * 0.42);
      p.lineTo(x + h * 0.12, y + h * 0.42);
      p.lineTo(x, y + h);
      p.closePath();
      break;
    }
  }
}

/** The field strewn (semé) with a motif, in rows offset like brickwork. Skipped when tiny. */
function semy(st: St, m: Motif, t: Tincture, x0: number, y0: number, x1: number, y1: number): void {
  if (st.lod === 0) return;
  const ctx = st.ctx;
  const sp = 12.5;
  const s = 5.2;
  const p = new Path2D();
  let row = 0;
  for (let y = y0 + sp * 0.4; y < y1 + sp; y += sp * 0.87, row++) {
    for (let x = (row % 2 ? sp / 2 : 0) + Math.floor((x0 - sp) / sp) * sp; x < x1 + sp; x += sp) motif(p, m, x, y, s);
  }
  if (st.lod >= 2) {
    ctx.lineWidth = 1.4 / st.ppu;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.55;
    ctx.stroke(p);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = fieldFill(st, t);
  ctx.fill(p, 'nonzero');
}

// ---- the coat --------------------------------------------------------------------------------

/**
 * Paint `coat` centred on (cx, cy), `size` tall (ctx units), in the given shape. A heater's crest
 * crown (if any) rises CREST_RISE x size above the top edge; leave room for it or pass crest: false.
 */
export function drawCoat(ctx: CanvasRenderingContext2D, coat: Coat, cx: number, cy: number, size: number, opts: CoatOpts = {}): void {
  const shape = opts.shape ?? 'heater';
  const aspect = shape === 'heater' ? HEATER_ASPECT : shape === 'kite' ? KITE_ASPECT : (opts.aspect ?? 1.25);
  const W = aspect * 100;
  let px = opts.px;
  if (px === undefined) {
    const m = ctx.getTransform();
    px = size * Math.hypot(m.a, m.b);
  }
  const lod = opts.lod ?? lodFor(px);
  const st: St = { ctx, ppu: px / 100, lod, W, grads: new Map() };
  const openFly = shape === 'banner' && opts.openFly === true;
  const mirror = opts.mirror === true;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 100, size / 100);
  if (mirror) ctx.scale(-1, 1);
  ctx.lineJoin = 'round';

  const outer = outline(shape, W, 0, false);
  const outerPath = toPath(outer);
  const sep = lod === 0 ? 0 : (lod === 1 ? 0.8 : Math.min(1.8, 0.7 + px * 0.004)) / st.ppu;

  // Bordure width and the inner field.
  const bord = coat.bordure;
  const b = bord ? (lod === 0 ? 9 : 10.5) : 0;
  const inner = b > 0 ? outline(shape, W, b, openFly) : outer;
  const innerPath = b > 0 ? toPath(inner) : outerPath;
  let ix0 = Infinity;
  let ix1 = -Infinity;
  let iy0 = Infinity;
  let iy1 = -Infinity;
  for (let i = 0; i < inner.length; i += 2) {
    ix0 = Math.min(ix0, inner[i]!);
    ix1 = Math.max(ix1, inner[i]!);
    iy0 = Math.min(iy0, inner[i + 1]!);
    iy1 = Math.max(iy1, inner[i + 1]!);
  }
  const iw = ix1 - ix0;
  const ih = iy1 - iy0;

  ctx.save();
  ctx.clip(outerPath);
  // Bordure: the whole shape in its tincture; the field is painted inside.
  if (bord) {
    ctx.fillStyle = fieldFill(st, bord.field);
    ctx.fill(outerPath);
    if (bord.diaper) {
      ctx.save();
      diaper(st, bord.field, -W / 2, -50, W / 2, 50);
      ctx.restore();
    }
  }
  ctx.save();
  ctx.clip(innerPath);
  ctx.fillStyle = fieldFill(st, coat.field);
  ctx.fillRect(-W / 2 - 1, -51, W + 2, 102);
  if (coat.diaper) diaper(st, coat.field, ix0, iy0, ix1, iy1);
  if (coat.semy) semy(st, coat.semy, coat.semyTincture, ix0, iy0, ix1, iy1);

  // Chief, cantons and base.
  const chief = coat.chief;
  const base = coat.base;
  const chiefH = chief ? ih * (lod === 0 ? 0.24 : 0.26) : 0;
  const baseH = base ? ih * (shape === 'heater' ? 0.25 : shape === 'kite' ? 0.22 : 0.2) : 0;
  const yc = iy0 + chiefH;
  const yb = iy1 - baseH;
  const chiefAmp = chief ? lineAmp(chief.line, lod) : 0;
  const baseAmp = base ? lineAmp(base.line, lod) : 0;
  const seps = new Path2D();
  if (base) {
    const p = new Path2D();
    edge(p, ix0 - 2, ix1 + 2, yb, base.line, -1, lod, true);
    p.lineTo(ix1 + 2, 52);
    p.lineTo(ix0 - 2, 52);
    p.closePath();
    ctx.fillStyle = fieldFill(st, base.field);
    ctx.fill(p);
    if (base.diaper) regionDiaper(st, p, base.field, ix0, yb - baseAmp, ix1, iy1);
    edge(seps, ix0 - 2, ix1 + 2, yb, base.line, -1, lod, true);
  }
  if (chief) {
    const p = new Path2D();
    p.moveTo(ix0 - 2, -52);
    p.lineTo(ix1 + 2, -52);
    p.lineTo(ix1 + 2, yc);
    edge(p, ix1 + 2, ix0 - 2, yc, chief.line, 1, lod, false);
    p.closePath();
    ctx.fillStyle = fieldFill(st, chief.field);
    ctx.fill(p);
    if (chief.diaper) regionDiaper(st, p, chief.field, ix0, iy0, ix1, yc + chiefAmp);
    edge(seps, ix0 - 2, ix1 + 2, yc, chief.line, 1, lod, true);
  }
  const cw = iw / 3;
  const cantonBottom = yc + chiefAmp / 2 + (chiefAmp > 0 ? 0.6 : 0);
  const cantons: [CoatRegion | null, number][] = [
    [coat.canton, ix0],
    [coat.canton2, ix1 - cw],
  ];
  for (const [r, x] of cantons) {
    if (!r) continue;
    const p = new Path2D();
    p.rect(x - (x === ix0 ? 2 : 0), -52, cw + 2, cantonBottom + 52);
    ctx.fillStyle = fieldFill(st, r.field);
    ctx.fill(p);
    if (r.diaper) regionDiaper(st, p, r.field, x, iy0, x + cw, cantonBottom);
    const inX = x === ix0 ? x + cw : x;
    seps.moveTo(inX, -52);
    seps.lineTo(inX, cantonBottom);
    seps.moveTo(x === ix0 ? ix0 - 2 : x, cantonBottom);
    seps.lineTo(x === ix0 ? x + cw : ix1 + 2, cantonBottom);
  }
  if (sep > 0 && (chief || base)) {
    ctx.lineWidth = sep;
    ctx.strokeStyle = INK;
    ctx.stroke(seps);
  }

  // The principal area between the chief and the base.
  const top = chief ? cantonBottom + chiefAmp / 2 : iy0;
  const bot = base ? yb - baseAmp / 2 : iy1;
  let pcx = 0;
  let availW = iw;
  if (shape === 'banner') {
    const f = opts.focus ?? 0.5;
    pcx = (f - 0.5) * W * (mirror ? -1 : 1);
    pcx = Math.max(ix0 + iw * 0.3, Math.min(ix1 - iw * 0.3, pcx));
    availW = 2 * Math.min(pcx - ix0, ix1 - pcx);
  }
  const areaH = bot - top;
  const fitPoly = inner;
  if (shape === 'heater') {
    const pw = Math.min(iw * 0.84, availW);
    const ph = areaH * (base ? 0.9 : 0.84);
    drawCharge(st, coat.principal, pcx, top + areaH * (base ? 0.5 : 0.46), pw, ph, fitPoly);
  } else if (shape === 'kite') {
    drawCharge(st, coat.principal, pcx, top + areaH * (base ? 0.5 : 0.42), iw * 0.86, areaH * (base ? 0.88 : 0.7), fitPoly);
  } else {
    drawCharge(st, coat.principal, pcx, top + areaH * 0.5, availW * 0.86, areaH * 0.86);
  }

  // Charges in the chief, the cantons and the base.
  if (chief) {
    const cx0 = coat.canton ? ix0 + cw : ix0;
    const cx1 = coat.canton2 ? ix1 - cw : ix1;
    const n = chief.count;
    const hh = (yc - iy0) * 0.78;
    const slot = (cx1 - cx0) / n;
    for (let i = 0; i < n; i++) drawCharge(st, chief.charge, cx0 + slot * (i + 0.5), iy0 + (yc - iy0 - chiefAmp * 0.3) / 2, Math.min(slot * 0.86, hh * 1.3), hh);
  }
  for (const [r, x] of cantons) {
    if (!r) continue;
    const hh = (cantonBottom - iy0) * 0.76;
    drawCharge(st, r.charge, x + cw / 2, iy0 + (cantonBottom - iy0) / 2, cw * 0.82, hh);
  }
  if (base) {
    const n = shape === 'heater' || shape === 'kite' ? Math.min(base.count, 1) : base.count;
    const bh = (iy1 - yb) * 0.66;
    if (shape === 'banner') {
      const slot = iw / n;
      for (let i = 0; i < n; i++) drawCharge(st, base.charge, ix0 + slot * (i + 0.5), yb + baseAmp * 0.25 + (iy1 - yb) / 2, slot * 0.8, bh);
    } else {
      drawCharge(st, base.charge, 0, yb + baseAmp * 0.3 + (iy1 - yb) * 0.36, iw * 0.4, bh * 0.82, inner);
    }
  }
  ctx.restore(); // inner clip

  // Bordure charges and its inner edge.
  if (bord) {
    if (sep > 0) {
      ctx.lineWidth = sep;
      ctx.strokeStyle = INK;
      ctx.stroke(innerPath);
    }
    const mid = outline(shape, W, b / 2, openFly);
    let pts: number[];
    if (openFly) {
      const x0 = -W / 2 + b / 2;
      const line = [W / 2, -50 + b / 2, x0, -50 + b / 2, x0, 50 - b / 2, W / 2, 50 - b / 2];
      pts = along(line, false, 8, 0.5);
    } else {
      // Start at the bottom middle so the arrangement is symmetric.
      const m = mid.length / 2;
      let lo = 0;
      for (let i = 1; i < m; i++) if (mid[i * 2 + 1]! > mid[lo * 2 + 1]! + 1e-6 || (Math.abs(mid[i * 2 + 1]! - mid[lo * 2 + 1]!) < 1e-6 && Math.abs(mid[i * 2]!) < Math.abs(mid[lo * 2]!))) lo = i;
      const rot = mid.slice(lo * 2).concat(mid.slice(0, lo * 2));
      pts = along(rot, true, 8, shape === 'banner' ? 0.5 : 0);
    }
    const s = b * 0.78;
    for (let i = 0; i < pts.length; i += 2) drawCharge(st, bord.charge, pts[i]!, pts[i + 1]!, s, s);
  }

  if (opts.finish !== false) finish(st, shape, outerPath);
  ctx.restore(); // outer clip

  if (opts.finish !== false && shape === 'heater') {
    // The rim: a dark edge and a thin gilt line inside it.
    const rim = lod === 0 ? 0.8 : lod === 1 ? 1.2 : Math.min(4.5, 1.4 + px * 0.011);
    ctx.lineWidth = rim / st.ppu;
    ctx.strokeStyle = INK;
    ctx.stroke(outerPath);
    if (lod >= 1) {
      const gilt = toPath(outline(shape, W, rim / st.ppu * 0.9, false));
      ctx.lineWidth = Math.max(0.6, rim * 0.35) / st.ppu;
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = sheen(ctx, 'or', -W / 2, -50, W / 2, 50);
      ctx.stroke(gilt);
      ctx.globalAlpha = 1;
    }
  }
  if (shape === 'heater' && coat.crest > 0 && opts.crest !== false) {
    // Mirroring would flip nothing useful on a crown; draw it in the same frame.
    const c: CoatCharge = { kind: 'crown', tincture: 'or', detail: 'gules', rank: coat.crest === 1 ? 1 : 2 };
    const h = CREST_RISE * 100 + 4;
    drawCharge(st, c, 0, -50 - h / 2 + 4, W * 0.66, h);
  }
  ctx.restore();
}

function regionDiaper(st: St, clip: Path2D, t: Tincture, x0: number, y0: number, x1: number, y1: number): void {
  if (st.lod < 2) return;
  st.ctx.save();
  st.ctx.clip(clip);
  diaper(st, t, x0, y0, x1, y1);
  st.ctx.restore();
}

/** Painted finish: a gentle sheen, a soft highlight, and at full detail a faint texture. */
function finish(st: St, shape: CoatShape, outerPath: Path2D): void {
  const ctx = st.ctx;
  const W = st.W;
  const g = ctx.createLinearGradient(-W / 2, -50, W / 2, 50);
  const k = shape === 'banner' ? 0.6 : 1;
  g.addColorStop(0, `rgba(255,248,225,${0.2 * k})`);
  g.addColorStop(0.38, 'rgba(255,248,225,0)');
  g.addColorStop(0.62, 'rgba(20,8,10,0)');
  g.addColorStop(1, `rgba(20,8,10,${0.3 * k})`);
  ctx.fillStyle = g;
  ctx.fill(outerPath);
  if (st.lod === 0) return;
  const r = ctx.createRadialGradient(-W * 0.18, -30, 2, -W * 0.18, -30, 55);
  r.addColorStop(0, `rgba(255,250,235,${0.14 * k})`);
  r.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = r;
  ctx.fill(outerPath);
  if (st.lod < 2) return;
  // Texture: brushed metal (shields) or a woven grain (banners), a whisper of it.
  const tex = new Path2D();
  if (shape === 'banner') {
    for (let y = -50; y < 50; y += 1.6) {
      tex.moveTo(-W / 2, y);
      tex.lineTo(W / 2, y);
    }
    for (let x = -W / 2; x < W / 2; x += 1.6) {
      tex.moveTo(x, -50);
      tex.lineTo(x, 50);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  } else {
    for (let i = 0; i < 70; i++) {
      const y = -50 + ((i * 37.3) % 100);
      const x = -W / 2 + ((i * 53.7) % W);
      tex.moveTo(x, y);
      tex.lineTo(x + 6 + (i % 5) * 3, y - 1.2 - (i % 3) * 0.6);
    }
    ctx.strokeStyle = 'rgba(255,245,220,0.07)';
  }
  ctx.lineWidth = 0.5 / st.ppu;
  ctx.stroke(tex);
}

/** The painted color of a tincture (for UI accents, plumes, trims). */
export function tinctureColor(t: Tincture): string {
  return PAINT[t].base;
}
