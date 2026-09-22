// Data-generated effect lines for upgrade cards ("Click damage ×2"). Never flavor text: the
// numbers come straight from UPGRADES[i].effect, so a balance retune rewrites the card.
import { UNITS, type UpgradeEffect } from '../core';

/** A multiplier as the player reads it: ×2, ×1.5, ×0.7. */
export function times(m: number): string {
  return '×' + String(Math.round(m * 100) / 100);
}

export function effectLine(e: UpgradeEffect): string {
  switch (e.kind) {
    case 'clickMult':
      return `Click damage ${times(e.mult)}`;
    case 'unitMult':
      return `${UNITS[e.unit].name} damage ${times(e.mult)}`;
    case 'armyMult':
      return `All army damage ${times(e.mult)}`;
    case 'weakMult':
      return `Weak-spot crits deal ${times(e.value)}`;
    case 'goldMult':
      return `Dragon gold ${times(e.mult)}`;
    case 'clickArmyShare':
      return `Each click adds ${Math.round(e.share * 1000) / 10}% of army DPS`;
    case 'periodMult': {
      const faster = Math.round((1 / e.mult - 1) * 100);
      return `${UNITS[e.unit].plural} attack ${faster}% faster`;
    }
  }
}

const ROMAN: readonly [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 1 → I, 4 → IV, 10 → X. */
export function roman(n: number): string {
  let out = '';
  let r = Math.max(1, Math.floor(n));
  for (const [v, s] of ROMAN) {
    while (r >= v) {
      out += s;
      r -= v;
    }
  }
  return out;
}
