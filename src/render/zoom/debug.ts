// ?debug controls for the zoom (the lead reviews the cinematic through these):
//   Zoom now [Z]      kill the dragon, then begin the zoom when its fall is over (the real core
//                     path: 'cleared' begins a save's first zoom, 'zoom begin' later ones; with no
//                     core zoom rules it fakes zoomBegin and jumps the tier at the switch)
//   no fall           the same, without the fall
//   zoom t            scrub: freeze the cinematic at t (plays on to it; back only after the switch)
//   URL               ?debug&zoomAt=T (auto-start, freeze at T) · zoomAuto (auto-start) · zoomFall
//                     (auto-start with the fall)
// Also window.__zoom = { cin, zoomNow, scrub, report } for agents.
import type { Scene } from '../../app/scene';
import type { View } from '../types';
import type { Cinematic } from './cinematic';
import { fakeZoomBegin } from './cinematic';
import { ZOOM_BEATS } from './timeline';

export function installZoomDebug(scene: Scene, cin: Cinematic, markFake: () => void): (view: View) => void {
  const dbg = scene.debug;
  let pendingFall = false;
  let autoAt = -1;
  let autoFall = false;
  let frames = 0;

  const trigger = (): void => {
    const g = scene.game;
    if (cin.running) return;
    // The real core: a save's first zoom begins by itself once the boss counts as beaten.
    g.dispatch({ type: 'debug', op: 'cleared' });
    if (g.state.zoom?.stage !== 'begin') g.dispatch({ type: 'zoom', stage: 'begin' });
    if (g.state.zoom?.stage === 'begin') return;
    // No core zoom rules: fake the begin; the switch falls back to a debug tier jump.
    markFake();
    g.post(fakeZoomBegin(g.state.tier));
  };

  const zoomNow = (fall: boolean): void => {
    if (cin.running) return;
    if (fall) {
      if (scene.game.state.dragon.phase !== 'dying') scene.game.dispatch({ type: 'debug', op: 'kill' });
      pendingFall = true;
      return;
    }
    trigger();
  };

  const dismissTitle = (): void => {
    // The title lifts on the first gesture; a key press is a gesture that strikes nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
  };

  if (dbg.enabled) {
    const params = new URLSearchParams(location.search);
    const at = Number(params.get('zoomAt'));
    if (params.has('zoomAt') && Number.isFinite(at)) {
      autoAt = 0.6;
      cin.scrub(at);
    } else if (params.has('zoomAuto') || params.has('zoomFall')) autoAt = 0.6;
    autoFall = params.has('zoomFall');
    (window as unknown as { __zoom?: unknown }).__zoom = {
      cin,
      zoomNow,
      scrub: (t: number) => cin.scrub(t),
      report: () => cin.perf.report(),
      beats: () => cin.tl.beats,
    };
  }

  dbg.section('Zoom cinematic (2.1)');
  dbg.button('Zoom now', () => zoomNow(true), 'z');
  dbg.button('no fall', () => zoomNow(false));
  dbg.button('abort', () => cin.abort());
  dbg.slider('zoom t', 0, 12, 0.05, () => (cin.running ? cin.t : cin.hold >= 0 ? cin.hold : 0), (v) => cin.scrub(v));
  dbg.toggle('freeze', () => cin.hold >= 0, (v) => cin.scrub(v ? Math.max(0, cin.t) : -1));
  dbg.button('perf report', () => console.log(cin.perf.report()));
  dbg.watch('zoom', () => (cin.running ? `${cin.stage} t=${cin.t.toFixed(2)} z=${cin.geo.zoom.toFixed(0)} fit=${cin.geo.fit.toFixed(2)}` : 'idle'));
  dbg.watch('zoom beats', () => ZOOM_BEATS.map((b) => `${b[0]}${cin.tl.beats[b].toFixed(1)}`).join(' '));
  dbg.watch('zoom mem', () => `${cin.memMB().toFixed(1)} MB`);

  let cpuSrc = false;
  return (view: View) => {
    if (!dbg.enabled) return;
    if (!cpuSrc) {
      cpuSrc = true;
      const s = (window as unknown as { __scale?: { loop: () => { stats: { cpuMs: number } } } }).__scale;
      if (s) cin.frameCpu = () => s.loop().stats.cpuMs;
    }
    frames++;
    if (autoAt >= 0 && view.realTime >= autoAt && frames > 20) {
      autoAt = -1;
      dismissTitle();
      zoomNow(autoFall);
    }
    if (pendingFall && !cin.running) {
      const d = scene.game.state.dragon;
      if (d.phase !== 'dying' || d.phaseT >= d.phaseDur - 0.06) {
        pendingFall = false;
        trigger();
      }
    }
  };
}
