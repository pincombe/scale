// The Heraldry tab (with `feature.heraldry`; it opens by itself after the first zoom, with a coach:
// "Spend your Scales"). At the top, the coat of arms on a canvas, drawn by the heraldry renderer
// (render/heraldry: coatOf + drawCoat) and redrawn only when state.heraldry changes; a purchase
// flashes it. Below, the Scales to spend, then one row per charge (CHARGE_IDS): a small shield
// bearing that charge, its name and level, the effect line written from CHARGES[id].effect (and the
// running total), and the cost in Scales on a buy pill (the flavor is the row's tooltip). Click a
// row to buy (`buyHeraldry`).
import './heraldry.css';
import { CHARGES, CHARGE_IDS, MICROCOPY, fmt, sel } from '../core';
import type { ChargeId, GameState, HeraldryState } from '../core';
import type { Scene } from '../app/scene';
import { CREST_RISE, coatOf, drawCoat, heraldryHash } from '../render/heraldry';
import { Afford } from './afford';
import { el, gameButton, setClass, setShown, setText } from './dom';
import { heraldryEffectLine, heraldryTotal } from './effectText';
import { scaleIcon } from './icons';
import type { UiRoot } from './mount';

/** The big coat: shield height (CSS px) and the canvas around it (room for the crest crown). */
const COAT_SIZE = 168;
const COAT_W = 236;
const COAT_H = Math.ceil(COAT_SIZE * (1 + CREST_RISE)) + 14;
/** The row's little shield. */
const MINI_SIZE = 38;
const MINI_W = 36;
const MINI_H = 42;
/** The coach stays until the first purchase, or this long (ms). */
const COACH_MS = 16000;

interface Row {
  id: ChargeId;
  root: HTMLButtonElement;
  mini: HTMLCanvasElement;
  now: HTMLElement;
  level: HTMLElement;
  total: HTMLElement;
  effect: HTMLElement;
  cost: HTMLElement;
  afford: Afford;
}

export interface HeraldryPage {
  refresh(s: GameState, now: number): void;
  /** The tab exists (after the first zoom). */
  visible(s: GameState): boolean;
  /** How many charges the Scales can buy right now (the tab's badge). */
  affordable(s: GameState): number;
  /** Show the "Spend your Scales" coach (after the first zoom). */
  coach(): void;
}

function sizeCanvas(c: HTMLCanvasElement, w: number, h: number): number {
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  return dpr;
}

/** A heraldry state holding just this charge at level 1 (the row's little shield). */
function single(id: ChargeId): HeraldryState {
  const levels = { lion: 0, sun: 0, wyvern: 0, stag: 0, tower: 0, crown: 0 };
  levels[id] = 1;
  return { levels, order: [id] };
}

export function createHeraldryPage(scene: Scene, _ui: UiRoot, page: HTMLElement): HeraldryPage {
  const { game } = scene;
  const state = (): GameState => game.state;

  // ---- the coat ----
  const stage = el('div', 'her-stage', page);
  el('div', 'her-plinth', stage);
  const coatCanvas = el('canvas', 'her-coat', stage);
  const flash = el('div', 'her-flash', stage);
  flash.setAttribute('aria-hidden', 'true');
  let drawnHash = Number.NaN;
  let drawnDpr = 0;

  const drawBig = (h: HeraldryState): void => {
    const dpr = sizeCanvas(coatCanvas, COAT_W, COAT_H);
    const ctx = coatCanvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, coatCanvas.width, coatCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cy = COAT_SIZE * CREST_RISE + COAT_SIZE / 2 + 6;
    drawCoat(ctx, coatOf(h), COAT_W / 2, cy, COAT_SIZE, { shape: 'heater' });
    drawnHash = heraldryHash(h);
    drawnDpr = dpr;
  };

  // ---- Scales to spend, the intro, the coach ----
  const balance = el('div', 'her-balance', page);
  const balIcon = el('span', 'her-balance-icon', balance);
  balIcon.appendChild(scaleIcon('icon-scale'));
  const balVal = el('span', 'her-balance-val', balance);
  el('span', 'her-balance-label', balance, 'Scales');
  const coachBox = el('div', 'her-coach', page);
  coachBox.hidden = true;
  el('div', 'her-coach-title', coachBox, MICROCOPY.coachHeraldry ?? 'Spend your Scales');
  el('div', 'her-coach-sub', coachBox, MICROCOPY.coachHeraldrySub ?? 'Your coat of arms flies on every banner.');
  const intro = el('p', 'her-intro', page, MICROCOPY['panel.heraldryIntro'] ?? 'Spend Scales on charges for your coat of arms. Your whole army wears it.');

  // ---- rows ----
  const list = el('div', 'her-list', page);
  const rows: Row[] = CHARGE_IDS.map((id) => {
    const root = gameButton('her-row', list, () => sel.heraldryAffordable(state(), id), () => game.dispatch({ type: 'buyHeraldry', id }));
    const mini = el('canvas', 'her-mini', root);
    sizeCanvas(mini, MINI_W, MINI_H);
    const info = el('span', 'her-info', root);
    const top = el('span', 'her-top', info);
    el('span', 'her-name', top, CHARGES[id].name);
    root.title = CHARGES[id].flavor;
    const costBox = el('span', 'her-cost', top);
    costBox.appendChild(scaleIcon('icon-scale-xs'));
    const cost = el('span', '', costBox);
    const effect = el('span', 'her-effect', info);
    const now = el('span', 'her-now', info);
    const level = el('span', 'her-level', now);
    const total = el('span', 'her-total', now);
    return { id, root, mini, now, level, total, effect, cost, afford: new Afford(root) };
  });

  /** The rows' little shields, drawn the first time the tab shows (not at boot). */
  let minisDpr = 0;
  const drawMinis = (dpr: number): void => {
    minisDpr = dpr;
    for (const r of rows) {
      sizeCanvas(r.mini, MINI_W, MINI_H);
      const ctx = r.mini.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, r.mini.width, r.mini.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCoat(ctx, coatOf(single(r.id)), MINI_W / 2, MINI_H / 2, MINI_SIZE, { shape: 'heater', crest: false });
    }
  };
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // ---- coach ----
  let coachOn = false;
  let coachTimer = 0;
  const endCoach = (): void => {
    if (!coachOn) return;
    coachOn = false;
    window.clearTimeout(coachTimer);
    coachBox.classList.remove('on');
    page.classList.remove('coaching');
    window.setTimeout(() => {
      if (!coachOn) coachBox.hidden = true;
    }, 500);
  };

  game.on('purchase', (e) => {
    if (e.kind !== 'heraldry') return;
    endCoach();
    // The coat takes its new charge: a flash of gold behind it and a bump.
    stage.classList.remove('struck');
    void stage.offsetWidth;
    stage.classList.add('struck');
    const r = rowById.get(e.id as ChargeId);
    if (r) {
      r.root.classList.remove('bought-flash');
      void r.root.offsetWidth;
      r.root.classList.add('bought-flash');
    }
    drawBig(state().heraldry);
  });

  let lastCta: HTMLElement | null = null;
  let lastBal = '';

  return {
    visible: (s) => sel.heraldryVisible(s),
    affordable(s) {
      let n = 0;
      for (const id of CHARGE_IDS) if (sel.heraldryAffordable(s, id)) n++;
      return n;
    },
    coach() {
      coachOn = true;
      coachBox.hidden = false;
      coachBox.classList.remove('on');
      void coachBox.offsetWidth;
      coachBox.classList.add('on');
      page.classList.add('coaching');
      window.clearTimeout(coachTimer);
      coachTimer = window.setTimeout(endCoach, COACH_MS);
    },
    refresh(s, t) {
      const h = s.heraldry;
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      if (heraldryHash(h) !== drawnHash || dpr !== drawnDpr) drawBig(h);
      if (dpr !== minisDpr) drawMinis(dpr);

      const bal = fmt(s.scales);
      if (bal !== lastBal) {
        lastBal = bal;
        balVal.textContent = bal;
      }
      setShown(intro, h.order.length === 0 && !coachOn);

      let cta: HTMLElement | null = null;
      let best: ReturnType<typeof sel.heraldryCost> | null = null;
      for (const r of rows) {
        const L = sel.heraldryLevel(s, r.id);
        const e = CHARGES[r.id].effect;
        setText(r.level, L > 0 ? `Level ${L}` : '');
        setText(r.effect, heraldryEffectLine(e));
        setText(r.total, L > 0 ? heraldryTotal(e, L) : '');
        setShown(r.now, L > 0);
        setClass(r.root, 'owned', L > 0);
        const c = sel.heraldryCost(s, r.id);
        setText(r.cost, fmt(c));
        const can = sel.heraldryAffordable(s, r.id);
        r.afford.set(can, t);
        if (can && (!best || c.lt(best))) {
          best = c;
          cta = r.root;
        }
      }
      if (cta !== lastCta) {
        if (lastCta) lastCta.classList.remove('cta');
        if (cta) cta.classList.add('cta');
        lastCta = cta;
      }
    },
  };
}
