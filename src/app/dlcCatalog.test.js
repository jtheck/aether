import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT } from '../sim/unitTypes.js';
import { UNIT_MODEL_URLS } from '../render/unitModels.js';
import {
  DEFAULT_SKIN_ID,
  DLC_FIRST_RESPONDER,
  DLC_FIRST_RESPONDER_APP_ID,
  activePackId,
  localOwnedPacks,
  ownerSkinsFromRoster,
  ownerSkinsFromSeats,
  packsOwnedFromSteamDlc,
  queryDlcPacks,
  allDlcMeshUrls,
  allDlcVatDefs,
  resolveBuildingModelUrl,
  resolveUnitModelUrl,
  resolveVatDef,
  selectedBuildingSkins,
  selectedSkins,
  skinChoicesForUnit,
  skinMenuModel,
} from './dlcCatalog.js';

describe('dlcCatalog', () => {
  it('maps Steam app 5217980 onto first_responder', () => {
    assert.deepEqual(
      packsOwnedFromSteamDlc([{ appId: DLC_FIRST_RESPONDER_APP_ID, owned: true }]),
      [DLC_FIRST_RESPONDER],
    );
    assert.deepEqual(packsOwnedFromSteamDlc([{ appId: DLC_FIRST_RESPONDER_APP_ID, owned: false }]), []);
  });

  it('honors ?dlc= only on localhost', () => {
    assert.deepEqual(queryDlcPacks('?dlc=first_responder', 'localhost'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(queryDlcPacks('?dlc=all', '127.0.0.1'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(queryDlcPacks('?dlc=first_responder', 'aether.garden'), []);
    assert.deepEqual(localOwnedPacks([], '?dlc=first_responder', 'localhost'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(localOwnedPacks([], '?dlc=first_responder', 'aether.garden'), []);
    assert.deepEqual(localOwnedPacks([DLC_FIRST_RESPONDER], '?dlc=first_responder', 'aether.garden'), [DLC_FIRST_RESPONDER]);
    assert.deepEqual(localOwnedPacks([], ''), []);
    assert.equal(activePackId([DLC_FIRST_RESPONDER]), DLC_FIRST_RESPONDER);
    assert.equal(activePackId([]), null);
  });

  it('resolves the First Responder priest and falls back for other units', () => {
    assert.equal(
      resolveUnitModelUrl(UNIT.PRIEST, DLC_FIRST_RESPONDER),
      '/assets/models/dlc/first_responder/priest-DLC1.glb',
    );
    assert.equal(resolveUnitModelUrl(UNIT.PRIEST, null), UNIT_MODEL_URLS[UNIT.PRIEST]);
    assert.equal(resolveUnitModelUrl(UNIT.WARRIOR, DLC_FIRST_RESPONDER), UNIT_MODEL_URLS[UNIT.WARRIOR]);
    assert.equal(resolveVatDef(UNIT.VILLAGER, DLC_FIRST_RESPONDER)?.url, '/assets/models/villager.glb');
    assert.equal(
      resolveVatDef(UNIT.CHAMPION, DLC_FIRST_RESPONDER)?.url,
      '/assets/models/dlc/first_responder/champion-DLC1.glb',
    );
    assert.equal(resolveVatDef(UNIT.CHAMPION, DLC_FIRST_RESPONDER)?.attackClip, 'Attack_Swing');
    assert.equal(resolveVatDef(UNIT.CHAMPION, null)?.url, '/assets/models/champion.glb');
    assert.equal(
      allDlcVatDefs().some((def) => def.url.endsWith('/champion-DLC1.glb') && def.idleClip === 'Idle'),
      true,
    );
    assert.equal(allDlcMeshUrls().some((url) => url.includes('champion')), false);
  });

  it('resolves the First Responder church skin', () => {
    assert.equal(
      resolveBuildingModelUrl('church', DLC_FIRST_RESPONDER),
      '/assets/models/dlc/first_responder/church-DLC1.glb',
    );
    assert.equal(
      resolveBuildingModelUrl('church', null),
      '/assets/models/church.glb',
    );
    assert.deepEqual(selectedBuildingSkins([DLC_FIRST_RESPONDER], {}), {
      church: DLC_FIRST_RESPONDER,
    });
  });

  it('maps lobby seats and KOTH roster onto per-unit skins', () => {
    assert.deepEqual(ownerSkinsFromSeats([
      { kind: 'human', index: 0, dlc: [DLC_FIRST_RESPONDER] },
      { kind: 'human', index: 1, dlc: [] },
      { kind: 'empty', index: 2 },
    ]), { 0: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER, [UNIT.CHAMPION]: DLC_FIRST_RESPONDER } });
    assert.deepEqual(ownerSkinsFromSeats([
      { kind: 'human', index: 0, skins: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } },
    ]), { 0: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } });
    assert.deepEqual(ownerSkinsFromRoster(
      [
        { state: 'active', playerId: 0, userId: 'a' },
        { state: 'active', playerId: 1, userId: 'b' },
      ],
      new Map([['b', { [UNIT.PRIEST]: DLC_FIRST_RESPONDER }]]),
    ), { 1: { [UNIT.PRIEST]: DLC_FIRST_RESPONDER } });
  });

  it('lets a saved Default beat the auto-owned pack, and lists several choices', () => {
    assert.deepEqual(selectedSkins([DLC_FIRST_RESPONDER], {}), {
      [UNIT.PRIEST]: DLC_FIRST_RESPONDER,
      [UNIT.CHAMPION]: DLC_FIRST_RESPONDER,
    });
    assert.deepEqual(selectedSkins([DLC_FIRST_RESPONDER], { [UNIT.PRIEST]: DEFAULT_SKIN_ID }), {
      [UNIT.CHAMPION]: DLC_FIRST_RESPONDER,
    });
    const choices = skinChoicesForUnit(UNIT.PRIEST, [DLC_FIRST_RESPONDER]);
    assert.equal(choices[0].id, DEFAULT_SKIN_ID);
    assert.equal(choices.length, 2);
    assert.equal(choices[1].id, DLC_FIRST_RESPONDER);
  });

  it('lists priest looks for players who do not own the pack, with that choice disabled', () => {
    const locked = skinMenuModel([]);
    assert.equal(locked.length, 3);
    assert.equal(locked[0].kind, 'unit');
    assert.equal(locked[0].label, 'Priest');
    const lockedChamp = locked.find((row) => row.id === UNIT.CHAMPION);
    assert.equal(lockedChamp.kind, 'unit');
    assert.equal(lockedChamp.label, 'Champion');
    assert.equal(lockedChamp.unlocked, false);
    assert.equal(lockedChamp.value, DEFAULT_SKIN_ID);
    assert.equal(lockedChamp.choices[1].id, DLC_FIRST_RESPONDER);
    assert.equal(lockedChamp.choices[1].enabled, false);
    assert.equal(locked[0].unlocked, false);
    assert.equal(locked[0].value, DEFAULT_SKIN_ID);
    assert.equal(locked[0].choices.length, 2);
    assert.equal(locked[0].choices[1].id, DLC_FIRST_RESPONDER);
    assert.equal(locked[0].choices[1].enabled, false);

    const owned = skinMenuModel([DLC_FIRST_RESPONDER], {});
    assert.equal(owned[0].unlocked, true);
    assert.equal(owned[0].value, DLC_FIRST_RESPONDER);
    assert.equal(owned[0].choices[1].enabled, true);
    assert.equal(owned.find((row) => row.id === UNIT.CHAMPION).value, DLC_FIRST_RESPONDER);

    const off = skinMenuModel([DLC_FIRST_RESPONDER], { [UNIT.PRIEST]: DEFAULT_SKIN_ID });
    assert.equal(off[0].value, DEFAULT_SKIN_ID);
    assert.equal(off.find((row) => row.id === UNIT.CHAMPION).value, DLC_FIRST_RESPONDER);
  });
});
