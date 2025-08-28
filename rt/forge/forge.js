// Forge Map Editor - Painting and Map Creation Tools
// Uses ENABLE_FORGE flag to isolate editor functionality

(function(forge) {
  'use strict';
  
  // Editor state
  forge.state = {
    currentBrush: 'grass',      // Current terrain type to paint
    brushSize: 1,               // Brush radius in tiles
    isPainting: false,          // Whether currently painting
    lastPaintPos: null,         // Last painted position for continuous painting
    selectedTile: 0,            // Currently selected tile variant (0 or 10 for solid terrain)
    autoMarchingSquares: true  // Whether to auto-apply marching squares around mouse
  };
  
  // Available terrain types - using grass atlas for debugging
  forge.terrainTypes = {
    grass: { name: 'Grass', atlas: 'atlas-grass', variants: 16 },
    dirt: { name: 'Dirt', atlas: 'atlas-grass', variants: 16 },
    rock: { name: 'Rock', atlas: 'atlas-grass', variants: 16 },
    sand: { name: 'Sand', atlas: 'atlas-grass', variants: 16 },
    water: { name: 'Water', atlas: 'atlas-grass', variants: 16 }
  };
  
  // Initialize forge editor
  forge.init = function() {
    if (!ENABLE_FORGE) return;
    
    console.log('Forge Map Editor initialized');
    this.setupPainting();
    this.setupUI();
    this.updateButtonStates();
    
    // Initialize the field for forge mode
    this.initializeField();
    
    // Set initial camera position for forge and ensure controls are attached
    if (gfx && gfx.camera) {
      // Ensure camera is attached to canvas for controls
      if (gfx.camera.attachControl && gfx.canvas) {
        gfx.camera.attachControl(gfx.canvas, true);
        console.log('Camera controls attached to canvas');
      }
      
      this.resetCamera();
    }
  };
  
  // Initialize the field for forge mode - create initial chunks and meshes
  forge.initializeField = function() {
    if (!ENABLE_FORGE || !liveField || !gfx || !gfx.scene) return;
    
    console.log('Initializing field for forge mode...');
    
    // Calculate how many chunks we need to cover the entire field
    const chunksX = Math.ceil(liveField.width / liveField.chunkSize);
    const chunksZ = Math.ceil(liveField.height / liveField.chunkSize);
    
    console.log(`Field size: ${liveField.width}x${liveField.height}, Chunks: ${chunksX}x${chunksZ}`);
    
    // Create all chunks for the field
    for (let chunkX = 0; chunkX < chunksX; chunkX++) {
      for (let chunkZ = 0; chunkZ < chunksZ; chunkZ++) {
        // Get or create the chunk
        const chunk = liveField.getChunk(chunkX, chunkZ);
        if (chunk) {
          // Mark chunk as needing mesh
          chunk.needsMesh = true;
          console.log(`Created chunk ${chunkX},${chunkZ}`);
        }
      }
    }
    
    // Force initial mesh creation for all chunks
    this.forceAllMeshUpdates();
    
    console.log('Field initialization complete');
  };
  
  // Setup painting system
  forge.setupPainting = function() {
    if (!ENABLE_FORGE) return;
    
    // Integrate with existing pointer system instead of adding new listeners
    this.setupPointerIntegration();
    
    console.log('Painting system ready');
  };
  
  // Setup integration with existing pointer system
  forge.setupPointerIntegration = function() {
    if (!ENABLE_FORGE) return;
    
    // Set up direct pointer event listeners for forge
    const canvas = document.getElementById('canvas');
    if (canvas) {
      canvas.addEventListener('pointerdown', this.handlePointer.bind(this));
      canvas.addEventListener('pointermove', this.handlePointer.bind(this));
      canvas.addEventListener('pointerup', this.handlePointer.bind(this));
      canvas.addEventListener('pointerleave', this.handlePointer.bind(this));
    }
    
    // Set up keyboard shortcuts for camera controls
    document.addEventListener('keydown', this.handleKeyboard.bind(this));
    
    // Ensure camera controls are properly attached
    this.ensureCameraControls();
    
    console.log('Forge pointer integration set up');
  };
  
  // Handle pointer events for forge painting
  forge.handlePointer = function(e) {
    if (!ENABLE_FORGE || !liveField) return;
    
    switch (e.type) {
      case 'pointerdown':
        // Only handle left mouse button for painting
        if (e.button === 0) {
          this.startPainting(e);
        }
        break;
      case 'pointermove':
        // Continue painting if we're in painting mode
        if (this.state.isPainting) {
          this.continuePainting(e);
        }
        break;
      case 'pointerup':
        if (e.button === 0) {
          this.stopPainting();
        }
        break;
    }
  };
  
  // Start painting at position
  forge.startPainting = function(e) {
    if (!ENABLE_FORGE || !liveField) return;
    
    this.state.isPainting = true;
    this.state.lastPaintPos = this.getTilePosition(e);
    
    // Don't detach camera controls - let user move camera while painting
    // This allows for better workflow where you can paint and navigate simultaneously
    
    this.paintAtPosition(this.state.lastPaintPos);
  };
  
  // Continue painting while dragging
  forge.continuePainting = function(e) {
    if (!ENABLE_FORGE || !this.state.isPainting || !liveField) return;
    
    const currentPos = this.getTilePosition(e);
    
    // Only paint if we've moved to a new tile
    if (currentPos.x !== this.state.lastPaintPos.x || currentPos.y !== this.state.lastPaintPos.y) {
      // FIRST: Paint the tile (set it to solid variant 6 or 12)
      this.paintAtPosition(currentPos);
      
      // DISABLED: Marching squares for now - just paint solid colors
      // if (this.state.autoMarchingSquares) {
      //   this.applyMarchingSquaresToArea(currentPos.x, currentPos.y, 1, true);
      // }
      
      this.state.lastPaintPos = currentPos;
    }
  };
  
  // Stop painting
  forge.stopPainting = function() {
    if (!ENABLE_FORGE) return;
    
    this.state.isPainting = false;
    this.state.lastPaintPos = null;
  };
  
  // Get tile position from mouse/touch event
  forge.getTilePosition = function(e) {
    if (!ENABLE_FORGE || !gfx || !gfx.scene) return { x: 0, y: 0 };
    
    // Get canvas-relative coordinates
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Convert to world coordinates using Babylon.js picking
    const pickResult = gfx.scene.pick(x, y);
    
    if (pickResult.hit) {
      const worldPos = pickResult.pickedPoint;
      return {
        x: Math.floor(worldPos.x / TILE_SIZE),
        y: Math.floor(worldPos.z / TILE_SIZE)
      };
    }
    
    return { x: 0, y: 0 };
  };
  
  // Paint at specific tile position
  forge.paintAtPosition = function(pos) {
    if (!ENABLE_FORGE || !liveField) return;
    
    const { x, y } = pos;
    
    // Validate position
    if (x < 0 || x >= liveField.width || y < 0 || y >= liveField.height) return;
    
    // Paint with current brush settings
    this.paintTile(x, y, this.state.currentBrush, this.state.brushSize);
  };
  
  // Paint a tile with specified terrain type and brush size
  forge.paintTile = function(centerX, centerY, terrainType, brushSize) {
    if (!ENABLE_FORGE || !liveField) return;
    
    const terrain = this.terrainTypes[terrainType];
    if (!terrain) return;
    
    console.log(`Painting at (${centerX}, ${centerY}) with solid tile variant ${this.state.selectedTile}`);
    
    // Only log if we actually paint something
    let paintedCount = 0;
    for (let x = centerX - brushSize; x <= centerX + brushSize; x++) {
      for (let y = centerY - brushSize; y <= centerY + brushSize; y++) {
        // Check bounds
        if (x < 0 || x >= liveField.width || y < 0 || y >= liveField.height) continue;
        
        // Calculate distance from center for circular brush
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (distance <= brushSize) {
          // Get the tile
          const tile = liveField.tiles[y * liveField.width + x];
          if (tile) {
            // Update tile type and atlas
            const oldType = tile.type;
            
            // IMPORTANT: Always paint with the user's selected SOLID tile variant (6 or 12)
            // This ensures the cursor always paints with pure, solid colors
            tile.type = this.state.selectedTile;
            
            tile.atlasName = terrain.atlas;
            
            // Update atlas coordinates if the method exists
            if (tile.updateAtlasCoordinates) {
              tile.updateAtlasCoordinates();
            }
            
            if (oldType !== tile.type) {
              paintedCount++;
              console.log(`Painted tile at (${x}, ${y}) with solid variant ${this.state.selectedTile}`);
            }
          }
        }
      }
    }
    
          // Only log and process if we actually painted something
      if (paintedCount > 0) {
        console.log(`Painted ${paintedCount} tiles at (${centerX}, ${centerY}) with solid variant ${this.state.selectedTile}`);
        
        // DISABLED: Marching squares for now - just paint solid colors
        // this.applyMarchingSquaresToArea(centerX, centerY, brushSize + 1, true);
      }
  };
  
  // Apply marching squares bitmask to create smooth transitions around painted tiles
  forge.applyMarchingSquaresToArea = function(centerX, centerY, radius = 1, protectPaintedTiles = false) {
    if (!ENABLE_FORGE || !liveField) return;
    
    console.log(`Applying marching squares at (${centerX}, ${centerY})`);
    
    // Track which tiles were just painted so we don't overwrite them
    const paintedTiles = new Set();
    if (protectPaintedTiles) {
      // Mark the center tile and brush area as protected
      for (let x = centerX - radius; x <= centerX + radius; x++) {
        for (let y = centerY - radius; y <= centerY + radius; y++) {
          if (x >= 0 && x < liveField.width && y >= 0 && y < liveField.height) {
            paintedTiles.add(`${x},${y}`);
          }
        }
      }
    }
    
    // Simple and fast: just process the 3x3 area around the painted tile
    // This gives marching squares enough context to create good transitions
    for (let x = centerX - 1; x <= centerX + 1; x++) {
      for (let y = centerY - 1; y <= centerY + 1; y++) {
        if (x < 0 || x >= liveField.width || y < 0 || y >= liveField.height) continue;
        
        // Skip tiles that were just painted - they should stay as solid variants 0 or 10
        if (paintedTiles.has(`${x},${y}`)) {
          console.log(`Skipping painted tile (${x}, ${y}) - protecting solid variant`);
          continue;
        }
        
        // Apply marching squares to this tile
        this.applyMarchingSquaresToTile(x, y);
      }
    }
    
    // Update meshes for the processed area
    this.forceMeshUpdates(centerX, centerY, 1);
    
    console.log(`Marching squares complete for (${centerX}, ${centerY})`);
  };
  
  // Helper function to apply marching squares to a single tile
  forge.applyMarchingSquaresToTile = function(x, y) {
    if (!liveField.calculateCompatibleVariant) {
      console.warn('liveField.calculateCompatibleVariant not available');
      return;
    }
    
    const tile = liveField.tiles[y * liveField.width + x];
    if (!tile) return;
    
    // DEBUG: Show what we're working with
    console.log(`MS Debug: Tile at (${x}, ${y}) is currently type ${tile.type}`);
    
    // Let the existing marching squares system calculate the correct variant
    const tileVariant = liveField.calculateCompatibleVariant(x, y);
    
    console.log(`MS Debug: Marching squares calculated variant ${tileVariant} for tile at (${x}, ${y})`);
    
    // Only update if the tile actually needs to change
    if (tile.type !== tileVariant) {
      console.log(`MS Debug: Updating tile (${x}, ${y}) from ${tile.type} to ${tileVariant}`);
      tile.type = tileVariant;
      tile.atlasName = 'atlas-grass';
      
      // Update atlas coordinates if the method exists
      if (tile.updateAtlasCoordinates) {
        tile.updateAtlasCoordinates();
      }
    } else {
      console.log(`MS Debug: Tile (${x}, ${y}) already correct variant ${tileVariant}`);
    }
  };
  
  // Fix adjacent tiles for smooth transitions
  forge.fixAdjacentTilesInArea = function(centerX, centerY, brushSize) {
    if (!ENABLE_FORGE || !liveField) return;
    
    // Expand the area to fix tiles around the painted area
    // Use brush size + 2 to ensure we cover transition areas
    const expandSize = Math.max(brushSize + 2, 3);
    
    for (let x = centerX - expandSize; x <= centerX + expandSize; x++) {
      for (let y = centerY - expandSize; y <= centerY + expandSize; y++) {
        if (x < 0 || x >= liveField.width || y < 0 || y >= liveField.height) continue;
        
                 // Calculate compatible tile variant using marching squares
         if (liveField.calculateCompatibleVariant) {
           const tileVariant = liveField.calculateCompatibleVariant(x, y);
           const tile = liveField.tiles[y * liveField.width + x];
           
           if (tile && tile.type !== tileVariant) {
             tile.type = tileVariant;
             
             // Ensure the tile uses the grass atlas
             tile.atlasName = 'atlas-grass';
             
             // Update atlas coordinates if the method exists
             if (tile.updateAtlasCoordinates) {
               tile.updateAtlasCoordinates();
             }
           }
         } else {
           console.warn('liveField.calculateCompatibleVariant not available');
         }
      }
    }
    
    // Force mesh updates for the affected chunks
    this.forceMeshUpdates(centerX, centerY, expandSize);
  };
  
  // Force mesh updates for ONLY the specific tiles that changed
  forge.forceMeshUpdates = function(centerX, centerY, radius) {
    if (!ENABLE_FORGE || !liveField || !gfx || !gfx.scene) return;
    
    console.log(`Updating meshes for only the 3x3 area around (${centerX}, ${centerY})`);
    
    // Only update the specific tiles in the 3x3 area that actually changed
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      for (let y = centerY - radius; y <= centerY + radius; y++) {
        if (x < 0 || x >= liveField.width || y < 0 || y >= liveField.height) continue;
        
        // Find the specific tile mesh for this position and update it
        this.updateSingleTileMesh(x, y);
      }
    }
  };
  
  // Force mesh creation for all chunks (used during initialization)
  forge.forceAllMeshUpdates = function() {
    if (!ENABLE_FORGE || !liveField || !gfx || !gfx.scene) return;
    
    console.log('Creating meshes for all chunks...');
    
    // Get all chunks and create meshes for them
    for (const [key, chunk] of liveField.chunks) {
      if (chunk && chunk.needsMesh) {
        console.log(`Creating mesh for chunk ${chunk.chunkX},${chunk.chunkZ}`);
        
        // Create the mesh using our fallback function
        const mesh = this.createTerrainMesh(gfx.scene, chunk, TILE_SIZE);
        
        if (mesh) {
          // Store the mesh in the chunk
          chunk.mesh = mesh;
          chunk.needsMesh = false;
          console.log(`Mesh created for chunk ${chunk.chunkX},${chunk.chunkZ}`);
        } else {
          console.log(`Failed to create mesh for chunk ${chunk.chunkX},${chunk.chunkZ}`);
        }
      }
    }
    
    console.log('All chunk meshes created');
    
    // Debug: Count meshes in scene
    const meshCount = gfx.scene.meshes.length;
    console.log(`Total meshes in scene: ${meshCount}`);
    
    // Debug: List all meshes
    gfx.scene.meshes.forEach((mesh, index) => {
      console.log(`Mesh ${index}: ${mesh.name} at (${mesh.position.x}, ${mesh.position.y}, ${mesh.position.z})`);
    });
  };
  
  // Fallback terrain mesh creation function
  forge.createTerrainMesh = function(scene, chunk, tileSize) {
    if (!chunk) return null;
    
    console.log(`Creating terrain mesh for chunk ${chunk.chunkX},${chunk.chunkZ}`);
    
    // Create individual tile meshes for this chunk to show actual terrain
    // Use larger tiles (4x4 tile groups) to reduce density
    const tileGroupSize = 4; // Group 4x4 tiles together
    const chunkMeshes = [];
    
    for (let x = chunk.startX; x < chunk.endX; x += tileGroupSize) {
      for (let z = chunk.startZ; z < chunk.endZ; z += tileGroupSize) {
        // Get the dominant tile type in this 4x4 area
        let dominantType = 5; // Default to main grass
        let tileCount = 0;
        
        for (let dx = 0; dx < tileGroupSize && x + dx < chunk.endX; dx++) {
          for (let dz = 0; dz < tileGroupSize && z + dz < chunk.endZ; dz++) {
            const tileIndex = (z + dz) * liveField.width + (x + dx);
            const tile = liveField.tiles[tileIndex];
            if (tile) {
              dominantType = tile.type;
              tileCount++;
            }
          }
        }
        
                         if (tileCount > 0) {
          console.log(`Creating tile mesh at (${x}, ${z}) with type ${dominantType}`);
          
          // Create a larger tile mesh representing the 4x4 area
          const tileMesh = BABYLON.MeshBuilder.CreateBox(
            `tile_${x}_${z}`, 
            { width: tileSize * tileGroupSize, height: 0.1, depth: tileSize * tileGroupSize }, 
            scene
          );
           
           // Position the tile to cover the exact 4x4 area without gaps
           tileMesh.position.x = x * tileSize;
           tileMesh.position.z = z * tileSize;
           tileMesh.position.y = 0.05; // Slightly above ground
          
          // Create material with actual atlas texture
          const material = new BABYLON.StandardMaterial(`tile_mat_${x}_${z}`, scene);
          
          // Try to load the actual atlas texture
          const atlasName = this.getAtlasNameForTileType(dominantType);
          console.log(`Using atlas: ${atlasName} for tile type ${dominantType}`);
          
          if (atlasName) {
            try {
              const texture = new BABYLON.Texture(`assets/textures/${atlasName}.png`, scene);
              material.diffuseTexture = texture;
              console.log(`Texture loaded successfully for ${atlasName}`);
            } catch (error) {
              console.error(`Failed to load texture ${atlasName}:`, error);
              // Fallback to colored material
              material.diffuseColor = this.getColorForTileType(dominantType);
            }
            
            // Set UV coordinates for the specific tile variant
            const uvCoords = this.getUVCoordinatesForTileType(dominantType);
            if (uvCoords) {
              // Apply UV mapping for the specific tile variant
              material.diffuseTexture.uScale = uvCoords.scale;
              material.diffuseTexture.vScale = uvCoords.scale;
              material.diffuseTexture.uOffset = uvCoords.uOffset;
              material.diffuseTexture.vOffset = uvCoords.vOffset;
            }
          } else {
            // Fallback to colored material if texture fails
            material.diffuseColor = this.getColorForTileType(dominantType);
          }
          
          // Add some height variation based on position
          const heightVariation = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 0.2;
          tileMesh.position.y += heightVariation;
          
          tileMesh.material = material;
          tileMesh.isVisible = true;
          tileMesh.isPickable = true;
          
          chunkMeshes.push(tileMesh);
        }
      }
    }
    
    // Create a parent mesh to hold all tiles
    const parentMesh = new BABYLON.Mesh(`chunk_${chunk.chunkX}_${chunk.chunkZ}`, scene);
    parentMesh.isVisible = false; // Parent is invisible, only tiles show
    
    // Parent all tile meshes to the chunk mesh
    chunkMeshes.forEach(mesh => {
      mesh.parent = parentMesh;
    });
    
    // Store the tile meshes in the chunk for later updates
    chunk.tileMeshes = chunkMeshes;
    
    console.log(`Created ${chunkMeshes.length} tile group meshes for chunk ${chunk.chunkX},${chunk.chunkZ}`);
    
    return parentMesh;
  };
  
  // Get atlas name for tile type - using grass atlas for debugging
  forge.getAtlasNameForTileType = function(tileType) {
    // Using grass atlas for debugging
    return 'atlas-grass';
  };
  
  // Get UV coordinates for tile type - use the actual tile type for proper mapping
  forge.getUVCoordinatesForTileType = function(tileType) {
    // Use the actual tile type, not the selected variant
    // This ensures marching squares variants (1-9, 11-15) map correctly
    
    // Calculate UV coordinates for the specific atlas tile
    // Assuming tiles are positioned in a 4x4 grid
    const row = Math.floor(tileType / 4);
    const col = tileType % 4;
    
    console.log(`UV mapping: tile type ${tileType} -> row ${row}, col ${col}`);
    
    return {
      scale: 0.25, // Each tile takes 1/4 of the texture
      uOffset: col * 0.25,
      vOffset: (3 - row) * 0.25 // Flip V coordinate (0 is at bottom)
    };
  };
  
  // Get fallback color for tile type
  forge.getColorForTileType = function(tileType) {
    switch (tileType) {
      case 0: // Empty grass
        return new BABYLON.Color3(0.2, 0.8, 0.2);
      case 1: // Grass variant 1
        return new BABYLON.Color3(0.3, 0.9, 0.3);
      case 2: // Grass variant 2
        return new BABYLON.Color3(0.1, 0.7, 0.1);
      case 5: // Main grass type
        return new BABYLON.Color3(0.4, 0.9, 0.4);
      default:
        return new BABYLON.Color3(0.5, 0.8, 0.5);
    }
  };
  
  // Update a single tile mesh at specific coordinates
  forge.updateSingleTileMesh = function(x, y) {
    if (!ENABLE_FORGE || !liveField || !gfx || !gfx.scene) return;
    
    // Find the tile mesh that covers this position
    // Since we group tiles in 4x4 areas, find which group this tile belongs to
    const tileGroupSize = 4;
    const groupX = Math.floor(x / tileGroupSize) * tileGroupSize;
    const groupZ = Math.floor(y / tileGroupSize) * tileGroupSize;
    
    // Look for the mesh that covers this 4x4 group
    const meshName = `tile_${groupX}_${groupZ}`;
    const tileMesh = gfx.scene.getMeshByName(meshName);
    
    if (tileMesh && tileMesh.material) {
      // Get the current tile type at this position
      const tile = liveField.tiles[y * liveField.width + x];
      if (tile) {
        console.log(`Updating mesh ${meshName} at (${x}, ${y}) to type ${tile.type}`);
        
        // Update the material to reflect the new tile type
        if (tileMesh.material.diffuseTexture) {
          // Update UV coordinates for the specific tile type
          const uvCoords = this.getUVCoordinatesForTileType(tile.type);
          if (uvCoords) {
            tileMesh.material.diffuseTexture.uScale = uvCoords.scale;
            tileMesh.material.diffuseTexture.vScale = uvCoords.scale;
            tileMesh.material.diffuseTexture.uOffset = uvCoords.uOffset;
            tileMesh.material.diffuseTexture.vOffset = uvCoords.vOffset;
          }
        } else {
          // Fallback to colored material
          tileMesh.material.diffuseColor = this.getColorForTileType(tile.type);
        }
      }
    }
  };
  
  // Update tile meshes in a chunk to reflect current terrain
  forge.updateChunkTileMeshes = function(chunk) {
    if (!chunk || !chunk.tileMeshes) return;
    
    chunk.tileMeshes.forEach(tileMesh => {
      // Extract position from mesh name (tile_x_z)
      const nameParts = tileMesh.name.split('_');
      const x = parseInt(nameParts[1]);
      const z = parseInt(nameParts[2]);
      
      if (!isNaN(x) && !isNaN(z)) {
        // Get the dominant tile type in the 4x4 area
        const tileGroupSize = 4;
        let dominantType = 5; // Default to main grass
        
        for (let dx = 0; dx < tileGroupSize; dx++) {
          for (let dz = 0; dz < tileGroupSize; dz++) {
            const tileIndex = (z + dz) * liveField.width + (x + dx);
            const tile = liveField.tiles[tileIndex];
            if (tile) {
              dominantType = tile.type;
            }
          }
        }
        
        if (tileMesh.material) {
          // Update material with new atlas texture
          const atlasName = this.getAtlasNameForTileType(dominantType);
          if (atlasName && !tileMesh.material.diffuseTexture) {
            // Create texture if it doesn't exist
            const texture = new BABYLON.Texture(`assets/textures/${atlasName}.png`, gfx.scene);
            tileMesh.material.diffuseTexture = texture;
          }
          
          if (tileMesh.material.diffuseTexture) {
            // Update UV coordinates for the new tile type
            const uvCoords = this.getUVCoordinatesForTileType(dominantType);
            if (uvCoords) {
              tileMesh.material.diffuseTexture.uScale = uvCoords.scale;
              tileMesh.material.diffuseTexture.vScale = uvCoords.scale;
              tileMesh.material.diffuseTexture.uOffset = uvCoords.uOffset;
              tileMesh.material.diffuseTexture.vOffset = uvCoords.vOffset;
            }
          } else {
            // Fallback to colored material
            tileMesh.material.diffuseColor = this.getColorForTileType(dominantType);
          }
        }
      }
    });
  };
  
  // Change brush size
  forge.setBrushSize = function(size) {
    if (!ENABLE_FORGE) return;
    
    this.state.brushSize = Math.max(1, Math.min(10, size)); // Clamp between 1-10
    console.log(`Brush size set to ${this.state.brushSize}`);
  };
  
  // Change terrain type
  forge.setTerrainType = function(type) {
    if (!ENABLE_FORGE || !this.terrainTypes[type]) return;
    
    this.state.currentBrush = type;
    console.log(`Terrain type set to ${this.terrainTypes[type].name}`);
  };
  
  // Change selected tile variant
  forge.setTileVariant = function(variant) {
    if (!ENABLE_FORGE) return;
    
    const terrain = this.terrainTypes[this.state.currentBrush];
    if (variant >= 0 && variant < terrain.variants) {
      this.state.selectedTile = variant;
      console.log(`Tile variant set to ${variant}`);
    }
  };
  
  // Fill entire field with terrain type
  forge.fillField = function(terrainType, variant = 0) {
    if (!ENABLE_FORGE || !liveField) return;
    
    const terrain = this.terrainTypes[terrainType];
    if (!terrain) return;
    
    console.log(`Filling field with ${terrain.name}`);
    
    for (let i = 0; i < liveField.tiles.length; i++) {
      const tile = liveField.tiles[i];
      tile.type = variant;
      tile.atlasName = terrain.atlas;
      tile.updateAtlasCoordinates();
    }
    
    // Fix all adjacent tiles for smooth transitions
    liveField.fixAdjacentTiles();
  };
  
  // Clear field (set all to empty)
  forge.clearField = function() {
    if (!ENABLE_FORGE || !liveField) return;
    
    console.log('Clearing field');
    this.fillField('grass', 0); // Set all to empty grass
  };
  
  // Reset camera to default position
  forge.resetCamera = function() {
    if (!ENABLE_FORGE || !gfx || !gfx.camera) return;
    
    console.log('Resetting camera');
    
    // Position camera high above for near-top-down view of the 200x200 field
    gfx.camera.position = new Vec3(0, 200, 0);
    
    // Look at a point slightly in front to avoid gimbal lock
    gfx.camera.setTarget(new Vec3(0, 0, -50));
    
    // Set standard up vector
    gfx.camera.upVector = new Vec3(0, 1, 0);
    
    // Force the camera to recalculate its view matrix
    gfx.camera.getViewMatrix();
    
    // Update camera status
    this.updateCameraStatus('Near Top-Down View');
  };
  
  // Set camera to top-down view for map editing
  forge.setTopView = function() {
    if (!ENABLE_FORGE || !gfx || !gfx.camera) return;
    
    console.log('Setting top view');
    
    // Position camera above the center of the field
    const fieldCenterX = liveField ? (liveField.width * TILE_SIZE) / 2 : 0;
    const fieldCenterZ = liveField ? (liveField.height * TILE_SIZE) / 2 : 0;
    
    // For UniversalCamera, we need to work WITH the camera system, not against it
    // Position camera high above the field
    gfx.camera.position = new Vec3(fieldCenterX, 200, fieldCenterZ);
    
    // Instead of trying to force it to look straight down, let's create a "near-top-down" view
    // Look at a point slightly in front of the camera (in the negative Z direction)
    // This gives us a view that's almost top-down but avoids the gimbal lock issue
    gfx.camera.setTarget(new Vec3(fieldCenterX, 0, fieldCenterZ - 50));
    
    // Set the up vector to point in the positive Y direction (standard up)
    gfx.camera.upVector = new Vec3(0, 1, 0);
    
    // Force the camera to recalculate its view matrix
    gfx.camera.getViewMatrix();
    
    // Update camera status
    this.updateCameraStatus('Near Top-Down View');
  };
  
  // Set camera to isometric view for better map editing
  forge.setIsometricView = function() {
    if (!ENABLE_FORGE || !gfx || !gfx.camera) return;
    
    console.log('Setting isometric view');
    
    // Position camera at an isometric angle
    const fieldCenterX = liveField ? (liveField.width * TILE_SIZE) / 2 : 0;
    const fieldCenterZ = liveField ? (liveField.height * TILE_SIZE) / 2 : 0;
    
    // Set camera position for isometric view (45-degree angle)
    const distance = 40;
    gfx.camera.position = new Vec3(
      fieldCenterX - distance,
      30,
      fieldCenterZ - distance
    );
    
    // Look at the center of the field
    gfx.camera.setTarget(new Vec3(fieldCenterX, 0, fieldCenterZ));
    
    // Update camera status
    this.updateCameraStatus('Isometric View');
  };
  
  // Update camera status display
  forge.updateCameraStatus = function(mode) {
    const statusElement = document.getElementById('camera-status');
    if (statusElement) {
      statusElement.textContent = `Mode: ${mode}`;
    }
  };
  
  // Update button visual states
  forge.updateButtonStates = function() {
    // No special button states needed anymore
  };
  
  // Handle keyboard shortcuts for camera controls
  forge.handleKeyboard = function(e) {
    if (!ENABLE_FORGE) return;
    
    // Only handle shortcuts when not typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    
    switch (e.key.toLowerCase()) {
      case '1':
        this.resetCamera();
        break;
      case '2':
        this.setTopView();
        break;
      case '3':
        this.setIsometricView();
        break;
      case 'f9':
        // Toggle Babylon Inspector like in main game
        if (gfx && gfx.scene) {
          gfx.scene.debugLayer.show();
        }
        break;
      case 'escape':
        // Reset camera on escape
        this.resetCamera();
        break;
      case 'r':
        // Reattach camera controls
        this.ensureCameraControls();
        break;
      case '0':
        // Toggle camera controls on/off
        this.toggleCameraControls();
        break;
    }
  };
  
  // Ensure camera controls are properly attached and working
  forge.ensureCameraControls = function() {
    if (!ENABLE_FORGE || !gfx || !gfx.camera || !gfx.canvas) return;
    
    // Check if camera is already attached
    if (!gfx.camera.inputs || gfx.camera.inputs.length === 0) {
      console.log('Reattaching camera controls...');
      gfx.camera.attachControl(gfx.canvas, true);
    }
    
    // Ensure camera movement settings are correct - LUDICROUS SPEED NOW!
    if (gfx.camera.speed !== undefined) {
      gfx.camera.speed = 25.0; // 3x faster movement (was 8.0) - NOW REALLY FAST!
    }
    if (gfx.camera.angularSpeed !== undefined) {
      gfx.camera.angularSpeed = 15.0; // SUPER FAST rotation - turn the camera way more with each mouse movement!
    }
    if (gfx.camera.panningSensibility !== undefined) {
      gfx.camera.panningSensibility = 80; // 4x faster panning (was 20) - ZOOM AROUND!
    }
    if (gfx.camera.wheelPrecision !== undefined) {
      gfx.camera.wheelPrecision = 0.005; // 5x faster zoom (was 0.025) - INSTANT ZOOM!
    }
    
    console.log('Camera controls verified and configured - LUDICROUS SPEED ACHIEVED! 🚀');
  };
  
  // Toggle camera controls on/off
  forge.toggleCameraControls = function() {
    if (!ENABLE_FORGE || !gfx || !gfx.camera || !gfx.canvas) return;
    
    if (gfx.camera.inputs && gfx.camera.inputs.length > 0) {
      console.log('Detaching camera controls...');
      gfx.camera.detachControl(gfx.canvas);
    } else {
      console.log('Attaching camera controls...');
      gfx.camera.attachControl(gfx.canvas, true);
    }
  };
  
  // Setup UI controls
  forge.setupUI = function() {
    if (!ENABLE_FORGE) return;
    
    // Create UI elements for forge controls
    this.createForgeUI();
  };
  
  // Create forge UI elements
  forge.createForgeUI = function() {
    if (!ENABLE_FORGE) return;
    
    // Check if UI already exists
    if (document.getElementById('forge-ui')) {
      // If UI exists, just show it
      document.getElementById('forge-ui').style.display = 'block';
      return;
    }
    
    const forgeUI = document.createElement('div');
    forgeUI.id = 'forge-ui';
    forgeUI.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 15px;
      border-radius: 8px;
      font-family: Arial, sans-serif;
      z-index: 1000;
    `;
    
         forgeUI.innerHTML = `
       <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
         <h3 style="margin: 0;">Forge Editor</h3>
         <button id="close-forge-btn" style="background: #ff6b6b; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px;">✕</button>
       </div>
      
      <div style="margin-bottom: 10px;">
        <label>Terrain: </label>
        <select id="terrain-select">
          <option value="grass">Grass</option>
          <option value="dirt">Dirt</option>
          <option value="rock">Rock</option>
          <option value="sand">Sand</option>
          <option value="water">Water</option>
        </select>
      </div>
      
      <div style="margin-bottom: 10px;">
        <label>Brush Size: </label>
        <input type="range" id="brush-size" min="1" max="10" value="1">
        <span id="brush-size-value">1</span>
      </div>
      
             <div style="margin-bottom: 10px;">
         <label>Tile Variant: </label>
         <select id="tile-variant">
           <option value="0">Tile 0 (First Solid Color)</option>
           <option value="10">Tile 10 (Second Solid Color)</option>
         </select>
       </div>
      
             <div style="margin-bottom: 10px;">
         <button id="fill-btn">Fill Field</button>
         <button id="clear-btn">Clear Field</button>
         <button id="refresh-field-btn" style="margin-left: 5px;">Refresh Field</button>
         <button id="debug-ms-btn" style="margin-left: 5px; background: #ff6b6b;">Debug MS</button>
         <button id="toggle-ms-btn" style="margin-left: 5px; background: #4CAF50;">Auto MS: ON</button>
       </div>
      
      <div style="margin-bottom: 10px;">
        <h4 style="margin: 0 0 8px 0;">Camera Controls</h4>
        <div style="font-size: 11px; margin-bottom: 5px;">
          <strong>Mouse:</strong> Right-click + drag to pan, scroll to zoom
        </div>
        <div style="font-size: 11px; margin-bottom: 5px;">
          <strong>Keys:</strong> WASD to move, QE to rotate
        </div>
                 <div style="font-size: 11px; margin-bottom: 5px;">
           <strong>Shortcuts:</strong> 1=Reset, 2=Top, 3=Isometric, F9=Inspector, ESC=Reset
         </div>
        <div style="margin-top: 8px;">
                     <button id="reset-camera-btn" style="margin-right: 5px;">Reset Camera</button>
           <button id="top-view-btn">Top View</button>
           <button id="isometric-btn" style="margin-left: 5px;">Isometric</button>
        </div>
                 <div style="margin-top: 5px;">
           <button id="reattach-camera-btn" style="background: #2196F3; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">Reattach Camera Controls</button>
           <button id="test-tile-btn" style="background: #FF5722; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-left: 5px;">Create Test Tile</button>
         </div>
                 <div id="camera-status" style="font-size: 10px; margin-top: 5px; opacity: 0.7;">
           Mode: Top-Down View
         </div>
      </div>
      
             <div style="font-size: 12px; opacity: 0.8;">
         Click and drag to paint terrain<br>
         <small style="opacity: 0.7;">Tiles grouped in 4x4 areas for better performance</small>
       </div>
    `;
    
    document.body.appendChild(forgeUI);
    
    // Setup event handlers
    this.setupUIEvents();
  };
  
  // Setup UI event handlers
  forge.setupUIEvents = function() {
    if (!ENABLE_FORGE) return;
    
    // Terrain type selector
    const terrainSelect = document.getElementById('terrain-select');
    if (terrainSelect) {
      terrainSelect.addEventListener('change', (e) => {
        this.setTerrainType(e.target.value);
      });
    }
    
    // Brush size slider
    const brushSize = document.getElementById('brush-size');
    const brushSizeValue = document.getElementById('brush-size-value');
    if (brushSize && brushSizeValue) {
      brushSize.addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        brushSizeValue.textContent = size;
        this.setBrushSize(size);
      });
    }
    
    // Tile variant input
    const tileVariant = document.getElementById('tile-variant');
    if (tileVariant) {
      tileVariant.addEventListener('change', (e) => {
        this.setTileVariant(parseInt(e.target.value));
      });
    }
    
    // Fill button
    const fillBtn = document.getElementById('fill-btn');
    if (fillBtn) {
      fillBtn.addEventListener('click', () => {
        const terrainType = terrainSelect ? terrainSelect.value : 'grass';
        const variant = tileVariant ? parseInt(tileVariant.value) : 0;
        this.fillField(terrainType, variant);
      });
    }
    
         // Clear button
     const clearBtn = document.getElementById('clear-btn');
     if (clearBtn) {
       clearBtn.addEventListener('click', () => {
         this.clearField();
       });
     }
     
     // Refresh field button
     const refreshFieldBtn = document.getElementById('refresh-field-btn');
     if (refreshFieldBtn) {
       refreshFieldBtn.addEventListener('click', () => {
         this.initializeField();
       });
     }
    
    // Reset camera button
    const resetCameraBtn = document.getElementById('reset-camera-btn');
    if (resetCameraBtn) {
      resetCameraBtn.addEventListener('click', () => {
        this.resetCamera();
      });
    }
    
    // Top view button
    const topViewBtn = document.getElementById('top-view-btn');
    if (topViewBtn) {
      topViewBtn.addEventListener('click', () => {
        this.setTopView();
      });
    }
    
    
    
         // Isometric view button
     const isometricBtn = document.getElementById('isometric-btn');
     if (isometricBtn) {
       isometricBtn.addEventListener('click', () => {
         this.setIsometricView();
       });
     }
     
     // Debug marching squares button
     const debugMsBtn = document.getElementById('debug-ms-btn');
     if (debugMsBtn) {
       debugMsBtn.addEventListener('click', () => {
         // Debug around the center of the field
         const centerX = Math.floor(liveField.width / 2);
         const centerZ = Math.floor(liveField.height / 2);
         this.debugMarchingSquares(centerX, centerZ, 5);
       });
     }
     
     // Close button
     const closeForgeBtn = document.getElementById('close-forge-btn');
     if (closeForgeBtn) {
       closeForgeBtn.addEventListener('click', () => {
         this.hideForgeUI();
       });
     }
     
     // Toggle marching squares button
     const toggleMsBtn = document.getElementById('toggle-ms-btn');
     if (toggleMsBtn) {
       toggleMsBtn.addEventListener('click', () => {
         this.state.autoMarchingSquares = !this.state.autoMarchingSquares;
         const isOn = this.state.autoMarchingSquares;
         toggleMsBtn.textContent = `Auto MS: ${isOn ? 'ON' : 'OFF'}`;
         toggleMsBtn.style.background = isOn ? '#4CAF50' : '#ff9800';
         console.log(`Auto marching squares: ${isOn ? 'enabled' : 'disabled'}`);
       });
     }
     
           // Reattach camera controls button
      const reattachCameraBtn = document.getElementById('reattach-camera-btn');
      if (reattachCameraBtn) {
        reattachCameraBtn.addEventListener('click', () => {
          this.ensureCameraControls();
          console.log('Camera controls manually reattached');
        });
      }
      
      // Test tile button
      const testTileBtn = document.getElementById('test-tile-btn');
      if (testTileBtn) {
        testTileBtn.addEventListener('click', () => {
          this.createTestTile();
        });
      }
  };
  
    // Hide the forge UI
  forge.hideForgeUI = function() {
    const forgeUI = document.getElementById('forge-ui');
    if (forgeUI) {
      forgeUI.style.display = 'none';
    }
  };
  
  // Show the forge UI
  forge.showForgeUI = function() {
    this.createForgeUI();
  };
  
  // Debug function to show marching squares in action
  forge.debugMarchingSquares = function(x, y, radius = 3) {
    if (!ENABLE_FORGE || !liveField) return;
    
    console.log(`=== Debugging Marching Squares around (${x}, ${y}) ===`);
    
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const checkX = x + dx;
        const checkY = y + dy;
        
        if (checkX < 0 || checkX >= liveField.width || checkY < 0 || checkY >= liveField.height) continue;
        
        const tile = liveField.tiles[checkY * liveField.width + checkX];
        if (tile) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          const isInRadius = distance <= radius;
          const marker = isInRadius ? '●' : '○';
          
          console.log(`${marker} (${checkX}, ${checkY}): Type ${tile.type}, Distance ${distance.toFixed(1)}`);
        }
      }
    }
    
    console.log('=== End Debug ===');
  };
  
  // Test function to create a simple visible tile
  forge.createTestTile = function() {
    if (!ENABLE_FORGE || !gfx || !gfx.scene) return;
    
    console.log('Creating test tile...');
    
    // Create a simple test tile
    const testTile = BABYLON.MeshBuilder.CreateBox('test_tile', { width: 4, height: 0.2, depth: 4 }, gfx.scene);
    testTile.position = new BABYLON.Vector3(0, 0.1, 0);
    
    // Create a bright red material so it's obvious
    const testMaterial = new BABYLON.StandardMaterial('test_mat', gfx.scene);
    testMaterial.diffuseColor = new BABYLON.Color3(1, 0, 0); // Bright red
    testMaterial.emissiveColor = new BABYLON.Color3(0.2, 0, 0); // Slight glow
    
    testTile.material = testMaterial;
    testTile.isVisible = true;
    testTile.isPickable = true;
    
    console.log('Test tile created at position (0, 0.1, 0) - should be visible as a red square');
    
    return testTile;
  };
  
  // Export forge object
  window.forge = forge;
  
 })(window.forge || {});
