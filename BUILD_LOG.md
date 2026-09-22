# SCALE: Build Log

Live status for the build. PLAN.md is the design, KICKOFF.md the lead's rules, ARCHITECTURE.md (from WP 0.2) the code contracts.

## Status
- **Now:** M0 Foundations. 0.1 + 0.3 accepted (52b595b). WP 0.2 skeleton running (builder-max; brief in lead scratchpad `brief-0.2.md`).
- **Next:** review 0.2 (reviewer), fix, commit, then launch M1 tracks 1.1/1.2/1.3/1.4/1.5/1.7 in parallel.

## Decisions
| Date | Decision |
|---|---|
| 2026-09-22 | Open questions answered: **single public repo** `pincombe/scale` → `pincombe.github.io/scale`. **No fixed deadline** (quality first). Nothing pushed yet; lead asks before creating the public repo. |
| 2026-09-22 | Clicking anywhere on the stage strikes the current dragon (forgiving for judges). Clicking the glowing weak spot is the ×5 crit; the weak spot during fire-breath wind-up also staggers. |
| 2026-09-22 | Stage layout: world units are tier-local meters, ground at y=0, +y down. Army on the left facing right, dragon on the right facing left. Camera frames dragon + army and pulls back as dragons grow. |
| 2026-09-22 | Core owns the dragon's behavior phases (enter/idle/windup/breath/swipe/stagger/dying) because rewards depend on them; render only animates them. Knights being flung is visual-only. |
| 2026-09-22 | Army damage arrives as discrete, visible hits (melee beats, archer volleys with flight time), never as silent continuous drain. |
| 2026-09-22 | Size budget: hard fail at 1,000,000 bytes raw, warn at 500 KB. Fonts ≤ ~120 KB of the final HTML. |
| 2026-09-22 | Fonts: "Cinzel Variable" (400–900) for titles, "EB Garamond" 400 + italic only for body (98 KB inlined). No body bold: use Cinzel or italic for emphasis. |
| 2026-09-22 | Toolchain: TypeScript 7.0.2, Vite 8.3, Vitest 5, tsx for the sim. CI on Node 24. Pages deploys via Actions (repo Settings > Pages > Source = GitHub Actions when the repo exists). |

## Work packages

### M0: Foundations
| WP | Agent | Status | Owns | Depends |
|---|---|---|---|---|
| 0.1 Scaffold: Vite + TS strict + singlefile + Vitest, fonts, npm scripts, size guard, launch.json | builder-medium | ✅ accepted | package.json, tsconfig, vite.config.ts, index.html, placeholder src/main.ts, scripts/check-size.mjs, .claude/launch.json, CLAUDE.md Commands | — |
| 0.2 Architecture skeleton: loop, time director, core contract, renderer, camera, particles core, input, UI mount, audio bootstrap, debug panel | builder-max | running | src/** (all stubs + infra), ARCHITECTURE.md | 0.1 |
| 0.3 CI + Pages workflows (written, not pushed) | builder-medium | ✅ accepted | .github/workflows/** | 0.1 |

### M1: First Blood ★ (after 0.2)
| WP | Agent | Status | Owns (planned) | Depends |
|---|---|---|---|---|
| 1.1 Meadow backdrop + palette + eye in the hills | builder-high | — | src/render/backdrop/**, palette values | 0.2 |
| 1.2 Dragon rig v1 + newt species + weak spot + hit test | builder-max | — | src/render/dragon/** | 0.2 |
| 1.3 Knight crowd: sprites, formation, hero, strike/flung/cheer, banners | builder-high | — | src/render/crowd/** | 0.2 |
| 1.4 Juice: particle presets, damage numbers, hit-stop, shake, coins to HUD | builder-high | — | src/render/fx/** | 0.2 |
| 1.5 Economy core: Decimal math, HP/gold, units, upgrades, milestones, crits, dragon phases | builder-high | — | src/core/** | 0.2 |
| 1.7 SFX v1 | builder-high | — | src/audio/** | 0.2 |
| 1.6 HUD, Army + Upgrades panels, title overlay, progressive disclosure | builder-medium | — | src/ui/** | 1.5 |
| 1.8 Meadow text: dragon names/epithets, unit + upgrade flavor, microcopy | writer | — | src/core/content/text*.ts | 1.5 |
| 1.9 Balance sim v0 (tier 0 pacing) | builder-high | — | src/sim/** | 1.5 |

## Log
- 2026-09-22: Kickoff. Open questions answered. Git initialized, plan committed (4403f84).
- 2026-09-22: 0.1 scaffold + 0.3 CI accepted, `npm run check` green, build 103 KB (52b595b). 0.2 launched.
