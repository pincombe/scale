// Ambience bed: a very quiet, never-repeating meadow wind (so the silence between hits isn't dead).
// Birds are one-shots scheduled by sfx.ts. Built once when audio starts; runs until the page closes
// (the engine suspends the whole context while the tab is hidden).
import { kRate } from './kit';

/** Level of the wind bed at the sfx bus (≈ -46 dBFS RMS). */
const WIND_LEVEL = 0.05;

/**
 * 6 s of seamlessly looping soft-brown noise (integrated white noise with leak), crossfaded at the
 * seam so the loop point is inaudible.
 */
function windBuffer(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 6);
  const fade = Math.floor(rate * 0.5);
  const raw = new Float32Array(len + fade);
  let s = 0x51ed270b;
  let b = 0;
  let peak = 0;
  for (let i = 0; i < raw.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const w = ((s >>> 0) / 4294967296) * 2 - 1;
    b = b * 0.985 + w * 0.15;
    raw[i] = b;
    const a = Math.abs(b);
    if (a > peak) peak = a;
  }
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  const k = 0.9 / (peak || 1);
  for (let i = 0; i < len; i++) d[i] = raw[i]! * k;
  // Crossfade the tail (beyond len) into the head so sample len-1 flows into sample 0.
  for (let i = 0; i < fade; i++) {
    const x = i / fade;
    d[i] = (raw[i]! * x + raw[len + i]! * (1 - x)) * k;
  }
  return buf;
}

/**
 * Build the wind bed into `dest`: brown noise through a wide low band-pass (the body of the wind)
 * and a narrow whistling band, with two slow, incommensurate LFO pairs gusting the level and
 * sweeping the bands, faded in over 4 s. Returns a stop function.
 */
export function startWind(ctx: BaseAudioContext, dest: AudioNode, at: number): () => void {
  const src = ctx.createBufferSource();
  src.buffer = windBuffer(ctx);
  src.loop = true;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, at);
  master.gain.linearRampToValueAtTime(WIND_LEVEL, at + 4);
  master.connect(dest);

  const body = kRate(ctx.createBiquadFilter());
  body.type = 'bandpass';
  body.frequency.value = 380;
  body.Q.value = 0.55;
  const bodyG = ctx.createGain();
  bodyG.gain.value = 0.7;
  src.connect(body);
  body.connect(bodyG);
  bodyG.connect(master);

  const whistle = kRate(ctx.createBiquadFilter());
  whistle.type = 'bandpass';
  whistle.frequency.value = 1300;
  whistle.Q.value = 9;
  const whistleG = ctx.createGain();
  whistleG.gain.value = 0.12;
  src.connect(whistle);
  whistle.connect(whistleG);
  whistleG.connect(master);

  const oscs: OscillatorNode[] = [];
  const mod = (param: AudioParam, freq: number, depth: number): void => {
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start(at);
    oscs.push(o);
  };
  // Gusts: two slow sines at incommensurate rates never line up the same way twice.
  mod(bodyG.gain, 0.071, 0.28);
  mod(bodyG.gain, 0.173, 0.16);
  mod(body.frequency, 0.047, 140);
  mod(whistle.frequency, 0.061, 260);
  mod(whistle.frequency, 0.13, 90);
  mod(whistleG.gain, 0.089, 0.1);

  src.start(at);
  return () => {
    try {
      src.stop();
      for (const o of oscs) o.stop();
    } catch {
      /* already stopped */
    }
    master.disconnect();
  };
}
