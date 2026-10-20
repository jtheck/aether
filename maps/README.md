# House maps

Served at `/maps/…` from repo root (same idea as `/assets/`).

| Folder | Gametype / use |
|--------|----------------|
| `adventure/` | Shipped `.campaign` bundle (Forge export → `adventure.campaign`) |
| `1v1/` | Official 1 vs 1 gardens + `index.json` (lobby map picker) |
| `teams/` | Official Teams gardens + `index.json` |
| `koth/` | Authored KOTH garden (optional URL load) |
| `dev/` | Internal tools — unit tester, stress snapshot |

Each competitive folder’s `index.json` lists `{ "file", "name", "mapType" }` entries. Gardens are loaded as `/maps/<folder>/<file>`.

Regenerate sample 1v1/teams gardens: `node scripts/generate-map.js`  
Regenerate `dev/*.garden` from `src/sim/testerGarden.js` and `src/sim/stressGarden.js`.
