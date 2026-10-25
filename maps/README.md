# House maps

Served at `/maps/…` from repo root (same idea as `/assets/`).

| Folder | Gametype / use |
|--------|----------------|
| `adventure/` | Shipped `.campaign` bundle (Forge export → `adventure.campaign`) |
| `skirmish/` | Official skirmish gardens + `index.json` (1v1 and teams lobby map picker) |
| `koth/` | Authored KOTH garden (optional URL load) |
| `dev/` | Internal tools - unit tester, stress snapshot |

`skirmish/index.json` is the file list. The lobby reads each `.garden` for its name (`n`) and agora count (`g`). Two or more starts show in 1v1. More than two also show in Teams. Gardens are loaded as `/maps/skirmish/<file>`.

Regenerate official skirmish gardens: `node scripts/generate-map.mjs`  
Regenerate `dev/*.garden` from `src/sim/testerGarden.js` and `src/sim/stressGarden.js`.
