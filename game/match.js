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
      
      // DETERMINISM MODE: When true, uses very gentle corrections and relies primarily on
      // deterministic command execution. Position sync is still sent for desync DETECTION
      // with soft corrections (2% per frame) to prevent accumulation.
      this.strictDeterminism = options.strictDeterminism !== undefined ? options.strictDeterminism : true;
      
      // INPUT DELAY: Number of ticks to delay command execution (lockstep sync)
      // This ensures all peers receive commands before they execute.
      // Higher = more sync safety, but more input lag
      // 3 ticks = 150ms at 20Hz (good for ~100ms RTT)
      // 4 ticks = 200ms at 20Hz (safe for ~150ms RTT)
      this.inputDelayTicks = options.inputDelayTicks !== undefined ? options.inputDelayTicks : 3;
      
      // Command queue and history
      this.pendingCommands = []; // Commands waiting to be executed
      this.commandHistory = []; // All commands for replay
      this.commandBuffer = new Map(); // Commands per tick per player
      this.localTickInterval = null; // Offline tick loop handle
      
      // Synchronization
      this.checksums = new Map(); // Tick -> checksum for desync detection
      this.lastSyncTick = 0;
      this.syncInterval = 50; // Check sync every 50 ticks (2.5 seconds at 20Hz) - more frequent for smoother sync
      this.desyncDetected = false;
      
      // Tick synchronization tracking
      this.peerTickHistory = new Map(); // peerId -> array of {tick, receivedAt, localTick}
      this.tickSyncAdjustment = 0; // Adjustment to apply to tick rate (in ms)
      
      // CRITICAL: Queue for pending resource decrements to batch at sync checkpoints
      // This ensures both clients apply decrements at the same tick, preventing desyncs
      this.pendingResourceDecrements = []; // Array of {buildingId, gridX, gridZ, amount}
      
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
      
      // Deterministic unit counter for multiplayer sync
      // This ensures unit IDs and rotations are consistent across clients
      this.unitCounter = 0;
      
      // Deterministic building counter for multiplayer sync
      // This ensures building IDs are consistent across clients
      this.buildingCounter = 0;
      
      // Initialize stats for each player
      this.players.forEach(player => {
        const pid = player.id || player;
        this.stats.unitsCreated[pid] = 0;
        this.stats.unitsLost[pid] = 0;
        this.stats.buildingsCreated[pid] = 0;
        this.stats.buildingsDestroyed[pid] = 0;
        this.stats.resourcesGathered[pid] = { food: 0, wood: 0, stone: 0, minerals: 0 };
        this.stats.damageDealt[pid] = 0;
        this.stats.damageReceived[pid] = 0;
      });
      
      // Replay data
      this.replay = {
        version: '1.1',
        matchId: this.id,
        gameType: this.gameType,
        mapSeed: this.mapSeed,
        fieldSize: window.liveField?.width || 64, // Store field size for replay
        players: this.players.map(p => ({ 
          id: p.id || p, 
          name: p.name || 'Unknown',
          color: p.color || null
        })),
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
      console.log('⏱️ Host starting countdown (3-2-1-GO)…');
      
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
                console.log('🚀 Host broadcasting match_start to all peers');
                window.net.p2p.sendData({ type: 'match_start' });
              }
              
              setTimeout(() => {
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
      
      // CRITICAL: Reset network tick counter so both players start at tick 0
      // This is essential for lockstep synchronization
      if (window.net && window.net.resetForMatchStart) {
        window.net.resetForMatchStart();
      }
      
      // CRITICAL: Initialize deterministic RNG with map seed for this match
      // All random operations during the match MUST use this RNG
      if (window.Determinism && window.Determinism.initMatchRng) {
        window.Determinism.initMatchRng(this.mapSeed);
        console.log(`🎲 Match RNG initialized with seed: ${this.mapSeed}`);
      }
      
      // CRITICAL: Reset physics time accumulator to prevent catch-up at match start
      // Physics catch-up during loading causes units to be in different positions
      // when the match begins, leading to immediate desync
      if (window.gameLoop && window.gameLoop.physicsTime !== undefined) {
        window.gameLoop.physicsTime = 0;
        window.gameLoop.lastTime = performance.now(); // Reset timing reference
      }
      
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
        if (!Number.isFinite(window.gfx.camera.beta)) window.gfx.camera.beta = 1.1;
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
      
      // CRITICAL: Handle tab visibility changes
      // When tab loses focus, browsers throttle requestAnimationFrame
      // Do NOT catch up when tab regains focus - this causes desync!
      // Visual interpolation will smooth out any visual jitter.
      if (!this._visibilityHandlerAdded) {
        this._visibilityHandlerAdded = true;
        this._tabHiddenTime = null;
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            // Tab hidden - record the time
            this._tabHiddenTime = performance.now();
          } else {
            // Tab visible again - do NOT catch up (causes desync)
            if (this._tabHiddenTime !== null && window.gameLoop) {
              const missedTime = (performance.now() - this._tabHiddenTime) / 1000;
              
              if (missedTime > 0.5) {
                console.log(`🔄 Tab refocused after ${missedTime.toFixed(2)}s - NOT catching up (determinism)`);
              }
              // Reset physics time to prevent any accumulated backlog
              // Visual interpolation will smooth the transition
              window.gameLoop.physicsTime = 0;
              window.gameLoop.lastTime = performance.now();
              this._tabHiddenTime = null;
            }
          }
        });
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
      // CRITICAL: Only host runs AI logic in multiplayer - AI decisions go through command system
      // Clients receive and execute AI commands via network, ensuring deterministic behavior
      // Run every 20 ticks (once per second)
      if (this.tick % 20 === 0 && (!window.isMultiplayer || this.isHost())) {
        this.updateAIPlayers();
      }
      
      // Generate AI commands (host only for AI opponents, but deterministic)
      // P2P: For human vs human, this doesn't run (no AI players)
      // Run every 20 ticks (once per second) to avoid overwhelming the command system
      if (this.tick % 20 === 0 && this.isHost()) {
        const aiCommandCount = this.generateAICommands();
        if (aiCommandCount > 0 && this.tick % 100 === 0) { // Log every 5 seconds
          console.log(`🤖 Host generated ${aiCommandCount} AI command(s) at tick ${this.tick}`);
        }
      }
      
      // Execute commands for this tick
      this.executeCommandsForTick(this.tick);
      
      // CRITICAL: Check agora capture at fixed intervals (not every tick)
      // This ensures both clients check at the same time with synchronized positions
      // Checking every tick causes desyncs due to position drift between clients
      if (this.tick % 20 === 0) { // Check once per second for deterministic capture
        this.checkAgoraOccupation();
      }
      
      // Check other victory conditions every second
      if (this.tick % 20 === 0) {
        this.checkWonderVictory();
        this.checkEliminationVictory();
      }
      
      // Synchronization checkpoint with adaptive frequency
      // During active construction or movement, sync more frequently to prevent drift
      // CRITICAL: In 3+ player games, sync more aggressively to prevent large position errors
      const connectedPeers = window.net?.p2p?.getConnectedPeers() || [];
      const playerCount = 1 + connectedPeers.length; // Local player + connected peers
      const isMultiPlayerGame = playerCount >= 3;
      
      const hasActiveConstruction = window.gameBuildings?.some(b => 
        b.needsWorkers && b.workType === 'build' && b.buildProgress < 1.0 && b.assignedWorkers?.length > 0
      );
      
      // Check if units are actively moving (have velocity or active behaviors)
      const hasActiveMovement = window.gameUnits?.some(u => {
        if (!u.pb || !u.pb.state) return false;
        const hasVelocity = u.pb.state.vel && (Math.abs(u.pb.state.vel.x) > 0.1 || Math.abs(u.pb.state.vel.z) > 0.1);
        const hasBehavior = window.behaviorManager && window.behaviorManager.getBehavior(u);
        return hasVelocity || hasBehavior;
      });
      
      // Use faster sync interval during active gameplay
      // CRITICAL: In 3+ player games, use even more aggressive sync (15 ticks = 0.75s) to prevent drift
      const activeSyncInterval = isMultiPlayerGame ? 15 : 25; // 0.75s for 3+, 1.25s for 1v1
      const currentSyncInterval = (hasActiveConstruction || hasActiveMovement) ? activeSyncInterval : this.syncInterval;
      
      if (this.tick % currentSyncInterval === 0) {
        // CRITICAL: Process pending resource decrements at sync checkpoint
        // This ensures both clients apply decrements at the same tick, preventing desyncs
        this.processPendingResourceDecrements();
        // CRITICAL: Process pending resource depletions at sync checkpoint
        // This ensures both clients mark depletion at the same tick
        this.processPendingResourceDepletions();
        
        // CRITICAL: Sync resource states at checkpoint BEFORE checksum calculation
        // This ensures both clients have identical resource states when checksumming
        this.syncResourceStatesAtCheckpoint();
        
        // CRITICAL: P2P Position Sync - Each player is authoritative for their own units
        // At checkpoints, broadcast your unit positions to other players
        // Accept other players' positions for units they own
        // This prevents floating-point drift while keeping P2P fairness
        this.syncUnitPositionsAtCheckpoint();
        
        // CRITICAL: Track this checkpoint and wait for position syncs to arrive before checksumming
        // Initialize pending syncs tracker if needed
        if (!this.pendingPositionSyncs) {
          this.pendingPositionSyncs = new Set();
        }
        
        // Mark that we're waiting for position syncs from all peers
        const connectedPeers = window.net?.p2p?.getConnectedPeers() || [];
        this.pendingPositionSyncs.clear();
        connectedPeers.forEach(peerId => {
          this.pendingPositionSyncs.add(peerId);
        });
        this.pendingPositionSyncTick = this.tick;
        
        // CRITICAL: Wait for position syncs with adaptive timeout based on network latency
        // Use longer delay if we detected lag earlier (up to 200ms for high latency)
        const baseDelay = 100; // Base 100ms delay
        const maxPeerLag = window.net?.getPeerLag ? Object.values(window.net.getPeerLag()).reduce((max, lag) => Math.max(max, lag.lag || 0), 0) : 0;
        const adaptiveDelay = baseDelay + (maxPeerLag * 10); // Add 10ms per tick of lag
        const finalDelay = Math.min(adaptiveDelay, 300); // Cap at 300ms
        
        const checkpointTick = this.tick;
        setTimeout(() => {
          if (this.tick === checkpointTick) { // Still at same checkpoint (haven't advanced past it)
            // If we're still waiting for syncs, wait a bit more
            if (this.pendingPositionSyncs && this.pendingPositionSyncs.size > 0) {
              // Wait another 100ms for late syncs
              setTimeout(() => {
                if (this.tick === checkpointTick) {
                  this.createSyncCheckpoint();
                }
              }, 100);
            } else {
              this.createSyncCheckpoint();
            }
          }
        }, finalDelay);
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
      // MULTIPLAYER LOCKSTEP: Input delay ensures commands arrive at all peers before execution
      // This is the classic RTS solution (StarCraft, Age of Empires) for deterministic sync.
      // 
      // At 20Hz network tick rate (50ms per tick):
      // - 3 ticks = 150ms delay (good for ~100ms RTT)
      // - 4 ticks = 200ms delay (safe for ~150ms RTT)
      //
      // The delay feels responsive because:
      // 1. Visual feedback (selection, path preview) is instant
      // 2. Only the actual unit movement is delayed
      // 3. 150ms is within human perception threshold for "immediate"
      const isPlayerCommand = command.type === 'move' || command.type === 'attack' || command.type === 'ability';
      const commandDelay = isPlayerCommand ? this.inputDelayTicks : (this.inputDelayTicks + 1);
      
      const enrichedCommand = {
        ...command,
        matchId: this.id,
        playerId: command.playerId || this.localPlayerId,
        tick: this.tick + commandDelay, // CRITICAL: Commands execute based on tick, not timestamp
        timestamp: Date.now(), // Metadata only - NOT used for scheduling or execution timing
        commandId: this.generateCommandId(),
        priority: isPlayerCommand ? 'high' : 'normal' // Mark priority for network layer
      };
      
      // Debug: log gather/work commands (disabled for cleaner console)
      // if (command.type === 'gather' || command.type === 'work') {
      //   console.log(`📝 submitCommand`, {
      //     type: command.type,
      //     unitIds: command.unitIds,
      //     scheduledTick: enrichedCommand.tick,
      //     currentTick: this.tick
      //   });
      // }
      
      // Validate command
      if (!this.validateCommand(enrichedCommand)) {
        console.warn('⚠️ Invalid command:', enrichedCommand);
        return false;
      }
      
      // CRITICAL: Deduplicate move commands - if there are already pending move commands
      // for the same units, remove the older ones and only keep the latest
      // This prevents jerky movement from processing intermediate commands
      if (command.type === 'move' && command.unitIds && command.unitIds.length > 0) {
        // Find and remove older move commands for the same units
        const unitIdSet = new Set(command.unitIds);
        
        // Check pending commands
        this.pendingCommands = this.pendingCommands.filter(cmd => {
          // Keep non-move commands
          if (cmd.type !== 'move') return true;
          // Keep move commands for different units
          if (!cmd.unitIds || cmd.unitIds.length === 0) return true;
          // Remove if any unit IDs overlap (same units, newer command wins)
          const hasOverlap = cmd.unitIds.some(id => unitIdSet.has(id));
          return !hasOverlap;
        });
        
        // Check command buffer (commands scheduled for future ticks)
        this.commandBuffer.forEach((commands, tickKey) => {
          const filteredCommands = commands.filter(cmd => {
            // Keep non-move commands
            if (cmd.type !== 'move') return true;
            // Keep move commands for different units
            if (!cmd.unitIds || cmd.unitIds.length === 0) return true;
            // Remove if any unit IDs overlap (same units, newer command wins)
            const hasOverlap = cmd.unitIds.some(id => unitIdSet.has(id));
            return !hasOverlap;
          });
          
          // Update the buffer with filtered commands
          if (filteredCommands.length !== commands.length) {
            if (filteredCommands.length > 0) {
              this.commandBuffer.set(tickKey, filteredCommands);
            } else {
              this.commandBuffer.delete(tickKey);
            }
          }
        });
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
      // CRITICAL: Player commands sent immediately (high priority)
      // Background commands can be batched/deferred
      if (window.isMultiplayer && window.net && window.net.p2p) {
        // Update last player command time for LOD sync frequency
        if (isPlayerCommand && window.net.updateLastPlayerCommandTime) {
          window.net.updateLastPlayerCommandTime();
        }
        
        // Send immediately with acknowledgment request for player commands
        const message = {
          type: 'game_command',
          command: enrichedCommand,
          requestAck: isPlayerCommand // Request acknowledgment for player commands
        };
        
        window.net.p2p.sendData(message);
        
        // Track command for acknowledgment if requested
        if (isPlayerCommand && window.net.trackCommandAck) {
          window.net.trackCommandAck(enrichedCommand.commandId, enrichedCommand);
        }
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
      // Log gather/work commands for debugging
      if (command.type === 'gather' || command.type === 'work') {
        console.log(`✅ executeCommand`, {
          type: command.type,
          unitIds: command.unitIds,
          scheduledTick: command.tick,
          executingTick: this.tick
        });
      }
      
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
        case 'building_complete':
          this.executeBuildingCompleteCommand(command);
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
      
      // P2P DETERMINISTIC: Both clients execute ALL commands for deterministic simulation
      // Filter to only owned units (security check)
      const ownedUnits = units.filter(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        const matches = unitOwnerId === normalizedPlayerId;
        
        // Debug logging for 3+ player games when units don't match
        if (!matches && window.isMultiplayer && window.net && window.net.p2p) {
          const connectedPeers = window.net.p2p.getConnectedPeers();
          if (connectedPeers.length >= 2 && Math.random() < 0.1) { // Log 10% of mismatches
            console.warn(`⚠️ [3+ PLAYER] Unit ${unit.id?.slice(-4)} owner mismatch: unit.owner="${unitOwnerId}" vs cmd.playerId="${normalizedPlayerId}" (raw: "${rawPlayerId}")`);
          }
        }
        
        return matches;
      });
      
      // Debug logging for 3+ player games
      if (ownedUnits.length === 0 && units.length > 0 && window.isMultiplayer && window.net && window.net.p2p) {
        const connectedPeers = window.net.p2p.getConnectedPeers();
        if (connectedPeers.length >= 2 && Math.random() < 0.2) { // Log 20% of cases
          console.warn(`⚠️ [3+ PLAYER] No owned units found for player ${normalizedPlayerId}! Requested ${units.length} units, found 0. Command: ${cmd.type}, tick: ${cmd.tick}`);
        }
      }
      
      // CRITICAL: Smooth position correction instead of instant snap
      // We store the authoritative start position as a "correction target"
      // The unit will smoothly lerp towards this position while also moving to destination
      // This prevents jarring teleports while still keeping clients synchronized
      if (cmd.startPositions) {
        ownedUnits.forEach(unit => {
          const authoritativePos = cmd.startPositions[unit.id];
          if (authoritativePos && unit.pb && unit.pb.state && unit.pb.state.loc) {
            // Calculate position error (how far off we are)
            const errorX = authoritativePos.x - unit.pb.state.loc.x;
            const errorZ = authoritativePos.z - unit.pb.state.loc.z;
            const errorDistance = Math.sqrt(errorX * errorX + errorZ * errorZ);
            
            // CRITICAL: In 3+ player games, units can drift more due to network latency
            // Use higher threshold for "catastrophic" errors (50 units instead of 20)
            const connectedPeers = window.net?.p2p?.getConnectedPeers() || [];
            const playerCount = 1 + connectedPeers.length;
            const isMultiPlayerGame = playerCount >= 3;
            const catastrophicThreshold = isMultiPlayerGame ? 50 : 20; // Higher threshold for 3+ players
            
            // Only correct if error is significant (> 0.3 units) but not catastrophic
            // Small errors ignore (noise), huge errors snap immediately (missed command)
            if (errorDistance > 0.3 && errorDistance < catastrophicThreshold) {
              // CRITICAL: Don't apply startPositions corrections during active movement
              // The movement command will handle positioning - corrections would fight with it
              // Only apply corrections if unit is idle (no active movement behavior)
              const hasActiveBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
              const behaviorType = hasActiveBehavior ? hasActiveBehavior.constructor?.name : null;
              const isMovementBehavior = behaviorType === 'WalkBehavior' || behaviorType === 'RunBehavior';
              
              if (!isMovementBehavior) {
                // Unit is idle - apply gentle correction (reduced strength to prevent speedups)
                // Max strength is 0.2 (20% per frame) to ensure units don't speed up
                const maxStrength = 0.2; // Cap at 20% per frame to prevent speedups
                const baseStrength = 0.15; // Base strength (reduced from 0.2-0.3)
                const correctionStrength = Math.min(baseStrength + (errorDistance * 0.005), maxStrength);
                unit._positionCorrection = {
                  targetX: authoritativePos.x,
                  targetZ: authoritativePos.z,
                  strength: correctionStrength // Reduced strength to prevent speedups
                };
                // DON'T update visual position immediately - let correction system handle it smoothly
                // This prevents the "jump forward then jump back" issue
              } else {
                // Unit is actively moving - cancel any existing corrections
                // The movement command will handle positioning correctly
                delete unit._positionCorrection;
              }
            } else if (errorDistance >= catastrophicThreshold) {
              // Catastrophic desync - snap immediately (both physics and visual)
              unit.pb.state.loc.x = authoritativePos.x;
              unit.pb.state.loc.z = authoritativePos.z;
              if (unit.visualPosition) {
                unit.visualPosition.x = authoritativePos.x;
                unit.visualPosition.z = authoritativePos.z;
              }
              // Only warn for truly catastrophic errors (> 50 units in 3+ player games)
              if (errorDistance > (isMultiPlayerGame ? 50 : 20)) {
                console.warn(`⚠️ Large position error (${errorDistance.toFixed(1)} units) - snapped unit ${unit.id.slice(-4)}`);
              }
            }
            // Small errors (< 0.3 units) - ignore, checkpoint sync will handle it
          }
        });
      }
      
      // CRITICAL: When manually moving units, remove them from any building's worker list
      // This prevents them from being stuck in gather/build behaviors
      ownedUnits.forEach(unit => {
        if (window.gameBuildings) {
          window.gameBuildings.forEach(building => {
            if (building.assignedWorkers) {
              const workerIndex = building.assignedWorkers.indexOf(unit);
              if (workerIndex !== -1) {
                building.assignedWorkers.splice(workerIndex, 1);
                // console.log(`🚶 Removed ${unit.type} from ${building.name} worker list (manual move)`);
              }
            }
          });
        }
      });
      
      // CRITICAL: Smart behavior transition - check if unit is already moving
      // If moving in similar direction, don't reset rotation/velocity (smooth transition)
      ownedUnits.forEach(unit => {
        // Check if unit is already moving before clearing behavior
        const currentBehavior = window.behaviorManager ? window.behaviorManager.getBehavior(unit) : null;
        const wasMoving = currentBehavior && 
          (currentBehavior.constructor.name === 'WalkBehavior' || currentBehavior.constructor.name === 'RunBehavior');
        
        let shouldResetRotation = true;
        if (wasMoving && unit.pb && unit.pb.state && unit.pb.state.vel) {
          // Unit is already moving - check if new target is similar direction
          const currentVelX = unit.pb.state.vel.x || 0;
          const currentVelZ = unit.pb.state.vel.z || 0;
          const currentSpeed = Math.sqrt(currentVelX * currentVelX + currentVelZ * currentVelZ);
          
          if (currentSpeed > 0.1 && cmd.target) {
            // Calculate direction to new target
            const currentPos = unit.pb.state.loc;
            const dx = cmd.target.x - currentPos.x;
            const dz = cmd.target.z - currentPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance > 0.1) {
              // Normalize directions
              const newDirX = dx / distance;
              const newDirZ = dz / distance;
              const currentDirX = currentVelX / currentSpeed;
              const currentDirZ = currentVelZ / currentSpeed;
              
              // Check if directions are similar (dot product > 0.7, ~45 degrees)
              const dotProduct = currentDirX * newDirX + currentDirZ * newDirZ;
              if (dotProduct > 0.7) {
                // Similar direction - don't reset rotation for smooth transition
                shouldResetRotation = false;
              }
            }
          }
        }
        
        // Clear any existing behavior immediately
        if (window.behaviorManager && window.behaviorManager.behaviors) {
          window.behaviorManager.behaviors.delete(unit);
        }
        
        // CRITICAL: Clear special ability modifiers (wizard_cast, monk_stealth, etc.) when moving
        // These modifiers can interfere with movement if left active
        // Special modifiers are stored on the unit, not in the behavior map
        if (unit._specialModifiers) {
          // Clear all active modifiers - movement commands should override ability usage
          Object.keys(unit._specialModifiers).forEach(modifierType => {
            const modifier = unit._specialModifiers[modifierType];
            if (modifier && modifier.onReassignment) {
              modifier.onReassignment();
            }
            delete unit._specialModifiers[modifierType];
          });
        }
        
        // Only reset rotation if direction changed significantly
        if (shouldResetRotation) {
          if (unit.pb && !unit.pb.rotVel) unit.pb.rotVel = { x: 0, y: 0, z: 0 };
          if (unit.pb && unit.pb.rotVel) {
            unit.pb.rotVel.y = 0;
          }
        }
      });
      
      // Single unit goes to exact point, multiple units spread out in formation
      if (ownedUnits.length === 1) {
        // Single unit - precise positioning
        const unit = ownedUnits[0];
        if (window.behaviorManager && window.WalkBehavior) {
          // CRITICAL: Clear any position corrections when starting movement
          // Movement commands should override corrections - don't let them fight
          delete unit._positionCorrection;
          
          // CRITICAL: Mark this as a player move command so auto-assignment doesn't immediately grab them
          const currentTick = this.tick || 0;
          unit.lastPlayerMoveTick = currentTick;
          
          window.behaviorManager.setBehavior(unit, 'walk', { targetPoint: cmd.target });
          
          // If this is a monk, check for nearby units to kick when starting movement
          if (unit.type === 'monk' && window.maybeAutoMonkKick) {
            // Reset periodic kick timer so periodic kicks start fresh
            unit._lastPeriodicKick = 0;
            window.maybeAutoMonkKick(unit, true); // forceCheck = true to kick immediately on command
          }
        }
      } else if (ownedUnits.length > 1) {
        // Multiple units - spread them out in a formation around the target point
        const spacing = 2.5; // Distance between units
        const unitsPerRow = Math.ceil(Math.sqrt(ownedUnits.length));
        
        // Sort units deterministically by ID for consistent formation
        const sortedUnits = [...ownedUnits].sort((a, b) => a.id.localeCompare(b.id));
        
        sortedUnits.forEach((unit, index) => {
          if (window.behaviorManager && window.WalkBehavior) {
            // CRITICAL: Mark this as a player move command so auto-assignment doesn't immediately grab them
            const currentTick = this.tick || 0;
            unit.lastPlayerMoveTick = currentTick;
            
            // Calculate offset from center based on grid position
            const row = Math.floor(index / unitsPerRow);
            const col = index % unitsPerRow;
            
            // CRITICAL: Round formation offsets to ensure deterministic results
            // This prevents floating-point differences from causing units to converge
            const rowOffset = Math.round(((row - (Math.ceil(ownedUnits.length / unitsPerRow) - 1) / 2) * spacing) * 100) / 100;
            const colOffset = Math.round(((col - (unitsPerRow - 1) / 2) * spacing) * 100) / 100;
            
            // CRITICAL: Round final target position to ensure determinism
            // Each unit gets a unique target based on their deterministic index
            const spreadTarget = {
              x: Math.round((cmd.target.x + colOffset) * 100) / 100,
              y: cmd.target.y,
              z: Math.round((cmd.target.z + rowOffset) * 100) / 100
            };
            
            // CRITICAL: Clear any position corrections when starting movement
            // Movement commands should override corrections - don't let them fight
            delete unit._positionCorrection;
            
            // CRITICAL: Each unit gets their own unique target - no sharing!
            // The personalityOffset in WalkBehavior will add further variation within the formation cell
            window.behaviorManager.setBehavior(unit, 'walk', { targetPoint: spreadTarget });
            
            // If this is a monk, check for nearby units to kick when starting movement
            if (unit.type === 'monk' && window.maybeAutoMonkKick) {
              // Reset periodic kick timer so periodic kicks start fresh
              unit._lastPeriodicKick = 0;
              window.maybeAutoMonkKick(unit, true); // forceCheck = true to kick immediately on command
            }
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
      
      // P2P DETERMINISTIC: Execute all commands on both clients
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId === normalizedPlayerId) {
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
      
      // Get player and check/deduct resources
      const player = this.getPlayerById(cmd.playerId);
      if (!player) {
        console.warn(`⚠️ Build command from unknown player: ${cmd.playerId}`);
        return;
      }
      
      const cost = this.getBuildingCost(cmd.buildingType);
      
      // CRITICAL: Increment building counter FIRST (even if command fails) to keep counters in sync!
      // This prevents building ID desync when one client can't afford but the other can
      const buildingIndex = this.buildingCounter++;
      const deterministicBuildingId = `building-${this.mapSeed}-${buildingIndex}`;
      
      
      // Check if player can afford it (AFTER counter increment!)
      if (!this.canAfford(player, cost)) {
        console.log(`❌ ${player.name || player.id} cannot afford ${cmd.buildingType} (needs: wood=${cost.wood || 0}, stone=${cost.stone || 0}, has: wood=${player.resources.wood || 0}, stone=${player.resources.stone || 0}) - Counter still incremented to ${buildingIndex} to prevent desync`);
        // Counter was incremented above to keep both clients in sync
        // Even though building wasn't placed, the next building will have the same ID on both clients
        return;
      }
      
      // Deduct resources BEFORE placing building
      this.deductResources(player, cost);
      
      // Normalize player ID for ownership BEFORE placing
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // Place building using the existing placeBuilding function
      // Pass deterministic ID and owner to ensure consistent building IDs across clients
      const building = window.placeBuilding(cmd.buildingType, cmd.gridX, cmd.gridZ, window.gfx.scene, {
        id: deterministicBuildingId,
        gridX: cmd.gridX,
        gridZ: cmd.gridZ,
        owner: normalizedPlayerId
      });
      
      if (building) {
        // Ensure owner is set (may have been set in constructor via options)
        building.owner = normalizedPlayerId;
        
        // Store team color so attached flag meshes can tint correctly
        if (typeof window.getTeamColorForOwner === 'function') {
          building.teamColor = window.getTeamColorForOwner(building.owner);
        }
        
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
          // Use productionWorkRadius (7) for resource detection, not workRadius (15) which is for construction
          const productionWorkRadius = (window.BuildingTypes && window.BuildingTypes.camp && window.BuildingTypes.camp.productionWorkRadius) || 7;
          const radiusInTiles = productionWorkRadius * (window.TILE_SIZE || 4);
          
          const detectedResources = [];
          const gridRadius = Math.ceil(radiusInTiles / (window.TILE_SIZE || 4));
          
          // Get field boundaries for validation
          const field = window.liveField;
          const fieldWidth = field?.width || 0;
          const fieldHeight = field?.height || 0;
          
          for (let x = cmd.gridX - gridRadius; x <= cmd.gridX + gridRadius; x++) {
            for (let z = cmd.gridZ - gridRadius; z <= cmd.gridZ + gridRadius; z++) {
              // CRITICAL: Skip coordinates outside map boundaries to prevent villagers from trying to walk off the table
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
              
              const worldX = x * (window.TILE_SIZE || 4);
              const worldZ = z * (window.TILE_SIZE || 4);
              const campWorldX = cmd.gridX * (window.TILE_SIZE || 4);
              const campWorldZ = cmd.gridZ * (window.TILE_SIZE || 4);
              const distance = Math.sqrt(
                Math.pow(worldX - campWorldX, 2) + 
                Math.pow(worldZ - campWorldZ, 2)
              );
              
              if (distance <= radiusInTiles) {
                // CRITICAL: Pass ignoreDepletion=true for new camp detection
                // This ensures deterministic detection based on map generation, not current depletion state
                // Depletion state can differ between clients, causing desyncs
                const resourceInfo = window.buildingSystem.checkTileForResources(x, z, true);
                if (resourceInfo) {
                  // CRITICAL: Use gridX/gridZ from resourceInfo if available, otherwise use loop variables
                  // This ensures consistency if checkTileForResources returns different coordinates
                  const finalGridX = resourceInfo.gridX !== undefined ? resourceInfo.gridX : x;
                  const finalGridZ = resourceInfo.gridZ !== undefined ? resourceInfo.gridZ : z;
                  
                  detectedResources.push({
                    gridX: finalGridX,
                    gridZ: finalGridZ,
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
            // CRITICAL: Sort resources for deterministic order on both clients
            detectedResources.sort((a, b) => {
              if (a.gridX !== b.gridX) return a.gridX - b.gridX;
              return a.gridZ - b.gridZ;
            });
            building.availableResources = detectedResources;
            // CRITICAL: Store original resource count for deterministic selection
            // Workers select resources based on original count, not current count after depletion
            building.originalResourceCount = detectedResources.length;
          } else {
            building.originalResourceCount = 0;
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
      
      // CRITICAL: Increment unit counter BEFORE creating unit to ensure deterministic ID
      // This ensures both clients generate the same ID and rotation
      const unitIndex = this.unitCounter++;
      const deterministicUnitId = `unit-${this.mapSeed}-${unitIndex}`;
      
      // CRITICAL: Add deterministic spawn offset to prevent units from stacking
      // Use building ID hash, unit index, and tick for consistent offsets across clients
      const buildingIdHash = (building.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      
      // Generate deterministic angle and distance for spawn offset
      // Use unitIndex to ensure each unit spawns at a different position
      const angleSeed = (buildingIdHash + unitIndex + this.tick * 7) % 628;
      const angle = angleSeed / 100; // 0 to ~6.28 (2π)
      
      // Spawn in a circle around the building (radius ~2.5 tiles for more spread)
      const spawnRadius = TILE_SIZE * 2.5;
      const distanceSeed = (buildingIdHash + unitIndex * 3 + this.tick * 11) % 1000;
      const distance = (distanceSeed / 1000) * spawnRadius;
      
      const offsetX = Math.cos(angle) * distance;
      const offsetZ = Math.sin(angle) * distance;
      
      // Create unit at building location with deterministic offset
      const spawnPos = {
        x: building.gridX * TILE_SIZE + offsetX,
        y: 0,
        z: building.gridZ * TILE_SIZE + offsetZ
      };
      
      // Deterministic rotation based on building ID, unit counter, and tick
      const deterministicRotation = ((buildingIdHash + unitIndex + this.tick) % 628) / 100; // 0 to ~6.28 (2π)
      
      // CRITICAL: Pass owner and ID in constructor options to ensure deterministic creation
      // CRITICAL: Always pass id explicitly (even if undefined) to prevent Unit constructor from incrementing counter
      const unit = new window.Unit(cmd.unitType, spawnPos, { 
        owner: normalizedPlayerId,
        id: deterministicUnitId || undefined
      });
      
      // Set rotation after creation
      unit.rotation = deterministicRotation;
      if (unit.pb && unit.pb.state && unit.pb.state.rot) {
        unit.pb.state.rot.y = deterministicRotation;
      }
      
      // Debug: Verify owner was set correctly
      if (unit.owner !== normalizedPlayerId) {
        console.error(`❌ OWNER MISMATCH! Expected: ${normalizedPlayerId}, Got: ${unit.owner}, Type: ${cmd.unitType}`);
        console.error(`  playerId: ${cmd.playerId}, normalized: ${normalizedPlayerId}`);
        console.error(`  Unit ID: ${unit.id}, Position: (${spawnPos.x}, ${spawnPos.z})`);
        // Force set it again
        unit.owner = normalizedPlayerId;
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
      
      // P2P DETERMINISTIC: Execute all commands on both clients
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId === normalizedPlayerId) {
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
      
      // P2P DETERMINISTIC: Execute all commands on both clients
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId === normalizedPlayerId) {
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
    
    executeBuildingCompleteCommand(cmd) {
      const building = this.getBuildingById(cmd.buildingId);
      if (!building) {
        console.warn(`⚠️ Building complete command for unknown building: ${cmd.buildingId}`);
        return;
      }
      
      // CRITICAL: Process completion synchronously across all peers
      // This ensures all clients complete the building at exactly the same tick
      if (window.processBuildingCompletion) {
        window.processBuildingCompletion(building);
      } else {
        // Fallback: manually set completion state
        building.buildProgress = 1.0;
        building.completionProcessed = true;
      }
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
      
      // P2P DETERMINISTIC: Execute all commands on both clients
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId === normalizedPlayerId) {
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
    
    // Update AI players (runs full AI logic including building decisions)
    // NOTE: Works for both local AI opponents and true multiplayer with AI
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
      
      if (aiPlayers.length === 0) return 0;
      
      let commandCount = 0;
      
      // For each AI player, make simple strategic decisions
      aiPlayers.forEach(aiPlayer => {
        const player = typeof aiPlayer === 'string' ? this.getPlayerById(aiPlayer) : aiPlayer;
        if (!player || !player.units || !player.id) return;
        
        // Simple AI: idle villagers gather resources
        const idleVillagers = player.units.filter(u => 
          u && u.type === 'villager' && (!u.state || u.state === 'idle') && u.mesh
        );
        
        idleVillagers.forEach(villager => {
          // Priority 1: Find nearest building under construction (highest priority!)
          const constructionBuildings = (player.buildings || []).filter(b => 
            b && b.position && b.buildProgress !== undefined && b.buildProgress < 1.0 &&
            b.assignedWorkers && b.assignedWorkers.length < (b.maxWorkers || 3)
          );
          
          let nearestConstruction = null;
          let nearestConstructionDist = Infinity;
          
          constructionBuildings.forEach(building => {
            const dx = building.position.x - (villager.pb?.state?.loc?.x || 0);
            const dz = building.position.z - (villager.pb?.state?.loc?.z || 0);
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < nearestConstructionDist) {
              nearestConstructionDist = dist;
              nearestConstruction = building;
            }
          });
          
          // If nearby construction building found, go work there
          if (nearestConstruction && nearestConstructionDist < 200) {
            if (this.submitCommand({
              type: 'work',
              playerId: player.id,
              unitIds: [villager.id],
              buildingId: nearestConstruction.id
            })) {
              commandCount++;
            }
            return;
          }
          
          // Priority 2: Find nearest player-owned production building (camp, farm, etc.)
          const playerBuildings = (player.buildings || []).filter(b => 
            b && b.position && b.buildProgress >= 1.0 && (b.type === 'camp' || b.type === 'farm')
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
            if (this.submitCommand({
              type: 'work',
              playerId: player.id,
              unitIds: [villager.id],
              buildingId: nearestBuilding.id
            })) {
              commandCount++;
            }
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
            if (this.submitCommand({
              type: 'gather',
              playerId: player.id,
              unitIds: [villager.id],
              resourceId: nearestResource.id
            })) {
              commandCount++;
            }
          }
          // Otherwise stay idle near base
        });
        
        // Simple AI: Train villagers if we have resources and less than 12
        const villagerCount = player.units.filter(u => u && u.type === 'villager').length;
        if (villagerCount < 12 && player.resources && player.resources.food >= 50) {
          const agora = player.buildings?.find(b => b && b.type === 'agora');
          if (agora) {
            if (this.submitCommand({
              type: 'train',
              playerId: player.id,
              buildingId: agora.id,
              unitType: 'villager'
            })) {
              commandCount++;
            }
          }
        }
      });
      
      return commandCount;
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
      // Grace period: Don't check elimination for first 5 seconds (100 ticks)
      // This allows time for all units to spawn after match start
      if (this.tick < 100) {
        return;
      }
      
      // Debug: Log first elimination check
      if (this.tick === 100) {
        console.log(`🔍 First elimination check at tick ${this.tick}`);
        this.players.forEach(p => {
          const pid = p.id || p;
          const unitCount = p.units?.length || 0;
          const villagerCount = p.units?.filter(u => u && u.type === 'villager').length || 0;
          console.log(`   Player ${pid}: ${unitCount} units, ${villagerCount} villagers`);
        });
      }
      
      // Check each player's units and buildings
      this.players.forEach(player => {
        const pid = player.id || player;
        
        if (this.eliminatedPlayers.has(pid)) {
          return; // Already eliminated
        }
        
        // Loss condition: Player has no villagers left
        const villagers = player.units?.filter(u => u && u.type === 'villager') || [];
        if (villagers.length === 0) {
          console.log(`💀 Player ${pid} has no villagers - eliminated!`);
          console.log(`   player.units: ${player.units?.length || 0}`, player.units);
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
      // CRITICAL: Since we now check once per second (not every tick), capture rate is per second
      const CAPTURE_RATE = 100 / CAPTURE_TIME; // % per second (called at 1 Hz now)
      
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
            // CRITICAL: Round unit positions to prevent desyncs from floating-point drift
            // This ensures both clients count the same units as "within radius"
            const unitTileX = Math.round(unit.pb.state.loc.x / TILE_SIZE);
            const unitTileZ = Math.round(unit.pb.state.loc.z / TILE_SIZE);
            
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
            captureState.progress = Math.max(0, captureState.progress - CAPTURE_RATE); // Decay at same rate as capture
          }
          
          // Update agora visual state
          agora.contested = false;
          agora.contestedBy = null;
          agora.captureProgress = captureState.progress;
          
        } else if (enemyTeams.length === 1) {
          // One enemy team - check if they have enough units to capture
          const capturingTeamNormalized = enemyTeams[0];
          const attackerCount = unitsNearby.get(capturingTeamNormalized) || 0;
          
          // Find the full player ID for the capturing team
          let capturingTeamFullId = null;
          this.players.forEach(p => {
            const pId = p.id || p;
            const pNormalized = pId.length > 6 ? pId.slice(-6) : pId;
            if (pNormalized === capturingTeamNormalized) {
              capturingTeamFullId = pId;
            }
          });
          
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
            captureState.capturer = capturingTeamNormalized;
            captureState.contestedNotified = false; // Reset contested notification
            
            // Increase capture progress
            captureState.progress = Math.min(100, captureState.progress + CAPTURE_RATE);
            
            // Update agora visual state
            agora.contested = false;
            agora.contestedBy = capturingTeamNormalized;
            agora.captureProgress = captureState.progress;
            
            // Notify on capture start (only once when it starts)
            if (captureState.progress <= CAPTURE_RATE && !captureState.notified) {
              // console.log(`🚩 Player ${capturingTeamNormalized} is capturing ${pid}'s Agora! (${attackerCount} attackers vs ${defenderCount} defenders)`);
              
              // Get local player ID (use window.player.id as primary source, fallback to this.localPlayerId)
              const localPlayerId = window.player?.id || this.localPlayerId;
              const localPlayerIdNormalized = localPlayerId ? 
                (localPlayerId.length > 6 ? localPlayerId.slice(-6) : localPlayerId) : null;
              
              // Show notification only to relevant players
              if (localPlayerIdNormalized === normalizedPid) {
                // Defender sees warning
                this.showNotification(`Your Agora is under attack!`, 'warning');
              } else if (localPlayerIdNormalized === capturingTeamNormalized) {
                // Attacker sees success message
                this.showNotification(`Capturing enemy Agora!`, 'success');
              }
              
              captureState.notified = true;
            }
            
            // Check for full capture
            if (captureState.progress >= 100) {
              // console.log(`🏆 Player ${capturingTeamNormalized} captured ${pid}'s Agora!`);
              
              // Mark this agora as captured
              captureState.captured = true;
              captureState.capturedBy = capturingTeamFullId || capturingTeamNormalized;
              
              // Check if all enemy agoras are captured (for multiplayer/team games)
              if (this.checkAllEnemyAgorasCaptured(capturingTeamFullId || capturingTeamNormalized)) {
                // All enemy agoras captured - victory!
                this.endMatch(capturingTeamFullId || capturingTeamNormalized, 'agora_capture');
              } else {
                // Not all agoras captured yet - show progress notification
                const localPlayerId = window.player?.id || this.localPlayerId;
                const localPlayerIdNormalized = localPlayerId ? 
                  (localPlayerId.length > 6 ? localPlayerId.slice(-6) : localPlayerId) : null;
                
                if (localPlayerIdNormalized === capturingTeamNormalized) {
                  const remaining = this.getRemainingEnemyAgorasCount(capturingTeamFullId || capturingTeamNormalized);
                  this.showNotification(`Agora captured! ${remaining} enemy agoras remaining`, 'success');
                }
              }
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
    
    // Helper: Get team members for a player (for team games)
    getTeamMembers(playerId) {
      if (this.gameType === 'teams') {
        // For team games, split players into two teams
        // First half = team 1, second half = team 2
        const totalPlayers = this.players.length;
        const teamSize = Math.ceil(totalPlayers / 2);
        const playerIndex = this.players.findIndex(p => (p.id || p) === playerId);
        
        if (playerIndex < teamSize) {
          // Team 1 (first half)
          return this.players.slice(0, teamSize).map(p => p.id || p);
        } else {
          // Team 2 (second half)
          return this.players.slice(teamSize).map(p => p.id || p);
        }
      }
      // Free-for-all: each player is their own team
      return [playerId];
    }
    
    // Helper: Check if all enemy agoras are captured
    checkAllEnemyAgorasCaptured(capturingPlayerId) {
      const totalPlayers = this.players.length;
      
      // 1v1: capturing one agora ends the game
      if (totalPlayers === 2) {
        return true;
      }
      
      // Get team members for the capturing player
      const capturingTeam = this.getTeamMembers(capturingPlayerId);
      const capturingTeamSet = new Set(capturingTeam);
      
      // Find all enemy agoras (agoras not owned by capturing team)
      const enemyAgoras = [];
      this.players.forEach(player => {
        const pid = player.id || player;
        if (!capturingTeamSet.has(pid) && !this.eliminatedPlayers.has(pid)) {
          const agora = player.buildings?.find(b => b && b.type === 'agora');
          if (agora) {
            const normalizedPid = pid.length > 6 ? pid.slice(-6) : pid;
            const agoraKey = agora.id || `${normalizedPid}-agora`;
            enemyAgoras.push({ playerId: pid, agoraKey, agora });
          }
        }
      });
      
      // Check if all enemy agoras are captured
      if (enemyAgoras.length === 0) {
        return true; // No enemies left
      }
      
      // Check capture states for all enemy agoras
      for (const { agoraKey } of enemyAgoras) {
        const captureState = this.agoraCaptureStates?.get(agoraKey);
        if (!captureState || !captureState.captured) {
          return false; // At least one enemy agora not captured
        }
        
        // Check if captured by someone on the capturing team
        const capturerId = captureState.capturedBy;
        const capturerNormalized = capturerId && capturerId.length > 6 ? capturerId.slice(-6) : capturerId;
        const capturingTeamNormalized = capturingTeam.map(id => {
          const normalized = id.length > 6 ? id.slice(-6) : id;
          return normalized;
        });
        
        if (!capturingTeamNormalized.includes(capturerNormalized)) {
          return false; // Captured by someone not on the team
        }
      }
      
      return true; // All enemy agoras captured!
    }
    
    // Helper: Get count of remaining enemy agoras
    getRemainingEnemyAgorasCount(capturingPlayerId) {
      const totalPlayers = this.players.length;
      
      // 1v1: no remaining agoras after capture
      if (totalPlayers === 2) {
        return 0;
      }
      
      // Get team members for the capturing player
      const capturingTeam = this.getTeamMembers(capturingPlayerId);
      const capturingTeamSet = new Set(capturingTeam);
      
      // Count enemy agoras that aren't captured yet
      let remaining = 0;
      this.players.forEach(player => {
        const pid = player.id || player;
        if (!capturingTeamSet.has(pid) && !this.eliminatedPlayers.has(pid)) {
          const agora = player.buildings?.find(b => b && b.type === 'agora');
          if (agora) {
            const normalizedPid = pid.length > 6 ? pid.slice(-6) : pid;
            const agoraKey = agora.id || `${normalizedPid}-agora`;
            const captureState = this.agoraCaptureStates?.get(agoraKey);
            if (!captureState || !captureState.captured) {
              remaining++;
            } else {
              // Check if captured by someone on the capturing team
              const capturerId = captureState.capturedBy;
              const capturerNormalized = capturerId && capturerId.length > 6 ? capturerId.slice(-6) : capturerId;
              const capturingTeamNormalized = capturingTeam.map(id => {
                const normalized = id.length > 6 ? id.slice(-6) : id;
                return normalized;
              });
              
              if (!capturingTeamNormalized.includes(capturerNormalized)) {
                remaining++; // Captured by someone not on the team
              }
            }
          }
        }
      });
      
      return remaining;
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
    
    // Concede the match (local player quits)
    concede() {
      if (!this.localPlayerId) {
        console.warn('⚠️ Cannot concede: no local player ID');
        return;
      }
      
      // Broadcast concede FIRST before eliminating (so other players know)
      if (window.isMultiplayer && window.net && window.net.p2p && window.net.p2p.sendData) {
        try {
          window.net.p2p.sendData({
            type: 'player_conceded',
            playerId: this.localPlayerId,
            matchId: this.id
          });
          console.log('📡 Sent concede message to other players');
        } catch (error) {
          console.warn('⚠️ Failed to send concede message:', error);
        }
      }
      
      // Small delay to ensure message is sent before eliminating
      setTimeout(() => {
        // Eliminate local player
        this.eliminatePlayer(this.localPlayerId);
      }, 100);
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
      // Don't end match if player chose to continue playing after previous end
      if (this.victoryCheckingDisabled) {
        return; // Player chose to continue playing, ignore victory conditions
      }
      
      if (this.state === MatchState.VICTORY || this.state === MatchState.DEFEAT || this.state === MatchState.DRAW) {
        return; // Already ended
      }
      
      this.endedAt = Date.now();
      const duration = (this.endedAt - this.startedAt) / 1000;
      
      // Determine local player result
      // Normalize IDs for comparison (handle both full and normalized IDs)
      const normalizeId = (id) => id && id.length > 6 ? id.slice(-6) : id;
      const localPlayerId = window.player?.id || this.localPlayerId;
      const localPlayerIdNormalized = normalizeId(localPlayerId);
      const winnerIdNormalized = normalizeId(winnerId);
      
      if (!winnerId) {
        this.state = MatchState.DRAW;
      } else if (winnerIdNormalized === localPlayerIdNormalized || winnerId === localPlayerId) {
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
    
    // Process pending resource decrements at sync checkpoint
    // CRITICAL: This ensures both clients apply decrements at the same tick, preventing desyncs
    processPendingResourceDecrements() {
      if (!window.gameBuildings || this.pendingResourceDecrements.length === 0) return;
      
      // CRITICAL: Only process decrements queued in the interval since the last checkpoint
      // At tick 1000, process decrements queued at ticks (900, 1000]
      // Decrements queued after tick 1000 will be processed at tick 1100
      // This ensures both clients process the same decrements at each checkpoint
      const syncInterval = this.syncInterval || 100;
      const currentSyncCheckpoint = this.tick;
      const previousSyncCheckpoint = currentSyncCheckpoint - syncInterval;
      
      // Filter to only process decrements from the interval (previousCheckpoint, currentCheckpoint]
      const decrementsToProcess = this.pendingResourceDecrements.filter(decrement => {
        const queuedAtTick = decrement.queuedAtTick || 0;
        return queuedAtTick > previousSyncCheckpoint && queuedAtTick <= currentSyncCheckpoint;
      });
      
      // Keep decrements queued after current checkpoint for next checkpoint
      this.pendingResourceDecrements = this.pendingResourceDecrements.filter(decrement => {
        const queuedAtTick = decrement.queuedAtTick || 0;
        return queuedAtTick > currentSyncCheckpoint;
      });
      
      if (decrementsToProcess.length === 0) return;
      
      // Sort decrements deterministically by building ID, then grid position
      const sortedDecrements = decrementsToProcess.slice().sort((a, b) => {
        if (a.buildingId !== b.buildingId) return (a.buildingId || '').localeCompare(b.buildingId || '');
        if (a.gridX !== b.gridX) return a.gridX - b.gridX;
        return a.gridZ - b.gridZ;
      });
      
      // Apply all decrements deterministically
      sortedDecrements.forEach(decrement => {
        const building = this.getBuildingById(decrement.buildingId);
        if (!building || !building.availableResources) return;
        
        const resource = building.availableResources.find(r => 
          r.gridX === decrement.gridX && r.gridZ === decrement.gridZ
        );
        
        if (resource && resource.remaining !== undefined) {
          const oldRemaining = resource.remaining;
          resource.remaining = Math.max(0, resource.remaining - decrement.amount);
          
          // If depleted, schedule depletion at next sync checkpoint
          if (resource.remaining <= 0 && !resource.depleted && resource.depletionTick === undefined) {
            const syncInterval = this.syncInterval || 100;
            const depletionTick = Math.ceil((this.tick + 1) / syncInterval) * syncInterval;
            resource.remaining = 0;
            resource.depletionTick = depletionTick;
          }
        }
      });
      
      // NOTE: Queue already filtered at line 2288-2291 to keep future decrements
      // Don't clear here - that would remove decrements queued for future checkpoints!
    }
    
    // P2P Unit Position Sync - Each player broadcasts their own unit positions
    // Other players accept these positions to prevent floating-point drift
    syncUnitPositionsAtCheckpoint() {
      if (!window.isMultiplayer || !window.gameUnits) {
        if (!window.isMultiplayer) {
          // console.log(`⚠️ Position sync skipped: not multiplayer`);
        } else if (!window.gameUnits) {
          console.warn(`⚠️ Position sync skipped: no gameUnits!`);
        }
        return;
      }
      
      // Normalize local player ID for comparison
      const localPlayerId = this.localPlayerId?.slice ? this.localPlayerId.slice(-6) : this.localPlayerId;
      
      // Collect positions for OUR units only (units we own)
      const myUnitPositions = [];
      window.gameUnits.forEach(unit => {
        if (unit.pb && unit.pb.state && unit.pb.state.loc && unit.owner) {
          const unitOwnerId = unit.owner.slice ? unit.owner.slice(-6) : unit.owner;
          
          // Only send positions for units WE own
          if (unitOwnerId === localPlayerId) {
            myUnitPositions.push({
              id: unit.id,
              x: unit.pb.state.loc.x,
              y: unit.pb.state.loc.y,
              z: unit.pb.state.loc.z
            });
          }
        }
      });
      
      // Broadcast MY unit positions to all other players
      if (window.net && window.net.p2p && myUnitPositions.length > 0) {
        window.net.p2p.sendData({
          type: 'unit_position_sync',
          tick: this.tick,
          playerId: this.localPlayerId,
          positions: myUnitPositions
        });
      }
    }
    
    // Apply unit positions from another player (P2P handshake)
    applyUnitPositions(positions, fromPlayerId, tick) {
      if (!window.gameUnits || !positions || positions.length === 0) return;
      
      const tickDiff = this.tick - tick;
      const syncInterval = this.syncInterval || 100;
      const ticksPerSecond = window.net?.TICK_RATE || 20;
      
      // CRITICAL: Track tick synchronization to detect divergence
      if (!this.peerTickHistory.has(fromPlayerId)) {
        this.peerTickHistory.set(fromPlayerId, []);
      }
      const history = this.peerTickHistory.get(fromPlayerId);
      history.push({ tick, receivedAt: Date.now(), localTick: this.tick });
      // Keep only last 10 syncs for analysis
      if (history.length > 10) {
        history.shift();
      }
      
      // Analyze tick divergence over recent syncs
      if (history.length >= 3) {
        const recentDiffs = history.slice(-5).map(h => h.localTick - h.tick);
        const avgDiff = recentDiffs.reduce((a, b) => a + b, 0) / recentDiffs.length;
        const consistentDivergence = recentDiffs.every(d => Math.abs(d - avgDiff) < 50);
        
        // DISABLED: Tick sync adjustment was causing more problems than it solved.
        // Instead of adjusting tick rate, we rely on:
        // 1. Input delay (commands scheduled for future ticks)
        // 2. Gentle position corrections for any remaining drift
        // Adjusting tick rate caused one player to fall further behind indefinitely.
        this.tickSyncAdjustment = 0;
      }
      
      // CRITICAL: Mark that we received position sync from this peer
      // This allows checksum to wait for all syncs before calculating
      if (this.pendingPositionSyncs && this.pendingPositionSyncTick === tick) {
        this.pendingPositionSyncs.delete(fromPlayerId);
      }
      
      // POSITION SYNC: Apply regardless of tick difference
      // Tick counters will drift slightly between clients (setTimeout variance).
      // Rather than rejecting "stale" syncs, we apply them all with lerp correction.
      // The 15% lerp ensures smooth convergence without snapping.
      //
      // Only reject truly ancient syncs (> 5 minutes old) which are likely from
      // a disconnected/reconnected peer with completely wrong state.
      const maxAcceptableAge = ticksPerSecond * 300; // 5 minutes
      if (tickDiff > maxAcceptableAge) {
        console.warn(`⚠️ Ignoring ancient position sync: ${tickDiff} ticks old`);
        return;
      }
      
      // Normalize IDs for comparison
      const remotePlayerId = fromPlayerId?.slice ? fromPlayerId.slice(-6) : fromPlayerId;
      
      let appliedCount = 0;
      let correctedCount = 0;
      positions.forEach(posData => {
        const unit = window.gameUnits.find(u => u.id === posData.id);
        if (unit && unit.pb && unit.pb.state && unit.pb.state.loc) {
          const unitOwnerId = unit.owner?.slice ? unit.owner.slice(-6) : unit.owner;
          
          // Only accept positions for units THEY own
          if (unitOwnerId === remotePlayerId) {
            // Calculate position error (how far off we are)
            const errorX = posData.x - unit.pb.state.loc.x;
            const errorZ = posData.z - unit.pb.state.loc.z;
            const errorDistance = Math.sqrt(errorX * errorX + errorZ * errorZ);
            
            // CRITICAL: Reduced correction strength to prevent speedups
            // Units should move at their normal speed, not faster due to corrections
            // Only apply corrections when unit is idle (checked in units.js)
            
            // CRITICAL: In 3+ player games, units can drift more due to network latency
            // Use higher threshold for "catastrophic" errors (50 units instead of 20)
            const connectedPeers = window.net?.p2p?.getConnectedPeers() || [];
            const playerCount = 1 + connectedPeers.length;
            const isMultiPlayerGame = playerCount >= 3;
            const catastrophicThreshold = isMultiPlayerGame ? 50 : 20; // Higher threshold for 3+ players
            
            // DETERMINISM MODE: Apply very gentle corrections to prevent drift accumulation
            // Without corrections, late commands cause drift that accumulates forever.
            // With gentle corrections (2% per frame), units slowly converge without speedup.
            if (this.strictDeterminism) {
              // OPPONENT UNITS: The other player is AUTHORITATIVE for their own units.
              // We should trust their position sync and update physics directly.
              // The visual interpolation system will smooth the transition.
              //
              // This fixes the "snap vs smooth" asymmetry:
              // - Before: We only updated visualPosition, which was overridden by pb.state.loc lerp
              // - After: We update pb.state.loc, and visualPosition follows smoothly
              
              if (errorDistance > 0.5) {
                // Log significant drift (but rate-limit to avoid spam)
                if (errorDistance > 10.0 && (!this._lastDriftLog || Date.now() - this._lastDriftLog > 2000)) {
                  console.warn(`🔍 Position drift: unit ${unit.id.slice(-4)} is ${errorDistance.toFixed(2)} units off`);
                  this._lastDriftLog = Date.now();
                }
                
                // Update physics position directly (authoritative from owner)
                // Use lerp for smooth transition, not instant snap
                const syncStrength = 0.15; // 15% per sync = smooth but responsive
                unit.pb.state.loc.x += (posData.x - unit.pb.state.loc.x) * syncStrength;
                unit.pb.state.loc.z += (posData.z - unit.pb.state.loc.z) * syncStrength;
                unit.pb.state.loc.y = posData.y;
                
                correctedCount++;
              }
            } else if (errorDistance > 0.3) {
              // Non-strict mode: Also update physics directly, but use stronger correction
              const syncStrength = Math.min(0.2, 0.1 + errorDistance * 0.01);
              unit.pb.state.loc.x += (posData.x - unit.pb.state.loc.x) * syncStrength;
              unit.pb.state.loc.z += (posData.z - unit.pb.state.loc.z) * syncStrength;
              unit.pb.state.loc.y = posData.y;
              
              correctedCount++;
            } else {
              // Small error (< 0.3 units) - just update Y, let normal movement handle X/Z
              unit.pb.state.loc.y = posData.y;
            }
            
            appliedCount++;
          }
        }
      });
      
      // Position sync applied successfully - no logging needed for normal operation
      // (stale syncs are already rejected above)
    }
    
    // Sync resource states at sync checkpoint (authoritative sync)
    // CRITICAL: Make host (or lower player ID) authoritative to prevent desyncs
    syncResourceStatesAtCheckpoint() {
      if (!window.isMultiplayer || !window.gameBuildings) return;
      
      // Determine if we're the authoritative peer (host or lower player ID)
      const isAuthoritative = this.isHost() || 
        (this.localPlayerId && this.hostId && this.localPlayerId < this.hostId);
      
      // Only authoritative peer sends resource states
      if (!isAuthoritative) return;
      
      // Collect all resource states from all buildings
      const resourceStates = {};
      window.gameBuildings.forEach(building => {
        if (building.availableResources && building.availableResources.length > 0) {
          resourceStates[building.id] = building.availableResources.map(r => ({
            gridX: r.gridX,
            gridZ: r.gridZ,
            remaining: r.remaining || 0,
            depleted: r.depleted || false,
            depletionTick: r.depletionTick
          }));
        }
      });
      
      // Send resource states to other players
      if (window.net && window.net.p2p && Object.keys(resourceStates).length > 0) {
        const message = {
          type: 'resource_state_sync',
          tick: this.tick,
          resourceStates: resourceStates
        };
        window.net.p2p.sendData(message);
      }
    }
    
    // Process pending resource depletions at sync checkpoint
    processPendingResourceDepletions() {
      if (!window.gameBuildings) return;
      
      // Check all buildings for resources scheduled for depletion
      window.gameBuildings.forEach(building => {
        if (building.availableResources && Array.isArray(building.availableResources)) {
          building.availableResources.forEach(resource => {
            // If resource is scheduled for depletion at this tick, mark it as depleted
            if (resource.depletionTick !== undefined && resource.depletionTick === this.tick && !resource.depleted) {
              resource.depleted = true;
              
              // Remove 3D model
              if (window.removeResourceModel) {
                window.removeResourceModel(resource.gridX, resource.gridZ);
              }
            }
          });
        }
      });
    }
    
    // Create synchronization checkpoint
    createSyncCheckpoint() {
      // CRITICAL: Clear pending syncs tracker after checksum calculation
      // This ensures we don't wait forever if a peer never sends sync
      if (this.pendingPositionSyncs) {
        const stillWaiting = this.pendingPositionSyncs.size;
        if (stillWaiting > 0) {
          console.warn(`⚠️ Calculating checksum at tick ${this.tick} but still waiting for ${stillWaiting} position sync(s)`);
        }
        this.pendingPositionSyncs.clear();
        this.pendingPositionSyncTick = null;
      }
      
      const checksum = this.calculateGameStateChecksum();
      this.checksums.set(this.tick, checksum);
      
      // Collect component hashes for debugging (only if recently logged)
      const components = this.lastChecksumComponents;
      
      // Send checksum to other players for verification
      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'sync_checkpoint',
          tick: this.tick,
          checksum: checksum,
          components: components // Include for desync debugging
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
      
      let unitPosHash = 0;
      let unitOwnerHash = 0;
      let unitTypeHash = 0;
      let unitStateHash = 0;
      let unitHealthHash = 0;
      
      sortedUnits.forEach(unit => {
        if (unit.pb && unit.pb.state) {
          // CRITICAL: Include positions to detect physics drift
          // personalityOffset is deterministic, so positions should match
          const posHash = this.hashVector(unit.pb.state.loc);
          unitPosHash ^= posHash;
          hash ^= posHash;
          
          const ownerHash = this.hashString(unit.owner || 'neutral');
          unitOwnerHash ^= ownerHash;
          hash ^= ownerHash;
          
          const typeHash = this.hashString(unit.type || 'unknown'); // CRITICAL: Include type to detect conversion desyncs!
          unitTypeHash ^= typeHash;
          hash ^= typeHash;
          
          const stateHash = this.hashString(unit.state || 'idle'); // Include state to detect behavior desyncs
          unitStateHash ^= stateHash;
          hash ^= stateHash;
          
          const healthHash = Math.floor((unit.currentHealth || unit.health || 100) * 100);
          unitHealthHash ^= healthHash;
          hash ^= healthHash;
          
          unitCount++;
        }
      });
      
      // Store components for debugging and transmission to remote clients
      this.lastChecksumComponents = {
        unitCount,
        unitPosHash: unitPosHash >>> 0,
        unitOwnerHash: unitOwnerHash >>> 0,
        unitTypeHash: unitTypeHash >>> 0,
        unitStateHash: unitStateHash >>> 0,
        unitHealthHash: unitHealthHash >>> 0
      };
      
      if (window.isMultiplayer && this.tick % (this.syncInterval * 2) === 0) {
        console.log(`🔢 LOCAL checksum components at tick ${this.tick}:`, this.lastChecksumComponents);
      }
      
      // Hash all building states (in deterministic order)
      const sortedBuildings = (window.gameBuildings || []).slice().sort((a, b) => 
        (a.id || '').localeCompare(b.id || '')
      );
      
      let buildingPosHash = 0;
      let buildingOwnerHash = 0;
      let buildingHealthHash = 0;
      let buildingProgressHash = 0;
      
      sortedBuildings.forEach(building => {
        const posHash = this.hashPosition(building.gridX, building.gridZ);
        buildingPosHash ^= posHash;
        hash ^= posHash;
        
        const ownerHash = this.hashString(building.owner || 'neutral');
        buildingOwnerHash ^= ownerHash;
        hash ^= ownerHash;
        
        const healthHash = Math.floor((building.health || 100) * 100);
        buildingHealthHash ^= healthHash;
        hash ^= healthHash;
        
        // CRITICAL: Include build progress - affects when buildings become functional
        const progressHash = Math.floor((building.buildProgress || 0) * 1000); // 0-1000 (0.0-1.0 scaled)
        buildingProgressHash ^= progressHash;
        hash ^= progressHash;
        
        // CRITICAL: EXCLUDE resources from checksum - they're synced authoritatively
        // Resources are synced via authoritative resource_state_sync messages at checkpoints
        // Including them in checksum causes false positives because sync happens asynchronously
        // Resource states are kept in sync separately, so we don't need to checksum them
        
        buildingCount++;
      });
      
      // Add building components to stored components
      if (this.lastChecksumComponents) {
        this.lastChecksumComponents.buildingCount = buildingCount;
        this.lastChecksumComponents.buildingPosHash = buildingPosHash >>> 0;
        this.lastChecksumComponents.buildingOwnerHash = buildingOwnerHash >>> 0;
        this.lastChecksumComponents.buildingHealthHash = buildingHealthHash >>> 0;
        this.lastChecksumComponents.buildingProgressHash = buildingProgressHash >>> 0;
      }
      
      if (window.isMultiplayer && this.tick % (this.syncInterval * 2) === 0) {
        console.log(`🏗️ LOCAL building checksum at tick ${this.tick}: count=${buildingCount}, pos=${buildingPosHash >>> 0}, owner=${buildingOwnerHash >>> 0}, health=${buildingHealthHash >>> 0}, progress=${buildingProgressHash >>> 0}`);
      }
      
      // Hash player resources
      let playerResourceHash = 0;
      this.players.forEach(player => {
        if (player.resources) {
          playerResourceHash ^= Math.floor(player.resources.food || 0);
          playerResourceHash ^= Math.floor(player.resources.wood || 0);
          playerResourceHash ^= Math.floor(player.resources.stone || 0);
          playerResourceHash ^= Math.floor(player.resources.minerals || 0);
          
          hash ^= Math.floor(player.resources.food || 0);
          hash ^= Math.floor(player.resources.wood || 0);
          hash ^= Math.floor(player.resources.stone || 0);
          hash ^= Math.floor(player.resources.minerals || 0);
        }
      });
      
      // Add player resource components to stored components
      if (this.lastChecksumComponents) {
        this.lastChecksumComponents.playerResourceHash = playerResourceHash >>> 0;
      }
      
      if (window.isMultiplayer && this.tick % (this.syncInterval * 2) === 0) {
        console.log(`💰 LOCAL player resource checksum at tick ${this.tick}: ${playerResourceHash >>> 0}`);
        this.players.forEach(player => {
          if (player.resources) {
            console.log(`  Player ${player.id?.slice(-6)}: food=${player.resources.food}, wood=${player.resources.wood}, stone=${player.resources.stone}, minerals=${player.resources.minerals}`);
          }
        });
      }
      
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
      // Round to 0.01 (1cm) to match position sync precision
      // This ensures checksums match exactly when positions are synced
      // CRITICAL: Must match the rounding used in syncUnitPositionsAtCheckpoint()
      return Math.floor(vec.x * 100) ^ Math.floor(vec.y * 100) ^ Math.floor(vec.z * 100);
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
    verifySyncCheckpoint(tick, remoteChecksum, remoteComponents) {
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
        
        // ALWAYS log both local and remote components on desync for debugging
        const localComponents = this.lastChecksumComponents || {};
        console.error(`\n🔍 LOCAL checksum components:`, localComponents);
        console.error(`🔍 REMOTE checksum components:`, remoteComponents || {});
        
        // Highlight differences
        if (remoteComponents && localComponents) {
          console.error(`\n📊 Component differences:`);
          Object.keys(localComponents).forEach(key => {
            if (remoteComponents[key] !== undefined && localComponents[key] !== remoteComponents[key]) {
              console.error(`  ${key}: LOCAL=${localComponents[key]} vs REMOTE=${remoteComponents[key]} (diff: ${Math.abs(localComponents[key] - remoteComponents[key])})`);
            }
          });
        }
        
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
      if (!id) return null;
      
      // Normalize both IDs to last 6 chars for comparison
      const normalizeId = (playerId) => {
        if (!playerId) return '';
        const idStr = typeof playerId === 'string' ? playerId : playerId.toString();
        return idStr.length > 6 ? idStr.slice(-6) : idStr;
      };
      
      const normalizedSearchId = normalizeId(id);
      
      return this.players.find(p => {
        const playerId = p.id || p;
        return normalizeId(playerId) === normalizedSearchId;
      });
    }
    
    canAfford(player, cost) {
      return (player.resources.food || 0) >= (cost.food || 0) &&
             (player.resources.wood || 0) >= (cost.wood || 0) &&
             (player.resources.stone || 0) >= (cost.stone || 0) &&
             (player.resources.minerals || 0) >= (cost.minerals || 0);
    }
    
    deductResources(player, cost) {
      player.resources.food -= (cost.food || 0);
      player.resources.wood -= (cost.wood || 0);
      player.resources.stone -= (cost.stone || 0);
      player.resources.minerals -= (cost.minerals || 0);
    }
    
    getBuildingCost(type) {
      // Single source of truth: read from BuildingTypes
      if (window.BuildingTypes && window.BuildingTypes[type]) {
        return window.BuildingTypes[type].cost || {};
      }
      // Fallback for unknown types
      return { wood: 50, stone: 25 };
    }
    
    getUnitCost(type) {
      // Single source of truth: read from UnitTypes
      if (window.UnitTypes && window.UnitTypes[type]) {
        return window.UnitTypes[type].cost || {};
      }
      // Fallback for unknown types
      return { food: 50 };
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
      
      // Set display first, but keep opacity at 0 to allow layout calculation
      endScreen.style.display = 'block';
      endScreen.style.opacity = '0';
      
      // Use requestAnimationFrame to ensure layout is calculated before showing
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          endScreen.style.opacity = '1';
        });
      });
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
          <h1 style="font-size: 2em; margin-bottom: 20px;">🎮 Game Start</h1>
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
            <h1 style="font-size: 2em; margin-bottom: 20px;">🎮 Game Start</h1>
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
        // Add timestamp and version info
        this.replay.savedAt = Date.now();
        this.replay.version = '1.1'; // Current replay format version
        this.replay.saved = false; // Not protected by default
        
        const replayKey = `replay_${this.id}`;
        const replayData = JSON.stringify(this.replay);
        
        try {
          localStorage.setItem(replayKey, replayData);
          console.log(`💾 Replay saved: ${replayKey} (${(replayData.length / 1024).toFixed(1)} KB)`);
        } catch (quotaError) {
          // Storage quota exceeded - clean up old replays and retry
          console.warn('⚠️ Storage quota exceeded, cleaning up old replays...');
          if (window.Determinism && window.Determinism.cleanupOldReplays) {
            window.Determinism.cleanupOldReplays(10); // Keep only 10 when quota exceeded
          }
          
          try {
            localStorage.setItem(replayKey, replayData);
            console.log(`💾 Replay saved after cleanup: ${replayKey}`);
          } catch (retryError) {
            // Still failed - the replay is probably too large
            console.error('❌ Replay too large to save even after cleanup');
            this.showNotification('⚠️ Replay too large to save to browser storage', 'warning');
          }
        }
        
        // Proactively clean up if we have too many replays (keep 15)
        if (window.Determinism && window.Determinism.cleanupOldReplays) {
          window.Determinism.cleanupOldReplays(15);
        }
      } catch (error) {
        console.error('❌ Failed to save replay:', error);
      }
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
      console.log('🎬 Opening replay viewer...');
      this.showReplayViewer();
    }
    
    // Show replay viewer UI
    showReplayViewer() {
      // Get list of saved replays
      const replays = window.Determinism ? window.Determinism.listReplays() : [];
      
      // Create replay viewer overlay
      let viewer = document.getElementById('replay_viewer');
      if (!viewer) {
        viewer = document.createElement('div');
        viewer.id = 'replay_viewer';
        viewer.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.9);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          color: white;
          font-family: sans-serif;
        `;
        document.body.appendChild(viewer);
      }
      
      // Build replay list HTML
      let replayListHtml = '';
      if (replays.length === 0) {
        replayListHtml = '<p style="color: #888;">No replays saved yet.</p>';
      } else {
        replayListHtml = replays.map((r, i) => `
          <div class="replay_item" style="
            background: rgba(50, 50, 80, 0.8);
            padding: 15px;
            margin: 5px 0;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.2s;
          " onmouseover="this.style.background='rgba(70, 70, 120, 0.9)'" 
             onmouseout="this.style.background='rgba(50, 50, 80, 0.8)'"
             onclick="window.currentMatch.loadAndPlayReplay('${r.id}')">
            <div>
              <div style="font-weight: bold;">${r.gameType || 'Match'} - ${r.players?.length || '?'} players</div>
              <div style="font-size: 0.8em; color: #aaa;">
                ${r.commandCount || 0} commands • ${this.formatDuration((r.duration || 0) * 1000)}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="color: ${r.winner ? '#4CAF50' : '#888'};">${r.winner ? '🏆 Winner' : ''}</div>
              <div style="font-size: 0.7em; color: #666;">Seed: ${r.mapSeed || '?'}</div>
            </div>
          </div>
        `).join('');
      }
      
      viewer.innerHTML = `
        <div style="max-width: 600px; width: 90%;">
          <h2 style="margin-bottom: 20px;">🎬 Replay Viewer</h2>
          <div style="max-height: 400px; overflow-y: auto;">
            ${replayListHtml}
          </div>
          <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
            <button onclick="document.getElementById('replay_viewer').style.display='none'" 
                    style="padding: 10px 20px; background: #444; border: none; color: white; border-radius: 5px; cursor: pointer;">
              Close
            </button>
          </div>
          <div style="margin-top: 20px; font-size: 0.8em; color: #666; text-align: center;">
            Click a replay to watch it. Replays verify determinism by re-executing all commands.
          </div>
        </div>
      `;
      
      viewer.style.display = 'flex';
    }
    
    // Load and play a replay
    async loadAndPlayReplay(replayId) {
      console.log(`🎬 Loading replay: ${replayId}`);
      
      // Hide viewer and end game screen
      const viewer = document.getElementById('replay_viewer');
      if (viewer) viewer.style.display = 'none';
      
      const endScreen = document.getElementById('match_end_screen');
      if (endScreen) endScreen.style.display = 'none';
      
      // Load replay data
      const replayData = window.Determinism ? window.Determinism.loadReplay(replayId) : null;
      if (!replayData) {
        console.error('❌ Failed to load replay');
        this.showNotification('Failed to load replay', 'error');
        return;
      }
      
      console.log(`📊 Replay loaded: ${replayData.commands?.length || 0} commands, seed: ${replayData.mapSeed}`);
      
      // CRITICAL: Set up the game world for replay
      // We need to create the map, spawn units, etc. using the replay's seed
      try {
        await this.initializeReplayWorld(replayData);
      } catch (error) {
        console.error('❌ Failed to initialize replay world:', error);
        this.showNotification('Failed to load replay world', 'error');
        return;
      }
      
      // Create replay player
      const replayPlayer = new window.Determinism.ReplayPlayer(replayData);
      await replayPlayer.initialize();
      
      // Show replay playback UI
      this.showReplayPlaybackUI(replayPlayer, replayData);
      
      // Start playback
      this.startReplayPlayback(replayPlayer);
    }
    
    // Initialize the game world from replay data
    async initializeReplayWorld(replayData) {
      console.log(`🌍 Initializing replay world with seed: ${replayData.mapSeed}`);
      
      const TILE_SIZE = window.TILE_SIZE || 4;
      
      // Stop any existing game/match
      if (window.gameLoop && window.gameLoop.stop) {
        window.gameLoop.stop();
      }
      
      // Clear existing game state using Lobby's reset if available
      if (window.Lobby && window.Lobby.resetGameState) {
        window.Lobby.resetGameState();
      } else {
        // Fallback: manual cleanup
        window.gameUnits = [];
        window.gameBuildings = [];
        if (window.behaviorManager && window.behaviorManager.clear) {
          window.behaviorManager.clear();
        }
      }
      
      // Set the map seed for deterministic generation
      window.mapSeed = replayData.mapSeed;
      window.isMultiplayer = false; // Replay mode
      window.isReplayMode = true;
      
      // Initialize deterministic RNG
      if (window.Determinism && window.Determinism.initMatchRng) {
        window.Determinism.initMatchRng(replayData.mapSeed);
      }
      
      // Get field dimensions from replay or use default
      const fieldSize = replayData.fieldSize || 64;
      const dims = window.Lobby?.getFieldDimensions?.(fieldSize) || { width: fieldSize, height: fieldSize };
      
      // Get spawn positions BEFORE creating field (needed for flattening)
      const playerCount = replayData.players?.length || 2;
      let spawnPositions = [];
      
      if (window.Lobby && window.Lobby.getSpawnPositions) {
        spawnPositions = window.Lobby.getSpawnPositions(playerCount, fieldSize);
      } else {
        // Fallback: simple corner spawns
        const margin = Math.floor(dims.width * 0.15);
        spawnPositions = [
          { x: margin, y: margin },
          { x: dims.width - margin, y: dims.height - margin }
        ];
      }
      
      // Keep reference to old field so we can dispose it
      const oldField = window.liveField;
      
      // CRITICAL: Set to null BEFORE disposing to prevent render loop from processing old field
      // The render loop checks window.liveField and skips processing if null
      window.liveField = null;
      if (typeof liveField !== 'undefined') {
        liveField = null;
      }
      
      // Dispose old field after nulling the reference
      if (oldField && typeof oldField.dispose === 'function') {
        oldField.dispose();
      }
      
      // Create the field/map with the replay's seed AND spawn positions (for flattening)
      if (window.Field) {
        window.liveField = new window.Field({
          width: dims.width,
          height: dims.height,
          seed: replayData.mapSeed,
          spawnPositions: spawnPositions // Critical: pass spawn positions for flattening
        });
        
        // Update global liveField reference
        if (typeof liveField !== 'undefined') {
          liveField = window.liveField;
        }
        
        // Apply LOD settings
        if (window.hud && window.hud.getCurrentLODMultiplier) {
          const currentMultiplier = window.hud.getCurrentLODMultiplier();
          window.liveField.originalLoadDistance = 6;
          const newLoadDistance = Math.round(6 * currentMultiplier);
          window.liveField.currentLoadDistance = Math.max(3, Math.min(12, newLoadDistance));
        }
      }
      
      // Re-stretch the table to the new field dimensions
      if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
        gfx.stretchTable(window.gfx.table);
      }
      
      // Force camera limits to recalc for new field size
      window._cameraLimitsSet = false;
      
      // Create proper Player objects for replay
      const players = [];
      
      for (let i = 0; i < playerCount; i++) {
        const pData = replayData.players?.[i] || { id: `replay-player-${i}`, name: `Player ${i + 1}` };
        const spawn = spawnPositions[i] || spawnPositions[0];
        
        if (i === 0) {
          // Local player for replay viewing
          if (!window.player || !window.player.getSelectedUnits) {
            if (typeof Player !== 'undefined') {
              window.player = new Player({
                id: pData.id,
                name: pData.name || 'Replay Player 1',
                color: pData.color || '#ff0000',
                agora: spawn
              });
            } else {
              throw new Error('Player class not available for replay');
            }
          } else {
            window.player.id = pData.id;
            window.player.name = pData.name || 'Replay Player 1';
            window.player.agora = spawn;
            window.player.units = [];
            window.player.buildings = [];
            window.player.selectedUnits = [];
          }
          
          // Position player frog at spawn
          if (window.player.pbody) {
            window.player.pbody.state.loc.set(spawn.x * TILE_SIZE, 0, spawn.y * TILE_SIZE);
          }
          
          players.push(window.player);
        } else {
          // Opponent player
          let opponent;
          if (typeof Player !== 'undefined') {
            opponent = new Player({
              id: pData.id,
              name: pData.name || `Replay Player ${i + 1}`,
              color: pData.color || (i === 1 ? '#0000ff' : '#00ff00'),
              agora: spawn
            });
          } else {
            opponent = {
              id: pData.id,
              name: pData.name || `Replay Player ${i + 1}`,
              color: pData.color || '#0000ff',
              agora: spawn,
              units: [],
              buildings: [],
              selectedUnits: [],
              getSelectedUnits: function() { return []; }
            };
          }
          players.push(opponent);
        }
      }
      
      // Store opponents
      window.opponents = players.slice(1);
      
      // Position camera at first player's spawn
      if (window.gfx && window.gfx.camera && window.gfx.cameraTarget && spawnPositions[0]) {
        const agoraX = spawnPositions[0].x * TILE_SIZE;
        const agoraZ = spawnPositions[0].y * TILE_SIZE;
        
        // Position camera target
        window.gfx.cameraTarget.position.x = agoraX;
        window.gfx.cameraTarget.position.y = 9;
        window.gfx.cameraTarget.position.z = agoraZ;
        
        if (window.cameraAnchor) {
          window.cameraAnchor.x = agoraX;
          window.cameraAnchor.y = 9;
          window.cameraAnchor.z = agoraZ;
        }
        
        // Calculate angle to map center for camera orientation
        const mapCenterX = (dims.width / 2) * TILE_SIZE;
        const mapCenterZ = (dims.height / 2) * TILE_SIZE;
        const dx = mapCenterX - agoraX;
        const dz = mapCenterZ - agoraZ;
        const angleToCenter = Math.atan2(dx, dz);
        
        window.gfx.camera.alpha = angleToCenter + Math.PI;
        window.gfx.camera.beta = 1.1;
        window.gfx.camera.radius = 80;
      }
      
      // Force-load chunks at spawn position (CRITICAL for terrain to appear!)
      if (window.gfx && window.gfx.forceLoadChunks && window.gfx.cameraTarget) {
        const targetPos = window.gfx.cameraTarget.position;
        window.gfx.forceLoadChunks(targetPos.x, targetPos.z);
      }
      
      // Start LOD ramping for resources
      if (window.gfx && window.gfx.startGameLOD) {
        window.gfx.startGameLOD();
      }
      
      // Create the game with proper player objects
      // NOTE: Game constructor calls init() which spawns villagers
      // For replay, this is what we want - the initial state needs to be set up
      // Commands in the replay are player commands, not unit spawn commands
      if (window.Game) {
        window.game = new window.Game({
          type: replayData.gameType || 'replay',
          map: 'replay',
          players: players
        });
        // Game.init() runs automatically and spawns initial units
        window.game.gameState = 'running';
      }
      
      // Spawn visual meshes for all units that were just created
      if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
        window.spawnUnitModels(window.gfx.scene);
      }
      
      // Start the game loop (for rendering)
      if (window.gameLoop && window.gameLoop.start) {
        window.gameLoop.start();
      }
      
      console.log(`✅ Replay world initialized with ${players.length} players, field ${dims.width}x${dims.height}`);
    }
    
    // Show replay playback UI
    showReplayPlaybackUI(replayPlayer, replayData) {
      let controls = document.getElementById('replay_controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.id = 'replay_controls';
        controls.style.cssText = `
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.8);
          padding: 15px 25px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          gap: 15px;
          z-index: 10001;
          color: white;
          font-family: sans-serif;
        `;
        document.body.appendChild(controls);
      }
      
      controls.innerHTML = `
        <span style="font-weight: bold;">🎬 REPLAY</span>
        <button id="replay_pause" onclick="window.currentMatch && window.currentMatch.toggleReplayPause()" style="padding: 5px 15px; cursor: pointer;">⏸️</button>
        <input type="range" id="replay_progress" min="0" max="${replayPlayer.totalTicks}" value="0" 
               style="width: 200px;" onchange="window.currentMatch && window.currentMatch.seekReplay(this.value)">
        <span id="replay_tick">0 / ${replayPlayer.totalTicks}</span>
        <select id="replay_speed" onchange="window.currentMatch && window.currentMatch.setReplaySpeed(this.value)" style="padding: 5px;">
          <option value="0.5">0.5x</option>
          <option value="1" selected>1x</option>
          <option value="2">2x</option>
          <option value="4">4x</option>
        </select>
        <button onclick="window.currentMatch && window.currentMatch.stopReplay()" style="padding: 5px 15px; background: #c44; border: none; color: white; cursor: pointer; border-radius: 3px;">Stop</button>
      `;
      
      controls.style.display = 'flex';
      
      // Store replay player reference
      this.activeReplayPlayer = replayPlayer;
    }
    
    // Start replay playback
    startReplayPlayback(replayPlayer) {
      this.isReplayMode = true;
      this.replayPaused = false;
      this.replayTick = 0;
      
      const tickInterval = 1000 / (window.net?.TICK_RATE || 20); // 50ms per tick at 20Hz
      
      const playbackLoop = () => {
        if (!this.isReplayMode) return;
        
        if (!this.replayPaused) {
          // Get commands for this tick and execute them
          const commands = replayPlayer.getCommandsForTick(this.replayTick);
          commands.forEach(cmd => {
            try {
              this.executeCommand(cmd);
            } catch (e) {
              console.warn(`⚠️ Failed to execute replay command:`, cmd, e);
            }
          });
          
          // Step the physics/simulation forward (with error handling for replay mode)
          try {
            if (window.updateUnits) {
              window.updateUnits(1 / 20); // One tick at 20Hz
            }
          } catch (e) {
            // Units update may fail in replay mode - that's OK
            if (!this._unitUpdateWarned) {
              console.warn('⚠️ Unit update error in replay (suppressing further):', e.message);
              this._unitUpdateWarned = true;
            }
          }
          
          try {
            if (window.updateBuildings) {
              window.updateBuildings(1 / 20);
            }
          } catch (e) {
            // Buildings update may fail in replay mode - that's OK
          }
          
          this.replayTick++;
          
          // Step the replay player
          const hasMore = replayPlayer.step();
          
          // Update progress UI
          const progress = replayPlayer.getProgress();
          const progressBar = document.getElementById('replay_progress');
          const tickDisplay = document.getElementById('replay_tick');
          if (progressBar) progressBar.value = progress.currentTick;
          if (tickDisplay) tickDisplay.textContent = `${progress.currentTick} / ${progress.totalTicks}`;
          
          if (!hasMore || this.replayTick >= replayPlayer.totalTicks) {
            console.log('🎬 Replay complete!');
            this.showNotification('Replay complete', 'success');
            this.stopReplay();
            return;
          }
        }
        
        // Schedule next tick (adjusted by playback speed)
        const speed = parseFloat(document.getElementById('replay_speed')?.value || 1);
        setTimeout(playbackLoop, tickInterval / speed);
      };
      
      // Set up command execution callback
      replayPlayer.onTick = (tick, commands) => {
        // Execute each command for this tick
        commands.forEach(cmd => {
          try {
            this.executeCommand(cmd);
          } catch (error) {
            console.error(`❌ Error executing replay command at tick ${tick}:`, error);
          }
        });
        
        // Update game time
        this.tick = tick;
        this.gameTime = tick / (window.net?.TICK_RATE || 20);
      };
      
      // Start playback
      playbackLoop();
    }
    
    // Toggle replay pause
    toggleReplayPause() {
      this.replayPaused = !this.replayPaused;
      const btn = document.getElementById('replay_pause');
      if (btn) btn.textContent = this.replayPaused ? '▶️' : '⏸️';
    }
    
    // Seek to specific tick in replay
    seekReplay(tick) {
      if (this.activeReplayPlayer) {
        console.log(`🎬 Seeking to tick ${tick}`);
        // TODO: Implement proper seeking (requires state reset and replay)
        this.showNotification('Seek not yet implemented - restart replay to go to beginning', 'warning');
      }
    }
    
    // Set replay playback speed
    setReplaySpeed(speed) {
      console.log(`🎬 Replay speed: ${speed}x`);
    }
    
    // Stop replay
    stopReplay() {
      this.isReplayMode = false;
      this.activeReplayPlayer = null;
      
      // Remove controls
      const controls = document.getElementById('replay_controls');
      if (controls) controls.style.display = 'none';
      
      // Return to menu
      this.showNotification('Replay stopped', 'info');
    }
  }

  // Export to window
  window.Match = Match;
  window.MatchState = MatchState;
  
  // console.log('✅ Match system initialized');

})();

