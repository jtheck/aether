import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatMatchStatus, formatSeatName, formatStartLabel, formatTypeLobbyRow } from './lobbyUi.js';

describe('lobby ui copy', () => {
  it('formats a type-list row', () => {
    const row = formatTypeLobbyRow({
      roomId: 'lobby-abc-deadbeef',
      hostName: 'Blind',
      playerCount: 2,
      maxPlayers: 4,
      settings: { fieldSize: 'small' },
    });
    assert.equal(row.title, 'Blind');
    assert.equal(row.meta, '2/4  ·  small');
    assert.match(row.label, /Join Blind/);
  });

  it('falls back to a short room id', () => {
    const row = formatTypeLobbyRow({
      roomId: 'lobby-zzzz-abcdef12',
      hostName: '  ',
      playerCount: 1,
      maxPlayers: 2,
    });
    assert.equal(row.title, '…abcdef12');
    assert.equal(row.meta, '1/2');
  });

  it('describes hosted versus joined match status', () => {
    const hosted = formatMatchStatus({
      hosting: true,
      mode: 'teams',
      hostName: 'Overseer',
      playerCount: 1,
      maxPlayers: 4,
    });
    assert.equal(hosted.title, 'Your Teams');
    const joined = formatMatchStatus({
      hosting: false,
      mode: 'onevsone',
      hostName: 'Overseer',
      playerCount: 2,
      maxPlayers: 2,
    });
    assert.equal(joined.title, "In Overseer's 1 vs 1");
  });

  it('labels start from the gate and countdown', () => {
    assert.equal(formatStartLabel(false, 'Need 2 players', 0, 'waiting'), 'Need 2 players');
    assert.equal(formatStartLabel(true, '', 0, 'waiting'), 'Start');
    assert.equal(formatStartLabel(true, '', 2500, 'countdown'), 'Starting in 3');
    assert.equal(formatStartLabel(true, '', 0, 'starting'), 'Starting…');
    assert.equal(formatStartLabel(true, '', 0, 'playing'), 'In match');
  });

  it('labels seats with name, short id, and you', () => {
    assert.equal(
      formatSeatName({ name: 'Overseer', userId: 'p2p-aaa111' }, 'p2p-aaa111'),
      'Overseer · aaa111 (you)',
    );
    assert.equal(
      formatSeatName({ name: 'Overseer', userId: 'p2p-bbb222' }, 'p2p-aaa111'),
      'Overseer · bbb222',
    );
  });

  it('formats countdown seconds', () => {
    assert.equal(formatCountdown(3000), 'Starting in 3');
    assert.equal(formatCountdown(0), 'Starting…');
  });
});
