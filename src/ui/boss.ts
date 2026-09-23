// The boss's moments in the UI. The dragon bar turns ornate while a boss fights (hud.ts toggles
// `.boss`; the styles and the wing flourishes are here). On `bossSummon`, an arrival card: a
// red-gold banner sweeps across the top of the stage with the boss's name in Cinzel, its epithet
// and its `arrive` line. On `bossDefeated`, a shorter gilded card with its `fall` line. On
// `bossEscaped`, a wry toast. Cards live in the toasts region, so the cinematic hides them.
import './boss.css';
import { BOSS_TEXT, MICROCOPY } from '../core';
import type { Scene } from '../app/scene';
import { el } from './dom';
import type { UiRoot } from './mount';

/** Arrival card: time on screen before it sweeps away (ms). */
const ARRIVE_MS = 2900;
const FALL_MS = 2500;
/** Must match the `boss-card-out` animation. */
const OUT_MS = 650;

const NS = 'http://www.w3.org/2000/svg';

// A gilded wing flourish for the boss's HP bar (the left one; the right one is mirrored in CSS).
const WING =
  '<path d="M38 8.6C30.5 8.8 24 7 18.2 2.2c.9 2.3.8 4-.4 5.4C14.4 4.8 9.2 3.6 2.6 4.6c3.2 1.4 5 3.1 5.6 5.3C5.4 10.2 3.2 11.6 1.4 14c5.4-1.6 10.8-1.6 16.2.2 5.8-3.2 12.6-4.4 20.4-4.1z"/>' +
  '<path d="M17.8 7.6c-3.6.9-7.4 1.6-11.2 2.3M18.2 11.2c-3-.6-6.6-.6-10.4.2" fill="none" stroke-width=".8" opacity=".55"/>';

/** A wing flourish (hud.ts puts one on each end of the HP bar; CSS shows them in boss mode). */
export function bossWing(side: 'left' | 'right'): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 40 16');
  s.setAttribute('class', 'boss-wing ' + side);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = WING;
  return s;
}

/** An epithet shown on its own line: drop the joining comma ("Who Was Here First"). */
export function epithetLine(epithet: string): string {
  return epithet.replace(/^,\s*/, '').trim();
}

export function createBossMoments(scene: Scene, ui: UiRoot): void {
  const { game } = scene;
  const layer = el('div', 'boss-cards', ui.regions.toasts);
  let current: HTMLElement | null = null;

  const dismiss = (card: HTMLElement): void => {
    if (!card.isConnected || card.classList.contains('out')) return;
    card.classList.add('out');
    window.setTimeout(() => card.remove(), OUT_MS);
    if (current === card) current = null;
  };

  const show = (card: HTMLElement, ms: number): void => {
    if (current) dismiss(current);
    current = card;
    layer.appendChild(card);
    window.setTimeout(() => dismiss(card), ms);
  };

  game.on('bossSummon', (e) => {
    const text = BOSS_TEXT[e.boss];
    if (!text) return;
    const card = el('div', 'boss-card arrive');
    const band = el('div', 'boss-card-band', card);
    const name = el('div', 'boss-card-name', band);
    el('span', 'boss-card-name-base', name, text.name);
    el('span', 'boss-card-name-shine', name, text.name).setAttribute('aria-hidden', 'true');
    const epi = epithetLine(text.epithet);
    if (epi) el('div', 'boss-card-epithet', band, epi);
    el('div', 'boss-card-rule', band);
    if (text.arrive) el('div', 'boss-card-line', band, text.arrive);
    show(card, ARRIVE_MS);
  });

  game.on('bossDefeated', (e) => {
    const text = BOSS_TEXT[e.boss];
    if (!text || !text.fall) return;
    const card = el('div', 'boss-card fall');
    const band = el('div', 'boss-card-band', card);
    el('div', 'boss-card-kicker', band, text.name);
    el('div', 'boss-card-line', band, text.fall);
    show(card, FALL_MS);
  });

  game.on('bossEscaped', () => {
    if (current) dismiss(current);
    ui.toast(MICROCOPY.bossEscaped ?? 'It got away. It will be back, and so will you.', 'info');
  });

  // A zoom's hand-back or a debug jump: no stale card over the new tier.
  game.on('resync', () => {
    if (current) dismiss(current);
  });
}
