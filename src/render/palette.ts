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
}

function unit(x: number, y: number): { x: number; y: number } {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export const MEADOW: Palette = {
  name: 'meadow',
  sky: [
    { at: 0, color: '#241a36' },
    { at: 0.3, color: '#5a3354' },
    { at: 0.58, color: '#c0613f' },
    { at: 0.82, color: '#f0a656' },
    { at: 1, color: '#ffd98f' },
  ],
  horizon: 0.66,
  sun: { x: 0.74, y: 0.6, radius: 0.055, color: '#fff2c9', glow: '#ffb45a', glowRadius: 0.55 },
  haze: '#e89a5c',
  silhouette: '#150d0b',
  rim: '#ffcf85',
  rimWidth: 1.6,
  light: unit(0.85, -0.52),
  ground: '#2a1a12',
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
