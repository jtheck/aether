// Shared camera-distance bands for render LOD / FX gates (3D eye → point).
// When LOD_ENABLED is false, all gates are skipped (Infinity).

/** Master kill switch — leave false to run without distance LOD. */
export const LOD_ENABLED = false;

/** Socket fire, aura sparkles, health chips. */
export const FX_DISTANCE = 900;
/** VAT walk/idle playback — freeze (fps=0) beyond this. */
export const VAT_DISTANCE = 400;

/** Scenery mesh→billboard (3× original 480/520). */
export const SCENERY_LOD_TREE = 1440;
export const SCENERY_LOD_ROCK = 1560;

export const FX_DISTANCE_SQ = LOD_ENABLED ? FX_DISTANCE * FX_DISTANCE : Infinity;
export const VAT_DISTANCE_SQ = LOD_ENABLED ? VAT_DISTANCE * VAT_DISTANCE : Infinity;
