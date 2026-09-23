// The core contract: game state, actions (inputs) and events (outputs).
// Render/UI/audio read GameState and subscribe to GameEvents; they change the game only by
// dispatching Actions. See ARCHITECTURE.md for the rules.
import type { Decimal } from './decimal';
import type { RngState } from '../lib/rng';

/** 'lancer' (M2): the Mountain's cavalry. */
export type UnitId = 'footman' | 'archer' | 'lancer';

/** Upgrade ids (one-shots). Tier 0 first, then the Mountain's set. Actions and state key upgrades by plain string ids. */
export type UpgradeId =
  | 'pointySwords'
  | 'drillSergeant'
  | 'keenEye'
  | 'fletching'
  | 'bounty'
  | 'warHorns'
  | 'heroicExample'
  | 'quickNock'
  | 'grindstone'
  // ---- tier 1, the Mountain (unlock only in tier 1+) ----
  | 'highForge'
  | 'pikeWall'
  | 'yewLongbows'
  | 'mountainTithe'
  | 'couchedLances'
  | 'destriers';

/**
 * 'leave' (M2): the dragon retreats off stage right (render: the entrance in reverse). A boss whose
 * timer ran out leaves, then the next ordinary dragon spawns; a dragon still fighting when a zoom
 * begins leaves and nothing replaces it until the new tier.
 */
export type DragonPhase = 'enter' | 'idle' | 'windup' | 'breath' | 'swipe' | 'stagger' | 'dying' | 'leave';

/** The attack a windup leads into. Valid during windup/breath/swipe (render the right tell). */
export type DragonAttack = 'breath' | 'swipe';

export interface DragonState {
  /** Unique per spawn (never reused within a save). */
  id: number;
  /** nth dragon in this tier (0-based); drives size and HP. */
  index: number;
  /** Species key; 'newt' in tier 0. */
  species: string;
  name: string;
  epithet: string;
  /** Body length in meters (tier-local world units). */
  size: number;
  /** uint32 for visual variation (feed it to lib/rng Rng). */
  seed: number;
  hp: Decimal;
  maxHp: Decimal;
  phase: DragonPhase;
  /** Seconds into the current phase (advances in TICK_DT steps; interpolate with view.alpha). */
  phaseT: number;
  /** Planned duration of the current phase in seconds. */
  phaseDur: number;
  attack: DragonAttack;
  /** Times this dragon has been staggered (the first stagger pays the full gold bonus). */
  staggers: number;
  /** M2: the tier boss's id ('elderNewt', 'grimmaw'), or null for an ordinary dragon. */
  boss: string | null;
}

// ---- M2: tiers, the Wyrm Gauge, bosses, the zoom, Scales, heraldry, abilities, champions ----

/** Heraldic charges bought with Scales (M2 v1). M3 adds 'eagle' and 'moon', then 'seneschal' and 'herald'. */
export type ChargeId = 'lion' | 'sun' | 'wyvern' | 'stag' | 'tower' | 'crown';

/** Abilities on keys 1-3 (tier 1 onward). */
export type AbilityId = 'charge' | 'rally' | 'volley';

/** Named champions (one joins per tier; they persist through zooms). */
export type ChampionId = 'aldric' | 'brunhild';

/** The Wyrm Gauge and the tier's boss. Reset at every zoom. */
export interface WyrmState {
  /** Kills that count toward the gauge this tier (drops back when a boss escapes). gauge = charge / tier's bossAt. */
  charge: number;
  /** Seconds left on the boss timer while the boss is fighting (0 otherwise). */
  bossT: number;
  /** Full boss timer (s) of the current or last boss fight. */
  bossDur: number;
  /** Times the boss escaped this tier. */
  escapes: number;
  /** The tier's boss is beaten: the zoom is available (the first zoom of a save starts by itself). */
  cleared: boolean;
  /** `kills` when the boss fell: kills since then are how far the player pushed (more Scales). */
  clearedAt: number;
}

/** What a zoom will award, fixed at zoomBegin so the cinematic can show it. */
export interface ZoomReward {
  scales: Decimal;
  /** This zoom's Fusion Bonus (multiplies into ZoomState.fusion). */
  fusion: number;
  /** Knight height in the new tier (display m): the colossus's height. */
  height: number;
}

export interface ZoomState {
  /**
   * The cinematic's stage: null = playing; 'begin' = the economy holds, the old tier is still in
   * state (rally and fusion play on it); 'switched' = the new tier is in state, still holding
   * (pull-back and reveal). While stage !== null: no dragon transitions, no army, strikes and
   * purchases are ignored.
   */
  stage: null | 'begin' | 'switched';
  /** Zooms completed in this loop. */
  count: number;
  /** Product of every Fusion Bonus so far: multiplies all damage. */
  fusion: number;
  /** The pending zoom's award (set at 'begin', paid at 'switch'), else null. */
  pending: ZoomReward | null;
}

export interface HeraldryState {
  /** Level per charge (0 = not on the shield). */
  levels: Record<ChargeId, number>;
  /** Charges in the order first taken: order[0] is the principal charge on the coat of arms. */
  order: ChargeId[];
}

export interface AbilityState {
  /** Seconds of effect left (0 = not active). */
  active: number;
  /** Seconds until it can be used again (0 = ready). */
  cooldown: number;
}

export interface ChampionState {
  /** 0 = hasn't joined; joining sets 1; gold buys more levels. */
  level: number;
  /** Seconds until the next special move. */
  specialT: number;
}

/**
 * An archer volley or a lancer charge in flight (core-private; render learns about it from the
 * 'volley' / 'cavalry' event).
 */
export interface PendingVolley {
  unit: UnitId;
  /** Id of the dragon it was loosed at; it lands on nothing if that dragon is gone. */
  target: number;
  /** Seconds until impact. */
  t: number;
  damage: Decimal;
  /** Arrows (or riders) to show when it lands. */
  arrows: number;
  /** Dragonbane Volley (the ability), not the archers' own. */
  ability?: boolean;
}

/** Lifetime counters (read-only for render/UI: chronicle lines, sim stats, first-strike reveal). */
export interface Stats {
  /** Strikes that landed (clicks on a living dragon). */
  strikes: number;
  /** Weak-spot strikes. */
  crits: number;
  staggers: number;
}

/** Army timers (core-private). */
export interface ArmyState {
  /** Seconds until the next footman melee beat. */
  meleeT: number;
  /** Seconds until the next archer volley. */
  volleyT: number;
  /** Seconds until the next lancer charge (M2). */
  cavalryT: number;
  /** Volleys and charges in flight. */
  volleys: PendingVolley[];
}

export interface GameState {
  /** Save schema version. */
  v: number;
  seed: number;
  /** Deterministic RNG state (sfc32 words). Only core draws from it. */
  rng: RngState;
  /** Simulated seconds since this state was created. */
  t: number;
  /** 0 = Meadow. */
  tier: number;
  gold: Decimal;
  lifetimeGold: Decimal;
  /** Owned counts. */
  units: Record<UnitId, number>;
  /** Purchased level per upgrade id (0/1 for one-shots). */
  upgrades: Record<string, number>;
  /** Dragons slain in this tier. */
  kills: number;
  /** Progressive disclosure / unlocks, e.g. 'unit.archer', 'upgrade.pointySwords', 'feature.panel'. */
  flags: Record<string, boolean>;
  dragon: DragonState;
  stats: Stats;
  // ---- M2 ----
  /** Height of a knight in this tier, display meters (1.8 in the Meadow): the headline number. */
  height: number;
  /** Permanent currency, earned by zooming; spent on heraldry. */
  scales: Decimal;
  lifetimeScales: Decimal;
  wyrm: WyrmState;
  zoom: ZoomState;
  heraldry: HeraldryState;
  abilities: Record<AbilityId, AbilityState>;
  champions: Record<ChampionId, ChampionState>;
  // ---- core-private below: serialized, but render/UI must not depend on these ----
  nextDragonId: number;
  army: ArmyState;
}

export type DebugAction =
  | { type: 'debug'; op: 'gold'; amount: number }
  | { type: 'debug'; op: 'kill' }
  /** Skip to the next dragon without a reward. */
  | { type: 'debug'; op: 'next' }
  /** Respawn as dragon #amount of this tier (jump sizes). */
  | { type: 'debug'; op: 'dragon'; amount: number }
  | { type: 'debug'; op: 'units'; unit: UnitId; amount: number }
  /** Force the dragon into a phase right now (windup takes an attack). */
  | { type: 'debug'; op: 'phase'; phase: DragonPhase; attack?: DragonAttack }
  | { type: 'debug'; op: 'tier'; amount: number }
  /** Set a flag. 'debug.loopPhase' repeats the current phase; 'debug.immortal' refills HP instead of dying. */
  | { type: 'debug'; op: 'flag'; flag: string; value: boolean }
  /** M2: fill the Wyrm Gauge so the boss arrives after the current dragon. */
  | { type: 'debug'; op: 'boss' }
  /** M2: mark the tier's boss beaten (the zoom becomes available; the first zoom starts by itself). */
  | { type: 'debug'; op: 'cleared' }
  | { type: 'debug'; op: 'scales'; amount: number };

/** The zoom cinematic's three beats. Core begins the first zoom of a save by itself; render drives 'switch' and 'end'. */
export type ZoomStage = 'begin' | 'switch' | 'end';

export type Action =
  /** x, y: world impact point in meters (opaque to core; echoed in the 'strike' event). */
  | { type: 'strike'; weak: boolean; aimed: boolean; x: number; y: number }
  /** amount: how many to hire (1, 10, ...), or BUY_MAX (-1) for as many as gold allows. All-or-nothing. */
  | { type: 'buyUnit'; unit: UnitId; amount: number }
  | { type: 'buyUpgrade'; id: string }
  /**
   * M2. 'begin' (the Zoom button, when the boss is beaten and a next tier exists): hold the
   * economy, a fighting dragon leaves, emit zoomBegin. 'switch' (render, after snapshotting the old
   * tier): pay the reward and swap in the next tier. 'end' (render, after the reveal): play resumes.
   */
  | { type: 'zoom'; stage: ZoomStage }
  | { type: 'buyHeraldry'; id: ChargeId }
  | { type: 'useAbility'; id: AbilityId }
  /** Level a champion `amount` times (BUY_MAX = as many as gold allows). All-or-nothing. */
  | { type: 'levelChampion'; id: ChampionId; amount: number }
  | DebugAction;

export type GameEvent =
  /** auto (M2): a Rally auto-strike rather than a click. */
  | { type: 'strike'; damage: Decimal; crit: boolean; weak: boolean; stagger: boolean; aimed: boolean; x: number; y: number; auto?: boolean }
  /**
   * A melee beat, a volley or a lancer charge landing. hits = how many visible blows/arrows/riders
   * to show. ability (M2): the Dragonbane Volley landing.
   */
  | { type: 'armyHit'; unit: UnitId; damage: Decimal; hits: number; ability?: boolean }
  /**
   * Archers loosed; the matching 'armyHit' arrives `flight` seconds later (if the dragon lives).
   * ability (M2): the Dragonbane Volley (one huge volley, even with no archers).
   */
  | { type: 'volley'; unit: UnitId; arrows: number; flight: number; ability?: boolean }
  | { type: 'dragonSpawn'; id: number }
  | { type: 'dragonPhase'; id: number; phase: DragonPhase; dur: number }
  /** Kill reward (already added to gold); coins burst from the corpse. */
  | { type: 'dragonDeath'; id: number; gold: Decimal }
  /** Non-kill gold (already added to gold). */
  | { type: 'goldGain'; amount: Decimal; source: 'stagger' | 'other' }
  | { type: 'purchase'; kind: 'unit' | 'upgrade' | 'champion' | 'heraldry'; id: string; amount: number }
  | { type: 'unlock'; kind: 'unit' | 'upgrade' | 'feature' | 'ability' | 'champion' | 'heraldry'; id: string }
  | { type: 'milestone'; unit: UnitId; owned: number; mult: number }
  // ---- M2 ----
  /** Cavalry set off: the matching armyHit arrives `travel` s later (dropped if its dragon is gone). */
  | { type: 'cavalry'; unit: UnitId; riders: number; travel: number }
  /** The gauge filled: the boss arrives next (its dragonSpawn follows). dur = the fight's timer (s). */
  | { type: 'bossSummon'; boss: string; dur: number }
  /** The boss fell (its dragonDeath fires too). first = the first time this boss fell in this save. */
  | { type: 'bossDefeated'; boss: string; first: boolean }
  /** The timer ran out: the boss leaves (phase 'leave') and the gauge drops back. */
  | { type: 'bossEscaped'; boss: string }
  | { type: 'zoomBegin'; from: number; to: number; scales: Decimal; fusion: number; height: number }
  /** The new tier is in state (a 'resync' follows in the same drain). */
  | { type: 'zoomSwitch'; tier: number }
  | { type: 'zoomEnd'; tier: number }
  | { type: 'abilityUse'; id: AbilityId; dur: number }
  | { type: 'abilityEnd'; id: AbilityId }
  | { type: 'abilityReady'; id: AbilityId }
  | { type: 'championJoin'; id: ChampionId }
  /** A champion's ordinary blow (on the footmen's melee beat; damage already applied). */
  | { type: 'championHit'; id: ChampionId; damage: Decimal }
  /** A champion's special move landed (damage already applied). */
  | { type: 'championSpecial'; id: ChampionId; damage: Decimal }
  | { type: 'scalesGain'; amount: Decimal }
  /** State changed wholesale (load, catch-up, debug jump): rebuild visuals from state, no juice. */
  | { type: 'resync' };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type Emit = (e: GameEvent) => void;
