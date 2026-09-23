// Champion portraits for the Champions tab: a heraldic bust in the scene's style (near-black
// silhouette with a warm rim light, set by CSS) with color only where heraldry puts it: the plume
// and the tabard. Facing right, toward the dragon, like every unit icon. 48×48 viewBox.
import type { ChampionId } from '../core';

const NS = 'http://www.w3.org/2000/svg';

interface Look {
  /** Plume / wings and tabard tinctures. */
  plume: string;
  plumeHi: string;
  /** The plume's shade (`L`). */
  shade: string;
  tabard: string;
  device: string;
  /** The card's hairline and the special-move bar. */
  accent: string;
  /** The silhouette (helm, shoulders); colored parts are drawn on top. */
  body: string;
  /** Colored parts: `P` plume, `H` its highlight, `L` its shade, `T` tabard, `D` device (replaced below). */
  color: string;
}

const LOOKS: Record<ChampionId, Look> = {
  // Ser Aldric the Mostly Brave, as the crowd draws him (render/crowd/champion.ts): a tall
  // sugarloaf helm under an argent plume shaded azure, and his own arms, azure a sun or (ALDRIC_ARMS),
  // on his tabard. (Not red: on the battlefield that would read as the hero.)
  aldric: {
    plume: '#f1ece0',
    plumeHi: '#ffffff',
    shade: '#2d4f93',
    tabard: '#2d4f93',
    device: '#ffd35a',
    accent: '#ffd35a',
    body:
      '<path d="M5 48c0-8.5 4.4-14.2 12.5-16.2h13C38.6 33.8 43 39.5 43 48z"/>' +
      '<path d="M8.6 38.4c2-3.8 5-5.8 9.4-6.4l1.2 4.6c-4.2.4-7.6 1-10.6 1.8zM39.4 38.4c-2-3.8-5-5.8-9.4-6.4l-1.2 4.6c4.2.4 7.6 1 10.6 1.8z" opacity=".9"/>' +
      '<path d="M19.5 26.5h9.5v6.4h-9.5z"/>' +
      // sugarloaf helm: a tall rounded point
      '<path d="M15.6 14.4c0-5.8 3.9-10.9 8.9-11.8 5 .9 9.1 6 9.1 11.8v10.4c0 2-1.6 3.6-3.6 3.6H19.2c-2 0-3.6-1.6-3.6-3.6z"/>' +
      '<path d="M25.3 15.1h8.4v1.5h-8.4z" fill="#ffd79a" opacity=".85"/>' +
      '<path d="M29 20.5h.01M31 20.5h.01M29 22.5h.01M31 22.5h.01" stroke="#ffd79a" stroke-width="1.1" stroke-linecap="round" opacity=".6"/>',
    color:
      // the plume rises from the helm's point and curls back: an azure shade under argent feathers
      '<path d="M24.8 3.8C21.6-.6 12.8-1 6.8 2.4 3.2 4.4 1.8 8.8 2.6 14.2c1.4-3.6 4-5.6 7.4-6 -2.8 1.8-4.2 4.8-4 8.4C8.6 12.8 12.2 10.8 16.6 10.6c-1.6 1.6-2.4 3.4-2.4 5.8 2.6-3.4 6-5.4 10.4-5.8.8-1.8 1-4.4.2-6.8z" fill="L"/>' +
      '<path d="M25 2.8C21.4-1.4 12.6-1.8 6.4 1.4 2.8 3.4 1.2 7.8 2 13.2c1.4-3.8 4-6 7.4-6.4-2.8 1.8-4.2 4.8-4 8.4C8 11.8 11.8 9.8 16.4 9.6c-1.8 1.6-2.6 3.4-2.6 5.8 2.6-3.4 6-5.4 10.4-5.8.8-1.8 1.4-4.4.8-6.8z" fill="P"/>' +
      '<path d="M23.4 3.4C19.6 0 12.6-.6 7.8 1.8 5 3.2 3.6 5.8 3.4 9c2-3.8 5.8-5.8 11.2-5.8 3.2 0 6.2.4 8.8.2z" fill="H" opacity=".8"/>' +
      '<path d="M17.4 34h13.2l-1.8 14H19.2z" fill="T"/>' +
      // a sun or: a disc with rays
      '<circle cx="24" cy="40.6" r="2.2" fill="D"/>' +
      '<path d="M24 36.2v1.6M24 43.4V45M19.6 40.6h1.6M26.8 40.6h1.6M20.9 37.5l1.1 1.1M26 42.6l1.1 1.1M27.1 37.5 26 38.6M22 42.6l-1.1 1.1" stroke="D" stroke-width=".9" stroke-linecap="round"/>',
  },
  // Dame Brunhild, Who Fears Nothing Except Geese: an open spangenhelm with a nasal and azure
  // wings, a long braid, a tabard of argent with an azure mountain.
  brunhild: {
    plume: '#2f5fb0',
    plumeHi: '#8fb8ff',
    shade: '#1d3868',
    tabard: '#e8e2d2',
    device: '#2f5fb0',
    accent: '#8fb8ff',
    body:
      '<path d="M5 48c0-8.5 4.4-14.2 12.5-16.2h13C38.6 33.8 43 39.5 43 48z"/>' +
      '<path d="M8.6 38.4c2-3.8 5-5.8 9.4-6.4l1.2 4.6c-4.2.4-7.6 1-10.6 1.8zM39.4 38.4c-2-3.8-5-5.8-9.4-6.4l-1.2 4.6c4.2.4 7.6 1 10.6 1.8z" opacity=".9"/>' +
      '<path d="M20.5 26.5h8.5v6.4h-8.5z"/>' +
      '<path d="M18.2 18.2h14.4l-.9 6.8c-.5 3-3.2 5-6.3 5-3.2 0-5.9-2.2-6.4-5.4z"/>' +
      '<path d="M17 18.4c0-7.4 3.4-12 8.4-12s8.6 4.6 8.6 12z"/>' +
      '<path d="M16.4 17.4h18.2v2.2H16.4z"/>' +
      '<path d="M25.9 18.8h1.8v6.6h-1.8z"/>' +
      '<path d="M18.4 20.2c-2.8 4-2.6 9.8-.6 14.6l1.9-.5c-1.4-4.2-1.4-9.2.5-13.2z"/>' +
      '<path d="M29.2 21.6h2.6" stroke="#ffd79a" stroke-width="1.1" stroke-linecap="round" opacity=".75"/>',
    color:
      // a feathered wing on the helm, swept back
      '<path d="M19.2 13.6C16.4 6.8 9.6 3 2.4 4.2c3.4 1 5.8 2.6 7.2 4.6C6.4 8 3.4 8.8 1.4 11c3.8-.6 7 0 9.4 1.6-3 .2-5.4 1.6-6.8 3.8 4.4-1.8 9.4-2 15.2-2.8z" fill="P"/>' +
      '<path d="M18.2 12C15.8 7.6 11 5.2 5.6 5.2c3.4 1.4 6 3.6 7.6 6.2 1.8.2 3.4.4 5 .6z" fill="H" opacity=".75"/>' +
      '<path d="M31.6 11.6c1.6-3.6 4.6-6 8.4-6.8-1.4 1.4-2.2 3-2.4 4.8 1.4-.8 3-1 4.6-.6-2 1-3.6 2.6-4.4 4.6z" fill="P" opacity=".75"/>' +
      '<path d="M17.4 34h13.2l-1.8 14H19.2z" fill="T"/>' +
      '<path d="M20.6 44l3.4-5.6 3.4 5.6z" fill="D"/>',
  },
};

/** The champion's bust (CSS gives the silhouette its fill and rim). */
export function championPortrait(id: ChampionId): SVGSVGElement {
  const look = LOOKS[id];
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('class', 'icon-portrait');
  s.setAttribute('aria-hidden', 'true');
  const color = look.color
    .replace(/fill="P"/g, `fill="${look.plume}"`)
    .replace(/fill="H"/g, `fill="${look.plumeHi}"`)
    .replace(/fill="T"/g, `fill="${look.tabard}"`)
    .replace(/fill="L"/g, `fill="${look.shade}"`)
    .replace(/fill="D"/g, `fill="${look.device}"`)
    .replace(/stroke="D"/g, `stroke="${look.device}"`);
  s.innerHTML = `<g class="portrait-body">${look.body}</g><g class="portrait-color">${color}</g>`;
  return s;
}

/** The champion's accent color (the card's hairline and the special-move bar). */
export function championAccent(id: ChampionId): string {
  return LOOKS[id].accent;
}
