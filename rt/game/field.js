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

  // Since we're only using grass tiles (0-15), directly map to atlas coordinates
  this.atlasName = 'atlas-grass';
  
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
  // Since we're only using grass tiles (0-15), directly map to atlas coordinates
  this.atlasName = 'atlas-grass';
  
  // Calculate atlas coordinates (4x4 grid)
  // Row 0 should be at the bottom (0,0) - fix the UV mapping
  this.atlasRow = Math.floor(this.type / 4); // Row 0 = bottom, Row 3 = top
  this.atlasCol = this.type % 4;             // Col 0 = left, Col 3 = right
};







function Field(ops = {}) {
  this.width = ops.width ? ops.width : 10;
  this.height = ops.height ? ops.height : 10;
  this.tiles = [];
  this.seed = ops.seed || Math.random() * 1000000;
  
  // Initialize random number generator with seed
  // this.rng = this.seededRandom(this.seed);
  
  // Define only the tile types that actually exist in your constants
  // let validTypes = [0, 1, 2, 4, 5, 6, 8, 9, 10, 20, 21, 22, 24, 25, 26, 28, 29, 30];
  let validTypes = [5];//, 25, 45, 65, 85, 12, 32, 52, 72, 82];

  // First pass: make all tiles grass (type 5) for a uniform starting field
  for(let x = 0; x < this.width; x++){
    for(let y = 0; y < this.height; y++){
      this.tiles.push(new Tile({loc: {x, y}, type: 5})); // All grass tiles
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
  // Brush-based marching squares: paint with grass brush and fix adjacent tiles

  // console.log("=== STARTING MARCHING CUBES PROOF ===");
  
  // Step 1: Paint some random grass patches (like drawing with a brush)
  this.paintGrassPatches();
  
  // Step 2: Fix all adjacent tiles to be compatible (like the brush affecting surroundings)
  this.fixAdjacentTiles();
  
  // Step 3: Expand the painting to create organic patterns
  this.expandPainting();
  
  // console.log("=== MARCHING CUBES PROOF COMPLETE ===");
  // console.log("Brush-based marching squares complete - organic grass terrain painted!");
}

// Step 1: Paint random grass patches (like using a brush)
Field.prototype.paintGrassPatches = function() {
    const numPatches = Math.floor(this.width * this.height / 30); // Fewer, bigger patches
  
  // First: paint some random organic patches - much bigger and more organic
  for(let i = 0; i < numPatches; i++) {
    // Pick random center point
    const centerX = Math.floor(Math.random() * this.width);
    const centerY = Math.floor(Math.random() * this.height);
    const patchSize = 15 + Math.floor(Math.random() * 25); // 15-40 tiles radius for big blobs
    
    // Paint the patch with grass (like drawing with a brush)
    for(let x = Math.max(0, centerX - patchSize); x <= Math.min(this.width - 1, centerX + patchSize); x++) {
      for(let y = Math.max(0, centerY - patchSize); y <= Math.min(this.height - 1, centerY + patchSize); y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if(distance <= patchSize) {
          // Paint this tile with grass - use highest numbers for completely solid areas
          const tile = this.tiles[y * this.width + x];
          const grassVariant = 12 + Math.floor(Math.random() * 4); // 12-15 for most solid grass
          tile.type = grassVariant;
          tile.updateAtlasCoordinates();
        }
      }
    }
  }
  
  // Add some medium-sized organic patches for variety
  const numMediumPatches = Math.floor(this.width * this.height / 100);
  for(let i = 0; i < numMediumPatches; i++) {
    const centerX = Math.floor(Math.random() * this.width);
    const centerY = Math.floor(Math.random() * this.height);
    const patchSize = 8 + Math.floor(Math.random() * 12); // 8-20 tiles radius
    
    for(let x = Math.max(0, centerX - patchSize); x <= Math.min(this.width - 1, centerX + patchSize); x++) {
      for(let y = Math.max(0, centerY - patchSize); y <= Math.min(this.height - 1, centerY + patchSize); y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if(distance <= patchSize) {
          const tile = this.tiles[y * this.width + x];
          const grassVariant = 12 + Math.floor(Math.random() * 4); // 12-15 for most solid grass
          tile.type = grassVariant;
          tile.updateAtlasCoordinates();
        }
      }
    }
  }
}

// Step 2: Fix all adjacent tiles to be compatible (brush affecting surroundings)
Field.prototype.fixAdjacentTiles = function() {
  // console.log("=== FIXING ADJACENT TILES WITH MARCHING CUBES ===");
  
  // Go through every tile and fix its adjacent tiles
  for(let x = 0; x < this.width; x++) {
    for(let y = 0; y < this.height; y++) {
      const tile = this.tiles[y * this.width + x];
      
      // Calculate what this tile should be based on its surroundings
      const tileVariant = this.calculateCompatibleVariant(x, y);
      
      // Update tile to be compatible (grass only, so 0-15)
      tile.type = tileVariant;
      tile.updateAtlasCoordinates();
    }
  }
  
  // console.log("=== ADJACENT TILES FIXED ===");
}

// Step 3: Expand the painting to create organic patterns
Field.prototype.expandPainting = function() {
  // Apply the brush effect again to smooth out the patterns
  this.fixAdjacentTiles();
  
  // Add some final brush strokes for organic feel
  for(let i = 0; i < this.width * this.height / 8; i++) {
    const x = Math.floor(Math.random() * this.width);
    const y = Math.floor(Math.random() * this.height);
    
    // Randomly paint a small grass patch
    const patchSize = 1 + Math.floor(Math.random() * 2); // Small patches
    
    for(let px = Math.max(0, x - patchSize); px <= Math.min(this.width - 1, x + patchSize); px++) {
      for(let py = Math.max(0, y - patchSize); py <= Math.min(this.height - 1, y + patchSize); py++) {
        const distance = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
        if(distance <= patchSize) {
          const tile = this.tiles[py * this.width + px];
          const grassVariant = Math.floor(Math.random() * 16); // 0-15
          tile.type = grassVariant;
          tile.updateAtlasCoordinates();
        }
      }
    }
    
    // Fix adjacent tiles after painting (brush affecting surroundings)
    this.fixAdjacentTiles();
  }
}

// Calculate compatible tile variant based on proper marching squares logic
Field.prototype.calculateCompatibleVariant = function(x, y) {
  // Use proper marching squares logic - evaluate the 4 corners of this cell
  // This matches the Python reference exactly
  
  // Evaluate the 4 corners (like the Python code)
  const x0y0 = this.getCornerValue(x, y);      // bottom-left
  const x0y1 = this.getCornerValue(x, y + 1);  // top-left  
  const x1y0 = this.getCornerValue(x + 1, y);  // bottom-right
  const x1y1 = this.getCornerValue(x + 1, y + 1); // top-right
  
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

// Get the corner value for a specific corner position
Field.prototype.getCornerValue = function(x, y) {
  // For grass tiles, we'll use the tile type as the "density" value
  // Higher tile numbers = more "solid" grass, lower = less solid
  if(x >= 0 && x < this.width && y >= 0 && y < this.height) {
    const tile = this.tiles[y * this.width + x];
    
    // Convert tile type to density: higher numbers = more solid
    return (tile.type - 7.5) * 2; // Double the separation from threshold for cleaner transitions
  }
  return -1; // Outside bounds = empty
}

// Map marching cubes case to tile variant based on the Python reference
Field.prototype.mapMarchingCaseToTile = function(case_num) {
  // Atlas tile to marching squares case mapping
  // Each case should map to exactly one atlas tile

  // Original bitmask mapping - each case maps to the tile that fits that connection pattern
  const caseToAtlasTile = {
    0: 0,   // Case 0 (all corners empty) → Atlas tile 0
    1: 12,  // Case 1 (bottom-left only) → Atlas tile 12
    2: 3,   // Case 2 (top-left only) → Atlas tile 3
    3: 7,   // Case 3 (bottom-left + top-left) → Atlas tile 7
    4: 1,   // Case 4 (bottom-right only) → Atlas tile 1
    5: 15,  // Case 5 (bottom-left + bottom-right) → Atlas tile 15
    6: 8,   // Case 6 (top-left + bottom-right) → Atlas tile 8
    7: 14,  // Case 7 (three corners) → Atlas tile 14
    8: 4,   // Case 8 (top-right only) → Atlas tile 4
    9: 2,   // Case 9 (three corners) → Atlas tile 2
    10: 5,  // Case 10 (top-left + top-right) → Atlas tile 5
    11: 11, // Case 11 (three corners) → Atlas tile 11
    12: 13, // Case 12 (bottom-right + top-right) → Atlas tile 13
    13: 9,  // Case 13 (three corners) → Atlas tile 9
    14: 6,  // Case 14 (three corners) → Atlas tile 6
    15: 10  // Case 15 (all corners filled) → Atlas tile 10
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

  // Method to get height variation for terrain
  Field.prototype.getHeightVariation = function(x, y, amplitude = .11) {
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
      
      // const noiseValue = (hash / 0x7fffffff) * 2 - 1;
      // Landscape noise: base(0.05) + medium(0.03) + fine(0.07) detail
      // Lower values = more spread out terrain, Higher values = more compressed
      // 0.05 = large features, 0.03 = medium features, 0.07 = fine details
      // const noiseValue = Math.sin(hash * 0.05) + Math.sin(hash * 0.03) * 0.5 + Math.sin(hash * 0.07) * 0.25;
      // const noiseValue = Math.sin(hash * 0.1) + Math.sin(hash * 0.06) * 0.5 + Math.sin(hash * 0.14) * 0.25;
      const noiseValue = Math.sin(hash * 0.5) + Math.sin(hash * 0.1) * 0.5 + Math.sin(hash * 0.01) * 0.25;

      total += noiseValue * amplitude_octave;
      maxValue += amplitude_octave;
      
      frequency *= 2;
      amplitude_octave *= 0.5;
    }
    
    const finalNoise = total / maxValue;
    return finalNoise * amplitude;
  }










// Add chunk management to Field class
Field.prototype.chunks = new Map(); // Store chunk data + meshes
Field.prototype.chunkSize = 13; // 32x32 tiles per chunk for larger visible areas

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

Field.prototype.updateVisibleChunks = function(playerX, playerZ, loadDistance = 4) {
  const playerChunkX = Math.floor(playerX / (this.chunkSize * TILE_SIZE)); // Use TILE_SIZE constant
  const playerChunkZ = Math.floor(playerZ / (this.chunkSize * TILE_SIZE)); // Use TILE_SIZE constant
  
  let chunksLoaded = 0;
  let chunksUnloaded = 0;
  
  // Load chunks within circular radius (more efficient than square)
  for (let x = playerChunkX - loadDistance; x <= playerChunkX + loadDistance; x++) {
    for (let z = playerChunkZ - loadDistance; z <= playerChunkZ + loadDistance; z++) {
      // Check if chunk is within circular radius
      const dx = x - playerChunkX;
      const dz = z - playerChunkZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance <= loadDistance && x >= 0 && z >= 0 && 
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
  
  // Unload chunks outside circular radius
  for (const [key, chunk] of this.chunks) {
    const [chunkX, chunkZ] = key.split(',').map(Number);
    const dx = chunkX - playerChunkX;
    const dz = chunkZ - playerChunkZ;
    const distance = Math.sqrt(dx * dx + dz * dz);
    
    if (distance > loadDistance) {
      this.unloadChunk(chunkX, chunkZ);
      chunksUnloaded++;
    }
  }
  
  // Debug info (only log when something changes)
  if (chunksLoaded > 0 || chunksUnloaded > 0) {
    // Chunk loading/unloading activity
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




let tilect = 33; // menu screen
// tilect = 128; // half zone
// tilect = 256; // full zone
let liveField = new Field({width: tilect, height: tilect, seed: 52});

// Set random time of day for this field (0 = midnight, 0.5 = noon, 1 = midnight)
// Bias toward daytime hours (0.2 to 0.8) for better visibility
liveField.timeOfDay = 0.2 + (Math.random() * 0.6);

// Make liveField available globally for other systems
window.liveField = liveField;







