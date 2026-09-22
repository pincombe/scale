// Pacing smoke test: a scripted engaged player (6 clicks/s, 30% weak-spot hits, buys whenever it
// can) must roughly hit the M1 design targets. Loose on purpose: the balance sim (WP 1.9) owns the
// precise tuning with more profiles and seeds. Runs at 1× logic time (no hit-stop dilation).
import { describe, expect, it } from 'vitest';
import { serialize, toJSON } from './serialize';
import { ENGAGED, runBot } from './testing/bot';
import type { GameEvent } from './types';
import type { BotReport } from './testing/bot';

const SEEDS = [1, 2, 3];
const reports: BotReport[] = SEEDS.map((seed) => runBot(ENGAGED, 200, seed, [60, 120, 180, 195]));

describe('pacing (engaged player)', () => {
  it.each(SEEDS.map((seed, i) => [seed, reports[i]!] as const))('seed %i hits the first-minute beats', (_seed, r) => {
    expect(r.firstKill).toBeGreaterThan(0);
    expect(r.firstKill).toBeLessThanOrEqual(5);
    expect(r.firstBuyAt['footman']).toBeLessThanOrEqual(15);
    // The first upgrade is on offer well before 0:30.
    expect(r.unlockAt['upgrade.pointySwords']).toBeLessThanOrEqual(30);
    // Archers join around the one-minute mark.
    expect(r.unlockAt['unit.archer']).toBeGreaterThanOrEqual(35);
    expect(r.firstBuyAt['archer']).toBeLessThanOrEqual(80);
  });

  it.each(SEEDS.map((seed, i) => [seed, reports[i]!] as const))('seed %i grows newt → dog → horse → barn', (_seed, r) => {
    const [, m1, m2, m3] = r.sizeAtMinute;
    expect(m1).toBeGreaterThanOrEqual(0.7);
    expect(m1).toBeLessThanOrEqual(1.6);
    expect(m2).toBeGreaterThanOrEqual(1.8);
    expect(m2).toBeLessThanOrEqual(4);
    expect(m3).toBeGreaterThanOrEqual(6);
    expect(m3).toBeLessThanOrEqual(14);
    expect(r.killsAt[195]).toBeGreaterThanOrEqual(24);
    expect(r.killsAt[195]).toBeLessThanOrEqual(32);
    const size195 = r.state.dragon.size;
    expect(size195).toBeGreaterThanOrEqual(7);
    expect(size195).toBeLessThanOrEqual(16);
  });

  it.each(SEEDS.map((seed, i) => [seed, reports[i]!] as const))('seed %i never stalls and clicks stay relevant', (_seed, r) => {
    expect(r.longestBuyGap).toBeLessThanOrEqual(30);
    expect(r.staggers).toBeGreaterThan(0);
    // Active-leaning: an engaged player's clicks keep doing a real share of the damage.
    for (const share of r.clickShareByMinute) expect(share).toBeGreaterThan(0.25);
    // Every tier-0 upgrade gets bought before the boss (~3:15).
    for (const id of ['pointySwords', 'keenEye', 'drillSergeant', 'bounty', 'fletching', 'warHorns', 'heroicExample', 'quickNock', 'grindstone']) {
      expect(r.firstBuyAt[id], id).toBeLessThanOrEqual(195);
    }
  });
});

describe('pacing (other players still progress)', () => {
  it('a casual player (3 clicks/s, rarely aims, shops every 10 s) keeps killing', () => {
    const r = runBot({ clicksPerSec: 3, weakRate: 0.05, buyEvery: 10 }, 300, 1, [150, 300]);
    expect(r.killsAt[150]).toBeGreaterThanOrEqual(8);
    expect(r.killsAt[300]!).toBeGreaterThan(r.killsAt[150]! + 5);
  });

  it('an idle player (clicks 20 s, then shops once a minute) still makes progress', () => {
    const r = runBot({ clicksPerSec: 4, weakRate: 0, buyEvery: 60, clickUntil: 20 }, 600, 1, [120, 600]);
    expect(r.killsAt[600]!).toBeGreaterThan(r.killsAt[120]! + 5);
  });
});

describe('determinism with the full economy', () => {
  it('same seed + same player script => identical state and event stream', () => {
    const play = (): { state: string; events: string } => {
      const events: GameEvent[] = [];
      const r = runBot(ENGAGED, 150, 42, [], (e) => events.push(e));
      return { state: serialize(r.state), events: toJSON(events) };
    };
    const a = play();
    const b = play();
    expect(b.state).toBe(a.state);
    expect(b.events).toBe(a.events);
    expect(serialize(runBot(ENGAGED, 150, 43).state)).not.toBe(a.state);
  });
});
