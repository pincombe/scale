// SFX (placeholder, WP 0.2): a tiny tick on every strike so the audio pipeline is audible.
// The SFX WP (1.7) replaces this with the real synthesized set (clangs, crits, roars, coins...).
import type { Scene } from '../app/scene';

export function createSfx(scene: Scene): void {
  const { game, audio } = scene;
  game.on('strike', (e) => {
    if (!audio.ready) return;
    tick(scene, e.crit);
  });
}

function tick(scene: Scene, crit: boolean): void {
  const audio = scene.audio;
  const ctx = audio.ctx!;
  const t = ctx.currentTime + 0.002;

  // Metallic blip: triangle with a fast downward pitch sweep.
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const f0 = (crit ? 1760 : 1180) * (0.97 + Math.random() * 0.06);
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.07);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(crit ? 0.32 : 0.2, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (crit ? 0.2 : 0.09));
  osc.connect(g);
  g.connect(audio.sfx);
  if (crit) g.connect(audio.reverbSend);
  osc.start(t);
  osc.stop(t + 0.25);

  // Click transient: a sliver of band-passed noise.
  const buf = audio.noiseBuffer();
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = crit ? 5200 : 3400;
  bp.Q.value = 1.4;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(crit ? 0.5 : 0.32, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(bp);
  bp.connect(ng);
  ng.connect(audio.sfx);
  src.start(t, Math.random() * 0.9, 0.05);
}
