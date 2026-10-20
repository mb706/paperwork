# C4: Renderer v0 and the asset loader (M0 Renderer package)

**Owner:** one Opus agent, in its own git worktree (the manager sets it up). Commit to your worktree branch at milestones, with messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The manager merges.
- **Writes to:**
  - `game/src/render/**`;
  - `game/src/assets/**`: the main thread's asset loader and the asset worker with the Basis transcoder (§9.2, §9.7);
  - render wiring in `game/src/app/`, keeping it minimal and documented;
  - renderer tests and Playwright gallery screenshots under `game/e2e/`;
  - `CLAUDE.md` (a short renderer section);
  - `pm/reports/C4.md`.
- **Must not touch:** the crates, the schema and generated code, `ui/`, `audio/`, the sim worker, `design/**`, the golden set.

## Context

The M0 contract gate has passed. The fake sim (`?sim=fake`) and the frozen golden set (`game/test/golden/`, with a **tiny compatible atlas** and the sprite index fixtures) exist.

The **real Survey atlases** come from the asset pipeline (C6), which is being built in another worktree in exactly the §15.7 manifest format. When it lands on `dev`, the manager asks you to merge and switch.

The art direction *Survey* was approved by the user, so the renderer must reproduce it faithfully:
- the paper ground and washes;
- ink;
- the warm-stain light pass;
- the cyanotype night.

Each of these must happen in exactly one pass, as §6.2 and §9.8 now assign them.

## Read

- `CLAUDE.md`, `pm/README.md`, `pm/DECISIONS-IMPL.md` (decisions 1 and 5).
- `game/schema/README.md`; the golden set's README; `pm/reports/C1c.md` ("How each package consumes the golden set").
- `design/art/DIRECTION.md`.
- `design/spec/10-architecture.md`:
  - "Changes in v2";
  - **§6 in full**: the decision, the frame structure, the batcher, atlases and the manifest, terrain, layers, shadows and lights, animation, overlays, zoom and map, budgets, GPU memory;
  - **§9.2** (texture formats: KTX2 XUBC7 to BC7, ETC1S to BC4, the fallbacks), §9.7 (loading and streaming) and §9.8 (the look as shaders);
  - **§15.4** (the render packet and belt-item expansion from gap arrays) and **§15.7** (the projection and the sprite manifest with explicit index tables);
  - §3.4 (the view model);
  - §12 (M0 scope and exit).
- The measurements in Appendix A (WebGL2 on SwiftShader: expanded quads beat instancing 5–30×).

## Deliver

1. **The batcher:** expanded quads, a static index buffer, texture-array atlases. Also the camera and zoom (Factorio's zoom levels and feel), layers and sorting, and culling.
2. **The asset loader:**
   - manifest parsing with the explicit index tables;
   - KTX2 transcoding in the asset worker;
   - the compressed-texture capability probe and its fallbacks, as §9.2 specifies;
   - placeholder drawing until pages arrive;
   - GPU memory accounting (§6.13).
3. **Terrain:** the terrain shader with tiles and transitions, from the worldgen tiles. Shadows and the light pass at M0's scope. The Survey grading (paper, washes, night LUT) in its one assigned pass.
4. **Belt items** from gap arrays (§15.4), and the `DYN` records' animation.
5. **F4/F5 debug overlays** (§6.9 and §3.5): chunk grid, collision boxes, the timings HUD.
6. **Tests:**
   - Vitest for packet decoding into draw lists, using the golden packets;
   - Playwright **gallery screenshots** of the golden packets with the tiny atlas, and of the fake sim scene, at 1× and 0.3×;
   - frame-time measurements on SwiftShader, against §6.12, scaled by the host factor.

   View every screenshot you produce (Read the PNG) and judge it critically. The user will see these.

## Quality bar

- **Main-thread frame budget** per §6.12 and §11.
- **No per-frame allocation** in steady state.
- **WebGL context loss** handled.
- **Pixel-exact sprite placement:** the projection calibration from C6 must line up. Use the tiny atlas's calibration sprite if it has one.
- `npm run ci` is green in your worktree.
- Pin heavy jobs with `taskset -c 0-15`.

## Report

`pm/reports/C4.md`. Your final message is at most 200 words, and includes your worktree path and branch.

## Notes added by the manager after the gate
- **Fake mode builds:** the fake sim uses the **M1** prototype build (it needs belts, inserters and machines), while the M0 art and atlases come from the M0 build. The spec makes a prototype-hash mismatch an error in dev builds. In `?sim=fake` mode, match by name instead, and document the exception (C1c open issue 4).
- **Asset cache:** copy the warm asset cache from the main tree (`cp -a /home/mewse/browsergame/game/.cache/assets <worktree>/game/.cache/`). A cold `npm run assets` takes 12 minutes.
- **Atlas format:** the fixture atlas (`game/test/fixtures/sprites/`) declares a linear transfer function and premultiplied alpha (C6-r1). Follow the KTX2 metadata.
