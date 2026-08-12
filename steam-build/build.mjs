import nwbuild from 'nw-builder';

const arg = process.argv[2] || 'win';
const platform = arg === 'linux' ? 'linux' : 'win';
const outDir = process.env.AETHER_DIST_DIR || (platform === 'linux' ? './dist-linux' : './dist-win');

await nwbuild({
  mode: 'build',
  srcDir: './app',
  version: 'latest',
  flavor: 'normal',
  platform,
  arch: 'x64',
  outDir,
  glob: false,
  managedManifest: true,
  app: {
    name: 'Aether',
    icon: platform === 'linux' ? './app/build/icon.png' : './app/build/icon.ico',
  },
});

console.log('[steam-build] Built to ' + outDir + '/ (' + platform + ' x64)');
