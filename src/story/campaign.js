// Epic campaign scaffold — 5 episodes, 19 chapters.
//
// This is the "where to put what" blueprint: each chapter is pure data —
// board size/shape, a couple of cinematic beats, and a small mix of objectives.
// The generic builder (campaignBuild.js) turns each entry into a v4 garden;
// the generation script writes them to maps/<id>.garden.
//
// Coordinates in beats / objectives / camps are FRACTIONS of the board (0..1);
// the builder resolves them to tiles, so a chapter can change size without
// re-authoring positions. Objective kinds beyond reach/escape/advance are
// authored intents today (they behave as reach-zones) — real triggers get
// wired in per kind as we dial the campaign in.

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

const W = UNIT.WARRIOR;
const A = UNIT.ARCHER;
const K = UNIT.WARLOCK;

// ─────────────────────────────────────────────────────────────────────────
// Episode 1 — Escape the Siege (a burning castle / battle / siege)
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
      chunks: 7,
      shape: 'square',
      spawn: { fx: 0.5, fz: 0.85 },
      camps: [camp(0.5, 0.2, 'camp', [[W, -3, 2], [W, 3, 2], [A, 0, -3]])],
      objectives: [
        obj('defend', 0.5, 0.62, 5, 'Hold the breach', 'Buy the others time at the gap.'),
        obj('escape', 0.5, 0.12, 6, 'Flee the burning keep (EXIT)', 'The wall is lost. Run.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.85 },
      camps: [camp(0.32, 0.45, 'tower', [[A, -2, 2], [A, 2, 2], [W, 0, 3]])],
      objectives: [
        obj('infiltrate', 0.5, 0.5, 5, 'Slip past the patrol', 'Stay out of the torchlight.'),
        obj('escape', 0.62, 0.12, 5, 'Reach the sally port (EXIT)', 'The little door. Nobody watches it.', { terminal: true }),
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
      chunks: 7,
      shape: 'round',
      spawn: { fx: 0.5, fz: 0.85 },
      camps: [
        camp(0.28, 0.4, 'camp', [[W, -2, 2], [A, 2, 1]]),
        camp(0.72, 0.4, 'camp', [[W, 2, 2], [A, -2, 1]]),
      ],
      objectives: [
        obj('reach', 0.5, 0.6, 5, 'Regroup at the well', 'Catch your breath in the open yard.'),
        obj('destroy', 0.5, 0.18, 6, 'Sabotage the siege ram (EXIT)', 'Wreck it and the gate is ours.', { terminal: true }),
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
      chunksX: 9,
      chunksZ: 5,
      shape: 'corridor',
      spawn: { fx: 0.12, fz: 0.5 },
      camps: [camp(0.55, 0.3, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      objectives: [
        obj('escort', 0.5, 0.5, 5, 'Protect the wounded wagon', 'It cannot defend itself — keep it whole.'),
        obj('escape', 0.9, 0.5, 6, 'Cross the moat bridge (EXIT)', 'The far bank. Freedom, for now.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.9 },
      camps: [camp(0.5, 0.55, 'camp', [[W, -2, 2], [A, 2, 1]])],
      objectives: [
        obj('race', 0.5, 0.5, 6, 'Outrun the lava flow', 'Do not stop. The road is melting.', { params: { seconds: 90 } }),
        obj('escape', 0.5, 0.08, 6, 'Reach the high ridge (EXIT)', 'High ground. The flow can\'t follow.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.85 },
      camps: [
        camp(0.5, 0.3, 'tower', [[A, -3, 1], [A, 3, 1], [W, -1, 3], [W, 1, 3]]),
        camp(0.2, 0.55, 'camp', [[W, 0, 2], [K, 2, 0]]),
      ],
      objectives: [
        obj('defend', 0.5, 0.62, 5, 'Screen the approach', 'Keep them off the ridge stair.'),
        obj('capture', 0.5, 0.25, 6, 'Seize Emberhold (EXIT)', 'Take the keep and hold the height.', { terminal: true }),
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
      chunks: 9,
      shape: 'round',
      spawn: { fx: 0.5, fz: 0.86 },
      camps: [
        camp(0.3, 0.35, 'camp', [[K, 0, 2], [W, 2, 0]]),
        camp(0.7, 0.35, 'camp', [[K, 0, 2], [W, -2, 0]]),
      ],
      objectives: [
        obj('survive', 0.5, 0.6, 6, 'Hold until it blows', 'Stay alive while the vent overloads.', { params: { waves: 3 } }),
        obj('destroy', 0.5, 0.3, 6, 'Seal the fire vent (EXIT)', 'Collapse it and the mountain sleeps.', { terminal: true }),
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
      spawn: { fx: 0.2, fz: 0.85 },
      camps: [camp(0.6, 0.45, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      objectives: [
        obj('gather', 0.7, 0.35, 5, 'Carry out the living embers', 'The sacred coals must not go cold.', { params: { count: 3 } }),
        obj('escape', 0.85, 0.12, 6, 'Escape down the ash slope (EXIT)', 'Off the mountain, embers and all.', { terminal: true }),
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
      chunksZ: 9,
      shape: 'corridor',
      spawn: { fx: 0.5, fz: 0.9 },
      camps: [camp(0.5, 0.5, 'camp', [[A, -2, 1], [W, 2, 1]])],
      objectives: [
        obj('infiltrate', 0.5, 0.55, 5, 'Cross the watched ice', 'Hunters walk the wall. Do not be seen.'),
        obj('escape', 0.5, 0.1, 6, 'Reach the ice shelter (EXIT)', 'A cleeward hollow. Warmth, and a moment.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.94 },
      camps: [
        camp(0.5, 0.7, 'camp', [[W, -2, 1], [A, 2, 1]]),
        camp(0.5, 0.4, 'camp', [[W, -2, 1], [A, 2, 1]]),
      ],
      objectives: [
        obj('survive', 0.5, 0.6, 6, 'Outlast the hunters', 'They come in packs. Keep the line.', { params: { waves: 4 } }),
        obj('escape', 0.5, 0.06, 6, 'Reach the gap in the wall (EXIT)', 'A break in the ice. Through it and gone.', { terminal: true }),
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
      camps: [camp(0.5, 0.35, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      objectives: [
        obj('choice', 0.5, 0.55, 5, 'Choose a crossing', 'The narrow ledge, or cut the rope bridge behind you.', { params: { branches: ['ledge', 'bridge'] } }),
        obj('escape', 0.5, 0.15, 6, 'Reach the far rim (EXIT)', 'Across the crevasse, whatever it cost.', { terminal: true }),
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
      spawn: { fx: 0.1, fz: 0.5 },
      camps: [camp(0.55, 0.4, 'camp', [[W, -2, 1], [A, 2, 1]])],
      objectives: [
        obj('race', 0.5, 0.5, 6, 'Beat the collapse', 'The shelf is calving behind you.', { params: { seconds: 75 } }),
        obj('escape', 0.92, 0.5, 6, 'Reach solid ground (EXIT)', 'Off the ice. Onto stone at last.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.8 },
      camps: [camp(0.5, 0.25, 'camp', [[W, -3, 2], [W, 3, 2], [A, 0, -3]])],
      objectives: [
        obj('build', 0.5, 0.55, 6, 'Raise the palisade', 'Wall the camp before nightfall.'),
        obj('defend', 0.5, 0.4, 7, 'Hold the muster ground (EXIT)', 'Break the raid and the camp stands.', { terminal: true, params: { waves: 3 } }),
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
      camps: [camp(0.75, 0.4, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]])],
      objectives: [
        obj('gather', 0.3, 0.4, 6, 'Stockpile stone and steel', 'An army marches on its supply.', { params: { count: 4 } }),
        obj('build', 0.5, 0.35, 6, 'Raise the war forge (EXIT)', 'Light the forge and arm the muster.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.85 },
      camps: [camp(0.28, 0.4, 'camp', [[W, 0, 2], [K, 2, 0]])],
      objectives: [
        obj('choice', 0.5, 0.6, 6, 'Treat with the clans', 'Bargain, or take the banner by force.', { params: { branches: ['parley', 'seize'] } }),
        obj('capture', 0.7, 0.3, 6, 'Win the clan banner (EXIT)', 'With their banner, their spears are ours.', { terminal: true }),
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
      camps: [
        camp(0.3, 0.3, 'tower', [[A, -2, 1], [A, 2, 1]]),
        camp(0.7, 0.3, 'tower', [[A, -2, 1], [A, 2, 1]]),
      ],
      objectives: [
        obj('control', 0.5, 0.5, 6, 'Hold the war gate', 'Keep the muster gate through the night.'),
        obj('defend', 0.5, 0.35, 7, 'Survive the night raid (EXIT)', 'Last till dawn and the army marches whole.', { terminal: true, params: { waves: 5 } }),
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
      spawn: { fx: 0.5, fz: 0.82 },
      camps: [
        camp(0.3, 0.28, 'camp', [[W, -2, 2], [A, 2, 1]]),
        camp(0.7, 0.28, 'camp', [[W, 2, 2], [A, -2, 1]]),
        camp(0.5, 0.2, 'tower', [[A, -3, 1], [A, 3, 1]]),
      ],
      objectives: [
        obj('defend', 0.5, 0.55, 7, 'Break the black tide', 'The horde comes in waves without end.', { params: { waves: 6 } }),
        obj('destroy', 0.5, 0.25, 7, 'Fell the siege beast (EXIT)', 'Kill the thing that leads them and the tide breaks.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.85 },
      camps: [
        camp(0.25, 0.4, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]]),
        camp(0.75, 0.4, 'tower', [[A, -2, 1], [A, 2, 1], [W, 0, 3]]),
      ],
      objectives: [
        obj('control', 0.28, 0.5, 5, 'Hold the west ward', 'One of three anchors of the seal.'),
        obj('control', 0.72, 0.5, 5, 'Hold the east ward', 'One of three anchors of the seal.'),
        obj('escort', 0.5, 0.3, 6, 'Carry the relic to the center (EXIT)', 'Only the relic can close the sundering.', { terminal: true }),
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
      spawn: { fx: 0.5, fz: 0.86 },
      camps: [
        camp(0.3, 0.35, 'camp', [[K, 0, 2], [W, 2, 0]]),
        camp(0.7, 0.35, 'camp', [[K, 0, 2], [W, -2, 0]]),
        camp(0.5, 0.22, 'tower', [[A, -3, 1], [A, 3, 1], [K, 0, 2]]),
      ],
      objectives: [
        obj('survive', 0.5, 0.6, 7, 'The last stand', 'Hold the ring while the light gathers.', { params: { waves: 8 } }),
        obj('destroy', 0.5, 0.3, 7, 'Extinguish the dark heart', 'End it here. There is no next road.', { terminal: true }),
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
