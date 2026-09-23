// Progressive disclosure: unlock flags (state.flags) and milestone events.
// The first minute is just the meadow, a dragon, a counter and one button; everything else
// appears when it first matters. Flags never turn off. Rules run in order once per tick, so a
// rule may depend on flags set earlier in the same pass (feature.panel is last).
//
//   feature.dragonBar   first strike lands            → the dragon's name + HP bar appear
//   feature.gold        first gold earned             → the gold counter appears
//   unit.<id>           UNITS[id].unlock is met        → footman after the first kill, archer ~1:00
//   upgrade.<id>        UPGRADES[id].unlock is met     → the upgrade appears in the panel
//   feature.panel       2+ things unlocked to buy      → the Army/Upgrades panel opens (before that,
//                                                        the UI shows one "Hire a Footman" button)
// M2 (after those):
//   champion.<id>       CHAMPIONS[id].unlock is met    → the champion joins (level 1, championJoin)
//   feature.scales      tier ≥ 1 or any Scales earned  → the Scales counter appears
//   feature.heraldry    the same                       → the Heraldry tab opens
//   ability.<id>        ABILITIES[id].unlock is met    → charge + rally on arriving in the Mountain,
//                                                        volley at its 10th kill
// Requirements may carry a minimum tier (lancers and the Mountain's upgrades: tier 1).
import { ABILITIES, ABILITY_IDS, BALANCE, CHAMPIONS, CHAMPION_IDS, UNITS, UNIT_IDS, UPGRADES } from './content';
import { milestoneAt, milestoneCount } from './formulas';
import type { Requirement } from './content';
import type { ChampionId, Emit, GameEvent, GameState, UnitId } from './types';

type UnlockKind = Extract<GameEvent, { type: 'unlock' }>['kind'];

interface UnlockRule {
  flag: string;
  kind: UnlockKind;
  id: string;
  when: (s: GameState) => boolean;
  /** Runs when the flag is set, before its unlock event (a champion joining). */
  then?: (s: GameState, emit: Emit) => void;
}

/** Current value of a requirement's stat. */
export function requirementValue(s: GameState, r: Requirement): number {
  return r.stat === 'kills' ? s.kills : s.units[r.stat];
}

/** The requirement's minimum tier is reached (none = any tier). */
export function requirementTierMet(s: GameState, r: Requirement): boolean {
  return r.tier === undefined || s.tier >= r.tier;
}

export function requirementMet(s: GameState, r: Requirement): boolean {
  return requirementTierMet(s, r) && requirementValue(s, r) >= r.at;
}

/** A champion joins: level 1, free, its special timer starts. */
function championJoins(id: ChampionId): (s: GameState, emit: Emit) => void {
  return (s, emit) => {
    const c = s.champions[id];
    if (c.level < 1) c.level = 1;
    c.specialT = BALANCE.champions[id].specialEvery;
    emit({ type: 'championJoin', id });
  };
}

/** Scales exist in this save: the first zoom has happened (or debug granted some). */
function scalesEra(s: GameState): boolean {
  return s.tier >= 1 || s.lifetimeScales.gt(0);
}

/** Unit + upgrade entries currently revealed (owned upgrades included). */
export function buyablesUnlocked(s: GameState): number {
  let n = 0;
  for (const id of UNIT_IDS) if (s.flags[UNITS[id].unlockFlag]) n++;
  for (const u of UPGRADES) if (s.flags[u.unlockFlag]) n++;
  return n;
}

/** Buyable entries revealed before the panel opens (the lone "Hire a Footman" button). */
export const PANEL_AT_BUYABLES = 2;

function buildRules(): UnlockRule[] {
  const rules: UnlockRule[] = [
    { flag: 'feature.dragonBar', kind: 'feature', id: 'dragonBar', when: (s) => s.stats.strikes > 0 || s.kills > 0 },
    { flag: 'feature.gold', kind: 'feature', id: 'gold', when: (s) => s.lifetimeGold.gt(0) },
  ];
  for (const id of UNIT_IDS) {
    const def = UNITS[id];
    rules.push({ flag: def.unlockFlag, kind: 'unit', id, when: (s) => requirementMet(s, def.unlock) });
  }
  for (const u of UPGRADES) {
    rules.push({ flag: u.unlockFlag, kind: 'upgrade', id: u.id, when: (s) => requirementMet(s, u.unlock) });
  }
  rules.push({ flag: 'feature.panel', kind: 'feature', id: 'panel', when: (s) => buyablesUnlocked(s) >= PANEL_AT_BUYABLES });
  // ---- M2 ----
  for (const id of CHAMPION_IDS) {
    const def = CHAMPIONS[id];
    rules.push({ flag: def.unlockFlag, kind: 'champion', id, when: (s) => requirementMet(s, def.unlock), then: championJoins(id) });
  }
  rules.push({ flag: 'feature.scales', kind: 'feature', id: 'scales', when: scalesEra });
  rules.push({ flag: 'feature.heraldry', kind: 'feature', id: 'heraldry', when: scalesEra });
  for (const id of ABILITY_IDS) {
    const def = ABILITIES[id];
    rules.push({ flag: def.unlockFlag, kind: 'ability', id, when: (s) => requirementMet(s, def.unlock) });
  }
  return rules;
}

const RULES: readonly UnlockRule[] = buildRules();

/** Every flag the core can set, in unlock order (for docs, UI and tests). */
export const UNLOCK_FLAGS: readonly string[] = RULES.map((r) => r.flag);

export function checkUnlocks(state: GameState, emit: Emit): void {
  for (const r of RULES) {
    if (state.flags[r.flag] || !r.when(state)) continue;
    state.flags[r.flag] = true;
    r.then?.(state, emit);
    emit({ type: 'unlock', kind: r.kind, id: r.id });
  }
}

/** Most milestone events one purchase emits (the highest ones, for absurd bulk buys). */
const MAX_MILESTONE_EVENTS = 8;

/** Emit a milestone event for every threshold crossed going from `before` to `after` owned. */
export function checkMilestones(unit: UnitId, before: number, after: number, emit: Emit): void {
  const from = milestoneCount(before);
  const to = milestoneCount(after);
  for (let k = Math.max(from, to - MAX_MILESTONE_EVENTS); k < to; k++) {
    emit({ type: 'milestone', unit, owned: milestoneAt(k), mult: BALANCE.milestones.mult });
  }
}
