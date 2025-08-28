// Building system for structures like agora, houses, towers, etc.

// Building type definitions
const BuildingTypes = {
  agora: {
    name: "Agora",
    model: "assets/models/agora.glb",
    scale: 1.0, // Big and impressive as it should be!
    rotation: Math.floor(Math.random() * 24) * (Math.PI / 12), // Random 15-degree intervals (0°, 15°, 30°, 45°, etc.)
    size: { width: 4, height: 4 }, // Size in tiles
    cost: { stone: 100, wood: 50 },
    description: "Ancient marketplace and gathering place",
    category: "civic"
  },
  
  house: {
    name: "House",
    model: "assets/models/house.glb",
    scale: 0.8,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 30, stone: 10 },
    description: "Basic housing for villagers",
    category: "residential"
  },
  
  tower: {
    name: "Watchtower",
    model: "assets/models/tower.glb", 
    scale: 1.2,
    rotation: Math.PI / 6, // 30 degrees
    size: { width: 2, height: 2 },
    cost: { stone: 80, wood: 20 },
    description: "Defensive structure with long sight range",
    category: "military"
  }
};

// Global buildings array
const gameBuildings = [];

// Building constructor
function Building(buildingType, position, options = {}) {
  const def = BuildingTypes[buildingType];
  if (!def) {
    console.error(`Unknown building type: ${buildingType}`);
    return null;
  }
  
  // Copy all properties from definition
  Object.assign(this, def);
  
  // Building instance properties
  this.id = options.id || Math.random().toString(36).substr(2, 9);
  this.position = position || { x: 0, y: 0, z: 0 };
  this.owner = options.owner || 'player';
  this.health = options.health || 100;
  this.maxHealth = 100;
  this.buildProgress = options.buildProgress || 1.0; // 0-1, 1 = complete
  
  // 3D model reference
  this.mesh = null;
  
  console.log(`Created ${this.name} at position`, this.position);
}

// Place a specific building at coordinates
function placeBuilding(buildingType, x, z, scene) {
  console.log(`🏗️ Placing building: ${buildingType} at tile (${x}, ${z})`);
  
  const worldPosition = new BABYLON.Vector3(x * TILE_SIZE, 0, z * TILE_SIZE);
  console.log(`🌍 World position: (${worldPosition.x}, ${worldPosition.y}, ${worldPosition.z})`);
  
  const building = new Building(buildingType, { x: worldPosition.x, y: 0, z: worldPosition.z });
  console.log(`🏛️ Building created:`, building.name, 'Model path:', building.model);
  
  if (window.gfx && window.gfx.getModel) {
    console.log(`📦 Loading model: ${building.model}`);
    window.gfx.getModel(building.model, scene).then(model => {
      console.log(`✅ Model loaded successfully:`, model);
      building.mesh = model.root;
      building.mesh.position = worldPosition;
      building.mesh.scaling = new BABYLON.Vector3(building.scale, building.scale, building.scale);
      
      // Apply rotation if specified
      if (building.rotation !== undefined) {
        // Force Euler angles like we do with units
        building.mesh.rotationQuaternion = null;
        building.mesh.rotation.y = building.rotation;
        console.log(`🔄 Applied rotation: ${(building.rotation * 180/Math.PI).toFixed(1)}°`);
      }
      
      console.log(`🎯 ${building.name} successfully placed at (${x}, ${z}) with world position:`, worldPosition);
    }).catch(err => {
      console.error(`❌ Failed to load ${building.name} model:`, err);
    });
  } else {
    console.error(`❌ gfx.getModel not available! gfx:`, !!window.gfx, 'getModel:', !!window.gfx?.getModel);
  }
  
  gameBuildings.push(building);
  return building;
}

// Place the agora at the player's agora location
function placeAgora(scene) {
  if (window.player && window.player.agora) {
    return placeBuilding('agora', window.player.agora.x, window.player.agora.y, scene);
  } else {
    console.warn("Player agora location not found, using default (15, 15)");
    return placeBuilding('agora', 15, 15, scene);
  }
}

// Initialize buildings when scene is ready
function initBuildings(scene) {
  console.log("Initializing buildings...");
  placeAgora(scene);
}

// Update building logic (damage, construction progress, etc.)
function updateBuildings(deltaTime) {
  gameBuildings.forEach(building => {
    // Update building-specific logic here
    // - Construction progress
    // - Health regeneration
    // - Production cycles
    // - Defensive actions
  });
}

// Auto-initialize buildings when scene is ready
function autoInitBuildings() {
  console.log("autoInitBuildings called - checking dependencies...");
  console.log("gfx exists:", !!window.gfx);
  console.log("scene exists:", !!window.gfx?.scene);
  console.log("liveField exists:", !!window.liveField);
  console.log("player exists:", !!window.player);
  console.log("player.agora exists:", !!window.player?.agora);
  
  if (window.gfx && window.gfx.scene && window.liveField && window.player && window.player.agora) {
    console.log("✓ All dependencies ready - auto-initializing buildings...");
    
    // Get agora position from player
    const agoraPosition = new BABYLON.Vector3(
      window.player.agora.x * TILE_SIZE, 
      0, 
      window.player.agora.y * TILE_SIZE
    );
    
    console.log("Agora will be placed at:", agoraPosition);
    
    // Move camera to agora position FIRST (before loading terrain)
    if (window.gfx.cameraTarget) {
      window.gfx.cameraTarget.position = agoraPosition;
      console.log("✓ Camera moved to player's agora position:", agoraPosition);
    }
    
    // Small delay to let camera settle, then load terrain around new position
    setTimeout(() => {
      console.log("✓ Loading terrain around agora...");
      window.liveField.updateVisibleChunks(agoraPosition.x, agoraPosition.z);
      
      // Another small delay for terrain to load, then place buildings and spawn villagers
      setTimeout(() => {
        console.log("✓ Calling initBuildings...");
        initBuildings(window.gfx.scene);
        
        // Spawn villagers at the agora after buildings are placed
        if (window.spawnAgoraVillagers && window.spawnUnitModels) {
          window.spawnAgoraVillagers();
          // Load models for the new villagers
          window.spawnUnitModels(window.gfx.scene);
        }
        
        console.log("✓ Buildings and villagers initialized at player's agora");
      }, 300);
    }, 100);
    
  } else {
    console.log("⏳ Dependencies not ready, retrying in 1 second...");
    setTimeout(autoInitBuildings, 1000);
  }
}

// Export for use in other files
if (typeof window !== 'undefined') {
  window.BuildingTypes = BuildingTypes;
  window.Building = Building;
  window.gameBuildings = gameBuildings;
  window.placeBuilding = placeBuilding;
  window.placeAgora = placeAgora;
  window.initBuildings = initBuildings;
  window.updateBuildings = updateBuildings;
  
  // Auto-start building initialization
  setTimeout(autoInitBuildings, 2500); // Wait a bit after units initialize
}
