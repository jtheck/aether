// Opponent Management System
// Handles both AI opponents (single-player) and remote players (multiplayer)

(function(opponent) {
  // Base Opponent class
  function Opponent(options = {}) {
    this.id = options.id || 'opponent';
    this.name = options.name || 'Opponent';
    this.color = options.color || {primary: '#0066cc', secondary: '#004499'};
    this.resources = options.startingResources || {food: 100, wood: 50, stone: 25, magic: 10};
    this.units = [];
    this.buildings = [];
    this.isAI = options.isAI !== false; // Default to AI for single-player
    this.difficulty = options.difficulty || 'normal';
    this.isRemote = !this.isAI;
    
    // Spawn position (agora/base location)
    this.agora = options.agora || { x: 85, y: 85 }; // Default to opposite corner from player
    this.basePosition = options.basePosition || { x: this.agora.x, z: this.agora.y };
    
    // Multiplayer prediction state
    this.predictionBuffer = [];
    this.lastKnownState = null;
    this.stateSyncTick = 0;
    
    // AI-specific properties
    this.aiStrategy = options.aiStrategy || 'aggressive';
    this.aiTargets = [];
    
    console.log(`👤 Created opponent ${this.name} (${this.isAI ? 'AI' : 'Remote'}) at (${this.agora.x}, ${this.agora.y}) - Difficulty: ${this.difficulty}`);
  }
  
  // Get resources (mirror player interface)
  Opponent.prototype.getResources = function() {
    return this.resources;
  };
  
  // Add unit (ghost for remote, real for AI)
  Opponent.prototype.addUnit = function(unitType, position, options = {}) {
    const unitDef = window.UnitTypes[unitType];
    if (!unitDef) {
      console.warn(`Unknown unit type: ${unitType}`);
      return null;
    }
    
    const unit = new window.Unit(unitType, position, {
      ...options,
      owner: this.id,
      isGhost: this.isRemote // Ghost units for remote players (visual only)
    });
    
    this.units.push(unit);
    window.gameUnits.push(unit);
    
    if (this.isRemote) {
      // Create ghost mesh for remote unit
      createGhostUnitMesh(unit);
    } else {
      // AI unit - full behavior
      initializeAIUnit(unit);
    }
    
    return unit;
  };
  
  // Remove unit
  Opponent.prototype.removeUnit = function(unitId) {
    const index = this.units.findIndex(u => u.id === unitId);
    if (index > -1) {
      const unit = this.units[index];
      if (unit.mesh) unit.mesh.dispose();
      this.units.splice(index, 1);
      // Remove from global units too
      const globalIndex = window.gameUnits.findIndex(u => u.id === unitId);
      if (globalIndex > -1) {
        window.gameUnits.splice(globalIndex, 1);
      }
      console.log(`🗑️ Removed opponent unit ${unitId}`);
    }
  };
  
  // Update opponent state (called from network reconciliation)
  Opponent.prototype.updateState = function(stateData, currentTick) {
    this.lastKnownState = stateData;
    this.stateSyncTick = currentTick;
    
    // Update resources
    if (stateData.resources) {
      this.resources = {...stateData.resources};
    }
    
    // Update units with prediction/reconciliation
    if (stateData.units) {
      stateData.units.forEach(remoteUnit => {
        let unit = this.units.find(u => u.id === remoteUnit.id);
        
        if (!unit) {
          // New unit - create ghost
          unit = this.addUnit(remoteUnit.type, remoteUnit.pos, {
            id: remoteUnit.id,
            health: remoteUnit.health,
            state: remoteUnit.state
          });
        } else {
          // Update existing unit
          reconcileUnit(unit, remoteUnit, currentTick);
        }
      });
      
      // Remove units not in remote state
      this.units = this.units.filter(unit => 
        stateData.units.some(remote => remote.id === unit.id)
      );
    }
    
    // Update buildings
    if (stateData.buildings) {
      // Similar logic for buildings...
      updateOpponentBuildings(this, stateData.buildings);
    }
  };
  
  // AI-specific update (single-player only)
  Opponent.prototype.updateAI = function(deltaTime) {
    if (!this.isAI || window.isMultiplayer) return;
    
    // Simple AI logic
    switch (this.difficulty) {
      case 'easy':
        this.aiStrategy = 'defensive';
        break;
      case 'normal':
        this.aiStrategy = 'balanced';
        break;
      case 'hard':
        this.aiStrategy = 'aggressive';
        break;
    }
    
    // AI decision making every second
    const currentTick = (window.currentMatch && typeof window.currentMatch.tick === 'number')
      ? window.currentMatch.tick
      : 0;
    const tickRate = (window.net && window.net.TICK_RATE) ? window.net.TICK_RATE : 20;
    const ticksPerSecond = Math.max(1, tickRate);
    const secondsBetweenDecisions = 1;
    const decisionIntervalTicks = secondsBetweenDecisions * ticksPerSecond;
    
    if (decisionIntervalTicks > 0) {
      if (!this._lastDecisionTick || currentTick - this._lastDecisionTick >= decisionIntervalTicks) {
        makeAIDecision(this);
        this._lastDecisionTick = currentTick;
      }
    }
    
    // Update AI units
    this.units.forEach(unit => {
      updateAIUnit(unit, deltaTime);
    });
  };
  
  // Remote player prediction (smooth movement)
  Opponent.prototype.predictMovement = function() {
    if (!this.isRemote) return;
    
    this.units.forEach(unit => {
      if (unit.isGhost && unit.predictedPath) {
        // Follow predicted path
        const nextWaypoint = unit.predictedPath.shift();
        if (nextWaypoint) {
          // Lerp to waypoint
          const alpha = 0.1; // Smooth interpolation
          unit.pb.state.loc.x += (nextWaypoint.x - unit.pb.state.loc.x) * alpha;
          unit.pb.state.loc.z += (nextWaypoint.z - unit.pb.state.loc.z) * alpha;
        }
      }
    });
  };
  
  // ==================== AI IMPLEMENTATION ====================
  
  // Make AI decision (called periodically)
  function makeAIDecision(aiPlayer) {
    const resources = aiPlayer.getResources();
    const unitCount = aiPlayer.units.length;
    
    // Resource priorities based on strategy
    let action;
    switch (aiPlayer.aiStrategy) {
      case 'defensive':
        if (resources.food > 50 && unitCount < 5) {
          action = {type: 'build', buildingType: 'farm'};
        } else if (resources.wood > 100) {
          action = {type: 'train', unitType: 'villager'};
        }
        break;
      case 'balanced':
        if (resources.food > 75) {
          action = {type: 'train', unitType: Math.random() > 0.7 ? 'villager' : 'frog_scout'};
        } else {
          action = {type: 'gather', resourceType: 'food'};
        }
        break;
      case 'aggressive':
        if (resources.food > 100 && unitCount < 10) {
          action = {type: 'train', unitType: 'brigand'};
        } else {
          action = {type: 'attack', targetPlayer: 'player'};
        }
        break;
    }
    
    if (action) {
      executeAIAction(aiPlayer, action);
    }
  };
  
  // Execute AI action
  function executeAIAction(aiPlayer, action) {
    switch (action.type) {
      case 'build':
        // Find suitable build location near base
        const buildPos = findBuildLocation(aiPlayer);
        if (buildPos) {
          aiPlayer.buildings.push({
            type: action.buildingType,
            position: buildPos,
            health: 100,
            owner: aiPlayer.id
          });
          // Deduct resources
          deductResources(aiPlayer, getBuildCost(action.buildingType));
        }
        break;
      
      case 'train':
        // Spawn unit at base
        const spawnPos = aiPlayer.basePosition || {x: 0, y: 0, z: 0};
        const unit = aiPlayer.addUnit(action.unitType, spawnPos);
        if (unit) {
          // Deduct resources
          deductResources(aiPlayer, getUnitCost(action.unitType));
          
          // Give AI unit orders
          setTimeout(() => giveAIUnitOrders(unit, aiPlayer.aiStrategy), 1000);
        }
        break;
      
      case 'gather':
        // Send villager to nearest resource
        const nearestResource = findNearestResource(aiPlayer);
        if (nearestResource) {
          const villager = aiPlayer.units.find(u => u.type === 'villager' && u.state === 'idle');
          if (villager) {
            window.resources.gather(villager, nearestResource);
          }
        }
        break;
      
      case 'attack':
        // Aggressive attack
        const attackTarget = findWeakestEnemyUnit();
        aiPlayer.units
          .filter(u => u.category === 'military' && u.state === 'idle')
          .forEach(unit => {
            if (attackTarget) {
              window.combat.attack(unit, attackTarget);
            }
          });
        break;
    }
  };
  
  // AI unit behavior
  function updateAIUnit(unit, deltaTime) {
    if (unit.state !== 'idle') return;
    
    // Simple state machine
    const aiPlayer = unit.owner === 'opponent' ? window.opponent : null;
    if (!aiPlayer) return;
    
    // Wander or patrol based on strategy
    switch (aiPlayer.aiStrategy) {
      case 'defensive':
        // Stay near base
        patrolNearBase(unit);
        break;
      case 'aggressive':
        // Scout/attack
        scoutForEnemies(unit);
        break;
      default:
        // Balanced - mix of both
        if (Math.random() < 0.7) {
          patrolNearBase(unit);
        } else {
          scoutForEnemies(unit);
        }
    }
  };
  
  // Give AI unit initial orders
  function giveAIUnitOrders(unit, strategy) {
    if (strategy === 'aggressive' && unit.category === 'military') {
      // Attack move toward player base
      const playerBase = window.player.basePosition || {x: 0, z: 0};
      window.pathfinding.moveUnit(unit, playerBase);
    } else if (unit.type === 'villager') {
      // Find nearest resource
      const nearestResource = findNearestResource(unit.owner === 'opponent' ? window.opponent : window.player);
      if (nearestResource) {
        window.resources.gather(unit, nearestResource);
      }
    }
  };
  
  // Helper functions for AI
  function findBuildLocation(player) {
    // Find empty tile near player base (simplified)
    const baseX = player.basePosition?.x || 0;
    const baseZ = player.basePosition?.z || 0;
    return {
      x: baseX + (Math.random() - 0.5) * 10,
      z: baseZ + (Math.random() - 0.5) * 10
    };
  };
  
  function findNearestResource(player) {
    // Find closest uneaten resource (implement based on your resource system)
    return window.resources?.find(r => !r.beingGathered && 
      Math.abs(r.position.x - player.basePosition.x) < 20 &&
      Math.abs(r.position.z - player.basePosition.z) < 20
    );
  };
  
  function findWeakestEnemyUnit() {
    // Find player unit with lowest health
    return window.player.units.find(u => u.currentHealth < u.health * 0.5);
  };
  
  function patrolNearBase(unit) {
    // Simple patrol pattern around base
    const baseX = unit.owner === 'opponent' ? window.opponent.basePosition?.x : window.player.basePosition?.x;
    const baseZ = unit.owner === 'opponent' ? window.opponent.basePosition?.z : window.player.basePosition?.z;
    
    const patrolPoints = [
      {x: baseX + 5, z: baseZ},
      {x: baseX - 5, z: baseZ},
      {x: baseX, z: baseZ + 5},
      {x: baseX, z: baseZ - 5}
    ];
    
    const nextPoint = patrolPoints[Math.floor(Math.random() * patrolPoints.length)];
    window.pathfinding.moveUnit(unit, nextPoint);
  };
  
  function scoutForEnemies(unit) {
    // Move toward random unexplored area or known enemies
    const exploreArea = {
      x: (Math.random() - 0.5) * 100,
      z: (Math.random() - 0.5) * 100
    };
    window.pathfinding.moveUnit(unit, exploreArea);
  };
  
  function deductResources(player, cost) {
    Object.keys(cost).forEach(resource => {
      if (player.resources[resource] !== undefined) {
        player.resources[resource] = Math.max(0, player.resources[resource] - cost[resource]);
      }
    });
  };
  
  function getUnitCost(unitType) {
    const def = window.UnitTypes[unitType];
    return def ? def.cost : {food: 25};
  };
  
  function getBuildCost(buildingType) {
    // Define building costs
    const costs = {
      farm: {food: 50, wood: 20},
      barracks: {wood: 100, stone: 50},
      // Add more building types
    };
    return costs[buildingType] || {food: 100, wood: 50};
  };
  
  // ==================== REMOTE PLAYER IMPLEMENTATION ====================
  
  // Reconcile remote unit with authoritative state
  function reconcileUnit(unit, remoteData, currentTick) {
    // Position reconciliation with smoothing
    const posError = Math.sqrt(
      Math.pow(remoteData.pos.x - unit.pb.state.loc.x, 2) +
      Math.pow(remoteData.pos.z - unit.pb.state.loc.z, 2)
    );
    
    if (posError > 2.0) { // Significant error - snap
      unit.pb.state.loc.x = remoteData.pos.x;
      unit.pb.state.loc.z = remoteData.pos.z;
      console.log(`🔧 Snapped unit ${unit.id} to authoritative position`);
    } else if (posError > 0.5) { // Minor error - lerp
      const alpha = 0.2;
      unit.pb.state.loc.x += (remoteData.pos.x - unit.pb.state.loc.x) * alpha;
      unit.pb.state.loc.z += (remoteData.pos.z - unit.pb.state.loc.z) * alpha;
    }
    
    // Health and state sync
    if (Math.abs(remoteData.health - unit.currentHealth) > 1) {
      unit.currentHealth = remoteData.health;
    }
    
    unit.state = remoteData.state;
    
    // Clear prediction buffer if reconciled
    if (unit.predictedPath) {
      unit.predictedPath = [];
    }
  };
  
  // Create ghost unit mesh (visual representation for remote units)
  function createGhostUnitMesh(unit) {
    if (!unit.type || !window.UnitTypes[unit.type]) return;
    
    const def = window.UnitTypes[unit.type];
    const scale = def.scale || 0.5;
    
    // Load simplified model or use placeholder box
    if (def.model && def.model.endsWith('.glb')) {
      // Load GLB for ghost (lower LOD)
      BABYLON.SceneLoader.ImportMeshAsync(
        "",
        def.model,
        "",
        window.gfx.scene
      ).then((result) => {
        unit.mesh = result.meshes[0];
        if (unit.mesh) {
          unit.mesh.scaling = new BABYLON.Vector3(scale, scale, scale);
          unit.mesh.position = new BABYLON.Vector3(
            unit.pb.state.loc.x,
            unit.pb.state.loc.y,
            unit.pb.state.loc.z
          );
          unit.mesh.material = createGhostMaterial(unit);
          unit.mesh.isPickable = false; // Can't select ghost units
          
          // Lower LOD for ghosts
          unit.mesh.lodDistance = 50; // Switch to billboard sooner
        }
      });
    } else {
      // Fallback: colored box
      unit.mesh = BABYLON.MeshBuilder.CreateBox(
        `ghost_${unit.id}`,
        {size: 1},
        window.gfx.scene
      );
      unit.mesh.scaling = new BABYLON.Vector3(scale, scale, scale);
      unit.mesh.position = new BABYLON.Vector3(
        unit.pb.state.loc.x,
        unit.pb.state.loc.y,
        unit.pb.state.loc.z
      );
      unit.mesh.material = createGhostMaterial(unit);
      unit.mesh.isPickable = false;
    }
  };
  
  // Create ghost material (semi-transparent, opponent-colored)
  function createGhostMaterial(unit) {
    const material = new BABYLON.StandardMaterial(`ghostMat_${unit.id}`, window.gfx.scene);
    material.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.8); // Blue tint
    material.alpha = 0.8; // Slightly transparent
    material.disableLighting = true; // Always visible
    return material;
  };
  
  // Update opponent buildings from remote state
  function updateOpponentBuildings(opponent, buildingData) {
    buildingData.forEach(remoteBuilding => {
      let building = opponent.buildings.find(b => b.id === remoteBuilding.id);
      
      if (!building) {
        // New building - create ghost
        building = createGhostBuilding(remoteBuilding);
        opponent.buildings.push(building);
        window.buildings.push(building); // Add to global list
      } else {
        // Update existing
        building.position.x = remoteBuilding.pos.x;
        building.position.z = remoteBuilding.pos.z;
        building.health = remoteBuilding.health || 100;
        
        // Update mesh position
        if (building.mesh) {
          building.mesh.position.x = remoteBuilding.pos.x;
          building.mesh.position.z = remoteBuilding.pos.z;
          
          // Health-based coloring
          const healthPct = building.health / 100;
          if (building.mesh.material) {
            building.mesh.material.diffuseColor = new BABYLON.Color3(
              0.3 + (0.5 * healthPct), // Red component based on health
              0.3 * healthPct,         // Green fades with damage
              0.8                      // Always blue tint
            );
          }
        }
      }
    });
    
    // Remove destroyed buildings
    opponent.buildings = opponent.buildings.filter(b => 
      buildingData.some(remote => remote.id === b.id)
    );
  };
  
  // Initialize AI unit behavior
  function initializeAIUnit(unit) {
    // Set AI-specific properties
    unit.aiBehavior = 'patrol';
    unit.aiTarget = null;
    unit.lastDecisionTick = 0;
    
    // Give initial orders
    if (window.opponent) {
      giveAIUnitOrders(unit, window.opponent.aiStrategy);
    }
  };
  
  // Export classes
  window.OpponentPlayer = Opponent;
  window.Opponent = opponent; // Legacy support
  
  // AI Player subclass (for single-player)
  function AIPlayer(options) {
    Opponent.call(this, {
      ...options,
      isAI: true,
      difficulty: options.difficulty || 'normal'
    });
    
    // AI-specific initialization
    this.basePosition = options.basePosition || {x: -20, z: -20}; // Opposite side of map
    this.aiTimer = 0;
    
    // Start AI thinking loop
    this.startAITimer();
  }
  
  AIPlayer.prototype = Object.create(Opponent.prototype);
  AIPlayer.prototype.constructor = AIPlayer;
  
  // AI-specific methods
  AIPlayer.prototype.startAITimer = function() {
    // DEPRECATED: AI now runs deterministically in the match tick system (match.js)
    // This prevents desync in multiplayer by having the host generate AI commands
    // that are broadcast to all clients via the command system
    // 
    // The timer-based system caused desync because:
    // - Each client's timer drifted differently
    // - AI made decisions at different real-time moments  
    // - Direct unit manipulation wasn't synced over network
    //
    // See: match.js generateAICommands() - called every 20 ticks (1 second)
    console.log('🤖 AI player created - commands will be generated by match tick system');
  };
  
  AIPlayer.prototype.updateAI = function(deltaTime) {
    Opponent.prototype.updateAI.call(this, deltaTime);
    
    // Additional AI logic for difficulty scaling
    if (this.difficulty === 'hard') {
      // More aggressive resource gathering
      this.units.filter(u => u.type === 'villager').forEach(villager => {
        if (villager.state === 'idle') {
          const resource = findNearestResource(this);
          if (resource) {
            window.resources.gather(villager, resource);
          }
        }
      });
    }
  };
  
  // Make AIPlayer available globally
  window.AIPlayer = AIPlayer;
  
})(window.opponent = window.opponent || {});
