// Generative, adaptive music (WP 2.6, PLAN §5). STUB until 2.6 lands: silent.
// The engine reads game state every frame (tier, boss, zoom stage) and subscribes to game events
// and scene.zoom.onBeat for cues; it plays on scene.audio.music.
import type { Scene } from '../../app/scene';
import type { MusicApi } from './api';

export function createMusic(_scene: Scene): MusicApi {
  return { playing: false };
}
