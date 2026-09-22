// Placeholder entry (WP 0.1): proves canvas + embedded fonts. Replaced by WP 0.2.
import './styles/fonts.css';

const TITLE_FONT = '"Cinzel Variable"';
const BODY_FONT = '"EB Garamond"';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function draw(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2b1d3a');
  sky.addColorStop(0.45, '#c8603a');
  sky.addColorStop(0.75, '#f2b45a');
  sky.addColorStop(1, '#3a2418');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff4dc';
  ctx.shadowColor = 'rgba(60, 20, 0, 0.6)';
  ctx.shadowBlur = 24;
  ctx.font = `700 ${Math.round(Math.min(w, h) * 0.16)}px ${TITLE_FONT}`;
  ctx.fillText('SCALE', w / 2, h * 0.42);

  ctx.shadowBlur = 8;
  ctx.font = `italic ${Math.round(Math.min(w, h) * 0.04)}px ${BODY_FONT}`;
  ctx.fillText('Every dragon is bigger than the last.', w / 2, h * 0.58);
  ctx.shadowBlur = 0;
}

async function start(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`700 64px ${TITLE_FONT}`),
      document.fonts.load(`italic 24px ${BODY_FONT}`),
    ]);
  } catch {
    // Fall back to system serif; still draw.
  }
  draw();
  window.addEventListener('resize', draw);
}

void start();
