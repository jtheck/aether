








initPlayer = function(){
  // Menu scene is now purely visual - just create player, no Game object yet
  // Game and units will be spawned when a match actually starts
  window.player = new Player();
  // console.log('✅ Player initialized (menu scene - no game yet)');
}





function Player(ops){
  
  ops = ops || {};
  
  // Player ID - must be provided (no default)
  this.id = ops.id;
  this.name = ops.name || null;
  this.color = ops.color || null;

  // Player's agora location (in tile coordinates)
  this.agora = ops.agora || { x: 15, y: 15 };

  // Player's controlled units
  this.units = [];
  
  // Player's selected units
  this.selectedUnits = [];
  
  // Player's resources
  this.resources = ops.resources || {
    food: 100,
    wood: 50,
    stone: 25,
    magic: 10
  };
  
  // Player's buildings
  this.buildings = [];

  this.cursor = new PBody();
  
  this.scene = gfx.scene;
  this.transformNode = new BABYLON.TransformNode("player", this.scene);
  this.frog;
  

  this.pbody = new PBody();

  // Load the frog mesh
  this.loadFrogMesh();
  
  // Add a flag to follow the player
  this.loadFlag();
  
  // DON'T spawn villagers here - let the Game handle it consistently for all players
  // this.spawnInitialVillagers();

}







function PBody(ops){
  this.mass = ops?.mass ? 1/ops.mass : 100;
  this.friction = -0.3;  // Reduced friction for more responsive movement
  this.rotFriction = -1;  // Strong rotation friction
  

  this.imp = new BABYLON.Vector3();
  this.rotImp = new BABYLON.Vector3();
  
  this.acc = new BABYLON.Vector3(); 
  this.rotAcc = new BABYLON.Vector3();

  this.vel = new BABYLON.Vector3(); 
  this.rotVel = new BABYLON.Vector3();
  


  this.state = {
    // zone: ops.zone,
    loc: ops?.loc ? ops.loc.clone() : new BABYLON.Vector3(),
    rot: new BABYLON.Vector3()
  }

  this.prevState = {
    zone: new BABYLON.Vector3(),
    loc: new BABYLON.Vector3(),
    rot: new BABYLON.Vector3()
  }
}

// Add the integrate method to PBody
PBody.prototype.integrate = function(dt, player, self) {
  // Debug: check initial values (hidden)
  // console.log("Integrate called with dt:", dt, "player:", player, "self:", self);
  // console.log("Initial state.loc:", this.state.loc);
  // console.log("Initial imp:", this.imp);
  // console.log("Initial vel:", this.vel);
  // console.log("Initial acc:", this.acc);
  // console.log("Mass:", this.mass);
  
  // save state
  // this.prevState.zone = this.state.zone.clone();
  this.prevState.loc = this.state.loc.clone();
  this.prevState.rot = this.state.rot.clone();


  this.imp.addInPlace(this.vel.scale(this.friction));
  
  // console.log("After friction, imp:", this.imp);
  
  // Convert impulse to acceleration
  // console.log("Before acc calculation, imp:", this.imp, "mass:", this.mass);
  this.acc.copyFrom(this.imp.scale(this.mass));
  // console.log("After acc calculation, acc:", this.acc);
  // Clear impulses after converting to acceleration - prevents "return to home" behavior
  this.imp.set(0, 0, 0);
  
  // Rotation
  this.rotImp.addInPlace(this.rotVel.scale(this.rotFriction));
  this.rotAcc.copyFrom(this.rotImp.scale(this.mass));
  this.rotImp.set(0, 0, 0);
  
  // No gravity - flat board gameplay
  // console.log("After physics, acc:", this.acc);
  
  // acc -> vel
  // console.log("Before vel update, vel:", this.vel, "dt:", dt);
  this.vel.addInPlace(this.acc.scale(dt));
  // console.log("After vel update, vel:", this.vel);
  // log(this.vel)
  // Zero velocity threshold
  const ZEROVELOCITY = 0.1; // You might need to define this constant
  const velCheck = new BABYLON.Vector3(this.vel.x, this.vel.y * 0.2, this.vel.z);
  if (velCheck.length() < ZEROVELOCITY) {
    this.vel.set(0, 0, 0);
  }
  
  // vel -> pos
  // console.log("Before pos update, state.loc:", this.state.loc, "dt:", dt);
  this.state.loc.addInPlace(this.vel.scale(dt));
  // console.log("After pos update, state.loc:", this.state.loc);
  
  // Rotation velocity
  this.rotVel.addInPlace(this.rotAcc.scale(dt));
  const ZEROROTVELOCITY = 0.01; // You might need to define this constant
  if (this.rotVel.length() < ZEROROTVELOCITY) {
    this.rotVel.set(0, 0, 0);
  }
  
  // rotVel -> rot
  this.state.rot.addInPlace(this.rotVel.scale(dt));
};

// Method to load the frog mesh
Player.prototype.loadFrogMesh = function() {
  const self = this;
  gfx.getModel("assets/models/frog.glb", this.scene).then(function(model) {
    self.frog = model;
    // Position the frog relative to the player
    model.root.position = new BABYLON.Vector3(0, 0, 0);
    // Parent the frog to the player's transform node
    model.root.parent = self.transformNode;
    // Scale the frog appropriately for the player
    model.root.scaling = new BABYLON.Vector3(0.21, 0.21, 0.21);
    
    // Apply the player's color to the frog model
    if (window.currentPlayerColor) {
      self.color = window.currentPlayerColor;
      
      // Create a material with the player's color
      const playerMaterial = new BABYLON.StandardMaterial('playerMaterial', self.scene);
      playerMaterial.diffuseColor = BABYLON.Color3.FromHexString(window.currentPlayerColor.replace('#', ''));
      playerMaterial.emissiveColor = BABYLON.Color3.FromHexString(window.currentPlayerColor.replace('#', '')).scale(0.2); // Add slight glow
      
      // Apply the material to the frog model
      model.root.material = playerMaterial;
      
      // console.log('🎨 Applied player color to frog:', window.currentPlayerColor);
    }
  }).catch(function(error) {
    // console.error("Failed to load frog mesh:", error);
  });
};

// Method to load the flag
Player.prototype.loadFlag = function() {
  const self = this;
  BABYLON.SceneLoader.LoadAssetContainerAsync("assets/models/flag.glb", undefined, this.scene)
    .then(container => {
      const result = container.instantiateModelsToScene();
      const flag = result.rootNodes[0];
      
      // Parent the flag to the player's transform node
      flag.parent = self.transformNode;
      
      // Position the flag relative to the player
      flag.position = new BABYLON.Vector3(0, 0.5, 0); // Slightly above the player
      
      // Scale the flag to be visible
      flag.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
      
      // Stop any animations
      result.animationGroups.forEach(g => g.stop());
      
      // console.log("🚩 Flag attached to player!");
    })
    .catch(error => {
      // console.warn("⚠️ Could not load flag.glb:", error);
    });
};

// Method to update the player's visual position based on physics body
Player.prototype.updatePosition = function() {
  if (this.pbody && this.pbody.state && this.pbody.state.loc) {
    // Debug logging
    // console.log("Updating player position:", this.pbody.state.loc.x, this.pbody.state.loc.y, this.pbody.state.loc.z);
    
    // Update the transform node position to match the physics body
    this.transformNode.position.x = this.pbody.state.loc.x;
    this.transformNode.position.y = this.pbody.state.loc.y;
    this.transformNode.position.z = this.pbody.state.loc.z;
    
    // console.log("Transform node position:", this.transformNode.position.x, this.transformNode.position.y, this.transformNode.position.z);
  } else {
    // console.log("Missing physics body or state:", this.pbody, this.pbody?.state);
  }
};

// Selection management methods
Player.prototype.selectUnit = function(unit) {
  if (!unit || this.selectedUnits.includes(unit)) {
    return false; // Already selected or invalid unit
  }
  
  // Check if unit belongs to this player
  // CRITICAL: Use last 6 chars of player ID for ownership comparison (matches unit.owner format)
  const normalizedPlayerId = this.id.length > 6 ? this.id.slice(-6) : this.id;
  const ownerMatches = (unit.owner === normalizedPlayerId) || (unit.owner === this.id);
  // console.log(`🔍 Selection check: unit.owner="${unit.owner}", player.id="${normalizedPlayerId}", matches=${ownerMatches}`);
  
  if (!ownerMatches) {
    // console.log(`⚠️ Cannot select unit - belongs to ${unit.owner}, not ${normalizedPlayerId} (or 'player')`);
    return false;
  }
  
  this.selectedUnits.push(unit);
  // console.log(`✅ Selected unit: ${unit.name || unit.type} (owner: ${unit.owner})`);
  return true;
};

Player.prototype.deselectUnit = function(unit) {
  const index = this.selectedUnits.indexOf(unit);
  if (index > -1) {
    this.selectedUnits.splice(index, 1);
    // console.log(`❌ Deselected unit: ${unit.name || unit.type}`);
    return true;
  }
  return false;
};

Player.prototype.clearSelection = function() {
  const count = this.selectedUnits.length;
  this.selectedUnits = [];
  if (count > 0) {
    // console.log(`🗑️ Cleared selection of ${count} units`);
  }
  return count;
};

Player.prototype.isUnitSelected = function(unit) {
  return this.selectedUnits.includes(unit);
};

Player.prototype.getSelectedUnits = function() {
  return [...this.selectedUnits]; // Return copy to prevent external modification
};

Player.prototype.getSelectedUnitsOfType = function(type) {
  return this.selectedUnits.filter(unit => unit.type === type);
};

Player.prototype.selectAllUnitsOfType = function(type) {
  // Clear current selection first
  this.clearSelection();
  
  // Find all units of the specified type
  const unitsOfType = this.units.filter(unit => unit.type === type && unit.health > 0);
  
  // Select them all
  unitsOfType.forEach(unit => this.selectUnit(unit));
  
  // console.log(`🎯 Selected all ${unitsOfType.length} units of type: ${type}`);
  return unitsOfType.length;
};

// Resource management methods
Player.prototype.addResource = function(resourceType, amount) {
  if (this.resources.hasOwnProperty(resourceType)) {
    this.resources[resourceType] += amount;
    // console.log(`💰 Added ${amount} ${resourceType}. Total: ${this.resources[resourceType]}`);
    return true;
  }
  // console.warn(`❌ Unknown resource type: ${resourceType}`);
  return false;
};

Player.prototype.removeResource = function(resourceType, amount) {
  if (this.resources.hasOwnProperty(resourceType)) {
    if (this.resources[resourceType] >= amount) {
      this.resources[resourceType] -= amount;
      // console.log(`💰 Removed ${amount} ${resourceType}. Total: ${this.resources[resourceType]}`);
      return true;
    } else {
      // console.warn(`❌ Not enough ${resourceType}. Have: ${this.resources[resourceType]}, Need: ${amount}`);
      return false;
    }
  }
  // console.warn(`❌ Unknown resource type: ${resourceType}`);
  return false;
};

Player.prototype.hasResource = function(resourceType, amount) {
  return this.resources.hasOwnProperty(resourceType) && this.resources[resourceType] >= amount;
};

Player.prototype.getResource = function(resourceType) {
  return this.resources[resourceType] || 0;
};

Player.prototype.getResources = function() {
  return { ...this.resources }; // Return copy to prevent external modification
};

// Spawn initial villagers around the player's agora
Player.prototype.spawnInitialVillagers = function() {
  if (!window.Unit || !window.gameUnits || !TILE_SIZE) {
    // console.warn('❌ Required systems not ready for villager spawning');
    return;
  }
  
  const agoraX = this.agora.x * TILE_SIZE;
  const agoraZ = this.agora.y * TILE_SIZE;
  
  // Spawn 8-12 villagers around the agora
  const villagerCount = 8 + Math.floor(Math.random() * 5);
  
  for (let i = 0; i < villagerCount; i++) {
    // Random position around agora (within 3-6 tiles)
    const angle = (i / villagerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const distance = 3 + Math.random() * 3;
    
    const x = agoraX + Math.cos(angle) * distance * TILE_SIZE;
    const z = agoraZ + Math.sin(angle) * distance * TILE_SIZE;
    
    const villager = new window.Unit('villager', { x, y: 0, z });
    if (!villager) {
      // console.warn('❌ Failed to create villager unit');
      continue;
    }
    
    const ownerId = this.id || window.player?.id;
    villager.owner = ownerId;
    
    // Random rotation
    const randomRotation = Math.random() * Math.PI * 2;
    villager.rotation = randomRotation;
    if (villager.pb.state && villager.pb.state.rot) {
      villager.pb.state.rot.y = randomRotation;
    }
    
    // Add to player's units and global array
    this.units.push(villager);
    window.gameUnits.push(villager);
  }
  
  // console.log(`🏘️ Spawned ${villagerCount} villagers around player's agora`);
};