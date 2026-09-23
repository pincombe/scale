// The tier label and the height headline (top-left, above the gold): "II · The Mountain", then the
// running gag, PLAN §3.1 "Headline number = size": "Your knights stand 224 m tall," and the
// heightWord comparison under it. The headline shows from the first zoom on (the Meadow's 1.8 m is
// the setup, not the joke). The switch happens under the zoom cinematic, so the new tier's entrance
// (the height counting up from the old one) plays once the HUD is back.
import './headline.css';
import { MICROCOPY, sel } from '../core';
import type { Scene } from '../app/scene';
import { cinematicOf } from './cinematic';
import { el, setShown, setText } from './dom';
import { heightText, roman } from './effectText';
import type { UiRoot } from './mount';

/** The height's count-up at a new tier (s). */
const COUNT_S = 1.5;

export function createHeadline(scene: Scene, ui: UiRoot, box: HTMLElement, tierEl: HTMLElement): void {
  const { game } = scene;
  const cine = cinematicOf(scene, ui);
  const wrap = el('div', 'hud-height');
  box.insertBefore(wrap, tierEl.nextSibling);
  wrap.hidden = true;
  const line = el('div', 'hud-height-line', wrap);
  const pre = document.createTextNode('');
  const num = el('span', 'hud-height-num');
  const post = document.createTextNode('');
  line.append(pre, num, post);
  const word = el('div', 'hud-height-word', wrap);

  // The template splits around {height} so the number can shine on its own.
  const tpl = MICROCOPY.heightHeadline ?? 'Your knights stand {height} tall';
  const at = tpl.indexOf('{height}');
  pre.data = at >= 0 ? tpl.slice(0, at) : tpl + ' ';
  post.data = (at >= 0 ? tpl.slice(at + 8) : '') + ',';

  let lastTier = -1;
  let lastHeight = -1;
  let shownTier = -1;
  // Count-up state (runs only during an entrance).
  let from = 0;
  let to = 0;
  let t = -1;

  const enter = (tier: number, fromH: number, toH: number): void => {
    if (tier === shownTier) return;
    shownTier = tier;
    box.classList.remove('tier-enter');
    void box.offsetWidth;
    box.classList.add('tier-enter');
    from = fromH > 0 && fromH < toH ? fromH : toH;
    to = toH;
    t = from < to ? 0 : -1;
    setText(num, heightText(from));
  };

  ui.onFrame((dt) => {
    if (t < 0 || cine.on) return;
    t += dt;
    const k = Math.min(1, t / COUNT_S);
    // Exponential ease: the number grows like the zoom does, by orders of magnitude.
    const e = 1 - Math.pow(1 - k, 3);
    setText(num, heightText(from * Math.pow(to / from, e)));
    if (k >= 1) {
      t = -1;
      num.classList.remove('landed');
      void num.offsetWidth;
      num.classList.add('landed');
    }
  });

  ui.onRefresh(() => {
    const s = game.state;
    if (!s.flags['feature.gold']) return;
    const info = sel.tierInfo(s);
    if (s.tier !== lastTier) {
      const prevHeight = lastHeight;
      const first = lastTier < 0;
      lastTier = s.tier;
      const name = MICROCOPY[`tier.${s.tier}`] ?? info.name;
      setText(tierEl, `${info.numeral || roman(s.tier + 1)} · ${name}`);
      const show = s.tier > 0;
      setShown(wrap, show);
      if (show) {
        setText(word, info.heightWord);
        lastHeight = info.height;
        if (first || !scene.input.hasStarted) {
          shownTier = s.tier;
          setText(num, heightText(info.height));
        } else {
          setText(num, heightText(prevHeight > 0 ? prevHeight : info.height));
          const tier = s.tier;
          cine.after(() => enter(tier, prevHeight, info.height), 150);
        }
      } else lastHeight = info.height;
      ui.invalidateAnchors();
    }
    if (info.height !== lastHeight) {
      lastHeight = info.height;
      setText(word, info.heightWord);
      if (t < 0) setText(num, heightText(info.height));
    }
  });
}
