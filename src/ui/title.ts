// Placeholder title overlay (WP 0.2): the live meadow under a big serif title. It never blocks
// the pointer (the first click is also the first strike) and fades out on the first gesture.
import type { Scene } from '../app/scene';
import type { UiRoot } from './mount';

export function createTitle(scene: Scene, ui: UiRoot): void {
  const box = document.createElement('div');
  box.className = 'title';
  const h = document.createElement('h1');
  h.className = 'title-name';
  h.textContent = 'SCALE';
  const p = document.createElement('p');
  p.className = 'title-hint';
  p.textContent = 'Click to draw your sword.';
  box.append(h, p);
  ui.regions.overlay.appendChild(box);
  scene.input.onFirstGesture(() => {
    box.classList.add('title-gone');
    window.setTimeout(() => box.remove(), 1400);
  });
}
