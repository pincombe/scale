// Heraldry (WP 2.4): the procedurally drawn coat of arms, derived from state.heraldry alone and
// flown on every banner in the army and the hero's shield, in every tier.
//
// - coatOf(state.heraldry) -> Coat (coat.ts): the composition rules, pure and tested.
// - drawCoat(ctx, coat, cx, cy, size, opts) (draw.ts): paints it (heater / banner / kite), any 2D
//   context, any size. The UI's Heraldry tab and the zoom's colossus call it directly.
// - createHeraldry(scene): watches state.heraldry and hands each new coat to scene.crowd.
import type { Scene } from '../../app/scene';
import type { ChargeId } from '../../core/types';
import type { Heraldry } from '../crowd/api';
import { CHARGE_IDS, coatOf, heraldryHash, type Coat } from './coat';
import { tinctureColor } from './draw';

export { coatOf, heraldryHash, M1_COAT, SIGNATURE, LEVEL, CHARGE_IDS, CHARGE_KINDS } from './coat';
export type { Coat, CoatCharge, CoatRegion, ChargeKind, Ground, Motif, Tincture, Line } from './coat';
export { drawCoat, lodFor, tinctureColor, HEATER_ASPECT, KITE_ASPECT, CREST_RISE } from './draw';
export type { CoatOpts, CoatShape } from './draw';

/** The crowd's description of a coat (the summary colors plus the full composition). */
export function heraldryFor(coat: Coat, flourish = false): Heraldry {
  const h: Heraldry = { field: tinctureColor(coat.field), tincture: tinctureColor(coat.principal.tincture), charge: coat.principal.kind, coat };
  if (flourish) h.flourish = true;
  return h;
}

export function createHeraldry(scene: Scene): void {
  const game = scene.game;
  let hash = Number.NaN;
  let key = '';
  /** Hand the crowd the current coat. `bought`: a purchase (play the flourish even if the coat is unchanged). */
  const refresh = (bought = false): void => {
    const h = game.state.heraldry;
    const n = heraldryHash(h);
    if (n === hash && !bought) return;
    hash = n;
    const coat = coatOf(h);
    if (coat.key === key && !bought) return;
    // The first coat of a session (a load) arrives quietly; later changes by purchase flourish.
    const flourish = bought && key !== '';
    key = coat.key;
    scene.crowd.setHeraldry?.(heraldryFor(coat, flourish));
  };
  game.on('purchase', (e) => {
    if (e.kind === 'heraldry') refresh(true);
  });
  game.on('resync', () => refresh());
  // ~10 Hz: the first refresh after boot flies the loaded coat; also catches edits of state.
  scene.ui.onRefresh(() => refresh());

  // Debug: grow the coat without the economy (?debug). Each button plays the flourish.
  const dbg = scene.debug;
  dbg.section('Heraldry');
  const add = (id: ChargeId): void => {
    const h = game.state.heraldry;
    if (h.levels[id] === 0 && !h.order.includes(id)) h.order.push(id);
    h.levels[id] += 1;
    refresh(true);
  };
  for (const id of CHARGE_IDS) dbg.button('+' + id, () => add(id));
  dbg.button('+1 all', () => {
    for (const id of game.state.heraldry.order) game.state.heraldry.levels[id] += 1;
    refresh(true);
  });
  dbg.button('reset coat', () => {
    const h = game.state.heraldry;
    for (const id of CHARGE_IDS) h.levels[id] = 0;
    h.order.length = 0;
    refresh(true);
  });
  dbg.watch('coat', () => game.state.heraldry.order.map((id) => id + game.state.heraldry.levels[id]).join(' ') || 'M1 sword');
  dbg.watch('banner bake', () => {
    const c = (window as unknown as { __crowd?: { bannerArt?: { bakeMs: number } } }).__crowd;
    return c?.bannerArt ? c.bannerArt.bakeMs.toFixed(2) + ' ms' : '-';
  });
}
