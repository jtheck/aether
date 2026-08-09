

// HUD Mode Settings - can be toggled by user
window.USE_3D_HUD = false;   // false = 2D HUD, true = 3D HUD



const
  DRAW_FPS = true,
  TILE_SIZE = 4,
  // ENABLE_FORGE can be set by forge/index.html before this script loads
  ENABLE_FORGE = window.ENABLE_FORGE || false,
  
  // Starting resources - THE single source of truth
  STARTING_RESOURCES = { food: 100, wood: 90, stone: 30, minerals: 5 },








  Vec2 = BABYLON.Vector2,
  Vec3 = BABYLON.Vector3,
  ColorHex = BABYLON.Color3.FromHexString,

  log = console.log
;
