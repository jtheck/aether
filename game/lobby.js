// Lobby system for managing game matches and multiplayer matchmaking
const Lobby = {
  
  // Track lobby state
  currentGameType: null,
  
  // Store last known lobby counts from main menu stats
  lastKnownLobbyCounts: {},
  currentLobbyId: null,
  connectedPlayers: [],
  isHost: false,
  lobbyUpdateInterval: null,
  lobbyDiscoveryInterval: null,
  availableLobbies: {}, // {gameType: [{id, name, host, players, maxPlayers, settings}, ...]}
  playerReadyStates: {}, // {peerId: true/false}
  playerConnectionStates: {}, // {peerId: 'connecting' | 'connected' | 'disconnected'}
  _playersMeta: null,
  globalStatsChannel: null,
  playerStatuses: {}, // {playerId: {gameType, status, timestamp}}
  connectedChannels: {}, // Track which channels are connected
  pendingBroadcasts: [], // Queue broadcasts until channel is ready
  lobbySearchStartTime: {}, // Track when we started searching for lobbies per game type
  hasAnnouncedPresence: false,
  
  normalizePeerId: function(id) {
    if (!id) return '';
    const suffix = id.includes('-') ? id.split('-').pop() : id;
    return suffix.length > 6 ? suffix.slice(-6) : suffix;
  },

  createRemoteMatchPlayer: function({
    id,
    name,
    color,
    resources,
    agora,
    basePosition
  } = {}) {
    const startingResources = resources ? { ...resources } : { ...STARTING_RESOURCES };
    if (window.OpponentPlayer) {
      const remotePlayer = new window.OpponentPlayer({
        id,
        name,
        color,
        startingResources,
        agora,
        basePosition,
        isAI: false
      });
      remotePlayer.isRemote = true;
      remotePlayer.selectedUnits = remotePlayer.selectedUnits || [];
      remotePlayer.buildings = remotePlayer.buildings || [];
      remotePlayer.units = remotePlayer.units || [];
      return remotePlayer;
    }

    return {
      id,
      name,
      color,
      resources: startingResources,
      units: [],
      buildings: [],
      selectedUnits: [],
      isAI: false,
      isRemote: true,
      addResource(resourceType, amount) {
        if (Object.prototype.hasOwnProperty.call(this.resources, resourceType)) {
          this.resources[resourceType] += amount;
          return true;
        }
        return false;
      },
      removeResource(resourceType, amount) {
        if (Object.prototype.hasOwnProperty.call(this.resources, resourceType) &&
            this.resources[resourceType] >= amount) {
          this.resources[resourceType] -= amount;
          return true;
        }
        return false;
      }
    };
  },

  normalizeAdventurePlayers: function(players = []) {
    if (!Array.isArray(players) || players.length === 0) {
      return players;
    }

    const normalize = this.normalizePeerId.bind(this);
    const localP2pId = window.net?.getStatus?.().localPlayerId || '';
    const localP2pNorm = normalize(localP2pId);
    const currentLocalNorm = normalize(window.player?.id);
    const remoteNormalizedIds = new Set(
      (this.connectedPlayers || [])
        .map(p => normalize(p?.id || p))
        .filter(Boolean)
    );

    const sourcePlayers = players.map((player, index) => {
      const id = (player && player.id) ? player.id : player;
      return {
        id,
        normalizedId: normalize(id),
        name: player?.name || (index === 0 ? 'Host' : `Player ${index + 1}`),
        color: player?.color,
        resources: player?.resources ? { ...player.resources } : undefined
      };
    }).filter(entry => !!entry.id);

    let localEntry = sourcePlayers.find(entry => entry.normalizedId === localP2pNorm) || null;
    if (!localEntry) {
      localEntry = sourcePlayers.find(entry => entry.normalizedId === currentLocalNorm) || null;
    }
    if (!localEntry) {
      const inferredLocalEntries = sourcePlayers.filter(entry => !remoteNormalizedIds.has(entry.normalizedId));
      if (inferredLocalEntries.length === 1) {
        localEntry = inferredLocalEntries[0];
      }
    }
    if (!localEntry && sourcePlayers.length === 1) {
      localEntry = sourcePlayers[0];
    }

    console.log('🧭 Adventure player normalization:', {
      localP2pId,
      localP2pNorm,
      currentPlayerId: window.player?.id || null,
      currentLocalNorm,
      sourcePlayers: sourcePlayers.map((entry, index) => ({
        slot: index,
        id: entry.id,
        normalizedId: entry.normalizedId,
        name: entry.name,
        color: entry.color || null
      })),
      resolvedLocalId: localEntry?.id || null,
      resolvedLocalNorm: localEntry?.normalizedId || null
    });

    return sourcePlayers.map((entry, index) => {
      if (localEntry && entry.id === localEntry.id) {
        window.player.id = entry.id;
        if (entry.name) window.player.name = entry.name;
        if (entry.color) window.player.color = entry.color;
        if (entry.resources) window.player.resources = { ...entry.resources };
        return window.player;
      }

      return this.createRemoteMatchPlayer({
        id: entry.id,
        name: entry.name || (index === 0 ? 'Host' : `Player ${index + 1}`),
        color: entry.color,
        resources: entry.resources
      });
    });
  },
  
  // Ensure connected player metadata stays in sync with the peer list
  syncConnectedPlayersFromPeerIds: function(peerIds = []) {
    const peers = Array.isArray(peerIds) ? peerIds.filter(Boolean) : [];
    const uniquePeerIds = [...new Set(peers)];
    const existingPlayerMap = new Map();
    
    (this.connectedPlayers || []).forEach(entry => {
      const entryId = (entry && entry.id) ? entry.id : entry;
      const normalizedId = this.normalizePeerId(entryId);
      if (!entryId || !normalizedId || existingPlayerMap.has(normalizedId)) {
        return;
      }
      if (typeof entry === 'object') {
        existingPlayerMap.set(normalizedId, {
          ...entry,
          id: entryId,
          shortId: entry.shortId || normalizedId
        });
      } else {
        existingPlayerMap.set(normalizedId, { id: entryId, shortId: normalizedId });
      }
    });
    
    this.connectedPlayers = uniquePeerIds.map(peerId => {
      const normalizedId = this.normalizePeerId(peerId);
      const existing = normalizedId ? existingPlayerMap.get(normalizedId) : null;
      if (existing) {
        existing.id = peerId;
        existing.shortId = normalizedId;
        return existing;
      }
      return { id: peerId, shortId: normalizedId };
    });
    
    return this.connectedPlayers;
  },
  
  // Merge or insert metadata for a connected player without duplicating entries
  upsertConnectedPlayerMeta: function(playerData = {}) {
    const playerId = playerData.id;
    if (!playerId) return;
    
    const normalizedTarget = this.normalizePeerId(playerId);
    let found = false;
    const seen = new Set();
    const updatedList = [];
    
    (this.connectedPlayers || []).forEach(entry => {
      const entryId = (entry && entry.id) ? entry.id : entry;
      const normalizedEntryId = this.normalizePeerId(entryId);
      if (!entryId || !normalizedEntryId || seen.has(normalizedEntryId)) {
        return;
      }
      seen.add(normalizedEntryId);
      
      if (!found && normalizedEntryId === normalizedTarget) {
        const enriched = typeof entry === 'object' ? entry : { id: entryId };
        enriched.id = playerId || entryId;
        enriched.shortId = normalizedTarget;
        if (playerData.name !== undefined) enriched.name = playerData.name;
        if (playerData.color !== undefined) enriched.color = playerData.color;
        updatedList.push(enriched);
        found = true;
      } else if (typeof entry === 'object') {
        entry.id = entry.id || entryId;
        entry.shortId = entry.shortId || normalizedEntryId;
        updatedList.push(entry);
      } else {
        updatedList.push({ id: entryId, shortId: normalizedEntryId });
      }
    });
    
    if (!found) {
      updatedList.push({
        id: playerId,
        shortId: normalizedTarget,
        name: playerData.name,
        color: playerData.color
      });
    }
    
    this.connectedPlayers = updatedList;
  },
  
  // Remove a connected player entry (object or raw ID) and collapse duplicates
  removeConnectedPlayerById: function(playerId) {
    if (!playerId) return;
    const seen = new Set();
    const normalizedTarget = this.normalizePeerId(playerId);
    this.connectedPlayers = (this.connectedPlayers || []).filter(entry => {
      const entryId = (entry && entry.id) ? entry.id : entry;
      const normalizedEntryId = this.normalizePeerId(entryId);
      if (!entryId || !normalizedEntryId || seen.has(normalizedEntryId)) {
        return false;
      }
      seen.add(normalizedEntryId);
      return normalizedEntryId !== normalizedTarget;
    });
  },
  
  sendPlayerPresence: function(targetPeerId = null) {
    if (!window.net || !window.net.p2p || !this.currentLobbyId) {
      return;
    }
    
    const status = window.net.getStatus ? window.net.getStatus() : {};
    const myId = status.localPlayerId;
    if (!myId) return;
    
    const payload = {
      type: 'player_joined',
      playerId: myId,
      playerName: window.currentPlayerName || window.player?.name || `Player ${this.normalizePeerId(myId)}`,
      playerColor: window.currentPlayerColor || window.player?.color || '#ffffff'
    };
    
    try {
      if (targetPeerId) {
        window.net.p2p.sendData(payload, targetPeerId);
      } else {
        window.net.p2p.sendData(payload);
      }
      this.hasAnnouncedPresence = true;
    } catch (error) {
      console.warn('⚠️ Failed to send player presence:', error);
    }
  },
  
  // Notify peers that this client has left the lobby (non-host)
  notifyPeersPlayerLeft: function(playerId) {
    if (!playerId || !window.net || !window.net.p2p || typeof window.net.p2p.sendData !== 'function') {
      return;
    }
    
    try {
      window.net.p2p.sendData({
        type: 'player_left',
        playerId: playerId
      });
    } catch (error) {
      console.warn('⚠️ Failed to notify peers about player leaving:', error);
    }
  },
  
  // Game type configurations
  gameTypes: {
    'adventure': {
      name: 'Adventure',
      maxPlayers: 4,
      lobbyKey: 'aether-adventure-coop',
      defaultFieldSize: 'tiny'
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
      defaultFieldSize: 'medium'
    }
  },
  
  // Reset the field and game state to defaults
  resetGameState: function() {
    // console.log('🧹 Starting complete scene cleanup...');
    
    try {
      // Stop demo mode if running (before clearing currentMatch)
      if (window.demo && window.demo.stop) {
        window.demo.stop();
      }
      
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
      const unitsToDestroy = window.gameUnits.slice();
      unitsToDestroy.forEach(unit => {
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
      window.player.resources = { ...STARTING_RESOURCES };
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
    
    // Note: playerBuildings array no longer exists - all buildings use gameBuildings
    // (kept comment for historical context)
    
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
    
    // Clear resource registries (tree/rock placement tracking)
    if (window.gfx && window.gfx.clearResourceRegistries) {
      window.gfx.clearResourceRegistries();
    }
    
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
  start1v1Match: function(fieldSize = 'medium', mapSeed = null, customMapData = null) {
    
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
    }
    
    // CRITICAL: Generate unique player ID for each match (like AI opponents do)
    // Also reset if still using demo ID from menu mode
    if (!window.player.id || window.player.id === 'undefined' || window.player.id === 'player' || window.player.id === 'demo') {
      // Generate unique ID similar to AI opponents
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      window.player.id = `local-player-${randomSuffix}`;
    }
    
    // Reset player state for new match
    window.player.units = [];
    window.player.buildings = [];
    window.player.selectedUnits = [];
    
    // Resolve field dimensions for 1v1 (typically smaller than adventure)
    // If using custom map, use its dimensions
    let dims;
    if (customMapData) {
      const mapWidth = customMapData.w || customMapData.width || 64;
      const mapHeight = customMapData.h || customMapData.height || 64;
      dims = { width: mapWidth, height: mapHeight };
    } else {
      dims = (typeof resolvedFieldSize === 'string')
        ? (this.getFieldDimensions(resolvedFieldSize) || { width: 128, height: 128 })
        : { width: resolvedFieldSize, height: resolvedFieldSize };
    }
    
    // Parse spawn points from custom map if available
    let spawnPositions;
    if (customMapData && customMapData.sp) {
      // Parse spawn points from map format: "x,y,team;x,y,team;..." or "x,y;x,y;..." (legacy)
      const parsedSpawns = customMapData.sp.split(';').map((s, index) => {
        const parts = s.split(',').map(Number);
        const x = parts[0];
        const y = parts[1];
        const team = parts.length > 2 && !isNaN(parts[2]) ? parts[2] : index;  // Fallback to index for legacy format
        return { x, y, team };
      });
      // Sort by spawn index to maintain placement order
      parsedSpawns.sort((a, b) => a.team - b.team);
      // Use first two spawns (or fallback to corners)
      if (parsedSpawns.length >= 2) {
        spawnPositions = [parsedSpawns[0], parsedSpawns[1]];
        console.log('🏛️ Using custom map Agora spawns:', spawnPositions);
      } else if (parsedSpawns.length === 1) {
        // Only one spawn defined - place AI opposite
        const cornerMargin = Math.max(8, Math.floor(Math.min(dims.width, dims.height) * 0.1));
        spawnPositions = [
          parsedSpawns[0],
          { x: dims.width - cornerMargin - 1, y: dims.height - cornerMargin - 1 }
        ];
      } else {
        spawnPositions = null; // Fall through to default
      }
    }
    
    // Default: Two players in opposite corners
    if (!spawnPositions) {
      const cornerMargin = Math.max(8, Math.floor(Math.min(dims.width, dims.height) * 0.1));
      spawnPositions = [
        { x: cornerMargin, y: cornerMargin }, // Player
        { x: dims.width - cornerMargin - 1, y: dims.height - cornerMargin - 1 } // AI opponent
      ];
    }
    
    const tileSize = (typeof TILE_SIZE === 'number') ? TILE_SIZE : (window.TILE_SIZE || 4);
    
    // Configure local player identity and spawn
    const localPlayerId = window.player.id; // CRITICAL: No fallback - ID must be set!
    window.player.id = localPlayerId;
    window.player.name = window.currentPlayerName || 'Duelist';
    window.player.color = window.currentPlayerColor || this.getPlayerColor(0).primary;
    window.player.agora = spawnPositions[0];
    window.player.basePosition = { x: spawnPositions[0].x, z: spawnPositions[0].y };
    
    console.log(`🎮 Player initialized: id="${window.player.id}", name="${window.player.name}", color="${window.player.color}"`);
    
    if (window.player.pbody) {
      const agoraX = window.player.agora.x * tileSize;
      const agoraZ = window.player.agora.y * tileSize;
      window.player.pbody.state.loc.set(agoraX, 0, agoraZ);
      window.player.pbody.vel.set(0, 0, 0);
      window.player.pbody.imp.set(0, 0, 0);
    }
    
    // Create single AI opponent for 1v1
    const spawn = spawnPositions[1];
    const aiId = `ai-opponent-${resolvedSeed.toString(16).padStart(6, '0')}`;
    const aiOptions = {
      id: aiId,
      name: 'AI Opponent',
      color: this.getPlayerColor(1).primary,
      startingResources: { ...STARTING_RESOURCES },
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
    
    console.log(`🤖 AI initialized: id="${aiPlayer.id}", name="${aiPlayer.name}", color="${aiPlayer.color}"`);
    
    // Regenerate field with desired seed
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
    
    // Create the new field
    window.liveField = new window.Field({
      width: dims.width,
      height: dims.height,
      seed: resolvedSeed,
      spawnPositions: spawnPositions // Pass spawn positions for flattening
    });
    if (window.gfx && window.gfx.primeFieldResourcePathing) {
      window.gfx.primeFieldResourcePathing(window.liveField);
    }
    if (typeof liveField !== 'undefined') {
      liveField = window.liveField;
    }
    
    // CRITICAL: Apply current LOD settings to new field immediately!
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      const currentMultiplier = window.hud.getCurrentLODMultiplier();
      const savedLOD = localStorage.getItem('lodLevel');
      const lodLevel = savedLOD ? parseInt(savedLOD) : 50;
      
      window.liveField.originalLoadDistance = 6;
      const newLoadDistance = Math.round(6 * currentMultiplier);
      window.liveField.currentLoadDistance = Math.max(3, Math.min(12, newLoadDistance));
    }
    
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    
    // Apply custom map data AFTER stretchTable so rebuildTableFromChunkMask
    // can hide static table parts without stretchTable re-enabling them.
    if (customMapData) {
      console.log('🗺️ Applying custom map to 1v1 match...');
      this.applyCustomMapToField(customMapData);
    }
    if (window.gfx && typeof gfx.recreateMountains === 'function') {
      gfx.recreateMountains();
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
      window.gfx.camera.beta = 1.1;
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
    
    // Prepare player arrays (gameBuildings used for all buildings now)
    const players = [window.player, aiPlayer];
    
    // CRITICAL: Clear player units arrays BEFORE spawning
    window.player.units = [];
    window.player.buildings = [];
    aiPlayer.units = [];
    aiPlayer.buildings = [];
    
    console.log(`🎮 Players prepared: ${players.length} players`, players.map(p => `${p.name}:${p.units?.length || 0}units`));
    
    window.gameBuildings = window.gameBuildings || [];
    window.gameUnits = window.gameUnits || [];
    
    console.log(`📊 Before spawn: gameUnits=${window.gameUnits.length}, gameBuildings=${window.gameBuildings.length}`);
    
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
    
    // Ensure unit models are spawned for visual layer
    if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
      window.spawnUnitModels(window.gfx.scene);
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
    
    // Announce 'in_game' status to global stats channel
    this.announceStatusToGlobal('in_game');
    
    // Clear any selections from menu scene
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
    }
    
    // Start physics/game loop
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // Hide lobby/menu UI and refresh HUD
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    if (window.hud && window.hud.updateResources) {
      window.hud.updateResources();
    }
    
    delete window.pendingMapSeed;
  },
  
  // Legacy startMatch function - redirects to proper initialization
  startMatch: function(matchType = '1v1', fieldSize = 'medium', mapSeed = null, customMapData = null) {
    console.log(`🔄 Redirecting legacy startMatch to proper initialization...`);
    if (matchType === '1v1' || matchType === 'onevsone') {
      return this.start1v1Match(fieldSize, mapSeed, customMapData);
    } else {
      console.warn(`⚠️ Unknown match type: ${matchType}`);
    }
  },
  
  // Initialize the lobby system
  init: function() {
    // console.log('🏛️ Lobby system initialized');
    
    // Load house maps
    this.loadHouseMaps();
    
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
      // Check if we're in offline mode
      if (window.net && window.net.offlineMode) {
        // console.log(`🔌 Offline mode - skipping broadcast channel: ${channelName}`);
        resolve(); // Resolve immediately in offline mode
        return;
      }
      
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
        // Silently resolve instead of rejecting - allows offline play
        // console.log(`🔌 P2P not available for ${channelName} (offline mode)`);
        resolve();
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
        // Respond with our current status (including 'in_game' if match is active)
        const currentStatus = window.currentMatch ? 'in_game' : 
                             (this.currentLobbyId ? 'in_lobby' : 
                             (this.currentGameType ? 'browsing' : 'menu'));
        this.announceStatusToGlobal(currentStatus);
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
    // Adventure lobby buttons are handled via onclick in HTML
    // (startAdventureChapter for solo, hostAdventureLobby for co-op)
    // Don't add duplicate event listeners here
    
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
    
    // For adventure mode, use the standard lobby discovery but with custom UI
    if (gameType === 'adventure') {
      console.log('🔌 Adventure mode - initializing chapter select and lobby search');
      // Set up chapter select handler
      this.initAdventureChapterSelect();
      
      // Use standard lobby discovery (same as 1v1, teams, etc.)
      // Initialize network if needed
      if (!window.net || !window.net.initialized) {
        const isLocalhost = window.location.hostname === 'localhost' || 
                           window.location.hostname === '127.0.0.1';
        window.net = window.net || {};
        if (window.net.init) {
          window.net.init({ 
            gameType: 'adventure',
            devMode: isLocalhost,
            lobbyBrowserMode: true,
            broadcastChannel: 'adventure-lobby-browser'
          });
        }
      }
      
      // Wait for channel then start discovery
      this.waitForBroadcastChannel('adventure-lobby-browser', 5000).then(() => {
        console.log('📡 Connected to adventure-lobby-browser channel');
        this.startLobbyDiscovery('adventure');
        this.flushPendingBroadcasts();
      }).catch(err => {
        console.error('Failed to join adventure lobby browser:', err);
      });
      
      return;
    }
    
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
    
    const finalSettings = settings || {
      fieldSize: config.defaultFieldSize,
      seed: Math.floor(Math.random() * 1000000)
    };
    
    const lobby = {
      id: lobbyId,
      name: lobbyName || `${config.name} Lobby`,
      gameType: gameType,
      host: window.net.getStatus().localPlayerId,
      hostName: window.currentPlayerName || window.player?.name || 'Host',
      hostColor: window.currentPlayerColor || window.player?.color || '#ffffff',
      players: 1,
      maxPlayers: finalSettings.maxPlayers || config.maxPlayers,
      settings: finalSettings,
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
    this.updateLobbyRoomUI(gameType, lobby, true);
    
    // Announce status change to global stats
    this.announceStatusToGlobal('in_lobby');
    
    // Set up periodic lobby announcements (every 5 seconds) so other browsers can discover it
    if (this.lobbyUpdateInterval) {
      clearInterval(this.lobbyUpdateInterval);
    }
    this.lobbyUpdateInterval = setInterval(() => {
      if (this.isHost && this.currentLobby) {
        // Re-announce lobby to game-specific channel for discovery
        this.announceLobby(this.currentLobby);
        // Re-announce status to global stats channel
        this.announceStatusToGlobal('in_lobby');
      }
    }, 5000);
    
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
    this.hasAnnouncedPresence = false;
    
    // Join the actual P2P match lobby
    const actualLobbyKey = `${config.lobbyKey}-${lobbyId}`;
    const myId = window.net ? window.net.getStatus().localPlayerId : 'unknown';
    // console.log(`🔗 [${myId}] Switching to match lobby: ${actualLobbyKey}`);
    if (window.net.switchLobby) {
      window.net.switchLobby(actualLobbyKey);
    } else {
      console.error('❌ net.switchLobby not available!');
      return;
    }
    
    // Update UI to show lobby room immediately
    this.updateLobbyRoomUI(gameType, this.currentLobby, true);
    
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
        // console.log(`✅ [${myId}] Connected to ${status.peers.length} peer(s)`);
        
        // Deduplicate peer IDs (sometimes P2P library returns duplicates)
        const uniquePeers = [...new Set(status.peers)];
        
        // Update connected players list - merge with existing player info
        const existingPlayerMap = new Map();
        const normalizePeerIdFn = this.normalizePeerId.bind(this);
        this.connectedPlayers.forEach(p => {
          const id = p.id || p;
          const normalizedId = normalizePeerIdFn(id);
          if (normalizedId) {
            existingPlayerMap.set(normalizedId, p);
          }
        });
        
        this.connectedPlayers = uniquePeers.map(peerId => {
          // If we already have player info for this peer, use it
          const normalizedId = normalizePeerIdFn(peerId);
          const existing = normalizedId ? existingPlayerMap.get(normalizedId) : null;
          if (existing) {
            // Preserve existing metadata (name/color) but update ID
            return { ...existing, id: peerId };
          }
          return peerId;
        });
        
        // Update lobby UI with connected peers
        if (this.currentLobby) {
          this.updateLobbyRoomUI(gameType, this.currentLobby);
        }
        
        if (!this.hasAnnouncedPresence) {
          this.sendPlayerPresence();
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
          let statusDiv = lobbyElement.querySelector('.lobby_connection_status');
          if (!statusDiv) {
            const roomContainer = lobbyElement.querySelector('.lobby_room');
            if (roomContainer) {
              statusDiv = document.createElement('div');
              statusDiv.className = 'lobby_connection_status';
              const header = roomContainer.querySelector('.lobby_room_header');
              if (header && header.nextSibling) {
                roomContainer.insertBefore(statusDiv, header.nextSibling);
              } else {
                roomContainer.insertBefore(statusDiv, roomContainer.firstChild);
              }
            }
          }
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
    
    // console.log(`🚪 Joining lobby: ${lobby.name}`);
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
        // Also update adventure inline list if applicable
        if (gameType === 'adventure') {
          this.updateAdventureLobbyList();
        }
        
        // If this is the lobby we're currently in, update our local copy and UI
        if (actualMessage.lobby.id === this.currentLobbyId) {
          // console.log(`🔄 Received updated lobby settings from host:`, actualMessage.lobby.settings);
          this.currentLobby = actualMessage.lobby;
          this.updateLobbyRoomUI(gameType, actualMessage.lobby);
        }
      }
      
      // Handle lobby list requests - respond if we're hosting
      if (actualMessage.type === 'lobby_list_request' && actualMessage.gameType === gameType) {
        if (this.isHost && this.currentLobbyId && this.currentGameType === gameType && this.currentLobby) {
          // console.log('📡 Responding to lobby list request');
          // Use currentLobby (our own lobby) not availableLobbies (other people's lobbies)
          setTimeout(() => {
            this.announceLobby(this.currentLobby);
          }, Math.random() * 100);
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
    
    // Request lobby list immediately
    const requestLobbies = () => {
      if (window.net && window.net.broadcast) {
        window.net.broadcast({
          type: 'lobby_list_request',
          gameType: gameType
        }, `${gameType}-lobby-browser`);
      }
    };
    
    // Send immediate request
    requestLobbies();
    
    // Send follow-up requests quickly for faster discovery (at 200ms and 500ms)
    setTimeout(requestLobbies, 200);
    setTimeout(requestLobbies, 500);
    
    // Update UI periodically and request lobbies periodically
    this.lobbyDiscoveryInterval = setInterval(() => {
      this.cleanupStaleLobbies(gameType);
      this.updateLobbyBrowserUI(gameType);
      // Periodically request lobbies so we catch any that were created before we joined
      requestLobbies();
    }, 5000);
  },
  
  // Announce lobby to broadcast channel
  announceLobby: function(lobby) {
    const channelName = `${lobby.gameType}-lobby-browser`;
    
    // Update player count
    lobby.players = 1 + this.connectedPlayers.length;
    lobby.timestamp = Date.now();
    
    // Extend timeout when players join - add 20 minutes per player (up to 2 hours max)
    // This keeps active lobbies alive longer
    const baseTimeout = 1200000; // 20 minutes base
    const perPlayerBonus = 1200000; // 20 minutes per player
    const maxTimeout = 7200000; // 2 hours max
    lobby.timeoutDuration = Math.min(baseTimeout + (lobby.players * perPlayerBonus), maxTimeout);
    
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
      // Never timeout if there are players in the lobby (players > 1 means host + at least one other)
      if (lobby.players > 1) {
        return true;
      }
      // Use dynamic timeout based on player count (extends when players join)
      // Default to 20 minutes if timeoutDuration not set (for old lobbies)
      const timeout = lobby.timeoutDuration || 1200000;
      return (now - lobby.timestamp) < timeout;
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
    } else if (this.currentLobbyId) {
      const myId = window.net && window.net.getStatus ? window.net.getStatus().localPlayerId : null;
      if (myId) {
        this.notifyPeersPlayerLeft(myId);
      }
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
    this.hasAnnouncedPresence = false;
    
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
    this.syncConnectedPlayersFromPeerIds(netStatus.peers || []);
    this.isHost = netStatus.isHost || false;
    
    // Update the lobby UI with current player list
    this.updateLobbyUI(gameType);
    
    // Update main menu stats
    this.updateMainMenuStats();
  },
  
  // Extract base lobby name (remove size/seed suffix if present)
  extractBaseLobbyName: function(lobbyName) {
    // Remove pattern like [M#1234] from the end
    return lobbyName.replace(/\s*\[[A-Z]#\d+\]\s*$/, '').trim();
  },
  
  // Format lobby name with size/seed info
  formatLobbyNameWithInfo: function(baseName, fieldSize, seed) {
    const sizeMap = { tiny: 'T', small: 'S', medium: 'M', large: 'L', huge: 'H' };
    const sizeAcronym = sizeMap[fieldSize] || fieldSize.charAt(0).toUpperCase();
    const seedShort = seed ? `#${seed.toString().slice(-4)}` : '';
    return `${baseName} [${sizeAcronym}${seedShort}]`;
  },
  
  // Update lobby browser UI (shows list of lobbies)
  updateLobbyBrowserUI: function(gameType) {
    // Adventure mode has its own custom UI - don't overwrite it
    if (gameType === 'adventure') return;
    
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
        <button class="create_lobby_btn" onclick="window.Lobby.showCreateLobbyDialog('${gameType}')">+ Create Lobby</button>
      </div>
      <div class="lobby_list">`;
    
    if (lobbies.length === 0) {
      // Check if we're still in the initial search phase (first 3 seconds)
      const searchStartTime = this.lobbySearchStartTime[gameType];
      const isSearching = searchStartTime && (Date.now() - searchStartTime < 3000);
      
      // Get last known lobby count from main menu stats
      const lastKnownCount = this.lastKnownLobbyCounts[gameType] || 0;
      const countDisplay = lastKnownCount > 0 ? ` (${lastKnownCount})` : '';
      
      if (isSearching) {
        html += `<div class="no_lobbies">🔍 Searching for${countDisplay} lobbies...</div>`;
      } else {
        html += `<div class="no_lobbies">No lobbies available. Create one!</div>`;
      }
    } else {
      lobbies.forEach(lobby => {
        const isFull = lobby.players >= lobby.maxPlayers;
        const hostName = lobby.hostName || 'Host';
        const hostColor = lobby.hostColor || '#ffffff';
        html += `
          <div class="lobby_item ${isFull ? 'lobby_full' : ''}">
            <div class="lobby_item_name"><span style="color: ${hostColor};">${hostName}</span>: ${lobby.name}</div>
            <div class="lobby_item_bottom">
              <div class="lobby_item_info">
                <span>👥 ${lobby.players}/${lobby.maxPlayers}</span>
                <span>🗺️ ${lobby.settings.fieldSize}</span>
                <span>🎲 #${lobby.settings.seed}</span>
              </div>
              ${!isFull ? `<button class="join_lobby_btn" onclick="window.Lobby.joinLobbyById('${gameType}', '${lobby.id}')">Join</button>` : '<span class="lobby_full_tag">Full</span>'}
            </div>
          </div>`;
      });
    }
    
    html += `</div>`;
    
    browserContainer.innerHTML = html;
  },
  
  // Update lobby room UI (inside a specific lobby)
  updateLobbyRoomUI: function(gameType, lobby, scrollToTop = false) {
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
      roomContainer.style.paddingTop = '0';
      roomContainer.style.marginTop = '0';
      lobbyElement.appendChild(roomContainer);
    } else {
      roomContainer.style.paddingTop = '0';
      roomContainer.style.marginTop = '0';
    }
    
    // Hide browser if it exists
    const browserContainer = lobbyElement.querySelector('.lobby_browser');
    if (browserContainer) browserContainer.style.display = 'none';
    
    // Hide the old lobby_b button if it exists
    const oldLobbyButton = lobbyElement.querySelector('.lobby_b');
    if (oldLobbyButton) oldLobbyButton.style.display = 'none';
    
    // For adventure mode: hide chapter view and hosting view, show room instead
    if (gameType === 'adventure') {
      const chapterView = document.getElementById('adventure_chapter_view');
      const hostingView = document.getElementById('adventure_hosting_view');
      if (chapterView) chapterView.style.display = 'none';
      if (hostingView) hostingView.style.display = 'none';
    }
    
    let html = `
      <div class="lobby_room_header">
        ${this.isHost ?
          `<input type="text" class="lobby_name_input" value="${lobby.name}" onchange="window.Lobby.updateLobbyName(this.value)" placeholder="Lobby name">` :
          `<h3>${lobby.name}</h3>`
        }
      </div>`;
    
    // Add start/ready buttons at the top (for host)
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
      
      // Count enabled AI slots (adventure is co-op vs environment, no AI opponents needed)
      const aiSlots = lobby.settings.aiSlots || [];
      const aiCount = aiSlots.filter(slot => slot).length;
      
      // Require at least one AI opponent when solo (totalPlayers < 2) for 1v1/teams, but NOT adventure
      const requiresAI = totalPlayers < 2 && (gameType === 'onevsone' || gameType === 'teams');
      const hasRequiredAI = !requiresAI || aiCount > 0;
      
      // Special case: solo 1v1/Teams with AI doesn't need to wait for players
      // Adventure can always start solo (it's co-op vs environment)
      const isSoloWithAI = totalPlayers < 2 && (gameType === 'onevsone' || gameType === 'teams') && aiCount > 0;
      const isAdventureSolo = gameType === 'adventure' && totalPlayers >= 1;
      // Adventure can start with any number of players (solo = 1, co-op = 2+)
      // Other game types need either AI or enough players who are ready
      const canStart = isAdventureSolo || isSoloWithAI || ((totalPlayers >= minPlayers && allConnected && allReady) && hasRequiredAI);
      
      let startBtnText = 'Game Start';
      let startBtnOnClick = `window.Lobby.startMatchFromLobby('${gameType}')`;
      
      // Adventure mode - always use startMatchFromLobby which will load the chapter
      if (gameType === 'adventure') {
        if (totalPlayers === 1) {
          startBtnText = '🎮 Start Solo';
        } else if (!allConnected) {
          startBtnText = 'Waiting for Connections...';
        } else if (!allReady) {
          startBtnText = 'Waiting for Ready...';
        } else {
          startBtnText = `🚀 Start Co-op (${totalPlayers} players)`;
        }
      } else if (gameType === 'onevsone' && totalPlayers < 2) {
        if (aiCount > 0) {
          startBtnText = '🚀 Start 1v1 vs AI';
        } else {
          startBtnText = 'Add AI Opponent to Start';
        }
      } else if (gameType === 'teams' && totalPlayers < 2) {
        if (aiCount > 0) {
          startBtnText = `🚀 Start Teams with ${aiCount} AI`;
        } else {
          startBtnText = 'Add AI Opponent to Start';
        }
      } else if (!allConnected) {
        startBtnText = 'Waiting for Connections...';
      } else if (!allReady) {
        startBtnText = `Waiting...`;
      } else if (canStart) {
        startBtnText = '🚀 Game Start';
      }
      
      html += `<button class="lobby_start_btn ${canStart ? 'ready' : 'disabled'}" onclick="${startBtnOnClick}" ${!canStart ? 'disabled' : ''}>${startBtnText}</button>`;
      
      // Debug log for host
      if (canStart) {
        // console.log(`✅ All players ready! Host can start match.`);
      }
    }
    
    html += `
      <div class="lobby_players_title">Players (${totalPlayers}/${lobby.maxPlayers})</div>
      <div class="lobby_players">`;
    
    // Get local player info
    const myName = window.currentPlayerName || window.player?.name || 'You';
    const myColor = window.currentPlayerColor || window.player?.color || '#ffffff';
    const myId = window.net ? window.net.getStatus().localPlayerId : null;
    const myReadyState = myId ? this.playerReadyStates[myId] : false;
    
    // Get host info from lobby
    const hostId = lobby.host || lobby.hostId;
    const hostName = lobby.hostName || 'Host';
    const hostColor = lobby.hostColor || '#ffffff';
    
    // Check if we're connected to host (for non-hosts)
    const isConnectedToHost = !this.isHost && this.connectedPlayers.length > 0 && 
                               this.connectedPlayers.some(p => this.playerConnectionStates[p.id || p] === 'connected');
    
    if (this.isHost) {
      // HOST VIEW: Show self first with HOST badge
      html += `
        <div class="lobby_player lobby_player_local">
          <span class="player_icon" style="color: ${myColor};">👑</span>
          <span class="player_name" style="color: ${myColor};">${myName} (Host)</span>
          <span class="host_badge">HOST</span>
        </div>`;
      
      // Then show connected players with ready status
      this.connectedPlayers.forEach((player, index) => {
        const playerId = player.id || player;
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
    } else {
      // JOINER VIEW: Show host first, then self, then others
      
      // 1. Show the host at the top
      const hostConnectionState = this.playerConnectionStates[hostId] || 'connecting';
      const hostConnectionIcon = hostConnectionState === 'connected' ? '🟢' : (hostConnectionState === 'connecting' ? '🟡' : '🔴');
      html += `
        <div class="lobby_player">
          <span class="player_icon" style="color: ${hostColor};">${hostConnectionIcon} 👑</span>
          <span class="player_name" style="color: ${hostColor};">${hostName} (Host)</span>
          <span class="host_badge">HOST</span>
        </div>`;
      
      // 2. Show self with ready checkbox
      html += `
        <div class="lobby_player lobby_player_local">
          <span class="player_icon" style="color: ${myColor};">👤</span>
          <span class="player_name" style="color: ${myColor};">${myName}</span>
          <label class="ready_checkbox" ${!isConnectedToHost ? 'title="Connecting to host..."' : ''}>
            <input type="checkbox" 
                   ${myReadyState ? 'checked' : ''} 
                   ${!isConnectedToHost ? 'disabled' : ''} 
                   onchange="window.Lobby.toggleReady(this.checked)"> 
            ${isConnectedToHost ? 'Ready' : 'Connecting...'}
          </label>
        </div>`;
      
      // 3. Show other connected players (excluding host - already shown)
      this.connectedPlayers.forEach((player, index) => {
        const playerId = player.id || player;
        // Skip the host - already shown
        if (playerId === hostId || this.normalizePeerId(playerId) === this.normalizePeerId(hostId)) {
          return;
        }
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
    }
    
    // Show empty slots (with AI options for compatible game types)
    // Adventure is co-op vs environment - no AI opponents needed
    const supportsAI = ['onevsone', 'teams'].includes(gameType);
    const aiSlots = lobby.settings.aiSlots || [];
    
    for (let i = totalPlayers; i < lobby.maxPlayers; i++) {
      const slotIndex = i;
      const isAISlot = supportsAI && aiSlots[slotIndex];
      
      if (supportsAI && this.isHost) {
        // Host can toggle AI slots
        html += `
          <div class="lobby_player lobby_player_empty ${isAISlot ? 'ai_enabled' : ''}">
            <span class="player_icon">${isAISlot ? '🤖' : '⚫'}</span>
            <span class="player_name">${isAISlot ? 'AI Opponent' : 'Empty'}</span>
            <label class="ai_toggle">
              <input type="checkbox" 
                     ${isAISlot ? 'checked' : ''} 
                     onchange="window.Lobby.toggleAISlot(${slotIndex}, this.checked)">
              AI
            </label>
          </div>`;
      } else if (isAISlot) {
        // Non-host sees AI slots but can't change them
        html += `
          <div class="lobby_player lobby_player_ai">
            <span class="player_icon">🤖</span>
            <span class="player_name">AI Opponent</span>
          </div>`;
      } else {
        // Regular empty slot
        html += `
          <div class="lobby_player lobby_player_empty">
            <span class="player_icon">⚫</span>
            <span class="player_name">Waiting...</span>
          </div>`;
      }
    }
    
    html += '</div>';
    
    // Settings section - Adventure just shows chapter name, other modes show full settings
    if (gameType === 'adventure') {
      // Adventure mode - just show the chapter name
      html += `
        <div class="lobby_room_settings">
          <div class="lobby_setting">
            <label>📜 Chapter:</label>
            <span style="color: #8f8;">${lobby.settings.chapterName || 'Unknown Chapter'}</span>
          </div>
        </div>
      `;
    } else {
      // Other game types - full settings
      html += `
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
          <div class="lobby_setting" style="margin-top: 8px;">
            <label>Map:</label>
            ${this.isHost ? `
              ${lobby.settings.customMapData ? `
                <span style="color: #8f8; margin-right: 8px;">🗺️ ${lobby.settings.customMapName || 'Custom'}</span>
                <button onclick="window.Lobby.clearCustomMap()" style="font-size: 11px; padding: 2px 8px;">✕ Clear</button>
              ` : `
                <button onclick="window.Lobby.showMapBrowser()" style="font-size: 12px; padding: 4px 10px;">🗺️ Browse Maps</button>
                <input type="file" id="customMapInput" accept=".garden,.json" style="display:none" onchange="window.Lobby.handleCustomMapUpload(this.files[0])">
                <button onclick="document.getElementById('customMapInput').click()" style="font-size: 12px; padding: 4px 10px; margin-left: 4px;">📂 Load File</button>
              `}
            ` : `
              ${lobby.settings.customMapData ? 
                `<span style="color: #8f8;">🗺️ ${lobby.settings.customMapName || 'Custom'}</span>` : 
                `<span style="opacity: 0.6;">Random</span>`
              }
            `}
          </div>
        </div>
      `;
    }
    
    // Add back button at the bottom
    html += `<button class="leave_lobby_btn" onclick="window.Lobby.leaveLobbyAndReturnToBrowser('${gameType}')">← Back</button>`;
    
    roomContainer.innerHTML = html;

    // Scroll to top when first joining/creating lobby, but not on settings updates
    if (scrollToTop && lobbyElement) {
      lobbyElement.scrollTop = 0;
    }
  },
  

  // Update lobby name (host only)
  updateLobbyName: function(newName) {
    if (!this.isHost || !this.currentLobby) return;

    // Trim whitespace and ensure not empty
    newName = newName.trim();
    if (!newName) {
      // Reset to a default name if empty
      newName = `Lobby ${Math.floor(Math.random() * 1000)}`;
    }

    // Update local lobby
    this.currentLobby.name = newName;
    this.currentLobby.timestamp = Date.now();

    // Broadcast the change to all players
    if (window.net && window.net.p2p) {
      window.net.p2p.sendData({
        type: 'lobby_name_update',
        name: newName
      });
    }

    // Announce updated lobby to lobby browser
    this.announceLobby(this.currentLobby);

    // Update local UI
    this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
  },

  // Toggle AI slot for a specific player slot
  toggleAISlot: function(slotIndex, enabled) {
    if (!this.isHost || !this.currentLobby) return;

    // Initialize aiSlots array if it doesn't exist
    if (!this.currentLobby.settings.aiSlots) {
      this.currentLobby.settings.aiSlots = [];
    }

    // Set the AI slot state
    this.currentLobby.settings.aiSlots[slotIndex] = enabled;

    // Broadcast the change to all players
    if (window.net && window.net.p2p) {
      window.net.p2p.sendData({
        type: 'lobby_settings_update',
        settings: this.currentLobby.settings
      });
    }

    // Update both player list and room UI (start button depends on AI count)
    this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
  },

  // Show notification to user
  showNotification: function(message, type = 'info') {
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
  },
  
  // Create lobby directly with auto-generated name (no annoying popup)
  showCreateLobbyDialog: function(gameType) {
    const config = this.gameTypes[gameType];
    const lobbyName = `Lobby ${Math.floor(Math.random() * 1000)}`;

    const settings = {
      fieldSize: config.defaultFieldSize,
      seed: Math.floor(Math.random() * 1000000),
      maxPlayers: config.maxPlayers,
      // Default AI configuration per game type
      aiSlots: gameType === 'adventure' ? [false, true, true, true] : [] // Adventure defaults to 3 AI
    };

    this.createLobby(gameType, lobbyName, settings);
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
    } else if (lobbyId && !wasHost) {
      const myId = window.net && window.net.getStatus ? window.net.getStatus().localPlayerId : null;
      if (myId) {
        this.notifyPeersPlayerLeft(myId);
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
    this.hasAnnouncedPresence = false;
    
    // Clear periodic lobby announcements
    if (this.lobbyUpdateInterval) {
      clearInterval(this.lobbyUpdateInterval);
      this.lobbyUpdateInterval = null;
    }
    
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
      
      // Restore old lobby_b button visibility
      const oldLobbyButton = lobbyElement.querySelector('.lobby_b');
      if (oldLobbyButton) oldLobbyButton.style.display = '';
      
      // For adventure mode, restore the chapter view
      if (gameType === 'adventure') {
        const chapterView = document.getElementById('adventure_chapter_view');
        const hostingView = document.getElementById('adventure_hosting_view');
        if (chapterView) chapterView.style.display = 'block';
        if (hostingView) hostingView.style.display = 'none';
        return; // Adventure uses chapter view, not browser
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
    // Skip if in offline mode
    if (window.net && window.net.offlineMode) {
      return;
    }
    
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
    
    // Update local UI
    this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
  },
  
  // House maps list (loaded from maps/index.json)
  houseMaps: [],
  
  // Load house maps from server
  loadHouseMaps: async function() {
    try {
      const response = await fetch('maps/index.json');
      const data = await response.json();
      this.houseMaps = data.maps || [];
      // console.log(`🗺️ Loaded ${this.houseMaps.length} house maps`);
    } catch (e) {
      console.log('📁 No house maps found (maps/index.json)');
      this.houseMaps = [];
    }
  },
  
  // Show map browser modal
  showMapBrowser: function() {
    // Remove existing browser if any
    const existing = document.getElementById('mapBrowserModal');
    if (existing) existing.remove();
    
    const modal = document.createElement('div');
    modal.id = 'mapBrowserModal';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85); z-index: 10000;
      display: flex; align-items: center; justify-content: center;
    `;
    
    let mapsHtml = '';
    
    // Random map option
    mapsHtml += `
      <div class="map-card" onclick="window.Lobby.selectMap(null)" style="
        width: 120px; padding: 10px; margin: 8px; background: #2a2a3e; border-radius: 8px;
        cursor: pointer; text-align: center; border: 2px solid #444;
      ">
        <div style="width: 100px; height: 100px; margin: 0 auto 8px; background: linear-gradient(135deg, #4a7c59, #2d4a6f, #8b7355);
          border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 32px;">
          🎲
        </div>
        <div style="color: #fff; font-size: 12px;">Random</div>
      </div>
    `;
    
    // House maps
    this.houseMaps.forEach((map, i) => {
      const thumb = map.thumbnail ? `data:image/bmp;base64,${map.thumbnail}` : '';
      mapsHtml += `
        <div class="map-card" onclick="window.Lobby.selectHouseMap(${i})" style="
          width: 140px; padding: 10px; margin: 8px; background: #2a2a3e; border-radius: 8px;
          cursor: pointer; text-align: center; border: 2px solid #444; transition: border-color 0.2s;
        " onmouseover="this.style.borderColor='#6a6'" onmouseout="this.style.borderColor='#444'">
          <div style="width: 100px; height: 100px; margin: 0 auto 8px; background: #1a1a2e;
            border-radius: 4px; overflow: hidden;">
            ${thumb ? `<img src="${thumb}" style="width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated;">` : 
              `<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666;">🗺️</div>`}
          </div>
          <div style="color: #fff; font-size: 12px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${map.name || `Map ${i + 1}`}
          </div>
          ${map.author ? `<div style="color: #8af; font-size: 9px;">by ${map.author}</div>` : ''}
          <div style="color: #888; font-size: 10px;">${map.width || '?'}x${map.height || '?'} · ${map.players || '?'} players</div>
          ${map.description ? `<div style="color: #aaa; font-size: 9px; margin-top: 4px; line-height: 1.2; max-height: 28px; overflow: hidden;">${map.description}</div>` : ''}
        </div>
      `;
    });
    
    if (this.houseMaps.length === 0) {
      mapsHtml += `
        <div style="color: #888; padding: 20px; text-align: center; width: 100%;">
          No house maps yet.<br>
          Create maps in Forge and save them to the maps/ folder!
        </div>
      `;
    }
    
    modal.innerHTML = `
      <div style="background: #1a1a2e; padding: 24px; border-radius: 12px; max-width: 600px; max-height: 80vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="margin: 0; color: #fff;">🗺️ Select Map</h2>
          <button onclick="document.getElementById('mapBrowserModal').remove()" 
            style="background: none; border: none; color: #888; font-size: 24px; cursor: pointer;">✕</button>
        </div>
        <div style="display: flex; flex-wrap: wrap; justify-content: center;">
          ${mapsHtml}
        </div>
        <div style="text-align: center; margin-top: 16px; padding-top: 16px; border-top: 1px solid #333;">
          <button onclick="document.getElementById('customMapInput').click(); document.getElementById('mapBrowserModal').remove();"
            style="padding: 8px 16px; font-size: 14px; cursor: pointer;">
            📂 Load from File...
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  },
  
  // Select random map (clear custom)
  selectMap: function(mapData) {
    document.getElementById('mapBrowserModal')?.remove();
    
    if (!mapData) {
      this.clearCustomMap();
      return;
    }
  },
  
  // Select a house map by index
  selectHouseMap: async function(index) {
    document.getElementById('mapBrowserModal')?.remove();
    
    const mapInfo = this.houseMaps[index];
    if (!mapInfo || !mapInfo.file) {
      console.error('Invalid map selection');
      return;
    }
    
    try {
      const response = await fetch(`maps/${mapInfo.file}`);
      const content = await response.text();
      const mapData = JSON.parse(content);
      
      // Apply to lobby
      this.currentLobby.settings.customMapData = mapData;
      this.currentLobby.settings.customMapName = mapInfo.name || mapInfo.file;
      
      // Override field size
      const mapWidth = mapData.w || mapData.width;
      if (mapWidth <= 32) this.currentLobby.settings.fieldSize = 'tiny';
      else if (mapWidth <= 64) this.currentLobby.settings.fieldSize = 'small';
      else if (mapWidth <= 128) this.currentLobby.settings.fieldSize = 'medium';
      else if (mapWidth <= 256) this.currentLobby.settings.fieldSize = 'large';
      else this.currentLobby.settings.fieldSize = 'huge';
      
      if (mapData.s || mapData.seed) {
        this.currentLobby.settings.seed = mapData.s || mapData.seed;
      }
      
      this.announceLobby(this.currentLobby);
      this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
      
      console.log(`🗺️ Selected house map: ${mapInfo.name}`);
    } catch (e) {
      console.error('Failed to load house map:', e);
    }
  },
  
  // Handle custom map file upload
  handleCustomMapUpload: function(file) {
    if (!file || !this.isHost) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let content = e.target.result;
        const mapData = JSON.parse(content);
        
        // Validate it looks like a valid map
        if (!mapData.w && !mapData.width) {
          throw new Error('Invalid map format - missing dimensions');
        }
        
        // Extract map name from filename
        const mapName = file.name.replace(/\.(aeg|json)$/i, '');
        
        // Store in lobby settings
        this.currentLobby.settings.customMapData = mapData;
        this.currentLobby.settings.customMapName = mapName;
        
        // Override field size based on map dimensions
        const mapWidth = mapData.w || mapData.width;
        if (mapWidth <= 32) this.currentLobby.settings.fieldSize = 'tiny';
        else if (mapWidth <= 64) this.currentLobby.settings.fieldSize = 'small';
        else if (mapWidth <= 128) this.currentLobby.settings.fieldSize = 'medium';
        else if (mapWidth <= 256) this.currentLobby.settings.fieldSize = 'large';
        else this.currentLobby.settings.fieldSize = 'huge';
        
        // Use map seed if available
        if (mapData.s || mapData.seed) {
          this.currentLobby.settings.seed = mapData.s || mapData.seed;
        }
        
        console.log(`🗺️ Loaded custom map: ${mapName} (${mapWidth}x${mapData.h || mapData.height})`);
        
        // Broadcast to other players
        this.announceLobby(this.currentLobby);
        this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
        
        this.showNotification(`Map loaded: ${mapName}`, 'success');
      } catch (err) {
        console.error('❌ Failed to load custom map:', err);
        this.showNotification('Failed to load map file', 'error');
      }
    };
    reader.readAsText(file);
  },
  
  // Clear the custom map and return to procedural generation
  clearCustomMap: function() {
    if (!this.isHost || !this.currentLobby) return;
    
    delete this.currentLobby.settings.customMapData;
    delete this.currentLobby.settings.customMapName;
    
    console.log('🗺️ Custom map cleared - returning to procedural generation');
    
    // Broadcast to other players
    this.announceLobby(this.currentLobby);
    this.updateLobbyRoomUI(this.currentGameType, this.currentLobby);
  },
  
  // Apply custom map data to the current field
  applyCustomMapToField: function(mapData) {
    const field = window.liveField;
    if (!field || !mapData) return false;
    
    console.log('🗺️ Applying custom map to field...');
    
    // Detect format version and normalize
    const isV2 = mapData.v === 2;
    const width = isV2 ? mapData.w : mapData.width;
    const height = isV2 ? mapData.h : mapData.height;
    
    // Decode terrain types
    let terrainTypes;
    if (isV2 && mapData.t) {
      // RLE decode
      terrainTypes = [];
      const runs = mapData.t.split(',');
      for (const run of runs) {
        const [val, count] = run.split(':').map(Number);
        for (let i = 0; i < count; i++) terrainTypes.push(val);
      }
    } else if (mapData.terrainTypes) {
      terrainTypes = mapData.terrainTypes;
    }
    
    // Decode tile atlas info
    let tiles = null;
    if (isV2 && mapData.ta) {
      const atlasMap = { 'gd': 'atlas-grass-dirt', 'gw': 'atlas-grass-water' };
      tiles = [];
      const runs = mapData.ta.split(',');
      for (const run of runs) {
        let code, count;
        if (run.includes('*')) {
          [code, count] = run.split('*');
          count = parseInt(count);
        } else {
          code = run;
          count = 1;
        }
        const atlas = atlasMap[code.slice(0, 2)] || 'atlas-grass-dirt';
        const type = parseInt(code.slice(2));
        for (let i = 0; i < count; i++) {
          tiles.push({ atlasName: atlas, type: type });
        }
      }
    } else if (mapData.tiles) {
      tiles = mapData.tiles;
    }
    
    // Apply terrain types
    if (terrainTypes && terrainTypes.length === field.terrainTypes.length) {
      for (let i = 0; i < terrainTypes.length; i++) {
        field.terrainTypes[i] = terrainTypes[i];
      }
    }
    
    // Apply tile data
    if (tiles && tiles.length === field.tiles.length) {
      for (let i = 0; i < tiles.length; i++) {
        field.tiles[i].type = tiles[i].type;
        field.tiles[i].atlasName = tiles[i].atlasName || 'atlas-grass-dirt';
        field.tiles[i].updateAtlasCoordinates();
      }
    }
    
    // Apply chunk mask if present
    let hasCustomShape = false;
    if (isV2 && mapData.cm) {
      const chunksX = Math.ceil(width / (mapData.cs || 16));
      const chunksZ = Math.ceil(height / (mapData.cs || 16));
      const expectedLen = chunksX * chunksZ;
      // Pad truncated masks with '0' (disable missing chunks rather than leaving them undefined)
      const cm = mapData.cm.length < expectedLen
        ? mapData.cm.padEnd(expectedLen, '0')
        : mapData.cm;
      let i = 0;
      for (let cz = 0; cz < chunksZ; cz++) {
        for (let cx = 0; cx < chunksX; cx++) {
          const enabled = cm[i] === '1';
          field.chunkMask.set(`${cx},${cz}`, enabled);
          if (!enabled) hasCustomShape = true;
          i++;
        }
      }
    }
    
    // Rebuild table if map has custom shape (non-rectangular)
    if (hasCustomShape && window.gfx && window.gfx.rebuildTableFromChunkMask) {
      window.gfx.rebuildTableFromChunkMask();
      
      // Also hide terrain meshes for disabled chunks
      for (const [key, chunk] of field.chunks) {
        if (chunk && chunk.mesh) {
          const enabled = field.chunkMask.get(key) !== false;
          chunk.mesh.setEnabled(enabled);
          chunk.mesh.isVisible = enabled;
        }
      }
    }
    
    // Update blocked tiles
    if (field.updateBlockedTiles) {
      field.blockedTiles.clear();
      field.slowTiles.clear();
      field.updateBlockedTiles();
    }
    
    // Apply time of day if specified
    if (mapData.tod !== undefined && window.lighting && window.lighting.setSunTime) {
      window.lighting.setSunTime(mapData.tod);
      console.log(`🌅 Applied map time of day: ${mapData.tod}`);
    }
    
    // Handle "no auto resources" flag - skip all deterministic resource sprinkling
    if (isV2 && mapData.nar) {
      field.noAutoResources = true;
      console.log('🚫 Map has no-auto-resources flag set, skipping resource generation');
    }
    
    // Mark erased auto-resources as depleted (so they won't be auto-generated)
    if (isV2 && mapData.er && window.markResourceTileDepleted) {
      const erasedKeys = mapData.er.split(';');
      for (const key of erasedKeys) {
        const [x, z] = key.split(',').map(Number);
        if (!isNaN(x) && !isNaN(z)) {
          window.markResourceTileDepleted(x, z);
        }
      }
      console.log(`🗑️ Marked ${erasedKeys.length} erased resource tiles`);
    }
    
    // Place manually added resources from forge
    if (isV2 && mapData.r && window.placeManualResource) {
      const resources = mapData.r.split(';');
      for (const res of resources) {
        const [key, type] = res.split(':');
        const [x, z] = key.split(',').map(Number);
        if (!isNaN(x) && !isNaN(z) && type) {
          window.placeManualResource(x, z, type);
        }
      }
      console.log(`🌲 Placed ${resources.length} manual resources`);
    }
    
    // Place pre-placed buildings from forge (excluding agoras which are handled by spawn system)
    if (isV2 && mapData.bld && window.placeBuilding && window.gfx && window.gfx.scene) {
      const buildings = mapData.bld.split(';');
      let placedCount = 0;
      for (const bld of buildings) {
        const parts = bld.split(',');
        const x = Number(parts[0]);
        const z = Number(parts[1]);
        const type = parts[2];
        const rotation = Number(parts[3]) || 0;
        
        // Skip agoras - they're placed by the spawn system
        if (type === 'agora') continue;
        
        if (!isNaN(x) && !isNaN(z) && type) {
          const building = window.placeBuilding(type, x, z, window.gfx.scene, {
            rotation: rotation,
            buildProgress: 1.0,  // Pre-placed buildings start complete
            isNeutral: true      // Mark as neutral (not owned by player)
          });
          if (building) placedCount++;
        }
      }
      if (placedCount > 0) {
        console.log(`🏗️ Placed ${placedCount} pre-placed buildings`);
      }
    }
    
    // Store objectives for adventure mode victory checking
    if (isV2 && mapData.obj) {
      const objectives = mapData.obj.split(';').map((o, i) => {
        const parts = o.split(',');
        // Decode message from base64 if present
        let message = '';
        if (parts[4]) {
          try {
            message = decodeURIComponent(atob(parts[4]));
          } catch (e) {
            console.warn('Failed to decode objective message:', e);
          }
        }
        return {
          x: Number(parts[0]),
          y: Number(parts[1]),
          radius: Number(parts[2]) || 4,
          type: parts[3] || 'reach',
          message: message, // Story/dialogue text to show when triggered
          id: i,
          completed: false
        };
      });
      window.adventureObjectives = objectives;
      console.log(`🎯 Loaded ${objectives.length} objectives for adventure mode`);
    } else {
      window.adventureObjectives = [];
    }
    
    // Store scenes for cinematic playback
    if (isV2 && mapData.sc) {
      try {
        window.adventureScenes = JSON.parse(decodeURIComponent(atob(mapData.sc)));
        console.log(`🎬 Loaded ${window.adventureScenes.length} scenes`);
      } catch (e) {
        console.warn('Failed to decode scenes:', e);
        window.adventureScenes = [];
      }
    } else {
      window.adventureScenes = [];
    }

    // Store starting units for adventure mode (units placed in forge)
    if (isV2 && mapData.units) {
      const units = mapData.units.split(';').map((u, index) => {
        const parts = u.split(',');
        let name = '';
        if (parts[4]) {
          try { name = decodeURIComponent(atob(parts[4])); } catch (e) { /* ignore */ }
        }
        return {
          x: Number(parts[0]),
          y: Number(parts[1]),
          type: parts[2] || 'villager',
          player: Number(parts[3]) || 0,
          name: name || '',
          spawnIndex: index
        };
      });
      window.adventureStartingUnits = units;
      console.log(`⚔️ Loaded ${units.length} starting units for adventure mode`);
    } else {
      window.adventureStartingUnits = [];
    }
    
    console.log(`✅ Custom map applied (${width}x${height})${hasCustomShape ? ' with custom table shape' : ''}`);
    return true;
  },
  
  // Start match from lobby (host only)
  startMatchFromLobby: async function(gameType) {
    if (!this.isHost) {
      console.warn('⚠️ Only host can start the match!');
      return;
    }
    
    // Use currentGameType if gameType not provided or doesn't match
    const actualGameType = gameType || this.currentGameType;
    
    // Try to use currentLobby first (most reliable)
    let lobby = this.currentLobby;
    
    // If currentLobby doesn't exist or doesn't match, try to find it in availableLobbies
    if (!lobby || (this.currentLobbyId && lobby.id !== this.currentLobbyId)) {
      lobby = this.availableLobbies[actualGameType]?.find(l => l.id === this.currentLobbyId);
    }
    
    // If still not found, try any lobby in the gameType
    if (!lobby && this.availableLobbies[actualGameType]?.length > 0) {
      lobby = this.availableLobbies[actualGameType][0];
      console.warn('⚠️ Using first available lobby for gameType:', actualGameType);
    }
    
    if (!lobby) {
      console.error('❌ Lobby not found!', {
        gameType: actualGameType,
        currentGameType: this.currentGameType,
        currentLobbyId: this.currentLobbyId,
        hasCurrentLobby: !!this.currentLobby,
        availableLobbies: Object.keys(this.availableLobbies || {}),
        lobbiesForType: this.availableLobbies[actualGameType]?.length || 0
      });
      return;
    }
    
    // Adventure mode: load chapter map before starting
    if (actualGameType === 'adventure' && lobby.settings.chapterFile) {
      console.log(`📜 Loading adventure chapter: ${lobby.settings.chapterName}`);
      try {
        const response = await fetch(lobby.settings.chapterFile);
        if (!response.ok) throw new Error(`Failed to load chapter: ${response.status}`);
        const mapData = await response.json();
        
        // Store the loaded map data in settings for the match
        lobby.settings.customMapData = mapData;
        lobby.settings.customMapName = lobby.settings.chapterName;
        console.log(`✅ Chapter loaded: ${mapData.n || lobby.settings.chapterName}`);
      } catch (error) {
        console.error('❌ Failed to load chapter:', error);
        this.showNotification('Failed to load chapter map!', 'error');
        return;
      }
    }
    
    // console.log('🚀 Host initiating match start...');
    
    // CRITICAL: Generate host's player ID NOW so we can include it in the message
    // This ensures the peer uses the same ID for ownership matching
    if (!window.player) {
      window.player = new Player();
    }
    if (!window.player.id || window.player.id === 'demo' || window.player.id === 'undefined') {
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      window.player.id = `adventurer-${randomSuffix}`;
    }
    
    // Send start game message to all peers via WebRTC
    // Include ALL player IDs so everyone uses consistent IDs
    // Build the player ID list: host first, then peers in order
    const playerIds = [window.player.id];
    this.connectedPlayers.forEach(p => {
      // Use the P2P ID for peers (normalized to 6 chars for ownership)
      const peerId = p.id || p;
      playerIds.push(peerId);
    });
    const playersMeta = playerIds.map((id, index) => {
      const normalizedId = this.normalizePeerId(id);
      if (normalizedId === this.normalizePeerId(window.player.id)) {
        return {
          id,
          name: window.currentPlayerName || window.player?.name || (index === 0 ? 'Host' : `Player ${index + 1}`),
          color: window.currentPlayerColor || window.player?.color || this.getPlayerColor(index).primary
        };
      }
      const peerMeta = this.connectedPlayers.find(p => this.normalizePeerId(p?.id || p) === normalizedId);
      return {
        id,
        name: peerMeta?.name || (index === 0 ? 'Host' : `Player ${index + 1}`),
        color: peerMeta?.color || this.getPlayerColor(index).primary
      };
    });
    
    if (window.net && window.net.p2p && window.net.p2p.sendData) {
      const startMessage = {
        type: 'start_game',
        gameType: actualGameType,
        settings: lobby.settings,
        hostPlayerId: window.player.id,  // Host's actual player ID
        playerIds: playerIds,  // CRITICAL: All player IDs in order
        playersMeta: playersMeta,
        timestamp: Date.now()
      };
      
      window.net.p2p.sendData(startMessage); // Broadcast to all peers
    }

    // Use the exact same player ordering locally as the one broadcast to peers.
    this._hostPlayerId = window.player.id;
    this._playerIds = playerIds.slice();
    this._playersMeta = playersMeta.map(meta => ({ ...meta }));
    
    // Start the match for host
    this.startMultiplayerMatchWithSettings(actualGameType, lobby.settings);
  },
  
  // Start multiplayer match with specific settings
  startMultiplayerMatchWithSettings: async function(gameType, settings) {
    const config = this.gameTypes[gameType];
    const fieldSize = settings.fieldSize || config.defaultFieldSize;
    
    // console.log(`🎮 Starting ${config.name} match with settings:`, settings);
    // console.log(`🌱 Map seed: ${settings.seed}`);
    // console.log(`🗺️ Field size: ${fieldSize}`);
    
    // For adventure mode, joiners need to load the chapter file if not already loaded
    if (gameType === 'adventure' && settings.chapterFile && !settings.customMapData) {
      console.log(`📜 Joiner loading adventure chapter: ${settings.chapterName}`);
      try {
        const response = await fetch(settings.chapterFile);
        if (!response.ok) throw new Error(`Failed to load chapter: ${response.status}`);
        settings.customMapData = await response.json();
        settings.customMapName = settings.chapterName;
        console.log(`✅ Chapter loaded by joiner: ${settings.customMapData.n || settings.chapterName}`);
      } catch (error) {
        console.error('❌ Joiner failed to load chapter:', error);
        this.showNotification('Failed to load chapter map!', 'error');
        return;
      }
    }
    
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
    
    // Store lobby counts for use in lobby browser
    Object.keys(stats).forEach(gameType => {
      this.lastKnownLobbyCounts[gameType] = stats[gameType].lobbies.size;
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

  // Adventure chapter metadata
  adventureChapters: {
    chapter1: { file: 'maps/adventure/chapter1.garden', name: 'Chapter 1 - The Beginning' },
    chapter2: { file: 'maps/adventure/chapter2.garden', name: 'Chapter 2 - Into the Wild' }
  },
  
  // Chapter info cache
  _chapterInfoCache: {},
  
  // Initialize chapter select UI
  initAdventureChapterSelect: function() {
    const select = document.getElementById('adventure_chapter_select');
    if (!select) return;
    
    // Load chapter info on change
    select.addEventListener('change', () => {
      this.loadChapterInfo(select.value);
    });
    
    // Load initial chapter info
    this.loadChapterInfo(select.value);
  },
  
  // Load and display chapter info
  loadChapterInfo: async function(chapterId) {
    const infoDiv = document.getElementById('adventure_chapter_info');
    if (!infoDiv) return;
    
    const chapterMeta = this.adventureChapters[chapterId];
    if (!chapterMeta) {
      infoDiv.innerHTML = '<div style="opacity: 0.7;">Unknown chapter</div>';
      return;
    }
    
    // Check cache first
    if (this._chapterInfoCache[chapterId]) {
      this.displayChapterInfo(this._chapterInfoCache[chapterId]);
      return;
    }
    
    infoDiv.innerHTML = '<div style="opacity: 0.7;">Loading...</div>';
    
    try {
      const response = await fetch(chapterMeta.file);
      if (!response.ok) throw new Error('Failed to load');
      
      const mapData = JSON.parse(await response.text());
      this._chapterInfoCache[chapterId] = mapData;
      this.displayChapterInfo(mapData);
    } catch (e) {
      infoDiv.innerHTML = '<div style="opacity: 0.7; color: #f88;">Failed to load chapter info</div>';
    }
  },
  
  // Display chapter info in UI
  displayChapterInfo: function(mapData) {
    const infoDiv = document.getElementById('adventure_chapter_info');
    if (!infoDiv) return;
    
    const name = mapData.n || mapData.name || 'Unknown';
    const desc = mapData.desc || mapData.description || '';
    const lore = mapData.lore || '';
    const size = `${mapData.w || mapData.width}x${mapData.h || mapData.height}`;
    
    infoDiv.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">${name}</div>
      <div style="font-size: 12px; opacity: 0.8; margin-bottom: 5px;">${desc}</div>
      ${lore ? `<div style="font-size: 11px; font-style: italic; opacity: 0.6;">"${lore}"</div>` : ''}
      <div style="font-size: 11px; margin-top: 5px; opacity: 0.5;">Map: ${size}</div>
    `;
  },
  
  // Start adventure from chapter selection
  startAdventureChapter: async function() {
    const select = document.getElementById('adventure_chapter_select');
    const chapterId = select ? select.value : 'chapter1';
    const chapterInfo = this.adventureChapters[chapterId];
    
    if (!chapterInfo) {
      console.error('Unknown chapter:', chapterId);
      return;
    }
    
    console.log(`🗺️ Loading adventure chapter: ${chapterInfo.name}`);
    
    try {
      // Fetch the chapter map file
      const response = await fetch(chapterInfo.file);
      if (!response.ok) throw new Error(`Failed to load ${chapterInfo.file}`);
      
      const mapData = JSON.parse(await response.text());
      console.log('📦 Chapter map loaded:', mapData.n || chapterId);
      
      // Track current chapter for progression
      window.currentChapterId = chapterId;
      
      // Start adventure with the custom map
      this.startAdventureWithMap(mapData);
      
    } catch (e) {
      console.error('Failed to load chapter:', e);
      alert('Failed to load chapter. Please try again.');
    }
  },
  
  // Load a .garden map file directly into adventure mode
  loadAdventureMapFile: function(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const mapData = JSON.parse(e.target.result);
        if (!mapData.w && !mapData.width) {
          throw new Error('Invalid map format - missing dimensions');
        }
        const mapName = file.name.replace(/\.(garden|json)$/i, '');
        console.log(`🗺️ Loading adventure map: ${mapName}`);
        window.currentChapterId = null;
        this.startAdventureWithMap(mapData);
      } catch (err) {
        console.error('Failed to load map file:', err);
        alert('Failed to load map file: ' + err.message);
      }
    };
    reader.readAsText(file);
    // Reset the input so the same file can be re-selected
    document.getElementById('adventureMapInput').value = '';
  },

  // Load a specific adventure chapter by ID (used for chapter progression)
  loadAdventureChapter: async function(chapterId) {
    const chapterInfo = this.adventureChapters[chapterId];
    
    if (!chapterInfo) {
      console.error('Unknown chapter:', chapterId);
      return;
    }
    
    console.log(`🗺️ Loading next chapter: ${chapterInfo.name}`);
    
    // NOTE: Don't resetGameState() here - startAdventureWithMap() already does it.
    // Double-reset causes the shadow generator to be rebuilt twice wastefully.
    
    try {
      const response = await fetch(chapterInfo.file);
      if (!response.ok) throw new Error(`Failed to load ${chapterInfo.file}`);
      
      const mapData = JSON.parse(await response.text());
      console.log('📦 Chapter loaded:', mapData.n || chapterId);
      
      // Track current chapter
      window.currentChapterId = chapterId;
      
      // Start adventure with the custom map
      //
      // IMPORTANT: In co-op, we must preserve the full player list; otherwise each peer will
      // accidentally start a solo match (players=[window.player]) and everyone "loads" out of sync.
      const coopPlayers = window.currentMatch?.players;
      const isCoop = window.isMultiplayer && Array.isArray(coopPlayers) && coopPlayers.length > 1;
      this.startAdventureWithMap(mapData, isCoop ? coopPlayers : undefined);
      
    } catch (e) {
      console.error('Failed to load chapter:', e);
      if (window.ui && window.ui.showNotification) {
        window.ui.showNotification('Failed to load next chapter', 'error');
      }
    }
  },

  // Host-only: load next chapter and broadcast to co-op peers so everyone loads together.
  loadAdventureChapterCoopHost: async function(chapterId) {
    if (!window.currentMatch || !window.currentMatch.isHost || !window.currentMatch.isHost()) {
      console.warn('⚠️ Only host can initiate co-op chapter transition');
      return;
    }
    const chapterInfo = this.adventureChapters[chapterId];
    if (!chapterInfo) {
      console.error('Unknown chapter:', chapterId);
      return;
    }
    
    console.log(`🗺️ [CO-OP] Loading next chapter for party: ${chapterInfo.name}`);
    
    try {
      const response = await fetch(chapterInfo.file);
      if (!response.ok) throw new Error(`Failed to load ${chapterInfo.file}`);
      const mapData = await response.json();
      
      const players = Array.isArray(window.currentMatch?.players) ? window.currentMatch.players : [window.player];
      const playerIds = players.map(p => (p && p.id) ? p.id : p).filter(Boolean);
      const fallbackPalette = ['#ff0000', '#00ff00', '#0066ff', '#ffff00', '#ff00ff', '#00ffff'];
      const playersMeta = playerIds.map((id, idx) => {
        const p = players.find(pp => (pp && pp.id) ? pp.id === id : pp === id);
        const name = (p && p.name) ? p.name : (idx === 0 ? 'Host' : `Player ${idx + 1}`);
        const color = (p && p.color) ? p.color : (fallbackPalette[idx % fallbackPalette.length] || '#ffffff');
        return {
          id,
          name,
          color,
          resources: p?.resources ? { ...p.resources } : undefined
        };
      });
      
      // Broadcast map + player list so all peers start the same chapter together.
      if (window.net && window.net.p2p && window.net.p2p.sendData) {
        window.net.p2p.sendData({
          type: 'adventure_chapter_start',
          chapterId,
          mapData,
          playerIds: playerIds,
          playersMeta: playersMeta
        });
      }
      
      // Start locally using the exact same payload.
      window.currentChapterId = chapterId;
      // Build player array in the same shape as the normal co-op start:
      // ensure our local `window.player` object is included so input/selection works.
      const localNorm = this.normalizePeerId ? this.normalizePeerId(window.player?.id) : (window.player?.id?.slice ? window.player.id.slice(-6) : window.player?.id);
      const builtPlayers = playerIds.map((id, idx) => {
        const idNorm = this.normalizePeerId ? this.normalizePeerId(id) : (id?.slice ? id.slice(-6) : id);
        if (localNorm && idNorm === localNorm) {
          window.player.id = id;
          if (playersMeta[idx]?.color) window.player.color = playersMeta[idx].color;
          if (playersMeta[idx]?.name) window.player.name = playersMeta[idx].name;
          return window.player;
        }
        return this.createRemoteMatchPlayer({
          id,
          name: playersMeta[idx]?.name || (idx === 0 ? 'Host' : `Player ${idx + 1}`),
          color: playersMeta[idx]?.color || (fallbackPalette[idx % fallbackPalette.length] || '#ffffff'),
          resources: playersMeta[idx]?.resources
        });
      });
      this.startAdventureWithMap(mapData, builtPlayers);
    } catch (e) {
      console.error('❌ Failed to load co-op next chapter:', e);
      if (window.ui && window.ui.showNotification) {
        window.ui.showNotification('Failed to load next chapter', 'error');
      }
    }
  },
  
  // ==========================================
  // ADVENTURE MULTIPLAYER FUNCTIONS
  // ==========================================
  
  // Stop adventure lobby search (called when leaving adventure menu)
  stopAdventureSearch: function() {
    if (this._adventureSearchInterval) {
      clearInterval(this._adventureSearchInterval);
      this._adventureSearchInterval = null;
    }
  },
  
  // Search for adventure lobbies
  searchAdventureLobbies: async function() {
    const listDiv = document.getElementById('adventure_lobby_list');
    if (!listDiv) return;
    
    listDiv.innerHTML = '<div style="opacity: 0.6; text-align: center; padding: 20px;">🔍 Searching for lobbies...</div>';
    
    // Initialize network if needed
    if (!window.net || !window.net.initialized) {
      if (window.net && window.net.init) {
        window.net.init({ 
          gameType: 'adventure',
          lobbyBrowserMode: true,
          broadcastChannel: 'adventure-lobby-browser'
        });
        // Wait for network to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Join the broadcast channel (critical for receiving announcements!)
    const channelName = 'adventure-lobby-browser';
    await this.waitForBroadcastChannel(channelName);
    
    // Request lobby list
    this.currentGameType = 'adventure';
    this.availableLobbies['adventure'] = this.availableLobbies['adventure'] || [];
    
    // Set up broadcast listener for adventure lobbies
    const self = this;
    const originalHandler = window.net?.onBroadcast;
    
    window.net.onBroadcast = (data) => {
      // Unwrap GetFire P2P's broadcast envelope (same as startLobbyDiscovery)
      let actualMessage = data;
      if (data.type === 'broadcast' && data.content) {
        actualMessage = data.content;
      }
      
      // Handle lobby announcements
      if (actualMessage.type === 'lobby_announcement' && actualMessage.gameType === 'adventure') {
        console.log('📡 Received adventure lobby announcement:', actualMessage.lobby?.name);
        const existingIndex = self.availableLobbies['adventure'].findIndex(l => l.id === actualMessage.lobby.id);
        if (existingIndex >= 0) {
          self.availableLobbies['adventure'][existingIndex] = actualMessage.lobby;
        } else {
          self.availableLobbies['adventure'].push(actualMessage.lobby);
        }
        self.updateAdventureLobbyList();
      }
      
      // Handle lobby list requests - respond if we're hosting
      if (actualMessage.type === 'lobby_list_request' && actualMessage.gameType === 'adventure') {
        if (self.isHost && self.currentLobbyId && self.currentGameType === 'adventure' && self.currentLobby) {
          console.log('📡 Responding to adventure lobby request');
          setTimeout(() => {
            self.announceLobby(self.currentLobby);
          }, Math.random() * 200);
        }
      }
      
      // Chain to original handler
      if (originalHandler) {
        originalHandler(data);
      }
    };
    
    // Send lobby discovery request
    const requestLobbies = () => {
      if (window.net && window.net.broadcast) {
        console.log('📡 Requesting adventure lobbies...');
        window.net.broadcast({
          type: 'lobby_list_request',
          gameType: 'adventure'
        }, channelName);
      }
    };
    
    // Send requests with staggered timing for better discovery
    setTimeout(requestLobbies, 100);
    setTimeout(requestLobbies, 500);
    setTimeout(requestLobbies, 1000);
    
    // Update UI after initial search period
    setTimeout(() => {
      this.updateAdventureLobbyList();
    }, 1500);
    
    // Keep searching periodically while browser is open
    if (this._adventureSearchInterval) {
      clearInterval(this._adventureSearchInterval);
    }
    this._adventureSearchInterval = setInterval(() => {
      requestLobbies();
      this.updateAdventureLobbyList();
    }, 5000);
  },
  
  // Update adventure lobby list UI (inline in chapter view)
  updateAdventureLobbyList: function() {
    const listDiv = document.getElementById('adventure_lobby_list');
    if (!listDiv) return;
    
    const lobbies = this.availableLobbies['adventure'] || [];
    
    // Filter out stale lobbies (older than 30 seconds)
    const now = Date.now();
    const activeLobbies = lobbies.filter(l => (now - l.timestamp) < 30000);
    
    if (activeLobbies.length === 0) {
      // Show subtle message when no lobbies
      listDiv.innerHTML = `<div style="opacity: 0.4; font-size: 11px; text-align: center; padding: 5px;">No co-op lobbies available</div>`;
      return;
    }
    
    let html = `<div style="font-size: 11px; opacity: 0.6; margin-bottom: 5px;">👥 Join a Co-op Lobby:</div>`;
    activeLobbies.forEach(lobby => {
      const isFull = lobby.players >= lobby.maxPlayers;
      const chapterName = lobby.settings?.chapterName || 'Adventure';
      const hostName = lobby.hostName || 'Host';
      html += `
        <div style="background: rgba(60,60,100,0.4); padding: 6px 8px; margin: 4px 0; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${hostName}'s ${chapterName}</div>
            <div style="font-size: 10px; opacity: 0.6;">👥 ${lobby.players}/${lobby.maxPlayers}</div>
          </div>
          ${!isFull 
            ? `<button onclick="window.Lobby.joinAdventureLobby('${lobby.id}')" style="background: rgba(80,120,80,0.7); border: none; color: #fff; padding: 4px 10px; cursor: pointer; border-radius: 3px; font-size: 12px; margin-left: 8px;">Join</button>`
            : '<span style="opacity: 0.5; font-size: 11px; margin-left: 8px;">Full</span>'}
        </div>`;
    });
    
    listDiv.innerHTML = html;
  },
  
  // Host a new adventure lobby
  hostAdventureLobby: async function() {
    const select = document.getElementById('adventure_chapter_select');
    const chapterId = select ? select.value : 'chapter1';
    const chapterInfo = this.adventureChapters[chapterId];
    
    if (!chapterInfo) {
      console.error('Unknown chapter:', chapterId);
      return;
    }
    
    // Initialize network if needed
    if (!window.net || !window.net.initialized) {
      if (window.net && window.net.init) {
        window.net.init({ 
          gameType: 'adventure',
          lobbyBrowserMode: false,
          broadcastChannel: 'adventure-lobby-browser'
        });
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Join the broadcast channel and wait for it to be ready
    const channelName = 'adventure-lobby-browser';
    await this.waitForBroadcastChannel(channelName);
    this.flushPendingBroadcasts();
    
    // Create the lobby - this calls updateLobbyRoomUI which shows the standard lobby room
    const lobbyName = `${window.currentPlayerName || 'Player'}'s ${chapterInfo.name}`;
    this.createLobby('adventure', lobbyName, {
      fieldSize: 'custom',
      seed: Math.floor(Math.random() * 1000000),
      maxPlayers: 4,
      chapterId: chapterId,
      chapterName: chapterInfo.name,
      chapterFile: chapterInfo.file
    });
    
    console.log(`🎮 Hosting adventure lobby: ${chapterInfo.name}`);
  },
  
  // Update player list in hosting/joining view
  updateAdventurePlayerList: function() {
    const listDiv = document.getElementById('adventure_player_list');
    if (!listDiv) return;
    
    let html = '';
    
    if (this.isHost) {
      // Host view - show self as host
      const playerName = window.currentPlayerName || 'You';
      const playerColor = window.currentPlayerColor || '#ffffff';
      html += `<div style="color: ${playerColor};">👑 ${playerName} (Host)</div>`;
      
      // Add connected players - name/color stored directly on player object
      if (this.connectedPlayers && this.connectedPlayers.length > 0) {
        this.connectedPlayers.forEach((player, index) => {
          // Player can be an object with {id, name, color} or just an id string
          const name = player?.name || `Player ${index + 2}`;
          const color = player?.color || '#aaaaaa';
          html += `<div style="color: ${color}; margin-top: 5px;">👤 ${name}</div>`;
        });
      } else {
        html += `<div style="opacity: 0.5; margin-top: 8px; font-size: 12px;">Waiting for players to join...</div>`;
      }
    } else if (this._isJoiningAdventure) {
      // Joiner view - show host and self
      const lobby = this._adventureLobbyToJoin || this.currentLobby;
      const hostName = lobby?.hostName || 'Host';
      const hostColor = lobby?.hostColor || '#ffffff';
      
      html += `<div style="color: ${hostColor};">👑 ${hostName} (Host)</div>`;
      
      // Check if we're connected
      const status = window.net?.getStatus?.() || {};
      const isConnected = status.peers && status.peers.length > 0;
      
      const myName = window.currentPlayerName || 'You';
      const myColor = window.currentPlayerColor || '#ffffff';
      html += `<div style="color: ${myColor}; margin-top: 5px;">👤 ${myName} ${isConnected ? '(connected)' : '(connecting...)'}</div>`;
    }
    
    listDiv.innerHTML = html;
  },
  
  // Cancel/Leave adventure lobby - uses standard lobby flow
  cancelAdventureLobby: function() {
    this.leaveLobbyAndReturnToBrowser('adventure');
  },
  
  leaveAdventureLobby: function() {
    this.leaveLobbyAndReturnToBrowser('adventure');
  },
  
  // Start hosted adventure game
  startHostedAdventure: async function() {
    if (!this._hostingChapterInfo) {
      console.error('No chapter info for hosted game');
      return;
    }
    
    try {
      // Load the chapter map
      const response = await fetch(this._hostingChapterInfo.file);
      if (!response.ok) throw new Error(`Failed to load ${this._hostingChapterInfo.file}`);
      
      const mapData = JSON.parse(await response.text());
      console.log('📦 Starting hosted adventure:', mapData.n || this._hostingChapterId);
      
      // Store map data for adventure start
      this._adventureMapData = mapData;
      
      // Stop hosting interval
      if (this._adventureHostInterval) {
        clearInterval(this._adventureHostInterval);
        this._adventureHostInterval = null;
      }
      
      // Start countdown (synced with peers)
      await this.runAdventureCountdown(mapData);
      
    } catch (e) {
      console.error('Failed to start hosted adventure:', e);
      alert('Failed to start game. Please try again.');
    }
  },
  
  // Run synced countdown before adventure starts
  runAdventureCountdown: async function(mapData) {
    const hostInfo = document.getElementById('adventure_host_info');
    const playerList = document.getElementById('adventure_player_list');
    const startBtn = document.querySelector('#adventure_hosting_view .lobby_b[title="Start Game"]');
    const cancelBtn = document.querySelector('#adventure_hosting_view .lobby_b[title="Cancel"]');
    
    // Hide buttons during countdown
    if (startBtn) startBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    // Countdown from 3
    for (let i = 3; i > 0; i--) {
      // Update local UI
      if (hostInfo) {
        hostInfo.innerHTML = `
          <div style="text-align: center; font-size: 24px; font-weight: bold;">Starting in ${i}...</div>
        `;
      }
      
      // Send countdown to peers
      if (window.net && window.net.p2p && window.net.p2p.sendData) {
        window.net.p2p.sendData({
          type: 'adventure_countdown',
          count: i
        });
      }
      
      // Wait 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Show "GO!" briefly
    if (hostInfo) {
      hostInfo.innerHTML = `
        <div style="text-align: center; font-size: 24px; font-weight: bold; color: #4f4;">GO!</div>
      `;
    }
    
    // Build players array - host is always P1
    if (!window.player) {
      window.player = new Player();
    }
    if (!window.player.id || window.player.id === 'demo' || window.player.id === 'undefined') {
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      window.player.id = `adventurer-${randomSuffix}`;
    }
    window.player.units = [];
    window.player.buildings = [];
    window.player.selectedUnits = [];
    
    const players = [window.player];
    this.connectedPlayers.forEach((p, i) => {
      players.push(this.createRemoteMatchPlayer({
        id: p.id || p,
        name: p.name || `Player ${i + 2}`,
        color: p.color || '#00ff00'
      }));
    });
    
    // Send game start to peers (include host ID so they know player order)
    if (window.net && window.net.p2p && window.net.p2p.sendData) {
      const playerIds = players.map(p => (p && p.id) ? p.id : p).filter(Boolean);
      const playersMeta = players.map((player, index) => ({
        id: (player && player.id) ? player.id : player,
        name: player?.name || (index === 0 ? 'Host' : `Player ${index + 1}`),
        color: player?.color || (index === 0 ? '#ff0000' : '#00ff00'),
        resources: player?.resources ? { ...player.resources } : undefined
      }));
      console.log('📡 Sending adventure_start to peers...');
      window.net.p2p.sendData({
        type: 'adventure_start',
        lobbyId: this.currentLobbyId,
        chapterId: this._hostingChapterId,
        chapterFile: this._hostingChapterInfo.file,
        mapData: mapData,
        hostId: window.player.id,  // Include host ID for player ordering
        playerIds: playerIds,
        playersMeta: playersMeta
      });
    }
    
    // Brief delay before starting
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Start the adventure locally with correct player order
    console.log('👥 Host player order:', players.map((p, i) => `P${i+1}=${(p.id || 'unknown').slice(-6)}`).join(', '));
    this.startAdventureWithMap(mapData, players);
  },
  
  // Join an adventure lobby
  // Join an adventure lobby - uses standard joinLobbyById which shows lobby room UI with ready checkboxes
  joinAdventureLobby: function(lobbyId) {
    console.log('🎮 Joining adventure lobby:', lobbyId);
    this.joinLobbyById('adventure', lobbyId);
  },
  
  // Start adventure mode with a custom map (co-op, no AI)
  // players: optional array of {id, name, color} for multiplayer
  startAdventureWithMap: function(mapData, players) {
    // Hide menu
    const menuEl = document.getElementById('menu');
    if (menuEl) menuEl.style.display = 'none';
    
    // Reset scene and ensure clean slate
    this.resetGameState();
    
    window.isMultiplayer = true;  // Use match/command system
    window.gameType = 'adventure';
    
    // Extract map info
    const isV2 = mapData.v === 2;
    const width = isV2 ? mapData.w : mapData.width || 64;
    const height = isV2 ? mapData.h : mapData.height || 64;
    const seed = isV2 ? mapData.s : mapData.seed || Math.floor(Math.random() * 1000000);
    
    window.mapSeed = seed;
    
    // Ensure player instance exists
    if (!window.player) {
      window.player = new Player();
    }

    if (Array.isArray(players) && players.length > 0) {
      players = this.normalizeAdventurePlayers(players);
    }
    
    // Generate unique player ID (also reset if still using demo ID from menu)
    if (!window.player.id || window.player.id === 'undefined' || window.player.id === 'player' || window.player.id === 'demo') {
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      window.player.id = `adventurer-${randomSuffix}`;
      console.log(`🎮 Generated new player ID: ${window.player.id}`);
    }
    
    // Reset player state
    window.player.units = [];
    window.player.buildings = [];
    window.player.selectedUnits = [];
    
    // Parse spawn points from map
    let spawnPositions = [];
    if (mapData.sp) {
      const parsedSpawns = mapData.sp.split(';').map((s, index) => {
        const parts = s.split(',').map(Number);
        return { x: parts[0], y: parts[1], team: parts[2] !== undefined ? parts[2] : index };
      });
      parsedSpawns.sort((a, b) => a.team - b.team);
      spawnPositions = parsedSpawns;
    }
    
    // Fallback spawn if none defined
    if (spawnPositions.length === 0) {
      const margin = Math.max(8, Math.floor(Math.min(width, height) * 0.1));
      spawnPositions = [{ x: margin, y: margin }];
    }
    
    const tileSize = (typeof TILE_SIZE === 'number') ? TILE_SIZE : (window.TILE_SIZE || 4);
    
    // Configure player spawn
    window.player.name = window.currentPlayerName || window.player.name || 'Adventurer';
    // In co-op, prefer the host-assigned slot color (from matchPlayers) over per-device defaults.
    // This keeps team colors consistent across peers and across chapter transitions.
    const providedLocalColor = (() => {
      if (!players || !Array.isArray(players)) return null;
      const normalize = (id) => {
        if (!id) return '';
        const suffix = id.includes('-') ? id.split('-').pop() : id;
        return suffix.length > 6 ? suffix.slice(-6) : suffix;
      };
      const localNorm = normalize(window.player.id);
      const entry = players.find(p => {
        const pid = (p && p.id) ? p.id : p;
        return normalize(pid) === localNorm;
      });
      return entry && entry.color ? entry.color : null;
    })();
    window.player.color = providedLocalColor || window.currentPlayerColor || window.player.color || '#ff0000';
    
    // Adventure mode: check if we have starting units instead of Agora spawns
    // If starting units are defined, don't set player.agora (no Agora in adventure)
    const hasStartingUnits = mapData.units && mapData.units.length > 0;
    
    // Parse starting units to find camera start position
    let cameraStartPos = spawnPositions[0];
    if (hasStartingUnits) {
      // Find first unit for player 0 to center camera there
      const firstUnit = mapData.units.split(';')[0];
      if (firstUnit) {
        const parts = firstUnit.split(',');
        cameraStartPos = { x: Number(parts[0]), y: Number(parts[1]) };
      }
      // Don't set agora for adventure mode with starting units
      window.player.agora = null;
    } else {
      // Legacy mode: use spawn points as agora positions
      window.player.agora = spawnPositions[0];
    }
    
    window.player.basePosition = { x: cameraStartPos.x, z: cameraStartPos.y };
    
    if (window.player.pbody) {
      const startX = cameraStartPos.x * tileSize;
      const startZ = cameraStartPos.y * tileSize;
      window.player.pbody.state.loc.set(startX, 0, startZ);
      window.player.pbody.vel.set(0, 0, 0);
      window.player.pbody.imp.set(0, 0, 0);
    }
    
    // No AI opponents in adventure co-op mode
    window.aiOpponents = [];
    window.opponent = null;
    
    // Dispose old field
    const oldField = window.liveField;
    window.liveField = null;
    if (typeof liveField !== 'undefined') liveField = null;
    if (oldField && typeof oldField.dispose === 'function') oldField.dispose();
    
    // Create new field with map dimensions
    window.liveField = new window.Field({
      width: width,
      height: height,
      seed: seed,
      spawnPositions: spawnPositions
    });
    if (window.gfx && window.gfx.primeFieldResourcePathing) {
      window.gfx.primeFieldResourcePathing(window.liveField);
    }
    if (typeof liveField !== 'undefined') liveField = window.liveField;
    
    // Stretch table BEFORE applying custom map so rebuildTableFromChunkMask
    // (called inside applyCustomMapToField for non-rectangular maps) can hide
    // the static table parts without stretchTable re-enabling them afterwards.
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    
    // Apply custom map data (terrain, resources, buildings)
    this.applyCustomMapToField(mapData);
    if (window.gfx && typeof gfx.recreateMountains === 'function') {
      gfx.recreateMountains();
    }
    window._cameraLimitsSet = false;
    
    // Position camera at start position (first unit or spawn)
    if (window.gfx && window.gfx.camera && window.gfx.cameraTarget) {
      const startX = cameraStartPos.x * tileSize;
      const startZ = cameraStartPos.y * tileSize;
      window.gfx.cameraTarget.position.x = startX;
      window.gfx.cameraTarget.position.y = 9;
      window.gfx.cameraTarget.position.z = startZ;
      
      if (window.cameraAnchor) {
        window.cameraAnchor.x = startX;
        window.cameraAnchor.y = 9;
        window.cameraAnchor.z = startZ;
      }
      
      window.gfx.camera.alpha = -2.5;
      window.gfx.camera.beta = 1.1;
      window.gfx.camera.radius = 80;
    }
    
    // Force load chunks at spawn
    if (window.gfx && window.gfx.forceLoadChunks && window.gfx.cameraTarget) {
      const targetPos = window.gfx.cameraTarget.position;
      window.gfx.forceLoadChunks(targetPos.x, targetPos.z);
    }
    
    // Use provided players array or default to just local player
    const matchPlayers = players && players.length > 0 ? players : [window.player];
    console.log('🧭 Adventure match players:', matchPlayers.map((player, index) => ({
      slot: index,
      id: player?.id || null,
      normalizedId: this.normalizePeerId(player?.id || ''),
      name: player?.name || null,
      color: player?.color || null,
      isLocalObject: player === window.player
    })));
    window.gameBuildings = window.gameBuildings || [];
    window.gameUnits = window.gameUnits || [];
    
    // Determine host - first player is host, or check if we're the host from lobby
    const hostId = this.isHost ? window.player.id : (matchPlayers[0]?.id || window.player.id);
    
    // CRITICAL: Create Match BEFORE Game so unit IDs are deterministic!
    // The Game constructor spawns adventure units, and they need window.currentMatch
    // to exist for deterministic ID generation via currentMatch.unitIdCounter
    window.currentMatch = new window.Match({
      id: `adventure-${Date.now()}`,
      gameType: 'adventure',
      mapSeed: seed,
      mapSize: { width, height },
      players: matchPlayers,
      localPlayerId: window.player.id,
      hostId: hostId,
      victoryCondition: 'objectives',  // Adventure uses objectives, not elimination
      timeLimit: 0
    });
    
    // Create game instance (this spawns adventure units)
    window.game = new window.Game({
      type: 'adventure',
      map: 'custom',
      mapSeed: seed,
      players: matchPlayers,
      isMultiplayer: true,
      tickRate: 60,
      maxPlayers: 4
    });
    
    // Spawn unit models
    if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
      window.spawnUnitModels(window.gfx.scene);
    }
    
    // Refresh team colors after spawning models (important after chapter transitions).
    if (typeof window.refreshAllUnitColors === 'function') {
      setTimeout(() => window.refreshAllUnitColors(), 50);
    }
    
    // Check if this is multiplayer (multiple players)
    const isMultiplayerAdventure = matchPlayers.length > 1 && window.isMultiplayer;
    
    if (isMultiplayerAdventure) {
      // Multiplayer: Use the loading/countdown flow
      // Start the match (enters LOADING state, shows loading overlay)
      window.currentMatch.start();
      
      // Signal that local player has finished loading - this triggers countdown when all ready
      setTimeout(() => {
        if (window.currentMatch && window.currentMatch.onLocalPlayerLoaded) {
          console.log('📡 Adventure: Signaling local player loaded');
          window.currentMatch.onLocalPlayerLoaded();
        }
      }, 500);
    } else {
      // Solo: Start immediately (no countdown needed)
      window.currentMatch.beginPlaying();
      if (window.currentMatch.startLocalTickLoop) {
        // Force=true because isMultiplayer is set for command system but we're playing solo
        window.currentMatch.startLocalTickLoop(true);
      }
    }
    
    // CRITICAL: Start the game loop for physics/behavior updates
    // The match tick loop handles commands but the game loop handles unit movement
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    console.log(`✅ Adventure started: ${mapData.n || 'Custom Map'}`);
  },
  
  // Start a local Adventure match with an AI opponent for debugging/single-player
  startAdventureSkirmish: function(fieldSize = 'medium', mapSeed = null, options = {}) {
    
    const config = this.gameTypes['adventure'];
    const resolvedFieldSize = fieldSize || (config ? config.defaultFieldSize : 'medium');
    const resolvedSeed = Number.isFinite(Number(mapSeed))
      ? Math.floor(Number(mapSeed))
      : Math.floor(Math.random() * 1000000);
    
    // Reset scene and ensure clean slate
    this.resetGameState();
    
    // CRITICAL: Always use multiplayer mode because it uses the match/command system!
    window.isMultiplayer = true;
    window.gameType = 'adventure';
    window.mapSeed = resolvedSeed;
    
    // Ensure player instance exists
    if (!window.player) {
      window.player = new Player();
    }
    
    // CRITICAL: Generate unique player ID for each match (like AI opponents do)
    // Also reset if still using demo ID from menu mode
    if (!window.player.id || window.player.id === 'undefined' || window.player.id === 'player' || window.player.id === 'demo') {
      // Generate unique ID similar to AI opponents
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      window.player.id = `local-player-${randomSuffix}`;
    }
    
    // Reset player state for new match
    window.player.units = [];
    window.player.buildings = [];
    window.player.selectedUnits = [];
    
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
    const localPlayerId = window.player.id; // CRITICAL: No fallback - ID must be set!
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
      const aiId = options.aiIds?.[i] || `ai-${i + 1}-${resolvedSeed.toString(16).padStart(6, '0')}`;
      const aiName = options.aiNames?.[i] || `AI ${i + 1}`;
      const aiColor = (options.aiColors && options.aiColors[i]) || (this.getPlayerColor ? this.getPlayerColor(i + 1) : '#0066cc');
      const aiResources = (options.aiResources && options.aiResources[i]) || { ...STARTING_RESOURCES };
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
    
    // Create the new field
    window.liveField = new window.Field({
      width: dims.width,
      height: dims.height,
      seed: resolvedSeed,
      spawnPositions: spawnPositions // Pass spawn positions for flattening
    });
    if (window.gfx && window.gfx.primeFieldResourcePathing) {
      window.gfx.primeFieldResourcePathing(window.liveField);
    }
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
      window.liveField.originalLoadDistance = 6;
      // Then set currentLoadDistance based on LOD
      const newLoadDistance = Math.round(6 * currentMultiplier);
      window.liveField.currentLoadDistance = Math.max(3, Math.min(12, newLoadDistance));
    }
    
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    if (window.gfx && typeof gfx.recreateMountains === 'function') {
      gfx.recreateMountains();
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
      window.gfx.camera.beta = 1.1;
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
    
    // Prepare player arrays (gameBuildings used for all buildings now)
    const players = [window.player, ...aiPlayers];
    window.gameBuildings = window.gameBuildings || [];
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
    
    // Ensure unit models are spawned for visual layer
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
    
    // Start the match with countdown system (works for both solo and multiplayer)
    window.currentMatch.start();
    
    // Announce 'in_game' status to global stats channel
    this.announceStatusToGlobal('in_game');
    
    // Signal that local player has finished loading (after initialization is complete)
    // This will trigger countdown for solo play or wait for other players in multiplayer
    setTimeout(() => {
      if (window.currentMatch && window.currentMatch.onLocalPlayerLoaded) {
        window.currentMatch.onLocalPlayerLoaded();
      }
    }, 500); // Small delay to ensure async model loading has started
    
    // Clear any selections from menu scene
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
      console.log('🗑️ Cleared menu scene selections before match start');
    }
    
    // Physics/game loop will start automatically after countdown
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // LOD already updated by forceLoadChunks - no need to call again
    
    // Hide lobby/menu UI and refresh HUD
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    if (window.hud && window.hud.updateResources) {
      window.hud.updateResources();
    }
    
    delete window.pendingMapSeed;
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
    const normalizePeerIdFn = this.normalizePeerId.bind(this);
    this.connectedPlayers.forEach(p => {
      const id = p.id || p;
      const normalizedId = normalizePeerIdFn(id);
      if (normalizedId) {
        existingPlayerMap.set(normalizedId, p);
      }
    });
    this.connectedPlayers = uniquePeerIds.map(id => {
      const normalizedId = normalizePeerIdFn(id);
      const existing = normalizedId ? existingPlayerMap.get(normalizedId) : null;
      if (existing) {
        // Preserve existing metadata (name/color) but update ID
        return { ...existing, id: id };
      }
      return id;
    });
    
    let totalPlayers = 1 + this.connectedPlayers.length;
    
    // console.log(`🎯 Initial player count: ${totalPlayers} (1 local + ${this.connectedPlayers.length} peers)`);
    // console.log(`   Peers:`, this.connectedPlayers.map(p => p.id || p));
    
    // Adventure mode with chapter map can start solo or co-op (no AI needed)
    if (gameType === 'adventure' && settings?.customMapData) {
      console.log('✅ Starting Adventure with chapter map');
      
      // Ensure local player exists
      if (!window.player) {
        window.player = new Player();
      }
      // Reset demo ID if present (from menu mode)
      if (!window.player.id || window.player.id === 'demo' || window.player.id === 'undefined') {
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        window.player.id = `adventurer-${randomSuffix}`;
        console.log(`🎮 Generated new co-op player ID: ${window.player.id}`);
      }
      window.player.name = window.currentPlayerName || window.player.name || 'Player 1';
      window.player.color = window.currentPlayerColor || window.player.color || '#ff0000';
      window.player.units = [];
      window.player.buildings = [];
      window.player.selectedUnits = [];
      
      // Build player list for adventure
      // CRITICAL: Host must always be P1 (players[0]) for consistent unit ownership
      // Both host and peer need to agree on player order!
      const players = [];
      
      if (this.isHost) {
        // HOST: We are P1, peers are P2+
        console.log('👑 Host building player list: we are P1');
        players.push(window.player);
        // Assign unique colors for each peer slot
        const playerColors = ['#ff0000', '#00ff00', '#0066ff', '#ffff00', '#ff00ff', '#00ffff'];
        this.connectedPlayers.forEach((p, i) => {
          const playerIndex = i + 1; // P1 is host (0), peers start at P2 (1)
          players.push(this.createRemoteMatchPlayer({
            id: p.id || p,
            name: p.name || `Player ${i + 2}`,
            color: p.color || playerColors[playerIndex % playerColors.length] || '#ffffff'
          }));
        });
      } else {
        // PEER: Use the player IDs sent by the host for consistency
        // This ensures unit ownership matches between host and peer
        console.log('🎮 Peer building player list from host-provided IDs');
        
        if (this._playerIds && this._playerIds.length > 0) {
          // Find our own P2P ID to identify which slot we're in
          const myP2pId = window.net?.getStatus()?.localPlayerId || '';
          const myP2pSuffix = myP2pId.slice(-6);
          
          this._playerIds.forEach((playerId, index) => {
            const idSuffix = playerId.slice(-6);
            const isMe = idSuffix === myP2pSuffix || playerId.includes(myP2pSuffix);
            
            if (isMe) {
              // This is our slot - use window.player but with the ID the host expects
              window.player.id = playerId;  // CRITICAL: Use the ID host assigned us
              players.push(window.player);
              console.log(`   P${index + 1}: ME (using assigned ID: ${playerId.slice(-6)})`);
          } else {
            // This is another player (host or other peer)
            // Assign unique colors for each player slot
            const playerColors = ['#ff0000', '#00ff00', '#0066ff', '#ffff00', '#ff00ff', '#00ffff'];
            players.push(this.createRemoteMatchPlayer({
              id: playerId,
              name: index === 0 ? 'Host' : `Player ${index + 1}`,
              color: playerColors[index % playerColors.length] || '#ffffff'
            }));
            console.log(`   P${index + 1}: ${index === 0 ? 'Host' : 'Peer'} (${playerId.slice(-6)})`);
          }
          });
        } else {
          // Fallback to old behavior if no playerIds received
          console.log('   ⚠️ No playerIds received, using fallback');
          const hostId = this._hostPlayerId || (this.connectedPlayers[0]?.id || this.connectedPlayers[0]);
          players.push(this.createRemoteMatchPlayer({
            id: hostId,
            name: 'Host',
            color: '#ff0000'
          }));
          players.push(window.player);
        }
        
        // Clear the stored IDs after use
        this._hostPlayerId = null;
        this._playerIds = null;
      }
      
      console.log('👥 Player order:', players.map((p, i) => `P${i+1}=${(p.id || 'unknown').slice(-6)}`).join(', '));
      this.startAdventureWithMap(settings.customMapData, players);
      return;
    }
    
    if (totalPlayers < 2) {
      // Check if AI opponents are explicitly enabled
      const aiSlots = settings?.aiSlots || [];
      const aiCount = aiSlots.filter(slot => slot).length;


      if (aiCount === 0 && gameType !== 'adventure') {
        console.error('❌ Cannot start match: At least one AI opponent must be added before starting!');
        this.showNotification('Please add at least one AI opponent before starting the match.', 'error');
        return;
      }
      
      if (gameType === 'adventure') {
        // Adventure without a chapter map - use skirmish mode
        console.log('✅ Starting Adventure skirmish with', aiCount, 'AI opponents');
        this.startAdventureSkirmish(fieldSize, mapSeed, { aiCount: aiCount });
        return;
      } else if (gameType === 'onevsone' || gameType === '1v1') {
        this.start1v1Match(fieldSize, mapSeed, settings?.customMapData);
        return;
      } else if (gameType === 'teams') {
        console.log('✅ Starting Teams lobby with', aiCount, 'AI opponents');
        // Teams with AI - continue with normal multiplayer flow (it will handle AI later)
        // Don't return here - let the function continue to handle AI opponents
      } else {
        console.warn('⚠️ Not enough players! Unknown game type. Aborting...');
        return;
      }
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
      const normalizePeerIdFn = this.normalizePeerId.bind(this);
      this.connectedPlayers.forEach(p => {
        const id = p.id || p;
        const normalizedId = normalizePeerIdFn(id);
        if (normalizedId) {
          existingPlayerMap.set(normalizedId, p);
        }
      });
      
      this.connectedPlayers = uniquePeers.map(peerId => {
        const normalizedId = normalizePeerIdFn(peerId);
        const existing = normalizedId ? existingPlayerMap.get(normalizedId) : null;
        if (existing) {
          // Preserve existing metadata (name/color) but update ID
          return { ...existing, id: peerId };
        }
        return peerId;
      });
    }
    
    // Re-evaluate player counts with up-to-date peer information
    totalPlayers = 1 + this.connectedPlayers.length;
    
    // console.log(`👥 Player count check: localPlayerId="${localPlayerId}", connectedPlayers:`, this.connectedPlayers.map(p => p.id || p));
    // console.log(`   Total: ${totalPlayers}, Max: ${config.maxPlayers}`);
    
    if (totalPlayers < 2) {
      // Check if AI opponents are explicitly enabled
      const aiSlots = settings?.aiSlots || [];
      const aiCount = aiSlots.filter(slot => slot).length;
      
      if (aiCount === 0) {
        console.error('❌ Cannot start match: Opponent disconnected and no AI opponents configured. Please add AI opponents before starting.');
        this.showNotification('Opponent disconnected. Please add at least one AI opponent before starting the match.', 'error');
        return;
      }
      
      if (gameType === 'adventure') {
        console.log('✅ Opponent disconnected. Starting Adventure lobby with', aiCount, 'AI opponents');
        this.startAdventureSkirmish(fieldSize, mapSeed, { aiCount: aiCount });
        return;
      } else if (gameType === 'onevsone' || gameType === '1v1') {
        this.start1v1Match(fieldSize, mapSeed, settings?.customMapData);
        return;
      } else if (gameType === 'teams') {
        console.log('✅ Opponent disconnected. Continuing Teams lobby with', aiCount, 'AI opponents');
        // Teams with AI - continue with normal multiplayer flow (it will handle AI later)
        // Don't return here - let the function continue to handle AI opponents
      } else {
        console.warn('⚠️ Opponent disconnected while waiting for network readiness. Aborting multiplayer start.');
        return;
      }
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
    
    // Stop demo mode if running
    if (window.demo && window.demo.stop) {
      window.demo.stop();
    }
    
    // Use host-provided player ordering when available so both peers assign spawn slots
    // and deterministic unit IDs to the same players. Fallback to local reconstruction.
    let allPlayerIds;
    if (this._playerIds && this._playerIds.length > 0) {
      const orderedIds = [];
      const seenIds = new Set();
      this._playerIds.forEach(playerId => {
        const normalized = normalizeId(playerId);
        if (!normalized || seenIds.has(normalized)) return;
        seenIds.add(normalized);
        orderedIds.push(normalized);
      });
      allPlayerIds = orderedIds;
    } else {
      allPlayerIds = [
        localPlayerId,  // Already normalized to 6 chars
        ...this.connectedPlayers.map(p => {
          const peerId = p.id || p;
          return normalizeId(peerId);  // Normalize peer IDs to 6 chars too
        })
      ].sort();
    }
    
    const hostedPlayersMeta = (gameType !== 'adventure' && Array.isArray(this._playersMeta))
      ? this._playersMeta.slice()
      : [];
    const getHostedPlayerMeta = (normalizedId) => hostedPlayersMeta.find(meta =>
      normalizeId(meta?.id) === normalizedId
    ) || null;
    const getFallbackColor = (playerIndex) => {
      const colorInfo = this.getPlayerColor ? this.getPlayerColor(playerIndex) : null;
      return typeof colorInfo === 'string' ? colorInfo : (colorInfo?.primary || '#ffffff');
    };

    let normalizedLocalId = localPlayerId;  // Already normalized
    if (this._playerIds && this._playerIds.length > 0 && !allPlayerIds.includes(normalizedLocalId)) {
      const remoteNormalizedIds = new Set(
        (this.connectedPlayers || [])
          .map(p => normalizeId(p.id || p))
          .filter(Boolean)
      );
      const inferredLocalIds = allPlayerIds.filter(id => !remoteNormalizedIds.has(id));
      if (inferredLocalIds.length === 1) {
        normalizedLocalId = inferredLocalIds[0];
        console.log(`🎯 Inferred local assigned player ID from host ordering: ${normalizedLocalId}`);
      } else if (this._hostPlayerId && this.isHost) {
        const normalizedHostId = normalizeId(this._hostPlayerId);
        if (normalizedHostId) {
          normalizedLocalId = normalizedHostId;
        }
      }
    }
    let localPlayerIndex = allPlayerIds.indexOf(normalizedLocalId);
    
    if (localPlayerIndex === -1) {
      console.warn('⚠️ Local player ID missing from sorted list. Forcing local index to 0.');
      localPlayerIndex = 0;
    }
    
    if (new Set(allPlayerIds).size !== allPlayerIds.length) {
      console.warn('⚠️ Duplicate player IDs detected in lobby:', allPlayerIds);
    }

    const aiCount = (settings && settings.aiSlots)
      ? settings.aiSlots.filter(slot => slot).length
      : 0;
    const totalPlayersWithAI = allPlayerIds.length + aiCount;
    
    // Size spawn slots from the host-authoritative ordered human player list instead of
    // the local peer count. This prevents one peer from under-allocating spawn slots when
    // its transient connectedPlayers view lags behind the host's final ordering.
    const spawnPositions = this.getSpawnPositions(totalPlayersWithAI, fieldSize);
    if (spawnPositions[localPlayerIndex] === undefined) {
      console.error('❌ Not enough spawn positions for players:', { spawnPositions, allPlayerIds, localPlayerIndex });
      return;
    }
    const localHostedMeta = getHostedPlayerMeta(normalizedLocalId);
    const localPlayerName = localHostedMeta?.name || window.currentPlayerName || 'Player 1';
    const localPlayerColor = localHostedMeta?.color || window.currentPlayerColor || '#ff0000';
    
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
    
    window.liveField = new window.Field({
      width: dims.width,
      height: dims.height,
      seed: mapSeed,
      spawnPositions: spawnPositions // Pass spawn positions for flattening
    });
    if (window.gfx && window.gfx.primeFieldResourcePathing) {
      window.gfx.primeFieldResourcePathing(window.liveField);
    }
    
    if (typeof liveField !== 'undefined') {
      liveField = window.liveField;
    }
    
    // CRITICAL: Apply current LOD settings to new field immediately!
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      const currentMultiplier = window.hud.getCurrentLODMultiplier();
      
      window.liveField.originalLoadDistance = 6;
      const newLoadDistance = Math.round(6 * currentMultiplier);
      window.liveField.currentLoadDistance = Math.max(3, Math.min(12, newLoadDistance));
    }
    
    // Re-stretch the table to the new field dimensions (matches initial load order)
    if (window.gfx && window.gfx.table && typeof gfx.stretchTable === 'function') {
      gfx.stretchTable(gfx.table);
    }
    if (window.gfx && typeof gfx.recreateMountains === 'function') {
      gfx.recreateMountains();
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
        window.gfx.camera.beta = 1.1;   // Vertical angle (looking down more)
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
    
    // console.log('🎯 Building players array in sorted order:', allPlayerIds);
    // console.log('   Local player ID:', normalizedLocalId);
    
    // Iterate through ALL player IDs in sorted order (including local player)
    allPlayerIds.forEach((normalizedId, index) => {
      const spawnPos = spawnPositions[index];
      
      if (normalizedId === normalizedLocalId) {
        // This is the local player
        players.push(window.player);
      } else {
        // This is a remote opponent
        const playerMeta = getHostedPlayerMeta(normalizedId)
          || this.connectedPlayers.find(p => normalizeId(p.id || p) === normalizedId)
          || null;
        const playerName = playerMeta?.name || `Player ${index + 1}`;
        const playerColor = playerMeta?.color || getFallbackColor(index);
        
        // CRITICAL: Use normalized ID (6 chars) for consistency
        const opponent = new window.OpponentPlayer({
          id: normalizedId,  // Use normalized 6-char ID
          name: playerName,
          gameType: gameType,
          color: playerColor,
          startingResources: { ...STARTING_RESOURCES },
          agora: spawnPos,
          basePosition: { x: spawnPos.x, z: spawnPos.y },
          isAI: false
        });
        players.push(opponent);
        
        // CRITICAL: Assign first opponent to window.opponent for state sync
        if (!window.opponent) {
          window.opponent = opponent;
        }
      }
    });

    this._hostPlayerId = null;
    this._playerIds = null;
    this._playersMeta = null;
    
    // Add AI opponents if configured in lobby settings
    if (settings && settings.aiSlots) {
      const enabledAISlots = settings.aiSlots
        .map((enabled, index) => enabled ? index : null)
        .filter(index => index !== null && index >= players.length);
      
      
      enabledAISlots.forEach(slotIndex => {
        // Use players.length as spawn position index (AI players are added after human players)
        const spawnIndex = players.length;
        if (spawnIndex < spawnPositions.length) {
          const aiId = `ai-${slotIndex}-${mapSeed.toString(16).padStart(6, '0')}`;
          const aiName = `AI ${slotIndex}`;
          const aiColor = this.getPlayerColor(slotIndex).primary;
          const aiSpawn = spawnPositions[spawnIndex];
          
          const aiPlayer = window.AIPlayer 
            ? new window.AIPlayer({
                id: aiId,
                name: aiName,
                color: aiColor,
                startingResources: { ...STARTING_RESOURCES },
                agora: aiSpawn,
                basePosition: { x: aiSpawn.x, z: aiSpawn.y },
                difficulty: 'normal',
                isAI: true
              })
            : new window.OpponentPlayer({
                id: aiId,
                name: aiName,
                color: aiColor,
                startingResources: { ...STARTING_RESOURCES },
                agora: aiSpawn,
                basePosition: { x: aiSpawn.x, z: aiSpawn.y },
                isAI: true
              });
          
          aiPlayer.isAI = true;
          players.push(aiPlayer);
          console.log(`🤖 Added AI player ${aiName} at slot ${slotIndex}`);
        }
      });
    }
    
    // Create Match instance to manage the multiplayer game
    // NOTE: localPlayerId is already normalized to 6 chars at line 2272
    
    // Log AI players for debugging
    const aiPlayersInMatch = players.filter(p => p && p.isAI);
    if (aiPlayersInMatch.length > 0) {
      console.log(`🤖 Match will include ${aiPlayersInMatch.length} AI player(s):`, aiPlayersInMatch.map(p => p.name || p.id));
    }
    
    const matchOptions = {
      id: this.currentLobbyId,
      gameType: gameType,
      mapSeed: mapSeed,
      mapSize: fieldSize,
      players: players,
      localPlayerId: normalizedLocalId,
      hostId: this.isHost ? normalizedLocalId : null,
      victoryCondition: 'elimination',
      timeLimit: 0 // No time limit by default
    };
    
    window.currentMatch = new window.Match(matchOptions);
    
    // CRITICAL: Disable menu scene unit auto-spawning IMMEDIATELY
    window.autoInitDisabled = true;
    window.isMultiplayer = true; // Set this EARLY to prevent any menu scene logic
    
    // Stop demo mode if running
    if (window.demo && window.demo.stop) {
      window.demo.stop();
    }
    
    // Ensure gameBuildings array exists and is empty BEFORE creating Game
    if (!window.gameBuildings) {
      window.gameBuildings = [];
    } else if (window.gameBuildings.length > 0) {
      window.gameBuildings.length = 0;
    }
    // CRITICAL: NEVER do window.gameUnits = [] as it breaks the reference!
    // Only clear it with .length = 0 to preserve the array reference
    if (window.gameUnits && window.gameUnits.length > 0) {
      console.warn(`⚠️ gameUnits still has ${window.gameUnits.length} units after cleanup!`);
      window.gameUnits.length = 0;
    }
    
    // CRITICAL: Clear ALL units before match start (preserve array reference!)
    if (window.gameUnits && window.gameUnits.length > 0) {
      const unitsToRemove = window.gameUnits.length;
      console.log(`🗑️ Clearing ${unitsToRemove} units before match start`);
      
      // Dispose meshes
      window.gameUnits.forEach(unit => {
        if (unit.mesh && unit.mesh.dispose) {
          try {
            unit.mesh.dispose();
          } catch (e) {
            // Ignore disposal errors
          }
        }
      });
      
      // Clear array IN PLACE (preserve reference!)
      window.gameUnits.length = 0;
      console.log(`✅ gameUnits cleared: ${window.gameUnits.length} units remaining`);
    }
    
    // Store array reference to detect if it changes later
    window._initialGameUnitsRef = window.gameUnits;
    
    // CRITICAL: Also clear neutralUnits array (separate array that holds menu scene units)
    if (window.neutralUnits && window.neutralUnits.length > 0) {
      window.neutralUnits.length = 0;
    }
    
    // Create Game instance (visual/physics layer)
    // console.log('🎮 Creating Game with players:', players.map(p => ({ id: p.id, isLocal: p === window.player })));
    window.game = new window.Game({
      type: gameType,
      map: 'default',
      mapSeed: mapSeed,
      players: players,
      isMultiplayer: true,
      tickRate: window.net ? window.net.TICK_RATE : 60,
      maxPlayers: config.maxPlayers
    });
    
    // Initialize the game to spawn units and buildings
    if (window.game && window.game.init) {
      // console.log('🎮 Initializing game (spawning units)...');
      // console.log(`🔍 Player ID before spawning: ${window.player.id}`);
      // console.log(`🔍 game.players array:`, window.game.players.map(p => ({id: p.id, name: p.name, isPlayer: p === window.player})));
      
      window.game.init();
      
      // Check if any units don't have IDs
      if (window.gameUnits) {
        const unitsWithoutIds = window.gameUnits.filter(u => !u.id);
        if (unitsWithoutIds.length > 0) {
          console.error(`❌ AFTER INIT: ${unitsWithoutIds.length} units WITHOUT IDs! This will cause desync!`);
          console.log('Sample unit without ID:', unitsWithoutIds[0]);
        }
      }
      
      if (window.gameBuildings && window.gameBuildings.length > 0) {
        // console.log(`  - Buildings:`, window.gameBuildings.map(b => ({type: b.type, owner: b.owner, pos: `(${b.gridX},${b.gridZ})`})));
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
        if (window.player && window.gameUnits && window.player.id) {
          const normalizedLocalOwner = normalizeId(window.player.id);
          const recoveredUnits = window.gameUnits.filter(u => normalizeId(u.owner || '') === normalizedLocalOwner);
          if (recoveredUnits.length > 0) {
            window.player.units = recoveredUnits;
            console.warn(`🔧 Recovered ${recoveredUnits.length} local units by owner match for player ${normalizedLocalOwner}`);
          }
        }
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
        // console.log(`👥 Opponent ${opp.name || opp.id} has ${opp.units?.length || 0} units`);
      });
    }
    
    // Start the match (enters LOADING state)
    window.currentMatch.start();
    
    // Announce 'in_game' status to global stats channel (host stays connected to respond to pings)
    this.announceStatusToGlobal('in_game');
    
    // Ensure global stats channel stays connected (for host to respond to stats requests)
    if (this.isHost && !this.connectedChannels['aether-global-stats']) {
      // Rejoin global stats channel if disconnected
      this.waitForBroadcastChannel('aether-global-stats', 5000).then(() => {
        this.announceStatusToGlobal('in_game');
      }).catch(err => {
        console.warn('⚠️ Could not reconnect to global stats channel:', err);
      });
    }
    
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

// Ensure loadAdventureMapFile exists (defensive - in case of load order or cache issues)
if (!window.Lobby.loadAdventureMapFile) {
  window.Lobby.loadAdventureMapFile = function(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const mapData = JSON.parse(e.target.result);
        if (!mapData.w && !mapData.width) throw new Error('Invalid map format - missing dimensions');
        window.currentChapterId = null;
        window.Lobby.startAdventureWithMap(mapData);
      } catch (err) {
        console.error('Failed to load map file:', err);
        alert('Failed to load map file: ' + err.message);
      }
    };
    reader.readAsText(file);
    const inp = document.getElementById('adventureMapInput');
    if (inp) inp.value = '';
  };
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  Lobby.init();
});
