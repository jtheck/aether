import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canStart, claimSeat, countHumans, createRoster, moveRosterPerson, releaseSeat, setSeatReady, startBlockReason } from './roster.js';

describe('lobby roster', () => {
  it('seats teams as A A / B B', () => {
    const seats = createRoster('teams');
    assert.equal(seats.length, 4);
    assert.deepEqual(seats.map((s) => s.team), [0, 0, 1, 1]);
  });

  it('fills the first empty seat', () => {
    let seats = createRoster('onevsone');
    const a = claimSeat(seats, { userId: 'u1', name: 'A', ready: true });
    assert.equal(a.ok, true);
    assert.equal(a.index, 0);
    const b = claimSeat(a.seats, { userId: 'u2', name: 'B' });
    assert.equal(b.index, 1);
    const full = claimSeat(b.seats, { userId: 'u3', name: 'C' });
    assert.equal(full.ok, false);
  });

  it('updates an already seated player', () => {
    let { seats } = claimSeat(createRoster('teams'), { userId: 'u1', name: 'A' });
    const next = claimSeat(seats, {
      userId: 'u1',
      name: 'Renamed',
      color: '#f00',
      dlc: ['first_responder'],
      skins: { 4: 'first_responder' },
    });
    assert.equal(next.ok, true);
    assert.equal(next.index, 0);
    assert.equal(countHumans(next.seats), 1);
    assert.equal(next.seats[0].name, 'Renamed');
    assert.deepEqual(next.seats[0].dlc, ['first_responder']);
    assert.deepEqual(next.seats[0].skins, { 4: 'first_responder' });
  });

  it('gates start on min humans and ready', () => {
    let seats = createRoster('teams');
    seats = claimSeat(seats, { userId: 'host', name: 'H', ready: true }).seats;
    assert.equal(canStart('teams', seats), false);
    assert.equal(startBlockReason('teams', seats), 'Need 2 players');
    seats = claimSeat(seats, { userId: 'p2', name: 'P' }).seats;
    assert.equal(startBlockReason('teams', seats), 'Waiting for ready');
    seats = setSeatReady(seats, 'p2', true);
    assert.equal(canStart('teams', seats), true);
    assert.equal(startBlockReason('teams', seats), '');
  });

  it('lets adventure start solo when ready', () => {
    const { seats } = claimSeat(createRoster('adventure'), { userId: 'h', ready: true });
    assert.equal(canStart('adventure', seats), true);
  });

  it('keeps two same-named players on different ids', () => {
    let seats = claimSeat(createRoster('onevsone'), { userId: 'p2p-aaa', name: 'Overseer' }).seats;
    seats = claimSeat(seats, { userId: 'p2p-bbb', name: 'Overseer' }).seats;
    assert.equal(countHumans(seats), 2);
    assert.equal(seats[0].userId, 'p2p-aaa');
    assert.equal(seats[1].userId, 'p2p-bbb');
  });

  it('refuses a claim without a userId', () => {
    const next = claimSeat(createRoster('onevsone'), { name: 'Ghost' });
    assert.equal(next.ok, false);
    assert.equal(countHumans(next.seats), 0);
  });

  it('moves a player one seat and drops their ready', () => {
    let seats = createRoster('teams');
    seats = claimSeat(seats, { userId: 'host', name: 'H', ready: true }).seats;
    seats = claimSeat(seats, { userId: 'p2', name: 'P', ready: true }).seats;
    const moved = moveRosterPerson(seats, [], 'p2', -1, { hostId: 'host' });
    assert.equal(moved.ok, true);
    assert.equal(moved.seats[0].userId, 'p2');
    assert.equal(moved.seats[0].ready, false);
    assert.equal(moved.seats[1].userId, 'host');
    assert.equal(moved.seats[1].ready, true);
  });

  it('moves the last seat into watching and back into an open seat', () => {
    let seats = createRoster('onevsone');
    seats = claimSeat(seats, { userId: 'host', name: 'H', ready: true }).seats;
    seats = claimSeat(seats, { userId: 'p2', name: 'P', ready: true }).seats;
    const down = moveRosterPerson(seats, [], 'p2', 1, { hostId: 'host' });
    assert.equal(down.seats[1].kind, 'empty');
    assert.equal(down.spectators[0].userId, 'p2');
    const up = moveRosterPerson(down.seats, down.spectators, 'p2', -1, { hostId: 'host' });
    assert.equal(up.seats[1].userId, 'p2');
    assert.equal(up.seats[1].ready, false);
    assert.equal(up.spectators.length, 0);
    assert.equal(up.seats[0].ready, true);
  });

  it('lets the host make a 3v1 by moving one seat across', () => {
    let seats = createRoster('teams');
    for (const id of ['h', 'a', 'b', 'c']) {
      seats = claimSeat(seats, { userId: id, name: id, ready: true }).seats;
    }
    const moved = moveRosterPerson(seats, [], 'a', 1, { hostId: 'h', teams: true });
    assert.equal(moved.ok, true);
    assert.deepEqual(moved.seats.map((s) => s.team), [0, 1, 1, 1]);
    assert.equal(moved.seats[1].userId, 'a');
    assert.equal(moved.seats[1].ready, false);
    assert.equal(moved.seats[0].ready, true);
  });

  it('swaps a watcher with the last seat when the roster is full', () => {
    let seats = createRoster('onevsone');
    seats = claimSeat(seats, { userId: 'host', name: 'H', ready: true }).seats;
    seats = claimSeat(seats, { userId: 'p2', name: 'P', ready: true }).seats;
    const moved = moveRosterPerson(seats, [{ userId: 'eye', name: 'E', color: '' }], 'eye', -1, { hostId: 'host' });
    assert.equal(moved.seats[1].userId, 'eye');
    assert.equal(moved.seats[1].ready, false);
    assert.equal(moved.spectators[0].userId, 'p2');
  });

  it('releases a seat back to empty', () => {
    let seats = claimSeat(createRoster('onevsone'), { userId: 'u1', ready: true }).seats;
    seats = releaseSeat(seats, 'u1');
    assert.equal(countHumans(seats), 0);
    assert.equal(seats[0].kind, 'empty');
  });
});
