// Knight sprite sheets: every animation frame of every knight kind, baked (lazily, per level of
// detail) into its own tightly cropped canvas with the rim light painted in.
//
// Rim light: the silhouette is filled with the rim color, then a mid tone and the near-black body
// are painted on top ('source-atop', so they never leave the silhouette) shifted AWAY from the light.
// What stays uncovered is a crisp two-step band of light on exactly the edges that face the sun.
//
// Levels of detail (device px per figure unit): a knight is 100 units tall, so LOD 0 is 440 px
// (a front-rank knight at the director's close base framing on a 2x 900 px display, upscaled at
// most ~1.2x, and ~1.05x once an army nudges the camera back) and LOD 4 is 28 px (pulled back ~16x).
import { context2d, makeCanvas } from '../atlas';
import { mixHex } from '../../lib/color';
import type { Palette } from '../palette';
import { A_BRACE, A_CHEER, A_DOWN, A_FLEE, A_FLUNG, A_GETUP, A_IDLE_A, A_IDLE_B, A_IDLE_C, A_MARCH, A_RAISE, A_STRIKE, L_BACK, L_GALLOP, L_IDLE, L_IDLE_B, L_REAR, L_STRIKE, SHEET_KINDS, buildAnims, type AnimDef, type SheetKind } from './anims';
import { Joints, anchors, drawDetails, drawFigure, figureBounds, solve, type Anchors, type FigureKind, type Pose } from './rig';

export const LOD_SCALE = [4.4, 2.2, 1.1, 0.55, 0.28] as const;
/** LODs at or below this scale are far LODs: thicker rim, lighter mid tone (a far host separates from the hills). */
const FAR_LOD_SCALE = 1.15;
export const LOD_COUNT = LOD_SCALE.length;
/** Bake colors derived from a palette. */
interface Colors {
  rim: string;
  mid: string;
  midFar: string;
  sil: string;
  lx: number;
  ly: number;
}

function colors(): Colors {
  return { rim: '#fff', mid: '#888', midFar: '#888', sil: '#000', lx: 1, ly: 0 };
}

function setColors(c: Colors, p: Palette): void {
  c.rim = p.rim;
  c.mid = mixHex(p.rim, p.silhouette, 0.58);
  c.midFar = mixHex(p.rim, p.silhouette, 0.4);
  c.sil = p.silhouette;
  c.lx = p.light.x;
  c.ly = p.light.y;
}

/** Transparent border around each baked frame (device px). */
const PAD = 2;
/** Sprite memory (bytes) above which the next LOD isn't baked ahead, and the hard ceiling. */
const LOOKAHEAD_BUDGET = 42 * 1048576;
const MEMORY_CEILING = 61 * 1048576;

export interface Frame {
  kind: SheetKind;
  mirror: boolean;
  /** Bounds in figure units (after mirroring). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Anchors in figure units (after mirroring). */
  anchor: Anchors;
  /** Baked canvas per LOD (null until first needed). */
  canv: (HTMLCanvasElement | null)[];
  /** Destination rect in figure units per LOD (canvas incl. padding): x, y, w, h. */
  dest: Float32Array;
  /** Pre-baked for the next tier's palette (KnightSheets.prepare), swapped in by setPalette. */
  next: (HTMLCanvasElement | null)[];
  nextDest: Float32Array;
  poseIndex: number;
  anim: number;
  /**
   * Pixel density at LOD 0 relative to LOD_SCALE (1 for most knight poses). A lancer is three
   * knights' worth of pixels but stands in the 0.8-scale back rows, and the rare poses (flung,
   * fleeing) are always in motion, so those bake lighter to keep sprite memory within budget; LOD 1
   * a little lighter too, the smaller LODs at full density.
   */
  res: number;
}

export interface AnimSet {
  defs: AnimDef[];
  /** First frame index (into KnightSheets.frames) per animation. */
  first: number[];
}

/** Pick the level of detail for a given device-px-per-figure-unit scale. */
export function lodFor(pxPerUnit: number): number {
  for (let l = LOD_COUNT - 1; l >= 0; l--) if (LOD_SCALE[l]! >= pxPerUnit * 0.92) return l;
  return 0;
}

/**
 * The LOD to use with hysteresis: a finer LOD is taken as soon as the camera needs it; a coarser
 * one only once the camera is 12% past that threshold, so a camera hovering at a boundary (or a
 * zoom punch) never flips LODs back and forth.
 */
export function lodSticky(pxPerUnit: number, cur: number): number {
  const want = lodFor(pxPerUnit);
  if (cur < 0 || want <= cur) return want;
  return Math.max(cur, lodFor(pxPerUnit * 1.12));
}

export class KnightSheets {
  readonly frames: Frame[] = [];
  readonly sets: AnimSet[] = [];
  private palette: Palette | null = null;
  /** The bake colors for the current palette, and for the one being prepared. */
  private readonly cc: Colors = colors();
  private readonly nc: Colors = colors();
  /** The palette being pre-baked (prepare), its bytes per LOD and its bake cursor per LOD. */
  private nextPal: Palette | null = null;
  private readonly nextLodBytes = new Float64Array(LOD_COUNT);
  private readonly nextWarm = new Array<number>(LOD_COUNT).fill(0);
  private readonly j = new Joints();
  /** Prewarm cursor per LOD. */
  private readonly warm = new Array<number>(LOD_COUNT).fill(0);
  /** Whether any canvas is held per LOD, and when each LOD was last on screen (wall s). */
  private readonly held = new Uint8Array(LOD_COUNT);
  /** Bytes held per LOD. */
  private readonly lodBytes = new Float64Array(LOD_COUNT);
  private readonly lastUse = new Float64Array(LOD_COUNT);
  private scratch: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;

  constructor() {
    const b = { x0: 0, y0: 0, x1: 0, y1: 0 };
    for (let k = 0; k < SHEET_KINDS.length; k++) {
      const kind = SHEET_KINDS[k]!;
      const defs = buildAnims(kind);
      const first: number[] = [];
      const fk: FigureKind = kind;
      for (let a = 0; a < defs.length; a++) {
        const def = defs[a]!;
        first.push(this.frames.length);
        for (let i = 0; i < def.poses.length; i++) {
          const pose = def.poses[i]!;
          solve(pose, this.j);
          figureBounds(fk, pose, this.j, b);
          const an = anchors(fk, pose, this.j, { tipX: 0, tipY: 0, poleX: 0, poleY: 0, poleA: 0, launchX: 0, launchY: 0, aim: 0 });
          let { x0, x1 } = b;
          if (def.mirror) {
            const t = x0;
            x0 = -x1;
            x1 = -t;
            an.tipX = -an.tipX;
            an.poleX = -an.poleX;
            an.launchX = -an.launchX;
            an.poleA = Math.PI - an.poleA;
            an.aim = Math.PI - an.aim;
          }
          this.frames.push({
            kind,
            mirror: def.mirror,
            x0,
            y0: b.y0,
            x1,
            y1: b.y1,
            anchor: an,
            canv: new Array<HTMLCanvasElement | null>(LOD_COUNT).fill(null),
            dest: new Float32Array(LOD_COUNT * 4),
            next: new Array<HTMLCanvasElement | null>(LOD_COUNT).fill(null),
            nextDest: new Float32Array(LOD_COUNT * 4),
            poseIndex: i,
            anim: a,
            res: kind === 'lancer' ? LANCER_RES[a] ?? 0.7 : a === A_FLUNG || a === A_DOWN || a === A_GETUP || a === A_FLEE ? RARE_RES : 1,
          });
        }
      }
      this.sets.push({ defs, first });
    }
  }

  /** Adopt a palette; drops every baked canvas if the colors or light changed. */
  setPalette(p: Palette): void {
    if (this.palette === p) return;
    const same = this.palette && this.palette.rim === p.rim && this.palette.silhouette === p.silhouette && this.palette.light.x === p.light.x && this.palette.light.y === p.light.y;
    const prepared = p === this.nextPal;
    this.palette = p;
    setColors(this.cc, p);
    if (prepared && !same) {
      // The zoom's switch: the new tier's frames were baked ahead (prepare): swap them in at once.
      for (let l = 0; l < LOD_COUNT; l++) this.release(l);
      for (const f of this.frames) {
        for (let l = 0; l < LOD_COUNT; l++) {
          const c = f.next[l];
          if (!c) continue;
          f.canv[l] = c;
          f.next[l] = null;
          for (let q = 0; q < 4; q++) f.dest[l * 4 + q] = f.nextDest[l * 4 + q]!;
          this.held[l] = 1;
        }
      }
      for (let l = 0; l < LOD_COUNT; l++) this.lodBytes[l] = this.nextLodBytes[l]!;
      this.nextLodBytes.fill(0);
      this.nextPal = null;
      return;
    }
    this.dropNext();
    if (!same) {
      // A new tier's light: free every baked canvas now (zero-size first, so the backing stores go
      // at once rather than at the next GC) and re-bake lazily in the new colors.
      for (let l = 0; l < LOD_COUNT; l++) this.release(l);
    }
  }

  /** Free every canvas of one LOD now (zero-size first, so the backing store goes at once). */
  private release(l: number): void {
    for (const f of this.frames) {
      const c = f.canv[l];
      if (!c) continue;
      this.lodBytes[l] = this.lodBytes[l]! - c.width * c.height * 4;
      c.width = 0;
      c.height = 0;
      f.canv[l] = null;
    }
    this.lodBytes[l] = 0;
    this.held[l] = 0;
    this.warm[l] = 0;
  }

  /**
   * Start pre-baking for another palette (the next tier's, from the zoom's rally): prepareStep()
   * bakes its common frames a little per frame; setPalette(p) then swaps them in instantly.
   */
  prepare(p: Palette): void {
    if (p === this.nextPal) return;
    this.dropNext();
    if (p === this.palette) return;
    this.nextPal = p;
    setColors(this.nc, p);
  }

  /** Bake some of the prepared palette's common frames at `lod` for the kinds in the mask. */
  prepareStep(lod: number, kindsMask: number, budgetMs: number): boolean {
    if (!this.nextPal) return true;
    const t0 = performance.now();
    const total = WARM_LEN * SHEET_KINDS.length;
    let cur = this.nextWarm[lod]!;
    while (cur < total) {
      const k = cur % SHEET_KINDS.length;
      const order = WARM_ORDER[k]!;
      const wi = (cur / SHEET_KINDS.length) | 0;
      const a = wi < order.length ? order[wi]! : -1;
      if (a >= 0 && kindsMask & (1 << k)) {
        const set = this.sets[k]!;
        const n = set.defs[a]!.poses.length;
        for (let i = 0; i < n; i++) {
          const f = this.frames[set.first[a]! + i]!;
          if (f.next[lod]) continue;
          // Within budget, and never past the memory ceiling while both palettes coexist.
          if (performance.now() - t0 > budgetMs || this.bytes + this.nextBytes > MEMORY_CEILING - 4 * 1048576) {
            this.nextWarm[lod] = cur;
            return false;
          }
          this.bake(f, lod, true);
        }
      }
      cur++;
    }
    this.nextWarm[lod] = total;
    return true;
  }

  /** Bytes held by the prepared palette's frames. */
  get nextBytes(): number {
    let n = 0;
    for (let l = 0; l < LOD_COUNT; l++) n += this.nextLodBytes[l]!;
    return n;
  }

  private dropNext(): void {
    if (!this.nextPal) return;
    for (const f of this.frames) {
      for (let l = 0; l < LOD_COUNT; l++) {
        const c = f.next[l];
        if (!c) continue;
        c.width = 0;
        c.height = 0;
        f.next[l] = null;
      }
    }
    this.nextLodBytes.fill(0);
    this.nextWarm.fill(0);
    this.nextPal = null;
  }

  /** Bytes held by baked canvases, all LODs (tracked, O(1)). */
  get bytes(): number {
    let n = 0;
    for (let l = 0; l < LOD_COUNT; l++) n += this.lodBytes[l]!;
    return n;
  }

  frameIndex(kind: number, anim: number, i: number): number {
    return this.sets[kind]!.first[anim]! + i;
  }

  /** The canvas for frame `fi` at `lod`, baking it on first use. */
  canvas(fi: number, lod: number): HTMLCanvasElement {
    const f = this.frames[fi]!;
    const c = f.canv[lod];
    if (c) return c;
    this.held[lod] = 1;
    return this.bake(f, lod);
  }

  /** Mark a LOD as in use at wall time `t` (seconds). */
  touch(lod: number, t: number): void {
    this.lastUse[lod] = t;
  }

  /**
   * Release every LOD not used for `idle` seconds: sprite memory follows the camera instead of
   * accumulating (the biggest LOD is only needed while the dragons are small).
   */
  evict(t: number, idle: number, keep = -1): void {
    for (let l = 0; l < LOD_COUNT; l++) {
      if (!this.held[l] || t - this.lastUse[l]! < idle) continue;
      this.release(l);
    }
    // Over the ceiling (a pull-back while every pose of the biggest LOD is held): let go of the
    // least recently used LOD that isn't on screen (and hasn't been for a second) right away.
    while (this.bytes + this.nextBytes > MEMORY_CEILING) {
      let lru = -1;
      for (let l = 0; l < LOD_COUNT; l++) {
        if (!this.held[l] || l === keep || t - this.lastUse[l]! < 1) continue;
        if (lru < 0 || this.lastUse[l]! < this.lastUse[lru]!) lru = l;
      }
      if (lru < 0) break;
      this.release(lru);
    }
  }

  /**
   * Bake the common frames ahead of need within a time budget: the LOD on screen, and (while the
   * camera pulls back) the next smaller one, so neither the first swing nor a zoom-out hitches.
   * Rare poses (flung, fleeing, getting up) bake on first use.
   */
  prewarm(lod: number, kindsMask: number, budgetMs: number, lookahead: boolean, lookMask = kindsMask): void {
    const t0 = performance.now();
    if (!this.warmLod1(lod, kindsMask, t0, budgetMs)) return;
    // No lookahead when the LOD on screen already holds a lot (its rare poses baked): the next LOD
    // then bakes on first use, and sprite memory stays within budget through the pull-back.
    if (lookahead && lod + 1 < LOD_COUNT && this.bytes < LOOKAHEAD_BUDGET) this.warmLod1(lod + 1, lookMask, t0, budgetMs);
  }

  /** Returns true when this LOD is fully warm (for the kinds in the mask). */
  private warmLod1(lod: number, kindsMask: number, t0: number, budgetMs: number): boolean {
    const total = WARM_LEN * SHEET_KINDS.length;
    let cur = this.warm[lod]!;
    let complete = true;
    while (cur < total) {
      const k = cur % SHEET_KINDS.length;
      const order = WARM_ORDER[k]!;
      const wi = (cur / SHEET_KINDS.length) | 0;
      const a = wi < order.length ? order[wi]! : -1;
      if (a < 0) {
        // This kind's list is shorter: nothing to bake at this step.
      } else if (kindsMask & (1 << k)) {
        const set = this.sets[k]!;
        const n = set.defs[a]!.poses.length;
        for (let i = 0; i < n; i++) {
          const f = this.frames[set.first[a]! + i]!;
          if (f.canv[lod]) continue;
          if (performance.now() - t0 > budgetMs) {
            this.warm[lod] = cur;
            return false;
          }
          this.held[lod] = 1;
          this.bake(f, lod);
        }
      } else complete = false;
      cur++;
    }
    // Kinds not yet on the field are skipped; revisit them once they arrive.
    this.warm[lod] = complete ? total : 0;
    return true;
  }

  private bake(f: Frame, lod: number, next = false): HTMLCanvasElement {
    const C = next ? this.nc : this.cc;
    const s = LOD_SCALE[lod]! * (lod === 0 ? f.res : lod === 1 ? Math.min(1, f.res + 0.2) : 1);
    const w = Math.ceil((f.x1 - f.x0) * s + PAD * 2);
    const h = Math.ceil((f.y1 - f.y0) * s + PAD * 2);
    // Paint into a shared scratch canvas at the conservative size, then crop to the pixels
    // actually drawn (the pose bounds are generous; cropping saves about a quarter of the memory).
    if (!this.scratch || this.scratch.width < w || this.scratch.height < h) {
      this.scratch = makeCanvas(Math.max(w, this.scratch?.width ?? 0), Math.max(h, this.scratch?.height ?? 0));
      this.sctx = this.scratch.getContext('2d', { willReadFrequently: true });
      if (!this.sctx) throw new Error('Canvas 2D is not available');
    }
    const ctx = this.sctx!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    const pose = this.sets[SHEET_KINDS.indexOf(f.kind)]!.defs[f.anim]!.poses[f.poseIndex]!;
    const j = solve(pose, this.j);
    const kind: FigureKind = f.kind;
    // Rim thickness in figure units: ~1.6 CSS px at the base framing; thicker at the small LODs so
    // a far host still separates from the dusk hills.
    const far = s <= FAR_LOD_SCALE;
    const rimU = Math.max(0.95, (far ? 2.1 : 1.45) / s);
    const minW = 1.25 / s;
    const mx = f.mirror ? -s : s;
    // Canvas x = (x' - x0) * s + PAD, where x' = -x for mirrored frames (x0 is already mirrored).
    const e0 = PAD - f.x0 * s;
    const f0 = PAD - f.y0 * s;
    this.pass(ctx, kind, pose, j, minW, C.rim, 0, mx, s, e0, f0, C);
    ctx.globalCompositeOperation = 'source-atop';
    this.pass(ctx, kind, pose, j, minW, far ? C.midFar : C.mid, rimU * 0.5, mx, s, e0, f0, C);
    this.pass(ctx, kind, pose, j, minW, C.sil, rimU * 1.05, mx, s, e0, f0, C);
    ctx.setTransform(mx, 0, 0, s, e0, f0);
    drawDetails(ctx, kind, j, C.rim);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Crop to the alpha bounds.
    const data = ctx.getImageData(0, 0, w, h).data;
    let cx0 = w;
    let cy0 = h;
    let cx1 = -1;
    let cy1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4 + 3;
      for (let x = 0; x < w; x++) {
        if (data[row + x * 4]! === 0) continue;
        if (x < cx0) cx0 = x;
        if (x > cx1) cx1 = x;
        if (y < cy0) cy0 = y;
        cy1 = y;
      }
    }
    if (cx1 < 0) {
      cx0 = cy0 = 0;
      cx1 = cy1 = 0;
    }
    const cw = cx1 - cx0 + 1;
    const ch = cy1 - cy0 + 1;
    const c = makeCanvas(cw, ch);
    context2d(c).drawImage(this.scratch!, cx0, cy0, cw, ch, 0, 0, cw, ch);

    const dest = next ? f.nextDest : f.dest;
    if (next) {
      f.next[lod] = c;
      this.nextLodBytes[lod] = this.nextLodBytes[lod]! + cw * ch * 4;
    } else {
      f.canv[lod] = c;
      this.lodBytes[lod] = this.lodBytes[lod]! + cw * ch * 4;
    }
    const o = lod * 4;
    dest[o] = f.x0 + (cx0 - PAD) / s;
    dest[o + 1] = f.y0 + (cy0 - PAD) / s;
    dest[o + 2] = cw / s;
    dest[o + 3] = ch / s;
    return c;
  }

  private pass(ctx: CanvasRenderingContext2D, kind: FigureKind, pose: Pose, j: Joints, minW: number, color: string, off: number, mx: number, s: number, e0: number, f0: number, C: Colors): void {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.setTransform(mx, 0, 0, s, e0 - C.lx * off * s, f0 - C.ly * off * s);
    drawFigure(ctx, kind, pose, j, minW);
  }

  /** Bytes held by baked canvases (debug watch). */
  memory(): number {
    let n = 0;
    for (const f of this.frames) for (const c of f.canv) if (c) n += c.width * c.height * 4;
    return n;
  }
}

/**
 * LOD-0 density of the knights' rare poses (flung, down, getting up, fleeing): always in motion or
 * sprawled in the dust, they bake lighter so a tier's worth of them fits the sprite budget.
 */
const RARE_RES = 0.72;

/**
 * Lancer LOD-0 density per animation (L_IDLE, L_IDLE_B, L_GALLOP, L_BACK, L_REAR, L_STRIKE). At the
 * closest Mountain framing a back-row lancer needs ~4 px per figure unit; the charge frames bake at
 * 3 (a 1.3x upscale on a hazed, moving silhouette), about 11 MB for the whole set.
 */
const LANCER_RES = [0.52, 0.52, 0.66, 0.5, 0.58, 0.66];

/**
 * Frames baked ahead of need per sheet kind (everything the army does every minute); the rest bake
 * on first use. Lancers: standing, the charge, the ride back, the wheel-about and the impact.
 */
const KNIGHT_WARM = [A_IDLE_A, A_IDLE_B, A_IDLE_C, A_MARCH, A_STRIKE, A_CHEER, A_BRACE, A_RAISE];
const WARM_ORDER: readonly (readonly number[])[] = SHEET_KINDS.map((k) => (k === 'lancer' ? [L_IDLE, L_GALLOP, L_BACK, L_REAR, L_STRIKE, L_IDLE_B] : KNIGHT_WARM));
const WARM_LEN = Math.max(...WARM_ORDER.map((o) => o.length));
