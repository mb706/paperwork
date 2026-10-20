# Multiplayer architecture

*WP A2, 2026-10-20. A proposal for the Phase B architecture revision: it is not yet part of the spec. Binding inputs: `CLAUDE.md`, `pm/README.md`, `design/spec/10-architecture.md` (cited as **10 §x**), `07-ui.md` (**07 §x**), `round1/I-ui-controls.md` (**I §x**) and `DECISIONS.md`. Evidence: a proof of concept in `poc/` with its measurements in `poc/results/` (§12), and the web sources in Appendix A, cited as [n].*

**The user's constraints, restated.** Friends and colleagues build one factory together, two to eight players. Clients are trusted. The server that hosts the website may relay, sequence and store, but it does not run the simulation. Syncing must work well. Peer-to-peer UDP is out, because the firewall at the user's site blocks a whole machine for that kind of traffic. Any fallback must be invisible to players.

**One-paragraph answer.** Every client runs the whole deterministic simulation (Factorio's lockstep). A small relay owns the tick clock: clients stamp their actions with the tick they expect to execute in, and the relay accepts them, moves late ones to the next open tick, and broadcasts each closed tick's action list to everybody. The relay never simulates. One WebSocket over TLS on port 443, same origin as the website, carries the tick stream, and a second carries bulk snapshot transfers. No NAT hole punching is attempted: from a browser it exists only as WebRTC over UDP, which is exactly what the user's firewall punishes, and a relay-sequenced game gains nothing from it. Joiners load a snapshot that a playing client serializes at a sequenced tick and the relay forwards; they then fast-forward the actions buffered since. Desyncs are found by a cheap per-tick digest that clients report twice a second, and are repaired by a background re-sync that the player does not see. The engine prepares all of this from M0: single player is multiplayer with a local sequencer.

---

## 0. Decisions at a glance

| # | Area | Decision | Main reason | Rejected |
|---|---|---|---|---|
| 1 | Model | **Deterministic lockstep**: every client simulates everything; only input actions travel (§1) | Bandwidth is independent of factory size; the only model in which the server does no simulation at 150k entities | Authoritative server simulation; host-authoritative state streaming; rollback; state synchronisation |
| 2 | Sequencer | **The relay** owns the tick clock and the order of actions. It never simulates (§1.3) | No host to lose or migrate; the game outlives every player; one clock | A hosting client that sequences while the relay is a dumb pipe |
| 3 | Tick stamping | **Clients stamp target ticks** (their estimate of the relay's open tick plus an adaptive margin). The relay accepts on-time actions as stamped, moves late ones to the open tick and says by how much (§3.4) | Exact local prediction: 0–5% of walk inputs mispredicted in the PoC (only the late ones), against 15–54% when the relay stamps on arrival. Factorio's own scheme (FFF-302 [4]) | Stamping on arrival at the relay |
| 4 | Transport | **WebSocket over TLS on 443, same origin as the site**: a control socket for the tick stream and a bulk socket for snapshots (§2.4) | Works in every browser and through every firewall that allows HTTPS; one TCP flow to one host is the least suspicious traffic there is | WebRTC data channels (P2P UDP); ICE-TCP (cannot connect two browsers); TURN over TLS (a relay with extra layers); WebTransport by default (UDP 443) |
| 5 | NAT | **No hole punching, ever.** Everything goes through the relay (§2.3) | Browsers can only punch through WebRTC/UDP, which the user's site penalises; with a relay sequencer, P2P would not shorten the critical path | STUN/ICE, TCP simultaneous open |
| 6 | Joining | **A snapshot from a playing donor**, serialized after a sequenced marker tick, streamed through the relay (which caches it), then a fast-forward through the buffered ticks. Transfers are paced so the donor's own game does not lag (§4) | Factorio's flow without a simulating server; the relay keeps the latest snapshot for later joins | A relay-side save (it would need the simulation) |
| 7 | Desyncs | **Per-tick digest + rotating slice hash**, reported every 30 ticks; majority vote with an anchor tie-break; **background re-sync** (a shadow sim catches up and is swapped in), by page delta where possible (§5) | Detection within about a second for most divergence and within a minute for any; repair the player does not see | Disconnect-and-rejoin as the repair (Factorio's); full hashes every tick (100 ms each in the late game) |
| 8 | Server | **One Node 24 process** with `ws` 8.22.0, behind the site's TLS proxy; rooms, invites, snapshot and log storage, metrics. About 1% of a 2013 Xeon core per four-player room (§6) | Tiny, testable on this host, deployable next to a static site | A game server; a managed realtime SaaS. Cloudflare Durable Objects are a viable alternative (§6.7) |
| 9 | Engine | **Closures are the only input of the simulation; single player runs through a `LocalSequencer`.** `World.players[]` exists from M0. Determinism rules D1–D20 are enforced from M0 (§5.4, §7) | The multiplayer path is exercised by every test from day one | Adding players and a network layer later |
| 10 | Hidden tabs | **In multiplayer the game never pauses.** The simulation worker is driven by arriving ticks, not timers, and catches up or re-syncs after the browser freezes it (§3.6) | Measured in Chrome 156: hidden-tab main-thread timers drop to 1 Hz then to once a minute, worker timers stay at 50–60 Hz, frozen tabs stop entirely (§12.5) | Pausing a player's simulation while their tab is hidden |

---

## 1. The model

### 1.1 What the game demands

- **State.** A late game has about 150k entities, 250k belt items and 5k agents (10 §11). The saved state is 50–100 MB raw and 10–25 MB compressed (10 §8.1); much of it changes every tick.
- **Compute.** About 4 ms per tick on the reference laptop at Late scale, 12 ms allowed (10 §4.7, §11).
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

### 1.4 Simulation language and multiplayer risk (WP A1)

The design holds for a TypeScript and for a Rust/WASM simulation alike: the protocol, relay, snapshots, digests and UI do not change. What changes is the class of desync that remains possible.

| Desync source | TypeScript | Rust → WASM |
|---|---|---|
| Transcendental functions differ between engines (10 §4.1 measured 492 of 16,000 results differing between Firefox and Chrome) | Banned in the sim; `detmath.ts` instead. Needs lint discipline | Gone by construction: libm is compiled into the module, so every browser runs the same instructions |
| `**` and `Math.pow`, even with integer exponents | ECMA-262 makes `Number::exponentiate` *implementation-approximated* for every exponent [26], and V8 constant-folds `**` differently from `Math.pow` [27]. Must be banned outright (D5) | Not applicable |
| NaN bit patterns | Engines may store any NaN encoding in a typed array [26] (D6) | WASM NaN payloads are nondeterministic too; canonicalise before hashing |
| FMA contraction, x87 precision | None: JS never fuses, and every supported browser is 64-bit SSE2/NEON | None, *unless* relaxed SIMD is used (`relaxed_madd` may or may not fuse): ban it |
| Iteration order, unsaved state, stale caches, order of float sums | **Possible** | **Equally possible** |

The last row is the class that dominates in practice: OpenTTD's desync guide lists incomplete savegames, cache mismatches, undefined ordering (sorting equal keys) and state changed outside commands [16], and Factorio built "heavy mode" (save, load and compare every tick) to find exactly these [6][14]. **Rust/WASM removes the floating-point and engine class by construction; the logic class needs the same rules (D3, D4, D8, D9) and the same tests in either language.** With TypeScript, the engine class is closed by `check-arch` bans plus cross-engine fuzzing (§9). Either choice is safe if those rules hold; TypeScript carries somewhat more risk because it depends on discipline.

---

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
| **WebTransport** | Client–server HTTP/3 over QUIC (UDP 443): reliable streams without cross-stream head-of-line blocking, plus unreliable datagrams | Chrome, Edge and Firefox; Safari since 26.4 (March 2026). "Baseline 2026" on MDN; available in workers [22][23] | Client–server, not P2P, but UDP. The HTTP/2 (TCP) fallback is still an IETF draft (rev. 14, March 2026) [24] and Chrome's ship excluded it [25], so where UDP 443 is blocked there is no fallback inside WebTransport. **Not in version 1**; possible later as an opt-in (§2.5) |
| HTTP streaming (`fetch` with a streamed response, plus POSTs) | Long-lived HTTPS | Streamed responses everywhere; streamed uploads only in Chromium | A last-resort fallback if a proxy strips WebSocket upgrades. **Later, only if seen in the wild** |
| Direct Sockets API | Raw TCP/UDP | Chromium Isolated Web Apps only | Not applicable to a website |

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
- **Network code lives in a dedicated net worker** in the client, not in the simulation worker. In the PoC's single-thread client, a simulation cost of 4 ms per tick widened the control round trip's tail (confirmation p95 186 ms, against 77 ms on the same link without it; §12.3). A client that could not keep 60 UPS processed its messages seconds late (§12.4), and a shadow simulation sharing the thread starved it (§12.6). The net worker forwards tick batches to the simulation worker over a `MessagePort`.

### 2.5 Fallbacks, and keeping them invisible

| Failure | What happens | What the player sees |
|---|---|---|
| A connection drops (Wi-Fi roaming, NAT rebinding, server restart) | Automatic reconnect with exponential backoff (100 ms, doubling to 2 s); `HELLO` with `resumeFrom` replays the missed ticks from the relay's log (§2.6) | Nothing, or a brief "waiting for server" icon (§8.3) |
| The link goes silent without closing (laptop lid, dead NAT entry) | The client's watchdog closes after 3 s without a message (doubled during transfers, as Factorio doubles its drop threshold during map transfer [9]); then the same reconnect. The relay releases the player's held inputs after 1 s of silence (§2.6) | The icon, then nothing |
| The tab was frozen or slept for minutes | On waking, the client reconnects and resumes if the relay's log still covers the gap; otherwise it re-syncs from a snapshot (§3.6) | "Catching up" with a progress bar (§8.3) |
| A proxy strips WebSocket upgrades | Version 1: a clear error naming the cause. Later, if ever needed: an HTTPS streaming fallback behind the same API | An error, rather than a silent failure |
| UDP is fine and a player wants lower latency on a lossy link | Later, optional: a WebTransport transport behind the same interface, **off by default and never probed automatically**, because an automatic QUIC probe could trip a firewall like the user's | Nothing unless enabled |

**The rule behind the table: there is one transport, so there is nothing to fall back between.** Invisibility comes from resuming, not from switching protocols.

### 2.6 TLS, reconnects and held inputs

- **TLS** terminates at the reverse proxy on 443 with the site's certificate (Let's Encrypt via Caddy). The relay listens on `127.0.0.1` behind it. HTTP/1.1 Upgrade is enough.
- **Keepalive.** A JavaScript WebSocket cannot send protocol pings, so liveness is application-level:
  - the relay's 60 Hz tick stream is the heartbeat in one direction;
  - the client's `STATUS` (every 100–250 ms) is the heartbeat in the other.
- **Resume.** The relay keeps every closed tick's actions since the latest stored snapshot, at least 5 minutes of them (empty ticks cost nothing). A reconnecting client sends `HELLO{resumeFrom: horizon + 1}`; if the log covers it, the relay sends the missed range in one `TICKS` message and the client continues. PoC: a drop at 30 s and a 3-s black-hole at 38 s both resumed without a snapshot, and all clients' digests agreed afterwards (§12.2).
- **Held inputs.** Walking, mining and shooting are start/stop pairs. A client that vanishes while walking would walk forever in everybody's world. The relay therefore injects `release_inputs(i)`:
  - at once when the socket closes;
  - after 1 s of silence on an open socket.

  This is Factorio's `StopMovementInTheNextTick` (FFF-302 [4]). When the client is heard again and finds its own release in the tick stream while a key is still held, it re-sends the held input.
- **Leaving.** A graceful exit sends `bye` and the relay sequences `player_left(i)` at once. An abrupt one gets `player_left(i)` after a 15-s grace period, so a reconnect within the grace period is a non-event in the simulation.
- **Laptop sleep and network changes.** Both end in a reconnect. After a long sleep, the gap may exceed the log, so the player re-syncs (§4.5).

### 2.7 Bandwidth per player

On the wire every message costs its payload plus 2 bytes of WebSocket header from the server (6 from the client, which must mask), 22 bytes of TLS 1.3 record overhead and 52 bytes of TCP/IPv4 headers with timestamps (72 with IPv6) [31][32].

| Flow | Rate | Payload | On the wire (IPv4) |
|---|---|---|---|
| Tick stream, relay → client (empty ticks) | 60 msg/s | 11 B | 87 B × 60 = **5.2 kB/s** (42 kbit/s); 30 Hz: 2.6 kB/s |
| Actions of all players, relay → client | about 4 actions/s per busy player | 9 B header + 3–40 B | about 0.15 kB/s per player, 1.2 kB/s with 8 busy players |
| Own actions, client → relay (with acknowledgement back) | about 4/s | 8 B + payload | about 0.4 kB/s up |
| `STATUS` | 4–10/s | 14 B | 0.4–0.9 kB/s up |
| Digests and pings | 2 + 2 per s | 9 B each | 0.35 kB/s up |
| TCP ACKs for the downstream | 30–60/s | 0 | 1.6–3.1 kB/s up |
| **Total during play** | | | **about 6–7 kB/s down, 3–5 kB/s up** (≈ 55 kbit/s and 35 kbit/s); one 2-hour session ≈ 50 MB down |
| Joining (once) | | snapshot | slice end ≤ 5 MB; Late 10–25 MB (10 §8.1) |

Measured at the payload level in the PoC: 43–47 kB per client per minute down and 11 kB up at 60 Hz (§12.8). The wire overhead dominates, which is why batching to 30 Hz is the one lever worth having. Actions are negligible except for large blueprints, which use the blob path (§3.3).

---

## 3. The tick protocol

### 3.1 Clocks, ticks and closures

- **The relay's clock defines game time.** Tick *k* closes at `t0 + k·T`, with T = 16.667 ms divided by the game speed. The *open tick* is the lowest tick not yet closed. When the relay closes ticks it sends one `TICKS` message: "ticks *first*..*last* are closed, and these are all their actions, in execution order".
- **A client simulates tick *k* only after it holds the closure of tick *k*.** Its *horizon* is the highest closed tick it has received. Clients may lag the relay by different amounts; lockstep needs the same inputs in the same order, not the same wall-clock moment.
- **Closures are the only input to the simulation.** That includes the system actions the relay injects with player index 255: `player_joined`, `player_left`, `release_inputs` and `snapshot_marker` (§3.2).
- **Pause** means the relay stops closing ticks. **Speed** changes T. Neither touches the world state.

### 3.2 Messages

| Message | Direction | Content | When |
|---|---|---|---|
| `HELLO` | C→R (JSON) | protocol version, build hash, `prototypes.hash`, room, invite secret or player token, name, colour, `resumeFrom?` | connect |
| `WELCOME` | R→C (JSON) | player index; mode `new` / `resume` / `snapshot` (with `snapId`, `snapTick`); roster; room settings | reply |
| `TICKS` | R→C | `u32 first, u32 last, u16 n`, then n × (`u32 tick, u8 player, u16 seq, u16 len, bytes`) | every relay wake (60 or 30 Hz), and a backlog range on resume |
| `ACT` | C→R | `u8 n`, then n × (`u16 seq, u32 targetTick, u16 len, bytes`) | as soon as the input layer produces actions |
| `ACTACK` | R→sender | `u16 seq, i16 slack, u32 assignedTick` (slack < 0: it was late) | per action |
| `STATUS` | C→R | sim tick, horizon, ms per tick, flags (live, hidden, catching up, loading), bulk rate the client accepts | 4–10 Hz |
| `DIGEST` | C→R | `u32 tick, u32 epoch, u64 rolling digest` | every 30 ticks (§5.1) |
| `PING` / `PONG` | both | client time; relay fractional tick | 2 Hz; 10 Hz during transfers |
| `RESYNC` | R→C (JSON) | `snapId`, `snapTick`, reason, new epoch | on a desync verdict |
| `CHAT`, `PRESENCE`, `NOTICE` | both (out of band) | chat text; ping markers; cursor and selection (≤ 10 Hz, on change); "X is joining (45%)" | as needed; never in the simulation |
| `ADMIN` | C→R (JSON) | kick, promote, pause, resume, room settings | admins |
| `SNAP` chunk | bulk, both | `u32 snapId, u32 index, u32 count, u32 total`, 64 KiB of data | joins and re-syncs (§4) |
| `BLOB` put/get | bulk, both | content hash, bytes | large action payloads (§3.3) |

The PoC implements `HELLO`, `WELCOME`, `TICKS`, `ACT`, `ACTACK`, `STATUS`, `DIGEST`, `PING`/`PONG`, `RESYNC` and `SNAP` exactly in this shape (`poc/protocol.mjs`). The relay never parses action payloads: it is game-agnostic.

### 3.3 Actions

- **Types.** `InputAction` mirrors Factorio's `defines.input_action` as I §8.2 lists it, plus 10 Appendix B's additions. The engine adds the system actions of §3.1.
- **Codec.** One descriptor table per action type drives a binary encoder and decoder in `shared/actions/` (the pattern 10 §2.5 already uses for pools). Rules:
  - every number has a fixed width;
  - positions are quantised before encoding (building positions as the integer ×2 centres of 10 §4.2, free positions in 1/256 tile), so no float that the client computed leaves it unrounded;
  - strings (labels, chat) are UTF-8 with a length.

  A protocol version prefixes the stream; an unknown action type is an error, never skipped.
- **Header.** Player index and sequence number come from the transport: the relay stamps the sender's index, so a client cannot speak for another.
- **Entity references survive latency.** An action names its target by handle (`(generation << 22) | slot`, identical on every client because allocation is deterministic) *and* by `(surface, position, prototype)`. The simulation resolves the handle first. If the handle is stale or zero, as for an entity the player built 50 ms ago that is still a local prediction, it resolves by position and prototype. It then validates as for any action, so if another player replaced the entity meanwhile, the action fails with the usual flying text.
- **Size.** Inline payloads are capped at 64 KiB. A larger blueprint record goes up the bulk socket as a content-addressed blob first; the action carries the hash. The relay pushes the blob to all clients before the action's tick closes, and a client that reaches the tick without it waits for it (a rare, short stall). Most blueprints compress well below the cap.
- **Validation** runs in the simulation as 10 §3.2 describes. Feedback events carry the player index and the action's sequence number, so the client can tell its own prediction which action failed (§3.5).
- **Chat is not an action.** Console *commands* that change the world are (`/cheat`, and dev `/c` as in Factorio). Chat travels out of band, keeps working while the game is paused, and does not bloat input logs.

### 3.4 Stamping and arbitration

**Client side.**
1. **Clock estimate.** `PING`/`PONG` pairs give the relay's fractional tick at the moment of the reply. The client keeps the sample with the smallest RTT over the last 10 s and extrapolates: `relayTick(now) = sample.tick + (rtt/2 + now − received) / T`.
2. **Stamp.** `target = floor(relayTick(now)) + 1 + margin`.
3. **Margin control.** For each acknowledged action, `need = margin_at_send − slack` is the margin that would have made it exactly on time: its one-way delay plus clock error, in ticks.
   - Every second: `margin = clamp(ceil(p98(need over the last 30 s)), 1, 60)`.
   - Until five samples exist, a late action raises the margin to its `need` at once (first calibration).
   - A rare loss stall therefore makes one or two actions late (the relay moves them, and their prediction is off by the delay) instead of inflating every later input's delay. The PoC's first controller did the opposite: "add the lateness on every late action, decay by one tick per 5 s" left a client on a lossy link with 18–20 ticks of input delay for a minute after a single stall (§12.2). Factorio renegotiates each player's latency every 5 s [4].
   - The PoC uses the 95th percentile (1–8% of actions late); the 98th percentile trades about one tick more delay on jittery links for fewer mispredictions.

**Relay side.** On `ACT`: `assigned = clamp(target, open, open + 600)`; `slack = target − open`; queue the action into `assigned`; send `ACTACK`. Within a tick, actions execute in the order the relay queued them, which the closure states explicitly.

**Why clients stamp.** If the relay stamps on arrival, the tick an action lands in depends on network jitter, so the gap between `start_walking` and `stop_walking` on the receiving side differs from what the player pressed. Every walk then ends a tick or two away from where the local prediction put the character: 0.15 tiles per tick of error, a visible rubber-band at every stop. Measured in the PoC with identical networks:

| Link (PoC profile) | Relay stamps on arrival: walk inputs mispredicted (final run; range over three runs) | Clients stamp: mispredicted (= late) | Extra confirmation latency of client stamping (p50) |
|---|---|---|---|
| LAN (RTT 4 ms) | 15.5% (2–24%) | 0% | +13 ms |
| Home (RTT 30 ms, jitter 6 ms, 0.3% loss stalls) | 20.0% (18–35%) | 1.7% | +15 ms |
| Far (RTT 106 ms, jitter 20 ms, 1% loss stalls) | 53.7% (39–54%) | 5.0% | +7 ms |

Factorio does the same. When a player's input for a tick has not arrived, the server does not wait: it tells that client its actions will go into a later tick, and it renegotiates each player's latency every 5 seconds (FFF-302 [4]).

**Resulting input delay** (keypress to the tick of execution) is the margin: 1–2 ticks on LAN and home links in the PoC, 4–5 on the far and mobile links, 19 on a stress link with 3% loss stalls of 400 ms. **Confirmation** (keypress to the closed tick arriving back) took p50 33 ms on LAN, 61–64 ms at home, 80 ms on Wi-Fi, and 137–152 ms on far and mobile links. **Execution in the player's own simulation** adds the playout buffer: p50 80 ms on LAN, 150–207 ms at home, 267 ms on Wi-Fi, 379–444 ms far and mobile (§12.2). Latency hiding covers the gap.

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

The PoC measures the prerequisite, prediction exactness (§3.4). The latency state itself is engine work for the multiplayer milestone. M0 only needs action sequence numbers in feedback events, and a movement function that can run on a scratch character (§7).

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
| LAN | 35 ms | 0 (apart from the induced 3-s black-hole) |
| Home (0.3% loss stalls of 150 ms) | 118–147 ms | 3 (0.2 s) |
| Wi-Fi (jitter 20 ms, 0.5% stalls of 200 ms) | 211 ms | 6 (0.3 s) |
| Mobile and far (1% stalls of 250–300 ms) | 260–320 ms | 3–8 (0.2–0.8 s) |
| Stress link (jitter 60 ms, 3% stalls of 400 ms) | 452 ms | 2 (0.1 s) |

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
- "pause while a player is joining" is an option (`auto_pause_when_players_connect`, default off);
- by default only admins can pause (`only_admins_can_pause_the_game`, default on) [8];
- game speed is a dev and cheat command.

**Hidden tabs and frozen pages.** Browsers throttle hidden tabs; single player pauses there (07 §19.3), but multiplayer must keep simulating. Measured in Chrome 156, with its normal background policies (§12.5):
- in a hidden tab, a 16-ms timer chain on the **main thread** fell to 1 wake per second within a minute and then to zero per 10-s window (minute-aligned intensive throttling [38]);
- the same chain in a **dedicated worker** kept 50–60 wakes per second for the whole 6.5 minutes;
- all three test clients (paced by timers, by arriving ticks, or both) stayed within 8 ticks of the relay throughout;
- a page frozen through CDP, as Chrome's Energy Saver freezes CPU-heavy background tabs [33], stopped completely, worker included, but **kept its WebSocket open for 90 s**, and caught up 5,422 ticks in 89 ms after unfreezing (toy simulation).

Firefox release builds do not throttle worker timers, but Nightly does: `dom.workers.throttling.enabled` defaults to `@IS_NIGHTLY_BUILD@` in the current source [35][36]. Safari is known to be aggressive in background tabs, and how is undocumented.

**Rules.**
- The simulation worker is **driven by arriving ticks** (network and port messages are not timers) and uses timers only to smooth playout.
- View extraction stops while the page is hidden (10 §3.3 already does this).
- On becoming visible again, the client chooses the faster of catch-up (backlog ÷ (R − 60)) and re-sync (§5.2), using its measured ms per tick.
- `STATUS` reports the hidden flag, so others see "(away)" rather than "lagging" in the Players window.

### 3.7 What the simulation holds per player

| Per player, in the simulation (saved, hashed) | Per force, in the simulation (one force) | Per client, never in the simulation |
|---|---|---|
| Player index and online flag; the character entity | Research queue, progress, levels, the scheduling toggle | Camera, zoom, map view, alt-mode, overlays |
| Main inventory, hand (cursor stack), origin-slot marker, trash (later) | Bonuses (reach, mining, crafting speed, …) | Open windows, hovered and selected entity |
| Quickbar pages | Production, electric and pollution statistics (shared, 07 §11) | Keybindings, Interface, Graphics and Sound settings |
| Crafting queue with reservations (I §3.9) | Charted chunks, map tags (ISO: tags per force) | The latency state (§3.5) |
| Mining state, walking state, drag-build state (`drag_id`) | Alerts' sources (each client filters and displays them) | Chat history; cursor and selection presence of others |
| Undo/redo stacks (10 §5.2: sim-side, per player) | World text, heat, the leak, runaways: global as before | Run history and achievements records (07 §19.2: per browser) |
| Entity-settings clipboard (copy source; Factorio pastes from the source entity, which must still exist [I-data]) | | |
| Blueprint and planner records in the hand | | |
| Pins (I §4.11: per player, saved) | | |
| Rule-affecting personal settings: auto-sort inventory, "Pick ghost item if no items are available" (and the others the audit in §7 finds) | | |
| Per-player accumulators: hand-crafted count, last-action tick (08 §8.5 "Last action by you"), achievement progress for per-player conditions | | |

- **Names and colours** are not simulation state. They live in the room roster at the relay and in the save header, so that re-hosting a save restores them.
- **Selection** stays out of the simulation as well. Factorio sends selection changes as input actions; FFF-302's megapacket bug came from catching up 400 of them at once [4]. We keep selection as client UI state, and other players' selections travel as presence (§8.3).
- **Permissions are trusted.** Every player may do everything in the world, and nothing is checked per player in the simulation. Admin-only operations (kick, pause, room settings) are relay operations.
- **Offline characters** stay in the world and keep their inventories; they neither walk, mine nor craft. When a player leaves, the hand returns to the inventory if it fits. This is a rule the simulation must state (proposed for 10 §5.1).

---

## 4. Joining

### 4.1 The sequence

This is Factorio's flow since 0.14, except that a donor client, not the server, writes the save. There, the joiner downloads the map in the background while the others keep playing, stores all input meanwhile, and then applies it as fast as it can to catch up (FFF-149 [5]).

1. **Hello.** The joiner opens the control socket and sends `HELLO` (build hash, `prototypes.hash`, protocol version, room, invite secret or player token, name, colour). The relay refuses a different build with a reason the client turns into "update and retry" (§6.3). It assigns a player index: a new one, or the same one as before if the player token is known.
2. **Snapshot source.** The relay uses its cached snapshot if that is fresh enough (§4.2). Otherwise it picks a donor and sequences `snapshot_marker(id, donor)` into the open tick *T*. It answers `WELCOME{mode: snapshot, snapId, snapTick: T}` and from now on streams every closed tick to the joiner, who buffers the ticks after *T*.
3. **Serialize.** The donor applies tick *T* and then copies its pools at that tick boundary: a stall of at most 100 ms (10 §8.4), after which it catches up a few ticks. Its IO worker compresses the copy (fflate, as for saves) while its game goes on. The snapshot is an ordinary save container (10 §8.1), whose header adds the state hash at *T*, the room roster and the room settings.
4. **Transfer.** The donor uploads 64 KiB chunks on its bulk socket, paced (§4.3). The relay stores each chunk and forwards it at once to every joiner waiting for that snapshot, so upload and download overlap. The joiner's screen shows the megabytes received of the total (§8.2).
5. **Load and verify.** The joiner decompresses and loads (≤ 3 s for a late save, 10 §11), checks the state hash against the header, sets its digest epoch, and starts catching up through the buffered ticks with view extraction off ("Catching up", with a percentage).
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
- **Chunking.** 64 KiB chunks with `(snapId, index, count, total)`. The relay keeps the chunks.
- **Resume.** After a reconnect the joiner reports the chunks it holds, and the relay sends the rest. A donor that disconnects mid-upload is replaced: the relay starts a new snapshot from another donor and tells the joiner to discard the partial one.
- **Integrity.** The state hash in the header covers the loaded world. A corrupt chunk produces a mismatch, and the joiner refetches.
- **Pacing** is the one non-obvious requirement.
  - A home router's uplink is a FIFO queue. An unpaced upload fills it, and every other packet the donor sends waits behind it: its actions, `STATUS` and digests, and the TCP ACKs of its tick stream.
  - In the PoC, with a 10 Mbit/s uplink and a 300 ms router queue, the donor's control RTT rose from 50 ms to 270 ms (p50; p95 359 ms) for the whole 17-s upload of a 21 MB snapshot. Its input delay grew to 16 ticks (§12.3). This is what Factorio's `max_upload_in_kilobytes_per_second` server setting exists for [8].
  - Uploads are therefore paced by a **LEDBAT-style delay-based controller** (RFC 6817 [34]). It keeps the queueing delay that the transfer adds on the donor's own link under 25 ms, measured as control-channel RTT over its minimum, with 10 Hz pings during transfers.
  - Downloads to a client that is *playing* (a background re-sync, §5.2) are paced by the relay at the rate that client reports in `STATUS`.
  - A joiner that is not yet playing downloads at full speed.
  - The PoC's crude controller held the donor's RTT at p50 60 ms (p95 141 ms) and its input delay at 4 ticks, but stretched the transfer from 17 s to 25–38 s (§12.3). A tuned LEDBAT does better, and a room setting may trade the donor's comfort for faster joins.

**Expected join times** (transfer is bounded by the donor's uplink; catch-up by the joiner's speed, see §4.4):

| Save | Uplink 2 Mbit/s | 10 Mbit/s | 40 Mbit/s |
|---|---|---|---|
| Slice end, 5 MB | 20 s | 4 s | 1 s |
| Late game, 20 MB | 80 s | 17 s (PoC, 21 MB: 17.4 s) | 4 s |

### 4.4 Catching up

While the joiner downloads (D seconds) and loads (L seconds), the game advances 60·(D + L) ticks. Catching up at an unthrottled rate of R = 1000 / (ms per tick) takes **C = 60·(D + L) / (R − 60)** seconds.

| Scale (reference machine, 10 §4.7, §11) | ms per tick | R (ticks/s) | C for D + L = 20 s |
|---|---|---|---|
| Slice | 0.3 | 3,300 | 0.4 s |
| Mid | ≤ 2 | 500 | 2.7 s |
| Late | 4 | 250 | 6.3 s |
| Late, on a machine half as fast | 8 | 125 | 18.5 s |
| Late, a machine that barely holds 60 UPS | 15 | 67 | 171 s: offer "pause while joining" |

The PoC measured the Late row: a 21 MB snapshot at 10 Mbit/s took 17.4 s, and the joiner then caught up 1,811 ticks in 12.9 s at an effective 140 ticks per second (4 ms of emulated tick cost plus the single-thread client's overheads). The formula predicts 13.1 s (§12.3). For machines near the limit, the room option "pause while a player joins" (Factorio's `auto_pause_when_players_connect` [8]) stops the clock until the joiner is live.

### 4.5 Returning players, long absences and resumed rooms

- **Returning player.** The same player token gets the same player index and the same character, with its inventory. The character stayed in the world while the player was away (§3.7).
- **Short absence.** If the relay's log still covers the gap (it keeps everything back to the newest stored snapshot), the player resumes by replaying ticks (§2.6): no snapshot.
- **Long absence, or a frozen tab.** The client compares the catch-up estimate with a re-sync and takes the faster.
- **A room with nobody in it** is a stored snapshot plus the log since then. The first player to return loads both and catches up. If they are the only player, the game is paused until they are live.

### 4.6 A game that outlives everybody

- **On the relay**, a room persists as its newest snapshot, the closed-tick log since then, the roster and the chat tail, until it expires (§6.4).
- **On every client**, autosaves go to the browser's store as in single player (10 §8.4). The stall is invisible here: the client falls a few ticks behind and catches up. Because every client has the whole state, anyone can **host the saved game again** as a new room if the relay or the room is gone (§8.1). Factorio's `autosave_only_on_server` defaults to true [8]; we default to client autosaves on, because our relay cannot save by itself.

---

## 5. Desyncs

### 5.1 Detection

Factorio checks a "Heuristic CRC" every tick, "an incomplete but very fast check taken every tick" that "captures only couple of crucial information about the game state like for example state of all the players, number of active entities or snapshot of production statistics", compared for all players "with a communication latency". A full CRC every tick and a save–load–check every tick serve for debugging only (FFF-55 [6]). We do the same, plus a rotating slice of the full state, so that all state is checked within a minute.

1. **Per-tick digest** `d_t`, computed after every tick: the tick number, a checksum of the closure applied, every RNG stream state, the entity count, this tick's production and consumption counters (the nonzero entries of 10 §5.20's per-tick arrays), each online character's position bits and inventory version, the research progress bits, and the global scalars of 10 §4.4. Cost: about a microsecond.
2. **Slice hash.** Every tick also hashes the next 1/3,600 of the hashable state bytes: the saved fields of every pool in descriptor order, the slot heap, chunk records and cold data in canonical order, with NaN canonicalised (D6). That covers all state once a minute. For 100 MB that is 28 kB per tick, about 20 µs in TypeScript and 0.2% of the budget.
3. **Rolling digest** `r_t = mix(r_{t−1}, d_t, slice_t)`. A divergence anywhere stays visible in every later `r`.
4. **Reports.** Every 30th tick a client sends `DIGEST{tick, epoch, r_t}`. The *epoch* counts the client's state lineage. It rises by one at each re-sync swap and each load, so digests from a state that is being replaced are recognisably stale. (The PoC first lacked this, and a single desync triggered four re-syncs from queued stale digests; §12.6.)
5. **Comparison.** The relay compares once every live player has reported a tick, or after 5 s with whoever has. The PoC's first version expected only players whose last `STATUS` had already passed the tick, and compared the fastest client against nobody (§12.6).
6. **Detection latency.** Divergence that touches per-tick values is caught at the next report: at most 0.5 s plus the slowest client's lag. In the PoC (which reports every 60 ticks), the verdict came 14–21 ticks after the first report tick that showed the divergence. Divergence confined elsewhere is caught when the slice reaches it, within 60 s.

### 5.2 Recovery

- **Verdict.** A majority of the digests reported for a tick wins. A tie, including any two-player disagreement, goes to the *anchor*: the longest-connected live player, normally the owner. Neither side is "right" in a two-player desync, since both ran the same inputs; what matters is that both converge on one state. Every minority client is re-synced.
- **Background re-sync.** The desynced client is told `RESYNC{snapId, snapTick, epoch}`.
  1. A majority donor serializes at a marker tick, as for a join.
  2. The desynced client **keeps playing in its own world**, with its digests ignored, while a **second simulation worker** (the shadow) loads the donor's state and catches up through the ticks buffered since the marker.
  3. When the shadow reaches the live tick, the client swaps the shadow in, terminates the old worker and raises its epoch.

  The player sees at most a few entities snap into place. If memory does not allow a second world (late game, low-memory device), the client re-syncs in the foreground with "Catching up".
- **Delta re-sync (recommended; later).** A desync is usually local: one inserter, one network. At the marker tick, donor and desynced client each hash their state in fixed pages (64 KiB of each pool field array, each chunk record, each cold-data group). The client sends its page-hash list, about 13 kB for 100 MB of state, and receives only the pages that differ. It patches a copy of its own state at the marker tick, verifies the full hash and fast-forwards. That is kilobytes instead of 20 MB, so seconds instead of the 17–38 s a late-game full snapshot needs on a 10 Mbit/s uplink (§12.3). If more than about 30% of pages differ, fall back to the full snapshot. The paged hash is the slice hash of §5.1 organised by page, so it costs nothing extra to keep possible from M0.
- **Repeated desyncs.** Factorio quits a player after 3 desyncs [9]. We keep re-syncing, but a third desync within 10 minutes shows a notice offering to send the bug bundle (§5.3), because by then it is a reproducible bug.
- **Measured** (§12.6). A deliberately corrupted client was found at the first digest report that covered the corruption. It was then re-synced:
  - from a 166 kB snapshot, swapped in 754 ms after the verdict (500 ms of which is the deliberate 30-tick handover lead);
  - from 2.2 MB over the 100 ms link, swapped in 939 ms;
  - in the late game (21 MB at 10 Mbit/s, 4 ms per tick), downloaded in 17.6 s and swapped in by the shadow thread 35.2 s after the verdict, while the player played on with normal latency.

  Every run agreed afterwards.

### 5.3 Debug bundles

**What is captured.** On every desync verdict the relay sequences a `debug_dump(id)` at the next open tick. Both the desynced client and the donor serialize their full state after that tick and upload it on the bulk socket, paced. The relay then stores a **desync bundle**:
- both states;
- the closure log back to the last snapshot both shared, plus that snapshot;
- each client's ring buffer of per-tick digests `d_t` (the last 36,000 ticks, 144 kB);
- build hashes and user agents.

The developer, or Claude, fetches it from an admin endpoint, as 10 §3.5's `/__report` does for single player.

**Tools** (`game/scripts/`):
1. **`desync-diff a.save b.save`** loads both states and lists the differences:
   - by section; pool fields by entity *serial* (so a different slot order is reported as such), with prototype and position;
   - cold data as a canonical-JSON diff;
   - globals by name.
2. **`desync-bisect bundle`** replays the shared snapshot plus log in Node (V8), and in Firefox through Playwright headless with `?render=none` (SpiderMonkey). It compares per-tick digests with the clients' recorded rings to find the first divergent tick. A debug build then replays that tick with **per-phase digests** (one after each of 10 §4.6's 16 phases) to name the system.
3. **Heavy mode** (`?heavy=1` and a test flag), after Factorio's: it saves and loads the game every tick to detect state that does not survive a save/load cycle [14]. Here: every *k* ticks, serialize, load into a second world, step both and compare digests. It finds unsaved state and order-dependent rebuilds (D3, D8) in single player, long before two players ever meet.

### 5.4 The determinism checklist for M0

These rules make desyncs structurally rare. Each says how it is enforced. They extend 10 §4.1, whose rules stay. **D1–D20 are M0-mandatory**; the engine work packages own their enforcement.

| # | Rule | Why | Enforced by |
|---|---|---|---|
| D1 | **One writer.** Only `World.tick(closure)` mutates world state, and only in the simulation worker. Query and extraction code is read-only | Anything else is an input the other clients never see | `check-arch` import rules; debug builds assert `inTick` in every mutating World API; test D18(c) |
| D2 | **Closures are the only input.** A tick's result depends only on the previous state and that tick's closure. Main-thread messages other than closures (`view`, `ctl`, queries) never change world state. Sim-affecting settings are world state, changed by actions | Replays, joins and other clients see only the closure stream | The `MainToSim` type has no mutating variant besides `act`, which goes to the sequencer; replay test D18(e) |
| D3 | **Canonical iteration order** wherever order can matter: ascending pool index, ascending serial, or a saved order. In particular: (a) active lists are iterated in ascending index (bitset or sorted insertion), or their exact order is saved and restored; swap-remove is forbidden in any order-relevant list whose order is not saved; (b) wake-ups only mark entities active and never do work; (c) timer buckets fire in `(dueTick, serial, eventCode)` order, not insertion order; (d) `Map`/`Set` iteration only where the insertion history is restored by load (or iterate sorted keys); (e) network member lists used in reductions are in ascending serial | A world loaded from a snapshot must behave exactly like the world that produced it. Rebuilt active lists and networks come back in a different order than history built them; with two inserters competing for one item, order decides the winner (the PoC's furnaces compete exactly like this) | Join-equivalence and NO_SLEEP equivalence tests D18(a, b); lint ban on `for…in`; review checklist |
| D4 | **Float reductions in canonical order.** Every float sum or product over a set (network demand and satisfaction, heat, statistics) accumulates in D3's order, or uses integers or fixed point | IEEE addition is not associative: the same members in a different order give different last bits, then different satisfaction, then a desync | D18(a); the "incremental equals rebuilt" property test (10 §10.4 #5) extended to compare the floats a network computes, not only its membership |
| D5 | **Banned APIs**, in addition to 10 §4.1: `**` and `Math.pow` entirely (ECMA-262: *implementation-approximated* for every exponent [26]; V8 folds constant `**` differently from `Math.pow` [27]; use `ipow(x, n)` with a fixed multiplication order, or `detmath.pow`); `Math.hypot`; `Intl`, `localeCompare`, `toLocaleString`, `String.prototype.normalize` (Unicode versions differ); `WeakRef`, `FinalizationRegistry`; timers, `queueMicrotask` and promises inside tick code; sort comparators that can return `NaN` | Engine-dependent results | `check-arch` (oxc) rules, with a fixture file of banned calls that must fail |
| D6 | **No NaN in saved state.** Engines may store any NaN bit pattern into a typed array [26]; also, NaN breaks comparisons | Raw-byte hashing and saving would differ between engines | Debug builds scan the F64/F32 fields of active pools after each phase; the hash canonicalises NaN anyway |
| D7 | **Integer discipline.** int32 arithmetic via `\| 0` and `Math.imul`; counters that can pass 2³¹ are integer-valued doubles below 2⁵³ or wrap explicitly | Implicit `ToInt32` of out-of-range values is a classic divergence between "it wrapped" and "it didn't" | Review; property tests at the boundaries |
| D8 | **Saved state is complete, including everything that orders future work:** free lists (or allocation is canonical lowest-free-slot), handle generations, the serial counter, RNG stream states, timer order, the order of every order-relevant list, cold-data map order, and per-player state. Derived state is rebuilt on load *in canonical order* | A joiner, a re-synced client and a resumed room must continue bit-identically. OpenTTD's first-listed desync cause is an incomplete savegame [16] | Join-equivalence D18(a); heavy mode D18(c); the 10 §8.1 save/load hash test, extended to compare every tick for 10,000 ticks after load, not just the end |
| D9 | **Caches are pure.** A cache gives identical values whenever it is (re)computed, and is never filled as a side effect of a query or of view extraction in a way that changes later results | Clients extract different views and run different queries | Tests compare the state hash before and after extraction and a burst of every query type |
| D10 | **No local player in the simulation.** The simulation never branches on which player is "us"; events carry player indices and the client filters them | Each client has a different local player | The sim API has no such input (type-level) |
| D11 | **Rule-affecting personal settings are world state** (per player, set by actions): auto-sort inventory, pick-ghost-if-no-items, the smart-belt flag (carried in the build action), and every other setting the M0 audit of I §4.20 finds. Client-only settings may change *which actions are sent*, never how actions execute | Otherwise one setting yields two results | Audit table in 10 (Phase B); review |
| D12 | **Worldgen stays pure and committed at sim-determined ticks** (10 §5.18: commit at t + 30, the sim waits for late workers). The worker-pool size never influences results | Clients have different core counts | Test: 1 worker against 4 workers, same chunk hashes and same world hash |
| D13 | **Game time is ticks.** No wall clock in world state; play time, save timestamps and the like go to save metadata outside the hash | Clients' clocks differ | `check-arch` bans `Date` and `performance` in `sim/` (already, 10 §4.1) |
| D14 | **One build per room.** Every client in a room runs the same build hash, protocol version and `prototypes.hash`; the data stage's output is byte-identical for identical inputs | Data differences are desyncs by definition | The relay compares them in `HELLO`; a CI check runs the data stage twice and compares the bytes |
| D15 | **Outputs are outputs.** Feedback events (flying text, sounds, alerts) and packets never feed back into the simulation | The UI differs per client | Architecture (10 §3.2: "the sim never calls UI code") |
| D16 | **No ordering by identity.** Nothing is ordered by object identity, allocation address or `Map` insertion of objects whose history is not saved | Allocation history differs after load | Review; D18(a) |
| D17 | **Strings never decide rules**, except as equality on data ids. Sorting, if ever needed, is by UTF-16 code unit, never by locale | Locales differ between players | D5's bans |
| D18 | **The tests that enforce the rest**, from M0, on every scenario and on fuzzed action sequences: (a) **join equivalence**: save at random ticks, load, and compare *per-tick* digests for N ticks against the uninterrupted run; (b) NO_SLEEP equivalence on per-tick digests (10 §4.6); (c) heavy mode on long runs (nightly); (d) cross-engine traces: the same input log in Node, Chrome and Firefox gives the same per-tick digest trace (nightly; Firefox headless with `?render=none`, which launches on this host, 10 §10.5); (e) replay of every recorded session, single player included; (f) a multi-client harness of N in-process worlds fed one closure stream through a simulated relay | Rules without tests rot | `npm test` (a, b, e, f) and `npm run test:slow` (c, d) |
| D19 | **Rust/WASM addendum** (if WP A1 recommends it): no `HashMap`/`HashSet` with `RandomState` (use `BTreeMap` or a fixed-seed hasher); no relaxed SIMD (fused multiply-add may or may not happen); no threads in the simulation; canonicalise NaNs before hashing and saving; libm compiled in, never JavaScript `Math` imports; no `std::time`. D1–D4 and D8–D18 apply unchanged | WASM is deterministic except where it explicitly is not (NaN payloads, relaxed SIMD) | `clippy` lints (`disallowed_types`, `disallowed_methods`), `wasm-tools` feature checks, D18 |
| D20 | **Every new piece of state declares** whether it is saved or derived, whether its order matters, and its canonical order | The cheapest place to prevent D3 and D8 bugs is the line that adds the state | The pool descriptor table (10 §2.5) gains `saved/derived` and `ordered` columns, and `check-arch` requires them |

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
- **Adapters**: `relay/node/` (`ws`, filesystem storage, HTTP endpoints) and optionally `relay/cloudflare/` (a Durable Object, §6.7). About 1,500 lines in total. The PoC's relay is 330 lines of JavaScript and implements most of it (§12).
- **Shared code**: `shared/net/` holds the wire codec used by relay and clients. Action payloads are opaque bytes to the relay.

### 6.3 Rooms, invites, players and versions

- **Room.** Created by a host with game settings, or by uploading a save as the initial snapshot ("Host saved game"). A room has:
  - a 64-bit random id;
  - an **invite secret** of 80 bits. The invite link is `https://<site>/#/join/<roomId>.<secret>`; the fragment keeps it out of web-server logs;
  - a **short code** for voice: 10 characters of Crockford base32 (`K7QD-M2XP-9R`) that maps to the link at the relay. It is rate-limited per IP so it cannot be enumerated.
- **Player identity.** On first join a player gets a 128-bit **player token** for that room, kept in the browser's IndexedDB. The relay stores only a hash. The token, not the name, identifies a returning player, so two people may share a name.
- **Owner and admins.** The owner (the creator) holds an admin token. Admins can kick, ban, promote, pause and change room settings. Factorio's own default is admins-only pausing [8].
- **Room creation.** The deployment chooses:
  - **private**: creating rooms needs a server-wide creation key, entered once in Settings. This is the default, since the user's server is for friends and colleagues;
  - **public**: anyone can create rooms, within per-IP rate limits.
- **Versions.** `HELLO` carries the build hash, protocol version and `prototypes.hash`. A room is pinned to its current build while anyone is in it:
  - a client with a different build is refused with a reason. A newer client sees "This game runs build X", and an older one is told to reload: its service worker fetches the new build;
  - an empty room is upgraded by the first player who resumes it with a newer build. The save migrates on load (10 §8.3), and the room adopts the new build.

### 6.4 Persistence

**Yes, the relay stores games.** Storing is within the constraint, and it is what makes rooms outlive their players. For each room it keeps:
- the newest complete snapshot (the save container as uploaded);
- the append-only closed-tick log since that snapshot, flushed every second;
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
| Players per room | 8 by default, at most 32 | The design target is 2–8. Nothing structural limits it: the player index is a `u8` |
| Action rate per player | 120 actions/s sustained, bursts of 600 | Drag-building and fast transfer burst; anything beyond is a bug |
| Inline action payload | 64 KiB; blobs up to 8 MiB | Head-of-line protection on the control socket (§3.3) |
| Control-socket inbound | 64 KiB/s per player | Ten times normal use |
| Snapshot size | 128 MiB | Five times the Late estimate |
| Rooms per creator IP | 10 per day (public mode) | Abuse |
| Connections per IP | 32 | Abuse |

### 6.6 Cost per room

**Measured** on this host, a 2013 Xeon E5-2650 v2 core at about 0.55× a 2020 laptop core (10 §11). Four simulated players per room, each with a 60 Hz tick stream, `STATUS` at 10 Hz, 2 actions/s and pings (`poc/loadgen.mjs`, §12.7):

| Rooms × 4 players | Relay CPU (one core) | CPU per room | Relay memory |
|---|---|---|---|
| 1 | 3.5% | 35 ms/s (mostly fixed timer overhead) | 70 MB |
| 10 | 15.5% | 15 ms/s | 77 MB |
| 50 | 46.5% | 9.3 ms/s | 89 MB |
| 100 | 57% (the load generator saturated first) | — | 107 MB |

- **CPU.** A four-player room costs about 1% of one old core. One VPS core serves 50–100 rooms. An eight-player room roughly doubles the sends.
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

   `RoomCore` is written so that this adapter is about 300 lines.
3. **This host (cpuserver10), for development.** The relay runs next to the Vite dev server and players use the SSH tunnel (CLAUDE.md). Outside players need a public endpoint, so it is not a deployment.

A claude.ai Artifact cannot host multiplayer: it serves the static page only, and its content security policy does not allow arbitrary WebSocket endpoints.

### 6.8 Observability

- **Logs.** Structured JSON lines: connections, joins, leaves, desyncs, snapshots, errors.
- **Metrics.** `GET /metrics` in Prometheus text format: rooms, players, messages and bytes per second, lag distribution, late-action rate, desyncs, join and re-sync durations, snapshot sizes and upload rates.
- **Admin endpoints**, behind the server's admin key: `GET /admin/rooms` (`/stats` in the PoC); per-room live state; desync bundles for download.
- **Client side.** The F5 debug overlay (I §4.21) gains a network section: RTT, margin, playout delay, horizon lag, ticks per second received, late actions, the bytes-per-second meter and the digest epoch. Factorio has comparable multiplayer debug options.

### 6.9 Restarts and failures

- **Graceful restart (deploys).** The relay stops accepting, flushes every room's log through its last closed tick, sends `NOTICE{restarting}` and exits. Clients keep simulating up to their horizon, reconnect with backoff, and resume from the restored log: a pause of a few seconds.
- **Crash.**
  - The log on disk may miss up to 1 s of closed ticks. On restart the relay restores each room at its last persisted tick and asks the first reconnecting client for its closures after that tick. Every client holds them, and they are identical, so the relay re-adopts them and continues.
  - If no client is left, the room rolls back at most 1 s to the persisted state.
  - Clients that had simulated beyond the restored horizon re-sync.
- **Relay lost for good.** Any player hosts their last local autosave as a new room (§4.6).

---

## 7. Engine seams for M0

Networking itself arrives late (a dedicated multiplayer milestone after M3, or wherever the plan puts it), but these seams must exist from the first line, because retrofitting them means touching every system.

| # | Seam | Specification | When |
|---|---|---|---|
| S1 | **Players everywhere** | `World.players: PlayerState[]`, indexed by a `u8` player index; 10 §4.4's single `player` goes. Every action carries the acting player. `builtBy` (10 §4.5) encodes 0 = unknown, 1 = agent, 2 = Constructor, 16 + i = player i. The save's `PLAYER` section becomes `PLAYERS`. Per-player state as in §3.7, including undo stacks, crafting queue and hand | **M0-mandatory** |
| S2 | **The action pipeline** | `InputAction` types in `shared/actions/`, a descriptor-driven binary codec (§3.3), and `TickClosure { tick, entries: { player, seq, bytes }[] }`. The simulation applies *only* closures. In single player every action is encoded and decoded too, so the codec is exercised constantly | **M0-mandatory** |
| S3 | **The sequencer interface** | `interface Sequencer { submit(a: StampedAction): void; onClosures(cb: (batch: ClosureBatch) => void): void; clock(): RelayClock; control(op: Pause \| Resume \| Speed \| Step) }`. Version 1 is a `LocalSequencer` for single player, tests and replays: it stamps `nextTick`, closes ticks from its own clock (or on `step(n)` in test mode), and handles pause, speed and the hidden-tab pause. The simulation loop advances to the horizon of the closure stream, paced as in §3.6. `RelaySequencer` comes later behind the same interface | **M0-mandatory** (`LocalSequencer`); later (`RelaySequencer`) |
| S4 | **Simulation state apart from UI state** | No camera, open window, hover, selection, alt-mode, overlay, chat or interface setting in the World. Rule-affecting personal settings are per-player world state set by actions (D11). The M0 audit lists every setting of I §4.20 and 07 §20 as client-only or world state | **M0-mandatory** |
| S5 | **Entity references that survive latency** | Handle plus `(surface, position, prototype)` fallback, resolved and validated at execution (§3.3) | **M0-mandatory** |
| S6 | **Determinism rules D1–D20** and their tests | §5.4, including join equivalence on per-tick digests and heavy mode | **M0-mandatory** |
| S7 | **Digests** | Per-tick digest `d_t`, the slice hash and the rolling digest (§5.1) in `sim/core/hash`; per-phase digests in debug builds. Single player uses them in replays and bug bundles | **M0-mandatory** (cheap, and catches single-player bugs) |
| S8 | **Input log = closure log** | 10 §8.5's input log stores closure batches verbatim. `__game.replay` feeds them through a `LocalSequencer` in replay mode. Bug bundles add the per-tick digest ring | **M0-mandatory** |
| S9 | **Snapshot at a tick boundary, and fast-forward** | "Serialize after tick T" while the simulation runs: the pool copy as in 10 §8.4, compression in the IO worker. "Load and run ticks up to H as fast as possible with extraction off, in time slices that yield to messages" | **M0-mandatory** (both are small extensions of save/load and `step(n)`) |
| S10 | **Feedback tagged by action** | Every `SimEvent` that answers an action carries `(player, seq)`, so a future latency state knows which prediction failed. The movement and placement-check functions can run on a scratch character without touching the World | **M0-mandatory** (tagging); later (the latency state, §3.5) |
| S11 | **Worker topology** | The simulation worker takes closure batches from a `MessagePort`; in single player the `LocalSequencer` sits behind it. In multiplayer a net worker owns the sockets and feeds the same port (§2.4) | M0: the port; later: the net worker |
| S12 | **Identity and versions** | Build hash, protocol version and `prototypes.hash` in saves (10 §8.1 has the first and last) and later in `HELLO`. The room roster (names, colours, token hashes) lives in the save header, outside the hash | **M0-mandatory** (fields); later (roster) |
| S13 | **Chat and presence channel** | Out of band. In single player, chat stays the notes line of I §4.19 | Later |
| S14 | **No pause semantics in the World** | Pause, speed, the hidden-tab pause and the pause of the technology screen are sequencer states, never world state, so multiplayer can simply not send them | **M0-mandatory** |

**Single player is multiplayer with a local transport.**
- The main thread's input layer produces actions. They go to the `LocalSequencer`, which stamps them for the next tick (margin 0) and closes ticks from its clock. Closure batches go to the simulation worker through the same port and the same codec a network would use, and the simulation applies closures exactly as it would in a room of eight.
- Test mode's `step(n)` closes n ticks.
- Replays feed recorded batches.
- What single player skips: the relay, stamping estimates, playout buffering, digests reported to anyone, and the latency state (with a margin of 0, prediction equals confirmation).

**Changes for the Phase B revision of 10** (the manager commissions them):
1. §0 gains rows for the multiplayer model and the sequencer.
2. §3.1 gains the net worker and the closure port.
3. §3.2 gains `TickClosure` and system actions; `act` goes to the sequencer.
4. §3.3: pacing by horizon, multiplayer rules for hidden tabs and pause.
5. §4.1 gains D1–D20.
6. §4.4: `players[]`.
7. §4.5: the `builtBy` encoding and the descriptor columns of D20.
8. §5.1 states the per-player state and the rules for offline characters.
9. §5.20: per-player accumulators.
10. §8.1: a `PLAYERS` section, the roster in the header, and the page layout for delta re-sync.
11. §10.4 gains D18's tests.
12. §12 gains a multiplayer milestone; M0 gains S1–S10, S12 and S14.
13. Appendix B gains the system actions.

---

## 8. UI and UX

Factorio's multiplayer UI where it exists. I BEND-2 removed it from the slice ("no players list, pings, permissions or admin"), and the controls it reserved come back: `place-ping` (Ctrl+Alt+LMB, "Quickly create a map ping at the selected location and link to it in the chat") and the side-menu *Players* button (I §4.1).

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
- **Re-sync.** Silent in the background (§5.2). In the foreground, the same *Catching up* bar. The third desync in 10 minutes shows a notice with *Send report*.
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
- **Join stages:** *Connecting*, *Downloading map*, *Loading map*, *Catching up*.
- **System lines:** "{name} joined the game.", "{name} left the game.", "Game paused by {name}.", "Server is not responding", "Your computer cannot keep up with this game.", "This game runs build {build}."
- **Players window columns.**
- **Room settings labels** (§8.1).
- **Error reasons** (§8.2).

### 8.5 Keys and settings

- **Keys.** No new default keys. *Players* gets no default (as in Factorio); `place-ping` keeps Ctrl+Alt+LMB; chat keeps `` ` ``.
- **Settings → Interface:** player name, player colour, show remote cursors (off), show chat in the game view (on).
- **Settings → Other:** relay address and creation key, for private deployments.

---

## 9. The test plan

1. **Unit** (Vitest, Node):
   - the wire and action codecs (round trips with fast-check, including every action type at its field limits);
   - `RoomCore` on a simulated clock: acceptance and late handling, closing, system-action injection, grace timers, digest voting with stale epochs, donor choice, resume ranges;
   - the margin and playout controllers fed recorded traces;
   - the LEDBAT pacer against a simulated FIFO queue.
2. **The in-process multi-client harness** (Vitest; it runs in seconds), based on the M0 sequencer interface:
   - N worlds driven by a simulated relay over a **deterministic discrete-event network**: per-link latency and jitter distributions, loss modelled as TCP head-of-line stalls, a shared FIFO bottleneck with a bounded queue, disconnects, black-holes and reordering *between* a player's control and bulk sockets;
   - scripted bots act;
   - asserted: equal per-tick digests across worlds; the join, resume and re-sync paths; and bounds on stall time, late actions and catch-up time per profile.

   This is the PoC's experiment made deterministic and fast.
3. **Real network, real browsers** (Playwright; nightly and before the multiplayer milestone's exit):
   - the Node relay, an impairment proxy (the PoC's `netem.mjs`), and 2–4 pages. Chrome with SwiftShader runs with `?render=on-demand`, Firefox headless with `?render=none`, one page per engine;
   - scripted play plus joins, drops, black-holes, a forced desync, a hidden page (only through a directly launched Chrome over CDP, since Playwright's own launch disables background throttling, §12.5), and a frozen page;
   - every page fails on any console error (10 §10.5).
4. **Determinism fuzzing** (nightly): random action sequences from up to 8 simulated players on generated factories, run through D18(a–e), with Node, Chrome and Firefox traces compared. Failures shrink with fast-check and turn into scenario tests.
5. **Soak**: 8 bot players for 2 hours, random joins, leaves and drops every few minutes. Zero desyncs; memory flat on clients and relay.
6. **Load**: 100 rooms of 4 on one relay process, without the load generator as the bottleneck. CPU per room and p99 tick-emission jitter within budget.
7. **On the user's machine** (once per multiplayer release; extends 10 §10.6's `bench.html`): a hidden-tab check (switch away for 6 minutes, then report the worker's tick rate) in Chrome and Firefox. This closes the gap this host cannot test (§12.5).

**Green before multiplayer ships:**
- every D18 test passes on every golden save and scenario;
- 100 hours of cross-engine fuzzing without a divergence;
- the harness matrix within budget;
- a two-hour soak with zero desyncs;
- a scripted three-player session across two browsers;
- join of a Late-scale save in under 30 s at 10 Mbit/s;
- resume after a 3-s black-hole without a snapshot;
- a forced desync repaired in the background;
- load test passed;
- the user's hidden-tab check passed.

---

## 10. Risks, ordered by importance

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Logic-level desyncs**: order, unsaved state, impure caches (D3, D4, D8, D9). The class that dominates in Factorio and OpenTTD, in any language | High during development | High | D1–D20 from M0; join equivalence and heavy mode on every scenario; background re-sync and debug bundles turn the remaining ones into fixable reports |
| 2 | **Engine-level float divergence** if the simulation stays TypeScript | Medium | High | D5/D6 bans in `check-arch`; `detmath`; nightly cross-engine traces. Rust/WASM removes this class (§1.4) |
| 3 | **Late-game joins and re-syncs on slow uplinks**: a 20 MB save at 2 Mbit/s takes 80 s, and pacing stretches it further | Medium | Medium | Relay-cached snapshots from periodic paced uploads; best-uplink donor; delta re-sync; "pause while joining" |
| 4 | **Browsers suspending background tabs**: Chrome's Energy Saver freezing [33], Firefox's Nightly worker throttling [36], Safari's undocumented policies | Medium | Medium | The tick-driven worker loop; the catch-up/re-sync choice on wake-up; the bench check on the user's machine; Chrome's planned Progress Notification API, should it ship |
| 5 | **A player's machine cannot hold 60 UPS late in the game** | Medium | Medium | Factorio's policy by default; "match the slowest player" as an option (§3.6) |
| 6 | **TCP head-of-line stalls on lossy links** (Wi-Fi, mobile) make the world hitch or lag 200–500 ms | Medium | Low–medium | Adaptive playout; predicted own character. Later, optional WebTransport where UDP is allowed |
| 7 | **Operating a relay**: hosting choice, uptime, privacy of stored games, abuse in public mode | Medium | Medium | Private mode by default; small codebase; graceful restarts; client-side autosaves; the Cloudflare option |
| 8 | **Spec gaps for multiplayer**: per-player achievements and run-report lines, starting items for new players, offline-character rules, chat strings | Certain | Low | Listed in §8.3, §8.4 and §11 for the owners of 04, 07, 08 and 10 |
| 9 | **Version skew** between a service-worker-cached build and a room | Medium | Low | The build check in `HELLO` (D14); forced update; room upgrade on resume (§6.3) |
| 10 | **Bufferbloat during transfers** degrading the donor's game | Medium | Low | LEDBAT pacing (§4.3), measured |

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

The proof of concept is in `design/multiplayer/poc/`: about 2,200 lines of JavaScript, Node 24, and `ws` 8.22.0 as the one dependency. It lints clean under the project's Biome 2.5.15.

| File | What it is |
|---|---|
| `protocol.mjs` | The wire format of §3.2 (binary `TICKS`, `ACT`, `ACTACK`, `STATUS`, `DIGEST`, `PING`/`PONG`, snapshot chunks) |
| `sim.mjs` | A toy deterministic simulation: integer state; per-player characters and inventories; drills and furnaces that compete in slot order; a saved LIFO free list; counter-based RNG; per-tick digest, rolling digest and rotating slice hash; serialize/deserialize with optional incompressible padding to emulate save sizes |
| `relay.mjs` | The relay and sequencer of §6 (410 lines, with its stats and static-file endpoints) |
| `client-core.mjs` | The client of §3–§5: stamping with margin control, adaptive playout, catch-up, donor uploads with optional LEDBAT pacing, background re-sync with a shadow simulation, resume, and held-input re-send. Runs in Node and in a browser worker |
| `client.mjs` | A headless Node client with a scripted bot player |
| `shadow-worker.mjs` | The background re-sync's shadow simulation in its own thread (§5.2) |
| `netem.mjs` | A userspace TCP impairment proxy (there is no root, so no `tc`): delay, jitter, loss as head-of-line stalls, a shared FIFO bottleneck with a bounded queue and TCP back-pressure, drops, black-holes |
| `run-scenarios.mjs` | The scenario matrix (§12.2–§12.4) |
| `loadgen.mjs` | The relay load test (§12.7) |
| `summarize.mjs` | Turns the result files into the tables of this section (`results/summary.md`) |
| `browser/` | The page, the worker and the hidden-tab experiment over raw CDP (§12.5) |

Run (here pinned to CPUs 8–15, away from another agent's benchmarks):
- `cd design/multiplayer/poc && npm ci`
- `taskset -c 8-15 node run-scenarios.mjs [name …] > results/matrix.txt` writes one `results/<name>.json` per scenario, about 70–90 s each;
- `node summarize.mjs > results/summary.md` turns them into the tables below;
- `taskset -c 8-15 node loadgen.mjs --rooms 50`;
- `xvfb-run -a taskset -c 8-15 node browser/hidden-tab-cdp.mjs 390`, about 8 minutes.

What the toy simulation does not show: real tick costs (emulated with a blocking wait), real save sizes (emulated with padding), and the latency state (only its prerequisite, prediction exactness, is measured). The PoC's client runs its network code in the simulation's thread, which the design does not do (§2.4); that matters in §12.3 and §12.4. Its watchdog closes a silent link after 1.5 s, half the design's 3 s. The shadow simulation of a re-sync runs in its own thread, as in the design.

All numbers below are from the final run of every scenario (`results/matrix.txt`, `results/summary.md`), pinned to CPUs 8–15 while another agent benchmarked on the other socket. Network profiles are one-way per direction, applied by `netem.mjs`. "Loss stalls" are the share of messages held back by a retransmission, together with everything behind them.

### 12.2 Latency, stamping and playout

Scenarios: `base` (three players: LAN, home and far; the home player's link drops at 30 s; the LAN host's link black-holes for 3 s at 38 s; the far player joins at 20 s and corrupts its state at tick 2700), `relaystamp` (the same with stamping on arrival at the relay), `hz30` (the same at 30 tick messages per second), `mixed` (four players on home, Wi-Fi, mobile and far links, no faults) and `harsh` (a stress link).

| Scenario: player (one-way delay ± jitter, loss stalls) | RTT ms | Input delay p50 (ticks) | Walk inputs mispredicted | Confirmed p50 / p95 ms | Applied locally p50 / p95 ms | Playout delay ms | Underruns (total) |
|---|---|---|---|---|---|---|---|
| base: A, LAN (1 ± 1 ms) | 4 | 1 | 0.0% | 33 / 51 | 80 / 110 | 35 | 2 (3.1 s: the black-hole) |
| base: B, home (12 ± 6 ms, 0.3% × 150 ms) | 30 | 2 | 1.7% | 61 / 80 | 150 / 174 | 118 | 8 (0.6 s, with the drop) |
| base: C, far (45 ± 20 ms, 1% × 250 ms) | 106 | 4 | 5.0% | 137 / 226 | 379 / 400 | 260 | 5 (0.5 s) |
| relaystamp: A, LAN | 5 | 0 | **15.5%** | 20 / 48 | 74 / 100 | 52 | 4 (3.3 s) |
| relaystamp: B, home | 29 | 1 | **20.0%** | 46 / 64 | 99 / 166 | 126 | 8 (0.6 s) |
| relaystamp: C, far | 112 | 4 | **53.7%** | 130 / 271 | 367 / 396 | 274 | 4 (0.3 s) |
| hz30: A, LAN | 5 | 1 | 0.0% | 46 / 75 | 144 / 170 | 98 | 2 (3.1 s) |
| hz30: B, home | 29 | 1 | 3.3% | 60 / 87 | 103 / 164 | 123 | 6 (0.6 s) |
| hz30: C, far | 107 | 4 | 7.5% | 156 / 404 | 368 / 551 | 247 | 5 (0.5 s) |
| mixed: A, home | 28 | 2 | 0.0% | 64 / 77 | 207 / 228 | 147 | 3 (0.2 s) |
| mixed: B, Wi-Fi (15 ± 20 ms, 0.5% × 200 ms) | 45 | 2 | 5.1% | 80 / 107 | 267 / 285 | 211 | 6 (0.3 s) |
| mixed: C, mobile (30 ± 40 ms, 1% × 300 ms) | 93 | 5 | 6.7% | 152 / 416 | 444 / 576 | 320 | 3 (0.4 s) |
| mixed: D, far | 102 | 4 | 5.5% | 149 / 375 | 389 / 404 | 265 | 3 (0.2 s) |
| harsh: B (40 ± 60 ms, 3% × 400 ms) | 141 | 19 | 12.3% | 540 / 849 | 813 / 977 | 452 | 2 (0.1 s) |

*Confirmed*: from sending an action to receiving the closed tick that contains it. *Applied locally*: until the player's own confirmed simulation executes it, which adds the playout buffer. Predicted movement is shown at once regardless (§3.5).

**Findings.**
- **Stamping.** Client stamping mispredicts only the actions that arrive late (0–5% here, 12% on the stress link). Relay stamping mispredicts 15–54% of walk inputs, each by a tick or more (0.15 tiles). Across three runs, relay stamping measured 2–24% on the LAN link, 18–35% at home and 39–54% on the far link. Client stamping costs 7–15 ms of confirmation latency (the margin).
- **The margin and playout controllers changed during the PoC, and the change shows.** With the first controllers (§3.4, §3.6), `mixed` measured 10, 18, 21 and 22 underruns per minute on the home, Wi-Fi, mobile and far links, and input delays of 2, 3, 20 and 18 ticks. With the final ones it measured 3, 6, 3 and 3 underruns, and 2, 2, 5 and 4 ticks, for about the same playout delay.
- **The cost of TCP on lossy links** is the playout buffer. With a stall of 150–400 ms for every 100–300 messages, the buffer settles near the stall length (120–320 ms), so the world runs that far behind the player's predicted character. Real wired connections lose far less than these profiles, so their buffers are smaller.
- **30 Hz** halves the tick messages (37–40 per second including acknowledgements, against 56–60) for about 10 ms more confirmation latency.
- **Resumes.** The 30-s drop and the 3-s black-hole both resumed from the relay's log, without a snapshot. Every scenario ended with all clients' digests equal.

### 12.3 Late-game joins and the donor's uplink

`bigjoin`: a 21 MB snapshot, every client spending 4 ms per tick (the Late row of 10 §4.7), and both players on home links capped at 10 Mbit/s up and 50 Mbit/s down. Each link is a single FIFO with a 300 ms queue, shared by the player's control and bulk sockets. `bigjoin-paced`: the same with the LEDBAT-style pacer (§4.3).

| | Unpaced | Paced |
|---|---|---|
| Snapshot transfer (donor → relay → joiner) | 17.4 s (10 Mbit/s would take 16.8 s) | 37.8 s (24.9 s in an earlier run) |
| Joiner's catch-up | 1,811 ticks in 12.9 s | not finished within the 75-s run |
| Donor's control RTT, idle → during upload, p50 / p95 | 50 → **270 / 359 ms** | 52 → **60 / 141 ms** |
| Donor's input delay p50 / confirmation p50 | 16 ticks / 309 ms | 4 ticks / 102 ms |

**Findings.**
- **The catch-up formula holds.** The joiner's effective rate was 140 ticks per second: the 4 ms emulated tick plus the single-threaded client's overheads, and 240 ticks per second in an earlier run. With it, §4.4's formula predicts 1,050/(140 − 60) = 13.1 s against 12.9 s measured.
- **Pacing.** The unpaced donor's own game suffered for the whole transfer. The crude pacer protected it but doubled the transfer time. A tuned LEDBAT, a donor with a better uplink, or the relay's cached snapshot (§4.2) are the remedies. The time to join is dominated by the donor's uplink, not by anything on the relay.
- **The thread.** A 4 ms tick on the thread that also handles the network widened the control round trip's tail: the joiner's confirmation p95 was 186 ms, against 77 ms on the same link without tick cost (`mixed` A). This is one reason the design moves networking into its own worker (§2.4).

### 12.4 A machine that cannot hold 60 UPS

`slow`: three players on home links. B needs 20 ms per tick.
- **B** received its 1.1 MB snapshot in 0.5 s but never finished catching up, since it falls a further 10 ticks behind every second. So it never became live, never got a character, and never sent an action.
- **A and C were unaffected:** input delay 2 ticks, confirmation p50 64 ms, 3–4 underruns, the same as any home link in the other scenarios. The relay does not wait (§3.6).
- In the first matrix, which ran B's networking on its saturated thread, B's control RTT reached 5.4 s.

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

| Scenario | Corrupted | Detected | Re-sync | Swapped in after the verdict | Afterwards |
|---|---|---|---|---|---|
| Two players, small state (smoke test of the final code) | tick 900 | at the tick-960 report | 166 kB snapshot, downloaded in 37 ms | 754 ms (including the deliberate 30-tick handover lead) | digests equal at ticks 600 and 1200 |
| `base`: far player C | tick 2700 | at the tick-2760 report, relay tick 2781 | 2.2 MB, downloaded in 362 ms over the 100 ms link | 939 ms | digests equal at ticks 2400 and 3000 |
| `bigresync`: late game, 4 ms per tick, 21 MB, donor uplink 10 Mbit/s | during the join's catch-up | at the first report after going live (tick 1980) | 21 MB, downloaded in 17.6 s | **35.2 s**, by the shadow thread | digests equal at ticks 4200 and 4800 |
| `bigresync-paced` | as above | tick 2760 | 21 MB paced, 31.7 s | not within the 90-s run | B still on its divergent state at the end |

**The re-sync went unnoticed in play.** During the late-game re-sync, the desynced player kept playing: confirmation p50 68 ms, 3 underruns (0.14 s), normal input delay. Only its digests were excluded from votes.

**The PoC found five problems in its own first versions.** Each is now a rule in the design:
1. **Digest comparison.** The relay compared a tick once every player whose last `STATUS` had passed that tick had reported. Since `STATUS` lags the digest, the fastest client was compared against nobody, and a desync between two players went unnoticed. Rule: expect every live player, and time out after 5 s (§5.1).
2. **Stale digests.** One desync caused four re-syncs, because digests the client had sent from its divergent state were still queued at the relay. Rule: digest epochs, and purging on re-sync (§5.1).
3. **Margin control.** The first controller added each action's lateness to the margin and took a tick off every 5 s. A single loss stall then left 18–20 ticks of input delay for a minute (§12.2). Rule: the margin is a high percentile of recent need (§3.4).
4. **Playout control.** The first controller recomputed the buffer from a percentile every second, undoing each underrun's widening (§12.2). Rule: grow at once, shrink slowly (§3.6).
5. **The shadow's thread.** Time-slicing the shadow simulation on the live thread saturated it at 4 ms per tick: the control RTT reached 1–4.6 s, and the late-game re-sync never finished. Rule: the shadow gets its own worker (§5.2). With one, it finished (above).

### 12.7 Relay load

`loadgen.mjs` runs R rooms × 4 players that behave like players on the wire (60 Hz tick stream in, `STATUS` at 10 Hz, an action every 0.5 s, pings and digests out) against one relay process, and reads the relay's CPU time from `/proc` (`results/loadgen.jsonl`):

| Rooms × 4 | Relay CPU | Per room | Memory | Tick messages per client per s |
|---|---|---|---|---|
| 1 | 3.5% | 35 ms/s | 70 MB | 60 |
| 10 | 15.5% | 15 ms/s | 77 MB | 60 |
| 50 | 46.5% | 9.3 ms/s | 89 MB | 57.5 |
| 100 | 57% | 5.7 ms/s | 107 MB | 41 (the single-process load generator saturated) |

On this 2013 Xeon a four-player room costs about 1% of a core. A current VPS core is about twice as fast.

### 12.8 Bandwidth

Payload bytes as the clients counted them:

| | Down (relay → client) | Up | Tick messages per second |
|---|---|---|---|
| 60 Hz (`base`, `mixed`) | 43–47 kB per minute (0.75 kB/s) | 11 kB per minute (0.18 kB/s) | 56–60 |
| 30 Hz (`hz30`) | 31–33 kB per minute (0.53 kB/s) | 11 kB per minute | 37–40 |
| Load generator (`STATUS` at 10 Hz, no bot) | 0.81 kB/s | — | 60 |

On the wire, each message adds about 76 bytes of WebSocket, TLS and TCP/IP overhead (§2.7). That turns 60 messages per second into about 5 kB/s down: the per-message overhead, not the payload, is the cost, which is why 30 Hz is the useful lever.

---

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

**[I-data]** The design phase's local Factorio dumps in `design/round1/I-data/` (raw material, gitignored): the 2.x changelog (2.0.7 latency hiding for cars; 2.0.33 "Multiplayer selection rectangles will only show the player name if the player's character is not visible on-screen"; 2.1.18 chat colouring) and `controls.wiki` (map ping; "for pasting to work, the source entity must still exist").

**Local measurements**: everything marked PoC is in `poc/results/` and reproducible with the commands of §12.1. Playwright's launch defaults that defeat background throttling were read from `~/.local/lib/node_modules/playwright/node_modules/playwright-core/lib/coreBundle.js` (Chromium switches `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding` and `Emulation.setFocusEmulationEnabled`; Firefox prefs `dom.min_background_timeout_value: 0`, `dom.timeout.enable_budget_timer_throttling: false`, `focusmanager.testmode: true`, `layout.testing.top-level-always-active: true`).
