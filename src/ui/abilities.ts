// The abilities bar (dock, left; anchor 'abilities'): three round buttons, Charge! (a couched
// lance), Rally (a banner) and Dragonbane Volley (a fan of arrows), each with its hotkey digit, a
// radial cooldown sweep (sel.abilityFrac), a glow and a draining ring while active
// (sel.abilityActiveFrac), and a tooltip with the name and flavor. Click or keys 1-3 dispatch
// `useAbility`. Each appears with its `ability.<id>` flag, and the first time, a coach pulse
// ("Press 1: Charge!", key coachAbility) until it's used.
import './abilities.css';
import { ABILITIES, ABILITY_IDS, ABILITY_TEXT, BALANCE, sel } from '../core';
import type { AbilityId, GameState } from '../core';
import type { Scene } from '../app/scene';
import { uiClick, uiDeny, uiHover } from '../audio/sfx';
import { LANDING, cinematicOf } from './cinematic';
import { el, setClass, setShown, setText } from './dom';
import { template } from './effectText';
import { abilityIcon } from './icons';
import type { UiRoot } from './mount';

const NS = 'http://www.w3.org/2000/svg';
/** Ring radius in the 64-unit viewBox, and its circumference. */
const RIM_R = 29.5;
const RIM_C = 2 * Math.PI * RIM_R;
/** The cooldown pie: a circle of radius PIE_R stroked PIE_R*2 wide fills a disc of radius 2*PIE_R. */
const PIE_R = 13;
const PIE_C = 2 * Math.PI * PIE_R;
/** Coach: how long each "Press N" shows if the ability isn't used (ms). */
const COACH_MS = 8000;
/** Sweep precision: redraw only when the fraction moves by this much. */
const Q = 400;

interface AbButton {
  id: AbilityId;
  wrap: HTMLElement;
  b: HTMLButtonElement;
  pie: SVGCircleElement;
  rim: SVGCircleElement;
  act: SVGCircleElement;
  time: HTMLElement;
  stats: HTMLElement;
  coach: HTMLElement;
  shown: boolean;
  qFrac: number;
  qAct: number;
  state: string;
  secs: number;
}

function circle(parent: SVGSVGElement, cls: string, r: number): SVGCircleElement {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('class', cls);
  c.setAttribute('cx', '32');
  c.setAttribute('cy', '32');
  c.setAttribute('r', String(r));
  parent.appendChild(c);
  return c;
}

export function createAbilities(scene: Scene, ui: UiRoot, dock: HTMLElement): void {
  const { game } = scene;
  const cine = cinematicOf(scene, ui);
  const bar = el('div', 'ab-bar', dock);
  bar.hidden = true;
  ui.registerAnchor('abilities', bar);
  const state = (): GameState => game.state;

  const shake = (btn: AbButton): void => {
    if (typeof btn.b.animate !== 'function') return;
    btn.b.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }],
      { duration: 280, easing: 'ease-out' },
    );
  };

  const press = (btn: AbButton): void => {
    const s = state();
    if (!sel.abilityVisible(s, btn.id) || cine.on) return;
    if (!sel.abilityReady(s, btn.id)) {
      uiDeny();
      shake(btn);
      return;
    }
    uiClick();
    game.dispatch({ type: 'useAbility', id: btn.id });
  };

  const buttons: AbButton[] = ABILITY_IDS.map((id) => {
    const def = ABILITIES[id];
    const wrap = el('div', 'ab-wrap', bar);
    wrap.hidden = true;
    const b = el('button', 'ab interactive', wrap);
    b.type = 'button';
    b.setAttribute('aria-label', `${def.name} (${def.key})`);
    const halo = el('span', 'ab-halo', b);
    halo.setAttribute('aria-hidden', 'true');
    const face = el('span', 'ab-face', b);
    face.appendChild(abilityIcon(id));
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', 'ab-rings');
    svg.setAttribute('aria-hidden', 'true');
    const pie = circle(svg, 'ab-pie', PIE_R);
    pie.setAttribute('stroke-dasharray', `0 ${PIE_C}`);
    circle(svg, 'ab-track', RIM_R);
    const rim = circle(svg, 'ab-rim', RIM_R);
    rim.setAttribute('stroke-dasharray', `${RIM_C} ${RIM_C}`);
    const act = circle(svg, 'ab-act', RIM_R);
    act.setAttribute('stroke-dasharray', `0 ${RIM_C}`);
    b.appendChild(svg);
    const time = el('span', 'ab-time', b);
    el('span', 'ab-key', b, String(def.key));

    const tip = el('div', 'ab-tip', wrap);
    el('div', 'ab-tip-name', tip, ABILITY_TEXT[id].name);
    el('div', 'ab-tip-flavor', tip, ABILITY_TEXT[id].flavor);
    const stats = el('div', 'ab-tip-stats', tip);
    const coach = el('div', 'ab-coach', wrap);
    coach.hidden = true;

    const btn: AbButton = { id, wrap, b, pie, rim, act, time, stats, coach, shown: false, qFrac: -1, qAct: -1, state: '', secs: -1 };
    b.addEventListener('pointerenter', () => {
      if (sel.abilityReady(state(), id)) uiHover();
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      press(btn);
    });
    return btn;
  });
  const byId = new Map(buttons.map((x) => [x.id, x]));

  // Keys 1-3 (app/input.ts calls this; key 4 stays free).
  scene.input.onAbility = (slot: number): void => {
    const id = ABILITY_IDS[slot - 1];
    const btn = id ? byId.get(id) : undefined;
    if (btn && btn.shown) press(btn);
  };

  // ---- coach: "Press 1: Charge!" on each new ability, one at a time, until it's used ----
  const coachQueue: AbilityId[] = [];
  let coaching: AbButton | null = null;
  let coachTimer = 0;
  const coached = new Set<AbilityId>();

  const endCoach = (): void => {
    if (!coaching) return;
    const c = coaching;
    coaching = null;
    window.clearTimeout(coachTimer);
    c.coach.classList.remove('on');
    c.wrap.classList.remove('coached');
    window.setTimeout(() => {
      c.coach.hidden = true;
      nextCoach();
    }, 700);
  };

  const nextCoach = (): void => {
    if (coaching || cine.on || coachGated) return;
    const id = coachQueue.shift();
    if (!id) return;
    const btn = byId.get(id)!;
    if (!btn.shown) return nextCoach();
    coaching = btn;
    setText(btn.coach, template('coachAbility', 'Press {key}: {name}', { key: String(ABILITIES[id].key), name: ABILITY_TEXT[id].name }));
    btn.coach.hidden = false;
    void btn.coach.offsetWidth;
    btn.coach.classList.add('on');
    btn.wrap.classList.add('coached');
    coachTimer = window.setTimeout(endCoach, COACH_MS);
    cine.signal('coachShown');
  };

  const queueCoach = (id: AbilityId): void => {
    if (coached.has(id)) return;
    coached.add(id);
    coachQueue.push(id);
    window.setTimeout(nextCoach, 1200);
  };

  // ---- the zoom's landing: the dock rises at its stage (cinematic.ts LANDING); after the first
  // zoom, "Press 1" waits for the Heraldry coach to be done with (a charge bought, Heraldry left, or
  // LANDING.coachWait) ----
  let held = false;
  let coachGated = false;
  let gateTimer = 0;
  const openGate = (): void => {
    if (!coachGated) return;
    coachGated = false;
    window.clearTimeout(gateTimer);
    window.setTimeout(nextCoach, 600);
  };
  cine.listen('heraldryLeft', openGate);
  game.on('purchase', (e) => {
    if (e.kind === 'heraldry') openGate();
  });
  game.on('zoomSwitch', () => {
    held = true;
    const first = game.state.zoom.count === 1;
    if (first) coachGated = true;
    cine.after(() => {
      held = false;
      if (first) gateTimer = window.setTimeout(openGate, LANDING.coachWait);
    }, LANDING.dock);
  });

  // ---- events: juice ----
  game.on('abilityUse', (e) => {
    const btn = byId.get(e.id);
    if (!btn) return;
    if (coaching === btn) endCoach();
    btn.wrap.classList.remove('fired');
    void btn.wrap.offsetWidth;
    btn.wrap.classList.add('fired');
  });
  game.on('abilityReady', (e) => {
    const btn = byId.get(e.id);
    if (!btn || !btn.shown) return;
    btn.wrap.classList.remove('pinged');
    void btn.wrap.offsetWidth;
    btn.wrap.classList.add('pinged');
  });

  // ---- reconcile ----
  const reveal = (btn: AbButton, animate: boolean): void => {
    btn.shown = true;
    setShown(btn.wrap, true);
    setShown(bar, true);
    if (animate) {
      btn.wrap.classList.remove('enter');
      void btn.wrap.offsetWidth;
      btn.wrap.classList.add('enter');
      queueCoach(btn.id);
    }
    ui.invalidateAnchors();
  };

  ui.onFrame(() => {
    const s = state();
    for (const btn of buttons) {
      const vis = sel.abilityVisible(s, btn.id);
      if (vis !== btn.shown) {
        if (vis) {
          // Unlocked under the cinematic (the switch): appear at the dock's stage of the landing.
          if (cine.on || held) continue;
          reveal(btn, scene.input.hasStarted);
        } else {
          btn.shown = false;
          setShown(btn.wrap, false);
          ui.invalidateAnchors();
        }
      }
      if (!btn.shown) continue;
      const ab = s.abilities[btn.id];
      const active = ab.active > 0;
      const ready = sel.abilityReady(s, btn.id);
      // Cooldown over but not usable yet (a zoom's hold, or the Volley waiting for a target).
      const st = active ? 'active' : ready ? 'ready' : ab.cooldown > 0 ? 'cooling' : 'waiting';
      if (st !== btn.state) {
        btn.state = st;
        setClass(btn.wrap, 'active', st === 'active');
        setClass(btn.wrap, 'ready', st === 'ready');
        setClass(btn.wrap, 'cooling', st === 'cooling');
        setClass(btn.wrap, 'waiting', st === 'waiting');
      }
      const frac = sel.abilityFrac(s, btn.id);
      const qf = Math.round(frac * Q);
      if (qf !== btn.qFrac) {
        btn.qFrac = qf;
        const f = qf / Q;
        const rem = 1 - f;
        btn.pie.setAttribute('stroke-dasharray', `${(rem * PIE_C).toFixed(2)} ${PIE_C.toFixed(2)}`);
        btn.pie.setAttribute('stroke-dashoffset', (-f * PIE_C).toFixed(2));
        btn.rim.setAttribute('stroke-dasharray', `${(f * RIM_C).toFixed(2)} ${RIM_C.toFixed(2)}`);
      }
      const af = active ? sel.abilityActiveFrac(s, btn.id) : 0;
      const qa = Math.round(af * Q);
      if (qa !== btn.qAct) {
        btn.qAct = qa;
        btn.act.setAttribute('stroke-dasharray', `${((qa / Q) * RIM_C).toFixed(2)} ${RIM_C.toFixed(2)}`);
      }
      const secs = st === 'cooling' && ab.cooldown >= 1 ? Math.ceil(ab.cooldown) : 0;
      if (secs !== btn.secs) {
        btn.secs = secs;
        btn.time.textContent = secs > 0 ? String(secs) : '';
      }
    }
    if (coaching && !coaching.shown) endCoach();
  });

  // Tooltip stats (10 Hz; Stag heraldry changes the cooldown).
  ui.onRefresh(() => {
    const s = state();
    for (const btn of buttons) {
      if (!btn.shown) continue;
      const cd = Math.round(sel.abilityCooldown(s, btn.id));
      const dur = BALANCE.abilities[btn.id].dur;
      setText(btn.stats, dur > 0 ? `Lasts ${dur} s · Cooldown ${cd} s` : `Cooldown ${cd} s`);
    }
  });

  game.on('resync', () => {
    for (const btn of buttons) {
      btn.state = '';
      btn.qFrac = -1;
      btn.qAct = -1;
    }
  });
}
