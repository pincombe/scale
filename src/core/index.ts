// Public surface of the core. Other folders import from 'core' (this file) or core/decimal,
// core/format, core/content, core/formulas. Everything in core is pure: no DOM, canvas, audio.
export type {
  Action,
  DebugAction,
  DragonAttack,
  DragonPhase,
  DragonState,
  Emit,
  EventOf,
  GameEvent,
  GameEventType,
  GameState,
  Stats,
  UnitId,
  UpgradeId,
} from './types';
export { Decimal, D } from './decimal';
export { createInitialState, STATE_VERSION } from './state';
export { tick } from './tick';
export { applyAction } from './actions';
export { serialize, deserialize, toJSON, fromJSON } from './serialize';
export { fmt, setNotation, getNotation, type Notation } from './format';
export {
  TICK_DT,
  BUY_MAX,
  MAX_BUY,
  strikeDamage,
  clickDamage,
  unitDamage,
  unitDps,
  armyDps,
  unitCost,
  maxAffordable,
  upgradeCost,
  milestoneMult,
  milestoneCount,
  milestoneAt,
  unitPeriod,
  weakMult,
  killGold,
  staggerGold,
  dragonMaxHp,
  dragonGold,
  dragonSize,
  wholeCeil,
  wholeNumber,
} from './formulas';
export {
  BALANCE,
  MICROCOPY,
  UNITS,
  UNIT_IDS,
  UPGRADES,
  UPGRADE_IDS,
  PHASE,
  sizeWord,
  upgradeDefOf,
  type UnitDef,
  type UpgradeDef,
  type UpgradeEffect,
  type Requirement,
} from './content';
export { UNLOCK_FLAGS } from './progress';
export { ENTER_WEAK_FROM, phaseProgress, weakSpotFor, weakSpotHittable, weakSpotLive, type WeakSpotKind } from './weakspot';
export * as sel from './selectors';
