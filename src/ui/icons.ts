// Inline SVG icons for the HUD and panel: unit silhouettes (in the scene's near-black-with-rim
// style), the gold coin and the speaker. Built once at init; crisp at any DPR.
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
