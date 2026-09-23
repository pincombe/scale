// The procedural dragon rig: pure math, preallocated, no DOM (runs in Node for tests).
//
// Units: body lengths ("u"): the rest pose is normalized so snout tip to tail tip = 1, the rest
// pose's front edge sits at x = 0 and the ground at y = 0 (+y down, the dragon faces -x). The
// renderer maps u -> world with x_w = CLASH_X + (x - restMinX) * L, y_w = y * L.
//
// Skeleton
// - Spine: one chain of nodes, head joint (0) -> neck -> shoulder (iS) -> body -> hip (iH) ->
//   tail tip (n - 1). Extra heads (heads > 1) get their own neck chains hanging off the shoulder.
// - Pose: behaviors write "channels" (./channels in this file: C_*); solveTargets() turns them
//   into a target curve by forward kinematics (torso arch, neck S-curve, tail droop/curl/sway),
//   rotates it about a pivot (pitch), and optionally bends the tail onto an IK target (the slam).
// - Dynamics: every node is a damped spring toward its target (stiff torso, looser neck, very
//   loose tail tip), integrated in fixed substeps, then follow-the-leader distance constraints
//   from the shoulder outward keep the segment lengths and give the trailing, whippy motion.
//   Impulses (flinches) are just velocity kicks.
// - Skin: per-node back/belly widths from a profile (+ swell modifiers) give the outline offsets.
// - Legs: two-bone IK to feet that stay planted and step (diagonal gait) when displaced; a
//   procedural run cycle (C_RUN) for walks and scurries too fast to step; airborne legs dangle,
//   tuck back for flight or reach down for a landing (C_TUCK).
// - Wings: arm + finger fan with a membrane; flap/buzz/spread channels. Two layouts:
//   back wings (the newt: a small wing on the withers) or wing-arms (the wyvern: the wings ARE the
//   forelegs). Wing-arms live in the front leg slots: shoulder -> elbow -> wrist is a planted
//   two-bone IK leg (the elbow juts up), blended by angle toward a spread/flapping wing pose
//   (C_WSPREAD lifts the wrist off the ground); the fingers fold back along the forearm when
//   grounded and fan out as the wing opens.
// - Back: an optional row of craggy rock plates (near and far), laid out once per individual.
// - Heads: a rigid head frame per neck end, with a damped pitch spring and a look target.
// - Ground: at y = groundY (u, default 0): the targets, the spine, the chin and planted feet stay
//   above it. Airborne phases lift the root (C_Y) and set C_AIR; moves that travel far (flight
//   paths, walks) set `carry` so the root offset moves the body rigidly instead of through the
//   springs (which would trail a fast path).
import { HeadShape } from './head';
import { Rng } from '../../lib/rng';
import type { Individual } from './species';

export const MAX_NODES = 48;
export const NECK_N = 5;
export const BODY_N = 8;
export const TAIL_N = 18;
export const MAX_HEADS = 3;
export const MAX_FINGERS = 4;
export const MAX_PLATES = 16;
/** Vertices of a rock club's outline. */
export const CLUB_N = 9;

// ---- pose channels (indices into rig.ch / rig.target) ----
export const C_X = 0; // root offset x (u)
export const C_Y = 1; // root offset y (u)
export const C_PITCH = 2; // body pitch, + = nose up (rad)
export const C_PIVOT = 3; // pitch pivot: 0 shoulder .. 1 hip
export const C_ARCH = 4; // back arch (rad)
export const C_NRAISE = 5; // neck elevation (rad)
export const C_NCURL = 6; // neck S-curve (rad)
export const C_HPITCH = 7; // head pitch offset, + = nose up (rad)
export const C_HLEVEL = 8; // 0..1: head keeps level regardless of the neck
export const C_LOOK = 9; // 0..1: head pitches toward the look target
export const C_LOOKX = 10; // look target (u)
export const C_LOOKY = 11;
export const C_JAW = 12; // 0..1 jaw open
export const C_TRAISE = 13; // tail root angle offset (rad, - = up)
export const C_TCURL = 14; // tail curl (rad, - = curls up)
export const C_SWAY = 15; // tail sway amplitude (rad)
export const C_TIK = 16; // tail IK weight 0..1
export const C_TIKX = 17; // tail IK target (u)
export const C_TIKY = 18;
export const C_TSTIFF = 19; // tail stiffness multiplier
export const C_CHEST = 20; // chest / belly swell (0..1, can go slightly negative on exhale)
export const C_THROAT = 21; // throat swell 0..1
export const C_GLOW = 22; // inner fire glow 0..1
export const C_WSPREAD = 23; // wing spread 0 folded .. 1 open
export const C_WLIFT = 24; // wing lift (rad, - = up)
export const C_WFLAP = 25; // wing flap amplitude (rad)
export const C_BUZZ = 26; // buzz 0..1
export const C_CROUCH = 27; // 0..1 body lowers, legs bend
export const C_AIR = 28; // 0..1 airborne (feet leave the ground)
export const C_SQUINT = 29; // 0..1 eye squint
export const C_ANGER = 30; // 0..1 brow anger
export const C_DIZZY = 31; // 0..1 dizzy eyes
export const C_TONGUE = 32; // 0..1 tongue out
export const C_DROOP = 33; // 0..1 limp (wings, gills and tail sag)
export const C_SPIN = 34; // whole-body spin about the body's center (rad)
export const C_FACE = 35; // facing: 1 = normal (toward the army), -1 = turned around (mirror about midX)
export const C_SHIFT = 36; // world-space x offset of the whole dragon (u), applied outside the pose
export const C_TUCK = 37; // airborne legs: 0 dangle, 1 tucked back (flight), -1 reaching down (landing)
export const C_RUN = 38; // 0..1 procedural run cycle (rig.runHz, rig.runStride)
export const NCH = 39;

/** Smoothing rate per channel (1/s; 0 = follow the target exactly). */
const RATE = new Float32Array(NCH);
RATE.fill(14);
RATE[C_X] = 22;
RATE[C_Y] = 18;
RATE[C_PITCH] = 16;
RATE[C_PIVOT] = 10;
RATE[C_HPITCH] = 16;
RATE[C_LOOKX] = 6;
RATE[C_LOOKY] = 6;
RATE[C_JAW] = 22;
RATE[C_TIKX] = 0;
RATE[C_TIKY] = 0;
RATE[C_TIK] = 30;
RATE[C_CHEST] = 10;
RATE[C_THROAT] = 9;
RATE[C_GLOW] = 12;
RATE[C_BUZZ] = 16;
RATE[C_AIR] = 0;
RATE[C_SQUINT] = 20;
RATE[C_TONGUE] = 30;
RATE[C_SWAY] = 4;
RATE[C_SPIN] = 0;
RATE[C_FACE] = 30;
RATE[C_SHIFT] = 30;
RATE[C_TUCK] = 7;
RATE[C_RUN] = 8;

/** Scratch result of sampling the spine at a fractional node index. */
export interface SpineSample {
  x: number;
  y: number;
  /** Unit normal toward the back (up for a level body). */
  nx: number;
  ny: number;
  back: number;
  belly: number;
}

/** Output of wingPoints(): root, wrist, finger tips, trailing root (x/y interleaved). */
export interface WingPose {
  n: number;
  pts: Float32Array;
}

// Leg slots: front-near, front-far, back-near, back-far.
export const LEG_FN = 0;
export const LEG_FF = 1;
export const LEG_BN = 2;
export const LEG_BF = 3;

function ik2(
  hx: number,
  hy: number,
  tx: number,
  ty: number,
  a: number,
  b: number,
  bend: number,
  out: Float64Array,
): void {
  let dx = tx - hx;
  let dy = ty - hy;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-9) {
    dx = 0;
    dy = 1;
    d = 1e-9;
  }
  const ux = dx / d;
  const uy = dy / d;
  const maxD = (a + b) * 0.999;
  const minD = Math.abs(a - b) + 1e-6;
  if (d > maxD) d = maxD;
  if (d < minD) d = minD;
  let c = (a * a + d * d - b * b) / (2 * a * d);
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  const al = Math.acos(c) * bend;
  const ca = Math.cos(al);
  const sa = Math.sin(al);
  out[0] = hx + a * (ux * ca - uy * sa);
  out[1] = hy + a * (ux * sa + uy * ca);
  out[2] = hx + ux * d;
  out[3] = hy + uy * d;
}

export class DragonRig {
  ind!: Individual;
  readonly head = new HeadShape();

  // ---- layout ----
  /** Main chain node count; total node count including extra necks. */
  n = 0;
  total = 0;
  iS = NECK_N;
  iH = NECK_N + BODY_N;
  heads = 1;
  /** Node index of each head's joint, and each extra neck's first node. */
  readonly headNode = new Int16Array(MAX_HEADS);
  readonly leader = new Int16Array(MAX_NODES);
  /** Neighbors for tangents (toward the head / toward the tail). */
  readonly prevT = new Int16Array(MAX_NODES);
  readonly nextT = new Int16Array(MAX_NODES);
  /** Constraint order (leaders before followers). */
  readonly order = new Int16Array(MAX_NODES);
  readonly segLen = new Float64Array(MAX_NODES);
  /** Arc position 0 (head joint) .. 1 (tail tip) of each node. */
  readonly s = new Float32Array(MAX_NODES);
  readonly back0 = new Float32Array(MAX_NODES);
  readonly belly0 = new Float32Array(MAX_NODES);
  readonly omega = new Float32Array(MAX_NODES);
  readonly zeta = new Float32Array(MAX_NODES);

  // ---- derived dimensions (u) ----
  headLen = 0.2;
  restAx = 0;
  restAy = -0.1;
  /** How far the body drops at full crouch. */
  crouchDepth = 0.03;
  /** Rest-pose AABB (u) and its left edge (the front). */
  restMinX = 0;
  restMinY = 0;
  restMaxX = 1;
  restMaxY = 0;
  /** Tail length (u) for reach calculations. */
  tailLen = 0.4;
  /** Mirror axis for turning around: the rest pose's body middle (u). */
  midX = 0.4;
  /** Feature sizes (u): crest height, tail fin height, spade length, club radius. */
  crestH = 0;
  finH = 0;
  spadeLen = 0;
  clubR = 0;

  // ---- live state ----
  readonly x = new Float64Array(MAX_NODES);
  readonly y = new Float64Array(MAX_NODES);
  readonly vx = new Float64Array(MAX_NODES);
  readonly vy = new Float64Array(MAX_NODES);
  readonly tx = new Float64Array(MAX_NODES);
  readonly ty = new Float64Array(MAX_NODES);
  readonly nx = new Float64Array(MAX_NODES);
  readonly ny = new Float64Array(MAX_NODES);
  readonly back = new Float32Array(MAX_NODES);
  readonly belly = new Float32Array(MAX_NODES);
  /** Outline points: back side and belly side. */
  readonly bx = new Float32Array(MAX_NODES);
  readonly by = new Float32Array(MAX_NODES);
  readonly ux = new Float32Array(MAX_NODES);
  readonly uy = new Float32Array(MAX_NODES);
  /** Tail IK scratch. */
  private readonly kx = new Float64Array(MAX_NODES);
  private readonly ky = new Float64Array(MAX_NODES);

  /** Channels (smoothed) and their targets. */
  readonly ch = new Float64Array(NCH);
  readonly target = new Float64Array(NCH);
  /** Continuous phases. */
  swayPhase = 0;
  swayHz = 0.5;
  flapPhase = 0;
  flapHz = 3;
  buzzPhase = 0;
  buzzHz = 22;
  /** Dynamics speed multiplier (big dragons move slower). */
  tempo = 1;
  /** Screen px per u this frame (set by the host; used for readability decisions). */
  pxPerU = 100;
  /** Spine param beyond which the body has dissolved (1 = intact). */
  dissolve = 1;

  // ---- heads ----
  readonly headA = new Float64Array(MAX_HEADS);
  readonly headAV = new Float64Array(MAX_HEADS);
  readonly headX = new Float64Array(MAX_HEADS);
  readonly headY = new Float64Array(MAX_HEADS);
  /** Per-head jaw (0..1), eye lid (0 open .. 1 shut), look offsets (desync extra heads). */
  readonly jaw = new Float64Array(MAX_HEADS);
  readonly lid = new Float64Array(MAX_HEADS);
  /** Gill sway angle offset (secondary motion). */
  readonly gillSway = new Float64Array(MAX_HEADS);
  private readonly gillV = new Float64Array(MAX_HEADS);
  private readonly lastHeadA = new Float64Array(MAX_HEADS);

  // ---- legs ----
  legCount = 0;
  readonly legOn = new Uint8Array(4);
  readonly legAt = new Float32Array(4);
  readonly legFar = new Uint8Array(4);
  readonly legA = new Float64Array(4);
  readonly legB = new Float64Array(4);
  readonly legR = new Float64Array(4); // hip radius
  readonly legFoot = new Float64Array(4);
  readonly legBend = new Float64Array(4);
  readonly legHome = new Float64Array(4);
  readonly hipX = new Float64Array(4);
  readonly hipY = new Float64Array(4);
  readonly kneeX = new Float64Array(4);
  readonly kneeY = new Float64Array(4);
  readonly ankX = new Float64Array(4);
  readonly ankY = new Float64Array(4);
  /** Contact point (planted: on the ground). */
  readonly footX = new Float64Array(4);
  readonly footY = new Float64Array(4);
  /** Step progress 0..1, or -1 when planted. */
  readonly stepU = new Float64Array(4);
  readonly stepX0 = new Float64Array(4);
  readonly stepY0 = new Float64Array(4);
  readonly stepX1 = new Float64Array(4);
  readonly legAir = new Uint8Array(4);
  /** Set by legs() when a foot lands this frame (for dust). */
  readonly landed = new Uint8Array(4);
  stepDist = 0.1;
  stepTime = 0.15;
  private readonly ikOut = new Float64Array(4);
  /** Last run-cycle swing value per leg (footfall detection). */
  private readonly runSw = new Float64Array(4);

  // ---- wings ----
  wingOn = false;
  wingAt = 0.1;
  wingArm = 0.04;
  fingers = 2;
  readonly fingerLen = new Float64Array(MAX_FINGERS);
  readonly fingerFan = new Float64Array(MAX_FINGERS);
  wingScallop = 0.4;
  /** Wing angle of the near wing this frame (rad) and the buzz blur half-angle. */
  wingAngle = 0;
  buzzSpread = 0;

  // ---- wing-arms (the wings are the forelegs: front leg slots LEG_FN / LEG_FF) ----
  /** True when the forelegs are wing-arms (then wingOn is false: no back wings). */
  armWing = false;
  /** Wing-arm poses (near, far): shoulder, elbow, wrist, finger tips, trailing root (x/y interleaved). */
  readonly armPose: readonly [WingPose, WingPose] = [
    { n: 0, pts: new Float32Array(2 * (MAX_FINGERS + 4)) },
    { n: 0, pts: new Float32Array(2 * (MAX_FINGERS + 4)) },
  ];
  /** How far each wing-arm is lifted into its wing pose this frame (0 planted .. 1 spread). */
  readonly armLift = new Float64Array(2);
  /** Membrane burn (dying): 0 whole .. 1 burnt away (the fingers shrink toward the wrist). */
  wingBurn = 0;

  // ---- gaits ----
  /** Run cycle phase (rad), frequency (Hz) and stride (fraction of each leg's reach). */
  runPhase = 0;
  runHz = 2;
  runStride = 0.4;

  // ---- ground ----
  /** Ground level (u, +y down). 0 = the stage ground. */
  groundY = 0;
  /**
   * Carry (set per frame by moves that travel far: flight paths, walks): the root offset
   * (C_X, C_Y) moves the whole body rigidly, a moving frame, instead of through the springs, which
   * then only animate the pose within it (no lag and no dangling behind a fast path).
   */
  carry = false;
  private rootX = 0;
  private rootY = 0;

  // ---- rock plates (laid out per individual in setup) ----
  plateN = 0;
  /** Near row then far row: center (fractional main-chain node index), half-width (nodes), height (u), lean, jag shape. */
  readonly plateI = new Float32Array(MAX_PLATES * 2);
  readonly plateW = new Float32Array(MAX_PLATES * 2);
  readonly plateH = new Float32Array(MAX_PLATES * 2);
  readonly plateLean = new Float32Array(MAX_PLATES * 2);
  readonly plateJ1 = new Float32Array(MAX_PLATES * 2);
  readonly plateJ2 = new Float32Array(MAX_PLATES * 2);
  readonly plateJ3 = new Float32Array(MAX_PLATES * 2);
  /** Far-row plates are stored after the near row: [plateN, plateN + plateFarN). */
  plateFarN = 0;
  /** Tallest plate over each main-chain node (u), for the hit test. */
  readonly nodePlate = new Float32Array(MAX_NODES);

  // ---- rock club outline (per individual): angle offset and radius factor per vertex ----
  readonly clubA = new Float32Array(CLUB_N);
  readonly clubR2 = new Float32Array(CLUB_N);

  private readonly sp: SpineSample = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };
  private readonly sp2: SpineSample = { x: 0, y: 0, nx: 0, ny: -1, back: 0, belly: 0 };

  // ------------------------------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------------------------------

  /** Build the rig for an individual, normalize the rest pose, and snap to it. */
  setup(ind: Individual): void {
    this.ind = ind;
    this.head.build(ind);
    this.heads = Math.max(1, Math.min(MAX_HEADS, ind.heads | 0));
    this.layout();
    // Measure at relative scale, then rescale so snout-to-tail = 1.
    this.derive(1);
    this.restPose();
    this.fitGround(1);
    const extent = this.measureLength();
    const k = extent > 1e-6 ? 1 / extent : 1;
    this.derive(k);
    this.restPose();
    this.fitGround(k);
    this.layoutRock(k);
    this.measureBounds();
    // Shift so the rest pose's front edge is x = 0 and snap everything to rest.
    const shift = -this.restMinX;
    this.restAx += shift;
    this.restMaxX += shift;
    this.restMinX = 0;
    this.restPose();
    this.midX = this.x[this.iS + (BODY_N >> 1)]!;
    this.snap();
  }

  /** Rig u -> placed u (turn-around mirror and world shift applied). */
  placeX(x: number): number {
    return this.midX + (x - this.midX) * this.ch[C_FACE]! + this.ch[C_SHIFT]!;
  }

  /** Placed u -> rig u (inverse of placeX; the mirror is clamped away from zero). */
  unplaceX(x: number): number {
    let f = this.ch[C_FACE]!;
    if (f > -0.15 && f < 0.15) f = f < 0 ? -0.15 : 0.15;
    return this.midX + (x - this.ch[C_SHIFT]! - this.midX) / f;
  }

  private layout(): void {
    const n = NECK_N + BODY_N + TAIL_N + 1;
    this.n = n;
    this.iS = NECK_N;
    this.iH = NECK_N + BODY_N;
    let total = n;
    this.headNode[0] = 0;
    for (let h = 1; h < this.heads; h++) {
      this.headNode[h] = total;
      total += NECK_N;
    }
    this.total = total;
    const L = this.leader;
    const P = this.prevT;
    const N = this.nextT;
    for (let i = 0; i < n; i++) {
      L[i] = i < this.iS ? i + 1 : i > this.iS ? i - 1 : -1;
      P[i] = i > 0 ? i - 1 : 0;
      N[i] = i < n - 1 ? i + 1 : n - 1;
    }
    for (let h = 1; h < this.heads; h++) {
      const b = this.headNode[h]!;
      for (let k = 0; k < NECK_N; k++) {
        const i = b + k;
        L[i] = k === NECK_N - 1 ? this.iS : i + 1;
        P[i] = k === 0 ? i : i - 1;
        N[i] = k === NECK_N - 1 ? this.iS : i + 1;
      }
    }
    // Leaders first: shoulder, neck upward, body/tail outward, then extra necks from their base.
    const o = this.order;
    let m = 0;
    o[m++] = this.iS;
    for (let i = this.iS - 1; i >= 0; i--) o[m++] = i;
    for (let i = this.iS + 1; i < n; i++) o[m++] = i;
    for (let h = 1; h < this.heads; h++) {
      const b = this.headNode[h]!;
      for (let k = NECK_N - 1; k >= 0; k--) o[m++] = b + k;
    }
  }

  /** Derive every length from the individual at `scale` (u per relative unit). */
  private derive(scale: number): void {
    const ind = this.ind;
    const n = this.n;
    const { iS, iH } = this;
    this.headLen = ind.headLen * scale;
    const neck = ind.neckLen * scale;
    const body = ind.bodyLen * scale;
    const tail = ind.tailLen * scale;
    this.tailLen = tail;
    this.crestH = ind.crest * scale;
    this.finH = ind.tailFin * scale;
    this.spadeLen = ind.tailSpade * scale;
    this.clubR = ind.tailClub * scale;
    const seg = this.segLen;
    for (let i = 0; i < n; i++) {
      if (i < iS) seg[i] = neck / NECK_N;
      else if (i === iS) seg[i] = 0;
      else if (i <= iH) seg[i] = body / BODY_N;
      else {
        // Tail segments shorten toward the tip (finer curls where it bends most).
        const u = (i - iH - 0.5) / TAIL_N;
        seg[i] = (tail / TAIL_N) * (1.35 - 0.7 * u);
      }
    }
    // Arc positions.
    let acc = 0;
    const s = this.s;
    s[0] = 0;
    for (let i = 1; i < n; i++) {
      acc += i <= iS ? seg[i - 1]! : seg[i]!;
      s[i] = acc;
    }
    for (let i = 0; i < n; i++) s[i] /= acc;
    // Width profile: keys at the head joint, shoulder, belly peak, hip, tail root, tip.
    const sS = s[iS]!;
    const sH = s[iH]!;
    const sB = sS + (sH - sS) * ind.bellyAt;
    const b0 = this.back0;
    const u0 = this.belly0;
    for (let i = 0; i < n; i++) {
      const si = s[i]!;
      let th: number;
      let share: number;
      if (si <= sS) {
        const t = smooth(si / Math.max(1e-6, sS));
        th = lerp(ind.thickNeck, ind.thickShoulder, t);
        share = lerp(0.5, ind.backShare, t);
      } else if (si <= sB) {
        th = lerp(ind.thickShoulder, ind.thickBelly, smooth((si - sS) / Math.max(1e-6, sB - sS)));
        share = ind.backShare;
      } else if (si <= sH) {
        th = lerp(ind.thickBelly, ind.thickHip, smooth((si - sB) / Math.max(1e-6, sH - sB)));
        share = ind.backShare;
      } else {
        const t = (si - sH) / Math.max(1e-6, 1 - sH);
        // Hip flows into the tail root, then a long taper.
        const root = lerp(ind.thickHip, ind.thickTail, smooth(Math.min(1, t * 5)));
        th = root * Math.pow(Math.max(0, 1 - t), 0.85) + 0.0025;
        share = lerp(ind.backShare, 0.5, smooth(Math.min(1, t * 3)));
      }
      b0[i] = th * share * 2 * scale;
      u0[i] = th * (1 - share) * 2 * scale;
    }
    // Gentle smoothing so section joins never kink.
    for (let pass = 0; pass < 2; pass++) {
      let pb = b0[0]!;
      let pu = u0[0]!;
      for (let i = 1; i < n - 1; i++) {
        const cb = b0[i]!;
        const cu = u0[i]!;
        b0[i] = (pb + 2 * cb + b0[i + 1]!) * 0.25;
        u0[i] = (pu + 2 * cu + u0[i + 1]!) * 0.25;
        pb = cb;
        pu = cu;
      }
    }
    // Extra necks copy the main neck's widths; the far one is longer, the near one shorter.
    for (let h = 1; h < this.heads; h++) {
      const b = this.headNode[h]!;
      const len = h === 1 ? 1.35 : 0.85;
      for (let k = 0; k < NECK_N; k++) {
        seg[b + k] = seg[k]! * len;
        s[b + k] = s[k]!;
        b0[b + k] = b0[k]! * 0.92;
        u0[b + k] = u0[k]! * 0.92;
      }
    }
    // Springs: stiff torso, medium neck, whippy tail.
    for (let i = 0; i < this.total; i++) {
      let w: number;
      let z: number;
      if (i >= n) {
        w = 24;
        z = 0.55;
      } else if (i < iS) {
        w = 22 + (i / iS) * 10;
        z = 0.55;
      } else if (i <= iH) {
        w = 34;
        z = 0.8;
      } else {
        const t = (i - iH) / TAIL_N;
        w = 26 * Math.pow(0.28, t) + 3;
        z = 0.42;
      }
      this.omega[i] = w;
      this.zeta[i] = z;
    }

    // Rest anchor: the shoulder, placed so the belly clears the ground by `clearance`.
    this.restAx = 0;
    this.restAy = -(this.belly0[iS]! + ind.clearance * scale);
    this.crouchDepth = Math.max(ind.clearance * scale, 0.02) + 0.35 * this.belly0[iS]!;

    // Legs. Wing-arms take the front slots (their bones: humerus = upper, forearm = lower).
    const pairs = Math.max(1, Math.min(2, ind.legPairs));
    const armWing = ind.wingWalk > 0.5 && ind.wingSpan > 0.005;
    this.armWing = armWing;
    this.legCount = 0;
    for (let k = 0; k < 4; k++) {
      const front = k < 2;
      const on = pairs === 2 || !front || armWing;
      this.legOn[k] = on ? 1 : 0;
      if (on) this.legCount++;
      this.legAt[k] = front ? ind.frontLegAt : ind.backLegAt;
      this.legFar[k] = k === LEG_FF || k === LEG_BF ? 1 : 0;
      this.legBend[k] = front ? -1 : 1;
      this.legR[k] = front && armWing ? ind.armWidth * scale : ind.legWidth * scale * (front ? 1 : 1.12);
    }
    // Leg lengths from the rest hip height (computed in restPose via legReach()).

    // Wings (back wings; wing-arms use the same finger set).
    this.wingOn = !armWing && ind.wingSpan > 0.005;
    this.wingAt = ind.wingAt;
    const span = ind.wingSpan * scale;
    this.wingArm = span * 0.42;
    this.fingers = Math.max(2, Math.min(MAX_FINGERS, ind.wingFingers | 0));
    const fl = [0.66, 0.56, 0.46, 0.38];
    const fan = [-0.2, 0.42, 0.95, 1.35];
    for (let f = 0; f < MAX_FINGERS; f++) {
      this.fingerLen[f] = span * fl[f]!;
      this.fingerFan[f] = fan[f]! * (this.fingers === 2 && f === 1 ? 1.5 : 1);
    }
    this.wingScallop = ind.wingScallop;
  }

  /** Leg reach from the current rest pose (called after the targets exist). */
  private deriveLegs(): void {
    const ind = this.ind;
    for (let k = 0; k < 4; k++) {
      if (!this.legOn[k]) continue;
      // From this leg's own hip (far legs sit a little higher and further back).
      this.hipAt(k);
      const hipY = this.hipY[k]!;
      const rA = this.legR[k]! * 0.55;
      const h = Math.max(0.01, -hipY - rA);
      if (this.armWing && k < 2) {
        // Wing-arm: a short humerus up and back to the elbow, a long forearm down to the wrist,
        // planted a little behind the shoulder (the folded arm is a tall peak over the shoulder).
        const reach = h * ind.armBend;
        this.legA[k] = reach * ind.armSplit;
        this.legB[k] = reach * (1 - ind.armSplit);
        this.legFoot[k] = reach * 0.09;
        this.legHome[k] = (this.legFar[k] ? 0.03 : 0.14) * h;
        continue;
      }
      const reach = h * ind.legBend;
      this.legA[k] = reach * ind.legSplit;
      this.legB[k] = reach * (1 - ind.legSplit);
      this.legFoot[k] = reach * ind.footLen;
      const front = k < 2;
      const far = this.legFar[k]!;
      this.legHome[k] = (front ? -0.28 : 0.06) * reach + (far ? (front ? 0.22 : -0.22) * reach : 0);
    }
    this.stepDist = 0.5 * Math.max(this.legA[LEG_BN]! + this.legB[LEG_BN]!, 0.02);
  }

  /** Channel values of the rest pose. */
  restChannels(out: Float64Array): void {
    const ind = this.ind;
    out.fill(0);
    out[C_PIVOT] = 0.5;
    out[C_ARCH] = ind.arch;
    out[C_NRAISE] = ind.neckRaise;
    out[C_NCURL] = ind.neckCurl;
    out[C_HPITCH] = ind.headTilt;
    out[C_HLEVEL] = 0.65;
    out[C_TCURL] = ind.tailCurl;
    out[C_TRAISE] = ind.tailDroop;
    out[C_TSTIFF] = 1;
    // Little wings held half-open like a baby dragon's; big ones fold. Wing-arms stand on their wrists.
    out[C_WSPREAD] = this.armWing ? 0 : 0.6 - 0.35 * ind.maturity;
    out[C_WLIFT] = -0.28 + 0.2 * ind.maturity;
    out[C_LOOKX] = -1;
    out[C_LOOKY] = -0.1;
    out[C_FACE] = 1;
  }

  /** Solve the rest pose into the node positions (targets + constraints, no dynamics). */
  private restPose(): void {
    this.restChannels(this.ch);
    this.target.set(this.ch);
    this.swayPhase = 0;
    this.solveTargets();
    for (let i = 0; i < this.total; i++) {
      this.x[i] = this.tx[i]!;
      this.y[i] = this.ty[i]!;
    }
    this.frames();
    this.deriveLegs();
    for (let h = 0; h < this.heads; h++) {
      this.headA[h] = this.headTarget(h);
      this.headX[h] = this.x[this.headNode[h]!]!;
      this.headY[h] = this.y[this.headNode[h]!]!;
    }
    for (let k = 0; k < 4; k++) {
      if (!this.legOn[k]) continue;
      this.hipAt(k);
      this.footX[k] = this.hipX[k]! + this.legHome[k]!;
      this.footY[k] = 0;
      this.stepU[k] = -1;
      this.legAir[k] = 0;
      this.solveLeg(k);
    }
    this.poseWings(0);
    this.poseArms();
  }

  /** Raise/lower the rest anchor so the lowest belly point clears the ground by `clearance`. */
  private fitGround(scale: number): void {
    let low = -Infinity;
    for (let i = this.iS; i <= this.iH; i++) if (this.uy[i]! > low) low = this.uy[i]!;
    this.restAy -= low + this.ind.clearance * scale;
    this.restPose();
  }

  /** Snout-to-tail-tip length of the current rest pose. */
  private measureLength(): number {
    const h = this.head;
    const a = this.headA[0]!;
    const sx = this.headX[0]! + this.headLen * (h.upper[16]! * Math.cos(a) - h.upper[17]! * Math.sin(a));
    const tip = this.x[this.n - 1]!;
    return tip - sx;
  }

  private measureBounds(): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const inc = (x: number, y: number): void => {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    };
    const n = this.n;
    for (let i = 0; i < n; i++) {
      inc(this.bx[i]!, this.by[i]! - this.crestHeightAt(i));
      inc(this.ux[i]!, this.uy[i]!);
    }
    // Tail tip features.
    const ind = this.ind;
    const tipR = Math.max(this.spadeLen * 0.7, this.clubR * 1.7);
    inc(this.x[n - 1]! + tipR, this.y[n - 1]! - tipR);
    // Rock plates (their peaks).
    for (let p = 0; p < this.plateN + this.plateFarN; p++) {
      this.platePeak(p, this.sp);
      inc(this.sp.x, this.sp.y);
    }
    // Heads (upper outline, jaw, horn tips, gill tips).
    const hs = this.head;
    for (let hh = 0; hh < this.heads; hh++) {
      const a = this.headA[hh]!;
      const c = Math.cos(a) * this.headLen;
      const s = Math.sin(a) * this.headLen;
      const ox = this.headX[hh]!;
      const oy = this.headY[hh]!;
      const pt = (px: number, py: number): void => inc(ox + px * c - py * s, oy + px * s + py * c);
      for (let i = 0; i < hs.upperN; i++) pt(hs.upper[i * 2]!, hs.upper[i * 2 + 1]!);
      for (let i = 0; i < hs.jawN; i++) pt(hs.jaw[i * 2]!, hs.jaw[i * 2 + 1]!);
      for (let k = 0; k < hs.hornN; k++) pt(hs.horns[k * 10 + 4]!, hs.horns[k * 10 + 5]!);
      for (let k = 0; k < hs.crownN; k++) pt(hs.crown[k * 6 + 2]!, hs.crown[k * 6 + 3]!);
      for (let k = 0; k < hs.gillN; k++) {
        const g = k * 5;
        const ga = hs.gills[g + 2]!;
        const gl = hs.gills[g + 3]!;
        pt(hs.gills[g]! + Math.cos(ga) * gl, hs.gills[g + 1]! + Math.sin(ga) * gl);
      }
    }
    // Legs and toes.
    for (let k = 0; k < 4; k++) {
      if (!this.legOn[k]) continue;
      inc(this.footX[k]! - this.legFoot[k]!, 0);
      inc(this.hipX[k]!, this.hipY[k]!);
      inc(this.kneeX[k]! + this.legR[k]!, this.kneeY[k]!);
      if (this.armWing && k < 2) inc(this.kneeX[k]!, this.kneeY[k]! - this.legR[k]! * 1.6);
    }
    // Wings at rest.
    if (this.wingOn) {
      const w = this.wingPose;
      for (let i = 0; i < w.n; i++) inc(w.pts[i * 2]!, w.pts[i * 2 + 1]!);
    }
    if (this.armWing) {
      for (let a = 0; a < 2; a++) {
        const w = this.armPose[a]!;
        for (let i = 0; i < w.n; i++) inc(w.pts[i * 2]!, w.pts[i * 2 + 1]!);
      }
    }
    this.restMinX = x0;
    this.restMinY = y0;
    this.restMaxX = x1;
    this.restMaxY = Math.max(y1, 0);
  }

  /** Jump the dynamic state to the targets (no velocity), plant the feet. */
  snap(): void {
    this.rootX = this.ch[C_X]!;
    this.rootY = this.ch[C_Y]!;
    for (let i = 0; i < this.total; i++) {
      this.x[i] = this.tx[i]!;
      this.y[i] = this.ty[i]!;
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.frames();
    for (let h = 0; h < this.heads; h++) {
      this.headA[h] = this.headTarget(h);
      this.headAV[h] = 0;
      this.lastHeadA[h] = this.headA[h]!;
      this.gillSway[h] = 0;
      this.gillV[h] = 0;
      this.headX[h] = this.x[this.headNode[h]!]!;
      this.headY[h] = this.y[this.headNode[h]!]!;
    }
    for (let k = 0; k < 4; k++) {
      if (!this.legOn[k]) continue;
      this.hipAt(k);
      const air = this.ch[C_AIR]! > 0.5 || (this.armWing && k < 2 && this.ch[C_WSPREAD]! >= 0.5);
      this.footX[k] = this.hipX[k]! + this.legHome[k]!;
      this.footY[k] = air ? this.hipY[k]! + (this.legA[k]! + this.legB[k]!) * 0.8 : this.groundY;
      this.stepU[k] = -1;
      this.legAir[k] = air ? 1 : 0;
      this.solveLeg(k);
    }
    this.poseWings(0);
    this.poseArms();
  }

  // ------------------------------------------------------------------------------------------
  // Per frame
  // ------------------------------------------------------------------------------------------

  /** Advance channels, pose, dynamics, legs and wings by dt (scaled seconds). */
  update(dt: number): void {
    if (dt <= 0) {
      // Frozen (hit-stop, pause): nothing moves, so nothing lands.
      this.landed.fill(0);
      return;
    }
    const ch = this.ch;
    const tg = this.target;
    for (let c = 0; c < NCH; c++) {
      const r = RATE[c]!;
      ch[c] = r === 0 ? tg[c]! : ch[c]! + (tg[c]! - ch[c]!) * (1 - Math.exp(-r * dt));
    }
    this.swayPhase += dt * this.swayHz * Math.PI * 2 * this.tempo;
    this.flapPhase += dt * this.flapHz * Math.PI * 2;
    this.buzzPhase += dt * this.buzzHz * Math.PI * 2;
    if (this.swayPhase > 1e4) this.swayPhase -= 1e4 - (1e4 % (Math.PI * 2));
    if (this.flapPhase > 1e4) this.flapPhase -= 1e4 - (1e4 % (Math.PI * 2));
    if (this.buzzPhase > 1e4) this.buzzPhase -= 1e4 - (1e4 % (Math.PI * 2));
    this.runPhase += dt * this.runHz * Math.PI * 2;
    if (this.runPhase > 1e4) this.runPhase -= 1e4 - (1e4 % (Math.PI * 2));

    this.solveTargets();
    if (this.carry) this.carryBody();
    this.rootX = ch[C_X]!;
    this.rootY = ch[C_Y]!;
    this.simulate(dt);
    this.frames();
    this.updateHeads(dt);
    this.updateLegs(dt);
    this.poseWings(dt);
    this.poseArms();
  }

  /** Move the body (and airborne feet) with this frame's change of the root offset. */
  private carryBody(): void {
    const dx = this.ch[C_X]! - this.rootX;
    const dy = this.ch[C_Y]! - this.rootY;
    if (dx === 0 && dy === 0) return;
    for (let i = 0; i < this.total; i++) {
      this.x[i] = this.x[i]! + dx;
      this.y[i] = this.y[i]! + dy;
    }
    for (let k = 0; k < 4; k++) {
      if (!this.legOn[k] || !this.legAir[k]) continue;
      this.footX[k] = this.footX[k]! + dx;
      this.footY[k] = this.footY[k]! + dy;
    }
  }

  /** Channels -> target node positions (forward kinematics, pitch, tail IK, ground). */
  solveTargets(): void {
    const ch = this.ch;
    const { iS, iH, n } = this;
    const tx = this.tx;
    const ty = this.ty;
    const seg = this.segLen;
    tx[iS] = this.restAx + ch[C_X]!;
    ty[iS] = this.restAy + ch[C_Y]! + ch[C_CROUCH]! * this.crouchDepth;
    // Torso: a gentle arch, tilted chest-up by the species' stance.
    const arch = ch[C_ARCH]!;
    const tilt = this.ind.tilt;
    let a = 0;
    for (let j = iS; j < iH; j++) {
      const u = (j - iS + 0.5) / BODY_N;
      a = tilt - arch + 2 * arch * u;
      tx[j + 1] = tx[j]! + seg[j + 1]! * Math.cos(a);
      ty[j + 1] = ty[j]! + seg[j + 1]! * Math.sin(a);
    }
    // Neck: S-curve from the shoulder up to the head joint.
    const raise = ch[C_NRAISE]!;
    const curl = ch[C_NCURL]!;
    this.neckFK(iS - 1, 0, 0, raise, curl);
    // Extra necks fan out like a hydra's: the far one high and long, the near one low and short.
    for (let h = 1; h < this.heads; h++) {
      const b = this.headNode[h]!;
      const off = h === 1 ? 0.85 : -0.55;
      this.neckFK(b + NECK_N - 1, b, off, raise, curl * (h === 1 ? 0.7 : 1.3));
    }
    // Tail: droop + curl + traveling sway wave.
    const droop = ch[C_TRAISE]!;
    const tcurl = ch[C_TCURL]!;
    const sway = ch[C_SWAY]!;
    const droopDown = ch[C_DROOP]!;
    const ph = this.swayPhase;
    for (let j = iH; j < n - 1; j++) {
      const u = (j - iH + 0.5) / TAIL_N;
      const ta = a + droop + tcurl * u * u + sway * Math.sin(ph - u * 4.2) * Math.pow(u, 0.8) + droopDown * 0.5 * u;
      tx[j + 1] = tx[j]! + seg[j + 1]! * Math.cos(ta);
      ty[j + 1] = ty[j]! + seg[j + 1]! * Math.sin(ta);
    }
    // Pitch about the pivot (a point along the torso).
    const pitch = ch[C_PITCH]!;
    if (pitch !== 0) {
      const pf = iS + clamp01(ch[C_PIVOT]!) * BODY_N;
      const p0 = Math.floor(pf);
      const pt = pf - p0;
      const p1 = Math.min(n - 1, p0 + 1);
      const px = tx[p0]! + (tx[p1]! - tx[p0]!) * pt;
      const py = ty[p0]! + (ty[p1]! - ty[p0]!) * pt;
      const c = Math.cos(pitch);
      const s = Math.sin(pitch);
      for (let i = 0; i < this.total; i++) {
        const dx = tx[i]! - px;
        const dy = ty[i]! - py;
        tx[i] = px + dx * c - dy * s;
        ty[i] = py + dx * s + dy * c;
      }
    }
    // Spin: the whole body rotates about its middle (front flip).
    const spin = ch[C_SPIN]!;
    if (spin !== 0) {
      const cf = iS + 0.5 * BODY_N;
      const c0 = Math.floor(cf);
      const px = (tx[c0]! + tx[c0 + 1]!) * 0.5;
      const py = (ty[c0]! + ty[c0 + 1]!) * 0.5;
      const c = Math.cos(spin);
      const s = Math.sin(spin);
      for (let i = 0; i < this.total; i++) {
        const dx = tx[i]! - px;
        const dy = ty[i]! - py;
        tx[i] = px + dx * c - dy * s;
        ty[i] = py + dx * s + dy * c;
      }
    }
    // Tail IK (FABRIK) toward a target, blended in.
    const w = ch[C_TIK]!;
    if (w > 0.001) this.tailIK(w, ch[C_TIKX]!, ch[C_TIKY]!);
    // Keep the targets out of the ground (the tail lies on it rather than through it).
    const g = this.groundY;
    for (let i = iS; i < n; i++) {
      const lim = g - this.belly0[i]!;
      if (ty[i]! > lim) ty[i] = lim;
    }
  }

  private neckFK(first: number, last: number, off: number, raise: number, curl: number): void {
    const tx = this.tx;
    const ty = this.ty;
    const seg = this.segLen;
    const lead = this.iS;
    // Nodes from first (next to the shoulder) down to last (the head joint).
    let px = tx[lead]!;
    let py = ty[lead]!;
    const count = first - last + 1;
    for (let k = 0; k < count; k++) {
      const i = first - k;
      const u = (k + 0.5) / count;
      const e = raise + off * (1 - u * 0.5) + curl * (1 - 2 * u);
      const len = seg[i]!;
      px -= len * Math.cos(e);
      py -= len * Math.sin(e);
      tx[i] = px;
      ty[i] = py;
    }
  }

  private tailIK(w: number, gx: number, gy: number): void {
    const { iH, n } = this;
    const kx = this.kx;
    const ky = this.ky;
    const seg = this.segLen;
    for (let i = iH; i < n; i++) {
      kx[i] = this.tx[i]!;
      ky[i] = this.ty[i]!;
    }
    const rx = kx[iH]!;
    const ry = ky[iH]!;
    for (let it = 0; it < 4; it++) {
      // Backward: tip to the goal.
      kx[n - 1] = gx;
      ky[n - 1] = gy;
      for (let i = n - 2; i >= iH; i--) {
        const dx = kx[i]! - kx[i + 1]!;
        const dy = ky[i]! - ky[i + 1]!;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const l = seg[i + 1]!;
        kx[i] = kx[i + 1]! + (dx / d) * l;
        ky[i] = ky[i + 1]! + (dy / d) * l;
      }
      // Forward: root back to the hip.
      kx[iH] = rx;
      ky[iH] = ry;
      for (let i = iH + 1; i < n; i++) {
        const dx = kx[i]! - kx[i - 1]!;
        const dy = ky[i]! - ky[i - 1]!;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const l = seg[i]!;
        kx[i] = kx[i - 1]! + (dx / d) * l;
        ky[i] = ky[i - 1]! + (dy / d) * l;
      }
    }
    for (let i = iH + 1; i < n; i++) {
      this.tx[i] = this.tx[i]! + (kx[i]! - this.tx[i]!) * w;
      this.ty[i] = this.ty[i]! + (ky[i]! - this.ty[i]!) * w;
    }
  }

  /** Springs toward the targets in fixed substeps + follow-the-leader + ground. */
  private simulate(dt: number): void {
    const total = this.total;
    const x = this.x;
    const y = this.y;
    const vx = this.vx;
    const vy = this.vy;
    if (dt > 0.2) {
      // Huge steps (debug time scale): settle onto the targets.
      for (let i = 0; i < total; i++) {
        x[i] = this.tx[i]!;
        y[i] = this.ty[i]!;
        vx[i] = vy[i] = 0;
      }
      this.constrain();
      return;
    }
    const steps = Math.min(12, Math.max(1, Math.ceil(dt * 120)));
    const h = dt / steps;
    const tempo = this.tempo;
    const tailStiff = this.ch[C_TSTIFF]!;
    const iH = this.iH;
    const n = this.n;
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < total; i++) {
        let w = this.omega[i]! * tempo;
        if (i > iH && i < n) w *= tailStiff;
        const z = this.zeta[i]!;
        const ax = w * w * (this.tx[i]! - x[i]!) - 2 * z * w * vx[i]!;
        const ay = w * w * (this.ty[i]! - y[i]!) - 2 * z * w * vy[i]!;
        vx[i] = vx[i]! + ax * h;
        vy[i] = vy[i]! + ay * h;
        // Stash the pre-constraint position in the IK scratch to recover velocities.
        this.kx[i] = x[i]!;
        this.ky[i] = y[i]!;
        x[i] = x[i]! + vx[i]! * h;
        y[i] = y[i]! + vy[i]! * h;
      }
      this.constrain();
      const ih = 1 / h;
      for (let i = 0; i < total; i++) {
        // Constraint corrections become velocity (position-based dynamics), lightly damped.
        vx[i] = (x[i]! - this.kx[i]!) * ih;
        vy[i] = (y[i]! - this.ky[i]!) * ih;
      }
    }
  }

  /** Follow-the-leader distances + ground, in leader order. */
  private constrain(): void {
    const x = this.x;
    const y = this.y;
    const o = this.order;
    const seg = this.segLen;
    const lead = this.leader;
    for (let m = 1; m < this.total; m++) {
      const i = o[m]!;
      const l = lead[i]!;
      const dx = x[i]! - x[l]!;
      const dy = y[i]! - y[l]!;
      const d = Math.sqrt(dx * dx + dy * dy);
      const len = seg[i]!;
      if (d > 1e-9) {
        const k = len / d;
        x[i] = x[l]! + dx * k;
        y[i] = y[l]! + dy * k;
      } else {
        x[i] = x[l]! + len;
      }
    }
    const iS = this.iS;
    const g = this.groundY;
    for (let i = iS; i < this.n; i++) {
      const lim = g - this.belly[i]! * 0.9;
      if (y[i]! > lim) y[i] = lim;
    }
    // Heads: keep the chin above the ground.
    for (let h = 0; h < this.heads; h++) {
      const i = this.headNode[h]!;
      const lim = g - this.headLen * 0.28;
      if (y[i]! > lim) y[i] = lim;
    }
  }

  /** Normals, live widths (swell), outline points. */
  frames(): void {
    const ch = this.ch;
    const n = this.n;
    const { iS } = this;
    const sS = this.s[iS]!;
    const sH = this.s[this.iH]!;
    const chest = ch[C_CHEST]!;
    const throat = ch[C_THROAT]!;
    const chestC = sS + (sH - sS) * 0.3;
    const chestW = (sH - sS) * 0.45;
    const throatC = sS * 0.55;
    const throatW = sS * 0.55 + 0.03;
    for (let i = 0; i < this.total; i++) {
      const p = this.prevT[i]!;
      const q = this.nextT[i]!;
      let dx = this.x[q]! - this.x[p]!;
      let dy = this.y[q]! - this.y[p]!;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-9) {
        dx /= d;
        dy /= d;
      } else {
        dx = 1;
        dy = 0;
      }
      this.nx[i] = dy;
      this.ny[i] = -dx;
      const si = this.s[i]!;
      let fb = 1;
      let fu = 1;
      if (i < n) {
        const kc = bump(si, chestC, chestW);
        fb += 0.14 * chest * kc;
        fu += 0.42 * chest * kc;
      }
      const kt = bump(si, throatC, throatW);
      fu += 0.75 * throat * kt;
      fb += 0.12 * throat * kt;
      this.back[i] = this.back0[i]! * fb;
      this.belly[i] = this.belly0[i]! * fu;
      this.bx[i] = this.x[i]! + this.nx[i]! * this.back[i]!;
      this.by[i] = this.y[i]! + this.ny[i]! * this.back[i]!;
      this.ux[i] = this.x[i]! - this.nx[i]! * this.belly[i]!;
      this.uy[i] = this.y[i]! - this.ny[i]! * this.belly[i]!;
    }
  }

  /** Head target angle: follows the neck partially, levels, looks, plus pitch offsets. */
  headTarget(h: number): number {
    const ch = this.ch;
    const i = this.headNode[h]!;
    const j = this.leader[i]!;
    // Neck top direction (joint relative to the node below it), as a head angle.
    const dx = this.x[i]! - this.x[j]!;
    const dy = this.y[i]! - this.y[j]!;
    const neckA = Math.atan2(-dy, -dx);
    const level = clamp01(ch[C_HLEVEL]!);
    let a = neckA * (1 - level) + ch[C_HPITCH]! + (h === 0 ? 0 : h === 1 ? 0.2 : -0.15);
    const lw = ch[C_LOOK]!;
    if (lw > 0.001) {
      const lx = ch[C_LOOKX]! - this.x[i]!;
      const ly = ch[C_LOOKY]! - this.y[i]!;
      let la = Math.atan2(-ly, -lx);
      if (la > 0.55) la = 0.55;
      if (la < -0.7) la = -0.7;
      a += (la - a) * lw * 0.7;
    }
    return a;
  }

  private updateHeads(dt: number): void {
    for (let h = 0; h < this.heads; h++) {
      // Target expressed next to the current angle (wrap-safe through full spins).
      const t = this.headA[h]! + wrapPi(this.headTarget(h) - this.headA[h]!);
      const w = 20 * this.tempo;
      const z = 0.62;
      // Semi-implicit Euler in substeps for stability at low frame rates.
      const steps = Math.min(8, Math.max(1, Math.ceil(dt * 120)));
      const hh = dt / steps;
      for (let s = 0; s < steps; s++) {
        const a2 = w * w * (t - this.headA[h]!) - 2 * z * w * this.headAV[h]!;
        this.headAV[h] = this.headAV[h]! + a2 * hh;
        this.headA[h] = this.headA[h]! + this.headAV[h]! * hh;
      }
      // Keep the stored angle near zero so it never drifts by whole turns.
      if (this.headA[h]! > Math.PI) {
        this.headA[h] = this.headA[h]! - Math.PI * 2;
        this.lastHeadA[h] = this.lastHeadA[h]! - Math.PI * 2;
      } else if (this.headA[h]! < -Math.PI) {
        this.headA[h] = this.headA[h]! + Math.PI * 2;
        this.lastHeadA[h] = this.lastHeadA[h]! + Math.PI * 2;
      }
      this.headX[h] = this.x[this.headNode[h]!]!;
      this.headY[h] = this.y[this.headNode[h]!]!;
      // Gills lag behind head rotation (secondary motion) and sag when limp.
      const da = this.headA[h]! - this.lastHeadA[h]!;
      this.lastHeadA[h] = this.headA[h]!;
      const gw = 14;
      const gz = 0.3;
      const gTarget = this.ch[C_DROOP]! * 0.6;
      this.gillV[h] = this.gillV[h]! + (gw * gw * (gTarget - this.gillSway[h]!) - 2 * gz * gw * this.gillV[h]!) * dt - da * 18;
      this.gillSway[h] = this.gillSway[h]! + this.gillV[h]! * dt;
      if (this.gillSway[h]! > 1.2) this.gillSway[h] = 1.2;
      if (this.gillSway[h]! < -1.2) this.gillSway[h] = -1.2;
    }
  }

  /** Add an angular kick to a head (flinch, recoil). */
  kickHead(h: number, av: number): void {
    if (h < this.heads) this.headAV[h] = this.headAV[h]! + av;
  }

  /** Velocity impulse on spine nodes near (px, py) (u), falling off with distance. */
  impulse(px: number, py: number, ix: number, iy: number, radius: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.total; i++) {
      const dx = this.x[i]! - px;
      const dy = this.y[i]! - py;
      const f = Math.exp(-(dx * dx + dy * dy) / r2);
      if (f < 0.02) continue;
      this.vx[i] = this.vx[i]! + ix * f;
      this.vy[i] = this.vy[i]! + iy * f;
    }
  }

  // ---- legs ----

  private hipAt(k: number): void {
    this.spineAtBody(this.legAt[k]!, this.sp);
    const far = this.legFar[k]!;
    if (this.armWing && k < 2) {
      // The wing-arm's shoulder sits high on the chest (the wing root), not under the belly.
      this.hipX[k] = this.sp.x + this.sp.nx * this.sp.back * 0.3 + (far ? 0.012 : 0);
      this.hipY[k] = this.sp.y + this.sp.ny * this.sp.back * 0.3 - (far ? 0.01 : 0);
      return;
    }
    this.hipX[k] = this.sp.x - this.sp.nx * this.sp.belly * 0.42 + (far ? 0.012 : 0);
    this.hipY[k] = this.sp.y - this.sp.ny * this.sp.belly * 0.42 - (far ? 0.01 : 0);
  }

  private solveLeg(k: number): void {
    if (this.armWing && k < 2) {
      this.solveArm(k);
      return;
    }
    const rA = this.legR[k]! * 0.55;
    ik2(this.hipX[k]!, this.hipY[k]!, this.footX[k]!, this.footY[k]! - rA, this.legA[k]!, this.legB[k]!, this.legBend[k]!, this.ikOut);
    this.kneeX[k] = this.ikOut[0]!;
    this.kneeY[k] = this.ikOut[1]!;
    this.ankX[k] = this.ikOut[2]!;
    this.ankY[k] = this.ikOut[3]!;
    // Deep crouches: keep the knee (its radius) above the ground; a real knee would splay sideways.
    const kr = this.legR[k]! * 0.68;
    if (this.kneeY[k]! > -kr) this.kneeY[k] = -kr;
  }

  /**
   * A wing-arm: two-bone IK to the planted wrist (the elbow juts up and back), then blended by angle
   * toward the spread wing pose as the arm lifts (armLift). The folded arm is nearly closed, so when
   * the chest dips too low for it the wrist slides along the ground instead of the IK flipping.
   */
  private solveArm(k: number): void {
    const hx = this.hipX[k]!;
    const hy = this.hipY[k]!;
    const a = this.legA[k]!;
    const b = this.legB[k]!;
    let tx = this.footX[k]!;
    // The wrist rests on its knuckle pad (drawn at 0.78 of the arm radius).
    const ty = this.footY[k]! - this.legR[k]! * 0.8;
    const minD = Math.abs(b - a) * 1.04;
    const dy = ty - hy;
    let dx = tx - hx;
    if (dx * dx + dy * dy < minD * minD) {
      const need = Math.sqrt(Math.max(0, minD * minD - dy * dy));
      dx = dx >= 0 ? need : -need;
      tx = hx + dx;
    }
    ik2(hx, hy, tx, ty, a, b, this.legBend[k]!, this.ikOut);
    let ex = this.ikOut[0]!;
    let ey = this.ikOut[1]!;
    let wx = this.ikOut[2]!;
    let wy = this.ikOut[3]!;
    const lift = clamp01(this.ch[C_WSPREAD]!);
    const slot = k === LEG_FF ? 1 : 0;
    this.armLift[slot] = lift;
    if (lift > 0.001) {
      // Spread pose, relative to the body line at the shoulder (tangent toward the tail).
      this.spineAtBody(this.legAt[k]!, this.sp);
      const bodyA = Math.atan2(this.sp.nx, -this.sp.ny);
      const ch = this.ch;
      const amp = ch[C_WFLAP]!;
      const ph = this.flapPhase;
      const flap = amp * Math.sin(ph);
      const lf = ch[C_WLIFT]! + ch[C_DROOP]! * 0.45 - (slot ? 0.12 : 0);
      const hS = bodyA - 1.95 + lf + flap;
      const fS = hS + 1.2 + amp * 0.55 * Math.sin(ph - 0.9) + ch[C_DROOP]! * 0.4;
      const hI = Math.atan2(ey - hy, ex - hx);
      const fI = Math.atan2(wy - ey, wx - ex);
      const h = hI + wrapPi(hS - hI) * lift;
      // The forearm swings back and up past the flank (never forward through the chest).
      const f = fI + (wrapPi(fS - fI + 2.2) - 2.2) * lift;
      ex = hx + Math.cos(h) * a;
      ey = hy + Math.sin(h) * a;
      wx = ex + Math.cos(f) * b;
      wy = ey + Math.sin(f) * b;
    }
    this.kneeX[k] = ex;
    this.kneeY[k] = ey;
    this.ankX[k] = wx;
    this.ankY[k] = wy;
  }

  private updateLegs(dt: number): void {
    const air = this.ch[C_AIR]! > 0.5;
    const bodyVx = this.vx[this.iS]!;
    const stepTime = this.stepTime / Math.max(0.3, this.tempo);
    const g = this.groundY;
    const run = this.ch[C_RUN]!;
    for (let k = 0; k < 4; k++) {
      this.landed[k] = 0;
      if (!this.legOn[k]) continue;
      this.hipAt(k);
      const reach = this.legA[k]! + this.legB[k]!;
      const arm = this.armWing && k < 2;
      // A wing-arm lifted into its wing pose is off the ground like an airborne leg.
      const armUp = arm && this.ch[C_WSPREAD]! >= 0.5;
      if (air || armUp) {
        let tx: number;
        let ty: number;
        if (!air) {
          // Standing with the wing raised: the wrist hovers over the spot it will plant on.
          tx = this.hipX[k]! + this.legHome[k]!;
          ty = g;
        } else if (arm || this.ch[C_TUCK]! === 0) {
          // Dangling: feet hang under the hips, trailing a little.
          tx = this.hipX[k]! + this.legHome[k]! * 0.3 + 0.25 * reach;
          ty = this.hipY[k]! + reach * 0.72;
        } else {
          // Tucked back for flight (C_TUCK > 0) or reaching down for a landing (< 0).
          const tk = this.ch[C_TUCK]!;
          const bk = tk > 0 ? tk : 0;
          const fw = tk < 0 ? -tk : 0;
          const dxD = this.legHome[k]! * 0.3 + 0.25 * reach;
          const dyD = reach * 0.72;
          tx = this.hipX[k]! + dxD + (0.62 * reach - dxD) * bk + (this.legHome[k]! * 0.5 - 0.2 * reach - dxD) * fw;
          ty = this.hipY[k]! + dyD + (0.3 * reach - dyD) * bk + (0.93 * reach - dyD) * fw;
        }
        const f = 1 - Math.exp(-18 * dt);
        this.footX[k] = this.footX[k]! + (tx - this.footX[k]!) * f;
        this.footY[k] = this.footY[k]! + (ty - this.footY[k]!) * f;
        this.legAir[k] = 1;
        this.stepU[k] = -1;
      } else if (this.legAir[k]) {
        // Touchdown: plant where it is, then step home if needed.
        this.legAir[k] = 0;
        const home = this.hipX[k]! + this.legHome[k]!;
        if (arm && Math.abs(this.footX[k]! - home) < this.stepDist * 0.4 && this.footY[k]! > g - reach * 0.08) {
          // A wing-arm folding down onto the spot it hovered over: planted, no extra step.
          this.stepU[k] = -1;
          this.footY[k] = g;
          this.landed[k] = 1;
        } else {
          this.stepU[k] = 0;
          this.stepX0[k] = this.footX[k]!;
          this.stepY0[k] = Math.min(g, this.footY[k]!);
          this.stepX1[k] = home;
        }
      } else if (run > 0.001) {
        // Run cycle: feet swing around their homes (diagonal pairs together), lifted on the swing.
        const ph = this.runPhase + (k === LEG_FN || k === LEG_BF ? 0 : Math.PI) + (arm ? 0.5 : 0);
        const sw = Math.sin(ph);
        const cx = this.hipX[k]! + this.legHome[k]! + this.runStride * reach * Math.cos(ph);
        const cy = g - (sw > 0 ? sw * reach * 0.3 : 0);
        const w = run > 0.999 ? 1 : run;
        this.footX[k] = this.footX[k]! + (cx - this.footX[k]!) * w;
        this.footY[k] = this.footY[k]! + (cy - this.footY[k]!) * w;
        if (sw <= 0 && this.runSw[k]! > 0) this.landed[k] = 1;
        this.runSw[k] = sw;
        this.stepU[k] = -1;
      } else if (this.stepU[k]! >= 0) {
        let u = this.stepU[k]! + dt / stepTime;
        // Re-aim the landing so fast bodies don't leave the feet behind.
        const home = this.hipX[k]! + this.legHome[k]! + bodyVx * stepTime * 0.5;
        this.stepX1[k] = this.stepX1[k]! + (home - this.stepX1[k]!) * Math.min(1, dt * 10);
        if (u >= 1) {
          u = -1;
          this.footX[k] = this.stepX1[k]!;
          this.footY[k] = g;
          this.landed[k] = 1;
        } else {
          const e = u * u * (3 - 2 * u);
          this.footX[k] = this.stepX0[k]! + (this.stepX1[k]! - this.stepX0[k]!) * e;
          this.footY[k] = (this.stepY0[k]! - g) * (1 - e) + g - Math.sin(Math.PI * u) * reach * 0.32;
        }
        this.stepU[k] = u;
      } else if (this.footY[k]! < g - 1e-4) {
        // Left in the air by the run cycle: step down (home) instead of hovering there.
        this.stepU[k] = 0;
        this.stepX0[k] = this.footX[k]!;
        this.stepY0[k] = this.footY[k]!;
        this.stepX1[k] = this.hipX[k]! + this.legHome[k]!;
      } else {
        const home = this.hipX[k]! + this.legHome[k]!;
        const err = this.footX[k]! - home;
        const lim = this.stepDist;
        // Also step if the leg is overstretched toward a displaced foot (the body moved off it).
        // Measured to the ankle target the IK reaches for; a purely vertical stretch (the body
        // rose) can't be fixed by stepping, so the foot just stays planted.
        const hx = this.footX[k]! - this.hipX[k]!;
        const hy = this.footY[k]! - this.legR[k]! * 0.55 - this.hipY[k]!;
        const over = hx * hx + hy * hy > reach * reach * 1.02 && Math.abs(err) > lim * 0.3;
        if (Math.abs(err) > lim || over) {
          const group = k === LEG_FN || k === LEG_BF ? 0 : 1;
          let blocked = false;
          for (let o = 0; o < 4; o++) {
            if (o === k || !this.legOn[o] || this.stepU[o]! < 0) continue;
            const og = o === LEG_FN || o === LEG_BF ? 0 : 1;
            if (og !== group) blocked = true;
          }
          if (!blocked || Math.abs(err) > lim * 2.2) {
            this.stepU[k] = 0;
            this.stepX0[k] = this.footX[k]!;
            this.stepY0[k] = g;
            this.stepX1[k] = home + bodyVx * stepTime * 0.5;
          }
        }
      }
      this.solveLeg(k);
    }
  }

  // ---- wing-arms ----

  /** Finger tips and membrane outline of both wing-arms from the solved arm bones (allocation-free). */
  private poseArms(): void {
    if (!this.armWing) return;
    const ch = this.ch;
    const amp = ch[C_WFLAP]!;
    const ph = this.flapPhase;
    // Fold a little on the upstroke; the finger tips whip behind the stroke.
    const upstroke = amp * Math.max(0, -Math.sin(ph));
    const whip = amp * 0.35 * Math.sin(ph - 1.7);
    const burn = 1 - this.wingBurn;
    const F = this.fingers;
    const root = this.ind.wingRoot > 0 ? this.ind.wingRoot : this.wingAt + 0.34;
    for (let slot = 0; slot < 2; slot++) {
      const k = slot === 0 ? LEG_FN : LEG_FF;
      const w = this.armPose[slot]!;
      const p = w.pts;
      const ex = this.kneeX[k]!;
      const ey = this.kneeY[k]!;
      const wx = this.ankX[k]!;
      const wy = this.ankY[k]!;
      p[0] = this.hipX[k]!;
      p[1] = this.hipY[k]!;
      p[2] = ex;
      p[3] = ey;
      p[4] = wx;
      p[5] = wy;
      const fore = Math.atan2(wy - ey, wx - ex);
      // The hand folds first and opens last: the fingers unfold once the arm is well up, and fold
      // back along the forearm before it comes down.
      const open = smooth((this.armLift[slot]! - 0.4) / 0.55);
      for (let f = 0; f < F; f++) {
        // Folded: the hand lies back along the forearm (the tips reach up past the elbow).
        const fold = Math.PI + 0.12 + 0.16 * f;
        const u = F > 1 ? f / (F - 1) : 0;
        const spread = (0.3 + 1.55 * u) * (1 - 0.3 * upstroke) + whip * (0.5 + 0.5 * u);
        const a = fore + fold + (spread - fold) * open;
        const len = this.fingerLen[f]! * (0.9 + 0.1 * open) * burn;
        p[6 + f * 2] = wx + Math.cos(a) * len;
        // A sagging wing rests its tips on the ground rather than through it.
        const ty = wy + Math.sin(a) * len;
        p[7 + f * 2] = ty > this.groundY - 0.004 ? this.groundY - 0.004 : ty;
      }
      // The trailing edge meets the body behind the hip when open (a little higher on the far side);
      // folded, the slack membrane hangs to the hind knee: a dark web between arm and leg.
      this.spineAtBody(root, this.sp2);
      const o = this.sp2.back * (0.35 + slot * 0.2);
      const sx = this.sp2.x + this.sp2.nx * o;
      const sy = this.sp2.y + this.sp2.ny * o;
      const kl = slot === 0 ? LEG_BN : LEG_BF;
      const fx = this.legOn[kl] ? this.kneeX[kl]! : sx;
      const fy = this.legOn[kl] ? this.kneeY[kl]! : sy;
      p[6 + F * 2] = fx + (sx - fx) * open;
      p[7 + F * 2] = fy + (sy - fy) * open;
      w.n = F + 4;
    }
  }

  // ---- rock ----

  /** Lay out the rock plates and the rock club (the individual's own seeded stream). */
  private layoutRock(scale: number): void {
    const ind = this.ind;
    this.plateN = 0;
    this.plateFarN = 0;
    this.nodePlate.fill(0);
    const N = Math.min(MAX_PLATES, ind.plateCount | 0);
    const H = ind.plates * scale;
    if (N > 0 && H > 1e-6) {
      const rng = new Rng((ind.seed ^ 0x9a7e5c1d) >>> 0);
      const s0 = ind.plateFrom;
      const span = Math.max(0.02, ind.plateTo - s0);
      const step = span / N;
      const jag = ind.plateJag;
      // Near row, then a far row staggered between them (drawn behind the body, hazier).
      for (let row = 0; row < 2; row++) {
        const count = row === 0 ? N : N - 1;
        for (let q = 0; q < count; q++) {
          const i = row === 0 ? q : N + q;
          const t = (q + (row === 0 ? 0.5 : 1)) / N;
          const sc = s0 + span * t + (rng.float() - 0.5) * step * 0.35;
          const hw = step * (row === 0 ? 0.85 : 0.7) * (0.85 + 0.35 * rng.float());
          // Tallest over the middle of the back, smaller toward the neck and the tail.
          const prof = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.8)));
          const h = H * prof * (0.75 + 0.45 * rng.float()) * (row === 0 ? 1 : 0.8);
          const c = this.indexOfS(sc);
          this.plateI[i] = c;
          this.plateW[i] = Math.max(0.15, (this.indexOfS(sc + hw) - this.indexOfS(sc - hw)) * 0.5);
          this.plateH[i] = h;
          this.plateLean[i] = 0.25 + 0.4 * rng.float();
          this.plateJ1[i] = 0.35 + 0.3 * rng.float();
          this.plateJ2[i] = jag * (0.15 + 0.35 * rng.float());
          this.plateJ3[i] = 0.55 + 0.35 * rng.float();
          if (row === 0) {
            const a = Math.max(0, Math.floor(c - this.plateW[i]!));
            const b = Math.min(this.n - 1, Math.ceil(c + this.plateW[i]!));
            for (let n = a; n <= b; n++) if (this.nodePlate[n]! < h * 0.85) this.nodePlate[n] = h * 0.85;
          }
        }
      }
      this.plateN = N;
      this.plateFarN = N - 1;
    }
    if (ind.clubJag > 0.01) {
      // An irregular lump of rock with a few jutting crags.
      const rng = new Rng((ind.seed ^ 0xc10b0b1) >>> 0);
      for (let v = 0; v < CLUB_N; v++) {
        this.clubA[v] = (v / CLUB_N) * Math.PI * 2 + (rng.float() - 0.5) * 0.4;
        const crag = v % 3 === 1 ? 0.3 + 0.35 * rng.float() : 0;
        this.clubR2[v] = (0.8 + 0.3 * rng.float()) * (1 - 0.12 * ind.clubJag) + crag * ind.clubJag;
      }
    }
  }

  /** Peak of plate p (u) on the live spine: its base in the back, lifted and leaning toward the tail. */
  platePeak(p: number, out: SpineSample): SpineSample {
    this.spineAt(this.plateI[p]!, out);
    const h = this.plateH[p]!;
    const lean = this.plateLean[p]!;
    const b = out.back * 0.85 + h;
    // Tangent toward the tail = (-ny, nx).
    const x = out.x + out.nx * b - out.ny * lean * h;
    const y = out.y + out.ny * b + out.nx * lean * h;
    out.x = x;
    out.y = y;
    return out;
  }

  // ---- wings ----

  /** Scratch wing pose for the near wing at the current angle (see wingPoints). */
  readonly wingPose: WingPose = { n: 0, pts: new Float32Array(2 * (MAX_FINGERS + 3)) };

  private poseWings(_dt: number): void {
    if (!this.wingOn) return;
    const ch = this.ch;
    this.wingAngle = -0.32 + ch[C_WLIFT]! + ch[C_WFLAP]! * Math.sin(this.flapPhase) + ch[C_DROOP]! * 0.7;
    const b = ch[C_BUZZ]!;
    this.buzzSpread = b * 0.55;
    this.wingPoints(this.wingAngle + b * 0.55 * Math.sin(this.buzzPhase), 0, this.wingPose);
  }

  /**
   * Wing geometry for a wing angle (rad; 0 = pointing back along the body, - = up) and depth
   * (0 near, 1 far): root, wrist, finger tips, trailing root. Allocation-free.
   */
  wingPoints(angle: number, far: number, out: WingPose): WingPose {
    const ch = this.ch;
    const spread = clamp01(ch[C_WSPREAD]!);
    this.spineAtBody(this.wingAt, this.sp);
    const sp = this.sp;
    const rx = sp.x + sp.nx * sp.back * 0.7 + far * 0.01;
    const ry = sp.y + sp.ny * sp.back * 0.7 - far * 0.012;
    // Wing angles are relative to the body's back line at the root (tangent toward the tail;
    // the normal is the tangent rotated -90deg, so tangent = (-ny, nx)).
    const bodyA = Math.atan2(sp.nx, -sp.ny);
    const a = bodyA + angle - far * 0.14;
    const armA = a - 0.35 * (1 - spread);
    const arm = this.wingArm * (0.75 + 0.25 * spread);
    const wx = rx + Math.cos(armA) * arm;
    const wy = ry + Math.sin(armA) * arm;
    const p = out.pts;
    p[0] = rx;
    p[1] = ry;
    p[2] = wx;
    p[3] = wy;
    const F = this.fingers;
    for (let f = 0; f < F; f++) {
      const fa = a + this.fingerFan[f]! * (0.22 + 0.78 * spread) + 0.15;
      const fl = this.fingerLen[f]! * (0.62 + 0.38 * spread);
      p[4 + f * 2] = wx + Math.cos(fa) * fl;
      p[5 + f * 2] = wy + Math.sin(fa) * fl;
    }
    this.spineAtBody(this.wingAt + 0.34, this.sp2);
    p[4 + F * 2] = this.sp2.x + this.sp2.nx * this.sp2.back * 0.35;
    p[5 + F * 2] = this.sp2.y + this.sp2.ny * this.sp2.back * 0.35;
    out.n = F + 3;
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // Queries (u)
  // ------------------------------------------------------------------------------------------

  /** Sample the live spine at a fractional main-chain node index. */
  spineAt(f: number, out: SpineSample): SpineSample {
    const n = this.n;
    if (f < 0) f = 0;
    if (f > n - 1) f = n - 1;
    const i0 = Math.floor(f);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = f - i0;
    out.x = this.x[i0]! + (this.x[i1]! - this.x[i0]!) * t;
    out.y = this.y[i0]! + (this.y[i1]! - this.y[i0]!) * t;
    let nx = this.nx[i0]! + (this.nx[i1]! - this.nx[i0]!) * t;
    let ny = this.ny[i0]! + (this.ny[i1]! - this.ny[i0]!) * t;
    const l = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= l;
    ny /= l;
    out.nx = nx;
    out.ny = ny;
    out.back = this.back[i0]! + (this.back[i1]! - this.back[i0]!) * t;
    out.belly = this.belly[i0]! + (this.belly[i1]! - this.belly[i0]!) * t;
    return out;
  }

  /** Sample at a body fraction (0 shoulder .. 1 hip; < 0 reaches into the neck, > 1 the tail). */
  spineAtBody(b: number, out: SpineSample): SpineSample {
    return this.spineAt(this.iS + b * BODY_N, out);
  }

  /** Spine param (0 head .. 1 tip) -> fractional node index on the main chain. */
  indexOfS(s: number): number {
    const n = this.n;
    const S = this.s;
    if (s <= 0) return 0;
    if (s >= 1) return n - 1;
    let i = 1;
    while (i < n - 1 && S[i]! < s) i++;
    const s0 = S[i - 1]!;
    const s1 = S[i]!;
    return i - 1 + (s1 > s0 ? (s - s0) / (s1 - s0) : 0);
  }

  /** Crest height at node i (0 outside the crest). */
  crestHeightAt(i: number): number {
    const ind = this.ind;
    if (this.crestH <= 0 || i >= this.n) return 0;
    const s = this.s[i]!;
    if (s < ind.crestFrom || s > ind.crestTo) return 0;
    const t = (s - ind.crestFrom) / Math.max(1e-6, ind.crestTo - ind.crestFrom);
    return this.crestH * Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.7 + 0.3 * (1 - t));
  }

  /** Mouth point (fire origin) of head h: between the lips, a little inside. */
  mouth(h: number, out: { x: number; y: number }): { x: number; y: number } {
    const hs = this.head;
    const j = this.jaw[h]! * 0.55;
    // Lower lip front, rotated with the jaw about the hinge (chin drops = rotate by -j).
    const cx = hs.chinX - hs.hingeX;
    const cy = hs.chinY - hs.hingeY;
    const c = Math.cos(-j);
    const s = Math.sin(-j);
    const lx = hs.hingeX + cx * c - cy * s;
    const ly = hs.hingeY + cx * s + cy * c;
    const mx = (hs.lipX + lx) * 0.5 + 0.06;
    const my = (hs.lipY + ly) * 0.5;
    return this.headToU(h, mx, my, out);
  }

  /** Head-unit point -> u for head h. */
  headToU(h: number, px: number, py: number, out: { x: number; y: number }): { x: number; y: number } {
    const a = this.headA[h]!;
    const c = Math.cos(a) * this.headLen;
    const s = Math.sin(a) * this.headLen;
    out.x = this.headX[h]! + px * c - py * s;
    out.y = this.headY[h]! + px * s + py * c;
    return out;
  }

  /**
   * Hit test in u: 1 = body, 0 = miss. `pad` grows every part (forgiving clicks).
   * Parts past the dissolve front don't count.
   */
  hitBody(px: number, py: number, pad: number): boolean {
    const n = this.n;
    const lastI = Math.min(n - 1, Math.ceil(this.indexOfS(this.dissolve)));
    // Spine tube (including the crest roughly, via the back width).
    for (let i = 0; i < lastI; i++) {
      if (this.segHit(i, i + 1, px, py, pad)) return true;
    }
    for (let h = 1; h < this.heads; h++) {
      const b = this.headNode[h]!;
      for (let k = 0; k < NECK_N; k++) {
        const i = b + k;
        const j = k === NECK_N - 1 ? this.iS : i + 1;
        if (this.segHit(i, j, px, py, pad)) return true;
      }
    }
    // Heads: an ellipse in head space, plus horns and gill fronds.
    if (this.dissolve > 0.02) {
      const hs = this.head;
      for (let h = 0; h < this.heads; h++) {
        const a = this.headA[h]!;
        const dx = px - this.headX[h]!;
        const dy = py - this.headY[h]!;
        const c = Math.cos(-a);
        const s = Math.sin(-a);
        const hx = (dx * c - dy * s) / this.headLen;
        const hy = (dx * s + dy * c) / this.headLen;
        const pr = pad / this.headLen;
        const ex = (hx - hs.hitX) / (hs.hitRX + pr);
        const ey = (hy - hs.hitY) / (hs.hitRY + pr);
        if (ex * ex + ey * ey <= 1) return true;
        for (let k = 0; k < hs.hornN; k++) {
          const o = k * 10;
          const H = hs.horns;
          const bx = (H[o]! + H[o + 8]!) * 0.5;
          const by = (H[o + 1]! + H[o + 9]!) * 0.5;
          const r = this.ind.hornWidth * 0.5 + pr;
          if (segDist2(hx, hy, bx, by, H[o + 4]!, H[o + 5]!) <= r * r) return true;
        }
        for (let k = 0; k < hs.gillN; k++) {
          const o = k * 5;
          const ga = hs.gills[o + 2]! + this.gillSway[h]! * 0.7;
          const gl = hs.gills[o + 3]!;
          const gx = hs.gills[o]!;
          const gy = hs.gills[o + 1]!;
          const r = hs.gills[o + 4]! * 1.2 + pr;
          if (segDist2(hx, hy, gx, gy, gx + Math.cos(ga - 0.25) * gl, gy + Math.sin(ga - 0.25) * gl) <= r * r) return true;
        }
      }
    }
    // Wings: the membranes (near and far), when not burnt away.
    if (this.wingOn && this.dissolve >= this.s[Math.round(this.iS + this.wingAt * BODY_N)]!) {
      if (this.inWing(this.wingPose, px, py, pad)) return true;
      this.wingPoints(this.wingAngle - 0.1, 1, this.wingHit);
      if (this.inWing(this.wingHit, px, py, pad)) return true;
    }
    // Wing-arms: the membranes (near and far) count as body: big, forgiving targets.
    if (this.armWing && this.dissolve >= this.s[Math.round(this.iS + this.legAt[0]! * BODY_N)]!) {
      if (this.inWing(this.armPose[0], px, py, pad)) return true;
      if (this.inWing(this.armPose[1], px, py, pad)) return true;
    }
    // Legs (and wing-arm bones): capsules.
    for (let k = 0; k < 4; k++) {
      if (!this.legOn[k] || this.dissolve < this.s[this.iS]! + 0.1) continue;
      const r = this.legR[k]! + pad;
      if (segDist2(px, py, this.hipX[k]!, this.hipY[k]!, this.kneeX[k]!, this.kneeY[k]!) <= r * r) return true;
      if (segDist2(px, py, this.kneeX[k]!, this.kneeY[k]!, this.ankX[k]!, this.ankY[k]!) <= r * r) return true;
    }
    return false;
  }

  /** Scratch for hit-testing the far wing. */
  private readonly wingHit: WingPose = { n: 0, pts: new Float32Array(2 * (MAX_FINGERS + 3)) };

  /** Point in a wing membrane polygon, or within `pad` of its edge. */
  private inWing(w: WingPose, px: number, py: number, pad: number): boolean {
    const p = w.pts;
    const n = w.n;
    let inside = false;
    let d2 = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = p[i * 2]!;
      const yi = p[i * 2 + 1]!;
      const xj = p[j * 2]!;
      const yj = p[j * 2 + 1]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      const e = segDist2(px, py, xi, yi, xj, yj);
      if (e < d2) d2 = e;
    }
    return inside || d2 <= pad * pad;
  }

  private segHit(i: number, j: number, px: number, py: number, pad: number): boolean {
    const ax = this.x[i]!;
    const ay = this.y[i]!;
    const bx = this.x[j]!;
    const by = this.y[j]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const ox = px - cx;
    const oy = py - cy;
    // Which side: toward the back normal or the belly.
    const nx = this.nx[i]! + (this.nx[j]! - this.nx[i]!) * t;
    const ny = this.ny[i]! + (this.ny[j]! - this.ny[i]!) * t;
    const side = ox * nx + oy * ny;
    let r = side >= 0 ? this.back[i]! + (this.back[j]! - this.back[i]!) * t : this.belly[i]! + (this.belly[j]! - this.belly[i]!) * t;
    if (side >= 0) r += this.crestHeightAt(i) + this.nodePlate[i]!;
    r += pad;
    return ox * ox + oy * oy <= r * r;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle difference into (-PI, PI]. */
function wrapPi(a: number): number {
  const t = Math.PI * 2;
  a = a % t;
  if (a > Math.PI) a -= t;
  else if (a <= -Math.PI) a += t;
  return a;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smooth(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** Smooth bump: 1 at c, 0 beyond +-w. */
function bump(s: number, c: number, w: number): number {
  const d = Math.abs(s - c) / w;
  if (d >= 1) return 0;
  const u = 1 - d * d;
  return u * u;
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const ex = px - (ax + dx * t);
  const ey = py - (ay + dy * t);
  return ex * ex + ey * ey;
}
