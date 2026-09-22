// Right panel (340 px): Army and Upgrades tabs. Slides in once 'feature.panel' is set (the camera
// re-frames into the uncovered stage via setPanelOpen). Rows and cards are built once and only
// shown, hidden and re-texted at 10 Hz when their values change. One pulsing call to action marks
// the most important buy. Champions and Heraldry tabs arrive in M2.
import { BUY_MAX, MICROCOPY, UNITS, UNIT_IDS, UPGRADES, fmt, sel } from '../core';
import type { GameState, UnitId, UpgradeDef } from '../core';
import type { Scene } from '../app/scene';
import { el, gameButton, setClass, setShown, setText } from './dom';
import { effectLine } from './effectText';
import { coinIcon, unitIcon } from './icons';
import type { UiRoot } from './mount';

type Tab = 'army' | 'upgrades';
/** How long a just-affordable button shimmers (ms). */
const FRESH_MS = 1400;
/** A bought upgrade card lingers this long for its exit animation (ms). */
const BOUGHT_MS = 450;

/** Tracks affordability to flash "just became affordable" once per false → true edge. */
class Afford {
  private was = false;
  private until = 0;
  constructor(private readonly target: HTMLElement) {}
  set(can: boolean, now: number): void {
    if (can && !this.was) this.until = now + FRESH_MS;
    this.was = can;
    setClass(this.target, 'can', can);
    setClass(this.target, 'off', !can);
    setClass(this.target, 'fresh', can && now < this.until);
  }
}

interface BuyBtn {
  b: HTMLButtonElement;
  label: HTMLElement;
  cost: HTMLElement;
  afford: Afford;
}

interface UnitRow {
  id: UnitId;
  root: HTMLElement;
  owned: HTMLElement;
  dps: HTMLElement;
  next: HTMLElement;
  msFill: HTMLElement;
  one: BuyBtn;
  ten: BuyBtn;
  max: BuyBtn;
}

interface UpgradeCard {
  def: UpgradeDef;
  root: HTMLButtonElement;
  cost: HTMLElement;
  effect: HTMLElement;
  afford: Afford;
  boughtAt: number;
}

export function createPanel(scene: Scene, ui: UiRoot): void {
  const panel = ui.regions.panel;
  panel.classList.add('interactive');
  const state = (): GameState => scene.game.state;
  const now = (): number => performance.now();

  // ---- tabs ----
  const head = el('div', 'panel-head', panel);
  const tabs = el('div', 'panel-tabs', head);
  const body = el('div', 'panel-body', panel);
  const pages: Record<Tab, HTMLElement> = {
    army: el('div', 'panel-page', body),
    upgrades: el('div', 'panel-page', body),
  };
  let active: Tab = 'army';
  const tabBtn = (tab: Tab, text: string): { b: HTMLButtonElement; badge: HTMLElement } => {
    const b = gameButton('panel-tab', tabs, () => true, () => select(tab));
    el('span', 'panel-tab-text', b, text);
    const badge = el('span', 'panel-tab-badge', b);
    badge.hidden = true;
    return { b, badge };
  };
  const armyTab = tabBtn('army', 'Army');
  const upgTab = tabBtn('upgrades', 'Upgrades');
  upgTab.b.hidden = true;
  const select = (tab: Tab): void => {
    active = tab;
    setClass(armyTab.b, 'active', tab === 'army');
    setClass(upgTab.b, 'active', tab === 'upgrades');
    setShown(pages.army, tab === 'army');
    setShown(pages.upgrades, tab === 'upgrades');
    body.scrollTop = 0;
    refresh();
  };

  // ---- army ----
  const armyEmpty = el('p', 'panel-empty', pages.army);
  const buyBtn = (parent: HTMLElement, unit: UnitId, amount: number): BuyBtn => {
    const can = (): boolean => (amount === BUY_MAX ? sel.maxAffordable(state(), unit) > 0 : sel.unitAffordable(state(), unit, amount));
    const b = gameButton('buy', parent, can, () => scene.game.dispatch({ type: 'buyUnit', unit, amount }));
    const label = el('span', 'buy-label', b);
    const costRow = el('span', 'buy-cost', b);
    costRow.appendChild(coinIcon('icon-coin-xs'));
    const cost = el('span', '', costRow);
    return { b, label, cost, afford: new Afford(b) };
  };
  const unitRows: UnitRow[] = UNIT_IDS.map((id) => {
    const root = el('div', 'unit-row', pages.army);
    root.hidden = true;
    const top = el('div', 'unit-top', root);
    const icon = el('div', 'unit-icon', top);
    icon.appendChild(unitIcon(id));
    const info = el('div', 'unit-info', top);
    const nameRow = el('div', 'unit-name-row', info);
    const name = el('span', 'unit-name', nameRow, UNITS[id].plural);
    name.title = UNITS[id].flavor;
    const owned = el('span', 'unit-owned', nameRow);
    const stats = el('div', 'unit-stats', info);
    const dps = el('span', 'unit-dps', stats);
    const next = el('span', 'unit-next', stats);
    const ms = el('div', 'unit-ms', info);
    const msFill = el('div', 'unit-ms-fill', ms);
    const buys = el('div', 'unit-buys', root);
    const one = buyBtn(buys, id, 1);
    const ten = buyBtn(buys, id, 10);
    const max = buyBtn(buys, id, BUY_MAX);
    return { id, root, owned, dps, next, msFill, one, ten, max };
  });

  // ---- upgrades ----
  const upgEmpty = el('p', 'panel-empty', pages.upgrades);
  const cards: UpgradeCard[] = UPGRADES.map((def) => {
    const root = gameButton('upg-card', pages.upgrades, () => sel.upgradeAffordable(state(), def.id), () =>
      scene.game.dispatch({ type: 'buyUpgrade', id: def.id }),
    );
    root.hidden = true;
    const top = el('span', 'upg-top', root);
    el('span', 'upg-name', top, def.name);
    const costRow = el('span', 'upg-cost', top);
    costRow.appendChild(coinIcon('icon-coin-xs'));
    const cost = el('span', '', costRow);
    const effect = el('span', 'upg-effect', root);
    el('span', 'upg-flavor', root, def.flavor);
    return { def, root, cost, effect, afford: new Afford(root), boughtAt: 0 };
  });
  const cardById = new Map<string, UpgradeCard>(cards.map((c) => [c.def.id, c]));

  scene.game.on('purchase', (e) => {
    if (e.kind === 'upgrade') {
      const c = cardById.get(e.id);
      if (c && !c.root.hidden) {
        c.boughtAt = now();
        c.root.classList.add('bought');
      }
    } else {
      const row = unitRows.find((r) => r.id === e.id);
      if (row && typeof row.owned.animate === 'function') {
        row.owned.animate([{ transform: 'scale(1.4)', color: '#fff3d6' }, { transform: 'none' }], {
          duration: 300,
          easing: 'cubic-bezier(.2,.9,.3,1.4)',
        });
      }
    }
  });

  // ---- refresh ----
  let autoOpened = false;
  let lastCta: HTMLElement | null = null;
  let seenUpgrades = 0;

  const setBuy = (btn: BuyBtn, label: string, cost: string, can: boolean, t: number): void => {
    setText(btn.label, label);
    setText(btn.cost, cost);
    btn.afford.set(can, t);
  };

  function refresh(): void {
    const s = state();
    if (s.flags['feature.panel'] && !autoOpened) {
      autoOpened = true;
      ui.setPanelOpen(true);
    }
    if (!ui.panelOpen) return;
    const t = now();

    // Upgrades tab appears with the first upgrade.
    let revealed = 0;
    for (const u of UPGRADES) if (s.flags[u.unlockFlag]) revealed++;
    setShown(upgTab.b, revealed > 0);
    setClass(tabs, 'single', revealed === 0);
    if (active === 'upgrades') seenUpgrades = revealed;

    // CTA: the cheapest affordable upgrade, else the affordable unit with the best DPS per gold.
    let cta: HTMLElement | null = null;
    let ctaTab: Tab = 'army';
    let bestCost: ReturnType<typeof sel.unitCost> | null = null;
    for (const c of cards) {
      if (!sel.upgradeAffordable(s, c.def.id)) continue;
      const cost = sel.upgradeCost(c.def.id)!;
      if (!bestCost || cost.lt(bestCost)) {
        bestCost = cost;
        cta = c.root;
        ctaTab = 'upgrades';
      }
    }
    if (!cta) {
      let best = -1;
      for (const r of unitRows) {
        if (!sel.unitAffordable(s, r.id)) continue;
        const v = sel.unitDamage(s, r.id).div(sel.unitPeriod(s, r.id)).div(sel.unitCost(s, r.id)).toNumber();
        if (v > best) {
          best = v;
          cta = r.one.b;
        }
      }
    }
    if (cta !== lastCta) {
      if (lastCta) lastCta.classList.remove('cta');
      if (cta) cta.classList.add('cta');
      lastCta = cta;
    }
    setClass(upgTab.b, 'cta', !!cta && ctaTab === 'upgrades' && active !== 'upgrades');

    // Upgrades badge: affordable count (or a dot for news) while on the Army tab.
    let affordableUpg = 0;
    for (const c of cards) if (sel.upgradeAffordable(s, c.def.id)) affordableUpg++;
    const badge = active === 'upgrades' ? '' : affordableUpg > 0 ? String(affordableUpg) : revealed > seenUpgrades ? '•' : '';
    setText(upgTab.badge, badge);
    setShown(upgTab.badge, badge !== '');

    if (active === 'army') {
      let any = false;
      for (const r of unitRows) {
        const show = sel.unitVisible(s, r.id);
        setShown(r.root, show);
        if (!show) continue;
        any = true;
        const owned = s.units[r.id];
        setText(r.owned, owned > 0 ? '×' + owned : '');
        const dps = owned > 0 ? sel.unitDps(s, r.id) : sel.unitDamage(s, r.id).div(sel.unitPeriod(s, r.id));
        setText(r.dps, owned > 0 ? `${fmt(dps)} DPS` : `${fmt(dps)} DPS each`);
        const ms = sel.nextMilestone(s, r.id);
        setText(r.next, `×${ms.mult} at ${ms.at}`);
        r.msFill.style.transform = `scaleX(${Math.round(ms.frac * 100) / 100})`;
        setBuy(r.one, 'Hire', fmt(sel.unitCost(s, r.id, 1)), sel.unitAffordable(s, r.id, 1), t);
        setBuy(r.ten, '×10', fmt(sel.unitCost(s, r.id, 10)), sel.unitAffordable(s, r.id, 10), t);
        const n = sel.maxAffordable(s, r.id);
        setBuy(r.max, 'Max', n > 0 ? '×' + fmt(n) : '—', n > 0, t);
      }
      setShown(armyEmpty, !any);
      if (!any) setText(armyEmpty, MICROCOPY['panel.armyEmpty'] ?? 'No one has answered the call. Yet.');
    } else {
      const order = sel.visibleUpgrades(s);
      const rank = new Map(order.map((u, i) => [u.id, i]));
      for (const c of cards) {
        const i = rank.get(c.def.id);
        const lingering = c.boughtAt > 0 && t - c.boughtAt < BOUGHT_MS;
        setShown(c.root, i !== undefined || lingering);
        if (i === undefined) continue;
        c.root.style.order = String(i);
        setText(c.cost, fmt(sel.upgradeCost(c.def.id)!));
        setText(c.effect, effectLine(c.def.effect));
        c.afford.set(sel.upgradeAffordable(s, c.def.id), t);
      }
      setShown(upgEmpty, order.length === 0);
      if (order.length === 0) setText(upgEmpty, MICROCOPY['panel.upgradesEmpty'] ?? 'Every upgrade bought. For now.');
    }
  }

  select('army');
  ui.onRefresh(refresh);
}
