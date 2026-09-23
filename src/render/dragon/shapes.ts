// Small path builders shared by the dragon painters (paint.ts, parts.ts). Allocation-free.

const TAU = Math.PI * 2;

/** Tapered capsule from (x0, y0, r0) to (x1, y1, r1), clockwise. */
export function capsule(ctx: CanvasRenderingContext2D, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9 || d <= Math.abs(r0 - r1)) {
    const r = r0 > r1 ? r0 : r1;
    const cx = r0 > r1 ? x0 : x1;
    const cy = r0 > r1 ? y0 : y1;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    return;
  }
  const a = Math.atan2(dy, dx);
  const phi = Math.asin((r0 - r1) / d);
  const h = Math.PI * 0.5 + phi;
  ctx.moveTo(x0 + Math.cos(a + h) * r0, y0 + Math.sin(a + h) * r0);
  ctx.arc(x0, y0, r0, a + h, a - h + TAU, false);
  ctx.arc(x1, y1, r1, a - h, a + h, false);
  ctx.closePath();
}
