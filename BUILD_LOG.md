# SCALE: Build Log

The lead's resume document. A fresh lead should be able to pick up from this file alone. PLAN.md is the design, KICKOFF.md the lead's rules, ARCHITECTURE.md the code contracts (build against it, not against other modules' internals).

## Resume here
- **Milestone:** **M2 The Zoom ★ in progress** (third lead session, started 2026-09-23). M1 is closed (its feedback is done; don't redo it).
- **Where M2 stands:** the lead wrote the M2 contract skeleton (ARCHITECTURE §14; `core/types.ts` schema v4; stub folders `render/zoom`, `render/heraldry`, `audio/music`; `render/backdrop/api.ts`; the `zoom` layer slot 5; `paletteFor(tier)`). Wave 1 is launched (see M2 plan). Check the WP table for what's in flight.
- **If you are a fresh lead mid-M2:** the old agents can't be messaged. Read "M2 plan" and "M2 design reference" below, the WP table, then `git log` since 8301c92. Re-brief any WP that has no commit from its folder's current state.
- **Snapshot at M2 start (2026-09-23, 8301c92):** 261 tests pass, typecheck clean, `npm run sim` 40/40, build 445 KB raw / 197 KB gzip (fonts 98 KB).
- **GitHub is live:** https://github.com/pincombe/scale (public), deployed by Actions to https://pincombe.github.io/scale/ on every push to main. The user won't share the URL until M4. See Open issue 7.
- **Playing the build:** open `dist/index.html` directly, or `npm run preview` → http://localhost:4173. `?debug` for the FPS panel and jumps (ARCHITECTURE §10).
- **The user's standing preferences:** clear recommendations work well; they playtest at each ★; the source is public but unshared until M4.

## M2 plan (lead, 2026-09-23)
**Goal (PLAN §9):** "Is the zoom a wow?" Bosses, the zoom cinematic and fusion, the Mountain, Scales and Heraldry v1, abilities, champions v1, music v1, and the sim on tier 0–1 pacing (engaged zooms at ~3:30 and ~7:30; casual's first zoom before 5:00).

**Waves.** Wave 1 runs now on disjoint folders against the §14 contract. Wave 2 starts when the core (2.0) lands, because it needs real rules. Wave 3 integrates the zoom with everything, then reviews, the lead's art passes and the milestone review.
- Wave 1: 2.0 core · 2.1A zoom prototype · 2.3 Mountain backdrop · 2.4 heraldry renderer · 2.6 music · 2.8 wyvern and bosses
- Wave 2: 2.2 boss and gauge presentation · 2.5 UI · 2.7 sim · 2.9 crowd · 2.10 SFX v2 · 2.11 text
- Wave 3: 2.1B zoom integration and polish · reviews · milestone review · ★

**Checkpoints.** 2.1A stops after the prototype with key frames for the lead's art review, then continues as 2.1B. Every max/high WP gets a `reviewer` pass before it's accepted.

## How the M1 visual WPs were built (reference)
- **1.2 Dragon rig v1 + newt** (builder-max, owns `src/render/dragon/**`). ✅ Landed in 57a9402 and now in review; kept here as reference. As built: weak spot min `WEAK_HIT_MIN_PX = 11`; on small dragons the loose scale sits on the tail; throat only during breath windups, tail base during swipe windups; the swipe is a quick turnaround with the tail lashing through the front ranks at ~50–450 ms plus a dust shockwave; the dragon adds its own small shake on tail slams and on footsteps of dragons ≥ 5 m; `setOverride` on the returned object is for mutations; optional `DragonView.tailPoint`/`breathReachX`. **Adding a species:** add a `SpeciesDef` with `young`/`old` parameter sets, blended by size on a log scale. The sets cover proportions and posture; head shape (eye, brow, teeth, horns, gills, whiskers, frill); leg pairs; wings; crest; tail fin, spade or club; head count; per-individual variation; and behavior tuning. Set a feature to 0 to switch it off.
  - **Rig:** data-driven procedural rig: a follow-the-leader spine with a width profile giving one smooth outline; a head with hinged jaw, horns, a blinking and tracking eye, and smoking nostrils; 2–4 IK legs with planted feet; finger-bone wings with membranes on a flap cycle. Parameters cover spines, frills, whiskers, tail tip, leg count, wing size and head count (the three-headed mutation comes later).
  - **Species:** a species is a parameter set. The meadow newt, with per-individual variation from `dragon.seed`, has to work from 0.5 m to 40 m.
  - **Look:** near-black silhouette with a rim light toward `palette.light`, a hit flash and a flinch.
  - **Phases:**
    - enter: scuttles in
    - idle: breathing swell
    - windup: throat glow (a swipe windup coils the tail)
    - breath: fire stream from `headPoint`, via world particles
    - swipe: a tail sweep through the army's front line
    - stagger: wobble
    - dying: 1.6 s collapse into embers
  - **Weak spot:** a loose scale with a white-hot core and cyan halo. It moves to the throat during a breath windup. Because of a late note (juice finding), its minimum hit radius is ~10–12 px (a named constant) and it sits off-center, so clicking the middle of a newt is not a crit.
  - **Contract and budget:** implement `DragonView` (ARCHITECTURE §9) with stable `bounds`. At most 1 ms per dragon per frame, with no per-frame allocations.
  - **Dev pages:** the agent added `lab.html`/`lab.ts` as a dev-only rig lab.
- **1.3 Knight crowd** (builder-high, owns `src/render/crowd/**`). ✅ Landed in 7376082 (0.5–0.8 ms/frame at 300 knights; ~60 MB of baked sprite canvases across 4 LODs); kept here as reference.
  - **Sprites:** procedural silhouettes with a baked rim light, pre-rendered into sprite sheets at 2–3 LODs (180 px down to 15 px). Types are the hero (plume, cape), footman (helm, sword, shield) and archer (hood, longbow).
  - **Animations:** idle, march, strike, loose, flung, get-up, cheer and scatter.
  - **Banners:** every 6–10 knights carries a banner. The emblem is drawn by one function that takes a heraldry description (M2 Heraldry swaps it in).
  - **Formation:** the hero sits at the front near x = −0.95, with archers at the back and pseudo-depth rows. New purchases march in from the left to a stable slot, reconciled from `state.units` every frame.
  - **Reactions:**
    - strike → the hero lunges with a sword arc
    - melee beats → front footmen swing
    - volley → arrows land on `dragon.impactPoint()` after `flight` seconds
    - breath → knights scatter
    - swipe → knights take ragdoll arcs, then get up
    - death → cheer
    - milestone → weapons raised
  - **Squads and contract:** past 300 knights, one sprite stands for a squad. Implement `CrowdView`.
  - **Budget:** at most 2 ms per frame at 300 knights. `gallery.html` is a dev-only sprite gallery.
- **1.9 Balance sim v0** (builder-high, owns `src/sim/**` + `BALANCE` in `src/core/content/balance.ts`). ✅ Landed in bfd6db1; kept here as the reference for what it does.
  - **Bots:** casual (3 clicks/s, 10% weak-spot hits, buys every 10 s), engaged (6 clicks/s, 30% weak-spot hits, better during windups, buys greedily) and idle (clicks only for the first kill, buys once a minute). Each runs over ~20 seeds.
  - **Output:** a median/worst-case timeline table and PASS/FAIL against the M1 targets (below). It exits non-zero on failure, because CI runs `npm run sim`. `--profile/--seed/--verbose` flags give a single run.
  - **Dilation model:** it models juice time dilation in `src/sim/juice.ts`, mirroring `src/render/fx/tuning.ts`: crit hit-stop 0.07 s (0.08 on a stagger), only after ≥ 0.6 s without crits; kill hit-stop 0.08 s + `slowMo(0.25, 0.55)`; TimeDirector cooldown 0.3 s, cap 0.12 s.
  - **Added scope, core logic fixes from the 1.5 review:**
    1. Apply `clickMult` to the whole strike, including the heroicExample share, so grindstone and pointySwords really are ×3/×2. Retune the heroic share so engaged damage stays 40–60% clicks.
    2. Add `BALANCE.phase.idleAfterEnter` (0.8–1.5 s) so every dragon telegraphs an attack early. Targets: ≥ 8 breaths/swipes seen by 3:15 for engaged, ≥ 5 for casual.
    3. Pay the full stagger bonus only on the first stagger per dragon, 10–20% on later ones. This adds a per-dragon counter and bumps the save version.
    4. Lethal check: `!hp.sub(dmg).gt(0)`; never stagger a dying dragon.
    5. `MILESTONES`/`MILESTONE_MULT`/`WEAK_MULT` in `content/index.ts` become live getters.
- **1.9b Sim fidelity + balance** ✅ Landed in 551f104: 35/35 targets PASS (engaged 29.5 kills by 3:15, worst 28; casual 7 kills by 1:00, 5th kill 38.9 s). (builder-high; owns `src/core/**`, `src/sim/**` and ARCHITECTURE §4, plus narrow grants: `render/dragon/weakspot.ts` imports the rule from core, `render/fx/tuning.ts` exports the juice time constants, and the one-line `ui/effectText.ts` fix)
  1. **Weak-spot liveness moves to core.** Core decides which spot is live (scale, throat during a breath windup, tail during a swipe windup) and whether any is hittable (`enter` after 72%; never while `dying`). `strike` downgrades weak hits when nothing is live, and the rig imports the rule.
  2. **Sim fidelity:** a separate, harder windup weak rate per bot; a shopping pause (0.3 s + 0.15 s per purchase); the `--profile` crash fixed; juice constants imported from the fx code, not copied; click share measured against remaining HP.
  3. **Targets:** first upgrade *bought* instead of visible; stagger share of gold ≤ 25%; a casual novelty gap; engaged worst-seed attacks seen ≥ 6.
  4. **Balance:** `hpBase` 20 → 14, heroicExample share 0.015 → 0.0175, then retune until all targets pass.
  5. **UI:** heroicExample shows "1.5%", not "2%".
  6. **Docs:** ARCHITECTURE §4 refresh.

## Observations to revisit after the playtest (lead)
- **Staggers:** engaged players still stagger ~half their windups at a 25% throat-hit rate. Fine for skilled play; revisit if the user rarely sees fire breath.
- **Base framing: settled.** At the M1 playtest the user said the 0:40–1:30 stretch (small newt, big knights) is fine. The shelved options, if it ever comes back: frame wider (`director.heroFrac` 0.29 → ~0.25), move the clash point right after the title, or a faster early size curve.
- **Tail-swipe thumps:** the SFX thumps are timed 0.45–1.15 s after the swipe starts, not synced to the crowd's ragdoll landings (the crowd now flings via the rig's `tailPoint`). If they feel off, add a crowd→audio landing hook.
- **What already looks premium:**
  - the title over the live meadow;
  - the first strike and first kill (warm pop, coins counting up from 0);
  - the eye opening in the hills: since 1.12 the valley wall is a sleeping stone wyrm's head (nostril by the sun, mouth line, brow), and the eye opens in it at ~2:18 (engaged);
  - the weak-spot coach (1.11): an ivory ring on the glowing spot with "Strike where it glows", then a "Weak spot ×5" caption on the payoff;
  - the 3 m dragon breathing fire at the hero;
  - late game: a 12 m winged dragon flying in over a banner-dotted host, and the 41 m breath.

## M2 notes from M1 reviews (for the M2 planner)
**Dragon rig extensibility** (from the 1.2 review)
- Species are data-driven only for newt-like quadrupeds:
  - legs can't be switched off, so no serpents;
  - the ground is hard-wired (`rig.ts` ~810/949, fire aim), so no airborne cloud dragons;
  - fixed node counts and no path targets, so no coiling leviathans;
  - `behavior.enter`/`behavior.swipe` are declared but ignored (`choreo.ts` ~167);
  - weak-spot candidates are hard-coded (`species.ts` ~387).
- The Mountain wyvern needs wings as front legs, craggy plates, a glide-in entrance and clickable wings.

**Zoom director (2.1) needs from the rig**
- Giant background wyrms need a dragon instance not bound to game state (`createDragon` is one instance tied to `state.dragon`), a transform hook instead of `cam.apply` (`paint.ts` ~880) for parallax, and a scale pattern on the hide.
- The dragon's resource cache is keyed by palette object (`index.ts` ~239), so blending palettes per frame during the zoom would grow the sprite atlas without bound. Key by tier, or quantize.

**Crowd**
- The hero buffer caps at 2048 px and upscales beyond it. The M2 fusion "boots fill the screen" shot should draw the hero vector-direct.

**Heraldry**
- The crowd's `drawEmblem()` in `banner.ts` takes a heraldry description (`Heraldry` type + optional `setHeraldry?` in `crowd/api.ts`).

**From the M1 feedback round (1.11 coach, 1.12 eye)**
- **Eye timing (2.2):** the first opening is kill-based (2.2 s after kill 23: 2:09–2:23 engaged), so casual (~3:09–3:39) and non-aimer (~3:20) players first see it after the M2 boss's 3:15 slot. When 2.2 adds the Wyrm Gauge and tremors, tie the eye to the gauge and add a time-based fallback so every player sees it before the boss. The sim has an "eye first opens" target (added in the 1.12 fix round); move it with the trigger.
- **Eye audio (2.2/2.6):** the eye opens in silence. A low rumble or growl when the lids part would sell it. The backdrop would need an `onEyeOpen` hook for audio.
- **Eye placement:** with the panel open, the eye sits under the panel when the window width is below ~1.07 × height + 340 px (e.g. 1200×900). All common laptop and desktop sizes are fine; revisit if the Mountain tier's framing moves the head.
- **Coach keep-outs (2.5):** `render/fx/coach.ts` keeps its label clear of the HUD band (`HUD_BOTTOM` = 128 px), the Hire button (`ui.anchor('hire')`) and the hint caption. The M2 abilities bar and champion UI must register anchors too, or the coach label can land on them.
- **`DragonView.weakRadius()`:** new optional contract (world m). The M2 wyvern (clickable wings) and later species must implement it alongside `hitTest`, or the coach ring won't match the real hit area.

## Open issues and risks
1. **Real FPS: closed for M1.** The user's M1 playtest: "the framerate looks good" (their Mac, real play). Re-measure when M2 adds the zoom and music. History: the browser pane was hidden during every late check, which throttles rAF.
   - Synthetic numbers (the frame loop driven from JS, at 1440×900, DPR 2):
     - fresh start: 1.3–1.8 ms CPU avg, ~1.4 ms GPU;
     - dragon 20 with 85 units: 1.7 ms CPU, ~1.5–2 ms GPU;
     - a 41 m breath with 300 knights and 1,480 particles: 3.7 ms CPU (p99 6.1), ~5–8 ms GPU.
   - Nothing points below 60 fps, but confirm with `?debug` in a visible pane. The user's playtest is the first real reading, so ask them.
2. **Safari and Firefox: the user tested M1 in several browsers with no issues** (2026-09-23). M4.4 still does the final pass. Known risks to recheck as M2+ adds load:
   - Safari rasterizes canvas on the CPU; the backdrop is ~5.3 screens of fill per frame.
   - Film grain is a full-screen `mix-blend-mode: overlay` CSS layer (`src/render/fx/grain.ts`); the fallback is plain opacity.
   - WebAudio in Safari.
3. **Canvas memory** at DPR 2:
   - backdrop ~57 MB;
   - crowd sprites 27 MB typical, 43 MB at dragon 12 after the LOD bump, 64 MB cap;
   - numbers ≤ 8 MB;
   - so ~100–130 MB in total. Watch Safari.
4. **Size: the limit is now 2 MB raw** (the user raised it from 1 MB on 2026-09-23; the size guard hard-fails at 2,000,000 bytes and warns at 1,500,000). Measured on the M2 working tree (source-map attribution, scratch script `attr.mjs`): **794 KB raw = JS 643 KB + fonts 100 KB + CSS 50 KB** (Vite 8's default Oxc minifier; CSS minified too), ~350 KB gzipped. JS by folder: dragon 101, backdrop 92, crowd 62, audio 57, core 51, ui 50, zoom 47, music 45, fx 39, heraldry 33, other render 21, app 21, break_infinity 16, lib 5 KB. Largest files: `dragon/rig.ts` 27 KB, `text.ts` 20, `dragon/paint.ts` 19, `backdrop/worldWyrm.ts` 17, `sfx.ts` 16, `zoom/cinematic.ts` 15. Dev-only code that ships: 14.5 KB (`app/debug*.ts`, `zoom/standin.ts`, `zoom/debug.ts`); no lab, gallery, measure or sim code ships.
   - Headroom is now ~1.2 MB for M3 + M4, so size is no longer the strategic risk. Still prefer data-driven tiers (parameter sets on shared generators) for M3/M4, and drop `zoom/standin.ts` once the real pieces land.
   - A 2 MB raw file is ~650 KB gzipped (fonts don't compress), so the "transfer size < 1 MB" reading of the prompt still holds; the size guard prints the gzip size.
   - Shelved (no longer needed): shipping the JS+CSS deflate-compressed inside `index.html` with `DecompressionStream`.
5. **Juice costs logic time** by design (a consistent freeze). If you change the juice tuning, keep `src/sim/juice.ts` in sync with `src/render/fx/tuning.ts`; the sim imports the exported constants.
6. **Saves:** there's no save loader yet (M3). Saves are schema v3; older versions are rejected.
7. **GitHub: live.** Public repo https://github.com/pincombe/scale (created by the user on 2026-09-23; the lead's `gh repo create --public` was blocked by the auto-mode classifier). Pages source = GitHub Actions; the game deploys to https://pincombe.github.io/scale/ on every push to main. The first CI and Pages runs (943c765) passed and the page served the 436,827-byte build. The user won't share the URL until M4. `origin` = `git@github.com:pincombe/scale.git`; commits use the no-reply email. Push after each accepted WP or at hand-off.
8. **Dev pages:** `src/render/dragon/lab.html` and `src/render/crowd/gallery.html` are dev-only and not in the build. Keep or delete them at M4.
9. **Agent tooling:** the shared browser pane is often hidden, which stalls rAF, and automation clicks land wrong under viewport emulation. Agents should verify on static builds, dispatch PointerEvents, and step frames from JS for measurements (see Process notes).

## Approaches tried and dropped (don't retry without a new reason)
- **Fonts:** all-variable fonts came to ~158 KB inlined, so EB Garamond is static 400 + italic only.
- **Post effects:**
  - The CSS vignette was dropped, because it dimmed the coins landing in the top-left gold counter. The vignette stays in the canvas; film grain moved to CSS.
  - Grain animating `background-position` repainted the viewport, so it now animates `transform`.
- **Particles:** `particles.screen` on scaled time plus an fx "top-up" was replaced by the real clock.
- **Juice:** the skeleton stub's hit-stop fired on every strike, and the first crit juice did hit-stop, kick and flash on every crit (at 8 crits/s: 23% of frames frozen, constant shake, repeated full-screen flashes). Replaced by "crit heat" and no crit flash.
- **Text:**
  - Flat `DRAGON_NAMES`/`DRAGON_EPITHETS` lists were replaced by the composable `dragonName()` generator.
  - The title tagline "Every dragon is a scale on a bigger dragon." would spoil the Zoom; it's reserved for the zoom card.
- **Dragon rig:**
  - An over-the-head tail slam doesn't work for a newt (the tail is too short), so the swipe became a turnaround lash.
  - A 16 px weak-spot minimum made nearly every click on a newt a crit, so the minimum is now 11 px and the scale sits off-center.
- **Backdrop:** the eye on a far hill at `WYRM_EYE_X = -3.5` ended up behind the army, so it moved to the valley wall right of the sun, higher and 1.75× bigger.
- **Sim:** the bot originally assumed the loose scale stays hittable during windups and while the dragon enters. That's wrong, and it led to 1.9b.
- **First-minute teaching:** bottom-of-stage captions for the weak spot and the stagger (`hintWeakSpot`, `hintStagger`) didn't teach: they were far from the spot, read as flavor, and the first-kill and hire captions replaced them within ~2 s. Replaced by the anchored coach marks (1.11). The other captions (first kill, hire, army, growth) stay.
- **Eye in the hills:** a crisp full-DPR vector eye with a dark outline on the soft DPR-1 layer read as a sticker. It now draws into a DPR-1 buffer, in the layer's haze, inside a head carved into the ridge (1.12). Steam from the nostril was tried and removed: the nostril sits on the sun's edge, and even opaque dark puffs were washed out by the sun's bloom.
- **Browser verification:** the shared dev server with HMR churn made visual checks unreliable while six agents edited. Agents moved to static builds or private Vite servers. Caveat: a private server on another port re-optimized the shared `node_modules/.vite` cache once. Give private servers their own `cacheDir`.

## Playtest feedback
- **M1 ★ (handed over 2026-09-23; feedback received 2026-09-23).** Close to verbatim, with a status per item:
  1. "The framerate looks good." → **done** (closes Open issue 1 for Chrome on the user's Mac).
  2. The 0:40–1:30 stretch (small newt, big knights): "the amount of time is fine." → **won't change**; the framing options in Observations are shelved.
  3. "The weak spot is clear but takes a few accidental clicks to understand the mechanic." → **done in WP 1.11 (a423526)**. Lead's diagnosis: `hintWeakSpot` was a bottom caption, far from the spot, that read as flavor text and was replaced by the first-kill/hire captions within ~2 s; `hintStagger` was a caption during a 1.2 s windup. Fix: a coach mark anchored on the live weak spot, a "Weak spot ×5" cause caption on the first crits, and a stagger coach on early windups.
  4. "The eye in the mountain stands out as not blending with the background and instead looking randomly stuck there." → **done in WP 1.12 (9a0b8d2)**. Lead's look: a large (~160×60 px at 1440×900) crisp, saturated almond with a hard dark outline and a black pupil on a flat, hazy DPR-1 mountain face; no brow, lids or head read around it; it first opened at the 3rd kill (~0:15), before any context. Fix: carve it into the rock under a brow, haze it like its layer, smaller, the head readable when open, small life touches, and the first opening moved to the PLAN §2 beat (~2:00–2:30 engaged).
  5. "The game sounds great." → **done**; no audio changes.
  6. "I've tested in multiple browsers and it appears to work without issue." → **done** (Open issue 2 is closed for M1; M4.4 still does a final cross-browser pass).
  7. "It's fine to upload it now. I won't share it until M4." → **done**: the user created the public repo and enabled Pages; the lead added `origin` and pushed main (see Open issue 7).

## Art direction (lead's notes)
**The look** (PLAN §4)
- Painted-sky silhouettes. Knights and dragons are near-black warm silhouettes with a rim light on the edge facing `palette.light`. Never skip the rim light.
- Color only where it matters: banners and heraldry, eyes, fire, gold, weak spots and UI.
- Weak spot: white-hot core and cyan halo, pulsing. It reads against both black silhouettes and a gold sky.
- Everything is vector or procedural and must stay crisp through the zoom.
- The standard is "premium or it's not done": iterate on screenshots at 1440×900.

**Meadow palette** (finalized by 1.1)
- The sun sits at (`stageCX + 0.27·H`, `0.56·H`), and `light = unit(0.85, −0.53)` points at it.
- Optional `depthTint` field.
- Five parallax layers: mountains, the wyrm hill (the eye), windmill hills, a tree line with castle and village, and near hills.
- Swaying foreground grass and dandelions, fireflies, pollen and birds, all driven by a shared `backdrop/wind.ts` that the crowd could also use for banners.

**Framing (director)**
- Base framing puts the hero at 20% of stage height. Big dragons fill ~40–44% of the stage width, and the ground is pinned at 76% of the height.
- The camera pulls back up to ~11× (a 77 m dragon), and the backdrop holds across that range.

**Juice tuning** (after its review)
- Crits: 0.07 s hit-stop, and only after 0.6 s without crits. "Crit heat" damps shake and kick during sprees. No crit flash.
- Stagger: 0.08 s hit-stop.
- Kill: 0.08 s hit-stop plus `slowMo(0.25, 0.55)`, a warm flash and a coin fountain that lands 0.76–1.28 s later.
- Kick strengths: crit 0.55, stagger 0.8, kill 1.
- Film grain is a CSS overlay; the vignette stays in the canvas so coins aren't dimmed.

**Audio**
- Everything is in D major pentatonic: coins climb D5→A6, clang roots are pentatonic, chimes too. M2 music should agree or modulate from it.
- Loudness tiers: army and coins ~−32 LUFS, clicks and dragon ~−23, big moments ~−17, ambience −40 to −47.

**Title**
- A huge SCALE in Cinzel over the live meadow, the tagline "An epic of ever-increasing proportions.", and "Click to draw your sword."
- The zoom title card owns "Every dragon is a scale on a bigger dragon."

**To judge at the integration pass**
- Newt readability at the start (item 5 above).
- Weak-spot readability versus the chance of a crit.
- Number clutter.
- Whether the eye is subtle or unnoticeable.
- Whether the foreground is too busy.
- Crowd readability at ~15 px.
- The kill moment.
- Restraint during crit sprees.
- Whether the first minute really follows the §2 beats.

## M1 design reference (lead decisions)
**Units** (tier 0)
- **Footman:** melee, strikes in beats about once a second. Available after the first kill; a lone "Hire a Footman" button pulses.
- **Archer:** volleys every ~2.5 s with ~1.1 s of flight. Unlocks at 12 kills, around 1:00 for an engaged player.
- Costs grow ×1.12 (footman) and ×1.13 (archer) per purchase. Milestones ×2 at 10/25/50/100 owned, then every 100 after 500.

**Upgrades** (ids fixed; costs and unlocks tuned by the sim)

| Upgrade | Effect |
|---|---|
| pointySwords | click ×2 |
| drillSergeant | footman ×2 |
| keenEye | weak-spot crit ×5 → ×10 |
| fletching | archer ×2 |
| bounty | kill gold ×1.5 |
| warHorns | all army ×1.5 |
| heroicExample | each click also deals a share of army DPS |
| quickNock | archer volley period ×0.7 |
| grindstone | click ×3 |

**Clicks**
- Clicking anywhere strikes. The weak spot crits ×5 (×10 with keenEye).
- A weak-spot hit during a windup staggers: 2 s stun, army damage ×2, and a gold bonus (50% of the kill reward on the first stagger per dragon).

**Pacing targets** (engaged: 6 clicks/s, 30% weak spots)
- First kill ≤ 5 s. First footman ≤ 15 s. First upgrade visible ≤ 35 s. Archers at 50–75 s.
- Dragon size (0.5 × 1.12^kills): engaged ~1.7 m at 1:00, ~4.8 m at 2:00, ~12.7 m at 3:00; ≤ 32 kills by 3:15.
- Non-aimer (5 clicks/s, never hits the weak spot): ≤ ~9 s per kill in 0:40–2:00.
- Never more than 30 s with nothing affordable. Casual gets the same beats later. Idle never gets stuck.
- The M2 boss will be summoned by kill count (Wyrm Gauge), not by the clock.

**Flags**
- Progressive-disclosure flags: `feature.dragonBar`, `feature.gold`, `unit.footman`, `feature.panel`, `upgrade.<id>`, `unit.archer`. The full list is in ARCHITECTURE §4.

**Text**
- All text lives in `src/core/content/text.ts` (`UNIT_TEXT`, `UPGRADE_TEXT`, `dragonName(rand, species, index)`, `sizeWord`, `MICROCOPY`).
- The UI generates effect lines from data; flavor text never restates the effect.

## M2 design reference (lead decisions, 2026-09-23)
**The judge's first 8 minutes (target, engaged):** M1's beats to ~2:00 · the gauge appears (~1:00) · Ser Aldric joins (~2:00) · the eye opens (gauge-tied, ~2:15–2:45, with a time fallback so every player sees it before the boss) · gauge full → the Elder Newt (horn, darkened sky, 30 s timer) ~3:00–3:15 · boss falls → **the first zoom plays by itself** ~3:30 · the Mountain: the colossus stands alone, Heraldry opens with Scales to spend, Charge! and Rally unlock, wyverns glide in · lancers ~4:30 · Dame Brunhild ~5:30 · Dragonbane Volley ~5:00 · Grimmaw ~7:00 → beaten ~7:30 → the Zoom button offers the Kingdom ("next build" in M2).

**Rules** (ARCHITECTURE §14 has the contract)
- **Upgrades persist through zooms**; each tier adds its own set (no re-buying Pointier Swords). Gold, units, kills and the gauge reset; champions, heraldry, Scales and flags persist.
- **The first zoom of a save starts by itself** when the first boss's death finishes. Later zooms are the player's choice (push further = more Scales and a bigger Fusion Bonus).
- **Bosses:** timer ~30 s while hittable; on timeout the boss leaves (new `leave` phase), the gauge drops back to ~75%, ordinary dragons resume. No dead end.
- **Heraldry v1:** lion (damage), sun (gold), wyvern (crits), stag (cooldowns), tower (starting troops), crown (Fusion Bonus). Eagle and moon come with golden dragons and offline progress (M3); seneschal and herald with automation (M3).
- **Abilities on keys 1–3:** Charge! (army ×N), Rally (auto-strikes), Dragonbane Volley (one huge volley). Key 4 stays free.
- **M2 ends at Grimmaw.** The Zoom button then says the Kingdom arrives in the next build; that's a milestone boundary, not placeholder art.

**The zoom's art direction** (the brief for 2.1; PLAN §4.5)
- **Geometry:** one continuous exponential pull-back by exactly the knight-height ratio (e.g. 1.8 m → ~200 m ≈ ×111). The colossus is that many times a meadow knight, so in the meadow's own framing its boots fill the screen; at the end it's the Mountain's hero at the base framing, and the meadow snapshot is one small scale near its feet. Scale the snapshot about a focal point that moves smoothly to its final spot.
- **Beats:** the boss falls (music drops out) → rally (~1 s: horn, knights rush in with banners high, the ground trembles) → fusion (~1.2 s: the pile rises and glows, flash, sub hit) → boots fill the screen → pull-back (~4 s: greaves, tabard with the coat of arms, helm and plume; the meadow shrinks into a scale; neighboring scales; the flank; the flank's top edge is the ridge line the colossus stands on; the dorsal spines are the range) → reveal (~1.5 s: the world wyrm's head rises over the ridge, its eye opens, it roars; snow slides off the peaks) → card: **II · THE MOUNTAIN**, then *Every dragon is a scale on a bigger dragon.* → play resumes as the first wyvern glides in.
- **Who draws what:** the zoom owns the colossus (a high-detail vector knight matching the crowd hero, drawn direct at any size, never from the 2048 px hero buffer), the close-up hide and the snapshot. The Mountain backdrop owns the world wyrm's head (posed by the zoom through `wyrmPose`) and the scaly ground. The crowd owns rally and fusion (`rally`, `setFused`). The zoom must hand back to the live Mountain with no visible pop (the colossus becomes the crowd's hero at the same spot, size and pose).
- **Seams:** mist, streaks, the flash and motion hide them; no per-frame palette blending (the palette switches at `switch`, under cover).

**The Mountain (2.3):** alpenglow dusk. The range is the world wyrm's spine: dorsal plates as peaks, curving into the distance. The ground band is the wyrm's back, scaled. Knights are ~200 m tall, so clouds drift at their knees and pine forests are moss. The world wyrm's head rests at one end of the range: it's the Mountain's "eye in the hills" and the reveal's actor.

**Music (2.6):** D-centric, agreeing with the SFX's D major pentatonic. Meadow: lute and flute in D Mixolydian over a drone in fifths. Mountain: horns and drone (D Dorian). Boss: frame drum, timpani, horn stabs. Zoom: the music drops out at the boss's fall, a choir swell rises through the fusion, a sub hit on the flash, and the Mountain theme enters under the card. It sits under the SFX (never masks clicks).

**Size budget:** 445 KB at M2 start. M2 should land near 600 KB; investigate past 700 KB.

## Decisions
| Date | Decision |
|---|---|
| 2026-09-22 | Open questions answered: **single public repo** `pincombe/scale` → `pincombe.github.io/scale`. **No fixed deadline** (quality first). Nothing pushed yet; the lead asks before creating the public repo. |
| 2026-09-22 | Clicking anywhere on the stage strikes the current dragon (forgiving for judges). Clicking the glowing weak spot is the ×5 crit; the weak spot during a fire-breath windup also staggers. |
| 2026-09-22 | Stage layout: world units are tier-local meters, ground at y=0, +y down. Army on the left facing right, dragon on the right facing left. The camera frames dragon + army and pulls back as dragons grow. |
| 2026-09-22 | Core owns the dragon's behavior phases (enter/idle/windup/breath/swipe/stagger/dying) because rewards depend on them; render only animates them. Knights being flung is visual only. |
| 2026-09-22 | Army damage arrives as discrete, visible hits (melee beats, archer volleys with flight time), never as silent continuous drain. |
| 2026-09-22 | Size budget: hard fail at 1,000,000 bytes raw, warn at 500 KB. Fonts ≤ ~120 KB of the final HTML. |
| 2026-09-22 | Fonts: "Cinzel Variable" (400–900) for titles and numbers, "EB Garamond" 400 + italic only for body (98 KB inlined). No body bold: use Cinzel or italic for emphasis. |
| 2026-09-22 | M1 upgrade ids (lead design) as listed above. Text lives in `core/content/text.ts` (the economy WP owns its shape, the writer fills it). |
| 2026-09-22 | Coin/gold sync: gold is added to state instantly on a kill; coins carry exact Decimal shares and land within ~0.6–1.4 s; the HUD counts up over that window (pulse per coin, `onCoinLanded(count, value)`). |
| 2026-09-22 | Juice costs logic time (hit-stop and slow-mo scale the tick accumulator for a consistent freeze). TimeDirector caps a hit-stop at 0.12 s and ignores one within 0.3 s of the last; `time.dilation` debug watch; the sim models the dilation. |
| 2026-09-22 | Audio key: D major pentatonic for coins, clangs and chimes. |
| 2026-09-22 | 1.5 review sign-off: the weak-spot crit multiplies the whole strike, incl. the heroicExample share; clickMult applies to the whole strike; every dragon gets a short idle after entering; the stagger bonus is full only on the first stagger per dragon. |
| 2026-09-22 | Title tagline: "An epic of ever-increasing proportions." (the Zoom card keeps "Every dragon is a scale on a bigger dragon."). |
| 2026-09-22 | M2 zoom snapshot rule (infra): `renderer.drawScene(snapCtx, renderer.view, 0, WORLD_LAST)` of the outgoing tier *before* switching state, at the main view size; each layer draws inside save/restore; `director.enabled = false` hands the camera to the zoom director. |
| 2026-09-22 | Screen particles (coins) run on the real clock; world particles on scaled time. |
| 2026-09-22 | Toolchain: TypeScript 7.0.2, Vite 8.3, Vitest 5, tsx for the sim. CI on Node 24. Pages deploys via Actions. |
| 2026-09-23 | **Size limit raised to 2 MB raw** (user). `scripts/check-size.mjs` hard-fails at 2,000,000 bytes and warns at 1,500,000; CLAUDE.md, PLAN.md (§0, §7, §10), ARCHITECTURE §13, CI step names and the reviewer's checklist updated (2e1c2bf). The prompt's "Under 1mb" is read as transfer size (~650 KB gzipped at 2 MB raw). |

## Work packages

### M0: Foundations (done)
| WP | Agent | Status | Commit |
|---|---|---|---|
| 0.1 Scaffold: Vite + TS strict + singlefile + Vitest, fonts, npm scripts, size guard, launch.json | builder-medium | ✅ accepted | 52b595b |
| 0.2 Architecture skeleton + ARCHITECTURE.md | builder-max | ✅ accepted after review (no criticals; 3 majors fixed) | 81fdb06, 78b041d |
| 0.3 CI + Pages workflows (written, not pushed) | builder-medium | ✅ accepted | 52b595b |

### M1: First Blood ★ (done: closed 2026-09-23 after the playtest feedback)
| WP | Agent | Owns | Status | Commit |
|---|---|---|---|---|
| 1.1 Meadow backdrop, palette, eye in the hills | builder-high | `src/render/backdrop/**`, MEADOW values | ✅ accepted after review (1 high + 6 fixed) | aeeee92, b7f2b17 |
| 1.2 Dragon rig v1 + newt, weak spot, hit test | builder-max | `src/render/dragon/**` | ✅ accepted after review (1 high + 5 fixed, plus art notes) | 57a9402, 6544218 |
| 1.3 Knight crowd: sprites, formation, hero, reactions, banners | builder-high | `src/render/crowd/**` | ✅ accepted after review (2 high + 7 fixed) | 7376082, 04598dd |
| 1.4 Juice: presets, numbers, hit-stop, shake, coins, post FX | builder-high | `src/render/fx/**`, `post.ts` | ✅ accepted after review (1 high + 9 fixed) | fd76ef0, 82496a7 |
| 1.5 Economy core | builder-high | `src/core/**` | ✅ committed; review done, 5 fixes handed to 1.9 | 255c39e |
| 1.6 HUD, Army/Upgrades panels, title, progressive disclosure | builder-medium | `src/ui/**` | ✅ committed (no formal review) | 825e78f |
| 1.7 SFX v1 | builder-high | `src/audio/**` | ✅ accepted after review (2 high + 6 fixed) | 01fc25a, c0b831b |
| 1.8 Meadow text | writer | `src/core/content/text.ts` | ✅ committed | f7d020d |
| 1.9 Balance sim v0 + 5 core fixes (+1.9b fidelity, size-scaled phases) | builder-high | `src/sim/**`, `BALANCE`, core fixes | ✅ accepted after review (35/35 targets) | bfd6db1, 551f104, 2925c0f |
| 1.10 Framing and composition (dragon-first camera) | builder-high | `src/render/director.ts` | ✅ accepted (lead art pass) | 8086746 |
| M1 milestone review + pre-playtest fixes (faster early growth, non-aimer pacing, numbers never stack, hero stand-off, first-kill count-up, favicon) | reviewer + owners | — | ✅ done | 62cda8c, ab38393, fc39def, d9abb5f, dc2ed52 |
| 1.11 Teach the weak spot (M1 feedback 3): coach mark anchored on the live spot, "Weak spot ×5" cause caption on the first crits, stagger coach on early windups; `hintWeakSpot`/`hintStagger` captions retired | builder-high (+ writer pass) | `src/ui/hints.ts`, `src/ui/styles.css` (hint rules), `src/render/fx/**`, MICROCOPY in `text.ts` (+ narrow grants: `createHireButton` in `ui/hud.ts`, additive `DragonView.weakRadius()`) | ✅ accepted after review (1 high + 1 medium + 2 low fixed: a lethal first crit ate the caption; Hire keep-out measured mid-animation; DPR < 1 labels; hit-radius copy → `DragonView.weakRadius()`) + lead note (line 1 now 700 17px over italic 16px); writer pass done | a423526 |
| 1.12 The eye belongs to the mountain (M1 feedback 4): carved under a rock brow, hazed like its layer, smaller, the head readable when open, life touches, first opening at ~2:00–2:30 | builder-high | `src/render/backdrop/**` (+ MEADOW in `palette.ts`) | ✅ accepted after review (3 medium + 4 low fixed: art rebaked inside draw(); invisible tremor → 0.22/0.26; invisible steam → removed; the timing test moved into the sim as a target; hard pebbles; snout step; flock pop; face baked at the layer's 160 px/unit). New `wyrm.ts` + `eye.ts`; 0.75× size; first opening 2.2 s after kill 23 (engaged median 2:18); ~0.06–0.08 ms/frame open; narrow grant: `src/sim/play.ts`, `targets.ts` | 9a0b8d2 |

### M2: The Zoom ★ (in progress)
| WP | Agent | Owns | Needs | Status |
|---|---|---|---|---|
| 2.0 M2 core: tiers, gauge, bosses (+`leave`), zoom stages, Scales, Fusion, heraldry, abilities, champions, lancers, text shapes, save v4, debug ops; sim kept green | builder-high | `src/core/**`; `src/sim/**` only to keep targets green; M2 debug controls in `src/app/debugTools.ts`; ARCHITECTURE §4/§14 wording | contract (done) | ✅ accepted: 9ffe6c7 + review fixes d46e310 |
| 2.1A Zoom director prototype: snapshot, exponential pull-back, colossus, hide, hand-back; stops with key frames for review | builder-max | `src/render/zoom/**`, `src/ui/tierCard.ts` (+ its CSS), `setCinematic` in `src/ui/mount.ts`/`api.ts` | contract | ✅ checkpoint committed da67852; lead frame review done → Part B sent |
| 2.1B Zoom integration and polish: core stages, crowd rally/fuse, Mountain backdrop and world wyrm, beats for audio | builder-max (same agent if alive) | as 2.1A | 2.0, 2.3, 2.9 | 🔨 running (same agent): the meadow-as-a-scale reveal, the hide beat, pre-bakes, integration |
| 2.2 Boss and gauge juice: boss arrival (darkened sky, red vignette pulse), tremors by gauge, grand boss death into the zoom, the Meadow eye tied to the gauge + time fallback + `onEyeOpen` | builder-high | `src/render/fx/**`, `src/render/post.ts`, `backdrop/eyeTimeline.ts` (narrow) | 2.0, 2.3 | ✅ accepted: 2f7a512 (batch) |
| 2.3 Mountain backdrop: tier-aware backdrop, alpenglow palette, the range as the wyrm's spine, scaly ground, knee-high clouds, the world wyrm's head (`wyrmPose`), `setTransition`, memory per tier | builder-high | `src/render/backdrop/**` (not `eyeTimeline.ts`), `MOUNTAIN` in `src/render/palette.ts` | contract | ✅ accepted: 2f7a512 (batch; lead art check passed) |
| 2.4 Heraldry renderer: coat of arms from `state.heraldry`, charges as vector art, banners/shield bake, `createHeraldry` | builder-high | `src/render/heraldry/**`, `src/render/crowd/banner.ts`, the `Heraldry` type in `crowd/api.ts` | contract | ✅ accepted: 367e36a + fixes 2f019af (the hero's `ShieldArt` switch in `hero.ts` lands with 2.9) |
| 2.5 UI M2 (all of it, one agent for coherence): gauge that becomes the boss timer, boss bar and arrival card, Zoom button, abilities bar (1–3), Scales counter, the height headline, panel tabs Champions and Heraldry (big coat), M2 coach hints and toasts | builder-high | `src/ui/**` except `tierCard.ts` and `setCinematic` (2.1); `app/input.ts` onAbility | 2.0, 2.4 | ✅ accepted: 357459b + 4829da5 + af6c36d (Aldric portrait) |
| 2.6 Generative music engine v1 | builder-max | `src/audio/music/**` (engine.ts only if the music bus needs it: flag it) | contract | ✅ accepted: e04371d + fixes b2285de |
| 2.7 Sim: tier 0–1 pacing (zooms ~3:30 / ~7:30, casual < 5:00), tune `BALANCE` | builder-high | `src/sim/**`, `BALANCE` | 2.0 | ✅ accepted: 2f7a512 (batch): 72/72 targets |
| 2.8 Wyvern species and bosses: wings as forelegs, craggy plates, glide-in, wing hits + `weakRadius`, `leave`, Elder Newt and Grimmaw dressing, cache keyed by tier | builder-max | `src/render/dragon/**` | contract | ✅ accepted: 6b92d2f + fixes (planted gait, boss leave 2.6 s) |
| 2.9 Crowd M2: lancers (cavalry), champions (Aldric, Brunhild), ability reactions, `rally`/`setFused` | builder-high | `src/render/crowd/**` except `banner.ts` | 2.0, 2.4 | ✅ committed 066e378; review: one High → fix round in flight (same agent; adds `CrowdView.prepareTier?` for the zoom) |
| 2.10 SFX v2: boss horn, tremors, the eye's rumble, zoom beats, abilities, lancers, champions, heraldry | builder-high | `src/audio/sfx*.ts`, `src/audio/synth/**` | 2.0, 2.1A beats | ✅ accepted: a77d602 + 2f7a512 (batch) |
| 2.11 M2 text: tier cards, bosses, champions, charges, abilities, lancer, tier-1 upgrades, height words, microcopy | writer | `src/core/content/text.ts` | 2.0 | ✅ committed 9996f5e |

## Process notes (how this build runs)
**Agents and reviews**
- The lead plans, briefs, verifies and commits. Builders implement, and each owns one folder.
- Every max or high WP gets a `reviewer` pass before it's accepted. Findings go back to the WP's agent, or to a new builder if that agent is gone.

**Parallel work**
- Six agents shared one working tree, one folder each. `api.ts` files are additive-only contracts; `index.ts` factories can be replaced.
- Agents ignore typecheck errors in other folders and never touch git.
- The lead commits each WP's folder separately with `git add <folder>`. Never `git add -A` while others are mid-edit.

**Browser testing**
- The dev server (`preview_start` name `dev`, port 5173) is shared. HMR from other agents made visual checks flaky, so agents verified on static builds. For judge-like checks, build and serve `dist/` (launch config `preview`, port 4173), or build to a scratch dir.
- The browser pane is narrow and portrait by default. `resize_window` 1440×900 works for screenshots, **but with emulation on, automation clicks land at wrong coordinates**. Dispatch `PointerEvent('pointerdown', {clientX, clientY, button: 0, bubbles: true})` on `#stage` via `javascript_tool`, or drive `window.__scale` (`?debug`). Use your own tab and close it afterwards.
- **Lead snapshot server** (added 2026-09-23): the launch config `snapshot` serves `.vite/snapshot/` (gitignored) on port 4180. To look at one WP while others are mid-edit, copy the tree to the scratchpad, restore the other WPs' folders from HEAD (`git archive HEAD <folder> | tar -x -C <copy>`), symlink `node_modules`, run `npx vite build --outDir <repo>/.vite/snapshot --emptyOutDir` from the copy, then `preview_start` name `snapshot`.
- **Pane quirks found 2026-09-23:**
  - `navigate` to a `file://` URL opens a *new* tab and loads the page as a `data:` snapshot, which drops the query string (no `?debug`). Serve over HTTP instead.
  - A fresh tab from `preview_start` sometimes paints the page into a small top-left corner under 1440×900 emulation. An older tab navigated to the same URL, then `resize_window` again, rendered correctly.
  - `resize_window` before `navigate` can be lost: resize after navigating.
  - A background tab reports `document.hidden = true`, so CSS transitions (the title fade) don't run. The game canvas still renders for screenshots.

**Debug**
- `?debug` has URL params: `seed dragon footman archer gold speed pause loop immortal phase attack panel layers stress`.
- There are hotkeys, an FPS/CPU readout, a `dilation` watch and layer toggles (ARCHITECTURE §10, §13).

**Briefs**
- M1 briefs lived in the lead's session scratchpad and may be gone. This file carries their essentials.
- For M2 briefs, give each agent:
  - the goal and the PLAN sections to read
  - the files it owns
  - the frozen interfaces
  - the acceptance criteria and how to verify them
  - the parallel-work rules and browser quirk above
  - a ~200-word report format

## Next steps
**M2 The Zoom ★** (in progress; see M2 plan and the M2 WP table)
1. Wave 1 in flight: 2.0 core, 2.1A zoom prototype, 2.3 Mountain backdrop, 2.4 heraldry renderer, 2.6 music, 2.8 wyvern and bosses.
2. When 2.0 lands: review it, commit, launch wave 2 (2.2, 2.5, 2.7, 2.9, 2.10, 2.11).
3. When 2.1A reports: the lead's art review of its key frames, then 2.1B.
4. Wave 3: integration, reviews, milestone review, lead art pass at 1440×900, then the ★ hand-off.

## Log
- 2026-09-22: Kickoff. Open questions answered. Git initialized, plan committed (4403f84).
- 2026-09-22: 0.1 scaffold + 0.3 CI accepted, `npm run check` green, build 103 KB (52b595b).
- 2026-09-22: 0.2 skeleton landed: 66 tests, 191 KB build, 60 fps at 300 stub knights + 1,490 particles (1.5 ms CPU) (81fdb06). Review: no criticals; infra fixes (78b041d).
- 2026-09-22: 1.5 economy (255c39e): 139 tests; engaged first kill 1 s, archers ~55 s, 1/2.5/10 m at 1/2/3 min, 28 kills by 3:15. Review: logic correct; 5 balance/feel fixes handed to 1.9.
- 2026-09-22: 1.7 SFX (01fc25a), metered offline. Review: 2 high (fire breath never played; crits often silent) + 6 fixed (c0b831b); storm test peaks ~544 live nodes.
- 2026-09-22: 1.4 juice (fd76ef0). Review: crit spam was an earthquake and a flash hazard. Fixed with crit heat, merged numbers, capped canvas memory, exact coin values, compositor grain (82496a7); frozen frames at 8 crits/s down from 23% to 1.6%.
- 2026-09-22: 1.8 text (f7d020d), 1.6 HUD (825e78f), 1.1 backdrop (aeeee92) committed. BUILD_LOG rewritten as a resume document (c6fab8c).
- 2026-09-22: 1.9 sim (bfd6db1): 30/30 targets PASS on juiced runs over 20 seeds (engaged: first kill 2 s, archers 0:56, 1.0/2.3/8.4 m at 1/2/3 min, 29 kills by 3:15, 10.5 attacks seen, clicks 46% of damage; dilation 0.92). `npm test` green again.
- 2026-09-22: 1.3 crowd (7376082): rim-lit knights at 4 LODs, live hero, march-ins, volleys, flee/ragdoll lanes, cheers, banners with `drawEmblem()` for M2 heraldry; 0.5–0.8 ms/frame at 300 knights.
- 2026-09-22: 1.1 review: premium look, fast in Chrome (back 0.17 ms CPU + ~1.2 ms GPU); the eye was hidden behind the army. Fixed (b7f2b17): eye above the banner band, fill −31%, memory 128 → 55 MB.
- 2026-09-22: 1.3 review: 2 high (squad teleport at 300; invisible marching recruits) + memory, hero timing, rig-synced reactions and feel notes; fixes in flight.
- 2026-09-22: The user added KICKOFF rule 8 (hand-off between milestones): after the ★ feedback is dealt with, let agents finish, bring BUILD_LOG fully up to date, commit, tell the user, and stop. The next milestone starts in a new session (cd7ef7c).
- 2026-09-22: 1.2 dragon rig (57a9402): data-driven species rig, newt 0.5 → 40 m, all phases, throat/tail windup weak spots, 60–230 µs/frame. Review launched. WP 1.9b launched.
- 2026-09-22: Crowd review fixes landed (04598dd): memory 60 → 27 MB typical, no squad teleport, visible recruits, hero contact 72 ms, rig-synced flings. Lead art pass on a static build: title great, first-kill flow works, late game premium; the dragon is too small at the start and in minutes 1–2 (framing). WP 1.10 framing launched; kill-blob/number-glyph notes to juice; mountain polish to backdrop.
- 2026-09-22: Backdrop polish (b550de5): painterly receding mountains; layers sized from screen height so the closer framing doesn't rescale them. Juice polish (b6f9d4f): kill burst scales with dragon size (no white blob); numbers crisp and above the sparks (the "broken glyphs" were spark streaks). WP 1.9b (551f104): weak-spot liveness in core, 35/35 sim targets.
- 2026-09-22: WP 1.10 framing (8086746): hero 29% of stage height, clash point ~40%, dragon share of width 25% → 44% from 1 m to 10 m (capped by the base framing until ~3 m), crowd LODs raised. Polish round sent: crowd gap, HUD toasts, size-scaled enter/dying.
- 2026-09-22: 1.2 review: good shape, within budget (draw 0.06–0.11 ms); 1 high (swipe tail target on top of the scale) + 5 lower. Fix round sent with art notes; grass clearing sent to backdrop. M2 extensibility notes recorded.
- 2026-09-23: Polish round landed: crowd gap (c544733), grass clearing (ecfa2ff), premium toasts (d6ab8fc), size-scaled enter/dying (2925c0f), dragon fix round incl. presence at 1–3 m and big-dragon cues (6544218). Lead spot check on a static build: title, first kill, Hire button, dragon-12 composition and dragon-20 fire breath look good. M1 milestone review launched.
- 2026-09-23: M1 milestone review: no blockers; console clean over 2.5 min of play; only one network request (the page); synthetic CPU 1.3–3.7 ms avg per frame (the pane was hidden, so no real FPS). Feel: minute one hooks (title, first strike, first kill); weakest stretch 0:40–2:00 for non-aimers (10–14 s per kill, small dragon, empty right half); most impressive: the eye opening in the hills at ~2:30, then the 41 m breath. The ?debug-only "Hire button and panel together" glitch can't happen in normal play. Fix round sent (sim, juice, crowd, HUD); favicon added.
- 2026-09-23: Pre-playtest fixes landed: first-kill gold counts up from 0 (62cda8c), numbers never stack (ab38393), the hero never hides the newt (fc39def), size curve 0.5 × 1.12^i plus a non-aimer profile at 8.9 s per kill (39/39 targets; goldPerHp 0.9 → 1.2, archers at 12 kills), favicon. `npm run check` green (237 tests), 427 KB. **M1 ★ playtest build handed to the user.**
- 2026-09-23: New lead session. `npm run check` green at 943c765 (237 tests, 427 KB). M1 ★ feedback received: FPS good, 0:40–1:30 pacing fine, sound great, works in several browsers; the weak spot takes accidental clicks to understand; the eye looks stuck on; upload to GitHub now (not shared until M4). WP 1.11 (teach the weak spot) and WP 1.12 (eye integration + first opening at ~2:00–2:30) launched in parallel. `gh repo create --public` was blocked by the permission classifier; the user will run it or re-confirm.
- 2026-09-23: WP 1.11 accepted (a423526). Review: a lethal first crit ate the "Weak spot ×5" caption (now only shown captions count), the Hire keep-out was measured mid-animation (static wrapper anchor), DPR < 1 labels, and the hit-radius copy became `DragonView.weakRadius()`. Lead note: line 1 of the coach now dominates (700 17px). Writer strings: "Strike where it glows" / "×5 damage. It's a sore spot."; "Strike now!" / "Interrupt it for bonus gold"; "Weak spot ×5".
- 2026-09-23: WP 1.12 accepted (9a0b8d2). The valley wall is a sleeping stone wyrm's head; the eye is soft, hazed and carved under a brow, first opening at 2:18 (engaged median). Review fixes: side-effect-free draw, a felt tremor, steam removed, the timing test moved into the sim (40/40), soft pebbles, a smooth snout, no flock pop. Lead art check at 1440×900 and at 3.3× magnification: premium.
- 2026-09-23: Repo live. The user created `pincombe/scale` (public) and enabled Pages; the lead added `origin` and pushed. First CI and Pages runs passed. Added the `snapshot` launch config (port 4180, `.vite/snapshot/`) for lead checks. **M1 closed; hand-off per KICKOFF rule 8.** M2 starts in a new session.
- 2026-09-23: Third lead session (M2). Baseline green at 8301c92 (261 tests, sim 40/40, 445 KB). The lead wrote the M2 contract skeleton: `core/types.ts` schema v4 (tiers, wyrm gauge, `leave`, zoom stages, Scales, heraldry, abilities, champions), stub folders `render/zoom` (auto-completes zooms until 2.1), `render/heraldry`, `audio/music`, `render/backdrop/api.ts`, the `zoom` layer slot 5, `paletteFor(tier)` with a placeholder MOUNTAIN, `CrowdView.rally/setFused`, `Ui.setCinematic`, ARCHITECTURE §14. M2 plan and WPs written; wave 1 launched.
- 2026-09-23: WP 2.0 core committed (9ffe6c7): 328 tests, sim 40/40; engaged Elder Newt 3:07, first zoom 3:20, Grimmaw 7:04; casual first zoom 5:02 (PLAN wants < 5:00: 2.7). First zoom: 6 Scales, Fusion ×2.1, 224 m. Decisions by 2.0: champion blows ride the footmen's beat (new `championHit` event) and don't scale by tier; Mountain HP ×150, gold ×60, costs ×60; boss HP ×2 of dragon #30, fixed per tier; Mountain upgrades `highForge`, `pikeWall`, `yewLongbows`, `mountainTithe`, `couchedLances`, `destriers`; `armyHit`/`volley` gain `ability?`. No `feature.gauge` flag: the UI shows the gauge from ~8 Meadow kills. Reviewer launched on 2.0; its fixes go back to the 2.0 agent, then 2.7 runs. Wave 2 launched: 2.2, 2.5, 2.9, 2.10, 2.11.
- 2026-09-23: WP 2.4 heraldry committed (367e36a): `coatOf` tested over all 1,956 orders; nine charges (eagle and crescent ready for M3) on heater/banner/kite; banners re-bake ~1–2 ms; the hero shield bakes at 6 px/unit. Lead art check in the gallery: the charges are real heraldry and a late coat reads as a full achievement. Known limit: nothing new appears past level 6 (fine for M2; revisit in M4). `drawCoat` rebuilds gradients per call: callers redraw only on change.
- 2026-09-23: 2.0 review: logic mostly verified (stage machine, hold, rewards once, auto-begin gating, boss clock, determinism). Two High: (1) a hidden tab can freeze the first zoom (the auto `zoomBegin` is dropped during `catchUp`) → the zoom director reconciles from state on `resync` (sent to 2.1); (2) the refill after a boss escape grows past the boss, so casual and nonAimer never beat Grimmaw → refill replays the pre-boss indices. Medium: the Volley can be wasted between dragons; champions do 0.3–3% of the damage. Low: Tower/Crown pay nothing in M2 (Tower now grants troops at once; Crown labeled "next zoom"); `end` emits no `dragonPhase enter`; the cooldown bar stalls on Stag; Rally's auto-strikes carry x = y = 0 (render uses `impactPoint`: sent to 2.2, 2.8, 2.9). Core fixes went back to the 2.0 agent; sim blind spots (the dead-end detector stops at 4:00; the Grimmaw margin only for engaged; Mountain clicks are 73% of damage) go to 2.7.
- 2026-09-23: WP 2.11 text committed (9996f5e): "The Elder Newt falls. Far beneath the meadow, something much larger rolls over."; Brunhild's special is the Hundred-League Swing; a 22-rung height ladder to 90 billion ly; real blazons. The UI shows one champion toast (the `join` line).
- 2026-09-23: 2.4 review: correct, fast, no per-frame cost, premium up close; but most level-ups don't show on the army at play distances (distant banner: L2 0–33 px changed, L4/L6 0 px), the hero's shield face shimmers (a fixed 6 px/unit bake shrunk up to 19×), small charges become ink blobs, and `drawCoat` sets absolute `globalAlpha`. Fix round sent to the 2.4 agent: every purchase must change the distant banner, plus a gold flourish across the banners on change, shield LODs, no outlines on tiny charges, alpha multiplied.
- 2026-09-23: 2.0 fix round committed (d46e310): the escape refill replays the pre-boss dragons; the Volley is ready only while the dragon can be hit; champions deal a share of max HP (mastery at level 15; engaged ~7% Meadow / ~16% Mountain; casual 16% / 34%); Tower grants troops at once; `end` emits `dragonPhase enter`; `AbilityState.cooldownDur`; §14 documents stage events, reconcile-on-resync and auto strikes. Everyone beats Grimmaw first try (engaged 7.5 min, casual 12.9, nonAimer 12.2). 2.2's sim edits (eye schedule, boss juice) stayed out of the commit (they depend on 2.2's uncommitted files); `play.ts` also holds 2.0's `onEvent` hook and goes in with 2.2. WP 2.7 launched with M2 pacing targets (see its row).
- 2026-09-23: WP 2.2 done: storm-dark sky with a blood-red horizon and a heartbeat vignette on the boss's arrival, a push and shockwave when its timer starts, a faster heartbeat in the last 10 s, a long slow-mo fall (0.12 for 1.8 s; hit-stop capped at 0.08 s), tremors 0.45 s after kills at gauge^1.8, the Meadow eye first opening at gauge 0.7 (not before 2:00, fallback 2:45; engaged 2:11, casual 2:53) and watching every boss fight; Rally strikes placed on the body; `FxApi.onHeartbeat?`. Held uncommitted: `eyeTimeline.ts`'s new API is used by 2.3's uncommitted `meadow.ts`/`eye.ts`, and its sim edits share files with 2.7. Risks: two full-screen compositing passes during boss fights (one `'saturation'`: check Safari), the tremor writes camera shake fields from fx, the Mountain's boss sky may be too dark. Review launched.
- 2026-09-23: **Size watch** (superseded the same day, when the user raised the limit to 2 MB): the working-tree build is 792 KB raw (445 KB at M2 start; M2 target was ~600 KB). Source grew ~1 MB (render +516 KB: zoom 120, backdrop +130, dragon +87, heraldry 82, crowd +66; audio +183 incl. music 120; core +78; ui +75). A runner is measuring bundle bytes per source file (and whether debug/lab/measure code ships). M3/M4 add eight tiers, so M2 must leave room: aim to finish M2 ≤ ~700 KB.
- 2026-09-23: **The user raised the size limit to 2 MB raw** (2e1c2bf): size guard, CLAUDE.md, PLAN.md, ARCHITECTURE, CI step names and the reviewer's checklist updated; the compressed-payload fallback is shelved.
- 2026-09-23: WP 2.10 SFX v2 committed (a77d602, with 2.1's optional `ZoomApi.time`/`beatTimes`): boss horn and ground hit (−16.7 LUFS), last-10-s tick-tock, mocking escape, the biggest death (−15.1), tremors −43 → −24 by gauge, the eye's stone grinding, all eight zoom beats, abilities (Rally's auto-strikes thinned to ~4.5/s), lancers, champions, heraldry seal, Scales shimmer; peak 476 nodes. Not yet heard against the real zoom director. HEAD verified in a throwaway worktree: typecheck clean, 342 tests, build 537 KB. Review launched.
- 2026-09-23: 2.4 fix round committed (2f019af): a new level ladder (L2 per pale, L3 semé + coloured crown, L4 quarterly, L5 per saltire, L6–L8 gyronny + damask) changes 11–56% of the distant banner's principal per purchase; a gold sweep across banners and the shield on every purchase; `ShieldArt` with four detail levels (6, 2.4, 1, 0.4 px/unit); no outlines on tiny charges; alpha multiplied. Its `hero.ts` edits are interleaved with 2.9's WIP, so they commit with 2.9. HEAD verified in a worktree (345 tests, 540 KB). **2.4 accepted.**
- 2026-09-23: 2.10 review: accept; events handled once, hooks and node lifetimes sound, M1 unchanged. Fixes sent back: Rally's clangs came out as uneven pairs (~2/s) and ~19% of champion blows were dropped (voice limits), the eye's growl stacks on the boss's arrival (skip while a boss is up; quieter Mountain repeats), the Scales shimmer is buried under the flash, a stuck `inZoom` flag after aborted zooms, the fusion rise's timing, a stray boss-clock tick. Process note: the browser pane caps preview servers at 5 concurrent; reviewers serve with a background `npx vite preview` on their own port instead.
- 2026-09-23: WP 2.3 Mountain done: `meadow.ts` (the old backdrop, unchanged, pixel-identical) + a tier switch that frees the other tier's canvases; Mountain 52.8 MB, back layer 0.43 ms (Meadow 0.38); `drawHide`/`hideScaleAt` on `BackdropApi` for the zoom (a scale near the feet holds a whole Meadow view after a ×100–120 pull-back); `J` plays the reveal. Lead art check at 1440×900: the alpenglow palette, the cloud sea and the rearing world wyrm (a hazy rim-lit head with a glowing eye and roaring jaw, part of the landscape) are premium; the pulled-back framing holds. Polish note: the scaly ground is a flat, even band (more curvature and snow in the crevices later). Held uncommitted with 2.2 and 2.7 (eye schedule and sim files are shared).
- 2026-09-23: 2.2 review: no correctness blockers; the fall breaking into a warm flash is the best moment. Fixes sent back: the grade darkens the whole world (the weak spot turns dull pink in the fight where aiming matters most) → draw it under the dragon via a backdrop hook; drop the `'saturation'` blend (Safari/Firefox risk); the tremor sway peaks ~1.35 px (make it roll, move it into `Camera`); flat shockwave discs in the grass; boss embers spill into the zoom; a heartbeat that can stick; the Mountain's grade too dark. The SFX agent subscribes to `onHeartbeat` and matches the tremor's delay and curve.
- 2026-09-23: WP 2.5 UI committed (357459b): gauge→boss timer, boss bar and card, Zoom button (locked "next build" after Grimmaw), abilities dock, Scales, the height headline (from the first zoom on), Champions and Heraldry tabs; each module with its own CSS. Champion colours set by the UI (Aldric red plume, gold tabard; Brunhild blue wings, white tabard) → the crowd matches. HEAD verified in a worktree (349 tests, 605 KB). Review launched.
- 2026-09-23: 2.10 fix round done: Rally's clangs an even ~4/s (3 slots, newest steals); champion blows 3 slots (the Mountain's beat is ~0.5 s); the eye silent while a boss is up, quieter repeats (−38 LUFS); the Scales shimmer ~1 s into the pull-back; the stuck zoom flag removed; the fusion rise ends on the flash; no stray clock tick; a soft heartbeat thump on 2.2's `onHeartbeat` (−37 → −33 LUFS); the tremor rumble uses the visual's delay and curve. **Commit batch pending:** 2.2 fix round + 2.3 + 2.7 + 2.10's round go in together (shared eye schedule, sim files, and `sfx.ts` → `fx/dread.ts`), after one combined verification.
- 2026-09-23: 2.2 fix round done: the grade now runs at the end of `backdrop.back` via `BackdropApi.setGrade?` (the weak spot stays cyan-white, eyes and sparks at full strength); multiply + source-over veil instead of `'saturation'`; the tremor sway is a `Camera.sway` channel inside `camera.update` (1.3 / 2.7 / 7.1 px at 10/50/90%, zero during the zoom), `TREMOR_DELAY`/`TREMOR_EXP` exported; ground rings are flat ellipses (`fx.groundRing`); boss embers stop at the zoom; the heartbeat runs exactly while a boss is up; grade depth per palette (Mountain ~0.52). No time effects changed. Touched outside fx/post: `backdrop/api.ts`, `backdrop/index.ts`, `render/camera.ts` (+ test), `fx/sprites.ts`. The batch now waits only for 2.7 (sim at 63/72 mid-tuning).
- 2026-09-23: WP 2.8 wyvern and bosses committed (6b92d2f): wing-arms that walk on the wrist and open into wings, flight with a rigid carry mode, a run cycle, a movable ground, species data for enter/leave/swipe/breath and weak-spot candidates, bosses as data (the Elder Newt, Grimmaw), a palette cache keyed by name (≤ 3); the newt bit-identical to HEAD; 130–290 µs per frame (bosses ≤ 373 µs). HEAD verified (370 tests, 637 KB). Lead art check at 1440×900: the wyvern rearing into a breath windup with the throat glowing is premium; Grimmaw's snow mantle and crown read. Core items sent to 2.7: `weakSpotLive` false during `leave`; boss enter ~2.6 s and dying ~3.0 s. Review launched.
- 2026-09-23: WP 2.6 music committed (e04371d): Meadow D Mixolydian 6/8 (low whistle under D5, lute, D–A drone, harp answers; A A B form with episodes); Mountain D Dorian 66 BPM on the horn call D-A-G-F / E-C-D; boss B minor 116 BPM, 3+3+2 ostinato, resolving to D major on a win; the zoom: silence at the rally, a choir swell and sub into the flash, a shimmer and harp glissando through the pull-back, the horn call at the roar (timed from `beatTimes`). −28 to −22 LUFS, 11–18 dB clear of the click band, ~0.008 ms per frame, 60–185 nodes. `MusicApi.mood?`/`duck?`. HEAD verified (449 tests, 683 KB). Review launched. Not yet heard against the real zoom director.
- 2026-09-23: 2.5 review: the first minute stays clean, every element survives `resync` and catch-up, keys 1–3 behave, Decimals right. Fixes sent back: Champions buttons break past level 5 and at mastery (show ×N and a Mastered seal); the boss bar's wing covers the height caption at 1440×900; M1's captions replay over the dock after a reload (tier 0 only); Cinzel tabs for every tab count; a bigger boss timer (~20–22 px); the gauge at 10 kills (~0:52); cheaper always-on animations; the headline's wrap at 1280×800. **Lead direction for the first zoom's landing** (it was a 2 s pileup): stage it over ~6–8 s: the height count-up alone first (the payoff), then Scales, then the panel on Heraldry with its coach, then the abilities dock, whose "Press 1" coach waits for a charge purchase, the panel closing, or ~10 s; drop the redundant unlock toasts.
- 2026-09-23: WP 2.7 pacing done, 72/72 targets (42 old + 30 M2). Engaged: Elder Newt 3:06 (fight 8.6 s), first zoom 3:19, first wyvern falls in 2.6 s, army back to 20 in 51 s, Grimmaw summoned 7:14, fight 12.2 s (worst 16.8), beaten 7:27; clicks 47% Meadow / 52% Mountain; champions 6% / 15%. Casual first zoom 4:57 (worst 5:17), Grimmaw 11:59; nonAimer Grimmaw 11:22; idle Elder Newt 10:38, Grimmaw ~28:00; longest kill gaps 18.7 / 28.5 / 28.4 s. BALANCE: Mountain HP ×100, costs ×45, bossAt 31; High Forge ×1.25; Charge! ×3 for 6 s every 45 s; Volley 10 s of damage, 90 s. Formula changes: per-tier boss HP (`tiers[t].bossHp`: 1.4 / 1.3), the first dragon after a zoom at 60% HP (`dragon.arrivalHp`), boss enter 2.6 s / dying 3.0 s, no weak spot while leaving. Bots press abilities 0–8 s after ready. Risk: the engaged Grimmaw minimum (≥ 12 s) vs the slowest fight (≤ ~27 s) are close; relax the engaged minimum to 10 s if it flakes.
- 2026-09-23: **Batch committed (2f7a512)**: WPs 2.3, 2.2 (+ fixes), 2.7, 2.10's fix round, verified first in isolation (HEAD + the batch files in a throwaway worktree: typecheck, 488 tests, sim 72/72, 744 KB).
- 2026-09-23: **Zoom checkpoint (2.1A) reviewed by the lead**, frame by frame at 1440×900 (scrub with `?debug&zoomAt=T` or `window.__zoom.scrub(t)`; frames: rally 1.0, pile 1.6, light column 2.1, flash 2.25, boots 2.9, pull-back 3.7/4.4, meadow-scale 5.15, ridge 6.5, reveal 7.1, card 9.0). Premium: the living tower of knights, the glow and god rays, the light column, the boots, the full colossus with the coat of arms, the reveal and roar, the card, the exact hand-back. **Not landing: the core twist.** The Mountain shows between the boots at 2.9 (with snapshot seams), and the meadow ends as a small orange dome hidden behind the boots (~40 px at 5.15). Part B direction: the meadow fills everything around the boots until it's small; it morphs into an unmistakable scale (dark rim, rim light, a polished sheen), 15–25% of the screen at a held beat (~0.8–1 s), uplighting the boots; a hide beat (the frame fills with the Mountain's own scales before the ridge, range and sky appear); a faint warm scale under the hero's feet afterwards as an easter egg. Plus pre-bakes (`prepare(tier)` for the backdrop, the crowd's palette sheets: the switch frame spikes to 68 ms), rally-sound pre-warm, the sim importing the cinematic's 10.2 s, and deleting the stand-ins. CPU per beat today: flash 7.2 ms avg (p95 12.6), others 1–3 ms.
- 2026-09-23: 2.6 review: the scheduler, voices and browser safety hold; fixes sent: the boss music ignores the last 10 s (urgency is read only per section), the Mountain collapses to an 87 s loop after Grimmaw (no interludes at high energy), the boss drums mask the heartbeat (snap the heartbeat to the music's beat), the horn call lands on the SFX roar (enter on `card`) and two sub drops stack at the flash, beat gaps ignore lateness, F naturals and a C#5 rub against the SFX, a re-summon during the retreat is ignored, the debug timings aren't the director's.
- 2026-09-23: WP 2.9 crowd committed (066e378): lancers, champions (Aldric keeps a white-and-azure plume and sun arms so he doesn't read as the hero; the UI portrait is being aligned), Charge!/Rally/Volley reactions, the rally pile, `setFused`, `heroRest`; 0.7–0.95 ms per frame; sprite memory 46–59.5 MB (cap 64). `index.ts` ~1,975 lines: split before M3. Review launched.
- 2026-09-23: WP 2.5 fix round committed (4829da5): champion ×N and Mastered; the staged first-zoom landing (height alone, Scales ~2.6 s, Heraldry ~3.8 s, dock ~5.2 s, "Press 1" waits); the gauge at 10 kills; a 21–23 px boss timer; Cinzel tabs; M1 captions only in the Meadow; the volley unlock toast dropped too. HEAD fully verified after 066e378/da67852/4829da5: typecheck, 507 tests, sim 72/72, 847 KB, size OK.
- 2026-09-23: Aldric's portrait matches the crowd (af6c36d): sugarloaf helm, white plume shaded blue, a gold sun on blue.
- 2026-09-23: 2.8 review: accept. Verified: `weakRadius()` matches `hitTest` exactly; `bounds()` holds the camera still through the glide-in; the tail slam lands on the front line in its `tailPoint` window at 1.8–85 m; `leave` ends invisible and unhittable; cost newt 80–175 µs, Elder Newt 205–335, wyvern 60–120, Grimmaw at 142 m 80–145; no per-frame allocation; atlas tints deduplicated. Fixes sent back to 2.8: the Elder Newt skates (run cycle capped at 3 Hz vs up to 8.8 Hz needed; plus a boss-length leave in core and a tighter `exitDist`), clicks during `leave`, the fly-off fading in frame, bosses tied to a species. **Pending for the backdrop (after the zoom's Part B leaves the folder):** at 85–142 m dragons, the Mountain's resting world wyrm's horns sit right behind the wyvern's back and read as spikes stuck in it (reframe the resting head or fade it under large dragons). **M3 note:** serpents and leviathans need rig work (legs can't be switched off, fixed node counts, no path-following for coils; a cloud dragon needs a hovering idle); 2.8 will list what's needed.
- 2026-09-23: 2.9 review: the pile ("dense, rim-lit, banners at the top: premium"), the hand-off (exactly on `heroRest`), champions through the zoom, the palette free at the switch and the per-frame cost (0.4–0.78 ms at 275 sprites with everything firing) verified. **High:** champion specials fired on the first hittable tick after dying/enter/leave are lost and the champion freezes 9–15 s (3–5 of every 7 specials at a ~5 s kill cycle). Medium: a resync during the rally snaps the pile away; hitches on the rally push-in (LOD lookahead only when pulling back; `Champion.buffer` allocates per frame while zooming in); the sprite-memory ceiling thrashes (no LOD hysteresis). Feel: the Volley is visible ~0.4 s (start the arcs on screen); lancers stop a lance-length back at close framing. Fix round sent to 2.9, including a new `CrowdView.prepareTier?(tier)` pre-bake hook; the zoom agent (2.1B) was told not to edit the crowd and to call it instead. Plan to split `crowd/index.ts` (~1,975 lines) before M3.
- 2026-09-23: 2.8 fix round committed: a timed gait with planted feet (stride 0.9, ≤ 6 steps/s; `gait.test.ts` checks every entrance and exit at 3–4 sizes), the newt's airborne scurry-off, a 2.6 s boss leave (`dragonEnterDuration`, also for the debug leave: a one-line lead fix in `core/actions.ts`), `hitTest` null in `leave`, fly-offs fade off screen, `BossDef.species`. Verified in isolation (517 tests, sim 72/72, 849 KB). **2.8 accepted.** M3 rig needs (from 2.8): storm serpent (M: no legs, longer spine, a slithering wave), cloud dragon (S–M: a hovering idle, a flowing mane, cloud entrances), leviathan (L: a curve-following spine for coils, curved ground, simpler drawing at extreme sizes).
- 2026-09-23: 2.6 fix round committed (b2285de): an urgent boss layer at the next bar as the timer runs out; Mountain variety (rests at any energy, horn-call episodes, M/M2 variants, E Dorian laps: M ≤ 7× in 16 min at full energy); the SFX heartbeat locked to the music's grid via `dread.lockHeart` (margin vs the music's low end −14.1 → −1.0 dB; lubs within ±16 ms); the horn call enters on the card; one sub drop at the flash (peaks −7.3 dBFS at the flash, −9.6 at the roar with SFX); beat gaps read `zoom.time`; no sustained F naturals under the coins; boss bars 6–8 an octave down; re-summon during the retreat restarts; debug timings from `timeline.ts`. Known quirk: the fx's one-off engage beat can double one lub per fight. Verified in isolation (527 tests, 853 KB). **2.6 accepted.**
