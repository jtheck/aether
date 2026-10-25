/** Shipped King of the Hill board (`maps/koth/koth.garden`, name KOTH1). */
export const KOTH_AUTHORED_GARDEN_URL = '/maps/koth/koth.garden';

/** @type {Promise<object> | null} */
let authoredGarden = null;

/**
 * @param {(url: string) => Promise<object>} [loadGarden]
 */
export function loadKothAuthoredGarden(loadGarden) {
  if (!authoredGarden) {
    const load = loadGarden ?? (async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`garden ${res.status}`);
      return res.json();
    });
    authoredGarden = Promise.resolve()
      .then(() => load(KOTH_AUTHORED_GARDEN_URL))
      .catch((err) => {
        authoredGarden = null;
        throw err;
      });
  }
  return authoredGarden;
}

/**
 * Attach KOTH1 for a King of the Hill lobby. Leaves the match seed alone
 * so army drops still vary; the board always comes from the garden.
 * A garden already on the config, a local solo match, or any other mode is unchanged.
 * @param {object | null | undefined} cfg
 * @param {(url: string) => Promise<object>} [loadGarden]
 */
export async function attachKothAuthoredGarden(cfg, loadGarden) {
  if (!cfg || cfg.garden || cfg.localSolo) return cfg;
  if (cfg.mode && cfg.mode !== 'koth') return cfg;
  const garden = await loadKothAuthoredGarden(loadGarden);
  const mapW = garden?.w ?? garden?.width;
  const mapH = garden?.h ?? garden?.height;
  return {
    ...cfg,
    garden,
    gardenUrl: KOTH_AUTHORED_GARDEN_URL,
    ...(mapW ? { mapW: mapW | 0 } : {}),
    ...(mapH ? { mapH: mapH | 0 } : {}),
  };
}
