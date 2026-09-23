// The dock: the stage's bottom center, below the ground line, shared by the abilities bar (left)
// and the Zoom button (right). The M1 "Hire a Footman" button uses the same spot but only exists
// before the panel, long before either of these. It lives in the stage layer, so it follows the
// uncovered stage when the panel slides in, and it fades out under the zoom cinematic (Ui.setCinematic
// fades the whole stage layer; dock.css also keys off #ui.ui-zoom-hold, set by cinematic.ts).
import './dock.css';
import type { Scene } from '../app/scene';
import { createAbilities } from './abilities';
import { el } from './dom';
import type { UiRoot } from './mount';
import { createZoomButton } from './zoomButton';

export function createDock(scene: Scene, ui: UiRoot): void {
  const dock = el('div', 'dock', ui.stage);
  createAbilities(scene, ui, dock);
  createZoomButton(scene, ui, dock);
}
