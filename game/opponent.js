// Opponent Management System
// Handles both AI opponents (single-player) and remote players (multiplayer)

(function(opponent) {
  // Base Opponent class
  function Opponent(options = {}) {
    this.id = options.id || 'opponent';
    this.name = options.name || 'Opponent';
    this.color = options.color || null;
    this.resources = options.startingResources || { ...STARTING_RESOURCES };
    this.units = [];
    this.buildings = []; // Always initialize buildings array
    this.selectedUnits = [];
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

  Opponent.prototype.addResource = function(resourceType, amount) {
    if (this.resources && Object.prototype.hasOwnProperty.call(this.resources, resourceType)) {
      this.resources[resourceType] += amount;
      return true;
    }
    return false;
  };

  Opponent.prototype.removeResource = function(resourceType, amount) {
    if (this.resources && Object.prototype.hasOwnProperty.call(this.resources, resourceType)) {
      if (this.resources[resourceType] >= amount) {
        this.resources[resourceType] -= amount;
        return true;
      }
    }
    return false;
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
        defenseMode: false,
        lastBuildTick: -200, // Start ready to build immediately
        buildCooldownTicks: 200 // 10 seconds at 20Hz - matches demo AI timing
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
    
    // High-level strategic decisions
    // Only enter defense mode if there's ACTUAL threat (enemy units near base), not just perceived
    const wasInDefenseMode = aiState.defenseMode;
    if (threat > 0.9) { // Much higher threshold - only real emergencies
      aiState.defenseMode = true;
      if (!wasInDefenseMode) {
        console.log(`🛡️ AI entering DEFENSE MODE!`);
        
        // Check if agora is under attack and rally defenders
        const agoraBuilding = aiPlayer.buildings?.find(b => b && b.type === 'agora');
        if (agoraBuilding && agoraBuilding.contested && window.rallyUnitsToAgora) {
          console.log(`🚩 AI rallying defenders to contested agora!`);
          window.rallyUnitsToAgora(30, aiPlayer);
        }
        
        // DEFENSE MODE: Build tower near agora if we can afford it and don't have one nearby
        const towerCost = normCost(window.BuildingTypes?.tower?.cost);
        const towerCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'tower').length : 0;
        
        // Check if we have a tower near the agora (within 5 tiles)
        let hasTowerNearAgora = false;
        if (agoraBuilding && agoraBuilding.position) {
          const agoraGridX = Math.floor(agoraBuilding.position.x / (window.TILE_SIZE || 4));
          const agoraGridZ = Math.floor(agoraBuilding.position.z / (window.TILE_SIZE || 4));
          
          const towers = aiPlayer.buildings?.filter(b => b && b.type === 'tower') || [];
          for (const tower of towers) {
            if (tower.position) {
              const towerGridX = Math.floor(tower.position.x / (window.TILE_SIZE || 4));
              const towerGridZ = Math.floor(tower.position.z / (window.TILE_SIZE || 4));
              const dist = Math.sqrt((towerGridX - agoraGridX) ** 2 + (towerGridZ - agoraGridZ) ** 2);
              if (dist <= 5) {
                hasTowerNearAgora = true;
                break;
              }
            }
          }
        }
        
        // Build tower if we can afford it and don't have one near agora
        // Store flag in aiState to add action after actions array is created
        if (!hasTowerNearAgora && resources.wood >= towerCost.wood && resources.stone >= towerCost.stone) {
          aiState.defenseTowerNeeded = true; // Flag to build defense tower
        }
      }
    } else if (threat < 0.3 && aiState.defenseMode) {
      aiState.defenseMode = false;
      console.log(`⚔️ AI exiting defense mode`);
    }
    
    // Execute multi-step build order based on phase and difficulty
    const actions = [];
    
    // DEFENSE MODE: Add defense tower action if needed (high priority, before other actions)
    if (aiState.defenseTowerNeeded) {
      actions.push({
        type: 'build',
        buildingType: 'tower',
        priority: 'high',
        nearAgora: true // Flag to use special placement near agora
      });
      aiState.defenseTowerNeeded = false; // Clear flag after adding
    }
    
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
    
    // Execute queued actions (respecting difficulty-based timing and building cooldown)
    // CRITICAL: Make AI chill - only execute 1 action per decision cycle, and respect cooldowns
    const ticksSinceLastBuild = currentTick - (aiState.lastBuildTick || 0);
    const canBuild = ticksSinceLastBuild >= aiState.buildCooldownTicks;
    
    // CHILL MODE: Only execute highest priority action, and only if cooldown allows
    // This prevents the AI from spamming multiple buildings at once
    
    // Debug: Log AI decision state every 5 seconds
    if (currentTick % 100 === 0) {
      console.log(`🤖 AI ${aiPlayer.id?.slice(-6)}: phase=${aiState.phase}, actions=${actions.length}, canBuild=${canBuild}, defense=${aiState.defenseMode}`);
      if (actions.length > 0) {
        console.log(`   Actions:`, actions.map(a => `${a.type}:${a.buildingType || a.unitType}`).join(', '));
      }
    }
    
    for (const action of actions) {
      if (action.type === 'build' && !canBuild) {
        continue;
      }
      
      executeAIAction(aiPlayer, action);
      
      if (action.type === 'build') {
        aiState.lastBuildTick = currentTick;
      }
      break;
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
  
  function normCost(c) { return { wood: c?.wood || 0, stone: c?.stone || 0, food: c?.food || 0 }; }

  function getEconomicAction(aiPlayer, aiState, resources, buildingCount, unitCount) {
    const villagerCount = aiPlayer.units.filter(u => u.type === 'villager').length;
    const campCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'camp').length : 0;
    const farmCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'farm').length : 0;
    const villageCount = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.type === 'village').length : 0;
    
    const campCost = normCost(window.BuildingTypes?.camp?.cost);
    const villageCost = normCost(window.BuildingTypes?.village?.cost);
    const farmCost = normCost(window.BuildingTypes?.farm?.cost);
    
    // PHASE 1: Build one of each essential building first (camp -> village -> farm)
    // Priority 1: Build first camp for resource gathering
    // CRITICAL: Only build ONE camp, then MUST build village before any more camps
    // Keep small reserve even for first camp (but less strict)
    const firstCampReserve = 5; // Smaller reserve for first building
    if (campCount === 0 && 
        resources.wood >= campCost.wood + firstCampReserve && 
        resources.stone >= campCost.stone) {
      return {type: 'build', buildingType: 'camp', priority: 'high'};
    }
    
    // Priority 2: Build first village to spawn villagers (after camp)
    // CRITICAL: Don't build more camps until we have at least one village!
    if (campCount >= 1 && villageCount === 0) {
      if (resources.wood >= villageCost.wood && resources.stone >= villageCost.stone) {
        return {type: 'build', buildingType: 'village', priority: 'high'};
      } else {
        // SAVE UP: Don't build anything else if we're saving for village!
        return null; // Block all other building until we can afford village
      }
    }
    
    // Priority 3: Build first farm for food production (after village)
    // CRITICAL: Don't build more camps until we have at least one farm!
    if (villageCount >= 1 && farmCount === 0) {
      if (resources.wood >= farmCost.wood && resources.stone >= farmCost.stone) {
        return {type: 'build', buildingType: 'farm', priority: 'high'};
      } else {
        // SAVE UP: Don't build anything else if we're saving for farm!
        return null; // Block all other building until we can afford farm
      }
    }
    
    // PHASE 2: After having one of each, build more flexibly
    // CRITICAL: Keep resource reserves - don't spend everything!
    // Keep at least 15 wood and 5 stone as emergency reserves
    const woodReserve = 15;
    const stoneReserve = 5;
    
    // OCCASIONAL VILLAGE/FARM: Sometimes build villages/farms even without huge reserves
    // This ensures we occasionally get villages/farms instead of just camps
    const playerIdHash = (aiPlayer.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const currentTick = window.currentMatch?.tick || 0;
    const occasionalBuildChance = (playerIdHash + currentTick) % 20; // 5% chance (1 in 20)
    const shouldOccasionallyBuild = occasionalBuildChance === 0;
    
    // Priority 4: Build more villages if we need more villagers
    // Two paths: normal (with reserves) OR occasional (just afford it)
    if (farmCount >= 1 && villageCount < 3 && villagerCount < 12) {
      const canAffordVillageNormal = resources.wood >= villageCost.wood + woodReserve && 
                                      resources.stone >= villageCost.stone + stoneReserve;
      const canAffordVillageOccasional = resources.wood >= villageCost.wood + 5 && // Smaller reserve for occasional builds
                                         resources.stone >= villageCost.stone;
      
      if (canAffordVillageNormal || (shouldOccasionallyBuild && canAffordVillageOccasional)) {
        return {type: 'build', buildingType: 'village', priority: 'medium'};
      }
    }
    
    // Priority 5: Build more farms if we need food
    // Two paths: normal (with reserves) OR occasional (just afford it)
    if (farmCount >= 1 && farmCount < 4) {
      const canAffordFarmNormal = resources.wood >= farmCost.wood + woodReserve && 
                                   resources.stone >= farmCost.stone + stoneReserve;
      const canAffordFarmOccasional = resources.wood >= farmCost.wood + 5 && // Smaller reserve for occasional builds
                                      resources.stone >= farmCost.stone;
      
      if (canAffordFarmNormal || (shouldOccasionallyBuild && canAffordFarmOccasional)) {
        return {type: 'build', buildingType: 'farm', priority: 'medium'};
      }
    }
    
    // Priority 6: Build more camps ONLY when REALLY needed:
    // - We have village AND farm (basic economy set up)
    // - ALL existing camps are FULL of workers (maxWorkers reached)
    // - We have SIGNIFICANT idle villagers (at least 4-5 idle)
    // - We have resources AND reserves
    // CRITICAL: Don't spam camps - they only help if existing ones are completely full!
    if (campCount >= 1 && (villageCount === 0 || farmCount === 0)) {
      // Don't return null here - let it fall through to training villagers or return null at end
      // This ensures villages/farms can still be built even if we have camps
    } else if (farmCount >= 1 && villageCount >= 1 && villagerCount >= 10 && 
               !shouldOccasionallyBuild && // Skip camps during occasional build cycles - prioritize villages/farms
               resources.wood >= campCost.wood + woodReserve && 
               resources.stone >= campCost.stone + stoneReserve) {
      // Check if ALL existing camps are FULL
      const camps = (aiPlayer.buildings || []).filter(b => b && b.type === 'camp');
      if (camps.length === 0) {
        // No camps yet - can build first one
        return {type: 'build', buildingType: 'camp', priority: 'low'};
      }
      
      // Check if ALL camps are full
      const fullCamps = camps.filter(b => 
        b.assignedWorkers && 
        b.assignedWorkers.length >= (b.maxWorkers || 8)
      ).length;
      
      // Only build if ALL camps are full AND we have idle villagers
      const idleVillagerCount = aiPlayer.units.filter(u => 
        u && u.type === 'villager' && 
        (!u.assignedBuilding || !u.assignedBuilding.assignedWorkers || 
         u.assignedBuilding.assignedWorkers.length < u.assignedBuilding.maxWorkers)
      ).length;
      
      // Only build if:
      // 1. ALL existing camps are FULL (100% utilization)
      // 2. We have SIGNIFICANT idle villagers (at least 6-7 idle - much higher threshold)
      // 3. We haven't hit the cap (max 2 camps total)
      // 4. RARE BUILDING: Only build camps very rarely (1/4 chance even when conditions are met)
      const maxCamps = 2; // Keep conservative
      
      // CRITICAL: Make camp building VERY rare - only 1/4 of the time even when conditions are perfect
      // This means it will only build every 3rd or 4th camp it would normally consider
      // Use +1 offset to avoid conflicting with occasional build chance
      const campBuildChance = (playerIdHash + currentTick + 1) % 4; // 0-3, only build on 0 (25% chance = every 4th)
      
      if (campCount < maxCamps && fullCamps === campCount && fullCamps > 0 && 
          idleVillagerCount >= 6 && campBuildChance === 0) {
        // Only build 1/4 of the camps it would normally build - make it SUPER rare
        // Combined with 20-second cooldown, this means camps are built very infrequently
        return {type: 'build', buildingType: 'camp', priority: 'low'};
      }
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
    
    const towerCost = normCost(window.BuildingTypes?.tower?.cost);
    
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
          window.currentMatch.submitCommand({
            type: 'move',
            playerId: aiPlayer.id,
            unitIds: [unit.id],
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
      
      window.currentMatch.submitCommand({
        type: 'move',
        playerId: aiPlayer.id,
        unitIds: [unit.id],
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
      
      window.currentMatch.submitCommand({
        type: 'move',
        playerId: aiPlayer.id,
        unitIds: [unit.id],
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
  
  // Manage worker units (villagers) - submits work commands for idle villagers
  // The building system (updateBuildings → findIdleVillagersNearBuilding → assignVillagerToWork)
  // handles the actual worker tracking (assignedWorkers/assignedBuilding). This function
  // supplements it by submitting explicit work commands for villagers the auto-assign might miss
  // (e.g. villagers far from buildings, or freshly spawned villagers).
  function manageWorkerUnits(aiPlayer, aiState, resources) {
    if (!window.currentMatch) return;
    
    const villagers = aiPlayer.units.filter(u => u && u.type === 'villager');
    
    villagers.forEach(villager => {
      if (!villager.pb || !villager.pb.state) return;
      
      if (villager.assignedBuilding) return;
      
      const currentBehavior = window.behaviorManager?.getBehavior(villager);
      const behaviorName = currentBehavior?.constructor?.name;
      if (behaviorName && (behaviorName.includes('Work') || behaviorName.includes('Gather') ||
                           behaviorName === 'WalkBehavior' || behaviorName === 'RunBehavior')) return;
      
      const buildings = aiPlayer.buildings ? aiPlayer.buildings.filter(b => b && b.position) : [];
      if (buildings.length === 0) return;
      
      let bestBuilding = null;
      let bestScore = -Infinity;
      
      for (const building of buildings) {
        if (!building.position) continue;
        
        // Only target buildings that actually benefit from workers:
        // 1. Under construction (any type)
        // 2. Completed production buildings (camps, farms)
        const isUnderConstruction = building.workType === 'build' && !building.completionProcessed;
        const isProductionBuilding = building.completionProcessed &&
          building.needsWorkers &&
          building.workType !== 'build';
        
        if (!isUnderConstruction && !isProductionBuilding) continue;
        
        const maxWorkers = building.maxWorkers || 3;
        const currentWorkers = building.assignedWorkers?.length || 0;
        if (currentWorkers >= maxWorkers) continue;
        
        const dx = building.position.x - villager.pb.state.loc.x;
        const dz = building.position.z - villager.pb.state.loc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        // Prioritize construction over production, closer over farther
        const priorityBonus = isUnderConstruction ? 1000 : 0;
        const score = priorityBonus - dist;
        
        if (score > bestScore) {
          bestScore = score;
          bestBuilding = building;
        }
      }
      
      if (bestBuilding) {
        window.currentMatch.submitCommand({
          type: 'work',
          playerId: aiPlayer.id,
          unitIds: [villager.id],
          buildingId: bestBuilding.id
        });
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
  
  function executeAIAction(aiPlayer, action) {
    if (!window.currentMatch) {
      console.warn('⚠️ Cannot execute AI action - no active match');
      return;
    }
    
    
    switch (action.type) {
      case 'build':
        // Find suitable build location near base
        // Use special placement near agora for defense towers
        let buildPos;
        if (action.nearAgora) {
          buildPos = findBuildLocationNearAgora(aiPlayer);
        } else {
          // Use building count as seed offset to ensure different locations even in same tick
          const buildingCount = aiPlayer.buildings ? aiPlayer.buildings.length : 0;
          buildPos = findBuildLocation(aiPlayer, buildingCount);
        }
        
        if (buildPos) {
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
  // Find build location near agora (for defense towers)
  function findBuildLocationNearAgora(player) {
    const agoraBuilding = player.buildings?.find(b => b && b.type === 'agora');
    if (!agoraBuilding || !agoraBuilding.position) {
      // Fallback to normal location if no agora found
      return findBuildLocation(player, 0);
    }
    
    const TILE_SIZE = window.TILE_SIZE || 4;
    const MIN_BUILDING_SPACING = 3; // Closer spacing for defense towers
    const agoraGridX = Math.floor(agoraBuilding.position.x / TILE_SIZE);
    const agoraGridZ = Math.floor(agoraBuilding.position.z / TILE_SIZE);
    
    // Get all existing buildings to check spacing
    const existingBuildings = (player.buildings || []).filter(b => b && b.position);
    const allBuildings = window.gameBuildings || [];
    
    // Try positions in a circle around the agora (2-4 tiles away)
    const playerId = player.id || 'ai';
    const playerIdHash = playerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const currentTick = window.currentMatch?.tick || 0;
    
    // Try 8 different angles around the agora
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = (attempt * Math.PI * 2) / 8; // 8 evenly spaced angles
      const distance = 2 + (attempt % 3); // 2, 3, or 4 tiles away
      
      const gridX = Math.floor(agoraGridX + Math.cos(angle) * distance);
      const gridZ = Math.floor(agoraGridZ + Math.sin(angle) * distance);
      
      // Make sure it's within map bounds
      const field = window.liveField;
      let finalX = gridX;
      let finalZ = gridZ;
      if (field) {
        finalX = Math.max(5, Math.min(field.width - 5, gridX));
        finalZ = Math.max(5, Math.min(field.height - 5, gridZ));
      }
      
      // Check spacing from all existing buildings
      let tooClose = false;
      const worldX = finalX * TILE_SIZE;
      const worldZ = finalZ * TILE_SIZE;
      
      for (const building of existingBuildings) {
        if (!building.position) continue;
        const dx = building.position.x - worldX;
        const dz = building.position.z - worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const distInTiles = dist / TILE_SIZE;
        
        if (distInTiles < MIN_BUILDING_SPACING) {
          tooClose = true;
          break;
        }
      }
      
      // Also check spacing from all buildings in game
      for (const building of allBuildings) {
        if (!building.position) continue;
        const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
        const playerOwner = player.id?.length > 6 ? player.id.slice(-6) : player.id;
        if (buildingOwner === playerOwner) continue;
        
        const dx = building.position.x - worldX;
        const dz = building.position.z - worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const distInTiles = dist / TILE_SIZE;
        
        if (distInTiles < MIN_BUILDING_SPACING * 0.7) {
          tooClose = true;
          break;
        }
      }
      
      // If this location has proper spacing, use it
      if (!tooClose) {
        return { x: finalX, z: finalZ };
      }
    }
    
    // Fallback: use normal location if we can't find a spot near agora
    return findBuildLocation(player, 0);
  }
  
  function findBuildLocation(player, seedOffset = 0) {
    // Find empty tile near player base with proper spacing from other buildings
    // agora is in grid coordinates, basePosition might be in world coords
    const baseGridX = player.agora ? player.agora.x : (player.basePosition ? Math.floor(player.basePosition.x / (window.TILE_SIZE || 4)) : 0);
    const baseGridZ = player.agora ? player.agora.y : (player.basePosition ? Math.floor(player.basePosition.z / (window.TILE_SIZE || 4)) : 0);
    
    const TILE_SIZE = window.TILE_SIZE || 4;
    const MIN_BUILDING_SPACING = 4; // Minimum tiles between buildings (was causing stacking!)
    
    // Get all existing buildings to check spacing
    const existingBuildings = (player.buildings || []).filter(b => b && b.position);
    const allBuildings = window.gameBuildings || [];
    
    // Try multiple locations to find one with proper spacing
    const playerId = player.id || 'ai';
    const playerIdHash = playerId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const currentTick = window.currentMatch?.tick || 0;
    
    // CRITICAL: Use seedOffset (building count) to ensure different locations even in same tick
    // This prevents multiple buildings from being placed at the same spot
    const baseSeed = playerIdHash + currentTick + seedOffset * 73; // Use seedOffset to vary location
    
    // Try up to 20 different locations to find one with proper spacing
    for (let attempt = 0; attempt < 20; attempt++) {
      const seed = baseSeed + attempt * 37; // Different seed per attempt
      const deterministicRandom1 = ((seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      const deterministicRandom2 = (((seed + 1) * 1664525 + 1013904223) % 4294967296) / 4294967296;
      
      // Vary distance more - start closer and expand outward
      const baseDistance = 6 + attempt * 0.5; // Start at 6 tiles, expand by 0.5 per attempt
      const distance = baseDistance + Math.floor(deterministicRandom1 * 5); // 6-11 tiles initially, expanding
      
      // CRITICAL: Vary angle more to avoid line formation
      // Use seedOffset to rotate the base angle, preventing all buildings from being in a line
      const baseAngleOffset = (seedOffset * 0.618) % (Math.PI * 2); // Golden ratio rotation per building
      const angle = (deterministicRandom2 * Math.PI * 2) + baseAngleOffset; // Rotate base angle to avoid lines
      
      const gridX = Math.floor(baseGridX + Math.cos(angle) * distance);
      const gridZ = Math.floor(baseGridZ + Math.sin(angle) * distance);
      
      // Make sure it's within map bounds
      const field = window.liveField;
      let finalX = gridX;
      let finalZ = gridZ;
      if (field) {
        finalX = Math.max(5, Math.min(field.width - 5, gridX));
        finalZ = Math.max(5, Math.min(field.height - 5, gridZ));
      }
      
      // Check spacing from all existing buildings
      let tooClose = false;
      const worldX = finalX * TILE_SIZE;
      const worldZ = finalZ * TILE_SIZE;
      
      for (const building of existingBuildings) {
        if (!building.position) continue;
        const dx = building.position.x - worldX;
        const dz = building.position.z - worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const distInTiles = dist / TILE_SIZE;
        
        if (distInTiles < MIN_BUILDING_SPACING) {
          tooClose = true;
          break;
        }
      }
      
      // Also check spacing from all buildings in game (including other players' buildings)
      for (const building of allBuildings) {
        if (!building.position) continue;
        // Skip if it's our own building (already checked above)
        const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
        const playerOwner = player.id?.length > 6 ? player.id.slice(-6) : player.id;
        if (buildingOwner === playerOwner) continue;
        
        const dx = building.position.x - worldX;
        const dz = building.position.z - worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const distInTiles = dist / TILE_SIZE;
        
        // Allow closer to enemy buildings, but still maintain some spacing
        if (distInTiles < MIN_BUILDING_SPACING * 0.7) {
          tooClose = true;
          break;
        }
      }
      
      // If this location has proper spacing, use it
      if (!tooClose) {
        return { x: finalX, z: finalZ };
      }
    }
    
    // Fallback: if we couldn't find a good spot after 20 attempts, use the last attempt
    // This should rarely happen, but ensures we always return a location
    const fallbackSeed = baseSeed + 19 * 37;
    const fallbackRandom1 = ((fallbackSeed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const fallbackRandom2 = (((fallbackSeed + 1) * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const fallbackDistance = 10 + Math.floor(fallbackRandom1 * 5);
    const fallbackAngle = fallbackRandom2 * Math.PI * 2;
    const fallbackX = Math.floor(baseGridX + Math.cos(fallbackAngle) * fallbackDistance);
    const fallbackZ = Math.floor(baseGridZ + Math.sin(fallbackAngle) * fallbackDistance);
    
    const field = window.liveField;
    if (field) {
      return {
        x: Math.max(5, Math.min(field.width - 5, fallbackX)),
        z: Math.max(5, Math.min(field.height - 5, fallbackZ))
      };
    }
    
    return { x: fallbackX, z: fallbackZ };
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
    material.alpha = 1.0; // Opaque
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
