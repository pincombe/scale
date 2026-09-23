// First-minute hints: one quiet italic line above the bottom of the stage, one at a time, each at
// most once per session. They teach the first hire, the army and the growth, then get out of the
// way. Strings come from MICROCOPY (hint*) at runtime.
//
// The weak spot and the stagger are taught in the world instead, by the coach mark beside the glow
// (render/fx/coach.ts). So the two never fight for the same spot, this registers the caption as
// the UI anchor 'hint' (hud.ts registers the Hire button as 'hire'); the coach keeps clear of both.
import { MICROCOPY } from '../core';
import type { Scene } from '../app/scene';
import { el } from './dom';
import type { UiRoot } from './mount';

const SHOW_MS = 4600;

export function createHints(scene: Scene, ui: UiRoot): void {
  const { game } = scene;
  const line = el('div', 'hint', ui.stage);
  line.hidden = true;
  const shown = new Set<string>();
  let hideTimer = 0;
  let current = '';

  const hide = (key?: string): void => {
    if (key !== undefined && key !== current) return;
    current = '';
    line.classList.remove('on');
    // Out of layout once faded, so its 'hint' anchor reads null (the coach may use the space).
    window.setTimeout(() => {
      if (current === '') line.hidden = true;
    }, 650);
  };

  const show = (key: string): void => {
    const text = MICROCOPY[key];
    if (!text || shown.has(key)) return;
    shown.add(key);
    current = key;
    line.textContent = text;
    line.hidden = false;
    line.classList.remove('on');
    void line.offsetWidth; // restart the fade-in
    line.classList.add('on');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => hide(key), SHOW_MS);
  };

  const later = (ms: number, fn: () => void): void => {
    window.setTimeout(fn, ms);
  };

  // Keep-out anchor for the coach mark (null while hidden, so only what's on screen counts). The
  // lone Hire button registers its own ('hire', ui/hud.ts).
  ui.registerAnchor('hint', line);

  game.on('dragonDeath', () => {
    const s = game.state;
    if (s.kills === 1 && s.units.footman === 0) {
      show('hintFirstKill');
      later(3200, () => {
        if (game.state.units.footman === 0) show('hintHireFootman');
      });
    }
    if (s.kills === 4) show('hintGrowth');
  });

  game.on('purchase', (e) => {
    if (e.kind === 'unit') hide('hintHireFootman');
    if (e.kind === 'unit' && e.id === 'footman' && game.state.units.footman === e.amount) later(900, () => show('hintArmy'));
  });
}
