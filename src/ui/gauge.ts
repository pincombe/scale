// The Wyrm Gauge (under the dragon bar, anchor 'gauge'): a slim serpent of scales, one per kill the
// tier's boss needs (TIERS[tier].bossAt). Each ordinary kill ignites the next scale ember-orange
// with a flare and a wave of light down the lit body; the lit scales beat faster as it fills.
// When the boss arrives the same serpent becomes its timer: the lit scales turn red-gold and drain
// from the tail as sel.bossTimeLeft runs down (urgent in the last 10 s). After the boss falls it
// rests full, gilded and glowing.
//
// It appears in the Meadow once it matters (GAUGE_AT kills, with a one-time caption: gaugeHint),
// and always from the Mountain on. State is the truth: the frame loop reconciles every scale from
// state and writes the DOM only when something changed.
import './gauge.css';
import { MICROCOPY, sel } from '../core';
import type { GameState } from '../core';
import type { Scene } from '../app/scene';
import { el, setClass, setShown, setText } from './dom';
import type { UiRoot } from './mount';

/** Meadow kills before the gauge shows. */
const GAUGE_AT = 8;
/** The caption's time on screen (ms). */
const HINT_MS = 6500;
/** Seconds of the boss timer that count as urgent. */
const URGENT_S = 10;
/** The serpent's body length (px) the scales share, tail to head. */
const BODY_PX = 232;

type Mode = 'charge' | 'boss' | 'cleared';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(cls: string, viewBox: string, inner: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}

// The head faces right (toward the dragon), jaw slightly open; the eye lights when the gauge is full.
const HEAD =
  '<path class="wg-head-body" d="M1.5 10.2c0-3.6 3.2-6 7.6-6.2l3.4-3.2 1.2 3c3.6.2 7.4 1.4 11.2 3.8l3.2 2.2c.6.4.4 1.3-.3 1.4l-6.6.7 5.6 1.7c.6.2.6 1-.1 1.1l-7.6.9c-5 1.2-9.8 1.6-13.4.8-2.6-.6-4.2-2.8-4.2-6.2z"/>' +
  '<path class="wg-head-horn" d="M9.6 4.4L5.8.6l5 2.2zM12.6 3.8L11.4.2l3 3z"/>' +
  '<circle class="wg-eye" cx="15.6" cy="7.4" r="1.45"/>';
// The tail curls up at the end.
const TAIL = '<path class="wg-tail-body" d="M15 6.2c-4.6.2-7.4-.8-9.6-2.8C4 2 2.6 1.4 1 2c1.6.4 2.4 1.6 3.4 3.2 2.2 3.4 6 4.8 10.6 4.6z"/>';

export function createGauge(scene: Scene, ui: UiRoot, parent: HTMLElement): void {
  const { game } = scene;
  const root = el('div', 'wg', parent);
  root.hidden = true;
  const serpent = el('div', 'wg-serpent', root);
  serpent.appendChild(svgEl('wg-tail', '0 0 16 11', TAIL));
  const body = el('div', 'wg-body', serpent);
  const glow = el('span', 'wg-glow', body);
  serpent.appendChild(svgEl('wg-head', '0 0 30 17', HEAD));
  const caption = el('div', 'wg-caption', root);
  const label = el('span', 'wg-label', caption);
  const count = el('span', 'wg-count', caption);
  const hint = el('div', 'wg-hint', parent);
  hint.hidden = true;
  ui.registerAnchor('gauge', root);

  let segs: HTMLElement[] = [];
  let lit = new Uint8Array(0);
  let n = 0;

  const build = (want: number): void => {
    n = Math.max(1, want);
    body.textContent = '';
    body.appendChild(glow);
    segs = [];
    lit = new Uint8Array(n);
    // Scales taper from the tail (left) to the neck, overlapping like a snake's back; a slow
    // slither runs along them (a per-scale delay), and each sits on a gentle S-curve.
    const step = BODY_PX / n;
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 1;
      // Each scale overlaps the next (its rounded free edge toward the tail, its root tucked under).
      const w = step * (1.55 + 0.25 * k) + 1;
      const h = 6.5 + k * 8;
      const outer = el('span', 'wg-seg', body);
      outer.style.width = w.toFixed(1) + 'px';
      outer.style.height = h.toFixed(1) + 'px';
      outer.style.marginLeft = i === 0 ? '0' : (step - w).toFixed(1) + 'px';
      // The S-curve is a static `translate`; the slither animates `transform` on top of it.
      outer.style.setProperty('translate', `0 ${(Math.sin(i * 0.5 + 0.6) * 2.2 * (0.4 + 0.6 * k)).toFixed(2)}px`);
      outer.style.zIndex = String(i + 1);
      outer.style.animationDelay = `${(-i * 0.11).toFixed(2)}s`;
      const inner = el('span', 'wg-scale', outer);
      inner.style.setProperty('--i', String(i));
      segs.push(inner);
    }
  };

  // ---- reconcile ----
  let shown = false;
  let everShown = false;
  let mode: Mode | '' = '';
  let lastCharge = -1;
  let lastTier = -1;
  let snap = true;
  let urgent = false;
  let lastCount = '';
  let partialIdx = -1;
  let partialQ = -1;
  let beat = -1;
  let lastSec = -1;

  const visible = (s: GameState): boolean =>
    !!s.flags['feature.dragonBar'] && (s.tier > 0 || s.kills >= GAUGE_AT || s.wyrm.charge >= GAUGE_AT || !!s.dragon.boss || s.wyrm.cleared);

  const setLit = (i: number, on: boolean): boolean => {
    if ((lit[i] === 1) === on) return false;
    lit[i] = on ? 1 : 0;
    setClass(segs[i]!, 'lit', on);
    return true;
  };

  const setBeat = (sec: number): void => {
    const q = Math.round(sec * 100);
    if (q === beat) return;
    beat = q;
    root.style.setProperty('--beat', q / 100 + 's');
  };
  const setCount = (text: string): void => {
    if (text === lastCount) return;
    lastCount = text;
    count.textContent = text;
  };

  /** The heartbeat glow behind the lit run of scales [a, b). */
  let glowA = -1;
  let glowB = -1;
  const setGlow = (a: number, b: number): void => {
    if (a === glowA && b === glowB) return;
    glowA = a;
    glowB = b;
    const step = BODY_PX / n;
    glow.style.left = (a * step).toFixed(1) + 'px';
    glow.style.width = Math.max(0, (b - a) * step + 3).toFixed(1) + 'px';
    setShown(glow, b > a);
  };

  const clearPartial = (): void => {
    if (partialIdx >= 0 && segs[partialIdx]) segs[partialIdx]!.style.opacity = '';
    partialIdx = -1;
    partialQ = -1;
  };

  /** A flare on the scale that just lit, and a wave of light from the tail to it. */
  const kick = (i: number): void => {
    const seg = segs[i];
    if (!seg || typeof seg.animate !== 'function') return;
    seg.animate(
      [
        { transform: 'scale(2.1)', filter: 'brightness(2.2)' },
        { transform: 'scale(0.9)', filter: 'brightness(1.4)', offset: 0.45 },
        { transform: 'none', filter: 'none' },
      ],
      { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    root.classList.remove('wave');
    void root.offsetWidth;
    root.classList.add('wave');
  };

  const flare = (cls: string, ms: number): void => {
    root.classList.remove(cls);
    void root.offsetWidth;
    root.classList.add(cls);
    window.setTimeout(() => root.classList.remove(cls), ms);
  };

  game.on('resync', () => {
    snap = true;
  });
  game.on('bossSummon', () => {
    if (!shown) return;
    flare('roar', 1200);
  });
  game.on('bossDefeated', () => {
    if (!shown) return;
    flare('triumph', 1600);
  });
  game.on('bossEscaped', () => {
    if (!shown) return;
    flare('escaped', 900);
  });

  let hintTimer = 0;
  const showHint = (): void => {
    const text = MICROCOPY.gaugeHint ?? 'Every dragon you slay loosens a scale. Fill the gauge and something bigger comes.';
    setText(hint, text);
    hint.hidden = false;
    hint.classList.remove('on');
    void hint.offsetWidth;
    hint.classList.add('on');
    ui.root.classList.add('wg-hinting');
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      hint.classList.remove('on');
      ui.root.classList.remove('wg-hinting');
      window.setTimeout(() => (hint.hidden = true), 700);
    }, HINT_MS);
  };

  ui.onFrame(() => {
    const s = game.state;
    const want = visible(s);
    if (want !== shown) {
      shown = want;
      setShown(root, want);
      setClass(ui.root, 'has-gauge', want);
      if (want) {
        snap = true;
        if (!everShown && scene.input.hasStarted && s.tier === 0) {
          root.classList.add('enter');
          showHint();
        }
        everShown = true;
      }
      ui.invalidateAnchors();
    }
    if (!shown) return;

    if (s.tier !== lastTier || segs.length !== sel.bossAt(s.tier)) {
      lastTier = s.tier;
      build(sel.bossAt(s.tier));
      glowA = glowB = -1;
      snap = true;
      mode = '';
    }

    const boss = !!s.dragon.boss && s.dragon.phase !== 'dying' && s.dragon.phase !== 'leave' && !s.wyrm.cleared;
    const m: Mode = boss ? 'boss' : s.wyrm.cleared ? 'cleared' : 'charge';
    if (m !== mode) {
      if (mode === 'charge' && m === 'boss') flare('ignite', 900);
      mode = m;
      setClass(root, 'mode-charge', m === 'charge');
      setClass(root, 'mode-boss', m === 'boss');
      setClass(root, 'mode-cleared', m === 'cleared');
      setText(label, m === 'boss' ? (MICROCOPY.bossTimer ?? 'Before it escapes') : (MICROCOPY.gauge ?? 'Wyrm Gauge'));
      clearPartial();
      lastCharge = -1;
      lastSec = -1;
      ui.invalidateAnchors();
    }

    let isUrgent = false;
    if (m === 'charge') {
      const c = Math.max(0, Math.min(n, s.wyrm.charge));
      if (c !== lastCharge) {
        const grew = !snap && lastCharge >= 0 && c > lastCharge;
        for (let i = 0; i < n; i++) setLit(i, i < c);
        setGlow(0, c);
        if (grew) for (let i = lastCharge; i < c; i++) kick(i);
        lastCharge = c;
        const f = c / n;
        // Beats faster as it fills: a slow breath when empty, a racing heart at the brim.
        setBeat(2.4 - 1.75 * f);
        setClass(root, 'full', c >= n);
        setCount(`${c} / ${n}`);
      }
    } else if (m === 'boss') {
      const dur = s.wyrm.bossDur > 0 ? s.wyrm.bossDur : 30;
      const left = Math.max(0, sel.bossTimeLeft(s));
      const f = Math.max(0, Math.min(1, left / dur));
      const litF = f * n;
      const whole = Math.ceil(litF - 1e-6);
      // Lit scales are the head end; the tail goes dark first.
      for (let i = 0; i < n; i++) setLit(i, i >= n - whole);
      setGlow(n - whole, n);
      const pi = n - whole;
      const part = litF - Math.floor(litF);
      const q = part > 1e-3 ? Math.round(part * 20) : 20;
      if (pi !== partialIdx) clearPartial();
      if (pi >= 0 && pi < n && q !== partialQ) {
        partialIdx = pi;
        partialQ = q;
        segs[pi]!.style.opacity = q >= 20 ? '' : String(0.25 + 0.75 * (q / 20));
      }
      isUrgent = left <= URGENT_S && sel.bossClockRunning(s);
      const sec = Math.ceil(left);
      if (sec !== lastSec) {
        setCount(`${sec} s`);
        if (isUrgent && lastSec > sec && typeof count.animate === 'function') {
          count.animate([{ transform: 'scale(1.45)', color: '#fff4d8' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
        }
        lastSec = sec;
      }
      setBeat(isUrgent ? 0.42 : 0.95);
    } else {
      for (let i = 0; i < n; i++) setLit(i, true);
      setGlow(0, n);
      setBeat(3.2);
      setCount('');
    }
    if (isUrgent !== urgent) {
      urgent = isUrgent;
      setClass(root, 'urgent', urgent);
    }
    snap = false;
  });
}
