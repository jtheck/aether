# Runtime profiling

Start the local server from this directory:

```sh
npm run serve
```

Use a release-like browser with DevTools open:

- Normal solo match: `http://localhost:5173/?solo=1&profileSim=1`
- Five-army stress match (about 5,000 units): `http://localhost:5173/?solo=1&stress=1000&fog=0&profileSim=1`
- Animated render stress: add `?solo=1&animStress=32`

Simulation timing is always opt-in, including stress modes. Add `profileSim=1`
before loading or run `setProfileSim(true)`.

## Console probes

Let the match settle before taking a sample, then run:

```js
dumpFrameProfile(60) // CPU/GPU frame phases, including p50/p95/p99
dumpSimProfile()     // worker and deterministic simulation phase timings
dumpRenderCost()     // current renderer draw/instance cost
dumpPools()          // unit, effect, projectile, and batch pool occupancy
```

`dumpFrameProfile()` reports `perFrameMs` separately from `meanMs`. This matters
for sparse work such as fog uploads: the mean is the cost when it occurs, while
the per-frame value is its amortized cost. `renderer*`, `terrain*`, and
`scenery*` detail rows are nested breakdowns, not additional frame cost.
Renderer pre/post-app CPU timing and GPU timing describe the previously
completed frame. GPU samples may be absent when the browser or graphics backend
does not expose timer queries.

`dumpSimProfile()` is nested. `tick` is all worker work through response-object
construction; `step` is the deterministic simulation body inside it. Individual
simulation phases are inside `step`. Structured cloning and delivery performed
by `postMessage` are not included in worker `tick` timing.

## Input latency

Add one or both URL flags before loading the match:

- `inputLatency=1`, then run `dumpInputLatency()`
- `cameraLatency=1`, then run `dumpCameraLatency()`

The command probe preserves the intentional local input delay used for peer
synchronization. The camera probe measures local pan, rotate, and zoom response.

## Headless scale benchmark

```sh
npm run bench:scale
npm run bench:scale:50k
```

The in-game stress menu is the representative 5,000-unit interactive workload.
The 50,000-unit benchmark is a hardware-sensitive ceiling/acceptance workload,
not a normal match target. Do not rebaseline its 50 ms threshold from a single
machine or browser run.
