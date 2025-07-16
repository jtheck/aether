class TerrainGenerator {
  constructor(scene) {
    this.scene = scene;
    this.tileSize = 20; // Size of each tile
    this.tileSubdivisions = 40; // Subdivisions per tile
    this.tiles = new Map(); // Store active tiles
    this.visibleTiles = 3; // How many tiles to show in each direction
    this.playerPosition = new BABYLON.Vector3(0, 0, 0);
  }

  createTiledTerrain() {
    // Create initial tiles around origin
    this.updateTiles();
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
    
    // Create and apply material
    const terrainMaterial = this.createTerrainMaterial(hasElevation);
    ground.material = terrainMaterial;
    
    // Store tile data
    this.tiles.set(tileKey, {
      mesh: ground,
      tileX: tileX,
      tileZ: tileZ,
      worldX: worldX,
      worldZ: worldZ,
      hasElevation: hasElevation
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
    return (random % 100) < 30; // 30% of tiles have elevation (increased from 15%)
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
    
    // Create mountain-like elevation
    const height = 
      Math.sin(x * 3) * 0.6 +      // Large mountain features
      Math.sin(z * 2) * 0.4 +      // Ridges
      Math.sin(x * 6 + z * 4) * 0.3 + // Medium features
      Math.sin(x * 12 + z * 8) * 0.1; // Small details
    
    return Math.max(0, height * 8); // Only positive elevation, max 8 units (much higher!)
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
      // Mountain material - enhanced for lighting
      terrainMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);
      terrainMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      terrainMaterial.ambientColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      terrainMaterial.specularPower = 32;
      terrainMaterial.useParallax = true;
      terrainMaterial.useParallaxOcclusion = true;
    } else {
      // Flat terrain material - enhanced for lighting
      terrainMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.6, 0.3);
      terrainMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      terrainMaterial.ambientColor = new BABYLON.Color3(0.15, 0.15, 0.15);
      terrainMaterial.specularPower = 16;
    }
    
    // Enable normal mapping for better surface detail
    terrainMaterial.backFaceCulling = false;
    
    return terrainMaterial;
  }



  addScatteredObjects() {
    const objects = [];
    const objectCount = 8; // Fewer objects for tiled system
    
    for (let i = 0; i < objectCount; i++) {
      const rock = BABYLON.MeshBuilder.CreateBox("rock" + i, {
        width: Math.random() * 0.3 + 0.1,
        height: Math.random() * 0.2 + 0.05,
        depth: Math.random() * 0.3 + 0.1
      }, this.scene);
      
      // Position within the visible tile area
      rock.position.x = (Math.random() - 0.5) * this.tileSize * this.visibleTiles * 2;
      rock.position.z = (Math.random() - 0.5) * this.tileSize * this.visibleTiles * 2;
      rock.position.y = 0.1; // Just above ground
      
      rock.material = new BABYLON.StandardMaterial("rockMat" + i, this.scene);
      rock.material.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
      rock.material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      
      objects.push(rock);
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
    
    if (tile && tile.hasElevation) {
      return this.generateElevationAtWorldPosition(worldX, worldZ);
    }
    
    return 0; // Flat terrain
  }

  // Get tile info at world position
  getTileAt(worldX, worldZ) {
    const tileX = Math.floor(worldX / this.tileSize);
    const tileZ = Math.floor(worldZ / this.tileSize);
    const tileKey = `${tileX},${tileZ}`;
    return this.tiles.get(tileKey);
  }

  // Cleanup all tiles
  dispose() {
    this.tiles.forEach((tile, key) => {
      if (tile.mesh) {
        tile.mesh.dispose();
      }
    });
    this.tiles.clear();
  }
}
