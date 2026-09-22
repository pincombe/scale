// SFX v1: every game event, voiced. Listens to the game bus (and scene.fx coin landings) and plays
// the synthesized sounds in sfxSounds.ts through a per-sound gain → stereo panner → sfx bus (+ a
// scaled reverb send). A per-category voice limiter caps polyphony and merges hits that land within
// ~40 ms, so thousands of clicks stay pleasant. Also runs the ambience bed (wind + distant birds)
// and exports UI ticks for the HUD.
import type { Scene } from '../app/scene';
import type { Rect, Vec2 } from '../lib/vec';
import { CoinRun, VoiceLimiter, panFor, voiceSize, type VoiceCap } from './sfxMath';
import type { Out } from './synth/kit';
import { startWind } from './synth/ambience';
import * as S from './sfxSounds';

type Cat =
  | 'strike'
  | 'crit'
  | 'voice'
  | 'melee'
  | 'volley'
  | 'arrowHit'
  | 'coin'
  | 'breath'
  | 'swipe'
  | 'stagger'
  | 'death'
  | 'chime'
  | 'fanfare'
  | 'ui'
  | 'bird';

const CAPS: Record<Cat, VoiceCap> = {
  strike: { max: 6, gap: 0.04 },
  crit: { max: 3, gap: 0.06 },
  voice: { max: 2, gap: 0.12 },
  melee: { max: 3, gap: 0.08 },
  volley: { max: 2, gap: 0.2 },
  arrowHit: { max: 3, gap: 0.08 },
  coin: { max: 8, gap: 0.04 },
  breath: { max: 1, gap: 0.3 },
  swipe: { max: 1, gap: 0.3 },
  stagger: { max: 1, gap: 0.3 },
  death: { max: 2, gap: 0.3 },
  chime: { max: 4, gap: 0.06 },
  fanfare: { max: 1, gap: 0.4 },
  ui: { max: 4, gap: 0.03 },
  bird: { max: 2, gap: 1 },
};

/** Typical length per category (s): how long a claimed voice slot stays busy. */
const LEN: Record<Cat, number> = {
  strike: 0.45,
  crit: 0.9,
  voice: 0.6,
  melee: 0.3,
  volley: 1.2,
  arrowHit: 0.3,
  coin: 0.25,
  breath: 1.5,
  swipe: 1.2,
  stagger: 1.2,
  death: 2.2,
  chime: 0.8,
  fanfare: 1.3,
  ui: 0.1,
  bird: 1,
};

/** Reverb send per category (post-trim). */
const SEND: Record<Cat, number> = {
  strike: 0.35,
  crit: 0.7,
  voice: 0.5,
  melee: 0.4,
  volley: 0.4,
  arrowHit: 0.3,
  coin: 0.35,
  breath: 0.45,
  swipe: 0.35,
  stagger: 0.5,
  death: 0.7,
  chime: 0.8,
  fanfare: 0.9,
  ui: 0,
  bird: 1.2,
};

/** How long after the first gesture a still-starting (suspended) context may queue sounds. */
const STARTUP_GRACE_MS = 2000;

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
  private readonly coinRun = new CoinRun(5, 15, 0.6);
  /** A buying spree climbs the purchase chime too. */
  private readonly buyRun = new CoinRun(9, 15, 1.5);
  private readonly v: Vec2 = { x: 0, y: 0 };
  private readonly s: Vec2 = { x: 0, y: 0 };
  private readonly r: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private firstGestureAt = -Infinity;
  private lastYelp = -Infinity;
  private coinsSinceDeath = 0;
  private fallbackTimer = 0;
  private hookedFx: unknown = null;
  private unhookFx: (() => void) | null = null;
  private windStarted = false;
  private nextBird = 0;
  private nextChirp = 0;
  private voices = 0;

  constructor(private readonly scene: Scene) {
    const { game, input, audio } = scene;
    input.onFirstGesture(() => (this.firstGestureAt = performance.now()));
    audio.onReady(() => this.startAmbience());

    game.on('strike', (e) => {
      this.hookCoins();
      const pan = this.panWorld(e.x, e.y);
      if (e.crit) this.play('crit', pan, S.sCrit);
      else this.play('strike', pan, S.sStrike);
      // Hurt yelps: always on a crit, sometimes on a plain hit, never back to back.
      const now = this.now();
      if (e.crit ? now - this.lastYelp > 0.3 : now - this.lastYelp > 0.9 && Math.random() < 0.3) {
        const size = this.size();
        if (this.play('voice', this.panHead(), (o) => S.sYelp(o, size), 0.03)) this.lastYelp = now;
      }
    });

    game.on('armyHit', (e) => {
      if (e.unit === 'footman') {
        const hits = e.hits;
        this.play('melee', this.panWorld(scene.crowd.frontX(), 0), (o) => S.sMelee(o, hits));
      } else {
        const hits = e.hits;
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
      this.play('volley', a, (o) => S.sVolley(o, arrows, flight, 0, b - a));
    });

    game.on('dragonPhase', (e) => {
      const d = game.state.dragon;
      if (e.id !== d.id) return;
      const size = this.size();
      const pan = this.panHead();
      switch (e.phase) {
        case 'enter':
          this.play('voice', pan, (o) => S.sCall(o, size), 0.35);
          this.nextChirp = this.now() + 3;
          break;
        case 'windup': {
          const dur = e.dur;
          if (d.attack === 'breath') this.play('breath', pan, (o) => S.sInhale(o, size, dur));
          else this.play('voice', pan, (o) => S.sGrowl(o, size));
          break;
        }
        case 'breath': {
          const dur = e.dur;
          this.play('breath', pan, (o) => S.sBreath(o, size, dur));
          break;
        }
        case 'swipe': {
          const units = game.state.units;
          const knights = Math.round(1 + Math.sqrt(units.footman + units.archer));
          scene.dragon.bounds(this.r);
          const p = this.panWorld(this.r.x + this.r.w * 0.5, 0);
          this.play('swipe', p, (o) => S.sSwipe(o, size, knights, 0), 0.12);
          break;
        }
        case 'stagger':
          this.play('stagger', pan, S.sStagger, 0.06);
          break;
        case 'dying':
          this.play('death', pan, (o) => S.sDeath(o, size), 0.05);
          break;
        default:
          break;
      }
    });

    game.on('dragonDeath', () => {
      this.hookCoins();
      this.coinsSinceDeath = 0;
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
      if (!this.limiter.canStart('chime', this.now() + 0.004)) return;
      const step = this.buyRun.next(this.now(), Math.random());
      const grand = e.kind === 'upgrade';
      this.play('chime', -0.1, (o) => S.sPurchase(o, grand, step));
    });

    game.on('unlock', () => {
      this.play('chime', 0, S.sUnlock, 0.25);
    });

    game.on('milestone', () => {
      this.play('fanfare', 0, S.sMilestone, 0.15);
    });

    game.on('resync', () => {
      window.clearTimeout(this.fallbackTimer);
      this.limiter.reset();
    });

    // Ambient scheduler: distant birds, and the idle dragon's chirps / snorts.
    window.setInterval(() => this.ambientTick(), 400);

    this.registerDebug();
  }

  // ---- Playback ----

  private now(): number {
    return this.scene.audio.now;
  }

  /** Should sounds be generated right now? (Muted or silent = don't spend CPU.) */
  private canPlay(): boolean {
    const ctx = this.scene.audio.ctx;
    if (!ctx) return false;
    const s = this.scene.settings.all;
    if (s.muted || s.masterVolume * s.sfxVolume < 0.001) return false;
    if (ctx.state === 'running') return true;
    // The very first click creates the context; let it queue while the context is starting.
    return ctx.state === 'suspended' && !document.hidden && performance.now() - this.firstGestureAt < STARTUP_GRACE_MS;
  }

  /**
   * Play `fn` in category `cat` at stereo `pan`, `delay` s from now. Returns false when it was
   * dropped (muted, over the category's polyphony, or merged into a hit < gap ago).
   */
  play(cat: Cat, pan: number, fn: (o: Out) => number, delay = 0): boolean {
    if (!this.canPlay()) return false;
    const audio = this.scene.audio;
    const ctx = audio.ctx!;
    const noise = audio.noiseBuffer();
    if (!noise) return false;
    const t = ctx.currentTime + 0.004 + delay;
    if (!this.limiter.tryStart(cat, t, LEN[cat])) return false;

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
    this.voices++;
    const ms = Math.max(0, end - ctx.currentTime + 0.4) * 1000;
    window.setTimeout(() => {
      this.voices--;
      dry.disconnect();
      panner?.disconnect();
      send?.disconnect();
    }, ms);
    return true;
  }

  ui(kind: 'hover' | 'click' | 'deny'): void {
    const fn = kind === 'hover' ? S.sUiHover : kind === 'click' ? S.sUiClick : S.sUiDeny;
    this.play('ui', 0, fn);
  }

  /** One coin clink climbing the fountain's pentatonic run. */
  private coin(count: number, delay: number): void {
    if (!this.limiter.canStart('coin', this.now() + 0.004 + delay)) return;
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
    if (this.windStarted) return;
    const audio = this.scene.audio;
    if (!audio.ctx) return;
    this.windStarted = true;
    startWind(audio.ctx, audio.sfx, audio.now + 0.05);
    this.nextBird = audio.now + 2 + Math.random() * 3;
    this.nextChirp = audio.now + 2;
    this.hookCoins();
  }

  private ambientTick(): void {
    if (!this.windStarted || !this.canPlay() || this.scene.audio.ctx?.state !== 'running') return;
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

  private registerDebug(): void {
    const dbg = this.scene.debug;
    if (!dbg.enabled) return;
    const sz = (): number => this.size();
    dbg.section('SFX');
    dbg.watch('sfx voices', () => String(this.voices));
    dbg.button('clang', () => this.play('strike', 0, S.sStrike));
    dbg.button('crit', () => this.play('crit', 0, S.sCrit));
    dbg.button('melee ×24', () => this.play('melee', -0.3, (o) => S.sMelee(o, 24)));
    dbg.button('volley', () => this.play('volley', -0.4, (o) => S.sVolley(o, 20, 1.1, 0, 0.7)));
    dbg.button('arrow hits', () => this.play('arrowHit', 0.3, (o) => S.sArrowHits(o, 20)));
    dbg.button('yelp', () => this.play('voice', 0.3, (o) => S.sYelp(o, sz())));
    dbg.button('call', () => this.play('voice', 0.3, (o) => S.sCall(o, sz())));
    dbg.button('inhale', () => this.play('breath', 0.3, (o) => S.sInhale(o, sz(), 1.2)));
    dbg.button('growl', () => this.play('voice', 0.3, (o) => S.sGrowl(o, sz())));
    dbg.button('fire', () => this.play('breath', 0.3, (o) => S.sBreath(o, sz(), 1.5)));
    dbg.button('swipe', () => this.play('swipe', 0.3, (o) => S.sSwipe(o, sz(), 4, 0)));
    dbg.button('stagger', () => this.play('stagger', 0.3, S.sStagger));
    dbg.button('death', () => this.play('death', 0.3, (o) => S.sDeath(o, sz())));
    dbg.button('coins ×12', () => {
      for (let i = 0; i < 12; i++) this.coin(1, i * 0.06);
    });
    dbg.button('purchase', () => this.play('chime', 0, (o) => S.sPurchase(o, false)));
    dbg.button('upgrade', () => this.play('chime', 0, (o) => S.sPurchase(o, true)));
    dbg.button('unlock', () => this.play('chime', 0, S.sUnlock));
    dbg.button('fanfare', () => this.play('fanfare', 0, S.sMilestone));
    dbg.button('bird', () => this.play('bird', 0.5, S.sBird));
    dbg.button('ui hover/click/deny', () => {
      this.ui('hover');
      window.setTimeout(() => this.ui('click'), 250);
      window.setTimeout(() => this.ui('deny'), 500);
    });
  }
}
