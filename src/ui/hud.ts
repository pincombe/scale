// HUD: gold counter + gold/sec + tier label (top-left, anchor 'gold'), dragon name, HP bar and
// size word (top-center), mute toggle (top-right of the stage), the lone "Hire a Footman" button
// (bottom-center of the stage, before the panel exists) and unlock/milestone toasts.
// Everything appears only when its flag says it matters (ARCHITECTURE.md §4).
import { D, MICROCOPY, UNITS, fmt, sel, unitCost } from '../core';
import type { Decimal, GameState } from '../core';
import type { Scene } from '../app/scene';
import { el, gameButton, setClass, setShown, setText } from './dom';
import { roman } from './effectText';
import { createHints } from './hints';
import { coinIcon, speakerIcon } from './icons';
import type { UiRoot } from './mount';

/** Gold counter catch-up: coins land ~0.6-1.4 s after a kill, so count over that window. */
const COUNT_DELAY = 0.3;
const COUNT_TIME = 0.95;
/** Gold/sec: trailing window of lifetime-gold samples (10 Hz). */
const GPS_SAMPLES = 200;
const GPS_MIN_SPAN = 4;
/** HP bar: damage chunk holds this long, then drains. */
const TRAIL_HOLD = 0.35;

/** Tier names until text.ts carries them (MICROCOPY['tier.<n>'] wins when present). */
const TIER_FALLBACK: readonly string[] = ['The Meadow'];

function copy(key: string): string | undefined {
  return MICROCOPY[key];
}

/** A microcopy template with {name} slots, or the fallback. */
function template(key: string, fallback: string, vars: Record<string, string>): string {
  const t = copy(key) ?? fallback;
  return t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function createHud(scene: Scene, ui: UiRoot): void {
  createGold(scene, ui);
  createDragonBar(scene, ui);
  createMute(scene, ui);
  createHireButton(scene, ui);
  createToasts(scene, ui);
  createHints(scene, ui);
}

// ---------------------------------------------------------------- gold (top-left)

function createGold(scene: Scene, ui: UiRoot): void {
  const box = el('div', 'hud-left', ui.regions.hud);
  box.hidden = true;
  const tier = el('div', 'hud-tier', box);
  const row = el('div', 'hud-gold', box);
  const coinWrap = el('span', 'hud-coin', row);
  coinWrap.appendChild(coinIcon());
  const val = el('span', 'hud-gold-val', row, '0');
  const gpsEl = el('div', 'hud-gps', box);
  ui.registerAnchor('gold', coinWrap);

  let shown = 0;
  let target = 0;
  let rate = 0;
  let hold = 0;
  let lastText = '';
  let finite = true;

  const snap = (s: GameState): void => {
    target = s.gold.toNumber();
    finite = Number.isFinite(target);
    shown = target;
    rate = 0;
    hold = 0;
  };
  snap(scene.game.state);

  const show = (x: number): void => {
    const t = finite ? fmt(Math.floor(x)) : fmt(scene.game.state.gold);
    if (t !== lastText) {
      lastText = t;
      val.textContent = t;
    }
  };

  ui.onFrame((dt) => {
    if (box.hidden) return;
    const g = scene.game.state.gold.toNumber();
    if (g !== target) {
      finite = Number.isFinite(g);
      if (!finite || g < shown) {
        // Spent (or beyond doubles): no counting down, just be right.
        target = g;
        shown = g;
        rate = 0;
      } else {
        if (rate === 0) hold = COUNT_DELAY;
        target = g;
        rate = (target - shown) / COUNT_TIME;
      }
    }
    if (rate > 0) {
      if (hold > 0) hold -= dt;
      else {
        shown += rate * dt;
        if (shown >= target) {
          shown = target;
          rate = 0;
        }
      }
    }
    show(shown);
  });

  // Gold/sec: the better of the army estimate and what actually came in lately (clicks included).
  const samples = new Float64Array(GPS_SAMPLES);
  const times = new Float64Array(GPS_SAMPLES);
  let head = 0;
  let count = 0;
  let clock = 0;
  let lastGps = '';
  let lastTier = -1;
  scene.game.on('resync', () => {
    count = 0;
    snap(scene.game.state);
  });

  ui.onRefresh(() => {
    const s = scene.game.state;
    const on = !!s.flags['feature.gold'];
    if (on && box.hidden) {
      if (scene.input.hasStarted) {
        // Revealed in play (the first kill): start at 0 so the count-up runs as the coins land.
        shown = 0;
        target = 0;
        rate = 0;
        hold = 0;
        finite = true;
      } else snap(s); // a loaded save: just be right
      show(shown);
      box.hidden = false;
      box.classList.add('enter');
      ui.invalidateAnchors();
    }
    if (!on) return;
    if (s.tier !== lastTier) {
      lastTier = s.tier;
      const name = copy(`tier.${s.tier}`) ?? TIER_FALLBACK[s.tier] ?? '';
      setText(tier, `${roman(s.tier + 1)} · ${name}`);
    }
    clock += 0.1;
    const life = s.lifetimeGold.toNumber();
    if (count > 0 && life < samples[(head - 1 + GPS_SAMPLES) % GPS_SAMPLES]!) count = 0;
    samples[head] = life;
    times[head] = clock;
    head = (head + 1) % GPS_SAMPLES;
    count = Math.min(GPS_SAMPLES, count + 1);
    const oldest = (head - count + GPS_SAMPLES) % GPS_SAMPLES;
    const span = clock - times[oldest]!;
    let gps: Decimal = sel.goldPerSec(s);
    if (span >= GPS_MIN_SPAN) {
      const measured = (life - samples[oldest]!) / span;
      if (Number.isFinite(measured) && gps.lt(measured)) gps = D(measured);
    }
    const n = gps.toNumber();
    const shownGps = gps.gte(100) ? gps.floor() : D(n >= 10 ? Math.round(n) : Math.round(n * 10) / 10);
    const t = shownGps.gt(0) ? `${fmt(shownGps)} / sec` : '';
    if (t !== lastGps) {
      lastGps = t;
      gpsEl.textContent = t;
    }
  });
}

// ---------------------------------------------------------------- dragon (top-center)

function createDragonBar(scene: Scene, ui: UiRoot): void {
  const box = el('div', 'hud-dragon', ui.regions.hud);
  box.hidden = true;
  const name = el('div', 'hud-dragon-name', box);
  const main = el('span', 'hud-dragon-main', name);
  const epi = el('span', 'hud-dragon-epithet', name);
  const bar = el('div', 'hud-hp', box);
  const trail = el('div', 'hud-hp-trail', bar);
  const fill = el('div', 'hud-hp-fill', bar);
  const flash = el('div', 'hud-hp-flash', bar);
  const sub = el('div', 'hud-dragon-sub', box);
  const size = el('span', 'hud-size', sub);
  const hpText = el('span', 'hud-hp-text', sub);

  let lastId = -1;
  let hpRef: Decimal | null = null;
  let targetFrac = 1;
  let fillFrac = 1;
  let trailFrac = 1;
  let holdT = 0;
  let wFill = -1;
  let wTrail = -1;

  const readFrac = (): void => {
    const d = scene.game.state.dragon;
    if (d.hp === hpRef) return;
    hpRef = d.hp;
    const f = d.maxHp.gt(0) ? d.hp.div(d.maxHp).toNumber() : 0;
    const next = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
    if (next < targetFrac - 1e-6) holdT = TRAIL_HOLD;
    targetFrac = next;
  };

  ui.onFrame((dt) => {
    if (box.hidden) return;
    const d = scene.game.state.dragon;
    if (d.id !== lastId) {
      // New dragon: refill from empty (the bar sweeps up as it enters). On first reveal (or
      // after a resync) just be right.
      const first = lastId < 0;
      lastId = d.id;
      hpRef = null;
      targetFrac = 1;
      readFrac();
      fillFrac = first ? targetFrac : 0;
      trailFrac = fillFrac;
      holdT = 0;
      setText(main, d.name);
      setText(epi, d.epithet ? (d.epithet.startsWith(',') ? '' : ' ') + d.epithet : '');
      if (typeof name.animate === 'function') {
        name.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], {
          duration: 520,
          easing: 'cubic-bezier(.2,.8,.2,1)',
        });
      }
    }
    readFrac();
    const up = targetFrac > fillFrac;
    fillFrac += (targetFrac - fillFrac) * (1 - Math.exp(-(up ? 5 : 22) * dt));
    if (Math.abs(targetFrac - fillFrac) < 0.001) fillFrac = targetFrac;
    if (holdT > 0) holdT -= dt;
    else if (trailFrac > fillFrac) trailFrac += (fillFrac - trailFrac) * (1 - Math.exp(-5 * dt));
    if (trailFrac < fillFrac) trailFrac = fillFrac;
    const qf = Math.round(fillFrac * 1000);
    const qt = Math.round(trailFrac * 1000);
    if (qf !== wFill) {
      wFill = qf;
      fill.style.transform = `scaleX(${qf / 1000})`;
    }
    if (qt !== wTrail) {
      wTrail = qt;
      trail.style.transform = `scaleX(${qt / 1000})`;
    }
  });

  scene.game.on('resync', () => {
    lastId = -1;
  });

  scene.game.on('strike', (e) => {
    if (!e.crit || box.hidden || typeof flash.animate !== 'function') return;
    flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
    bar.animate([{ transform: 'scaleY(1.6)' }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
  });

  let lastSize = '';
  let lastHp = '';
  ui.onRefresh(() => {
    const s = scene.game.state;
    if (!s.flags['feature.dragonBar']) return;
    if (box.hidden) {
      box.hidden = false;
      box.classList.add('enter');
    }
    const info = sel.dragonInfo(s);
    if (info.sizeWord !== lastSize) {
      lastSize = info.sizeWord;
      size.textContent = info.sizeWord;
      if (lastId >= 0 && typeof size.animate === 'function') {
        size.animate([{ opacity: 0, letterSpacing: '0.2em' }, { opacity: 1, letterSpacing: '0.04em' }], { duration: 700, easing: 'ease-out' });
      }
    }
    const hp = s.dragon.phase === 'dying' ? '' : `${fmt(s.dragon.hp.ceil())} / ${fmt(s.dragon.maxHp)}`;
    if (hp !== lastHp) {
      lastHp = hp;
      hpText.textContent = hp;
    }
  });
}

// ---------------------------------------------------------------- mute (top-right of the stage)

function createMute(scene: Scene, ui: UiRoot): void {
  const { settings } = scene;
  const b = gameButton('hud-mute', ui.regions.hud, () => true, () => settings.set('muted', !settings.get('muted')));
  b.appendChild(speakerIcon());
  b.hidden = true;
  const sync = (): void => {
    const m = settings.get('muted');
    setClass(b, 'muted', m);
    b.title = m ? 'Unmute (M)' : 'Mute (M)';
    b.setAttribute('aria-label', b.title);
  };
  sync();
  settings.onChange((_s, key) => {
    if (key === 'muted') sync();
  });
  scene.input.onFirstGesture(() => {
    b.hidden = false;
  });
}

// ---------------------------------------------------------------- the lone Hire button

function createHireButton(scene: Scene, ui: UiRoot): void {
  const wrap = el('div', 'hire-lone', ui.stage);
  wrap.hidden = true;
  const state = (): GameState => scene.game.state;
  const b = gameButton(
    'hire-lone-btn',
    wrap,
    () => sel.unitAffordable(state(), 'footman'),
    () => scene.game.dispatch({ type: 'buyUnit', unit: 'footman', amount: 1 }),
  );
  const label = el('span', 'hire-lone-label', b);
  const costRow = el('span', 'hire-lone-cost', b);
  costRow.appendChild(coinIcon('icon-coin-sm'));
  const cost = el('span', '', costRow);

  let shown = false;
  ui.onRefresh(() => {
    const s = state();
    const want = !!s.flags['unit.footman'] && !s.flags['feature.panel'] && !ui.panelOpen;
    if (want !== shown) {
      shown = want;
      if (want) {
        setShown(wrap, true);
        wrap.classList.remove('leaving');
        wrap.classList.add('enter');
      } else if (!wrap.hidden) {
        wrap.classList.add('leaving');
        window.setTimeout(() => {
          if (!shown) setShown(wrap, false);
        }, 400);
      }
    }
    if (!want) return;
    setText(label, copy('hireFootman') ?? 'Hire a Footman');
    setText(cost, fmt(unitCost(s, 'footman')));
    setClass(b, 'ready', sel.unitAffordable(s, 'footman'));
  });
}

// ---------------------------------------------------------------- toasts

function createToasts(scene: Scene, ui: UiRoot): void {
  const { game } = scene;
  game.on('unlock', (e) => {
    const text = copy(`unlock.${e.kind}.${e.id}`) ?? (e.kind === 'upgrade' ? copy('unlock.upgrade') : undefined);
    if (text) ui.toast(text, e.kind === 'upgrade' ? 'upgrade' : 'unlock');
  });
  game.on('milestone', (e) => {
    const vars = { unit: UNITS[e.unit].name, plural: UNITS[e.unit].plural, owned: String(e.owned), mult: String(e.mult) };
    const key = copy(`milestone.${e.unit}.${e.owned}`) !== undefined ? `milestone.${e.unit}.${e.owned}` : 'milestone';
    ui.toast(template(key, '{plural} ×{mult} damage · {owned} strong', vars), 'milestone');
  });
}
