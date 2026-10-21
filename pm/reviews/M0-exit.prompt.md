You are an independent QA lead auditing the **M0 exit** of the browser game *Paperwork*: a Rust→WASM deterministic sim, a TypeScript worker shell, a WebGL2 renderer, a SolidJS UI and WebAudio. The integration and QA package C8 claims every M0 exit criterion of `design/spec/10-architecture.md` §12 passes. Its exit table and evidence are in `pm/reports/C8.md`, with screenshots in `pm/reports/C8/`. C8's own code is in the commits fd4e4d4..d3906dd: the test harness, benchmark runners, dev endpoints and the free-port Playwright config.

Do two things:
1. **Audit the exit claims.** For each M0 exit criterion in §12, check that the cited test or command really verifies it, not a weaker proxy, and that it is in `npm run ci` or otherwise reproducible. Re-run the cheap ones read-only where you can, such as `cargo test`, `npx vitest run`, or `node` scripts that only read. Flag any criterion whose evidence is weaker than claimed.
2. **Review C8's code:**
   - harness correctness: whether the cross-engine trace really compares the full canonical state or only digests;
   - flakiness risks: timing-based tests, ports, shared caches;
   - the dev endpoints' safety: `/__report` writes files, so path traversal and size limits matter, and it must be dev-only;
   - the benchmark runners' methodology;
   - CI time: it is now about 3 minutes; how could it be cut without losing coverage?

You may view the screenshots (pass them as images). Do not modify any files.

Output: at most 1,500 words.
- First, a table of each exit criterion: verified / weakly verified / not verified.
- Then the prioritized findings, tagged Critical, Major or Minor, each with the file and line and a fix.
- End with the verdict line "M0 EXIT: PASS", "M0 EXIT: PASS WITH FIXES (list)" or "M0 EXIT: FAIL".
