// Building system for structures like agora, houses, towers, etc.

// Add particle effects to buildings based on their type
function addBuildingParticleEffects(building) {
  // console.log(`🔥 addBuildingParticleEffects called for ${building.name}`);
  
  if (!window.fx || !building.mesh) {
    // console.log(`❌ Missing dependencies - fx: ${!!window.fx}, mesh: ${!!building.mesh}`);
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
    case 'watchtower':
      // Add torch fire effect
      window.fx.attachParticleEffect(building, 'fire', 'torch_anchor', {
        scale: 0.4,
        emitRate: 20,
        minSize: 0.3,
        maxSize: 0.8
      });
      break;
      
    case 'agora':
      // Agora model has no particle anchors - skip particle effects
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
    rotation: 0, // Fixed rotation for multiplayer determinism (was random)
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
    cost: { wood: 15, stone: 0 },
    description: "Basic work camp",
    category: "residential",
    // Work assignment properties
    needsWorkers: true,
    maxWorkers: 10,
    workRadius: 5, // Resource detection and worker search radius (tiles) - 5 tiles × 4px = 20 world units
    workType: "gather", // Type of work this building provides
    workInterval: 10000, // How often workers produce resources (10 seconds)
    workOutput: { wood: 0, stone: 0 }, // Will be calculated based on nearby resources
    availableResources: [] // Will store detected resource tiles
  }, 
  village: {
    name: "Village",
    model: "assets/models/village.glb",
    scale: .2,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 30, stone: 5 },
    description: "Basic housing for villagers",
    category: "residential",
    // Villager spawning properties
    spawnsVillagers: true,
    spawnInterval: 60000, // 60 seconds in milliseconds
    maxVillagers: 15, // Maximum villagers this village can support
    spawnRadius: 4 // Spawn villagers within 3 tiles of the village
  },
  farm: {
    name: "Farm",
    model: "assets/models/farm.glb",
    scale: .4,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 20, stone: 0 },
    description: "Food production",
    category: "production",
    // Work assignment properties
    needsWorkers: true,
    maxWorkers: 4,
    workRadius: 8, // How far to look for idle villagers (tiles) - 8 tiles × 4px = 32 world units
    workType: "farm", // Type of work this building provides
    workInterval: 10000, // How often workers produce resources (10 seconds)
    workOutput: { food: 4 } // Resources produced per work cycle
  },
  tower: {
    name: "Watchtower",
    model: "assets/models/tower.glb", 
    scale: .429,
    rotation: 0, // 30 degrees
    size: { width: 2, height: 2 },
    cost: { stone: 40, wood: 20 },
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
    // console.error(`Unknown building type: ${buildingType}`);
    return null;
  }
  
  // Copy all properties from definition
  Object.assign(this, def);
  
  // Building instance properties
  // Store the original building type (for lookups)
  this.type = buildingType;
  
  // MULTIPLAYER: Generate deterministic IDs based on match seed and building count
  this.id = options.id || (window.isMultiplayer && window.currentMatch ? 
      `building-${window.currentMatch.mapSeed}-${(window.gameBuildings?.length || 0)}` : 
      Math.random().toString(36).substr(2, 9));
  this.position = position || { x: 0, y: 0, z: 0 };
  
  // CRITICAL: Store grid coordinates for deterministic checksum calculation
  // If gridX/gridZ are provided in options, use them; otherwise calculate from world position
  this.gridX = options.gridX !== undefined ? options.gridX : Math.round(this.position.x / TILE_SIZE);
  this.gridZ = options.gridZ !== undefined ? options.gridZ : Math.round(this.position.z / TILE_SIZE);
  
  this.owner = options.owner; // CRITICAL: No default owner - must be explicitly set!
  this.health = options.health || 100;
  this.maxHealth = 100;
  this.buildProgress = options.buildProgress || 1.0; // 0-1, 1 = complete
  
  // Villager spawning properties (for buildings that spawn villagers)
  this.lastSpawnTick = 0; // Last tick a villager spawned (deterministic)
  this.spawnedVillagers = 0; // Count of villagers spawned by this building
  
  // Work assignment properties (for buildings that need workers)
  this.assignedWorkers = []; // Array of villager units assigned to this building
  this.lastWorkTick = 0; // Last tick workers produced resources (deterministic)
  
  // 3D model reference
  this.mesh = null;
  
  // // console.log(`Created ${this.name} at position`, this.position);
}

// Place a specific building at coordinates
function placeBuilding(buildingType, x, z, scene) {
  // // console.log(`🏗️ Placing building: ${buildingType} at tile (${x}, ${z})`);
  
  const worldPosition = new BABYLON.Vector3(x * TILE_SIZE, 0, z * TILE_SIZE);
  // // console.log(`🌍 World position: (${worldPosition.x}, ${worldPosition.y}, ${worldPosition.z})`);
  
  // CRITICAL: Pass grid coordinates explicitly for accurate checksum calculation
  const building = new Building(buildingType, { x: worldPosition.x, y: 0, z: worldPosition.z }, { gridX: x, gridZ: z });
  // // console.log(`🏛️ Building created:`, building.name, 'Model path:', building.model);
  
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
      
      // Tag as building so terrain clicks can ignore it
      building.mesh.isBuilding = true;
      building.mesh.getChildMeshes().forEach(childMesh => {
        childMesh.isBuilding = true;
      });
      
      // AGORA ONLY: Store platform height for units to stand on
      if (buildingType === 'agora') {
        // Calculate the top height of the agora (for units to stand on)
        building.platformHeight = 2.5; // Units stand 2.5 units above ground on agora
        building.platformRadius = 8; // Platform area in world units
        
        // Attach a team flag on top of the agora so each player has a visible banner.
        // The flag is raised by half its height so it sits directly on the platform.
        if (window.gfx && window.gfx.getModel) {
          window.gfx.getModel('assets/models/flag.glb', scene).then(flagModel => {
            const flagRoot = flagModel.root;
            
            // Stop any animations on the flag model (we want a static banner here)
            if (flagModel.animationGroups) {
              flagModel.animationGroups.forEach(g => g.stop());
            }
            
            // Compute local height before scaling
            const bbox = flagRoot.getBoundingInfo().boundingBox;
            const localHeight = bbox.maximum.y - bbox.minimum.y;
            
            // Choose a reasonable scale for the flag on top of the agora
            const flagScale = 0.6;
            flagRoot.scaling = new BABYLON.Vector3(flagScale, flagScale, flagScale);
            
            // Parent to the agora mesh so it moves with the building
            flagRoot.parent = building.mesh;
            
            // Raise by half its (scaled) height so the base sits on the agora platform
            const platformY = building.platformHeight || 0;
            const yOffset = platformY + (localHeight * flagScale) * 0.5;
            flagRoot.position = new BABYLON.Vector3(0, yOffset, 0);
            
            // Apply team color to the flag, if available
            let teamColorHex = building.teamColor;
            if (!teamColorHex && typeof window.getTeamColorForOwner === 'function' && building.owner) {
              teamColorHex = window.getTeamColorForOwner(building.owner);
            }
            
            if (teamColorHex) {
              const clean = teamColorHex.replace('#', '');
              const r = parseInt(clean.substr(0, 2), 16) / 255;
              const g = parseInt(clean.substr(2, 2), 16) / 255;
              const b = parseInt(clean.substr(4, 2), 16) / 255;
              const color = new BABYLON.Color3(r, g, b);
              
              flagRoot.getChildMeshes().forEach(mesh => {
                if (!mesh.material) return;
                const mat = mesh.material.clone(`flagMat_${teamColorHex}_${Date.now()}`);
                mat.diffuseColor = color;
                mat.emissiveColor = color.scale(0.6);
                mat.specularColor = new BABYLON.Color3(0, 0, 0);
                mat.disableLighting = true;
                mesh.material = mat;
              });
            }
            
            // Keep reference for later updates/debugging
            building.flagMesh = flagRoot;
          }).catch(err => {
            console.warn('⚠️ Failed to load agora flag model:', err);
          });
        }
      }
      
      // Set up shadows for building mesh
      if (window.gfx && window.gfx.setupMeshShadows) {
        window.gfx.setupMeshShadows(building.mesh);
      }
      
      // CRITICAL: Add particle effects after delay for ALL buildings
      // This ensures mesh hierarchy and world matrices are fully computed
      // Otherwise particles appear at (0,0,0) corner!
      if (window.fx) {
        setTimeout(() => {
          // Force recompute world matrices to ensure positions are correct
          building.mesh.computeWorldMatrix(true);
          addBuildingParticleEffects(building);
        }, 150); // Delay to ensure mesh hierarchy is ready
      }
      
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
        
        // Add particle effects immediately for all buildings (including towers)
        // Removed setTimeout to ensure deterministic timing
        addBuildingParticleEffects(building);
      });
    }).catch(err => {
      // console.error(`❌ Failed to load ${building.name} model:`, err);
    });
  } else {
    // console.error(`❌ Graphics system not available!`);
  }
  
  gameBuildings.push(building);
  return building;
}

// Place the agora at the player's agora location
function placeAgora(scene) {
  if (window.player && window.player.agora) {
    return placeBuilding('agora', window.player.agora.x, window.player.agora.y, scene);
  } else {
    // console.warn("Player agora location not found, using default (15, 15)");
    return placeBuilding('agora', 15, 15, scene);
  }
}

// Initialize buildings when scene is ready
function initBuildings(scene) {
  // // console.log("Initializing buildings...");
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
  
  // Check if enough time has passed since last spawn (DETERMINISTIC with ticks)
  const currentTick = window.currentMatch?.tick || 0;
  
  // First villager spawns very quickly (60 ticks = 1 second), rest use normal interval
  // Convert milliseconds to ticks (60 ticks per second)
  const spawnDelayTicks = village.spawnedVillagers === 0 ? 60 : Math.floor(village.spawnInterval / 1000 * 60);
  
  if (currentTick - village.lastSpawnTick < spawnDelayTicks) {
    return;
  }
  
  // First two villagers are free (founders)
  if (village.spawnedVillagers >= 2) {
    // Check if there's enough food to support new villagers
    if (window.player && window.player.getResources) {
      const resources = window.player.getResources();
      if (!resources.food || resources.food <= 0) {
        // No food - double the spawn interval to simulate hardship
        village.lastSpawnTick = currentTick + spawnDelayTicks * 2;
        // console.log("😢 Village has no food - delaying next villager spawn");
        return;
      }
    }
  } else {
    // console.log(`🏠 New village spawning founder ${village.spawnedVillagers + 1} of 2`);
  }
  
  // Find a spawn position near the village
  const spawnPosition = findVillagerSpawnPosition(village);
  if (!spawnPosition) {
    return; // No valid spawn position found
  }
  
  // Create the villager
  const villager = new Unit('villager', spawnPosition);
  // CRITICAL: Set owner correctly - use normalized ID if it's a long ID
  const rawOwner = village.owner;
  villager.owner = rawOwner?.length > 6 ? rawOwner.slice(-6) : rawOwner;
  
  // Deterministic rotation based on building ID and spawn count
  const buildingIdHash = (village.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const deterministicRotation = ((buildingIdHash + village.spawnedVillagers + currentTick) % 628) / 100; // 0 to ~6.28 (2π)
  villager.rotation = deterministicRotation;
  if (villager.pb.state && villager.pb.state.rot) {
    villager.pb.state.rot.y = deterministicRotation;
  }
  
  // Add to appropriate unit arrays
  // CRITICAL: Normalize ALL IDs for comparison (handle both full and shortened IDs)
  const normalizedVillageOwner = village.owner?.length > 6 ? village.owner.slice(-6) : village.owner;
  const normalizedPlayerId = window.player?.id?.length > 6 ? window.player.id.slice(-6) : window.player?.id;
  const normalizedOpponentId = window.opponent?.id?.length > 6 ? window.opponent.id.slice(-6) : window.opponent?.id;
  
  const isPlayerOwned = normalizedVillageOwner === normalizedPlayerId;
  const isOpponentOwned = normalizedVillageOwner === normalizedOpponentId;
  
  if (isPlayerOwned && window.player) {
    window.player.units.push(villager);
  } else if (isOpponentOwned && window.opponent) {
    // This is the opponent's village spawning their villagers - totally normal!
    window.opponent.units.push(villager);
  } else {
    // This would be unexpected - log as warning
    console.warn(`⚠️ Village spawned villager but owner unclear!`);
    console.warn(`   Village owner: "${village.owner}" (normalized: "${normalizedVillageOwner}")`);
    console.warn(`   Villager owner: "${villager.owner}"`);
    console.warn(`   Player ID: "${window.player?.id}" (normalized: "${normalizedPlayerId}")`);
    console.warn(`   Opponent ID: "${window.opponent?.id}" (normalized: "${normalizedOpponentId}")`);
  }
  // CRITICAL: Add to GLOBAL gameUnits array so villagers can be found/selected
  window.gameUnits.push(villager);
  
  // Update village spawn tracking
  village.lastSpawnTick = currentTick;
  village.spawnedVillagers++;
  
  // Spawn the visual model immediately for this specific villager
  if (window.gfx && window.gfx.scene && window.gfx.getModel) {
    window.gfx.getModel(villager.model, window.gfx.scene).then(model => {
      villager.mesh = model.root;
      villager.mesh.scaling = new BABYLON.Vector3(villager.scale, villager.scale, villager.scale);
      
      // CRITICAL: Enable the mesh (getModel disables it by default to prevent flash)
      villager.mesh.setEnabled(true);
      
      // Make unit mesh pickable for selection
      villager.mesh.isPickable = true;
      
      // Set up shadows for unit mesh
      if (window.gfx && window.gfx.setupMeshShadows) {
        window.gfx.setupMeshShadows(villager.mesh);
      }
      
      // Handle child meshes - preserve their original rotations
      villager.mesh.getChildMeshes().forEach(mesh => {
        mesh.isPickable = true;
        
        // Store their original rotations if they have them
        if (mesh.rotationQuaternion) {
          const quaternion = mesh.rotationQuaternion.clone();
          mesh.rotationQuaternion = null;
          mesh.originalRotation = quaternion.toEulerAngles();
          mesh.rotation.copyFrom(mesh.originalRotation);
        }
      });
      
      // Create selection indicator (glowing ring)
      if (window.createSelectionIndicator) {
        window.createSelectionIndicator(villager);
      }
      
      // Set initial position from physics body
      if (villager.pb && villager.pb.state && villager.pb.state.loc) {
        villager.mesh.position.x = villager.pb.state.loc.x;
        villager.mesh.position.y = villager.pb.state.loc.y;
        villager.mesh.position.z = villager.pb.state.loc.z;
      }
      
      // Apply rotation
      if (villager.pb && villager.pb.state && villager.pb.state.rot) {
        villager.mesh.rotationQuaternion = null;
        villager.mesh.rotation.y = villager.pb.state.rot.y;
      }
      
      // Apply team colors to the villager
      if (window.applyTeamColorsToMesh) {
        const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(villager.owner) : '#4A90E2';
        window.applyTeamColorsToMesh(villager.mesh, teamColor);
      }
    }).catch(error => {
      console.error('❌ Failed to load villager model:', error);
    });
  }
  
  // CRITICAL: Give new villager a linger behavior so they can be auto-assigned to work
  if (window.behaviorManager && villager.pb && villager.pb.state && villager.pb.state.loc) {
    window.behaviorManager.setBehavior(villager, 'linger', {
      center: { x: villager.pb.state.loc.x, z: villager.pb.state.loc.z },
      radius: 50,  // Large radius - villagers can roam freely
      wanderDistance: 2.0,  // How far they walk each step
      wanderInterval: 30000  // Pick new target every 30 seconds (very relaxed)
    });
  }
  
  // console.log(`🏘️ Village spawned villager #${village.spawnedVillagers} at (${spawnPosition.x.toFixed(1)}, ${spawnPosition.z.toFixed(1)})`);
}

// Find a valid spawn position near a village
function findVillagerSpawnPosition(village) {
  if (!village || !village.position) return null;
  
  const maxAttempts = 20;
  const spawnRadius = village.spawnRadius || 3;
  
  // Use deterministic values based on building ID, spawn count, and current tick
  const buildingIdHash = (village.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const currentTick = window.currentMatch?.tick || 0;
  const spawnCount = village.spawnedVillagers || 0;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate deterministic position within spawn radius
    const angleSeed = (buildingIdHash + spawnCount + currentTick + attempt * 37) % 628;
    const angle = angleSeed / 100; // 0 to ~6.28 (2π)
    
    const distanceSeed = (buildingIdHash + spawnCount + currentTick + attempt * 73) % 1000;
    const distance = (distanceSeed / 1000) * spawnRadius * TILE_SIZE;
    
    const spawnX = village.position.x + Math.cos(angle) * distance;
    const spawnZ = village.position.z + Math.sin(angle) * distance;
    
    // Check if position is valid (not too close to other units/buildings)
    const isValidPosition = isPositionValidForSpawn(spawnX, spawnZ);
    
    if (isValidPosition) {
      return { x: spawnX, y: 0, z: spawnZ };
    }
  }
  
  // If no valid position found, spawn at village position (deterministic offset)
  const offsetSeed = (buildingIdHash + spawnCount + currentTick) % 1000;
  const offset = (offsetSeed / 1000 - 0.5) * TILE_SIZE;
  return { 
    x: village.position.x + offset, 
    y: 0, 
    z: village.position.z + offset 
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
  const workRadius = building.workRadius || 20; // Increased radius to find workers across map
  
  // Look through all game units for idle villagers and engineers
  for (const unit of window.gameUnits) {
    if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
    if (unit.type !== 'villager' && unit.type !== 'engineer') continue;
    
    // CRITICAL: Normalize both IDs for comparison (handle both full and shortened IDs)
    const normalizedUnitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
    const normalizedBuildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
    if (normalizedUnitOwner !== normalizedBuildingOwner) continue; // Only assign workers to same owner
    
    // Check if villager is idle (no active behavior OR just has linger behavior)
    const currentBehavior = window.behaviorManager ? window.behaviorManager.getBehavior(unit) : null;
    const isIdleOrLingering = !currentBehavior || 
                              (currentBehavior && currentBehavior.constructor.name === 'LingerBehavior');
    if (!isIdleOrLingering) continue;
    
    // Check distance from building (in world units, not tiles)
    const dx = unit.pb.state.loc.x - building.position.x;
    const dz = unit.pb.state.loc.z - building.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    // Use world distance directly - workRadius is already in tiles, multiply by TILE_SIZE for world units
    const maxDistance = workRadius * TILE_SIZE;
    
    if (distance <= maxDistance) {
      idleVillagers.push({unit, distance});
    }
  }
  
  // CRITICAL: Sort ONLY by unit ID for 100% determinism in P2P!
  // Distance-based sorting can vary due to minor position drift between clients
  // Unit ID sorting ensures both clients select the same workers in the same order
  idleVillagers.sort((a, b) => {
    return (a.unit.id || '').localeCompare(b.unit.id || '');
  });
  
  return idleVillagers.map(v => v.unit);
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
  
  // DIAGNOSTIC: Log resource availability for camps
  if (building.workType === 'gather') {
    const resourceCount = building.availableResources?.length || 0;
    console.log(`✅ AUTO-ASSIGNED ${villager.name || villager.type} to work at ${building.name} (${building.assignedWorkers.length}/${building.maxWorkers} workers) - ${resourceCount} resource tiles available`);
    if (resourceCount === 0) {
      console.warn(`⚠️ Camp has NO resources detected! Workers will circle camp.`);
    }
  } else {
    console.log(`✅ AUTO-ASSIGNED ${villager.name || villager.type} to work at ${building.name || building.type} (${building.assignedWorkers.length}/${building.maxWorkers} workers)`);
  }
  return true;
}

// Helper to find player by owner ID (handles ID normalization)
function findPlayerByOwnerId(ownerId) {
  if (!ownerId) return null;
  
  // Try exact match first
  if (window.player && window.player.id === ownerId) return window.player;
  
  // Try normalized match (last 6 chars)
  const normalizeId = (id) => id?.length > 6 ? id.slice(-6) : id;
  const normalizedOwnerId = normalizeId(ownerId);
  
  if (window.player && normalizeId(window.player.id) === normalizedOwnerId) {
    return window.player;
  }
  
  // Check AI opponents
  if (window.currentMatch && window.currentMatch.players) {
    const owner = window.currentMatch.players.find(p => {
      const playerId = p.id || p;
      return normalizeId(playerId) === normalizedOwnerId;
    });
    return owner;
  }
  
  return null;
}

// Process work and generate resources
function processWorkProduction(building) {
  if (!building || !building.needsWorkers || building.assignedWorkers.length === 0) return;
  
  // For camps, workers now deliver resources directly when they return
  // No need for automatic resource generation
  if (building.name.toLowerCase() === 'camp') {
    return; // Workers handle resource delivery directly
  }
  
  // For farms and other food buildings, use automatic resource generation
  // since farmers don't have the same gathering/delivery system
  
  // DETERMINISTIC: Use match ticks instead of Date.now()
  const currentTick = window.currentMatch?.tick || 0;
  const workIntervalTicks = Math.floor((building.workInterval || 5000) / 1000 * 60); // Convert ms to ticks
  if (currentTick - (building.lastWorkTick || 0) < workIntervalTicks) return;
  
  // For other buildings, use the old automatic system
  const workerCount = building.assignedWorkers.length;
  
  // Apply worker efficiency (more workers = more output, but with diminishing returns)
  const efficiency = Math.min(workerCount, building.maxWorkers) / building.maxWorkers;
  let outputMultiplier = 0.3 + (efficiency * 0.7); // 30-100% efficiency based on workers
  
  // Apply engineer's boost if active
  const engineerBoostTicks = building.engineerBoostUntil || 0;
  if (engineerBoostTicks > 0 && currentTick < engineerBoostTicks) {
    outputMultiplier *= building.engineerBoostAmount || 1.5; // 50% boost
  }
  
  // Generate resources based on building's workOutput
  const workOutput = building.workOutput || {};
  for (const [resourceType, baseAmount] of Object.entries(workOutput)) {
    if (baseAmount > 0) {
      let actualAmount = Math.floor(baseAmount * outputMultiplier);
      
      // For farms, add extra food per worker
      if (building.name === 'Farm' && resourceType === 'food') {
        actualAmount += (workerCount - 1) * 1; // +3 food per additional worker
      }
      
      if (actualAmount > 0) {
        // Add resources to the building's owner (not always window.player!)
        const owner = findPlayerByOwnerId(building.owner);
        if (owner && owner.addResource) {
          owner.addResource(resourceType, actualAmount);
          if (building.name === 'Farm') {
            // // console.log(`🌾 ${owner.name || owner.id}'s Farm produced ${actualAmount} food (${workerCount} farmers)`);
          } else {
            // // console.log(`💰 ${owner.name || owner.id}'s ${building.name} produced ${actualAmount} ${resourceType}`);
          }
        }
      }
    }
  }
  
  building.lastWorkTick = currentTick;
}

// TF2-style capture point visual indicators
function updateCapturePointVisuals(agora) {
  if (!agora || !agora.mesh || !window.gfx || !window.gfx.scene) return;
  
  const captureProgress = agora.captureProgress || 0;
  const isContested = agora.contested || false;
  const capturerTeam = agora.contestedBy;
  
  // Create capture point visuals if they don't exist
  if (!agora.captureVisuals) {
    agora.captureVisuals = {};
    
    // Base capture disc (always shows owner color)
    // Diameter = OCCUPATION_RADIUS * 2 * TILE_SIZE = 5 * 2 * 4 = 40 world units
    const baseDisc = BABYLON.MeshBuilder.CreateCylinder('captureBase', {
      height: 0.2,
      diameter: 40,
      tessellation: 32
    }, window.gfx.scene);
    baseDisc.position.y = 0.1;
    baseDisc.parent = agora.mesh;
    
    const baseMat = new BABYLON.StandardMaterial('captureBaseMat', window.gfx.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3); // Gray by default
    baseMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    baseMat.alpha = 0.15; // Very subtle (was 0.6)
    baseDisc.material = baseMat;
    
    agora.captureVisuals.baseDisc = baseDisc;
    agora.captureVisuals.baseMat = baseMat;
    
    // Progress disc (shows capture progress)
    const progressDisc = BABYLON.MeshBuilder.CreateCylinder('captureProgress', {
      height: 0.3,
      diameter: 40,
      tessellation: 32
    }, window.gfx.scene);
    progressDisc.position.y = 0.25;
    progressDisc.parent = agora.mesh;
    progressDisc.scaling.x = 0;
    progressDisc.scaling.z = 0;
    
    const progressMat = new BABYLON.StandardMaterial('captureProgressMat', window.gfx.scene);
    progressMat.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red by default
    progressMat.emissiveColor = new BABYLON.Color3(0.5, 0, 0);
    progressMat.alpha = 0.8;
    progressDisc.material = progressMat;
    
    agora.captureVisuals.progressDisc = progressDisc;
    agora.captureVisuals.progressMat = progressMat;
    
    // Warning ring (pulses when being captured)
    const warningRing = BABYLON.MeshBuilder.CreateTorus('captureWarning', {
      diameter: 42,
      thickness: 0.5,
      tessellation: 32
    }, window.gfx.scene);
    warningRing.position.y = 1.0;
    warningRing.parent = agora.mesh;
    warningRing.isVisible = false;
    
    const warningMat = new BABYLON.StandardMaterial('captureWarningMat', window.gfx.scene);
    warningMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0);
    warningMat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
    warningMat.alpha = 0.7;
    warningRing.material = warningMat;
    
    agora.captureVisuals.warningRing = warningRing;
    agora.captureVisuals.warningMat = warningMat;
    
    // Countdown timer text (shows seconds remaining)
    const timerPlane = BABYLON.MeshBuilder.CreatePlane('captureTimer', {
      width: 8,
      height: 4
    }, window.gfx.scene);
    timerPlane.position.y = 8; // High above the agora
    timerPlane.parent = agora.mesh;
    timerPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera
    timerPlane.isVisible = false;
    
    // Create dynamic texture for timer text
    const timerTexture = new BABYLON.DynamicTexture('captureTimerTexture', {width: 512, height: 256}, window.gfx.scene);
    const timerMat = new BABYLON.StandardMaterial('captureTimerMat', window.gfx.scene);
    timerMat.diffuseTexture = timerTexture;
    timerMat.emissiveTexture = timerTexture;
    timerMat.opacityTexture = timerTexture;
    timerMat.backFaceCulling = false;
    timerPlane.material = timerMat;
    
    agora.captureVisuals.timerPlane = timerPlane;
    agora.captureVisuals.timerTexture = timerTexture;
  }
  
  // Update visual state based on capture status
  const visuals = agora.captureVisuals;
  
  // Update base disc color to match owner
  if (window.getTeamColorForOwner) {
    const ownerColor = window.getTeamColorForOwner(agora.owner);
    if (ownerColor) {
      visuals.baseMat.diffuseColor = new BABYLON.Color3(
        ownerColor.r * 0.7,
        ownerColor.g * 0.7,
        ownerColor.b * 0.7
      );
      visuals.baseMat.emissiveColor = new BABYLON.Color3(
        ownerColor.r * 0.3,
        ownerColor.g * 0.3,
        ownerColor.b * 0.3
      );
    }
  }
  
  // Update progress disc
  if (captureProgress > 0) {
    const scale = Math.min(1.0, captureProgress / 100);
    visuals.progressDisc.scaling.x = scale;
    visuals.progressDisc.scaling.z = scale;
    visuals.progressDisc.isVisible = true;
    
    // Set color based on capturing team
    if (capturerTeam && window.getTeamColorForOwner) {
      const capturerColor = window.getTeamColorForOwner(capturerTeam);
      if (capturerColor) {
        visuals.progressMat.diffuseColor = new BABYLON.Color3(
          capturerColor.r,
          capturerColor.g,
          capturerColor.b
        );
        visuals.progressMat.emissiveColor = new BABYLON.Color3(
          capturerColor.r * 0.5,
          capturerColor.g * 0.5,
          capturerColor.b * 0.5
        );
      }
    }
  } else {
    visuals.progressDisc.isVisible = false;
  }
  
  // Update warning ring (pulse animation when being captured or contested)
  if (captureProgress > 0 || isContested) {
    visuals.warningRing.isVisible = true;
    
    // Pulse animation
    const time = Date.now() * 0.003; // Slower pulse
    const pulseScale = 1.0 + Math.sin(time) * 0.1;
    visuals.warningRing.scaling.setAll(pulseScale);
    
    // Change color if contested
    if (isContested) {
      visuals.warningMat.diffuseColor = new BABYLON.Color3(1, 1, 0); // Yellow for contested
      visuals.warningMat.emissiveColor = new BABYLON.Color3(1, 1, 0);
    } else {
      visuals.warningMat.diffuseColor = new BABYLON.Color3(1, 0.3, 0); // Orange for capturing
      visuals.warningMat.emissiveColor = new BABYLON.Color3(1, 0.5, 0);
    }
  } else {
    visuals.warningRing.isVisible = false;
  }
  
  // Update countdown timer
  if (captureProgress > 0) {
    visuals.timerPlane.isVisible = true;
    
    // Calculate seconds remaining (15 seconds total capture time)
    const CAPTURE_TIME = 15;
    const remainingProgress = 100 - captureProgress;
    const secondsRemaining = Math.ceil((remainingProgress / 100) * CAPTURE_TIME);
    
    // Draw timer text
    const ctx = visuals.timerTexture.getContext();
    ctx.clearRect(0, 0, 512, 256);
    
    // Background
    if (isContested) {
      ctx.fillStyle = 'rgba(255, 255, 0, 0.8)'; // Yellow for contested
    } else {
      ctx.fillStyle = 'rgba(255, 100, 0, 0.8)'; // Orange for capturing
    }
    ctx.fillRect(0, 0, 512, 256);
    
    // Border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 248);
    
    // Timer text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (isContested) {
      ctx.fillText('CONTESTED', 256, 128);
    } else {
      ctx.fillText(`${secondsRemaining}s`, 256, 128);
    }
    
    visuals.timerTexture.update();
  } else {
    visuals.timerPlane.isVisible = false;
  }
}

// Update building logic (damage, construction progress, etc.)
function updateBuildings(deltaTime) {
  // Safe to run in menu scene - just guard against missing dependencies
  if (!window.gameBuildings || window.gameBuildings.length === 0) {
    return; // No buildings to update
  }
  
  gameBuildings.forEach(building => {
    // Update building-specific logic here
    // - Construction progress
    // - Health regeneration
    // - Production cycles
    // - Defensive actions
    
    // Handle deterministic mesh setup for multiplayer buildings
    if (building.needsMeshSetup && building.mesh && window.currentMatch) {
      // Apply rotation and team colors
      building.mesh.rotationQuaternion = null;
      building.mesh.rotation.y = building.targetRotation || 0;
      
      // Apply team colors
      if (window.applyTeamColorsToMesh && window.getTeamColorForOwner) {
        const teamColor = window.getTeamColorForOwner(building.owner);
        window.applyTeamColorsToMesh(building.mesh, teamColor);
      }
      
      // Mark as complete
      building.needsMeshSetup = false;
    }
    
    // TF2-style capture point visual indicators for Agoras
    if (building.type === 'agora' && building.mesh) {
      updateCapturePointVisuals(building);
    }
    
    // Handle villager spawning for villages (only if game is running OR in menu scene for testing)
    const isGameActive = (window.currentMatch && window.currentMatch.state === 'playing') || window.game;
    if (building.spawnsVillagers && building.buildProgress >= 1.0 && isGameActive) {
      spawnVillagerFromVillage(building);
    }
    
    // Handle work assignment for buildings that need workers
    // CRITICAL: Must be FULLY deterministic in P2P multiplayer!
    // Only check every N ticks to ensure both clients check at same time
    const currentTick = window.currentMatch?.tick || 0;
    const shouldCheckThisTick = (currentTick % 60 === 0); // Check every 60 ticks (~1 second at 60 TPS)
    
    if (building.needsWorkers && building.buildProgress >= 1.0 && window.game && shouldCheckThisTick) {
      
      // Clean up any workers that are no longer valid
      building.assignedWorkers = building.assignedWorkers.filter(worker => {
        if (!worker || !window.gameUnits.includes(worker)) {
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

// Auto-initialize menu scene terrain when scene is ready
function autoInitBuildings() {
  // Menu scene: Load terrain around default camera position, but NO units/buildings
  // Units and buildings only spawn when a match actually starts
  
  const sceneReady = window.gfx && window.gfx.scene && window.liveField;
  
  if (!sceneReady) {
    setTimeout(autoInitBuildings, 1000);
    return;
  }
  
  // Load terrain chunks around the camera's starting position
  if (window.gfx.cameraTarget) {
    const cameraPos = window.gfx.cameraTarget.position;
    window.liveField.updateVisibleChunks(cameraPos.x, cameraPos.z);
    // console.log(`🗺️ Menu scene: Loading terrain at (${cameraPos.x.toFixed(1)}, ${cameraPos.z.toFixed(1)})`);
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
  radiusVisualization: null, // For showing camp work radius
  resourceIndicators: [], // For showing trees/rocks within radius
  highlightedTiles: [], // For tracking highlighted terrain tiles
  
  // Start building placement mode
  selectBuilding: function(buildingType) {
    // console.log(`🏗️ selectBuilding called with: ${buildingType}`);
    // console.log(`🏗️ BuildingTypes available:`, Object.keys(BuildingTypes));
    
    if (!BuildingTypes[buildingType]) {
      // console.error(`Unknown building type: ${buildingType}`);
      return;
    }
    
    // CRITICAL: Dispose old preview mesh before creating new one!
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    
    this.isPlacing = true;
    this.selectedBuildingType = buildingType;
    this.placementRotation = 0;
    
    // console.log(`🏗️ Building placement mode activated for: ${buildingType}`);
    
    // Create preview mesh
    this.createPreviewMesh();
    
    // Enable placement mode
    this.enablePlacementMode();
  },
  
  // Create a preview mesh for the building
  createPreviewMesh: function(initialPosition = null) {
    if (!window.gfx || !window.gfx.scene) {
      // console.error('Graphics system not available for preview');
      return;
    }
    
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef) {
      // console.error('Building definition not found for:', this.selectedBuildingType);
      return;
    }
    
    // console.log('🏗️ Creating preview for building:', buildingDef.name);
    
    // Load the actual model
    window.gfx.getModel(buildingDef.model, window.gfx.scene).then(model => {
      this.previewMesh = model.root;
      
      // CRITICAL: Ensure preview mesh is visible!
      this.previewMesh.setEnabled(true);
      
      // Mark as preview so it doesn't get culled by LOD system
      this.previewMesh.metadata = this.previewMesh.metadata || {};
      this.previewMesh.metadata.isPreview = true;
      
      // Also enable all child meshes (important!)
      this.previewMesh.getChildMeshes().forEach(child => {
        child.setEnabled(true);
      });
      
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
        // Get terrain height
        let terrainY = 0;
        if (window.liveField && window.liveField.getHeightAt) {
          terrainY = window.liveField.getHeightAt(initialPosition.x, initialPosition.z);
        }
        this.previewMesh.position.y = terrainY + 0.25; // Slightly above ground
      } else {
        // Try to get current mouse position
        const pickResult = window.gfx.scene.pick(
          window.gfx.scene.pointerX,
          window.gfx.scene.pointerY
        );
        
        if (pickResult.hit && pickResult.pickedPoint) {
          this.previewMesh.position = pickResult.pickedPoint.clone();
          // Get terrain height
          let terrainY = 0;
          if (window.liveField && window.liveField.getHeightAt) {
            terrainY = window.liveField.getHeightAt(pickResult.pickedPoint.x, pickResult.pickedPoint.z);
          }
          this.previewMesh.position.y = terrainY + 0.25;
        } else if (window.gfx.cameraTarget) {
          // Fallback to camera target
          this.previewMesh.position = window.gfx.cameraTarget.position.clone();
          let terrainY = 0;
          if (window.liveField && window.liveField.getHeightAt) {
            terrainY = window.liveField.getHeightAt(this.previewMesh.position.x, this.previewMesh.position.z);
          }
          this.previewMesh.position.y = terrainY + 0.25;
        } else {
          // Last resort fallback
          this.previewMesh.position = new BABYLON.Vector3(0, 0.25, 0);
        }
      }
      
      // Create radius visualization for camp
      if (this.selectedBuildingType === 'camp') {
        this.createRadiusVisualization(this.previewMesh.position);
      }
      
    }).catch(err => {
      // console.error('Failed to create preview mesh:', err);
    });
    
    // Return early since we're handling positioning in the promise
    return;

    
    // console.log('✅ Building preview created at position:', this.previewMesh.position);
  },
  
  // Create radius visualization for camp work area
  createRadiusVisualization: function(centerPosition) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Clean up existing visualization
    this.clearRadiusVisualization();
    
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef || !buildingDef.workRadius) return;
    
    const radius = buildingDef.workRadius * TILE_SIZE;
    
    // Create a circle mesh to show the work radius (horizontal)
    const circle = BABYLON.MeshBuilder.CreateDisc("workRadius", {
      radius: radius,
      tessellation: 32 // Reduced from 64 for better performance
    }, window.gfx.scene);
    
    // Position the circle at the building location
    circle.position = centerPosition.clone();
    circle.position.y = 0.05; // Very close to ground
    
    // Rotate to be horizontal (disc is vertical by default)
    circle.rotation.x = Math.PI / 2; // 90 degrees to make it horizontal
    
    // Create material for the radius circle
    const radiusMaterial = new BABYLON.StandardMaterial("radiusMaterial", window.gfx.scene);
    radiusMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2); // Green
    radiusMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.1);
    radiusMaterial.alpha = 0.2; // More transparent
    radiusMaterial.backFaceCulling = false; // Show from both sides
    
    circle.material = radiusMaterial;
    circle.isPickable = false;
    
    this.radiusVisualization = circle;
    
    // Find and highlight resources within the radius (with performance optimization)
    this.highlightResourcesInRadius(centerPosition, radius);
  },
  
  // Clear radius visualization
  clearRadiusVisualization: function() {
    if (this.radiusVisualization) {
      this.radiusVisualization.dispose();
      this.radiusVisualization = null;
    }
    
    // Clear resource indicators
    this.resourceIndicators.forEach(indicator => {
      if (indicator && indicator.dispose) {
        indicator.dispose();
      }
    });
    this.resourceIndicators = [];
    
    // Clear highlighted tiles
    this.highlightedTiles.forEach(highlight => {
      if (highlight && highlight.dispose) {
        highlight.dispose();
      }
    });
    this.highlightedTiles = [];
    
    // Clean up shared materials
    if (this.woodIndicatorMaterial) {
      this.woodIndicatorMaterial.dispose();
      this.woodIndicatorMaterial = null;
    }
    if (this.stoneIndicatorMaterial) {
      this.stoneIndicatorMaterial.dispose();
      this.stoneIndicatorMaterial = null;
    }
    if (this.woodTileMaterial) {
      this.woodTileMaterial.dispose();
      this.woodTileMaterial = null;
    }
    if (this.stoneTileMaterial) {
      this.stoneTileMaterial.dispose();
      this.stoneTileMaterial = null;
    }
  },
  
  // Update radius visualization position
  updateRadiusVisualization: function(newPosition) {
    if (this.radiusVisualization && this.selectedBuildingType === 'camp') {
      this.radiusVisualization.position = newPosition.clone();
      this.radiusVisualization.position.y = 0.1;
      
      // Update resource highlights
      const buildingDef = BuildingTypes[this.selectedBuildingType];
      if (buildingDef && buildingDef.workRadius) {
        this.highlightResourcesInRadius(newPosition, buildingDef.workRadius * TILE_SIZE);
      }
    }
  },
  
  // Highlight resources (trees and rocks) within the camp's work radius
  highlightResourcesInRadius: function(centerPosition, radius) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Clear existing indicators
    this.resourceIndicators.forEach(indicator => {
      if (indicator && indicator.dispose) {
        indicator.dispose();
      }
    });
    this.resourceIndicators = [];
    
    // Clear existing resource data
    this.detectedResources = [];
    
    // Get the field system to check for resources
    if (!window.liveField) {
      console.warn('⚠️ Cannot detect resources: window.liveField is not available!');
      return;
    }
    
    // Convert world position to grid coordinates
    const gridX = Math.floor(centerPosition.x / TILE_SIZE);
    const gridZ = Math.floor(centerPosition.z / TILE_SIZE);
    const gridRadius = Math.ceil(radius / TILE_SIZE);
    
    // Count resources within the radius
    let resourceCount = 0;
    let tilesChecked = 0;
    let tileTypesSeen = {};
    
    // Check tiles within the radius
    for (let x = gridX - gridRadius; x <= gridX + gridRadius; x++) {
      for (let z = gridZ - gridRadius; z <= gridZ + gridRadius; z++) {
        // BOUNDS CHECK: Skip tiles outside the map
        if (!window.liveField || x < 0 || z < 0 || 
            x >= window.liveField.width || z >= window.liveField.height) {
          continue;
        }
        
        // Check if this tile is within the radius
        const worldX = x * TILE_SIZE;
        const worldZ = z * TILE_SIZE;
        const distance = Math.sqrt(
          Math.pow(worldX - centerPosition.x, 2) + 
          Math.pow(worldZ - centerPosition.z, 2)
        );
        
        if (distance <= radius) {
          tilesChecked++;
          
          // Track tile types for diagnostic purposes
          const tile = window.liveField.getTile(x, z);
          if (tile) {
            tileTypesSeen[tile.type] = (tileTypesSeen[tile.type] || 0) + 1;
          }
          
          // Check if this tile has resources (trees or rocks)
          const resourceInfo = this.checkTileForResources(x, z);
          if (resourceInfo) {
            // Store resource data for saving later
            this.detectedResources.push({
              gridX: x,
              gridZ: z,
              worldX: worldX,
              worldZ: worldZ,
              type: resourceInfo.type,
              amount: resourceInfo.amount
            });
            
            resourceCount++;
          }
        }
      }
    }
    
    // DIAGNOSTIC: Log tile types and resource count (occasionally to avoid spam)
    // if (tilesChecked > 0 && Math.random() < 0.05) {
    //   console.log(`🔍 Resource detection at (${gridX}, ${gridZ}): checked ${tilesChecked} tiles, found ${resourceCount} resources. Tile types:`, tileTypesSeen);
    // }
    
    // Update circle color based on resource density
    this.updateCircleColor(resourceCount);
    
    // console.log(`🌳 Found ${resourceCount} resource tiles within camp radius`);
  },
  
  // Update circle color based on resource density
  updateCircleColor: function(resourceCount) {
    if (!this.radiusVisualization) return;
    
    // Calculate resource density (0-1 scale)
    const maxResources = 20; // Maximum expected resources in radius
    const density = Math.min(resourceCount / maxResources, 1.0);
    
    // Create color based on density
    let color, emissiveColor, alpha;
    
    if (resourceCount === 0) {
      // No resources - red and weak
      color = new BABYLON.Color3(0.8, 0.2, 0.2); // Red
      emissiveColor = new BABYLON.Color3(0.2, 0.05, 0.05);
      alpha = 0.1; // Very weak
    } else if (resourceCount < 4) {
      // Good resources - light green and strong
      color = new BABYLON.Color3(0.2, 0.6, 0.2); // Light green
      emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.05);
      alpha = 0.3; // Strong
    } else if (resourceCount < 7) {
      // Many resources - bright green and very strong
      color = new BABYLON.Color3(0.2, 0.6, 0.2); // Light green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
      alpha = 0.4; // Very strong
    } else if (resourceCount < 10) {
      // Many resources - bright green and very strong
      color = new BABYLON.Color3(0.1, 0.8, 0.1); // Bright green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
      alpha = 0.5; // Very strong
    } else {
      // Many resources - bright green and very strong
      color = new BABYLON.Color3(0.1, 0.8, 0.1); // Bright green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
      alpha = 0.6; // Very strong
    }
    
    // Update the circle material
    if (this.radiusVisualization.material) {
      this.radiusVisualization.material.diffuseColor = color;
      this.radiusVisualization.material.emissiveColor = emissiveColor;
      this.radiusVisualization.material.alpha = alpha;
    }
    
    // console.log(`🎨 Circle color updated: ${resourceCount} resources, density: ${density.toFixed(2)}, alpha: ${alpha}`);
  },
  
  // CRITICAL: Use EXACT same logic as gfx.js placeDecorationsOnChunk()
  // This ensures we detect the same resources that actually exist in the scene
  tileHash: function(x, y, seed) {
    let hash = seed;
    hash = hash ^ (x * 374761393);
    hash = hash ^ (y * 668265263);
    hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
    hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
    hash = hash ^ (hash >>> 16);
    return Math.abs(hash >>> 0) / 4294967296; // 0-1
  },
  
  // Check if a tile contains resources (trees or rocks)
  // MUST match the exact logic in gfx.js placeDecorationsOnChunk()
  checkTileForResources: function(gridX, gridZ) {
    if (!window.liveField) return null;
    
    const fieldSeed = window.liveField.seed;
    const terrainIndex = gridZ * window.liveField.width + gridX;
    const terrainType = window.liveField.terrainTypes[terrainIndex];
    
    if (!terrainType && terrainType !== 0) return null;
    
    // Skip spawn zones (same as gfx.js)
    if (window.liveField.isInSpawnZone && window.liveField.isInSpawnZone(gridX, gridZ)) {
      return null;
    }
    
    // CHECK 1: Rocks on dirt tiles (terrainType === 2) with ~3% chance
    if (terrainType === 2) {
      const rockRoll = this.tileHash(gridX, gridZ, fieldSeed + 1000);
      if (rockRoll < 0.03) {
        // Determine rock size (same logic as gfx.js)
        const sizeRoll = this.tileHash(gridX, gridZ, fieldSeed + 2000);
        
        if (sizeRoll < 0.3) {
          // Small rocks (30%) → gems/minerals
          return {
            type: 'minerals',
            amount: 1,
            remaining: 50, // Small rocks have less
            gridX: gridX,
            gridZ: gridZ
          };
        } else if (sizeRoll < 0.7) {
          // Medium rocks (40%) → stone
          return {
            type: 'stone',
            amount: 2,
            remaining: 100,
            gridX: gridX,
            gridZ: gridZ
          };
        } else {
          // Large rocks (30%) → more stone
          return {
            type: 'stone',
            amount: 3,
            remaining: 150, // Large rocks have more
            gridX: gridX,
            gridZ: gridZ
          };
        }
      }
    }
    
    // CHECK 2: Trees on grass tiles (terrainType === 3) with ~20% chance
    if (terrainType === 3) {
      const treeRoll = this.tileHash(gridX, gridZ, fieldSeed + 3000);
      if (treeRoll < 0.20) {
        return {
          type: 'wood',
          amount: 3,
          remaining: 150, // Initial wood amount
          gridX: gridX,
          gridZ: gridZ
        };
      }
    }
    
    return null;
  },
  
  // Create a visual indicator for a resource tile
  createResourceIndicator: function(worldX, worldZ, resourceType) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Create a small glowing sphere to indicate resources (smaller for performance)
    const indicator = BABYLON.MeshBuilder.CreateSphere("resourceIndicator", {
      diameter: 0.3 // Smaller size
    }, window.gfx.scene);
    
    indicator.position = new BABYLON.Vector3(worldX, 0.2, worldZ);
    
    // Create material based on resource type
    let material;
    if (resourceType === 'wood') {
      if (!this.woodIndicatorMaterial) {
        this.woodIndicatorMaterial = new BABYLON.StandardMaterial("woodIndicatorMaterial", window.gfx.scene);
        this.woodIndicatorMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2); // Green for wood
        this.woodIndicatorMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.4, 0.1);
        this.woodIndicatorMaterial.alpha = 0.7;
      }
      material = this.woodIndicatorMaterial;
    } else if (resourceType === 'stone') {
      if (!this.stoneIndicatorMaterial) {
        this.stoneIndicatorMaterial = new BABYLON.StandardMaterial("stoneIndicatorMaterial", window.gfx.scene);
        this.stoneIndicatorMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6); // Gray for stone
        this.stoneIndicatorMaterial.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);
        this.stoneIndicatorMaterial.alpha = 0.7;
      }
      material = this.stoneIndicatorMaterial;
    }
    
    indicator.material = material;
    indicator.isPickable = false;
    
    this.resourceIndicators.push(indicator);
  },
  
  
  // Enable placement mode with mouse tracking
  enablePlacementMode: function() {
    // Add mouse move handler for preview positioning
    this.mouseMoveHandler = (e) => {
      if (!this.isPlacing) return;
      if (!this.previewMesh) {
        // Preview mesh not loaded yet - this is normal during loading
        return;
      }
      
      try {
        // Get world position from mouse
        const pickResult = window.gfx.scene.pick(e.clientX, e.clientY);
        if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.name && pickResult.pickedMesh.name.includes('Mesh')) {
          const worldPos = pickResult.pickedPoint;
          
          // Snap to grid
          const gridX = Math.round(worldPos.x / TILE_SIZE) * TILE_SIZE;
          const gridZ = Math.round(worldPos.z / TILE_SIZE) * TILE_SIZE;
          
          // Get terrain height at this position
          let terrainY = 0;
          if (window.liveField && window.liveField.getHeightAt) {
            terrainY = window.liveField.getHeightAt(gridX, gridZ);
          }
          
          // Update preview position
          this.previewMesh.position.x = gridX;
          this.previewMesh.position.z = gridZ;
          this.previewMesh.position.y = terrainY + 0.25; // Slightly above terrain
          
          // Apply rotation
          this.previewMesh.rotation.y = this.placementRotation;
          
          // Update radius visualization for camp
          if (this.selectedBuildingType === 'camp') {
            this.updateRadiusVisualization(this.previewMesh.position);
          }
          
          // Check if position is valid and update preview color
          this.updatePreviewValidity(gridX / TILE_SIZE, gridZ / TILE_SIZE);
        }
      } catch (error) {
        // console.warn('Error in mouse move handler:', error);
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
    
    // console.log('✅ Placement mode enabled');
  },
  
  // Place building at grid coordinates
  placeBuildingAt: function(gridX, gridZ) {
    if (!this.selectedBuildingType || !this.isPlacing) return;
    
    // Check if position is valid (not too close to agora) - only during actual matches
    if (window.game && window.player && window.player.agora) {
      const agoraX = window.player.agora.x;
      const agoraZ = window.player.agora.y;
      const distance = Math.sqrt((gridX - agoraX) ** 2 + (gridZ - agoraZ) ** 2);
      
      if (distance < 3) {
        // console.log('❌ Building too close to agora');
        this.showPlacementError('Building too close to agora');
        return;
      }
    }
    
    // Check if position is already occupied
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    for (const building of gameBuildings) {
      if (building.position.x === worldX && building.position.z === worldZ) {
        // console.log('❌ Position already occupied');
        this.showPlacementError('Position already occupied');
        return;
      }
    }
    
    // MULTIPLAYER: Submit building command instead of placing directly
    if (window.isMultiplayer && window.currentMatch) {
      // CRITICAL: Include playerId so building ownership is correct!
      const normalizedPlayerId = window.player?.id?.length > 6 ? window.player.id.slice(-6) : window.player?.id;
      const command = {
        type: 'build',
        playerId: normalizedPlayerId,  // CRITICAL: Must include for proper ownership!
        buildingType: this.selectedBuildingType,
        gridX: gridX,
        gridZ: gridZ,
        rotation: this.placementRotation
        // NOTE: Resources are detected DETERMINISTICALLY during command execution, not here
      };
      window.currentMatch.submitCommand(command);
      
      // Preview cleanup - stay in placement mode
      this.previewMesh.dispose();
      this.previewMesh = null;
      this.createPreviewMesh();
      return;
    }
    
    // SINGLE PLAYER: Place building directly
    const building = placeBuilding(this.selectedBuildingType, gridX, gridZ, window.gfx.scene);
    
    if (building) {
      // CRITICAL: Set owner to player for single-player buildings!
      const rawPlayerId = window.player?.id;
      building.owner = rawPlayerId?.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      // console.log(`🏗️ Single-player building placed, owner set to: "${building.owner}"`);
      
      // Store team color so attached flag meshes can tint correctly
      if (typeof window.getTeamColorForOwner === 'function') {
        building.teamColor = window.getTeamColorForOwner(building.owner);
      }
      
      // Store the target rotation for when the mesh loads
      building.targetRotation = this.placementRotation;
      
      // DETERMINISTIC: Detect resources for camps (same logic as multiplayer)
      if (this.selectedBuildingType === 'camp' && this.checkTileForResources) {
        const workRadius = (window.BuildingTypes && window.BuildingTypes.camp && window.BuildingTypes.camp.workRadius) || 2;
        const radiusInTiles = workRadius * TILE_SIZE;
        
        const detectedResources = [];
        const gridRadius = Math.ceil(radiusInTiles / TILE_SIZE);
        
        for (let x = gridX - gridRadius; x <= gridX + gridRadius; x++) {
          for (let z = gridZ - gridRadius; z <= gridZ + gridRadius; z++) {
            const worldX = x * TILE_SIZE;
            const worldZ = z * TILE_SIZE;
            const campWorldX = gridX * TILE_SIZE;
            const campWorldZ = gridZ * TILE_SIZE;
            const distance = Math.sqrt(
              Math.pow(worldX - campWorldX, 2) + 
              Math.pow(worldZ - campWorldZ, 2)
            );
            
            if (distance <= radiusInTiles) {
              const resourceInfo = this.checkTileForResources(x, z);
              if (resourceInfo) {
                detectedResources.push({
                  gridX: x,
                  gridZ: z,
                  worldX: worldX,
                  worldZ: worldZ,
                  type: resourceInfo.type,
                  amount: resourceInfo.amount
                });
              }
            }
          }
        }
        
        if (detectedResources.length > 0) {
          // CRITICAL: Sort resources for deterministic order
          detectedResources.sort((a, b) => {
            if (a.gridX !== b.gridX) return a.gridX - b.gridX;
            return a.gridZ - b.gridZ;
          });
          building.availableResources = detectedResources;
          // console.log(`🏗️ Single-player camp detected ${detectedResources.length} resources`);
        } else {
          console.warn(`⚠️ Single-player camp found NO resources!`);
        }
      }
      
      // Set up a callback to apply rotation and team colors after mesh loads
      const checkInterval = setInterval(() => {
        if (building.mesh) {
          // Only rotate the root mesh
          building.mesh.rotationQuaternion = null;
          building.mesh.rotation.y = building.targetRotation;
          
          // Apply team colors to the building
          if (window.applyTeamColorsToMesh) {
            const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(building.owner) : '#4A90E2';
            window.applyTeamColorsToMesh(building.mesh, teamColor);
          }
          
          clearInterval(checkInterval);
        }
      }, 100);
      
      // Reset cached position and rotation
      this.lastValidPosition = null;
      this.lastValidRotation = null;
      
      // console.log(`✅ ${building.name} placed at (${gridX}, ${gridZ})`);
      
      // Show success message with resource count
      const resourceCount = this.detectedResources ? this.detectedResources.length : 0;
      // this.showPlacementSuccess(`${building.name} placed successfully! Found ${resourceCount} resource tiles.`);
      // this.showPlacementSuccess(`${building.name} placed successfully!`);

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
    // console.log(`🔄 Building rotated to ${(this.placementRotation * 180 / Math.PI).toFixed(0)}°`);
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
    
    // Clear radius visualization
    this.clearRadiusVisualization();
    
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
      
      // console.log('✅ Building placement mode exited');
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
    
    // MULTIPLAYER: Use fixed rotation for determinism
    // In single player, use random rotation
    if (window.isMultiplayer) {
      return 0; // Fixed rotation in multiplayer for determinism
    }
    
    // Single player: random rotation in 15-degree increments
    return Math.floor(Math.random() * 24) * (Math.PI / 12); // 24 * 15 degrees = 360 degrees
  },

  // Update preview validity and color
  updatePreviewValidity: function(gridX, gridZ) {
    if (!this.previewMesh) return;
    
    let isValid = true;
    
    // Check if position is valid (not too close to agora) - only during actual matches
    if (window.game && window.player && window.player.agora) {
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
  // console.log('🏗️ Building system loaded:', {
  //   buildingTypes: Object.keys(BuildingTypes),
  //   buildingSystem: !!buildingSystem,
  //   placeBuilding: !!placeBuilding
  // });
  
  // Auto-start building initialization
  setTimeout(autoInitBuildings, 2500); // Wait a bit after units initialize
  
  // Test function to create a village for testing villager spawning
  window.testVillageSpawn = function() {
    // console.log('🏘️ Creating test village for villager spawning...');
    
    if (!window.gfx || !window.gfx.scene) {
      // console.error('❌ Scene not ready for village creation');
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
      village.lastSpawnTick = 0; // Allow immediate spawning
      
      // console.log(`🏘️ Test village created at (${villageX}, ${villageZ}) - will spawn villagers every 60 seconds`);
      // console.log('🏘️ Village properties:', {
      //   spawnsVillagers: village.spawnsVillagers,
      //   spawnInterval: village.spawnInterval,
      //   maxVillagers: village.maxVillagers,
      //   spawnRadius: village.spawnRadius
      // });
    }
  };
  
  // Function to check village spawn status
  window.checkVillageStatus = function() {
    const villages = gameBuildings.filter(building => building.spawnsVillagers);
    // console.log(`🏘️ Found ${villages.length} villages:`);
    
    villages.forEach((village, index) => {
      const timeSinceLastSpawn = Date.now() - village.lastSpawnTime;
      const timeUntilNextSpawn = village.spawnInterval - timeSinceLastSpawn;
      
      // console.log(`🏘️ Village ${index + 1}:`, {
      //   position: `(${village.position.x.toFixed(1)}, ${village.position.z.toFixed(1)})`,
      //   spawnedVillagers: village.spawnedVillagers,
      //   maxVillagers: village.maxVillagers,
      //   buildProgress: village.buildProgress,
      //   timeSinceLastSpawn: `${(timeSinceLastSpawn / 1000).toFixed(1)}s`,
      //   timeUntilNextSpawn: timeUntilNextSpawn > 0 ? `${(timeUntilNextSpawn / 1000).toFixed(1)}s` : 'Ready to spawn!'
      // });
    });
  };
  
  // Function to create test work buildings
  window.testWorkBuildings = function() {
    // console.log('🔨 Creating test work buildings...');
    
    if (!window.gfx || !window.gfx.scene) {
      // console.error('❌ Scene not ready for building creation');
      return;
    }
    
    // Create a camp near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const campX = Math.floor(cameraPos.x / TILE_SIZE) + 3;
    const campZ = Math.floor(cameraPos.z / TILE_SIZE) + 3;
    
    const camp = placeBuilding('camp', campX, campZ, window.gfx.scene);
    if (camp) {
      camp.buildProgress = 1.0; // Complete the building
      // console.log(`🔨 Test camp created at (${campX}, ${campZ})`);
    }
    
    // Create a farm nearby
    const farmX = campX + 2;
    const farmZ = campZ + 2;
    
    const farm = placeBuilding('farm', farmX, farmZ, window.gfx.scene);
    if (farm) {
      farm.buildProgress = 1.0; // Complete the building
      // console.log(`🌾 Test farm created at (${farmX}, ${farmZ})`);
    }
    
    // console.log('🔨 Test buildings created - villagers should automatically start working!');
  };
  
  // Function to check work building status
  window.checkWorkStatus = function() {
    const workBuildings = gameBuildings.filter(building => building.needsWorkers);
    // console.log(`🔨 Found ${workBuildings.length} work buildings:`);
    
    workBuildings.forEach((building, index) => {
      const timeSinceLastWork = Date.now() - building.lastWorkTime;
      const timeUntilNextWork = building.workInterval - timeSinceLastWork;
      
      // console.log(`🔨 ${building.name} ${index + 1}:`, {
      //   position: `(${building.position.x.toFixed(1)}, ${building.position.z.toFixed(1)})`,
      //   assignedWorkers: building.assignedWorkers.length,
      //   maxWorkers: building.maxWorkers,
      //   workType: building.workType,
      //   workOutput: building.workOutput,
      //   buildProgress: building.buildProgress,
      //   timeSinceLastWork: `${(timeSinceLastWork / 1000).toFixed(1)}s`,
      //   timeUntilNextWork: timeUntilNextWork > 0 ? `${(timeUntilNextWork / 1000).toFixed(1)}s` : 'Ready to work!'
      // });
    });
  };
  
  // Function to check player resources
  window.checkResources = function() {
    if (window.player && window.player.getResources) {
      const resources = window.player.getResources();
      // console.log('💰 Player resources:', resources);
    } else {
      // console.error('❌ Player or resource system not available');
    }
  };
  
  // DIAGNOSTIC: Function to debug work assignment issues
  window.debugWorkAssignment = function() {
    console.log('=== WORK ASSIGNMENT DEBUG ===');
    console.log(`Player ID: ${window.player?.id}`);
    console.log(`Opponent ID: ${window.opponent?.id}`);
    console.log(`Game exists: ${!!window.game}`);
    console.log(`\n--- BUILDINGS ---`);
    
    gameBuildings.forEach((building, i) => {
      if (building.needsWorkers) {
        const normalizedOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
        const normalizedPlayerId = window.player?.id?.length > 6 ? window.player.id.slice(-6) : window.player?.id;
        const isPlayerBuilding = normalizedOwner === normalizedPlayerId;
        
        console.log(`\nBuilding ${i}: ${building.name} (${building.type})`);
        console.log(`  Owner: ${building.owner} (normalized: ${normalizedOwner})`);
        console.log(`  Is player's: ${isPlayerBuilding}`);
        console.log(`  Workers: ${building.assignedWorkers.length}/${building.maxWorkers}`);
        console.log(`  Work type: ${building.workType}`);
        console.log(`  Resources: ${building.availableResources?.length || 0} tiles`);
        console.log(`  Build progress: ${building.buildProgress}`);
      }
    });
    
    console.log(`\n--- VILLAGERS ---`);
    const villagers = gameUnits.filter(u => u.type === 'villager');
    console.log(`Total villagers: ${villagers.length}`);
    console.log(`Player villagers: ${window.player?.units.filter(u => u.type === 'villager').length || 0}`);
    console.log(`Opponent villagers: ${window.opponent?.units.filter(u => u.type === 'villager').length || 0}`);
    
    villagers.slice(0, 5).forEach((v, i) => {
      const normalizedOwner = v.owner?.length > 6 ? v.owner.slice(-6) : v.owner;
      const behavior = window.behaviorManager?.getBehavior(v);
      const behaviorName = behavior ? behavior.constructor.name : 'none';
      console.log(`\nVillager ${i}: owner=${v.owner} (normalized: ${normalizedOwner})`);
      console.log(`  Behavior: ${behaviorName}`);
      console.log(`  Assigned building: ${v.assignedBuilding?.name || 'none'}`);
      console.log(`  In player.units: ${window.player?.units.includes(v) || false}`);
      console.log(`  In opponent.units: ${window.opponent?.units.includes(v) || false}`);
    });
  };
  
  // DIAGNOSTIC: Function to debug why villagers aren't being assigned
  window.debugVillagerAssignment = function() {
    console.log('=== VILLAGER ASSIGNMENT DEBUG ===');
    console.log(`Player ID: ${window.player?.id}`);
    console.log(`Player units: ${window.player?.units.length}`);
    console.log(`Game units: ${window.gameUnits?.length}`);
    
    // Find player's camp
    const playerCamp = gameBuildings.find(b => b.type === 'camp' && b.owner === window.player?.id);
    if (!playerCamp) {
      console.log('❌ No player camp found!');
      return;
    }
    
    console.log(`\nPlayer Camp: ${playerCamp.name} at (${playerCamp.position.x.toFixed(1)}, ${playerCamp.position.z.toFixed(1)})`);
    console.log(`  Workers: ${playerCamp.assignedWorkers.length}/${playerCamp.maxWorkers}`);
    console.log(`  Resources: ${playerCamp.availableResources?.length || 0}`);
    
    // Check all player villagers
    console.log(`\n--- PLAYER VILLAGERS ---`);
    let idleCount = 0;
    window.player.units.filter(u => u.type === 'villager').forEach((villager, i) => {
      const dx = villager.pb?.state?.loc?.x - playerCamp.position.x;
      const dz = villager.pb?.state?.loc?.z - playerCamp.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const currentBehavior = window.behaviorManager?.getBehavior(villager);
      const behaviorName = currentBehavior?.constructor?.name || 'none';
      const isIdle = !currentBehavior || behaviorName === 'LingerBehavior';
      
      if (isIdle) idleCount++;
      
      console.log(`  ${i+1}. ${villager.name || 'Villager'}`);
      console.log(`     Position: (${villager.pb?.state?.loc?.x.toFixed(1)}, ${villager.pb?.state?.loc?.z.toFixed(1)})`);
      console.log(`     Distance to camp: ${distance.toFixed(1)} units`);
      console.log(`     Behavior: ${behaviorName}`);
      console.log(`     Is idle: ${isIdle}`);
      console.log(`     Owner: ${villager.owner}`);
      console.log(`     Assigned building: ${villager.assignedBuilding?.name || 'none'}`);
    });
    
    console.log(`\nTotal idle villagers: ${idleCount}`);
    console.log(`Search radius: ${(playerCamp.workRadius || 20) * TILE_SIZE} world units`);
  };
  
  // Function to test resource display
  window.testResourceDisplay = function() {
    // console.log('💰 Testing resource display...');
    
    if (!window.player) {
      // console.error('❌ Player not available');
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
      // console.log('💰 Resource display updated!');
    } else {
      // console.error('❌ Resource display function not available');
    }
  };
  
  // Function to spawn test engineers
  window.spawnTestEngineers = function() {
    // console.log('🔧 Spawning test engineers...');
    
    if (!window.player || !window.gfx || !window.gfx.scene) {
      // console.error('❌ Player or scene not available');
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
      
      const ownerId = window.player?.id;
      const engineer = new Unit('engineer', { x, y: 0, z });
      engineer.owner = ownerId;
      
      // Random rotation
      const randomRotation = Math.random() * Math.PI * 2;
      engineer.rotation = randomRotation;
      if (engineer.pb.state && engineer.pb.state.rot) {
        engineer.pb.state.rot.y = randomRotation;
      }
      
      // Add to player's units
      window.player.units.push(engineer);
      gameUnits.push(engineer);
      
      // console.log(`🔧 Spawned engineer ${i + 1} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    
    // Spawn the visual models
    if (window.spawnUnitModels) {
      window.spawnUnitModels(window.gfx.scene);
    }
    
    // console.log(`🔧 Spawned ${engineerCount} engineers - they should start working at nearby buildings!`);
  };
  
  
}
