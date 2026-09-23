// Contract: what the rest of the game may ask of the backdrop (scene.backdrop). Owned by
// render/backdrop. Add members freely; never change or remove existing ones.

/** The world wyrm's head on the Mountain horizon, as the zoom's reveal poses it (all 0..1). */
export interface WyrmPose {
  /** 0 = resting behind the ridge, 1 = reared high over it. */
  rise: number;
  /** 0 = shut, 1 = wide open. */
  eye: number;
  /** 0 = shut, 1 = roaring. */
  jaw: number;
}

export interface BackdropApi {
  /** Open the eye in the hills now (no-op while it is already open). */
  openEye(): void;
  /** Fires when an eye starts to open (audio hangs a rumble on it). Returns an unsubscribe. */
  onEyeOpen?(fn: () => void): () => void;
  /**
   * While on, never re-bake cached layers: the zoom director flies the camera through huge zoom
   * ranges, so draw the cached art scaled (soft is fine; the cinematic's motion hides it).
   */
  setTransition?(on: boolean): void;
  /** Pose the Mountain's world wyrm (the zoom's reveal); null hands it back to its own schedule. */
  wyrmPose?(pose: WyrmPose | null): void;
}
