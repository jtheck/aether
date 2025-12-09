// TILE_SIZE is defined in constants.js

// Simple noise function for terrain height variation
function simpleNoise(x, y, seed) {
  // Simple hash function for consistent noise
  let hash = seed;
  hash = ((hash << 13) ^ hash) >>> 0;
  hash = ((hash * (hash * hash * 15731 + 789221) + 1376312589) & 0xffffffff) >>> 0;
  
  // Mix in coordinates
  hash = ((hash << 13) ^ (hash + x)) >>> 0;
  hash = ((hash << 13) ^ (hash + y)) >>> 0;
  
  // Return normalized value between -1 and 1
  return (hash / 0x7fffffff) * 2 - 1;
}

// Smooth noise function using bilinear interpolation
function smoothNoise(x, y, seed) {
  const xInt = Math.floor(x);
  const yInt = Math.floor(y);
  const xFrac = x - xInt;
  const yFrac = y - yInt;
  
  // Get noise values at the four corners
  const n00 = simpleNoise(xInt, yInt, seed);
  const n01 = simpleNoise(xInt, yInt + 1, seed);
  const n10 = simpleNoise(xInt + 1, yInt, seed);
  const n11 = simpleNoise(xInt + 1, yInt + 1, seed);
  
  // Bilinear interpolation
  const nx0 = n00 * (1 - xFrac) + n10 * xFrac;
  const nx1 = n01 * (1 - xFrac) + n11 * xFrac;
  
  return nx0 * (1 - yFrac) + nx1 * yFrac;
}

// Fractal noise for more natural terrain
function fractalNoise(x, y, seed, octaves = 3, persistence = 0.5, scale = 0.01) {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;
  
  for (let i = 0; i < octaves; i++) {
    total += smoothNoise(x * frequency * scale, y * frequency * scale, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= 2;
  }
  
  return total / maxValue;
}

function Tile(ops){
  this.loc = ops.loc;
  this.type = ops.type;

  // Default to grass atlas, but can be overridden by terrain system
  this.atlasName = ops.atlasName || 'atlas-grass';
  
  // Calculate atlas coordinates (4x4 grid for terrain atlases)
  // Row 0 should be at the bottom (0,0) - fix the UV mapping
  const atlasGridSize = 4; // 4x4 grid for terrain atlases
  this.atlasRow = Math.floor(this.type / atlasGridSize); // Row 0 = bottom, Row 3 = top
  this.atlasCol = this.type % atlasGridSize;             // Col 0 = left, Col 3 = right

  // this.mesh = BABYLON.MeshBuilder.CreateBox("tile", {size: tileSize}, gfx.scene);
  // this.mesh.position.x = this.loc.x * tileSize;
  // this.mesh.position.z = this.loc.y * tileSize;
}

// Method to update atlas coordinates when tile type changes
Tile.prototype.updateAtlasCoordinates = function() {
  // Don't overwrite atlasName - it's set by the terrain system
  // (could be 'atlas-grass' or 'atlas-water')
  
  // Calculate atlas coordinates (4x4 grid for terrain atlases)
  // Row 0 should be at the bottom (0,0) - fix the UV mapping
  const atlasGridSize = 4; // 4x4 grid for terrain atlases
  this.atlasRow = Math.floor(this.type / atlasGridSize); // Row 0 = bottom, Row 3 = top
  this.atlasCol = this.type % atlasGridSize;             // Col 0 = left, Col 3 = right
};







function Field(ops = {}) {
  this.width = ops.width ? ops.width : 10;
  this.height = ops.height ? ops.height : 10;
  this.tiles = [];
  this.seed = ops.seed || Math.floor(Math.random() * 1000000);
  
  // Elevation-based terrain system
  this.heightMap = [];     // Continuous elevation values (0.0 to 1.0)
  this.terrainTypes = [];  // Terrain type per tile: 0=deep, 1=water, 2=grass, 3=dirt, 4=mountains
  
  // Spawn positions for flattening agora zones
  this.spawnPositions = ops.spawnPositions || [];
  this.spawnZoneRadius = 6; // Tiles to flatten around each spawn
  
  // if (this.spawnPositions.length > 0) {
  //   console.log(`🏛️ Field initialized with ${this.spawnPositions.length} spawn zones (radius: ${this.spawnZoneRadius} tiles):`, this.spawnPositions);
  // }
  
  // Instance properties for chunk management
  this.chunks = new Map();
  this.chunkSize = 16;
  this._heightCache = new Map();
  
  // Chunk mask for custom map shapes (true = enabled, false = void)
  // Default: all chunks enabled
  this.chunkMask = new Map();
  const chunksX = Math.ceil(this.width / this.chunkSize);
  const chunksZ = Math.ceil(this.height / this.chunkSize);
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      this.chunkMask.set(`${cx},${cz}`, true);
    }
  }
  
  // Blocked tiles for pathfinding (deep water, rocks)
  this.blockedTiles = new Set();
  
  // Slow tiles for pathfinding (trees - units move slower here)
  this.slowTiles = new Set();
  this.slowMultiplier = 0.5; // Units move at 50% speed through trees

  // Precomputed height grid for fast unit positioning (initialized after proof())
  this._heightGrid = null;
  
  // Initialize DETERMINISTIC random number generator with seed for multiplayer sync
  this._rngState = this.seed;
  this.rng = () => {
    // Simple LCG (Linear Congruential Generator) - deterministic and fast
    this._rngState = (this._rngState * 1664525 + 1013904223) % 4294967296;
    return this._rngState / 4294967296; // Returns 0-1
  };
  
  // console.log(`🎲 Field initialized with deterministic RNG, seed: ${this.seed}`);
  
  // Define only the tile types that actually exist in your constants
  // let validTypes = [0, 1, 2, 4, 5, 6, 8, 9, 10, 20, 21, 22, 24, 25, 26, 28, 29, 30];
  let validTypes = [5];//, 25, 45, 65, 85, 12, 32, 52, 72, 82];

  // First pass: initialize all tiles
  // Must iterate y (rows) first, then x (cols) to match access pattern: tiles[y * width + x]
  for(let y = 0; y < this.height; y++){
    for(let x = 0; x < this.width; x++){
      this.tiles.push(new Tile({loc: {x, y}, type: 12})); // Placeholder
      this.heightMap.push(0); // Will be filled by height generation
      this.terrainTypes.push(3); // Default to grass (type 3) - will be overwritten by proof()
    }
  }
  // Show tilemap before proof
  // console.log("=== TILEMAP BEFORE PROOF ===");
  // this.showTilemap();
  
  this.proof();
  // this.testatlas();
  
  // Show tilemap after proof
  // console.log("=== TILEMAP AFTER PROOF ===");
  this.showTilemap();
  
  // Precompute height grid for fast unit positioning
  this._buildHeightGrid();
  
  // Debug: Uncomment to see marching squares case distribution
  // this.showMarchingSquaresCases();

}





// Field.prototype.testatlas = function(){
//   // Fill the field with tiles 0-15 in order to test the atlas
//   let tileIndex = 0;
  
//   for(let y = 0; y < this.height; y++) {
//     for(let x = 0; x < this.width; x++) {
//       const tile = this.tiles[y * this.width + x];
//       tile.type = tileIndex % 16; // Cycle through 0-15
//       tile.updateAtlasCoordinates();
//       tileIndex++;
//     }
//   }
  
//   // console.log("Atlas test complete - field filled with tiles 0-15 in order");
// }

// 16 tiles marching squares corner wang tiles


Field.prototype.proof = function(){
  // Elevation-based terrain generation: Deep Ocean → Water → Grass → Dirt → Mountains
  
  // Step 1: Generate height map using fractal noise
  this.generateHeightMap();
  
  // Step 2: Assign terrain types based on elevation thresholds
  this.assignTerrainByElevation();
  
  // Step 3: Apply marching squares for seamless transitions between adjacent terrains
  this.applyTerrainTransitions();
  
  // Step 4: Mark blocked tiles for pathfinding (water, etc.)
  this.updateBlockedTiles();
}

// Test function: Display all 16 tile variants from atlas-grass-dirt in a grid
// Directly assigns tile types without going through transition logic
Field.prototype.testAllDirtWaterTiles = function() {
  // console.log('🧪 Creating test grid with all 16 dirt-water tile variants...');
  
  // Clear existing terrain - make everything dirt
  for(let i = 0; i < this.tiles.length; i++) {
    this.heightMap[i] = 0.5;
    this.terrainTypes[i] = 3; // All dirt
  }
  
  // Create a 4x4 grid showing all 16 tile variants (cases 0-15)
  // Directly assign tile types to see the atlas tiles
  const gridSize = 4;
  const cellSize = 16; // 16x16 tiles per cell
  
  // Store what tile number should be in each cell for debugging
  const cellTiles = [];
  
  for(let gridY = 0; gridY < gridSize; gridY++) {
    for(let gridX = 0; gridX < gridSize; gridX++) {
      const caseNum = gridY * gridSize + gridX; // 0-15
      
      // Calculate the area for this cell
      const startX = gridX * cellSize;
      const startY = gridY * cellSize;
      const endX = Math.min(startX + cellSize, this.width);
      const endY = Math.min(startY + cellSize, this.height);
      
      // No swaps needed - use the case number directly
      const rawCase = caseNum;
      
      // Store for debugging
      cellTiles.push({gridX, gridY, expected: caseNum, actual: rawCase});
      
      // Directly assign tile type and atlas for this cell
      for(let y = startY; y < endY; y++) {
        for(let x = startX; x < endX; x++) {
          const index = y * this.width + x;
          const tile = this.tiles[index];
          
          // Set terrain to dirt so it uses grass-dirt atlas
          this.terrainTypes[index] = 3; // Dirt
          
          // Assign the raw tile type (no transformation for now)
          tile.type = rawCase;
          tile.atlasName = 'atlas-grass-dirt';
          tile.updateAtlasCoordinates();
        }
      }
    }
  }
  
  // Log the mapping with visual grid
  // console.log('   Tile mapping (Expected → Actual tile number):');
  // console.log('   ┌─────┬─────┬─────┬─────┐');
  // for(let gridY = 0; gridY < gridSize; gridY++) {
  //   let rowStr = '   │';
  //   for(let gridX = 0; gridX < gridSize; gridX++) {
  //     const idx = gridY * gridSize + gridX;
  //     const {expected, actual} = cellTiles[idx];
  //     const match = expected === actual ? '✓' : '⚠️';
  //     rowStr += ` ${expected}→${actual}${match} │`;
  //   }
  //   console.log(rowStr);
  //   if(gridY < gridSize - 1) console.log('   ├─────┼─────┼─────┼─────┤');
  // }
  // console.log('   └─────┴─────┴─────┴─────┘');
  // console.log('   Format: Expected→Actual (✓=match, ⚠️=mismatch)');
  
  // Also log detailed mapping
  // for(let i = 0; i < cellTiles.length; i++) {
  //   const {gridX, gridY, expected, actual} = cellTiles[i];
  //   if(gridX === 0) console.log(`   Row ${gridY} details:`);
  //   const match = expected === actual ? '✓' : '⚠️ MISMATCH';
  //   console.log(`     Cell (${gridX},${gridY}): Should show tile ${expected}, actually showing tile ${actual} ${match}`);
  // }
  
  // Force chunk regeneration
  const chunkKeys = Array.from(this.chunks.keys());
  chunkKeys.forEach(key => {
    const [chunkX, chunkZ] = key.split(',').map(Number);
    this.unloadChunk(chunkX, chunkZ);
  });
  
  // Trigger chunk reload if we're in-game
  if(window.gfx && window.gfx.camera) {
    const camPos = window.gfx.camera.position;
    this.updateVisibleChunks(camPos.x, camPos.z);
  }
  
  // console.log('✅ Test grid created! 4x4 grid showing all 16 dirt-water tile variants (cases 0-15)');
  // console.log('   Grid layout:');
  // console.log('   ┌─────┬─────┬─────┬─────┐');
  // console.log('   │  0  │  1  │  2  │  3  │  Top row');
  // console.log('   ├─────┼─────┼─────┼─────┤');
  // console.log('   │  4  │  5  │  6  │  7  │  Second row');
  // console.log('   ├─────┼─────┼─────┼─────┤');
  // console.log('   │  8  │  9  │ 10  │ 11  │  Third row');
  // console.log('   ├─────┼─────┼─────┼─────┤');
  // console.log('   │ 12  │ 13  │ 14  │ 15  │  Bottom row');
  // console.log('   └─────┴─────┴─────┴─────┘');
  // console.log('   Each cell shows the tile variant number that should be displayed');
  // console.log('   Check which tiles are actually showing in each cell position');
}

// Test function: Create alternating stripes to test wang tile transitions
Field.prototype.testStripes = function() {
  // console.log('🧪 Creating test stripes pattern (2-terrain: Dirt | Grass)...');
  
  // Clear existing terrain
  for(let i = 0; i < this.tiles.length; i++) {
    this.heightMap[i] = 0;
    this.terrainTypes[i] = 3; // Start with dirt
  }
  
  // Create horizontal stripes: Dirt | Grass | Dirt | Grass | ...
  for(let y = 0; y < this.height; y++) {
    const stripeIndex = Math.floor(y / 8); // 8 tiles per stripe
    const terrainType = (stripeIndex % 2 === 0) ? 3 : 2; // Alternate between dirt and grass
    
    for(let x = 0; x < this.width; x++) {
      const index = y * this.width + x;
      
      if(terrainType === 2) {
        this.terrainTypes[index] = 2; // Grass
        this.heightMap[index] = 0.8; // High elevation
      } else {
        this.terrainTypes[index] = 3; // Dirt
        this.heightMap[index] = 0.2; // Low elevation
      }
    }
  }
  
  // Apply transitions
  this.applyTerrainTransitions();
  
  // Force chunk regeneration
  const chunkKeys = Array.from(this.chunks.keys());
  chunkKeys.forEach(key => {
    const [chunkX, chunkZ] = key.split(',').map(Number);
    this.unloadChunk(chunkX, chunkZ);
  });
  
  // Trigger chunk reload if we're in-game
  if(window.gfx && window.gfx.camera) {
    const camPos = window.gfx.camera.position;
    this.updateVisibleChunks(camPos.x, camPos.z);
  }
  
  // console.log('✅ Test stripes created! Horizontal stripes: Dirt | Grass | Dirt | Grass...');
  // console.log('   Check for seamless transitions at boundaries');
  
  // Debug - show terrain distribution (2-tier system)
  // const grassCount = this.terrainTypes.filter(t => t === 2).length;
  // const dirtCount = this.terrainTypes.filter(t => t === 3).length;
  // console.log(`🌿 Grass: ${grassCount} (${(grassCount/this.tiles.length*100).toFixed(1)}%), 🟫 Dirt: ${dirtCount} (${(dirtCount/this.tiles.length*100).toFixed(1)}%)`);
  
  // Debug: Check tile types per terrain
  // const dirtTileTypes = {};
  // const grassTileTypes = {};
  // this.tiles.forEach((tile, i) => {
  //   const terrain = this.terrainTypes[i];
  //   if(terrain === 3) dirtTileTypes[tile.type] = (dirtTileTypes[tile.type] || 0) + 1;
  //   if(terrain === 2) grassTileTypes[tile.type] = (grassTileTypes[tile.type] || 0) + 1;
  // });
  // console.log('🟫 Dirt tile types:', dirtTileTypes);
  // console.log('🌿 Grass tile types:', grassTileTypes);
}

// Generate height map with radial falloff (low at edges, high in center)
Field.prototype.generateHeightMap = function() {
  const centerX = this.width / 2;
  const centerY = this.height / 2;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
  
  // Check if this is KOTH mode
  const isKOTH = window.currentMatch?.gameType === 'koth';
  
  // Disabled circles - they create big blobs
  // Using pure noise for intricate patterns
  const numCircles = 0;
  const circles = [];
  
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  
  for(let y = 0; y < this.height; y++) {
    for(let x = 0; x < this.width; x++) {
      const index = y * this.width + x;
      
      // Simple sine-wave based noise - reliable and creates organic patterns
      // Multiple frequencies combined for natural terrain
      const seed1 = this.seed * 0.01;
      const seed2 = this.seed * 0.02;
      const seed3 = this.seed * 0.03;
      
      // Layer 1: Large features (~10 tile wavelength)
      const wave1 = Math.sin(x * 0.1 + seed1) * Math.cos(y * 0.1 + seed1);
      
      // Layer 2: Medium features (~4 tile wavelength)  
      const wave2 = Math.sin(x * 0.25 + seed2) * Math.cos(y * 0.25 + seed2);
      
      // Layer 3: Fine features (~2 tile wavelength)
      const wave3 = Math.sin(x * 0.5 + seed3) * Math.cos(y * 0.5 + seed3);
      
      // Layer 4: Add diagonal patterns for more variety
      const wave4 = Math.sin((x + y) * 0.3 + seed1) * 0.5;
      
      // Combine waves with different weights
      const combined = wave1 * 0.35 + wave2 * 0.3 + wave3 * 0.25 + wave4 * 0.1;
      const finalHeight = (combined + 1) / 2; // Normalize from [-1,1] to [0,1]
      
      this.heightMap[index] = finalHeight;
      minHeight = Math.min(minHeight, finalHeight);
      maxHeight = Math.max(maxHeight, finalHeight);
    }
  }
  
  // console.log(`📊 Height map range BEFORE normalization: ${minHeight.toFixed(3)} to ${maxHeight.toFixed(3)} ${isKOTH ? '(KOTH mode - central peak)' : ''}`);
  
  // CRITICAL: Renormalize to full 0-1 range so we get all terrain types
  for(let i = 0; i < this.heightMap.length; i++) {
    this.heightMap[i] = (this.heightMap[i] - minHeight) / (maxHeight - minHeight);
  }
  
  // console.log(`📊 Height map AFTER normalization: 0.000 to 1.000`);
  
  // Debug: Sample some heightmap values to see distribution
  // const samples = [];
  // for(let i = 0; i < 10; i++) {
  //   const idx = Math.floor((i / 10) * this.heightMap.length);
  //   samples.push(this.heightMap[idx].toFixed(3));
  // }
  // console.log(`📊 Height map samples (10 points): ${samples.join(', ')}`);
}

// Assign terrain types based on elevation thresholds
// 3-terrain system: Water (lowest) → Grass (mid) → Dirt (high)
// Type 1=water, Type 2=dirt, Type 3=grass
Field.prototype.assignTerrainByElevation = function() {
  let waterCount = 0;
  let dirtCount = 0;
  let grassCount = 0;
  
  // First pass: assign terrain based on elevation
  for(let i = 0; i < this.heightMap.length; i++) {
    const height = this.heightMap[i];
    
    // 3-tier elevation system:
    // - Water at lowest elevations (< 0.15) ~15%
    // - Grass at mid elevations (0.15 - 0.55) ~55%
    // - Dirt at high elevations (>= 0.55) ~30%
    if(height < 0.15) {
      this.terrainTypes[i] = 1; // Water (lowest areas)
      waterCount++;
    } else if(height < 0.55) {
      this.terrainTypes[i] = 3; // Grass (mid areas)
      grassCount++;
    } else {
      this.terrainTypes[i] = 2; // Dirt (high areas)
      dirtCount++;
    }
  }
  
  // Second pass: ensure grass buffer around water (prevent water-dirt adjacency)
  // We don't have a water-dirt atlas, so water must always touch grass
  for(let y = 0; y < this.height; y++) {
    for(let x = 0; x < this.width; x++) {
      const index = y * this.width + x;
      if(this.terrainTypes[index] === 1) { // Water tile
        // Check all 8 neighbors
        for(let dy = -1; dy <= 1; dy++) {
          for(let dx = -1; dx <= 1; dx++) {
            if(dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if(nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
              const nIndex = ny * this.width + nx;
              // Convert dirt neighbors to grass (create shoreline buffer)
              if(this.terrainTypes[nIndex] === 2) {
                this.terrainTypes[nIndex] = 3;
                dirtCount--;
                grassCount++;
              }
            }
          }
        }
      }
    }
  }
  
  const total = this.heightMap.length;
  console.log(`🌊 Water: ${waterCount} (${(waterCount/total*100).toFixed(1)}%), 🌿 Grass: ${grassCount} (${(grassCount/total*100).toFixed(1)}%), 🟫 Dirt: ${dirtCount} (${(dirtCount/total*100).toFixed(1)}%)`);
}

// OLD PATCH PAINTING - REPLACED BY ELEVATION
Field.prototype.paintWaterBodies_OLD = function() {
  const numWaterBodies = Math.floor(this.width * this.height / 400); // Fewer bodies
  
  for(let i = 0; i < numWaterBodies; i++) {
    const centerX = Math.floor(this.rng() * this.width);
    const centerY = Math.floor(this.rng() * this.height);
    const bodySize = 4 + Math.floor(this.rng() * 8); // 4-11 tiles radius (smaller bodies)
    
    for(let x = Math.max(0, centerX - bodySize); x <= Math.min(this.width - 1, centerX + bodySize); x++) {
      for(let y = Math.max(0, centerY - bodySize); y <= Math.min(this.height - 1, centerY + bodySize); y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if(distance <= bodySize) {
          this.waterMap[y * this.width + x] = 1; // Mark as water
        }
      }
    }
  }
}

// Paint grass patches in mid-elevation (can overlap with water to create shores)
// Target: ~60% grass coverage (leaving ~15% dirt visible)
Field.prototype.paintGrassPatches = function() {
  const numPatches = Math.floor(this.width * this.height / 200); // Moderate number of patches
  
  for(let i = 0; i < numPatches; i++) {
    const centerX = Math.floor(this.rng() * this.width);
    const centerY = Math.floor(this.rng() * this.height);
    const patchSize = 6 + Math.floor(this.rng() * 10); // 6-15 tiles radius (medium patches)
    
    for(let x = Math.max(0, centerX - patchSize); x <= Math.min(this.width - 1, centerX + patchSize); x++) {
      for(let y = Math.max(0, centerY - patchSize); y <= Math.min(this.height - 1, centerY + patchSize); y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if(distance <= patchSize) {
          // Paint grass everywhere - can overlap water to create shores!
          this.grassMap[y * this.width + x] = 1; // Mark as grass
        }
      }
    }
  }
  
  // CRITICAL: Force grass buffer between water and dirt (we don't have water-dirt atlas!)
  // Add grass ring around ALL water tiles to prevent water-dirt adjacency
  for(let x = 0; x < this.width; x++) {
    for(let y = 0; y < this.height; y++) {
      const index = y * this.width + x;
      if(this.waterMap[index] === 1) {
        // Paint grass in 1-tile ring around this water tile
        for(let dx = -1; dx <= 1; dx++) {
          for(let dy = -1; dy <= 1; dy++) {
            const nx = x + dx;
            const ny = y + dy;
            if(nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
              const nIndex = ny * this.width + nx;
              // Only paint grass if NOT water (keep water as water)
              if(this.waterMap[nIndex] === 0) {
                this.grassMap[nIndex] = 1;
              }
            }
          }
        }
      }
    }
  }
  
  // Add noise to grass edges to create more organic transitions
  // Randomly remove grass from edges to create varied boundaries
  for(let i = 0; i < this.width * this.height / 40; i++) {
    const x = Math.floor(this.rng() * this.width);
    const y = Math.floor(this.rng() * this.height);
    const index = y * this.width + x;
    
    // Only modify grass that's NOT adjacent to water (keep water shores intact)
    if(this.grassMap[index] === 1 && this.waterMap[index] === 0) {
      let hasWaterNeighbor = false;
      for(let dx = -1; dx <= 1; dx++) {
        for(let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if(nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            if(this.waterMap[ny * this.width + nx] === 1) {
              hasWaterNeighbor = true;
              break;
            }
          }
        }
        if(hasWaterNeighbor) break;
      }
      
      // If no water nearby, randomly remove this grass to create jagged edges
      if(!hasWaterNeighbor && this.rng() < 0.3) {
        this.grassMap[index] = 0;
      }
    }
  }
}

// Apply marching squares transitions between adjacent terrain types
Field.prototype.applyTerrainTransitions = function() {
  // 3-terrain system: Water (1), Dirt (2), Grass (3)
  // Create density maps for each transition type
  // Grass-Dirt: grass=filled(1), dirt=empty(0)
  // Grass-Water: grass=filled(1), water=empty(0)
  const grassVsDirt = this.terrainTypes.map(t => t === 3 ? 1 : 0);
  const grassVsWater = this.terrainTypes.map(t => (t === 3 || t === 2) ? 1 : 0); // Grass OR dirt = land (filled), water = empty
  
  for(let x = 0; x < this.width; x++) {
    for(let y = 0; y < this.height; y++) {
      const tile = this.tiles[y * this.width + x];
      const index = y * this.width + x;
      const terrain = this.terrainTypes[index];
      
      // Check what terrain types are adjacent
      let hasWaterNeighbor = false;
      let hasDirtNeighbor = false;
      let hasGrassNeighbor = false;
      
      for(let dx = -1; dx <= 1; dx++) {
        for(let dy = -1; dy <= 1; dy++) {
          if(dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if(nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            const neighborTerrain = this.terrainTypes[ny * this.width + nx];
            if(neighborTerrain === 1) hasWaterNeighbor = true;
            if(neighborTerrain === 2) hasDirtNeighbor = true;
            if(neighborTerrain === 3) hasGrassNeighbor = true;
          }
        }
      }
      
      // Determine which atlas and tile case to use
      if(terrain === 1) {
        // Water tile - use grass-water atlas (water side)
        if(hasGrassNeighbor) {
          // Transition to grass - use marching squares
          const tileCase = this.calculateCompatibleVariant(x, y, grassVsWater);
          tile.type = tileCase;
          tile.atlasName = 'atlas-grass-water';
        } else {
          // Pure water
          tile.type = 12; // Case 0 (all empty) = pure water
          tile.atlasName = 'atlas-grass-water';
        }
      } else if(terrain === 3) {
        // Grass tile
        if(hasWaterNeighbor) {
          // Priority: water transition (shoreline)
          const tileCase = this.calculateCompatibleVariant(x, y, grassVsWater);
          tile.type = tileCase;
          tile.atlasName = 'atlas-grass-water';
        } else if(hasDirtNeighbor) {
          // Transition to dirt
          const tileCase = this.calculateCompatibleVariant(x, y, grassVsDirt);
          tile.type = tileCase;
          tile.atlasName = 'atlas-grass-dirt';
        } else {
          // Pure grass
          tile.type = 6; // Case 15 (all filled) = pure grass
          tile.atlasName = 'atlas-grass-dirt';
        }
      } else if(terrain === 2) {
        // Dirt tile
        if(hasGrassNeighbor) {
          // Transition to grass
          const tileCase = this.calculateCompatibleVariant(x, y, grassVsDirt);
          tile.type = tileCase;
          tile.atlasName = 'atlas-grass-dirt';
        } else {
          // Pure dirt
          tile.type = 12; // Case 0 (all empty) = pure dirt
          tile.atlasName = 'atlas-grass-dirt';
        }
      }
      
      tile.updateAtlasCoordinates();
    }
  }
}

// Removed expandPainting - no longer needed with multi-layer system

// Calculate compatible tile variant based on proper marching squares logic
Field.prototype.calculateCompatibleVariant = function(x, y, densityMap) {
  // Use the provided density map (waterMap or grassMap)
  const mapToUse = densityMap || this.grassMap;
  
  // Evaluate the 4 corners of tile (x,y)
  // Corner positions are at tile intersections:
  // - Bottom-left corner: intersection of tiles (x-1,y-1), (x,y-1), (x-1,y), (x,y)
  // - Top-left corner: intersection of tiles (x-1,y), (x,y), (x-1,y+1), (x,y+1)
  // - Bottom-right corner: intersection of tiles (x,y-1), (x+1,y-1), (x,y), (x+1,y)
  // - Top-right corner: intersection of tiles (x,y), (x+1,y), (x,y+1), (x+1,y+1)
  const x0y0 = this.getCornerValue(x, y, mapToUse);      // bottom-left corner of tile (x,y)
  const x0y1 = this.getCornerValue(x, y + 1, mapToUse);  // top-left corner of tile (x,y)
  const x1y0 = this.getCornerValue(x + 1, y, mapToUse);  // bottom-right corner of tile (x,y)
  const x1y1 = this.getCornerValue(x + 1, y + 1, mapToUse); // top-right corner of tile (x,y)
  
  // Create the case number using binary counting (exactly like Python)
  // case = ((1 if x0y0 > 0 else 0) + (2 if x0y1 > 0 else 0) + (4 if x1y0 > 0 else 0) + (8 if x1y1 > 0 else 0))
  let case_num = 0;
  if(x0y0 > 0) case_num += 1;   // bottom-left
  if(x0y1 > 0) case_num += 2;   // top-left
  if(x1y0 > 0) case_num += 4;   // bottom-right
  if(x1y1 > 0) case_num += 8;   // top-right
  
  // // Debug logging for first few tiles
  // if(x < 5 && y < 5) {
  //   console.log(`Tile (${x},${y}): corners=[${x0y0.toFixed(1)},${x0y1.toFixed(1)},${x1y0.toFixed(1)},${x1y1.toFixed(1)}] case=${case_num}`);
  // }
  
  // Map the case to the correct tile variant based on marching cubes geometry
  const selectedTile = this.mapMarchingCaseToTile(case_num);
  
  // // Debug logging for first few tiles
  // if(x < 5 && y < 5) {
  //   console.log(`  → Selected tile: G${selectedTile.toString().padStart(2, '0')}`);
  // }
  
  return selectedTile;
}

// Calculate compatible variant excluding the current tile from corner evaluation
// This is needed for dirt-water transitions where the current tile being dirt causes all corners to be 1
Field.prototype.calculateCompatibleVariantExcludingSelf = function(x, y, densityMap) {
  const mapToUse = densityMap || this.grassMap;
  
  // Evaluate corners but exclude the current tile (x,y) from the evaluation
  // This way corners on the water side will correctly evaluate to 0
  const x0y0 = this.getCornerValueExcludingSelf(x, y, mapToUse, x, y);      // bottom-left
  const x0y1 = this.getCornerValueExcludingSelf(x, y + 1, mapToUse, x, y);  // top-left  
  const x1y0 = this.getCornerValueExcludingSelf(x + 1, y, mapToUse, x, y);  // bottom-right
  const x1y1 = this.getCornerValueExcludingSelf(x + 1, y + 1, mapToUse, x, y); // top-right
  
  let case_num = 0;
  if(x0y0 > 0) case_num += 1;   // bottom-left
  if(x0y1 > 0) case_num += 2;   // top-left
  if(x1y0 > 0) case_num += 4;   // bottom-right
  if(x1y1 > 0) case_num += 8;   // top-right
  
  const selectedTile = this.mapMarchingCaseToTile(case_num);
  return selectedTile;
}

// Get corner value excluding a specific tile from evaluation
Field.prototype.getCornerValueExcludingSelf = function(cornerX, cornerY, densityMap, excludeX, excludeY) {
  const mapToUse = densityMap || this.grassMap;
  let maxDensity = 0;
  let hasValidTile = false;
  
  // Sample all 4 tiles sharing this corner, but exclude (excludeX, excludeY)
  const tiles = [
    [cornerX, cornerY],
    [cornerX-1, cornerY],
    [cornerX, cornerY-1],
    [cornerX-1, cornerY-1]
  ];
  
  for(let [tx, ty] of tiles) {
    // Skip the excluded tile
    if(tx === excludeX && ty === excludeY) continue;
    
    if(tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
      const density = mapToUse[ty * this.width + tx];
      maxDensity = Math.max(maxDensity, density);
      hasValidTile = true;
    }
  }
  
  return hasValidTile ? maxDensity : 0;
}

// Get the corner value for a specific corner position from a density map
// In marching squares, corners are at tile intersections
// Corner (x, y) represents the bottom-left corner of tile (x, y)
// We evaluate it from the tile that contains that corner
// IMPORTANT: For dirt-water transitions, we need to evaluate corners based on what terrain
// is actually at those corner positions, not just the density map
Field.prototype.getCornerValue = function(x, y, densityMap) {
  const mapToUse = densityMap || this.grassMap;
  // For corner at (x, y), this corner is shared by 4 tiles:
  // - Tile (x-1, y-1) - bottom-left of corner
  // - Tile (x, y-1) - bottom-right of corner  
  // - Tile (x-1, y) - top-left of corner
  // - Tile (x, y) - top-right of corner
  // We sample from all 4 tiles and use the maximum (if ANY is filled, corner is filled)
  // BUT: We need to be careful - if the corner is at the edge of the map, we only sample valid tiles
  let maxDensity = 0;
  let hasValidTile = false;
  
  // Sample all 4 tiles sharing this corner
  // Note: Corner (x,y) is the bottom-left corner of tile (x,y)
  // So it's shared by: (x-1,y-1), (x,y-1), (x-1,y), (x,y)
  const tiles = [
    [x, y],           // Primary tile (top-right of corner)
    [x-1, y],        // Left neighbor (top-left of corner)
    [x, y-1],        // Bottom neighbor (bottom-right of corner)
    [x-1, y-1]       // Diagonal neighbor (bottom-left of corner)
  ];
  
  for(let [tx, ty] of tiles) {
    if(tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
      const density = mapToUse[ty * this.width + tx];
      maxDensity = Math.max(maxDensity, density);
      hasValidTile = true;
    }
  }
  
  // If no valid tiles (corner is outside map), return 0 (empty)
  // Otherwise return the maximum density (1 = filled, 0 = empty)
  return hasValidTile ? maxDensity : 0;
}

// Map marching cubes case to tile variant based on the atlas layout
Field.prototype.mapMarchingCaseToTile = function(case_num) {
  // Atlas tile to marching squares case mapping
  // Each case should map to exactly one atlas tile
  // Atlas layout: 0-15 indexed from top-left, reading left-to-right, top-to-bottom

  // Complete corrected mapping based on actual atlas tile descriptions
  // Decoded from user's full 16-tile description
  const caseToAtlasTile = {
    0: 12,  // Case 0 (empty) → Tile 12 "none"
    1: 0,   // Case 1 (BL only) → Tile 0 "BL minor"
    2: 15,  // Case 2 (TL only) → Tile 15 "TL minor"
    3: 11,  // Case 3 (BL+TL left edge) → Tile 11 "left"
    4: 13,  // Case 4 (BR only) → Tile 13 "BR minor"
    5: 3,   // Case 5 (BL+BR bottom edge) → Tile 3 "bottom"
    6: 4,   // Case 6 (TL+BR diagonal) → Tile 4 "TL+BR minor"
    7: 2,   // Case 7 (BL+TL+BR three corners) → Tile 2 "BL major"
    8: 8,   // Case 8 (TR only) → Tile 8 "TR minor"
    9: 14,  // Case 9 (BL+TR diagonal) → Tile 14 "BL+TR minor"
    10: 9,  // Case 10 (TL+TR top edge) → Tile 9 "top"
    11: 7,  // Case 11 (BL+TL+TR three corners) → Tile 7 "TL major"
    12: 1,  // Case 12 (BR+TR right edge) → Tile 1 "right"
    13: 5,  // Case 13 (BL+BR+TR three corners) → Tile 5 "BR major"
    14: 10, // Case 14 (TL+BR+TR three corners) → Tile 10 "TR major"
    15: 6   // Case 15 (all filled) → Tile 6 "full"
  };
  
  return caseToAtlasTile[case_num] || 0; // Return the atlas tile for this case
}

// Method to display the current tilemap in console
Field.prototype.showTilemap = function(){
  let output = '';
  
  for(let y = 0; y < this.height; y++){
    let row = '';
    for(let x = 0; x < this.width; x++){
      const tile = this.tiles[y * this.width + x];
      const variant = tile.type; // Since we're only using grass (0-15)
      row += `G${variant.toString().padStart(2, '0')} `;
    }
    output += row + '\n';
  }
  
  // console.log(output);
  // console.log(`Legend: G=Grass | Numbers are tile variants (0-15)`);
}

// Debug method to show marching squares case distribution
Field.prototype.showMarchingSquaresCases = function() {
  // console.log('🔍 Marching Squares Case Distribution:');
  
  const caseCounts = {};
  const caseToTile = {};
  
  for(let y = 0; y < this.height; y++) {
    for(let x = 0; x < this.width; x++) {
      const tile = this.tiles[y * this.width + x];
      
      // Recalculate the case for this tile
      const x0y0 = this.getCornerValue(x, y);
      const x0y1 = this.getCornerValue(x, y + 1);
      const x1y0 = this.getCornerValue(x + 1, y);
      const x1y1 = this.getCornerValue(x + 1, y + 1);
      
      let case_num = 0;
      if(x0y0 > 0) case_num += 1;
      if(x0y1 > 0) case_num += 2;
      if(x1y0 > 0) case_num += 4;
      if(x1y1 > 0) case_num += 8;
      
      caseCounts[case_num] = (caseCounts[case_num] || 0) + 1;
      caseToTile[case_num] = tile.type;
    }
  }
  
  // Show which cases map to which tiles
  // console.table({
  //   'Case 0 (empty)': { tile: caseToTile[0], count: caseCounts[0] || 0, corners: '----' },
  //   'Case 1 (BL)': { tile: caseToTile[1], count: caseCounts[1] || 0, corners: 'BL--' },
  //   'Case 2 (TL)': { tile: caseToTile[2], count: caseCounts[2] || 0, corners: '-TL-' },
  //   'Case 3 (BL+TL left)': { tile: caseToTile[3], count: caseCounts[3] || 0, corners: 'BL,TL' },
  //   'Case 4 (BR)': { tile: caseToTile[4], count: caseCounts[4] || 0, corners: '--BR' },
  //   'Case 5 (BL+BR bottom)': { tile: caseToTile[5], count: caseCounts[5] || 0, corners: 'BL,BR' },
  //   'Case 6 (TL+BR diag)': { tile: caseToTile[6], count: caseCounts[6] || 0, corners: 'TL,BR' },
  //   'Case 7 (3 corners)': { tile: caseToTile[7], count: caseCounts[7] || 0, corners: 'BL,TL,BR' },
  //   'Case 8 (TR)': { tile: caseToTile[8], count: caseCounts[8] || 0, corners: '---TR' },
  //   'Case 9 (BL+TR diag)': { tile: caseToTile[9], count: caseCounts[9] || 0, corners: 'BL,TR' },
  //   'Case 10 (TL+TR top)': { tile: caseToTile[10], count: caseCounts[10] || 0, corners: 'TL,TR' },
  //   'Case 11 (3 corners)': { tile: caseToTile[11], count: caseCounts[11] || 0, corners: 'BL,TL,TR' },
  //   'Case 12 (BR+TR right)': { tile: caseToTile[12], count: caseCounts[12] || 0, corners: 'BR,TR' },
  //   'Case 13 (3 corners)': { tile: caseToTile[13], count: caseCounts[13] || 0, corners: 'BL,BR,TR' },
  //   'Case 14 (3 corners)': { tile: caseToTile[14], count: caseCounts[14] || 0, corners: 'TL,BR,TR' },
  //   'Case 15 (all)': { tile: caseToTile[15], count: caseCounts[15] || 0, corners: 'ALL' }
  // });
  
  // console.log('\n📊 Summary:');
  // console.log(`Total tiles: ${this.width * this.height}`);
  // console.log(`Unique cases found: ${Object.keys(caseCounts).length}`);
}

// Method to get a tile at specific coordinates
Field.prototype.getTile = function(x, y) {
  if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
    return this.tiles[y * this.width + x];
  }
  return null;
};

// Check if a tile is passable for pathfinding
Field.prototype.isPassable = function(x, y) {
  // Out of bounds = not passable
  if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
    return false;
  }
  
  // Check if tile is on a disabled chunk (off the table)
  if (this.chunkMask) {
    const chunkX = Math.floor(x / this.chunkSize);
    const chunkZ = Math.floor(y / this.chunkSize);
    if (this.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
      return false;
    }
  }
  
  // Check blocked tiles set (pure water, rocks, etc.)
  const key = `${x},${y}`;
  if (this.blockedTiles.has(key)) {
    return false;
  }
  
  return true;
};

// Check if a tile slows movement (trees)
Field.prototype.isSlow = function(x, y) {
  const key = `${x},${y}`;
  return this.slowTiles.has(key);
};

// Block a tile (for resources, buildings, etc.)
Field.prototype.blockTile = function(x, y) {
  this.blockedTiles.add(`${x},${y}`);
};

// Unblock a tile
Field.prototype.unblockTile = function(x, y) {
  this.blockedTiles.delete(`${x},${y}`);
};

// Block multiple tiles (footprint)
Field.prototype.blockFootprint = function(centerX, centerY, radius) {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (Math.sqrt(dx*dx + dy*dy) <= radius + 0.5) {
        this.blockTile(centerX + dx, centerY + dy);
      }
    }
  }
};

// Unblock multiple tiles (footprint)
Field.prototype.unblockFootprint = function(centerX, centerY, radius) {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (Math.sqrt(dx*dx + dy*dy) <= radius + 0.5) {
        this.unblockTile(centerX + dx, centerY + dy);
      }
    }
  }
};

// Mark pure water tiles as blocked (shorelines are passable)
Field.prototype.updateBlockedTiles = function() {
  let pureWaterCount = 0;
  
  for (let y = 0; y < this.height; y++) {
    for (let x = 0; x < this.width; x++) {
      const index = y * this.width + x;
      
      // Only block pure water (terrain type 1 AND tile type 12 = solid water)
      if (this.terrainTypes[index] === 1) {
        const tile = this.tiles[index];
        // Tile type 12 is the "pure/solid" tile in marching squares
        // Other water tiles (0-11, 13-15) are transitions/shorelines
        if (tile && tile.type === 12) {
          this.blockTile(x, y);
          pureWaterCount++;
        }
      }
    }
  }
  console.log(`🚫 Marked ${pureWaterCount} pure water tiles as blocked (shorelines passable)`);
};

// Get movement speed multiplier for a tile (1.0 = normal, 0.5 = slow)
Field.prototype.getSpeedMultiplier = function(x, y) {
  const key = `${x},${y}`;
  if (this.slowTiles.has(key)) {
    return this.slowMultiplier;
  }
  return 1.0;
};

// Mark a tile as slow (for trees)
Field.prototype.slowTile = function(x, y) {
  this.slowTiles.add(`${x},${y}`);
};

// Unmark a slow tile
Field.prototype.unslowTile = function(x, y) {
  this.slowTiles.delete(`${x},${y}`);
};

  // Helper: Check if position is in a spawn zone
  Field.prototype.isInSpawnZone = function(x, y) {
    for (const spawn of this.spawnPositions) {
      const dx = x - spawn.x;
      const dy = y - spawn.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= this.spawnZoneRadius) {
        return true;
      }
    }
    return false;
  };

  // Build precomputed height grid for fast lookups
  // Uses the same calculation as terrain mesh generation for consistency
  Field.prototype._buildHeightGrid = function() {
    // Create 2D array: heightGrid[tileX][tileZ] = height at tile center
    this._heightGrid = [];
    
    // Ensure heightMap and terrainTypes are populated (should be after proof())
    if (!this.heightMap || this.heightMap.length === 0) {
      console.warn('⚠️ _buildHeightGrid called before heightMap is populated!');
      return;
    }
    
    for (let x = 0; x < this.width; x++) {
      this._heightGrid[x] = [];
      for (let z = 0; z < this.height; z++) {
        // Get height at tile center (x + 0.5, z + 0.5 for center of tile)
        // This matches how terrain mesh vertices are calculated
        this._heightGrid[x][z] = this.getHeightVariation(x + 0.5, z + 0.5);
      }
    }
    
    // Debug: verify grid was built
    if (this._heightGrid.length > 0 && this._heightGrid[0].length > 0) {
      // console.log(`✅ Height grid built: ${this.width}x${this.height} tiles`);
    }
  };
  
  // Method to get height variation for terrain (based on elevation/terrain type)
  Field.prototype.getHeightVariation = function(x, y, amplitude = null) {
    // Get terrain type at this position
    if(x >= 0 && x < this.width && y >= 0 && y < this.height) {
      const index = Math.floor(y) * this.width + Math.floor(x);
      const terrain = this.terrainTypes[index];
      
      // Flatten spawn zones (agora placement areas)
      if (this.isInSpawnZone(x, y)) {
        return 0; // Completely flat at Y=0 for agora placement
      }
      
      // Calculate edge falloff - fade height to 0 at map edges (keeps terrain pinned to table)
      const edgeDistance = 3; // Tiles from edge to start fading
      const distFromEdgeX = Math.min(x, this.width - 1 - x);
      const distFromEdgeY = Math.min(y, this.height - 1 - y);
      const distFromEdge = Math.min(distFromEdgeX, distFromEdgeY);
      const edgeFalloff = Math.min(1.0, distFromEdge / edgeDistance); // 0 at edge, 1 at interior
      
      // Base Y-offset by terrain type (2-terrain system)
      // Type 2=dirt (lower), Type 3=grass (higher)
      const terrainHeights = {
        1: -0.3,  // Water (sunken below land level)
        2: 0.1,   // Dirt base (low areas - tamped down)
        3: 0.4,   // Grass base (higher rolling hills)
      };
      
      const baseHeight = terrainHeights[terrain] || 0;
      
      // Water is flat, no hills
      if (terrain === 1) {
        return baseHeight * edgeFalloff;
      }
      
      // Add rolling hills using multiple noise layers (smoother, gentler relief)
      const hill1 = this.getNoiseVariation(x * 0.5, y * 0.5, 1.0) * 0.5;  // Large smooth rolling hills
      const hill2 = this.getNoiseVariation(x, y, 0.5) * 0.15; // Medium hills
      const detail = this.getNoiseVariation(x * 2, y * 2, 0.25) * 0.05; // Subtle detail (reduced)
      const totalHills = hill1 + hill2 + detail;
      
      // Dirt should be flatter (tamped down) but not completely flat
      const hillMultiplier = (terrain === 2) ? 0.5 : 1.0; // Dirt gets 50% of hills
      
      // Apply edge falloff to both base and hills - everything fades to 0 at edges
      return (baseHeight + totalHills * hillMultiplier) * edgeFalloff;
    }
    
    return 0;
  }
  
  // Get small noise variation (for texture on top of terrain elevation)
  Field.prototype.getNoiseVariation = function(x, y, amplitude = null) {
    const effectiveAmplitude = amplitude || this.currentHeightVariation || this.originalHeightVariation || 0.11;
    
    const cacheKey = `${Math.floor(x)},${Math.floor(y)}`;
    if (this._heightCache.has(cacheKey)) {
      return this._heightCache.get(cacheKey) * effectiveAmplitude;
    }
    
    // Fast fractal noise using simple hash as base
    let total = 0;
    let frequency = 0.5; // Start with lower frequency for smoother features
    let amplitude_octave = 1;
    let maxValue = 0;
    
    // 2 octaves for smoother, more rolling variation (reduced from 3)
    for (let i = 0; i < 2; i++) {
      let hash = this.seed + i * 1000;
      hash = ((hash << 13) ^ hash) >>> 0;
      hash = ((hash * (hash * hash * 15731 + 789221) + 1376312589) & 0xfffffff) >>> 0;
      
      // Mix in coordinates with frequency - smoother transitions
      hash = ((hash << 13) ^ (hash + Math.floor(x * frequency) * 19349663)) >>> 0;
      hash = ((hash << 13) ^ (hash + Math.floor(y * frequency) * 73856093)) >>> 0;
      
      const noiseValue = Math.sin(hash * 0.5) + Math.sin(hash * 0.1) * 0.5 + Math.sin(hash * 0.01) * 0.25;

      total += noiseValue * amplitude_octave;
      maxValue += amplitude_octave;
      
      frequency *= 1.5; // Gentler frequency increase for smoother transitions
      amplitude_octave *= 0.6; // Less aggressive amplitude reduction
    }
    
    const finalNoise = total / maxValue;
    
    // Cache the result (without amplitude)
    this._heightCache.set(cacheKey, finalNoise);
    
    return finalNoise * effectiveAmplitude;
  }










// Chunk management methods
Field.prototype.getChunk = function(chunkX, chunkZ) {
  const chunkKey = `${chunkX},${chunkZ}`;
  
  // Return cached chunk if it exists
  if (this.chunks.has(chunkKey)) {
    return this.chunks.get(chunkKey);
  }
  
  // Create new chunk data
  const startX = chunkX * this.chunkSize;
  const startZ = chunkZ * this.chunkSize;
  const endX = Math.min(startX + this.chunkSize, this.width);
  const endZ = Math.min(startZ + this.chunkSize, this.height);
  
  const chunkTiles = [];
  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      chunkTiles.push(this.tiles[z * this.width + x]);
    }
  }
  
  const chunkData = {
    tiles: chunkTiles,
    startX, startZ, endX, endZ,
    chunkX, chunkZ,
    mesh: null, // Will be set by gfx.js after creation
    field: this // Reference to the field for height variation
  };
  
  this.chunks.set(chunkKey, chunkData);
  return chunkData;
};

Field.prototype.unloadChunk = function(chunkX, chunkZ) {
  const key = `${chunkX},${chunkZ}`;
  const chunk = this.chunks.get(key);
  if (chunk) {
    // Use gfx model pooling cleanup instead of disposing models
    if (window.gfx && window.gfx.cleanupChunkModels) {
      window.gfx.cleanupChunkModels(key);
    }
    
    if (chunk.mesh) {
      // Dispose the mesh completely
      chunk.mesh.dispose();
      chunk.mesh = null;
    }
    this.chunks.delete(key);
  }
};

Field.prototype.updateVisibleChunks = function(playerX, playerZ, loadDistance = null) {
  // Use LOD-controlled distance if available, otherwise use default
  const effectiveLoadDistance = loadDistance || this.currentLoadDistance || this.originalLoadDistance || 4;
  
  const playerChunkX = Math.floor(playerX / (this.chunkSize * TILE_SIZE)); // Use TILE_SIZE constant
  const playerChunkZ = Math.floor(playerZ / (this.chunkSize * TILE_SIZE)); // Use TILE_SIZE constant
  
  let chunksLoaded = 0;
  let chunksUnloaded = 0;
  
  // Load chunks within circular radius (more efficient than square)
  for (let x = playerChunkX - effectiveLoadDistance; x <= playerChunkX + effectiveLoadDistance; x++) {
    for (let z = playerChunkZ - effectiveLoadDistance; z <= playerChunkZ + effectiveLoadDistance; z++) {
      // Check if chunk is within circular radius (use squared distance for performance)
      const dx = x - playerChunkX;
      const dz = z - playerChunkZ;
      const distanceSquared = dx * dx + dz * dz;
      const effectiveLoadDistanceSquared = effectiveLoadDistance * effectiveLoadDistance;
      
      if (distanceSquared <= effectiveLoadDistanceSquared && x >= 0 && z >= 0 && 
          x < Math.ceil(this.width / this.chunkSize) && z < Math.ceil(this.height / this.chunkSize)) {
        
        // Skip disabled chunks (for custom map shapes)
        const chunkKey = `${x},${z}`;
        if (this.chunkMask && this.chunkMask.get(chunkKey) === false) {
          continue;
        }
        
        const chunk = this.getChunk(x, z);
        
        // Create mesh if it doesn't exist yet
        if (chunk && !chunk.mesh) {
          chunk.needsMesh = true;
          chunksLoaded++;
        }
      }
    }
  }
  
  // Unload chunks outside circular radius (use squared distance for performance)
  for (const [key, chunk] of this.chunks) {
    const [chunkX, chunkZ] = key.split(',').map(Number);
    const dx = chunkX - playerChunkX;
    const dz = chunkZ - playerChunkZ;
    const distanceSquared = dx * dx + dz * dz;
    const effectiveLoadDistanceSquared = effectiveLoadDistance * effectiveLoadDistance;
    
    if (distanceSquared > effectiveLoadDistanceSquared) {
      this.unloadChunk(chunkX, chunkZ);
      chunksUnloaded++;
    }
  }
  
  // Debug info (only log when something changes)
  if (chunksLoaded > 0 || chunksUnloaded > 0) {
    const totalChunks = this.chunks.size;
    const lodModelCount = window.gfx?.lodModels?.length || 0;
    // console.log(`🗺️ Chunks: ${totalChunks} loaded | +${chunksLoaded} added, -${chunksUnloaded} removed | LOD models: ${lodModelCount}`);
  }
};

// Method to create mesh for a chunk (called from gfx.js)
Field.prototype.createChunkMesh = function(chunkX, chunkZ, scene, createTerrainMeshFunc) {
  const chunk = this.chunks.get(`${chunkX},${chunkZ}`);
  if (chunk && !chunk.mesh) {
    // Create new mesh each time (no caching)
    chunk.mesh = createTerrainMeshFunc(scene, chunk, 4);
    chunk.needsMesh = false;
    
    // Lazy load models - don't block chunk creation
    setTimeout(() => {
      if (chunk && chunk.mesh) {
        // We need to call placeModelsOnChunk from gfx.js
        // For now, just mark that models need to be loaded
        chunk.needsModels = true;
      }
    }, 0);
  }
};

// Dispose field and clean up all resources
Field.prototype.dispose = function() {
  if (window.gfx && window.gfx.clearChunkQueue) {
    window.gfx.clearChunkQueue();
  }
  
  const chunkKeys = Array.from(this.chunks.keys());
  chunkKeys.forEach(key => {
    const [chunkX, chunkZ] = key.split(',').map(Number);
    this.unloadChunk(chunkX, chunkZ);
  });
  
  this.chunks.clear();
  if (this._heightCache) {
    this._heightCache.clear();
  }
  this.tiles = [];
};




let tilect = 33; // menu screen
tilect = 64; // 1/4 zone
// tilect = 128; // half zone
// tilect = 256; // full zone
let liveField = new Field({width: tilect, height: tilect, seed: 0});

// Set random time of day for this field (0 = midnight, 0.5 = noon, 1 = midnight)
// Bias toward daytime hours (0.2 to 0.8) for better visibility
// timeOfDay is now set by lighting system using field seed for determinism
// liveField.timeOfDay = 0.2 + (Math.random() * 0.6);

// Make liveField and Field constructor available globally
window.liveField = liveField;
window.Field = Field;







