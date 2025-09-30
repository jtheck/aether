






function Game(ops) {
  this.type = ops.type || 'default';
  this.map = ops.map || 'default';
  this.players = ops.players || [];
  this.startTime = Date.now();
  this.gameState = 'initializing'; // initializing, running, paused, ended
  
  // Initialize the game
  this.init();
}

Game.prototype.init = function() {
  // console.log('🎮 Game initializing...', {
  //   type: this.type,
  //   map: this.map,
  //   startTime: new Date(this.startTime).toLocaleTimeString()
  // });
  
  // Set game state to running
  this.gameState = 'running';
  
  // Spawn initial game elements
  this.spawnInitialUnits();
  
  // console.log('🎮 Game initialized and running!');
};

Game.prototype.spawnInitialUnits = function() {
  // console.log('🏘️ Spawning initial game units...');
  
  // Spawn player villagers around their agora
  if (window.spawnAgoraVillagers) {
    window.spawnAgoraVillagers();
    // console.log('✅ Player villagers spawned');
  } else {
    // console.warn('❌ spawnAgoraVillagers function not found');
  }
  
  // Add other initial unit spawning here as needed
  // - Neutral units
  // - Resources
  // - Starting buildings
  // etc.
};

Game.prototype.getGameTime = function() {
  return Date.now() - this.startTime;
};

Game.prototype.getGameTimeFormatted = function() {
  const gameTime = this.getGameTime();
  const minutes = Math.floor(gameTime / 60000);
  const seconds = Math.floor((gameTime % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Game loop with proper delta time tracking and fixed physics timestep
window.gameLoop = {
  lastTime: 0,
  deltaTime: 0,
  frameCounter: 0,
  physicsTime: 0, // Accumulated time for physics
  physicsTimestep: 1/60, // Fixed 60Hz physics (16.67ms)
  
  start: function() {
    this.lastTime = performance.now();
    this.frameCounter = 0;
    this.physicsTime = 0;
    this.update();
  },
  
  update: function() {
    const currentTime = performance.now();
    this.deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;
    this.frameCounter++;
    
    // Make frame counter globally available
    window.frameCounter = this.frameCounter;
    
    // Cap delta time to prevent huge jumps (e.g., when tab is inactive)
    if (this.deltaTime > 0.1) {
      this.deltaTime = 0.1; // Cap at 100ms
    }
    
    // Accumulate time for physics
    this.physicsTime += this.deltaTime;
    
    // Run physics at fixed timestep (60Hz)
    let physicsSteps = 0;
    while (this.physicsTime >= this.physicsTimestep) {
      // Update units and their behaviors (this applies impulses)
      if (window.units && window.units.update) {
        window.units.update(this.physicsTimestep);
      }
      
  // THIS LINE IS CRITICAL - Step all unit behaviors!
  if (window.behaviorManager) {
    window.behaviorManager.stepBehaviors();
  }
  // Update idle units (give them wander behaviors)
  if (window.updateIdleUnits) {
    window.updateIdleUnits();
  }
  // Update physics for all units with LOD optimization
  if (window.gameUnits) {
    // log(window.gameUnits[0].pb.state.loc)
    window.gameUnits.forEach(unit => {
      if (unit.pb && unit.pb.integrate) {
        // Skip physics updates for neutral units that are far away (use squared distance)
        if (unit.owner === 'neutral' && unit.distanceToCameraSquared > 90000) { // 300^2
          return; // Skip physics integration for distant neutral units
        }
        unit.pb.integrate(this.physicsTimestep, false, false);
      }
    });
  }
      
      // Update player physics
      if (window.player && window.player.pbody && window.player.pbody.integrate) {
        window.player.pbody.integrate(this.physicsTimestep, true, true);
      }
      
      // Step physics time forward
      this.physicsTime -= this.physicsTimestep;
      physicsSteps++;
    }
    
    // Debug: log physics timestep info
    if (physicsSteps > 0) {
      // console.log(`⚡ Physics: ${physicsSteps} steps at ${(this.physicsTimestep * 1000).toFixed(1)}ms, remaining: ${(this.physicsTime * 1000).toFixed(1)}ms`);
    }
    
    // Update unit meshes (visual positions) every frame for smooth rendering
    if (window.updateUnitMeshes) {
      window.updateUnitMeshes();
    }
    
    // Update visual position
    if (window.player && window.player.updatePosition) {
      window.player.updatePosition();
    }
    
    // Continue the loop
    requestAnimationFrame(() => this.update());
  }

};



