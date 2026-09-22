import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AWAY_THRESHOLD, Loop, MAX_FRAME_DT } from './loop';
import { TimeDirector } from './time';
import type { Game } from './game';

class FakeDoc extends EventTarget {
  hidden = false;
}

let doc: FakeDoc;
let frameFn: ((now: number) => void) | null;

beforeEach(() => {
  doc = new FakeDoc();
  frameFn = null;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', (fn: (now: number) => void) => {
    frameFn = fn;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(): { loop: Loop; caught: number[]; frame: (ms: number) => void } {
  const caught: number[] = [];
  const game = {
    tick: () => undefined,
    drain: () => undefined,
    catchUp: (s: number) => {
      caught.push(s);
      return s;
    },
  } as unknown as Game;
  const loop = new Loop(game, new TimeDirector(), () => undefined);
  loop.start();
  return { loop, caught, frame: (ms) => frameFn!(ms) };
}

describe('Loop gap handling', () => {
  it('catches up a > 1 s gap after the tab was hidden', () => {
    const { caught, frame } = setup();
    frame(0);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    frame(5000);
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeCloseTo(5 - MAX_FRAME_DT, 6);
  });

  it('treats a visible main-thread stall as a clamped frame, not a catch-up', () => {
    const { loop, caught, frame } = setup();
    frame(0);
    frame(3000);
    expect(caught).toHaveLength(0);
    expect(loop.stats.frameMs).toBeCloseTo(3000, 6);
  });

  it('the hidden signal applies to one frame only', () => {
    const { caught, frame } = setup();
    frame(0);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    frame(16);
    frame(3016);
    expect(caught).toHaveLength(0);
  });

  it('a freeze/resume counts as away; a very long visible gap (sleep) still catches up', () => {
    const { caught, frame } = setup();
    frame(0);
    doc.dispatchEvent(new Event('resume'));
    frame(2000);
    frame(2000 + (AWAY_THRESHOLD + 1) * 1000);
    expect(caught).toHaveLength(2);
  });
});
