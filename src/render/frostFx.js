// Falling frost for the wizard ice bolt and units slowed by it.
// Same star as the wizard staff spark, tinted white and ice-blue, falling.

const WHITE = [0.94, 0.98, 1, 0.92];
const BLUE = [0.55, 0.9, 1, 0.88];

function rand(rng) {
  return rng();
}

function emitStar(emit, rng, x, y, z, vx, vy, vz) {
  const size = 0.16 + rand(rng) * 0.18;
  emit({
    blend: 'alpha',
    shape: 'star',
    fadeOut: true,
    position: [x, y, z],
    velocity: [vx, vy, vz],
    gravity: [0, -(3.2 + rand(rng) * 2.4), 0],
    color: rand(rng) > 0.45 ? WHITE : BLUE,
    lifetime: 0.5 + rand(rng) * 0.35,
    startSize: size,
    endSize: 0.03,
    drag: 0.55,
    rotation: rand(rng) * Math.PI * 2,
    spin: (rand(rng) - 0.5) * 3.2,
  });
}

/**
 * @param {(init: object) => unknown} emit
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {'bolt' | 'chill'} kind
 * @param {{ vx?: number, vz?: number }} [motion] bolt step, world units per tick
 * @param {() => number} [rng]
 */
export function emitFallingFrost(emit, x, y, z, kind, motion = null, rng = Math.random) {
  if (kind === 'bolt') {
    const stepX = motion?.vx ?? 0;
    const stepZ = motion?.vz ?? 0;
    const speed = Math.hypot(stepX, stepZ);
    const bx = speed > 1e-4 ? stepX / speed : 0;
    const bz = speed > 1e-4 ? stepZ / speed : 1;
    for (let i = 0; i < 3; i++) {
      const side = (rand(rng) - 0.5) * 0.7;
      const back = 0.1 + rand(rng) * 0.4;
      emitStar(
        emit,
        rng,
        x - bx * back - bz * side,
        y + 0.05 + rand(rng) * 0.45,
        z - bz * back + bx * side,
        -stepX * (0.4 + rand(rng) * 0.55) + (rand(rng) - 0.5) * 0.3,
        -(0.9 + rand(rng) * 1.3),
        -stepZ * (0.4 + rand(rng) * 0.55) + (rand(rng) - 0.5) * 0.3,
      );
    }
    return;
  }

  for (let i = 0; i < 4; i++) {
    const ang = rand(rng) * Math.PI * 2;
    const rad = 0.12 + rand(rng) * 0.95;
    const column = -0.7 + (i / 3) * 2.1 + (rand(rng) - 0.5) * 0.25;
    emitStar(
      emit,
      rng,
      x + Math.cos(ang) * rad,
      y + column,
      z + Math.sin(ang) * rad,
      (rand(rng) - 0.5) * 0.35,
      -(0.7 + rand(rng) * 1.1),
      (rand(rng) - 0.5) * 0.35,
    );
  }
}
