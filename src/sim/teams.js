// Team hostility — simple FFA for now (different owner = hostile).

export function isHostile(ownerA, ownerB) {
  return ownerA !== ownerB;
}
