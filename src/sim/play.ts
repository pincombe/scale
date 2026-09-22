// One headless game: a bot plays the real core in wall time at 60 fps, through the same frame
// structure as app/loop.ts (input → time.update → fixed 20 Hz ticks → drain events → juice).
// Records the pacing milestones the targets check, all in WALL seconds (what the judge feels).
import { nextFloat, seedRng } from '../lib/rng';
import { TICK_DT, applyAction, createInitialState, fmt, sel, sizeWord, tick } from '../core';
import type { Action, GameEvent, GameState } from '../core';
import { shop } from './bots';
import type { Profile } from './bots';
import { JuiceClock } from './juice';

export const FRAME_DT = 1 / 60;
/** Checkpoints (wall s): dragon size sampled at the minutes, kills at 3:15 (the M2 boss). */
export const SIZE_AT = [60, 120, 180] as const;
export const BOSS_AT = 195;

export interface RunOptions {
  /** Model hit-stop / slow-mo dilation (default true). */
  juice?: boolean;
  /** Override the profile's play time (wall s). */
  seconds?: number;
  /** Timeline lines for --verbose (wall time, text). */
  log?: (t: number, line: string) => void;
}

export interface RunResult {
  profile: string;
  seed: number;
  juice: boolean;
  seconds: number;
  /** Wall s of the first kill / first footman hired / first upgrade offered / archers unlocked (-1: never). */
  firstKill: number;
  firstFootman: number;
  firstUpgradeVisible: number;
  archersUnlocked: number;
  firstArcher: number;
  /** Wall s of the first purchase of each unit / upgrade id. */
  firstBuy: Record<string, number>;
  /** Dragon body length (m) at each SIZE_AT checkpoint. */
  sizeAt: number[];
  /** Kills at 3:15. */
  killsAtBoss: number;
  /** Kills at the end of each wall minute (index 0 = 1:00). */
  killsByMinute: number[];
  kills: number;
  /** Longest wall stretch with nothing affordable, from the first kill to the window end. */
  longestUnaffordable: number;
  /**
   * Longest wall stretch with nothing new to buy or see, first kill → window end. New = an unlock,
   * a milestone, an upgrade or first unit bought, or the dragon reaching a new size word.
   */
  longestNoveltyGap: number;
  /** Wall s when that longest novelty gap ended. */
  longestNoveltyGapEnd: number;
  /** The same, counting only things to buy (unlocks, milestones, upgrades, first units). */
  longestBuyNoveltyGap: number;
  /** Novelty events inside that window. */
  novelties: number;
  /** Longest wall stretch between kills (dead-end detector), whole run. */
  longestKillGap: number;
  /** Purchases per minute inside the window. */
  purchasesPerMin: number;
  /** Inside the window: windups started, attacks the player saw land (breath + swipe), staggers. */
  windups: number;
  attacks: number;
  staggers: number;
  /** Share of gold earned in the window that came from stagger bonuses. */
  staggerGoldShare: number;
  /** Logic seconds / wall seconds over the run (1 without juice). */
  dilation: number;
  /** Share of damage from clicks over the window. */
  clickShare: number;
}

/** The window the pacing metrics cover: to the boss for active players, the whole run for idle. */
export function windowEnd(p: Profile, seconds: number): number {
  return p.clickUntilFirstKill ? seconds : Math.min(seconds, BOSS_AT);
}

function num(d: { toNumber(): number }): number {
  return d.toNumber();
}

export function runGame(p: Profile, seed: number, opts: RunOptions = {}): RunResult {
  const juice = opts.juice ?? true;
  const seconds = opts.seconds ?? p.seconds;
  const winEnd = windowEnd(p, seconds);
  const log = opts.log;
  const s: GameState = createInitialState(seed);
  const rng = seedRng((seed * 0x9e3779b1) ^ 0xb07);
  const clock = new JuiceClock(juice);

  const r: RunResult = {
    profile: p.name,
    seed,
    juice,
    seconds,
    firstKill: -1,
    firstFootman: -1,
    firstUpgradeVisible: -1,
    archersUnlocked: -1,
    firstArcher: -1,
    firstBuy: {},
    sizeAt: [],
    killsAtBoss: 0,
    killsByMinute: [],
    kills: 0,
    longestUnaffordable: 0,
    longestNoveltyGap: 0,
    longestNoveltyGapEnd: 0,
    longestBuyNoveltyGap: 0,
    novelties: 0,
    longestKillGap: 0,
    purchasesPerMin: 0,
    windups: 0,
    attacks: 0,
    staggers: 0,
    staggerGoldShare: 0,
    dilation: 1,
    clickShare: 0,
  };

  let wall = 0;
  let logic = 0;
  const pending: GameEvent[] = [];
  const emit = (e: GameEvent): void => {
    pending.push(e);
  };
  const act = (a: Action): void => applyAction(s, a, emit);

  let lastKill = 0;
  let lastNovelty = -1;
  let unaffordableSince = -1;
  let purchasesInWindow = 0;
  let clickDmg = 0;
  let armyDmg = 0;
  let killStart = 0;
  let killGoldSum = 0;
  let staggerGoldSum = 0;
  const seen = new Set<string>();

  let lastBuyNovelty = -1;
  let lastSizeWord = sizeWord(s.dragon.size);
  const noveltyGap = (t: number): void => {
    if (t - lastNovelty > r.longestNoveltyGap) {
      r.longestNoveltyGap = t - lastNovelty;
      r.longestNoveltyGapEnd = t;
    }
  };
  const novelty = (what: string, toBuy = true): void => {
    if (r.firstKill < 0 || wall > winEnd) return;
    noveltyGap(wall);
    lastNovelty = wall;
    if (toBuy) {
      r.longestBuyNoveltyGap = Math.max(r.longestBuyNoveltyGap, wall - lastBuyNovelty);
      lastBuyNovelty = wall;
    }
    r.novelties++;
    log?.(wall, '  + new: ' + what);
  };

  const drain = (): void => {
    for (let i = 0; i < pending.length; i++) {
      const e = pending[i]!;
      clock.onEvent(e);
      switch (e.type) {
        case 'dragonDeath': {
          r.kills++;
          if (wall <= winEnd) killGoldSum += num(e.gold);
          r.longestKillGap = Math.max(r.longestKillGap, wall - lastKill);
          lastKill = wall;
          if (r.firstKill < 0) {
            r.firstKill = wall;
            lastNovelty = lastBuyNovelty = wall;
          }
          if (log) {
            const d = s.dragon;
            log(wall, `kill #${r.kills}  ${d.name}  #${d.index} ${d.size.toFixed(2)} m  ${fmt(d.maxHp)} HP  +${fmt(e.gold)} gold  in ${(wall - killStart).toFixed(1)} s`);
          }
          break;
        }
        case 'dragonSpawn': {
          killStart = wall;
          const word = sizeWord(s.dragon.size);
          if (word !== lastSizeWord) {
            lastSizeWord = word;
            novelty('size: ' + word, false);
          }
          break;
        }
        case 'dragonPhase':
          if (e.phase === 'windup') windupCount++;
          if (wall > winEnd) break;
          if (e.phase === 'windup') r.windups++;
          else if (e.phase === 'breath' || e.phase === 'swipe') {
            r.attacks++;
            log?.(wall, '  the dragon ' + (e.phase === 'breath' ? 'breathes fire' : 'swipes'));
          }
          break;
        case 'goldGain':
          if (e.source === 'stagger' && wall <= winEnd) staggerGoldSum += num(e.amount);
          break;
        case 'unlock':
          if (e.kind === 'upgrade' && r.firstUpgradeVisible < 0) r.firstUpgradeVisible = wall;
          if (e.kind === 'unit' && e.id === 'archer') r.archersUnlocked = wall;
          log?.(wall, `unlock ${e.kind}.${e.id}`);
          if (e.kind !== 'feature') novelty('unlock ' + e.id);
          break;
        case 'purchase':
          if (wall <= winEnd) purchasesInWindow++;
          if (e.id === 'footman' && r.firstFootman < 0) r.firstFootman = wall;
          if (e.id === 'archer' && r.firstArcher < 0) r.firstArcher = wall;
          log?.(wall, `buy ${e.id}${e.kind === 'unit' ? ' → ' + s.units[e.id as 'footman' | 'archer'] : ''}  (gold left ${fmt(s.gold)})`);
          if (!seen.has(e.id)) {
            seen.add(e.id);
            r.firstBuy[e.id] = wall;
            novelty((e.kind === 'unit' ? 'first ' : 'upgrade ') + e.id);
          }
          break;
        case 'milestone':
          novelty(`${e.unit} ×${e.mult} at ${e.owned}`);
          break;
        case 'strike':
          if (e.stagger && wall <= winEnd) {
            r.staggers++;
            log?.(wall, '  stagger!');
          }
          if (wall <= winEnd) clickDmg += Math.min(num(e.damage), num(s.dragon.maxHp));
          break;
        case 'armyHit':
          if (wall <= winEnd) armyDmg += Math.min(num(e.damage), num(s.dragon.maxHp));
          break;
      }
    }
    pending.length = 0;
  };

  // "Nothing affordable" stretches, sampled whenever gold can change (after clicks, after each tick).
  const sampleAffordable = (): void => {
    if (r.firstKill < 0 || wall > winEnd) return;
    if (sel.anythingAffordable(s)) {
      if (unaffordableSince >= 0) {
        r.longestUnaffordable = Math.max(r.longestUnaffordable, wall - unaffordableSince);
        if (wall - unaffordableSince > 10) log?.(wall, `  (${(wall - unaffordableSince).toFixed(1)} s with nothing affordable)`);
      }
      unaffordableSince = -1;
    } else if (unaffordableSince < 0) unaffordableSince = wall;
  };

  const frames = Math.round(seconds / FRAME_DT);
  const clicking = p.cps > 0;
  const clickStart = p.startDelay;
  let clickAcc = 0;
  // The windup the bot last decided about (dragon id + windup count), and when its throat aim lands.
  let windupCount = 0;
  let aimWindup = '';
  let aimAt = Infinity;
  const windupKey = (): string => s.dragon.id + ':' + windupCount;
  let nextShop = Infinity;
  let acc = 0;
  let sizeIdx = 0;
  let bossDone = false;
  let minute = 1;

  for (let f = 0; f < frames; f++) {
    // Input (between frames, in wall time).
    if (clicking && wall >= clickStart && !(p.clickUntilFirstKill && r.firstKill >= 0)) {
      clickAcc += p.cps * FRAME_DT;
      while (clickAcc >= 1) {
        clickAcc -= 1;
        let rate = p.weakRate;
        if (s.dragon.phase === 'windup') {
          // A new windup: decide whether to go for the throat, and how fast.
          if (aimWindup !== windupKey()) {
            aimWindup = windupKey();
            aimAt = nextFloat(rng) < p.staggerTry ? wall + p.reactMin + (p.reactMax - p.reactMin) * nextFloat(rng) : Infinity;
          }
          rate = wall >= aimAt ? p.throatHit : 0;
        }
        const weak = rate > 0 && nextFloat(rng) < rate;
        act({ type: 'strike', weak, aimed: true, x: 0, y: 0 });
      }
    }
    sampleAffordable(); // a click may have paid for something the shop spends right away
    if (r.firstKill >= 0 && nextShop === Infinity) nextShop = wall + Math.min(1, p.shopEvery);
    if (wall >= nextShop) {
      shop(s, p, act);
      nextShop += p.shopEvery;
    }
    drain();

    // Time, then fixed logic steps, then the frame's drain (juice requests land here).
    const dt = clock.update(FRAME_DT);
    wall += FRAME_DT;
    logic += dt;
    acc += dt;
    while (acc >= TICK_DT - 1e-9) {
      tick(s, TICK_DT, emit);
      acc -= TICK_DT;
      sampleAffordable();
    }
    if (acc < 0) acc = 0;
    drain();

    // Checkpoints.
    while (sizeIdx < SIZE_AT.length && wall >= SIZE_AT[sizeIdx]! - 1e-9) {
      r.sizeAt.push(s.dragon.size);
      sizeIdx++;
    }
    if (!bossDone && wall >= BOSS_AT - 1e-9) {
      r.killsAtBoss = s.kills;
      bossDone = true;
    }
    if (wall >= minute * 60 - 1e-9) {
      r.killsByMinute.push(s.kills);
      minute++;
    }
  }

  const end = Math.min(wall, winEnd);
  if (unaffordableSince >= 0) r.longestUnaffordable = Math.max(r.longestUnaffordable, end - unaffordableSince);
  if (r.firstKill >= 0) {
    noveltyGap(end);
    r.longestBuyNoveltyGap = Math.max(r.longestBuyNoveltyGap, end - lastBuyNovelty);
  }
  r.longestKillGap = Math.max(r.longestKillGap, wall - lastKill);
  if (!bossDone) r.killsAtBoss = s.kills;
  const winFrom = Math.max(0, r.firstKill);
  r.purchasesPerMin = end > winFrom ? (purchasesInWindow * 60) / (end - winFrom) : 0;
  r.dilation = wall > 0 ? logic / wall : 1;
  r.staggerGoldShare = killGoldSum + staggerGoldSum > 0 ? staggerGoldSum / (killGoldSum + staggerGoldSum) : 0;
  r.clickShare = clickDmg + armyDmg > 0 ? clickDmg / (clickDmg + armyDmg) : 0;
  if (log) {
    log(wall, `end: ${s.kills} kills, dragon #${s.dragon.index} ${s.dragon.size.toFixed(1)} m, ${s.units.footman} footmen, ${s.units.archer} archers, gold ${fmt(s.gold)}, dilation ${r.dilation.toFixed(3)}`);
  }
  return r;
}
