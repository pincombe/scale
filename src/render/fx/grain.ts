// Film grain as a CSS overlay (not a canvas pass): a pre-generated noise tile as the background of
// a fixed, pointer-events:none element inserted right before #ui, blended with 'overlay' by the
// compositor and jittered at 24 fps with a steps() animation. It costs no canvas fill per frame and
// stays out of M2's drawScene() snapshots. The tile is drawn at device resolution so grains stay
// one device pixel on Retina.
import { context2d, makeCanvas } from '../atlas';

const TILE = 192;
const OPACITY = 0.1;
const STYLE_ID = 'fx-grain-style';

export interface Grain {
  el: HTMLElement | null;
  setAnimated(on: boolean): void;
}

function noiseTile(): string {
  const c = makeCanvas(TILE, TILE);
  const ctx = context2d(c);
  const img = ctx.createImageData(TILE, TILE);
  let s = 0x3c6ef372;
  const rnd = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296 - 0.5;
  };
  // Two octaves (fine + slightly clumpier) read as film rather than digital static.
  const half = TILE / 2;
  const coarse = new Float32Array(half * half);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = 128 + (rnd() * 0.75 + coarse[(y >> 1) * half + (x >> 1)]! * 0.45) * 200;
      const i = (y * TILE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Base64 payload only: the caller writes the 'data:' prefix literally (see createGrain).
  const url = c.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}

export function createGrain(): Grain {
  const ui = typeof document !== 'undefined' ? document.getElementById('ui') : null;
  if (!ui || !ui.parentNode) return { el: null, setAnimated: () => undefined };
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = TILE / dpr;
  if (!document.getElementById(STYLE_ID)) {
    // 8 jumps per cycle at 24 fps; offsets are arbitrary non-repeating fractions of the tile.
    const offs = [
      [0, 0],
      [0.37, 0.61],
      [0.73, 0.19],
      [0.11, 0.83],
      [0.59, 0.43],
      [0.89, 0.71],
      [0.23, 0.29],
      [0.67, 0.93],
    ];
    const frames = offs
      .map(([x, y], i) => `${((i / offs.length) * 100).toFixed(2)}%{background-position:${(x! * size).toFixed(1)}px ${(y! * size).toFixed(1)}px}`)
      .join('');
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      `@keyframes fx-grain{${frames}}` +
      `.fx-grain{position:fixed;inset:0;pointer-events:none;mix-blend-mode:overlay;opacity:${OPACITY};` +
      `background-size:${size}px ${size}px;animation:fx-grain ${(offs.length / 24).toFixed(3)}s steps(1,end) infinite}` +
      `.fx-grain.still{animation:none}`;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.className = 'fx-grain';
  el.setAttribute('aria-hidden', 'true');
  // The literal data: prefix keeps scripts/check-size.mjs from flagging this as an external url().
  el.style.backgroundImage = `url(data:image/png;base64,${noiseTile()})`;
  ui.parentNode.insertBefore(el, ui);
  return {
    el,
    setAnimated(on) {
      el.classList.toggle('still', !on);
    },
  };
}
