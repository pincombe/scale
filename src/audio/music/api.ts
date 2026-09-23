// Contract: the generative music engine (scene.music). Owned by audio/music (WP 2.6).
// Add members freely; never change or remove existing ones.

export interface MusicApi {
  /** True once the music has started (after the first gesture unlocks audio). */
  readonly playing: boolean;
}
