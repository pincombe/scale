// Entrances and exits: no foot slides, for every species, boss and size. Each case is framed the
// way the in-tier director frames it (so the travel distances are the game's), runs the phase for
// core's duration, and checks every foot on the ground: planted feet stay put in the world, and the
// leg really reaches its planted foot (a foot the leg can't reach drags along visibly).
import { describe, expect, it } from 'vitest';
import { dragonEnterDuration } from '../../core/formulas';
import { CameraDirector, framing } from '../director';
import { Choreo, type ChoreoEnv } from './choreo';
import { enterStart, exitPath } from './moves';
import { C_AIR, C_FACE, C_RUN, DragonRig } from './rig';
import { buildIndividual, speciesOf } from './species';

const director = new CameraDirector({} as never);

interface Result {
  /** Worst world-space move of a planted foot in one frame, as a share of the body length. */
  slide: number;
  /** Worst gap between a grounded foot's leg and the foot, as a share of the leg's reach. */
  miss: number;
  /** Fastest gait clock used (Hz). */
  hz: number;
}

function play(species: string, boss: string | null, size: number, seed: number, phase: 'enter' | 'leave'): Result {
  const rig = new DragonRig();
  rig.setup(buildIndividual(speciesOf(species), seed, size, undefined, boss));
  rig.tempo = Math.min(1.25, Math.max(0.3, Math.pow(size, -0.3))) * (rig.ind.boss ? rig.ind.boss.tempo : 1);
  const b = { x: rig.restMinX * size, y: rig.restMinY * size, w: (rig.restMaxX - rig.restMinX) * size, h: (rig.restMaxY - rig.restMinY) * size };
  const f = director.frame(1100, 900, b, { x: -3, y: -1.9, w: 2.7, h: 1.9 }, framing());
  const edgeU = (f.x + 550 / f.zoom) / size;
  const topU = (director.groundFrac * 900) / f.zoom / size;
  const dur = dragonEnterDuration({ size, boss });
  const e: ChoreoEnv = { phase, attack: 'breath', k: 0, t: 0, dt: 1 / 60, time: 0, lookX: -1.5, lookY: -0.3, lookPull: 0.6, enterDist: 0, lunge: 0, aimX: -1.2, aimY: 0, dur, enterH: 0, exitDist: 0, exitH: 0, slamX: -0.1 };
  enterStart(edgeU, topU, e);
  exitPath(rig, edgeU, topU, e);
  const ch = new Choreo();
  ch.reset(seed);
  const px = new Float64Array(4);
  const py = new Float64Array(4).fill(-1);
  const ps = new Float64Array(4).fill(-1);
  let face = 1;
  const out: Result = { slide: 0, miss: 0, hz: 0 };
  const frames = Math.ceil(dur * 60);
  for (let i = 0; i <= frames; i++) {
    e.t = i / 60;
    e.k = Math.min(1, e.t / dur);
    e.time = e.t;
    ch.apply(rig, e);
    if (i === 0) {
      rig.ch.set(rig.target);
      rig.solveTargets();
      rig.snap();
    }
    rig.update(e.dt);
    ch.post(rig, e);
    const nf = rig.ch[C_FACE]!;
    // (The pace of a gait on the ground: a scurry through the air may paddle as fast as it likes.)
    if (rig.ch[C_RUN]! > 0.2 && rig.ch[C_AIR]! < 0.5) out.hz = Math.max(out.hz, rig.runHz);
    for (let k = 0; k < 4; k++) {
      if (!rig.legOn[k]) continue;
      const arm = rig.armWing && k < 2;
      const wx = rig.placeX(rig.footX[k]!);
      const wy = rig.footY[k]!;
      const grounded = wy >= rig.groundY - 1e-4 && !rig.legAir[k];
      // Planted in both frames (not the last frame of a step's arc), the dragon not mid-turn.
      if (i > 0 && grounded && ps[k]! < 0 && py[k]! >= rig.groundY - 1e-4 && Math.abs(nf - face) < 1e-4 && Math.abs(Math.abs(nf) - 1) < 1e-3) {
        out.slide = Math.max(out.slide, Math.abs(wx - px[k]!));
      }
      if (grounded && (!arm || rig.armLift[k]! < 0.01)) {
        const ty = rig.footY[k]! - rig.legR[k]! * (arm ? 0.8 : 0.55);
        const gap = Math.hypot(rig.ankX[k]! - rig.footX[k]!, rig.ankY[k]! - ty);
        out.miss = Math.max(out.miss, gap / (rig.legA[k]! + rig.legB[k]!));
      }
      px[k] = wx;
      py[k] = wy;
      ps[k] = rig.stepU[k]!;
    }
    face = nf;
  }
  return out;
}

const CASES: [string, string | null, number[]][] = [
  ['newt', null, [0.5, 3, 12, 40]],
  ['newt', 'elderNewt', [20, 30, 45]],
  ['wyvern', null, [0.8, 4, 15, 60]],
  ['wyvern', 'grimmaw', [60, 90, 127]],
];

describe('entrances and exits never slide a foot', () => {
  for (const [species, boss, sizes] of CASES) {
    for (const phase of ['enter', 'leave'] as const) {
      it(`${boss ?? species}: ${phase}`, () => {
        for (const size of sizes) {
          for (const seed of [7, 4242]) {
            const r = play(species, boss, size, seed, phase);
            // Planted feet: sub-millimetre numerics at most (1e-4 of the body length per frame).
            expect(r.slide).toBeLessThan(1e-4);
            // Legs reach their planted feet (the last frames of a wing folding allow ~1%).
            expect(r.miss).toBeLessThan(0.015);
            // Walks keep a believable pace (a heavy trot at most).
            expect(r.hz).toBeLessThan(6.01);
          }
        }
      });
    }
  }

  it('the Elder Newt walks at a stately pace, well under the gait clock limit', () => {
    for (const phase of ['enter', 'leave'] as const) expect(play('newt', 'elderNewt', 30, 7, phase).hz).toBeLessThan(4.2);
  });
});
