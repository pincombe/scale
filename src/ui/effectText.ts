// Data-generated effect lines for upgrade cards ("Click damage ×2") and heraldic charges ("All
// damage ×1.5"). Never flavor text: the numbers come straight from the effect data, so a balance
// retune rewrites the card. Plus the small text helpers the HUD shares (templates, heights, roman).
import { MICROCOPY, UNITS, type HeraldryEffect, type UpgradeEffect } from '../core';

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

// ---- M2: heraldry ----

/** A percentage as the player reads it: 0.15 → "15%". */
function pct(x: number): string {
  return String(Math.round(x * 1000) / 10) + '%';
}

/** What one level of a charge does ("All damage ×1.5 per level"). */
export function heraldryEffectLine(e: HeraldryEffect): string {
  switch (e.kind) {
    case 'damageMult':
      return `All damage ${times(e.mult)} per level`;
    case 'goldMult':
      return `Dragon gold ${times(e.mult)} per level`;
    case 'weakMult':
      return `Weak-spot crits ${times(e.mult)} per level`;
    case 'cooldownMult':
      return `Ability cooldowns −${pct(1 - e.mult)} per level`;
    case 'startUnits':
      return `+${e.count} ${UNITS[e.unit].plural} at the start of every tier, per level`;
    case 'fusionBonus':
      return `Fusion Bonus grows +${pct(e.add)} per level · next zoom`;
  }
}

/** What `level` levels of a charge add up to ("×2.25", "−28%", "+10 Footmen"); '' at level 0. */
export function heraldryTotal(e: HeraldryEffect, level: number): string {
  if (level <= 0) return '';
  switch (e.kind) {
    case 'damageMult':
    case 'goldMult':
    case 'weakMult':
      return times(Math.pow(e.mult, level));
    case 'cooldownMult':
      return '−' + pct(1 - Math.max(e.min, Math.pow(e.mult, level)));
    case 'startUnits':
      return `+${e.count * level} ${level * e.count === 1 ? UNITS[e.unit].name : UNITS[e.unit].plural}`;
    case 'fusionBonus':
      return '+' + pct(e.add * level);
  }
}

// ---- Shared text helpers ----

/** A MICROCOPY template with {name} slots filled from `vars` (the fallback when the key is missing). */
export function template(key: string, fallback: string, vars: Record<string, string>): string {
  const t = MICROCOPY[key] ?? fallback;
  return t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** 3 significant digits, grouped: 1.8, 224, 4.36, 12,300. */
function sig3(x: number): string {
  if (!(x > 0) || !Number.isFinite(x)) return '0';
  const p = Math.floor(Math.log10(x)) - 2;
  const r = Math.round(x / Math.pow(10, p)) * Math.pow(10, p);
  const digits = Math.max(0, -p);
  return r.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: Math.min(2, digits) });
}

/** A display height: "1.8 m", "224 m", "4.36 km", "12,300 km". */
export function heightText(m: number): string {
  if (!(m > 0) || !Number.isFinite(m)) return '—';
  return m < 1000 ? sig3(m) + ' m' : sig3(m / 1000) + ' km';
}
