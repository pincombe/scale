// Title overlay (0:00): the live meadow under a huge shimmering SCALE, an italic tagline and a
// gently pulsing call to strike. It never blocks the pointer (the first click is also the first
// strike) and lifts away on the first gesture. Strings come from MICROCOPY at runtime.
import { MICROCOPY } from '../core';
import type { Scene } from '../app/scene';
import { el } from './dom';
import type { UiRoot } from './mount';

export function createTitle(scene: Scene, ui: UiRoot): void {
  const box = el('div', 'title', ui.regions.overlay);
  const name = MICROCOPY.title || 'SCALE';
  const h = el('h1', 'title-name', box);
  // The letters are drawn twice: a solid, glowing base and a clipped shimmer sweep on top.
  el('span', 'title-base', h, name);
  el('span', 'title-shine', h, name).setAttribute('aria-hidden', 'true');
  el('div', 'title-rule', box);
  const tagline = MICROCOPY.tagline;
  if (tagline) el('p', 'title-tagline', box, tagline);
  el('p', 'title-hint', box, MICROCOPY.clickToStart || 'Click to draw your sword.');

  scene.input.onFirstGesture(() => {
    box.classList.add('title-gone');
    window.setTimeout(() => box.remove(), 1600);
  });
}
