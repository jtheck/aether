class OnScreenUI {
  constructor(game) {
    this.game = game;
    this.createOnScreenElements();
  }
  
  createOnScreenElements() {
    // Create on-screen UI container
    this.onScreenContainer = document.createElement('div');
    this.onScreenContainer.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      z-index: 1000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    
    // Create selection mode indicator
    this.selectionIndicator = document.createElement('div');
    this.selectionIndicator.style.cssText = `
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      border-left: 3px solid #4CAF50;
      margin-bottom: 5px;
    `;
    this.selectionIndicator.innerHTML = 'Selection: Lasso';
    
    // Create selected units counter
    this.unitsCounter = document.createElement('div');
    this.unitsCounter.style.cssText = `
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      border-left: 3px solid #2196F3;
    `;
    this.unitsCounter.innerHTML = 'Selected: 0 units';
    
    // Add elements to container
    this.onScreenContainer.appendChild(this.selectionIndicator);
    this.onScreenContainer.appendChild(this.unitsCounter);
    
    // Add to document
    document.body.appendChild(this.onScreenContainer);
    
    // Initial update
    this.update();
  }
  
  updateSelectionMode(mode) {
    this.selectionIndicator.innerHTML = `Selection: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
    
    // Update border color based on mode
    if (mode === 'lasso') {
      this.selectionIndicator.style.borderLeftColor = '#FF9800';
    } else {
      this.selectionIndicator.style.borderLeftColor = '#4CAF50';
    }
  }
  
  updateSelectedUnits() {
    const selectedCount = this.game.unitManager.selectedUnits.size;
    this.unitsCounter.innerHTML = `Selected: ${selectedCount} unit${selectedCount !== 1 ? 's' : ''}`;
  }
  
  update() {
    this.updateSelectionMode(this.game.getSelectionMode());
    this.updateSelectedUnits();
  }
  
  dispose() {
    if (this.onScreenContainer && this.onScreenContainer.parentNode) {
      this.onScreenContainer.parentNode.removeChild(this.onScreenContainer);
    }
  }
} 