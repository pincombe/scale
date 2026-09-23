// The lancer's lance, drawn live over its baked sprite (so it can sweep from upright to couched
// without a frame per angle): a tapering ash shaft with a vamplate at the grip, a steel head, a lit
// edge on the sunward side, and a swallowtail pennon in the army's colors that streams with the
// wind and the gallop. Figure units, in the knight's own transform. Allocation-free.

/** Shaft ahead of the grip and behind it (figure units). */
export const LANCE_FWD = 152;
const LANCE_BACK = 30;

export interface LanceColors {
  sil: string;
  rim: string;
  field: string;
  fieldLit: string;
  fieldShade: string;
  trim: string;
}

/**
 * Draw one lance. (gx, gy): the grip (figure units); a: its angle (0 = +x, -PI/2 = up);
 * (lx, ly): the light direction in figure space; stream: where the pennon blows (+1 toward +x,
 * -1 toward -x; magnitude 0..1.5 = how hard); t: time (s) for the flutter; minW: thinnest stroke.
 */
export function drawLance(g: CanvasRenderingContext2D, gx: number, gy: number, a: number, lx: number, ly: number, stream: number, t: number, phase: number, minW: number, c: LanceColors, pennon: boolean): void {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const px = -dy;
  const py = dx;
  const bx = gx - dx * LANCE_BACK;
  const by = gy - dy * LANCE_BACK;
  const tx = gx + dx * LANCE_FWD;
  const ty = gy + dy * LANCE_FWD;
  const w0 = Math.max(3.4, minW * 1.1);
  const w1 = Math.max(1.6, minW * 0.8);
  // Shaft (tapered quad), silhouette.
  g.fillStyle = c.sil;
  g.beginPath();
  g.moveTo(bx + px * w0 * 0.5, by + py * w0 * 0.5);
  g.lineTo(tx - dx * 10 + px * w1 * 0.5, ty - dy * 10 + py * w1 * 0.5);
  g.lineTo(tx - dx * 10 - px * w1 * 0.5, ty - dy * 10 - py * w1 * 0.5);
  g.lineTo(bx - px * w0 * 0.5, by - py * w0 * 0.5);
  g.closePath();
  g.fill();
  // Head: a slim leaf.
  g.beginPath();
  g.moveTo(tx, ty);
  g.lineTo(tx - dx * 12 + px * 2.6, ty - dy * 12 + py * 2.6);
  g.lineTo(tx - dx * 15, ty - dy * 15);
  g.lineTo(tx - dx * 12 - px * 2.6, ty - dy * 12 - py * 2.6);
  g.closePath();
  g.fill();
  // Vamplate: the cone guarding the hand.
  g.beginPath();
  g.moveTo(gx + dx * 16 + px * 1.8, gy + dy * 16 + py * 1.8);
  g.lineTo(gx + dx * 3 + px * 7, gy + dy * 3 + py * 7);
  g.lineTo(gx + dx * 3 - px * 7, gy + dy * 3 - py * 7);
  g.lineTo(gx + dx * 16 - px * 1.8, gy + dy * 16 - py * 1.8);
  g.closePath();
  g.fill();
  // Lit edge on the side facing the light.
  const side = px * lx + py * ly >= 0 ? 1 : -1;
  g.strokeStyle = c.rim;
  g.lineWidth = Math.max(0.9, minW * 0.55);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(gx + dx * 18 + px * side * w0 * 0.4, gy + dy * 18 + py * side * w0 * 0.4);
  g.lineTo(tx - dx * 2 + px * side * 1.2, ty - dy * 2 + py * side * 1.2);
  g.stroke();
  if (!pennon) return;

  // Pennon: hoisted just below the head, streaming downwind; a gentle travelling wave.
  const h0x = tx - dx * 17;
  const h0y = ty - dy * 17;
  const h1x = tx - dx * 29;
  const h1y = ty - dy * 29;
  // Stream direction: along -shaft when couched (the air flows back along it), else the wind.
  const s = Math.max(-1.6, Math.min(1.6, stream));
  let fx = s;
  let fy = 0.28;
  // Blend toward "back along the shaft" when the shaft is near level (couched at the gallop).
  const level = 1 - Math.min(1, Math.abs(dy) * 1.6);
  fx = fx * (1 - level) - dx * level * Math.abs(s);
  fy = fy * (1 - level) - dy * level * Math.abs(s) + 0.2 * level;
  const fl = Math.sqrt(fx * fx + fy * fy) || 1;
  fx /= fl;
  fy /= fl;
  const len = 34 + 6 * Math.min(1, Math.abs(s));
  const nX = -fy;
  const nY = fx;
  const w = 7 * Math.sin(t * 9 + phase);
  const w2 = 5 * Math.sin(t * 9 + phase - 1.4);
  // Body (the hoist edge spans h0..h1; the fly end is notched).
  const m1x = (h0x + h1x) * 0.5 + fx * len * 0.5 + nX * w * 0.3;
  const m1y = (h0y + h1y) * 0.5 + fy * len * 0.5 + nY * w * 0.3;
  const e0x = h0x + fx * len + nX * w2 * 0.5;
  const e0y = h0y + fy * len + nY * w2 * 0.5;
  const e1x = h1x + fx * len * 0.92 + nX * w2 * 0.5;
  const e1y = h1y + fy * len * 0.92 + nY * w2 * 0.5;
  const nkx = (h0x + h1x) * 0.5 + fx * len * 0.7 + nX * w2 * 0.4;
  const nky = (h0y + h1y) * 0.5 + fy * len * 0.7 + nY * w2 * 0.4;
  g.fillStyle = w > 2 ? c.fieldLit : w < -2 ? c.fieldShade : c.field;
  g.beginPath();
  g.moveTo(h0x, h0y);
  g.quadraticCurveTo(m1x - (h1x - h0x) * 0.5, m1y - (h1y - h0y) * 0.5, e0x, e0y);
  g.lineTo(nkx, nky);
  g.lineTo(e1x, e1y);
  g.quadraticCurveTo(m1x + (h1x - h0x) * 0.5, m1y + (h1y - h0y) * 0.5, h1x, h1y);
  g.closePath();
  g.fill();
  // A gilt stripe down its middle.
  g.strokeStyle = c.trim;
  g.lineWidth = Math.max(0.8, minW * 0.5);
  g.beginPath();
  g.moveTo((h0x + h1x) * 0.5, (h0y + h1y) * 0.5);
  g.quadraticCurveTo(m1x, m1y, nkx, nky);
  g.stroke();
}
