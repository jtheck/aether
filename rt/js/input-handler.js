class InputHandler {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.canvas = document.getElementById('rt-canvas');
    

    
    // PERFORMANCE OPTIMIZATION: Add caching for expensive operations
    this._screenPosCache = new Map();
    this._cacheFrame = 0;
    this._maxCacheAge = 5; // Cache for 5 frames
    
    // Initialize FTXX Pointer
    this.initFTXXPointer();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Setup keyboard events
    this.setupKeyboardEvents();
    
    // Lasso selection initialization check removed for cleaner code
  }
  

  
  // PERFORMANCE OPTIMIZATION: Fast math utilities
  _fastDistanceSquared(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }
  
  // PERFORMANCE OPTIMIZATION: Cached world-to-screen conversion
  _getCachedScreenPosition(worldPosition) {
    const cacheKey = `${worldPosition.x.toFixed(2)}_${worldPosition.y.toFixed(2)}_${worldPosition.z.toFixed(2)}`;
    const cached = this._screenPosCache.get(cacheKey);
    
    if (cached && (this._cacheFrame - cached.frame) < this._maxCacheAge) {
      return cached.position;
    }
    
    const screenPos = this.worldToScreen(worldPosition);
    if (screenPos) {
      this._screenPosCache.set(cacheKey, {
        position: screenPos,
        frame: this._cacheFrame
      });
    }
    
    return screenPos;
  }
  
  // PERFORMANCE OPTIMIZATION: Clear old cache entries
  _cleanupCache() {
    const cutoffFrame = this._cacheFrame - this._maxCacheAge;
    for (const [key, value] of this._screenPosCache.entries()) {
      if (value.frame < cutoffFrame) {
        this._screenPosCache.delete(key);
      }
    }
  }
  
  getUnitIdFromMesh(mesh) {
    if (!this.game.unitManager) return null;
    
    // Check if the mesh is a unit
    for (const [unitId, unit] of this.game.unitManager.units) {
      if (unit.mesh === mesh) {
        return unitId;
      }
      // Check if it's a child of the unit (for unit parts)
      if (unit.mesh.getChildMeshes && unit.mesh.getChildMeshes().includes(mesh)) {
        return unitId;
      }
    }
    return null;
  }
  
  // PERFORMANCE OPTIMIZATION: Optimized proximity search with early exit and squared distance
  findUnitByProximity(screenX, screenY, maxDistance = 50) {
    if (!this.game.unitManager) return null;
    

    
    // PERFORMANCE OPTIMIZATION: Use squared distance to avoid Math.sqrt
    const maxDistanceSquared = maxDistance * maxDistance;
    let closestUnitId = null;
    let closestDistanceSquared = Infinity;
    
    // PERFORMANCE OPTIMIZATION: Increment cache frame for cleanup
    this._cacheFrame++;
    if (this._cacheFrame % 30 === 0) { // Cleanup every 30 frames
      this._cleanupCache();
    }
    
    for (const [unitId, unit] of this.game.unitManager.units) {
      // PERFORMANCE OPTIMIZATION: Use cached screen position
      const screenPos = this._getCachedScreenPosition(unit.mesh.position);
      if (!screenPos) continue;
      
      // PERFORMANCE OPTIMIZATION: Use fast squared distance calculation
      const distanceSquared = this._fastDistanceSquared(screenX, screenY, screenPos.x, screenPos.y);
      
      // PERFORMANCE OPTIMIZATION: Early exit if within range and closer than previous
      if (distanceSquared <= maxDistanceSquared && distanceSquared < closestDistanceSquared) {
        closestDistanceSquared = distanceSquared;
        closestUnitId = unitId;
        
        // PERFORMANCE OPTIMIZATION: Early exit if very close (within 10 pixels)
        if (distanceSquared <= 100) {
          return unitId;
        }
      }
    }
    
    if (closestUnitId) {
      return closestUnitId;
    }
    return null;
  }
  
  worldToScreen(worldPosition) {
    const camera = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    
    if (!canvas) return null;
    
    const screenPosition = BABYLON.Vector3.Project(
      worldPosition,
      BABYLON.Matrix.Identity(),
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(canvas.width, canvas.height)
    );
    
    return {
      x: screenPosition.x,
      y: screenPosition.y
    };
  }
  
  // Add keyboard event handling
  setupKeyboardEvents() {
    // Escape key to deselect
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        if (this.game.unitManager) {
          this.game.unitManager.deselectAllUnits();
        }
        if (this.game) {
          this.game.deselectAll();
        }

      }
      
      // Arrow keys for camera panning (alpha only, like two-finger pan)
      const camera = this.scene.activeCamera;
      const panSpeed = 0.1;
      
      switch (evt.key) {
        case 'ArrowLeft':
          camera.alpha -= panSpeed;
          break;
        case 'ArrowRight':
          camera.alpha += panSpeed;
          break;
        case 'ArrowUp':
          // Could add beta movement here if needed, but keeping consistent with touch
          break;
        case 'ArrowDown':
          // Could add beta movement here if needed, but keeping consistent with touch
          break;
      }
    });
  }
  
  dispose() {
    // Clean up event listeners
    if (this.ftxx && this.canvas) {
      this.ftxx.off(this.canvas, ['tap', 'longpress', 'wheel', 'pinch', 'pan', 'rotate']);
    }
    
    // PERFORMANCE OPTIMIZATION: Clear cache
    this._screenPosCache.clear();
  }
} 