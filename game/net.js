// Multiplayer Networking Layer for Aether RTS
// Handles P2P sync via GetFire, lockstep commands, prediction, and reconciliation
// Supports: 1v1, Adventure, Teams, King of the Hill

(function(net) {
  // Configuration
  net.TICK_RATE = 20; // 20Hz = 50ms ticks
  net.COMMAND_BUFFER_SIZE = 100; // Max buffered commands
  net.STATE_SYNC_INTERVAL = 200; // Full state every 200ms (5 times per second for smooth remote unit movement)
  net.RECONNECT_TIMEOUT = 3000; // Reconnect attempts every 3s
  net.SNAP_THRESHOLD = 10; // Units >10 units away snap instead of lerp (reduced snapping)
  net.LERP_SPEED = 0.3; // 30% correction per sync (slower, smoother lerp)
  
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
  
  // Start the deterministic tick loop
  net.startTickLoop = function() {
    const tickInterval = 1000 / net.TICK_RATE;
    setInterval(() => {
      tick++;
      processTick();
    }, tickInterval);
  };
  
  // Process a single tick (lockstep)
  function processTick() {
    // Execute buffered commands for this tick
    executeCommandsForTick(tick);
    
    // Update match state (deterministic) - the match handles victory conditions and game state
    if (window.currentMatch && window.currentMatch.processTick) {
      window.currentMatch.processTick();
    }
    
    // Send state sync if needed (BOTH players send their own state)
    if (Date.now() - lastStateSync > net.STATE_SYNC_INTERVAL && isConnected) {
      sendStateSync();
      lastStateSync = Date.now();
    }
  };
  
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
          // Reconcile with authoritative state from host
          // Always process state sync to keep ticks in sync (even if positions drift too far)
          if (actualMessage.isHost) {
            reconcileState(actualMessage.content);
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
            
            
            // Check if command is for a past tick (arrived too late)
            if (cmd.tick < window.currentMatch.tick) {
              const ticksLate = window.currentMatch.tick - cmd.tick;
              // Fast-forward physics to catch up (normal network latency, not an error)
              
              // Execute the command to start the behavior
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
              // Add to match command buffer for future execution
              const tickKey = cmd.tick;
              if (!window.currentMatch.commandBuffer.has(tickKey)) {
                window.currentMatch.commandBuffer.set(tickKey, []);
              }
              window.currentMatch.commandBuffer.get(tickKey).push(cmd);
            }
            
            // Add to command history
            window.currentMatch.commandHistory.push(cmd);
            window.currentMatch.replay.commands.push(cmd);
          }
          break;
          
        case 'sync_checkpoint':
          // Verify synchronization checkpoint
          if (window.currentMatch && actualMessage.tick && actualMessage.checksum) {
            window.currentMatch.verifySyncCheckpoint(actualMessage.tick, actualMessage.checksum);
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
            window.currentMatch.onPlayerLoaded(actualMessage.playerId);
          }
          break;
          
        case 'match_countdown':
          // Host broadcasting countdown to clients
          if (window.currentMatch && actualMessage.countdown) {
            window.currentMatch.updateLoadingOverlay(`${actualMessage.countdown}`);
          }
          break;
          
        case 'match_start':
          // Host signaling all clients to start playing
          if (window.currentMatch && window.currentMatch.beginPlaying) {
            window.currentMatch.beginPlaying();
          }
          break;
          
        case 'match_pause':
          // Player broadcasting pause to all others
          if (window.currentMatch) {
            window.currentMatch.isPaused = true;
            window.currentMatch.updateLoadingOverlay('⏸️ PAUSED');
            // console.log('⏸️ Match paused by remote player');
          }
          break;
          
        case 'match_resume':
          // Player broadcasting resume to all others
          if (window.currentMatch) {
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
    
    // Rewind simulation if needed
    if (remoteTick < tick) {
      rewindSimulation(remoteTick);
    }
    
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
    
    // Update remote units with smart correction
    let unitsFound = 0;
    let unitsUpdated = 0;
    let ownerMismatches = 0;
    
    remoteState.units.forEach(remoteUnit => {
      const localUnit = findUnitById(remoteUnit.id);
      if (localUnit) {
        unitsFound++;
        
        // Debug: Check owner matching
        if (localUnit.owner === localOwnerId) {
          ownerMismatches++;
          if (Math.random() < 0.1) { // 10% chance to log
            console.warn(`⚠️ Unit ${remoteUnit.id.slice(-4)} owner mismatch: localUnit.owner="${localUnit.owner}" === localOwnerId="${localOwnerId}"`);
          }
          return; // Skip our own units
        }
        
        unitsUpdated++;
        
        // CRITICAL: Since remote units no longer run local behaviors/physics,
        // we MUST snap them directly to network positions (no lerp/prediction)
        // The visual interpolation in updateUnitMeshes will smooth the movement
        
        // Debug: Log position updates occasionally (disabled - working!)
        // if (Math.random() < 0.05) { // 5% chance
        //   console.log(`📍 Updating remote unit ${localUnit.id.slice(-4)} (owner: ${localUnit.owner}) from (${localUnit.pb.state.loc.x.toFixed(1)}, ${localUnit.pb.state.loc.z.toFixed(1)}) to (${remoteUnit.pos.x.toFixed(1)}, ${remoteUnit.pos.z.toFixed(1)})`);
        // }
        
        localUnit.pb.state.loc.x = remoteUnit.pos.x;
        localUnit.pb.state.loc.z = remoteUnit.pos.z;
        
        // Always sync health and state immediately
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
