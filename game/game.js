






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
  // console.log('🏘️ Spawning initial game units for all players...');
  // console.log('   window.player.id:', window.player?.id);
  // console.log('   this.players spawn order:', this.players.map(p => ({ id: p.id, name: p.name, isLocalPlayer: p === window.player })));
  
  // Adventure mode (co-op) spawns starting units from the map data instead of agoras
  if (this.type === 'adventure') {
    console.log('🎮 Adventure mode: spawning starting units from map data');
    this.spawnAdventureUnits();
    return;
  }
  
  // Spawn villagers and buildings for ALL players (local + opponents)
  if (this.players && this.players.length > 0) {
    
    // CRITICAL: Sort players deterministically by ID before spawning
    // This ensures both clients spawn villagers in the same order with the same counts
    const sortedPlayers = this.players.slice().sort((a, b) => 
      window.deterministicStringCompare(a.id || '', b.id || '')
    );
    
    
    sortedPlayers.forEach((player, index) => {
      if (!player || !player.agora) {
        console.warn(`❌ Player ${index} has no agora!`);
        return;
      }
      
      const isLocalPlayer = player === window.player;
      // console.log(`👤 Spawning for ${isLocalPlayer ? 'LOCAL' : 'OPPONENT'} player at (${player.agora.x}, ${player.agora.y}), ID: ${player.id}`);
      
      // Spawn agora building for this player
      if (window.gameBuildings) {
        // Prefer visual placement path so meshes are created for ALL players (not just local)
        const placeFn = (window.placeBuilding || (typeof placeBuilding === 'function' ? placeBuilding : null));
        if (placeFn && window.gfx && window.gfx.scene) {
          // Agora starts complete (it's the starting building)
          const placed = placeFn('agora', player.agora.x, player.agora.y, window.gfx.scene, { buildProgress: 1.0 });
            if (placed) {
              // CRITICAL: Use last 6 chars of player ID for consistent ownership checks
              const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
              // If ID has hyphens, take the part after the last hyphen, else take last 6 chars
              const parts = rawId.split('-');
              placed.owner = parts.length > 1 ? parts[parts.length - 1] : (rawId.length > 6 ? rawId.slice(-6) : rawId);
              
            
            // Store team color so attached flag meshes can tint correctly
            if (typeof window.getTeamColorForOwner === 'function') {
              placed.teamColor = window.getTeamColorForOwner(placed.owner);
            }
            
            player.buildings.push(placed);
            // NOTE: placeBuilding() already added to window.gameBuildings, don't add twice!
            
            // Rotate agora to face center of map
            if (window.liveField) {
              const mapCenterX = (window.liveField.width / 2) * TILE_SIZE;
              const mapCenterZ = (window.liveField.height / 2) * TILE_SIZE;
              const agoraX = player.agora.x * TILE_SIZE;
              const agoraZ = player.agora.y * TILE_SIZE;
              const dx = mapCenterX - agoraX;
              const dz = mapCenterZ - agoraZ;
              
              // KOTH: Face inward (+90°)
              // Other modes: Face outward (+90° +180° = +270°)
              const isKOTH = window.currentMatch?.gameType === 'koth';
              const angleToCenter = Math.atan2(dx, dz) + (isKOTH ? Math.PI / 2 : Math.PI * 1.5);
              
              placed.targetRotation = angleToCenter;
              
              // Apply rotation when mesh loads
              const checkInterval = setInterval(() => {
                if (placed.mesh) {
                  placed.mesh.rotationQuaternion = null;
                  placed.mesh.rotation.y = angleToCenter;
                  clearInterval(checkInterval);
                }
              }, 100);
            }
            // console.log(`🏛️ Spawned agora for ${player.name || player.id}`);
          }
        } else if (window.Building) {
          // Fallback: create logical building if visual system not available yet
          // CRITICAL: Use last 6 chars of player ID for consistent ownership checks
          const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
          // If ID has hyphens, take the part after the last hyphen, else take last 6 chars
          const parts = rawId.split('-');
          const normalizedOwner = parts.length > 1 ? parts[parts.length - 1] : (rawId.length > 6 ? rawId.slice(-6) : rawId);
          const agoraBuilding = new window.Building('agora', {
            x: player.agora.x * TILE_SIZE,
            y: 0,
            z: player.agora.y * TILE_SIZE
          }, { 
            owner: normalizedOwner,
            gridX: player.agora.x,
            gridZ: player.agora.y
          });
          
          player.buildings.push(agoraBuilding);
          // NOTE: agoraBuilding was already added to window.gameBuildings in Building constructor
          // console.log(`🏛️ Spawned agora (logic only) for ${player.name || player.id}`);
        }
      }
      
      // Spawn villagers around this player's agora
      // Pass player index for deterministic villager count
      this.spawnVillagersForPlayer(player, index);
    });
  } else {
    console.warn('❌ No players found in game.players!');
  }
  
  // console.log('✅ All player units and buildings spawned');
};

Game.prototype.spawnVillagersForPlayer = function(player, playerIndex = 0) {
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
    // CRITICAL: Normalize player ID to use only the short suffix for consistent hashing
    // (e.g., both "p2p-xyz123abc" and "xyz123abc" should hash to the same value)
    const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
    const normalizedId = rawId.includes('-') ? rawId.split('-').pop() : rawId;
    const playerIdHash = normalizedId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    seed = window.currentMatch.mapSeed + playerIdHash;
  } else if (window.mapSeed) {
    // Fallback to global mapSeed if match not yet created
    const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
    const normalizedId = rawId.includes('-') ? rawId.split('-').pop() : rawId;
    const playerIdHash = normalizedId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    seed = window.mapSeed + playerIdHash;
  }
  
  // Seeded random number generator (deterministic using mulberry32)
  // Uses the Determinism module for cross-platform consistency
  const playerRng = window.Determinism ? new window.Determinism.SeededRandom(seed) : null;
  const seededRandom = playerRng ? () => playerRng.next() : () => Math.random();
  
  const agoraX = player.agora.x * TILE_SIZE;
  const agoraZ = player.agora.y * TILE_SIZE;
  
  // CRITICAL: Fixed villager count for all players
  // Everyone starts with the same number of villagers for fairness
  const villagerCount = 8; // All players start with 8 villagers
  
  const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
  const normalizedId = rawId.includes('-') ? rawId.split('-').pop() : rawId;
  const displayHash = normalizedId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  // console.log(`👥 SPAWN SEED TRACE - Player: ${normalizedId}, mapSeed: ${window.currentMatch?.mapSeed || window.mapSeed}, playerHash: ${displayHash}, finalSeed: ${seed}, villagerCount: ${villagerCount}`);
  
  for (let i = 0; i < villagerCount; i++) {
    // Deterministic position around agora (within 3-6 tiles)
    const angle = (i / villagerCount) * Math.PI * 2 + (seededRandom() - 0.5) * 0.5;
    const distance = 3 + seededRandom() * 3;
    
    const x = agoraX + Math.cos(angle) * distance * TILE_SIZE;
    const z = agoraZ + Math.sin(angle) * distance * TILE_SIZE;
    
    // CRITICAL: Increment unitCounter and generate deterministic ID for initial villagers
    // This ensures unitCounter stays in sync across clients
    // CRITICAL: Always pass id option explicitly to prevent Unit constructor from incrementing counter again
    let deterministicUnitId = null;
    if (window.isMultiplayer && window.currentMatch) {
      const unitIndex = window.currentMatch.unitCounter++;
      deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
    }
    
    // CRITICAL: Always pass id in options (even if null) to prevent double-incrementing
    const villager = new window.Unit('villager', { x, y: 0, z }, { id: deterministicUnitId || undefined });
    // CRITICAL: Use last 6 chars of player ID for consistent ownership checks
    const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
    // If ID has hyphens, take the part after the last hyphen, else take last 6 chars
    const parts = rawId.split('-');
    villager.owner = parts.length > 1 ? parts[parts.length - 1] : (rawId.length > 6 ? rawId.slice(-6) : rawId);
    
    // Deterministic rotation
    const randomRotation = seededRandom() * Math.PI * 2;
    villager.rotation = randomRotation;
    if (villager.pb && villager.pb.state && villager.pb.state.rot) {
      villager.pb.state.rot.y = randomRotation;
    }
    
    // Add to player's units
    player.units.push(villager);
    window.gameUnits.push(villager); // Add to global array for rendering
    
    if (i === 0) {
    }
    
    // CRITICAL: Give initial villagers a linger behavior so they can be auto-assigned to work
    if (window.behaviorManager) {
      window.behaviorManager.setBehavior(villager, 'linger', {
        center: { x: villager.pb.state.loc.x, z: villager.pb.state.loc.z },
        radius: 50,  // Large radius - villagers can roam freely
        wanderDistance: 2.0,  // How far they walk each step
        wanderInterval: 30000  // Pick new target every 30 seconds (very relaxed)
      });
    }
    
    if (i === 0) {
      // console.log(`  📍 First villager for ${player.id?.slice(-6)}: ID=${villager.id?.slice(-6)}, owner=${villager.owner?.slice(-6)}, pos=(${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
  
  // console.log(`✅ Spawned ${villagerCount} villagers for ${player.name || player.id}`);
  // console.log(`   Player ID: ${player.id}`);
  // console.log(`   First villager owner: ${player.units[0]?.owner}`);
  // console.log(`   Owner matches player ID: ${player.units[0]?.owner === player.id}`);
};

// Spawn starting units for adventure mode from map data
Game.prototype.spawnAdventureUnits = function() {
  const startingUnits = window.adventureStartingUnits;
  
  if (!startingUnits || startingUnits.length === 0) {
    console.log('⚔️ No starting units defined for this adventure map');
    return;
  }
  
  console.log(`⚔️ Spawning ${startingUnits.length} starting units for adventure mode`);
  console.log(`  📋 this.players:`, this.players?.map(p => p?.id || 'null'));
  console.log(`  📋 window.player.id:`, window.player?.id);
  
  // Group units by player index
  const unitsByPlayer = {};
  startingUnits.forEach(u => {
    if (!unitsByPlayer[u.player]) unitsByPlayer[u.player] = [];
    unitsByPlayer[u.player].push(u);
  });
  
  // Map player indices to actual players
  // For solo adventure: player 0 = local player, all other indices also map to local player
  // For co-op: each index maps to a different player
  const players = this.players || [];
  
  Object.entries(unitsByPlayer).forEach(([playerIndex, units]) => {
    const pIndex = parseInt(playerIndex);
    let targetPlayer = null;
    
    // For solo play, ONLY spawn player 0's units (skip other player indices)
    // This prevents spawning enemy/AI units that the player can't control
    if (players.length === 1) {
      if (pIndex !== 0) {
        console.log(`  ⏭️ P${pIndex + 1}: Skipping ${units.length} units (solo mode, only P1 units spawn)`);
        return; // Skip this player group
      }
      targetPlayer = players[0] || window.player;
    } else if (pIndex < players.length) {
      targetPlayer = players[pIndex];
    } else {
      // If more unit groups than players, skip them (no player to own them)
      console.log(`  ⏭️ P${pIndex + 1}: Skipping ${units.length} units (no player at index ${pIndex})`);
      return;
    }
    
    if (!targetPlayer) {
      console.warn(`⚠️ No player found for unit group ${playerIndex}, skipping`);
      return;
    }
    
    // Ensure player has units array
    if (!targetPlayer.units) {
      targetPlayer.units = [];
    }
    
    console.log(`  👤 P${pIndex + 1}: Spawning ${units.length} units for ${targetPlayer.name || targetPlayer.id}`);
    
    units.forEach((unitData, i) => {
      const worldX = (unitData.x + 0.5) * TILE_SIZE;
      const worldZ = (unitData.y + 0.5) * TILE_SIZE;
      
      // Generate deterministic unit ID
      let deterministicUnitId = null;
      if (window.isMultiplayer && window.currentMatch) {
        const unitIndex = window.currentMatch.unitCounter++;
        deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
      }
      
      // Create the unit
      const unit = new window.Unit(unitData.type, { x: worldX, y: 0, z: worldZ }, { id: deterministicUnitId || undefined });
      
      // Set ownership - CRITICAL: Use same normalization as player.js
      // Player ID format: "adventurer-xxxxxx" or "p2p-xxxxxx"
      // We need to match what player.js uses: this.id.slice(-6)
      const rawId = targetPlayer.id || '';
      const normalizedOwner = rawId.length > 6 ? rawId.slice(-6) : rawId;
      unit.owner = normalizedOwner;
      
      // Add to player's units
      targetPlayer.units.push(unit);
      window.gameUnits.push(unit);
      
      // Give initial units linger behavior
      if (window.behaviorManager) {
        window.behaviorManager.setBehavior(unit, 'linger', {
          center: { x: worldX, z: worldZ },
          radius: 50,
          wanderDistance: 2.0,
          wanderInterval: 30000
        });
      }
      
      if (i === 0) {
        console.log(`    📍 First ${unitData.type}: owner="${unit.owner}" (from "${rawId}"), at (${unitData.x}, ${unitData.y})`);
      }
    });
  });
  
  console.log(`✅ Adventure units spawned, gameUnits.length=${window.gameUnits.length}`);
  console.log(`  📋 window.player.units.length:`, window.player?.units?.length);
  if (window.player?.units?.[0]) {
    console.log(`  📋 First unit owner: "${window.player.units[0].owner}", player.id.slice(-6): "${window.player.id?.slice(-6)}"`);
  }
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
      // console.log('▶️ Game loop started');
    this.update();
  },
  
  stop: function() {
    if (!this.running) {
      // console.log('⚠️ Game loop already stopped');
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
    
    // CRITICAL: Don't cap delta time when tab becomes visible - let catch-up happen
    // When tab is hidden, requestAnimationFrame throttles, causing large deltaTime when refocused
    // We want to catch up by processing multiple physics steps, so don't cap here
    // The maxPhysicsSteps limit will prevent spiral of death
    // Only cap if tab is currently hidden (to prevent weird behavior during hidden period)
    if (document.hidden && this.deltaTime > 0.1) {
      this.deltaTime = 0.1; // Cap at 100ms only when tab is hidden
    }
    
    // Accumulate time for physics
    // BUT: If we're waiting for lockstep peers, don't accumulate - this prevents
    // a huge catch-up burst when the peer finally confirms
    const matchState = window.currentMatch?.state;
    const lockstepWaiting = window.isMultiplayer && (window.lockstepWaitingForPeers || window.fastForwardingTicks);
    
    // Multiplayer determinism rule:
    // - Only advance simulation physics while the match is PLAYING (lockstep-driven).
    // - During LOADING/READY/countdown/chapter transitions, running physics can diverge
    //   between peers (different frame timing) and produce visible "resting in different
    //   places" desyncs right as the next chapter begins.
    const preStartMultiplayer = window.isMultiplayer && window.currentMatch && matchState !== 'playing';
    
    if (!window.lockstepWaitingForPeers && !preStartMultiplayer) {
      this.physicsTime += this.deltaTime;
    }
    
    // Pause simulation physics when lockstep is waiting OR when we're not yet playing in multiplayer.
    const canRunPhysics = !lockstepWaiting && !preStartMultiplayer && (
                          !window.isMultiplayer ||
                          !window.currentMatch ||
                          matchState === 'playing');
    
    // Run physics at fixed timestep (60Hz)
    // DETERMINISM: Physics is driven by fixed timestep, not wall-clock time.
    // This ensures all clients run exactly the same number of physics steps.
    // - Network runs at 20Hz (50ms per tick)
    // - Physics runs at 60Hz (16.67ms per step)  
    // - So we run exactly 3 physics steps per network tick
    // NO CATCH-UP - if we fall behind, we stay behind (sync handles this)
    // Visual interpolation (in updateUnitMeshes) smooths out any visual jitter.
    
    let maxPhysicsSteps = 3; // Strict: exactly 3 physics steps per frame
    let physicsSteps = 0;
    
    // Cap accumulated time to prevent catch-up
    // This means if we miss frames, we just run slower (which is fine - sync handles it)
    // Visual interpolation ensures units don't teleport
    if (this.physicsTime > this.physicsTimestep * 4) {
      // Too much backlog - discard it to prevent catch-up desync
      const discarded = this.physicsTime - (this.physicsTimestep * 3);
      this.physicsTime = this.physicsTimestep * 3;
      // Only log if significant time discarded
      if (discarded > 0.1) {
        // Rate-limit to avoid spam (this can happen during loads / tab focus / GC pauses).
        const now = Date.now();
        if (!this._lastPhysicsBacklogLogAt || (now - this._lastPhysicsBacklogLogAt) > 2000) {
          this._lastPhysicsBacklogLogAt = now;
          console.debug(`⚠️ Physics backlog discarded: ${(discarded * 1000).toFixed(0)}ms (preventing desync)`);
        }
      }
    }
    
    while (this.physicsTime >= this.physicsTimestep && canRunPhysics && physicsSteps < maxPhysicsSteps) {
      physicsSteps++;
      // Update units and their behaviors (this applies impulses)
      // NOTE: updateUnits handles behavior stepping with proper multiplayer filtering
      if (window.updateUnits) {
        window.updateUnits(this.physicsTimestep);
      }
  // CRITICAL: Update buildings (auto-assign workers, spawn villagers, process work)
  if (window.updateBuildings) {
    window.updateBuildings(this.physicsTimestep);
  }
  // Update idle units (give them wander behaviors)
  // NOW DETERMINISTIC: Uses tick-based timing and deterministic random
  if (window.updateIdleUnits) {
    window.updateIdleUnits();
  }
  // REMOVED: pb.integrate() for units - physics is now handled in updateUnits()
  // updateUnits() manually applies impulses → velocity → position (lines 794-804 in units.js)
  // Calling pb.integrate() here caused DOUBLE INTEGRATION and desync!
  // The pb.integrate() call was redundant and caused units to move 2x speed with drift
      
      // Update player physics (cosmetic frog movement)
      // This doesn't affect game state, safe to keep
      if (window.player && window.player.pbody && window.player.pbody.integrate) {
        window.player.pbody.integrate(this.physicsTimestep, true, true);
      }
      
      // Step physics time forward
      this.physicsTime -= this.physicsTimestep;
      // Note: physicsSteps already incremented at top of loop
    }
    
    // Debug: log physics timestep info (only if unusual)
    // Normal is 3 steps per frame at 60Hz display / 20Hz network tick
    // if (physicsSteps > 0 && physicsSteps !== 3) {
    //   console.log(`⚡ Physics: ${physicsSteps} steps, backlog: ${(this.physicsTime * 1000).toFixed(0)}ms`);
    // }
    
    // Update unit meshes (visual positions) every frame for smooth rendering
    if (window.updateUnitMeshes) {
      window.updateUnitMeshes();
    }
    
    // Update projectiles system
    if (window.projectiles && window.projectiles.update) {
      window.projectiles.update(this.deltaTime);
    }
    
    // Update speech bubbles (visual only, non-deterministic)
    if (window.UnitSpeech && window.UnitSpeech.update) {
      window.UnitSpeech.update();
    }
    
    // Update visual position
    if (window.player && window.player.updatePosition) {
      window.player.updatePosition();
    }
    
    // Update game timer display
    updateGameTimer();
    
    // Continue the loop (store ID for cancellation)
    this.animationFrameId = requestAnimationFrame(() => this.update());
  }

};

// Update game timer display
function updateGameTimer() {
  const timerElement = document.getElementById('game_timer');
  if (!timerElement) return;
  
  // Get game time from current match if available
  if (window.currentMatch && (window.currentMatch.state === 'playing' || window.currentMatch.state === 'paused')) {
    const gameTime = window.currentMatch.gameTime || 0;
    const minutes = Math.floor(gameTime / 60);
    const seconds = Math.floor(gameTime % 60);
    timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    timerElement.style.display = 'block';
  } else {
    // Hide timer when not in an active match
    timerElement.style.display = 'none';
  }
}



