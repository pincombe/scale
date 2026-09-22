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
  UnitId,
} from './types';
export { Decimal, D } from './decimal';
export { createInitialState, STATE_VERSION } from './state';
export { tick } from './tick';
export { applyAction } from './actions';
export { serialize, deserialize, toJSON, fromJSON } from './serialize';
export { fmt, setNotation, getNotation, type Notation } from './format';
export { TICK_DT, strikeDamage, unitDamage, unitCost, upgradeCost, milestoneMult } from './formulas';
export { UNITS, UNIT_IDS, UPGRADES, MILESTONES, PHASE, WEAK_MULT, type UnitDef, type UpgradeDef } from './content';
