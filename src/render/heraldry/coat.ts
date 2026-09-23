// The coat of arms as data: pure, deterministic, DOM-free (tested in Node). coatOf() derives the
// whole composition from state.heraldry alone; draw.ts paints it.
//
// Composition (order = the order charges were first bought; order[0] is the principal):
//   0 charges  the M1 coat: gules, a sword or.
//   1          the principal on its signature field.
//   2          + a chief of #2 (its field and charge; its lower edge in #2's line of partition).
//   3          + a bordure of #3 (charged with eight #3s where they are big enough to read).
//   4          + a canton of #4 over the dexter end of the chief.
//   5          + a sinister canton of #5 (the chief is now tierced: #4 | #2 | #5).
//   6          + a base of #6 (its upper edge in #6's line), charged with a #6.
//
// Levels (LEVEL): every level of every charge changes what the army's most distant banner shows,
// big areas first. A charge's ground (its region's field) divides as it levels: per pale (its
// field and a second tincture), then quarterly, then gyronny of 8, 12 and 16; a bordure turns
// compony, its segments multiplying every level. L2 per pale; L3 the ground strewn (semé) with the
// charge's motif, claws, tongue, antlers, windows or jewels in a contrasting tincture and a first
// flourish (a crown, a pennon, flaming rays); L4 quarterly, a chief or base holding three; L5 per
// saltire and a second flourish (a double tail, fire, a castle, a royal crown); L6-L8 gyronny of
// 8, 12 (with a damask, close up) and 16. Crown levels also set a coronet, then a royal crown, atop a shield. Every region
// keeps the rule of tincture (metal on colour, colour on metal): each charge's pairing is fixed and
// its second tincture is of the same kind as its field.
import type { ChargeId, HeraldryState } from '../../core/types';

export type Tincture = 'or' | 'argent' | 'gules' | 'azure' | 'vert' | 'purpure' | 'sable';
/** Every charge the renderer can draw: the M2 six, the M1 sword, and M3's eagle and moon. */
export type ChargeKind = ChargeId | 'sword' | 'eagle' | 'moon';
/** Lines of partition (edges between regions). */
export type Line = 'plain' | 'indented' | 'dancetty' | 'wavy' | 'engrailed' | 'embattled';
/** Small motifs a field can be strewn with (semé). */
export type Motif = 'crosslet' | 'mullet' | 'goutte' | 'trefoil' | 'billet' | 'fleur';

export const CHARGE_IDS: readonly ChargeId[] = ['lion', 'sun', 'wyvern', 'stag', 'tower', 'crown'];
export const CHARGE_KINDS: readonly ChargeKind[] = ['lion', 'sun', 'wyvern', 'stag', 'tower', 'crown', 'sword', 'eagle', 'moon'];

export function isMetal(t: Tincture): boolean {
  return t === 'or' || t === 'argent';
}

export interface Signature {
  /** The field the charge is borne on (its region's tincture). */
  field: Tincture;
  /** The second tincture its ground divides into (same kind as `field`: both colours or both metals). */
  field2: Tincture;
  /** The charge's own tincture (always contrasts with `field` by the rule of tincture). */
  charge: Tincture;
  /** Claws and tongue, antlers, windows, jewels, hilt, the sun's face. */
  detail: Tincture;
  /** Line of partition of the region edge it brings (chief, base). */
  line: Line;
  /** The motif its field is strewn with once levelled (semé). */
  motif: Motif;
}

/** Signature pairings. Six distinct fields, so two regions never share a tincture in M2. */
export const SIGNATURE: Readonly<Record<ChargeKind, Signature>> = {
  sword: { field: 'gules', field2: 'azure', charge: 'or', detail: 'argent', line: 'plain', motif: 'crosslet' },
  lion: { field: 'gules', field2: 'azure', charge: 'or', detail: 'azure', line: 'indented', motif: 'crosslet' },
  sun: { field: 'azure', field2: 'gules', charge: 'or', detail: 'gules', line: 'wavy', motif: 'mullet' },
  wyvern: { field: 'or', field2: 'argent', charge: 'sable', detail: 'gules', line: 'dancetty', motif: 'goutte' },
  stag: { field: 'vert', field2: 'azure', charge: 'argent', detail: 'or', line: 'engrailed', motif: 'trefoil' },
  tower: { field: 'sable', field2: 'gules', charge: 'argent', detail: 'or', line: 'embattled', motif: 'billet' },
  crown: { field: 'purpure', field2: 'azure', charge: 'or', detail: 'gules', line: 'plain', motif: 'fleur' },
  eagle: { field: 'argent', field2: 'or', charge: 'gules', detail: 'or', line: 'plain', motif: 'crosslet' },
  moon: { field: 'azure', field2: 'sable', charge: 'argent', detail: 'or', line: 'wavy', motif: 'mullet' },
};

/** Level thresholds (per charge) for its ornaments. */
export const LEVEL = {
  /** Its ground divides per pale (a bordure turns compony). */
  pale: 2,
  /** Claws and tongue (antlers, windows, jewels...) in the detail tincture, the first flourish,
   *  and its ground strewn (semé) with its motif. */
  detail: 3,
  rank1: 3,
  semy: 3,
  /** Its ground divides quarterly; a chief or base holds three. */
  quarterly: 4,
  triple: 4,
  /** The second flourish; its ground divides per saltire. */
  rank2: 5,
  saltire: 5,
  /** Gyronny of 8, 12 (with the damask, close up), 16. */
  gyronny: 6,
  diaper: 7,
  /** The last level that changes the coat; later levels only play the flourish. */
  max: 8,
  /** Crown levels for a coronet (1), then a royal crown (2), atop a shield. */
  crest1: 3,
  crest2: 6,
} as const;

/** A region's ground: its field, how it divides, what it is strewn with. */
export interface Ground {
  field: Tincture;
  field2: Tincture;
  /**
   * 0 plain, 1 per pale, 2 quarterly, 3 per saltire, n >= 8 gyronny of n (8, 12, 16). On a
   * bordure: compony of n segments (0 = plain).
   */
  division: number;
  semy: Motif | null;
  semyTincture: Tincture;
  diaper: boolean;
}

export interface CoatCharge {
  kind: ChargeKind;
  tincture: Tincture;
  /** Contrast tincture for claws, tongue, antlers, windows, jewels; null before LEVEL.detail. */
  detail: Tincture | null;
  /** Ornament rank: 0 plain, 1 (LEVEL.rank1), 2 (LEVEL.rank2). */
  rank: 0 | 1 | 2;
}

export interface CoatRegion {
  /** The region's field (= ground.field). */
  field: Tincture;
  ground: Ground;
  charge: CoatCharge;
  /** How many charges it holds (a chief or base: 1 or 3; a bordure: 8; a canton: 1). */
  count: number;
  /** Edge line (chief: its lower edge; base: its upper edge; others plain). */
  line: Line;
}

export interface Coat {
  /** Stable identity of the visual: equal keys draw identically (compare to skip re-bakes). */
  key: string;
  /** Identity of what survives the smallest level of detail (a distant banner). */
  farKey: string;
  /** The main field (= main.field). */
  field: Tincture;
  /** The principal's ground. */
  main: Ground;
  principal: CoatCharge;
  chief: CoatRegion | null;
  bordure: CoatRegion | null;
  /** Dexter canton (over the dexter end of the chief). */
  canton: CoatRegion | null;
  /** Sinister canton (over the sinister end of the chief). */
  canton2: CoatRegion | null;
  base: CoatRegion | null;
  /** Crown atop a heater shield: 0 none, 1 coronet, 2 royal crown. */
  crest: 0 | 1 | 2;
}

function chargeAt(kind: ChargeKind, level: number): CoatCharge {
  const s = SIGNATURE[kind];
  return {
    kind,
    tincture: s.charge,
    detail: level >= LEVEL.detail ? s.detail : null,
    rank: level >= LEVEL.rank2 ? 2 : level >= LEVEL.rank1 ? 1 : 0,
  };
}

/** The division a ground reaches at a level (see Ground.division). */
export function divisionAt(level: number): number {
  if (level < LEVEL.pale) return 0;
  if (level < LEVEL.quarterly) return 1;
  if (level < LEVEL.saltire) return 2;
  if (level < LEVEL.gyronny) return 3;
  return level === LEVEL.gyronny ? 8 : level === LEVEL.gyronny + 1 ? 12 : 16;
}

/** Compony segments a bordure reaches at a level: more every level up to LEVEL.max. */
export function componyAt(level: number): number {
  return level < LEVEL.pale ? 0 : 8 + 2 * (Math.min(level, LEVEL.max) - LEVEL.pale);
}

function ground(kind: ChargeKind, level: number, bordure = false): Ground {
  const s = SIGNATURE[kind];
  return {
    field: s.field,
    field2: s.field2,
    division: bordure ? componyAt(level) : divisionAt(level),
    semy: !bordure && level >= LEVEL.semy ? s.motif : null,
    semyTincture: s.charge,
    diaper: level >= LEVEL.diaper,
  };
}

function region(kind: ChargeKind, level: number, count: number, line: Line, bordure = false): CoatRegion {
  const g = ground(kind, level, bordure);
  return { field: g.field, ground: g, charge: chargeAt(kind, level), count, line };
}

/**
 * The charges in play, in order: `order` first (deduplicated, levels > 0), then any charge with a
 * level but missing from `order` (defensive: a hand-edited or migrated save), in canonical order.
 */
export function chargeOrder(h: HeraldryState): ChargeId[] {
  const out: ChargeId[] = [];
  const lv = (id: ChargeId): number => h.levels[id] ?? 0;
  for (const id of h.order) if (CHARGE_IDS.includes(id) && lv(id) > 0 && !out.includes(id)) out.push(id);
  for (const id of CHARGE_IDS) if (lv(id) > 0 && !out.includes(id)) out.push(id);
  return out;
}

/** The coat of arms for a heraldry state. Pure and deterministic. */
export function coatOf(h: HeraldryState): Coat {
  const ids = chargeOrder(h);
  const lv = (i: number): number => Math.max(1, Math.floor(h.levels[ids[i]!] ?? 1));
  const crownLv = Math.floor(h.levels.crown ?? 0);
  if (ids.length === 0) {
    return keyed({
      key: '',
      farKey: '',
      field: 'gules',
      main: ground('sword', 1),
      principal: chargeAt('sword', 1),
      chief: null,
      bordure: null,
      canton: null,
      canton2: null,
      base: null,
      crest: 0,
    });
  }
  const p = ids[0]!;
  const pl = lv(0);
  const at = (i: number): ChargeId | null => ids[i] ?? null;
  const c2 = at(1);
  const c3 = at(2);
  const c4 = at(3);
  const c5 = at(4);
  const c6 = at(5);
  return keyed({
    key: '',
    farKey: '',
    field: SIGNATURE[p].field,
    main: ground(p, pl),
    principal: chargeAt(p, pl),
    chief: c2 ? region(c2, lv(1), lv(1) >= LEVEL.triple ? 3 : 1, SIGNATURE[c2].line) : null,
    bordure: c3 ? region(c3, lv(2), 8, 'plain', true) : null,
    canton: c4 ? region(c4, lv(3), 1, 'plain') : null,
    canton2: c5 ? region(c5, lv(4), 1, 'plain') : null,
    base: c6 ? region(c6, lv(5), lv(5) >= LEVEL.triple ? 3 : 1, SIGNATURE[c6].line) : null,
    crest: crownLv >= LEVEL.crest2 ? 2 : crownLv >= LEVEL.crest1 ? 1 : 0,
  });
}

function chargeKey(c: CoatCharge): string {
  return c.kind + '.' + c.tincture + '.' + (c.detail ?? '-') + '.' + c.rank;
}

function groundKey(g: Ground, far: boolean): string {
  return g.field + '/' + g.field2 + '/' + g.division + '/' + (g.semy ?? '-') + (far ? '' : g.diaper ? '*' : '');
}

function regionKey(r: CoatRegion | null, far: boolean, bordure = false): string {
  if (!r) return '_';
  // A distant banner paints a bordure plain or compony: its charges are too small to draw.
  if (far && bordure) return groundKey(r.ground, true);
  return groundKey(r.ground, far) + ':' + chargeKey(r.charge) + ':' + r.count + (far ? '' : ':' + r.line);
}

function keyed(c: Coat): Coat {
  const parts = (far: boolean): string =>
    [
      groundKey(c.main, far),
      chargeKey(c.principal),
      regionKey(c.chief, far),
      regionKey(c.bordure, far, true),
      regionKey(c.canton, far),
      regionKey(c.canton2, far),
      regionKey(c.base, far),
      far ? '' : c.crest,
    ].join('|');
  c.key = parts(false);
  c.farKey = parts(true);
  return c;
}

/** The M1 coat (gules, a sword or). */
export const M1_COAT: Coat = coatOf({ levels: { lion: 0, sun: 0, wyvern: 0, stag: 0, tower: 0, crown: 0 }, order: [] });

/** A cheap numeric fingerprint of a heraldry state (no allocation): compare per refresh. */
export function heraldryHash(h: HeraldryState): number {
  let x = 17;
  for (let i = 0; i < CHARGE_IDS.length; i++) x = (x * 31 + (h.levels[CHARGE_IDS[i]!] ?? 0)) | 0;
  for (let i = 0; i < h.order.length; i++) x = (x * 37 + CHARGE_IDS.indexOf(h.order[i]!) + 2) | 0;
  return (x * 41 + h.order.length) | 0;
}
