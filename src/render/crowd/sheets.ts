// Knight sprite sheets: every animation frame of every knight kind, baked (lazily, per level of
// detail) into its own tightly cropped canvas with the rim light painted in.
//
// Rim light: the silhouette is filled with the rim color, then a mid tone and the near-black body
// are painted on top ('source-atop', so they never leave the silhouette) shifted AWAY from the light.
// What stays uncovered is a crisp two-step band of light on exactly the edges that face the sun.
//
// Levels of detail (device px per figure unit): a knight is 100 units tall, so LOD 0 is 340 px
// (a hero-sized knight at the base framing on a 2x display) and LOD 3 is 42 px (pulled back ~10x).
import { context2d, makeCanvas } from '../atlas';
import { mixHex } from '../../lib/color';
import type { Palette } from '../palette';
import { ANIM_COUNT, A_BRACE, A_CHEER, A_DOWN, A_FLEE, A_FLUNG, A_GETUP, A_IDLE_A, A_IDLE_B, A_IDLE_C, A_MARCH, A_RAISE, A_STRIKE, SHEET_KINDS, buildAnims, type AnimDef, type SheetKind } from './anims';
import { Joints, anchors, drawDetails, drawFigure, figureBounds, solve, type Anchors, type FigureKind } from './rig';

export const LOD_SCALE = [3.4, 1.7, 0.85, 0.42] as const;
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
    this.sil = p.silhouette;
    this.lx = p.light.x;
    this.ly = p.light.y;
    if (!same) {
      for (const f of this.frames) f.canv.fill(null);
      this.warm.fill(0);
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
    return this.bake(f, lod);
  }

  /**
   * Bake frames ahead of need within a time budget: the LOD on screen first, then the next smaller
   * one (the camera mostly pulls back), most common animations first, so neither the first swing
   * nor a zoom-out ever hitches.
   */
  prewarm(lod: number, kindsMask: number, budgetMs: number): void {
    const t0 = performance.now();
    if (!this.warmLod1(lod, kindsMask, t0, budgetMs)) return;
    if (lod + 1 < LOD_COUNT) this.warmLod1(lod + 1, kindsMask, t0, budgetMs);
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
    const c = makeCanvas(w, h);
    const ctx = context2d(c);
    const pose = this.sets[SHEET_KINDS.indexOf(f.kind)]!.defs[f.anim]!.poses[f.poseIndex]!;
    const j = solve(pose, this.j);
    const kind: FigureKind = f.kind;
    // Rim thickness in figure units: ~1.6 CSS px at the base framing, never under ~1.4 device px.
    const rimU = Math.max(0.95, 1.45 / s);
    const minW = 1.25 / s;
    const mx = f.mirror ? -s : s;
    // Canvas x = (x' - x0) * s + PAD, where x' = -x for mirrored frames (x0 is already mirrored).
    const e0 = PAD - f.x0 * s;
    const f0 = PAD - f.y0 * s;
    const pass = (color: string, off: number): void => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.setTransform(mx, 0, 0, s, e0 - this.lx * off * s, f0 - this.ly * off * s);
      drawFigure(ctx, kind, pose, j, minW);
    };
    pass(this.rim, 0);
    ctx.globalCompositeOperation = 'source-atop';
    pass(this.mid, rimU * 0.5);
    pass(this.sil, rimU * 1.05);
    ctx.setTransform(mx, 0, 0, s, e0, f0);
    drawDetails(ctx, kind, j, this.rim);
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    f.canv[lod] = c;
    const o = lod * 4;
    f.dest[o] = f.x0 - PAD / s;
    f.dest[o + 1] = f.y0 - PAD / s;
    f.dest[o + 2] = w / s;
    f.dest[o + 3] = h / s;
    return c;
  }

  /** Bytes held by baked canvases (debug watch). */
  memory(): number {
    let n = 0;
    for (const f of this.frames) for (const c of f.canv) if (c) n += c.width * c.height * 4;
    return n;
  }
}

const WARM_ORDER = [A_IDLE_A, A_IDLE_B, A_IDLE_C, A_MARCH, A_STRIKE, A_CHEER, A_BRACE, A_DOWN, A_FLUNG, A_GETUP, A_RAISE, A_FLEE];
if (WARM_ORDER.length !== ANIM_COUNT) throw new Error('crowd: WARM_ORDER must list every animation');
