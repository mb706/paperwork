# C6: Asset pipeline v0 (Survey)

**Owner:** one Opus agent, working in its own git worktree (the manager sets this up).
- **Commits:** commit your work to the worktree's branch at milestones, with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. The manager merges your branch into `dev`.
- **Writes to:**
  - `game/assets/**` (sources: `blender/`, `svg/`, `textures/`);
  - `game/scripts/assets/**` (the asset build);
  - the `npm run assets` wiring in `game/package.json` and `game/scripts/` (coordinate the minimal touch: one script entry);
  - `game/public/` outputs only through the build (atlases, sheets, fonts, the manifest), and only if the spec says they are committed rather than built;
  - `CLAUDE.md` (an assets subsection);
  - `pm/reports/C6.md`.
- **Must not touch:** `design/**`, `game/schema/`, the generated code, `game/src/**` (the TypeScript loader belongs to the renderer package), or the crates.

## Why

M0 is building the engine in parallel packages against fixed contracts. The asset pipeline is the art half of the renderer's contract: the **sprite manifest and atlases** of 10 §15.7 and §9. The *Survey* art direction was approved by the user ("let's go ahead with the 'Survey' look!"), and its look must come out of this pipeline at production quality, headlessly, on this host.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md` (decision 5, the art direction).
- `design/art/DIRECTION.md`, the style guide, and `pm/reports/A3.md`. The prototype pipeline in `design/art/proto/` is your starting point, so reuse what works.
- `pm/reports/B2.md`, including its review response.
- `design/spec/10-architecture.md`:
  - **§9 in full** (the asset pipeline, texture formats, render-only-what-moves, budgets, §9.7 loading);
  - **§15.7** (the projection and the sprite manifest, with its explicit index tables);
  - §6 (rendering: projection, layers, shadows and lights, §6.13 GPU memory);
  - §11 (budgets);
  - §12 (M0's asset row and M1's asset lines);
  - §2.2–§2.3 (layout and commands).
- `design/spec/09-vertical-slice.md` §2.7 (what M1 draws) and `game/data/engine/capabilities.yaml` (what M0 draws).

## Deliver (M0 scope, built to last into M1)

1. **The pipeline**, reusable and scripted, with every step in `npm run assets` and cached by content hash in `.cache/assets/`:
   - the rig: the camera and projection exactly per §15.7, and the lighting per DIRECTION;
   - the Survey passes: wash tones, ink, hatching, light and emission;
   - compositing;
   - **render only what moves**: a static base plus animated layers, composited as §9 now specifies (B2 fixed the double-compositing problem; follow its scheme);
   - packing into texture-array pages with block-aligned padding through the lowest mip;
   - **KTX2 encoding** per §9.2 with `basisu`: install basisu 2.50 in user space per `CLAUDE.md`'s layout if it is not there, and add it to `tools/check-toolchain.sh`;
   - the **sprite manifest** with explicit index tables (§15.7) and its schema check;
   - contact sheets;
   - A3's legibility metrics.
2. **Greybox auto-models** for every entity in `design/spec/data/entities.yaml`: footprint- and height-correct boxes in the Survey style. That way the renderer can draw anything from day one, and real models replace greyboxes one at a time.
3. **The projection calibration test** (§9.1): a rendered calibration grid that proves the sprites land exactly on tiles under the engine's projection.
4. **Real Survey art for M0's set**, at the quality of A3's final mocks:
   - the character, with walking and idle clips in the directions §15.7 defines;
   - the chest;
   - worldgen v0's terrain tiles with transitions;
   - the M0 resource, with its depletion bands as §15.7 defines them;
   - the item icons for M0's items;
   - the basic UI skin parts: 9-slice frames and slots in the 1945-paperwork style.

   Also the font subsets (WOFF2, OFL, licences recorded), if §9.3 assigns them to the asset build.
5. **A tiny compatible atlas** that the golden integration set can use (C1c will reference it). Coordinate through the manifest format only.
6. **Budgets measured:** render time, MB on disk and GPU MB for what you built, and the extrapolation to M1 against §9.6 and §11.

## Quality bar

- **View every image you produce** (Read the PNG) and judge it the way A3 did: honestly, as a demanding art director. The user will see these in the M0 smoke screenshot.
- **Determinism:** the same inputs give byte-identical outputs, or the differences are documented; for example, if Cycles noise is seeded, say so.
- **Pinning:** heavy renders use `taskset -c 8-15,24-31`, with Cycles threads at 16 or fewer. Other agents run CI on CPUs 0–15.

## Report

`pm/reports/C6.md`, using the template. Your final message is at most 200 words.
