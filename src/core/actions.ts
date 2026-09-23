// applyAction: the only way anything outside core changes the game. Applied immediately;
// events go to the emit callback (the Game facade queues them until the next frame).
import { D } from './decimal';
import { CHARGES, PHASE, TIERS, UNITS, upgradeDefOf } from './content';
import { useAbility } from './abilities';
import { addGold, damageDragon, dragonHittable, killDragon, setPhase, spawnDragon, startWindup } from './dragon';
import {
  BUY_MAX,
  MAX_BUY,
  bossAt,
  canZoom,
  championCost,
  championLevelsLeft,
  championMaxAffordable,
  clickDamage,
  dragonDyingDuration,
  dragonEnterDuration,
  enterDuration,
  heraldryCost,
  maxAffordable,
  staggerGold,
  unitCost,
  upgradeCost,
} from './formulas';
import { checkMilestones, checkUnlocks } from './progress';
import { weakSpotHittable } from './weakspot';
import { applyZoom, baseHeightOf, beginZoom, enterTier } from './zoom';
import type { Action, ChampionId, ChargeId, DebugAction, DragonPhase, Emit, GameState } from './types';

/** A zoom's cinematic is playing: strikes, purchases and abilities are ignored. */
function holding(state: GameState): boolean {
  return state.zoom.stage !== null;
}

export function applyAction(state: GameState, a: Action, emit: Emit): void {
  switch (a.type) {
    case 'strike':
      if (!holding(state)) strike(state, a, emit);
      break;
    case 'buyUnit':
      if (!holding(state)) buyUnit(state, a, emit);
      break;
    case 'buyUpgrade':
      if (!holding(state)) buyUpgrade(state, a.id, emit);
      break;
    case 'zoom':
      applyZoom(state, a.stage, emit);
      break;
    case 'buyHeraldry':
      if (!holding(state)) buyHeraldry(state, a.id, emit);
      break;
    case 'useAbility':
      if (!holding(state) && state.abilities[a.id]) useAbility(state, a.id, emit);
      break;
    case 'levelChampion':
      if (!holding(state)) levelChampion(state, a, emit);
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
  if (!dragonHittable(d.phase)) return; // nothing to hit until the next dragon arrives
  // Core has the last word on the weak spot: a weak click while none is live (the dragon is still
  // arriving) is a plain hit, and the event says so.
  const weak = a.weak === true && weakSpotHittable(d);
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

/** Spend Scales on the next level of a heraldic charge (needs feature.heraldry). */
function buyHeraldry(state: GameState, id: ChargeId, emit: Emit): void {
  if (!CHARGES[id] || !state.flags['feature.heraldry']) return;
  const cost = heraldryCost(state, id);
  if (state.scales.lt(cost)) return;
  state.scales = state.scales.sub(cost);
  const h = state.heraldry;
  if (h.levels[id] <= 0 && !h.order.includes(id)) h.order.push(id);
  h.levels[id]++;
  emit({ type: 'purchase', kind: 'heraldry', id, amount: 1 });
  // Tower also musters its troops at once (the level just bought's share), besides the grant at
  // the start of every tier, so the first Scales spent on it show on the field.
  const e = CHARGES[id].effect;
  if (e.kind === 'startUnits' && e.count > 0) {
    const before = state.units[e.unit];
    state.units[e.unit] = before + e.count;
    checkMilestones(e.unit, before, before + e.count, emit);
  }
}

/** Buy `amount` levels of a joined champion (BUY_MAX = as many as gold allows). All-or-nothing. */
function levelChampion(state: GameState, a: Extract<Action, { type: 'levelChampion' }>, emit: Emit): void {
  const c = state.champions[a.id as ChampionId];
  if (!c || c.level <= 0) return;
  const amount = a.amount === BUY_MAX ? championMaxAffordable(state, a.id) : Math.min(MAX_BUY, Math.floor(finite(a.amount)));
  if (!(amount >= 1) || amount > championLevelsLeft(state, a.id)) return;
  const cost = championCost(state, a.id, amount);
  if (state.gold.lt(cost)) return;
  state.gold = state.gold.sub(cost);
  c.level += amount;
  emit({ type: 'purchase', kind: 'champion', id: a.id, amount });
}

function defaultDur(state: GameState, phase: DragonPhase): number {
  switch (phase) {
    case 'enter':
      return dragonEnterDuration(state.dragon);
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
      return dragonDyingDuration(state.dragon);
    case 'leave':
      return dragonEnterDuration(state.dragon);
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
      if (dragonHittable(state.dragon.phase)) killDragon(state, emit);
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
        setPhase(state, a.phase, defaultDur(state, a.phase), emit);
      }
      break;
    case 'tier': {
      // Like a zoom without the cinematic or the reward: the tier's base height, the resets, the
      // tier's unlocks, a resync. Counts as having zoomed there (no automatic first zoom later).
      const tier = Math.max(0, Math.min(TIERS.length - 1, Math.floor(finite(a.amount))));
      state.zoom.stage = null;
      state.zoom.pending = null;
      state.zoom.count = Math.max(state.zoom.count, tier);
      enterTier(state, tier, baseHeightOf(tier));
      emit({ type: 'resync' });
      checkUnlocks(state, emit);
      break;
    }
    case 'flag':
      state.flags[a.flag] = a.value;
      break;
    case 'boss':
      // Fill the gauge: the boss comes after the current dragon.
      state.wyrm.cleared = false;
      state.wyrm.charge = bossAt(state.tier);
      break;
    case 'cleared': {
      // The tier's boss counts as beaten; a save that has never zoomed begins its zoom at once.
      const w = state.wyrm;
      if (w.cleared) break;
      w.cleared = true;
      w.clearedAt = state.kills;
      w.bossT = 0;
      if (state.zoom.count === 0 && canZoom(state)) beginZoom(state, emit);
      break;
    }
    case 'scales': {
      const amount = Math.floor(finite(a.amount));
      if (amount <= 0) return;
      state.scales = state.scales.add(amount);
      state.lifetimeScales = state.lifetimeScales.add(amount);
      emit({ type: 'scalesGain', amount: D(amount) });
      checkUnlocks(state, emit);
      break;
    }
  }
}
