# SCALE: Architecture

The code contracts. PLAN.md is the design, BUILD_LOG.md the status. If a contract here blocks you, say so in your report; don't quietly work around it.

## 1. Folders and owners

| Folder | What | Owner (M1) |
|---|---|---|
| `src/core/` | Pure deterministic logic: state, `tick`, actions, content, formulas, saves, `fmt`. No DOM/canvas/audio, imports only `core/`, `lib/`, `break_infinity.js` (enforced by `core/purity.test.ts`). | 1.5 economy (`content/text.ts`: 1.8 writer) |
| `src/lib/` | Pure helpers for everyone: `math` (clamp, lerp, invLerp, smoothstep, `damp`, `smoothDamp`, hash), `ease`, `noise` (`Noise`: n1, value2, simplex2, fbm2), `rng` (sfc32, `Rng`), `color` (parseHex, mixHex, `rgba`, `AlphaRamp`, `ColorRamp`), `vec` (Vec2/Rect + out-param helpers). | shared, additive edits only |
| `src/app/` | Glue: `boot`, `loop`, `time`, `game` (facade + bus), `input`, `settings`, `debug`, `debugTools`, `scene`. | lead |
| `src/render/` | `renderer`, `camera`, `director`, `palette`, `particles`, `atlas`, `world`, `types`, `post.ts`; stub folders below. | lead (infra) |
| `src/render/backdrop/` | `createBackdrop(scene) → { back, front }` | 1.1 (+ `palette.ts` values) |
| `src/render/dragon/` | `createDragon(scene) → { layer, view: DragonView }` | 1.2 |
| `src/render/crowd/` | `createCrowd(scene) → { layer, view: CrowdView }` | 1.3 |
| `src/render/fx/` + `render/post.ts` | `createFx(scene) → { api: FxApi, text, post }`; also the first-minute **coach marks** (`coach.ts`, pure timeline in `coachTimeline.ts`: weak-spot coach until the first crit, stagger coach until the first stagger, derived from `state.stats`, so nothing new is saved) and the "Weak spot ×N" cause caption on the first crits | 1.4 (coach: 1.11) |
| `src/audio/` | `engine.ts` (graph, lead); `sfx.ts` → `createSfx(scene)` | 1.7 (`sfx*`) |
| `src/ui/` | `mount.ts` (UiRoot: regions, anchors, inset, toasts, refresh), placeholder `hud.ts`, `panel.ts`, `title.ts`, `styles.css` | 1.6 |
| `src/sim/` | Headless runs of the real core (`npm run sim`, in CI) | 1.9 |
| `src/render/zoom/` (M2) | `createZoom(scene) → { layer, api: ZoomApi }`: the zoom cinematic (layer slot 5) | 2.1 |
| `src/render/heraldry/` (M2) | `createHeraldry(scene)`: the coat of arms from `state.heraldry`, drawn for banners, shields and the panel | 2.4 |
| `src/audio/music/` (M2) | `createMusic(scene) → MusicApi`: generative, adaptive music on `audio.music` | 2.6 |

Each stub folder has an `api.ts` (the contract other folders use: extend it, never break it) and an `index.ts` factory (replace freely, keep the factory signature and layer names).

## 2. Frame and time

Logic runs at a fixed **20 Hz** (`TICK_DT = 1/20`, core/formulas). Per rAF frame (`app/loop.ts`):

1. wall dt, clamped to 0.1 s. A gap > 1 s **after the page was hidden/frozen** (`visibilitychange`, `freeze`/`resume`, `pagehide`), or any gap > 10 s (sleep) → `game.catchUp(gap)`: ticks silently (events dropped, cap 10 min) then queues one `resync`. A stall while visible just clamps dt (it must not silently eat a kill's effects).
2. `time.update(realDt)` → `time.dt` (scaled) and `time.realDt`.
3. `while (acc >= TICK_DT) game.tick()`; `alpha = acc / TICK_DT`.
4. `game.drain()`: every queued event, in order, to subscribers.
5. `director.update(time.dt)`, `camera.update(time.realDt)`.
6. `renderer.frame(...)`: every layer's `update(view)`, then `drawScene(ctx, view)`.
7. `ui.update(realDt)` (10 Hz refreshers), debug stats.

`TimeDirector` (`scene.time`): `scale = debugScale × slowMo × hitStop` (0 when paused).
- `hitStop(seconds)`: freeze everything, capped at 0.12 s; ignored if another hit-stop started < 0.3 s ago (wall time; same-frame requests max-merge). `slowMo(factor, seconds)`: start at `factor`, ease back to 1 (overlaps keep the slower). Both count **wall** time.
- **Juice costs logic time**: the scale also drives the tick accumulator, so a freeze is a real pause of the economy. Keep hit-stop ≤ 80 ms and only for crits/kills; slow-mo only for kills; the sim models the dilation. `time.dilation` (debug watch `dilation`) = juice-scaled / wall time over ~30 s, excluding debug scale and pause.
- `dt`/`time` are scaled (freeze in hit-stop): use them for animation, particles, springs. `realDt`/`realTime`: UI, grain, shake, anything that must not freeze.
- Smooth animation of tick-driven values: `phaseT + view.alpha * TICK_DT` (clamp to `phaseDur`).

## 3. Game facade and events

`scene.game` (`app/game.ts`):
```ts
game.state: GameState                                  // live; replaced wholesale on load/reset
game.dispatch(action: Action): void                    // applies NOW; its events queue for the next drain
game.on(type, fn: (e: EventOf<T>) => void): () => void // typed; returns unsubscribe
game.onAny(fn): () => void
game.catchUp(seconds), game.replaceState(state), game.post(event)  // app use
```
Handlers may dispatch; the new events drain in the same frame. A throwing handler is logged and skipped. **State is the truth, events are for juice**: reconcile visuals from `state` every frame (counts, dragon id/size/phase), and use events only for one-shot effects. On `resync`, snap to state with no effects.

## 4. State and events (M1 contract, `core/types.ts`)

```ts
createInitialState(seed): GameState   tick(state, dt, emit): void   applyAction(state, action, emit): void
interface GameState { v /*3, STATE_VERSION*/; seed; rng: [u32,u32,u32,u32]; t /*sim s*/; tier /*0 Meadow*/; gold: Decimal; lifetimeGold: Decimal;
  units: Record<UnitId, number>; upgrades: Record<string, number>; kills /*this tier*/; flags: Record<string, boolean>;
  dragon: DragonState; stats: { strikes; crits; staggers };  /* core-private: */ nextDragonId; army }
interface DragonState { id /*unique per spawn*/; index /*nth in tier*/; species; name; epithet; size /*m, body length*/;
  seed /*u32, visual variation*/; hp: Decimal; maxHp: Decimal; phase; phaseT; phaseDur; attack: 'breath'|'swipe';
  staggers /*times this dragon was staggered: the first pays the full bonus*/ }
type DragonPhase = 'enter'|'idle'|'windup'|'breath'|'swipe'|'stagger'|'dying'
type UnitId = 'footman'|'archer'
type UpgradeId = 'pointySwords'|'keenEye'|'drillSergeant'|'bounty'|'fletching'|'warHorns'|'heroicExample'|'quickNock'|'grindstone'
```
- Phases: `enter` (1.0 s for a newt ≤ 0.6 m, easing in log size to 1.6 s at ≥ 4 m: `enterDuration(size)`) → `idle` (`idleAfterEnter` = 1.0 s, so every dragon telegraphs an attack early) → `windup` (1.2 s, `attack` tells which) → `breath` (1.5 s) | `swipe` (0.9 s) → `idle` (3–6 s) → `windup`…; a weak-spot strike during `windup` → `stagger` (2 s: ×2 army damage, gold bonus). HP ≤ 0 → `dying` (1.1 s for a newt, easing to 1.6 s at ≥ 4 m: `dyingDuration(size)`; render animates both on `phaseT / phaseDur`, so they just play faster) → next dragon (`index + 1`) spawns in `enter`. The first dragon starts in `idle` (`firstIdle` 4 s). Durations live in `BALANCE.phase` (read `PHASE` or `dragon.phaseDur`, never hard-code them).
- **Weak spot** (`core/weakspot.ts`, a game rule; the dragon rig imports it for its hit test and glow): `weakSpotFor(phase, attack)` → `'throat'` in a breath windup, `'tail'` (tail base) in a swipe windup, else `'scale'` (the loose scale). `weakSpotLive(phase, k)`: none while `dying`, none in `enter` until `k > ENTER_WEAK_FROM` (0.72 of the entrance), else live; `weakSpotHittable(dragon)` applies it at `phaseT / phaseDur`. **Core enforces it:** `strike {weak: true}` when no spot is live is a plain hit, and the `strike` event's `weak`/`crit` say what actually happened. Render decides *where* the spot is (`dragon.hitTest`) and sends `weak`; core decides whether it counts.
- **Flags** (`state.flags`, set once, never cleared; each emits one `unlock {kind, id}` with the part after the dot as `id`). In unlock order for a new player:

  | Flag | When | UI meaning |
  |---|---|---|
  | `feature.dragonBar` | first strike lands | dragon name + HP bar appear |
  | `feature.gold` | first gold earned | gold counter appears |
  | `unit.footman` | 1 kill | the lone pulsing "Hire a Footman" button |
  | `upgrade.<id>` | its `unlock` requirement (e.g. `pointySwords`: 1 footman) | the upgrade is offered |
  | `feature.panel` | 2+ units/upgrades revealed (right after the first footman) | the Army/Upgrades panel opens |
  | `unit.archer` | 12 kills (~1:00 engaged) | archers can be hired |

  Requirements are data (`UNITS[id].unlock`, `UPGRADES[i].unlock`: `{stat: 'kills'|UnitId, at}`); `UNLOCK_FLAGS` lists every flag. Debug: `debug.loopPhase` (repeat the current phase), `debug.immortal`.
- Saves: schema v3 (`STATE_VERSION`; bumped for `DragonState.staggers`, older saves are rejected until the M3 loader migrates them). `serialize(state)` / `deserialize(text)` (JSON, Decimals exact as `{"$d":[m,e]}`; `toJSON`/`fromJSON` for any value).
- **Economy** (`core/formulas.ts`; every tunable number is in `core/content/balance.ts` → `BALANCE`): HP/gold/size by dragon index; unit costs grow ×1.12–1.13 per unit; each unit type doubles its damage at 10/25/50/100/200…500 owned, then every 100 (unbounded, so multipliers are Decimals). Click = `(base + share × armyDPS) × clickMult` (clickMult = pointySwords ×2 × grindstone ×3; share = heroicExample, 2%); a weak-spot crit multiplies the whole strike ×5 (×10 with keenEye). Stagger gold = kill reward × 50% on a dragon's first stagger, × 10% on later ones (`BALANCE.stagger`, `staggerGold`). Costs and rewards below 1e15 are canonical whole-number Decimals; break_infinity can't round-trip every integer through `toNumber()`, so show numbers with `fmt()`, never `toNumber()`.
- **Selectors for UI** (`core/selectors.ts`, also `import { sel } from 'core'`; pure, fine at 10 Hz): `unitVisible/unitAffordable(s, unit, n)`, `unitCost(s, unit, n)`, `maxAffordable`, `unitDps`, `armyDps`, `clickDamage(s, weak)`, `clickDps(s, cps, weakRate)`, `goldPerSec(s, cps?, weakRate?)`, `nextMilestone(s, unit) → {at, mult, remaining, frac}`, `upgradeVisible/upgradeAffordable/upgradeOwned(s, id)`, `visibleUpgrades(s)`, `requirementProgress(s, req)`, `anythingAffordable(s)`, `dragonInfo(s) → {name, epithet, index, size, sizeWord, hp, maxHp, hpFrac, reward, staggerReward, kills}`. Upgrade effects are data (`UPGRADES[i].effect`: `clickMult|unitMult|armyMult|weakMult|goldMult|clickArmyShare|periodMult`): the UI writes the effect line from it.
- **Text** (`core/content/text.ts`, the writer's strings, shapes owned by core): `UNIT_TEXT[id] {name, plural, flavor}`, `UPGRADE_TEXT[id] {name, flavor}`, `dragonName(rand, species, index) → {name, epithet}` (core passes a rand seeded from `state.rng`), `sizeWord(meters)`, `MICROCOPY` (keys like `clickToStart`, `unlock.<flag>`).

Actions: `strike {weak, aimed, x, y}` (x, y = world impact point, echoed back) · `buyUnit {unit, amount}` (`amount` = 1, 10… or `BUY_MAX` = `-1` for as many as gold allows; all-or-nothing, no-op if unaffordable or locked) · `buyUpgrade {id}` · `debug {op: gold|kill|next|dragon|units|phase|tier|flag, ...}`.

| Event | Meaning |
|---|---|
| `strike {damage, crit, weak, stagger, aimed, x, y}` | a click landed (ignored while `dying`). `weak`/`crit` = it really hit a live weak spot, ×5 (×10 with keenEye); a weak click with no live spot comes back `false`. `stagger` = weak hit during windup (not on a killing blow) |
| `armyHit {unit, damage, hits}` | a footman melee beat, or a volley landing. `hits` = visible blows/arrows (≤ 24/40). `damage` includes the ×2 while staggered |
| `volley {unit, arrows, flight}` | archers loosed; the matching `armyHit` arrives exactly `flight` s later (dropped if its target dragon died or is gone) |
| `dragonSpawn {id}` · `dragonPhase {id, phase, dur}` | new dragon · every phase change (also on spawn) |
| `dragonDeath {id, gold}` | kill; `gold` is already in `state.gold` |
| `goldGain {amount, source}` | non-kill gold (`stagger` bonus = 50% of the kill reward on a dragon's first stagger, 10% after; `other`), already added |
| `purchase {kind, id, amount}` · `unlock {kind, id}` · `milestone {unit, owned, mult}` | economy moments (`purchase.amount` = units actually hired; one `milestone` per threshold crossed, at most 8 per purchase) |
| `resync` | state changed wholesale: rebuild from state, no juice |

Melee beats skip `enter`/`breath`/`swipe`/`dying` (knights are scattered or flung; flinging is visual only).

## 5. Scene (`app/scene.ts`)

Every factory gets the same `scene`: `{ game, time, settings, camera, director, renderer, palette, particles: { world, screen }, atlas, sprites, dragon: DragonView, crowd: CrowdView, fx: FxApi, backdrop: BackdropApi, zoom: ZoomApi, ui: Ui, audio, music: MusicApi, input, debug }`. Read other services **lazily** (in update/draw/handlers, never in your factory body): `dragon`, `crowd`, `fx`, `backdrop`, `zoom` and `music` are wired after construction (null objects until then). `scene.palette` is the current tier palette (`paletteFor(state.tier)`, reset on every `resync`); layers read `view.palette`.

## 6. Layers and the stack (`render/types.ts`, `render/renderer.ts`)

```ts
interface Layer { readonly name: string; visible: boolean;
  resize?(w, h, dpr): void; update?(view: View): void; draw(ctx: CanvasRenderingContext2D, view: View): void }
interface View { state; alpha; dt; time; realDt; realTime; camera; palette; width; height /*CSS px*/; dpr; frame }
```
Order (names are checked by `renderer.setLayers`): **0** `backdrop.back` (must paint every pixel) · **1** `dragon` · **2** `crowd` · **3** `particles.world` · **4** `backdrop.front` · **5** `zoom` (M2: the cinematic) · **6** `fx.text` · **7** `post` · **8** `particles.screen`.
- `update(view)` runs once per frame for every layer (even hidden ones) before any draw; it's where state advances.
- `draw(ctx, view)` must be **re-entrant and side-effect free**. Use only `ctx` and `view` (never the main canvas or a cached camera). Each layer draws inside its own `save()`/`restore()`, starting from `setTransform(dpr,0,0,dpr,0,0)`, alpha 1, `source-over`, so you draw in CSS px and clips, shadows, dashes or smoothing never leak. `view.camera.apply(ctx)` switches to world meters.
- `renderer.drawScene(ctx, view, first = 0, last = 8)` paints slots `first..last`. M2's zoom director snapshots only the world, `drawScene(snapCtx, renderer.view, 0, WORLD_LAST /*4*/)` (no `fx.text`, `post`, `particles.screen`), of the outgoing tier **before** switching state, at the main view size. A view whose `state` differs from the live one is not supported: layers keep per-tier animation state.
- Offscreen buffers: `makeCanvas(w, h)` (`document.createElement`; no OffscreenCanvas). No `ctx.filter` or other Chrome-only canvas APIs. Cache static art on `resize` (or lazily, keyed by size + palette).

## 7. World and camera

World units are tier-local **meters**; ground at `y = 0`, **+y is down**, sky `y < 0`. Army on the left facing right, dragon on the right facing left, the dragon's rest-pose front edge at `x = CLASH_X = 0`; the hero stands at `x ≈ -0.95`. Knights are `KNIGHT_HEIGHT = 1.8` m (`render/world.ts`). Screen-filling layers overdraw `SAFE_MARGIN = 64` px.

`scene.camera` (`render/camera.ts`), all out-params, allocation-free:
```ts
x, y /*world point at stage center*/, zoom /*CSS px per m*/, rot; zoomEff, rotEff /*incl. punch/shake*/
insetRightTarget /*px covered by the UI panel; stage center eases into the uncovered area*/; stageW, stageCX, stageCY
worldToScreen(wx, wy, out), screenToWorld(sx, sy, out), toPx(m), visibleRect(out, marginPx), apply(ctx)
applyParallax(ctx, p), parallaxToScreen(p, lx, ly, out), parallaxZoom(p)
addTrauma(t /*0..1; shake = trauma², translation + roll, decays*/), punchZoom(s /*0.05 = +5%*/)
```
**Parallax**: depth `p` (0 = sky at infinity, 1 = stage, > 1 = foreground). Layers scale about the ground-line anchor; relative to the reference framing they zoom by `(zoom/refZoom)^p` and pan by `p ×` the camera's pan, so far hills barely shrink and stay seated on the horizon as the camera pulls back. Layer coordinates = world meters at the reference framing (knight = 20% of stage height, `director.refHeroFrac`; fixed, so the director's closer base framing doesn't rescale the backdrop). Shake scales with `p`.
**Director** (`render/director.ts`, `scene.director`): dragon-first composition. The clash point (`dragon.bounds().x`, where the hero fights) sits at ~39–40% of the stage width: the dragon owns the right, the army the left and may run off the left edge. Zoom = the closest of: the base framing (hero = 29% of stage height, so the first 0.5 m newt is ~72 px at 900 px); the dragon's share of the stage width, ramping on log size from 25% at 1 m to 44% at ≥ 10 m (so the camera holds still while dragons grow to ~3 m, then pulls back); the dragon's top plus 0.25 L fly-in/rearing headroom below the HUD band; the hero on stage. A growing army (`crowd.bounds()`) may pull back by at most ×1.12, fading to none at 10 m. Critically damped on log zoom, the clash point's world x and screen fraction; camera x is derived from the live (easing) stage width, so purchases, panel slides and dragon swaps never pop. Ground pinned at 76%. `frame()` is the pure framing math (tested in `director.test.ts`). `enabled = false` hands the camera to the M2 zoom director. `motionScale` (reduce motion) scales shake and punch.

## 8. Particles and atlas

Two pools: `scene.particles.world` (4,096, meters, slot 3) and `.screen` (1,024, CSS px, slot 7). Struct-of-arrays, fixed capacity, oldest recycled when full, zero allocations per spawn/update/draw; normal pass then additive (`lighter`) pass.
```ts
const SPARK = particleSpec({ sprite, ramp?, additive?, align?, ground?, life, lifeVar, speed, speedVar, angle, spread,
  radius, gravity, drag, size, sizeEnd, sizeVar, alpha, curve /*CURVE_LINEAR|FADE|PULSE|HOLD|FLASH*/, rot, rotVar, spin, spinVar });
ps.burst(SPARK, x, y, count, angle?, scale?)   // scale multiplies speed/size/gravity/radius: author in px, pass 1/camera.zoomEff for world
const i = ps.spawn(SPEC, x, y, vx, vy)         // exact velocity; then tweak ps.life[i], ps.grav[i], ps.size0[i]...
ps.homeTo(i, tx, ty, delay, strength?)         // fly to a screen point; ps.onArrive(sys, i) fires once (tag with ps.tag[i])
```
`onArrive` is a **single slot**: `particles.screen` arrivals are owned by `render/fx`; everyone else uses `scene.fx.onCoinLanded`. Overwriting it with a different function warns in dev.
Build specs **once** (module scope or lazily), never per frame. `align` rotates sprites (which point along +x) to their velocity; `ramp: n` steps through n consecutive tinted sprites over life.

`scene.atlas` (`render/atlas.ts`): `register(name, w, h, (ctx, w, h) => void): id` (draw white art if it will be tinted), `id(name)`, `canvas(id)`, `canvases[id]` (hot loops), `tint(id, color, core?)`, `ramp(id, colors, steps, core?)`. Canvas can't tint per draw call, so tints are baked once and cached. Built-ins in `scene.sprites`: `glow, spark, ember, smoke, dust, coin, ring`.

## 9. Service contracts (`render/*/api.ts`, `ui/api.ts`)

```ts
interface DragonView {                          // scene.dragon (render/dragon)
  hitTest(wx, wy): 'weak' | 'body' | null;      // live pose; forgiving (min 11 px weak radius: WEAK_HIT_MIN_PX in render/dragon/tuning.ts; ~10 px body pad)
  impactPoint(out): Vec2;                       // random point on the body: un-aimed clicks, army hits, arrow targets
  weakSpot(out): Vec2 | null;                   // null when not showing
  headPoint(out): Vec2;                         // mouth: fire origin
  bounds(out): Rect;                            // stable rest-pose AABB at current size (framing, targeting)
  weakRadius?(): number }                       // current weak-spot hit radius in world m (≥ WEAK_HIT_MIN_PX on screen); the fx coach ring sizes from it
interface CrowdView { heroPoint(out): Vec2; frontX(): number; bounds(out): Rect }   // scene.crowd (render/crowd)
interface FxApi {                               // scene.fx (render/fx)
  damageNumber(wx, wy, amount: Decimal, kind: 'click'|'crit'|'army'|'gold'); flash(color, alpha, seconds);
  kick(strength); onCoinLanded(fn: (count) => void): () => void }
interface Ui extends UiAnchors {                // scene.ui (src/ui)
  anchor(name /*'gold'*/, out): Vec2 | null;    // screen CSS px, cached, refreshed on layout
  registerAnchor(name, el); invalidateAnchors(); pulse(name); panelOpen; setPanelOpen(open);
  toast(text, kind?); onRefresh(fn /*~10 Hz, for DOM text*/); regions: { hud, panel, toasts, overlay, debug } }
```
Input (`app/input.ts`): a click anywhere on the stage strikes: on the dragon → `aimed`, at that point; elsewhere → `impactPoint()`, `aimed = false`; `hitTest === 'weak'` → `weak`. Hovering the weak spot shows a pointer. The first gesture (click or key, anywhere) unlocks audio and runs `scene.input.onFirstGesture(fn)` hooks; that first click also strikes. Keys: `M` mute, `1–4` → `scene.input.onAbility` (reserved). `#ui` is `pointer-events: none`; give interactive elements class `interactive` (buttons/inputs get it automatically).

## 10. Debug (`?debug`)

`scene.debug` is a no-op without `?debug`, so register unconditionally:
```ts
debug.section(title); debug.button(label, fn, hotkey?); debug.slider(label, min, max, step, get, set);
debug.toggle(label, get, set, hotkey?); debug.watch(label, () => string)
```
Hotkeys are single keys; reserved: `m`, `1–4`, `` ` `` (fold) and the built-ins `p . k n g f a w l i s x`. The panel shows FPS avg / 1% low, CPU ms avg / p99, a frame-time sparkline, particle counts, time scale (0–20×), pause/step, kill/next dragon, gold ×10, +footmen/archers, dragon-size slider, phase buttons, loop-phase, immortal, shake/flash/kick, layer toggles (auto-listed) and a 1,500-particle stress test.

`window.__scale = { game, scene, time, loop }` (debug only). Example: `__scale.game.dispatch({ type: 'debug', op: 'phase', phase: 'windup', attack: 'breath' })`.

URL params (with `?debug`): `seed=N dragon=N footman=N archer=N gold=N speed=X pause loop immortal phase=P attack=A panel=0|1 layers=a,b stress`.

## 11. Audio (`audio/engine.ts`)

`scene.audio`: AudioContext created on the first gesture. Graph: `sfx` and `music` buses → `master` (volume, mute) → limiter → destination; `reverbSend` → convolver (generated stone-hall IR) → master. Connect sources to `audio.sfx` (or `music`) and optionally also `audio.reverbSend`. `audio.ready`, `audio.now`, `audio.onReady(fn)`, `audio.noiseBuffer()` (shared 1 s white noise). Volumes and mute follow `settings`; the context suspends while the tab is hidden. Nodes are one-shot, so creating them per sound is fine; rate-limit sounds for frequent events.

`scene.settings`: `get(key)`, `set(key, value)`, `onChange(fn)`; keys `muted, masterVolume, sfxVolume, musicVolume, reduceMotion, reduceFlashes, notation` (persisted, safe without localStorage).

## 12. Conventions

- **Hot paths allocate nothing per frame**: no closures, arrays, objects or string building in update/draw. Preallocate `Vec2`/`Rect` and pass them as `out`; keep typed arrays; cache gradients, patterns, `rgba()` strings (`lib/color`) and static art (atlas, offscreen canvases on resize); set `ctx.font` from constant strings. Allocation is fine at init, per event and in 10 Hz UI refreshes.
- **Decimal vs number**: economy values (gold, HP, damage, costs) are `Decimal` (import from `core/decimal`; treat as immutable). Compare with `.lt/.gte/.eq`: **never `<`, `>` or `+`** (`valueOf` returns a string, so `a < b` compiles and compares strings). Display with `fmt()`; animate with `.toNumber()` (can be `Infinity`). Everything else (time, sizes, positions, counts) is `number`.
- Core is deterministic: randomness only from `state.rng` (`lib/rng`), no clocks, no `Math.random`. Render-side variation: `new Rng(dragon.seed)` or `Math.random`.
- TypeScript strict, `import type` for types, small focused modules, and tests for anything in `src/core/`.

## 13. Testing your piece in isolation

`npm run dev` (or `preview_start` name `dev`), then open **your own tab** at `http://localhost:5173/?debug&...`. `npm run check` = typecheck, tests, build, 1 MB size guard.
- **Backdrop**: `?debug&layers=backdrop.back,backdrop.front`, then drive the camera with the `dragon #` slider (pull-back and parallax) or `__scale.scene.camera`.
- **Dragon**: `?debug&dragon=8&phase=windup&attack=breath&loop&immortal`, `layers=backdrop.back,dragon,particles.world` to solo it. The phase buttons and `W`/`L` keys retrigger. `__scale.scene.director.enabled = false`, then set `camera.x/zoom` to inspect up close.
- **Crowd**: `?debug&footman=240&archer=60&immortal`; `F`/`A` add units (march-in), `K` kills (cheer). Volleys fire every 2.5 s.
- **Juice**: `?debug&immortal`, click the dragon (click and crit paths), `K` for kill coins, `X` for the stress test, plus the shake/flash/kick buttons and hit-stop/slow-mo.
- **SFX**: click once to unlock audio, then `?debug&footman=30&archer=20` for a steady stream of events; subscribe with `game.on`.
- **Economy**: `npm test`, `npm run sim` (headless), and `?debug&speed=10` to watch pacing live.
- **HUD/UI**: `panel=1`, `G` for gold, `F`/`A` for purchases; `__scale.scene.ui.anchor('gold', {x:0,y:0})`.

## 14. M2 contract: tiers, the Wyrm Gauge, bosses, the zoom, Scales, heraldry, abilities, champions

The types are in `core/types.ts` (schema v4). Core (WP 2.0) implements the rules; everyone else builds against this section. Numbers live in `BALANCE` and are tuned by the sim (WP 2.7).

**Tiers.** `TIERS` (core content): per tier `{ id, species, boss, bossAt /*kills to fill the gauge*/, baseHeight /*display m*/, units, champion }`. M2 has two: **0 Meadow** (newt · The Elder Newt · footman, archer · Ser Aldric) and **1 Mountain** (wyvern · Grimmaw of the Peaks · lancer · Dame Brunhild). Zooming past the last tier is refused (in M2 the Zoom button after Grimmaw says the Kingdom comes in the next build). World units stay tier-local meters: a knight is always `KNIGHT_HEIGHT` = 1.8 world m, and `state.height` is its **display** height (1.8 in the Meadow; the colossus's height after a zoom: the headline number). A length's display value is `m × state.height / 1.8` (`sel.displayMeters`).

**Wyrm Gauge and bosses.** Each ordinary kill adds 1 to `wyrm.charge`; `sel.gauge(s)` = charge / bossAt, 0..1. When the gauge is full, the next dragon to spawn is the boss (`bossSummon {boss, dur}`, then its `dragonSpawn`; `dragon.boss` = the boss id). A boss is a dragon in every respect (all phases, weak spots, staggers) but bigger, tougher and named from `BOSS_TEXT`. Its timer `wyrm.bossT` counts down from `wyrm.bossDur` only while it can be hit (not during `enter`, `dying`, `leave` or a hold).
- Timer out: `bossEscaped`; the boss plays `leave`; the gauge drops back (to ~75%, `BALANCE`); the next ordinary dragon spawns after the leave. No dead end: a few more kills bring it back, and the army has grown.
- Boss killed: its `dragonDeath` (a big reward), then `bossDefeated {boss, first}`, and `wyrm.cleared = true`.
- After a boss kill: in a save that has never zoomed (`zoom.count === 0`), core **begins the zoom by itself** when the boss's `dying` ends (no new dragon spawns). Otherwise ordinary dragons keep coming (still growing), and the UI offers the Zoom button (`sel.canZoom(s)`): zoom now, or push further for a mightier colossus.

**The zoom** (`{type: 'zoom', stage}`; the director in render/zoom drives it):
1. `begin`: needs `sel.canZoom(s)`. Sets `zoom.stage = 'begin'` (a **hold**: dragon phases don't transition, the army doesn't act, abilities and champions pause, strikes and purchases are ignored; a fighting dragon switches to `leave` and its phaseT still runs so the animation finishes). Fixes `zoom.pending` = `{scales, fusion, height}` and emits `zoomBegin {from, to, scales, fusion, height}`.
2. `switch`: render dispatches it after snapshotting the old tier (§6). Pays the reward and swaps in the next tier: `tier + 1`, `height`, `scales`/`lifetimeScales` += pending (a `scalesGain`), `zoom.fusion *= pending.fusion`, `zoom.count + 1`; **resets** gold, units (Tower heraldry grants starting troops), army timers and volleys, `kills`, `wyrm`, ability actives and cooldowns; **keeps** upgrades (each tier adds its own set), heraldry, champions (levels), Scales, stats, flags, lifetimeGold. The new tier's dragon #0 spawns in `enter` at phaseT 0 and stays frozen. Emits `zoomSwitch {tier}` then `resync`. `zoom.stage = 'switched'`.
3. `end`: `zoom.stage = null`; play resumes and dragon #0 makes its entrance. Emits `zoomEnd {tier}`.
Actions in the wrong stage are no-ops. The sim dispatches `switch` and `end` after a modeled cinematic delay.

**Scales and the Fusion Bonus.** `sel.scalesForZoom(s)` (what zooming now pays: grows with the tier and with how far you pushed past the boss) and `sel.fusionForZoom(s)` (grows with the army you fuse; Crown heraldry adds to it). The colossus's height (the new tier's `height`) = the tier's `baseHeight` scaled by the fusion bonus (so a mightier army stands taller: "212 m"). `zoom.fusion` multiplies all damage for the rest of the loop.

**Heraldry** (`buyHeraldry {id}`, costs Scales: `sel.heraldryCost(s, id)`): `heraldry.levels[id]` + 1; the first purchase of a charge appends it to `heraldry.order` (order[0] is the principal charge on the shield). Effects by level: **lion** all damage, **sun** gold, **wyvern** weak-spot crits, **stag** ability cooldowns, **tower** starting troops each tier, **crown** Fusion Bonus. Unlocked by the first zoom (`feature.heraldry`). Emits `purchase {kind: 'heraldry'}`. render/heraldry derives the coat of arms from `state.heraldry` alone.

**Abilities** (`useAbility {id}`; flags `ability.<id>`; the Mountain unlocks charge and rally at once, volley later): ready when unlocked, `cooldown === 0` and not holding. **charge** (Charge!): army damage × N while active. **rally**: auto-strikes at a fixed rate while active, at plain click damage (`strike` events with `auto: true`, `aimed: false`, never crits). **volley** (Dragonbane Volley): one huge archer volley (a `volley` event, then its `armyHit`), even with no archers. Emits `abilityUse {id, dur}`, `abilityEnd`, `abilityReady`. Stag heraldry shortens cooldowns. Keys 1–3 (`input.onAbility`).

**Champions** (`champion.<id>` flags; `levelChampion {id, amount}` costs gold, `sel.championCost`): each tier's champion joins by itself at a kill count (`championJoin`, level 1, free): Ser Aldric in the Meadow (~2:00), Dame Brunhild in the Mountain. They persist through zooms. A champion adds damage to the army (scaling with level) and every few seconds lands a special move (`championSpecial {id, damage}`: damage already applied).

**Lancers** (Mountain, `unit.lancer`): `UnitDef.kind = 'cavalry'`. Every interval they charge: `cavalry {unit, riders, travel}`, and the matching `armyHit {unit: 'lancer'}` lands `travel` s later (dropped if the dragon is gone or dying).

**Text** (writer; shapes owned by core): `TIER_TEXT[tier] {name, numeral, card}`, `BOSS_TEXT[id] {name, epithet, arrive, fall}`, `CHAMPION_TEXT[id] {name, title, special, join, quips}`, `CHARGE_TEXT[id] {name, flavor}`, `ABILITY_TEXT[id] {name, flavor}`, `heightWord(displayMeters)` (the knight-height comparison), plus `MICROCOPY` keys.

**Render and app services (M2).**
- `scene.zoom: ZoomApi` (`render/zoom/api.ts`): `active`, `onBeat(fn)` with beats `rally · fusion · flash · pullback · reveal · roar · card · done`. On `zoomBegin` the director sets `scene.director.enabled = false`, `scene.ui.setCinematic?.(true)`, `scene.backdrop.setTransition?.(true)`; rally/fusion play on the old tier (`scene.crowd.rally?`, `setFused?`); it snapshots the old tier with `renderer.drawScene(snap, renderer.view, 0, WORLD_LAST)`, **then** dispatches `switch`; after the reveal and the card it dispatches `end` and hands everything back. The layer `zoom` (slot 5) draws the snapshot, the hide and the colossus over the world. Until WP 2.1 lands, a stub completes every zoom at once.
- `scene.backdrop: BackdropApi` (`render/backdrop/api.ts`): `openEye()`, `onEyeOpen?(fn)`, `setTransition?(on)` (no re-bakes while the zoom flies the camera), `wyrmPose?(pose | null)` (the Mountain's world wyrm: rise, eye, jaw).
- `scene.music: MusicApi` (`audio/music/api.ts`): the engine reads state every frame (tier, boss, zoom stage) and listens to game events and zoom beats.
- `CrowdView.rally?(x, seconds)`, `CrowdView.setFused?(fused)`; `Ui.setCinematic?(on)`.
- `paletteFor(tier)` (`render/palette.ts`); the dragon's resource cache must be keyed by tier or palette name, never rebuilt per frame (no per-frame palette blending: the palette switches at `switch`, under the zoom's cover).
