// Small DOM helpers shared by the HUD, panel and title.
import { uiClick, uiDeny, uiHover } from '../audio/sfx';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Set text only when it changed (no layout work for identical strings). */
export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

export function setClass(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

/** Show/hide with the `hidden` attribute, only touching the DOM on change. */
export function setShown(e: HTMLElement, show: boolean): void {
  if (e.hidden === show) e.hidden = !show;
}

/**
 * A game button: hover tick, click tock, and a deny bonk when `enabled()` says no. We never set
 * `disabled` (it would swallow the click, and the deny sound is feedback), we style `.off` instead.
 */
export function gameButton(
  cls: string,
  parent: HTMLElement,
  enabled: () => boolean,
  onPress: () => void,
): HTMLButtonElement {
  const b = el('button', cls + ' interactive', parent);
  b.type = 'button';
  b.addEventListener('pointerenter', () => {
    if (enabled()) uiHover();
  });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!enabled()) {
      uiDeny();
      return;
    }
    uiClick();
    onPress();
  });
  return b;
}
