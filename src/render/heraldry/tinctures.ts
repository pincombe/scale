// Painted tinctures: each has a base, a lit and a shaded tone (for the sheen gradients), and the
// ink its engraved lines use (sable takes a light line, or its detail would vanish).
import type { Tincture } from './coat';

export interface Paint {
  base: string;
  light: string;
  dark: string;
  /** Engraved detail lines drawn on this tincture. */
  line: string;
}

export const PAINT: Readonly<Record<Tincture, Paint>> = {
  or: { base: '#e7b340', light: '#ffe396', dark: '#a8701d', line: '#6b3f12' },
  argent: { base: '#e9e5da', light: '#ffffff', dark: '#a9a498', line: '#5a5550' },
  // Gules is the M1 banner red (MEADOW.accent.banner).
  gules: { base: '#b3202a', light: '#dc4a3e', dark: '#6c0f18', line: '#3e070c' },
  azure: { base: '#2a58a8', light: '#5285d6', dark: '#152f63', line: '#0c1a3a' },
  vert: { base: '#2c7c4a', light: '#55a76b', dark: '#154a2b', line: '#0b2b18' },
  purpure: { base: '#71398a', light: '#9a60b2', dark: '#3f1d50', line: '#220d2c' },
  sable: { base: '#241b20', light: '#4f4148', dark: '#0e0a0c', line: '#6d5c64' },
};

/** The dark outline around charges and the shield (warm near-black, like the silhouettes). */
export const INK = '#1a0f12';
