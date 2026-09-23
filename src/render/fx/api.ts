// Contract: juice services other modules may call (scene.fx). Owned by render/fx (+ render/post.ts).
// Add methods freely; never change or remove existing ones.
import type { Decimal } from '../../core/decimal';

export type DamageKind = 'click' | 'crit' | 'army' | 'gold';

/** Reusable world-space effects (see the preset table at the top of fx/index.ts). */
export type FxPreset = 'sparks' | 'sparksBig' | 'embers' | 'dust' | 'smoke' | 'shockwave' | 'flare' | 'glint' | 'shimmer' | 'slash';

export interface FxApi {
  /** Floating number at a world point. Crits are big and gold; 'gold' is a +N gold popup. */
  damageNumber(wx: number, wy: number, amount: Decimal, kind: DamageKind): void;
  /** Full-screen flash that fades over `seconds` (respects settings.reduceFlashes). */
  flash(color: string, alpha: number, seconds: number): void;
  /** Chromatic / zoom punch for big moments (0..1; respects settings.reduceMotion). */
  kick(strength: number): void;
  /**
   * Called when coins reach the gold counter: `count` landed this frame (for clinks) and `value`,
   * the Decimal gold those coins carry (each kill/stagger reward is split exactly across its
   * coins), so the HUD can count up as they land.
   */
  onCoinLanded(fn: (count: number, value?: Decimal) => void): () => void;
  /**
   * Spawn a preset effect at a world point, sized for the current zoom. `intensity` (default 1)
   * scales the particle count (or the size, for shockwave/flare/glint/slash).
   */
  burst(preset: FxPreset, wx: number, wy: number, intensity?: number): void;
  /**
   * M2: the boss fight's heartbeat (the red vignette's pulse). Fires on every "lub" while a boss
   * fights (and one last time when it escapes), with the urgency 0..1 (the timer's last 10 s), so
   * audio can thump in sync. Optional so null objects stay valid. Returns an unsubscribe.
   */
  onHeartbeat?(fn: (urgency: number) => void): () => void;
}
