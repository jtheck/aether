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
    this.buildings = []; // Always initialize buildings array
    this.isAI = options.isAI !== false; // Default to AI for single-player
    this.difficulty = options.difficulty || 'normal';
    this.isRemote = !this.isAI;
    
    console.log(`🤖 AI ${this.name} initialized with resources:`, this.resources);
    
    // Spawn position (agora/base location)
    this.agora = options.agora || { x: 85, y: 85 }; // Default to opposite corner from player
    this.basePosition = options.basePosition || { x: this.agora.x, z: this.agora.y };
    
    // Multiplayer prediction state
    this.predictionBuffer = [];
    this.lastKnownState = null;
    this.stateSyncTick = 0;
    
    // AI-specific properties
    this.aiStrategy = options.aiStrategy || 'balanced'; // Default to balanced (builds + attacks)
    this.aiTargets = [];
    
    console.log(`👤 Created opponent ${this.name} (${this.isAI ? 'AI' : 'Remote'}) at (${this.agora.x}, ${this.agora.y}) - Strategy: ${this.aiStrategy}, Difficulty: ${this.difficulty}, Color: ${this.color.primary || this.color}`);
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
  
  // AI State Machine & Strategic Planning
  function getAIState(aiPlayer) {
    if (!aiPlayer._aiState) {
      aiPlayer._aiState = {
        phase: 'early', // early, mid, late
        strategy: aiPlayer.aiStrategy,
        economyScore: 0,
        militaryScore: 0,
        territoryScore: 0,
        lastScoutTime: 0,
        buildQueue: [],
        trainQueue: [],
        knownEnemyUnits: [],
        knownEnemyBuildings: [],
        resourcePriority: 'food', // food, wood, stone, balanced
        attackPlanned: false,
        attackTimer: 0,
        defenseMode: false
      };
    }
    return aiPlayer._aiState;
  }
  
  // Make AI decision (called periodically) - NOW WITH BIG BRAIN 🧠
  function makeAIDecision(aiPlayer) {
    const resources = aiPlayer.getResources();
    const unitCount = aiPlayer.units.length;
    const buildingCount = aiPlayer.buildings ? aiPlayer.buildings.length : 0;
    const aiState = getAIState(aiPlayer);
    const currentTick = window.currentMatch?.tick || 0;
    
    // Update game phase based on time and economy
    updateGamePhase(aiPlayer, aiState, currentTick);
    
    // Scout and gather intelligence
    updateIntelligence(aiPlayer, aiState);
    
    // Evaluate threats and opportunities
    const threat = evaluateThreat(aiPlayer, aiState);
    const opportunity = evaluateOpportunity(aiPlayer, aiState);
    
    console.log(`🧠 AI ${aiPlayer.name} [${aiState.phase}] - Buildings: ${buildingCount}, Units: ${unitCount}, Eco: ${aiState.economyScore.toFixed(1)}, Mil: ${aiState.militaryScore.toFixed(1)}, Threat: ${threat.toFixed(1)}`);
    
    // High-level strategic decisions
    if (threat > 0.7) {
      aiState.defenseMode = true;
      console.log(`🛡️ AI entering DEFENSE MODE!`);
    } else if (threat < 0.3 && aiState.defenseMode) {
      aiState.defenseMode = false;
      console.log(`⚔️ AI exiting defense mode`);
    }
    
    // Execute multi-step build order based on phase and difficulty
    const actions = [];
    
    // ECONOMIC DECISIONS
    if (shouldExpandEconomy(aiPlayer, aiState, resources)) {
      const ecoAction = getEconomicAction(aiPlayer, aiState, resources, buildingCount, unitCount);
      if (ecoAction) actions.push(ecoAction);
    }
    
    // MILITARY DECISIONS
    if (shouldBuildMilitary(aiPlayer, aiState, resources, threat)) {
      const milAction = getMilitaryAction(aiPlayer, aiState, resources, buildingCount, unitCount);
      if (milAction) actions.push(milAction);
    }
    
    // TACTICAL DECISIONS - Manage existing units
    manageMilitaryUnits(aiPlayer, aiState, threat, opportunity);
    manageWorkerUnits(aiPlayer, aiState, resources);
    
    // Execute queued actions (respecting difficulty-based timing)
    const maxActionsPerTick = getDifficultySpeed(aiPlayer);
    for (let i = 0; i < Math.min(actions.length, maxActionsPerTick); i++) {
      executeAIAction(aiPlayer, actions[i]);
    }
  }
  
  // Update game phase (early/mid/late game)
  function updateGamePhase(aiPlayer, aiState, currentTick) {
    const gameTime = (currentTick * 50) / 1000; // seconds
    const buildingCount = aiPlayer.buildings ? aiPlayer.buildings.length : 0;
    
    if (gameTime > 600 || buildingCount > 10) {
      aiState.phase = 'late';
    } else if (gameTime > 180 || buildingCount > 4) {
      aiState.phase = 'mid';
    } else {
      aiState.phase = 'early';
    }
    
    // Calculate scores
    const villagerCount = aiPlayer.units.filter(u => u.type === 'villager').length;
    const militaryCount = aiPlayer.units.filter(u => u.category === 'military').length;
    
    aiState.economyScore = (villagerCount * 2) + (buildingCount * 3) + (aiPlayer.resources.food / 50);
    aiState.militaryScore = militaryCount * 3 + (aiPlayer.resources.stone / 30);
  }
  
  // Update intelligence about enemy
  function updateIntelligence(aiPlayer, aiState) {
    if (!window.player) return;
    
    // Scan for visible enemy units and buildings
    aiState.knownEnemyUnits = window.player.units.filter(u => u.pb && u.pb.state);
    aiState.knownEnemyBuildings = window.gameBuildings ? 
      window.gameBuildings.filter(b => b.owner === window.player?.id && b.position) : [];
  }
  
  // Evaluate current threat level (0-1)
  function evaluateThreat(aiPlayer, aiState) {
    let threatScore = 0;
    
    // Count enemy military units near our base
    const basePos = aiPlayer.basePosition;
    if (!basePos) return 0;
    
    aiState.knownEnemyUnits.forEach(enemy => {
      if (!enemy.pb || !enemy.pb.state) return;
      
      const dx = enemy.pb.state.loc.x - basePos.x;
      const dz = enemy.pb.state.loc.z - basePos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      // Closer enemies = higher threat
      if (distance < 30) {
        threatScore += enemy.category === 'military' ? 0.3 : 0.1;
      } else if (distance < 60) {
        threatScore += enemy.category === 'military' ? 0.1 : 0.02;
      }
    });
    
    return Math.min(1, threatScore);
  }
  
  // Evaluate opportunities for attack (0-1)
  function evaluateOpportunity(aiPlayer, aiState) {
    if (!window.player) return 0;
    
    const ourMilitary = aiPlayer.units.filter(u => u.category === 'military').length;
    const theirMilitary = window.player.units.filter(u => u.category === 'military').length;
    
    // We have military advantage?
    if (ourMilitary > theirMilitary * 1.5) {
      return 0.8;
    } else if (ourMilitary > theirMilitary) {
      return 0.5;
    }
    
    return 0.2;
  }
  
  // Should AI expand economy?
  function shouldExpandEconomy(aiPlayer, aiState, resources) {
    const villagerCount = aiPlayer.units.filter(u => u.type === 'villager').length;
    
    // Always need economy in early game
    if (aiState.phase === 'early') return true;
    
    // Mid/late game - balance with military
    const militaryCount = aiPlayer.units.filter(u => u.category === 'military').length;
    const ratio = militaryCount > 0 ? villagerCount / militaryCount : villagerCount;
    
    // Want roughly 2:1 villagers to military
    return ratio < 2 && resources.food > 30;
  }
  
  // Should AI build military?
  function shouldBuildMilitary(aiPlayer, aiState, resources, threat) {
    // Always build military if threatened
    if (threat > 0.5) return true;
    
    // In late game, always maintain military
    if (aiState.phase === 'late') return true;
    
    // Mid game with good economy
    if (aiState.phase === 'mid' && aiState.economyScore > 15) return true;
    
    // Early game - only if strategy is aggressive
    return aiState.strategy === 'aggressive' && aiState.economyScore > 8;
  }
  
  // Get economic action (building or training)
  function getEconomicAction(aiPlayer, aiState, resources, buildingCount, unitCount) {
    const villagerCount = aiPlayer.units.filter(u => u.type === 'villager').length;
    const campCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'camp').length : 0;
    const farmCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'farm').length : 0;
    const villageCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'village').length : 0;
    
    // Priority 1: Build camps for resource gathering (need 2-3)
    if (campCount < 2 && resources.wood >= 30 && resources.stone >= 10) {
      return {type: 'build', buildingType: 'camp', priority: 'high'};
    }
    
    // Priority 2: Build villages to spawn more villagers (need 1-2)
    if (villageCount < 1 && buildingCount >= 1 && resources.wood >= 30 && resources.stone >= 10) {
      return {type: 'build', buildingType: 'village', priority: 'high'};
    }
    
    // Priority 3: Build farms for food production (need 2-3)
    if (farmCount < 2 && buildingCount >= 2 && resources.wood >= 20 && resources.stone >= 10) {
      return {type: 'build', buildingType: 'farm', priority: 'medium'};
    }
    
    // Priority 4: Build more camps if we have many workers
    if (campCount < 3 && villagerCount > 8 && resources.wood >= 30 && resources.stone >= 10) {
      return {type: 'build', buildingType: 'camp', priority: 'medium'};
    }
    
    // Priority 5: Train villagers (based on difficulty)
    const maxVillagers = aiPlayer.difficulty === 'hard' ? 20 : (aiPlayer.difficulty === 'normal' ? 12 : 8);
    if (villagerCount < maxVillagers && resources.food >= 50) {
      return {type: 'train', unitType: 'villager', priority: 'medium'};
    }
    
    return null;
  }
  
  // Get military action
  function getMilitaryAction(aiPlayer, aiState, resources, buildingCount, unitCount) {
    const militaryCount = aiPlayer.units.filter(u => u.category === 'military').length;
    
    // Build towers for defense
    const towerCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'tower').length : 0;
    if (towerCount < 1 && buildingCount >= 3 && resources.wood >= 50 && resources.stone >= 40) {
      return {type: 'build', buildingType: 'tower', priority: 'high'};
    }
    
    // Build more towers if in defense mode
    if (aiState.defenseMode && towerCount < 2 && resources.wood >= 50 && resources.stone >= 40) {
      return {type: 'build', buildingType: 'tower', priority: 'high'};
    }
    
    // Train military units directly (no barracks needed - agora trains them)
    if (buildingCount >= 2 && resources.food >= 75) {
      const unitType = chooseMilitaryUnit(aiPlayer, aiState);
      return {type: 'train', unitType: unitType, priority: 'medium'};
    }
    
    return null;
  }
  
  // Choose which military unit to train
  function chooseMilitaryUnit(aiPlayer, aiState) {
    // Difficulty affects unit variety
    if (aiPlayer.difficulty === 'hard') {
      // Hard AI uses advanced units
      if (Math.random() < 0.3) return 'wizard';
      if (Math.random() < 0.5) return 'monk';
      return 'brigand';
    } else if (aiPlayer.difficulty === 'normal') {
      // Normal AI uses mix
      if (Math.random() < 0.3) return 'monk';
      return 'brigand';
    } else {
      // Easy AI uses basic units
      if (Math.random() < 0.3) return 'frog_scout';
      return 'villager'; // Easy mode trains villagers as "military"
    }
  }
  
  // Manage military units tactically
  function manageMilitaryUnits(aiPlayer, aiState, threat, opportunity) {
    const militaryUnits = aiPlayer.units.filter(u => u.category === 'military');
    
    if (aiState.defenseMode || threat > 0.5) {
      // DEFEND: Pull military back to base
      defendBase(aiPlayer, militaryUnits);
    } else if (opportunity > 0.6 && !aiState.attackPlanned) {
      // ATTACK: Launch coordinated attack
      launchAttack(aiPlayer, aiState, militaryUnits);
    } else {
      // PATROL: Maintain defensive positions
      patrolTerritory(aiPlayer, militaryUnits);
    }
  }
  
  // Defend base from attackers
  function defendBase(aiPlayer, militaryUnits) {
    const basePos = aiPlayer.basePosition;
    if (!basePos) return;
    
    militaryUnits.forEach(unit => {
      if (!unit.pb || !unit.pb.state) return;
      
      // Find nearest enemy
      const nearestEnemy = findNearestEnemy(unit, basePos, 40); // Within 40 units
      
      if (nearestEnemy && window.behaviorManager) {
        // Move to intercept
        window.behaviorManager.setBehavior(unit, 'run', {
          targetPoint: { x: nearestEnemy.pb.state.loc.x, z: nearestEnemy.pb.state.loc.z }
        });
      } else {
        // Return to base if no enemies nearby
        const dx = unit.pb.state.loc.x - basePos.x;
        const dz = unit.pb.state.loc.z - basePos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > 20) {
          window.behaviorManager.setBehavior(unit, 'walk', {
            targetPoint: { x: basePos.x, z: basePos.z }
          });
        }
      }
    });
  }
  
  // Launch coordinated attack
  function launchAttack(aiPlayer, aiState, militaryUnits) {
    if (militaryUnits.length < 3) return; // Need minimum force
    
    // Find enemy base or nearest building
    const targetPos = findAttackTarget(aiPlayer);
    if (!targetPos) return;
    
    console.log(`⚔️ AI LAUNCHING ATTACK with ${militaryUnits.length} units!`);
    aiState.attackPlanned = true;
    aiState.attackTimer = (window.currentMatch?.tick || 0) + 600; // Attack for 30 seconds
    
    // Send all military units to attack position
    militaryUnits.forEach((unit, index) => {
      if (!unit.pb || !unit.pb.state || !window.behaviorManager) return;
      
      // Spread units out slightly for better formation
      const angle = (index / militaryUnits.length) * Math.PI * 2;
      const offsetX = Math.cos(angle) * 5;
      const offsetZ = Math.sin(angle) * 5;
      
      window.behaviorManager.setBehavior(unit, 'run', {
        targetPoint: { 
          x: targetPos.x + offsetX, 
          z: targetPos.z + offsetZ 
        }
      });
    });
  }
  
  // Find target for attack
  function findAttackTarget(aiPlayer) {
    if (!window.player) return null;
    
    const basePos = aiPlayer.basePosition;
    
    // Target nearest enemy building
    if (window.gameBuildings) {
      const enemyBuildings = window.gameBuildings.filter(b => b.owner === window.player?.id && b.position);
      if (enemyBuildings.length > 0) {
        // Find nearest building
        let nearest = enemyBuildings[0];
        let nearestDist = Infinity;
        
        enemyBuildings.forEach(building => {
          const dx = building.position.x - basePos.x;
          const dz = building.position.z - basePos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = building;
          }
        });
        
        return nearest.position;
      }
    }
    
    // Fallback: target player's base
    return window.player.basePosition || {x: 0, z: 0};
  }
  
  // Patrol territory when idle
  function patrolTerritory(aiPlayer, militaryUnits) {
    const basePos = aiPlayer.basePosition;
    if (!basePos) return;
    
    militaryUnits.forEach((unit, index) => {
      if (!unit.pb || !unit.pb.state || !window.behaviorManager) return;
      
      // Check if unit already has a behavior
      const currentBehavior = window.behaviorManager.getBehavior(unit);
      if (currentBehavior && !currentBehavior.isComplete()) return; // Already moving
      
      // Patrol in a circle around base
      const patrolRadius = 25;
      const angle = ((window.currentMatch?.tick || 0) * 0.01 + index) % (Math.PI * 2);
      const patrolX = basePos.x + Math.cos(angle) * patrolRadius;
      const patrolZ = basePos.z + Math.sin(angle) * patrolRadius;
      
      window.behaviorManager.setBehavior(unit, 'walk', {
        targetPoint: { x: patrolX, z: patrolZ }
      });
    });
  }
  
  // Find nearest enemy unit
  function findNearestEnemy(unit, centerPos, maxDistance) {
    if (!window.player || !window.player.units) return null;
    
    let nearest = null;
    let nearestDist = maxDistance;
    
    window.player.units.forEach(enemy => {
      if (!enemy.pb || !enemy.pb.state) return;
      
      const dx = enemy.pb.state.loc.x - centerPos.x;
      const dz = enemy.pb.state.loc.z - centerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    });
    
    return nearest;
  }
  
  // Manage worker units (villagers)
  function manageWorkerUnits(aiPlayer, aiState, resources) {
    const villagers = aiPlayer.units.filter(u => u.type === 'villager');
    
    villagers.forEach(villager => {
      if (!villager.pb || !villager.pb.state) return;
      
      // Check if already assigned to a building
      if (villager.assignedBuilding) return;
      
      // Find nearest camp and assign worker
      const camps = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'camp') : [];
      if (camps.length > 0) {
        // Find camp with fewest workers
        let bestCamp = camps[0];
        let minWorkers = bestCamp.assignedWorkers ? bestCamp.assignedWorkers.length : 0;
        
        camps.forEach(camp => {
          const workerCount = camp.assignedWorkers ? camp.assignedWorkers.length : 0;
          if (workerCount < minWorkers) {
            minWorkers = workerCount;
            bestCamp = camp;
          }
        });
        
        // Assign worker to camp
        if (minWorkers < 3 && window.behaviorManager) { // Max 3 workers per camp
          assignWorkerToBuilding(villager, bestCamp);
        }
      }
    });
  }
  
  // Assign worker to building
  function assignWorkerToBuilding(worker, building) {
    if (!building.assignedWorkers) building.assignedWorkers = [];
    building.assignedWorkers.push(worker);
    worker.assignedBuilding = building;
    
    // Set gather behavior
    if (window.behaviorManager) {
      window.behaviorManager.setBehavior(worker, 'gather_work', {
        building: building
      });
    }
  }
  
  // Get AI speed based on difficulty
  function getDifficultySpeed(aiPlayer) {
    switch (aiPlayer.difficulty) {
      case 'easy': return 1; // 1 action per decision
      case 'normal': return 2; // 2 actions per decision
      case 'hard': return 3; // 3 actions per decision
      default: return 1;
    }
  }
  
  // Execute AI action
  function executeAIAction(aiPlayer, action) {
    switch (action.type) {
      case 'build':
        // Find suitable build location near base
        const buildPos = findBuildLocation(aiPlayer);
        console.log(`🏗️ AI attempting to build ${action.buildingType} at (${buildPos.x}, ${buildPos.z})`);
        
        if (!window.placeBuilding) {
          console.warn(`❌ window.placeBuilding not available!`);
          break;
        }
        if (!window.gfx || !window.gfx.scene) {
          console.warn(`❌ window.gfx.scene not available!`);
          break;
        }
        
        if (buildPos) {
          // Actually spawn the building using the building system
          const building = window.placeBuilding(action.buildingType, buildPos.x, buildPos.z, window.gfx.scene);
          
          if (building) {
            // Set AI ownership
            building.owner = aiPlayer.id;
            
            // CRITICAL: Detect resources for camps!
            if (action.buildingType === 'camp' && window.buildingSystem && window.buildingSystem.checkTileForResources) {
              const workRadius = (window.BuildingTypes && window.BuildingTypes.camp && window.BuildingTypes.camp.workRadius) || 2;
              const radiusInTiles = Math.ceil(workRadius * (window.TILE_SIZE || 4));
              
              const detectedResources = [];
              const gridRadius = Math.ceil(radiusInTiles / (window.TILE_SIZE || 4));
              
              for (let x = buildPos.x - gridRadius; x <= buildPos.x + gridRadius; x++) {
                for (let z = buildPos.z - gridRadius; z <= buildPos.z + gridRadius; z++) {
                  const worldX = x * (window.TILE_SIZE || 4);
                  const worldZ = z * (window.TILE_SIZE || 4);
                  const campWorldX = buildPos.x * (window.TILE_SIZE || 4);
                  const campWorldZ = buildPos.z * (window.TILE_SIZE || 4);
                  const distance = Math.sqrt(
                    Math.pow(worldX - campWorldX, 2) + 
                    Math.pow(worldZ - campWorldZ, 2)
                  );
                  
                  if (distance <= radiusInTiles) {
                    const resourceInfo = window.buildingSystem.checkTileForResources(x, z);
                    if (resourceInfo) {
                      detectedResources.push({
                        gridX: x,
                        gridZ: z,
                        worldX: worldX,
                        worldZ: worldZ,
                        type: resourceInfo.type,
                        amount: resourceInfo.amount
                      });
                    }
                  }
                }
              }
              
              if (detectedResources.length > 0) {
                building.availableResources = detectedResources;
                console.log(`🤖 AI camp detected ${detectedResources.length} resource tiles`);
              } else {
                console.warn(`⚠️ AI camp at (${buildPos.x}, ${buildPos.z}) found NO resources!`);
              }
            }
            
            // Add to AI's building list
            if (!aiPlayer.buildings) aiPlayer.buildings = [];
            aiPlayer.buildings.push(building);
            
            // Deduct resources
            deductResources(aiPlayer, getBuildCost(action.buildingType));
            
            console.log(`✅ AI ${aiPlayer.name} built ${action.buildingType} at (${buildPos.x}, ${buildPos.z}), now has ${aiPlayer.buildings.length} buildings`);
          } else {
            console.warn(`❌ placeBuilding returned null for ${action.buildingType}`);
          }
        }
        break;
      
      case 'train':
        // Spawn unit at base
        const spawnPos = aiPlayer.basePosition || {x: 0, y: 0, z: 0};
        const unit = aiPlayer.addUnit(action.unitType, spawnPos);
        if (unit) {
          // Deduct resources
          deductResources(aiPlayer, getUnitCost(action.unitType));
          
          // Set unit to idle - let auto-work handle it
          unit.state = 'idle';
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
    // Let units stay idle - they'll auto-work (villagers gather, military defend)
    // Don't force them to move around
    return;
  };
  
  // Give AI unit initial orders
  function giveAIUnitOrders(unit, strategy) {
    // Villagers should gather resources near their base
    if (unit.type === 'villager') {
      // Don't move - they'll auto-gather when idle
      unit.state = 'idle';
    } else if (unit.category === 'military') {
      // Military units patrol near base (don't rush center)
      unit.state = 'idle';
    }
  };
  
  // Helper functions for AI
  function findBuildLocation(player) {
    // Find empty tile near player base
    // agora is in grid coordinates, basePosition might be in world coords
    const baseGridX = player.agora ? player.agora.x : (player.basePosition ? Math.floor(player.basePosition.x / (window.TILE_SIZE || 4)) : 0);
    const baseGridZ = player.agora ? player.agora.y : (player.basePosition ? Math.floor(player.basePosition.z / (window.TILE_SIZE || 4)) : 0);
    
    // Try to place building near base (within 8-15 tiles away)
    const distance = 8 + Math.floor(Math.random() * 7); // 8-15 tiles away
    const angle = Math.random() * Math.PI * 2; // Random direction
    
    const gridX = Math.floor(baseGridX + Math.cos(angle) * distance);
    const gridZ = Math.floor(baseGridZ + Math.sin(angle) * distance);
    
    // Make sure it's within map bounds
    const field = window.liveField;
    if (field) {
      const clampedX = Math.max(5, Math.min(field.width - 5, gridX));
      const clampedZ = Math.max(5, Math.min(field.height - 5, gridZ));
      return { x: clampedX, z: clampedZ };
    }
    
    return { x: gridX, z: gridZ };
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
    // Define building costs (matches BuildingTypes in buildings.js)
    const costs = {
      camp: {wood: 30, stone: 10},
      village: {wood: 30, stone: 10},
      farm: {wood: 20, stone: 10},
      tower: {wood: 50, stone: 40},
      agora: {wood: 50, stone: 100}
    };
    return costs[buildingType] || {wood: 30, stone: 10};
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
    unit.aiBehavior = 'idle';
    unit.aiTarget = null;
    unit.lastDecisionTick = 0;
    unit.state = 'idle'; // Start idle, let auto-work take over
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
