// Floating damage numbers and callouts: a fixed pool, anchored to world points, drawn at a
// constant screen size at every zoom. Each slot owns a small canvas; the styled text (outline,
// shadow, gradient fill, coin icon) is rendered into it ONCE when the value changes, so a frame is
// just one drawImage per number (no fillText/strokeText in the hot path).
//
// Army hits aggregate: a new army hit merges into that unit's live number (bumping it) instead of
// spawning another, so a big army never turns the screen into number soup.
import type { Decimal } from '../../core/decimal';
import { fmt } from '../../core/format';
import type { Camera } from '../camera';
import { context2d, makeCanvas } from '../atlas';
import { outBack, outCubic } from '../../lib/ease';
import { vec2 } from '../../lib/vec';

export const NK_CLICK = 0;
export const NK_CRIT = 1;
export const NK_ARMY = 2;
export const NK_GOLD = 3;
export const NK_CALLOUT = 4;
export const NK_REWARD = 5;

interface Style {
  font: string;
  /** Font px (CSS). */
  size: number;
  /** Top -> bottom fill gradient. */
  fill: readonly string[];
  outline: string;
  /** Outline width (CSS px, the visible part outside the glyph). */
  stroke: number;
  /** Render-resolution multiplier over dpr (headroom for pop-scale). */
  res: number;
  /** Draw a coin before the text. */
  icon: boolean;
  /** Seconds alive (army numbers extend on merge). */
  life: number;
  /** Rise in px over riseT seconds. */
  rise: number;
  riseT: number;
  /** Fade-out duration at the end of life. */
  fadeT: number;
  alpha: number;
}

const CINZEL = '"Cinzel Variable", "Cinzel", Georgia, serif';
const OUTLINE = '#1c0c05';

const STYLES: readonly Style[] = [
  // click
  { font: `800 34px ${CINZEL}`, size: 34, fill: ['#ffffff', '#fffaf0', '#ffe2b8'], outline: OUTLINE, stroke: 3.2, res: 1.3, icon: false, life: 0.85, rise: 64, riseT: 0.85, fadeT: 0.3, alpha: 1 },
  // crit
  { font: `900 58px ${CINZEL}`, size: 58, fill: ['#fffbe6', '#ffe066', '#ffb42a', '#ff7a1a'], outline: '#2a0e02', stroke: 4.5, res: 1.8, icon: false, life: 1.25, rise: 90, riseT: 1.2, fadeT: 0.35, alpha: 1 },
  // army
  { font: `700 21px ${CINZEL}`, size: 21, fill: ['#fff0dc', '#f2c89a', '#d99a64'], outline: OUTLINE, stroke: 2.6, res: 1.4, icon: false, life: 1.3, rise: 44, riseT: 1.4, fadeT: 0.3, alpha: 0.86 },
  // gold (+N)
  { font: `800 28px ${CINZEL}`, size: 28, fill: ['#fffbe0', '#ffd95e', '#e8961c'], outline: '#2a1202', stroke: 3.2, res: 1.3, icon: true, life: 1.3, rise: 58, riseT: 1.2, fadeT: 0.35, alpha: 1 },
  // callout (STAGGERED!)
  { font: `900 40px ${CINZEL}`, size: 40, fill: ['#ffffff', '#dff9ff', '#7fdcff', '#3aa6e8'], outline: '#06121c', stroke: 4, res: 1.9, icon: false, life: 1.35, rise: 34, riseT: 1.3, fadeT: 0.35, alpha: 1 },
  // kill reward (+N, big)
  { font: `900 46px ${CINZEL}`, size: 46, fill: ['#ffffff', '#fff0a0', '#ffc53a', '#e0801a'], outline: '#2a1202', stroke: 4.2, res: 1.6, icon: true, life: 1.8, rise: 80, riseT: 1.6, fadeT: 0.45, alpha: 1 },
];
const DRAW_ORDER = [NK_ARMY, NK_CLICK, NK_GOLD, NK_REWARD, NK_CRIT, NK_CALLOUT] as const;

const MAX = 48;
const PAD = 10;
/** Army hits merge into a live number of the same unit younger than this (s)... */
const MERGE_WINDOW = 1.1;
/** ...as long as that number isn't older than this (keeps values fresh). */
const MERGE_MAX_AGE = 2.0;

export class NumberPool {
  private readonly active = new Uint8Array(MAX);
  private readonly kind = new Uint8Array(MAX);
  private readonly wx = new Float64Array(MAX);
  private readonly wy = new Float64Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly ox = new Float32Array(MAX);
  private readonly oy = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly bump = new Float32Array(MAX);
  private readonly spin = new Float32Array(MAX);
  /** Army unit key (0 footman, 1 archer...) for merging; 255 = none. */
  private readonly group = new Uint8Array(MAX);
  private readonly amount: (Decimal | null)[] = new Array<Decimal | null>(MAX).fill(null);
  // Cached render per slot.
  private readonly canvases: (HTMLCanvasElement | null)[] = new Array<HTMLCanvasElement | null>(MAX).fill(null);
  private readonly srcW = new Float32Array(MAX);
  private readonly srcH = new Float32Array(MAX);
  private readonly dstW = new Float32Array(MAX);
  private readonly dstH = new Float32Array(MAX);
  private head = 0;
  private lastClick = -1;
  private stack = 0;
  private clock = 0;
  private dpr = 1;
  private readonly p = vec2();

  constructor(
    private readonly coinIcon: () => HTMLCanvasElement | null,
    private readonly glow: () => HTMLCanvasElement | null,
  ) {}

  /** Live numbers (debug). */
  get count(): number {
    let n = 0;
    for (let i = 0; i < MAX; i++) n += this.active[i]!;
    return n;
  }

  setDpr(dpr: number): void {
    this.dpr = dpr;
  }

  clear(): void {
    this.active.fill(0);
  }

  /** Spawn a number (or a text callout when `text` is given). Returns the slot. */
  spawn(kind: number, wx: number, wy: number, amount: Decimal | null, text: string | null = null, group = 255): number {
    const i = this.alloc();
    const st = STYLES[kind]!;
    this.active[i] = 1;
    this.kind[i] = kind;
    this.wx[i] = wx;
    this.wy[i] = wy;
    this.age[i] = 0;
    this.life[i] = st.life;
    this.bump[i] = 0;
    this.group[i] = group;
    this.amount[i] = amount;
    this.spin[i] = 0;
    this.ox[i] = 0;
    this.oy[i] = 0;
    this.vx[i] = (Math.random() - 0.5) * 40;
    if (kind === NK_CLICK) {
      // Rapid clicks fan out left/right and step upward instead of stacking on one spot.
      this.stack = this.clock - this.lastClick < 0.28 ? this.stack + 1 : 0;
      this.lastClick = this.clock;
      const side = this.stack & 1 ? 1 : -1;
      this.ox[i] = this.stack === 0 ? (Math.random() - 0.5) * 16 : side * (14 + Math.random() * 22);
      this.oy[i] = -Math.min(this.stack, 4) * 12;
      this.vx[i] = side * (18 + Math.random() * 30);
    } else if (kind === NK_CRIT) {
      this.vx[i] = (Math.random() - 0.5) * 20;
    } else if (kind === NK_CALLOUT) {
      this.vx[i] = 0;
      this.spin[i] = Math.random() < 0.5 ? -0.09 : 0.07;
    } else if (kind === NK_ARMY) {
      this.ox[i] = (Math.random() - 0.5) * 30;
    }
    this.render(i, text ?? this.label(kind, amount));
    return i;
  }

  /** Army hit: merge into that group's live number if it's fresh, else spawn a new one. */
  army(group: number, wx: number, wy: number, amount: Decimal): void {
    for (let i = 0; i < MAX; i++) {
      if (!this.active[i] || this.kind[i] !== NK_ARMY || this.group[i] !== group) continue;
      const a = this.age[i]!;
      if (a > MERGE_MAX_AGE || this.life[i]! - a < 0.2) continue;
      // Fresh enough: add to it, re-pop it and keep it alive a little longer.
      if (this.bump[i]! < MERGE_WINDOW) {
        const sum = this.amount[i]!.add(amount);
        this.amount[i] = sum;
        this.bump[i] = 0;
        this.life[i] = Math.max(this.life[i]!, a + 0.7);
        this.render(i, fmt(sum));
        return;
      }
    }
    this.spawn(NK_ARMY, wx, wy, amount, null, group);
  }

  update(realDt: number): void {
    this.clock += realDt;
    for (let i = 0; i < MAX; i++) {
      if (!this.active[i]) continue;
      const a = this.age[i]! + realDt;
      this.age[i] = a;
      this.bump[i] += realDt;
      if (a >= this.life[i]!) this.active[i] = 0;
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number): void {
    const p = this.p;
    for (let o = 0; o < DRAW_ORDER.length; o++) {
      const kind = DRAW_ORDER[o]!;
      const st = STYLES[kind]!;
      for (let i = 0; i < MAX; i++) {
        if (!this.active[i] || this.kind[i] !== kind) continue;
        const cv = this.canvases[i];
        if (!cv) continue;
        const age = this.age[i]!;
        const left = this.life[i]! - age;
        const fade = left < st.fadeT ? left / st.fadeT : 1;
        let s: number;
        let rot = 0;
        let jx = 0;
        let jy = 0;
        if (kind === NK_CRIT || kind === NK_CALLOUT || kind === NK_REWARD) {
          // Slam: start huge, crash down to size, wobble.
          const k = age < 0.14 ? 1 - age / 0.14 : 0;
          s = 1 + 1.3 * k * k * k + 0.1 * Math.sin(age * 38) * Math.exp(-age * 9);
          if (age < 0.16) {
            jx = (Math.random() - 0.5) * 6;
            jy = (Math.random() - 0.5) * 6;
          }
          if (kind === NK_CALLOUT) rot = this.spin[i]! * (1 - Math.exp(-age * 10));
        } else {
          // Pop: grow in with overshoot.
          const k = age < 0.15 ? age / 0.15 : 1;
          s = (kind === NK_ARMY ? 0.7 : 0.45) + (kind === NK_ARMY ? 0.3 : 0.55) * outBack(k);
        }
        const b = this.bump[i]!;
        if (b < 0.16 && kind === NK_ARMY) s *= 1 + 0.28 * (1 - b / 0.16);
        s *= 0.82 + 0.18 * fade;
        let alpha = st.alpha * fade * fade;
        if (kind !== NK_CRIT && kind !== NK_CALLOUT && kind !== NK_REWARD && age < 0.05) alpha *= age / 0.05;
        if (alpha < 0.01) continue;

        cam.worldToScreen(this.wx[i]!, this.wy[i]!, p);
        const rt = age < st.riseT ? age / st.riseT : 1;
        const x = p.x + this.ox[i]! + this.vx[i]! * Math.min(age, 1) + jx;
        const y = p.y + this.oy[i]! - st.rise * outCubic(rt) + jy;

        if (kind === NK_CRIT || kind === NK_REWARD || kind === NK_CALLOUT) {
          // A hot bloom behind big numbers while they land.
          const g = this.glow();
          if (g && age < 0.5) {
            const gk = 1 - age / 0.5;
            const gw = this.dstW[i]! * 1.5 * s;
            const gh = this.dstH[i]! * 2.4 * s;
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.55 * gk * gk * fade;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.drawImage(g, x - gw / 2, y - gh / 2, gw, gh);
            ctx.globalCompositeOperation = 'source-over';
          }
        }

        ctx.globalAlpha = alpha > 1 ? 1 : alpha;
        const ds = dpr * s;
        if (rot === 0) ctx.setTransform(ds, 0, 0, ds, dpr * x, dpr * y);
        else {
          const c = Math.cos(rot) * ds;
          const sn = Math.sin(rot) * ds;
          ctx.setTransform(c, sn, -sn, c, dpr * x, dpr * y);
        }
        const dw = this.dstW[i]!;
        const dh = this.dstH[i]!;
        ctx.drawImage(cv, 0, 0, this.srcW[i]!, this.srcH[i]!, -dw / 2, -dh / 2, dw, dh);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private label(kind: number, amount: Decimal | null): string {
    if (!amount) return '';
    return kind === NK_GOLD || kind === NK_REWARD ? '+' + fmt(amount) : fmt(amount);
  }

  private alloc(): number {
    for (let k = 0; k < MAX; k++) {
      const i = (this.head + k) % MAX;
      if (!this.active[i]) {
        this.head = (i + 1) % MAX;
        return i;
      }
    }
    // Full: recycle the oldest.
    let best = 0;
    for (let i = 1; i < MAX; i++) if (this.age[i]! > this.age[best]!) best = i;
    return best;
  }

  /** Render the styled text into slot i's canvas (per spawn/merge, never per frame). */
  private render(i: number, text: string): void {
    const kind = this.kind[i]!;
    const st = STYLES[kind]!;
    const res = Math.max(1, this.dpr) * st.res;
    let cv = this.canvases[i];
    if (!cv) {
      cv = makeCanvas(64, 32);
      this.canvases[i] = cv;
    }
    let c = context2d(cv);
    c.font = st.font;
    const tw = c.measureText(text).width;
    const iconS = st.icon ? st.size * 0.86 : 0;
    const gap = st.icon ? st.size * 0.14 : 0;
    const wCss = tw + iconS + gap + PAD * 2 + st.stroke * 2;
    const hCss = st.size * 1.3 + PAD * 2;
    const W = Math.ceil(wCss * res);
    const H = Math.ceil(hCss * res);
    if (cv.width < W || cv.height < H) {
      cv.width = Math.max(cv.width, W);
      cv.height = Math.max(cv.height, H);
      c = context2d(cv);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, cv.width, cv.height);
    c.setTransform(res, 0, 0, res, 0, 0);
    c.font = st.font;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.miterLimit = 2;
    const x0 = PAD + st.stroke + iconS + gap;
    const y = hCss / 2 + st.size * 0.05;

    if (st.icon) {
      const coin = this.coinIcon();
      if (coin) {
        c.shadowColor = 'rgba(12,4,0,0.65)';
        c.shadowBlur = 4 * res;
        c.shadowOffsetY = 1.5 * res;
        c.drawImage(coin, PAD + st.stroke - 1, y - iconS / 2 - st.size * 0.04, iconS, iconS);
      }
    }
    // Soft drop shadow + thick dark outline: reads over bright sky and dark silhouettes alike.
    c.shadowColor = 'rgba(12,4,0,0.7)';
    c.shadowBlur = st.stroke * 1.6 * res;
    c.shadowOffsetY = 2 * res;
    c.lineWidth = st.stroke * 2;
    c.strokeStyle = st.outline;
    c.strokeText(text, x0, y);
    c.shadowColor = 'rgba(0,0,0,0)';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    const g = c.createLinearGradient(0, y - st.size * 0.42, 0, y + st.size * 0.42);
    const n = st.fill.length;
    for (let k = 0; k < n; k++) g.addColorStop(k / (n - 1), st.fill[k]!);
    c.fillStyle = g;
    c.fillText(text, x0, y);
    this.srcW[i] = W;
    this.srcH[i] = H;
    this.dstW[i] = wCss;
    this.dstH[i] = hCss;
  }
}
