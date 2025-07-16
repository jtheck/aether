class UI {
  constructor(game) {
    this.game = game;
    this.menuOpen = false;
    
    // Create UI elements
    this.createUI();
  }
  
  createUI() {
    // Create main UI container
    this.uiContainer = document.createElement('div');
    this.uiContainer.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 1000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;
    
    // Create menu button
    this.menuButton = document.createElement('button');
    this.menuButton.innerHTML = '☰';
    this.menuButton.style.cssText = `
      width: 50px;
      height: 50px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      border: 2px solid #4CAF50;
      border-radius: 8px;
      font-size: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
    `;
    
    this.menuButton.addEventListener('mouseenter', () => {
      this.menuButton.style.background = 'rgba(0, 0, 0, 0.9)';
      this.menuButton.style.borderColor = '#66BB6A';
    });
    
    this.menuButton.addEventListener('mouseleave', () => {
      this.menuButton.style.background = 'rgba(0, 0, 0, 0.8)';
      this.menuButton.style.borderColor = '#4CAF50';
    });
    
    // Create menu panel
    this.menuPanel = document.createElement('div');
    this.menuPanel.style.cssText = `
      position: absolute;
      top: 60px;
      right: 0;
      width: 250px;
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid #4CAF50;
      border-radius: 8px;
      padding: 15px;
      color: white;
      display: none;
      backdrop-filter: blur(10px);
    `;
    
    // Create menu content
    this.createMenuContent();
    
    // Add elements to container
    this.uiContainer.appendChild(this.menuButton);
    this.uiContainer.appendChild(this.menuPanel);
    
    // Add to document
    document.body.appendChild(this.uiContainer);
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  createMenuContent() {
    this.menuPanel.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 15px 0; color: #4CAF50; text-align: center;">Game Options</h3>
        
                 <div style="margin-bottom: 15px;">
           <label style="display: block; margin-bottom: 5px; color: #ccc;">Selection Mode:</label>
           <button id="selection-mode-btn" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Rectangle</button>
         </div>
         
         <div style="margin-bottom: 15px;">
           <label style="display: block; margin-bottom: 5px; color: #ccc;">Main Light:</label>
           <button id="main-light-btn" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">ON</button>
         </div>
         
         <div style="margin-bottom: 15px;">
           <label style="display: block; margin-bottom: 5px; color: #ccc;">Fill Light:</label>
           <button id="fill-light-btn" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">ON</button>
         </div>
         
         <div style="margin-bottom: 15px;">
           <label style="display: block; margin-bottom: 5px; color: #ccc;">Ambient Light:</label>
           <button id="ambient-light-btn" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">ON</button>
         </div>
         
         <div style="margin-bottom: 15px;">
           <label style="display: block; margin-bottom: 5px; color: #ccc;">Point Light:</label>
           <button id="point-light-btn" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">ON</button>
         </div>
        
        <div style="margin-bottom: 15px;">
          <button id="pause-btn" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 5px;">Pause Game</button>
          <button id="reset-btn" style="width: 100%; padding: 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">Reset Camera</button>
        </div>
        
                 <div style="margin-bottom: 15px;">
           <h4 style="margin: 0 0 10px 0; color: #2196F3;">Controls</h4>
           <div style="font-size: 12px; color: #ccc; line-height: 1.4;">
             <div><strong>ESDF/WASD:</strong> Move camera</div>
             <div><strong>RQ:</strong> Zoom in/out</div>
             <div><strong>Space:</strong> Reset camera</div>
             <div><strong>Escape:</strong> Deselect units</div>
             <div><strong>Left Click:</strong> Select/Move units</div>
             <div><strong>Middle Mouse:</strong> Pan camera</div>
             <div><strong>Mouse Wheel:</strong> Zoom</div>
           </div>
         </div>
        
        
      </div>
    `;
  }
  
  setupEventListeners() {
    // Menu toggle
    this.menuButton.addEventListener('click', () => {
      this.toggleMenu();
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.uiContainer.contains(e.target)) {
        this.closeMenu();
      }
    });
    
    // Selection mode toggle
    const selectionModeBtn = document.getElementById('selection-mode-btn');
    selectionModeBtn.addEventListener('click', () => {
      const newMode = this.game.toggleSelectionMode();
      selectionModeBtn.textContent = newMode.charAt(0).toUpperCase() + newMode.slice(1);
      
      if (newMode === 'lasso') {
        selectionModeBtn.style.background = '#FF9800';
      } else {
        selectionModeBtn.style.background = '#4CAF50';
      }
    });
    
    // Main light toggle
    const mainLightBtn = document.getElementById('main-light-btn');
    mainLightBtn.addEventListener('click', () => {
      const directionalLight = this.game.scene.directionalLight;
      if (directionalLight.intensity > 0) {
        directionalLight.intensity = 0;
        mainLightBtn.textContent = 'OFF';
        mainLightBtn.style.background = '#f44336';
      } else {
        directionalLight.intensity = 1.2;
        mainLightBtn.textContent = 'ON';
        mainLightBtn.style.background = '#4CAF50';
      }
    });
    
    // Fill light toggle
    const fillLightBtn = document.getElementById('fill-light-btn');
    fillLightBtn.addEventListener('click', () => {
      const fillLight = this.game.scene.fillLight;
      if (fillLight.intensity > 0) {
        fillLight.intensity = 0;
        fillLightBtn.textContent = 'OFF';
        fillLightBtn.style.background = '#f44336';
      } else {
        fillLight.intensity = 0.4;
        fillLightBtn.textContent = 'ON';
        fillLightBtn.style.background = '#4CAF50';
      }
    });
    
    // Ambient light toggle
    const ambientLightBtn = document.getElementById('ambient-light-btn');
    ambientLightBtn.addEventListener('click', () => {
      const ambientLight = this.game.scene.ambientLight;
      if (ambientLight.intensity > 0) {
        ambientLight.intensity = 0;
        ambientLightBtn.textContent = 'OFF';
        ambientLightBtn.style.background = '#f44336';
      } else {
        ambientLight.intensity = 0.3;
        ambientLightBtn.textContent = 'ON';
        ambientLightBtn.style.background = '#4CAF50';
      }
    });
    
    // Point light toggle
    const pointLightBtn = document.getElementById('point-light-btn');
    pointLightBtn.addEventListener('click', () => {
      const pointLight = this.game.scene.pointLight;
      if (pointLight.intensity > 0) {
        pointLight.intensity = 0;
        pointLightBtn.textContent = 'OFF';
        pointLightBtn.style.background = '#f44336';
      } else {
        pointLight.intensity = 0.6;
        pointLightBtn.textContent = 'ON';
        pointLightBtn.style.background = '#4CAF50';
      }
    });
    
    // Pause/Resume button
    const pauseBtn = document.getElementById('pause-btn');
    pauseBtn.addEventListener('click', () => {
      if (this.game.isRunning) {
        this.game.stop();
        pauseBtn.textContent = 'Resume Game';
        pauseBtn.style.background = '#FF9800';
      } else {
        this.game.start();
        pauseBtn.textContent = 'Pause Game';
        pauseBtn.style.background = '#4CAF50';
      }
    });
    
    // Reset button
    const resetBtn = document.getElementById('reset-btn');
    resetBtn.addEventListener('click', () => {
      this.resetCamera();
    });
    
    // Set initial button states
    const initialMode = this.game.getSelectionMode();
    selectionModeBtn.textContent = initialMode.charAt(0).toUpperCase() + initialMode.slice(1);
    if (initialMode === 'lasso') {
      selectionModeBtn.style.background = '#FF9800';
    }
  }
  
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
    this.menuPanel.style.display = this.menuOpen ? 'block' : 'none';
    
    // Update menu button
    this.menuButton.innerHTML = this.menuOpen ? '✕' : '☰';
  }
  
  closeMenu() {
    this.menuOpen = false;
    this.menuPanel.style.display = 'none';
    this.menuButton.innerHTML = '☰';
  }
  
  resetCamera() {
    const camera = this.game.scene.activeCamera;
    camera.target = new BABYLON.Vector3(0, 0, 0);
    camera.radius = 25;
    camera.alpha = 0;
    camera.beta = Math.PI / 4;
  }
  
  // Update UI (called from game loop)
  update() {
    // Menu UI doesn't need regular updates
  }
  
  // Cleanup
  dispose() {
    if (this.uiContainer && this.uiContainer.parentNode) {
      this.uiContainer.parentNode.removeChild(this.uiContainer);
    }
  }
}
