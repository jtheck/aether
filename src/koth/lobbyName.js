// Stable display names for public KOTH matches.
// Derived from matchId so every peer agrees without electing a host title.

const ADJECTIVES = [
  'Amber', 'Ashen', 'Bramble', 'Bright', 'Cedar', 'Copper',
  'Dusk', 'Ember', 'Fern', 'Golden', 'Hollow', 'Ivory',
  'Jade', 'Lark', 'Mist', 'Moss', 'Quiet', 'River',
  'Silver', 'Soft', 'Thorn', 'Umber', 'Verdant', 'Willow',
];

const NOUNS = [
  'Agora', 'Brook', 'Clearing', 'Crown', 'Field', 'Garden',
  'Grove', 'Haven', 'Hill', 'Hollow', 'Isle', 'Knoll',
  'Meadow', 'Orchard', 'Plinth', 'Pond', 'Ridge', 'Rise',
  'Roost', 'Terrace', 'Thicket', 'Vale', 'Walk', 'Ward',
];

function hashMatchId(matchId) {
  let h = 2166136261;
  const s = String(matchId ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @param {string} [matchId] */
export function generateLobbyName(matchId) {
  const s = String(matchId ?? '').trim();
  if (!s) return '';
  const h = hashMatchId(s);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 10) % NOUNS.length];
  return `${adj} ${noun}`;
}

/**
 * Prefer an announced lobby name; otherwise derive one from matchId.
 * @param {string | { lobbyName?: string, matchId?: string } | null | undefined} source
 */
export function resolveLobbyName(source) {
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed) return trimmed;
    return '';
  }
  const announced = (source?.lobbyName ?? '').trim();
  if (announced) return announced;
  return generateLobbyName(source?.matchId);
}
