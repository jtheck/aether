// Observer tree assignment + offer eligibility unit checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createObserverTree,
  assignSponsor,
  offerEligibleUserIds,
  promoteObserverToPlayer,
  upsertNode,
  CHILDREN_PER_PLAYER,
  CHILDREN_PER_OBSERVER,
} from '../koth/observerTree.js';

test('assigns one L1 observer per player then fans out', () => {
  const tree = createObserverTree();
  const players = ['p0', 'p1', 'p2'];
  for (const p of players) {
    upsertNode(tree, p, { role: 'player', depth: 0, caughtUp: true });
  }

  const o0 = assignSponsor(tree, players, 'o0');
  upsertNode(tree, 'o0', { caughtUp: true });
  const o1 = assignSponsor(tree, players, 'o1');
  upsertNode(tree, 'o1', { caughtUp: true });
  const o2 = assignSponsor(tree, players, 'o2');
  upsertNode(tree, 'o2', { caughtUp: true });
  assert.equal(o0.depth, 1);
  assert.equal(o1.depth, 1);
  assert.equal(o2.depth, 1);
  assert.ok(players.includes(o0.sponsorId));
  assert.ok(players.includes(o1.sponsorId));
  assert.ok(players.includes(o2.sponsorId));
  assert.notEqual(o0.sponsorId, o1.sponsorId);
  assert.notEqual(o1.sponsorId, o2.sponsorId);

  const o3 = assignSponsor(tree, players, 'o3');
  assert.ok(o3.depth >= 2);
  assert.ok(!players.includes(o3.sponsorId));
});

test('offer eligibility starts at L1 then expands by join order', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1a', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1a']);
  upsertNode(tree, 'l2a', {
    role: 'observer', depth: 2, sponsorId: 'l1a', caughtUp: true, joinedAt: 2,
  });
  tree.childrenOf.set('l1a', ['l2a']);
  upsertNode(tree, 'l2b', {
    role: 'observer', depth: 2, sponsorId: 'l1a', caughtUp: true, joinedAt: 3,
  });

  assert.deepEqual(offerEligibleUserIds(tree, 0), ['l1a']);
  assert.deepEqual(offerEligibleUserIds(tree, 1), ['l1a', 'l2a']);
  assert.deepEqual(offerEligibleUserIds(tree, 2), ['l1a', 'l2a', 'l2b']);
});

test('promote reassigns children off the new player', () => {
  const tree = createObserverTree();
  upsertNode(tree, 'p0', { role: 'player', depth: 0, caughtUp: true });
  upsertNode(tree, 'l1', {
    role: 'observer', depth: 1, sponsorId: 'p0', caughtUp: true, joinedAt: 1,
  });
  tree.childrenOf.set('p0', ['l1']);
  upsertNode(tree, 'c0', {
    role: 'observer', depth: 2, sponsorId: 'l1', caughtUp: true, joinedAt: 2,
  });
  upsertNode(tree, 'c1', {
    role: 'observer', depth: 2, sponsorId: 'l1', caughtUp: true, joinedAt: 3,
  });
  tree.childrenOf.set('l1', ['c0', 'c1']);

  const handoffs = promoteObserverToPlayer(tree, 'l1', ['p0', 'l1']);
  assert.equal(tree.nodes.get('l1').role, 'player');
  assert.equal(tree.nodes.get('l1').depth, 0);
  assert.equal(handoffs.length, 2);
  for (const h of handoffs) {
    assert.ok(h.sponsorId === 'p0' || h.sponsorId === 'l1');
  }
  // New player has L1 capacity of 1.
  const underNew = tree.childrenOf.get('l1') ?? [];
  assert.ok(underNew.length <= CHILDREN_PER_PLAYER);
  const underP0 = tree.childrenOf.get('p0') ?? [];
  assert.ok(underP0.length <= CHILDREN_PER_OBSERVER);
});
