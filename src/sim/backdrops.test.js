import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDROP,
  BACKDROP_DEFS,
  backdropAlongRay,
  cloneBackdrops,
  defaultBackdropY,
  encodeBackdrops,
  freshBackdrop,
  isBackdropType,
  nearestBackdrop,
  normalizeBackdrops,
} from './backdrops.js';

describe('backdrops', () => {
  it('accepts known types and drops unknown ones', () => {
    assert.equal(isBackdropType(BACKDROP.DISC), true);
    assert.equal(isBackdropType(BACKDROP.CASTLE), true);
    assert.equal(isBackdropType('banner'), false);
    const list = normalizeBackdrops([
      { type: 'disc', x: 2, z: -4 },
      { type: 'nope', x: 1, z: 1 },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].type, BACKDROP.DISC);
    assert.equal(list[0].scale, BACKDROP_DEFS.disc.defaultScale);
    assert.equal(list[0].y, defaultBackdropY('disc', list[0].scale));
  });

  it('places a castle on the ground and a disc sunk to its mesh origin', () => {
    const castle = freshBackdrop(BACKDROP.CASTLE, 12.2, -4);
    assert.equal(castle.type, 'castle');
    assert.equal(castle.scale, 64);
    assert.equal(castle.y, 0);
    assert.equal(castle.x, 12.2);
    const disc = freshBackdrop(BACKDROP.DISC, 0, 0);
    assert.equal(disc.y, defaultBackdropY(BACKDROP.DISC, disc.scale));
    const poses = [castle, disc];
    assert.equal(nearestBackdrop(poses, 12, -4), 0);
    assert.equal(nearestBackdrop(poses, 400, 400), -1);
    // Disc footprint is the mesh radius (~2.9 * scale), not the keep's half-unit.
    assert.equal(nearestBackdrop(poses, 120, 0), 1);
    assert.equal(nearestBackdrop([disc], 400, 0), -1);
  });

  it('grabs a prop the view ray hits before the ground, including a castle roof', () => {
    const disc = freshBackdrop(BACKDROP.DISC, 0, 0);
    const onRim = { x: 180, y: 90, z: -240, dx: 0, dy: -90, dz: 240 };
    assert.equal(backdropAlongRay([disc], onRim, 1), 0);
    const outside = { x: 400, y: 80, z: 0, dx: 0, dy: -80, dz: 0 };
    assert.equal(backdropAlongRay([disc], outside, 1), -1);

    const castle = freshBackdrop(BACKDROP.CASTLE, 0, 0);
    // Aimed at the keep top; the ground under that ray sits outside the walls.
    const roof = { x: 0, y: 200, z: -200, dx: 0, dy: -150, dz: 200 };
    assert.equal(nearestBackdrop([castle], 0, 67), -1);
    assert.equal(backdropAlongRay([castle], roof, 1.34), 0);
  });

  it('roundtrips garden tuples with an explicit huge pose', () => {
    const posed = normalizeBackdrops([['disc', 0, 0, -243, 0, 80]]);
    assert.deepEqual(encodeBackdrops(posed), [['disc', 0, 0, -243, 0, 80]]);
    assert.deepEqual(cloneBackdrops(posed), posed);
  });
});
