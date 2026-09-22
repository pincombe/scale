// Placeholder HUD (WP 0.2): gold counter (top-left, anchor 'gold'), dragon name + HP bar
// (top-center), toasts for unlocks and milestones. The HUD WP (1.6) restyles and extends it.
import { fmt, UNITS } from '../core';
import type { Scene } from '../app/scene';
import type { UiRoot } from './mount';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export function createHud(scene: Scene, ui: UiRoot): void {
  const hud = ui.regions.hud;

  const goldBox = el('div', 'hud-gold', hud);
  const coin = el('span', 'hud-coin', goldBox);
  const goldVal = el('span', 'hud-gold-val', goldBox, '0');
  ui.registerAnchor('gold', coin);

  const dragonBox = el('div', 'hud-dragon', hud);
  const nameEl = el('div', 'hud-dragon-name', dragonBox);
  const nameMain = el('span', 'hud-dragon-main', nameEl);
  const nameEpi = el('span', 'hud-dragon-epithet', nameEl);
  const bar = el('div', 'hud-hp', dragonBox);
  const fill = el('div', 'hud-hp-fill', bar);
  const hpText = el('div', 'hud-hp-text', dragonBox);

  let lastGold = '';
  let lastDragon = -1;
  let lastHp = '';
  let lastFrac = -1;

  ui.onRefresh(() => {
    const s = scene.game.state;
    const g = fmt(s.gold);
    if (g !== lastGold) {
      lastGold = g;
      goldVal.textContent = g;
    }
    const d = s.dragon;
    if (d.id !== lastDragon) {
      lastDragon = d.id;
      nameMain.textContent = d.name;
      nameEpi.textContent = ' ' + d.epithet;
    }
    const hp = fmt(d.hp) + ' / ' + fmt(d.maxHp);
    if (hp !== lastHp) {
      lastHp = hp;
      hpText.textContent = hp;
    }
    const frac = d.maxHp.gt(0) ? Math.max(0, Math.min(1, d.hp.div(d.maxHp).toNumber())) : 0;
    if (Math.abs(frac - lastFrac) > 0.001) {
      lastFrac = frac;
      fill.style.transform = `scaleX(${frac})`;
    }
  });

  const { game } = scene;
  game.on('unlock', (e) => {
    if (e.kind === 'unit') ui.toast(`${UNITS[e.id as keyof typeof UNITS]?.plural ?? e.id} may now be hired`, 'unlock');
    else if (e.kind === 'upgrade') ui.toast('New upgrade available', 'unlock');
  });
  game.on('milestone', (e) => ui.toast(`${UNITS[e.unit].plural} x${e.mult} at ${e.owned} strong`, 'milestone'));
  game.on('dragonDeath', () => ui.pulse('gold'));
}
