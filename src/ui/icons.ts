// Inline SVG icons for the HUD and panel: unit silhouettes (in the scene's near-black-with-rim
// style), the gold coin, the speaker, toast emblems, and (M2) the ability glyphs, the iridescent
// Scale and the padlock. Built once at init; crisp at any DPR.
import type { UnitId } from '../core';

const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox: string, cls: string, inner: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}

// Silhouettes face right (toward the dragon), 40×40 box, feet on y = 38.
const UNIT_PATHS: Record<UnitId, string> = {
  // Great helm with a plume, kite shield, sword raised.
  footman:
    '<path d="M16 3c3-2 7-1 8 2l-3 1c-1-1-3-2-5-1z"/>' +
    '<path d="M14.5 7h7c1 0 1.5.8 1.5 2v4.5c0 1-.8 1.5-1.5 1.5h-7c-.8 0-1.5-.6-1.5-1.5V9c0-1.2.6-2 1.5-2z"/>' +
    '<path d="M13 16h10l2 9-2 4h-10l-2-4z"/>' +
    '<path d="M24 18l6-12 1.6.8-5.8 12.4z"/><path d="M27.5 9.5l4 2-.6 1.2-4-2z"/>' +
    '<path d="M8 17h8v7c0 4-2 7-4 8-2-1-4-4-4-8z"/>' +
    '<path d="M13.5 29h3.5l-1 9h-3.5zM19 29h3.5l1.5 9h-3.5z"/>',
  // Hooded archer, longbow drawn.
  archer:
    '<path d="M15 5c2-2 6-2 7.5 1l.5 7c0 1-1 2-2 2h-5c-1 0-2-1-2-2z"/>' +
    '<path d="M13.5 16h9l1.5 12h-12z"/>' +
    '<path d="M29 4c5 6 5 22 0 29l-1.2-.6c4.4-7 4.4-21 0-27.8z"/>' +
    '<path d="M28.4 4.8l.5 27.6-.6.1-.6-27.6z" opacity=".55"/>' +
    '<path d="M21 18.5l8-.2v1.4l-8 .3z"/><path d="M16 18h6v2h-6z"/>' +
    '<path d="M14 28h3.5l-1 10H13zM19 28h3.5l1.5 10h-3.5z"/>',
  // Lancer: a knight on a galloping destrier, lance couched, pennon flying.
  lancer:
    // horse: barrel, arched neck, head with ears; tail streaming; legs at full gallop (strokes)
    '<path d="M8 21c0-2.4 2-3.4 4.5-3.4h12c1.7 0 2.9-.8 3.7-2.2l2.4-4c.6-1 1.4-1.5 2.3-1.3l-.1-1.5 1.4 1.7c.8.3 1.4.9 1.9 1.7l2.5 3.6c.4.6 0 1.4-.7 1.4l-2.3.1c-.7 0-1.3-.3-1.7-.8l-.7-.8c-.6 2.1-1.6 4.1-2.8 5.9l-.8 3c-.4 2-2 3.2-4 3.2H12.6C10 27.6 8 25.6 8 23z"/>' +
    '<path d="M8.4 19.6c-2.9-.1-5.2 1.8-6.2 5 1.8-1.6 3.6-2.2 5.8-1.8z"/>' +
    '<path class="st" d="M26.5 26.5l3.5 4 4.5 2.3M24.5 27l2.3 4.2-2.2 4.4M11.5 26.8l-4 4.2-4 1.2M14 27.2l-1 4.8 2 4.4"/>' +
    // rider: torso, helm with plume, leg, kite shield
    '<path d="M17.6 17.8l.8-6.4c.1-.8.8-1.4 1.6-1.4h2.2c.8 0 1.3.6 1.3 1.4l.7 6.4z"/>' +
    '<path d="M18.8 4.8c.2-1.3 1.2-2 2.4-2 1.4 0 2.4.8 2.4 2.2v3.4c0 .8-.6 1.4-1.4 1.4h-2c-.8 0-1.4-.6-1.4-1.4z"/>' +
    '<path d="M19.2 3.6c-1.6-1.8-4.2-1.8-5.8-.2 1.8-.1 3.4.4 5.4 1.8z"/>' +
    '<path d="M20 17.4h2.4l.6 5.2-2 .4z"/>' +
    '<path d="M15.8 11.6h3.8v4c0 1.8-1.1 3-1.9 3.5-.8-.5-1.9-1.7-1.9-3.5z" opacity=".85"/>' +
    // lance couched under the arm, vamplate, pennon
    '<path d="M15.5 15.6l24.3-5.8.2 1.1-24.2 6z"/>' +
    '<path d="M22.4 13.4l.6 4 2.2-2z"/>' +
    '<path d="M35.2 11l-4.6-1.4.8 1.8-.8 1.2z" opacity=".8"/>',
};

export function unitIcon(unit: UnitId): SVGSVGElement {
  return svg('0 0 40 40', 'icon-unit', UNIT_PATHS[unit]);
}

let coinIds = 0;

export function coinIcon(cls = 'icon-coin'): SVGSVGElement {
  // Unique gradient id per icon: a url(#id) into a display:none SVG doesn't paint in every browser.
  const id = 'coin-g' + coinIds++;
  return svg(
    '0 0 32 32',
    cls,
    `<defs><radialGradient id="${id}" cx=".35" cy=".3" r=".8">` +
      '<stop offset="0" stop-color="#fff6c8"/><stop offset=".35" stop-color="#ffd35a"/>' +
      '<stop offset=".8" stop-color="#d88d1c"/><stop offset="1" stop-color="#9c5c0c"/></radialGradient></defs>' +
      `<circle cx="16" cy="16" r="14" fill="url(#${id})" stroke="#6e420b" stroke-width="1.5"/>` +
      '<circle cx="16" cy="16" r="9.5" fill="none" stroke="#8a5410" stroke-opacity=".55" stroke-width="1.2"/>' +
      '<path d="M16 9.5l1.9 4.1 4.4.4-3.3 2.9 1 4.4-4-2.3-4 2.3 1-4.4-3.3-2.9 4.4-.4z" fill="#a8680f" fill-opacity=".7"/>',
  );
}

export function speakerIcon(): SVGSVGElement {
  return svg(
    '0 0 24 24',
    'icon-speaker',
    '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>' +
      '<g class="sp-on" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M16 9.2c1 .8 1.4 1.8 1.4 2.8s-.4 2-1.4 2.8"/><path d="M18.4 6.6c1.7 1.4 2.6 3.3 2.6 5.4s-.9 4-2.6 5.4"/></g>' +
      '<g class="sp-off" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/></g>',
  );
}

// Toast emblems (gold line art in a small diamond frame drawn by CSS).
const TOAST_PATHS: Record<'unlock' | 'upgrade' | 'milestone', string> = {
  // Four-point star: something new.
  unlock: '<path d="M12 3l1.9 7.1L21 12l-7.1 1.9L12 21l-1.9-7.1L3 12l7.1-1.9z"/>',
  // Upright sword: an upgrade.
  upgrade:
    '<path d="M11.2 2.5h1.6l.6 11.5h-2.8z"/><path d="M7.5 14h9v1.6h-9z"/><path d="M11.1 15.6h1.8v3.4h-1.8z"/><circle cx="12" cy="20.3" r="1.4"/>',
  // Pennant banner: a milestone.
  milestone: '<path d="M6 2.5h1.5v19H6z"/><path d="M7.5 3.5H19l-3 4 3 4H7.5z"/>',
};

export function toastIcon(kind: 'unlock' | 'upgrade' | 'milestone'): SVGSVGElement {
  return svg('0 0 24 24', 'ui-toast-icon', TOAST_PATHS[kind]);
}

// ---- M2 ----

/** Ability glyphs (24×24, currentColor): a couched lance at the charge, a war banner, a fan of arrows. */
const ABILITY_PATHS: Record<'charge' | 'rally' | 'volley', string> = {
  charge:
    // shaft and head, vamplate, pennon, speed lines
    '<path d="M3.1 19.5l1.4 1.4 13.9-13.9-1.4-1.4z"/><path d="M16.9 5.5l1.6 1.6 3.3-5z"/>' +
    '<path d="M6.9 11.8l5.3 5.3-4.7.4z"/>' +
    '<path d="M14.1 8.3l-1.8 1.8-3.2-5.6 3.6 1.2z" opacity=".75"/>' +
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".6">' +
    '<path d="M10.5 21.5l4-4M14.5 22.2l3.2-3.2M18.5 22.5l2-2"/></g>',
  rally:
    // pole with finial, swallowtail banner with a star, cord
    '<circle cx="5.8" cy="2.4" r="1.5"/><path d="M5 3.6h1.6v18.2H5z"/>' +
    '<path fill-rule="evenodd" d="M6.6 4.3c3.6-1.2 7.2 1.3 13.8-.4l-2.9 4.6 2.9 4.7c-6.6 1.6-10.2-1-13.8.2zM12.6 6.1l.7 1.6 1.7.1-1.3 1.1.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.1 1.7-.1z"/>' +
    '<path d="M6.6 13.4l2.4 3-.9.6-1.5-1.9z" opacity=".7"/>',
  volley:
    // three arrows fanning up and right from one bow hand
    '<g stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
    '<path d="M4 20l13.7-13.7M4 20l14.6-7.5M4 20l7.5-14.6"/></g>' +
    '<path d="M20 4l-1.1 3.4-2.3-2.3zM21.5 11l-2.1 2.9-1.5-2.9zM13 2.5l-.1 3.6-2.8-1.5z"/>' +
    '<g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity=".7">' +
    '<path d="M5.3 16.4l1.4 2.3M7.2 17.6l-2.4 1M3 14.8c1.6 2.7 3.7 4.9 6.3 6.3"/></g>',
};

export function abilityIcon(id: 'charge' | 'rally' | 'volley'): SVGSVGElement {
  return svg('0 0 24 24', 'icon-ability', ABILITY_PATHS[id]);
}

let scaleIds = 0;

/**
 * A single dragon scale, iridescent (teal → violet → gold), the Scales currency. Unique gradient ids
 * per icon (see coinIcon).
 */
export function scaleIcon(cls = 'icon-scale'): SVGSVGElement {
  const g = 'scale-g' + scaleIds;
  const h = 'scale-h' + scaleIds++;
  return svg(
    '0 0 32 32',
    cls,
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">` +
      '<stop offset="0" stop-color="#b9fff0"/><stop offset=".3" stop-color="#46c6c9"/>' +
      '<stop offset=".62" stop-color="#7a5cd6"/><stop offset=".85" stop-color="#e2a94c"/><stop offset="1" stop-color="#ffe7a8"/></linearGradient>' +
      `<radialGradient id="${h}" cx=".38" cy=".3" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
      // a scale: rounded free edge at the bottom, the root tucked under at the top
      `<path d="M16 2.5c5.8 3 10.5 7.4 10.5 14.3 0 7-4.7 12.2-10.5 12.7C10.2 29 5.5 23.8 5.5 16.8 5.5 9.9 10.2 5.5 16 2.5z" fill="url(#${g})" stroke="#1d2340" stroke-width="1.3"/>` +
      '<path d="M16 6.5v19.5" stroke="#1d2340" stroke-opacity=".45" stroke-width="1.1" fill="none"/>' +
      '<path d="M16 12.5c-2.6 1.2-4.5 2.8-5.6 5M16 17c2.6 1.2 4.5 2.8 5.6 5" stroke="#1d2340" stroke-opacity=".3" stroke-width="1" fill="none"/>' +
      `<ellipse cx="12.5" cy="11" rx="4.2" ry="6" fill="url(#${h})" transform="rotate(-18 12.5 11)"/>`,
  );
}

export function lockIcon(): SVGSVGElement {
  return svg(
    '0 0 24 24',
    'icon-lock',
    '<path fill="none" stroke="currentColor" stroke-width="1.8" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>' +
      '<path fill-rule="evenodd" d="M6 10.5h12c.6 0 1 .4 1 1v8c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-8c0-.6.4-1 1-1zM12 13.6a1.5 1.5 0 0 0-.8 2.8v1.8h1.6v-1.8a1.5 1.5 0 0 0-.8-2.8z"/>',
  );
}
