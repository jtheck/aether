// Multiplayer Networking Layer for Aether RTS
// Handles P2P sync via GetFire, lockstep commands, prediction, and reconciliation
// Supports: 1v1, Adventure, Teams, King of the Hill

(function(net) {
  // Configuration
  net.TICK_RATE = 20; // 20Hz = 50ms ticks (base rate)
  net.MIN_TICK_RATE = 15; // Slow down to 15Hz if peers lagging (adaptive lockstep)
  net.COMMAND_BUFFER_SIZE = 100; // Max buffered commands
  net.STATE_SYNC_INTERVAL = 200; // Full state every 200ms (5 times per second) - base rate
  net.STATE_SYNC_INTERVAL_IDLE = 500; // Slower sync when no active commands (LOD)
  net.RECONNECT_TIMEOUT = 3000; // Reconnect attempts every 3s
  net.SNAP_THRESHOLD = 10; // Units >10 units away snap instead of lerp (reduced snapping)
  net.LERP_SPEED = 0.3; // 30% correction per sync (slower, smoother lerp)
  net.PEER_LAG_THRESHOLD = 3; // Slow down if peer is >3 ticks behind
  net.COMMAND_ACK_TIMEOUT = 1000; // Wait 1s for command acknowledgment before resending
  
  // Internal state
  let p2p = null;
  let gameId = null;
  let localPlayerId = null;
  let localPlayerShortId = null;
  let isHost = false;
  let tick = 0;
  let commandBuffer = []; // Local pending commands
  let remoteCommands = new Map(); // Per-player command queues
  let lastStateSync = 0;
  let reconnectAttempts = 0;
  let isConnected = false;
  let tickIntervalId = null; // Store interval ID
  let currentTickRate = net.TICK_RATE; // Adaptive tick rate (starts at base)
  let peerLag = new Map(); // Track peer lag: peerId -> { lastTick: number, lastSeen: timestamp }
  let pendingCommandAcks = new Map(); // Track pending command acknowledgments: commandId -> { command, sentAt, retries }
  let lastPlayerCommandTime = 0; // Track when we last sent a player command (for LOD)
  
  // Internal state tracking
  net._state = {
    localPlayerId: null,
    isConnected: false,
    peers: [],
    currentLobby: null,
    reconnectAttempts: 0,
    initialized: false
  };

  const normalizePeerId = (id) => {
    if (!id) return '';
    const suffix = id.includes('-') ? id.split('-').pop() : id;
    return suffix.length > 6 ? suffix.slice(-6) : suffix;
  };

  // NEW: Get current network status
  net.getStatus = function() {
    return {
      localPlayerId: localPlayerId,
      localPlayerShortId: localPlayerShortId || normalizePeerId(localPlayerId),
      isConnected: isConnected,
      peers: p2p ? p2p.getConnectedPeers() : [],
      currentLobby: net.currentLobby || null,
      reconnectAttempts: reconnectAttempts,
      initialized: !!net.initialized, // Convert to boolean
      isHost: isHost,
      tick: tick,
      commandBufferSize: commandBuffer.length
    };
  };

  // Update internal state helper
  net._updateState = function(updates) {
    Object.assign(net._state, updates);
    // Optional: Trigger status change event
    if (net.onStatusChange) {
      net.onStatusChange(net.getStatus());
    }
  };
  
  // Game type to lobby mapping
  const GAME_TYPES = {
    'adventure': 'aether-adventure-coop',
    'onevsone': 'aether-1v1-quick',
    'koth': 'aether-koth',
    'teams': 'aether-teams-2v2'
  };
  
  // Initialize networking - updated to set initialized and localPlayerId
  net.init = function(options = {}) {
    const roomType = GAME_TYPES[options.gameType] || GAME_TYPES.onevsone;
    
    // Check if we should skip network initialization (offline mode)
    if (options.offlineMode) {
      console.log('🔌 Offline mode - skipping network initialization');
      net.initialized = true; // Mark as initialized but don't connect
      net.offlineMode = true;
      return;
    }
    
    // Initialize GetFire P2P
    try {
      p2p = GETFIREP2P({
        roomType: 'aether-rts',
        onGameLobbyMessage: handleGameLobbyMessage,  // CRITICAL: Needed for auto-negotiation!
        onDataChannelMessage: handleDataMessage,
        onPeerConnected: onPeerConnected,             // ✅ Correct callback name!
        onPeerDisconnected: onPeerDisconnected,       // ✅ Correct callback name!
        onBroadcastMessage: onBroadcastMessage,
        devMode: options.devMode || false
      });
    } catch (error) {
      console.warn('⚠️ Network initialization failed (offline?):', error.message);
      net.initialized = true;
      net.offlineMode = true;
      return;
    }
    
    // Use GetFire's user ID (DON'T generate our own!)
    // This is critical for P2P auto-negotiation to work
    // Wait for P2P to be ready before getting the ID
    const waitForUserId = setInterval(() => {
      if (p2p && p2p.getUserId && p2p.getUserId()) {
        localPlayerId = p2p.getUserId();
        localPlayerShortId = normalizePeerId(localPlayerId);
        // console.log(`🆔 Using P2P user ID: ${localPlayerId}`);
        clearInterval(waitForUserId);
      }
    }, 100);
    
    // Store lobby browser mode flag
    net.lobbyBrowserMode = options.lobbyBrowserMode || false;
    
    // Mark as initialized immediately (but P2P may still be connecting)
    net.initialized = true;
    
    // Wait for P2P to be ready, then join appropriate channels
    setTimeout(() => {
      // console.log(`🔍 Lobby browser mode: ${net.lobbyBrowserMode}`);
      
      // Only join match lobby if not in lobby browser mode
      if (!net.lobbyBrowserMode) {
        if (p2p && p2p.joinMatchLobby) {
          p2p.joinMatchLobby(roomType);
          net.currentLobby = roomType;
          // console.log(`🌐 Joined match lobby: ${roomType}`);
        }
      } else {
        // Join broadcast channel for lobby discovery
        if (options.broadcastChannel && p2p && p2p.joinBroadcast) {
          p2p.joinBroadcast(options.broadcastChannel);
          // console.log(`📡 Joined broadcast for lobby discovery: ${options.broadcastChannel}`);
        }
        // console.log(`🌐 Network initialized for lobby browser mode`);
      }
    }, 500); // Give P2P more time to initialize
    
    // Start tick loop
    net.startTickLoop();
    
    // console.log(`🌐 Network initialized for ${options.gameType || '1v1'}`);
  };
  
  // Start the deterministic tick loop with adaptive rate
  net.startTickLoop = function() {
    // Clear any existing interval/timeout
    if (tickIntervalId !== null) {
      clearTimeout(tickIntervalId);
      tickIntervalId = null;
    }
    
    // Use adaptive tick rate function (recursive setTimeout for dynamic rate)
    function scheduleNextTick() {
      // Calculate adaptive tick rate based on peer lag
      const maxPeerLag = getMaxPeerLag();
      if (maxPeerLag > net.PEER_LAG_THRESHOLD) {
        // Slow down if peers are lagging (adaptive lockstep)
        currentTickRate = net.MIN_TICK_RATE;
      } else {
        // Normal speed when peers are caught up
        currentTickRate = net.TICK_RATE;
      }
      
      // Apply tick synchronization adjustment from match (to keep ticks aligned)
      const tickSyncAdjustment = window.currentMatch?.tickSyncAdjustment || 0;
      const tickInterval = (1000 / currentTickRate) + tickSyncAdjustment;
      
      tickIntervalId = setTimeout(() => {
        tick++;
        processTick();
        scheduleNextTick(); // Schedule next tick with updated rate
      }, tickInterval);
    }
    
    scheduleNextTick();
  };
  
  // Get maximum peer lag (how many ticks behind the slowest peer is)
  // Returns positive value if peers are ahead of us (we're behind)
  // Returns negative value if peers are behind us (we're ahead)
  function getMaxPeerLag() {
    if (!window.currentMatch || !isConnected) return 0;
    
    let maxLag = 0;
    const currentTick = window.currentMatch.tick || tick;
    const now = Date.now();
    const STALE_THRESHOLD = 2000; // 2 seconds - ignore peer lag data older than this (more aggressive)
    const ticksPerSecond = net.TICK_RATE || 20;
    
    // Clean up stale entries first
    peerLag.forEach((lagInfo, peerId) => {
      const timeSinceLastSeen = now - (lagInfo.lastSeen || 0);
      if (timeSinceLastSeen > STALE_THRESHOLD) {
        peerLag.delete(peerId); // Remove stale entries
      }
    });
    
    // Check if we're early in the match (first 10 seconds) - allow larger lag differences
    const matchAge = window.currentMatch?.gameTime || (currentTick / ticksPerSecond);
    const isEarlyMatch = matchAge < 10; // First 10 seconds of match
    
    peerLag.forEach((lagInfo, peerId) => {
      if (lagInfo.lastTick !== undefined) {
        // Positive lag means peer is ahead (we're behind)
        // Negative lag means peer is behind (we're ahead)
        const lag = lagInfo.lastTick - currentTick;
        const age = (now - (lagInfo.lastSeen || 0)) / 1000; // Age in seconds
        
        // Only reject if BOTH conditions are true:
        // 1. Lag is impossibly large (> 60 seconds)
        // 2. AND the data is stale (age > 2 seconds)
        // For negative lag (peer behind), only ignore if stale - fresh negative lag is legitimate
        const maxAllowedLag = ticksPerSecond * 60; // 60 seconds - increased threshold for legitimate lag
        const isStale = age > 2.0; // Data older than 2 seconds is considered stale
        
        // Only ignore if lag is impossibly large AND stale
        // Don't ignore negative lag if data is fresh (peer legitimately behind)
        if (Math.abs(lag) > maxAllowedLag && isStale) {
          // Log for debugging but don't use it
          console.warn(`⚠️ Ignoring suspicious lag value: peer ${peerId.slice(-4)} reports ${lag} ticks difference (current: ${currentTick}, their tick: ${lagInfo.lastTick}, age: ${age.toFixed(1)}s, match age: ${matchAge.toFixed(1)}s)`);
          return; // Skip suspiciously large AND stale lag values
        }
        
        // Only count positive lag (peer ahead, we're behind)
        // Even if it's large, if the data is fresh (< 2 seconds old), trust it
        if (lag > 0) {
          maxLag = Math.max(maxLag, lag);
        }
      }
    });
    
    return maxLag;
  }
  
  // Update peer lag tracking
  function updatePeerLag(peerId, peerTick) {
    if (!peerLag.has(peerId)) {
      peerLag.set(peerId, { lastTick: peerTick, lastSeen: Date.now() });
    } else {
      const lagInfo = peerLag.get(peerId);
      lagInfo.lastTick = peerTick;
      lagInfo.lastSeen = Date.now();
    }
    
    // Clean up stale entries periodically (older than 3 seconds)
    const now = Date.now();
    const STALE_AGE = 3000; // 3 seconds
    peerLag.forEach((info, pid) => {
      if (now - (info.lastSeen || 0) > STALE_AGE) {
        peerLag.delete(pid);
      }
    });
  }
  
  // Process a single tick (lockstep)
  function processTick() {
    // CRITICAL: Check if we're significantly behind and need to catch up
    // maxPeerLag > 0 means peers are ahead (we're behind)
    // If we're more than 2 seconds behind (100 ticks at 50Hz), request full state sync
    const maxPeerLag = getMaxPeerLag();
    const CATCHUP_THRESHOLD = 100; // 2 seconds at 50Hz
    
    // Only request catch-up if we're actually behind (positive lag means peers are ahead)
    // Rate limit catch-up requests to once per 10 seconds to avoid spam
    const lastCatchupRequest = window.currentMatch?.lastCatchupRequest || 0;
    const timeSinceLastRequest = Date.now() - lastCatchupRequest;
    const canRequestCatchup = timeSinceLastRequest > 10000; // 10 seconds between requests
    
    // Only log warning once per catch-up cycle (not every tick)
    const shouldLogWarning = !window.currentMatch?.lastCatchupWarningTime || 
                             (Date.now() - window.currentMatch.lastCatchupWarningTime) > 10000;
    
    if (maxPeerLag > CATCHUP_THRESHOLD && isConnected && !window.currentMatch?.isCatchingUp && canRequestCatchup) {
      if (shouldLogWarning) {
        const ticksPerSecond = net.TICK_RATE || 20;
        const secondsBehind = maxPeerLag / ticksPerSecond;
        console.warn(`⚠️ Falling behind! Peers are ${maxPeerLag} ticks ahead (~${secondsBehind.toFixed(1)}s at ${ticksPerSecond}Hz). Requesting catch-up sync...`);
        if (window.currentMatch) {
          window.currentMatch.lastCatchupWarningTime = Date.now();
        }
      }
      
      // Mark that we're catching up
      if (window.currentMatch) {
        window.currentMatch.isCatchingUp = true;
        window.currentMatch.lastCatchupRequest = Date.now();
      }
      
      // Request full state sync from all peers
      p2p.sendData({
        type: 'request_catchup_sync',
        myTick: tick,
        myMatchTick: window.currentMatch?.tick || tick
      });
    }
    
    // Reset catch-up flag if we've been caught up for a while
    if (window.currentMatch?.isCatchingUp && maxPeerLag <= 10) {
      const timeSinceCatchup = Date.now() - (window.currentMatch.lastCatchupRequest || 0);
      if (timeSinceCatchup > 2000) { // 2 seconds of being caught up
        window.currentMatch.isCatchingUp = false;
        // Only log success if we were significantly behind
        if (window.currentMatch.lastCatchupWarningTime) {
          console.log(`✅ Caught up! Lag: ${maxPeerLag} ticks`);
          window.currentMatch.lastCatchupWarningTime = 0;
        }
      }
    }
    
    // Execute buffered commands for this tick
    executeCommandsForTick(tick);
    
    // Update match state (deterministic) - the match handles victory conditions and game state
    if (window.currentMatch && window.currentMatch.processTick) {
      window.currentMatch.processTick();
    }
    
    // Adaptive state sync frequency (LOD):
    // - Fast sync (200ms) when player commands are active (last 2 seconds)
    // - Slow sync (500ms) when idle (no recent player commands)
    const timeSinceLastCommand = Date.now() - lastPlayerCommandTime;
    const isActive = timeSinceLastCommand < 2000; // Active if command within last 2 seconds
    const syncInterval = isActive ? net.STATE_SYNC_INTERVAL : net.STATE_SYNC_INTERVAL_IDLE;
    
    // Send state sync if needed (BOTH players send their own state)
    if (Date.now() - lastStateSync > syncInterval && isConnected) {
      sendStateSync();
      lastStateSync = Date.now();
    }
    
    // Check for unacknowledged commands (resend if needed)
    checkPendingCommandAcks();
  };
  
  // Check and resend unacknowledged commands
  function checkPendingCommandAcks() {
    const now = Date.now();
    pendingCommandAcks.forEach((ackInfo, commandId) => {
      if (now - ackInfo.sentAt > net.COMMAND_ACK_TIMEOUT) {
        // Command not acknowledged - resend
        ackInfo.retries++;
        if (ackInfo.retries < 3) { // Max 3 retries
          p2p.sendData({
            type: 'game_command',
            command: ackInfo.command,
            isRetry: true
          });
          ackInfo.sentAt = now;
        } else {
          // Give up after 3 retries
          console.warn(`⚠️ Command ${commandId} failed after ${ackInfo.retries} retries`);
          pendingCommandAcks.delete(commandId);
        }
      }
    });
  }
  
  // Queue a command for lockstep execution
  net.sendCommand = function(command) {
    if (!isConnected) {
      console.warn('Cannot send command: not connected');
      return false;
    }
    
    // Add tick prediction (execute immediately for local player)
    command.tick = tick + Math.ceil(50 / (1000 / net.TICK_RATE)); // ~1 tick delay for latency
    const selfPlayerId = localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
    command.playerId = selfPlayerId;
    command.type = command.type || 'unknown';
    
    // Store locally for prediction
    commandBuffer.push(command);
    
    // Prune old commands
    if (commandBuffer.length > net.COMMAND_BUFFER_SIZE) {
      commandBuffer.shift();
    }
    
    // Send to remote peers
    const message = {
      type: 'command',
      tick: command.tick,
      content: command
    };
    
    // Broadcast to all connected peers
    p2p.sendData(message);
    
    // Predict execution for local player (optimistic)
    if (command.playerId === selfPlayerId) {
      executeCommand(command, tick);
    }
    
    return true;
  };
  
  // Execute all commands scheduled for current tick
  function executeCommandsForTick(currentTick) {
    // Get all commands for this tick from buffer and remote queues
    const commandsThisTick = [...commandBuffer.filter(c => c.tick === currentTick)];
    
    // Add remote commands
    remoteCommands.forEach((queue, playerId) => {
      const remoteCmds = queue.filter(c => c.tick === currentTick);
      commandsThisTick.push(...remoteCmds);
      // Remove executed remote commands
      remoteCommands.set(playerId, queue.filter(c => c.tick > currentTick));
    });
    
    // Sort by playerId for deterministic order
    commandsThisTick.sort((a, b) => (a.playerId || 'local').localeCompare(b.playerId || 'local'));
    
    // Execute in deterministic order
    commandsThisTick.forEach(cmd => executeCommand(cmd, currentTick));
  };
  
  // Execute a single command (called by game systems)
  function executeCommand(command, currentTick) {
    // Validate tick (prevent future/past execution)
    if (Math.abs(command.tick - currentTick) > 2) {
      console.warn(`Skipping out-of-order command: tick ${command.tick} vs current ${currentTick}`);
      return;
    }
    
    // Dispatch to game systems based on type
    switch (command.type) {
      case 'move':
        handleMoveCommand(command);
        break;
      case 'attack':
        handleAttackCommand(command);
        break;
      case 'build':
        handleBuildCommand(command);
        break;
      case 'gather':
        handleGatherCommand(command);
        break;
      case 'ability':
        handleAbilityCommand(command);
        break;
      default:
        console.warn(`Unknown command type: ${command.type}`);
    }
  };
  
  // Command handlers (integrate with existing game systems)
  function handleMoveCommand(cmd) {
    const unit = findUnitById(cmd.unitId);
    if (unit && unit.owner === cmd.playerId) {
      // Move unit to target (use existing pathfinding)
      if (window.pathfinding && window.pathfinding.moveUnit) {
        window.pathfinding.moveUnit(unit, cmd.target);
      } else {
        // Fallback direct movement
        unit.pb.state.loc.x = cmd.target.x;
        unit.pb.state.loc.z = cmd.target.z;
      }
    }
  };
  
  function handleAttackCommand(cmd) {
    const attacker = findUnitById(cmd.unitId);
    const target = findUnitById(cmd.targetId);
    if (attacker && target && attacker.owner === cmd.playerId) {
      // Trigger attack (use existing combat system)
      if (window.combat && window.combat.attack) {
        window.combat.attack(attacker, target, cmd.damage);
      }
    }
  };
  
  function handleBuildCommand(cmd) {
    // Place building at target location
    if (window.buildingSystem && window.buildingSystem.placeBuilding) {
      window.buildingSystem.placeBuilding(cmd.buildingType, cmd.target, cmd.playerId);
    }
  };
  
  function handleGatherCommand(cmd) {
    const unit = findUnitById(cmd.unitId);
    const resource = findResourceById(cmd.resourceId);
    if (unit && resource && unit.owner === cmd.playerId) {
      // Start gathering (use existing resource system)
      if (window.resources && window.resources.gather) {
        window.resources.gather(unit, resource);
      }
    }
  };
  
  function handleAbilityCommand(cmd) {
    const unit = findUnitById(cmd.unitId);
    if (unit && unit.owner === cmd.playerId && unit.abilities.includes(cmd.ability)) {
      // Execute ability (use existing ability system)
      if (window.abilities && window.abilities.execute) {
        window.abilities.execute(unit, cmd.ability, cmd.target);
      }
    }
  };
  
  // Helper: Find unit by ID (search across all players)
  function findUnitById(unitId) {
    return [...(window.player?.units || []), ...(window.opponent?.units || []), ...window.gameUnits || []]
      .find(u => u.id === unitId);
  };
  
  function findResourceById(resourceId) {
    // Implement based on your resource system
    return window.resources?.find(r => r.id === resourceId);
  };
  
  // Handle incoming data channel messages
  function handleDataMessage(data, peerId) {
    try {
      const message = typeof data === 'string' ? JSON.parse(data) : data;
      
      // GetFire P2P wraps messages in game_data envelope, extract the actual content
      let actualMessage = message;
      if (message.type === 'game_data' && message.content) {
        actualMessage = message.content;
      }
      
      switch (actualMessage.type) {
        case 'command':
          // Queue remote command for lockstep
          if (!remoteCommands.has(peerId)) {
            remoteCommands.set(peerId, []);
          }
          remoteCommands.get(peerId).push(actualMessage.content);
          
          // Prune old remote commands
          remoteCommands.set(peerId, remoteCommands.get(peerId).filter(c => c.tick > tick - 10));
          break;
          
        case 'state_sync':
          // P2P: Each player is authoritative for their own units
          // Only reconcile if there's significant drift (safety net for desync)
          reconcileState(actualMessage.content);
          // Update peer lag tracking
          if (actualMessage.content && actualMessage.content.tick !== undefined) {
            updatePeerLag(peerId, actualMessage.content.tick);
          }
          break;
          
        case 'resource_state_sync':
          // CRITICAL: Apply authoritative resource states at sync checkpoint
          // This ensures both clients have identical resource states for checksum calculation
          if (actualMessage.resourceStates && window.gameBuildings) {
            Object.keys(actualMessage.resourceStates).forEach(buildingId => {
              const building = window.gameBuildings.find(b => b.id === buildingId);
              if (building && building.availableResources) {
                const remoteResources = actualMessage.resourceStates[buildingId];
                
                remoteResources.forEach(remoteResource => {
                  const localResource = building.availableResources.find(r => 
                    r.gridX === remoteResource.gridX && r.gridZ === remoteResource.gridZ
                  );
                  
                  if (localResource) {
                    const wasNotDepleted = !localResource.depleted;
                    
                    // Apply authoritative state
                    localResource.remaining = remoteResource.remaining;
                    localResource.depleted = remoteResource.depleted;
                    localResource.depletionTick = remoteResource.depletionTick;
                    
                    // CRITICAL: If resource just became depleted, remove the visual model
                    // This ensures both clients see trees sink when depleted
                    if (wasNotDepleted && remoteResource.depleted && window.removeResourceModel) {
                      window.removeResourceModel(remoteResource.gridX, remoteResource.gridZ);
                      console.log(`🪓 Tree sunk at (${remoteResource.gridX}, ${remoteResource.gridZ}) from authoritative sync`);
                    }
                  }
                });
              }
            });
          }
          break;
          
        case 'unit_position_sync':
          // P2P: Apply unit positions from other players (they're authoritative for their own units)
          // This prevents floating-point drift while maintaining P2P fairness
          if (window.currentMatch && actualMessage.positions && actualMessage.playerId) {
            window.currentMatch.applyUnitPositions(actualMessage.positions, actualMessage.playerId, actualMessage.tick);
            // Update peer lag tracking
            if (actualMessage.tick !== undefined) {
              updatePeerLag(peerId, actualMessage.tick);
            }
          }
          break;
          
        case 'request_catchup_sync':
          // Peer is falling behind and requesting a catch-up sync
          // Send them our current full state so they can fast-forward
          if (window.currentMatch && actualMessage.myTick !== undefined) {
            const theirTick = actualMessage.myMatchTick || actualMessage.myTick;
            const ourTick = window.currentMatch.tick || tick;
            const lag = ourTick - theirTick; // Positive = we're ahead, negative = they're ahead
            
            // Only help them catch up if we're actually ahead
            if (lag > 0) {
              
              // Send full state sync immediately
              sendStateSync();
              
              // Also send a catchup sync with our tick so they can fast-forward
              p2p.sendData({
                type: 'catchup_sync',
                targetTick: ourTick,
                matchTick: ourTick,
                timestamp: Date.now()
              }, peerId);
            } else {
              // They're actually ahead of us, ignore their catch-up request
              // (Silently ignore - this is normal when peers have slight timing differences)
            }
          }
          break;
          
        case 'catchup_sync':
          // Received catch-up sync - fast-forward our tick to match theirs
          if (window.currentMatch && actualMessage.targetTick !== undefined) {
            const targetTick = actualMessage.targetTick;
            const currentTick = window.currentMatch.tick || tick;
            const ticksToCatchUp = targetTick - currentTick;
            
            if (ticksToCatchUp > 0 && ticksToCatchUp < 1000) { // Sanity check: don't fast-forward more than 20 seconds
              // Fast-forward by processing ticks without waiting
              // Process all ticks at once to catch up completely
              for (let i = 0; i < ticksToCatchUp; i++) {
                tick++;
                if (window.currentMatch) {
                  window.currentMatch.tick++;
                  window.currentMatch.gameTime = window.currentMatch.tick / (net.TICK_RATE || 20);
                  
                  // Process tick normally (commands, AI, etc.)
                  window.currentMatch.executeCommandsForTick(window.currentMatch.tick);
                  
                  // Update AI every 20 ticks
                  if (window.currentMatch.tick % 20 === 0) {
                    window.currentMatch.updateAIPlayers();
                    if (window.currentMatch.isHost()) {
                      window.currentMatch.generateAICommands();
                    }
                    window.currentMatch.checkAgoraOccupation();
                    window.currentMatch.checkWonderVictory();
                    window.currentMatch.checkEliminationVictory();
                  }
                }
              }
              
              // Mark that we're done catching up
              if (window.currentMatch) {
                window.currentMatch.isCatchingUp = false;
                window.currentMatch.lastCatchupRequest = 0; // Reset catch-up request timer
              }
            } else if (ticksToCatchUp <= 0) {
              // Already caught up or ahead
              if (window.currentMatch) {
                window.currentMatch.isCatchingUp = false;
              }
            } else {
              console.warn(`⚠️ Catch-up sync requested impossible fast-forward: ${ticksToCatchUp} ticks (current: ${currentTick}, target: ${targetTick})`);
            }
          }
          break;
          
        case 'ping':
          // Respond to ping
          p2p.sendData({type: 'pong', from: localPlayerId}, peerId);
          break;
          
        case 'player_ready':
          // Other player ready - determine host deterministically
          if (actualMessage.playerId !== localPlayerId) {
            // Deterministic host selection: lower peer ID becomes host
            const peerIds = p2p.getConnectedPeers().sort();
            const allPeerIds = [localPlayerId, ...peerIds].sort();
            isHost = (allPeerIds[0] === localPlayerId);
            // console.log(`👑 Host determination: ${isHost ? 'I am host' : 'Peer is host'} (IDs: ${allPeerIds.join(', ')})`);
            
            // NO AUTO-START! Lobby system handles game start now via START button
          }
          break;
          
        case 'pong':
          // Handle pong response if tracking latency
          break;
          
        case 'player_ready_state':
          // Update ready state in lobby
          if (window.Lobby && actualMessage.playerId) {
            const wasReady = window.Lobby.playerReadyStates[actualMessage.playerId];
            window.Lobby.playerReadyStates[actualMessage.playerId] = actualMessage.isReady;
            
            // console.log(`${actualMessage.isReady ? '✅' : '⏸️'} Peer ${actualMessage.playerId.slice(-4)} ready state: ${actualMessage.isReady}`);
            
            // Update lobby UI if we're in a lobby
            if (window.Lobby.currentGameType && window.Lobby.currentLobbyId) {
              const lobby = window.Lobby.availableLobbies[window.Lobby.currentGameType]?.find(l => l.id === window.Lobby.currentLobbyId);
              if (lobby) {
                window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, lobby);
                
                // If we're the host, announce lobby update (ready state changed)
                if (window.Lobby.isHost) {
                  // console.log(`📣 Host broadcasting lobby update (ready state changed)`);
                  window.Lobby.announceLobby(lobby);
                }
              }
            }
          }
          break;
          
        case 'lobby_closed':
          // Host closed the lobby - return to browser
          if (window.Lobby && actualMessage.lobbyId === window.Lobby.currentLobbyId) {
            console.log('🚪 Host closed lobby - returning to browser');
            window.Lobby.leaveLobby();
            if (window.ui && window.ui.showMenu) {
              window.ui.showMenu('main_menu');
            }
          }
          break;
          
        case 'player_joined':
          // Add player to lobby
          if (window.Lobby && actualMessage.playerId && actualMessage.playerId !== localPlayerId) {
            const joinedPlayerId = actualMessage.playerId;
            const normalize = window.Lobby.normalizePeerId ? window.Lobby.normalizePeerId.bind(window.Lobby) : (id => id);
            const targetNormalizedId = normalize(joinedPlayerId);
            const playerExists = window.Lobby.connectedPlayers.some(p => normalize(p.id || p) === targetNormalizedId);
            const isAckMessage = !!actualMessage.handshakeAck;
            
            if (window.Lobby.upsertConnectedPlayerMeta) {
              window.Lobby.upsertConnectedPlayerMeta({
                id: joinedPlayerId,
                name: actualMessage.playerName,
                color: actualMessage.playerColor
              });
            } else if (!playerExists) {
              window.Lobby.connectedPlayers.push({
                id: joinedPlayerId,
                name: actualMessage.playerName,
                color: actualMessage.playerColor
              });
            }
            
            // Track connection state for UI regardless of whether the player is new
            if (window.Lobby.playerConnectionStates) {
              window.Lobby.playerConnectionStates[joinedPlayerId] = 'connected';
            }
            
            const connectedEntry = window.Lobby.connectedPlayers.find(p => normalize(p.id || p) === targetNormalizedId);
            const isMetadataComplete = !!connectedEntry?.name;
            
             // Ensure peer list stays aligned with actual connections
            if (window.Lobby.syncConnectedPlayersFromPeerIds && p2p) {
              window.Lobby.syncConnectedPlayersFromPeerIds(p2p.getConnectedPeers());
            }
            
            // Always refresh the lobby UI so updated metadata is visible
            if (window.Lobby.currentGameType && window.Lobby.currentLobbyId) {
              const lobby = window.Lobby.availableLobbies[window.Lobby.currentGameType]?.find(l => l.id === window.Lobby.currentLobbyId);
              if (lobby) {
                window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, lobby);
                
                if (window.Lobby.isHost && (!playerExists || !isMetadataComplete)) {
                  window.Lobby.announceLobby(lobby);
                }
              }
            }
            
            // Send our info back (if we're already in the lobby) only when this wasn't an acknowledgement
            if (window.Lobby.currentLobbyId && !isAckMessage) {
              p2p.sendData({
                type: 'player_joined',
                playerId: localPlayerId,
                playerName: window.currentPlayerName || window.player?.name || `Player ${localPlayerId.slice(-4)}`,
                playerColor: window.currentPlayerColor || window.player?.color || '#ffffff',
                handshakeAck: true
              }, peerId);
            }
          }
          break;
          
        case 'player_left':
          // Remove player from lobby
          if (window.Lobby && actualMessage.playerId) {
            if (window.Lobby.playerConnectionStates) {
              window.Lobby.playerConnectionStates[actualMessage.playerId] = 'disconnected';
            }
            if (window.Lobby.playerReadyStates) {
              delete window.Lobby.playerReadyStates[actualMessage.playerId];
            }
            if (window.Lobby.removeConnectedPlayerById) {
              window.Lobby.removeConnectedPlayerById(actualMessage.playerId);
            } else {
              window.Lobby.connectedPlayers = window.Lobby.connectedPlayers.filter(p => (p.id || p) !== actualMessage.playerId);
            }
            // console.log(`👤 Player left lobby: ${actualMessage.playerId}`);
            
            // Update lobby UI
            if (window.Lobby.currentGameType && window.Lobby.currentLobbyId) {
              const lobby = window.Lobby.availableLobbies[window.Lobby.currentGameType]?.find(l => l.id === window.Lobby.currentLobbyId);
              if (lobby) {
                window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, lobby);
                
                if (window.Lobby.isHost) {
                  window.Lobby.announceLobby(lobby);
                }
              }
            }
          }
          break;
          
        case 'start_game':
          // Host has initiated match start!
          if (window.Lobby && actualMessage.gameType && actualMessage.settings) {
            // console.log(`🚀 Received start_game from host! Starting match...`);
            window.Lobby.startMultiplayerMatchWithSettings(actualMessage.gameType, actualMessage.settings);
          } else {
            console.error('❌ Received invalid start_game message:', actualMessage);
          }
          break;
          
        case 'game_command':
          // Receive command from another player for the match
          if (window.currentMatch && actualMessage.command) {
            const cmd = actualMessage.command;
            
            // CRITICAL: Normalize playerId to ensure consistent matching
            // Commands use normalized playerId (last 6 chars), but we need to match it correctly
            const normalizedPlayerId = cmd.playerId?.length > 6 ? cmd.playerId.slice(-6) : cmd.playerId;
            cmd.playerId = normalizedPlayerId; // Ensure command has normalized ID
            
            // Update peer lag tracking (they sent us a command at tick cmd.tick)
            // Use normalized playerId for lag tracking, not peerId
            updatePeerLag(normalizedPlayerId, cmd.tick);
            
            // Send acknowledgment if requested
            if (actualMessage.requestAck && cmd.commandId) {
              // Find the peerId that corresponds to this playerId
              const connectedPeers = p2p.getConnectedPeers();
              const targetPeerId = connectedPeers.find(p => {
                const normalizedPeer = normalizePeerId(p);
                return normalizedPeer === normalizedPlayerId;
              }) || peerId; // Fallback to original peerId if not found
              
              p2p.sendData({
                type: 'command_ack',
                commandId: cmd.commandId,
                tick: window.currentMatch.tick || tick
              }, targetPeerId);
            }
            
            // Check if command is for a past tick (arrived too late)
            if (cmd.tick < window.currentMatch.tick) {
              const ticksLate = window.currentMatch.tick - cmd.tick;
              // Fast-forward physics to catch up (normal network latency, not an error)
              
              // Execute the command immediately since we're already past its scheduled tick
              try {
                window.currentMatch.executeCommand(cmd);
                
                // Fast-forward physics for the units to catch up
                // Each tick is ~20ms at 50Hz, we need to simulate the missed ticks
                if (cmd.unitIds && window.gameUnits) {
                  const affectedUnits = window.gameUnits.filter(u => cmd.unitIds.includes(u.id));
                  
                  // Run extra physics steps to catch up
                  affectedUnits.forEach(unit => {
                    if (unit.pb && unit.pb.integrate && window.behaviorManager) {
                      const behavior = window.behaviorManager.getBehavior(unit);
                      if (behavior) {
                        // Step behavior and physics for each missed tick
                        const physicsTimestep = 1 / 60; // 60Hz physics
                        for (let i = 0; i < ticksLate; i++) {
                          behavior.step();
                          unit.pb.integrate(physicsTimestep, false, false);
                        }
                      }
                    }
                  });
                }
              } catch (error) {
                console.error(`❌ Error executing late command:`, error);
              }
            } else {
              // CRITICAL: Deduplicate move commands - remove older commands for same units
              // This prevents jerky movement from processing intermediate commands
              if (cmd.type === 'move' && cmd.unitIds && cmd.unitIds.length > 0) {
                const unitIdSet = new Set(cmd.unitIds);
                
                // Check all command buffers for older move commands for these units
                window.currentMatch.commandBuffer.forEach((commands, tickKey) => {
                  const filteredCommands = commands.filter(existingCmd => {
                    // Keep non-move commands
                    if (existingCmd.type !== 'move') return true;
                    // Keep move commands for different units
                    if (!existingCmd.unitIds || existingCmd.unitIds.length === 0) return true;
                    // Remove if any unit IDs overlap (same units, newer command wins)
                    const hasOverlap = existingCmd.unitIds.some(id => unitIdSet.has(id));
                    return !hasOverlap;
                  });
                  
                  // Update the buffer with filtered commands
                  if (filteredCommands.length !== commands.length) {
                    if (filteredCommands.length > 0) {
                      window.currentMatch.commandBuffer.set(tickKey, filteredCommands);
                    } else {
                      window.currentMatch.commandBuffer.delete(tickKey);
                    }
                  }
                });
              }
              
              // CRITICAL: Add to match command buffer for future execution
              // Ensure command has normalized playerId for consistent processing
              const tickKey = cmd.tick;
              if (!window.currentMatch.commandBuffer.has(tickKey)) {
                window.currentMatch.commandBuffer.set(tickKey, []);
              }
              
              // Debug logging for 3+ player games to track command flow
              const connectedPeers = p2p.getConnectedPeers();
              if (connectedPeers.length >= 2 && cmd.type === 'move' && cmd.unitIds && cmd.unitIds.length > 0) {
                // Log occasionally (every 50th command) to avoid spam
                if (Math.random() < 0.02) {
                  console.log(`📥 [3+ PLAYER DEBUG] Command from player ${normalizedPlayerId} (peer ${peerId.slice(-4)}), tick ${cmd.tick}, ${cmd.unitIds.length} units, total peers: ${connectedPeers.length}, buffer size: ${window.currentMatch.commandBuffer.get(tickKey)?.length || 0}`);
                }
              }
              
              window.currentMatch.commandBuffer.get(tickKey).push(cmd);
            }
            
            // Add to command history
            window.currentMatch.commandHistory.push(cmd);
            window.currentMatch.replay.commands.push(cmd);
          }
          break;
          
        case 'command_ack':
          // Command acknowledgment received
          if (actualMessage.commandId && pendingCommandAcks.has(actualMessage.commandId)) {
            // Remove from pending list
            pendingCommandAcks.delete(actualMessage.commandId);
            // Update peer lag tracking
            if (actualMessage.tick !== undefined) {
              updatePeerLag(peerId, actualMessage.tick);
            }
          }
          break;
          
        case 'sync_checkpoint':
          // Verify synchronization checkpoint
          if (window.currentMatch && actualMessage.tick && actualMessage.checksum) {
            window.currentMatch.verifySyncCheckpoint(actualMessage.tick, actualMessage.checksum, actualMessage.components);
          }
          break;
          
        case 'request_state_sync':
          // Another player detected desync and needs full state
          if (window.currentMatch && isHost) {
            // console.log('📤 Sending full state sync to peer...');
            // TODO: Implement full state sync
          }
          break;
          
        case 'player_loaded':
          // Another player finished loading and is ready to start
          if (window.currentMatch && actualMessage.playerId) {
            const shortId = normalizePeerId(actualMessage.playerId);
            console.log(`📡 player_loaded received from ${shortId}`);
            window.currentMatch.onPlayerLoaded(actualMessage.playerId);
          }
          break;
          
        case 'player_conceded':
          // Player conceded the match
          if (window.currentMatch && actualMessage.playerId) {
            const player = window.currentMatch.getPlayerById(actualMessage.playerId);
            const playerName = player?.name || `Player ${normalizePeerId(actualMessage.playerId)}`;
            console.log(`🏳️ ${playerName} conceded the match`);
            
            // Eliminate the conceding player
            if (window.currentMatch.eliminatePlayer) {
              window.currentMatch.eliminatePlayer(actualMessage.playerId);
            }
          }
          break;
          
        case 'match_countdown':
          // Host broadcasting countdown to clients
          if (window.currentMatch && actualMessage.countdown) {
            console.log(`⏳ Countdown update from host: ${actualMessage.countdown}`);
            window.currentMatch.updateLoadingOverlay(`${actualMessage.countdown}`);
          }
          break;
          
        case 'match_start':
          // Host signaling all clients to start playing
          if (window.currentMatch && window.currentMatch.beginPlaying) {
            console.log('🚀 Received match_start from host – entering PLAYING state');
            window.currentMatch.beginPlaying();
          }
          break;
          
        case 'match_pause':
          // Player broadcasting pause to all others
          if (window.currentMatch) {
            console.log('⏸️ Received match_pause from peer');
            window.currentMatch.isPaused = true;
            window.currentMatch.updateLoadingOverlay('⏸️ PAUSED');
            // console.log('⏸️ Match paused by remote player');
          }
          break;
          
        case 'match_resume':
          // Player broadcasting resume to all others
          if (window.currentMatch) {
            console.log('▶️ Received match_resume from peer');
            window.currentMatch.isPaused = false;
            const overlay = document.getElementById('match_loading_overlay');
            if (overlay) {
              overlay.style.display = 'none';
            }
            // console.log('▶️ Match resumed by remote player');
          }
          break;
          
        default:
          // console.warn(`Unknown message type: ${actualMessage.type}`, 'Full message:', actualMessage);
      }
    } catch (error) {
      console.error('Failed to parse network message:', error);
    }
  };
  
  // Handle game lobby messages (match requests, etc)
  function handleGameLobbyMessage(data) {
    // console.log('📩 Game lobby message:', data.type, data);
    
    // Manual match initiation if auto-negotiation fails
    if ((data.type === 'player_join' || data.type === 'player_rejoin') && 
        data.from !== localPlayerId &&
        window.Lobby && window.Lobby.currentLobbyId) {
      
      const myId = localPlayerId;
      const theirId = data.from;
      
      // console.log(`🤝 Detected peer ${theirId}, checking if we should initiate...`);
      
      // Check immediately
      const checkConnection = () => {
        const connectedPeers = p2p.getConnectedPeers();
        if (connectedPeers.includes(theirId)) {
          // console.log(`✅ [${myId}] Already connected to ${theirId}`);
          return;
        }
        
        // Deterministic: higher ID initiates
        if (myId > theirId) {
          // console.log(`📞 [${myId}] I should initiate (${myId} > ${theirId})`);
          p2p.requestMatch(theirId);
        } else {
          // console.log(`⏳ [${myId}] Waiting for ${theirId} to initiate (${theirId} > ${myId})`);
          
          // Safety: If they don't initiate after 3 seconds, we do it anyway
          setTimeout(() => {
            const stillNotConnected = !p2p.getConnectedPeers().includes(theirId);
            if (stillNotConnected) {
              // console.warn(`⚠️ [${myId}] Peer didn't initiate, forcing match request!`);
              p2p.requestMatch(theirId);
            }
          }, 3000);
        }
      };
      
      // Check after short delay (let GetFire try first)
      setTimeout(checkConnection, 300);
    }
    
    // GetFire also handles auto-negotiation internally after calling this
  }
  
  // Handle peer connection - updated to sync isConnected
  function onPeerConnected(peerId) {
    // console.log(`✅ Connected to peer: ${peerId.slice(-8)}`);
    isConnected = p2p.getConnectedPeers().length > 0;
    reconnectAttempts = 0;
    
    // Check if this is a reconnection during a match
    if (window.currentMatch && 
        window.currentMatch.state === 'disconnected' && 
        window.currentMatch._disconnectedPlayerId === peerId) {
      handlePlayerReconnected(peerId);
      return;
    }
    
    // Update lobby connection status
    if (window.Lobby) {
      window.Lobby.playerConnectionStates[peerId] = 'connected';
      
      const currentPeers = [...new Set(p2p.getConnectedPeers())];
      if (window.Lobby.syncConnectedPlayersFromPeerIds) {
        window.Lobby.syncConnectedPlayersFromPeerIds(currentPeers);
      } else {
        window.Lobby.connectedPlayers = currentPeers;
      }
    }
    
    // Send ready signal with local player ID
    p2p.sendData({type: 'player_ready', playerId: localPlayerId, gameType: gameId});
    
    // Announce player presence to lobby
    if (window.Lobby && window.Lobby.currentLobbyId) {
      // console.log(`👤 Sending player_joined to peer ${peerId}`);
      if (window.Lobby.sendPlayerPresence) {
        window.Lobby.sendPlayerPresence(peerId);
      } else {
        p2p.sendData({
          type: 'player_joined',
          playerId: localPlayerId,
          playerName: window.currentPlayerName || window.player?.name || `Player ${localPlayerId.slice(-4)}`,
          playerColor: window.currentPlayerColor || window.player?.color || '#ffffff'
        });
      }
      
      // Update lobby UI to show connection status
      if (window.Lobby.currentGameType && window.Lobby.currentLobby) {
        window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
      }
    } else {
      // console.log('⚠️ Not in lobby, skipping player_joined');
    }
    
    // Host will be determined when both sides exchange player_ready messages
    // (see handleDataMessage for deterministic host selection)
  };
  
  // Handle player reconnection during match
  function handlePlayerReconnected(peerId) {
    const match = window.currentMatch;
    const player = match.getPlayerById(peerId);
    const playerName = player?.name || `Player ${peerId.slice(-4)}`;
    
    // console.log(`✅ ${playerName} reconnected!`);
    
    // Cancel forfeit timeout
    if (match._reconnectTimeout) {
      clearTimeout(match._reconnectTimeout);
      match._reconnectTimeout = null;
    }
    
    // Resume match
    match.isPaused = false;
    match.state = 'playing';
    match._disconnectedPlayerId = null;
    
    // Show notification
    match.showNotification(`✅ ${playerName} reconnected - resuming match`, 'success');
    
    // Hide overlay
    hideDisconnectOverlay();
    
    // Send state sync to reconnected player if we're host
    if (window.Lobby && window.Lobby.isHost) {
      setTimeout(() => {
        p2p.sendData({
          type: 'state_sync',
          tick: match.tick,
          checksum: match.calculateGameStateChecksum()
        }, peerId);
      }, 500);
    }
  }
  
  // Handle peer disconnection - updated to sync isConnected
  function onPeerDisconnected(peerId) {
    // console.log(`👋 Peer disconnected: ${peerId.slice(-8)}`);
    isConnected = p2p.getConnectedPeers().length > 0;
    remoteCommands.delete(peerId);
    
    // Update lobby connection status
    if (window.Lobby) {
      window.Lobby.playerConnectionStates[peerId] = 'disconnected';
      if (window.Lobby.removeConnectedPlayerById) {
        window.Lobby.removeConnectedPlayerById(peerId);
      }
      
      const currentPeers = [...new Set(p2p.getConnectedPeers())];
      if (window.Lobby.syncConnectedPlayersFromPeerIds) {
        window.Lobby.syncConnectedPlayersFromPeerIds(currentPeers);
      } else {
        window.Lobby.connectedPlayers = currentPeers;
      }
      
      // Update lobby UI
      if (window.Lobby.currentGameType && window.Lobby.currentLobby) {
        window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
        
        // If we're the host, announce updated lobby (player count changed)
        if (window.Lobby.isHost && window.Lobby.currentLobby) {
          window.Lobby.announceLobby(window.Lobby.currentLobby);
        }
      }
    }
    
    // Try to reconnect after timeout (only if not in active match)
    if (!window.currentMatch || window.currentMatch.state !== 'playing') {
      setTimeout(() => {
        if (!p2p.getConnectedPeers().includes(peerId)) {
          reconnectAttempts++;
          // console.log(`🔄 Reconnect attempt ${reconnectAttempts} for ${peerId}`);
          p2p.requestMatch(peerId);
        }
      }, net.RECONNECT_TIMEOUT);
    }
  };
  
  // Handle disconnection during active match
  function handleMatchDisconnect(peerId) {
    const match = window.currentMatch;
    const player = match.getPlayerById(peerId);
    const playerName = player?.name || `Player ${peerId.slice(-4)}`;
    
    // console.log(`⚠️ ${playerName} disconnected during match`);
    
    // Pause the match  
    match.isPaused = true;
    const previousState = match.state;
    match.state = 'disconnected';
    
    // Show disconnect overlay
    showDisconnectOverlay(playerName);
    
    // Wait for reconnection (30 second timeout)
    const reconnectTimeout = setTimeout(() => {
      if (match.state === 'disconnected') {
        // Player didn't reconnect - they forfeit
        // console.log(`💀 ${playerName} failed to reconnect - automatic forfeit`);
        match.eliminatePlayer(peerId);
        
        hideDisconnectOverlay();
        
        // Check if match should end
        const remainingPlayers = match.players.filter(p => 
          !match.eliminatedPlayers.has(p.id || p)
        );
        
        if (remainingPlayers.length === 1) {
          match.endMatch(remainingPlayers[0].id || remainingPlayers[0], 'disconnect_forfeit');
        } else if (remainingPlayers.length > 1) {
          // Resume match with remaining players
          match.state = previousState;
          match.isPaused = false;
        }
      }
    }, 30000); // 30 seconds to reconnect
    
    // Store timeout ID so we can cancel if they reconnect
    match._reconnectTimeout = reconnectTimeout;
    match._disconnectedPlayerId = peerId;
  }
  
  // Show disconnect overlay
  function showDisconnectOverlay(playerName) {
    let overlay = document.getElementById('disconnect_overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'disconnect_overlay';
      document.body.appendChild(overlay);
    }
    
    overlay.innerHTML = `
      <div class="disconnect_panel">
        <div class="disconnect_icon">⚠️</div>
        <h2>Player Disconnected</h2>
        <p><strong>${playerName}</strong> has lost connection</p>
        <div class="disconnect_timer">
          <p>Waiting for reconnection...</p>
          <div class="timer_bar"><div class="timer_fill"></div></div>
          <p class="timer_text">30 seconds remaining</p>
        </div>
        <p class="disconnect_hint">Match is paused</p>
      </div>
    `;
    
    overlay.style.display = 'flex';
    
    // Animate timer bar
    const timerFill = overlay.querySelector('.timer_fill');
    const timerText = overlay.querySelector('.timer_text');
    let secondsLeft = 30;
    
    const timerInterval = setInterval(() => {
      secondsLeft--;
      const percent = (secondsLeft / 30) * 100;
      timerFill.style.width = percent + '%';
      timerText.textContent = `${secondsLeft} seconds remaining`;
      
      if (secondsLeft <= 0) {
        clearInterval(timerInterval);
      }
    }, 1000);
    
    overlay._timerInterval = timerInterval;
  }
  
  // Hide disconnect overlay
  function hideDisconnectOverlay() {
    const overlay = document.getElementById('disconnect_overlay');
    if (overlay) {
      if (overlay._timerInterval) {
        clearInterval(overlay._timerInterval);
      }
      overlay.style.display = 'none';
    }
  }
  
  // Track command acknowledgment
  net.trackCommandAck = function(commandId, command) {
    pendingCommandAcks.set(commandId, {
      command: command,
      sentAt: Date.now(),
      retries: 0
    });
  };
  
  // Update last player command time (for LOD sync frequency)
  net.updateLastPlayerCommandTime = function() {
    lastPlayerCommandTime = Date.now();
  };
  
  // Get current adaptive tick rate
  net.getCurrentTickRate = function() {
    return currentTickRate;
  };
  
  // Get peer lag info
  net.getPeerLag = function() {
    const lagInfo = {};
    peerLag.forEach((info, peerId) => {
      lagInfo[peerId] = {
        lastTick: info.lastTick,
        lastSeen: info.lastSeen,
        lag: (window.currentMatch?.tick || tick) - info.lastTick
      };
    });
    return lagInfo;
  };
  
  // Expose p2p for direct access
  Object.defineProperty(net, 'p2p', {
    get: function() { return p2p; }
  });
  
  // Join a broadcast channel
  net.joinBroadcast = function(channelName) {
    if (p2p && p2p.joinBroadcast) {
      p2p.joinBroadcast(channelName);
      // console.log(`📡 Joined broadcast channel: ${channelName}`);
    } else {
      console.warn(`Cannot join broadcast ${channelName}: P2P not ready`);
    }
  };
  
  // Send broadcast message
  net.broadcast = function(data, channelName) {
    if (p2p && p2p.broadcast) {
      p2p.broadcast(data, channelName);
    }
  };
  
  // Handle broadcast messages (lobby/global)
  function onBroadcastMessage(data) {
    // Pass to external handler if set
    if (net.onBroadcast) {
      net.onBroadcast(data);
    }
    
    // Handle lobby messages, game invites, etc.
    switch (data.type) {
      case 'lobby_chat':
        // Update lobby UI
        if (window.ui && window.ui.updateLobbyChat) {
          window.ui.updateLobbyChat(data.message, data.from);
        }
        break;
      case 'game_invite':
        // Show invite UI
        if (window.ui && window.ui.showGameInvite) {
          window.ui.showGameInvite(data.from, data.gameType);
        }
        break;
      case 'lobby_closed':
        // Host closed the lobby - return to browser
        if (window.Lobby && data.lobbyId === window.Lobby.currentLobbyId) {
          console.log('🚪 Host closed lobby (broadcast) - returning to browser');
          window.Lobby.leaveLobby();
          if (window.ui && window.ui.showMenu) {
            window.ui.showMenu('main_menu');
          }
        }
        break;
      default:
        // Ignore unknown broadcast types
    }
  };
  
  // Send full state sync (BOTH players send their own unit positions)
  function sendStateSync() {
    if (!isConnected) return; // Both host and client send state
    
    // PEER-TO-PEER: Each player only sends their OWN unit positions
    const localOwnerId = localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
    
    // Find only OUR units (don't try to sync opponent's units)
    const allUnits = window.gameUnits || [];
    const myUnits = allUnits.filter(u => u.owner === localOwnerId);
    
    // CRITICAL: Include resource tile states for camps at sync checkpoints
    // This ensures resource states stay synchronized even if workers complete at different ticks
    const resourceStates = {};
    if (window.gameBuildings && tick % (window.currentMatch?.syncInterval || 100) === 0) {
      window.gameBuildings.forEach(building => {
        if (building.owner === localOwnerId && building.availableResources && building.availableResources.length > 0) {
          resourceStates[building.id] = building.availableResources.map(r => ({
            gridX: r.gridX,
            gridZ: r.gridZ,
            remaining: r.remaining || 0,
            depleted: r.depleted || false,
            depletionTick: r.depletionTick
          }));
        }
      });
    }
    
    const state = {
      tick: tick,
      playerId: localOwnerId, // Identify which player this state is from
      resources: window.player?.resources || {},
      units: myUnits.map(u => ({
        id: u.id,
        pos: {x: u.pb.state.loc.x, z: u.pb.state.loc.z},
        health: u.currentHealth,
        state: u.state
      })),
      buildings: window.gameBuildings?.filter(b => b.owner === localOwnerId).map(b => ({
        id: b.id, 
        type: b.type, 
        pos: b.position
      })) || [],
      resourceStates: Object.keys(resourceStates).length > 0 ? resourceStates : undefined, // Only include if we have resources
      timestamp: Date.now()
    };
    
    const message = {
      type: 'state_sync',
      isHost: true,
      content: state,
      tick: tick
    };
    
    p2p.sendData(message);
    // Log occasionally (disabled - working!)
    // if (tick % (net.TICK_RATE * 5) === 0) {
    //   console.log(`📤 Sent state sync: ${myUnits.length} units from player ${localOwnerId} at tick ${tick}`);
    // }
  };
  
  // Reconcile with authoritative state (PEER-TO-PEER version)
  function reconcileState(remoteState) {
    const remoteTick = remoteState.tick;
    const remotePlayerId = remoteState.playerId;
    const tickDiff = remoteTick - tick;
    
    // Don't sync ticks - let them run independently and rely on command scheduling
    // Commands are scheduled for specific ticks and will execute when both clients reach that tick
    // Position sync every 200ms handles any drift in simulation results
    
    // Only reconcile positions if reasonably close (prevent massive rewinds)
    if (Math.abs(tickDiff) > 10) {
      // console.log(`⚠️ Tick desync: local=${tick}, remote=${remoteTick} (diff: ${tickDiff})`);
      // Still reconcile positions even if ticks are desynced
    }
    
    // CRITICAL: Never rewind simulation - we're using lockstep with checkpoint sync
    // If remote tick is behind, it means they sent stale data - skip position updates
    // The rewindSimulation function is a placeholder and should not be used in P2P lockstep
    // if (remoteTick < tick) {
    //   rewindSimulation(remoteTick); // DISABLED: Never rewind in lockstep mode
    // }
    
    // Apply state corrections
    const localOwnerId = localPlayerShortId || normalizePeerId(localPlayerId) || localPlayerId;
    
    // Skip if this is our own state echoed back
    if (remotePlayerId === localOwnerId) {
      return;
    }
    
    // Debug: Log state sync info occasionally (disabled - working!)
    // if (tick % (net.TICK_RATE * 5) === 0) {
    //   console.log(`📥 Received state from player ${remotePlayerId}: ${remoteState.units.length} units at tick ${remoteTick}`);
    // }
    
    // Update remote player resources
    if (window.opponent && remotePlayerId === window.opponent.id) {
      window.opponent.resources = {...remoteState.resources};
    }
    
    // CRITICAL: Sync resource tile states at sync checkpoints
    // This ensures resource states stay synchronized even if workers complete at different ticks
    if (remoteState.resourceStates && window.gameBuildings && tick % (window.currentMatch?.syncInterval || 100) === 0) {
      Object.keys(remoteState.resourceStates).forEach(buildingId => {
        const building = window.gameBuildings.find(b => b.id === buildingId);
        if (building && building.availableResources) {
          const remoteResources = remoteState.resourceStates[buildingId];
          
          // Update each resource tile state
          remoteResources.forEach(remoteResource => {
            const localResource = building.availableResources.find(r => 
              r.gridX === remoteResource.gridX && r.gridZ === remoteResource.gridZ
            );
            
            if (localResource) {
              // Sync remaining amount and depletion state
              localResource.remaining = remoteResource.remaining;
              localResource.depleted = remoteResource.depleted;
              localResource.depletionTick = remoteResource.depletionTick;
            }
          });
          
          console.log(`🔄 Synced resource states for building ${buildingId} at tick ${tick}`);
        }
      });
    }
    
    // Update remote units with smart correction
    let unitsFound = 0;
    let unitsUpdated = 0;
    let ownerMismatches = 0;
    
    // CRITICAL: Skip position reconciliation for stale state_sync messages
    // Checkpoint sync (unit_position_sync) handles position sync, so state_sync should
    // only be used for health/state updates. Old state_sync messages with stale positions
    // cause false "catastrophic desync" warnings.
    const isStaleMessage = Math.abs(tickDiff) > 50; // More than 50 ticks old = stale
    
    remoteState.units.forEach(remoteUnit => {
      const localUnit = findUnitById(remoteUnit.id);
      if (localUnit) {
        unitsFound++;
        
        // Only accept position updates from the unit's owner
        // Normalize IDs for comparison (last 6 chars)
        const localUnitOwnerId = localUnit.owner?.slice ? localUnit.owner.slice(-6) : localUnit.owner;
        const remoteOwnerId = remotePlayerId?.slice ? remotePlayerId.slice(-6) : remotePlayerId;
        
        // Skip if this unit doesn't belong to the remote player
        if (localUnitOwnerId !== remoteOwnerId) {
          ownerMismatches++;
          return; // Not their unit to update
        }
        
        unitsUpdated++;
        
        // P2P with checkpoint sync: We now sync positions at checkpoints (every 100 ticks)
        // This old reconcile system is just a safety net for catastrophic desyncs
        // Only snap on MASSIVE drift (>50 units = missed command or major logic error)
        // CRITICAL: Never apply positions from past ticks - only forward or current tick
        // Skip position reconciliation entirely for stale messages to prevent false desync warnings
        if (!isStaleMessage && remoteTick >= tick) {
          // Only reconcile if remote tick is current or future (never past)
          const dx = remoteUnit.pos.x - localUnit.pb.state.loc.x;
          const dz = remoteUnit.pos.z - localUnit.pb.state.loc.z;
          const distanceSq = dx * dx + dz * dz;
          
          // Only snap if drift is CATASTROPHIC (> 50 units - probably missed a command)
          // Normal ~10 unit drift is handled by checkpoint sync every 100 ticks
          if (distanceSq > 2500) { // 50^2 = 2500
            localUnit.pb.state.loc.x = remoteUnit.pos.x;
            localUnit.pb.state.loc.z = remoteUnit.pos.z;
            console.warn(`⚠️ CATASTROPHIC DESYNC: Snapped unit ${localUnit.id.slice(-4)} - drift: ${Math.sqrt(distanceSq).toFixed(2)} units`);
          }
          // Small drift (<50 units) is normal and will be corrected at next checkpoint sync
        }
        // If message is stale or from past tick, skip position updates entirely - checkpoint sync handles positions
        
        // Always sync health and state immediately (even for stale messages)
        localUnit.currentHealth = remoteUnit.health;
        localUnit.state = remoteUnit.state;
      }
    });
    
    // Log summary occasionally (disabled - working!)
    // if (tick % (net.TICK_RATE * 5) === 0) {
    //   console.log(`     ├─ Found: ${unitsFound}/${remoteState.units.length}, Updated: ${unitsUpdated}, Owner mismatches: ${ownerMismatches}`);
    // }
    
    // Update buildings (if provided)
    if (remoteState.buildings && remoteState.buildings.length > 0) {
      // Initialize buildings array if it doesn't exist
      if (!window.buildings) {
        window.buildings = [];
      }
      
      remoteState.buildings.forEach(remoteBuilding => {
        // Find or create local building representation
        let localBuilding = window.buildings.find(b => b.id === remoteBuilding.id);
        if (!localBuilding) {
          // Create ghost building for opponent
          localBuilding = createGhostBuilding(remoteBuilding);
          window.buildings.push(localBuilding);
        } else {
          // Update position if moved (rare)
          localBuilding.position.x = remoteBuilding.pos.x;
          localBuilding.position.z = remoteBuilding.pos.z;
        }
      });
    }
  };
  
  // Rewind simulation to previous tick (for corrections)
  function rewindSimulation(targetTick) {
    // Store current state
    const backupState = captureGameState();
    
    // Reset to target tick (simplified - in full impl, replay commands up to targetTick)
    tick = targetTick;
    
    // Restore from backup or replay commands (placeholder)
    // In production: replay all commands up to targetTick deterministically
    // console.log(`⏪ Rewound simulation to tick ${targetTick}`);
  };
  
  // Capture current game state for backup/rewind
  function captureGameState() {
    return {
      tick: tick,
      units: window.gameUnits?.map(u => ({
        id: u.id,
        pos: {...u.pb.state.loc},
        rot: {...u.pb.state.rot},
        health: u.currentHealth,
        state: u.state
      })) || [],
      resources: window.player?.resources || {},
      buildings: window.buildings?.map(b => ({id: b.id, type: b.type, health: b.health})) || []
    };
  };
  
  // Create ghost building for opponent (visual only)
  function createGhostBuilding(buildingData) {
    // Create simplified mesh for opponent building
    const mesh = BABYLON.MeshBuilder.CreateBox(`ghost_${buildingData.id}`, {size: 2}, window.gfx.scene);
    mesh.position.x = buildingData.pos.x;
    mesh.position.z = buildingData.pos.z;
    mesh.material = new BABYLON.StandardMaterial('ghostMat', window.gfx.scene);
    mesh.material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 1); // Blue tint for opponent
    mesh.isPickable = false; // Can't interact with ghost buildings
    
    return {
      id: buildingData.id,
      type: buildingData.type,
      position: {x: buildingData.pos.x, z: buildingData.pos.z},
      mesh: mesh,
      owner: 'opponent',
      health: 100 // Default
    };
  };
  
  // OLD auto-start code removed - lobby system handles game start now via START button
  
  // Cleanup on disconnect
  net.disconnect = function() {
    if (p2p) {
      p2p.disconnect();
    }
    isConnected = false;
    commandBuffer = [];
    remoteCommands.clear();
    tick = 0;
    // console.log('🌐 Network disconnected');
  };
  
  // Switch to a different lobby
  net.switchLobby = function(newLobbyKey) {
    const myUserId = p2p ? p2p.getUserId() : 'unknown';
    // console.log(`🔄 [${myUserId}] Switching to lobby: ${newLobbyKey}`);
    
    if (net.currentLobby === newLobbyKey) {
      // console.log(`[${myUserId}] Already in this lobby`);
      return;
    }
    
    // Leave current lobby if in one
    if (p2p && net.currentLobby) {
      // Note: GetFire P2P doesn't have a leave function, so we just rejoin
      // console.log(`[${myUserId}] Leaving lobby: ${net.currentLobby}`);
    }
    
    // Join new lobby
    if (p2p && p2p.joinMatchLobby) {
      p2p.joinMatchLobby(newLobbyKey);
      net.currentLobby = newLobbyKey;
      
      // Reset state for new lobby
      commandBuffer = [];
      remoteCommands.clear();
      isConnected = false;
      
      // console.log(`✅ [${myUserId}] Switched to ${newLobbyKey}`);
      
      // Announce presence after a delay to catch existing players
      // GetFire's connected() callback sends player_join, but we send player_rejoin
      // to catch anyone who's already in the lobby
      // CRITICAL: Use p2p.getUserId() not localPlayerId!
      setTimeout(() => {
        const userId = p2p.getUserId();
        // console.log(`🔍 [${userId}] Checking for subscription to ${newLobbyKey}...`);
        
        if (p2p.consumer && p2p.consumer.subscriptions && p2p.consumer.subscriptions.subscriptions) {
          const allSubs = Array.from(p2p.consumer.subscriptions.subscriptions);
          // console.log(`📋 [${userId}] Found ${allSubs.length} subscriptions:`, 
          //   allSubs.map(s => JSON.parse(s.identifier).game_lobby));
          
          const subscription = allSubs.find(
            s => s.identifier && JSON.parse(s.identifier).game_lobby === newLobbyKey
          );
          
          if (subscription) {
            subscription.perform('speak', {
              game_lobby: newLobbyKey,
              type: 'player_rejoin',
              from: userId,  // MUST use GetFire's userId, not our localPlayerId!
              content: 'announcing presence'
            });
            // console.log(`📢 [${userId}] Announced presence in ${newLobbyKey}`);
          } else {
            console.error(`❌ [${userId}] Could not find subscription for ${newLobbyKey}!`);
          }
        } else {
          console.error(`❌ [${userId}] No consumer/subscriptions available!`);
        }
      }, 1000); // Longer delay to ensure ActionCable is fully connected
    } else {
      console.error(`❌ [${myUserId}] P2P not initialized, cannot switch lobby`);
    }
  };
  
  // Debug: Log network stats
  net.logStats = function() {
    const status = net.getStatus();
    // console.log('🌐 Network Stats:', {
    //   ...status,
    //   remoteQueues: Array.from(remoteCommands.values()).map(q => q.length)
    // });
  };
  
  // Export public API
  window.net = net;
  
})(window.net = window.net || {});

// Make deterministic RNG available globally for lockstep
// (Replace Math.random() calls with this for reproducible sim)
window.deterministicRandom = function(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

// DON'T auto-initialize networking here!
// The lobby system will initialize it when user picks a game type
// This ensures proper devMode detection and lobby selection
