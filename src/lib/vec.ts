// Tiny 2D types with out-param helpers. Allocate Vec2/Rect once (module scope or constructor),
// then pass them as `out` every frame. Every helper returns its `out` for chaining.

export interface Vec2 {
  x: number;
  y: number;
}

/** Axis-aligned rectangle: (x, y) is the min corner (top-left, since +y is down). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function rect(x = 0, y = 0, w = 0, h = 0): Rect {
  return { x, y, w, h };
}

export function setVec(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copyVec(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function setRect(out: Rect, x: number, y: number, w: number, h: number): Rect {
  out.x = x;
  out.y = y;
  out.w = w;
  out.h = h;
  return out;
}

export function copyRect(out: Rect, a: Rect): Rect {
  out.x = a.x;
  out.y = a.y;
  out.w = a.w;
  out.h = a.h;
  return out;
}

/** Set out from min/max corners. */
export function rectFromMinMax(out: Rect, x0: number, y0: number, x1: number, y1: number): Rect {
  out.x = Math.min(x0, x1);
  out.y = Math.min(y0, y1);
  out.w = Math.abs(x1 - x0);
  out.h = Math.abs(y1 - y0);
  return out;
}

export function rectRight(r: Rect): number {
  return r.x + r.w;
}

export function rectBottom(r: Rect): number {
  return r.y + r.h;
}

export function rectCenter(r: Rect, out: Vec2): Vec2 {
  out.x = r.x + r.w * 0.5;
  out.y = r.y + r.h * 0.5;
  return out;
}

/** Smallest rect containing a and b (out may alias a or b). */
export function rectUnion(out: Rect, a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  out.x = x0;
  out.y = y0;
  out.w = x1 - x0;
  out.h = y1 - y0;
  return out;
}

/** Grow r in place to include the point (x, y). */
export function rectInclude(r: Rect, x: number, y: number): Rect {
  const x1 = Math.max(r.x + r.w, x);
  const y1 = Math.max(r.y + r.h, y);
  r.x = Math.min(r.x, x);
  r.y = Math.min(r.y, y);
  r.w = x1 - r.x;
  r.h = y1 - r.y;
  return r;
}

/** Expand (or shrink, if m < 0) by m on every side. out may alias r. */
export function rectExpand(out: Rect, r: Rect, m: number): Rect {
  out.x = r.x - m;
  out.y = r.y - m;
  out.w = r.w + 2 * m;
  out.h = r.h + 2 * m;
  return out;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}
