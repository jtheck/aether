// Dev-only Babylon Lite Explorer (F9). Lazy-loaded on first open.

/**
 * @param {{ engine: object, scene: object, canvas: HTMLCanvasElement }} ctx
 * @returns {{ toggle: () => Promise<void>, dispose: () => void }}
 */
export function createLiteExplorerToggle(ctx) {
  /** @type {{ ready: Promise<void>, show: () => void, hide: () => void, refresh: () => Promise<void>, dispose: () => void } | null} */
  let handle = null;
  let open = false;
  /** @type {Promise<object> | null} */
  let creating = null;

  async function ensure() {
    if (handle) return handle;
    if (creating) return creating;
    creating = (async () => {
      const [{ showLiteExplorer }, lite] = await Promise.all([
        import('../vendor/lite-explorer/explorer.js'),
        import('../vendor/lite/liteVendor.js'),
      ]);
      handle = showLiteExplorer(
        {
          engine: ctx.engine,
          scene: ctx.scene,
          canvas: ctx.canvas,
          // Same Lite instance as the game (vendored bundle).
          // Must cover every symbol explorer.js imports from '@babylonjs/lite'
          // (import map → liteVendor) plus the runtime `lite` overrides below.
          lite: {
            addToScene: lite.addToScene,
            removeFromScene: lite.removeFromScene,
            setSubtreeVisible: lite.setSubtreeVisible,
            loadGltf: lite.loadGltf,
            playAnimation: lite.playAnimation,
            stopAnimation: lite.stopAnimation,
            createGpuPicker: lite.createGpuPicker,
            disposePicker: lite.disposePicker,
            pickAsync: lite.pickAsync,
            setFog: lite.setFog,
            setSceneImageProcessing: lite.setSceneImageProcessing,
            markMaterialUboDirty: lite.markMaterialUboDirty,
            StandardToneMapping: lite.StandardToneMapping,
            AcesToneMapping: lite.AcesToneMapping,
            NeutralToneMapping: lite.NeutralToneMapping,
          },
        },
        {
          mode: 'overlay',
          layout: 'single',
          theme: 'dark',
          initiallyOpen: false,
          keyboardShortcutsEnabled: false,
          features: { focusSelected: false, canvasPicking: false },
        },
      );
      await handle.ready;
      return handle;
    })();
    try {
      return await creating;
    } finally {
      creating = null;
    }
  }

  return {
    async toggle() {
      const ex = await ensure();
      if (open) {
        ex.hide();
        open = false;
      } else {
        ex.show();
        open = true;
        await ex.refresh();
      }
    },
    dispose() {
      handle?.dispose();
      handle = null;
      open = false;
    },
  };
}
