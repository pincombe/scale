// The Scales counter (top-left, under the gold; anchor 'scales'): an iridescent scale and the
// count. Appears with `feature.scales`. A gain counts up with a pulse and a rising "+N Scales"; a
// zoom pays its Scales under the cinematic, so that count-up waits until the HUD is back.
import './scales.css';
import { MICROCOPY, fmt } from '../core';
import type { Scene } from '../app/scene';
import { cinematicOf } from './cinematic';
import { el, setText } from './dom';
import { scaleIcon } from './icons';
import type { UiRoot } from './mount';

const HOLD_S = 0.25;
/** After the zoom cinematic, let the HUD fade back in before the count-up (s). */
const HOLD_AFTER_ZOOM_S = 0.9;
const COUNT_S = 0.9;

export function createScales(scene: Scene, ui: UiRoot, box: HTMLElement): void {
  const { game } = scene;
  const cine = cinematicOf(scene, ui);
  const row = el('div', 'hud-scales', box);
  row.hidden = true;
  const icon = el('span', 'hud-scale-icon', row);
  icon.appendChild(scaleIcon());
  const val = el('span', 'hud-scales-val', row, '0');
  ui.registerAnchor('scales', icon);

  let shown = 0;
  let target = 0;
  let from = 0;
  let t = -1;
  let hold = 0;
  /** Scales gained since the count-up started (for the rising label). */
  let gain = 0;
  let lastText = '';
  let afterCine = false;

  let lastShown = Number.NaN;
  const show = (x: number): void => {
    const r = Math.round(x);
    if (r === lastShown) return;
    lastShown = r;
    const text = Number.isFinite(x) ? fmt(r) : fmt(game.state.scales);
    if (text !== lastText) {
      lastText = text;
      val.textContent = text;
    }
  };

  const snap = (): void => {
    target = game.state.scales.toNumber();
    shown = target;
    t = -1;
    gain = 0;
    show(shown);
  };

  const rise = (amount: number): void => {
    if (!(amount > 0)) return;
    const text = (MICROCOPY.scalesGain ?? '+{amount} Scales').replace('{amount}', fmt(Math.round(amount)));
    const tag = el('span', 'hud-scales-gain', row, text);
    window.setTimeout(() => tag.remove(), 1900);
  };

  game.on('resync', () => {
    // A zoom's switch resyncs too: keep the old count on screen so the gain can count up later.
    if (!cine.on) snap();
  });

  ui.onFrame((dt) => {
    if (cine.on) afterCine = true;
    if (row.hidden || cine.on) return;
    const g = game.state.scales.toNumber();
    if (g !== target) {
      if (!Number.isFinite(g) || g < shown) {
        // Spent (heraldry): no counting down.
        target = g;
        shown = g;
        t = -1;
        gain = 0;
      } else {
        if (t < 0) {
          from = shown;
          hold = afterCine ? HOLD_AFTER_ZOOM_S : HOLD_S;
          gain = 0;
        }
        gain += g - target;
        target = g;
        t = 0;
      }
    }
    if (t >= 0) {
      if (hold > 0) {
        hold -= dt;
        if (hold <= 0) {
          rise(gain);
          ui.pulse('scales');
        }
      } else {
        t += dt;
        const k = Math.min(1, t / COUNT_S);
        shown = from + (target - from) * (1 - Math.pow(1 - k, 3));
        if (k >= 1) {
          shown = target;
          t = -1;
          row.classList.remove('bump');
          void row.offsetWidth;
          row.classList.add('bump');
        }
      }
    }
    afterCine = false;
    show(shown);
  });

  ui.onRefresh(() => {
    const s = game.state;
    if (!s.flags['feature.scales'] || !row.hidden) return;
    // Revealed: from 0 when it happens in play (the gain counts up), else just be right.
    row.hidden = false;
    row.classList.add('enter');
    if (scene.input.hasStarted) {
      shown = 0;
      target = 0;
      t = -1;
      setText(val, '0');
      lastText = '0';
      lastShown = 0;
    } else snap();
    ui.invalidateAnchors();
  });
}
