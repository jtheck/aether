/** Extra owners whose sight stamps the local overlay (combat stays hostile). */
export function shareVisionOwnersFromCfg(cfg, playerDefault = 0) {
  if (!cfg) return [];
  if (Array.isArray(cfg.shareVisionWith)) return cfg.shareVisionWith.map((id) => id | 0);
  const spectating = cfg.role === 'spectator' || (cfg.localPlayerId != null && (cfg.localPlayerId | 0) < 0);
  if (!cfg.sharedVision && !spectating) return [];
  // Spectators union every army; playing clients skip their own slot.
  const local = spectating ? -1 : (cfg.localPlayerId ?? playerDefault);
  const ids = new Set();
  const slots = cfg.activeSlots ?? [];
  for (let i = 0; i < slots.length; i++) {
    const id = slots[i] | 0;
    if (id !== local) ids.add(id);
  }
  const humans = cfg.humanPlayers ?? [];
  for (let i = 0; i < humans.length; i++) {
    const id = humans[i] | 0;
    if (id !== local) ids.add(id);
  }
  const ais = cfg.aiPlayers ?? [];
  for (let i = 0; i < ais.length; i++) {
    const raw = ais[i];
    const id = (typeof raw === 'number' ? raw : raw?.owner) | 0;
    if (id !== local) ids.add(id);
  }
  return [...ids];
}
