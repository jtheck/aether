// In-memory store that matches the Dynamo conditional writes. Tests use this.
// The Lambda uses awsStore.js.

function itemKey(pk, sk) {
  return `${pk}\0${sk}`;
}

export function createMemoryStore() {
  const items = new Map();
  const objects = new Map();

  return {
    objects,
    async putReportIfAbsent(item) {
      const key = itemKey(item.pk, item.sk);
      if (items.has(key)) return { created: false, existing: items.get(key) };
      items.set(key, item);
      return { created: true, existing: item };
    },
    async listByPrefix(pk, prefix) {
      const out = [];
      for (const item of items.values()) {
        if (item.pk === pk && String(item.sk).startsWith(prefix)) out.push(item);
      }
      return out;
    },
    async getItem(pk, sk) {
      return items.get(itemKey(pk, sk)) ?? null;
    },
    async settle({ settled, players }) {
      if (items.has(itemKey(settled.pk, settled.sk))) return { ok: false, reason: 'exists' };
      for (const player of players) {
        const current = items.get(itemKey(player.pk, player.sk));
        const rating = current?.rating ?? 1000;
        const games = current?.games ?? 0;
        if (rating !== player.oldRating || games !== player.oldGames) {
          return { ok: false, reason: 'conflict' };
        }
      }
      items.set(itemKey(settled.pk, settled.sk), settled);
      for (const player of players) {
        items.set(itemKey(player.pk, player.sk), {
          pk: player.pk,
          sk: player.sk,
          playerId: player.playerId,
          name: player.name || '',
          rating: player.rating,
          games: player.games,
          wins: player.wins,
        });
      }
      return { ok: true };
    },
    async getObject(key) {
      return objects.has(key) ? objects.get(key) : null;
    },
    async putObject(key, body) {
      objects.set(key, body);
    },
    async putItem(item) {
      items.set(itemKey(item.pk, item.sk), item);
    },
    async deleteItem(pk, sk) {
      items.delete(itemKey(pk, sk));
    },
    async pairQueue({ deletes, puts }) {
      for (const key of deletes) {
        if (!items.has(itemKey(key.pk, key.sk))) return { ok: false };
      }
      for (const key of deletes) items.delete(itemKey(key.pk, key.sk));
      for (const item of puts) items.set(itemKey(item.pk, item.sk), item);
      return { ok: true };
    },
  };
}
