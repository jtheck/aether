// Observer fan-out tree + cascading open-slot offer eligibility.

import { MAX_SLOTS } from './protocol.js';

/** L1: one observer per live player. Deeper nodes fan out further. */
export const CHILDREN_PER_PLAYER = 1;
export const CHILDREN_PER_OBSERVER = 4;
/** ~5 minutes at 20 Hz. */
export const CHECKPOINT_INTERVAL_TICKS = 6000;
/** Expand offer eligibility by one more observer every 30s. */
export const OFFER_EXPAND_MS = 30_000;

/**
 * @typedef {{
 *   userId: string,
 *   role: 'player' | 'observer',
 *   sponsorId: string | null,
 *   depth: number,
 *   caughtUp: boolean,
 *   joinedAt: number,
 * }} ObserverNode
 */

/**
 * @typedef {{
 *   nodes: Map<string, ObserverNode>,
 *   childrenOf: Map<string, string[]>,
 * }} ObserverTree
 */

export function createObserverTree() {
  return {
    nodes: new Map(),
    childrenOf: new Map(),
  };
}

export function upsertNode(tree, userId, patch = {}) {
  if (!userId) return null;
  let node = tree.nodes.get(userId);
  if (!node) {
    node = {
      userId,
      role: patch.role ?? 'observer',
      sponsorId: patch.sponsorId ?? null,
      depth: patch.depth ?? 0,
      caughtUp: patch.caughtUp ?? false,
      joinedAt: patch.joinedAt ?? Date.now(),
    };
    tree.nodes.set(userId, node);
  } else {
    Object.assign(node, patch);
  }
  return node;
}

export function removeNode(tree, userId) {
  const node = tree.nodes.get(userId);
  if (!node) return [];
  const orphans = [...(tree.childrenOf.get(userId) ?? [])];
  if (node.sponsorId) {
    const sibs = tree.childrenOf.get(node.sponsorId);
    if (sibs) {
      const next = sibs.filter((id) => id !== userId);
      if (next.length) tree.childrenOf.set(node.sponsorId, next);
      else tree.childrenOf.delete(node.sponsorId);
    }
  }
  tree.childrenOf.delete(userId);
  tree.nodes.delete(userId);
  for (const childId of orphans) {
    const child = tree.nodes.get(childId);
    if (child) {
      child.sponsorId = null;
    }
  }
  return orphans;
}

function childCount(tree, userId) {
  return tree.childrenOf.get(userId)?.length ?? 0;
}

function capacityFor(node) {
  if (!node) return 0;
  if (node.role === 'player') return CHILDREN_PER_PLAYER;
  return CHILDREN_PER_OBSERVER;
}

function linkChild(tree, sponsorId, childId) {
  const list = tree.childrenOf.get(sponsorId) ?? [];
  if (!list.includes(childId)) list.push(childId);
  tree.childrenOf.set(sponsorId, list);
  const child = tree.nodes.get(childId);
  const sponsor = tree.nodes.get(sponsorId);
  if (child) {
    child.sponsorId = sponsorId;
    child.depth = (sponsor?.depth ?? 0) + 1;
  }
}

/**
 * Pick a sponsor for a new observer: prefer empty L1 under a player, else
 * shallowest observer/player with free capacity (deterministic by userId).
 * @param {ObserverTree} tree
 * @param {string[]} playerUserIds — live players
 * @param {string} observerUserId
 */
export function assignSponsor(tree, playerUserIds, observerUserId) {
  upsertNode(tree, observerUserId, { role: 'observer' });
  const players = [...playerUserIds].filter(Boolean).sort();
  for (const pid of players) {
    upsertNode(tree, pid, { role: 'player', depth: 0, sponsorId: null, caughtUp: true });
    if (childCount(tree, pid) < CHILDREN_PER_PLAYER) {
      linkChild(tree, pid, observerUserId);
      return tree.nodes.get(observerUserId);
    }
  }

  /** @type {{ id: string, depth: number }[]} */
  const candidates = [];
  for (const [id, node] of tree.nodes) {
    if (id === observerUserId) continue;
    if (!node.caughtUp && node.role === 'observer') continue;
    if (childCount(tree, id) >= capacityFor(node)) continue;
    candidates.push({ id, depth: node.depth | 0 });
  }
  candidates.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!candidates.length) {
    // No capacity yet — leave unassigned; caller retries.
    const node = tree.nodes.get(observerUserId);
    if (node) {
      node.sponsorId = null;
      node.depth = 1;
    }
    return node;
  }
  linkChild(tree, candidates[0].id, observerUserId);
  return tree.nodes.get(observerUserId);
}

/**
 * Reassign orphans (and optionally a promoting node's children) to other sponsors.
 * @returns {{ userId: string, sponsorId: string | null, depth: number }[]}
 */
export function reassignOrphans(tree, playerUserIds, orphanUserIds) {
  const assignments = [];
  const sorted = [...orphanUserIds].sort();
  for (const oid of sorted) {
    const node = tree.nodes.get(oid);
    if (!node || node.role === 'player') continue;
    // Detach from old sponsor list if still linked.
    if (node.sponsorId) {
      const sibs = tree.childrenOf.get(node.sponsorId);
      if (sibs) {
        const next = sibs.filter((id) => id !== oid);
        if (next.length) tree.childrenOf.set(node.sponsorId, next);
        else tree.childrenOf.delete(node.sponsorId);
      }
      node.sponsorId = null;
    }
    assignSponsor(tree, playerUserIds, oid);
    const updated = tree.nodes.get(oid);
    assignments.push({
      userId: oid,
      sponsorId: updated?.sponsorId ?? null,
      depth: updated?.depth ?? 1,
    });
  }
  return assignments;
}

/**
 * When an observer promotes to player: detach from sponsor, take their children
 * as orphans to reassign, mark self as player with L1 capacity.
 */
export function promoteObserverToPlayer(tree, userId, playerUserIds) {
  const node = upsertNode(tree, userId, { role: 'player', depth: 0, caughtUp: true });
  const children = [...(tree.childrenOf.get(userId) ?? [])];
  if (node.sponsorId) {
    const sibs = tree.childrenOf.get(node.sponsorId);
    if (sibs) {
      const next = sibs.filter((id) => id !== userId);
      if (next.length) tree.childrenOf.set(node.sponsorId, next);
      else tree.childrenOf.delete(node.sponsorId);
    }
  }
  node.sponsorId = null;
  node.depth = 0;
  tree.childrenOf.delete(userId);
  const players = playerUserIds.includes(userId)
    ? playerUserIds
    : [...playerUserIds, userId];
  return reassignOrphans(tree, players, children);
}

/** L1 observers = depth 1, sponsored by a player. */
export function listL1Observers(tree) {
  const out = [];
  for (const node of tree.nodes.values()) {
    if (node.role !== 'observer') continue;
    if (node.depth !== 1) continue;
    out.push(node);
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
}

/** All observers in join order. */
export function listObserversByJoin(tree) {
  const out = [];
  for (const node of tree.nodes.values()) {
    if (node.role !== 'observer') continue;
    out.push(node);
  }
  return out.sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1));
}

/**
 * Eligible userIds for an open-seat offer.
 * Starts with caught-up L1; every expandStep adds the next caught-up observer.
 * @param {number} expandSteps — 0 = L1 only; each step adds one more by join order
 */
export function offerEligibleUserIds(tree, expandSteps = 0) {
  const l1 = listL1Observers(tree).filter((n) => n.caughtUp);
  const all = listObserversByJoin(tree).filter((n) => n.caughtUp);
  const eligible = [];
  const seen = new Set();
  for (const n of l1) {
    eligible.push(n.userId);
    seen.add(n.userId);
  }
  let added = 0;
  for (const n of all) {
    if (seen.has(n.userId)) continue;
    if (added >= expandSteps) break;
    eligible.push(n.userId);
    seen.add(n.userId);
    added++;
  }
  return eligible;
}

export function maxPlayerSponsors() {
  return MAX_SLOTS;
}
