// Opponent Management System
// Handles both AI opponents (single-player) and remote players (multiplayer)

(function(opponent) {
  // Base Opponent class
  function Opponent(options = {}) {
    this.id = options.id || 'opponent';
    this.name = options.name || 'Opponent';
    this.color = options.color || {primary: '#0066cc', secondary: '#004499'};
    this.resources = options.startingResources || {food: 100, wood: 100, stone: 25, magic: 5};
    this.units = [];
    this.buildings = []; // Always initialize buildings array
    this.isAI = options.isAI !== false; // Default to AI for single-player
    this.difficulty = options.difficulty || 'normal';
    this.isRemote = !this.isAI;
    
    // console.log(`🤖 AI ${this.name} initialized with resources:`, this.resources);
    
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
    
    // console.log(`👤 Created opponent ${this.name} (${this.isAI ? 'AI' : 'Remote'}) at (${this.agora.x}, ${this.agora.y}) - Strategy: ${this.aiStrategy}, Difficulty: ${this.difficulty}, Color: ${this.color.primary || this.color}`);
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
  
  // AI-specific update (works in both single-player and vs AI matches)
  Opponent.prototype.updateAI = function(deltaTime) {
    if (!this.isAI) return; // Only skip if NOT an AI player (remote players)
    
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
    const wasInDefenseMode = aiState.defenseMode;
    if (threat > 0.7) {
      aiState.defenseMode = true;
      if (!wasInDefenseMode) {
        console.log(`🛡️ AI entering DEFENSE MODE!`);
        
        // Check if agora is under attack and rally defenders
        const agoraBuilding = aiPlayer.buildings?.find(b => b && b.type === 'agora');
        if (agoraBuilding && agoraBuilding.contested && window.rallyUnitsToAgora) {
          console.log(`🚩 AI rallying defenders to contested agora!`);
          window.rallyUnitsToAgora(30, aiPlayer);
        }
      }
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
    
    // DEFENSE MODE: Rally defenders if agora is under attack
    if (aiState.defenseMode) {
      const agoraBuilding = aiPlayer.buildings?.find(b => b && b.type === 'agora');
      // Only rally periodically (every 5 seconds) to avoid spam
      const shouldCheckRally = !aiState.lastRallyCheck || (currentTick - aiState.lastRallyCheck) > 100; // 100 ticks = 5 seconds at 20 TPS
      if (agoraBuilding && agoraBuilding.contested && shouldCheckRally && window.rallyUnitsToAgora) {
        console.log(`🚩 AI rallying defenders to contested agora!`);
        window.rallyUnitsToAgora(30, aiPlayer);
        aiState.lastRallyCheck = currentTick;
      }
    }
    
    // Sort actions by priority (high > medium > low) to ensure essential buildings are built first
    const priorityOrder = { 'high': 0, 'medium': 1, 'low': 2 };
    actions.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] ?? 1;
      const bPriority = priorityOrder[b.priority] ?? 1;
      return aPriority - bPriority;
    });
    
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
    // Filter out null/undefined buildings and ensure type matches exactly
    const campCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'camp').length : 0;
    const farmCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'farm').length : 0;
    const villageCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'village').length : 0;
    
    // Get costs from BuildingTypes (use actual costs)
    const campCost = window.BuildingTypes?.camp?.cost || {wood: 5, stone: 0};
    const villageCost = window.BuildingTypes?.village?.cost || {wood: 25, stone: 0};
    const farmCost = window.BuildingTypes?.farm?.cost || {wood: 20, stone: 0};
    
    // Debug logging
    console.log(`🏗️ AI Building Decision: Camps=${campCount}, Villages=${villageCount}, Farms=${farmCount}, Wood=${resources.wood}, Stone=${resources.stone}`);
    
    // PHASE 1: Build one of each essential building first (camp -> village -> farm)
    // Priority 1: Build first camp for resource gathering
    // CRITICAL: Only build ONE camp, then MUST build village before any more camps
    if (campCount === 0 && resources.wood >= campCost.wood && resources.stone >= campCost.stone) {
      console.log(`✅ AI deciding to build FIRST camp`);
      return {type: 'build', buildingType: 'camp', priority: 'high'};
    }
    
    // Priority 2: Build first village to spawn villagers (after camp)
    // CRITICAL: Don't build more camps until we have at least one village!
    if (campCount >= 1 && villageCount === 0) {
      if (resources.wood >= villageCost.wood && resources.stone >= villageCost.stone) {
        console.log(`✅ AI deciding to build FIRST village (has ${campCount} camp(s))`);
        return {type: 'build', buildingType: 'village', priority: 'high'};
      } else {
        // SAVE UP: Don't build anything else if we're saving for village!
        console.log(`💰 AI SAVING UP for village - need ${villageCost.wood} wood (has ${resources.wood}), need ${villageCost.stone} stone (has ${resources.stone})`);
        return null; // Block all other building until we can afford village
      }
    }
    
    // Priority 3: Build first farm for food production (after village)
    // CRITICAL: Don't build more camps until we have at least one farm!
    if (villageCount >= 1 && farmCount === 0) {
      if (resources.wood >= farmCost.wood && resources.stone >= farmCost.stone) {
        console.log(`✅ AI deciding to build FIRST farm (has ${villageCount} village(s))`);
        return {type: 'build', buildingType: 'farm', priority: 'high'};
      } else {
        // SAVE UP: Don't build anything else if we're saving for farm!
        console.log(`💰 AI SAVING UP for farm - need ${farmCost.wood} wood (has ${resources.wood}), need ${farmCost.stone} stone (has ${resources.stone})`);
        return null; // Block all other building until we can afford farm
      }
    }
    
    // PHASE 2: After having one of each, build more flexibly
    // Priority 4: Build more villages if we need more villagers
    if (farmCount >= 1 && villageCount < 2 && villagerCount < 10 && resources.wood >= villageCost.wood && resources.stone >= villageCost.stone) {
      console.log(`✅ AI deciding to build additional village`);
      return {type: 'build', buildingType: 'village', priority: 'medium'};
    }
    
    // Priority 5: Build more farms if we need food
    if (farmCount >= 1 && farmCount < 3 && resources.wood >= farmCost.wood && resources.stone >= farmCost.stone) {
      console.log(`✅ AI deciding to build additional farm`);
      return {type: 'build', buildingType: 'farm', priority: 'medium'};
    }
    
    // Priority 6: Build more camps ONLY after we have at least one village AND one farm
    // CRITICAL BLOCK: Don't build more camps until we have BOTH village AND farm!
    if (campCount >= 1 && (villageCount === 0 || farmCount === 0)) {
      console.log(`⛔ AI BLOCKED from building more camps - need village=${villageCount === 0 ? 'NO' : 'YES'} and farm=${farmCount === 0 ? 'NO' : 'YES'}`);
      // Don't return null here - let it fall through to training villagers or return null at end
      // This ensures villages/farms can still be built even if we have camps
    } else if (farmCount >= 1 && villageCount >= 1 && campCount < 3 && villagerCount >= 8 && resources.wood >= campCost.wood && resources.stone >= campCost.stone) {
      console.log(`✅ AI deciding to build additional camp (has village=${villageCount}, farm=${farmCount}, villagers=${villagerCount})`);
      return {type: 'build', buildingType: 'camp', priority: 'low'};
    }
    
    // Priority 7: Train villagers (based on difficulty)
    const maxVillagers = aiPlayer.difficulty === 'hard' ? 20 : (aiPlayer.difficulty === 'normal' ? 12 : 8);
    if (villagerCount < maxVillagers && resources.food >= 50) {
      return {type: 'train', unitType: 'villager', priority: 'medium'};
    }
    
    return null;
  }
  
  // Get military action
  function getMilitaryAction(aiPlayer, aiState, resources, buildingCount, unitCount) {
    const militaryCount = aiPlayer.units.filter(u => u.category === 'military').length;
    
    // Get costs from BuildingTypes (use actual costs)
    const towerCost = window.BuildingTypes?.tower?.cost || {wood: 20, stone: 20};
    
    // Build towers if we have enough stone (after basic economy is set up)
    const towerCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'tower').length : 0;
    const campCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'camp').length : 0;
    const farmCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'farm').length : 0;
    const villageCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b.type === 'village').length : 0;
    
    // Build first tower if we have camp, village, and farm, and enough stone
    if (campCount >= 1 && villageCount >= 1 && farmCount >= 1 && towerCount < 1 && 
        resources.wood >= towerCost.wood && resources.stone >= towerCost.stone) {
      return {type: 'build', buildingType: 'tower', priority: 'high'};
    }
    
    // Build more towers if in defense mode or have excess stone
    if (towerCount < 2 && resources.wood >= towerCost.wood && resources.stone >= towerCost.stone && 
        (aiState.defenseMode || resources.stone >= 40)) {
      return {type: 'build', buildingType: 'tower', priority: 'medium'};
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
    // CRITICAL: Use deterministic selection based on current tick for multiplayer sync
    const currentTick = window.currentMatch?.tick || 0;
    const deterministicRandom = ((currentTick * 13 + 7) % 100) / 100; // 0-1 deterministic value
    
    if (aiPlayer.difficulty === 'hard') {
      // Hard AI uses advanced units
      if (deterministicRandom < 0.3) return 'wizard';
      if (deterministicRandom < 0.5) return 'monk';
      return 'brigand';
    } else if (aiPlayer.difficulty === 'normal') {
      // Normal AI uses mix
      if (deterministicRandom < 0.3) return 'monk';
      return 'brigand';
    } else {
      // Easy AI uses basic units
      if (deterministicRandom < 0.3) return 'frog_scout';
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
    if (!basePos || !window.currentMatch) return;
    
    militaryUnits.forEach(unit => {
      if (!unit.pb || !unit.pb.state) return;
      
      // Find nearest enemy
      const nearestEnemy = findNearestEnemy(unit, basePos, 40); // Within 40 units
      
      if (nearestEnemy) {
        // Attack nearest enemy
        window.currentMatch.submitCommand({
          type: 'attack',
          playerId: aiPlayer.id,
          unitIds: [unit.id],
          targetId: nearestEnemy.id
        });
      } else {
        // Return to base if no enemies nearby
        const dx = unit.pb.state.loc.x - basePos.x;
        const dz = unit.pb.state.loc.z - basePos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > 20) {
          const startPositions = {};
          if (unit.pb && unit.pb.state && unit.pb.state.loc) {
            startPositions[unit.id] = { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
          }
          window.currentMatch.submitCommand({
            type: 'move',
            playerId: aiPlayer.id,
            unitIds: [unit.id],
            startPositions: startPositions,
            target: { x: basePos.x, y: 0, z: basePos.z }
          });
        }
      }
    });
  }
  
  // Launch coordinated attack
  function launchAttack(aiPlayer, aiState, militaryUnits) {
    if (militaryUnits.length < 3 || !window.currentMatch) return; // Need minimum force
    
    // Find enemy base or nearest building
    const targetPos = findAttackTarget(aiPlayer);
    if (!targetPos) return;
    
    console.log(`⚔️ AI LAUNCHING ATTACK with ${militaryUnits.length} units!`);
    aiState.attackPlanned = true;
    aiState.attackTimer = (window.currentMatch?.tick || 0) + 600; // Attack for 30 seconds
    
    // Send all military units to attack position with formation
    const spacing = 2.5;
    const unitsPerRow = Math.ceil(Math.sqrt(militaryUnits.length));
    
    militaryUnits.forEach((unit, index) => {
      if (!unit.pb || !unit.pb.state) return;
      
      // Calculate formation offset
      const row = Math.floor(index / unitsPerRow);
      const col = index % unitsPerRow;
      const rowOffset = (row - (Math.ceil(militaryUnits.length / unitsPerRow) - 1) / 2) * spacing;
      const colOffset = (col - (unitsPerRow - 1) / 2) * spacing;
      
      const startPositions = {};
      if (unit.pb && unit.pb.state && unit.pb.state.loc) {
        startPositions[unit.id] = { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
      }
      window.currentMatch.submitCommand({
        type: 'move',
        playerId: aiPlayer.id,
        unitIds: [unit.id],
        startPositions: startPositions,
        target: { 
          x: targetPos.x + colOffset, 
          y: 0,
          z: targetPos.z + rowOffset 
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
    if (!basePos || !window.currentMatch) return;
    
    militaryUnits.forEach((unit, index) => {
      if (!unit.pb || !unit.pb.state) return;
      
      // Check if unit is idle or already reached destination
      const currentBehavior = window.behaviorManager?.getBehavior(unit);
      if (currentBehavior && !currentBehavior.isComplete()) return; // Already moving
      
      // Patrol in a circle around base
      const patrolRadius = 25;
      const angle = ((window.currentMatch.tick) * 0.01 + index) % (Math.PI * 2);
      const patrolX = basePos.x + Math.cos(angle) * patrolRadius;
      const patrolZ = basePos.z + Math.sin(angle) * patrolRadius;
      
      const startPositions = {};
      if (unit.pb && unit.pb.state && unit.pb.state.loc) {
        startPositions[unit.id] = { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
      }
      window.currentMatch.submitCommand({
        type: 'move',
        playerId: aiPlayer.id,
        unitIds: [unit.id],
        startPositions: startPositions,
        target: { x: patrolX, y: 0, z: patrolZ }
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
    if (!window.currentMatch) return;
    
    const villagers = aiPlayer.units.filter(u => u && u.type === 'villager');
    
    villagers.forEach(villager => {
      if (!villager.pb || !villager.pb.state) return;
      
      // Check if already assigned to a building
      if (villager.assignedBuilding) return;
      
      // Find nearest camp and assign worker
      const camps = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'camp') : [];
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
        
        // Assign worker to camp (max 3 workers per camp)
        if (minWorkers < 3) {
          // Mark as assigned locally (prevents reassignment spam)
          if (!bestCamp.assignedWorkers) bestCamp.assignedWorkers = [];
          bestCamp.assignedWorkers.push(villager);
          villager.assignedBuilding = bestCamp;
          
          // Submit work command through Match system
          window.currentMatch.submitCommand({
            type: 'work',
            playerId: aiPlayer.id,
            unitIds: [villager.id],
            buildingId: bestCamp.id
          });
        }
      }
    });
  }
  
  // REMOVED: assignWorkerToBuilding - now handled inline in manageWorkerUnits using command system
  
  // Get AI speed based on difficulty
  function getDifficultySpeed(aiPlayer) {
    switch (aiPlayer.difficulty) {
      case 'easy': return 1; // 1 action per decision
      case 'normal': return 2; // 2 actions per decision
      case 'hard': return 3; // 3 actions per decision
      default: return 1;
    }
  }
  
  // Execute AI action by submitting commands (uses same system as human players)
  function executeAIAction(aiPlayer, action) {
    // NEW ARCHITECTURE: Submit commands through Match system instead of direct manipulation
    // This ensures AI actions go through the same validation and synchronization as human commands
    
    if (!window.currentMatch) {
      console.warn('⚠️ Cannot execute AI action - no active match');
      return;
    }
    
    switch (action.type) {
      case 'build':
        // Find suitable build location near base
        const buildPos = findBuildLocation(aiPlayer);
        console.log(`🏗️ AI submitting build command for ${action.buildingType} at (${buildPos.x}, ${buildPos.z})`);
        
        if (buildPos) {
          // Calculate smart rotation like human players do
          let rotation = 0;
          if (window.buildingSystem && window.buildingSystem.findBestRotation) {
            // Use the building system's smart rotation logic
            rotation = window.buildingSystem.findBestRotation(buildPos.x, buildPos.z);
            
            // For multiplayer determinism, if it returned 0, use deterministic rotation based on position
            if (window.isMultiplayer && rotation === 0) {
              // Deterministic rotation based on grid position (snap to 90-degree increments)
              // This ensures determinism while still varying by position
              const rotationIndex = ((buildPos.x * 7 + buildPos.z * 11) % 4); // Deterministic but varies by position
              rotation = rotationIndex * (Math.PI / 2); // 0, 90, 180, or 270 degrees
            }
          } else {
            // Fallback: deterministic rotation based on position for multiplayer, random for single player
            if (window.isMultiplayer) {
              const rotationIndex = ((buildPos.x * 7 + buildPos.z * 11) % 4);
              rotation = rotationIndex * (Math.PI / 2);
            } else {
              // Single player: random rotation in 90-degree increments (like human players can do)
              rotation = Math.floor(Math.random() * 4) * (Math.PI / 2);
            }
          }
          
          // Submit build command through Match system
          window.currentMatch.submitCommand({
            type: 'build',
            playerId: aiPlayer.id,
            buildingType: action.buildingType,
            gridX: buildPos.x,
            gridZ: buildPos.z,
            rotation: rotation
          });
        }
        break;
      
      case 'train':
        // Find agora or appropriate building to train from
        const trainingBuilding = aiPlayer.buildings?.find(b => 
          b && (b.type === 'agora' || b.type === 'village')
        );
        
        if (trainingBuilding) {
          console.log(`🤖 AI submitting train command for ${action.unitType} at ${trainingBuilding.type}`);
          
          // Submit train command through Match system
          window.currentMatch.submitCommand({
            type: 'train',
            playerId: aiPlayer.id,
            buildingId: trainingBuilding.id,
            unitType: action.unitType
          });
        }
        break;
      
      case 'gather':
        // Find villager and nearest resource
        const villager = aiPlayer.units.find(u => u && u.type === 'villager' && u.state === 'idle');
        const nearestResource = findNearestResource(aiPlayer);
        
        if (villager && nearestResource) {
          // Submit gather command through Match system
          window.currentMatch.submitCommand({
            type: 'gather',
            playerId: aiPlayer.id,
            unitIds: [villager.id],
            resourceId: nearestResource.id
          });
        }
        break;
      
      case 'attack':
        // Find military units and target
        const attackers = aiPlayer.units.filter(u => 
          u && u.category === 'military' && u.state === 'idle'
        );
        const attackTarget = findWeakestEnemyUnit();
        
        if (attackers.length > 0 && attackTarget) {
          // Submit attack command through Match system
          window.currentMatch.submitCommand({
            type: 'attack',
            playerId: aiPlayer.id,
            unitIds: attackers.map(u => u.id),
            targetId: attackTarget.id
          });
        }
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
    // CRITICAL: Use deterministic placement based on player ID and tick for multiplayer sync
    const playerId = player.id || 'ai';
    const playerIdHash = playerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const currentTick = window.currentMatch?.tick || 0;
    const seed = playerIdHash + currentTick;
    const deterministicRandom1 = ((seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const deterministicRandom2 = (((seed + 1) * 1664525 + 1013904223) % 4294967296) / 4294967296;
    
    const distance = 8 + Math.floor(deterministicRandom1 * 7); // 8-15 tiles away (deterministic)
    const angle = deterministicRandom2 * Math.PI * 2; // Deterministic direction
    
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
    
    // CRITICAL: Use deterministic patrol point selection based on unit ID and tick
    const unitIdHash = (unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const currentTick = window.currentMatch?.tick || 0;
    const deterministicIndex = (unitIdHash + currentTick) % patrolPoints.length;
    const nextPoint = patrolPoints[deterministicIndex];
    window.pathfinding.moveUnit(unit, nextPoint);
  };
  
  function scoutForEnemies(unit) {
    // Move toward deterministic unexplored area based on unit ID and tick
    // CRITICAL: Use deterministic random for multiplayer sync
    const unitIdHash = (unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const currentTick = window.currentMatch?.tick || 0;
    const seed = unitIdHash + currentTick;
    const deterministicRandom1 = ((seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const deterministicRandom2 = (((seed + 1) * 1664525 + 1013904223) % 4294967296) / 4294967296;
    
    const exploreArea = {
      x: (deterministicRandom1 - 0.5) * 100,
      z: (deterministicRandom2 - 0.5) * 100
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
  
  // REMOVED: Duplicate cost functions - now read from BuildingTypes/UnitTypes as single source of truth
  // Cost checking happens in match.js executeBuildCommand/executeTrainCommand
  
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
