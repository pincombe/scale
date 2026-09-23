// SFX v2: every game event, voiced (M2 adds bosses, tremors, the eye, the zoom's beats,
// abilities, lancers, champions, heraldry and Scales; see "M2" below). Listens to the game bus (and scene.fx coin landings) and plays
// the synthesized sounds in sfxSounds.ts through a per-sound gain → stereo panner → sfx bus (+ a
// scaled reverb send). A per-category voice limiter caps polyphony (slots are held for each voice's
// real length) and merges hits that land within ~40 ms, so thousands of clicks stay pleasant and
// the live node count stays bounded. Also runs the ambience bed (wind + distant birds) and exports
// UI ticks for the HUD.
import type { Scene } from '../app/scene';
import type { Rect, Vec2 } from '../lib/vec';
import { sel } from '../core';
import type { ZoomBeat } from '../render/zoom/api';
// The fx's dread curves (pure, DOM-free): the rumble shares the camera sway's timing and strength.
import { HEART_DUB, TREMOR_DELAY, tremorDuration, tremorStrength } from '../render/fx/dread';
import {
  AUTO_CAP,
  CHAMP_CAP,
  CoinRun,
  VoiceLimiter,
  bossTickInterval,
  bossTickLevel,
  panFor,
  untilZoomTime,
  voiceSize,
  type VoiceCap,
} from './sfxMath';
import type { Out } from './synth/kit';
import { rubbleBuffer } from './synth/kit';
import { brownBuffer, grainBuffer } from './synth/grains';
import { startWind } from './synth/ambience';
import * as S from './sfxSounds';

type Cat =
  | 'strike'
  | 'crit'
  | 'ping'
  | 'voice'
  | 'melee'
  | 'volley'
  | 'arrowHit'
  | 'coin'
  | 'breath'
  | 'fire'
  | 'swipe'
  | 'stagger'
  | 'death'
  | 'buy'
  | 'chime'
  | 'fanfare'
  | 'ui'
  | 'bird'
  // ---- M2 ----
  | 'horn'
  | 'boom'
  | 'bossStep'
  | 'tick'
  | 'tremor'
  | 'eye'
  | 'roar'
  | 'cine'
  | 'rush'
  | 'drum'
  | 'auto'
  | 'arrows'
  | 'rain'
  | 'hooves'
  | 'lance'
  | 'herald'
  | 'champ'
  | 'special'
  | 'seal'
  | 'scales'
  | 'heart';

const CAPS: Record<Cat, VoiceCap> = {
  strike: { max: 4, gap: 0.04 },
  crit: { max: 2, gap: 0.06 },
  ping: { max: 2, gap: 0.04 },
  voice: { max: 2, gap: 0.12 },
  melee: { max: 1, gap: 0.08 },
  volley: { max: 1, gap: 0.2 },
  arrowHit: { max: 1, gap: 0.08 },
  coin: { max: 4, gap: 0.04 },
  breath: { max: 1, gap: 0.3 },
  fire: { max: 1, gap: 0.3 },
  swipe: { max: 1, gap: 0.3 },
  stagger: { max: 1, gap: 0.3 },
  death: { max: 2, gap: 0.3 },
  buy: { max: 1, gap: 0.06 },
  chime: { max: 2, gap: 0.06 },
  fanfare: { max: 1, gap: 0.4 },
  ui: { max: 3, gap: 0.03 },
  bird: { max: 1, gap: 1 },
  horn: { max: 2, gap: 0.3 },
  boom: { max: 2, gap: 0.15 },
  bossStep: { max: 1, gap: 0.5 },
  tick: { max: 1, gap: 0.12 },
  tremor: { max: 1, gap: 1.5 },
  eye: { max: 1, gap: 8 },
  roar: { max: 1, gap: 0.5 },
  cine: { max: 4, gap: 0.1 },
  rush: { max: 1, gap: 0.5 },
  drum: { max: 1, gap: 0.5 },
  auto: AUTO_CAP,
  arrows: { max: 1, gap: 0.5 },
  rain: { max: 1, gap: 0.5 },
  hooves: { max: 2, gap: 0.6 },
  lance: { max: 1, gap: 0.25 },
  herald: { max: 1, gap: 1 },
  champ: CHAMP_CAP,
  special: { max: 1, gap: 0.3 },
  seal: { max: 1, gap: 0.12 },
  scales: { max: 1, gap: 0.3 },
  heart: { max: 2, gap: 0.3 },
};

/**
 * Metered length per category (s, worst of the randomized renders). Only the provisional claim:
 * every slot is re-timed to its voice's real end as soon as the voice is built.
 */
const LEN: Record<Cat, number> = {
  strike: 0.95,
  crit: 1.2,
  ping: 1.1,
  voice: 1.2,
  melee: 0.4,
  volley: 1.1,
  arrowHit: 0.35,
  coin: 0.4,
  breath: 1.25,
  fire: 2.0,
  swipe: 1.4,
  stagger: 1.2,
  death: 3.2,
  buy: 1.9,
  chime: 2.0,
  fanfare: 1.4,
  ui: 0.35,
  bird: 1.2,
  horn: 4.0,
  boom: 2.5,
  bossStep: 3.5,
  tick: 0.1,
  tremor: 1.9,
  eye: 5.6,
  roar: 5.5,
  cine: 7,
  rush: 3.2,
  drum: 1.4,
  auto: 0.9,
  arrows: 1.8,
  rain: 1.2,
  hooves: 2,
  lance: 0.5,
  herald: 1.6,
  champ: 0.9,
  special: 1.2,
  seal: 1.7,
  scales: 1.5,
  heart: 0.6,
};

/** Reverb send per category (post-trim). */
const SEND: Record<Cat, number> = {
  strike: 0.35,
  crit: 0.7,
  ping: 0.6,
  voice: 0.5,
  melee: 0.4,
  volley: 0.4,
  arrowHit: 0.3,
  coin: 0.35,
  breath: 0.45,
  fire: 0.45,
  swipe: 0.35,
  stagger: 0.5,
  death: 0.7,
  buy: 0.8,
  chime: 0.8,
  fanfare: 0.9,
  ui: 0,
  bird: 1.2,
  horn: 1.3,
  boom: 0.8,
  bossStep: 0.6,
  tick: 0.15,
  tremor: 0.25,
  eye: 1.2,
  roar: 0.8,
  cine: 0.7,
  rush: 0.4,
  drum: 0.45,
  auto: 0.3,
  arrows: 0.45,
  rain: 0.35,
  hooves: 0.3,
  lance: 0.45,
  herald: 0.9,
  champ: 0.35,
  special: 0.6,
  seal: 0.8,
  scales: 1.0,
  heart: 0,
};

/**
 * Categories that belong to the cinematic and the tier change: a zoom's switch emits a resync
 * mid-cinematic, and these must ride through it (everything else is cut as before).
 */
const THROUGH_ZOOM: Partial<Record<Cat, true>> = {
  horn: true,
  boom: true,
  roar: true,
  cine: true,
  rush: true,
  scales: true,
  chime: true,
  ui: true,
};

/** How long after the first gesture a still-starting (suspended) context may queue sounds. */
const STARTUP_GRACE_MS = 2000;

/** Node factories counted by the debug node meter. */
const NODE_FACTORIES = [
  'createGain',
  'createOscillator',
  'createBiquadFilter',
  'createBufferSource',
  'createStereoPanner',
  'createWaveShaper',
] as const;

/** Categories where a full cap steals the most-decayed voice instead of dropping the new one. */
const STEAL: Partial<Record<Cat, true>> = { strike: true, ping: true, coin: true, buy: true, auto: true };

/** A playing sound: its limiter slot and the handles needed to choke and release it. */
interface Voice {
  cat: Cat;
  slot: number;
  dry: GainNode;
  panner: StereoPannerNode | null;
  send: GainNode | null;
  nodes: number;
  timer: number;
  released: boolean;
}

let live: Sfx | null = null;

/** HUD hooks: soft tick on hovering a button, tock on pressing one, bonk when it can't be afforded. */
export function uiHover(): void {
  live?.ui('hover');
}
export function uiClick(): void {
  live?.ui('click');
}
export function uiDeny(): void {
  live?.ui('deny');
}

export function createSfx(scene: Scene): void {
  live = new Sfx(scene);
}

class Sfx {
  private readonly limiter = new VoiceLimiter<Cat>(CAPS);
  /** Coin fountain: climbs D5 → A6, then cascades again from A5. */
  private readonly coinRun = new CoinRun(5, 13, 0.6, 8);
  /** A buying spree climbs the purchase chime (capped at F#6). */
  private readonly buyRun = new CoinRun(9, 12, 1.5);
  private readonly v: Vec2 = { x: 0, y: 0 };
  private readonly s: Vec2 = { x: 0, y: 0 };
  private readonly r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private firstGestureAt = -Infinity;
  private lastYelp = -Infinity;
  private coinsSinceDeath = 0;
  private fallbackTimer = 0;
  private hookedFx: unknown = null;
  private unhookFx: (() => void) | null = null;
  private ambienceOn = false;
  private stopWind: (() => void) | null = null;
  private windNodes = 0;
  private nextBird = 0;
  private nextChirp = 0;
  /** The wind-up (inhale or growl) and fire voices, so a stagger or death can choke them. */
  private windup: Voice | null = null;
  private fire: Voice | null = null;
  // M2 hooks and schedulers.
  private hookedZoom: unknown = null;
  private unhookZoom: (() => void) | null = null;
  private hookedBackdrop: unknown = null;
  private hookedHeart: unknown = null;
  private unhookHeart: (() => void) | null = null;
  private unhookEye: (() => void) | null = null;
  /** Audio time of the last boss-clock tick (-Infinity while the clock isn't in its last 10 s). */
  private lastTick = -Infinity;
  /** The last scheduled tick (up to ~120 ms ahead): choked if the boss dies or leaves first. */
  private tickVoice: Voice | null = null;
  private tickCount = 0;
  /** Audio time of the zoom's reveal (the world wyrm's eye opening is part of it: no extra growl). */
  private lastReveal = -Infinity;
  /** Tier whose eye already opened once (later looks, like the Mountain wyrm's, are softer). */
  private eyeTier = -1;
  /** The voice holding each limiter slot (for stealing). */
  private readonly slots = new Map<Cat, (Voice | null)[]>();
  // Debug meters.
  private voices = 0;
  private created = 0;
  private liveNodes = 0;
  private peakNodes = 0;
  private readonly catNodes = new Map<Cat, number>();

  /** The zoom's buffers are being (or have been) built ahead (prewarmZoom). */
  private warming = false;

  constructor(private readonly scene: Scene) {
    const { game, input, audio, settings } = scene;
    input.onFirstGesture(() => (this.firstGestureAt = performance.now()));
    audio.onReady(() => {
      this.startAmbience();
      this.prewarmZoom(2.5);
    });
    settings.onChange(() => this.syncWind());

    game.on('strike', (e) => {
      this.hookCoins();
      const pan = this.panWorld(e.x, e.y);
      if (e.auto) {
        // Rally's auto-strikes (~8/s): thinned to ≤ ~4.5/s, quieter and duller than a click, on
        // their own voices so the player's own clicks stay crisp over them. No yelps.
        this.play('auto', pan * 0.7, S.sAutoStrike);
        return;
      }
      if (e.crit) {
        // The clang always takes the strike path; only the extra layers are capped, and even then
        // a lighter ping plays instead of silence.
        this.play('strike', pan, S.sCritClang);
        if (!this.play('crit', pan, S.sCritLayers)) this.play('ping', pan, S.sPing);
      } else {
        this.play('strike', pan, S.sStrike);
      }
      // Hurt yelps: always on a crit, sometimes on a plain hit, never back to back.
      const now = this.now();
      if (e.crit ? now - this.lastYelp > 0.3 : now - this.lastYelp > 0.9 && Math.random() < 0.3) {
        const size = this.size();
        if (this.play('voice', this.panHead(), (o) => S.sYelp(o, size), 0.03)) this.lastYelp = now;
      }
    });

    game.on('armyHit', (e) => {
      const hits = e.hits;
      if (e.ability) {
        this.play('rain', this.panDragon(), S.sArrowRain);
      } else if (e.unit === 'lancer') {
        this.play('lance', this.panDragon(), (o) => S.sLanceCrash(o, hits));
      } else if (e.unit === 'footman') {
        this.play('melee', this.panWorld(scene.crowd.frontX(), 0), (o) => S.sMelee(o, hits));
      } else {
        scene.dragon.bounds(this.r);
        this.play('arrowHit', this.panWorld(this.r.x + this.r.w * 0.5, 0), (o) => S.sArrowHits(o, hits));
      }
    });

    game.on('volley', (e) => {
      scene.crowd.bounds(this.r);
      const a = this.panWorld(this.r.x + this.r.w * 0.3, 0);
      scene.dragon.bounds(this.r);
      const b = this.panWorld(this.r.x + this.r.w * 0.5, 0);
      const { arrows, flight } = e;
      if (e.ability) this.play('arrows', 0, (o) => S.sArrowStorm(o, flight, a - 0.1, b + 0.1));
      else this.play('volley', a, (o) => S.sVolley(o, arrows, flight, 0, b - a));
    });

    game.on('cavalry', (e) => {
      scene.crowd.bounds(this.r);
      const a = this.panWorld(this.r.x + this.r.w * 0.3, 0);
      const b = this.panDragon();
      const { riders, travel } = e;
      this.play('hooves', 0, (o) => S.sGallop(o, riders, travel, a, b));
    });

    game.on('dragonPhase', (e) => {
      const d = game.state.dragon;
      if (e.id !== d.id) return;
      const size = this.size();
      const pan = this.panHead();
      switch (e.phase) {
        case 'enter':
          if (d.boss) {
            const dur = e.dur;
            this.play('bossStep', pan, (o) => S.sBossEntrance(o, size, dur));
          } else this.play('voice', pan, (o) => S.sCall(o, size), 0.35);
          this.nextChirp = this.now() + 3;
          break;
        case 'windup': {
          const dur = e.dur;
          this.windup =
            d.attack === 'breath'
              ? this.play('breath', pan, (o) => S.sInhale(o, size, dur))
              : this.play('voice', pan, (o) => S.sGrowl(o, size));
          break;
        }
        case 'breath': {
          this.windup = null;
          const dur = e.dur;
          this.fire = this.play('fire', pan, (o) => S.sBreath(o, size, dur));
          break;
        }
        case 'swipe': {
          this.windup = null;
          const units = game.state.units;
          const knights = Math.round(1 + Math.sqrt(units.footman + units.archer));
          scene.dragon.bounds(this.r);
          const p = this.panWorld(this.r.x + this.r.w * 0.5, 0);
          this.play('swipe', p, (o) => S.sSwipe(o, size, knights, 0), 0.12);
          break;
        }
        case 'stagger':
          // Weak spot hit mid wind-up: the inhale/growl is choked off.
          if (this.windup) {
            this.choke(this.windup, 0.06);
            this.windup = null;
            this.play('voice', pan, (o) => S.sChoke(o, size), 0.02);
          }
          this.play('stagger', pan, S.sStagger, 0.06);
          break;
        case 'dying':
          this.chokeTick();
          this.choke(this.windup, 0.06);
          this.choke(this.fire, 0.15);
          this.windup = null;
          this.fire = null;
          if (d.boss) this.play('roar', pan * 0.6, (o) => S.sBossDeath(o, size), 0.05);
          else this.play('death', pan, (o) => S.sDeath(o, size), 0.05);
          break;
        case 'leave':
          // An escaping boss (or a dragon leaving for a zoom) swallows its breath as it turns away.
          this.chokeTick();
          this.choke(this.windup, 0.08);
          this.choke(this.fire, 0.2);
          this.windup = null;
          this.fire = null;
          break;
        default:
          this.windup = null;
          break;
      }
    });

    game.on('dragonDeath', () => {
      this.hookCoins();
      this.coinsSinceDeath = 0;
      // The ground answers an ordinary kill: a tremor as strong as the Wyrm Gauge is full.
      const st = game.state;
      if (!st.dragon.boss && !st.wyrm.cleared) {
        const g = sel.gauge(st);
        const strength = tremorStrength(g);
        const dur = tremorDuration(strength);
        this.play('tremor', 0.15, (o) => S.sTremor(o, g, strength, dur), TREMOR_DELAY);
      }
      // Fallback: if no coin reaches the counter soon, play a short rising cascade anyway.
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = window.setTimeout(() => {
        if (this.coinsSinceDeath === 0) for (let i = 0; i < 6; i++) this.coin(1, i * 0.065);
      }, 1600);
    });

    game.on('goldGain', (e) => {
      if (e.source === 'stagger') this.play('chime', this.panHead(), S.sBonus, 0.12);
      else this.coin(1, 0);
    });

    game.on('purchase', (e) => {
      if (e.kind === 'heraldry') {
        this.play('seal', 0, S.sHeraldry);
        return;
      }
      if (this.limiter.inGap('buy', this.now() + 0.004)) return;
      const step = this.buyRun.next(this.now(), Math.random());
      const grand = e.kind === 'upgrade';
      this.play('buy', -0.1, (o) => S.sPurchase(o, grand, step));
    });

    game.on('unlock', (e) => {
      // A champion's arrival has its own flourish (championJoin).
      if (e.kind === 'champion') return;
      this.play('chime', 0, S.sUnlock, 0.25);
    });

    game.on('milestone', () => {
      this.play('fanfare', 0, S.sMilestone, 0.15);
    });

    game.on('resync', () => {
      window.clearTimeout(this.fallbackTimer);
      // A zoom's switch resyncs mid-cinematic: its own sounds ride through; the old world's stop.
      const zooming = game.state.zoom.stage !== null || scene.zoom.active;
      for (const [cat, held] of this.slots) {
        if (zooming && THROUGH_ZOOM[cat]) continue;
        for (const v of held) if (v) this.release(v);
        this.limiter.resetCat(cat);
      }
      if (!zooming) this.limiter.reset();
      this.windup = null;
      this.fire = null;
      this.lastTick = -Infinity;
    });

    this.listenM2();

    // Ambient scheduler: distant birds, and the idle dragon's chirps / snorts.
    window.setInterval(() => this.ambientTick(), 400);
    // Fast scheduler: the boss clock's ticks (scheduled ahead on the audio clock).
    window.setInterval(() => this.clockTick(), 50);

    this.registerDebug();
  }

  // ---- M2 ----

  private listenM2(): void {
    const scene = this.scene;
    const game = scene.game;

    game.on('zoomBegin', () => this.hookScene());

    game.on('bossSummon', () => {
      this.hookScene();
      this.prewarmZoom(0.8);
      this.play('horn', 0.1, S.sBossHorn);
    });

    game.on('bossEscaped', () => {
      const size = this.size();
      this.play('roar', this.panHead(), (o) => S.sBossEscape(o, size));
    });

    game.on('abilityUse', (e) => {
      if (e.id === 'charge') {
        this.play('horn', -0.25, S.sChargeHorn);
        const dur = Math.min(3, Math.max(2, e.dur * 0.25));
        this.play('rush', -0.3, (o) => S.sArmyRush(o, dur, 26), 0.2);
      } else if (e.id === 'rally') {
        this.play('drum', -0.2, S.sRallyRoll);
      }
      // The volley is voiced by its 'volley' event.
    });

    game.on('championJoin', () => {
      this.play('herald', -0.2, S.sChampionJoin, 0.1);
    });

    game.on('championHit', () => {
      // Lands on the footmen's beat: a heavier clang a hair behind it, blended in.
      this.play('champ', this.panWorld(scene.crowd.frontX(), 0), S.sChampionHit, 0.03);
    });

    game.on('championSpecial', () => {
      this.play('special', this.panWorld(scene.crowd.frontX(), 0), S.sChampionSpecial);
    });

    game.on('scalesGain', () => {
      // Paid at the zoom's switch, under the flash and the music's hit: let it glint ~1 s into
      // the pull-back instead, where the air is clear. Outside a zoom (debug), at once.
      const zoom = scene.zoom;
      const zooming = game.state.zoom.stage !== null || zoom.active;
      const bt = zoom.beatTimes;
      const delay = zooming ? untilZoomTime(bt ? bt.pullback + 1 : undefined, zoom.time, 1.2, 0.05, 4) : 0.05;
      this.play('scales', 0, S.sScales, delay);
    });

    this.hookScene();
  }

  /** Subscribe to the zoom's beats and the backdrop's eye (lazily: the services may be swapped or late). */
  private hookScene(): void {
    const zoom = this.scene.zoom;
    if (zoom && zoom !== this.hookedZoom) {
      this.unhookZoom?.();
      this.hookedZoom = zoom;
      this.unhookZoom = zoom.onBeat((b) => this.onBeat(b));
    }
    const fx = this.scene.fx;
    if (fx && fx !== this.hookedHeart && typeof fx.onHeartbeat === 'function') {
      this.unhookHeart?.();
      this.hookedHeart = fx;
      // The red vignette's pulse: a soft lub-dub under the fight, quickening with it.
      this.unhookHeart = fx.onHeartbeat((u) => this.play('heart', 0, (o) => S.sHeartbeat(o, u, HEART_DUB)));
    }
    const bd = this.scene.backdrop;
    if (bd && bd !== this.hookedBackdrop && typeof bd.onEyeOpen === 'function') {
      this.unhookEye?.();
      this.hookedBackdrop = bd;
      this.unhookEye = bd.onEyeOpen(() => this.onEyeOpen());
    }
  }

  /** The zoom cinematic's beats: the diegetic half (the music plays the tonal half). */
  private onBeat(b: ZoomBeat): void {
    const bt = this.scene.zoom.beatTimes;
    const span = (from: ZoomBeat, to: ZoomBeat, dflt: number): number => {
      const d = bt ? bt[to] - bt[from] : dflt;
      return Number.isFinite(d) && d > 0.2 ? Math.min(d, dflt * 2) : dflt;
    };
    switch (b) {
      case 'rally':
        this.play('horn', -0.15, S.sRallyHorns);
        this.play('rush', -0.3, (o) => S.sArmyRush(o, 1.9, 34), 0.15);
        break;
      case 'fusion': {
        // Ends exactly on the flash, measured on the cinematic's own clock (the beat can fire a frame late).
        const z = this.scene.zoom;
        const dur = untilZoomTime(bt?.flash, z.time, span('fusion', 'flash', 1.2), 0.3, 2.4);
        this.play('cine', 0, (o) => S.sFusionRise(o, dur));
        break;
      }
      case 'flash':
        this.play('boom', 0, S.sFlashImpact);
        break;
      case 'pullback': {
        const dur = span('pullback', 'reveal', 4);
        this.play('cine', 0, (o) => S.sWindRush(o, dur));
        break;
      }
      case 'reveal':
        this.lastReveal = this.now();
        this.play('cine', 0.2, S.sRevealRumble);
        break;
      case 'roar':
        this.play('roar', 0.15, S.sColossalRoar);
        break;
      case 'card':
        this.play('cine', 0, S.sCardChime, 0.05);
        break;
      case 'done':
        break;
    }
  }

  /** The eye in the hills (or the Mountain wyrm's) starts to open. */
  private onEyeOpen(): void {
    const now = this.now();
    // Inside the zoom the reveal's rumble and roar speak for the world wyrm.
    if (this.scene.zoom.active || now - this.lastReveal < 6) return;
    // While a boss is up the eye watches the fight: the horn, the footfalls and the clock speak.
    const st = this.scene.game.state;
    if (st.dragon.boss && st.dragon.phase !== 'dying' && st.dragon.phase !== 'leave') return;
    const tier = st.tier;
    // The first look per tier is the event; later ones (the Mountain wyrm's drowsy looks) are a
    // quiet stone grind at the ambience's level, no growl.
    const first = tier !== this.eyeTier;
    this.eyeTier = tier;
    this.play('eye', 0.25, (o) => S.sEyeOpen(o, first ? 1 : 0.35, first));
  }

  /** The boss clock: in its last 10 s a wooden tick, speeding up (scheduled ~120 ms ahead). */
  private clockTick(): void {
    const st = this.scene.game.state;
    const left = sel.bossTimeLeft(st);
    const iv = bossTickInterval(left);
    if (!sel.bossClockRunning(st) || !Number.isFinite(iv) || !this.canPlay()) {
      this.lastTick = -Infinity;
      return;
    }
    const now = this.now();
    const at = this.lastTick === -Infinity ? now + 0.02 : Math.max(now + 0.01, this.lastTick + iv);
    if (at - now > 0.12) return;
    this.lastTick = at;
    const tock = this.tickCount++ % 2 === 1;
    const level = bossTickLevel(left);
    this.tickVoice = this.play('tick', 0.2, (o) => S.sBossTick(o, tock, level), at - now - 0.004);
  }

  /** Silence a boss-clock tick still scheduled ahead (the fight just ended). */
  private chokeTick(): void {
    this.choke(this.tickVoice, 0.005);
    this.tickVoice = null;
    this.lastTick = -Infinity;
  }

  private panDragon(): number {
    this.scene.dragon.bounds(this.r);
    return this.panWorld(this.r.x + this.r.w * 0.5, 0);
  }

  // ---- Playback ----

  private now(): number {
    return this.scene.audio.now;
  }

  /** Is sound audible at all (not muted, volume up)? Silent = don't spend CPU. */
  private audible(): boolean {
    const s = this.scene.settings.all;
    return !s.muted && s.masterVolume * s.sfxVolume >= 0.001;
  }

  /** Should sounds be generated right now? */
  /**
   * The zoom's sounds synthesize their buffers on first use (the armored rush's footfalls, the
   * brown-noise rumble bed, the rubble of the flash and the avalanche): ~45 ms, cold, on the
   * rally's frame. Build them ahead instead, one per quiet moment (each a few ms, well inside a
   * frame), `after` s from now. Idempotent (they are cached per context).
   */
  private prewarmZoom(after: number): void {
    if (this.warming) return;
    const ctx = this.scene.audio.ctx;
    if (!ctx) return;
    this.warming = true;
    const jobs: (() => unknown)[] = [() => grainBuffer(ctx, 'step'), () => brownBuffer(ctx), () => rubbleBuffer(ctx)];
    let i = 0;
    const next = (): void => {
      if (i >= jobs.length) return;
      jobs[i++]!();
      window.setTimeout(next, 350);
    };
    window.setTimeout(next, after * 1000);
  }

  private canPlay(): boolean {
    const ctx = this.scene.audio.ctx;
    if (!ctx || !this.audible()) return false;
    if (ctx.state === 'running') return true;
    // The very first click creates the context; let it queue while the context is starting.
    return ctx.state === 'suspended' && !document.hidden && performance.now() - this.firstGestureAt < STARTUP_GRACE_MS;
  }

  /**
   * Play `fn` in category `cat` at stereo `pan`, `delay` s from now. Returns the voice, or null
   * when it was dropped (muted, over the category's polyphony, or merged into a hit < gap away).
   */
  play(cat: Cat, pan: number, fn: (o: Out) => number, delay = 0): Voice | null {
    if (!this.canPlay()) return null;
    const audio = this.scene.audio;
    const ctx = audio.ctx!;
    const noise = audio.noiseBuffer();
    if (!noise) return null;
    const t = ctx.currentTime + 0.004 + delay;
    const slot = STEAL[cat] ? this.limiter.claimOrSteal(cat, t, LEN[cat]) : this.limiter.claim(cat, t, LEN[cat]);
    if (slot < 0) return null;
    let held = this.slots.get(cat);
    if (!held) this.slots.set(cat, (held = []));
    const prev = held[slot];
    // A stolen slot: fade its old voice out fast (it is the most-decayed one) and free its nodes.
    if (prev && !prev.released) this.choke(prev, 0.03);

    const before = this.created;
    const dry = ctx.createGain();
    let head: AudioNode = dry;
    let panner: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      dry.connect(panner);
      head = panner;
    }
    head.connect(audio.sfx);
    let send: GainNode | null = null;
    if (SEND[cat] > 0) {
      send = ctx.createGain();
      send.gain.value = SEND[cat];
      send.connect(audio.reverbSend);
    }
    let end = t + 0.5;
    try {
      end = fn({ ctx, dest: dry, send, noise, t });
    } catch (err) {
      console.warn('[sfx]', cat, err);
    }
    // Hold the slot for exactly as long as the voice's nodes live.
    this.limiter.setEnd(cat, slot, end + 0.1);
    const nodes = this.created - before;
    this.voices++;
    this.liveNodes += nodes;
    this.catNodes.set(cat, (this.catNodes.get(cat) ?? 0) + nodes);
    if (this.liveNodes > this.peakNodes) this.peakNodes = this.liveNodes;
    const v: Voice = { cat, slot, dry, panner, send, nodes, timer: 0, released: false };
    v.timer = window.setTimeout(() => this.release(v), Math.max(0, end - ctx.currentTime + 0.1) * 1000);
    held[slot] = v;
    return v;
  }

  /** Detach a voice from the buses (its whole subgraph stops being processed). Idempotent. */
  private release(v: Voice): void {
    if (v.released) return;
    v.released = true;
    window.clearTimeout(v.timer);
    this.voices--;
    this.liveNodes -= v.nodes;
    this.catNodes.set(v.cat, (this.catNodes.get(v.cat) ?? 0) - v.nodes);
    v.dry.disconnect();
    v.panner?.disconnect();
    v.send?.disconnect();
    const held = this.slots.get(v.cat);
    if (held && held[v.slot] === v) held[v.slot] = null;
  }

  /** Fade a voice out over `secs` (a choke), free its slot, and release its nodes right after. */
  private choke(v: Voice | null, secs: number): void {
    const ctx = this.scene.audio.ctx;
    if (!v || v.released || !ctx) return;
    const now = ctx.currentTime;
    for (const p of v.send ? [v.dry.gain, v.send.gain] : [v.dry.gain]) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(0, now + secs);
    }
    this.limiter.setEnd(v.cat, v.slot, now + secs);
    window.clearTimeout(v.timer);
    v.timer = window.setTimeout(() => this.release(v), (secs + 0.005) * 1000);
  }

  ui(kind: 'hover' | 'click' | 'deny'): void {
    const fn = kind === 'hover' ? S.sUiHover : kind === 'click' ? S.sUiClick : S.sUiDeny;
    this.play('ui', 0, fn);
  }

  /** One coin clink climbing the fountain's pentatonic run. */
  private coin(count: number, delay: number): void {
    if (this.limiter.inGap('coin', this.now() + 0.004 + delay)) return;
    const step = this.coinRun.next(this.now() + delay, Math.random());
    const amp = Math.min(1.35, 1 + (count - 1) * 0.08);
    this.play('coin', this.panGold(), (o) => S.sCoin(o, step, amp), delay);
  }

  private hookCoins(): void {
    const fx = this.scene.fx;
    if (fx === this.hookedFx) return;
    this.unhookFx?.();
    this.hookedFx = fx;
    this.unhookFx = fx.onCoinLanded((n) => {
      this.coinsSinceDeath += n;
      this.coin(n, 0);
    });
  }

  private startAmbience(): void {
    if (this.ambienceOn) return;
    const audio = this.scene.audio;
    if (!audio.ctx) return;
    this.ambienceOn = true;
    this.instrument(audio.ctx);
    this.nextBird = audio.now + 2 + Math.random() * 3;
    this.nextChirp = audio.now + 2;
    this.hookCoins();
    this.syncWind();
  }

  /** Run the wind bed only while sound is audible (stopped on mute, restarted with a fade-in). */
  private syncWind(): void {
    const audio = this.scene.audio;
    const want = this.ambienceOn && audio.ctx !== null && this.audible();
    if (want && !this.stopWind) {
      const before = this.created;
      this.stopWind = startWind(audio.ctx!, audio.sfx, audio.now + 0.05);
      this.windNodes = this.created - before;
      this.liveNodes += this.windNodes;
    } else if (!want && this.stopWind) {
      this.stopWind();
      this.stopWind = null;
      this.liveNodes -= this.windNodes;
      this.windNodes = 0;
    }
  }

  private ambientTick(): void {
    this.hookScene();
    if (!this.ambienceOn || !this.canPlay() || this.scene.audio.ctx?.state !== 'running') return;
    const now = this.now();
    if (now >= this.nextBird) {
      this.nextBird = now + 4 + Math.random() * 9;
      this.play('bird', (Math.random() * 2 - 1) * 0.8, S.sBird);
    }
    const d = this.scene.game.state.dragon;
    if (d.phase === 'idle' && now >= this.nextChirp) {
      const size = this.size();
      this.nextChirp = now + 2.5 + Math.random() * 4 + size * 3;
      if (Math.random() < 0.6) this.play('voice', this.panHead(), (o) => S.sChirp(o, size));
    }
  }

  // ---- Positions ----

  private size(): number {
    return voiceSize(this.scene.game.state.dragon.size);
  }

  private panWorld(wx: number, wy: number): number {
    const cam = this.scene.camera;
    cam.worldToScreen(wx, wy, this.s);
    return panFor(this.s.x, cam.stageCX, cam.stageW);
  }

  private panHead(): number {
    this.scene.dragon.headPoint(this.v);
    return this.panWorld(this.v.x, this.v.y);
  }

  private panGold(): number {
    const a = this.scene.ui.anchor('gold', this.v);
    if (!a) return -0.3;
    const cam = this.scene.camera;
    return panFor(a.x, cam.stageCX, cam.stageW, 0.4);
  }

  // ---- Debug ----

  /** Debug only: count the nodes each voice creates (for the live-node meter). */
  private instrument(ctx: AudioContext): void {
    if (!this.scene.debug.enabled) return;
    const c = ctx as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of NODE_FACTORIES) {
      const orig = c[name];
      if (typeof orig !== 'function') continue;
      c[name] = (...args: unknown[]) => {
        this.created++;
        return orig.apply(ctx, args);
      };
    }
  }

  private registerDebug(): void {
    const dbg = this.scene.debug;
    if (!dbg.enabled) return;
    const sz = (): number => this.size();
    dbg.section('SFX');
    dbg.watch('sfx voices', () => String(this.voices));
    dbg.watch('sfx nodes (peak)', () => `${this.liveNodes} (${this.peakNodes})`);
    dbg.watch('sfx nodes by kind', () => {
      let s = '';
      for (const [k, n] of this.catNodes) if (n > 0) s += `${k} ${n} `;
      return s;
    });
    dbg.button('clang', () => this.play('strike', 0, S.sStrike));
    dbg.button('crit', () => {
      this.play('strike', 0, S.sCritClang);
      if (!this.play('crit', 0, S.sCritLayers)) this.play('ping', 0, S.sPing);
    });
    dbg.button('melee ×24', () => this.play('melee', -0.3, (o) => S.sMelee(o, 24)));
    dbg.button('volley', () => this.play('volley', -0.4, (o) => S.sVolley(o, 20, 1.1, 0, 0.7)));
    dbg.button('arrow hits', () => this.play('arrowHit', 0.3, (o) => S.sArrowHits(o, 20)));
    dbg.button('yelp', () => this.play('voice', 0.3, (o) => S.sYelp(o, sz())));
    dbg.button('call', () => this.play('voice', 0.3, (o) => S.sCall(o, sz())));
    dbg.button('inhale', () => this.play('breath', 0.3, (o) => S.sInhale(o, sz(), 1.2)));
    dbg.button('growl', () => this.play('voice', 0.3, (o) => S.sGrowl(o, sz())));
    dbg.button('fire', () => this.play('fire', 0.3, (o) => S.sBreath(o, sz(), 1.5)));
    dbg.button('swipe', () => this.play('swipe', 0.3, (o) => S.sSwipe(o, sz(), 4, 0)));
    dbg.button('stagger', () => this.play('stagger', 0.3, S.sStagger));
    dbg.button('death', () => this.play('death', 0.3, (o) => S.sDeath(o, sz())));
    dbg.button('coins ×12', () => {
      for (let i = 0; i < 12; i++) this.coin(1, i * 0.06);
    });
    dbg.button('purchase', () => this.play('buy', 0, (o) => S.sPurchase(o, false)));
    dbg.button('upgrade', () => this.play('buy', 0, (o) => S.sPurchase(o, true)));
    dbg.button('unlock', () => this.play('chime', 0, S.sUnlock));
    dbg.button('fanfare', () => this.play('fanfare', 0, S.sMilestone));
    dbg.button('bird', () => this.play('bird', 0.5, S.sBird));
    dbg.button('ui hover/click/deny', () => {
      this.ui('hover');
      window.setTimeout(() => this.ui('click'), 250);
      window.setTimeout(() => this.ui('deny'), 500);
    });
    dbg.button('reset node peak', () => (this.peakNodes = this.liveNodes));

    dbg.section('SFX (M2)');
    const later = (secs: number, fn: () => void): void => void window.setTimeout(fn, secs * 1000);
    dbg.button('boss horn', () => this.play('horn', 0.1, S.sBossHorn));
    dbg.button('boss entrance', () => this.play('bossStep', 0.3, (o) => S.sBossEntrance(o, 1, 1.6)));
    dbg.button('boss clock (last 10 s)', () => {
      let left = 10;
      let n = 0;
      const step = (): void => {
        const iv = bossTickInterval(left);
        if (!Number.isFinite(iv)) return;
        const tock = n++ % 2 === 1;
        const lvl = bossTickLevel(left);
        this.play('tick', 0.2, (o) => S.sBossTick(o, tock, lvl));
        left -= iv;
        later(iv, step);
      };
      step();
    });
    dbg.button('boss escape', () => this.play('roar', 0.3, (o) => S.sBossEscape(o, 1)));
    dbg.button('boss death', () => this.play('roar', 0.2, (o) => S.sBossDeath(o, 1)));
    for (const g of [0.1, 0.5, 1]) {
      const st = tremorStrength(g);
      dbg.button(`tremor ${g * 100}%`, () => this.play('tremor', 0.15, (o) => S.sTremor(o, g, st, tremorDuration(st))));
    }
    dbg.button('heartbeat calm/urgent', () => {
      for (let i = 0; i < 4; i++) later(i * 1.15, () => this.play('heart', 0, (o) => S.sHeartbeat(o, 0, HEART_DUB)));
      for (let i = 0; i < 8; i++) later(4.6 + i * 0.5, () => this.play('heart', 0, (o) => S.sHeartbeat(o, 1, HEART_DUB)));
    });
    dbg.button('eye opens', () => this.play('eye', 0.25, (o) => S.sEyeOpen(o, 1)));
    dbg.button('zoom beats (nominal)', () => {
      const beats: [ZoomBeat, number][] = [
        ['rally', 0],
        ['fusion', 1.0],
        ['flash', 2.2],
        ['pullback', 2.4],
        ['reveal', 6.4],
        ['roar', 7.0],
        ['card', 7.6],
        ['done', 9.5],
      ];
      for (const [b, at] of beats) later(at, () => this.onBeat(b));
    });
    dbg.button('zoom: flash', () => this.onBeat('flash'));
    dbg.button('zoom: roar', () => this.onBeat('roar'));
    dbg.button('Charge!', () => {
      this.play('horn', -0.25, S.sChargeHorn);
      this.play('rush', -0.3, (o) => S.sArmyRush(o, 2.5, 26), 0.2);
    });
    dbg.button('Rally (roll + 3 s of auto-strikes)', () => {
      this.play('drum', -0.2, S.sRallyRoll);
      for (let i = 0; i < 24; i++) later(i / 8, () => this.play('auto', (Math.random() - 0.5) * 0.4, S.sAutoStrike));
    });
    dbg.button('Dragonbane Volley', () => {
      this.play('arrows', 0, (o) => S.sArrowStorm(o, 1.1, -0.5, 0.5));
      later(1.1, () => this.play('rain', 0.35, S.sArrowRain));
    });
    dbg.button('lancers ×16 (gallop + crash)', () => {
      this.play('hooves', 0, (o) => S.sGallop(o, 16, 1.2, -0.4, 0.35));
      later(1.2, () => this.play('lance', 0.35, (o) => S.sLanceCrash(o, 16)));
    });
    dbg.button('lancer ×1', () => {
      this.play('hooves', 0, (o) => S.sGallop(o, 1, 1.2, -0.4, 0.35));
      later(1.2, () => this.play('lance', 0.35, (o) => S.sLanceCrash(o, 1)));
    });
    dbg.button('champion joins', () => this.play('herald', -0.2, S.sChampionJoin));
    dbg.button('champion hit (+ melee)', () => {
      this.play('melee', -0.3, (o) => S.sMelee(o, 12));
      this.play('champ', -0.3, S.sChampionHit, 0.03);
    });
    dbg.button('champion special', () => this.play('special', -0.2, S.sChampionSpecial));
    dbg.button('heraldry seal', () => this.play('seal', 0, S.sHeraldry));
    dbg.button('Scales shimmer', () => this.play('scales', 0, S.sScales));
  }
}
