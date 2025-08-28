






function Game(ops){
  this.type;
  this.map;
  this.players;
}

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