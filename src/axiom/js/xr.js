// Immersive VR — Babylon 9 helper or Three WebXRManager. Same button / Escape.

export const XR_MODE = 'immersive-vr';

/**
 * @param {{ isSessionSupported?: (mode: string) => Promise<boolean> } | null | undefined} xr
 */
export async function isImmersiveVrSupported(xr) {
  if (!xr?.isSessionSupported) return false;
  try {
    return !!(await xr.isSessionSupported(XR_MODE));
  } catch {
    return false;
  }
}

/**
 * Prefer a floor-relative space (Babylon enterXRAsync local-floor). Fall back to default.
 * @param {{ requestSession: (mode: string, init?: object) => Promise<object> }} xr
 */
export async function requestImmersiveVr(xr) {
  try {
    return await xr.requestSession(XR_MODE, { requiredFeatures: ['local-floor'] });
  } catch {
    return xr.requestSession(XR_MODE);
  }
}

/**
 * @param {Pick<HTMLElement, 'addEventListener' | 'removeEventListener'> | null | undefined} button
 * @param {{ enterXR?: () => unknown, exitXR?: () => unknown }} api
 * @param {{ root?: Pick<Document, 'addEventListener' | 'removeEventListener'> }} [opts]
 */
export function bindXrButton(button, api, opts = {}) {
  if (!button || !api) return () => {};
  const root = opts.root ?? (typeof document !== 'undefined' ? document : null);
  const onClick = () => {
    Promise.resolve(api.enterXR?.()).catch(() => {});
  };
  const onKey = (evt) => {
    if (evt.key === 'Escape') api.exitXR?.();
  };
  button.addEventListener('click', onClick);
  root?.addEventListener?.('keydown', onKey);
  return () => {
    button.removeEventListener('click', onClick);
    root?.removeEventListener?.('keydown', onKey);
  };
}
