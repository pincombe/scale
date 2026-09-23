// Knight animations as posed keyframes. Loops are sampled from pose functions; one-shots are
// explicit key poses with per-frame hold durations (snappy anticipation -> smear -> follow-through
// timing instead of even spacing). The baker (sheets.ts) turns every frame into a sprite.
import { Pose, copyPose, lerpPose } from './rig';
import { horseSaddle } from './horse';

export type SheetKind = 'foot' | 'bearer' | 'archer' | 'lancer';
export const SHEET_KINDS: readonly SheetKind[] = ['foot', 'bearer', 'archer', 'lancer'];

// Animation ids (indices into AnimSet.anims).
export const A_IDLE_A = 0;
export const A_IDLE_B = 1;
export const A_MARCH = 2;
/** Footman/bearer: sword swing. Archer: draw and loose. */
export const A_STRIKE = 3;
export const A_CHEER = 4;
export const A_RAISE = 5;
export const A_FLUNG = 6;
export const A_DOWN = 7;
export const A_GETUP = 8;
export const A_BRACE = 9;
/** Running away from the fire (baked mirrored so the rim light stays on the sun side). */
export const A_FLEE = 10;
/** Third idle: sword planted point-down (foot), arrow nocked low (archer), leaning on the pole (bearer). */
export const A_IDLE_C = 11;
export const ANIM_COUNT = 12;

// Lancer animation ids (their own set: a horse has no bow, a footman no gallop).
export const L_IDLE = 0;
/** Head down, rider at ease. */
export const L_IDLE_B = 1;
/** Gallop toward the dragon (lance couched or raised: drawn live). */
export const L_GALLOP = 2;
/** Gallop back, facing left (baked mirrored so the rim light stays on the sun side). */
export const L_BACK = 3;
/** Rearing: the wheel-about after a strike, the cheer, the salute on arrival. */
export const L_REAR = 4;
/** The moment of impact: the rider rises in the stirrups, the horse at full stretch. */
export const L_STRIKE = 5;
export const LANCER_ANIM_COUNT = 6;
export const GALLOP_FRAMES = 6;

/** How many animations a sheet kind has. */
export function animCount(kind: SheetKind): number {
  return kind === 'lancer' ? LANCER_ANIM_COUNT : ANIM_COUNT;
}

export interface AnimDef {
  poses: Pose[];
  /** Hold time per frame (s) for one-shots; empty for loops. */
  durs: number[];
  loop: boolean;
  mirror: boolean;
}

/** Seconds from the start of the archer's A_STRIKE to the moment the arrow leaves the string. */
export const LOOSE_T = 0.43;
export const MARCH_FRAMES = 8;
export const FLEE_FRAMES = 6;
export const CHEER_FRAMES = 4;

type Partial2 = Partial<Pose>;

function P(base: Pose | null, o: Partial2): Pose {
  const p = new Pose();
  if (base) copyPose(p, base);
  Object.assign(p, o);
  return p;
}

function mix(a: Pose, b: Pose, t: number, o: Partial2 = {}): Pose {
  return Object.assign(lerpPose(new Pose(), a, b, t), o);
}

function total(d: number[]): number {
  let s = 0;
  for (const x of d) s += x;
  return s;
}

/** Pole grip used by bearers while they fight (the near hand never lets go of the banner). */
const POLE_GRIP: Partial2 = { nHandX: 10, nHandY: -64, pole: -Math.PI / 2 + 0.03 };

function foot(kind: SheetKind): AnimDef[] {
  const bearer = kind === 'bearer';
  const grip = (o: Partial2): Partial2 => (bearer ? { ...o, ...POLE_GRIP } : o);

  const guard = P(null, grip({ hipX: 0, hipY: -46, lean: 0.06, head: 0.02, aFootX: 10, bFootX: -8, nHandX: 16, nHandY: -55, shield: 0.12, fHandX: 11, fHandY: -60, weapon: -0.95 }));
  const idleB = bearer
    ? P(null, { hipY: -46, lean: -0.03, head: -0.08, aFootX: 6, bFootX: -9, nHandX: 8, nHandY: -58, pole: -Math.PI / 2 - 0.06, fHandX: -3, fHandY: -52, weapon: 1.85 })
    : P(null, { hipY: -46, lean: -0.03, head: -0.06, aFootX: 6, bFootX: -9, nHandX: 3, nHandY: -50, shield: 0.12, fHandX: 8, fHandY: -70, weapon: -2.6 });

  const march: Pose[] = [];
  for (let i = 0; i < MARCH_FRAMES; i++) {
    const ph = (i / MARCH_FRAMES) * Math.PI * 2;
    const sa = Math.sin(ph);
    const sb = -sa;
    march.push(
      P(null, {
        hipX: 3,
        hipY: -46 + 1.8 * Math.cos(2 * ph),
        lean: 0.2 + 0.03 * Math.sin(2 * ph),
        head: -0.12,
        aFootX: 4 + 13 * Math.cos(ph),
        aFootY: sa < 0 ? 10 * sa : 0,
        bFootX: 4 - 13 * Math.cos(ph),
        bFootY: sb < 0 ? 10 * sb : 0,
        nHandX: bearer ? 13 : 14 + 3 * Math.cos(ph),
        nHandY: (bearer ? -66 : -61) + 1.5 * Math.sin(2 * ph),
        shield: 0.12,
        pole: -Math.PI / 2 + 0.14,
        fHandX: bearer ? -6 * Math.cos(ph) : 9 - 4 * Math.cos(ph),
        fHandY: bearer ? -52 : -61,
        weapon: bearer ? 1.2 + 0.2 * Math.cos(ph) : -1.0 + 0.15 * sa,
      }),
    );
  }

  // Sword swing: anticipation (sword cocked high behind the helm), a fast smear, follow-through.
  const windup = P(guard, grip({ hipX: -2, lean: -0.1, head: -0.1, aFootX: 11, bFootX: -9, fHandX: -5, fHandY: -88, weapon: -2.5, nHandX: 13, nHandY: -62 }));
  const slash = P(guard, grip({ hipX: 6, hipY: -43, lean: 0.36, head: 0.1, aFootX: 19, bFootX: -9, fHandX: 25, fHandY: -58, weapon: 0.15, nHandX: 6, nHandY: -58, shield: 0.3 }));
  const follow = P(slash, grip({ hipX: 5, fHandX: 18, fHandY: -46, weapon: 0.85, lean: 0.3, nHandX: 4 }));
  const strike = [guard, windup, mix(windup, slash, 0.45, { weapon: -1.25 }), slash, follow, mix(follow, guard, 0.5)];
  const strikeD = [0.03, 0.12, 0.035, 0.06, 0.12, 0.12];

  const crouch = P(null, grip({ hipY: -40, lean: 0.16, head: 0.1, aFootX: 9, bFootX: -8, fHandX: 9, fHandY: -72, weapon: -1.35, nHandX: 11, nHandY: -58 }));
  const hoist = bearer ? { nHandX: 8, nHandY: -84, pole: -Math.PI / 2 + 0.02 } : {};
  const launch = P(null, { hipY: -47, lean: -0.04, head: -0.25, aFootX: 5, bFootX: -5, fHandX: 7, fHandY: -106, weapon: -1.62, nHandX: -3, nHandY: -84, shield: -0.3, ...hoist });
  const apex = P(null, { hipY: -47, lean: -0.08, head: -0.3, aFootX: 7, aFootY: -6, bFootX: -7, bFootY: -8, fHandX: 9, fHandY: -110, weapon: -1.5, nHandX: -7, nHandY: -88, shield: -0.4, ...hoist });
  const land = P(null, { hipY: -43, lean: 0.06, head: -0.1, aFootX: 8, bFootX: -7, fHandX: 11, fHandY: -100, weapon: -1.35, nHandX: 2, nHandY: -76, ...hoist });
  const raise = P(null, { hipY: -47, lean: -0.05, head: -0.25, aFootX: 8, bFootX: -8, fHandX: 8, fHandY: -110, weapon: -1.55, nHandX: 10, nHandY: -62, ...hoist });

  const pole = (a: number): Partial2 => (bearer ? { pole: a } : {});
  const flungA = P(null, { hipY: -46, lean: -0.5, head: -0.5, aFootX: 22, aFootY: -14, bFootX: -16, bFootY: -8, nHandX: -22, nHandY: -80, shield: 0.9, fHandX: 24, fHandY: -90, weapon: -0.5, ...pole(-0.4) });
  const flungB = P(null, { hipY: -46, lean: 0.55, head: 0.4, aFootX: 14, aFootY: -26, bFootX: 6, bFootY: -20, nHandX: 14, nHandY: -66, shield: -0.5, fHandX: -12, fHandY: -80, weapon: 2.3, ...pole(-2.3) });
  const down = P(null, { hipX: 0, hipY: -9, lean: -1.5, head: -0.1, aFootX: 34, aFootY: -3, bFootX: 30, bFootY: -10, nHandX: -44, nHandY: -5, shield: 1.5, fHandX: -8, fHandY: -3, weapon: 0.05, ...pole(Math.PI - 0.06) });
  const sit = P(null, { hipX: -2, hipY: -9, lean: -0.45, head: 0.2, aFootX: 24, bFootX: 20, nHandX: -20, nHandY: -3, shield: 1.2, fHandX: 14, fHandY: -24, weapon: -0.2, ...pole(-2.6) });
  const kneel = P(null, { hipX: -4, hipY: -27, lean: 0.3, head: 0.25, aFootX: 12, bFootX: -20, bFootY: -1, nHandX: 12, nHandY: -40, shield: 0.3, fHandX: 8, fHandY: -36, weapon: 1.45, ...pole(-1.9) });
  const rise = P(null, { hipY: -41, lean: 0.18, head: 0.1, aFootX: 10, bFootX: -7, nHandX: 12, nHandY: -56, fHandX: 6, fHandY: -50, weapon: -0.6, ...pole(-1.62) });
  const shake = P(guard, { head: 0.3, lean: 0.0 });
  const getup = [down, sit, kneel, rise, shake];
  const getupD = [0.15, 0.22, 0.22, 0.16, 0.25];

  const idleC = bearer
    ? P(null, { hipY: -46, lean: -0.06, head: 0.12, aFootX: 5, bFootX: -10, nHandX: 9, nHandY: -72, pole: -Math.PI / 2 + 0.1, fHandX: 2, fHandY: -50, weapon: 1.5 })
    : P(null, { hipY: -46, lean: 0.08, head: 0.1, aFootX: 6, bFootX: -9, nHandX: 2, nHandY: -52, shield: 0.14, fHandX: 17, fHandY: -52, weapon: 1.2 });
  const brace = P(null, bearer
    ? { hipX: -2, hipY: -40, lean: 0.36, head: 0.25, aFootX: 15, bFootX: -12, nHandX: 12, nHandY: -58, pole: -Math.PI / 2 - 0.1, fHandX: -2, fHandY: -47, weapon: 2.3 }
    : { hipX: -2, hipY: -39, lean: 0.42, head: 0.2, aFootX: 15, bFootX: -12, nHandX: 21, nHandY: -58, shield: -0.18, fHandX: -2, fHandY: -47, weapon: 2.3 });

  const flee: Pose[] = [];
  for (let i = 0; i < FLEE_FRAMES; i++) {
    const ph = (i / FLEE_FRAMES) * Math.PI * 2;
    const sa = Math.sin(ph);
    flee.push(
      P(null, {
        hipX: 4,
        hipY: -45 + 2 * Math.cos(2 * ph),
        lean: 0.32,
        head: -0.25,
        aFootX: 5 + 15 * Math.cos(ph),
        aFootY: sa < 0 ? 12 * sa : 0,
        bFootX: 5 - 15 * Math.cos(ph),
        bFootY: -sa < 0 ? -12 * sa : 0,
        nHandX: bearer ? 6 : 5,
        nHandY: bearer ? -72 : -97,
        shield: 1.5,
        pole: -2.1,
        fHandX: -8 + 6 * sa,
        fHandY: -76 + 5 * Math.cos(ph),
        weapon: 2.4 + 0.5 * sa,
      }),
    );
  }

  return [
    { poses: [guard], durs: [], loop: true, mirror: false },
    { poses: [idleB], durs: [], loop: true, mirror: false },
    { poses: march, durs: [], loop: true, mirror: false },
    { poses: strike, durs: strikeD, loop: false, mirror: false },
    { poses: [crouch, launch, apex, land], durs: [], loop: true, mirror: false },
    { poses: [raise], durs: [], loop: true, mirror: false },
    { poses: [flungA, flungB], durs: [], loop: true, mirror: false },
    { poses: [down], durs: [], loop: true, mirror: false },
    { poses: getup, durs: getupD, loop: false, mirror: false },
    { poses: [brace], durs: [], loop: true, mirror: false },
    { poses: flee, durs: [], loop: true, mirror: true },
    { poses: [idleC], durs: [], loop: true, mirror: false },
  ];
}

function archer(): AnimDef[] {
  const ready = P(null, { hipY: -46, lean: 0.02, head: 0, aFootX: 8, bFootX: -8, nHandX: 14, nHandY: -56, bow: 0.3, fHandX: -3, fHandY: -50 });
  const idleB = P(null, { hipY: -46, lean: -0.02, head: 0.1, aFootX: 7, bFootX: -9, nHandX: 13, nHandY: -47, bow: 0.2, fHandX: 9, fHandY: -52 });

  const march: Pose[] = [];
  for (let i = 0; i < MARCH_FRAMES; i++) {
    const ph = (i / MARCH_FRAMES) * Math.PI * 2;
    const sa = Math.sin(ph);
    march.push(
      P(null, {
        hipX: 3,
        hipY: -46 + 1.8 * Math.cos(2 * ph),
        lean: 0.18 + 0.03 * Math.sin(2 * ph),
        head: -0.1,
        aFootX: 4 + 13 * Math.cos(ph),
        aFootY: sa < 0 ? 10 * sa : 0,
        bFootX: 4 - 13 * Math.cos(ph),
        bFootY: -sa < 0 ? -10 * sa : 0,
        nHandX: 15 + 2 * Math.cos(ph),
        nHandY: -57,
        bow: 0.95,
        fHandX: -3 - 7 * Math.cos(ph),
        fHandY: -52,
      }),
    );
  }

  // Volley: raise, draw to the cheek, hold, loose (the string hand snaps back), follow through.
  const aim = -0.72;
  const ax = Math.cos(aim);
  const ay = Math.sin(aim);
  const gx = 21;
  const gy = -90;
  const raise = P(ready, { lean: -0.06, head: -0.35, nHandX: gx, nHandY: gy, bow: aim, fHandX: gx - ax * 10, fHandY: gy - ay * 10, draw: 0, nock: 1 });
  const half = P(raise, { fHandX: gx - ax * 22, fHandY: gy - ay * 22, draw: 0.5 });
  const full = P(raise, { lean: -0.1, fHandX: gx - ax * 34, fHandY: gy - ay * 34, draw: 1 });
  const loose = P(full, { draw: 0, nock: 0, fHandX: -10, fHandY: -62, lean: -0.12 });
  const follow = P(loose, { bow: -0.6, nHandX: 20, nHandY: -88, fHandX: -9, fHandY: -60 });
  const strike = [ready, raise, half, full, loose, follow, mix(follow, ready, 0.5)];
  const strikeD = [0.05, 0.12, 0.1, 0.16, 0.06, 0.12, 0.15];

  const crouch = P(null, { hipY: -40, lean: 0.16, head: 0.1, aFootX: 9, bFootX: -8, nHandX: 14, nHandY: -60, bow: 0.3, fHandX: 6, fHandY: -66 });
  const launch = P(null, { hipY: -47, lean: -0.04, head: -0.25, aFootX: 5, bFootX: -5, nHandX: 4, nHandY: -106, bow: -1.45, fHandX: 14, fHandY: -94 });
  const apex = P(launch, { lean: -0.08, head: -0.3, aFootX: 7, aFootY: -6, bFootX: -7, bFootY: -8, nHandY: -110, fHandX: 15, fHandY: -100 });
  const land = P(launch, { hipY: -43, lean: 0.06, head: -0.1, aFootX: 8, bFootX: -7, nHandY: -100, fHandX: 13, fHandY: -88 });
  const raised = P(null, { hipY: -47, lean: -0.05, head: -0.25, aFootX: 8, bFootX: -8, nHandX: 6, nHandY: -110, bow: -1.45, fHandX: -4, fHandY: -56 });

  const flungA = P(null, { hipY: -46, lean: -0.5, head: -0.5, aFootX: 22, aFootY: -14, bFootX: -16, bFootY: -8, nHandX: -22, nHandY: -84, bow: 1.4, fHandX: 24, fHandY: -88 });
  const flungB = P(null, { hipY: -46, lean: 0.55, head: 0.4, aFootX: 14, aFootY: -26, bFootX: 6, bFootY: -20, nHandX: 16, nHandY: -64, bow: -0.9, fHandX: -12, fHandY: -80 });
  const down = P(null, { hipY: -9, lean: -1.5, head: -0.1, aFootX: 34, aFootY: -3, bFootX: 30, bFootY: -10, nHandX: -44, nHandY: -5, bow: 1.52, fHandX: -8, fHandY: -3 });
  const sit = P(null, { hipX: -2, hipY: -9, lean: -0.45, head: 0.2, aFootX: 24, bFootX: 20, nHandX: -20, nHandY: -3, bow: 1.3, fHandX: 14, fHandY: -24 });
  const kneel = P(null, { hipX: -4, hipY: -27, lean: 0.3, head: 0.25, aFootX: 12, bFootX: -20, bFootY: -1, nHandX: 14, nHandY: -38, bow: 0.5, fHandX: 8, fHandY: -36 });
  const rise = P(null, { hipY: -41, lean: 0.18, head: 0.1, aFootX: 10, bFootX: -7, nHandX: 14, nHandY: -54, bow: 0.35, fHandX: 4, fHandY: -50 });
  const shake = P(ready, { head: 0.3 });
  const brace = P(null, { hipX: -2, hipY: -39, lean: 0.45, head: 0.3, aFootX: 15, bFootX: -12, nHandX: 18, nHandY: -50, bow: 0.9, fHandX: 10, fHandY: -86 });
  const nocked = P(null, { hipY: -46, lean: 0.06, head: 0.12, aFootX: 9, bFootX: -8, nHandX: 17, nHandY: -55, bow: 0.55, fHandX: 3, fHandY: -58, draw: 0.2, nock: 1 });

  const flee: Pose[] = [];
  for (let i = 0; i < FLEE_FRAMES; i++) {
    const ph = (i / FLEE_FRAMES) * Math.PI * 2;
    const sa = Math.sin(ph);
    flee.push(
      P(null, {
        hipX: 4,
        hipY: -45 + 2 * Math.cos(2 * ph),
        lean: 0.32,
        head: -0.25,
        aFootX: 5 + 15 * Math.cos(ph),
        aFootY: sa < 0 ? 12 * sa : 0,
        bFootX: 5 - 15 * Math.cos(ph),
        bFootY: -sa < 0 ? -12 * sa : 0,
        nHandX: 4 + 3 * sa,
        nHandY: -100,
        bow: -1.3,
        fHandX: -6 - 5 * sa,
        fHandY: -96 + 4 * Math.cos(ph),
      }),
    );
  }

  return [
    { poses: [ready], durs: [], loop: true, mirror: false },
    { poses: [idleB], durs: [], loop: true, mirror: false },
    { poses: march, durs: [], loop: true, mirror: false },
    { poses: strike, durs: strikeD, loop: false, mirror: false },
    { poses: [crouch, launch, apex, land], durs: [], loop: true, mirror: false },
    { poses: [raised], durs: [], loop: true, mirror: false },
    { poses: [flungA, flungB], durs: [], loop: true, mirror: false },
    { poses: [down], durs: [], loop: true, mirror: false },
    { poses: [down, sit, kneel, rise, shake], durs: [0.15, 0.22, 0.22, 0.16, 0.25], loop: false, mirror: false },
    { poses: [brace], durs: [], loop: true, mirror: false },
    { poses: flee, durs: [], loop: true, mirror: true },
    { poses: [nocked], durs: [], loop: true, mirror: false },
  ];
}

const sad = { x: 0, y: 0, sx: 0, sy: 0, pitch: 0 };

/**
 * A mounted pose: the horse's fields, then the rider seated on the saddle (hips on the seat, feet in
 * the stirrups), leaning `lean` beyond the horse's pitch. The near fist holds the reins behind the
 * kite shield; the far fist is the lance grip at the hip (the lance itself is drawn live).
 */
function mount(o: Partial2, lean: number, reinsUp = 0, thrust = 0): Pose {
  const p = P(null, o);
  horseSaddle(p, sad);
  p.hipX = sad.x;
  p.hipY = sad.y;
  p.lean = sad.pitch + lean;
  p.head = -lean * 0.4;
  const fwX = Math.cos(p.lean);
  const fwY = Math.sin(p.lean);
  const upX = Math.sin(p.lean);
  const upY = -Math.cos(p.lean);
  p.aFootX = sad.sx + 1;
  p.aFootY = sad.sy;
  p.bFootX = sad.sx - 4;
  p.bFootY = sad.sy - 1.5;
  p.nHandX = sad.x + fwX * (17 + 3 * reinsUp) + upX * (11 + 12 * reinsUp);
  p.nHandY = sad.y + fwY * (17 + 3 * reinsUp) + upY * (11 + 12 * reinsUp);
  p.shield = 0.08 + 0.1 * reinsUp;
  p.fHandX = sad.x + fwX * (10 + thrust) + upX * 15;
  p.fHandY = sad.y + fwY * (10 + thrust) + upY * 15;
  p.weapon = 0;
  return p;
}

function lancer(): AnimDef[] {
  const gallop: Pose[] = [];
  const back: Pose[] = [];
  for (let i = 0; i < GALLOP_FRAMES; i++) {
    const ph = i / GALLOP_FRAMES;
    gallop.push(mount({ mGait: 1, mPhase: ph }, 0.2 + 0.04 * Math.sin(ph * Math.PI * 2 + 1)));
    back.push(mount({ mGait: 1, mPhase: ph }, 0.14 + 0.04 * Math.sin(ph * Math.PI * 2 + 1)));
  }
  return [
    { poses: [mount({ mGait: 0, mHead: -0.04 }, 0.02)], durs: [], loop: true, mirror: false },
    { poses: [mount({ mGait: 0, mHead: 0.42 }, -0.04)], durs: [], loop: true, mirror: false },
    { poses: gallop, durs: [], loop: true, mirror: false },
    { poses: back, durs: [], loop: true, mirror: true },
    { poses: [mount({ mRear: 1, mHead: -0.25 }, 0.72, 1)], durs: [], loop: true, mirror: false },
    { poses: [mount({ mGait: 1, mPhase: 0.62 }, 0.42, 0, 9)], durs: [], loop: true, mirror: false },
  ];
}

export function buildAnims(kind: SheetKind): AnimDef[] {
  return kind === 'archer' ? archer() : kind === 'lancer' ? lancer() : foot(kind);
}

/** Total duration of a one-shot animation. */
export function animDuration(def: AnimDef): number {
  return total(def.durs);
}

/** Frame index of a one-shot at time t (s) since it started (clamped to the last frame). */
export function oneShotFrame(def: AnimDef, t: number): number {
  const d = def.durs;
  let acc = 0;
  for (let i = 0; i < d.length; i++) {
    acc += d[i]!;
    if (t < acc) return i;
  }
  return d.length - 1;
}
