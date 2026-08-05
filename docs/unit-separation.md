# Unit separation knobs

Soft personal space — not hard collision / RVO. Path follow owns position while
navigating; standing sep blooms after arrival; mid-march only shoulder-checks
(and hard-unstacks when nearly glued). Avoid restoring the old ~2.5× spacing
multiplier (idle piles drifted to ~6+ with endless inching).

Contracts / regression: `src/sim/separation.test.js`.

## Feel knobs

| Knob | Where | Current | What it does |
|------|--------|---------|--------------|
| Spacing floor | `src/sim/step.js` (`Math.max(2.9, …)`) | **2.9** | Main settled distance (`minDist` for infantry pairs) |
| `unitFootprint` / `footprint` | `src/sim/unitTypes.js` | size/6 or per-type | Personal radius; vehicles override |
| `SEP_SLACK` | `step.js` | **0.28** | How far short of `minDist` is “good enough” (lower → tighter to target) |
| `SEP_PUSH` | `step.js` | **0.42** | Idle unstack strength (near rim) |
| `SEP_MAX_STEP` | `step.js` | **0.30** | Per-tick idle shove cap (near rim) |
| `SEP_BLOOM_*` | `step.js` | push **0.50** / max **0.45** / frac **0.40** | Deep-pile idle bloom (slack ignored) — kills arrival wave pulse |
| `MOVE_AVOID_PUSH` | `step.js` | **0.22** | Mild mid-march shoulder |
| `MOVE_AVOID_HARD` | `step.js` | **0.38** | Glued mid-march shove (slack ignored) |
| `MOVE_AVOID_HARD_FRAC` | `step.js` | **0.36** | `dist² < frac × minDist²` → hard path (higher → sooner) |
| `MOVE_AVOID_HARD_MAX` | `step.js` | **0.40** | Hard shove per-tick cap |
| Gather jitter | `src/sim/commands.js` | **1.2√n** clamped **2.4–24** | Organic dest scatter on group moves (scales with army size) |
| Group arrive `c√n` | `src/sim/path.js` `groupArriveRadius` | **1.4√n** | Soft gather disk — stay put if already near click (idle packs) |
| `speed` | `unitTypes.js` | per type | Top move speed (fixed) |
| `steer` | `unitTypes.js` (`unitSteer`) | size-scaled; big overrides | Heading blend / tick. Dirigible **0.16**, wagon **0.20**, APC **0.18** |
| `accel` / `decel` | `unitTypes.js` | size-scaled; big overrides | Spool / brake. Dirigible **0.10 / 0.07** (floaty), APC **0.26 / 0.36** |
| Idle coast | `step.js` `coastBrake` | on IDLE / arrive | Order ends without zeroing vel — bleed with `decel` (blimp drifts in) |
| Turn-in-place | `step.js` `TURN_PLACE_DOT` | **0.57** | Face·want below this ⇒ pivot + coast-brake (no hard zero). Alignment also gates top speed |
| Arrival brake | `step.js` final leg only | `√(2·decel·dist)` | Soft stop into the click — not a mid-cruise slam |
| Busy stay-put | `commands.js` | **`FINAL_ARRIVE`** | Mid-order units only cancel within 1.2 (not the huge √n disk) |
| `FINAL_ARRIVE` | `path.js` | **1.2** | Single-unit / waypoint arrive radius |

## Perf knobs (not feel)

| Knob | Where | Current | What it does |
|------|--------|---------|--------------|
| `GRID_SEP_THRESHOLD` | `step.js` | 400 | Below → brute pairs; at/above → spatial grid |
| `SEP_PHASES` | `step.js` | **2** | Grid cells processed every N ticks (was 8 — caused slow arrival ripples) |
| A* budget scale | `path.js` `planPathBudget` | `ceil(pending/2)` up to 128 | Mass-move path backlog drain rate |

## Related (combat, not army packing)

- Melee engagement slots / ranged `preferredRange` — `src/sim/engagement.js`
- Tick order: movement → moving avoidance → standing separation — `step.js`
- Pending-path provisional steer toward `navDest` (even if LOS blocked; wall-slide) — `path.js` `movementGoal`

## Tuning notes

- Biggest lever for settled spacing: **spacing floor**. Stay roughly under ~3.5 to avoid idle chatter.
- Dense mass-move piles: raise gather jitter scale / cap, not parade radius.
- Arrival wave pulse: `SEP_BLOOM_*` + low `SEP_PHASES` (not higher spacing).
- Want less mid-march glue: raise `MOVE_AVOID_HARD*` / `MOVE_AVOID_HARD_FRAC`.
- Do **not** add a row/col formation grid for player moves unless that look is desired.
