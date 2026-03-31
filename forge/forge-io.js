// Forge Import/Export Module
(function(forge) {
  'use strict';

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
    
    // Generate thumbnail (64x64 preview)
    const thumbnail = this.generateThumbnail(field, 64);
    
    const mapData = {
      v: 2,  // Version 2 = new format
      n: this.state.mapName || `Map ${field.seed}`,  // Map name
      au: this.state.mapAuthor || undefined,         // Author
      desc: this.state.mapDescription || undefined,  // Description
      lore: this.state.mapLore || undefined,         // Lore/backstory
      tod: this.state.timeOfDay !== undefined ? Math.round(this.state.timeOfDay * 100) / 100 : undefined,  // Time of day (0-1)
      w: field.width,
      h: field.height,
      s: field.seed,
      cs: field.chunkSize,
      t: terrainRLE,           // RLE-compressed terrain
      cm: chunkBits.join(''),  // Chunk mask as binary string "11101110..."
      ta: this.encodeTileAtlas(field.tiles),  // Tile atlas info
      th: thumbnail,           // Base64 thumbnail
      r: placedResources.length > 0 ? placedResources.join(';') : undefined,  // Placed resources
      er: this._erasedAutoResources && this._erasedAutoResources.size > 0
          ? Array.from(this._erasedAutoResources).join(';') : undefined,  // Erased auto-resources
      nar: this._noAutoResources ? 1 : undefined,  // No auto-resources flag (set by Clear All)
      // Map metadata
      sp: this.state.spawnPoints.length > 0
          ? this.state.spawnPoints.map((s, i) => `${s.x},${s.y},${s.team !== undefined ? s.team : i},${s.owner || 'player'},${s.agora ? 1 : 0},${s.villagers ? 1 : 0}`).join(';') : undefined,
      bld: this.state.buildings.length > 0
          ? this.state.buildings.map(b => `${b.x},${b.y},${b.type},${(b.rotation || 0).toFixed(2)},${b.player ?? -1}`).join(';') : undefined,  // Buildings (x,y,type,rotation,player)
      obj: this.state.objectives.length > 0
          ? this.state.objectives.map(o => {
              // Base64 encode message to avoid issues with special characters
              const encodedMsg = o.message ? btoa(encodeURIComponent(o.message)) : '';
              return `${o.x},${o.y},${o.radius},${o.type},${encodedMsg}`;
            }).join(';') : undefined,  // Objectives with messages
      ow: this.state.objectiveWinMode === 'all' ? 'all' : undefined,
      units: this.state.startingUnits.length > 0
          ? this.state.startingUnits.map(u => {
              const n = (u.name && String(u.name).trim()) ? btoa(encodeURIComponent(u.name.trim())) : '';
              return `${u.x},${u.y},${u.type},${u.player}${n ? ',' + n : ''}`;
            }).join(';') : undefined,  // Starting units (optional 5th field: base64 name)
      gt: Object.entries(this.state.gameTypes)
          .filter(([k, v]) => v).map(([k]) => k).join(',') || '1v1',  // Game types
      sc: this.state.scenes.length > 0
          ? btoa(encodeURIComponent(JSON.stringify(this.state.scenes))) : undefined  // Scenes
    };
    
    const json = JSON.stringify(mapData);
    const compressed = this.compressString(json);
    
    console.log(`📦 Map exported: ${(json.length / 1024).toFixed(1)} KB → ${(compressed.length / 1024).toFixed(1)} KB`);
    
    // Trigger download with .garden extension
    const blob = new Blob([compressed], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Use imported filename as base, or map name, or fallback to seed
    let filename = field.seed.toString();
    if (this.state.importedFilename) {
      // Remove extension and add 'n' suffix as requested
      filename = this.state.importedFilename.replace(/\.[^/.]+$/, '') + 'n';
    } else if (this.state.mapName) {
      filename = this.state.mapName.replace(/[^a-zA-Z0-9-_]/g, '_');
    }

    a.download = `${filename}.garden`;
    a.click();
    URL.revokeObjectURL(url);
    
    return mapData;
  };
  
  // Generate a small thumbnail preview of the map
  forge.generateThumbnail = function(field, size = 64) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, size, size);
    
    const scaleX = size / field.width;
    const scaleZ = size / field.height;
    
    // Terrain colors
    const terrainColors = {
      0: '#4a7c59', // Grass
      1: '#2d4a6f', // Water
      2: '#8b7355', // Dirt
      3: '#6b6b6b'  // Rock
    };
    
    // Draw terrain
    for (let z = 0; z < field.height; z++) {
      for (let x = 0; x < field.width; x++) {
        const index = z * field.width + x;
        const terrainType = field.terrainTypes[index];
        
        // Check if this tile is in an enabled chunk
        if (field.chunkMask && field.chunkSize) {
          const chunkX = Math.floor(x / field.chunkSize);
          const chunkZ = Math.floor(z / field.chunkSize);
          if (field.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
            continue; // Skip disabled chunks
          }
        }
        
        ctx.fillStyle = terrainColors[terrainType] || terrainColors[0];
        ctx.fillRect(
          Math.floor(x * scaleX),
          Math.floor(z * scaleZ),
          Math.ceil(scaleX) + 1,
          Math.ceil(scaleZ) + 1
        );
      }
    }
    
    // Draw spawn points as bright dots
    if (this.state.spawnPoints) {
      ctx.fillStyle = '#ffcc00';
      this.state.spawnPoints.forEach(sp => {
        const px = Math.floor(sp.x * scaleX);
        const pz = Math.floor(sp.y * scaleZ);
        ctx.beginPath();
        ctx.arc(px, pz, Math.max(2, size / 20), 0, Math.PI * 2);
        ctx.fill();
      });
    }
    
    // Return as base64 (strip data URL prefix to save space)
    return canvas.toDataURL('image/png').replace('data:image/png;base64,', '');
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

    this.clearHistory();

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
        const expectedLen = chunksX * chunksZ;
        // Pad truncated masks with '0' (disable missing chunks rather than leaving them undefined)
        const cm = mapData.cm.length < expectedLen
          ? mapData.cm.padEnd(expectedLen, '0')
          : mapData.cm;
        let i = 0;
        for (let cz = 0; cz < chunksZ; cz++) {
          for (let cx = 0; cx < chunksX; cx++) {
            chunkMask.set(`${cx},${cz}`, cm[i] === '1');
            i++;
          }
        }
      }
      console.log(`📥 Importing .garden map: ${width}x${height}`);
      
      // Restore map metadata to UI
      this.state.mapName = mapData.n || '';
      this.state.mapAuthor = mapData.au || '';
      this.state.mapDescription = mapData.desc || '';
      this.state.mapLore = mapData.lore || '';
      
      const nameInput = document.getElementById('map-name');
      const authorInput = document.getElementById('map-author');
      const descInput = document.getElementById('map-desc');
      const loreInput = document.getElementById('map-lore');
      if (nameInput) nameInput.value = this.state.mapName;
      if (authorInput) authorInput.value = this.state.mapAuthor;
      if (descInput) descInput.value = this.state.mapDescription;
      if (loreInput) loreInput.value = this.state.mapLore;
      
      // Restore time of day
      if (mapData.tod !== undefined) {
        this.setTimeOfDay(mapData.tod);
        const timeSlider = document.getElementById('time-slider');
        if (timeSlider) timeSlider.value = mapData.tod * 100;
      }
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
        field.tiles[i].updateAtlasCoordinates();
      }
    }
    
    // Apply chunk mask if present
    if (chunkMask) {
      field.chunkMask = chunkMask;
    }
    
    // Determine whether to place auto-resources
    this._noAutoResources = !!mapData.nar;
    const includeAutoResources = !this._noAutoResources;
    
    // Pre-mark erased auto-resources as depleted BEFORE loading chunks,
    // so placeDecorationsOnChunk skips them (avoids async race condition)
    if (mapData.er && includeAutoResources) {
      this._erasedAutoResources = new Set(mapData.er.split(';'));
      for (const key of this._erasedAutoResources) {
        const [gx, gz] = key.split(',').map(Number);
        if (window.markResourceTileDepleted) {
          window.markResourceTileDepleted(gx, gz);
        }
      }
      console.log(`🗑️ Pre-marked ${this._erasedAutoResources.size} erased resource tiles`);
    } else {
      this._erasedAutoResources = new Set();
    }
    
    // Load chunks and rebuild table
    this.loadAllChunks(includeAutoResources);
    this.rebuildTable();
    
    // Restore manually placed resources (v2 format)
    if (mapData.r) {
      this._placedKeys = new Set();
      this._placedResources = new Map();
      this._resourceFootprints = new Map();

      // Disable symmetry during import to prevent phantom mirror copies
      const savedSymmetry = this._currentSymmetry;
      this._currentSymmetry = 'none';

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

      this._currentSymmetry = savedSymmetry;
      console.log(`🌲 Restored ${resources.length} placed resources`);
    }
    
    // Restore spawn points (v2 format)
    if (mapData.sp) {
      this.state.spawnPoints = mapData.sp.split(';').map(s => {
        const parts = s.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const team = Number(parts[2]) || 0;
        const owner = parts[3] || 'player';
        const agora = parts[4] === '1' || (!parts[4] && owner === 'npc');
        const villagers = parts[5] === '1' || (!parts[5] && owner === 'npc');
        return { x, y, team, owner, agora, villagers };
      });
      this.updateSpawnMarkers();
      this.updateSpawnList();
      console.log(`🚩 Restored ${this.state.spawnPoints.length} spawn points`);
    } else {
      this.state.spawnPoints = [];
    }
    
    // Restore buildings (v2 format) – clear existing building meshes first so import is in sync
    this.disposeAllBuildingMeshesFromScene?.();
    if (mapData.bld) {
      const bldParts = mapData.bld.split(';').filter(s => s && s.trim());
      this.state.buildings = bldParts.map(b => {
        const parts = b.split(',');
        return {
          x: Number(parts[0]),
          y: Number(parts[1]),
          type: (parts[2] && parts[2].trim()) || 'agora',
          rotation: Number(parts[3]) || 0,
          player: parts[4] !== undefined ? Number(parts[4]) : -1
        };
      });
      this.updateBuildingMarkers();
      console.log(`🏗️ Restored ${this.state.buildings.length} buildings`);
    } else {
      this.state.buildings = [];
    }
    
    // Restore objectives (v2 format)
    if (mapData.obj) {
      this.state.objectives = mapData.obj.split(';').map((o, i) => {
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
          message: message,
          id: i
        };
      });
      this.updateObjectiveMarkers();
      this.updateObjectiveList();
      console.log(`🎯 Restored ${this.state.objectives.length} objectives`);
    } else {
      this.state.objectives = [];
      this._objectiveMarkers?.forEach(m => m.dispose());
      this._objectiveMarkers = [];
    }

    this.state.objectiveWinMode = mapData.ow === 'all' ? 'all' : 'default';
    const winSel = document.getElementById('obj-win-mode');
    if (winSel) winSel.value = this.state.objectiveWinMode === 'all' ? 'all' : 'default';
    
    // Restore starting units (v2 format)
    if (mapData.units) {
      this.state.startingUnits = mapData.units.split(';').map(u => {
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
          name: name || ''
        };
      });
      this.updateUnitMarkers();
      this.updateStartingUnitsList();
      console.log(`⚔️ Restored ${this.state.startingUnits.length} starting units`);
    } else {
      this.state.startingUnits = [];
      this._unitMarkers?.forEach(m => m.dispose());
      this._unitMarkers = [];
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

    // Legacy: migrate old global spAgora/spVillagers flags to per-spawn
    if (mapData.spAgora || mapData.spVillagers) {
      this.state.spawnPoints.forEach(sp => {
        if (mapData.spAgora) sp.agora = true;
        if (mapData.spVillagers) sp.villagers = true;
      });
    }

    // Restore scenes (v2 format)
    if (mapData.sc) {
      try {
        this.state.scenes = JSON.parse(decodeURIComponent(atob(mapData.sc)));
        this.state.scenes.forEach((s, i) => s.id = i);
        console.log(`🎬 Restored ${this.state.scenes.length} scenes`);
      } catch (e) {
        console.warn('Failed to decode scenes:', e);
        this.state.scenes = [];
      }
    } else {
      this.state.scenes = [];
    }
    this.state.selectedSceneIndex = -1;
    this.state.selectedStepIndex = -1;

    // Apply visibility settings and compute blocked tiles after async model loading
    setTimeout(() => { this.applyLayerVisibility(); this.refreshBlockedTiles(); }, 100);
    setTimeout(() => { this.applyLayerVisibility(); this.refreshBlockedTiles(); }, 500);
    setTimeout(() => this.refreshBlockedTiles(), 2000);

    console.log('✅ Map imported');
  };
  
  // Handle file import (.aether or .json)
  forge.handleImport = function(file) {
    if (!file) return;

    // Store filename for export recommendations
    this.state.importedFilename = file.name;

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

})(window.forge);
