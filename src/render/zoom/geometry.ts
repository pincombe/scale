// The zoom's geometry (pure, tested): where the camera and the meadow snapshot are at every moment.
//
// The colossus is the fused army: `ratio` (= zoomBegin.height / 1.8) times the crowd's hero. In the
// old tier it stands where the hero stood, `ratio` times too big; in the new tier it IS the hero.
//
// Flash framing (old tier): the camera the rally and fusion ease into, and the one the snapshot is
// taken with. Both boots span the stage (BOOTS_FILL of its width), the ground line where the in-tier
// director keeps it, so the moment the colossus appears its armored boots fill the screen. A mighty
// colossus (big ratio) means a wide meadow shot; a small one, a close one.
//
// Pull-back (new tier): one continuous zoom-out, interpolated in log space, from that framing (the
// camera jumps to the new tier's equivalent at the switch: same screen, zoom x ratio) to the
// in-tier director's framing, where the colossus is the hero at its base size. The colossus's
// root glides on screen from its flash spot to the hero's spot. Both boots filling the screen and
// the hero at 29% of the stage fix that zoom at ~15x, whatever the ratio.
//
// The meadow (the snapshot) first shrinks with the colossus, so it still stands in the meadow; then
// (`shrink` window) it shrinks faster, and (`drift` window) glides from under the boots into its
// scale on the hide, the new tier's ground: at the end it sits exactly in that scale. Its log scale
// is the colossus's plus an eased extra, so the whole motion stays one smooth exponential.
import { KNIGHT_HEIGHT } from '../world';

/** The crowd's hero is this much taller than a knight (mirrors crowd/hero.ts HERO_SCALE). */
export const COLOSSUS_SCALE = 1.1;
/** Meters per figure unit for the hero, which the colossus becomes (a knight is 100 units tall). */
export const HERO_UNIT = (KNIGHT_HEIGHT / 100) * COLOSSUS_SCALE;
/** The crowd's hero stands this far below the ground line (mirrors crowd/hero.ts Hero.y). */
export const HERO_Y = 0.12;
/** Both boots in the guard pose, from the back heel to the front toe (figure units from the root). */
export const BOOTS_X0 = -15.5;
export const BOOTS_X1 = 23.5;
/** Fraction of the stage width the boots span at the flash. */
export const BOOTS_FILL = 1.06;
/** The flash framing never pulls back further than this from the old tier's base framing (the
 *  backdrop is built to hold ~13x). */
export const MAX_FLASH_PULL = 12;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface FlashFraming {
  /** Old-tier CSS px per meter. */
  zoom: number;
  /** Camera center (old-tier world m). */
  x: number;
  y: number;
  /** The colossus's root (the hero's feet) on screen, CSS px. */
  rootSX: number;
  rootSY: number;
}

export function flashFraming(): FlashFraming {
  return { zoom: 1, x: 0, y: 0, rootSX: 0, rootSY: 0 };
}

/**
 * The old tier's camera at the flash. `heroX`: the hero's root x (old-tier m); `ratio`: colossus /
 * hero; `groundFrac`: the ground line's screen fraction; `baseZoom`: the old tier's base framing
 * zoom (the closest the camera may be). Writes and returns `out`.
 */
export function computeFlashFraming(
  stageW: number,
  stageH: number,
  stageCX: number,
  stageCY: number,
  heroX: number,
  ratio: number,
  groundFrac: number,
  baseZoom: number,
  out: FlashFraming,
): FlashFraming {
  const unit = HERO_UNIT * Math.max(1, ratio);
  const z = clamp((BOOTS_FILL * stageW) / ((BOOTS_X1 - BOOTS_X0) * unit), baseZoom / MAX_FLASH_PULL, baseZoom);
  const rootSX = stageCX - ((BOOTS_X0 + BOOTS_X1) / 2) * unit * z;
  const groundSY = groundFrac * stageH;
  out.zoom = z;
  out.rootSX = rootSX;
  out.rootSY = groundSY + HERO_Y * z;
  out.x = heroX - (rootSX - stageCX) / z;
  out.y = -(groundSY - stageCY) / z;
  return out;
}

/**
 * The pull-back at log-zoom progress e (0..1): camera, the colossus's root on screen, and the
 * snapshot's rect. Set the inputs (all public), then call at(e); outputs are fields. Allocation-free.
 */
export class PullBack {
  // ---- inputs ----
  /** The snapshot's size (CSS px): the view at the switch. */
  snapW = 1;
  snapH = 1;
  /** Stage center now (CSS px). */
  stageCX = 0;
  stageCY = 0;
  /** The colossus's root (new-tier world m): the hero's feet. */
  rootX = 0;
  rootY = HERO_Y;
  /** Start (the flash, converted to the new tier): the root on screen and the zoom. */
  sx0 = 0;
  sy0 = 0;
  z0 = 1;
  /** End (the in-tier director's framing): the root on screen and the zoom. */
  sxe = 0;
  sye = 0;
  ze = 1;
  /**
   * Where the snapshot ends (new-tier world m): its top-left and width. The cinematic places it in
   * its scale on the hide so the meadow's horizon shows in the scale's exposed face.
   */
  ex = 0;
  ey = 0;
  ew = 1;
  /** The meadow's extra shrink (beyond the colossus's) eases in over e in [shrink0, shrink1]... */
  shrink0 = 0.35;
  shrink1 = 1;
  /** ...and it glides from under the boots to its scale over [drift0, drift1]. */
  drift0 = 0.45;
  drift1 = 1;

  // ---- outputs ----
  /** Camera: CSS px per meter and center (new-tier world m). */
  zoom = 1;
  camX = 0;
  camY = 0;
  /** The root on screen (CSS px). */
  rootSX = 0;
  rootSY = 0;
  /** The colossus's scale relative to the flash (1 -> z_end / z_start). */
  scale = 1;
  /** Snapshot rect: top-left (CSS px) and scale (its size is k x (snapW, snapH)). */
  k = 1;
  ax = 0;
  ay = 0;
  /** log2 of the snapshot's width over its final width at the current zoom (0 = it has landed). */
  fit = 0;

  at(e: number): this {
    const u = clamp(e, 0, 1);
    const lz0 = Math.log(this.z0);
    const lze = Math.log(this.ze);
    const lz = lz0 + (lze - lz0) * u;
    const z = Math.exp(lz);
    this.zoom = z;
    this.scale = z / this.z0;
    const rsx = this.sx0 + (this.sxe - this.sx0) * u;
    const rsy = this.sy0 + (this.sye - this.sy0) * u;
    this.rootSX = rsx;
    this.rootSY = rsy;
    this.camX = this.rootX - (rsx - this.stageCX) / z;
    this.camY = this.rootY - (rsy - this.stageCY) / z;

    // The meadow: the colossus's scale, plus an eased extra so it ends as its scale's face.
    const lkEnd = Math.log((this.ew * this.ze) / this.snapW);
    const extra = lkEnd - (lze - lz0);
    const k = Math.exp(lz - lz0 + extra * smoothstep(this.shrink0, this.shrink1, u));
    this.k = k;
    // Scaled about the root (the colossus stands in it), plus the glide into its scale.
    const kEnd = Math.exp(lkEnd);
    const dx = this.sxe + (this.ex - this.rootX) * this.ze - (this.sxe - kEnd * this.sx0);
    const dy = this.sye + (this.ey - this.rootY) * this.ze - (this.sye - kEnd * this.sy0);
    const g = smoothstep(this.drift0, this.drift1, u);
    this.ax = rsx - k * this.sx0 + dx * g;
    this.ay = rsy - k * this.sy0 + dy * g;
    this.fit = Math.log2((k * this.snapW) / (this.ew * z));
    return this;
  }

  /** World (new tier) -> screen at the last at(): writes out. */
  toScreen(wx: number, wy: number, out: { x: number; y: number }): { x: number; y: number } {
    out.x = this.stageCX + (wx - this.camX) * this.zoom;
    out.y = this.stageCY + (wy - this.camY) * this.zoom;
    return out;
  }
}
