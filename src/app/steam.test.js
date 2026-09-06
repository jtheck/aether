import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACH_FIRST_LAUNCH,
  ACH_FIRST_MATCH,
  ACH_KOTH_DEFEAT,
  ACH_LINUX_LAUNCH,
  createAetherSteam,
  isKothAgoraDefeat,
  isLinuxRuntime,
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

describe('createAetherSteam', () => {
  it('no-ops when the desktop bridge is missing', () => {
    const steam = createAetherSteam({ root: {} });
    assert.equal(steam.isAvailable(), false);
    assert.equal(steam.notifyPlayReady(), false);
    assert.equal(steam.notifyKothLobbyCreated(), false);
    assert.equal(steam.notifyKothDefeat({ matchWinner: 1, localPlayerId: 0 }), false);
    assert.equal(steam.unlockAchievement(ACH_FIRST_LAUNCH), false);
    assert.deepEqual(steam.ownedPacks(), []);
    assert.equal(steam.ownsPack(DLC_FIRST_RESPONDER), false);
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
    assert.deepEqual(stub.presence, [['status', 'In Garden']]);
  });

  it('unlocks a KOTH agora-capture defeat once', () => {
    const stub = fakeSteam();
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.notifyKothDefeat({ matchWinner: 0, localPlayerId: 0, role: 'player' }), false);
    const loss = { matchWinner: 1, localPlayerId: 0, role: 'player', agoras: [{ captured: 1 }] };
    assert.equal(steam.notifyKothDefeat(loss), true);
    assert.equal(steam.notifyKothDefeat(loss), false);
    assert.deepEqual(stub.unlocked, [ACH_KOTH_DEFEAT]);
    assert.deepEqual(stub.presence, [['status', 'Defeated']]);
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

  it('unlocks first KOTH lobby create once', () => {
    const stub = fakeSteam();
    const steam = createAetherSteam({ steam: () => stub.api });
    assert.equal(steam.notifyKothLobbyCreated(), true);
    assert.equal(steam.notifyKothLobbyCreated(), false);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_MATCH]);
    assert.deepEqual(stub.presence, [['status', 'Hosting KOTH']]);
  });

  it('test() unlocks the named achievement when available', () => {
    const stub = fakeSteam();
    const steam = createAetherSteam({ steam: () => stub.api });
    const result = steam.test(ACH_FIRST_MATCH);
    assert.equal(result.unlocked, true);
    assert.equal(result.achievementId, ACH_FIRST_MATCH);
    assert.deepEqual(stub.unlocked, [ACH_FIRST_MATCH]);
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
