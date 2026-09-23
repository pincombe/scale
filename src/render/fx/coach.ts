// The coach mark: teaches "strike the glow = ×5" (and later the stagger) in the world, right at the
// live weak spot, instead of a caption far away. A warm-ivory hairline ring with a soft glow sits
// around the spot, a slow sonar ripple draws the eye, and a hairline leader runs down to a
// two-line label (Cinzel caps call to action, EB Garamond italic with the live multiplier) on a
// feathered vellum shadow with a gold rule, like the game's toasts. When (./coachTimeline.ts,
// pure) vs how (here).
//
// Placement: the label hangs below-left of the spot (over the dark foreground grass for a newt, the
// dark body for a big dragon), since numbers rise ABOVE impacts. It's clamped to the uncovered
// stage (panel inset, HUD band) and kept clear of the lone Hire button and the hint caption (UI
// anchors 'hire' and 'hint', registered by ui/hints.ts); it flips to the right if there's no room.
// The ring tracks the spot with a damped follow and fades whenever the spot isn't live.
//
// Learning the lesson snaps the ring into the spot with a small local flash (none with
// reduceFlashes) and fades the label. reduceMotion: a static ring (no ripple, pulse or gleam).
//
// Cost: a few arcs, one line and 2-3 drawImage while showing; nothing when hidden. Labels are
// rendered once (per font load, dpr and multiplier) into small canvases.
import type { Scene } from '../../app/scene';
import type { View } from '../types';
import { MICROCOPY, weakMult } from '../../core';
import { context2d, makeCanvas } from '../atlas';
import { damp, TAU } from '../../lib/math';
import { outCubic } from '../../lib/ease';
import { vec2 } from '../../lib/vec';
import { trackedText, trackedWidth } from './numbers';
import { COACH_NONE, COACH_STAGGER, COACH_STAGGER_MAX, createCoachTimeline, stepCoach, type CoachInput } from './coachTimeline';

const IVORY = '#fbeed2';
const GOLD_HI = '#ffe39a';
const CINZEL = '"Cinzel Variable", "Cinzel", Georgia, serif';
const GARAMOND = '"EB Garamond", Georgia, serif';

/** Ring radius: 2x the weak spot's hit radius, at least this (CSS px). */
const RING_MIN = 22;
/** Sonar ripple period (s): slow for the weak spot, urgent for a 1.2 s windup. */
const RIPPLE_WEAK = 1.2;
const RIPPLE_STAGGER = 0.6;
/** Leader length from the ring's edge to the label's elbow (CSS px), and its direction (down-out). */
const LEADER = 30;
const LEAD_DX = 0.6;
const LEAD_DY = 0.8;
/** Keep the label this far from the stage edges, and below the HUD + dragon bar band. */
const EDGE = 14;
const HUD_BOTTOM = 128;
/** Half-extents of the UI keep-outs around their anchors, with ~10 px of air: the lone Hire button
 * (~283 x 69 px measured) and the hint caption (a 560 px block, one line of 20 px italic). */
const HIRE_HW = 152;
const HIRE_HH = 44;
const HINT_HW = 290;
const HINT_HH = 22;
/** Snap-into-the-spot animation when the lesson is learned. */
const SNAP_DUR = 0.34;

// ---- label layout (CSS px, inside the label canvas) ----
/** Feather margin around the label box (room for the soft shadow plate). */
const M = 20;
const PAD_X = 12;
/** Extra length of the gold rule past the text, fading out on the far side. */
const RULE_TAIL = 26;
const L1_Y = 18;
const L2_Y = 39;
const BOX_H = 52;

interface LabelStyle {
  l1Key: string;
  l2Key: string;
  l1Font: string;
  l1Size: number;
  l1Track: number;
  l2Font: string;
}

const STYLE_WEAK: LabelStyle = {
  l1Key: 'coachWeakSpot',
  l2Key: 'coachWeakSpotSub',
  l1Font: `700 17px ${CINZEL}`,
  l1Size: 17,
  l1Track: 0.14,
  l2Font: `italic 16px ${GARAMOND}`,
};
const STYLE_STAGGER: LabelStyle = {
  l1Key: 'coachStagger',
  l2Key: 'coachStaggerSub',
  l1Font: `700 16px ${CINZEL}`,
  l1Size: 16,
  l1Track: 0.16,
  l2Font: `italic 16px ${GARAMOND}`,
};

interface Label {
  cv: HTMLCanvasElement;
  /** CSS size of the label box (without the feather margin). */
  w: number;
  h: number;
  /** Device-px scale it was rendered at. */
  res: number;
}

export interface Coach {
  update(v: View): void;
  draw(ctx: CanvasRenderingContext2D, v: View): void;
  /** One-line state for the debug panel. */
  status(): string;
}

function fontsOk(font: string): boolean {
  try {
    return typeof document === 'undefined' || !document.fonts || document.fonts.check(font);
  } catch {
    return true;
  }
}

export function createCoach(scene: Scene): Coach {
  const { game } = scene;
  const tl = createCoachTimeline();
  const input: CoachInput = {
    started: false,
    now: 0,
    strikes: 0,
    crits: 0,
    staggers: 0,
    kills: 0,
    dragonId: 0,
    phase: 'idle',
    spotLive: false,
  };

  const spot = vec2();
  const scr = vec2();
  const anc = vec2();

  // ---- visual state ----
  /** Content shown (stays set while fading out). */
  let shown = COACH_NONE;
  let ringA = 0;
  let labelA = 0;
  /** Seconds since the ring appeared (drives the lock-on and the ripple phase). */
  let appearT = 0;
  let clock = 0;
  let sx = 0;
  let sy = 0;
  let R = RING_MIN;
  /** Label side: 0 = left of the spot (elbow at its right end), 1 = right. */
  let side = 0;
  let ex = 0;
  let ey = 0;
  let snapT = SNAP_DUR;
  let snapA = 0;
  let snapR = RING_MIN;

  // ---- labels ----
  const labels: (Label | null)[] = [null, null, null, null];
  let labelsDirty = true;
  let labelsStale = false;
  let mult = 0;
  const markDirty = (): void => {
    labelsDirty = true;
  };
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (fonts) {
    Promise.all([
      fonts.load(STYLE_WEAK.l1Font),
      fonts.load(STYLE_STAGGER.l1Font),
      fonts.load(STYLE_WEAK.l2Font),
      fonts.load(STYLE_STAGGER.l2Font),
    ])
      .then(markDirty)
      .catch(() => undefined);
    fonts.addEventListener?.('loadingdone', () => {
      if (labelsStale) markDirty();
    });
  }
  const refreshMult = (): void => {
    const m = weakMult(game.state);
    if (m !== mult) {
      mult = m;
      labelsDirty = true;
    }
  };
  game.on('purchase', refreshMult);
  game.on('resync', () => {
    refreshMult();
    ringA = 0;
    labelA = 0;
    snapT = SNAP_DUR;
  });

  const renderLabel = (st: LabelStyle, flip: boolean, dpr: number, into: Label | null): Label => {
    const l1 = (MICROCOPY[st.l1Key] ?? '').toUpperCase();
    const l2 = (MICROCOPY[st.l2Key] ?? '').replace('{mult}', String(mult));
    const cv = into ? into.cv : makeCanvas(1, 1);
    let c = context2d(cv);
    c.font = st.l1Font;
    const track = st.l1Size * st.l1Track;
    const w1 = trackedWidth(c, l1, track) - track;
    c.font = st.l2Font;
    const w2 = c.measureText(l2).width;
    const textW = Math.max(w1, w2);
    const w = Math.ceil(textW + PAD_X * 2 + RULE_TAIL);
    const h = BOX_H;
    const res = dpr > 0 ? dpr : 1;
    cv.width = Math.ceil((w + M * 2) * res);
    cv.height = Math.ceil((h + M * 2) * res);
    c = context2d(cv);
    c.setTransform(res, 0, 0, res, 0, 0);
    c.clearRect(0, 0, w + M * 2, h + M * 2);
    // Elbow end (the leader joins the rule here) and the text edge next to it.
    const ex0 = flip ? M : M + w;
    const tx = flip ? M + PAD_X : M + w - PAD_X;
    const far = flip ? M + w : M;

    // Feathered vellum plate behind the text: only the shadow of an off-canvas rect is drawn.
    const px0 = flip ? M : M + RULE_TAIL * 0.6;
    const pw = w - RULE_TAIL * 0.6;
    c.shadowColor = 'rgba(12,6,3,0.62)';
    c.shadowBlur = 16 * res;
    c.shadowOffsetX = 4000 * res;
    c.fillStyle = '#000';
    c.fillRect(px0 - 4000, M + 4, pw, h - 8);
    c.shadowColor = 'rgba(0,0,0,0)';
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;

    // The gold rule the leader lands on: bright at the elbow, fading out on the far side.
    const g = c.createLinearGradient(ex0, 0, far, 0);
    g.addColorStop(0, 'rgba(251,238,210,0.85)');
    g.addColorStop(0.55, 'rgba(226,180,96,0.45)');
    g.addColorStop(1, 'rgba(226,180,96,0)');
    c.fillStyle = g;
    c.fillRect(M, M, w, 1);

    // Line 1: the call to action, tracked caps.
    c.textBaseline = 'middle';
    c.shadowColor = 'rgba(10,4,2,0.9)';
    c.shadowBlur = 4 * res;
    c.shadowOffsetY = 1 * res;
    c.font = st.l1Font;
    c.fillStyle = IVORY;
    trackedText(c, l1, flip ? tx : tx - w1, M + L1_Y, track, false);
    // Line 2: italic, with the live multiplier, in gold.
    c.font = st.l2Font;
    c.fillStyle = GOLD_HI;
    c.textAlign = flip ? 'left' : 'right';
    c.fillText(l2, tx, M + L2_Y);
    c.textAlign = 'left';
    c.shadowColor = 'rgba(0,0,0,0)';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    if (!fontsOk(st.l1Font) || !fontsOk(st.l2Font)) labelsStale = true;
    const out = into ?? { cv, w, h, res };
    out.w = w;
    out.h = h;
    out.res = res;
    return out;
  };

  const label = (mode: number, flip: boolean, dpr: number): Label => {
    const k = (mode === COACH_STAGGER ? 2 : 0) + (flip ? 1 : 0);
    let l = labels[k];
    if (!l || labelsDirty || l.res !== (dpr > 0 ? dpr : 1)) {
      if (labelsDirty) {
        labelsDirty = false;
        labelsStale = false;
        for (let j = 0; j < 4; j++) if (j !== k && labels[j]) labels[j]!.res = -1;
      }
      l = renderLabel(mode === COACH_STAGGER ? STYLE_STAGGER : STYLE_WEAK, flip, dpr, l);
      labels[k] = l;
    }
    return l;
  };

  // ---- glow sprites (lazy, per dpr) ----
  let glowRing: HTMLCanvasElement | null = null;
  let glowRes = 0;
  const GR = 40;
  const GM = 18;
  const ringSprite = (dpr: number): HTMLCanvasElement => {
    const res = dpr > 0 ? dpr : 1;
    if (glowRing && glowRes === res) return glowRing;
    glowRes = res;
    const size = (GR + GM) * 2;
    const cv = glowRing ?? makeCanvas(1, 1);
    cv.width = Math.ceil(size * res);
    cv.height = Math.ceil(size * res);
    const c = context2d(cv);
    c.setTransform(res, 0, 0, res, 0, 0);
    c.clearRect(0, 0, size, size);
    c.shadowColor = 'rgba(255,214,150,0.9)';
    c.shadowBlur = 9 * res;
    c.strokeStyle = 'rgba(255,236,200,0.55)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(size / 2, size / 2, GR, 0, TAU);
    c.stroke();
    c.stroke();
    glowRing = cv;
    return cv;
  };
  let flare: HTMLCanvasElement | null = null;
  const flareSprite = (): HTMLCanvasElement => {
    if (!flare) flare = scene.atlas.canvas(scene.atlas.tint(scene.sprites.glow, IVORY, 0.7));
    return flare;
  };

  /** The weak spot's hit radius in CSS px (the dragon's own hit test radius). */
  const hitPx = (zoom: number): number => {
    const r = scene.dragon.weakRadius;
    return r ? r.call(scene.dragon) * zoom : RING_MIN / 2;
  };

  // ---- placement ----
  /** Horizontal edges of the label box for an elbow at x (on the current side). */
  let bx0 = 0;
  let bx1 = 0;
  const boxX = (x: number, w: number): void => {
    bx0 = side === 0 ? x - w : x;
    bx1 = side === 0 ? x : x + w;
  };

  /** The elbow being placed this frame; avoid() pushes it so the label box clears a keep-out rect. */
  let tx = 0;
  let ty = 0;
  const avoid = (cx: number, cy: number, hw: number, hh: number, w: number, h: number, minY: number): void => {
    const kx0 = cx - hw;
    const kx1 = cx + hw;
    const ky0 = cy - hh;
    const ky1 = cy + hh;
    boxX(tx, w);
    if (bx1 < kx0 || bx0 > kx1 || ty + h < ky0 || ty > ky1) return;
    // Up first (stay close to the spot), as long as the label stays below the ring.
    const up = ky0 - 6 - h;
    if (up >= minY) {
      ty = up;
      return;
    }
    // Otherwise sideways, away from the keep-out on the label's own side.
    if (side === 0) tx = Math.min(tx, kx0 - 8);
    else tx = Math.max(tx, kx1 + 8);
  };

  const place = (v: View, l: Label, fresh: boolean): void => {
    const cam = v.camera;
    const left = EDGE;
    const right = v.width - cam.insetRight - EDGE;
    const top = HUD_BOTTOM;
    const bottom = v.height - EDGE;
    const d = R + 4;
    if (fresh) {
      // Left unless it would run off the stage (or into the army's edge of the screen).
      side = sx - LEAD_DX * (d + LEADER) - l.w < left ? 1 : 0;
      if (side === 1 && sx + LEAD_DX * (d + LEADER) + l.w > right) side = 0;
    }
    const dir = side === 0 ? -1 : 1;
    tx = sx + dir * LEAD_DX * (d + LEADER);
    ty = sy + LEAD_DY * (d + LEADER);
    const minY = sy + R * 0.5;
    const hire = scene.ui.anchor('hire', anc);
    if (hire) avoid(hire.x, hire.y, HIRE_HW, HIRE_HH, l.w, l.h, minY);
    const hint = scene.ui.anchor('hint', anc);
    if (hint) avoid(hint.x, hint.y, HINT_HW, HINT_HH, l.w, l.h, minY);
    // Stage bounds last (they win).
    if (side === 0) tx = Math.min(right, Math.max(left + l.w, tx));
    else tx = Math.max(left, Math.min(right - l.w, tx));
    ty = Math.max(top, Math.min(bottom - l.h, ty));
  };

  return {
    status() {
      const m = shown === COACH_STAGGER ? 'stagger' : shown === COACH_NONE ? '-' : 'weak';
      return `${tl.mode === COACH_NONE ? 'off' : 'on'} ${m} ring ${ringA.toFixed(2)} label ${labelA.toFixed(2)} (${tl.labelT.toFixed(1)} s) windups ${tl.windups}`;
    },
    update(v: View) {
      const dt = v.realDt;
      clock += dt;
      const s = game.state;
      input.started = scene.input.hasStarted;
      // Dormant (title screen, or both lessons done) and faded out: skip the rig query.
      const maybe = input.started && (s.stats.crits === 0 || (s.stats.staggers === 0 && tl.windups < COACH_STAGGER_MAX));
      const live = (maybe || ringA > 0) && scene.dragon.weakSpot(spot) !== null;
      input.now = v.realTime;
      input.strikes = s.stats.strikes;
      input.crits = s.stats.crits;
      input.staggers = s.stats.staggers;
      input.kills = s.kills;
      input.dragonId = s.dragon.id;
      input.phase = s.dragon.phase;
      input.spotLive = live;
      stepCoach(tl, input);

      if (tl.learned !== 0 && ringA > 0.05) {
        snapT = 0;
        snapA = ringA;
        snapR = R;
        ringA = 0;
      }
      if (snapT < SNAP_DUR) snapT += dt;

      const on = tl.mode !== COACH_NONE;
      if (on) {
        if (mult === 0) refreshMult();
        if (ringA < 0.02 || shown !== tl.mode) {
          // Fresh appearance: lock on from where the spot is now.
          shown = tl.mode;
          appearT = 0;
        }
      }
      if (live) {
        v.camera.worldToScreen(spot.x, spot.y, scr);
        if (ringA < 0.02 && appearT === 0) {
          sx = scr.x;
          sy = scr.y;
        } else {
          sx = damp(sx, scr.x, 22, dt);
          sy = damp(sy, scr.y, 22, dt);
        }
      }
      R = ringA < 0.02 ? Math.max(RING_MIN, 2 * hitPx(v.camera.zoomEff)) : damp(R, Math.max(RING_MIN, 2 * hitPx(v.camera.zoomEff)), 6, dt);
      appearT += dt;
      ringA = damp(ringA, on ? 1 : 0, on ? 7 : 10, dt);
      if (!on && ringA < 0.004) ringA = 0;
      const wantLabel = on && tl.label;
      const freshLabel = labelA < 0.02;
      labelA = damp(labelA, wantLabel ? 1 : 0, wantLabel ? 5 : 8, dt);
      if (!wantLabel && labelA < 0.004) labelA = 0;

      if (labelA > 0 && shown !== COACH_NONE) {
        place(v, label(shown, side === 1, v.dpr), freshLabel);
        label(shown, side === 1, v.dpr); // the side may have just flipped
        if (freshLabel) {
          ex = tx;
          ey = ty;
        } else {
          ex = damp(ex, tx, 14, dt);
          ey = damp(ey, ty, 14, dt);
        }
      }
    },

    draw(ctx: CanvasRenderingContext2D, v: View) {
      if (ringA <= 0 && labelA <= 0 && snapT >= SNAP_DUR) return;
      const dpr = v.dpr;
      const motion = !scene.settings.get('reduceMotion');

      // ---- snap: the ring closes onto the spot with a small local flash ----
      if (snapT < SNAP_DUR) {
        const k = snapT / SNAP_DUR;
        const e = outCubic(k);
        if (motion) {
          ctx.globalAlpha = snapA * (1 - k);
          ctx.strokeStyle = IVORY;
          ctx.lineWidth = 1.2 + 1.3 * (1 - e);
          ctx.beginPath();
          ctx.arc(sx, sy, snapR * (1 - 0.62 * e), 0, TAU);
          ctx.stroke();
        }
        if (!scene.settings.get('reduceFlashes')) {
          const f = flareSprite();
          const fs = snapR * (1.3 + 1.6 * e);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.8 * snapA * (1 - k) * (1 - k);
          ctx.drawImage(f, sx - fs, sy - fs, fs * 2, fs * 2);
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      if (ringA > 0) {
        const stag = shown === COACH_STAGGER;
        // Lock-on: the ring settles in from a little wider.
        const lock = motion ? 1 + 0.45 * (1 - outCubic(Math.min(1, appearT / 0.45))) : 1;
        const pulse = motion ? 1 + 0.035 * Math.sin(clock * (stag ? 10 : 5.2)) : 1;
        const r = R * lock * pulse;
        const a = ringA;

        // Soft glow around the ring.
        const gs = ringSprite(dpr);
        const gk = r / GR;
        const half = (GR + GM) * gk;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * (stag ? 0.55 : 0.42);
        ctx.drawImage(gs, sx - half, sy - half, half * 2, half * 2);
        ctx.globalCompositeOperation = 'source-over';

        // Sonar ripple.
        if (motion) {
          const period = stag ? RIPPLE_STAGGER : RIPPLE_WEAK;
          const rp = (appearT % period) / period;
          const rr = r * (1 + 0.95 * outCubic(rp));
          const ra = (1 - rp) * (1 - rp);
          ctx.globalAlpha = a * 0.6 * ra;
          ctx.strokeStyle = IVORY;
          ctx.lineWidth = 1.4 - 0.6 * rp;
          ctx.beginPath();
          ctx.arc(sx, sy, rr, 0, TAU);
          ctx.stroke();
        }

        // The hairline ring (a dark under-stroke keeps it crisp over a bright sky).
        ctx.globalAlpha = a * 0.35;
        ctx.strokeStyle = '#1a0d06';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = a * 0.95;
        ctx.strokeStyle = IVORY;
        ctx.lineWidth = 1.25;
        ctx.stroke();

        // A gleam travelling around the ring, like light catching a gold band.
        if (motion) {
          const g0 = clock * (stag ? 3.2 : 1.6);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a * 0.7;
          ctx.strokeStyle = GOLD_HI;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(sx, sy, r, g0, g0 + 0.9);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      // ---- leader + label ----
      if (labelA > 0 && shown !== COACH_NONE) {
        const l = labels[(shown === COACH_STAGGER ? 2 : 0) + (side === 1 ? 1 : 0)];
        if (l) {
          const la = labelA * (ringA > 0 ? Math.min(1, ringA * 1.4) : 1);
          const slide = motion ? (1 - labelA) * 6 : 0;
          // Leader from the ring's edge toward the elbow; it draws on as the label fades in.
          let dx = ex - sx;
          let dy = ey - sy;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > R + 6) {
            dx /= len;
            dy /= len;
            const x0 = sx + dx * (R + 3);
            const y0 = sy + dy * (R + 3);
            const grow = motion ? Math.min(1, labelA * 1.25) : 1;
            ctx.globalAlpha = la * 0.8;
            ctx.strokeStyle = IVORY;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + (ex - x0) * grow, y0 + (ey + slide - y0) * grow);
            ctx.stroke();
          }
          // The label canvas, blitted 1:1 on whole device pixels.
          const ox = side === 0 ? M + l.w : M;
          ctx.globalAlpha = la;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(l.cv, Math.round((ex - ox) * dpr), Math.round((ey + slide - M) * dpr));
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}
