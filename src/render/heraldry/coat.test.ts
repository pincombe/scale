import { describe, expect, it } from 'vitest';
import type { ChargeId, HeraldryState } from '../../core/types';
import { CHARGE_IDS, CHARGE_KINDS, LEVEL, M1_COAT, SIGNATURE, chargeOrder, coatOf, heraldryHash, isMetal, type Coat, type CoatRegion } from './coat';

function her(order: ChargeId[], levels: Partial<Record<ChargeId, number>> = {}): HeraldryState {
  const l: Record<ChargeId, number> = { lion: 0, sun: 0, wyvern: 0, stag: 0, tower: 0, crown: 0 };
  for (const id of order) l[id] = 1;
  Object.assign(l, levels);
  return { levels: l, order: [...order] };
}

/** The n-th charge other than id (canonical order). */
function other(id: ChargeId, n: number): ChargeId {
  return CHARGE_IDS.filter((c) => c !== id)[n]!;
}

function regions(c: Coat): CoatRegion[] {
  return [c.chief, c.bordure, c.canton, c.canton2, c.base].filter((r): r is CoatRegion => r !== null);
}

/** Every ordering of every subset of the six charges (1,956 coats). */
function allOrders(): ChargeId[][] {
  const out: ChargeId[][] = [];
  const rec = (cur: ChargeId[]): void => {
    out.push(cur);
    for (const id of CHARGE_IDS) if (!cur.includes(id)) rec([...cur, id]);
  };
  rec([]);
  return out;
}

describe('coatOf', () => {
  it('before any charge is the M1 coat: gules, a sword or', () => {
    const c = coatOf(her([]));
    expect(c.field).toBe('gules');
    expect(c.principal.kind).toBe('sword');
    expect(c.principal.tincture).toBe('or');
    expect(regions(c)).toHaveLength(0);
    expect(c.crest).toBe(0);
    expect(c.key).toBe(M1_COAT.key);
  });

  it('the first charge becomes the principal on its signature field', () => {
    for (const id of CHARGE_IDS) {
      const c = coatOf(her([id]));
      expect(c.principal.kind).toBe(id);
      expect(c.field).toBe(SIGNATURE[id].field);
      expect(c.principal.tincture).toBe(SIGNATURE[id].charge);
      expect(regions(c)).toHaveLength(0);
    }
  });

  it('later charges join as chief, bordure, canton, sinister canton, base', () => {
    const order: ChargeId[] = ['sun', 'lion', 'tower', 'stag', 'crown', 'wyvern'];
    const c = coatOf(her(order));
    expect(c.principal.kind).toBe('sun');
    expect(c.chief?.charge.kind).toBe('lion');
    expect(c.chief?.line).toBe(SIGNATURE.lion.line);
    expect(c.bordure?.charge.kind).toBe('tower');
    expect(c.bordure?.count).toBe(8);
    expect(c.canton?.charge.kind).toBe('stag');
    expect(c.canton2?.charge.kind).toBe('crown');
    expect(c.base?.charge.kind).toBe('wyvern');
    expect(c.base?.line).toBe(SIGNATURE.wyvern.line);
  });

  it('every added charge changes the coat', () => {
    const order: ChargeId[] = ['wyvern', 'crown', 'lion', 'sun', 'tower', 'stag'];
    const keys = new Set<string>();
    for (let n = 0; n <= order.length; n++) keys.add(coatOf(her(order.slice(0, n))).key);
    expect(keys.size).toBe(order.length + 1);
  });

  it('every coat of every order keeps the rule of tincture, and every order is its own coat', () => {
    const keys = new Set<string>();
    const all = allOrders();
    for (const o of all) {
      const c = coatOf(her(o));
      keys.add(c.key);
      expect(isMetal(c.principal.tincture)).not.toBe(isMetal(c.field));
      for (const r of regions(c)) {
        expect(isMetal(r.charge.tincture)).not.toBe(isMetal(r.field));
        // No region shares the main field's tincture (fimbriated lines still separate them).
        expect(r.field).not.toBe(c.field);
      }
    }
    expect(keys.size).toBe(all.length);
  });

  it('signature pairings obey the rule of tincture and detail tinctures differ from the charge', () => {
    for (const k of CHARGE_KINDS) {
      const s = SIGNATURE[k];
      expect(isMetal(s.charge)).not.toBe(isMetal(s.field));
      expect(s.detail).not.toBe(s.charge);
    }
  });

  it('levels add ornament step by step (each threshold is a new coat)', () => {
    const hi = coatOf(her(['lion'], { lion: LEVEL.max }));
    expect(hi.principal.detail).toBe('azure');
    expect(hi.principal.rank).toBe(2);
    expect(hi.main.semy).toBe('crosslet');
    expect(hi.main.semyTincture).toBe('or');
    expect(hi.main.diaper).toBe(true);
    expect(hi.main.division).toBe(16);
    const lo = coatOf(her(['lion']));
    expect(lo.principal.detail).toBeNull();
    expect(lo.principal.rank).toBe(0);
    expect(lo.main.semy).toBeNull();
    expect(lo.main.diaper).toBe(false);
    expect(lo.main.division).toBe(0);
  });

  it('the ladder puts a big change first: level 2 divides the ground per pale', () => {
    expect(coatOf(her(['sun'], { sun: 2 })).main.division).toBe(1);
    expect(coatOf(her(['sun'], { sun: 2 })).main.field2).toBe(SIGNATURE.sun.field2);
    expect(coatOf(her(['lion', 'tower', 'sun'], { sun: 2 })).bordure?.ground.division).toBe(8);
  });

  it('every level of every charge, in every slot, changes the coat and what a distant banner shows', () => {
    const slots: ((id: ChargeId) => ChargeId[])[] = [
      (id) => [id],
      (id) => [other(id, 0), id],
      (id) => [other(id, 0), other(id, 1), id],
      (id) => [other(id, 0), other(id, 1), other(id, 2), id],
      (id) => [other(id, 0), other(id, 1), other(id, 2), other(id, 3), id],
      (id) => [other(id, 0), other(id, 1), other(id, 2), other(id, 3), other(id, 4), id],
    ];
    for (const id of CHARGE_IDS) {
      for (const slot of slots) {
        const order = slot(id);
        let prev = coatOf(her(order.slice(0, -1)));
        for (let lv = 1; lv <= LEVEL.max; lv++) {
          const c = coatOf(her(order, { [id]: lv }));
          expect(c.key, `${order.join(',')} ${id} L${lv}`).not.toBe(prev.key);
          expect(c.farKey, `${order.join(',')} ${id} L${lv} (far)`).not.toBe(prev.farKey);
          prev = c;
        }
        // Past the ladder nothing changes (only the flourish plays).
        expect(coatOf(her(order, { [id]: LEVEL.max + 1 })).key).toBe(prev.key);
      }
    }
  });

  it('divided grounds keep the rule of tincture (both halves of one kind, under the charge)', () => {
    for (const k of CHARGE_KINDS) {
      const s = SIGNATURE[k];
      expect(isMetal(s.field2)).toBe(isMetal(s.field));
      expect(s.field2).not.toBe(s.field);
      expect(isMetal(s.charge)).not.toBe(isMetal(s.field2));
    }
  });

  it('a levelled chief holds three; region charges rank up too', () => {
    const c = coatOf(her(['lion', 'sun'], { sun: LEVEL.triple }));
    expect(c.chief?.count).toBe(3);
    expect(c.chief?.charge.rank).toBe(1);
    expect(c.chief?.ground.division).toBe(2);
    expect(coatOf(her(['lion'], { lion: LEVEL.saltire })).main.division).toBe(3);
    expect(coatOf(her(['lion', 'sun'])).chief?.count).toBe(1);
  });

  it('crown levels set a coronet, then a royal crown, atop the shield (wherever the crown stands)', () => {
    expect(coatOf(her(['lion', 'crown'], { crown: LEVEL.crest1 - 1 })).crest).toBe(0);
    expect(coatOf(her(['lion', 'crown'], { crown: LEVEL.crest1 })).crest).toBe(1);
    expect(coatOf(her(['lion', 'crown'], { crown: LEVEL.crest2 })).crest).toBe(2);
    expect(coatOf(her(['crown'], { crown: LEVEL.crest2 })).crest).toBe(2);
  });

  it('is deterministic and ignores junk in order', () => {
    const a = coatOf(her(['stag', 'tower']));
    const b = coatOf(her(['stag', 'tower']));
    expect(a).toEqual(b);
    // Duplicates and zero-level ids are dropped; levelled ids missing from order are appended.
    const h = her(['stag', 'stag', 'tower'], { lion: 0 });
    h.order.push('lion');
    h.levels.sun = 2;
    expect(chargeOrder(h)).toEqual(['stag', 'tower', 'sun']);
    expect(coatOf(h).bordure?.charge.kind).toBe('sun');
  });

  it('heraldryHash changes with levels and order', () => {
    const a = heraldryHash(her(['lion', 'sun']));
    expect(heraldryHash(her(['lion', 'sun']))).toBe(a);
    expect(heraldryHash(her(['sun', 'lion']))).not.toBe(a);
    expect(heraldryHash(her(['lion', 'sun'], { sun: 2 }))).not.toBe(a);
    expect(heraldryHash(her([]))).not.toBe(a);
  });
});
