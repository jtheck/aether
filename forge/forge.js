// Forge Map Editor - Terrain Painting and Map Creation Tools
// Uses ENABLE_FORGE flag to activate editor functionality
// Works with the game's existing Field and gfx systems

(function(forge) {
  'use strict';
  
  // Editor state
  forge.state = {
    currentBrush: 'grass',      // Current terrain type to paint
    brushSize: 1,               // Brush radius in tiles
    isPainting: false,          // Whether currently painting
    lastPaintPos: null,         // Last painted position for continuous painting
    mapWidth: 64,               // Default map dimensions
    mapHeight: 64,
    mapSeed: 12345,             // Current map seed
    currentTool: 'terrain',     // 'table', 'terrain', or 'resource'
    currentResource: 'trees',   // Current resource to place
    // Layer visibility
    layers: {
      table: true,
      terrain: true,
      resources: true
    },
    // Current editing layer (affects what tool does)
    editingLayer: 'terrain'     // 'table', 'terrain', or 'resources'
  };
  
  // Terrain types map to the 2-terrain system (grass/dirt)
  forge.terrainTypes = {
    grass: { name: 'Grass', terrainType: 3, solidTile: 6, atlas: 'atlas-grass-dirt' },   // Type 3 = grass
    dirt:  { name: 'Dirt',  terrainType: 2, solidTile: 12, atlas: 'atlas-grass-dirt' },  // Type 2 = dirt
    water: { name: 'Water', terrainType: 1, solidTile: 12, atlas: 'atlas-grass-water' }  // Type 1 = water
  };
  
  // Available resources for manual placement
  forge.resourceTypes = {
    trees:       { name: 'Trees',       path: 'assets/models/trees.glb',       scale: 0.9 },
    rocks_plain: { name: 'Rocks',       path: 'assets/models/rocks_plain.glb', scale: 3.0 },
    rocks_moss:  { name: 'Mossy Rocks', path: 'assets/models/rocks_moss.glb',  scale: 7.5 },
    rocks_snow:  { name: 'Large Rocks', path: 'assets/models/rocks_snow.glb',  scale: 11.5 }
  };
  
  
  // Initialize forge editor
  forge.init = function() {
    if (!ENABLE_FORGE) return;
    
    console.log('🔨 Forge Map Editor initializing...');
    
    this.setupUI();
    this.setupPainting();
    this.setupCameraForEditing();
    
    // Force initial chunk loading
    this.loadAllChunks();
    
    // Build dynamic table based on chunk mask
    this.rebuildTable();
    
    // Ensure models are visible as they load (async loading)
    // Check multiple times as models stream in
    setTimeout(() => this.ensureModelsVisible(), 500);
    setTimeout(() => this.ensureModelsVisible(), 1500);
    setTimeout(() => this.ensureModelsVisible(), 3000);
    
    console.log('✅ Forge ready');
  };
  
  // Ensure all loaded models respect current visibility settings
  forge.ensureModelsVisible = function() {
    // Just delegate to applyLayerVisibility which handles everything
    this.applyLayerVisibility();
    
    const isBillboardMode = gfx.isBillboardOnlyMode && gfx.isBillboardOnlyMode();
    const count = gfx.lodModels ? gfx.lodModels.length : 0;
    console.log(`👁️ Applied visibility to ${count} models (billboard: ${isBillboardMode})`);
  };
  
  // Force load all chunks for the current field
  forge.loadAllChunks = function(includeResources = true) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene || !gfx.createTerrainMesh) {
      console.log('❌ Cannot load chunks - missing dependencies');
      return;
    }
    
    // Clear resource registries to prevent stale entries blocking new resources
    if (gfx.clearResourceRegistries) {
      gfx.clearResourceRegistries();
    }
    
    // Calculate how many chunks we need
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    
    // Create all chunks
    for (let x = 0; x < chunksX; x++) {
      for (let z = 0; z < chunksZ; z++) {
        const chunk = field.getChunk(x, z);
        if (chunk) {
          chunk.needsMesh = true;
        }
      }
    }
    
    // Create meshes for all ENABLED chunks only
    let meshCount = 0;
    for (const [key, chunk] of field.chunks) {
      if (chunk.needsMesh) {
        // Skip disabled chunks entirely - don't create terrain or resources
        if (field.chunkMask && field.chunkMask.get(key) === false) {
          continue;
        }
        
        const [chunkX, chunkZ] = key.split(',').map(Number);
        field.createChunkMesh(chunkX, chunkZ, gfx.scene, gfx.createTerrainMesh);
        meshCount++;
        
        // Place decorations/resources on this chunk (only on enabled chunks)
        if (includeResources && gfx.placeDecorationsOnChunk) {
          chunk.models = gfx.placeDecorationsOnChunk(chunk, gfx.scene);
        }
      }
    }
    
    console.log(`🗺️ Loaded ${meshCount} terrain chunks` + (includeResources ? ' with resources' : ''));
  };
  
  // Setup camera for top-down map editing
  forge.setupCameraForEditing = function() {
    if (!gfx || !gfx.camera) return;
    
    const field = window.liveField;
    // Position camera for overview of the map
    const fieldCenterX = field ? (field.width * TILE_SIZE) / 2 : 128;
    const fieldCenterZ = field ? (field.height * TILE_SIZE) / 2 : 128;
    
    // Set camera to look down at map from above
    gfx.camera.position = new Vec3(fieldCenterX, 150, fieldCenterZ - 50);
    gfx.camera.setTarget(new Vec3(fieldCenterX, 0, fieldCenterZ));
    
    // Increase camera speed for editor
    if (gfx.camera.speed !== undefined) {
      gfx.camera.speed = 20;
    }
    
    console.log('📷 Camera positioned for editing');
  };
  
  // Setup painting system
  forge.setupPainting = function() {
    if (!ENABLE_FORGE) return;
    
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    
    canvas.addEventListener('pointerdown', (e) => this.handlePointer(e));
    canvas.addEventListener('pointermove', (e) => this.handlePointer(e));
    canvas.addEventListener('pointerup', (e) => this.handlePointer(e));
    
    console.log('🖌️ Painting system ready');
  };
  
  // Handle pointer events
  forge.handlePointer = function(e) {
    if (!ENABLE_FORGE || !window.liveField) return;
    
    // Only paint with left mouse button
    if (e.button !== 0 && e.type !== 'pointermove') return;
    
    const field = window.liveField;
    
    switch (e.type) {
      case 'pointerdown':
        if (e.button === 0) {
          // Table editing mode - toggle chunks
          if (this.state.editingLayer === 'table') {
            const pos = this.getTilePosition(e);
            if (pos) {
              const chunkX = Math.floor(pos.x / field.chunkSize);
              const chunkZ = Math.floor(pos.y / field.chunkSize);
              this.toggleChunk(chunkX, chunkZ);
            }
            return;
          }
          
          this.state.isPainting = true;
          // Disable camera controls while painting
          if (gfx.camera) {
            gfx.camera.detachControl();
          }
          const pos = this.getTilePosition(e);
          if (pos) {
            if (this.state.editingLayer === 'resources') {
              this.placeResourceAt(pos);
            } else {
              this.paintAtPosition(pos);
            }
            this.state.lastPaintPos = pos;
          }
        }
        break;
        
      case 'pointermove':
        if (this.state.isPainting && this.state.editingLayer !== 'table') {
          const pos = this.getTilePosition(e);
          if (pos && this.state.lastPaintPos) {
            if (pos.x !== this.state.lastPaintPos.x || pos.y !== this.state.lastPaintPos.y) {
              if (this.state.editingLayer === 'resources') {
                this.placeResourceAt(pos);
              } else {
                this.paintAtPosition(pos);
              }
              this.state.lastPaintPos = pos;
            }
          }
        }
        break;
        
      case 'pointerup':
        if (e.button === 0) {
          this.state.isPainting = false;
          this.state.lastPaintPos = null;
          // Re-enable camera controls after painting
          if (gfx.camera && gfx.canvas) {
            gfx.camera.attachControl(gfx.canvas, true);
          }
        }
        break;
    }
  };
  
  // Get tile position from screen coordinates
  forge.getTilePosition = function(e) {
    if (!gfx || !gfx.scene) return null;
    
    const pickResult = gfx.scene.pick(e.clientX, e.clientY);
    
    if (pickResult.hit) {
      const worldPos = pickResult.pickedPoint;
      return {
        x: Math.floor(worldPos.x / TILE_SIZE),
        y: Math.floor(worldPos.z / TILE_SIZE)
      };
    }
    
    return null;
  };
  
  // Paint terrain at position
  forge.paintAtPosition = function(pos) {
    const field = window.liveField;
    if (!field) return;
    
    const terrain = this.terrainTypes[this.state.currentBrush];
    if (!terrain) return;
    
    const affectedChunks = new Set();
    const paintedTiles = []; // Track painted tiles for buffer pass
    
    // Helper to check if a tile is in an enabled chunk
    const isChunkEnabled = (x, y) => {
      if (!field.chunkMask) return true;
      const chunkX = Math.floor(x / field.chunkSize);
      const chunkZ = Math.floor(y / field.chunkSize);
      return field.chunkMask.get(`${chunkX},${chunkZ}`) !== false;
    };
    
    // Paint with brush
    for (let dx = -this.state.brushSize; dx <= this.state.brushSize; dx++) {
      for (let dy = -this.state.brushSize; dy <= this.state.brushSize; dy++) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        
        // Check bounds
        if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
        
        // Skip disabled chunks
        if (!isChunkEnabled(x, y)) continue;
        
        // Circular brush
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > this.state.brushSize) continue;
        
        // Update terrain type in field data
        const index = y * field.width + x;
        field.terrainTypes[index] = terrain.terrainType;
        paintedTiles.push({x, y});
        
        // Track which chunks need updating
        const chunkX = Math.floor(x / field.chunkSize);
        const chunkZ = Math.floor(y / field.chunkSize);
        affectedChunks.add(`${chunkX},${chunkZ}`);
      }
    }
    
    // If painting water, add grass buffer around it (prevent water-dirt adjacency)
    if (terrain.terrainType === 1) {
      for (const tile of paintedTiles) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = tile.x + dx;
            const ny = tile.y + dy;
            if (nx < 0 || nx >= field.width || ny < 0 || ny >= field.height) continue;
            
            const nIndex = ny * field.width + nx;
            // Convert dirt neighbors to grass (create shoreline buffer)
            if (field.terrainTypes[nIndex] === 2) {
              field.terrainTypes[nIndex] = 3; // Dirt → Grass
              
              const chunkX = Math.floor(nx / field.chunkSize);
              const chunkZ = Math.floor(ny / field.chunkSize);
              affectedChunks.add(`${chunkX},${chunkZ}`);
            }
          }
        }
      }
    }
    
    // Re-apply marching squares transitions for affected area
    this.applyTransitionsInArea(pos.x, pos.y, this.state.brushSize + 2);
    
    // Rebuild affected chunks
    this.rebuildChunks(affectedChunks);
  };
  
  // Apply marching squares transitions in an area
  forge.applyTransitionsInArea = function(centerX, centerY, radius) {
    const field = window.liveField;
    if (!field || !field.tiles || !field.terrainTypes) return;
    
    // Create density maps for transitions
    // Grass vs Dirt: grass=1, dirt=0
    // Grass vs Water: land(grass+dirt)=1, water=0
    const grassVsDirt = field.terrainTypes.map(t => t === 3 ? 1 : 0);
    const grassVsWater = field.terrainTypes.map(t => (t === 3 || t === 2) ? 1 : 0);
    
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      for (let y = centerY - radius; y <= centerY + radius; y++) {
        if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
        
        const index = y * field.width + x;
        const tile = field.tiles[index];
        
        // Skip if tile doesn't exist
        if (!tile) continue;
        
        const terrain = field.terrainTypes[index];
        
        // Check what terrain types are adjacent
        let hasWaterNeighbor = false;
        let hasDirtNeighbor = false;
        let hasGrassNeighbor = false;
        
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < field.width && ny >= 0 && ny < field.height) {
              const neighborTerrain = field.terrainTypes[ny * field.width + nx];
              if (neighborTerrain === 1) hasWaterNeighbor = true;
              if (neighborTerrain === 2) hasDirtNeighbor = true;
              if (neighborTerrain === 3) hasGrassNeighbor = true;
            }
          }
        }
        
        // Determine atlas and tile case based on terrain and neighbors
        if (terrain === 1) {
          // Water tile
          if (hasGrassNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsWater);
          } else {
            tile.type = 12; // Pure water
          }
          tile.atlasName = 'atlas-grass-water';
        } else if (terrain === 3) {
          // Grass tile
          if (hasWaterNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsWater);
            tile.atlasName = 'atlas-grass-water';
          } else if (hasDirtNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsDirt);
            tile.atlasName = 'atlas-grass-dirt';
          } else {
            tile.type = 6; // Pure grass
            tile.atlasName = 'atlas-grass-dirt';
          }
        } else if (terrain === 2) {
          // Dirt tile
          if (hasGrassNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsDirt);
          } else {
            tile.type = 12; // Pure dirt
          }
          tile.atlasName = 'atlas-grass-dirt';
        }
        
        if (tile.updateAtlasCoordinates) {
          tile.updateAtlasCoordinates();
        }
      }
    }
  };
  
  // Throttle for resource placement (prevent lag during drag)
  forge._lastResourcePlace = 0;
  forge._resourcePlaceDelay = 150; // ms between placements
  forge._modelCache = new Map(); // Cache loaded containers
  
  // Place a resource manually at position
  // Track placed resource meshes for removal
  forge._placedResources = new Map(); // key -> mesh root
  
  forge.placeResourceAt = function(pos) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    // Throttle placements to reduce lag
    const now = Date.now();
    if (now - this._lastResourcePlace < this._resourcePlaceDelay) return;
    this._lastResourcePlace = now;
    
    const key = `${pos.x},${pos.y}`;
    if (!this._placedKeys) this._placedKeys = new Set();
    
    // Handle eraser tool
    if (this.state.currentResource === 'eraser') {
      if (this._placedResources.has(key)) {
        const mesh = this._placedResources.get(key);
        if (mesh && mesh.dispose) mesh.dispose();
        this._placedResources.delete(key);
        this._placedKeys.delete(key);
      }
      return;
    }
    
    const resourceType = this.resourceTypes[this.state.currentResource];
    if (!resourceType || !resourceType.path) return;
    
    // Don't place on water
    const index = pos.y * field.width + pos.x;
    if (field.terrainTypes[index] === 1) return;
    
    // Don't place in disabled chunks
    const chunkX = Math.floor(pos.x / field.chunkSize);
    const chunkZ = Math.floor(pos.y / field.chunkSize);
    if (field.chunkMask && field.chunkMask.get(`${chunkX},${chunkZ}`) === false) return;
    
    // Check if already occupied
    if (this._placedKeys.has(key)) return;
    this._placedKeys.add(key);
    
    // Calculate world position
    const worldX = (pos.x + 0.5) * TILE_SIZE;
    const worldZ = (pos.y + 0.5) * TILE_SIZE;
    const worldY = field.getHeightVariation ? field.getHeightVariation(pos.x, pos.y) : 0;
    
    // Use cached container for better perf
    const path = resourceType.path;
    let containerPromise = this._modelCache.get(path);
    
    if (!containerPromise) {
      containerPromise = BABYLON.SceneLoader.LoadAssetContainerAsync(path, undefined, gfx.scene);
      this._modelCache.set(path, containerPromise);
    }
    
    containerPromise.then(container => {
      const instance = container.instantiateModelsToScene();
      const root = instance.rootNodes[0];
      
      root.setEnabled(true);
      root.getDescendants().forEach(n => {
        if (n.setEnabled) n.setEnabled(true);
      });
      
      root.position = new Vec3(worldX, worldY, worldZ);
      root.scaling = new Vec3(resourceType.scale, resourceType.scale, resourceType.scale);
      root.rotation = new Vec3(0, Math.random() * Math.PI * 2, 0);
      
      // Track for eraser tool
      this._placedResources.set(key, root);
      
      if (gfx.setupMeshShadows) {
        gfx.setupMeshShadows(root);
      }
    });
  };
  
  // Rebuild chunk meshes
  forge.rebuildChunks = function(chunkKeys) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene || !gfx.createTerrainMesh) return;
    
    chunkKeys.forEach(key => {
      const chunk = field.chunks.get(key);
      if (chunk) {
        // Dispose old mesh
        if (chunk.mesh) {
          chunk.mesh.dispose();
          chunk.mesh = null;
        }
        
        // Refresh chunk tiles from field (tiles are object refs so should be current, 
        // but let's rebuild the tiles array to be safe)
        const chunkTiles = [];
        for (let z = chunk.startZ; z < chunk.endZ; z++) {
          for (let x = chunk.startX; x < chunk.endX; x++) {
            chunkTiles.push(field.tiles[z * field.width + x]);
          }
        }
        chunk.tiles = chunkTiles;
        
        // Directly recreate the mesh
        const [chunkX, chunkZ] = key.split(',').map(Number);
        field.createChunkMesh(chunkX, chunkZ, gfx.scene, gfx.createTerrainMesh);
      }
    });
  };
  
  // Generate a new map
  forge.generateNewMap = function(width, height, seed) {
    if (!window.Field) {
      console.error('Field class not available');
      return;
    }
    
    this.state.mapWidth = width || this.state.mapWidth;
    this.state.mapHeight = height || this.state.mapHeight;
    this.state.mapSeed = seed || Math.floor(Math.random() * 1000000);
    
    console.log(`🗺️ Generating new map: ${this.state.mapWidth}x${this.state.mapHeight}, seed: ${this.state.mapSeed}`);
    
    // Check if this will be a large map and pre-enable billboard mode
    const totalTiles = this.state.mapWidth * this.state.mapHeight;
    if (totalTiles >= 16384 && gfx && gfx.setBillboardOnlyMode) {
      gfx.setBillboardOnlyMode(true);
      const btn = document.getElementById('billboard-toggle');
      if (btn) {
        btn.classList.add('active');
        btn.textContent = '🖼️ Billboard ON';
      }
      console.log('⚡ Pre-enabled billboard mode for large map');
    }
    
    // Clear placed resource tracking
    this._placedKeys = new Set();
    this._placedResources = new Map();
    
    // Dispose old field
    if (window.liveField && window.liveField.dispose) {
      window.liveField.dispose();
    }
    
    // Create new field
    window.liveField = new Field({
      width: this.state.mapWidth,
      height: this.state.mapHeight,
      seed: this.state.mapSeed
    });
    
    // Stretch table for new map size
    if (gfx.table && gfx.stretchTable) {
      gfx.stretchTable(gfx.table);
    }
    
    // Load all chunks with resources (billboard mode already set above for large maps)
    this.loadAllChunks(true);
    
    // Rebuild table to match new map
    this.rebuildTable();
    
    // Apply current layer visibility and billboard settings after load
    // Use timeout to catch async-loaded models
    setTimeout(() => {
      this.applyLayerVisibility();
    }, 100);
    setTimeout(() => {
      this.applyLayerVisibility();
    }, 500);
    setTimeout(() => {
      this.applyLayerVisibility();
    }, 1500);
    
    // Update camera for new map size (after chunks so field dimensions are set)
    // Don't reset camera - user may be inspecting a specific area
    
    console.log('✅ New map generated');
  };
  
  // Fill entire map with terrain type
  forge.fillMap = function(terrainType) {
    const field = window.liveField;
    if (!field) return;
    
    const terrain = this.terrainTypes[terrainType];
    if (!terrain) return;
    
    console.log(`🎨 Filling map with ${terrain.name}...`);
    
    // Update all tiles
    for (let i = 0; i < field.tiles.length; i++) {
      field.terrainTypes[i] = terrain.terrainType;
      field.tiles[i].type = terrain.solidTile;
      field.tiles[i].atlasName = terrain.atlas;
    }
    
    // Rebuild all chunks
    const allChunks = new Set(field.chunks.keys());
    this.rebuildChunks(allChunks);
    
    console.log('✅ Fill complete');
  };
  
  // Export map data as .aether format (compact binary-ish)
  forge.exportMap = function() {
    const field = window.liveField;
    if (!field) return null;
    
    // Compress terrain types using RLE (Run-Length Encoding)
    const terrainRLE = this.encodeRLE(field.terrainTypes);
    
    // Compress chunk mask as bitfield
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    const chunkBits = [];
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        chunkBits.push(field.chunkMask.get(`${cx},${cz}`) !== false ? 1 : 0);
      }
    }
    
    // Encode manually placed resources
    const placedResources = [];
    if (this._placedResources) {
      for (const [key, mesh] of this._placedResources) {
        if (mesh && !mesh.isDisposed()) {
          // Find which resource type this is by checking mesh name or scale
          let resType = 'trees';
          for (const [type, info] of Object.entries(this.resourceTypes)) {
            if (Math.abs(mesh.scaling.x - info.scale) < 0.1) {
              resType = type;
              break;
            }
          }
          placedResources.push(`${key}:${resType}`);
        }
      }
    }
    
    const mapData = {
      v: 2,  // Version 2 = new format
      w: field.width,
      h: field.height,
      s: field.seed,
      cs: field.chunkSize,
      t: terrainRLE,           // RLE-compressed terrain
      cm: chunkBits.join(''),  // Chunk mask as binary string "11101110..."
      ta: this.encodeTileAtlas(field.tiles),  // Tile atlas info
      r: placedResources.length > 0 ? placedResources.join(';') : undefined  // Placed resources
    };
    
    const json = JSON.stringify(mapData);
    const compressed = this.compressString(json);
    
    console.log(`📦 Map exported: ${(json.length / 1024).toFixed(1)} KB → ${(compressed.length / 1024).toFixed(1)} KB`);
    
    // Trigger download with .aether extension
    const blob = new Blob([compressed], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${field.seed}.aeg`;
    a.click();
    URL.revokeObjectURL(url);
    
    return mapData;
  };
  
  // RLE encode an array of values
  forge.encodeRLE = function(arr) {
    if (!arr || arr.length === 0) return '';
    const runs = [];
    let current = arr[0];
    let count = 1;
    
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === current && count < 255) {
        count++;
      } else {
        runs.push(`${current}:${count}`);
        current = arr[i];
        count = 1;
      }
    }
    runs.push(`${current}:${count}`);
    return runs.join(',');
  };
  
  // Decode RLE back to array
  forge.decodeRLE = function(str) {
    if (!str) return [];
    const arr = [];
    const runs = str.split(',');
    for (const run of runs) {
      const [val, count] = run.split(':').map(Number);
      for (let i = 0; i < count; i++) arr.push(val);
    }
    return arr;
  };
  
  // Encode tile atlas names (most are same, so group them)
  forge.encodeTileAtlas = function(tiles) {
    // Map atlas names to short codes
    const atlasMap = {
      'atlas-grass-dirt': 'gd',
      'atlas-grass-water': 'gw'
    };
    
    const codes = tiles.map(t => {
      const code = atlasMap[t.atlasName] || 'gd';
      return `${code}${t.type}`;
    });
    
    // RLE encode the codes
    const runs = [];
    let current = codes[0];
    let count = 1;
    
    for (let i = 1; i < codes.length; i++) {
      if (codes[i] === current && count < 255) {
        count++;
      } else {
        runs.push(count > 1 ? `${current}*${count}` : current);
        current = codes[i];
        count = 1;
      }
    }
    runs.push(count > 1 ? `${current}*${count}` : current);
    return runs.join(',');
  };
  
  // Decode tile atlas
  forge.decodeTileAtlas = function(str) {
    const atlasMap = { 'gd': 'atlas-grass-dirt', 'gw': 'atlas-grass-water' };
    const tiles = [];
    
    if (!str) return tiles;
    
    const runs = str.split(',');
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
    return tiles;
  };
  
  // Simple LZW-ish string compression
  forge.compressString = function(str) {
    // For now, just return as-is - can add LZ compression later
    // Browser's native compression via CompressionStream is async
    return str;
  };
  
  // Decompress string
  forge.decompressString = function(str) {
    return str;
  };
  
  // Import map data (supports v1 JSON and v2 .aether format)
  forge.importMap = function(mapData) {
    if (!window.Field) return;
    
    // Detect format version and normalize
    let width, height, seed, terrainTypes, tiles, chunkMask;
    
    if (mapData.v === 2) {
      // New compact format
      width = mapData.w;
      height = mapData.h;
      seed = mapData.s;
      terrainTypes = this.decodeRLE(mapData.t);
      tiles = this.decodeTileAtlas(mapData.ta);
      
      // Decode chunk mask from binary string
      const chunksX = Math.ceil(width / (mapData.cs || 16));
      const chunksZ = Math.ceil(height / (mapData.cs || 16));
      chunkMask = new Map();
      if (mapData.cm) {
        let i = 0;
        for (let cz = 0; cz < chunksZ; cz++) {
          for (let cx = 0; cx < chunksX; cx++) {
            chunkMask.set(`${cx},${cz}`, mapData.cm[i] === '1');
            i++;
          }
        }
      }
      console.log(`📥 Importing .aeg map: ${width}x${height}`);
    } else {
      // Legacy v1 JSON format
      width = mapData.width;
      height = mapData.height;
      seed = mapData.seed;
      terrainTypes = mapData.terrainTypes;
      tiles = mapData.tiles;
      chunkMask = null; // v1 didn't have chunk mask
      console.log(`📥 Importing legacy map: ${width}x${height}`);
    }
    
    // Pre-enable billboard mode for large maps
    const totalTiles = width * height;
    if (totalTiles >= 16384 && gfx && gfx.setBillboardOnlyMode) {
      gfx.setBillboardOnlyMode(true);
      const btn = document.getElementById('billboard-toggle');
      if (btn) {
        btn.classList.add('active');
        btn.textContent = '🖼️ Billboard ON';
      }
    }
    
    // Dispose old field
    if (window.liveField && window.liveField.dispose) {
      window.liveField.dispose();
    }
    
    // Create new field with imported dimensions
    window.liveField = new Field({ width, height, seed });
    const field = window.liveField;
    
    // Override terrain data
    if (terrainTypes) {
      for (let i = 0; i < terrainTypes.length; i++) {
        field.terrainTypes[i] = terrainTypes[i];
      }
    }
    
    // Override tile data
    if (tiles) {
      for (let i = 0; i < tiles.length; i++) {
        field.tiles[i].type = tiles[i].type;
        field.tiles[i].atlasName = tiles[i].atlasName || 'atlas-grass-dirt';
      }
    }
    
    // Apply chunk mask if present
    if (chunkMask) {
      field.chunkMask = chunkMask;
    }
    
    // Load chunks and rebuild table
    this.loadAllChunks(true);
    this.rebuildTable();
    
    // Restore manually placed resources (v2 format)
    if (mapData.r) {
      this._placedKeys = new Set();
      this._placedResources = new Map();
      
      const resources = mapData.r.split(';');
      for (const res of resources) {
        const [key, type] = res.split(':');
        const [x, y] = key.split(',').map(Number);
        
        // Temporarily set resource type and place it
        const oldResource = this.state.currentResource;
        this.state.currentResource = type;
        this._lastResourcePlace = 0; // Reset throttle
        this.placeResourceAt({ x, y });
        this.state.currentResource = oldResource;
      }
      console.log(`🌲 Restored ${resources.length} placed resources`);
    }
    
    // Apply visibility settings
    setTimeout(() => this.applyLayerVisibility(), 100);
    setTimeout(() => this.applyLayerVisibility(), 500);
    
    console.log('✅ Map imported');
  };
  
  // Setup UI
  forge.setupUI = function() {
    if (!ENABLE_FORGE) return;
    
    const forgeUI = document.createElement('div');
    forgeUI.id = 'forge-ui';
    forgeUI.innerHTML = `
      <div class="forge-panel">
        <h2>🔨 Forge</h2>
        
        <div class="forge-section">
          <h3>Layers</h3>
          <div class="forge-buttons">
            <button id="layer-table" class="forge-btn" onclick="forge.setEditingLayer('table')">🎱 Table</button>
            <button id="layer-terrain" class="forge-btn active" onclick="forge.setEditingLayer('terrain')">🗺️ Terrain</button>
            <button id="layer-resources" class="forge-btn" onclick="forge.setEditingLayer('resources')">🌲 Resources</button>
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="vis-table" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('table')">👁️ Table</button>
            <button id="vis-terrain" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('terrain')">👁️ Terrain</button>
            <button id="vis-resources" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('resources')">👁️ Resources</button>
          </div>
        </div>
        
        <div id="table-panel" class="forge-section" style="display:none;">
          <h3>Table Shape</h3>
          <p style="font-size:11px;opacity:0.7;">Click chunks to toggle. Builds the pool table boundary.</p>
          <div class="forge-buttons">
            <button class="forge-btn" onclick="forge.enableAllChunks()">Enable All</button>
            <button class="forge-btn" onclick="forge.rebuildTable()">🔄 Rebuild Table</button>
          </div>
        </div>
        
        <div id="terrain-panel" class="forge-section">
          <h3>Terrain</h3>
          <div class="forge-buttons">
            <button id="brush-grass" class="forge-btn active" onclick="forge.setBrush('grass')">🌿 Grass</button>
            <button id="brush-dirt" class="forge-btn" onclick="forge.setBrush('dirt')">🟫 Dirt</button>
            <button id="brush-water" class="forge-btn" onclick="forge.setBrush('water')">🌊 Water</button>
          </div>
          <h3>Brush Size: <span id="brush-size-label">1</span></h3>
          <input type="range" id="brush-size-slider" min="0" max="5" value="1" 
                 oninput="forge.setBrushSize(this.value)">
        </div>
        
        <div id="resource-panel" class="forge-section" style="display:none;">
          <h3>Paint Resource</h3>
          <div class="forge-buttons">
            <button id="res-trees" class="forge-btn active" onclick="forge.setResource('trees')">🌲 Trees</button>
            <button id="res-rocks_plain" class="forge-btn" onclick="forge.setResource('rocks_plain')">🪨 Rocks</button>
            <button id="res-rocks_moss" class="forge-btn" onclick="forge.setResource('rocks_moss')">🪨 Mossy</button>
            <button id="res-rocks_snow" class="forge-btn" onclick="forge.setResource('rocks_snow')">🏔️ Large</button>
            <button id="res-eraser" class="forge-btn" onclick="forge.setResource('eraser')">🧹 Eraser</button>
          </div>
          <h3 style="margin-top:12px;">Quick Actions</h3>
          <div class="forge-buttons">
            <button class="forge-btn" onclick="forge.populateResources()">🌲 Auto-Fill</button>
            <button class="forge-btn" onclick="forge.clearResources()">🗑️ Clear All</button>
          </div>
        </div>
        
        <div class="forge-section">
          <h3>Map</h3>
          <div class="forge-row">
            <label>Size:</label>
            <select id="map-size">
              <option value="32">32x32 (Tiny)</option>
              <option value="64" selected>64x64 (Small)</option>
              <option value="128">128x128 (Medium)</option>
              <option value="256">256x256 (Large)</option>
            </select>
          </div>
          <div class="forge-row">
            <label>Seed:</label>
            <input type="number" id="map-seed" value="12345" style="width: 80px;">
            <button class="forge-btn-sm" onclick="document.getElementById('map-seed').value = Math.floor(Math.random()*1000000)">🎲</button>
          </div>
          <button class="forge-btn" onclick="forge.generateNewMap(
            parseInt(document.getElementById('map-size').value),
            parseInt(document.getElementById('map-size').value),
            parseInt(document.getElementById('map-seed').value)
          )">🗺️ Generate</button>
        </div>
        
        <div class="forge-section">
          <h3>Fill</h3>
          <div class="forge-buttons">
            <button class="forge-btn" onclick="forge.fillMap('grass')">All Grass</button>
            <button class="forge-btn" onclick="forge.fillMap('dirt')">All Dirt</button>
            <button class="forge-btn" onclick="forge.fillMap('water')">All Water</button>
          </div>
        </div>
        
        <div class="forge-section">
          <h3>File</h3>
          <div class="forge-buttons">
            <button class="forge-btn" onclick="forge.exportMap()">💾 Export</button>
            <button class="forge-btn" onclick="document.getElementById('import-file').click()">📂 Import</button>
            <input type="file" id="import-file" accept=".aeg,.json" style="display:none" 
                   onchange="forge.handleImport(this.files[0])">
          </div>
        </div>
        
        <div class="forge-section">
          <h3>Performance</h3>
          <div class="forge-buttons">
            <button id="billboard-toggle" class="forge-btn" onclick="forge.toggleBillboardMode()">🖼️ Billboard Only</button>
          </div>
        </div>
        
        <div class="forge-section forge-help">
          <h3>Controls</h3>
          <div>🖱️ Click+drag to paint</div>
          <div>WASD - Move camera</div>
          <div>Scroll - Zoom</div>
          <div>F9 - Inspector</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(forgeUI);
    console.log('🎨 Forge UI created');
  };
  
  // Set current tool (terrain or resource)
  // Set editing layer (table, terrain, resources)
  forge.setEditingLayer = function(layer) {
    this.state.editingLayer = layer;
    this.state.currentTool = layer === 'resources' ? 'resource' : layer;
    
    // Update layer button states
    document.getElementById('layer-table').classList.toggle('active', layer === 'table');
    document.getElementById('layer-terrain').classList.toggle('active', layer === 'terrain');
    document.getElementById('layer-resources').classList.toggle('active', layer === 'resources');
    
    // Show/hide panels
    document.getElementById('table-panel').style.display = layer === 'table' ? 'block' : 'none';
    document.getElementById('terrain-panel').style.display = layer === 'terrain' ? 'block' : 'none';
    document.getElementById('resource-panel').style.display = layer === 'resources' ? 'block' : 'none';
    
    // Update chunk grid overlay visibility
    this.updateChunkGridOverlay(layer === 'table');
    
    console.log(`📐 Editing layer: ${layer}`);
  };
  
  // Toggle layer visibility
  forge.toggleLayerVisibility = function(layer) {
    this.state.layers[layer] = !this.state.layers[layer];
    const visible = this.state.layers[layer];
    
    // Update button state
    const btn = document.getElementById(`vis-${layer}`);
    if (btn) {
      btn.classList.toggle('active', visible);
      btn.textContent = (visible ? '👁️ ' : '🚫 ') + layer.charAt(0).toUpperCase() + layer.slice(1);
    }
    
    // Apply visibility
    this.applyLayerVisibility();
    
    console.log(`${visible ? '👁️' : '🚫'} Layer ${layer}: ${visible ? 'visible' : 'hidden'}`);
  };
  
  // Apply layer visibility to scene
  forge.applyLayerVisibility = function() {
    const field = window.liveField;
    if (!field || !gfx) return;
    
    // Table visibility (dynamic parts)
    if (this._dynamicTableParts) {
      this._dynamicTableParts.forEach(mesh => {
        if (mesh && mesh.setEnabled) mesh.setEnabled(this.state.layers.table);
      });
    }
    // Also static table (if any parts are still visible)
    if (gfx.table && gfx.table.parent) {
      gfx.table.parent.setEnabled(this.state.layers.table);
    }
    
    // Terrain visibility (chunk meshes) - also respect chunk mask
    for (const [key, chunk] of field.chunks) {
      if (chunk.mesh) {
        const enabled = field.chunkMask ? field.chunkMask.get(key) !== false : true;
        chunk.mesh.setEnabled(this.state.layers.terrain && enabled);
      }
    }
    
    // Resources visibility - use LOD system which tracks all resource models
    // Also check chunk mask to hide resources on disabled chunks
    const showResources = this.state.layers.resources;
    const isBillboardMode = gfx.isBillboardOnlyMode && gfx.isBillboardOnlyMode();
    
    if (gfx.lodModels) {
      gfx.lodModels.forEach(lod => {
        if (!lod.model || lod.model.isDisposed()) return;
        
        // Check if this model is in an enabled chunk (use stored chunkKey if available)
        let inEnabledChunk = true;
        if (field.chunkMask && lod.chunkKey) {
          inEnabledChunk = field.chunkMask.get(lod.chunkKey) !== false;
        }
        
        const shouldShow = showResources && inEnabledChunk;
        
        if (shouldShow) {
          // Resources visible - respect billboard mode
          if (isBillboardMode) {
            lod.model.setEnabled(false);
            if (lod.billboard) lod.billboard.setEnabled(true);
          } else {
            lod.model.setEnabled(true);
            if (lod.billboard) lod.billboard.setEnabled(false);
          }
        } else {
          // Resources hidden (either layer off or chunk disabled)
          lod.model.setEnabled(false);
          if (lod.billboard) lod.billboard.setEnabled(false);
        }
      });
    }
    
    // Also manually placed resources - check chunk mask by tile key
    const chunkSize = field.chunkSize;
    if (this._placedResources) {
      for (const [key, mesh] of this._placedResources) {
        if (mesh && mesh.setEnabled) {
          // Parse tile coords from key "x,y"
          const [tx, ty] = key.split(',').map(Number);
          const cx = Math.floor(tx / chunkSize);
          const cz = Math.floor(ty / chunkSize);
          const inEnabledChunk = !field.chunkMask || field.chunkMask.get(`${cx},${cz}`) !== false;
          mesh.setEnabled(this.state.layers.resources && inEnabledChunk);
        }
      }
    }
  };
  
  // Toggle a chunk's enabled state
  forge._tableRebuildTimeout = null;
  
  forge.toggleChunk = function(chunkX, chunkZ) {
    const field = window.liveField;
    if (!field || !field.chunkMask) return;
    
    const key = `${chunkX},${chunkZ}`;
    const current = field.chunkMask.get(key);
    const newState = !current;
    field.chunkMask.set(key, newState);
    
    // Update chunk mesh visibility immediately
    const chunk = field.chunks.get(key);
    if (chunk && chunk.mesh) {
      chunk.mesh.setEnabled(newState && this.state.layers.terrain);
    }
    
    // Also hide/show resources in this chunk via LOD system (use stored chunkKey)
    if (gfx.lodModels) {
      const isBillboardMode = gfx.isBillboardOnlyMode && gfx.isBillboardOnlyMode();
      
      gfx.lodModels.forEach(lod => {
        if (!lod.model || lod.model.isDisposed()) return;
        if (lod.chunkKey !== key) return; // Only affect this chunk
        
        const showResource = newState && this.state.layers.resources;
        
        if (showResource) {
          lod.model.setEnabled(!isBillboardMode);
          if (lod.billboard) lod.billboard.setEnabled(isBillboardMode);
        } else {
          lod.model.setEnabled(false);
          if (lod.billboard) lod.billboard.setEnabled(false);
        }
      });
    }
    
    // Update just this cell in the grid overlay (fast)
    this.updateChunkOverlayCell(chunkX, chunkZ, newState);
    
    // Debounce table rebuild - wait for user to stop clicking
    clearTimeout(this._tableRebuildTimeout);
    this._tableRebuildTimeout = setTimeout(() => {
      this.rebuildTable();
    }, 300);
    
    console.log(`🧱 Chunk ${key}: ${newState ? 'enabled' : 'disabled'}`);
  };
  
  // Update just one cell in the chunk overlay (faster than full rebuild)
  forge.updateChunkOverlayCell = function(chunkX, chunkZ, enabled) {
    if (!this._chunkGridOverlay) return;
    
    const overlay = this._chunkGridOverlay.find(m => 
      m.metadata && m.metadata.chunkX === chunkX && m.metadata.chunkZ === chunkZ
    );
    
    if (overlay && overlay.material) {
      overlay.material.diffuseColor = enabled ? 
        new BABYLON.Color3(0.2, 0.8, 0.2) : 
        new BABYLON.Color3(0.8, 0.2, 0.2);
    }
  };
  
  // Enable all chunks
  forge.enableAllChunks = function() {
    const field = window.liveField;
    if (!field || !field.chunkMask) return;
    
    for (const key of field.chunkMask.keys()) {
      field.chunkMask.set(key, true);
    }
    
    this.updateChunkGridOverlay(true);
    this.applyLayerVisibility();
    this.rebuildTable();
    console.log('✅ All chunks enabled');
  };
  
  // Create/update chunk grid overlay for table editing
  forge.updateChunkGridOverlay = function(show) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    // Remove existing overlay
    if (this._chunkGridOverlay) {
      this._chunkGridOverlay.forEach(m => m.dispose());
      this._chunkGridOverlay = [];
    }
    
    if (!show) return;
    
    this._chunkGridOverlay = [];
    const chunkWorldSize = field.chunkSize * TILE_SIZE;
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = `${cx},${cz}`;
        const enabled = field.chunkMask.get(key) !== false;
        
        // Create a semi-transparent plane for each chunk
        const plane = BABYLON.MeshBuilder.CreatePlane(`chunkOverlay_${key}`, {
          width: chunkWorldSize * 0.95,
          height: chunkWorldSize * 0.95
        }, gfx.scene);
        
        plane.position.x = cx * chunkWorldSize + chunkWorldSize / 2;
        plane.position.y = 2; // Float above terrain
        plane.position.z = cz * chunkWorldSize + chunkWorldSize / 2;
        plane.rotation.x = Math.PI / 2; // Lay flat
        
        // Material based on enabled state
        const mat = new BABYLON.StandardMaterial(`chunkMat_${key}`, gfx.scene);
        mat.diffuseColor = enabled ? 
          new BABYLON.Color3(0.2, 0.8, 0.2) : // Green = enabled
          new BABYLON.Color3(0.8, 0.2, 0.2);  // Red = disabled
        mat.alpha = 0.3;
        mat.backFaceCulling = false;
        plane.material = mat;
        
        // Store chunk coords for click detection
        plane.metadata = { chunkX: cx, chunkZ: cz };
        
        this._chunkGridOverlay.push(plane);
      }
    }
  };
  
  // Rebuild the table to match chunk mask shape
  forge.rebuildTable = function() {
    const field = window.liveField;
    if (!field || !field.chunkMask || !gfx || !gfx.scene) return;
    
    console.log('🔄 Rebuilding table from chunk mask...');
    
    // Dispose old dynamic table parts
    if (this._dynamicTableParts) {
      this._dynamicTableParts.forEach(m => m.dispose());
    }
    this._dynamicTableParts = [];
    
    // Hide the original static table parts (except floor which we'll recreate)
    const table = gfx.table;
    if (table && table.parts) {
      Object.values(table.parts).forEach(part => {
        if (part.mesh) part.mesh.isVisible = false;
      });
    }
    
    const chunkWorldSize = field.chunkSize * TILE_SIZE;
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    
    // Find boundary edges by checking each chunk's neighbors
    const edges = []; // {x, z, direction: 'N'|'E'|'S'|'W'}
    const corners = []; // {x, z, type: 'convex'|'concave', corner: 'NE'|'SE'|'SW'|'NW'}
    
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = `${cx},${cz}`;
        if (field.chunkMask.get(key) === false) continue; // Skip disabled chunks
        
        // Check each neighbor - if neighbor is disabled or out of bounds, we have an edge
        const neighbors = {
          N: cz < chunksZ - 1 ? field.chunkMask.get(`${cx},${cz + 1}`) !== false : false,
          S: cz > 0 ? field.chunkMask.get(`${cx},${cz - 1}`) !== false : false,
          E: cx < chunksX - 1 ? field.chunkMask.get(`${cx + 1},${cz}`) !== false : false,
          W: cx > 0 ? field.chunkMask.get(`${cx - 1},${cz}`) !== false : false
        };
        
        if (!neighbors.N) edges.push({ cx, cz, dir: 'N' });
        if (!neighbors.S) edges.push({ cx, cz, dir: 'S' });
        if (!neighbors.E) edges.push({ cx, cz, dir: 'E' });
        if (!neighbors.W) edges.push({ cx, cz, dir: 'W' });
        
        // Detect corners based on adjacent edges
        // Convex corners (outer) - two adjacent edges meet
        if (!neighbors.N && !neighbors.E) corners.push({ cx, cz, type: 'convex', corner: 'NE' });
        if (!neighbors.N && !neighbors.W) corners.push({ cx, cz, type: 'convex', corner: 'NW' });
        if (!neighbors.S && !neighbors.E) corners.push({ cx, cz, type: 'convex', corner: 'SE' });
        if (!neighbors.S && !neighbors.W) corners.push({ cx, cz, type: 'convex', corner: 'SW' });
        
        // Concave corners (inner) - check diagonal neighbors
        const diagNE = (cx < chunksX - 1 && cz < chunksZ - 1) ? field.chunkMask.get(`${cx + 1},${cz + 1}`) !== false : false;
        const diagNW = (cx > 0 && cz < chunksZ - 1) ? field.chunkMask.get(`${cx - 1},${cz + 1}`) !== false : false;
        const diagSE = (cx < chunksX - 1 && cz > 0) ? field.chunkMask.get(`${cx + 1},${cz - 1}`) !== false : false;
        const diagSW = (cx > 0 && cz > 0) ? field.chunkMask.get(`${cx - 1},${cz - 1}`) !== false : false;
        
        if (neighbors.N && neighbors.E && !diagNE) corners.push({ cx, cz, type: 'concave', corner: 'NE' });
        if (neighbors.N && neighbors.W && !diagNW) corners.push({ cx, cz, type: 'concave', corner: 'NW' });
        if (neighbors.S && neighbors.E && !diagSE) corners.push({ cx, cz, type: 'concave', corner: 'SE' });
        if (neighbors.S && neighbors.W && !diagSW) corners.push({ cx, cz, type: 'concave', corner: 'SW' });
      }
    }
    
    console.log(`   Found ${edges.length} edges, ${corners.length} corners`);
    
    // Create edge pieces
    const edgeMat = table.parts.materials.side;
    const edgeHeight = 1.2;  // Taller edges
    const edgeThickness = 4.0;
    const edgeY = 0.5;       // Raised up a bit
    const edgeAngle = 0.11;
    
    edges.forEach(edge => {
      const worldX = edge.cx * chunkWorldSize;
      const worldZ = edge.cz * chunkWorldSize;
      
      const mesh = BABYLON.MeshBuilder.CreateBox(`edge_${edge.cx}_${edge.cz}_${edge.dir}`, { size: 1 }, gfx.scene);
      mesh.material = edgeMat;
      
      switch (edge.dir) {
        case 'N':
          mesh.position.set(worldX + chunkWorldSize / 2, edgeY, worldZ + chunkWorldSize);
          mesh.scaling.set(chunkWorldSize, edgeHeight, edgeThickness);
          mesh.rotation.set(edgeAngle, 0, 0);
          break;
        case 'S':
          mesh.position.set(worldX + chunkWorldSize / 2, edgeY, worldZ);
          mesh.scaling.set(chunkWorldSize, edgeHeight, edgeThickness);
          mesh.rotation.set(-edgeAngle, 0, 0);
          break;
        case 'E':
          mesh.position.set(worldX + chunkWorldSize, edgeY, worldZ + chunkWorldSize / 2);
          mesh.scaling.set(edgeThickness, edgeHeight, chunkWorldSize);
          mesh.rotation.set(0, 0, -edgeAngle);
          break;
        case 'W':
          mesh.position.set(worldX, edgeY, worldZ + chunkWorldSize / 2);
          mesh.scaling.set(edgeThickness, edgeHeight, chunkWorldSize);
          mesh.rotation.set(0, 0, edgeAngle);
          break;
      }
      
      this._dynamicTableParts.push(mesh);
    });
    
    // Create corner markers
    const cornerMat = table.parts.materials.corner;
    const cornerSize = 7.0;
    const cornerHeight = 3.0;  // Taller corners
    const cornerY = 0.3;       // Raised up
    
    corners.forEach(corner => {
      const worldX = corner.cx * chunkWorldSize;
      const worldZ = corner.cz * chunkWorldSize;
      
      const mesh = BABYLON.MeshBuilder.CreateBox(`corner_${corner.cx}_${corner.cz}_${corner.corner}`, { size: 1 }, gfx.scene);
      mesh.material = cornerMat;
      mesh.scaling.set(cornerSize, cornerHeight, cornerSize);
      
      // Position at the actual corner of the chunk
      let px = worldX, pz = worldZ;
      if (corner.corner.includes('E')) px += chunkWorldSize;
      if (corner.corner.includes('N')) pz += chunkWorldSize;
      
      mesh.position.set(px, cornerY, pz);
      this._dynamicTableParts.push(mesh);
    });
    
    // Create floor for enabled chunks
    const floorMat = table.parts.materials.floor;
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = `${cx},${cz}`;
        if (field.chunkMask.get(key) === false) continue;
        
        const worldX = cx * chunkWorldSize;
        const worldZ = cz * chunkWorldSize;
        
        const floor = BABYLON.MeshBuilder.CreateBox(`floor_${cx}_${cz}`, { size: 1 }, gfx.scene);
        floor.material = floorMat;
        floor.position.set(worldX + chunkWorldSize / 2, -0.777, worldZ + chunkWorldSize / 2);
        floor.scaling.set(chunkWorldSize, 0.4, chunkWorldSize);
        
        this._dynamicTableParts.push(floor);
      }
    }
    
    console.log(`✅ Table rebuilt with ${this._dynamicTableParts.length} pieces`);
  };
  
  // Legacy setTool for backwards compatibility
  forge.setTool = function(tool) {
    if (tool === 'terrain') {
      this.setEditingLayer('terrain');
    } else if (tool === 'resource') {
      this.setEditingLayer('resources');
    }
  };
  
  // Toggle billboard-only mode for performance on large maps
  forge.toggleBillboardMode = function() {
    if (!gfx || !gfx.setBillboardOnlyMode) return;
    
    const newState = !gfx.isBillboardOnlyMode();
    gfx.setBillboardOnlyMode(newState);
    
    // Update button state
    const btn = document.getElementById('billboard-toggle');
    if (btn) {
      btn.classList.toggle('active', newState);
      btn.textContent = newState ? '🖼️ Billboard ON' : '🖼️ Billboard Only';
    }
  };
  
  // Auto-enable billboard mode for large maps
  forge.checkAutoPerformanceMode = function() {
    const field = window.liveField;
    if (!field) return;
    
    const totalTiles = field.width * field.height;
    const btn = document.getElementById('billboard-toggle');
    
    if (totalTiles >= 16384) { // 128x128 or larger
      if (gfx && gfx.setBillboardOnlyMode && !gfx.isBillboardOnlyMode()) {
        gfx.setBillboardOnlyMode(true);
        if (btn) {
          btn.classList.add('active');
          btn.textContent = '🖼️ Billboard ON';
        }
        console.log('⚡ Auto-enabled billboard mode for large map');
      }
    } else {
      // For smaller maps, respect the current toggle state (don't auto-disable)
      // Just sync the button state with current mode
      if (btn && gfx.isBillboardOnlyMode) {
        const isOn = gfx.isBillboardOnlyMode();
        btn.classList.toggle('active', isOn);
        btn.textContent = isOn ? '🖼️ Billboard ON' : '🖼️ Billboard Only';
      }
    }
  };
  
  // Set brush type
  forge.setBrush = function(type) {
    this.state.currentBrush = type;
    
    // Update button states
    document.querySelectorAll('.forge-btn').forEach(btn => {
      if (btn.id && btn.id.startsWith('brush-')) {
        btn.classList.toggle('active', btn.id === `brush-${type}`);
      }
    });
    
    console.log(`🖌️ Brush: ${type}`);
  };
  
  // Set resource type for manual painting
  forge.setResource = function(type) {
    this.state.currentResource = type;
    
    // Update button states
    document.querySelectorAll('.forge-btn').forEach(btn => {
      if (btn.id && btn.id.startsWith('res-')) {
        btn.classList.toggle('active', btn.id === `res-${type}`);
      }
    });
    
    console.log(`🌲 Resource: ${type}`);
  };
  
  // Populate resources on all chunks (like the game does)
  forge.populateResources = function() {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene || !gfx.placeDecorationsOnChunk) {
      console.log('❌ Cannot populate resources');
      return;
    }
    
    // First clear existing resources and registries
    this.clearResources();
    if (gfx.clearResourceRegistries) {
      gfx.clearResourceRegistries();
    }
    
    console.log('🌲 Auto-populating resources (trees on grass, rocks on dirt)...');
    
    // Count terrain types for feedback
    let grassCount = 0, dirtCount = 0;
    for (let i = 0; i < field.terrainTypes.length; i++) {
      if (field.terrainTypes[i] === 3) grassCount++;
      else if (field.terrainTypes[i] === 2) dirtCount++;
    }
    console.log(`   Terrain: ${grassCount} grass tiles, ${dirtCount} dirt tiles`);
    
    // Place decorations on enabled chunks only
    for (const [key, chunk] of field.chunks) {
      // Skip disabled chunks
      if (field.chunkMask && field.chunkMask.get(key) === false) continue;
      
      if (chunk.tiles && chunk.tiles.length > 0) {
        chunk.models = gfx.placeDecorationsOnChunk(chunk, gfx.scene);
      }
    }
    
    console.log('✅ Resources populating (async load)');
  };
  
  // Clear all resources from the map
  forge.clearResources = function() {
    const field = window.liveField;
    if (!field) return;
    
    console.log('🗑️ Clearing resources...');
    
    let cleared = 0;
    
    // Clear chunk-based resources (auto-generated)
    for (const [key, chunk] of field.chunks) {
      if (chunk.models) {
        chunk.models.forEach(m => {
          if (m.model && m.model.root) {
            m.model.root.dispose();
            cleared++;
          }
        });
        chunk.models = [];
      }
    }
    
    // Clear manually placed resources
    if (this._placedResources) {
      for (const [key, mesh] of this._placedResources) {
        if (mesh && mesh.dispose) {
          mesh.dispose();
          cleared++;
        }
      }
      this._placedResources = new Map();
    }
    
    // Reset tracking
    this._placedKeys = new Set();
    
    console.log(`✅ Cleared ${cleared} resources`);
  };
  
  // Set brush size
  forge.setBrushSize = function(size) {
    this.state.brushSize = parseInt(size);
    document.getElementById('brush-size-label').textContent = size;
  };
  
  // Handle file import (.aether or .json)
  forge.handleImport = function(file) {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let content = e.target.result;
        
        // Decompress if needed
        content = this.decompressString(content);
        
        const mapData = JSON.parse(content);
        this.importMap(mapData);
      } catch (err) {
        console.error('Failed to import map:', err);
        alert('Failed to import map file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  
  // Export forge object
  window.forge = forge;
  
})(window.forge || {});
