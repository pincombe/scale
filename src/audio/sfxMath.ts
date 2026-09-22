// Pure SFX helpers (no WebAudio): scale tuning, size → voice mapping, polyphony / rate limiting,
// the rising coin run. Kept DOM-free so they are unit-tested in Node.

/** D major pentatonic, semitones above the root. Coins, chimes, pings and clang roots use it. */
const PENTA = [0, 2, 4, 7, 9] as const;
/** MIDI note of the scale root for step 0 (D4). */
export const PENTA_ROOT = 62;

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** Frequency of the `step`-th note of the pentatonic scale (step 0 = D4, 5 = D5, ...). */
export function pentaHz(step: number, rootMidi = PENTA_ROOT): number {
  const s = Math.floor(step);
  const oct = Math.floor(s / 5);
  const deg = s - oct * 5;
  return midiToHz(rootMidi + oct * 12 + PENTA[deg]!);
}

/**
 * Dragon size (m, body length) → 0..1 voice size. 0 = newt (0.5 m, squeaks), 1 = barn-sized and up
 * (10 m+, rumbles). Log-scaled so every step up the tier is audible.
 */
export function voiceSize(sizeM: number): number {
  if (!(sizeM > 0)) return 0;
  const v = Math.log(sizeM / 0.5) / Math.log(20);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Geometric interpolation (for frequencies and times). */
export function expLerp(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

/** Screen x (CSS px) → a subtle stereo pan in [-width, width]. */
export function panFor(screenX: number, stageCX: number, stageW: number, width = 0.55): number {
  if (!Number.isFinite(screenX) || stageW <= 0) return 0;
  const p = ((screenX - stageCX) / (stageW * 0.5)) * width;
  return p < -width ? -width : p > width ? width : p;
}

export interface VoiceCap {
  /** Max overlapping voices in this category. */
  max: number;
  /** Merge window: a request within this many seconds of the last accepted one is dropped. */
  gap: number;
}

/**
 * Per-category polyphony and rate limiter. `tryStart` is called with the audio clock; it accepts a
 * voice (recording when it ends) or rejects it when the category is full or the last voice started
 * inside the merge window. Allocation-free after construction.
 */
export class VoiceLimiter<K extends string> {
  private readonly ends = new Map<K, Float64Array>();
  private readonly last = new Map<K, number>();

  constructor(private readonly caps: Record<K, VoiceCap>) {
    for (const k of Object.keys(caps) as K[]) {
      this.ends.set(k, new Float64Array(Math.max(1, caps[k].max)).fill(-Infinity));
      this.last.set(k, -Infinity);
    }
  }

  /** Voices of `cat` still sounding at `now`. */
  active(cat: K, now: number): number {
    const e = this.ends.get(cat)!;
    let n = 0;
    for (let i = 0; i < e.length; i++) if (e[i]! > now) n++;
    return n;
  }

  /** Would a voice be accepted right now (without claiming it)? */
  canStart(cat: K, now: number): boolean {
    const cap = this.caps[cat];
    if (now - this.last.get(cat)! < cap.gap) return false;
    return this.active(cat, now) < cap.max;
  }

  /** Claim a slot for a voice lasting `dur` seconds. Returns false if it must be dropped. */
  tryStart(cat: K, now: number, dur: number): boolean {
    const cap = this.caps[cat];
    if (now - this.last.get(cat)! < cap.gap) return false;
    const e = this.ends.get(cat)!;
    for (let i = 0; i < e.length; i++) {
      if (e[i]! <= now) {
        e[i] = now + dur;
        this.last.set(cat, now);
        return true;
      }
    }
    return false;
  }

  /** Forget everything (e.g. after the context was rebuilt). */
  reset(): void {
    for (const e of this.ends.values()) e.fill(-Infinity);
    for (const k of this.last.keys()) this.last.set(k, -Infinity);
  }
}

/**
 * The coin fountain's melody: each clink climbs one pentatonic step, so a flood of coins plays a
 * rising run. A pause longer than `resetAfter` starts over at the bottom; at the top it hovers
 * among the highest few notes instead of climbing out of range.
 */
export class CoinRun {
  private step = 0;
  private lastT = -Infinity;

  constructor(
    readonly lowStep = 5,
    readonly highStep = 15,
    readonly resetAfter = 0.6,
  ) {}

  /** Scale step for a clink at time `now`; `rnd` in [0, 1) picks the hover note at the top. */
  next(now: number, rnd: number): number {
    if (now - this.lastT > this.resetAfter) this.step = this.lowStep;
    else this.step++;
    this.lastT = now;
    if (this.step > this.highStep) return this.highStep - Math.floor(rnd * 3);
    return this.step;
  }
}
