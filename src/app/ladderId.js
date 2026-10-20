const KEY = 'ladderPlayerId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function ladderPlayerId(storage, randomUUID) {
  const existing = String(storage.getItem(KEY) ?? '').toLowerCase();
  if (UUID.test(existing)) return existing;
  const next = String(randomUUID()).toLowerCase();
  storage.setItem(KEY, next);
  return next;
}

export function rememberLadderId(root = globalThis) {
  const storage = root.localStorage;
  if (!storage) return '';
  const id = ladderPlayerId(storage, () => root.crypto.randomUUID());
  root.navigator?.storage?.persist?.()?.catch?.(() => {});
  return id;
}
