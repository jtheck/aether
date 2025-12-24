// Generate a sample house map for testing
// Run with: node scripts/generate-map.js

const fs = require('fs');
const path = require('path');

function generateArenaMap() {
  const width = 64;
  const height = 64;
  const chunkSize = 16;
  const seed = 42069;
  
  // Initialize terrain (0 = grass, 1 = water, 2 = dirt)
  const terrainTypes = new Array(width * height).fill(0);
  
  // Create circular arena shape in terrain
  const centerX = width / 2;
  const centerZ = height / 2;
  const arenaRadius = 28;
  
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dz = z - centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const index = z * width + x;
      
      if (dist > arenaRadius) {
        // Outside arena - water
        terrainTypes[index] = 1;
      } else if (dist > arenaRadius - 3) {
        // Edge ring - dirt
        terrainTypes[index] = 2;
      } else {
        // Inner arena - grass with some dirt paths
        const angle = Math.atan2(dz, dx);
        // Create 4 dirt paths leading to center
        const pathAngle = ((angle + Math.PI) / (Math.PI / 2)) % 1;
        if (pathAngle < 0.1 || pathAngle > 0.9) {
          terrainTypes[index] = 2; // Dirt path
        } else {
          terrainTypes[index] = 0; // Grass
        }
      }
      
      // Add some water pools
      if (dist < 5) {
        terrainTypes[index] = 1; // Center pool
      }
    }
  }
  
  // RLE encode terrain
  function encodeRLE(arr) {
    const runs = [];
    let current = arr[0];
    let count = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === current && count < 255) {
        count++;
      } else {
        runs.push(`${current}:${count}`);
        current = arr[i];
        count = 1;
      }
    }
    runs.push(`${current}:${count}`);
    return runs.join(',');
  }
  
  // Generate chunk mask (all enabled for circular map)
  const chunksX = Math.ceil(width / chunkSize);
  const chunksZ = Math.ceil(height / chunkSize);
  const chunkBits = [];
  
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      // Check if chunk center is within arena
      const chunkCenterX = (cx + 0.5) * chunkSize;
      const chunkCenterZ = (cz + 0.5) * chunkSize;
      const dx = chunkCenterX - centerX;
      const dz = chunkCenterZ - centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      // Enable chunk if it's mostly within the arena
      chunkBits.push(dist < arenaRadius + chunkSize ? 1 : 0);
    }
  }
  
  // Generate tile atlas (simplified - all grass-dirt)
  const tiles = [];
  for (let i = 0; i < width * height; i++) {
    tiles.push('gd12'); // Default tile
  }
  
  // Spawn points - 4 corners of the arena
  const spawnPoints = [
    { x: Math.floor(centerX - 15), y: Math.floor(centerZ - 15) },
    { x: Math.floor(centerX + 15), y: Math.floor(centerZ - 15) },
    { x: Math.floor(centerX + 15), y: Math.floor(centerZ + 15) },
    { x: Math.floor(centerX - 15), y: Math.floor(centerZ + 15) }
  ];
  
  // Generate thumbnail as base64 BMP
  function generateThumbnail() {
    const size = 64;
    
    const colors = {
      0: [74, 124, 89],    // Grass green
      1: [45, 74, 111],    // Water blue  
      2: [139, 115, 85]    // Dirt brown
    };
    
    // BMP file format (uncompressed 24-bit)
    const rowSize = Math.ceil(size * 3 / 4) * 4; // Rows must be multiple of 4 bytes
    const pixelDataSize = rowSize * size;
    const fileSize = 54 + pixelDataSize; // Header (54 bytes) + pixel data
    
    const buffer = Buffer.alloc(fileSize);
    
    // BMP Header (14 bytes)
    buffer.write('BM', 0);                    // Signature
    buffer.writeUInt32LE(fileSize, 2);        // File size
    buffer.writeUInt32LE(0, 6);               // Reserved
    buffer.writeUInt32LE(54, 10);             // Pixel data offset
    
    // DIB Header (40 bytes)
    buffer.writeUInt32LE(40, 14);             // DIB header size
    buffer.writeInt32LE(size, 18);            // Width
    buffer.writeInt32LE(size, 22);            // Height (positive = bottom-up)
    buffer.writeUInt16LE(1, 26);              // Color planes
    buffer.writeUInt16LE(24, 28);             // Bits per pixel
    buffer.writeUInt32LE(0, 30);              // Compression (none)
    buffer.writeUInt32LE(pixelDataSize, 34);  // Image size
    buffer.writeInt32LE(2835, 38);            // X pixels per meter
    buffer.writeInt32LE(2835, 42);            // Y pixels per meter
    buffer.writeUInt32LE(0, 46);              // Colors in color table
    buffer.writeUInt32LE(0, 50);              // Important colors
    
    // Pixel data (bottom-up, BGR format)
    for (let y = 0; y < size; y++) {
      const rowOffset = 54 + (size - 1 - y) * rowSize; // Bottom-up
      for (let x = 0; x < size; x++) {
        const mapX = Math.floor(x * width / size);
        const mapZ = Math.floor(y * height / size);
        const index = mapZ * width + mapX;
        const terrain = terrainTypes[index];
        const color = colors[terrain] || colors[0];
        
        const pixelOffset = rowOffset + x * 3;
        buffer[pixelOffset] = color[2];     // Blue
        buffer[pixelOffset + 1] = color[1]; // Green
        buffer[pixelOffset + 2] = color[0]; // Red
      }
    }
    
    // Add spawn point markers (yellow dots)
    spawnPoints.forEach(sp => {
      const px = Math.floor(sp.x * size / width);
      const py = Math.floor(sp.y * size / height);
      
      // Draw a 3x3 yellow dot
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx;
          const y = py + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            const rowOffset = 54 + (size - 1 - y) * rowSize;
            const pixelOffset = rowOffset + x * 3;
            buffer[pixelOffset] = 0;       // Blue
            buffer[pixelOffset + 1] = 204; // Green
            buffer[pixelOffset + 2] = 255; // Red (yellow = red + green)
          }
        }
      }
    });
    
    return buffer.toString('base64');
  }
  
  const mapData = {
    v: 2,
    n: "The Arena",
    w: width,
    h: height,
    s: seed,
    cs: chunkSize,
    t: encodeRLE(terrainTypes),
    cm: chunkBits.join(''),
    ta: tiles.join(','),
    th: generateThumbnail(),
    sp: spawnPoints.map(s => `${s.x},${s.y}`).join(';'),
    gt: '1v1,2v2,ffa'
  };
  
  return mapData;
}

function generateIslandMap() {
  const width = 48;
  const height = 48;
  const chunkSize = 16;
  const seed = 12345;
  
  const terrainTypes = new Array(width * height).fill(1); // Start with water
  const centerX = width / 2;
  const centerZ = height / 2;
  
  // Create main island
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dz = z - centerZ;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const index = z * width + x;
      
      // Island shape with noise
      const noiseVal = Math.sin(x * 0.3) * Math.cos(z * 0.3) * 3;
      const islandRadius = 18 + noiseVal;
      
      if (dist < islandRadius - 2) {
        terrainTypes[index] = 0; // Grass
      } else if (dist < islandRadius) {
        terrainTypes[index] = 2; // Beach/dirt
      }
    }
  }
  
  function encodeRLE(arr) {
    const runs = [];
    let current = arr[0];
    let count = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === current && count < 255) {
        count++;
      } else {
        runs.push(`${current}:${count}`);
        current = arr[i];
        count = 1;
      }
    }
    runs.push(`${current}:${count}`);
    return runs.join(',');
  }
  
  const chunksX = Math.ceil(width / chunkSize);
  const chunksZ = Math.ceil(height / chunkSize);
  const chunkBits = new Array(chunksX * chunksZ).fill(1).join('');
  
  const tiles = new Array(width * height).fill('gd12').join(',');
  
  const spawnPoints = [
    { x: Math.floor(centerX - 8), y: Math.floor(centerZ) },
    { x: Math.floor(centerX + 8), y: Math.floor(centerZ) }
  ];
  
  // Generate thumbnail
  function generateThumbnail() {
    const size = 64;
    const colors = {
      0: [74, 124, 89],    // Grass
      1: [45, 74, 111],    // Water
      2: [139, 115, 85]    // Dirt
    };
    
    const rowSize = Math.ceil(size * 3 / 4) * 4;
    const pixelDataSize = rowSize * size;
    const fileSize = 54 + pixelDataSize;
    const buffer = Buffer.alloc(fileSize);
    
    buffer.write('BM', 0);
    buffer.writeUInt32LE(fileSize, 2);
    buffer.writeUInt32LE(0, 6);
    buffer.writeUInt32LE(54, 10);
    buffer.writeUInt32LE(40, 14);
    buffer.writeInt32LE(size, 18);
    buffer.writeInt32LE(size, 22);
    buffer.writeUInt16LE(1, 26);
    buffer.writeUInt16LE(24, 28);
    buffer.writeUInt32LE(0, 30);
    buffer.writeUInt32LE(pixelDataSize, 34);
    buffer.writeInt32LE(2835, 38);
    buffer.writeInt32LE(2835, 42);
    buffer.writeUInt32LE(0, 46);
    buffer.writeUInt32LE(0, 50);
    
    for (let y = 0; y < size; y++) {
      const rowOffset = 54 + (size - 1 - y) * rowSize;
      for (let x = 0; x < size; x++) {
        const mapX = Math.floor(x * width / size);
        const mapZ = Math.floor(y * height / size);
        const index = mapZ * width + mapX;
        const terrain = terrainTypes[index];
        const color = colors[terrain] || colors[0];
        const pixelOffset = rowOffset + x * 3;
        buffer[pixelOffset] = color[2];
        buffer[pixelOffset + 1] = color[1];
        buffer[pixelOffset + 2] = color[0];
      }
    }
    
    spawnPoints.forEach(sp => {
      const px = Math.floor(sp.x * size / width);
      const py = Math.floor(sp.y * size / height);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx, y = py + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) {
            const rowOffset = 54 + (size - 1 - y) * rowSize;
            const pixelOffset = rowOffset + x * 3;
            buffer[pixelOffset] = 0;
            buffer[pixelOffset + 1] = 204;
            buffer[pixelOffset + 2] = 255;
          }
        }
      }
    });
    
    return buffer.toString('base64');
  }
  
  return {
    v: 2,
    n: "Paradise Island",
    w: width,
    h: height,
    s: seed,
    cs: chunkSize,
    t: encodeRLE(terrainTypes),
    cm: chunkBits,
    ta: tiles,
    th: generateThumbnail(),
    sp: spawnPoints.map(s => `${s.x},${s.y}`).join(';'),
    gt: '1v1'
  };
}

// Generate maps
const arena = generateArenaMap();
const island = generateIslandMap();

// Save to maps folder
const mapsDir = path.join(__dirname, '..', 'maps');

fs.writeFileSync(
  path.join(mapsDir, 'arena.garden'),
  JSON.stringify(arena)
);
console.log('✅ Created arena.garden');

fs.writeFileSync(
  path.join(mapsDir, 'island.garden'),
  JSON.stringify(island)
);
console.log('✅ Created island.garden');

// Update index.json with thumbnails from map data
const index = {
  maps: [
    {
      name: "The Arena",
      file: "arena.garden",
      width: 64,
      height: 64,
      players: "2-4",
      author: "Opus",
      description: "A classic circular arena with four entry paths. Fight for control of the sacred pool!",
      lore: "Long ago, the gods carved this arena from the living earth, a place where mortals could prove their worth. The central pool is said to grant visions to those who control it.",
      thumbnail: arena.th
    },
    {
      name: "Paradise Island", 
      file: "island.garden",
      width: 48,
      height: 48,
      players: "2",
      author: "Opus",
      description: "A lush island paradise surrounded by endless ocean. Two factions vie for dominance.",
      lore: "Discovered by explorers seeking the edge of the world, this island became a battleground when both expeditions claimed it as their own. The beaches still bear the scars of their first encounter.",
      thumbnail: island.th
    }
  ]
};

fs.writeFileSync(
  path.join(mapsDir, 'index.json'),
  JSON.stringify(index, null, 2)
);
console.log('✅ Updated maps/index.json');

console.log('\n🗺️ House maps created!');

