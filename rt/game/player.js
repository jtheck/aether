








initPlayer = function(){
  window.player = new Player();
  
  // Start the game loop for physics updates
  if (window.gameLoop && window.gameLoop.start) {
    window.gameLoop.start();
  }
}





function Player(ops){

  this.name;
  this.color;


  this.cursor = new PBody();
  
  this.scene = gfx.scene;
  this.transformNode = new BABYLON.TransformNode("player", this.scene);
  this.frog;
  

  this.pbody = new PBody();

  // Load the frog mesh
  this.loadFrogMesh();
  
  // Add a flag to follow the player
  this.loadFlag();

}







function PBody(ops){
  this.mass = ops?.mass ? 1/ops.mass : 1/200;
  this.friction = -75;  // Strong friction - quick slowdown, snappy feel
  this.rotFriction = -75;  // Strong rotation friction
  

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

  // imp -> acc
  // Friction
  if (self && window.tr && window.tr.self && window.tr.self.aloft) {
    // console.log("Applying airborne friction");
    this.imp.addInPlace(this.vel.scale(this.friction * 0.32));
  } else {
    // console.log("Applying normal friction");
    this.imp.addInPlace(this.vel.scale(this.friction));
  }
  
  // console.log("After friction, imp:", this.imp);
  
  // Airborne Impulse Whiff
  if (player && window.tr && window.tr.self && window.tr.self.aloft) {
    const airMod = 0.5; // You might need to define this constant
    // console.log("Applying air modifier:", airMod);
    this.imp.scaleInPlace(airMod);
  }

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
  
  // Zero velocity threshold
  const ZEROVELOCITY = 0.01; // You might need to define this constant
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
  }).catch(function(error) {
    console.error("Failed to load frog mesh:", error);
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
      
      console.log("🚩 Flag attached to player!");
    })
    .catch(error => {
      console.warn("⚠️ Could not load flag.glb:", error);
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