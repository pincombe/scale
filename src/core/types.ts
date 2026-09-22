// The core contract: game state, actions (inputs) and events (outputs).
// Render/UI/audio read GameState and subscribe to GameEvents; they change the game only by
// dispatching Actions. See ARCHITECTURE.md for the rules.
import type { Decimal } from './decimal';
import type { RngState } from '../lib/rng';

export type UnitId = 'footman' | 'archer';

/** Tier-0 upgrade ids (one-shots). Actions and state key upgrades by plain string ids. */
export type UpgradeId =
  | 'pointySwords'
  | 'drillSergeant'
  | 'keenEye'
  | 'fletching'
  | 'bounty'
  | 'warHorns'
  | 'heroicExample'
  | 'quickNock'
  | 'grindstone';

export type DragonPhase = 'enter' | 'idle' | 'windup' | 'breath' | 'swipe' | 'stagger' | 'dying';

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
}

/** An archer volley in flight (core-private; render learns about it from the 'volley' event). */
export interface PendingVolley {
  unit: UnitId;
  /** Id of the dragon it was loosed at; it lands on nothing if that dragon is gone. */
  target: number;
  /** Seconds until impact. */
  t: number;
  damage: Decimal;
  arrows: number;
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
  | { type: 'debug'; op: 'flag'; flag: string; value: boolean };

export type Action =
  /** x, y: world impact point in meters (opaque to core; echoed in the 'strike' event). */
  | { type: 'strike'; weak: boolean; aimed: boolean; x: number; y: number }
  /** amount: how many to hire (1, 10, ...), or BUY_MAX (-1) for as many as gold allows. All-or-nothing. */
  | { type: 'buyUnit'; unit: UnitId; amount: number }
  | { type: 'buyUpgrade'; id: string }
  | DebugAction;

export type GameEvent =
  | { type: 'strike'; damage: Decimal; crit: boolean; weak: boolean; stagger: boolean; aimed: boolean; x: number; y: number }
  /** A melee beat or a volley landing. hits = how many visible blows/arrows to show. */
  | { type: 'armyHit'; unit: UnitId; damage: Decimal; hits: number }
  /** Archers loosed; the matching 'armyHit' arrives `flight` seconds later (if the dragon lives). */
  | { type: 'volley'; unit: UnitId; arrows: number; flight: number }
  | { type: 'dragonSpawn'; id: number }
  | { type: 'dragonPhase'; id: number; phase: DragonPhase; dur: number }
  /** Kill reward (already added to gold); coins burst from the corpse. */
  | { type: 'dragonDeath'; id: number; gold: Decimal }
  /** Non-kill gold (already added to gold). */
  | { type: 'goldGain'; amount: Decimal; source: 'stagger' | 'other' }
  | { type: 'purchase'; kind: 'unit' | 'upgrade'; id: string; amount: number }
  | { type: 'unlock'; kind: 'unit' | 'upgrade' | 'feature'; id: string }
  | { type: 'milestone'; unit: UnitId; owned: number; mult: number }
  /** State changed wholesale (load, catch-up, debug jump): rebuild visuals from state, no juice. */
  | { type: 'resync' };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type Emit = (e: GameEvent) => void;
