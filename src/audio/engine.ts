// AudioEngine: the WebAudio graph every sound plugs into. Created on the first user gesture.
//
//   sfx bus ----\
//   music bus ---+--> master (volume, mute) --> limiter --> destination
//   reverbSend --> convolver (generated IR) --> reverbReturn --/
//
// Sound modules connect sources to `sfx` or `music`, and optionally also to `reverbSend`.
// Volumes and mute follow Settings. The context is suspended while the tab is hidden.
import type { Settings } from '../app/settings';

export class AudioEngine {
  ctx: AudioContext | null = null;
  /** Buses (valid once `ready`). */
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  /** Send into the shared hall reverb. */
  reverbSend!: GainNode;
  limiter!: DynamicsCompressorNode;

  private reverbReturn!: GainNode;
  private noise: AudioBuffer | null = null;
  private readyFns: (() => void)[] = [];
  private wantRunning = false;

  constructor(private readonly settings: Settings) {
    settings.onChange(() => this.applySettings(false));
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend().catch(() => undefined);
      else if (this.wantRunning) void this.ctx.resume().catch(() => undefined);
    });
  }

  /** True once the context exists and is running (sounds will be heard). */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Current audio clock (s), for scheduling. */
  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Create/resume the context. Call from inside a user gesture handler (input does this). */
  unlock(): void {
    this.wantRunning = true;
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
      this.ctx.addEventListener('statechange', () => this.flushReady());
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.flushReady(), () => undefined);
    this.flushReady();
  }

  /** Run fn once audio is running (immediately if it already is). */
  onReady(fn: () => void): void {
    if (this.ready) fn();
    else this.readyFns.push(fn);
  }

  /** A shared 1 s mono white-noise buffer (for hits, whooshes, breath). */
  noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const rate = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, rate, rate);
      const d = buf.getChannelData(0);
      let s = 0x1234567;
      for (let i = 0; i < d.length; i++) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
      }
      this.noise = buf;
    }
    return this.noise;
  }

  private flushReady(): void {
    if (!this.ready || this.readyFns.length === 0) return;
    const fns = this.readyFns;
    this.readyFns = [];
    for (const fn of fns) fn();
  }

  private build(ctx: AudioContext): void {
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.15;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.connect(this.limiter);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 2.6, 3.2);
    this.reverbSend = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.5;
    this.reverbSend.connect(reverb);
    reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);

    this.applySettings(true);
  }

  private applySettings(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.settings.all;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      if (immediate) p.value = v;
      else {
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(v, t + 0.08);
      }
    };
    set(this.master.gain, s.muted ? 0 : s.masterVolume);
    set(this.sfx.gain, s.sfxVolume);
    set(this.music.gain, s.musicVolume);
  }
}

/**
 * A stereo hall impulse response: pre-delay, a few early reflections, then decorrelated noise with
 * a power-law decay that also darkens over time (a one-pole low-pass closing down), like air
 * absorbing the highs of a stone hall.
 */
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const preDelay = Math.floor(0.012 * rate);
  const taps = [0.013, 0.019, 0.027, 0.037, 0.049, 0.061];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let s = ch === 0 ? 0x9e3779b9 : 0x7f4a7c15;
    let lp = 0;
    for (let i = preDelay; i < len; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const white = ((s >>> 0) / 4294967296) * 2 - 1;
      const t = (i - preDelay) / (len - preDelay);
      lp += (white - lp) * (0.9 - 0.75 * t);
      d[i] = lp * Math.pow(1 - t, decay);
    }
    for (let k = 0; k < taps.length; k++) {
      const at = Math.floor((taps[k]! + (ch ? 0.0023 : 0)) * rate);
      if (at < len) d[at] = (d[at] ?? 0) + (k % 2 ? -1 : 1) * (0.7 - k * 0.08);
    }
  }
  return buf;
}
