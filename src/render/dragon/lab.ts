// Dragon lab (dev only; not part of the game build). Open while `npm run dev` runs:
//   http://localhost:5173/src/render/dragon/lab.html?mode=sizes
// Renders the real dragon layer (createDragon) in isolated cells with a golden-hour backdrop and a
// 1.8 m knight for scale, so species can be designed without the rest of the game. It imports only
// render infra + this folder, so other folders' edits don't hot-reload it.
//
// Params: mode=sizes|phases  sizes=0.5,2,10,40  size=2  phase=idle  attack=breath  seed=7
//   cols=2  frac=0.6 (dragon width / cell width)  t=0.5 (pre-roll the phase to this progress, then
//   pause)  speed=1  bones  heads=3  pause  knight=0 (hide the scale knight)
//   fx=0.2 fy=0.5 (focus point as fractions of the rest bounds; zoom = frac of the bounds width)
//   phases=breath,swipe,windup-breath,windup-swipe (mode=phases: only these)
//   mode=seq&seq=windup-swipe,swipe,idle  (cycle a phase sequence; ts=2.3 pre-rolls seconds, then pauses)
//   reach  (draw breathReachX as a cyan line and tailPoint as a magenta dot)
//   tz=145  (the director's target zoom in px/m: selects size-dependent tiers as the game would)
//   over=whiskers:0.8,frill:0.35,tailClub:0.03,tailSpade:0,legPairs:1  (morph overrides)
// Keys: space pause, . step, click a dragon to strike it (the weak spot crits), move the mouse to
// make it look at you.
import type { Scene } from '../../app/scene';
import type { View } from '../types';
import type { DragonAttack, DragonPhase, GameEvent } from '../../core';
import { Camera } from '../camera';
import { SpriteAtlas, registerBuiltinSprites, makeCanvas, context2d } from '../atlas';
import { ParticleSystem } from '../particles';
import { MEADOW } from '../palette';
import { createDragon } from './index';

const P = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = P.get(k);
  const n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

const DUR: Record<DragonPhase, number> = { enter: 1.6, idle: 5, windup: 1.2, breath: 1.5, swipe: 0.9, stagger: 1.4, dying: 1.6 };
const palette = MEADOW;
const atlas = new SpriteAtlas();
const sprites = registerBuiltinSprites(atlas);
const dpr = Math.min(2, window.devicePixelRatio || 1);

interface CellSpec {
  size: number;
  phase: DragonPhase;
  attack: DragonAttack;
  label: string;
  /** Optional phase sequence the cell cycles through (mode=seq). */
  seq?: [DragonPhase, DragonAttack][];
}

function parsePhase(key: string): [DragonPhase, DragonAttack] {
  if (key === 'windup-swipe') return ['windup', 'swipe'];
  if (key === 'windup-breath' || key === 'windup') return ['windup', 'breath'];
  if (key === 'swipe') return ['swipe', 'swipe'];
  return [key as DragonPhase, 'breath'];
}

const mode = P.get('mode') ?? 'sizes';
const specs: CellSpec[] = [];
const seed = num('seed', 7) >>> 0;
if (mode === 'phases') {
  const size = num('size', 2);
  const list: [DragonPhase, DragonAttack][] = [
    ['idle', 'breath'],
    ['enter', 'breath'],
    ['windup', 'breath'],
    ['breath', 'breath'],
    ['windup', 'swipe'],
    ['swipe', 'swipe'],
    ['stagger', 'breath'],
    ['dying', 'breath'],
  ];
  const only = P.get('phases')?.split(',');
  for (const [ph, at] of list) {
    const key = ph === 'windup' ? `windup-${at}` : ph;
    if (only && !only.includes(key)) continue;
    specs.push({ size, phase: ph, attack: at, label: `${ph}${ph === 'windup' ? ':' + at : ''} ${size} m` });
  }
} else if (mode === 'seq') {
  const seq = (P.get('seq') ?? 'idle,windup-breath,breath,idle,windup-swipe,swipe').split(',').map(parsePhase);
  const sizes = (P.get('sizes') ?? P.get('size') ?? '2').split(',').map(Number);
  for (const s of sizes) specs.push({ size: s, phase: seq[0]![0], attack: seq[0]![1], label: `${s} m sequence`, seq });
} else {
  const sizes = (P.get('sizes') ?? '0.5,2,10,40').split(',').map(Number);
  const ph = (P.get('phase') ?? 'idle') as DragonPhase;
  const at = (P.get('attack') ?? 'breath') as DragonAttack;
  for (const s of sizes) specs.push({ size: s, phase: ph, attack: at, label: `${s} m ${ph}` });
}
const cols = num('cols', mode === 'phases' ? 4 : mode === 'seq' ? 1 : 2);
const rows = Math.ceil(specs.length / cols);
// A fixed design size (not the window's), so captures are stable in any pane: vw=1440 vh=900.
const VW = num('vw', 1440);
const VH = num('vh', 900);
const W = Math.floor((VW - (cols - 1) * 2) / cols);
const H = Math.floor((VH - (rows - 1) * 2) / rows);
const frac = num('frac', mode === 'phases' ? 0.5 : 0.6);
const grid = document.getElementById('grid')!;
grid.style.gridTemplateColumns = `repeat(${cols}, ${W}px)`;

type Handler = (e: GameEvent) => void;

class Cell {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly camera = new Camera();
  readonly handlers = new Map<string, Handler[]>();
  readonly world = new ParticleSystem(2048, atlas, 'world');
  readonly pointer = { x: -1, y: -1 };
  readonly dragon: { id: number; index: number; species: string; name: string; epithet: string; size: number; seed: number; phase: DragonPhase; phaseT: number; phaseDur: number; attack: DragonAttack; hp: unknown; maxHp: unknown };
  readonly state: { dragon: Cell['dragon']; flags: Record<string, boolean> };
  readonly render: ReturnType<typeof createDragon>;
  readonly view: View;
  readonly toggles = new Map<string, (v: boolean) => void>();
  bg: HTMLCanvasElement | null = null;
  private seqI = 0;

  constructor(readonly spec: CellSpec) {
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.ctx = context2d(this.canvas);
    const wrap = document.createElement('div');
    wrap.className = 'cell';
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = spec.label;
    wrap.append(this.canvas, tag);
    grid.appendChild(wrap);
    this.dragon = {
      id: 1,
      index: 0,
      species: 'newt',
      name: 'Lab',
      epithet: 'the Tested',
      size: spec.size,
      seed,
      phase: spec.phase,
      phaseT: 0,
      phaseDur: DUR[spec.phase],
      attack: spec.attack,
      hp: null,
      maxHp: null,
    };
    this.state = { dragon: this.dragon, flags: {} };
    this.camera.setViewport(W, H);
    const self = this;
    const scene = {
      game: {
        get state() {
          return self.state;
        },
        on(type: string, fn: Handler) {
          const l = self.handlers.get(type) ?? [];
          l.push(fn);
          self.handlers.set(type, l);
          return () => undefined;
        },
      },
      camera: this.camera,
      // tz=145: pretend the game's director targets this zoom (drives on-screen-size tiers such as
      // the swipe target and loose-scale candidates) while the lab camera stays close.
      director: { enabled: P.has('tz'), target: { x: 0, zoom: num('tz', 100) } },
      crowd: {
        heroPoint: (o: { x: number; y: number }) => ((o.x = -0.95), (o.y = -1.2), o),
        frontX: () => -0.3,
        bounds: (o: { x: number; y: number; w: number; h: number }) => ((o.x = -3), (o.y = -1.9), (o.w = 2.7), (o.h = 1.9), o),
      },
      input: { pointer: this.pointer },
      particles: { world: this.world, screen: this.world },
      atlas,
      sprites,
      palette,
      debug: {
        enabled: false,
        section: () => undefined,
        button: () => undefined,
        slider: () => undefined,
        watch: () => undefined,
        toggle: (label: string, _get: () => boolean, set: (v: boolean) => void) => self.toggles.set(label, set),
      },
    } as unknown as Scene;
    this.render = createDragon(scene);
    this.view = {
      state: this.state as unknown as View['state'],
      alpha: 0,
      dt: 0,
      time: 0,
      realDt: 0,
      realTime: 0,
      camera: this.camera,
      palette,
      width: W,
      height: H,
      dpr,
      frame: 0,
    };
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.x = this.pointer.y = -1;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const w = this.camera.screenToWorld(e.clientX - r.left, e.clientY - r.top, { x: 0, y: 0 });
      const hit = this.render.view.hitTest(w.x, w.y);
      console.log('hit', hit, w);
      if (hit) this.emit({ type: 'strike', damage: null as never, crit: hit === 'weak', weak: hit === 'weak', stagger: false, aimed: true, x: w.x, y: w.y });
    });
  }

  emit(e: GameEvent): void {
    const l = this.handlers.get(e.type);
    if (l) for (const fn of l) fn(e);
  }

  frame(dt: number, time: number): void {
    const d = this.dragon;
    d.phaseT += dt;
    if (d.phaseT >= d.phaseDur) {
      d.phaseT = 0;
      if (d.phase === 'dying') d.id++;
      const seq = this.spec.seq;
      if (seq) {
        this.seqI = (this.seqI + 1) % seq.length;
        d.phase = seq[this.seqI]![0];
        d.attack = seq[this.seqI]![1];
        d.phaseDur = d.phase === 'idle' ? 1.5 : DUR[d.phase];
      }
      this.emit({ type: 'dragonPhase', id: d.id, phase: d.phase, dur: d.phaseDur });
    }
    // Frame the rest pose like the director: dragon at `frac` of the width, ground at 78%.
    const b = this.render.view.bounds({ x: 0, y: 0, w: 0, h: 0 });
    const cam = this.camera;
    const byWidth = (W * frac) / Math.max(b.w, 0.9);
    const byHeight = (H * 0.62) / Math.max(-b.y, 0.5);
    cam.zoom = P.has('fx') ? byWidth : Math.min(byWidth, byHeight);
    cam.x = P.has('fx') ? b.x + b.w * num('fx', 0.5) : b.x + b.w * 0.5 - (mode === 'phases' ? b.w * 0.25 : b.w * 0.08);
    cam.y = P.has('fy') ? b.y + b.h * num('fy', 0.5) : -((0.78 - 0.5) * H) / cam.zoom;
    cam.update(dt > 0 ? dt : 1 / 60);
    const v = this.view;
    v.dt = dt;
    v.time = time;
    v.realDt = 1 / 60;
    v.realTime = time;
    v.frame++;
    this.render.layer.update!(v);
    this.world.update(dt);
    this.draw();
  }

  draw(): void {
    const ctx = this.ctx;
    const v = this.view;
    if (!this.bg) this.bg = makeBackdrop();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Ground line at y = 0.
    const g = this.camera.worldToScreen(0, 0, { x: 0, y: 0 });
    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, g.y, W, H - g.y);
    ctx.fillStyle = 'rgba(255,207,133,0.25)';
    ctx.fillRect(0, g.y, W, 1);
    if (P.get('knight') !== '0') drawKnight(ctx, this.camera);
    ctx.globalAlpha = 1;
    this.render.layer.draw(ctx, v);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (P.has('reach')) {
      // Debug: where the flame's far end is claimed to be (breathReachX), and the tail tip.
      const rx = this.render.view.breathReachX!();
      const a = this.camera.worldToScreen(rx, 0, { x: 0, y: 0 });
      ctx.fillStyle = '#00ffcc';
      ctx.fillRect(a.x - 1, 0, 2, H);
      const t = this.render.view.tailPoint!({ x: 0, y: 0 });
      const b = this.camera.worldToScreen(t.x, t.y, { x: 0, y: 0 });
      ctx.fillStyle = '#ff00cc';
      ctx.fillRect(b.x - 4, b.y - 4, 8, 8);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.world.draw(ctx, v);
  }
}

function makeBackdrop(): HTMLCanvasElement {
  const c = makeCanvas(W * dpr, H * dpr);
  const ctx = context2d(c);
  ctx.scale(dpr, dpr);
  const hz = H * 0.78;
  const g = ctx.createLinearGradient(0, 0, 0, hz);
  for (const s of palette.sky) g.addColorStop(s.at, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, hz + 1);
  const sx = W * 0.72;
  const sy = hz - H * 0.12;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.6);
  glow.addColorStop(0, 'rgba(255,190,110,0.55)');
  glow.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = palette.sun.color;
  ctx.beginPath();
  ctx.arc(sx, sy, H * 0.05, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** A plain 1.8 m knight silhouette at x = -0.95 for scale. */
function drawKnight(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.save();
  cam.apply(ctx);
  ctx.translate(-0.95, 0);
  for (let pass = 0; pass < 2; pass++) {
    ctx.save();
    if (pass === 0) {
      const k = 1.8 / cam.zoomEff;
      ctx.translate(palette.light.x * k, palette.light.y * k);
    }
    ctx.fillStyle = pass === 0 ? palette.rim : palette.silhouette;
    ctx.fillRect(-0.13, -0.95, 0.1, 0.95);
    ctx.fillRect(0.03, -0.95, 0.1, 0.95);
    ctx.fillRect(-0.2, -1.5, 0.4, 0.6);
    ctx.beginPath();
    ctx.arc(0, -1.62, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(0.15, -1.3, 0.7, 0.06);
    ctx.restore();
  }
  ctx.restore();
}

const cells = specs.map((s) => new Cell(s));
if (P.has('bones')) for (const c of cells) c.toggles.get('show bones')?.(true);
if (num('heads', 1) === 3) for (const c of cells) c.toggles.get('three heads')?.(true);
// over=whiskers:0.8,frill:0.35,tailClub:0.03 -> morph overrides for every cell.
const overParam = P.get('over');
if (overParam) {
  const o: Record<string, number> = {};
  for (const kv of overParam.split(',')) {
    const [k, v] = kv.split(':');
    if (k && v !== undefined) o[k] = Number(v);
  }
  for (const c of cells) c.render.setOverride(o);
}

let paused = P.has('pause');
let time = 0;
let stepOnce = false;
const speed = num('speed', 1);
const prerollS = P.get('ts');
if (prerollS !== null) {
  // Sequence still: run for this many seconds, then pause.
  const n = Math.round(Number(prerollS) * 60);
  for (const c of cells) for (let i = 0; i < n; i++) c.frame(1 / 60, (i + 1) / 60);
  paused = true;
}
const preroll = P.get('t');
if (preroll !== null) {
  // Deterministic still: run each cell up to phase progress t, then pause.
  const t = Number(preroll);
  for (const c of cells) {
    const n = Math.round((t * c.dragon.phaseDur) / (1 / 60));
    for (let i = 0; i < n; i++) c.frame(1 / 60, (i + 1) / 60);
  }
  paused = true;
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') paused = !paused;
  if (e.key === '.') stepOnce = true;
});

(window as unknown as { __lab: unknown }).__lab = { cells, setPaused: (p: boolean) => (paused = p) };

function tick(): void {
  requestAnimationFrame(tick);
  let dt = paused ? 0 : (1 / 60) * speed;
  if (stepOnce) {
    dt = 1 / 60;
    stepOnce = false;
  }
  time += dt;
  for (const c of cells) c.frame(dt, time);
}
requestAnimationFrame(tick);
