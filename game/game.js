






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
    if (window._adventureSpawnVillagers) {
      this.spawnAdventureVillagers();
    }
    // Spawn agoras and villagers for any NPC/AI opponents
    this.spawnAdventureAIBases();
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
      
      // CRITICAL: Compute owner before placeBuilding so async flag callback has it
      const rawId = player.id; // CRITICAL: No fallback - player.id must be set!
      const parts = rawId.split('-');
      const normalizedOwner = parts.length > 1 ? parts[parts.length - 1] : (rawId.length > 6 ? rawId.slice(-6) : rawId);
      
      // Spawn agora building for this player
      if (window.gameBuildings) {
        let deterministicAgoraId;
        if (window.isMultiplayer && window.currentMatch) {
          const buildingIndex = window.currentMatch.buildingCounter++;
          deterministicAgoraId = `building-${window.currentMatch.mapSeed}-${buildingIndex}`;
        }
        // Prefer visual placement path so meshes are created for ALL players (not just local)
        const placeFn = (window.placeBuilding || (typeof placeBuilding === 'function' ? placeBuilding : null));
        if (placeFn && window.gfx && window.gfx.scene) {
          // Agora starts complete (it's the starting building). Pass owner so flag gets team color.
          const placed = placeFn('agora', player.agora.x, player.agora.y, window.gfx.scene, {
            id: deterministicAgoraId,
            buildProgress: 1.0,
            owner: normalizedOwner
          });
            if (placed) {
              placed.owner = normalizedOwner;
              
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
            id: deterministicAgoraId,
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
  
  // CRITICAL: Use deterministic random based on map seed and deterministic player slot,
  // not player ID. Player IDs have been a recurring source of divergence in multiplayer,
  // while the sorted player index is the same on every peer.
  let seed = 12345; // Default seed for single player
  if (window.currentMatch && window.currentMatch.mapSeed) {
    seed = window.currentMatch.mapSeed + ((playerIndex + 1) * 1009);
  } else if (window.mapSeed) {
    // Fallback to global mapSeed if match not yet created
    seed = window.mapSeed + ((playerIndex + 1) * 1009);
  }
  
  // Seeded random number generator (deterministic using mulberry32)
  // Uses the Determinism module for cross-platform consistency
  const playerRng = window.Determinism ? new window.Determinism.SeededRandom(seed) : null;
  const seededRandom = playerRng ? () => playerRng.next() : () => Math.random();
  
  const agoraX = player.agora.x * TILE_SIZE;
  const agoraZ = player.agora.y * TILE_SIZE;
  
  const villagerCount = (this.type === 'adventure') ? 3 : 8;
  
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
    const rawId = player.id;
    villager.owner = rawId.startsWith('npc-') ? rawId : (rawId.length > 6 ? rawId.slice(-6) : rawId);
    
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
  
  // Separate player units (slots 0-3) from NPC/enemy units (slots 5+)
  const unitsByPlayer = {};
  const npcUnits = [];
  startingUnits.forEach(u => {
    if (u.player >= 5) {
      npcUnits.push(u);
    } else {
      if (!unitsByPlayer[u.player]) unitsByPlayer[u.player] = [];
      unitsByPlayer[u.player].push(u);
    }
  });
  
  // Only use human/co-op players for P1-P4 unit assignment, not NPC AI opponents.
  const players = Array.isArray(this.players) ? this.players.filter(p => !p.isAI) : [];
  if (players.length === 0) return;
  const adventurePlayerSlots = Array.isArray(window._adventurePlayerSlots) && window._adventurePlayerSlots.length > 0
    ? window._adventurePlayerSlots
    : players;
  const resolveAdventurePlayerSlot = (playerSlot) => {
    if (!Number.isFinite(playerSlot) || playerSlot < 0 || adventurePlayerSlots.length === 0) {
      return null;
    }
    const assignedIndex = playerSlot % adventurePlayerSlots.length;
    const targetPlayer = adventurePlayerSlots[assignedIndex] || window.player || null;
    if (!targetPlayer) return null;
    return { targetPlayer, assignedIndex };
  };
  
  Object.entries(unitsByPlayer).forEach(([playerIndex, units]) => {
    const pIndex = parseInt(playerIndex);
    const slotAssignment = resolveAdventurePlayerSlot(pIndex);
    const targetPlayer = slotAssignment?.targetPlayer || window.player;
    const assignedPlayerIndex = slotAssignment?.assignedIndex ?? (players.length > 0 ? (pIndex % players.length) : 0);
    
    if (!targetPlayer.units) {
      targetPlayer.units = [];
    }
    
    const assignedTo = pIndex < adventurePlayerSlots.length
      ? `P${pIndex + 1}`
      : `P${assignedPlayerIndex + 1} (was P${pIndex + 1})`;
    console.log(`  👤 ${assignedTo}: Spawning ${units.length} units for ${targetPlayer.name || targetPlayer.id}`);
    
    units.forEach((unitData, i) => {
      const worldX = (unitData.x + 0.5) * TILE_SIZE;
      const worldZ = (unitData.y + 0.5) * TILE_SIZE;
      
      let deterministicUnitId = null;
      if (window.isMultiplayer && window.currentMatch) {
        const unitIndex = window.currentMatch.unitCounter++;
        deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
      }
      
      if (!window.UnitTypes || !window.UnitTypes[unitData.type]) {
        console.warn(`⚠️ Skipping unknown unit type: "${unitData.type}" at (${unitData.x},${unitData.y})`);
        return;
      }

      const unit = new window.Unit(unitData.type, { x: worldX, y: 0, z: worldZ }, {
        id: deterministicUnitId || undefined,
        displayName: (unitData.name && String(unitData.name).trim()) || undefined
      });
      unit.adventureSpawnIndex = Number.isFinite(unitData.spawnIndex) ? unitData.spawnIndex : ((pIndex * 1000) + i);
      unit.adventureAuthoredPlayerSlot = pIndex;
      unit.adventureAssignedPlayerSlot = assignedPlayerIndex;
      
      const rawId = targetPlayer.id || '';
      const normalizedOwner = rawId.length > 6 ? rawId.slice(-6) : rawId;
      unit.owner = normalizedOwner;
      unit.adventureAssignedPlayerId = normalizedOwner;
      
      targetPlayer.units.push(unit);
      window.gameUnits.push(unit);
      
      if (window.behaviorManager) {
        window.behaviorManager.setBehavior(unit, 'linger', {
          center: { x: worldX, z: worldZ },
          radius: 50,
          wanderDistance: 2.0,
          wanderInterval: 30000,
          startImmediately: false
        });
      }
      
      if (i === 0) {
        console.log(`    📍 First ${unitData.type}: owner="${unit.owner}" (from "${rawId}"), at (${unitData.x}, ${unitData.y})`);
      }
    });
  });

  // Spawn NPC/enemy units (player slot >= 5) with synthetic hostile ownership
  if (npcUnits.length > 0) {
    console.log(`  💀 Spawning ${npcUnits.length} NPC/enemy units`);
    
    // Group NPC units by their slot for logging
    const npcBySlot = {};
    npcUnits.forEach(u => {
      if (!npcBySlot[u.player]) npcBySlot[u.player] = [];
      npcBySlot[u.player].push(u);
    });
    
    npcUnits.forEach((unitData, i) => {
      const worldX = (unitData.x + 0.5) * TILE_SIZE;
      const worldZ = (unitData.y + 0.5) * TILE_SIZE;
      
      let deterministicUnitId = null;
      if (window.isMultiplayer && window.currentMatch) {
        const unitIndex = window.currentMatch.unitCounter++;
        deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
      }
      
      if (!window.UnitTypes || !window.UnitTypes[unitData.type]) {
        console.warn(`⚠️ Skipping unknown NPC unit type: "${unitData.type}" at (${unitData.x},${unitData.y})`);
        return;
      }

      const unit = new window.Unit(unitData.type, { x: worldX, y: 0, z: worldZ }, {
        id: deterministicUnitId || undefined,
        displayName: (unitData.name && String(unitData.name).trim()) || undefined
      });
      unit.adventureSpawnIndex = Number.isFinite(unitData.spawnIndex) ? unitData.spawnIndex : (5000 + i);
      
      // NPC units get a synthetic owner ID that is hostile to all players
      const npcOwner = `npc-${unitData.player}`;
      unit.owner = npcOwner;
      unit.isNPC = true;
      
      window.gameUnits.push(unit);
      
      // NPC units get aggressive guard behavior instead of passive linger
      if (window.behaviorManager) {
        window.behaviorManager.setBehavior(unit, 'linger', {
          center: { x: worldX, z: worldZ },
          radius: 80,
          wanderDistance: 4.0,
          wanderInterval: 15000,
          startImmediately: true
        });
      }
      
      if (i === 0) {
        console.log(`    💀 First NPC ${unitData.type}: owner="${npcOwner}", at (${unitData.x}, ${unitData.y})`);
      }
    });
    
    Object.entries(npcBySlot).forEach(([slot, units]) => {
      console.log(`    💀 NPC slot ${slot}: ${units.length} units`);
    });
  }
  
  console.log(`✅ Adventure units spawned, gameUnits.length=${window.gameUnits.length}`);
  console.log(`  📋 window.player.units.length:`, window.player?.units?.length);
  if (window.player?.units?.[0]) {
    console.log(`  📋 First unit owner: "${window.player.units[0].owner}", player.id.slice(-6): "${window.player.id?.slice(-6)}"`);
  }
  console.log('🧭 Adventure spawn ownership sample:', (window.gameUnits || []).slice(0, 8).map((unit, index) => ({
    index,
    id: unit?.id || null,
    type: unit?.type || null,
    owner: unit?.owner || null,
    displayName: typeof unit?.getDisplayName === 'function' ? unit.getDisplayName() : (unit?.displayName || null)
  })));
};

// Spawn villagers at adventure spawn points without requiring an agora
Game.prototype.spawnAdventureVillagers = function() {
  const spawnPositions = window._adventureSpawnPositions;
  if (!spawnPositions || spawnPositions.length === 0) {
    console.warn('❌ No spawn positions for adventure villagers');
    return;
  }

  const players = Array.isArray(this.players) ? this.players.filter(p => !p.isAI) : [];
  if (players.length === 0) return;

  const villagerCount = 3;
  const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;

  let seed = 12345;
  if (window.currentMatch && window.currentMatch.mapSeed) {
    seed = window.currentMatch.mapSeed + 7777;
  } else if (window.mapSeed) {
    seed = window.mapSeed + 7777;
  }

  const playerRng = window.Determinism ? new window.Determinism.SeededRandom(seed) : null;
  const seededRandom = playerRng ? () => playerRng.next() : () => Math.random();

  // Spawn villagers at each player's spawn point (only if that spawn has villagers flag)
  players.forEach((player, pIndex) => {
    const spawn = spawnPositions[pIndex % spawnPositions.length];
    if (!spawn) return;
    if (!spawn.villagers) return;
    if (!player.units) player.units = [];

    const centerX = spawn.x * tileSize;
    const centerZ = spawn.y * tileSize;
    const rawId = player.id || '';
    const normalizedOwner = rawId.length > 6 ? rawId.slice(-6) : rawId;

    console.log(`  👷 Spawning ${villagerCount} villagers for ${player.name || rawId} at spawn (${spawn.x}, ${spawn.y})`);

    for (let i = 0; i < villagerCount; i++) {
      const angle = (i / villagerCount) * Math.PI * 2 + (seededRandom() - 0.5) * 0.5;
      const distance = 3 + seededRandom() * 3;
      const x = centerX + Math.cos(angle) * distance * tileSize;
      const z = centerZ + Math.sin(angle) * distance * tileSize;

      let deterministicUnitId = null;
      if (window.isMultiplayer && window.currentMatch) {
        const unitIndex = window.currentMatch.unitCounter++;
        deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
      }

      if (!window.UnitTypes || !window.UnitTypes['villager']) continue;

      const unit = new window.Unit('villager', { x, y: 0, z }, {
        id: deterministicUnitId || undefined
      });
      unit.owner = normalizedOwner;
      player.units.push(unit);
      window.gameUnits.push(unit);

      if (window.behaviorManager) {
        window.behaviorManager.setBehavior(unit, 'linger', {
          center: { x: centerX, z: centerZ },
          radius: 50,
          wanderDistance: 2.0,
          wanderInterval: 30000,
          startImmediately: false
        });
      }
    }
  });

  console.log(`✅ Adventure villagers spawned: ${players.length * villagerCount} villagers`);
};

Game.prototype.spawnAdventureAIBases = function() {
  const aiOpponents = window.aiOpponents;
  if (!aiOpponents || aiOpponents.length === 0) return;

  const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;
  console.log(`🤖 Spawning ${aiOpponents.length} AI bases for adventure mode`);

  aiOpponents.forEach((ai, index) => {
    if (!ai.buildings) ai.buildings = [];
    if (!ai.units) ai.units = [];

    const rawId = ai.id || `npc-${5 + index}`;
    const normalizedOwner = rawId.startsWith('npc-') ? rawId : (rawId.length > 6 ? rawId.slice(-6) : rawId);

    if (ai.agora) {
      let deterministicAgoraId;
      if (window.isMultiplayer && window.currentMatch) {
        const buildingIndex = window.currentMatch.buildingCounter++;
        deterministicAgoraId = `building-${window.currentMatch.mapSeed}-${buildingIndex}`;
      }

      const placeFn = (window.placeBuilding || (typeof placeBuilding === 'function' ? placeBuilding : null));
      if (placeFn && window.gfx && window.gfx.scene) {
        const placed = placeFn('agora', ai.agora.x, ai.agora.y, window.gfx.scene, {
          id: deterministicAgoraId,
          buildProgress: 1.0,
          owner: normalizedOwner
        });
        if (placed) {
          placed.owner = normalizedOwner;
          if (typeof window.getTeamColorForOwner === 'function') {
            placed.teamColor = window.getTeamColorForOwner(placed.owner);
          }
          ai.buildings.push(placed);

          if (window.liveField) {
            const mapCenterX = (window.liveField.width / 2) * tileSize;
            const mapCenterZ = (window.liveField.height / 2) * tileSize;
            const agoraX = ai.agora.x * tileSize;
            const agoraZ = ai.agora.y * tileSize;
            const dx = mapCenterX - agoraX;
            const dz = mapCenterZ - agoraZ;
            const angleToCenter = Math.atan2(dx, dz) + Math.PI * 1.5;
            placed.targetRotation = angleToCenter;
            const checkInterval = setInterval(() => {
              if (placed.mesh) {
                placed.mesh.rotationQuaternion = null;
                placed.mesh.rotation.y = angleToCenter;
                clearInterval(checkInterval);
              }
            }, 100);
          }
          console.log(`🏛️ Spawned AI agora for ${ai.name || rawId} at (${ai.agora.x}, ${ai.agora.y})`);
        }
      } else if (window.Building) {
        const agoraBuilding = new window.Building('agora', {
          x: ai.agora.x * tileSize, y: 0, z: ai.agora.y * tileSize
        }, {
          id: deterministicAgoraId,
          owner: normalizedOwner,
          gridX: ai.agora.x,
          gridZ: ai.agora.y
        });
        ai.buildings.push(agoraBuilding);
      }
    }

    if (ai._wantVillagers !== false && ai.agora) {
      this.spawnVillagersForPlayer(ai, this.players.indexOf(ai));
    }
  });
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

    const matchPaused = !!window.currentMatch?.isPaused;
    const menuSuspended = !!window.hiddenTabController?.isMenuSuspended?.();
    if (matchPaused || menuSuspended) {
      this.deltaTime = 0;
      this.physicsTime = 0;
      this.lastTime = currentTime;
      updateGameTimer();
      this.animationFrameId = requestAnimationFrame(() => this.update());
      return;
    }
    
    // Accumulate time for physics
    const matchState = window.currentMatch?.state;
    
    // Multiplayer determinism rule:
    // - Only advance simulation physics while the match is PLAYING (lockstep-driven).
    // - During LOADING/READY/countdown/chapter transitions, running physics can diverge
    //   between peers (different frame timing) and produce visible "resting in different
    //   places" desyncs right as the next chapter begins.
    const preStartMultiplayer = window.isMultiplayer && window.currentMatch && matchState !== 'playing';
    
    // In multiplayer PLAYING state, physics is driven by the network tick system
    // (runDeterministicPhysicsStepsForOneNetTick: exactly 3 steps per tick).
    // This ensures ALL clients run the EXACT same number of physics steps,
    // preventing position drift from frame-rate differences or lockstep wait timing.
    // The rAF loop only handles visuals (updateUnitMeshes does velocity extrapolation
    // during lockstep waits for smooth movement).
    const multiplayerDrivenPhysics = window.isMultiplayer && matchState === 'playing';

    if (!preStartMultiplayer && !window.fastForwardingTicks && !multiplayerDrivenPhysics) {
      this.physicsTime += this.deltaTime;
    }
    
    const canRunPhysics = !window.fastForwardingTicks && !preStartMultiplayer && !multiplayerDrivenPhysics;
    
    // Run physics at fixed timestep (60Hz)
    // DETERMINISM: Physics is driven by fixed timestep, not wall-clock time.
    // This ensures all clients run exactly the same number of physics steps.
    // - Network runs at 20Hz (50ms per tick)
    // - Physics runs at 60Hz (16.67ms per step)  
    // - So we run exactly 3 physics steps per network tick
    // NO CATCH-UP - if we fall behind, we stay behind (sync handles this)
    // Visual interpolation (in updateUnitMeshes) smooths out any visual jitter.
    
    let maxPhysicsSteps = 4;
    let physicsSteps = 0;
    
    // Cap accumulated time to prevent catch-up bursts (tab refocus, GC pauses).
    if (this.physicsTime > this.physicsTimestep * 5) {
      const discarded = this.physicsTime - (this.physicsTimestep * 4);
      this.physicsTime = this.physicsTimestep * 4;
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

// Update game timer display (throttled: only updates DOM when value changes)
let _lastGameTimerDisplay = null;
function updateGameTimer() {
  const timerElement = document.getElementById('game_timer');
  if (!timerElement) return;
  
  // Get game time from current match if available
  if (window.currentMatch && (window.currentMatch.state === 'playing' || window.currentMatch.state === 'paused')) {
    const gameTime = window.currentMatch.gameTime || 0;
    const minutes = Math.floor(gameTime / 60);
    const seconds = Math.floor(gameTime % 60);
    const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (_lastGameTimerDisplay !== display) {
      _lastGameTimerDisplay = display;
      timerElement.textContent = display;
    }
    timerElement.style.display = 'block';
  } else {
    _lastGameTimerDisplay = null;
    timerElement.style.display = 'none';
  }
}



