// Forge Map Editor - Core Module
// State, config, init, camera, input, chunks, map generation, symmetry, misc tools
// Additional modules: forge-terrain, forge-resources, forge-io, forge-buildings, forge-entities, forge-ui

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
    editingLayer: 'file',    // 'file', 'table', 'terrain', 'resources', 'spawns', 'buildings', 'objectives', or 'scenes'
    
    // Map metadata
    mapName: '',
    mapAuthor: '',
    mapDescription: '',
    mapLore: '',
    importedFilename: '',  // Preserve filename for export recommendations
    timeOfDay: 0.4,  // Slider value (0-1); actual sun time is mapped

    // Objective editing state
    selectedObjectiveIndex: -1,  // -1 means no objective selected

    // Scenes (cinematic sequences tied to triggers)
    scenes: [],
    selectedSceneIndex: -1,      // -1 means no scene selected
    selectedStepIndex: -1,       // -1 means no step selected
    scenePickMode: null,         // null, 'trigger_location', 'camera_target', 'unit_target'

    // Move mode states
    moveMode: {
      objectives: false,
      units: false,
      buildings: false
    },
    selectedItemForMove: null,  // {type: 'objective|unit|building', index: number}
    
    // Game type compatibility
    gameTypes: {
      'adventure': false,
      '1v1': true,
      'koth': false,
      'teams': false
    },
    
    // Spawn points (array of {x, y, team, owner} objects; owner: 'player' or 'npc')
    spawnPoints: [],
    currentSpawnOwner: 'player',
    
    // Buildings (array of {x, y, type, rotation, player} objects; player: -1=neutral, 0-3=P1-P4, 5+=NPC/enemy)
    buildings: [],
    currentBuilding: 'agora',
    currentBuildingPlayer: -1,
    
    // Objectives/Win zones (array of {x, y, radius, type, team} objects)
    // type: 'reach' = any unit enters, 'capture' = hold for time, 'escape' = all units must reach
    objectives: [],
    currentObjectiveType: 'reach',
    currentObjectiveRadius: 4,
    // Adventure victory: 'default' = exit/advance can finish chapter (reaches optional if any terminal exists).
    // 'all' = every objective must complete (serialized as map key `ow`: 'all').
    objectiveWinMode: 'default',
    
    // Starting units (array of {x, y, type, player} objects)
    // For adventure mode: players start with units instead of Agoras
    startingUnits: [],
    currentUnitType: 'villager',
    currentUnitPlayer: 0,  // Player index (0 = player 1, 1 = player 2, etc.)

  };
  
  // Spawn point radius (same as game's spawnZoneRadius for terrain flattening)
  forge.spawnZoneRadius = 6;
  
  // Building icon mapping (fallback to category icons if not specified)
  forge.buildingIcons = {
    agora: '🏛️',
    camp: '⛺',
    village: '🏘️',
    farm: '🌾',
    silo: '🏭',
    tower: '🗼',
    mine: '⛏️',
    tavern: '🍺',
    moonwell: '🌙',
    barracks: '⚔️',
    lab: '🔬',
    workshop: '🔧',
    factory: '🏭',
    church: '⛪',
    perch: '🦅',
    grove: '🌳',
    // Category fallbacks
    civic: '🏛️',
    production: '⚙️',
    residential: '🏘️',
    storage: '📦',
    military: '⚔️',
    support: '💚',
    research: '🔬',
    elemental: '🔥'
  };
  
  // Get icon for building (from mapping or category)
  forge.getBuildingIcon = function(buildingKey, buildingDef) {
    return this.buildingIcons[buildingKey] || 
           this.buildingIcons[buildingDef.category] || 
           '🏠';
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

  // Initialize forge editor
  forge.init = function() {
    if (!ENABLE_FORGE) return;
    
    // Set global flag to disable game's automatic model placement
    window.isForgeMode = true;
    
    console.log('🔨 Forge Map Editor initializing...');
    
    // CRITICAL: Create default field if it doesn't exist
    if (!window.liveField && window.Field) {
      console.log('Creating default field for forge...');
      window.liveField = new Field({
        width: this.state.mapWidth,
        height: this.state.mapHeight,
        seed: this.state.mapSeed
      });
    }
    
    this.setupUI();
    this.setupPainting();
    this.setupCameraForEditing();
    
    // Force initial chunk loading
    this.loadAllChunks();
    
    // Build dynamic table based on chunk mask
    this.rebuildTable();
    
    // Apply initial time of day
    this.setTimeOfDay(this.state.timeOfDay);
    
    // Ensure models are visible and blocked tiles are computed as resources load async
    setTimeout(() => { this.ensureModelsVisible(); this.refreshBlockedTiles(); }, 500);
    setTimeout(() => { this.ensureModelsVisible(); this.refreshBlockedTiles(); }, 1500);
    setTimeout(() => { this.ensureModelsVisible(); this.refreshBlockedTiles(); }, 3000);
    
    console.log('✅ Forge ready');
  };
  
  // Ensure all loaded models respect current visibility settings
  forge.ensureModelsVisible = function() {
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
    
    // Prevent context menu when editing spawns/buildings/units/objectives (right-click removes)
    canvas.addEventListener('contextmenu', (e) => {
      if (this.state.editingLayer === 'spawns' || this.state.editingLayer === 'buildings' || this.state.editingLayer === 'units' || this.state.editingLayer === 'objectives') {
        e.preventDefault();
      }
    });
    
    // Setup Forge-specific camera controls
    this.setupCameraControls(canvas);

    console.log('🖌️ Painting system ready');
  };
  
  // Forge camera state - global so pointer handler can access it
  forge._camState = { rightDown: false, middleDown: false, lastX: 0, lastY: 0 };
  forge._camKeys = {};
  
  // Forge camera - for UniversalCamera (not ArcRotateCamera!)
  forge.setupCameraControls = function(canvas) {
    if (!canvas || !gfx || !gfx.camera) {
      console.error('❌ Forge camera: missing canvas or camera');
      return;
    }
    
    const cam = gfx.camera;
    
    // Kill ALL Babylon camera controls
    cam.detachControl();
    if (cam.inputs) cam.inputs.clear();
    
    // Use pointerdown/move/up instead of mouse events (pointer events fire first)
    canvas.addEventListener('pointerdown', (e) => {
      forge._camState.lastX = e.clientX;
      forge._camState.lastY = e.clientY;
      if (e.button === 2) { forge._camState.rightDown = true; }
      if (e.button === 1) { forge._camState.middleDown = true; }
    }, true); // Capture phase!
    
    canvas.addEventListener('pointermove', (e) => {
      const state = forge._camState;
      const dx = e.clientX - state.lastX;
      const dy = e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      
      // Right drag = look around (yaw + pitch)
      if (state.rightDown && cam.rotation) {
        cam.rotation.y += dx * 0.005;  // Yaw (left/right) - flipped
        cam.rotation.x += dy * 0.005;  // Pitch (up/down)
        // Clamp pitch to avoid flipping
        cam.rotation.x = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, cam.rotation.x));
      }
      
      // Middle drag = pan (move camera position) - relative to camera facing
      if (state.middleDown && cam.position) {
        const speed = cam.position.y * 0.003;
        const forward = cam.getForwardRay ? cam.getForwardRay().direction : new BABYLON.Vector3(0, 0, -1);
        const up = cam.upVector || new BABYLON.Vector3(0, 1, 0);
        const right = BABYLON.Vector3.Cross(forward, up).normalize();
        let forwardXZ = new BABYLON.Vector3(forward.x, 0, forward.z);
        let rightXZ = new BABYLON.Vector3(right.x, 0, right.z);
        if (rightXZ.lengthSquared() > 1e-6) rightXZ.normalize();
        if (forwardXZ.lengthSquared() > 1e-6) {
          forwardXZ.normalize();
        } else {
          forwardXZ = new BABYLON.Vector3(-rightXZ.z, 0, rightXZ.x);
        }
        const panX = (rightXZ.x * dx + forwardXZ.x * dy) * speed;
        const panZ = (rightXZ.z * dx + forwardXZ.z * dy) * speed;
        cam.position.x += panX;
        cam.position.z += panZ;
      }
    }, true); // Capture phase!
    
    const pointerUp = (e) => {
      if (e.button === 2) forge._camState.rightDown = false;
      if (e.button === 1) forge._camState.middleDown = false;
    };
    canvas.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointerup', pointerUp);
    
    // Scroll = zoom (move camera up/down)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * 10;
      cam.position.y = Math.max(20, Math.min(500, cam.position.y + delta));
    }, { passive: false });
    
    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        forge.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        forge.redo();
        return;
      }

      const k = e.key.toLowerCase();
      forge._camKeys[k] = true;
      if (k.startsWith('arrow')) forge._camKeys[k.replace('arrow', '')] = true;
    });
    document.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      forge._camKeys[k] = false;
      if (k.startsWith('arrow')) forge._camKeys[k.replace('arrow', '')] = false;
    });
    
    // Keyboard loop
    const tick = () => {
      if (!gfx.camera) { requestAnimationFrame(tick); return; }
      
      const keys = forge._camKeys;
      const speed = cam.position.y * 0.02;
      const yaw = cam.rotation ? cam.rotation.y : 0;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      
      // WASD / Arrow keys to move
      if (keys['w'] || keys['up']) { cam.position.x -= sin * speed; cam.position.z -= cos * speed; }
      if (keys['s'] || keys['down']) { cam.position.x += sin * speed; cam.position.z += cos * speed; }
      if (keys['a'] || keys['left']) { cam.position.x -= cos * speed; cam.position.z += sin * speed; }
      if (keys['d'] || keys['right']) { cam.position.x += cos * speed; cam.position.z -= sin * speed; }
      
      // Q/E to rotate
      if (keys['q']) cam.rotation.y += 0.03;
      if (keys['e']) cam.rotation.y -= 0.03;
      
      // R/F to zoom (height)
      if (keys['r']) cam.position.y = Math.max(20, cam.position.y - speed * 0.3);
      if (keys['f']) cam.position.y = Math.min(500, cam.position.y + speed * 0.3);
      
      requestAnimationFrame(tick);
    };
    tick();
    
    console.log('✅ Forge camera: Right-drag=rotate, Middle-drag=pan, Scroll=zoom, WASD/Arrows=move, Q/E=rotate, R/F=zoom');
  };

  // Handle pointer events
  forge.handlePointer = function(e) {
    if (!ENABLE_FORGE || !window.liveField) return;
    
    // Handle right-click for spawn/building/objective removal
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
      if (this.state.editingLayer === 'objectives') {
        e.preventDefault();
        const pos = this.getTilePosition(e);
        if (pos) this.removeObjective(pos);
        return;
      }
      if (this.state.editingLayer === 'units') {
        e.preventDefault();
        const pos = this.getTilePosition(e);
        if (pos) this.removeStartingUnit(pos);
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
          
          // Building editing mode - place building or move existing
          if (this.state.editingLayer === 'buildings') {
            if (window.forge.state.moveMode.buildings) {
              if (window.forge.state.selectedItemForMove) {
                const pos = this.getTilePosition(e);
                if (pos) {
                  const moveIdx = window.forge.state.selectedItemForMove.index;
                  window.forge.state.selectedItemForMove = null;
                  this.moveBuilding(moveIdx, pos);
                }
              } else {
                const pickResult = this.getPickResult(e);
                const buildingIndex = this.getBuildingIndexFromPick(pickResult);
                if (buildingIndex !== -1) {
                  window.forge.state.selectedItemForMove = { type: 'building', index: buildingIndex };
                  this.updateBuildingMarkers();
                } else {
                  const pos = this.getTilePosition(e);
                  if (pos) this.selectBuildingForMove(pos);
                }
              }
            } else {
              const pos = this.getTilePosition(e);
              if (pos) this.placeBuilding(pos);
            }
            return;
          }
          
          // Objective editing mode - place objective zone or move existing
          if (this.state.editingLayer === 'objectives') {
            const pos = this.getTilePosition(e);
            if (pos) {
              if (window.forge.state.moveMode.objectives) {
                if (window.forge.state.selectedItemForMove) {
                  this.moveObjective(window.forge.state.selectedItemForMove.index, pos);
                  window.forge.state.selectedItemForMove = null;
                } else {
                  this.selectObjectiveForMove(pos);
                }
              } else {
                this.placeObjective(pos);
              }
            }
            return;
          }
          
          // Units editing mode - place starting unit or move existing
          if (this.state.editingLayer === 'units') {
            if (window.forge.state.moveMode.units) {
              if (window.forge.state.selectedItemForMove) {
                const pos = this.getTilePosition(e);
                if (pos) {
                  const moveIdx = window.forge.state.selectedItemForMove.index;
                  window.forge.state.selectedItemForMove = null;
                  this.moveStartingUnit(moveIdx, pos);
                }
              } else {
                const pickResult = this.getPickResult(e);
                const unitIndex = this.getUnitIndexFromPick(pickResult);
                if (unitIndex !== -1) {
                  window.forge.state.selectedItemForMove = { type: 'unit', index: unitIndex };
                  this.updateUnitMarkers();
                } else {
                  const pos = this.getTilePosition(e);
                  if (pos) this.selectStartingUnitForMove(pos);
                }
              }
            } else {
              const pos = this.getTilePosition(e);
              if (pos) this.placeStartingUnit(pos);
            }
            return;
          }

          // Scene editing - map click sets coordinates for trigger/step targets
          if (this.state.editingLayer === 'scenes' && this.state.scenePickMode) {
            const pos = this.getTilePosition(e);
            if (pos) this.handleSceneMapClick(pos);
            return;
          }

          // Only allow painting if we have an active tool
          if (this.state.currentTool === null) {
            return;
          }

          this.state.isPainting = true;
          // Disable camera controls while painting
          if (gfx.camera) {
            gfx.camera.detachControl();
          }
          // Begin undo action for the entire paint stroke
          if (this.state.editingLayer === 'terrain') {
            this.beginAction('terrain', 'Paint terrain');
          } else if (this.state.editingLayer === 'resources') {
            this.beginAction('resource', 'Place/erase resource');
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
        // Update building preview only in Place mode (hide in Move mode)
        if (this.state.editingLayer === 'buildings' && this.state.currentBuilding !== 'eraser') {
          if (this.state.moveMode.buildings) {
            this.hideBuildingPreview();
          } else {
            this.updateBuildingPreview(e);
          }
        }

        // Update brush and objective previews
        const pos = this.getTilePosition(e);
        if (pos) {
          if (this.state.editingLayer === 'terrain' && this._brushPreviewVisible) {
            this.updateBrushPreview(pos);
          }
          if (this.state.editingLayer === 'objectives' && this._objectivePreviewVisible) {
            this.updateObjectivePreview(pos);
          }
        }

        if (this.state.isPainting && this.state.editingLayer !== 'table' && this.state.currentTool !== null) {
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
          // Commit the undo action for this paint stroke
          this.commitAction();
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

  // Get raw pick result (for resolving building/unit from clicked mesh)
  forge.getPickResult = function(e) {
    if (!gfx || !gfx.scene) return null;
    return gfx.scene.pick(e.clientX, e.clientY);
  };

  // Resolve building index from picked mesh (walk up to root with metadata.buildingKey)
  forge.getBuildingIndexFromPick = function(pickResult) {
    if (!pickResult || !pickResult.hit || !pickResult.pickedMesh) return -1;
    let node = pickResult.pickedMesh;
    while (node) {
      const key = node.metadata && node.metadata.buildingKey;
      if (key && this.state.buildings) {
        const idx = this.state.buildings.findIndex(b => `${b.x},${b.y}` === key);
        if (idx !== -1) return idx;
      }
      node = node.parent;
    }
    return -1;
  };

  // Resolve unit index from picked mesh (metadata.unitIndex on marker or platform)
  forge.getUnitIndexFromPick = function(pickResult) {
    if (!pickResult || !pickResult.hit || !pickResult.pickedMesh) return -1;
    let node = pickResult.pickedMesh;
    while (node) {
      if (node.metadata && typeof node.metadata.unitIndex === 'number') {
        if (node.metadata.unitIndex >= 0 && node.metadata.unitIndex < (this.state.startingUnits || []).length) {
          return node.metadata.unitIndex;
        }
      }
      node = node.parent;
    }
    return -1;
  };

  // Rebuild chunk meshes (terrain only - preserves existing resources)
  forge.rebuildChunks = function(chunkKeys) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene || !gfx.createTerrainMesh) return;
    
    chunkKeys.forEach(key => {
      const chunk = field.chunks.get(key);
      if (chunk) {
        // CRITICAL: Save resource models before disposing mesh (they are children of mesh)
        const savedModels = [];
        if (chunk.models && chunk.models.length > 0) {
          chunk.models.forEach(model => {
            if (model && model.root) {
              // Detach from old mesh parent
              model.root.parent = null;
              savedModels.push(model);
            }
          });
        }
        
        // Now safe to dispose old terrain mesh
        if (chunk.mesh) {
          chunk.mesh.dispose();
          chunk.mesh = null;
        }
        
        // Refresh chunk tiles from field
        const chunkTiles = [];
        for (let z = chunk.startZ; z < chunk.endZ; z++) {
          for (let x = chunk.startX; x < chunk.endX; x++) {
            chunkTiles.push(field.tiles[z * field.width + x]);
          }
        }
        chunk.tiles = chunkTiles;
        
        // Recreate terrain mesh
        chunk.mesh = gfx.createTerrainMesh(gfx.scene, chunk, 4);
        chunk.needsMesh = false;
        
        // Re-parent saved models to new mesh and ensure visible
        if (savedModels.length > 0) {
          savedModels.forEach(model => {
            if (model && model.root && !model.root.isDisposed()) {
              model.root.parent = chunk.mesh;
              model.root.setEnabled(true);
              model.root.getChildMeshes().forEach(m => m.setEnabled(true));
            }
          });
          chunk.models = savedModels;
        }
      }
    });

    this.refreshBlockedTiles();
  };

  // Recompute all blocked/slow tiles from water, resources, and buildings
  forge.refreshBlockedTiles = function() {
    const field = window.liveField;
    if (!field || !field.updateBlockedTiles) return;

    field.blockedTiles.clear();
    field.slowTiles.clear();
    field.updateBlockedTiles(); // Water

      // Re-mark resource tiles (rocks = blocked, trees = slow)
      if (gfx && gfx.lodModels) {
        for (const lod of gfx.lodModels) {
          if (!lod.model || lod.model.isDisposed()) continue;
          const pos = lod.model.position;
          const tx = Math.floor(pos.x / TILE_SIZE);
          const tz = Math.floor(pos.z / TILE_SIZE);
          if (lod.decorType === 'tree') {
            field.slowTile(tx, tz);
          } else if (lod.decorType === 'rock') {
            const scale = lod.model.scaling ? lod.model.scaling.x : 1;
            let radius = 0;
            if (scale >= 10) radius = 2;
            else if (scale >= 6) radius = 1;
            field.blockFootprint(tx, tz, radius);
          }
        }
      }

    // Mark buildings as blocked
    if (this.state.buildings) {
      for (const b of this.state.buildings) {
        const def = window.BuildingTypes?.[b.type];
        if (!def) continue;
        const w = def.size?.width || 1;
        const h = def.size?.height || 1;
        for (let dx = 0; dx < w; dx++) {
          for (let dz = 0; dz < h; dz++) {
            field.blockedTiles.add(`${b.x + dx},${b.y + dz}`);
          }
        }
      }
    }

    if (this._blockedGridVisible) {
      this.showBlockedGrid();
    }
  };

  // Generate a new map
  forge.generateNewMap = function(width, height, seed) {
    if (!confirm('Are you sure you want to generate a NEW map? This will completely replace your current work and cannot be undone.')) {
      return;
    }

    if (!window.Field) {
      console.error('Field class not available');
      return;
    }
    
    this.state.mapWidth = width || this.state.mapWidth;
    this.state.mapHeight = height || this.state.mapHeight;
    this.state.mapSeed = seed || Math.floor(Math.random() * 1000000);
    
    console.log(`🗺️ Generating new map: ${this.state.mapWidth}x${this.state.mapHeight}, seed: ${this.state.mapSeed}`);
    
    this.clearHistory();

    // CRITICAL: Clear all existing resources FIRST (before creating new field)
    this.clearResources();
    this._noAutoResources = false;
    
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
    
    // Clear starting units
    this.state.startingUnits = [];
    this._unitMarkers?.forEach(m => m.dispose());
    this._unitMarkers = [];
    this.updateStartingUnitsList();
    
    // Clear buildings
    this.state.buildings = [];
    this._buildingMeshes?.forEach(m => m.dispose());
    this._buildingMeshes?.clear();
    this.updateBuildingList();
    
    // Clear objectives
    this.state.objectives = [];
    this._objectiveMarkers?.forEach(m => m.dispose());
    this._objectiveMarkers = [];

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
    setTimeout(() => {
      this.applyLayerVisibility();
    }, 100);
    setTimeout(() => {
      this.applyLayerVisibility();
    }, 500);
    setTimeout(() => {
      this.applyLayerVisibility();
    }, 1500);
    
    console.log('✅ New map generated');
  };
  
  // Fill entire map with terrain type
  forge.fillMap = function(terrainType) {
    const field = window.liveField;
    if (!field) return;
    
    const terrain = this.terrainTypes[terrainType];
    if (!terrain) return;
    
    console.log(`🎨 Filling map with ${terrain.name}...`);

    // Record a full terrain snapshot for undo
    this.beginAction('fill', `Fill ${terrain.name}`);
    for (let i = 0; i < field.tiles.length; i++) {
      const tile = field.tiles[i];
      this.recordChange({
        kind: 'tile', index: i,
        oldTerrainType: field.terrainTypes[i], newTerrainType: terrain.terrainType,
        oldTileType: tile.type, newTileType: terrain.solidTile,
        oldAtlasName: tile.atlasName, newAtlasName: terrain.atlas
      });
    }
    this.commitAction();

    for (let i = 0; i < field.tiles.length; i++) {
      field.terrainTypes[i] = terrain.terrainType;
      field.tiles[i].type = terrain.solidTile;
      field.tiles[i].atlasName = terrain.atlas;
      field.tiles[i].updateAtlasCoordinates();
    }
    
    const allChunks = new Set(field.chunks.keys());
    this.rebuildChunks(allChunks);
    
    console.log('✅ Fill complete');
  };

  // Set time of day (0-1)
  forge.setTimeOfDay = function(sliderValue) {
    // Map slider 0-1 to sun time 0.25-0.75 so right side is noon, left is dawn
    const sunTime = 0.25 + Math.max(0, Math.min(1, sliderValue)) * 0.5;
    this.state.timeOfDay = sunTime;
    
    // Update lighting
    if (window.lighting && window.lighting.setSunTime) {
      window.lighting.setSunTime(sunTime);
    }
    
    // Update label based on actual sun time
    const label = document.getElementById('time-label');
    if (label) {
      const t = sunTime;
      const phases = [
        { max: 0.30, name: '🌅 Dawn' },
        { max: 0.40, name: '🌄 Early Morning' },
        { max: 0.50, name: '🌞 Noon' },
        { max: 0.60, name: '☀️ Afternoon' },
        { max: 0.70, name: '🌇 Late Afternoon' },
        { max: 0.80, name: '🌆 Sunset' },
        { max: 1.01, name: '🌙 Night' }
      ];
      const phase = phases.find(p => t <= p.max) || phases[phases.length - 1];
      label.textContent = phase.name;
    }
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
          field.tiles[dstIndex].updateAtlasCoordinates();
          
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
        const existing = this.state.spawnPoints.find(s => s.x === mp.x && s.y === mp.y);
        if (!existing) {
          const newTeam = (spawn.team + i) % 8;
          this.state.spawnPoints.push({ x: mp.x, y: mp.y, team: newTeam });
        }
      });
    });
    
    // Rebuild affected chunks (also updates blocked tiles)
    this.rebuildChunks(affectedChunks);
    this.updateSpawnMarkers();
    this.updateSpawnList();
    
    console.log(`✅ Symmetry applied to ${affectedChunks.size} chunks`);
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

  // Toggle minimize/expand control board
  forge.toggleMinimize = function() {
    const panel = document.querySelector('.forge-panel');
    const btn = document.getElementById('forge-minimize');

    if (!panel || !btn) return;

    const isMinimized = panel.classList.contains('minimized');
    panel.classList.toggle('minimized');

    if (panel.classList.contains('minimized')) {
      panel.style.maxWidth = '200px';
      btn.textContent = '⬇️';
      btn.title = 'Expand control board';

      const sections = panel.querySelectorAll('.forge-section');
      sections.forEach((section, index) => {
        if (index === 0) {
          section.style.display = 'block';
          const h3 = section.querySelector('h3');
          if (h3) h3.style.display = 'none';
        } else {
          section.style.display = 'none';
        }
      });
    } else {
      panel.style.maxWidth = '50vw';
      btn.textContent = '⬆️';
      btn.title = 'Minimize to layers only';

      // Restore the layers section (first section) and its heading
      const sections = panel.querySelectorAll('.forge-section');
      if (sections[0]) {
        sections[0].style.display = 'block';
        const h3 = sections[0].querySelector('h3');
        if (h3) h3.style.display = 'block';
      }

      // Re-apply current layer to show only the correct panel
      this.setEditingLayer(this.state.editingLayer);
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
      if (btn && gfx.isBillboardOnlyMode) {
        const isOn = gfx.isBillboardOnlyMode();
        btn.classList.toggle('active', isOn);
        btn.textContent = isOn ? '🖼️ Billboard ON' : '🖼️ Billboard Only';
      }
    }
  };

  // Export forge object
  window.forge = forge;
  
})(window.forge || {});
