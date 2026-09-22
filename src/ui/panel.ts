// Placeholder right panel (WP 0.2): hire units and buy upgrades. Opens once 'feature.panel' is
// unlocked (after the first kill), which also re-frames the camera into the uncovered stage.
// The HUD WP (1.6) replaces this with the real Army / Upgrades tabs.
import { fmt, UNIT_IDS, UNITS, UPGRADES, unitCost, upgradeCost } from '../core';
import type { UnitId } from '../core';
import type { Scene } from '../app/scene';
import type { UiRoot } from './mount';

interface Row {
  root: HTMLElement;
  button: HTMLButtonElement;
  label: HTMLElement;
  last: string;
}

export function createPanel(scene: Scene, ui: UiRoot): void {
  const panel = ui.regions.panel;
  const head = document.createElement('div');
  head.className = 'panel-title';
  head.textContent = 'The Army';
  panel.appendChild(head);
  const list = document.createElement('div');
  list.className = 'panel-list interactive';
  panel.appendChild(list);

  const makeRow = (onClick: () => void): Row => {
    const root = document.createElement('div');
    root.className = 'panel-row';
    const label = document.createElement('div');
    label.className = 'panel-label';
    const button = document.createElement('button');
    button.className = 'panel-buy';
    button.addEventListener('click', onClick);
    root.append(label, button);
    root.hidden = true;
    list.appendChild(root);
    return { root, button, label, last: '' };
  };

  const unitRows = new Map<UnitId, Row>();
  for (const id of UNIT_IDS) {
    unitRows.set(
      id,
      makeRow(() => scene.game.dispatch({ type: 'buyUnit', unit: id, amount: 1 })),
    );
  }
  const upgradeRows = new Map<string, Row>();
  for (const u of UPGRADES) {
    upgradeRows.set(
      u.id,
      makeRow(() => scene.game.dispatch({ type: 'buyUpgrade', id: u.id })),
    );
  }

  let autoOpened = false;
  ui.onRefresh(() => {
    const s = scene.game.state;
    if (s.flags['feature.panel'] && !autoOpened) {
      autoOpened = true;
      ui.setPanelOpen(true);
    }
    if (!ui.panelOpen) return;
    for (const id of UNIT_IDS) {
      const row = unitRows.get(id)!;
      const show = !!s.flags[UNITS[id].unlockFlag];
      row.root.hidden = !show;
      if (!show) continue;
      const cost = unitCost(s, id);
      const key = `${s.units[id]}|${fmt(cost)}`;
      if (key !== row.last) {
        row.last = key;
        row.label.textContent = `${UNITS[id].name}  ×${s.units[id]}`;
        row.button.textContent = `Hire · ${fmt(cost)}`;
      }
      row.button.disabled = s.gold.lt(cost);
    }
    for (const u of UPGRADES) {
      const row = upgradeRows.get(u.id)!;
      const show = !!s.flags['upgrade.' + u.id] && (s.upgrades[u.id] ?? 0) === 0;
      row.root.hidden = !show;
      if (!show) continue;
      const cost = upgradeCost(u.id)!;
      if (row.last === '') {
        row.last = u.id;
        row.label.textContent = u.name;
        row.label.title = u.flavor;
        row.button.textContent = `Buy · ${fmt(cost)}`;
      }
      row.button.disabled = s.gold.lt(cost);
    }
  });
}
