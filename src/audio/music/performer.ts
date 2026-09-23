// The performer: turns the conductor's events into WebAudio voices on a persistent mix graph.
//
//   voices -> layer bus (level, [low-pass], pan) --+--> dry sum -> duck -> SFX carve (-7 dB @ 2.2 kHz) -> heart dip -> fader -> out
//                                                  +--> send ---> wet sum -> duck -> fader -> wet (reverb send)
//
// Plucks and drums are pre-rendered buffers (dsp.ts; 2 nodes a note). Horns, the flute, the
// drone, the choir and the shimmer are oscillator voices whose envelopes are setTargetAtTime
// chains only, so any voice can be faded mid-flight (cancelScheduledValues + a new target) without
// clicks in every browser (Firefox has no cancelAndHoldAtTime). Every voice is tracked until its
// sources stop, then its tail is disconnected: the node count stays flat over any session length.
import { BUF_RATE, ROLL_END, renderDoum, renderHarp, renderLute, renderRoll, renderSub, renderTak, renderTimpani } from './dsp';
import { F_ACCENT, F_BIG, F_DAMP, F_LEGATO, F_PHRASE_END, F_STAB, F_SWELL, type SEv } from './score';
import { midiHz } from './theory';
import type { Performer, Vowel } from './conductor';

export type Layer = 'lute' | 'harp' | 'flute' | 'horn' | 'echo' | 'perc' | 'drone' | 'choir' | 'shimmer';

/** Per-layer mix: level, pan, reverb send, optional low-pass (keeps the SFX band light). */
export const MIX: Record<Layer, { level: number; pan: number; send: number; lp: number }> = {
  lute: { level: 1, pan: -0.28, send: 0.32, lp: 1800 },
  harp: { level: 1, pan: 0.3, send: 0.5, lp: 3000 },
  flute: { level: 1, pan: 0.12, send: 0.42, lp: 3000 },
  horn: { level: 1, pan: -0.08, send: 0.5, lp: 0 },
  echo: { level: 1, pan: 0.45, send: 1.1, lp: 1100 },
  perc: { level: 1, pan: -0.04, send: 0.26, lp: 0 },
  drone: { level: 1, pan: 0, send: 0.25, lp: 0 },
  choir: { level: 1, pan: 0, send: 0.75, lp: 0 },
  shimmer: { level: 1, pan: 0, send: 0.9, lp: 0 },
};

/** Instrument calibration: peak gain at velocity 1 (tuned with musicMeasure.ts). */
export const LEVEL = {
  lute: 0.36,
  harp: 0.34,
  flute: 0.085,
  horn: 0.06,
  doum: 0.38,
  tak: 0.26,
  timp: 0.4,
  roll: 0.34,
  sub: 0.42,
  drone: 0.0175,
  choir: 0.4,
  shimmer: 0.012,
};

const CARVE_DB = -7;
/** How far the low shelf dips under each boss heartbeat (dB). */
const HEART_DIP_DB = -7;
const MAX_VOICES = 80;

// ---- Buffer bank (renders are pure data, cached for the page; AudioBuffers per context) ----

const LUTE_ROOTS = [43, 48, 53, 58, 63, 68, 73];
const HARP_ROOTS = [43, 48, 53, 58, 63, 68, 73, 78, 83, 88, 93, 98];
const RAW = new Map<string, Float32Array>();

function nearestRoot(roots: readonly number[], m: number): number {
  let best = roots[0]!;
  for (const r of roots) if (Math.abs(r - m) < Math.abs(best - m)) best = r;
  return best;
}

function render(key: string): Float32Array {
  const [kind, n] = key.split(':');
  const m = Number(n);
  switch (kind) {
    case 'lute':
      return renderLute(midiHz(m), 0x1f00 + m);
    case 'harp':
      return renderHarp(midiHz(m), 0x4a00 + m);
    case 'timp':
      return renderTimpani();
    case 'roll':
      return renderRoll(raw('timp'));
    case 'doum':
      return renderDoum();
    case 'tak':
      return renderTak();
    default:
      return renderSub();
  }
}

function raw(key: string): Float32Array {
  let r = RAW.get(key);
  if (!r) RAW.set(key, (r = render(key)));
  return r;
}

/** Everything the score can ask for, in the order it is first needed (the intro's harp first). */
export const BANK_KEYS: readonly string[] = [
  ...[58, 63, 68, 73, 78, 53, 48, 43, 83, 88, 93, 98].map((m) => `harp:${m}`),
  ...LUTE_ROOTS.map((m) => `lute:${m}`),
  'doum',
  'tak',
  'timp',
  'roll',
  'sub',
];

// ---- Waves and vowels ----

function waveOf(ctx: BaseAudioContext, amps: readonly number[]): PeriodicWave {
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i]!;
  return ctx.createPeriodicWave(real, imag);
}

const series = (n: number, p: number): number[] => Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, p));

/** Formants (Hz) and gains for the choir's vowels (F3 kept low: it sits in the SFX band). */
const VOWELS: Record<Vowel, { f: readonly number[]; g: readonly number[] }> = {
  oo: { f: [310, 870, 2250], g: [1, 0.3, 0.05] },
  oh: { f: [460, 820, 2800], g: [1, 0.45, 0.06] },
  ah: { f: [720, 1100, 2500], g: [1, 0.62, 0.09] },
};

// ---- Voices ----

interface Voice {
  /** The node connected to a layer bus (disconnected at cleanup). */
  tail: AudioNode;
  /** The gain that fades the whole voice. */
  env: AudioParam;
  srcs: AudioScheduledSourceNode[];
  /** Audio time after which every source has stopped. */
  end: number;
  nodes: number;
}

interface FluteVoice extends Voice {
  osc: OscillatorNode;
  tone: GainNode;
  breath: GainNode;
  bp: BiquadFilterNode;
  vib: GainNode;
  /** End of the last note given to it; flags of that note. */
  until: number;
  last: number;
}

interface ChoirVoice extends Voice {
  oscs: OscillatorNode[];
  bps: BiquadFilterNode[];
  fgs: GainNode[];
  out: GainNode;
}

interface Opts {
  /** Offline render: never disconnect (the graph must survive until rendering). */
  offline?: boolean;
  /** Measurement: solo these layers (the others stay silent). */
  only?: readonly Layer[];
}

export class WebPerformer implements Performer {
  /** Live voices and the nodes they hold (debug meters). */
  voices = 0;
  nodes = 0;
  peakNodes = 0;
  dropped = 0;
  /** Nodes of the persistent graph. */
  readonly graphNodes: number;

  private readonly ctx: BaseAudioContext;
  private readonly bus = {} as Record<Layer, GainNode>;
  private readonly live: Voice[] = [];
  private readonly bufs = new Map<string, AudioBuffer>();
  private readonly waves: { horn: PeriodicWave; flute: PeriodicWave; choir: PeriodicWave };
  private readonly faderD: GainNode;
  private readonly faderW: GainNode;
  private readonly duckD: GainNode;
  private readonly duckW: GainNode;
  private readonly carve: BiquadFilterNode;
  /** A low shelf that dips under each boss heartbeat (the SFX's lub lives below 190 Hz). */
  private readonly lows: BiquadFilterNode;
  private fv = { a: 0, b: 0, t0: 0, t1: 0 };
  private fl: FluteVoice | null = null;
  private dr: Voice | null = null;
  private ch: ChoirVoice | null = null;
  private sh: Voice | null = null;
  private audible = true;
  private wantDrone: { midis: readonly number[]; level: number } | null = null;

  constructor(
    ctx: BaseAudioContext,
    dry: AudioNode,
    wet: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly opts: Opts = {},
  ) {
    this.ctx = ctx;
    let n = 0;
    const g = (v: number): GainNode => {
      n++;
      const x = ctx.createGain();
      x.gain.value = v;
      return x;
    };
    const drySum = g(1);
    const wetSum = g(1);
    this.duckD = g(1);
    this.duckW = g(1);
    this.faderD = g(0);
    this.faderW = g(0);
    this.carve = ctx.createBiquadFilter();
    n++;
    this.carve.type = 'peaking';
    this.carve.frequency.value = 2200;
    this.carve.Q.value = 0.7;
    this.carve.gain.value = CARVE_DB;
    this.lows = ctx.createBiquadFilter();
    n++;
    this.lows.type = 'lowshelf';
    this.lows.frequency.value = 200;
    this.lows.gain.value = 0;
    drySum.connect(this.duckD);
    this.duckD.connect(this.carve);
    this.carve.connect(this.lows);
    this.lows.connect(this.faderD);
    this.faderD.connect(dry);
    wetSum.connect(this.duckW);
    this.duckW.connect(this.faderW);
    this.faderW.connect(wet);
    const panners = typeof ctx.createStereoPanner === 'function';
    for (const name of Object.keys(MIX) as Layer[]) {
      const m = MIX[name];
      const input = g(opts.only && !opts.only.includes(name) ? 0 : m.level);
      let head: AudioNode = input;
      if (m.lp > 0) {
        const lp = ctx.createBiquadFilter();
        n++;
        lp.type = 'lowpass';
        lp.frequency.value = m.lp;
        lp.Q.value = 0.6;
        head.connect(lp);
        head = lp;
      }
      if (panners && m.pan !== 0) {
        const p = ctx.createStereoPanner();
        n++;
        p.pan.value = m.pan;
        head.connect(p);
        head = p;
      }
      head.connect(drySum);
      const send = g(m.send);
      head.connect(send);
      send.connect(wetSum);
      this.bus[name] = input;
    }
    this.graphNodes = n;
    this.waves = {
      horn: waveOf(ctx, series(24, 1.25)),
      flute: waveOf(ctx, [1, 0.14, 0.05, 0.022, 0.01]),
      choir: waveOf(ctx, series(28, 1.35)),
    };
  }

  // ---- Mix controls ----

  private faderAt(t: number): number {
    const f = this.fv;
    if (t <= f.t0) return f.a;
    if (t >= f.t1) return f.b;
    return f.a + ((f.b - f.a) * (t - f.t0)) / (f.t1 - f.t0);
  }

  fader(t: number, level: number, dur: number): void {
    const v = this.faderAt(t);
    const t1 = t + Math.max(0.005, dur);
    for (const p of [this.faderD.gain, this.faderW.gain]) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
      p.linearRampToValueAtTime(level, t1);
    }
    this.fv = { a: v, b: level, t0: t, t1 };
  }

  openMid(t: number, open: boolean): void {
    this.carve.gain.setTargetAtTime(open ? -1 : CARVE_DB, t, 0.4);
  }

  /** Dip the music by `db` for `seconds` (a big SFX moment). */
  duck(t: number, db: number, seconds: number): void {
    const to = Math.pow(10, Math.min(0, db) / 20);
    for (const p of [this.duckD.gain, this.duckW.gain]) {
      p.setTargetAtTime(to, t, 0.02);
      p.setTargetAtTime(1, t + seconds, 0.25);
    }
  }

  /** A boss heartbeat lands at `t`: the music's low end (drone, bass horns) steps aside for ~0.2 s. */
  heartDip(t: number): void {
    const g = this.lows.gain;
    g.setTargetAtTime(HEART_DIP_DB, t, 0.012);
    g.setTargetAtTime(0, t + 0.17, 0.08);
  }

  /** Muted or at zero volume: stop making voices (the conductor keeps time), and come back cleanly. */
  setAudible(on: boolean, now: number): void {
    if (on === this.audible) return;
    this.audible = on;
    if (!on) {
      const keep = this.wantDrone;
      this.releaseAll(now, 0.15);
      this.wantDrone = keep;
    } else if (this.wantDrone) {
      this.dr = this.makeDrone(now + 0.02, this.wantDrone.midis, this.wantDrone.level, 1.5);
    }
  }

  // ---- Voice bookkeeping ----

  private track<V extends Voice>(v: V): V {
    this.live.push(v);
    this.voices = this.live.length;
    this.nodes += v.nodes;
    if (this.nodes > this.peakNodes) this.peakNodes = this.nodes;
    return v;
  }

  private static stopAt(v: Voice, t: number): void {
    for (const s of v.srcs) {
      try {
        s.stop(t);
      } catch {
        /* an older engine refusing a second stop(): the first one stands */
      }
    }
    if (t < v.end) v.end = t;
  }

  /** Fade one voice out over ~`fade` s from `t`, then stop its sources. */
  private fadeVoice(v: Voice, t: number, fade: number): void {
    if (v.end <= t) return;
    v.env.cancelScheduledValues(t);
    v.env.setTargetAtTime(0, t, Math.max(0.004, fade / 3));
    WebPerformer.stopAt(v, t + fade * 1.6 + 0.03);
  }

  releaseAll(t: number, fade: number): void {
    for (const v of this.live) this.fadeVoice(v, t, fade);
    this.fl = null;
    this.dr = null;
    this.ch = null;
    this.sh = null;
    this.wantDrone = null;
  }

  /** Free finished voices (call every scheduler tick). */
  cleanup(now: number): void {
    const flute = this.fl;
    if (flute && now > flute.until + 0.5) {
      // A phrase that never got its last note (a switch cut it): let it go.
      this.fadeVoice(flute, now, 0.1);
      this.fl = null;
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i]!;
      if (v.end < now - 0.05) {
        // Offline, the graph must survive until it renders: only the bookkeeping lets go.
        if (!this.opts.offline) v.tail.disconnect();
        this.nodes -= v.nodes;
        this.live[i] = this.live[this.live.length - 1]!;
        this.live.pop();
      }
    }
    this.voices = this.live.length;
  }

  // ---- Events ----

  play(ev: SEv, t: number, dur: number, gain: number): void {
    if (!this.audible) return;
    if (this.live.length >= MAX_VOICES && ev.role !== 'melody') {
      this.dropped++;
      return;
    }
    switch (ev.inst) {
      case 'lute':
      case 'harp':
        this.pluck(ev, t, dur, gain);
        break;
      case 'flute':
        this.flute(ev, t, dur, gain);
        break;
      case 'horn':
      case 'echo':
        this.horn(ev, t, dur, gain);
        break;
      default:
        this.hit(ev, t, dur, gain);
    }
  }

  private buffer(key: string): AudioBuffer {
    let b = this.bufs.get(key);
    if (!b) {
      const r = raw(key);
      b = this.ctx.createBuffer(1, r.length, BUF_RATE);
      b.getChannelData(0).set(r);
      this.bufs.set(key, b);
      // Live, the AudioBuffer is the only copy we need (offline renders reuse the raw cache).
      // The roll is built from the timpani stroke, so that one stays until the roll exists.
      if (!this.opts.offline && (key !== 'timp' || this.bufs.has('roll'))) RAW.delete(key);
      if (!this.opts.offline && key === 'roll' && this.bufs.has('timp')) RAW.delete('timp');
    }
    return b;
  }

  /** Build the next missing bank buffer (call it now and then; ~0.2-5 ms each). False when done. */
  prefetchNext(): boolean {
    for (const k of BANK_KEYS) {
      if (!this.bufs.has(k)) {
        this.buffer(k);
        return true;
      }
    }
    return false;
  }

  private oneShot(key: string, layer: Layer, t: number, rate: number, level: number, offset = 0, until = Infinity): Voice {
    const c = this.ctx;
    const buf = this.buffer(key);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = level;
    src.connect(g);
    g.connect(this.bus[layer]);
    src.start(t, offset);
    const end = Math.min(t + (buf.duration - offset) / rate, until);
    src.stop(end);
    return this.track({ tail: g, env: g.gain, srcs: [src], end, nodes: 2 });
  }

  private pluck(ev: SEv, t: number, dur: number, gain: number): void {
    const harp = ev.inst === 'harp';
    const root = nearestRoot(harp ? HARP_ROOTS : LUTE_ROOTS, ev.midi);
    const rate = Math.pow(2, (ev.midi - root) / 12);
    const level = ev.vel * gain * (harp ? LEVEL.harp : LEVEL.lute) * (ev.flags & F_ACCENT ? 1.1 : 1);
    const v = this.oneShot(`${ev.inst}:${root}`, harp ? 'harp' : 'lute', t, rate, level, 0, ev.flags & F_DAMP ? t + dur + 0.2 : Infinity);
    if (ev.flags & F_DAMP) v.env.setTargetAtTime(0, t + dur, 0.03);
  }

  private hit(ev: SEv, t: number, dur: number, gain: number): void {
    const inst = ev.inst as 'doum' | 'tak' | 'timp' | 'roll' | 'sub';
    const pitched = inst === 'timp' || inst === 'roll';
    const rate = pitched ? Math.pow(2, (ev.midi - 38) / 12) : 1;
    const level = ev.vel * gain * LEVEL[inst];
    if (inst !== 'roll') {
      const damp = (ev.flags & F_DAMP) !== 0;
      const v = this.oneShot(inst, 'perc', t, rate, level, 0, damp ? t + dur + 0.35 : Infinity);
      // A damped stroke: the hand on the head at the end of its length.
      if (damp) v.env.setTargetAtTime(0, t + dur, 0.05);
      return;
    }
    // A roll is a crescendo that ends at t + dur: start inside the rendered roll so its peak lands there.
    const span = Math.min(ROLL_END, dur * rate);
    const v = this.oneShot('roll', 'perc', t + dur - span / rate, rate, level, ROLL_END - span, t + dur + 0.5);
    v.env.setTargetAtTime(0, t + dur, 0.07);
  }

  private flute(ev: SEv, t: number, dur: number, gain: number): void {
    const hz = midiHz(ev.midi);
    const amp = ev.vel * gain * LEVEL.flute;
    let v = this.fl;
    let tongued = true;
    let fresh = false;
    if (!v || t > v.until + 0.08) {
      if (v) this.fadeVoice(v, t, 0.06);
      v = this.fl = this.makeFlute(t, hz);
      fresh = true;
    } else tongued = !(v.last & F_LEGATO);
    const p = v.osc.frequency;
    if (tongued) p.setValueAtTime(hz, t);
    else p.setTargetAtTime(hz, t - 0.008, 0.012);
    v.bp.frequency.setTargetAtTime(hz * 1.01, t - 0.008, 0.01);
    if (tongued && !fresh) v.tone.gain.setTargetAtTime(amp * 0.22, t - 0.03, 0.007);
    v.tone.gain.setTargetAtTime(amp, t, tongued ? 0.016 : 0.04);
    if (tongued) {
      v.breath.gain.setTargetAtTime(amp * 2.4, t, 0.004);
      v.breath.gain.setTargetAtTime(amp * 0.5, t + 0.03, 0.05);
    }
    v.vib.gain.setTargetAtTime(0, t, 0.03);
    if (dur > 0.45) v.vib.gain.setTargetAtTime(10, t + 0.22, 0.22);
    const end = t + dur;
    v.until = end;
    v.last = ev.flags;
    if (ev.flags & F_PHRASE_END) {
      v.tone.gain.setTargetAtTime(0, end - 0.02, 0.05);
      v.breath.gain.setTargetAtTime(0, end - 0.02, 0.04);
      WebPerformer.stopAt(v, end + 0.4);
      this.fl = null;
    }
  }

  private makeFlute(t: number, hz: number): FluteVoice {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(this.bus.flute);
    const tone = c.createGain();
    tone.gain.value = 0;
    tone.gain.setValueAtTime(0, t);
    tone.connect(out);
    const osc = c.createOscillator();
    osc.setPeriodicWave(this.waves.flute);
    osc.frequency.value = hz;
    osc.connect(tone);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.1;
    const vib = c.createGain();
    vib.gain.value = 0;
    lfo.connect(vib);
    vib.connect(osc.detune);
    const nz = c.createBufferSource();
    nz.buffer = this.noise;
    nz.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = hz;
    bp.Q.value = 2.5;
    const breath = c.createGain();
    breath.gain.value = 0;
    nz.connect(bp);
    bp.connect(breath);
    breath.connect(out);
    osc.start(t);
    lfo.start(t);
    nz.start(t, Math.random() * 0.8);
    return this.track<FluteVoice>({ tail: out, env: out.gain, srcs: [osc, lfo, nz], end: Infinity, nodes: 8, osc, tone, breath, bp, vib, until: t, last: 0 });
  }

  private horn(ev: SEv, t: number, dur: number, gain: number): void {
    const c = this.ctx;
    const far = ev.inst === 'echo';
    const stab = (ev.flags & F_STAB) !== 0;
    const swell = (ev.flags & F_SWELL) !== 0;
    const big = (ev.flags & F_BIG) !== 0;
    const hz = midiHz(ev.midi);
    const amp = ev.vel * gain * LEVEL.horn * (big ? 1.25 : 1);
    const env = c.createGain();
    env.gain.value = 0;
    env.connect(this.bus[far ? 'echo' : 'horn']);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.connect(env);
    const ta = stab ? 0.004 : swell ? 0.22 : far ? 0.05 : 0.026;
    const rel = stab ? 0.05 : swell ? 0.28 : 0.11;
    env.gain.setValueAtTime(0, t);
    env.gain.setTargetAtTime(amp, t, ta);
    env.gain.setTargetAtTime(amp * (stab ? 0.25 : 0.78), t + ta * 3, stab ? 0.06 : 0.3);
    env.gain.setTargetAtTime(0, t + dur, rel);
    // Brightness follows loudness (the horn's defining trait); capped below the SFX band.
    const cap = far ? 900 : big ? 2600 : 1700;
    const bright = 1.2 + (big ? 6 : stab ? 5 : 3.6) * ev.vel;
    const f0 = Math.min(hz * 1.2, cap);
    lp.frequency.setValueAtTime(f0, t);
    lp.frequency.setTargetAtTime(Math.min(hz * (1 + bright), cap), t, ta * 1.3);
    lp.frequency.setTargetAtTime(Math.min(hz * (1 + bright * 0.55), cap), t + ta * 3, 0.3);
    lp.frequency.setTargetAtTime(f0, t + dur, rel);
    const n = stab || swell ? 2 : 3;
    const stop = t + dur + rel * 6;
    const srcs: AudioScheduledSourceNode[] = [];
    let vib: GainNode | null = null;
    if (dur > 0.9 && !stab) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 4.6 + Math.random() * 0.5;
      vib = c.createGain();
      vib.gain.value = 0;
      vib.gain.setValueAtTime(0, t);
      vib.gain.setTargetAtTime(7, t + 0.35, 0.3);
      lfo.connect(vib);
      lfo.start(t);
      lfo.stop(stop);
      srcs.push(lfo);
    }
    const scoop = stab ? 0 : ev.flags & F_LEGATO ? 12 : 26;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator();
      o.setPeriodicWave(this.waves.horn);
      o.frequency.value = hz;
      const d = (i === 0 ? -6 : i === 1 ? 5 : 0) + (Math.random() * 4 - 2);
      o.detune.setValueAtTime(d - scoop, t);
      o.detune.setTargetAtTime(d, t, 0.02);
      if (vib) vib.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(stop);
      srcs.push(o);
    }
    this.track({ tail: env, env: env.gain, srcs, end: stop, nodes: 2 + n + (vib ? 2 : 0) });
  }

  // ---- Sustained voices ----

  drone(t: number, midis: readonly number[] | null, level: number, fade: number): void {
    if (this.dr) this.fadeVoice(this.dr, t, fade);
    this.dr = null;
    this.wantDrone = midis ? { midis, level } : null;
    if (midis && this.audible) this.dr = this.makeDrone(t, midis, level, fade);
  }

  private makeDrone(t: number, midis: readonly number[], level: number, fade: number): Voice {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.setValueAtTime(0, t);
    out.gain.setTargetAtTime(level * LEVEL.drone, t, Math.max(0.05, fade / 3));
    out.connect(this.bus.drone);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    const fc = midiHz(Math.max(...midis)) * 2.4;
    lp.frequency.value = fc;
    lp.Q.value = 0.5;
    lp.connect(out);
    const srcs: AudioScheduledSourceNode[] = [];
    for (const m of midis) {
      for (const det of [-5, 5]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(lp);
        srcs.push(o);
      }
    }
    const sub = c.createOscillator();
    sub.frequency.value = midiHz(Math.min(...midis) - 12);
    const subG = c.createGain();
    subG.gain.value = 0.55;
    sub.connect(subG);
    subG.connect(out);
    srcs.push(sub);
    // The drone breathes: a very slow sweep of its brightness.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.055;
    const lfoG = c.createGain();
    lfoG.gain.value = fc * 0.3;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    srcs.push(lfo);
    for (const s of srcs) s.start(t);
    return this.track({ tail: out, env: out.gain, srcs, end: Infinity, nodes: srcs.length + 4 });
  }

  choir(t: number, midis: readonly number[] | null, level: number, tau: number, glide: number, vowel: Vowel, rise = 0, vowelTime = 0.6): void {
    if (!midis) {
      if (this.ch) this.fadeVoice(this.ch, t, tau * 3);
      this.ch = null;
      return;
    }
    if (!this.audible) return;
    const v = this.ch ?? (this.ch = this.makeChoir(t, vowel));
    const n = midis.length;
    for (let i = 0; i < v.oscs.length; i++) {
      const f = midiHz(midis[i % n]!);
      const p = v.oscs[i]!.frequency;
      if (rise > 0) {
        p.setValueAtTime(f * Math.pow(2, -rise / 12), t);
        p.setTargetAtTime(f, t, Math.max(0.01, glide / 3));
      } else p.setTargetAtTime(f, t, Math.max(0.004, glide / 3));
    }
    v.out.gain.setTargetAtTime(level * LEVEL.choir, t, Math.max(0.004, tau));
    const vw = VOWELS[vowel];
    for (let k = 0; k < 3; k++) {
      v.bps[k]!.frequency.setTargetAtTime(vw.f[k]!, t, Math.max(0.01, vowelTime / 3));
      v.fgs[k]!.gain.setTargetAtTime(vw.g[k]!, t, Math.max(0.01, vowelTime / 3));
    }
  }

  private makeChoir(t: number, vowel: Vowel): ChoirVoice {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.setValueAtTime(0, t);
    out.connect(this.bus.choir);
    const sum = c.createGain();
    sum.gain.value = 0.2;
    const vw = VOWELS[vowel];
    const bps: BiquadFilterNode[] = [];
    const fgs: GainNode[] = [];
    for (let k = 0; k < 3; k++) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = vw.f[k]!;
      bp.Q.value = [6, 8, 10][k]!;
      const fg = c.createGain();
      fg.gain.value = vw.g[k]!;
      sum.connect(bp);
      bp.connect(fg);
      fg.connect(out);
      bps.push(bp);
      fgs.push(fg);
    }
    const srcs: AudioScheduledSourceNode[] = [];
    const lfos: GainNode[] = [];
    for (const [rate, depth] of [
      [5.2, 11],
      [5.9, 9],
    ] as const) {
      const l = c.createOscillator();
      l.frequency.value = rate;
      const lg = c.createGain();
      lg.gain.value = depth;
      l.connect(lg);
      srcs.push(l);
      lfos.push(lg);
    }
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < 10; i++) {
      const o = c.createOscillator();
      o.setPeriodicWave(this.waves.choir);
      o.detune.value = (i % 2 ? 1 : -1) * (4 + (i % 3) * 3);
      lfos[i % 2]!.connect(o.detune);
      o.connect(sum);
      oscs.push(o);
      srcs.push(o);
    }
    for (const s of srcs) s.start(t);
    return this.track<ChoirVoice>({ tail: out, env: out.gain, srcs, end: Infinity, nodes: srcs.length + 2 + 2 + 6, oscs, bps, fgs, out });
  }

  shimmer(t: number, level: number, fade: number): void {
    if (level <= 0) {
      if (this.sh) this.fadeVoice(this.sh, t, fade);
      this.sh = null;
      return;
    }
    if (!this.audible) return;
    if (!this.sh) {
      const c = this.ctx;
      const out = c.createGain();
      out.gain.value = 0;
      out.gain.setValueAtTime(0, t);
      out.connect(this.bus.shimmer);
      const srcs: AudioScheduledSourceNode[] = [];
      // Detuned pairs beat slowly against each other: a glassy, living shimmer with no LFOs.
      for (const m of [86, 93, 100]) {
        for (const k of [1, 1.0021 + m * 0.00001]) {
          const o = c.createOscillator();
          o.frequency.value = midiHz(m) * k;
          o.connect(out);
          o.start(t);
          srcs.push(o);
        }
      }
      this.sh = this.track({ tail: out, env: out.gain, srcs, end: Infinity, nodes: srcs.length + 1 });
    }
    this.sh.env.setTargetAtTime(level * LEVEL.shimmer, t, Math.max(0.01, fade / 3));
  }
}
