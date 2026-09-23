// Bootstrap: build every service, wire the Scene, install the layer stack, start the loop.
// Per frame (Loop): time.update -> ticks -> game.drain (events) -> director -> camera ->
// renderer.frame (layer updates, drawScene) -> ui.update (10 Hz text) -> debug stats.
import { createInitialState, setNotation } from '../core';
import { Game } from './game';
import { Loop } from './loop';
import { TimeDirector } from './time';
import { Settings } from './settings';
import { Input } from './input';
import { createDebug } from './debug';
import { installDebugTools } from './debugTools';
import { NULL_BACKDROP, NULL_CROWD, NULL_DRAGON, NULL_FX, NULL_MUSIC, NULL_ZOOM, type Scene } from './scene';
import { Camera } from '../render/camera';
import { CameraDirector } from '../render/director';
import { Renderer } from '../render/renderer';
import { SpriteAtlas, registerBuiltinSprites } from '../render/atlas';
import { ParticleSystem, createParticleLayer } from '../render/particles';
import { paletteFor } from '../render/palette';
import { createBackdrop } from '../render/backdrop';
import { createDragon } from '../render/dragon';
import { createCrowd } from '../render/crowd';
import { createFx } from '../render/fx';
import { createZoom } from '../render/zoom';
import { createHeraldry } from '../render/heraldry';
import { createMusic } from '../audio/music';
import { AudioEngine } from '../audio/engine';
import { createSfx } from '../audio/sfx';
import { UiRoot } from '../ui/mount';
import { createHud } from '../ui/hud';
import { createPanel } from '../ui/panel';
import { createTitle } from '../ui/title';

export const WORLD_PARTICLES = 4096;
export const SCREEN_PARTICLES = 1024;

async function fontsReady(timeoutMs: number): Promise<void> {
  if (!document.fonts) return;
  const load = Promise.all([
    document.fonts.load('700 32px "Cinzel Variable"'),
    document.fonts.load('32px "EB Garamond"'),
    document.fonts.load('italic 32px "EB Garamond"'),
  ]).then(() => undefined);
  await Promise.race([load, new Promise<void>((r) => window.setTimeout(r, timeoutMs))]).catch(() => undefined);
}

export async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const debugOn = params.has('debug');
  const seedParam = Number(params.get('seed'));
  const seed = debugOn && params.has('seed') && Number.isFinite(seedParam) ? seedParam >>> 0 : (Math.random() * 0x100000000) >>> 0;

  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  const uiEl = document.getElementById('ui');
  if (!canvas || !uiEl) throw new Error('index.html must provide #stage and #ui');

  const settings = new Settings();
  setNotation(settings.get('notation'));
  const game = new Game(createInitialState(seed));
  const time = new TimeDirector();
  const camera = new Camera();
  const renderer = new Renderer(canvas, camera, paletteFor(game.state.tier), game.state);
  const atlas = new SpriteAtlas();
  const sprites = registerBuiltinSprites(atlas);
  const particles = {
    world: new ParticleSystem(WORLD_PARTICLES, atlas, 'world'),
    screen: new ParticleSystem(SCREEN_PARTICLES, atlas, 'screen'),
  };
  const audio = new AudioEngine(settings);
  const ui = new UiRoot(uiEl, camera);
  const debug = createDebug(debugOn, ui.regions.debug);

  const scene: Scene = {
    game,
    time,
    settings,
    camera,
    director: null as unknown as CameraDirector,
    renderer,
    palette: paletteFor(game.state.tier),
    particles,
    atlas,
    sprites,
    dragon: NULL_DRAGON,
    crowd: NULL_CROWD,
    fx: NULL_FX,
    backdrop: NULL_BACKDROP,
    zoom: NULL_ZOOM,
    ui,
    audio,
    music: NULL_MUSIC,
    input: null as unknown as Input,
    debug,
  };
  scene.director = new CameraDirector(scene);
  scene.input = new Input(scene, canvas);

  const backdrop = createBackdrop(scene);
  scene.backdrop = backdrop;
  const dragon = createDragon(scene);
  scene.dragon = dragon.view;
  const crowd = createCrowd(scene);
  scene.crowd = crowd.view;
  const fx = createFx(scene);
  scene.fx = fx.api;
  const zoom = createZoom(scene);
  scene.zoom = zoom.api;

  renderer.setLayers([
    backdrop.back,
    dragon.layer,
    crowd.layer,
    createParticleLayer('particles.world', particles.world),
    backdrop.front,
    zoom.layer,
    fx.text,
    fx.post,
    // Real clock: coins to the HUD must arrive on schedule through hit-stop and slow-mo.
    createParticleLayer('particles.screen', particles.screen, 'real'),
  ]);

  createHeraldry(scene);
  createSfx(scene);
  scene.music = createMusic(scene);
  createHud(scene, ui);
  createPanel(scene, ui);
  createTitle(scene, ui);

  const applyMotion = (): void => {
    camera.motionScale = settings.get('reduceMotion') ? 0.25 : 1;
  };
  applyMotion();
  settings.onChange((s, key) => {
    if (key === 'reduceMotion') applyMotion();
    if (key === 'notation') setNotation(s.notation);
  });
  game.on('resync', () => {
    // A new tier (zoom switch, debug jump, load) brings its palette; layers read view.palette.
    scene.palette = paletteFor(game.state.tier);
    scene.director.snap();
    ui.refreshNow();
  });

  const debugFrame = debugOn ? installDebugTools(scene, params, () => loop) : null;

  const loop = new Loop(
    game,
    time,
    (alpha) => {
      if (debugFrame) debugFrame();
      scene.director.update(time.dt);
      camera.update(time.realDt);
      renderer.view.palette = scene.palette;
      renderer.frame(game.state, alpha, time.dt, time.time, time.realDt, time.realTime, time.frame);
      ui.update(time.realDt);
    },
    (stats) => debug.frame(stats),
  );

  await fontsReady(2500);
  ui.refreshNow();
  loop.start();
}
