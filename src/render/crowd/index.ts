// The knight crowd (layer slot 2): the hero, the swelling army, banners and arrows.
//
// State is the truth: every frame the visible army is reconciled against state.units (new knights
// march in from the left edge to a stable slot; 'resync' snaps with no effects). Events only start
// one-shot reactions: sword swings, volleys, scattering from fire, flying from a tail swipe, cheers.
//
// Every knight is a small state machine in struct-of-arrays form (no per-frame allocations). Knights
// are drawn from baked, rim-lit sprite frames (sheets.ts) at the level of detail the camera needs,
// back rows first; the draw order is re-sorted only when the formation changes.
import type { Scene } from '../../app/scene';
import type { Layer, View } from '../types';
import type { CrowdView, Heraldry } from './api';
import type { DragonView } from '../dragon/api';
import type { Rect, Vec2 } from '../../lib/vec';
import { rect, vec2 } from '../../lib/vec';
import { mixHex } from '../../lib/color';
import { context2d, makeCanvas } from '../atlas';
import { CURVE_FADE, particleSpec, type ParticleSpec } from '../particles';
import { KNIGHT_HEIGHT } from '../world';
import type { Palette } from '../palette';
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
  LOOSE_T,
  MARCH_FRAMES,
  animDuration,
  oneShotFrame,
} from './anims';
import { KnightSheets, LOD_COUNT, lodFor } from './sheets';
import { Hero } from './hero';
import { Arrows } from './arrows';
import { BannerArt, CountLabels, FLAG_H, FLAG_SMALL, FLAG_W, POLE_DOWN, POLE_UP, defaultHeraldry, drawFinial, drawFlag } from './banner';
import { HERO_GAP, heroStandOff, ROW_SCALE, ROW_Y, SPRITE_CAP, archerSlot, footSlot, isBearer, shownCount, squadSize, type Slot } from './formation';

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
const M_NONE = 255;

const SK_FOOT = 0;
const SK_BEARER = 1;
const SK_ARCHER = 2;

const RUN = 3.4;
const CHEER_CYCLE = 0.56;
const CHEER_HOPS = 2;
const RAISE_DUR = 1.35;
/** Hip height in figure units (flung knights spin about it). */
const HIP = 46;
/** Foreground lane depth (m) for knights knocked out of the ranks. */
const LANE = 0.42;
/** World y range (m) the haze-band buffer covers: banner tops to below the front row's feet. */
const BAND_TOP = -3.6;
const BAND_BOT = 0.6;
/** Haze strength for the far band (archers, rows 3-4) and the mid band (row 2). */
const BAND_HAZE = [0.26, 0.12] as const;

export function createCrowd(scene: Scene): CrowdRender {
  const sheets = new KnightSheets();
  const hero = new Hero();
  const arrows = new Arrows();
  const bannerArt = new BannerArt();
  const labels = new CountLabels();
  const footDef = sheets.sets[SK_FOOT]!.defs;
  const archDef = sheets.sets[SK_ARCHER]!.defs;
  const STRIKE_DUR_FOOT = animDuration(footDef[A_STRIKE]!);
  const STRIKE_DUR_ARCH = animDuration(archDef[A_STRIKE]!);
  const GETUP_DUR = animDuration(footDef[A_GETUP]!);

  // ---- knight records (struct of arrays) ----
  const used = new Uint8Array(MAXK);
  const archer = new Uint8Array(MAXK);
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
  const order = new Uint16Array(MAXK);
  let orderN = 0;
  let orderDirty = true;
  const glintX = new Float32Array(MAXK);
  const glintY = new Float32Array(MAXK);
  const glintA = new Float32Array(MAXK);

  let shownF = 0;
  let shownA = 0;
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
  const slot: Slot = { x: 0, row: 0, col: 0 };
  const tmp: Vec2 = vec2();
  const tmpR: Rect = rect();
  const tmpH: Vec2 = vec2();
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

  const slotX = (k: number): number => heroX + rel[k]!;

  const activate = (isArcher: boolean, i: number, marchIn: boolean, nth: number): void => {
    const k = alloc();
    if (k < 0) return;
    used[k] = 1;
    archer[k] = isArcher ? 1 : 0;
    const bearer = isBearer(isArcher, i);
    flagged[k] = bearer ? 1 : 0;
    sheet[k] = isArcher ? SK_ARCHER : bearer ? SK_BEARER : SK_FOOT;
    slotIdx[k] = i;
    if (isArcher) archerSlot(i, slot);
    else footSlot(i, slot);
    row[k] = slot.row;
    rel[k] = slot.x;
    let h = Math.imul(i + (isArcher ? 7919 : 0), 0x9e3779b1) >>> 0;
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
    const sx = slotX(k);
    if (marchIn) {
      scene.camera.visibleRect(vis, 0);
      const x0 = Math.min(sx - 2, vis.x - 1 - nth * 0.55);
      kx[k] = x0;
      mode[k] = M_MOVE;
      recruit[k] = 1;
      aux[k] = Math.max(RUN, (sx - x0) / 2.6);
    } else {
      kx[k] = sx;
      mode[k] = M_IDLE;
      recruit[k] = 0;
    }
    if (isArcher) archRec[i] = k;
    else footRec[i] = k;
    orderDirty = true;
  };

  const deactivate = (isArcher: boolean, i: number): void => {
    const map = isArcher ? archRec : footRec;
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
  const regroup = (isArcher: boolean, from: number, to: number): void => {
    if (to >= from) return;
    const map = isArcher ? archRec : footRec;
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
      if (grounded(mode[k]!)) startMerge(k);
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
    // Back rows first; within a row right to left, so every knight's sunlit (right) edge stays
    // visible over its neighbour. Insertion sort on a small key, allocation-free.
    orderN = 0;
    for (let k = 0; k < MAXK; k++) if (used[k]) order[orderN++] = k;
    for (let i = 1; i < orderN; i++) {
      const k = order[i]!;
      const key = row[k]! * 10000 + rel[k]!;
      let j = i - 1;
      while (j >= 0) {
        const o = order[j]!;
        if (row[o]! * 10000 + rel[o]! >= key) break;
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

  const dragonSize = (): number => Math.max(0.3, scene.game.state.dragon.size);

  /** Enter a mode now (validated against the current one). */
  const enter = (k: number, m: number): void => {
    const cur = mode[k]!;
    switch (m) {
      case M_STRIKE:
        if (cur !== M_IDLE) return;
        break;
      case M_CHEER:
      case M_RAISE:
        if (!grounded(cur) || cur === M_FLEE) return;
        break;
      case M_BRACE:
        if (cur !== M_IDLE && cur !== M_STRIKE && cur !== M_MOVE) return;
        face[k] = 1;
        break;
      case M_FLEE: {
        if (!grounded(cur)) return;
        aux[k] = fleeTo[k]!;
        laneMax[k] = LANE * (0.5 + 0.6 * rand());
        break;
      }
      case M_FLUNG: {
        if (!grounded(cur)) return;
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
        aux[k] = Math.max(RUN * 1.15, Math.abs(slotX(k) - kx[k]!) / 1.3);
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

  // ---- event reactions ----
  const game = scene.game;
  game.on('resync', () => (snap = true));

  game.on('strike', () => {
    hero.strike(now);
    // A scuff of dust from the lunging front foot.
    if (lastLod <= 1) puff(heroX + 0.45, 0.12, 2, 0.55);
  });

  game.on('armyHit', (e) => {
    if (e.unit !== 'footman' || shownF === 0) return;
    // A few front-line footmen swing each beat, spread across the beat so something always moves.
    const frontCols = 2 + Math.ceil(Math.sqrt(shownF) * 0.6);
    const want = Math.min(Math.max(1, Math.round(e.hits * 0.6)), 3 + (shownF >> 3), 16);
    let picked = 0;
    const n = Math.min(shownF, frontCols * 3);
    const start = (rand() * n) | 0;
    for (let s = 0; s < n && picked < want; s++) {
      const i = (start + s) % n;
      const k = footRec[i]!;
      if (k < 0 || mode[k] !== M_IDLE || pend[k] !== M_NONE) continue;
      if (n > want * 1.5 && rand() < 0.35) continue;
      schedule(k, M_STRIKE, now + rand() * 0.8);
      picked++;
    }
  });

  game.on('volley', (e) => {
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

  /** Windup: the knights nearest the dragon crouch behind their shields late in the windup. */
  const onWindup = (dur: number): void => {
    const reach = 1.6 + 0.3 * dragonSize();
    const front = heroX + 0.2;
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || archer[k]) continue;
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
   */
  const onBreath = (): void => {
    breathOn = true;
    hero.brace(true);
    const dv = live();
    scene.dragon.headPoint(tmp);
    const reachX = dv.breathReachX ? dv.breathReachX() : tmp.x - Math.max(2.1, 1.5 * dragonSize());
    for (let k = 0; k < MAXK; k++) {
      if (!used[k]) continue;
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
      if (!used[k] || merge[k]) continue;
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
    const size = dragonSize();
    // Only when the tip is down among the knights, not whipping overhead.
    if (tmp.y < -(KNIGHT_HEIGHT * 1.1 + 0.12 * size)) return;
    // Generous "near": the whoosh bowls over the rank next to the tip too (a newt's tail only
    // reaches the hero's shins, but the first footmen should still go tumbling).
    const r = 1.1 + 0.1 * size;
    const cap = flingCap();
    for (let k = 0; k < MAXK && flungN < cap; k++) {
      if (!used[k] || swept[k] || merge[k] || !grounded(mode[k]!)) continue;
      if (Math.abs(kx[k]! - tmp.x) > r) continue;
      swept[k] = 1;
      enter(k, M_FLUNG);
      flungN++;
    }
  };

  /** A kill: a cheer rolls back through the ranks from the hero. */
  const onCheer = (): void => {
    hero.brace(false);
    hero.cheer(now + 0.35);
    for (let k = 0; k < MAXK; k++) {
      if (!used[k]) continue;
      const delay = 0.45 + Math.min(1.8, Math.max(0, (heroX - kx[k]!) * 0.035)) + rand() * 0.15;
      schedule(k, M_CHEER, now + delay);
    }
  };

  /** A unit milestone: that unit raises its weapons, each blade catching the light. */
  const onRaise = (isArcher: boolean): void => {
    const isA = isArcher ? 1 : 0;
    for (let k = 0; k < MAXK; k++) {
      if (!used[k] || archer[k] !== isA) continue;
      schedule(k, M_RAISE, now + 0.1 + Math.min(1.2, slotIdx[k]! * 0.012) + rand() * 0.08);
    }
  };

  game.on('dragonPhase', (e) => {
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
    onCheer();
  });
  game.on('milestone', (e) => onRaise(e.unit === 'archer'));

  // ---- view (director + other modules) ----
  const view: CrowdView = {
    heroPoint(out) {
      hero.chest(out);
      return out;
    },
    frontX() {
      return heroX + hero.restTipX;
    },
    bounds(out: Rect) {
      // Stable: hero + every occupied slot (never the march-ins, flyers or fleeing).
      let left = heroX - 0.7;
      for (let i = shownF - 3; i < shownF; i++) {
        if (i < 0) continue;
        footSlot(i, slot);
        if (heroX + slot.x - 0.5 < left) left = heroX + slot.x - 0.5;
      }
      for (let i = shownA - 2; i < shownA; i++) {
        if (i < 0) continue;
        archerSlot(i, slot);
        if (heroX + slot.x - 0.5 < left) left = heroX + slot.x - 0.5;
      }
      out.x = left;
      // Tall enough for the banners (pole tops ~3.2 m) once anyone carries one.
      out.y = shownF + shownA > 0 ? -3.3 : -KNIGHT_HEIGHT * 1.3;
      out.w = heroX + hero.restTipX + 0.1 - left;
      out.h = -out.y + 0.3;
      return out;
    },
    setHeraldry(h: Heraldry) {
      heraldry = { ...h };
      customHeraldry = true;
    },
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
    if (merge[k] && m !== M_MERGE && grounded(m) && m !== M_FLEE) {
      startMerge(k);
      m = M_MERGE;
    }
    const el = now - t0[k]!;
    switch (m) {
      case M_MERGE: {
        const t = mergeTo[k]!;
        const tx = t >= 0 && used[t] && !merge[t] ? kx[t]! : heroX - 1;
        const d = tx - kx[k]!;
        const sp = aux[k]! * dt;
        if (Math.abs(d) <= Math.max(sp, 0.05)) {
          puff(kx[k]!, ROW_Y[row[k]!]!, 4, 0.9);
          used[k] = 0;
          merge[k] = 0;
          orderDirty = true;
        } else {
          kx[k] = kx[k]! + (d > 0 ? sp : -sp);
          face[k] = d > 0 ? 1 : -1;
          run[k] = run[k]! + (dt * Math.min(aux[k]!, 5)) / 1.3;
        }
        break;
      }
      case M_IDLE: {
        if (lane[k]! > 0) lane[k] = Math.max(0, lane[k]! - dt * 0.8);
        const d = sx - kx[k]!;
        if (Math.abs(d) > 0.45) enter(k, M_MOVE);
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
            // "Reporting for duty!": one hop with the weapon up.
            recruit[k] = 0;
            mode[k] = M_CHEER;
            t0[k] = now - CHEER_CYCLE * (CHEER_HOPS - 1);
          }
        } else {
          kx[k] = kx[k]! + (d > 0 ? sp : -sp);
          face[k] = d > 0 ? 1 : -1;
          const before = run[k]!;
          run[k] = before + (dt * Math.min(aux[k]!, 5)) / 1.3;
          // A puff of dust at footfalls (only up close, where it reads).
          if (((run[k]! * 2) | 0) !== ((before * 2) | 0) && lastLod <= 1 && rand() < 0.6) puff(kx[k]!, ROW_Y[row[k]!]! + lane[k]!, 1, 0.45);
        }
        break;
      }
      case M_STRIKE:
        kx[k] = kx[k]! + (sx - kx[k]!) * Math.min(1, dt * 5);
        if (el > (archer[k] ? STRIKE_DUR_ARCH : STRIKE_DUR_FOOT)) mode[k] = M_IDLE;
        break;
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
    }
  };

  const ensureArt = (p: Palette): void => {
    sheets.setPalette(p);
    if (!heraldry || (!customHeraldry && pal !== p)) heraldry = defaultHeraldry(p);
    pal = p;
    bannerArt.update(heraldry, p);
    if (p !== dustPal) {
      dustPal = p;
      const id = scene.atlas.tint(scene.sprites.dust, mixHex(p.haze, p.rim, 0.25));
      dustSpec = particleSpec({ sprite: id, life: 0.85, lifeVar: 0.35, speed: 1.1, speedVar: 0.6, angle: -Math.PI / 2, spread: 1.3, radius: 0.12, gravity: -0.5, drag: 2.6, size: 0.5, sizeEnd: 1.25, sizeVar: 0.35, alpha: 0.42, curve: CURVE_FADE });
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
    switch (m) {
      case M_IDLE:
        anim = style[k] === 0 ? A_IDLE_A : style[k] === 1 ? A_IDLE_B : A_IDLE_C;
        sy = 1 + 0.013 * Math.sin(now * 2.2 + sd * 40);
        sh = 0.022 * Math.sin(now * 0.6 + sd * 70);
        break;
      case M_MOVE:
      case M_MERGE:
        anim = A_MARCH;
        fi = ((run[k]! * MARCH_FRAMES) | 0) % MARCH_FRAMES;
        fc = face[k]!;
        break;
      case M_STRIKE: {
        anim = A_STRIKE;
        const def = sk === SK_ARCHER ? archDef[A_STRIKE]! : footDef[A_STRIKE]!;
        fi = oneShotFrame(def, el);
        if (sk !== SK_ARCHER) {
          const u = (el - 0.12) / 0.3;
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
    if (te + fXo < -fMargin || te + fXo > fW + fMargin) return;
    const img = sheets.canvas(f, fLod);
    const o = fLod * 4;
    const dst = fr.dest;
    g.setTransform(ta, tb, tc, td, te, tf);
    const an = fr.anchor;
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
    if (m === M_RAISE && el > 0.2 && el < 0.95 && glints < MAXK) {
      glintX[glints] = ta * an.tipX + tc * an.tipY + te + fXo;
      glintY[glints] = tb * an.tipX + td * an.tipY + tf + fYo;
      glintA[glints] = Math.sin(((el - 0.2) / 0.75) * Math.PI);
      glints++;
    }
  };

  const layer: Layer = {
    name: 'crowd',
    visible: true,
    update(v: View) {
      const c0 = performance.now();
      ensureArt(v.palette);
      now = v.time;
      const dt = v.dt;
      const s = v.state;

      // The front line tracks the dragon's front edge (big dragons keep the army in reach).
      const standOff = heroStandOff(s.dragon.size);
      const front = scene.dragon.bounds(tmpR).x - standOff;
      hero.setTarget(s.dragon.size, standOff);
      heroX = snap ? front : heroX + (front - heroX) * (1 - Math.exp(-2.5 * dt));
      hero.x = heroX;
      hero.y = 0.12;

      // Reconcile against the state.
      const nf = s.units.footman;
      const na = s.units.archer;
      const k = squadSize(nf, na);
      const tf = Math.min(SPRITE_CAP, shownCount(nf, k));
      const ta = Math.min(SPRITE_CAP, shownCount(na, k));
      if (k !== squad) {
        squad = k;
        if (!snap) {
          regroup(false, shownF, tf);
          regroup(true, shownA, ta);
          shownF = Math.min(shownF, tf);
          shownA = Math.min(shownA, ta);
        }
      }
      if (snap) {
        for (let k2 = 0; k2 < MAXK; k2++) used[k2] = 0;
        footRec.fill(-1);
        archRec.fill(-1);
        orderDirty = true;
        shownF = shownA = 0;
        arrows.clear();
        hero.snap();
      }
      let arrivals = 0;
      for (let i = shownF; i < tf; i++) activate(false, i, !snap, arrivals++);
      for (let i = shownF - 1; i >= tf; i--) deactivate(false, i);
      for (let i = shownA; i < ta; i++) activate(true, i, !snap, arrivals++);
      for (let i = shownA - 1; i >= ta; i--) deactivate(true, i);
      shownF = tf;
      shownA = ta;
      snap = false;
      if (orderDirty) resortOrder();

      sweepTail();
      for (let i = 0; i < orderN; i++) updateKnight(order[i]!, dt);
      hero.update(dt, now, v.realDt);
      arrows.update(now);

      // Sprite memory follows the camera: bake the LOD on screen a little each frame (and the next
      // smaller one while the camera pulls back), release any LOD unused for 3 s.
      const pxu = v.camera.zoomEff * v.dpr * UNIT;
      lastLod = lodFor(pxu);
      const z = v.camera.zoom;
      if (z < prevZoom * 0.9995) pullT = v.realTime;
      prevZoom = z;
      const pulling = v.realTime - pullT < 0.6;
      sheets.touch(lastLod, v.realTime);
      if (pulling && lastLod + 1 < LOD_COUNT) sheets.touch(lastLod + 1, v.realTime);
      const mask = 1 | (shownF > 0 ? 2 : 0) | (shownA > 0 ? 4 : 0);
      sheets.prewarm(lastLod, mask, 1.5, pulling);
      sheets.evict(v.realTime, 3);
      cpuAcc += performance.now() - c0;
    },

    draw(ctx: CanvasRenderingContext2D, v: View) {
      const c0 = performance.now();
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
      fLod = lodFor(fPxu);
      fMargin = 2.2 * cam.zoomEff * dpr;
      fFlagSize = fPxu > 1.3 ? 0 : 1;
      fPal = p;
      glints = 0;
      const H = Math.ceil(v.height * dpr);

      // Haze bands: back rows are painted into a strip buffer, pulled toward the haze color, then
      // composited, so overlapping silhouettes separate by depth like a painted host.
      view.bounds(tmpR);
      // From the screen's left edge: recruits march in from there, in every row.
      const xl = 0;
      const xr = Math.min(fW, fA * (heroX + 1.5) + fE);
      const yt = fB * tmpR.x + fD * BAND_TOP + fF;
      const yb = fB * tmpR.x + fD * BAND_BOT + fF;
      bandX = Math.max(0, Math.floor(Math.min(xl, xr)) - 4);
      bandY = Math.max(0, Math.floor(Math.min(yt, fB * (heroX + 1.5) + fD * BAND_TOP + fF)) - 40);
      bandW = Math.min(fW, Math.ceil(Math.max(xl, xr)) + 4) - bandX;
      bandH = Math.min(H, Math.ceil(Math.max(yb, fB * (heroX + 1.5) + fD * BAND_BOT + fF)) + 40) - bandY;
      const canBand = bandW > 0 && bandH > 0 && Math.abs(cam.rotEff) < 0.2;

      let band = -1;
      let g = ctx;
      for (let oi = 0; oi < orderN; oi++) {
        const k = order[oi]!;
        if (mode[k] === M_FLUNG || lane[k]! > 0.01) continue;
        const r = row[k]!;
        const b = !canBand ? 2 : r >= 3 ? 0 : r === 2 ? 1 : 2;
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

      hero.draw(ctx, v, heraldry ?? defaultHeraldry(p));
      ctx.strokeStyle = p.silhouette;
      ctx.lineCap = 'round';
      for (let oi = 0; oi < orderN; oi++) {
        const k = order[oi]!;
        if (mode[k] === M_FLUNG || lane[k]! > 0.01) drawKnight(ctx, k);
      }
      ctx.globalAlpha = 1;

      // Milestone glints: a star on every raised blade.
      if (glints > 0 && glintSprite >= 0) {
        const gl = scene.atlas.canvases[glintSprite]!;
        const size = Math.max(9 * dpr, 0.34 * cam.zoomEff * dpr);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < glints; i++) {
          const s = size * (0.6 + 0.6 * glintA[i]!);
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
  dbg.button('raise: footmen', () => onRaise(false));
  dbg.button('raise: archers', () => onRaise(true));
  if (dbg.enabled) (window as unknown as { __crowd?: unknown }).__crowd = { hero, sheets, arrows, bannerArt, flung: () => flungN,
    /** Gap (m) from the hero to the nearest knight, and that knight's mode (debug). */
    gap: () => {
      let best = 1e9;
      let bm = -1;
      for (let k = 0; k < MAXK; k++) if (used[k] && !merge[k] && heroX - kx[k]! < best) { best = heroX - kx[k]!; bm = mode[k]!; }
      return { gap: best, mode: bm, heroX };
    },
  };
  scene.debug.watch('crowd', () => `${orderN} spr ×${squad} lod ${lastLod} ${cpuAvg.toFixed(2)} ms ${(sheets.memory() / 1048576).toFixed(1)} MB`);

  return { layer, view };
}
