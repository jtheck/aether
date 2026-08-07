// Player + graphics preferences, following v1's paradigm: one localStorage key
// per setting holding a plain string, read back through a getter with a default.
// Keys are kept identical to v1 (`shadowMode`, `playerName`, `playerColor`) so a
// browser that already played v1 carries its profile over.

const SHADOW_KEY = 'shadowMode';
const NAME_KEY = 'playerName';
const COLOR_KEY = 'playerColor';

/** v1 label set, kept verbatim so the slider reads the same in both versions. */
export const SHADOW_LABELS = ['Off', 'Low', 'Med', 'Full'];

// v1's Low/Med were blob shadows drawn under each unit; Lite only ships CSM, so
// the tiers are cascade count x map size instead. Two cascades is the floor —
// a single cascade renders the scene black.
//
// Index 0 (Off) still carries dimensions: the generator is always constructed
// (see renderer.js — detaching it poisons the near cascade on re-enable), so Off
// allocates the cheapest depth texture we can and just stops feeding it casters.
export const SHADOW_TIERS = [
  { numCascades: 2, mapSize: 1024 },
  { numCascades: 2, mapSize: 1024 },
  { numCascades: 3, mapSize: 2048 },
  { numCascades: 4, mapSize: 2048 },
];

/** Fallback when the GPU is unrecognised or storage is unavailable. */
export const DEFAULT_SHADOW_MODE = 2;

export const PLAYER_NAMES = [
  'Cultivator', 'Gardener', 'Bloomwarden',
  'Planter', 'Weaver', 'Luminary',
  'Void-Caller', 'Astral Heart', 'Aetherean',
  'Architect', 'Steward', 'Warden',
  'Overseer', 'Commander', 'Strategist',
  'Sovereign', 'Chancellor', 'Arbiter',
  'Verdantheart', 'Greenwarden', 'Rootwarden',
  'Sporecaller', 'Starweaver', 'Voidbinder',
  'Aetherium', 'Starchild', 'Regent',
  'Magistrate', 'Highwarden', 'Ordinator',
  'Director', 'Conductor', 'Oathkeeper',
  'Dawncaller', 'Sunstone', 'Moonshadow',
  'Genesis', 'Nexus', 'Crucible',
  'Lodestar', 'Keystone', 'Player',
];

export const PLAYER_COLORS = [
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#FF0000', name: 'Red' },
  { hex: '#0000FF', name: 'Blue' },
  { hex: '#00FFFF', name: 'Teal' },
  { hex: '#800080', name: 'Purple' },
  { hex: '#FFFF00', name: 'Yellow' },
  { hex: '#FFA500', name: 'Orange' },
  { hex: '#008000', name: 'Green' },
  { hex: '#FFB6C1', name: 'Light Pink' },
  { hex: '#8A2BE2', name: 'Violet' },
  { hex: '#D3D3D3', name: 'Light Grey' },
  { hex: '#006400', name: 'Dark Green' },
  { hex: '#A52A2A', name: 'Brown' },
  { hex: '#00FF00', name: 'Light Green' },
  { hex: '#696969', name: 'Dark Grey' },
  { hex: '#FFC0CB', name: 'Pink' },
];

/** Storage throws in private-mode Safari and when cookies are blocked. */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference just won't survive the session */
  }
}

/** @returns {number} 0..3 */
export function getShadowMode() {
  const raw = Number.parseInt(read(SHADOW_KEY) ?? '', 10);
  if (!Number.isInteger(raw) || raw < 0 || raw >= SHADOW_TIERS.length) {
    return DEFAULT_SHADOW_MODE;
  }
  return raw;
}

export function setShadowMode(mode) {
  const clamped = Math.max(0, Math.min(SHADOW_TIERS.length - 1, mode | 0));
  write(SHADOW_KEY, String(clamped));
  return clamped;
}

/**
 * Shadow mode for this session. `?shadows=0` is a one-off override for
 * profiling — it forces Off without overwriting the saved preference.
 */
export function resolveShadowMode() {
  if (new URLSearchParams(location.search).get('shadows') === '0') return 0;
  return getShadowMode();
}

/**
 * First-run tier, inferred from the GPU's reported class.
 *
 * WebGPU exposes no performance metric by design, and measuring at boot is
 * actively misleading on power-limited laptops: the first several seconds run
 * on a burst power budget, so a probe samples the boosted clock and picks a
 * tier the machine cannot sustain once it settles. Vendor + architecture is
 * coarse but honest, costs one await, and only seeds the initial value.
 *
 * @param {{ vendor?: string, architecture?: string } | null} info
 */
export function shadowModeForAdapter(info) {
  const vendor = String(info?.vendor ?? '').toLowerCase();
  const arch = String(info?.architecture ?? '').toLowerCase();
  if (!vendor) return DEFAULT_SHADOW_MODE;
  // Software rasterisers (WARP, SwiftShader, llvmpipe) can't afford any.
  if (vendor === 'microsoft' || vendor === 'mesa' || arch.includes('swiftshader')) return 0;
  // Tile-based mobile parts.
  if (vendor === 'qualcomm' || vendor === 'arm' || vendor === 'imagination' || vendor === 'broadcom') {
    return 1;
  }
  // Intel names its integrated parts gen-9 / gen-11 / gen-12lp (this laptop's
  // Iris Xe); the Arc/Xe line uses other strings and is a class above.
  if (vendor === 'intel') return arch.startsWith('gen-') ? 1 : 2;
  if (vendor === 'nvidia') return 3;
  // AMD reuses architecture names across APUs and discrete cards, and Apple
  // silicon spans a wide range — neither can be split apart from here.
  return DEFAULT_SHADOW_MODE;
}

/**
 * Seed the saved shadow mode from the GPU on first run. No-op once the user (or
 * a previous run) has a stored preference, so it never overrides a real choice.
 */
export async function ensureShadowModeDefault() {
  if (read(SHADOW_KEY) !== null) return getShadowMode();

  let mode = DEFAULT_SHADOW_MODE;
  let info = null;
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter?.isFallbackAdapter) {
      mode = 0;
    } else {
      // adapter.info is the current surface; requestAdapterInfo() the older one.
      info = adapter?.info ?? (await adapter?.requestAdapterInfo?.()) ?? null;
      mode = shadowModeForAdapter(info);
    }
  } catch {
    /* keep the fallback */
  }

  console.info(
    `[settings] shadow default ${SHADOW_LABELS[mode]} for ${info?.vendor || 'unknown gpu'}`
    + `${info?.architecture ? `/${info.architecture}` : ''}`,
  );
  return setShadowMode(mode);
}

export function shadowTier(mode) {
  return SHADOW_TIERS[Math.max(0, Math.min(SHADOW_TIERS.length - 1, mode | 0))];
}

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * v1 rolled a random name every boot and only persisted it once the field was
 * edited, so an untouched profile changed identity each session. Persist the
 * first roll instead.
 */
export function getPlayerName() {
  const saved = read(NAME_KEY);
  if (saved) return saved;
  const rolled = randomOf(PLAYER_NAMES);
  write(NAME_KEY, rolled);
  return rolled;
}

export function setPlayerName(name) {
  const trimmed = String(name ?? '').trim().slice(0, 24);
  const next = trimmed || randomOf(PLAYER_NAMES);
  write(NAME_KEY, next);
  return next;
}

export function getPlayerColor() {
  const saved = read(COLOR_KEY);
  if (saved && PLAYER_COLORS.some((c) => c.hex === saved)) return saved;
  const rolled = randomOf(PLAYER_COLORS).hex;
  write(COLOR_KEY, rolled);
  return rolled;
}

export function setPlayerColor(hex) {
  const next = PLAYER_COLORS.some((c) => c.hex === hex) ? hex : PLAYER_COLORS[0].hex;
  write(COLOR_KEY, next);
  return next;
}
