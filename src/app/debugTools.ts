// The standard ?debug controls and URL parameters (only installed under ?debug).
//
// URL params (all optional, combine freely), e.g. ?debug&dragon=12&footman=60&archer=20&phase=windup&loop
//   seed=N        fixed RNG seed           dragon=N   start at dragon #N of the tier
//   footman=N     archer=N  gold=N         speed=X    time scale (0-20)
//   pause         start paused ('.' steps) layers=a,b only these layers visible (e.g. layers=dragon)
//   phase=P       force a dragon phase (windup|breath|swipe|stagger|idle|enter|dying|leave), attack=breath|swipe
//   loop          repeat the current phase forever      immortal   HP refills instead of dying
//   panel=0|1     force the right panel      stress     particle stress test on
// M2 (applied first: tier, then the rest):
//   tier=N        jump to tier N like a zoom without the cinematic (0 Meadow, 1 Mountain)
//   boss          fill the Wyrm Gauge (the boss comes after the current dragon)
//   cleared       the tier's boss counts as beaten (a save that never zoomed starts its zoom at once)
//   scales=N      +N Scales (opens Heraldry)   lancer=N   +N lancers
import { createInitialState, fmt, sel } from '../core';
import type { DragonAttack, DragonPhase, UnitId } from '../core';
import type { Scene } from './scene';
import type { Loop } from './loop';
import { CURVE_FADE, CURVE_PULSE, particleSpec } from '../render/particles';

declare global {
  interface Window {
    /** Debug handle (only under ?debug): drive the game from the console or an agent. */
    __scale?: { game: Scene['game']; scene: Scene; time: Scene['time']; loop: () => Loop };
  }
}

const PHASES: readonly DragonPhase[] = ['enter', 'idle', 'windup', 'breath', 'swipe', 'stagger', 'dying', 'leave'];
const STRESS_TARGET = 1500;

/** "1.8 m", "224 m", "4.36 km" for the debug watch. */
function fmtMeters(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m >= 100 ? Math.round(m) + ' m' : m.toFixed(1) + ' m';
}

/** Registers the controls; returns a per-frame hook for the app loop. */
export function installDebugTools(scene: Scene, params: URLSearchParams, loop: () => Loop): () => void {
  const { game, time, debug, particles, renderer, camera, ui } = scene;
  window.__scale = { game, scene, time, loop };

  const units = (unit: UnitId, amount: number): void => game.dispatch({ type: 'debug', op: 'units', unit, amount });
  const phase = (p: DragonPhase, attack?: DragonAttack): void => game.dispatch({ type: 'debug', op: 'phase', phase: p, attack });
  const flag = (f: string, v: boolean): void => game.dispatch({ type: 'debug', op: 'flag', flag: f, value: v });

  debug.section('Watch');
  debug.watch('particles', () => `${particles.world.count} world / ${particles.screen.count} screen`);
  debug.watch('dragon', () => {
    const d = game.state.dragon;
    return `#${d.index} ${d.size.toFixed(2)} m ${d.phase}`;
  });
  debug.watch('hp', () => `${fmt(game.state.dragon.hp)} / ${fmt(game.state.dragon.maxHp)}`);
  debug.watch('gold', () => fmt(game.state.gold));
  debug.watch('army', () => `${game.state.units.footman} foot / ${game.state.units.archer} arch / ${game.state.units.lancer} lance`);
  debug.watch('tier', () => `${game.state.tier} · knights ${fmtMeters(game.state.height)} · zooms ${game.state.zoom.count} · fusion ×${game.state.zoom.fusion.toFixed(2)}`);
  debug.watch('gauge', () => {
    const s = game.state;
    const g = `${Math.round(sel.gauge(s) * 100)}% (${s.wyrm.charge}/${sel.bossAt(s.tier)})`;
    return s.wyrm.cleared ? g + ' cleared' : g;
  });
  debug.watch('boss', () => {
    const s = game.state;
    if (!s.dragon.boss) return s.wyrm.escapes > 0 ? `- (${s.wyrm.escapes} escaped)` : '-';
    return `${s.dragon.boss} ${sel.bossTimeLeft(s).toFixed(1)} / ${s.wyrm.bossDur} s${sel.bossClockRunning(s) ? '' : ' (paused)'}`;
  });
  debug.watch('scales', () => fmt(game.state.scales));
  debug.watch('zoom', () => {
    const z = game.state.zoom;
    return z.stage ?? (sel.canZoom(game.state) ? 'ready' : '-');
  });
  debug.watch('camera', () => `${camera.zoom.toFixed(1)} px/m  x ${camera.x.toFixed(2)}`);
  debug.watch('time', () => `x${time.scale.toFixed(2)}  ticks ${loop().stats.ticks}`);
  debug.watch('dilation', () => time.dilation.toFixed(2));
  debug.watch('events', () => String(game.delivered));

  debug.section('Time');
  debug.slider('time scale', 0, 20, 0.25, () => time.debugScale, (v) => (time.debugScale = v));
  debug.toggle('pause', () => time.paused, (v) => (time.paused = v), 'p');
  debug.button('step', () => {
    time.paused = true;
    time.step();
  }, '.');
  debug.button('hit-stop', () => time.hitStop(0.3));
  debug.button('slow-mo', () => time.slowMo(0.2, 1.5));

  debug.section('Game');
  debug.button('kill dragon', () => game.dispatch({ type: 'debug', op: 'kill' }), 'k');
  debug.button('next dragon', () => game.dispatch({ type: 'debug', op: 'next' }), 'n');
  debug.button('gold x10', () => game.dispatch({ type: 'debug', op: 'gold', amount: Math.max(100, game.state.gold.mul(9).toNumber()) }), 'g');
  debug.button('+10 footmen', () => units('footman', 10), 'f');
  debug.button('+10 archers', () => units('archer', 10), 'a');
  debug.button('+100 footmen', () => units('footman', 100));
  debug.button('+10 lancers', () => units('lancer', 10));
  debug.slider('dragon #', 0, 40, 1, () => game.state.dragon.index, (v) => game.dispatch({ type: 'debug', op: 'dragon', amount: v }));
  debug.button('reset game', () => game.replaceState(createInitialState(game.state.seed)));
  debug.toggle('panel open', () => ui.panelOpen, (v) => ui.setPanelOpen(v));

  debug.section('Dragon');
  debug.button('windup: breath', () => phase('windup', 'breath'), 'w');
  debug.button('windup: swipe', () => phase('windup', 'swipe'));
  debug.button('breath', () => phase('breath', 'breath'));
  debug.button('swipe', () => phase('swipe', 'swipe'));
  debug.button('stagger', () => phase('stagger'));
  debug.button('idle', () => phase('idle'));
  debug.button('enter', () => phase('enter'));
  debug.button('leave', () => phase('leave'));
  debug.toggle('loop phase', () => !!game.state.flags['debug.loopPhase'], (v) => flag('debug.loopPhase', v), 'l');
  debug.toggle('immortal', () => !!game.state.flags['debug.immortal'], (v) => flag('debug.immortal', v), 'i');

  debug.section('Zoom (M2)');
  debug.button('summon boss', () => game.dispatch({ type: 'debug', op: 'boss' }));
  debug.button('clear boss', () => game.dispatch({ type: 'debug', op: 'cleared' }));
  debug.button('zoom begin', () => game.dispatch({ type: 'zoom', stage: 'begin' }));
  debug.button('+10 Scales', () => game.dispatch({ type: 'debug', op: 'scales', amount: 10 }));
  debug.button('tier 0 (Meadow)', () => game.dispatch({ type: 'debug', op: 'tier', amount: 0 }));
  debug.button('tier 1 (Mountain)', () => game.dispatch({ type: 'debug', op: 'tier', amount: 1 }));

  debug.section('Juice');
  debug.button('shake', () => camera.addTrauma(0.6), 's');
  debug.button('flash', () => scene.fx.flash('#fff1c4', 0.5, 0.4));
  debug.button('kick', () => scene.fx.kick(1));
  debug.toggle('reduce motion', () => scene.settings.get('reduceMotion'), (v) => scene.settings.set('reduceMotion', v));
  debug.toggle('reduce flashes', () => scene.settings.get('reduceFlashes'), (v) => scene.settings.set('reduceFlashes', v));

  debug.section('Layers');
  for (const l of renderer.layerList) debug.toggle(l.name, () => l.visible, (v) => (l.visible = v));

  // Particle stress test: keep ~1,500 world particles alive (a mix of additive and normal).
  let stress = false;
  const glow = particleSpec({ sprite: scene.sprites.glow, additive: true, life: 2, lifeVar: 0.4, speed: 60, spread: Math.PI, size: 40, sizeEnd: 10, curve: CURVE_PULSE, alpha: 0.6 });
  const spark = particleSpec({ sprite: scene.sprites.spark, additive: true, align: true, life: 1.4, lifeVar: 0.4, speed: 260, spread: Math.PI, gravity: 120, drag: 0.5, size: 36, sizeEnd: 12 });
  const smoke = particleSpec({ sprite: scene.sprites.smoke, life: 2.4, lifeVar: 0.3, speed: 40, angle: -Math.PI / 2, spread: 0.8, size: 60, sizeEnd: 130, curve: CURVE_FADE, alpha: 0.35, spinVar: 0.6 });
  const specs = [glow, spark, smoke];
  let rr = 0;
  debug.section('Stress');
  debug.toggle('particles ~1,500', () => stress, (v) => (stress = v), 'x');

  // ---- URL params ----
  const num = (k: string): number | null => {
    const v = params.get(k);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const tier = num('tier');
  if (tier !== null) game.dispatch({ type: 'debug', op: 'tier', amount: tier });
  const d = num('dragon');
  if (d !== null) game.dispatch({ type: 'debug', op: 'dragon', amount: d });
  const f = num('footman');
  if (f !== null) units('footman', f);
  const a = num('archer');
  if (a !== null) units('archer', a);
  const lancers = num('lancer');
  if (lancers !== null) units('lancer', lancers);
  const scales = num('scales');
  if (scales !== null) game.dispatch({ type: 'debug', op: 'scales', amount: scales });
  if (params.has('boss')) game.dispatch({ type: 'debug', op: 'boss' });
  if (params.has('cleared')) game.dispatch({ type: 'debug', op: 'cleared' });
  const g = num('gold');
  if (g !== null) game.dispatch({ type: 'debug', op: 'gold', amount: g });
  const sp = num('speed');
  if (sp !== null) time.debugScale = Math.max(0, Math.min(20, sp));
  if (params.has('pause')) time.paused = true;
  if (params.has('loop')) flag('debug.loopPhase', true);
  if (params.has('immortal')) flag('debug.immortal', true);
  const ph = params.get('phase') as DragonPhase | null;
  if (ph && PHASES.includes(ph)) phase(ph, (params.get('attack') as DragonAttack | null) ?? undefined);
  const panel = num('panel');
  if (panel !== null) ui.setPanelOpen(panel > 0);
  const layers = params.get('layers');
  if (layers) {
    const keep = new Set(layers.split(','));
    for (const l of renderer.layerList) l.visible = keep.has(l.name);
  }
  if (params.has('stress')) stress = true;
  if (d !== null || f !== null || a !== null || lancers !== null) game.post({ type: 'resync' });

  return () => {
    if (!stress) return;
    const w = particles.world;
    const deficit = STRESS_TARGET - w.count;
    if (deficit <= 0) return;
    const k = 1 / camera.zoomEff;
    const n = Math.min(deficit, 120);
    for (let i = 0; i < n; i++) {
      const s = specs[rr++ % 3]!;
      const sx = (Math.random() * 0.9 + 0.05) * (camera.viewW - camera.insetRight);
      const sy = (Math.random() * 0.75 + 0.1) * camera.viewH;
      const x = camera.x + (sx - camera.stageCX) * k;
      const y = camera.y + (sy - camera.stageCY) * k;
      w.burst(s, x, y, 1, s.angle, k);
    }
  };
}
