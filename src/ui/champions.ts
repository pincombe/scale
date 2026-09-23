// The Champions tab (from the first `championJoin`): a card per champion with a heraldic portrait
// (a bust with a plume in their colors), name and title (CHAMPION_TEXT), level, damage per blow and
// per second, the special move with a bar filling toward the next one (it flashes when it lands),
// and level-up buttons (×1, ×10, Max: `levelChampion`, BUY_MAX = -1) with the Army rows'
// affordability states.
import './champions.css';
import { BALANCE, BUY_MAX, CHAMPION_IDS, CHAMPION_TEXT, MICROCOPY, fmt, sel } from '../core';
import type { ChampionId, GameState } from '../core';
import type { Scene } from '../app/scene';
import { Afford } from './afford';
import { el, gameButton, setClass, setShown, setText } from './dom';
import { template } from './effectText';
import { coinIcon } from './icons';
import type { UiRoot } from './mount';
import { championAccent, championPortrait } from './portraits';

interface LevelBtn {
  b: HTMLButtonElement;
  label: HTMLElement;
  cost: HTMLElement;
  afford: Afford;
}

interface Card {
  id: ChampionId;
  root: HTMLElement;
  level: HTMLElement;
  blow: HTMLElement;
  dps: HTMLElement;
  special: HTMLElement;
  fill: HTMLElement;
  buys: HTMLElement;
  one: LevelBtn;
  ten: LevelBtn;
  max: LevelBtn;
  seal: HTMLElement;
  mastered: boolean;
  shown: boolean;
  lastLevel: number;
  lastFill: number;
}

export interface ChampionsPage {
  refresh(s: GameState, now: number): void;
}

/** "Ser Aldric" + "the Mostly Brave" → one line (a leading ',' attaches with no space). */
function fullName(id: ChampionId): { name: string; title: string } {
  const t = CHAMPION_TEXT[id];
  return { name: t.name, title: t.title.startsWith(',') ? t.title.replace(/^,\s*/, '') : t.title };
}

export function createChampionsPage(scene: Scene, _ui: UiRoot, page: HTMLElement): ChampionsPage {
  const { game } = scene;
  const state = (): GameState => game.state;
  const empty = el('p', 'panel-empty', page);

  /** `amount` is read at press time: the "×N" button buys N = min(10, levels left). */
  const levelBtn = (parent: HTMLElement, id: ChampionId, amount: () => number): LevelBtn => {
    const can = (): boolean => {
      const n = amount();
      return n === BUY_MAX ? sel.championMaxAffordable(state(), id) > 0 : n >= 1 && sel.championAffordable(state(), id, n);
    };
    const b = gameButton('buy', parent, can, () => game.dispatch({ type: 'levelChampion', id, amount: amount() }));
    const label = el('span', 'buy-label', b);
    const costRow = el('span', 'buy-cost', b);
    costRow.appendChild(coinIcon('icon-coin-xs'));
    const cost = el('span', '', costRow);
    return { b, label, cost, afford: new Afford(b) };
  };

  /** The bulk button's size: 10, or the levels left before mastery. */
  const bulk = (id: ChampionId): number => Math.min(10, sel.championLevelsLeft(state(), id));

  const cards: Card[] = CHAMPION_IDS.map((id) => {
    const root = el('div', 'champ', page);
    root.hidden = true;
    root.style.setProperty('--accent', championAccent(id));
    const top = el('div', 'champ-top', root);
    const portrait = el('div', 'champ-portrait', top);
    portrait.appendChild(championPortrait(id));
    const info = el('div', 'champ-info', top);
    const { name, title } = fullName(id);
    const nameRow = el('div', 'champ-name-row', info);
    el('span', 'champ-name', nameRow, name);
    const level = el('span', 'champ-level', nameRow);
    el('div', 'champ-title', info, title);
    const stats = el('div', 'champ-stats', info);
    const blow = el('span', 'champ-blow', stats);
    const dps = el('span', 'champ-dps', stats);
    const sp = el('div', 'champ-special', root);
    const special = el('span', 'champ-special-name', sp, template('championSpecial', 'Special: {special}', { special: CHAMPION_TEXT[id].special }));
    const bar = el('span', 'champ-special-bar', sp);
    const fill = el('span', 'champ-special-fill', bar);
    const buys = el('div', 'unit-buys', root);
    const one = levelBtn(buys, id, () => 1);
    const ten = levelBtn(buys, id, () => bulk(id));
    const max = levelBtn(buys, id, () => BUY_MAX);
    // Mastered: a gold seal where the buttons were.
    const seal = el('div', 'champ-mastered', root);
    seal.hidden = true;
    el('span', 'champ-seal', seal).setAttribute('aria-hidden', 'true');
    el('span', 'champ-mastered-text', seal, MICROCOPY.championMastered ?? 'Mastered');
    return { id, root, level, blow, dps, special, fill, buys, one, ten, max, seal, shown: false, lastLevel: -1, lastFill: -1, mastered: false };
  });
  const byId = new Map(cards.map((c) => [c.id, c]));

  const bump = (e: HTMLElement): void => {
    if (typeof e.animate !== 'function') return;
    e.animate([{ transform: 'scale(1.35)', color: '#fff3d6' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
  };

  game.on('championSpecial', (e) => {
    const c = byId.get(e.id);
    if (!c || !c.shown) return;
    c.root.classList.remove('struck');
    void c.root.offsetWidth;
    c.root.classList.add('struck');
  });
  game.on('purchase', (e) => {
    if (e.kind !== 'champion') return;
    const c = byId.get(e.id as ChampionId);
    if (c) bump(c.level);
  });

  const setBuy = (btn: LevelBtn, label: string, cost: string, can: boolean, t: number): void => {
    setText(btn.label, label);
    setText(btn.cost, cost);
    btn.afford.set(can, t);
  };

  return {
    refresh(s, t) {
      let any = false;
      for (const c of cards) {
        const vis = sel.championVisible(s, c.id);
        if (vis !== c.shown) {
          c.shown = vis;
          setShown(c.root, vis);
        }
        if (!vis) continue;
        any = true;
        const L = s.champions[c.id].level;
        if (L !== c.lastLevel) {
          c.lastLevel = L;
          setText(c.level, template('championLevel', 'Level {level}', { level: String(L) }));
        }
        setText(c.blow, `${fmt(sel.championHit(s, c.id))} per blow`);
        setText(c.dps, `${fmt(sel.championDps(s, c.id))} DPS`);
        const every = BALANCE.champions[c.id].specialEvery;
        const f = every > 0 ? Math.max(0, Math.min(1, 1 - s.champions[c.id].specialT / every)) : 0;
        const q = Math.round(f * 100);
        if (q !== c.lastFill) {
          c.lastFill = q;
          c.fill.style.transform = `scaleX(${q / 100})`;
        }
        const mastered = sel.championMastered(s, c.id);
        if (mastered !== c.mastered) {
          c.mastered = mastered;
          setShown(c.buys, !mastered);
          setShown(c.seal, mastered);
          setClass(c.root, 'mastered', mastered);
        }
        if (mastered) continue;
        setBuy(c.one, 'Level', fmt(sel.championCost(s, c.id, 1)), sel.championAffordable(s, c.id, 1), t);
        const k = bulk(c.id);
        setShown(c.ten.b, k >= 2);
        if (k >= 2) setBuy(c.ten, '×' + k, fmt(sel.championCost(s, c.id, k)), sel.championAffordable(s, c.id, k), t);
        setClass(c.buys, 'two', k < 2);
        const n = sel.championMaxAffordable(s, c.id);
        setBuy(c.max, 'Max', n > 0 ? '×' + fmt(n) : '—', n > 0, t);
      }
      setShown(empty, !any);
      if (!any) setText(empty, MICROCOPY['panel.championsEmpty'] ?? 'No champions yet. The brave ones are always late.');
    },
  };
}
