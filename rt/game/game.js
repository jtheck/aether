






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
  console.log('🎮 Game initializing...', {
    type: this.type,
    map: this.map,
    startTime: new Date(this.startTime).toLocaleTimeString()
  });
  
  // Set game state to running
  this.gameState = 'running';
  
  // Spawn initial game elements
  this.spawnInitialUnits();
  
  console.log('🎮 Game initialized and running!');
};

Game.prototype.spawnInitialUnits = function() {
  console.log('🏘️ Spawning initial game units...');
  
  // Spawn player villagers around their agora
  if (window.spawnAgoraVillagers) {
    window.spawnAgoraVillagers();
    console.log('✅ Player villagers spawned');
  } else {
    console.warn('❌ spawnAgoraVillagers function not found');
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

// Game loop with proper delta time tracking
window.gameLoop = {
  lastTime: 0,
  deltaTime: 0,
  
  start: function() {
    this.lastTime = performance.now();
    this.update();
  },
  
  update: function() {
    const currentTime = performance.now();
    this.deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;
    
    // Cap delta time to prevent huge jumps (e.g., when tab is inactive)
    if (this.deltaTime > 0.1) {
      this.deltaTime = 0.1; // Cap at 100ms
    }
    
    // Debug: log dt values
    // console.log("Game loop dt:", this.deltaTime, "ms:", this.deltaTime * 1000);
    
    // Update units
    if (window.units && window.units.update) {
      window.units.update();
    }
    
    // Update physics
    if (window.player && window.player.pbody && window.player.pbody.integrate) {
      window.player.pbody.integrate(this.deltaTime, true, true);
    }
    
    // Update visual position
    if (window.player && window.player.updatePosition) {
      window.player.updatePosition();
    }
    
    // Continue the loop
    requestAnimationFrame(() => this.update());
  }
};



