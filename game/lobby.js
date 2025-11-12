// Lobby system for managing game matches and multiplayer matchmaking
const Lobby = {
  
  // Track lobby state
  currentGameType: null,
  currentLobbyId: null,
  connectedPlayers: [],
  isHost: false,
  lobbyUpdateInterval: null,
  lobbyDiscoveryInterval: null,
  availableLobbies: {}, // {gameType: [{id, name, host, players, maxPlayers, settings}, ...]}
  playerReadyStates: {}, // {peerId: true/false}
  playerConnectionStates: {}, // {peerId: 'connecting' | 'connected' | 'disconnected'}
  globalStatsChannel: null,
  playerStatuses: {}, // {playerId: {gameType, status, timestamp}}
  connectedChannels: {}, // Track which channels are connected
  pendingBroadcasts: [], // Queue broadcasts until channel is ready
  lobbySearchStartTime: {}, // Track when we started searching for lobbies per game type
  
  // Game type configurations
  gameTypes: {
    'adventure': {
      name: 'Adventure',
      maxPlayers: 4,
      lobbyKey: 'aether-adventure-coop',
      defaultFieldSize: 'large'
    },
    'onevsone': {
      name: '1 vs 1',
      maxPlayers: 2,
      lobbyKey: 'aether-1v1-quick',
      defaultFieldSize: 'tiny'
    },
    'koth': {
      name: 'King of the Hill',
      maxPlayers: 4,
      lobbyKey: 'aether-koth',
      defaultFieldSize: 'medium'
    },
    'teams': {
      name: 'Teams',
      maxPlayers: 4,
      lobbyKey: 'aether-teams-2v2',
      defaultFieldSize: 'large'
    }
  },
  
  // Reset the field and game state to defaults
  resetGameState: function() {
    // console.log('🧹 Starting complete scene cleanup...');
    
    try {
      if (window.currentMatch && typeof window.currentMatch.stopLocalTickLoop === 'function') {
        window.currentMatch.stopLocalTickLoop();
      }
      window.currentMatch = null;
      window.opponent = null;
      window.aiOpponents = [];
      if (window.loadingPreviewBuildings && window.loadingPreviewBuildings.length > 0) {
        window.loadingPreviewBuildings.forEach(preview => {
          if (preview && preview.mesh && typeof preview.mesh.dispose === 'function') {
            preview.mesh.dispose();
          }
        });
        window.loadingPreviewBuildings.length = 0;
      }
      
      // Stop the current game loop if running
      if (window.gameLoop && window.gameLoop.stop) {
        window.gameLoop.stop();
      }
      
      // MINIMAL scene cleanup - only dispose units and buildings, keep EVERYTHING else
      // The field will be regenerated but we don't need to clean up old meshes
      // console.log('🧹 Cleaning up units and buildings only (keeping terrain/table)...');
    
    // Clear existing game units with proper cleanup
    // console.log('🗑️ Destroying game units...');
    if (window.gameUnits) {
      window.gameUnits.forEach(unit => {
        if (window.destroyUnit) {
          window.destroyUnit(unit);
        } else if (unit.mesh && unit.mesh.dispose) {
          unit.mesh.dispose();
        }
      });
      // CRITICAL: Clear in-place to preserve reference (don't replace array)
      window.gameUnits.length = 0;
    }
    // console.log('✅ Game units destroyed');
    
    // Clear player units (should already be empty if destroyUnit works correctly)
    // console.log('🗑️ Clearing player units array...');
    if (window.player && window.player.units) {
      // Don't destroy again - just clear the array (units already destroyed above)
      window.player.units = [];
    }
    // console.log('✅ Player units array cleared');
    
    // Clear player buildings
    // console.log('🗑️ Destroying player buildings...');
    if (window.player && window.player.buildings) {
      window.player.buildings.forEach(building => {
        if (building.mesh && building.mesh.dispose) {
          building.mesh.dispose();
        }
      });
      window.player.buildings = [];
    }
    // console.log('✅ Player buildings destroyed');
    
    // Clear player selection
    // console.log('🗑️ Clearing player selection...');
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
    }
    // console.log('✅ Player selection cleared');
    
    // Don't dispose player visual assets - just let them get updated with new position
    
    // Reset player resources to starting values
    if (window.player && window.player.resources) {
      window.player.resources = {
        food: 100,
        wood: 50,
        stone: 25,
        magic: 10
      };
    }
    
    // DON'T reset player position here - it will be set correctly in startMultiplayerMatch
    // after the agora position is determined based on spawn locations
    
    // Clear any existing buildings
    // console.log('🗑️ Clearing building system...');
    if (window.buildingSystem && window.buildingSystem.buildings) {
      window.buildingSystem.buildings.forEach(building => {
        if (building.mesh && building.mesh.dispose) {
          building.mesh.dispose();
        }
      });
      window.buildingSystem.buildings = [];
    }
    // console.log('✅ Building system cleared');
    
    // Clear global playerBuildings array
    // console.log('🗑️ Clearing playerBuildings array...');
    if (window.playerBuildings) {
      window.playerBuildings.forEach(building => {
        if (building.mesh && building.mesh.dispose) {
          building.mesh.dispose();
        }
      });
      window.playerBuildings.length = 0;
    } else {
      window.playerBuildings = [];
    }
    // console.log('✅ Player buildings array cleared');
    
    // console.log('🗑️ Clearing gameBuildings array...');
    if (window.gameBuildings) {
      window.gameBuildings.forEach(building => {
        if (building.mesh && building.mesh.dispose) {
          building.mesh.dispose();
        }
      });
      window.gameBuildings.length = 0;
    }
    // console.log('✅ Game buildings array cleared (agoras removed)');
    
    // console.log('🗑️ Clearing LOD models array...');
    if (window.gfx && window.gfx.clearLODModels) {
      window.gfx.clearLODModels();
    }
    // console.log('✅ LOD models cleared');
    
    // Don't touch field chunks - new Field() will replace the old one completely
    // console.log('🗺️ Field will be replaced with new seeded field');
    
    // Clear any existing fog of war
    // console.log('🗑️ Clearing fog of war...');
    if (window.fogSystem && window.fogSystem.clear) {
      window.fogSystem.clear();
    }
    // console.log('✅ Fog of war cleared');
    
    // Clean up opponent
    // console.log('🗑️ Cleaning up opponent...');
    if (window.OpponentSystem) {
      window.OpponentSystem.cleanupOpponent();
    }
    // console.log('✅ Opponent cleaned up');
    
      // Clear behavior manager
      // console.log('🗑️ Clearing behavior manager...');
      if (window.behaviorManager && window.behaviorManager.clear) {
        window.behaviorManager.clear();
      }
      // console.log('✅ Behavior manager cleared');
      
      // console.log('✅ Game state reset complete - scene cleaned');
    } catch (error) {
      console.error('❌ Error during resetGameState:', error);
      console.error('Stack:', error.stack);
      throw error; // Re-throw so we know something failed
    }
  },
  
  // Start a new match from the lobby
  // Start a 1v1 match - follows adventure mode pattern for proper initialization
  start1v1Match: function(fieldSize = 'medium', mapSeed = null) {
    console.log('⚔️ Starting 1v1 match versus AI (local)...');
    
    const config = this.gameTypes['onevsone'];
    const resolvedFieldSize = fieldSize || (config ? config.defaultFieldSize : 'medium');
    const resolvedSeed = Number.isFinite(Number(mapSeed))
      ? Math.floor(Number(mapSeed))
      : Math.floor(Math.random() * 1000000);
    
    // Reset scene and ensure clean slate
    this.resetGameState();
    
    window.isMultiplayer = false;
    window.gameType = 'onevsone';
    window.mapSeed = resolvedSeed;
    
    // Ensure player instance exists
    if (!window.player) {
      window.player = new Player();
      console.log('🆕 Created new player for 1v1');
    } else {
      console.log(`♻️ Reusing existing player (id: ${window.player.id || 'not set'})`);
    }
    
    // Ensure player has correct ID
    if (!window.player.id || window.player.id === 'undefined') {
      window.player.id = 'player';
      console.log('✅ Set player.id to "player"');
    }
    
    // Reset player state for new match
    window.player.units = [];
    window.player.buildings = [];
    window.player.selectedUnits = [];
    
    console.log(`🎮 Player ready: id="${window.player.id}", agora will be set to corner spawn`);
    
    // Resolve field dimensions for 1v1 (typically smaller than adventure)
    const dims = (typeof resolvedFieldSize === 'string')
      ? (this.getFieldDimensions(resolvedFieldSize) || { width: 128, height: 128 })
      : { width: resolvedFieldSize, height: resolvedFieldSize };
    
    // 1v1: Two players in opposite corners
    const cornerMargin = Math.max(8, Math.floor(Math.min(dims.width, dims.height) * 0.1));
    const spawnPositions = [
      { x: cornerMargin, y: cornerMargin }, // Player
      { x: dims.width - cornerMargin - 1, y: dims.height - cornerMargin - 1 } // AI opponent
    ];
    
    const tileSize = (typeof TILE_SIZE === 'number') ? TILE_SIZE : (window.TILE_SIZE || 4);
    
    // Configure local player identity and spawn
    const localPlayerId = window.player.id || 'player';
    window.player.id = localPlayerId;
    window.player.name = window.currentPlayerName || 'Duelist';
    window.player.color = window.currentPlayerColor || '#ff0000';
    window.player.agora = spawnPositions[0];
    window.player.basePosition = { x: spawnPositions[0].x, z: spawnPositions[0].y };
    
    if (window.player.pbody) {
      const agoraX = window.player.agora.x * tileSize;
      const agoraZ = window.player.agora.y * tileSize;
      window.player.pbody.state.loc.set(agoraX, 0, agoraZ);
      window.player.pbody.vel.set(0, 0, 0);
      window.player.pbody.imp.set(0, 0, 0);
    }
    
    // Create single AI opponent for 1v1
    const spawn = spawnPositions[1];
    const aiId = `ai-opponent-${resolvedSeed.toString(16)}`;
    const aiOptions = {
      id: aiId,
      name: 'AI Opponent',
      color: '#0066cc',
      startingResources: { food: 120, wood: 80, stone: 40, magic: 20 },
      agora: spawn,
      basePosition: { x: spawn.x, z: spawn.y },
      difficulty: 'normal',
      isAI: true
    };
    
    const aiPlayer = window.AIPlayer ? new window.AIPlayer(aiOptions) : new window.OpponentPlayer(aiOptions);
    aiPlayer.isAI = true;
    aiPlayer.agora = spawn;
    aiPlayer.basePosition = { x: spawn.x, z: spawn.y };
    
    window.aiOpponents = [aiPlayer];
    window.opponent = aiPlayer;
    
    // Regenerate field with desired seed
    console.log(`🗺️ Regenerating field with seed ${resolvedSeed} for 1v1 match...`);
    const oldField = window.liveField;
    
    // Dispose old field before creating new one
    if (oldField && typeof oldField.dispose === 'function') {
      oldField.dispose();
    }
    
    // Create the new field
    window.liveField = new window.Field({
      width: dims.width,
      height: dims.height,
      seed: resolvedSeed
    });
    if (typeof liveField !== 'undefined') {
      liveField = window.liveField;
    }
    
    // CRITICAL: Apply current LOD settings to new field immediately!
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      const currentMultiplier = window.hud.getCurrentLODMultiplier();
      const savedLOD = localStorage.getItem('lodLevel');
      const lodLevel = savedLOD ? parseInt(savedLOD) : 50;
      
      window.liveField.originalLoadDistance = 4;
      const newLoadDistance = Math.round(4 * currentMultiplier);
      window.liveField.currentLoadDistance = Math.max(2, Math.min(8, newLoadDistance));
      
      console.log(`🗺️ New field initialized with LOD ${lodLevel}% → chunk distance: ${window.liveField.currentLoadDistance}`);
    }
    
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    window._cameraLimitsSet = false;
    
    // Position camera at local spawn FIRST
    if (window.gfx && window.gfx.camera && window.gfx.cameraTarget) {
      const agoraX = window.player.agora.x * tileSize;
      const agoraZ = window.player.agora.y * tileSize;
      window.gfx.cameraTarget.position.x = agoraX;
      window.gfx.cameraTarget.position.y = 9;
      window.gfx.cameraTarget.position.z = agoraZ;
      
      if (window.cameraAnchor) {
        window.cameraAnchor.x = agoraX;
        window.cameraAnchor.y = 9;
        window.cameraAnchor.z = agoraZ;
      }
      
      window.gfx.camera.alpha = -2.5;
      window.gfx.camera.beta = 0.9;
      window.gfx.camera.radius = 80;
      if (window.gfx.camera.attachControl) {
        window.gfx.camera.attachControl(window.gfx.canvas, false);
        
        // Re-disable built-in inputs after re-attaching
        if (window.gfx.camera.inputs && window.gfx.camera.inputs.attached) {
          if (window.gfx.camera.inputs.attached.pointers) {
            try { window.gfx.camera.inputs.attached.pointers.detachControl(); } catch (e) {}
          }
          if (window.gfx.camera.inputs.attached.mousewheel) {
            window.gfx.camera.inputs.attached.mousewheel.detachControl();
          }
          if (window.gfx.camera.inputs.attached.keyboard) {
            try { window.gfx.camera.inputs.attached.keyboard.detachControl(); } catch (e) {}
          }
        }
      }
    }
    
    // Force-load chunks at spawn position
    if (window.gfx && window.gfx.forceLoadChunks && window.gfx.cameraTarget) {
      const targetPos = window.gfx.cameraTarget.position;
      window.gfx.forceLoadChunks(targetPos.x, targetPos.z);
    }
    
    // Prepare player arrays
    const players = [window.player, aiPlayer];
    window.playerBuildings = window.playerBuildings || [];
    window.gameUnits = window.gameUnits || [];
    
    // Create game instance (handles spawning units/buildings)
    window.game = new window.Game({
      type: 'onevsone',
      map: 'default',
      mapSeed: resolvedSeed,
      players: players,
      isMultiplayer: false,
      tickRate: 60,
      maxPlayers: 2
    });
    
    console.log('✅ 1v1 game instance created with players:', players.map(p => p.id));
    
    // Ensure unit models are spawned for visual layer
    console.log(`🎨 About to spawn unit models for ${window.gameUnits?.length || 0} units`);
    
    if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
      window.spawnUnitModels(window.gfx.scene);
      console.log(`✅ spawnUnitModels called - meshes will load asynchronously`);
    }
    
    // Create match controller for deterministic command handling
    window.currentMatch = new window.Match({
      id: `onevsone-${Date.now()}`,
      gameType: 'onevsone',
      mapSeed: resolvedSeed,
      mapSize: resolvedFieldSize,
      players: players,
      localPlayerId: window.player.id,
      hostId: window.player.id,
      victoryCondition: 'elimination',
      timeLimit: 0
    });
    
    // Enter playing state immediately for local match
    window.currentMatch.beginPlaying();
    if (window.currentMatch.startLocalTickLoop) {
      window.currentMatch.startLocalTickLoop();
    }
    
    // Clear any selections from menu scene
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
      console.log('🗑️ Cleared menu scene selections before match start');
    }
    
    // Start physics/game loop
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // DIAGNOSTIC: Check unit state after everything is initialized
    setTimeout(() => {
      console.log('🔍 POST-INIT DIAGNOSTIC (2 seconds after match start):');
      console.log(`  - gameUnits.length: ${window.gameUnits?.length || 0}`);
      console.log(`  - player.units.length: ${window.player?.units?.length || 0}`);
      console.log(`  - player.id: ${window.player?.id}`);
      
      if (window.gameUnits && window.gameUnits.length > 0) {
        const withMesh = window.gameUnits.filter(u => u.mesh).length;
        const withoutMesh = window.gameUnits.filter(u => !u.mesh).length;
        const playerOwned = window.gameUnits.filter(u => u.owner === window.player?.id || u.owner === 'player').length;
        
        console.log(`  - Units with meshes: ${withMesh}/${window.gameUnits.length}`);
        console.log(`  - Units without meshes: ${withoutMesh}/${window.gameUnits.length}`);
        console.log(`  - Player-owned units: ${playerOwned}`);
      }
      
      if (window.gfx && window.gfx.cameraTarget) {
        console.log(`  - Camera position: (${window.gfx.cameraTarget.position.x.toFixed(1)}, ${window.gfx.cameraTarget.position.z.toFixed(1)})`);
        console.log(`  - Player agora: (${window.player.agora.x * TILE_SIZE}, ${window.player.agora.y * TILE_SIZE})`);
      }
    }, 2000);
    
    // Hide lobby/menu UI and refresh HUD
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    if (window.hud && window.hud.updateResources) {
      window.hud.updateResources();
    }
    
    delete window.pendingMapSeed;
    
    console.log('⚔️ 1v1 match ready!');
  },
  
  // Legacy startMatch function - redirects to proper initialization
  startMatch: function(matchType = '1v1', fieldSize = 'medium', mapSeed = null) {
    console.log(`🔄 Redirecting legacy startMatch to proper initialization...`);
    if (matchType === '1v1' || matchType === 'onevsone') {
      return this.start1v1Match(fieldSize, mapSeed);
    } else {
      console.warn(`⚠️ Unknown match type: ${matchType}`);
    }
  },
  
  // Initialize the lobby system
  init: function() {
    // console.log('🏛️ Lobby system initialized');
    
    
    // Add click handlers for other lobby types
    this.setupLobbyButtons();
    
    // Join global stats channel for main menu (wait for P2P to be ready)
    this.waitForP2PAndJoinGlobalStats();
    
    // Start periodic main menu stats updates
    setInterval(() => {
      if (document.getElementById('main_menu').style.display !== 'none') {
        this.updateMainMenuStats();
      }
    }, 5000); // Update every 5 seconds
    
    // Do initial update
    this.updateMainMenuStats();
  },
  
  // Join global stats channel
  joinGlobalStatsChannel: function() {
    // console.log('🌍 Attempting to join global stats channel...');
    // Initialize network ONCE (just for broadcast, no P2P matching yet)
    if (!window.net || !window.net.initialized) {
      const isLocalhost = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1';
      window.net = window.net || {};
      if (window.net.init) {
        // console.log('🌐 Initializing network for global stats (first time)');
        window.net.init({
          gameType: 'global',
          devMode: isLocalhost,
          lobbyBrowserMode: true,
          broadcastChannel: 'aether-global-stats'
        });
      }
    } else {
      // console.log('🌐 Network already initialized, reusing existing connection');
    }
    
    // Join global stats broadcast after P2P is ready
    this.waitForBroadcastChannel('aether-global-stats', 5000).then(() => {
      // console.log('🌍 Joined global stats channel');
      
      // Listen for player status announcements
      this.startListeningForGlobalStats();
      
      // Announce our presence periodically
      this.startAnnouncingGlobalStatus();
    }).catch(err => {
      console.error('❌ Failed to join global stats channel:', err);
    });
  },

  // Wait for P2P to be ready, then join global stats
  waitForP2PAndJoinGlobalStats: function() {
    // console.log('⏳ Waiting for P2P to be ready for global stats...');
    
    // First, make sure network is initialized
    if (!window.net || !window.net.initialized) {
      // console.log('🌐 Network not initialized, initializing for global stats...');
      const isLocalhost = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1';
      
      // Initialize network module if it exists
      if (window.net && window.net.init) {
        window.net.init({
          gameType: 'global',
          devMode: isLocalhost,
          lobbyBrowserMode: true,
          broadcastChannel: 'aether-global-stats'
        });
      } else {
        console.error('❌ window.net.init not available!');
        return;
      }
    }
    
    // Then wait for P2P to be ready
    const checkP2P = () => {
      if (window.net && window.net.p2p && window.net.p2p.joinBroadcast) {
        // console.log('✅ P2P ready! Joining global stats channel...');
        this.joinGlobalStatsChannel();
      } else {
        // Retry in 500ms
        setTimeout(checkP2P, 500);
      }
    };
    checkP2P();
  },

  // Wait for broadcast channel to connect (track ourselves)
  waitForBroadcastChannel: function(channelName, timeout = 2500) {
    return new Promise((resolve, reject) => {
      // console.log(`📡 Joining broadcast channel: ${channelName}`);
      // Try to join
      if (window.net && window.net.p2p && window.net.p2p.joinBroadcast) {
        window.net.p2p.joinBroadcast(channelName);
        
        // Mark as "joining"
        this.connectedChannels[channelName] = 'connecting';
        // console.log(`⏳ Waiting 2s for ${channelName} to connect...`);
        
        // Wait for ActionCable WebSocket connection
        setTimeout(() => {
          this.connectedChannels[channelName] = true;
          // console.log(`✅ Broadcast channel ready: ${channelName}`);
          resolve();
        }, 2000); // 2 seconds for WebSocket + ActionCable subscription
      } else {
        console.error(`❌ P2P not ready for ${channelName}`);
        reject(new Error('P2P not ready'));
      }
    });
  },
  
  // Listen for global stats announcements
  startListeningForGlobalStats: function() {
    // console.log('👂 Listening for global stats broadcasts');
    
    // Store original onBroadcast handler
    const originalHandler = window.net.onBroadcast;
    
    window.net.onBroadcast = (data) => {
      // Unwrap GetFire P2P's broadcast envelope
      let actualMessage = data;
      if (data.type === 'broadcast' && data.content) {
        actualMessage = data.content;
      }
      
      // console.log('📡 Received global broadcast:', actualMessage.type, actualMessage);
      
      // Handle global stats messages
      if (actualMessage.type === 'player_status') {
        this.playerStatuses[actualMessage.playerId] = {
          gameType: actualMessage.gameType,
          status: actualMessage.status, // 'browsing', 'in_lobby', 'in_game'
          lobbyId: actualMessage.lobbyId,
          timestamp: actualMessage.timestamp
        };
        
        // console.log(`👥 Player status updated: ${Object.keys(this.playerStatuses).length} players tracked`, this.playerStatuses);
        
        // Clean up stale statuses (not seen in 30 seconds)
        const now = Date.now();
        Object.keys(this.playerStatuses).forEach(pid => {
          if (now - this.playerStatuses[pid].timestamp > 30000) {
            delete this.playerStatuses[pid];
          }
        });
        
        // Update main menu if visible
        if (document.getElementById('main_menu').style.display !== 'none') {
          this.updateMainMenuStats();
        }
      }
      
      // Handle global stats requests
      if (actualMessage.type === 'global_stats_request') {
        // Respond with our current status
        this.announceStatusToGlobal(
          this.currentLobbyId ? 'in_lobby' : (this.currentGameType ? 'browsing' : 'menu')
        );
      }
      
      // Pass to original handler if it exists
      if (originalHandler) {
        originalHandler(data);
      }
    };
  },
  
  // Announce our status to global stats
  startAnnouncingGlobalStatus: function() {
    // Only announce on state changes, not periodically
    // Initial announcement when joining global channel
    this.announceStatusToGlobal('menu');
  },
  
  // Get field dimensions based on size preset
  getFieldDimensions: function(fieldSize) {
    const fieldSizes = {
      'tiny': { width: 32, height: 32 },
      'small': { width: 64, height: 64 },
      'medium': { width: 128, height: 128 },
      'large': { width: 256, height: 256 },
      'huge': { width: 512, height: 512 }
    };
    
    return fieldSizes[fieldSize] || fieldSizes['medium'];
  },
  
  // Generate a random seed
  generateRandomSeed: function() {
    return Math.floor(Math.random() * 1000000);
  },
  
  // Set up lobby buttons for different game types
  setupLobbyButtons: function() {
    // Adventure lobby (co-op)
    const adventureButton = document.querySelector('#adventure_lobby .lobby_b');
    if (adventureButton) {
      adventureButton.addEventListener('click', () => {
        this.startMultiplayerMatch('adventure');
      });
    }
    
    // 1v1 lobby
    const ovoButton = document.querySelector('#onevsone_lobby .lobby_b');
    if (ovoButton) {
      ovoButton.addEventListener('click', () => {
        this.startMultiplayerMatch('onevsone');
      });
    }
    
    // King of the Hill lobby
    const kothButton = document.querySelector('#koth_lobby .lobby_b');
    if (kothButton) {
      kothButton.addEventListener('click', () => {
        this.startMultiplayerMatch('koth');
      });
    }
    
    // Teams lobby
    const teamsButton = document.querySelector('#teams_lobby .lobby_b');
    if (teamsButton) {
      teamsButton.addEventListener('click', () => {
        this.startMultiplayerMatch('teams');
      });
    }
  },
  
  // Show lobby browser for a game type
  showLobbyBrowser: function(gameType) {
    const config = this.gameTypes[gameType];
    
    if (!config) {
      console.error(`Unknown game type: ${gameType}`);
      return;
    }
    
    // console.log(`🎮 Opening ${config.name} lobby browser...`);
    
    // Set currentGameType FIRST before announcing (announceStatusToGlobal uses it)
    this.currentGameType = gameType;
    window.gameType = gameType;
    
    // Track when we started searching for lobbies (for loading state)
    this.lobbySearchStartTime[gameType] = Date.now();
    
    // Show initial UI with "searching" state
    this.updateLobbyBrowserUI(gameType);
    
    // After 3 seconds, update UI again to show "no lobbies" if still none found
    setTimeout(() => {
      if ((this.availableLobbies[gameType] || []).length === 0) {
        this.updateLobbyBrowserUI(gameType);
      }
    }, 3100); // Slightly after the 3s search window
    
    // Announce status change to global stats (AFTER setting currentGameType)
    this.announceStatusToGlobal('browsing');
    
    // Network should already be initialized from global stats
    // Don't re-initialize, just join the game-specific broadcast channel
    if (window.net && window.net.initialized) {
      // console.log(`🌐 Using existing network connection for ${gameType} lobby browser`);
    } else {
      console.warn('⚠️ Network not initialized yet, initializing now...');
      const isLocalhost = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1';
      window.net = window.net || {};
      if (window.net.init) {
        window.net.init({ 
          gameType: gameType,
          devMode: isLocalhost,
          lobbyBrowserMode: true,
          broadcastChannel: `${gameType}-lobby-browser`
        });
      }
    }
    
    // Wait for broadcast channel to connect before starting discovery
    this.waitForBroadcastChannel(`${gameType}-lobby-browser`, 5000).then(() => {
      // console.log(`📡 Connected to broadcast: ${gameType}-lobby-browser`);
      
      // Start discovering lobbies
      this.startLobbyDiscovery(gameType);
      
      // Process any pending broadcasts
      this.flushPendingBroadcasts();
    }).catch(err => {
      console.error(`Failed to join ${gameType} lobby browser:`, err);
    });
    
    // Update UI to show lobby browser
    this.updateLobbyBrowserUI(gameType);
    
    // console.log(`✅ Opened ${config.name} lobby browser`);
  },
  
  // Create a new lobby
  createLobby: function(gameType, lobbyName, settings) {
    const config = this.gameTypes[gameType];
    const lobbyId = 'lobby-' + Math.random().toString(36).substring(7);
    
    this.currentLobbyId = lobbyId;
    this.isHost = true;
    this.playerReadyStates = {};
    
    const lobby = {
      id: lobbyId,
      name: lobbyName || `${config.name} Lobby`,
      gameType: gameType,
      host: window.net.getStatus().localPlayerId,
      players: 1,
      maxPlayers: settings.maxPlayers || config.maxPlayers,
      settings: settings || {
        fieldSize: config.defaultFieldSize,
        seed: Math.floor(Math.random() * 1000000)
      },
      timestamp: Date.now()
    };
    
    // Store lobby locally first
    this.currentLobby = lobby;
    
    // Wait a bit to ensure broadcast channel is connected
    setTimeout(() => {
      // Announce this lobby once (no periodic updates - only on events)
      this.announceLobby(lobby);
      // console.log(`📡 Broadcasting lobby: ${lobbyName}`);
    }, 200);
    
    // Join the actual P2P match lobby for this specific lobby
    const actualLobbyKey = `${config.lobbyKey}-${lobbyId}`;
    // console.log(`🔗 Host switching to match lobby: ${actualLobbyKey}`);
    if (window.net && window.net.switchLobby) {
      window.net.switchLobby(actualLobbyKey);
    } else {
      console.error('❌ net.switchLobby not available!');
    }
    
    // Log current P2P status
    setTimeout(() => {
      if (window.net && window.net.getStatus) {
        const status = window.net.getStatus();
        // console.log(`👥 P2P Status: ${status.peers?.length || 0} peers connected`, status.peers);
      }
    }, 1000);
    
    // Update UI to show lobby room (not browser)
    this.updateLobbyRoomUI(gameType, lobby);
    
    // Announce status change to global stats
    this.announceStatusToGlobal('in_lobby');
    
    // console.log(`🏛️ Created lobby: ${lobbyName} (${lobbyId})`);
  },
  
  // Join an existing lobby
  joinLobbyById: function(gameType, lobbyId) {
    const config = this.gameTypes[gameType];
    const lobby = this.availableLobbies[gameType]?.find(l => l.id === lobbyId);
    
    if (!lobby) {
      console.error(`Lobby ${lobbyId} not found`);
      return;
    }
    
    // Clear any existing connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Clear any existing status check interval
    if (this.connectionStatusInterval) {
      clearInterval(this.connectionStatusInterval);
      this.connectionStatusInterval = null;
    }
    
    // Disconnect from any existing P2P connections first
    if (window.net && window.net.p2p) {
      const peers = window.net.p2p.getConnectedPeers();
      if (peers.length > 0) {
        console.log(`🔌 Disconnecting from ${peers.length} existing peers before joining new lobby`);
        peers.forEach(peerId => {
          if (window.net.p2p.disconnectFromPeer) {
            window.net.p2p.disconnectFromPeer(peerId);
          }
        });
        
        // Force a small delay to ensure disconnection completes
        return new Promise(resolve => {
          setTimeout(() => {
            this._continueJoinLobby(gameType, lobbyId, lobby, config);
            resolve();
          }, 300);
        });
      }
    }
    
    this._continueJoinLobby(gameType, lobbyId, lobby, config);
  },
  
  // Internal: Continue joining lobby after cleanup
  _continueJoinLobby: function(gameType, lobbyId, lobby, config) {
    // Clear any existing lobby update interval
    if (this.lobbyUpdateInterval) {
      clearInterval(this.lobbyUpdateInterval);
      this.lobbyUpdateInterval = null;
    }
    
    this.currentLobbyId = lobbyId;
    this.currentLobby = lobby; // Store the lobby data
    this.isHost = false;
    this.connectedPlayers = []; // Reset connected players list
    this.playerReadyStates = {};
    this.playerConnectionStates = {};
    this.playerReadyStates[window.net.getStatus().localPlayerId] = false;
    
    // Join the actual P2P match lobby
    const actualLobbyKey = `${config.lobbyKey}-${lobbyId}`;
    const myId = window.net ? window.net.getStatus().localPlayerId : 'unknown';
    console.log(`🔗 [${myId}] Switching to match lobby: ${actualLobbyKey}`);
    if (window.net.switchLobby) {
      window.net.switchLobby(actualLobbyKey);
    } else {
      console.error('❌ net.switchLobby not available!');
      return;
    }
    
    // Update UI to show lobby room immediately
    this.updateLobbyRoomUI(gameType, this.currentLobby);
    
    // Announce status change to global stats
    this.announceStatusToGlobal('in_lobby');
    
    // Start monitoring connection status
    let connectionAttempts = 0;
    const maxAttempts = 5;
    const joinStartTime = Date.now();
    
    this.connectionStatusInterval = setInterval(() => {
      if (!this.currentLobbyId || this.currentLobbyId !== lobbyId) {
        // User left the lobby
        clearInterval(this.connectionStatusInterval);
        this.connectionStatusInterval = null;
        return;
      }
      
      const status = window.net.getStatus();
      const elapsed = Date.now() - joinStartTime;
      
      if (status.peers && status.peers.length > 0) {
        // Successfully connected!
        console.log(`✅ [${myId}] Connected to ${status.peers.length} peer(s)`);
        
        // Deduplicate peer IDs (sometimes P2P library returns duplicates)
        const uniquePeers = [...new Set(status.peers)];
        
        // Update connected players list - merge with existing player info
        const existingPlayerMap = new Map();
        this.connectedPlayers.forEach(p => {
          const id = p.id || p;
          existingPlayerMap.set(id, p);
        });
        
        this.connectedPlayers = uniquePeers.map(peerId => {
          // If we already have player info for this peer, use it
          return existingPlayerMap.get(peerId) || peerId;
        });
        
        // Update lobby UI with connected peers
        if (this.currentLobby) {
          this.updateLobbyRoomUI(gameType, this.currentLobby);
        }
        
        clearInterval(this.connectionStatusInterval);
        this.connectionStatusInterval = null;
        return;
      }
      
      connectionAttempts++;
      
      // Log status every 2 attempts
      if (connectionAttempts % 2 === 0) {
        console.log(`⏳ [${myId}] Waiting for peer connection... (attempt ${connectionAttempts}/${maxAttempts}, ${(elapsed/1000).toFixed(1)}s)`);
      }
      
      // Try manual connection request every 3 attempts
      if (connectionAttempts % 3 === 0 && window.net.p2p) {
        console.log(`🔄 [${myId}] Attempting manual connection...`);
        
        // Try to find the host in the lobby list and request direct P2P match
        const lobby = this.availableLobbies[gameType]?.find(l => l.id === lobbyId);
        const hostId = lobby?.hostId || lobby?.host; // Check both hostId and host properties
        
        if (lobby && hostId && window.net.p2p.requestMatch) {
          console.log(`📞 [${myId}] Requesting direct P2P match with host: ${hostId}`);
          window.net.p2p.requestMatch(hostId);
        } else {
          console.log(`⚠️ [${myId}] Cannot find lobby host for direct connection (lobby found: ${!!lobby}, hostId: ${hostId})`);
        }
      }
    }, 1000);
    
    // Set overall timeout (15 seconds)
    this.connectionTimeout = setTimeout(() => {
      clearInterval(this.connectionStatusInterval);
      this.connectionStatusInterval = null;
      
      const status = window.net.getStatus();
      if (!status.peers || status.peers.length === 0) {
        console.warn(`⚠️ [${myId}] Connection timeout after 15s - no peers connected`);
        console.log(`💡 Tip: Try backing out and rejoining, or recreate the lobby`);
        
        // Update UI to show timeout
        const lobbyElement = document.getElementById(`${gameType}_lobby`);
        if (lobbyElement) {
          const statusDiv = lobbyElement.querySelector('.lobby_connection_status');
          if (statusDiv) {
            statusDiv.innerHTML = `
              <div style="color: #ff6b6b; padding: 10px; background: rgba(255,107,107,0.1); border-radius: 4px; margin: 10px 0;">
                ⚠️ Connection timeout - no peer found. Try backing out and rejoining.
              </div>
            `;
          }
        }
      }
    }, 15000);
    
    console.log(`🚪 Joining lobby: ${lobby.name}`);
  },
  
  // Start discovering available lobbies
  startLobbyDiscovery: function(gameType) {
    // Initialize lobby list
    if (!this.availableLobbies[gameType]) {
      this.availableLobbies[gameType] = [];
    }
    
    // console.log(`🔍 Starting lobby discovery for ${gameType}`);
    
    // Listen for lobby announcements via broadcast
    // Store the original handler and chain them
    const originalHandler = window.net.onBroadcast;
    
    window.net.onBroadcast = (data) => {
      // Unwrap GetFire P2P's broadcast envelope
      let actualMessage = data;
      if (data.type === 'broadcast' && data.content) {
        actualMessage = data.content;
      }
      
      // console.log('📡 Received broadcast:', actualMessage.type, actualMessage);
      
      // Handle lobby announcements
      if (actualMessage.type === 'lobby_announcement' && actualMessage.gameType === gameType) {
        // console.log(`✅ Found lobby: ${actualMessage.lobby.name}`);
        this.updateAvailableLobbies(gameType, actualMessage.lobby);
        this.updateLobbyBrowserUI(gameType);
        
        // If this is the lobby we're currently in, update our local copy and UI
        if (actualMessage.lobby.id === this.currentLobbyId) {
          // console.log(`🔄 Received updated lobby settings from host:`, actualMessage.lobby.settings);
          this.currentLobby = actualMessage.lobby;
          this.updateLobbyRoomUI(gameType, actualMessage.lobby);
        }
      }
      
      // Handle lobby list requests - respond if we're hosting
      if (actualMessage.type === 'lobby_list_request' && actualMessage.gameType === gameType) {
        if (this.isHost && this.currentLobbyId && this.currentGameType === gameType) {
          // console.log('📡 Responding to lobby list request');
          const lobby = this.availableLobbies[gameType]?.find(l => l.id === this.currentLobbyId);
          if (lobby) {
            // Small delay to avoid flooding
            setTimeout(() => {
              this.announceLobby(lobby);
            }, Math.random() * 500);
          }
        }
      }
      
      // Handle lobby closed announcements
      if (actualMessage.type === 'lobby_closed' && actualMessage.gameType === gameType) {
        // console.log(`🚪 Lobby closed: ${actualMessage.lobbyId}`);
        if (this.availableLobbies[gameType]) {
          this.availableLobbies[gameType] = this.availableLobbies[gameType].filter(
            l => l.id !== actualMessage.lobbyId
          );
          this.updateLobbyBrowserUI(gameType);
        }
      }
      
      // Handle player status for global stats
      if (actualMessage.type === 'player_status') {
        this.playerStatuses[actualMessage.playerId] = {
          gameType: actualMessage.gameType,
          status: actualMessage.status,
          lobbyId: actualMessage.lobbyId,
          timestamp: actualMessage.timestamp
        };
        
        // Clean up stale statuses
        const now = Date.now();
        Object.keys(this.playerStatuses).forEach(pid => {
          if (now - this.playerStatuses[pid].timestamp > 30000) {
            delete this.playerStatuses[pid];
          }
        });
        
        // Update main menu if visible
        if (document.getElementById('main_menu').style.display !== 'none') {
          this.updateMainMenuStats();
        }
      }
      
      // Call original handler if it exists
      if (originalHandler) {
        originalHandler(data);
      }
    };
    
    // Request lobby list
    if (window.net && window.net.broadcast) {
      window.net.broadcast({
        type: 'lobby_list_request',
        gameType: gameType
      }, `${gameType}-lobby-browser`);
    }
    
    // Update UI periodically
    this.lobbyDiscoveryInterval = setInterval(() => {
      this.cleanupStaleLobbies(gameType);
      this.updateLobbyBrowserUI(gameType);
    }, 5000);
  },
  
  // Announce lobby to broadcast channel
  announceLobby: function(lobby) {
    const channelName = `${lobby.gameType}-lobby-browser`;
    
    // Update player count
    lobby.players = 1 + this.connectedPlayers.length;
    lobby.timestamp = Date.now();
    
    const announcement = {
      type: 'lobby_announcement',
      gameType: lobby.gameType,
      lobby: lobby
    };
    
    // Only broadcast if we've marked channel as ready
    if (this.connectedChannels[channelName] === true) {
      if (window.net && window.net.broadcast) {
        // console.log(`📡 Broadcasting lobby: ${lobby.name} on ${channelName}`);
        window.net.broadcast(announcement, channelName);
      }
    } else {
      // Queue for later broadcast
      this.pendingBroadcasts.push({ data: announcement, channel: channelName });
      // console.log(`📡 Queued lobby announcement (channel ${this.connectedChannels[channelName] || 'not ready'})`);
    }
  },
  
  // Flush pending broadcasts once channel is connected
  flushPendingBroadcasts: function() {
    if (this.pendingBroadcasts.length > 0) {
      // console.log(`📡 Flushing ${this.pendingBroadcasts.length} pending broadcasts`);
      
      this.pendingBroadcasts.forEach(pending => {
        if (this.connectedChannels[pending.channel] && window.net && window.net.broadcast) {
          window.net.broadcast(pending.data, pending.channel);
        }
      });
      
      this.pendingBroadcasts = [];
    }
  },
  
  // Update available lobbies list
  updateAvailableLobbies: function(gameType, lobby) {
    if (!this.availableLobbies[gameType]) {
      this.availableLobbies[gameType] = [];
    }
    
    const existingIndex = this.availableLobbies[gameType].findIndex(l => l.id === lobby.id);
    
    if (existingIndex >= 0) {
      this.availableLobbies[gameType][existingIndex] = lobby;
    } else {
      this.availableLobbies[gameType].push(lobby);
    }
  },
  
  // Remove stale lobbies (not announced in 15 seconds)
  cleanupStaleLobbies: function(gameType) {
    if (!this.availableLobbies[gameType]) return;
    
    const now = Date.now();
    this.availableLobbies[gameType] = this.availableLobbies[gameType].filter(lobby => {
      // Don't clean up our own lobby if we're the host
      if (this.isHost && lobby.id === this.currentLobbyId) {
        return true;
      }
      // Keep lobbies that have announced in the last 60 seconds
      return (now - lobby.timestamp) < 60000;
    });
  },
  
  // Leave current lobby
  leaveLobby: function() {
    // console.log('🚪 Leaving lobby...');
    
    // Stop lobby updates
    if (this.lobbyUpdateInterval) {
      clearInterval(this.lobbyUpdateInterval);
      this.lobbyUpdateInterval = null;
    }
    
    // Stop lobby discovery updates
    if (this.lobbyDiscoveryInterval) {
      clearInterval(this.lobbyDiscoveryInterval);
      this.lobbyDiscoveryInterval = null;
    }
    
    // Clear connection monitoring
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.connectionStatusInterval) {
      clearInterval(this.connectionStatusInterval);
      this.connectionStatusInterval = null;
    }
    
    // Notify others if we were in a lobby
    if (this.currentLobbyId && this.isHost && window.net && window.net.p2p) {
      // Host leaving - notify others that lobby is closing
      window.net.p2p.sendData({
        type: 'lobby_closed',
        lobbyId: this.currentLobbyId
      });
    }
    
    // Clear state (currentGameType is intentionally set to null for menu)
    const previousLobbyId = this.currentLobbyId;
    const previousGameType = this.currentGameType;
    
    this.currentLobbyId = null;
    this.currentLobby = null;
    this.currentGameType = null; // Clear gameType when returning to main menu
    this.connectedPlayers = [];
    this.isHost = false;
    this.playerReadyStates = {};
    this.playerConnectionStates = {};
    
    // Announce we're back in menu (currentGameType will be null, which is correct for 'menu' status)
    this.announceStatusToGlobal('menu');
    
    // Disconnect P2P connections (but keep broadcast channel for lobby browser)
    if (window.net && window.net.p2p) {
      const peers = window.net.p2p.getConnectedPeers();
      peers.forEach(peerId => {
        if (window.net.p2p.disconnectFromPeer) {
          window.net.p2p.disconnectFromPeer(peerId);
        }
      });
    }
  },
  
  // Start periodic lobby updates
  startLobbyUpdates: function(gameType) {
    // Clear any existing interval
    if (this.lobbyUpdateInterval) {
      clearInterval(this.lobbyUpdateInterval);
    }
    
    // Update lobby state every 2 seconds
    this.lobbyUpdateInterval = setInterval(() => {
      this.updateLobbyState(gameType);
    }, 2000);
    
    // Do an immediate update
    this.updateLobbyState(gameType);
  },
  
  // Update lobby state from network
  updateLobbyState: function(gameType) {
    if (!window.net || !window.net.getStatus) {
      return;
    }
    
    const netStatus = window.net.getStatus();
    this.connectedPlayers = netStatus.peers || [];
    this.isHost = netStatus.isHost || false;
    
    // Update the lobby UI with current player list
    this.updateLobbyUI(gameType);
    
    // Update main menu stats
    this.updateMainMenuStats();
  },
  
  // Update lobby browser UI (shows list of lobbies)
  updateLobbyBrowserUI: function(gameType) {
    const lobbyId = `${gameType}_lobby`;
    const lobbyElement = document.getElementById(lobbyId);
    
    if (!lobbyElement) return;
    
    const config = this.gameTypes[gameType];
    const lobbies = this.availableLobbies[gameType] || [];
    
    // Find or create browser container
    let browserContainer = lobbyElement.querySelector('.lobby_browser');
    if (!browserContainer) {
      browserContainer = document.createElement('div');
      browserContainer.className = 'lobby_browser';
      
      const startButton = lobbyElement.querySelector('.lobby_b');
      if (startButton) {
        startButton.style.display = 'none'; // Hide old start button
      }
      
      lobbyElement.appendChild(browserContainer);
    }
    
    let html = `
      <div class="lobby_browser_header">
        <h3>${config.name} Lobbies</h3>
        <button class="create_lobby_btn" onclick="window.Lobby.showCreateLobbyDialog('${gameType}')">+ Create Lobby</button>
      </div>
      <div class="lobby_list">`;
    
    if (lobbies.length === 0) {
      // Check if we're still in the initial search phase (first 3 seconds)
      const searchStartTime = this.lobbySearchStartTime[gameType];
      const isSearching = searchStartTime && (Date.now() - searchStartTime < 3000);
      
      if (isSearching) {
        html += `<div class="no_lobbies">🔍 Searching for lobbies...</div>`;
      } else {
        html += `<div class="no_lobbies">No lobbies available. Create one!</div>`;
      }
    } else {
      lobbies.forEach(lobby => {
        const isFull = lobby.players >= lobby.maxPlayers;
        html += `
          <div class="lobby_item ${isFull ? 'lobby_full' : ''}">
            <div class="lobby_item_name">${lobby.name}</div>
            <div class="lobby_item_info">
              <span>👥 ${lobby.players}/${lobby.maxPlayers}</span>
              <span>🗺️ ${lobby.settings.fieldSize}</span>
              <span>🎲 #${lobby.settings.seed}</span>
            </div>
            ${!isFull ? `<button class="join_lobby_btn" onclick="window.Lobby.joinLobbyById('${gameType}', '${lobby.id}')">Join</button>` : '<span class="lobby_full_tag">Full</span>'}
          </div>`;
      });
    }
    
    html += `</div>`;
    
    browserContainer.innerHTML = html;
  },
  
  // Update lobby room UI (inside a specific lobby)
  updateLobbyRoomUI: function(gameType, lobby) {
    const lobbyId = `${gameType}_lobby`;
    const lobbyElement = document.getElementById(lobbyId);
    
    if (!lobbyElement) return;
    
    const config = this.gameTypes[gameType];
    const netStatus = window.net ? window.net.getStatus() : {};
    const totalPlayers = 1 + this.connectedPlayers.length;
    
    // Find or create room container
    let roomContainer = lobbyElement.querySelector('.lobby_room');
    if (!roomContainer) {
      roomContainer = document.createElement('div');
      roomContainer.className = 'lobby_room';
      lobbyElement.appendChild(roomContainer);
    }
    
    // Hide browser if it exists
    const browserContainer = lobbyElement.querySelector('.lobby_browser');
    if (browserContainer) browserContainer.style.display = 'none';
    
    let html = `
      <div class="lobby_room_header">
        <h3>${lobby.name}</h3>
        <button class="leave_lobby_btn" onclick="window.Lobby.leaveLobbyAndReturnToBrowser('${gameType}')">← Back</button>
      </div>
      
      <div class="lobby_connection_status"></div>
      
      <div class="lobby_room_settings">
        <div class="lobby_setting">
          <label>Field Size:</label>
          ${this.isHost ? 
            `<select id="fieldSizeSelect" onchange="window.Lobby.updateLobbySetting('fieldSize', this.value)">
              <option value="tiny" ${lobby.settings.fieldSize === 'tiny' ? 'selected' : ''}>Tiny</option>
              <option value="small" ${lobby.settings.fieldSize === 'small' ? 'selected' : ''}>Small</option>
              <option value="medium" ${lobby.settings.fieldSize === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="large" ${lobby.settings.fieldSize === 'large' ? 'selected' : ''}>Large</option>
              <option value="huge" ${lobby.settings.fieldSize === 'huge' ? 'selected' : ''}>Huge</option>
            </select>` :
            `<span>${lobby.settings.fieldSize}</span>`
          }
        </div>
        <div class="lobby_setting">
          <label>Seed:</label>
          ${this.isHost ?
            `<input type="number" id="seedInput" value="${lobby.settings.seed}" onchange="window.Lobby.updateLobbySetting('seed', this.value)" style="width: 100px;">` :
            `<span>#${lobby.settings.seed}</span>`
          }
        </div>
      </div>
      
      <div class="lobby_players_title">Players (${totalPlayers}/${lobby.maxPlayers})</div>
      <div class="lobby_players">`;
    
    // Show local player
    const myName = window.currentPlayerName || window.player?.name || 'You';
    const myColor = window.currentPlayerColor || window.player?.color || '#ffffff';
    const myId = window.net ? window.net.getStatus().localPlayerId : null;
    const myReadyState = myId ? this.playerReadyStates[myId] : false;
    
    // Check if we're connected to host (for non-hosts)
    const isConnectedToHost = !this.isHost && this.connectedPlayers.length > 0 && 
                               this.connectedPlayers.some(p => this.playerConnectionStates[p.id || p] === 'connected');
    
    html += `
      <div class="lobby_player lobby_player_local">
        <span class="player_icon" style="color: ${myColor};">👤</span>
        <span class="player_name" style="color: ${myColor};">${myName}${this.isHost ? ' (Host)' : ''}</span>
        ${!this.isHost 
          ? `<label class="ready_checkbox" ${!isConnectedToHost ? 'title="Connecting to host..."' : ''}>
               <input type="checkbox" 
                      ${myReadyState ? 'checked' : ''} 
                      ${!isConnectedToHost ? 'disabled' : ''} 
                      onchange="window.Lobby.toggleReady(this.checked)"> 
               ${isConnectedToHost ? 'Ready' : 'Connecting...'}
             </label>` 
          : '<span class="host_badge">HOST</span>'}
      </div>`;
    
    // Show connected players
    this.connectedPlayers.forEach((player, index) => {
      const playerId = player.id || player; // Support both {id, name} objects and plain peer IDs
      const playerName = player.name || `Player ${playerId.slice(-4)}`;
      const playerColor = player.color || '#ffffff';
      const isReady = this.playerReadyStates[playerId];
      const connectionState = this.playerConnectionStates[playerId] || 'connecting';
      const connectionIcon = connectionState === 'connected' ? '🟢' : (connectionState === 'connecting' ? '🟡' : '🔴');
      html += `
        <div class="lobby_player">
          <span class="player_icon" style="color: ${playerColor};">${connectionIcon} 👤</span>
          <span class="player_name" style="color: ${playerColor};">${playerName}</span>
          <span class="ready_status ${isReady ? 'ready' : 'not-ready'}">${isReady ? '✓ Ready' : (connectionState === 'connected' ? 'Not Ready' : 'Connecting...')}</span>
        </div>`;
    });
    
    // Show empty slots
    for (let i = totalPlayers; i < lobby.maxPlayers; i++) {
      html += `
        <div class="lobby_player lobby_player_empty">
          <span class="player_icon">⚫</span>
          <span class="player_name">Waiting...</span>
        </div>`;
    }
    
    html += '</div>';
    
    // Add start/ready buttons
    if (this.isHost) {
      const allConnected = this.connectedPlayers.every(player => {
        const playerId = player.id || player;
        return this.playerConnectionStates[playerId] === 'connected';
      });
      const allReady = this.connectedPlayers.every(player => {
        const playerId = player.id || player;
        return this.playerReadyStates[playerId];
      });
      const minPlayers = gameType === 'adventure' ? 1 : 2;
      const canStart = totalPlayers >= minPlayers && allConnected && allReady;
      
      let startBtnText = 'Start Match';
      if (gameType === 'adventure' && totalPlayers < 2) {
        startBtnText = 'Launch Adventure Skirmish';
      } else if (!allConnected) {
        startBtnText = 'Waiting for Connections...';
      } else if (!allReady) {
        const readyCount = this.connectedPlayers.filter(p => this.playerReadyStates[p.id || p]).length;
        startBtnText = `Waiting for Players... (${readyCount}/${this.connectedPlayers.length} ready)`;
      } else if (canStart) {
        startBtnText = '🚀 START MATCH!';
      }
      
      html += `<button class="lobby_start_btn ${canStart ? 'ready' : 'disabled'}" onclick="window.Lobby.startMatchFromLobby('${gameType}')" ${!canStart ? 'disabled' : ''}>${startBtnText}</button>`;
      
      // Debug log for host
      if (canStart) {
        // console.log(`✅ All players ready! Host can start match.`);
      }
    }
    
    roomContainer.innerHTML = html;
  },
  
  // Show create lobby dialog
  showCreateLobbyDialog: function(gameType) {
    const config = this.gameTypes[gameType];
    const lobbyName = prompt('Enter lobby name:', `${config.name} Game`);
    
    if (lobbyName) {
      const settings = {
        fieldSize: config.defaultFieldSize,
        seed: Math.floor(Math.random() * 1000000),
        maxPlayers: config.maxPlayers
      };
      
      this.createLobby(gameType, lobbyName, settings);
    }
  },
  
  // Leave lobby and return to browser
  leaveLobbyAndReturnToBrowser: function(gameType) {
    // console.log(`🚪 Leaving lobby and returning to ${gameType} browser`);
    
    const wasHost = this.isHost;
    const lobbyId = this.currentLobbyId;
    
    // If we're the host, broadcast that the lobby is closed
    if (wasHost && lobbyId) {
      const config = this.gameTypes[gameType];
      
      // Broadcast to lobby browser channel (so it's removed from list)
      const browserChannelName = `${gameType}-lobby-browser`;
      if (window.net && window.net.broadcast) {
        window.net.broadcast({
          type: 'lobby_closed',
          gameType: gameType,
          lobbyId: lobbyId
        }, browserChannelName);
        console.log('📡 Broadcasting lobby closed to browser channel');
      }
      
      // CRITICAL: Also broadcast to the specific lobby channel (for joiners waiting to connect)
      const lobbyChannelName = `${config.lobbyKey}-${lobbyId}`;
      if (window.net && window.net.broadcast) {
        window.net.broadcast({
          type: 'lobby_closed',
          gameType: gameType,
          lobbyId: lobbyId
        }, lobbyChannelName);
        console.log('📡 Broadcasting lobby closed to lobby channel');
      }
    }
    
    // Disconnect P2P peers to allow clean rejoin
    if (window.net && window.net.p2p) {
      const peers = window.net.p2p.getConnectedPeers();
      peers.forEach(peerId => {
        if (window.net.p2p.disconnectFromPeer) {
          window.net.p2p.disconnectFromPeer(peerId);
        }
      });
    }
    
    // Stop lobby updates
    if (this.lobbyUpdateInterval) {
      clearInterval(this.lobbyUpdateInterval);
      this.lobbyUpdateInterval = null;
    }
    
    // Clear connection monitoring
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.connectionStatusInterval) {
      clearInterval(this.connectionStatusInterval);
      this.connectionStatusInterval = null;
    }
    
    // Clear lobby-specific state but KEEP currentGameType for the browser
    this.currentLobbyId = null;
    this.currentLobby = null;
    this.isHost = false;
    this.playerReadyStates = {};
    this.playerConnectionStates = {};
    this.connectedPlayers = [];
    
    // Ensure currentGameType is set for the browser
    this.currentGameType = gameType;
    
    // Return to browser view
    const lobbyElement = document.getElementById(`${gameType}_lobby`);
    if (lobbyElement) {
      // Remove the room container entirely to prevent conflicts
      const roomContainer = lobbyElement.querySelector('.lobby_room');
      if (roomContainer) {
        roomContainer.remove();
      }
      
      // Check if browser container exists
      let browserContainer = lobbyElement.querySelector('.lobby_browser');
      if (!browserContainer) {
        // console.log('📦 Browser container missing, recreating via showLobbyBrowser');
        // Browser container doesn't exist - recreate it by calling showLobbyBrowser
        this.showLobbyBrowser(gameType);
        return; // showLobbyBrowser handles everything else
      }
      
      // Make sure browser is visible
      browserContainer.style.display = 'block';
    }
    
    // Announce status change to global stats
    this.announceStatusToGlobal('browsing');
    
    // Update the browser UI (refresh lobby list)
    this.updateLobbyBrowserUI(gameType);
    
    // console.log('✅ Returned to lobby browser');
  },
  
  // Announce status change to global stats channel
  announceStatusToGlobal: function(status) {
    const announcement = {
      type: 'player_status',
      playerId: window.net ? window.net.getStatus().localPlayerId : 'unknown',
      gameType: this.currentGameType,
      status: status, // 'menu', 'browsing', 'in_lobby', 'in_game'
      lobbyId: this.currentLobbyId,
      timestamp: Date.now()
    };
    
    // Only broadcast if we've marked channel as ready
    if (this.connectedChannels['aether-global-stats'] === true) {
      if (window.net && window.net.broadcast) {
        // console.log(`📡 Broadcasting player status: ${status} for ${this.currentGameType || 'menu'}, lobbyId: ${this.currentLobbyId}`);
        window.net.broadcast(announcement, 'aether-global-stats');
      }
    } else {
      // Queue for later broadcast
      this.pendingBroadcasts.push({ data: announcement, channel: 'aether-global-stats' });
      // console.log(`📡 Queued global status: ${status} (channel ${this.connectedChannels['aether-global-stats'] || 'not ready'})`);
    }
  },
  
  // Toggle ready state
  toggleReady: function(isReady) {
    const myId = window.net.getStatus().localPlayerId;
    
    // Prevent duplicate calls
    if (this.playerReadyStates[myId] === isReady) {
      // console.log(`⏭️ [${myId}] Already ${isReady ? 'ready' : 'not ready'}, skipping`);
      return;
    }
    
    this.playerReadyStates[myId] = isReady;
    // console.log(`${isReady ? '✅' : '⏸️'} [${myId}] Ready state: ${isReady}`);
    
    // Send ready state to host/peers via WebRTC FIRST (before UI update)
    if (window.net && window.net.p2p && window.net.p2p.sendData) {
      window.net.p2p.sendData({
        type: 'player_ready_state',
        playerId: myId,
        isReady: isReady
      });
      // console.log(`📡 Sent ready state to ${window.net.p2p.getConnectedPeers().length} peers`);
    } else {
      console.error('❌ Cannot send ready state - P2P not available');
    }
    
    // Update local UI after sending message
    if (this.currentGameType && this.currentLobbyId) {
      const lobby = this.availableLobbies[this.currentGameType]?.find(l => l.id === this.currentLobbyId);
      if (lobby) {
        this.updateLobbyRoomUI(this.currentGameType, lobby);
      }
    }
  },
  
  // Update lobby setting (host only)
  updateLobbySetting: function(setting, value) {
    if (!this.isHost) {
      console.warn('⚠️ Only host can update settings');
      return;
    }
    
    if (!this.currentLobby) {
      console.error('❌ No current lobby to update!');
      return;
    }
    
    // Update the current lobby's settings
    this.currentLobby.settings[setting] = setting === 'seed' ? parseInt(value) : value;
    this.currentLobby.timestamp = Date.now(); // Update timestamp to trigger UI refresh
    
    // console.log(`🔧 Host updated ${setting} to:`, this.currentLobby.settings[setting]);
    
    // Broadcast the FULL updated lobby to all players
    this.announceLobby(this.currentLobby);
    
    // Also update local UI
    this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
  },
  
  // Start match from lobby (host only)
  startMatchFromLobby: function(gameType) {
    if (!this.isHost) {
      console.warn('⚠️ Only host can start the match!');
      return;
    }
    
    const lobby = this.availableLobbies[gameType]?.find(l => l.id === this.currentLobbyId);
    if (!lobby) {
      console.error('❌ Lobby not found!');
      return;
    }
    
    // console.log('🚀 Host initiating match start...');
    
    // Send start game message to all peers via WebRTC
    if (window.net && window.net.p2p && window.net.p2p.sendData) {
      const startMessage = {
        type: 'start_game',
        gameType: gameType,
        settings: lobby.settings,
        timestamp: Date.now()
      };
      
      window.net.p2p.sendData(startMessage); // Broadcast to all peers
      // console.log(`📡 Sent start_game to ${window.net.p2p.getConnectedPeers().length} peers`);
    }
    
    // Start the match for host
    this.startMultiplayerMatchWithSettings(gameType, lobby.settings);
  },
  
  // Start multiplayer match with specific settings
  startMultiplayerMatchWithSettings: function(gameType, settings) {
    const config = this.gameTypes[gameType];
    const fieldSize = settings.fieldSize || config.defaultFieldSize;
    
    // console.log(`🎮 Starting ${config.name} match with settings:`, settings);
    // console.log(`🌱 Map seed: ${settings.seed}`);
    // console.log(`🗺️ Field size: ${fieldSize}`);
    
    // Set seed before initializing game for deterministic map generation
    if (settings.seed) {
      if (window.liveField) {
        window.liveField.seed = settings.seed;
        // console.log(`✅ Applied seed to existing field`);
      } else {
        // Store seed for when field is created
        window.pendingMapSeed = settings.seed;
        // console.log(`📦 Stored seed for field initialization`);
      }
    }
    
    // Now start the match (will use the seed we just set)
    this.startMultiplayerMatch(gameType, settings);
  },
  
  // Old updateLobbyUI function for backward compatibility
  updateLobbyUI: function(gameType) {
    const lobbyId = `${gameType}_lobby`;
    const lobbyElement = document.getElementById(lobbyId);
    
    if (!lobbyElement) {
      return;
    }
    
    const config = this.gameTypes[gameType];
    
    // Find or create player list container
    let playerListContainer = lobbyElement.querySelector('.lobby_player_list');
    if (!playerListContainer) {
      playerListContainer = document.createElement('div');
      playerListContainer.className = 'lobby_player_list';
      
      // Insert before the game start button
      const startButton = lobbyElement.querySelector('.lobby_b');
      if (startButton) {
        lobbyElement.insertBefore(playerListContainer, startButton);
      } else {
        lobbyElement.appendChild(playerListContainer);
      }
    }
    
    let html = '';
    
    // Fixed: Add defensive check for window.net before calling getStatus
    const netStatus = (window.net && typeof window.net.getStatus === 'function') ? window.net.getStatus() : { localPlayerId: null, peers: [] };
    const totalPlayers = 1 + this.connectedPlayers.length;
    
    // Add game-type specific description
    const descriptions = {
      'adventure': '🌍 Co-op adventure - explore and build together!',
      'onevsone': '⚔️ 1v1 competitive match',
      'koth': '👑 Control the hill to win',
      'teams': '🤝 Team-based strategy'
    };
    
    // How to join instructions
    html += `<div class="lobby_info" style="font-size: 0.8em; margin-bottom: 10px; opacity: 0.9;">
      <p style="margin: 4px 0;"><strong>${descriptions[gameType] || config.name}</strong></p>
      <strong>How to join:</strong><br>
      📍 Lobby: <code style="background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 2px;">${config.lobbyKey}</code><br>
      💡 Others join by clicking "${config.name}" in their menu<br>
      🎮 Host clicks "Game Start" when ready
    </div>`;
    
    // Build player list HTML
    html += `<div class="lobby_status">
      <strong>Players: ${totalPlayers}/${config.maxPlayers}</strong>
      ${this.isHost ? ' <span class="host_badge">(Host)</span>' : ''}
    </div>
    <div class="lobby_players">`;
    
    // Show local player
    html += `<div class="lobby_player lobby_player_local">
      <span class="player_icon">👤</span>
      <span class="player_name">You ${this.isHost ? '(Host)' : ''}</span>
      <span class="player_status">Ready</span>
    </div>`;
    
    // Show connected players
    this.connectedPlayers.forEach((peerId, index) => {
      html += `<div class="lobby_player">
        <span class="player_icon">👤</span>
        <span class="player_name">Player ${index + 2}</span>
        <span class="player_status">Connected</span>
      </div>`;
    });
    
    // Show empty slots
    for (let i = totalPlayers; i < config.maxPlayers; i++) {
      html += `<div class="lobby_player lobby_player_empty">
        <span class="player_icon">⚫</span>
        <span class="player_name">Waiting...</span>
        <span class="player_status">-</span>
      </div>`;
    }
    
    html += '</div>';
    
    // Add connection status
    const isConnected = (window.net && typeof window.net.getStatus === 'function' && window.net.getStatus().isConnected) || false;
    html += `<div class="lobby_connection_status ${isConnected ? 'connected' : 'disconnected'}">
      ${isConnected ? '🟢 Connected to lobby' : '🔴 Connecting...'}
    </div>`;
    
    playerListContainer.innerHTML = html;
  },
  
  // Update main menu statistics (lobby counts, active games, player counts)
  updateMainMenuStats: function() {
    // Calculate stats from global player statuses
    const stats = {
      'adventure': { lobbies: new Set(), players: 0 },
      'onevsone': { lobbies: new Set(), players: 0 },
      'koth': { lobbies: new Set(), players: 0 },
      'teams': { lobbies: new Set(), players: 0 }
    };
    
    // Debug: Log player statuses (disabled for performance)
    // const statusCount = Object.keys(this.playerStatuses).length;
    // if (statusCount > 0) {
    //   console.log(`📊 Main menu stats - ${statusCount} players:`, this.playerStatuses);
    // }
    
    // Tally up from player status announcements
    Object.values(this.playerStatuses).forEach(status => {
      if (status.gameType && stats[status.gameType]) {
        stats[status.gameType].players++;
        
        if (status.status === 'in_lobby' && status.lobbyId) {
          stats[status.gameType].lobbies.add(status.lobbyId);
        }
      }
    });
    
    // Update the table
    const gameTypeOrder = ['adventure', 'onevsone', 'koth', 'teams'];
    
    gameTypeOrder.forEach((gameType, index) => {
      const row = document.querySelector(`#game_menu tr:nth-child(${index + 2})`); // +2 for header row
      
      if (row) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
          const lobbyCount = stats[gameType].lobbies.size;
          const playerCount = stats[gameType].players;
          
          cells[1].textContent = lobbyCount || '-';
          cells[2].textContent = '-'; // Games in progress (hard to track)
          cells[3].textContent = playerCount || '-';
        }
      }
    });
  },
  
  // Wait for the networking layer to provide a stable local player ID
  waitForLocalPlayerId: async function(timeoutMs = 5000, pollIntervalMs = 100) {
    const startTime = Date.now();
    
    while (true) {
      const id = (window.net && typeof window.net.getStatus === 'function')
        ? window.net.getStatus().localPlayerId
        : null;
      
      if (id) {
        return id;
      }
      
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error('Timed out waiting for local player ID');
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  },

  // Start a local Adventure match with an AI opponent for debugging/single-player
  startAdventureSkirmish: function(fieldSize = 'medium', mapSeed = null, options = {}) {
    console.log('🧭 Starting Adventure skirmish versus AI (local)...');
    
    const config = this.gameTypes['adventure'];
    const resolvedFieldSize = fieldSize || (config ? config.defaultFieldSize : 'medium');
    const resolvedSeed = Number.isFinite(Number(mapSeed))
      ? Math.floor(Number(mapSeed))
      : Math.floor(Math.random() * 1000000);
    
    // Reset scene and ensure clean slate
    this.resetGameState();
    
    window.isMultiplayer = false;
    window.gameType = 'adventure';
    window.mapSeed = resolvedSeed;
    
    // Ensure player instance exists
    if (!window.player) {
      window.player = new Player();
      console.log('🆕 Created new player for adventure');
    } else {
      console.log(`♻️ Reusing existing player (id: ${window.player.id || 'not set'})`);
    }
    
    // Ensure player has correct ID
    if (!window.player.id || window.player.id === 'undefined') {
      window.player.id = 'player';
      console.log('✅ Set player.id to "player"');
    }
    
    // Reset player state for new match
    window.player.units = [];
    window.player.buildings = [];
    window.player.selectedUnits = [];
    
    console.log(`🎮 Player ready: id="${window.player.id}", agora will be set to corner spawn`);
    
    // Resolve field dimensions early so we can place spawns deliberately
    const dims = (typeof resolvedFieldSize === 'string')
      ? (this.getFieldDimensions(resolvedFieldSize) || { width: 128, height: 128 })
      : { width: resolvedFieldSize, height: resolvedFieldSize };
    
    const aiCount = Math.max(1, Math.min(options.aiCount ?? 3, 3));
    const totalPlayers = 1 + aiCount;
    const cornerMargin = Math.max(8, Math.floor(Math.min(dims.width, dims.height) * 0.1));
    const cornerSpawns = [
      { x: cornerMargin, y: cornerMargin },
      { x: dims.width - cornerMargin - 1, y: cornerMargin },
      { x: cornerMargin, y: dims.height - cornerMargin - 1 },
      { x: dims.width - cornerMargin - 1, y: dims.height - cornerMargin - 1 }
    ];
    
    const spawnPositions = totalPlayers <= cornerSpawns.length
      ? cornerSpawns.slice(0, totalPlayers)
      : this.getSpawnPositions(totalPlayers, resolvedFieldSize);
    
    const tileSize = (typeof TILE_SIZE === 'number') ? TILE_SIZE : (window.TILE_SIZE || 4);
    
    // Configure local player identity and spawn
    const localPlayerId = window.player.id || 'player';
    window.player.id = localPlayerId;
    window.player.name = window.currentPlayerName || 'Adventurer';
    window.player.color = window.currentPlayerColor || '#ff0000';
    window.player.agora = spawnPositions[0];
    window.player.basePosition = { x: spawnPositions[0].x, z: spawnPositions[0].y };
    
    if (window.player.pbody) {
      const agoraX = window.player.agora.x * tileSize;
      const agoraZ = window.player.agora.y * tileSize;
      window.player.pbody.state.loc.set(agoraX, 0, agoraZ);
      window.player.pbody.vel.set(0, 0, 0);
      window.player.pbody.imp.set(0, 0, 0);
    }
    
    // Create AI opponents
    const aiPlayers = [];
    for (let i = 0; i < aiCount; i++) {
      const spawn = spawnPositions[i + 1] || spawnPositions[spawnPositions.length - 1];
      const aiId = options.aiIds?.[i] || `ai-${i + 1}-${resolvedSeed.toString(16)}`;
      const aiName = options.aiNames?.[i] || `AI ${i + 1}`;
      const aiColor = (options.aiColors && options.aiColors[i]) || (this.getPlayerColor ? this.getPlayerColor(i + 1) : '#0066cc');
      const aiResources = (options.aiResources && options.aiResources[i]) || { food: 120, wood: 80, stone: 40, magic: 20 };
      const difficulty = Array.isArray(options.difficulty)
        ? (options.difficulty[i] || 'normal')
        : (options.difficulty || 'normal');
      
      const aiOptions = {
        id: aiId,
        name: aiName,
        color: aiColor,
        startingResources: aiResources,
        agora: spawn,
        basePosition: { x: spawn.x, z: spawn.y },
        difficulty: difficulty,
        isAI: true
      };
      
      const aiPlayer = window.AIPlayer ? new window.AIPlayer(aiOptions) : new window.OpponentPlayer(aiOptions);
      aiPlayer.isAI = true;
      aiPlayer.agora = spawn;
      aiPlayer.basePosition = { x: spawn.x, z: spawn.y };
      aiPlayers.push(aiPlayer);
    }
    
    window.aiOpponents = aiPlayers;
    window.opponent = aiPlayers[0] || null;
    
    // Regenerate field with desired seed
    console.log(`🗺️ Regenerating field with seed ${resolvedSeed} for Adventure skirmish...`);
    const oldField = window.liveField;
    
    // Dispose old field before creating new one
    if (oldField && typeof oldField.dispose === 'function') {
      oldField.dispose();
    }
    
    // Create the new field
    window.liveField = new window.Field({
      width: dims.width,
      height: dims.height,
      seed: resolvedSeed
    });
    if (typeof liveField !== 'undefined') {
      liveField = window.liveField;
    }
    
    // CRITICAL: Apply current LOD settings to new field immediately!
    // Without this, new field defaults to max distance instead of menu calibration
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      const currentMultiplier = window.hud.getCurrentLODMultiplier();
      const savedLOD = localStorage.getItem('lodLevel');
      const lodLevel = savedLOD ? parseInt(savedLOD) : 50;
      
      // Set originalLoadDistance first (what we scale from)
      window.liveField.originalLoadDistance = 4;
      // Then set currentLoadDistance based on LOD
      const newLoadDistance = Math.round(4 * currentMultiplier);
      window.liveField.currentLoadDistance = Math.max(2, Math.min(8, newLoadDistance));
      
      console.log(`🗺️ New field initialized with LOD ${lodLevel}% → chunk distance: ${window.liveField.currentLoadDistance}`);
    }
    
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    window._cameraLimitsSet = false;
    
    // Position camera at local spawn FIRST
    if (window.gfx && window.gfx.camera && window.gfx.cameraTarget) {
      const agoraX = window.player.agora.x * tileSize;
      const agoraZ = window.player.agora.y * tileSize;
      window.gfx.cameraTarget.position.x = agoraX;
      window.gfx.cameraTarget.position.y = 9;
      window.gfx.cameraTarget.position.z = agoraZ;
      
      if (window.cameraAnchor) {
        window.cameraAnchor.x = agoraX;
        window.cameraAnchor.y = 9;
        window.cameraAnchor.z = agoraZ;
      }
      
      window.gfx.camera.alpha = -2.5;
      window.gfx.camera.beta = 0.9;
      window.gfx.camera.radius = 80;
      if (window.gfx.camera.attachControl) {
        window.gfx.camera.attachControl(window.gfx.canvas, false);
        
        // Re-disable built-in inputs after re-attaching (they get re-enabled by attachControl)
        // This is critical for custom camera controls to work properly
        if (window.gfx.camera.inputs && window.gfx.camera.inputs.attached) {
          if (window.gfx.camera.inputs.attached.pointers) {
            try { window.gfx.camera.inputs.attached.pointers.detachControl(); } catch (e) {}
          }
          if (window.gfx.camera.inputs.attached.mousewheel) {
            window.gfx.camera.inputs.attached.mousewheel.detachControl();
          }
          if (window.gfx.camera.inputs.attached.keyboard) {
            try { window.gfx.camera.inputs.attached.keyboard.detachControl(); } catch (e) {}
          }
        }
      }
    }
    
    // Force-load chunks at spawn position
    if (window.gfx && window.gfx.forceLoadChunks && window.gfx.cameraTarget) {
      const targetPos = window.gfx.cameraTarget.position;
      window.gfx.forceLoadChunks(targetPos.x, targetPos.z);
    }
    
    // Prepare player arrays
    const players = [window.player, ...aiPlayers];
    window.playerBuildings = window.playerBuildings || [];
    window.gameUnits = window.gameUnits || [];
    
    // Create game instance (handles spawning units/buildings)
    window.game = new window.Game({
      type: 'adventure',
      map: 'default',
      mapSeed: resolvedSeed,
      players: players,
      isMultiplayer: false,
      tickRate: 60,
      maxPlayers: players.length
    });
    
    console.log('✅ Adventure skirmish game instance created with players:', players.map(p => p.id));
    
    // Ensure unit models are spawned for visual layer
    console.log(`🎨 About to spawn unit models for ${window.gameUnits?.length || 0} units`);
    if (window.gameUnits) {
      console.log(`🔍 Sample units:`, window.gameUnits.slice(0, 3).map(u => ({
        type: u.type,
        owner: u.owner, 
        hasMesh: !!u.mesh,
        pos: u.pb?.state?.loc ? `(${u.pb.state.loc.x.toFixed(1)}, ${u.pb.state.loc.z.toFixed(1)})` : 'no position'
      })));
    }
    
    if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
      window.spawnUnitModels(window.gfx.scene);
      console.log(`✅ spawnUnitModels called - meshes will load asynchronously`);
    } else {
      console.error(`❌ Can't spawn models: spawnUnitModels=${!!window.spawnUnitModels}, gfx=${!!window.gfx}, scene=${!!window.gfx?.scene}`);
    }
    
    // Create match controller for deterministic command handling
    window.currentMatch = new window.Match({
      id: `adventure-${Date.now()}`,
      gameType: 'adventure',
      mapSeed: resolvedSeed,
      mapSize: resolvedFieldSize,
      players: players,
      localPlayerId: window.player.id,
      hostId: window.player.id,
      victoryCondition: 'elimination',
      timeLimit: 0
    });
    
    // Enter playing state immediately for local match
    window.currentMatch.beginPlaying();
    if (window.currentMatch.startLocalTickLoop) {
      window.currentMatch.startLocalTickLoop();
    }
    
    // Clear any selections from menu scene
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
      console.log('🗑️ Cleared menu scene selections before match start');
    }
    
    // Start physics/game loop
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // LOD already updated by forceLoadChunks - no need to call again
    
    // DIAGNOSTIC: Check unit state after everything is initialized
    setTimeout(() => {
      console.log('🔍 POST-INIT DIAGNOSTIC (2 seconds after match start):');
      console.log(`  - gameUnits.length: ${window.gameUnits?.length || 0}`);
      console.log(`  - player.units.length: ${window.player?.units?.length || 0}`);
      console.log(`  - player.id: ${window.player?.id}`);
      
      if (window.gameUnits && window.gameUnits.length > 0) {
        const withMesh = window.gameUnits.filter(u => u.mesh).length;
        const withoutMesh = window.gameUnits.filter(u => !u.mesh).length;
        const playerOwned = window.gameUnits.filter(u => u.owner === window.player?.id || u.owner === 'player').length;
        
        console.log(`  - Units with meshes: ${withMesh}/${window.gameUnits.length}`);
        console.log(`  - Units without meshes: ${withoutMesh}/${window.gameUnits.length}`);
        console.log(`  - Player-owned units: ${playerOwned}`);
        
        if (withoutMesh > 0) {
          console.warn(`⚠️ ${withoutMesh} units still don't have meshes! Models may still be loading...`);
        }
        
        // Check first player unit
        const firstPlayerUnit = window.gameUnits.find(u => u.owner === window.player?.id || u.owner === 'player');
        if (firstPlayerUnit) {
          console.log(`  - First player unit:`, {
            type: firstPlayerUnit.type,
            owner: firstPlayerUnit.owner,
            hasMesh: !!firstPlayerUnit.mesh,
            position: firstPlayerUnit.pb?.state?.loc,
            isPickable: firstPlayerUnit.mesh?.isPickable
          });
        } else {
          console.error(`❌ No player-owned units found!`);
        }
      } else {
        console.error(`❌ NO UNITS IN gameUnits ARRAY!`);
      }
      
      // Check camera position
      if (window.gfx && window.gfx.cameraTarget) {
        console.log(`  - Camera position: (${window.gfx.cameraTarget.position.x.toFixed(1)}, ${window.gfx.cameraTarget.position.z.toFixed(1)})`);
        console.log(`  - Player agora: (${window.player.agora.x * TILE_SIZE}, ${window.player.agora.y * TILE_SIZE})`);
      }
    }, 2000);
    
    // Hide lobby/menu UI and refresh HUD
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    if (window.hud && window.hud.updateResources) {
      window.hud.updateResources();
    }
    
    delete window.pendingMapSeed;
    
    console.log('🧭 Adventure skirmish ready! Use this scenario to diagnose match loading.');
  },

  // Start a multiplayer match
  startMultiplayerMatch: async function(gameType, settings) {
    const config = this.gameTypes[gameType];
    const fieldSize = (settings && settings.fieldSize) || config.defaultFieldSize;
    const rawSeed = (settings && settings.seed !== undefined)
      ? settings.seed
      : (window.pendingMapSeed !== undefined ? window.pendingMapSeed : Math.floor(Math.random() * 1000000));
    const parsedSeed = Number(rawSeed);
    const mapSeed = Number.isFinite(parsedSeed) ? Math.floor(parsedSeed) : Math.floor(Math.random() * 1000000);
    
    // console.log(`🎮 Starting ${config.name} multiplayer match...`);
    // console.log(`🌱 SEED TRACE - rawSeed: ${rawSeed}, parsedSeed: ${parsedSeed}, mapSeed: ${mapSeed}`);
    // console.log(`🗺️ SIZE TRACE - settings.fieldSize: ${settings?.fieldSize}, config.default: ${config.defaultFieldSize}, final: ${fieldSize}`);
    // console.log(`📦 Full settings object:`, settings);
    
    // Deduplicate connected players FIRST (before counting)
    const uniquePeerIds = [...new Set(this.connectedPlayers.map(p => p.id || p))];
    
    // Keep player info (name/color) while deduplicating
    const existingPlayerMap = new Map();
    this.connectedPlayers.forEach(p => {
      const id = p.id || p;
      existingPlayerMap.set(id, p);
    });
    this.connectedPlayers = uniquePeerIds.map(id => existingPlayerMap.get(id) || id);
    
    let totalPlayers = 1 + this.connectedPlayers.length;
    
    console.log(`🎯 Initial player count: ${totalPlayers} (1 local + ${this.connectedPlayers.length} peers)`);
    console.log(`   Peers:`, this.connectedPlayers.map(p => p.id || p));
    
    if (totalPlayers < 2) {
      if (gameType === 'adventure') {
        console.warn('⚠️ Not enough players for Adventure lobby. Launching local AI skirmish instead.');
        this.startAdventureSkirmish(fieldSize, mapSeed, settings?.aiOptions || {});
      } else if (gameType === 'onevsone' || gameType === '1v1') {
        console.warn('⚠️ Not enough players for 1v1 lobby. Launching with AI opponent...');
        this.start1v1Match(fieldSize, mapSeed);
      } else {
        console.warn('⚠️ Not enough players! Unknown game type. Aborting...');
      }
      return;
    }
    
    if (totalPlayers > config.maxPlayers) {
      console.error(`❌ Too many players! Total: ${totalPlayers}, Max: ${config.maxPlayers}`);
      console.error(`   This shouldn't happen after dedup - check P2P library`);
      return;
    }
    
    if (!window.net || typeof window.net.getStatus !== 'function') {
      console.error('❌ Network system not initialized - cannot start multiplayer match');
      return;
    }
    
    // Helper function to normalize player IDs (extract last 6 chars)
    const normalizeId = (id) => {
      if (!id) return '';
      // Extract suffix after last dash (e.g., "p2p-xyz123" -> "xyz123")
      const suffix = id.includes('-') ? id.split('-').pop() : id;
      // Return last 6 chars of suffix
      return suffix.length > 6 ? suffix.slice(-6) : suffix;
    };
    
    let netStatus = window.net.getStatus();
    let localPlayerId = netStatus?.localPlayerId;
    
    if (!localPlayerId) {
      console.warn('⌛ Waiting for local network ID before starting multiplayer match...');
      try {
        localPlayerId = await this.waitForLocalPlayerId();
      } catch (error) {
        console.error('❌ Failed to obtain local player network ID in time:', error);
        return;
      }
    }
    
    if (!localPlayerId) {
      console.error('❌ Local player ID unavailable - aborting multiplayer match start');
      return;
    }
    
    // Refresh network state after waiting for the ID
    netStatus = window.net.getStatus();
    localPlayerId = netStatus?.localPlayerId || localPlayerId;
    
    // CRITICAL: Normalize to last 6 chars immediately - no more ID flippyfloppy!
    localPlayerId = normalizeId(localPlayerId);
    if (Array.isArray(netStatus?.peers)) {
      // Deduplicate peer IDs (sometimes P2P library returns duplicates)
      const uniquePeers = [...new Set(netStatus.peers)];
      
      // Merge with existing player info (names/colors from player_joined messages)
      const existingPlayerMap = new Map();
      this.connectedPlayers.forEach(p => {
        const id = p.id || p;
        existingPlayerMap.set(id, p);
      });
      
      this.connectedPlayers = uniquePeers.map(peerId => {
        return existingPlayerMap.get(peerId) || peerId;
      });
    }
    
    // Re-evaluate player counts with up-to-date peer information
    totalPlayers = 1 + this.connectedPlayers.length;
    
    console.log(`👥 Player count check: localPlayerId="${localPlayerId}", connectedPlayers:`, this.connectedPlayers.map(p => p.id || p));
    console.log(`   Total: ${totalPlayers}, Max: ${config.maxPlayers}`);
    
    if (totalPlayers < 2) {
      if (gameType === 'adventure') {
        console.warn('⚠️ Opponent disconnected while waiting. Switching to local Adventure skirmish.');
        this.startAdventureSkirmish(fieldSize, mapSeed, settings?.aiOptions || {});
      } else if (gameType === 'onevsone' || gameType === '1v1') {
        console.warn('⚠️ Opponent disconnected while waiting. Launching 1v1 with AI opponent...');
        this.start1v1Match(fieldSize, mapSeed);
      } else {
        console.warn('⚠️ Opponent disconnected while waiting for network readiness. Aborting multiplayer start.');
      }
      return;
    }
    
    if (totalPlayers > config.maxPlayers) {
      console.error(`❌ Too many players! Total: ${totalPlayers}, Max: ${config.maxPlayers}`);
      console.error(`   Local: ${localPlayerId}`);
      console.error(`   connectedPlayers (${this.connectedPlayers.length}):`, this.connectedPlayers);
      console.error(`   Raw peer list:`, netStatus?.peers);
      
      // Try to fix: deduplicate again in case something went wrong
      const uniquePeerIds = [...new Set(this.connectedPlayers.map(p => p.id || p))];
      console.error(`   After dedup: ${uniquePeerIds.length} unique peers:`, uniquePeerIds);
      
      if (1 + uniquePeerIds.length <= config.maxPlayers) {
        console.warn(`⚠️ False alarm - continuing after deduplication`);
        totalPlayers = 1 + uniquePeerIds.length;
        
        // Fix the array
        const existingPlayerMap = new Map();
        this.connectedPlayers.forEach(p => {
          const id = p.id || p;
          existingPlayerMap.set(id, p);
        });
        this.connectedPlayers = uniquePeerIds.map(id => existingPlayerMap.get(id) || id);
      } else {
        return;
      }
    }
    
    // Reset game state now that identifiers are stable
    this.resetGameState();
    
    // Set multiplayer flags FIRST
    window.isMultiplayer = true;
    window.gameType = gameType;
    window.mapSeed = mapSeed; // Store for game initialization
    
    // Disable neutral unit auto-spawning permanently
    if (window.autoInitDisabled !== undefined) {
      window.autoInitDisabled = true;
    }
    
    // Get spawn positions for all players (spread them out on the map)
    const spawnPositions = this.getSpawnPositions(totalPlayers, fieldSize);
    const localPlayerName = window.currentPlayerName || 'Player 1';
    const localPlayerColor = window.currentPlayerColor || '#ff0000';
    
    // Sort all player IDs deterministically for consistent spawn order
    // NOTE: We already normalized localPlayerId to 6 chars earlier
    // For sorting, we need the full suffix to ensure consistency
    const getIdForSorting = (id) => {
      if (!id) return '';
      // If already normalized to 6 chars, return as-is
      if (id.length === 6) return id;
      // Otherwise extract suffix after last dash (e.g., "p2p-xyz123" -> "xyz123")
      return id.includes('-') ? id.split('-').pop() : id;
    };
    
    const allPlayerIds = [
      localPlayerId,  // Already normalized to 6 chars
      ...this.connectedPlayers.map(p => {
        const peerId = p.id || p;
        return normalizeId(peerId);  // Normalize peer IDs to 6 chars too
      })
    ].sort();
    
    const normalizedLocalId = localPlayerId;  // Already normalized
    let localPlayerIndex = allPlayerIds.indexOf(normalizedLocalId);
    
    if (localPlayerIndex === -1) {
      console.warn('⚠️ Local player ID missing from sorted list. Forcing local index to 0.');
      localPlayerIndex = 0;
    }
    
    if (spawnPositions[localPlayerIndex] === undefined) {
      console.error('❌ Not enough spawn positions for players:', { spawnPositions, allPlayerIds, localPlayerIndex });
      return;
    }
    
    if (new Set(allPlayerIds).size !== allPlayerIds.length) {
      console.warn('⚠️ Duplicate player IDs detected in lobby:', allPlayerIds);
    }
    
    // Initialize player if it doesn't exist
    if (!window.player) {
      console.log('🎮 Creating player instance for multiplayer...');
      window.player = new Player(); // Create player directly without Game instance
    }
    
    // Update player ID before spawning
    // CRITICAL: Normalize player ID to last 6 chars for consistency with unit/building ownership
    if (window.player) {
      window.player.id = normalizedLocalId;  // Use the normalized ID (last 6 chars)
      window.player.name = localPlayerName;
      window.player.color = localPlayerColor;
      window.player.agora = spawnPositions[localPlayerIndex];
      
      // console.log(`👤 Local player: ${localPlayerName} (ID: ${localPlayerId.slice(-8)})`);
      // console.log(`🏛️ Local player spawn: (${spawnPositions[localPlayerIndex].x}, ${spawnPositions[localPlayerIndex].y})`);
      
      // Position player physics body at spawn
      if (window.player.pbody) {
        const agoraX = window.player.agora.x * TILE_SIZE;
        const agoraZ = window.player.agora.y * TILE_SIZE;
        window.player.pbody.state.loc.set(agoraX, 0, agoraZ);
        window.player.pbody.vel.set(0, 0, 0);
        window.player.pbody.imp.set(0, 0, 0);
        // console.log(`🐸 Player frog positioned at spawn: (${agoraX.toFixed(1)}, ${agoraZ.toFixed(1)})`);
      }
    }
    
    // Regenerate field with multiplayer seed
    // Resolve numeric field dimensions from preset string
    const dims = (typeof fieldSize === 'string')
      ? (this.getFieldDimensions(fieldSize) || { width: 128, height: 128 })
      : { width: fieldSize, height: fieldSize };
    
    // console.log(`🗺️ Regenerating field with seed ${mapSeed}, size: ${fieldSize} (${dims.width}x${dims.height})`);
    // console.log(`🎲 Field creation params:`, { seed: mapSeed, fieldSize, rawSettings: settings });
    // Keep reference to old field so we can dispose its terrain meshes
    const oldField = window.liveField;
    
    // Dispose old field before creating new one
    if (oldField && typeof oldField.dispose === 'function') {
      oldField.dispose();
    }
    
    window.liveField = new window.Field({
      width: dims.width,
      height: dims.height,
      seed: mapSeed
    });
    
    if (typeof liveField !== 'undefined') {
      liveField = window.liveField;
    }
    
    // CRITICAL: Apply current LOD settings to new field immediately!
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      const currentMultiplier = window.hud.getCurrentLODMultiplier();
      
      window.liveField.originalLoadDistance = 4;
      const newLoadDistance = Math.round(4 * currentMultiplier);
      window.liveField.currentLoadDistance = Math.max(2, Math.min(8, newLoadDistance));
    }
    
    // Re-stretch the table to the new field dimensions (matches initial load order)
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    // Force camera limits to recalc for new field size
    window._cameraLimitsSet = false;
    
    // Position camera at spawn location
    if (window.gfx && window.gfx.camera && window.gfx.cameraTarget) {
      const agoraX = window.player.agora.x * TILE_SIZE;
      const agoraZ = window.player.agora.y * TILE_SIZE;
      
      // Smoothly transition camera to new position (no jump)
      // Use anchor for smooth lerp, or snap if too far away
      const currentX = window.gfx.cameraTarget.position.x;
      const currentZ = window.gfx.cameraTarget.position.z;
      const distance = Math.sqrt(Math.pow(agoraX - currentX, 2) + Math.pow(agoraZ - currentZ, 2));
      
      if (distance > 100) {
        // Too far, snap immediately
        window.gfx.cameraTarget.position.x = agoraX;
        window.gfx.cameraTarget.position.z = agoraZ;
      } else {
        // Close enough, smooth transition via anchor
        window.gfx.cameraTarget.position.x = agoraX;
        window.gfx.cameraTarget.position.z = agoraZ;
      }
      
      window.gfx.cameraTarget.position.y = 9;
      
      // Set camera anchor for smooth following
      if (window.cameraAnchor) {
        window.cameraAnchor.x = agoraX;
        window.cameraAnchor.y = 9;
        window.cameraAnchor.z = agoraZ;
      }
      
      // Reset camera rotation to look at map center
      // Calculate map center
      const mapCenterX = (window.liveField.width / 2) * TILE_SIZE;
      const mapCenterZ = (window.liveField.height / 2) * TILE_SIZE;
      
      // Calculate angle from spawn to center
      const dx = mapCenterX - agoraX;
      const dz = mapCenterZ - agoraZ;
      const angleToCenter = Math.atan2(dx, dz);
      
      // Set camera to face center with standard viewing angle
      if (window.gfx.camera) {
        window.gfx.camera.alpha = angleToCenter + Math.PI; // +PI because camera looks backward
        window.gfx.camera.beta = 0.9;   // Vertical angle (looking slightly down)
        window.gfx.camera.radius = 80;  // Zoom distance
      }
      
      // Ensure camera controls are enabled
      if (window.gfx.camera.attachControl) {
        window.gfx.camera.attachControl(window.gfx.canvas, false);
        
        // Re-disable built-in inputs after re-attaching (they get re-enabled by attachControl)
        // This is critical for custom camera controls to work properly
        if (window.gfx.camera.inputs && window.gfx.camera.inputs.attached) {
          if (window.gfx.camera.inputs.attached.pointers) {
            try { window.gfx.camera.inputs.attached.pointers.detachControl(); } catch (e) {}
          }
          if (window.gfx.camera.inputs.attached.mousewheel) {
            window.gfx.camera.inputs.attached.mousewheel.detachControl();
          }
          if (window.gfx.camera.inputs.attached.keyboard) {
            try { window.gfx.camera.inputs.attached.keyboard.detachControl(); } catch (e) {}
          }
        }
      }
      
      // Start LOD ramping now that game is beginning
      if (window.gfx && window.gfx.startGameLOD) {
        window.gfx.startGameLOD();
      }
    }
    
    // Force-load chunks at spawn position
    if (window.gfx && window.gfx.forceLoadChunks && window.gfx.cameraTarget) {
      const targetPos = window.gfx.cameraTarget.position;
      window.gfx.forceLoadChunks(targetPos.x, targetPos.z);
    }
    
    // Initialize players array with proper names and colors
    // CRITICAL: Build players array in SORTED ORDER so both clients have identical ordering
    const players = [];
    
    
    // Iterate through ALL player IDs in sorted order (including local player)
    allPlayerIds.forEach((normalizedId, index) => {
      const spawnPos = spawnPositions[index];
      
      if (normalizedId === normalizedLocalId) {
        // This is the local player
        players.push(window.player);
      } else {
        // This is a remote opponent
        const playerMeta = this.connectedPlayers.find(p => normalizeId(p.id || p) === normalizedId);
        const playerName = playerMeta?.name || `Player ${index + 1}`;
        const playerColor = playerMeta?.color || this.getPlayerColor(index);
        
        // CRITICAL: Use normalized ID (6 chars) for consistency
        const opponent = new window.OpponentPlayer({
          id: normalizedId,  // Use normalized 6-char ID
          name: playerName,
          gameType: gameType,
          color: playerColor,
          startingResources: { food: 100, wood: 50, stone: 25, magic: 10 },
          agora: spawnPos,
          basePosition: { x: spawnPos.x, z: spawnPos.y },
          isAI: false
        });
        players.push(opponent);
      }
    });
    
    // Create Match instance to manage the multiplayer game
    // NOTE: localPlayerId is already normalized to 6 chars at line 2272
    
    const matchOptions = {
      id: this.currentLobbyId,
      gameType: gameType,
      mapSeed: mapSeed,
      mapSize: fieldSize,
      players: players,
      localPlayerId: localPlayerId,  // Already normalized
      hostId: this.isHost ? localPlayerId : null,  // Already normalized
      victoryCondition: 'elimination',
      timeLimit: 0 // No time limit by default
    };
    
    window.currentMatch = new window.Match(matchOptions);
    
    // Ensure playerBuildings array exists and is empty BEFORE creating Game
    if (!window.playerBuildings) {
      window.playerBuildings = [];
    }
    // Ensure gameUnits array exists and is empty
    if (!window.gameUnits) {
      window.gameUnits = [];
    } else {
      // CRITICAL: Clear in-place to preserve reference (don't replace array)
      window.gameUnits.length = 0;
    }
    
    // Create Game instance (visual/physics layer)
    window.game = new window.Game({
      type: gameType,
      map: 'default',
      mapSeed: mapSeed,
      players: players,
      isMultiplayer: true,
      tickRate: window.net ? window.net.TICK_RATE : 60,
      maxPlayers: config.maxPlayers
    });
    
    
    // CRITICAL: Clear any neutral units that spawned in menu scene
    if (window.gameUnits) {
      const neutralUnitsToRemove = window.gameUnits.filter(u => u.owner === 'neutral');
      neutralUnitsToRemove.forEach(unit => {
        if (window.destroyUnit) {
          window.destroyUnit(unit);
        }
      });
      if (neutralUnitsToRemove.length > 0) {
        console.log(`🗑️ Removed ${neutralUnitsToRemove.length} neutral units from menu scene`);
      }
    }
    
    // Initialize the game to spawn units and buildings
    if (window.game && window.game.init) {
      // console.log('🎮 Initializing game (spawning units)...');
      // console.log(`🔍 Player ID before spawning: ${window.player.id}`);
      // console.log(`🔍 game.players array:`, window.game.players.map(p => ({id: p.id, name: p.name, isPlayer: p === window.player})));
      
      // BEFORE game.init - check state
      // console.log(`🔍 BEFORE game.init():`);
      // console.log(`  - window.playerBuildings.length: ${window.playerBuildings?.length || 0}`);
      // console.log(`  - window.gameUnits.length: ${window.gameUnits?.length || 0}`);
      // console.log(`  - window.player.units.length: ${window.player.units?.length || 0}`);
      
      window.game.init();
      
      // AFTER game.init - check state
      // console.log(`🔍 AFTER game.init():`);
      // console.log(`  - window.playerBuildings.length: ${window.playerBuildings?.length || 0}`);
      // console.log(`  - window.gameUnits.length: ${window.gameUnits?.length || 0}`);
      // console.log(`  - window.player.units.length: ${window.player.units?.length || 0}`);
      
      if (window.playerBuildings && window.playerBuildings.length > 0) {
        console.log(`  - Buildings:`, window.playerBuildings.map(b => ({type: b.type, owner: b.owner, pos: `(${b.gridX},${b.gridZ})`})));
      }
      
      // Ensure visual meshes are created for all units that were just spawned
      if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
        window.spawnUnitModels(window.gfx.scene);
      }
      
      // Verify units have correct owner and are in player.units
      if (window.player.units && window.player.units.length > 0) {
        const firstUnit = window.player.units[0];
        // console.log(`✅ Local player has ${window.player.units.length} units`);
        // console.log(`  - First unit: type=${firstUnit.type}, owner=${firstUnit.owner}, id=${firstUnit.id}`);
        // console.log(`  - Owner matches player ID: ${firstUnit.owner === window.player.id}`);
      } else {
        console.warn('❌ No units in window.player.units array!');
        console.log(`  - Checking window.gameUnits for any units...`);
        if (window.gameUnits && window.gameUnits.length > 0) {
          console.log(`  - Found ${window.gameUnits.length} units in gameUnits`);
          window.gameUnits.forEach((u, i) => {
            console.log(`    [${i}] type=${u.type}, owner=${u.owner}, id=${u.id}`);
          });
        }
      }
      
      // Check opponent units
      const opponents = window.game.players.filter(p => p !== window.player);
      opponents.forEach(opp => {
        console.log(`👥 Opponent ${opp.name || opp.id} has ${opp.units?.length || 0} units`);
      });
    }
    
    // Start the match (enters LOADING state)
    window.currentMatch.start();
    
    // Signal that local player has finished loading (after all initialization is complete)
    // This will trigger the countdown when all remote players are also loaded
    setTimeout(() => {
      if (window.currentMatch && window.currentMatch.onLocalPlayerLoaded) {
        // console.log('✅ Local player finished all initialization - signaling loaded');
        window.currentMatch.onLocalPlayerLoaded();
      }
    }, 500); // Small delay to ensure async model loading has started
    
    // If testing alone, fallback to starting immediately
    if (!window.isMultiplayer || this.connectedPlayers.length === 0) {
      console.log('🎮 Single player testing - will auto-start after countdown');
    }
    
    // Clear any selections from menu scene
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
      // console.log('🗑️ Cleared menu scene selections before match start (multiplayer)');
    }
    
    // Clear pending seed
    delete window.pendingMapSeed;
    
    // Start game loop
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // Hide menu and all lobby UI
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    
    // Hide lobby room UI
    const lobbyRoomEl = document.getElementById('lobby_room');
    if (lobbyRoomEl) {
      lobbyRoomEl.style.display = 'none';
    }
    
    // Camera already positioned earlier - no need to reposition
    
    // Update HUD
    if (window.hud && window.hud.updateResources) {
      window.hud.updateResources();
    }
    
    // Signal that local player has finished loading
    setTimeout(() => {
      if (window.currentMatch && window.currentMatch.onLocalPlayerLoaded) {
        // console.log('📡 Signaling local player loaded');
        window.currentMatch.onLocalPlayerLoaded();
      }
    }, 500); // 500ms delay to ensure all assets are loaded
    
    // console.log(`✅ Multiplayer match initializing with ${totalPlayers} players...`);
    // console.log(`🎲 All players should have identical map (seed: ${mapSeed})`);
  },
  
  // Get spawn positions for multiplayer (spread players around the map)
  getSpawnPositions: function(playerCount, fieldSize) {
    // Resolve numeric dimensions for the selected field size
    const dims = (typeof fieldSize === 'string')
      ? (this.getFieldDimensions(fieldSize) || { width: 128, height: 128 })
      : { width: fieldSize, height: fieldSize };
    
    // Use the smaller dimension to keep margin calculations safe
    const mapSize = Math.max(32, Math.min(dims.width, dims.height));
    const margin = Math.floor(Math.max(8, Math.min(20, mapSize * 0.15))); // 15% margin, clamped
    
    const positions = [];
    
    if (playerCount === 2) {
      // 1v1: Opposite corners
      positions.push({ x: margin, y: margin }); // Bottom-left
      positions.push({ x: mapSize - margin, y: mapSize - margin }); // Top-right
    } else if (playerCount === 3) {
      // 3 players: Triangle formation
      positions.push({ x: margin, y: Math.round(mapSize / 2) }); // Left
      positions.push({ x: mapSize - margin, y: margin }); // Bottom-right
      positions.push({ x: mapSize - margin, y: mapSize - margin }); // Top-right
    } else if (playerCount === 4) {
      // 4 players: Square corners (KOTH, Teams, Adventure)
      positions.push({ x: margin, y: margin }); // Bottom-left
      positions.push({ x: mapSize - margin, y: margin }); // Bottom-right
      positions.push({ x: margin, y: mapSize - margin }); // Top-left
      positions.push({ x: mapSize - margin, y: mapSize - margin }); // Top-right
    } else {
      // More players: Circle formation
      const centerX = mapSize / 2;
      const centerY = mapSize / 2;
      const radius = (mapSize / 2) - margin;
      
      for (let i = 0; i < playerCount; i++) {
        const angle = (i / playerCount) * Math.PI * 2;
        positions.push({
          x: Math.round(centerX + Math.cos(angle) * radius),
          y: Math.round(centerY + Math.sin(angle) * radius)
        });
      }
    }
    
    // console.log(`🗺️ Generated ${playerCount} spawn positions:`, positions);
    return positions;
  },
  
  // Get player color based on player index
  getPlayerColor: function(playerIndex) {
    const colors = [
      { primary: '#ff0000', secondary: '#cc0000' }, // Red
      { primary: '#0066cc', secondary: '#004499' }, // Blue
      { primary: '#00cc00', secondary: '#009900' }, // Green
      { primary: '#ffaa00', secondary: '#cc8800' }, // Orange
      { primary: '#aa00ff', secondary: '#8800cc' }, // Purple
      { primary: '#00aaaa', secondary: '#008888' }  // Cyan
    ];
    
    return colors[playerIndex % colors.length];
  }
};

// Make Lobby available globally
window.Lobby = Lobby;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  Lobby.init();
});
