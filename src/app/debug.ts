// ?debug panel (bottom-left, collapsible). Other modules add controls through DebugApi; without
// ?debug every method is a cheap no-op, so registering unconditionally is fine.
//
//   scene.debug.button('Breathe fire', () => ..., 'b')
//   scene.debug.slider('Rim width', 0, 4, 0.1, () => p.rimWidth, (v) => (p.rimWidth = v))
//   scene.debug.toggle('Show bones', () => showBones, (v) => (showBones = v))
//   scene.debug.watch('Spine nodes', () => String(n))
//
// Hotkeys are single keys (case-insensitive). Reserved: m (mute), 1-4 (abilities), ` (collapse).
import type { LoopStats } from './loop';

export interface DebugApi {
  readonly enabled: boolean;
  /** Start a titled group; later controls go under it. */
  section(title: string): void;
  button(label: string, fn: () => void, hotkey?: string): void;
  slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): void;
  toggle(label: string, get: () => boolean, set: (v: boolean) => void, hotkey?: string): void;
  /** A live readout, refreshed a few times per second. */
  watch(label: string, fn: () => string): void;
}

/** What the loop feeds the panel each frame (internal to app). */
export interface DebugPanel extends DebugApi {
  frame(stats: LoopStats): void;
}

const RESERVED = new Set(['m', '1', '2', '3', '4', '`']);

export function createDebug(enabled: boolean, root: HTMLElement | null): DebugPanel {
  if (!enabled || !root) return NOOP;
  return new Panel(root);
}

const NOOP: DebugPanel = {
  enabled: false,
  section: () => undefined,
  button: () => undefined,
  slider: () => undefined,
  toggle: () => undefined,
  watch: () => undefined,
  frame: () => undefined,
};

const RING = 240;

interface Watch {
  fn: () => string;
  el: HTMLElement;
  last: string;
}

interface Refresher {
  (): void;
}

class Panel implements DebugPanel {
  readonly enabled = true;
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly spark: HTMLCanvasElement;
  private readonly sparkCtx: CanvasRenderingContext2D;
  private group: HTMLElement;
  private readonly watches: Watch[] = [];
  private readonly refreshers: Refresher[] = [];
  private readonly hotkeys = new Map<string, () => void>();
  private readonly frames = new Float32Array(RING);
  private readonly cpu = new Float32Array(RING);
  private readonly scratch = new Float32Array(RING);
  private head = 0;
  private filled = 0;
  private lastText = 0;
  private lastSpark = 0;
  private collapsed = false;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dbg';
    const header = document.createElement('div');
    header.className = 'dbg-head';
    header.textContent = 'SCALE debug  (` to fold)';
    header.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.el.appendChild(header);
    this.statsEl = document.createElement('div');
    this.statsEl.className = 'dbg-stats';
    this.el.appendChild(this.statsEl);
    this.spark = document.createElement('canvas');
    this.spark.className = 'dbg-spark';
    this.spark.width = RING;
    this.spark.height = 44;
    this.sparkCtx = this.spark.getContext('2d')!;
    this.el.appendChild(this.spark);
    this.body = document.createElement('div');
    this.body.className = 'dbg-body';
    this.el.appendChild(this.body);
    this.group = this.body;
    root.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
  }

  private setCollapsed(c: boolean): void {
    this.collapsed = c;
    this.el.classList.toggle('dbg-collapsed', c);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === '`') {
      this.setCollapsed(!this.collapsed);
      return;
    }
    const fn = this.hotkeys.get(k);
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  private bindKey(hotkey: string | undefined, fn: () => void): string {
    if (!hotkey) return '';
    const k = hotkey.toLowerCase();
    if (RESERVED.has(k)) {
      console.warn(`debug: hotkey '${k}' is reserved`);
      return '';
    }
    if (this.hotkeys.has(k)) console.warn(`debug: hotkey '${k}' rebound`);
    this.hotkeys.set(k, fn);
    return ` [${k.toUpperCase()}]`;
  }

  section(title: string): void {
    const s = document.createElement('div');
    s.className = 'dbg-section';
    const h = document.createElement('div');
    h.className = 'dbg-title';
    h.textContent = title;
    s.appendChild(h);
    this.body.appendChild(s);
    this.group = s;
  }

  button(label: string, fn: () => void, hotkey?: string): void {
    const b = document.createElement('button');
    b.className = 'dbg-btn';
    b.textContent = label + this.bindKey(hotkey, fn);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    this.group.appendChild(b);
  }

  slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): void {
    const row = document.createElement('label');
    row.className = 'dbg-row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const val = document.createElement('span');
    val.className = 'dbg-val';
    const show = (): void => {
      const v = get();
      val.textContent = Math.abs(v) >= 100 || Number.isInteger(step) ? String(Math.round(v * 100) / 100) : v.toFixed(2);
    };
    input.addEventListener('input', () => {
      set(Number(input.value));
      show();
    });
    this.refreshers.push(() => {
      if (document.activeElement !== input) input.value = String(get());
      show();
    });
    show();
    row.append(name, input, val);
    this.group.appendChild(row);
  }

  toggle(label: string, get: () => boolean, set: (v: boolean) => void, hotkey?: string): void {
    const row = document.createElement('label');
    row.className = 'dbg-row dbg-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    const name = document.createElement('span');
    name.textContent = label + this.bindKey(hotkey, () => set(!get()));
    input.addEventListener('change', () => set(input.checked));
    this.refreshers.push(() => {
      const v = get();
      if (input.checked !== v) input.checked = v;
    });
    row.append(input, name);
    this.group.appendChild(row);
  }

  watch(label: string, fn: () => string): void {
    const row = document.createElement('div');
    row.className = 'dbg-watch';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'dbg-val';
    row.append(name, val);
    this.group.appendChild(row);
    this.watches.push({ fn, el: val, last: '' });
  }

  frame(stats: LoopStats): void {
    this.frames[this.head] = stats.frameMs;
    this.cpu[this.head] = stats.cpuMs;
    this.head = (this.head + 1) % RING;
    if (this.filled < RING) this.filled++;
    const now = performance.now();
    if (this.collapsed) return;
    if (now - this.lastSpark > 100) {
      this.lastSpark = now;
      this.drawSpark();
    }
    if (now - this.lastText > 250) {
      this.lastText = now;
      this.updateText();
    }
  }

  /** p-th percentile (0..1) of the first `n` ring entries of `src`. */
  private percentile(src: Float32Array, p: number): number {
    const n = this.filled;
    const s = this.scratch;
    for (let i = 0; i < n; i++) s[i] = src[i]!;
    const view = s.subarray(0, n);
    view.sort();
    return view[Math.min(n - 1, Math.floor(p * (n - 1)))] ?? 0;
  }

  private updateText(): void {
    const n = this.filled;
    if (n > 0) {
      let sum = 0;
      let cpuSum = 0;
      for (let i = 0; i < n; i++) {
        sum += this.frames[i]!;
        cpuSum += this.cpu[i]!;
      }
      const avgMs = sum / n;
      const p99 = this.percentile(this.frames, 0.99);
      const cpuAvg = cpuSum / n;
      const cpuP99 = this.percentile(this.cpu, 0.99);
      this.statsEl.textContent =
        `FPS ${(1000 / avgMs).toFixed(1)}  1% low ${(1000 / Math.max(p99, 0.001)).toFixed(1)}\n` +
        `CPU ${cpuAvg.toFixed(2)} ms  p99 ${cpuP99.toFixed(2)} ms`;
    }
    for (const w of this.watches) {
      let v: string;
      try {
        v = w.fn();
      } catch (err) {
        v = 'ERR ' + String(err);
      }
      if (v !== w.last) {
        w.last = v;
        w.el.textContent = v;
      }
    }
    for (const r of this.refreshers) r();
  }

  private drawSpark(): void {
    const ctx = this.sparkCtx;
    const w = this.spark.width;
    const h = this.spark.height;
    const scale = h / 50; // 50 ms full height
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, h - 16.7 * scale, w, 1);
    ctx.fillRect(0, h - 33.3 * scale, w, 1);
    for (let i = 0; i < this.filled; i++) {
      const idx = (this.head - this.filled + i + RING) % RING;
      const f = this.frames[idx]!;
      const c = this.cpu[idx]!;
      const x = RING - this.filled + i;
      ctx.fillStyle = f > 20 ? '#ff5a3c' : '#6fd08c';
      const fh = Math.min(h, f * scale);
      ctx.fillRect(x, h - fh, 1, fh);
      ctx.fillStyle = '#ffd35a';
      ctx.fillRect(x, h - Math.min(h, c * scale), 1, 1.5);
    }
  }
}
