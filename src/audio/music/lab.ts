// Music lab (dev only; not part of the game build). Build it next to a static game build, from the
// repo root, e.g. into the wp26 preview (launch config `wp26`, port 4206):
//   node --input-type=module -e "import('vite').then(v => v.build({ configFile: false, root: 'src/audio/music',
//     base: './', build: { outDir: '../../../.vite/wp26/lab', emptyOutDir: true, rollupOptions: { input: 'src/audio/music/lab.html' } } }))"
// then open /lab/lab.html on that server. "Measure" renders every scenario offline and prints the
// loudness / band table (window.__musicReport holds the rows); the scenario buttons play live.
// Console: __musicLab.measure('', ['lute']) solos layers; __musicLab.clicks('zoom', ['choir']) hunts clicks;
// __musicLab.heart() measures the boss heartbeat's margin against the music.
import { Conductor } from './conductor';
import { heartMargin, measureMusic, renderScenario, SCENARIOS, type HeartReport, type MusicReport, type Render, type RenderOpts, type Scenario } from './measure';
import { LEVEL, MIX, WebPerformer, type Layer } from './performer';

declare global {
  interface Window {
    __musicReport?: MusicReport[];
    __musicLab?: {
      measure: (only?: string, layers?: Layer[]) => Promise<MusicReport[]>;
      clicks: (scenario: string, layers?: Layer[]) => Promise<{ worst: number; at: number; peak: number }>;
      heart: () => Promise<HeartReport[]>;
      render: (sc: Scenario | string, opts?: RenderOpts) => Promise<Render>;
      SCENARIOS: Scenario[];
      LEVEL: typeof LEVEL;
      MIX: typeof MIX;
    };
  }
}

const out = document.getElementById('out')!;
let live: { ctx: AudioContext; timer: number } | null = null;

function stop(): void {
  if (!live) return;
  window.clearInterval(live.timer);
  void live.ctx.close();
  live = null;
}

function play(i: number): void {
  stop();
  const sc = SCENARIOS[i]!;
  const ctx = new AudioContext();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 16;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.8 * 0.6;
  master.connect(limiter);
  const wet = ctx.createGain();
  const verb = ctx.createConvolver();
  const ret = ctx.createGain();
  ret.gain.value = 0.5;
  wet.connect(verb);
  verb.connect(ret);
  ret.connect(master);
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  const ir = ctx.createBuffer(2, ctx.sampleRate * 2.6, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const x = ir.getChannelData(ch);
    for (let k = 0; k < x.length; k++) x[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / x.length, 3.2);
  }
  verb.buffer = ir;
  const perf = new WebPerformer(ctx, master, wet, noise);
  const cond = new Conductor(perf, (Math.random() * 4294967296) >>> 0);
  const t0 = ctx.currentTime;
  const cues = [...(sc.cues ?? [])];
  cond.start(t0, sc.inputs(0), 1);
  const timer = window.setInterval(() => {
    const t = ctx.currentTime - t0;
    while (cues.length > 0 && cues[0]![0] <= t) cues.shift()![1](cond, ctx.currentTime);
    cond.update(ctx.currentTime, sc.inputs(t));
    perf.cleanup(ctx.currentTime);
    const i2 = cond.info;
    out.textContent = `${sc.name}  t=${t.toFixed(1)}s\n${i2.mood} · ${i2.label} · bar ${i2.bar}/${i2.bars} · ${i2.chord} · ${i2.bpm} bpm\nvoices ${perf.voices} · nodes ${perf.nodes + perf.graphNodes} (peak ${perf.peakNodes + perf.graphNodes})`;
    if (t > sc.secs + 20) stop();
  }, 25);
  live = { ctx, timer };
}

async function measure(only = '', layers?: Layer[]): Promise<MusicReport[]> {
  out.textContent = 'Rendering...';
  const rows = await measureMusic(only, layers);
  window.__musicReport = rows;
  const f = (x: number): string => x.toFixed(1).padStart(6);
  out.textContent =
    'scenario                          M max ST med ST max    int   peak  band med band max  margin band%  nodes ms/tick drums/s\n' +
    rows
      .map(
        (r) =>
          `${r.name.padEnd(32)} ${f(r.momentaryMax)} ${f(r.shortMedian)} ${f(r.shortMax)} ${f(r.integrated)} ${f(r.peak)}    ${f(r.bandMedian)}   ${f(r.bandMax)}  ${f(r.clickMargin)} ${(r.bandShare * 100).toFixed(1).padStart(5)} ${String(r.nodes).padStart(6)}  ${r.tickMs.toFixed(3)} ${f(r.drums)}`,
      )
      .join('\n');
  return rows;
}

const bar = document.getElementById('play')!;
SCENARIOS.forEach((sc, i) => {
  const b = document.createElement('button');
  b.textContent = `Play: ${sc.name}`;
  b.onclick = () => play(i);
  bar.appendChild(b);
});
document.getElementById('measure')!.onclick = () => void measure();
document.getElementById('stop')!.onclick = stop;
/**
 * Click hunt: the largest second difference |x[i] - 2x[i-1] + x[i-2]| relative to the render's
 * peak. Smooth tones below ~2 kHz stay under ~0.07; a step (a click) jumps toward 1.
 */
async function clicks(name: string, layers?: Layer[]): Promise<{ worst: number; at: number; peak: number }> {
  const sc = SCENARIOS.find((s) => s.name.includes(name))!;
  const { l } = await renderScenario(sc, { layers });
  let peak = 0;
  for (const x of l) peak = Math.max(peak, Math.abs(x));
  let worst = 0;
  let at = 0;
  for (let i = 2; i < l.length; i++) {
    const d = Math.abs(l[i]! - 2 * l[i - 1]! + l[i - 2]!);
    if (d > worst) {
      worst = d;
      at = i / 48000;
    }
  }
  return { worst: worst / (peak || 1), at, peak };
}

window.__musicLab = {
  measure,
  clicks,
  heart: heartMargin,
  render: (sc, opts) => renderScenario(typeof sc === 'string' ? SCENARIOS.find((x) => x.name.includes(sc))! : sc, opts),
  SCENARIOS,
  LEVEL,
  MIX,
};
