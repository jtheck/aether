class LassoSelection {
  constructor(scene, unitManager) {
    this.scene = scene;
    this.unitManager = unitManager;
    this.isSelecting = false;
    this.points = [];
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.isEnabled = false;
    
    this.setupLassoCanvas();
    this.setupEventListeners();
  }
  
  setupLassoCanvas() {
    // Create canvas overlay for lasso drawing
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999;
      display: none;
    `;
    
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;
    
    this.ctx = this.canvas.getContext('2d');
    
    // Add to the canvas container
    const gameCanvas = document.getElementById('rt-canvas');
    gameCanvas.parentNode.appendChild(this.overlay);
    this.overlay.appendChild(this.canvas);
    
    // Set canvas size
    this.resizeCanvas();
    
    // Handle window resize
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });
  }
  
  resizeCanvas() {
    const gameCanvas = document.getElementById('rt-canvas');
    this.canvas.width = gameCanvas.width;
    this.canvas.height = gameCanvas.height;
  }
  
  setupEventListeners() {
    // Event handling is now managed by the InputHandler class
    // This method is kept for compatibility but no longer needed
  }
  
  startLasso(screenX, screenY) {
    this.isSelecting = true;
    this.points = [{ x: screenX, y: screenY }];
    
    // Show lasso canvas
    this.overlay.style.display = 'block';
    this.overlay.style.pointerEvents = 'auto';
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // console.log('Lasso started at:', screenX, screenY);
  }
  
  updateLasso(screenX, screenY) {
    if (!this.isSelecting) return;
    
    // Add new point
    this.points.push({ x: screenX, y: screenY });
    
    // Draw lasso
    this.drawLasso();
    
    // console.log('Lasso updated to:', screenX, screenY);
  }
  
  endLasso() {
    if (!this.isSelecting) return;
    
    this.isSelecting = false;
    this.overlay.style.display = 'none';
    this.overlay.style.pointerEvents = 'none';
    
    // Close the lasso by connecting to start point
    if (this.points.length > 2) {
      this.points.push(this.points[0]);
      this.drawLasso();
      
      // Select units within the lasso
      this.selectUnitsInLasso();
    }
  }
  
  drawLasso() {
    if (this.points.length < 2) return;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Set drawing style
    this.ctx.strokeStyle = '#4CAF50';
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    // Draw lasso path
    this.ctx.beginPath();
    this.ctx.moveTo(this.points[0].x, this.points[0].y);
    
    for (let i = 1; i < this.points.length; i++) {
      this.ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    
    this.ctx.stroke();
    
    // Fill with semi-transparent color
    this.ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
    this.ctx.fill();
  }
  
  selectUnitsInLasso() {
    if (this.points.length < 3) return;
    
    const selectedUnitIds = [];
    
    // Check each unit by projecting their world position to screen coordinates
    this.unitManager.units.forEach((unit, unitId) => {
      const unitWorldPos = unit.position;
      
      // Project unit world position to screen coordinates
      const screenPos = this.worldToScreen(unitWorldPos);
      
      if (screenPos) {
        // Check if unit is within lasso bounds using point-in-polygon test
        if (this.pointInPolygon(screenPos, this.points)) {
          selectedUnitIds.push(unitId);
        }
      }
    });
    
    // Select the units
    if (selectedUnitIds.length > 0) {
      this.unitManager.selectUnits(selectedUnitIds);
    } else {
      // If no units selected, deselect all
      this.unitManager.deselectAllUnits();
    }
  }
  
  pointInPolygon(point, polygon) {
    // Ray casting algorithm for point-in-polygon test
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }
  
  worldToScreen(worldPosition) {
    // Convert world position to screen coordinates
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
  
  getUnitIdFromMesh(mesh) {
    // Find which unit this mesh belongs to
    for (const [unitId, unit] of this.unitManager.units) {
      if (unit.mesh === mesh) {
        return unitId;
      }
    }
    return null;
  }
  
  enable() {
    this.isEnabled = true;
  }
  
  disable() {
    this.isEnabled = false;
    // Hide overlay if it's visible
    if (this.overlay) {
      this.overlay.style.display = 'none';
      this.overlay.style.pointerEvents = 'none';
    }
  }
  
  dispose() {
    if (this.overlay) {
      this.overlay.remove();
    }
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
    }
  }
} 