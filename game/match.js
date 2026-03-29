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
      this.pauseContext = null;
      
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
      
      // DETERMINISM MODE: In live multiplayer, gameplay state stays command-driven.
      // Checkpoints are for detection/verification, not routine state correction.
      this.strictDeterminism = options.strictDeterminism !== undefined ? options.strictDeterminism : true;
      
      // INPUT DELAY: Number of ticks to delay command execution (lockstep sync)
      // This ensures all peers receive commands before they execute.
      // Higher = more sync safety, but more input lag
      // 5 ticks = 250ms at 20Hz (safer for real-world P2P lockstep, especially
      // during the first few live commands after match start).
      this.inputDelayTicks = options.inputDelayTicks !== undefined ? options.inputDelayTicks : 5;
      
      // Command queue and history
      this.pendingCommands = []; // Commands waiting to be executed
      this.commandHistory = []; // All commands for replay
      this.commandBuffer = new Map(); // Commands per tick per player
      this.commandSequenceByPlayer = new Map(); // playerId -> monotonically increasing local command sequence
      this.localTickInterval = null; // Offline tick loop handle
      
      // Synchronization
      this.checksums = new Map(); // Tick -> checksum for desync detection
      this.checksumComponents = new Map(); // Tick -> detailed components for desync debugging
      this.lastSyncTick = 0;
      this.syncInterval = 50; // Check sync every 50 ticks (2.5 seconds at 20Hz) - more frequent for smoother sync
      this.desyncDetected = false;
      
      // Tick synchronization tracking
      this.peerTickHistory = new Map(); // peerId -> array of {tick, receivedAt, localTick}
      this.tickSyncAdjustment = 0; // Adjustment to apply to tick rate (in ms)
      
      // CRITICAL: Queue for pending resource decrements to batch at sync checkpoints
      // This ensures both clients apply decrements at the same tick, preventing desyncs
      this.pendingResourceDecrements = []; // Array of {gridX, gridZ, amount, queuedAtTick}
      this.pendingResourceCredits = []; // Array of {playerId, resourceType, amount, queuedAtTick}

      // Persistent tracking of partially-depleted resource tiles.
      // checkTileForResources() is stateless (seed-based), so we store overrides here.
      // Key: "gridX,gridZ"  Value: remaining amount
      this.resourceRemaining = new Map();
      
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

    isLiveMultiplayerMatch() {
      if (!window.isMultiplayer || window.net?.offlineMode) {
        return false;
      }
      const humanPlayers = (this.players || []).filter(player => !player?.isAI);
      return humanPlayers.length > 1;
    }

    isAutoPauseReason(reason) {
      return reason === 'auto_hidden' || reason === 'auto_away';
    }

    isAutoAwayPauseActive() {
      return !!this.isPaused && this.pauseContext?.reason === 'auto_away';
    }

    isLocalAutoAwayPauseActive() {
      return this.isAutoAwayPauseActive() && !!this.pauseContext?.hiddenTriggered && !this.pauseContext?.remote;
    }

    isIntentionalPauseActive() {
      if (!this.isPaused) return false;
      return !this.isAutoPauseReason(this.pauseContext?.reason);
    }

    getPauseMessage(reason, fallbackMessage) {
      if (fallbackMessage) return fallbackMessage;
      if (reason === 'auto_away') return '⏸️ AUTO-AWAY PAUSE';
      if (reason === 'auto_hidden') return '⏸️ AUTO-PAUSED (TAB HIDDEN)';
      return '⏸️ PAUSED';
    }

    resetLoopTiming() {
      if (window.gameLoop) {
        window.gameLoop.physicsTime = 0;
        window.gameLoop.lastTime = performance.now();
      }
      if (window.gfx && window.gfx.menuGameLoop) {
        window.gfx.menuGameLoop.physicsTime = 0;
        window.gfx.menuGameLoop.lastTime = performance.now();
      }
      if (window.demo && window.demo.resetTiming) {
        window.demo.resetTiming();
      }
    }

    applyPauseState({
      reason = 'manual',
      message,
      broadcast = false,
      remote = false,
      hiddenTriggered = false
    } = {}) {
      if (this.state !== MatchState.PLAYING) {
        console.warn('⚠️ Cannot pause - match not playing');
        return false;
      }

      const pauseMessage = this.getPauseMessage(reason, message);
      const nextContext = {
        reason,
        message: pauseMessage,
        remote: !!remote,
        hiddenTriggered: !!hiddenTriggered,
        startedAt: Date.now()
      };

      if (this.isPaused) {
        if (this.pauseContext?.reason === nextContext.reason &&
            this.pauseContext?.message === nextContext.message &&
            this.pauseContext?.remote === nextContext.remote &&
            this.pauseContext?.hiddenTriggered === nextContext.hiddenTriggered) {
          return false;
        }
      }

      this.isPaused = true;
      this.pauseContext = nextContext;
      this.showLoadingOverlay();
      this.updateLoadingOverlay(pauseMessage);
      this.resetLoopTiming();

      if (broadcast && window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'match_pause',
          reason,
          message: pauseMessage
        });
      }

      return true;
    }

    onTabVisible(hiddenDurationSeconds = 0) {
      this.resetLoopTiming();
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
      // CRITICAL: Don't trigger countdown if match is already PLAYING
      // This can happen when a delayed onLocalPlayerLoaded() callback fires
      // after the match was already started via a different code path
      if (this.state === MatchState.PLAYING) {
        return;
      }
      
      // Only count human players (exclude AI)
      const humanPlayers = this.players.filter(p => !p.isAI);
      const totalHumanPlayers = humanPlayers.length;
      const loadedPlayers = this.playersLoaded.size;
      
      // console.log(`📊 Loading progress: ${loadedPlayers}/${totalHumanPlayers} human players ready (${this.players.length - totalHumanPlayers} AI)`);
      
      if (loadedPlayers >= totalHumanPlayers && !this.allPlayersReady) {
        this.allPlayersReady = true;
        // console.log(`🎉 All human players loaded! Starting countdown...`);

        if (this._chapterTransitionLoading) {
          if (this.isHost()) {
            this.updateLoadingOverlay(`Entering ${this._chapterTransitionLabel || 'next chapter'}...`);
            if (window.isMultiplayer && window.net && window.net.p2p) {
              window.net.p2p.sendData({ type: 'match_start' });
            }
            setTimeout(() => {
              this.beginPlaying();
            }, 150);
          } else {
            this.updateLoadingOverlay(`Loading ${this._chapterTransitionLabel || 'next chapter'}...`);
          }
          return;
        }
        
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
      // CRITICAL: Don't reset to READY if already PLAYING
      // This prevents race conditions with delayed callbacks
      if (this.state === MatchState.PLAYING) {
        return;
      }
      
      this.state = MatchState.READY;
      
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
                this.beginPlaying();
              }, 400);
            }, 1000);
          }, 1000);
        }, 1000);
      }, 100); // Small initial delay to ensure everything is settled
    }
    
    // Pause the match (broadcasts to all players in multiplayer)
    pauseMatch(options = {}) {
      const {
        reason = 'manual',
        message,
        broadcast = !!window.isMultiplayer,
        remote = false,
        hiddenTriggered = false
      } = options;

      return this.applyPauseState({
        reason,
        message,
        broadcast,
        remote,
        hiddenTriggered
      });
    }
    
    // Resume the match (broadcasts to all players in multiplayer)
    resumeMatch(options = {}) {
      if (!this.isPaused) {
        console.warn('⚠️ Match is not paused');
        return false;
      }

      const {
        broadcast = !!window.isMultiplayer,
        remote = false
      } = options;
      
      this.isPaused = false;
      this.pauseContext = null;
      // console.log('▶️ Match resumed');
      
      // Hide loading overlay
      const overlay = document.getElementById('match_loading_overlay');
      if (overlay) {
        overlay.style.display = 'none';
        overlay.style.zIndex = '-1';
      }

      this.resetLoopTiming();
      
      // Broadcast resume to all players
      if (!remote && broadcast && window.isMultiplayer && window.net && window.net.p2p) {
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
      this._chapterTransitionLoading = false;
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
      
      if (window.hiddenTabController && window.hiddenTabController.init) {
        window.hiddenTabController.init();
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
      
      // Initialize blob shadows for Low/Med shadow modes
      // This ensures blob shadows are created for all units when match starts,
      // even if the player never opened the settings menu
      if (window.SHADOW_MODE === undefined && window.hud && window.hud.initializeShadowsMode) {
        window.hud.initializeShadowsMode();
      }
      if ((window.SHADOW_MODE === 1 || window.SHADOW_MODE === 2) && window.gfx) {
        // Set blob shadow visibility
        if (window.gfx.setBlobShadowsVisible) {
          window.gfx.setBlobShadowsVisible(true);
        }
        // Create blob shadows for all existing units
        if (window.gfx.createBlobShadowsForAllUnits) {
          window.gfx.createBlobShadowsForAllUnits();
        }
      }
      
      // Initialize scene player for cinematic sequences
      if (window.ScenePlayer && window.adventureScenes && window.adventureScenes.length > 0) {
        this.scenePlayer = new ScenePlayer(window.adventureScenes, this);
        console.log(`🎬 Scene player ready with ${window.adventureScenes.length} scene(s)`);
      }

      // Start local tick loop for non-multiplayer matches (Adventure mode, etc.)
      // In multiplayer, the network system handles ticking
      if (!window.isMultiplayer) {
        this.startLocalTickLoop();
      }
      
      return true;
    }
    
    // Start a local tick loop for offline matches
    // force=true allows starting even when isMultiplayer is set (for solo adventure mode)
    startLocalTickLoop(force = false) {
      if (window.isMultiplayer && !force) {
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
      
      console.log(`🕒 Local match tick loop started at ${tickRate} Hz (force=${force})`);
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
      
      // AI worker/building management is handled by opponent.js (manageWorkerUnits)
      // via updateAIPlayers() above. No duplicate command generation needed here.
      
      // Execute commands for this tick
      this.executeCommandsForTick(this.tick);
      
      // CRITICAL: Check agora capture at fixed intervals (not every tick)
      // This ensures both clients check at the same time with synchronized positions
      // Checking every tick causes desyncs due to position drift between clients
      if (this.tick % 20 === 0) { // Check once per second for deterministic capture
        this.checkAgoraOccupation();
      }
      
      // Check victory conditions every second (respects victoryCondition setting)
      if (this.tick % 20 === 0) {
        this.checkVictoryConditions();
      }

      // Check scene triggers every second
      if (this.tick % 20 === 0 && this.scenePlayer) {
        this.scenePlayer.checkTriggers();
      }

      // Revert brigands back to villagers after 20s (400 ticks at 20Hz)
      if (this.tick % 20 === 0) {
        this.checkBrigandRevert();
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
      
      // Use faster checksum/resource checkpoints during active gameplay.
      //
      // This does NOT exchange unit positions. In strict lockstep, gameplay state stays
      // command-driven; checkpoints only keep deterministic resource state aligned and
      // verify that peers still match.
      //
      // - Default: 25 ticks (~1.25s) for 2p, 15 ticks (~0.75s) for 3+
      // - Adventure under stress: 10 ticks (~0.5s), or 5 ticks (~0.25s) at high input delay
      const isAdventureCoop = window.isMultiplayer && this.gameType === 'adventure';
      const underStress = isAdventureCoop && (this.inputDelayTicks || 0) >= 6;
      const activeSyncInterval = isAdventureCoop
        ? (underStress ? 5 : 10)
        : (isMultiPlayerGame ? 15 : 25);
      const currentSyncInterval = (hasActiveConstruction || hasActiveMovement) ? activeSyncInterval : this.syncInterval;
      
      if (this.tick % currentSyncInterval === 0) {
        // CRITICAL: Process pending resource decrements at sync checkpoint
        // This ensures both clients apply decrements at the same tick, preventing desyncs
        // Pass currentSyncInterval so filter window matches when we actually run
        this.processPendingResourceDecrements(currentSyncInterval);
        // Apply all queued autonomous income on the same checkpoint cadence.
        this.processPendingResourceCredits();
        // CRITICAL: Process pending resource depletions at sync checkpoint
        // This ensures both clients mark depletion at the same tick
        this.processPendingResourceDepletions();
        
        // Sync resource states at checkpoint BEFORE checksum calculation.
        this.syncResourceStatesAtCheckpoint();

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
        console.warn(`⚠️ Cannot submit command - match in ${this.state} state (type=${command.type})`);
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
      const isRealtimePlayerCommand =
        command.type === 'move' ||
        command.type === 'load' ||
        command.type === 'attack' ||
        command.type === 'attack_building' ||
        command.type === 'ability' ||
        command.type === 'gather' ||
        command.type === 'work';
      const isStatefulPlayerCommand =
        isRealtimePlayerCommand ||
        command.type === 'train' ||
        command.type === 'build' ||
        command.type === 'convert' ||
        command.type === 'unload' ||
        command.type === 'stop';
      const commandDelay = isRealtimePlayerCommand
        ? this.inputDelayTicks
        : (this.inputDelayTicks + 1);
      const normalizedLocalPlayerId = this.normalizeCommandPlayerId(this.localPlayerId);
      const normalizedWindowPlayerId = this.normalizeCommandPlayerId(window.player?.id || '');
      const normalizedRequestedPlayerId = this.normalizeCommandPlayerId(command.playerId || '');
      const requestedPlayerExists = normalizedRequestedPlayerId
        ? this.players.some(p => this.normalizeCommandPlayerId(p.id || p) === normalizedRequestedPlayerId)
        : false;

      // Local UI paths can still hand us a stale saved/localStorage-backed player ID.
      // For human-issued local commands, remap to the match's canonical localPlayerId.
      const shouldCanonicalizeLocalPlayerId = this.isLiveMultiplayerMatch() && (
        !normalizedRequestedPlayerId ||
        normalizedRequestedPlayerId === normalizedLocalPlayerId ||
        normalizedRequestedPlayerId === normalizedWindowPlayerId ||
        !requestedPlayerExists
      );
      const commandPlayerId = shouldCanonicalizeLocalPlayerId
        ? normalizedLocalPlayerId
        : (normalizedRequestedPlayerId || normalizedLocalPlayerId);
      const playerCommandSeq = this.nextPlayerCommandSequence(commandPlayerId);
      const baseScheduledTick = this.tick + commandDelay;
      const confirmedHorizon = (window.net && typeof window.net.getLocalConfirmedTick === 'function')
        ? window.net.getLocalConfirmedTick()
        : 0;
      const scheduledTick = Math.max(baseScheduledTick, confirmedHorizon + 1);
      
      const enrichedCommand = {
        ...command,
        matchId: this.id,
        playerId: commandPlayerId,
        tick: scheduledTick, // Never target a tick we've already confirmed to peers
        timestamp: Date.now(), // Metadata only - NOT used for scheduling or execution timing
        commandId: this.generateCommandId(),
        playerCommandSeq,
        priority: isStatefulPlayerCommand ? 'high' : 'normal' // Mark priority for network layer
      };

      this.traceMoveCommand('submit', enrichedCommand, {
        requestedPlayerId: command.playerId || null,
        requestedPlayerNorm: normalizedRequestedPlayerId || null,
        canonicalizedTo: commandPlayerId || null,
        canonicalized: shouldCanonicalizeLocalPlayerId,
        requestedPlayerExists,
        confirmedHorizon,
        inputDelayTicks: this.inputDelayTicks
      });
      this.traceBuildCommand('submit', enrichedCommand, {
        requestedPlayerId: command.playerId || null,
        requestedPlayerNorm: normalizedRequestedPlayerId || null,
        canonicalizedTo: commandPlayerId || null,
        canonicalized: shouldCanonicalizeLocalPlayerId,
        requestedPlayerExists,
        confirmedHorizon,
        inputDelayTicks: this.inputDelayTicks
      });
      
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
      
      // Add to pending queue / command buffer.
      // Repeated move spam for the same player+unit set+scheduled tick collapses to the latest intent.
      this.coalescePendingMoveCommand(enrichedCommand);
      const shouldBroadcast = this.bufferCommand(enrichedCommand);
      this.traceMoveCommand('submit-buffer-result', enrichedCommand, { shouldBroadcast });
      this.traceBuildCommand('submit-buffer-result', enrichedCommand, { shouldBroadcast });
      if (!shouldBroadcast) {
        return true;
      }
      
      // Send over network if multiplayer
      // CRITICAL: Player commands sent immediately (high priority)
      // Background commands can be batched/deferred
      if (window.isMultiplayer && window.net && window.net.p2p) {
        // Update last player command time for LOD sync frequency
        if (isStatefulPlayerCommand && window.net.updateLastPlayerCommandTime) {
          window.net.updateLastPlayerCommandTime();
        }
        
        // Send immediately with acknowledgment request for player commands
        const message = {
          type: 'game_command',
          command: enrichedCommand,
          requestAck: isStatefulPlayerCommand // Request acknowledgment for player commands
        };
        
        window.net.p2p.sendData(message);
        
        // Track command for acknowledgment if requested
        if (isStatefulPlayerCommand && window.net.trackCommandAck) {
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
        case 'load':
          return command.unitIds && command.transportId;
        case 'attack':
          return command.unitIds && command.targetId;
        case 'attack_building':
          return command.unitIds && command.buildingId;
        case 'build':
          return command.buildingType && (command.gridX !== undefined) && (command.gridZ !== undefined);
        case 'train':
          return command.unitType && command.buildingId;
        case 'convert':
          return command.unitId && command.targetType;
        case 'gather':
          return command.unitIds && (command.resourceId || command.targetResource);
        case 'ability':
          return command.unitId && command.abilityType;
        case 'unload':
          return command.unitId && command.target;
        default:
          return true; // Allow unknown command types
      }
    }

    normalizeCommandPlayerId(playerId) {
      if (!playerId) return '';
      const id = typeof playerId === 'string' ? playerId : String(playerId);
      return id.length > 6 ? id.slice(-6) : id;
    }

    shouldTraceMoveCommand(command) {
      return !!(command && command.type === 'move' && this.isLiveMultiplayerMatch());
    }

    traceMoveCommand(stage, command, extra = {}) {
      if (!this.shouldTraceMoveCommand(command)) return;
      const normalizeId = (id) => this.normalizeCommandPlayerId(id || '');
      const localNetId = window.net?.getStatus?.().localPlayerId || '';
      console.log(`🧭 MOVE TRACE ${stage}`, {
        matchTick: this.tick,
        matchState: this.state,
        localPlayerId: this.localPlayerId || null,
        localPlayerNorm: normalizeId(this.localPlayerId),
        windowPlayerId: window.player?.id || null,
        windowPlayerNorm: normalizeId(window.player?.id || ''),
        netLocalPlayerId: localNetId || null,
        netLocalPlayerNorm: normalizeId(localNetId),
        commandId: command.commandId || null,
        commandPlayerId: command.playerId || null,
        commandPlayerNorm: normalizeId(command.playerId || ''),
        playerCommandSeq: Number.isFinite(command.playerCommandSeq) ? command.playerCommandSeq : null,
        tick: Number.isFinite(command.tick) ? command.tick : null,
        unitIds: Array.isArray(command.unitIds) ? command.unitIds.slice() : [],
        transportAssignments: Array.isArray(command.transportAssignments)
          ? command.transportAssignments.map(entry => ({
              riderId: entry?.riderId || null,
              transportId: entry?.transportId || null
            }))
          : [],
        target: command.target
          ? {
              x: Math.round((command.target.x || 0) * 10) / 10,
              z: Math.round((command.target.z || 0) * 10) / 10
            }
          : null,
        ...extra
      });
    }

    shouldTraceBuildCommand(command) {
      return !!(command && command.type === 'build' && this.isLiveMultiplayerMatch());
    }

    traceBuildCommand(stage, command, extra = {}) {
      if (!this.shouldTraceBuildCommand(command)) return;
      const normalizeId = (id) => this.normalizeCommandPlayerId(id || '');
      const localNetId = window.net?.getStatus?.().localPlayerId || '';
      console.log(`🏗️ BUILD TRACE ${stage}`, {
        matchTick: this.tick,
        matchState: this.state,
        localPlayerId: this.localPlayerId || null,
        localPlayerNorm: normalizeId(this.localPlayerId),
        windowPlayerId: window.player?.id || null,
        windowPlayerNorm: normalizeId(window.player?.id || ''),
        netLocalPlayerId: localNetId || null,
        netLocalPlayerNorm: normalizeId(localNetId),
        commandId: command.commandId || null,
        commandPlayerId: command.playerId || null,
        commandPlayerNorm: normalizeId(command.playerId || ''),
        playerCommandSeq: Number.isFinite(command.playerCommandSeq) ? command.playerCommandSeq : null,
        tick: Number.isFinite(command.tick) ? command.tick : null,
        buildingType: command.buildingType || null,
        gridX: Number.isFinite(command.gridX) ? command.gridX : null,
        gridZ: Number.isFinite(command.gridZ) ? command.gridZ : null,
        ...extra
      });
    }

    nextPlayerCommandSequence(playerId) {
      const normalizedPlayerId = this.normalizeCommandPlayerId(playerId);
      const nextSeq = (this.commandSequenceByPlayer.get(normalizedPlayerId) || 0) + 1;
      this.commandSequenceByPlayer.set(normalizedPlayerId, nextSeq);
      return nextSeq;
    }

    getMoveCoalesceKey(command) {
      if (!command || command.type !== 'move' || !Array.isArray(command.unitIds) || command.unitIds.length === 0) {
        return null;
      }
      const normalizedPlayerId = this.normalizeCommandPlayerId(command.playerId);
      const unitKey = [...command.unitIds]
        .sort((a, b) => window.deterministicStringCompare(a, b))
        .join('|');
      return `${normalizedPlayerId}::${unitKey}`;
    }

    isIncomingMoveCommandNewer(existing, incoming) {
      const existingTick = Number.isFinite(existing?.tick) ? existing.tick : -1;
      const incomingTick = Number.isFinite(incoming?.tick) ? incoming.tick : -1;
      if (incomingTick !== existingTick) {
        return incomingTick > existingTick;
      }

      const existingSeq = Number.isFinite(existing?.playerCommandSeq) ? existing.playerCommandSeq : -1;
      const incomingSeq = Number.isFinite(incoming?.playerCommandSeq) ? incoming.playerCommandSeq : -1;
      if (incomingSeq !== existingSeq) {
        return incomingSeq > existingSeq;
      }

      return window.deterministicStringCompare(incoming?.commandId || '', existing?.commandId || '') > 0;
    }

    coalescePendingMoveCommand(incoming) {
      const moveKey = this.getMoveCoalesceKey(incoming);
      if (!moveKey) {
        this.pendingCommands.push(incoming);
        return;
      }

      const existingIndex = this.pendingCommands.findIndex(existing =>
        existing.tick === incoming.tick && this.getMoveCoalesceKey(existing) === moveKey
      );

      if (existingIndex === -1) {
        this.pendingCommands.push(incoming);
        return;
      }

      if (this.isIncomingMoveCommandNewer(this.pendingCommands[existingIndex], incoming)) {
        this.pendingCommands[existingIndex] = incoming;
      }
    }

    bufferCommand(command) {
      const tickKey = command.tick;
      if (!this.commandBuffer.has(tickKey)) {
        this.commandBuffer.set(tickKey, []);
      }

      const commands = this.commandBuffer.get(tickKey);
      if (command?.commandId) {
        const duplicateIndex = commands.findIndex(existing => existing?.commandId === command.commandId);
        if (duplicateIndex !== -1) {
          // ACK retries can resend the exact same lockstep command. Keep only one copy.
          commands[duplicateIndex] = command;
          this.traceMoveCommand('buffer-duplicate', command, { tickKey, duplicateIndex });
          this.traceBuildCommand('buffer-duplicate', command, { tickKey, duplicateIndex });
          return false;
        }
      }
      const moveKey = this.getMoveCoalesceKey(command);
      if (!moveKey) {
        commands.push(command);
        this.traceMoveCommand('buffer-insert', command, {
          tickKey,
          slot: commands.length - 1,
          bufferSize: commands.length,
          moveKey: null
        });
        this.traceBuildCommand('buffer-insert', command, {
          tickKey,
          slot: commands.length - 1,
          bufferSize: commands.length
        });
        return true;
      }

      const existingIndex = commands.findIndex(existing => this.getMoveCoalesceKey(existing) === moveKey);
      if (existingIndex === -1) {
        commands.push(command);
        this.traceMoveCommand('buffer-insert', command, {
          tickKey,
          slot: commands.length - 1,
          bufferSize: commands.length,
          moveKey
        });
        return true;
      }

      if (this.isIncomingMoveCommandNewer(commands[existingIndex], command)) {
        const replacedCommand = commands[existingIndex];
        commands[existingIndex] = command;
        this.traceMoveCommand('buffer-replace', command, {
          tickKey,
          existingIndex,
          moveKey,
          replacedCommandId: replacedCommand?.commandId || null,
          replacedPlayerSeq: Number.isFinite(replacedCommand?.playerCommandSeq) ? replacedCommand.playerCommandSeq : null,
          replacedTick: Number.isFinite(replacedCommand?.tick) ? replacedCommand.tick : null
        });
        return true;
      }

      this.traceMoveCommand('buffer-ignore-older', command, {
        tickKey,
        existingIndex,
        moveKey,
        keptCommandId: commands[existingIndex]?.commandId || null,
        keptPlayerSeq: Number.isFinite(commands[existingIndex]?.playerCommandSeq) ? commands[existingIndex].playerCommandSeq : null,
        keptTick: Number.isFinite(commands[existingIndex]?.tick) ? commands[existingIndex].tick : null
      });
      return false;
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
          return window.deterministicStringCompare(a.playerId, b.playerId);
        }
        const aSeq = Number.isFinite(a.playerCommandSeq) ? a.playerCommandSeq : -1;
        const bSeq = Number.isFinite(b.playerCommandSeq) ? b.playerCommandSeq : -1;
        if (aSeq !== bSeq) {
          return aSeq - bSeq;
        }
        return window.deterministicStringCompare(a.commandId, b.commandId);
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
        case 'load':
          this.executeLoadCommand(command);
          break;
        case 'attack':
          this.executeAttackCommand(command);
          break;
        case 'attack_building':
          this.executeAttackBuildingCommand(command);
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
        case 'unload':
          this.executeUnloadCommand(command);
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
      
      
      // P2P DETERMINISTIC: In live multiplayer, once a command is accepted into the
      // lockstep stream every peer must execute it for the referenced unit IDs.
      // Owner-ID filtering here has historically caused silent drops when player ID
      // normalization drifts between peers, leaving one side in linger and the other walking.
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
      const commandUnits = this.isLiveMultiplayerMatch() ? units : ownedUnits;
      
      // Debug logging for 3+ player games
      if (ownedUnits.length === 0 && units.length > 0 && window.isMultiplayer && window.net && window.net.p2p) {
        const connectedPeers = window.net.p2p.getConnectedPeers();
        if (connectedPeers.length >= 2 && Math.random() < 0.2) { // Log 20% of cases
          console.warn(`⚠️ [3+ PLAYER] No owned units found for player ${normalizedPlayerId}! Requested ${units.length} units, found 0. Command: ${cmd.type}, tick: ${cmd.tick}`);
        }
      }
      if (commandUnits.length === 0) {
        return;
      }
      
      // Check if any villagers are being commanded to move
      const hasVillagers = commandUnits.some(unit => unit.type === 'villager');

      commandUnits.forEach(unit => {
        unit._lastAppliedMoveCommand = {
          tick: cmd.tick,
          seq: cmd.playerCommandSeq,
          playerId: normalizedPlayerId,
          targetX: cmd.target?.x ?? null,
          targetZ: cmd.target?.z ?? null
        };
      });

      // Play villager movement sound if villagers are being commanded to move
      if (hasVillagers && window.aud && window.aud.playVillagerMove) {
        // Pass the first commanded unit for spatial positioning
        const firstUnit = commandUnits[0];
        window.aud.playVillagerMove(firstUnit);
      }

      // Clear stale transport targets from previous group moves
      commandUnits.forEach(unit => { delete unit._transportTarget; });

      // CRITICAL: When manually moving units, remove them from any building's worker list
      // This prevents them from being stuck in gather/build behaviors
      commandUnits.forEach(unit => {
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
      commandUnits.forEach(unit => {
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
          if (window.behaviorManager.deleteBehaviorDirect) {
            window.behaviorManager.deleteBehaviorDirect(unit, 'executeMove-delete', {
              commandId: cmd.commandId || null,
              sequence: cmd.sequence ?? null,
              target: cmd.target
                ? {
                    x: Math.round((cmd.target.x || 0) * 10) / 10,
                    z: Math.round((cmd.target.z || 0) * 10) / 10
                  }
                : null
            });
          } else {
            window.behaviorManager.behaviors.delete(unit);
          }
        }
        
        // Clear combat state when given a move order
        if (unit.state === 'attacking') {
          unit.state = 'idle';
          unit.target = null;
        }

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
      if (commandUnits.length === 1) {
        // Single unit - precise positioning
        const unit = commandUnits[0];
        if (window.behaviorManager && window.WalkBehavior) {
          // CRITICAL: Mark this as a player move command so auto-assignment doesn't immediately grab them
          const currentTick = this.tick || 0;
          unit.lastPlayerMoveTick = currentTick;
          // Broader protection: treat this as a recent player command for all autonomous systems.
          unit.lastPlayerCommandTick = currentTick;

          // console.log(`🚶 [T${currentTick}] Setting walk behavior for unit ${unit.id?.slice(-6)} from (${unit.pb.state.loc.x.toFixed(1)}, ${unit.pb.state.loc.z.toFixed(1)}) to (${cmd.target.x.toFixed(1)}, ${cmd.target.z.toFixed(1)})`);
          window.behaviorManager.setBehavior(unit, 'walk', {
            targetPoint: cmd.target,
            applyPersonalityOffset: false,
            forceDeterministicReset: true
          });

          // If this is a monk, check for nearby units to kick when starting movement
          if (unit.type === 'monk' && window.maybeAutoMonkKick) {
            // Reset periodic kick timer so periodic kicks start fresh
            unit._lastPeriodicKick = 0;
            window.maybeAutoMonkKick(unit, true); // forceCheck = true to kick immediately on command
          }
        }
      } else if (commandUnits.length > 1) {
        // Multiple units - spread them out in a formation around the target point
        const spacing = 2.5; // Distance between units
        const unitsPerRow = Math.ceil(Math.sqrt(commandUnits.length));
        
        // Sort units deterministically by ID for consistent formation
        const sortedUnits = [...commandUnits].sort((a, b) => window.deterministicStringCompare(a.id, b.id));
        
        sortedUnits.forEach((unit, index) => {
          if (window.behaviorManager && window.WalkBehavior) {
            // CRITICAL: Mark this as a player move command so auto-assignment doesn't immediately grab them
            const currentTick = this.tick || 0;
            unit.lastPlayerMoveTick = currentTick;
            unit.lastPlayerCommandTick = currentTick;
            
            // Calculate offset from center based on grid position
            const row = Math.floor(index / unitsPerRow);
            const col = index % unitsPerRow;
            
            // CRITICAL: Round formation offsets to ensure deterministic results
            // This prevents floating-point differences from causing units to converge
            const rowOffset = Math.round(((row - (Math.ceil(commandUnits.length / unitsPerRow) - 1) / 2) * spacing) * 100) / 100;
            const colOffset = Math.round(((col - (unitsPerRow - 1) / 2) * spacing) * 100) / 100;
            
            // CRITICAL: Round final target position to ensure determinism
            // Each unit gets a unique target based on their deterministic index
            const spreadTarget = {
              x: Math.round((cmd.target.x + colOffset) * 100) / 100,
              y: cmd.target.y,
              z: Math.round((cmd.target.z + rowOffset) * 100) / 100
            };

            // Explicit player moves already have deterministic spread targets assigned here.
            // Do not layer per-unit personality offsets on top, or peers can diverge.
            window.behaviorManager.setBehavior(unit, 'walk', {
              targetPoint: spreadTarget,
              applyPersonalityOffset: false,
              forceDeterministicReset: true
            });
            
            // If this is a monk, check for nearby units to kick when starting movement
            if (unit.type === 'monk' && window.maybeAutoMonkKick) {
              // Reset periodic kick timer so periodic kicks start fresh
              unit._lastPeriodicKick = 0;
              window.maybeAutoMonkKick(unit, true); // forceCheck = true to kick immediately on command
            }
          }
        });
      }

      const explicitTransportAssignments = Array.isArray(cmd.transportAssignments)
        ? cmd.transportAssignments
            .filter(entry => entry && entry.riderId && entry.transportId)
            .slice()
            .sort((a, b) => {
              const riderCompare = window.deterministicStringCompare(a.riderId || '', b.riderId || '');
              if (riderCompare !== 0) return riderCompare;
              return window.deterministicStringCompare(a.transportId || '', b.transportId || '');
            })
        : [];

      if (explicitTransportAssignments.length > 0 && commandUnits.length > 1) {
        const allUnits = window.gameUnits || [];
        const unitById = new Map(commandUnits.map(unit => [unit.id, unit]));
        const assignedPairs = [];

        explicitTransportAssignments.forEach(entry => {
          const rider = unitById.get(entry.riderId);
          const transport = unitById.get(entry.transportId) || this.getUnitById(entry.transportId);

          if (!rider || !transport || rider.id === transport.id || rider.carriedBy) return;
          if (!transport.abilities?.includes('transport')) return;

          const riderOwner = rider.owner?.length > 6 ? rider.owner.slice(-6) : rider.owner;
          const transportOwnerId = transport.owner?.length > 6 ? transport.owner.slice(-6) : transport.owner;
          if (riderOwner !== normalizedPlayerId || transportOwnerId !== normalizedPlayerId) return;

          const passengerCount = window.getTransportPassengerIds
            ? window.getTransportPassengerIds(transport, allUnits).length
            : (transport.passengers?.length || 0);
          const transportCapacity = Number.isFinite(transport.transportCapacity) ? transport.transportCapacity : Infinity;
          if (passengerCount >= transportCapacity) return;

          rider._transportTarget = transport.id;
          assignedPairs.push({
            riderId: rider.id,
            transportId: transport.id
          });
        });

        this.traceMoveCommand('execute-transport-plan', cmd, {
          appliedTransportAssignments: assignedPairs
        });
      } else if (!this.isLiveMultiplayerMatch() && commandUnits.length > 1) {
        // Transport auto-load fallback for legacy single-player move commands:
        // tag non-transport units with their nearest transport in the group.
        const transports = commandUnits.filter(u => u.abilities && u.abilities.includes('transport') && u.passengers);
        const riders = commandUnits.filter(u => !u.abilities || !u.abilities.includes('transport'));
        if (transports.length > 0 && riders.length > 0) {
          const sortedRiders = [...riders].sort((a, b) => window.deterministicStringCompare(a.id, b.id));
          sortedRiders.forEach(rider => {
            let bestTransport = null;
            let bestDistSq = Infinity;
            const rLoc = rider.pb && rider.pb.state ? rider.pb.state.loc : null;
            if (!rLoc) return;
            for (const t of transports) {
              const passengerCount = window.getTransportPassengerIds
                ? window.getTransportPassengerIds(t, commandUnits).length
                : (t.passengers?.length || 0);
              if (passengerCount >= t.transportCapacity) continue;
              const tLoc = t.pb && t.pb.state ? t.pb.state.loc : null;
              if (!tLoc) continue;
              const ddx = rLoc.x - tLoc.x;
              const ddz = rLoc.z - tLoc.z;
              const dSq = ddx * ddx + ddz * ddz;
              if (dSq < bestDistSq) {
                bestDistSq = dSq;
                bestTransport = t;
              }
            }
            if (bestTransport) {
              rider._transportTarget = bestTransport.id;
            }
          });
        }
      }

    }
    
    executeUnloadCommand(cmd) {
      const allUnits = window.gameUnits || [];
      const transport = allUnits.find(u => u.id === cmd.unitId);
      if (!transport) return;
      if (this.isLiveMultiplayerMatch()) {
        console.log('🛬 UNLOAD TRACE command', {
          tick: this.tick,
          commandId: cmd.commandId || null,
          playerId: cmd.playerId || null,
          playerNorm: this.normalizeCommandPlayerId(cmd.playerId || ''),
          transportId: cmd.unitId || null,
          target: cmd.target
            ? {
                x: Math.round((cmd.target.x || 0) * 10) / 10,
                z: Math.round((cmd.target.z || 0) * 10) / 10
              }
            : null
        });
      }
      if (window.unloadPassengers) {
        window.unloadPassengers(transport, cmd.target);
      }
    }

    executeLoadCommand(cmd) {
      const transport = this.getUnitById(cmd.transportId);
      const units = this.getUnitsByIds(cmd.unitIds);
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      const transportOwner = (transport?.owner || '').length > 6 ? transport.owner.slice(-6) : transport?.owner;

      if (!transport || transportOwner !== normalizedPlayerId || !transport.abilities?.includes('transport')) {
        console.warn('🛫 LOAD TRACE reject', {
          tick: this.tick || 0,
          rawPlayerId,
          normalizedPlayerId,
          transportId: cmd.transportId || null,
          transportFound: !!transport,
          transportOwner: transport?.owner || null,
          transportOwnerNorm: transportOwner || null,
          transportAbilities: transport?.abilities?.slice?.() || []
        });
        return;
      }

      const currentTick = this.tick || 0;
      const sortedRiders = units
        .filter(unit => {
          if (!unit || unit.id === transport.id || unit.carriedBy) return false;
          if (unit.abilities?.includes('transport')) return false;
          const unitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
          return unitOwner === normalizedPlayerId;
        })
        .sort((a, b) => window.deterministicStringCompare(a.id || '', b.id || ''));

      const tLoc = transport.pb?.state?.loc;
      if (!tLoc) return;

      const getPassengerCount = () => window.getTransportPassengerIds
        ? window.getTransportPassengerIds(transport, window.gameUnits || []).length
        : (transport.passengers?.length || 0);
      const transportCapacity = Number.isFinite(transport.transportCapacity) ? transport.transportCapacity : Infinity;
      const tileSize = window.TILE_SIZE || 4;
      const isInSameTileDeterministic = (a, b) =>
        Math.floor(a.x / tileSize) === Math.floor(b.x / tileSize) &&
        Math.floor(a.z / tileSize) === Math.floor(b.z / tileSize);
      const getStableDistanceSqDeterministic = (a, b) => {
        const ax = Math.round(a.x * 10) / 10;
        const az = Math.round(a.z * 10) / 10;
        const bx = Math.round(b.x * 10) / 10;
        const bz = Math.round(b.z * 10) / 10;
        const dx = bx - ax;
        const dz = bz - az;
        return Math.round((dx * dx + dz * dz) * 1000) / 1000;
      };
      const transportLoadRangeSq = 36;

      console.log('🛫 LOAD TRACE execute', {
        tick: currentTick,
        rawPlayerId,
        normalizedPlayerId,
        transportId: transport.id || null,
        transportOwner: transport.owner || null,
        passengerCount: getPassengerCount(),
        transportCapacity,
        riderIds: sortedRiders.map(rider => rider.id)
      });

      sortedRiders.forEach(rider => {
        if (getPassengerCount() >= transportCapacity) {
          console.warn('🛫 LOAD TRACE capacity-stop', {
            tick: currentTick,
            transportId: transport.id || null,
            riderId: rider.id || null,
            passengerCount: getPassengerCount(),
            transportCapacity
          });
          return;
        }

        rider.lastPlayerCommandTick = currentTick;
        rider.lastPlayerMoveTick = currentTick;
        rider._transportTarget = transport.id;

        const rLoc = rider.pb?.state?.loc;
        if (!rLoc) return;

        const closeEnough = isInSameTileDeterministic(rLoc, tLoc) ||
          getStableDistanceSqDeterministic(rLoc, tLoc) <= transportLoadRangeSq;

        console.log('🛫 LOAD TRACE rider', {
          tick: currentTick,
          transportId: transport.id || null,
          riderId: rider.id || null,
          riderOwner: rider.owner || null,
          riderLoc: {
            x: Math.round((rLoc.x || 0) * 10) / 10,
            z: Math.round((rLoc.z || 0) * 10) / 10
          },
          transportLoc: {
            x: Math.round((tLoc.x || 0) * 10) / 10,
            z: Math.round((tLoc.z || 0) * 10) / 10
          },
          closeEnough
        });

        if (closeEnough && window.loadUnitIntoTransport) {
          window.loadUnitIntoTransport(rider, transport);
          return;
        }

        if (window.behaviorManager) {
          window.behaviorManager.setBehavior(rider, 'walk', {
            targetPoint: {
              x: Math.round((tLoc.x || 0) * 100) / 100,
              z: Math.round((tLoc.z || 0) * 100) / 100
            },
            applyPersonalityOffset: false,
            forceDeterministicReset: true
          });
        }
      });
    }

    executeAttackCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const target = this.getUnitById(cmd.targetId);
      
      if (!target) return;
      
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId === normalizedPlayerId) {
          unit.target = target;
          unit.state = 'attacking';
          
          if (window.behaviorManager) {
            window.behaviorManager.setBehavior(unit, 'attack_unit', { target: target });
          }
        }
      });
    }

    executeAttackBuildingCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const building = this.getBuildingById(cmd.buildingId);

      if (!building) return;
      if (building.type === 'agora') return;

      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;

      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId !== normalizedPlayerId) return;

        unit.lastPlayerCommandTick = this.tick || 0;

        if (unit.assignedBuilding) {
          const oldBuilding = unit.assignedBuilding;
          if (oldBuilding.assignedWorkers) {
            oldBuilding.assignedWorkers = oldBuilding.assignedWorkers.filter(w => w !== unit);
          }
          unit.assignedBuilding = null;
        }

        if (window.behaviorManager) {
          window.behaviorManager.setBehavior(unit, 'attack_building', { building });
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
        
        // CRITICAL: Add building to the player's buildings array!
        // Without this, AI players (and multiplayer players) can't track their own buildings.
        // This was missing, causing AI villagers to never find buildings to work at.
        if (player && player.buildings) {
          player.buildings.push(building);
        }
        
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
      const shouldLogTrain = cmd.unitType === 'dirigible';
      
      // Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      const normalizedOwner = (building?.owner || '').length > 6 ? building.owner.slice(-6) : building?.owner;

      if (shouldLogTrain && this.isLiveMultiplayerMatch()) {
        console.log('🛫 TRAIN TRACE execute', {
          tick: this.tick,
          commandId: cmd.commandId || null,
          commandPlayerId: cmd.playerId || null,
          normalizedPlayerId,
          buildingId: cmd.buildingId || null,
          buildingExists: !!building,
          buildingType: building?.type || null,
          buildingOwner: building?.owner || null,
          normalizedOwner: normalizedOwner || null,
          buildProgress: Number.isFinite(building?.buildProgress) ? Math.round(building.buildProgress * 1000) / 1000 : null,
          playerExists: !!player,
          playerId: player?.id || null
        });
      }
      
      if (!building || !player || normalizedOwner !== normalizedPlayerId) {
        if (shouldLogTrain) {
          console.warn('❌ Dirigible train rejected before spawn:', {
            commandPlayerId: cmd.playerId,
            normalizedPlayerId,
            buildingId: cmd.buildingId,
            buildingExists: !!building,
            buildingType: building?.type || null,
            buildingOwner: building?.owner || null,
            normalizedOwner: normalizedOwner || null,
            buildProgress: Number.isFinite(building?.buildProgress) ? Math.round(building.buildProgress * 1000) / 1000 : null,
            playerExists: !!player
          });
        }
        return;
      }

      // Validate building can spawn this unit type
      const unitDef = window.UnitTypes?.[cmd.unitType];
      if (unitDef && unitDef.spawner && building.type !== unitDef.spawner) {
        if (shouldLogTrain) {
          console.warn('❌ Dirigible train rejected: wrong spawner type', {
            buildingId: cmd.buildingId,
            buildingType: building.type,
            requiredSpawner: unitDef.spawner,
            buildProgress: Number.isFinite(building?.buildProgress) ? Math.round(building.buildProgress * 1000) / 1000 : null
          });
        }
        return;
      }
      
      // Check resources
      const cost = this.getUnitCost(cmd.unitType);
      if (!this.canAfford(player, cost)) {
        if (shouldLogTrain) {
          console.warn('❌ Dirigible train rejected: cannot afford', {
            playerId: player.id,
            resources: player.resources,
            cost
          });
        }
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

      if (shouldLogTrain) {
        console.log('✅ Dirigible train spawned:', {
          playerId: player.id,
          buildingId: building.id,
          unitId: unit.id
        });
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
      
      // Only allow villager->brigand and brigand->villager conversions
      const allowedConversions = { villager: ['brigand'], brigand: ['villager'] };
      if (!allowedConversions[unit.type] || !allowedConversions[unit.type].includes(cmd.targetType)) {
        console.warn(`⚠️ Cannot convert ${unit.type} to ${cmd.targetType}`);
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
      const oldHealthValue = Number.isFinite(unit.currentHealth) ? unit.currentHealth :
        (Number.isFinite(unit.health) ? unit.health : null);
      const oldVelocity = (unit.pb && unit.pb.state && unit.pb.state.vel)
        ? {
            x: Number.isFinite(unit.pb.state.vel.x) ? unit.pb.state.vel.x : 0,
            y: Number.isFinite(unit.pb.state.vel.y) ? unit.pb.state.vel.y : 0,
            z: Number.isFinite(unit.pb.state.vel.z) ? unit.pb.state.vel.z : 0
          }
        : null;
      const oldImpulse = unit.pb && unit.pb.imp
        ? {
            x: Number.isFinite(unit.pb.imp.x) ? unit.pb.imp.x : 0,
            y: Number.isFinite(unit.pb.imp.y) ? unit.pb.imp.y : 0,
            z: Number.isFinite(unit.pb.imp.z) ? unit.pb.imp.z : 0
          }
        : null;
      const oldLastAppliedMoveCommand = unit._lastAppliedMoveCommand
        ? { ...unit._lastAppliedMoveCommand }
        : null;
      const oldLastPlayerCommandTick = unit.lastPlayerCommandTick;
      const oldLastPlayerMoveTick = unit.lastPlayerMoveTick;
      
      // CRITICAL: Preserve the current behavior (e.g., if walking somewhere)
      const currentBehavior = window.behaviorManager?.getBehavior(unit);
      const behaviorType = currentBehavior?.constructor?.name;
      const behaviorTarget = currentBehavior?.targetPoint;
      
      // CRITICAL: Check if this unit is currently selected by the player
      const wasSelected = player.selectedUnits?.includes(unit);
      
      // CRITICAL: Remove old unit from behavior manager BEFORE creating new unit
      // This prevents desync from duplicate behaviors
      if (window.behaviorManager && window.behaviorManager.behaviors) {
        if (window.behaviorManager.deleteBehaviorDirect) {
          window.behaviorManager.deleteBehaviorDirect(unit, 'convert-delete-old-unit');
        } else {
          window.behaviorManager.behaviors.delete(unit);
        }
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
      
      // Clean up particle effects (torches, etc.) before disposing mesh
      if (window.fx && window.fx.removeParticleEffects) {
        window.fx.removeParticleEffects(unit);
      }

      // Clean up selection indicator
      if (unit.selectionIndicator) {
        unit.selectionIndicator.dispose();
        unit.selectionIndicator = null;
      }

      // Clean up blob shadow
      if (window.gfx && window.gfx.removeBlobShadow) {
        window.gfx.removeBlobShadow(unit);
      }

      // Clean up LOD billboard
      if (unit.billboard) {
        if (window.gfx && window.gfx.returnBillboardInstance) {
          window.gfx.returnBillboardInstance(unit.billboard);
        } else if (unit.billboard.dispose) {
          unit.billboard.dispose();
        }
        unit.billboard = null;
      }

      // Stop animation groups before disposing
      if (unit.animationGroups) {
        Object.values(unit.animationGroups).forEach(g => { if (g.stop) g.stop(); if (g.dispose) g.dispose(); });
        unit.animationGroups = null;
      }

      // Dispose old mesh and all children
      if (oldMesh) {
        if (oldMesh.dispose) {
          oldMesh.dispose(false, true);
        }
      }
      unit.mesh = null;
      
      // Create new unit of target type at same position
      // CRITICAL: Pass owner AND id in constructor options so commands still reference the same unit!
      const newUnit = new window.Unit(cmd.targetType, oldPosition, { owner: normalizedPlayerId, id: oldId });
      
      // VERIFY: Double-check owner was set correctly
      if (newUnit.owner !== normalizedPlayerId) {
        // Force correct it
        newUnit.owner = normalizedPlayerId;
      }

      if (Number.isFinite(oldHealthValue)) {
        const preservedHealth = (cmd.resetHealth === true)
          ? (newUnit.health || oldHealthValue)
          : Math.max(0, Math.min(newUnit.health || oldHealthValue, oldHealthValue));
        newUnit.health = preservedHealth;
        newUnit.currentHealth = preservedHealth;
      }
      
      newUnit.rotation = oldRotation;
      if (newUnit.pb && newUnit.pb.state && newUnit.pb.state.rot) {
        newUnit.pb.state.rot.y = oldRotation;
      }
      if (newUnit.pb && newUnit.pb.state && newUnit.pb.state.vel && oldVelocity) {
        newUnit.pb.state.vel.x = oldVelocity.x;
        newUnit.pb.state.vel.y = oldVelocity.y;
        newUnit.pb.state.vel.z = oldVelocity.z;
      }
      if (newUnit.pb && newUnit.pb.imp && oldImpulse) {
        newUnit.pb.imp.x = oldImpulse.x;
        newUnit.pb.imp.y = oldImpulse.y;
        newUnit.pb.imp.z = oldImpulse.z;
      }
      if (oldLastAppliedMoveCommand) {
        newUnit._lastAppliedMoveCommand = oldLastAppliedMoveCommand;
      }
      if (oldLastPlayerCommandTick !== undefined) {
        newUnit.lastPlayerCommandTick = oldLastPlayerCommandTick;
      }
      if (oldLastPlayerMoveTick !== undefined) {
        newUnit.lastPlayerMoveTick = oldLastPlayerMoveTick;
      }
      
      // Track when brigands were created so they revert after a delay
      if (cmd.targetType === 'brigand') {
        newUnit.brigandCreatedTick = this.tick;
      }

      // Add to arrays BEFORE spawning mesh (so spawnUnitModels can find it)
      player.units.push(newUnit);
      window.gameUnits.push(newUnit);
      
      // Restore behavior (keep moving if they were moving)
      // CRITICAL: Set behavior BEFORE spawning model to ensure determinism
      if (cmd.postConvertBehavior && window.behaviorManager) {
        window.behaviorManager.setBehavior(newUnit, cmd.postConvertBehavior, cmd.postConvertParams || {});
      } else if (behaviorType === 'WalkBehavior' && behaviorTarget && window.behaviorManager) {
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
      const resource = cmd.targetResource || this.getResourceById(cmd.resourceId);
      if (!resource) return;
      
      // CRITICAL: Normalize player ID for ownership check
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      // P2P DETERMINISTIC: Execute all commands on both clients
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId === normalizedPlayerId) {
          unit.lastPlayerCommandTick = this.tick || 0;

          if (unit.assignedBuilding) {
            const prev = unit.assignedBuilding;
            if (prev.assignedWorkers) {
              prev.assignedWorkers = prev.assignedWorkers.filter(w => w !== unit);
            }
            unit.assignedBuilding = null;
          }

          if (window.behaviorManager) {
            window.behaviorManager.setBehavior(unit, 'manual_gather', { targetResource: resource });
          }
        }
      });
    }
    
    executeWorkCommand(cmd) {
      const units = this.getUnitsByIds(cmd.unitIds);
      const building = this.getBuildingById(cmd.buildingId);
      
      if (!building) return;
      
      const rawPlayerId = cmd.playerId || '';
      const normalizedPlayerId = rawPlayerId.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;
      
      units.forEach(unit => {
        const unitOwnerId = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
        if (unitOwnerId !== normalizedPlayerId) return;
        
        unit.lastPlayerCommandTick = this.tick || 0;
        
        // Remove from previous building assignment
        if (unit.assignedBuilding && unit.assignedBuilding !== building) {
          const prev = unit.assignedBuilding;
          if (prev.assignedWorkers) {
            prev.assignedWorkers = prev.assignedWorkers.filter(w => w !== unit);
          }
        }
        
        // Skip if already assigned to this building
        if (unit.assignedBuilding === building) return;
        
        // Check capacity
        if (building.assignedWorkers && building.assignedWorkers.length >= (building.maxWorkers || 3)) return;
        
        // Set behavior based on building state
        if (window.behaviorManager) {
          const effectiveWorkType = (!building.completionProcessed && building.workType === 'build')
            ? 'build'
            : building.workType;
          if (effectiveWorkType === 'build') {
            window.behaviorManager.setBehavior(unit, 'build_work', { building: building });
          } else if (effectiveWorkType === 'gather' || effectiveWorkType === 'mine') {
            const gatherParams = { building: building };
            if (effectiveWorkType === 'mine') {
              gatherParams.gatherDuration = 7500;
              gatherParams.resourceTypes = ['stone', 'minerals'];
            }
            window.behaviorManager.setBehavior(unit, 'gather_work', gatherParams);
          } else if (effectiveWorkType === 'farm') {
            window.behaviorManager.setBehavior(unit, 'farm_work', { building: building });
          } else {
            window.behaviorManager.setBehavior(unit, 'work', { building: building });
          }
        }
        
        // Track worker assignment
        if (!building.assignedWorkers) building.assignedWorkers = [];
        building.assignedWorkers.push(unit);
        unit.assignedBuilding = building;
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
    
    // generateAICommands removed - all AI logic handled by opponent.js updateAI/manageWorkerUnits
    
    checkBrigandRevert() {
      const REVERT_TICKS = 400; // 20s at 20Hz
      const units = window.gameUnits;
      if (!units) return;

      for (let i = units.length - 1; i >= 0; i--) {
        const unit = units[i];
        if (unit.type !== 'brigand' || !unit.brigandCreatedTick) continue;
        if (this.tick - unit.brigandCreatedTick < REVERT_TICKS) continue;

        const player = this.getPlayerById(unit.owner);
        if (!player) continue;

        this.executeConvertCommand({
          type: 'convert',
          playerId: unit.owner,
          unitId: unit.id,
          targetType: 'villager'
        });
      }
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
        case 'objectives':
          // Adventure mode - check if any player's units have reached objective zones
          this.checkObjectiveVictory();
          this.checkAdventureDefeat();
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
        this.players.forEach(p => {
          const pid = p.id || p;
          const unitCount = p.units?.length || 0;
          const villagerCount = p.units?.filter(u => u && u.type === 'villager').length || 0;
        });
      }
      
      // Check each player's units and buildings
      this.players.forEach(player => {
        const pid = player.id || player;
        
        if (this.eliminatedPlayers.has(pid)) {
          return; // Already eliminated
        }
        
        // Loss condition: Player has no living units at all (0 pop)
        const livingUnits = player.units?.filter(u => u && !u.dead) || [];
        if (livingUnits.length === 0) {
          console.log(`💀 Player ${pid} has no units remaining - eliminated!`);
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
    
    // Check if any player's units have reached objective zones (adventure mode)
    checkObjectiveVictory() {
      const objectives = window.adventureObjectives;
      if (!objectives || objectives.length === 0) return;
      
      // If we've already handled adventure victory, don't re-trigger the flow.
      if (this._adventureVictoryHandled) return;
      
      // In multiplayer co-op, make objective completion HOST-authoritative.
      // Unit positions can diverge slightly between peers; letting both sides decide can
      // cause one peer to "win" early and the other to never transition.
      if (window.isMultiplayer && !this.isHost()) {
        return;
      }
      
      // TILE_SIZE is a global constant from constants.js (value = 4)
      const tileSize = (typeof TILE_SIZE !== 'undefined') ? TILE_SIZE : 4;
      
      // Get player-owned units only (exclude enemy/NPC units from objective checks).
      // Build a set of normalized player IDs so we can quickly filter.
      const playerIdSet = new Set();
      if (this.players && this.players.length > 0) {
        for (const p of this.players) {
          const pid = p.id || '';
          playerIdSet.add(pid.length > 6 ? pid.slice(-6) : pid);
        }
      }
      const allUnits = (window.gameUnits || []).filter(u => {
        if (!u || u.dead) return false;
        if (playerIdSet.size === 0) return true;
        const owner = (u.owner || '').length > 6 ? u.owner.slice(-6) : (u.owner || '');
        return playerIdSet.has(owner);
      });
      
      if (allUnits.length === 0) return;

      const getObjectiveUnitPosition = (unit) => {
        if (!unit) return { x: 0, z: 0 };

        // Carried passengers keep a stale pb.loc while loaded, so use their transport position
        // for objective checks. This matches transport LOD handling and keeps exit checks sane.
        if (unit.carriedBy) {
          const transport = allUnits.find(other => other && other.id === unit.carriedBy);
          if (transport?.pb?.state?.loc) {
            return {
              x: transport.pb.state.loc.x,
              z: transport.pb.state.loc.z
            };
          }
        }

        if (unit.pb?.state?.loc) {
          return {
            x: unit.pb.state.loc.x,
            z: unit.pb.state.loc.z
          };
        }

        if (unit.mesh?.position) {
          return {
            x: unit.mesh.position.x,
            z: unit.mesh.position.z
          };
        }

        return { x: 0, z: 0 };
      };

      const getAdventureEscapeGroups = () => {
        // Escape objectives should track the authored adventure party, not every living
        // human-owned unit in the match. That prevents built extras or allied squads from
        // blocking chapter exits, and matches the "our party escaped" expectation.
        const startingPartyUnits = allUnits.filter(unit =>
          Number.isFinite(unit?.adventureSpawnIndex) &&
          !unit?.isNPC
        );
        const sourceUnits = startingPartyUnits.length > 0 ? startingPartyUnits : allUnits;
        const groups = new Map();

        sourceUnits.forEach(unit => {
          const owner = unit?.owner || '';
          if (!owner) return;
          if (!groups.has(owner)) groups.set(owner, []);
          groups.get(owner).push(unit);
        });

        return Array.from(groups.entries())
          .map(([owner, units]) => ({
            owner,
            units: units.slice().sort((a, b) => window.deterministicStringCompare(a.id || '', b.id || ''))
          }))
          .filter(group => group.units.length > 0)
          .sort((a, b) => window.deterministicStringCompare(a.owner || '', b.owner || ''));
      };
      
      let objectivesCompleted = 0;
      
      for (const obj of objectives) {
        if (obj.completed) {
          objectivesCompleted++;
          continue;
        }
        
        // Get objective world position (center of tile)
        const objWorldX = obj.x * tileSize + 0.5 * tileSize;
        const objWorldZ = obj.y * tileSize + 0.5 * tileSize;
        const objRadius = obj.radius * tileSize;
        
        if (obj.type === 'reach' || obj.type === 'escape') {
          // Check each unit's position against the objective zone
          for (const unit of allUnits) {
            const pos = getObjectiveUnitPosition(unit);
            const unitX = pos.x;
            const unitZ = pos.z;
            const dx = unitX - objWorldX;
            const dz = unitZ - objWorldZ;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist <= objRadius) {
              if (obj.type === 'reach') {
                // Reach objective - any unit triggers it
                obj.completed = true;
                objectivesCompleted++;
                console.log(`🎯 Objective ${obj.id + 1} completed! Unit reached zone at (${obj.x}, ${obj.y}), message="${obj.message || '(none)'}"`);
                
                // Show speech bubble on the unit if message exists
                if (obj.message && window.UnitSpeech && window.UnitSpeech.showSpeech) {
                  console.log(`💬 Showing speech: "${obj.message}" on unit ${unit.id}`);
                  window.UnitSpeech.showSpeech(unit, obj.message, 4000);
                  
                  // Broadcast objective completion to peers (host authoritative)
                  if (window.isMultiplayer && window.net && window.net.p2p) {
                    window.net.p2p.sendData({
                      type: 'adventure_objective_complete',
                      objectiveId: obj.id,
                      unitId: unit.id,
                      message: obj.message,
                      objectiveType: obj.type
                    });
                  }
                } else if (window.ui && window.ui.showNotification) {
                  window.ui.showNotification(`🎯 Objective Complete!`, 'success');
                }
                break;
              }
            }
          }
        }
        
        // For escape objectives, check if ALL units are in the zone
        if (obj.type === 'escape' && !obj.completed) {
          const escapeGroups = getAdventureEscapeGroups();
          let completedEscapeGroup = null;
          let unitsInZone = [];

          for (const group of escapeGroups) {
            const groupUnitsInZone = group.units.filter(unit => {
              const pos = getObjectiveUnitPosition(unit);
              const dx = pos.x - objWorldX;
              const dz = pos.z - objWorldZ;
              return Math.sqrt(dx * dx + dz * dz) <= objRadius;
            });

            if (group.units.length > 0 && groupUnitsInZone.length === group.units.length) {
              completedEscapeGroup = group;
              unitsInZone = groupUnitsInZone;
              break;
            }
          }
          
          if (completedEscapeGroup) {
            obj.completed = true;
            objectivesCompleted++;
            console.log(`🎯 Escape objective ${obj.id + 1} completed! Party ${completedEscapeGroup.owner} escaped at (${obj.x}, ${obj.y}) with ${unitsInZone.length} units`);
            
            // Show speech bubble on first unit if message exists
            if (obj.message && window.UnitSpeech && window.UnitSpeech.showSpeech && unitsInZone.length > 0) {
              console.log(`💬 Showing escape speech: "${obj.message}" on unit ${unitsInZone[0].id}`);
              window.UnitSpeech.showSpeech(unitsInZone[0], obj.message, 4000);
              
              // Broadcast objective completion to peers (host authoritative)
              if (window.isMultiplayer && window.net && window.net.p2p) {
                window.net.p2p.sendData({
                  type: 'adventure_objective_complete',
                  objectiveId: obj.id,
                  unitId: unitsInZone[0].id,
                  message: obj.message,
                  objectiveType: obj.type
                });
              }
            } else if (window.ui && window.ui.showNotification) {
              window.ui.showNotification(`🚪 All units escaped!`, 'success');
            }
          }
        }
      }
      
      // Log progress periodically so incomplete objectives are visible in console
      if (objectivesCompleted > 0 && objectivesCompleted < objectives.length && this.tick % 200 === 0) {
        const incomplete = objectives.filter(o => !o.completed).map(o => `#${o.id+1} ${o.type}@(${o.x},${o.y})`);
        console.log(`🎯 Objectives: ${objectivesCompleted}/${objectives.length} — incomplete: ${incomplete.join(', ')}`);
      }

      // Check if all objectives are completed
      if (objectivesCompleted === objectives.length && objectives.length > 0) {
        
        // Show victory dialogue and transition to next chapter
        this._adventureVictoryHandled = true;
        // Stop simulation while the victory/transition UI is up to avoid repeated triggers.
        this.isPaused = true;
        this.state = MatchState.VICTORY;
        
        // Broadcast adventure victory so all peers show the prompt even if their local
        // floating-point positions differ slightly.
        if (window.isMultiplayer && window.net && window.net.p2p) {
          window.net.p2p.sendData({ type: 'adventure_victory' });
        }
        this.handleAdventureVictory();
      }
    }
    
    // Check if all player units are dead in adventure mode
    checkAdventureDefeat() {
      if (this.state === MatchState.VICTORY || this.state === MatchState.DEFEAT) return;
      if (this._adventureVictoryHandled) return;
      // Grace period — don't check during the first 5 seconds
      if (this.tick < 100) return;

      // In multiplayer, only the host decides defeat (same as objectives)
      if (window.isMultiplayer && !this.isHost()) return;

      // Build set of player owner IDs (same logic as checkObjectiveVictory)
      const playerIdSet = new Set();
      if (this.players && this.players.length > 0) {
        for (const p of this.players) {
          const pid = p.id || '';
          playerIdSet.add(pid.length > 6 ? pid.slice(-6) : pid);
        }
      }

      const livingPlayerUnits = (window.gameUnits || []).filter(u => {
        if (!u || u.dead) return false;
        if (playerIdSet.size === 0) return true;
        const owner = (u.owner || '').length > 6 ? u.owner.slice(-6) : (u.owner || '');
        return playerIdSet.has(owner);
      });

      if (livingPlayerUnits.length > 0) return;

      console.log('💀 Adventure defeat — all player units are dead');
      this.isPaused = true;
      this.state = MatchState.DEFEAT;
      this.replay = this.replay || {};
      this.replay.reason = 'objectives';
      this.replay.winner = null;

      if (window.isMultiplayer && window.net && window.net.p2p) {
        window.net.p2p.sendData({ type: 'adventure_defeat' });
      }

      if (window.showStoryDialogue) {
        window.showStoryDialogue('💀 All units lost. Mission failed.', 'defeat', () => {
          this.showEndGameScreen();
        });
      } else {
        this.showEndGameScreen();
      }
    }

    // Handle adventure victory - play victory scene (if any), then transition
    async handleAdventureVictory() {
      if (this._adventureVictoryPromptShown) return;
      this._adventureVictoryPromptShown = true;

      // Play the victory scene if one exists (camera look-back, dialogue, etc.)
      try {
        if (this.scenePlayer) {
          const scenePromise = this.scenePlayer.playByTrigger('victory');
          if (scenePromise) {
            this.isPaused = false;
            await scenePromise;
          }
        }
      } catch (err) {
        console.error('🎬 Victory scene error:', err);
      }

      const currentChapterId = this.currentChapterId || window.currentChapterId || 'chapter1';
      const nextChapterId = this.getNextChapterId(currentChapterId);
      console.log(`🏆 Adventure victory: current=${currentChapterId}, next=${nextChapterId}`);

      if (nextChapterId) {
        this._transitionToNextChapter(nextChapterId);
      } else {
        if (window.showStoryDialogue) {
          window.showStoryDialogue('🎉 Congratulations! You have completed all chapters!', 'victory', () => {
            this.endMatch(this.localPlayerId, 'objectives');
          });
        } else {
          this.endMatch(this.localPlayerId, 'objectives');
        }
      }
    }

    _transitionToNextChapter(nextChapterId) {
      const isCoop = window.isMultiplayer && Array.isArray(this.players) && this.players.filter(p => !p.isAI).length > 1;
      if (isCoop && window.net && window.net.p2p) {
        if (!this._chapterTransition) {
          this._chapterTransition = { nextChapterId: null, ready: new Set(), started: false };
        }
        if (this._chapterTransition.nextChapterId !== nextChapterId) {
          this._chapterTransition.nextChapterId = nextChapterId;
          this._chapterTransition.ready.clear();
          this._chapterTransition.started = false;
        }
        this._chapterTransition.ready.add(this.localPlayerId);
        window.net.p2p.sendData({
          type: 'adventure_chapter_ready',
          nextChapterId,
          playerId: this.localPlayerId
        });
        if (this.isHost()) {
          this._checkChapterTransitionReady();
        } else {
          this.updateLoadingOverlay('Waiting for party...');
        }
        return;
      }

      if (window.Lobby && window.Lobby.loadAdventureChapter) {
        window.Lobby.loadAdventureChapter(nextChapterId);
      } else {
        this.endMatch(this.localPlayerId, 'objectives');
      }
    }

    // Host-only: called when chapter-ready messages arrive.
    _checkChapterTransitionReady() {
      if (!this._chapterTransition || !this._chapterTransition.nextChapterId || this._chapterTransition.started) return;
      if (!this.isHost()) return;
      
      const humanPlayers = (this.players || []).filter(p => !p.isAI);
      const total = humanPlayers.length;
      const readyCount = this._chapterTransition.ready.size;
      
      // Show party ready status using existing overlay
      this.showLoadingOverlay();
      this.updateLoadingOverlay(`Party ready: ${readyCount} / ${total}`);
      
      if (readyCount >= total) {
        this._chapterTransition.started = true;
        
        // Host loads and broadcasts next chapter so everyone transitions together.
        if (window.Lobby && window.Lobby.loadAdventureChapterCoopHost) {
          window.Lobby.loadAdventureChapterCoopHost(this._chapterTransition.nextChapterId);
        } else if (window.Lobby && window.Lobby.loadAdventureChapter) {
          // Fallback: at least preserve player list (Lobby.loadAdventureChapter now does)
          window.Lobby.loadAdventureChapter(this._chapterTransition.nextChapterId);
        } else {
          this.endMatch(this.localPlayerId, 'objectives');
        }
      }
    }
    
    // Get the next chapter ID in sequence
    getNextChapterId(currentChapterId) {
      const chapterOrder = ['chapter1', 'chapter2', 'chapter3', 'chapter4', 'chapter5'];
      const currentIndex = chapterOrder.indexOf(currentChapterId);
      if (currentIndex >= 0 && currentIndex < chapterOrder.length - 1) {
        return chapterOrder[currentIndex + 1];
      }
      return null; // No more chapters
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
            
            // Monks don't count towards agora occupation
            if (unit.type === 'monk') return;
            
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
      if (this.gameType === 'adventure') {
        // Co-op adventure: all non-AI match players are allied against the environment.
        return this.players
          .filter(p => !p?.isAI)
          .map(p => p.id || p);
      }

      if (this.gameType === 'teams') {
        // For team games, split players into two teams.
        // First half = team 1, second half = team 2.
        // Use normalized IDs for comparison since playerId may be in any format.
        const totalPlayers = this.players.length;
        const teamSize = Math.ceil(totalPlayers / 2);
        const normalizedQuery = this.normalizeCommandPlayerId(playerId);
        const playerIndex = this.players.findIndex(p => 
          this.normalizeCommandPlayerId(p.id || p) === normalizedQuery
        );
        
        if (playerIndex >= 0 && playerIndex < teamSize) {
          return this.players.slice(0, teamSize).map(p => p.id || p);
        } else if (playerIndex >= teamSize) {
          return this.players.slice(teamSize).map(p => p.id || p);
        }
        // Player not found in list — fall through to FFA
      }
      // Free-for-all: each player is their own team
      return [playerId];
    }

    arePlayersAllied(playerA, playerB) {
      const normalizedA = this.normalizeCommandPlayerId(playerA);
      const normalizedB = this.normalizeCommandPlayerId(playerB);
      if (!normalizedA || !normalizedB) return false;
      if (normalizedA === normalizedB) return true;

      const teamA = this.getTeamMembers(playerA)
        .map(id => this.normalizeCommandPlayerId(id))
        .filter(Boolean);

      return teamA.includes(normalizedB);
    }

    areOwnersHostile(ownerA, ownerB) {
      const normalizedA = this.normalizeCommandPlayerId(ownerA);
      const normalizedB = this.normalizeCommandPlayerId(ownerB);
      if (!normalizedA || !normalizedB) return false;
      if (normalizedA === normalizedB) return false;
      if (normalizedA === 'neutral' || normalizedB === 'neutral') return false;

      // In adventure mode, NPC units (npc-*) are all on the same hostile team.
      // They should fight players but not each other.
      if (this.gameType === 'adventure') {
        const aIsNPC = (ownerA || '').startsWith('npc-');
        const bIsNPC = (ownerB || '').startsWith('npc-');
        if (aIsNPC && bIsNPC) return false;   // NPCs are allied with each other
        if (aIsNPC || bIsNPC) return true;     // NPC vs player is always hostile
      }

      return !this.arePlayersAllied(normalizedA, normalizedB);
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
      
      // Small delay to ensure message is sent before ending
      setTimeout(() => {
        // For objectives/adventure mode or solo play, just end the match as defeat
        // For elimination mode, eliminate the player (other players may continue)
        if (this.victoryCondition === 'objectives' || this.players.length <= 2) {
          // End match - local player loses
          this.state = MatchState.DEFEAT;
          this.showEndGameScreen();
        } else {
          // Multiplayer with 3+ players - just eliminate self, others continue
          this.eliminatePlayer(this.localPlayerId);
        }
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
    processPendingResourceDecrements(activeSyncInterval) {
      if (this.pendingResourceDecrements.length === 0) return;
      
      const syncInterval = activeSyncInterval ?? this.syncInterval ?? 50;
      const currentSyncCheckpoint = this.tick;
      const previousSyncCheckpoint = Math.max(0, currentSyncCheckpoint - syncInterval);
      
      const decrementsToProcess = this.pendingResourceDecrements.filter(decrement => {
        const queuedAtTick = decrement.queuedAtTick || 0;
        return queuedAtTick > previousSyncCheckpoint && queuedAtTick <= currentSyncCheckpoint;
      });
      
      this.pendingResourceDecrements = this.pendingResourceDecrements.filter(decrement => {
        const queuedAtTick = decrement.queuedAtTick || 0;
        return queuedAtTick > currentSyncCheckpoint;
      });
      
      if (decrementsToProcess.length === 0) return;
      
      const sortedDecrements = decrementsToProcess.slice().sort((a, b) => {
        if (a.gridX !== b.gridX) return a.gridX - b.gridX;
        return a.gridZ - b.gridZ;
      });
      
      sortedDecrements.forEach(decrement => {
        const key = `${decrement.gridX},${decrement.gridZ}`;

        // Look up the base remaining from the tile definition if not tracked yet
        if (!this.resourceRemaining.has(key)) {
          const info = window.buildingSystem?.checkTileForResources(decrement.gridX, decrement.gridZ, true);
          if (!info) return;
          this.resourceRemaining.set(key, info.remaining);
        }
        
        const oldRemaining = this.resourceRemaining.get(key);
        const newRemaining = Math.max(0, oldRemaining - decrement.amount);
        this.resourceRemaining.set(key, newRemaining);
        
        if (newRemaining <= 0 && !this._scheduledDepletions?.has(key)) {
          if (!this._scheduledDepletions) this._scheduledDepletions = new Map();
          const depletionTick = Math.ceil((this.tick + 1) / syncInterval) * syncInterval;
          this._scheduledDepletions.set(key, {
            gridX: decrement.gridX,
            gridZ: decrement.gridZ,
            depletionTick
          });
        }
      });
    }

    queueResourceCredit(playerId, resourceType, amount, queuedAtTick = this.tick) {
      if (!playerId || !resourceType || !Number.isFinite(amount) || amount <= 0) return;
      if (!Array.isArray(this.pendingResourceCredits)) {
        this.pendingResourceCredits = [];
      }
      this.pendingResourceCredits.push({
        playerId: this.normalizeCommandPlayerId(playerId),
        resourceType,
        amount,
        queuedAtTick: Number.isFinite(queuedAtTick) ? queuedAtTick : (this.tick || 0)
      });
    }

    processPendingResourceCredits() {
      if (!Array.isArray(this.pendingResourceCredits) || this.pendingResourceCredits.length === 0) return;

      const currentSyncCheckpoint = this.tick;
      const creditsToProcess = this.pendingResourceCredits.filter(credit => {
        const queuedAtTick = credit.queuedAtTick || 0;
        return queuedAtTick <= currentSyncCheckpoint;
      });

      this.pendingResourceCredits = this.pendingResourceCredits.filter(credit => {
        const queuedAtTick = credit.queuedAtTick || 0;
        return queuedAtTick > currentSyncCheckpoint;
      });

      if (creditsToProcess.length === 0) return;

      const creditTotals = new Map();
      creditsToProcess
        .slice()
        .sort((a, b) => {
          const playerCmp = window.deterministicStringCompare(a.playerId || '', b.playerId || '');
          if (playerCmp !== 0) return playerCmp;
          if (a.resourceType !== b.resourceType) {
            return window.deterministicStringCompare(a.resourceType, b.resourceType);
          }
          return (a.queuedAtTick || 0) - (b.queuedAtTick || 0);
        })
        .forEach(credit => {
          const key = `${credit.playerId}:${credit.resourceType}`;
          creditTotals.set(key, (creditTotals.get(key) || 0) + credit.amount);
        });

      creditTotals.forEach((amount, key) => {
        const [playerId, resourceType] = key.split(':');
        const player = this.getPlayerById(playerId);
        if (player && player.addResource) {
          player.addResource(resourceType, amount);
        }
      });
    }
    
    // Sync resource node/depletion state at sync checkpoints.
    // Player resource banks must remain command-driven for deterministic train/build costs.
    syncResourceStatesAtCheckpoint() {
      if (!window.isMultiplayer) return;
      
      const isAuthoritative = this.isHost() || 
        (this.localPlayerId && this.hostId && this.localPlayerId < this.hostId);
      
      if (!isAuthoritative) return;
      
      const entries = [];
      this.resourceRemaining.forEach((remaining, key) => {
        const [gx, gz] = key.split(',').map(Number);
        entries.push({ gridX: gx, gridZ: gz, remaining });
      });

      const depletions = [];
      if (this._scheduledDepletions) {
        this._scheduledDepletions.forEach((info) => {
          depletions.push(info);
        });
      }

      if (entries.length === 0 && depletions.length === 0) {
        return;
      }
      
      if (window.net && window.net.p2p) {
        window.net.p2p.sendData({
          type: 'resource_state_sync',
          tick: this.tick,
          resourceEntries: entries,
          scheduledDepletions: depletions
        });
      }
    }
    
    processPendingResourceDepletions() {
      if (!this._scheduledDepletions || this._scheduledDepletions.size === 0) return;
      
      const toRemove = [];
      this._scheduledDepletions.forEach((info, key) => {
        if (info.depletionTick === this.tick) {
          if (window.removeResourceModel) {
            window.removeResourceModel(info.gridX, info.gridZ);
          }
          toRemove.push(key);
        }
      });
      toRemove.forEach(key => this._scheduledDepletions.delete(key));
    }
    
    // Create synchronization checkpoint
    createSyncCheckpoint() {
      const checksum = this.calculateGameStateChecksum();
      this.checksums.set(this.tick, checksum);
      
      // Collect component hashes for debugging (only if recently logged)
      const components = this.cloneChecksumComponents(this.lastChecksumComponents);
      if (components) {
        this.checksumComponents.set(this.tick, components);
      }
      
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

      const oldTick = this.tick - 200;
      this.checksumComponents.delete(oldTick);
    }
    
    // Calculate game state checksum for desync detection
    calculateGameStateChecksum() {
      let hash = 0;
      let unitCount = 0;
      let buildingCount = 0;
      
      // Hash all unit positions and states (in deterministic order by ID)
      const sortedUnits = (window.gameUnits || []).slice().sort((a, b) => 
        window.deterministicStringCompare(a.id || '', b.id || '')
      );
      
      let unitPosHash = 0;
      let unitOwnerHash = 0;
      let unitTypeHash = 0;
      let unitStateHash = 0;
      let unitHealthHash = 0;
      const unitSamples = [];
      
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

          unitSamples.push(this.buildUnitDebugSample(unit));
          
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
        unitHealthHash: unitHealthHash >>> 0,
        unitSamples
      };
      
      if (window.isMultiplayer && this.tick % (this.syncInterval * 2) === 0) {
        console.log(`🔢 LOCAL checksum components at tick ${this.tick}:`, this.lastChecksumComponents);
      }
      
      // Hash all building states (in deterministic order)
      const sortedBuildings = (window.gameBuildings || []).slice().sort((a, b) => 
        window.deterministicStringCompare(a.id || '', b.id || '')
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
      // Hash gameplay-relevant position only.
      // For RTS lockstep, X/Z drive pathing, range checks, work assignment, and combat.
      // Y is continuously recomputed from terrain/platform helpers and is not a stable
      // source of gameplay truth, so including it creates false desyncs.
      const x = Math.round(vec.x * 10);
      const z = Math.round(vec.z * 10);
      return (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0;
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

    quantizeDebugCoord(value) {
      return Math.round((value || 0) * 10) / 10;
    }

    buildUnitDebugSample(unit) {
      const loc = unit?.pb?.state?.loc || { x: 0, z: 0 };
      const vel = unit?.pb?.state?.vel || { x: 0, z: 0 };
      const behavior = window.behaviorManager?.getBehavior(unit);
      const tileSize = window.TILE_SIZE || 4;
      const lastAppliedMove = unit?._lastAppliedMoveCommand || null;
      const targetPoint = behavior?.targetPoint || null;
      const currentWaypoint = Array.isArray(behavior?.path) && Number.isFinite(behavior?.pathIndex)
        ? behavior.path[behavior.pathIndex] || null
        : null;
      return {
        id: unit?.id || 'unknown',
        objectId: window.getDebugUnitIdentity ? window.getDebugUnitIdentity(unit) : (unit?._debugObjectId || null),
        owner: unit?.owner || 'neutral',
        type: unit?.type || 'unknown',
        state: unit?.state || 'idle',
        behavior: behavior?.constructor?.name || 'none',
        behaviorState: behavior?.gatherState || behavior?.currentState || null,
        x: this.quantizeDebugCoord(loc.x),
        z: this.quantizeDebugCoord(loc.z),
        vx: this.quantizeDebugCoord(vel.x),
        vz: this.quantizeDebugCoord(vel.z),
        tileX: Math.floor((loc.x || 0) / tileSize),
        tileZ: Math.floor((loc.z || 0) / tileSize),
        targetX: targetPoint ? this.quantizeDebugCoord(targetPoint.x) : null,
        targetZ: targetPoint ? this.quantizeDebugCoord(targetPoint.z) : null,
        waypointX: currentWaypoint ? this.quantizeDebugCoord(currentWaypoint.x) : null,
        waypointZ: currentWaypoint ? this.quantizeDebugCoord(currentWaypoint.z) : null,
        pathIndex: Number.isFinite(behavior?.pathIndex) ? behavior.pathIndex : null,
        pathLength: Array.isArray(behavior?.path) ? behavior.path.length : 0,
        repathCount: Number.isFinite(behavior?._repathCount) ? behavior._repathCount : 0,
        lastMoveTick: Number.isFinite(lastAppliedMove?.tick) ? lastAppliedMove.tick : null,
        lastMoveSeq: Number.isFinite(lastAppliedMove?.seq) ? lastAppliedMove.seq : null,
        lastMovePlayer: lastAppliedMove?.playerId || null,
        lastMoveTargetX: lastAppliedMove ? this.quantizeDebugCoord(lastAppliedMove.targetX) : null,
        lastMoveTargetZ: lastAppliedMove ? this.quantizeDebugCoord(lastAppliedMove.targetZ) : null
      };
    }

    cloneChecksumComponents(components) {
      if (!components) return null;
      return {
        ...components,
        unitSamples: Array.isArray(components.unitSamples)
          ? components.unitSamples.map(sample => ({ ...sample }))
          : []
      };
    }

    logUnitDesyncDetails(localComponents, remoteComponents) {
      const localSamples = Array.isArray(localComponents?.unitSamples) ? localComponents.unitSamples : [];
      const remoteSamples = Array.isArray(remoteComponents?.unitSamples) ? remoteComponents.unitSamples : [];
      if (localSamples.length === 0 || remoteSamples.length === 0) {
        return;
      }

      const localById = new Map(localSamples.map(sample => [sample.id, sample]));
      const remoteById = new Map(remoteSamples.map(sample => [sample.id, sample]));
      const allIds = Array.from(new Set([...localById.keys(), ...remoteById.keys()]))
        .sort((a, b) => window.deterministicStringCompare(a, b));

      const mismatches = [];
      for (const id of allIds) {
        const local = localById.get(id);
        const remote = remoteById.get(id);
        if (!local || !remote) {
          mismatches.push({
            id,
            reason: !local ? 'missing-local' : 'missing-remote',
            local,
            remote
          });
        } else if (
          local.x !== remote.x ||
          local.z !== remote.z ||
          local.tileX !== remote.tileX ||
          local.tileZ !== remote.tileZ ||
          local.state !== remote.state ||
          local.vx !== remote.vx ||
          local.vz !== remote.vz
        ) {
          mismatches.push({ id, reason: 'state-diff', local, remote });
        }

        if (mismatches.length >= 8) break;
      }

      if (mismatches.length === 0) {
        console.error('🔬 Unit samples were transmitted, but no per-unit mismatch was found in first comparison window.');
        return;
      }

      console.error(`🔬 First unit mismatches (${mismatches.length} shown):`);
      mismatches.forEach((entry, index) => {
        if (entry.reason !== 'state-diff') {
          console.error(`  ${index + 1}. ${entry.id?.slice(-6)} ${entry.reason}`);
          return;
        }
        const local = entry.local;
        const remote = entry.remote;
        console.error(
          `  ${index + 1}. ${entry.id?.slice(-6)} ` +
          `LOCAL obj=${local.objectId || 'null'} ` +
          `LOCAL pos=(${local.x}, ${local.z}) tile=(${local.tileX}, ${local.tileZ}) vel=(${local.vx}, ${local.vz}) ` +
          `target=(${local.targetX}, ${local.targetZ}) wp=(${local.waypointX}, ${local.waypointZ}) path=${local.pathIndex}/${local.pathLength} repath=${local.repathCount} ` +
          `lastMove=[tick:${local.lastMoveTick},seq:${local.lastMoveSeq},player:${local.lastMovePlayer},target:(${local.lastMoveTargetX}, ${local.lastMoveTargetZ})] ` +
          `state=${local.state} behavior=${local.behavior}${local.behaviorState ? `/${local.behaviorState}` : ''} ` +
          `REMOTE obj=${remote.objectId || 'null'} ` +
          `REMOTE pos=(${remote.x}, ${remote.z}) tile=(${remote.tileX}, ${remote.tileZ}) vel=(${remote.vx}, ${remote.vz}) ` +
          `target=(${remote.targetX}, ${remote.targetZ}) wp=(${remote.waypointX}, ${remote.waypointZ}) path=${remote.pathIndex}/${remote.pathLength} repath=${remote.repathCount} ` +
          `lastMove=[tick:${remote.lastMoveTick},seq:${remote.lastMoveSeq},player:${remote.lastMovePlayer},target:(${remote.lastMoveTargetX}, ${remote.lastMoveTargetZ})] ` +
          `state=${remote.state} behavior=${remote.behavior}${remote.behaviorState ? `/${remote.behaviorState}` : ''}`
        );
      });
    }
    
    // Verify sync checkpoint from another player
    verifySyncCheckpoint(tick, remoteChecksum, remoteComponents) {
      const localChecksum = this.checksums.get(tick);
      
      if (localChecksum === undefined) {
        return; // We don't have this checkpoint yet
      }
      
      // Allow small differences due to floating-point rounding, but keep this tight now
      // that the position hash excludes non-gameplay Y noise.
      const diff = Math.abs(localChecksum - remoteChecksum);
      const TOLERANCE = 1000;
      
      if (diff > TOLERANCE) {
        console.error(`❌ DESYNC DETECTED at tick ${tick}!`);
        console.error(`   Local: ${localChecksum}, Remote: ${remoteChecksum}, Difference: ${diff}`);
        
        // ALWAYS log both local and remote components on desync for debugging
        const localComponents = this.checksumComponents.get(tick) || this.lastChecksumComponents || {};
        console.error(`\n🔍 LOCAL checksum components:`, localComponents);
        console.error(`🔍 REMOTE checksum components:`, remoteComponents || {});
        
        // Highlight differences
        if (remoteComponents && localComponents) {
          console.error(`\n📊 Component differences:`);
          Object.keys(localComponents).forEach(key => {
            if (key === 'unitSamples') return;
            if (remoteComponents[key] !== undefined && localComponents[key] !== remoteComponents[key]) {
              console.error(`  ${key}: LOCAL=${localComponents[key]} vs REMOTE=${remoteComponents[key]} (diff: ${Math.abs(localComponents[key] - remoteComponents[key])})`);
            }
          });
          this.logUnitDesyncDetails(localComponents, remoteComponents);
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
      } else if (this.replay.reason === 'objectives') {
        reasonText = isVictory ? '🎯 All Objectives Complete!' : '❌ Mission Failed';
      } else if (this.replay.reason === 'defeat') {
        reasonText = '🏳️ You Surrendered';
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

    getLoadingOverlayMarkup(message, loadedCount, totalCount) {
      const isPauseOverlay = this.isPaused && this.state === MatchState.PLAYING;
      if (isPauseOverlay) {
        const canResume = typeof this.resumeMatch === 'function';
        return `
          <div style="text-align: center; color: white; max-width: 420px; padding: 24px;">
            <h1 style="font-size: 3em; margin-bottom: 20px;">🎮</h1>
            <p style="font-size: 2em; font-weight: bold; margin-bottom: 14px;">${message || this.getPauseMessage(this.pauseContext?.reason)}</p>
            <p style="font-size: 1em; color: rgba(255,255,255,0.8); margin-bottom: 18px;">Press Escape or use the button below.</p>
            <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
              ${canResume ? `<button id="match_resume_button" style="padding: 12px 20px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.35); border-radius: 8px; color: white; font-size: 1em; cursor: pointer;">Resume Match</button>` : ''}
              <button id="match_menu_button" style="padding: 12px 20px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; color: white; font-size: 1em; cursor: pointer;">Open Menu</button>
            </div>
          </div>
        `;
      }

      if (message) {
        return `
          <div style="text-align: center; color: white;">
            <h1 style="font-size: 3em; margin-bottom: 20px;">🎮</h1>
            <p style="font-size: 2em; font-weight: bold;">${message}</p>
          </div>
        `;
      }

      if (this._chapterTransitionLoading) {
        return `
          <div style="text-align: center; color: white;">
            <h1 style="font-size: 2em; margin-bottom: 20px;">📖 Chapter Transition</h1>
            <div style="font-size: 1.2em; margin-bottom: 15px;">
              <div class="loading-spinner" style="
                width: 50px; height: 50px;
                border: 5px solid rgba(255,255,255,0.3);
                border-top: 5px solid white;
                border-radius: 50%;
                margin: 0 auto 20px;
                animation: spin 1s linear infinite;
              "></div>
              <p>Loading ${this._chapterTransitionLabel || 'next chapter'}...</p>
              <p style="font-size: 1.5em; margin: 10px 0;">${loadedCount} / ${totalCount} ready</p>
            </div>
          </div>
        `;
      }

      return `
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

    syncLoadingOverlayActions() {
      const overlay = document.getElementById('match_loading_overlay');
      if (!overlay) return;

      const pauseActive = this.isPaused && this.state === MatchState.PLAYING;
      overlay.style.pointerEvents = pauseActive ? 'auto' : 'none';

      const resumeButton = document.getElementById('match_resume_button');
      if (resumeButton) {
        resumeButton.onclick = () => {
          if (this.resumeMatch) {
            this.resumeMatch();
          }
        };
      }

      const menuButton = document.getElementById('match_menu_button');
      if (menuButton) {
        menuButton.onclick = () => {
          if (window.ui && window.ui.showMenu) {
            window.ui.showMenu('ingame_menu');
          }
        };
      }
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
      
      overlay.style.zIndex = '10000';
      
      const loadedCount = this.playersLoaded.size;
      const humanPlayers = this.players.filter(p => !p.isAI);
      const totalCount = humanPlayers.length; // Only count human players
      
      overlay.innerHTML = this.getLoadingOverlayMarkup(null, loadedCount, totalCount);
      
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
      this.syncLoadingOverlayActions();
    }
    
    // Update loading overlay with current status
    updateLoadingOverlay(message) {
      const overlay = document.getElementById('match_loading_overlay');
      if (!overlay) return;
      
      const loadedCount = this.playersLoaded.size;
      const humanPlayers = this.players.filter(p => !p.isAI);
      const totalCount = humanPlayers.length; // Only count human players
      
      overlay.innerHTML = this.getLoadingOverlayMarkup(message, loadedCount, totalCount);
      this.syncLoadingOverlayActions();
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
        if (!window.gameUnits) window.gameUnits = [];
        else window.gameUnits.length = 0;
        if (!window.gameBuildings) window.gameBuildings = [];
        else window.gameBuildings.length = 0;
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
        if (window.gfx && window.gfx.primeFieldResourcePathing) {
          window.gfx.primeFieldResourcePathing(window.liveField);
        }
        
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
      if (window.gfx && typeof gfx.recreateMountains === 'function') {
        gfx.recreateMountains();
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

