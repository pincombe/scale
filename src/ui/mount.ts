// DOM UI root: regions, named anchors (screen positions effects can fly to), the right-panel
// inset that the camera frames around, toasts, and a ~10 Hz refresh tick for text updates.
// #ui has pointer-events: none; only elements with class "interactive" catch the pointer.
import './styles.css';
import type { Camera } from '../render/camera';
import type { Vec2 } from '../lib/vec';
import type { Ui, UiRegions } from './api';

/** Must match .ui-panel width in styles.css. */
export const PANEL_WIDTH = 340;
const REFRESH_INTERVAL = 0.1;
/** Must match the `toast` animation length in styles.css. */
const TOAST_SECONDS = 3.6;
/** Oldest toasts leave early when more than this many are on screen. */
const TOAST_MAX = 3;

interface Anchor {
  el: HTMLElement;
  x: number;
  y: number;
  ok: boolean;
}

export class UiRoot implements Ui {
  readonly regions: UiRegions;
  private readonly anchors = new Map<string, Anchor>();
  private dirty = true;
  private refreshFns: (() => void)[] = [];
  private frameFns: ((realDt: number) => void)[] = [];
  /**
   * Stage-space layer (tracks the uncovered stage like the HUD): the lone "Hire a Footman" button
   * and other in-scene prompts. Internal to src/ui.
   */
  readonly stage: HTMLElement;
  private refreshAcc = 0;
  private open = false;
  private readonly observer: ResizeObserver | null;

  constructor(
    readonly root: HTMLElement,
    private readonly camera: Camera,
  ) {
    const region = (cls: string): HTMLElement => {
      const el = document.createElement('div');
      el.className = cls;
      root.appendChild(el);
      return el;
    };
    this.regions = {
      hud: region('ui-hud'),
      panel: region('ui-panel'),
      toasts: region('ui-toasts'),
      overlay: region('ui-overlay'),
      debug: region('ui-debug'),
    };
    this.stage = document.createElement('div');
    this.stage.className = 'ui-stage';
    root.insertBefore(this.stage, this.regions.panel);
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (this.dirty = true)) : null;
    this.observer?.observe(this.regions.hud);
    window.addEventListener('resize', () => (this.dirty = true));
    this.regions.panel.addEventListener('transitionend', () => (this.dirty = true));
  }

  registerAnchor(name: string, el: HTMLElement): void {
    this.anchors.set(name, { el, x: 0, y: 0, ok: false });
    this.observer?.observe(el);
    this.dirty = true;
  }

  invalidateAnchors(): void {
    this.dirty = true;
  }

  anchor(name: string, out: Vec2): Vec2 | null {
    if (this.dirty) this.measure();
    const a = this.anchors.get(name);
    if (!a || !a.ok) return null;
    out.x = a.x;
    out.y = a.y;
    return out;
  }

  private measure(): void {
    this.dirty = false;
    for (const a of this.anchors.values()) {
      const r = a.el.getBoundingClientRect();
      a.ok = r.width > 0 || r.height > 0;
      a.x = r.left + r.width * 0.5;
      a.y = r.top + r.height * 0.5;
    }
  }

  pulse(name: string): void {
    const a = this.anchors.get(name);
    if (!a || typeof a.el.animate !== 'function') return;
    a.el.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
  }

  get panelOpen(): boolean {
    return this.open;
  }

  setPanelOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.regions.panel.classList.toggle('open', open);
    this.root.classList.toggle('panel-open', open);
    this.camera.insetRightTarget = open ? PANEL_WIDTH : 0;
    this.dirty = true;
  }

  toast(text: string, kind: 'unlock' | 'milestone' | 'info' = 'info'): void {
    if (!text) return;
    const box = this.regions.toasts;
    // Newest on top; drop the oldest beyond the cap (they fade quickly instead of popping).
    const live = box.querySelectorAll('.ui-toast:not(.leaving)');
    for (let i = live.length - TOAST_MAX; i >= 0; i--) this.dismiss(live[live.length - 1 - i] as HTMLElement);
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast-${kind}`;
    const inner = document.createElement('span');
    inner.className = 'ui-toast-text';
    inner.textContent = text;
    el.appendChild(inner);
    if (kind !== 'info') {
      // A clipped highlight sweeps across the letters (the base keeps its legibility shadow).
      const shine = document.createElement('span');
      shine.className = 'ui-toast-shine';
      shine.textContent = text;
      shine.setAttribute('aria-hidden', 'true');
      el.appendChild(shine);
    }
    box.prepend(el);
    window.setTimeout(() => el.remove(), TOAST_SECONDS * 1000);
  }

  private dismiss(el: HTMLElement): void {
    el.classList.add('leaving');
    window.setTimeout(() => el.remove(), 320);
  }

  onRefresh(fn: () => void): void {
    this.refreshFns.push(fn);
  }

  /**
   * Run fn every frame with wall-clock dt (internal to src/ui): only for the few values that must
   * animate smoothly (gold count-up, HP bar). Write the DOM only when a value changes.
   */
  onFrame(fn: (realDt: number) => void): void {
    this.frameFns.push(fn);
  }

  /** Called every frame by the app with wall-clock dt; runs refreshers at ~10 Hz. */
  update(realDt: number): void {
    for (let i = 0; i < this.frameFns.length; i++) this.frameFns[i]!(realDt);
    this.refreshAcc += realDt;
    if (this.refreshAcc < REFRESH_INTERVAL) return;
    this.refreshAcc %= REFRESH_INTERVAL;
    for (const fn of this.refreshFns) fn();
  }

  /** Run all refreshers now (after a resync or at startup). */
  refreshNow(): void {
    for (const fn of this.refreshFns) fn();
  }
}
