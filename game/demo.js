// Demo Mode - Interactive AI Fishbowl for Menu Scene
// 
// Creates a living demo where an AI-controlled player builds an economy
// while the user can intervene at any time. Everything is deterministic
// for future multiplayer compatibility.

(function(demo) {
  
  // Demo state
  let demoActive = false;
  let demoTick = 0;
  let demoTickAccumulator = 0;
  let demoPlayer = null;
  let lastDemoUpdateTime = 0;
  
  // Constants
  const DEMO_TICK_RATE = 20; // 20 ticks per second (matches multiplayer)
  const DEMO_TICK_MS = 1000 / DEMO_TICK_RATE; // 50ms per tick
  const DEMO_SEED = 42; // Fixed seed for deterministic demo
  
  // Deterministic RNG for demo mode (same pattern as ai.js)
  function createDemoRNG(seed) {
    let state = seed;
    return function() {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }
  
  // Get deterministic random for demo based on tick and context
  function getDemoRandom(context = '') {
    const contextHash = context.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const seed = DEMO_SEED + demoTick + contextHash;
    const rng = createDemoRNG(seed);
    return rng();
  }
  
  // Initialize demo mode
  demo.init = function() {
    if (demoActive) {
      console.log('⚠️ Demo already active');
      return;
    }
    
    // Don't start demo if a real match is active
    if (window.currentMatch || window.isMultiplayer || window.game) {
      console.log('🚫 Skipping demo - match is active');
      return;
    }
    
    
    // Wait for required systems
    if (!window.gfx || !window.gfx.scene || !window.liveField || !window.Unit) {
      console.log('⏳ Demo waiting for systems...');
      setTimeout(() => demo.init(), 500);
      return;
    }
    
    // Create demo player
    demoPlayer = createDemoPlayer();
    
    // Spawn initial villagers in center
    spawnDemoVillagers(demoPlayer);
    
    // Spawn villager meshes
    if (window.spawnUnitModels) {
      window.spawnUnitModels(window.gfx.scene);
    }
    
    // Start demo tick loop
    demoActive = true;
    demoTick = 0;
    lastDemoUpdateTime = performance.now();
    
    // Create minimal currentMatch stub so game systems work without conditionals
    // This provides the tick counter that behaviors, buildings, etc. expect
    window.currentMatch = {
      get tick() { return demoTick; },
      state: 'playing',
      isDemo: true,
      
      // Handle commands directly in demo mode (no network sync needed)
      submitCommand: function(command) {
        applyDemoCommand(command);
      }
    };
    
    // Hook into render loop for demo updates
    startDemoLoop();
    
    // Show the resource stats display
    const statW = document.getElementById('stat_w');
    if (statW) {
      statW.style.display = 'flex';
      statW.style.flexDirection = 'column';
      statW.style.gap = '4px';
      statW.style.padding = '8px 12px';
      statW.style.borderRadius = '6px';
      statW.style.fontFamily = 'monospace';
      statW.style.fontSize = '14px';
      statW.style.fontWeight = 'bold';
      statW.style.textShadow = '1px 1px 2px black';
    }
    
  };
  
  // Stop demo mode (called when match starts)
  demo.stop = function() {
    if (!demoActive) return;
    
    
    demoActive = false;
    
    // Unregister from render loop first
    if (window.gfx && window.gfx.scene) {
      window.gfx.scene.unregisterBeforeRender(demoUpdate);
    }
    
    // Clean up demo units - dispose meshes directly
    if (demoPlayer && demoPlayer.units) {
      demoPlayer.units.forEach(unit => {
        // Dispose mesh directly
        if (unit.mesh) {
          unit.mesh.dispose();
          unit.mesh = null;
        }
        // Also try destroyUnit for full cleanup
        if (window.destroyUnit) {
          window.destroyUnit(unit);
        }
      });
      demoPlayer.units = [];
    }
    
    // Clean up ALL demo units from gameUnits (in case any weren't in demoPlayer.units)
    if (window.gameUnits) {
      const demoUnits = window.gameUnits.filter(u => u.owner === 'demo');
      demoUnits.forEach(unit => {
        if (unit.mesh) {
          unit.mesh.dispose();
          unit.mesh = null;
        }
      });
      window.gameUnits = window.gameUnits.filter(u => u.owner !== 'demo');
    }
    
    // Helper to fully dispose a building
    function disposeBuilding(building) {
      if (!building) return;
      
      // Dispose construction indicator
      if (building.constructionIndicator) {
        building.constructionIndicator.dispose();
      }
      
      // Dispose particle effects
      if (building.particleSystem) {
        building.particleSystem.dispose();
      }
      if (building.smokeSystem) {
        building.smokeSystem.dispose();
      }
      
      // Dispose mesh and all children
      if (building.mesh) {
        // Dispose child meshes first
        if (building.mesh.getChildMeshes) {
          building.mesh.getChildMeshes().forEach(child => {
            if (child.dispose) child.dispose();
          });
        }
        building.mesh.dispose();
        building.mesh = null;
      }
    }
    
    // Clean up demo buildings
    if (demoPlayer && demoPlayer.buildings) {
      demoPlayer.buildings.forEach(disposeBuilding);
      demoPlayer.buildings = [];
    }
    
    // Clean up ALL demo buildings from gameBuildings
    if (window.gameBuildings) {
      const demoBuildings = window.gameBuildings.filter(b => b.owner === 'demo');
      demoBuildings.forEach(disposeBuilding);
      window.gameBuildings = window.gameBuildings.filter(b => b.owner !== 'demo');
    }
    
    // Clear demo player reference
    demoPlayer = null;
    demoTick = 0;
    
    // Clear window.player so real match can create fresh one
    if (window.player && window.player.id === 'demo') {
      window.player = null;
    }
    
    // Clean up the currentMatch stub (real match will create its own)
    if (window.currentMatch && window.currentMatch.isDemo) {
      window.currentMatch = null;
    }
    
  };
  
  // Check if demo is active
  demo.isActive = function() {
    return demoActive;
  };
  
  // Get current demo tick (for determinism)
  demo.getTick = function() {
    return demoTick;
  };
  
  // Get demo player (for UI integration)
  demo.getPlayer = function() {
    return demoPlayer;
  };
  
  // Create the demo player object
  function createDemoPlayer() {
    const TILE_SIZE = window.TILE_SIZE || 4;
    const field = window.liveField;
    
    // Center of map
    const centerX = field ? Math.floor(field.width / 2) : 33;
    const centerZ = field ? Math.floor(field.height / 2) : 33;
    
    // Create player with demo ID
    const player = new Player({
      id: 'demo',
      name: 'Demo Player',
      color: '#4A90E2',
      // No agora - demo starts without base building
      agora: { x: centerX, y: centerZ },
      resources: { ...STARTING_RESOURCES }
    });
    
    // Override window.player so UI controls work
    window.player = player;
    
    // Initialize buildings array
    player.buildings = [];
    
    return player;
  }
  
  // Spawn demo villagers in the center of the map (on clear terrain)
  function spawnDemoVillagers(player) {
    const TILE_SIZE = window.TILE_SIZE || 4;
    const field = window.liveField;
    
    // Center of map in tile coordinates
    const centerTileX = field ? Math.floor(field.width / 2) : 33;
    const centerTileZ = field ? Math.floor(field.height / 2) : 33;
    
    // Clear the center area first (make it passable grass)
    if (field) {
      clearDemoSpawnArea(field, centerTileX, centerTileZ, 5);
    }
    
    // Center in world coordinates
    const centerX = centerTileX * TILE_SIZE;
    const centerZ = centerTileZ * TILE_SIZE;
    
    // Spawn 6 villagers in a circle around center
    const villagerCount = 6;
    const spawnRadius = 3 * TILE_SIZE; // 3 tiles from center
    
    // Use deterministic RNG for positions
    const rng = createDemoRNG(DEMO_SEED);
    
    for (let i = 0; i < villagerCount; i++) {
      // Find a valid spawn position (passable terrain)
      let x, z;
      let attempts = 0;
      const maxAttempts = 10;
      
      do {
        // Evenly spaced around circle with slight random offset
        const baseAngle = (i / villagerCount) * Math.PI * 2;
        const angleOffset = (rng() - 0.5) * 0.3 + (attempts * 0.2); // Vary with attempts
        const angle = baseAngle + angleOffset;
        
        const distance = spawnRadius * (0.8 + rng() * 0.4 + attempts * 0.1); // Expand with attempts
        
        x = centerX + Math.cos(angle) * distance;
        z = centerZ + Math.sin(angle) * distance;
        
        attempts++;
      } while (field && !isPositionPassable(field, x, z, TILE_SIZE) && attempts < maxAttempts);
      
      // Create unit with demo ID prefix
      const unitId = `demo-unit-${i}`;
      const villager = new window.Unit('villager', { x, y: 0, z }, { id: unitId });
      villager.owner = 'demo';
      
      // Deterministic rotation
      const rotation = rng() * Math.PI * 2;
      villager.rotation = rotation;
      if (villager.pb && villager.pb.state && villager.pb.state.rot) {
        villager.pb.state.rot.y = rotation;
      }
      
      // Add to player's units
      player.units.push(villager);
      
      // Add to global units array
      if (!window.gameUnits) window.gameUnits = [];
      window.gameUnits.push(villager);
      
      // Give linger behavior (idle wandering)
      if (window.behaviorManager) {
        window.behaviorManager.setBehavior(villager, 'linger', {
          center: { x, z },
          radius: 30,
          wanderDistance: 2.0,
          wanderInterval: 5000 // Wander every 5 seconds
        });
      }
    }
    
  }
  
  // Clear the spawn area of rocks and make it passable grass
  function clearDemoSpawnArea(field, centerX, centerZ, radius) {
    const TILE_SIZE = window.TILE_SIZE || 4;
    
    // Step 1: Clear logical terrain data (makes tiles passable)
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > radius) continue;
        
        const tileX = centerX + dx;
        const tileZ = centerZ + dz;
        
        // Check bounds
        if (tileX < 0 || tileX >= field.width || tileZ < 0 || tileZ >= field.height) {
          continue;
        }
        
        const index = tileZ * field.width + tileX;
        
        // Make it grass terrain (type 3)
        if (field.terrainTypes && field.terrainTypes[index] !== undefined) {
          // Only change if it's currently water (1) or dirt with rocks
          const currentTerrain = field.terrainTypes[index];
          if (currentTerrain === 1 || currentTerrain === 2) {
            field.terrainTypes[index] = 3; // Grass
          }
        }
        
        // Remove from blocked tiles
        const key = `${tileX},${tileZ}`;
        if (field.blockedTiles) {
          field.blockedTiles.delete(key);
        }
        
        // Remove from slow tiles (trees)
        if (field.slowTiles) {
          field.slowTiles.delete(key);
        }
      }
    }
    
    // Step 2: Clear visual models (rocks, trees) from the area
    if (window.gfx && window.gfx.clearModelsInArea) {
      window.gfx.clearModelsInArea(centerX, centerZ, radius);
    }
    
    // Step 3: Rebuild height grid if available (for proper terrain height)
    if (field._buildHeightGrid) {
      field._buildHeightGrid();
    }
    
    // NOTE: We intentionally do NOT dispose/rebuild chunk meshes here.
    // The spawn area is small (5 tiles) and the terrain height change is imperceptible.
    // Disposing chunk meshes would break models parented to those meshes (entire chunks, not just spawn area).
    // The model clearing (Step 2) handles the visual change.
    
  }
  
  // Check if a world position is passable
  function isPositionPassable(field, worldX, worldZ, tileSize) {
    const tileX = Math.floor(worldX / tileSize);
    const tileZ = Math.floor(worldZ / tileSize);
    
    // Check bounds
    if (tileX < 0 || tileX >= field.width || tileZ < 0 || tileZ >= field.height) {
      return false;
    }
    
    // Use field's passability check if available
    if (field.isPassable) {
      return field.isPassable(tileX, tileZ);
    }
    
    // Fallback: check blocked tiles set
    const key = `${tileX},${tileZ}`;
    if (field.blockedTiles && field.blockedTiles.has(key)) {
      return false;
    }
    
    return true;
  }
  
  // Apply a command directly in demo mode (no network sync)
  function applyDemoCommand(command) {
    if (!command) return;
    
    const TILE_SIZE = window.TILE_SIZE || 4;
    
    switch (command.type) {
      case 'move':
        // Move selected units to target
        if (command.unitIds && command.target && window.behaviorManager) {
          command.unitIds.forEach((unitId, index) => {
            const unit = window.gameUnits?.find(u => u.id === unitId);
            if (unit) {
              // Slight spread for multiple units
              const spread = command.unitIds.length > 1 ? 2 : 0;
              const offsetX = command.target.x + (index % 3 - 1) * spread;
              const offsetZ = command.target.z + (Math.floor(index / 3) - 1) * spread;
              
              // Mark as player-commanded (prevents AI reassignment)
              unit.lastPlayerMoveTick = demoTick;
              
              window.behaviorManager.setBehavior(unit, 'walk', {
                targetPoint: { x: offsetX, z: offsetZ }
              });
            }
          });
        }
        break;
        
      case 'build':
        // Building placement handled separately through placeBuilding
        break;
        
      default:
        console.log(`⚠️ Demo: Unhandled command type: ${command.type}`);
    }
  }
  
  // Start the demo update loop
  function startDemoLoop() {
    // Hook into the before-render for demo updates
    if (window.gfx && window.gfx.scene) {
      window.gfx.scene.registerBeforeRender(demoUpdate);
    }
  }
  
  // Demo update function (called every frame)
  function demoUpdate() {
    if (!demoActive || !demoPlayer) return;
    
    // Don't run demo if a real match started (but ignore our own demo stub)
    if ((window.currentMatch && !window.currentMatch.isDemo) || window.isMultiplayer) {
      demo.stop();
      return;
    }
    
    const now = performance.now();
    const elapsed = now - lastDemoUpdateTime;
    lastDemoUpdateTime = now;
    
    // Accumulate time for tick
    demoTickAccumulator += elapsed;
    
    // Process demo ticks at fixed rate
    while (demoTickAccumulator >= DEMO_TICK_MS) {
      demoTickAccumulator -= DEMO_TICK_MS;
      demoTick++;
      
      // Run demo AI decision making (function handles its own timing)
      makeDemoAIDecision();
      
      // Update demo physics (behaviors are stepped by gameLoop if running,
      // otherwise we step them here)
      if (!window.gameLoop || !window.gameLoop.running) {
        stepDemoPhysics();
      }
    }
  }
  
  // Step physics for demo mode when game loop isn't running
  function stepDemoPhysics() {
    const dt = 1 / 60; // Fixed 60Hz timestep
    
    // Step behaviors
    if (window.behaviorManager) {
      window.behaviorManager.stepBehaviors();
    }
    
    // Update units
    if (window.updateUnits) {
      window.updateUnits(dt);
    }
    
    // Update buildings
    if (window.updateBuildings) {
      window.updateBuildings(dt);
    }
    
    // Update unit meshes
    if (window.updateUnitMeshes) {
      window.updateUnitMeshes();
    }
  }
  
  // Demo AI timing constants (in ticks, 20 ticks = 1 second)
  const AI_WARMUP_TICKS = 100;        // 5 seconds before AI starts thinking
  const AI_DECISION_INTERVAL = 60;    // 3 seconds between decisions
  const AI_BUILD_COOLDOWN = 200;      // 10 seconds minimum between builds
  
  let lastBuildTick = -AI_BUILD_COOLDOWN; // Allow first build after warmup
  
  // Demo AI decision making
  function makeDemoAIDecision() {
    if (!demoPlayer) return;
    
    // Warmup period - just let villagers wander and explore
    if (demoTick < AI_WARMUP_TICKS) {
      return;
    }
    
    // Only make decisions at the proper interval (every 3 seconds after warmup)
    if ((demoTick - AI_WARMUP_TICKS) % AI_DECISION_INTERVAL !== 0) {
      return;
    }
    
    const resources = demoPlayer.resources;
    const buildingCount = demoPlayer.buildings ? demoPlayer.buildings.length : 0;
    
    // Count building types
    const campCount = demoPlayer.buildings?.filter(b => b && b.type === 'camp').length || 0;
    const villageCount = demoPlayer.buildings?.filter(b => b && b.type === 'village').length || 0;
    const farmCount = demoPlayer.buildings?.filter(b => b && b.type === 'farm').length || 0;
    
    // Get costs
    const campCost = window.BuildingTypes?.camp?.cost || { wood: 5 };
    const villageCost = window.BuildingTypes?.village?.cost || { wood: 25 };
    const farmCost = window.BuildingTypes?.farm?.cost || { wood: 20 };
    
    // Check if we can build (cooldown passed)
    const canBuild = (demoTick - lastBuildTick) >= AI_BUILD_COOLDOWN;
    
    // Demo AI Strategy: Build economy buildings in whatever order we can afford
    // No fixed priority - more organic, like a player figuring things out
    
    if (canBuild && buildingCount < 3) {
      // Deterministic "random" choice of what to build
      const buildRoll = getDemoRandom('build_choice');
      
      // Build one of each first, but in varying order based on roll
      const needsCamp = campCount === 0;
      const needsVillage = villageCount === 0;
      const needsFarm = farmCount === 0;
      
      // Collect what we can afford
      const options = [];
      if (needsCamp && resources.wood >= campCost.wood) options.push('camp');
      if (needsVillage && resources.wood >= villageCost.wood) options.push('village');
      if (needsFarm && resources.wood >= farmCost.wood) options.push('farm');
      
      if (options.length > 0) {
        // Pick deterministically based on roll
        const choice = options[Math.floor(buildRoll * options.length)];
        queueDemoBuild(choice);
        lastBuildTick = demoTick;
        return;
      }
    }
    
    // Later expansion (after initial 3 buildings)
    if (canBuild && buildingCount >= 3) {
      const expandRoll = getDemoRandom('expand_choice');
      
      // Occasionally expand
      if (expandRoll < 0.3) { // 30% chance when decision fires
        const options = [];
        if (campCount < 2 && resources.wood >= campCost.wood) options.push('camp');
        if (villageCount < 2 && resources.wood >= villageCost.wood) options.push('village');
        if (farmCount < 2 && resources.wood >= farmCost.wood) options.push('farm');
        
        if (options.length > 0) {
          const choice = options[Math.floor(expandRoll * 3.33 * options.length) % options.length];
          queueDemoBuild(choice);
          lastBuildTick = demoTick;
          return;
        }
      }
    }
    
    // Assign idle villagers to work (happens each decision cycle)
    assignIdleVillagersToWork();
  }
  
  // Queue a building for demo AI to construct
  function queueDemoBuild(buildingType) {
    if (!demoPlayer || !window.buildingSystem) return;
    
    // Find a build location near center
    const buildPos = findDemoBuildLocation(buildingType);
    if (!buildPos) {
      console.log(`❌ Demo: No valid location for ${buildingType}`);
      return;
    }
    
    
    // Use building system to place (same as player would)
    if (window.placeBuilding && window.gfx && window.gfx.scene) {
      const building = window.placeBuilding(buildingType, buildPos.x, buildPos.z, window.gfx.scene, {
        buildProgress: 0, // Start at 0, needs to be built
        owner: 'demo'
      });
      
      if (building) {
        building.owner = 'demo';
        demoPlayer.buildings.push(building);
        
        if (!window.gameBuildings) window.gameBuildings = [];
        window.gameBuildings.push(building);
        
        // Deduct resources
        const cost = window.BuildingTypes?.[buildingType]?.cost || {};
        Object.keys(cost).forEach(resource => {
          if (demoPlayer.resources[resource] !== undefined) {
            demoPlayer.resources[resource] -= cost[resource];
          }
        });
        
      }
    }
  }
  
  // Find a valid build location for demo AI
  function findDemoBuildLocation(buildingType) {
    const TILE_SIZE = window.TILE_SIZE || 4;
    const field = window.liveField;
    if (!field) return null;
    
    // Center of map
    const centerX = Math.floor(field.width / 2);
    const centerZ = Math.floor(field.height / 2);
    
    // Try positions in expanding rings around center
    const existingBuildings = demoPlayer.buildings || [];
    const MIN_SPACING = 4; // Minimum tiles between buildings
    
    // Use deterministic offset based on building count
    const buildingCount = existingBuildings.length;
    const angleOffset = (buildingCount * 0.618) % (Math.PI * 2); // Golden ratio
    
    for (let ring = 2; ring < 15; ring++) {
      for (let angleStep = 0; angleStep < 8; angleStep++) {
        const angle = (angleStep / 8) * Math.PI * 2 + angleOffset;
        const gridX = Math.floor(centerX + Math.cos(angle) * ring);
        const gridZ = Math.floor(centerZ + Math.sin(angle) * ring);
        
        // Check bounds
        if (gridX < 2 || gridX >= field.width - 2 || gridZ < 2 || gridZ >= field.height - 2) {
          continue;
        }
        
        // Check if passable
        if (field.isPassable && !field.isPassable(gridX, gridZ)) {
          continue;
        }
        
        // Check spacing from existing buildings
        let tooClose = false;
        const worldX = gridX * TILE_SIZE;
        const worldZ = gridZ * TILE_SIZE;
        
        for (const building of existingBuildings) {
          if (!building.position) continue;
          const dx = building.position.x - worldX;
          const dz = building.position.z - worldZ;
          const dist = Math.sqrt(dx * dx + dz * dz) / TILE_SIZE;
          if (dist < MIN_SPACING) {
            tooClose = true;
            break;
          }
        }
        
        if (!tooClose) {
          return { x: gridX, z: gridZ };
        }
      }
    }
    
    return null;
  }
  
  // Assign idle demo villagers to work at buildings
  function assignIdleVillagersToWork() {
    if (!demoPlayer || !demoPlayer.units || !demoPlayer.buildings) return;
    
    // Find idle villagers (not assigned to any building)
    const idleVillagers = demoPlayer.units.filter(unit => {
      if (!unit || unit.type !== 'villager') return false;
      if (unit.assignedBuilding) return false;
      
      // Check if has a work behavior already
      const behavior = window.behaviorManager?.getBehavior(unit);
      const behaviorName = behavior?.constructor?.name;
      if (behaviorName && behaviorName.includes('Work')) return false;
      
      return true;
    });
    
    if (idleVillagers.length === 0) return;
    
    // Find buildings that need workers
    for (const villager of idleVillagers) {
      // Find nearest building that needs workers
      let bestBuilding = null;
      let bestDistance = Infinity;
      
      for (const building of demoPlayer.buildings) {
        if (!building || !building.position) continue;
        
        // Skip buildings at full capacity
        const maxWorkers = building.maxWorkers || 3;
        const currentWorkers = building.assignedWorkers?.length || 0;
        if (currentWorkers >= maxWorkers) continue;
        
        // Calculate distance
        if (!villager.pb || !villager.pb.state || !villager.pb.state.loc) continue;
        const dx = building.position.x - villager.pb.state.loc.x;
        const dz = building.position.z - villager.pb.state.loc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist < bestDistance) {
          bestDistance = dist;
          bestBuilding = building;
        }
      }
      
      // Assign villager to building
      if (bestBuilding && window.behaviorManager) {
        // Track assignment
        if (!bestBuilding.assignedWorkers) bestBuilding.assignedWorkers = [];
        bestBuilding.assignedWorkers.push(villager);
        villager.assignedBuilding = bestBuilding;
        
        // Determine work behavior based on building type
        let behaviorType = 'work';
        if (bestBuilding.type === 'camp') behaviorType = 'gather_work';
        else if (bestBuilding.type === 'farm') behaviorType = 'farm_work';
        else if (bestBuilding.buildProgress !== undefined && bestBuilding.buildProgress < 1) {
          behaviorType = 'build_work';
        }
        
        window.behaviorManager.setBehavior(villager, behaviorType, {
          building: bestBuilding
        });
        
        // Log only occasionally to avoid spam
        if (getDemoRandom('log_assign') < 0.3) {
          console.log(`👷 Demo: Assigned villager to ${bestBuilding.type}`);
        }
      }
    }
  }
  
  // Expose demo module
  window.demo = demo;
  
  // Auto-start demo when scene is ready (with delay to let other systems init)
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      // Wait for scene and field to be ready
      setTimeout(function() {
        // Only start if no match is active
        if (!window.currentMatch && !window.isMultiplayer && !window.game) {
          demo.init();
        }
      }, 3000); // 3 second delay to let scene load
    });
  }
  
})(window.demo = window.demo || {});

