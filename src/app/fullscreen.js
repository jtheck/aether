// Page / window fullscreen — Fullscreen API, desktop F11, or a filled-window heuristic.

const SIZE_SLACK = 2;

function documentFullscreenElement(doc) {
  return doc?.fullscreenElement
    || doc?.webkitFullscreenElement
    || doc?.mozFullScreenElement
    || null;
}

function exitDocumentFullscreen(doc) {
  const exit = doc?.exitFullscreen
    || doc?.webkitExitFullscreen
    || doc?.mozCancelFullScreen;
  return exit ? exit.call(doc) : null;
}

/** F11 / kiosk: the viewport fills the screen (not a maximized window with a taskbar). */
export function isFilledWindow(root = globalThis) {
  const win = root.window ?? root;
  const scr = root.screen;
  if (!win || !scr) return false;
  return win.innerHeight >= scr.height - SIZE_SLACK
    && win.innerWidth >= scr.width - SIZE_SLACK;
}

export function isPageFullscreen(root = globalThis) {
  if (documentFullscreenElement(root.document)) return true;
  if (root.aetherDesktop?.isFullscreen?.()) return true;
  return isFilledWindow(root);
}

/**
 * Leave Fullscreen API or desktop (NW.js) window fullscreen.
 * Browser-chrome F11 cannot be dismissed from the page — returns false then.
 * @returns {Promise<boolean>}
 */
export async function tryExitFullscreen(root = globalThis) {
  const doc = root.document;
  if (documentFullscreenElement(doc)) {
    try {
      await exitDocumentFullscreen(doc);
      return true;
    } catch {
      return false;
    }
  }
  const leave = root.aetherDesktop?.leaveFullscreen;
  if (typeof leave === 'function') {
    try {
      return !!(await leave());
    } catch {
      return false;
    }
  }
  return false;
}

export function subscribeFullscreen(onChange, root = globalThis) {
  const win = root.window ?? root;
  const doc = root.document;
  const fire = () => onChange(isPageFullscreen(root));
  doc?.addEventListener?.('fullscreenchange', fire);
  doc?.addEventListener?.('webkitfullscreenchange', fire);
  win?.addEventListener?.('resize', fire);
  fire();
  return () => {
    doc?.removeEventListener?.('fullscreenchange', fire);
    doc?.removeEventListener?.('webkitfullscreenchange', fire);
    win?.removeEventListener?.('resize', fire);
  };
}

/** Escape while the side menu is up: closed → main, main → settings, settings → exit fullscreen. */
export function escapeMenuStep({ menuOpen, page }) {
  if (!menuOpen) return 'open-menu';
  if (page !== 'settings') return 'open-settings';
  return 'exit-fullscreen';
}
