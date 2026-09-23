// Champions: named knights who fight at the hero's side and persist through zooms. Each is drawn
// live every frame from the shared rig (like the hero), rim-lit through the same passes, with its
// own silhouette and signature:
//   Ser Aldric the Mostly Brave  a tall sugarloaf helm with a towering plume in his colors, sword
//                                and kite shield bearing his own arms, his banner on his back;
//                                cowers under the shield when the fire comes. Heroic Lunge: a
//                                flying leap at the dragon ending in a huge sword arc.
//   Dame Brunhild                big, heavily armored, a great axe held upright, a braid, and an
//                                azure goose wing on her helm (her colors, as in the Champions tab).
//                                Avalanche Cleave: she leaps, the axe comes down on the ground
//                                before the dragon, and the ground bursts.
//
// The special is telegraphed from the core's own timer (state.champions[id].specialT, public): the
// wind-up starts a beat early so the blow lands on the frame the championSpecial event arrives
// (the SFX play on the event). The crowd (index.ts) positions them, feeds the timer and fires the
// impact effects through onImpact.
import { context2d, makeCanvas } from '../atlas';
import { AlphaRamp, mixHex } from '../../lib/color';
import { clamp01 } from '../../lib/math';
import type { Palette } from '../palette';
import type { View } from '../types';
import { KNIGHT_HEIGHT } from '../world';
import type { Coat } from '../heraldry/coat';
import { coatOf } from '../heraldry/coat';
import { BannerArt, FLAG_W, ShieldArt, drawFinial, drawFlag, type Heraldry } from './banner';
import { AXE_HAFT, Joints, Pose, bladeLength, copyPose, drawDetails, drawFigure, lerpPose, solve, type FigureKind } from './rig';

export type ChampId = 'aldric' | 'brunhild';

/** Offscreen bounds in figure units (tall plume, axe raised overhead, the lunge's stretch). */
const BX0 = -100;
const BX1 = 130;
const BY0 = -222;
const BY1 = 16;
const MAX_BUF = 2048;
const ARC_SAMPLES = 20;
const ARC_WINDOW = 0.11;
const ARC_LINGER = 0.1;
const PLUME_N = 8;
const BRAID_N = 5;

function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
function outCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}
function P(o: Partial<Pose>): Pose {
  return Object.assign(new Pose(), o);
}

/** Pose keys for a special, timed relative to the impact (s), with the root's progress toward the target and hop. */
interface Key {
  t: number;
  pose: Pose;
  /** 0 = at home, 1 = at the target. */
  u: number;
  /** Root lift (m, + = up). */
  lift: number;
}

interface Style {
  kind: FigureKind;
  scale: number;
  /** Swing duration (s) and its phases (windup end, slash end) as fractions. */
  swing: number;
  uWind: number;
  uSlash: number;
  guard: Pose;
  foreWind: Pose;
  foreHit: Pose;
  backWind: Pose;
  backHit: Pose;
  cheer: Pose;
  brace: Pose;
  /** The special, keyed around the impact (t = 0). */
  special: Key[];
  /** Seconds before the impact the wind-up starts. */
  lead: number;
  /** Where the special lands relative to the dragon's front edge (m). */
  reach: number;
  /** Depth (m, feet y). */
  y: number;
  /** Two-handed: the near fist rides the haft this far above the far fist. */
  twoHand: number;
}

// ---- Ser Aldric: sword and shield, heroically posed, mostly. ----
const A_GUARD = P({ hipY: -47, lean: 0.03, head: -0.04, aFootX: 11, bFootX: -10, nHandX: 15, nHandY: -60, shield: 0.08, fHandX: -1, fHandY: -78, weapon: -2.05 });
const ALDRIC: Style = {
  kind: 'aldric',
  scale: 1.05,
  swing: 0.4,
  uWind: 0.1,
  uSlash: 0.26,
  guard: A_GUARD,
  foreWind: P({ hipX: -2, hipY: -47, lean: -0.1, head: -0.08, aFootX: 12, bFootX: -10, nHandX: 14, nHandY: -63, shield: 0.06, fHandX: -6, fHandY: -94, weapon: -2.75 }),
  foreHit: P({ hipX: 8, hipY: -43, lean: 0.4, head: 0.12, aFootX: 24, bFootX: -9, nHandX: 6, nHandY: -60, shield: 0.3, fHandX: 28, fHandY: -56, weapon: 0.3 }),
  backWind: P({ hipX: 4, hipY: -44, lean: 0.25, head: 0.08, aFootX: 19, bFootX: -9, nHandX: 8, nHandY: -60, shield: 0.2, fHandX: 20, fHandY: -46, weapon: 0.9 }),
  backHit: P({ hipX: 3, hipY: -47, lean: -0.1, head: -0.2, aFootX: 17, bFootX: -10, nHandX: 12, nHandY: -64, shield: 0, fHandX: 12, fHandY: -96, weapon: -2.3 }),
  cheer: P({ hipY: -47, lean: -0.08, head: -0.32, aFootX: 9, bFootX: -8, nHandX: 6, nHandY: -66, shield: -0.2, fHandX: 8, fHandY: -116, weapon: -1.57 }),
  // Mostly brave: the shield goes up over the helm and he peeks out from under it.
  brace: P({ hipX: -4, hipY: -37, lean: 0.14, head: 0.45, aFootX: 12, bFootX: -14, nHandX: 15, nHandY: -95, shield: -1.15, fHandX: -4, fHandY: -52, weapon: 2.4 }),
  special: [
    { t: -0.42, pose: A_GUARD, u: 0, lift: 0 },
    { t: -0.2, pose: P({ hipX: -6, hipY: -35, lean: 0.46, head: 0.18, aFootX: 16, bFootX: -18, nHandX: 10, nHandY: -54, shield: 0.25, fHandX: -16, fHandY: -64, weapon: -3.05 }), u: -0.04, lift: 0 },
    { t: -0.09, pose: P({ hipX: 2, hipY: -50, lean: 0.62, head: 0.1, aFootX: 24, aFootY: -16, bFootX: -24, bFootY: -12, nHandX: -2, nHandY: -66, shield: 0.5, fHandX: 10, fHandY: -104, weapon: -2.2 }), u: 0.55, lift: 0.75 },
    { t: 0, pose: P({ hipX: 10, hipY: -40, lean: 0.55, head: 0.2, aFootX: 28, bFootX: -16, nHandX: 0, nHandY: -58, shield: 0.5, fHandX: 34, fHandY: -52, weapon: 0.5 }), u: 1, lift: 0 },
    { t: 0.12, pose: P({ hipX: 9, hipY: -39, lean: 0.48, head: 0.2, aFootX: 28, bFootX: -16, nHandX: 2, nHandY: -58, shield: 0.4, fHandX: 26, fHandY: -36, weapon: 1.25 }), u: 1, lift: 0 },
    { t: 0.5, pose: P({ hipX: 4, hipY: -45, lean: 0.12, head: -0.1, aFootX: 18, bFootX: -12, nHandX: 12, nHandY: -60, shield: 0.1, fHandX: 16, fHandY: -60, weapon: 0.2 }), u: 1, lift: 0 },
    { t: 0.72, pose: P({ hipY: -48, lean: -0.1, head: -0.2, aFootX: 6, aFootY: -8, bFootX: -8, bFootY: -6, nHandX: 12, nHandY: -64, shield: 0.1, fHandX: 2, fHandY: -84, weapon: -2.0 }), u: 0.5, lift: 0.35 },
    { t: 0.95, pose: A_GUARD, u: 0, lift: 0 },
  ],
  lead: 0.42,
  reach: 0.62,
  y: 0.08,
  twoHand: 0,
};

// ---- Dame Brunhild: a great axe, and no fear of anything but geese. ----
// The great axe stands upright before her, the blade high against the sky above her helm.
const B_GUARD = P({ hipY: -45, lean: 0.04, head: 0.02, aFootX: 14, bFootX: -13, fHandX: 19, fHandY: -50, weapon: -1.5 });
const BRUNHILD: Style = {
  kind: 'brunhild',
  scale: 1.17,
  swing: 0.5,
  uWind: 0.16,
  uSlash: 0.3,
  guard: B_GUARD,
  foreWind: P({ hipX: -3, hipY: -46, lean: -0.14, head: -0.1, aFootX: 14, bFootX: -12, fHandX: 2, fHandY: -86, weapon: -2.6 }),
  foreHit: P({ hipX: 8, hipY: -40, lean: 0.42, head: 0.15, aFootX: 24, bFootX: -12, fHandX: 24, fHandY: -58, weapon: 0.4 }),
  backWind: P({ hipX: 6, hipY: -42, lean: 0.3, head: 0.1, aFootX: 22, bFootX: -12, fHandX: 22, fHandY: -50, weapon: 0.9 }),
  backHit: P({ hipX: 2, hipY: -47, lean: -0.12, head: -0.2, aFootX: 18, bFootX: -11, fHandX: 14, fHandY: -80, weapon: -1.6 }),
  cheer: P({ hipY: -46, lean: -0.08, head: -0.3, aFootX: 12, bFootX: -11, fHandX: 6, fHandY: -104, weapon: -1.4 }),
  brace: P({ hipX: -2, hipY: -40, lean: 0.3, head: 0.2, aFootX: 17, bFootX: -14, fHandX: 14, fHandY: -62, weapon: -1.3 }),
  special: [
    { t: -0.5, pose: B_GUARD, u: 0, lift: 0 },
    { t: -0.3, pose: P({ hipX: -3, hipY: -40, lean: 0.2, head: 0.05, aFootX: 16, bFootX: -14, fHandX: 0, fHandY: -74, weapon: -2.1 }), u: 0.12, lift: 0 },
    { t: -0.1, pose: P({ hipX: -2, hipY: -50, lean: -0.28, head: -0.22, aFootX: 10, aFootY: -8, bFootX: -12, bFootY: -10, fHandX: -6, fHandY: -106, weapon: -2.45 }), u: 0.7, lift: 0.55 },
    { t: 0, pose: P({ hipX: 8, hipY: -30, lean: 0.72, head: 0.36, aFootX: 26, bFootX: -18, fHandX: 26, fHandY: -38, weapon: 0.98 }), u: 1, lift: 0 },
    { t: 0.4, pose: P({ hipX: 8, hipY: -32, lean: 0.66, head: 0.2, aFootX: 26, bFootX: -18, fHandX: 25, fHandY: -40, weapon: 0.96 }), u: 1, lift: 0 },
    { t: 0.7, pose: P({ hipX: 2, hipY: -44, lean: 0.12, head: -0.05, aFootX: 18, bFootX: -13, fHandX: 8, fHandY: -60, weapon: -0.6 }), u: 0.75, lift: 0 },
    { t: 1.15, pose: B_GUARD, u: 0, lift: 0 },
  ],
  lead: 0.5,
  reach: 1.05,
  y: 0.03,
  twoHand: 19,
};

export const CHAMP_STYLES: Readonly<Record<ChampId, Style>> = { aldric: ALDRIC, brunhild: BRUNHILD };

/**
 * Ser Aldric's own arms, through the heraldry renderer's stable entry point: azure, semé of mullets
 * or, a sun or (the Sun charge at its semé level). His banner and his shield carry them.
 */
const ALDRIC_COAT: Coat = coatOf({ levels: { lion: 0, sun: 4, wyvern: 0, stag: 0, tower: 0, crown: 0 }, order: ['sun'] });
export const ALDRIC_ARMS: Heraldry = { field: '#2d4f93', tincture: '#ffd35a', charge: 'sun', coat: ALDRIC_COAT };

/** What the crowd tells a champion every frame. */
export interface ChampInput {
  /** Home spot (world x) in the ranks. */
  homeX: number;
  /** The dragon's front edge (world x). */
  frontX: number;
  /** Seconds until the special (core timer, interpolated); < 0 when it can't come now. */
  specialIn: number;
  /** Charge!: 0..1 (run in, swing harder). */
  surge: number;
}

const enum Move {
  Idle,
  March,
  Rally,
  Hidden,
}

export class Champion {
  readonly id: ChampId;
  readonly style: Style;
  readonly unit: number;
  on = false;
  /** Root on the ground (world m), excluding the special's own offset. */
  x = -3;
  y = 0.08;
  private move = Move.Hidden;
  private walkSpeed = 2.6;
  private runPh = 0;
  private strikeT0 = -100;
  private dir = 1;
  private readonly from = new Pose();
  private cheerT0 = -100;
  private braceOn = false;
  private braceW = 0;
  private now = 0;
  // Special.
  private sStart = -100;
  private sImpact = -100;
  private sEnd = -100;
  private sFromX = 0;
  private sToX = 0;
  private sEventT = -100;
  private sFired = false;
  private sLocked = false;
  private sDamage: unknown = null;
  /** The dragon's front edge as last seen (world x). */
  private lastFront = 0;
  // Rally (zoom): run to a point on the pile, then stand on it.
  private rTX = 0;
  private rTY = 0;
  private rArrive = 0;
  private rFromX = 0;
  private rFromY = 0;
  private rT0 = 0;

  private readonly pose = new Pose();
  private readonly tmp = new Pose();
  private readonly tmp2 = new Pose();
  private readonly j = new Joints();
  private readonly aj = new Joints();

  /** Called when the march-in arrives (the crowd cheers, a glint on the blade). */
  onArrive: ((c: Champion) => void) | null = null;
  /** Called at the special's impact (x, y world; the event's damage). */
  onImpact: ((c: Champion, x: number, y: number, damage: unknown) => void) | null = null;

  // Art.
  private readonly shieldArt = new ShieldArt();
  private hasShield = false;
  private readonly bannerArt = new BannerArt();
  private artPal: Palette | null = null;
  private mid = '#888';
  private plumeFill = '#eee';
  private plumeHi = '#fff';
  private plumeLo = '#888';
  private wingFill = '#2f5fb0';
  private wingShade = '#28508f';
  private wingLo = '#1d3868';
  private wingHi = '#8fb8ff';
  private arcBand: AlphaRamp | null = null;
  private arcEdge: AlphaRamp | null = null;
  private static buf: HTMLCanvasElement | null = null;
  private static bctx: CanvasRenderingContext2D | null = null;
  private static bufSmallT = 0;

  // Plume / feather / braid springs (figure units).
  private plX = 0;
  private plY = 0;
  private plVX = 0;
  private plVY = 0;
  private lastX = 0;
  private vx0 = 0;
  private readonly spX = new Float32Array(PLUME_N);
  private readonly spY = new Float32Array(PLUME_N);
  private readonly spNX = new Float32Array(PLUME_N);
  private readonly spNY = new Float32Array(PLUME_N);
  private readonly brX = new Float32Array(BRAID_N);
  private readonly brY = new Float32Array(BRAID_N);
  private readonly brPX = new Float32Array(BRAID_N);
  private readonly brPY = new Float32Array(BRAID_N);
  private braidInit = false;
  private readonly arcTX = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcTY = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcMX = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcMY = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcIX = new Float32Array(ARC_SAMPLES + 1);
  private readonly arcIY = new Float32Array(ARC_SAMPLES + 1);
  private readonly tipOut = { x: 0, y: 0 };

  constructor(id: ChampId) {
    this.id = id;
    this.style = CHAMP_STYLES[id];
    this.unit = (KNIGHT_HEIGHT / 100) * this.style.scale;
    this.y = this.style.y;
    copyPose(this.pose, this.style.guard);
    solve(this.pose, this.j);
  }

  // ---- commands ----

  /** Join: march in from `fromX` (world m) to the home spot, or appear there (`snap`). */
  join(snap: boolean, fromX: number, homeX: number): void {
    this.on = true;
    this.reset();
    if (snap) {
      this.x = homeX;
      this.move = Move.Idle;
    } else {
      this.x = fromX;
      this.move = Move.March;
      this.walkSpeed = Math.max(2.6, (homeX - fromX) / 3.2);
    }
  }

  hide(): void {
    this.on = false;
    this.move = Move.Hidden;
  }

  /** Drop every one-shot (resync, un-fuse). */
  reset(): void {
    this.strikeT0 = -100;
    this.cheerT0 = -100;
    this.braceOn = false;
    this.braceW = 0;
    this.sStart = this.sImpact = this.sEnd = -100;
    this.sFired = false;
    this.sLocked = false;
    this.braidInit = false;
    this.y = this.style.y;
    if (this.move === Move.Rally) this.move = Move.Idle;
  }

  /** Snap to the home spot, idle (after a resync or the zoom). */
  place(homeX: number): void {
    this.reset();
    this.x = homeX;
    this.move = this.on ? Move.Idle : Move.Hidden;
  }

  get marching(): boolean {
    return this.move === Move.March;
  }

  /** A blow on the footmen's beat. */
  strike(now: number): void {
    if (this.move !== Move.Idle || this.specialActive(now)) return;
    const since = now - this.strikeT0;
    this.dir = since < this.style.swing + 0.35 ? -this.dir : 1;
    this.poseAt(now, this.from);
    this.strikeT0 = now;
  }

  cheer(at: number): void {
    if (this.move === Move.Idle) this.cheerT0 = at;
  }

  brace(on: boolean): void {
    this.braceOn = on;
  }

  /** The special landed (core event). */
  special(now: number, damage: unknown): void {
    this.sEventT = now;
    this.sDamage = damage;
    if (!this.specialActive(now) && this.move === Move.Idle) {
      // No telegraph ran (it just joined, or the timer was held): a quick one, impact at once.
      this.sToX = Math.max(this.x + 0.3, this.lastFront - this.style.reach);
      this.startSpecial(now, now + 0.08);
    }
  }

  /** Zoom rally: run to (x, y) on the pile, arriving at `at`, then stand there. */
  rally(now: number, x: number, y: number, at: number): void {
    if (!this.on) return;
    this.reset();
    this.move = Move.Rally;
    this.rFromX = this.x;
    this.rFromY = this.y;
    this.rTX = x;
    this.rTY = y;
    this.rT0 = now;
    this.rArrive = Math.max(now + 0.2, at);
  }

  /** Move the rally target (the pile rises under the champion). */
  rallyTarget(x: number, y: number): void {
    this.rTX = x;
    this.rTY = y;
  }

  // ---- queries ----

  private specialActive(now: number): boolean {
    return now >= this.sStart && now < this.sEnd;
  }

  /** The root x including the special's travel (world m). */
  rootX(): number {
    return this.x + this.specialDX(this.now);
  }

  rootY(): number {
    return this.y - this.lift(this.now);
  }

  /** Weapon tip (world m) for glints and impacts. */
  tip(out: { x: number; y: number }): { x: number; y: number } {
    const j = this.j;
    const L = 5 + bladeLength(this.style.kind);
    const a = this.pose.weapon;
    out.x = this.rootX() + (j.fHX + Math.cos(a) * L) * this.unit;
    out.y = this.rootY() + (j.fHY + Math.sin(a) * L) * this.unit;
    return out;
  }

  /** Where the special's blow lands (world): Aldric's blade tip, Brunhild's axe head on the ground. */
  private impactPoint(out: { x: number; y: number }): void {
    if (this.style.kind === 'brunhild') {
      const j = this.j;
      const a = this.pose.weapon;
      out.x = this.rootX() + (j.fHX + Math.cos(a) * (AXE_HAFT - 4)) * this.unit;
      out.y = 0;
    } else this.tip(out);
  }

  // ---- motion ----

  private startSpecial(now: number, impact: number): void {
    const keys = this.style.special;
    this.sStart = Math.min(now, impact + keys[0]!.t);
    this.sImpact = impact;
    this.sEnd = impact + keys[keys.length - 1]!.t;
    this.sFromX = this.x;
    this.sFired = false;
    this.sLocked = false;
    this.strikeT0 = -100;
  }

  /** Keyed special pose at time t (writes out; returns false when no special is playing). */
  private specialPose(t: number, out: Pose): boolean {
    if (t < this.sStart || t >= this.sEnd) return false;
    const keys = this.style.special;
    const r = t - this.sImpact;
    let i = 0;
    while (i < keys.length - 2 && r >= keys[i + 1]!.t) i++;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const u = clamp01((r - a.t) / (b.t - a.t));
    // Snappy into the impact, eased elsewhere.
    const e = b.t === 0 ? outCubic(u) : smooth(u);
    lerpPose(out, a.pose, b.pose, e);
    return true;
  }

  private keyAt(t: number, field: 'u' | 'lift'): number {
    if (t < this.sStart || t >= this.sEnd) return 0;
    const keys = this.style.special;
    const r = t - this.sImpact;
    let i = 0;
    while (i < keys.length - 2 && r >= keys[i + 1]!.t) i++;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const u = clamp01((r - a.t) / (b.t - a.t));
    if (field === 'lift') {
      // Rising: ease out (a spring off the ground); falling: ease in (gravity).
      const e = b.lift > a.lift ? 1 - (1 - u) * (1 - u) : u * u;
      return a.lift + (b.lift - a.lift) * e;
    }
    const e = b.t === 0 ? u * u * (1.6 - 0.6 * u) : smooth(u);
    return a.u + (b.u - a.u) * e;
  }

  private specialDX(t: number): number {
    const u = this.keyAt(t, 'u');
    return u === 0 ? 0 : (this.sToX - this.sFromX) * u;
  }

  /** The special's hop (m, + = up). */
  private lift(t: number): number {
    return this.keyAt(t, 'lift');
  }

  /** The base pose (guard + breathing + brace/cheer/march blends) at time t, without swings. */
  private basePose(t: number, out: Pose): Pose {
    const st = this.style;
    copyPose(out, st.guard);
    const br = Math.sin(t * 1.9 + (this.id === 'aldric' ? 0.7 : 2.1));
    out.hipY += 0.8 * br;
    out.hipX += 0.7 * Math.sin(t * 0.43);
    out.fHandY += 0.9 * Math.sin(t * 1.9 + 0.5);
    out.weapon += 0.04 * Math.sin(t * 1.05);
    if (this.braceW > 0.001) lerpPose(out, out, st.brace, this.braceW);
    const c = t - this.cheerT0;
    if (c > 0 && c < 1.7) lerpPose(out, out, st.cheer, smooth(c / 0.18) * (1 - smooth((c - 1.3) / 0.4)));
    if (this.move === Move.March || this.move === Move.Rally) {
      const run = this.move === Move.Rally && t < this.rArrive;
      const ph = this.runPh * Math.PI * 2;
      const sa = Math.sin(ph);
      const k = run ? 1 : 0.8;
      out.hipX = 3;
      out.hipY = -46 + 1.8 * Math.cos(2 * ph);
      out.lean = (run ? 0.3 : 0.12) + 0.03 * Math.sin(2 * ph);
      out.aFootX = 4 + 15 * k * Math.cos(ph);
      out.aFootY = sa < 0 ? 10 * sa : 0;
      out.bFootX = 4 - 15 * k * Math.cos(ph);
      out.bFootY = -sa < 0 ? -10 * sa : 0;
      if (this.move === Move.Rally && t >= this.rArrive) {
        // On the pile: weapon raised high, feet planted on shoulders.
        copyPose(out, st.cheer);
        out.hipY += 1.2 * Math.sin(t * 5);
      }
    }
    return out;
  }

  /** Full pose at time t. */
  poseAt(t: number, out: Pose): Pose {
    if (this.specialPose(t, out)) return this.finish(out);
    this.basePose(t, this.tmp);
    const st = this.style;
    const u = (t - this.strikeT0) / st.swing;
    if (u < 0 || u >= 1) return this.finish(copyPose(out, this.tmp));
    const wind = this.dir > 0 ? st.foreWind : st.backWind;
    const hit = this.dir > 0 ? st.foreHit : st.backHit;
    if (u < st.uWind) lerpPose(out, this.from, wind, smooth(u / st.uWind));
    else if (u < st.uSlash) lerpPose(out, wind, hit, outCubic((u - st.uWind) / (st.uSlash - st.uWind)));
    else lerpPose(out, hit, this.tmp, smooth((u - st.uSlash) / (1 - st.uSlash)));
    return this.finish(out);
  }

  /** Two-handed weapons: the near fist rides the haft above the far one. */
  private finish(p: Pose): Pose {
    const k = this.style.twoHand;
    if (k > 0) {
      p.nHandX = p.fHandX + Math.cos(p.weapon) * k;
      p.nHandY = p.fHandY + Math.sin(p.weapon) * k;
    }
    return p;
  }

  update(dt: number, now: number, realDt: number, inp: ChampInput): void {
    this.now = now;
    this.lastFront = inp.frontX;
    if (!this.on) return;
    const st = this.style;
    // Hit-stop: freeze at contact, never in the windup.
    if (dt === 0 && realDt > 0) {
      const u = (now - this.strikeT0) / st.swing;
      if (u >= 0 && u < st.uSlash) this.strikeT0 = now - st.swing * st.uSlash;
    }
    switch (this.move) {
      case Move.March: {
        const d = inp.homeX - this.x;
        const sp = this.walkSpeed * dt;
        this.runPh += dt * 1.6;
        if (Math.abs(d) <= sp) {
          this.x = inp.homeX;
          this.move = Move.Idle;
          this.cheerT0 = now;
          this.onArrive?.(this);
        } else this.x += d > 0 ? sp : -sp;
        break;
      }
      case Move.Idle: {
        // Follow the home spot (the front line tracks the dragon; Charge! pulls it in).
        if (!this.specialActive(now)) {
          const d = inp.homeX - this.x;
          this.x += d * Math.min(1, dt * (inp.surge > 0 ? 3 : 4));
        }
        // Telegraph the special from the core's timer so the blow lands with the event.
        if (!this.specialActive(now) && inp.specialIn >= 0 && inp.specialIn <= st.lead && now > this.sEnd + 0.2) {
          this.sToX = Math.max(this.x + 0.3, inp.frontX - st.reach);
          this.startSpecial(now, now + inp.specialIn);
        } else if (this.specialActive(now) && !this.sLocked && now < this.sImpact) {
          // Keep the impact on the core's clock (a held timer delays it: hold the wind-up).
          if (inp.specialIn >= 0) {
            const want = now + inp.specialIn;
            if (Math.abs(want - this.sImpact) > 0.002) {
              const shift = want - this.sImpact;
              this.sImpact += shift;
              this.sEnd += shift;
            }
          }
          this.sToX = Math.max(this.sFromX + 0.3, inp.frontX - st.reach);
        }
        if (this.specialActive(now) && now >= this.sImpact) this.sLocked = true;
        if (this.specialActive(now) && !this.sFired && now >= this.sImpact && this.sEventT >= this.sStart - 0.05) {
          this.sFired = true;
          this.impactPoint(this.tipOut);
          this.onImpact?.(this, this.tipOut.x, this.tipOut.y, this.sDamage);
        }
        break;
      }
      case Move.Rally: {
        const u = clamp01((now - this.rT0) / Math.max(0.05, this.rArrive - this.rT0));
        this.runPh += dt * 2.2;
        const e = u * u * (3 - 2 * u);
        this.x = this.rFromX + (this.rTX - this.rFromX) * e;
        // Climb: rise onto the pile over the last part of the run.
        const c = clamp01((u - 0.55) / 0.45);
        this.y = this.rFromY + (this.rTY - this.rFromY) * c * c * (3 - 2 * c) - (u > 0.55 && u < 1 ? 0.5 * Math.sin(Math.PI * c) : 0);
        if (u >= 1) {
          this.x = this.rTX;
          this.y = this.rTY;
        }
        break;
      }
      default:
        break;
    }
    const target = this.braceOn && !this.specialActive(now) ? 1 : 0;
    this.braceW += (target - this.braceW) * (1 - Math.exp(-10 * dt));
    this.poseAt(now, this.pose);
    solve(this.pose, this.j);
    if (dt > 0) this.simulate(Math.min(dt, 1 / 30), now);
  }

  private simulate(dt: number, t: number): void {
    const rx = this.rootX() / this.unit;
    const vx = (rx - this.lastX) / dt;
    const ax = (vx - this.vx0) / dt;
    this.vx0 = vx;
    this.lastX = rx;
    const gust = 1 + 0.5 * Math.sin(t * 0.9 + 1) + 0.3 * Math.sin(t * 2.3 + 0.2);
    // Plume / feather spring: lags the motion, flutters in the wind.
    const k = 150;
    const c = 12;
    const tx = Math.max(-40, Math.min(40, -ax * 0.003)) - 2.5 * gust;
    const ty = 1.4 * Math.sin(t * 2.1);
    this.plVX += (k * (tx - this.plX) - c * this.plVX) * dt;
    this.plVY += (k * (ty - this.plY) - c * this.plVY) * dt;
    this.plX += this.plVX * dt;
    this.plY += this.plVY * dt;
    if (this.plX > 12) this.plX = 12;
    if (this.plX < -16) this.plX = -16;
    if (this.style.kind !== 'brunhild') return;
    // Braid: a short verlet chain from the back of the helm.
    const j = this.j;
    const ry = this.rootY() / this.unit;
    const anX = rx + j.headX - Math.cos(j.headA) * 11 + Math.sin(j.headA) * 6;
    const anY = ry + j.headY - Math.sin(j.headA) * 11 - Math.cos(j.headA) * 6 + 6;
    const seg = 7;
    if (!this.braidInit) {
      this.braidInit = true;
      for (let i = 0; i < BRAID_N; i++) {
        this.brX[i] = this.brPX[i] = anX - i * 1.5;
        this.brY[i] = this.brPY[i] = anY + i * seg;
      }
    }
    for (let i = 1; i < BRAID_N; i++) {
      const bx = this.brX[i]!;
      const by = this.brY[i]!;
      const nx = bx + (bx - this.brPX[i]!) * 0.96 - 60 * gust * dt * dt * (i / BRAID_N);
      const ny = by + (by - this.brPY[i]!) * 0.96 + 420 * dt * dt;
      this.brPX[i] = bx;
      this.brPY[i] = by;
      this.brX[i] = nx;
      this.brY[i] = ny;
    }
    this.brX[0] = anX;
    this.brY[0] = anY;
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < BRAID_N; i++) {
        const dx = this.brX[i]! - this.brX[i - 1]!;
        const dy = this.brY[i]! - this.brY[i - 1]!;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const q = (d - seg) / d;
        this.brX[i] = this.brX[i]! - dx * q * (i === 1 ? 1 : 0.5);
        this.brY[i] = this.brY[i]! - dy * q * (i === 1 ? 1 : 0.5);
        if (i > 1) {
          this.brX[i - 1] = this.brX[i - 1]! + dx * q * 0.5;
          this.brY[i - 1] = this.brY[i - 1]! + dy * q * 0.5;
        }
      }
      // Hang behind the back.
      const backX = rx + j.neckX - j.fwX * 9;
      for (let i = 1; i < BRAID_N; i++) if (this.brX[i]! > backX) this.brX[i] = backX;
    }
  }

  // ---- drawing ----

  private ensureArt(p: Palette): void {
    if (p === this.artPal) return;
    this.artPal = p;
    this.mid = mixHex(p.rim, p.silhouette, 0.58);
    this.arcBand = new AlphaRamp(p.accent.glow);
    this.arcEdge = new AlphaRamp('#ffffff');
    // His colors: an argent plume shaded azure. Her goose feather: plain white, a touch grey.
    const white = '#f1ece0';
    this.plumeFill = mixHex(white, p.silhouette, 0.12);
    this.plumeHi = mixHex(white, p.rim, 0.35);
    this.plumeLo = mixHex(p.accent.heraldBlue, p.silhouette, 0.15);
    // Brunhild's wing: azure, lit on its upper edge.
    const az = '#2f5fb0';
    this.wingFill = mixHex(az, p.silhouette, 0.12);
    this.wingShade = mixHex(az, p.silhouette, 0.3);
    this.wingLo = mixHex(az, p.silhouette, 0.6);
    this.wingHi = mixHex('#8fb8ff', p.rim, 0.35);
    if (this.style.kind === 'aldric') {
      this.bannerArt.update(ALDRIC_ARMS, p);
      this.shieldArt.update(ALDRIC_ARMS, p);
      this.hasShield = true;
    }
  }

  private drawBraid(b: CanvasRenderingContext2D, ox: number, oy: number): void {
    const x = this.brX;
    const y = this.brY;
    b.lineCap = 'round';
    for (let i = 1; i < BRAID_N; i++) {
      b.lineWidth = 7 - i * 0.9;
      b.beginPath();
      b.moveTo(x[i - 1]! - ox, y[i - 1]! - oy);
      b.lineTo(x[i]! - ox, y[i]! - oy);
      b.stroke();
    }
    // The braid's tie: a small knot and tuft.
    const tx = x[BRAID_N - 1]! - ox;
    const ty = y[BRAID_N - 1]! - oy;
    b.beginPath();
    b.arc(tx, ty + 2, 3.2, 0, Math.PI * 2);
    b.fill();
  }

  private pass(b: CanvasRenderingContext2D, color: string, off: number, pxu: number, e0: number, f0: number, lx: number, ly: number, ox: number, oy: number, minW: number): void {
    b.fillStyle = color;
    b.strokeStyle = color;
    b.setTransform(pxu, 0, 0, pxu, e0 - lx * off * pxu, f0 - ly * off * pxu);
    if (this.style.kind === 'brunhild' && this.braidInit) this.drawBraid(b, ox, oy);
    drawFigure(b, this.style.kind, this.pose, this.j, minW);
  }

  /** Aldric's tall plume: a panache rising from the helm's point and curling back. */
  private drawPlume(b: CanvasRenderingContext2D, t: number): void {
    const j = this.j;
    const cs = Math.cos(j.headA);
    const sn = Math.sin(j.headA);
    // The helm's point (local (-1, -31)).
    const bx = j.headX + -1 * cs - -31 * sn;
    const by = j.headY + -1 * sn + -31 * cs;
    const sx = this.spX;
    const sy = this.spY;
    for (let i = 0; i < PLUME_N; i++) {
      const u = i / (PLUME_N - 1);
      const lag = u * u;
      sx[i] = bx + PLUME_AX[i]! * cs - PLUME_AY[i]! * sn + this.plX * 1.4 * lag + Math.sin(t * 7 - i * 0.9) * 1.2 * u;
      sy[i] = by + PLUME_AX[i]! * sn + PLUME_AY[i]! * cs + this.plY * lag + Math.sin(t * 8.3 - i * 1.2) * 1.2 * u;
    }
    this.featherShape(b, PLUME_N, PLUME_AW, this.plumeFill, this.plumeLo, this.plumeHi);
  }

  /**
   * Brunhild's helm wing: a goose's wing in azure (her colors, as in the Champions tab), four
   * primaries fanned up and back from the helm's side, fluttering with her moves.
   */
  private drawWing(b: CanvasRenderingContext2D, t: number): void {
    const j = this.j;
    const cs = Math.cos(j.headA);
    const sn = Math.sin(j.headA);
    const bx = j.headX + -8 * cs - -12 * sn;
    const by = j.headY + -8 * sn + -12 * cs;
    const sx = this.spX;
    const sy = this.spY;
    for (let f = WING_F - 1; f >= 0; f--) {
      // Each primary: a gentle curve at its own angle, longest in the middle of the fan.
      const a = WING_A[f]! + this.plX * 0.012 * (f + 1) + 0.04 * Math.sin(t * 7 + f);
      const len = WING_L[f]!;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (let i = 0; i < FEATHER_N; i++) {
        const u = i / (FEATHER_N - 1);
        // Along the feather, curling back toward the tip.
        const lx = ca * len * u - sa * len * 0.18 * u * u;
        const ly = sa * len * u + ca * len * 0.18 * u * u;
        sx[i] = bx + lx * cs - ly * sn;
        sy[i] = by + lx * sn + ly * cs + this.plY * 0.5 * u * u;
      }
      this.featherShape(b, FEATHER_N, FEATHER_W, f & 1 ? this.wingShade : this.wingFill, this.wingLo, this.wingHi);
    }
  }

  /** Fill a feathered spine (spX/spY) with widths w: smooth top edge, scalloped underside. */
  private featherShape(b: CanvasRenderingContext2D, n: number, w: readonly number[], fill: string, lo: string, hi: string): void {
    const sx = this.spX;
    const sy = this.spY;
    const nx = this.spNX;
    const ny = this.spNY;
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0;
      const c = i < n - 1 ? i + 1 : n - 1;
      let dx = sx[c]! - sx[a]!;
      let dy = sy[c]! - sy[a]!;
      const l = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= l;
      dy /= l;
      // Normal toward the outside of the curl (the sunward, upper side).
      nx[i] = dy;
      ny[i] = -dx;
    }
    b.fillStyle = fill;
    b.beginPath();
    b.moveTo(sx[0]! + nx[0]! * w[0]!, sy[0]! + ny[0]! * w[0]!);
    for (let i = 1; i < n - 1; i++) {
      const x0 = sx[i]! + nx[i]! * w[i]!;
      const y0 = sy[i]! + ny[i]! * w[i]!;
      const x1 = sx[i + 1]! + nx[i + 1]! * w[i + 1]!;
      const y1 = sy[i + 1]! + ny[i + 1]! * w[i + 1]!;
      b.quadraticCurveTo(x0, y0, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
    }
    b.lineTo(sx[n - 1]!, sy[n - 1]!);
    for (let i = n - 1; i > 0; i--) {
      const qx = sx[i - 1]! - nx[i - 1]! * w[i - 1]!;
      const qy = sy[i - 1]! - ny[i - 1]! * w[i - 1]!;
      const mx = (sx[i]! + sx[i - 1]!) * 0.5 - (nx[i]! + nx[i - 1]!) * 0.5 * w[i]! * 0.25;
      const my = (sy[i]! + sy[i - 1]!) * 0.5 - (ny[i]! + ny[i - 1]!) * 0.5 * w[i]! * 0.25;
      b.quadraticCurveTo(mx, my, qx, qy);
    }
    b.closePath();
    b.fill();
    b.lineCap = 'round';
    b.strokeStyle = lo;
    b.lineWidth = 1.1;
    b.beginPath();
    b.moveTo(sx[1]! - nx[1]! * w[1]! * 0.35, sy[1]! - ny[1]! * w[1]! * 0.35);
    for (let i = 2; i < n - 1; i++) b.lineTo(sx[i]! - nx[i]! * w[i]! * 0.35, sy[i]! - ny[i]! * w[i]! * 0.35);
    b.stroke();
    b.strokeStyle = hi;
    b.lineWidth = 1.6;
    b.beginPath();
    b.moveTo(sx[0]! + nx[0]! * w[0]! * 0.8, sy[0]! + ny[0]! * w[0]! * 0.8);
    for (let i = 1; i < n - 1; i++) b.lineTo(sx[i]! + nx[i]! * w[i]! * 0.82, sy[i]! + ny[i]! * w[i]! * 0.82);
    b.stroke();
  }

  /** Aldric's banner on a pole strapped to his back, drawn on the main canvas behind him. */
  private drawBanner(ctx: CanvasRenderingContext2D, A: number, B: number, C: number, D: number, E: number, F: number, pxu: number, t: number, gold: string): void {
    const j = this.j;
    const k = this.unit;
    // Figure units -> device.
    const ta = A * k;
    const tb = B * k;
    const tc = C * k;
    const td = D * k;
    const wx = this.rootX();
    const wy = this.rootY();
    const te = A * wx + C * wy + E;
    const tf = B * wx + D * wy + F;
    // Pole: from the small of the back up past the helm, leaning back a little.
    const bx = j.hipX + j.upX * 6 - j.fwX * 11;
    const by = j.hipY + j.upY * 6 - j.fwY * 11;
    const pa = Math.atan2(j.upY, j.upX) - 0.16;
    const dx = Math.cos(pa);
    const dy = Math.sin(pa);
    const up = 112;
    const topX = bx + dx * up;
    const topY = by + dy * up;
    ctx.setTransform(ta, tb, tc, td, te, tf);
    ctx.strokeStyle = this.artPal!.silhouette;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.6, 1.3 / pxu);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(topX, topY);
    ctx.stroke();
    const strips = Math.max(3, Math.min(16, Math.round((FLAG_W * 0.85 * pxu) / 7)));
    drawFlag(ctx, this.bannerArt, pxu > 1.3 ? 0 : 1, ta, tb, tc, td, te, tf, topX + 1, topY + 3, 0.85, t, 1.3, strips, 0.1);
    ctx.setTransform(ta, tb, tc, td, te, tf);
    drawFinial(ctx, topX, topY, dx, dy, gold);
  }

  /** Draw through the view's camera. */
  draw(ctx: CanvasRenderingContext2D, v: View): void {
    if (!this.on || this.move === Move.Hidden) return;
    const p = v.palette;
    this.ensureArt(p);
    const cam = v.camera;
    const dpr = v.dpr;
    const pad = 2;
    let pxu = cam.zoomEff * dpr * this.unit;
    const big = Math.max(BX1 - BX0, BY1 - BY0) * pxu + pad * 2;
    if (big > MAX_BUF) pxu *= MAX_BUF / big;
    const bw = Math.ceil((BX1 - BX0) * pxu + pad * 2);
    const bh = Math.ceil((BY1 - BY0) * pxu + pad * 2);
    if (bw < 2) return;
    const b = Champion.buffer(bw, bh, v.realTime);
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bw + 1, bh + 1);
    const e0 = pad - BX0 * pxu;
    const f0 = pad - BY0 * pxu;
    const rimU = Math.max(0.95, 1.45 / pxu);
    const minW = 1.25 / pxu;
    const lx = p.light.x;
    const ly = p.light.y;
    const ox = this.rootX() / this.unit;
    const oy = this.rootY() / this.unit;
    this.pass(b, p.rim, 0, pxu, e0, f0, lx, ly, ox, oy, minW);
    b.globalCompositeOperation = 'source-atop';
    this.pass(b, this.mid, rimU * 0.5, pxu, e0, f0, lx, ly, ox, oy, minW);
    this.pass(b, p.silhouette, rimU * 1.05, pxu, e0, f0, lx, ly, ox, oy, minW);
    b.setTransform(pxu, 0, 0, pxu, e0, f0);
    drawDetails(b, this.style.kind, this.j, p.rim);
    if (this.hasShield) {
      // His own arms on the kite (banner.ts ShieldArt, as on the hero's shield).
      const j = this.j;
      const tilt = this.pose.shield;
      const cs = Math.cos(tilt);
      const sn = Math.sin(tilt);
      b.setTransform(pxu * cs, pxu * sn, -pxu * sn, pxu * cs, e0 + (j.nHX + 2) * pxu, f0 + (j.nHY + 1) * pxu);
      b.globalAlpha = 0.95;
      this.shieldArt.draw(b, pxu, this.now);
      b.globalAlpha = 1;
    }
    b.globalCompositeOperation = 'source-over';
    b.setTransform(pxu, 0, 0, pxu, e0, f0);
    if (this.style.kind === 'aldric') this.drawPlume(b, this.now);
    else this.drawWing(b, this.now);

    const A = cam.a * dpr;
    const B = cam.b * dpr;
    const C = cam.c * dpr;
    const D = cam.d * dpr;
    const E = cam.e * dpr;
    const F = cam.f * dpr;
    if (this.style.kind === 'aldric') this.drawBanner(ctx, A, B, C, D, E, F, pxu, this.now, p.accent.gold);
    const wx = this.rootX();
    const wy = this.rootY();
    const k = this.unit;
    ctx.setTransform(A * k, B * k, C * k, D * k, E + A * wx + C * wy, F + B * wx + D * wy);
    ctx.drawImage(Champion.buf!, 0, 0, bw, bh, BX0 - pad / pxu, BY0 - pad / pxu, bw / pxu, bh / pxu);
    this.drawArc(ctx);
  }

  private static buffer(bw: number, bh: number, realTime: number): CanvasRenderingContext2D {
    const buf = Champion.buf;
    if (!buf || buf.width < bw || buf.height < bh) {
      Champion.buf = makeCanvas(Math.max(bw, buf?.width ?? 0), Math.max(bh, buf?.height ?? 0));
      Champion.bctx = context2d(Champion.buf);
      Champion.bufSmallT = 0;
    } else if (buf.width * buf.height > 3 * bw * bh) {
      if (Champion.bufSmallT === 0) Champion.bufSmallT = realTime;
      else if (realTime - Champion.bufSmallT > 2) {
        buf.width = 0;
        buf.height = 0;
        Champion.buf = makeCanvas(bw, bh);
        Champion.bctx = context2d(Champion.buf);
        Champion.bufSmallT = 0;
      }
    } else Champion.bufSmallT = 0;
    return Champion.bctx!;
  }

  /** The weapon smear: over a swing's slash, and a big one through the special's blow. */
  private drawArc(ctx: CanvasRenderingContext2D): void {
    const t = this.now;
    const st = this.style;
    let s0: number;
    let s1: number;
    let big = 1;
    if (this.specialActive(t) || (t >= this.sEnd && t < this.sEnd + ARC_LINGER)) {
      s0 = this.sImpact - (st.kind === 'brunhild' ? 0.1 : 0.12);
      s1 = this.sImpact + (st.kind === 'brunhild' ? 0.01 : 0.1);
      big = 1.6;
    } else {
      s0 = this.strikeT0 + st.swing * st.uWind;
      s1 = this.strikeT0 + st.swing * st.uSlash;
    }
    if (t < s0 || t > s1 + ARC_LINGER) return;
    const fade = t > s1 ? 1 - (t - s1) / ARC_LINGER : 1;
    const band = this.arcBand!;
    const edge = this.arcEdge!;
    const axe = st.kind === 'brunhild';
    const L = axe ? AXE_HAFT + 16 : 5 + bladeLength(st.kind);
    const inner = axe ? 0.72 : 0.55;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    const tx = this.arcTX;
    const ty = this.arcTY;
    const ix = this.arcIX;
    const iy = this.arcIY;
    const mx = this.arcMX;
    const my = this.arcMY;
    const curX = this.rootX();
    const curY = this.rootY();
    const win = ARC_WINDOW * (big > 1 ? 1.3 : 1);
    let n = 0;
    for (let i = ARC_SAMPLES; i >= 0; i--) {
      let ts = t - (i / ARC_SAMPLES) * win;
      if (ts < s0) continue;
      if (ts > s1) ts = s1;
      this.poseAt(ts, this.tmp2);
      const j = solve(this.tmp2, this.aj);
      const dx = Math.cos(this.tmp2.weapon);
      const dy = Math.sin(this.tmp2.weapon);
      // Relative to the current root: the leap carries the smear along.
      const shx = (this.x + this.specialDX(ts) - curX) / this.unit;
      const shy = (this.y - this.lift(ts) - curY) / this.unit;
      tx[n] = j.fHX + dx * L * 1.05 + shx;
      ty[n] = j.fHY + dy * L * 1.05 + shy;
      mx[n] = j.fHX + dx * L * 0.86 + shx;
      my[n] = j.fHY + dy * L * 0.86 + shy;
      ix[n] = j.fHX + dx * L * inner + shx;
      iy[n] = j.fHY + dy * L * inner + shy;
      n++;
    }
    for (let i = 1; i < n; i++) {
      const a = (i / (n - 1)) * fade;
      const a2 = a * a;
      ctx.fillStyle = band.at(0.3 * a2 * (big > 1 ? 1.3 : 1));
      ctx.beginPath();
      ctx.moveTo(ix[i - 1]!, iy[i - 1]!);
      ctx.lineTo(tx[i - 1]!, ty[i - 1]!);
      ctx.lineTo(tx[i]!, ty[i]!);
      ctx.lineTo(ix[i]!, iy[i]!);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = band.at(0.5 * a2);
      ctx.lineWidth = (1 + 2.2 * a) * big;
      ctx.beginPath();
      ctx.moveTo(mx[i - 1]!, my[i - 1]!);
      ctx.lineTo(mx[i]!, my[i]!);
      ctx.stroke();
      ctx.strokeStyle = edge.at(0.95 * a);
      ctx.lineWidth = (1.2 + 3.2 * a) * big;
      ctx.beginPath();
      ctx.moveTo(tx[i - 1]!, ty[i - 1]!);
      ctx.lineTo(tx[i]!, ty[i]!);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Plume spine (figure units from the helm's point, in the helm's frame): up, then curling back.
const PLUME_AX = [0, 1, 0, -3, -8, -14, -20, -24];
const PLUME_AY = [2, -7, -14, -21, -25, -26, -22, -15];
const PLUME_AW = [3, 4.6, 6, 6.6, 6.4, 5.4, 4, 1.2];
// Goose feather: from the helm's side, up and back in a gentle curve.
const FEATHER_N = 6;
const FEATHER_W = [1.4, 3, 3.8, 3.8, 2.8, 0.8];
// Brunhild's wing: four primaries, angles (rad, helm frame: -PI/2 = up) and lengths.
const WING_F = 4;
const WING_A = [-1.95, -2.2, -2.45, -2.7];
const WING_L = [24, 29, 27, 21];
