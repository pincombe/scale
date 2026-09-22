// Scene: the service registry every factory receives. Modules reach each other ONLY through it.
// Resolve lazily: read scene.dragon / scene.crowd / scene.fx inside update/draw/event handlers,
// never in a factory body (they are wired after construction; until then they are null objects).
import type { Game } from './game';
import type { TimeDirector } from './time';
import type { Settings } from './settings';
import type { DebugApi } from './debug';
import type { Input } from './input';
import type { Camera } from '../render/camera';
import type { CameraDirector } from '../render/director';
import type { ParticleSystem } from '../render/particles';
import type { BuiltinSprites, SpriteAtlas } from '../render/atlas';
import type { Palette } from '../render/palette';
import type { Renderer } from '../render/renderer';
import type { DragonView } from '../render/dragon/api';
import type { CrowdView } from '../render/crowd/api';
import type { FxApi } from '../render/fx/api';
import type { Ui } from '../ui/api';
import type { AudioEngine } from '../audio/engine';
import type { Rect, Vec2 } from '../lib/vec';

export interface Scene {
  game: Game;
  time: TimeDirector;
  settings: Settings;
  camera: Camera;
  /** In-tier framing; the M2 zoom director disables it while it flies the camera. */
  director: CameraDirector;
  renderer: Renderer;
  /** Current tier palette (copied into view.palette every frame). */
  palette: Palette;
  particles: { world: ParticleSystem; screen: ParticleSystem };
  atlas: SpriteAtlas;
  /** Ids of the built-in atlas sprites (glow, spark, ember, smoke, dust, coin, ring). */
  sprites: BuiltinSprites;
  dragon: DragonView;
  crowd: CrowdView;
  fx: FxApi;
  ui: Ui;
  audio: AudioEngine;
  input: Input;
  debug: DebugApi;
}

// ---- Null objects: safe stand-ins until the real services are wired in boot ----

export const NULL_DRAGON: DragonView = {
  hitTest: () => null,
  impactPoint: (out: Vec2) => ((out.x = 0.25), (out.y = -0.15), out),
  weakSpot: () => null,
  headPoint: (out: Vec2) => ((out.x = 0), (out.y = -0.2), out),
  bounds: (out: Rect) => ((out.x = 0), (out.y = -0.3), (out.w = 0.5), (out.h = 0.3), out),
};

export const NULL_CROWD: CrowdView = {
  heroPoint: (out: Vec2) => ((out.x = -0.8), (out.y = -1.2), out),
  frontX: () => -0.3,
  bounds: (out: Rect) => ((out.x = -1.4), (out.y = -1.9), (out.w = 1.1), (out.h = 1.9), out),
};

export const NULL_FX: FxApi = {
  damageNumber: () => undefined,
  flash: () => undefined,
  kick: () => undefined,
  onCoinLanded: () => () => undefined,
  burst: () => undefined,
};
