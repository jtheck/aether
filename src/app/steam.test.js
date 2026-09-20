import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACH_FIRST_LAUNCH,
  ACH_FIRST_MATCH,
  ACH_KOTH_DEFEAT,
  ACH_LINUX_LAUNCH,
  ACH_FORGE_OPEN,
  createAetherSteam,
  createSteamOverlayGuard,
  isKothAgoraDefeat,
  isLinuxRuntime,
  isSteamOverlayHotkey,
} from './steam.js';
import { DLC_FIRST_RESPONDER, DLC_FIRST_RESPONDER_APP_ID } from './dlcCatalog.js';

function fakeSteam(opts = {}) {
  const unlocked = [];
  const presence = [];
  return {
    available: opts.available !== false,
    unlocked,
    presence,
    api: {
      isAvailable: () => opts.available !== false,
      getInfo: () => ({
        available: opts.available !== false,
        appId: 5043860,
        platform: opts.platform,
        dlc: opts.dlc ?? [],
      }),
      unlockAchievement: (name) => {
        unlocked.push(name);
        return true;
      },
      isAchievementUnlocked: (name) => unlocked.includes(name),
      setPresence: (key, value) => {
        presence.push([key, value]);
        return true;
      },
    },
  };
}

describe('isSteamOverlayHotkey', () => {
  it('is only Shift+Tab', () => {
    assert.equal(isSteamOverlayHotkey({ key: 'Tab', shiftKey: true }), true);
    assert.equal(isSteamOverlayHotkey({ key: 'Tab', shiftKey: false }), false);
    assert.equal(isSteamOverlayHotkey({ key: 'Tab', shiftKey: true, ctrlKey: true }), false);
  });
});

describe('createSteamOverlayGuard', () => {
  it('opens Friends on Shift+Tab and yields until click or Steam close', () => {
    const opened = [];
    const listeners = new Map();
    const win = {
      addEventListener(type, fn) {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener() {},
    };
    const guard = createSteamOverlayGuard({
      window: win,
      root: { aetherDesktop: {}, window: win },
      steam: {
        isAvailable: () => true,
        openOverlay: (d) => opened.push(d),
        overlayActive: () => false,
      },
      interval: () => 1,
      clearInterval() {},
    });
    const ev = { key: 'Tab', shiftKey: true, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
    for (const fn of listeners.get('keydown') ?? []) fn(ev);
    assert.equal(ev.prevented, true);
    assert.deepEqual(opened, ['Friends']);
    assert.equal(guard.isActive(), true);
    for (const fn of listeners.get('pointerdown') ?? []) fn({});
    assert.equal(guard.isActive(), false);
    guard.setRemote(true);
    assert.equal(guard.isActive(), true);
    guard.setRemote(false);
    assert.equal(guard.isActive(), false);
    guard.dispose();
  });
});

describe('createAetherSteam', () => {
  it('no-ops when the desktop bridge is missing', async () => {
    const steam = createAetherSteam({ root: {} });
    assert.equal(steam.isAvailable(), false);
    assert.equal(steam.notifyPlayReady(), false);
    assert.equal(steam.notifyKothLobbyCreated(), false);
    assert.equal(steam.notifyForgeOpened(), false);
    assert.equal(steam.notifyKothDefeat({ matchWinner: 1, localPlayerId: 0 }), false);
    assert.equal(steam.unlockAchievement(ACH_FIRST_LAUNCH), false);
    assert.deepEqual(steam.ownedPacks(), []);
    assert.equal(steam.ownsPack(DLC_FIRST_RESPONDER), false);
    assert.deepEqual(await steam.listWorkshopMaps(), []);
    assert.equal(await steam.loadWorkshopGarden('1'), null);
    assert.deepEqual(await steam.publishWorkshopGarden({ garden: { v: 4, w: 8, h: 8 } }), {
      ok: false,
      error: 'workshop unavailable',
    });
    assert.equal(steam.downloadWorkshopItem('1'), false);
    assert.equal(steam.openOverlay('workshop'), false);
    assert.equal(steam.overlayActive(), false);
    assert.deepEqual(await steam.showGamepadTextInput({ description: 'Name' }), {
      ok: false,
      submitted: false,
      text: '',
    });
  });

  it('lists and loads workshop gardens from the desktop bridge', async () => {
    const garden = { v: 4, n: 'Grove', w: 8, h: 8 };
    const stub = fakeSteam();
    stub.api.listWorkshopMaps = async () => [{ id: '99', title: 'Grove', gardens: [{ file: 'map.garden', name: 'Grove' }] }];
    stub.api.loadWorkshopGarden = async (id, file) => (id === '99' && !file ? garden : null);
    stub.api.downloadWorkshopItem = (id) => id === '99';
    const steam = createAetherSteam({ steam: () => stub.api });
    const items = await steam.listWorkshopMaps();
    assert.equal(items[0].id, '99');
    assert.deepEqual(await steam.loadWorkshopGarden('99'), garden);
    assert.equal(steam.downloadWorkshopItem('99'), true);
  });

  it('reads overlay-active from the desktop bridge', () => {
    const stub = fakeSteam();
    stub.api.overlayActive = () => true;
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.overlayActive(), true);
  });

  it('asks the desktop bridge for a gamepad keyboard', async () => {
    const stub = fakeSteam();
    stub.api.showGamepadTextInput = async (body) => ({
      ok: true,
      submitted: true,
      text: body.existing,
    });
    const steam = createAetherSteam({ steam: () => stub.api });
    const result = await steam.showGamepadTextInput({ existing: 'Warden' });
    assert.equal(result.ok, true);
    assert.equal(result.submitted, true);
    assert.equal(result.text, 'Warden');
  });

  it('publishes a garden through the desktop bridge', async () => {
    const stub = fakeSteam();
    stub.api.publishWorkshopGarden = async (body) => ({ ok: true, id: '55', title: body.title });
    const steam = createAetherSteam({ steam: () => stub.api });
    const result = await steam.publishWorkshopGarden({ garden: { v: 4, w: 8, h: 8 }, title: 'Grove' });
    assert.equal(result.ok, true);
    assert.equal(result.id, '55');
  });

  it('maps owned Steam DLC app ids onto catalog packs', () => {
    const stub = fakeSteam({
      dlc: [{ appId: DLC_FIRST_RESPONDER_APP_ID, owned: true }],
    });
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.deepEqual(steam.ownedPacks(), [DLC_FIRST_RESPONDER]);
    assert.equal(steam.ownsPack(DLC_FIRST_RESPONDER), true);
  });

  it('unlocks first launch once, and retries if Steam is late', () => {
    const stub = fakeSteam({ available: false });
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.notifyPlayReady(), false);
    assert.deepEqual(stub.unlocked, []);
    stub.available = true;
    stub.api.isAvailable = () => true;
    stub.api.getInfo = () => ({ available: true });
    assert.equal(steam.notifyPlayReady(), true);
    assert.equal(steam.notifyPlayReady(), false);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_LAUNCH]);
    assert.deepEqual(stub.presence, [['status', 'gardening']]);
  });

  it('unlocks a KOTH agora-capture defeat once', () => {
    const stub = fakeSteam();
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.notifyKothDefeat({ matchWinner: 0, localPlayerId: 0, role: 'player' }), false);
    const loss = { matchWinner: 1, localPlayerId: 0, role: 'player', agoras: [{ captured: 1 }] };
    assert.equal(steam.notifyKothDefeat(loss), true);
    assert.equal(steam.notifyKothDefeat(loss), false);
    assert.deepEqual(stub.unlocked, [ACH_KOTH_DEFEAT]);
    assert.deepEqual(stub.presence, []);
  });

  it('unlocks linux launch on the native linux shell', () => {
    const stub = fakeSteam({ platform: 'linux' });
    const steam = createAetherSteam({ steam: () => stub.api, root: {} });
    assert.equal(steam.notifyPlayReady(), true);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_LAUNCH, ACH_LINUX_LAUNCH]);
  });

  it('does not unlock linux launch on windows', () => {
    const stub = fakeSteam({ platform: 'win32' });
    const steam = createAetherSteam({
      steam: () => stub.api,
      root: { navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' } },
    });
    assert.equal(steam.notifyPlayReady(), true);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_LAUNCH]);
  });

  it('unlocks forge open once, and retries if Steam is late', () => {
    const stub = fakeSteam({ available: false });
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.notifyForgeOpened(), false);
    assert.deepEqual(stub.unlocked, []);
    stub.available = true;
    stub.api.isAvailable = () => true;
    stub.api.getInfo = () => ({ available: true });
    assert.equal(steam.notifyForgeOpened(), true);
    assert.equal(steam.notifyForgeOpened(), false);
    assert.deepEqual(stub.unlocked, [ACH_FORGE_OPEN]);
    assert.deepEqual(stub.presence, [['status', 'forging garden']]);
  });

  it('unlocks first KOTH lobby create once', () => {
    const stub = fakeSteam();
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.notifyKothLobbyCreated(), true);
    assert.equal(steam.notifyKothLobbyCreated(), false);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_MATCH]);
    assert.deepEqual(stub.presence, [['status', 'hosting garden']]);
  });

  it('test() unlocks the named achievement when available', () => {
    const stub = fakeSteam();
    const steam = createAetherSteam({ steam: () => stub.api });
    const result = steam.test(ACH_FIRST_MATCH);
    assert.equal(result.unlocked, true);
    assert.equal(result.achievementId, ACH_FIRST_MATCH);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_MATCH]);
    assert.deepEqual(stub.presence, []);
  });
});

describe('isLinuxRuntime', () => {
  it('trusts the steam worker platform first', () => {
    assert.equal(isLinuxRuntime({ platform: 'linux' }, {}), true);
    assert.equal(isLinuxRuntime({ platform: 'win32' }, {}), false);
  });

  it('accepts a browser-like linux UA and ignores android / node', () => {
    assert.equal(isLinuxRuntime({}, {
      navigator: { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120' },
    }), true);
    assert.equal(isLinuxRuntime({}, {
      navigator: { platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' },
    }), false);
    assert.equal(isLinuxRuntime({}, { navigator: { userAgent: 'Node.js/22' } }), false);
  });
});

describe('isKothAgoraDefeat', () => {
  it('is only a local player agora-capture loss', () => {
    const captured = [{ captured: 1 }];
    assert.equal(isKothAgoraDefeat({ matchWinner: 1, localPlayerId: 0, role: 'player', agoras: captured }), true);
    assert.equal(isKothAgoraDefeat({ matchWinner: 0, localPlayerId: 0, role: 'player', agoras: captured }), false);
    assert.equal(isKothAgoraDefeat({ matchWinner: 1, localPlayerId: 0, role: 'spectator', agoras: captured }), false);
    assert.equal(isKothAgoraDefeat({ matchWinner: -1, localPlayerId: 0, role: 'player', agoras: captured }), false);
    assert.equal(isKothAgoraDefeat({ matchWinner: 1, localPlayerId: 0, role: 'player' }), false);
    assert.equal(isKothAgoraDefeat({ localPlayerId: 0, role: 'player' }), false);
  });
});
