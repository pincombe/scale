// Pen: the vector primitives the charges are drawn with. A charge is built once per (kind, rank,
// level of detail) into Path2Ds in a 100-unit box and cached, so drawing it is only fills.
//
// brush(): a tapered calligraphic stroke along a Catmull-Rom centerline (x, y, half-width per
// knot), the primitive behind every limb, lock of mane, feather and tine: confident, tapering
// shapes rather than sausages. blob(): a closed smooth outline through knots.

/** Scratch sample buffers (bake-time only; grown on demand). */
let SX = new Float64Array(512);
let SY = new Float64Array(512);
let SW = new Float64Array(512);

function ensure(n: number): void {
  if (SX.length >= n) return;
  const m = Math.max(n, SX.length * 2);
  SX = new Float64Array(m);
  SY = new Float64Array(m);
  SW = new Float64Array(m);
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Sample an open Catmull-Rom spline through knots [x, y, w, ...] into SX/SY/SW. Returns the count. */
function sampleOpen(pts: readonly number[], sub: number, bold: number): number {
  const n = pts.length / 3;
  ensure((n - 1) * sub + 2);
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1) * 3;
    const i1 = i * 3;
    const i2 = (i + 1) * 3;
    const i3 = Math.min(n - 1, i + 2) * 3;
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      SX[k] = cr(pts[i0]!, pts[i1]!, pts[i2]!, pts[i3]!, t);
      SY[k] = cr(pts[i0 + 1]!, pts[i1 + 1]!, pts[i2 + 1]!, pts[i3 + 1]!, t);
      SW[k] = Math.max(0, cr(pts[i0 + 2]!, pts[i1 + 2]!, pts[i2 + 2]!, pts[i3 + 2]!, t)) * bold;
      k++;
    }
  }
  SX[k] = pts[(n - 1) * 3]!;
  SY[k] = pts[(n - 1) * 3 + 1]!;
  SW[k] = Math.max(0, pts[(n - 1) * 3 + 2]!) * bold;
  return k + 1;
}

/**
 * A tapered stroke along a smooth centerline through knots [x, y, halfWidth, ...] (>= 2 knots).
 * Ends with a width > 0 get round caps; width 0 tapers to a point. Widths scale by `bold`.
 */
export function brush(p: Path2D, pts: readonly number[], bold = 1, sub = 10): void {
  const m = sampleOpen(pts, sub, bold);
  if (m < 2) return;
  // Left side forward.
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(m - 1, i + 1);
    let tx = SX[b]! - SX[a]!;
    let ty = SY[b]! - SY[a]!;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const x = SX[i]! - ty * SW[i]!;
    const y = SY[i]! + tx * SW[i]!;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
    if (i === m - 1) {
      ax = tx;
      ay = ty;
    }
  }
  const we = SW[m - 1]!;
  if (we > 0.05) {
    const a = Math.atan2(ay, ax);
    p.arc(SX[m - 1]!, SY[m - 1]!, we, a + Math.PI / 2, a - Math.PI / 2, true);
  }
  // Right side back.
  let sx = 0;
  let sy = 0;
  for (let i = m - 1; i >= 0; i--) {
    const a = Math.max(0, i - 1);
    const b = Math.min(m - 1, i + 1);
    let tx = SX[b]! - SX[a]!;
    let ty = SY[b]! - SY[a]!;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    p.lineTo(SX[i]! + ty * SW[i]!, SY[i]! - tx * SW[i]!);
    if (i === 0) {
      sx = tx;
      sy = ty;
    }
  }
  const ws = SW[0]!;
  if (ws > 0.05) {
    const a = Math.atan2(sy, sx);
    p.arc(SX[0]!, SY[0]!, ws, a - Math.PI / 2, a + Math.PI / 2, true);
  }
  p.closePath();
}

/** A closed smooth outline through knots [x, y, x, y, ...] (Catmull-Rom, closed). */
export function blob(p: Path2D, pts: readonly number[], sub = 8): void {
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const i0 = ((i - 1 + n) % n) * 2;
    const i1 = i * 2;
    const i2 = ((i + 1) % n) * 2;
    const i3 = ((i + 2) % n) * 2;
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      const x = cr(pts[i0]!, pts[i1]!, pts[i2]!, pts[i3]!, t);
      const y = cr(pts[i0 + 1]!, pts[i1 + 1]!, pts[i2 + 1]!, pts[i3 + 1]!, t);
      if (i === 0 && s === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    }
  }
  p.closePath();
}

/** An open smooth curve through knots [x, y, ...] (for engraved lines). */
export function curve(p: Path2D, pts: readonly number[], sub = 8): void {
  const n = pts.length / 2;
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(0, i - 1) * 2;
    const i1 = i * 2;
    const i2 = (i + 1) * 2;
    const i3 = Math.min(n - 1, i + 2) * 2;
    for (let s = 1; s <= sub; s++) {
      const t = s / sub;
      p.lineTo(cr(pts[i0]!, pts[i1]!, pts[i2]!, pts[i3]!, t), cr(pts[i0 + 1]!, pts[i1 + 1]!, pts[i2 + 1]!, pts[i3 + 1]!, t));
    }
  }
}

/** A polygon through [x, y, ...]. */
export function poly(p: Path2D, pts: readonly number[]): void {
  p.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i]!, pts[i + 1]!);
  p.closePath();
}

/** A full ellipse as its own closed subpath. */
export function oval(p: Path2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  p.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  p.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  p.closePath();
}
