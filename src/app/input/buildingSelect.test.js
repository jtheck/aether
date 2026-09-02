import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameOwnedBuildingType,
  pickLeastLoadedIndex,
  groupHasUpgradeQueued,
  aggregateBuildingTracks,
  buildingHasWork,
  extraQueueBadge,
} from './buildingSelect.js';

describe('sameOwnedBuildingType', () => {
  const buildings = [
    { owner: 0, type: 'barracks', hp: 10 },
    { owner: 0, type: 'barracks', hp: 10 },
    { owner: 0, type: 'camp', hp: 10 },
    { owner: 1, type: 'barracks', hp: 10 },
  ];

  it('groups own living buildings of one type', () => {
    const g = sameOwnedBuildingType(
      [{ kind: 'building', index: 0 }, { kind: 'building', index: 1 }],
      buildings,
      0,
    );
    assert.deepEqual(g, { type: 'barracks', indices: [0, 1] });
  });

  it('rejects mixed types and foreign owners', () => {
    assert.equal(
      sameOwnedBuildingType(
        [{ kind: 'building', index: 0 }, { kind: 'building', index: 2 }],
        buildings,
        0,
      ),
      null,
    );
    assert.equal(
      sameOwnedBuildingType([{ kind: 'building', index: 3 }], buildings, 0),
      null,
    );
  });

  it('ignores rally flags and rejects an agora in the set', () => {
    const withRally = sameOwnedBuildingType(
      [
        { kind: 'building', index: 0 },
        { kind: 'rally', index: 0, hop: 0 },
      ],
      buildings,
      0,
    );
    assert.deepEqual(withRally, { type: 'barracks', indices: [0] });
    assert.equal(
      sameOwnedBuildingType(
        [{ kind: 'agora', index: 0 }, { kind: 'building', index: 0 }],
        buildings,
        0,
      ),
      null,
    );
  });
});

describe('queue spread', () => {
  it('picks the least-loaded built site', () => {
    const buildings = [
      { built: 1, hp: 10, tracks: [{ count: 3 }] },
      { built: 1, hp: 10, tracks: [{ count: 1 }] },
      { built: 0, hp: 10, tracks: [] },
    ];
    assert.equal(pickLeastLoadedIndex([0, 1, 2], buildings), 1);
  });

  it('keeps the framed queue and counts extras on the other sites', () => {
    const buildings = [
      { hp: 10, tracks: [{ kind: 'unit', id: 'warrior', count: 2, progress: 0.2 }] },
      { hp: 10, tracks: [{ kind: 'unit', id: 'warrior', count: 1, progress: 0.6 }] },
    ];
    const tracks = aggregateBuildingTracks([0, 1], buildings, 0);
    assert.equal(tracks['unit:warrior'].count, 2);
    assert.equal(tracks['unit:warrior'].extra, 1);
    assert.equal(tracks['unit:warrior'].progress, 0.2);
    const onlyOther = aggregateBuildingTracks([0, 1], buildings, 1);
    assert.equal(onlyOther['unit:warrior'].count, 1);
    assert.equal(onlyOther['unit:warrior'].extra, 2);
  });

  it('detects an upgrade already queued in the group', () => {
    const buildings = [
      { tracks: [] },
      { tracks: [{ kind: 'upgrade', id: 'drayage', count: 1 }] },
    ];
    assert.equal(groupHasUpgradeQueued([0, 1], buildings, 'drayage'), true);
    assert.equal(groupHasUpgradeQueued([0], buildings, 'drayage'), false);
  });

  it('formats extras as +N', () => {
    assert.equal(extraQueueBadge(3), '+3');
    assert.equal(extraQueueBadge(0), '');
    assert.equal(buildingHasWork({ tracks: [{ count: 0, progress: 0.2 }] }), true);
  });
});
