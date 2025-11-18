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
      this.victoryCheckingDisabled = false; // Set to true after player chooses to continue playing
      
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
      
      // console.log(`🎮 Match initialized: ${this.id}`);
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
      // console.log(`⏳ Match entering loading phase: ${this.id}`);
      // console.log(`📊 Players: ${this.players.length}`);
      // console.log(`🗺️ Map seed: ${this.mapSeed}`);
      // console.log(`🎯 Victory condition: ${this.victoryCondition}`);
      
      // Show loading overlay
      this.showLoadingOverlay();
      
      // Hook into game systems (before gameplay starts)
      this.hookGameSystems();
      
      return true;
    }
    
    // Called when local player finishes loading all assets and spawning units
    onLocalPlayerLoaded() {
      // console.log(`✅ Local player loaded`);
      
      // Mark self as loaded
      this.playersLoaded.add(this.localPlayerId);
      
      // Send loaded signal to other players
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'player_loaded',
          playerId: this.localPlayerId,
          timestamp: Date.now()
        });
        // console.log(`📡 Sent player_loaded signal to peers`);
      }
      
      // Check if all players are loaded
      this.checkAllPlayersLoaded();
    }
    
    // Handle player_loaded message from remote player
    onPlayerLoaded(playerId) {
      // console.log(`✅ Player ${playerId.slice(-8)} loaded`);
      this.playersLoaded.add(playerId);
      
      // Update loading overlay
      this.updateLoadingOverlay();
      
      // Check if all players are loaded
      this.checkAllPlayersLoaded();
    }
    
    // Check if all players have loaded
    checkAllPlayersLoaded() {
      // Only count human players (exclude AI)
      const humanPlayers = this.players.filter(p => !p.isAI);
      const totalHumanPlayers = humanPlayers.length;
      const loadedPlayers = this.playersLoaded.size;
      
      // console.log(`📊 Loading progress: ${loadedPlayers}/${totalHumanPlayers} human players ready (${this.players.length - totalHumanPlayers} AI)`);
      
      if (loadedPlayers >= totalHumanPlayers && !this.allPlayersReady) {
        this.allPlayersReady = true;
        // console.log(`🎉 All human players loaded! Starting countdown...`);
        
        // Only HOST starts the countdown and broadcasts to clients
        if (this.isHost()) {
          this.showCountdown();
        } else {
          // Clients wait for host to send start_match message
          this.updateLoadingOverlay('Waiting for host to start...');
        }
      }
    }
    
    // Show countdown and then start match (HOST ONLY)
    // This should be called AFTER all heavy initialization is complete
    showCountdown() {
      this.state = MatchState.READY;
      // console.log('⏱️ Starting countdown (3-2-1-GO)...');
      
      // Delay countdown slightly to let any final initialization settle
      setTimeout(() => {
        // 3
        this.updateLoadingOverlay(`3`);
        if (window.isMultiplayer && window.net && window.net.p2p) {
          window.net.p2p.sendData({ type: 'match_countdown', countdown: 3 });
        }
        
        setTimeout(() => {
          // 2
          this.updateLoadingOverlay(`2`);
          if (window.isMultiplayer && window.net && window.net.p2p) {
            window.net.p2p.sendData({ type: 'match_countdown', countdown: 2 });
          }
          
          setTimeout(() => {
            // 1
            this.updateLoadingOverlay(`1`);
            if (window.isMultiplayer && window.net && window.net.p2p) {
              window.net.p2p.sendData({ type: 'match_countdown', countdown: 1 });
            }
            
            setTimeout(() => {
              // GO!
              this.updateLoadingOverlay(`GO!`);
              if (window.isMultiplayer && window.net && window.net.p2p) {
                window.net.p2p.sendData({ type: 'match_start' });
              }
              
              setTimeout(() => {
                // console.log('🏁 Match starting!');
                this.beginPlaying();
              }, 400);
            }, 1000);
          }, 1000);
        }, 1000);
      }, 100); // Small initial delay to ensure everything is settled
    }
    
    // Pause the match (broadcasts to all players in multiplayer)
    pauseMatch() {
      if (this.state !== MatchState.PLAYING) {
        console.warn('⚠️ Cannot pause - match not playing');
        return false;
      }
      
      this.isPaused = true;
      // console.log('⏸️ Match paused');
      this.updateLoadingOverlay('⏸️ PAUSED');
      
      // Broadcast pause to all players
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({ type: 'match_pause' });
      }
      
      return true;
    }
    
    // Resume the match (broadcasts to all players in multiplayer)
    resumeMatch() {
      if (!this.isPaused) {
        console.warn('⚠️ Match is not paused');
        return false;
      }
      
      this.isPaused = false;
      // console.log('▶️ Match resumed');
      
      // Hide loading overlay
      const overlay = document.getElementById('match_loading_overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
      
      // Broadcast resume to all players
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({ type: 'match_resume' });
      }
      
      return true;
    }
    
    // Toggle pause/resume
    togglePause() {
      if (this.isPaused) {
        return this.resumeMatch();
      } else {
        return this.pauseMatch();
      }
    }
    
    // Actually start gameplay (called after countdown)
    beginPlaying() {
      this.state = MatchState.PLAYING;
      this.startedAt = Date.now();
      this.tick = 0;
      this.gameTime = 0;
      
      
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
          // console.log('✅ Corrected camera position to spawn');
        } else {
          // console.log(`✅ Camera correctly positioned at spawn (distance: ${distance.toFixed(1)})`);
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
        
        // console.log(`📷 Camera controls ready - alpha: ${window.gfx.camera.alpha.toFixed(2)}, beta: ${window.gfx.camera.beta.toFixed(2)})`;
      }
      
      // Input listeners are already attached at startup - no need to re-attach
      // Re-calling initInputListeners() creates duplicate listeners which breaks input
      // console.log('🎮 Input listeners already active (not re-attaching)');
      
      // Ensure no overlays are blocking input
      const loadingOverlay = document.getElementById('match_loading_overlay');
      if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
        loadingOverlay.style.pointerEvents = 'none';
      }
      
      // Reinitialize lasso selection system
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
        // console.log('🎯 Lasso selection system reinitialized');
      }
      
      // Log player and unit info for debugging
      // console.log('🎮 Match started - Player/Unit state check:');
      // console.log(`  Player ID: ${window.player?.id}`);
      // console.log(`  Player units: ${window.player?.units?.length || 0}`);
      // console.log(`  Global gameUnits: ${window.gameUnits?.length || 0}`);
      
      if (window.player?.units && window.player.units.length > 0) {
        const firstUnit = window.player.units[0];
        // console.log(`  First unit ID: ${firstUnit.id}`);
        // console.log(`  First unit owner: ${firstUnit.owner}`);
        // console.log(`  Player ID matches: ${firstUnit.owner === window.player.id}`);
        // console.log(`  Legacy 'player' matches: ${firstUnit.owner === 'player'}`);
        // console.log(`  Can select: ${firstUnit.owner === window.player.id || firstUnit.owner === 'player'}`);
      }
      
      // Test click detection
      // console.log('🎯 Input system check:');
      // console.log(`  Lasso system: ${window.lassoSelection ? 'EXISTS' : 'MISSING'}`);
      // console.log(`  Input listeners init: ${window._inputListenersInitialized ? 'YES' : 'NO'}`);
      // console.log(`  handlePointer exists: ${window.ui?.handlePointer ? 'YES' : 'NO'}`)
      
      // Start local tick loop for non-multiplayer matches (Adventure mode, etc.)
      // In multiplayer, the network system handles ticking
      if (!window.isMultiplayer) {
        this.startLocalTickLoop();
      }
      
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
      
      // console.log(`🕒 Local match tick loop started at ${tickRate} Hz`);
    }
    
    // Stop the local tick loop if running
    stopLocalTickLoop() {
      if (this.localTickInterval) {
        clearInterval(this.localTickInterval);
        this.localTickInterval = null;
        // console.log('🕒 Local match tick loop stopped');
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
      
      // Update AI players (full AI logic including building decisions)
      // Run every 20 ticks (once per second)
      if (this.tick % 20 === 0) {
        this.updateAIPlayers();
      }
      
      // Generate AI commands (host only, deterministic based on tick)
      // Run every 20 ticks (once per second) to avoid overwhelming the command system
      if (this.tick % 20 === 0 && this.isHost()) {
        this.generateAICommands();
      }
      
      // Execute commands for this tick
      this.executeCommandsForTick(this.tick);
      
      // Check agora capture progress every tick (for smooth countdown)
      this.checkAgoraOccupation();
      
      // Check other victory conditions every second
      if (this.tick % 20 === 0) {
        this.checkWonderVictory();
        this.checkEliminationVictory();
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
      // MULTIPLAYER TUNING: Command buffer delay
      // Higher = smoother (commands arrive on time), but local input feels slightly delayed
      // Lower = more responsive locally, but more catch-up needed for remote units
      // Typical values: 2-5 ticks (40-100ms at 50Hz)
      const COMMAND_BUFFER_DELAY = 3; // Competitive but smooth - slight imposed lag for better sync
      
      const enrichedCommand = {
        ...command,
        matchId: this.id,
        playerId: command.playerId || this.localPlayerId,
        tick: this.tick + COMMAND_BUFFER_DELAY,
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
      
      // Check player is in match (normalize player IDs for comparison)
      const normalizeId = (id) => {
        if (!id) return '';
        return id.length > 6 ? id.slice(-6) : id;
      };
      
      const playerExists = this.players.some(p => {
        const playerId = p.id || p;
        return normalizeId(playerId) === normalizeId(command.playerId);
      });
      
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
          return command.buildingType && (command.gridX !== undefined) && (command.gridZ !== undefined);
        case 'train':
          return command.unitType && command.buildingId;
        case 'convert':
          return command.unitId && command.targetType;
        case 'gather':
          return command.unitIds && command.resourceId;
        case 'ability':
          return command.unitId && command.abilityType;
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
      
      // console.log(`⚙️ Tick ${tick}: Executing ${commands.length} commands`);
      
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
        case 'convert':
          this.executeConvertCommand(command);
          break;
        case 'gather':
          this.executeGatherCommand(command);
          break;
        case 'work':
          this.executeWorkCommand(command);
          break;
        case 'ability':
          this.executeAbilityCommand(command);
          break;
        case 'stop':
          this.executeStopCommand(command);
          break;
        default:
          console.warn(`⚠️ Unknown command type: ${command.type}`);
      }
    }
    
    // Command execution handlers
    executeMoveCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      
      // CRITICAL: Use last 6 chars of player ID for ownership comparison
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // MULTIPLAYER: Only create behaviors if these are OUR units
      // Remote units move via network sync, not local behaviors
      if (window.isMultiplayer) {
        const localPlayerId = window.player?.id?.slice(-6);
        if (normalizedPlayerId !== localPlayerId) {
          // This command is for remote units - skip behavior creation
          // They'll move via network position sync instead
          return;
        }
      }
      
      // Filter to only owned units
      const ownedUnits = units.filter(unit => unit.owner === normalizedPlayerId);
      
      // Single unit goes to exact point, multiple units spread out in formation
      if (ownedUnits.length === 1) {
        // Single unit - precise positioning
        const unit = ownedUnits[0];
        if (window.behaviorManager && window.WalkBehavior) {
          window.behaviorManager.setBehavior(unit, 'walk', { targetPoint: cmd.target });
        }
      } else if (ownedUnits.length > 1) {
        // Multiple units - spread them out in a formation around the target point
        const spacing = 2.5; // Distance between units
        const unitsPerRow = Math.ceil(Math.sqrt(ownedUnits.length));
        
        // Sort units deterministically by ID for consistent formation
        const sortedUnits = [...ownedUnits].sort((a, b) => a.id.localeCompare(b.id));
        
        sortedUnits.forEach((unit, index) => {
          if (window.behaviorManager && window.WalkBehavior) {
            // Calculate offset from center based on grid position
            const row = Math.floor(index / unitsPerRow);
            const col = index % unitsPerRow;
            
            const rowOffset = (row - (Math.ceil(ownedUnits.length / unitsPerRow) - 1) / 2) * spacing;
            const colOffset = (col - (unitsPerRow - 1) / 2) * spacing;
            
            const spreadTarget = {
              x: cmd.target.x + colOffset,
              y: cmd.target.y,
              z: cmd.target.z + rowOffset
            };
            
            window.behaviorManager.setBehavior(unit, 'walk', { targetPoint: spreadTarget });
          }
        });
      }
    }
    
    executeAttackCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const target = this.getUnitById(cmd.targetId);
      
      if (!target) return;
      
      // CRITICAL: Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // MULTIPLAYER: Only modify state if these are OUR units
      if (window.isMultiplayer) {
        const localPlayerId = window.player?.id?.slice(-6);
        if (normalizedPlayerId !== localPlayerId) {
          return; // Skip state modifications for remote units
        }
      }
      
      units.forEach(unit => {
        if (unit.owner === normalizedPlayerId) {
          // Set unit attack target directly for player-controlled combat
          // Don't use behaviorManager - that's for AI-controlled behaviors
          unit.target = target;
          unit.state = 'attacking';
          
          // Clear any AI behavior if this was an AI unit being manually controlled
          if (window.behaviorManager && window.behaviorManager.behaviors) {
            window.behaviorManager.behaviors.delete(unit);
          }
        }
      });
    }
    
    executeBuildCommand(cmd) {
      if (!window.placeBuilding) return;
      
      // Place building using the existing placeBuilding function
      const building = window.placeBuilding(cmd.buildingType, cmd.gridX, cmd.gridZ, window.gfx.scene);
      
      if (building) {
        // Normalize player ID for ownership
        const rawPlayerId = cmd.playerId || '';
        const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
        building.owner = normalizedPlayerId;
        
        // Apply rotation if specified
        if (cmd.rotation !== undefined) {
          building.targetRotation = cmd.rotation;
          
          // Mark building as needing mesh setup
          // This will be handled deterministically in the game loop update
          building.needsMeshSetup = true;
          building.setupStartTick = this.tick;
        }
        
        // CRITICAL: Detect resources DETERMINISTICALLY during command execution
        // This ensures both clients detect the exact same resources
        if (cmd.buildingType === 'camp' && window.buildingSystem && window.buildingSystem.checkTileForResources) {
          const workRadius = (window.BuildingTypes && window.BuildingTypes.camp && window.BuildingTypes.camp.workRadius) || 2;
          const radiusInTiles = workRadius * (window.TILE_SIZE || 4);
          
          const detectedResources = [];
          const gridRadius = Math.ceil(radiusInTiles / (window.TILE_SIZE || 4));
          
          for (let x = cmd.gridX - gridRadius; x <= cmd.gridX + gridRadius; x++) {
            for (let z = cmd.gridZ - gridRadius; z <= cmd.gridZ + gridRadius; z++) {
              const worldX = x * (window.TILE_SIZE || 4);
              const worldZ = z * (window.TILE_SIZE || 4);
              const campWorldX = cmd.gridX * (window.TILE_SIZE || 4);
              const campWorldZ = cmd.gridZ * (window.TILE_SIZE || 4);
              const distance = Math.sqrt(
                Math.pow(worldX - campWorldX, 2) + 
                Math.pow(worldZ - campWorldZ, 2)
              );
              
              if (distance <= radiusInTiles) {
                const resourceInfo = window.buildingSystem.checkTileForResources(x, z);
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
            building.availableResources = detectedResources;
            console.log(`🏗️ DETERMINISTIC: Camp at (${cmd.gridX}, ${cmd.gridZ}) detected ${detectedResources.length} resources during command execution`);
          } else {
            console.warn(`⚠️ DETERMINISTIC: Camp at (${cmd.gridX}, ${cmd.gridZ}) found NO resources during command execution`);
          }
        }
      }
    }
    
    executeTrainCommand(cmd) {
      const building = this.getBuildingById(cmd.buildingId);
      const player = this.getPlayerById(cmd.playerId);
      
      // Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      const normalizedOwner = (building?.owner || '').length > 6 ? building.owner.slice(-6) : building?.owner;
      
      if (!building || !player || normalizedOwner !== normalizedPlayerId) return;
      
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
      
      // CRITICAL: Pass owner in constructor options to ensure it's set before physics body initialization
      const unit = new window.Unit(cmd.unitType, spawnPos, { owner: normalizedPlayerId });
      
      // Debug: Verify owner was set correctly
      if (unit.owner !== normalizedPlayerId) {
        console.error(`❌ OWNER MISMATCH! Expected: ${normalizedPlayerId}, Got: ${unit.owner}, Type: ${cmd.unitType}`);
        console.error(`  playerId: ${cmd.playerId}, normalized: ${normalizedPlayerId}`);
        console.error(`  Unit ID: ${unit.id}, Position: (${spawnPos.x}, ${spawnPos.z})`);
        // Force set it again
        unit.owner = normalizedPlayerId;
      }
      
      // Deterministic rotation based on building ID, unit count, and tick
      const buildingIdHash = (building.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const unitCount = window.gameUnits?.length || 0;
      const deterministicRotation = ((buildingIdHash + unitCount + this.tick) % 628) / 100; // 0 to ~6.28 (2π)
      unit.rotation = deterministicRotation;
      if (unit.pb && unit.pb.state && unit.pb.state.rot) {
        unit.pb.state.rot.y = deterministicRotation;
      }
      
      player.units.push(unit);
      window.gameUnits.push(unit);
      
      // Spawn 3D model
      if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
        window.spawnUnitModels(window.gfx.scene);
      }
      
      // Update stats
      this.stats.unitsCreated[cmd.playerId]++;
      
      // console.log(`👤 ${player.name || normalizedPlayerId} trained ${cmd.unitType} at (${spawnPos.x}, ${spawnPos.z})`);
    }
    
    executeConvertCommand(cmd) {
      const unit = this.getUnitById(cmd.unitId);
      const player = this.getPlayerById(cmd.playerId);
      
      // Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      if (!unit || !player || unit.owner !== normalizedPlayerId) {
        // Clear converting flag if unit exists (even on failed conversions)
        if (unit) unit.isConverting = false;
        return;
      }
      
      // Only allow converting villagers for now
      if (unit.type !== 'villager') {
        console.warn(`⚠️ Cannot convert ${unit.type} to ${cmd.targetType}`);
        // Clear converting flag to prevent unit from being locked
        unit.isConverting = false;
        return;
      }
      
      // Store the old unit's CURRENT position (from physics body, not spawn position), state, and ID
      const oldPosition = unit.pb && unit.pb.state && unit.pb.state.loc 
        ? { x: unit.pb.state.loc.x, y: unit.pb.state.loc.y, z: unit.pb.state.loc.z }
        : { ...unit.position }; // Fallback to unit.position if physics body not available
      const oldRotation = unit.rotation;
      const oldMesh = unit.mesh; // Keep reference to old mesh
      const oldId = unit.id; // CRITICAL: Preserve unit ID so commands still work!
      
      // CRITICAL: Preserve the current behavior (e.g., if walking somewhere)
      const currentBehavior = window.behaviorManager?.getBehavior(unit);
      const behaviorType = currentBehavior?.constructor?.name;
      const behaviorTarget = currentBehavior?.targetPoint;
      
      // CRITICAL: Check if this unit is currently selected by the player
      const wasSelected = player.selectedUnits?.includes(unit);
      
      // CRITICAL: Remove old unit from behavior manager BEFORE creating new unit
      // This prevents desync from duplicate behaviors
      if (window.behaviorManager && window.behaviorManager.behaviors) {
        window.behaviorManager.behaviors.delete(unit);
      }
      
      // Remove from selection if selected (will add new unit back after creation)
      if (wasSelected && player.deselectUnit) {
        player.deselectUnit(unit);
      }
      
      // Remove old unit from arrays
      const unitIndex = window.gameUnits.indexOf(unit);
      if (unitIndex > -1) {
        window.gameUnits.splice(unitIndex, 1);
      }
      
      const playerUnitIndex = player.units.indexOf(unit);
      if (playerUnitIndex > -1) {
        player.units.splice(playerUnitIndex, 1);
      }
      
      // Dispose old mesh
      if (oldMesh) {
        if (oldMesh.dispose) {
          oldMesh.dispose();
        }
      }
      
      // Create new unit of target type at same position
      // CRITICAL: Pass owner AND id in constructor options so commands still reference the same unit!
      const newUnit = new window.Unit(cmd.targetType, oldPosition, { owner: normalizedPlayerId, id: oldId });
      
      // VERIFY: Double-check owner was set correctly
      if (newUnit.owner !== normalizedPlayerId) {
        // Force correct it
        newUnit.owner = normalizedPlayerId;
      }
      
      newUnit.rotation = oldRotation;
      if (newUnit.pb && newUnit.pb.state && newUnit.pb.state.rot) {
        newUnit.pb.state.rot.y = oldRotation;
      }
      
      // Add to arrays BEFORE spawning mesh (so spawnUnitModels can find it)
      player.units.push(newUnit);
      window.gameUnits.push(newUnit);
      
      // Restore behavior (keep moving if they were moving)
      // CRITICAL: Set behavior BEFORE spawning model to ensure determinism
      if (behaviorType === 'WalkBehavior' && behaviorTarget && window.behaviorManager) {
        window.behaviorManager.setBehavior(newUnit, 'walk', { targetPoint: behaviorTarget });
      } else if (window.behaviorManager) {
        // Default to linger behavior for player units
        // BUGFIX: Explicitly set center to conversion location so brigand doesn't walk back to villager spawn
        window.behaviorManager.setBehavior(newUnit, 'linger', {
          center: { x: newUnit.pb.state.loc.x, z: newUnit.pb.state.loc.z }
        });
      }
      
      // Restore selection if the old unit was selected
      if (wasSelected && player.selectUnit) {
        player.selectUnit(newUnit);
      }
      
      // Spawn 3D model for new unit (visual only, doesn't affect game state)
      if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
        window.spawnUnitModels(window.gfx.scene);
      }
      
      // Update stats
      this.stats.unitsCreated[cmd.playerId]++;
    }
    
    executeGatherCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const resource = this.getResourceById(cmd.resourceId);
      
      if (!resource) return;
      
      // CRITICAL: Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // MULTIPLAYER: Only create behaviors if these are OUR units
      if (window.isMultiplayer) {
        const localPlayerId = window.player?.id?.slice(-6);
        if (normalizedPlayerId !== localPlayerId) {
          return; // Skip behavior creation for remote units
        }
      }
      
      units.forEach(unit => {
        if (unit.owner === normalizedPlayerId) {
          // Use 'gather_work' behavior which is supported by the behavior manager
          if (window.behaviorManager) {
            window.behaviorManager.setBehavior(unit, 'gather_work', { resource: resource });
          }
        }
      });
    }
    
    executeWorkCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const building = this.getBuildingById(cmd.buildingId);
      
      if (!building) return;
      
      // CRITICAL: Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // MULTIPLAYER: Only create behaviors if these are OUR units
      if (window.isMultiplayer) {
        const localPlayerId = window.player?.id?.slice(-6);
        if (normalizedPlayerId !== localPlayerId) {
          return; // Skip behavior creation for remote units
        }
      }
      
      units.forEach(unit => {
        if (unit.owner === normalizedPlayerId) {
          // Use 'work' or 'gather_work' behavior based on building type
          if (window.behaviorManager) {
            if (building.type === 'camp' || building.type === 'farm') {
              window.behaviorManager.setBehavior(unit, 'gather_work', { building: building });
            } else {
              window.behaviorManager.setBehavior(unit, 'work', { building: building });
            }
          }
        }
      });
    }
    
    executeAbilityCommand(cmd) {
      const unit = this.getUnitById(cmd.unitId);
      
      // CRITICAL: Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      if (!unit || unit.owner !== normalizedPlayerId) return;
      
      // MULTIPLAYER: Only create behaviors if this is OUR unit
      if (window.isMultiplayer) {
        const localPlayerId = window.player?.id?.slice(-6);
        if (normalizedPlayerId !== localPlayerId) {
          return; // Skip behavior creation for remote units
        }
      }
      
      // Apply ability behavior using behavior manager
      if (window.behaviorManager && cmd.abilityType) {
        window.behaviorManager.setBehavior(unit, cmd.abilityType, cmd.params || {});
      }
    }
    
    executeStopCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      
      // CRITICAL: Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // MULTIPLAYER: Only modify behaviors/state if these are OUR units
      if (window.isMultiplayer) {
        const localPlayerId = window.player?.id?.slice(-6);
        if (normalizedPlayerId !== localPlayerId) {
          return; // Skip state modifications for remote units
        }
      }
      
      units.forEach(unit => {
        if (unit.owner === normalizedPlayerId) {
          // Clear any active behavior and set to linger (idle) state
          if (window.behaviorManager) {
            window.behaviorManager.clearBehavior(unit);
          }
          
          // Clear any attack target and reset state
          unit.target = null;
          unit.state = 'idle';
          
          // Stop any movement by zeroing impulse
          if (unit.pb && unit.pb.imp) {
            unit.pb.imp.x = 0;
            unit.pb.imp.z = 0;
          }
        }
      });
    }
    
    // Helper: Check if this client is the host
    isHost() {
      // In single-player, always consider ourselves the host
      if (!window.isMultiplayer) {
        return true;
      }
      // In multiplayer, check if our player ID matches the host ID
      return this.localPlayerId === this.hostId;
    }
    
    // Update AI players (runs full AI logic including building)
    updateAIPlayers() {
      // Find all AI players
      const aiPlayers = this.players.filter(p => {
        const player = typeof p === 'string' ? this.getPlayerById(p) : p;
        return player && player.isAI;
      });
      
      if (aiPlayers.length === 0) return;
      
      // Call updateAI for each AI player (triggers building decisions, etc.)
      aiPlayers.forEach(aiPlayerRef => {
        const aiPlayer = typeof aiPlayerRef === 'string' ? this.getPlayerById(aiPlayerRef) : aiPlayerRef;
        if (aiPlayer && aiPlayer.updateAI) {
          // deltaTime is 1 second (since we run this every 20 ticks at 20 ticks/sec)
          aiPlayer.updateAI(1.0);
        }
      });
    }
    
    // Generate AI commands (host only, runs during tick processing)
    generateAICommands() {
      // Find all AI players
      const aiPlayers = this.players.filter(p => {
        const player = typeof p === 'string' ? this.getPlayerById(p) : p;
        return player && player.isAI;
      });
      
      if (aiPlayers.length === 0) return;
      
      // For each AI player, make simple strategic decisions
      aiPlayers.forEach(aiPlayer => {
        const player = typeof aiPlayer === 'string' ? this.getPlayerById(aiPlayer) : aiPlayer;
        if (!player || !player.units || !player.id) return;
        
        // Simple AI: idle villagers gather resources
        const idleVillagers = player.units.filter(u => 
          u && u.type === 'villager' && (!u.state || u.state === 'idle') && u.mesh
        );
        
        idleVillagers.forEach(villager => {
          // Priority 1: Find nearest player-owned building (camp, farm, etc.)
          const playerBuildings = (player.buildings || []).filter(b => 
            b && b.position && (b.type === 'camp' || b.type === 'farm')
          );
          
          let nearestBuilding = null;
          let nearestBuildingDist = Infinity;
          
          playerBuildings.forEach(building => {
            const dx = building.position.x - (villager.pb?.state?.loc?.x || 0);
            const dz = building.position.z - (villager.pb?.state?.loc?.z || 0);
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < nearestBuildingDist) {
              nearestBuildingDist = dist;
              nearestBuilding = building;
            }
          });
          
          // If nearby building found, go work there
          if (nearestBuilding && nearestBuildingDist < 150) {
            this.submitCommand({
              type: 'work',
              playerId: player.id,
              unitIds: [villager.id],
              buildingId: nearestBuilding.id
            });
            return;
          }
          
          // Priority 2: Find nearest natural resource (trees, rocks, berries)
          const resources = window.resources?.resources || [];
          let nearestResource = null;
          let nearestDist = Infinity;
          
          resources.forEach(resource => {
            if (!resource || !resource.position || resource.amount <= 0) return;
            const dx = resource.position.x - (villager.pb?.state?.loc?.x || 0);
            const dz = resource.position.z - (villager.pb?.state?.loc?.z || 0);
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestResource = resource;
            }
          });
          
          // Submit gather command only if resource nearby
          if (nearestResource && nearestDist < 200) {
            this.submitCommand({
              type: 'gather',
              playerId: player.id,
              unitIds: [villager.id],
              resourceId: nearestResource.id
            });
          }
          // Otherwise stay idle near base
        });
        
        // Simple AI: Train villagers if we have resources and less than 12
        const villagerCount = player.units.filter(u => u && u.type === 'villager').length;
        if (villagerCount < 12 && player.resources && player.resources.food >= 50) {
          const agora = player.buildings?.find(b => b && b.type === 'agora');
          if (agora) {
            this.submitCommand({
              type: 'train',
              playerId: player.id,
              buildingId: agora.id,
              unitType: 'villager'
            });
          }
        }
      });
    }
    
    // Victory condition checks
    checkVictoryConditions() {
      // Skip victory checks if player chose to continue playing after match end
      if (this.victoryCheckingDisabled) {
        return;
      }
      
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
        
        // Loss condition: Player has no villagers left
        const villagers = player.units?.filter(u => u && u.type === 'villager') || [];
        if (villagers.length === 0) {
          // console.log(`💀 Player ${pid} has no villagers - eliminated!`);
          this.eliminatePlayer(pid);
          return;
        }
        
        // Traditional elimination: no units AND no buildings
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
    
    // TF2-style capture point system for Agoras
    checkAgoraOccupation() {
      const OCCUPATION_RADIUS = 5; // Tiles (tighter hitbox for agora)
      const CAPTURE_TIME = 15; // Seconds for full capture
      const CAPTURE_RATE = 100 / (CAPTURE_TIME * 20); // % per tick (at 20 ticks/sec)
      
      // Initialize capture states if not exists
      if (!this.agoraCaptureStates) {
        this.agoraCaptureStates = new Map(); // buildingId -> { owner, progress, capturing, contested }
      }
      
      this.players.forEach(player => {
        const pid = player.id || player;
        const normalizedPid = pid.length > 6 ? pid.slice(-6) : pid;
        
        if (this.eliminatedPlayers.has(pid)) {
          return; // Skip eliminated players
        }
        
        // Find this player's Agora
        const agora = player.buildings?.find(b => b && b.type === 'agora');
        if (!agora) return;
        
        const agoraKey = agora.id || `${normalizedPid}-agora`;
        const agoraTileX = agora.gridX;
        const agoraTileZ = agora.gridZ;
        
        // Initialize capture state for this agora
        if (!this.agoraCaptureStates.has(agoraKey)) {
          this.agoraCaptureStates.set(agoraKey, {
            owner: pid,
            progress: 0, // 0-100%, neutral when owner has it
            capturer: null,
            contested: false
          });
        }
        
        const captureState = this.agoraCaptureStates.get(agoraKey);
        
        // Find all units near this Agora grouped by player
        const unitsNearby = new Map(); // playerId -> unit count
        this.players.forEach(otherPlayer => {
          const otherPid = otherPlayer.id || otherPlayer;
          const normalizedOtherPid = otherPid.length > 6 ? otherPid.slice(-6) : otherPid;
          
          if (this.eliminatedPlayers.has(otherPid)) return; // Skip eliminated players
          
          let count = 0;
          otherPlayer.units?.forEach(unit => {
            if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) return;
            
            const TILE_SIZE = window.TILE_SIZE || 4;
            const unitTileX = unit.pb.state.loc.x / TILE_SIZE;
            const unitTileZ = unit.pb.state.loc.z / TILE_SIZE;
            
            const dx = unitTileX - agoraTileX;
            const dz = unitTileZ - agoraTileZ;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance <= OCCUPATION_RADIUS) {
              count++;
            }
          });
          
          if (count > 0) {
            unitsNearby.set(normalizedOtherPid, count);
          }
        });
        
        // Determine capture state with defender advantage (need 2x attackers to capture)
        const defenderCount = unitsNearby.get(normalizedPid) || 0;
        const enemyTeams = Array.from(unitsNearby.keys()).filter(p => p !== normalizedPid);
        
        if (enemyTeams.length === 0) {
          // No enemies - point is safe, decay progress back to 0
          captureState.contested = false;
          captureState.capturer = null;
          captureState.notified = false; // Reset notification flag
          captureState.contestedNotified = false; // Reset contested notification
          
          if (captureState.progress > 0) {
            captureState.progress = Math.max(0, captureState.progress - CAPTURE_RATE * 2); // Decay 2x faster
          }
          
          // Update agora visual state
          agora.contested = false;
          agora.contestedBy = null;
          agora.captureProgress = captureState.progress;
          
        } else if (enemyTeams.length === 1) {
          // One enemy team - check if they have enough units to capture
          const capturingTeam = enemyTeams[0];
          const attackerCount = unitsNearby.get(capturingTeam) || 0;
          
          // Defender blocks capture if they have at least half as many units (attacker needs 2x)
          if (defenderCount > 0 && attackerCount < defenderCount * 2) {
            // Defenders are holding the point! Contested state
            captureState.contested = true;
            captureState.capturer = null;
            
            // Notify on contested start (only once)
            if (!captureState.contestedNotified) {
              // console.log(`🛡️ Defenders are holding ${pid}'s Agora! (${defenderCount} defenders vs ${attackerCount} attackers)`);
              captureState.contestedNotified = true;
            }
            
            // Update agora visual state
            agora.contested = true;
            agora.contestedBy = 'defenders';
            agora.captureProgress = captureState.progress;
          } else {
            // Attackers have 2x advantage or no defenders - capturing!
            captureState.contested = false;
            captureState.capturer = capturingTeam;
            captureState.contestedNotified = false; // Reset contested notification
            
            // Increase capture progress
            captureState.progress = Math.min(100, captureState.progress + CAPTURE_RATE);
            
            // Update agora visual state
            agora.contested = false;
            agora.contestedBy = capturingTeam;
            agora.captureProgress = captureState.progress;
            
            // Notify on capture start (only once when it starts)
            if (captureState.progress <= CAPTURE_RATE && !captureState.notified) {
              // console.log(`🚩 Player ${capturingTeam} is capturing ${pid}'s Agora! (${attackerCount} attackers vs ${defenderCount} defenders)`);
              this.showNotification(`Your Agora is under attack!`, 'warning');
              captureState.notified = true;
            }
            
            // Check for full capture
            if (captureState.progress >= 100) {
              // console.log(`🏆 Player ${capturingTeam} captured ${pid}'s Agora!`);
              this.endMatch(capturingTeam, 'agora_capture');
            }
          }
          
        } else {
          // Multiple enemy teams - CONTESTED! (no progress)
          captureState.contested = true;
          captureState.capturer = null;
          
          // Notify on contested start (only once)
          if (!captureState.contestedNotified) {
            // console.log(`⚔️ Agora is CONTESTED by multiple teams!`);
            captureState.contestedNotified = true;
          }
          
          // Update agora visual state
          agora.contested = true;
          agora.contestedBy = 'multiple';
          agora.captureProgress = captureState.progress;
        }
      });
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
      // console.log(`💀 Player ${playerId} eliminated`);
      
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
      
      // console.log(`🏁 Match ended: ${reason}`);
      // console.log(`⏱️ Duration: ${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`);
      // console.log(`👑 Winner: ${winnerId || 'Draw'}`);
      
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
          hash ^= this.hashString(unit.type || 'unknown'); // CRITICAL: Include type to detect conversion desyncs!
          hash ^= this.hashString(unit.state || 'idle'); // Include state to detect behavior desyncs
          hash ^= Math.floor((unit.currentHealth || unit.health || 100) * 100);
          unitCount++;
        }
      });
      
      // Hash all building states (in deterministic order)
      const sortedBuildings = (window.gameBuildings || []).slice().sort((a, b) => 
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
      // if (this.tick < 300 && this.tick % 100 === 0) {
      //   console.log(`🔍 Checksum at tick ${this.tick}:`, {
      //     hash,
      //     unitCount,
      //     buildingCount,
      //     firstUnitPos: sortedUnits[0]?.pb?.state?.loc ? 
      //       `(${sortedUnits[0].pb.state.loc.x.toFixed(2)}, ${sortedUnits[0].pb.state.loc.z.toFixed(2)})` : 
      //       'none'
      //   });
      //   
      //   // DETAILED DESYNC DEBUGGING - Log all unit positions and owners
      //   console.log(`📊 Unit details at tick ${this.tick}:`);
      //   sortedUnits.slice(0, 5).forEach((unit, i) => {
      //     if (unit.pb && unit.pb.state) {
      //       console.log(`  Unit ${i}: ID=${unit.id?.slice(-6)}, owner=${unit.owner?.slice(-6)}, ` +
      //                  `pos=(${unit.pb.state.loc.x.toFixed(2)}, ${unit.pb.state.loc.z.toFixed(2)}), ` +
      //                  `type=${unit.type}, health=${unit.currentHealth || unit.health}`);
      //     }
      //   });
      //   
      // console.log(`🏛️ Building details at tick ${this.tick}:`);
      // sortedBuildings.forEach((b, i) => {
      //   console.log(`  Building ${i}: ID=${b.id?.slice(-6)}, owner=${b.owner?.slice(-6)}, ` +
      //             `pos=(${b.gridX}, ${b.gridZ}), type=${b.type}, name=${b.name}, health=${b.health}`);
      // });
      // }
      
      return hash >>> 0; // Convert to unsigned 32-bit integer
    }
    
    // Simple hash functions
    hashVector(vec) {
      // Round to 0.1 (10cm) to tolerate small floating-point differences in physics
      // This is acceptable for RTS games where precision to the centimeter doesn't matter
      return Math.floor(vec.x * 10) ^ Math.floor(vec.y * 10) ^ Math.floor(vec.z * 10);
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
      
      // Allow small differences due to floating-point rounding (< 1000 is acceptable for RTS)
      const diff = Math.abs(localChecksum - remoteChecksum);
      const TOLERANCE = 1000; // Tolerate tiny physics differences (typically < 0.01% of checksum)
      
      if (diff > TOLERANCE) {
        console.error(`❌ DESYNC DETECTED at tick ${tick}!`);
        console.error(`   Local: ${localChecksum}, Remote: ${remoteChecksum}, Difference: ${diff}`);
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
      return window.gameBuildings?.find(b => b.id === id);
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
      
      // Get victory reason text
      let reasonText = '';
      if (this.replay.reason === 'agora_capture') {
        reasonText = isVictory ? '🚩 Enemy Agora Captured!' : '🚩 Your Agora Was Captured!';
      } else if (this.replay.reason === 'elimination') {
        reasonText = isVictory ? '⚔️ All Enemies Eliminated!' : '💀 All Your Villagers Died!';
      } else if (this.replay.reason === 'time_limit') {
        reasonText = '⏱️ Time Limit Reached';
      } else if (this.replay.reason === 'wonder') {
        reasonText = '🏛️ Wonder Victory';
      } else if (this.replay.reason === 'relic') {
        reasonText = '✨ Relic Victory';
      }
      
      endScreen.innerHTML = `
        <div class="match_end_overlay">
          <div class="match_end_panel">
            <h1 class="match_end_title ${isVictory ? 'victory' : (isDraw ? 'draw' : 'defeat')}">
              ${isVictory ? '🏆 VICTORY!' : (isDraw ? '🤝 DRAW' : '💀 DEFEAT')}
            </h1>
            ${reasonText ? `<p class="match_end_reason">${reasonText}</p>` : ''}
            <div class="match_stats">
              <p>Duration: ${this.formatDuration(this.endedAt - this.startedAt)}</p>
              <p>Commands: ${this.stats.commands}</p>
            </div>
            <button class="match_end_btn" onclick="window.currentMatch.continuePlayingAfterVictory()">Continue Playing</button>
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
      const humanPlayers = this.players.filter(p => !p.isAI);
      const totalCount = humanPlayers.length; // Only count human players
      
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
      const humanPlayers = this.players.filter(p => !p.isAI);
      const totalCount = humanPlayers.length; // Only count human players
      
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
        // console.log('🎯 Loading overlay hidden and input unblocked');
      }
    }
    
    formatDuration(ms) {
      const seconds = Math.floor(ms / 1000);
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    showNotification(message, type = 'info') {
      // console.log(`📢 ${message}`);
      
      // Create notification element
      const notification = document.createElement('div');
      notification.className = `game-notification ${type}`;
      notification.textContent = message;
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 15px 30px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 18px;
        font-weight: bold;
        z-index: 9999;
        pointer-events: none;
        animation: slideDown 0.3s ease-out;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      
      // Set color based on type
      switch(type) {
        case 'warning':
          notification.style.background = 'rgba(255, 150, 0, 0.95)';
          notification.style.color = 'white';
          break;
        case 'error':
          notification.style.background = 'rgba(220, 50, 50, 0.95)';
          notification.style.color = 'white';
          break;
        case 'success':
          notification.style.background = 'rgba(50, 200, 50, 0.95)';
          notification.style.color = 'white';
          break;
        case 'defeat':
          notification.style.background = 'rgba(150, 0, 0, 0.95)';
          notification.style.color = 'white';
          break;
        default:
          notification.style.background = 'rgba(50, 150, 255, 0.95)';
          notification.style.color = 'white';
      }
      
      document.body.appendChild(notification);
      
      // Remove after 3 seconds
      setTimeout(() => {
        notification.style.animation = 'slideUp 0.3s ease-out';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }, 3000);
    }
    
    // Save replay to local storage
    saveReplay() {
      try {
        const replayKey = `replay_${this.id}`;
        const replayData = JSON.stringify(this.replay);
        
        try {
          localStorage.setItem(replayKey, replayData);
          // console.log(`💾 Replay saved: ${replayKey} (${(replayData.length / 1024).toFixed(1)} KB)`);
        } catch (quotaError) {
          // Storage quota exceeded - clean up old replays and retry
          console.warn('⚠️ Storage quota exceeded, cleaning up old replays...');
          this.cleanupOldReplays();
          
          try {
            localStorage.setItem(replayKey, replayData);
            // console.log(`💾 Replay saved after cleanup: ${replayKey}`);
          } catch (retryError) {
            // Still failed - the replay is probably too large
            console.error('❌ Replay too large to save even after cleanup');
            this.showNotification('⚠️ Replay too large to save to browser storage', 'warning');
          }
        }
      } catch (error) {
        console.error('❌ Failed to save replay:', error);
      }
    }
    
    // Clean up old replays to free storage space
    cleanupOldReplays() {
      const replayKeys = [];
      
      // Find all replay keys
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('replay_')) {
          replayKeys.push(key);
        }
      }
      
      // Sort by timestamp (newer first) and keep only the 5 most recent
      replayKeys.sort((a, b) => {
        const timeA = parseInt(a.split('-')[1]) || 0;
        const timeB = parseInt(b.split('-')[1]) || 0;
        return timeB - timeA;
      });
      
      // Remove all but the 5 most recent
      const toRemove = replayKeys.slice(5);
      toRemove.forEach(key => {
        localStorage.removeItem(key);
        // console.log(`🗑️ Removed old replay: ${key}`);
      });
      
      // console.log(`🧹 Cleaned up ${toRemove.length} old replays, kept ${Math.min(5, replayKeys.length)} recent ones`);
    }
    
    // Report match results (placeholder for server integration)
    reportMatchResults() {
      // TODO: Send to matchmaking/stats server
      // console.log('📊 Match results:', {
      //   id: this.id,
      //   winner: this.replay.winner,
      //   duration: this.replay.duration,
      //   stats: this.stats
      // });
    }
    
    // Continue playing after victory/defeat
    continuePlayingAfterVictory() {
      // console.log('🎮 Continuing to play after match end...');
      
      // Hide the end game screen
      const endScreen = document.getElementById('match_end_screen');
      if (endScreen) {
        endScreen.style.display = 'none';
      }
      
      // Disable future victory condition checks
      this.victoryCheckingDisabled = true;
      
      // Clear eliminated players list so they can keep playing
      this.eliminatedPlayers.clear();
      
      // Reset state to playing (but keep the match results saved)
      const previousState = this.state;
      this.state = MatchState.PLAYING;
      
      // Resume the tick loop if it was stopped
      if (!this.localTickInterval && !window.isMultiplayer) {
        this.startLocalTickLoop();
      }
      
      // Show a notification
      this.showNotification(`🎮 Continuing to play after ${previousState}`, 'info');
      
      // console.log('✅ Victory checking disabled - you can now play freely!');
    }
    
    // Return to menu
    returnToMenu() {
      window.location.reload();
    }
    
    // View replay
    viewReplay() {
      // console.log('🎬 Replay viewer not implemented yet');
      // TODO: Implement replay viewer
    }
  }

  // Export to window
  window.Match = Match;
  window.MatchState = MatchState;
  
  // console.log('✅ Match system initialized');

})();

