// Balance simulator CLI (WP 1.9). Plays the real core with three bot profiles over many seeds,
// prints a pacing table (median and worst seed), then PASS/FAIL per M1 target. Exits 1 on a FAIL.
//
//   npm run sim                                         all profiles, 20 seeds, table + targets
//   npm run sim -- --seeds 50                           more seeds
//   npm run sim -- --profile engaged --seed 3 --verbose one run's event timeline
//   npm run sim -- --profile casual --seed 3 --verbose --no-juice   the same at 1× logic time
import { PROFILES, PROFILE_NAMES } from './bots';
import type { ProfileName } from './bots';
import { runGame } from './play';
import type { RunResult } from './play';
import { clock } from './stats';
import { METRICS, checkTargets, metric, summarize } from './targets';

interface Args {
  profile?: ProfileName;
  seed?: number;
  seeds: number;
  verbose: boolean;
  juice: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { seeds: 20, verbose: false, juice: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--profile' && v) {
      if (!(PROFILE_NAMES as readonly string[]).includes(v)) throw new Error(`unknown profile "${v}" (${PROFILE_NAMES.join(', ')})`);
      a.profile = v as ProfileName;
      i++;
    } else if (k === '--seed' && v) {
      a.seed = Number(v);
      i++;
    } else if (k === '--seeds' && v) {
      a.seeds = Math.max(1, Number(v));
      i++;
    } else if (k === '--verbose' || k === '-v') a.verbose = true;
    else if (k === '--no-juice') a.juice = false;
    else throw new Error('unknown argument ' + k);
  }
  return a;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function lpad(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function verbose(args: Args): void {
  const p = PROFILES[args.profile ?? 'engaged'];
  const seed = args.seed ?? 1;
  console.log(`${p.name} seed ${seed} (${args.juice ? 'juice dilation on' : '1× logic time'}), ${p.seconds} s\n`);
  const r = runGame(p, seed, {
    juice: args.juice,
    log: (t, line) => console.log(`${lpad(clock(t), 5)} ${lpad(t.toFixed(1), 6)}  ${line}`),
  });
  console.log('');
  for (const m of METRICS) {
    if (m.only && !m.only.includes(p.name)) continue;
    console.log(`  ${pad(m.label, 28)} ${m.fmt(m.get(r))}`);
  }
}

interface Column {
  profile: ProfileName;
  juice: boolean;
  runs: RunResult[];
}

function table(cols: Column[]): void {
  const W = 20;
  const head = pad('', 28) + cols.map((c) => lpad(`${c.profile} ${c.juice ? 'juiced' : '1×'}`, W)).join('');
  console.log(head);
  console.log(pad('', 28) + cols.map(() => lpad('median (worst)', W)).join(''));
  for (const m of METRICS) {
    const cells = cols.map((c) => {
      if (m.only && !m.only.includes(c.profile)) return lpad('', W);
      const s = summarize(c.runs, m);
      return lpad(`${m.fmt(s.median)} (${m.fmt(s.worst)})`, W);
    });
    console.log(pad(m.label, 28) + cells.join(''));
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.verbose || args.seed !== undefined) {
    verbose(args);
    return;
  }
  const t0 = performance.now();
  const seeds = Array.from({ length: args.seeds }, (_, i) => i + 1);
  const profiles = args.profile ? [args.profile] : PROFILE_NAMES;
  const cols: Column[] = [];
  const juiced: Partial<Record<ProfileName, RunResult[]>> = {};
  for (const name of profiles) {
    const p = PROFILES[name];
    // Idle never clicks after the first newt, so its 1× and juiced runs barely differ, and the
    // non-aimer never crits: juiced only for both.
    const modes = name === 'idle' || name === 'nonAimer' ? [true] : [false, true];
    for (const juice of modes) {
      const runs = seeds.map((seed) => runGame(p, seed, { juice }));
      cols.push({ profile: name, juice, runs });
      if (juice) juiced[name] = runs;
    }
  }
  const ms = performance.now() - t0;
  console.log(`SCALE balance sim: ${seeds.length} seeds × ${profiles.join('/')} in ${(ms / 1000).toFixed(1)} s (wall-clock times; "juiced" = hit-stop + slow-mo cost logic time)\n`);
  table(cols);

  console.log('\nTargets (juiced runs):');
  const results = checkTargets(juiced);
  let fails = 0;
  for (const r of results) {
    const m = metric(r.target.metric);
    if (!r.ok) fails++;
    const range = r.target.lo !== undefined && r.target.hi !== undefined ? `${m.fmt(r.target.lo)}–${m.fmt(r.target.hi)}` : r.target.lo !== undefined ? `≥ ${m.fmt(r.target.lo)}` : `≤ ${m.fmt(r.target.hi!)}`;
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${pad(r.target.profile, 8)} ${pad(r.target.note, 46)} ${pad(r.target.stat, 7)} ${lpad(m.fmt(r.value), 9)}  (want ${range})`);
  }
  console.log(`\n${fails === 0 ? 'PASS' : 'FAIL'}: ${results.length - fails}/${results.length} targets met.`);
  if (fails > 0) process.exitCode = 1;
}

main();
