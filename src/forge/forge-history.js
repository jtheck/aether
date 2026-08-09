// Forge History Module - Undo/Redo system
(function(forge) {
  'use strict';

  const MAX_HISTORY = 50;

  forge._undoStack = [];
  forge._redoStack = [];
  forge._currentAction = null;

  // Begin recording a new undoable action.
  // All recordChange() calls until commitAction() are grouped together.
  forge.beginAction = function(type, label) {
    if (this._currentAction) return;
    this._currentAction = {
      type: type,
      label: label || type,
      changes: [],
      _seen: new Set()
    };
  };

  // Record a single change within the current action.
  // For terrain: { kind:'tile', index, oldTerrainType, newTerrainType, oldTileType, oldAtlasName, newTileType, newAtlasName }
  // For entities: { kind:'spawn_add'|'spawn_remove'|..., data:{...} }
  forge.recordChange = function(change) {
    if (!this._currentAction) return;

    // Deduplicate terrain tile changes within the same action
    if (change.kind === 'tile') {
      const key = change.index;
      if (this._currentAction._seen.has(key)) return;
      this._currentAction._seen.add(key);
    }

    this._currentAction.changes.push(change);
  };

  // Finalize the current action and push it to the undo stack.
  // Clears the redo stack (new action invalidates redo history).
  forge.commitAction = function() {
    if (!this._currentAction) return;
    if (this._currentAction.changes.length === 0) {
      this._currentAction = null;
      return;
    }

    // Strip internal bookkeeping before storing
    delete this._currentAction._seen;

    this._undoStack.push(this._currentAction);
    if (this._undoStack.length > MAX_HISTORY) {
      this._undoStack.shift();
    }
    this._redoStack.length = 0;
    this._currentAction = null;
    this._updateHistoryUI();
  };

  // Discard the current in-progress action without saving.
  forge.cancelAction = function() {
    this._currentAction = null;
  };

  // Wipe both stacks (called on new map generation / import).
  forge.clearHistory = function() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._currentAction = null;
    this._updateHistoryUI();
  };

  // -------------------------------------------------------
  // Undo / Redo
  // -------------------------------------------------------

  forge.undo = function() {
    if (this._undoStack.length === 0) return;
    const action = this._undoStack.pop();
    this._applyAction(action, true);
    this._redoStack.push(action);
    this._updateHistoryUI();
  };

  forge.redo = function() {
    if (this._redoStack.length === 0) return;
    const action = this._redoStack.pop();
    this._applyAction(action, false);
    this._undoStack.push(action);
    this._updateHistoryUI();
  };

  // -------------------------------------------------------
  // Apply an action (forward or reverse)
  // -------------------------------------------------------

  forge._applyAction = function(action, reverse) {
    const field = window.liveField;
    if (!field) return;

    const changes = reverse ? [...action.changes].reverse() : action.changes;
    const affectedChunks = new Set();

    for (const c of changes) {
      switch (c.kind) {
        case 'tile': {
          const tt = reverse ? c.oldTerrainType : c.newTerrainType;
          const tileType = reverse ? c.oldTileType : c.newTileType;
          const atlasName = reverse ? c.oldAtlasName : c.newAtlasName;

          field.terrainTypes[c.index] = tt;
          if (field.tiles[c.index]) {
            field.tiles[c.index].type = tileType;
            field.tiles[c.index].atlasName = atlasName;
            if (field.tiles[c.index].updateAtlasCoordinates) {
              field.tiles[c.index].updateAtlasCoordinates();
            }
          }
          const x = c.index % field.width;
          const z = Math.floor(c.index / field.width);
          affectedChunks.add(`${Math.floor(x / field.chunkSize)},${Math.floor(z / field.chunkSize)}`);
          break;
        }

        case 'building_add': {
          if (reverse) {
            this._undoRemoveBuilding(c.data);
          } else {
            this._redoAddBuilding(c.data);
          }
          break;
        }

        case 'building_remove': {
          if (reverse) {
            this._redoAddBuilding(c.data);
          } else {
            this._undoRemoveBuilding(c.data);
          }
          break;
        }

        case 'spawn_add': {
          if (reverse) {
            this._removeSpawnByData(c.data);
          } else {
            this._addSpawnByData(c.data);
          }
          // Terrain changes from flattening are recorded as separate 'tile' changes
          break;
        }

        case 'spawn_remove': {
          if (reverse) {
            this._addSpawnByData(c.data);
          } else {
            this._removeSpawnByData(c.data);
          }
          break;
        }

        case 'objective_add': {
          if (reverse) {
            const idx = this.state.objectives.findIndex(o => o.x === c.data.x && o.y === c.data.y);
            if (idx >= 0) this.state.objectives.splice(idx, 1);
          } else {
            this.state.objectives.push({...c.data});
          }
          this.state.objectives.forEach((o, i) => o.id = i);
          break;
        }

        case 'objective_remove': {
          if (reverse) {
            this.state.objectives.splice(c.data.id, 0, {...c.data});
          } else {
            const idx = this.state.objectives.findIndex(o => o.x === c.data.x && o.y === c.data.y);
            if (idx >= 0) this.state.objectives.splice(idx, 1);
          }
          this.state.objectives.forEach((o, i) => o.id = i);
          break;
        }

        case 'unit_add': {
          if (reverse) {
            const idx = this.state.startingUnits.findIndex(u =>
              u.x === c.data.x && u.y === c.data.y && u.type === c.data.type && u.player === c.data.player
            );
            if (idx >= 0) this.state.startingUnits.splice(idx, 1);
          } else {
            this.state.startingUnits.push({...c.data});
          }
          break;
        }

        case 'unit_remove': {
          if (reverse) {
            this.state.startingUnits.push({...c.data});
          } else {
            const idx = this.state.startingUnits.findIndex(u =>
              u.x === c.data.x && u.y === c.data.y
            );
            if (idx >= 0) this.state.startingUnits.splice(idx, 1);
          }
          break;
        }

        case 'unit_update': {
          const idx = this.state.startingUnits.findIndex(u =>
            u.x === c.data.x && u.y === c.data.y
          );
          if (idx >= 0) {
            if (reverse) {
              this.state.startingUnits[idx].type = c.data.oldType;
              this.state.startingUnits[idx].player = c.data.oldPlayer;
              if (c.data.oldName !== undefined) this.state.startingUnits[idx].name = c.data.oldName;
            } else {
              this.state.startingUnits[idx].type = c.data.newType;
              this.state.startingUnits[idx].player = c.data.newPlayer;
              if (c.data.newName !== undefined) this.state.startingUnits[idx].name = c.data.newName;
            }
          }
          break;
        }

        case 'resource_add': {
          if (reverse) {
            this._undoRemoveResource(c.data);
          } else {
            this._redoAddResource(c.data);
          }
          break;
        }

        case 'resource_remove': {
          if (reverse) {
            this._redoAddResource(c.data);
          } else {
            this._undoRemoveResource(c.data);
          }
          break;
        }
      }
    }

    // Rebuild terrain chunks if any tiles changed
    if (affectedChunks.size > 0) {
      this.rebuildChunks(affectedChunks);
    }

    // Refresh all entity visuals
    if (action.type === 'spawn' || action.type === 'spawn_remove') {
      this.updateSpawnMarkers();
      this.updateSpawnList();
    }
    if (action.type === 'objective' || action.type === 'objective_remove') {
      this.updateObjectiveMarkers();
      this.updateObjectiveList();
    }
    if (action.type === 'unit' || action.type === 'unit_remove') {
      this.updateUnitMarkers();
      this.updateStartingUnitsList();
    }
    if (action.type === 'building' || action.type === 'building_remove') {
      this.updateBuildingMarkers();
      this.updateBuildingList();
    }
  };

  // -------------------------------------------------------
  // Helper functions for entity undo/redo
  // -------------------------------------------------------

  forge._addSpawnByData = function(data) {
    this.state.spawnPoints.push({x: data.x, y: data.y, team: data.team});
  };

  forge._removeSpawnByData = function(data) {
    const idx = this.state.spawnPoints.findIndex(s =>
      Math.abs(s.x - data.x) <= 1 && Math.abs(s.y - data.y) <= 1
    );
    if (idx >= 0) this.state.spawnPoints.splice(idx, 1);
  };

  forge._undoRemoveBuilding = function(data) {
    const field = window.liveField;
    // Remove from state + blocked tiles + dispose mesh
    const key = `${data.x},${data.y}`;
    if (this._buildingMeshes && this._buildingMeshes.has(key)) {
      this._buildingMeshes.get(key).dispose();
      this._buildingMeshes.delete(key);
    }
    const idx = this.state.buildings.findIndex(b => b.x === data.x && b.y === data.y);
    if (idx >= 0) {
      const buildingDef = window.BuildingTypes?.[data.type];
      if (field && field.blockedTiles && buildingDef) {
        const w = buildingDef.size?.width || 1;
        const h = buildingDef.size?.height || 1;
        for (let bx = 0; bx < w; bx++) {
          for (let bz = 0; bz < h; bz++) {
            field.blockedTiles.delete(`${data.x + bx},${data.y + bz}`);
          }
        }
      }
      this.state.buildings.splice(idx, 1);
    }
  };

  forge._redoAddBuilding = function(data) {
    const field = window.liveField;
    if (!field || !gfx || !gfx.scene) return;
    const saved = this.state.currentBuilding;
    this.state.currentBuilding = data.type;
    this._placeBuildingAtSingle({x: data.x, y: data.y}, 0);
    this.state.currentBuilding = saved;
    // Fix rotation in state - mesh will read it from state when model loads
    const bld = this.state.buildings.find(b => b.x === data.x && b.y === data.y);
    if (bld) bld.rotation = data.rotation;
  };

  forge._undoRemoveResource = function(data) {
    // Remove placed resource at position
    const key = `${data.x},${data.y}`;
    if (this._placedResources && this._placedResources.has(key)) {
      const mesh = this._placedResources.get(key);
      if (mesh && mesh.dispose) mesh.dispose();
      this._placedResources.delete(key);
    }
    if (this._resourceFootprints) {
      const footprintKeys = this._resourceFootprints.get(key);
      if (footprintKeys) {
        footprintKeys.forEach(k => this._placedKeys && this._placedKeys.delete(k));
        this._resourceFootprints.delete(key);
      }
    }
  };

  forge._redoAddResource = function(data) {
    // Re-place a resource
    const saved = this.state.currentResource;
    this.state.currentResource = data.type;
    this._placeResourceAtSingle({x: data.x, y: data.y});
    this.state.currentResource = saved;
  };

  // -------------------------------------------------------
  // UI update
  // -------------------------------------------------------

  forge._updateHistoryUI = function() {
    const undoBtn = document.getElementById('forge-undo-btn');
    const redoBtn = document.getElementById('forge-redo-btn');
    if (undoBtn) {
      undoBtn.disabled = this._undoStack.length === 0;
      undoBtn.title = this._undoStack.length > 0
        ? `Undo: ${this._undoStack[this._undoStack.length - 1].label} (${this._undoStack.length})`
        : 'Nothing to undo';
    }
    if (redoBtn) {
      redoBtn.disabled = this._redoStack.length === 0;
      redoBtn.title = this._redoStack.length > 0
        ? `Redo: ${this._redoStack[this._redoStack.length - 1].label} (${this._redoStack.length})`
        : 'Nothing to redo';
    }
  };

})(window.forge);
