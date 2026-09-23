// Contract: the zoom director (scene.zoom). Owned by render/zoom (WP 2.1).
// Add members freely; never change or remove existing ones.

/**
 * The cinematic's beats, in order (PLAN §4.5). Audio (music + SFX) and UI sync to them:
 *   rally     horns; knights rush to the center with banners high; the ground trembles
 *   fusion    the crowd piles up and glows
 *   flash     the fusion flash: the colossus stands in the meadow (its boots fill the screen)
 *   pullback  the continuous zoom-out begins (the new tier is in state from here)
 *   reveal    the world wyrm's head rises over the ridge; its eye opens
 *   roar      it roars
 *   card      the tier title card
 *   done      play resumes (the camera is back with the in-tier director)
 */
export type ZoomBeat = 'rally' | 'fusion' | 'flash' | 'pullback' | 'reveal' | 'roar' | 'card' | 'done';

export interface ZoomApi {
  /** True while the zoom cinematic owns the screen (from zoomBegin until play resumes). */
  readonly active: boolean;
  /** Subscribe to the cinematic's beats. Returns an unsubscribe. */
  onBeat(fn: (beat: ZoomBeat) => void): () => void;
}
