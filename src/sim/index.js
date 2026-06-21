// sim/ — the pure, deterministic simulation.
//
// HARD PARTITION RULE (the thing v1 never had):
//   Nothing under sim/ may import from render/, app/, ui/, net/, Babylon, or
//   touch the DOM. No Date.now/performance.now. No Math.random.
//   All randomness goes through rng.js; all math goes through fixed.js.
//
// Everything outside sim/ READS sim state and never mutates it directly —
// changes only happen by feeding commands into step().

export * from './fixed.js';
export * from './rng.js';
export * from './world.js';
export * from './unitTypes.js';
export * from './step.js';
export * from './checksum.js';
export * from './commands.js';
export * from './field.js';
export * from './path.js';
export * from './combat.js';
export * from './teams.js';
export * from './ai.js';
