# SCALE: Build Log

The lead's resume document. A fresh lead should be able to pick up from this file alone. PLAN.md is the design, KICKOFF.md the lead's rules, ARCHITECTURE.md the code contracts (build against it, not against other modules' internals).

## Resume here
- **Milestone:** M1 First Blood ★. We are **not yet at the ★ playtest**. The user has not played anything yet. Stop at the M1 playtest and wait for feedback before starting M2 (KICKOFF).
- **Snapshot (2026-09-23, HEAD 6544218):** tests 236/236, typecheck clean, `npm run sim` 35/35, build 425 KB raw / 190 KB gzip (fonts 98 KB).
- **Done and committed:**
  - 0.1, 0.2, 0.3.
  - 1.1 backdrop (+ review fixes), 1.2 dragon rig, 1.3 knight crowd, 1.4 juice (+ review fixes), 1.5 economy, 1.6 HUD, 1.7 SFX (+ review fixes), 1.8 text, 1.9 balance sim (+ the five core fixes).
- **In flight:** the **M1 milestone review** (reviewer, whole build; brief in the lead's scratchpad `brief-m1-review.md`). It checks the first 3–4 minutes as a judge, integration bugs, end-to-end performance at 1440×900 DPR 2, size and constraints, and gives a blunt feel verdict. After it: fix any blockers, then the ★ playtest handoff.
- **All M1 WPs have landed, been reviewed and been fixed:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9 (+1.9b), 1.10 framing. HEAD 6544218. `npm run check` green (236 tests), sim 35/35, build 425 KB raw / 190 KB gzip.
- **If you are a fresh lead in a new session,** the old agents can't be messaged.
  1. Run `git status`. It should be clean. Everything is committed as of 6544218.
  2. For each WP, run `npx tsc --noEmit`, `npx vitest run <folder>`, and look at it in the browser.
  3. If the WP is complete per its brief summary below, commit it. If not, re-launch it with that brief summary and tell the agent to continue from the files on disk.
  4. If the milestone review's result is lost, re-run it with the checklist under Next steps, "M1 milestone review".

## In flight: brief summaries (enough to re-launch)
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

## Art-pass notes not yet routed (lead)
- **Engaged still staggers ~half its windups** at a 25% throat hit rate. Fine for skilled play; revisit if the playtest shows fire breath is rarely seen.
- **What already looks good:** the title screen is cinematic, the first-kill flow works end to end, and late game (12 m dragon flying in, banner host) looks premium.

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

## Open issues and risks
1. **Performance is unverified end to end.** Each WP measured itself (skeleton 1.2–1.5 ms CPU with 300 stub knights + 1,500 particles; juice stress 60 fps; backdrop ~2 ms back + 1.2 ms front CPU+GPU at DPR 2), but nobody has measured the full stack with the real dragon and crowd. The backdrop agent saw one ~30 fps sample pulled back. Do a clean check on a static build (see Process).
2. **Canvas memory:** backdrop 55 MB at DPR 2 (after fixes), crowd sprite sheets ~60 MB (4 LODs), number canvases capped at 8 MB: ~125 MB total. The crowd review may trim it. Check Safari in the perf pass.
3. **Size:** 416 KB raw now, against a ~400 KB target and the 1 MB hard fail. M2 adds the zoom, Mountain tier, heraldry and music. If it trends past ~700 KB, look for bloated tables and consider subsetting fonts further.
4. **Weak spot too generous on small newts:** almost every click crits. The fix was sent to the dragon agent (min radius ~10–12 px, off-center). Verify when 1.2 lands.
5. **First framing:** the director's base framing puts the hero at 20% of stage height, which makes the first newt only ~50 px on screen. Judge it at the integration pass. The option is a tighter opening framing (`director.heroFrac`) for the first few dragons.
6. **Weak spot during windups (balance-critical):** the sim assumes the weak spot moves to the throat during a breath windup (PLAN §3.2). If the rig keeps the loose scale hittable during windups, a masher staggers ~90% of windups and fire breath is rarely seen. Sent to the dragon agent; verify when 1.2 lands. Also: the casual first minute is slow (8–10 s per kill); judge it at the integration pass. ARCHITECTURE §4 is stale on the click formula and stagger gold.
7. **Tail-swipe thumps aren't synced:** the SFX thumps are timed 0.45–1.15 s after the swipe, not to the crowd's actual ragdoll landings. If it feels off, add a crowd→audio landing hook.
8. **Unreviewed WPs:** the HUD (1.6, medium) and text (1.8, writer) had no reviewer pass. They're covered by the lead's integration pass and the M1 milestone review. The HUD reads MICROCOPY keys `panel.armyEmpty`, `panel.upgradesEmpty` and `tier.<n>`; confirm it picks up the writer's strings rather than its fallbacks.
9. **Juice costs logic time** by design (a consistent freeze). If juice tuning changes, update `src/sim/juice.ts` to match `src/render/fx/tuning.ts`.
10. **Saves:** there's no save loader yet (M3). Saves are schema v3 (per-dragon stagger count); older versions are rejected.
11. **GitHub:** nothing has been pushed and the repo `pincombe/scale` doesn't exist yet. The user chose a single public repo. Ask before creating it. After creating it: Settings > Pages > Source = "GitHub Actions".
12. **Dev pages:** `src/render/dragon/lab.html` and `src/render/crowd/gallery.html` are dev-only. They're not in the build (the build only uses the root `index.html`). Keep or delete at M4.

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
- **Browser verification:** the shared dev server with HMR churn made visual checks unreliable while six agents edited. Agents moved to static builds or private Vite servers. Caveat: a private server on another port re-optimized the shared `node_modules/.vite` cache once. Give private servers their own `cacheDir`.

## Playtest feedback
None yet: no ★ playtest has happened. Record the user's feedback here verbatim-ish when it arrives, with a status per item.

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
- **Archer:** volleys every ~2.5 s with ~1.1 s of flight. Unlocks at 10 kills, around 0:55 for an engaged player.
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
- Dragon size ~1 m by 1:00, ~2.5 m by 2:00, ~10 m by 3:00; 25–30 kills by 3:15.
- Never more than 30 s with nothing affordable. Casual gets the same beats later. Idle never gets stuck.
- The M2 boss will be summoned by kill count (Wyrm Gauge), not by the clock.

**Flags**
- Progressive-disclosure flags: `feature.dragonBar`, `feature.gold`, `unit.footman`, `feature.panel`, `upgrade.<id>`, `unit.archer`. The full list is in ARCHITECTURE §4.

**Text**
- All text lives in `src/core/content/text.ts` (`UNIT_TEXT`, `UPGRADE_TEXT`, `dragonName(rand, species, index)`, `sizeWord`, `MICROCOPY`).
- The UI generates effect lines from data; flavor text never restates the effect.

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

## Work packages

### M0: Foundations (done)
| WP | Agent | Status | Commit |
|---|---|---|---|
| 0.1 Scaffold: Vite + TS strict + singlefile + Vitest, fonts, npm scripts, size guard, launch.json | builder-medium | ✅ accepted | 52b595b |
| 0.2 Architecture skeleton + ARCHITECTURE.md | builder-max | ✅ accepted after review (no criticals; 3 majors fixed) | 81fdb06, 78b041d |
| 0.3 CI + Pages workflows (written, not pushed) | builder-medium | ✅ accepted | 52b595b |

### M1: First Blood ★ (in progress)
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
**Finish M1**
1. Land 1.2 and 1.3. For each: typecheck and tests for the folder, a browser check, commit, then a `reviewer` pass (the dragon is max, the crowd high). Route findings back.
2. ✅ 1.9 landed (bfd6db1); review done. **WP 1.9b (builder-high), launch after 1.2 lands:**
   - **Weak-spot liveness moves into core.** The rig currently blocks the weak spot for the first 72% of `enter` (`weakLiveFor` in `render/dragon/weakspot.ts`), but the sim doesn't. Make it a pure core rule that core enforces in `strike` (non-live weak hits become normal hits), and have the rig import it. With the rig's real behavior, engaged click share drops 46% → 35% and size at 3:00 drops 8.4 → 7.1 m, so both fail.
   - **Sim models the throat weak spot during breath windups.**
   - **Shopping pause:** 0.3 s + 0.15 s per purchase; the engaged bot currently buys ~31 times a minute at no cost.
   - **Fix the crash** in `npm run sim -- --profile casual`.
   - **Shared tuning:** juice time constants exported from `fx/tuning.ts` and imported by both fx and the sim.
   - **Targets:**
     - drop the trivially-passing ones;
     - add a stagger share of gold cap, a casual novelty gap and a worst-seed attacks-seen floor;
     - compute click share against remaining HP.
   - **Casual pacing:** apply the reviewer's recommendation (`hpBase` 20 → 14, heroicExample share 0.015 → 0.0175), then retune to all-PASS.
   - **UI fix:** `ui/effectText.ts:23` rounds 1.5% to "2%"; use `Math.round(share*1000)/10`.
   - **Docs:** ARCHITECTURE §4 refresh (save v3, `DragonState.staggers`, `idleAfterEnter` 1.0, click formula, stagger gold 50% then 10%).
3. ✅ 1.1 review fixes landed (b7f2b17). The eye now sits at 39–44% height, 1.75× bigger, on the valley wall right of the sun. Fill is 7.7 → 5.3 screens and canvas memory 128 → 55 MB. **Safari is still unmeasured** (M3/M4 cross-browser pass, or sooner if the user reports it).
4. **Integration and art-direction pass (lead):**
   - Build statically and play the first 3–4 minutes at 1440×900 against the §2 beats.
   - Take screenshots of each beat.
   - Measure performance with 300 knights + 1,500 particles at the pulled-back framing.
   - Check the console is clean.
   - Make a fix list, send it to the agents, and iterate until it looks premium (see "To judge at the integration pass").
5. **M1 milestone review:** a `reviewer` pass over the whole build (correctness, performance, cross-browser risk).
6. `npm run check` green, then commit, then the **M1 ★ playtest handoff:**
   - point the user to `dist/index.html` (opens from file://) and the dev server;
   - give three lines: what to try, what changed, known issues;
   - ask whether to create the public repo `pincombe/scale` and enable Pages.
   
   Then **wait** for feedback.

**M2 The Zoom ★** (only after the M1 feedback; PLAN §14)
- 2.1 Zoom director + fusion cinematic (max; prototype first; use the snapshot rule in Decisions).
- 2.2 Bosses + Wyrm Gauge by kill count, tremors and the eye (high).
- 2.3 Mountain tier: backdrop + wyvern species as a new rig parameter set (high).
- 2.4 Scales + Heraldry v1 + coat-of-arms renderer, feeding the crowd's banner-emblem function (high).
- 2.5 Abilities (keys 1–4 via `input.onAbility`) + champions v1 (medium).
- 2.6 Generative music engine (max; D major pentatonic home key).
- 2.7 Sim for tier 0–1 pacing (engaged zoom at ~3:30 / 7:30).

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
