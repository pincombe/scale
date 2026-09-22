// Contract: juice services other modules may call (scene.fx). Owned by render/fx (+ render/post.ts).
// Add methods freely; never change or remove existing ones.
import type { Decimal } from '../../core/decimal';

export type DamageKind = 'click' | 'crit' | 'army' | 'gold';

export interface FxApi {
  /** Floating number at a world point. Crits are big and gold; 'gold' is a +N gold popup. */
  damageNumber(wx: number, wy: number, amount: Decimal, kind: DamageKind): void;
  /** Full-screen flash that fades over `seconds` (respects settings.reduceFlashes). */
  flash(color: string, alpha: number, seconds: number): void;
  /** Chromatic / zoom punch for big moments (0..1; respects settings.reduceMotion). */
  kick(strength: number): void;
  /** Called when coins reach the gold counter (count landed this frame). For clinks. */
  onCoinLanded(fn: (count: number) => void): () => void;
}
