// The zoom director (WP 2.1): the prestige cinematic (PLAN §4.5). Layer slot 'zoom' (5), above the
// world and below fx.text/post. STUB until WP 2.1 lands: it completes every zoom at once
// (switch, then end) so the game never stalls in a hold, and draws nothing.
import type { Scene } from '../../app/scene';
import type { Layer } from '../types';
import type { ZoomApi, ZoomBeat } from './api';

export interface ZoomRender {
  layer: Layer;
  api: ZoomApi;
}

export function createZoom(scene: Scene): ZoomRender {
  const listeners: ((beat: ZoomBeat) => void)[] = [];
  const api: ZoomApi = {
    active: false,
    onBeat(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  scene.game.on('zoomBegin', () => scene.game.dispatch({ type: 'zoom', stage: 'switch' }));
  scene.game.on('zoomSwitch', () => scene.game.dispatch({ type: 'zoom', stage: 'end' }));
  const layer: Layer = { name: 'zoom', visible: true, draw() {} };
  return { layer, api };
}
