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
import { A_BRACE, A_CHEER, A_IDLE_A, A_IDLE_B, A_IDLE_C, A_MARCH, A_RAISE, A_STRIKE, SHEET_KINDS, buildAnims, type AnimDef, type SheetKind } from './anims';
import { Joints, anchors, drawDetails, drawFigure, figureBounds, solve, type Anchors, type FigureKind, type Pose } from './rig';

export const LOD_SCALE = [4.4, 2.2, 1.1, 0.55, 0.28] as const;
/** LODs at or below this scale are far LODs: thicker rim, lighter mid tone (a far host separates from the hills). */
const FAR_LOD_SCALE = 1.15;
export const LOD_COUNT = LOD_SCALE.length;
/** Transparent border around each baked frame (device px). */
const PAD = 2;

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
  poseIndex: number;
  anim: number;
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

export class KnightSheets {
  readonly frames: Frame[] = [];
  readonly sets: AnimSet[] = [];
  private palette: Palette | null = null;
  private rim = '#fff';
  private mid = '#888';
  private sil = '#000';
  private lx = 1;
  private ly = 0;
  private readonly j = new Joints();
  /** Prewarm cursor per LOD. */
  private readonly warm = new Array<number>(LOD_COUNT).fill(0);
  /** Whether any canvas is held per LOD, and when each LOD was last on screen (wall s). */
  private readonly held = new Uint8Array(LOD_COUNT);
  private readonly lastUse = new Float64Array(LOD_COUNT);
  private scratch: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;
  private midFar = '#888';

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
            poseIndex: i,
            anim: a,
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
    this.palette = p;
    this.rim = p.rim;
    this.mid = mixHex(p.rim, p.silhouette, 0.58);
    this.midFar = mixHex(p.rim, p.silhouette, 0.4);
    this.sil = p.silhouette;
    this.lx = p.light.x;
    this.ly = p.light.y;
    if (!same) {
      for (const f of this.frames) f.canv.fill(null);
      this.warm.fill(0);
      this.held.fill(0);
    }
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
  evict(t: number, idle: number): void {
    for (let l = 0; l < LOD_COUNT; l++) {
      if (!this.held[l] || t - this.lastUse[l]! < idle) continue;
      for (const f of this.frames) {
        const c = f.canv[l];
        if (!c) continue;
        // Zero-size first so the backing store is released now, not at the next GC.
        c.width = 0;
        c.height = 0;
        f.canv[l] = null;
      }
      this.held[l] = 0;
      this.warm[l] = 0;
    }
  }

  /**
   * Bake the common frames ahead of need within a time budget: the LOD on screen, and (while the
   * camera pulls back) the next smaller one, so neither the first swing nor a zoom-out hitches.
   * Rare poses (flung, fleeing, getting up) bake on first use.
   */
  prewarm(lod: number, kindsMask: number, budgetMs: number, lookahead: boolean): void {
    const t0 = performance.now();
    if (!this.warmLod1(lod, kindsMask, t0, budgetMs)) return;
    if (lookahead && lod + 1 < LOD_COUNT) this.warmLod1(lod + 1, kindsMask, t0, budgetMs);
  }

  /** Returns true when this LOD is fully warm (for the kinds in the mask). */
  private warmLod1(lod: number, kindsMask: number, t0: number, budgetMs: number): boolean {
    const total = WARM_ORDER.length * SHEET_KINDS.length;
    let cur = this.warm[lod]!;
    let complete = true;
    while (cur < total) {
      const k = cur % SHEET_KINDS.length;
      const a = WARM_ORDER[(cur / SHEET_KINDS.length) | 0]!;
      if (kindsMask & (1 << k)) {
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

  private bake(f: Frame, lod: number): HTMLCanvasElement {
    const s = LOD_SCALE[lod]!;
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
    this.pass(ctx, kind, pose, j, minW, this.rim, 0, mx, s, e0, f0);
    ctx.globalCompositeOperation = 'source-atop';
    this.pass(ctx, kind, pose, j, minW, far ? this.midFar : this.mid, rimU * 0.5, mx, s, e0, f0);
    this.pass(ctx, kind, pose, j, minW, this.sil, rimU * 1.05, mx, s, e0, f0);
    ctx.setTransform(mx, 0, 0, s, e0, f0);
    drawDetails(ctx, kind, j, this.rim);
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

    f.canv[lod] = c;
    const o = lod * 4;
    f.dest[o] = f.x0 + (cx0 - PAD) / s;
    f.dest[o + 1] = f.y0 + (cy0 - PAD) / s;
    f.dest[o + 2] = cw / s;
    f.dest[o + 3] = ch / s;
    return c;
  }

  private pass(ctx: CanvasRenderingContext2D, kind: FigureKind, pose: Pose, j: Joints, minW: number, color: string, off: number, mx: number, s: number, e0: number, f0: number): void {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.setTransform(mx, 0, 0, s, e0 - this.lx * off * s, f0 - this.ly * off * s);
    drawFigure(ctx, kind, pose, j, minW);
  }

  /** Bytes held by baked canvases (debug watch). */
  memory(): number {
    let n = 0;
    for (const f of this.frames) for (const c of f.canv) if (c) n += c.width * c.height * 4;
    return n;
  }
}

/** Frames baked ahead of need (everything the army does every minute); the rest bake on first use. */
const WARM_ORDER = [A_IDLE_A, A_IDLE_B, A_IDLE_C, A_MARCH, A_STRIKE, A_CHEER, A_BRACE, A_RAISE];
