// The zoom director (WP 2.1): the prestige cinematic (PLAN §4.5), layer slot 'zoom' (5), above the
// world and below fx.text / post. The cinematic itself lives in cinematic.ts; this wires it to the
// game (zoomBegin, resync), the layer stack, the ZoomApi and the ?debug controls.
import type { Scene } from '../../app/scene';
import type { Layer } from '../types';
import type { ZoomApi, ZoomBeat } from './api';
import { Cinematic } from './cinematic';
import { zoomTimeline } from './timeline';
import { installZoomDebug } from './debug';
import { sel } from '../../core';

export interface ZoomRender {
  layer: Layer;
  api: ZoomApi;
}

export function createZoom(scene: Scene): ZoomRender {
  const cin = new Cinematic(scene);
  const idleBeats = [zoomTimeline(false).beats, zoomTimeline(true).beats] as const;
  let fakeNext = false;

  const api: ZoomApi = {
    get active() {
      return cin.active;
    },
    onBeat(fn: (beat: ZoomBeat) => void) {
      return cin.onBeat(fn);
    },
    get time() {
      return cin.running ? cin.t : -1;
    },
    get beatTimes() {
      return cin.running ? cin.tl.beats : idleBeats[scene.settings.get('reduceMotion') ? 1 : 0];
    },
  };

  scene.game.on('zoomBegin', (e) => {
    const fake = fakeNext;
    fakeNext = false;
    if (cin.running) return;
    cin.start({ from: e.from, to: e.to, height: e.height, fake });
  });
  // State is the truth: a zoom begun during a silent catch-up arrives as a resync only.
  scene.game.on('resync', () => cin.reconcile());
  // The boss that begins a save's first zoom has just fallen: its ~3 s fall is the time to bake the
  // next tier's art ahead (the rally's frames stay light).
  scene.game.on('bossDefeated', () => {
    const st = scene.game.state;
    if (st.zoom.count === 0 && sel.canZoom(st)) cin.prepare(st.tier + 1);
  });

  const debug = installZoomDebug(scene, cin, () => (fakeNext = true));

  const layer: Layer = {
    name: 'zoom',
    visible: true,
    update(view) {
      debug(view);
      cin.update(view);
    },
    draw(ctx, view) {
      cin.draw(ctx, view);
    },
  };
  return { layer, api };
}
