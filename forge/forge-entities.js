// Forge Entities Module - Spawns, Objectives, Starting Units
(function(forge) {
  'use strict';

  // Move functions for objectives
  forge.selectObjectiveForMove = function(pos) {
    const index = this.state.objectives.findIndex(o =>
      Math.abs(o.x - pos.x) <= o.radius + 2 &&
      Math.abs(o.y - pos.y) <= o.radius + 2
    );
    if (index !== -1) {
      window.forge.state.selectedItemForMove = { type: 'objective', index: index };
      this.updateObjectiveMarkers(); // Highlight selected objective
    }
  };

  forge.moveObjective = function(index, newPos) {
    if (index >= 0 && index < this.state.objectives.length) {
      this.state.objectives[index].x = newPos.x;
      this.state.objectives[index].y = newPos.y;
      this.updateObjectiveMarkers();
      this.updateObjectiveList();
    }
  };

  // Move functions for units
  forge.selectStartingUnitForMove = function(pos) {
    const index = this.state.startingUnits.findIndex(u =>
      Math.abs(u.x - pos.x) <= 1 && Math.abs(u.y - pos.y) <= 1
    );
    if (index !== -1) {
      window.forge.state.selectedItemForMove = { type: 'unit', index: index };
      this.updateUnitMarkers(); // Highlight selected unit
    }
  };

  forge.moveStartingUnit = function(index, newPos) {
    if (index >= 0 && index < this.state.startingUnits.length) {
      this.state.startingUnits[index].x = newPos.x;
      this.state.startingUnits[index].y = newPos.y;
      this.updateUnitMarkers();
      this.updateStartingUnitsList();
    }
  };

  // Show objective radius preview overlay
  forge.showObjectivePreview = function() {
    const scene = gfx?.scene;
    if (!scene) return;

    this.hideObjectivePreview(); // Remove old overlay

    const radius = this.state.currentObjectiveRadius;
    if (radius <= 0) return;

    // Create a semi-transparent circle to show objective radius
    const circle = BABYLON.MeshBuilder.CreateCylinder(
      'objective-preview',
      {
        diameter: radius * 2 * TILE_SIZE,
        height: 0.1,
        tessellation: 32
      },
      scene
    );

    // Position at ground level
    circle.position.y = 0.05;

    // Make it follow the mouse
    this._objectivePreviewOverlay = circle;

    // Material - green semi-transparent
    const mat = new BABYLON.StandardMaterial('objective-preview-mat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.2, 1, 0.4);
    mat.emissiveColor = new BABYLON.Color3(0.1, 0.5, 0.2);
    mat.alpha = 0.3;
    circle.material = mat;

    this._objectivePreviewVisible = true;
  };

  forge.hideObjectivePreview = function() {
    if (this._objectivePreviewOverlay) {
      this._objectivePreviewOverlay.dispose();
      this._objectivePreviewOverlay = null;
    }
    this._objectivePreviewVisible = false;
  };

  forge.updateObjectivePreview = function(mousePos) {
    if (this._objectivePreviewOverlay && mousePos) {
      const worldX = mousePos.x * TILE_SIZE + 0.5 * TILE_SIZE;
      const worldZ = mousePos.y * TILE_SIZE + 0.5 * TILE_SIZE;
      this._objectivePreviewOverlay.position.x = worldX;
      this._objectivePreviewOverlay.position.z = worldZ;
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

    this.beginAction('spawn', 'Place spawn');

    // Snapshot terrain before flattening so tile changes are captured
    const radius = this.spawnZoneRadius;
    const positions = this.getSymmetricPositions(pos);

    // Snapshot all tiles that might be affected by flattening
    const beforeTiles = new Map();
    for (const p of positions) {
      for (let dx = -radius - 2; dx <= radius + 2; dx++) {
        for (let dy = -radius - 2; dy <= radius + 2; dy++) {
          const x = p.x + dx, y = p.y + dy;
          if (x < 0 || x >= field.width || y < 0 || y >= field.height) continue;
          const index = y * field.width + x;
          if (!beforeTiles.has(index)) {
            const tile = field.tiles[index];
            beforeTiles.set(index, {
              terrainType: field.terrainTypes[index],
              tileType: tile ? tile.type : 0,
              atlasName: tile ? tile.atlasName : 'atlas-grass-dirt'
            });
          }
        }
      }
    }

    positions.forEach((p, i) => {
      const existing = this.state.spawnPoints.findIndex(s =>
        Math.abs(s.x - p.x) <= 2 && Math.abs(s.y - p.y) <= 2
      );

      if (existing >= 0) {
        this.state.spawnPoints[existing].x = p.x;
        this.state.spawnPoints[existing].y = p.y;
      } else {
        const spawnIndex = this.state.spawnPoints.length;
        const spawnData = { x: p.x, y: p.y, team: spawnIndex };
        this.state.spawnPoints.push(spawnData);
        this.recordChange({ kind: 'spawn_add', data: {...spawnData} });
      }

      this.flattenTerrainAtSpawn(p.x, p.y);
    });

    // Record terrain tile changes from flattening
    for (const [index, before] of beforeTiles) {
      const tile = field.tiles[index];
      const afterTT = field.terrainTypes[index];
      const afterType = tile ? tile.type : 0;
      const afterAtlas = tile ? tile.atlasName : 'atlas-grass-dirt';
      if (before.terrainType !== afterTT || before.tileType !== afterType || before.atlasName !== afterAtlas) {
        this.recordChange({
          kind: 'tile', index,
          oldTerrainType: before.terrainType, newTerrainType: afterTT,
          oldTileType: before.tileType, newTileType: afterType,
          oldAtlasName: before.atlasName, newAtlasName: afterAtlas
        });
      }
    }

    this.commitAction();
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
    const positions = this.getSymmetricPositions(pos);
    let removed = 0;

    this.beginAction('spawn_remove', 'Remove spawn');

    positions.forEach(p => {
      const index = this.state.spawnPoints.findIndex(s =>
        Math.abs(s.x - p.x) <= 1 && Math.abs(s.y - p.y) <= 1
      );
      if (index >= 0) {
        this.recordChange({ kind: 'spawn_remove', data: {...this.state.spawnPoints[index]} });
        this.state.spawnPoints.splice(index, 1);
        removed++;
      }
    });

    this.commitAction();

    if (removed > 0) {
      this.updateSpawnMarkers();
      this.updateSpawnList();
      console.log(`🚩 Removed ${removed} spawn(s)`);
    }
  };

  // Clear all spawn points
  forge.clearSpawns = function() {
    if (!confirm('Are you sure you want to clear ALL spawn points? This cannot be undone.')) {
      return;
    }

    this.state.spawnPoints = [];
    this.updateSpawnMarkers();
    this.updateSpawnList();
    console.log('🚩 All spawns cleared');
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
      // Center spawn marker on tile (like resources and buildings)
      const worldX = (spawn.x + 0.5) * TILE_SIZE;
      const worldZ = (spawn.y + 0.5) * TILE_SIZE;

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

  // ========== OBJECTIVE ZONE MANAGEMENT ==========
  // Objectives are zones that players must reach to win in Adventure mode

  forge._objectiveMarkers = [];

  // Set objective type
  forge.setObjectiveType = function(type) {
    this.state.currentObjectiveType = type;

    // Update button states
    document.getElementById('obj-reach')?.classList.toggle('active', type === 'reach');
    document.getElementById('obj-escape')?.classList.toggle('active', type === 'escape');

    console.log(`🎯 Objective type: ${type}`);
  };

  // Set objective radius
  forge.setObjectiveRadius = function(radius) {
    this.state.currentObjectiveRadius = parseInt(radius, 10);
    document.getElementById('obj-radius-display').textContent = radius;

    // Update objective preview if visible
    if (this._objectivePreviewVisible) {
      this.showObjectivePreview();
    }

    console.log(`🎯 Objective radius: ${radius}`);
  };

  // Place an objective zone at position
  forge.placeObjective = function(pos) {
    const field = window.liveField;
    if (!field) return;

    const existing = this.state.objectives.findIndex(o =>
      Math.abs(o.x - pos.x) <= this.state.currentObjectiveRadius &&
      Math.abs(o.y - pos.y) <= this.state.currentObjectiveRadius
    );

    if (existing >= 0) {
      console.log('🎯 Objective already exists at this location');
      return;
    }

    const messageInput = document.getElementById('obj-message');
    const message = messageInput ? messageInput.value.trim() : '';

    const objective = {
      x: pos.x,
      y: pos.y,
      radius: this.state.currentObjectiveRadius,
      type: this.state.currentObjectiveType,
      message: message,
      id: this.state.objectives.length
    };

    this.beginAction('objective', 'Place objective');
    this.recordChange({ kind: 'objective_add', data: {...objective} });
    this.state.objectives.push(objective);
    this.commitAction();

    this.updateObjectiveMarkers();
    this.updateObjectiveList();

    if (messageInput) messageInput.value = '';

    console.log(`🎯 Placed ${objective.type} objective at (${pos.x}, ${pos.y}) radius ${objective.radius}${message ? ` with message` : ''}`);
  };

  // Remove objective at position
  forge.removeObjective = function(pos) {
    const index = this.state.objectives.findIndex(o =>
      Math.abs(o.x - pos.x) <= o.radius + 2 &&
      Math.abs(o.y - pos.y) <= o.radius + 2
    );

    if (index >= 0) {
      this.beginAction('objective_remove', 'Remove objective');
      this.recordChange({ kind: 'objective_remove', data: {...this.state.objectives[index]} });
      this.state.objectives.splice(index, 1);
      this.state.objectives.forEach((o, i) => o.id = i);
      this.commitAction();
      this.updateObjectiveMarkers();
      this.updateObjectiveList();
      console.log('🎯 Removed objective');
    }
  };

  // Clear all objectives
  forge.clearObjectives = function() {
    if (!confirm('Are you sure you want to clear ALL objectives? This cannot be undone.')) {
      return;
    }

    this.state.objectives = [];
    this.state.selectedObjectiveIndex = -1;
    this.updateObjectiveMarkers();
    this.updateObjectiveList();
    this.clearObjectiveForm();
    console.log('🎯 All objectives cleared');
  };

  // Select objective for editing
  forge.selectObjective = function(index) {
    if (index < 0 || index >= this.state.objectives.length) return;

    this.state.selectedObjectiveIndex = index;
    const obj = this.state.objectives[index];

    // Populate form with objective data
    document.getElementById('obj-reach').classList.toggle('active', obj.type === 'reach');
    document.getElementById('obj-escape').classList.toggle('active', obj.type === 'escape');
    document.getElementById('obj-radius').value = obj.radius;
    document.getElementById('obj-radius-display').textContent = obj.radius;
    document.getElementById('obj-message').value = obj.message || '';

    this.updateObjectiveList();
    console.log(`🎯 Selected objective ${index + 1} for editing`);
  };

  // Save changes to selected objective
  forge.saveObjectiveChanges = function() {
    if (this.state.selectedObjectiveIndex === -1) return;

    const obj = this.state.objectives[this.state.selectedObjectiveIndex];
    const typeRadios = document.querySelectorAll('input[name="obj-type"]:checked');
    const newType = typeRadios.length > 0 ? typeRadios[0].value : obj.type;

    obj.type = document.getElementById('obj-reach').classList.contains('active') ? 'reach' : 'escape';
    obj.radius = parseInt(document.getElementById('obj-radius').value);
    obj.message = document.getElementById('obj-message').value.trim();

    this.updateObjectiveMarkers();
    this.updateObjectiveList();
    console.log(`🎯 Updated objective ${this.state.selectedObjectiveIndex + 1}`);
  };

  // Cancel objective editing
  forge.cancelObjectiveEdit = function() {
    this.state.selectedObjectiveIndex = -1;
    this.updateObjectiveList();
    this.clearObjectiveForm();
    console.log('🎯 Cancelled objective editing');
  };

  // Clear objective form
  forge.clearObjectiveForm = function() {
    document.getElementById('obj-reach').classList.add('active');
    document.getElementById('obj-escape').classList.remove('active');
    document.getElementById('obj-radius').value = '4';
    document.getElementById('obj-radius-display').textContent = '4';
    document.getElementById('obj-message').value = '';
  };

  // Update objective markers visualization
  forge.updateObjectiveMarkers = function() {
    const scene = gfx?.scene;
    if (!scene) return;

    // Only show markers if objective view is enabled
    if (!this._objectiveViewVisible) {
      // Remove old markers if they exist
      if (this._objectiveMarkers) {
        this._objectiveMarkers.forEach(m => m.dispose());
      }
      this._objectiveMarkers = [];
      return;
    }

    // Remove old markers
    if (this._objectiveMarkers) {
      this._objectiveMarkers.forEach(m => m.dispose());
    }
    this._objectiveMarkers = [];

    // TILE_SIZE is defined in constants.js (loaded before forge.js)

    // Create markers for each objective
    this.state.objectives.forEach((obj, i) => {
      // Create a cylinder to represent the zone
      const cylinder = BABYLON.MeshBuilder.CreateCylinder(
        `objective_${i}`,
        {
          diameter: obj.radius * 2 * TILE_SIZE,
          height: 0.5,
          tessellation: 32
        },
        scene
      );

      // Position at world coordinates
      const worldX = obj.x * TILE_SIZE + 0.5 * TILE_SIZE;
      const worldZ = obj.y * TILE_SIZE + 0.5 * TILE_SIZE;
      cylinder.position = new BABYLON.Vector3(worldX, 1, worldZ);

      // Material - green for reach, blue for escape
      const mat = new BABYLON.StandardMaterial(`objective_mat_${i}`, scene);
      const isSelected = window.forge.state.selectedItemForMove?.type === 'objective' && window.forge.state.selectedItemForMove?.index === i && window.forge.state.moveMode.objectives;

      if (obj.type === 'escape') {
        mat.diffuseColor = isSelected
          ? new BABYLON.Color3(1, 0.8, 0.2)  // Orange for selected escape
          : new BABYLON.Color3(0.2, 0.4, 1); // Blue for normal escape
        mat.emissiveColor = isSelected
          ? new BABYLON.Color3(0.5, 0.4, 0.1)
          : new BABYLON.Color3(0.1, 0.2, 0.5);
      } else {
        mat.diffuseColor = isSelected
          ? new BABYLON.Color3(1, 0.8, 0.2)  // Orange for selected reach
          : new BABYLON.Color3(0.2, 1, 0.4); // Green for normal reach
        mat.emissiveColor = isSelected
          ? new BABYLON.Color3(0.5, 0.4, 0.1)
          : new BABYLON.Color3(0.1, 0.5, 0.2);
      }
      mat.alpha = isSelected ? 0.8 : 0.5;
      cylinder.material = mat;

      // Add a flag/pole in the center
      const pole = BABYLON.MeshBuilder.CreateCylinder(
        `objective_pole_${i}`,
        { diameter: 0.2, height: 3, tessellation: 8 },
        scene
      );
      pole.position = new BABYLON.Vector3(worldX, 1.5, worldZ);
      const poleMat = new BABYLON.StandardMaterial(`pole_mat_${i}`, scene);
      poleMat.diffuseColor = new BABYLON.Color3(0.4, 0.3, 0.2);
      pole.material = poleMat;

      // Add a flag
      const flag = BABYLON.MeshBuilder.CreatePlane(
        `objective_flag_${i}`,
        { width: 1.5, height: 1 },
        scene
      );
      flag.position = new BABYLON.Vector3(worldX + 0.75, 2.5, worldZ);
      const flagMat = new BABYLON.StandardMaterial(`flag_mat_${i}`, scene);
      flagMat.diffuseColor = obj.type === 'escape'
        ? new BABYLON.Color3(0.3, 0.5, 1)
        : new BABYLON.Color3(0.3, 1, 0.5);
      flagMat.emissiveColor = flagMat.diffuseColor.scale(0.5);
      flagMat.backFaceCulling = false;
      flag.material = flagMat;

      this._objectiveMarkers.push(cylinder, pole, flag);
    });
  };

  // Update objective list in UI
  forge.updateObjectiveList = function() {
    const list = document.getElementById('objective-list');
    const editControls = document.getElementById('objective-edit-controls');
    if (!list) return;

    // Show/hide edit controls
    if (editControls) {
      editControls.style.display = this.state.selectedObjectiveIndex >= 0 ? 'block' : 'none';
    }

    if (this.state.objectives.length === 0) {
      list.innerHTML = '<span style="opacity:0.5;">No objectives</span>';
      return;
    }

    list.innerHTML = this.state.objectives.map((obj, i) => {
      const icon = obj.type === 'escape' ? '🚪' : '🏁';
      const msgPreview = obj.message ? ` 💬 "${obj.message.substring(0, 20)}${obj.message.length > 20 ? '...' : ''}"` : '';
      const isSelected = this.state.selectedObjectiveIndex === i;
      const bgColor = isSelected ? 'rgba(76, 175, 80, 0.3)' : 'rgba(0,0,0,0.2)';
      const borderStyle = isSelected ? 'border: 2px solid #4CAF50;' : '';

      return `<div style="margin-bottom:4px;padding:4px;${borderStyle}background:${bgColor};border-radius:3px;cursor:pointer;" onclick="forge.selectObjective(${i})">
        <div>${icon} <b>${i + 1}</b>: (${obj.x}, ${obj.y}) r=${obj.radius}</div>
        ${msgPreview ? `<div style="font-size:10px;opacity:0.7;margin-top:2px;">${msgPreview}</div>` : ''}
      </div>`;
    }).join('');
  };

  // ========== STARTING UNITS MANAGEMENT ==========
  // For adventure mode: place starting units instead of Agora spawns

  forge._unitMarkers = [];

  // Player colors for unit markers
  forge.playerColors = [
    new BABYLON.Color3(0.3, 0.5, 1.0),   // P1: Blue
    new BABYLON.Color3(1.0, 0.3, 0.3),   // P2: Red
    new BABYLON.Color3(0.3, 1.0, 0.4),   // P3: Green
    new BABYLON.Color3(1.0, 0.9, 0.2)    // P4: Yellow
  ];

  forge.playerEmoji = ['🔵', '🔴', '🟢', '🟡'];

  // Set current unit player
  forge.setUnitPlayer = function(player) {
    this.state.currentUnitPlayer = player;

    // Update button states
    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById(`unit-player-${i}`);
      if (btn) btn.classList.toggle('active', i === player);
    }

    console.log(`👤 Unit player: P${player + 1}`);
  };

  // Set current unit type
  forge.setUnitType = function(unitType) {
    this.state.currentUnitType = unitType;

    // Update button states
    if (window.UnitTypes) {
      Object.keys(window.UnitTypes).forEach(t => {
        const btn = document.getElementById(`unit-type-${t}`);
        if (btn) btn.classList.toggle('active', t === unitType);
      });
    }

    const unitDef = window.UnitTypes?.[unitType];
    console.log(`⚔️ Unit type: ${unitDef?.name || unitType}`);
  };

  // Generate unit type buttons
  forge.generateUnitTypeButtons = function() {
    const container = document.getElementById('unit-type-buttons');
    if (!container || !window.UnitTypes) return;

    // Group units by category for easier selection
    const unitsByCategory = {};

    Object.entries(window.UnitTypes).forEach(([key, unit]) => {
      const category = unit.category || 'other';
      if (!unitsByCategory[category]) {
        unitsByCategory[category] = [];
      }
      unitsByCategory[category].push({ key, unit });
    });

    // Only show placeable units (exclude upgrades and special units)
    const placeableCategories = ['civilian', 'worker', 'support', 'caster', 'military', 'vehicle', 'air'];

    let html = '';
    placeableCategories.forEach(category => {
      if (!unitsByCategory[category]) return;

      unitsByCategory[category].forEach(({ key, unit }) => {
        // Skip upgrade-only units
        if (unit.upgradeFrom) return;

        const isActive = key === this.state.currentUnitType ? 'active' : '';
        const icon = this.getUnitIcon(key);
        html += `<button id="unit-type-${key}" class="forge-btn ${isActive}" onclick="forge.setUnitType('${key}')" style="min-width:80px;">${icon} ${unit.name}</button>`;
      });
    });

    container.innerHTML = html;
  };

  // Get icon for unit type
  forge.getUnitIcon = function(unitType) {
    const icons = {
      villager: '👨‍🌾',
      brigand: '🗡️',
      engineer: '🔧',
      architect: '📐',
      monk: '🙏',
      paladin: '⚔️',
      priest: '⛪',
      valkyrie: '👼',
      wizard: '🧙',
      elemental: '🌪️',
      warlock: '🔮',
      geomancer: '🪄',
      mycorrhizae: '🍄',
      myco: '🍄',
      alchemist: '⚗️',
      shaman: '🌿',
      druid: '🌳',
      warrior: '⚔️',
      champion: '👑',
      archer: '🏹',
      ballister: '🎯',
      wagon: '🚛',
      war_wagon: '🚀',
      apc: '🚗',
      tank: '🚜',
      dirigible: '🛩️',
      war_balloon: '💣',
      frog: '🐸',
      tortle: '🐢',
      gnome: '🧝',
      birdy: '🦅',
      scout: '🏃',
      rider: '🐎',
      crossbowman: '🎯',
      infantry: '🛡️',
      knight: '♞',
      catapult: '🪨',
      ballista: '🏹'
    };
    return icons[unitType] || '👤';
  };

  // Place a starting unit at position
  forge.placeStartingUnit = function(pos) {
    const field = window.liveField;
    if (!field) return;

    const existing = this.state.startingUnits.findIndex(u =>
      u.x === pos.x && u.y === pos.y
    );

    this.beginAction('unit', 'Place unit');

    if (existing >= 0) {
      const old = this.state.startingUnits[existing];
      this.recordChange({
        kind: 'unit_update', data: {
          x: pos.x, y: pos.y,
          oldType: old.type, oldPlayer: old.player, oldName: old.name,
          newType: this.state.currentUnitType, newPlayer: this.state.currentUnitPlayer, newName: old.name
        }
      });
      old.type = this.state.currentUnitType;
      old.player = this.state.currentUnitPlayer;
      console.log(`⚔️ Updated unit at (${pos.x}, ${pos.y})`);
    } else {
      const unitData = {
        x: pos.x, y: pos.y,
        type: this.state.currentUnitType,
        player: this.state.currentUnitPlayer,
        name: ''
      };
      this.recordChange({ kind: 'unit_add', data: {...unitData} });
      this.state.startingUnits.push(unitData);
      console.log(`⚔️ Placed ${this.state.currentUnitType} for P${this.state.currentUnitPlayer + 1} at (${pos.x}, ${pos.y})`);
    }

    this.commitAction();
    this.updateUnitMarkers();
    this.updateStartingUnitsList();
  };

  // Remove starting unit at position
  forge.removeStartingUnit = function(pos) {
    const index = this.state.startingUnits.findIndex(u =>
      Math.abs(u.x - pos.x) <= 1 && Math.abs(u.y - pos.y) <= 1
    );

    if (index >= 0) {
      this.beginAction('unit_remove', 'Remove unit');
      this.recordChange({ kind: 'unit_remove', data: {...this.state.startingUnits[index]} });
      const removed = this.state.startingUnits.splice(index, 1)[0];
      this.commitAction();
      this.updateUnitMarkers();
      this.updateStartingUnitsList();
      console.log(`⚔️ Removed ${removed.type} at (${removed.x}, ${removed.y})`);
    }
  };

  // Clear all starting units
  forge.clearStartingUnits = function() {
    if (!confirm('Are you sure you want to clear ALL starting units? This cannot be undone.')) {
      return;
    }

    this.state.startingUnits = [];
    this.updateUnitMarkers();
    this.updateStartingUnitsList();
    console.log('⚔️ All starting units cleared');
  };

  // Update unit markers visualization
  forge.updateUnitMarkers = function() {
    // Dispose old markers
    if (this._unitMarkers) {
      this._unitMarkers.forEach(m => {
        if (m.dispose) m.dispose();
      });
    }
    this._unitMarkers = [];

    if (!gfx || !gfx.scene) return;

    const field = window.liveField;
    if (!field) return;

    // Create markers for each starting unit
    this.state.startingUnits.forEach((unit, i) => {
      const worldX = (unit.x + 0.5) * TILE_SIZE;
      const worldZ = (unit.y + 0.5) * TILE_SIZE;
      const playerColor = this.playerColors[unit.player] || this.playerColors[0];

      // Create a small platform to show unit location
      const platform = BABYLON.MeshBuilder.CreateDisc(`unitPlatform_${i}`, {
        radius: TILE_SIZE * 0.4,
        tessellation: 16
      }, gfx.scene);
      platform.rotation.x = Math.PI / 2;
      platform.position = new BABYLON.Vector3(worldX, 0.2, worldZ);
      platform.metadata = platform.metadata || {};
      platform.metadata.unitIndex = i;

      const platformMat = new BABYLON.StandardMaterial(`unitPlatMat_${i}`, gfx.scene);
      const isSelected = window.forge.state.selectedItemForMove?.type === 'unit' && window.forge.state.selectedItemForMove?.index === i && window.forge.state.moveMode.units;

      platformMat.diffuseColor = isSelected ? new BABYLON.Color3(1, 0.8, 0.2) : playerColor;
      platformMat.emissiveColor = isSelected ? new BABYLON.Color3(0.5, 0.4, 0.1) : playerColor.scale(0.5);
      platformMat.alpha = isSelected ? 0.8 : 0.6;
      platformMat.backFaceCulling = false;
      platform.material = platformMat;
      platform.isPickable = true;

      this._unitMarkers.push(platform);

      if (isSelected) {
        const ring = BABYLON.MeshBuilder.CreateTorus(`unitSelRing_${i}`, {
          diameter: TILE_SIZE * 1.8,
          thickness: 0.25,
          tessellation: 24
        }, gfx.scene);
        ring.position = new BABYLON.Vector3(worldX, 0.4, worldZ);
        ring.isPickable = false;
        const ringMat = new BABYLON.StandardMaterial(`unitSelRingMat_${i}`, gfx.scene);
        ringMat.diffuseColor = new BABYLON.Color3(1, 0.85, 0.1);
        ringMat.emissiveColor = new BABYLON.Color3(1, 0.7, 0);
        ringMat.alpha = 0.9;
        ringMat.backFaceCulling = false;
        ring.material = ringMat;
        const anim = new BABYLON.Animation('unitSelPulse', 'material.alpha', 30,
          BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE);
        anim.setKeys([
          { frame: 0, value: 0.9 },
          { frame: 15, value: 0.35 },
          { frame: 30, value: 0.9 }
        ]);
        ring.animations = [anim];
        gfx.scene.beginAnimation(ring, 0, 30, true);
        this._unitMarkers.push(ring);
      }

      // Load unit model
      const unitDef = window.UnitTypes?.[unit.type];
      if (unitDef && gfx.getModel) {
        gfx.getModel(unitDef.model, gfx.scene).then(model => {
          if (!model || !model.root) return;

          const root = model.root;
          root.position = new BABYLON.Vector3(worldX, 0, worldZ);
          root.scaling = new BABYLON.Vector3(unitDef.scale, unitDef.scale, unitDef.scale);
          root.setEnabled(true);

          // Mark as unit marker for cleanup
          root.metadata = root.metadata || {};
          root.metadata.isUnitMarker = true;
          root.metadata.unitIndex = i;

          this._unitMarkers.push(root);
        }).catch(err => {
          console.warn(`Failed to load unit model for ${unit.type}:`, err);
        });
      }

      // Add player indicator floating above
      const label = BABYLON.MeshBuilder.CreatePlane(`unitLabel_${i}`, { size: 2 }, gfx.scene);
      label.position = new BABYLON.Vector3(worldX, 5, worldZ);
      label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

      const labelTex = new BABYLON.DynamicTexture(`unitLabelTex_${i}`, 64, gfx.scene);
      labelTex.hasAlpha = true;
      const ctx = labelTex.getContext();
      ctx.clearRect(0, 0, 64, 64);
      ctx.font = 'bold 32px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(`P${unit.player + 1}`, 32, 32);
      ctx.fillText(`P${unit.player + 1}`, 32, 32);
      labelTex.update();

      const labelMat = new BABYLON.StandardMaterial(`unitLabelMat_${i}`, gfx.scene);
      labelMat.diffuseTexture = labelTex;
      labelMat.emissiveTexture = labelTex;
      labelMat.useAlphaFromDiffuseTexture = true;
      labelMat.backFaceCulling = false;
      label.material = labelMat;

      this._unitMarkers.push(label);
    });
  };

  forge.updateUnitName = function(index, name) {
    if (index < 0 || index >= this.state.startingUnits.length) return;
    this.state.startingUnits[index].name = (name || '').trim();
    this.updateUnitMarkers();
  };

  // Update starting units list in UI
  forge.updateStartingUnitsList = function() {
    const list = document.getElementById('starting-units-list');
    if (!list) return;

    if (this.state.startingUnits.length === 0) {
      list.innerHTML = '<span style="opacity:0.5;">No starting units</span>';
      return;
    }

    const inputStyle = 'padding:2px 4px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:2px;font-size:10px;width:70px;';
    list.innerHTML = this.state.startingUnits.map((u, i) => {
      const unitDef = window.UnitTypes?.[u.type];
      const typeName = unitDef?.name || u.type;
      const emoji = this.playerEmoji[u.player] || '⚪';
      const nameVal = (u.name || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return `<div style="margin-bottom:4px;padding:3px;background:rgba(0,0,0,0.2);border-radius:2px;font-size:11px;">
        <span>${emoji} ${typeName} (${u.x},${u.y})</span>
        <input type="text" value="${nameVal}" placeholder="Name" style="${inputStyle}margin-left:4px;" 
          onchange="forge.updateUnitName(${i}, this.value)" title="Custom name for adventure story">
      </div>`;
    }).join('');
  };

})(window.forge);
