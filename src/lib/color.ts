// Color helpers. Canvas wants CSS strings, and building strings per frame allocates, so the
// per-frame helpers here (rgba, AlphaRamp, ColorRamp) return cached strings.
import { clamp01 } from './math';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse '#rgb' or '#rrggbb' into out (0..255 channels). Invalid input yields black. */
export function parseHex(hex: string, out: RGB = { r: 0, g: 0, b: 0 }): RGB {
  let h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) {
    out.r = out.g = out.b = 0;
    return out;
  }
  out.r = (n >> 16) & 255;
  out.g = (n >> 8) & 255;
  out.b = n & 255;
  return out;
}

function hex2(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v)));
  return (n < 16 ? '0' : '') + n.toString(16);
}

export function toHex(r: number, g: number, b: number): string {
  return '#' + hex2(r) + hex2(g) + hex2(b);
}

export function rgbaString(r: number, g: number, b: number, a: number): string {
  return 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + (Math.round(clamp01(a) * 1000) / 1000) + ')';
}

const tmpA: RGB = { r: 0, g: 0, b: 0 };
const tmpB: RGB = { r: 0, g: 0, b: 0 };

/** Mix two hex colors (t = 0 -> a, 1 -> b). Allocates a string: use at init or behind a cache. */
export function mixHex(a: string, b: string, t: number): string {
  parseHex(a, tmpA);
  parseHex(b, tmpB);
  return toHex(tmpA.r + (tmpB.r - tmpA.r) * t, tmpA.g + (tmpB.g - tmpA.g) * t, tmpA.b + (tmpB.b - tmpA.b) * t);
}

/** Lighten (amount > 0) toward white or darken (amount < 0) toward black. Allocates. */
export function shade(hex: string, amount: number): string {
  return amount >= 0 ? mixHex(hex, '#ffffff', amount) : mixHex(hex, '#000000', -amount);
}

/**
 * One color at many alphas, as cached 'rgba()' strings. Alpha is quantized to `steps` levels.
 * `at(alpha)` never allocates after the first call for a given level.
 */
export class AlphaRamp {
  private readonly cache: (string | undefined)[];
  private readonly rgb: RGB;

  constructor(hex: string, readonly steps = 64) {
    this.rgb = parseHex(hex, { r: 0, g: 0, b: 0 });
    this.cache = new Array<string | undefined>(steps + 1);
  }

  at(alpha: number): string {
    const i = Math.round(clamp01(alpha) * this.steps);
    let s = this.cache[i];
    if (s === undefined) {
      s = rgbaString(this.rgb.r, this.rgb.g, this.rgb.b, i / this.steps);
      this.cache[i] = s;
    }
    return s;
  }
}

/**
 * A multi-stop gradient sampled by t in [0, 1], as cached '#rrggbb' strings (quantized to `steps`).
 * Use for per-frame color animation (sky tint over time, heat glow) without string building.
 */
export class ColorRamp {
  private readonly cache: string[];

  constructor(stops: readonly string[], readonly steps = 64) {
    this.cache = new Array<string>(steps + 1);
    const n = stops.length;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (n === 1) {
        this.cache[i] = stops[0]!;
        continue;
      }
      const f = t * (n - 1);
      const k = Math.min(n - 2, Math.floor(f));
      this.cache[i] = mixHex(stops[k]!, stops[k + 1]!, f - k);
    }
  }

  at(t: number): string {
    return this.cache[Math.round(clamp01(t) * this.steps)]!;
  }
}

const rampCache = new Map<string, AlphaRamp>();

/**
 * Cached 'rgba()' for a hex color at an alpha (quantized to 1/64). Allocation-free after warm-up
 * for each distinct hex. Prefer holding an AlphaRamp yourself on very hot paths.
 */
export function rgba(hex: string, alpha: number): string {
  let r = rampCache.get(hex);
  if (r === undefined) {
    r = new AlphaRamp(hex);
    rampCache.set(hex, r);
  }
  return r.at(alpha);
}
