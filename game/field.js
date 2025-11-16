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
  
  // Calculate atlas coordinates (4x4 grid)
  // Row 0 should be at the bottom (0,0) - fix the UV mapping
  this.atlasRow = Math.floor(this.type / 4); // Row 0 = bottom, Row 3 = top
  this.atlasCol = this.type % 4;             // Col 0 = left, Col 3 = right

  // this.mesh = BABYLON.MeshBuilder.CreateBox("tile", {size: tileSize}, gfx.scene);
  // this.mesh.position.x = this.loc.x * tileSize;
  // this.mesh.position.z = this.loc.y * tileSize;
}

// Method to update atlas coordinates when tile type changes
Tile.prototype.updateAtlasCoordinates = function() {
  // Don't overwrite atlasName - it's set by the terrain system
  // (could be 'atlas-grass' or 'atlas-water')
  
  // Calculate atlas coordinates (4x4 grid)
  // Row 0 should be at the bottom (0,0) - fix the UV mapping
  this.atlasRow = Math.floor(this.type / 4); // Row 0 = bottom, Row 3 = top
  this.atlasCol = this.type % 4;             // Col 0 = left, Col 3 = right
};







function Field(ops = {}) {
  this.width = ops.width ? ops.width : 10;
  this.height = ops.height ? ops.height : 10;
  this.tiles = [];
  this.seed = ops.seed || Math.floor(Math.random() * 1000000);
  
  // Elevation-based terrain system
  this.heightMap = [];     // Continuous elevation values (0.0 to 1.0)
  this.terrainTypes = [];  // Terrain type per tile: 0=deep, 1=water, 2=grass, 3=dirt, 4=mountains
  
  // Instance properties for chunk management
  this.chunks = new Map();
  this.chunkSize = 16;
  this._heightCache = new Map();
  
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
  for(let x = 0; x < this.width; x++){
    for(let y = 0; y < this.height; y++){
      this.tiles.push(new Tile({loc: {x, y}, type: 12})); // Placeholder
      this.heightMap.push(0); // Will be filled by height generation
      this.terrainTypes.push(2); // Default to grass (type 2)
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
  
  // Debug - show terrain distribution
  const deepCount = this.terrainTypes.filter(t => t === 0).length;
  const waterCount = this.terrainTypes.filter(t => t === 1).length;
  const grassCount = this.terrainTypes.filter(t => t === 2).length;
  const dirtCount = this.terrainTypes.filter(t => t === 3).length;
  const mountainCount = this.terrainTypes.filter(t => t === 4).length;
  console.log(`🌊 Deep: ${deepCount} (${(deepCount/this.tiles.length*100).toFixed(1)}%), 💧 Water: ${waterCount} (${(waterCount/this.tiles.length*100).toFixed(1)}%), 🌿 Grass: ${grassCount} (${(grassCount/this.tiles.length*100).toFixed(1)}%), 🟫 Dirt: ${dirtCount} (${(dirtCount/this.tiles.length*100).toFixed(1)}%), 🏔️ Mountains: ${mountainCount} (${(mountainCount/this.tiles.length*100).toFixed(1)}%)`);
  
  // DEBUG: Check water tile variants
  const waterTiles = this.tiles.filter(t => t.atlasName === 'atlas-water');
  const waterVariants = {};
  waterTiles.forEach(t => {
    waterVariants[t.type] = (waterVariants[t.type] || 0) + 1;
  });
  console.log('💧 Water tile variants:', waterVariants);
}

// Generate height map with radial falloff (low at edges, high in center)
Field.prototype.generateHeightMap = function() {
  const centerX = this.width / 2;
  const centerY = this.height / 2;
  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
  
  // Check if this is KOTH mode
  const isKOTH = window.currentMatch?.gameType === 'koth';
  
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  
  for(let y = 0; y < this.height; y++) {
    for(let x = 0; x < this.width; x++) {
      const index = y * this.width + x;
      
      // Calculate distance from center (normalized 0-1)
      const dx = x - centerX;
      const dy = y - centerY;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy) / maxDistance;
      
      // Radial falloff - higher in center, lower at edges
      // Use smooth falloff curve
      const radialHeight = 1.0 - Math.pow(distFromCenter, 1.5);
      
      // Add noise for variation
      const noiseValue = fractalNoise(x, y, this.seed, 4, 0.5, 0.05);
      const noise = (noiseValue + 1) / 2; // 0-1 range
      
      // Combine radial and noise (radial is dominant)
      let finalHeight;
      if(isKOTH) {
        // KOTH: Strong central peak for the hill to fight over
        finalHeight = radialHeight * 0.8 + noise * 0.2;
      } else {
        // Other modes: Gentler radial with more noise variation
        finalHeight = radialHeight * 0.6 + noise * 0.4;
      }
      
      this.heightMap[index] = finalHeight;
      minHeight = Math.min(minHeight, finalHeight);
      maxHeight = Math.max(maxHeight, finalHeight);
    }
  }
  
  console.log(`📊 Height map range BEFORE normalization: ${minHeight.toFixed(3)} to ${maxHeight.toFixed(3)} ${isKOTH ? '(KOTH mode - central peak)' : ''}`);
  
  // CRITICAL: Renormalize to full 0-1 range so we get all terrain types
  for(let i = 0; i < this.heightMap.length; i++) {
    this.heightMap[i] = (this.heightMap[i] - minHeight) / (maxHeight - minHeight);
  }
  
  console.log(`📊 Height map AFTER normalization: 0.000 to 1.000`);
}

// Assign terrain types based on elevation thresholds
Field.prototype.assignTerrainByElevation = function() {
  for(let i = 0; i < this.heightMap.length; i++) {
    const height = this.heightMap[i];
    
    // TEMPORARY: 3-tier system until we have atlas-deep.png and atlas-rock.png
    // Full 5-tier when atlases ready:
    // if(height < 0.05) this.terrainTypes[i] = 0; // Deep ocean
    if(height < 0.25) {
      this.terrainTypes[i] = 1; // Shallow water (edges)
    } else if(height < 0.65) {
      this.terrainTypes[i] = 2; // Grass (middle)
    } else {
      this.terrainTypes[i] = 3; // Dirt (center peaks)
    }
    // Mountains (type 4) disabled until atlas-rock.png ready
  }
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
  // Create density maps for each terrain boundary
  // Each pair of adjacent terrains needs its own Wang tile evaluation
  
  for(let x = 0; x < this.width; x++) {
    for(let y = 0; y < this.height; y++) {
      const tile = this.tiles[y * this.width + x];
      const index = y * this.width + x;
      const terrain = this.terrainTypes[index];
      
      // Determine which transition this tile is part of and which atlas to use
      if(terrain === 0) {
        // Deep ocean - transition with shallow water (type 1)
        const densityMap = this.terrainTypes.map(t => t >= 1 ? 1 : 0); // 1 = water/higher
        const tileCase = this.calculateCompatibleVariant(x, y, densityMap);
        tile.type = tileCase;
        tile.atlasName = 'atlas-water'; // PLACEHOLDER: should be atlas-deep
      } else if(terrain === 1) {
        // Shallow water - transition with grass (type 2)
        const densityMap = this.terrainTypes.map(t => t >= 2 ? 1 : 0); // 1 = grass/higher
        const tileCase = this.calculateCompatibleVariant(x, y, densityMap);
        tile.type = tileCase;
        tile.atlasName = 'atlas-water'; // Correct!
      } else if(terrain === 2) {
        // Grass - transition with dirt (type 3)
        const densityMap = this.terrainTypes.map(t => t >= 3 ? 1 : 0); // 1 = dirt/higher
        const tileCase = this.calculateCompatibleVariant(x, y, densityMap);
        tile.type = tileCase;
        tile.atlasName = 'atlas-grass'; // Correct!
      } else if(terrain === 3) {
        // Dirt - transition with mountains (type 4)
        const densityMap = this.terrainTypes.map(t => t >= 4 ? 1 : 0); // 1 = mountains
        const tileCase = this.calculateCompatibleVariant(x, y, densityMap);
        tile.type = tileCase;
        tile.atlasName = 'atlas-grass'; // PLACEHOLDER: should be atlas-rock
      } else {
        // Mountains (type 4) - pure mountains
        tile.type = 6; // Full fill
        tile.atlasName = 'atlas-grass'; // PLACEHOLDER: should be atlas-rock
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
  
  // Evaluate the 4 corners
  const x0y0 = this.getCornerValue(x, y, mapToUse);      // bottom-left
  const x0y1 = this.getCornerValue(x, y + 1, mapToUse);  // top-left  
  const x1y0 = this.getCornerValue(x + 1, y, mapToUse);  // bottom-right
  const x1y1 = this.getCornerValue(x + 1, y + 1, mapToUse); // top-right
  
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

// Get the corner value for a specific corner position from a density map
Field.prototype.getCornerValue = function(x, y, densityMap) {
  const mapToUse = densityMap || this.grassMap;
  if(x >= 0 && x < this.width && y >= 0 && y < this.height) {
    const density = mapToUse[y * this.width + x];
    return density; // 1 = filled, 0 = empty
  }
  return 0; // Outside bounds = empty
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
  console.log('🔍 Marching Squares Case Distribution:');
  
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
  console.table({
    'Case 0 (empty)': { tile: caseToTile[0], count: caseCounts[0] || 0, corners: '----' },
    'Case 1 (BL)': { tile: caseToTile[1], count: caseCounts[1] || 0, corners: 'BL--' },
    'Case 2 (TL)': { tile: caseToTile[2], count: caseCounts[2] || 0, corners: '-TL-' },
    'Case 3 (BL+TL left)': { tile: caseToTile[3], count: caseCounts[3] || 0, corners: 'BL,TL' },
    'Case 4 (BR)': { tile: caseToTile[4], count: caseCounts[4] || 0, corners: '--BR' },
    'Case 5 (BL+BR bottom)': { tile: caseToTile[5], count: caseCounts[5] || 0, corners: 'BL,BR' },
    'Case 6 (TL+BR diag)': { tile: caseToTile[6], count: caseCounts[6] || 0, corners: 'TL,BR' },
    'Case 7 (3 corners)': { tile: caseToTile[7], count: caseCounts[7] || 0, corners: 'BL,TL,BR' },
    'Case 8 (TR)': { tile: caseToTile[8], count: caseCounts[8] || 0, corners: '---TR' },
    'Case 9 (BL+TR diag)': { tile: caseToTile[9], count: caseCounts[9] || 0, corners: 'BL,TR' },
    'Case 10 (TL+TR top)': { tile: caseToTile[10], count: caseCounts[10] || 0, corners: 'TL,TR' },
    'Case 11 (3 corners)': { tile: caseToTile[11], count: caseCounts[11] || 0, corners: 'BL,TL,TR' },
    'Case 12 (BR+TR right)': { tile: caseToTile[12], count: caseCounts[12] || 0, corners: 'BR,TR' },
    'Case 13 (3 corners)': { tile: caseToTile[13], count: caseCounts[13] || 0, corners: 'BL,BR,TR' },
    'Case 14 (3 corners)': { tile: caseToTile[14], count: caseCounts[14] || 0, corners: 'TL,BR,TR' },
    'Case 15 (all)': { tile: caseToTile[15], count: caseCounts[15] || 0, corners: 'ALL' }
  });
  
  console.log('\n📊 Summary:');
  console.log(`Total tiles: ${this.width * this.height}`);
  console.log(`Unique cases found: ${Object.keys(caseCounts).length}`);
}

// Method to get a tile at specific coordinates
Field.prototype.getTile = function(x, y) {
  if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
    return this.tiles[y * this.width + x];
  }
  return null;
}

  // Method to get height variation for terrain (based on elevation/terrain type)
  Field.prototype.getHeightVariation = function(x, y, amplitude = null) {
    // Get terrain type at this position
    if(x >= 0 && x < this.width && y >= 0 && y < this.height) {
      const index = Math.floor(y) * this.width + Math.floor(x);
      const terrain = this.terrainTypes[index];
      
      // Base Y-offset by terrain type (elevation continuum)
      const terrainHeights = {
        0: -1.2,  // Deep ocean (lowest - well below table)
        1: -0.8,  // Shallow water (below table to prevent z-fighting)
        2: 0.0,   // Grass (sea level)
        3: 0.4,   // Dirt (elevated)
        4: 0.9    // Mountains (highest)
      };
      
      const baseHeight = terrainHeights[terrain] || 0;
      
      // Add small noise variation on top
      const noiseVariation = this.getNoiseVariation(x, y) * 0.1;
      
      return baseHeight + noiseVariation;
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
    let frequency = 1;
    let amplitude_octave = 1;
    let maxValue = 0;
    
    // 3 octaves for natural variation
    for (let i = 0; i < 3; i++) {
      let hash = this.seed + i * 1000;
      hash = ((hash << 13) ^ hash) >>> 0;
      hash = ((hash * (hash * hash * 15731 + 789221) + 1376312589) & 0xfffffff) >>> 0;
      
      // Mix in coordinates with frequency - more variation on X axis, less on Z
      hash = ((hash << 13) ^ (hash + Math.floor(x * frequency) * 19349663)) >>> 0;
      hash = ((hash << 13) ^ (hash + Math.floor(y * frequency) * 73856093)) >>> 0;
      
      const noiseValue = Math.sin(hash * 0.5) + Math.sin(hash * 0.1) * 0.5 + Math.sin(hash * 0.01) * 0.25;

      total += noiseValue * amplitude_octave;
      maxValue += amplitude_octave;
      
      frequency *= 2;
      amplitude_octave *= 0.5;
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
let liveField = new Field({width: tilect, height: tilect, seed: 52});

// Set random time of day for this field (0 = midnight, 0.5 = noon, 1 = midnight)
// Bias toward daytime hours (0.2 to 0.8) for better visibility
// timeOfDay is now set by lighting system using field seed for determinism
// liveField.timeOfDay = 0.2 + (Math.random() * 0.6);

// Make liveField and Field constructor available globally
window.liveField = liveField;
window.Field = Field;







