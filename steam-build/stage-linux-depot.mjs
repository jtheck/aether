import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'dist-linux');
const staged = path.join(root, 'dist-linux-depot');
const x64 = path.join(staged, 'linux64');

if (!fs.existsSync(path.join(source, 'Aether'))) {
  throw new Error('[steam-build] dist-linux/Aether missing');
}

fs.rmSync(staged, { recursive: true, force: true });
fs.mkdirSync(staged, { recursive: true });
fs.cpSync(source, x64, { recursive: true });

const dispatcher = `#!/bin/sh
set -eu
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
case "$(uname -m)" in
  aarch64|arm64) exec "$HERE/linux-arm64/Aether.sh" "$@" ;;
  *) exec "$HERE/linux64/Aether.sh" "$@" ;;
esac
`;

fs.writeFileSync(path.join(staged, 'Aether'), dispatcher);
try {
  fs.chmodSync(path.join(staged, 'Aether'), 0o755);
} catch {
  // SteamPipe applies the executable mode when cross-building on Windows.
}

console.log('[steam-build] Staged Linux x86-64 depot with root architecture dispatcher');
