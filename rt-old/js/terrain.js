class TerrainGenerator {
  constructor(scene) {
    this.scene = scene;
    this.tileSize = 20; // Size of each tile
    this.tileSubdivisions = 40; // Subdivisions per tile
    this.tiles = new Map(); // Store active tiles
    this.visibleTiles = 6; // How many tiles to show in each direction (increased from 3 to 6)
    this.playerPosition = new BABYLON.Vector3(0, 0, 0);
    
    // Ensure proper scene lighting
    this.ensureSceneLighting();
    
    // Load terrain textures
    this.loadTerrainTextures();
    
    // Create test cube to verify textures (remove this after debugging)
    setTimeout(() => {
      this.createTextureTestCube();
    }, 1000);
    
    // Add keyboard shortcut for debugging (press 'R' to reload textures)
    this.setupDebugControls();
    
    // Make terrain generator globally accessible for debugging
    window.terrainGenerator = this;
    
    // Initialize scattered objects storage
    this.scatteredObjects = [];
  }

  setupDebugControls() {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'r') {
        console.log("Reloading textures...");
        this.reloadTextures();
      }
    });
  }

  loadTerrainTextures() {
    try {
      // Check if textures directory exists and log the paths
      const texturePaths = [
        "assets/textures/grassy.webp",
        "assets/textures/rocky.webp", 
        "assets/textures/sandy.webp",
        "assets/textures/forest.webp"  // New forest texture
      ];
      
      // Load the four terrain textures with proper error handling
      this.grassTexture = new BABYLON.Texture(texturePaths[0], this.scene);
      this.rockTexture = new BABYLON.Texture(texturePaths[1], this.scene);
      this.sandTexture = new BABYLON.Texture(texturePaths[2], this.scene);
      this.forestTexture = new BABYLON.Texture(texturePaths[3], this.scene);
      
      // Wait for textures to load before setting properties
      const textures = [this.grassTexture, this.rockTexture, this.sandTexture, this.forestTexture];
      const names = ['grass', 'rock', 'sand', 'forest'];
      
      textures.forEach((texture, index) => {
        // Set up proper texture loading callbacks
        texture.onLoadObservable = texture.onLoadObservable || new BABYLON.Observable();
        texture.onErrorObservable = texture.onErrorObservable || new BABYLON.Observable();
        
        texture.onLoadObservable.add(() => {
          // Texture loaded successfully
        });
        
        texture.onErrorObservable.add((error) => {
          console.error(`Failed to load ${names[index]} texture:`, error);
          console.error(`Path attempted:`, texturePaths[index]);
        });
        
        // Set texture properties for better quality
        texture.uScale = 3.0; // Repeat texture 3x horizontally for better detail
        texture.vScale = 3.0; // Repeat texture 3x vertically for better detail
        texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        texture.anisotropicFilteringLevel = 16; // Better texture quality
        
        // Force texture to load
        texture.delayLoadState = BABYLON.Engine.DELAYLOADSTATE_LOADED;
      });
      
      // Force texture loading completion
      this.forceTextureLoading();
      
    } catch (error) {
      console.error("Error loading terrain textures:", error);
      
      // Create fallback materials if textures fail to load
      this.createFallbackTextures();
    }
  }

  forceTextureLoading() {
    // Force textures to load by accessing their properties
    const textures = [this.grassTexture, this.rockTexture, this.sandTexture, this.forestTexture];
    
    textures.forEach((texture, index) => {
      const names = ['grass', 'rock', 'sand', 'forest'];
      
      // Check if texture is ready
      if (texture.isReady && texture.isReady()) {
        // Texture is ready
      }
    });
    
    // Test texture loading with a simple fetch
    this.testTexturePaths();
    
    // Force material update after textures are loaded
    setTimeout(() => {
      this.forceMaterialUpdate();
    }, 1000);
  }

  forceMaterialUpdate() {
    // Regenerate all tiles with the now-loaded textures
    this.regenerateAllTiles();
  }

  async testTexturePaths() {
    // Texture path validation (silent)
  }

  reloadTextures() {
    // Dispose old textures
    if (this.grassTexture) this.grassTexture.dispose();
    if (this.rockTexture) this.rockTexture.dispose();
    if (this.sandTexture) this.sandTexture.dispose();
    if (this.forestTexture) this.forestTexture.dispose();
    
    // Reload textures
    this.loadTerrainTextures();
    
    // Regenerate all existing tiles with new textures
    this.regenerateAllTiles();
  }

  regenerateAllTiles() {
    // Store current tile positions
    const tilePositions = [];
    this.tiles.forEach((tile, key) => {
      tilePositions.push({ x: tile.tileX, z: tile.tileZ, key: key });
    });
    
    // Clear existing tiles
    this.dispose();
    
    // Recreate tiles
    tilePositions.forEach(({ x, z, key }) => {
      this.createTile(x, z, key);
    });
  }

  createTextureTestCube() {
    // Create a simple cube to test textures
    const testCube = BABYLON.MeshBuilder.CreateBox("textureTest", { size: 2 }, this.scene);
    testCube.position = new BABYLON.Vector3(0, 2, 0);
    
    // Test each texture
    const testMaterial = new BABYLON.StandardMaterial("testMat", this.scene);
    
    if (this.grassTexture && this.grassTexture.isReady()) {
      testMaterial.diffuseTexture = this.grassTexture;
      testMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
      testMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
    } else {
      testMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.6, 0.3);
      testMaterial.ambientColor = new BABYLON.Color3(0.2, 0.3, 0.15);
    }
    
    testCube.material = testMaterial;
    
    // Also create a test plane on the ground
    this.createTextureTestPlane();
    
    // Remove test cube after 10 seconds
    setTimeout(() => {
      if (testCube && !testCube.isDisposed()) {
        testCube.dispose();
      }
    }, 10000);
    
    return testCube;
  }

  createTextureTestPlane() {
    // Create a simple ground plane to test textures
    const testPlane = BABYLON.MeshBuilder.CreateGround("textureTestPlane", {
      width: 8,
      height: 8,
      subdivisions: 4
    }, this.scene);
    
    testPlane.position = new BABYLON.Vector3(15, 0.1, 0);
    
    // Create a simple material with grass texture
    const testMaterial = new BABYLON.StandardMaterial("testPlaneMat", this.scene);
    
    if (this.grassTexture && this.grassTexture.isReady()) {
      testMaterial.diffuseTexture = this.grassTexture;
      testMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
      testMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
    } else {
      testMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2); // Bright red
      testMaterial.ambientColor = new BABYLON.Color3(0.4, 0.1, 0.1);
    }
    
    testPlane.material = testMaterial;
    
    // Remove test plane after 15 seconds
    setTimeout(() => {
      if (testPlane && !testPlane.isDisposed()) {
        testPlane.dispose();
      }
    }, 15000);
  }

  createFallbackTextures() {
    // Create simple colored materials as fallbacks if textures fail to load
    
    // Create simple colored materials
    this.grassTexture = null;
    this.rockTexture = null;
    this.sandTexture = null;
    this.forestTexture = null;
    
    // Create a test tile with fallback colors to verify the system works
    setTimeout(() => {
      this.createFallbackTestTile();
    }, 500);
  }

  createFallbackTestTile() {
    // Create a simple ground plane with fallback colors
    const testGround = BABYLON.MeshBuilder.CreateGround("fallbackTest", {
      width: 10,
      height: 10,
      subdivisions: 10
    }, this.scene);
    
    testGround.position = new BABYLON.Vector3(0, 0.1, 0);
    
    // Create a simple colored material
    const testMaterial = new BABYLON.StandardMaterial("fallbackTestMat", this.scene);
    testMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2); // Bright red
    testMaterial.ambientColor = new BABYLON.Color3(0.4, 0.1, 0.1);
    testMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    
    testGround.material = testMaterial;
    
    // Remove test tile after 10 seconds
    setTimeout(() => {
      if (testGround && !testGround.isDisposed()) {
        testGround.dispose();
      }
    }, 10000);
  }

  createTiledTerrain() {
    // Create initial tiles around origin
    this.updateTiles();
    
    // Wait for tiles to be fully created, then add scattered objects
    setTimeout(() => {
      const scatteredObjects = this.addScatteredObjects();
      this.scatteredObjects = scatteredObjects;
    }, 200); // Increased delay to ensure tiles are fully created
    
    return this.tiles;
  }

  updateTiles() {
    // Calculate which tiles should be visible based on player position
    const playerTileX = Math.floor(this.playerPosition.x / this.tileSize);
    const playerTileZ = Math.floor(this.playerPosition.z / this.tileSize);
    
    const tilesToCreate = [];
    const tilesToRemove = [];
    
    // Determine which tiles should exist
    for (let x = playerTileX - this.visibleTiles; x <= playerTileX + this.visibleTiles; x++) {
      for (let z = playerTileZ - this.visibleTiles; z <= playerTileZ + this.visibleTiles; z++) {
        const tileKey = `${x},${z}`;
        tilesToCreate.push({ x, z, key: tileKey });
      }
    }
    
    // Find tiles to remove
    this.tiles.forEach((tile, key) => {
      if (!tilesToCreate.find(t => t.key === key)) {
        tilesToRemove.push(key);
      }
    });
    
    // Remove old tiles
    tilesToRemove.forEach(key => {
      const tile = this.tiles.get(key);
      if (tile && tile.mesh) {
        tile.mesh.dispose();
      }
      this.tiles.delete(key);
    });
    
    // Create new tiles
    tilesToCreate.forEach(({ x, z, key }) => {
      if (!this.tiles.has(key)) {
        this.createTile(x, z, key);
      }
    });
  }

  createTile(tileX, tileZ, tileKey) {
    const worldX = tileX * this.tileSize;
    const worldZ = tileZ * this.tileSize;
    

    
    // Create ground mesh for this tile
    const ground = BABYLON.MeshBuilder.CreateGround(`terrain_${tileKey}`, {
      width: this.tileSize,
      height: this.tileSize,
      subdivisions: this.tileSubdivisions
    }, this.scene);
    
    // Position the tile
    ground.position.x = worldX;
    ground.position.z = worldZ;
    
    // Determine if this tile should have elevation
    const hasElevation = this.shouldTileHaveElevation(tileX, tileZ);
    
    if (hasElevation) {
      // Add elevation to this tile
      const heightmapData = this.generateTileElevation(tileX, tileZ);
      this.applyElevationToTile(ground, heightmapData);
    }
    
    // Create and apply material with variety
    const terrainMaterial = this.createTerrainMaterialWithVariety(tileX, tileZ, hasElevation);
    ground.material = terrainMaterial;
    
    // Determine terrain type
    const terrainType = this.getTerrainTypeWithBlending(tileX, tileZ, hasElevation);
    
    // Add forest objects if this is a forest tile
    let forestObjects = [];
    if (terrainType === 'forest') {

      forestObjects = this.createForestObjects(tileX, tileZ);
    }
    
    // Store tile data
    this.tiles.set(tileKey, {
      mesh: ground,
      tileX: tileX,
      tileZ: tileZ,
      worldX: worldX,
      worldZ: worldZ,
      hasElevation: hasElevation,
      terrainType: terrainType,
      forestObjects: forestObjects
    });
    

    
    return ground;
  }

  shouldTileHaveElevation(tileX, tileZ) {
    // Always keep the center tile (0,0) flat for unit spawning
    if (tileX === 0 && tileZ === 0) {
      return false;
    }
    
    // Use a deterministic pattern to decide which tiles have elevation
    // This creates a consistent map layout
    const seed = (tileX * 73856093) ^ (tileZ * 19349663);
    const random = Math.sin(seed) * 10000;
    const terrainRoll = (random % 100);
    
    // Forest tiles should have more varied elevation for a natural look
    const terrainType = this.getTerrainType(tileX, tileZ, false);
    if (terrainType === 'forest') {
      return terrainRoll < 70; // 70% of forest tiles have elevation
    }
    
    return terrainRoll < 30; // 30% of other tiles have elevation
  }

  generateTileElevation(tileX, tileZ) {
    const heightmapData = new Float32Array(this.tileSubdivisions * this.tileSubdivisions);
    
    for (let i = 0; i < heightmapData.length; i++) {
      const localX = (i % this.tileSubdivisions) / this.tileSubdivisions;
      const localZ = Math.floor(i / this.tileSubdivisions) / this.tileSubdivisions;
      
      // Convert to world coordinates
      const worldX = (tileX * this.tileSize) + (localX * this.tileSize);
      const worldZ = (tileZ * this.tileSize) + (localZ * this.tileSize);
      
      // Generate elevation using world coordinates for seamless tiling
      const height = this.generateElevationAtWorldPosition(worldX, worldZ);
      
      // Apply edge smoothing to keep tile boundaries flat
      const edgeSmooth = this.getEdgeSmoothingFactor(localX, localZ);
      heightmapData[i] = height * edgeSmooth;
    }
    
    return heightmapData;
  }
  
  getEdgeSmoothingFactor(localX, localZ) {
    // Create a smooth falloff from center to edges
    // This ensures tile boundaries are always flat
    
    // Distance from center (0.5, 0.5)
    const centerX = 0.5;
    const centerZ = 0.5;
    const distanceFromCenter = Math.sqrt(
      Math.pow(localX - centerX, 2) + Math.pow(localZ - centerZ, 2)
    );
    
    // Maximum distance from center (corner of tile)
    const maxDistance = Math.sqrt(0.5 * 0.5 + 0.5 * 0.5);
    
    // Create smooth falloff - full height at center, 0 at edges
    const falloffDistance = 0.3; // Start falloff at 30% from center
    const edgeDistance = 0.4; // Complete falloff at 40% from center
    
    if (distanceFromCenter <= falloffDistance) {
      return 1.0; // Full height in center
    } else if (distanceFromCenter >= edgeDistance) {
      return 0.0; // Flat at edges
    } else {
      // Smooth transition between falloff and edge
      const t = (distanceFromCenter - falloffDistance) / (edgeDistance - falloffDistance);
      return 1.0 - (t * t * (3 - 2 * t)); // Smoothstep function
    }
  }

  generateElevationAtWorldPosition(worldX, worldZ) {
    // Use world coordinates for seamless tiling
    const x = worldX / 30; // Scale factor for elevation
    const z = worldZ / 30;
    
    // Check if this is a forest area
    const tileX = Math.floor(worldX / this.tileSize);
    const tileZ = Math.floor(worldZ / this.tileSize);
    const terrainType = this.getTerrainType(tileX, tileZ, false);
    
    if (terrainType === 'forest') {
      // Create forest-like elevation with rolling hills and small mounds
      const height = 
        Math.sin(x * 2) * 0.3 +      // Gentle rolling hills
        Math.sin(z * 1.5) * 0.2 +    // Subtle ridges
        Math.sin(x * 8 + z * 6) * 0.15 + // Small forest floor variations
        Math.sin(x * 15 + z * 12) * 0.08; // Very fine detail
      
      return Math.max(0, height * 4); // Forest elevation is gentler, max 4 units
    } else {
      // Create mountain-like elevation for non-forest areas
      const height = 
        Math.sin(x * 3) * 0.6 +      // Large mountain features
        Math.sin(z * 2) * 0.4 +      // Ridges
        Math.sin(x * 6 + z * 4) * 0.3 + // Medium features
        Math.sin(x * 12 + z * 8) * 0.1; // Small details
      
      return Math.max(0, height * 8); // Only positive elevation, max 8 units
    }
  }

  applyElevationToTile(ground, heightmapData) {
    const vertexData = BABYLON.VertexData.ExtractFromMesh(ground);
    const positions = vertexData.positions;
    
    for (let i = 0; i < positions.length; i += 3) {
      const localX = (positions[i] + this.tileSize/2) / this.tileSize;
      const localZ = (positions[i+2] + this.tileSize/2) / this.tileSize;
      
      if (localX >= 0 && localX <= 1 && localZ >= 0 && localZ <= 1) {
        const index = Math.floor(localZ * (this.tileSubdivisions-1)) * this.tileSubdivisions + Math.floor(localX * (this.tileSubdivisions-1));
        if (index < heightmapData.length) {
          positions[i+1] = heightmapData[index];
        }
      }
    }
    
    vertexData.applyToMesh(ground);
  }

  createTerrainMaterial(hasElevation) {
    const terrainMaterial = new BABYLON.StandardMaterial("terrainMat", this.scene);
    
    if (hasElevation) {
      // Mountain material with rock texture
      if (this.rockTexture) {
        terrainMaterial.diffuseTexture = this.rockTexture;
        terrainMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0); // Full white to show texture properly
      } else {
        // Fallback: use rock-like color
        terrainMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);
      }
      terrainMaterial.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
      terrainMaterial.ambientColor = new BABYLON.Color3(0.6, 0.6, 0.6); // Much higher ambient for visibility
      terrainMaterial.specularPower = 32;
      terrainMaterial.useParallax = true;
      terrainMaterial.useParallaxOcclusion = true;
    } else {
      // Flat terrain material with grass texture
      if (this.grassTexture) {
        terrainMaterial.diffuseTexture = this.grassTexture;
        terrainMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0); // Full white to show texture properly
      } else {
        // Fallback: use grass-like color
        terrainMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.6, 0.3);
      }
      terrainMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      terrainMaterial.ambientColor = new BABYLON.Color3(0.6, 0.6, 0.6); // Much higher ambient for visibility
      terrainMaterial.specularPower = 16;
    }
    
    // Enable normal mapping for better surface detail
    terrainMaterial.backFaceCulling = false;
    
    return terrainMaterial;
  }

  createTerrainMaterialWithVariety(tileX, tileZ, hasElevation) {
    // Create a simple, working material
    const terrainMaterial = new BABYLON.StandardMaterial("terrainMat", this.scene);
    
    // Determine terrain type based on position and elevation
    const terrainType = this.getTerrainTypeWithBlending(tileX, tileZ, hasElevation);
    

    
    // Simple, working material setup
    switch (terrainType) {
      case 'rock':
        if (this.rockTexture && this.rockTexture.isReady()) {
          terrainMaterial.diffuseTexture = this.rockTexture;
          // Use neutral colors to show texture properly
          terrainMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        } else {
          terrainMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        }
        break;
        
      case 'sand':
        if (this.sandTexture && this.sandTexture.isReady()) {
          terrainMaterial.diffuseTexture = this.sandTexture;
          terrainMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        } else {
          terrainMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.8, 0.6);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.5, 0.4, 0.3);
        }
        break;
        
      case 'forest':
        if (this.forestTexture && this.forestTexture.isReady()) {
          terrainMaterial.diffuseTexture = this.forestTexture;
          terrainMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        } else {
          terrainMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.1);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.1, 0.2, 0.05);
        }
        break;
        
      case 'grass':
      default:
        if (this.grassTexture && this.grassTexture.isReady()) {
          terrainMaterial.diffuseTexture = this.grassTexture;
          terrainMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        } else {
          terrainMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.6, 0.3);
          terrainMaterial.ambientColor = new BABYLON.Color3(0.2, 0.3, 0.15);
        }
        break;
    }
    
    // Simple, working material properties
    terrainMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    terrainMaterial.specularPower = 16;
    terrainMaterial.backFaceCulling = false;
    
    // Ensure the material is properly configured
    terrainMaterial.freeze();
    
    return terrainMaterial;
  }

  addTerrainBumpMapping(material, terrainType) {
    // Create subtle bump mapping for different terrain types
    switch (terrainType) {
      case 'rock':
        // Rock has more pronounced surface detail
        material.bumpTexture = this.rockTexture;
        material.bumpTexture.level = 0.3;
        break;
        
      case 'sand':
        // Sand has subtle surface detail
        material.bumpTexture = this.sandTexture;
        material.bumpTexture.level = 0.1;
        break;
        
      case 'forest':
        // Forest has medium surface detail
        material.bumpTexture = this.forestTexture;
        material.bumpTexture.level = 0.25;
        break;
        
      case 'grass':
      default:
        // Grass has medium surface detail
        material.bumpTexture = this.grassTexture;
        material.bumpTexture.level = 0.2;
        break;
    }
  }

  createSimpleTestMaterial(terrainType) {
    // Create a simple material for testing texture loading
    const testMaterial = new BABYLON.StandardMaterial("testMat", this.scene);
    
    switch (terrainType) {
      case 'rock':
        testMaterial.diffuseTexture = this.rockTexture;
        break;
      case 'sand':
        testMaterial.diffuseTexture = this.sandTexture;
        break;
      case 'forest':
        testMaterial.diffuseTexture = this.forestTexture;
        break;
      case 'grass':
      default:
        testMaterial.diffuseTexture = this.grassTexture;
        break;
    }
    
    // Use full white diffuse color to show texture properly
    testMaterial.diffuseColor = new BABYLON.Color3(1.0, 1.0, 1.0);
    testMaterial.ambientColor = new BABYLON.Color3(0.8, 0.8, 0.8);
    
    return testMaterial;
  }

  ensureSceneLighting() {
    // Check if scene has proper lighting
    if (this.scene.lights.length === 0) {
      console.warn("No lights found in scene, adding default lighting");
      
      // Add a simple directional light
      const light = new BABYLON.DirectionalLight("terrainLight", new BABYLON.Vector3(0, 1, 0), this.scene);
      light.intensity = 1.0;
      
      // Add ambient light for better texture visibility
      const ambientLight = new BABYLON.HemisphericLight("ambientLight", new BABYLON.Vector3(0, 1, 0), this.scene);
      ambientLight.intensity = 0.6;
      ambientLight.groundColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    }
  }

  getTerrainType(tileX, tileZ, hasElevation) {
    if (hasElevation) {
      return 'rock';
    }
    
    // Use deterministic randomness to create varied flat terrain
    const seed = (tileX * 73856093) ^ (tileZ * 19349663);
    const random = Math.sin(seed) * 10000;
    const terrainRoll = (random % 100);
    
    // 50% grass, 25% sand, 25% forest for flat areas
    if (terrainRoll < 50) {
      return 'grass';
    } else if (terrainRoll < 75) {
      return 'sand';
    } else {
      return 'forest';
    }
  }

  getTerrainTypeWithBlending(tileX, tileZ, hasElevation) {
    if (hasElevation) {
      return 'rock';
    }
    
    // Create more natural terrain distribution
    const seed = (tileX * 73856093) ^ (tileZ * 19349663);
    const random = Math.sin(seed) * 10000;
    const terrainRoll = (random % 100);
    
    // Create clusters of similar terrain types
    const clusterSize = 3; // Size of terrain clusters
    const clusterX = Math.floor(tileX / clusterSize);
    const clusterZ = Math.floor(tileZ / clusterSize);
    const clusterSeed = (clusterX * 73856093) ^ (clusterZ * 19349663);
    const clusterRandom = Math.sin(clusterSeed) * 10000;
    const clusterRoll = (clusterRandom % 100);
    
    // 45% grass, 20% sand, 25% forest, 10% mixed for variety
    if (clusterRoll < 45) {
      return 'grass';
    } else if (clusterRoll < 65) {
      return 'sand';
    } else if (clusterRoll < 90) {
      return 'forest';
    } else {
      // Mixed terrain - alternate between grass, sand, and forest
      const mixedRoll = (tileX + tileZ) % 3;
      if (mixedRoll === 0) return 'grass';
      if (mixedRoll === 1) return 'sand';
      return 'forest';
    }
  }


  addScatteredObjects() {
    const objects = [];
    const objectCount = 25; // Much more objects for dense forest feel
    

    
    for (let i = 0; i < objectCount; i++) {
      // Create different types of objects based on terrain
      let object;
      const objectType = Math.random();
      
      if (objectType < 0.25) {
        // Rocks
        object = BABYLON.MeshBuilder.CreateBox("rock" + i, {
          width: Math.random() * 0.3 + 0.1,
          height: Math.random() * 0.2 + 0.05,
          depth: Math.random() * 0.3 + 0.1
        }, this.scene);
        object.material = new BABYLON.StandardMaterial("rockMat" + i, this.scene);
        object.material.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
        object.material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      } else if (objectType < 0.65) {
        // Trees (more realistic with trunk and foliage)
        console.log(`Creating tree ${i} - objectType: ${objectType}`);
        
        const treeTrunk = BABYLON.MeshBuilder.CreateCylinder("treeTrunk" + i, {
          height: Math.random() * 3 + 2,
          diameter: Math.random() * 0.4 + 0.3
        }, this.scene);
        
        const treeFoliage = BABYLON.MeshBuilder.CreateSphere("treeFoliage" + i, {
          diameter: Math.random() * 2 + 1.5
        }, this.scene);
        
        // Create trunk material
        const trunkMaterial = new BABYLON.StandardMaterial("trunkMat" + i, this.scene);
        trunkMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.2, 0.1);
        trunkMaterial.specularColor = new BABYLON.Color3(0.05, 0.03, 0.02);
        treeTrunk.material = trunkMaterial;
        
        // Create foliage material
        const foliageMaterial = new BABYLON.StandardMaterial("foliageMat" + i, this.scene);
        foliageMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.1);
        foliageMaterial.specularColor = new BABYLON.Color3(0.02, 0.06, 0.02);
        treeFoliage.material = foliageMaterial;
        
        // Use the trunk as the main object (it has a material)
        object = treeTrunk;
        // Make foliage a child of the trunk
        treeFoliage.parent = object;
        
        // Store the height value since it's not a property of the mesh
        const trunkHeight = treeTrunk.height;
        object.userData = object.userData || {};
        object.userData.height = trunkHeight;
        
        // Position foliage properly on top of trunk (relative to trunk center)
        treeFoliage.position.y = trunkHeight / 2 + treeFoliage.diameter / 2 - 0.1;
        
      } else if (objectType < 0.85) {
        // Bushes (more varied sizes)
        object = BABYLON.MeshBuilder.CreateSphere("bush" + i, {
          diameter: Math.random() * 0.8 + 0.4
        }, this.scene);
        object.material = new BABYLON.StandardMaterial("bushMat" + i, this.scene);
        object.material.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.15);
        object.material.specularColor = new BABYLON.Color3(0.05, 0.1, 0.04);
      } else {
        // Fallen logs
        object = BABYLON.MeshBuilder.CreateCylinder("log" + i, {
          height: Math.random() * 1.5 + 0.5,
          diameter: Math.random() * 0.3 + 0.2
        }, this.scene);
        object.rotation.z = Math.PI / 2; // Lay it on its side
        object.material = new BABYLON.StandardMaterial("logMat" + i, this.scene);
        object.material.diffuseColor = new BABYLON.Color3(0.25, 0.15, 0.08);
        object.material.specularColor = new BABYLON.Color3(0.05, 0.03, 0.02);
      }
      
      // Position within the visible tile area
      object.position.x = (Math.random() - 0.5) * this.tileSize * this.visibleTiles * 2;
      object.position.z = (Math.random() - 0.5) * this.tileSize * this.visibleTiles * 2;
      
      // Get height at this position for proper ground placement
      const groundHeight = this.getHeightAt(object.position.x, object.position.z);
      
              // For trees, position trunk so it sits on the ground (not half-buried)
        if (objectType >= 0.25 && objectType < 0.65) {
          // Trees: position trunk so bottom sits on ground
          const trunkHeight = object.userData.height;
          const trunkY = Math.max(0.1, groundHeight) + (trunkHeight / 2);
          object.position.y = trunkY;
          console.log(`Tree ${i} positioned at y=${trunkY}, groundHeight=${groundHeight}, trunkHeight=${trunkHeight}`);
          
          // Ensure foliage is properly positioned on top of trunk
          if (object.children && object.children.length > 0) {
            const foliage = object.children[0];
            // Position foliage relative to trunk center, on top
            foliage.position.y = trunkHeight / 2 + foliage.diameter / 2 - 0.1;
            console.log(`Tree ${i} foliage positioned at y=${foliage.position.y}`);
          }
        } else {
        // Other objects: just above ground
        object.position.y = Math.max(0.1, groundHeight) + 0.1;
      }
      
      // Add some random rotation for natural look
      object.rotation.y = Math.random() * Math.PI * 2;
      
      objects.push(object);
    }
    

    return objects;
  }

  // Update player position and regenerate tiles as needed
  updatePlayerPosition(position) {
    this.playerPosition = position;
    this.updateTiles();
  }

  // Get height at a specific world position
  getHeightAt(worldX, worldZ) {
    const tileX = Math.floor(worldX / this.tileSize);
    const tileZ = Math.floor(worldZ / this.tileSize);
    const tileKey = `${tileX},${tileZ}`;
    const tile = this.tiles.get(tileKey);
    
    const height = tile && tile.hasElevation ? this.generateElevationAtWorldPosition(worldX, worldZ) : 0;
    
    return height;
  }

  // Get tile info at world position
  getTileAt(worldX, worldZ) {
    const tileX = Math.floor(worldX / this.tileSize);
    const tileZ = Math.floor(worldZ / this.tileSize);
    const tileKey = `${tileX},${tileZ}`;
    return this.tiles.get(tileKey);
  }

  // Create forest-specific objects for forest tiles
  createForestObjects(tileX, tileZ) {
    const objects = [];
    const forestObjectCount = 15; // Dense forest objects
    

    
    for (let i = 0; i < forestObjectCount; i++) {
      let object;
      const objectType = Math.random();
      
      if (objectType < 0.4) {
        // Dense trees
        
        const treeTrunk = BABYLON.MeshBuilder.CreateCylinder(`forestTreeTrunk_${tileX}_${tileZ}_${i}`, {
          height: Math.random() * 4 + 3,
          diameter: Math.random() * 0.5 + 0.4
        }, this.scene);
        
        const treeFoliage = BABYLON.MeshBuilder.CreateSphere(`forestTreeFoliage_${tileX}_${tileZ}_${i}`, {
          diameter: Math.random() * 2.5 + 2
        }, this.scene);
        
        // Position foliage properly on top of trunk (relative to trunk center)
        treeFoliage.position.y = treeTrunk.height / 2 + treeFoliage.diameter / 2 - 0.1;
        
        // Create trunk material
        const trunkMaterial = new BABYLON.StandardMaterial(`forestTrunkMat_${tileX}_${tileZ}_${i}`, this.scene);
        trunkMaterial.diffuseColor = new BABYLON.Color3(0.25, 0.15, 0.08);
        trunkMaterial.specularColor = new BABYLON.Color3(0.03, 0.02, 0.01);
        treeTrunk.material = trunkMaterial;
        
        // Create foliage material
        const foliageMaterial = new BABYLON.StandardMaterial(`forestFoliageMat_${tileX}_${tileZ}_${i}`, this.scene);
        foliageMaterial.diffuseColor = new BABYLON.Color3(0.08, 0.25, 0.08);
        foliageMaterial.specularColor = new BABYLON.Color3(0.01, 0.04, 0.01);
        treeFoliage.material = foliageMaterial;
        
        // Use the trunk as the main object (it has a material)
        object = treeTrunk;
        // Make foliage a child of the trunk
        treeFoliage.parent = object;
        
        // Store the height value since it's not a property of the mesh
        const trunkHeight = treeTrunk.height;
        object.userData = object.userData || {};
        object.userData.height = trunkHeight;
        
      } else if (objectType < 0.7) {
        // Dense undergrowth bushes
        object = BABYLON.MeshBuilder.CreateSphere(`forestBush_${tileX}_${tileZ}_${i}`, {
          diameter: Math.random() * 1.2 + 0.6
        }, this.scene);
        object.material = new BABYLON.StandardMaterial(`forestBushMat_${tileX}_${tileZ}_${i}`, this.scene);
        object.material.diffuseColor = new BABYLON.Color3(0.15, 0.35, 0.12);
        object.material.specularColor = new BABYLON.Color3(0.03, 0.07, 0.02);
        
      } else if (objectType < 0.85) {
        // Fallen branches and debris
        object = BABYLON.MeshBuilder.CreateCylinder(`forestDebris_${tileX}_${tileZ}_${i}`, {
          height: Math.random() * 1 + 0.3,
          diameter: Math.random() * 0.2 + 0.1
        }, this.scene);
        object.rotation.z = Math.PI / 2; // Lay it on its side
        object.material = new BABYLON.StandardMaterial(`forestDebrisMat_${tileX}_${tileZ}_${i}`, this.scene);
        object.material.diffuseColor = new BABYLON.Color3(0.2, 0.12, 0.06);
        object.material.specularColor = new BABYLON.Color3(0.02, 0.01, 0.01);
        
      } else {
        // Small rocks and stones
        object = BABYLON.MeshBuilder.CreateBox(`forestRock_${tileX}_${tileZ}_${i}`, {
          width: Math.random() * 0.4 + 0.1,
          height: Math.random() * 0.3 + 0.05,
          depth: Math.random() * 0.4 + 0.1
        }, this.scene);
        object.material = new BABYLON.StandardMaterial(`forestRockMat_${tileX}_${tileZ}_${i}`, this.scene);
        object.material.diffuseColor = new BABYLON.Color3(0.35, 0.3, 0.25);
        object.material.specularColor = new BABYLON.Color3(0.05, 0.04, 0.03);
      }
      
      // Position within the forest tile
      const worldX = tileX * this.tileSize;
      const worldZ = tileZ * this.tileSize;
      object.position.x = worldX + (Math.random() - 0.5) * this.tileSize;
      object.position.z = worldZ + (Math.random() - 0.5) * this.tileSize;
      
      // Get height at this position for proper ground placement
      const groundHeight = this.getHeightAt(object.position.x, object.position.z);
      
      // For trees, position trunk so it sits on the ground (not half-buried)
      if (objectType < 0.4) {
        // Forest trees: position trunk so bottom sits on ground
        const trunkHeight = object.userData.height;
        object.position.y = Math.max(0.1, groundHeight) + (trunkHeight / 2);
        
        // Ensure foliage is properly positioned on top of trunk
        if (object.children && object.children.length > 0) {
          const foliage = object.children[0];
          // Position foliage relative to trunk center, on top
          foliage.position.y = trunkHeight / 2 + foliage.diameter / 2 - 0.1;
        }
      } else {
        // Other forest objects: just above ground
        object.position.y = Math.max(0.1, groundHeight) + 0.1;
      }
      
      // Add random rotation for natural look
      object.rotation.y = Math.random() * Math.PI * 2;
      
      objects.push(object);
    }
    

    
    return objects;
  }

  // Cleanup all tiles
  dispose() {
    this.tiles.forEach((tile, key) => {
      if (tile.mesh) {
        tile.mesh.dispose();
      }
      // Also dispose of forest objects if they exist
      if (tile.forestObjects) {
        tile.forestObjects.forEach(obj => {
          if (obj && !obj.isDisposed()) {
            obj.dispose();
          }
        });
      }
    });
    this.tiles.clear();
    
    // Clean up scattered objects
    if (this.scatteredObjects) {
      this.scatteredObjects.forEach(obj => {
        if (obj && !obj.isDisposed()) {
          obj.dispose();
        }
      });
      this.scatteredObjects = [];
    }
  }
}
