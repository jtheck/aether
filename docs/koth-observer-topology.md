# KOTH observer topology

## Every join is a drop-in

There is **one** join path, for the 2nd player and the 5th alike: claim → `JOIN_ACCEPT` → deterministic `SPAWN_SLOT` at an agreed tick. `spawnKothSlot` picks a free pad and spawns any slot at any tick, and the world is always sized for `KOTH_MAX_SLOTS`, so nothing about the board needs to change when someone arrives.

The first challenger used to be special: it triggered a host-authored reset to a fresh two-army tick 0 (`resetForJoin` + `MATCH_SNAPSHOT`). That rebuilt the world underneath every spectator, which invalidated their catch-up, dropped their queued seat claim, and made them re-claim into a world that was still settling. It also meant the "first two players" behaved unlike everybody else. A king simply keeps playing now, and challengers drop in around it.

Live matches cap at **5 players**. Everyone else is an **observer**. The goal is that a large observer crowd barely impacts the players who are actually in lockstep.

Future observer→player toys (ghost avatars, weather events, etc.) stay low-rate and route through L1→player only — never L2+ dialing into the player mesh.

## Topology

```
Players (≤5) ──1:1──► L1 observers ──fan-out 4──► L2+ observers
```

- Each live player sponsors **at most one** L1 observer (catch-up + live feed).
- Further observers attach to observers. Prefer the shallowest node with free child capacity (`CHILDREN_PER_SPONSOR = 4`).
- **Dial rules:** observers dial their assigned sponsor only (with fallback if that sponsor drops). Live players dial each other; they never initiate to observers.
- **Catch-up:** players answer snapshot requests only for their assigned L1. Caught-up observers answer for their children. L2+ never request snapshots from players.

Sponsor assignment is king-authoritative and advertised in presence (`sponsorId`, `observerDepth`).

Invariants the tree must hold (`reconcilePlayers` / `recomputeDepths` enforce them):

- A seat holder is a **player** node everywhere, not just on the client that got promoted. The king computes eligibility, so a stale observer node there occupies the eligible set for the rest of the match.
- `depth` is derived from the players outward, never left at whatever it was when the link was made. A sponsor that promotes or leaves would otherwise strand its whole subtree at a depth that can never be offered a seat.
- An observer with no path to a player parks at L1. It holds a caught-up world, so it stays claimable while it waits for a sponsor.
- Presence only carries a peer's **own** sponsor, so `SPONSOR_ASSIGN` / `SPONSOR_HANDOFF` must survive a missing WebRTC edge (they are on the broadcast fallback). An observer that never heard its assignment says `sponsorId: null` on `SNAPSHOT_REQUEST`, and any player may then serve it.

## Checkpoints

Long KOTH matches must not force late joiners to replay from tick 0.

- Every ~5 minutes (`CHECKPOINT_INTERVAL_TICKS ≈ 6000` at 20 Hz), live peers build a deterministic **world checkpoint** (full sim state at tick T + checksum).
- King announces `CHECKPOINT_META` (`tick`, `checksum`, size). Sponsors ship checkpoint + ledger **after** that tick to dependents (chunked).
- Catch-up path: `importWorld(checkpoint)` then replay ledger delta to live tip; verify checksum.
- Players may prune committed ledger frames older than the latest checkpoint once dependents have it (or after a grace window).

Transfer rules:

- The world and the ledger **always** travel as chunks — over the data channel when there is one, otherwise addressed (`to`) over the broadcast relay in smaller pieces and paced. A whole world on one relay message is dropped silently, and the joiner cannot tell that from "still arriving".
- `ledgerTransferId` on a `SNAPSHOT_OFFER` is a promise that chunks are coming. Advertising one without sending them parks the joiner on "Receiving catch-up ledger…" until the retry timer, which then makes the identical offer — an infinite loop with the joiner in the roster but stuck on the loading-screen world.
- Every arriving chunk re-arms the joiner's catch-up timeout, so a slow relay transfer is not mistaken for a dead sponsor.
- Transfer time is not free: a joiner resumes at whatever tick the host's world was cut at, so every millisecond of export, transfer and replay becomes lag it has to make up. Keep the relay paced but brisk.

## Catching up to the live tip

`simAcc` is clamped to real time, so a client that resumes behind the host stays behind for the rest of the match — and it compounds down the fan-out, because an L2 pulls from an L1 that is already behind. That is why a joiner would see play seconds late and the next one later still.

`SimSession` therefore drains the backlog explicitly: while `confirmedTick` is more than `LOCKSTEP_CATCHUP_LAG_TICKS` behind `liveTickCeiling()` (the lowest tick every required peer has confirmed), commits chain at worker speed instead of wall-clock speed, with hysteresis so the clock does not oscillate. It is gated by the same `_canAdvance` quorum as a normal commit, so it is exactly as safe as ordinary lockstep — just not throttled.

Anything driven off `onCommit` must therefore be time-based rather than per-tick (presence, HUD repaints), or a draining client floods the wire.

## Open-slot offers

While `activeCount < 5`, there is always an open-seat offer. **No auto-promotion.**

1. King publishes `SLOT_OFFER` with an `offerEpoch` and eligible user set.
2. Eligible set starts as caught-up **L1** observers (join / catch-up order), minus anyone who already holds or is claiming a seat, and is then widened until there is **at least one candidate per open seat**. The 1:1 fan-out limit is about catch-up bandwidth, not about who may take an empty seat — capping eligibility at L1 meant a lone king could only ever offer to one observer, so everyone behind them waited out an expand step per seat while seats sat open.
3. Every ~30s (`OFFER_EXPAND_MS`), expand eligibility by one more observer beyond the open-seat count.
4. Offer does **not** time out; it ends only when someone claims or the match is full again.
5. Eligible observer opts in (J / Enter Match) → `SLOT_CLAIM` → existing join accept / spawn choreography → `SLOT_OFFER_END` (carrying `winnerUserId`) for everyone else.
6. First valid claim wins. A claim against a closed epoch re-opens the offer rather than being dropped, and a claim with no `JOIN_ACCEPT` inside `SLOT_CLAIM_TIMEOUT_MS` retries up to `MAX_SLOT_CLAIM_ATTEMPTS` before releasing the claimer back to the pool.

`refreshSlotOffer` runs from `onCommit`, so it is throttled and de-duplicated: only a changed eligible set (plus a slow re-announce for peers that missed it) goes on the wire. Two things depend on that:

- The expand timer must **survive** a refresh. Re-arming it per refresh means it never fires at tick rate, and eligibility never cascades past L1.
- Only the king mints epochs, and only the king advertises them in presence. Epochs move forward only; a heartbeat carrying an already-closed epoch must not re-arm it, or the offer appears and vanishes. A king handover resets the epoch window, since the new host's wall clock may lag the old one's.

## Join quorum

A joiner spawns at an agreed `joinTick` (deterministic `SPAWN_SLOT`), but it enters each peer's lockstep quorum **on its first tick confirm at or past `joinTick + 1`** — never on the tick alone.

Scheduling quorum entry by tick is what froze the table. Every peer parked at `joinTick + 1` waiting on a client that might still be seconds away, or might never arrive, and nothing but a watchdog could break it. Waiting for the joiner to actually speak means nobody ever waits on a ghost.

Admitting at slightly different local ticks across peers is safe, and this is the load-bearing argument: the joiner authors no commands before its first confirm tick, so the frames `collectFramesForTick` gathers over the differing window are identical (empty) everywhere. To keep that true, a fresh joiner holds its **input** for `JOIN_INPUT_SETTLE_TICKS` after spawning — it can see its army before it can order it, because a command authored before the table has taken its confirm would be collected by some peers and dropped by others.

Supporting rules:

- A client may not claim while lagging (`canClaimSeatNow`). A claim pressed early is queued and fires automatically once level, so the player just sees "Catching Up…".
- **Measure that lag honestly** (`localLagTicks`), from two directions:
  - Peer tick confirms are the primary measure, but catch-up seeds them at the attached tip, so lag reads as zero for a moment after a replay (hence `CLAIM_SETTLE_MS`). They also only bound us by the *slowest* confirm received, so a player whose confirms are not reaching us makes the gap look smaller than it is.
  - The host's announced presence tick covers that — but only while it is still advancing. The match registry keeps a high-water mark across a rebuild (solo→2 keeps the same matchId), and a latched stale value leaves the client "catching up" for ever. It walks back down on a host restart, and only a live *player* may walk it down, never a lagging spectator reporting its own tick.
- A board rebuild (new `startKey`) kills any claim made against the old board. Holding one left the client attached to a world nobody else was playing, so the pending join is cancelled and the player's intent is re-queued for the rebuilt match.
- Losing a seat race re-queues rather than dropping out, so a player does not have to press the key again every rotation.
- `SLOT_CLAIM` carries the claimer's tick, and the king sizes `joinTick` off the gap between that tick and its own (`joinSpawnTick`). That wire-measured gap is the honest one — the claimer's self-reported lag is measured against confirms that were already stale in flight, so on a relayed mesh it reads far too low.
- The king watches each reserved joiner's first confirm (`JOIN_CONFIRM_GRACE_MS`) and drops one that never arrives through the normal deterministic defeat path.
- A joiner whose reservation dies has to clean up completely (`cancelPendingLocalJoin`). Leaving `pendingLocalJoin` set strands the client for good: the HUD sits on "Claiming…", every reconnect / re-catch-up / re-claim path bails out on `JOINING`, and the stale pending join later promotes it into a seat that no longer exists — a ghost player whose confirms every peer rejects. It also never promotes into a seat the roster no longer reserves for it.
- Withdrawal is announced as a **tickless** `SLOT_DEFEAT`. The withdrawing client's clock may be behind everyone else's, so peers free the quorum slot immediately but only the king turns it into a sim command, on the king's tick.

All of these timeout checks run off timers, not off `onCommit` — a stalled quorum is exactly when commit-driven checks stop firing.

## Promote handoff

When an observer becomes a player:

1. Reassign their downstream children to other sponsors with capacity (prefer same subtree, else any L1).
2. Tear down the old observer↔sponsor link after handoff; join the **player mesh**.
3. Mark self available as an L1 sponsor (capacity 1).
4. Presence updates role / sponsor map so new observers can fill under them.

## Protocol messages (additions)

| Message | Role |
|---------|------|
| `CHECKPOINT_META` | King announces latest checkpoint tip |
| `CHECKPOINT_CHUNK` | Binary/world blob pieces (or JSON chunks) |
| `LEDGER_CHUNK` | Ledger frames after checkpoint tick |
| `SPONSOR_ASSIGN` | King assigns observer → sponsor |
| `SPONSOR_HANDOFF` | Reassign children when a node promotes/leaves |
| `SLOT_OFFER` | Open seat + eligible set + epoch |
| `SLOT_CLAIM` | Opt-in claim from eligible observer |
| `SLOT_OFFER_END` | Seat filled / offer closed |

## Out of scope (for now)

- Ghost avatars, weather, and other observer interaction FX.
- Changing `MAX_SLOTS` or the lockstep player mesh size.
