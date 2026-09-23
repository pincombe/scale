// The metrics the sim tabulates and the pacing targets it asserts (PLAN §2, §8; the lead's M1
// design and M2's judge's first 8 minutes, WP 2.7). Targets read the JUICED runs (hit-stop and
// slow-mo cost logic time, as in the game).
import type { ProfileName } from './bots';
import type { RunResult } from './play';
import { clock, max, median, min, never } from './stats';

export interface Metric {
  key: string;
  label: string;
  get: (r: RunResult) => number;
  /** Which direction is worse: 'max' for times and gaps, 'min' for progress. */
  worst: 'max' | 'min';
  fmt: (x: number) => string;
  /** Only shown for these profiles (default: all). */
  only?: ProfileName[];
}

const sec = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) + ' s' : 'never');
const mm = (x: number): string => clock(x);
const meters = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) + ' m' : '-');
const count = (x: number): string => (Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : '-');
const pct = (x: number): string => (Number.isFinite(x) ? Math.round(x * 100) + '%' : '-');
const ACTIVE: ProfileName[] = ['engaged', 'casual', 'nonAimer'];
const AIMERS: ProfileName[] = ['engaged', 'casual'];

export const METRICS: Metric[] = [
  { key: 'firstKill', label: 'first kill', get: (r) => never(r.firstKill), worst: 'max', fmt: sec },
  { key: 'firstFootman', label: 'first footman', get: (r) => never(r.firstFootman), worst: 'max', fmt: sec },
  { key: 'fifthKill', label: 'fifth kill', get: (r) => never(r.fifthKill), worst: 'max', fmt: sec },
  { key: 'kills60', label: 'kills @1:00', get: (r) => r.killsByMinute[0] ?? NaN, worst: 'min', fmt: count },
  { key: 'firstUpgradeBought', label: 'first upgrade bought', get: (r) => never(r.firstUpgradeBought), worst: 'max', fmt: sec },
  { key: 'archersUnlocked', label: 'archers unlocked', get: (r) => never(r.archersUnlocked), worst: 'max', fmt: mm },
  { key: 'firstArcher', label: 'first archer hired', get: (r) => never(r.firstArcher), worst: 'max', fmt: mm },
  { key: 'eyeOpens', label: 'eye first opens', get: (r) => never(r.eyeOpens), worst: 'max', fmt: mm },
  { key: 'eyeLead', label: 'eye opens before the boss by', get: (r) => (r.eyeOpens < 0 ? -Infinity : (r.firstBoss < 0 ? r.seconds : r.firstBoss) - r.eyeOpens), worst: 'min', fmt: sec },
  { key: 'size60', label: 'dragon size @1:00', get: (r) => r.sizeAt[0] ?? NaN, worst: 'min', fmt: meters },
  { key: 'size120', label: 'dragon size @2:00', get: (r) => r.sizeAt[1] ?? NaN, worst: 'min', fmt: meters },
  { key: 'size180', label: 'dragon size @3:00', get: (r) => r.sizeAt[2] ?? NaN, worst: 'min', fmt: meters },
  { key: 'killPace', label: 's per kill 0:40–2:00', get: (r) => r.killPace, worst: 'max', fmt: sec, only: ACTIVE },
  { key: 'killsAtBoss', label: 'kills @3:15', get: (r) => r.killsAtBoss, worst: 'min', fmt: count },
  { key: 'kills5', label: 'kills @5:00', get: (r) => r.killsByMinute[4] ?? NaN, worst: 'min', fmt: count, only: ['idle'] },
  { key: 'kills10', label: 'kills @10:00', get: (r) => r.killsByMinute[9] ?? NaN, worst: 'min', fmt: count, only: ['idle'] },
  { key: 'idleGrowth', label: 'kills 5:00 → 10:00', get: (r) => (r.killsByMinute[9] ?? NaN) - (r.killsByMinute[4] ?? NaN), worst: 'min', fmt: count, only: ['idle'] },
  { key: 'longestUnaffordable', label: 'longest nothing-affordable', get: (r) => r.longestUnaffordable, worst: 'max', fmt: sec },
  { key: 'longestNoveltyGap', label: 'longest gap w/o new thing', get: (r) => r.longestNoveltyGap, worst: 'max', fmt: sec },
  { key: 'longestBuyNoveltyGap', label: '  ... new thing to buy', get: (r) => r.longestBuyNoveltyGap, worst: 'max', fmt: sec },
  { key: 'novelties', label: 'new things (window)', get: (r) => r.novelties, worst: 'min', fmt: count },
  { key: 'purchasesPerMin', label: 'purchases / min', get: (r) => r.purchasesPerMin, worst: 'min', fmt: count },
  { key: 'longestKillGap', label: 'longest gap between kills', get: (r) => r.longestKillGap, worst: 'max', fmt: sec },
  { key: 'windups', label: 'windups (window)', get: (r) => r.windups, worst: 'min', fmt: count },
  { key: 'attacks', label: 'attacks seen (window)', get: (r) => r.attacks, worst: 'min', fmt: count },
  { key: 'staggers', label: 'staggers (window)', get: (r) => r.staggers, worst: 'min', fmt: count, only: AIMERS },
  { key: 'staggerGoldShare', label: 'stagger share of gold', get: (r) => r.staggerGoldShare, worst: 'max', fmt: pct, only: AIMERS },
  { key: 'clickShare', label: 'click share of damage', get: (r) => r.clickShare, worst: 'min', fmt: pct, only: ACTIVE },
  { key: 'shopping', label: 'time shopping (window)', get: (r) => r.shopping, worst: 'max', fmt: sec, only: ACTIVE },
  { key: 'dilation', label: 'logic / wall time', get: (r) => r.dilation, worst: 'min', fmt: (x) => x.toFixed(3) },
  // ---- M2 (WP 2.7): the Meadow's boss, the zoom, the Mountain, Grimmaw ----
  { key: 'firstBoss', label: 'M2: Elder Newt summoned', get: (r) => never(r.firstBoss), worst: 'max', fmt: mm },
  { key: 'firstBossFight', label: 'M2: Elder Newt fight', get: (r) => r.firstBossFight, worst: 'max', fmt: sec },
  { key: 'firstBossEscapes', label: 'M2: Elder Newt escapes', get: (r) => r.firstBossEscapes, worst: 'max', fmt: count },
  { key: 'firstBossKill', label: 'M2: Elder Newt beaten', get: (r) => never(r.firstBossKill), worst: 'max', fmt: mm },
  { key: 'firstZoom', label: 'M2: first zoom begins', get: (r) => never(r.firstZoom), worst: 'max', fmt: mm },
  { key: 'zoomScales', label: 'M2: Scales from zoom 1', get: (r) => r.zoomScales, worst: 'min', fmt: count },
  { key: 'zoomFusion', label: 'M2: Fusion Bonus zoom 1', get: (r) => r.zoomFusion, worst: 'min', fmt: (x) => (Number.isFinite(x) ? '×' + x.toFixed(2) : '-') },
  { key: 'zoomHeight', label: 'M2: Mountain knight height', get: (r) => r.zoomHeight, worst: 'min', fmt: (x) => (Number.isFinite(x) ? Math.round(x) + ' m' : '-') },
  { key: 'mountainFirstKill', label: 'M2: 1st wyvern falls (after)', get: (r) => r.mountainFirstKill, worst: 'max', fmt: sec },
  { key: 'armyBack', label: `M2: army back to 20 (after)`, get: (r) => r.armyBack, worst: 'max', fmt: sec },
  { key: 'lancersUnlocked', label: 'M2: lancers unlocked', get: (r) => never(r.lancersUnlocked), worst: 'max', fmt: mm },
  { key: 'volleyUnlocked', label: 'M2: Dragonbane Volley', get: (r) => never(r.volleyUnlocked), worst: 'max', fmt: mm },
  { key: 'brunhildJoins', label: 'M2: Dame Brunhild joins', get: (r) => never(r.brunhildJoins), worst: 'max', fmt: mm },
  { key: 'mountainNoveltyGap', label: 'M2: Mountain gap w/o new', get: (r) => (r.zoomEnd < 0 ? NaN : r.mountainNoveltyGap), worst: 'max', fmt: sec },
  { key: 'secondBoss', label: 'M2: Grimmaw summoned', get: (r) => never(r.secondBoss), worst: 'max', fmt: mm },
  { key: 'secondBossFight', label: 'M2: Grimmaw fight', get: (r) => r.secondBossFight, worst: 'max', fmt: sec },
  { key: 'secondBossEscapes', label: 'M2: Grimmaw escapes', get: (r) => r.secondBossEscapes, worst: 'max', fmt: count },
  { key: 'secondBossKill', label: 'M2: Grimmaw beaten', get: (r) => never(r.secondBossKill), worst: 'max', fmt: mm },
  { key: 'runKillGap', label: 'M2: longest kill gap (run)', get: (r) => r.runKillGap, worst: 'max', fmt: sec },
  { key: 'meadowClickShare', label: 'M2: Meadow clicks share', get: (r) => r.meadowClickShare, worst: 'min', fmt: pct, only: ACTIVE },
  { key: 'meadowChampShare', label: '  ... champions (Aldric on)', get: (r) => r.meadowChampShare, worst: 'max', fmt: pct },
  { key: 'mountainClickShare', label: 'M2: Mountain clicks share', get: (r) => r.mountainClickShare, worst: 'min', fmt: pct, only: ACTIVE },
  { key: 'mountainChampShare', label: '  ... champions', get: (r) => r.mountainChampShare, worst: 'max', fmt: pct },
  { key: 'bossEscapes', label: 'M2: boss escapes (run)', get: (r) => r.bossEscapes, worst: 'max', fmt: count },
  { key: 'scalesEarned', label: 'M2: Scales earned (run)', get: (r) => r.scalesEarned, worst: 'min', fmt: count },
];

const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function metric(key: string): Metric {
  const m = METRIC_BY_KEY.get(key);
  if (!m) throw new Error('unknown metric ' + key);
  return m;
}

export interface Summary {
  median: number;
  worst: number;
}

export function summarize(runs: readonly RunResult[], m: Metric): Summary {
  const xs = runs.map(m.get);
  return { median: median(xs), worst: m.worst === 'max' ? max(xs) : min(xs) };
}

export interface Target {
  profile: ProfileName;
  metric: string;
  /** Check the median over seeds, or the worst seed. */
  stat: 'median' | 'worst';
  lo?: number;
  hi?: number;
  /** Why this target (shown in the report). */
  note: string;
}

export const TARGETS: Target[] = [
  // Engaged (6 clicks/s, 30% weak spot, buys whenever sensible): the judge's first 3:15.
  { profile: 'engaged', metric: 'firstKill', stat: 'worst', hi: 5, note: 'first kill ≤ 5 s' },
  { profile: 'engaged', metric: 'firstFootman', stat: 'worst', hi: 8, note: 'first footman ≤ 8 s (design: ≤ 15 s)' },
  { profile: 'engaged', metric: 'firstUpgradeBought', stat: 'worst', hi: 30, note: 'first upgrade bought by 0:30' },
  { profile: 'engaged', metric: 'archersUnlocked', stat: 'median', lo: 50, hi: 75, note: 'archers by 50–75 s' },
  { profile: 'engaged', metric: 'archersUnlocked', stat: 'worst', hi: 90, note: 'archers by 1:30 on every seed' },
  { profile: 'engaged', metric: 'size60', stat: 'median', lo: 1.4, hi: 2.2, note: '~1.5–2 m (dog → pony) by 1:00' },
  { profile: 'engaged', metric: 'size120', stat: 'median', lo: 3.6, hi: 6, note: '~4–5 m (hay cart) by 2:00' },
  { profile: 'engaged', metric: 'size180', stat: 'median', lo: 9.5, hi: 14, note: '~10–13 m (barn) by 3:00' },
  { profile: 'engaged', metric: 'eyeOpens', stat: 'median', lo: 120, hi: 150, note: 'the eye opens in the mountain at 2:00–2:30 (PLAN §2; gauge ≥ 0.7, not before 2:00)' },
  { profile: 'engaged', metric: 'eyeLead', stat: 'worst', lo: 20, note: 'the eye opens ≥ 20 s before the boss on every seed' },
  { profile: 'engaged', metric: 'killsAtBoss', stat: 'median', lo: 25, hi: 32, note: '25–32 kills by 3:15' },
  { profile: 'engaged', metric: 'killsAtBoss', stat: 'worst', lo: 23, note: '≥ 23 kills by 3:15 on every seed' },
  { profile: 'engaged', metric: 'longestUnaffordable', stat: 'worst', hi: 30, note: 'never > 30 s with nothing affordable' },
  { profile: 'engaged', metric: 'longestNoveltyGap', stat: 'median', hi: 20, note: 'something new every ≤ 20 s (median run)' },
  { profile: 'engaged', metric: 'longestNoveltyGap', stat: 'worst', hi: 30, note: 'something new every ≤ 30 s (every run)' },
  { profile: 'engaged', metric: 'attacks', stat: 'median', lo: 8, note: 'sees ≥ 8 breaths/swipes by 3:15' },
  { profile: 'engaged', metric: 'attacks', stat: 'worst', lo: 6, note: 'sees ≥ 6 breaths/swipes on every seed' },
  { profile: 'engaged', metric: 'staggers', stat: 'median', lo: 5, note: 'lands ≥ 5 staggers by 3:15' },
  { profile: 'engaged', metric: 'staggerGoldShare', stat: 'median', hi: 0.25, note: 'staggers are a bonus (≤ 25% of gold)' },
  { profile: 'engaged', metric: 'clickShare', stat: 'median', lo: 0.4, hi: 0.6, note: 'clicks do 40–60% of the damage' },
  { profile: 'engaged', metric: 'longestKillGap', stat: 'worst', hi: 20, note: 'no dead ends to 4:00 (a kill every ≤ 20 s)' },
  // M2 (WP 2.7): the Elder Newt, the first zoom, the Mountain and Grimmaw (BUILD_LOG "M2 design
  // reference": the judge's first 8 minutes; PLAN §2: zooms at ~3:30 and ~7:30).
  { profile: 'engaged', metric: 'firstBoss', stat: 'median', lo: 180, hi: 195, note: 'the Elder Newt is summoned at 3:00–3:15' },
  { profile: 'engaged', metric: 'firstBossFight', stat: 'median', lo: 8, hi: 20, note: 'the Elder Newt fight (summon → kill) lasts 8–20 s' },
  { profile: 'engaged', metric: 'firstBossEscapes', stat: 'worst', hi: 0, note: 'the Elder Newt never escapes' },
  { profile: 'engaged', metric: 'firstZoom', stat: 'median', lo: 195, hi: 215, note: 'the first zoom begins at 3:15–3:35 (PLAN: ~3:30)' },
  { profile: 'engaged', metric: 'zoomScales', stat: 'median', lo: 4, hi: 7, note: 'the first zoom pays 2–3 first-level charges' },
  { profile: 'engaged', metric: 'mountainFirstKill', stat: 'median', hi: 4, note: 'the colossus fells the first wyvern ≤ 4 s after the zoom' },
  { profile: 'engaged', metric: 'armyBack', stat: 'median', hi: 60, note: 'the army is back to ≥ 20 units within 60 s' },
  { profile: 'engaged', metric: 'lancersUnlocked', stat: 'median', lo: 240, hi: 270, note: 'lancers at ~4:15' },
  { profile: 'engaged', metric: 'volleyUnlocked', stat: 'median', lo: 270, hi: 300, note: 'the Dragonbane Volley at ~4:45' },
  { profile: 'engaged', metric: 'brunhildJoins', stat: 'median', lo: 285, hi: 315, note: 'Dame Brunhild joins at ~5:00' },
  { profile: 'engaged', metric: 'mountainNoveltyGap', stat: 'worst', hi: 45, note: 'the Mountain: something new every ≤ 45 s' },
  { profile: 'engaged', metric: 'secondBoss', stat: 'median', lo: 405, hi: 445, note: 'Grimmaw is summoned at ~7:00–7:25 (incl. the full ~10.5 s zoom cinematic)' },
  { profile: 'engaged', metric: 'secondBossFight', stat: 'median', lo: 12, hi: 22, note: 'the Grimmaw fight lasts 12–22 s' },
  { profile: 'engaged', metric: 'secondBossEscapes', stat: 'worst', hi: 0, note: 'Grimmaw never escapes' },
  { profile: 'engaged', metric: 'secondBossKill', stat: 'median', lo: 435, hi: 465, note: 'Grimmaw falls at 7:15–7:45 (PLAN: zoom #2 ~7:30)' },
  { profile: 'engaged', metric: 'runKillGap', stat: 'worst', hi: 20, note: 'no dead ends to Grimmaw (a kill every ≤ 20 s)' },
  { profile: 'engaged', metric: 'meadowClickShare', stat: 'median', lo: 0.4, hi: 0.6, note: 'the Meadow: clicks do 40–60% of the damage' },
  { profile: 'engaged', metric: 'meadowChampShare', stat: 'median', lo: 0.05, hi: 0.15, note: 'the Meadow: champions do 5–15% (after Aldric)' },
  { profile: 'engaged', metric: 'mountainClickShare', stat: 'median', lo: 0.4, hi: 0.6, note: 'the Mountain: clicks do 40–60% (the army matters)' },
  { profile: 'engaged', metric: 'mountainChampShare', stat: 'median', lo: 0.08, hi: 0.2, note: 'the Mountain: champions do 8–20%' },

  // Casual (3 clicks/s, 10% weak spot, shops every 10 s): the same beats, somewhat later.
  { profile: 'casual', metric: 'firstKill', stat: 'worst', hi: 8, note: 'first kill ≤ 8 s' },
  { profile: 'casual', metric: 'firstFootman', stat: 'worst', hi: 10, note: 'first footman ≤ 10 s' },
  { profile: 'casual', metric: 'fifthKill', stat: 'median', hi: 45, note: 'a snappy first minute (5th kill ≤ 45 s)' },
  { profile: 'casual', metric: 'firstUpgradeBought', stat: 'worst', hi: 45, note: 'first upgrade bought by 0:45' },
  { profile: 'casual', metric: 'size60', stat: 'median', lo: 0.85, hi: 1.3, note: '~1 m (dog) by 1:00' },
  { profile: 'casual', metric: 'size120', stat: 'median', lo: 2, hi: 3.2, note: '~2.5 m (horse) by 2:00' },
  { profile: 'casual', metric: 'archersUnlocked', stat: 'median', hi: 135, note: 'archers by ~2:00' },
  { profile: 'casual', metric: 'killsAtBoss', stat: 'median', lo: 18, note: '18+ kills by 3:15' },
  { profile: 'casual', metric: 'attacks', stat: 'median', lo: 5, note: 'sees ≥ 5 breaths/swipes by 3:15' },
  { profile: 'casual', metric: 'eyeLead', stat: 'worst', lo: 30, note: 'the eye opens ≥ 30 s before the boss on every seed (time fallback)' },
  { profile: 'casual', metric: 'staggers', stat: 'median', lo: 2, note: 'lands a stagger now and then' },
  { profile: 'casual', metric: 'staggerGoldShare', stat: 'median', hi: 0.25, note: 'staggers are a bonus (≤ 25% of gold)' },
  { profile: 'casual', metric: 'longestNoveltyGap', stat: 'median', hi: 30, note: 'something new every ≤ 30 s (median run)' },
  { profile: 'casual', metric: 'longestUnaffordable', stat: 'worst', hi: 30, note: 'never > 30 s with nothing affordable' },
  { profile: 'casual', metric: 'longestKillGap', stat: 'worst', hi: 25, note: 'no dead ends to 4:00 (a kill every ≤ 25 s)' },
  { profile: 'casual', metric: 'firstZoom', stat: 'median', hi: 300, note: 'the first zoom begins by 5:00 (PLAN §8)' },
  { profile: 'casual', metric: 'firstZoom', stat: 'worst', hi: 320, note: 'the first zoom begins by 5:20 on every seed' },
  { profile: 'casual', metric: 'firstBossEscapes', stat: 'worst', hi: 1, note: 'the Elder Newt escapes at most once' },
  { profile: 'casual', metric: 'secondBossKill', stat: 'worst', hi: 1200, note: 'beats Grimmaw on every seed (within 20 min)' },
  { profile: 'casual', metric: 'meadowChampShare', stat: 'median', hi: 0.3, note: 'the Meadow: champions ≤ 30% (after Aldric)' },
  { profile: 'casual', metric: 'mountainChampShare', stat: 'median', hi: 0.3, note: 'the Mountain: champions ≤ 30%' },
  { profile: 'casual', metric: 'runKillGap', stat: 'worst', hi: 30, note: 'no dead ends to Grimmaw (a kill every ≤ 30 s)' },

  // Non-aimer (5 clicks/s, never hits the weak spot, shops like the engaged player): pacing must
  // not hinge on aiming.
  { profile: 'nonAimer', metric: 'killPace', stat: 'median', hi: 9, note: '≤ 9 s per kill 0:40–2:00 without aiming' },
  { profile: 'nonAimer', metric: 'longestKillGap', stat: 'worst', hi: 20, note: 'no dead ends to 4:00 (a kill every ≤ 20 s)' },
  { profile: 'nonAimer', metric: 'secondBossKill', stat: 'worst', hi: 1200, note: 'beats both bosses on every seed (within 20 min)' },
  { profile: 'nonAimer', metric: 'runKillGap', stat: 'worst', hi: 30, note: 'no dead ends to Grimmaw (a kill every ≤ 30 s)' },

  // Idle (clicks the first newt, then only shops once a minute): never stuck.
  { profile: 'idle', metric: 'firstKill', stat: 'worst', hi: 10, note: 'first kill (by clicking) ≤ 10 s' },
  { profile: 'idle', metric: 'kills5', stat: 'worst', lo: 8, note: 'progresses without clicks (≥ 8 kills by 5:00)' },
  { profile: 'idle', metric: 'idleGrowth', stat: 'worst', lo: 10, note: 'keeps killing 5:00 → 10:00 (≥ 10 kills)' },
  { profile: 'idle', metric: 'longestKillGap', stat: 'worst', hi: 60, note: 'a kill every ≤ 60 s over its whole 30-min run' },
  { profile: 'idle', metric: 'firstBossKill', stat: 'worst', hi: 1800, note: 'beats the Elder Newt within 30 minutes' },
];

export interface TargetResult {
  target: Target;
  value: number;
  ok: boolean;
}

/** Check every target whose profile has runs (a single-profile sim checks only its own). */
export function checkTargets(runs: Partial<Record<ProfileName, readonly RunResult[]>>): TargetResult[] {
  const out: TargetResult[] = [];
  for (const t of TARGETS) {
    const rs = runs[t.profile];
    if (!rs || rs.length === 0) continue;
    const s = summarize(rs, metric(t.metric));
    const value = t.stat === 'median' ? s.median : s.worst;
    const ok = Number.isFinite(value) && (t.lo === undefined || value >= t.lo) && (t.hi === undefined || value <= t.hi);
    out.push({ target: t, value, ok });
  }
  return out;
}
