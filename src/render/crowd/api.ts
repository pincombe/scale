// Contract: what the rest of the game may ask of the knight crowd renderer (scene.crowd).
// Owned by render/crowd. Add methods freely; never change or remove existing ones.
import type { Rect, Vec2 } from '../../lib/vec';
import type { Coat } from '../heraldry/coat';

export interface CrowdView {
  /** The hero knight's chest (world m): origin for sword arcs and hero effects. */
  heroPoint(out: Vec2): Vec2;
  /** World x of the army's front line (the front of the hero's guard at rest: shield rim or sword tip). */
  frontX(): number;
  /** World AABB of the part of the army worth framing (hero + visible formation). */
  bounds(out: Rect): Rect;
  /**
   * Fly this coat of arms on every banner and the hero's shield (re-bakes the cloth once).
   * Optional so null stand-ins stay valid; the real crowd always implements it.
   */
  setHeraldry?(h: Heraldry): void;
  /**
   * M2 zoom, rally beat: every knight (hero included) rushes toward world x with banners high,
   * arriving and piling up there within `seconds`. Implemented by the crowd M2 WP; optional.
   */
  rally?(x: number, seconds: number): void;
  /**
   * M2 zoom, fusion beat: true hides the whole army (it has become the colossus the zoom draws);
   * false brings the crowd back as state says (the new tier's colossus-hero and its troops).
   */
  setFused?(fused: boolean): void;
  /**
   * M2 zoom hand-off: where the hero stands at rest in the current tier, the spot the colossus
   * becomes the hero at (world m, the feet): x = the dragon's rest front edge (dragon.bounds().x)
   * minus heroStandOff(dragon size) (render/crowd/formation.ts), y = 0.12 (just below the ground
   * line), drawn HERO_SCALE = 1.1 x a knight in the idle guard pose. Valid right after
   * setFused(false) (the hero snaps there with no march-in). Optional (null stand-ins).
   */
  heroRest?(out: Vec2): Vec2;
  /**
   * M2 zoom: start pre-baking the crowd's art (sprite sheets, banners, shields) for
   * paletteFor(tier) over the next frames, a bounded step per frame, so the palette swap at the
   * zoom's switch is instant. Call it when the rally starts. Optional (null stand-ins).
   */
  prepareTier?(tier: number): void;
}

/** A coat of arms (M1: placeholder red field, gold sword; M2 adds the full `coat`). */
export interface Heraldry {
  /** Field color (CSS hex): the coat's main field. */
  field: string;
  /** Charge color (CSS hex): the principal charge's tincture. */
  tincture: string;
  /** Principal charge id: 'sword' | 'none' in M1; any ChargeKind in M2. */
  charge: string;
  /**
   * M2: the full composition (render/heraldry coatOf). When present, banners and the hero's
   * shield paint it with drawCoat and the three fields above are summaries (plumes, trims).
   */
  coat?: Coat;
  /**
   * M2: play the purchase flourish (a gold light sweeping the cloth and the hero's shield) when
   * this description replaces a different coat. Unset for loads, resyncs and tier changes.
   */
  flourish?: boolean;
}
