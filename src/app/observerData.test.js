import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AI_OWNER } from '../sim/worldSetup.js';
import {
  collectObserverOwners,
  namesFromLobbySeats,
  observerOwnerName,
  observerSheetOwners,
} from './observerData.js';

describe('observer data', () => {
  it('unions humans, ai, and extras, skips negatives', () => {
    assert.deepEqual(
      collectObserverOwners(
        { humanPlayers: [0], aiPlayers: [{ owner: 1 }, 3] },
        [2, -1],
      ),
      [0, 1, 2, 3],
    );
  });

  it('maps lobby seat names onto owner ids', () => {
    assert.deepEqual(
      namesFromLobbySeats([
        { index: 0, kind: 'human', name: 'Blind' },
        { index: 1, kind: 'empty', name: 'Ghost' },
        { index: 2, kind: 'human', name: '  ' },
      ]),
      { 0: 'Blind' },
    );
  });

  it('lists the full roster for spectators, only shared others for players', () => {
    const session = { humanPlayers: [0], aiPlayers: [{ owner: 1 }] };
    assert.deepEqual(
      observerSheetOwners({ observing: true, localId: -1, session, shareWith: [0, 1] }),
      [0, 1],
    );
    assert.deepEqual(
      observerSheetOwners({ observing: false, localId: 0, session, shareWith: [1] }),
      [1],
    );
    assert.deepEqual(
      observerSheetOwners({ observing: false, localId: 0, session, shareWith: [0, 1] }),
      [1],
    );
    assert.deepEqual(
      observerSheetOwners({ observing: false, localId: 0, session, shareWith: [] }),
      [],
    );
  });

  it('falls back to P# / Auto when a seat has no name', () => {
    assert.equal(observerOwnerName(0, {}), 'P0');
    assert.equal(observerOwnerName(AI_OWNER, {}), 'Auto');
    assert.equal(observerOwnerName(2, {}, [{ owner: 2 }]), 'Auto');
    assert.equal(observerOwnerName(0, { 0: 'Blind' }), 'Blind');
  });
});
