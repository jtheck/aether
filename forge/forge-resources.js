// Forge Resources Module - Resource placement, erasure, populate, and grid overlays
(function(forge) {
  'use strict';

  // Get all tiles occupied by a resource at position
  forge.getResourceFootprint = function(pos, resourceType) {
    const footprint = resourceType.footprint || 0;
    const tiles = [];
    
    for (let dx = -footprint; dx <= footprint; dx++) {
      for (let dy = -footprint; dy <= footprint; dy++) {
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
    
    if (this._placedKeys) {
      this._placedKeys.forEach(k => occupied.add(k));
    }
    
    if (this.state.buildings) {
      this.state.buildings.forEach(building => {
        const buildingDef = window.BuildingTypes?.[building.type];
        if (!buildingDef || !buildingDef.size) return;
        
        const width = buildingDef.size.width || 1;
        const height = buildingDef.size.height || 1;
        
        for (let dx = 0; dx < width; dx++) {
          for (let dz = 0; dz < height; dz++) {
            occupied.add(`${building.x + dx},${building.y + dz}`);
          }
        }
      });
    }
    
    if (gfx && gfx.lodModels) {
      gfx.lodModels.forEach(lod => {
        if (!lod.model || lod.model.isDisposed()) return;
        const pos = lod.model.position;
        const tx = Math.floor(pos.x / TILE_SIZE);
        const tz = Math.floor(pos.z / TILE_SIZE);
        
        if (this._erasedAutoResources && this._erasedAutoResources.has(`${tx},${tz}`)) return;
        
        const scale = lod.model.scaling ? lod.model.scaling.x : 1;
        let footprint = 0;
        if (scale >= 10) footprint = 2;
        else if (scale >= 6) footprint = 1;
        
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

  // Throttle for resource placement
  forge._lastResourcePlace = 0;
  forge._resourcePlaceDelay = 150;
  forge._modelCache = new Map();
  forge._placedResources = new Map();

  forge.placeResourceAt = function(pos) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;

    const now = Date.now();
    if (now - this._lastResourcePlace < this._resourcePlaceDelay) return;
    this._lastResourcePlace = now;
    
    const positions = this.getSymmetricPositions(pos);

    if (!this._placedKeys) this._placedKeys = new Set();
    if (!this._resourceFootprints) this._resourceFootprints = new Map();

    if (this.state.currentResource === 'eraser') {
      positions.forEach(p => this._eraseResourceAt(p));
      return;
    }
    
    positions.forEach(p => this._placeResourceAtSingle(p));
  };

  forge._eraseResourceAt = function(pos) {
    const field = window.liveField;
    const key = `${pos.x},${pos.y}`;
    
    {
      let erased = false;
      
      if (this._resourceFootprints) {
        for (const [rKey, footprintKeys] of this._resourceFootprints) {
          if (footprintKeys.includes(key)) {
            // Record for undo before erasing
            const [rx, ry] = rKey.split(',').map(Number);
            const rType = this._placedResourceTypes ? this._placedResourceTypes.get(rKey) : 'trees';
            this.recordChange({ kind: 'resource_remove', data: { x: rx, y: ry, type: rType } });

            if (this._placedResources.has(rKey)) {
              const mesh = this._placedResources.get(rKey);
              if (mesh && mesh.dispose) mesh.dispose();
              this._placedResources.delete(rKey);
            }
            if (this._placedResourceTypes) this._placedResourceTypes.delete(rKey);
            footprintKeys.forEach(k => this._placedKeys.delete(k));
            this._resourceFootprints.delete(rKey);
            erased = true;
            break;
          }
        }
      }
      
      if (!erased && gfx && gfx.lodModels) {
        for (let i = gfx.lodModels.length - 1; i >= 0; i--) {
          const lod = gfx.lodModels[i];
          if (!lod.model || lod.model.isDisposed()) continue;
          
          const modelPos = lod.model.position;
          const tx = Math.floor(modelPos.x / TILE_SIZE);
          const tz = Math.floor(modelPos.z / TILE_SIZE);
          
          const scale = lod.model.scaling ? lod.model.scaling.x : 1;
          let footprint = 0;
          if (scale >= 10) footprint = 2;
          else if (scale >= 6) footprint = 1;
          
          const [clickX, clickY] = key.split(',').map(Number);
          const dx = clickX - tx;
          const dy = clickY - tz;
          if (Math.sqrt(dx*dx + dy*dy) <= footprint + 0.5) {
            if (lod.model) lod.model.dispose();
            if (lod.billboard) lod.billboard.dispose();
            
            gfx.lodModels.splice(i, 1);
            
            if (!this._erasedAutoResources) this._erasedAutoResources = new Set();
            this._erasedAutoResources.add(`${tx},${tz}`);
            
            erased = true;
            break;
          }
        }
      }

      if (erased && this._resourceGridVisible) {
        this.showResourceGrid();
      }
    }
  };

  forge._placeResourceAtSingle = function(pos) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    if (!this._placedResources) this._placedResources = new Map();
    if (!this._placedKeys) this._placedKeys = new Set();
    if (!this._resourceFootprints) this._resourceFootprints = new Map();
    if (!this._modelCache) this._modelCache = new Map();
    
    const key = `${pos.x},${pos.y}`;

    const resourceType = this.resourceTypes[this.state.currentResource];
    if (!resourceType || !resourceType.path) return;

    const footprint = this.getResourceFootprint(pos, resourceType);
    const occupiedTiles = this.getOccupiedTiles();

    for (const tile of footprint) {
      if (tile.x < 0 || tile.x >= field.width || tile.y < 0 || tile.y >= field.height) return;
      const index = tile.y * field.width + tile.x;
      if (field.terrainTypes[index] === 1) return;
      const chunkX = Math.floor(tile.x / field.chunkSize);
      const chunkZ = Math.floor(tile.y / field.chunkSize);
      if (field.chunkMask && field.chunkMask.get(`${chunkX},${chunkZ}`) === false) return;
      const tileKey = `${tile.x},${tile.y}`;
      if (occupiedTiles.has(tileKey)) return;
    }
    
    const footprintKeys = footprint.map(t => `${t.x},${t.y}`);
    footprintKeys.forEach(k => this._placedKeys.add(k));
    this._resourceFootprints.set(key, footprintKeys);

    if (!this._placedResourceTypes) this._placedResourceTypes = new Map();
    this._placedResourceTypes.set(key, this.state.currentResource);
    this.recordChange({ kind: 'resource_add', data: { x: pos.x, y: pos.y, type: this.state.currentResource } });

    const worldX = (pos.x + 0.5) * TILE_SIZE;
    const worldZ = (pos.y + 0.5) * TILE_SIZE;
    const worldY = field.getHeightVariation ? field.getHeightVariation(pos.x, pos.y) : 0;
    
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
      
      this._placedResources.set(key, root);

      if (gfx.setupMeshShadows) {
        gfx.setupMeshShadows(root);
      }
      
      if (this._resourceGridVisible) {
        this.showResourceGrid();
      }
    });
  };

  // Set resource type for manual painting
  forge.setResource = function(type) {
    this.state.currentResource = type;
    
    document.querySelectorAll('.forge-btn').forEach(btn => {
      if (btn.id && btn.id.startsWith('res-')) {
        btn.classList.toggle('active', btn.id === `res-${type}`);
      }
    });
    
    console.log(`🌲 Resource: ${type}`);
  };

  // Populate resources on all chunks
  forge.populateResources = function() {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene || !gfx.placeDecorationsOnChunk) {
      console.log('❌ Cannot populate resources - missing dependencies');
      return;
    }
    
    this.clearResources();
    this._noAutoResources = false;
    
    console.log('🌲 Auto-populating resources (trees on grass, rocks on dirt)...');
    
    let grassCount = 0, dirtCount = 0;
    for (let i = 0; i < field.terrainTypes.length; i++) {
      if (field.terrainTypes[i] === 3) grassCount++;
      else if (field.terrainTypes[i] === 2) dirtCount++;
    }
    console.log(`   Terrain: ${grassCount} grass tiles, ${dirtCount} dirt tiles`);
    
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    
    for (let cx = 0; cx < chunksX; cx++) {
      for (let cz = 0; cz < chunksZ; cz++) {
        const key = `${cx},${cz}`;
        if (field.chunkMask && field.chunkMask.get(key) === false) continue;
        
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
    
    if (this._resourceGridVisible) {
      setTimeout(() => this.showResourceGrid(), 500);
      setTimeout(() => this.showResourceGrid(), 1500);
    }
  };

  // Clear all resources from the map
  forge.clearResources = function() {
    if (!confirm('Are you sure you want to clear ALL resources? This cannot be undone.')) {
      return;
    }

    const field = window.liveField;
    if (!field) return;

    console.log('🗑️ Clearing resources...');
    
    let cleared = 0;
    
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
      gfx.lodModels.length = 0;
    }
    
    for (const [key, chunk] of field.chunks) {
      if (chunk.models) {
        chunk.models = [];
      }
    }
    
    if (gfx.clearResourceRegistries) {
      gfx.clearResourceRegistries();
    }
    
    if (this._placedResources) {
      for (const [key, mesh] of this._placedResources) {
        if (mesh && mesh.dispose && !mesh.isDisposed()) {
          mesh.dispose();
          cleared++;
        }
      }
      this._placedResources = new Map();
    }

    this.hideBrushPreview();
    this.hideObjectivePreview();
    
    this._placedKeys = new Set();
    this._resourceFootprints = new Map();
    this._erasedAutoResources = new Set();
    this._noAutoResources = true;
    this._modelCache?.clear();

    if (this._resourceGridVisible) {
      this.showResourceGrid();
    }

    console.log(`✅ Cleared ${cleared} resources`);
  };

  // Resource grid overlay state
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

  forge.showResourceGrid = function() {
    this.hideResourceGrid();
    
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    if (this.state.editingLayer === 'buildings') {
      this.showBuildabilityGrid();
      return;
    }
    
    const occupiedTiles = this.getOccupiedTiles();
    
    console.log(`📍 Showing ${occupiedTiles.size} resource tiles`);
    
    const markerMat = new BABYLON.StandardMaterial('resourceMarkerMat', gfx.scene);
    markerMat.diffuseColor = new BABYLON.Color3(1, 0.5, 0);
    markerMat.emissiveColor = new BABYLON.Color3(0.5, 0.25, 0);
    markerMat.alpha = 0.6;
    markerMat.backFaceCulling = false;
    
    for (const key of occupiedTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (tx < 0 || tx >= field.width || tz < 0 || tz >= field.height) continue;
      
      const marker = BABYLON.MeshBuilder.CreatePlane(`resGrid_${key}`, {
        width: TILE_SIZE * 0.8,
        height: TILE_SIZE * 0.8
      }, gfx.scene);
      
      marker.position.x = (tx + 0.5) * TILE_SIZE;
      marker.position.y = 1.5;
      marker.position.z = (tz + 0.5) * TILE_SIZE;
      marker.rotation.x = Math.PI / 2;
      marker.material = markerMat;
      
      this._resourceGridOverlay.push(marker);
    }
    
    this._resourceGridMat = markerMat;
  };

  forge.showBuildabilityGrid = function() {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    
    const occupiedTiles = this.getOccupiedTiles();
    
    console.log(`📍 Showing ${occupiedTiles.size} occupied tiles (buildings + resources)`);
    
    const occupiedMat = new BABYLON.StandardMaterial('buildableOccupiedMat', gfx.scene);
    occupiedMat.diffuseColor = new BABYLON.Color3(1, 0.8, 0.2);
    occupiedMat.emissiveColor = new BABYLON.Color3(0.5, 0.4, 0.1);
    occupiedMat.alpha = 0.6;
    occupiedMat.backFaceCulling = false;
    
    for (const key of occupiedTiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (tx < 0 || tx >= field.width || tz < 0 || tz >= field.height) continue;
      
      const marker = BABYLON.MeshBuilder.CreatePlane(`buildGrid_${key}`, {
        width: TILE_SIZE * 0.8,
        height: TILE_SIZE * 0.8
      }, gfx.scene);
      
      marker.position.x = (tx + 0.5) * TILE_SIZE;
      marker.position.y = 1.5;
      marker.position.z = (tz + 0.5) * TILE_SIZE;
      marker.rotation.x = Math.PI / 2;
      marker.material = occupiedMat;
      
      this._resourceGridOverlay.push(marker);
    }
    
    this._resourceGridMat = occupiedMat;
  };

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

})(window.forge);
