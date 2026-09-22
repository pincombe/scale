// applyAction: the only way anything outside core changes the game. Applied immediately;
// events go to the emit callback (the Game facade queues them until the next frame).
import { D } from './decimal';
import { PHASE, UNITS, upgradeDefOf } from './content';
import { addGold, damageDragon, killDragon, setPhase, spawnDragon, startWindup } from './dragon';
import { BUY_MAX, MAX_BUY, clickDamage, maxAffordable, staggerGold, unitCost, upgradeCost } from './formulas';
import { checkMilestones } from './progress';
import type { Action, DebugAction, DragonPhase, Emit, GameState } from './types';

export function applyAction(state: GameState, a: Action, emit: Emit): void {
  switch (a.type) {
    case 'strike':
      strike(state, a, emit);
      break;
    case 'buyUnit':
      buyUnit(state, a, emit);
      break;
    case 'buyUpgrade':
      buyUpgrade(state, a.id, emit);
      break;
    case 'debug':
      applyDebug(state, a, emit);
      break;
  }
}

function finite(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

function strike(state: GameState, a: Extract<Action, { type: 'strike' }>, emit: Emit): void {
  const d = state.dragon;
  if (d.phase === 'dying') return; // nothing to hit until the next dragon arrives
  const weak = a.weak === true;
  const damage = clickDamage(state, weak);
  // Same test as damageDragon (hp - damage > 0), so a blow that kills is never also a stagger, even
  // where break_infinity's compare and subtract round differently at huge HP.
  const lethal = !d.hp.sub(damage).gt(0) && !state.flags['debug.immortal'];
  // A weak-spot hit during the windup (the glowing throat) staggers: stunned, extra army damage
  // and a gold bonus. A killing blow just kills.
  const stagger = weak && d.phase === 'windup' && !lethal;
  state.stats.strikes++;
  if (weak) state.stats.crits++;
  emit({ type: 'strike', damage, crit: weak, weak, stagger, aimed: a.aimed === true, x: finite(a.x), y: finite(a.y) });
  damageDragon(state, damage, emit);
  if (stagger && state.dragon.phase !== 'dying') {
    state.stats.staggers++;
    const bonus = staggerGold(state);
    state.dragon.staggers++;
    addGold(state, bonus);
    emit({ type: 'goldGain', amount: bonus, source: 'stagger' });
    setPhase(state, 'stagger', PHASE.stagger, emit);
  }
}

/** Hire `amount` units (BUY_MAX = as many as gold allows). All-or-nothing: too little gold, no-op. */
function buyUnit(state: GameState, a: Extract<Action, { type: 'buyUnit' }>, emit: Emit): void {
  const def = UNITS[a.unit];
  if (!def || !state.flags[def.unlockFlag]) return;
  const amount = a.amount === BUY_MAX ? maxAffordable(state, a.unit) : Math.min(MAX_BUY, Math.floor(finite(a.amount)));
  if (!(amount >= 1)) return;
  const cost = unitCost(state, a.unit, amount);
  if (state.gold.lt(cost)) return;
  state.gold = state.gold.sub(cost);
  const before = state.units[a.unit];
  state.units[a.unit] = before + amount;
  emit({ type: 'purchase', kind: 'unit', id: a.unit, amount });
  checkMilestones(a.unit, before, before + amount, emit);
}

function buyUpgrade(state: GameState, id: string, emit: Emit): void {
  const def = upgradeDefOf(id);
  const cost = upgradeCost(id);
  if (!def || cost === null || (state.upgrades[id] ?? 0) > 0 || !state.flags[def.unlockFlag]) return;
  if (state.gold.lt(cost)) return;
  state.gold = state.gold.sub(cost);
  state.upgrades[id] = 1;
  emit({ type: 'purchase', kind: 'upgrade', id, amount: 1 });
}

function defaultDur(phase: DragonPhase): number {
  switch (phase) {
    case 'enter':
      return PHASE.enter;
    case 'idle':
      return PHASE.idleMax;
    case 'windup':
      return PHASE.windup;
    case 'breath':
      return PHASE.breath;
    case 'swipe':
      return PHASE.swipe;
    case 'stagger':
      return PHASE.stagger;
    case 'dying':
      return PHASE.dying;
  }
}

function applyDebug(state: GameState, a: DebugAction, emit: Emit): void {
  switch (a.op) {
    case 'gold': {
      const amount = finite(a.amount);
      if (amount <= 0) return;
      addGold(state, D(amount));
      emit({ type: 'goldGain', amount: D(amount), source: 'other' });
      break;
    }
    case 'kill':
      if (state.dragon.phase !== 'dying') killDragon(state, emit);
      break;
    case 'next':
      state.army.volleys.length = 0;
      spawnDragon(state, state.dragon.index + 1, emit);
      break;
    case 'dragon':
      state.army.volleys.length = 0;
      spawnDragon(state, Math.max(0, Math.floor(finite(a.amount))), emit);
      break;
    case 'units': {
      const def = UNITS[a.unit];
      const amount = Math.floor(finite(a.amount));
      if (!def || amount === 0) return;
      const before = state.units[a.unit];
      const after = Math.max(0, before + amount);
      state.units[a.unit] = after;
      if (!state.flags[def.unlockFlag]) {
        state.flags[def.unlockFlag] = true;
        emit({ type: 'unlock', kind: 'unit', id: a.unit });
      }
      if (after > before) {
        emit({ type: 'purchase', kind: 'unit', id: a.unit, amount: after - before });
        checkMilestones(a.unit, before, after, emit);
      }
      break;
    }
    case 'phase':
      if (a.phase === 'windup') startWindup(state, a.attack ?? 'breath', emit);
      else {
        if (a.attack) state.dragon.attack = a.attack;
        setPhase(state, a.phase, defaultDur(a.phase), emit);
      }
      break;
    case 'tier':
      state.tier = Math.max(0, Math.floor(finite(a.amount)));
      state.kills = 0;
      state.army.volleys.length = 0;
      spawnDragon(state, 0, emit);
      emit({ type: 'resync' });
      break;
    case 'flag':
      state.flags[a.flag] = a.value;
      break;
  }
}
