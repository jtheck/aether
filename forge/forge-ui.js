// Forge UI Module - UI panel, layer switching, visibility, overlays
(function(forge) {
  'use strict';

  // Setup UI
  // Generate building buttons dynamically from BuildingTypes
  forge.generateBuildingButtons = function() {
    if (!window.BuildingTypes) {
      console.warn('BuildingTypes not loaded yet');
      return;
    }
    
    const container = document.getElementById('buildings-buttons-container');
    if (!container) return;
    
    let html = '';
    let currentRow = [];
    const buttonsPerRow = 3;
    
    // Group buildings and create buttons
    Object.keys(window.BuildingTypes).forEach((key, index) => {
      const building = window.BuildingTypes[key];
      const icon = this.getBuildingIcon(key, building);
      const name = building.name || key;
      
      currentRow.push(`<button id="bldg-${key}" class="forge-btn${index === 0 ? ' active' : ''}" onclick="forge.setBuilding('${key}')">${icon} ${name}</button>`);
      
      if (currentRow.length === buttonsPerRow) {
        html += `<div class="forge-buttons" style="margin-top:5px;">${currentRow.join('')}</div>`;
        currentRow = [];
      }
    });
    
    // Add remaining buttons
    if (currentRow.length > 0) {
      html += `<div class="forge-buttons" style="margin-top:5px;">${currentRow.join('')}</div>`;
    }
    
    container.innerHTML = html;
    
    // Set first building as default
    const firstBuilding = Object.keys(window.BuildingTypes)[0];
    if (firstBuilding) {
      this.state.currentBuilding = firstBuilding;
    }
  };
  
  forge.setupUI = function() {
    if (!ENABLE_FORGE) return;
    
    const forgeUI = document.createElement('div');
    forgeUI.id = 'forge-ui';
    forgeUI.innerHTML = `
      <div class="forge-panel" style="max-width: 454px; transition: max-width 0.3s ease;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
          <h2 style="margin:0;">🔨 Forge</h2>
          <div style="display:flex;gap:4px;align-items:center;">
            <button id="forge-undo-btn" class="forge-btn-sm" onclick="forge.undo()" title="Nothing to undo" disabled>↩</button>
            <button id="forge-redo-btn" class="forge-btn-sm" onclick="forge.redo()" title="Nothing to redo" disabled>↪</button>
            <button id="forge-minimize" class="forge-btn-sm" onclick="forge.toggleMinimize()" title="Minimize to layers only">⬆️</button>
          </div>
        </div>
        
        <div class="forge-section">
          <h3>Layers</h3>
          <div class="forge-buttons">
            <button id="layer-file" class="forge-btn active" onclick="forge.setEditingLayer('file')">📄 File</button>
            <button id="layer-table" class="forge-btn" onclick="forge.setEditingLayer('table')">🎱 Table</button>
            <button id="layer-terrain" class="forge-btn" onclick="forge.setEditingLayer('terrain')">🗺️ Terrain</button>
            <button id="layer-resources" class="forge-btn" onclick="forge.setEditingLayer('resources')">🌲 Resources</button>
            <button id="layer-buildings" class="forge-btn" onclick="forge.setEditingLayer('buildings')">🏗️ Buildings</button>
            <button id="layer-spawns" class="forge-btn" onclick="forge.setEditingLayer('spawns')">🚩 Spawns</button>
            <button id="layer-units" class="forge-btn" onclick="forge.setEditingLayer('units')">⚔️ Units</button>
            <button id="layer-objectives" class="forge-btn" onclick="forge.setEditingLayer('objectives')">🎯 Objectives</button>
            <button id="layer-scenes" class="forge-btn" onclick="forge.setEditingLayer('scenes')">🎬 Scenes</button>
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="vis-table" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('table')">👁️ Table</button>
            <button id="vis-terrain" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('terrain')">👁️ Terrain</button>
            <button id="vis-resources" class="forge-btn active forge-vis" onclick="forge.toggleLayerVisibility('resources')">👁️ Resources</button>
            <button id="vis-grid" class="forge-btn forge-vis" onclick="forge.toggleResourceGrid()">📍 Grid</button>
            <button id="vis-blocked" class="forge-btn forge-vis" onclick="forge.toggleBlockedGrid()">🚫 Blocked</button>
            <button id="vis-objectives" class="forge-btn forge-vis" onclick="forge.toggleObjectiveView()">🎯 Objectives</button>
          </div>
        </div>

        <div id="file-panel" class="forge-section" style="display:none;">
          <h3>📄 Map File & Info</h3>
          <div style="margin-bottom:6px;">
            <input type="text" id="map-name" placeholder="Map Name"
                   style="width:100%;padding:6px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:4px;"
                   onchange="forge.state.mapName = this.value">
          </div>
          <div style="margin-bottom:6px;">
            <input type="text" id="map-author" placeholder="Author"
                   style="width:100%;padding:6px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:4px;font-size:11px;"
                   onchange="forge.state.mapAuthor = this.value">
          </div>
          <div style="margin-bottom:6px;">
            <textarea id="map-desc" placeholder="Description (shown in map browser)" rows="2"
                   style="width:100%;padding:6px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:4px;font-size:11px;resize:vertical;"
                   onchange="forge.state.mapDescription = this.value"></textarea>
          </div>
          <div style="margin-bottom:8px;">
            <textarea id="map-lore" placeholder="Lore / Backstory (optional)" rows="3"
                   style="width:100%;padding:6px;background:#2a2a3e;border:1px solid #444;color:#888;border-radius:4px;font-size:10px;font-style:italic;resize:vertical;"
                   onchange="forge.state.mapLore = this.value"></textarea>
          </div>
          <div style="margin-bottom:12px;">
            <div style="font-size:11px;color:#888;margin-bottom:4px;">Technical Info:</div>
            <div id="technical-info" style="font-size:10px;color:#666;background:#1a1a1a;padding:6px;border-radius:4px;border:1px solid #333;">
              <!-- Technical info will be populated by updateTechnicalInfo() -->
            </div>
          </div>
          <div class="forge-buttons">
            <button class="forge-btn" onclick="forge.exportMap()">💾 Export</button>
            <button class="forge-btn" onclick="document.getElementById('import-file').click()">📂 Import</button>
            <input type="file" id="import-file" accept=".garden,.json" style="display:none"
                   onchange="forge.handleImport(this.files[0])">
          </div>

          <h3>Map Generation</h3>
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

          <h3>🌅 Time of Day</h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🌙</span>
            <input type="range" id="time-slider" min="0" max="100" value="40"
                   style="flex: 1;" oninput="forge.setTimeOfDay(this.value / 100)">
            <span style="font-size: 16px;">☀️</span>
          </div>
          <div id="time-label" style="text-align: center; font-size: 11px; color: #888; margin-top: 4px;">Mid-Morning</div>

          <h3>Performance</h3>
          <div class="forge-buttons">
            <button id="billboard-toggle" class="forge-btn" onclick="forge.toggleBillboardMode()">🖼️ Billboard Only</button>
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
          <h3>Fill</h3>
          <div class="forge-buttons">
            <button class="forge-btn" onclick="forge.fillMap('grass')">All Grass</button>
            <button class="forge-btn" onclick="forge.fillMap('dirt')">All Dirt</button>
            <button class="forge-btn" onclick="forge.fillMap('water')">All Water</button>
          </div>
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
          <p id="buildings-hint" style="font-size:11px;opacity:0.7;">Click to place. Right-click to remove.</p>

          <div class="forge-buttons" style="margin-bottom:8px;">
            <button id="bld-place-mode" class="forge-btn active" onclick="forge.setBuildingMode('place')">➕ Place</button>
            <button id="bld-move-mode" class="forge-btn" onclick="forge.setBuildingMode('move')">↔️ Move</button>
            <button class="forge-btn" onclick="forge.clearBuildings()">🗑️ Clear All</button>
          </div>

          <div id="buildings-buttons-container" style="max-height:300px;overflow-y:auto;">
            <!-- Buttons will be dynamically generated from BuildingTypes -->
          </div>
          <div class="forge-buttons" style="margin-top:5px;">
            <button id="bldg-eraser" class="forge-btn" onclick="forge.setBuilding('eraser')">🧽 Eraser</button>
          </div>
          <div id="building-list" style="margin-top:8px;font-size:11px;max-height:100px;overflow-y:auto;"></div>
        </div>
        
        <div id="units-panel" class="forge-section" style="display:none;">
          <h3>⚔️ Starting Units</h3>
          <p id="units-hint" style="font-size:11px;opacity:0.7;">Click to place starting unit. Right-click to remove.<br>For Adventure mode: players start with units instead of Agoras.</p>

          <div class="forge-buttons" style="margin-bottom:8px;">
            <button id="unit-place-mode" class="forge-btn active" onclick="forge.setUnitMode('place')">➕ Place</button>
            <button id="unit-move-mode" class="forge-btn" onclick="forge.setUnitMode('move')">↔️ Move</button>
            <button class="forge-btn" onclick="forge.clearStartingUnits()">🗑️ Clear All</button>
          </div>

          <h4 style="margin-top:8px;font-size:12px;">Player</h4>
          <div class="forge-buttons">
            <button id="unit-player-0" class="forge-btn active" onclick="forge.setUnitPlayer(0)">🔵 P1</button>
            <button id="unit-player-1" class="forge-btn" onclick="forge.setUnitPlayer(1)">🔴 P2</button>
            <button id="unit-player-2" class="forge-btn" onclick="forge.setUnitPlayer(2)">🟢 P3</button>
            <button id="unit-player-3" class="forge-btn" onclick="forge.setUnitPlayer(3)">🟡 P4</button>
          </div>
          
          <h4 style="margin-top:8px;font-size:12px;">Unit Type</h4>
          <div id="unit-type-buttons" class="forge-buttons" style="max-height:200px;overflow-y:auto;">
            <!-- Dynamically generated -->
          </div>
          
          <div id="starting-units-list" style="margin-top:8px;font-size:11px;max-height:100px;overflow-y:auto;"></div>
        </div>
        
        <div id="objectives-panel" class="forge-section" style="display:none;">
          <h3>🎯 Objectives</h3>
          <p style="font-size:11px;opacity:0.7;">Click to place objective zone. Right-click to remove.<br>Players must reach these to win in Adventure mode.</p>

          <div class="forge-buttons" style="margin-bottom:8px;">
            <button id="obj-place-mode" class="forge-btn active" onclick="forge.setObjectiveMode('place')">➕ Place</button>
            <button id="obj-move-mode" class="forge-btn" onclick="forge.setObjectiveMode('move')">↔️ Move</button>
            <button class="forge-btn" onclick="forge.clearObjectives()">🗑️ Clear All</button>
          </div>

          <h4 style="margin-top:8px;font-size:12px;">Zone Type</h4>
          <div class="forge-buttons">
            <button id="obj-reach" class="forge-btn active" onclick="forge.setObjectiveType('reach')">🏁 Reach</button>
            <button id="obj-escape" class="forge-btn" onclick="forge.setObjectiveType('escape')">🚪 Exit</button>
          </div>
          
          <h4 style="margin-top:8px;font-size:12px;">Zone Size</h4>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <input type="range" id="obj-radius" min="2" max="10" value="4" oninput="forge.setObjectiveRadius(this.value)" style="flex:1;">
            <span id="obj-radius-display" style="font-size:11px;min-width:30px;">4</span>
          </div>
          
          <h4 style="margin-top:8px;font-size:12px;">💬 Message (shown when reached)</h4>
          <textarea id="obj-message" rows="2" style="width:100%;font-size:11px;resize:vertical;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);color:#fff;padding:4px;" placeholder="Enter dialogue text..."></textarea>
          
          <div id="objective-list" style="margin-top:8px;font-size:12px;max-height:150px;overflow-y:auto;"></div>

          <div id="objective-edit-controls" style="margin-top:8px;display:none;">
            <h4 style="margin:8px 0 4px 0;font-size:12px;">✏️ Edit Selected Objective</h4>
            <div class="forge-buttons">
              <button class="forge-btn" onclick="forge.saveObjectiveChanges()">💾 Save Changes</button>
              <button class="forge-btn" onclick="forge.cancelObjectiveEdit()">❌ Cancel</button>
            </div>
          </div>
        </div>

        <div id="scenes-panel" class="forge-section" style="display:none;">
          <h3>🎬 Scenes</h3>
          <p style="font-size:11px;opacity:0.7;">Scripted cinematic sequences. Trigger by objective, location, timer, or match start.</p>

          <div class="forge-buttons" style="margin-bottom:8px;">
            <button class="forge-btn" onclick="forge.addScene()">➕ Add Scene</button>
            <button class="forge-btn" onclick="forge.clearScenes()">🗑️ Clear All</button>
            <button class="forge-btn" onclick="forge.previewSelectedScene()" title="Preview selected scene">▶ Preview</button>
          </div>

          <div id="scene-list" style="max-height:120px;overflow-y:auto;margin-bottom:8px;font-size:12px;"></div>

          <div id="scene-editor" style="display:none;">
            <h4 style="margin:8px 0 4px;font-size:12px;">✏️ Edit Scene</h4>
            <input type="text" id="scene-name" placeholder="Scene name"
              style="width:100%;padding:4px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;margin-bottom:6px;font-size:12px;"
              onchange="forge.updateSceneName(this.value)">

            <h4 style="margin:6px 0 3px;font-size:11px;">Trigger</h4>
            <select id="scene-trigger-type"
              style="width:100%;padding:4px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;margin-bottom:4px;font-size:11px;"
              onchange="forge.setSceneTriggerType(this.value)">
              <option value="match_start">▶️ Match Start</option>
              <option value="objective_reached">🎯 Objective Reached</option>
              <option value="location_entered">📍 Location Entered</option>
              <option value="timer">⏱️ Timer</option>
            </select>
            <div id="scene-trigger-params" style="margin-bottom:6px;"></div>

            <h4 style="margin:6px 0 3px;font-size:11px;">Timeline</h4>
            <div id="scene-steps-list" style="max-height:200px;overflow-y:auto;margin-bottom:6px;"></div>

            <div style="display:flex;gap:4px;align-items:center;">
              <select id="scene-add-step-type" style="flex:1;padding:4px;background:#2a2a3e;border:1px solid #444;color:#fff;border-radius:3px;font-size:11px;">
                <option value="dialogue">💬 Dialogue</option>
                <option value="wait">⏸️ Wait</option>
                <option value="camera">📷 Camera</option>
                <option value="unit_move">🚶 Unit Move</option>
              </select>
              <button class="forge-btn-sm" onclick="forge.addSceneStep(document.getElementById('scene-add-step-type').value)" title="Add step">➕</button>
            </div>
          </div>
        </div>

        <div id="symmetry-panel" class="forge-section">
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
    
    // Generate building buttons after UI is in DOM
    this.generateBuildingButtons();

    // Generate unit type buttons
    this.generateUnitTypeButtons();

    // Set the default editing layer after UI is ready
    setTimeout(() => {
      this.setEditingLayer(this.state.editingLayer);
    }, 10);

    console.log('🎨 Forge UI created');
  };
  
  // Set editing layer (file, table, terrain, resources, spawns, buildings, objectives)
  // Mode switching functions
  forge.setObjectiveMode = function(mode) {
    window.forge.state.moveMode.objectives = mode === 'move';
    window.forge.state.selectedItemForMove = null; // Clear selection when switching modes
    document.getElementById('obj-place-mode').classList.toggle('active', mode === 'place');
    document.getElementById('obj-move-mode').classList.toggle('active', mode === 'move');
    this.updateObjectiveMarkers();
  };

  forge.setBuildingMode = function(mode) {
    window.forge.state.moveMode.buildings = mode === 'move';
    window.forge.state.selectedItemForMove = null; // Clear selection when switching modes
    document.getElementById('bld-place-mode').classList.toggle('active', mode === 'place');
    document.getElementById('bld-move-mode').classList.toggle('active', mode === 'move');
    if (mode === 'move') {
      this.hideBuildingPreview();
    } else {
      this.showBuildingPreview();
    }
    const hint = document.getElementById('buildings-hint');
    if (hint) hint.textContent = mode === 'move' ? 'Move: Click a building to select (it highlights), then click destination.' : 'Click to place. Right-click to remove.';
    this.updateBuildingMarkers();
  };

  forge.setUnitMode = function(mode) {
    window.forge.state.moveMode.units = mode === 'move';
    window.forge.state.selectedItemForMove = null; // Clear selection when switching modes
    document.getElementById('unit-place-mode').classList.toggle('active', mode === 'place');
    document.getElementById('unit-move-mode').classList.toggle('active', mode === 'move');
    const hint = document.getElementById('units-hint');
    if (hint) hint.textContent = mode === 'move' ? 'Move: Click a unit to select (it highlights), then click destination.' : 'Click to place starting unit. Right-click to remove. For Adventure: players start with units instead of Agoras.';
    this.updateUnitMarkers();
  };

  forge.setEditingLayer = function(layer) {
    // Reset move modes when switching layers
    window.forge.state.moveMode.objectives = false;
    window.forge.state.moveMode.units = false;
    window.forge.state.moveMode.buildings = false;
    window.forge.state.selectedItemForMove = null;
    const bldHint = document.getElementById('buildings-hint');
    if (bldHint) bldHint.textContent = 'Click to place. Right-click to remove.';
    const unitHint = document.getElementById('units-hint');
    if (unitHint) unitHint.textContent = 'Click to place starting unit. Right-click to remove. For Adventure: players start with units instead of Agoras.';

    window.forge.state.editingLayer = layer;
    // Deactivate tools when in file mode
    window.forge.state.currentTool = layer === 'file' ? null : (layer === 'resources' ? 'resource' : layer);

    // Update layer button states
    document.getElementById('layer-file').classList.toggle('active', layer === 'file');
    document.getElementById('layer-table').classList.toggle('active', layer === 'table');
    document.getElementById('layer-terrain').classList.toggle('active', layer === 'terrain');
    document.getElementById('layer-resources').classList.toggle('active', layer === 'resources');
    document.getElementById('layer-buildings').classList.toggle('active', layer === 'buildings');
    document.getElementById('layer-spawns').classList.toggle('active', layer === 'spawns');
    document.getElementById('layer-units').classList.toggle('active', layer === 'units');
    document.getElementById('layer-objectives').classList.toggle('active', layer === 'objectives');
    document.getElementById('layer-scenes').classList.toggle('active', layer === 'scenes');

    // Show/hide panels
    document.getElementById('file-panel').style.display = layer === 'file' ? 'block' : 'none';
    document.getElementById('table-panel').style.display = layer === 'table' ? 'block' : 'none';
    document.getElementById('terrain-panel').style.display = layer === 'terrain' ? 'block' : 'none';
    document.getElementById('resource-panel').style.display = layer === 'resources' ? 'block' : 'none';
    document.getElementById('buildings-panel').style.display = layer === 'buildings' ? 'block' : 'none';
    document.getElementById('spawns-panel').style.display = layer === 'spawns' ? 'block' : 'none';
    document.getElementById('units-panel').style.display = layer === 'units' ? 'block' : 'none';
    document.getElementById('objectives-panel').style.display = layer === 'objectives' ? 'block' : 'none';
    document.getElementById('scenes-panel').style.display = layer === 'scenes' ? 'block' : 'none';

    // Symmetry only relevant for painting layers
    const showSymmetry = ['terrain', 'resources', 'spawns', 'buildings', 'units', 'objectives'].includes(layer);
    document.getElementById('symmetry-panel').style.display = showSymmetry ? 'block' : 'none';

    // Set default modes for each layer
    if (layer === 'buildings') {
      window.forge.setBuildingMode('place');
      // Ensure the current building button is active
      if (window.forge.state.currentBuilding) {
        window.forge.setBuilding(window.forge.state.currentBuilding);
      }
    } else if (layer === 'units') {
      window.forge.setUnitMode('place');
    } else if (layer === 'objectives') {
      window.forge.setObjectiveMode('place');
    }

    // Update chunk grid overlay visibility
    window.forge.updateChunkGridOverlay(layer === 'table');

    // Show spawn markers when editing spawns
    window.forge.updateSpawnMarkers();

    // Show unit markers when editing units
    window.forge.updateUnitMarkers();

    // Show objective markers when editing objectives
    window.forge.updateObjectiveMarkers();

    // Enable objective view by default when entering objectives layer
    if (layer === 'objectives') {
      window.forge._objectiveViewVisible = true;
      const objViewBtn = document.getElementById('vis-objectives');
      if (objViewBtn) objViewBtn.classList.add('active');
      window.forge.showObjectivePreview();
    } else {
      window.forge.hideObjectivePreview();
    }

    // Show brush preview when entering terrain layer
    if (layer === 'terrain') {
      window.forge.showBrushPreview();
    } else {
      window.forge.hideBrushPreview();
    }

    // Clear objective selection when leaving objectives layer
    if (layer !== 'objectives') {
      window.forge.state.selectedObjectiveIndex = -1;
      window.forge.clearObjectiveForm();
    }

    // Scenes layer setup/teardown
    if (layer === 'scenes') {
      window.forge.state.scenePickMode = null;
      window.forge.updateSceneList();
      window.forge.updateSceneEditor();
      window.forge.updateSceneTriggerMarkers();
    } else {
      if (window.forge._sceneTriggerMarkers) {
        window.forge._sceneTriggerMarkers.forEach(m => m.dispose());
        window.forge._sceneTriggerMarkers = [];
      }
    }

    // Refresh grid if it's currently visible (to show appropriate overlay for new layer)
    if (window.forge._resourceGridVisible) {
      window.forge.showResourceGrid();
    }
    
    // Clear building preview when leaving building mode
    if (layer !== 'buildings') {
      window.forge.clearBuildingPreview();
    }

    // Update technical info when file panel is shown
    if (layer === 'file') {
      window.forge.updateTechnicalInfo();
    }

    console.log(`📐 Editing layer: ${layer}`);
  };

  // Update technical information display
  forge.updateTechnicalInfo = function() {
    const field = window.liveField;
    if (!field) return;

    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    const totalChunks = chunksX * chunksZ;
    const enabledChunks = Array.from(field.chunkMask.values()).filter(Boolean).length;

    const terrainTiles = field.width * field.height;
    const placedResources = this._placedResources ? this._placedResources.size : 0;
    const spawns = this.state.spawns ? this.state.spawns.length : 0;
    const buildings = this.state.buildings ? this.state.buildings.length : 0;
    const startingUnits = this.state.startingUnits ? this.state.startingUnits.length : 0;
    const objectives = this.state.objectives ? this.state.objectives.length : 0;

    const info = document.getElementById('technical-info');
    if (info) {
      info.innerHTML = `
        <div>Size: ${field.width} × ${field.height} (${terrainTiles} tiles)</div>
        <div>Seed: ${field.seed}</div>
        <div>Chunks: ${enabledChunks}/${totalChunks} enabled</div>
        <div>Resources: ${placedResources} placed</div>
        <div>Spawns: ${spawns}</div>
        <div>Buildings: ${buildings}</div>
        <div>Starting Units: ${startingUnits}</div>
        <div>Objectives: ${objectives}</div>
        ${this.state.importedFilename ? `<div>Imported: ${this.state.importedFilename}</div>` : ''}
      `;
    }
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
  
  // Toggle blocked tiles grid overlay
  forge._blockedGridVisible = false;
  forge._blockedGridOverlay = [];

  // Brush size preview overlay
  forge._brushPreviewVisible = false;
  forge._brushPreviewOverlay = null;

  // Objective radius preview overlay
  forge._objectivePreviewVisible = false;
  forge._objectivePreviewOverlay = null;

  // Toggle objective view overlay
  forge._objectiveViewVisible = false;
  
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

  forge.toggleObjectiveView = function() {
    this._objectiveViewVisible = !this._objectiveViewVisible;

    const btn = document.getElementById('vis-objectives');
    if (btn) {
      btn.classList.toggle('active', this._objectiveViewVisible);
    }

    if (this._objectiveViewVisible) {
      this.updateObjectiveMarkers();
    } else {
      // Hide objective markers
      if (this._objectiveMarkers) {
        this._objectiveMarkers.forEach(m => m.dispose());
      }
      this._objectiveMarkers = [];
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
  
  // Toggle game type compatibility
  forge.toggleGameType = function(type) {
    this.state.gameTypes[type] = !this.state.gameTypes[type];
    console.log(`🎮 Game type ${type}: ${this.state.gameTypes[type] ? 'enabled' : 'disabled'}`);
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

})(window.forge);
