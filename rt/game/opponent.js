// Opponent system for simulating AI players in 1v1 matches
const OpponentSystem = {
  
  // Create a fake opponent player
  createOpponent: function() {
    console.log('🤖 Creating opponent player...');
    
    // Calculate opposite corner position from player using actual field dimensions
    let opponentX, opponentY;
    
    if (window.player && window.player.agora && window.liveField) {
      // Get field dimensions
      const fieldWidth = window.liveField.width;
      const fieldHeight = window.liveField.height;
      
      // Player is at (15, 15), place opponent at opposite corner
      // Leave some margin from the edge (about 10 tiles)
      opponentX = Math.max(10, fieldWidth - 15);
      opponentY = Math.max(10, fieldHeight - 15);
      
      console.log(`🤖 Field dimensions: ${fieldWidth}x${fieldHeight}, placing opponent at (${opponentX}, ${opponentY})`);
    } else {
      // Fallback if player or field not available
      opponentX = 50;
      opponentY = 50;
      console.warn('🤖 Using fallback position - player or field not available');
    }
    
    const opponent = new OpponentPlayer({
      name: 'AI Opponent',
      color: '#FF6B6B', // Red color to distinguish from player
      agora: { x: opponentX, y: opponentY } // Place on opposite corner of field
    });
    
    // Store globally for easy access
    window.opponent = opponent;
    
    console.log(`✅ Opponent player created at (${opponentX}, ${opponentY})`);
    return opponent;
  },
  
  // Spawn the opponent in a 1v1 match
  spawnOpponent: function() {
    if (window.opponent) {
      console.log('🤖 Opponent already exists, skipping spawn');
      return window.opponent;
    }
    
    console.log('🤖 Starting opponent spawn process...');
    console.log('🤖 Game systems check:', {
      Unit: !!window.Unit,
      gameUnits: !!window.gameUnits,
      TILE_SIZE: !!TILE_SIZE,
      gfx: !!window.gfx,
      scene: !!window.gfx?.scene,
      placeBuilding: !!window.placeBuilding
    });
    
    const opponent = this.createOpponent();
    
    // Spawn opponent agora building
    this.spawnOpponentAgora(opponent);
    
    // Villagers are now spawned automatically in the OpponentPlayer constructor
    
    // Start AI behavior
    this.startOpponentAI(opponent);
    
    console.log('🤖 Opponent spawned and AI started');
    return opponent;
  },
  
  // Spawn opponent agora building
  spawnOpponentAgora: function(opponent) {
    if (!window.placeBuilding || !window.gfx || !window.gfx.scene) {
      console.warn('🤖 Building system not available for opponent agora');
      return;
    }
    
    // Place agora building at opponent's location
    const agoraBuilding = window.placeBuilding('agora', opponent.agora.x, opponent.agora.y, window.gfx.scene);
    
    if (agoraBuilding) {
      // Mark this building as belonging to the opponent
      agoraBuilding.owner = 'opponent';
      agoraBuilding.opponentId = opponent.name;
      
      // Apply opponent color to the building
      if (agoraBuilding.mesh && agoraBuilding.mesh.material) {
        const opponentMaterial = new BABYLON.StandardMaterial('opponentAgoraMaterial', window.gfx.scene);
        opponentMaterial.diffuseColor = BABYLON.Color3.FromHexString(opponent.color.replace('#', ''));
        opponentMaterial.emissiveColor = BABYLON.Color3.FromHexString(opponent.color.replace('#', '')).scale(0.2);
        agoraBuilding.mesh.material = opponentMaterial;
      }
      
      console.log(`🏛️ Opponent agora placed at (${opponent.agora.x}, ${opponent.agora.y})`);
    }
  },
  
  
  // Start AI behavior for the opponent
  startOpponentAI: function(opponent) {
    // Simple AI that periodically moves units around
    opponent.aiInterval = setInterval(() => {
      this.runOpponentAI(opponent);
    }, 2000 + Math.random() * 3000); // Random interval between 2-5 seconds
    
    console.log('🤖 Opponent AI started');
  },
  
  // Run AI decision making
  runOpponentAI: function(opponent) {
    if (!opponent.units || opponent.units.length === 0) return;
    
    // Randomly select a unit to give a command
    const randomUnit = opponent.units[Math.floor(Math.random() * opponent.units.length)];
    
    if (randomUnit && randomUnit.pb) {
      // Give the unit a random movement command
      const randomX = (Math.random() - 0.5) * 20; // Random position within 20 units
      const randomZ = (Math.random() - 0.5) * 20;
      
      // Apply impulse to move the unit
      randomUnit.pb.imp.x += randomX * 100;
      randomUnit.pb.imp.z += randomZ * 100;
      
      // Random rotation
      randomUnit.pb.rotImp.y += (Math.random() - 0.5) * 2;
      
      console.log(`🤖 AI moved unit to (${randomX.toFixed(1)}, ${randomZ.toFixed(1)})`);
    }
  },
  
  // Stop opponent AI
  stopOpponentAI: function(opponent) {
    if (opponent.aiInterval) {
      clearInterval(opponent.aiInterval);
      opponent.aiInterval = null;
      console.log('🤖 Opponent AI stopped');
    }
  },
  
  // Clean up opponent
  cleanupOpponent: function() {
    if (window.opponent) {
      // Stop AI
      this.stopOpponentAI(window.opponent);
      
      // Remove units from game
      if (window.opponent.units) {
        window.opponent.units.forEach(unit => {
          if (unit.mesh && unit.mesh.dispose) {
            unit.mesh.dispose();
          }
          // Remove from global units array
          const index = window.gameUnits.indexOf(unit);
          if (index > -1) {
            window.gameUnits.splice(index, 1);
          }
        });
      }
      
      // Remove opponent's agora building
      if (window.gameBuildings) {
        const opponentBuildings = window.gameBuildings.filter(building => 
          building.owner === 'opponent' || building.opponentId === window.opponent.name
        );
        
        opponentBuildings.forEach(building => {
          if (building.mesh && building.mesh.dispose) {
            building.mesh.dispose();
          }
          // Remove from buildings array
          const index = window.gameBuildings.indexOf(building);
          if (index > -1) {
            window.gameBuildings.splice(index, 1);
          }
        });
        
        console.log(`🏛️ Cleaned up ${opponentBuildings.length} opponent buildings`);
      }
      
      // Remove transform node
      if (window.opponent.transformNode && window.opponent.transformNode.dispose) {
        window.opponent.transformNode.dispose();
      }
      
      window.opponent = null;
      console.log('🤖 Opponent cleaned up');
    }
  }
};

// Opponent Player class (similar to Player but for AI)
function OpponentPlayer(ops = {}) {
  this.name = ops.name || 'AI Opponent';
  this.color = ops.color || '#FF6B6B';
  this.agora = ops.agora || { x: 100, y: 100 };
  
  // Opponent's controlled units
  this.units = [];
  
  // Opponent's resources (start with same as player)
  this.resources = {
    food: 100,
    wood: 50,
    stone: 25,
    magic: 10
  };
  
  this.scene = gfx.scene;
  this.transformNode = new BABYLON.TransformNode("opponent", this.scene);
  
  // AI behavior properties
  this.aiInterval = null;
  this.lastActionTime = 0;
  this.targetPosition = null;
  
  // Load the opponent's visual representation
  this.loadOpponentMesh();
  
  // Spawn initial villagers around the opponent's agora
  this.spawnInitialVillagers();
}

// Load opponent's visual mesh (different from player)
OpponentPlayer.prototype.loadOpponentMesh = function() {
  const self = this;
  
  // Try to load a different model for the opponent, fallback to frog if not available
  gfx.getModel("assets/models/frog.glb", this.scene).then(function(model) {
    self.frog = model;
    model.root.position = new BABYLON.Vector3(0, 0, 0);
    model.root.parent = self.transformNode;
    model.root.scaling = new BABYLON.Vector3(0.21, 0.21, 0.21);
    
    // Apply opponent color
    const opponentMaterial = new BABYLON.StandardMaterial('opponentMaterial', self.scene);
    opponentMaterial.diffuseColor = BABYLON.Color3.FromHexString(self.color.replace('#', ''));
    opponentMaterial.emissiveColor = BABYLON.Color3.FromHexString(self.color.replace('#', '')).scale(0.3);
    
    model.root.material = opponentMaterial;
    
    console.log('🤖 Opponent mesh loaded');
  }).catch(function(error) {
    console.warn('⚠️ Could not load opponent mesh:', error);
  });
};

// Update opponent position (called from game loop)
OpponentPlayer.prototype.updatePosition = function() {
  if (this.transformNode) {
    // Position the opponent at their agora
    const agoraX = this.agora.x * TILE_SIZE;
    const agoraZ = this.agora.y * TILE_SIZE;
    
    this.transformNode.position.x = agoraX;
    this.transformNode.position.y = 0;
    this.transformNode.position.z = agoraZ;
  }
};

// Add unit to opponent
OpponentPlayer.prototype.addUnit = function(unit) {
  unit.owner = 'opponent';
  this.units.push(unit);
  window.gameUnits.push(unit);
};

// Remove unit from opponent
OpponentPlayer.prototype.removeUnit = function(unit) {
  const index = this.units.indexOf(unit);
  if (index > -1) {
    this.units.splice(index, 1);
  }
  
  const globalIndex = window.gameUnits.indexOf(unit);
  if (globalIndex > -1) {
    window.gameUnits.splice(globalIndex, 1);
  }
};

// Resource management for opponent
OpponentPlayer.prototype.addResource = function(resourceType, amount) {
  if (this.resources.hasOwnProperty(resourceType)) {
    this.resources[resourceType] += amount;
    return true;
  }
  return false;
};

OpponentPlayer.prototype.removeResource = function(resourceType, amount) {
  if (this.resources.hasOwnProperty(resourceType)) {
    if (this.resources[resourceType] >= amount) {
      this.resources[resourceType] -= amount;
      return true;
    }
  }
  return false;
};

// Spawn initial villagers around the opponent's agora
OpponentPlayer.prototype.spawnInitialVillagers = function() {
  if (!window.Unit || !window.gameUnits || !TILE_SIZE) {
    console.warn('🤖 Required systems not ready for opponent villager spawning');
    return;
  }
  
  const agoraX = this.agora.x * TILE_SIZE;
  const agoraZ = this.agora.y * TILE_SIZE;
  
  // Spawn 3-5 villagers around the opponent's agora
  const villagerCount = 3 + Math.floor(Math.random() * 3);
  
  for (let i = 0; i < villagerCount; i++) {
    // Random position around the agora
    const angle = (i / villagerCount) * Math.PI * 2;
    const distance = 2 + Math.random() * 3;
    const x = agoraX + Math.cos(angle) * distance * TILE_SIZE;
    const z = agoraZ + Math.sin(angle) * distance * TILE_SIZE;
    
    // Create villager unit with proper initialization
    const villager = new window.Unit('villager', { x: x, y: 0, z: z });
    if (!villager) {
      console.warn('🤖 Failed to create villager unit');
      continue;
    }
    
    villager.owner = 'opponent';
    villager.rotation = Math.random() * Math.PI * 2;
    
    // Ensure physics body is properly initialized
    if (villager.pb && villager.pb.state) {
      villager.pb.state.loc.x = x;
      villager.pb.state.loc.y = 0;
      villager.pb.state.loc.z = z;
      if (villager.pb.state.rot) {
        villager.pb.state.rot.y = villager.rotation;
      }
    }
    
    // Add to opponent's units and global array
    this.units.push(villager);
    window.gameUnits.push(villager);
  }
  
  console.log(`🤖 Spawned ${villagerCount} opponent villagers`);
};

// Make OpponentSystem available globally
window.OpponentSystem = OpponentSystem;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('🤖 Opponent system initialized');
});
