/** @typedef {'mouse' | 'touch' | 'gamepad' | 'xr'} HelpControlsDevice */

/** @type {HelpControlsDevice | null} */
let lastDevice = null;

/** @param {HelpControlsDevice} device */
export function noteHelpControlsDevice(device) {
  lastDevice = device;
}

/**
 * @param {{ xrActive?: boolean }} [opts]
 * @returns {HelpControlsDevice}
 */
export function resolveHelpControlsDevice({ xrActive = false } = {}) {
  if (xrActive) return 'xr';
  if (lastDevice) return lastDevice;
  if (typeof navigator !== 'undefined') {
    const pads = navigator.getGamepads?.() ?? [];
    if (pads.some((p) => p?.connected)) return 'gamepad';
  }
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'touch';
  return 'mouse';
}

/** @param {HelpControlsDevice} device */
function panelKeyForDevice(device) {
  if (device === 'mouse') return 'mouse-keyboard';
  return device;
}

/**
 * @param {ParentNode} controlsRoot - `<details data-help-controls-root>`
 * @param {HelpControlsDevice} device
 */
export function openHelpControlsPanel(controlsRoot, device) {
  const key = panelKeyForDevice(device);
  for (const el of controlsRoot.querySelectorAll('details[data-help-controls]')) {
    if (el instanceof HTMLDetailsElement) el.open = el.dataset.helpControls === key;
  }
}

/**
 * First time Controls opens each help visit, expand the panel for the active device.
 * @param {HTMLElement | null | undefined} helpPop
 * @param {{ getXrActive?: () => boolean }} [opts]
 * @returns {{ reset: () => void } | null}
 */
export function wireHelpControlsAutoOpen(helpPop, opts = {}) {
  const getXrActive = typeof opts.getXrActive === 'function' ? opts.getXrActive : () => false;
  if (!helpPop) return null;
  const controlsRoot = helpPop.querySelector('details[data-help-controls-root]');
  if (!(controlsRoot instanceof HTMLDetailsElement)) return null;

  let applied = false;
  const onToggle = () => {
    if (!controlsRoot.open || applied) return;
    applied = true;
    openHelpControlsPanel(
      controlsRoot,
      resolveHelpControlsDevice({ xrActive: getXrActive() }),
    );
  };
  controlsRoot.addEventListener('toggle', onToggle);
  return {
    reset() {
      applied = false;
    },
  };
}
