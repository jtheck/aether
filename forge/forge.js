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
    editingLayer: 'terrain',    // 'table', 'terrain', 'resources', or 'spawns'
    
    // Map metadata
    mapName: '',
    mapAuthor: '',
    
    // Game type compatibility
    gameTypes: {
      'adventure': false,
      '1v1': true,
      'koth': false,
      'teams': false
    },
    
    // Spawn points (array of {x, y, team} objects)
    spawnPoints: [],
    
    // Buildings (array of {x, y, type, rotation} objects)
    buildings: [],
    currentBuilding: 'agora'
  };
  
  // Spawn point radius (same as game's spawnZoneRadius for terrain flattening)
  forge.spawnZoneRadius = 6;
  
  // Placeable buildings for map editor
  forge.buildingTypes = {
    agora:    { name: 'Agora',    icon: '🏛️' },
    camp:     { name: 'Camp',     icon: '⛺' },
    tower:    { name: 'Tower',    icon: '🗼' },
    gate:     { name: 'Gate',     icon: '🚪' },
    farm:     { name: 'Farm',     icon: '🌾' },
    windmill: { name: 'Windmill', icon: '🌀' }
  };
  
  // Symmetry modes
  forge.symmetryModes = {
    none: { name: 'None', icon: '⬜' },
    mirrorX: { name: 'Mirror ↔', icon: '↔️' },
    mirrorY: { name: 'Mirror ↕', icon: '↕️' },
    rotate180: { name: 'Rotate 180°', icon: '🔄' },
    rotate90: { name: 'Rotate 90°', icon: '↻' },
    quad: { name: 'Quad Mirror', icon: '✚' }
  };

  // Terrain types map to the 2-terrain system (grass/dirt)
  forge.terrainTypes = {
    grass: { name: 'Grass', terrainType: 3, solidTile: 6, atlas: 'atlas-grass-dirt' },   // Type 3 = grass
    dirt:  { name: 'Dirt',  terrainType: 2, solidTile: 12, atlas: 'atlas-grass-dirt' },  // Type 2 = dirt
    water: { name: 'Water', terrainType: 1, solidTile: 12, atlas: 'atlas-grass-water' }  // Type 1 = water
  };
  
  // Available resources for manual placement
  // footprint = radius in tiles that this resource occupies (0 = just center tile)
  forge.resourceTypes = {
    trees:       { name: 'Trees',       path: 'assets/models/trees.glb',       scale: 0.9,  footprint: 0 },
    rocks_plain: { name: 'Rocks',       path: 'assets/models/rocks_plain.glb', scale: 3.0,  footprint: 0 },
    rocks_moss:  { name: 'Mossy Rocks', path: 'assets/models/rocks_moss.glb',  scale: 7.5,  footprint: 1 },
    rocks_snow:  { name: 'Large Rocks', path: 'assets/models/rocks_snow.glb',  scale: 11.5, footprint: 2 }
  };
  
  // Get all tiles occupied by a resource at position
  forge.getResourceFootprint = function(pos, resourceType) {
    const footprint = resourceType.footprint || 0;
    const tiles = [];
    
    for (let dx = -footprint; dx <= footprint; dx++) {
      for (let dy = -footprint; dy <= footprint; dy++) {
        // Circular footprint
        if (Math.sqrt(dx*dx + dy*dy) <= footprint + 0.5) {
          tiles.push({ x: pos.x + dx, y: pos.y + dy });
        }
      }
    }
    return tiles;
  };
  
  // Get all occupied tiles (manual + auto-generated with footprints)
  forge.getOccupiedTiles = function() {
    const occupied = new Set();
    
    // Manual placements
    if (this._placedKeys) {
      this._placedKeys.forEach(k => occupied.add(k));
    }
    
    // Auto-generated from LOD models (skip disposed/erased)
    if (gfx && gfx.lodModels) {
      gfx.lodModels.forEach(lod => {
        if (!lod.model || lod.model.isDisposed()) return;
        const pos = lod.model.position;
        const tx = Math.floor(pos.x / TILE_SIZE);
        const tz = Math.floor(pos.z / TILE_SIZE);
        
        // Skip if this was erased
        if (this._erasedAutoResources && this._erasedAutoResources.has(`${tx},${tz}`)) return;
        
        // Determine footprint based on scale (matches resourceTypes)
        const scale = lod.model.scaling ? lod.model.scaling.x : 1;
        let footprint = 0;
        if (scale >= 10) footprint = 2;       // Large rocks (scale 11.5)
        else if (scale >= 6) footprint = 1;   // Mossy rocks (scale 7.5)
        // Trees (0.9) and plain rocks (3.0) = footprint 0
        
        // Add all tiles in footprint
        for (let dx = -footprint; dx <= footprint; dx++) {
          for (let dz = -footprint; dz <= footprint; dz++) {
            if (Math.sqrt(dx*dx + dz*dz) <= footprint + 0.5) {
              occupied.add(`${tx + dx},${tz + dz}`);
            }
          }
        }
      });
    }
    
    return occupied;
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
    
    // Prevent context menu when editing spawns/buildings (right-click removes)
    canvas.addEventListener('contextmenu', (e) => {
      if (this.state.editingLayer === 'spawns' || this.state.editingLayer === 'buildings') {
        e.preventDefault();
      }
    });
    
    // Setup Forge-specific camera controls
    this.setupCameraControls(canvas);

    console.log('🖌️ Painting system ready');
  };
  
  // Forge camera controls - smooth, consistent movement
  forge.setupCameraControls = function(canvas) {
    if (!canvas || !gfx || !gfx.camera) return;
    
    const cam = gfx.camera;
    
    // CRITICAL: Disable ALL built-in camera controls first
    // The index.html re-enables them, so we must disable again
    if (cam.inputs) {
      if (cam.inputs.attached.pointers) {
        try { cam.inputs.attached.pointers.detachControl(); } catch(e) {}
      }
      if (cam.inputs.attached.mousewheel) {
        try { cam.inputs.attached.mousewheel.detachControl(); } catch(e) {}
      }
      if (cam.inputs.attached.keyboard) {
        try { cam.inputs.attached.keyboard.detachControl(); } catch(e) {}
      }
    }
    cam.detachControl();
    
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    // Right-click drag to pan (more natural for editors)
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 1) { // Right or middle click
        isPanning = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        e.preventDefault();
      }
    });
    
    canvas.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      
      const deltaX = e.clientX - lastMouseX;
      const deltaY = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      
      // Calculate camera-relative movement directions
      const forward = cam.getForwardRay().direction;
      const right = BABYLON.Vector3.Cross(forward, BABYLON.Vector3.Up()).normalize();
      
      // Project to ground plane
      const groundRight = new BABYLON.Vector3(right.x, 0, right.z).normalize();
      const groundForward = new BABYLON.Vector3(forward.x, 0, forward.z).normalize();
      
      // FIXED sensitivity - same feel at all zoom levels
      const PAN_SENSITIVITY = 0.6;
      
      const moveX = (-deltaX * groundRight.x - deltaY * groundForward.x) * PAN_SENSITIVITY;
      const moveZ = (-deltaX * groundRight.z - deltaY * groundForward.z) * PAN_SENSITIVITY;
      
      if (gfx.cameraTarget) {
        gfx.cameraTarget.position.x += moveX;
        gfx.cameraTarget.position.z += moveZ;
      } else {
        // Fallback: move camera position directly
        cam.position.x += moveX;
        cam.position.z += moveZ;
        if (cam.target) {
          cam.target.x += moveX;
          cam.target.z += moveZ;
        }
      }
    });
    
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2 || e.button === 1 || e.button === 0) {
        isPanning = false;
      }
    });
    
    canvas.addEventListener('mouseleave', () => {
      isPanning = false;
    });
    
    // Wheel to zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSpeed = 0.1;
      const delta = e.deltaY * zoomSpeed;
      
      if (cam.radius !== undefined) {
        cam.radius = Math.max(20, Math.min(300, cam.radius + delta));
      } else if (cam.position) {
        cam.position.y = Math.max(20, Math.min(300, cam.position.y + delta));
      }
    }, { passive: false });
    
    // ESDF keyboard controls (matches game)
    const keyState = { e: false, s: false, d: false, f: false, w: false, r: false };
    const MOVE_SPEED = 5.0; // Fast keyboard movement for large maps
    
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key in keyState) keyState[key] = true;
    });
    
    document.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key in keyState) keyState[key] = false;
    });
    
    // Animation loop for smooth keyboard movement
    const updateCamera = () => {
      if (!gfx.camera) return;
      
      const cam = gfx.camera;
      const forward = cam.getForwardRay().direction;
      const right = BABYLON.Vector3.Cross(forward, BABYLON.Vector3.Up()).normalize();
      
      const groundRight = new BABYLON.Vector3(right.x, 0, right.z).normalize();
      const groundForward = new BABYLON.Vector3(forward.x, 0, forward.z).normalize();
      
      let moveX = 0, moveZ = 0, moveY = 0;
      
      if (keyState.e) { moveX += groundForward.x * MOVE_SPEED; moveZ += groundForward.z * MOVE_SPEED; }  // Forward
      if (keyState.d) { moveX -= groundForward.x * MOVE_SPEED; moveZ -= groundForward.z * MOVE_SPEED; }  // Back
      if (keyState.f) { moveX -= groundRight.x * MOVE_SPEED; moveZ -= groundRight.z * MOVE_SPEED; }      // Left
      if (keyState.s) { moveX += groundRight.x * MOVE_SPEED; moveZ += groundRight.z * MOVE_SPEED; }      // Right
      if (keyState.w) { moveY -= MOVE_SPEED * 0.5; }
      if (keyState.r) { moveY += MOVE_SPEED * 0.5; }
      
      if (moveX !== 0 || moveZ !== 0 || moveY !== 0) {
        if (gfx.cameraTarget) {
          gfx.cameraTarget.position.x += moveX;
          gfx.cameraTarget.position.z += moveZ;
          gfx.cameraTarget.position.y += moveY;
        } else {
          cam.position.x += moveX;
          cam.position.z += moveZ;
          cam.position.y += moveY;
          if (cam.target) {
            cam.target.x += moveX;
            cam.target.z += moveZ;
          }
        }
      }
      
      requestAnimationFrame(updateCamera);
    };
    updateCamera();
    
    console.log('📷 Forge camera controls: Right-click drag to pan, Scroll to zoom, ESDF to move, W/R up/down');
  };
  
  // Handle pointer events
  forge.handlePointer = function(e) {
    if (!ENABLE_FORGE || !window.liveField) return;
    
    // Handle right-click for spawn/building removal
    if (e.button === 2) {
      if (this.state.editingLayer === 'spawns') {
        e.preventDefault();
        const pos = this.getTilePosition(e);
        if (pos) this.removeSpawn(pos);
        return;
      }
      if (this.state.editingLayer === 'buildings') {
        e.preventDefault();
        const pos = this.getTilePosition(e);
        if (pos) this._removeBuildingAt(pos);
        return;
      }
    }

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
          
          // Spawn editing mode - place spawn
          if (this.state.editingLayer === 'spawns') {
            const pos = this.getTilePosition(e);
            if (pos) {
              this.placeSpawn(pos);
            }
            return;
          }
          
          // Building editing mode - place building
          if (this.state.editingLayer === 'buildings') {
            const pos = this.getTilePosition(e);
            if (pos) {
              this.placeBuilding(pos);
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
    
    // Get all symmetric positions to paint
    const positions = this.getSymmetricPositions(pos);

    const affectedChunks = new Set();
    const paintedTiles = []; // Track painted tiles for buffer pass

    // Helper to check if a tile is in an enabled chunk
    const isChunkEnabled = (x, y) => {
      if (!field.chunkMask) return true;
      const chunkX = Math.floor(x / field.chunkSize);
      const chunkZ = Math.floor(y / field.chunkSize);
      return field.chunkMask.get(`${chunkX},${chunkZ}`) !== false;
    };
    
    // Paint with brush at all symmetric positions
    for (const basePos of positions) {
      for (let dx = -this.state.brushSize; dx <= this.state.brushSize; dx++) {
        for (let dy = -this.state.brushSize; dy <= this.state.brushSize; dy++) {
          const x = basePos.x + dx;
          const y = basePos.y + dy;

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
    
    // Get all symmetric positions
    const positions = this.getSymmetricPositions(pos);

    if (!this._placedKeys) this._placedKeys = new Set();
    if (!this._resourceFootprints) this._resourceFootprints = new Map();

    // Handle eraser tool - erase at all symmetric positions
    if (this.state.currentResource === 'eraser') {
      positions.forEach(p => this._eraseResourceAt(p));
      return;
    }
    
    // Place resource at all symmetric positions
    positions.forEach(p => this._placeResourceAtSingle(p));
  };
  
  // Internal: Erase resource at single position
  forge._eraseResourceAt = function(pos) {
    const field = window.liveField;
    const key = `${pos.x},${pos.y}`;
    
    // Handle eraser tool - erase any resource whose footprint includes this tile
    {
      let erased = false;
      
      // 1. Check manually placed resources first
      if (this._resourceFootprints) {
        for (const [rKey, footprintKeys] of this._resourceFootprints) {
          if (footprintKeys.includes(key)) {
            if (this._placedResources.has(rKey)) {
              const mesh = this._placedResources.get(rKey);
              if (mesh && mesh.dispose) mesh.dispose();
              this._placedResources.delete(rKey);
            }
            // Clear all footprint tiles
            footprintKeys.forEach(k => this._placedKeys.delete(k));
            this._resourceFootprints.delete(rKey);
            erased = true;
            break;
          }
        }
      }
      
      // 2. Check auto-generated LOD models
      if (!erased && gfx && gfx.lodModels) {
        for (let i = gfx.lodModels.length - 1; i >= 0; i--) {
          const lod = gfx.lodModels[i];
          if (!lod.model || lod.model.isDisposed()) continue;
          
          const modelPos = lod.model.position;
          const tx = Math.floor(modelPos.x / TILE_SIZE);
          const tz = Math.floor(modelPos.z / TILE_SIZE);
          
          // Calculate footprint for this model (matches resourceTypes)
          const scale = lod.model.scaling ? lod.model.scaling.x : 1;
          let footprint = 0;
          if (scale >= 10) footprint = 2;       // Large rocks
          else if (scale >= 6) footprint = 1;   // Mossy rocks
          
          // Check if clicked tile is in this model's footprint
          const [clickX, clickY] = key.split(',').map(Number);
          const dx = clickX - tx;
          const dy = clickY - tz;
          if (Math.sqrt(dx*dx + dy*dy) <= footprint + 0.5) {
            // Found it! Dispose the model and billboard
            if (lod.model) lod.model.dispose();
            if (lod.billboard) lod.billboard.dispose();
            
            // Remove from lodModels array
            gfx.lodModels.splice(i, 1);
            
            // Track erased position so it doesn't come back
            if (!this._erasedAutoResources) this._erasedAutoResources = new Set();
            this._erasedAutoResources.add(`${tx},${tz}`);
            
            erased = true;
            break;
          }
        }
      }

      // Refresh grid if something was erased
      if (erased && this._resourceGridVisible) {
        this.showResourceGrid();
      }
    }
  };
  
  // Internal: Place single resource at position
  forge._placeResourceAtSingle = function(pos) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    // Ensure tracking maps exist
    if (!this._placedResources) this._placedResources = new Map();
    if (!this._placedKeys) this._placedKeys = new Set();
    if (!this._resourceFootprints) this._resourceFootprints = new Map();
    if (!this._modelCache) this._modelCache = new Map();
    
    const key = `${pos.x},${pos.y}`;

    const resourceType = this.resourceTypes[this.state.currentResource];
    if (!resourceType || !resourceType.path) return;

    // Get footprint tiles
    const footprint = this.getResourceFootprint(pos, resourceType);
    
    // Get all occupied tiles (including auto-generated resources)
    const occupiedTiles = this.getOccupiedTiles();

    // Check ALL footprint tiles
    for (const tile of footprint) {
      // Bounds check
      if (tile.x < 0 || tile.x >= field.width || tile.y < 0 || tile.y >= field.height) return;

      // Don't place on water
      const index = tile.y * field.width + tile.x;
      if (field.terrainTypes[index] === 1) return;

      // Don't place in disabled chunks
      const chunkX = Math.floor(tile.x / field.chunkSize);
      const chunkZ = Math.floor(tile.y / field.chunkSize);
      if (field.chunkMask && field.chunkMask.get(`${chunkX},${chunkZ}`) === false) return;

      // Check if already occupied (manual or auto-generated)
      const tileKey = `${tile.x},${tile.y}`;
      if (occupiedTiles.has(tileKey)) return;
    }
    
    // Mark all footprint tiles as occupied
    const footprintKeys = footprint.map(t => `${t.x},${t.y}`);
    footprintKeys.forEach(k => this._placedKeys.add(k));
    this._resourceFootprints.set(key, footprintKeys);
    
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
      
      // Refresh grid if visible
      if (this._resourceGridVisible) {
        this.showResourceGrid();
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
    
    // CRITICAL: Clear all existing resources FIRST (before creating new field)
    this.clearResources();
    
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
    
    // Hide overlays (they'll be stale after regeneration)
    this.hideResourceGrid();
    this.hideBlockedGrid();
    this._resourceGridVisible = false;
    this._blockedGridVisible = false;
    const gridBtn = document.getElementById('vis-grid');
    const blockedBtn = document.getElementById('vis-blocked');
    if (gridBtn) gridBtn.classList.remove('active');
    if (blockedBtn) blockedBtn.classList.remove('active');
    
    // Clear spawn points
    this.state.spawnPoints = [];
    this.updateSpawnMarkers();
    this.updateSpawnList();
    
    // Clear buildings
    this.state.buildings = [];
    this._buildingMeshes?.forEach(m => m.dispose());
    this._buildingMeshes?.clear();
    this.updateBuildingList();

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
      r: placedResources.length > 0 ? placedResources.join(';') : undefined,  // Placed resources
      er: this._erasedAutoResources && this._erasedAutoResources.size > 0
          ? Array.from(this._erasedAutoResources).join(';') : undefined,  // Erased auto-resources
      // Map metadata
      sp: this.state.spawnPoints.length > 0
          ? this.state.spawnPoints.map(s => `${s.x},${s.y},${s.team}`).join(';') : undefined,  // Spawn points
      bld: this.state.buildings.length > 0
          ? this.state.buildings.map(b => `${b.x},${b.y},${b.type},${(b.rotation || 0).toFixed(2)}`).join(';') : undefined,  // Buildings
      gt: Object.entries(this.state.gameTypes)
          .filter(([k, v]) => v).map(([k]) => k).join(',') || '1v1'  // Game types
    };
    
    const json = JSON.stringify(mapData);
    const compressed = this.compressString(json);
    
    console.log(`📦 Map exported: ${(json.length / 1024).toFixed(1)} KB → ${(compressed.length / 1024).toFixed(1)} KB`);
    
    // Trigger download with .aether extension
    const blob = new Blob([compressed], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${field.seed}.garden`;
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
      console.log(`📥 Importing .garden map: ${width}x${height}`);
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
      this._resourceFootprints = new Map();
      this._erasedAutoResources = new Set();

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
    
    // Restore erased auto-resources (v2 format)
    if (mapData.er) {
      this._erasedAutoResources = new Set(mapData.er.split(';'));
      
      // Actually erase them from LOD models
      if (gfx && gfx.lodModels) {
        for (let i = gfx.lodModels.length - 1; i >= 0; i--) {
          const lod = gfx.lodModels[i];
          if (!lod.model || lod.model.isDisposed()) continue;
          
          const pos = lod.model.position;
          const tx = Math.floor(pos.x / TILE_SIZE);
          const tz = Math.floor(pos.z / TILE_SIZE);
          
          if (this._erasedAutoResources.has(`${tx},${tz}`)) {
            if (lod.model) lod.model.dispose();
            if (lod.billboard) lod.billboard.dispose();
            gfx.lodModels.splice(i, 1);
          }
        }
      }
      console.log(`🗑️ Restored ${this._erasedAutoResources.size} erased resources`);
    }
    
    // Restore spawn points (v2 format)
    if (mapData.sp) {
      this.state.spawnPoints = mapData.sp.split(';').map(s => {
        const [x, y, team] = s.split(',').map(Number);
        return { x, y, team };
      });
      this.updateSpawnMarkers();
      this.updateSpawnList();
      console.log(`🚩 Restored ${this.state.spawnPoints.length} spawn points`);
    } else {
      this.state.spawnPoints = [];
    }
    
    // Restore buildings (v2 format)
    if (mapData.bld) {
      this.state.buildings = mapData.bld.split(';').map(b => {
        const parts = b.split(',');
        return {
          x: Number(parts[0]),
          y: Number(parts[1]),
          type: parts[2],
          rotation: Number(parts[3]) || 0
        };
      });
      this.updateBuildingMarkers();
      console.log(`🏗️ Restored ${this.state.buildings.length} buildings`);
    } else {
      this.state.buildings = [];
      this._buildingMeshes?.forEach(m => m.dispose());
      this._buildingMeshes?.clear();
    }

    // Restore game types (v2 format)
    if (mapData.gt) {
      // Reset all to false first
      Object.keys(this.state.gameTypes).forEach(k => this.state.gameTypes[k] = false);
      // Enable saved types
      mapData.gt.split(',').forEach(type => {
        if (this.state.gameTypes.hasOwnProperty(type)) {
          this.state.gameTypes[type] = true;
        }
      });
      // Update checkboxes
      Object.entries(this.state.gameTypes).forEach(([type, enabled]) => {
        const cb = document.getElementById(`gt-${type}`);
        if (cb) cb.checked = enabled;
      });
      console.log(`🎮 Restored game types: ${mapData.gt}`);
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
            <button id="layer-buildings" class="forge-btn" onclick="forge.setEditingLayer('buildings')">🏗️ Buildings</button>
            <button id="layer-spawns" class="forge-btn" onclick="forge.setEditingLayer('spawns')">🚩 Spawns</button>
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="vis-table" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('table')">👁️ Table</button>
            <button id="vis-terrain" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('terrain')">👁️ Terrain</button>
            <button id="vis-resources" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('resources')">👁️ Resources</button>
            <button id="vis-grid" class="forge-btn forge-vis" onclick="forge.toggleResourceGrid()">📍 Grid</button>
            <button id="vis-blocked" class="forge-btn forge-vis" onclick="forge.toggleBlockedGrid()">🚫 Blocked</button>
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
        
        <div id="spawns-panel" class="forge-section" style="display:none;">
          <h3>🏛️ Agora Spawns</h3>
          <p style="font-size:11px;opacity:0.7;">Click to place spawn (Agora location). Right-click to remove.<br>Terrain is flattened around spawns. Order = player assignment.</p>
          <div id="spawn-list" style="margin-top:8px;font-size:12px;"></div>
          <div class="forge-buttons" style="margin-top:8px;">
            <button class="forge-btn" onclick="forge.clearSpawns()">🗑️ Clear All</button>
          </div>
          
          <h3 style="margin-top:12px;">Game Types</h3>
          <div style="font-size:12px;">
            <label><input type="checkbox" id="gt-adventure" onchange="forge.toggleGameType('adventure')"> 🗺️ Adventure</label><br>
            <label><input type="checkbox" id="gt-1v1" checked onchange="forge.toggleGameType('1v1')"> ⚔️ 1v1</label><br>
            <label><input type="checkbox" id="gt-koth" onchange="forge.toggleGameType('koth')"> 👑 King of the Hill</label><br>
            <label><input type="checkbox" id="gt-teams" onchange="forge.toggleGameType('teams')"> 🤝 Teams</label>
          </div>
        </div>
        
        <div id="buildings-panel" class="forge-section" style="display:none;">
          <h3>🏗️ Buildings</h3>
          <p style="font-size:11px;opacity:0.7;">Click to place. Right-click to remove.</p>
          <div class="forge-buttons">
            <button id="bldg-agora" class="forge-btn active" onclick="forge.setBuilding('agora')">🏛️ Agora</button>
            <button id="bldg-camp" class="forge-btn" onclick="forge.setBuilding('camp')">⛺ Camp</button>
            <button id="bldg-tower" class="forge-btn" onclick="forge.setBuilding('tower')">🗼 Tower</button>
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="bldg-gate" class="forge-btn" onclick="forge.setBuilding('gate')">🚪 Gate</button>
            <button id="bldg-farm" class="forge-btn" onclick="forge.setBuilding('farm')">🌾 Farm</button>
            <button id="bldg-windmill" class="forge-btn" onclick="forge.setBuilding('windmill')">🌀 Windmill</button>
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="bldg-eraser" class="forge-btn" onclick="forge.setBuilding('eraser')">🧽 Eraser</button>
          </div>
          <div id="building-list" style="margin-top:8px;font-size:11px;max-height:100px;overflow-y:auto;"></div>
          <div class="forge-buttons" style="margin-top:8px;">
            <button class="forge-btn" onclick="forge.clearBuildings()">🗑️ Clear All</button>
          </div>
        </div>

        <div class="forge-section">
          <h3>⚖️ Symmetry</h3>
          <p style="font-size:11px;opacity:0.7;">Paint with symmetry for balanced maps</p>
          <div class="forge-buttons">
            <button id="sym-none" class="forge-btn active" onclick="forge.setSymmetry('none')">⬜ Off</button>
            <button id="sym-mirrorX" class="forge-btn" onclick="forge.setSymmetry('mirrorX')">↔️</button>
            <button id="sym-mirrorY" class="forge-btn" onclick="forge.setSymmetry('mirrorY')">↕️</button>
            <button id="sym-rotate180" class="forge-btn" onclick="forge.setSymmetry('rotate180')">🔄</button>
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="sym-quad" class="forge-btn" onclick="forge.setSymmetry('quad')">✚ Quad</button>
            <button class="forge-btn" onclick="forge.applySymmetryToAll()">📋 Apply to All</button>
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
            <input type="file" id="import-file" accept=".garden,.json" style="display:none" 
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
          <div>🖱️ Left-click - Paint</div>
          <div>🖱️ Right-drag - Pan</div>
          <div>ESDF - Move camera</div>
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
    document.getElementById('layer-buildings').classList.toggle('active', layer === 'buildings');
    document.getElementById('layer-spawns').classList.toggle('active', layer === 'spawns');

    // Show/hide panels
    document.getElementById('table-panel').style.display = layer === 'table' ? 'block' : 'none';
    document.getElementById('terrain-panel').style.display = layer === 'terrain' ? 'block' : 'none';
    document.getElementById('resource-panel').style.display = layer === 'resources' ? 'block' : 'none';
    document.getElementById('buildings-panel').style.display = layer === 'buildings' ? 'block' : 'none';
    document.getElementById('spawns-panel').style.display = layer === 'spawns' ? 'block' : 'none';

    // Update chunk grid overlay visibility
    this.updateChunkGridOverlay(layer === 'table');

    // Show spawn markers when editing spawns
    this.updateSpawnMarkers();

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
    const newState = current === false ? true : false; // More explicit toggle
    field.chunkMask.set(key, newState);
    
    // Update chunk mesh visibility immediately
    const chunk = field.chunks.get(key);
    if (chunk) {
      // Hide/show terrain mesh
      if (chunk.mesh) {
        chunk.mesh.setEnabled(newState && this.state.layers.terrain);
        chunk.mesh.isVisible = newState && this.state.layers.terrain;
      }
      
      // Also dispose/recreate resources in the chunk
      if (chunk.models) {
        chunk.models.forEach(model => {
          if (model && model.setEnabled) {
            model.setEnabled(newState && this.state.layers.resources);
          }
        });
      }
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
  
  // Toggle resource tile grid overlay
  forge._resourceGridVisible = false;
  forge._resourceGridOverlay = [];
  
  forge.toggleResourceGrid = function() {
    this._resourceGridVisible = !this._resourceGridVisible;
    
    const btn = document.getElementById('vis-grid');
    if (btn) {
      btn.classList.toggle('active', this._resourceGridVisible);
    }
    
    if (this._resourceGridVisible) {
      this.showResourceGrid();
    } else {
      this.hideResourceGrid();
    }
  };
  
  // Show grid overlay highlighting tiles with resources
  forge.showResourceGrid = function() {
    this.hideResourceGrid(); // Clear existing
    
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    // Get all occupied tiles (manual + auto-generated with footprints)
    const occupiedTiles = this.getOccupiedTiles();
    
    console.log(`📍 Showing ${occupiedTiles.size} resource tiles`);
    
    // Create small markers for each occupied tile
    const markerMat = new BABYLON.StandardMaterial('resourceMarkerMat', gfx.scene);
    markerMat.diffuseColor = new BABYLON.Color3(1, 0.5, 0);  // Orange
    markerMat.emissiveColor = new BABYLON.Color3(0.5, 0.25, 0);
    markerMat.alpha = 0.6;
    markerMat.backFaceCulling = false;
    
    for (const key of occupiedTiles) {
      const [tx, tz] = key.split(',').map(Number);
      
      // Check bounds
      if (tx < 0 || tx >= field.width || tz < 0 || tz >= field.height) continue;
      
      const marker = BABYLON.MeshBuilder.CreatePlane(`resGrid_${key}`, {
        width: TILE_SIZE * 0.8,
        height: TILE_SIZE * 0.8
      }, gfx.scene);
      
      marker.position.x = (tx + 0.5) * TILE_SIZE;
      marker.position.y = 1.5;  // Float above terrain
      marker.position.z = (tz + 0.5) * TILE_SIZE;
      marker.rotation.x = Math.PI / 2;  // Lay flat
      marker.material = markerMat;
      
      this._resourceGridOverlay.push(marker);
    }
    
    // Store material for cleanup
    this._resourceGridMat = markerMat;
  };
  
  // Hide resource grid overlay
  forge.hideResourceGrid = function() {
    if (this._resourceGridOverlay) {
      this._resourceGridOverlay.forEach(m => m.dispose());
      this._resourceGridOverlay = [];
    }
    if (this._resourceGridMat) {
      this._resourceGridMat.dispose();
      this._resourceGridMat = null;
    }
  };
  
  // Toggle blocked tiles grid overlay
  forge._blockedGridVisible = false;
  forge._blockedGridOverlay = [];
  
  forge.toggleBlockedGrid = function() {
    this._blockedGridVisible = !this._blockedGridVisible;
    
    const btn = document.getElementById('vis-blocked');
    if (btn) {
      btn.classList.toggle('active', this._blockedGridVisible);
    }
    
    if (this._blockedGridVisible) {
      this.showBlockedGrid();
    } else {
      this.hideBlockedGrid();
    }
  };
  
  // Show grid overlay highlighting blocked/impassable and slow tiles
  forge.showBlockedGrid = function() {
    this.hideBlockedGrid(); // Clear existing
    
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    // Get blocked tiles (from field)
    const blockedTiles = field.blockedTiles || new Set();
    const slowTiles = field.slowTiles || new Set();
    
    console.log(`🚫 Showing ${blockedTiles.size} blocked tiles, 🐢 ${slowTiles.size} slow tiles`);
    
    // Red material for blocked tiles
    const blockedMat = new BABYLON.StandardMaterial('blockedMarkerMat', gfx.scene);
    blockedMat.diffuseColor = new BABYLON.Color3(1, 0, 0);  // Red
    blockedMat.emissiveColor = new BABYLON.Color3(0.5, 0, 0);
    blockedMat.alpha = 0.5;
    blockedMat.backFaceCulling = false;
    
    // Yellow material for slow tiles
    const slowMat = new BABYLON.StandardMaterial('slowMarkerMat', gfx.scene);
    slowMat.diffuseColor = new BABYLON.Color3(1, 1, 0);  // Yellow
    slowMat.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0);
    slowMat.alpha = 0.4;
    slowMat.backFaceCulling = false;
    
    // Create markers for blocked tiles
    for (const key of blockedTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (tx < 0 || tx >= field.width || tz < 0 || tz >= field.height) continue;
      
      const marker = BABYLON.MeshBuilder.CreatePlane(`blockedGrid_${key}`, {
        width: TILE_SIZE * 0.9,
        height: TILE_SIZE * 0.9
      }, gfx.scene);
      
      marker.position.x = (tx + 0.5) * TILE_SIZE;
      marker.position.y = 1.0;
      marker.position.z = (tz + 0.5) * TILE_SIZE;
      marker.rotation.x = Math.PI / 2;
      marker.material = blockedMat;
      
      this._blockedGridOverlay.push(marker);
    }
    
    // Create markers for slow tiles (that aren't also blocked)
    for (const key of slowTiles) {
      if (blockedTiles.has(key)) continue; // Skip if already blocked
      
      const [tx, tz] = key.split(',').map(Number);
      if (tx < 0 || tx >= field.width || tz < 0 || tz >= field.height) continue;
      
      const marker = BABYLON.MeshBuilder.CreatePlane(`slowGrid_${key}`, {
        width: TILE_SIZE * 0.9,
        height: TILE_SIZE * 0.9
      }, gfx.scene);
      
      marker.position.x = (tx + 0.5) * TILE_SIZE;
      marker.position.y = 1.0;
      marker.position.z = (tz + 0.5) * TILE_SIZE;
      marker.rotation.x = Math.PI / 2;
      marker.material = slowMat;
      
      this._blockedGridOverlay.push(marker);
    }
    
    // Store materials for cleanup
    this._blockedGridMat = blockedMat;
    this._slowGridMat = slowMat;
  };
  
  // Hide blocked grid overlay
  forge.hideBlockedGrid = function() {
    if (this._blockedGridOverlay) {
      this._blockedGridOverlay.forEach(m => m.dispose());
      this._blockedGridOverlay = [];
    }
    if (this._blockedGridMat) {
      this._blockedGridMat.dispose();
      this._blockedGridMat = null;
    }
    if (this._slowGridMat) {
      this._slowGridMat.dispose();
      this._slowGridMat = null;
    }
  };
  
  // ========== SPAWN POINT MANAGEMENT ==========
  // Spawns are simple positions where Agoras will be placed at match start
  // The order of spawns determines player assignment (spawn 0 = player 1, etc.)
  
  forge._spawnMarkers = [];
  
  // Place a spawn point at position
  forge.placeSpawn = function(pos) {
    const field = window.liveField;
    if (!field) return;
    
    // Get symmetric positions
    const positions = this.getSymmetricPositions(pos);
    
    positions.forEach((p, i) => {
      // Check if there's already a spawn at this position
      const existing = this.state.spawnPoints.findIndex(s => 
        Math.abs(s.x - p.x) <= 2 && Math.abs(s.y - p.y) <= 2
      );
      
      if (existing >= 0) {
        // Move existing spawn to new position
        this.state.spawnPoints[existing].x = p.x;
        this.state.spawnPoints[existing].y = p.y;
      } else {
        // Add new spawn point (order determines player assignment)
        const spawnIndex = this.state.spawnPoints.length;
        this.state.spawnPoints.push({
          x: p.x,
          y: p.y,
          team: spawnIndex  // Keep team for export compatibility, but it's just the index
        });
      }
      
      // Flatten terrain around spawn for Agora placement
      this.flattenTerrainAtSpawn(p.x, p.y);
    });

    this.updateSpawnMarkers();
    this.updateSpawnList();
    console.log(`🏛️ Agora spawn placed at (${pos.x}, ${pos.y})` + 
                (positions.length > 1 ? ` (+${positions.length - 1} mirrors)` : ''));
  };
  
  // Flatten terrain around a spawn point (like the game does for Agora placement)
  forge.flattenTerrainAtSpawn = function(centerX, centerY) {
    const field = window.liveField;
    if (!field) return;
    
    const radius = this.spawnZoneRadius;
    const affectedChunks = new Set();
    
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        
        const x = centerX + dx;
        const y = centerY + dy;
        
        if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
        
        const index = y * field.width + x;
        
        // Convert water to grass at spawn locations
        if (field.terrainTypes[index] === 1) {
          field.terrainTypes[index] = 3; // Water → Grass
        }
        
        // Track chunk for rebuild
        const chunkX = Math.floor(x / field.chunkSize);
        const chunkZ = Math.floor(y / field.chunkSize);
        affectedChunks.add(`${chunkX},${chunkZ}`);
      }
    }
    
    // Rebuild affected chunks
    if (affectedChunks.size > 0) {
      // Reapply transitions for smoother terrain edges
      this.applyTransitionsInArea(centerX, centerY, radius + 2);
      this.rebuildChunks(affectedChunks);
    }
  };
  
  // Remove spawn point at position
  forge.removeSpawn = function(pos) {
    // Get symmetric positions
    const positions = this.getSymmetricPositions(pos);
    let removed = 0;
    
    positions.forEach(p => {
      const index = this.state.spawnPoints.findIndex(s =>
        Math.abs(s.x - p.x) <= 1 && Math.abs(s.y - p.y) <= 1
      );
      if (index >= 0) {
        this.state.spawnPoints.splice(index, 1);
        removed++;
      }
    });
    
    if (removed > 0) {
      this.updateSpawnMarkers();
      this.updateSpawnList();
      console.log(`🚩 Removed ${removed} spawn(s)`);
    }
  };
  
  // Clear all spawn points
  forge.clearSpawns = function() {
    this.state.spawnPoints = [];
    this.updateSpawnMarkers();
    this.updateSpawnList();
    console.log('🚩 All spawns cleared');
  };
  
  // ========== BUILDING PLACEMENT ==========
  
  forge._buildingMeshes = new Map(); // key -> mesh
  
  forge.setBuilding = function(buildingType) {
    this.state.currentBuilding = buildingType;
    
    // Update button states
    Object.keys(this.buildingTypes).forEach(t => {
      const btn = document.getElementById(`bldg-${t}`);
      if (btn) btn.classList.toggle('active', t === buildingType);
    });
    document.getElementById('bldg-eraser')?.classList.toggle('active', buildingType === 'eraser');
    
    console.log(`🏗️ Building: ${buildingType}`);
  };
  
  forge.placeBuilding = function(pos) {
    const field = window.liveField;
    if (!field) return;
    
    // Get symmetric positions
    const positions = this.getSymmetricPositions(pos);
    
    // Handle eraser
    if (this.state.currentBuilding === 'eraser') {
      positions.forEach(p => this._removeBuildingAt(p));
      return;
    }
    
    // Place at all symmetric positions
    positions.forEach((p, i) => this._placeBuildingAtSingle(p, i));
  };
  
  forge._placeBuildingAtSingle = function(pos, rotationOffset = 0) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    const key = `${pos.x},${pos.y}`;
    const buildingType = this.state.currentBuilding;
    const buildingDef = window.BuildingTypes?.[buildingType];
    
    if (!buildingDef) {
      console.warn(`Unknown building type: ${buildingType}`);
      return;
    }
    
    // Check if position is valid
    const chunkX = Math.floor(pos.x / field.chunkSize);
    const chunkZ = Math.floor(pos.y / field.chunkSize);
    if (!field.chunkMask.get(`${chunkX},${chunkZ}`)) return;
    
    // Check for water
    const index = pos.y * field.width + pos.x;
    if (field.terrainTypes[index] === 1) return;
    
    // Remove existing building at this position
    if (this._buildingMeshes.has(key)) {
      this._buildingMeshes.get(key).dispose();
      this._buildingMeshes.delete(key);
    }
    
    // Remove from state array
    const existingIdx = this.state.buildings.findIndex(b => b.x === pos.x && b.y === pos.y);
    if (existingIdx >= 0) {
      this.state.buildings.splice(existingIdx, 1);
    }
    
    // Add to state
    const rotation = (rotationOffset * Math.PI / 2); // Rotate mirrors by 90 degrees each
    this.state.buildings.push({ x: pos.x, y: pos.y, type: buildingType, rotation });
    
    // Load and place model
    const TILE_SIZE = window.TILE_SIZE || 1;
    const worldX = pos.x * TILE_SIZE;
    const worldZ = pos.y * TILE_SIZE;
    const terrainY = window.getTerrainHeightAtPosition?.(worldX, worldZ) || 0;
    
    gfx.getModel(buildingDef.model, gfx.scene).then(model => {
      const root = model.root;
      root.position = new BABYLON.Vector3(worldX, terrainY, worldZ);
      root.scaling = new BABYLON.Vector3(buildingDef.scale, buildingDef.scale, buildingDef.scale);
      root.rotation.y = rotation;
      root.setEnabled(true);
      
      // Mark as editor building
      root.metadata = root.metadata || {};
      root.metadata.isEditorBuilding = true;
      root.metadata.buildingKey = key;
      
      this._buildingMeshes.set(key, root);
      this.updateBuildingList();
    });
    
    console.log(`🏗️ Placed ${buildingType} at (${pos.x}, ${pos.y})`);
  };
  
  forge._removeBuildingAt = function(pos) {
    const key = `${pos.x},${pos.y}`;
    
    // Check nearby positions too (buildings can be multi-tile)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const checkKey = `${pos.x + dx},${pos.y + dy}`;
        if (this._buildingMeshes.has(checkKey)) {
          this._buildingMeshes.get(checkKey).dispose();
          this._buildingMeshes.delete(checkKey);
          
          // Remove from state
          const idx = this.state.buildings.findIndex(b => `${b.x},${b.y}` === checkKey);
          if (idx >= 0) this.state.buildings.splice(idx, 1);
        }
      }
    }
    
    this.updateBuildingList();
  };
  
  forge.clearBuildings = function() {
    // Dispose all meshes
    this._buildingMeshes.forEach(mesh => mesh.dispose());
    this._buildingMeshes.clear();
    this.state.buildings = [];
    this.updateBuildingList();
    console.log('🏗️ All buildings cleared');
  };
  
  forge.updateBuildingList = function() {
    const list = document.getElementById('building-list');
    if (!list) return;
    
    if (this.state.buildings.length === 0) {
      list.innerHTML = '<span style="opacity:0.5;">No buildings placed</span>';
      return;
    }
    
    // Group by type
    const byType = {};
    this.state.buildings.forEach(b => {
      byType[b.type] = (byType[b.type] || 0) + 1;
    });
    
    list.innerHTML = Object.entries(byType)
      .map(([type, count]) => {
        const def = this.buildingTypes[type] || { icon: '🏠', name: type };
        return `${def.icon} ${def.name}: ${count}`;
      }).join('<br>');
  };
  
  forge.updateBuildingMarkers = function() {
    // Rebuild all building meshes from state
    // Clear existing
    this._buildingMeshes.forEach(mesh => mesh.dispose());
    this._buildingMeshes.clear();
    
    // Rebuild
    this.state.buildings.forEach(b => {
      const buildingDef = window.BuildingTypes?.[b.type];
      if (!buildingDef) return;
      
      const TILE_SIZE = window.TILE_SIZE || 1;
      const worldX = b.x * TILE_SIZE;
      const worldZ = b.y * TILE_SIZE;
      const terrainY = window.getTerrainHeightAtPosition?.(worldX, worldZ) || 0;
      const key = `${b.x},${b.y}`;
      
      gfx.getModel(buildingDef.model, gfx.scene).then(model => {
        const root = model.root;
        root.position = new BABYLON.Vector3(worldX, terrainY, worldZ);
        root.scaling = new BABYLON.Vector3(buildingDef.scale, buildingDef.scale, buildingDef.scale);
        root.rotation.y = b.rotation || 0;
        root.setEnabled(true);
        
        root.metadata = root.metadata || {};
        root.metadata.isEditorBuilding = true;
        root.metadata.buildingKey = key;
        
        this._buildingMeshes.set(key, root);
      });
    });
    
    this.updateBuildingList();
  };

  // Update spawn list UI
  forge.updateSpawnList = function() {
    const list = document.getElementById('spawn-list');
    if (!list) return;
    
    if (this.state.spawnPoints.length === 0) {
      list.innerHTML = '<span style="opacity:0.5;">Click map to place Agora spawn points</span>';
      return;
    }
    
    let html = '';
    this.state.spawnPoints.forEach((spawn, i) => {
      html += `<div>🏛️ Spawn ${i + 1}: (${spawn.x}, ${spawn.y})</div>`;
    });
    
    // Show game mode hints
    const count = this.state.spawnPoints.length;
    if (count === 1) {
      html += '<div style="opacity:0.6;margin-top:4px;font-size:10px;">⚠️ Need at least 2 spawns for 1v1</div>';
    } else if (count === 2) {
      html += '<div style="opacity:0.6;margin-top:4px;font-size:10px;">✓ Ready for 1v1</div>';
    } else if (count >= 4) {
      html += '<div style="opacity:0.6;margin-top:4px;font-size:10px;">✓ Ready for Teams (${count} players)</div>';
    }
    
    list.innerHTML = html;
  };
  
  // Update 3D spawn markers (show Agora at spawn location)
  forge.updateSpawnMarkers = function() {
    // Dispose old markers
    if (this._spawnMarkers) {
      this._spawnMarkers.forEach(m => {
        if (m.dispose) m.dispose();
      });
    }
    this._spawnMarkers = [];
    
    if (!gfx || !gfx.scene) return;
    
    const field = window.liveField;
    if (!field) return;
    
    // Create markers for each spawn
    this.state.spawnPoints.forEach((spawn, i) => {
      const worldX = spawn.x * TILE_SIZE;
      const worldZ = spawn.y * TILE_SIZE;
      
      // Create a circular platform to show flattened spawn zone
      const platform = BABYLON.MeshBuilder.CreateDisc(`spawnPlatform_${i}`, {
        radius: this.spawnZoneRadius * TILE_SIZE,
        tessellation: 32
      }, gfx.scene);
      platform.rotation.x = Math.PI / 2; // Lay flat
      platform.position = new BABYLON.Vector3(worldX, 0.15, worldZ);
      
      const platformMat = new BABYLON.StandardMaterial(`spawnPlatMat_${i}`, gfx.scene);
      platformMat.diffuseColor = new BABYLON.Color3(0.8, 0.7, 0.5); // Neutral tan
      platformMat.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0.1);
      platformMat.alpha = 0.25;
      platformMat.backFaceCulling = false;
      platform.material = platformMat;
      
      this._spawnMarkers.push(platform);
      
      // Load Agora model as marker
      const buildingDef = window.BuildingTypes?.['agora'];
      if (buildingDef && gfx.getModel) {
        gfx.getModel(buildingDef.model, gfx.scene).then(model => {
          const root = model.root;
          root.position = new BABYLON.Vector3(worldX, 0, worldZ);
          root.scaling = new BABYLON.Vector3(buildingDef.scale, buildingDef.scale, buildingDef.scale);
          root.setEnabled(true);
          
          // Mark as spawn marker for cleanup
          root.metadata = root.metadata || {};
          root.metadata.isSpawnMarker = true;
          root.metadata.spawnIndex = i;
          
          this._spawnMarkers.push(root);
        });
      }
      
      // Add spawn number indicator floating above
      const label = BABYLON.MeshBuilder.CreatePlane(`spawnLabel_${i}`, { size: 5 }, gfx.scene);
      label.position = new BABYLON.Vector3(worldX, 14, worldZ);
      label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      
      // Create dynamic texture for number
      const labelTex = new BABYLON.DynamicTexture(`spawnLabelTex_${i}`, 64, gfx.scene);
      labelTex.hasAlpha = true;
      const ctx = labelTex.getContext();
      ctx.clearRect(0, 0, 64, 64);
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(`${i + 1}`, 32, 32);
      ctx.fillText(`${i + 1}`, 32, 32);
      labelTex.update();
      
      const labelMat = new BABYLON.StandardMaterial(`spawnLabelMat_${i}`, gfx.scene);
      labelMat.diffuseTexture = labelTex;
      labelMat.emissiveTexture = labelTex;
      labelMat.useAlphaFromDiffuseTexture = true;
      labelMat.backFaceCulling = false;
      label.material = labelMat;
      
      this._spawnMarkers.push(label);
    });
  };
  
  // Toggle game type compatibility
  forge.toggleGameType = function(type) {
    this.state.gameTypes[type] = !this.state.gameTypes[type];
    console.log(`🎮 Game type ${type}: ${this.state.gameTypes[type] ? 'enabled' : 'disabled'}`);
  };
  
  // ========== SYMMETRY TOOLS ==========
  
  forge._currentSymmetry = 'none';
  
  // Set symmetry mode
  forge.setSymmetry = function(mode) {
    this._currentSymmetry = mode;
    
    // Update button states
    Object.keys(this.symmetryModes).forEach(m => {
      const btn = document.getElementById(`sym-${m}`);
      if (btn) btn.classList.toggle('active', m === mode);
    });
    
    console.log(`⚖️ Symmetry: ${this.symmetryModes[mode].name}`);
  };
  
  // Get mirrored/rotated positions based on symmetry mode
  forge.getSymmetricPositions = function(pos) {
    const field = window.liveField;
    if (!field) return [pos];
    
    const centerX = field.width / 2;
    const centerY = field.height / 2;
    const positions = [pos];
    
    switch (this._currentSymmetry) {
      case 'mirrorX':
        // Mirror across vertical center line
        positions.push({ x: Math.floor(field.width - 1 - pos.x), y: pos.y });
        break;
        
      case 'mirrorY':
        // Mirror across horizontal center line
        positions.push({ x: pos.x, y: Math.floor(field.height - 1 - pos.y) });
        break;
        
      case 'rotate180':
        // Rotate 180 degrees around center
        positions.push({
          x: Math.floor(field.width - 1 - pos.x),
          y: Math.floor(field.height - 1 - pos.y)
        });
        break;
        
      case 'rotate90':
        // 90 degree rotations (4-way)
        const dx = pos.x - centerX;
        const dy = pos.y - centerY;
        positions.push({ x: Math.floor(centerX - dy), y: Math.floor(centerY + dx) }); // 90
        positions.push({ x: Math.floor(centerX - dx), y: Math.floor(centerY - dy) }); // 180
        positions.push({ x: Math.floor(centerX + dy), y: Math.floor(centerY - dx) }); // 270
        break;
        
      case 'quad':
        // Mirror both X and Y (4 corners)
        positions.push({ x: Math.floor(field.width - 1 - pos.x), y: pos.y }); // Mirror X
        positions.push({ x: pos.x, y: Math.floor(field.height - 1 - pos.y) }); // Mirror Y
        positions.push({ x: Math.floor(field.width - 1 - pos.x), y: Math.floor(field.height - 1 - pos.y) }); // Both
        break;
    }
    
    // Filter out-of-bounds and duplicates
    const seen = new Set();
    return positions.filter(p => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) return false;
      if (p.x < 0 || p.x >= field.width || p.y < 0 || p.y >= field.height) return false;
      seen.add(key);
      return true;
    });
  };
  
  // Apply current terrain/resources symmetrically to whole map
  forge.applySymmetryToAll = function() {
    const field = window.liveField;
    if (!field || this._currentSymmetry === 'none') {
      console.log('⚖️ No symmetry mode selected');
      return;
    }
    
    console.log(`⚖️ Applying ${this.symmetryModes[this._currentSymmetry].name} symmetry to entire map...`);
    
    const halfW = Math.floor(field.width / 2);
    const halfH = Math.floor(field.height / 2);
    const affectedChunks = new Set();
    
    // Determine source region based on symmetry mode
    let sourceRegion;
    switch (this._currentSymmetry) {
      case 'mirrorX':
        sourceRegion = { x1: 0, y1: 0, x2: halfW, y2: field.height };
        break;
      case 'mirrorY':
        sourceRegion = { x1: 0, y1: 0, x2: field.width, y2: halfH };
        break;
      case 'rotate180':
      case 'quad':
        sourceRegion = { x1: 0, y1: 0, x2: halfW, y2: halfH };
        break;
      default:
        return;
    }
    
    // Copy terrain from source to mirrored positions
    for (let y = sourceRegion.y1; y < sourceRegion.y2; y++) {
      for (let x = sourceRegion.x1; x < sourceRegion.x2; x++) {
        const srcIndex = y * field.width + x;
        const srcTerrain = field.terrainTypes[srcIndex];
        const srcTile = field.tiles[srcIndex];
        
        const mirrors = this.getSymmetricPositions({ x, y });
        mirrors.forEach(mp => {
          if (mp.x === x && mp.y === y) return; // Skip source
          
          const dstIndex = mp.y * field.width + mp.x;
          field.terrainTypes[dstIndex] = srcTerrain;
          field.tiles[dstIndex].type = srcTile.type;
          field.tiles[dstIndex].atlasName = srcTile.atlasName;
          
          const chunkX = Math.floor(mp.x / field.chunkSize);
          const chunkZ = Math.floor(mp.y / field.chunkSize);
          affectedChunks.add(`${chunkX},${chunkZ}`);
        });
      }
    }
    
    // Mirror spawn points
    const originalSpawns = [...this.state.spawnPoints];
    originalSpawns.forEach(spawn => {
      const mirrors = this.getSymmetricPositions({ x: spawn.x, y: spawn.y });
      mirrors.forEach((mp, i) => {
        if (i === 0) return; // Skip original
        // Find existing spawn at mirror pos or create new
        const existing = this.state.spawnPoints.find(s => s.x === mp.x && s.y === mp.y);
        if (!existing) {
          // Assign different team for mirrored spawns
          const newTeam = (spawn.team + i) % 8;
          this.state.spawnPoints.push({ x: mp.x, y: mp.y, team: newTeam });
        }
      });
    });
    
    // Rebuild affected chunks
    this.rebuildChunks(affectedChunks);
    this.updateSpawnMarkers();
    this.updateSpawnList();
    
    // Update blocked tiles
    if (field.updateBlockedTiles) {
      field.blockedTiles.clear();
      field.slowTiles.clear();
      field.updateBlockedTiles();
    }
    
    console.log(`✅ Symmetry applied to ${affectedChunks.size} chunks`);
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
      console.log('❌ Cannot populate resources - missing dependencies');
      return;
    }
    
    // First clear existing resources
    this.clearResources();
    
    console.log('🌲 Auto-populating resources (trees on grass, rocks on dirt)...');
    
    // Count terrain types for feedback
    let grassCount = 0, dirtCount = 0;
    for (let i = 0; i < field.terrainTypes.length; i++) {
      if (field.terrainTypes[i] === 3) grassCount++;
      else if (field.terrainTypes[i] === 2) dirtCount++;
    }
    console.log(`   Terrain: ${grassCount} grass tiles, ${dirtCount} dirt tiles`);
    
    // Ensure all chunks exist first
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    
    for (let cx = 0; cx < chunksX; cx++) {
      for (let cz = 0; cz < chunksZ; cz++) {
        const key = `${cx},${cz}`;
        
        // Skip disabled chunks
        if (field.chunkMask && field.chunkMask.get(key) === false) continue;
        
        // Get or create chunk
        let chunk = field.chunks.get(key);
        if (!chunk) {
          chunk = field.getChunk(cx, cz);
        }
        
        if (chunk && chunk.tiles && chunk.tiles.length > 0) {
          chunk.models = gfx.placeDecorationsOnChunk(chunk, gfx.scene);
        }
      }
    }
    
    const resourceCount = gfx.lodModels ? gfx.lodModels.length : 0;
    console.log(`✅ Resources placed: ${resourceCount} models`);
    
    // Refresh grid after async load completes
    if (this._resourceGridVisible) {
      setTimeout(() => this.showResourceGrid(), 500);
      setTimeout(() => this.showResourceGrid(), 1500);
    }
  };

  // Clear all resources from the map
  forge.clearResources = function() {
    const field = window.liveField;
    if (!field) return;
    
    console.log('🗑️ Clearing resources...');
    
    let cleared = 0;
    
    // Clear LOD models (the actual 3D meshes) - this is where resources live
    if (gfx && gfx.lodModels) {
      for (let i = gfx.lodModels.length - 1; i >= 0; i--) {
        const lod = gfx.lodModels[i];
        if (lod.model && !lod.model.isDisposed()) {
          lod.model.dispose();
          cleared++;
        }
        if (lod.billboard && !lod.billboard.isDisposed()) {
          lod.billboard.dispose();
        }
      }
      gfx.lodModels.length = 0; // Clear the array
    }
    
    // Clear chunk model references
    for (const [key, chunk] of field.chunks) {
      if (chunk.models) {
        chunk.models = [];
      }
    }
    
    // Clear resource registries in gfx
    if (gfx.clearResourceRegistries) {
      gfx.clearResourceRegistries();
    }
    
    // Clear manually placed resources
    if (this._placedResources) {
      for (const [key, mesh] of this._placedResources) {
        if (mesh && mesh.dispose && !mesh.isDisposed()) {
          mesh.dispose();
          cleared++;
        }
      }
      this._placedResources = new Map();
    }
    
    // Reset tracking
    this._placedKeys = new Set();
    this._resourceFootprints = new Map();
    this._erasedAutoResources = new Set();
    this._modelCache?.clear();

    // Refresh grid if visible
    if (this._resourceGridVisible) {
      this.showResourceGrid();
    }

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

