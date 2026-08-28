// Transport load / unload — SoA port of v1 embark/disembark.
// Passengers are discovered by scanning carriedBy[i] === transportId.

import * as fx from './fixed.js';
import { getUnitDef, isTransport, UNIT } from './unitTypes.js';
import { clearPath, queuePath } from './path.js';
import { clearEngagement } from './engagement.js';
import { ORDER } from './world.js';

/** Auto-load when rider is within this world distance of the transport. */
export const TRANSPORT_LOAD_RANGE = fx.fromFloat(6);
const TRANSPORT_LOAD_RANGE_SQ = fx.mul(TRANSPORT_LOAD_RANGE, TRANSPORT_LOAD_RANGE);
/** Repath embark chase when the transport drifted this far from the rider's nav dest. */
const TRANSPORT_CHASE_REPATH = fx.fromFloat(2.5);
const TRANSPORT_CHASE_REPATH_SQ = fx.mul(TRANSPORT_CHASE_REPATH, TRANSPORT_CHASE_REPATH);

/** Drop ring radius when spilling / unloading. */
export const TRANSPORT_UNLOAD_SPREAD = fx.fromFloat(3);
/** Walk-to spread around unload click target. */
export const TRANSPORT_UNLOAD_WALK_SPREAD = fx.fromFloat(4);

export function transportCapacityOf(typeId) {
  return getUnitDef(typeId).transportCapacity ?? 0;
}

/** Monks walk — stick work doesn't belong in a wagon. */
export function canRideTransport(typeId) {
  if (typeId === UNIT.MONK) return false;
  if (isTransport(typeId)) return false;
  return true;
}

export function isCarried(w, i) {
  return w.carriedBy[i] >= 0;
}

export function passengerCount(w, transportId) {
  let n = 0;
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.carriedBy[i] === transportId) n++;
  }
  return n;
}

/** Living passenger entity ids in ascending order (deterministic). */
export function listPassengers(w, transportId) {
  const out = [];
  for (let i = 0; i < w.count; i++) {
    if (w.alive[i] && w.carriedBy[i] === transportId) out.push(i);
  }
  return out;
}

export function canLoad(w, rider, transport) {
  if (rider < 0 || transport < 0) return false;
  if (rider >= w.count || transport >= w.count) return false;
  if (!w.alive[rider] || !w.alive[transport]) return false;
  if (w.owner[rider] !== w.owner[transport]) return false;
  if (isCarried(w, rider) || isCarried(w, transport)) return false;
  if (!isTransport(w.type[transport])) return false;
  if (!canRideTransport(w.type[rider])) return false;
  const cap = transportCapacityOf(w.type[transport]);
  if (cap <= 0) return false;
  return passengerCount(w, transport) < cap;
}

export function loadUnit(w, rider, transport) {
  if (!canLoad(w, rider, transport)) return false;
  w.carriedBy[rider] = transport;
  w.transportTarget[rider] = -1;
  w.order[rider] = ORDER.IDLE;
  w.targetEntity[rider] = -1;
  if (w.targetBuilding) w.targetBuilding[rider] = -1;
  clearEngagement(w, rider);
  w.hasTarget[rider] = 0;
  w.vx[rider] = 0;
  w.vy[rider] = 0;
  clearPath(w, rider);
  w.px[rider] = w.px[transport];
  w.py[rider] = w.py[transport];
  return true;
}

/**
 * Spill passengers in a circle around the transport.
 * If walkTx/walkTy are set, queue MOVE toward a spread around that point.
 */
export function unloadPassengers(w, transport, walkTx = null, walkTy = null) {
  if (transport < 0 || transport >= w.count || !w.alive[transport]) return [];
  const passengers = listPassengers(w, transport);
  if (passengers.length === 0) return [];

  const n = passengers.length;
  const unloaded = [];
  for (let k = 0; k < n; k++) {
    const rider = passengers[k];
    w.carriedBy[rider] = -1;
    w.transportTarget[rider] = -1;

    const angle = (k / n) * Math.PI * 2;
    const cos = fx.fromFloat(Math.cos(angle));
    const sin = fx.fromFloat(Math.sin(angle));
    const dropX = w.px[transport] + fx.mul(cos, TRANSPORT_UNLOAD_SPREAD);
    const dropY = w.py[transport] + fx.mul(sin, TRANSPORT_UNLOAD_SPREAD);
    w.px[rider] = dropX;
    w.py[rider] = dropY;
    w.vx[rider] = 0;
    w.vy[rider] = 0;
    clearEngagement(w, rider);
    w.targetEntity[rider] = -1;
    if (w.targetBuilding) w.targetBuilding[rider] = -1;

    if (walkTx != null && walkTy != null) {
      const destX = walkTx + fx.mul(cos, TRANSPORT_UNLOAD_WALK_SPREAD);
      const destY = walkTy + fx.mul(sin, TRANSPORT_UNLOAD_WALK_SPREAD);
      w.order[rider] = ORDER.MOVE;
      w.tx[rider] = destX;
      w.ty[rider] = destY;
      w.hasTarget[rider] = 1;
      queuePath(w, rider, destX, destY);
    } else {
      w.order[rider] = ORDER.IDLE;
      w.hasTarget[rider] = 0;
      clearPath(w, rider);
    }
    unloaded.push(rider);
  }
  return unloaded;
}

/** Stamp riders to seek a transport (click-to-load). Capacity checked at load. */
export function applyTransportAssignments(w, assignments) {
  if (!assignments || assignments.length === 0) return;
  for (let a = 0; a < assignments.length; a++) {
    const rider = assignments[a].riderId | 0;
    const transport = assignments[a].transportId | 0;
    if (
      rider < 0 ||
      transport < 0 ||
      rider >= w.count ||
      transport >= w.count ||
      !w.alive[rider] ||
      !w.alive[transport] ||
      w.owner[rider] !== w.owner[transport] ||
      !isTransport(w.type[transport]) ||
      !canRideTransport(w.type[rider]) ||
      isCarried(w, rider)
    ) {
      continue;
    }
    w.transportTarget[rider] = transport;
    w.order[rider] = ORDER.MOVE;
    w.targetEntity[rider] = -1;
    if (w.targetBuilding) w.targetBuilding[rider] = -1;
    clearEngagement(w, rider);
    w.tx[rider] = w.px[transport];
    w.ty[rider] = w.py[transport];
    w.hasTarget[rider] = 1;
    queuePath(w, rider, w.px[transport], w.py[transport]);
  }
}

/** Seek assigned transports + auto-load when close enough. */
export function transportAutoLoadSystem(w) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i] || isCarried(w, i)) continue;
    const t = w.transportTarget[i];
    if (t < 0) continue;
    if (t >= w.count || !w.alive[t] || !isTransport(w.type[t])) {
      w.transportTarget[i] = -1;
      continue;
    }
    const d2 = fx.dist2(w.px[i], w.py[i], w.px[t], w.py[t]);
    if (d2 <= TRANSPORT_LOAD_RANGE_SQ) {
      if (loadUnit(w, i, t)) continue;
      // Full — keep seeking in case a slot frees.
    }
    // Chase the moving transport; repath when dest drifts or path is empty.
    w.order[i] = ORDER.MOVE;
    w.tx[i] = w.px[t];
    w.ty[i] = w.py[t];
    w.hasTarget[i] = 1;
    const drift2 = fx.dist2(w.navDestX[i], w.navDestY[i], w.px[t], w.py[t]);
    if (
      (w.navWpCount[i] === 0 && w.pathRequest[i] === 0) ||
      drift2 > TRANSPORT_CHASE_REPATH_SQ
    ) {
      queuePath(w, i, w.px[t], w.py[t]);
    } else {
      w.navDestX[i] = w.px[t];
      w.navDestY[i] = w.py[t];
    }
  }
}

/** Keep passengers glued to their transport. */
export function syncCarriedPositions(w) {
  for (let i = 0; i < w.count; i++) {
    if (!w.alive[i]) continue;
    const t = w.carriedBy[i];
    if (t < 0) continue;
    if (t >= w.count || !w.alive[t]) {
      // Transport gone without spill — free the rider in place.
      w.carriedBy[i] = -1;
      continue;
    }
    w.px[i] = w.px[t];
    w.py[i] = w.py[t];
    w.vx[i] = 0;
    w.vy[i] = 0;
  }
}

/**
 * Click-to-load: nearest eligible selected units fill the transport up to free seats.
 * Deterministic: distance, then lower entity id.
 * @param {number} transportId
 * @param {number[]} candidateIds selection (may include the transport)
 * @returns {{ riderId: number, transportId: number }[]}
 */
export function assignNearestRidersToTransport(w, transportId, candidateIds) {
  if (
    transportId < 0 ||
    transportId >= w.count ||
    !w.alive[transportId] ||
    !isTransport(w.type[transportId])
  ) {
    return [];
  }
  const slots = transportCapacityOf(w.type[transportId]) - passengerCount(w, transportId);
  if (slots <= 0 || !candidateIds?.length) return [];

  const ranked = [];
  for (let k = 0; k < candidateIds.length; k++) {
    const rider = candidateIds[k] | 0;
    if (rider === transportId) continue;
    if (rider < 0 || rider >= w.count || !w.alive[rider] || isCarried(w, rider)) continue;
    if (w.owner[rider] !== w.owner[transportId]) continue;
    if (!canRideTransport(w.type[rider])) continue;
    const d2 = fx.dist2(w.px[rider], w.py[rider], w.px[transportId], w.py[transportId]);
    ranked.push({ rider, d2 });
  }
  ranked.sort((a, b) => (a.d2 - b.d2) || (a.rider - b.rider));

  const assignments = [];
  const n = Math.min(slots, ranked.length);
  for (let i = 0; i < n; i++) {
    assignments.push({ riderId: ranked[i].rider, transportId });
  }
  return assignments;
}
