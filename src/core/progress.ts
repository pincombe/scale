// Progressive disclosure: unlock flags and milestone events (placeholder rules, WP 1.5 retunes).
import { MILESTONES } from './content';
import type { Emit, GameEvent, GameState, UnitId } from './types';

type UnlockKind = Extract<GameEvent, { type: 'unlock' }>['kind'];

interface UnlockRule {
  flag: string;
  kind: UnlockKind;
  id: string;
  when: (s: GameState) => boolean;
}

const RULES: readonly UnlockRule[] = [
  { flag: 'unit.footman', kind: 'unit', id: 'footman', when: (s) => s.kills >= 1 },
  { flag: 'feature.panel', kind: 'feature', id: 'panel', when: (s) => s.kills >= 1 },
  { flag: 'upgrade.pointySwords', kind: 'upgrade', id: 'pointySwords', when: (s) => s.units.footman >= 1 },
  { flag: 'upgrade.whetstone', kind: 'upgrade', id: 'whetstone', when: (s) => s.kills >= 3 },
  { flag: 'unit.archer', kind: 'unit', id: 'archer', when: (s) => s.lifetimeGold.gte(150) },
  { flag: 'upgrade.fletching', kind: 'upgrade', id: 'fletching', when: (s) => s.units.archer >= 1 },
];

export function checkUnlocks(state: GameState, emit: Emit): void {
  for (const r of RULES) {
    if (state.flags[r.flag] || !r.when(state)) continue;
    state.flags[r.flag] = true;
    emit({ type: 'unlock', kind: r.kind, id: r.id });
  }
}

/** Emit a milestone event for every threshold crossed going from `before` to `after` owned. */
export function checkMilestones(unit: UnitId, before: number, after: number, emit: Emit): void {
  for (const m of MILESTONES) {
    if (before < m && after >= m) emit({ type: 'milestone', unit, owned: m, mult: 2 });
  }
}
