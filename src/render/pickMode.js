/**
 * GPU pixel-perfect mesh pick vs CPU ray-vs-sphere.
 * CPU is the live path (~1000x+ faster on mobile — see window.dumpPickBench).
 * Flip to true to restore GPU pickUnit/pickBuilding without rewriting callers.
 */
export const USE_GPU_PICK = false;
