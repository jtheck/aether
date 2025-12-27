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
    category: "civic",
    // Construction properties
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15, // How far to look for idle villagers (tiles)
    workType: "build" // Type of work this building needs
  },
  camp: {
    name: "Camp",
    model: "assets/models/camp.glb",
    scale: .4,
    rotation: 0, // No rotation by default
    size: { width: 2, height: 2 },
    cost: { wood: 5, stone: 0 },
    description: "Basic work camp",
    category: "residential",
    // Construction properties (before completion)
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15, // How far to look for idle villagers (tiles)
    workType: "build", // Type of work this building needs during construction
    // Production properties (after completion - set dynamically)
    productionWorkType: "gather", // Type of work this building provides after construction
    productionMaxWorkers: 8,
    productionWorkRadius: 7, // Resource detection and worker search radius (tiles) - 7 tiles × 4px = 28 world units
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
    cost: { wood: 25, stone: 0 },
    description: "Basic housing for villagers",
    category: "residential",
    // Construction properties
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15, // How far to look for idle villagers (tiles)
    workType: "build", // Type of work this building needs
    // Villager spawning properties (only after construction complete)
    spawnsVillagers: true,
    spawnInterval: 30000, // 30 seconds in milliseconds
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
    // Construction properties (before completion)
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15, // How far to look for idle villagers (tiles)
    workType: "build", // Type of work this building needs during construction
    // Production properties (after completion - set dynamically)
    productionWorkType: "farm", // Type of work this building provides after construction
    productionMaxWorkers: 2,
    productionWorkRadius: 8, // How far to look for idle villagers (tiles) - 8 tiles × 4px = 32 world units
    workInterval: 10000, // How often workers produce resources (10 seconds)
    workOutput: { food: 4 } // Resources produced per work cycle
  },
  tower: {
    name: "Watchtower",
    model: "assets/models/tower.glb", 
    scale: .429,
    rotation: 0, // 30 degrees
    size: { width: 2, height: 2 },
    cost: { stone: 20, wood: 20 },
    description: "Defensive structure with long sight range",
    category: "military",
    // Construction properties
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15, // How far to look for idle villagers (tiles)
    workType: "build" // Type of work this building needs
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
  
  // MULTIPLAYER: Use deterministic ID from options (generated by Match.buildingCounter)
  // If no ID provided, fall back to building count (for backwards compatibility or single-player)
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
  this.buildProgress = options.buildProgress !== undefined ? options.buildProgress : 0.0; // 0-1, 1 = complete, start at 0 for construction
  this.completionProcessed = false; // CRITICAL: Track if completion has been synchronized across all peers
  this.completionCommandSent = false; // Track if completion command has been sent (multiplayer)
  
  // CRITICAL: Track construction start tick for deterministic progress calculation
  this.constructionStartTick = options.constructionStartTick || 0;
  this.constructionWorkTicks = 0; // Total work ticks accumulated (worker-ticks)
  this.lastConstructionTick = -1; // Track last tick we processed construction (prevent double-counting)
  
  // Villager spawning properties (for buildings that spawn villagers)
  this.lastSpawnTick = 0; // Last tick a villager spawned (deterministic)
  this.spawnedVillagers = 0; // Count of villagers spawned by this building
  
  // Work assignment properties (for buildings that need workers)
  this.assignedWorkers = []; // Array of villager units assigned to this building
  this.lastWorkTick = 0; // Last tick workers produced resources (deterministic)
  this.lastWorkerCheckTick = -1; // Prevent multiple assignment passes per tick
  
  // 3D model reference
  this.mesh = null;
  
  // // console.log(`Created ${this.name} at position`, this.position);
}

// Place a specific building at coordinates
function placeBuilding(buildingType, x, z, scene, options = {}) {
  // // console.log(`🏗️ Placing building: ${buildingType} at tile (${x}, ${z})`);
  
  const worldX = x * TILE_SIZE;
  const worldZ = z * TILE_SIZE;
  
  // Get terrain height at this position using bilinear interpolation
  const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(worldX, worldZ) : 0;
  
  // Add small offset so building sits on terrain surface
  const buildingHeight = terrainY + 0.1;
  const worldPosition = new BABYLON.Vector3(worldX, buildingHeight, worldZ);
  // // console.log(`🌍 World position: (${worldPosition.x}, ${worldPosition.y}, ${worldPosition.z})`);
  
  // CRITICAL: Pass grid coordinates explicitly for accurate checksum calculation
  // Merge options with grid coordinates
  const buildingOptions = { ...options, gridX: x, gridZ: z };
  const building = new Building(buildingType, { x: worldPosition.x, y: buildingHeight, z: worldPosition.z }, buildingOptions);
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
      
      // Set position and initial scale/height based on build progress
      building.mesh.position = worldPosition.clone();
      const targetScale = building.scale || 1.0;
      
      // If building is under construction, start at half height and rise to full height
      if (building.buildProgress < 1.0) {
        const progressScale = 0.1 + (building.buildProgress * 0.9); // Scale from 10% to 100%
        building.mesh.scaling = new BABYLON.Vector3(targetScale * progressScale, targetScale * progressScale, targetScale * progressScale);
        // Start at half height (buildingHeight - 1), rise to full height (buildingHeight) as progress increases
        const halfHeight = buildingHeight - 1; // Half way up from below ground
        const finalHeight = buildingHeight;
        building.mesh.position.y = halfHeight + (finalHeight - halfHeight) * building.buildProgress;
      } else {
        // Building is complete, set final position and scale
        building.mesh.position.y = buildingHeight;
        building.mesh.scaling = new BABYLON.Vector3(targetScale, targetScale, targetScale);
      }
      
      // Make it visible (only if setEnabled method exists)
      if (typeof building.mesh.setEnabled === 'function') {
        building.mesh.setEnabled(true);
      }
      
      // Tag as building so terrain clicks can ignore it
      building.mesh.isBuilding = true;
      building.mesh.getChildMeshes().forEach(childMesh => {
        childMesh.isBuilding = true;
      });
      
      // AGORA ONLY: Store platform height for units to stand on
      if (buildingType === 'agora') {
        // Calculate the top height of the agora (for units to stand on)
        building.platformHeight = 2.5; // Units stand 2.5 units above ground on agora
        building.platformRadius = 8; // Platform area in world units (where units can stand)
        building.collisionRadius = 3.5; // Collision hitbox radius (prevents walking through building)
        
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
            
            // Ensure teamColorHex is a string (handle Color3 objects or other types)
            if (teamColorHex && typeof teamColorHex !== 'string') {
              // If it's a Color3 object, convert to hex string
              if (teamColorHex.r !== undefined && teamColorHex.g !== undefined && teamColorHex.b !== undefined) {
                const r = Math.round(teamColorHex.r * 255).toString(16).padStart(2, '0');
                const g = Math.round(teamColorHex.g * 255).toString(16).padStart(2, '0');
                const b = Math.round(teamColorHex.b * 255).toString(16).padStart(2, '0');
                teamColorHex = `#${r}${g}${b}`;
              } else {
                // Fallback to default if we can't convert
                teamColorHex = null;
              }
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
      
      // Only add particle effects if building is complete (construction will add them when done)
      if (building.buildProgress >= 1.0) {
        // Add particle effects immediately for completed buildings
        addBuildingParticleEffects(building);
      }
    }).catch(err => {
      // console.error(`❌ Failed to load ${building.name} model:`, err);
    });
  } else {
    // console.error(`❌ Graphics system not available!`);
  }
  
  // CRITICAL: Push to window.gameBuildings (not local gameBuildings) 
  // to ensure we're using the array after any resets
  window.gameBuildings.push(building);
  
  // Debug: Log when building is placed
  console.log(`🏗️ PLACED ${building.type} for ${building.owner}: progress=${(building.buildProgress*100).toFixed(0)}%, needsWorkers=${building.needsWorkers}, workType=${building.workType}`);
  
  return building;
}

// Place the agora at the player's agora location
function placeAgora(scene, options = {}) {
  // Agora starts complete (it's the starting building)
  const agoraOptions = { ...options, buildProgress: 1.0 };
  if (window.player && window.player.agora) {
    return placeBuilding('agora', window.player.agora.x, window.player.agora.y, scene, agoraOptions);
  } else {
    // console.warn("Player agora location not found, using default (15, 15)");
    return placeBuilding('agora', 15, 15, scene, agoraOptions);
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
  
  // CRITICAL: Check if village completion has been processed (synchronized across all peers)
  // This ensures villagers only spawn after the synchronized completion event
  if (!village.completionProcessed || village.buildProgress < 1.0) {
    return;
  }
  
  // Check if enough time has passed since last spawn (DETERMINISTIC with ticks)
  const currentTick = window.currentMatch?.tick || 0;
  
  // First villager spawns very quickly (20 ticks = 1 second), rest use normal interval
  // Convert milliseconds to ticks (20 ticks per second at 20Hz)
  const tickRate = 20; // Match net.TICK_RATE
  const spawnDelayTicks = village.spawnedVillagers === 0 ? 20 : Math.floor(village.spawnInterval / 1000 * tickRate);
  
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
  
  // CRITICAL: Use deterministic unit counter for multiplayer sync
  // Increment counter BEFORE creating unit to ensure consistent IDs across clients
  let unitIndex;
  let deterministicUnitId;
  if (window.isMultiplayer && window.currentMatch) {
    unitIndex = window.currentMatch.unitCounter++;
    deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
  }
  
  // Find a spawn position near the village (pass unitIndex for deterministic offsets)
  const spawnPosition = findVillagerSpawnPosition(village, unitIndex);
  if (!spawnPosition) {
    return; // No valid spawn position found
  }
  
  // Create the villager
  // CRITICAL: Always pass id in options (even if undefined) to prevent Unit constructor from incrementing counter
  const villager = new Unit('villager', spawnPosition, { id: deterministicUnitId || undefined });
  // CRITICAL: Set owner correctly - use normalized ID if it's a long ID
  const rawOwner = village.owner;
  villager.owner = rawOwner?.length > 6 ? rawOwner.slice(-6) : rawOwner;
  
  // Deterministic rotation based on building ID, spawn count, and unit index (if multiplayer)
  const buildingIdHash = (village.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const rotationSeed = window.isMultiplayer && unitIndex !== undefined 
    ? (buildingIdHash + unitIndex + currentTick)
    : (buildingIdHash + village.spawnedVillagers + currentTick);
  const deterministicRotation = (rotationSeed % 628) / 100; // 0 to ~6.28 (2π)
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
      if (typeof villager.mesh.setEnabled === 'function') {
        villager.mesh.setEnabled(true);
      }
      
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
function findVillagerSpawnPosition(village, unitIndex) {
  if (!village || !village.position) return null;
  
  const maxAttempts = 20;
  const spawnRadius = (village.spawnRadius || 3) * 1.5; // Increased spawn radius for more spread
  
  // CRITICAL: Use deterministic values based on building ID and unitIndex ONLY
  // DO NOT use currentTick - it can vary between clients and cause position drift!
  // Use unitIndex for deterministic offsets across all clients (more reliable than spawnedVillagers)
  const buildingIdHash = (village.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  // Use unitIndex if available (multiplayer), otherwise fall back to spawnedVillagers (single-player)
  const spawnSeed = unitIndex !== undefined ? unitIndex : (village.spawnedVillagers || 0);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate deterministic position within spawn radius
    // CRITICAL: Only use buildingIdHash + spawnSeed + attempt for determinism
    const angleSeed = (buildingIdHash + spawnSeed + attempt * 37) % 628;
    const angle = angleSeed / 100; // 0 to ~6.28 (2π)
    
    const distanceSeed = (buildingIdHash + spawnSeed + attempt * 73) % 1000;
    const distance = (distanceSeed / 1000) * spawnRadius * TILE_SIZE;
    
    const spawnX = village.position.x + Math.cos(angle) * distance;
    const spawnZ = village.position.z + Math.sin(angle) * distance;
    
    // Check if position is valid (not too close to other units/buildings)
    const isValidPosition = isPositionValidForSpawn(spawnX, spawnZ);
    
    if (isValidPosition) {
      return { x: spawnX, y: 0, z: spawnZ };
    }
  }
  
  // If no valid position found, spawn at village position with deterministic offset
  // CRITICAL: Only use buildingIdHash + spawnSeed for determinism (no currentTick!)
  const offsetSeed = (buildingIdHash + spawnSeed) % 1000;
  const offset = (offsetSeed / 1000 - 0.5) * TILE_SIZE;
  return { 
    x: village.position.x + offset, 
    y: 0, 
    z: village.position.z + offset 
  };
}

// Check if a position is valid for spawning a villager
// CRITICAL: Must be deterministic - sort units/buildings by ID for consistent iteration order
// CRITICAL: In multiplayer, skip validation to ensure deterministic spawn positions
function isPositionValidForSpawn(x, z) {
  // CRITICAL: In multiplayer, always return true to avoid position-dependent divergence
  // Small position drift could cause different validation results between clients
  if (window.isMultiplayer) {
    return true;
  }
  
  const minDistance = TILE_SIZE * 1.5; // Minimum distance from other units
  
  // CRITICAL: Sort units by ID for deterministic iteration order
  // This ensures both clients check the same units in the same order
  const sortedUnits = (window.gameUnits || gameUnits).slice().sort((a, b) => 
    (a.id || '').localeCompare(b.id || '')
  );
  
  // Check distance from other units
  for (const unit of sortedUnits) {
    if (unit.pb && unit.pb.state && unit.pb.state.loc) {
      const dx = x - unit.pb.state.loc.x;
      const dz = z - unit.pb.state.loc.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < minDistance) {
        return false;
      }
    }
  }
  
  // CRITICAL: Sort buildings by ID for deterministic iteration order
  const sortedBuildings = (window.gameBuildings || gameBuildings).slice().sort((a, b) => 
    (a.id || '').localeCompare(b.id || '')
  );
  
  // Check distance from other buildings
  for (const building of sortedBuildings) {
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
  
  // CRITICAL: Sort units by ID before iterating for deterministic order
  // This ensures both clients check the same units in the same order
  const sortedUnits = (window.gameUnits || []).slice().sort((a, b) =>
    (a.id || '').localeCompare(b.id || '')
  );
  
  // Look through all game units for idle villagers and engineers
  for (const unit of sortedUnits) {
    if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
    if (unit.type !== 'villager' && unit.type !== 'engineer') continue;
    
    // CRITICAL: Normalize both IDs for comparison (handle both full and shortened IDs)
    const normalizedUnitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
    const normalizedBuildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
    if (normalizedUnitOwner !== normalizedBuildingOwner) continue; // Only assign workers to same owner
    
    // Check if villager is idle (no active behavior OR just has linger behavior)
    // Also check if villager is stuck at an empty camp (GatherWorkBehavior with no resources)
    const currentBehavior = window.behaviorManager ? window.behaviorManager.getBehavior(unit) : null;
    let isIdleOrLingering = !currentBehavior || 
                              (currentBehavior && currentBehavior.constructor.name === 'LingerBehavior');
    
    // SPECIAL: Check if villager has GatherWorkBehavior but camp has no resources
    if (!isIdleOrLingering && currentBehavior && currentBehavior.constructor.name === 'GatherWorkBehavior') {
      const gatherBuilding = currentBehavior.building;
      if (gatherBuilding && gatherBuilding.type === 'camp' && gatherBuilding.workType === 'gather') {
        const availableResources = gatherBuilding.availableResources || [];
        const hasAvailableResources = availableResources.some(r => 
          !r.depleted && r.remaining > 0 && r.depletionTick === undefined &&
          (!window.isResourceTileDepleted || !window.isResourceTileDepleted(r.gridX, r.gridZ))
        );
        if (!hasAvailableResources) {
          // Treat as idle - camp has no resources
          isIdleOrLingering = true;
        }
      }
    }
    
    if (!isIdleOrLingering) continue;
    
    // CRITICAL: Don't auto-assign units that just completed a player move command
    // Give them at least 60 ticks (3 seconds) to stay where the player told them to go
    if (unit.lastPlayerMoveTick !== undefined) {
      const currentTick = window.currentMatch?.tick || 0;
      const ticksSincePlayerMove = currentTick - unit.lastPlayerMoveTick;
      if (ticksSincePlayerMove < 60) {
        continue; // Skip this unit - player just moved them, let them stay put!
      }
    }
    
    // Calculate distance to building for proximity-based assignment
    const dx = unit.pb.state.loc.x - building.position.x;
    const dz = unit.pb.state.loc.z - building.position.z;
    const distanceSquared = dx * dx + dz * dz;
    const maxDistance = workRadius * TILE_SIZE;
    
    // In multiplayer, use rounded distance to prevent desyncs from position drift
    // Rounding to nearest tile ensures deterministic distance comparisons
    if (window.isMultiplayer) {
      // Round distance to nearest tile for deterministic comparison
      const roundedDistance = Math.round(Math.sqrt(distanceSquared) / TILE_SIZE) * TILE_SIZE;
      if (roundedDistance <= maxDistance) {
        idleVillagers.push({unit, distance: roundedDistance});
      }
    } else {
      // Single-player: Use exact distance for better assignment logic
      const distance = Math.sqrt(distanceSquared);
      if (distance <= maxDistance) {
        idleVillagers.push({unit, distance});
      }
    }
  }
  
  // Sort by distance first (closer workers get priority), then by ID for determinism
  // In multiplayer, distances are rounded to prevent desyncs from position drift
  idleVillagers.sort((a, b) => {
    // Sort by distance first (closer = higher priority)
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    // If distances are equal (or both 0), sort by ID for determinism
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
  } else if (building.workType === 'build') {
    workBehaviorType = 'build_work';
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
    // Count only non-depleted, available resources (not scheduled for depletion)
    const availableResourceCount = building.availableResources?.filter(r => 
      !r.depleted && r.remaining > 0 && r.depletionTick === undefined
    ).length || 0;
    const totalResourceCount = building.availableResources?.length || 0;
    // Note: Workers are automatically released when camp has no resources (see GatherWorkBehavior)
    // Only log warning once per camp to avoid spam
    if (availableResourceCount === 0 && !building._noResourcesWarned) {
      building._noResourcesWarned = true;
      // console.warn(`⚠️ Camp has NO available resources! Workers will be released.`);
    } else if (availableResourceCount > 0) {
      building._noResourcesWarned = false; // Reset if resources become available again
    }
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

// Process building completion (called both locally and via command for sync)
function processBuildingCompletion(building) {
  if (!building || building.completionProcessed) return;
  
  building.completionProcessed = true;
  building.buildProgress = 1.0; // Clamp to 1.0
  
  
  // Ensure final position and scale
  if (building.mesh) {
    building.mesh.position.y = building.position.y || 0;
    const baseScale = building.scale || 1.0;
    building.mesh.scaling.x = baseScale;
    building.mesh.scaling.y = baseScale;
    building.mesh.scaling.z = baseScale;
    
    // PERFORMANCE: Freeze building mesh once construction is complete
    // Buildings don't move/rotate/scale after construction, so freezing gives huge perf boost
    if (building.mesh.freezeWorldMatrix) {
      building.mesh.freezeWorldMatrix();
      building.mesh.metadata = building.mesh.metadata || {};
      building.mesh.metadata.isFrozen = true;
    }
    // Also freeze child meshes
    building.mesh.getChildMeshes && building.mesh.getChildMeshes().forEach(childMesh => {
      if (childMesh.freezeWorldMatrix) {
        childMesh.freezeWorldMatrix();
      }
    });
  }
  
  // CRITICAL: Initialize timing ticks when construction completes for deterministic behavior
  const currentTick = window.currentMatch?.tick || 0;
  
  // Initialize lastSpawnTick for villages to ensure deterministic spawning
  if (building.spawnsVillagers && building.lastSpawnTick === 0) {
    building.lastSpawnTick = currentTick; // Set to completion tick
  }
  
  // Initialize lastWorkTick for production buildings to ensure deterministic production timing
  if (building.productionWorkType && building.lastWorkTick === 0) {
    building.lastWorkTick = currentTick; // Set to completion tick
  }
  
  // Switch to production workType if building has one
  if (building.productionWorkType && building.workType === 'build') {
    building.workType = building.productionWorkType;
    building.maxWorkers = building.productionMaxWorkers || building.maxWorkers;
    building.workRadius = building.productionWorkRadius || building.workRadius;
    // Clear assigned workers so they can be reassigned for production
    building.assignedWorkers.forEach(worker => {
      if (worker) {
        worker.assignedBuilding = null;
        if (window.behaviorManager) {
          const behavior = window.behaviorManager.getBehavior(worker);
          if (behavior && behavior.building === building) {
            window.behaviorManager.setBehavior(worker, 'linger');
          }
        }
      }
    });
    building.assignedWorkers = [];
  } else if (!building.productionWorkType && building.workType === 'build') {
    // Building has no production workType (like agora, tower), so stop needing workers after construction
    building.needsWorkers = false;
    // Clear assigned workers
    building.assignedWorkers.forEach(worker => {
      if (worker) {
        worker.assignedBuilding = null;
        if (window.behaviorManager) {
          const behavior = window.behaviorManager.getBehavior(worker);
          if (behavior && behavior.building === building) {
            window.behaviorManager.setBehavior(worker, 'linger');
          }
        }
      }
    });
    building.assignedWorkers = [];
  }
  
  // Add particle effects when construction completes
  if (window.fx && !building.constructionCompleteEffectsAdded) {
    building.constructionCompleteEffectsAdded = true;
    setTimeout(() => {
      if (building.mesh) {
        building.mesh.computeWorldMatrix(true);
        addBuildingParticleEffects(building);
      }
    }, 100);
  }
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
  const tickRate = 20; // Match net.TICK_RATE
  const workIntervalTicks = Math.floor((building.workInterval || 5000) / 1000 * tickRate); // Convert ms to ticks (20 ticks/sec)
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
    baseMat.alpha = 1.0; // Opaque
    baseDisc.material = baseMat;
    baseDisc.isVisible = false; // Hidden for mobile performance (translucent meshes are expensive)
    
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
    progressMat.alpha = 1.0;
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
    const ownerColorHex = window.getTeamColorForOwner(agora.owner);
    if (ownerColorHex) {
      // Convert hex string to Color3
      const clean = typeof ownerColorHex === 'string' ? ownerColorHex.replace('#', '') : '';
      if (clean.length === 6) {
        const r = parseInt(clean.substr(0, 2), 16) / 255;
        const g = parseInt(clean.substr(2, 2), 16) / 255;
        const b = parseInt(clean.substr(4, 2), 16) / 255;
        const ownerColor = new BABYLON.Color3(r, g, b);
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
  }
  
  // Update progress disc
  if (captureProgress > 0) {
    const scale = Math.min(1.0, captureProgress / 100);
    visuals.progressDisc.scaling.x = scale;
    visuals.progressDisc.scaling.z = scale;
    visuals.progressDisc.isVisible = true;
    
    // Set color based on capturing team
    if (capturerTeam && window.getTeamColorForOwner) {
      const capturerColorHex = window.getTeamColorForOwner(capturerTeam);
      if (capturerColorHex) {
        // Convert hex string to Color3
        const clean = typeof capturerColorHex === 'string' ? capturerColorHex.replace('#', '') : '';
        if (clean.length === 6) {
          const r = parseInt(clean.substr(0, 2), 16) / 255;
          const g = parseInt(clean.substr(2, 2), 16) / 255;
          const b = parseInt(clean.substr(4, 2), 16) / 255;
          const capturerColor = new BABYLON.Color3(r, g, b);
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

// Update tower attack logic
function updateTowerAttack(tower, deltaTime) {
  if (!window.projectiles || !window.gameUnits) {
    return;
  }
  
  // Initialize tower attack properties
  if (!tower.attackCooldown) {
    tower.attackCooldown = 0;
    tower.attackRange = 15; // Tower range in world units (tiles * TILE_SIZE)
    // Lower damage so arrows tend to shove units around instead of one-shotting them
    tower.attackDamage = 8;
    tower.attackInterval = 2.0; // Seconds between attacks
    tower.currentTarget = null;
  }
  
  // Update cooldown
  if (tower.attackCooldown > 0) {
    tower.attackCooldown -= deltaTime;
    return;
  }
  
  // Find enemy units in range
  const towerPos = tower.mesh ? tower.mesh.getAbsolutePosition() : 
                   new BABYLON.Vector3(tower.position.x, tower.position.y || 2, tower.position.z);
  
  let nearestEnemy = null;
  let nearestDistance = tower.attackRange;
  
  window.gameUnits.forEach(unit => {
    if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) {
      return;
    }
    
    // Skip friendly units (same owner)
    if (unit.owner === tower.owner) {
      return;
    }
    
    // Skip units with no health
    if (!unit.health || unit.health <= 0) {
      return;
    }
    
    const unitPos = new BABYLON.Vector3(
      unit.pb.state.loc.x,
      unit.pb.state.loc.y || 0,
      unit.pb.state.loc.z
    );
    
    const distance = BABYLON.Vector3.Distance(towerPos, unitPos);
    
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearestEnemy = unit;
    }
  });
  
  // Fire at nearest enemy
  if (nearestEnemy && window.projectiles && window.projectiles.fire) {
    try {
      const targetPos = new BABYLON.Vector3(
        nearestEnemy.pb.state.loc.x,
        nearestEnemy.pb.state.loc.y || 0.5,
        nearestEnemy.pb.state.loc.z
      );
      
      // Fire arrow
      const projectile = window.projectiles.fire({
        type: 'arrow',
        from: towerPos.clone().add(new BABYLON.Vector3(0, 2, 0)), // Fire from top of tower
        to: targetPos,
        damage: tower.attackDamage,
        owner: tower.owner
      });
      
      // Only set cooldown if projectile was successfully created
      if (projectile) {
        tower.attackCooldown = tower.attackInterval;
        tower.currentTarget = nearestEnemy;
      }
    } catch (e) {
      console.warn('Error firing tower projectile:', e);
      // Still set cooldown to prevent spam
      tower.attackCooldown = tower.attackInterval;
    }
  } else {
    tower.currentTarget = null;
  }
}

// Update building logic (damage, construction progress, etc.)
function updateBuildings(deltaTime) {
  // Safe to run in menu scene - just guard against missing dependencies
  if (!window.gameBuildings || window.gameBuildings.length === 0) {
    return; // No buildings to update
  }
  
  // Debug: Log every 2 seconds with detailed state
  const currentTick = window.currentMatch?.tick || 0;
  if (currentTick % 40 === 0 && currentTick > 0) {
    const buildingCount = window.gameBuildings.length;
    const underConstruction = window.gameBuildings.filter(b => b.buildProgress < 1.0);
    console.log(`🏗️ UPDATE BUILDINGS: ${buildingCount} total, ${underConstruction.length} under construction`);
    underConstruction.forEach(b => {
      console.log(`   - ${b.type} (${b.owner}): progress=${(b.buildProgress*100).toFixed(0)}%, workers=${b.assignedWorkers?.length || 0}, needsWorkers=${b.needsWorkers}, workType=${b.workType}`);
    });
  }
  
  // CRITICAL: Sort buildings by ID for deterministic iteration order
  // This ensures both clients process buildings in the same order,
  // which is essential for deterministic worker assignment
  const sortedBuildings = (window.gameBuildings || gameBuildings).slice().sort((a, b) =>
    (a.id || '').localeCompare(b.id || '')
  );
  
  sortedBuildings.forEach(building => {
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
    // CRITICAL: Only spawn villagers after completion is processed (synchronized across all peers)
    // This ensures villagers spawn at the same time on all clients
    const isGameActive = (window.currentMatch && window.currentMatch.state === 'playing') || window.game;
    if (building.spawnsVillagers && building.completionProcessed && isGameActive) {
      spawnVillagerFromVillage(building);
    }
    
    // Handle construction progress for buildings being built
    if (building.needsWorkers && building.workType === 'build' && building.buildProgress < 1.0 && (window.game || window.currentMatch)) {
      const currentTick = window.currentMatch?.tick || 0;
      const workerCount = building.assignedWorkers.length;
      
      // Debug: Log construction state periodically
      if (currentTick % 100 === 0 && currentTick > 0) {
        console.log(`🔨 Building ${building.type} (${building.id?.slice(-6)}): progress=${(building.buildProgress * 100).toFixed(1)}%, workers=${workerCount}, workTicks=${building.constructionWorkTicks}`);
      }
      
      // Create/update construction indicator cube (purple cube for all buildings under construction)
      if (!building.constructionIndicator && window.gfx && window.gfx.scene) {
        building.constructionIndicator = BABYLON.MeshBuilder.CreateBox(`constructionIndicator_${building.id}`, {
          size: 1.0  // Will be scaled to 0.5 (half size)
        }, window.gfx.scene);
        building.constructionIndicator.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5); // Half size
        building.constructionIndicator.isPickable = false;
        
        // Purple material
        const material = new BABYLON.StandardMaterial(`constructionIndicatorMat_${building.id}`, window.gfx.scene);
        material.diffuseColor = new BABYLON.Color3(0.67, 0, 1); // Purple (#aa00ff)
        material.emissiveColor = new BABYLON.Color3(0.33, 0, 0.5);
        material.alpha = 1.0;
        building.constructionIndicator.material = material;
      }
      
      // Update indicator position (above building)
      if (building.constructionIndicator && building.position) {
        const terrainY = window.getTerrainHeightAtPosition ? 
          window.getTerrainHeightAtPosition(building.position.x, building.position.z) : building.position.y || 0;
        building.constructionIndicator.position.x = building.position.x;
        building.constructionIndicator.position.z = building.position.z;
        building.constructionIndicator.position.y = terrainY + 3; // Above building
        building.constructionIndicator.setEnabled(true);
      }
      
      // Progress construction based on worker count (1 worker = base speed, 3 workers = 3x speed)
      if (workerCount > 0) {
        // CRITICAL: Track construction start tick on first work tick
        if (building.constructionStartTick === 0) {
          building.constructionStartTick = currentTick;
        }
        
        // CRITICAL: Only accumulate work ticks once per game tick, not every physics frame
        // This ensures deterministic construction progress across all clients
        // Check if we've already processed this tick
        if (building.lastConstructionTick !== currentTick) {
          building.lastConstructionTick = currentTick;
          // Accumulate work ticks (each worker contributes 1 tick per game tick)
          const oldWorkTicks = building.constructionWorkTicks;
          building.constructionWorkTicks += workerCount;
          
          // Construction progress tracked silently for multiplayer sync
        }
        
        // Calculate progress deterministically from total work ticks
        // With 3 workers at 20 TPS: 3 worker-ticks per game tick
        // Target: ~100 ticks to complete = 300 total worker-ticks (100 ticks * 3 workers)
        const TOTAL_WORKER_TICKS_NEEDED = 300; // ~5 seconds with 3 workers at 20 TPS (100 ticks / 20 = 5 sec)
        building.buildProgress = Math.min(1.0, building.constructionWorkTicks / TOTAL_WORKER_TICKS_NEEDED);
        
        // Update building visual state based on progress
        if (building.mesh) {
          // Scale building based on progress (starts small, grows to full size)
          const baseScale = building.scale || 1.0;
          const progressScale = 0.1 + (building.buildProgress * 0.9); // Scale from 10% to 100%
          building.mesh.scaling.x = baseScale * progressScale;
          building.mesh.scaling.y = baseScale * progressScale;
          building.mesh.scaling.z = baseScale * progressScale;
          
          // Update position based on progress (rise from half height to full height)
          const baseTerrainY = building.position.y || 0;
          const finalTerrainY = baseTerrainY;
          const halfHeight = baseTerrainY - 1; // Start at half height (visible above ground)
          building.mesh.position.y = halfHeight + (finalTerrainY - halfHeight) * building.buildProgress;
        }
        
        // When construction completes, send synchronized completion event
        // CRITICAL: Only process completion once, and synchronize across all peers
        if (building.buildProgress >= 1.0 && !building.completionProcessed && building.mesh) {
          building.buildProgress = 1.0; // Clamp to 1.0
          
          // Hide construction indicator when done
          if (building.constructionIndicator) {
            building.constructionIndicator.setEnabled(false);
            building.constructionIndicator.dispose();
            building.constructionIndicator = null;
          }
          
          // CRITICAL: Send building_complete command to synchronize completion across all peers
          // Schedule completion for the next sync checkpoint to ensure all clients process at the same tick
          if (window.isMultiplayer && window.currentMatch && !building.completionCommandSent) {
            const currentTick = window.currentMatch.tick;
            const syncInterval = window.currentMatch.syncInterval || 100;
            // Schedule for the next sync checkpoint (round up to next interval)
            // This ensures all clients process completion at the same predictable checkpoint
            const completionTick = Math.ceil((currentTick + 1) / syncInterval) * syncInterval;
            
            window.currentMatch.submitCommand({
              type: 'building_complete',
              playerId: building.owner,
              buildingId: building.id,
              tick: completionTick // Schedule for sync checkpoint
            });
            building.completionCommandSent = true;
            // Process immediately locally for visual feedback (command ensures sync on other clients)
            // The command will be a no-op on clients that already processed it due to completionProcessed flag
            processBuildingCompletion(building);
          } else {
            // Single-player: process immediately
            processBuildingCompletion(building);
          }
        }
      }
    } else if (building.buildProgress >= 1.0 && building.constructionIndicator) {
      // Building is complete - hide indicator
      building.constructionIndicator.setEnabled(false);
      building.constructionIndicator.dispose();
      building.constructionIndicator = null;
    }
    
    // Handle work assignment for buildings that need workers (both construction and production)
    // CRITICAL: Must be FULLY deterministic in P2P multiplayer!
    // Only check every N ticks to ensure both clients check at same time
    const currentTick = window.currentMatch?.tick || 0;
    const tickRate = 20; // Match net.TICK_RATE
    const shouldCheckThisTick = (currentTick % tickRate === 0); // Check every 20 ticks (1 second at 20Hz)
    
    // For construction buildings, check even if not complete; for production buildings, only when complete
    const shouldAssignWorkers = building.needsWorkers && (window.game || window.currentMatch) && shouldCheckThisTick && 
      ((building.workType === 'build' && building.buildProgress < 1.0) || 
       (building.workType !== 'build' && building.buildProgress >= 1.0));
    
    if (shouldAssignWorkers && (building.lastWorkerCheckTick ?? -1) !== currentTick) {
      building.lastWorkerCheckTick = currentTick;
      
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
        
        // SPECIAL: For camps, check if there are no available resources
        // If camp has no resources, release workers so they can be reassigned
        if (building.type === 'camp' && building.workType === 'gather') {
          const availableResources = building.availableResources || [];
          const hasAvailableResources = availableResources.some(r => 
            !r.depleted && r.remaining > 0 && r.depletionTick === undefined &&
            (!window.isResourceTileDepleted || !window.isResourceTileDepleted(r.gridX, r.gridZ))
          );
          
          if (!hasAvailableResources) {
            // Camp has no resources - release this worker
            worker.assignedBuilding = null;
            return false;
          }
        }
        
        return true; // Keep valid workers
      });
      
      // Try to assign more workers if needed
      if (building.assignedWorkers.length < building.maxWorkers) {
        const idleVillagers = findIdleVillagersNearBuilding(building);
        
        // Debug: Log when looking for workers
        if (building.workType === 'build' && building.buildProgress < 1.0 && currentTick % 100 === 0) {
          console.log(`👷 Looking for workers for ${building.type}: found ${idleVillagers.length} idle, assigned=${building.assignedWorkers.length}/${building.maxWorkers}`);
        }
        
        
        for (const villager of idleVillagers) {
          if (building.assignedWorkers.length >= building.maxWorkers) break;
          
          // Check if villager is assigned to a building that has no work
          if (villager.assignedBuilding) {
            const assignedBuilding = villager.assignedBuilding;
            // If assigned to a camp with no resources, clear the assignment
            if (assignedBuilding.type === 'camp' && assignedBuilding.workType === 'gather') {
              const availableResources = assignedBuilding.availableResources || [];
              const hasAvailableResources = availableResources.some(r => 
                !r.depleted && r.remaining > 0 && r.depletionTick === undefined &&
                (!window.isResourceTileDepleted || !window.isResourceTileDepleted(r.gridX, r.gridZ))
              );
              if (!hasAvailableResources) {
                // Clear assignment to empty camp
                villager.assignedBuilding = null;
                if (assignedBuilding.assignedWorkers) {
                  const idx = assignedBuilding.assignedWorkers.indexOf(villager);
                  if (idx > -1) assignedBuilding.assignedWorkers.splice(idx, 1);
                }
              } else {
                continue; // Still assigned to a camp with resources
              }
            } else {
              continue; // Already assigned elsewhere
            }
          }
          
          // DIAGNOSTIC: Verify ownership matches before assigning
          const normalizedUnitOwner = villager.owner?.length > 6 ? villager.owner.slice(-6) : villager.owner;
          const normalizedBuildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
          if (normalizedUnitOwner !== normalizedBuildingOwner) {
            console.warn(`⚠️ Ownership mismatch! Worker ${villager.id} (owner: ${normalizedUnitOwner}) cannot work on building ${building.id} (owner: ${normalizedBuildingOwner})`);
            continue;
          }
          
          assignVillagerToWork(villager, building);
        }
      }
    }
    
    // CRITICAL: Process work production every frame for production buildings
    // This must be separate from worker assignment to ensure deterministic timing
    // Worker assignment only happens every 60 ticks, but production should check every frame
    if (building.buildProgress >= 1.0 && building.needsWorkers && building.assignedWorkers.length > 0 && (window.game || window.currentMatch)) {
      processWorkProduction(building);
    }
    
    // Handle tower attacks
    if (building.type === 'tower' && building.buildProgress >= 1.0 && isGameActive) {
      updateTowerAttack(building, deltaTime);
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
      if (typeof this.previewMesh.setEnabled === 'function') {
        this.previewMesh.setEnabled(true);
      }
      
      // Mark as preview so it doesn't get culled by LOD system
      this.previewMesh.metadata = this.previewMesh.metadata || {};
      this.previewMesh.metadata.isPreview = true;
      
      // Enable all child meshes that are actual meshes (not transform nodes)
      this.previewMesh.getChildMeshes().forEach(child => {
        // Only enable if it has BOTH setEnabled AND isEnabled FUNCTION
        if (typeof child.setEnabled === 'function' && typeof child.isEnabled === 'function') {
          child.setEnabled(true);
        }
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
      previewMaterial.alpha = 1.0;
      
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
        // Get terrain height using bilinear interpolation
        const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(initialPosition.x, initialPosition.z) : 0;
        this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
      } else {
        // Try to get current mouse position
        const pickResult = window.gfx.scene.pick(
          window.gfx.scene.pointerX,
          window.gfx.scene.pointerY
        );
        
        if (pickResult.hit && pickResult.pickedPoint) {
          this.previewMesh.position = pickResult.pickedPoint.clone();
          // Get terrain height using bilinear interpolation
          const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(pickResult.pickedPoint.x, pickResult.pickedPoint.z) : 0;
          this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
        } else if (window.gfx.cameraTarget) {
          // Fallback to camera target
          this.previewMesh.position = window.gfx.cameraTarget.position.clone();
          // Get terrain height using bilinear interpolation
          const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(this.previewMesh.position.x, this.previewMesh.position.z) : 0;
          this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
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
    if (!buildingDef) return;
    
    // For camps, use productionWorkRadius (resource detection radius), not workRadius (construction worker search radius)
    const radius = (this.selectedBuildingType === 'camp' && buildingDef.productionWorkRadius)
      ? buildingDef.productionWorkRadius * TILE_SIZE
      : (buildingDef.workRadius ? buildingDef.workRadius * TILE_SIZE : 0);
    
    if (radius === 0) return;
    
    // Create a circle mesh to show the work radius (horizontal)
    const circle = BABYLON.MeshBuilder.CreateDisc("workRadius", {
      radius: radius,
      tessellation: 32 // Reduced from 64 for better performance
    }, window.gfx.scene);
    
    // Position the circle at the building location
    circle.position = centerPosition.clone();
    // Get terrain height at this position using bilinear interpolation
    const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(centerPosition.x, centerPosition.z) : 0;
    circle.position.y = terrainY + 0.05; // Very close to ground, following terrain
    
    // Rotate to be horizontal (disc is vertical by default)
    circle.rotation.x = Math.PI / 2; // 90 degrees to make it horizontal
    
    // Create material for the radius circle
    const radiusMaterial = new BABYLON.StandardMaterial("radiusMaterial", window.gfx.scene);
    radiusMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2); // Green
    radiusMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.1);
    radiusMaterial.alpha = 1.0; // Opaque
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
      // Get terrain height at this position using bilinear interpolation
      const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(newPosition.x, newPosition.z) : 0;
      this.radiusVisualization.position.y = terrainY + 0.05; // Very close to ground, following terrain
      
      // Update resource highlights
      const buildingDef = BuildingTypes[this.selectedBuildingType];
      if (buildingDef) {
        // For camps, use productionWorkRadius for resource visualization, not workRadius
        const radius = (this.selectedBuildingType === 'camp' && buildingDef.productionWorkRadius) 
          ? buildingDef.productionWorkRadius 
          : (buildingDef.workRadius || 2);
        this.highlightResourcesInRadius(newPosition, radius * TILE_SIZE);
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
          // CRITICAL: Ignore depletion for UI preview to show potential resources
          const resourceInfo = this.checkTileForResources(x, z, true);
          if (resourceInfo) {
            // Store resource data for saving later
            this.detectedResources.push({
              gridX: x,
              gridZ: z,
              worldX: worldX,
              worldZ: worldZ,
              type: resourceInfo.type,
              amount: resourceInfo.amount,
              remaining: resourceInfo.remaining // CRITICAL: Track remaining for depletion
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
      // No resources - red
      color = new BABYLON.Color3(0.8, 0.2, 0.2); // Red
      emissiveColor = new BABYLON.Color3(0.2, 0.05, 0.05);
    } else if (resourceCount < 4) {
      // Good resources - light green
      color = new BABYLON.Color3(0.2, 0.6, 0.2); // Light green
      emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.05);
    } else if (resourceCount < 7) {
      // Many resources - bright green
      color = new BABYLON.Color3(0.2, 0.6, 0.2); // Light green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
    } else if (resourceCount < 10) {
      // Many resources - bright green
      color = new BABYLON.Color3(0.1, 0.8, 0.1); // Bright green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
    } else {
      // Many resources - bright green
      color = new BABYLON.Color3(0.1, 0.8, 0.1); // Bright green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
    }
    alpha = 1.0; // Opaque for performance
    
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
  // CRITICAL: ignoreDepletion - when true, detects resources even if depleted (for new camp detection)
  // This ensures deterministic resource detection for new camps regardless of depletion state
  checkTileForResources: function(gridX, gridZ, ignoreDepletion = false) {
    if (!window.liveField) return null;
    
    // CRITICAL: Validate bounds first - resources can only exist on valid tiles
    // This prevents resources from being detected outside the map boundaries
    if (gridX < 0 || gridX >= window.liveField.width || 
        gridZ < 0 || gridZ >= window.liveField.height) {
      return null;
    }
    
    // CRITICAL: Also check chunk mask if available (for custom map shapes)
    if (window.liveField.chunkMask && window.liveField.chunkSize) {
      const chunkX = Math.floor(gridX / window.liveField.chunkSize);
      const chunkZ = Math.floor(gridZ / window.liveField.chunkSize);
      if (window.liveField.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
        return null; // Tile is in a disabled chunk (off the table)
      }
    }
    
    const fieldSeed = window.liveField.seed;
    const terrainIndex = gridZ * window.liveField.width + gridX;
    const terrainType = window.liveField.terrainTypes[terrainIndex];
    
    if (!terrainType && terrainType !== 0) return null;
    
    // Skip spawn zones (same as gfx.js)
    if (window.liveField.isInSpawnZone && window.liveField.isInSpawnZone(gridX, gridZ)) {
      return null;
    }
    
    // CRITICAL: Only skip depleted resources if ignoreDepletion is false
    // When detecting resources for a NEW camp, ignore depletion state to ensure deterministic detection
    // Depletion state can differ between clients due to timing differences in worker gathering
    if (!ignoreDepletion) {
      const tileKey = `${gridX},${gridZ}`;
      if (window.isResourceTileDepleted && window.isResourceTileDepleted(gridX, gridZ)) {
        return null; // Don't detect depleted resources (for existing camps)
      }
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
            remaining: 12, // ~12 trips
            gridX: gridX,
            gridZ: gridZ
          };
        } else if (sizeRoll < 0.7) {
          // Medium rocks (40%) → stone
          return {
            type: 'stone',
            amount: 4,
            remaining: 56, // ~14 trips (4 stone × 14 = 56)
            gridX: gridX,
            gridZ: gridZ
          };
        } else {
          // Large rocks (30%) → more stone
          return {
            type: 'stone',
            amount: 6,
            remaining: 84, // ~14 trips (6 stone × 14 = 84)
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
          amount: 7,
          remaining: 28, // ~4 trips (7 wood × 4 = 28)
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
          
          // Only update if grid position changed (avoids redundant calculations)
          if (this.previewMesh.position.x !== gridX || this.previewMesh.position.z !== gridZ) {
            // Get terrain height at this position using bilinear interpolation
            const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(gridX, gridZ) : 0;
            
            // Update preview position
            this.previewMesh.position.x = gridX;
            this.previewMesh.position.z = gridZ;
            this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
          }
          
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
        // Use productionWorkRadius (7) for resource detection, not workRadius (15) which is for construction
        const productionWorkRadius = (window.BuildingTypes && window.BuildingTypes.camp && window.BuildingTypes.camp.productionWorkRadius) || 7;
        const radiusInTiles = productionWorkRadius * TILE_SIZE;
        
        const detectedResources = [];
        const gridRadius = Math.ceil(radiusInTiles / TILE_SIZE);
        
        // Get field boundaries for validation
        const field = window.liveField;
        const fieldWidth = field?.width || 0;
        const fieldHeight = field?.height || 0;
        
        for (let x = gridX - gridRadius; x <= gridX + gridRadius; x++) {
          for (let z = gridZ - gridRadius; z <= gridZ + gridRadius; z++) {
            // CRITICAL: Skip coordinates outside map boundaries - resources can only exist on valid tiles
            if (x < 0 || x >= fieldWidth || z < 0 || z >= fieldHeight) {
              continue;
            }
            
            // CRITICAL: Also check chunk mask if available (for custom map shapes)
            if (field && field.chunkMask && field.chunkSize) {
              const chunkX = Math.floor(x / field.chunkSize);
              const chunkZ = Math.floor(z / field.chunkSize);
              if (field.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
                continue; // Skip tiles in disabled chunks (off the table)
              }
            }
            
            const worldX = x * TILE_SIZE;
            const worldZ = z * TILE_SIZE;
            const campWorldX = gridX * TILE_SIZE;
            const campWorldZ = gridZ * TILE_SIZE;
            const distance = Math.sqrt(
              Math.pow(worldX - campWorldX, 2) + 
              Math.pow(worldZ - campWorldZ, 2)
            );
            
            if (distance <= radiusInTiles) {
              // CRITICAL: In multiplayer, ignore depletion state when detecting resources for new camps
              // Depletion timing can differ between clients due to position drift, but terrain/seed is deterministic
              // This ensures both clients detect the exact same resources for the same camp location
              const ignoreDepletion = window.isMultiplayer || false;
              const resourceInfo = this.checkTileForResources(x, z, ignoreDepletion);
              if (resourceInfo) {
                detectedResources.push({
                  gridX: x,
                  gridZ: z,
                  worldX: worldX,
                  worldZ: worldZ,
                  type: resourceInfo.type,
                  amount: resourceInfo.amount,
                  remaining: resourceInfo.remaining // CRITICAL: Include remaining for depletion tracking
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
      // Hide the mesh (only if setEnabled method exists)
      if (typeof building.mesh.setEnabled === 'function') {
        building.mesh.setEnabled(false);
      }
      
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
  window.processBuildingCompletion = processBuildingCompletion;
  
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
