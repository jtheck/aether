// Steam's Linux shell is NW.js. `process.platform` is set there; a normal
// browser only has the user agent. Android's UA contains "Linux" too.

export function isLinuxGpu() {
  try {
    if (globalThis.process?.platform === 'linux') return true;
  } catch {
    /* process can be a restricted getter */
  }
  const ua = globalThis.navigator?.userAgent || '';
  return /Linux/i.test(ua) && !/Android/i.test(ua);
}
