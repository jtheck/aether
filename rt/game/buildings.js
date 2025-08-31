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
  camp: {
    name: "Camp",
    model: "assets/models/camp.glb",
    scale: .51,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 30, stone: 10 },
    description: "Basic work camp",
    category: "residential"
  }, 
  house: {
    name: "Village",
    model: "assets/models/village.glb",
    scale: 1,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 30, stone: 10 },
    description: "Basic housing for villagers",
    category: "residential"
  },
  
  tower: {
    name: "Watchtower",
    model: "assets/models/tower.glb", 
    scale: 1,
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
  
  // console.log(`Created ${this.name} at position`, this.position);
}

// Place a specific building at coordinates
function placeBuilding(buildingType, x, z, scene) {
  // console.log(`🏗️ Placing building: ${buildingType} at tile (${x}, ${z})`);
  
  const worldPosition = new BABYLON.Vector3(x * TILE_SIZE, 0, z * TILE_SIZE);
  // console.log(`🌍 World position: (${worldPosition.x}, ${worldPosition.y}, ${worldPosition.z})`);
  
  const building = new Building(buildingType, { x: worldPosition.x, y: 0, z: worldPosition.z });
  // console.log(`🏛️ Building created:`, building.name, 'Model path:', building.model);
  
  if (window.gfx && window.gfx.getModel) {
    // console.log(`📦 Loading model: ${building.model}`);
    window.gfx.getModel(building.model, scene).then(model => {
      // console.log(`✅ Model loaded successfully:`, model);
      building.mesh = model.root;
      building.mesh.position = worldPosition;
      building.mesh.scaling = new BABYLON.Vector3(building.scale, building.scale, building.scale);
      
      // Apply rotation if specified
      if (building.rotation !== undefined) {
        // Force Euler angles like we do with units
        building.mesh.rotationQuaternion = null;
        building.mesh.rotation.y = building.rotation;
        // console.log(`🔄 Applied rotation: ${(building.rotation * 180/Math.PI).toFixed(1)}°`);
      }
      
      // console.log(`🎯 ${building.name} successfully placed at (${x}, ${z}) with world position:`, worldPosition);
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
  // console.log("Initializing buildings...");
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
  // console.log("autoInitBuildings called - checking dependencies...");
  // console.log("gfx exists:", !!window.gfx);
  // console.log("scene exists:", !!window.gfx?.scene);
  // console.log("liveField exists:", !!window.liveField);
  // console.log("player exists:", !!window.player);
  // console.log("player.agora exists:", !!window.player?.agora);
  
  if (window.gfx && window.gfx.scene && window.liveField && window.player && window.player.agora) {
    // console.log("✓ All dependencies ready - auto-initializing buildings...");
    
    // Get agora position from player
    const agoraPosition = new BABYLON.Vector3(
      window.player.agora.x * TILE_SIZE, 
      0, 
      window.player.agora.y * TILE_SIZE
    );
    
    // console.log("Agora will be placed at:", agoraPosition);
    
    // Move camera to agora position FIRST (before loading terrain)
    if (window.gfx.cameraTarget) {
      window.gfx.cameraTarget.position = agoraPosition;
      // console.log("✓ Camera moved to player's agora position:", agoraPosition);
    }
    
    // Small delay to let camera settle, then load terrain around new position
    setTimeout(() => {
      // console.log("✓ Loading terrain around agora...");
      window.liveField.updateVisibleChunks(agoraPosition.x, agoraPosition.z);
      
      // Another small delay for terrain to load, then place buildings and spawn villagers
      setTimeout(() => {
        // console.log("✓ Calling initBuildings...");
        initBuildings(window.gfx.scene);
        
        // Spawn villagers at the agora after buildings are placed
        if (window.spawnAgoraVillagers && window.spawnUnitModels) {
          window.spawnAgoraVillagers();
          // Load models for the new villagers
          window.spawnUnitModels(window.gfx.scene);
        }
        
        // console.log("✓ Buildings and villagers initialized at player's agora");
      }, 300);
    }, 100);
    
  } else {
    // console.log("⏳ Dependencies not ready, retrying in 1 second...");
    setTimeout(autoInitBuildings, 1000);
  }
}

// Building Placement System
const buildingSystem = {
  isPlacing: false,
  selectedBuildingType: null,
  previewMesh: null,
  placementRotation: 0,
  
  // Start building placement mode
  selectBuilding: function(buildingType) {
    console.log(`🏗️ selectBuilding called with: ${buildingType}`);
    console.log(`🏗️ BuildingTypes available:`, Object.keys(BuildingTypes));
    
    if (!BuildingTypes[buildingType]) {
      console.error(`Unknown building type: ${buildingType}`);
      return;
    }
    
    this.isPlacing = true;
    this.selectedBuildingType = buildingType;
    this.placementRotation = 0;
    
    console.log(`🏗️ Building placement mode activated for: ${buildingType}`);
    
    // Hide the building menu
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    
    // Create preview mesh
    this.createPreviewMesh();
    
    // Enable placement mode
    this.enablePlacementMode();
  },
  
  // Create a preview mesh for the building
  createPreviewMesh: function() {
    if (!window.gfx || !window.gfx.scene) {
      console.error('Graphics system not available for preview');
      return;
    }
    
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef) {
      console.error('Building definition not found for:', this.selectedBuildingType);
      return;
    }
    
    const size = buildingDef.size;
    console.log('🏗️ Creating preview for building:', buildingDef.name, 'size:', size);
    
    // Create a simple box preview
    this.previewMesh = BABYLON.MeshBuilder.CreateBox(
      'buildingPreview', 
      { 
        width: size.width * TILE_SIZE, 
        height: 0.5, 
        depth: size.height * TILE_SIZE 
      }, 
      window.gfx.scene
    );
    
    // Make it semi-transparent and green
    this.previewMesh.material = new BABYLON.StandardMaterial('previewMaterial', window.gfx.scene);
    this.previewMesh.material.alpha = 0.6;
    this.previewMesh.material.diffuseColor = new BABYLON.Color3(0, 1, 0);
    this.previewMesh.material.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
    
    // Position it at camera target
    if (window.gfx.cameraTarget) {
      this.previewMesh.position = window.gfx.cameraTarget.position.clone();
      this.previewMesh.position.y = 0.25; // Slightly above ground
    } else {
      // Fallback position if no camera target
      this.previewMesh.position = new BABYLON.Vector3(0, 0.25, 0);
    }
    
    console.log('✅ Building preview created at position:', this.previewMesh.position);
  },
  
  // Enable placement mode with mouse tracking
  enablePlacementMode: function() {
    // Add mouse move handler for preview positioning
    this.mouseMoveHandler = (e) => {
      if (!this.isPlacing || !this.previewMesh) return;
      
      try {
        // Get world position from mouse
        const pickResult = window.gfx.scene.pick(e.clientX, e.clientY);
        if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.name && pickResult.pickedMesh.name.includes('Mesh')) {
          const worldPos = pickResult.pickedPoint;
          
          // Snap to grid
          const gridX = Math.round(worldPos.x / TILE_SIZE) * TILE_SIZE;
          const gridZ = Math.round(worldPos.z / TILE_SIZE) * TILE_SIZE;
          
          // Update preview position
          this.previewMesh.position.x = gridX;
          this.previewMesh.position.z = gridZ;
          this.previewMesh.position.y = 0.25;
          
          // Apply rotation
          this.previewMesh.rotation.y = this.placementRotation;
          
          // Check if position is valid and update preview color
          this.updatePreviewValidity(gridX / TILE_SIZE, gridZ / TILE_SIZE);
        }
      } catch (error) {
        console.warn('Error in mouse move handler:', error);
      }
    };
    
    // Add click handler for placement
    this.clickHandler = (e) => {
      if (!this.isPlacing || !this.previewMesh) return;
      
      try {
        // Get world position from mouse
        const pickResult = window.gfx.scene.pick(e.clientX, e.clientY);
        if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.name && pickResult.pickedMesh.name.includes('Mesh')) {
          const worldPos = pickResult.pickedPoint;
          
          // Snap to grid
          const gridX = Math.round(worldPos.x / TILE_SIZE);
          const gridZ = Math.round(worldPos.z / TILE_SIZE);
          
          console.log(`🏗️ Attempting to place building at grid coordinates: (${gridX}, ${gridZ})`);
          
          // Place the building
          this.placeBuildingAt(gridX, gridZ);
        }
      } catch (error) {
        console.warn('Error in click handler:', error);
      }
    };
    
    // Add event listeners
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('click', this.clickHandler);
    
    console.log('✅ Placement mode enabled');
  },
  
  // Place building at grid coordinates
  placeBuildingAt: function(gridX, gridZ) {
    if (!this.selectedBuildingType || !this.isPlacing) return;
    
    // Check if position is valid (not too close to agora)
    if (window.player && window.player.agora) {
      const agoraX = window.player.agora.x;
      const agoraZ = window.player.agora.y;
      const distance = Math.sqrt((gridX - agoraX) ** 2 + (gridZ - agoraZ) ** 2);
      
      if (distance < 3) {
        console.log('❌ Building too close to agora');
        this.showPlacementError('Building too close to agora');
        return;
      }
    }
    
    // Check if position is already occupied
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    for (const building of gameBuildings) {
      if (building.position.x === worldX && building.position.z === worldZ) {
        console.log('❌ Position already occupied');
        this.showPlacementError('Position already occupied');
        return;
      }
    }
    
    // Place the building
    const building = placeBuilding(this.selectedBuildingType, gridX, gridZ, window.gfx.scene);
    
    if (building) {
      // Apply the rotation from preview
      if (building.mesh) {
        building.mesh.rotation.y = this.placementRotation;
      }
      
      console.log(`✅ ${building.name} placed at (${gridX}, ${gridZ})`);
      
      // Show success message
      this.showPlacementSuccess(`${building.name} placed successfully!`);
      
      // Exit placement mode
      this.exitPlacementMode();
    }
  },
  
  // Rotate the building preview
  rotateBuilding: function() {
    if (!this.isPlacing || !this.previewMesh) return;
    
    this.placementRotation += Math.PI / 2; // 90 degrees
    if (this.placementRotation >= Math.PI * 2) {
      this.placementRotation = 0;
    }
    
    this.previewMesh.rotation.y = this.placementRotation;
    console.log(`🔄 Building rotated to ${(this.placementRotation * 180 / Math.PI).toFixed(0)}°`);
  },
  
  // Cancel building placement
  cancelPlacement: function() {
    this.exitPlacementMode();
  },
  
  // Exit placement mode
  exitPlacementMode: function() {
    this.isPlacing = false;
    this.selectedBuildingType = null;
    
    // Remove preview mesh
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    
    // Remove event listeners
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
    }
    
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
    
    console.log('✅ Building placement mode exited');
  },
  
  // Show placement error message
  showPlacementError: function(message) {
    // Create a temporary error message
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-weight: bold;
      z-index: 1000;
      pointer-events: none;
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remove after 2 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 2000);
  },
  
  // Show placement success message
  showPlacementSuccess: function(message) {
    // Create a temporary success message
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 255, 0, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-weight: bold;
      z-index: 1000;
      pointer-events: none;
    `;
    successDiv.textContent = message;
    
    document.body.appendChild(successDiv);
    
    // Remove after 2 seconds
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.parentNode.removeChild(successDiv);
      }
    }, 2000);
  },
  
  // Update preview validity and color
  updatePreviewValidity: function(gridX, gridZ) {
    if (!this.previewMesh || !this.previewMesh.material) return;
    
    let isValid = true;
    
    // Check if position is valid (not too close to agora)
    if (window.player && window.player.agora) {
      const agoraX = window.player.agora.x;
      const agoraZ = window.player.agora.y;
      const distance = Math.sqrt((gridX - agoraX) ** 2 + (gridZ - agoraZ) ** 2);
      
      if (distance < 3) {
        isValid = false;
      }
    }
    
    // Check if position is already occupied
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    for (const building of gameBuildings) {
      if (building.position.x === worldX && building.position.z === worldZ) {
        isValid = false;
        break;
      }
    }
    
    // Update preview color based on validity
    if (isValid) {
      this.previewMesh.material.diffuseColor = new BABYLON.Color3(0, 1, 0); // Green
      this.previewMesh.material.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
    } else {
      this.previewMesh.material.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red
      this.previewMesh.material.emissiveColor = new BABYLON.Color3(0.3, 0, 0);
    }
  }
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.BuildingTypes = BuildingTypes;
  window.Building = Building;
  window.gameBuildings = gameBuildings;
  window.placeBuilding = placeBuilding;
  window.placeAgora = placeAgora;
  window.initBuildings = initBuildings;
  window.updateBuildings = updateBuildings;
  window.buildingSystem = buildingSystem;
  
  // Debug logging
  console.log('🏗️ Building system loaded:', {
    buildingTypes: Object.keys(BuildingTypes),
    buildingSystem: !!buildingSystem,
    placeBuilding: !!placeBuilding
  });
  
  // Auto-start building initialization
  setTimeout(autoInitBuildings, 2500); // Wait a bit after units initialize
}
