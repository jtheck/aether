// Building system for structures like agora, houses, towers, etc.

// Add particle effects to buildings based on their type
function addBuildingParticleEffects(building) {
  if (!window.fx || !building.mesh) {
    return;
  }
  
  // Add particle effects based on building type
  switch (building.name.toLowerCase()) {
    case 'camp':
      // Add small campfire effect
      window.fx.attachParticleEffect(building, 'fire', 'fire_anchor', {
        scale: 0.3, // Small campfire
        emitRate: 15,
        minSize: 0.5,
        maxSize: 1.0
      });
      break;
      
    case 'village':
      // Add moderate smoke effect
      window.fx.attachParticleEffect(building, 'smoke', 'smoke_anchor', {
        scale: 0.5, // Moderate village smoke
        emitRate: 20,
        minSize: 1.0,
        maxSize: 2.0
      });
      break;
      
    case 'farm':
      // Add subtle smoke effect
      window.fx.attachParticleEffect(building, 'smoke', 'smoke_anchor', {
        scale: 0.2, // Very subtle farm smoke
        emitRate: 8,
        minSize: 0.8,
        maxSize: 1.5,
        minLifeTime: 1.0,
        maxLifeTime: 2.0
      });
      break;
      
    case 'tower':
      // Add torch fire effect
      window.fx.attachParticleEffect(building, 'fire', 'torch_anchor', {
        scale: 0.4, // Small torch flame
        emitRate: 20,
        minSize: 0.3,
        maxSize: 0.8
      });
      break;
      
    case 'agora':
      // Add grand fire effect for agora
      window.fx.attachParticleEffect(building, 'fire', 'fire_anchor', {
        scale: 1.5, // Large ceremonial fire
        emitRate: 80,
        minSize: 1.5,
        maxSize: 3.0
      });
      break;
      
    case 'brigand':
      // Add torch effects for brigand (multiple anchors)
      window.fx.attachMultipleParticleEffects(building, [
        { type: 'torch', anchor: 'torch_anchor.001', options: { scale: 0.3 } },
        { type: 'torch', anchor: 'torch_anchor.002', options: { scale: 0.3 } }
      ]);
      break;
      
    case 'wizard':
      // Add magical particle effects for wizard
      window.fx.attachMultipleParticleEffects(building, [
        { type: 'particle', anchor: 'particle_anchor.001', options: { scale: 0.5 } },
        { type: 'particle', anchor: 'particle_anchor.002', options: { scale: 0.5 } },
        { type: 'smoke', anchor: 'smoke_anchor', options: { scale: 0.3 } }
      ]);
      break;
      
    // Add more building types as needed
    default:
      // No default particle effects
      break;
  }
}

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
    scale: .4,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 30, stone: 10 },
    description: "Basic work camp",
    category: "residential",
    // Work assignment properties
    needsWorkers: true,
    maxWorkers: 9,
    workRadius: 25, // How far to look for idle villagers
    workType: "gather", // Type of work this building provides
    workInterval: 10000, // How often workers produce resources (10 seconds)
    workOutput: { wood: 2, stone: 1 } // Resources produced per work cycle
  }, 
  village: {
    name: "Village",
    model: "assets/models/village.glb",
    scale: .2,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 30, stone: 10 },
    description: "Basic housing for villagers",
    category: "residential",
    // Villager spawning properties
    spawnsVillagers: true,
    spawnInterval: 90000, // 90 seconds in milliseconds
    maxVillagers: 15, // Maximum villagers this village can support
    spawnRadius: 5 // Spawn villagers within 3 tiles of the village
  },
  farm: {
    name: "Farm",
    model: "assets/models/farm.glb",
    scale: .4,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 20, stone: 10 },
    description: "Food production",
    category: "production",
    // Work assignment properties
    needsWorkers: true,
    maxWorkers: 4,
    workRadius: 8, // How far to look for idle villagers
    workType: "farm", // Type of work this building provides
    workInterval: 15000, // How often workers produce resources (15 seconds)
    workOutput: { food: 3 } // Resources produced per work cycle
  },
  tower: {
    name: "Watchtower",
    model: "assets/models/tower.glb", 
    scale: .1,
    rotation: Math.PI / 6, // 30 degrees
    size: { width: 2, height: 2 },
    cost: { stone: 80, wood: 20 },
    description: "Defensive structure with long sight range",
    category: "military"
  }
};

// Global buildings array and model pools
const gameBuildings = [];
const buildingModelPools = new Map(); // path -> array of model instances

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
  
  // Villager spawning properties (for buildings that spawn villagers)
  this.lastSpawnTime = 0;
  this.spawnedVillagers = 0; // Count of villagers spawned by this building
  
  // Work assignment properties (for buildings that need workers)
  this.assignedWorkers = []; // Array of villager units assigned to this building
  this.lastWorkTime = 0; // Last time workers produced resources
  
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
  
  if (window.gfx) {
    // Try to get from pool first
    let pool = buildingModelPools.get(building.model);
    let modelPromise;

    if (pool && pool.length > 0) {
      // Reuse instance from pool
      const model = pool.pop();
      modelPromise = Promise.resolve(model);
    } else {
      // Create new instance
      modelPromise = window.gfx.getModel(building.model, scene);
    }

    modelPromise.then(model => {
      building.mesh = model.root;
      
      // Set initial state
      building.mesh.rotationQuaternion = null;
      building.mesh.rotation.y = building.targetRotation || 0;
      
      // Keep child meshes' original rotations
      building.mesh.getChildMeshes().forEach(mesh => {
        if (mesh.rotationQuaternion) {
          const quaternion = mesh.rotationQuaternion.clone();
          mesh.rotationQuaternion = null;
          mesh.rotation = quaternion.toEulerAngles();
        }
      });
      
      // Set position and initial scale/height
      building.mesh.position = worldPosition.clone();
      building.mesh.position.y = -2; // Start below ground
      const targetScale = building.scale;
      building.mesh.scaling = new BABYLON.Vector3(targetScale, 0.1, targetScale); // Start squished
      
      // Make it visible
      building.mesh.setEnabled(true);
      
      // Create the animations
      const riseAnimation = new BABYLON.Animation(
        "buildingRise",
        "position.y",
        30,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      const scaleAnimation = new BABYLON.Animation(
        "buildingScale",
        "scaling.y",
        30,
        BABYLON.Animation.ANIMATIONTYPE_FLOAT,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      // Create animation keys
      const keyFrames = [
        { frame: 0, value: -2 },
        { frame: 20, value: 0 }
      ];
      
      const scaleFrames = [
        { frame: 0, value: 0.1 },
        { frame: 20, value: targetScale }
      ];

      riseAnimation.setKeys(keyFrames);
      scaleAnimation.setKeys(scaleFrames);

      // Add easing
      const ease = new BABYLON.CubicEase();
      ease.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUTBOUNCE);
      riseAnimation.setEasingFunction(ease);
      scaleAnimation.setEasingFunction(ease);

      // Stop any existing animations
      building.mesh.animations = [];
      scene.stopAnimation(building.mesh);

      // Add and start new animations
      building.mesh.animations = [riseAnimation, scaleAnimation];
      scene.beginAnimation(building.mesh, 0, 20, false, 1.0, () => {
        building.mesh.position.y = 0;
        building.mesh.scaling.y = targetScale;
        
        // Add particle effects based on building type
        addBuildingParticleEffects(building);
      });
    }).catch(err => {
      console.error(`❌ Failed to load ${building.name} model:`, err);
    });
  } else {
    console.error(`❌ Graphics system not available!`);
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

// Spawn a villager from a village building
function spawnVillagerFromVillage(village) {
  if (!village || !village.spawnsVillagers) return;
  
  // Check if village has reached max villagers
  if (village.spawnedVillagers >= village.maxVillagers) {
    return;
  }
  
  // Check if village is complete
  if (village.buildProgress < 1.0) {
    return;
  }
  
  // Check if enough time has passed since last spawn
  const currentTime = Date.now();
  if (currentTime - village.lastSpawnTime < village.spawnInterval) {
    return;
  }
  
  // Find a spawn position near the village
  const spawnPosition = findVillagerSpawnPosition(village);
  if (!spawnPosition) {
    return; // No valid spawn position found
  }
  
  // Create the villager
  const villager = new Unit('villager', spawnPosition);
  villager.owner = village.owner;
  
  // Random rotation
  const randomRotation = Math.random() * Math.PI * 2;
  villager.rotation = randomRotation;
  if (villager.pb.state && villager.pb.state.rot) {
    villager.pb.state.rot.y = randomRotation;
  }
  
  // Add to appropriate unit arrays
  if (village.owner === 'player' && window.player) {
    window.player.units.push(villager);
  }
  gameUnits.push(villager);
  
  // Update village spawn tracking
  village.lastSpawnTime = currentTime;
  village.spawnedVillagers++;
  
  // Spawn the visual model
  if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
    window.spawnUnitModels(window.gfx.scene);
  }
  
  console.log(`🏘️ Village spawned villager #${village.spawnedVillagers} at (${spawnPosition.x.toFixed(1)}, ${spawnPosition.z.toFixed(1)})`);
}

// Find a valid spawn position near a village
function findVillagerSpawnPosition(village) {
  if (!village || !village.position) return null;
  
  const maxAttempts = 20;
  const spawnRadius = village.spawnRadius || 3;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate random position within spawn radius
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * spawnRadius * TILE_SIZE;
    
    const spawnX = village.position.x + Math.cos(angle) * distance;
    const spawnZ = village.position.z + Math.sin(angle) * distance;
    
    // Check if position is valid (not too close to other units/buildings)
    const isValidPosition = isPositionValidForSpawn(spawnX, spawnZ);
    
    if (isValidPosition) {
      return { x: spawnX, y: 0, z: spawnZ };
    }
  }
  
  // If no valid position found, spawn at village position
  return { 
    x: village.position.x + (Math.random() - 0.5) * TILE_SIZE, 
    y: 0, 
    z: village.position.z + (Math.random() - 0.5) * TILE_SIZE 
  };
}

// Check if a position is valid for spawning a villager
function isPositionValidForSpawn(x, z) {
  const minDistance = TILE_SIZE * 1.5; // Minimum distance from other units
  
  // Check distance from other units
  for (const unit of gameUnits) {
    if (unit.pb && unit.pb.state && unit.pb.state.loc) {
      const dx = x - unit.pb.state.loc.x;
      const dz = z - unit.pb.state.loc.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < minDistance) {
        return false;
      }
    }
  }
  
  // Check distance from other buildings
  for (const building of gameBuildings) {
    if (building.position) {
      const dx = x - building.position.x;
      const dz = z - building.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < minDistance) {
        return false;
      }
    }
  }
  
  return true;
}

// Find idle villagers near a building
function findIdleVillagersNearBuilding(building) {
  if (!building || !building.needsWorkers || !building.position) return [];
  
  const idleVillagers = [];
  const workRadius = building.workRadius || 5;
  
  // Look through all game units for idle villagers and engineers
  for (const unit of gameUnits) {
    if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
    if (unit.type !== 'villager' && unit.type !== 'engineer') continue;
    if (unit.owner !== building.owner) continue; // Only assign workers to same owner
    
    // Check if villager is idle (no active behavior)
    const hasActiveBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
    if (hasActiveBehavior) continue;
    
    // Check distance from building
    const dx = unit.pb.state.loc.x - building.position.x;
    const dz = unit.pb.state.loc.z - building.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance <= workRadius * TILE_SIZE) {
      idleVillagers.push(unit);
    }
  }
  
  return idleVillagers;
}

// Assign a villager to work at a building
function assignVillagerToWork(villager, building) {
  if (!villager || !building || !window.behaviorManager) return false;
  
  // Check if building needs more workers
  if (building.assignedWorkers.length >= building.maxWorkers) {
    return false;
  }
  
  // Determine work behavior type based on building and unit type
  let workBehaviorType = 'work';
  if (villager.type === 'engineer') {
    workBehaviorType = 'engineer_work';
  } else if (building.workType === 'gather') {
    workBehaviorType = 'gather_work';
  } else if (building.workType === 'farm') {
    workBehaviorType = 'farm_work';
  }
  
  // Assign the work behavior
  window.behaviorManager.setBehavior(villager, workBehaviorType, {
    building: building
  });
  
  // Add to building's assigned workers
  building.assignedWorkers.push(villager);
  
  // Mark villager as assigned to this building
  villager.assignedBuilding = building;
  
  console.log(`🔨 Assigned ${villager.name || villager.type} to work at ${building.name}`);
  return true;
}

// Process work and generate resources
function processWorkProduction(building) {
  if (!building || !building.needsWorkers || building.assignedWorkers.length === 0) return;
  
  const currentTime = Date.now();
  if (currentTime - building.lastWorkTime < building.workInterval) return;
  
  // Generate resources based on number of workers
  const workerCount = building.assignedWorkers.length;
  const workOutput = building.workOutput || {};
  
  // Apply worker efficiency (more workers = more output, but with diminishing returns)
  const efficiency = Math.min(workerCount, building.maxWorkers) / building.maxWorkers;
  const outputMultiplier = 0.5 + (efficiency * 0.5); // 50-100% efficiency based on workers
  
  for (const [resource, amount] of Object.entries(workOutput)) {
    const actualAmount = Math.floor(amount * outputMultiplier);
    if (actualAmount > 0) {
      // Add resources to player (you'll need to implement this based on your resource system)
      if (window.player && window.player.addResource) {
        window.player.addResource(resource, actualAmount);
        console.log(`💰 ${building.name} produced ${actualAmount} ${resource} (${workerCount} workers)`);
      }
    }
  }
  
  building.lastWorkTime = currentTime;
}

// Update building logic (damage, construction progress, etc.)
function updateBuildings(deltaTime) {
  gameBuildings.forEach(building => {
    // Update building-specific logic here
    // - Construction progress
    // - Health regeneration
    // - Production cycles
    // - Defensive actions
    
    // Handle villager spawning for villages
    if (building.spawnsVillagers && building.buildProgress >= 1.0) {
      spawnVillagerFromVillage(building);
    }
    
    // Handle work assignment for buildings that need workers
    if (building.needsWorkers && building.buildProgress >= 1.0) {
      // Clean up any workers that are no longer valid
      building.assignedWorkers = building.assignedWorkers.filter(worker => {
        if (!worker || !gameUnits.includes(worker)) {
          return false; // Remove invalid workers
        }
        
        // Check if worker still has work behavior for this building
        const behavior = window.behaviorManager ? window.behaviorManager.getBehavior(worker) : null;
        if (!behavior || !behavior.building || behavior.building !== building) {
          worker.assignedBuilding = null;
          return false; // Remove workers no longer working here
        }
        
        return true; // Keep valid workers
      });
      
      // Try to assign more workers if needed
      if (building.assignedWorkers.length < building.maxWorkers) {
        const idleVillagers = findIdleVillagersNearBuilding(building);
        
        for (const villager of idleVillagers) {
          if (building.assignedWorkers.length >= building.maxWorkers) break;
          if (villager.assignedBuilding) continue; // Already assigned elsewhere
          
          assignVillagerToWork(villager, building);
        }
      }
      
      // Process work production
      processWorkProduction(building);
    }
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
  lastValidPosition: null,
  lastValidRotation: null,
  
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
    
    // Create preview mesh
    this.createPreviewMesh();
    
    // Enable placement mode
    this.enablePlacementMode();
  },
  
  // Create a preview mesh for the building
  createPreviewMesh: function(initialPosition = null) {
    if (!window.gfx || !window.gfx.scene) {
      console.error('Graphics system not available for preview');
      return;
    }
    
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef) {
      console.error('Building definition not found for:', this.selectedBuildingType);
      return;
    }
    
    console.log('🏗️ Creating preview for building:', buildingDef.name);
    
    // Load the actual model
    window.gfx.getModel(buildingDef.model, window.gfx.scene).then(model => {
      this.previewMesh = model.root;
      
      // Force Euler angles for rotation
      this.previewMesh.rotationQuaternion = null;
      
      // Apply building scale
      this.previewMesh.scaling = new BABYLON.Vector3(
        buildingDef.scale,
        buildingDef.scale,
        buildingDef.scale
      );
      
      // Create preview material
      const previewMaterial = new BABYLON.StandardMaterial('previewMaterial', window.gfx.scene);
      previewMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0);
      previewMaterial.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
      previewMaterial.alpha = 0.6;
      
      // Keep child meshes' original rotations but update materials
      this.previewMesh.getChildMeshes().forEach(mesh => {
        mesh.material = previewMaterial;
        mesh.isPickable = false;
        // Preserve original rotations
        if (mesh.rotationQuaternion) {
          const quaternion = mesh.rotationQuaternion.clone();
          mesh.rotationQuaternion = null;
          mesh.rotation = quaternion.toEulerAngles();
        }
      });
      
      // Only set rotation mode on the root mesh
      this.previewMesh.rotationQuaternion = null;
      this.previewMesh.isPickable = false;
      
      // Set initial rotation
      this.placementRotation = buildingDef.rotation || 0;
      this.previewMesh.rotation.y = this.placementRotation;
      
      // Position it at the provided position or current mouse position
      if (initialPosition) {
        this.previewMesh.position = initialPosition.clone();
        this.previewMesh.position.y = 0.25; // Slightly above ground
      } else {
        // Try to get current mouse position
        const pickResult = window.gfx.scene.pick(
          window.gfx.scene.pointerX,
          window.gfx.scene.pointerY
        );
        
        if (pickResult.hit && pickResult.pickedPoint) {
          this.previewMesh.position = pickResult.pickedPoint.clone();
          this.previewMesh.position.y = 0.25;
        } else if (window.gfx.cameraTarget) {
          // Fallback to camera target
          this.previewMesh.position = window.gfx.cameraTarget.position.clone();
          this.previewMesh.position.y = 0.25;
        } else {
          // Last resort fallback
          this.previewMesh.position = new BABYLON.Vector3(0, 0.25, 0);
        }
      }
      
      console.log('✅ Building preview created at position:', this.previewMesh.position);
    }).catch(err => {
      console.error('Failed to create preview mesh:', err);
    });
    
    // Return early since we're handling positioning in the promise
    return;

    
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
    
    // Add click handlers for placement and cancel
    this.clickHandler = (e) => {
      if (!this.isPlacing || !this.previewMesh) return;
      
      // Right click to cancel
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelPlacement();
        return;
      }
      
      // Only handle left clicks for placement
      if (e.button !== 0) return;
      
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
          
          // Prevent event from bubbling up and closing menus
          e.preventDefault();
          e.stopPropagation();
        }
      } catch (error) {
        console.warn('Error in click handler:', error);
      }
    };
    
    // Add event listeners
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('contextmenu', (e) => {
      if (this.isPlacing) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelPlacement();
        return false;
      }
    });
    
    // Also prevent right-click from bubbling up in click handler
    document.addEventListener('mousedown', (e) => {
      if (this.isPlacing && e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    
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
      // Store the target rotation for when the mesh loads
      building.targetRotation = this.placementRotation;
      
      // Set up a callback to apply rotation after mesh loads
      const checkInterval = setInterval(() => {
        if (building.mesh) {
          // Only rotate the root mesh
          building.mesh.rotationQuaternion = null;
          building.mesh.rotation.y = building.targetRotation;
          
          clearInterval(checkInterval);
        }
      }, 100);
      
      // Reset cached position and rotation
      this.lastValidPosition = null;
      this.lastValidRotation = null;
      
      console.log(`✅ ${building.name} placed at (${gridX}, ${gridZ})`);
      
      // Show success message
      this.showPlacementSuccess(`${building.name} placed successfully!`);
      
      // Get current mouse position for new preview
      const pickResult = window.gfx.scene.pick(
        window.gfx.scene.pointerX,
        window.gfx.scene.pointerY
      );
      
      // Reset preview mesh and state but stay in placement mode
      this.previewMesh.dispose();
      this.previewMesh = null;
      
      // Create new preview at current mouse position
      if (pickResult.hit && pickResult.pickedPoint) {
        this.createPreviewMesh(pickResult.pickedPoint);
      } else {
        this.createPreviewMesh();
      }
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
  
  // Return a building's model to the pool
  returnBuildingToPool: function(building) {
    if (building.mesh && building.model) {
      // Hide the mesh
      building.mesh.setEnabled(false);
      
      // Get or create pool for this model
      if (!buildingModelPools.has(building.model)) {
        buildingModelPools.set(building.model, []);
      }
      
      // Add mesh to pool
      const pool = buildingModelPools.get(building.model);
      pool.push({ root: building.mesh });
      
      // Clear building's reference
      building.mesh = null;
    }
  },

  // Exit placement mode
  exitPlacementMode: function(keepListeners = false) {
    this.isPlacing = false;
    this.selectedBuildingType = null;
    
    // Remove preview mesh
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    
    // Only remove event listeners if we're fully exiting
    if (!keepListeners) {
      if (this.mouseMoveHandler) {
        document.removeEventListener('mousemove', this.mouseMoveHandler);
        this.mouseMoveHandler = null;
      }
      
      if (this.clickHandler) {
        document.removeEventListener('click', this.clickHandler);
        this.clickHandler = null;
      }
      
      console.log('✅ Building placement mode exited');
    }
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
  
  // Find best rotation based on surroundings
  findBestRotation: function(gridX, gridZ) {
    const SEARCH_RADIUS = 3; // How far to look for nearby objects
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    // Check for nearby buildings
    let nearestBuilding = null;
    let minDistance = Infinity;
    
    for (const building of gameBuildings) {
      const dx = building.position.x - worldX;
      const dz = building.position.z - worldZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < SEARCH_RADIUS * TILE_SIZE && distance < minDistance) {
        nearestBuilding = building;
        minDistance = distance;
      }
    }
    
    // If we found a nearby building, face away from it
    if (nearestBuilding) {
      const dx = worldX - nearestBuilding.position.x;
      const dz = worldZ - nearestBuilding.position.z;
      return Math.atan2(dz, dx);
    }
    
    // Check for terrain features (if we have access to them)
    if (window.liveField && window.liveField.getTerrainType) {
      // Check surrounding tiles for terrain features
      // Check in a circle around the building in 15-degree increments
      const angles = [];
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
        const radius = 1;
        const x = Math.round(gridX + Math.cos(angle) * radius);
        const z = Math.round(gridZ + Math.sin(angle) * radius);
        angles.push({ x, z, angle: (angle + Math.PI) % (Math.PI * 2) }); // Face away from feature
      }
      
      for (const tile of angles) {
        const terrainType = window.liveField.getTerrainType(tile.x, tile.z);
        if (terrainType === 'forest' || terrainType === 'mountain' || terrainType === 'rock') {
          return tile.angle; // Face away from the terrain feature
        }
      }
    }
    
    // Default to a random rotation in 15-degree increments
    return Math.floor(Math.random() * 24) * (Math.PI / 12); // 24 * 15 degrees = 360 degrees
  },

  // Update preview validity and color
  updatePreviewValidity: function(gridX, gridZ) {
    if (!this.previewMesh) return;
    
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
    
    // Update preview appearance and rotation
    if (this.previewMesh) {
      // Update color based on validity
      this.previewMesh.getChildMeshes().forEach(mesh => {
        if (mesh.material) {
          if (isValid) {
            mesh.material.diffuseColor = new BABYLON.Color3(0, 1, 0); // Green
            mesh.material.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
          } else {
            mesh.material.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red
            mesh.material.emissiveColor = new BABYLON.Color3(0.3, 0, 0);
          }
        }
      });

      // Update rotation based on surroundings
      if (isValid) {
        // Only recalculate rotation if we've moved to a new grid position
        const posKey = `${gridX},${gridZ}`;
        if (this.lastValidPosition !== posKey) {
          this.lastValidPosition = posKey;
          this.lastValidRotation = this.findBestRotation(gridX, gridZ);
        }
        
        const targetRotation = this.lastValidRotation;
        
        // Force Euler angles
        this.previewMesh.rotationQuaternion = null;
        
        // Smoothly interpolate to the target rotation
        const currentAngle = this.previewMesh.rotation.y;
        let angleDiff = targetRotation - currentAngle;
        
        // Normalize angle difference to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        // Smooth interpolation with slower rotation
        const smoothing = 0.15; // Slower, more stable rotation
        const newAngle = currentAngle + angleDiff * smoothing;
        
        // Apply rotation
        this.previewMesh.rotation.y = newAngle;
        this.placementRotation = targetRotation; // Store target rotation for placement
      }
    }
  },
  
  // Add particle effect to a specific building
  addParticleEffect: function(building, effectType, anchorName = "particle_anchor", options = {}) {
    if (window.fx && building) {
      return window.fx.attachParticleEffect(building, effectType, anchorName, options);
    }
    return null;
  },
  
  // Remove particle effects from a building
  removeParticleEffects: function(building, effectType = null) {
    if (window.fx && building) {
      window.fx.removeParticleEffects(building, effectType);
    }
  },
  
  // Get all buildings with particle effects
  getBuildingsWithEffects: function() {
    return gameBuildings.filter(building => building.particleEffects && building.particleEffects.length > 0);
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
  
  // Test function to create a village for testing villager spawning
  window.testVillageSpawn = function() {
    console.log('🏘️ Creating test village for villager spawning...');
    
    if (!window.gfx || !window.gfx.scene) {
      console.error('❌ Scene not ready for village creation');
      return;
    }
    
    // Create a village at a random position near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const villageX = Math.floor(cameraPos.x / TILE_SIZE) + 5;
    const villageZ = Math.floor(cameraPos.z / TILE_SIZE) + 5;
    
    const village = placeBuilding('village', villageX, villageZ, window.gfx.scene);
    
    if (village) {
      // Set the village as complete so it can start spawning
      village.buildProgress = 1.0;
      village.lastSpawnTime = 0; // Allow immediate spawning
      
      console.log(`🏘️ Test village created at (${villageX}, ${villageZ}) - will spawn villagers every 60 seconds`);
      console.log('🏘️ Village properties:', {
        spawnsVillagers: village.spawnsVillagers,
        spawnInterval: village.spawnInterval,
        maxVillagers: village.maxVillagers,
        spawnRadius: village.spawnRadius
      });
    }
  };
  
  // Function to check village spawn status
  window.checkVillageStatus = function() {
    const villages = gameBuildings.filter(building => building.spawnsVillagers);
    console.log(`🏘️ Found ${villages.length} villages:`);
    
    villages.forEach((village, index) => {
      const timeSinceLastSpawn = Date.now() - village.lastSpawnTime;
      const timeUntilNextSpawn = village.spawnInterval - timeSinceLastSpawn;
      
      console.log(`🏘️ Village ${index + 1}:`, {
        position: `(${village.position.x.toFixed(1)}, ${village.position.z.toFixed(1)})`,
        spawnedVillagers: village.spawnedVillagers,
        maxVillagers: village.maxVillagers,
        buildProgress: village.buildProgress,
        timeSinceLastSpawn: `${(timeSinceLastSpawn / 1000).toFixed(1)}s`,
        timeUntilNextSpawn: timeUntilNextSpawn > 0 ? `${(timeUntilNextSpawn / 1000).toFixed(1)}s` : 'Ready to spawn!'
      });
    });
  };
  
  // Function to create test work buildings
  window.testWorkBuildings = function() {
    console.log('🔨 Creating test work buildings...');
    
    if (!window.gfx || !window.gfx.scene) {
      console.error('❌ Scene not ready for building creation');
      return;
    }
    
    // Create a camp near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const campX = Math.floor(cameraPos.x / TILE_SIZE) + 3;
    const campZ = Math.floor(cameraPos.z / TILE_SIZE) + 3;
    
    const camp = placeBuilding('camp', campX, campZ, window.gfx.scene);
    if (camp) {
      camp.buildProgress = 1.0; // Complete the building
      console.log(`🔨 Test camp created at (${campX}, ${campZ})`);
    }
    
    // Create a farm nearby
    const farmX = campX + 2;
    const farmZ = campZ + 2;
    
    const farm = placeBuilding('farm', farmX, farmZ, window.gfx.scene);
    if (farm) {
      farm.buildProgress = 1.0; // Complete the building
      console.log(`🌾 Test farm created at (${farmX}, ${farmZ})`);
    }
    
    console.log('🔨 Test buildings created - villagers should automatically start working!');
  };
  
  // Function to check work building status
  window.checkWorkStatus = function() {
    const workBuildings = gameBuildings.filter(building => building.needsWorkers);
    console.log(`🔨 Found ${workBuildings.length} work buildings:`);
    
    workBuildings.forEach((building, index) => {
      const timeSinceLastWork = Date.now() - building.lastWorkTime;
      const timeUntilNextWork = building.workInterval - timeSinceLastWork;
      
      console.log(`🔨 ${building.name} ${index + 1}:`, {
        position: `(${building.position.x.toFixed(1)}, ${building.position.z.toFixed(1)})`,
        assignedWorkers: building.assignedWorkers.length,
        maxWorkers: building.maxWorkers,
        workType: building.workType,
        workOutput: building.workOutput,
        buildProgress: building.buildProgress,
        timeSinceLastWork: `${(timeSinceLastWork / 1000).toFixed(1)}s`,
        timeUntilNextWork: timeUntilNextWork > 0 ? `${(timeUntilNextWork / 1000).toFixed(1)}s` : 'Ready to work!'
      });
    });
  };
  
  // Function to check player resources
  window.checkResources = function() {
    if (window.player && window.player.getResources) {
      const resources = window.player.getResources();
      console.log('💰 Player resources:', resources);
    } else {
      console.error('❌ Player or resource system not available');
    }
  };
  
  // Function to test resource display
  window.testResourceDisplay = function() {
    console.log('💰 Testing resource display...');
    
    if (!window.player) {
      console.error('❌ Player not available');
      return;
    }
    
    // Add some test resources
    window.player.addResource('food', 50);
    window.player.addResource('wood', 25);
    window.player.addResource('stone', 15);
    window.player.addResource('magic', 10);
    
    // Force update the display
    if (window.hud && window.hud.updateResourceDisplay) {
      window.hud.updateResourceDisplay();
      console.log('💰 Resource display updated!');
    } else {
      console.error('❌ Resource display function not available');
    }
  };
  
  // Function to spawn test engineers
  window.spawnTestEngineers = function() {
    console.log('🔧 Spawning test engineers...');
    
    if (!window.player || !window.gfx || !window.gfx.scene) {
      console.error('❌ Player or scene not available');
      return;
    }
    
    // Spawn 2-3 engineers near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const engineerCount = 2 + Math.floor(Math.random() * 2); // 2-3 engineers
    
    for (let i = 0; i < engineerCount; i++) {
      const angle = (i / engineerCount) * Math.PI * 2;
      const distance = 3 + Math.random() * 2;
      
      const x = cameraPos.x + Math.cos(angle) * distance * TILE_SIZE;
      const z = cameraPos.z + Math.sin(angle) * distance * TILE_SIZE;
      
      const engineer = new Unit('engineer', { x, y: 0, z });
      engineer.owner = 'player';
      
      // Random rotation
      const randomRotation = Math.random() * Math.PI * 2;
      engineer.rotation = randomRotation;
      if (engineer.pb.state && engineer.pb.state.rot) {
        engineer.pb.state.rot.y = randomRotation;
      }
      
      // Add to player's units
      window.player.units.push(engineer);
      gameUnits.push(engineer);
      
      console.log(`🔧 Spawned engineer ${i + 1} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    
    // Spawn the visual models
    if (window.spawnUnitModels) {
      window.spawnUnitModels(window.gfx.scene);
    }
    
    console.log(`🔧 Spawned ${engineerCount} engineers - they should start working at nearby buildings!`);
  };
}
