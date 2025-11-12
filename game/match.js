// Match Management System for Aether RTS
// Handles multiplayer match state, synchronization, commands, victory conditions, and replay

(function() {

  // Match state machine
  const MatchState = {
    INITIALIZING: 'initializing',
    LOADING: 'loading',       // Waiting for all players to finish loading
    READY: 'ready',           // All players loaded, waiting for countdown
    PLAYING: 'playing',
    PAUSED: 'paused',
    VICTORY: 'victory',
    DEFEAT: 'defeat',
    DRAW: 'draw',
    DISCONNECTED: 'disconnected'
  };

  class Match {
    constructor(options = {}) {
      // Match metadata
      this.id = options.id || this.generateMatchId();
      this.gameType = options.gameType || 'onevsone';
      this.mapSeed = options.mapSeed || 0;
      this.mapSize = options.mapSize || 64;
      this.createdAt = Date.now();
      this.startedAt = null;
      this.endedAt = null;
      
      // Match state
      this.state = MatchState.INITIALIZING;
      this.tick = 0;
      this.gameTime = 0; // In seconds
      this.isPaused = false;
      
      // Players
      this.players = options.players || [];
      this.localPlayerId = options.localPlayerId || null;
      this.hostId = options.hostId || null;
      
      // Player loading status
      this.playersLoaded = new Set(); // Track which players have finished loading
      this.allPlayersReady = false;
      
      // Victory conditions
      this.victoryCondition = options.victoryCondition || 'elimination'; // 'elimination', 'wonder', 'relic', 'time'
      this.timeLimit = options.timeLimit || 0; // 0 = no limit, otherwise seconds
      this.eliminatedPlayers = new Set();
      
      // Command queue and history
      this.pendingCommands = []; // Commands waiting to be executed
      this.commandHistory = []; // All commands for replay
      this.commandBuffer = new Map(); // Commands per tick per player
      this.localTickInterval = null; // Offline tick loop handle
      
      // Synchronization
      this.checksums = new Map(); // Tick -> checksum for desync detection
      this.lastSyncTick = 0;
      this.syncInterval = 100; // Check sync every 100 ticks (5 seconds at 20Hz)
      this.desyncDetected = false;
      
      // Statistics tracking
      this.stats = {
        commands: 0,
        unitsCreated: {},
        unitsLost: {},
        buildingsCreated: {},
        buildingsDestroyed: {},
        resourcesGathered: {},
        damageDealt: {},
        damageReceived: {}
      };
      
      // Initialize stats for each player
      this.players.forEach(player => {
        const pid = player.id || player;
        this.stats.unitsCreated[pid] = 0;
        this.stats.unitsLost[pid] = 0;
        this.stats.buildingsCreated[pid] = 0;
        this.stats.buildingsDestroyed[pid] = 0;
        this.stats.resourcesGathered[pid] = { food: 0, wood: 0, stone: 0, magic: 0 };
        this.stats.damageDealt[pid] = 0;
        this.stats.damageReceived[pid] = 0;
      });
      
      // Replay data
      this.replay = {
        version: '1.0',
        matchId: this.id,
        gameType: this.gameType,
        mapSeed: this.mapSeed,
        players: this.players.map(p => ({ id: p.id || p, name: p.name || 'Unknown' })),
        commands: []
      };
      
      console.log(`🎮 Match initialized: ${this.id}`);
    }
    
    // Generate unique match ID
    generateMatchId() {
      return `match-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    
    // Start the match (enter loading phase)
    start() {
      if (this.state !== MatchState.INITIALIZING) {
        console.warn('⚠️ Match already started!');
        return;
      }
      
      // Transition to LOADING state - waiting for all players
      this.state = MatchState.LOADING;
      console.log(`⏳ Match entering loading phase: ${this.id}`);
      console.log(`📊 Players: ${this.players.length}`);
      console.log(`🗺️ Map seed: ${this.mapSeed}`);
      console.log(`🎯 Victory condition: ${this.victoryCondition}`);
      
      // Show loading overlay
      this.showLoadingOverlay();
      
      // Hook into game systems (before gameplay starts)
      this.hookGameSystems();
      
      return true;
    }
    
    // Called when local player finishes loading all assets and spawning units
    onLocalPlayerLoaded() {
      console.log(`✅ Local player loaded`);
      
      // Mark self as loaded
      this.playersLoaded.add(this.localPlayerId);
      
      // Send loaded signal to other players
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'player_loaded',
          playerId: this.localPlayerId,
          timestamp: Date.now()
        });
        console.log(`📡 Sent player_loaded signal to peers`);
      }
      
      // Check if all players are loaded
      this.checkAllPlayersLoaded();
    }
    
    // Handle player_loaded message from remote player
    onPlayerLoaded(playerId) {
      console.log(`✅ Player ${playerId.slice(-8)} loaded`);
      this.playersLoaded.add(playerId);
      
      // Update loading overlay
      this.updateLoadingOverlay();
      
      // Check if all players are loaded
      this.checkAllPlayersLoaded();
    }
    
    // Check if all players have loaded
    checkAllPlayersLoaded() {
      const totalPlayers = this.players.length;
      const loadedPlayers = this.playersLoaded.size;
      
      console.log(`📊 Loading progress: ${loadedPlayers}/${totalPlayers} players ready`);
      
      if (loadedPlayers >= totalPlayers && !this.allPlayersReady) {
        this.allPlayersReady = true;
        console.log(`🎉 All players loaded! Starting countdown...`);
        
        // Update overlay to show countdown
        this.showCountdown();
      }
    }
    
    // Show countdown and then start match
    showCountdown() {
      this.state = MatchState.READY;
      
      let countdown = 3;
      const countdownInterval = setInterval(() => {
        if (countdown > 0) {
          this.updateLoadingOverlay(`Starting in ${countdown}...`);
          countdown--;
        } else {
          clearInterval(countdownInterval);
          this.beginPlaying();
        }
      }, 1000);
    }
    
    // Actually start gameplay (called after countdown)
    beginPlaying() {
      this.state = MatchState.PLAYING;
      this.startedAt = Date.now();
      this.tick = 0;
      this.gameTime = 0;
      
      console.log(`🚀 Match started: ${this.id}`);
      
      // Hide loading overlay
      this.hideLoadingOverlay();
      
      // Camera already positioned and attached in lobby - just verify it's correct
      if (window.gfx && window.gfx.camera && window.gfx.cameraTarget && window.player && window.player.agora) {
        const expectedX = window.player.agora.x * (window.TILE_SIZE || 4);
        const expectedZ = window.player.agora.y * (window.TILE_SIZE || 4);
        const actualX = window.gfx.cameraTarget.position.x;
        const actualZ = window.gfx.cameraTarget.position.z;
        const distance = Math.sqrt(Math.pow(expectedX - actualX, 2) + Math.pow(expectedZ - actualZ, 2));
        
        if (distance > 10) {
          console.warn(`⚠️ Camera drifted from spawn! Correcting...`);
          // Force correct position
          window.gfx.cameraTarget.position.x = expectedX;
          window.gfx.cameraTarget.position.z = expectedZ;
          if (window.cameraAnchor) {
            window.cameraAnchor.x = expectedX;
            window.cameraAnchor.z = expectedZ;
          }
          console.log('✅ Corrected camera position to spawn');
        } else {
          console.log(`✅ Camera correctly positioned at spawn (distance: ${distance.toFixed(1)})`);
        }
        
        // Defensive: clamp camera params and re-seed chunk loading at the camera center
        if (!Number.isFinite(window.gfx.camera.alpha)) window.gfx.camera.alpha = -2.5;
        if (!Number.isFinite(window.gfx.camera.beta)) window.gfx.camera.beta = 0.9;
        if (!Number.isFinite(window.gfx.camera.radius)) window.gfx.camera.radius = 80;
        // Force camera limits to recalc for new field size
        window._cameraLimitsSet = false;
        // Seed terrain loading exactly at the camera center
        if (window.liveField && typeof window.liveField.updateVisibleChunks === 'function') {
          window.liveField.updateVisibleChunks(window.gfx.cameraTarget.position.x, window.gfx.cameraTarget.position.z);
        }
        
        console.log(`📷 Camera controls ready - alpha: ${window.gfx.camera.alpha.toFixed(2)}, beta: ${window.gfx.camera.beta.toFixed(2)}`);
      }
      
      // Input listeners are already attached at startup - no need to re-attach
      // Re-calling initInputListeners() creates duplicate listeners which breaks input
      console.log('🎮 Input listeners already active (not re-attaching)');
      
      // Ensure no overlays are blocking input
      const loadingOverlay = document.getElementById('match_loading_overlay');
      if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
        loadingOverlay.style.pointerEvents = 'none';
      }
      
      // Reinitialize lasso selection system
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
        console.log('🎯 Lasso selection system reinitialized');
      }
      
      // Log player and unit info for debugging
      console.log('🎮 Match started - Player/Unit state check:');
      console.log(`  Player ID: ${window.player?.id}`);
      console.log(`  Player units: ${window.player?.units?.length || 0}`);
      console.log(`  Global gameUnits: ${window.gameUnits?.length || 0}`);
      
      if (window.player?.units && window.player.units.length > 0) {
        const firstUnit = window.player.units[0];
        console.log(`  First unit ID: ${firstUnit.id}`);
        console.log(`  First unit owner: ${firstUnit.owner}`);
        console.log(`  Player ID matches: ${firstUnit.owner === window.player.id}`);
        console.log(`  Legacy 'player' matches: ${firstUnit.owner === 'player'}`);
        console.log(`  Can select: ${firstUnit.owner === window.player.id || firstUnit.owner === 'player'}`);
      }
      
      // Test click detection
      console.log('🎯 Input system check:');
      console.log(`  Lasso system: ${window.lassoSelection ? 'EXISTS' : 'MISSING'}`);
      console.log(`  Input listeners init: ${window._inputListenersInitialized ? 'YES' : 'NO'}`);
      console.log(`  handlePointer exists: ${window.ui?.handlePointer ? 'YES' : 'NO'}`)
      
      // DON'T start a separate tick loop - network already handles ticking via net.startTickLoop()
      // The Match will be ticked by the network system which calls processTick() from net.js
      
      return true;
    }
    
    // Start a local tick loop for offline matches
    startLocalTickLoop() {
      if (window.isMultiplayer) {
        return; // Network tick loop will drive the match
      }
      
      if (this.localTickInterval) {
        return; // Already running
      }
      
      const tickRate = (window.net && window.net.TICK_RATE) ? window.net.TICK_RATE : 20;
      const tickIntervalMs = 1000 / tickRate;
      
      this.localTickInterval = setInterval(() => {
        try {
          this.processTick();
        } catch (error) {
          console.error('❌ Error in local match tick loop:', error);
        }
      }, tickIntervalMs);
      
      console.log(`🕒 Local match tick loop started at ${tickRate} Hz`);
    }
    
    // Stop the local tick loop if running
    stopLocalTickLoop() {
      if (this.localTickInterval) {
        clearInterval(this.localTickInterval);
        this.localTickInterval = null;
        console.log('🕒 Local match tick loop stopped');
      }
    }
    
    // Process a single tick (called by network tick loop, not by our own timer)
    processTick() {
      // Only process ticks when actually playing (not during loading/ready states)
      if (this.state !== MatchState.PLAYING || this.isPaused) {
        return;
      }
      
      this.tick++;
      this.gameTime = this.tick / (window.net?.TICK_RATE || 20);
      
      // Execute commands for this tick
      this.executeCommandsForTick(this.tick);
      
      // Check victory conditions
      if (this.tick % 20 === 0) { // Check every second
        this.checkVictoryConditions();
      }
      
      // Synchronization checkpoint
      if (this.tick % this.syncInterval === 0) {
        this.createSyncCheckpoint();
      }
      
      // Time limit check
      if (this.timeLimit > 0 && this.gameTime >= this.timeLimit) {
        this.endMatchByTimeLimit();
      }
    }
    
    // Submit a command to the match
    submitCommand(command) {
      // Allow commands in READY state (pre-match positioning) and PLAYING state
      if (this.state !== MatchState.PLAYING && this.state !== MatchState.READY) {
        console.warn(`⚠️ Cannot submit command - match in ${this.state} state`);
        return false;
      }
      
      // Add metadata
      const enrichedCommand = {
        ...command,
        matchId: this.id,
        playerId: command.playerId || this.localPlayerId,
        tick: this.tick + 2, // Execute 2 ticks in future for network lag
        timestamp: Date.now(),
        commandId: this.generateCommandId()
      };
      
      // Validate command
      if (!this.validateCommand(enrichedCommand)) {
        console.warn('⚠️ Invalid command:', enrichedCommand);
        return false;
      }
      
      // Add to pending queue
      this.pendingCommands.push(enrichedCommand);
      
      // Add to command buffer
      const tickKey = enrichedCommand.tick;
      if (!this.commandBuffer.has(tickKey)) {
        this.commandBuffer.set(tickKey, []);
      }
      this.commandBuffer.get(tickKey).push(enrichedCommand);
      
      // Send over network if multiplayer
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'game_command',
          command: enrichedCommand
        });
      }
      
      // Add to replay
      this.replay.commands.push(enrichedCommand);
      
      // Update stats
      this.stats.commands++;
      
      return true;
    }
    
    // Validate a command
    validateCommand(command) {
      // Check required fields
      if (!command.type || !command.playerId || typeof command.tick !== 'number') {
        return false;
      }
      
      // Check player is in match
      const playerExists = this.players.some(p => (p.id || p) === command.playerId);
      if (!playerExists) {
        console.warn(`⚠️ Command from unknown player: ${command.playerId}`);
        return false;
      }
      
      // Check player is not eliminated
      if (this.eliminatedPlayers.has(command.playerId)) {
        console.warn(`⚠️ Command from eliminated player: ${command.playerId}`);
        return false;
      }
      
      // Type-specific validation
      switch (command.type) {
        case 'move':
          return command.unitIds && command.target;
        case 'attack':
          return command.unitIds && command.targetId;
        case 'build':
          return command.buildingType && command.position;
        case 'train':
          return command.unitType && command.buildingId;
        case 'gather':
          return command.unitIds && command.resourceId;
        default:
          return true; // Allow unknown command types
      }
    }
    
    // Execute commands for a specific tick
    executeCommandsForTick(tick) {
      const commands = this.commandBuffer.get(tick);
      
      if (!commands || commands.length === 0) {
        return;
      }
      
      // Sort commands deterministically (by player ID, then command ID)
      commands.sort((a, b) => {
        if (a.playerId !== b.playerId) {
          return a.playerId.localeCompare(b.playerId);
        }
        return a.commandId.localeCompare(b.commandId);
      });
      
      // Execute each command
      commands.forEach(cmd => {
        try {
          this.executeCommand(cmd);
        } catch (error) {
          console.error(`❌ Error executing command:`, cmd, error);
        }
      });
      
      // Clean up old command buffers (keep last 100 ticks)
      const oldTick = tick - 100;
      this.commandBuffer.delete(oldTick);
    }
    
    // Execute a single command
    executeCommand(command) {
      switch (command.type) {
        case 'move':
          this.executeMoveCommand(command);
          break;
        case 'attack':
          this.executeAttackCommand(command);
          break;
        case 'build':
          this.executeBuildCommand(command);
          break;
        case 'train':
          this.executeTrainCommand(command);
          break;
        case 'gather':
          this.executeGatherCommand(command);
          break;
        case 'ability':
          this.executeAbilityCommand(command);
          break;
        default:
          console.warn(`⚠️ Unknown command type: ${command.type}`);
      }
    }
    
    // Command execution handlers
    executeMoveCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      units.forEach(unit => {
        if (unit.owner === cmd.playerId && window.behaviorManager) {
          window.behaviorManager.setBehavior(unit, 'move', { target: cmd.target });
        }
      });
    }
    
    executeAttackCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const target = this.getUnitById(cmd.targetId);
      
      if (!target) return;
      
      units.forEach(unit => {
        if (unit.owner === cmd.playerId && window.behaviorManager) {
          window.behaviorManager.setBehavior(unit, 'attack', { target: target });
        }
      });
    }
    
    executeBuildCommand(cmd) {
      if (!window.Building || !window.playerBuildings) return;
      
      const player = this.getPlayerById(cmd.playerId);
      if (!player) return;
      
      // Check resources
      const cost = this.getBuildingCost(cmd.buildingType);
      if (!this.canAfford(player, cost)) {
        console.log(`⚠️ ${player.name || cmd.playerId} cannot afford ${cmd.buildingType}`);
        return;
      }
      
      // Deduct resources
      this.deductResources(player, cost);
      
      // Create building
      const building = new window.Building(cmd.buildingType, cmd.position, cmd.playerId);
      player.buildings.push(building);
      window.playerBuildings.push(building);
      
      // Update stats
      this.stats.buildingsCreated[cmd.playerId]++;
      
      console.log(`🏗️ ${player.name || cmd.playerId} built ${cmd.buildingType}`);
    }
    
    executeTrainCommand(cmd) {
      const building = this.getBuildingById(cmd.buildingId);
      const player = this.getPlayerById(cmd.playerId);
      
      if (!building || !player || building.owner !== cmd.playerId) return;
      
      // Check resources
      const cost = this.getUnitCost(cmd.unitType);
      if (!this.canAfford(player, cost)) {
        return;
      }
      
      // Deduct resources
      this.deductResources(player, cost);
      
      // Create unit at building location
      const spawnPos = {
        x: building.gridX * TILE_SIZE,
        y: 0,
        z: building.gridZ * TILE_SIZE
      };
      
      const unit = new window.Unit(cmd.unitType, spawnPos);
      unit.owner = cmd.playerId;
      player.units.push(unit);
      window.gameUnits.push(unit);
      
      // Update stats
      this.stats.unitsCreated[cmd.playerId]++;
      
      console.log(`👤 ${player.name || cmd.playerId} trained ${cmd.unitType}`);
    }
    
    executeGatherCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const resource = this.getResourceById(cmd.resourceId);
      
      if (!resource) return;
      
      units.forEach(unit => {
        if (unit.owner === cmd.playerId && window.behaviorManager) {
          window.behaviorManager.setBehavior(unit, 'gather', { resource: resource });
        }
      });
    }
    
    executeAbilityCommand(cmd) {
      const unit = this.getUnitById(cmd.unitId);
      if (!unit || unit.owner !== cmd.playerId) return;
      
      // Trigger ability (implement ability system)
      if (window.abilitySystem && window.abilitySystem.useAbility) {
        window.abilitySystem.useAbility(unit, cmd.abilityId, cmd.target);
      }
    }
    
    // Victory condition checks
    checkVictoryConditions() {
      switch (this.victoryCondition) {
        case 'elimination':
          this.checkEliminationVictory();
          break;
        case 'wonder':
          this.checkWonderVictory();
          break;
        case 'relic':
          this.checkRelicVictory();
          break;
      }
    }
    
    checkEliminationVictory() {
      // Check each player's units and buildings
      this.players.forEach(player => {
        const pid = player.id || player;
        
        if (this.eliminatedPlayers.has(pid)) {
          return; // Already eliminated
        }
        
        const hasUnits = player.units && player.units.length > 0;
        const hasBuildings = player.buildings && player.buildings.length > 0;
        
        if (!hasUnits && !hasBuildings) {
          this.eliminatePlayer(pid);
        }
      });
      
      // Check if only one player remains
      const remainingPlayers = this.players.filter(p => 
        !this.eliminatedPlayers.has(p.id || p)
      );
      
      if (remainingPlayers.length === 1) {
        this.endMatch(remainingPlayers[0].id || remainingPlayers[0], 'elimination');
      } else if (remainingPlayers.length === 0) {
        this.endMatch(null, 'draw');
      }
    }
    
    checkWonderVictory() {
      // Check if any player has completed a Wonder and held it for required time
      this.players.forEach(player => {
        const wonder = player.buildings?.find(b => 
          b.type === 'wonder' && b.constructionProgress >= 100
        );
        
        if (wonder && wonder.completedAt) {
          const timeHeld = this.gameTime - wonder.completedAt;
          const requiredTime = 300; // 5 minutes
          
          if (timeHeld >= requiredTime) {
            this.endMatch(player.id || player, 'wonder');
          }
        }
      });
    }
    
    checkRelicVictory() {
      // Count relics held by each player
      const relicCounts = {};
      this.players.forEach(p => relicCounts[p.id || p] = 0);
      
      // Check relic-holding buildings (e.g., monasteries)
      this.players.forEach(player => {
        player.buildings?.forEach(building => {
          if (building.type === 'monastery' && building.relics) {
            relicCounts[player.id || player] += building.relics.length;
          }
        });
      });
      
      // Check if any player holds all relics
      const totalRelics = window.liveField?.relics?.length || 0;
      for (const [playerId, count] of Object.entries(relicCounts)) {
        if (count === totalRelics && count > 0) {
          this.endMatch(playerId, 'relic');
        }
      }
    }
    
    // Eliminate a player
    eliminatePlayer(playerId) {
      this.eliminatedPlayers.add(playerId);
      console.log(`💀 Player ${playerId} eliminated`);
      
      // Show notification
      if (playerId === this.localPlayerId) {
        this.showNotification('You have been eliminated!', 'defeat');
      } else {
        const player = this.getPlayerById(playerId);
        this.showNotification(`${player?.name || playerId} has been eliminated`, 'info');
      }
    }
    
    // End match by time limit
    endMatchByTimeLimit() {
      // Determine winner by score (units + buildings + resources)
      let highestScore = -1;
      let winner = null;
      
      this.players.forEach(player => {
        const score = this.calculatePlayerScore(player);
        if (score > highestScore) {
          highestScore = score;
          winner = player.id || player;
        }
      });
      
      this.endMatch(winner, 'time_limit');
    }
    
    // Calculate player score
    calculatePlayerScore(player) {
      const units = player.units?.length || 0;
      const buildings = player.buildings?.length || 0;
      const resources = Object.values(player.resources || {}).reduce((sum, val) => sum + val, 0);
      
      return units * 10 + buildings * 50 + resources;
    }
    
    // End the match
    endMatch(winnerId, reason) {
      if (this.state === MatchState.VICTORY || this.state === MatchState.DEFEAT || this.state === MatchState.DRAW) {
        return; // Already ended
      }
      
      this.endedAt = Date.now();
      const duration = (this.endedAt - this.startedAt) / 1000;
      
      // Determine local player result
      if (!winnerId) {
        this.state = MatchState.DRAW;
      } else if (winnerId === this.localPlayerId) {
        this.state = MatchState.VICTORY;
      } else {
        this.state = MatchState.DEFEAT;
      }
      
      // Save match data
      this.replay.duration = duration;
      this.replay.winner = winnerId;
      this.replay.reason = reason;
      this.replay.stats = this.stats;
      this.replay.endTick = this.tick;
      
      console.log(`🏁 Match ended: ${reason}`);
      console.log(`⏱️ Duration: ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`);
      console.log(`👑 Winner: ${winnerId || 'Draw'}`);
      
      // Show victory/defeat screen
      this.showEndGameScreen();
      
      // Save replay to local storage
      this.saveReplay();
      
      // Send match results to server (if implemented)
      this.reportMatchResults();
      
      if (!window.isMultiplayer) {
        this.stopLocalTickLoop();
      }
    }
    
    // Create synchronization checkpoint
    createSyncCheckpoint() {
      const checksum = this.calculateGameStateChecksum();
      this.checksums.set(this.tick, checksum);
      
      // Send checksum to other players for verification
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'sync_checkpoint',
          tick: this.tick,
          checksum: checksum
        });
      }
      
      this.lastSyncTick = this.tick;
    }
    
    // Calculate game state checksum for desync detection
    calculateGameStateChecksum() {
      let hash = 0;
      let unitCount = 0;
      let buildingCount = 0;
      
      // Hash all unit positions and states (in deterministic order by ID)
      const sortedUnits = (window.gameUnits || []).slice().sort((a, b) => 
        (a.id || '').localeCompare(b.id || '')
      );
      
      sortedUnits.forEach(unit => {
        if (unit.pb && unit.pb.state) {
          hash ^= this.hashVector(unit.pb.state.loc);
          hash ^= this.hashString(unit.owner || 'neutral');
          hash ^= Math.floor((unit.currentHealth || unit.health || 100) * 100);
          unitCount++;
        }
      });
      
      // Hash all building states (in deterministic order)
      const sortedBuildings = (window.playerBuildings || []).slice().sort((a, b) => 
        (a.id || '').localeCompare(b.id || '')
      );
      
      sortedBuildings.forEach(building => {
        hash ^= this.hashPosition(building.gridX, building.gridZ);
        hash ^= this.hashString(building.owner || 'neutral');
        hash ^= Math.floor((building.health || 100) * 100);
        buildingCount++;
      });
      
      // Hash player resources
      this.players.forEach(player => {
        if (player.resources) {
          hash ^= Math.floor(player.resources.food || 0);
          hash ^= Math.floor(player.resources.wood || 0);
          hash ^= Math.floor(player.resources.stone || 0);
          hash ^= Math.floor(player.resources.magic || 0);
        }
      });
      
      // Log detailed state for first few syncs
      if (this.tick < 300 && this.tick % 100 === 0) {
        console.log(`🔍 Checksum at tick ${this.tick}:`, {
          hash,
          unitCount,
          buildingCount,
          firstUnitPos: sortedUnits[0]?.pb?.state?.loc ? 
            `(${sortedUnits[0].pb.state.loc.x.toFixed(2)}, ${sortedUnits[0].pb.state.loc.z.toFixed(2)})` : 
            'none'
        });
      }
      
      return hash >>> 0; // Convert to unsigned 32-bit integer
    }
    
    // Simple hash functions
    hashVector(vec) {
      return Math.floor(vec.x * 1000) ^ Math.floor(vec.y * 1000) ^ Math.floor(vec.z * 1000);
    }
    
    hashPosition(x, z) {
      return (x * 73856093) ^ (z * 19349663);
    }
    
    hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash >>> 0;
    }
    
    // Verify sync checkpoint from another player
    verifySyncCheckpoint(tick, remoteChecksum) {
      const localChecksum = this.checksums.get(tick);
      
      if (localChecksum === undefined) {
        return; // We don't have this checkpoint yet
      }
      
      if (localChecksum !== remoteChecksum) {
        console.error(`❌ DESYNC DETECTED at tick ${tick}!`);
        console.error(`   Local: ${localChecksum}, Remote: ${remoteChecksum}`);
        this.desyncDetected = true;
        this.handleDesync(tick);
      }
    }
    
    // Handle desynchronization
    handleDesync(tick) {
      this.showNotification('Game desynchronized! Attempting to recover...', 'error');
      
      // Pause the match
      this.isPaused = true;
      
      // Request full state sync from host
      if (window.net && window.net.p2p && this.hostId !== this.localPlayerId) {
        window.net.p2p.sendData({
          type: 'request_state_sync',
          tick: this.tick
        });
      }
    }
    
    // Helper functions
    generateCommandId() {
      return `cmd-${this.tick}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    
    getUnitsByIds(ids) {
      if (!Array.isArray(ids)) ids = [ids];
      return window.gameUnits?.filter(u => ids.includes(u.id)) || [];
    }
    
    getUnitById(id) {
      return window.gameUnits?.find(u => u.id === id);
    }
    
    getBuildingById(id) {
      return window.playerBuildings?.find(b => b.id === id);
    }
    
    getResourceById(id) {
      return window.resources?.find(r => r.id === id);
    }
    
    getPlayerById(id) {
      return this.players.find(p => (p.id || p) === id);
    }
    
    canAfford(player, cost) {
      return (player.resources.food || 0) >= (cost.food || 0) &&
             (player.resources.wood || 0) >= (cost.wood || 0) &&
             (player.resources.stone || 0) >= (cost.stone || 0) &&
             (player.resources.magic || 0) >= (cost.magic || 0);
    }
    
    deductResources(player, cost) {
      player.resources.food -= (cost.food || 0);
      player.resources.wood -= (cost.wood || 0);
      player.resources.stone -= (cost.stone || 0);
      player.resources.magic -= (cost.magic || 0);
    }
    
    getBuildingCost(type) {
      const costs = {
        'agora': { wood: 100, stone: 50 },
        'barracks': { wood: 150, stone: 75 },
        'archery_range': { wood: 125, stone: 60 },
        'stable': { wood: 175, stone: 100 },
        'blacksmith': { wood: 125, stone: 125 },
        'monastery': { wood: 175, stone: 175, magic: 50 },
        'wonder': { wood: 1000, stone: 1000, magic: 500 }
      };
      return costs[type] || { wood: 50, stone: 25 };
    }
    
    getUnitCost(type) {
      const costs = {
        'villager': { food: 50 },
        'warrior': { food: 60, wood: 20 },
        'archer': { food: 40, wood: 35 },
        'cavalry': { food: 80, wood: 40 },
        'mage': { food: 60, magic: 50 }
      };
      return costs[type] || { food: 50 };
    }
    
    // Hook into game systems
    hookGameSystems() {
      // Hook unit death
      const originalOnUnitDeath = window.onUnitDeath;
      window.onUnitDeath = (unit) => {
        if (unit.owner && unit.owner !== 'neutral') {
          this.stats.unitsLost[unit.owner]++;
        }
        if (originalOnUnitDeath) originalOnUnitDeath(unit);
      };
      
      // Hook building destruction
      const originalOnBuildingDestroyed = window.onBuildingDestroyed;
      window.onBuildingDestroyed = (building) => {
        if (building.owner) {
          this.stats.buildingsDestroyed[building.owner]++;
        }
        if (originalOnBuildingDestroyed) originalOnBuildingDestroyed(building);
      };
      
      // Hook resource gathering
      const originalOnResourceGathered = window.onResourceGathered;
      window.onResourceGathered = (playerId, resourceType, amount) => {
        if (this.stats.resourcesGathered[playerId]) {
          this.stats.resourcesGathered[playerId][resourceType] += amount;
        }
        if (originalOnResourceGathered) originalOnResourceGathered(playerId, resourceType, amount);
      };
    }
    
    // Show end game screen
    showEndGameScreen() {
      // Create or update end game UI
      let endScreen = document.getElementById('match_end_screen');
      if (!endScreen) {
        endScreen = document.createElement('div');
        endScreen.id = 'match_end_screen';
        document.body.appendChild(endScreen);
      }
      
      const isVictory = this.state === MatchState.VICTORY;
      const isDraw = this.state === MatchState.DRAW;
      
      endScreen.innerHTML = `
        <div class="match_end_overlay">
          <div class="match_end_panel">
            <h1 class="match_end_title ${isVictory ? 'victory' : (isDraw ? 'draw' : 'defeat')}">
              ${isVictory ? '🏆 VICTORY!' : (isDraw ? '🤝 DRAW' : '💀 DEFEAT')}
            </h1>
            <div class="match_stats">
              <p>Duration: ${this.formatDuration(this.endedAt - this.startedAt)}</p>
              <p>Commands: ${this.stats.commands}</p>
            </div>
            <button class="match_end_btn" onclick="window.currentMatch.returnToMenu()">Return to Menu</button>
            <button class="match_end_btn secondary" onclick="window.currentMatch.viewReplay()">View Replay</button>
          </div>
        </div>
      `;
      
      endScreen.style.display = 'block';
    }
    
    // Show loading overlay
    showLoadingOverlay() {
      let overlay = document.getElementById('match_loading_overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'match_loading_overlay';
        overlay.style.cssText = `
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          pointer-events: none;
          font-family: Arial, sans-serif;
        `;
        document.body.appendChild(overlay);
      }
      
      // Ensure overlay doesn't block input
      overlay.style.pointerEvents = 'none';
      
      const loadedCount = this.playersLoaded.size;
      const totalCount = this.players.length;
      
      overlay.innerHTML = `
        <div style="text-align: center; color: white;">
          <h1 style="font-size: 2em; margin-bottom: 20px;">🎮 Loading Match</h1>
          <div style="font-size: 1.2em; margin-bottom: 15px;">
            <div class="loading-spinner" style="
              width: 50px; height: 50px;
              border: 5px solid rgba(255,255,255,0.3);
              border-top: 5px solid white;
              border-radius: 50%;
              margin: 0 auto 20px;
              animation: spin 1s linear infinite;
            "></div>
            <p>Waiting for players...</p>
            <p style="font-size: 1.5em; margin: 10px 0;">${loadedCount} / ${totalCount} ready</p>
          </div>
        </div>
      `;
      
      // Add CSS animation for spinner
      if (!document.getElementById('match-loading-styles')) {
        const style = document.createElement('style');
        style.id = 'match-loading-styles';
        style.textContent = `
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(style);
      }
      
      overlay.style.display = 'flex';
    }
    
    // Update loading overlay with current status
    updateLoadingOverlay(message) {
      const overlay = document.getElementById('match_loading_overlay');
      if (!overlay) return;
      
      const loadedCount = this.playersLoaded.size;
      const totalCount = this.players.length;
      
      if (message) {
        // Custom message (e.g., countdown)
        overlay.innerHTML = `
          <div style="text-align: center; color: white;">
            <h1 style="font-size: 3em; margin-bottom: 20px;">🎮</h1>
            <p style="font-size: 2em; font-weight: bold;">${message}</p>
          </div>
        `;
      } else {
        // Default loading progress
        overlay.innerHTML = `
          <div style="text-align: center; color: white;">
            <h1 style="font-size: 2em; margin-bottom: 20px;">🎮 Loading Match</h1>
            <div style="font-size: 1.2em; margin-bottom: 15px;">
              <div class="loading-spinner" style="
                width: 50px; height: 50px;
                border: 5px solid rgba(255,255,255,0.3);
                border-top: 5px solid white;
                border-radius: 50%;
                margin: 0 auto 20px;
                animation: spin 1s linear infinite;
              "></div>
              <p>Waiting for players...</p>
              <p style="font-size: 1.5em; margin: 10px 0;">${loadedCount} / ${totalCount} ready</p>
            </div>
          </div>
        `;
      }
    }
    
    // Hide loading overlay
    hideLoadingOverlay() {
      const overlay = document.getElementById('match_loading_overlay');
      if (overlay) {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '-1';
        console.log('🎯 Loading overlay hidden and input unblocked');
      }
    }
    
    formatDuration(ms) {
      const seconds = Math.floor(ms / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    showNotification(message, type = 'info') {
      console.log(`📢 ${message}`);
      // TODO: Implement in-game notification UI
    }
    
    // Save replay to local storage
    saveReplay() {
      try {
        const replayKey = `replay_${this.id}`;
        localStorage.setItem(replayKey, JSON.stringify(this.replay));
        console.log(`💾 Replay saved: ${replayKey}`);
      } catch (error) {
        console.error('❌ Failed to save replay:', error);
      }
    }
    
    // Report match results (placeholder for server integration)
    reportMatchResults() {
      // TODO: Send to matchmaking/stats server
      console.log('📊 Match results:', {
        id: this.id,
        winner: this.replay.winner,
        duration: this.replay.duration,
        stats: this.stats
      });
    }
    
    // Return to menu
    returnToMenu() {
      window.location.reload();
    }
    
    // View replay
    viewReplay() {
      console.log('🎬 Replay viewer not implemented yet');
      // TODO: Implement replay viewer
    }
  }

  // Export to window
  window.Match = Match;
  window.MatchState = MatchState;
  
  console.log('✅ Match system initialized');

})();

