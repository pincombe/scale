// The zoom (prestige), ARCHITECTURE §14: three stages driven by the cinematic.
//   begin    hold the economy; a fighting dragon leaves; fix the reward (zoom.pending); zoomBegin
//   switch   pay the reward and swap in the next tier (resets and keeps below); zoomSwitch, resync
//   end      play resumes; the new tier's dragon #0 makes its entrance; zoomEnd
// Actions in the wrong stage are no-ops. Core begins the first zoom of a save by itself when the
// first boss's death finishes (dragon.ts).
import { D } from './decimal';
import { UNITS, UNIT_IDS, CHAMPION_IDS, BALANCE, tierNumber } from './content';
import { enterDuration, canZoom, fusionForZoom, heightForZoom, scalesForZoom, towerUnits } from './formulas';
import { makeDragon, startLeave } from './dragon';
import { checkUnlocks } from './progress';
import type { Emit, GameState, ZoomStage } from './types';

export function applyZoom(state: GameState, stage: ZoomStage, emit: Emit): void {
  if (stage === 'begin') beginZoom(state, emit);
  else if (stage === 'switch') switchZoom(state, emit);
  else if (stage === 'end') endZoom(state, emit);
}

/** Stage 1: needs canZoom. Holds the economy, fixes the reward, sends a fighting dragon away. */
export function beginZoom(state: GameState, emit: Emit): void {
  if (!canZoom(state)) return;
  const pending = { scales: scalesForZoom(state), fusion: fusionForZoom(state), height: heightForZoom(state) };
  state.zoom.stage = 'begin';
  state.zoom.pending = pending;
  // Nothing in flight lands during a hold (the dragon is leaving; the next tier starts clean).
  state.army.volleys.length = 0;
  emit({ type: 'zoomBegin', from: state.tier, to: state.tier + 1, scales: pending.scales, fusion: pending.fusion, height: pending.height });
  const phase = state.dragon.phase;
  if (phase !== 'dying' && phase !== 'leave') startLeave(state, emit);
}

/** Stage 2 (render, after snapshotting the old tier): pay the reward and swap in the next tier. */
export function switchZoom(state: GameState, emit: Emit): void {
  const z = state.zoom;
  const p = z.pending;
  if (z.stage !== 'begin' || !p) return;
  state.scales = state.scales.add(p.scales);
  state.lifetimeScales = state.lifetimeScales.add(p.scales);
  z.fusion *= p.fusion;
  z.count++;
  enterTier(state, state.tier + 1, p.height);
  z.stage = 'switched';
  if (p.scales.gt(0)) emit({ type: 'scalesGain', amount: p.scales });
  emit({ type: 'zoomSwitch', tier: state.tier });
  emit({ type: 'resync' });
  // The new tier's unlocks (feature.heraldry, feature.scales, ability.charge, ability.rally).
  checkUnlocks(state, emit);
}

/** Stage 3 (render, after the reveal and the card): play resumes. */
export function endZoom(state: GameState, emit: Emit): void {
  const z = state.zoom;
  if (z.stage !== 'switched') return;
  z.stage = null;
  z.pending = null;
  emit({ type: 'zoomEnd', tier: state.tier });
}

/**
 * Swap in tier `tier` with the knights standing `height` display m tall. Resets gold, units (Tower
 * heraldry grants starting troops), army timers and anything in flight, kills, the Wyrm Gauge,
 * ability actives and cooldowns, champions' special timers; keeps upgrades, heraldry, champion
 * levels, Scales, stats, flags and lifetimeGold. The tier's dragon #0 waits at the start of its
 * entrance. Emits nothing (the caller follows with a resync). Also used by `debug tier`.
 */
export function enterTier(state: GameState, tier: number, height: number): void {
  state.tier = tier;
  state.height = height;
  state.gold = D(0);
  for (const id of UNIT_IDS) state.units[id] = 0;
  const tower = towerUnits(state);
  if (tower) state.units[tower.unit] += tower.count;
  state.kills = 0;
  state.wyrm = { charge: 0, bossT: 0, bossDur: 0, escapes: 0, cleared: false, clearedAt: 0 };
  for (const a of Object.values(state.abilities)) {
    a.active = 0;
    a.cooldown = 0;
  }
  for (const id of CHAMPION_IDS) state.champions[id].specialT = BALANCE.champions[id].specialEvery;
  state.army = { meleeT: UNITS.footman.interval, volleyT: UNITS.archer.interval, cavalryT: UNITS.lancer.interval, volleys: [] };
  const d = makeDragon(state, 0, 'enter', 0);
  d.phaseDur = enterDuration(d.size);
  state.dragon = d;
}

/** The knights' height on arriving in a tier without a zoom (debug jumps): the tier's baseHeight. */
export function baseHeightOf(tier: number): number {
  return tierNumber(tier, 'baseHeight');
}
