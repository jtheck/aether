class SelectionRectangle {
  constructor(scene, unitManager) {
    this.scene = scene;
    this.unitManager = unitManager;
    this.isSelecting = false;
    this.startScreenPoint = null;
    this.endScreenPoint = null;
    this.rectangleElement = null;
    this.isEnabled = false;
    
    this.setupSelectionRectangle();
    this.setupEventListeners();
  }
  
  setupSelectionRectangle() {
    // Create a 2D overlay element for the selection rectangle
    this.rectangleElement = document.createElement('div');
    this.rectangleElement.style.position = 'absolute';
    this.rectangleElement.style.border = '2px solid #4CAF50';
    this.rectangleElement.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
    this.rectangleElement.style.pointerEvents = 'none';
    this.rectangleElement.style.zIndex = '1000';
    this.rectangleElement.style.display = 'none';
    
    // Add to the canvas container
    const canvas = document.getElementById('rt-canvas');
    canvas.parentNode.appendChild(this.rectangleElement);
    
    // Add keyboard event listener for Escape key
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        this.unitManager.deselectAllUnits();
        console.log('Deselected all units (Escape key)');
      }
    });
  }
  
  setupEventListeners() {
    // Event handling is now managed by the InputHandler class
    // This method is kept for compatibility but no longer needed
  }
  
  startSelection(screenX, screenY) {
    this.isSelecting = true;
    this.startScreenPoint = { x: screenX, y: screenY };
    this.endScreenPoint = { x: screenX, y: screenY };
    
    // Show selection rectangle
    this.rectangleElement.style.display = 'block';
    this.updateRectangleVisual();
    
    console.log('Selection started at:', screenX, screenY);
  }
  
  updateSelection(screenX, screenY) {
    if (!this.isSelecting) return;
    
    this.endScreenPoint = { x: screenX, y: screenY };
    this.updateRectangleVisual();
    
    console.log('Selection updated to:', screenX, screenY);
  }
  
  endSelection() {
    if (!this.isSelecting) return;
    
    this.isSelecting = false;
    this.rectangleElement.style.display = 'none';
    
    // Select units within the rectangle
    this.selectUnitsInRectangle();
  }
  
  updateRectangleVisual() {
    if (!this.startScreenPoint || !this.endScreenPoint) return;
    
    // Calculate rectangle dimensions in screen space
    const left = Math.min(this.startScreenPoint.x, this.endScreenPoint.x);
    const top = Math.min(this.startScreenPoint.y, this.endScreenPoint.y);
    const width = Math.abs(this.endScreenPoint.x - this.startScreenPoint.x);
    const height = Math.abs(this.endScreenPoint.y - this.startScreenPoint.y);
    
    // Update rectangle element
    this.rectangleElement.style.left = left + 'px';
    this.rectangleElement.style.top = top + 'px';
    this.rectangleElement.style.width = width + 'px';
    this.rectangleElement.style.height = height + 'px';
  }
  
  selectUnitsInRectangle() {
    if (!this.startScreenPoint || !this.endScreenPoint) return;
    
    // Calculate screen rectangle bounds
    const minScreenX = Math.min(this.startScreenPoint.x, this.endScreenPoint.x);
    const maxScreenX = Math.max(this.startScreenPoint.x, this.endScreenPoint.x);
    const minScreenY = Math.min(this.startScreenPoint.y, this.endScreenPoint.y);
    const maxScreenY = Math.max(this.startScreenPoint.y, this.endScreenPoint.y);
    
    const selectedUnitIds = [];
    
    // Check each unit by projecting their world position to screen coordinates
    this.unitManager.units.forEach((unit, unitId) => {
      const unitWorldPos = unit.position;
      
      // Project unit world position to screen coordinates
      const screenPos = this.worldToScreen(unitWorldPos);
      
      if (screenPos) {
        // Check if unit is within screen rectangle bounds
        if (screenPos.x >= minScreenX && screenPos.x <= maxScreenX &&
            screenPos.y >= minScreenY && screenPos.y <= maxScreenY) {
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
    // Hide rectangle if it's visible
    if (this.rectangleElement) {
      this.rectangleElement.style.display = 'none';
    }
  }
  
  dispose() {
    if (this.rectangleElement) {
      this.rectangleElement.remove();
    }
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
    }
  }
} 