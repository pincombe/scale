// Contract: the generative music engine (scene.music). Owned by audio/music (WP 2.6).
// Add members freely; never change or remove existing ones.

export interface MusicApi {
  /** True once the music has started (after the first gesture unlocks audio). */
  readonly playing: boolean;
  /** What the music is doing: 'silent' | 'meadow' | 'mountain' | 'boss' | 'zoom'. */
  readonly mood?: string;
  /**
   * Dip the music by `db` (negative) for `seconds`, then recover over ~0.5 s. For a big SFX moment
   * that must stand alone (e.g. a boss horn). Clicks and crits don't need it: the music keeps the
   * 1-4 kHz band light.
   */
  duck?(db: number, seconds: number): void;
}
