// Decisive-match wipe — HUD pop is living units. When agora occupy also
// ends the match, a side with 0 pop loses. KOTH keeps its own elimination.

import { livingByOwner } from './world.js';
import { teamOf } from './teams.js';

const MAX_SEATS = 8;

/**
 * After combat each tick — if only one participant team still has pop, they win.
 * Seats are agora founders. A leftover village does not save a wiped army.
 * @param {object} w
 */
export function matchWipeStep(w) {
  if ((w.agoraOccupyEndsMatch ?? 1) === 0) return;
  if (w.kothMatchOver) return;
  const agoras = w.agoras;
  if (!agoras?.length) return;

  const owners = [];
  const seen = new Uint8Array(MAX_SEATS);
  for (let i = 0; i < agoras.length; i++) {
    const a = agoras[i];
    const o = (a.founder ?? a.owner) | 0;
    if (o < 0 || o >= MAX_SEATS || seen[o]) continue;
    seen[o] = 1;
    owners.push(o);
  }
  if (owners.length < 2) return;

  let teams = 0;
  let liveTeams = 0;
  const teamSeen = new Uint8Array(MAX_SEATS);
  const teamLive = new Uint8Array(MAX_SEATS);
  let winner = -1;
  for (let i = 0; i < owners.length; i++) {
    const o = owners[i];
    const t = teamOf(o) & 0xff;
    if (t < MAX_SEATS && !teamSeen[t]) {
      teamSeen[t] = 1;
      teams++;
    }
    if (livingByOwner(w, o) <= 0) continue;
    if (t < MAX_SEATS && !teamLive[t]) {
      teamLive[t] = 1;
      liveTeams++;
    }
    if (winner < 0 || o < winner) winner = o;
  }

  if (teams < 2 || liveTeams >= 2) return;
  if (liveTeams === 1) w.matchWinner = winner;
  w.kothMatchOver = 1;
}
