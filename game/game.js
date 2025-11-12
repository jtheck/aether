






function Game(ops) {
  this.type = ops.type || 'default';
  this.map = ops.map || 'default';
  this.players = ops.players || [];
  this.startTime = Date.now();
  this.gameState = 'initializing'; // initializing, running, paused, ended
  this._initialized = false; // prevent double-initialization in flows that call init() explicitly
  
  // Initialize the game
  this.init();
}

Game.prototype.init = function() {
  if (this._initialized) {
    // console.warn('⚠️ Game.init() called more than once - skipping duplicate initialization');
    return;
  }
  this._initialized = true;
  // console.log('🎮 Game initializing...', {
  //   type: this.type,
  //   map: this.map,
  //   startTime: new Date(this.startTime).toLocaleTimeString()
  // });
  
  // Set game state to running
  this.gameState = 'running';
  
  // Spawn initial game elements
  this.spawnInitialUnits();
  
  // console.log('🎮 Game initialized and running!');
};

Game.prototype.spawnInitialUnits = function() {
  console.log('🏘️ Spawning initial game units for all players...');
  
  // Spawn villagers and buildings for ALL players (local + opponents)
  if (this.players && this.players.length > 0) {
    this.players.forEach((player, index) => {
      if (!player || !player.agora) {
        console.warn(`❌ Player ${index} has no agora!`);
        return;
      }
      
      const isLocalPlayer = player === window.player;
      console.log(`👤 Spawning for ${isLocalPlayer ? 'LOCAL' : 'OPPONENT'} player at (${player.agora.x}, ${player.agora.y})`);
      
      // Spawn agora building for this player
      if (window.playerBuildings) {
        // Prefer visual placement path so meshes are created for ALL players (not just local)
        const placeFn = (window.placeBuilding || (typeof placeBuilding === 'function' ? placeBuilding : null));
        if (placeFn && window.gfx && window.gfx.scene) {
          const placed = placeFn('agora', player.agora.x, player.agora.y, window.gfx.scene);
          if (placed) {
            placed.owner = player.id || 'player';
            player.buildings.push(placed);
            window.playerBuildings.push(placed);
            console.log(`🏛️ Spawned agora for ${player.name || player.id}`);
          }
        } else if (window.Building) {
          // Fallback: create logical building if visual system not available yet
          const agoraBuilding = new window.Building('agora', {
            x: player.agora.x,
            y: player.agora.y
          }, { owner: player.id || 'player' });
          
          player.buildings.push(agoraBuilding);
          window.playerBuildings.push(agoraBuilding);
          console.log(`🏛️ Spawned agora (logic only) for ${player.name || player.id}`);
        }
      }
      
      // Spawn villagers around this player's agora
      this.spawnVillagersForPlayer(player);
    });
  } else {
    console.warn('❌ No players found in game.players!');
  }
  
  console.log('✅ All player units and buildings spawned');
};

Game.prototype.spawnVillagersForPlayer = function(player) {
  if (!player || !player.agora) {
    console.warn('❌ Player or agora not found for villager spawning');
    return;
  }
  
  if (!TILE_SIZE) {
    console.warn('❌ TILE_SIZE not defined');
    return;
  }
  
  // CRITICAL: Use deterministic random based on map seed and player ID for multiplayer
  // This ensures all clients spawn units at the same positions
  let seed = 12345; // Default seed for single player
  if (window.currentMatch && window.currentMatch.mapSeed) {
    // Combine map seed with player ID for unique but deterministic spawns per player
    const playerIdHash = (player.id || 'player').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    seed = window.currentMatch.mapSeed + playerIdHash;
  }
  
  // Seeded random number generator (deterministic)
  const seededRandom = (function() {
    let s = seed;
    return function() {
      s = Math.sin(s) * 10000;
      return s - Math.floor(s);
    };
  })();
  
  const agoraX = player.agora.x * TILE_SIZE;
  const agoraZ = player.agora.y * TILE_SIZE;
  const villagerCount = 8 + Math.floor(seededRandom() * 5);
  
  console.log(`👥 Spawning ${villagerCount} villagers for ${player.name || player.id} at (${agoraX}, ${agoraZ}) [seed: ${seed}]`);
  
  for (let i = 0; i < villagerCount; i++) {
    // Deterministic position around agora (within 3-6 tiles)
    const angle = (i / villagerCount) * Math.PI * 2 + (seededRandom() - 0.5) * 0.5;
    const distance = 3 + seededRandom() * 3;
    
    const x = agoraX + Math.cos(angle) * distance * TILE_SIZE;
    const z = agoraZ + Math.sin(angle) * distance * TILE_SIZE;
    
    const villager = new window.Unit('villager', { x, y: 0, z });
    villager.owner = player.id || 'player';
    
    // Deterministic rotation
    const randomRotation = seededRandom() * Math.PI * 2;
    villager.rotation = randomRotation;
    if (villager.pb && villager.pb.state && villager.pb.state.rot) {
      villager.pb.state.rot.y = randomRotation;
    }
    
    // Add to player's units
    player.units.push(villager);
    window.gameUnits.push(villager); // Add to global array for rendering
  }
  
  console.log(`✅ Spawned ${villagerCount} villagers for ${player.name || player.id}`);
  console.log(`   Player ID: ${player.id}`);
  console.log(`   First villager owner: ${player.units[0]?.owner}`);
  console.log(`   Owner matches player ID: ${player.units[0]?.owner === player.id}`);
};

Game.prototype.getGameTime = function() {
  return Date.now() - this.startTime;
};

Game.prototype.getGameTimeFormatted = function() {
  const gameTime = this.getGameTime();
  const minutes = Math.floor(gameTime / 60000);
  const seconds = Math.floor((gameTime % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Game loop with proper delta time tracking and fixed physics timestep
window.gameLoop = {
  lastTime: 0,
  deltaTime: 0,
  frameCounter: 0,
  physicsTime: 0, // Accumulated time for physics
  physicsTimestep: 1/60, // Fixed 60Hz physics (16.67ms)
  running: false, // Track if loop is running
  animationFrameId: null, // Store requestAnimationFrame ID for cancellation
  
  start: function() {
    if (this.running) {
      console.log('⚠️ Game loop already running');
      return;
    }
    this.running = true;
    this.lastTime = performance.now();
    this.frameCounter = 0;
    this.physicsTime = 0;
    console.log('▶️ Game loop started');
    this.update();
  },
  
  stop: function() {
    if (!this.running) {
      console.log('⚠️ Game loop already stopped');
      return;
    }
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    console.log('⏸️ Game loop stopped');
  },
  
  update: function() {
    // Check if loop should continue
    if (!this.running) {
      return;
    }
    const currentTime = performance.now();
    this.deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;
    this.frameCounter++;
    
    // Make frame counter globally available
    window.frameCounter = this.frameCounter;
    
    // Cap delta time to prevent huge jumps (e.g., when tab is inactive)
    if (this.deltaTime > 0.1) {
      this.deltaTime = 0.1; // Cap at 100ms
    }
    
    // Accumulate time for physics
    this.physicsTime += this.deltaTime;
    
    // Only run physics if match is in PLAYING state (or no match exists for single player)
    const canRunPhysics = !window.currentMatch || 
                          window.currentMatch.state === 'playing' ||
                          !window.isMultiplayer;
    
    // Run physics at fixed timestep (60Hz)
    let physicsSteps = 0;
    while (this.physicsTime >= this.physicsTimestep && canRunPhysics) {
      // Update units and their behaviors (this applies impulses)
      if (window.units && window.units.update) {
        window.units.update(this.physicsTimestep);
      }
      
  // THIS LINE IS CRITICAL - Step all unit behaviors!
  if (window.behaviorManager) {
    window.behaviorManager.stepBehaviors();
  }
  // Update idle units (give them wander behaviors)
  // DISABLED IN MULTIPLAYER: Non-deterministic random causes desync
  if (window.updateIdleUnits && !window.isMultiplayer) {
    window.updateIdleUnits();
  }
  // Update physics for all units with LOD optimization
  if (window.gameUnits) {
    // log(window.gameUnits[0].pb.state.loc)
    window.gameUnits.forEach(unit => {
      if (unit.pb && unit.pb.integrate) {
        // MULTIPLAYER: Disable LOD physics skipping to prevent desync
        // In single player, skip physics updates for distant neutral units
        if (!window.isMultiplayer && unit.owner === 'neutral' && unit.distanceToCameraSquared > 90000) { // 300^2
          return; // Skip physics integration for distant neutral units
        }
        unit.pb.integrate(this.physicsTimestep, false, false);
      }
    });
  }
      
      // Update player physics (cosmetic frog movement)
      // This doesn't affect game state, safe to keep
      if (window.player && window.player.pbody && window.player.pbody.integrate) {
        window.player.pbody.integrate(this.physicsTimestep, true, true);
      }
      
      // Step physics time forward
      this.physicsTime -= this.physicsTimestep;
      physicsSteps++;
    }
    
    // Debug: log physics timestep info
    if (physicsSteps > 0) {
      // console.log(`⚡ Physics: ${physicsSteps} steps at ${(this.physicsTimestep * 1000).toFixed(1)}ms, remaining: ${(this.physicsTime * 1000).toFixed(1)}ms`);
    }
    
    // Update unit meshes (visual positions) every frame for smooth rendering
    if (window.updateUnitMeshes) {
      window.updateUnitMeshes();
    }
    
    // Update visual position
    if (window.player && window.player.updatePosition) {
      window.player.updatePosition();
    }
    
    // Continue the loop (store ID for cancellation)
    this.animationFrameId = requestAnimationFrame(() => this.update());
  }

};



