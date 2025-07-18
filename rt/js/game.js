class Game {
  constructor(scene, engine) {
    this.scene = scene;
    this.engine = engine;
    this.isRunning = false;
    this.lastTime = 0;
    this.deltaTime = 0;
    
    // Game state
    this.selectedObject = null;
    this.objects = [];
    this.gameObjects = new Map();
    
    // Initialize terrain
    this.terrainGenerator = new TerrainGenerator(scene);
    
    // Initialize unit manager
    this.unitManager = new UnitManager(scene, this.terrainGenerator);
    
    // Initialize selection systems
    this.selectionMode = 'lasso'; // 'rectangle' or 'lasso' - lasso is default
    this.selectionRectangle = new SelectionRectangle(scene, this.unitManager);
    this.lassoSelection = new LassoSelection(scene, this.unitManager);
    
    // Set initial selection mode
    this.setSelectionMode(this.selectionMode);
    
    // Initialize game objects
    this.initializeGameObjects();
    
    // Initialize unified input handler
    this.inputHandler = new InputHandler(scene, this);
    
    // Setup game loop
    this.setupGameLoop();
  }
  
  initializeGameObjects() {
    // Create game objects and store references
    this.createGameObjects();
    
    // Add click events to all objects
    this.setupObjectSelection();
  }
  
  createGameObjects() {
    // Create tiled terrain first
    const terrainTiles = this.terrainGenerator.createTiledTerrain();
    
    // Add scattered objects to terrain
    const scatteredObjects = this.terrainGenerator.addScatteredObjects();
    
    // Create some initial units
    this.createInitialUnits();
    
    // Add scattered rocks to game objects
    scatteredObjects.forEach((rock, index) => {
      this.gameObjects.set(rock, {
        type: 'rock',
        name: `Rock ${index + 1}`,
        isSelected: false,
        originalColor: rock.material.diffuseColor.clone()
      });
    });
    
    this.objects = [...scatteredObjects];
  }
  
  createInitialUnits() {
    // Spawn units on the guaranteed flat center tile
    const centerTileSize = this.terrainGenerator.tileSize;
    const halfTile = centerTileSize / 2;
    
    // Blue team units on the left side of center tile
    const blueUnits = [
      { type: 'infantry', pos: new BABYLON.Vector3(-halfTile + 2, 0.5, -halfTile + 2) },
      { type: 'tank', pos: new BABYLON.Vector3(-halfTile + 6, 0.5, -halfTile + 2) },
      { type: 'artillery', pos: new BABYLON.Vector3(-halfTile + 10, 0.5, -halfTile + 2) },
      { type: 'cavalry', pos: new BABYLON.Vector3(-halfTile + 2, 0.5, -halfTile + 6) },
      { type: 'scout', pos: new BABYLON.Vector3(-halfTile + 6, 0.5, -halfTile + 6) },
      { type: 'heavy_tank', pos: new BABYLON.Vector3(-halfTile + 10, 0.5, -halfTile + 6) },
      { type: 'anti_air', pos: new BABYLON.Vector3(-halfTile + 2, 0.5, -halfTile + 10) },
      { type: 'engineer', pos: new BABYLON.Vector3(-halfTile + 6, 0.5, -halfTile + 10) },
      { type: 'medic', pos: new BABYLON.Vector3(-halfTile + 10, 0.5, -halfTile + 10) },
      { type: 'sniper', pos: new BABYLON.Vector3(-halfTile + 2, 0.5, -halfTile + 14) },
      { type: 'infantry', pos: new BABYLON.Vector3(-halfTile + 6, 0.5, -halfTile + 14) },
      { type: 'tank', pos: new BABYLON.Vector3(-halfTile + 10, 0.5, -halfTile + 14) },
      { type: 'cavalry', pos: new BABYLON.Vector3(-halfTile + 2, 0.5, -halfTile + 18) },
      { type: 'scout', pos: new BABYLON.Vector3(-halfTile + 6, 0.5, -halfTile + 18) },
      { type: 'artillery', pos: new BABYLON.Vector3(-halfTile + 10, 0.5, -halfTile + 18) }
    ];
    
    // Red team units on the right side of center tile
    const redUnits = [
      { type: 'infantry', pos: new BABYLON.Vector3(halfTile - 2, 0.5, halfTile - 2) },
      { type: 'tank', pos: new BABYLON.Vector3(halfTile - 6, 0.5, halfTile - 2) },
      { type: 'artillery', pos: new BABYLON.Vector3(halfTile - 10, 0.5, halfTile - 2) },
      { type: 'cavalry', pos: new BABYLON.Vector3(halfTile - 2, 0.5, halfTile - 6) },
      { type: 'scout', pos: new BABYLON.Vector3(halfTile - 6, 0.5, halfTile - 6) },
      { type: 'heavy_tank', pos: new BABYLON.Vector3(halfTile - 10, 0.5, halfTile - 6) },
      { type: 'anti_air', pos: new BABYLON.Vector3(halfTile - 2, 0.5, halfTile - 10) },
      { type: 'engineer', pos: new BABYLON.Vector3(halfTile - 6, 0.5, halfTile - 10) },
      { type: 'medic', pos: new BABYLON.Vector3(halfTile - 10, 0.5, halfTile - 10) },
      { type: 'sniper', pos: new BABYLON.Vector3(halfTile - 2, 0.5, halfTile - 14) },
      { type: 'infantry', pos: new BABYLON.Vector3(halfTile - 6, 0.5, halfTile - 14) },
      { type: 'tank', pos: new BABYLON.Vector3(halfTile - 10, 0.5, halfTile - 14) },
      { type: 'cavalry', pos: new BABYLON.Vector3(halfTile - 2, 0.5, halfTile - 18) },
      { type: 'scout', pos: new BABYLON.Vector3(halfTile - 6, 0.5, halfTile - 18) },
      { type: 'artillery', pos: new BABYLON.Vector3(halfTile - 10, 0.5, halfTile - 18) }
    ];
    
    // Create blue team units
    blueUnits.forEach(unit => {
      this.unitManager.createUnit(unit.type, unit.pos, 'blue');
    });
    
    // Create red team units
    redUnits.forEach(unit => {
      this.unitManager.createUnit(unit.type, unit.pos, 'red');
    });
    
    console.log(`Created ${blueUnits.length + redUnits.length} units (${blueUnits.length} blue, ${redUnits.length} red)`);
    
    // Create additional scattered units around the map
    this.createScatteredUnits();
  }
  
  createScatteredUnits() {
    // Create neutral units scattered around the map
    const neutralUnits = [
      { type: 'scout', pos: new BABYLON.Vector3(20, 0.5, 20), team: 'neutral' },
      { type: 'infantry', pos: new BABYLON.Vector3(-20, 0.5, 20), team: 'neutral' },
      { type: 'cavalry', pos: new BABYLON.Vector3(20, 0.5, -20), team: 'neutral' },
      { type: 'engineer', pos: new BABYLON.Vector3(-20, 0.5, -20), team: 'neutral' },
      { type: 'medic', pos: new BABYLON.Vector3(0, 0.5, 30), team: 'neutral' },
      { type: 'sniper', pos: new BABYLON.Vector3(0, 0.5, -30), team: 'neutral' },
      { type: 'anti_air', pos: new BABYLON.Vector3(30, 0.5, 0), team: 'neutral' },
      { type: 'heavy_tank', pos: new BABYLON.Vector3(-30, 0.5, 0), team: 'neutral' },
      { type: 'artillery', pos: new BABYLON.Vector3(40, 0.5, 40), team: 'neutral' },
      { type: 'tank', pos: new BABYLON.Vector3(-40, 0.5, 40), team: 'neutral' },
      { type: 'infantry', pos: new BABYLON.Vector3(40, 0.5, -40), team: 'neutral' },
      { type: 'cavalry', pos: new BABYLON.Vector3(-40, 0.5, -40), team: 'neutral' }
    ];
    
    neutralUnits.forEach(unit => {
      this.unitManager.createUnit(unit.type, unit.pos, unit.team);
    });
    
    console.log(`Created ${neutralUnits.length} additional scattered neutral units`);
  }
  
  findFlatPositions(minX, minZ, maxX, maxZ, count) {
    const flatPositions = [];
    const attempts = 100; // Maximum attempts to find flat positions
    let attemptsMade = 0;
    
    while (flatPositions.length < count && attemptsMade < attempts) {
      attemptsMade++;
      
      // Generate random position within the specified area
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      
      // Check if this position is on flat terrain
      if (this.isPositionFlat(x, z)) {
        const height = this.terrainGenerator.getHeightAt(x, z);
        const position = new BABYLON.Vector3(x, height + 0.5, z);
        flatPositions.push(position);
      }
    }
    
    console.log(`Found ${flatPositions.length} flat positions after ${attemptsMade} attempts`);
    return flatPositions;
  }
  
  isPositionFlat(x, z) {
    // Check if the tile at this position has no elevation
    const tileX = Math.floor(x / this.terrainGenerator.tileSize);
    const tileZ = Math.floor(z / this.terrainGenerator.tileSize);
    
    // Use the same logic as the terrain generator to determine if tile has elevation
    const seed = (tileX * 73856093) ^ (tileZ * 19349663);
    const random = Math.sin(seed) * 10000;
    const hasElevation = (random % 100) < 30;
    
    return !hasElevation; // Return true if the tile is flat
  }
  
  setupObjectSelection() {
    // Input handling is now managed by the InputHandler class
    // This method is kept for compatibility but no longer needed
  }
  
  selectObject(object) {
    // Deselect previous object
    this.deselectAll();
    
    // Select new object
    this.selectedObject = object;
    const gameObject = this.gameObjects.get(object);
    gameObject.isSelected = true;
    
    // Highlight selected object
    const material = object.material;
    if (material.diffuseColor) {
      material.diffuseColor = new BABYLON.Color3(1, 1, 0); // Yellow highlight
    }
    
    // Emit selection event for UI
    this.onObjectSelected(object, gameObject);
  }
  
  deselectAll() {
    if (this.selectedObject) {
      const gameObject = this.gameObjects.get(this.selectedObject);
      gameObject.isSelected = false;
      
      // Restore original color
      const material = this.selectedObject.material;
      if (material.diffuseColor) {
        material.diffuseColor = gameObject.originalColor;
      }
      
      this.selectedObject = null;
    }
  }
  
  setupGameLoop() {
    this.scene.registerBeforeRender(() => {
      if (!this.isRunning) return;
      
      const currentTime = performance.now();
      this.deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
      this.lastTime = currentTime;
      
      this.update(this.deltaTime);
    });
  }
  
  update(deltaTime) {
    // Update game objects
    this.updateGameObjects(deltaTime);
    
    // Update game state
    this.updateGameState(deltaTime);
  }
  
  updateGameObjects(deltaTime) {
    // Update units
    this.unitManager.update(deltaTime);
  }
  
  updateGameState(deltaTime) {
    // Update any game state logic here
    // For example: physics, AI, game mechanics, etc.
    
    // Update terrain tiles based on camera position
    this.updateTerrainTiles();
  }
  
  updateTerrainTiles() {
    // Get camera position to determine which tiles to load
    const camera = this.scene.activeCamera;
    if (camera) {
      this.terrainGenerator.updatePlayerPosition(camera.position);
    }
  }
  
  start() {
    this.isRunning = true;
    this.lastTime = performance.now();
  }
  
  stop() {
    this.isRunning = false;
  }
  
  setSelectionMode(mode) {
    this.selectionMode = mode;
    
    // Disable both selection systems
    this.selectionRectangle.disable();
    this.lassoSelection.disable();
    
    // Enable the selected mode
    if (mode === 'rectangle') {
      this.selectionRectangle.enable();
    } else if (mode === 'lasso') {
      this.lassoSelection.enable();
    }
    
    console.log(`Selection mode changed to: ${mode}`);
  }
  
  toggleSelectionMode() {
    const newMode = this.selectionMode === 'rectangle' ? 'lasso' : 'rectangle';
    this.setSelectionMode(newMode);
    return newMode;
  }
  
  getSelectionMode() {
    return this.selectionMode;
  }
  
  // Event callback for UI
  onObjectSelected(object, gameObject) {
    // This will be set by the UI system
    if (this.onSelectionChanged) {
      this.onSelectionChanged(object, gameObject);
    }
  }
  
  // Get selected object info
  getSelectedObjectInfo() {
    if (this.selectedObject) {
      return {
        object: this.selectedObject,
        gameObject: this.gameObjects.get(this.selectedObject)
      };
    }
    return null;
  }
  
  // Get all objects info
  getAllObjectsInfo() {
    const objectsInfo = [];
    this.gameObjects.forEach((gameObject, object) => {
      objectsInfo.push({
        object: object,
        gameObject: gameObject
      });
    });
    return objectsInfo;
  }
  

}
