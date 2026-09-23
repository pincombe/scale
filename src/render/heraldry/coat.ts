// The coat of arms as data: pure, deterministic, DOM-free (tested in Node). coatOf() derives the
// whole composition from state.heraldry alone; draw.ts paints it.
//
// Composition (order = the order charges were first bought; order[0] is the principal):
//   0 charges  the M1 coat: gules, a sword or.
//   1          the principal on its signature field.
//   2          + a chief of #2 (its field and charge; its lower edge in #2's line of partition).
//   3          + a bordure of #3, charged with eight #3s (large sizes only).
//   4          + a canton of #4 over the dexter end of the chief.
//   5          + a sinister canton of #5 (the chief is now tierced: #4 | #2 | #5).
//   6          + a base of #6 (its upper edge in #6's line), charged with a #6.
// Levels ornament each charge wherever it stands (see LEVEL): a contrasting tincture on claws,
// tongue, antlers or windows; a crown or signature flourish; the principal's field is strewn (semé)
// with its signature motif; a chief or base holds three; its field is diapered. Crown levels set a
// coronet, then a royal crown, atop the shield. Every charge has a signature pairing that keeps the rule of tincture
// (metal on colour, colour on metal), so every region is legal and every save's coat its own.
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
  sword: { field: 'gules', charge: 'or', detail: 'argent', line: 'plain', motif: 'crosslet' },
  lion: { field: 'gules', charge: 'or', detail: 'azure', line: 'indented', motif: 'crosslet' },
  sun: { field: 'azure', charge: 'or', detail: 'gules', line: 'wavy', motif: 'mullet' },
  wyvern: { field: 'or', charge: 'sable', detail: 'gules', line: 'dancetty', motif: 'goutte' },
  stag: { field: 'vert', charge: 'argent', detail: 'or', line: 'engrailed', motif: 'trefoil' },
  tower: { field: 'sable', charge: 'argent', detail: 'or', line: 'embattled', motif: 'billet' },
  crown: { field: 'purpure', charge: 'or', detail: 'gules', line: 'plain', motif: 'fleur' },
  eagle: { field: 'argent', charge: 'gules', detail: 'or', line: 'plain', motif: 'crosslet' },
  moon: { field: 'azure', charge: 'argent', detail: 'or', line: 'wavy', motif: 'mullet' },
};

/** Level thresholds (per charge) for its ornaments. */
export const LEVEL = {
  /** Claws and tongue (antlers, windows, jewels...) in the detail tincture. */
  detail: 2,
  /** Rank 1: crowned lion / wyvern / eagle, gorged stag, the sun's flaming rays, a pennon on the tower, a crown of fleurons. */
  rank1: 3,
  /** The principal's field is strewn with its motif (semé); a chief or base holds three. */
  semy: 4,
  triple: 4,
  /** Rank 2: double-queued lion, the wyvern breathes fire, a royal stag, the sun's glory, a castle, an arched royal crown. */
  rank2: 5,
  /** The charge's field is diapered (damask). */
  diaper: 6,
  /** Crown levels for a coronet (1), then a royal crown (2), atop the shield. */
  crest1: 3,
  crest2: 6,
} as const;

export interface CoatCharge {
  kind: ChargeKind;
  tincture: Tincture;
  /** Contrast tincture for claws, tongue, antlers, windows, jewels; null before LEVEL.detail. */
  detail: Tincture | null;
  /** Ornament rank: 0 plain, 1 (LEVEL.rank1), 2 (LEVEL.rank2). */
  rank: 0 | 1 | 2;
}

export interface CoatRegion {
  field: Tincture;
  charge: CoatCharge;
  /** How many charges it holds (a chief or base: 1 or 3; a bordure: 8; a canton: 1). */
  count: number;
  /** Edge line (chief: its lower edge; base: its upper edge; others plain). */
  line: Line;
  diaper: boolean;
}

export interface Coat {
  /** Stable identity of the visual: equal keys draw identically (compare to skip re-bakes). */
  key: string;
  /** The main field (the principal's region). */
  field: Tincture;
  diaper: boolean;
  principal: CoatCharge;
  /** The main field strewn with this motif (null = none), in `semyTincture`. */
  semy: Motif | null;
  semyTincture: Tincture;
  chief: CoatRegion | null;
  bordure: CoatRegion | null;
  /** Dexter canton (over the dexter end of the chief). */
  canton: CoatRegion | null;
  /** Sinister canton (over the sinister end of the chief). */
  canton2: CoatRegion | null;
  base: CoatRegion | null;
  /** Crown atop the shield (heater only): 0 none, 1 coronet, 2 royal crown. */
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

function region(kind: ChargeKind, level: number, count: number, line: Line): CoatRegion {
  return { field: SIGNATURE[kind].field, charge: chargeAt(kind, level), count, line, diaper: level >= LEVEL.diaper };
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
      field: 'gules',
      diaper: false,
      principal: chargeAt('sword', 1),
      semy: null,
      semyTincture: 'or',
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
    field: SIGNATURE[p].field,
    diaper: pl >= LEVEL.diaper,
    principal: chargeAt(p, pl),
    // The semé takes the principal's own tincture: it lies on the principal's field.
    semy: pl >= LEVEL.semy ? SIGNATURE[p].motif : null,
    semyTincture: SIGNATURE[p].charge,
    chief: c2 ? region(c2, lv(1), lv(1) >= LEVEL.triple ? 3 : 1, SIGNATURE[c2].line) : null,
    bordure: c3 ? region(c3, lv(2), 8, 'plain') : null,
    canton: c4 ? region(c4, lv(3), 1, 'plain') : null,
    canton2: c5 ? region(c5, lv(4), 1, 'plain') : null,
    base: c6 ? region(c6, lv(5), lv(5) >= LEVEL.triple ? 3 : 1, SIGNATURE[c6].line) : null,
    crest: crownLv >= LEVEL.crest2 ? 2 : crownLv >= LEVEL.crest1 ? 1 : 0,
  });
}

function chargeKey(c: CoatCharge): string {
  return c.kind + '.' + c.tincture + '.' + (c.detail ?? '-') + '.' + c.rank;
}

function regionKey(r: CoatRegion | null): string {
  return r ? r.field + ':' + chargeKey(r.charge) + ':' + r.count + ':' + r.line + ':' + (r.diaper ? 1 : 0) : '_';
}

function keyed(c: Coat): Coat {
  c.key = [
    c.field + (c.diaper ? '*' : ''),
    chargeKey(c.principal),
    c.semy ? c.semy + ':' + c.semyTincture : '-',
    regionKey(c.chief),
    regionKey(c.bordure),
    regionKey(c.canton),
    regionKey(c.canton2),
    regionKey(c.base),
    c.crest,
  ].join('|');
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
