import { describe, expect, it } from 'vitest';
import { MEADOW } from '../palette';
import { M1_COAT, coatOf } from './coat';
import { heraldryFor } from './index';

describe('heraldryFor', () => {
  it('summarises the M1 coat in the M1 banner colours', () => {
    const h = heraldryFor(M1_COAT);
    expect(h.field).toBe(MEADOW.accent.banner);
    expect(h.charge).toBe('sword');
    expect(h.coat).toBe(M1_COAT);
  });

  it('carries the principal charge and the full coat', () => {
    const coat = coatOf({ levels: { lion: 0, sun: 2, wyvern: 1, stag: 0, tower: 0, crown: 0 }, order: ['sun', 'wyvern'] });
    const h = heraldryFor(coat);
    expect(h.charge).toBe('sun');
    expect(h.coat?.chief?.charge.kind).toBe('wyvern');
    expect(h.field).toMatch(/^#[0-9a-f]{6}$/);
    expect(h.tincture).toMatch(/^#[0-9a-f]{6}$/);
  });
});
