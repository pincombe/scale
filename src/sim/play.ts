// One headless game: a bot plays the real core in wall time at 60 fps, through the same frame
// structure as app/loop.ts (input → time.update → fixed 20 Hz ticks → drain events → juice).
// Records the pacing milestones the targets check, all in WALL seconds (what the judge feels).
import { nextFloat, seedRng } from '../lib/rng';
import { TICK_DT, applyAction, createInitialState, fmt, sel, sizeWord, tick } from '../core';
import type { AbilityId, Action, GameEvent, GameState } from '../core';
import { readyAbilities, shop, shopPause } from './bots';
import type { Profile } from './bots';
import { JuiceClock } from './juice';
import { createEyeSchedule, stepEyeSchedule } from '../render/backdrop/eyeTimeline';

export const FRAME_DT = 1 / 60;
/** Checkpoints (wall s): dragon size sampled at the minutes, kills at 3:15 (the M2 boss). */
export const SIZE_AT = [60, 120, 180] as const;
export const BOSS_AT = 195;
/** Kill pace is measured over this wall window (s): the stretch after the tutorial newts. */
export const PACE_FROM = 40;
export const PACE_TO = 120;
/**
 * The zoom cinematic as the sim models it (wall s): nothing happens for this long after zoomBegin,
 * then the bot dispatches 'switch' and 'end' (WP 2.1 owns the real timing).
 */
export const ZOOM_CINEMATIC = 9;
/** The Mountain's army is "back" at this many units (from the zoom's end). */
export const ARMY_BACK = 20;
/**
 * After the build's last boss falls (M2: Grimmaw; the Kingdom comes in the next build) the run
 * plays this much longer, then stops: what players do after it is informational only.
 */
export const FINALE_TAIL = 30;

export interface RunOptions {
  /** Model hit-stop / slow-mo dilation (default true). */
  juice?: boolean;
  /** Override the profile's play time (wall s). */
  seconds?: number;
  /** Timeline lines for --verbose (wall time, text). */
  log?: (t: number, line: string) => void;
  /** Every core event as it's emitted (before a hit's damage is applied), for probes. */
  onEvent?: (e: GameEvent, s: GameState) => void;
}

export interface RunResult {
  profile: string;
  seed: number;
  juice: boolean;
  seconds: number;
  /** Wall s of the first kill / fifth kill / first footman hired / first upgrade offered and bought / archers unlocked (-1: never). */
  firstKill: number;
  fifthKill: number;
  firstFootman: number;
  firstUpgradeVisible: number;
  firstUpgradeBought: number;
  archersUnlocked: number;
  firstArcher: number;
  /** Wall s the eye in the mountain first opens (the Meadow backdrop's own schedule, run on the
   *  sim's state: the gauge, play time and the boss), -1: never. */
  eyeOpens: number;
  /** Wall s of the first purchase of each unit / upgrade id. */
  firstBuy: Record<string, number>;
  /** M2: wall s of the first boss's (first) summon, the first zoom's begin, the second boss's (first) summon (-1: never). */
  firstBoss: number;
  firstZoom: number;
  secondBoss: number;
  /** Boss fights lost to the timer. */
  bossEscapes: number;
  /** The first zoom's reward: Scales, Fusion Bonus, knight height in the Mountain (display m). */
  zoomScales: number;
  zoomFusion: number;
  zoomHeight: number;
  /** Wall s of the second zoom's begin (never in M2: the Mountain is the last tier). */
  secondZoom: number;
  /** Scales earned over the run. */
  scalesEarned: number;
  // ---- M2 pacing (WP 2.7), wall s; -1 (or Infinity for spans) when it never happened ----
  /** The Elder Newt / Grimmaw falls (wall s), and the winning fight's length (its summon → its kill). */
  firstBossKill: number;
  firstBossFight: number;
  secondBossKill: number;
  secondBossFight: number;
  /** Fights lost to the timer, per boss. */
  firstBossEscapes: number;
  secondBossEscapes: number;
  /** The first zoom's end (play resumes in the Mountain). */
  zoomEnd: number;
  /** From the zoom's end: the Mountain's first kill, and the army back to ARMY_BACK units. */
  mountainFirstKill: number;
  armyBack: number;
  /** The Mountain's beats: lancers unlocked, the Dragonbane Volley unlocked, Dame Brunhild joins. */
  lancersUnlocked: number;
  volleyUnlocked: number;
  brunhildJoins: number;
  /** Longest wall stretch with nothing new in the Mountain (zoom end → Grimmaw's fall or the run's end). */
  mountainNoveltyGap: number;
  /**
   * Longest wall stretch between kills over the whole run, first kill → the last tier's boss falls
   * (or the run ends): across boss fights, escapes, the zoom's hold and the Mountain's first minute.
   */
  runKillGap: number;
  /**
   * Damage shares by source (clicks incl. Rally's auto-strikes · the army incl. the Volley ·
   * champions), each hit counted up to the HP it could still take. Meadow: to the Elder Newt's fall;
   * the champion share from Aldric's join. Mountain: from the zoom to Grimmaw's fall.
   */
  meadowClickShare: number;
  meadowChampShare: number;
  mountainClickShare: number;
  mountainChampShare: number;
  /** Dragon body length (m) at each SIZE_AT checkpoint: the Meadow's latest ordinary dragon (never the ×1.5 boss). */
  sizeAt: number[];
  /** Kills at 3:15. */
  killsAtBoss: number;
  /** Kills at the end of each wall minute (index 0 = 1:00). */
  killsByMinute: number[];
  /** Mean wall seconds per kill between PACE_FROM and PACE_TO (Infinity: no kills). */
  killPace: number;
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
  /** Longest wall stretch between kills (dead-end detector), to killGapEnd (M1's 4:00; idle: its whole run). */
  longestKillGap: number;
  /** Purchases per minute inside the window. */
  purchasesPerMin: number;
  /** Inside the window: windups started, attacks the player saw land (breath + swipe), staggers. */
  windups: number;
  attacks: number;
  staggers: number;
  /** Share of gold earned in the window that came from stagger bonuses (ordinary dragons: never the boss). */
  staggerGoldShare: number;
  /** Logic seconds / wall seconds over the run (1 without juice). */
  dilation: number;
  /**
   * Share of damage from clicks over the window (each hit counted up to the HP it could still take),
   * out of clicks + army + champions (champions joined the denominator in M2).
   */
  clickShare: number;
  /** Wall s the player spent shopping (no clicks) inside the window. */
  shopping: number;
}

/** The window the pacing metrics cover: to the boss for active players, the whole run for idle. */
export function windowEnd(p: Profile, seconds: number): number {
  return p.clickUntilFirstKill ? seconds : Math.min(seconds, BOSS_AT);
}

/**
 * Active players' runs were 4:00 long in M1; M2 plays them to Grimmaw. `longestKillGap` keeps its
 * M1 span so its targets mean what they meant; `runKillGap` covers the whole run.
 */
export const M1_RUN = 240;

/** Where the longest-gap-between-kills measurement stops (wall s). */
export function killGapEnd(p: Profile, seconds: number): number {
  return p.clickUntilFirstKill ? seconds : Math.min(seconds, M1_RUN);
}

function num(d: { toNumber(): number }): number {
  return d.toNumber();
}

/** Damage dealt by source (see RunResult's shares). */
interface DamageMix {
  click: number;
  army: number;
  champ: number;
}

function mix(): DamageMix {
  return { click: 0, army: 0, champ: 0 };
}

function share(m: DamageMix, key: keyof DamageMix): number {
  const tot = m.click + m.army + m.champ;
  return tot > 0 ? m[key] / tot : NaN;
}

/** Add a hit to a mix by its event type (anything that isn't damage is ignored). */
function addHit(m: DamageMix, e: GameEvent, d: number): void {
  if (e.type === 'strike') m.click += d;
  else if (e.type === 'armyHit') m.army += d;
  else if (e.type === 'championHit' || e.type === 'championSpecial') m.champ += d;
}

export function runGame(p: Profile, seed: number, opts: RunOptions = {}): RunResult {
  const juice = opts.juice ?? true;
  const seconds = opts.seconds ?? p.seconds;
  const winEnd = windowEnd(p, seconds);
  const gapEnd = killGapEnd(p, seconds);
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
    fifthKill: -1,
    firstFootman: -1,
    firstUpgradeVisible: -1,
    firstUpgradeBought: -1,
    archersUnlocked: -1,
    firstArcher: -1,
    eyeOpens: -1,
    firstBuy: {},
    firstBoss: -1,
    firstZoom: -1,
    secondBoss: -1,
    bossEscapes: 0,
    zoomScales: NaN,
    zoomFusion: NaN,
    zoomHeight: NaN,
    secondZoom: -1,
    scalesEarned: 0,
    firstBossKill: -1,
    firstBossFight: Infinity,
    secondBossKill: -1,
    secondBossFight: Infinity,
    firstBossEscapes: 0,
    secondBossEscapes: 0,
    zoomEnd: -1,
    mountainFirstKill: Infinity,
    armyBack: Infinity,
    lancersUnlocked: -1,
    volleyUnlocked: -1,
    brunhildJoins: -1,
    mountainNoveltyGap: 0,
    runKillGap: 0,
    meadowClickShare: NaN,
    meadowChampShare: NaN,
    mountainClickShare: NaN,
    mountainChampShare: NaN,
    sizeAt: [],
    killsAtBoss: 0,
    killsByMinute: [],
    killPace: Infinity,
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
    shopping: 0,
  };

  let wall = 0;
  let logic = 0;
  const pending: GameEvent[] = [];
  /** Per pending event, for --verbose: a purchase's count owned and gold left right after it. */
  const buyNote: string[] = [];
  // Damage shares are measured when core emits, before the blow lands: each hit counts up to the HP
  // the dragon still had (the overkill of a finishing blow is not damage dealt).
  const dealt = (damage: { toNumber(): number }): number => Math.min(num(damage), Math.max(0, num(s.dragon.hp)));
  /** The M1 window (to 3:15); the Meadow to its boss's fall (all, and from Aldric's join); the Mountain to Grimmaw's. */
  const windowMix = mix();
  const meadowMix = mix();
  const aldricMix = mix();
  const mountainMix = mix();
  const onEvent = opts.onEvent;
  const emit = (e: GameEvent): void => {
    onEvent?.(e, s);
    // The stagger share of gold (M1's metric) counts ordinary dragons only: the 3:15 window can cut
    // through the boss fight, whose stagger bonus (2× a dragon's kill reward) would count without
    // its kill.
    if (wall <= winEnd && !s.dragon.boss) {
      if (e.type === 'dragonDeath') killGoldSum += num(e.gold);
      else if (e.type === 'goldGain' && e.source === 'stagger') staggerGoldSum += num(e.amount);
    }
    if (e.type === 'strike' || e.type === 'armyHit' || e.type === 'championHit' || e.type === 'championSpecial') {
      const d = dealt(e.damage);
      if (wall <= winEnd) addHit(windowMix, e, d);
      // The killing blow is emitted before the boss is marked beaten, so it counts.
      if (!s.wyrm.cleared) {
        if (s.tier === 0) {
          addHit(meadowMix, e, d);
          if (s.champions.aldric.level > 0) addHit(aldricMix, e, d);
        } else if (s.tier === 1) addHit(mountainMix, e, d);
      }
    }
    pending.push(e);
    if (log) buyNote.push(e.type !== 'purchase' ? '' : `${e.kind === 'unit' ? ' → ' + s.units[e.id as 'footman' | 'archer' | 'lancer'] : e.kind === 'champion' ? ' → level ' + s.champions[e.id as 'aldric' | 'brunhild'].level : ''}  (${e.kind === 'heraldry' ? 'Scales left ' + fmt(s.scales) : 'gold left ' + fmt(s.gold)})`);
  };
  const act = (a: Action): void => applyAction(s, a, emit);

  let lastKill = 0;
  /** Wall s the build's last boss fell (-1: not yet): the run's M2 measurements stop there. */
  let finaleAt = -1;
  /** Wall s of the latest boss summon (a fight's start). */
  let bossSummonAt = 0;
  /** The Meadow's latest ordinary dragon (the size checkpoints never measure the ×1.5 boss). */
  let meadowSize = s.dragon.size;
  let lastNovelty = -1;
  let unaffordableSince = -1;
  let purchasesInWindow = 0;
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
  /** The Mountain's novelty clock runs from the zoom's end to Grimmaw's fall. */
  let mtnLastNovelty = -1;
  const mountainOpen = (): boolean => r.zoomEnd >= 0 && finaleAt < 0;
  const mountainNovelty = (t: number): void => {
    if (!mountainOpen()) return;
    r.mountainNoveltyGap = Math.max(r.mountainNoveltyGap, t - mtnLastNovelty);
    mtnLastNovelty = t;
  };
  const novelty = (what: string, toBuy = true): void => {
    if (mountainOpen()) {
      mountainNovelty(wall);
      if (wall > winEnd) log?.(wall, '  + new: ' + what);
    }
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
          if (wall <= gapEnd) r.longestKillGap = Math.max(r.longestKillGap, wall - lastKill);
          if (finaleAt < 0) r.runKillGap = Math.max(r.runKillGap, wall - lastKill);
          lastKill = wall;
          if (s.tier === 1 && r.zoomEnd >= 0 && !Number.isFinite(r.mountainFirstKill)) r.mountainFirstKill = wall - r.zoomEnd;
          if (r.firstKill < 0) {
            r.firstKill = wall;
            lastNovelty = lastBuyNovelty = wall;
          }
          if (r.kills === 5) r.fifthKill = wall;
          if (log) {
            const d = s.dragon;
            log(wall, `kill #${r.kills}  ${d.name}  #${d.index} ${d.size.toFixed(2)} m  ${fmt(d.maxHp)} HP  +${fmt(e.gold)} gold  in ${(wall - killStart).toFixed(1)} s`);
          }
          break;
        }
        case 'dragonSpawn': {
          killStart = wall;
          if (s.tier === 0 && !s.dragon.boss) meadowSize = s.dragon.size;
          // The size word the HUD shows (display meters: a Mountain wyvern is ~200 m).
          const word = sizeWord(sel.displayMeters(s, s.dragon.size));
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
        case 'unlock':
          if (e.kind === 'upgrade' && r.firstUpgradeVisible < 0) r.firstUpgradeVisible = wall;
          if (e.kind === 'unit' && e.id === 'archer') r.archersUnlocked = wall;
          if (e.kind === 'unit' && e.id === 'lancer' && r.lancersUnlocked < 0) r.lancersUnlocked = wall;
          if (e.kind === 'ability' && e.id === 'volley' && r.volleyUnlocked < 0) r.volleyUnlocked = wall;
          log?.(wall, `unlock ${e.kind}.${e.id}`);
          if (e.kind !== 'feature') novelty('unlock ' + e.id);
          break;
        case 'purchase':
          if (wall <= winEnd) purchasesInWindow++;
          if (e.id === 'footman' && r.firstFootman < 0) r.firstFootman = wall;
          if (e.id === 'archer' && r.firstArcher < 0) r.firstArcher = wall;
          if (e.kind === 'upgrade' && r.firstUpgradeBought < 0) r.firstUpgradeBought = wall;
          log?.(wall, `buy ${e.id}${buyNote[i]}`);
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
          break;
        case 'bossSummon':
          novelty('the boss: ' + e.boss, false);
          if (r.firstBoss < 0) r.firstBoss = wall;
          else if (r.secondBoss < 0 && s.tier > 0) r.secondBoss = wall;
          bossSummonAt = wall;
          log?.(wall, `BOSS ${e.boss} summoned (${e.dur} s)`);
          break;
        case 'bossEscaped':
          r.bossEscapes++;
          if (s.tier === 0) r.firstBossEscapes++;
          else r.secondBossEscapes++;
          log?.(wall, `boss ${e.boss} escaped`);
          break;
        case 'bossDefeated':
          novelty('the boss falls', false);
          if (e.first && s.tier === 0) {
            r.firstBossKill = wall;
            r.firstBossFight = wall - bossSummonAt;
          } else if (e.first && s.tier === 1) {
            r.secondBossKill = wall;
            r.secondBossFight = wall - bossSummonAt;
          }
          if (sel.isLastTier(s) && finaleAt < 0) finaleAt = wall;
          log?.(wall, `boss ${e.boss} defeated${e.first ? ' (first time)' : ''} after ${(wall - bossSummonAt).toFixed(1)} s`);
          break;
        case 'zoomBegin':
          if (r.firstZoom < 0) {
            r.firstZoom = wall;
            r.zoomScales = num(e.scales);
            r.zoomFusion = e.fusion;
            r.zoomHeight = e.height;
          } else if (r.secondZoom < 0) r.secondZoom = wall;
          zoomAt = wall + ZOOM_CINEMATIC;
          novelty('the zoom', false);
          log?.(wall, `ZOOM ${e.from} → ${e.to}: +${fmt(e.scales)} Scales, fusion ×${e.fusion}, knights ${e.height} m`);
          break;
        case 'scalesGain':
          r.scalesEarned += num(e.amount);
          break;
        case 'championJoin':
          if (e.id === 'brunhild' && r.brunhildJoins < 0) r.brunhildJoins = wall;
          log?.(wall, `${e.type} ${e.id}`);
          break;
        case 'abilityUse':
          log?.(wall, `${e.type} ${e.id}`);
          break;
      }
    }
    pending.length = 0;
    buyNote.length = 0;
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
  // The windup the bot last saw start (dragon id + windup count), and when it has retargeted to the
  // windup spot (throat or tail base).
  let windupCount = 0;
  let aimWindup = '';
  let aimAt = Infinity;
  const windupKey = (): string => s.dragon.id + ':' + windupCount;
  let nextShop = Infinity;
  /** Clicking resumes at this wall time (the player is in the shop panel until then). */
  let shopUntil = -Infinity;
  let acc = 0;
  let sizeIdx = 0;
  let bossDone = false;
  let minute = 1;
  let paceFromKills = -1;
  let paceDone = false;
  /** Wall time the modeled zoom cinematic dispatches 'switch' and 'end' (Infinity: no zoom playing). */
  let zoomAt = Infinity;
  /** 'onCooldown' players: when they'll press each ability that is ready now. */
  const abilityAt: Partial<Record<AbilityId, number>> = {};
  /** The Meadow eye's schedule (its clock is logic time, like the backdrop's view.time). */
  const eye = createEyeSchedule();

  for (let f = 0; f < frames; f++) {
    // After the build's last boss, a short informational tail, then the run stops.
    if (finaleAt >= 0 && wall >= finaleAt + FINALE_TAIL) break;
    // Input (between frames, in wall time).
    // The zoom cinematic: ~9 s of nothing, then the stages the zoom director would dispatch.
    if (wall >= zoomAt) {
      zoomAt = Infinity;
      act({ type: 'zoom', stage: 'switch' });
      act({ type: 'zoom', stage: 'end' });
      if (r.zoomEnd < 0) {
        r.zoomEnd = wall;
        mtnLastNovelty = wall;
      }
    }
    const holding = s.zoom.stage !== null;
    if (!holding && p.abilities === 'onCooldown') {
      for (const id of readyAbilities(s)) {
        // The player notices the ready button after a reaction delay (drawn once per use).
        const at = (abilityAt[id] ??= wall + p.abilityDelay * nextFloat(rng));
        if (wall >= at) {
          act({ type: 'useAbility', id });
          delete abilityAt[id];
        }
      }
    }
    if (!holding && clicking && wall >= clickStart && wall >= shopUntil && !(p.clickUntilFirstKill && r.firstKill >= 0)) {
      clickAcc += p.cps * FRAME_DT;
      while (clickAcc >= 1) {
        clickAcc -= 1;
        let rate = p.weakRate;
        if (s.dragon.phase === 'windup') {
          // A new windup: the weak spot jumped; the player needs a moment to retarget.
          if (aimWindup !== windupKey()) {
            aimWindup = windupKey();
            aimAt = wall + p.reactMin + (p.reactMax - p.reactMin) * nextFloat(rng);
          }
          rate = wall >= aimAt ? p.windupWeakRate : 0;
        }
        const weak = rate > 0 && nextFloat(rng) < rate;
        act({ type: 'strike', weak, aimed: true, x: 0, y: 0 });
      }
    }
    sampleAffordable(); // a click may have paid for something the shop spends right away
    if (r.firstKill >= 0 && nextShop === Infinity) nextShop = wall + Math.min(1, p.shopEvery);
    if (wall >= nextShop && !holding) {
      // 'sometimes': half the time; against a boss (horn, timer) every player presses what's ready.
      if (p.abilities === 'sometimes') for (const id of readyAbilities(s)) if (s.dragon.boss || nextFloat(rng) < 0.5) act({ type: 'useAbility', id });
      const pause = shopPause(shop(s, p, act));
      if (pause > 0) {
        shopUntil = wall + pause;
        if (wall <= winEnd) r.shopping += Math.min(pause, winEnd - wall);
      }
      nextShop = Math.max(nextShop + p.shopEvery, shopUntil);
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

    // The eye in the hills (Meadow only), stepped once per frame like the backdrop.
    if (r.eyeOpens < 0 && s.tier === 0 && stepEyeSchedule(eye, s, logic, false)) {
      r.eyeOpens = wall;
      log?.(wall, 'the eye in the hills opens');
    }

    // Checkpoints.
    while (sizeIdx < SIZE_AT.length && wall >= SIZE_AT[sizeIdx]! - 1e-9) {
      r.sizeAt.push(meadowSize);
      sizeIdx++;
    }
    if (r.zoomEnd >= 0 && !Number.isFinite(r.armyBack) && sel.unitsFused(s) >= ARMY_BACK) r.armyBack = wall - r.zoomEnd;
    // Kill counts are the run's totals (state.kills restarts in every tier).
    if (!bossDone && wall >= BOSS_AT - 1e-9) {
      r.killsAtBoss = r.kills;
      bossDone = true;
    }
    if (paceFromKills < 0 && wall >= PACE_FROM - 1e-9) paceFromKills = r.kills;
    if (!paceDone && wall >= PACE_TO - 1e-9) {
      const n = r.kills - paceFromKills;
      r.killPace = n > 0 ? (PACE_TO - PACE_FROM) / n : Infinity;
      paceDone = true;
    }
    if (wall >= minute * 60 - 1e-9) {
      r.killsByMinute.push(r.kills);
      minute++;
    }
  }

  const end = Math.min(wall, winEnd);
  if (unaffordableSince >= 0) r.longestUnaffordable = Math.max(r.longestUnaffordable, end - unaffordableSince);
  if (r.firstKill >= 0) {
    noveltyGap(end);
    r.longestBuyNoveltyGap = Math.max(r.longestBuyNoveltyGap, end - lastBuyNovelty);
  }
  if (lastKill < gapEnd) r.longestKillGap = Math.max(r.longestKillGap, Math.min(wall, gapEnd) - lastKill);
  if (finaleAt < 0) {
    // The run ended before the last boss fell: the open stretches count up to the end.
    r.runKillGap = Math.max(r.runKillGap, wall - lastKill);
    if (mountainOpen()) mountainNovelty(wall);
  }
  r.meadowClickShare = share(meadowMix, 'click');
  r.meadowChampShare = share(aldricMix, 'champ');
  r.mountainClickShare = share(mountainMix, 'click');
  r.mountainChampShare = share(mountainMix, 'champ');
  if (!bossDone) r.killsAtBoss = r.kills;
  const winFrom = Math.max(0, r.firstKill);
  r.purchasesPerMin = end > winFrom ? (purchasesInWindow * 60) / (end - winFrom) : 0;
  r.dilation = wall > 0 ? logic / wall : 1;
  r.staggerGoldShare = killGoldSum + staggerGoldSum > 0 ? staggerGoldSum / (killGoldSum + staggerGoldSum) : 0;
  r.clickShare = windowMix.click > 0 ? share(windowMix, 'click') : 0;
  if (log) {
    log(wall, `end: tier ${s.tier}, ${r.kills} kills, dragon #${s.dragon.index} ${s.dragon.size.toFixed(1)} m, ${s.units.footman} footmen, ${s.units.archer} archers, ${s.units.lancer} lancers, champions ${s.champions.aldric.level}/${s.champions.brunhild.level}, heraldry ${JSON.stringify(s.heraldry.levels)}, fusion ×${s.zoom.fusion}, gold ${fmt(s.gold)}, dilation ${r.dilation.toFixed(3)}`);
  }
  return r;
}
