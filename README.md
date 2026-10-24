The Garden of Aether

Current game: `src/`. What ships: `DEPLOY/` (`npm run package` in `src/`, then `.\deploy-live.ps1`).

The deprecated Babylon 9 client lives in `legacy/` (`index.html`, `game/`, `vendor/babylon9*`). Shared art stays at repo-root `assets/`.

## Ladder Lambda

Ranked ladder is the existing function `aether-ladder` in `us-west-2`. Update that function. `deploy-live.ps1` does not ship it. The function URL is in `src/app/ladderApi.js`.

Runtime `nodejs22.x`, handler `index.handler`, no layers. The runtime supplies the AWS SDK, so the zip is source only. `package.json` must stay `"type": "module"` and must be in the zip. Leave out `store.js`, tests, and `node_modules`.

From `ladder/`:

```
tar -a -cf aether-ladder.zip index.js index.mjs handler.js report.js elo.js publish.js awsStore.js queue.js package.json recent.js snapshot.js
aws lambda update-function-code --function-name aether-ladder --region us-west-2 --zip-file fileb://aether-ladder.zip
aws lambda wait function-updated --function-name aether-ladder --region us-west-2
```

`index.js` re-exports `index.mjs` because Lambda resolves `index.handler` to `index.js` first. A bad `?player=` id returns 400 once the new code is live. Player history (`recent.js`) is written on the next settled match. A row may include `replay`, a workshop published file id, only when that player saved one. The history table does not show it. A row may include `matchId`. The agreed graph is one object, `ladder/matches/{matchId}.json`, also readable as `?match=`. The name-click UI ships with the game client.