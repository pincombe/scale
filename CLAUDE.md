# SCALE

SCALE is an infinite idle game about knights and dragons, built for a competition against a friend's AI. Judges play for 10–20 minutes in one sitting and pick a winner on **visual wow & game feel** and **originality**.

- **PLAN.md** is the design source of truth. Read the sections that matter for your task before you start.
- **BUILD_LOG.md** is the live status: work packages, decisions, next steps.
- The main session is the **build lead**, and its operating rules are in **KICKOFF.md**. Subagents don't need KICKOFF.md: your brief and your agent definition tell you what to do.

## Hard constraints
- Ship one self-contained `dist/index.html` under **1 MB raw**. No runtime network requests, and no image or audio files: all art and sound is procedural.
- Desktop Chrome, Safari and Firefox. Avoid Chrome-only APIs (e.g. canvas `ctx.filter`).
- 60 fps on an Apple-silicon MacBook with 300 knights and 1,500 particles on screen.
- The first 15 minutes are the product: tiers 0–4 get polish first.

## Architecture
- `src/core/`: pure, deterministic game logic (state, formulas, `tick(dt)`, actions, content tables, saves, offline catch-up). No DOM, canvas or audio imports, so it all runs in Node for tests and the balance sim.
- `src/render/`: Canvas 2D renderer (camera, backdrops, dragon rig, knight crowd, particles, post FX, zoom director).
- `src/audio/`: WebAudio synthesis, SFX, generative music.
- `src/ui/`: DOM HUD and panels.
- `src/sim/`: headless balance simulator.

## Commands
- `npm run dev`: Vite dev server (launch.json `dev`, port 5173)
- `npm run build`: build the single self-contained `dist/index.html`
- `npm run preview`: serve the built file (launch.json `preview`, port 4173)
- `npm run typecheck`: `tsc --noEmit`
- `npm test`: Vitest once (`npm run test:watch` to watch)
- `npm run sim`: headless balance sim in Node (`tsx src/sim/run.ts`)
- `npm run size`: size guard on `dist/index.html` (fails over 1 MB or on external refs)
- `npm run check`: typecheck, test, build and size in one go. Run before reporting.

## Conventions
- TypeScript strict. Economy numbers use `Decimal` (break_infinity.js).
- Hot render paths: no per-frame allocations, pooled particles, cached static layers.
- Match the surrounding code. Keep modules small and focused.

## Verification
- Every change: typecheck, tests and build pass.
- Visual changes: run it and look (dev server via `.claude/launch.json`, and `?debug` for the FPS overlay and tier jumps). Check the console for errors.
- The in-app browser is shared. Open your own tab for checks, close it when done, and never drive a tab you didn't open.

## Rules for subagents
- Stay inside the files your brief gives you. If you must touch anything else, say so in your report.
- Don't commit, push or change git state. The lead does that.
- If the brief is ambiguous or you're blocked, stop and report back rather than guessing at design decisions.
- Finish with a short report (~200 words max): what changed (files), how you verified it, anything unfinished or risky, and any decisions the lead should know about.
