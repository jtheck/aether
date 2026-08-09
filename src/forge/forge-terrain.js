// Forge Terrain Painting Module
(function(forge) {
  'use strict';

  // Paint terrain at position
  forge.paintAtPosition = function(pos) {
    const field = window.liveField;
    if (!field) return;

    const terrain = this.terrainTypes[this.state.currentBrush];
    if (!terrain) return;
    
    // Get all symmetric positions to paint
    const positions = this.getSymmetricPositions(pos);

    // Snapshot tiles in the full affected area BEFORE painting (includes transition margin)
    const margin = this.state.brushSize + 3;
    const snapshotIndices = new Set();
    for (const basePos of positions) {
      for (let dx = -margin; dx <= margin; dx++) {
        for (let dy = -margin; dy <= margin; dy++) {
          const x = basePos.x + dx;
          const y = basePos.y + dy;
          if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
          snapshotIndices.add(y * field.width + x);
        }
      }
    }
    const beforeState = new Map();
    for (const index of snapshotIndices) {
      const tile = field.tiles[index];
      beforeState.set(index, {
        terrainType: field.terrainTypes[index],
        tileType: tile ? tile.type : 0,
        atlasName: tile ? tile.atlasName : 'atlas-grass-dirt'
      });
    }

    const affectedChunks = new Set();
    const paintedTiles = [];

    const isChunkEnabled = (x, y) => {
      if (!field.chunkMask) return true;
      const chunkX = Math.floor(x / field.chunkSize);
      const chunkZ = Math.floor(y / field.chunkSize);
      return field.chunkMask.get(`${chunkX},${chunkZ}`) !== false;
    };
    
    for (const basePos of positions) {
      for (let dx = -this.state.brushSize; dx <= this.state.brushSize; dx++) {
        for (let dy = -this.state.brushSize; dy <= this.state.brushSize; dy++) {
          const x = basePos.x + dx;
          const y = basePos.y + dy;

          if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
          if (!isChunkEnabled(x, y)) continue;

          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > this.state.brushSize) continue;

          const index = y * field.width + x;
          field.terrainTypes[index] = terrain.terrainType;
          paintedTiles.push({x, y});

          const chunkX = Math.floor(x / field.chunkSize);
          const chunkZ = Math.floor(y / field.chunkSize);
          affectedChunks.add(`${chunkX},${chunkZ}`);
        }
      }
    }
    
    if (terrain.terrainType === 1) {
      for (const tile of paintedTiles) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = tile.x + dx;
            const ny = tile.y + dy;
            if (nx < 0 || nx >= field.width || ny < 0 || ny >= field.height) continue;
            
            const nIndex = ny * field.width + nx;
            if (field.terrainTypes[nIndex] === 2) {
              field.terrainTypes[nIndex] = 3;
              
              const chunkX = Math.floor(nx / field.chunkSize);
              const chunkZ = Math.floor(ny / field.chunkSize);
              affectedChunks.add(`${chunkX},${chunkZ}`);
            }
          }
        }
      }
    }
    
    for (const p of positions) {
      this.applyTransitionsInArea(p.x, p.y, this.state.brushSize + 2);
    }

    // Record changes by comparing before/after state
    for (const index of snapshotIndices) {
      const before = beforeState.get(index);
      const tile = field.tiles[index];
      const afterTerrainType = field.terrainTypes[index];
      const afterTileType = tile ? tile.type : 0;
      const afterAtlasName = tile ? tile.atlasName : 'atlas-grass-dirt';

      if (before.terrainType !== afterTerrainType ||
          before.tileType !== afterTileType ||
          before.atlasName !== afterAtlasName) {
        this.recordChange({
          kind: 'tile', index,
          oldTerrainType: before.terrainType, newTerrainType: afterTerrainType,
          oldTileType: before.tileType, newTileType: afterTileType,
          oldAtlasName: before.atlasName, newAtlasName: afterAtlasName
        });
      }
    }

    this.rebuildChunks(affectedChunks);
  };
  
  // Apply marching squares transitions in an area
  forge.applyTransitionsInArea = function(centerX, centerY, radius) {
    const field = window.liveField;
    if (!field || !field.tiles || !field.terrainTypes) return;
    
    const grassVsDirt = field.terrainTypes.map(t => t === 3 ? 1 : 0);
    const grassVsWater = field.terrainTypes.map(t => (t === 3 || t === 2) ? 1 : 0);
    
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      for (let y = centerY - radius; y <= centerY + radius; y++) {
        if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
        
        const index = y * field.width + x;
        const tile = field.tiles[index];
        
        if (!tile) continue;
        
        const terrain = field.terrainTypes[index];
        
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
        
        if (terrain === 1) {
          if (hasGrassNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsWater);
          } else {
            tile.type = 12;
          }
          tile.atlasName = 'atlas-grass-water';
        } else if (terrain === 3) {
          if (hasWaterNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsWater);
            tile.atlasName = 'atlas-grass-water';
          } else if (hasDirtNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsDirt);
            tile.atlasName = 'atlas-grass-dirt';
          } else {
            tile.type = 6;
            tile.atlasName = 'atlas-grass-dirt';
          }
        } else if (terrain === 2) {
          if (hasGrassNeighbor && field.calculateCompatibleVariant) {
            tile.type = field.calculateCompatibleVariant(x, y, grassVsDirt);
          } else {
            tile.type = 12;
          }
          tile.atlasName = 'atlas-grass-dirt';
        }
        
        if (tile.updateAtlasCoordinates) {
          tile.updateAtlasCoordinates();
        }
      }
    }
  };

  // Show brush size preview overlay
  forge.showBrushPreview = function() {
    const scene = gfx?.scene;
    if (!scene) return;

    this.hideBrushPreview();

    const brushSize = this.state.brushSize;
    if (brushSize <= 0) return;

    const circle = BABYLON.MeshBuilder.CreateCylinder(
      'brush-preview',
      {
        diameter: brushSize * 2 * TILE_SIZE,
        height: 0.1,
        tessellation: 32
      },
      scene
    );

    circle.position.y = 0.05;
    this._brushPreviewOverlay = circle;

    const mat = new BABYLON.StandardMaterial('brush-preview-mat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 1);
    mat.emissiveColor = new BABYLON.Color3(0.1, 0.3, 0.5);
    mat.alpha = 0.3;
    circle.material = mat;

    this._brushPreviewVisible = true;
  };

  forge.hideBrushPreview = function() {
    if (this._brushPreviewOverlay) {
      this._brushPreviewOverlay.dispose();
      this._brushPreviewOverlay = null;
    }
    this._brushPreviewVisible = false;
  };

  forge.updateBrushPreview = function(mousePos) {
    if (this._brushPreviewOverlay && mousePos) {
      const worldX = mousePos.x * TILE_SIZE + 0.5 * TILE_SIZE;
      const worldZ = mousePos.y * TILE_SIZE + 0.5 * TILE_SIZE;
      this._brushPreviewOverlay.position.x = worldX;
      this._brushPreviewOverlay.position.z = worldZ;
    }
  };

  // Set brush type
  forge.setBrush = function(type) {
    this.state.currentBrush = type;
    
    document.querySelectorAll('.forge-btn').forEach(btn => {
      if (btn.id && btn.id.startsWith('brush-')) {
        btn.classList.toggle('active', btn.id === `brush-${type}`);
      }
    });
    
    console.log(`🖌️ Brush: ${type}`);
  };

  // Set brush size
  forge.setBrushSize = function(size) {
    this.state.brushSize = parseInt(size);
    document.getElementById('brush-size-label').textContent = size;

    if (this._brushPreviewVisible) {
      this.showBrushPreview();
    }
  };

})(window.forge);
