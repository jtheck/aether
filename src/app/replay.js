// Post-match command-log replay. KOTH world checkpoints stay for late-join
// catch-up; this tape is the unpruned input log so we can save the match.

export const REPLAY_KIND = 'aether-replay';
export const REPLAY_VERSION = 1;

/** @param {unknown} cmd */
export function cloneReplayCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return cmd;
  const out = { ...cmd };
  for (const key of Object.keys(out)) {
    if (Array.isArray(out[key])) out[key] = out[key].slice();
  }
  return out;
}

/** @param {object | null | undefined} frame */
export function cloneReplayFrame(frame) {
  if (!frame) return null;
  return {
    ...frame,
    commands: (frame.commands ?? []).map(cloneReplayCommand),
  };
}

function copyAiPlayers(ai) {
  if (!Array.isArray(ai)) return [];
  return ai.map((raw) => {
    if (typeof raw === 'number') return raw | 0;
    if (!raw || typeof raw !== 'object') return 0;
    const row = { owner: raw.owner | 0 };
    if (raw.temperament) row.temperament = String(raw.temperament);
    return row;
  });
}

function copyOwnerSkins(skins) {
  if (!skins || typeof skins !== 'object' || Array.isArray(skins)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(skins)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function copyOwnerColors(colors) {
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/**
 * Serializable match header — enough to rebuild the worker table.
 * Drops the garden blob; chapter / gardenUrl reload the map on playback.
 * @param {object | null | undefined} cfg
 */
export function replayConfigFromLive(cfg) {
  if (!cfg) return null;
  const humans = Array.isArray(cfg.humanPlayers)
    ? cfg.humanPlayers.map((id) => id | 0)
    : [];
  const slots = Array.isArray(cfg.activeSlots)
    ? cfg.activeSlots.map((id) => id | 0)
    : humans.slice();
  /** @type {Record<string, unknown>} */
  const out = {
    seed: (cfg.seed ?? 0) >>> 0,
    mode: cfg.mode ?? '',
    fieldSize: cfg.fieldSize ? String(cfg.fieldSize) : '',
    chapter: cfg.chapter ? String(cfg.chapter) : '',
    gardenUrl: cfg.gardenUrl ? String(cfg.gardenUrl) : '',
    activeSlots: slots,
    humanPlayers: humans.length ? humans : slots.slice(),
    aiPlayers: copyAiPlayers(cfg.aiPlayers),
    armyPerSide: cfg.armyPerSide | 0,
    teamByOwner: Array.isArray(cfg.teamByOwner) ? cfg.teamByOwner.map((id) => id | 0) : null,
    laneBases: Boolean(cfg.laneBases),
    skipDefaultSpawns: Boolean(cfg.skipDefaultSpawns),
    ownerSkins: copyOwnerSkins(cfg.ownerSkins),
    ownerColors: copyOwnerColors(cfg.ownerColors),
    matchId: cfg.matchId ? String(cfg.matchId) : '',
  };
  if (cfg.mapW) out.mapW = cfg.mapW | 0;
  if (cfg.mapH) out.mapH = cfg.mapH | 0;
  if (cfg.noCenterBlock != null) out.noCenterBlock = Boolean(cfg.noCenterBlock);
  if (cfg.agoraOccupyEndsMatch != null) out.agoraOccupyEndsMatch = cfg.agoraOccupyEndsMatch | 0;
  return out;
}

/**
 * @param {object} session
 * @param {{ names?: Record<number | string, string>, savedAt?: string }} [extra]
 */
export function buildReplayFile(session, extra = {}) {
  const config = session?.replayConfig ?? extra.config ?? null;
  const frames = (session?.exportReplayLedger?.()
    ?? session?.replayFrames
    ?? session?.exportFullLedger?.()
    ?? [])
    .map(cloneReplayFrame)
    .filter(Boolean);
  return {
    v: REPLAY_VERSION,
    kind: REPLAY_KIND,
    savedAt: extra.savedAt ?? new Date().toISOString(),
    tick: (session?.confirmedTick | 0) || 0,
    checksum: (session?._lastChecksum ?? 0) >>> 0,
    names: extra.names && typeof extra.names === 'object' ? { ...extra.names } : {},
    config,
    frames,
  };
}

/** @param {unknown} value */
export function jsonByteLength(value) {
  const text = JSON.stringify(value);
  if (typeof Blob === 'function') return new Blob([text]).size;
  return new TextEncoder().encode(text).length;
}

/** @param {number} n */
export function formatReplayBytes(n) {
  const bytes = Math.max(0, n | 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export const REPLAY_EXT = '.gecho';

/** @param {object | null | undefined} file @param {Date} [now] */
export function replayFileName(file, now = new Date()) {
  const mode = String(file?.config?.mode || 'match').replace(/[^\w-]+/g, '');
  const day = now.toISOString().slice(0, 10);
  return `aether-${mode || 'match'}-${day}${REPLAY_EXT}`;
}

const REPLAY_ACCEPT = `${REPLAY_EXT},.json,application/json`;

const REPLAY_PICKER_TYPES = [
  {
    description: 'Aether gecho',
    accept: { 'application/json': [REPLAY_EXT, '.json'] },
  },
];

/** @param {object} file */
export function downloadReplayFile(file) {
  if (typeof document === 'undefined') return false;
  const text = JSON.stringify(file);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = replayFileName(file);
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

function isAbortError(err) {
  return Boolean(err && (err.name === 'AbortError' || err.code === 20));
}

/**
 * Save via the OS folder picker when the browser allows it.
 * Cancel leaves the file unsaved. Anything else falls back to Downloads.
 * @param {object} file
 * @param {{
 *   showSaveFilePicker?: (opts: object) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>, close: () => Promise<void> }> }>,
 *   download?: (file: object) => boolean,
 * }} [api]
 * @returns {Promise<'picked' | 'cancelled' | 'download'>}
 */
export async function saveReplayToDisk(file, api = {}) {
  const picker = api.showSaveFilePicker
    ?? (typeof globalThis.showSaveFilePicker === 'function'
      ? globalThis.showSaveFilePicker.bind(globalThis)
      : null);
  const download = api.download ?? downloadReplayFile;
  const text = JSON.stringify(file);
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: replayFileName(file),
        types: REPLAY_PICKER_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return 'picked';
    } catch (err) {
      if (isAbortError(err)) return 'cancelled';
    }
  }
  download(file);
  return 'download';
}

/**
 * @param {unknown} raw
 */
export function parseReplayFile(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Replay file is not valid JSON');
    }
  }
  if (!data || typeof data !== 'object') throw new Error('Not an Aether replay');
  if (data.kind !== REPLAY_KIND) throw new Error('Not an Aether replay');
  if ((data.v | 0) !== REPLAY_VERSION) throw new Error('Unsupported replay version');
  if (!data.config || typeof data.config !== 'object') throw new Error('Replay is missing match config');
  if (!Array.isArray(data.frames)) throw new Error('Replay is missing frames');
  const config = replayConfigFromLive(data.config);
  if (!config) throw new Error('Replay is missing match config');
  return {
    v: REPLAY_VERSION,
    kind: REPLAY_KIND,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
    tick: data.tick | 0,
    checksum: (data.checksum ?? 0) >>> 0,
    names: data.names && typeof data.names === 'object' && !Array.isArray(data.names)
      ? { ...data.names }
      : {},
    config,
    frames: data.frames.map(cloneReplayFrame).filter(Boolean),
  };
}

/** @param {object | null | undefined} file */
export function replayEndTick(file) {
  let end = file?.tick | 0;
  for (const frame of file?.frames ?? []) {
    const tick = frame?.tick | 0;
    if (tick > end) end = tick;
  }
  return Math.max(0, end);
}

/**
 * Local spectator config that rebuilds the worker table from a saved tape.
 * @param {object} file
 * @param {{
 *   garden?: object | null,
 *   skipSplash?: boolean,
 *   loadingLabel?: string,
 * }} [extra]
 */
export function liveConfigFromReplay(file, extra = {}) {
  const config = file?.config;
  if (!config) throw new Error('Replay is missing match config');
  const humans = Array.isArray(config.humanPlayers) && config.humanPlayers.length
    ? config.humanPlayers.map((id) => id | 0)
    : (config.activeSlots ?? []).map((id) => id | 0);
  const slots = Array.isArray(config.activeSlots) && config.activeSlots.length
    ? config.activeSlots.map((id) => id | 0)
    : humans.slice();
  const garden = extra.garden ?? null;
  return {
    ...config,
    humanPlayers: humans,
    activeSlots: slots,
    aiPlayers: Array.isArray(config.aiPlayers) ? config.aiPlayers : [],
    localPlayerId: -1,
    role: 'spectator',
    localSolo: true,
    inputEnabled: false,
    reset: true,
    fog: true,
    sharedVision: true,
    watchingReplay: true,
    skipSplash: extra.skipSplash === true,
    loadingLabel: extra.loadingLabel ?? 'Loading replay…',
    garden,
    skipDefaultSpawns: config.skipDefaultSpawns
      ?? Boolean(garden?.story || garden?.obj || (garden?.u && garden.u.length)),
  };
}

function replayFileInput() {
  if (typeof document === 'undefined') return null;
  let input = document.getElementById('replay-file');
  if (input) return /** @type {HTMLInputElement} */ (input);
  input = document.createElement('input');
  input.type = 'file';
  input.id = 'replay-file';
  input.accept = REPLAY_ACCEPT;
  input.hidden = true;
  document.body.append(input);
  return input;
}

function pickReplayTextViaInput() {
  const input = replayFileInput();
  if (!input) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (text) => {
      input.value = '';
      input.onchange = null;
      resolve(text);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      file.text().then((text) => finish(text)).catch(() => finish(null));
    };
    input.click();
  });
}

/**
 * @param {{
 *   showOpenFilePicker?: (opts: object) => Promise<Array<{ getFile: () => Promise<File> }>>,
 *   pickViaInput?: () => Promise<string | null>,
 * }} [api]
 * @returns {Promise<string | null>}
 */
export async function pickReplayText(api = {}) {
  const picker = api.showOpenFilePicker
    ?? (typeof globalThis.showOpenFilePicker === 'function'
      ? globalThis.showOpenFilePicker.bind(globalThis)
      : null);
  if (picker) {
    try {
      const handles = await picker({
        multiple: false,
        types: REPLAY_PICKER_TYPES,
      });
      const handle = handles?.[0];
      if (!handle) return null;
      const file = await handle.getFile();
      return await file.text();
    } catch (err) {
      if (isAbortError(err)) return null;
    }
  }
  const viaInput = api.pickViaInput ?? pickReplayTextViaInput;
  return viaInput();
}
