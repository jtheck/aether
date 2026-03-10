// Forge Buildings Module
(function(forge) {
  'use strict';

  forge._buildingMeshes = new Map(); // key -> mesh
  forge._buildingGeneration = 0; // Incremented on every rebuild to cancel stale async loads
  forge._buildingPreview = null; // Preview mesh that follows cursor
  forge._previewMaterial = null; // Shared material for preview

  forge.setBuilding = function(buildingType) {
    this.state.currentBuilding = buildingType;

    // Update button states (all building buttons)
    if (window.BuildingTypes) {
      Object.keys(window.BuildingTypes).forEach(t => {
        const btn = document.getElementById(`bldg-${t}`);
        if (btn) btn.classList.toggle('active', t === buildingType);
      });
    }
    document.getElementById('bldg-eraser')?.classList.toggle('active', buildingType === 'eraser');

    // Create or update preview mesh
    if (buildingType !== 'eraser') {
      this.createBuildingPreview(buildingType);
    } else {
      this.clearBuildingPreview();
    }

    const buildingDef = window.BuildingTypes?.[buildingType];
    const buildingName = buildingDef?.name || buildingType;
    console.log(`🏗️ Building: ${buildingName}`);
  };

  forge.placeBuilding = function(pos) {
    const field = window.liveField;
    if (!field) return;

    // Get symmetric positions
    const positions = this.getSymmetricPositions(pos);

    // Debug: log symmetric positions
    if (positions.length > 1) {
      console.log(`🔄 Symmetry mode: ${this._currentSymmetry || 'none'}, placing at ${positions.length} positions:`, positions.map(p => `(${p.x},${p.y})`).join(', '));
    }

    // Handle eraser
    if (this.state.currentBuilding === 'eraser') {
      positions.forEach(p => this._removeBuildingAt(p));
      return;
    }

    // Place at all symmetric positions (will log if placement fails)
    this.beginAction('building', `Place ${this.state.currentBuilding}`);
    let successCount = 0;
    positions.forEach((p, i) => {
      if (this._placeBuildingAtSingle(p, i)) {
        const bld = this.state.buildings.find(b => b.x === p.x && b.y === p.y);
        if (bld) {
          this.recordChange({ kind: 'building_add', data: {...bld} });
        }
        successCount++;
      }
    });
    this.commitAction();

    if (successCount === 0) {
      console.log(`❌ Could not place ${this.state.currentBuilding} - check for overlaps or invalid terrain`);
    } else if (successCount > 0) {
      if (this._resourceGridVisible) {
        this.showResourceGrid();
      }
    }
  };

  forge._placeBuildingAtSingle = function(pos, rotationOffset = 0) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return false;

    const key = `${pos.x},${pos.y}`;
    const buildingType = this.state.currentBuilding;
    const buildingDef = window.BuildingTypes?.[buildingType];

    if (!buildingDef) {
      console.warn(`Unknown building type: ${buildingType}`);
      return false;
    }

    // CRITICAL: Check if we already have a building at this exact position
    // This prevents duplicate placements from symmetry/rapid clicking
    const existingAtPos = this.state.buildings.find(b => b.x === pos.x && b.y === pos.y);
    if (existingAtPos && existingAtPos.type === buildingType) {
      // Already placing/placed this exact building type here - skip duplicate
      console.log(`⚠️ Skipping duplicate placement of ${buildingType} at (${pos.x}, ${pos.y})`);
      return false;
    }

    // Get building size
    const width = buildingDef.size?.width || 1;
    const height = buildingDef.size?.height || 1;

    // Check all tiles in building footprint
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < height; dz++) {
        const checkX = pos.x + dx;
        const checkZ = pos.y + dz;

        // Bounds check
        if (checkX < 0 || checkX >= field.width || checkZ < 0 || checkZ >= field.height) {
          console.log(`❌ Building extends outside map bounds`);
          return false;
        }

        // Check chunk enabled
        const chunkX = Math.floor(checkX / field.chunkSize);
        const chunkZ = Math.floor(checkZ / field.chunkSize);
        if (!field.chunkMask.get(`${chunkX},${chunkZ}`)) {
          console.log(`❌ Building extends into disabled chunk`);
          return false;
        }

        // Check for water
        const index = checkZ * field.width + checkX;
        if (field.terrainTypes[index] === 1) {
          console.log(`❌ Building footprint includes water tile`);
          return false;
        }
      }
    }

    // Check for overlap with other buildings/resources (excluding the building we're replacing)
    const occupiedTiles = this.getOccupiedTiles();
    const existingBuildingIdx = this.state.buildings.findIndex(b => b.x === pos.x && b.y === pos.y);

    // If replacing existing building, temporarily remove it to check for overlaps
    let existingBuilding = null;
    if (existingBuildingIdx >= 0) {
      existingBuilding = this.state.buildings[existingBuildingIdx];
      this.state.buildings.splice(existingBuildingIdx, 1);
      // Recalculate occupied tiles without this building
      const newOccupied = this.getOccupiedTiles();
      occupiedTiles.clear();
      newOccupied.forEach(k => occupiedTiles.add(k));
    }

    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < height; dz++) {
        const checkKey = `${pos.x + dx},${pos.y + dz}`;
        if (occupiedTiles.has(checkKey)) {
          console.log(`❌ Building overlaps with existing building/resource at tile ${checkKey}`);
          // Restore existing building if we removed it
          if (existingBuilding) {
            this.state.buildings.splice(existingBuildingIdx, 0, existingBuilding);
          }
          return false;
        }
      }
    }

    // Remove existing building mesh at this position (state already handled above)
    if (this._buildingMeshes.has(key)) {
      this._buildingMeshes.get(key).dispose();
      this._buildingMeshes.delete(key);
    }

    // Add to state (we already removed old one if it existed)
    // Calculate deterministic rotation based on grid position (for variety)
    const mapSeed = field.seed || 12345;
    let rotHash = mapSeed + pos.x * 73856093 + pos.y * 19349663;
    rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
    rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
    rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
    const baseRotation = (rotHash % 628) / 100; // 0 to ~6.28 radians
    const rotation = baseRotation + (rotationOffset * Math.PI / 2); // Add symmetry rotation offset
    console.log(`🔄 Building rotation: base=${baseRotation.toFixed(2)} (${(baseRotation*180/Math.PI).toFixed(0)}°), final=${rotation.toFixed(2)} (${(rotation*180/Math.PI).toFixed(0)}°)`);
    this.state.buildings.push({ x: pos.x, y: pos.y, type: buildingType, rotation });

    // Update field's blocked tiles for pathfinding
    if (field.blockedTiles) {
      for (let dx = 0; dx < width; dx++) {
        for (let dz = 0; dz < height; dz++) {
          field.blockedTiles.add(`${pos.x + dx},${pos.y + dz}`);
        }
      }
    }

    // Load and place model
    // TILE_SIZE is defined in constants.js (which is loaded before forge.js)
    // Center building on tile (like resources do)
    const worldX = (pos.x + 0.5) * TILE_SIZE;
    const worldZ = (pos.y + 0.5) * TILE_SIZE;
    const terrainY = window.getTerrainHeightAtPosition?.(worldX, worldZ) || 0;

    if (!gfx.getModel) {
      console.error('❌ gfx.getModel is not available');
      return false;
    }

    if (typeof Vec3 === 'undefined') {
      console.error('❌ Vec3 is not defined - check if BABYLON is loaded');
      return false;
    }

    const gen = this._buildingGeneration;
    gfx.getModel(buildingDef.model, gfx.scene).then(model => {
      const root = model.root;

      // Stale load — buildings were rebuilt/cleared while this was loading
      if (gen !== this._buildingGeneration) {
        root.dispose();
        return;
      }

      root.position = new Vec3(worldX, terrainY, worldZ);
      root.scaling = new Vec3(buildingDef.scale, buildingDef.scale, buildingDef.scale);
      root.rotationQuaternion = null;
      const stateEntry = this.state.buildings.find(b => b.x === pos.x && b.y === pos.y);
      const finalRotation = stateEntry ? stateEntry.rotation : rotation;
      root.rotation.y = finalRotation;
      root.setEnabled(true);
      root.getDescendants().forEach(node => { if (node.setEnabled) node.setEnabled(true); });
      root.getChildMeshes().forEach(mesh => {
        if (mesh.setEnabled) mesh.setEnabled(true);
        mesh.isVisible = true;
        mesh.visibility = 1.0;
      });
      root.metadata = root.metadata || {};
      root.metadata.isEditorBuilding = true;
      root.metadata.buildingKey = key;
      root.isPickable = true;
      root.getChildMeshes().forEach(m => { m.isPickable = true; });

      this._buildingMeshes.set(key, root);
      this.updateBuildingList();
    }).catch(error => {
      console.error(`❌ Failed to load building model ${buildingDef.model}:`, error);
    });

    console.log(`🏗️ Placed ${buildingType} at (${pos.x}, ${pos.y})`);
    return true; // Successfully placed
  };

  // Create building preview mesh (ghost that follows cursor)
  forge.createBuildingPreview = function(buildingType) {
    // Clear existing preview
    this.clearBuildingPreview();

    const buildingDef = window.BuildingTypes?.[buildingType];
    if (!buildingDef || !gfx || !gfx.scene) return;

    // Load the model
    gfx.getModel(buildingDef.model, gfx.scene).then(model => {
      this._buildingPreview = model.root;

      // Enable preview
      this._buildingPreview.setEnabled(true);
      this._buildingPreview.getDescendants().forEach(n => {
        if (n.setEnabled) n.setEnabled(true);
      });

      // Mark as preview so it doesn't get culled by LOD
      this._buildingPreview.metadata = this._buildingPreview.metadata || {};
      this._buildingPreview.metadata.isPreview = true;
      this._buildingPreview.metadata.isForgeBuildingPreview = true;

      // Apply scale
      this._buildingPreview.scaling = new Vec3(buildingDef.scale, buildingDef.scale, buildingDef.scale);

      // Create green semi-transparent material
      if (!this._previewMaterial) {
        this._previewMaterial = new BABYLON.StandardMaterial('forgePreviewMat', gfx.scene);
        this._previewMaterial.backFaceCulling = false;
      }
      this._previewMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0); // Green
      this._previewMaterial.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
      this._previewMaterial.alpha = 0.5;

      // Apply material to all child meshes
      this._buildingPreview.getChildMeshes().forEach(mesh => {
        mesh.material = this._previewMaterial;
        mesh.isPickable = false;
      });
      this._buildingPreview.isPickable = false;

      // Position at origin initially
      this._buildingPreview.position = new Vec3(0, -100, 0); // Start off-screen

      console.log(`👻 Building preview created for ${buildingType}`);
    }).catch(error => {
      console.error(`❌ Failed to create building preview:`, error);
    });
  };

  forge.hideBuildingPreview = function() {
    if (!this._buildingPreview) return;
    this._buildingPreview.setEnabled(false);
  };

  forge.showBuildingPreview = function() {
    if (this._buildingPreview) this._buildingPreview.setEnabled(true);
  };

  // Update building preview position and validity
  forge.updateBuildingPreview = function(e) {
    if (!this._buildingPreview || !gfx || !gfx.scene) return;
    this._buildingPreview.setEnabled(true);

    const pos = this.getTilePosition(e);
    if (!pos) {
      // Hide preview if not over terrain
      this._buildingPreview.position.y = -100;
      return;
    }

    // Snap to grid center
    const worldX = (pos.x + 0.5) * TILE_SIZE;
    const worldZ = (pos.y + 0.5) * TILE_SIZE;
    const terrainY = window.getTerrainHeightAtPosition?.(worldX, worldZ) || 0;

    this._buildingPreview.position.x = worldX;
    this._buildingPreview.position.y = terrainY + 0.5; // Slightly above terrain
    this._buildingPreview.position.z = worldZ;

    // Calculate deterministic rotation for this position (same as placement logic)
    const field = window.liveField;
    const mapSeed = field?.seed || 12345;
    let rotHash = mapSeed + pos.x * 73856093 + pos.y * 19349663;
    rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
    rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
    rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
    const rotation = (rotHash % 628) / 100; // 0 to ~6.28 radians

    // CRITICAL: Clear rotationQuaternion so rotation.y works
    this._buildingPreview.rotationQuaternion = null;
    this._buildingPreview.rotation.y = rotation;
    // Only log occasionally to avoid spam
    if (Math.random() < 0.05) {
      console.log(`👻 Preview rotation at (${pos.x},${pos.y}): ${rotation.toFixed(2)} (${(rotation*180/Math.PI).toFixed(0)}°)`);
    }

    // Check validity
    const isValid = this.isValidBuildingPosition(pos);

    // Update color based on validity
    if (this._previewMaterial) {
      if (isValid) {
        this._previewMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0); // Green
        this._previewMaterial.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
      } else {
        this._previewMaterial.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red
        this._previewMaterial.emissiveColor = new BABYLON.Color3(0.3, 0, 0);
      }
    }
  };

  // Check if position is valid for building placement
  forge.isValidBuildingPosition = function(pos) {
    const field = window.liveField;
    if (!field) return false;

    const buildingDef = window.BuildingTypes?.[this.state.currentBuilding];
    if (!buildingDef) return false;

    const width = buildingDef.size?.width || 1;
    const height = buildingDef.size?.height || 1;

    // Check all tiles in footprint
    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < height; dz++) {
        const checkX = pos.x + dx;
        const checkZ = pos.y + dz;

        // Bounds check
        if (checkX < 0 || checkX >= field.width || checkZ < 0 || checkZ >= field.height) {
          return false;
        }

        // Check chunk enabled
        const chunkX = Math.floor(checkX / field.chunkSize);
        const chunkZ = Math.floor(checkZ / field.chunkSize);
        if (!field.chunkMask.get(`${chunkX},${chunkZ}`)) {
          return false;
        }

        // Check for water
        const index = checkZ * field.width + checkX;
        if (field.terrainTypes[index] === 1) {
          return false;
        }
      }
    }

    // Check for overlaps with existing buildings/resources
    // Get occupied tiles WITHOUT modifying state
    const occupiedTiles = this.getOccupiedTiles();

    for (let dx = 0; dx < width; dx++) {
      for (let dz = 0; dz < height; dz++) {
        const checkKey = `${pos.x + dx},${pos.y + dz}`;
        if (occupiedTiles.has(checkKey)) {
          // It's occupied - but check if it's the SAME building at the EXACT same position
          const existingBuilding = this.state.buildings.find(b => b.x === pos.x && b.y === pos.y);
          if (!existingBuilding) {
            // Occupied by something else
            return false;
          }
          // If there IS a building here already, only valid if ALL our footprint tiles
          // belong to that same building
          const existingDef = window.BuildingTypes?.[existingBuilding.type];
          if (existingDef) {
            const exWidth = existingDef.size?.width || 1;
            const exHeight = existingDef.size?.height || 1;
            const exKey = `${existingBuilding.x + dx},${existingBuilding.y + dz}`;
            if (exKey !== checkKey) {
              // This occupied tile doesn't belong to the building we're replacing
              return false;
            }
          }
        }
      }
    }

    return true;
  };

  // Clear building preview
  forge.clearBuildingPreview = function() {
    if (this._buildingPreview) {
      this._buildingPreview.dispose();
      this._buildingPreview = null;
    }
  };

  forge._removeBuildingAt = function(pos) {
    const field = window.liveField;
    const key = `${pos.x},${pos.y}`;

    this.beginAction('building_remove', 'Remove building');

    // Check nearby positions too (buildings can be multi-tile)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const checkKey = `${pos.x + dx},${pos.y + dy}`;
        if (this._buildingMeshes.has(checkKey)) {
          // Record building data before removing
          const idx = this.state.buildings.findIndex(b => `${b.x},${b.y}` === checkKey);
          if (idx >= 0) {
            this.recordChange({ kind: 'building_remove', data: {...this.state.buildings[idx]} });
          }

          this._buildingMeshes.get(checkKey).dispose();
          this._buildingMeshes.delete(checkKey);

          if (idx >= 0) {
            const building = this.state.buildings[idx];
            const buildingDef = window.BuildingTypes?.[building.type];

            if (field && field.blockedTiles && buildingDef) {
              const w = buildingDef.size?.width || 1;
              const h = buildingDef.size?.height || 1;
              for (let bx = 0; bx < w; bx++) {
                for (let bz = 0; bz < h; bz++) {
                  field.blockedTiles.delete(`${building.x + bx},${building.y + bz}`);
                }
              }
            }

            this.state.buildings.splice(idx, 1);
          }
        }
      }
    }

    this.commitAction();
    this.updateBuildingList();
  };

  // Remove all building meshes from the scene (tracked + any orphaned). Does not clear state.
  forge.disposeAllBuildingMeshesFromScene = function() {
    // Invalidate any in-flight async model loads from _placeBuildingAtSingle
    this._buildingGeneration++;

    this._buildingMeshes.forEach(mesh => {
      if (mesh && typeof mesh.dispose === 'function') mesh.dispose();
    });
    this._buildingMeshes.clear();

    // Scan scene for any orphaned editor building nodes (async loads that finished before we bumped generation)
    if (gfx && gfx.scene) {
      const toDispose = [];
      for (const node of gfx.scene.rootNodes) {
        if (node.metadata && (node.metadata.isEditorBuilding || node.metadata.buildingKey)) {
          toDispose.push(node);
        }
      }
      toDispose.forEach(n => {
        if (n && typeof n.dispose === 'function') n.dispose();
      });
    }
  };

  forge.clearBuildings = function() {
    if (!confirm('Are you sure you want to clear ALL buildings? This cannot be undone.')) {
      return;
    }

    const field = window.liveField;

    // Remove blocked tiles for all buildings
    if (field && field.blockedTiles) {
      this.state.buildings.forEach(building => {
        const buildingDef = window.BuildingTypes?.[building.type];
        if (buildingDef) {
          const w = buildingDef.size?.width || 1;
          const h = buildingDef.size?.height || 1;
          for (let dx = 0; dx < w; dx++) {
            for (let dz = 0; dz < h; dz++) {
              field.blockedTiles.delete(`${building.x + dx},${building.y + dz}`);
            }
          }
        }
      });
    }

    this.disposeAllBuildingMeshesFromScene();
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
        const buildingDef = window.BuildingTypes?.[type];
        const icon = this.getBuildingIcon(type, buildingDef || {});
        const name = buildingDef?.name || type;
        return `${icon} ${name}: ${count}`;
      }).join('<br>');
  };

  forge.updateBuildingMarkers = function() {
    // Dispose ALL editor building meshes (also bumps generation to cancel stale async loads)
    this.disposeAllBuildingMeshesFromScene();
    const gen = this._buildingGeneration;
    // Dispose selection ring if present
    this._disposeSelectionRing();

    const selectedIdx = window.forge.state.selectedItemForMove?.type === 'building'
      && window.forge.state.moveMode.buildings
      ? window.forge.state.selectedItemForMove.index : -1;

    // Rebuild from state
    this.state.buildings.forEach((b, i) => {
      const buildingDef = window.BuildingTypes?.[b.type];
      if (!buildingDef) return;

      const worldX = (b.x + 0.5) * TILE_SIZE;
      const worldZ = (b.y + 0.5) * TILE_SIZE;
      const terrainY = window.getTerrainHeightAtPosition?.(worldX, worldZ) || 0;
      const key = `${b.x},${b.y}`;
      const isSelected = (i === selectedIdx);

      gfx.getModel(buildingDef.model, gfx.scene).then(model => {
        const root = model.root;

        // Stale load — buildings were rebuilt/cleared while this was loading
        if (gen !== this._buildingGeneration) {
          root.dispose();
          return;
        }

        root.position = new BABYLON.Vector3(worldX, terrainY, worldZ);
        root.scaling = new BABYLON.Vector3(buildingDef.scale, buildingDef.scale, buildingDef.scale);
        root.rotationQuaternion = null;
        root.rotation.y = b.rotation || 0;
        root.setEnabled(true);

        root.metadata = root.metadata || {};
        root.metadata.isEditorBuilding = true;
        root.metadata.buildingKey = key;
        root.isPickable = true;
        root.getChildMeshes().forEach(m => { m.isPickable = true; });

        this._buildingMeshes.set(key, root);

        if (isSelected) {
          this._createSelectionRing(worldX, worldZ, terrainY, buildingDef.size?.width || 2);
        }
      });
    });

    this.updateBuildingList();
  };

  // Selection ring for move mode
  forge._selectionRing = null;
  forge._selectionRingAnim = null;

  forge._createSelectionRing = function(x, z, y, size) {
    this._disposeSelectionRing();
    if (!gfx || !gfx.scene) return;

    const diameter = Math.max(size + 2, 3) * TILE_SIZE;
    const ring = BABYLON.MeshBuilder.CreateTorus('forgeSelRing', {
      diameter: diameter,
      thickness: 0.3,
      tessellation: 32
    }, gfx.scene);
    ring.position = new BABYLON.Vector3(x, y + 0.5, z);
    ring.isPickable = false;

    const mat = new BABYLON.StandardMaterial('forgeSelRingMat', gfx.scene);
    mat.diffuseColor = new BABYLON.Color3(1, 0.85, 0.1);
    mat.emissiveColor = new BABYLON.Color3(1, 0.7, 0);
    mat.alpha = 0.9;
    mat.backFaceCulling = false;
    ring.material = mat;

    // Pulse animation
    const anim = new BABYLON.Animation('selPulse', 'material.alpha', 30,
      BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
    anim.setKeys([
      { frame: 0, value: 0.9 },
      { frame: 15, value: 0.4 },
      { frame: 30, value: 0.9 }
    ]);
    ring.animations = [anim];
    gfx.scene.beginAnimation(ring, 0, 30, true);

    this._selectionRing = ring;
  };

  forge._disposeSelectionRing = function() {
    if (this._selectionRing) {
      gfx.scene.stopAnimation(this._selectionRing);
      this._selectionRing.dispose();
      this._selectionRing = null;
    }
  };

  // Move functions for buildings
  forge.selectBuildingForMove = function(pos) {
    const index = this.state.buildings.findIndex(b =>
      Math.abs(b.x - pos.x) <= 2 && Math.abs(b.y - pos.y) <= 2
    );
    if (index !== -1) {
      window.forge.state.selectedItemForMove = { type: 'building', index: index };
      this.updateBuildingMarkers(); // Highlight selected building
    }
  };

  forge.moveBuilding = function(index, newPos) {
    const field = window.liveField;
    if (index < 0 || index >= this.state.buildings.length || !field) return;

    const b = this.state.buildings[index];
    const buildingDef = window.BuildingTypes?.[b.type];
    if (!buildingDef) return;

    const w = buildingDef.size?.width || 1;
    const h = buildingDef.size?.height || 1;

    // Clear blocked tiles at old position
    if (field.blockedTiles) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < h; dz++) {
          field.blockedTiles.delete(`${b.x + dx},${b.y + dz}`);
        }
      }
    }

    // Update state in-place (no splice — keeps indices stable)
    b.x = newPos.x;
    b.y = newPos.y;

    // Block tiles at new position
    if (field.blockedTiles) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < h; dz++) {
          field.blockedTiles.add(`${newPos.x + dx},${newPos.y + dz}`);
        }
      }
    }

    // Full rebuild disposes ALL scene building meshes and recreates from state
    this.updateBuildingMarkers();
  };

})(window.forge);
