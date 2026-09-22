// The metrics the sim tabulates and the M1 pacing targets it asserts (PLAN §2, §8; lead's M1
// design). Targets read the JUICED runs (hit-stop and slow-mo cost logic time, as in the game).
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
const pct = (x: number): string => Math.round(x * 100) + '%';
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
  { profile: 'engaged', metric: 'longestKillGap', stat: 'worst', hi: 20, note: 'no dead ends (a kill every ≤ 20 s)' },

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
  { profile: 'casual', metric: 'staggers', stat: 'median', lo: 2, note: 'lands a stagger now and then' },
  { profile: 'casual', metric: 'staggerGoldShare', stat: 'median', hi: 0.25, note: 'staggers are a bonus (≤ 25% of gold)' },
  { profile: 'casual', metric: 'longestNoveltyGap', stat: 'median', hi: 30, note: 'something new every ≤ 30 s (median run)' },
  { profile: 'casual', metric: 'longestUnaffordable', stat: 'worst', hi: 30, note: 'never > 30 s with nothing affordable' },
  { profile: 'casual', metric: 'longestKillGap', stat: 'worst', hi: 25, note: 'no dead ends (a kill every ≤ 25 s)' },

  // Non-aimer (5 clicks/s, never hits the weak spot, shops like the engaged player): pacing must
  // not hinge on aiming.
  { profile: 'nonAimer', metric: 'killPace', stat: 'median', hi: 9, note: '≤ 9 s per kill 0:40–2:00 without aiming' },
  { profile: 'nonAimer', metric: 'longestKillGap', stat: 'worst', hi: 20, note: 'no dead ends (a kill every ≤ 20 s)' },

  // Idle (clicks the first newt, then only shops once a minute): never stuck.
  { profile: 'idle', metric: 'firstKill', stat: 'worst', hi: 10, note: 'first kill (by clicking) ≤ 10 s' },
  { profile: 'idle', metric: 'kills5', stat: 'worst', lo: 8, note: 'progresses without clicks (≥ 8 kills by 5:00)' },
  { profile: 'idle', metric: 'idleGrowth', stat: 'worst', lo: 10, note: 'keeps killing 5:00 → 10:00 (≥ 10 kills)' },
  { profile: 'idle', metric: 'longestKillGap', stat: 'worst', hi: 60, note: 'a kill at least every minute (no dead ends)' },
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
