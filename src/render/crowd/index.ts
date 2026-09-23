// The knight crowd (layer slot 2): the hero, the swelling army, banners and arrows; M2: lancers,
// champions, the abilities' reactions and the zoom's rally pile.
//
// State is the truth: every frame the visible army is reconciled against state.units (new knights
// march in from the left edge to a stable slot; 'resync' snaps with no effects). Events only start
// one-shot reactions: sword swings, volleys, cavalry charges, scattering from fire, flying from a
// tail swipe, cheers, champions' blows and specials.
//
// Every knight is a small state machine in struct-of-arrays form (no per-frame allocations). Knights
// are drawn from baked, rim-lit sprite frames (sheets.ts) at the level of detail the camera needs,
// back rows first; the draw order is re-sorted only when the formation changes. The hero and the
// champions are drawn live (hero.ts, champion.ts), lances live over their sprites (lance.ts).
//
// The zoom (render/zoom) calls rally(x, s): everyone rushes to x and climbs into one living pyramid
// (pile.ts) with the hero lifted to its top; setFused(true) hides the army (the colossus stands in
// for it); setFused(false) brings the new tier's army back from state, placed, with no march-in.
// While a zoom holds (state.zoom.stage), no reaction is queued.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { CrowdView, Heraldry } from './api';
import type { DragonView } from '../dragon/api';
import type { Rect, Vec2 } from '../../lib/vec';
import type { Decimal } from '../../core/decimal';
import type { ChampionId } from '../../core/types';
import { rect, vec2 } from '../../lib/vec';
import { mixHex } from '../../lib/color';
import { TICK_DT } from '../../core/formulas';
import { context2d, makeCanvas } from '../atlas';
import { CURVE_FADE, particleSpec, type ParticleSpec } from '../particles';
import { KNIGHT_HEIGHT } from '../world';
import type { Palette } from '../palette';
import { paletteFor } from '../palette';
import {
  A_BRACE,
  A_CHEER,
  A_DOWN,
  A_FLEE,
  A_FLUNG,
  A_GETUP,
  A_IDLE_A,
  A_IDLE_B,
  A_IDLE_C,
  A_MARCH,
  A_RAISE,
  A_STRIKE,
  CHEER_FRAMES,
  FLEE_FRAMES,
  GALLOP_FRAMES,
  L_BACK,
  L_GALLOP,
  L_IDLE,
  L_IDLE_B,
  L_REAR,
  L_STRIKE,
  LOOSE_T,
  MARCH_FRAMES,
  animDuration,
  oneShotFrame,
} from './anims';
import { KnightSheets, LOD_COUNT, lodSticky } from './sheets';
import { Hero } from './hero';
import { Arrows } from './arrows';
import { BannerArt, CountLabels, FLAG_H, FLAG_SMALL, FLAG_W, POLE_DOWN, POLE_UP, defaultHeraldry, drawFinial, drawFlag } from './banner';
import {
  CHAMP_GAP,
  HERO_GAP,
  champRoom,
  heroStandOff,
  ROW_SCALE,
  ROW_Y,
  SPRITE_CAP,
  archerSlot,
  footSlot,
  isBearer,
  lancerSlot,
  shownCount,
  squadSize,
  type Slot,
} from './formation';
import { Champion, type ChampId } from './champion';
import { LANCE_FWD, drawLance, type LanceColors } from './lance';
import { PileLayout } from './pile';

/** DragonView plus the optional live queries the dragon rig may add (used when present). */
type LiveDragon = DragonView & {
  /** Live tail-tip world position. */
  tailPoint?(out: Vec2): Vec2;
  /** World x of the far end of the flame at full extent. */
  breathReachX?(): number;
};

export interface CrowdRender {
  layer: Layer;
  view: CrowdView;
}

/** Meters per figure unit for a full-size knight. */
const UNIT = KNIGHT_HEIGHT / 100;
/** Records: the sprite cap plus room for the surplus knights still merging after a squad change. */
const MAXK = SPRITE_CAP * 2 + 16;

// Knight modes.
const M_IDLE = 0;
const M_MOVE = 1;
const M_STRIKE = 2;
const M_CHEER = 3;
const M_RAISE = 4;
const M_BRACE = 5;
const M_FLEE = 6;
const M_FLUNG = 7;
const M_DOWN = 8;
const M_GETUP = 9;
/** Squad change: a surplus sprite runs into a neighbour and vanishes in a puff of dust. */
const M_MERGE = 10;
/** Lancers: galloping at the dragon (lance lowering), the impact, the wheel-about. */
const M_CHARGE = 11;
const M_HIT = 12;
const M_WHEEL = 13;
/** The zoom's rally: rushing to the pile, climbing it, standing on it. */
const M_RALLY = 14;
const M_CLIMB = 15;
const M_PILE = 16;
const M_NONE = 255;

const SK_FOOT = 0;
const SK_BEARER = 1;
const SK_ARCHER = 2;
const SK_LANCER = 3;

const U_FOOT = 0;
const U_ARCH = 1;
const U_LANCE = 2;

const RUN = 3.4;
const CHEER_CYCLE = 0.56;
const CHEER_HOPS = 2;
const RAISE_DUR = 1.35;
/** Hip height in figure units (flung knights spin about it). */
const HIP = 46;
/** Foreground lane depth (m) for knights knocked out of the ranks. */
const LANE = 0.42;
/** World y range (m) the haze-band buffer covers: banner tops (lance tips, with lancers) to below the front row's feet. */
const BAND_TOP = -3.6;
const BAND_TOP_LANCE = -4.6;
const BAND_BOT = 0.6;
/** Haze strength for the far band (archers, lancers: rows 3+) and the mid band (row 2). */
const BAND_HAZE = [0.26, 0.12] as const;

// Lancers.
/** Meters a horse covers per gallop cycle (sets the leg rate against the ground). */
const STRIDE_M = 2.7;
/** Impact hold and the wheel-about (s). */
const HIT_DUR = 0.3;
const WHEEL_DUR = 0.42;
/** Lance angles (figure space): upright at rest (tilted a touch forward), couched for the charge. */
const LANCE_UP = -1.42;
const LANCE_COUCH = 0.14;
/** Milliseconds per frame all of update's baking may take (sheets, the zoom's pre-bakes, prepareTier). */
const BAKE_BUDGET = 3;
/** Ride-back speed (m/s). */
const HORSE_RUN = 8;

// Charge! (the ability): how far the ranks close up on the hero, and how far he steps in.
const SURGE_PULL = 0.5;
const SURGE_PUSH = 0.28;
const SURGE_HERO = 0.3;

// Champions in join order (their spots beside the hero).
const CHAMP_IDS: readonly ChampId[] = ['aldric', 'brunhild'];

export function createCrowd(scene: Scene): CrowdRender {
  const sheets = new KnightSheets();
  const hero = new Hero();
  const arrows = new Arrows();
  let bannerArt = new BannerArt();
  const labels = new CountLabels();
  const champs = CHAMP_IDS.map((id) => new Champion(id));
  const pile = new PileLayout(MAXK);
  const footDef = sheets.sets[SK_FOOT]!.defs;
  const archDef = sheets.sets[SK_ARCHER]!.defs;
  const STRIKE_DUR_FOOT = animDuration(footDef[A_STRIKE]!);
  const STRIKE_DUR_ARCH = animDuration(archDef[A_STRIKE]!);
  const GETUP_DUR = animDuration(footDef[A_GETUP]!);
  // The lance grip as the rider couches it at the charge (figure units, from the impact frame).
  const lanceGrip = sheets.frames[sheets.frameIndex(SK_LANCER, L_STRIKE, 0)]!.anchor;

  // ---- knight records (struct of arrays) ----
  const used = new Uint8Array(MAXK);
  /** U_FOOT / U_ARCH / U_LANCE. */
  const unit = new Uint8Array(MAXK);
  const sheet = new Uint8Array(MAXK);
  /** Carries a banner. */
  const flagged = new Uint8Array(MAXK);
  const slotIdx = new Uint16Array(MAXK);
  const row = new Uint8Array(MAXK);
  const rel = new Float32Array(MAXK);
  const kx = new Float32Array(MAXK);
  const ky = new Float32Array(MAXK);
  const vx = new Float32Array(MAXK);
  const vy = new Float32Array(MAXK);
  const grav = new Float32Array(MAXK);
  const rot = new Float32Array(MAXK);
  const spin = new Float32Array(MAXK);
  const mode = new Uint8Array(MAXK);
  const t0 = new Float64Array(MAXK);
  const aux = new Float32Array(MAXK);
  const face = new Int8Array(MAXK);
  const run = new Float32Array(MAXK);
  const seed = new Float32Array(MAXK);
  /** Per-knight size variation. */
  const size = new Float32Array(MAXK);
  const style = new Uint8Array(MAXK);
  const bounces = new Uint8Array(MAXK);
  /** Surplus after a squad change (no longer in the formation), and the record it runs into. */
  const merge = new Uint8Array(MAXK);
  const mergeTo = new Int16Array(MAXK);
  /** Marched in from the edge (hops in salute on arrival). */
  const recruit = new Uint8Array(MAXK);
  /** Extra depth (m, +down = toward the viewer): flung and fleeing knights spill in front of the ranks. */
  const lane = new Float32Array(MAXK);
  const laneMax = new Float32Array(MAXK);
  /** Where a fleeing knight runs to (m). */
  const fleeTo = new Float32Array(MAXK);
  /** Already thrown by the current swipe. */
  const swept = new Uint8Array(MAXK);
  const pend = new Uint8Array(MAXK).fill(M_NONE);
  const pendT = new Float64Array(MAXK);
  const footRec = new Int16Array(MAXK).fill(-1);
  const archRec = new Int16Array(MAXK).fill(-1);
  const lanceRec = new Int16Array(MAXK).fill(-1);
  const order = new Uint16Array(MAXK);
  let orderN = 0;
  let orderDirty = true;
  const sortKey = new Float32Array(MAXK);
  const glintX = new Float32Array(MAXK);
  const glintY = new Float32Array(MAXK);
  const glintA = new Float32Array(MAXK);
  // Lancer charges and the rally: start x, end x, duration (s); pile spot (-1 = none), climb start.
  const chX0 = new Float32Array(MAXK);
  const chX1 = new Float32Array(MAXK);
  const chDur = new Float32Array(MAXK);
  const pileI = new Int16Array(MAXK).fill(-1);
  const climbT = new Float64Array(MAXK);
  /** When a knight waiting at the foot of the pile starts its scramble up. */
  const climbS = new Float64Array(MAXK);
  const cand = new Int16Array(MAXK);
  const candD = new Float32Array(MAXK);

  let shownF = 0;
  let shownA = 0;
  let shownL = 0;
  let squad = 1;
  let snap = true;
  let now = 0;
  let heroX = -HERO_GAP;
  let lastLod = 0;
  let prevZoom = 0;
  let pullT = -10;
  let pal: Palette | null = null;
  let heraldry: Heraldry | null = null;
  let customHeraldry = false;
  let dustSpec: ParticleSpec | null = null;
  let dustPal: Palette | null = null;
  let glintSprite = -1;
  let breathOn = false;
  let swipeUntil = -1;
  let flungN = 0;
  let rr = 0x9e3779b9;
  // Champions: how many stand beside the hero, and the room the ranks have made for them (eased).
  let champN = 0;
  let room = 0;
  // Charge!: on/off and the eased surge (0..1).
  let surgeOn = false;
  let surge = 0;
  // The zoom.
  let fused = false;
  let rallyOn = false;
  let rallyX = 0;
  let rallyT0 = 0;
  let rallyDur = 1;
  let rallyLast = 0;
  let pileTop = 0;
  let heroFromX = 0;
  let heroFromY = 0;
  // prepareTier: the next tier's palette, pre-baked a step per frame before the zoom's switch.
  let prepPal: Palette | null = null;
  let prepStage = 0;
  let nextBanner: BannerArt | null = null;
  /** Debug: the slowest prepare step (ms) and the bytes both palettes held at the switch. */
  let prepMaxMs = 0;
  let reapMs = 0;
  let switchBytes = 0;
  let lanceCol: LanceColors | null = null;
  let lanceColPal: Palette | null = null;
  let lanceColHer: Heraldry | null = null;
  const slot: Slot = { x: 0, row: 0, col: 0 };
  const tmp: Vec2 = vec2();
  const tmpR: Rect = rect();
  const tmpH: Vec2 = vec2();
  const tmpC: Vec2 = vec2();
  const vis: Rect = rect();
  // CPU timing (debug).
  let cpuAcc = 0;
  let cpuN = 0;
  let cpuAvg = 0;

  const rand = (): number => {
    rr ^= rr << 13;
    rr ^= rr >>> 17;
    rr ^= rr << 5;
    return (rr >>> 0) / 4294967296;
  };

  const alloc = (): number => {
    for (let k = 0; k < MAXK; k++) if (!used[k]) return k;
    // Full (only possible mid-regroup): retire a merging knight early.
    for (let k = 0; k < MAXK; k++) {
      if (used[k] && merge[k]) {
        used[k] = 0;
        orderDirty = true;
        return k;
      }
    }
    return -1;
  };

  const recOf = (u: number): Int16Array => (u === U_ARCH ? archRec : u === U_LANCE ? lanceRec : footRec);

  /** Where a knight's slot is now: the formation, stepped back for the champions, closed up by Charge!. */
  const slotX = (k: number): number => {
    let x = rel[k]! - room;
    const u = unit[k]!;
    if (surge > 0 && u !== U_LANCE) {
      const f = surge * (u === U_ARCH ? 0.5 : 1);
      x = x * (1 - SURGE_PULL * f) + SURGE_PUSH * f;
    }
    return heroX + x;
  };

  /** Normal draw order: back rows first; within a row right to left. */
  const formationKey = (k: number): number => row[k]! * 10000 + rel[k]!;

  const activate = (u: number, i: number, marchIn: boolean, nth: number): void => {
    const k = alloc();
    if (k < 0) return;
    used[k] = 1;
    unit[k] = u;
    const bearer = u !== U_LANCE && isBearer(u === U_ARCH, i);
    flagged[k] = bearer ? 1 : 0;
    sheet[k] = u === U_ARCH ? SK_ARCHER : u === U_LANCE ? SK_LANCER : bearer ? SK_BEARER : SK_FOOT;
    slotIdx[k] = i;
    if (u === U_ARCH) archerSlot(i, slot);
    else if (u === U_LANCE) lancerSlot(i, slot);
    else footSlot(i, slot);
    row[k] = slot.row;
    rel[k] = slot.x;
    let h = Math.imul(i + (u === U_ARCH ? 7919 : u === U_LANCE ? 15881 : 0), 0x9e3779b1) >>> 0;
    h ^= h >>> 15;
    seed[k] = (Math.imul(h, 0x85ebca6b) >>> 0) / 4294967296;
    style[k] = seed[k]! < 0.42 ? 0 : seed[k]! < 0.72 ? 1 : 2;
    size[k] = 0.93 + 0.14 * (((h >>> 7) & 1023) / 1023);
    ky[k] = 0;
    lane[k] = 0;
    rot[k] = 0;
    face[k] = 1;
    run[k] = seed[k]! * 4;
    pend[k] = M_NONE;
    bounces[k] = 0;
    merge[k] = 0;
    pileI[k] = -1;
    sortKey[k] = formationKey(k);
    const sx = slotX(k);
    if (marchIn) {
      scene.camera.visibleRect(vis, 0);
      const x0 = Math.min(sx - 2, vis.x - (u === U_LANCE ? 2.5 : 1) - nth * 0.55);
      kx[k] = x0;
      mode[k] = M_MOVE;
      recruit[k] = 1;
      aux[k] = Math.max(u === U_LANCE ? HORSE_RUN : RUN, (sx - x0) / 2.6);
    } else {
      kx[k] = sx;
      mode[k] = M_IDLE;
      recruit[k] = 0;
    }
    recOf(u)[i] = k;
    orderDirty = true;
  };

  const deactivate = (u: number, i: number): void => {
    const map = recOf(u);
    const k = map[i]!;
    if (k >= 0) used[k] = 0;
    map[i] = -1;
    orderDirty = true;
  };

  /**
   * Squad size changed (one sprite now stands for more knights): the sprites past the new count
   * leave the formation and each runs into a neighbour that stays, vanishing in a puff of dust.
   * Everyone else keeps their slot (slots are index-stable), the hero and the arrows are untouched.
   */
  const regroup = (u: number, from: number, to: number): void => {
    if (to >= from) return;
    const map = recOf(u);
    for (let i = to; i < from; i++) {
      const k = map[i]!;
      map[i] = -1;
      if (k < 0) continue;
      merge[k] = 1;
      pend[k] = M_NONE;
      recruit[k] = 0;
      // The neighbour: the kept knight at the proportional spot near the back of the new ranks.
      const j = to > 0 ? Math.min(to - 1, Math.floor((i * to) / from)) : -1;
      mergeTo[k] = j >= 0 ? map[j]! : -1;
      if (grounded(mode[k]!) && !busyRider(mode[k]!)) startMerge(k);
    }
  };

  const startMerge = (k: number): void => {
    const t = mergeTo[k]!;
    const tx = t >= 0 && used[t] ? kx[t]! : heroX - 1;
    mode[k] = M_MERGE;
    t0[k] = now;
    // Everyone arrives within ~1.8 s, however far back they stood.
    aux[k] = Math.max(RUN * 1.2, Math.abs(tx - kx[k]!) / 1.8);
  };

  const resortOrder = (): void => {
    // Descending key: back rows first; within a row right to left, so every knight's sunlit (right)
    // edge stays visible over its neighbour. On the rally pile: bottom layers first. Insertion sort
    // on a small key, allocation-free.
    orderN = 0;
    for (let k = 0; k < MAXK; k++) if (used[k]) order[orderN++] = k;
    for (let i = 1; i < orderN; i++) {
      const k = order[i]!;
      const key = sortKey[k]!;
      let j = i - 1;
      while (j >= 0) {
        const o = order[j]!;
        if (sortKey[o]! >= key) break;
        order[j + 1] = o;
        j--;
      }
      order[j + 1] = k;
    }
    orderDirty = false;
  };

  /** Pending one-shot: `m` starts at time `at` (a later schedule replaces an earlier one). */
  const schedule = (k: number, m: number, at: number): void => {
    if (merge[k]) return;
    pend[k] = m;
    pendT[k] = at;
  };

  const grounded = (m: number): boolean => m !== M_FLUNG && m !== M_DOWN && m !== M_GETUP;
  /** A lancer out on a charge (not in the ranks). */
  const busyRider = (m: number): boolean => m === M_CHARGE || m === M_HIT || m === M_WHEEL;

  const dragonSize = (): number => Math.max(0.3, scene.game.state.dragon.size);

  /** Enter a mode now (validated against the current one). */
  const enter = (k: number, m: number): void => {
    const cur = mode[k]!;
    if (cur >= M_RALLY) return;
    switch (m) {
      case M_STRIKE:
        if (cur !== M_IDLE) return;
        break;
      case M_CHEER:
      case M_RAISE:
        if (!grounded(cur) || cur === M_FLEE || busyRider(cur)) return;
        break;
      case M_BRACE:
        if (unit[k] === U_LANCE) return;
        if (cur !== M_IDLE && cur !== M_STRIKE && cur !== M_MOVE) return;
        face[k] = 1;
        break;
      case M_FLEE: {
        if (!grounded(cur) || unit[k] === U_LANCE) return;
        aux[k] = fleeTo[k]!;
        laneMax[k] = LANE * (0.5 + 0.6 * rand());
        break;
      }
      case M_FLUNG: {
        if (!grounded(cur) || unit[k] === U_LANCE) return;
        const f = Math.min(2.2, Math.sqrt(Math.max(1, dragonSize() / 1.5)));
        // Wide spread so each ragdoll reads on its own: some skim low, some sail.
        const r1 = rand();
        vx[k] = -(0.6 + 6.4 * r1) * f;
        vy[k] = -(3.2 + 6.4 * rand() * (1 - 0.4 * r1)) * f;
        // Each lands at its own depth in front of the ranks, so the pile spreads out.
        laneMax[k] = LANE * (0.45 + 1.1 * rand());
        grav[k] = 15 * f;
        spin[k] = (rand() < 0.3 ? 1 : -1) * (8 + 7 * rand());
        rot[k] = 0;
        ky[k] = 0;
        bounces[k] = 0;
        break;
      }
      case M_MOVE:
        // Hurry back to the slot: never more than ~1.3 s away, however far the knight was thrown.
        aux[k] = unit[k] === U_LANCE ? Math.max(HORSE_RUN, Math.abs(slotX(k) - kx[k]!) / 1.9) : Math.max(RUN * (surge > 0.05 ? 1.6 : 1.15), Math.abs(slotX(k) - kx[k]!) / 1.3);
        break;
      default:
        break;
    }
    mode[k] = m;
    t0[k] = now;
  };

  const release = (): void => {
    breathOn = false;
    hero.brace(false);
    for (const c of champs) c.brace(false);
    for (let k = 0; k < MAXK; k++) {
      if (!used[k]) continue;
      const p = pend[k]!;
      if (p === M_BRACE || p === M_FLEE) pend[k] = M_NONE;
      const m = mode[k]!;
      if (m === M_BRACE || m === M_FLEE) {
        if (Math.abs(kx[k]! - slotX(k)) > 0.3) enter(k, M_MOVE);
        else mode[k] = M_IDLE;
      }
    }
  };

  const puff = (x: number, y: number, n: number, scale: number): void => {
    if (!dustSpec) return;
    scene.particles.world.burst(dustSpec, x, y, n, -Math.PI / 2, scale);
  };

  /** No reactions while the zoom holds, the army is piling up for it, or it has fused. */
  const holding = (): boolean => fused || rallyOn || scene.game.state.zoom.stage !== null;

  // ---- event reactions ----
  const game = scene.game;
  game.on('resync', () => (snap = true));

  game.on('strike', (e) => {
    if (holding()) return;
    if (e.auto) {
      // Rally's auto-strikes (x = y = 0 from core): they keep the hero's flurry going; its sparks
      // land on the blows (hero.onBlow), not on the events.
      hero.flurry(now);
      return;
    }
    hero.strike(now);
    // A scuff of dust from the lunging front foot.
    if (lastLod <= 1) puff(hero.x + 0.45, 0.12, 2, 0.55);
  });

  game.on('armyHit', (e) => {
    if (holding()) return;
    if (e.unit === 'lancer') {
      lanceImpact();
      return;
    }
    if (e.unit !== 'footman' || shownF === 0) return;
    // A few front-line footmen swing each beat, spread across the beat so something always moves;
    // under Charge! twice as many, and quicker.
    const charged = surge > 0.3;
    const frontCols = 2 + Math.ceil(Math.sqrt(shownF) * 0.6);
    const want = Math.min(Math.max(1, Math.round(e.hits * (charged ? 1.1 : 0.6))), (charged ? 6 : 3) + (shownF >> (charged ? 2 : 3)), charged ? 28 : 16);
    let picked = 0;
    const n = Math.min(shownF, frontCols * (charged ? 5 : 3));
    const start = (rand() * n) | 0;
    for (let s = 0; s < n && picked < want; s++) {
      const i = (start + s) % n;
      const k = footRec[i]!;
      if (k < 0 || mode[k] !== M_IDLE || pend[k] !== M_NONE) continue;
      if (n > want * 1.5 && rand() < 0.35) continue;
      schedule(k, M_STRIKE, now + rand() * (charged ? 0.5 : 0.8));
      picked++;
    }
  });

  game.on('volley', (e) => {
    if (holding()) return;
    // The Dragonbane Volley flies even with no archers (loosed from off the left edge).
    if (e.ability) {
      dragonbane(e.arrows, e.flight);
      return;
    }
    if (shownA === 0) return;
    for (let i = 0; i < shownA; i++) {
      const k = archRec[i]!;
      if (k < 0) continue;
      schedule(k, M_STRIKE, now + seed[k]! * 0.18);
    }
    const looseDef = sheets.frames[sheets.frameIndex(SK_ARCHER, A_STRIKE, 3)]!.anchor;
    scene.dragon.headPoint(tmp);
    const headX = tmp.x;
    const headY = tmp.y;
    const n = e.arrows;
    for (let a = 0; a < n; a++) {
      const i = Math.min(shownA - 1, Math.floor(((a + 0.5) * shownA) / n));
      const k = archRec[i]!;
      if (k < 0) continue;
      const sc = ROW_SCALE[row[k]!]! * UNIT * size[k]!;
      const lead = Math.min(LOOSE_T + seed[k]! * 0.18 + (a % 4) * 0.012, e.flight * 0.55);
      const x0 = kx[k]! + looseDef.launchX * sc;
      const y0 = ROW_Y[row[k]!]! + looseDef.launchY * sc;
      scene.dragon.impactPoint(tmp);
      const dist = Math.abs(tmp.x - x0);
      arrows.fire(x0, y0, tmp.x, tmp.y, now + lead, e.flight - lead, 1.3 + dist * 0.32 + seed[k]! * 0.5 + (a % 3) * 0.3, headX, headY);
    }
  });

  /**
   * The Dragonbane Volley: a sky-darkening storm, far more arrows than a volley, arcing high from
   * behind the army (every archer looses, and unseen bowmen off the left edge), all landing on the
   * dragon at `flight`.
   */
  const dragonbane = (count: number, flight: number): void => {
    hero.cheer(now);
    for (let i = 0; i < shownA; i++) {
      const k = archRec[i]!;
      if (k >= 0) schedule(k, M_STRIKE, now + seed[k]! * 0.12);
    }
    scene.dragon.headPoint(tmp);
    const headX = tmp.x;
    const headY = tmp.y;
    scene.camera.visibleRect(vis, 0);
    const looseDef = sheets.frames[sheets.frameIndex(SK_ARCHER, A_STRIKE, 3)]!.anchor;
    const n = Math.min(170, Math.max(90, Math.round(count * 2.6)));
    // The storm rises from the left of the frame (the army's rear and the host beyond it), peaks
    // mid-frame and sweeps across the whole stage onto the dragon: a sheet of arrows darkening the
    // sky for the whole flight. Each arrow's arc varies a little so the sheet has depth.
    const left = Math.min(vis.x + vis.w * 0.3, heroX - 1);
    for (let a = 0; a < n; a++) {
      let x0: number;
      let y0: number;
      let lead: number;
      const fromArcher = shownA > 0 && a % 3 === 0;
      if (fromArcher) {
        const k = archRec[Math.min(shownA - 1, Math.floor(rand() * shownA))]!;
        if (k < 0) continue;
        const sc = ROW_SCALE[row[k]!]! * UNIT * size[k]!;
        x0 = kx[k]! + looseDef.launchX * sc;
        y0 = ROW_Y[row[k]!]! + looseDef.launchY * sc;
        lead = Math.min(LOOSE_T + seed[k]! * 0.12, flight * 0.5);
      } else {
        // Bowmen behind the army: loosed from the left of the frame, nearly all at once.
        x0 = vis.x - 0.3 + (left - vis.x + 0.3) * rand();
        y0 = -0.6 - rand() * 1.2;
        lead = rand() * Math.min(0.14, flight * 0.15);
      }
      scene.dragon.impactPoint(tmp);
      // Apex at 42-58% of the visible sky's height, whatever the framing.
      const apex = -vis.y * (0.42 + 0.16 * rand());
      const lift = Math.max(1.2, apex - Math.max(-y0, -tmp.y));
      arrows.fire(x0, y0, tmp.x, tmp.y, now + lead, flight - lead, lift, headX, headY);
    }
  };

  /**
   * Lancers charge: `riders` sprites gallop at the dragon, lances lowering. They ride as a column:
   * the leading pair's lances strike at exactly `travel` (the armyHit), each rank behind a length
   * back and a beat later, so the impacts roll down the column instead of piling into one blob.
   */
  const onCavalry = (riders: number, travel: number): void => {
    if (shownL === 0) return;
    scene.dragon.bounds(tmpR);
    const bx = tmpR.x;
    const deep = Math.min(0.55, tmpR.w * 0.3);
    const spread = Math.min(0.55, Math.max(0.15, tmpR.w * 0.08));
    scene.camera.visibleRect(vis, 0);
    let j = 0;
    for (let i = 0; i < shownL && j < riders; i++) {
      const k = lanceRec[i]!;
      if (k < 0 || merge[k] || busyRider(mode[k]!) || mode[k]! >= M_RALLY) continue;
      const sc = ROW_SCALE[row[k]!]! * UNIT * size[k]!;
      const reach = (lanceGrip.poleX + Math.cos(LANCE_COUCH) * LANCE_FWD) * sc;
      const rank = j >> 1;
      // Lance points spread over the dragon's front; each rank rides a horse-length behind the last.
      // Lances bite deep (the horses end the charge in plain view, past the hero's shoulder).
      const tipX = bx + deep + (rank % 3) * spread + (j & 1) * spread * 0.45 + rand() * 0.1;
      const x1 = tipX - reach - rank * 1.25 * (sc / UNIT);
      // Still out by the dragon from the last charge: it rides this one out.
      if (kx[k]! > x1 - 0.8) continue;
      // Riding from far off screen, start just past the left edge so the whole charge is seen.
      chX0[k] = Math.max(kx[k]!, Math.min(x1 - 3, vis.x - 1.6 - rank * 1.4));
      chX1[k] = x1;
      chDur[k] = Math.max(0.3, travel + rank * 0.07 + (j & 1) * 0.03);
      pend[k] = M_NONE;
      mode[k] = M_CHARGE;
      t0[k] = now;
      face[k] = 1;
      j++;
    }
  };

  /** A rider reaches the end of its charge: the lance bites (the column's impacts roll in). */
  const riderStrikes = (k: number): void => {
    if (lastLod > 3) return;
    const sc = ROW_SCALE[row[k]!]! * UNIT * size[k]!;
    const x = kx[k]! + (lanceGrip.poleX + Math.cos(LANCE_COUCH) * LANCE_FWD) * sc;
    const y = ROW_Y[row[k]!]! + (lanceGrip.poleY + Math.sin(LANCE_COUCH) * LANCE_FWD) * sc;
    if (x < scene.dragon.bounds(tmpR).x - 0.1) {
      puff(kx[k]! + 0.6, ROW_Y[row[k]!]!, 3, 1);
      return;
    }
    scene.fx.burst('sparks', x, y, 0.4);
  };

  /** The lances land (armyHit lancer): splinters and sparks at every lance point in the dragon. */
  const lanceImpact = (): void => {
    let n = 0;
    for (let k = 0; k < MAXK && n < 10; k++) {
      if (!used[k] || unit[k] !== U_LANCE) continue;
      const m = mode[k]!;
      if (m !== M_HIT && !(m === M_CHARGE && now - t0[k]! > chDur[k]! * 0.8)) continue;
      const sc = ROW_SCALE[row[k]!]! * UNIT * size[k]!;
      const x = kx[k]! + (lanceGrip.poleX + Math.cos(LANCE_COUCH) * LANCE_FWD) * sc;
      const y = ROW_Y[row[k]!]! + (lanceGrip.poleY + Math.sin(LANCE_COUCH) * LANCE_FWD) * sc;
      if ((n & 1) === 0) scene.fx.burst('flare', x, y, 0.7);
      scene.fx.burst('sparks', x, y, 0.3);
      n++;
    }
    if (n > 0) {
      scene.camera.addTrauma(Math.min(0.28, 0.08 + 0.02 * n));
      scene.fx.burst('dust', chX1Avg(), 0, Math.min(2, 0.6 + n * 0.15));
    }
  };

  const chX1Avg = (): number => {
    let s = 0;
    let n = 0;
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || unit[k] !== U_LANCE || !busyRider(mode[k]!)) continue;
      s += chX1[k]!;
      n++;
    }
    return n > 0 ? s / n + 1 : heroX + 1;
  };

  game.on('cavalry', (e) => {
    if (holding()) return;
    onCavalry(e.riders, e.travel);
  });

  /** Windup: the knights nearest the dragon crouch behind their shields late in the windup. */
  const onWindup = (dur: number): void => {
    const reach = 1.6 + 0.3 * dragonSize();
    const front = heroX + 0.2;
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || unit[k] !== U_FOOT) continue;
      if (front - slotX(k) < reach) schedule(k, M_BRACE, now + dur * (0.55 + 0.25 * rand()));
    }
  };

  /** Optional live queries the dragon rig may provide (DragonView extensions, coded defensively). */
  const live = (): LiveDragon => scene.dragon as LiveDragon;

  /** How many knights a swipe may throw: a handful for a newt, a crowd for a barn-sized dragon. */
  const flingCap = (): number => Math.min(20, Math.max(6, Math.round(4 + dragonSize())));

  /**
   * Fire: knights in its path scatter back; the next ranks crouch; the hero leans into it. The path
   * is the rig's flame reach when it tells us (breathReachX), else an estimate from the head.
   * Champions brace (Ser Aldric puts his shield over his head).
   */
  const onBreath = (): void => {
    breathOn = true;
    hero.brace(true);
    for (const c of champs) c.brace(true);
    const dv = live();
    scene.dragon.headPoint(tmp);
    const reachX = dv.breathReachX ? dv.breathReachX() : tmp.x - Math.max(2.1, 1.5 * dragonSize());
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || unit[k] === U_LANCE) continue;
      const x = kx[k]!;
      if (x > reachX) {
        // A scramble back, not a rout: a couple of meters, then they cower and press forward again
        // (the host must stay close behind the hero at every dragon size).
        schedule(k, M_FLEE, now + Math.max(0, Math.min(0.4, (tmp.x - x) * 0.015)) + rand() * 0.12);
        fleeTo[k] = x - (1.1 + rand() * 1.3);
      } else if (x > reachX - 2.5) schedule(k, M_BRACE, now + rand() * 0.25);
    }
  };

  /**
   * Tail swipe. With the rig's live tail tip (tailPoint), knights fly exactly when the tail sweeps
   * through them (see sweepTail, per frame). Without it, the front of the line goes flying on a
   * timed sweep, nearest first.
   */
  const onSwipe = (dur: number): void => {
    hero.brace(true);
    for (const c of champs) c.brace(true);
    swept.fill(0);
    flungN = 0;
    if (live().tailPoint) {
      swipeUntil = now + dur + 0.25;
      return;
    }
    const reach = 1.5 + 0.32 * dragonSize();
    const front = heroX + 0.2;
    const cap = flingCap();
    for (let k = 0; k < MAXK && flungN < cap; k++) {
      if (!used[k] || merge[k] || unit[k] === U_LANCE) continue;
      const dx = front - kx[k]!;
      if (dx > reach || !grounded(mode[k]!)) continue;
      // Not everyone in reach goes flying: some just get bowled over into a crouch.
      if (flungN > 2 && rand() < 0.3) {
        schedule(k, M_BRACE, now + dur * 0.15);
        continue;
      }
      schedule(k, M_FLUNG, now + dur * (0.05 + 0.2 * (dx / reach)) + rand() * 0.04);
      flungN++;
    }
  };

  /** Per frame during a swipe: throw the grounded knights the live tail tip passes through. */
  const sweepTail = (): void => {
    const dv = live();
    if (now > swipeUntil || !dv.tailPoint) return;
    dv.tailPoint(tmp);
    const sz = dragonSize();
    // Only when the tip is down among the knights, not whipping overhead.
    if (tmp.y < -(KNIGHT_HEIGHT * 1.1 + 0.12 * sz)) return;
    // Generous "near": the whoosh bowls over the rank next to the tip too (a newt's tail only
    // reaches the hero's shins, but the first footmen should still go tumbling).
    const r = 1.1 + 0.1 * sz;
    const cap = flingCap();
    for (let k = 0; k < MAXK && flungN < cap; k++) {
      if (!used[k] || swept[k] || merge[k] || unit[k] === U_LANCE || !grounded(mode[k]!)) continue;
      if (Math.abs(kx[k]! - tmp.x) > r) continue;
      swept[k] = 1;
      enter(k, M_FLUNG);
      flungN++;
    }
  };

  /** A kill: a cheer rolls back through the ranks from the hero (horses rear). */
  const onCheer = (): void => {
    hero.brace(false);
    hero.cheer(now + 0.35);
    for (const c of champs) {
      c.brace(false);
      c.cheer(now + 0.4 + 0.1 * CHAMP_IDS.indexOf(c.id));
    }
    for (let k = 0; k < MAXK; k++) {
      if (!used[k]) continue;
      const delay = 0.45 + Math.min(1.8, Math.max(0, (heroX - kx[k]!) * 0.035)) + rand() * 0.15;
      schedule(k, M_CHEER, now + delay);
    }
  };

  /** A unit milestone: that unit raises its weapons, each blade catching the light (horses rear). */
  const onRaise = (u: number): void => {
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || unit[k] !== u) continue;
      schedule(k, M_RAISE, now + 0.1 + Math.min(1.2, slotIdx[k]! * 0.012) + rand() * 0.08);
    }
  };

  game.on('dragonPhase', (e) => {
    if (e.phase === 'leave' || holding()) {
      release();
      return;
    }
    if (e.phase === 'windup') onWindup(e.dur);
    else if (e.phase === 'breath') onBreath();
    else if (e.phase === 'swipe') onSwipe(e.dur);
    else release();
  });
  game.on('dragonSpawn', () => {
    release();
    arrows.fadeAll(now);
  });
  game.on('dragonDeath', () => {
    arrows.fadeAll(now);
    if (holding()) return;
    onCheer();
  });
  game.on('milestone', (e) => {
    if (holding()) return;
    onRaise(e.unit === 'archer' ? U_ARCH : e.unit === 'lancer' ? U_LANCE : U_FOOT);
  });

  hero.onBlow = () => {
    if (lastLod > 3) return;
    scene.dragon.impactPoint(tmp);
    const front = scene.dragon.bounds(tmpR).x;
    scene.fx.burst('sparks', Math.min(tmp.x, front + 0.25 + rand() * 0.35), tmp.y, 0.5);
  };

  // ---- champions ----
  const champ = (id: ChampionId): Champion | null => {
    for (const c of champs) if (c.id === id) return c;
    return null;
  };
  game.on('championHit', (e) => {
    if (holding()) return;
    champ(e.id)?.strike(now);
  });
  game.on('championSpecial', (e) => {
    if (holding()) return;
    champ(e.id)?.special(now, e.damage);
  });
  for (const c of champs) {
    c.onArrive = (ch) => {
      // The moment: a glint on the raised blade, and the whole army cheers its new champion.
      ch.tip(tmpC);
      scene.fx.burst('glint', tmpC.x, tmpC.y, 1.6);
      scene.fx.burst('shimmer', tmpC.x, tmpC.y, 1);
      if (!holding()) onCheer();
    };
    c.onImpact = (ch, x, y, damage) => {
      if (ch.id === 'aldric') {
        // Heroic Lunge: a blazing cut at the end of the leap.
        scene.fx.burst('slash', x, y, 2.2);
        scene.fx.burst('sparksBig', x, y, 1.2);
        scene.fx.burst('flare', x, y, 1.4);
        scene.camera.addTrauma(0.3);
        scene.camera.punchZoom(0.02);
      } else {
        // Avalanche Cleave: the axe splits the ground before the dragon; the ground bursts.
        scene.fx.burst('shockwave', x, 0, 2.6);
        scene.fx.burst('dust', x, 0, 2.6);
        scene.fx.burst('dust', x + 0.8, 0, 1.6);
        scene.fx.burst('sparksBig', x, -0.1, 1.3);
        scene.fx.burst('shockwave', x, 0, 1.4);
        scene.camera.addTrauma(0.48);
        scene.camera.punchZoom(0.03);
        scene.fx.kick(0.35);
        // The ground jolts the nearest ranks off their feet for a moment.
        for (let k = 0; k < MAXK; k++) {
          if (!used[k] || unit[k] !== U_FOOT || mode[k] !== M_IDLE) continue;
          if (Math.abs(kx[k]! - x) < 3.2) schedule(k, M_CHEER, now + 0.05 + rand() * 0.1);
        }
      }
      if (damage) {
        scene.dragon.impactPoint(tmp);
        scene.fx.damageNumber(Math.min(tmp.x, x + 0.6), Math.min(tmp.y, y - 0.3), damage as Decimal, 'crit');
      }
    };
  }

  // ---- abilities ----
  game.on('abilityUse', (e) => {
    if (holding()) return;
    if (e.id === 'charge') {
      // Charge!: a war cry, then the ranks run in close behind the hero, banners up, dust flying
      // (the surge itself follows state.abilities.charge, see update).
      hero.cheer(now);
      for (const c of champs) c.cheer(now + 0.05);
      for (let k = 0; k < MAXK; k++) {
        if (!used[k] || unit[k] === U_LANCE || mode[k] !== M_IDLE) continue;
        pend[k] = M_NONE;
      }
      if (lastLod <= 2) for (let i = 0; i < 6; i++) puff(heroX - 0.8 - i * 0.9 - room, 0.1, 3, 1);
    }
  });
  // ---- the zoom ----
  game.on('zoomBegin', () => {
    // Everything in flight is dropped; one-shots are cancelled so nothing fights the rally.
    arrows.fadeAll(now);
    surgeOn = false;
    release();
    for (let k = 0; k < MAXK; k++) if (used[k]) pend[k] = M_NONE;
  });

  /** Everyone runs to x and climbs into one pile; the hero rides it up. */
  const rally = (x: number, seconds: number): void => {
    if (fused) return;
    rallyOn = true;
    rallyX = x;
    rallyT0 = now;
    rallyDur = Math.max(0.3, seconds);
    arrows.fadeAll(now);
    surgeOn = false;
    breathOn = false;
    swipeUntil = -1;
    // Infantry and archers climb; lancers ride to the flanks and rear.
    let n = 0;
    let maxD = 0.5;
    for (let k = 0; k < MAXK; k++) {
      if (!used[k]) continue;
      pend[k] = M_NONE;
      recruit[k] = 0;
      if (merge[k]) {
        used[k] = 0;
        continue;
      }
      rot[k] = 0;
      ky[k] = 0;
      if (unit[k] === U_LANCE) continue;
      cand[n] = k;
      const d = Math.abs(kx[k]! - x);
      candD[n] = d;
      if (d > maxD) maxD = d;
      n++;
    }
    // Nearest first: the first to arrive form the base.
    for (let i = 1; i < n; i++) {
      const k = cand[i]!;
      const d = candD[i]!;
      let j = i - 1;
      while (j >= 0 && candD[j]! > d) {
        cand[j + 1] = cand[j]!;
        candD[j + 1] = candD[j]!;
        j--;
      }
      cand[j + 1] = k;
      candD[j + 1] = d;
    }
    pile.build(n);
    const half = pile.halfWidth();
    rallyLast = now + rallyDur;
    // Everyone reaches the foot of the pile in the first ~55% of `seconds` (the nearest first),
    // then the layers settle bottom-up so the last knight is on top at exactly `seconds`; after
    // that the pile swells and packs tighter until the zoom fuses it.
    const runEnd = rallyDur * 0.55;
    const layers = Math.max(1, pile.layers);
    for (let i = 0; i < n; i++) {
      const k = cand[i]!;
      pileI[k] = i;
      const arrive = now + runEnd * (0.35 + 0.65 * Math.pow(candD[i]! / maxD, 0.8));
      const l = pile.layer[i]!;
      const settle = now + rallyDur * (0.58 + (0.42 * (l + 1)) / layers);
      const side = kx[k]! < x ? -1 : 1;
      chX0[k] = kx[k]!;
      // Layer 0 runs straight to its spot; the rest to the foot of the slope on their side.
      chX1[k] = l === 0 ? x + pile.x[i]! : x + side * (half * (1 - l / Math.max(1, pile.layers)) + 0.35);
      // A quick scramble up (longer for the high layers), started so it ends on the layer's beat.
      chDur[k] = Math.max(0.12, Math.min(settle - arrive, 0.24 + 0.03 * l));
      climbS[k] = settle - chDur[k]!;
      climbT[k] = arrive;
      mode[k] = M_RALLY;
      t0[k] = now;
      lane[k] = Math.min(lane[k]!, 0.2);
      face[k] = chX1[k]! >= kx[k]! ? 1 : -1;
      sortKey[k] = (200 - l) * 1000 + row[k]! * 10 + (pile.x[i]! > 0 ? 0 : 1);
      if (arrive + chDur[k]! > rallyLast) rallyLast = arrive + chDur[k]!;
    }
    // Lancers: to the flanks, alternating sides, then rear with lances high.
    let j = 0;
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || unit[k] !== U_LANCE) continue;
      const side = j & 1 ? 1 : -1;
      chX0[k] = kx[k]!;
      chX1[k] = x + side * (half + 1.3 + (j >> 1) * 1.4) - (side > 0 ? 0 : 1.2);
      climbT[k] = now + rallyDur * (0.45 + 0.35 * rand());
      chDur[k] = 0;
      pileI[k] = -1;
      mode[k] = M_RALLY;
      t0[k] = now;
      face[k] = chX1[k]! >= kx[k]! ? 1 : -1;
      sortKey[k] = 900000 + row[k]!;
      j++;
    }
    orderDirty = true;
    pileTop = 0;
    heroFromX = hero.x;
    heroFromY = hero.y;
    hero.brace(false);
    hero.hold(true);
    for (let i = 0; i < champs.length; i++) champs[i]!.rally(now, x + (i === 0 ? -0.62 : 0.66), 0.05, now + rallyDur * 0.85);
  };

  const setFused = (on: boolean): void => {
    if (on) {
      fused = true;
      return;
    }
    // Back from state in the (new) tier: hero, champions, any starting troops, placed. Also ends
    // a rally the zoom never fused.
    if (fused || rallyOn) snap = true;
    fused = false;
    rallyOn = false;
  };

  /** Snap everything to state with no effects (resync, un-fuse). */
  const snapAll = (): void => {
    for (let k2 = 0; k2 < MAXK; k2++) used[k2] = 0;
    footRec.fill(-1);
    archRec.fill(-1);
    lanceRec.fill(-1);
    orderDirty = true;
    shownF = shownA = shownL = 0;
    arrows.clear();
    hero.snap();
    rallyOn = false;
    surgeOn = false;
    surge = 0;
    breathOn = false;
    swipeUntil = -1;
  };

  // ---- view (director + other modules) ----
  const view: CrowdView = {
    heroPoint(out) {
      hero.chest(out);
      return out;
    },
    frontX() {
      return hero.x + hero.restTipX;
    },
    bounds(out: Rect) {
      // Stable: hero + every occupied slot (never the march-ins, flyers, fleeing or charging).
      let left = heroX - 0.7;
      for (let i = shownF - 3; i < shownF; i++) {
        if (i < 0) continue;
        footSlot(i, slot);
        if (heroX + slot.x - room - 0.5 < left) left = heroX + slot.x - room - 0.5;
      }
      for (let i = shownA - 2; i < shownA; i++) {
        if (i < 0) continue;
        archerSlot(i, slot);
        if (heroX + slot.x - room - 0.5 < left) left = heroX + slot.x - room - 0.5;
      }
      for (let i = shownL - 2; i < shownL; i++) {
        if (i < 0) continue;
        lancerSlot(i, slot);
        if (heroX + slot.x - room - 1.4 < left) left = heroX + slot.x - room - 1.4;
      }
      if (champN > 0) left = Math.min(left, heroX - CHAMP_GAP[Math.min(champN, CHAMP_GAP.length) - 1]! - 0.6);
      out.x = left;
      // Tall enough for the banners (pole tops ~3.2 m) once anyone carries one.
      out.y = shownF + shownA + shownL + champN > 0 ? -3.3 : -KNIGHT_HEIGHT * 1.3;
      out.w = heroX + hero.restTipX + 0.1 - left;
      out.h = -out.y + 0.3;
      return out;
    },
    setHeraldry(h: Heraldry) {
      heraldry = { ...h };
      customHeraldry = true;
    },
    rally,
    setFused,
    prepareTier(tier: number) {
      prepareTier(tier);
    },
    heroRest(out: Vec2) {
      const s = scene.game.state;
      out.x = scene.dragon.bounds(tmpR).x - heroStandOff(s.dragon.size);
      out.y = 0.12;
      return out;
    },
  };

  /**
   * The zoom's rally calls prepareTier(next): bake the next tier's art over the coming frames, one
   * bounded step per frame, so the switch itself re-bakes nothing (the palette swap is instant).
   */
  const prepareTier = (tier: number): void => {
    const p = paletteFor(tier);
    if (p === pal || p === prepPal) return;
    prepPal = p;
    prepStage = 0;
    prepMaxMs = 0;
    sheets.prepare(p);
  };

  const prepareStep = (budget: number): void => {
    // Each step is bounded; the painted-heraldry steps can't be split, so they wait for a frame
    // with most of the budget free.
    if (budget < (prepStage < 4 ? BAKE_BUDGET * 0.7 : 0.5)) return;
    const p = prepPal!;
    const t0 = performance.now();
    const h = heraldry ?? defaultHeraldry(p);
    switch (prepStage) {
      case 0:
        nextBanner = new BannerArt();
        nextBanner.update(h, p);
        break;
      case 1:
        hero.prepare(p, h);
        break;
      case 2:
      case 3:
        champs[prepStage - 2]!.prepare(p);
        break;
      case 4:
        scene.atlas.tint(scene.sprites.dust, mixHex(p.haze, p.rim, 0.25));
        break;
      default:
        // The footmen who start the next tier (Tower heraldry), at the close framing it opens on.
        if (!sheets.prepareStep(0, 3, Math.max(0.4, budget - 1))) {
          prepMaxMs = Math.max(prepMaxMs, performance.now() - t0);
          return;
        }
        break;
    }
    prepMaxMs = Math.max(prepMaxMs, performance.now() - t0);
    if (prepStage < 5) prepStage++;
  };

  // ---- per-frame update ----
  const updateKnight = (k: number, dt: number): void => {
    if (pend[k] !== M_NONE && now >= pendT[k]!) {
      const m = pend[k]!;
      pend[k] = M_NONE;
      enter(k, m);
    }
    const sx = slotX(k);
    let m = mode[k]!;
    if (merge[k] && m !== M_MERGE && grounded(m) && m !== M_FLEE && !busyRider(m) && m < M_RALLY) {
      startMerge(k);
      m = M_MERGE;
    }
    const el = now - t0[k]!;
    const horse = unit[k] === U_LANCE;
    switch (m) {
      case M_MERGE: {
        const t = mergeTo[k]!;
        const tx = t >= 0 && used[t] && !merge[t] ? kx[t]! : heroX - 1;
        const d = tx - kx[k]!;
        const sp = aux[k]! * dt;
        if (Math.abs(d) <= Math.max(sp, 0.05)) {
          puff(kx[k]!, ROW_Y[row[k]!]!, horse ? 6 : 4, horse ? 1.3 : 0.9);
          used[k] = 0;
          merge[k] = 0;
          orderDirty = true;
        } else {
          kx[k] = kx[k]! + (d > 0 ? sp : -sp);
          face[k] = d > 0 ? 1 : -1;
          run[k] = run[k]! + (horse ? (dt * aux[k]!) / STRIDE_M : (dt * Math.min(aux[k]!, 5)) / 1.3);
        }
        break;
      }
      case M_IDLE: {
        if (lane[k]! > 0) lane[k] = Math.max(0, lane[k]! - dt * 0.8);
        const d = sx - kx[k]!;
        if (Math.abs(d) > (horse ? 0.9 : 0.45)) enter(k, M_MOVE);
        else kx[k] = kx[k]! + d * Math.min(1, dt * 5);
        face[k] = 1;
        break;
      }
      case M_MOVE: {
        const d = sx - kx[k]!;
        const sp = aux[k]! * dt;
        if (lane[k]! > 0) lane[k] = Math.min(lane[k]!, laneMax[k]! * Math.min(1, Math.abs(d) / 1.6)) - dt * 0.05;
        if (lane[k]! < 0) lane[k] = 0;
        if (Math.abs(d) <= sp) {
          kx[k] = sx;
          mode[k] = M_IDLE;
          face[k] = 1;
          if (recruit[k]) {
            // "Reporting for duty!": one hop with the weapon up (a horse rears).
            recruit[k] = 0;
            mode[k] = M_CHEER;
            t0[k] = now - CHEER_CYCLE * (CHEER_HOPS - 1);
          }
        } else {
          kx[k] = kx[k]! + (d > 0 ? sp : -sp);
          face[k] = d > 0 ? 1 : -1;
          const before = run[k]!;
          run[k] = before + (horse ? (dt * aux[k]!) / STRIDE_M : (dt * Math.min(aux[k]!, 5)) / 1.3);
          // A puff of dust at footfalls (only up close, where it reads).
          if (((run[k]! * 2) | 0) !== ((before * 2) | 0) && lastLod <= (horse ? 2 : 1) && rand() < 0.6) puff(kx[k]!, ROW_Y[row[k]!]! + lane[k]!, horse ? 2 : 1, horse ? 0.8 : 0.45);
        }
        break;
      }
      case M_STRIKE: {
        kx[k] = kx[k]! + (sx - kx[k]!) * Math.min(1, dt * 5);
        const rate = unit[k] === U_ARCH ? 1 : 1 + 0.55 * surge;
        if (el * rate > (unit[k] === U_ARCH ? STRIKE_DUR_ARCH : STRIKE_DUR_FOOT)) mode[k] = M_IDLE;
        break;
      }
      case M_CHEER:
        if (el > CHEER_CYCLE * CHEER_HOPS) mode[k] = M_IDLE;
        break;
      case M_RAISE:
        if (el > RAISE_DUR) mode[k] = M_IDLE;
        break;
      case M_BRACE:
        if (el > 6) release();
        break;
      case M_FLEE: {
        lane[k] = Math.min(laneMax[k]!, lane[k]! + dt * 1.2);
        const d = aux[k]! - kx[k]!;
        const sp = RUN * 1.45 * dt;
        if (Math.abs(d) <= sp) {
          kx[k] = aux[k]!;
          mode[k] = M_BRACE;
          t0[k] = now;
          if (!breathOn) enter(k, M_MOVE);
        } else {
          kx[k] = kx[k]! + (d > 0 ? sp : -sp);
          run[k] = run[k]! + dt * 3.3;
        }
        break;
      }
      case M_FLUNG: {
        lane[k] = Math.min(laneMax[k]!, lane[k]! + dt * 0.9);
        vy[k] = vy[k]! + grav[k]! * dt;
        kx[k] = kx[k]! + vx[k]! * dt;
        ky[k] = ky[k]! + vy[k]! * dt;
        rot[k] = rot[k]! + spin[k]! * dt;
        if (ky[k]! >= 0 && vy[k]! > 0) {
          ky[k] = 0;
          const s = Math.sqrt(Math.max(1, dragonSize() / 1.5));
          if (bounces[k] === 0 && vy[k]! > 3 * s) {
            bounces[k] = 1;
            vy[k] = -vy[k]! * 0.28;
            vx[k] = vx[k]! * 0.45;
            spin[k] = spin[k]! * 0.5;
            puff(kx[k]!, ROW_Y[row[k]!]! + lane[k]!, 3, 0.8 * s);
          } else {
            mode[k] = M_DOWN;
            t0[k] = now;
            rot[k] = 0;
            aux[k] = 0.35 + seed[k]! * 0.45;
            puff(kx[k]!, ROW_Y[row[k]!]! + lane[k]!, 6, 1.2 * s);
          }
        }
        break;
      }
      case M_DOWN:
        if (el > aux[k]!) {
          mode[k] = M_GETUP;
          t0[k] = now;
        }
        break;
      case M_GETUP:
        if (el > GETUP_DUR) enter(k, M_MOVE);
        break;
      case M_CHARGE: {
        // Spring out of the ranks, arrive at full gallop: x(u) = u (0.75 + 0.25 u).
        const u = Math.min(1, el / chDur[k]!);
        const before = kx[k]!;
        kx[k] = chX0[k]! + (chX1[k]! - chX0[k]!) * u * (0.75 + 0.25 * u);
        const r0 = run[k]!;
        run[k] = r0 + Math.max(dt * 1.2, Math.abs(kx[k]! - before) / STRIDE_M);
        if (((run[k]! * 2) | 0) !== ((r0 * 2) | 0) && lastLod <= 2) puff(kx[k]! - 0.5, ROW_Y[row[k]!]!, 2, 0.9);
        if (u >= 1) {
          mode[k] = M_HIT;
          t0[k] = now;
          riderStrikes(k);
        }
        break;
      }
      case M_HIT:
        // The shove of the impact, then the recoil.
        kx[k] = chX1[k]! + 0.2 * Math.sin(Math.PI * Math.min(1, el / HIT_DUR)) * (el < HIT_DUR * 0.5 ? 1 : 0.6);
        if (el > HIT_DUR) {
          mode[k] = M_WHEEL;
          t0[k] = now;
          if (lastLod <= 2) puff(kx[k]!, ROW_Y[row[k]!]!, 3, 1.1);
        }
        break;
      case M_WHEEL:
        kx[k] = chX1[k]! - 0.35 * Math.min(1, el / WHEEL_DUR);
        if (el > WHEEL_DUR) {
          face[k] = -1;
          enter(k, M_MOVE);
        }
        break;
      case M_RALLY: {
        // Rush to the foot of the pile (or a flank, for the horses), then climb.
        const at = climbT[k]!;
        const u = Math.min(1, el / Math.max(0.05, at - t0[k]!));
        const before = kx[k]!;
        kx[k] = chX0[k]! + (chX1[k]! - chX0[k]!) * (u * u * (3 - 2 * u) * 0.35 + u * 0.65);
        ky[k] = 0;
        lane[k] = Math.max(0, lane[k]! - dt);
        const sp = Math.abs(kx[k]! - before);
        run[k] = run[k]! + (horse ? Math.max(dt, sp / STRIDE_M) : Math.max(dt * 1.5, sp / 1.3));
        face[k] = chX1[k]! >= chX0[k]! ? 1 : -1;
        if (u >= 1) {
          if (horse) {
            mode[k] = M_PILE;
            t0[k] = now;
          } else if (pile.layer[pileI[k]!] === 0) {
            mode[k] = M_PILE;
            t0[k] = now;
            pileSettle(k);
          } else if (now >= climbS[k]!) {
            mode[k] = M_CLIMB;
            t0[k] = now;
          }
        }
        break;
      }
      case M_CLIMB: {
        const i = pileI[k]!;
        const u = Math.min(1, el / chDur[k]!);
        const tx = rallyX + pile.x[i]! * pileSqueeze();
        const ty = -pile.h[i]! * pileGrow();
        const e = u * u * (3 - 2 * u);
        kx[k] = chX1[k]! + (tx - chX1[k]!) * e;
        ky[k] = ty * e - 0.55 * Math.sin(Math.PI * u);
        face[k] = tx >= chX1[k]! ? 1 : -1;
        if (u >= 1) {
          mode[k] = M_PILE;
          t0[k] = now;
          pileSettle(k);
        }
        break;
      }
      case M_PILE: {
        const i = pileI[k]!;
        if (i >= 0) {
          kx[k] = rallyX + pile.x[i]! * pileSqueeze();
          ky[k] = -pile.h[i]! * pileGrow() - 0.04 * Math.max(0, Math.sin(now * 7 + seed[k]! * 30));
          face[k] = 1;
        } else {
          ky[k] = 0;
          face[k] = kx[k]! < rallyX ? 1 : -1;
        }
        break;
      }
    }
  };

  /** The pile swells upward and packs tighter once the last knights are on it. */
  const pileGrow = (): number => {
    const u = Math.max(0, Math.min(1, (now - rallyLast) / 1.1));
    return 1 + 0.14 * u * u * (3 - 2 * u);
  };
  const pileSqueeze = (): number => {
    const u = Math.max(0, Math.min(1, (now - rallyLast) / 1.1));
    return 1 - 0.14 * u * u * (3 - 2 * u);
  };
  /** A knight reached its spot: the pile's top rises to it (the hero rides the top). */
  const pileSettle = (k: number): void => {
    const h = pile.h[pileI[k]!]!;
    if (h > pileTop) pileTop = h;
    if (lastLod <= 3 && rand() < 0.25) puff(kx[k]!, ky[k]! + ROW_Y[row[k]!]!, 1, 0.6);
  };

  const ensureArt = (p: Palette): void => {
    if (p !== pal && pal) {
      // A new tier: take what prepareTier baked ahead, drop whatever wasn't for this palette.
      if (p === prepPal) {
        switchBytes = sheets.bytes + sheets.nextBytes;
        if (nextBanner) bannerArt = nextBanner;
      }
      nextBanner = null;
      prepPal = null;
    }
    sheets.setPalette(p);
    if (!heraldry || (!customHeraldry && pal !== p)) heraldry = defaultHeraldry(p);
    pal = p;
    bannerArt.update(heraldry, p);
    if (p !== dustPal) {
      dustPal = p;
      const id = scene.atlas.tint(scene.sprites.dust, mixHex(p.haze, p.rim, 0.25));
      dustSpec = particleSpec({ sprite: id, life: 0.85, lifeVar: 0.35, speed: 1.1, speedVar: 0.6, angle: -Math.PI / 2, spread: 1.3, radius: 0.12, gravity: -0.5, drag: 2.6, size: 0.5, sizeEnd: 1.25, sizeVar: 0.35, alpha: 0.42, curve: CURVE_FADE });
    }
    if (lanceColPal !== p || lanceColHer !== heraldry) {
      lanceColPal = p;
      lanceColHer = heraldry;
      const field = heraldry.field;
      lanceCol = {
        sil: p.silhouette,
        rim: mixHex(p.rim, p.silhouette, 0.15),
        field: mixHex(field, p.silhouette, 0.12),
        fieldLit: mixHex(field, p.rim, 0.3),
        fieldShade: mixHex(field, p.silhouette, 0.4),
        trim: mixHex(p.accent.gold, p.silhouette, 0.2),
      };
    }
    if (glintSprite < 0) {
      const star = scene.atlas.register('crowd.glint', 64, 64, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.22);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        c.fillStyle = '#fff';
        for (let r = 0; r < 2; r++) {
          c.save();
          c.translate(w / 2, h / 2);
          c.rotate((r * Math.PI) / 2);
          c.beginPath();
          c.moveTo(-w / 2, 0);
          c.lineTo(0, -1.6);
          c.lineTo(w / 2, 0);
          c.lineTo(0, 1.6);
          c.closePath();
          c.fill();
          c.restore();
        }
      });
      glintSprite = scene.atlas.tint(star, p.accent.glow, 0.8);
    }
  };

  // ---- drawing (per-frame parameters live here so the helpers below allocate nothing) ----
  let fA = 1;
  let fB = 0;
  let fC = 0;
  let fD = 1;
  let fE = 0;
  let fF = 0;
  let fW = 1;
  let fPxu = 1;
  let fLod = 0;
  let fMargin = 0;
  let fFlagSize = 0;
  let fXo = 0;
  let fYo = 0;
  let fPal: Palette | null = null;
  let glints = 0;
  let bandX = 0;
  let bandY = 0;
  let bandW = 0;
  let bandH = 0;
  let bandBuf: HTMLCanvasElement | null = null;
  let bandCtx: CanvasRenderingContext2D | null = null;

  const beginBand = (): CanvasRenderingContext2D => {
    if (!bandBuf || bandBuf.width < bandW || bandBuf.height < bandH) {
      bandBuf = makeCanvas(Math.max(bandW, bandBuf?.width ?? 0), Math.max(bandH, bandBuf?.height ?? 0));
      bandCtx = context2d(bandBuf);
    }
    const b = bandCtx!;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, bandW, bandH);
    fXo = bandX;
    fYo = bandY;
    return b;
  };

  const flushBand = (ctx: CanvasRenderingContext2D, band: number): void => {
    const b = bandCtx!;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-atop';
    // Less haze when pulled back: tiny far knights need contrast against the dusk hills.
    b.globalAlpha = BAND_HAZE[band]! * Math.min(1, Math.max(0.3, fPxu / 1.7));
    b.fillStyle = fPal!.haze;
    b.fillRect(0, 0, bandW, bandH);
    b.globalAlpha = 1;
    b.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(bandBuf!, 0, 0, bandW, bandH, bandX, bandY, bandW, bandH);
  };

  /** The lance's angle (figure space) for a lancer's mode. */
  const lanceAngle = (k: number, m: number, el: number): number => {
    switch (m) {
      case M_CHARGE: {
        const u = Math.min(1, el / (chDur[k]! * 0.5));
        return LANCE_UP + (LANCE_COUCH - LANCE_UP) * u * u * (3 - 2 * u);
      }
      case M_HIT:
        return LANCE_COUCH + 0.04 * Math.sin(el * 40) * (1 - el / HIT_DUR);
      case M_WHEEL: {
        const u = Math.min(1, el / (WHEEL_DUR * 0.7));
        return LANCE_COUCH + (-1.75 - LANCE_COUCH) * u * u * (3 - 2 * u);
      }
      case M_CHEER:
      case M_RAISE:
      case M_PILE:
        return -1.75;
      default:
        // Riding back (mirrored frames): the tip trails toward +x.
        return face[k]! < 0 ? -1.2 : LANCE_UP + 0.04 * Math.sin(now * 0.9 + seed[k]! * 20);
    }
  };

  const drawKnight = (g: CanvasRenderingContext2D, k: number): void => {
    const m = mode[k]!;
    const sk = sheet[k]!;
    const r = row[k]!;
    const sd = seed[k]!;
    const el = now - t0[k]!;
    let anim = A_IDLE_A;
    let fi = 0;
    let px = kx[k]!;
    const ln = lane[k]!;
    let py = ROW_Y[r]! + ky[k]! + ln;
    let sy = 1;
    let sh = 0;
    let fc = 1;
    let rt = 0;
    if (sk === SK_LANCER) {
      switch (m) {
        case M_IDLE:
          anim = style[k] === 1 ? L_IDLE_B : L_IDLE;
          sy = 1 + 0.01 * Math.sin(now * 1.7 + sd * 40);
          break;
        case M_MOVE:
        case M_MERGE:
        case M_CHARGE:
        case M_RALLY:
          anim = face[k]! < 0 ? L_BACK : L_GALLOP;
          fi = ((run[k]! * GALLOP_FRAMES) | 0) % GALLOP_FRAMES;
          break;
        case M_HIT:
          anim = L_STRIKE;
          break;
        default:
          // Wheel, cheer, salute, the rally's flank: the horse rears.
          anim = L_REAR;
          py -= 0.05 * Math.max(0, Math.sin(now * 5 + sd * 10));
          break;
      }
    } else {
      switch (m) {
        case M_IDLE:
          anim = style[k] === 0 ? A_IDLE_A : style[k] === 1 ? A_IDLE_B : A_IDLE_C;
          sy = 1 + 0.013 * Math.sin(now * 2.2 + sd * 40);
          sh = 0.022 * Math.sin(now * 0.6 + sd * 70);
          break;
        case M_RALLY:
          if (now >= climbT[k]!) {
            // At the foot of the pile, waiting for a way up: weapon and banner high, bobbing.
            anim = A_RAISE;
            fc = face[k]!;
            py -= 0.06 * Math.max(0, Math.sin(now * 9 + sd * 30));
            break;
          }
          anim = A_MARCH;
          fi = ((run[k]! * MARCH_FRAMES) | 0) % MARCH_FRAMES;
          fc = face[k]!;
          break;
        case M_MOVE:
        case M_MERGE:
          anim = A_MARCH;
          fi = ((run[k]! * MARCH_FRAMES) | 0) % MARCH_FRAMES;
          fc = face[k]!;
          break;
        case M_STRIKE: {
          anim = A_STRIKE;
          const arch = sk === SK_ARCHER;
          const def = arch ? archDef[A_STRIKE]! : footDef[A_STRIKE]!;
          const e2 = arch ? el : el * (1 + 0.55 * surge);
          fi = oneShotFrame(def, e2);
          if (!arch) {
            const u = (e2 - 0.12) / 0.3;
            if (u > 0 && u < 1) px += 0.24 * Math.sin(Math.PI * u) * (u < 0.35 ? u / 0.35 : 1);
          }
          break;
        }
        case M_CHEER: {
          anim = A_CHEER;
          const c = (el % CHEER_CYCLE) / CHEER_CYCLE;
          fi = c < 0.2 ? 0 : c < 0.45 ? 1 : c < 0.72 ? 2 : 3;
          if (fi >= CHEER_FRAMES) fi = CHEER_FRAMES - 1;
          const hu = (c - 0.2) / 0.7;
          if (hu > 0 && hu < 1) py -= 0.28 * (0.85 + 0.3 * sd) * Math.sin(Math.PI * hu);
          break;
        }
        case M_RAISE:
          anim = A_RAISE;
          break;
        case M_BRACE:
          anim = A_BRACE;
          break;
        case M_FLEE:
          anim = A_FLEE;
          fi = ((run[k]! * FLEE_FRAMES) | 0) % FLEE_FRAMES;
          break;
        case M_FLUNG:
          anim = A_FLUNG;
          fi = ((el * 9) | 0) & 1;
          rt = rot[k]!;
          break;
        case M_DOWN:
          anim = A_DOWN;
          break;
        case M_GETUP:
          anim = A_GETUP;
          fi = oneShotFrame(footDef[A_GETUP]!, el);
          break;
        case M_CLIMB:
          anim = A_CHEER;
          fi = 2;
          fc = face[k]!;
          break;
        case M_PILE: {
          // The base carries the weight; everyone above has a weapon or a banner in the air.
          const l = pile.layer[pileI[k]!]!;
          anim = l <= 1 && pile.layers > 3 ? A_BRACE : A_RAISE;
          break;
        }
      }
    }
    const f = sheets.frameIndex(sk, anim, fi);
    const fr = sheets.frames[f]!;
    const sc = ROW_SCALE[r]! * UNIT * size[k]! * (1 + ln * 0.12);
    // figure units -> world: scale (with face flip, breathing, sway shear), rotate, place.
    const m11 = sc * fc;
    const m12 = sc * sh;
    const m22 = sc * sy;
    let a1 = m11;
    let b1 = 0;
    let c1 = m12;
    let d1 = m22;
    let e1 = px;
    let f1 = py;
    if (rt !== 0) {
      const cr = Math.cos(rt);
      const sr = Math.sin(rt);
      a1 = cr * m11;
      b1 = sr * m11;
      c1 = cr * m12 - sr * m22;
      d1 = sr * m12 + cr * m22;
      // Spin about the hip: the stored position is the feet, so rotate around a point HIP above them.
      e1 = px + c1 * HIP;
      f1 = py - HIP * sc + d1 * HIP;
    }
    const ta = fA * a1 + fC * b1;
    const tb = fB * a1 + fD * b1;
    const tc = fA * c1 + fC * d1;
    const td = fB * c1 + fD * d1;
    const te = fA * e1 + fC * f1 + fE - fXo;
    const tf = fB * e1 + fD * f1 + fF - fYo;
    const margin = sk === SK_LANCER ? fMargin * 2.2 : fMargin;
    if (te + fXo < -margin || te + fXo > fW + margin) return;
    const img = sheets.canvas(f, fLod);
    const o = fLod * 4;
    const dst = fr.dest;
    g.setTransform(ta, tb, tc, td, te, tf);
    const an = fr.anchor;
    if (sk === SK_LANCER) {
      g.drawImage(img, dst[o]!, dst[o + 1]!, dst[o + 2]!, dst[o + 3]!);
      const lc = lanceCol!;
      drawLance(g, an.poleX, an.poleY, lanceAngle(k, m, el), fPal!.light.x, fPal!.light.y, m === M_CHARGE || (m === M_MOVE && face[k]! > 0) ? -1.5 : m === M_MOVE ? 1.2 : -1, now, sd * 30, Math.max(1.2, 1.1 / (fPxu * (sc / UNIT))), lc, fPxu * (sc / UNIT) > 0.25);
      return;
    }
    if (flagged[k] && heraldry) {
      // Pole behind the hand, the knight, then the flag streaming from the top.
      const dx = Math.cos(an.poleA);
      const dy = Math.sin(an.poleA);
      const arch = sk === SK_ARCHER;
      const up = arch ? 84 : POLE_UP;
      const down = arch ? 0 : POLE_DOWN;
      const topX = an.poleX + dx * up;
      const topY = an.poleY + dy * up;
      g.lineWidth = Math.max(2.4, 1.3 / (fPxu * (sc / UNIT)));
      g.beginPath();
      g.moveTo(an.poleX - dx * down, an.poleY - dy * down);
      g.lineTo(topX, topY);
      g.stroke();
      g.drawImage(img, dst[o]!, dst[o + 1]!, dst[o + 2]!, dst[o + 3]!);
      if (dy < -0.6) {
        const fs = arch ? FLAG_SMALL : 1;
        const onScreen = FLAG_W * fs * fPxu * (sc / UNIT);
        const strips = Math.max(2, Math.min(16, Math.round(onScreen / 7)));
        drawFlag(g, bannerArt, fFlagSize, ta, tb, tc, td, te, tf, topX + 1, topY + 3, fs, now, sd * 40, strips, m === M_DOWN ? 0.5 : 0.1);
        g.setTransform(ta, tb, tc, td, te, tf);
        drawFinial(g, topX, topY, dx, dy, fPal!.accent.gold);
        if (squad > 1) {
          const lab = labels.get(squad, fPal!);
          const lh = 13 * fs;
          const lw = (lh * lab.width) / lab.height;
          g.drawImage(lab, topX - FLAG_W * fs * 0.5 - lw * 0.5, topY + FLAG_H * fs + 7, lw, lh);
        }
      }
    } else {
      g.drawImage(img, dst[o]!, dst[o + 1]!, dst[o + 2]!, dst[o + 3]!);
    }
    const pileGlint = m === M_PILE && pile.layer[pileI[k]!]! >= pile.layers - 3;
    if (((m === M_RAISE && el > 0.2 && el < 0.95) || pileGlint) && glints < MAXK) {
      const a = pileGlint ? Math.pow(Math.max(0, Math.sin(now * 2.6 + sd * 40)), 10) : Math.sin(((el - 0.2) / 0.75) * Math.PI);
      if (a > 0.02) {
        glintX[glints] = ta * an.tipX + tc * an.tipY + te + fXo;
        glintY[glints] = tb * an.tipX + td * an.tipY + tf + fYo;
        glintA[glints] = a;
        glints++;
      }
    }
  };

  /** Knights drawn outside the haze bands: the flung and fleeing, lancers out on a charge. */
  const offBand = (k: number): boolean => mode[k] === M_FLUNG || lane[k]! > 0.01;
  const riding = (k: number): boolean => unit[k] === U_LANCE && busyRider(mode[k]!);

  const champInput = { homeX: 0, frontX: 0, specialIn: -1, surge: 0 };

  const layer: Layer = {
    name: 'crowd',
    visible: true,
    update(v: View) {
      const c0 = performance.now();
      ensureArt(v.palette);
      now = v.time;
      const dt = v.dt;
      const s = v.state;
      // Free dropped sprite canvases a few per frame (a tier switch drops ~400 at once); it comes
      // out of the frame's bake budget.
      const reap0 = performance.now();
      sheets.reap(1.2, 48);
      reapMs = performance.now() - reap0;
      // Fused (the flash, just before the switch): the rest of the frame is idle, so keep preparing.
      if (prepPal && fused) prepareStep(BAKE_BUDGET - reapMs);
      if (fused) {
        // The colossus stands in for the army: nothing to update or draw.
        cpuAcc += performance.now() - c0;
        return;
      }

      // The front line tracks the dragon's front edge (big dragons keep the army in reach).
      const standOff = heroStandOff(s.dragon.size);
      scene.dragon.bounds(tmpR);
      const front = tmpR.x - standOff;
      const dragonFront = tmpR.x;
      hero.setTarget(s.dragon.size, standOff);
      // A resync while the army piles up for the zoom (the tab was hidden): rebuild the pile from
      // state for the rally's remaining time instead of snapping back to the formation.
      let reRally = -1;
      if (snap) {
        if (rallyOn && s.zoom.stage === 'begin') reRally = Math.max(0.25, rallyT0 + rallyDur - now);
        snapAll();
      }
      // Charge! follows the state (it survives a reload); the war cry itself is event-driven.
      surgeOn = s.abilities.charge.active > 0 && s.zoom.stage === null && !rallyOn;
      heroX = snap ? front : heroX + (front - heroX) * (1 - Math.exp(-2.5 * dt));
      surge += ((surgeOn ? 1 : 0) - surge) * (1 - Math.exp(-(surgeOn ? 5 : 1.6) * dt));
      if (surge < 0.001) surge = 0;
      if (rallyOn) {
        // The hero glides to the pile and rides its top up, sword high.
        const u = Math.min(1, (now - rallyT0) / (rallyDur * 0.7));
        const e = u * u * (3 - 2 * u);
        hero.x = heroFromX + (rallyX - heroFromX) * e;
        const want = -pileTop * pileGrow() - (pileTop > 0 ? 1.0 : 0) + 0.12;
        const cur = hero.y;
        hero.y = cur + (Math.min(heroFromY, want) - cur) * (1 - Math.exp(-7 * dt));
      } else {
        hero.x = heroX + SURGE_HERO * surge;
        hero.y = 0.12;
      }

      // Reconcile against the state (not while the army is piled up for the zoom).
      if (!rallyOn) {
        const nf = s.units.footman;
        const na = s.units.archer;
        const nl = s.units.lancer;
        const k = squadSize(nf, na, SPRITE_CAP, nl);
        const tf = Math.min(SPRITE_CAP, shownCount(nf, k));
        const ta = Math.min(SPRITE_CAP, shownCount(na, k));
        const tl = Math.min(SPRITE_CAP >> 1, shownCount(nl, k));
        if (k !== squad) {
          squad = k;
          if (!snap) {
            regroup(U_FOOT, shownF, tf);
            regroup(U_ARCH, shownA, ta);
            regroup(U_LANCE, shownL, tl);
            shownF = Math.min(shownF, tf);
            shownA = Math.min(shownA, ta);
            shownL = Math.min(shownL, tl);
          }
        }
        let arrivals = 0;
        for (let i = shownF; i < tf; i++) activate(U_FOOT, i, !snap, arrivals++);
        for (let i = shownF - 1; i >= tf; i--) deactivate(U_FOOT, i);
        for (let i = shownA; i < ta; i++) activate(U_ARCH, i, !snap, arrivals++);
        for (let i = shownA - 1; i >= ta; i--) deactivate(U_ARCH, i);
        for (let i = shownL; i < tl; i++) activate(U_LANCE, i, !snap, arrivals++);
        for (let i = shownL - 1; i >= tl; i--) deactivate(U_LANCE, i);
        shownF = tf;
        shownA = ta;
        shownL = tl;
      }

      // Champions: join (march in, or appear on a snap), take their spots beside the hero.
      scene.camera.visibleRect(vis, 0);
      let n = 0;
      for (let i = 0; i < champs.length; i++) {
        const c = champs[i]!;
        const joined = (s.champions[c.id as ChampionId]?.level ?? 0) > 0;
        if (joined && !c.on) c.join(snap, Math.min(heroX - 6, vis.x - 1.2), heroX - CHAMP_GAP[Math.min(n, CHAMP_GAP.length - 1)]!);
        else if (!joined && c.on) c.hide();
        else if (snap && c.on) c.place(heroX - CHAMP_GAP[Math.min(n, CHAMP_GAP.length - 1)]!);
        if (c.on) n++;
      }
      champN = n;
      const want = champRoom(champN);
      room = snap ? want : room + (want - room) * (1 - Math.exp(-3 * dt));
      snap = false;
      if (reRally > 0) rally(rallyX, reRally);
      if (orderDirty) resortOrder();

      if (!rallyOn) sweepTail();
      for (let i = 0; i < orderN; i++) updateKnight(order[i]!, dt);
      hero.update(dt, now, v.realDt);
      let ci = 0;
      const hold = s.zoom.stage !== null || rallyOn;
      for (let i = 0; i < champs.length; i++) {
        const c = champs[i]!;
        if (!c.on) continue;
        const gap = CHAMP_GAP[Math.min(ci, CHAMP_GAP.length - 1)]!;
        champInput.homeX = heroX + SURGE_HERO * surge - gap * (1 - 0.4 * surge);
        champInput.frontX = dragonFront;
        const st = s.champions[c.id as ChampionId];
        const ph = s.dragon.phase;
        // Seconds until core lands the special: its timer, or (arriving dragon) the end of `enter`,
        // whichever is later (core holds a due special until the dragon has entered). -1: not now.
        const lag = v.alpha * TICK_DT;
        let sIn = -1;
        if (!hold && st && st.level > 0 && ph !== 'dying' && ph !== 'leave') {
          sIn = Math.max(0, st.specialT - lag);
          if (ph === 'enter') sIn = Math.max(sIn, s.dragon.phaseDur - s.dragon.phaseT - lag);
        }
        champInput.specialIn = sIn;
        champInput.surge = surge;
        if (rallyOn) c.rallyTarget(rallyX + (ci === 0 ? -0.62 : 0.66) * pileSqueeze(), 0.12 - Math.max(0, pileTop - 0.9) * pileGrow());
        c.update(dt, now, v.realDt, champInput);
        ci++;
      }
      arrows.update(now);

      // Sprite memory follows the camera: bake the LOD on screen a little each frame (and the next
      // smaller one while the camera pulls back), release any LOD unused for 3 s.
      const pxu = v.camera.zoomEff * v.dpr * UNIT;
      lastLod = lodSticky(pxu, lastLod);
      const z = v.camera.zoom;
      if (z < prevZoom * 0.9995) pullT = v.realTime;
      prevZoom = z;
      const pulling = v.realTime - pullT < 0.6;
      sheets.touch(lastLod, v.realTime);
      if (pulling && lastLod + 1 < LOD_COUNT) sheets.touch(lastLod + 1, v.realTime);
      const mask = 1 | (shownF > 0 ? 2 : 0) | (shownA > 0 ? 4 : 0) | (shownL > 0 ? 8 : 0);
      // The lookahead skips the lancers (their frames are big and they ride mostly off screen when
      // the camera is close): they bake on first use at the next LOD, which keeps the pull-back's
      // transient sprite memory near the knights' own.
      // All baking in update shares one budget per frame: the LOD on screen first, then (rally)
      // the next two LODs the zoom's pull-back will need, then the next tier's art (prepareTier).
      const bake0 = performance.now() - reapMs;
      sheets.prewarm(lastLod, mask, 1.5, pulling, mask & 7);
      if (rallyOn) {
        // No first-use bakes in the draw while the camera flies out over the pile.
        for (let l = lastLod + 1; l <= Math.min(LOD_COUNT - 1, lastLod + 2); l++) {
          sheets.touch(l, v.realTime);
          const left = BAKE_BUDGET - (performance.now() - bake0);
          if (left > 0.3) sheets.prewarm(l, mask, left, false);
        }
      }
      if (prepPal) prepareStep(BAKE_BUDGET - (performance.now() - bake0));
      sheets.evict(v.realTime, 3, lastLod);
      cpuAcc += performance.now() - c0;
    },

    draw(ctx: CanvasRenderingContext2D, v: View) {
      const c0 = performance.now();
      if (fused) {
        cpuAcc += performance.now() - c0;
        return;
      }
      const p = v.palette;
      const cam = v.camera;
      const dpr = v.dpr;
      fA = cam.a * dpr;
      fB = cam.b * dpr;
      fC = cam.c * dpr;
      fD = cam.d * dpr;
      fE = cam.e * dpr;
      fF = cam.f * dpr;
      fW = Math.ceil(v.width * dpr);
      fPxu = cam.zoomEff * dpr * UNIT;
      fLod = lastLod;
      fMargin = 2.2 * cam.zoomEff * dpr;
      fFlagSize = fPxu > 1.3 ? 0 : 1;
      fPal = p;
      glints = 0;
      const H = Math.ceil(v.height * dpr);

      fXo = 0;
      fYo = 0;
      // Lancers out on a charge ride in their back rows (hazed, so they separate from the infantry
      // in front) all the way to the dragon: the band then spans the screen.
      let out = false;
      for (let oi = 0; oi < orderN && !out; oi++) out = riding(order[oi]!);

      // Haze bands: back rows are painted into a strip buffer, pulled toward the haze color, then
      // composited, so overlapping silhouettes separate by depth like a painted host.
      view.bounds(tmpR);
      // From the screen's left edge: recruits march in from there, in every row.
      const xl = 0;
      const xr = out ? fW : Math.min(fW, fA * (heroX + 1.5) + fE);
      const bandTop = shownL > 0 ? BAND_TOP_LANCE : BAND_TOP;
      const yt = fB * tmpR.x + fD * bandTop + fF;
      const yb = fB * tmpR.x + fD * BAND_BOT + fF;
      bandX = Math.max(0, Math.floor(Math.min(xl, xr)) - 4);
      bandY = Math.max(0, Math.floor(Math.min(yt, fB * (heroX + 1.5) + fD * bandTop + fF)) - 40);
      bandW = Math.min(fW, Math.ceil(Math.max(xl, xr)) + 4) - bandX;
      bandH = Math.min(H, Math.ceil(Math.max(yb, fB * (heroX + 1.5) + fD * BAND_BOT + fF)) + 40) - bandY;
      const canBand = !rallyOn && bandW > 0 && bandH > 0 && Math.abs(cam.rotEff) < 0.2;

      let band = -1;
      let g = ctx;
      for (let oi = 0; oi < orderN; oi++) {
        const k = order[oi]!;
        if (offBand(k)) continue;
        const r = row[k]!;
        // Riders out on a charge take the lighter mid haze: behind the infantry, but not lost in the far band.
        const b = !canBand ? 2 : r >= 3 && !riding(k) ? 0 : r >= 2 ? 1 : 2;
        if (b !== band) {
          if (band === 0 || band === 1) flushBand(ctx, band);
          band = b;
          if (b < 2) g = beginBand();
          else {
            g = ctx;
            fYo = 0;
            fXo = 0;
          }
          g.strokeStyle = p.silhouette;
          g.lineCap = 'round';
        }
        drawKnight(g, k);
      }
      if (band === 0 || band === 1) flushBand(ctx, band);
      fYo = 0;
      fXo = 0;

      // Champions behind the hero, the hero, then any champion out in front of him (a lunge).
      const hx = hero.rootX() + 0.15;
      for (let i = 0; i < champs.length; i++) {
        const c = champs[i]!;
        if (c.on && c.rootX() <= hx) c.draw(ctx, v);
      }
      hero.draw(ctx, v, heraldry ?? defaultHeraldry(p));
      for (let i = 0; i < champs.length; i++) {
        const c = champs[i]!;
        if (c.on && c.rootX() > hx) c.draw(ctx, v);
      }
      ctx.strokeStyle = p.silhouette;
      ctx.lineCap = 'round';
      for (let oi = 0; oi < orderN; oi++) {
        const k = order[oi]!;
        if (offBand(k)) drawKnight(ctx, k);
      }
      ctx.globalAlpha = 1;

      // Milestone glints: a star on every raised blade (and winking over the rally pile).
      if (glints > 0 && glintSprite >= 0) {
        const gl = scene.atlas.canvases[glintSprite]!;
        const sz = Math.max(9 * dpr, 0.34 * cam.zoomEff * dpr);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < glints; i++) {
          const s = sz * (0.6 + 0.6 * glintA[i]!);
          const cr = Math.cos(now * 2 + i);
          const sr = Math.sin(now * 2 + i);
          const k = s / gl.width;
          ctx.globalAlpha = glintA[i]!;
          ctx.setTransform(cr * k, sr * k, -sr * k, cr * k, glintX[i]!, glintY[i]!);
          ctx.drawImage(gl, -gl.width / 2, -gl.height / 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      scene.dragon.headPoint(tmpH);
      arrows.draw(ctx, v, now, tmpH.x, tmpH.y);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cpuAcc += performance.now() - c0;
      if (++cpuN >= 30) {
        cpuAvg = cpuAcc / cpuN;
        cpuAcc = 0;
        cpuN = 0;
      }
    },
  };

  const dbg = scene.debug;
  dbg.section('Crowd');
  dbg.button('cheer wave', onCheer);
  dbg.button('fling front', () => onSwipe(0.9));
  dbg.button('scatter (fire)', onBreath);
  dbg.button('regroup', release);
  dbg.button('raise: footmen', () => onRaise(U_FOOT));
  dbg.button('raise: archers', () => onRaise(U_ARCH));
  dbg.section('Crowd (M2)');
  dbg.button('lancer charge', () => onCavalry(16, 1.2));
  dbg.button('dragonbane volley', () => dragonbane(60, 1.1));
  dbg.toggle('charge! surge', () => surgeOn, (on) => (surgeOn = on));
  dbg.button('rally flurry (3 s)', () => {
    for (let i = 0; i < 24; i++) setTimeout(() => hero.flurry(now), i * 125);
  });
  dbg.button('aldric: lunge', () => champ('aldric')?.special(now, null));
  dbg.button('brunhild: cleave', () => champ('brunhild')?.special(now, null));
  dbg.button('zoom: rally pile', () => rally(heroX, 1));
  dbg.button('zoom: fuse', () => setFused(true));
  dbg.button('zoom: unfuse', () => setFused(false));
  if (dbg.enabled) (window as unknown as { __crowd?: unknown }).__crowd = { hero, sheets, arrows, bannerArt, champs, flung: () => flungN,
    /** Gap (m) from the hero to the nearest knight, and that knight's mode (debug). */
    gap: () => {
      let best = 1e9;
      let bm = -1;
      for (let k = 0; k < MAXK; k++) if (used[k] && !merge[k] && heroX - kx[k]! < best) { best = heroX - kx[k]!; bm = mode[k]!; }
      return { gap: best, mode: bm, heroX };
    },
    pile: () => ({ n: pile.n, layers: pile.layers, top: pileTop, rallyOn, fused }),
    /** Crowd CPU per frame (ms, update + draw, averaged over 30 frames) and sprite count (debug). */
    cpu: () => ({ ms: cpuAvg, sprites: orderN, squad, lod: lastLod, mb: sheets.memory() / 1048576 }),
    prep: () => ({ pending: prepPal !== null, stage: prepStage, maxMs: prepMaxMs, nextMB: sheets.nextBytes / 1048576, switchMB: switchBytes / 1048576 }),
  };
  scene.debug.watch('crowd', () => `${orderN} spr ×${squad} lod ${lastLod} ${cpuAvg.toFixed(2)} ms ${(sheets.bytes / 1048576).toFixed(1)} MB`);

  return { layer, view };
}
