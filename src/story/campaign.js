// Epic campaign — 5 episodes, 19 chapters.
//
// Each chapter is data: table size/shape, chunk holes for giant off-board props,
// water and forest barriers, halls, camps, a couple of cinematic beats, and
// a chain of one-word trigger zones. campaignBuild.js turns an entry into a
// v4 garden; build-campaign.mjs writes maps/<id>.garden.
//
// Coordinates in beats / objectives / camps / dress are FRACTIONS of the board
// (0..1). `hole` carves extra chunks so a keep / volcano / ice wall / sundering
// can sit in the gap and still feel attached to the table.

import { cam, hold, line, narrate } from './reel.js';
import { UNIT } from '../sim/unitTypes.js';

/** @param {string} kind @param {number} fx @param {number} fz @param {number} r */
function obj(kind, fx, fz, r, label, message, opts = {}) {
  return {
    kind,
    fx,
    fz,
    r,
    label: label || '',
    message: message || '',
    terminal: opts.terminal === true,
    next: opts.next || '',
    params: opts.params || null,
  };
}

/** Hostile camp (owner 4). units: [[type, dxTiles, dzTiles], ...]. */
function camp(fx, fz, building, units, clear) {
  return { fx, fz, building, units: units || [], clear };
}

/** Set-dressing building. owner 4 hostile, owner 2 allied. */
function hall(fx, fz, type, owner = 4, yaw = 0) {
  return { fx, fz, type, owner, yaw };
}

const W = UNIT.WARRIOR;
const A = UNIT.ARCHER;
const K = UNIT.WARLOCK;

// ─────────────────────────────────────────────────────────────────────────
// Episode 1 — Escape the Siege (a burning castle / battle / siege)
// Giant keep sits in the north-edge holes; moat and outer woods do the walls.
// ─────────────────────────────────────────────────────────────────────────
const EP1 = {
  n: 1,
  name: 'The Siege',
  theme: 'siege',
  chapters: [
    {
      id: 'e1c1',
      name: 'Breach in the Wall',
      seed: 0x51e6e001,
      chunks: 9,
      shape: 'square',
      // Castle wings off the north rim — giant keep sits in the bite.
      hole: [[0, 0], [1, 0], [7, 0], [8, 0]],
      spawn: { fx: 0.5, fz: 0.86 },
      channel: [[0.04, 0.26, 0.96, 0.26, 3]],
      woods: [[0.14, 0.78, 0.1, 0.86], [0.86, 0.78, 0.1, 0.86]],
      hedge: [[0.08, 0.42, 0.08, 0.72, 3], [0.92, 0.42, 0.92, 0.72, 3]],
      rubble: [[0.5, 0.4, 0.045]],
      camps: [camp(0.5, 0.22, 'camp', [[W, -3, 2], [W, 3, 2], [A, 0, -3]])],
      halls: [
        hall(0.18, 0.48, 'tower'),
        hall(0.82, 0.48, 'tower'),
        hall(0.72, 0.64, 'barracks'),
        hall(0.28, 0.64, 'church'),
      ],
      objectives: [
        obj('reach', 0.22, 0.7, 4, 'here', 'The yard. Catch them if you still can.'),
        obj('defend', 0.5, 0.54, 5, 'hold', 'Buy the others time at the gap.'),
        obj('escape', 0.5, 0.16, 6, 'run', 'The wall is lost. Run.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.35, 190, -2.1, 1.6),
        narrate('The keep is burning. The outer wall has fallen and the enemy pours through the breach.'),
        cam(0.5, 0.8, 80, 0.4, 2.0),
        line('Goblin', 'They\'re through the wall! Everybody up — we do not die here!', 'shout'),
        line('Lady', 'The gatehouse is gone. North, over the rubble!', 'command'),
      ],
      win: [
        cam(0.5, 0.18, 120, -1.9, 1.4),
        line('Stumpey', 'Out. Barely. Keep moving before they regroup.', 'command'),
        hold(1.2),
      ],
    },
    {
      id: 'e1c2',
      name: 'The Sally Port',
      seed: 0x51e6e002,
      chunks: 7,
      shape: 'notched',
      hole: [[0, 1]],
      spawn: { fx: 0.58, fz: 0.86 },
      water: [[0.48, 0.64, 0.05]],
      woods: [[0.82, 0.48, 0.12, 0.88], [0.18, 0.72, 0.08, 0.8]],
      hedge: [[0.7, 0.22, 0.88, 0.55, 3]],
      rubble: [[0.4, 0.48, 0.03]],
      camps: [camp(0.28, 0.46, 'tower', [[A, -2, 2], [A, 2, 2], [W, 0, 3]])],
      halls: [
        hall(0.22, 0.62, 'barracks'),
        hall(0.48, 0.28, 'tower'),
      ],
      objectives: [
        obj('infiltrate', 0.4, 0.52, 5, 'sneak', 'Stay out of the torchlight.'),
        obj('reach', 0.58, 0.36, 4, 'here', 'Past the light. Almost.'),
        obj('escape', 0.7, 0.12, 5, 'run', 'The little door. Nobody watches it.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.45, 200, -1.7, 1.8),
        narrate('A side passage clings to the inner wall — a forgotten sally port, and a way out.'),
        cam(0.4, 0.55, 75, 0.5, 2.0, 'Doc'),
        line('Doc', 'Guards ahead. We go quiet, or we do not go at all.', 'whisper'),
        line('Goblin', 'Quiet is not my strength.', 'normal'),
      ],
      win: [
        cam(0.62, 0.16, 110, -1.6, 1.3),
        line('Lady', 'The door holds. We\'re outside the walls.', 'whisper'),
        hold(1.0),
      ],
    },
    {
      id: 'e1c3',
      name: 'Courtyard Gauntlet',
      seed: 0x51e6e003,
      chunks: 9,
      shape: 'round',
      spawn: { fx: 0.5, fz: 0.86 },
      water: [[0.5, 0.62, 0.045]],
      woods: [[0.12, 0.22, 0.07, 0.8], [0.88, 0.22, 0.07, 0.8]],
      hedge: [[0.1, 0.55, 0.22, 0.82, 3], [0.9, 0.55, 0.78, 0.82, 3]],
      rubble: [[0.5, 0.38, 0.04]],
      camps: [
        camp(0.22, 0.4, 'camp', [[W, -2, 2], [A, 2, 1]]),
        camp(0.78, 0.4, 'camp', [[W, 2, 2], [A, -2, 1]]),
      ],
      halls: [
        hall(0.5, 0.4, 'barracks'),
        hall(0.18, 0.58, 'tower'),
        hall(0.82, 0.58, 'tower'),
      ],
      objectives: [
        obj('reach', 0.5, 0.62, 5, 'here', 'Catch your breath in the open yard.'),
        obj('destroy', 0.5, 0.16, 6, 'kill', 'Wreck it and the gate is ours.', {
          terminal: true,
          params: { building: 'workshop' },
        }),
      ],
      intro: [
        cam(0.5, 0.4, 195, -2.0, 1.6),
        narrate('The great courtyard is a killing floor. The enemy ram waits at the far gate.'),
        cam(0.5, 0.2, 85, -1.9, 2.0),
        line('Stumpey', 'That ram breaks the last gate if we let it. We don\'t let it.', 'command'),
      ],
      win: [
        cam(0.5, 0.2, 110, -1.9, 1.4),
        line('Goblin', 'One dead ram. That felt good.', 'shout'),
        hold(1.0),
      ],
    },
    {
      id: 'e1c4',
      name: 'Over the Moat',
      seed: 0x51e6e004,
      chunksX: 11,
      chunksZ: 5,
      shape: 'corridor',
      // Castle / water mass off the short ends — the board is the bridge.
      hole: [[0, 0], [1, 0], [9, 0], [10, 0]],
      spawn: { fx: 0.1, fz: 0.5 },
      channel: [
        [0.04, 0.12, 0.96, 0.12, 2],
        [0.04, 0.88, 0.96, 0.88, 2],
      ],
      rubble: [[0.48, 0.5, 0.03]],
      camps: [camp(0.52, 0.3, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      halls: [
        hall(0.34, 0.68, 'tower'),
        hall(0.68, 0.32, 'silo'),
      ],
      objectives: [
        obj('reach', 0.38, 0.5, 4, 'here', 'The boards hold. For now.'),
        obj('escort', 0.78, 0.5, 5, 'guard', 'It cannot defend itself — keep it whole.', { params: { escort: 'Wagon' } }),
        obj('escape', 0.92, 0.5, 6, 'run', 'The far bank. Freedom, for now.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.5, 250, 0.0, 1.8),
        narrate('The only way clear is the long bridge across the moat — and the wagon of wounded must cross with you.'),
        cam(0.15, 0.5, 80, 0.2, 2.0, 'Lady'),
        line('Lady', 'The wagon is slow and full of hurt. We do not leave it.', 'command'),
        line('Doc', 'Then we move together, or not at all.', 'normal'),
      ],
      win: [
        cam(0.9, 0.5, 140, 0.1, 1.4),
        line('Stumpey', 'Across. The castle is behind us. All of it.', 'whisper'),
        hold(1.4),
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Episode 2 — Ashfall (a fight near / with a volcano)
// Volcano and fortress sit in carved holes. On-board: ash, crater water, slag.
// ─────────────────────────────────────────────────────────────────────────
const EP2 = {
  n: 2,
  name: 'Ashfall',
  theme: 'volcano',
  chapters: [
    {
      id: 'e2c1',
      name: 'The Cinder Road',
      seed: 0x51e6e011,
      chunksX: 5,
      chunksZ: 11,
      shape: 'corridor',
      // Volcano mass along the west bite.
      hole: [[0, 2], [0, 6], [0, 9]],
      spawn: { fx: 0.52, fz: 0.9 },
      channel: [[0.18, 0.2, 0.18, 0.82, 2], [0.84, 0.12, 0.84, 0.7, 2]],
      rubble: [[0.55, 0.42, 0.035]],
      camps: [camp(0.52, 0.52, 'camp', [[W, -2, 2], [A, 2, 1]])],
      halls: [hall(0.52, 0.28, 'mine')],
      objectives: [
        obj('reach', 0.52, 0.72, 4, 'here', 'Do not stop. The road is melting.'),
        obj('race', 0.52, 0.48, 6, 'run', 'Do not stop. The road is melting.', { params: { seconds: 90 } }),
        obj('escape', 0.52, 0.08, 6, 'go', 'High ground. The flow can\'t follow.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.5, 300, -1.6, 1.8),
        narrate('The mountain has woken. A river of fire chases you up the only road that still stands.'),
        cam(0.5, 0.85, 90, -1.5, 2.0),
        line('Goblin', 'Is the ground supposed to be that colour?!', 'scared'),
        line('Stumpey', 'Run. Explanations later. RUN.', 'shout'),
      ],
      win: [
        cam(0.5, 0.12, 150, -1.5, 1.4),
        line('Doc', 'The ridge holds. The fire pools below us.', 'think'),
        hold(1.2),
      ],
    },
    {
      id: 'e2c2',
      name: 'Emberhold',
      seed: 0x51e6e012,
      chunks: 9,
      shape: 'square',
      reveal: 'all',
      hole: [[1, 0], [2, 0], [6, 0], [7, 0]],
      spawn: { fx: 0.5, fz: 0.86 },
      channel: [[0.08, 0.18, 0.4, 0.18, 2], [0.6, 0.18, 0.92, 0.18, 2]],
      woods: [[0.12, 0.72, 0.08, 0.7], [0.88, 0.7, 0.08, 0.7]],
      rubble: [[0.5, 0.42, 0.04]],
      camps: [
        camp(0.5, 0.28, 'tower', [[A, -3, 1], [A, 3, 1], [W, -1, 3], [W, 1, 3]]),
        camp(0.18, 0.52, 'camp', [[W, 0, 2], [K, 2, 0]]),
      ],
      halls: [
        hall(0.78, 0.48, 'barracks'),
        hall(0.32, 0.36, 'tower'),
        hall(0.68, 0.36, 'tower'),
      ],
      allies: [{ from: [0.28, 0.82], to: [0.5, 0.28], waves: 2, count: 3, delay: 5, interval: 14 }],
      objectives: [
        obj('defend', 0.5, 0.62, 5, 'hold', 'Keep them off the ridge stair.'),
        obj('capture', 0.5, 0.24, 6, 'take', 'Take the keep and hold the height.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.35, 240, -2.0, 1.8),
        narrate('A fortress of black stone squats on the caldera rim — Emberhold, and the cultists who kept the fire.'),
        cam(0.5, 0.75, 90, 0.3, 2.0),
        line('Lady', 'They feed the mountain from that keep. We take it.', 'command'),
      ],
      win: [
        cam(0.5, 0.25, 140, -1.9, 1.5),
        line('Stumpey', 'Emberhold is ours. Now — what were they hiding?', 'think'),
        hold(1.2),
      ],
    },
    {
      id: 'e2c3',
      name: 'The Caldera',
      seed: 0x51e6e013,
      chunks: 11,
      shape: 'round',
      // Mouth of the volcano through the table — giant cone sits in the hole.
      hole: [[5, 5]],
      spawn: { fx: 0.5, fz: 0.88 },
      water: [[0.42, 0.5, 0.055], [0.58, 0.5, 0.055], [0.5, 0.42, 0.04], [0.5, 0.58, 0.04]],
      rubble: [[0.22, 0.28, 0.04], [0.78, 0.28, 0.04]],
      camps: [
        camp(0.22, 0.36, 'camp', [[K, 0, 2], [W, 2, 0]]),
        camp(0.78, 0.36, 'camp', [[K, 0, 2], [W, -2, 0]]),
      ],
      halls: [
        hall(0.18, 0.62, 'tower'),
        hall(0.82, 0.62, 'tower'),
      ],
      objectives: [
        obj('survive', 0.5, 0.72, 6, 'last', 'Stay alive while the vent overloads.', { params: { waves: 3 } }),
        obj('destroy', 0.5, 0.26, 6, 'kill', 'Collapse it and the mountain sleeps.', {
          terminal: true,
          params: { building: 'factory' },
        }),
      ],
      intro: [
        cam(0.5, 0.45, 250, -1.9, 1.6),
        narrate('Inside the caldera the air shimmers. A single vent breathes the fire that fuels it all.'),
        cam(0.5, 0.32, 95, -1.8, 2.0, 'Doc'),
        line('Doc', 'Seal that vent and the eruption chokes. But it will fight us.', 'think'),
        line('Goblin', 'Everything fights us. Let\'s go.', 'normal'),
      ],
      win: [
        cam(0.5, 0.32, 150, -1.8, 1.6),
        line('Lady', 'It\'s closing. The roar is dying.', 'whisper'),
        hold(1.6),
      ],
    },
    {
      id: 'e2c4',
      name: 'Rivers of Fire',
      seed: 0x51e6e014,
      chunks: 9,
      shape: 'wedge',
      spawn: { fx: 0.18, fz: 0.86 },
      channel: [
        [0.08, 0.28, 0.72, 0.22, 2],
        [0.22, 0.62, 0.78, 0.48, 2],
      ],
      woods: [[0.12, 0.48, 0.07, 0.65]],
      rubble: [[0.58, 0.38, 0.035]],
      camps: [camp(0.58, 0.44, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      halls: [
        hall(0.32, 0.32, 'mine'),
        hall(0.7, 0.58, 'silo'),
      ],
      objectives: [
        obj('reach', 0.32, 0.64, 4, 'here', 'The sacred coals must not go cold.'),
        obj('gather', 0.68, 0.36, 5, 'take', 'The sacred coals must not go cold.', { params: { count: 3 } }),
        obj('escape', 0.86, 0.12, 6, 'run', 'Off the mountain, embers and all.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.5, 240, -1.7, 1.8),
        narrate('Molten channels split the slope. Somewhere in the heat wait the last living embers of the old faith.'),
        cam(0.25, 0.8, 85, 0.4, 2.0, 'Lady'),
        line('Lady', 'Those coals are older than the kingdom. We carry them out.', 'command'),
      ],
      win: [
        cam(0.85, 0.16, 150, -1.6, 1.4),
        line('Stumpey', 'Embers safe. The mountain behind us. On to the cold.', 'normal'),
        hold(1.2),
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Episode 3 — The Ice Wall (a chase along a wall of ice)
// Ice wall is a giant prop in the west holes. On-board: melt water, pine hedges.
// ─────────────────────────────────────────────────────────────────────────
const EP3 = {
  n: 3,
  name: 'The Ice Wall',
  theme: 'ice',
  chapters: [
    {
      id: 'e3c1',
      name: 'First Frost',
      seed: 0x51e6e021,
      chunksX: 5,
      chunksZ: 11,
      shape: 'corridor',
      hole: [[0, 1], [0, 5], [0, 9]],
      spawn: { fx: 0.58, fz: 0.9 },
      water: [[0.28, 0.38, 0.055], [0.72, 0.62, 0.05]],
      woods: [[0.78, 0.28, 0.07, 0.8], [0.78, 0.78, 0.07, 0.8]],
      hedge: [[0.78, 0.18, 0.78, 0.88, 2]],
      camps: [camp(0.52, 0.5, 'camp', [[A, -2, 1], [W, 2, 1]])],
      halls: [hall(0.52, 0.28, 'tower')],
      objectives: [
        obj('infiltrate', 0.52, 0.55, 5, 'sneak', 'Hunters walk the wall. Do not be seen.'),
        obj('escape', 0.52, 0.1, 6, 'run', 'A cleeward hollow. Warmth, and a moment.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.5, 260, -1.6, 1.8),
        narrate('A wall of blue ice runs to both horizons. Along its foot, something is already hunting you.'),
        cam(0.5, 0.85, 88, -1.5, 2.0),
        line('Goblin', 'Footprints. Not ours. Fresh.', 'whisper'),
        line('Doc', 'We are the prey now. Move soft.', 'whisper'),
      ],
      win: [
        cam(0.5, 0.14, 150, -1.5, 1.3),
        line('Lady', 'Shelter. Rest — but not long.', 'whisper'),
        hold(1.0),
      ],
    },
    {
      id: 'e3c2',
      name: 'The Long Chase',
      seed: 0x51e6e022,
      chunksX: 5,
      chunksZ: 13,
      shape: 'corridor',
      hole: [[0, 2], [0, 6], [0, 10]],
      spawn: { fx: 0.58, fz: 0.94 },
      water: [[0.28, 0.22, 0.04], [0.72, 0.48, 0.04], [0.28, 0.72, 0.04]],
      hedge: [[0.8, 0.1, 0.8, 0.9, 3]],
      woods: [[0.8, 0.35, 0.08, 0.85], [0.8, 0.7, 0.08, 0.85]],
      camps: [
        camp(0.5, 0.7, 'camp', [[W, -2, 1], [A, 2, 1]]),
        camp(0.5, 0.4, 'camp', [[W, -2, 1], [A, 2, 1]]),
      ],
      halls: [hall(0.5, 0.22, 'tower')],
      objectives: [
        obj('reach', 0.52, 0.8, 4, 'here', 'They come in packs. Keep the line.'),
        obj('survive', 0.52, 0.58, 6, 'last', 'They come in packs. Keep the line.', {
          params: { waves: 4, route: [[0.52, 0.14], [0.52, 0.32], [0.52, 0.5]] },
        }),
        obj('escape', 0.52, 0.06, 6, 'run', 'A break in the ice. Through it and gone.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.5, 340, -1.6, 1.8),
        narrate('The wall never ends and neither does the chase. Wave after wave breaks against your rear guard.'),
        cam(0.5, 0.9, 90, -1.5, 2.0, 'Goblin'),
        line('Goblin', 'They just keep coming!', 'shout'),
        line('Stumpey', 'Then we just keep running. Hold the back, get to the gap!', 'command'),
      ],
      win: [
        cam(0.5, 0.1, 150, -1.5, 1.4),
        line('Doc', 'The gap. We\'re through — leave them the cold.', 'think'),
        hold(1.4),
      ],
    },
    {
      id: 'e3c3',
      name: 'Crevasse',
      seed: 0x51e6e023,
      chunks: 9,
      shape: 'notched',
      spawn: { fx: 0.5, fz: 0.86 },
      channel: [[0.08, 0.42, 0.92, 0.42, 3]],
      woods: [[0.16, 0.7, 0.08, 0.8], [0.84, 0.7, 0.08, 0.8]],
      rubble: [[0.5, 0.55, 0.03]],
      camps: [camp(0.5, 0.32, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      halls: [hall(0.22, 0.55, 'tower'), hall(0.78, 0.55, 'tower')],
      objectives: [
        obj('choice', 0.28, 0.55, 4, 'pick', 'The narrow ledge, or cut the rope bridge behind you.', {
          params: { branches: ['ledge', 'bridge'], branch: 'ledge' },
        }),
        obj('choice', 0.72, 0.55, 4, 'pick', 'The narrow ledge, or cut the rope bridge behind you.', {
          params: { branches: ['ledge', 'bridge'], branch: 'bridge' },
        }),
        obj('escape', 0.5, 0.14, 6, 'run', 'Across the crevasse, whatever it cost.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.45, 240, -1.7, 1.8),
        narrate('A crevasse splits the ice. One ledge, one failing bridge, and hunters at your heels.'),
        cam(0.5, 0.55, 90, 0.3, 2.4, 'Lady'),
        line('Lady', 'If we cut the bridge, they can\'t follow. But someone has to be last across.', 'think'),
        line('Stumpey', 'Then we choose, and we choose fast.', 'command'),
      ],
      win: [
        cam(0.5, 0.18, 150, -1.6, 1.4),
        line('Doc', 'The far rim. What\'s done is done.', 'whisper'),
        hold(1.4),
      ],
    },
    {
      id: 'e3c4',
      name: 'The Breaking Shelf',
      seed: 0x51e6e024,
      chunksX: 11,
      chunksZ: 5,
      shape: 'corridor',
      // Calved ice off the south edge.
      hole: [[1, 4], [3, 4], [7, 4], [9, 4]],
      spawn: { fx: 0.1, fz: 0.5 },
      channel: [[0.08, 0.86, 0.92, 0.86, 2]],
      woods: [[0.22, 0.22, 0.06, 0.7], [0.72, 0.22, 0.06, 0.7]],
      camps: [camp(0.55, 0.38, 'camp', [[W, -2, 1], [A, 2, 1]])],
      halls: [hall(0.38, 0.32, 'tower')],
      objectives: [
        obj('race', 0.48, 0.5, 6, 'run', 'The shelf is calving behind you.', { params: { seconds: 75 } }),
        obj('escape', 0.92, 0.5, 6, 'here', 'Off the ice. Onto stone at last.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.5, 300, 0.0, 1.8),
        narrate('The whole shelf groans and begins to break apart. The exit is the far edge — if it\'s still there when you arrive.'),
        cam(0.14, 0.5, 88, 0.2, 2.0),
        line('Goblin', 'It\'s breaking! GO!', 'shout'),
      ],
      win: [
        cam(0.92, 0.5, 150, 0.1, 1.4),
        line('Stumpey', 'Stone. Blessed, solid stone. The wall is behind us.', 'normal'),
        hold(1.2),
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Episode 4 — Muster (great war preparations)
// Open field, thick woods as the walls, a stream, real halls for the camp.
// ─────────────────────────────────────────────────────────────────────────
const EP4 = {
  n: 4,
  name: 'Muster',
  theme: 'muster',
  chapters: [
    {
      id: 'e4c1',
      name: 'The War Camp',
      seed: 0x51e6e031,
      chunks: 11,
      shape: 'square',
      hole: [[0, 0], [10, 0]],
      spawn: { fx: 0.5, fz: 0.82 },
      channel: [[0.04, 0.18, 0.96, 0.18, 2]],
      woods: [
        [0.14, 0.28, 0.12, 0.88],
        [0.86, 0.3, 0.12, 0.88],
        [0.22, 0.78, 0.09, 0.82],
        [0.78, 0.8, 0.09, 0.82],
      ],
      hedge: [[0.08, 0.45, 0.22, 0.7, 3], [0.92, 0.45, 0.78, 0.7, 3]],
      camps: [camp(0.5, 0.22, 'camp', [[W, -3, 2], [W, 3, 2], [A, 0, -3]])],
      halls: [
        hall(0.42, 0.55, 'camp', 2),
        hall(0.58, 0.55, 'barracks', 2),
        hall(0.38, 0.68, 'farm', 2),
        hall(0.62, 0.68, 'silo', 2),
        hall(0.5, 0.42, 'tavern', 2),
      ],
      allies: [{ from: [0.28, 0.82], to: [0.5, 0.24], waves: 2, count: 3, delay: 8, interval: 14 }],
      objectives: [
        obj('build', 0.5, 0.56, 6, 'here', 'Wall the camp before nightfall.'),
        obj('defend', 0.5, 0.4, 7, 'hold', 'Break the raid and the camp stands.', {
          terminal: true,
          params: { waves: 3, route: [[0.5, 0.1], [0.5, 0.22], [0.5, 0.32]] },
        }),
      ],
      intro: [
        cam(0.5, 0.45, 320, -2.0, 1.8),
        narrate('At last, allies. A war camp rises on the plain — but the enemy would strangle it in the cradle.'),
        cam(0.5, 0.72, 95, 0.3, 2.2),
        line('Stumpey', 'No more running. Here we build, and here we stand.', 'command'),
        line('Lady', 'Walls first. Then we bloody their nose.', 'normal'),
      ],
      win: [
        cam(0.5, 0.4, 160, -1.9, 1.6),
        line('Goblin', 'Camp\'s holding. Feels strange, winning ground instead of losing it.', 'normal'),
        hold(1.2),
      ],
    },
    {
      id: 'e4c2',
      name: 'Forge and Field',
      seed: 0x51e6e032,
      chunks: 11,
      shape: 'round',
      spawn: { fx: 0.5, fz: 0.82 },
      channel: [[0.12, 0.62, 0.38, 0.22, 2]],
      woods: [
        [0.16, 0.28, 0.11, 0.86],
        [0.82, 0.22, 0.1, 0.84],
        [0.78, 0.72, 0.1, 0.8],
      ],
      rubble: [[0.28, 0.4, 0.05]],
      camps: [camp(0.76, 0.4, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      halls: [
        hall(0.5, 0.36, 'workshop', 2),
        hall(0.28, 0.42, 'mine', 2),
        hall(0.62, 0.5, 'barracks', 2),
      ],
      objectives: [
        obj('gather', 0.28, 0.4, 6, 'take', 'An army marches on its supply.', { params: { count: 4 } }),
        obj('build', 0.5, 0.35, 6, 'build', 'Light the forge and arm the muster.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.45, 320, -1.9, 1.8),
        narrate('Steel wins wars as surely as courage. The forge must be built, and fed.'),
        cam(0.32, 0.45, 95, 0.4, 2.0, 'Doc'),
        line('Doc', 'Ore from the ridge, timber from the wood. Then we forge.', 'think'),
      ],
      win: [
        cam(0.5, 0.35, 160, -1.9, 1.5),
        line('Lady', 'The forge is lit. Now we have teeth.', 'normal'),
        hold(1.2),
      ],
    },
    {
      id: 'e4c3',
      name: 'The Alliance',
      seed: 0x51e6e033,
      chunks: 11,
      shape: 'notched',
      spawn: { fx: 0.52, fz: 0.86 },
      water: [[0.48, 0.42, 0.055]],
      woods: [
        [0.16, 0.22, 0.1, 0.86],
        [0.84, 0.55, 0.11, 0.86],
        [0.22, 0.72, 0.09, 0.8],
      ],
      camps: [camp(0.26, 0.38, 'camp', [[W, 0, 2], [K, 2, 0]])],
      halls: [
        hall(0.52, 0.58, 'tavern'),
        hall(0.7, 0.32, 'camp'),
        hall(0.38, 0.28, 'church'),
      ],
      objectives: [
        obj('choice', 0.42, 0.6, 5, 'ask', 'Bargain, or take the banner by force.', {
          params: { branches: ['parley', 'seize'], branch: 'parley' },
        }),
        obj('choice', 0.62, 0.48, 5, 'take', 'Bargain, or take the banner by force.', {
          params: { branches: ['parley', 'seize'], branch: 'seize' },
        }),
        obj('capture', 0.72, 0.28, 6, 'take', 'With their banner, their spears are ours.', { terminal: true }),
      ],
      intro: [
        cam(0.5, 0.45, 320, -1.8, 1.8),
        narrate('The hill clans hold the balance. Their banner would double the muster — if they can be won.'),
        cam(0.5, 0.6, 95, 0.3, 2.4, 'Stumpey'),
        line('Stumpey', 'We can ask for their banner. Or we can take it. I\'d rather ask.', 'think'),
        line('Goblin', 'Asking\'s cheaper. Usually.', 'normal'),
      ],
      win: [
        cam(0.7, 0.3, 160, -1.8, 1.5),
        line('Lady', 'The banner flies with ours. The alliance holds.', 'normal'),
        hold(1.2),
      ],
    },
    {
      id: 'e4c4',
      name: 'Eve of Battle',
      seed: 0x51e6e034,
      chunks: 11,
      shape: 'square',
      spawn: { fx: 0.5, fz: 0.82 },
      channel: [[0.18, 0.42, 0.82, 0.42, 2]],
      woods: [
        [0.12, 0.14, 0.1, 0.86],
        [0.88, 0.14, 0.1, 0.86],
        [0.14, 0.78, 0.09, 0.82],
        [0.86, 0.78, 0.09, 0.82],
      ],
      camps: [
        camp(0.28, 0.28, 'tower', [[A, -2, 1], [A, 2, 1]]),
        camp(0.72, 0.28, 'tower', [[A, -2, 1], [A, 2, 1]]),
      ],
      halls: [
        hall(0.5, 0.5, 'barracks', 2),
        hall(0.42, 0.62, 'church', 2),
        hall(0.58, 0.62, 'tavern', 2),
      ],
      objectives: [
        obj('control', 0.5, 0.5, 6, 'hold', 'Keep the muster gate through the night.'),
        obj('defend', 0.5, 0.34, 7, 'last', 'Last till dawn and the army marches whole.', {
          terminal: true,
          params: { waves: 5, route: [[0.12, 0.12], [0.32, 0.26]] },
        }),
      ],
      intro: [
        cam(0.5, 0.45, 320, -2.0, 1.8),
        narrate('The last night before the march. The enemy tries one desperate raid to break the muster before it moves.'),
        cam(0.5, 0.72, 95, 0.3, 2.2),
        line('Doc', 'They know what dawn brings. They\'ll spend everything tonight.', 'think'),
        line('Stumpey', 'Then we spend the night killing raids. Hold the gate!', 'command'),
      ],
      win: [
        cam(0.5, 0.35, 170, -1.9, 1.6),
        line('Lady', 'Dawn. We held. The army marches.', 'whisper'),
        hold(1.6),
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Episode 5 — Cataclysm (the final, world-ending battle)
// Sundering / dark heart as giant props in punched holes. Burned woods, wound water.
// ─────────────────────────────────────────────────────────────────────────
const EP5 = {
  n: 5,
  name: 'Cataclysm',
  theme: 'cataclysm',
  chapters: [
    {
      id: 'e5c1',
      name: 'The Black Tide',
      seed: 0x51e6e041,
      chunks: 13,
      shape: 'square',
      reveal: 'all',
      hole: [[4, 0], [5, 0], [7, 0], [8, 0]],
      spawn: { fx: 0.5, fz: 0.84 },
      woods: [
        [0.1, 0.55, 0.09, 0.72],
        [0.9, 0.55, 0.09, 0.72],
        [0.16, 0.82, 0.08, 0.7],
        [0.84, 0.82, 0.08, 0.7],
      ],
      rubble: [[0.5, 0.38, 0.05]],
      camps: [
        camp(0.28, 0.26, 'camp', [[W, -2, 2], [A, 2, 1]]),
        camp(0.72, 0.26, 'camp', [[W, 2, 2], [A, -2, 1]]),
        camp(0.36, 0.16, 'tower', [[A, -2, 1], [A, 2, 1]]),
        camp(0.64, 0.16, 'tower', [[A, -2, 1], [A, 2, 1]]),
      ],
      halls: [
        hall(0.18, 0.42, 'tower'),
        hall(0.82, 0.42, 'tower'),
        hall(0.5, 0.48, 'barracks', 2),
      ],
      allies: [{ from: [0.3, 0.86], to: [0.5, 0.32], waves: 3, count: 4, delay: 6, interval: 12 }],
      objectives: [
        obj('reach', 0.5, 0.68, 5, 'here', 'The horde comes in waves without end.'),
        obj('defend', 0.5, 0.52, 7, 'hold', 'The horde comes in waves without end.', {
          params: { waves: 6, route: [[0.5, 0.08], [0.5, 0.28], [0.5, 0.42]] },
        }),
        obj('destroy', 0.5, 0.22, 7, 'kill', 'Kill the thing that leads them and the tide breaks.', {
          terminal: true,
          params: { building: 'factory' },
        }),
      ],
      intro: [
        cam(0.5, 0.45, 380, -2.0, 1.8),
        narrate('The horizon is black with them. At its head walks a beast the size of a keep.'),
        cam(0.5, 0.28, 110, -1.9, 2.2),
        line('Goblin', 'That is not an army. That is the end of the world.', 'scared'),
        line('Stumpey', 'Then we end it first. For the beast — everyone, on me!', 'shout'),
      ],
      win: [
        cam(0.5, 0.25, 180, -1.9, 1.6),
        line('Lady', 'The beast falls. The tide falters — but only for a breath.', 'think'),
        hold(1.6),
      ],
    },
    {
      id: 'e5c2',
      name: 'The Sundering',
      seed: 0x51e6e042,
      chunks: 13,
      shape: 'notched',
      reveal: 'all',
      // Tear in the world — relic walks around the hole.
      hole: [[6, 6], [6, 5]],
      spawn: { fx: 0.5, fz: 0.86 },
      water: [[0.5, 0.48, 0.07], [0.42, 0.52, 0.05], [0.58, 0.52, 0.05]],
      woods: [[0.12, 0.22, 0.08, 0.72], [0.88, 0.22, 0.08, 0.72]],
      camps: [
        camp(0.22, 0.4, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]]),
        camp(0.78, 0.4, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]]),
      ],
      halls: [
        hall(0.28, 0.52, 'moonwell', 2),
        hall(0.72, 0.52, 'moonwell', 2),
        hall(0.5, 0.28, 'church'),
      ],
      allies: [{ from: [0.5, 0.86], to: [0.5, 0.34], waves: 2, count: 4, delay: 6, interval: 14 }],
      objectives: [
        obj('control', 0.26, 0.52, 5, 'hold', 'One of three anchors of the seal.'),
        obj('control', 0.74, 0.52, 5, 'hold', 'One of three anchors of the seal.'),
        obj('escort', 0.5, 0.28, 6, 'guard', 'Only the relic can close the sundering.', {
          terminal: true,
          params: { escort: 'Relic' },
        }),
      ],
      intro: [
        cam(0.5, 0.45, 380, -1.9, 1.8),
        narrate('The sky is tearing open. Three wards must hold while the relic is carried to the wound in the world.'),
        cam(0.5, 0.3, 110, -1.8, 2.4, 'Doc'),
        line('Doc', 'Hold the wards. Get the relic to the center. Everything depends on both.', 'command'),
      ],
      win: [
        cam(0.5, 0.3, 180, -1.8, 1.6),
        line('Stumpey', 'The relic\'s in place. The tear... it\'s slowing.', 'whisper'),
        hold(1.6),
      ],
    },
    {
      id: 'e5c3',
      name: 'The Last Light',
      seed: 0x51e6e043,
      chunks: 13,
      shape: 'round',
      reveal: 'all',
      hole: [[5, 3], [7, 3]],
      spawn: { fx: 0.5, fz: 0.88 },
      water: [[0.5, 0.28, 0.06]],
      woods: [
        [0.14, 0.62, 0.09, 0.75],
        [0.86, 0.62, 0.09, 0.75],
      ],
      rubble: [[0.5, 0.48, 0.05]],
      camps: [
        camp(0.28, 0.34, 'camp', [[K, 0, 2], [W, 2, 0]]),
        camp(0.72, 0.34, 'camp', [[K, 0, 2], [W, -2, 0]]),
        camp(0.5, 0.2, 'tower', [[A, -3, 1], [A, 3, 1], [K, 0, 2]]),
      ],
      halls: [
        hall(0.38, 0.58, 'church', 2),
        hall(0.62, 0.58, 'moonwell', 2),
        hall(0.18, 0.48, 'tower'),
        hall(0.82, 0.48, 'tower'),
      ],
      objectives: [
        obj('survive', 0.5, 0.62, 7, 'here', 'Hold the ring while the light gathers.', { params: { waves: 8 } }),
        obj('destroy', 0.5, 0.28, 7, 'end', 'End it here. There is no next road.', {
          terminal: true,
          params: { building: 'church' },
        }),
      ],
      intro: [
        cam(0.5, 0.45, 380, -2.0, 1.8),
        narrate('At the center of everything beats a dark heart. Around it, the last of the light — and the last of you.'),
        cam(0.5, 0.3, 110, -1.9, 2.4),
        line('Lady', 'Whatever happens now, we finish it together.', 'whisper'),
        line('Stumpey', 'Together. For the heart. One last time.', 'command'),
      ],
      win: [
        cam(0.5, 0.3, 200, -1.9, 2.0),
        line('Doc', 'It\'s... over. The dark is gone.', 'whisper'),
        narrate('The heart shatters into a thousand points of light, and the world holds its breath — then breathes.'),
        hold(2.4),
      ],
    },
  ],
};

/** Ordered episodes with their chapter defs. */
export const EPISODES = [EP1, EP2, EP3, EP4, EP5];

/** Served path for a campaign chapter garden. */
export function campaignGardenUrl(id) {
  return `/maps/${id}.garden`;
}

/** Flat, ordered chapter list with resolved next-chapter chaining. */
export const CAMPAIGN_CHAPTERS = (() => {
  const flat = [];
  for (const ep of EPISODES) {
    ep.chapters.forEach((def, idx) => {
      // Stamp episode context onto the def so the builder can theme terrain and
      // pick the right enemy roster (casters ramp in by episode).
      def.theme = ep.theme;
      def.episode = ep.n;
      flat.push({ def, episode: ep.n, episodeName: ep.name, theme: ep.theme, indexInEpisode: idx + 1 });
    });
  }
  for (let i = 0; i < flat.length; i++) {
    flat[i].id = flat[i].def.id;
    flat[i].name = flat[i].def.name;
    flat[i].url = campaignGardenUrl(flat[i].def.id);
    flat[i].nextUrl = i + 1 < flat.length ? campaignGardenUrl(flat[i + 1].def.id) : '';
  }
  return flat;
})();

/** Menu-facing catalog rows: `{ id, name, garden, episode }`. */
export const CHAPTER_CATALOG = CAMPAIGN_CHAPTERS.map((c) => ({
  id: c.id,
  name: `E${c.episode}·${c.indexInEpisode} ${c.name}`,
  garden: c.url,
  episode: c.episode,
  episodeName: c.episodeName,
}));
