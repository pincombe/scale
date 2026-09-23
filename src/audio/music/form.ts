// The form (pure): which section plays next in each mood, and the energy gate that decides which
// roles sound. Themes recur in a long cycle whose variants shift every lap, with rests
// (interludes) that give way to development when the Wyrm Gauge is nearly full.
import type { MoodId, Role } from './score';

export interface FormStep {
  kind: string;
  variant: number;
  /** The Mountain's arrival statement (the horn call, fortissimo). */
  big?: boolean;
}

const KIND: Record<string, string> = {
  A: 'A',
  B: 'B',
  E: 'episode',
  I: 'interlude',
  M: 'M',
  N: 'M2',
  C: 'echoes',
  O: 'ostinato',
  L: 'melody',
  K: 'break',
};

/** One lap of each mood's form: letter = section, digit = variant (shifted by the lap). */
const CYCLE: Record<MoodId, readonly string[]> = {
  // ~3.6 min per lap: A A' B E I | A(harp) B' E' I' A(low) | B E'' I
  meadow: ['A0', 'A1', 'B0', 'E0', 'I0', 'A2', 'B1', 'E1', 'I1', 'A3', 'B2', 'E2', 'I0'],
  // ~5 min per lap.
  mountain: ['M0', 'C0', 'N0', 'I0', 'M1', 'C1', 'N1', 'I1', 'M2', 'C0', 'N2', 'I0'],
  boss: ['O0', 'O1', 'L0', 'K0', 'L1', 'O0', 'O1', 'L0', 'K0', 'L1'],
};

/** Where a song may start. */
export type Entry = 'intro' | 'theme' | 'episode' | 'call' | 'ostinato' | 'victory' | 'retreat';

export class Form {
  private i = -1;
  private lap = 0;
  private first: FormStep | null;

  constructor(
    readonly mood: MoodId,
    entry: Entry,
  ) {
    const theme = mood === 'mountain' ? 'M' : mood === 'boss' ? 'melody' : 'A';
    const kind =
      entry === 'intro'
        ? 'intro'
        : entry === 'episode'
          ? mood === 'mountain'
            ? 'echoes'
            : mood === 'boss'
              ? 'ostinato'
              : 'episode'
          : entry === 'call' || entry === 'theme'
            ? theme
            : entry;
    // 'call' is the Mountain's arrival: its theme opens with the horn call, fortissimo.
    this.first = { kind, variant: 0, big: entry === 'call' && mood === 'mountain' };
    // After an entry that is the lap's first slot, the lap continues past it.
    if (entry === 'theme' || entry === 'call' || entry === 'ostinato') this.i = 0;
  }

  next(energy: number, tension: number, urgency: number): FormStep {
    if (this.first) {
      const f = this.first;
      this.first = null;
      return f;
    }
    const cycle = CYCLE[this.mood];
    for (let guard = 0; guard < cycle.length; guard++) {
      this.i++;
      if (this.i >= cycle.length) {
        this.i = 0;
        this.lap++;
      }
      const code = cycle[this.i]!;
      let kind = KIND[code[0]!]!;
      const variant = Number(code.slice(1)) + this.lap;
      if (kind === 'interlude') {
        // No resting when the boss is near, or when the army is roaring.
        if (tension >= 0.45) kind = this.mood === 'mountain' ? 'echoes' : 'episode';
        else if (energy >= 0.85) continue;
      }
      if (kind === 'break' && urgency >= 0.5) return { kind: 'melody', variant: 1 };
      return { kind, variant };
    }
    return { kind: KIND[cycle[0]![0]!]!, variant: this.lap };
  }
}

/**
 * The gate: how far the game is past the point where `role` joins, in `mood` (>= 0 on; the
 * conductor turns it off below -0.08, so it never flickers). Melody, echo and arp always play.
 */
export function gateMargin(mood: MoodId, role: Role, energy: number, tension: number): number {
  if (mood === 'boss') return 1;
  const meadow = mood === 'meadow';
  switch (role) {
    case 'counter':
      return energy - (meadow ? 0.3 : 0.4);
    case 'pulse':
      return energy - (meadow ? 0.5 : 0.72);
    case 'pad':
      return meadow ? Math.max(energy - 0.72, tension - 0.5) : 1;
    case 'heart':
      return meadow ? tension - 0.35 : Math.max(energy - 0.2, tension - 0.3);
    default:
      return 1;
  }
}

/** The Mountain's choir hum joins at high energy. */
export function choirMargin(mood: MoodId, energy: number): number {
  return mood === 'mountain' ? energy - 0.55 : 1;
}
