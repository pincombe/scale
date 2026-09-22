// Input: clicking anywhere on the stage strikes (forgiving for judges). A click on the dragon is
// aimed at that point; the glowing weak spot is the x5 crit; a click on empty meadow still strikes
// a random point on the body (aimed = false). The UI overlay only catches pointer events on its
// interactive elements, so stage clicks never collide with buttons.
//
// The first gesture (pointer or key, anywhere) unlocks audio and fires onFirstGesture hooks
// (the title overlay hides); that first click also strikes.
import { vec2, type Vec2 } from '../lib/vec';
import type { Scene } from './scene';

export class Input {
  /** Last pointer position over the stage (screen CSS px). */
  readonly pointer: Vec2 = vec2(-1, -1);
  /** Ability hotkeys 1-4 (reserved: the abilities WP assigns this). */
  onAbility: ((slot: number) => void) | null = null;

  private started = false;
  private firstFns: (() => void)[] = [];
  private cursor = '';
  private readonly world: Vec2 = vec2();
  private readonly impact: Vec2 = vec2();

  constructor(
    private readonly scene: Scene,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.addEventListener('pointerdown', this.onStageDown);
    canvas.addEventListener('pointermove', this.onStageMove);
    canvas.addEventListener('pointerleave', this.onStageLeave);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Capture phase on window: any gesture anywhere (UI included) unlocks audio. Safari only
    // resumes an AudioContext from pointerup/click on touch and pen, so listen to all three;
    // gesture() is idempotent and runs the first-gesture hooks exactly once.
    window.addEventListener('pointerdown', this.onAnyGesture, true);
    window.addEventListener('pointerup', this.onAnyGesture, true);
    window.addEventListener('click', this.onAnyGesture, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** True after the first gesture. */
  get hasStarted(): boolean {
    return this.started;
  }

  /** Run fn on the first user gesture (immediately if it already happened). */
  onFirstGesture(fn: () => void): void {
    if (this.started) fn();
    else this.firstFns.push(fn);
  }

  private gesture(): void {
    this.scene.audio.unlock();
    if (this.started) return;
    this.started = true;
    const fns = this.firstFns;
    this.firstFns = [];
    for (const fn of fns) fn();
  }

  private readonly onAnyGesture = (): void => {
    this.gesture();
  };

  private readonly onStageDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.gesture();
    const { camera, dragon, game } = this.scene;
    const w = camera.screenToWorld(e.clientX, e.clientY, this.world);
    const hit = dragon.hitTest(w.x, w.y);
    let x = w.x;
    let y = w.y;
    if (hit === null) {
      const p = dragon.impactPoint(this.impact);
      x = p.x;
      y = p.y;
    }
    game.dispatch({ type: 'strike', weak: hit === 'weak', aimed: hit !== null, x, y });
  };

  private readonly onStageMove = (e: PointerEvent): void => {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    const { camera, dragon } = this.scene;
    const w = camera.screenToWorld(e.clientX, e.clientY, this.world);
    this.setCursor(dragon.hitTest(w.x, w.y) === 'weak' ? 'pointer' : 'crosshair');
  };

  private readonly onStageLeave = (): void => {
    this.pointer.x = -1;
    this.pointer.y = -1;
  };

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.canvas.style.cursor = c;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    this.gesture();
    const k = e.key.toLowerCase();
    if (k === 'm') {
      const s = this.scene.settings;
      s.set('muted', !s.get('muted'));
      e.preventDefault();
    } else if (k >= '1' && k <= '4' && k.length === 1) {
      if (this.onAbility) this.onAbility(k.charCodeAt(0) - 48);
      e.preventDefault();
    }
  };
}
