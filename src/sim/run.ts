// Headless smoke run of the real core (placeholder until the balance sim WP 1.9 replaces it).
// A simple bot clicks 5x/s (every 6th click on the weak spot) and buys the cheapest thing it can
// every 2 s, for 5 simulated minutes. Proves the core runs in Node and prints a pacing snapshot.
import { applyAction, createInitialState, fmt, tick, TICK_DT, UNIT_IDS, UNITS, UPGRADES, unitCost, upgradeCost } from '../core';
import type { Action, GameEvent, GameState } from '../core';

const SECONDS = 5 * 60;

function cheapestBuy(s: GameState): Action | null {
  let best: Action | null = null;
  let bestCost = Infinity;
  for (const id of UNIT_IDS) {
    if (!s.flags[UNITS[id].unlockFlag]) continue;
    const c = unitCost(s, id).toNumber();
    if (c < bestCost && s.gold.gte(c)) {
      bestCost = c;
      best = { type: 'buyUnit', unit: id, amount: 1 };
    }
  }
  for (const u of UPGRADES) {
    if ((s.upgrades[u.id] ?? 0) > 0 || !s.flags['upgrade.' + u.id]) continue;
    const c = upgradeCost(u.id)!.toNumber();
    if (c < bestCost && s.gold.gte(c)) {
      bestCost = c;
      best = { type: 'buyUpgrade', id: u.id };
    }
  }
  return best;
}

const t0 = performance.now();
const s = createInitialState(12345);
let firstKill = -1;
let events = 0;
const emit = (e: GameEvent): void => {
  events++;
  if (e.type === 'dragonDeath' && firstKill < 0) firstKill = s.t;
};
const ticks = Math.round(SECONDS / TICK_DT);
for (let i = 0; i < ticks; i++) {
  if (i % 4 === 0) applyAction(s, { type: 'strike', weak: i % 24 === 0, aimed: true, x: 0, y: 0 }, emit);
  if (i % 40 === 0) {
    for (let k = 0; k < 5; k++) {
      const a = cheapestBuy(s);
      if (!a) break;
      applyAction(s, a, emit);
    }
  }
  tick(s, TICK_DT, emit);
}
const ms = performance.now() - t0;

console.log(`sim smoke: ${SECONDS}s simulated in ${ms.toFixed(0)} ms (${ticks} ticks, ${events} events)`);
console.log(`  first kill at ${firstKill.toFixed(1)} s; ${s.kills} kills; dragon #${s.dragon.index} (${s.dragon.size.toFixed(1)} m, ${fmt(s.dragon.maxHp)} HP)`);
console.log(`  gold ${fmt(s.gold)} (lifetime ${fmt(s.lifetimeGold)}); ${s.units.footman} footmen, ${s.units.archer} archers`);
if (firstKill < 0 || s.kills < 5) {
  console.error('sim smoke: FAIL (the bot made no progress)');
  process.exit(1);
}
