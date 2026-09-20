'use strict';

// GameOverlayActivated_t — k_iSteamFriendsCallbacks (300) + 31
const K_I_GAME_OVERLAY_ACTIVATED = 331;
const CALLBACK_SIZE_BYTES = 8;

function readActiveFlag(koffi, pvParam) {
  if (pvParam == null) return false;
  try {
    return !!koffi.decode(pvParam, 'uint8');
  } catch (_decode) {
    try {
      if (typeof pvParam === 'object' && pvParam.m_bActive != null) return !!pvParam.m_bActive;
    } catch (_row) { /* ignore */ }
  }
  return false;
}

function createOverlayActive() {
  let active = false;
  let attached = false;
  const keep = [];

  function isActive() {
    return active;
  }

  function setActive(on) {
    active = !!on;
    return active;
  }

  function attach(sdk) {
    if (attached) return true;
    const libraryLoader = sdk && sdk.libraryLoader;
    if (!libraryLoader || typeof libraryLoader.SteamAPI_RegisterCallback !== 'function') {
      return false;
    }

    let koffi;
    let loaderTypes;
    try {
      koffi = require('koffi');
      loaderTypes = require('steamworks-ffi-node/dist/internal/SteamLibraryLoader');
    } catch (_err) {
      return false;
    }

    try {
      const runCallback = function (_self, pvParam) {
        setActive(readActiveFlag(koffi, pvParam));
      };
      const runCallbackResult = function (_self, pvParam) {
        setActive(readActiveFlag(koffi, pvParam));
      };
      const getCallbackSizeBytes = function () {
        return CALLBACK_SIZE_BYTES;
      };

      const runCb = koffi.register(runCallback, loaderTypes.FnCallbackRunPtr);
      const runResultCb = koffi.register(runCallbackResult, loaderTypes.FnCallbackRunResultPtr);
      const getSizeCb = koffi.register(getCallbackSizeBytes, loaderTypes.FnGetCallbackSizeBytesPtr);
      const fns = [runCb, runResultCb, getSizeCb];
      const vtable = koffi.alloc('void*', 3);
      koffi.encode(vtable, koffi.array('void*', 3), fns);
      const callbackObject = koffi.alloc(loaderTypes.CCallbackBase, 1);
      koffi.encode(callbackObject, loaderTypes.CCallbackBase, {
        vfptr: vtable,
        m_nCallbackFlags: 0,
        _pad: [0, 0, 0],
        m_iCallback: K_I_GAME_OVERLAY_ACTIVATED,
      });
      libraryLoader.SteamAPI_RegisterCallback(callbackObject, K_I_GAME_OVERLAY_ACTIVATED);
      keep.push(fns, vtable, callbackObject);
      attached = true;
      return true;
    } catch (_reg) {
      return false;
    }
  }

  return {
    K_I_GAME_OVERLAY_ACTIVATED,
    isActive,
    setActive,
    attach,
    readActiveFlag,
  };
}

module.exports = {
  K_I_GAME_OVERLAY_ACTIVATED,
  CALLBACK_SIZE_BYTES,
  createOverlayActive,
  readActiveFlag,
};
