/**
 * Thin render-port contract for axiom.
 * Three is the default; Lite + BJS9 remain behind ?backend=
 *
 * Lifecycle:
 *   init(canvas) → registerSpecies(...) → each frame: uploadSpecies + render
 *
 * @typedef {object} SpeciesRegister
 * @property {string} id
 * @property {'point'|'triangle'|'plane'|'tetra'} [meshKind]
 * @property {number} capacity
 * @property {number} [size]
 * @property {{ r: number, g: number, b: number }} [tint]
 *
 * @typedef {object} SpeciesUpload
 * @property {string} id
 * @property {number} count
 * @property {Float32Array} [matrices]   // 16 * count (thin instances)
 * @property {Float32Array} [colors]     // 4 * count
 * @property {Float32Array} [positions]  // 3 * count (point cloud)
 *
 * @typedef {object} AxiomRenderer
 * @property {(canvas: HTMLCanvasElement) => void | Promise<void>} init
 * @property {() => void} resize
 * @property {(spec: SpeciesRegister) => void} registerSpecies
 * @property {(upload: SpeciesUpload) => void} uploadSpecies
 * @property {() => void} render
 * @property {() => number} getDeltaTime  // seconds
 * @property {() => any} [getScene]       // classic-only (inspector / XR)
 * @property {() => void} [dispose]
 */

export const RENDER_BACKEND_VERSION = 1;
