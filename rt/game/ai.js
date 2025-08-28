// AI System - Unit behaviors, decision making, and strategic AI
(function(ai) {
  
  // AI state and configuration
  let aiEnabled = true;
  let aiUpdateInterval = 100; // ms between AI updates
  let lastAIUpdate = 0;
  
  // AI behavior types
  const BehaviorTypes = {
    IDLE: 'idle',
    WANDER: 'wander',
    PATROL: 'patrol',
    FOLLOW: 'follow',
    ATTACK: 'attack',
    FLEE: 'flee',
    GATHER: 'gather',
    BUILD: 'build',
    GUARD: 'guard',
    FLY_CIRCLE: 'fly_circle'
  };
  
  // AI personality traits for units
  const PersonalityTraits = {
    AGGRESSIVE: { attackRange: 1.5, fleeThreshold: 0.2, wanderRange: 3 },
    DEFENSIVE: { attackRange: 1.0, fleeThreshold: 0.5, wanderRange: 1.5 },
    EXPLORER: { attackRange: 1.0, fleeThreshold: 0.3, wanderRange: 5 },
    COWARD: { attackRange: 0.8, fleeThreshold: 0.7, wanderRange: 1 }
  };
  
  // Initialize AI system
  ai.init = function() {
    console.log('🧠 AI System initialized');
    console.log('Available behaviors:', Object.keys(BehaviorTypes));
    console.log('Personality types:', Object.keys(PersonalityTraits));
  };
  
  // Main AI update loop - called from game loop
  ai.update = function(deltaTime) {
    if (!aiEnabled) return;
    
    const currentTime = performance.now();
    if (currentTime - lastAIUpdate < aiUpdateInterval) return;
    
    lastAIUpdate = currentTime;
    
    // Update all AI-controlled units
    if (window.gameUnits) {
      window.gameUnits.forEach(unit => {
        if (unit.aiEnabled && unit.owner !== 'player') {
          updateUnitAI(unit, deltaTime);
        }
      });
    }
    
    // Update strategic AI (building, resource management, etc.)
    updateStrategicAI(deltaTime);
  };
  
  // Update individual unit AI
  function updateUnitAI(unit, deltaTime) {
    if (!unit.ai) {
      // Initialize AI for this unit
      initializeUnitAI(unit);
    }
    
    // Update AI timers
    unit.ai.thinkTimer -= deltaTime;
    unit.ai.actionTimer -= deltaTime;
    
    // Think periodically (decision making)
    if (unit.ai.thinkTimer <= 0) {
      thinkAndDecide(unit);
      unit.ai.thinkTimer = unit.ai.thinkInterval;
    }
    
    // Execute current behavior
    if (unit.ai.actionTimer <= 0) {
      executeBehavior(unit);
      unit.ai.actionTimer = unit.ai.actionInterval;
    }
  }
  
  // Initialize AI for a unit
  function initializeUnitAI(unit) {
    // Assign random personality if not set
    const personalities = Object.keys(PersonalityTraits);
    const randomPersonality = personalities[Math.floor(Math.random() * personalities.length)];
    
    // Special behavior for birds - they fly in circles
    const initialBehavior = unit.type === 'bird_messenger' ? BehaviorTypes.FLY_CIRCLE : BehaviorTypes.IDLE;
    
    unit.ai = {
      behavior: initialBehavior,
      personality: randomPersonality,
      traits: PersonalityTraits[randomPersonality],
      target: null,
      destination: null,
      thinkTimer: Math.random() * 2, // Stagger thinking
      actionTimer: Math.random() * 1, // Stagger actions
      thinkInterval: 1 + Math.random() * 2, // Think every 1-3 seconds
      actionInterval: 0.5 + Math.random() * 0.5, // Act every 0.5-1 seconds
      memory: {
        lastSeenEnemy: null,
        homePosition: unit.pb.state.loc.clone(),
        patrolPoints: [],
        lastDamageTime: 0
      },
      // Flight circle parameters for birds
      circleCenter: unit.pb.state.loc.clone(),
      circleRadius: 3 + Math.random() * 4, // 3-7 unit radius
      circleAngle: Math.random() * Math.PI * 2, // Start at random angle
      circleSpeed: 0.02 + Math.random() * 0.01, // Angular speed
      bobPhase: Math.random() * Math.PI * 2, // Bob up/down phase
      bobSpeed: 0.05 + Math.random() * 0.02, // Bob speed
      baseHeight: unit.pb.state.loc.y + 2 + Math.random() * 3 // Fly 2-5 units above ground
    };
    
    console.log(`🤖 Initialized ${randomPersonality} AI for ${unit.name}`);
  }
  
  // AI decision making
  function thinkAndDecide(unit) {
    const ai = unit.ai;
    const position = unit.pb.state.loc;
    
    // Check for nearby threats
    const nearbyEnemies = findNearbyUnits(unit, 8, 'player'); // Look for player units within 8 units
    
    // Decision tree based on situation
    if (nearbyEnemies.length > 0 && unit.health > ai.traits.fleeThreshold * unit.maxHealth) {
      // Healthy and enemies nearby - attack or guard
      ai.behavior = BehaviorTypes.ATTACK;
      ai.target = nearbyEnemies[0]; // Attack closest enemy
      ai.memory.lastSeenEnemy = ai.target;
    } else if (unit.health < ai.traits.fleeThreshold * unit.maxHealth) {
      // Low health - flee to safety
      ai.behavior = BehaviorTypes.FLEE;
      ai.destination = findSafeLocation(unit);
    } else if (ai.memory.lastSeenEnemy && 
               performance.now() - ai.memory.lastDamageTime < 10000) {
      // Recently saw enemy - patrol around home
      ai.behavior = BehaviorTypes.PATROL;
      generatePatrolRoute(unit);
    } else {
      // Nothing happening - wander around
      ai.behavior = BehaviorTypes.WANDER;
      ai.destination = generateWanderDestination(unit);
    }
  }
  
  // Execute current behavior
  function executeBehavior(unit) {
    const ai = unit.ai;
    
    switch (ai.behavior) {
      case BehaviorTypes.IDLE:
        // Do nothing, just stand there
        break;
        
      case BehaviorTypes.WANDER:
        if (ai.destination) {
          moveTowards(unit, ai.destination);
          // If reached destination, pick new one
          if (distanceTo(unit.pb.state.loc, ai.destination) < 1) {
            ai.destination = generateWanderDestination(unit);
          }
        }
        break;
        
      case BehaviorTypes.PATROL:
        if (ai.patrolPoints.length > 0) {
          const targetPoint = ai.patrolPoints[ai.currentPatrolIndex || 0];
          moveTowards(unit, targetPoint);
          
          if (distanceTo(unit.pb.state.loc, targetPoint) < 1) {
            ai.currentPatrolIndex = ((ai.currentPatrolIndex || 0) + 1) % ai.patrolPoints.length;
          }
        }
        break;
        
      case BehaviorTypes.ATTACK:
        if (ai.target && ai.target.health > 0) {
          const distance = distanceTo(unit.pb.state.loc, ai.target.pb.state.loc);
          if (distance > ai.traits.attackRange) {
            // Move closer to attack
            moveTowards(unit, ai.target.pb.state.loc);
          } else {
            // In range - attack!
            attackTarget(unit, ai.target);
          }
        } else {
          // Target lost or dead
          ai.target = null;
          ai.behavior = BehaviorTypes.IDLE;
        }
        break;
        
      case BehaviorTypes.FLEE:
        if (ai.destination) {
          moveTowards(unit, ai.destination);
          // If reached safety, go back to wandering
          if (distanceTo(unit.pb.state.loc, ai.destination) < 1) {
            ai.behavior = BehaviorTypes.WANDER;
          }
        }
        break;
        
      case BehaviorTypes.FLY_CIRCLE:
        // Circular flight pattern with bobbing
        ai.circleAngle += ai.circleSpeed;
        ai.bobPhase += ai.bobSpeed;
        
        // Calculate new position on circle
        const newX = ai.circleCenter.x + Math.cos(ai.circleAngle) * ai.circleRadius;
        const newZ = ai.circleCenter.z + Math.sin(ai.circleAngle) * ai.circleRadius;
        const newY = ai.baseHeight + Math.sin(ai.bobPhase) * 1.5; // Bob up and down 1.5 units
        
        // Debug removed for performance
        
        // Update position
        unit.pb.state.loc.x = newX;
        unit.pb.state.loc.y = newY;
        unit.pb.state.loc.z = newZ;
        
        // Calculate facing direction (tangent to circle for smooth turning)
        const facingX = -Math.sin(ai.circleAngle);
        const facingZ = Math.cos(ai.circleAngle);
        const facingAngle = Math.atan2(facingX, facingZ);
        
        // Update Y-axis rotation to face flight direction
        if (unit.mesh && unit.mesh.rotation) {
          unit.mesh.rotation.y = facingAngle;
        }
        break;
    }
  }
  
  // Movement helpers
  function moveTowards(unit, destination) {
    const dx = destination.x - unit.pb.state.loc.x;
    const dz = destination.z - unit.pb.state.loc.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance > 0.1) {
      // Normalize and apply movement force
      const moveForce = 2; // Adjust for unit speed
      unit.pb.imp.x += (dx / distance) * moveForce;
      unit.pb.imp.z += (dz / distance) * moveForce;
      
      // Face movement direction
      unit.pb.state.rot.y = Math.atan2(dx, dz);
    }
  }
  
  function distanceTo(pos1, pos2) {
    const dx = pos1.x - pos2.x;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  
  // Utility functions
  function findNearbyUnits(unit, radius, targetOwner) {
    if (!window.gameUnits) return [];
    
    return window.gameUnits.filter(other => {
      if (other === unit || other.owner !== targetOwner) return false;
      return distanceTo(unit.pb.state.loc, other.pb.state.loc) <= radius;
    });
  }
  
  function generateWanderDestination(unit) {
    const home = unit.ai.memory.homePosition;
    const range = unit.ai.traits.wanderRange;
    
    return {
      x: home.x + (Math.random() - 0.5) * range * 2,
      y: home.y,
      z: home.z + (Math.random() - 0.5) * range * 2
    };
  }
  
  function findSafeLocation(unit) {
    // Move away from enemies towards home
    const home = unit.ai.memory.homePosition;
    const currentPos = unit.pb.state.loc;
    
    // Direction towards home
    const toHomeX = home.x - currentPos.x;
    const toHomeZ = home.z - currentPos.z;
    const distance = Math.sqrt(toHomeX * toHomeX + toHomeZ * toHomeZ);
    
    if (distance > 0) {
      return {
        x: currentPos.x + (toHomeX / distance) * 5, // Run 5 units towards home
        y: currentPos.y,
        z: currentPos.z + (toHomeZ / distance) * 5
      };
    }
    
    return home;
  }
  
  function generatePatrolRoute(unit) {
    const home = unit.ai.memory.homePosition;
    const patrolRadius = 4;
    
    unit.ai.patrolPoints = [
      { x: home.x + patrolRadius, y: home.y, z: home.z },
      { x: home.x, y: home.y, z: home.z + patrolRadius },
      { x: home.x - patrolRadius, y: home.y, z: home.z },
      { x: home.x, y: home.y, z: home.z - patrolRadius }
    ];
    unit.ai.currentPatrolIndex = 0;
  }
  
  function attackTarget(unit, target) {
    // Simple attack - reduce target health
    if (unit.attackDamage && target.health) {
      target.health -= unit.attackDamage || 10;
      target.ai.memory.lastDamageTime = performance.now();
      
      console.log(`${unit.name} attacks ${target.name} for ${unit.attackDamage || 10} damage!`);
      
      if (target.health <= 0) {
        console.log(`${target.name} has been defeated!`);
        // Handle death
      }
    }
  }
  
  // Strategic AI update
  function updateStrategicAI(deltaTime) {
    // TODO: Implement strategic decisions
    // - Resource management
    // - Building placement
    // - Army composition
    // - Territory expansion
  }
  
  // Public API for controlling AI
  ai.setUnitBehavior = function(unit, behavior, target = null) {
    if (!unit.ai) initializeUnitAI(unit);
    unit.ai.behavior = behavior;
    unit.ai.target = target;
  };
  
  ai.enableAI = function() { aiEnabled = true; };
  ai.disableAI = function() { aiEnabled = false; };
  
  ai.setUpdateInterval = function(ms) { aiUpdateInterval = ms; };
  
  // Unit selection system with instanced rings
  let selectedUnits = [];
  let selectionMasterRing = null;
  let selectionRingInstances = []; // Pool of ring instances
  let availableRingInstances = []; // Available instances for reuse
  
  // Initialize selection ring system
  function initSelectionRings() {
    if (selectionMasterRing || !window.gfx || !window.gfx.scene) return;
    
    // Create master selection indicator - giant bright cube (can't miss this!)
    selectionMasterRing = BABYLON.MeshBuilder.CreateBox("selectionBoxMaster", {
      size: 4 // Big obvious cube
    }, window.gfx.scene);
    
    // Obnoxiously bright material
    const material = new BABYLON.StandardMaterial("selectionMaterial", window.gfx.scene);
    material.emissiveColor = new BABYLON.Color3(5, 5, 0); // Bright yellow
    material.diffuseColor = new BABYLON.Color3(1, 1, 0); // Yellow
    material.disableLighting = true;
    selectionMasterRing.material = material;
    
    // Hide master ring (it's just for instancing)
    selectionMasterRing.setEnabled(false);
    
    console.log('🎯 Selection ring system initialized with instancing');
  }
  
  // Get a ring instance from pool or create new one
  function getSelectionRingInstance() {
    if (availableRingInstances.length > 0) {
      return availableRingInstances.pop();
    } else {
      // Create new instance
      if (!selectionMasterRing) initSelectionRings();
      const instance = selectionMasterRing.createInstance(`selectionRing_${selectionRingInstances.length}`);
      selectionRingInstances.push(instance);
      return instance;
    }
  }
  
  // Return ring instance to pool
  function returnSelectionRingInstance(instance) {
    instance.setEnabled(false);
    instance.parent = null;
    availableRingInstances.push(instance);
  }
  
  // Select a unit
  ai.selectUnit = function(unit) {
    if (!selectedUnits.includes(unit)) {
      selectedUnits.push(unit);
      unit.isSelected = true;
      
      // Add visual selection indicator
      addSelectionIndicator(unit);
      
      // Update player selection
      updatePlayerSelection();
      
      console.log(`Selected: ${unit.name}`);
    }
  };
  
  // Deselect a unit
  ai.deselectUnit = function(unit) {
    const index = selectedUnits.indexOf(unit);
    if (index > -1) {
      selectedUnits.splice(index, 1);
      unit.isSelected = false;
      
      // Remove visual selection indicator
      removeSelectionIndicator(unit);
      
      // Update player selection
      updatePlayerSelection();
      
      console.log(`Deselected: ${unit.name}`);
    }
  };
  
  // Clear all selections
  ai.clearSelection = function() {
    selectedUnits.forEach(unit => {
      unit.isSelected = false;
      removeSelectionIndicator(unit);
    });
    selectedUnits = [];
    
    // Update player selection
    updatePlayerSelection();
    
    console.log('Cleared all selections');
  };
  
  // Get selected units
  ai.getSelectedUnits = function() {
    return [...selectedUnits]; // Return copy
  };
  
  // Expose current selection globally for easy access
  ai.getCurrentSelection = function() {
    return selectedUnits;
  };
  
  // Store selection on player object for easy access
  function updatePlayerSelection() {
    if (window.player) {
      window.player.selection = selectedUnits;
    }
  }
  
  // Check if unit is selectable (player-owned)
  function isSelectableUnit(unit) {
    return unit.owner === 'player' && unit.mesh && unit.health > 0;
  }
  
  // Find unit at screen position (only from player.units)
  ai.findUnitAtPosition = function(screenX, screenY) {
    if (!window.gfx || !window.gfx.scene || !window.player || !window.player.units) return null;
    
    // Pick with predicate to only hit player unit meshes
    const pickResult = window.gfx.scene.pick(screenX, screenY, (mesh) => {
      // Check if this mesh belongs to a player unit
      return window.player.units.some(unit => {
        return unit.mesh && (unit.mesh === mesh || unit.mesh.getChildMeshes().includes(mesh));
      });
    });
    
    if (pickResult.hit) {
      // Find which player unit this mesh belongs to
      const hitMesh = pickResult.pickedMesh;
      const unit = window.player.units.find(unit => {
        return unit.mesh && (unit.mesh === hitMesh || unit.mesh.getChildMeshes().includes(hitMesh));
      });
      
      if (unit && unit.mesh && unit.health > 0) {
        return unit;
      }
    }
    
    return null;
  };
  
  // Add visual selection indicator to a unit (simple direct approach)
  function addSelectionIndicator(unit) {
    console.log('🎯 Adding selection indicator for:', unit.name, 'Has mesh:', !!unit.mesh);
    
    if (!unit.mesh || unit.selectionRing) {
      console.log('❌ Cannot add indicator - no mesh or already has ring');
      return;
    }
    
    // Create indicator directly, no pooling
    const indicator = BABYLON.MeshBuilder.CreateBox("selectionBox", {
      size: 2
    }, window.gfx.scene);
    
    // Bright material
    const material = new BABYLON.StandardMaterial("selectionMat", window.gfx.scene);
    material.emissiveColor = new BABYLON.Color3(0, 3, 0); // Bright green
    material.disableLighting = true;
    indicator.material = material;
    
    // Make it a child of the unit mesh FIRST
    indicator.parent = unit.mesh;
    
    // Then position it relative to the unit (local coordinates)
    indicator.position.set(0, 1, 0); // Just 1 unit above the unit in local space
    
    console.log('🟢 Created indicator as child of:', unit.mesh.name);
    console.log('🔍 Indicator position:', indicator.position, 'Parent:', indicator.parent?.name);
    
    // Store reference
    unit.selectionRing = indicator;
  }
  
  // Remove visual selection indicator (dispose directly)
  function removeSelectionIndicator(unit) {
    if (unit.selectionRing) {
      unit.selectionRing.dispose();
      unit.selectionRing = null;
    }
  }
  
  // Handle unit click selection
  ai.handleUnitClick = function(screenX, screenY, isCtrlHeld = false) {
    const clickedUnit = ai.findUnitAtPosition(screenX, screenY);
    
    if (clickedUnit) {
      if (isCtrlHeld) {
        // Ctrl+click: toggle selection
        if (clickedUnit.isSelected) {
          ai.deselectUnit(clickedUnit);
        } else {
          ai.selectUnit(clickedUnit);
        }
      } else {
        // Normal click: select only this unit
        ai.clearSelection();
        ai.selectUnit(clickedUnit);
      }
      return true; // Unit was clicked
    } else {
      // Clicked empty space - clear selection if not holding Ctrl
      if (!isCtrlHeld) {
        ai.clearSelection();
      }
      return false; // No unit clicked
    }
  };
  
  // Expose behavior types and selection functions
  ai.BehaviorTypes = BehaviorTypes;
  ai.PersonalityTraits = PersonalityTraits;
  
}(window.ai = window.ai || {}));
