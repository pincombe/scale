# SCALE: Game Plan

> **Prompt:** "An infinite, idle game about knights and dragons. Under 1mb"
> **Working title:** SCALE
> **Plan v1** · 2026-09-22 · built by Claude (Opus 5.5)

---

## 0. The brief (from the interview)

| Topic | Decision |
|---|---|
| Judging | ~10–20 min in one sitting, so **the first 15 minutes are the product** |
| Win factors | **Visual wow & game feel** and **originality / clever twist** |
| Size rule | Read loosely (transfer size < 1 MB). We ship **< 2 MB raw** (raised from 1 MB by the user on 2026-09-23); gzipped, that stays well under 1 MB |
| Concept | **SCALE**: every dragon is a scale on a bigger dragon, and prestige means zooming out |
| Art | **Painted-sky silhouettes**, 100% procedural (no image files) |
| Tone | **Epic with a wink** |
| Device | **Desktop browser** |
| Play style | **Active-leaning idle** |
| Forces | **Swelling army + named champions** |
| Top of the scale | **Ouroboros loop**: "It was always the newt." |
| Pacing | **3–4 zooms in ~15 minutes** |
| Audio | **Synthesized SFX + adaptive generative music** |
| Process | **You playtest at each milestone**, and the build lead playtests in between (see §14) |
| Delivery | **GitHub Pages** |

### Design pillars
1. **The first 15 minutes are the product.** Polish goes to tiers 0–4 before anything else.
2. **Something new every 60–90 seconds.** A unit, an event, a champion or a zoom.
3. **Spectacle you cause.** Every click, purchase and kill has a visible and audible result.
4. **The twist is the structure.** Prestige isn't a menu reset. It's the most beautiful moment in the game, and it happens every few minutes.
5. **Epic with a wink.** Awe first, then a dry joke. Never a wall of text.

Strategic depth wasn't a win factor, so systems stay light and easy to read. Effort goes into spectacle and surprise.

---

## 1. The pitch

You're one knight in a golden meadow, poking a dragon the size of a newt. You hire more knights and the dragons grow: dog-sized, horse-sized, barn-sized. The ground starts to tremble, and far off in the hills an enormous eye opens... and closes.

Then **the Zoom**. Your whole army rushes together and fuses into one colossal knight. The camera pulls back and back, and the meadow turns out to be **a single scale on the flank of a mountain-sized wyrm**. The colossus now stands on the wyrm's back as the first knight of a new, bigger world.

The same thing repeats at every magnitude: Meadow → Mountain → Kingdom → Sky → World → Moon → Sun → Orbits → Galaxy → Cosmos. At the very top, the last zoom-out reveals that the whole universe is one scale on... **the newt from the first meadow.** *It was always the newt.* The loop begins again, stranger each time. Forever.

```
 Meadow ─zoom→ Mountain ─zoom→ Kingdom ─zoom→ Sky ─zoom→ World ─→ Moon ─→ Sun ─→ Orbits ─→ Galaxy ─→ Cosmos
    ▲                                                                                              │
    └────────────── "It was always the newt."  (Loop +1 · choose a Mutation) ──────────────────────┘
```

**"Infinite" is literal in three ways:** numbers that never cap (big-number math), scale (the headline number is how tall your knights are), and endless loops.

---

## 2. The judge's 15 minutes (target for an engaged first-time player)

| Time | Beat |
|---|---|
| 0:00 | The live meadow at golden hour under a huge serif title, **SCALE**. "Click to draw your sword." That first click is also the first strike, and it unlocks audio. |
| 0:05 | The first newt falls: a slow-mo beat, embers, and a coin fountain that flies into the gold counter. **Hire a Footman** pulses. |
| 0:30 | A second knight marches in under a red banner. First upgrade: *Pointier Swords* ("Research confirms the pointy end is the important end"). |
| 1:00 | **Archers** unlock, and volleys arc across the sunset. Dragons grow from newt-sized to dog-sized to horse-sized. |
| 1:30 | A **Golden Newt** darts across the sky. Clicking it starts a Gold Frenzy. |
| 2:00 | Champion #1 joins: **Ser Aldric the Mostly Brave** (*Heroic Lunge*). |
| 2:30 | Foreshadowing: tremors after each kill, and an **eye opens in the distant hills**. |
| 3:15 | Boss: **The Elder Newt**. A horn sounds, the sky darkens, and a 30-second timer starts. |
| 3:30 | **ZOOM #1** plays automatically as a cinematic. Title card: **II · THE MOUNTAIN**, followed by *Every dragon is a scale on a bigger dragon.* |
| 4:00 | **Heraldry** opens (spend Scales and your coat of arms takes shape). Abilities *Charge!* and *Rally* unlock, and **Lancers** charge on horseback. |
| 7:30 | **ZOOM #2 → THE KINGDOM.** Castles are pebbles and a storm rolls in. **Knight-apults** fling knights at the dragon. |
| 11:30 | **ZOOM #3 → THE SKY.** A sea of clouds at dawn, **Griffin Riders**, and relics from bosses. |
| ~15:30 | **ZOOM #4 → THE WORLD.** The planet's blue edge curves away with a dragon coiled around it. This is the jaw-drop moment. |

A headless balance simulator enforces this pacing (§8).

---

## 3. Game design

### 3.1 Tiers, Zooms and Loops
- **Tier** = one magnitude of scale. Loop 1 has **10 hand-built tiers**.
- **Inside a tier**, you slay a line of ever-bigger dragons. Each kill loosens a scale and fills the **Wyrm Gauge**, and the ground trembles harder each time. A full gauge summons the tier's **boss** (timed fight), and beating it unlocks the **ZOOM**.
- **ZOOM (prestige)**: the army fuses into a colossus who becomes the first knight of the next tier. Gold and units reset. You earn **Scales**, the permanent currency, plus a **Fusion Bonus** that grows with the army you fused. Every zoom poses a choice: *zoom now, or push further for a mightier colossus?* The first zoom plays automatically so no judge misses it. Later zooms happen when you choose.
- **Ouroboros (meta-prestige)**: beating the Cosmos boss triggers the final zoom-out onto the newt. Loop N+1 starts with a permanent Ouroboros multiplier and **a Mutation you choose from 3**. Mutations stack forever and change both visuals and rules:
  - *Three-Headed*: ×3 HP and ×3 gold, and the dragon rig really does render three heads.
  - *Low Gravity*: knights leap, and flung knights sail over the horizon.
  - *Eclipse*: the whole loop happens at night and weak spots glow brighter.
  - *Molten*: dragons leave fire pools.
- **Headline number = size.** "Your knights stand 212 m tall, taller than the cathedral they swore to protect. They're trying not to step on it." After a loop: "1.8 m. Again."

### 3.2 Moment to moment (active-leaning idle)
- **Click to strike.** Dragons show a glowing **weak spot**, such as a loose scale or a throat glow during the fire-breath wind-up. Hitting it deals a **×5 crit**, and hitting it mid-wind-up **staggers** the dragon for bonus gold. Aim and attention pay off more than spam.
- **The army fights on its own.** Every purchase adds a visible soldier.
- **Abilities** (tier 1 onward, hotkeys 1–4): *Charge!* (the whole army charges, ×3 DPS), *Rally* (auto-strikes), *Dragonbane Volley* (burst damage).
- **Golden dragons** appear every ~60–120 s. Clicking one grants a *Gold Frenzy*, *Knight Surge* or *Treasure*.
- **Automation** perks come later (auto-buy, auto-cast), so the game plays itself more as you go.
- **Offline progress** is capped and summarized in a short "While you were away..." chronicle.

### 3.3 Tier roster (loop 1)

| # | Tier | Knights stand | New unit | New mechanic | Boss |
|---|---|---|---|---|---|
| 0 | Meadow | 1.8 m | Footman, Archer | Click and weak spots, upgrades, Golden Newt, **Ser Aldric** | The Elder Newt |
| 1 | Mountain | ~200 m | Lancer | **Heraldry**, abilities, **Dame Brunhild, Who Fears Nothing Except Geese** | Grimmaw of the Peaks |
| 2 | Kingdom | ~5 km | Knight-apult | Storms (click lightning to Smite), **Brother Wendel of the Loud Prayers** | Tempestra, Coil of the Kingdom |
| 3 | Sky | ~50 km | Griffin Rider | Relics from bosses, **Lady Isolde the Unreasonably Tall** | Nimbulon the Cloudbreaker |
| 4 | World | ~5,000 km | Dragonslayer Order | Automation perks, **Sir Reginald, Who Has Read About Dragons** | Tellurion, Who Holds the World |
| 5 | Moon | ~500,000 km | Moon-Vaulter | Low gravity | Selenarx of the Pale Moon |
| 6 | Sun | ~10 million km | Sun-Forged Knight | Solar flares (timed click events) | Solgoth the Burning |
| 7 | Orbits | ~10 billion km | Comet Cavalry | Planetary alignment (periodic surge) | Orrery, the Wyrm of Wheels |
| 8 | Galaxy | ~100,000 ly | Constellation Knight | Your coat of arms drawn in stars | Galaxion the Spiral |
| 9 | Cosmos | ~90 billion ly | — | The Last Scale | The Worm at the End of All Things |

Tiers 5–9 are drafts to be finalized in M4. Tiers 0–4 carry the judge experience.

### 3.4 Units
- One new type per tier. Once a type is unlocked, it's available in every tier after.
- Cost growth is ~1.07–1.15 per purchase, with **milestone doublings** at 10/25/50/100 owned for big, satisfying jumps. Upgrades carry witty flavor text.
- About 300 knight sprites are drawn on screen at most. Past that, each sprite stands for a squad and its banner shows the count.

### 3.5 Champions (persistent heroes)
- One joins per tier for the first five tiers, and they persist through zooms and loops ("Ser Aldric is now 40 km tall and still mostly brave").
- Each has a name, a heraldry-colored plume and banner, a special move, and levels bought with gold.

### 3.6 Heraldry (permanent upgrades that build your coat of arms)
- Spend **Scales** on charges: **Lion** (+damage), **Sun** (+gold), **Eagle** (more golden dragons), **Stag** (faster ability cooldowns), **Wyvern** (weak-spot crits), **Tower** (start each tier with troops), **Crown** (Fusion Bonus), **Moon** (offline progress), plus automation (**Seneschal** auto-buys, **Herald** auto-casts).
- Every purchase changes your **procedurally drawn coat of arms** (field, tinctures, charges), and it then flies on **every banner in your army, in every tier**. Your progress is literally worn by your army.

### 3.7 Dragons
- Procedural names and epithets: *Pumpernickel the Unready*, *Old Smoulderbottom*, *Vexathrax, Who Mostly Eats Villages on Tuesdays*.
- One species family per tier: stubby meadow newts, craggy mountain wyverns, storm serpents, whiskered cloud dragons, world-coiling leviathans, and so on up to void wyrms.
- They fly in, perch, breathe (the body swells), tail-swipe (knights go flying in ragdoll arcs, then dust themselves off and run back), breathe fire (knights scatter), flash and flinch on hits, and die slowly, collapsing into embers and ash.

### 3.8 Writing
Tier title cards, one-line size comparisons, chronicle entries, upgrade flavor text, dragon epithets and champion quips. All short and dry, and never in the way.

---

## 4. Art direction and rendering

### 4.1 The look: painted-sky silhouettes
- **Per-tier palette:** gradient sky, sun or moon with glow and god rays, 4–6 parallax silhouette layers with atmospheric perspective (farther layers fade toward the sky color), and drifting particles (fireflies, snow, rain, cloud wisps, stardust).
- **Near-black silhouettes** for knights and dragons with a **rim light** on the sun-facing side, which is what makes it look premium.
- **Color only where it matters:** banners and heraldry, glowing eyes, fire, gold, and UI.
- **Post-processing:** vignette, subtle animated film grain, and a flash plus chromatic kick on big moments.
- **Everything is drawn in code**, so it stays sharp at any zoom level. That's essential for continuous zooming.

### 4.2 Per-tier looks
Meadow: golden hour, windmill, fireflies, and an eye in the hills · Mountain: alpenglow dusk, where the range *is* the next wyrm's spine · Kingdom: storm twilight, lightning, castles like pebbles, rivers like threads · Sky: a sea of clouds at dawn with aurora · World: the planet's blue edge against black space · Moon: silver light and earthrise · Sun: corona and flares · Orbits: planets like marbles on their rings · Galaxy: spiral arms and nebulae · Cosmos: the cosmic web, and then the newt.

### 4.3 Procedural animation
- **Dragons:** a spine chain with follow-the-leader constraints and a width profile gives a smooth outline. The head has a hinged jaw and horns, 2–4 legs use two-bone IK, and the wings have finger bones and membranes on a flap cycle. Spines, frills, whiskers and extra heads are parameters, so every dragon is unique and every species is just a parameter set.
- **Knights:** silhouettes pre-rendered into sprite sheets (march, idle, strike, flung, cheer) with tinted banners, drawn in batches so hundreds fit on screen.
- **Particles:** pooled, additive-blended sprites for fire, embers, sparks, coins, arrows and dust.

### 4.4 Juice checklist
Hit flash · hit-stop on crits · screen shake scaled to damage · sword arcs · damage numbers (crits big and gold) · coins that fly to the HUD and bump the counter · slow-mo on kills · knights cheering · dust on landings · unlock toasts with shimmer · pulsing calls to action · boss horn with darkened sky and red vignette pulse.

### 4.5 The Zoom (the centerpiece)
1. **Rally (~0.8 s):** horns sound, knights rush to the center with banners high, and the ground trembles.
2. **Fusion (~1.2 s):** the crowd piles up, there's a flash, and a colossal knight appears whose *boots* fill the screen.
3. **Pull-back (~3–5 s):** a continuous exponential zoom-out with streaks and motion trails. The meadow shrinks into one scale on a vast hide, the surrounding scales resolve into a wyrm's flank, and the flank becomes the new tier's mountain range. The colossus shrinks to normal knight size, standing on the wyrm's back.
4. **Reveal (~1.5 s):** the wyrm's head rises over the ridge, its eye opens, and it roars. Title card: **II · THE MOUNTAIN**.

*How it works:* the old scene is snapshotted to an offscreen canvas and drawn clipped inside one scale of the new tier's vector hide. Everything else is vector, so any zoom factor works, from ×100 to ×10⁸ for the galaxy jump. The same director runs the Ouroboros finale, where the cosmos becomes a scale on the newt.

---

## 5. Audio (all synthesized, no files)
- **Instruments:** Karplus-Strong plucked lute and harp, breathy flute, drones in fifths, frame drum and timpani, brass-like horns, formant "choir" pads, and reverb from a generated impulse response.
- **Adaptive score:** mode, key, tempo and instruments change per tier (Meadow: pastoral lute and flute in Mixolydian · Mountain: horns and drone · Kingdom: war drums · Sky: airy pads · cosmic tiers: choir). Layers react to what's happening: a boss brings in drums and horns, and a zoom brings a choir swell and a sub-bass hit.
- **SFX:** sword clangs, hits, crits, roars, fire breath, coin clinks (tuned to a pentatonic scale so a flood of coins sounds musical), purchases, unlock chimes, and the zoom whoosh.
- Music and SFX volume sliders, plus mute (M).

---

## 6. UI / UX
- The scene fills the window. A right-hand panel (~340 px) has tabs for **Army · Upgrades · Champions · Heraldry**, plus a settings gear.
- **HUD:** gold and gold/sec · tier name, knight height and a witty comparison · Wyrm Gauge · dragon name and HP bar · boss timer · abilities bar.
- **Progressive disclosure:** UI appears only as it unlocks. The first minute is just the meadow, a dragon, a counter and one button.
- **Fonts:** Cinzel for titles and EB Garamond for body text, embedded as subsets.
- **Settings:** number notation, reduce motion and flashes, volumes, save export/import, and hard reset.

---

## 7. Tech architecture
- **Stack:** TypeScript + Vite, with `vite-plugin-singlefile` producing **one self-contained `index.html`**. Dependencies: `break_infinity.js` (big numbers) and `@fontsource` fonts. No engine: a custom Canvas 2D renderer plus a DOM UI. Vitest for tests. If Canvas 2D can't hit the glow quality, a small WebGL post pass (bloom and grading) still fits the budget easily.
- **Modules:**
  - `core/`: pure, deterministic game logic (state, formulas, `tick(dt)`, actions, content tables, save/load with migrations, offline catch-up). It never touches the DOM, so it's easy to test and simulate.
  - `render/`: camera, cached sky and backdrop painter, dragon rig, knight crowd, particles, floating text, post FX, and the zoom director.
  - `audio/`: synth voices, SFX, and the generative music engine.
  - `ui/`: DOM panels with targeted updates (text refreshes ~10 times a second).
  - `sim/`: headless balance simulator run with Node.
- **Game loop:** fixed-step logic (~20 Hz) with requestAnimationFrame rendering and interpolation. It catches up when the tab regains focus.
- **Saves:** localStorage autosave every 10 s and on hide/unload, a versioned schema, and an export/import string.
- **Performance target:** 60 fps on an Apple-silicon MacBook with 300 knights and 1,500 particles. Device pixel ratio capped at 2, object pools, and cached backgrounds.
- **Size budget:** about 400 KB raw and about 120 KB gzipped, with a **2 MB guard in CI** (raised from 1 MB on 2026-09-23).
- **Debug mode (`?debug`):** time scale, jump to tier, trigger zoom, and an FPS overlay. Hidden from judges.
- **Browsers:** Chrome, Safari and Firefox. No Chrome-only canvas features.

---

## 8. Balance and pacing
- **Formulas:** dragon HP grows with each kill in a tier, gold is a fraction of HP, unit costs grow 1.07–1.15 per purchase, milestone doublings apply, and tier difficulty is balanced against the Fusion Bonus plus Scales.
- **A headless simulator** plays the real `core/` using three bot profiles:
  - *casual*: 3 clicks/s, buys every 10 s, ignores events
  - *engaged*: 6 clicks/s, hits weak spots, uses abilities, clicks golden dragons
  - *idle*: no clicks, buys once a minute
- **Targets:**
  - The engaged bot zooms at about **3:30 / 7:30 / 11:30 / 15:30**.
  - The casual bot reaches the first zoom **before 5:00**.
  - The idle bot still makes progress.
  - **No dead ends**, checked across many random seeds.

---

## 9. Milestones (★ means you playtest)

| Milestone | Scope | What you judge |
|---|---|---|
| **M0: Foundations** | git repo, Vite/TS scaffold, single-file build, tests and the size guard, GitHub Pages pipeline | nothing to play yet |
| **M1: First Blood ★** | The Meadow, fully playable and juicy: painted backdrop, procedural newts, knight crowd, clicks and weak spots, footmen and archers, upgrades, particles, damage numbers, first SFX | *Does minute one hook you?* |
| **M2: The Zoom ★** | Bosses, **the zoom cinematic and fusion**, the Mountain, Scales and Heraldry v1, abilities, champions v1, music v1 | *Is the zoom a wow?* |
| **M3: The Judge's Cut ★** | Kingdom, Sky and World polished; knight-apults, griffins, relics, golden dragons; saves, offline progress, settings; the sim hitting the 15-minute targets | *You play the exact judge experience.* |
| **M4: Infinity ★** | Moon → Cosmos, the Ouroboros loop and mutations, automation, title and writing pass, performance and cross-browser pass, final deploy | *Is it ready to send?* |

After M4, the build lead iterates on your feedback until you're ready to share it. It commits locally after each accepted work package, and **nothing is pushed to GitHub until open question 1 is answered.**

---

## 10. Verification
- **Unit tests (Vitest):** formulas, big-number formatting, save migrations and offline catch-up.
- **CI checks:** balance-sim assertions and the 2 MB size guard.
- **Browser playtests after every feature:** the in-app browser for screenshots, console errors and the FPS overlay.
- **A full 15-minute "judge run"** at M3 and again at M4.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Procedural dragons look clumsy | Build the rig first in M1 and iterate on screenshots. Silhouettes hide missing detail |
| The zoom has seams or jank | Prototype the zoom director first thing in M2. Mist, streaks and a flash hide seams |
| Canvas slows down with big crowds | Sprite sheets, object pools, and a crowd cap with squad banners |
| Pacing misses the 15-minute targets | Tune with the simulator, then confirm with your playtests |
| Scope creep | Tiers 0–4 get the polish. Tiers 5–9 reuse systems with new palettes and parameters |
| Your friend reads our source | Open question 1 |

## 12. Out of scope
Mobile layouts, accounts and leaderboards, monetization, and any external or network assets at runtime.

## 13. Open questions
1. **GitHub Pages visibility.** On a free GitHub plan, Pages only works from a *public* repo, so your friend could read the source. Options:
   - (a) Public repo, and accept that.
   - (b) **Private source repo, plus a public repo holding only the built `index.html`.** This is the default.
   - (c) Private repo with Pages, if you have GitHub Pro.
2. **Repo name / URL.** Default: `pincombe/scale` → `pincombe.github.io/scale`. The name is currently free.
3. **Deadline.** Is there a date the game has to be ready by?

---

## 14. Execution: how the build runs

**Setup:** one **build lead** session (Opus 5.5 at **max** effort) owns the plan, the architecture and the quality bar. It hands implementation to **project subagents** (`.claude/agents/`). Each subagent is pinned to an effort level, and the lead picks the one that matches each work package (WP). The lead also:
- verifies every WP itself (tests, build, and screenshots in the browser)
- keeps `BUILD_LOG.md` current
- commits locally after each accepted WP
- stops for your playtest at each ★

| Agent | Effort | Use for |
|---|---|---|
| `builder-max` | max | The hardest, highest-leverage work: architecture skeleton, dragon rig, zoom director and fusion, generative music engine, performance deep-dives, nasty bugs |
| `builder-high` | high | Substantial features that need judgment: backdrops, knight crowd, particles and juice, economy core, bosses, heraldry, SFX, save/offline, balance sim |
| `builder-medium` | medium | Well-specified features: UI panels and HUD, settings, content tables, ability and champion wiring, CI and Pages pipeline, tests |
| `runner-low` | low | Mechanical work: run build/tests/sim and report back, size checks, renames, log updates |
| `reviewer` | xhigh | Read-only review of every max/high WP against PLAN.md and its acceptance criteria |
| `writer` | high | All player-facing text: names, epithets, flavor text, tier cards, chronicle |

**Parallelism:** WPs whose files don't overlap run in parallel. WPs that touch the same files run one after another, or each gets its own git worktree and the lead merges them.

### Work packages

**M0: Foundations**

| WP | Agent |
|---|---|
| 0.1 Scaffold: Vite + TypeScript (strict) + singlefile + Vitest, folder layout, npm scripts, `.claude/launch.json` | medium |
| 0.2 Architecture skeleton: fixed-step loop, state and events, canvas renderer pipeline and camera, UI mount, `?debug` panel | max |
| 0.3 CI: typecheck, tests, build, size guard, Pages deploy workflow (written but not pushed yet) | medium |

**M1: First Blood ★** (tracks run in parallel once 0.2 lands)

| WP | Agent |
|---|---|
| 1.1 Meadow backdrop: sky, sun, god rays, parallax layers, ambient particles, the eye in the hills | high |
| 1.2 Dragon rig v1 and the newt species: spine, head and jaw, leg IK, wings, behaviors, weak spot | max |
| 1.3 Knight crowd: sprite sheets, formation, strike / flung / cheer, banners | high |
| 1.4 Juice: particles, damage numbers, hit-stop, screen shake, coins flying to the HUD | high |
| 1.5 Economy core: Decimal math, dragon HP and gold, units, upgrades, milestones, clicks and crits | high |
| 1.6 HUD, Army and Upgrades panels, progressive disclosure | medium |
| 1.7 SFX v1 | high |
| 1.8 Meadow text: dragon names, epithets, upgrade flavor | writer |
| 1.9 Balance sim v0 (tier 0 pacing) | high |

**M2: The Zoom ★**

| WP | Agent |
|---|---|
| 2.1 Zoom director and fusion cinematic | max |
| 2.2 Bosses, Wyrm Gauge, tremors and foreshadowing | high |
| 2.3 Mountain tier: backdrop and wyvern species | high |
| 2.4 Scales, Heraldry v1, coat-of-arms renderer | high |
| 2.5 Abilities and champions v1 | medium |
| 2.6 Generative music engine v1 | max |
| 2.7 Sim: tier 0–1 pacing targets | high |

**M3: The Judge's Cut ★**

| WP | Agent |
|---|---|
| 3.1 Kingdom tier, with knight-apults and storms | high |
| 3.2 Sky tier, with griffins and relics | high |
| 3.3 World tier, with the planet-edge render and automation | high |
| 3.4 Golden dragons and events | medium |
| 3.5 Save/load, offline progress, settings | medium |
| 3.6 Balance tuning to the 15-minute targets | high |
| 3.7 Writing pass for tiers 0–4 | writer |
| 3.8 Performance pass | max |
| 3.9 The 15-minute judge run, played in the browser | lead |

**M4: Infinity ★**

| WP | Agent |
|---|---|
| 4.1 Tiers 5–9, one WP per tier, run in parallel | high |
| 4.2 Ouroboros finale and mutations | high |
| 4.3 Title screen and final writing pass | high + writer |
| 4.4 Cross-browser (Safari, Firefox) and final performance | high |
| 4.5 Deploy to GitHub Pages, once open question 1 is answered | medium |
