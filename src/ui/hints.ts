// First-minute hints: one quiet italic line above the bottom of the stage, one at a time, each at
// most once per session. They teach the weak spot, the first hire, the army, the stagger and the
// growth, then get out of the way. Strings come from MICROCOPY (hint*) at runtime.
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

  // No crit a few seconds after starting: point at the weak spot.
  scene.input.onFirstGesture(() => {
    later(2600, () => {
      if (game.state.stats.crits === 0) show('hintWeakSpot');
    });
  });
  game.on('strike', (e) => {
    if (e.crit) hide('hintWeakSpot');
  });

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

  game.on('dragonPhase', (e) => {
    if (e.phase === 'windup' && game.state.kills >= 2) show('hintStagger');
    else if (e.phase !== 'windup') hide('hintStagger');
  });
}
