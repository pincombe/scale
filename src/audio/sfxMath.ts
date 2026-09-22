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
 * Per-category polyphony and rate limiter. `claim` is called with the voice's start time on the
 * audio clock; it accepts a voice (recording when it ends) or rejects it when the category is full
 * or another voice starts within the merge window (either side: voices may be scheduled ahead).
 * `setEnd` re-times a claimed slot once the real end is known, or frees it early (a choked voice).
 * Allocation-free after construction.
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

  /** Is `now` inside the merge window of the category's last voice? */
  inGap(cat: K, now: number): boolean {
    return Math.abs(now - this.last.get(cat)!) < this.caps[cat].gap;
  }

  /** Would a voice be accepted right now (without claiming it)? */
  canStart(cat: K, now: number): boolean {
    const cap = this.caps[cat];
    if (Math.abs(now - this.last.get(cat)!) < cap.gap) return false;
    return this.active(cat, now) < cap.max;
  }

  /** Claim a slot for a voice lasting `dur` seconds. Returns the slot, or -1 if it must be dropped. */
  claim(cat: K, now: number, dur: number): number {
    const cap = this.caps[cat];
    if (Math.abs(now - this.last.get(cat)!) < cap.gap) return -1;
    const e = this.ends.get(cat)!;
    for (let i = 0; i < e.length; i++) {
      if (e[i]! <= now) {
        e[i] = now + dur;
        this.last.set(cat, now);
        return i;
      }
    }
    return -1;
  }

  /**
   * Like `claim`, but when the category is full it takes over the slot that frees soonest (the
   * most-decayed voice), so the newest hit is never silent. The caller fades out that slot's old
   * voice. Still returns -1 inside the merge window.
   */
  claimOrSteal(cat: K, now: number, dur: number): number {
    const free = this.claim(cat, now, dur);
    if (free >= 0 || Math.abs(now - this.last.get(cat)!) < this.caps[cat].gap) return free;
    const e = this.ends.get(cat)!;
    let best = 0;
    for (let i = 1; i < e.length; i++) if (e[i]! < e[best]!) best = i;
    e[best] = now + dur;
    this.last.set(cat, now);
    return best;
  }

  /** `claim` as a boolean. */
  tryStart(cat: K, now: number, dur: number): boolean {
    return this.claim(cat, now, dur) >= 0;
  }

  /** Set when a claimed slot frees up (its real end, or now for a voice cut short). */
  setEnd(cat: K, slot: number, end: number): void {
    const e = this.ends.get(cat)!;
    if (slot >= 0 && slot < e.length) e[slot] = end;
  }

  /** Forget everything (e.g. after the context was rebuilt). */
  reset(): void {
    for (const e of this.ends.values()) e.fill(-Infinity);
    for (const k of this.last.keys()) this.last.set(k, -Infinity);
  }
}

/**
 * A rising pentatonic ladder (coin fountains, buying sprees): each call climbs one step. A pause
 * longer than `resetAfter` starts over at `lowStep`. Past `highStep` it either wraps down to
 * `wrapStep` and climbs again (long coin floods become repeating cascades instead of parking on
 * the shrill top notes), or, with `wrapStep` null, hovers among the top three notes.
 */
export class CoinRun {
  private step = 0;
  private lastT = -Infinity;

  constructor(
    readonly lowStep = 5,
    readonly highStep = 13,
    readonly resetAfter = 0.6,
    readonly wrapStep: number | null = null,
  ) {}

  /** Scale step for a note at time `now`; `rnd` in [0, 1) picks the hover note at the top. */
  next(now: number, rnd: number): number {
    if (now - this.lastT > this.resetAfter) this.step = this.lowStep;
    else this.step++;
    this.lastT = now;
    if (this.step > this.highStep) {
      if (this.wrapStep !== null) {
        this.step = this.wrapStep;
        return this.step;
      }
      return this.highStep - Math.floor(rnd * 3);
    }
    return this.step;
  }
}
