// DOM UI root: regions, named anchors (screen positions effects can fly to), the right-panel
// inset that the camera frames around, toasts, and a ~10 Hz refresh tick for text updates.
// #ui has pointer-events: none; only elements with class "interactive" catch the pointer.
import './styles.css';
import type { Camera } from '../render/camera';
import type { Vec2 } from '../lib/vec';
import type { Ui, UiRegions } from './api';
import { toastIcon } from './icons';

/** Must match .ui-panel width in styles.css. */
export const PANEL_WIDTH = 340;
const REFRESH_INTERVAL = 0.1;
/** How long a toast stays up (a waiting queue shortens it). */
const TOAST_SECONDS = 3.4;
const TOAST_SECONDS_BUSY = 2.2;
/** Must match the `toast-leave` animation length in styles.css. */
const TOAST_LEAVE_MS = 380;
/** At most this many on screen; the rest wait their turn. */
const TOAST_MAX = 2;
/** Longest queue; the oldest waiting toast is dropped beyond it. */
const TOAST_QUEUE = 4;

type ToastKind = 'unlock' | 'upgrade' | 'milestone' | 'info';

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
  /** The zoom cinematic owns the screen (setCinematic): the UI is faded out and inert. */
  private cinematic = false;
  private readonly cineAnims: Animation[] = [];
  private toastQueue: { text: string; kind: ToastKind }[] = [];
  private toastsLive = 0;
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
    // During a cinematic the stage keeps the whole window; the inset returns with the UI.
    this.camera.insetRightTarget = open && !this.cinematic ? PANEL_WIDTH : 0;
    this.dirty = true;
  }

  /**
   * Cinematic mode (the zoom): the HUD, the panel, toasts and in-stage prompts fade out and go inert
   * (no pointer, no focus), and the stage takes the whole window; false brings them back. Toasts
   * raised meanwhile (the new tier's unlocks) wait and show once the UI is back. Idempotent.
   */
  setCinematic(on: boolean): void {
    if (on === this.cinematic) return;
    this.cinematic = on;
    this.root.classList.toggle('ui-cinematic', on);
    for (const a of this.cineAnims) a.cancel();
    this.cineAnims.length = 0;
    const els = [this.regions.hud, this.regions.panel, this.regions.toasts, this.stage];
    for (const el of els) {
      el.inert = on;
      if (typeof el.animate === 'function') {
        const a = el.animate(on ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], {
          duration: on ? 420 : 650,
          easing: on ? 'ease-in' : 'ease-out',
          fill: on ? 'forwards' : 'none',
        });
        this.cineAnims.push(a);
      } else {
        el.style.opacity = on ? '0' : '';
      }
    }
    if (on && document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.camera.insetRightTarget = this.open && !on ? PANEL_WIDTH : 0;
    this.dirty = true;
    if (!on) this.pumpToasts();
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    if (!text) return;
    this.toastQueue.push({ text, kind });
    if (this.toastQueue.length > TOAST_QUEUE) this.toastQueue.shift();
    if (!this.cinematic) this.pumpToasts();
  }

  private pumpToasts(): void {
    if (this.cinematic) return;
    while (this.toastsLive < TOAST_MAX && this.toastQueue.length > 0) {
      const { text, kind } = this.toastQueue.shift()!;
      this.showToast(text, kind);
    }
  }

  private showToast(text: string, kind: ToastKind): void {
    this.toastsLive++;
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast-${kind}`;
    if (kind !== 'info') el.appendChild(toastIcon(kind));
    const body = document.createElement('span');
    body.className = 'ui-toast-body';
    const inner = document.createElement('span');
    inner.className = 'ui-toast-text';
    inner.textContent = text;
    body.appendChild(inner);
    if (kind !== 'info') {
      // A clipped highlight sweeps across the letters (the base keeps its legibility shadow).
      const shine = document.createElement('span');
      shine.className = 'ui-toast-shine';
      shine.textContent = text;
      shine.setAttribute('aria-hidden', 'true');
      body.appendChild(shine);
    }
    el.appendChild(body);
    this.regions.toasts.appendChild(el);
    const start = performance.now();
    // Stay the full time, unless others are waiting (then leave after the shorter time).
    const check = (): void => {
      const age = (performance.now() - start) / 1000;
      if (age >= TOAST_SECONDS || (this.toastQueue.length > 0 && age >= TOAST_SECONDS_BUSY)) {
        el.classList.add('leaving');
        window.setTimeout(() => {
          el.remove();
          this.toastsLive--;
          this.pumpToasts();
        }, TOAST_LEAVE_MS);
      } else window.setTimeout(check, 200);
    };
    window.setTimeout(check, TOAST_SECONDS_BUSY * 1000);
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
