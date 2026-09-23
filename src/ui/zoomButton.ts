// The Zoom button (dock, right; anchor 'zoom'). The first zoom of a save starts by itself; after
// that, when sel.canZoom(s), a luminous button offers the next one: "Zoom", its sub-line, the
// reward preview from sel.zoomPreview (+Scales · Fusion ×N · the new knight height) and, above it,
// the push-further hint (every dragon slain before zooming makes a mightier colossus). Click →
// `{type: 'zoom', stage: 'begin'}`. After the last tier's boss (sel.isLastTier), the button stays
// in a locked state saying the next tier arrives in the next build.
import './zoomButton.css';
import { MICROCOPY, fmt, sel } from '../core';
import type { GameState } from '../core';
import type { Scene } from '../app/scene';
import { cinematicOf } from './cinematic';
import { el, gameButton, setClass, setShown, setText } from './dom';
import { heightText, template } from './effectText';
import { lockIcon } from './icons';
import type { UiRoot } from './mount';

type Mode = 'hidden' | 'ready' | 'locked';

export function createZoomButton(scene: Scene, ui: UiRoot, dock: HTMLElement): void {
  const { game } = scene;
  const cine = cinematicOf(scene, ui);
  const wrap = el('div', 'zb-wrap', dock);
  wrap.hidden = true;
  ui.registerAnchor('zoom', wrap);
  const push = el('div', 'zb-push', wrap);
  const state = (): GameState => game.state;

  let mode: Mode = 'hidden';
  const b = gameButton(
    'zb',
    wrap,
    () => mode === 'ready' && sel.canZoom(state()),
    () => game.dispatch({ type: 'zoom', stage: 'begin' }),
  );
  const rings = el('span', 'zb-rings', b);
  rings.setAttribute('aria-hidden', 'true');
  el('span', 'zb-ring', rings);
  el('span', 'zb-ring', rings);
  el('span', 'zb-ring', rings);
  el('span', 'zb-shine', b).setAttribute('aria-hidden', 'true');
  const title = el('span', 'zb-title', b);
  const lock = el('span', 'zb-lock', title);
  lock.appendChild(lockIcon());
  const titleText = el('span', 'zb-title-text', title);
  const sub = el('span', 'zb-sub', b);
  const preview = el('span', 'zb-preview', b);

  const want = (s: GameState): Mode => {
    if (s.zoom.stage !== null) return 'hidden';
    // The first zoom plays by itself (core begins it when the boss's death ends): no button.
    if (sel.canZoom(s)) return s.zoom.count > 0 ? 'ready' : 'hidden';
    if (s.wyrm.cleared && sel.isLastTier(s)) return 'locked';
    return 'hidden';
  };

  let lastPreview = '';
  ui.onRefresh(() => {
    const s = state();
    const m = cine.on ? 'hidden' : want(s);
    if (m !== mode) {
      const was = mode;
      mode = m;
      setShown(wrap, m !== 'hidden');
      setClass(wrap, 'locked', m === 'locked');
      setClass(wrap, 'ready', m === 'ready');
      setShown(lock, m === 'locked');
      setShown(push, m === 'ready');
      setShown(preview, m === 'ready');
      setText(titleText, MICROCOPY.zoomButton ?? 'Zoom');
      setText(
        sub,
        m === 'locked' ? (MICROCOPY.zoomLocked ?? 'The next tier arrives in the next build.') : (MICROCOPY.zoomButtonSub ?? 'Fuse your army into one colossal knight.'),
      );
      setText(push, MICROCOPY.zoomPush ?? 'Or fight on: every dragon slain now makes a mightier colossus.');
      b.setAttribute('aria-disabled', m === 'ready' ? 'false' : 'true');
      if (m !== 'hidden' && was === 'hidden' && scene.input.hasStarted) {
        wrap.classList.remove('enter');
        void wrap.offsetWidth;
        wrap.classList.add('enter');
      }
      lastPreview = '';
      ui.invalidateAnchors();
    }
    if (m !== 'ready') return;
    const p = sel.zoomPreview(s);
    const text = template('zoomPreview', '+{scales} Scales · Fusion Bonus ×{fusion} · Knights {height} tall', {
      scales: fmt(p.scales),
      fusion: String(p.fusion),
      height: heightText(p.height),
    });
    if (text !== lastPreview) {
      // A kill while the button waits: the reward grew. Let the player see it grow.
      const grew = lastPreview !== '';
      lastPreview = text;
      preview.textContent = text;
      if (grew && typeof preview.animate === 'function') {
        preview.animate([{ transform: 'scale(1.08)', color: '#fff8e0' }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.2,.9,.3,1.3)' });
      }
    }
  });
}
