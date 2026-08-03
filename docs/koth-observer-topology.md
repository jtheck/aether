# KOTH observer topology

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

## Checkpoints

Long KOTH matches must not force late joiners to replay from tick 0.

- Every ~5 minutes (`CHECKPOINT_INTERVAL_TICKS ≈ 6000` at 20 Hz), live peers build a deterministic **world checkpoint** (full sim state at tick T + checksum).
- King announces `CHECKPOINT_META` (`tick`, `checksum`, size). Sponsors ship checkpoint + ledger **after** that tick to dependents (chunked).
- Catch-up path: `importWorld(checkpoint)` then replay ledger delta to live tip; verify checksum.
- Players may prune committed ledger frames older than the latest checkpoint once dependents have it (or after a grace window).

## Open-slot offers

While `activeCount < 5`, there is always an open-seat offer. **No auto-promotion.**

1. King publishes `SLOT_OFFER` with an `offerEpoch` and eligible user set.
2. Eligible set starts as caught-up **L1** observers (join / catch-up order).
3. Every ~30s (`OFFER_EXPAND_MS`), expand eligibility to the next caught-up observers by join order.
4. Offer does **not** time out; it ends only when someone claims or the match is full again.
5. Eligible observer opts in (J / Enter Match) → `SLOT_CLAIM` → existing join accept / spawn choreography → `SLOT_OFFER_END` for everyone else.
6. First valid claim wins; subsequent claims for that epoch are ignored.

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
