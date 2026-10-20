# 11 — Multiplayer

*WP A2 (2026-10-20), revised after codex review A2-r1; made a chapter of the spec by WP B1 (architecture version 2), which moved the engine seams and the determinism rules into chapter 10. Binding decision: `pm/DECISIONS-IMPL.md` 4. The study record, with the proof of concept and its raw results, stays in `design/multiplayer/` (`DESIGN.md`, `poc/`); this chapter supersedes `DESIGN.md`. Cited as **10 §x** (the engine), **07 §x** (UI) and **I §x** (round 1's `I-ui-controls.md`); web sources as [n] (Appendix A); codex's review findings as **A2-r1 #n** (`pm/reviews/A2-r1.md`).*

**Status.** Normative for the **MP milestone** (10 §12), which comes after M4. The engine seams of §7 and the determinism rules D1–D23 (10 §4.1) are **M0-mandatory** and are specified in chapter 10; everything else in this chapter is built in the MP milestone. Numbers marked *measured* come from the proof of concept (§12) or the engine study (10 Appendix A).

**The user's constraints, restated.** Friends and colleagues build one factory together, two to eight players. Clients are trusted. The server that hosts the website may relay, sequence and store, but it does not run the simulation. Syncing must work well. Peer-to-peer UDP is out, because the firewall at the user's site blocks a whole machine for that kind of traffic. Any fallback must be invisible to players.

**One-paragraph answer.** Every client runs the whole deterministic simulation (Factorio's lockstep). A small relay owns the tick clock: clients stamp their actions with the tick they expect to execute in, and the relay accepts them, moves late ones to the next open tick, and broadcasts each closed tick's action list to everybody. The relay never simulates. One WebSocket over TLS on port 443, same origin as the website, carries the tick stream, and a second carries bulk snapshot transfers. No NAT hole punching is attempted: from a browser it exists only as WebRTC over UDP, which is exactly what the user's firewall punishes, and a relay-sequenced game gains nothing from it. Joiners load a snapshot that a playing client serializes at a sequenced tick and the relay forwards; they then fast-forward the actions buffered since. Desyncs are found by a cheap per-tick digest that clients report twice a second, and are repaired by a background re-sync that the player does not see, with a checked fallback to a visible one. The relay writes every tick before broadcasting it, so a crash cannot fork the game's history. The engine prepares all of this from M0: single player is multiplayer with a local sequencer.

---

## 0. Decisions at a glance

| # | Area | Decision | Main reason | Rejected |
|---|---|---|---|---|
| 1 | Model | **Deterministic lockstep**: every client simulates everything; only input actions travel (§1) | Bandwidth is independent of factory size; the only model in which the server does no simulation at 150k entities | Authoritative server simulation; host-authoritative state streaming; rollback; state synchronisation |
| 2 | Sequencer | **The relay** owns the tick clock and the order of actions. It never simulates (§1.3) | No host to lose or migrate; the game outlives every player; one clock | A hosting client that sequences while the relay is a dumb pipe |
| 3 | Tick stamping | **Clients stamp target ticks** (their estimate of the relay's open tick plus an adaptive margin). The relay accepts on-time actions as stamped, moves late ones to the open tick and says by how much, and never puts a player's action before that player's previous one (§3.4) | Exact local prediction: in the PoC, 0–5% of walk inputs mispredicted on LAN, home and far links (only late or reordered ones), against 2–35% on LAN and home links and 32–54% on a far link when the relay stamps on arrival. Factorio's own scheme (FFF-302 [4]) | Stamping on arrival at the relay |
| 4 | Transport | **WebSocket over TLS on 443, same origin as the site**: a control socket for the tick stream and a bulk socket for snapshots (§2.4) | Works in every browser, and through nearly every network that allows HTTPS (some proxies refuse WebSocket upgrades: §2.5); one TCP flow to one host is the least suspicious traffic there is | WebRTC data channels (P2P UDP); ICE-TCP (cannot connect two browsers); TURN over TLS (a relay with extra layers); WebTransport by default (UDP 443) |
| 5 | NAT | **No hole punching, ever.** Everything goes through the relay (§2.3) | Browsers can only punch through WebRTC/UDP, which the user's site penalises; with a relay sequencer, P2P would not shorten the critical path | STUN/ICE, TCP simultaneous open |
| 6 | Joining | **A complete checkpoint from a playing donor**, written after a sequenced marker tick and sent as a verified transaction (an immutable manifest, unique chunks, a hash) through the relay, which caches it; then a fast-forward through the buffered ticks. Transfers are paced so the donor's own game does not lag (§4) | Factorio's flow without a simulating server; the relay keeps the latest snapshot for later joins | A relay-side save (it would need the simulation) |
| 7 | Desyncs | **Per-tick digest + key-chosen slice hash**, with its lineage saved in checkpoints, reported every 30 ticks with an epoch; verdicts kept for the 60-s maximum lag; majority vote with an anchor tie-break; **background re-sync** (a shadow sim catches up and is swapped in) whose progress is checked, falling back to a foreground repair (§5) | Detection within about a second for most divergence and within a minute for any; repair the player does not see, when the machine can afford it | Disconnect-and-rejoin as the repair (Factorio's); full hashes every tick (100 ms each in the late game) |
| 8 | Server | **One Node 24 process** with `ws` 8.22.0, behind the site's TLS proxy; rooms, invites, snapshot and log storage, metrics. Under 1% of a 2013 Xeon core per four-player room (§6) | Tiny, testable on this host, deployable next to a static site | A game server; a managed realtime SaaS. Cloudflare Durable Objects are a viable alternative (§6.7) |
| 9 | Engine | **Closures are the only input of the simulation; single player runs through a `LocalSequencer`.** `World.players[]` exists from M0. Determinism rules D1–D23 (10 §4.1) and seams S1–S15 (§7) are M0-mandatory. The simulation is Rust compiled to WebAssembly (10 §0 #1; §1.4) | The multiplayer path is exercised by every test from day one | Adding players and a network layer later |
| 10 | Hidden tabs | **In multiplayer the game never pauses.** The simulation worker is driven by arriving ticks, not timers, and catches up or re-syncs after the browser freezes it (§3.6) | Measured in Chrome 156: hidden-tab main-thread timers drop to 1 Hz then to once a minute, worker timers stay at 50–60 Hz, frozen tabs stop entirely (§12.5). Background execution is best effort in every browser (§2.2) | Pausing a player's simulation while their tab is hidden |
| 11 | Relay durability | **Every closed tick is written to the room's log before it is broadcast**; every relay start opens a new room generation, and clients resume only within it (§6.9) | A relay crash can never fork the action history: a process crash loses nothing, and a machine crash rewinds at most 1 s for clients that are ahead | Re-adopting closures from the first client to reconnect (unsafe: other clients may hold longer histories) |

---

## 1. The model

### 1.1 What the game demands

- **State.** A late game has about 150k entities, 250k belt items and 5k agents (10 §11). The saved state is 50–100 MB raw and 10–25 MB compressed (10 §8.1); much of it changes every tick.
- **Compute.** About 2 ms per tick on the reference laptop at Late scale by 10 §4.7's measured model (round 5 estimated 4 ms, which this chapter's tables keep as a conservative case), 12 ms allowed (10 §11).
- **Rate.** Fixed 60 UPS; a game's speed is set by its rules, not by the network.
- **People.** Two to eight trusted players, mostly in one country, sometimes one far away.

### 1.2 The alternatives

| Model | How it works | Cost here | Verdict |
|---|---|---|---|
| **Deterministic lockstep** (Factorio [1], OpenTTD, RTS games) | Every peer runs the same simulation from the same inputs in the same order; only inputs travel | About 6 kB/s per player whatever the factory size (§2.7); a join transfers one save; requires bit-identical simulation | **Chosen** |
| Authoritative server simulation | The server simulates and streams state | The server does the major compute: excluded by the user. At 0.3–4 ms per tick it would also cost 2–24% of a server core per room | Excluded |
| Host-authoritative state streaming | One player's browser simulates and streams the visible state to the others | Streaming even the visible part (20k sprites, 50k belt items changing every tick) costs megabits per viewer from a domestic uplink. The game dies with the host. Factorio rejected state transfer because "Factorio game state is too big to transfer over network" (FFF-83 [2]) | Rejected |
| Rollback (GGPO) | Clients predict other players' inputs, save state every tick and re-simulate on misprediction | Saving 50–100 MB per tick and re-simulating 5–10 ticks at 4 ms each per correction is impossible at Late scale | Rejected for the world. Its idea survives as local prediction of one's own character (§3.5) |
| State synchronisation with interest management (Mindustry-style) | The server or host sends entity deltas near each player | The same bandwidth problem, plus a second, divergent code path for remote entities | Rejected |

### 1.3 Who sequences: the relay

Lockstep needs one authority that decides which actions belong to which tick. There are two candidates.

| | **Relay sequencer (chosen)** | Hosting client, relay as a dumb pipe |
|---|---|---|
| Path of an action | client → relay → all clients | client → relay → host → relay → all clients |
| Latency for player *i* | its own RTT to the relay | its RTT plus the host's RTT, and the host's jitter for everybody |
| Clock | the relay's, which never sleeps or throttles | a browser tab that the OS or browser may throttle, freeze or close (§3.6) |
| Host leaves | nothing happens: there is no host | host migration: elect a new host, agree on the last sequenced tick, re-route |
| Game outlives its creator | yes, by construction | only after migration |
| Server cost | a timer and a few hundred small sends per second per room (§6.6) | slightly less |

**Decision: the relay sequences.** The constraint allows it ("relay, sequence and store"), it removes host migration from the problem, and the sequencer is the one component that must never be suspended by a browser.

**Roles that remain.** The player who creates a room is its *owner* (an admin, as on a Factorio server): they can kick, promote and pause, and change room settings. The owner's leaving changes nothing in the game; admin rights can be held by several players. A room is the relay's object, so it outlives everybody who played in it (§4.6, §6.4).

**What the relay cannot do, and who does it instead.** It cannot validate actions, save the game or judge a desync by itself.
- **Validation** is the simulation's job on every client, identically: an invalid action fails the same way everywhere (10 §3.2). Clients are trusted, so the relay only checks framing and rate limits.
- **Saves** come from a playing client, the *donor* (§4).
- **Desync arbitration** is a vote of the clients' digests (§5.2).

**Precedents.**
- Factorio has done relay-merged lockstep since 0.14. The server merges every player's actions for a tick into one package for all clients, and a player with a lag spike can be left out of a package so that the others are unaffected (FFF-147 [3]). Since 0.14 the server no longer pauses the game when one player's computer falls behind (Alt-F4 #26 [7]). Factorio's server also simulates; ours does not, which is why snapshots come from donors.
- Croquet/Multisynq is the closest browser-native precedent. Its *reflector* timestamps every event and sends it back to all replicas, sends empty timestamped heartbeats when there is no traffic, never computes, and periodically asks a participant for a snapshot that late joiners load before replaying the events since [12].
- Photon Quantum is a commercial deterministic engine. Its default server plugin "manages input timing and delivery" and is the clock source; "the local client runs the game", and late input is replaced by the server [13].
- OpenTTD is lockstep with a simulating server. It schedules commands into a future frame (its `frame_freq` input delay), compares RNG seeds every `sync_freq` frames, and kicks a desynced client so that it re-joins [15][16].
- Browser libraries for lockstep and rollback exist, but they run peer-to-peer over WebRTC data channels (NetplayJS [40]), which is excluded here.

### 1.4 Simulation language and multiplayer risk

The simulation is Rust compiled to WebAssembly, as a clean split (10 §0 #1, §3.6; WP A1). One crate holds the World, every system, saves and digests, in the simulation worker; TypeScript keeps the shell, the **network** code, UI, renderer and tools. For multiplayer that decision means:

- **The engine and float class is gone by construction.** Every peer runs the same `sim.wasm`, with its transcendental functions compiled in from the `libm` crate, so browsers cannot disagree the way Firefox and Chrome do on 492 of 16,000 `Math` results (10 Appendix A). Measured: the same results natively and in Node, Chrome and Firefox (10 Appendix A). What remains, NaN payloads, `min` and `max` on −0, fused multiply-add and relaxed SIMD, is banned (D19).
- **The logic class is not.** Iteration order, unsaved state, stale caches and the order of float sums are equally possible in any language, and they dominate in practice. OpenTTD's desync guide lists incomplete savegames, cache mismatches, undefined ordering (sorting equal keys) and state changed outside commands [16], and Factorio built "heavy mode" (save, load and compare every tick) to find exactly these [6][14]. A1 found one in our own spec: round 5's swap-remove active list broke NO_SLEEP equivalence once inserters compete (D3). D1–D23 and their tests exist for this class.
- **Catch-up is faster.** WebAssembly ran 1.35–1.75× faster per tick than the TypeScript kernel in every engine, and 2–4× faster in the first ticks after a load, without speculative-deoptimisation stalls (A1). Joins and repairs finish sooner, and the slow-machine threshold (§3.6) is reached later.
- **A fatal error is a trap** that kills the module. The client treats it like a desync on itself (§5.2).

The simulation-side seams (S1, S2, S5, S7, S9, S10, S15) live in the crate behind the boundary of 10 §3.6: actions enter as closures copied into linear memory (10 §15.3), and checkpoints and digests come from the crate (10 §4.8, §8.6). The net worker, the sequencer interface, the relay and the world-replacement protocol stay in TypeScript.

## 2. Transport and NAT

### 2.1 The firewall at the user's site

The user works in the Munich Scientific Network (MWN), run by the Leibniz Supercomputing Centre (LRZ). Its NAT gateway, the *Secomat*, documents its rules. During a connection it measures the number of packets to and from certain destinations and compares them with protocol-specific limits. A host that tries "to reach one destination port on many different destination hosts" is classified as a scanner or DoS attacker (quotations in this paragraph are translated from the German); each exceeded limit earns a penalty point, and **120 points within a sliding 15-minute window block the host's Internet access automatically** until the score falls again. Individual limits exist for TCP 25, 80 and 443 and for UDP 53; every other protocol has "a generous general limit" [19]. LRZ's newsletter describes the classic victim: a machine that became a Skype supernode, whose many outgoing UDP connections were scored as a port scan and blocked [21]. Beyond the Secomat, the MWN monitors "anomalies in connection count and combination" with a three-stage escalation that ends in blocking [20].

**What this means for us.**
- WebRTC peer-to-peer is the worst case. ICE sends connectivity checks from one local UDP port to every remote candidate (host, server-reflexive and relayed, IPv4 and IPv6) of every peer, and repeats them on every ICE restart. That is a fan-out of UDP flows to many destinations, which is what the scan heuristic scores.
- QUIC to one server on UDP 443 is ordinary web traffic (HTTP/3), but it falls under the general limit, whose value is not published. A 60-packet-per-second game stream is an unusual profile. We cannot test it there without risking the user's machine.
- **One TLS connection on TCP 443 to one host, at about 60 small packets per second, is far below any HTTPS limit**: a video stream in a browser sends several hundred packets per second to one host. This is the only transport we can call safe without testing it on the user's network.

### 2.2 What browsers can do (October 2026)

| Option | What it is | Browser support | Under the no-P2P-UDP rule |
|---|---|---|---|
| **WebSocket (`wss:`)** | Client–server, TCP, TLS on 443, starts as an HTTP Upgrade | Every browser, also in dedicated workers | **Allowed. The transport** |
| WebRTC data channel, P2P | SCTP over DTLS over ICE (UDP), with STUN hole punching | Every browser | **Excluded**: P2P UDP, and the ICE fan-out described above |
| WebRTC ICE-TCP between two browsers | ICE candidates over TCP | Browsers gather only *active* TCP candidates (port 9 placeholders) and never listen; Firefox: this "won't help improve direct connectivity between two WebRTC enabled browsers" [17]. Simultaneous open is not implemented | **Impossible** between two browsers |
| WebRTC via TURN over TLS on 443, relay-only (`iceTransportPolicy: 'relay'`) | Both peers talk TLS/TCP to a TURN server, which relays between their allocations | Every browser; deployments use it for HTTPS-only firewalls [18] | Allowed, but it *is* a relay: ICE, DTLS and SCTP over TURN over TLS over TCP, with TCP's head-of-line blocking underneath, a coturn to operate, and nothing gained over a WebSocket to our own relay. **Rejected** |
| **WebTransport** | Client–server HTTP/3 over QUIC (UDP 443): reliable streams without cross-stream head-of-line blocking, plus unreliable datagrams | Chrome, Edge and Firefox over HTTP/3; Safari since 26.4 (March 2026). "Baseline 2026" on MDN; available in workers [22][23] | Client–server, not P2P, but its first attempt is UDP. **Fallback differs by browser** (A2-r1 #16). Safari 26.4 runs WebTransport "over HTTP/2 and TCP as a fallback with the same API" when QUIC is unavailable [42]. For Chrome and Firefox I could verify only HTTP/3: the HTTP/2 mapping is an IETF draft (rev. 14, March 2026) [24], Chrome's ship excluded it [25], and Mozilla called it "upcoming" in February 2026 [43]. Either way, the automatic QUIC attempt is the risk on the user's network, and an HTTP/2 fallback offers nothing a WebSocket does not. **Not in version 1**; possible later as an opt-in (§2.5) |
| HTTP streaming (`fetch` with a streamed response, plus POSTs) | Long-lived HTTPS | Streamed responses everywhere; streamed uploads only in Chromium | A last-resort fallback if a proxy strips WebSocket upgrades. **Later, only if seen in the wild** |
| Direct Sockets API | Raw TCP/UDP | Chromium Isolated Web Apps only | Not applicable to a website |

**Capability matrix** (version-specific; rechecked at every multiplayer release, with release Safari tested beside Chrome and Firefox):

| | Chrome 156 | Firefox 157 (release) | Safari 26.4 |
|---|---|---|---|
| WebSocket in a dedicated worker | yes | yes | yes |
| WebTransport over HTTP/3 / over HTTP/2 | yes / not verified | yes / "upcoming" [43] | yes / yes [42] |
| Worker timers in a hidden tab | not throttled (measured, §12.5) | not throttled; throttled in Nightly [35][36] | not documented: WebKit throttles timers of inactive pages, suspends tabs on iOS "when possible" and applies App Nap on macOS [44] |
| Background page freezing | Energy Saver freezes CPU-heavy tabs hidden for 5 minutes; WebSockets do not exempt them [33] | not measured here | iOS suspension [44] |
| Measured on this host | yes (§12.5) | sim and input only (no WebGL2 headless, 10 §10.5) | no |

Background execution is therefore **best effort in every browser**: the design survives losing it (§3.6), but never depends on it.

### 2.3 NAT hole punching: the verdict

**No.** There is no hole punching in this design, and nothing is lost by that.

1. **A browser can punch only through WebRTC, which means UDP.** TCP hole punching needs simultaneous open or a listening socket, and no browser API offers either (§2.2). So the question "is there a way to punch NAT holes from a browser that works on modern domestic internet" reduces to "does WebRTC/STUN work", and that path is the excluded one.
2. **Even where it is allowed, it fails often.** The largest measurement to date covers 4.4 million traversal attempts from over 85,000 networks in 167 countries. It reports a conditional hole-punching success rate of **70% ± 7.1%**, the same for TCP and QUIC when both sides are native applications with RTT-synchronised simultaneous open [10]. By NAT class: 82.9% behind port-restricted cone NATs and about 40% behind symmetric NATs [11]. OpenTTD's TCP-based STUN step fails for "roughly 20%" of connections, which then need its TURN relay [15]. Mobile networks and carrier-grade NAT sit in the hard classes. Every P2P design therefore needs a relay anyway, and a fallback that triggers for one player in five is not invisible.
3. **It would not make the game faster.** With a relay sequencer, every action must reach the sequencer and come back, so the critical path is each player's own round trip to the relay. P2P would shorten only a P2P lockstep, in which the slowest pair of players sets everybody's input delay (Factorio's original model, abandoned in 0.14 for exactly that reason [3]). A relay in a central location (Frankfurt for European players) adds a few milliseconds over a direct path.

### 2.4 The transport stack

- **Same origin.** The site and the relay share one host name and one TLS certificate, `wss://<site>/mp/v1/ctrl` and `wss://<site>/mp/v1/bulk`, behind one reverse proxy (Caddy or nginx) on 443. There is one DNS name, one certificate and `connect-src 'self'` in the CSP. To a firewall or proxy it is an HTTPS connection that upgraded.
- **Two sockets per player.**
  - **Control** carries the tick stream, actions, acknowledgements, status, digests, pings, chat and presence. Messages are small and frequent.
  - **Bulk** carries snapshot and blob transfers, opened only while one runs.

  Separate TCP connections mean a 20 MB snapshot never sits in front of the tick stream inside one connection. They still share the player's access link, which is why bulk transfers are paced (§4.3).
- **Binary frames.** The first byte is the message type (§3.2). TCP_NODELAY is on (`ws` sets it itself [30]), and every message is written as soon as it exists.
- **The relay emits 60 tick messages per second** (Factorio's `max_heartbeats_per_second` default, adjustable 6–240 [8]). A room setting can lower it to 30, which halves the per-message overhead for 8 ms more latency on average (at most 16.7 ms; PoC: §12.2).
- **Network code lives in a dedicated net worker** in the client, not in the simulation worker. In the PoC's single-thread client, a client that could not keep 60 UPS processed its messages seconds late (control RTT 5.4 s, §12.4), and a shadow simulation sharing the thread starved it (1–4.6 s, §12.6). (Whether a 4 ms tick alone widens the control round trip's tail was inconclusive: p95 186 against 77 ms in one run, 96 against 112 ms in another.) The net worker forwards tick batches to the simulation worker over a `MessagePort`.

### 2.5 Fallbacks, and keeping them invisible

| Failure | What happens | What the player sees |
|---|---|---|
| A connection drops (Wi-Fi roaming, NAT rebinding, server restart) | Automatic reconnect with exponential backoff (100 ms, doubling to 2 s); `HELLO` with `resumeFrom` replays the missed ticks from the relay's log (§2.6) | Nothing, or a brief "waiting for server" icon (§8.3) |
| The link goes silent without closing (laptop lid, dead NAT entry) | The client's watchdog closes after 3 s without a message (doubled during transfers, as Factorio doubles its drop threshold during map transfer [9]); then the same reconnect. The relay releases the player's held inputs after 1 s of silence (§2.6) | The icon, then nothing |
| The tab was frozen or slept for minutes | On waking, the client reconnects and resumes if the relay's log still covers the gap; otherwise it re-syncs from a snapshot (§3.6) | "Catching up" with a progress bar (§8.3) |
| A proxy or policy strips or refuses WebSocket upgrades. HTTPS working does not imply WebSocket working (A2-r1 #16): some TLS-intercepting proxies refuse `Upgrade` | Version 1: a clear error naming the cause. Later, if seen in the wild: an HTTPS streaming fallback behind the same API (streamed `fetch` down, POSTs up) | An error, rather than a silent failure |
| UDP is fine and a player wants lower latency on a lossy link | Later, optional: a WebTransport transport behind the same interface, **off by default and never probed automatically**, because an automatic QUIC probe could trip a firewall like the user's | Nothing unless enabled |

**The rule behind the table: there is one transport, so there is nothing to fall back between.** Invisibility comes from resuming, not from switching protocols.

### 2.6 TLS, reconnects and held inputs

- **TLS** terminates at the reverse proxy on 443 with the site's certificate (Let's Encrypt via Caddy). The relay listens on `127.0.0.1` behind it. HTTP/1.1 Upgrade is enough.
- **Keepalive.** A JavaScript WebSocket cannot send protocol pings, so liveness is application-level:
  - the relay's 60 Hz tick stream is the heartbeat in one direction;
  - the client's `STATUS` (every 100–250 ms) is the heartbeat in the other.
- **Replacing a dead connection** (A2-r1 #3). The watchdog never waits for the old socket's close event. The WebSocket standard's `close()` starts a closing handshake that is queued behind data still waiting to be sent [41], so on a black-holed path `onclose` can take as long as TCP's own timeout. The client therefore:
  1. detaches the old socket's handlers;
  2. calls `close()` best-effort;
  3. opens the replacement at once.

  The relay drops a player's older connection when the new `HELLO` arrives.
- **Resume.** The relay keeps every closed tick's actions since the latest stored checkpoint, at least 5 minutes of them (empty ticks cost nothing).
  1. A reconnecting client sends `HELLO{resumeFrom: horizon + 1, roomGeneration, epoch}`.
  2. If the generation matches and the log covers the gap, the relay answers `WELCOME{mode: resume, acceptedThrough, clock}` and sends the missed range, split into bounded messages (§3.2).
  3. The client re-sends its actions above `acceptedThrough` (§3.3) and continues.

  A mismatched room generation means the relay restarted without the client's history (§6.9): the client re-syncs instead. PoC: a drop at 30 s and a 3-s black-hole at 38 s both resumed without a snapshot, and all clients' digests agreed afterwards (§12.2).
- **Held inputs.** Walking, mining and shooting are start/stop pairs. A client that vanishes while walking would walk forever in everybody's world. The relay therefore injects `release_inputs(i)`:
  - at once when the socket closes;
  - after 1 s of silence on an open socket.

  This is Factorio's `StopMovementInTheNextTick` (FFF-302 [4]). The release also raises the player's input generation, so held-input actions stamped before it but scheduled after it cannot undo it (§3.3). When the client is heard again and finds its own release in the tick stream while a key is still held, it re-sends the held input, which its net worker stamps with the new generation (10 §15.3).
- **Leaving.** A graceful exit sends `bye` and the relay sequences `player_left(i)` at once. An abrupt one gets `player_left(i)` after a 15-s grace period, so a reconnect within the grace period is a non-event in the simulation.
- **Laptop sleep and network changes.** Both end in a reconnect. After a long sleep, the gap may exceed the log, so the player re-syncs (§4.5).

### 2.7 Bandwidth per player

On the wire every message costs its payload plus 2 bytes of WebSocket header from the server (6 from the client, which must mask), 22 bytes of TLS 1.3 record overhead and 52 bytes of TCP/IPv4 headers with timestamps (72 with IPv6) [31][32].

| Flow | Rate | Payload | On the wire (IPv4) |
|---|---|---|---|
| Tick stream, relay → client (empty ticks) | 60 msg/s | 13 B | 89 B × 60 = **5.3 kB/s** (43 kbit/s); 30 Hz: 2.7 kB/s |
| Actions of all players, relay → client | about 4 actions/s per busy player | 13 B entry header + 7–44 B action | about 0.2 kB/s per player, 1.6 kB/s with 8 busy players |
| Own actions, client → relay (with acknowledgement back) | about 4/s | 11 B entry header + action | about 0.4 kB/s up |
| `STATUS` | 4–10/s | 18 B | 0.4–0.9 kB/s up |
| Digests and pings | 2 + 2 per s | 15 B and 9 B | 0.35 kB/s up |
| TCP ACKs for the downstream | 30–60/s | 0 | 1.6–3.1 kB/s up |
| **Total during play** | | | **about 6–7 kB/s down, 3–5 kB/s up** (≈ 55 kbit/s and 35 kbit/s); one 2-hour session ≈ 50 MB down |
| Joining (once) | | snapshot | slice end ≤ 5 MB; Late 10–25 MB (10 §8.1) |

Measured at the payload level in the PoC: 43–47 kB per client per minute down and 11 kB up at 60 Hz (§12.8). The wire overhead dominates, which is why batching to 30 Hz is the one lever worth having. Actions are negligible except for large blueprints, which use the blob path (§3.3).

---

## 3. The tick protocol

### 3.1 Clocks, ticks and closures

- **The relay's clock defines game time.** Within one *clock generation* g, tick *k* closes at `t0_g + (k − k0_g)·T_g`, with T_g = 16.667 ms divided by the game speed. The *open tick* is the lowest tick not yet closed. When the relay closes ticks it sends `TICKS`: "ticks *first*..*last* are closed, and these are all their actions, in execution order".
- **A client simulates tick *k* only after it holds the closure of tick *k*.** Its *horizon* is the highest closed tick it has received. Clients may lag the relay by different amounts; lockstep needs the same inputs in the same order, not the same wall-clock moment.
- **Closures are the only input to the simulation.** That includes the system actions the relay injects with player index 0xFFFF: `player_joined`, `player_left`, `release_inputs`, `snapshot_marker` and `debug_dump` (§3.2).
- **Clock generations** (A2-r1 #7). Every change of the tick-to-time mapping starts a new generation:
  - pause and resume;
  - a speed change;
  - a rebase after the relay itself stalled. If the relay finds more than 6 ticks overdue (garbage collection, a suspended VM), it closes 6 of them and rebases the clock for the rest instead of releasing a burst. Game time slips, as in Factorio when UPS drops, rather than jumping;
  - a relay restart (§6.9).

  The relay sends `CLOCK{gen, fromTick, speed, paused}` in the tick stream, ordered with the ticks, and stamps every `TICKS`, `ACTACK` and `PONG` with its generation. On a new generation a client:
  - drops its clock samples from older generations and re-estimates from the new ones;
  - rebases its playout schedule at the first arrival under the new generation, so old deadlines are void;
  - recomputes the margin window from scratch.
- **Generations.** Clock generations are one of several "generations" in this design; 10 §3.7 tells them apart (state, clock, input, geometry, digest epoch, room).
- **Pause.** The relay stops closing ticks and sends an empty `TICKS` (no new tick) every 250 ms as a heartbeat. Clients do not simulate. Actions sent while paused are stamped with the open tick and stay queued in it; they run in the first tick after the resume. Chat and presence keep working, since they are out of band. Pause and speed are never world state (S14).
- **Pause while a player joins** (a room option, §3.6). The relay first sequences the `snapshot_marker` and closes that tick, so that the donor can serialize at it, and only then pauses. It resumes when the joiner reports *live*.

### 3.2 Messages

| Message | Direction | Content | When |
|---|---|---|---|
| `HELLO` | C→R (JSON) | protocol version, build hash, `prototypes.hash`, room, invite secret or player token, name, colour; on resume also `resumeFrom` (next tick needed), `roomGeneration`, digest `epoch` | connect |
| `WELCOME` | R→C (JSON) | player index; mode `new` / `resume` / `snapshot` (with the snapshot manifest's id and tick); `roomGeneration`; current `CLOCK`; the player's `acceptedThrough` (highest action seq the relay has sequenced); `epoch`; roster; room settings | reply |
| `TICKS` | R→C | `u32 first, u32 last, u16 clockGen, u16 n`, then n × (`u32 tick, u16 player, u32 seq, u8 blobCount`, blobCount × `u8 sha256[32]`, `u16 len, bytes`) | every relay wake (60 or 30 Hz); backlog ranges on resume |
| `CLOCK` | R→C, in the tick stream | `u16 gen, u32 fromTick, f32 speed, u8 paused` | on every clock transition (§3.1) |
| `ACT` | C→R | `u8 n`, then n × (`u32 seq, u32 targetTick, u8 blobCount`, blobCount × `u8 sha256[32]`, `u16 len, bytes`) | as soon as the input layer produces actions |
| `ACTACK` | R→sender | `u32 seq, i16 slack, u32 assignedTick, u16 clockGen` (slack < 0: it was late) | per action, and again for a resent duplicate |
| `STATUS` | C→R | `u32 simTick, u32 horizon, u16 msPerTick` (× 100), `u8 flags` (live, hidden, catching up, loading), `u16 epoch, u32 bulkRate` (bytes/s the client accepts) | 4–10 Hz |
| `DIGEST` | C→R | `u32 tick, u16 epoch, u64 rolling digest` | every 30 ticks (§5.1) |
| `PING` / `PONG` | both | `PING`: `f64 clientTime`. `PONG`: `f64 clientTime, u16 clockGen, f64 relayTick` (fractional) | 2 Hz; 10 Hz during transfers |
| `RESYNC` | R→C (JSON) | snapshot manifest id and tick, reason, the new `epoch` | on a desync verdict |
| `MANIFEST` | bulk, both (JSON) | the snapshot's immutable manifest (§4.3, 10 §8.6): id, room, room generation, tick, build, protocol, schema hash, `prototypes.hash`, rolling digest at the tick, full state hash, bytes, chunk size and count, SHA-256 | before the first chunk |
| `SNAP` chunk | bulk, both | `u32 snapId, u32 index, u32 count, u32 total`, then one chunk of the manifest's chunk size (16 or 64 KiB; the last one shorter) | joins and re-syncs (§4) |
| `BLOB` put/get | bulk, both | `u8 sha256[32], u32 index, u32 count, u32 total`, then one chunk, chunked and paced like `SNAP` (a blob is at most 8 MiB) | action payloads over 65,531 bytes (§3.3) |
| `CHAT`, `PRESENCE`, `NOTICE` | both (out of band; JSON) | chat text; ping markers, cursor and selection (≤ 10 Hz, on change); "X is joining (45%)". Never parsed by the simulation, so their encoding is free | as needed; never in the simulation |
| `ADMIN` | C→R (JSON) | kick, promote, pause, resume, speed (dev), room settings | admins |

**Field limits and validation** (A2-r1 #9). Every length field bounds what it can carry, and the protocol never relies on a value that does not fit:
- the `bytes` of an `ACT` or `TICKS` entry are one encoded action (10 §15.3: `u16 type, u16 len`, then the payload), at most 65,535 bytes, so a payload is at most 65,531 bytes; larger payloads are blobs;
- a `TICKS` message holds its 12-byte header and at most 1 MiB of entries (so at most 61,680 of them). The admission function (10 §15.3) keeps every tick's entries within 1 MiB and its simulation closure within 10's limit, so one tick always fits one message. Longer ranges, such as a resume backlog, are split into contiguous sub-ranges of whole ticks, and one tick's entries never straddle two messages;
- the receiver checks every declared length against the message size, every entry's tick against the message's range, and the range against its horizon (`first` must be `horizon + 1` after resume). A violation is a protocol error: the relay closes that connection (code 4002) and carries on; the client drops the message *before* moving its horizon and reconnects with `resumeFrom`.

The PoC showed why: a first codec with `u16` lengths but a 64 KiB cap decoded a 65,536-byte action as zero bytes, and 65,536 entries as an empty batch that still advanced the horizon (§12.9).

The relay never parses action payloads: it is game-agnostic.

### 3.3 Actions

- **Types and encoding** are 10 §15.3's. `InputAction` mirrors Factorio's `defines.input_action` (I §8.2), with stable ids of our own and 10 Appendix B's additions, plus the system actions of §3.1. Closures reach the simulation as per-player batches with a 16-byte header; the net worker regroups each closed tick's `TICKS` entries into batches in the relay's order. The same bytes serve the local loopback, the network, replays and validation, and one schema generates the TypeScript encoder and the Rust decoder. A batch of another version fails the simulation's preflight, a sequencer bug; an unknown type or a malformed payload is refused deterministically with an event, never skipped silently and never fatal, so a buggy or hostile client cannot stop the room (10 §15.3).
- **No floats leave the client.** Positions are `i32` in the ×2 tile units of 10 §4.2 (building centres) or in 1/256 tile, quantised before encoding, so no number the client computed reaches the World unrounded.
- **Action identity** (A2-r1 #3). An action is `(player, seq)`. Seq is a `u32` that rises by one per action over the player's whole stay in the room, across reconnects and page reloads: the relay returns `acceptedThrough` in `WELCOME`, and the main thread continues from `max(loaded, accepted, pending) + 1`, where *loaded* is the world's `last_seq` and *pending* the highest seq it has sent (10 §3.2).
  - **Deduplication.** The relay sequences seqs in order. A seq at or below `acceptedThrough` is a duplicate: it is acknowledged again with its original assignment (the relay keeps the recent seq → tick map for the retained log) and never queued twice.
  - **Retry.** After a reconnect the client re-sends, in order, every action above `acceptedThrough`, stamped afresh. Actions at or below it are already sequenced: they appear in the closure stream the resume delivers, or have appeared.
- **Held inputs are fenced** (A2-r1 #3; D22). Actions that change a held input (start and stop walking, begin and stop mining, picking state; shooting and driving later) carry the player's input generation as the client last saw it. `release_inputs(i)` and `player_left(i)` increment it, and nothing else does; a held-input action with another generation is a deterministic no-op with an event (10 §15.3). So a `start_walking` stamped for tick 1,010 cannot restart a character that the relay released at tick 1,003 after the player went silent. The net worker sees the release in the tick stream and stamps later held inputs with the new generation (10 §15.3); the client re-sends what is still held.
- **Entity references by identity** (A2-r1 #12; D23). Actions name an existing entity by its **serial** (`u32`, never reused). An entity the player has just built and not yet seen confirmed is named by its **creation id** `(seq, index)`, resolved through the player's ring of the serials created by its last 256 creating actions (10 §4.3), so "rotate the entity my action 4,711 built" resolves the same way on every client and fails cleanly if that build failed. There is no position fallback: a missing serial fails the action even if another entity of the same prototype now stands in the same place. Positions are used only by actions defined on positions: build, mine a tile or resource, drop an item, place a blueprint, place a ping or tag.
- **Size.** Inline payloads are at most 65,531 bytes. A larger blueprint record first goes up the bulk socket as a content-addressed blob; the action carries its SHA-256, and its `ACT` and `TICKS` entries list it (§3.2), so the relay tracks the dependency without parsing payloads. The relay sequences the action only after it stores the blob, pushes the blob to every client before that tick closes, and keeps it while any retained closure or stored checkpoint needs it (§6.5). A client that reaches the tick without the blob waits for it.
- **Validation** runs in the simulation (10 §15.3). Feedback events carry `(player, seq)`, so the client can tell its own prediction which action failed (§3.5).
- **Chat is not an action.** Console *commands* that change the world are (`console_command`: `/cheat`, and dev `/c` as in Factorio). Chat travels out of band, keeps working while the game is paused, and does not bloat closure logs.

### 3.4 Stamping and arbitration

**Client side.**
1. **Clock estimate.** `PING`/`PONG` pairs give the relay's fractional tick at the moment of the reply. The client keeps the sample with the smallest RTT over the last 10 s and extrapolates: `relayTick(now) = sample.tick + (rtt/2 + now − received) / T`.
2. **Stamp.** `target = floor(relayTick(now)) + 1 + margin`.
3. **Margin control.** For each acknowledged action, `need = margin_at_send − slack` is the margin that would have made it exactly on time: its one-way delay plus clock error, in ticks.
   - Every second: `margin = clamp(ceil(p98(need over the last 30 s)), 1, 60)`.
   - Until five samples exist, a late action raises the margin to its `need` at once (first calibration).
   - A rare loss stall therefore makes one or two actions late (the relay moves them, and their prediction is off by the delay) instead of inflating every later input's delay. A controller that added each late action's lateness and decayed by one tick per 5 s left a client on a lossy link with 18–20 ticks of input delay for a minute after a single stall (measured, §12.2). Factorio renegotiates each player's latency every 5 s [4].
   - The PoC uses the 95th percentile (1–8% of actions late); the 98th percentile trades about one tick more delay on jittery links for fewer mispredictions.

**Relay side.** On `ACT`: `assigned = max(clamp(target, open, open + 600), lastAssigned[player])`; the shared admission function (10 §15.3) then moves the action to the first tick from `assigned` on that has room in both its simulation closure and its `TICKS` entries, closing a tick to player actions once one does not fit (a player's action with a system type id is a protocol error, §3.2); `slack = target − open`; queue the action into `assigned`; `lastAssigned[player] = assigned`; only then send `ACTACK`. System actions use the 4 KiB per tick that admission reserves for them. Within a tick, actions execute in the order the relay queued them, which the closure states explicitly.

**Per-player order** (A2-r1 #2). The relay never assigns a player's action to an earlier tick than that player's previous one. Within a tick, a player's actions keep their send order: TCP delivers them in order and the closure states it. Clients stamp nondecreasing targets too (`target = max(estimate + margin, previous target)`).
- **Why.** Without the rule, a shrinking margin or a clock correction between two inputs can stamp `start_walking` at tick 100 and the following `stop_walking` at tick 99. The relay accepts both, the stop runs first, and the character walks on. The review reproduced this with the first PoC. With the rule the pair runs in send order, at the same or later ticks (probe, §12.9).
- **Prediction** reconciles against acknowledged assignments: the latency state uses the stamped tick until `ACTACK` arrives, and the assigned tick from then on.

**Why clients stamp.** If the relay stamps on arrival, the tick an action lands in depends on network jitter, so the gap between `start_walking` and `stop_walking` on the receiving side differs from what the player pressed. Every walk then ends a tick or two away from where the local prediction put the character: 0.15 tiles per tick of error, a visible rubber-band at every stop. Measured in the PoC with identical networks:

| Link (PoC profile) | Relay stamps on arrival: walk inputs mispredicted (final run; range over four runs) | Clients stamp: mispredicted (late or reordered) | Extra confirmation latency of client stamping (p50) |
|---|---|---|---|
| LAN (RTT 4 ms) | 3.4% (2–24%) | 0% | +16 ms |
| Home (RTT 27 ms, jitter 6 ms, 0.3% loss stalls) | 10.0% (10–35%) | 3.3% | +12 ms |
| Far (RTT 108 ms, jitter 20 ms, 1% loss stalls) | 31.7% (32–54%) | 4.9% | +13 ms |

Factorio does the same. When a player's input for a tick has not arrived, the server does not wait: it tells that client its actions will go into a later tick, and it renegotiates each player's latency every 5 seconds (FFF-302 [4]).

**Resulting input delay** (keypress to the tick of execution) is the margin. In the PoC it was 1–2 ticks on LAN, home and Wi-Fi links, 4–6 on far links, 5–15 on the mobile profile (varying between runs), and 28 on a stress link with 3% loss stalls of 400 ms. **Confirmation** (keypress to the closed tick arriving back) took p50 30 ms on LAN, 43–55 ms at home, 73 ms on Wi-Fi, and 140–310 ms on far and mobile links. **Execution in the player's own simulation** adds the playout buffer: p50 48 ms on LAN, 143–178 ms at home, 262 ms on Wi-Fi, and 383–599 ms on far and mobile links (§12.2). Latency hiding covers the gap.

### 3.5 Latency hiding: what is predicted, what must wait

Factorio keeps a *latency state*: a small subset of the game state, used only for display, rebuilt every tick from the confirmed state plus the local player's not-yet-applied actions (FFF-302 [4]; designed in FFF-83 [2]). We do the same, in the simulation worker, without ever writing to the World.

**Mechanism.**
1. After each confirmed tick, the worker builds a *latency state* for the local player: a scratch copy of the character (position, direction, walking and mining state), the hand, a delta of the main inventory, and a list of predicted entity placements and removals.
2. It replays the player's pending actions (sent, not yet executed) at their stamped ticks, up to the predicted present (`relayTick(now) + margin`). It uses the simulation's own movement and collision functions on the scratch character, so the prediction is exact unless another player's action interferes.
3. The packet to the main thread carries the latency state beside the confirmed view. The renderer draws the predicted character and predicted placements; the UI shows the predicted hand and inventory counts.
4. When the confirmed result arrives, the next rebuild uses it. A failed prediction disappears and the confirmed state shows. As FFF-83 puts it, the approach is self-correcting: "There is no state correction or anything." [2]

| Predicted (shown at once) | Not predicted (shown when confirmed) |
|---|---|
| The character's movement, including collision with confirmed and predicted buildings | Everything the factory does: belts, inserters, machines, power, fluids, agents, trains, research progress |
| Hand mining: the progress bar starts at once; the item arrives on confirmation | Other players' actions |
| Building and fast-replace: the entity appears as placed, and the item leaves the hand | Contents of entities (machine inventories, chests), and transfers into or out of them, except the hand and inventory side shown optimistically |
| Removal by mining an entity: progress bar; the entity stays until confirmed | Vehicles in version 1. Factorio added latency hiding for cars only in 2.0.7 [I-data]; ours can follow later |
| Rotate, flip, recipe change on own new entities | Results that depend on world state: research completion, crafting results |
| Hand, inventory moves and the crafting queue: optimistic UI, reconciled on confirmation | |
| Opening and closing GUIs, hover, selection, camera, alt-mode, tooltips: UI state, never round-trip at all (10 §3.4) | |

The PoC measures the prerequisite, prediction exactness (§3.4). The latency state itself is engine work for the MP milestone. M0 only needs action sequence numbers in feedback events and movement and placement functions that run on a scratch character (S10; 10 §15.6, §5.1).

### 3.6 Pacing, catch-up and slow clients

**Playout.** Tick messages arrive with jitter, and TCP delivers in order, so one lost segment holds back everything behind it until it is retransmitted. The client therefore plays closed ticks out of an adaptive buffer, as a VoIP jitter buffer does:
- `base` = the earliest observed `arrival − lastTick·T` over 20 s (it tracks clock drift);
- tick *k* is due at `base + k·T + D`. D **grows at once** to the 99th percentile of observed lateness over the last 30 s plus 4 ms, and **shrinks by at most 1 ms per second**; it is clamped to [T/2, 30·T]. Recomputing D from scratch every second, as the PoC first did, undid each underrun's widening a second later and left 16–19 underruns per minute on jittery links (§12.2);
- every underrun (a due tick that has not arrived) adds one T at once;
- at most 3 ticks run per wake while on time.

**Catch-up.** If the backlog exceeds D/T + 30 ticks (behind by half a second or more), the client enters catch-up mode:
- it runs ticks in slices of at most 12 ms, with view extraction off;
- it yields between slices, so messages keep flowing;
- it leaves catch-up when the backlog is down to D/T + 2.

The time to catch up a backlog B at an unthrottled rate R ticks/s is B/(R − 60).

**What a stall looks like.** The world pauses for the length of the underrun. The player's own predicted character keeps moving, because its latency state runs toward the predicted present by the wall clock (§3.5). The playout buffer trades latency for fewer stalls:

| Profile (PoC) | Playout delay D | Underruns per minute (total stalled) |
|---|---|---|
| LAN | 8 ms | 0 (apart from the induced 3-s black-hole) |
| Home (0.3% loss stalls of 150 ms) | 129–150 ms | 5 (0.2 s) |
| Wi-Fi (jitter 20 ms, 0.5% stalls of 200 ms) | 211 ms | 5 (0.3 s) |
| Mobile and far (1% stalls of 250–300 ms) | 259–323 ms | 3–5 (0.3–0.4 s) |
| Stress link (jitter 60 ms, 3% stalls of 400 ms) | 452 ms | 1 (0.4 s) |

See §12.2 for the other profiles. On a lossy link TCP's head-of-line blocking is the cost of reliability; it is the one case where WebTransport datagrams could do better (§2.5).

**The heartbeat.** The tick stream *is* the relay's heartbeat: no separate message is needed while the relay closes ticks. While the game is paused, the relay sends an empty `TICKS` (`last` = the previous last) every 250 ms. Clients send `STATUS` at 10 Hz (4 Hz is enough outside transfers). The relay uses it for:
- liveness (§2.6);
- each player's lag (`closed − simTick`) for the Players window;
- live/hidden flags;
- the snapshot donor choice;
- the slowest-client policy below.

**A slow client** needs more than T per tick, so it cannot keep 60 UPS.
- **The relay does not wait** (Factorio since 0.14 [7]). The PoC's 20 ms-per-tick client fell behind steadily while the others' latency and stalls were unaffected (§12.4).
- **Default policy (Factorio's):**
  - the slow client shows "Your computer cannot keep up" (§8.3) and a lag counter;
  - admins see its UPS in the Players window;
  - once it is more than 60 s behind, it is disconnected with that reason.
- **Room setting "Match the slowest player" (off by default).** The relay lowers the game speed to the slowest live client's sustainable rate, estimated as 0.9 × T ÷ its reported ms per tick, with hysteresis and a floor of 0.5. This is what a group of friends with one old laptop may prefer. Open question for the user (§11).

**Pause and speed in multiplayer** follow Factorio:
- the technology screen, game menu, run report and first-run panel **do not pause** (I §4.0 and 07 §13 pause "single player" only);
- the game auto-pauses while no player is connected (`auto_pause`, default on);
- "pause while a player is joining" is an option (`auto_pause_when_players_connect`, default off). The relay closes the snapshot marker's tick before it pauses (§3.1);
- by default only admins can pause (`only_admins_can_pause_the_game`, default on) [8];
- game speed is a dev and cheat command.

**Hidden tabs and frozen pages.** Browsers throttle hidden tabs; single player pauses there (07 §19.3), but multiplayer must keep simulating. Measured in Chrome 156, with its normal background policies (§12.5):
- in a hidden tab, a 16-ms timer chain on the **main thread** fell to 1 wake per second within a minute and then to zero per 10-s window (minute-aligned intensive throttling [38]);
- the same chain in a **dedicated worker** kept 50–60 wakes per second for the whole 6.5 minutes;
- all three test clients (paced by timers, by arriving ticks, or both) stayed within 8 ticks of the relay throughout;
- a page frozen through CDP, as Chrome's Energy Saver freezes CPU-heavy background tabs [33], stopped completely, worker included, but **kept its WebSocket open for 90 s**, and caught up 5,422 ticks in 89 ms after unfreezing (toy simulation).

Firefox release builds do not throttle worker timers, but Nightly does: `dom.workers.throttling.enabled` defaults to `@IS_NIGHTLY_BUILD@` in the current source [35][36]. WebKit documents that it throttles the timers of inactive pages, suspends tabs on iOS "when possible", and lowers the priority of non-updating tabs through App Nap on macOS [44]; it says nothing about workers, so Safari is untested best effort.

**Rules.**
- The simulation worker is **driven by arriving ticks** (network and port messages are not timers) and uses timers only to smooth playout.
- View extraction stops while the page is hidden (10 §3.3 already does this).
- On becoming visible again, the client chooses the faster of catch-up (backlog ÷ (R − 60)) and re-sync (§5.2), using its measured ms per tick.
- `STATUS` reports the hidden flag, so others see "(away)" rather than "lagging" in the Players window.

### 3.7 What the simulation holds per player

The split between per-player world state, per-force world state and per-client state is 10 §4.4's table (S1). Per player, in the World: inventories, the hand, quickbar, crafting queue, mining, walking and drag state, undo stacks, the input generation, `lastSeq` and the creation ring, the settings clipboard, pins, rule-affecting personal settings and per-player accumulators. Per client, never in the World: camera, windows, hover and selection, keybindings and interface settings, the latency state, chat, and other players' cursors and selections.
- **Names and colours** are not simulation state. They live in the room roster at the relay and in the save header, so that re-hosting a save restores them.
- **Selection** stays out of the simulation as well. Factorio sends selection changes as input actions; FFF-302's megapacket bug came from catching up 400 of them at once [4]. We keep selection as client UI state, and other players' selections travel as presence (§8.3).
- **Permissions are trusted.** Every player may do everything in the world, and nothing is checked per player in the simulation. Admin-only operations (kick, pause, room settings) are relay operations.
- **Offline characters** stay in the world with their inventories; they neither walk, mine nor craft, and the hand returns to the inventory if it fits (10 §5.1).

---

## 4. Joining

### 4.1 The sequence

This is Factorio's flow since 0.14, except that a donor client, not the server, writes the save. There, the joiner downloads the map in the background while the others keep playing, stores all input meanwhile, and then applies it as fast as it can to catch up (FFF-149 [5]).

1. **Hello.** The joiner opens the control socket and sends `HELLO` (build hash, `prototypes.hash`, protocol version, room, invite secret or player token, name, colour). The relay refuses a different build with a reason the client turns into "update and retry" (§6.3). It assigns a player index: a new one, or the same one as before if the player token is known.
2. **Snapshot source.** The relay uses its cached checkpoint if that is fresh enough (§4.2). Otherwise it picks a donor and sequences `snapshot_marker(id, donor)` into the open tick *T*. It answers `WELCOME{mode: snapshot, …}` and from now on streams every closed tick to the joiner, who buffers the ticks after *T*. If the room pauses while players join, the marker's tick closes before the pause (§3.1).
3. **Serialize.** The donor applies tick *T* and then copies its state at that tick boundary: a stall of at most 100 ms (10 §8.4), after which it catches up a few ticks. Its IO worker compresses the copy while its game goes on.
   - The snapshot is a **complete checkpoint**: the ordinary save container (10 §8.1) with every section, including cold data, timers, RNG states, the blueprint store, per-player state (input generations and creation rings, §3.3) and the **pending worldgen requests** (chunk keys and their commit ticks, 10 §5.18) (A2-r1 #11).
   - It also carries its **lineage**, the rolling digest at *T*, so that the joiner's digests continue the room's sequence (§5.1, A2-r1 #5). The slice schedule is a function of the tick, so there is nothing else to carry.
4. **Transfer** (§4.3). The donor sends the snapshot's immutable manifest, then its chunks, paced, on its bulk socket. The relay validates and stores each chunk and forwards it at once to every joiner waiting for that snapshot, so upload and download overlap. The joiner's screen shows the megabytes received of the total (§8.2).
5. **Load and verify.** The joiner checks the SHA-256 against the manifest, decompresses and loads (≤ 3 s for a late save, 10 §11), and compares the loaded world's state hash with the one in the checkpoint. It adopts the manifest's rolling digest and the digest epoch the relay gave it in `WELCOME` (or `RESYNC`), and starts catching up through the buffered ticks with view extraction off and historical feedback suppressed ("Catching up", with a percentage; S15, 10 §3.4).
6. **Live.** When its backlog reaches the playout target, the joiner's `STATUS` turns *live*. The relay sequences `player_joined(i)` into the open tick, so every client creates or re-activates the character at the same tick and logs "X joined the game". The joiner's input unlocks when it applies its own `player_joined`.

### 4.2 Where the snapshot comes from

- **The donor** is the live, connected, not re-syncing client with the smallest lag and the best measured uplink (the relay times every bulk upload it receives). Pre-emptive uploads (below) come from the same choice.
- **The relay caches** the newest complete snapshot plus the log of closed ticks since then. For a join it compares two estimates and takes the faster:
  - cached: catch up `(closed − T_cached)` ticks;
  - fresh: upload the snapshot, then catch up the ticks that passed meanwhile.

  It knows the room's ms per tick from `STATUS` and each donor's upload rate. A simpler rule that holds on the data: use the cache when it is younger than 60 s.
- **"Server saves" without a server simulation.** Every 10 minutes (room setting), when the last player leaves gracefully ("Save and quit" uploads before closing), and at relay shutdown, the relay asks a donor for a paced snapshot and stores it. This is what lets a room outlive its players (§4.6) and what most joins use.
- **Path.** Donor → relay → joiner, always over the bulk sockets; there is no direct path between clients (§2.3).

### 4.3 Sizes, compression, chunking, resume and pacing

- **Sizes** (10 §8.1, §11): at most 5 MB at the slice's end, 10–25 MB late. They are compressed already (deflate in the container), so no second layer.
- **The transfer is a transaction** (A2-r1 #11).
  1. **Manifest first, and immutable** (10 §8.6): snapshot id, room, room generation, tick *T*, build hash, protocol version, schema hash, `prototypes.hash`, rolling digest at *T*, the full state hash, total bytes, chunk size, chunk count, and the SHA-256 of the whole compressed blob. Every chunk must agree with it.
  2. **Bounds:** a chunk's index is below the count; its size equals the chunk size, except the last one, which is `total − (count − 1) × size`.
  3. **Uniqueness:** a duplicate chunk counts once. (A relay that counts messages lets duplicates complete a snapshot early; measured, §12.9.)
  4. **Publication:** the relay verifies the SHA-256, writes the checkpoint under a temporary name, then atomically renames it into the room's checkpoint slot. Only then is it the room's latest checkpoint, with its log starting at *T* + 1.
  5. **Deadlines:** the donor must deliver a chunk at least every 10 s, and the whole snapshot within the larger of 10 minutes and size ÷ 32 KiB/s. Otherwise the relay aborts, discards the partial snapshot, picks another donor and tells the joiners to discard theirs.
  6. **The joiner** verifies the SHA-256 and then the state hash before loading; on a mismatch it reports, and the relay repeats the transfer from another donor.
- **Resume.** After a reconnect the joiner reports the chunks it holds, and the relay sends the rest. A donor that disconnects mid-upload counts as a missed deadline.
- **Pacing** is the one non-obvious requirement.
  - A home router's uplink is a FIFO queue. An unpaced upload fills it, and every other packet the donor sends waits behind it: its actions, `STATUS` and digests, and the TCP ACKs of its tick stream.
  - In the PoC, with a 10 Mbit/s uplink and a 300 ms router queue, the donor's control RTT rose from 50 ms to 270 ms (p50; p95 359 ms) for the whole 17-s upload of a 21 MB snapshot. Its input delay grew to 16 ticks (§12.3). This is what Factorio's `max_upload_in_kilobytes_per_second` server setting exists for [8].
  - Uploads are therefore paced by a **LEDBAT-style delay-based controller** (RFC 6817 [34]). It keeps the queueing delay that the transfer adds on the donor's own link under 25 ms, measured as control-channel RTT over its minimum, with 10 Hz pings during transfers.
  - **Progress at any rate** (A2-r1 #10). The token bucket's capacity is at least one fragment; otherwise a bucket holding 100 ms of a slow rate can never afford a 64 KiB chunk, and the transfer stops (below about 640 KiB/s, in the PoC's first pacer). Fragments carry at most about 25 ms of link time at the current rate: the donor picks the chunk size per snapshot from its measured uplink, 16 KiB below about 5 Mbit/s and 64 KiB above, and states it in the manifest. A floor of 16 KiB/s keeps every transfer moving. One 64 KiB chunk alone holds a 2 Mbit/s uplink for 262 ms, so on slow links chunk size *is* added latency.
  - Downloads to a client that is *playing* (a background re-sync, §5.2) are paced by the relay at the rate that client reports in `STATUS`.
  - A joiner that is not yet playing downloads at full speed.
  - **Measured.** At 10 Mbit/s the PoC's crude controller held the donor's RTT at p50 43 ms (p95 165 ms) and its input delay at 4 ticks, but stretched the transfer from 17 s to 23 s (up to 38 s in earlier runs; §12.3). At 2 Mbit/s, after the fixes above, a paced 4.3 MB join completed in 21.3 s, but the donor's RTT still rose to p50 85 ms (p95 298 ms) and its input delay to 11 ticks (§12.3, §12.9).
  - **So the crude pacer does not meet the 25 ms target on slow links.** A properly tuned LEDBAT is an implementation requirement, tested at 2 Mbit/s and 10 Mbit/s with a 300 ms router queue, and a room setting may trade the donor's comfort for faster joins.

**Expected join times** (transfer is bounded by the donor's uplink; catch-up by the joiner's speed, see §4.4):

| Save | Uplink 2 Mbit/s | 10 Mbit/s | 40 Mbit/s |
|---|---|---|---|
| Slice end, 5 MB | 20 s | 4 s | 1 s |
| Late game, 20 MB | 80 s | 17 s (PoC, 21 MB: 17.2 s) | 4 s |

### 4.4 Catching up

While the joiner downloads (D seconds) and loads (L seconds), the game advances 60·(D + L) ticks. Catching up at an unthrottled rate of R = 1000 / (ms per tick) takes **C = 60·(D + L) / (R − 60)** seconds.

| Scale (reference machine, 10 §4.7, §11) | ms per tick | R (ticks/s) | C for D + L = 20 s |
|---|---|---|---|
| Slice | 0.3 | 3,300 | 0.4 s |
| Mid | ≤ 2 | 500 | 2.7 s |
| Late (round 5's estimate; 10 §4.7 now predicts about 1.8 ms, R ≈ 550) | 4 | 250 | 6.3 s |
| Late, on a machine half as fast | 8 | 125 | 18.5 s |
| Late, a machine that barely holds 60 UPS | 15 | 67 | 171 s: offer "pause while joining" |

The PoC measured the Late row: a 21 MB snapshot at 10 Mbit/s took 17.2 s, and the joiner then caught up 1,371 ticks in 5.7 s at an effective 239 ticks per second (4 ms of emulated tick cost plus the single-thread client's overheads). The formula predicts 5.8 s. An earlier run on a busier host measured 140 ticks per second and 12.9 s against 13.1 s predicted (§12.3). For machines near the limit, the room option "pause while a player joins" (Factorio's `auto_pause_when_players_connect` [8]) stops the clock until the joiner is live.

### 4.5 Returning players, long absences and resumed rooms

- **Returning player.** The same player token gets the same player index and the same character, with its inventory. The character stayed in the world while the player was away (§3.7).
- **Short absence.** If the relay's log still covers the gap (it keeps everything back to the newest stored snapshot), the player resumes by replaying ticks (§2.6): no snapshot.
- **Long absence, or a frozen tab.** The client compares the catch-up estimate with a re-sync and takes the faster.
- **A room with nobody in it** is a stored snapshot plus the log since then. The first player to return loads both and catches up. If they are the only player, the game is paused until they are live.

### 4.6 A game that outlives everybody

- **On the relay**, a room persists as its newest checkpoint, the closed-tick log since then, the roster and the chat tail, until it expires (§6.4).
- **Sealing.** When the last player leaves gracefully ("Save and quit"), its client first uploads a checkpoint at the final closed tick, and the relay pauses the room there. The room is then *sealed*: a checkpoint with an empty log. Periodic checkpoints keep unsealed logs short.
- **On every client**, autosaves go to the browser's store as in single player (10 §8.4). The stall is invisible here: the client falls a few ticks behind and catches up. Because every client has the whole state, anyone can **host the saved game again** as a new room if the relay or the room is gone (§8.1). Factorio's `autosave_only_on_server` defaults to true [8]; we default to client autosaves on, because our relay cannot save by itself.

---

## 5. Desyncs

### 5.1 Detection

Factorio checks a "Heuristic CRC" every tick, "an incomplete but very fast check taken every tick" that "captures only couple of crucial information about the game state like for example state of all the players, number of active entities or snapshot of production statistics", compared for all players "with a communication latency". A full CRC every tick and a save–load–check every tick serve for debugging only (FFF-55 [6]). We do the same, plus a rotating slice of the full state, so that all state is checked within a minute.

1. **Digests** are computed by the simulation every tick (10 §4.8, S7): a per-tick digest `d_t` of the values that change every tick (about a microsecond); a slice hash over 1/3,600 of the state, chosen by key so that everything that exists for a minute is covered without a cursor to save; and the rolling digest `r_t = mix(r_{t−1}, d_t, slice_t)`, in which a divergence anywhere stays visible in every later `r`. 10 §4.8 pins the per-tick record, the shard map that assigns every saved section to a slice, and r₀. Because `r` depends on history, every checkpoint carries its **digest lineage**, `r` at its tick (A2-r1 #5), so that a joiner's or a re-synced client's digests continue the room's sequence. Sampling cannot catch every *transient* divergence (an entity that diverges and is destroyed before its slice comes round), which is why D18's tests compare full canonical state.
2. **Reports and epochs.** Every 30th tick a client sends `DIGEST{tick, epoch, r_t}`.
   - The relay owns each player's epoch. It raises it when it orders a join snapshot or a re-sync for that player, and the client adopts the new epoch when it loads or swaps in the new state.
   - The relay ignores digests whose epoch is not the player's current one, so digests from a state that is being replaced cannot vote. (Without epochs, one desync triggered four re-syncs from queued stale digests; measured, §12.6.)
3. **Comparison and membership** (A2-r1 #4).
   - **Expected players.** The players expected to report tick T are those in the simulation at T (joined at or before T, not left before T), with a current epoch, and not being re-synced.
   - **Verdict.** A verdict forms when every expected player has reported T, or after 5 s if at least two have. It is **kept for the maximum supported lag**: 60 s, the slow-client limit of §3.6. A report that arrives later, from a player who runs far behind, is compared against the verdict on arrival. A lone report waits up to the same 60 s for a second.
   - **Donors** for the repair come only from the winning group.
   - **Measured.** A relay that drops tick records after 5 s never compares two clients 6 s apart. With these rules, a corrupted client running 6 s behind was caught on the late path, repaired from a winning-group donor, and ended in full-state agreement (§12.9).
4. **Detection latency.** Divergence that touches per-tick values is caught at the next report: at most 0.5 s plus the slowest client's lag. In the PoC (which reports every 60 ticks), the verdict came 10–21 ticks after the first report tick that showed the divergence. A player who runs behind or is catching up is judged when its own report arrives. Divergence confined elsewhere is caught when its slice comes round, within 60 s.

### 5.2 Recovery

- **Verdict.** A majority of the digests reported for a tick wins. A tie, including any two-player disagreement, goes to the *anchor*: the longest-connected live player, normally the owner. Neither side is "right" in a two-player desync, since both ran the same inputs; what matters is that both converge on one state. Every minority client is re-synced from a donor in the winning group.
- **Background re-sync.** The desynced client is told `RESYNC{snapshot, epoch}`.
  1. A winning-group donor writes a complete checkpoint at a marker tick, as for a join (§4).
  2. The desynced client **keeps playing in its own world**, with its digests ignored, while a **second simulation worker** (the shadow) loads the checkpoint and catches up through the ticks buffered since the marker.
  3. When the shadow reaches the live tick, the client swaps the shadow in through the world-replacement protocol (S15, 10 §3.4), terminates the old worker and adopts the new epoch. If the shadow is already ahead of the live world (a client that runs far behind), it hands over at once and the live tick catches up to it.

  The player sees at most a few entities snap into place.
- **Convergence is checked, not assumed** (A2-r1 #14). A second worker does not guarantee progress: on a machine with few cores both worlds compete for CPU, and the shadow may run at or below game speed indefinitely.
  - The shadow reports its tick rate. The client requires it to gain on the live world by at least 20% of game speed over 10 s, and to be projected to converge within 60 s.
  - If either check fails, or memory does not allow a second world (up to about 1 GB late, 10 §11), the client switches to **foreground repair**: it stops the divergent world, gives the shadow all its CPU, and shows "Catching up".
  - If even foreground catch-up cannot exceed game speed, this is the slow-machine case (§3.6). The client leaves with that message, or, with "match the slowest player" on, the relay slows the game.
  - **Bounded attempts:** at most 3 repairs per player per 10 minutes. After that the client stops re-syncing, shows the desync notice, and offers the bug bundle (§5.3), because by then it is a reproducible bug. (Factorio quits a player after 3 desyncs [9].)
- **Traps** (10 §3.6). A trap in one client's simulation is a desync on itself: the client starts a fresh worker, re-syncs from a winning-group donor and files a bug bundle with its closure log. A trap that every client hits at the same tick is a deterministic bug, and there is no donor: the relay pauses the room at its last closed tick and keeps a desync bundle (§5.3). The room resumes only with a fixed build: a client replays the log under the old build to the tick before the trap, and the room is upgraded from that checkpoint (§6.3).
- **Delta re-sync: deferred** (A2-r1 #17). A desync is usually local (one inserter, one network), so exchanging page hashes at the marker tick and transferring only differing pages would turn megabytes into kilobytes.
  - **It is not free.** The rotating slice hashes come from different ticks and cannot serve as a coherent page list at the marker. Both sides must scan their whole state at that tick (on the order of 50–100 ms for 100 MB) and coordinate the exchange.
  - **No page layout in M0.** M0 commits only to what it would build on: canonical, section-wise serialization and complete checkpoints (S9). The method is designed once full-snapshot recovery works and measurements show the transfer is the bottleneck.
- **Measured** (§12.6, §12.9). A deliberately corrupted client was found at the first digest report that covered the corruption, and re-synced:
  - from 2.2 MB over the 100 ms link: swapped in 731 ms after the verdict (500 ms of it is the deliberate 30-tick handover lead);
  - while running 6 s behind the relay: detected on the late path, and swapped in 6.2 s later, once its live world reached the shadow;
  - in the late game (21 MB at 10 Mbit/s, 4 ms per tick): downloaded in 17.1 s and swapped in by the shadow thread 23.3 s after the verdict, while the player played on with normal latency (30.1 s when paced).

  Every repair completed and ended with full-state agreement. All ran on an idle-cored host with emulated tick costs, so convergence under real CPU contention is still unmeasured (§12.10).

### 5.3 Debug bundles

**What is captured.** On every desync verdict the relay sequences a `debug_dump(id)` at the next open tick. Both the desynced client and the donor serialize their full state after that tick and upload it on the bulk socket, paced. The relay then stores a **desync bundle**:
- both states;
- the closure log back to the last snapshot both shared, plus that snapshot;
- each client's ring buffer of per-tick digests `d_t` (the last 36,000 ticks, 288 kB; 10 §4.8);
- build hashes and user agents.

The developer, or Claude, fetches it from an admin endpoint, as 10 §3.5's `/__report` does for single player, and replays it with `simtool`.

**Tools** (`simtool`, native; 10 §2.2):
1. **`simtool diff a.save b.save`** loads both states and lists the differences, decoded by the generated readers:
   - by section; pool fields by entity *serial* (so a different slot order is reported as such), with prototype and position;
   - records and cold data field by field;
   - globals by name.
2. **`simtool bisect bundle`** replays the shared snapshot plus log natively and compares per-tick digests with the clients' recorded rings to find the first divergent tick. A `dev` build then replays that tick with **per-phase digests** (one after each of 10 §4.6's 16 phases) to name the system. When the native replay agrees with both clients, the divergence is engine-specific, and the trace page replays the bundle in Chrome and Firefox (10 §10.5).
3. **Heavy mode** (`?heavy=1` and a test flag), after Factorio's: it saves and loads the game every tick to detect state that does not survive a save/load cycle [14]. Here: every *k* ticks, serialize, load into a second world, step both and compare full state (10 §10.4). It finds unsaved state and order-dependent rebuilds (D3, D8) in single player, long before two players ever meet.

### 5.4 The determinism checklist

The rules **D1–D23** live in 10 §4.1, each with its reason, its enforcement and its owner, and D18's suites in 10 §10.4. **All are M0-mandatory.** With the simulation in Rust, D19 is the language rule set and D5 is retired. In brief:
- D1 one writer; D2 closures are the only input; D3 canonical iteration order (bitsets in pool order, A1's wake rules, timer order, no hash-map iteration, members in serial order, derived pools by canonical keys); D4 float reductions in canonical order; D6 no NaN in state; D7 integer discipline; D8 complete checkpoints, pending worldgen requests included, with the digest lineage beside the state;
- D9 pure caches; D10 no local player; D11 rule-affecting settings are world state; D12 pure worldgen committed at sim-determined ticks; D13 game time is ticks; D14 one build per room; D15 outputs are outputs, and historical events are suppressed; D16 no ordering by identity; D17 strings never decide rules;
- D18 the tests (join equivalence, NO_SLEEP equivalence, heavy mode, cross-engine traces, replay, the multi-client harness and wire probes), comparing full state; D19 the Rust and WebAssembly rule set; D20 every new piece of state declares saved or derived and its order;
- D21 per-player action order; D22 held inputs fenced by an input generation; D23 targets by identity.

---

## 6. The server

### 6.1 What it is

A single Node 24 process using `ws` 8.22.0 (the newest release at least 14 days old, per 10 §2.1's pinning rule), listening on `127.0.0.1` behind the reverse proxy that serves the static site on 443. It holds many rooms. It:
- **sequences** (the tick clock, acceptance and closing of ticks, system actions);
- **relays** (tick stream, acknowledgements, chat and presence, bulk chunks);
- **stores** (snapshots, closed-tick logs, rosters, chat tails, desync bundles);
- **observes** (metrics and logs).

It never runs the simulation and never parses action payloads.

### 6.2 Code layout

- **`RoomCore`**, in `game/src/relay/core/`: pure TypeScript with no I/O. A state machine fed with `(now, event)` that returns messages to send. It holds the clock and ticks, the acceptance rule, the log, snapshot coordination, digest voting, held-input release and the grace timers. It is unit-tested with a simulated clock (§9), and it also runs inside the in-process multi-client test harness.
- **Adapters**: `relay/node/` (`ws`, filesystem storage, HTTP endpoints) and, deferred until full-snapshot recovery works (A2-r1 #17), `relay/cloudflare/` (a Durable Object, §6.7). About 1,500 lines in total. The PoC's relay is about 450 lines of JavaScript and implements much of it (§12).
- **Shared code**: `shared/net/` holds the wire codec used by relay and clients. Action payloads are opaque bytes to the relay.

### 6.3 Rooms, invites, players and versions

- **Room.** Created by a host with game settings, or by uploading a save as the initial snapshot ("Host saved game"). A room has:
  - a 64-bit random id;
  - an **invite secret** of 80 bits. The invite link is `https://<site>/#/join/<roomId>.<secret>`; the fragment keeps it out of web-server logs;
  - a **short code** for voice: 10 characters of Crockford base32 (`K7QD-M2XP-9R`) that maps to the link at the relay. It is rate-limited per IP so it cannot be enumerated.
- **Player identity.** On first join a player gets a 128-bit **player token** for that room, kept in the browser's IndexedDB. The relay stores only a hash. The token, not the name, identifies a returning player, so two people may share a name.
- **A room made from a save** ("Host saved game", or re-hosting after the relay is lost). The uploading client sends the save's `sim_meta` (10 §15.8) with it, and the relay seeds each player's `acceptedThrough` from that player's `last_seq` and its own system-action counter from `last_system_seq`, so seqs keep rising (D21). The save's roster becomes unclaimed slots: the host claims its own index, and a joiner's dialog offers the unclaimed names, so a returning colleague gets back their character and inventory; anyone else gets a new index.
- **Owner and admins.** The owner (the creator) holds an admin token. Admins can kick, ban, promote, pause and change room settings. Factorio's own default is admins-only pausing [8].
- **Room creation.** The deployment chooses:
  - **private**: creating rooms needs a server-wide creation key, entered once in Settings. This is the default, since the user's server is for friends and colleagues;
  - **public**: anyone can create rooms, within per-IP rate limits.
- **Versions.** `HELLO` carries the build hash, protocol version and `prototypes.hash`. A room is pinned to its current build while anyone is in it:
  - a client with a different build is refused with a reason. A newer client sees "This game runs build X", and an older one is told to reload, which fetches the new build past every cache, the optional service worker's included (10 §9.7);
  - **an empty room is upgraded only from a sealed checkpoint** (A2-r1 #6). Migrating an old checkpoint and then replaying its log under the new build would apply old actions under new rules, which may change the factory or meet actions the new build reads differently. So:
    1. if the room is not sealed, the first player to resume it with a newer build loads the room's *own* build from the site's build archive (`/builds/<buildHash>/`, kept while any stored room references it);
    2. that client replays the log to the persisted horizon under the old build, and uploads a sealing checkpoint, **baked** (10 §4.4) whenever the new build's worldgen version or worldgen data differ, so the new build never regenerates land under rules it does not have;
    3. it reloads the new build, migrates the sealed checkpoint on load (10 §8.3), which starts a new digest lineage, and publishes the migrated checkpoint atomically together with the new build pin (one transaction, §4.3).

    Players see "Updating the saved game" (§8.4). The build archive is pruned only of builds that no stored room references.

### 6.4 Persistence

**Yes, the relay stores games.** Storing is within the constraint, and it is what makes rooms outlive their players. For each room it keeps:
- the newest complete checkpoint (the save container as uploaded, published atomically, §4.3);
- the append-only closed-tick log since that checkpoint. **Each batch of closed ticks is written to the log before it is broadcast** (write-ahead), and the log is flushed to disk (`fdatasync`) every second (§6.9);
- the room generation (§6.9) and each player's acceptance watermark (§3.3), which after a restart is re-derived from the persisted log (§6.9);
- the blobs that retained closures or stored checkpoints reference (§6.5);
- the roster;
- the last 200 chat lines;
- open desync bundles.

**Retention** (room settings, with server-wide caps):
- a room expires 30 days after its last activity;
- at most 2 snapshots of at most 128 MB each;
- desync bundles are kept for 14 days.

The owner can delete a room at once. A snapshot holds only game state and names: no e-mail addresses, no IP addresses. The relay logs IP addresses only in its rate limiter, with short retention.

**Storage backends:** the filesystem for the Node relay; SQLite or R2 for Cloudflare.

### 6.5 Limits

| Limit | Value | Why |
|---|---|---|
| Players per room | 8 by default, at most 32 | The design target is 2–8. The maximum of 32 is structural: the simulation's preflight and `builtBy` encoding allow player indices 0–31 (10 §15.3, §4.5) |
| Action rate per player | 120 actions/s sustained, bursts of 600 | Drag-building and fast transfer burst; anything beyond is a bug |
| Inline action payload | 65,531 bytes (an encoded action fits a `u16` length); blobs up to 8 MiB | Field widths (§3.2) and head-of-line protection on the control socket |
| Entries and bytes per `TICKS` message | 65,535 entries, about 1 MiB; longer ranges split | Field widths (§3.2) |
| Control-socket inbound | 64 KiB/s per player | Ten times normal use |
| **Relay → client control queue** (A2-r1 #8) | High-water mark 2 MiB of unsent data (about 6 minutes of the tick stream); above it the relay closes that connection | A client that stops reading (frozen tab, dead path) must not grow the relay's memory. On its return it resumes from the log or re-syncs |
| **Relay → client bulk queue** | References to stored chunks, never copies; at most 4 MiB in flight per socket | Snapshots exist once per room, however many joiners fetch them |
| **Net worker → simulation queue** (client) | 64 MiB or 10 minutes of ticks; above it the client drops the queue and plans a re-sync | A frozen or overloaded simulation must not take the page's memory with it |
| **Retained log per room** | 64 MiB or 2 hours since the newest checkpoint; on reaching it the relay asks for a new checkpoint, then truncates | Bounds resume and cached-join replay; a client needing older ticks re-syncs |
| **Transfer deadlines** | A chunk at least every 10 s; a whole snapshot within the larger of 10 minutes and size ÷ 32 KiB/s (§4.3) | A stalled donor must not hold a join or a repair forever |
| Snapshot size | 128 MiB | Five times the Late estimate |
| **Room storage budget** | 512 MiB per room (checkpoints, log, blobs, bundles); a server-wide budget refuses new rooms when full | Storage abuse and runaway logs |
| **Blob retention** | A blob is kept while any retained closure or stored checkpoint references it, and deleted when the log truncation that drops its last reference runs | Replays, resumes and cached joins need every blob their closures name |
| Rooms per creator IP | 10 per day (public mode) | Abuse |
| Connections per IP | 32 | Abuse |

### 6.6 Cost per room

**Measured** on this host, a 2013 Xeon E5-2650 v2 core at about 0.42–0.55× a 2020 laptop core (10 §11; A1 measured 0.42× at base clock). Four simulated players per room, each with a 60 Hz tick stream, `STATUS` at 10 Hz, 2 actions/s and pings (`poc/loadgen.mjs`, §12.7):

| Rooms × 4 players | Relay CPU (one core) | CPU per room | Relay memory |
|---|---|---|---|
| 1 | 3.0% | 30 ms/s (mostly fixed timer overhead) | 69 MB |
| 10 | 12.4% | 12 ms/s | 77 MB |
| 50 | 41.9% | 8.4 ms/s | 89 MB |
| 100 | 64.7% | 6.5 ms/s | 107 MB |

- **CPU.** With 50 or more rooms per process, a four-player room costs under 1% of one old core (a lone room 3%, mostly fixed timer overhead); 100 rooms fit in two-thirds of it. One current VPS core serves well over 100 rooms. An eight-player room roughly doubles the sends.
- **Bandwidth.** About 6 kB/s of egress per player during play (§2.7): 0.4 Mbit/s for a full eight-player room. A four-hour session with 8 players is about 0.7 GB of egress. Joins add their snapshot once on the way in and once per joiner on the way out.
- **Storage.** About 25 MB per late-game room, plus its log (a few MB per hour).

### 6.7 Deployment options

1. **A small VPS (recommended for version 1).** Caddy on 443 serves the static build and proxies `/mp/` to the relay. One systemd unit, logs to journald, rooms on the filesystem. Choose the location near most players (Frankfurt for the user's colleagues). The static site and the relay share the origin (§2.4).
2. **Cloudflare Workers with Durable Objects (viable).** One Durable Object per room is a natural single-threaded sequencer, created near the first player. The static site goes to Workers static assets on the same domain.
   - **Limits:** received WebSocket messages up to 32 MiB; a soft limit of 1,000 requests per second per object; up to 10 GB of SQLite storage per object with values of at most 2 MB, so snapshots go in 1 MB rows or into R2 [28].
   - **Prices** [29]:
     - duration: $12.50 per million GB-s, billed at 128 MB per object;
     - incoming WebSocket messages count as one request per 20 messages, at $0.15 per million requests;
     - outgoing messages are free;
     - the $5/month plan includes 400,000 GB-s and a million requests per month.

     A four-hour session therefore costs about $0.02 of duration and less than a cent of requests: a few dollars a month for heavy use.
   - **Caveats:**
     - a running room cannot hibernate, because the tick loop keeps it awake;
     - `Date.now()` and `performance.now()` advance only after I/O in deployed Workers, as a Spectre mitigation [37]. The tick loop must therefore derive ticks from timer callbacks and message arrivals; verify the timer precision before relying on it;
     - snapshots move through R2 or SQLite in chunks.

   `RoomCore` is written so that this adapter is about 300 lines. **Deferred** (A2-r1 #17): it is built only after full-snapshot recovery works on the Node relay, and after its write-before-broadcast durability (§6.9) has been mapped onto Durable Object storage.
3. **This host (cpuserver10), for development.** The relay runs next to the Vite dev server and players use the SSH tunnel (CLAUDE.md). Outside players need a public endpoint, so it is not a deployment.

A claude.ai Artifact cannot host multiplayer: it serves the static page only, and its content security policy does not allow arbitrary WebSocket endpoints.

### 6.8 Observability

- **Logs.** Structured JSON lines: connections, joins, leaves, desyncs, snapshots, errors.
- **Metrics.** `GET /metrics` in Prometheus text format: rooms, players, messages and bytes per second, lag distribution, late-action rate, desyncs, join and re-sync durations, snapshot sizes and upload rates.
- **Admin endpoints**, behind the server's admin key: `GET /admin/rooms` (`/stats` in the PoC); per-room live state; desync bundles for download.
- **Client side.** The F5 debug overlay (I §4.21) gains a network section: RTT, margin, playout delay, horizon lag, ticks per second received, late actions, the bytes-per-second meter and the digest epoch. Factorio has comparable multiplayer debug options.

### 6.9 Restarts and failures

The action history must never fork (A2-r1 #1, critical). No client may ever simulate a tick whose actions the relay could later assign differently. "Re-adopting" closures from the first client to reconnect after a crash is unsafe: another client may hold a longer suffix and have simulated ticks the relay would then refill with different actions.

**Durability rule: write before broadcast.** The relay appends each batch of closed ticks to the room's log with `write(2)` *before* sending it to any client, and flushes with `fdatasync` once a second (or after every batch, in a "durable" mode for hosts with fast disks).
- A **process crash** (a bug, an out-of-memory kill, a bad deploy) loses nothing: the written data is in the operating system's page cache and reaches the disk anyway. The persisted log then covers every tick any client has seen.
- Only a **machine crash** (host failure, power loss) can lose up to 1 s of written-but-unflushed ticks, which some clients may already hold.
- The cost is one small write per batch: at 60 Hz and 100 rooms, about 6,000 writes per second, a few percent of one core.

**Room generations.** Every relay start gives each restored room a new generation `g + 1`, with a restored horizon P: the last tick in its log. Each player's `acceptedThrough` is re-derived as the highest seq of that player in the persisted log (or the checkpoint's `last_seq` when the log has none), and likewise the system counter: actions that were accepted but never written are thereby forgotten, and their clients re-send them, since they lie above the watermark.
- A client resumes only with `HELLO{roomGeneration: g, resumeFrom ≤ P + 1}`. Its ticks up to P are the persisted ones, because the persisted log is a prefix of what was broadcast, and every client received the same stream in the same order. The relay then sends the new generation in `WELCOME` and continues from P + 1.
- A client whose horizon is beyond P saw ticks the relay has lost. That can only happen after a machine crash. It must **rewind**: it discards its world and re-syncs from the room's stored checkpoint plus the log through P, under the new generation. Up to 1 s of play is lost.
- The relay never adopts closures from clients.

**Graceful restart (deploys).** The relay stops accepting, closes and flushes every room's log through its last closed tick, sends `NOTICE{restarting}` and exits. Clients keep their state, reconnect with backoff, and resume under the new generation from P + 1, which is exactly their horizon: a pause of a few seconds and no rewind.

**Relay lost for good.** Any player hosts their last local autosave as a new room (§4.6).

## 7. Engine seams

Networking arrives late (the MP milestone, after M4), but these seams must exist from the first line, because retrofitting them means touching every system. Chapter 10 specifies them. **S1–S10, S12, S14 and S15 are M0-mandatory; S11 is M0-mandatory in part; S13 comes with the MP milestone.**

| # | Seam | Where in 10 | When |
|---|---|---|---|
| S1 | **Players everywhere**: `World.players[]` by `u16` index (at most 32), with input generations and creation rings; `builtBy` = 16 + i for player i; the `PLAYERS` save section | §4.4, §4.5, §8.1 | **M0-mandatory** |
| S2 | **The action pipeline**: one schema generates the TypeScript encoder and the Rust decoder; per-player batches; identity `(player, u32 seq)`; one admission function bounds every tick in both formats; only closures are applied, in their stated order, after a preflight that asserts each player's `(tick, seq)` rising (D21); malformed actions are refused, not fatal; in single player every action is encoded and decoded too | §15.1, §15.3 | **M0-mandatory** |
| S3 | **The sequencer interface, with clock generations**: `submit`, `onClosures`, `clock()`, `control()`; the `LocalSequencer` for single player and replays, its native twin the `TestSequencer` for tests; the `RelaySequencer` behind the same interface | §3.3, §10.2 | **M0-mandatory** (local); MP (relay) |
| S4 | **Simulation state apart from UI state**, with the settings audit | §7.6 | **M0-mandatory** |
| S5 | **Entity references by identity**: serials and creation ids, no position fallback (D23) | §4.3, §15.3 | **M0-mandatory** |
| S6 | **Determinism rules D1–D23** and their tests, comparing full canonical state | §4.1, §10.4 | **M0-mandatory** |
| S7 | **Digests with lineage**: the pinned per-tick record, a generated shard map that covers every saved section, the rolling digest from a pinned r₀; checkpoints carry `r` outside the state hash, and a load that remaps or migrates starts a new lineage; epochs are the relay's, never saved (§5.1); per-phase digests in debug builds | §4.8 | **M0-mandatory** |
| S8 | **Input log = closure log**, with its blobs and digests | §8.5 | **M0-mandatory** |
| S9 | **Complete checkpoints at a tick boundary, and fast-forward**: every section, pending worldgen requests included; a manifest; canonical section-wise serialization and no page layout | §8.1, §8.6 | **M0-mandatory** |
| S10 | **Feedback tagged by action, and historical events marked**; movement and placement checks runnable on a scratch character | §15.6, §5.1 | **M0-mandatory** (tagging, marking); MP (the latency state, §3.5) |
| S11 | **Worker topology**: the sim worker takes closures from a port; a second worker is created, loaded and swapped in for every world replacement; the net worker feeds the same port | §3.1 | M0 (the port and the swap); MP (the net worker) |
| S12 | **Identity and versions**: the build hash (both modules, protocol, `prototypes.hash`, schema hash) in saves and checkpoints; the roster in the save header, outside the hash | §2.3, §8.1, §15.2 | **M0-mandatory** (fields); MP (roster) |
| S13 | **Chat and presence channel**, out of band; in single player chat stays the notes line of I §4.19 | — (§8.3 here) | MP |
| S14 | **No pause semantics in the World**: pause, speed, the hidden-tab pause and the technology screen's pause are sequencer and clock states, so multiplayer can simply not send them | §3.3 | **M0-mandatory** |
| S15 | **World-replacement protocol**: a state generation on every packet, response and event; full invalidation, re-subscription, stale-response rejection, latency-state and audio reset | §3.4, §15.5 | **M0-mandatory** |

**Single player is multiplayer with a local transport.**
- The main thread's input layer produces actions. They go to the `LocalSequencer` in the sim worker, which stamps them for the next tick (margin 0) and closes ticks from its clock. The simulation applies closures exactly as it would in a room of eight.
- Test mode's `step(n)` closes n ticks.
- Replays feed recorded closures.
- Loading a save goes through S15, exactly like a join.
- What single player skips: the relay, stamping estimates, playout buffering, digests reported to anyone, and the latency state (with a margin of 0, prediction equals confirmation).

Version 2 of chapter 10 applied A2's list of changes to it; its "Changes in v2" table records each with its source.

---

## 8. UI and UX

Factorio's multiplayer UI where it exists. I BEND-2 removed it from the slice ("no players list, pings, permissions or admin"), and the controls it reserved come back: place-ping (Ctrl+Alt+LMB, "Quickly create a map ping at the selected location and link to it in the chat") and the side-menu *Players* button (I §4.1).

### 8.1 Main menu and hosting

- **Main menu** (07 §18): **Multiplayer** goes after *Load game*, as it follows the single-player entries in Factorio's *Play* menu.
- **The Multiplayer screen:**
  - **Host new game**: the New game screen (07 §17) plus a *Room* panel with: name; maximum players (8); pause when nobody is connected (on); pause while a player joins (off); only admins can pause (on); store the game on the server (on); match the slowest player (off).
  - **Host saved game**: the Load list. The save is uploaded as the room's first snapshot.
  - **Join game**: paste a link or type a code.
  - **Recent games**: rooms this browser has joined, with players online and last activity. One click rejoins.
- **No lobby** (ISO: Factorio has none). The host is in the game at once. A share panel (Esc menu, *Invite*) shows the link and the code with copy buttons. Joiners come into the running game.
- **Player name and colour**: Settings → Interface, stored in IndexedDB. Factorio's `/color` works too [39].

### 8.2 Joining

**Opening an invite link** shows one small dialog: the room's name, the host's name, the player name field (pre-filled), and *Join*. Progress then follows Factorio's stages:
1. *Connecting*;
2. *Downloading map* (MB of MB, with rate);
3. *Loading map*;
4. *Catching up* (percent).

Each step happens only once per join, and errors name their cause:
- a different build ("update and retry");
- an expired invite;
- a full room;
- no reachable donor ("waiting for a player to send the map").

### 8.3 In the game

- **Players window** (side-menu button; Factorio's *Players* GUI). Each player has a row with:
  - colour, name and admin badge;
  - online, away (tab hidden), or offline with "last online";
  - **ping and lag** (UPS if they are behind);
  - admin actions (kick, promote).

  A `/players` command prints the same, and `/kick`, `/ban`, `/promote` and `/demote` work as in Factorio [39].
- **Chat and console** (`` ` ``, I §4.19). Plain text is chat to everybody, with names in each player's colour (2.1.18 [I-data]). Also:
  - `/w name text` whispers and `/r` replies;
  - system lines: "X joined the game", "X left the game";
  - Shift+click inserts rich-text links (`[gps=…]`, `[item=…]`), as in single player.
- **Map pings.** Ctrl+Alt+LMB places a ping marker everyone sees for a few seconds, plus a chat line with a gps link (ISO).
- **Other players in the world:**
  - their characters, with name labels in their colours (ISO);
  - their names in map view;
  - **their selection rectangles in their colours**, labelled with their name only when their character is off-screen (Factorio 2.0.33 [I-data]). Selection travels as presence at most 10 Hz, only on change (§3.7).
- **Remote cursors** (a BEND, off by default). A small arrow with the name at another player's mouse position, for colleagues showing each other a design. Factorio does not have it; it is presence data, costing about 2 kB/s for a room. Open question (§11).
- **Connection indicators:**
  - a *waiting for server* icon at the top left when no tick has arrived for 0.5 s;
  - after 5 s, "Server is not responding" with a countdown to the reconnect attempt;
  - *Catching up* with a bar whenever the backlog exceeds 1 s;
  - a slow-computer warning (§3.6);
  - the F5 network section (§6.8).
- **Re-sync.** Silent in the background (§5.2). In the foreground (when the background repair would not converge), the same *Catching up* bar. After the third repair in 10 minutes the client stops repairing and shows a notice with *Send report*.
- **Pause.** When an admin pauses: "Game paused by X" over the view, as Factorio shows it.
- **Single-player pauses do not apply** (§3.6): the technology screen, Esc menu, run report and first-run panel open without pausing.
- **Per-player text** that 07 and 08 write for one player:
  - "Queued by: you" becomes "Queued by: {name}" for other players' queue entries (07 §5.3);
  - "Last action by you" (08 §8.5) stays per player;
  - the age/builder overlay (07 §3.1) shows the builder's name;
  - the run report's "Hand-crafted items" is the force total, with a per-player breakdown in its tooltip (owners of 04 and 07 to confirm).
- **Achievements in multiplayer**: each client records achievements for its own player in its own Run history. Conditions on force-wide state count for everybody present; per-player conditions (hand-crafting) use per-player accumulators (§3.7). 08 §6's "achievements are off while console cheats are used" applies to the whole room (Factorio [I-data]).

### 8.4 Strings to add to the text canon

None of these strings may be invented in code (`pm/README.md`). They are proposals for 08's owner, worded after Factorio's own where it has them:
- **Menu:** *Multiplayer*, *Host new game*, *Host saved game*, *Join game*, *Invite*, *Recent games*.
- **Join stages:** *Connecting*, *Downloading map*, *Loading map*, *Catching up*; and *Updating the saved game* for an upgrade (§6.3).
- **System lines:** "{name} joined the game.", "{name} left the game.", "Game paused by {name}.", "Server is not responding", "Your computer cannot keep up with this game.", "This game runs build {build}."
- **Players window columns.**
- **Room settings labels** (§8.1).
- **Error reasons** (§8.2).

### 8.5 Keys and settings

- **Keys.** No new default keys. *Players* gets no default (as in Factorio); place-ping keeps Ctrl+Alt+LMB; chat keeps `` ` ``.
- **Settings → Interface:** player name, player colour, show remote cursors (off), show chat in the game view (on).
- **Settings → Other:** relay address and creation key, for private deployments.

---

## 9. The test plan

1. **Unit** (Vitest, Node; `cargo test` for the crate):
   - the wire and action codecs: round trips with fast-check at every field limit, and refusal of payloads over 65,531 bytes, 65,536-entry batches, truncated messages and non-contiguous ranges (§3.2);
   - the shared admission function (10 §15.3) against the fixture that the `LocalSequencer` and the native `TestSequencer` also pass: ticks filled to both limits with players alternating (the worst expansion from wire entries to batches), the system reserve, spills that keep each player's order, and one tick per `TICKS` message;
   - malformed and unknown actions from a hostile client: refused in every world with the same event, never a trap;
   - `RoomCore` on a simulated clock: acceptance, late handling and per-player order (D21); deduplication and the acceptance watermark; system-action injection and grace timers; clock generations on pause, resume, speed changes and relay stalls; closing the snapshot marker before a join pause; digest verdicts with epochs, expected membership, late reporters and winning-group donors; the snapshot transaction (manifest, bounds, duplicates, deadlines, atomic publication); write-before-broadcast with crash points injected, and rewinds under a new room generation; queue high-water marks; blob retention;
   - the simulation's input fencing (D22) with both generation-changing actions (`release_inputs`, `player_left`), and identity-based targets (D23), including mine-and-replace races;
   - seq continuation after a reconnect, a page reload and a world replacement with accepted actions pending above the loaded watermark (10 §3.2);
   - the margin and playout controllers fed recorded traces;
   - the LEDBAT pacer against a simulated FIFO queue at 2 and 10 Mbit/s: progress at every rate, and the added delay against its 25 ms target.
2. **The in-process multi-client harness** (Vitest, with the real `sim.wasm` worlds; it runs in seconds), based on the M0 sequencer interface and extending M0's native harness (10 §10.4 #8):
   - N worlds driven by a simulated relay over a **deterministic discrete-event network**: per-link latency and jitter distributions, loss modelled as TCP head-of-line stalls, a shared FIFO bottleneck with a bounded queue, disconnects, black-holes and reordering *between* a player's control and bulk sockets;
   - scripted bots act; faults are injected: relay restarts (process and machine crashes), clock transitions, desyncs, upgrades of sealed and unsealed rooms;
   - asserted: **full-state agreement after every fault**, not only digest agreement (A2-r1 #15); every join and every swap *completes*; bounds on stall time, late actions and catch-up time per profile.

   This is the PoC's experiment made deterministic and fast.
3. **Real network, real browsers** (Playwright; nightly and before the multiplayer milestone's exit):
   - the Node relay, an impairment proxy (the PoC's `netem.mjs`), and 2–4 pages. Chrome with SwiftShader runs with `?render=on-demand`, Firefox headless with `?render=none`, one page per engine;
   - scripted play plus joins, drops, black-holes, a forced desync, a hidden page (only through a directly launched Chrome over CDP, since Playwright's own launch disables background throttling, §12.5), and a frozen page;
   - every page fails on any console error (10 §10.5).
4. **Real-engine resource tests** (A2-r1 #14, #15). The PoC emulates tick cost with a blocking wait, which uses no CPU, so it says nothing about two worlds competing for cores. With the real simulation, measure on 2-, 4- and 8-core machines at Mid and Late scale:
   - the shadow's catch-up rate while the live world runs;
   - the joiner's catch-up rate;
   - the switch to foreground repair when convergence fails.
5. **Determinism fuzzing** (nightly): random action sequences from up to 8 simulated players on generated factories, run through D18(a–f), with native Rust, Node, Chrome and Firefox traces and full hashes compared. Failures shrink with proptest (native Rust) or fast-check (TypeScript) and turn into scenario tests.
6. **Soak**: 8 bot players for 2 hours, random joins, leaves and drops every few minutes. Zero desyncs; memory flat on clients and relay, within the limits of §6.5.
7. **Load**: 100 rooms of 4 on one relay process, without the load generator as the bottleneck. CPU per room and p99 tick-emission jitter within budget.
8. **Browsers this host cannot test** (A2-r1 #16). Once per multiplayer release, the capability matrix of §2.2 is rechecked, and release Safari is tested beside Chrome and Firefox on real machines. The extended 10 §10.6 `bench.html` gains a hidden-tab check (switch away for 6 minutes, then report the worker's tick rate), which the user runs.

**Green before multiplayer ships:**
- every D18 test passes on every golden save and scenario, with full-state comparison;
- 100 hours of cross-engine fuzzing without a divergence;
- the harness matrix within budget, with **every join and swap completed** and full-state agreement after every fault;
- the real-engine resource tests pass: repairs converge, or switch to foreground repair in time, on a 4-core reference machine at Late scale;
- a two-hour soak with zero desyncs;
- a scripted three-player session across two browsers;
- join of a Late-scale save in under 30 s at 10 Mbit/s;
- a paced join at 2 Mbit/s that completes, with the donor's added delay within target;
- resume after a 3-s black-hole without a snapshot;
- a relay process crash with no rewind, and a simulated machine crash with a correct rewind;
- a forced desync repaired in the background;
- load test passed;
- the capability matrix rechecked, and the user's hidden-tab check passed in Chrome, Firefox and Safari.

---

## 10. Risks, ordered by importance

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Logic-level desyncs**: order, unsaved state, impure caches (D3, D4, D8, D9). The class that dominates in Factorio and OpenTTD, in any language | High during development | High | D1–D23 from M0; join equivalence, heavy mode and full-state comparison on every scenario; background re-sync and debug bundles turn the remaining ones into fixable reports |
| 2 | **Repairs that do not converge** on machines with few cores, where two worlds compete for CPU | Medium | Medium | The convergence check and the switch to foreground repair (§5.2); bounded attempts; real-engine resource tests (§9 item 4) |
| 3 | **Late-game joins and re-syncs on slow uplinks**: a 20 MB save at 2 Mbit/s takes 80 s, and pacing stretches it further; the PoC's crude pacer did not hold the donor's delay down at 2 Mbit/s | Medium | Medium | Relay-cached checkpoints from periodic paced uploads; best-uplink donor; a tuned LEDBAT tested at 2 Mbit/s; "pause while joining"; delta re-sync if measurements justify it |
| 4 | **Browsers suspending background tabs**: Chrome's Energy Saver freezing [33], Firefox's Nightly worker throttling [36], Safari's documented timer throttling, iOS suspension and App Nap [44] | Medium | Medium | The tick-driven worker loop; the catch-up/re-sync choice on wake-up; background execution treated as best effort; the capability matrix and the user's hidden-tab check |
| 5 | **A player's machine cannot hold 60 UPS late in the game** | Medium | Medium | Factorio's policy by default; "match the slowest player" as an option (§3.6). Rust/WASM raises the threshold (§1.4) |
| 6 | **Engine-level float divergence** | Low: one `sim.wasm` on every peer, with `libm` compiled in | High | D19 and the feature gate (10 §2.3); nightly cross-engine traces (10 §10.4) |
| 7 | **TCP head-of-line stalls on lossy links** (Wi-Fi, mobile) make the world hitch or lag 200–500 ms | Medium | Low–medium | Adaptive playout; predicted own character. Later, optional WebTransport where UDP is allowed |
| 8 | **Operating a relay**: hosting choice, uptime, privacy of stored games, abuse in public mode | Medium | Medium | Private mode by default; write-before-broadcast and room generations (§6.9); graceful restarts; client-side autosaves |
| 9 | **WASM traps** take a client's world down at once | Low | Medium | A trap is treated as a self-desync: fresh worker, checkpoint from a donor, bug bundle (§1.4, D19) |
| 10 | **Spec gaps for multiplayer**: per-player achievements and run-report lines, starting items for new players, offline-character rules, chat strings | Certain | Low | Listed in §8.3, §8.4 and §11 for the owners of 04, 07, 08 and 10 |
| 11 | **Version skew** between a service-worker-cached build and a room | Medium | Low | The build check in `HELLO` (D14); forced update; upgrades only from sealed checkpoints, with a build archive (§6.3) |

---

## 11. Open questions for the user

1. **Hosting.** A small VPS (simplest, about €5/month) or Cloudflare Workers with Durable Objects (no server to run, a few dollars a month)? Private (creation key, the default) or public?
2. **Server-side storage.** Should the relay store games by default? The default is yes, retained 30 days after last activity.
3. **A slow machine.** Keep 60 UPS and disconnect a player more than 60 s behind (Factorio; the default), or slow the whole game to the slowest player (an option)?
4. **Remote cursors.** Show other players' mouse cursors (useful for showing colleagues a design; not in Factorio)? The default is off.
5. **New players' starting items.** Factorio's freeplay gives every newly created player a starting kit. Here, should each new player get 01 §9's start inventory, or should only the first player get it, with later players starting empty-handed while the salvage stays per game?
6. **Player cap.** 8 by default (the design target), configurable to 32?

---

## 12. Proof of concept

### 12.1 What it is and how to run it

The proof of concept is in `design/multiplayer/poc/`: about 2,550 lines of JavaScript, Node 24, and `ws` 8.22.0 as the one dependency. It lints clean under the project's Biome 2.5.15. It was patched after the codex review where that was cheap and could confirm a fix (§12.9).

| File | What it is |
|---|---|
| `protocol.mjs` | The wire format of §3.2 (binary `TICKS`, `ACT`, `ACTACK`, `STATUS`, `DIGEST`, `PING`/`PONG`, snapshot chunks) |
| `sim.mjs` | A toy deterministic simulation: integer state; per-player characters and inventories; drills and furnaces that compete in slot order; a saved LIFO free list; counter-based RNG; per-tick digest, rolling digest and rotating slice hash; serialize/deserialize with optional incompressible padding to emulate save sizes |
| `relay.mjs` | The relay and sequencer of §6 (about 450 lines, with its stats and static-file endpoints) |
| `client-core.mjs` | The client of §3–§5: stamping with margin control, adaptive playout, catch-up, donor uploads with optional LEDBAT pacing, background re-sync with a shadow simulation, resume, and held-input re-send. Runs in Node and in a browser worker |
| `client.mjs` | A headless Node client with a scripted bot player |
| `shadow-worker.mjs` | The background re-sync's shadow simulation in its own thread (§5.2) |
| `netem.mjs` | A userspace TCP impairment proxy (there is no root, so no `tc`): delay, jitter, loss as head-of-line stalls, a shared FIFO bottleneck with a bounded queue and TCP back-pressure, drops, black-holes |
| `run-scenarios.mjs` | The scenario matrix (§12.2–§12.4, §12.6, §12.9). It requires full canonical-state agreement and reports whether every player got into the game |
| `probes.mjs` | Wire-level probes for ordering, field limits, malformed input and duplicate chunks (§12.9) |
| `loadgen.mjs` | The relay load test (§12.7) |
| `summarize.mjs` | Turns the result files into the tables of this section (`results/summary.md`) |
| `browser/` | The page, the worker and the hidden-tab experiment over raw CDP (§12.5) |

Run (pinned to CPUs 8–15 on this host):
- `cd design/multiplayer/poc && npm ci`
- `taskset -c 8-15 node run-scenarios.mjs [name …] > results/matrix.txt` writes one `results/<name>.json` per scenario, about 70–90 s each;
- `node summarize.mjs > results/summary.md` turns them into the tables below;
- `taskset -c 8-15 node probes.mjs`, about 5 s;
- `taskset -c 8-15 node loadgen.mjs --rooms 50`;
- `xvfb-run -a taskset -c 8-15 node browser/hidden-tab-cdp.mjs 390`, about 8 minutes.

What the toy simulation does not show: real tick costs (emulated with a blocking wait), real save sizes (emulated with padding), and the latency state (only its prerequisite, prediction exactness, is measured). The PoC's client runs its network code in the simulation's thread, which the design does not do (§2.4); that matters in §12.3 and §12.4. Its watchdog closes a silent link after 1.5 s, half the design's 3 s. The shadow simulation of a re-sync runs in its own thread, as in the design.

All numbers below are from the final run of every scenario (`results/matrix.txt`, `results/summary.md`), pinned to CPUs 8–15 while another agent benchmarked on the other socket. Network profiles are one-way per direction, applied by `netem.mjs`. "Loss stalls" are the share of messages held back by a retransmission, together with everything behind them.

### 12.2 Latency, stamping and playout

Scenarios:
- `base`: three players on LAN, home and far links. The home player's link drops at 30 s; the LAN host's link black-holes for 3 s at 38 s; the far player joins at 20 s and corrupts its state at tick 2700.
- `relaystamp`: the same, with stamping on arrival at the relay.
- `hz30`: the same, at 30 tick messages per second.
- `mixed`: four players on home, Wi-Fi, mobile and far links, without faults.
- `harsh`: a stress link.

| Scenario: player (one-way delay ± jitter, loss stalls) | RTT ms | Input delay p50 (ticks) | Walk inputs mispredicted | Confirmed p50 / p95 ms | Applied locally p50 / p95 ms | Playout delay ms | Underruns (total) |
|---|---|---|---|---|---|---|---|
| base: A, LAN (1 ± 1 ms) | 4 | 1 | 0.0% | 30 / 47 | 48 / 77 | 8 | 2 (3.0 s: the black-hole) |
| base: B, home (12 ± 6 ms, 0.3% × 150 ms) | 27 | 2 | 3.3% | 54 / 65 | 143 / 174 | 129 | 8 (0.7 s, with the drop) |
| base: C, far (45 ± 20 ms, 1% × 250 ms) | 110 | 4 | 4.9% | 142 / 356 | 383 / 415 | 259 | 3 (0.3 s) |
| relaystamp: A, LAN | 4 | 0 | **3.4%** | 14 / 21 | 32 / 48 | 8 | 1 (3.0 s) |
| relaystamp: B, home | 27 | 1 | **10.0%** | 42 / 50 | 123 / 156 | 114 | 7 (0.7 s) |
| relaystamp: C, far | 108 | 3 | **31.7%** | 129 / 365 | 366 / 382 | 259 | 3 (0.3 s) |
| hz30: A, LAN | 4 | 1 | 0.0% | 37 / 53 | 53 / 73 | 22 | 1 (3.0 s) |
| hz30: B, home | 28 | 1 | 0.0% | 55 / 80 | 88 / 101 | 46 | 3 (0.4 s) |
| hz30: C, far | 99 | 4 | 7.3% | 140 / 172 | 374 / 389 | 258 | 4 (0.4 s) |
| mixed: A, home | 30 | 1 | 0.0% | 43 / 112 | 178 / 195 | 150 | 5 (0.2 s) |
| mixed: B, Wi-Fi (15 ± 20 ms, 0.5% × 200 ms) | 45 | 2 | 3.3% | 73 / 205 | 262 / 279 | 211 | 5 (0.3 s) |
| mixed: C, mobile (30 ± 40 ms, 1% × 300 ms) | 89 | 15 | 8.3% | 310 / 471 | 599 / 626 | 323 | 5 (0.4 s) |
| mixed: D, far | 95 | 6 | 10.5% | 253 / 470 | 417 / 589 | 259 | 3 (0.3 s) |
| harsh: B (40 ± 60 ms, 3% × 400 ms) | 135 | 28 | 5.1% | 616 / 905 | 960 / 995 | 452 | 1 (0.4 s) |

*Confirmed*: from sending an action to receiving the closed tick that contains it. *Applied locally*: until the player's own confirmed simulation executes it, which adds the playout buffer. *Mispredicted*: the relay assigned a tick other than the one the client stamped, the prerequisite for exact prediction (§12.10).

**Findings.**
- **Stamping.** Client stamping mispredicts only actions that arrive late, or that per-player order moves (0–5% on these links; 8–11% on mobile and far in `mixed`). Relay stamping mispredicted 3%, 10% and 32% of walk inputs on LAN, home and far links in this run. Across four runs it ranged 2–24% on LAN, 10–35% at home and 32–54% on the far link, each misprediction a tick or more (0.15 tiles). Client stamping costs about 10–15 ms of confirmation latency (the margin).
- **The controllers changed during the PoC, and it shows.** With the first margin and playout controllers (§3.4, §3.6), `mixed` measured 10, 18, 21 and 22 underruns per minute on home, Wi-Fi, mobile and far links, with input delays of 2, 3, 20 and 18 ticks. With the final ones it measured 3–5 underruns per minute, with input delays of 1–2 ticks at home and on Wi-Fi, 4–6 on far links, and 5–15 on the mobile profile, varying between runs.
- **The cost of TCP on lossy links** is the playout buffer. With a stall of 150–400 ms for every 100–300 messages, the buffer settles near the stall length (130–450 ms), so the world runs that far behind the player's predicted character. Real wired connections lose far less than these profiles, so their buffers are smaller.
- **30 Hz** cuts the tick messages from 57–60 to 31–33 per second, and the payload from 44–46 to 27–28 kB per minute, for a few milliseconds more confirmation latency (8 ms on average in theory). The PoC's first relay woke a fraction of a millisecond before each tick boundary and split most 30 Hz batches; waking 1 ms after the boundary fixed it (§12.9).
- **Resumes.** The 30-s drop and the 3-s black-hole both resumed from the relay's log, without a snapshot.
- **Every scenario ended with all players in the game** (except `slow`, §12.4), and with both rolling digests and **full canonical state** equal at the last two common checkpoints (`results/matrix.txt`).

### 12.3 Late-game joins and the donor's uplink

`bigjoin`: a 21 MB snapshot, every client spending 4 ms per tick (round 5's Late estimate; 10 §4.7 now projects about 2 ms), and both players on home links capped at 10 Mbit/s up and 50 Mbit/s down. Each link is a single FIFO with a 300 ms queue, shared by the player's control and bulk sockets. bigjoin-paced: the same with the LEDBAT-style pacer (§4.3). slowlink-paced: a 4.3 MB paced join over a 2 Mbit/s uplink (§12.9).

| | Unpaced, 10 Mbit/s | Paced, 10 Mbit/s | Paced, 2 Mbit/s |
|---|---|---|---|
| Snapshot transfer (donor → relay → joiner) | 17.2 s (10 Mbit/s would take 16.8 s) | 22.9 s (25–38 s in earlier runs) | 21.3 s for 4.3 MB (1.6 Mbit/s) |
| Joiner's catch-up | 1,371 ticks in 5.7 s | 1,821 ticks in 7.6 s | 1,371 ticks in 1.5 s (1 ms per tick) |
| Join completed | yes | yes | yes |
| Donor's control RTT, idle → during upload, p50 / p95 | 33 → **269 / 332 ms** | 32 → **43 / 165 ms** | 32 → **85 / 298 ms** |
| Donor's input delay p50 / confirmation p50 | 17 ticks / 304 ms | 4 ticks / 99 ms | 11 ticks / 204 ms |

**Findings.**
- **The catch-up formula holds.** The joiner's effective rate was 239 ticks per second (140 in an earlier run on a busier host), and §4.4's formula predicts 5.8 s against 5.7 s measured (13.1 s against 12.9 s in the earlier run).
- **Pacing.** The unpaced donor's own game suffered for the whole transfer. The crude pacer protected it at 10 Mbit/s for a 33% longer transfer (up to twice as long in earlier runs). At 2 Mbit/s it kept the transfer moving but not the donor's latency, so a tuned LEDBAT is an implementation requirement (§4.3). The time to join is dominated by the donor's uplink, not by anything on the relay.

### 12.4 A machine that cannot hold 60 UPS

`slow`: three players on home links. B needs 20 ms per tick.
- **B** received its 1.1 MB snapshot in 0.4 s but **never finished joining**: it falls a further 10 ticks behind every second, so it never became live, never got a character and never sent an action. The runner reports it as not in the game.
- **A and C were unaffected:** input delay 1 tick, confirmation p50 43 ms, 3–4 underruns, the same as any home link in the other scenarios. The relay does not wait (§3.6).
- In the first matrix, which ran B's networking on its saturated thread, B's control RTT reached 5.4 s. That is one reason the design gives networking its own worker (§2.4).

### 12.5 Hidden tabs and frozen pages (Chrome 156)

**Method.** `browser/hidden-tab-cdp.mjs` puts four browser clients, each a dedicated worker owning its WebSocket, into one room with a Node host. Each runs as a tab of one window under Xvfb; a blank tab in front hides them for 390 s (6.5 minutes, past Chrome's 5-minute threshold for intensive throttling [38]).
- The clients differ in pacing: the worker's tick loop is woken by its own timers, by arriving tick messages, or by both. The fourth uses both and is also frozen for 90 s through CDP `Page.setWebLifecycleState`, which is what Chrome's Energy Saver does to CPU-heavy background tabs [33].
- **Why not Playwright.** Playwright cannot run this experiment. It launches Chromium with `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`, and enables focus emulation on every page. Its Firefox profile sets `dom.min_background_timeout_value: 0`, disables budget throttling and keeps top-level documents active (Appendix A, local measurements). Pages it drives report `visible` behind other tabs.
- Chrome is therefore launched directly with its normal flags and driven over raw CDP (`Target.createTarget`, `Target.activateTarget`, `Runtime.evaluate`).

**Results** (`results/hidden-tab-chrome-cdp.json`):

| Measure | Visible | Hidden |
|---|---|---|
| Main-thread `setTimeout(16)` chain, wakes per second | 62 | 6.5 in the first 10 s, then 1, then 0 per 10-s window from about the second minute on |
| Worker `setTimeout(16)` chain, wakes per second | 62 | 50–60 for all 6.5 minutes (no throttling) |
| Lag behind the relay, timer-paced worker | 0–7 ticks | 2–8 ticks throughout |
| Lag behind the relay, tick-driven worker | 0–7 ticks | 2–8 ticks throughout |
| Frozen tab (90 s) | — | Stopped completely, worker included (2.9 wakes/s in the window where it froze, then none); **its WebSocket stayed open**; lag 5,413 ticks after 90 s. After unfreezing it caught up 5,422 ticks in 89 ms (toy simulation) and was back in lockstep within the next 30-s sample |

**Firefox** could not be measured here. Pages of the Playwright build of Firefox 157, even launched without Playwright on a clean profile under Xvfb, never reported `hidden`. Its source answers the question instead [35][36]:
- worker timers go through the same `TimeoutManager` as window timers, but the switch `dom.workers.throttling.enabled` is `@IS_NIGHTLY_BUILD@`, so **release Firefox does not throttle worker timers in background tabs, and Nightly does** (1 s minimum, a 50 ms budget regenerating at 1 ms per 100 ms);
- network and port messages are not timers and are unaffected by either.

Hence the rule of §3.6: a tick-driven simulation worker, and a check on the user's own machine (§9 item 7). **Safari** remains unmeasured.

### 12.6 Desyncs and re-syncs

| Scenario | Corrupted | Detected | Re-sync download | Swapped in after the verdict | Afterwards |
|---|---|---|---|---|---|
| `base`: far player C | tick 2700 | at the tick-2760 report, relay tick 2781 | 2.2 MB in 133 ms over the 100 ms link | 731 ms (including the deliberate 30-tick handover lead) | full state equal at ticks 2400 and 3000 |
| `lagreport`: B runs 6 s behind on purpose | tick 1500 | on the late path: its tick-1560 report arrived at relay tick 1923 | 1.1 MB in 172 ms | 6.2 s: the shadow waited for B's lagging live world | full state equal at ticks 2400 and 3000 |
| `bigresync`: late game, 4 ms per tick, 21 MB, donor uplink 10 Mbit/s | tick 1500, during the join's catch-up | at the tick-1560 report, relay tick 1570 | 21 MB in 17.1 s | **23.3 s**, by the shadow thread | full state equal at ticks 4200 and 4800 |
| bigresync-paced: the same, paced | tick 1500 | tick 1560, reported during catch-up (relay tick 1827) | 21 MB paced, 22.3 s | **30.1 s** | full state equal at ticks 4200 and 4800 |

**The repair went unnoticed in play.** During both late-game re-syncs the desynced player kept playing, with confirmation p50 49–50 ms and 5–6 underruns (0.1–0.4 s). Only its digests were excluded from votes.

**Rules the PoC's own first versions taught** (each is now in the design):
1. **Digest membership** is defined at the checkpoint tick (§5.1): comparing a tick once every player whose `STATUS` had passed it had reported compared the fastest client against nobody.
2. **Digest epochs** (§5.1): one desync caused four re-syncs from stale queued digests.
3. **The margin is a high percentile of recent need** (§3.4): "add each lateness, decay by a tick per 5 s" left 18–20 ticks of delay for a minute after one stall.
4. **Playout grows at once and shrinks slowly** (§3.6): recomputing it every second undid each underrun's widening.
5. **The shadow gets its own worker** (§5.2): time-sliced on the live thread at 4 ms per tick, it pushed the control RTT to 1–4.6 s and the late-game re-sync never finished.

### 12.7 Relay load

`loadgen.mjs` runs R rooms × 4 players that behave like players on the wire against one relay process: a 60 Hz tick stream in; `STATUS` at 10 Hz, an action every 0.5 s, and pings and digests out. It reads the relay's CPU time from `/proc` (`results/loadgen.jsonl`, final relay code):

| Rooms × 4 | Relay CPU | Per room | Memory | Tick messages per client per s |
|---|---|---|---|---|
| 1 | 3.0% | 30 ms/s | 69 MB | 60 |
| 10 | 12.4% | 12 ms/s | 77 MB | 60 |
| 50 | 41.9% | 8.4 ms/s | 89 MB | 60 |
| 100 | 64.7% | 6.5 ms/s | 107 MB | 60 |

On this 2013 Xeon a four-player room costs under 1% of a core once 50 or more rooms share the process (3% alone); 100 rooms fit in two-thirds of one core. A current VPS core is about twice as fast.

### 12.8 Bandwidth

Payload bytes as the clients counted them:

| | Down (relay → client) | Up | Tick messages per second |
|---|---|---|---|
| 60 Hz (`base`, `mixed`) | 44–47 kB per minute (0.75 kB/s) | 11 kB per minute (0.19 kB/s) | 57–60 |
| 30 Hz (`hz30`) | 27–28 kB per minute (0.46 kB/s) | 11 kB per minute | 31–33 |
| Load generator (`STATUS` at 10 Hz, no bot) | 0.81 kB/s | — | 60 |

On the wire, each message adds about 76 bytes of WebSocket, TLS and TCP/IP overhead (§2.7). That turns 60 messages per second into about 5 kB/s down: the per-message overhead, not the payload, is the cost, which is why 30 Hz is the useful lever.

### 12.9 Review fixes confirmed by tests

After the codex review (`pm/reviews/A2-r1.md`), the PoC was patched where that was cheap and could confirm a fix:
- **`probes.mjs`**, 10 wire-level checks, all passing:
  - a later action stamped earlier than its predecessor (start requested at tick 48, stop at 38) is assigned tick 48, and the closure runs them in send order (finding 2);
  - a 65,536-byte payload and a 65,536-entry batch are refused rather than wrapped to zero;
  - a 70,000-entry resume range splits into contiguous bounded messages;
  - a truncated `TICKS` message is rejected before the horizon moves;
  - a malformed `ACT` closes that connection with code 4002 while the relay survives (finding 9);
  - a duplicate chunk does not complete a two-chunk snapshot, an out-of-range chunk is ignored, and the snapshot completes when every chunk has arrived once (finding 11).
- **`lagreport`** (finding 4): a player running 6 s behind corrupts its state. Its report arrives long after the other two players' verdict, is compared on arrival, and triggers a repair from a winning-group donor. The repair swapped in 6.2 s later and ended with full-state agreement. The same run exposed a handover bug (a shadow already ahead of the lagging live world never handed over), now fixed: the shadow hands over at once and the live world catches up to it.
- **slowlink-paced** (finding 10): with a bucket that always holds one chunk and 16 KiB chunks when paced, a 4.3 MB paced join over a 2 Mbit/s uplink completed (21.3 s, §12.3). The first pacer could not send a 64 KiB chunk below about 640 KiB/s. The donor's latency at 2 Mbit/s was still too high (§4.3).
- **The watchdog** (finding 3) now replaces a silent socket at once instead of waiting for `onclose`; the drop and black-hole resumes of `base` ran with it.
- **The runner** (finding 15) now requires full canonical-state agreement as well as rolling-digest agreement, and reports whether every player got into the game.
- **The relay's tick timer** wakes 1 ms after each boundary (§12.2).

Design-only, not in the PoC:
- relay durability and room generations (finding 1);
- acceptance watermarks, deduplication and input fencing (finding 3);
- the snapshot manifest and its SHA-256 (finding 11);
- sealed upgrades (finding 6);
- clock generations (finding 7);
- queue limits (finding 8);
- identity-based targets (finding 12);
- the world-replacement protocol (finding 13);
- the convergence check (finding 14).

### 12.10 What the PoC does not establish

Stated plainly, so that nothing above is read as more (A2-r1 #15):
- **Prediction exactness.** The PoC measures whether the relay assigned the tick the client stamped. That is the prerequisite for exact prediction, not prediction itself: there is no latency state to compare against the confirmed world.
- **Real CPU contention.** Tick cost is emulated with a blocking wait that uses no CPU. The PoC therefore says nothing about a shadow simulation and a live one competing for cores, or about catch-up rates on a busy machine. Those need the real engine (§9 item 4).
- **Repairs on weak machines.** Every repair in §12.6 converged, but on a host with idle cores and emulated costs. The convergence check of §5.2 is unimplemented.
- **Slow players.** A player who cannot hold 60 UPS never finished joining (§12.4). The design's policy for them (§3.6) is untested.
- **The real engine's determinism.** Agreement here is agreement of a toy simulation; the engine's own is D18's job.
- **Durability, upgrades, clock transitions, queue limits and the world-replacement protocol** are specified but not exercised (§12.9).
- **Browsers.** Only Chrome was measured with hidden tabs (§12.5); Firefox only from its source, Safari not at all.

## Appendix A: Sources

Fetched 2026-10-20 unless stated.

1. Factorio Friday Facts #76, "MP inside out" (2015). https://factorio.com/blog/post/fff-76
2. Factorio Friday Facts #83, "Hide the latency" (2015). https://factorio.com/blog/post/fff-83
3. Factorio Friday Facts #147, "Multiplayer rewrite" (2016). https://factorio.com/blog/post/fff-147
4. Factorio Friday Facts #302, "The multiplayer megapacket" (2019): Game State and Latency State, skipped ticks, `StopMovementInTheNextTick`, latency renegotiated every 5 s. https://factorio.com/blog/post/fff-302
5. Factorio Friday Facts #149, "Deep down in multiplayer" (2016): background map download, stored input, catch-up. https://factorio.com/blog/post/fff-149
6. Factorio Friday Facts #55, "MP preview" (2014): heuristic CRC every tick, full CRC and save–load–check for debugging. https://factorio.com/blog/post/fff-55
7. Alt-F4 #26, "Putting the Multi in Player" (2021): since 0.14 the server no longer pauses for a slow client. https://alt-f4.blog/ALTF4-26/
8. Factorio `server-settings.json` keys, defaults and comments (`max_heartbeats_per_second` 60, range 6–240; `max_upload_in_kilobytes_per_second`; `max_upload_slots`; `minimum_latency_in_ticks`; `auto_pause`; `auto_pause_when_players_connect`; `only_admins_can_pause_the_game`; `autosave_only_on_server`; `non_blocking_saving`), as reproduced by a hosting provider: https://www.gameserverkings.com/knowledge-base/factorio/factorio-server-settings-json/
9. Factorio wiki, "Multiplayer": UDP only; dropping threshold doubled during map transfer (0.11.19); latency hiding always on for clients (0.14.0); players quit after 3 desyncs (0.14.0). https://wiki.factorio.com/Multiplayer
10. D. Trautwein et al., "Large-Scale Measurement of NAT Traversal for the Decentralized Web: A Case Study of DCUtR in IPFS", IMC '26: conditional hole-punching success 70% ± 7.1%, TCP ≈ QUIC, 4.4 million attempts from 85,000+ networks. https://arxiv.org/abs/2604.12484 (and the earlier "Challenging Tribal Knowledge", https://arxiv.org/abs/2510.27500)
11. ProbeLab, "Can libp2p punch through NATs?": 82.9% behind port-restricted cone NATs, about 40% behind symmetric NATs. https://probelab.io/blog/can-libp2p-punch-through-nats/
12. Croquet SDK documentation, "Model–View–Reflector" and "Snapshots" (reflector timestamps and heartbeats, participant snapshots for late joiners). https://croquet.io/sdk/docs/tutorial-2_1_model_view_reflector.html, https://croquet.io/sdk/docs/tutorial-2_7_snapshots.html (as indexed; the pages have since moved)
13. Photon Quantum 3 documentation, "Server–client role": the default server plugin manages input timing and delivery and is the clock source; "the local client runs the game". https://doc.photonengine.com/quantum/v3/concepts-and-patterns/server-client-role
14. Factorio wiki, "Desynchronization": heavy mode saves and loads every tick to detect state not surviving a save/load cycle; desync reports. https://wiki.factorio.com/Desynchronization
15. OpenTTD, "A new multiplayer experience" (2021-09-26): Direct IP, STUN over TCP, TURN relay; "roughly 20% of the STUN connections fail and need TURN". https://www.openttd.org/news/2021/09/26/new-multiplayer-experience
16. OpenTTD documentation: `docs/desync.md` (RNG-state checksum, commands log, causes: incomplete savegame, cache mismatch, undefined ordering, state changed outside commands), https://github.com/OpenTTD/OpenTTD/blob/master/docs/desync.md; `docs/multiplayer.md` (`frame_freq`, `sync_freq`).
17. Mozilla WebRTC blog, "Active ICE TCP punches firewalls directly" (2017): browsers gather active TCP candidates only; "this feature won't help improve direct connectivity between two WebRTC enabled browsers". https://blog.mozilla.org/webrtc/active-ice-tcp-punch-firewalls-directly/
18. LiveKit, "Firewall tips", https://kb.livekit.io/articles/1724892785-establishing-media-connection-firewall-troubleshooting ; WebRTC.ventures, "ICE issues on restrictive networks and how to alleviate them" (2021), https://webrtc.ventures/2021/12/ice-issues-on-restrictive-networks-and-how-to-alleviate-them/
19. LRZ, "Security-/NAT-Gateway (Secomat)": per-destination packet limits, penalty points, automatic blocking at 120 points in 15 minutes. https://collab.dvb.bayern/lrzpublic/security-nat-gateway-secomat-817202781.html
20. LRZ, "Beschränkungen und Monitoring im Münchner Wissenschaftsnetz": monitoring of connection counts and combinations, three-stage escalation. https://collab.dvb.bayern/lrzpublic/beschraenkungen-und-monitoring-im-muenchner-wissenschaftsnetz-10745842.html
21. LRZ-Newsletter Nr. 8/2011: Skype supernodes' outgoing UDP connections scored as port scans by NAT-o-MAT/Secomat. https://lrz.de/wir/newsletter/02-archiv/2011/2011-08
22. MDN, "WebTransport API": Baseline 2026; available in workers; HTTP/3. https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
23. WebRTC.ventures, "WebTransport is now Baseline: what it means for real-time media" (April 2026): Safari 26.4 ships WebTransport. https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/
24. IETF, draft-ietf-webtrans-http2-14, "WebTransport over HTTP/2" (March 2026). https://www.ietf.org/archive/id/draft-ietf-webtrans-http2-14.html
25. blink-dev, "Intent to Ship: WebTransport" (2021): HTTP/2 excluded from the initial ship. https://groups.google.com/a/chromium.org/g/blink-dev/c/kwC5wES3I4c/m/2WxYhllhAAAJ
26. ECMA-262, current draft: `Number::exponentiate` (6.1.6.1.3) and `Math.exp`, `Math.sin`, `Math.hypot` return implementation-approximated values; `Math.sqrt` returns 𝔽(the square root of ℝ(n)); `Math.fround` rounds ties to even; `NumericToRawBytes` (25.1.3.17) may store "any implementation chosen" NaN encoding. https://tc39.es/ecma262/
27. C. Michel, "I found a bug in V8's exponentiation operator": `1.35 ** 92` constant-folded differently from `Math.pow(1.35, 92)`. https://www.freecodecamp.org/news/i-found-a-bug-in-v8s-exponentiation-operator-dcddfa5b8482/
28. Cloudflare, "Durable Objects: Limits". https://developers.cloudflare.com/durable-objects/platform/limits/
29. Cloudflare, "Durable Objects: Pricing". https://developers.cloudflare.com/durable-objects/platform/pricing/
30. `ws` 8.22.0, `lib/websocket.js` line 261: `socket.setNoDelay()` (inspected in `poc/node_modules/ws`). https://github.com/websockets/ws
31. RFC 6455, "The WebSocket Protocol", §5.2 (frame header; client-to-server masking). https://www.rfc-editor.org/rfc/rfc6455
32. RFC 8446, "TLS 1.3", §5.2 (record header, content type byte, AEAD expansion). https://www.rfc-editor.org/rfc/rfc8446
33. Chrome for Developers, "Freezing on Energy Saver" (2025-01-20): CPU-intensive background tabs hidden for 5 minutes are frozen; exemptions (audio/video conferencing including an open `RTCDataChannel`, device APIs, Web Locks or IndexedDB blocking outside the group); WebSockets are not an exemption. https://developer.chrome.com/blog/freezing-on-energy-saver
34. RFC 6817, "Low Extra Delay Background Transport (LEDBAT)". https://www.rfc-editor.org/rfc/rfc6817
35. Firefox source, `dom/base/TimeoutManager.cpp`: worker timeouts share the window's throttling logic, gated by `dom.workers.throttling.enabled`. https://github.com/mozilla-firefox/firefox/blob/main/dom/base/TimeoutManager.cpp
36. Firefox source, `modules/libpref/init/StaticPrefList.yaml`: `dom.workers.throttling.enabled: @IS_NIGHTLY_BUILD@`; `dom.min_background_timeout_value: 1000`; `dom.timeout.background_throttling_max_budget: 50`; `dom.timeout.background_budget_regeneration_rate: 100`. https://github.com/mozilla-firefox/firefox/blob/main/modules/libpref/init/StaticPrefList.yaml
37. Cloudflare Workers, "Performance and timers": `Date.now()` and `performance.now()` advance only after I/O when deployed. https://developers.cloudflare.com/workers/runtime-apis/performance/
38. blink-dev, "Intent to Implement and Ship: Intensive throttling of JavaScript timer wake ups" (2020): in a window hidden for 5 minutes, timer wake-ups are aligned to one-minute intervals. https://groups.google.com/a/chromium.org/g/blink-dev/c/8En_5DqV_fU/m/P23eNeUWAgAJ
39. Factorio wiki, "Console": multiplayer commands (`/players`, `/w`, `/r`, `/kick`, `/ban`, `/promote`, `/demote`, `/color`); script commands disable achievements. https://wiki.factorio.com/Console
40. NetplayJS: browser rollback and lockstep wrappers over WebRTC (peer-to-peer, so not usable here). https://www.npmjs.com/package/netplayjs
41. WHATWG, WebSockets Standard, `close()`: "The close() method does not discard previously sent messages before starting the WebSocket closing handshake", which starts only after they are sent. https://websockets.spec.whatwg.org/#dom-websocket-close
42. WebKit, "WebKit Features for Safari 26.4" (March 2026): WebTransport "runs over HTTP/3 and QUIC", and when "the underlying network environment doesn't support QUIC", it "can run over HTTP/2 and TCP as a fallback with the same API". https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
43. M. Inden (Mozilla), "Intro to WebTransport: the next WebSocket?", FOSDEM 2026 slides: HTTP/3, with HTTP/2 described as upcoming. https://archive.fosdem.org/2026/events/attachments/9DEU7E-intro_to_webtransport_-_the_next_websocket/slides/266785/fosdem_20_79q8n8e.pdf
44. WebKit, "How Web Content Can Affect Power Usage" (2019): inactive pages have their timers throttled; "on iOS, tabs are completely suspended when possible"; on macOS, App Nap gives a tab that is not visually updating lower priority and throttled timers. https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/

**[I-data]** The design phase's local Factorio dumps in `design/round1/I-data/` (raw material, gitignored): the 2.x changelog (2.0.7 latency hiding for cars; 2.0.33 "Multiplayer selection rectangles will only show the player name if the player's character is not visible on-screen"; 2.1.18 chat colouring) and `controls.wiki` (map ping; "for pasting to work, the source entity must still exist").

**Local measurements**: everything marked PoC is in `poc/results/` and reproducible with the commands of §12.1. Playwright's launch defaults that defeat background throttling were read from `~/.local/lib/node_modules/playwright/node_modules/playwright-core/lib/coreBundle.js` (Chromium switches `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` and `Emulation.setFocusEmulationEnabled`; Firefox prefs `dom.min_background_timeout_value: 0`, `dom.timeout.enable_budget_timer_throttling: false`, `focusmanager.testmode: true`, `layout.testing.top-level-always-active: true`).
