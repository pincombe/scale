// Per-tier color palette. Placeholder golden-hour meadow values; the backdrop WP (1.1) finalizes
// them. Dragon and crowd read `view.palette` for silhouette and rim colors, never hardcode them.

export interface SkyStop {
  /** 0 = top of the screen, 1 = the horizon line. */
  at: number;
  color: string;
}

export interface Palette {
  name: string;
  /** Sky gradient from the top of the screen down to the horizon. */
  sky: readonly SkyStop[];
  /** Screen-height fraction of the horizon at the base framing (the sky gradient ends here). */
  horizon: number;
  sun: {
    /** Position as fractions of the viewport (x of width, y of height). */
    x: number;
    y: number;
    /** Disc radius as a fraction of viewport height. */
    radius: number;
    color: string;
    glow: string;
    /** Glow radius as a fraction of viewport height. */
    glowRadius: number;
  };
  /** Atmospheric-perspective target: far silhouettes fade toward this. */
  haze: string;
  /** Near-black, slightly warm: knights, dragons, near land. */
  silhouette: string;
  /** Rim light on the sun-facing edges of silhouettes. */
  rim: string;
  /** Rim thickness in CSS px at the stage plane. */
  rimWidth: number;
  /** Screen-space unit vector pointing toward the light (for rim offsets). */
  light: { x: number; y: number };
  ground: string;
  vignette: string;
  /** 0..1 darkness at the corners. */
  vignetteStrength: number;
  accent: {
    gold: string;
    fire: string;
    ember: string;
    /** Weak-spot glow. */
    weak: string;
    banner: string;
    heraldBlue: string;
    /** Hot white-gold for flashes and sparks. */
    glow: string;
  };
  /** Tint for ambient drifting particles (fireflies, dust motes). */
  ambient: string;
  /**
   * Optional mid-distance tint: atmospheric perspective runs haze -> depthTint -> silhouette
   * (far -> near), so middle layers pick up a hue instead of a muddy linear mix.
   */
  depthTint?: string;
}

function unit(x: number, y: number): { x: number; y: number } {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export const MEADOW: Palette = {
  name: 'meadow',
  // Golden hour: deep violet-indigo overhead, rose, ember orange, pale gold at the horizon.
  sky: [
    { at: 0, color: '#1b1333' },
    { at: 0.24, color: '#3a2253' },
    { at: 0.47, color: '#8a3a5e' },
    { at: 0.69, color: '#d9683f' },
    { at: 0.86, color: '#f5a453' },
    { at: 1, color: '#ffe2a3' },
  ],
  horizon: 0.66,
  // The backdrop places the sun at stageCX + 0.27 * viewH, 0.56 * viewH (x here is that point on
  // a 1440 x 900 viewport with the panel closed). `light` points from the stage toward it.
  sun: { x: 0.67, y: 0.56, radius: 0.062, color: '#fff4d6', glow: '#ffb259', glowRadius: 0.6 },
  haze: '#ec9d6b',
  depthTint: '#7c3d5b',
  silhouette: '#170d10',
  rim: '#ffcf85',
  rimWidth: 1.8,
  light: unit(0.85, -0.53),
  ground: '#24130f',
  vignette: '#140805',
  vignetteStrength: 0.55,
  accent: {
    gold: '#ffd35a',
    fire: '#ff7a1f',
    ember: '#ff4a14',
    weak: '#ffe07a',
    banner: '#b3202a',
    heraldBlue: '#2d4f93',
    glow: '#fff1c4',
  },
  ambient: '#ffe9a8',
};

/**
 * The Mountain (tier 1): alpenglow dusk (WP 2.3). The sun has just set behind the far coils: a
 * warm band on the horizon under a sky running rose -> violet -> deep blue, the first stars. The
 * afterglow sits low, right of the stage center (the backdrop places it at stageCX + 0.14 * viewH,
 * 0.655 * viewH), so rims are rose-gold and nearly horizontal; shadows lean blue-violet.
 */
export const MOUNTAIN: Palette = {
  name: 'mountain',
  sky: [
    { at: 0, color: '#0b0f2c' },
    { at: 0.22, color: '#1b1d4a' },
    { at: 0.46, color: '#3d2f66' },
    { at: 0.66, color: '#7c4675' },
    { at: 0.82, color: '#c9627a' },
    { at: 0.93, color: '#f08d78' },
    { at: 1, color: '#ffc38c' },
  ],
  horizon: 0.66,
  sun: { x: 0.64, y: 0.655, radius: 0.05, color: '#ffe2b8', glow: '#ff9866', glowRadius: 0.62 },
  haze: '#b27796',
  depthTint: '#3b3668',
  silhouette: '#110b16',
  rim: '#ffb596',
  rimWidth: 1.8,
  light: unit(0.9, -0.44),
  ground: '#19111f',
  vignette: '#08061a',
  vignetteStrength: 0.6,
  accent: {
    gold: '#ffd35a',
    fire: '#ff7a1f',
    ember: '#ff4a14',
    weak: '#ffe07a',
    banner: '#b3202a',
    heraldBlue: '#2d4f93',
    glow: '#fff1c4',
  },
  ambient: '#ece6ff',
};

/** Palettes by tier (M3 adds the Kingdom, Sky and World). */
export const PALETTES: readonly Palette[] = [MEADOW, MOUNTAIN];

/** The palette of a tier (the last one for tiers without their own yet). */
export function paletteFor(tier: number): Palette {
  return PALETTES[Math.max(0, Math.min(PALETTES.length - 1, Math.floor(tier)))]!;
}
