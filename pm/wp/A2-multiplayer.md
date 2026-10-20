# A2: Multiplayer architecture

**Owner:** one Opus agent. **Writes only to:** `design/multiplayer/**` and `pm/reports/A2.md`.

## Why

The user wants multiplayer: friends and colleagues building one factory together. It will be implemented near the end of the project, but the engine must be designed for it **from the first line of code**, so this design has to exist before M0 begins.

The user's constraints, verbatim in substance:
- **Clients are trusted.** There is no competitive play; players are colleagues or close friends.
- **The server that hosts the website must not do the major compute.** It may relay, sequence and store, but it does not run the simulation.
- **Syncing must work well.**
- **Consider NAT hole punching.** Is there a way to punch NAT holes that has a realistic chance of working on modern domestic internet? A fallback is fine when it fails for some players, but **all of this must be transparent and invisible to the user**.
- **No peer-to-peer UDP.** Firewalls at the user's site block the entire client machine on that kind of "suspicious" traffic. That rules out the usual WebRTC data-channel P2P path. Analyse precisely what remains: ICE-TCP, TURN over TCP/TLS, WebSocket, WebTransport (client–server QUIC over UDP 443, which is not P2P but may still trip such firewalls), and so on. Be concrete about what browsers actually support today.

## Read

- `CLAUDE.md` and `pm/README.md`.
- `design/spec/10-architecture.md`:
  - §0, §3 (threads, the protocol, tick loop and pacing, the view model);
  - §4.1–§4.3 (the determinism contract, units, ids and RNG), §4.6 (scheduling);
  - §5.1–§5.2 (character, inventories, crafting queue, construction, undo, blueprints);
  - §8 (persistence: save container, replays, input logs);
  - §10.4 (determinism tests).
- Skim `design/spec/07-ui.md` for every UI surface that would need multiplayer additions (player list, chat, per-player state).
- `design/DECISIONS.md` for anything that is per-force or per-player.
- Research Factorio's multiplayer architecture: the Friday Facts on deterministic lockstep, latency hiding, desyncs, map download and catch-up, and the server's role as input sequencer. Also look at other browser-native lockstep or rollback games.
- Use WebSearch/WebFetch (load them through ToolSearch) and cite your sources.

## Produce `design/multiplayer/DESIGN.md`, a complete, implementable design

1. **Model.**
   - Deterministic lockstep, Factorio-style, is the expected answer. Justify it or overturn it against the alternatives (authoritative server sim, rollback, state sync).
   - Decide who sequences input actions: the relay server (stamping ticks, no sim) or a hosting client, with the relay as a dumb pipe. Cover host leave and migration, and a game that outlives its host.
2. **Transport and NAT.**
   - Give the full analysis under the no-P2P-UDP constraint, with a clear verdict on hole punching.
   - Give the transport stack with its fallbacks, and how fallback stays invisible to players.
   - Cover TLS on 443 and reconnects (mobile networks, laptop sleep).
   - Give the bandwidth per player for actions, heartbeats and joins.
3. **The tick protocol.**
   - Action format: tick-stamped, per-player, serialized.
   - Input delay and latency hiding: local prediction of the player's own character movement, mining, building previews, GUI responsiveness. Say what may be predicted and what must wait for the confirmed tick.
   - Pacing when a client is slow, catch-up after a stall, and the heartbeat.
   - What the simulation needs per player: character, inventory, hand/cursor, crafting queue, per-player GUI state that is not sim state, and permissions (trusted).
4. **Joining.**
   - Map transfer while the game runs: snapshot at tick T, buffered actions, fast-forward catch-up.
   - Where the snapshot comes from and passes through.
   - Save sizes per 10 §11, compression, chunked transfer, resume.
5. **Desyncs.**
   - Detection: a periodic state hash, its cadence and cost per 10 §4 and §8.
   - Automatic recovery that the user does not notice: a re-sync from the sequencer's or host's state.
   - Debug bundles so that desyncs can be fixed: diff two states.
   - Which simulation rules M0 must follow so that desyncs are structurally rare. This must be a precise checklist that the engine work packages will enforce.
6. **The server.**
   - What it is: a minimal relay and sequencer, probably a single small Node process (`ws`), deployable next to the static site.
   - Optionally say whether a Cloudflare Workers / Durable Objects deployment is viable as an alternative.
   - Rooms, invite links and codes, light auth, rate limits, persistence (may it store saves?), and observability.
   - Its CPU and bandwidth cost per room.
7. **Engine seams for M0.** These must exist from day one even though networking comes later:
   - the action pipeline and its types, the transport abstraction, the player index everywhere, and the separation of sim state from UI state;
   - how single-player is simply "multiplayer with a local transport", so the path is exercised from the start;
   - replays and input logs reused for desync debugging.
   - Mark each seam *M0-mandatory* or *later*.
8. **UI and UX.** Main-menu flows (host a game, join by link, a lobby?), the in-game player list, chat, per-player cursors and labels, and connection-quality indicators. Follow Factorio's multiplayer UI where it exists.
9. **The test plan.**
   - Headless multi-client tests (two or three Playwright pages or Workers plus a local relay), with simulated latency, jitter, packet reorder and disconnects.
   - Determinism fuzzing.
   - What must be green before multiplayer ships.
10. **Risks and open questions**, ordered by importance.

## Also

- WP A1 is benchmarking TypeScript against Rust/WASM for the simulation in parallel. Write the design so it holds for either, and point out where the language choice changes the multiplayer risk. Rust/WASM gives in-module math and determinism by construction; JS needs discipline.
- A small **proof of concept is welcome but optional**: for example a 100-line relay plus two headless clients exchanging tick-stamped actions with simulated latency, to validate timing and pacing assumptions. Put it in `design/multiplayer/poc/`.
- Keep the design realistic for a two-to-eight-player co-op game. Do not over-engineer for MMO scale.
