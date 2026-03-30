// Building system for structures like agora, houses, towers, etc.

// Ground offset for building positioning - adjust if buildings float or clip through terrain
// Negative values sink buildings down, positive values lift them up
// With correct triangular interpolation, this should be 0 or very small
const BUILDING_GROUND_OFFSET = 0;

// Add particle effects to buildings based on their type
function addBuildingParticleEffects(building) {
  // console.log(`🔥 addBuildingParticleEffects called for ${building.name}`);
  
  if (!window.fx || !building.mesh) {
    // console.log(`❌ Missing dependencies - fx: ${!!window.fx}, mesh: ${!!building.mesh}`);
    return;
  }
  
  // Add particle effects based on building type
  switch (building.name.toLowerCase()) {
    case 'camp':
      // Add small campfire effect
      window.fx.attachParticleEffect(building, 'fire', 'fire_anchor', {
        scale: 0.3, // Small campfire
        emitRate: 15,
        minSize: 0.5,
        maxSize: 1.0
      });
      break;
      
    case 'village':
      // Add moderate smoke effect
      window.fx.attachParticleEffect(building, 'smoke', 'smoke_anchor', {
        scale: 0.5, // Moderate village smoke
        emitRate: 20,
        minSize: 1.0,
        maxSize: 2.0
      });
      break;
      
    case 'farm':
      // Add subtle smoke effect
      window.fx.attachParticleEffect(building, 'smoke', 'smoke_anchor', {
        scale: 0.2, // Very subtle farm smoke
        emitRate: 8,
        minSize: 0.8,
        maxSize: 1.5,
        minLifeTime: 1.0,
        maxLifeTime: 2.0
      });
      break;
      
    case 'tower':
    case 'watchtower':
      // Add torch fire effect
      window.fx.attachParticleEffect(building, 'fire', 'torch_anchor', {
        scale: 0.4,
        emitRate: 20,
        minSize: 0.3,
        maxSize: 0.8
      });
      break;
      
    case 'agora':
      // Agora model has no particle anchors - skip particle effects
      break;
      
    case 'brigand':
      // Add torch effects for brigand (multiple anchors)
      window.fx.attachMultipleParticleEffects(building, [
        { type: 'torch', anchor: 'torch_anchor.001', options: { scale: 0.3 } },
        { type: 'torch', anchor: 'torch_anchor.002', options: { scale: 0.3 } }
      ]);
      break;
      
    case 'wizard':
      // Add magical particle effects for wizard
      window.fx.attachMultipleParticleEffects(building, [
        { type: 'particle', anchor: 'particle_anchor.001', options: { scale: 0.5 } },
        { type: 'particle', anchor: 'particle_anchor.002', options: { scale: 0.5 } },
        { type: 'smoke', anchor: 'smoke_anchor', options: { scale: 0.3 } }
      ]);
      break;
      
    // Add more building types as needed
    default:
      // No default particle effects
      break;
  }
}

// Derive billboard scale and Y offset from a building's world-space bounding box
// so the LOD sprite matches the 3D model's visual footprint.
// Returns { scale, yOffset } — yOffset anchors the billboard bottom to the model's ground.
function computeBuildingBillboardScale(building) {
  const BILLBOARD_BASE_HEIGHT = 3.0; // master billboard plane is 3 units tall
  const FIT_FACTOR = 0.75; // shrink slightly so billboard doesn't overshoot the 3D model
  if (building.mesh) {
    try {
      const bounds = building.mesh.getHierarchyBoundingVectors(true);
      const height = bounds.max.y - bounds.min.y;
      const width  = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
      const extent = Math.max(height, width);
      if (extent > 0) {
        const scale = Math.max(1.5, (extent / BILLBOARD_BASE_HEIGHT) * FIT_FACTOR);
        // yOffset: difference between bounding box bottom and the root position
        const rootY = building.mesh.position.y;
        const yOffset = bounds.min.y - rootY;
        return { scale, yOffset };
      }
    } catch (_) { /* fall through */ }
  }
  const tileSize = window.TILE_SIZE || 4;
  const footprint = Math.max(building.size?.width || 2, building.size?.height || 2);
  return { scale: (footprint * tileSize / BILLBOARD_BASE_HEIGHT) * FIT_FACTOR, yOffset: 0 };
}

// Building type definitions
const BuildingTypes = {
  
  // ═══════════════════════════════════════════════════════════════
  // CORE BUILDINGS
  // ═══════════════════════════════════════════════════════════════

  agora: {
    name: "Agora",
    model: "assets/models/agora.glb",
    scale: 1.0,
    rotation: 0,
    size: { width: 4, height: 4 },
    cost: { stone: 5, wood: 5 },
    category: "civic",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    description: "Central marketplace and gathering place - the heart of your settlement"
  },

  // ═══════════════════════════════════════════════════════════════
  // BASIC BUILDINGS
  // ═══════════════════════════════════════════════════════════════

  camp: {
    name: "Camp",
    model: "assets/models/camp.glb",
    scale: 0.4,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 2 },
    category: "production",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 7.5,
    workType: "build",
    productionWorkType: "gather",
    productionMaxWorkers: 8,
    productionWorkRadius: 7,
    workInterval: 10000,
    workOutput: { wood: 0, stone: 0 },
    availableResources: [],
    description: "Basic work camp for gathering nearby resources"
  },

  village: {
    name: "Village",
    model: "assets/models/village.glb",
    scale: 0.2,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 5 },
    category: "residential",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsVillagers: true,
    spawnInterval: 30000,
    maxVillagers: 15,
    spawnRadius: 4,
    description: "Housing for villagers - increases population capacity"
  },

  farm: {
    name: "Farm",
    model: "assets/models/farm.glb",
    scale: 0.4,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 3 },
    category: "production",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    productionWorkType: "farm",
    productionMaxWorkers: 1,
    productionWorkRadius: 8,
    workInterval: 10000,
    workOutput: { food: 4 },
    description: "Produces food to sustain your population"
  },

  silo: {
    name: "Silo",
    model: "assets/models/silo.glb",
    scale: 0.35,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 5, stone: 3 },
    category: "storage",
    needsWorkers: true,
    maxWorkers: 2,
    workRadius: 15,
    workType: "build",
    storageBonus: { food: 100, wood: 50 },
    description: "Increases resource storage capacity"
  },

  tower: {
    name: "Watchtower",
    model: "assets/models/tower.glb",
    scale: 0.429,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { stone: 5, wood: 3 },
    category: "military",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    visionRange: 20,
    garrisonCapacity: 4,
    description: "Defensive structure with extended sight range"
  },

  mine: {
    name: "Mine",
    model: "assets/models/mine.glb",
    scale: 0.4,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { wood: 5, stone: 3, minerals: 1 },
    category: "production",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    productionWorkType: "mine",
    productionMaxWorkers: 4,
    productionWorkRadius: 15,
    workInterval: 12000,
    workOutput: { stone: 3, minerals: 1 },
    description: "Extracts stone and minerals from the earth"
  },

  // ═══════════════════════════════════════════════════════════════
  // ADVANCED BUILDINGS
  // ═══════════════════════════════════════════════════════════════

  tavern: {
    name: "Tavern",
    model: "assets/models/tavern.glb",
    scale: 0.25,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { wood: 5, stone: 3 },
    category: "civic",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["warlock"],
    enablesUpgrades: ["scribes", "patronage"],
    requires: ["village"],
    description: "Social hub that spawns Warlocks and enables upgrades"
  },

  moonwell: {
    name: "Moon Well",
    model: "assets/models/moonwell.glb",
    scale: 0.3,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { stone: 5, minerals: 1 },
    category: "support",
    needsWorkers: true,
    maxWorkers: 2,
    workRadius: 15,
    workType: "build",
    healRadius: 8,
    healAmount: 2,
    healInterval: 3000,
    description: "Magical well that heals nearby friendly units"
  },

  barracks: {
    name: "Barracks",
    model: "assets/models/barracks.glb",
    scale: 0.3,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { wood: 5, stone: 3 },
    category: "military",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["warrior", "archer"],
    trainingSpeed: 1.0,
    requires: ["farm"],
    description: "Trains Warriors and Archers for combat"
  },

  lab: {
    name: "Laboratory",
    model: "assets/models/lab.glb",
    scale: 0.35,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { stone: 5, minerals: 1 },
    category: "research",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    enablesUpgrades: ["prospecting", "armor", "artillery"],
    description: "Research facility that unlocks advanced upgrades"
  },

  workshop: {
    name: "Workshop",
    model: "assets/models/workshop.glb",
    scale: 0.35,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { wood: 5, stone: 3 },
    category: "production",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    enablesUpgrades: ["stewardship", "drayage"],
    buildsVehicles: true,
    requires: ["mine"],
    description: "Crafting center for vehicles and mechanical upgrades"
  },

  // ═══════════════════════════════════════════════════════════════
  // ELEMENTAL BUILDINGS
  // ═══════════════════════════════════════════════════════════════

  factory: {
    name: "Factory",
    model: "assets/models/factory.glb",
    scale: 0.4,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { stone: 5, minerals: 1 },
    category: "elemental",
    element: "fire",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["apc"],
    requires: ["workshop"],
    description: "🔥 Fire elemental building - produces APCs and Tanks"
  },

  church: {
    name: "Church",
    model: "assets/models/church.glb",
    scale: 0.5,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { stone: 5, minerals: 1 },
    category: "elemental",
    element: "spirit",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["priest"],
    description: "✨ Spirit elemental building - trains Priests and Valkyries"
  },

  well: {
    name: "Well",
    model: "assets/models/well.glb",
    scale: 0.25,
    rotation: 0,
    size: { width: 2, height: 2 },
    cost: { stone: 5, minerals: 1 },
    category: "elemental",
    element: "water",
    needsWorkers: true,
    maxWorkers: 2,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["mycorrhizae"],
    prerequisites: { research: ["prospecting"] },
    description: "💧 Water elemental building - trains Myco and Alchemists"
  },

  perch: {
    name: "Perch",
    model: "assets/models/perch.glb",
    scale: 0.45,
    rotation: 0,
    size: { width: 2, height: 3 },
    cost: { wood: 5, minerals: 1 },
    category: "elemental",
    element: "air",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["dirigible"],
    prerequisites: { research: ["drayage"] },
    description: "🌀 Air elemental building - launches Dirigibles and War Balloons"
  },

  grove: {
    name: "Grove",
    model: "assets/models/trees.glb",
    scale: 0.5,
    rotation: 0,
    size: { width: 3, height: 3 },
    cost: { wood: 5, minerals: 1 },
    category: "elemental",
    element: "earth",
    needsWorkers: true,
    maxWorkers: 3,
    workRadius: 15,
    workType: "build",
    spawnsUnits: ["shaman"],
    description: "🌿 Earth elemental building - trains Shamans and Druids"
  }
};

// ═══════════════════════════════════════════════════════════════
// UPGRADE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const UpgradeTypes = {
  
  scribes: {
    name: "Scribes",
    cost: { food: 30, minerals: 15 },
    researchTime: 30000,
    requires: ["workshop"],
    effects: { resourceGatherRate: 1.15 },
    description: "Educated scribes improve resource management (+15% gather rate)"
  },

  prospecting: {
    name: "Prospecting",
    cost: { food: 25, stone: 20 },
    researchTime: 25000,
    requires: ["moonwell"],
    effects: { mineOutput: 1.25 },
    description: "Advanced mining techniques reveal hidden deposits (+25% mine output)"
  },

  armor: {
    name: "Armor",
    cost: { stone: 40, minerals: 20 },
    researchTime: 35000,
    requires: ["workshop"],
    effects: { unitHealth: 1.2 },
    description: "Reinforced armor plating for all military units (+20% health)"
  },

  stewardship: {
    name: "Stewardship",
    cost: { food: 35, wood: 25 },
    researchTime: 30000,
    requires: ["moonwell"],
    effects: { buildingHealth: 1.25, repairSpeed: 1.5 },
    description: "Better building maintenance (+25% building health, +50% repair speed)"
  },

  drayage: {
    name: "Drayage",
    cost: { wood: 40, stone: 20 },
    researchTime: 28000,
    requires: ["barracks"],
    effects: { unitSpeed: 1.15, carryCapacity: 1.3 },
    description: "Improved logistics (+15% unit speed, +30% carry capacity)"
  },

  patronage: {
    name: "Patronage",
    cost: { food: 50, minerals: 25 },
    researchTime: 40000,
    requires: ["tavern"],
    effects: { unitTrainingSpeed: 1.25, unitCost: 0.9 },
    description: "Noble sponsorship speeds training (+25% train speed, -10% unit cost)"
  },

  artillery: {
    name: "Artillery",
    cost: { stone: 60, minerals: 40 },
    researchTime: 45000,
    requires: ["lab"],
    effects: { siegeDamage: 1.5, rangedDamage: 1.2 },
    description: "Heavy weapons research (+50% siege damage, +20% ranged damage)"
  }
};

// Make UpgradeTypes globally available
window.UpgradeTypes = UpgradeTypes;

// Global buildings array and model pools
const gameBuildings = [];
const buildingModelPools = new Map(); // path -> array of model instances

// Building constructor
function Building(buildingType, position, options = {}) {
  const def = BuildingTypes[buildingType];
  if (!def) {
    // console.error(`Unknown building type: ${buildingType}`);
    return null;
  }
  
  // Copy all properties from definition
  Object.assign(this, def);
  
  // Building instance properties
  // Store the original building type (for lookups)
  this.type = buildingType;
  
  // MULTIPLAYER: Use deterministic ID from options (generated by Match.buildingCounter)
  // If no ID provided, fall back to building count (for backwards compatibility or single-player)
  this.id = options.id || (window.isMultiplayer && window.currentMatch ? 
      `building-${window.currentMatch.mapSeed}-${(window.gameBuildings?.length || 0)}` : 
      Math.random().toString(36).substr(2, 9));
  this.position = position || { x: 0, y: 0, z: 0 };
  
  // CRITICAL: Store grid coordinates for deterministic checksum calculation
  // If gridX/gridZ are provided in options, use them; otherwise calculate from world position
  this.gridX = options.gridX !== undefined ? options.gridX : Math.round(this.position.x / TILE_SIZE);
  this.gridZ = options.gridZ !== undefined ? options.gridZ : Math.round(this.position.z / TILE_SIZE);
  
  // Calculate deterministic rotation based on grid position (like resources)
  // This gives visual variety while keeping multiplayer in sync
  const mapSeed = (window.liveField?.seed) || (window.currentMatch?.mapSeed) || 12345;
  let rotHash = mapSeed + this.gridX * 73856093 + this.gridZ * 19349663;
  rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
  rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
  rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
  const rotationIndex = rotHash % 8; // 8 directions: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
  this.targetRotation = options.rotation !== undefined ? options.rotation : (rotationIndex * Math.PI / 4);
  
  this.owner = options.owner; // CRITICAL: No default owner - must be explicitly set!
  this.health = options.health || 100;
  this.maxHealth = 100;
  this.buildProgress = options.buildProgress !== undefined ? options.buildProgress : 0.0; // 0-1, 1 = complete, start at 0 for construction
  this.completionProcessed = false; // CRITICAL: Track if completion has been synchronized across all peers
  this.completionCommandSent = false; // Track if completion command has been sent (multiplayer)
  
  // CRITICAL: Track construction start tick for deterministic progress calculation
  this.constructionStartTick = options.constructionStartTick || 0;
  this.constructionWorkTicks = 0; // Total work ticks accumulated (worker-ticks)
  this.lastConstructionTick = -1; // Track last tick we processed construction (prevent double-counting)
  
  // Villager spawning properties (for buildings that spawn villagers)
  this.lastSpawnTick = 0; // Last tick a villager spawned (deterministic)
  this.spawnedVillagers = 0; // Count of villagers spawned by this building
  
  // Work assignment properties (for buildings that need workers)
  this.assignedWorkers = []; // Array of villager units assigned to this building
  this.lastWorkTick = 0; // Last tick workers produced resources (deterministic)
  this.lastWorkerCheckTick = -1; // Prevent multiple assignment passes per tick
  
  // 3D model reference
  this.mesh = null;
  
  // // console.log(`Created ${this.name} at position`, this.position);
}

// Place a specific building at coordinates
function placeBuilding(buildingType, x, z, scene, options = {}) {
  // // console.log(`🏗️ Placing building: ${buildingType} at tile (${x}, ${z})`);
  
  const worldX = x * TILE_SIZE;
  const worldZ = z * TILE_SIZE;
  
  // Get terrain height at this position (uses triangular interpolation to match GPU rendering)
  const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(worldX, worldZ) : 0;
  
  // Apply ground offset to ensure buildings sit ON the terrain
  const buildingHeight = terrainY + BUILDING_GROUND_OFFSET;
  const worldPosition = new BABYLON.Vector3(worldX, buildingHeight, worldZ);
  // // console.log(`🌍 World position: (${worldPosition.x}, ${worldPosition.y}, ${worldPosition.z})`);
  
  // CRITICAL: Pass grid coordinates explicitly for accurate checksum calculation
  // Merge options with grid coordinates
  const buildingOptions = { ...options, gridX: x, gridZ: z };
  const building = new Building(buildingType, { x: worldPosition.x, y: buildingHeight, z: worldPosition.z }, buildingOptions);
  // // console.log(`🏛️ Building created:`, building.name, 'Model path:', building.model);
  
  if (window.gfx) {
    // Try to get from pool first
    let pool = buildingModelPools.get(building.model);
    let modelPromise;

    if (pool && pool.length > 0) {
      // Reuse instance from pool
      const model = pool.pop();
      modelPromise = Promise.resolve(model);
    } else {
      // Create new instance
      modelPromise = window.gfx.getModel(building.model, scene);
    }

    modelPromise.then(model => {
      building.mesh = model.root;
      
      // Make building mesh pickable for selection
      building.mesh.isPickable = true;
      
      // Set initial state - CRITICAL: clear quaternion so Euler rotation works
      building.mesh.rotationQuaternion = null;
      building.mesh.rotation.y = building.targetRotation || 0;
      // console.log(`🔄 Building ${building.type} at (${x},${z}) rotation: ${building.targetRotation.toFixed(2)} (${(building.targetRotation*180/Math.PI).toFixed(0)}°)`);
      
      // Keep child meshes' original rotations
      building.mesh.getChildMeshes().forEach(mesh => {
        if (mesh.rotationQuaternion) {
          const quaternion = mesh.rotationQuaternion.clone();
          mesh.rotationQuaternion = null;
          mesh.rotation = quaternion.toEulerAngles();
        }
      });
      
      // Set position and initial scale/height based on build progress
      building.mesh.position = worldPosition.clone();
      const targetScale = building.scale || 1.0;
      
      // If building is under construction, start at half height and rise to full height
      if (building.buildProgress < 1.0) {
        const progressScale = 0.1 + (building.buildProgress * 0.9); // Scale from 10% to 100%
        building.mesh.scaling = new BABYLON.Vector3(targetScale * progressScale, targetScale * progressScale, targetScale * progressScale);
        // Start at half height (buildingHeight - 1), rise to full height (buildingHeight) as progress increases
        const halfHeight = buildingHeight - 1; // Half way up from below ground
        const finalHeight = buildingHeight;
        building.mesh.position.y = halfHeight + (finalHeight - halfHeight) * building.buildProgress;
      } else {
        // Building is complete, set final position and scale
        building.mesh.position.y = buildingHeight;
        building.mesh.scaling = new BABYLON.Vector3(targetScale, targetScale, targetScale);
      }
      
      // Make it visible (only if setEnabled method exists)
      if (typeof building.mesh.setEnabled === 'function') {
        building.mesh.setEnabled(true);
      }
      
      // Tag as building so terrain clicks can ignore it
      building.mesh.isBuilding = true;
      building.mesh.getChildMeshes().forEach(childMesh => {
        childMesh.isBuilding = true;
      });
      
      // AGORA ONLY: Store platform height for units to stand on
      if (buildingType === 'agora') {
        // Calculate the top height of the agora (for units to stand on)
        building.platformHeight = 2.5; // Units stand 2.5 units above ground on agora
        building.platformRadius = 8; // Platform area in world units (where units can stand)
        building.collisionRadius = 3.5; // Collision hitbox radius (prevents walking through building)
        
        // Attach a team flag on top of the agora so each player has a visible banner.
        // The flag is raised by half its height so it sits directly on the platform.
        if (window.gfx && window.gfx.getModel) {
          // Remove old flag if reusing from pool (agora mesh may have previous owner's flag)
          if (building.flagMesh) {
            building.flagMesh.dispose();
            building.flagMesh = null;
          }
          building.flagRoots = null;
          
          window.gfx.getModel('assets/models/flag.glb', scene).then(flagModel => {
            // Use ALL root nodes from the GLB so nothing is left floating in the scene
            const flagNodes = flagModel.nodes && flagModel.nodes.length ? flagModel.nodes : [flagModel.root];
            const flagRoot = flagModel.root;
            
            if (flagModel.animationGroups) {
              flagModel.animationGroups.forEach(g => g.stop());
            }
            
            const flagScale = 0.6;
            building.flagBaseScale = flagScale;
            building.flagRoots = flagNodes;
            
            flagNodes.forEach(node => {
              node.parent = building.mesh;
              node.scaling = new BABYLON.Vector3(flagScale, flagScale, flagScale);
              node.position = new BABYLON.Vector3(0, 0.5, 0);
              node.rotationQuaternion = null;
              // +90° so banner planes face across the map (toward other bases) instead of tangential to agora facing
              node.rotation.y = Math.PI / 2;
              // CRITICAL: getModel disables models by default - re-enable
              if (typeof node.setEnabled === 'function') node.setEnabled(true);
            });
            
            // Resolve team color
            let teamColorHex = building.teamColor;
            if (!teamColorHex && typeof window.getTeamColorForOwner === 'function' && building.owner) {
              teamColorHex = window.getTeamColorForOwner(building.owner);
            }
            if (teamColorHex && typeof teamColorHex !== 'string') {
              if (teamColorHex.r !== undefined) {
                const r = Math.round(teamColorHex.r * 255).toString(16).padStart(2, '0');
                const g = Math.round(teamColorHex.g * 255).toString(16).padStart(2, '0');
                const b = Math.round(teamColorHex.b * 255).toString(16).padStart(2, '0');
                teamColorHex = `#${r}${g}${b}`;
              } else {
                teamColorHex = null;
              }
            }
            
            if (teamColorHex) {
              // Collect every mesh in the flag hierarchy across ALL root nodes
              const allFlagMeshes = [];
              flagNodes.forEach(node => {
                if (typeof node.getTotalVertices === 'function') allFlagMeshes.push(node);
                (node.getChildMeshes?.() || []).forEach(m => allFlagMeshes.push(m));
              });
              
              const clean = teamColorHex.replace('#', '');
              const r = parseInt(clean.substr(0, 2), 16) / 255;
              const g = parseInt(clean.substr(2, 2), 16) / 255;
              const b = parseInt(clean.substr(4, 2), 16) / 255;
              const color = new BABYLON.Color3(r, g, b);
              
              allFlagMeshes.forEach(mesh => {
                const sourceMaterial = mesh.material;
                const mat = new BABYLON.StandardMaterial(`flagMat_${teamColorHex}_${Date.now()}`, scene);
                mat.diffuseColor = new BABYLON.Color3(color.r, color.g, color.b);
                mat.emissiveColor = new BABYLON.Color3(color.r, color.g, color.b).scale(0.6);
                mat.specularColor = new BABYLON.Color3(0, 0, 0);
                mat.disableLighting = true;
                if (sourceMaterial) {
                  if (typeof sourceMaterial.alpha === 'number') mat.alpha = sourceMaterial.alpha;
                  if (typeof sourceMaterial.backFaceCulling === 'boolean') {
                    mat.backFaceCulling = sourceMaterial.backFaceCulling;
                  }
                }
                mesh.material = mat;
              });
            }
            
            // Keep reference for later cleanup
            building.flagMesh = flagRoot;
            if (window.gfx && window.gfx.forceUpdateLOD) {
              const camPos = window.gfx.cameraTarget ? window.gfx.cameraTarget.position : window.gfx.camera?.position;
              if (camPos) window.gfx.forceUpdateLOD(camPos);
            }
          }).catch(err => {
            console.warn('⚠️ Failed to load agora flag model:', err);
          });
        }
      }
      
      // Set up shadows for building mesh
      if (window.gfx && window.gfx.setupMeshShadows) {
        window.gfx.setupMeshShadows(building.mesh);
      }
      
      // CRITICAL: Add particle effects after delay for ALL buildings
      // This ensures mesh hierarchy and world matrices are fully computed
      // Otherwise particles appear at (0,0,0) corner!
      if (window.fx) {
        setTimeout(() => {
          // Guard against disposed mesh
          if (!building.mesh) return;
          // Force recompute world matrices to ensure positions are correct
          building.mesh.computeWorldMatrix(true);
          addBuildingParticleEffects(building);
        }, 150); // Delay to ensure mesh hierarchy is ready
      }
      
      if (building.buildProgress >= 1.0 && !building.completionProcessed) {
        processBuildingCompletion(building);
      }

      // Only add particle effects if building is complete (construction will add them when done)
      if (building.buildProgress >= 1.0) {
        addBuildingParticleEffects(building);
      }
    }).catch(err => {
      // console.error(`❌ Failed to load ${building.name} model:`, err);
    });
  } else {
    // console.error(`❌ Graphics system not available!`);
  }
  
  // CRITICAL: Push to window.gameBuildings (not local gameBuildings) 
  // to ensure we're using the array after any resets
  window.gameBuildings.push(building);
  
  // Debug: Log when building is placed
  // console.log(`🏗️ PLACED ${building.type} for ${building.owner}: progress=${(building.buildProgress*100).toFixed(0)}%, needsWorkers=${building.needsWorkers}, workType=${building.workType}`);
  
  return building;
}

// Place the agora at the player's agora location
function placeAgora(scene, options = {}) {
  // Agora starts complete (it's the starting building)
  const agoraOptions = { ...options, buildProgress: 1.0 };
  if (window.player) {
    if (window.player.agora) {
      const rawId = window.player.id || '';
      const parts = rawId.split('-');
      const owner = parts.length > 1 ? parts[parts.length - 1] : (rawId.length > 6 ? rawId.slice(-6) : rawId);
      agoraOptions.owner = owner || undefined;
      return placeBuilding('agora', window.player.agora.x, window.player.agora.y, scene, agoraOptions);
    }
    // console.warn("Player agora location not found, using default (15, 15)");
  }
  return placeBuilding('agora', 15, 15, scene, agoraOptions);
}

// Initialize buildings when scene is ready
function initBuildings(scene) {
  // // console.log("Initializing buildings...");
  placeAgora(scene);
}

// Spawn a villager from a village building
function spawnVillagerFromVillage(village) {
  if (!village || !village.spawnsVillagers) return;
  const isAdventureMode = window.currentMatch?.gameType === 'adventure' || window.gameType === 'adventure';
  
  // Check if village has reached max villagers
  if (village.spawnedVillagers >= village.maxVillagers) {
    return;
  }
  
  // CRITICAL: Check if village completion has been processed (synchronized across all peers)
  // This ensures villagers only spawn after the synchronized completion event
  if (!village.completionProcessed || village.buildProgress < 1.0) {
    return;
  }
  
  // Check if enough time has passed since last spawn (DETERMINISTIC with ticks)
  const currentTick = window.currentMatch?.tick || 0;
  
  // First villager spawns very quickly (20 ticks = 1 second), rest use normal interval
  // Convert milliseconds to ticks (20 ticks per second at 20Hz)
  const tickRate = 20; // Match net.TICK_RATE
  const spawnDelayTicks = village.spawnedVillagers === 0 ? 20 : Math.floor(village.spawnInterval / 1000 * tickRate);
  
  if (currentTick - village.lastSpawnTick < spawnDelayTicks) {
    return;
  }
  
  // First two villagers are free (founders)
  if (village.spawnedVillagers >= 2) {
    // Check if there's enough food to support new villagers
    if (!isAdventureMode) {
      const normalizeOwnerId = (id) => id?.length > 6 ? id.slice(-6) : id;
      const normalizedVillageOwner = normalizeOwnerId(village.owner);
      const ownerPlayer = (window.currentMatch?.players || []).find(p => {
        const playerId = p?.id || p;
        return normalizeOwnerId(playerId) === normalizedVillageOwner;
      }) || (normalizeOwnerId(window.player?.id) === normalizedVillageOwner ? window.player : null);
      const resources = typeof ownerPlayer?.getResources === 'function'
        ? ownerPlayer.getResources()
        : ownerPlayer?.resources;

      if (!resources?.food || resources.food <= 0) {
        // No food - double the spawn interval to simulate hardship
        village.lastSpawnTick = currentTick + spawnDelayTicks * 2;
        // console.log("😢 Village has no food - delaying next villager spawn");
        return;
      }
    }
  } else {
    // console.log(`🏠 New village spawning founder ${village.spawnedVillagers + 1} of 2`);
  }
  
  // CRITICAL: Use deterministic unit counter for multiplayer sync
  // Increment counter BEFORE creating unit to ensure consistent IDs across clients
  let unitIndex;
  let deterministicUnitId;
  if (window.isMultiplayer && window.currentMatch) {
    unitIndex = window.currentMatch.unitCounter++;
    deterministicUnitId = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
  }
  
  // Find a spawn position near the village (pass unitIndex for deterministic offsets)
  const spawnPosition = findVillagerSpawnPosition(village, unitIndex);
  if (!spawnPosition) {
    return; // No valid spawn position found
  }
  
  // Create the villager
  // CRITICAL: Always pass id in options (even if undefined) to prevent Unit constructor from incrementing counter
  const villager = new Unit('villager', spawnPosition, { id: deterministicUnitId || undefined });
  // CRITICAL: Set owner correctly - use normalized ID if it's a long ID
  const rawOwner = village.owner;
  villager.owner = rawOwner?.length > 6 ? rawOwner.slice(-6) : rawOwner;
  
  // Deterministic rotation based on building ID, spawn count, and unit index (if multiplayer)
  const buildingIdHash = (village.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const rotationSeed = window.isMultiplayer && unitIndex !== undefined 
    ? (buildingIdHash + unitIndex + currentTick)
    : (buildingIdHash + village.spawnedVillagers + currentTick);
  const deterministicRotation = (rotationSeed % 628) / 100; // 0 to ~6.28 (2π)
  villager.rotation = deterministicRotation;
  if (villager.pb.state && villager.pb.state.rot) {
    villager.pb.state.rot.y = deterministicRotation;
  }
  
  // Add to the owning player's unit array. In co-op adventure there may be more than
  // one non-local human player, so `window.opponent` is not a reliable source of truth.
  const normalizeOwnerId = (id) => id?.length > 6 ? id.slice(-6) : id;
  const normalizedVillageOwner = normalizeOwnerId(village.owner);
  const normalizedPlayerId = normalizeOwnerId(window.player?.id);
  let ownerPlayer = null;

  if (normalizedVillageOwner && normalizedVillageOwner === normalizedPlayerId && window.player) {
    ownerPlayer = window.player;
  } else if (window.currentMatch?.players) {
    ownerPlayer = window.currentMatch.players.find(p => {
      const playerId = p?.id || p;
      return normalizeOwnerId(playerId) === normalizedVillageOwner;
    }) || null;
  }

  if (ownerPlayer) {
    ownerPlayer.units = ownerPlayer.units || [];
    ownerPlayer.units.push(villager);
  } else {
    console.warn(`⚠️ Village spawned villager but owner unclear!`);
    console.warn(`   Village owner: "${village.owner}" (normalized: "${normalizedVillageOwner}")`);
    console.warn(`   Villager owner: "${villager.owner}"`);
    console.warn(`   Player ID: "${window.player?.id}" (normalized: "${normalizedPlayerId}")`);
    console.warn(`   Match players: ${(window.currentMatch?.players || []).map(p => normalizeOwnerId(p?.id || p)).join(', ')}`);
  }
  // CRITICAL: Add to GLOBAL gameUnits array so villagers can be found/selected
  window.gameUnits.push(villager);
  
  // Update village spawn tracking
  village.lastSpawnTick = currentTick;
  village.spawnedVillagers++;
  
  // Spawn the visual model immediately for this specific villager
  if (window.gfx && window.gfx.scene && window.gfx.getModel) {
    window.gfx.getModel(villager.model, window.gfx.scene).then(model => {
      villager.mesh = model.root;
      villager.mesh.scaling = new BABYLON.Vector3(villager.scale, villager.scale, villager.scale);
      
      // Store animation groups for walk/idle animation switching
      if (model.animationGroups && model.animationGroups.length > 0) {
        villager.animationGroups = {};
        model.animationGroups.forEach(group => {
          // Babylon prefixes cloned animations with "Clone of " - strip it
          let name = group.name.toLowerCase();
          if (name.startsWith('clone of ')) {
            name = name.substring(9);
          }
          villager.animationGroups[name] = group;
        });
        villager.currentAnimation = null;
        
        // Start idle animation immediately to avoid T-pose
        if (villager.animationGroups['idle']) {
          villager.animationGroups['idle'].start(true);
          villager.currentAnimation = 'idle';
        }
      }
      
      // CRITICAL: Enable the mesh (getModel disables it by default to prevent flash)
      if (typeof villager.mesh.setEnabled === 'function') {
        villager.mesh.setEnabled(true);
      }
      
      // Make unit mesh pickable for selection
      villager.mesh.isPickable = true;
      
      // Set up shadows for unit mesh
      if (window.gfx && window.gfx.setupMeshShadows) {
        window.gfx.setupMeshShadows(villager.mesh);
      }
      
      // Create blob shadow for this unit (will be visible only in blob mode)
      if (window.gfx && window.gfx.createBlobShadow) {
        window.gfx.createBlobShadow(villager);
        if (window.gfx.updateBlobShadow) {
          window.gfx.updateBlobShadow(villager);
        }
      }
      
      // Handle child meshes - preserve their original rotations
      villager.mesh.getChildMeshes().forEach(mesh => {
        mesh.isPickable = true;
        
        // Store their original rotations if they have them
        if (mesh.rotationQuaternion) {
          const quaternion = mesh.rotationQuaternion.clone();
          mesh.rotationQuaternion = null;
          mesh.originalRotation = quaternion.toEulerAngles();
          mesh.rotation.copyFrom(mesh.originalRotation);
        }
      });
      
      // Create selection indicator (glowing ring)
      if (window.createSelectionIndicator) {
        window.createSelectionIndicator(villager);
      }
      
      // Set initial position from physics body
      if (villager.pb && villager.pb.state && villager.pb.state.loc) {
        villager.mesh.position.x = villager.pb.state.loc.x;
        villager.mesh.position.y = villager.pb.state.loc.y;
        villager.mesh.position.z = villager.pb.state.loc.z;
      }
      
      // Apply rotation
      if (villager.pb && villager.pb.state && villager.pb.state.rot) {
        villager.mesh.rotationQuaternion = null;
        villager.mesh.rotation.y = villager.pb.state.rot.y;
      }
      
      // Apply team colors to the villager
      if (window.applyTeamColorsToMesh) {
        const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(villager.owner) : '#4A90E2';
        window.applyTeamColorsToMesh(villager.mesh, teamColor);
      }

      // Create LOD billboard for distant rendering
      if (window.gfx && window.gfx.getBillboardInstance) {
        const billboardScale = Math.max(0.6, (villager.scale || 0.5) * 1.5);
        villager.billboard = window.gfx.getBillboardInstance(villager.model, villager.mesh.position, billboardScale, window.gfx.scene, { groundUnitSprite: true });
        villager.billboard.setEnabled(false);
      }
    }).catch(error => {
      console.error('❌ Failed to load villager model:', error);
    });
  }
  
  // CRITICAL: Give new villager a linger behavior so they can be auto-assigned to work
  if (window.behaviorManager && villager.pb && villager.pb.state && villager.pb.state.loc) {
    window.behaviorManager.setBehavior(villager, 'linger', {
      center: { x: villager.pb.state.loc.x, z: villager.pb.state.loc.z },
      radius: 50,  // Large radius - villagers can roam freely
      wanderDistance: 2.0,  // How far they walk each step
      wanderInterval: 30000  // Pick new target every 30 seconds (very relaxed)
    });
  }
  
  // console.log(`🏘️ Village spawned villager #${village.spawnedVillagers} at (${spawnPosition.x.toFixed(1)}, ${spawnPosition.z.toFixed(1)})`);
}

// Find a valid spawn position near a village
function findVillagerSpawnPosition(village, unitIndex) {
  if (!village || !village.position) return null;
  
  const maxAttempts = 20;
  const spawnRadius = (village.spawnRadius || 3) * 1.5; // Increased spawn radius for more spread
  
  // CRITICAL: Use deterministic values based on building ID and unitIndex ONLY
  // DO NOT use currentTick - it can vary between clients and cause position drift!
  // Use unitIndex for deterministic offsets across all clients (more reliable than spawnedVillagers)
  const buildingIdHash = (village.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  // Use unitIndex if available (multiplayer), otherwise fall back to spawnedVillagers (single-player)
  const spawnSeed = unitIndex !== undefined ? unitIndex : (village.spawnedVillagers || 0);
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate deterministic position within spawn radius
    // CRITICAL: Only use buildingIdHash + spawnSeed + attempt for determinism
    const angleSeed = (buildingIdHash + spawnSeed + attempt * 37) % 628;
    const angle = angleSeed / 100; // 0 to ~6.28 (2π)
    
    const distanceSeed = (buildingIdHash + spawnSeed + attempt * 73) % 1000;
    const distance = (distanceSeed / 1000) * spawnRadius * TILE_SIZE;
    
    const spawnX = village.position.x + Math.cos(angle) * distance;
    const spawnZ = village.position.z + Math.sin(angle) * distance;
    
    // Check if position is valid (not too close to other units/buildings)
    const isValidPosition = isPositionValidForSpawn(spawnX, spawnZ);
    
    if (isValidPosition) {
      return { x: spawnX, y: 0, z: spawnZ };
    }
  }
  
  // If no valid position found, spawn at village position with deterministic offset
  // CRITICAL: Only use buildingIdHash + spawnSeed for determinism (no currentTick!)
  const offsetSeed = (buildingIdHash + spawnSeed) % 1000;
  const offset = (offsetSeed / 1000 - 0.5) * TILE_SIZE;
  return { 
    x: village.position.x + offset, 
    y: 0, 
    z: village.position.z + offset 
  };
}

// Check if a position is valid for spawning a villager
// CRITICAL: Must be deterministic - sort units/buildings by ID for consistent iteration order
// CRITICAL: In multiplayer, skip validation to ensure deterministic spawn positions
function isPositionValidForSpawn(x, z) {
  // CRITICAL: In multiplayer, always return true to avoid position-dependent divergence
  // Small position drift could cause different validation results between clients
  if (window.isMultiplayer) {
    return true;
  }
  
  const minDistance = TILE_SIZE * 1.5; // Minimum distance from other units
  
  // CRITICAL: Sort units by ID for deterministic iteration order
  // This ensures both clients check the same units in the same order
  const sortedUnits = (window.gameUnits || gameUnits).slice().sort((a, b) => 
    window.deterministicStringCompare(a.id || '', b.id || '')
  );
  
  // Check distance from other units
  for (const unit of sortedUnits) {
    if (unit.pb && unit.pb.state && unit.pb.state.loc) {
      const dx = x - unit.pb.state.loc.x;
      const dz = z - unit.pb.state.loc.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < minDistance) {
        return false;
      }
    }
  }
  
  // CRITICAL: Sort buildings by ID for deterministic iteration order
  const sortedBuildings = (window.gameBuildings || gameBuildings).slice().sort((a, b) => 
    window.deterministicStringCompare(a.id || '', b.id || '')
  );
  
  // Check distance from other buildings
  for (const building of sortedBuildings) {
    if (building.position) {
      const dx = x - building.position.x;
      const dz = z - building.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < minDistance) {
        return false;
      }
    }
  }
  
  return true;
}

// Find idle villagers near a building
function findIdleVillagersNearBuilding(building) {
  if (!building || !building.needsWorkers || !building.position) return [];
  
  const idleVillagers = [];
  const workRadius = building.workRadius || 20; // Increased radius to find workers across map
  
  // CRITICAL: Sort units by ID before iterating for deterministic order
  // This ensures both clients check the same units in the same order
  const sortedUnits = (window.gameUnits || []).slice().sort((a, b) =>
    window.deterministicStringCompare(a.id || '', b.id || '')
  );
  
  const currentTick_search = window.currentMatch?.tick || 0;
  const shouldLogSearch = building.workType === 'build' && !building.completionProcessed && currentTick_search % 200 === 0;
  let _skipReasons = shouldLogSearch ? { noPhysics: 0, notVillager: 0, ownerMismatch: 0, notIdle: 0, protected: 0, recentCmd: 0, tooFar: 0, assigned: 0 } : null;
  
  // Look through all game units for idle villagers and engineers
  for (const unit of sortedUnits) {
    if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) { if (_skipReasons) _skipReasons.noPhysics++; continue; }
    if (unit.type !== 'villager' && unit.type !== 'engineer') { if (_skipReasons) _skipReasons.notVillager++; continue; }
    
    // CRITICAL: Normalize both IDs for comparison (handle both full and shortened IDs)
    const normalizedUnitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
    const normalizedBuildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
    if (normalizedUnitOwner !== normalizedBuildingOwner) { if (_skipReasons) _skipReasons.ownerMismatch++; continue; }
    
    // Check if villager is idle (no active behavior OR just has linger/wander behavior)
    // Also check if villager is stuck at an empty camp (GatherWorkBehavior with no resources)
    const currentBehavior = window.behaviorManager ? window.behaviorManager.getBehavior(unit) : null;
    let isIdleOrLingering = !currentBehavior || 
                              (currentBehavior && (currentBehavior.constructor.name === 'LingerBehavior' ||
                                                   currentBehavior.constructor.name === 'WanderBehavior' ||
                                                   currentBehavior.constructor.name === 'EatBehavior'));
    
    // CRITICAL: Don't auto-assign units with player-commanded behaviors - respect all direct commands!
    if (currentBehavior) {
      const behaviorName = currentBehavior.constructor.name;
      if (behaviorName === 'ManualGatherBehavior' || 
          behaviorName === 'WalkBehavior' || 
          behaviorName === 'RunBehavior' ||
          behaviorName === 'AttackBuildingBehavior') {
        if (_skipReasons) _skipReasons.protected++;
        continue;
      }
    }
    
    // SPECIAL: Check if villager has GatherWorkBehavior but camp has no resources
    if (!isIdleOrLingering && currentBehavior && currentBehavior.constructor.name === 'GatherWorkBehavior') {
      if (currentBehavior.findNearestResource && !currentBehavior.findNearestResource()) {
        isIdleOrLingering = true;
      }
    }
    
    if (!isIdleOrLingering) {
      if (_skipReasons) { _skipReasons.notIdle++; if (shouldLogSearch && currentBehavior) console.log(`   ↳ ${unit.id?.slice(-6)} busy: ${currentBehavior.constructor.name}`); }
      continue;
    }
    
    // CRITICAL: Don't auto-assign units that recently received a player command.
    // EXCEPTION: Skip grace period for under-construction buildings — if the player
    // moved a villager to a build site, they want it to build.
    const currentTick = window.currentMatch?.tick || 0;
    const nearConstruction = building.workType === 'build' && !building.completionProcessed;
    if (!nearConstruction) {
      const recentTick = (unit.lastPlayerCommandTick !== undefined)
        ? unit.lastPlayerCommandTick
        : unit.lastPlayerMoveTick;
      if (recentTick !== undefined) {
        const ticksSince = currentTick - recentTick;
        const graceTicks = (window.isMultiplayer && window.gameType === 'adventure') ? 120 : 60;
        if (ticksSince < graceTicks) {
          if (_skipReasons) _skipReasons.recentCmd++;
          continue;
        }
      }
    }
    
    // Calculate distance to building for proximity-based assignment
    const dx = unit.pb.state.loc.x - building.position.x;
    const dz = unit.pb.state.loc.z - building.position.z;
    const distanceSquared = dx * dx + dz * dz;
    const maxDistance = workRadius * TILE_SIZE;
    
    // In multiplayer, use rounded distance to prevent desyncs from position drift
    // Rounding to nearest tile ensures deterministic distance comparisons
    if (window.isMultiplayer) {
      const roundedDistance = Math.round(Math.sqrt(distanceSquared) / TILE_SIZE) * TILE_SIZE;
      if (roundedDistance <= maxDistance) {
        idleVillagers.push({unit, distance: roundedDistance});
      } else if (_skipReasons) { _skipReasons.tooFar++; }
    } else {
      const distance = Math.sqrt(distanceSquared);
      if (distance <= maxDistance) {
        idleVillagers.push({unit, distance});
      } else if (_skipReasons) { _skipReasons.tooFar++; }
    }
  }
  
  if (shouldLogSearch && idleVillagers.length === 0 && _skipReasons) {
    console.warn(`🔍 No idle villagers for ${building.type} (${building.id?.slice(-6)}, owner=${building.owner}): total=${sortedUnits.length}, skipped: notVillager=${_skipReasons.notVillager}, owner=${_skipReasons.ownerMismatch}, notIdle=${_skipReasons.notIdle}, protected=${_skipReasons.protected}, recentCmd=${_skipReasons.recentCmd}, tooFar=${_skipReasons.tooFar}, workRadius=${workRadius}`);
  }
  
  // Sort by distance first (closer workers get priority), then by ID for determinism
  // In multiplayer, distances are rounded to prevent desyncs from position drift
  idleVillagers.sort((a, b) => {
    // Sort by distance first (closer = higher priority)
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    // If distances are equal (or both 0), sort by ID for determinism
    return window.deterministicStringCompare(a.unit.id || '', b.unit.id || '');
  });
  
  return idleVillagers.map(v => v.unit);
}

function isConstructionWorkerAtSite(worker, building) {
  if (!worker?.pb?.state?.loc || !building?.position) return false;
  const TILE_SIZE = window.TILE_SIZE || 4;
  const workRange = TILE_SIZE * 2; // Must be meaningfully at the site to count
  const dx = building.position.x - worker.pb.state.loc.x;
  const dz = building.position.z - worker.pb.state.loc.z;
  return Math.sqrt(dx * dx + dz * dz) <= workRange;
}

function getEffectiveAssignedWorkerCount(building) {
  if (!building) return 0;
  const assignedWorkers = Array.isArray(building.assignedWorkers) ? building.assignedWorkers : [];
  const isConstruction = building.workType === 'build' && !building.completionProcessed;
  if (!isConstruction) {
    return assignedWorkers.length;
  }
  return assignedWorkers.filter(worker => isConstructionWorkerAtSite(worker, building)).length;
}

function getAssignedWorkerSlotCount(building) {
  if (!building) return 0;
  const assignedWorkers = Array.isArray(building.assignedWorkers) ? building.assignedWorkers : [];
  return assignedWorkers.length;
}

// Assign a villager to work at a building
function assignVillagerToWork(villager, building) {
  if (!villager || !building || !window.behaviorManager) return false;
  
  // CRITICAL: Don't override ANY direct player commands!
  const currentBehavior = window.behaviorManager.getBehavior(villager);
  if (currentBehavior) {
    const behaviorName = currentBehavior.constructor.name;
    if (behaviorName === 'ManualGatherBehavior' || 
        behaviorName === 'WalkBehavior' || 
        behaviorName === 'RunBehavior' ||
        behaviorName === 'AttackBuildingBehavior' ||
        behaviorName === 'AttackUnitBehavior') {
      return false;
    }
  }
  
  // maxWorkers is updated by synchronized completion processing.
  const workerCap = building.maxWorkers;
  if (getAssignedWorkerSlotCount(building) >= workerCap) {
    return false;
  }
  
  // workType is updated by synchronized completion processing.
  const effectiveWorkType = building.workType;
  
  let workBehaviorType = 'work';
  if (villager.type === 'engineer') {
    workBehaviorType = 'engineer_work';
  } else if (effectiveWorkType === 'build') {
    workBehaviorType = 'build_work';
  } else if (effectiveWorkType === 'gather') {
    workBehaviorType = 'gather_work';
  } else if (effectiveWorkType === 'farm') {
    workBehaviorType = 'farm_work';
  } else if (effectiveWorkType === 'mine') {
    workBehaviorType = 'gather_work';
  }
  
  // Assign the work behavior
  const behaviorParams = { building: building };
  if (effectiveWorkType === 'mine') {
    behaviorParams.gatherDuration = 7500; // 2x faster than camps
    behaviorParams.resourceTypes = ['stone', 'minerals'];
  }
  window.behaviorManager.setBehavior(villager, workBehaviorType, behaviorParams);
  
  // Add to building's assigned workers
  building.assignedWorkers.push(villager);
  
  // Mark villager as assigned to this building
  villager.assignedBuilding = building;
  
  // DIAGNOSTIC: Log resource availability for camps
  if (building.workType === 'gather') {
    // Count only non-depleted, available resources (not scheduled for depletion)
    // NOTE: No longer tracking availableResources - villagers find resources dynamically
    const availableResourceCount = 0;
    const totalResourceCount = 0;
    // Note: Workers are automatically released when camp has no resources (see GatherWorkBehavior)
    // Only log warning once per camp to avoid spam
    if (availableResourceCount === 0 && !building._noResourcesWarned) {
      building._noResourcesWarned = true;
      // console.warn(`⚠️ Camp has NO available resources! Workers will be released.`);
    } else if (availableResourceCount > 0) {
      building._noResourcesWarned = false; // Reset if resources become available again
    }
  }
  return true;
}

// Helper to find player by owner ID (handles ID normalization)
function findPlayerByOwnerId(ownerId) {
  if (!ownerId) return null;
  
  // Try exact match first
  if (window.player && window.player.id === ownerId) return window.player;
  
  // Try normalized match (last 6 chars)
  const normalizeId = (id) => id?.length > 6 ? id.slice(-6) : id;
  const normalizedOwnerId = normalizeId(ownerId);
  
  if (window.player && normalizeId(window.player.id) === normalizedOwnerId) {
    return window.player;
  }
  
  // Check AI opponents
  if (window.currentMatch && window.currentMatch.players) {
    const owner = window.currentMatch.players.find(p => {
      const playerId = p.id || p;
      return normalizeId(playerId) === normalizedOwnerId;
    });
    return owner;
  }
  
  return null;
}

// Process building completion (called both locally and via command for sync)
function processBuildingCompletion(building) {
  if (!building || building.completionProcessed) return;
  
  building.completionProcessed = true;
  building.buildProgress = 1.0; // Clamp to 1.0
  
  
  // Ensure final position and scale
  if (building.mesh) {
    building.mesh.position.y = building.position.y || 0;
    const baseScale = building.scale || 1.0;
    building.mesh.scaling.x = baseScale;
    building.mesh.scaling.y = baseScale;
    building.mesh.scaling.z = baseScale;
    
    // PERFORMANCE: Freeze building mesh once construction is complete
    // Buildings don't move/rotate/scale after construction, so freezing gives huge perf boost
    if (building.mesh.freezeWorldMatrix) {
      building.mesh.freezeWorldMatrix();
      building.mesh.metadata = building.mesh.metadata || {};
      building.mesh.metadata.isFrozen = true;
    }
    // Also freeze child meshes
    building.mesh.getChildMeshes && building.mesh.getChildMeshes().forEach(childMesh => {
      if (childMesh.freezeWorldMatrix) {
        childMesh.freezeWorldMatrix();
      }
    });
  }
  
  // CRITICAL: Initialize timing ticks when construction completes for deterministic behavior
  const currentTick = window.currentMatch?.tick || 0;
  
  // Initialize lastSpawnTick for villages to ensure deterministic spawning
  if (building.spawnsVillagers && building.lastSpawnTick === 0) {
    building.lastSpawnTick = currentTick; // Set to completion tick
  }
  
  // Initialize lastWorkTick for production buildings to ensure deterministic production timing
  if (building.productionWorkType && building.lastWorkTick === 0) {
    building.lastWorkTick = currentTick; // Set to completion tick
  }
  
  // Switch to production workType if building has one
  if (building.productionWorkType && building.workType === 'build') {
    building.workType = building.productionWorkType;
    building.maxWorkers = building.productionMaxWorkers || building.maxWorkers;
    building.workRadius = building.productionWorkRadius || building.workRadius;
    // Clear assigned workers so they can be reassigned for production
    building.assignedWorkers.forEach(worker => {
      if (worker) {
        worker.assignedBuilding = null;
        if (window.behaviorManager) {
          const behavior = window.behaviorManager.getBehavior(worker);
          if (behavior && behavior.building === building) {
            window.behaviorManager.setBehavior(worker, 'linger');
          }
        }
      }
    });
    building.assignedWorkers = [];
  } else if (!building.productionWorkType && building.workType === 'build') {
    // Building has no production workType (like agora, tower), so stop needing workers after construction
    building.needsWorkers = false;
    // Clear assigned workers
    building.assignedWorkers.forEach(worker => {
      if (worker) {
        worker.assignedBuilding = null;
        if (window.behaviorManager) {
          const behavior = window.behaviorManager.getBehavior(worker);
          if (behavior && behavior.building === building) {
            window.behaviorManager.setBehavior(worker, 'linger');
          }
        }
      }
    });
    building.assignedWorkers = [];
  }
  
  // Register building with LOD system for billboard swapping at distance
  if (window.gfx && window.gfx.addLODBillboard && building.mesh) {
    const camPos = window.gfx.cameraTarget ? window.gfx.cameraTarget.position : window.gfx.camera?.position;
    if (building.type === 'agora') {
      window.gfx.addLODBillboard(
        { root: building.mesh },
        window.gfx.scene,
        { path: building.model, lodDistance: 175, cullDistance: 500, lodType: 'agora-flag', buildingRef: building },
        camPos
      );
    } else {
      const { scale: bbScale, yOffset: bbYOff } = computeBuildingBillboardScale(building);
      window.gfx.addLODBillboard(
        { root: building.mesh },
        window.gfx.scene,
        { path: building.model, lodDistance: 175, cullDistance: 500, billboardScale: bbScale, billboardYOffset: bbYOff },
        camPos
      );
    }
  }

  // Add particle effects when construction completes
  if (window.fx && !building.constructionCompleteEffectsAdded) {
    building.constructionCompleteEffectsAdded = true;
    setTimeout(() => {
      if (building.mesh) {
        building.mesh.computeWorldMatrix(true);
        addBuildingParticleEffects(building);
      }
    }, 100);
  }

  // Update menu button states when building completes
  if (window.updateMenuButtonStates) {
    window.updateMenuButtonStates();
  }
  if (window.hud && window.hud.update3DMenuStates) {
    window.hud.update3DMenuStates();
  }
}

// Process work and generate resources
function processWorkProduction(building) {
  if (!building || !building.needsWorkers || building.assignedWorkers.length === 0) return;
  
  // For camps, workers now deliver resources directly when they return
  // No need for automatic resource generation
  if (building.name.toLowerCase() === 'camp') {
    return; // Workers handle resource delivery directly
  }
  
  // For farms and other food buildings, use automatic resource generation
  // since farmers don't have the same gathering/delivery system
  
  // DETERMINISTIC: Use match ticks instead of Date.now()
  const currentTick = window.currentMatch?.tick || 0;
  const tickRate = 20; // Match net.TICK_RATE
  const workIntervalTicks = Math.floor((building.workInterval || 5000) / 1000 * tickRate); // Convert ms to ticks (20 ticks/sec)
  if (currentTick - (building.lastWorkTick || 0) < workIntervalTicks) return;
  
  // For other buildings, use the old automatic system
  const workerCount = building.assignedWorkers.length;
  
  // Apply worker efficiency (more workers = more output, but with diminishing returns)
  const efficiency = Math.min(workerCount, building.maxWorkers) / building.maxWorkers;
  let outputMultiplier = 0.3 + (efficiency * 0.7); // 30-100% efficiency based on workers
  
  // Apply engineer's boost if active
  const engineerBoostTicks = building.engineerBoostUntil || 0;
  if (engineerBoostTicks > 0 && currentTick < engineerBoostTicks) {
    outputMultiplier *= building.engineerBoostAmount || 1.5; // 50% boost
  }
  
  // Generate resources based on building's workOutput
  const workOutput = building.workOutput || {};
  for (const [resourceType, baseAmount] of Object.entries(workOutput)) {
    if (baseAmount > 0) {
      let actualAmount = Math.floor(baseAmount * outputMultiplier);
      
      // For farms, add extra food per worker
      if (building.name === 'Farm' && resourceType === 'food') {
        actualAmount += (workerCount - 1) * 1; // +3 food per additional worker
      }
      
      if (actualAmount > 0) {
        if (window.currentMatch && typeof window.currentMatch.queueResourceCredit === 'function') {
          window.currentMatch.queueResourceCredit(building.owner, resourceType, actualAmount, currentTick);
        } else {
          const owner = findPlayerByOwnerId(building.owner);
          if (!owner || !owner.addResource) {
            continue;
          }
          owner.addResource(resourceType, actualAmount);
          if (building.name === 'Farm') {
            // // console.log(`🌾 ${owner.name || owner.id}'s Farm produced ${actualAmount} food (${workerCount} farmers)`);
          } else {
            // // console.log(`💰 ${owner.name || owner.id}'s ${building.name} produced ${actualAmount} ${resourceType}`);
          }
        }
      }
    }
  }
  
  building.lastWorkTick = currentTick;
}

// Agora capture: TF2-style progress on the five health chips only (no ground disc / torus).
function disposeLegacyAgoraCaptureDiscAndRing(visuals) {
  if (!visuals) return;
  if (visuals.progressDisc) {
    try { visuals.progressDisc.dispose(); } catch (_) {}
    visuals.progressDisc = null;
  }
  if (visuals.progressMat) {
    try { visuals.progressMat.dispose(); } catch (_) {}
    visuals.progressMat = null;
  }
  if (visuals.warningRing) {
    try { visuals.warningRing.dispose(); } catch (_) {}
    visuals.warningRing = null;
  }
  if (visuals.warningMat) {
    try { visuals.warningMat.dispose(); } catch (_) {}
    visuals.warningMat = null;
  }
}

function updateCapturePointVisuals(agora) {
  if (!agora || !agora.mesh || !window.gfx || !window.gfx.scene) return;

  const captureProgress = agora.captureProgress || 0;
  const isContested = agora.contested || false;

  if (!agora.captureVisuals) {
    agora.captureVisuals = {};
    const baseDisc = BABYLON.MeshBuilder.CreateCylinder('captureBase', {
      height: 0.2,
      diameter: 40,
      tessellation: 32
    }, window.gfx.scene);
    baseDisc.position.y = 0.1;
    baseDisc.parent = agora.mesh;

    const baseMat = new BABYLON.StandardMaterial('captureBaseMat', window.gfx.scene);
    baseMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    baseMat.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    baseMat.alpha = 1.0;
    baseDisc.material = baseMat;
    baseDisc.isVisible = false;

    agora.captureVisuals.baseDisc = baseDisc;
    agora.captureVisuals.baseMat = baseMat;
  } else if (agora.captureVisuals.progressDisc || agora.captureVisuals.warningRing) {
    disposeLegacyAgoraCaptureDiscAndRing(agora.captureVisuals);
  }

  const visuals = agora.captureVisuals;
  const showCapDots = captureProgress > 0 || isContested;

  if (showCapDots) {
    if (window.createHealthDots) {
      window.createHealthDots(agora);
    }
    if (agora.healthDotsContainer && window.showHealthDots) {
      window.showHealthDots(agora);
      window.updateHealthDots(agora);
    }
  } else {
    const isSelected = window.player && window.player.selectedBuilding === agora;
    if (!isSelected && agora.healthDotsContainer && window.hideHealthDots) {
      window.hideHealthDots(agora);
    }
  }

  if (window.getTeamColorForOwner) {
    const ownerColorHex = window.getTeamColorForOwner(agora.owner);
    if (ownerColorHex) {
      const clean = typeof ownerColorHex === 'string' ? ownerColorHex.replace('#', '') : '';
      if (clean.length === 6) {
        const r = parseInt(clean.substr(0, 2), 16) / 255;
        const g = parseInt(clean.substr(2, 2), 16) / 255;
        const b = parseInt(clean.substr(4, 2), 16) / 255;
        const ownerColor = new BABYLON.Color3(r, g, b);
        visuals.baseMat.diffuseColor = new BABYLON.Color3(
          ownerColor.r * 0.7,
          ownerColor.g * 0.7,
          ownerColor.b * 0.7
        );
        visuals.baseMat.emissiveColor = new BABYLON.Color3(
          ownerColor.r * 0.3,
          ownerColor.g * 0.3,
          ownerColor.b * 0.3
        );
      }
    }
  }
}

// Update tower attack logic
function updateTowerAttack(tower, deltaTime) {
  if (!window.projectiles || !window.gameUnits) {
    return;
  }
  
  // Initialize tower attack properties
  if (!tower._attackInitialized) {
    tower._attackInitialized = true;
    tower.attackRange = 15; // Tower range in world units (tiles * TILE_SIZE)
    // Lower damage so arrows tend to shove units around instead of one-shotting them
    tower.attackDamage = 8;
    tower.attackIntervalTicks = 40; // 2 seconds at 20 TPS
    tower.currentTarget = null;
    tower.lastAttackTick = -tower.attackIntervalTicks;
  }

  const currentTick = window.currentMatch?.tick || 0;
  const ticksSinceAttack = currentTick - (tower.lastAttackTick || 0);
  if (ticksSinceAttack < (tower.attackIntervalTicks || 40)) {
    return;
  }
  
  // Find enemy units in range
  const towerPos = tower.mesh ? tower.mesh.getAbsolutePosition() : 
                   new BABYLON.Vector3(tower.position.x, tower.position.y || 2, tower.position.z);
  
  const candidates = [];
  window.gameUnits.forEach(unit => {
    if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) {
      return;
    }
    
    const isHostileUnit = window.currentMatch?.areOwnersHostile
      ? window.currentMatch.areOwnersHostile(unit.owner, tower.owner)
      : (unit.owner !== tower.owner);
    if (!isHostileUnit) {
      return;
    }
    
    // Skip units with no health
    if (!unit.health || unit.health <= 0) {
      return;
    }
    
    const unitPos = new BABYLON.Vector3(
      unit.pb.state.loc.x,
      unit.pb.state.loc.y || 0,
      unit.pb.state.loc.z
    );
    
    const dx = unitPos.x - towerPos.x;
    const dz = unitPos.z - towerPos.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= tower.attackRange * tower.attackRange) {
      candidates.push({ unit, unitPos, distanceSq });
    }
  });

  candidates.sort((a, b) => {
    if (a.distanceSq !== b.distanceSq) return a.distanceSq - b.distanceSq;
    return window.deterministicStringCompare(a.unit?.id || '', b.unit?.id || '');
  });
  const nearestEnemy = candidates[0]?.unit || null;
  const nearestEnemyPos = candidates[0]?.unitPos || null;
  
  // Fire at nearest enemy
  if (nearestEnemy && nearestEnemyPos && window.projectiles && window.projectiles.fire) {
    try {
      const targetPos = new BABYLON.Vector3(
        nearestEnemyPos.x,
        nearestEnemyPos.y || 0.5,
        nearestEnemyPos.z
      );
      
      // Fire arrow
      const projectile = window.projectiles.fire({
        type: 'arrow',
        from: towerPos.clone().add(new BABYLON.Vector3(0, 2, 0)), // Fire from top of tower
        to: targetPos,
        damage: tower.attackDamage,
        owner: tower.owner,
        gameplayImpact: false
      });
      
      if (window.projectiles.applyImpact) {
        window.projectiles.applyImpact({
          unit: nearestEnemy,
          attackerOwner: tower.owner,
          damage: tower.attackDamage,
          sourcePosition: towerPos,
          bopStrength: 60
        });
      }

      if (projectile) {
        tower.lastAttackTick = currentTick;
        tower.currentTarget = nearestEnemy;
      }
    } catch (e) {
      console.warn('Error firing tower projectile:', e);
      tower.lastAttackTick = currentTick;
    }
  } else {
    tower.currentTarget = null;
  }
}

// Update building logic (damage, construction progress, etc.)
function updateBuildings(deltaTime) {
  // Safe to run in menu scene - just guard against missing dependencies
  if (!window.gameBuildings || window.gameBuildings.length === 0) {
    return; // No buildings to update
  }
  
  // Debug: Log every 2 seconds, but only when buildings are under construction
  const currentTick = window.currentMatch?.tick || 0;
  if (currentTick % 40 === 0 && currentTick > 0) {
    const underConstruction = window.gameBuildings.filter(b => b.buildProgress < 1.0);
    if (underConstruction.length > 0) {
      // console.log(`🏗️ UPDATE BUILDINGS: ${window.gameBuildings.length} total, ${underConstruction.length} under construction`);
    }
  }
  
  // CRITICAL: Sort buildings by ID for deterministic iteration order
  // This ensures both clients process buildings in the same order,
  // which is essential for deterministic worker assignment
  const sortedBuildings = (window.gameBuildings || gameBuildings).slice().sort((a, b) =>
    window.deterministicStringCompare(a.id || '', b.id || '')
  );
  
  sortedBuildings.forEach(building => {
    // Update building-specific logic here
    // - Construction progress
    // - Health regeneration
    // - Production cycles
    // - Defensive actions
    
    // Handle deterministic mesh setup for multiplayer buildings
    if (building.needsMeshSetup && building.mesh && window.currentMatch) {
      // Apply rotation and team colors
      building.mesh.rotationQuaternion = null;
      building.mesh.rotation.y = building.targetRotation || 0;
      
      // Apply team colors
      if (window.applyTeamColorsToMesh && window.getTeamColorForOwner) {
        const teamColor = window.getTeamColorForOwner(building.owner);
        window.applyTeamColorsToMesh(building.mesh, teamColor);
      }
      
      // Mark as complete
      building.needsMeshSetup = false;
    }
    
    // TF2-style capture point visual indicators for Agoras
    if (building.type === 'agora' && building.mesh) {
      updateCapturePointVisuals(building);
    }
    
    // Handle villager spawning for villages (only if game is running OR in menu scene for testing)
    // CRITICAL: Only spawn villagers after completion is processed (synchronized across all peers)
    // This ensures villagers spawn at the same time on all clients
    const isGameActive = (window.currentMatch && window.currentMatch.state === 'playing') || window.game;
    if (building.spawnsVillagers && building.completionProcessed && isGameActive) {
      spawnVillagerFromVillage(building);
    }
    
    // Handle construction progress for buildings being built
    if (building.needsWorkers && building.workType === 'build' && building.buildProgress < 1.0 && (window.game || window.currentMatch)) {
      const currentTick = window.currentMatch?.tick || 0;
      const workerCount = getEffectiveAssignedWorkerCount(building);
      
      // Debug: Log construction state periodically
      if (currentTick % 100 === 0 && currentTick > 0) {
        // console.log(`🔨 Building ${building.type} (${building.id?.slice(-6)}): progress=${(building.buildProgress * 100).toFixed(1)}%, workers=${workerCount}, workTicks=${building.constructionWorkTicks}`);
      }
      
      // Create/update construction indicator cube (purple cube for all buildings under construction)
      if (!building.constructionIndicator && window.gfx && window.gfx.scene) {
        building.constructionIndicator = BABYLON.MeshBuilder.CreateBox(`constructionIndicator_${building.id}`, {
          size: 1.0  // Will be scaled to 0.5 (half size)
        }, window.gfx.scene);
        building.constructionIndicator.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5); // Half size
        building.constructionIndicator.isPickable = true;
        building.constructionIndicator.isBuilding = true;
        building.constructionIndicator.metadata = {
          ...(building.constructionIndicator.metadata || {}),
          buildingId: building.id
        };
        
        // Purple material
        const material = new BABYLON.StandardMaterial(`constructionIndicatorMat_${building.id}`, window.gfx.scene);
        material.diffuseColor = new BABYLON.Color3(0.67, 0, 1); // Purple (#aa00ff)
        material.emissiveColor = new BABYLON.Color3(0.33, 0, 0.5);
        material.alpha = 1.0;
        building.constructionIndicator.material = material;
      }
      
      // Update indicator position (above building)
      if (building.constructionIndicator && building.position) {
        const terrainY = window.getTerrainHeightAtPosition ? 
          window.getTerrainHeightAtPosition(building.position.x, building.position.z) : building.position.y || 0;
        building.constructionIndicator.position.x = building.position.x;
        building.constructionIndicator.position.z = building.position.z;
        building.constructionIndicator.position.y = terrainY + 3; // Above building
        building.constructionIndicator.setEnabled(true);
      }
      
      // Progress construction based on workers who are actually AT the building
      // CRITICAL: Only count workers within work range - prevents progress when they're still walking there
      const TILE_SIZE = window.TILE_SIZE || 4;
      const workRange = TILE_SIZE * 2; // 2 tiles - must be at the site to contribute
      const workersAtSite = building.position
        ? Math.min(building.maxWorkers || Infinity, building.assignedWorkers.filter(w => isConstructionWorkerAtSite(w, building)).length)
        : 0;
      
      if (workersAtSite > 0) {
        // CRITICAL: Track construction start tick on first work tick
        if (building.constructionStartTick === 0) {
          building.constructionStartTick = currentTick;
        }
        
        // CRITICAL: Only accumulate work ticks once per game tick, not every physics frame
        // This ensures deterministic construction progress across all clients
        // Check if we've already processed this tick
        if (building.lastConstructionTick !== currentTick) {
          building.lastConstructionTick = currentTick;
          // Accumulate work ticks (each worker AT SITE contributes 1 tick per game tick)
          const oldWorkTicks = building.constructionWorkTicks;
          building.constructionWorkTicks += workersAtSite;
          
          // Construction progress tracked silently for multiplayer sync
        }
        
        // Calculate progress deterministically from total work ticks
        // With 3 workers at 20 TPS: 3 worker-ticks per game tick
        // Target: ~100 ticks to complete = 300 total worker-ticks (100 ticks * 3 workers)
        const TOTAL_WORKER_TICKS_NEEDED = 300; // ~5 seconds with 3 workers at 20 TPS (100 ticks / 20 = 5 sec)
        building.buildProgress = Math.min(1.0, building.constructionWorkTicks / TOTAL_WORKER_TICKS_NEEDED);
        
        // Update building visual state based on progress
        if (building.mesh) {
          // Scale building based on progress (starts small, grows to full size)
          const baseScale = building.scale || 1.0;
          const progressScale = 0.1 + (building.buildProgress * 0.9); // Scale from 10% to 100%
          building.mesh.scaling.x = baseScale * progressScale;
          building.mesh.scaling.y = baseScale * progressScale;
          building.mesh.scaling.z = baseScale * progressScale;
          
          // Update position based on progress (rise from half height to full height)
          const baseTerrainY = building.position.y || 0;
          const finalTerrainY = baseTerrainY;
          const halfHeight = baseTerrainY - 1; // Start at half height (visible above ground)
          building.mesh.position.y = halfHeight + (finalTerrainY - halfHeight) * building.buildProgress;
        }
        
        // When construction completes, send synchronized completion event
        // CRITICAL: Only process completion once, and synchronize across all peers
        if (building.buildProgress >= 1.0 && !building.completionProcessed) {
          building.buildProgress = 1.0; // Clamp to 1.0

          // CRITICAL: Send building_complete command to synchronize completion across all peers
          // Schedule completion for the next sync checkpoint to ensure all clients process at the same tick
          if (window.isMultiplayer && window.currentMatch && !building.completionCommandSent) {
            const currentTick = window.currentMatch.tick;
            const syncInterval = window.currentMatch.syncInterval || 100;
            // Schedule for the next sync checkpoint (round up to next interval)
            // This ensures all clients process completion at the same predictable checkpoint
            const completionTick = Math.ceil((currentTick + 1) / syncInterval) * syncInterval;
            
            window.currentMatch.submitCommand({
              type: 'building_complete',
              playerId: building.owner,
              buildingId: building.id,
              tick: completionTick // Schedule for sync checkpoint
            });
            building.completionCommandSent = true;
          } else {
            // Single-player: process immediately
            processBuildingCompletion(building);
          }
        }
      }
    } else if (building.completionProcessed && building.constructionIndicator) {
      // Building is complete - hide indicator
      building.constructionIndicator.setEnabled(false);
      building.constructionIndicator.dispose();
      building.constructionIndicator = null;
    }
    
    // Handle work assignment for buildings that need workers (both construction and production)
    // CRITICAL: Must be FULLY deterministic in P2P multiplayer!
    // Only check every N ticks to ensure both clients check at same time
    const currentTick = window.currentMatch?.tick || 0;
    const tickRate = 20; // Match net.TICK_RATE
    const shouldCheckThisTick = (currentTick % tickRate === 0); // Check every 20 ticks (1 second at 20Hz)
    
    // Only enter production after the synchronized completion event flips workType.
    const canAssignConstructionWorkers = building.workType === 'build' && building.buildProgress < 1.0;
    const canAssignProductionWorkers = building.completionProcessed && building.workType !== 'build';
    const shouldAssignWorkers = building.needsWorkers && (window.game || window.currentMatch) && shouldCheckThisTick && 
      (canAssignConstructionWorkers || canAssignProductionWorkers);
    
    if (shouldAssignWorkers && (building.lastWorkerCheckTick ?? -1) !== currentTick) {
      building.lastWorkerCheckTick = currentTick;
      
      // Clean up any workers that are no longer valid
      building.assignedWorkers = building.assignedWorkers.filter(worker => {
        if (!worker || !window.gameUnits.includes(worker)) {
          return false; // Remove invalid workers
        }
        
        // Check if worker still has work behavior for this building
        const behavior = window.behaviorManager ? window.behaviorManager.getBehavior(worker) : null;
        if (!behavior || !behavior.building || behavior.building !== building) {
          worker.assignedBuilding = null;
          return false; // Remove workers no longer working here
        }
        
        // NOTE: Resource checking moved to GatherWorkBehavior - workers dynamically find resources
        // No longer using building.availableResources pre-scanned list
        
        return true; // Keep valid workers
      });
      
      // Try to assign more workers if needed using the synchronized worker cap.
      const maxWorkersForThisState = building.maxWorkers;
      
      const effectiveAssignedWorkers = getEffectiveAssignedWorkerCount(building);
      let assignedWorkerSlots = getAssignedWorkerSlotCount(building);
      if (assignedWorkerSlots < maxWorkersForThisState) {
        const idleVillagers = findIdleVillagersNearBuilding(building);
        
        if (building.workType === 'build' && building.buildProgress < 1.0 && currentTick % 100 === 0) {
          console.log(`👷 Construction ${building.type} (${building.id?.slice(-6)}): ${idleVillagers.length} idle nearby, activeAssigned=${effectiveAssignedWorkers}/${maxWorkersForThisState}, totalAssigned=${building.assignedWorkers.length}, progress=${(building.buildProgress*100).toFixed(0)}%, owner=${building.owner}`);
        }
        
        
        for (const villager of idleVillagers) {
          if (assignedWorkerSlots >= maxWorkersForThisState) break;
          
          // Check if villager is already assigned to a building
          if (villager.assignedBuilding) {
            continue; // Already assigned elsewhere
          }
          
          // DIAGNOSTIC: Verify ownership matches before assigning
          const normalizedUnitOwner = villager.owner?.length > 6 ? villager.owner.slice(-6) : villager.owner;
          const normalizedBuildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
          if (normalizedUnitOwner !== normalizedBuildingOwner) {
            console.warn(`⚠️ Ownership mismatch! Worker ${villager.id} (owner: ${normalizedUnitOwner}) cannot work on building ${building.id} (owner: ${normalizedBuildingOwner})`);
            continue;
          }
          
          if (assignVillagerToWork(villager, building)) {
            assignedWorkerSlots++;
          }
        }
      }
    }
    
    // CRITICAL: Process work production every frame for production buildings
    // This must be separate from worker assignment to ensure deterministic timing
    // Worker assignment only happens every 60 ticks, but production should check every frame
    if (building.completionProcessed && building.workType !== 'build' && building.needsWorkers && building.assignedWorkers.length > 0 && (window.game || window.currentMatch)) {
      processWorkProduction(building);
    }
    
    // Handle tower attacks
    if (building.type === 'tower' && building.completionProcessed && isGameActive) {
      updateTowerAttack(building, deltaTime);
    }
  });
}

// Auto-initialize menu scene terrain when scene is ready
function autoInitBuildings() {
  // Menu scene: Load terrain around default camera position, but NO units/buildings
  // Units and buildings only spawn when a match actually starts
  
  const sceneReady = window.gfx && window.gfx.scene && window.liveField;
  
  if (!sceneReady) {
    setTimeout(autoInitBuildings, 1000);
    return;
  }
  
  // Load terrain chunks around the camera's starting position
  if (window.gfx.cameraTarget) {
    const cameraPos = window.gfx.cameraTarget.position;
    window.liveField.updateVisibleChunks(cameraPos.x, cameraPos.z);
    // console.log(`🗺️ Menu scene: Loading terrain at (${cameraPos.x.toFixed(1)}, ${cameraPos.z.toFixed(1)})`);
  }
}

// Vertical fence ring for work radius (same plane/scaling pattern as lasso.js 3D selection fence)
const WORK_RADIUS_FENCE_HEIGHT = 1.25;

function createWorkRadiusFenceMaterial(scene, matName) {
  const mat = new BABYLON.StandardMaterial(matName, scene);
  mat.emissiveColor = new BABYLON.Color3(0, 1, 1);
  mat.diffuseColor = new BABYLON.Color3(0, 1, 1);
  mat.alpha = 0.8;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  return mat;
}

function buildOrUpdateWorkRadiusFencePanels(panels, scene, centerX, centerZ, terrainY, radiusWorld, material, namePrefix) {
  const NUM_SEGMENTS = Math.min(48, Math.max(16, Math.ceil(radiusWorld / 1.5)));
  const glow = window.gfx && window.gfx.glowLayer;

  while (panels.length > NUM_SEGMENTS) {
    const p = panels.pop();
    if (p && !p.isDisposed()) {
      if (glow) glow.removeIncludedOnlyMesh(p);
      p.dispose();
    }
  }

  for (let i = 0; i < NUM_SEGMENTS; i++) {
    const t1 = (i / NUM_SEGMENTS) * Math.PI * 2;
    const t2 = ((i + 1) / NUM_SEGMENTS) * Math.PI * 2;
    const p1x = Math.cos(t1) * radiusWorld;
    const p1z = Math.sin(t1) * radiusWorld;
    const p2x = Math.cos(t2) * radiusWorld;
    const p2z = Math.sin(t2) * radiusWorld;
    const dx = p2x - p1x;
    const dz = p2z - p1z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const lx = (p1x + p2x) / 2;
    const lz = (p1z + p2z) / 2;

    let panel = panels[i];
    if (!panel || panel.isDisposed()) {
      panel = BABYLON.MeshBuilder.CreatePlane(`${namePrefix}_${i}`, { width: 1, height: 1 }, scene);
      panel.material = material;
      panel.isPickable = false;
      panel.receiveShadows = false;
      panel.renderingGroupId = 0;
      if (glow) glow.addIncludedOnlyMesh(panel);
      panels[i] = panel;
    }

    panel.position.x = centerX + lx;
    panel.position.y = terrainY + WORK_RADIUS_FENCE_HEIGHT / 2;
    panel.position.z = centerZ + lz;
    panel.scaling.x = Math.max(length, 0.01);
    panel.scaling.y = WORK_RADIUS_FENCE_HEIGHT;
    panel.rotation.x = 0;
    panel.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    panel.isVisible = true;
  }
  return panels;
}

function disposeWorkRadiusFencePanels(panels, material) {
  const glow = window.gfx && window.gfx.glowLayer;
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    if (p && !p.isDisposed()) {
      if (glow) glow.removeIncludedOnlyMesh(p);
      p.dispose();
    }
  }
  panels.length = 0;
  if (material && typeof material.dispose === 'function') {
    if (typeof material.isDisposed !== 'function' || !material.isDisposed()) {
      material.dispose();
    }
  }
}

// Building Placement System
const buildingSystem = {
  isPlacing: false,
  selectedBuildingType: null,
  previewMesh: null,
  placementRotation: 0,
  lastValidPosition: null,
  lastValidRotation: null,
  radiusVisualization: null, // For showing camp work radius
  resourceIndicators: [], // For showing trees/rocks within radius
  highlightedTiles: [], // For tracking highlighted terrain tiles
  
  // Start building placement mode
  selectBuilding: function(buildingType) {
    // console.log(`🏗️ selectBuilding called with: ${buildingType}`);
    // console.log(`🏗️ BuildingTypes available:`, Object.keys(BuildingTypes));
    
    if (!BuildingTypes[buildingType]) {
      // console.error(`Unknown building type: ${buildingType}`);
      return;
    }
    
    // Close the radial menu when starting placement
    if (window.hud && typeof window.hud.hideRadialMenu === 'function') {
      window.hud.hideRadialMenu();
      console.log('🏗️ Closed radial menu when starting building placement');
    }
    
    // CRITICAL: Dispose old preview mesh before creating new one!
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    
    this.isPlacing = true;
    this.selectedBuildingType = buildingType;
    this.placementRotation = 0;
    
    // console.log(`🏗️ Building placement mode activated for: ${buildingType}`);
    
    // Create preview mesh
    this.createPreviewMesh();
    
    // Enable placement mode
    this.enablePlacementMode();
  },
  
  // Create a preview mesh for the building
  createPreviewMesh: function(initialPosition = null) {
    if (!window.gfx || !window.gfx.scene) {
      // console.error('Graphics system not available for preview');
      return;
    }
    
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef) {
      // console.error('Building definition not found for:', this.selectedBuildingType);
      return;
    }
    
    // console.log('🏗️ Creating preview for building:', buildingDef.name);
    
    // Load the actual model
    window.gfx.getModel(buildingDef.model, window.gfx.scene).then(model => {
      this.previewMesh = model.root;
      
      // CRITICAL: Ensure preview mesh is visible!
      if (typeof this.previewMesh.setEnabled === 'function') {
        this.previewMesh.setEnabled(true);
      }
      
      // Mark as preview so it doesn't get culled by LOD system
      this.previewMesh.metadata = this.previewMesh.metadata || {};
      this.previewMesh.metadata.isPreview = true;
      
      // Enable all child meshes that are actual meshes (not transform nodes)
      this.previewMesh.getChildMeshes().forEach(child => {
        // Only enable if it has BOTH setEnabled AND isEnabled FUNCTION
        if (typeof child.setEnabled === 'function' && typeof child.isEnabled === 'function') {
          child.setEnabled(true);
        }
      });
      
      // Force Euler angles for rotation
      this.previewMesh.rotationQuaternion = null;
      
      // Apply building scale
      this.previewMesh.scaling = new BABYLON.Vector3(
        buildingDef.scale,
        buildingDef.scale,
        buildingDef.scale
      );
      
      // Create preview material
      const previewMaterial = new BABYLON.StandardMaterial('previewMaterial', window.gfx.scene);
      previewMaterial.diffuseColor = new BABYLON.Color3(0, 1, 0);
      previewMaterial.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
      previewMaterial.alpha = 1.0;
      
      // Keep child meshes' original rotations but update materials
      this.previewMesh.getChildMeshes().forEach(mesh => {
        mesh.material = previewMaterial;
        mesh.isPickable = false;
        // Preserve original rotations
        if (mesh.rotationQuaternion) {
          const quaternion = mesh.rotationQuaternion.clone();
          mesh.rotationQuaternion = null;
          mesh.rotation = quaternion.toEulerAngles();
        }
      });
      
      // Only set rotation mode on the root mesh
      this.previewMesh.rotationQuaternion = null;
      this.previewMesh.isPickable = false;
      
      // Set initial rotation (will be updated with deterministic rotation based on position)
      this.placementRotation = 0;
      this.previewMesh.rotation.y = 0;
      
      // Position it at the provided position or current mouse position
      if (initialPosition) {
        this.previewMesh.position = initialPosition.clone();
        // Get terrain height (triangular interpolation matches GPU rendering)
        const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(initialPosition.x, initialPosition.z) : 0;
        this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
        
        // Calculate deterministic rotation based on grid position (8 cardinal directions)
        const TILE_SIZE = window.TILE_SIZE || 4;
        const gx = Math.round(initialPosition.x / TILE_SIZE);
        const gz = Math.round(initialPosition.z / TILE_SIZE);
        const mapSeed = (window.liveField?.seed) || (window.currentMatch?.mapSeed) || 12345;
        let rotHash = mapSeed + gx * 73856093 + gz * 19349663;
        rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
        rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
        rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
        const rotationIndex = rotHash % 8; // 8 directions
        const rotation = rotationIndex * Math.PI / 4;
        this.previewMesh.rotation.y = rotation;
      } else {
        // Try to get current mouse position
        const pickResult = window.gfx.scene.pick(
          window.gfx.scene.pointerX,
          window.gfx.scene.pointerY
        );
        
        if (pickResult.hit && pickResult.pickedPoint) {
          this.previewMesh.position = pickResult.pickedPoint.clone();
          // Get terrain height (triangular interpolation matches GPU rendering)
          const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(pickResult.pickedPoint.x, pickResult.pickedPoint.z) : 0;
          this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
          
          // Calculate deterministic rotation based on grid position (8 cardinal directions)
          const TILE_SIZE = window.TILE_SIZE || 4;
          const gx = Math.round(pickResult.pickedPoint.x / TILE_SIZE);
          const gz = Math.round(pickResult.pickedPoint.z / TILE_SIZE);
          const mapSeed = (window.liveField?.seed) || (window.currentMatch?.mapSeed) || 12345;
          let rotHash = mapSeed + gx * 73856093 + gz * 19349663;
          rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
          rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
          rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
          const rotationIndex = rotHash % 8; // 8 directions
          const rotation = rotationIndex * Math.PI / 4;
          this.previewMesh.rotation.y = rotation;
        } else if (window.gfx.cameraTarget) {
          // Fallback to camera target
          this.previewMesh.position = window.gfx.cameraTarget.position.clone();
          // Get terrain height (triangular interpolation matches GPU rendering)
          const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(this.previewMesh.position.x, this.previewMesh.position.z) : 0;
          this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
          
          // Calculate deterministic rotation (8 cardinal directions)
          const TILE_SIZE = window.TILE_SIZE || 4;
          const gx = Math.round(this.previewMesh.position.x / TILE_SIZE);
          const gz = Math.round(this.previewMesh.position.z / TILE_SIZE);
          const mapSeed = (window.liveField?.seed) || (window.currentMatch?.mapSeed) || 12345;
          let rotHash = mapSeed + gx * 73856093 + gz * 19349663;
          rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
          rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
          rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
          const rotationIndex = rotHash % 8; // 8 directions
          const rotation = rotationIndex * Math.PI / 4;
          this.previewMesh.rotation.y = rotation;
        } else {
          // Last resort fallback
          this.previewMesh.position = new BABYLON.Vector3(0, 0.25, 0);
          this.previewMesh.rotation.y = 0;
        }
      }
      
      // Create radius visualization for camp
      if (this.selectedBuildingType === 'camp') {
        this.createRadiusVisualization(this.previewMesh.position);
      }
      
    }).catch(err => {
      // console.error('Failed to create preview mesh:', err);
    });
    
    // Return early since we're handling positioning in the promise
    return;

    
    // console.log('✅ Building preview created at position:', this.previewMesh.position);
  },
  
  // Create radius visualization for camp work area
  createRadiusVisualization: function(centerPosition) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Clean up existing visualization
    this.clearRadiusVisualization();
    
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef) return;
    
    // Show workRadius (worker recruitment radius) for all buildings
    const radius = buildingDef.workRadius ? buildingDef.workRadius * TILE_SIZE : 0;
    
    if (radius === 0) return;
    
    const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(centerPosition.x, centerPosition.z) : 0;
    const material = createWorkRadiusFenceMaterial(window.gfx.scene, 'workRadiusFenceMat');
    const panels = [];
    buildOrUpdateWorkRadiusFencePanels(
      panels,
      window.gfx.scene,
      centerPosition.x,
      centerPosition.z,
      terrainY,
      radius,
      material,
      'workRadiusFence'
    );
    this.radiusVisualization = { panels, material };
    
    // NOTE: No longer scanning/highlighting resources - villagers find them dynamically
  },
  
  // Clear radius visualization
  clearRadiusVisualization: function() {
    if (this.radiusVisualization) {
      const vis = this.radiusVisualization;
      if (vis.panels && Array.isArray(vis.panels)) {
        disposeWorkRadiusFencePanels(vis.panels, vis.material);
      } else if (typeof vis.dispose === 'function') {
        vis.dispose();
      }
      this.radiusVisualization = null;
    }
    
    // Clear resource indicators
    this.resourceIndicators.forEach(indicator => {
      if (indicator && indicator.dispose) {
        indicator.dispose();
      }
    });
    this.resourceIndicators = [];
    
    // Clear highlighted tiles
    this.highlightedTiles.forEach(highlight => {
      if (highlight && highlight.dispose) {
        highlight.dispose();
      }
    });
    this.highlightedTiles = [];
    
    // Clean up shared materials
    if (this.woodIndicatorMaterial) {
      this.woodIndicatorMaterial.dispose();
      this.woodIndicatorMaterial = null;
    }
    if (this.stoneIndicatorMaterial) {
      this.stoneIndicatorMaterial.dispose();
      this.stoneIndicatorMaterial = null;
    }
    if (this.woodTileMaterial) {
      this.woodTileMaterial.dispose();
      this.woodTileMaterial = null;
    }
    if (this.stoneTileMaterial) {
      this.stoneTileMaterial.dispose();
      this.stoneTileMaterial = null;
    }
  },
  
  // Update radius visualization position
  updateRadiusVisualization: function(newPosition) {
    if (!this.radiusVisualization || !this.radiusVisualization.panels || this.selectedBuildingType !== 'camp') {
      return;
    }
    const buildingDef = BuildingTypes[this.selectedBuildingType];
    if (!buildingDef || !buildingDef.workRadius) return;
    const r = buildingDef.workRadius * TILE_SIZE;
    const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(newPosition.x, newPosition.z) : 0;
    buildOrUpdateWorkRadiusFencePanels(
      this.radiusVisualization.panels,
      window.gfx.scene,
      newPosition.x,
      newPosition.z,
      terrainY,
      r,
      this.radiusVisualization.material,
      'workRadiusFence'
    );
  },
  
  // Highlight resources (trees and rocks) within the camp's work radius
  highlightResourcesInRadius: function(centerPosition, radius) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Clear existing indicators
    this.resourceIndicators.forEach(indicator => {
      if (indicator && indicator.dispose) {
        indicator.dispose();
      }
    });
    this.resourceIndicators = [];
    
    // Clear existing resource data
    this.detectedResources = [];
    
    // Get the field system to check for resources
    if (!window.liveField) {
      console.warn('⚠️ Cannot detect resources: window.liveField is not available!');
      return;
    }
    
    // Convert world position to grid coordinates
    const gridX = Math.floor(centerPosition.x / TILE_SIZE);
    const gridZ = Math.floor(centerPosition.z / TILE_SIZE);
    const gridRadius = Math.ceil(radius / TILE_SIZE);
    
    // Count resources within the radius
    let resourceCount = 0;
    let tilesChecked = 0;
    let tileTypesSeen = {};
    
    // Check tiles within the radius
    for (let x = gridX - gridRadius; x <= gridX + gridRadius; x++) {
      for (let z = gridZ - gridRadius; z <= gridZ + gridRadius; z++) {
        // BOUNDS CHECK: Skip tiles outside the map
        if (!window.liveField || x < 0 || z < 0 || 
            x >= window.liveField.width || z >= window.liveField.height) {
          continue;
        }
        
        // Check if this tile is within the radius
        const worldX = x * TILE_SIZE;
        const worldZ = z * TILE_SIZE;
        const distance = Math.sqrt(
          Math.pow(worldX - centerPosition.x, 2) + 
          Math.pow(worldZ - centerPosition.z, 2)
        );
        
        if (distance <= radius) {
          tilesChecked++;
          
          // Track tile types for diagnostic purposes
          const tile = window.liveField.getTile(x, z);
          if (tile) {
            tileTypesSeen[tile.type] = (tileTypesSeen[tile.type] || 0) + 1;
          }
          
          // Check if this tile has resources (trees or rocks)
          // CRITICAL: Ignore depletion for UI preview to show potential resources
          const resourceInfo = this.checkTileForResources(x, z, true);
          if (resourceInfo) {
            // Store resource data for saving later
            this.detectedResources.push({
              gridX: x,
              gridZ: z,
              worldX: worldX,
              worldZ: worldZ,
              type: resourceInfo.type,
              amount: resourceInfo.amount,
              remaining: resourceInfo.remaining // CRITICAL: Track remaining for depletion
            });
            
            resourceCount++;
          }
        }
      }
    }
    
    // DIAGNOSTIC: Log tile types and resource count (occasionally to avoid spam)
    // if (tilesChecked > 0 && Math.random() < 0.05) {
    //   console.log(`🔍 Resource detection at (${gridX}, ${gridZ}): checked ${tilesChecked} tiles, found ${resourceCount} resources. Tile types:`, tileTypesSeen);
    // }
    
    // Update circle color based on resource density
    this.updateCircleColor(resourceCount);
    
    // console.log(`🌳 Found ${resourceCount} resource tiles within camp radius`);
  },
  
  // Update circle color based on resource density
  updateCircleColor: function(resourceCount) {
    if (!this.radiusVisualization) return;
    
    // Calculate resource density (0-1 scale)
    const maxResources = 20; // Maximum expected resources in radius
    const density = Math.min(resourceCount / maxResources, 1.0);
    
    // Create color based on density
    let color, emissiveColor, alpha;
    
    if (resourceCount === 0) {
      // No resources - red
      color = new BABYLON.Color3(0.8, 0.2, 0.2); // Red
      emissiveColor = new BABYLON.Color3(0.2, 0.05, 0.05);
    } else if (resourceCount < 4) {
      // Good resources - light green
      color = new BABYLON.Color3(0.2, 0.6, 0.2); // Light green
      emissiveColor = new BABYLON.Color3(0.05, 0.15, 0.05);
    } else if (resourceCount < 7) {
      // Many resources - bright green
      color = new BABYLON.Color3(0.2, 0.6, 0.2); // Light green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
    } else if (resourceCount < 10) {
      // Many resources - bright green
      color = new BABYLON.Color3(0.1, 0.8, 0.1); // Bright green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
    } else {
      // Many resources - bright green
      color = new BABYLON.Color3(0.1, 0.8, 0.1); // Bright green
      emissiveColor = new BABYLON.Color3(0.05, 0.3, 0.05);
    }
    alpha = 1.0; // Opaque for performance
    
    // Update the circle material
    if (this.radiusVisualization.material) {
      this.radiusVisualization.material.diffuseColor = color;
      this.radiusVisualization.material.emissiveColor = emissiveColor;
      this.radiusVisualization.material.alpha = alpha;
    }
    
    // console.log(`🎨 Circle color updated: ${resourceCount} resources, density: ${density.toFixed(2)}, alpha: ${alpha}`);
  },
  
  // CRITICAL: Use EXACT same logic as gfx.js placeDecorationsOnChunk()
  // This ensures we detect the same resources that actually exist in the scene
  tileHash: function(x, y, seed) {
    let hash = seed;
    hash = hash ^ (x * 374761393);
    hash = hash ^ (y * 668265263);
    hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
    hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
    hash = hash ^ (hash >>> 16);
    return Math.abs(hash >>> 0) / 4294967296; // 0-1
  },
  
  // Check if a tile contains resources (trees or rocks)
  // MUST match the exact logic in gfx.js placeDecorationsOnChunk()
  // CRITICAL: ignoreDepletion - when true, detects resources even if depleted (for new camp detection)
  // This ensures deterministic resource detection for new camps regardless of depletion state
  checkTileForResources: function(gridX, gridZ, ignoreDepletion = false) {
    if (!window.liveField) return null;
    
    // CRITICAL: Validate bounds first - resources can only exist on valid tiles
    // This prevents resources from being detected outside the map boundaries
    if (gridX < 0 || gridX >= window.liveField.width || 
        gridZ < 0 || gridZ >= window.liveField.height) {
      return null;
    }
    
    // CRITICAL: Also check chunk mask if available (for custom map shapes)
    if (window.liveField.chunkMask && window.liveField.chunkSize) {
      const chunkX = Math.floor(gridX / window.liveField.chunkSize);
      const chunkZ = Math.floor(gridZ / window.liveField.chunkSize);
      if (window.liveField.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
        return null; // Tile is in a disabled chunk (off the table)
      }
    }
    
    const fieldSeed = window.liveField.seed;
    const terrainIndex = gridZ * window.liveField.width + gridX;
    const terrainType = window.liveField.terrainTypes[terrainIndex];
    
    if (!terrainType && terrainType !== 0) return null;
    
    // Skip spawn zones (same as gfx.js)
    if (window.liveField.isInSpawnZone && window.liveField.isInSpawnZone(gridX, gridZ)) {
      return null;
    }
    
    // CRITICAL: Only skip depleted resources if ignoreDepletion is false
    // When detecting resources for a NEW camp, ignore depletion state to ensure deterministic detection
    // Depletion state can differ between clients due to timing differences in worker gathering
    if (!ignoreDepletion) {
      const tileKey = `${gridX},${gridZ}`;
      if (window.isResourceTileDepleted && window.isResourceTileDepleted(gridX, gridZ)) {
        return null; // Don't detect depleted resources (for existing camps)
      }
    }
    
    // CHECK 1: Rocks on dirt tiles (terrainType === 2) with ~3% chance
    // gfx.js PASS 1 only places rocks on dirt - no rocks are placed on grass visually
    if (terrainType === 2) {
      const rockRoll = this.tileHash(gridX, gridZ, fieldSeed + 1000);
      if (rockRoll < 0.03) {
        // Determine rock size - must use REGION coordinates to match gfx.js
        // gfx.js uses 5x5 tile regions for cohesive rock size clusters
        const regionX = Math.floor(gridX / 5);
        const regionZ = Math.floor(gridZ / 5);
        const sizeRoll = this.tileHash(regionX, regionZ, fieldSeed + 2000);
        
        if (sizeRoll < 0.3) {
          // Small rocks (30%) → gems/minerals
          return this._applyRemainingOverride({
            type: 'minerals',
            amount: 1,
            remaining: 12,
            gridX: gridX,
            gridZ: gridZ
          }, ignoreDepletion);
        } else if (sizeRoll < 0.7) {
          // Medium rocks (40%) → stone
          return this._applyRemainingOverride({
            type: 'stone',
            amount: 4,
            remaining: 56,
            gridX: gridX,
            gridZ: gridZ
          }, ignoreDepletion);
        } else {
          // Large rocks (30%) → more stone
          return this._applyRemainingOverride({
            type: 'stone',
            amount: 6,
            remaining: 84,
            gridX: gridX,
            gridZ: gridZ
          }, ignoreDepletion);
        }
      }
    }
    
    // CHECK 2: Trees on grass (type 3) and dirt (type 2) - must match gfx.js PASS 2
    // gfx.js places trees on both grass (20%) and dirt (5%), skip water (type 1)
    if (terrainType === 3 || terrainType === 2) {
      // On dirt, rocks are checked first (CHECK 1 above) and would have returned already
      // so any dirt tile reaching here has no rock - same as gfx.js which skips occupied tiles
      const treeSpawnRate = terrainType === 3 ? 0.20 : 0.05;
      const treeRoll = this.tileHash(gridX, gridZ, fieldSeed + 3000);
      if (treeRoll < treeSpawnRate) {
        const result = {
          type: 'wood',
          amount: 7,
          remaining: 28,
          gridX: gridX,
          gridZ: gridZ
        };
        return this._applyRemainingOverride(result, ignoreDepletion);
      }
    }
    
    return null;
  },

  _applyRemainingOverride: function(result, ignoreDepletion) {
    if (ignoreDepletion) return result;
    const tracker = window.currentMatch?.resourceRemaining;
    if (tracker) {
      const key = `${result.gridX},${result.gridZ}`;
      if (tracker.has(key)) {
        result.remaining = tracker.get(key);
        if (result.remaining <= 0) return null;
      }
    }
    return result;
  },
  
  // Create a visual indicator for a resource tile
  createResourceIndicator: function(worldX, worldZ, resourceType) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Create a small glowing sphere to indicate resources (smaller for performance)
    const indicator = BABYLON.MeshBuilder.CreateSphere("resourceIndicator", {
      diameter: 0.3 // Smaller size
    }, window.gfx.scene);
    
    indicator.position = new BABYLON.Vector3(worldX, 0.2, worldZ);
    
    // Create material based on resource type
    let material;
    if (resourceType === 'wood') {
      if (!this.woodIndicatorMaterial) {
        this.woodIndicatorMaterial = new BABYLON.StandardMaterial("woodIndicatorMaterial", window.gfx.scene);
        this.woodIndicatorMaterial.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2); // Green for wood
        this.woodIndicatorMaterial.emissiveColor = new BABYLON.Color3(0.1, 0.4, 0.1);
        this.woodIndicatorMaterial.alpha = 0.7;
      }
      material = this.woodIndicatorMaterial;
    } else if (resourceType === 'stone') {
      if (!this.stoneIndicatorMaterial) {
        this.stoneIndicatorMaterial = new BABYLON.StandardMaterial("stoneIndicatorMaterial", window.gfx.scene);
        this.stoneIndicatorMaterial.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6); // Gray for stone
        this.stoneIndicatorMaterial.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);
        this.stoneIndicatorMaterial.alpha = 0.7;
      }
      material = this.stoneIndicatorMaterial;
    }
    
    indicator.material = material;
    indicator.isPickable = false;
    
    this.resourceIndicators.push(indicator);
  },
  
  
  // Enable placement mode with mouse tracking
  enablePlacementMode: function() {
    // Track when placement mode was activated to prevent immediate placement from button click
    this.placementModeActivatedAt = Date.now();
    
    // Add mouse move handler for preview positioning
    this.mouseMoveHandler = (e) => {
      if (!this.isPlacing) return;
      if (!this.previewMesh) {
        // Preview mesh not loaded yet - this is normal during loading
        return;
      }
      
      try {
        // Get world position from mouse
        const pickResult = window.gfx.scene.pick(e.clientX, e.clientY);
        if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.name && pickResult.pickedMesh.name.includes('Mesh')) {
          const worldPos = pickResult.pickedPoint;
          
          // Snap to grid
          const gridX = Math.round(worldPos.x / TILE_SIZE) * TILE_SIZE;
          const gridZ = Math.round(worldPos.z / TILE_SIZE) * TILE_SIZE;
          
          // Only update if grid position changed (avoids redundant calculations)
          if (this.previewMesh.position.x !== gridX || this.previewMesh.position.z !== gridZ) {
            // Get terrain height at this position using bilinear interpolation
            const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(gridX, gridZ) : 0;
            
            // Update preview position
            this.previewMesh.position.x = gridX;
            this.previewMesh.position.z = gridZ;
            this.previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
            
            // Calculate deterministic rotation based on grid position (8 cardinal directions)
            const gx = Math.round(worldPos.x / TILE_SIZE);
            const gz = Math.round(worldPos.z / TILE_SIZE);
            const mapSeed = (window.liveField?.seed) || (window.currentMatch?.mapSeed) || 12345;
            let rotHash = mapSeed + gx * 73856093 + gz * 19349663;
            rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
            rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
            rotHash = (rotHash * 1664525 + 1013904223) >>> 0;
            const rotationIndex = rotHash % 8;
            const rotation = rotationIndex * Math.PI / 4;
            
            console.log(`👻 Preview (mouse): pos=(${gx},${gz}), idx=${rotationIndex}, rotation=${(rotation*180/Math.PI).toFixed(0)}°`);
            
            // CRITICAL: Clear rotationQuaternion so rotation.y works
            this.previewMesh.rotationQuaternion = null;
            this.previewMesh.rotation.y = rotation;
          }
          
          // Update radius visualization for camp
          if (this.selectedBuildingType === 'camp') {
            this.updateRadiusVisualization(this.previewMesh.position);
          }
          
          // Check if position is valid and update preview color
          this.updatePreviewValidity(gridX / TILE_SIZE, gridZ / TILE_SIZE);
        }
      } catch (error) {
        // console.warn('Error in mouse move handler:', error);
      }
    };
    
    // Add click handlers for placement and cancel
    this.clickHandler = (e) => {
      if (!this.isPlacing || !this.previewMesh) return;
      
      // Ignore clicks within 100ms of activating placement mode (prevents button click from placing)
      const timeSinceActivation = Date.now() - (this.placementModeActivatedAt || 0);
      if (timeSinceActivation < 100) {
        console.log('🏗️ Ignoring click - too soon after activating placement mode');
        return;
      }
      
      // Right click to cancel
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelPlacement();
        return;
      }
      
      // Only handle left clicks for placement
      if (e.button !== 0) return;
      
      try {
        // Get world position from mouse
        const pickResult = window.gfx.scene.pick(e.clientX, e.clientY);
        
        if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.name && pickResult.pickedMesh.name.includes('Mesh')) {
          const worldPos = pickResult.pickedPoint;
          
          // Snap to grid
          const gridX = Math.round(worldPos.x / TILE_SIZE);
          const gridZ = Math.round(worldPos.z / TILE_SIZE);
          
          // Place the building
          const placed = this.placeBuildingAt(gridX, gridZ);
          
          // Exit placement mode UNLESS shift is held (for rapid building)
          if (placed && !e.shiftKey) {
            console.log('🏗️ Building placed, exiting placement mode (hold Shift for continuous placement)');
            this.cancelPlacement();
          } else if (placed && e.shiftKey) {
            console.log('🏗️ Building placed, staying in placement mode (Shift held)');
            // Recreate preview for next placement
            if (this.previewMesh) {
              this.previewMesh.dispose();
              this.previewMesh = null;
            }
            this.createPreviewMesh();
          }
          
          // Prevent event from bubbling up and closing menus
          e.preventDefault();
          e.stopPropagation();
        }
      } catch (error) {
        console.warn('Error in click handler:', error);
      }
    };
    
    // Add event listeners
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('click', this.clickHandler);
    document.addEventListener('contextmenu', (e) => {
      if (this.isPlacing) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelPlacement();
        return false;
      }
    });
    
    // Also prevent right-click from bubbling up in click handler
    document.addEventListener('mousedown', (e) => {
      if (this.isPlacing && e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    
    // console.log('✅ Placement mode enabled');
  },
  
  // Place building at grid coordinates
  placeBuildingAt: function(gridX, gridZ) {
    if (!this.selectedBuildingType || !this.isPlacing) return false;
    
    // Check if position is valid (not too close to agora) - only during actual matches
    if (window.game && window.player && window.player.agora) {
      const agoraX = window.player.agora.x;
      const agoraZ = window.player.agora.y;
      const distance = Math.sqrt((gridX - agoraX) ** 2 + (gridZ - agoraZ) ** 2);
      
      if (distance < 3) {
        // console.log('❌ Building too close to agora');
        this.showPlacementError('Building too close to agora');
        return false;
      }
    }
    
    // Check if position is already occupied
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    for (const building of gameBuildings) {
      if (building.position.x === worldX && building.position.z === worldZ) {
        // console.log('❌ Position already occupied');
        this.showPlacementError('Position already occupied');
        return false;
      }
    }
    
    // MULTIPLAYER: Submit building command instead of placing directly
    if (window.isMultiplayer && window.currentMatch) {
      // CRITICAL: Include playerId so building ownership is correct!
      const normalizedPlayerId = window.player?.id?.length > 6 ? window.player.id.slice(-6) : window.player?.id;
      const command = {
        type: 'build',
        playerId: normalizedPlayerId,  // CRITICAL: Must include for proper ownership!
        buildingType: this.selectedBuildingType,
        gridX: gridX,
        gridZ: gridZ
        // NOTE: rotation is calculated deterministically in Building constructor based on position
        // NOTE: Resources are detected DETERMINISTICALLY during command execution, not here
      };
      window.currentMatch.submitCommand(command);
      
      // Don't recreate preview here - let the click handler decide whether to exit or continue
      // (If continuing with shift-click, it will create new preview; if exiting, cancelPlacement will clean up)
      return true; // Successfully submitted command
    }
    
    // SINGLE PLAYER: Place building directly
    const building = placeBuilding(this.selectedBuildingType, gridX, gridZ, window.gfx.scene);

    if (building) {
      // CRITICAL: Set owner to player for single-player buildings!
      const rawPlayerId = window.player?.id;
      building.owner = rawPlayerId?.length > 6 ? rawPlayerId.slice(-6) : rawPlayerId;

      // CRITICAL: Add building to player's buildings array!
      if (window.player) {
        window.player.buildings.push(building);
      }
      // console.log(`🏗️ Single-player building placed, owner set to: "${building.owner}"`);
      
      // Store team color so attached flag meshes can tint correctly
      if (typeof window.getTeamColorForOwner === 'function') {
        building.teamColor = window.getTeamColorForOwner(building.owner);
      }
      
      // NOTE: targetRotation is calculated deterministically in Building constructor based on position
      // Don't override it here!
      
      // DETERMINISTIC: Detect resources for camps (same logic as multiplayer)
      // NOTE: No longer pre-scanning resources - villagers find them dynamically
      // This allows camps to work with respawning resources and keeps the system flexible
      
      // Set up a callback to apply rotation and team colors after mesh loads
      const checkInterval = setInterval(() => {
        if (building.mesh) {
          // Only rotate the root mesh
          building.mesh.rotationQuaternion = null;
          building.mesh.rotation.y = building.targetRotation;
          
          // Apply team colors to the building
          if (window.applyTeamColorsToMesh) {
            const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(building.owner) : '#4A90E2';
            window.applyTeamColorsToMesh(building.mesh, teamColor);
          }
          
          clearInterval(checkInterval);
        }
      }, 100);
      
      // Reset cached position and rotation
      this.lastValidPosition = null;
      this.lastValidRotation = null;
      
      // console.log(`✅ ${building.name} placed at (${gridX}, ${gridZ})`);
      
      // Don't recreate preview here - let the click handler decide whether to exit or continue
      // (If continuing with shift-click, it will create new preview; if exiting, cancelPlacement will clean up)
      
      return true; // Successfully placed building
    } else {
      return false; // Failed to place building
    }
  },
  
  // Rotate the building preview
  rotateBuilding: function() {
    if (!this.isPlacing || !this.previewMesh) return;
    
    this.placementRotation += Math.PI / 2; // 90 degrees
    if (this.placementRotation >= Math.PI * 2) {
      this.placementRotation = 0;
    }
    
    this.previewMesh.rotation.y = this.placementRotation;
    // console.log(`🔄 Building rotated to ${(this.placementRotation * 180 / Math.PI).toFixed(0)}°`);
  },
  
  // Cancel building placement
  cancelPlacement: function() {
    this.exitPlacementMode();
  },
  
  // Return a building's model to the pool
  returnBuildingToPool: function(building) {
    if (building.mesh && building.model) {
      // Remove from LOD system before pooling
      if (window.gfx && window.gfx.removeModelFromLOD) {
        window.gfx.removeModelFromLOD(building.mesh);
      }

      // Hide the mesh (only if setEnabled method exists)
      if (typeof building.mesh.setEnabled === 'function') {
        building.mesh.setEnabled(false);
      }

      // Get or create pool for this model
      if (!buildingModelPools.has(building.model)) {
        buildingModelPools.set(building.model, []);
      }

      // Add mesh to pool
      const pool = buildingModelPools.get(building.model);
      pool.push({ root: building.mesh });

      // Clear building's reference
      building.mesh = null;
    }
  },

  // Exit placement mode
  exitPlacementMode: function(keepListeners = false) {
    this.isPlacing = false;
    this.selectedBuildingType = null;
    
    // Remove preview mesh
    if (this.previewMesh) {
      this.previewMesh.dispose();
      this.previewMesh = null;
    }
    
    // Clear radius visualization
    this.clearRadiusVisualization();
    
    // Only remove event listeners if we're fully exiting
    if (!keepListeners) {
      if (this.mouseMoveHandler) {
        document.removeEventListener('mousemove', this.mouseMoveHandler);
        this.mouseMoveHandler = null;
      }
      
      if (this.clickHandler) {
        document.removeEventListener('click', this.clickHandler);
        this.clickHandler = null;
      }
      
      // console.log('✅ Building placement mode exited');
    }
  },
  
  // Show placement error message
  showPlacementError: function(message) {
    // Create a temporary error message
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-weight: bold;
      z-index: 1000;
      pointer-events: none;
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remove after 2 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 2000);
  },
  
  // Show placement success message
  showPlacementSuccess: function(message) {
    // Create a temporary success message
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 255, 0, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-weight: bold;
      z-index: 1000;
      pointer-events: none;
    `;
    successDiv.textContent = message;
    
    document.body.appendChild(successDiv);
    
    // Remove after 2 seconds
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.parentNode.removeChild(successDiv);
      }
    }, 2000);
  },
  
  // Find best rotation based on surroundings
  findBestRotation: function(gridX, gridZ) {
    const SEARCH_RADIUS = 3; // How far to look for nearby objects
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    // Check for nearby buildings
    let nearestBuilding = null;
    let minDistance = Infinity;
    
    for (const building of gameBuildings) {
      const dx = building.position.x - worldX;
      const dz = building.position.z - worldZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance < SEARCH_RADIUS * TILE_SIZE && distance < minDistance) {
        nearestBuilding = building;
        minDistance = distance;
      }
    }
    
    // If we found a nearby building, face away from it
    if (nearestBuilding) {
      const dx = worldX - nearestBuilding.position.x;
      const dz = worldZ - nearestBuilding.position.z;
      return Math.atan2(dz, dx);
    }
    
    // Check for terrain features (if we have access to them)
    if (window.liveField && window.liveField.getTerrainType) {
      // Check surrounding tiles for terrain features
      // Check in a circle around the building in 15-degree increments
      const angles = [];
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
        const radius = 1;
        const x = Math.round(gridX + Math.cos(angle) * radius);
        const z = Math.round(gridZ + Math.sin(angle) * radius);
        angles.push({ x, z, angle: (angle + Math.PI) % (Math.PI * 2) }); // Face away from feature
      }
      
      for (const tile of angles) {
        const terrainType = window.liveField.getTerrainType(tile.x, tile.z);
        if (terrainType === 'forest' || terrainType === 'mountain' || terrainType === 'rock') {
          return tile.angle; // Face away from the terrain feature
        }
      }
    }
    
    // MULTIPLAYER: Use fixed rotation for determinism
    // In single player, use random rotation
    if (window.isMultiplayer) {
      return 0; // Fixed rotation in multiplayer for determinism
    }
    
    // Single player: random rotation in 15-degree increments
    return Math.floor(Math.random() * 24) * (Math.PI / 12); // 24 * 15 degrees = 360 degrees
  },

  // Update preview validity and color
  updatePreviewValidity: function(gridX, gridZ) {
    if (!this.previewMesh) return;
    
    let isValid = true;
    
    // Check if position is valid (not too close to agora) - only during actual matches
    if (window.game && window.player && window.player.agora) {
      const agoraX = window.player.agora.x;
      const agoraZ = window.player.agora.y;
      const distance = Math.sqrt((gridX - agoraX) ** 2 + (gridZ - agoraZ) ** 2);
      
      if (distance < 3) {
        isValid = false;
      }
    }
    
    // Check if position is already occupied
    const worldX = gridX * TILE_SIZE;
    const worldZ = gridZ * TILE_SIZE;
    
    for (const building of gameBuildings) {
      if (building.position.x === worldX && building.position.z === worldZ) {
        isValid = false;
        break;
      }
    }
    
    // Update preview appearance and rotation
    if (this.previewMesh) {
      // Update color based on validity
      this.previewMesh.getChildMeshes().forEach(mesh => {
        if (mesh.material) {
          if (isValid) {
            mesh.material.diffuseColor = new BABYLON.Color3(0, 1, 0); // Green
            mesh.material.emissiveColor = new BABYLON.Color3(0, 0.3, 0);
          } else {
            mesh.material.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red
            mesh.material.emissiveColor = new BABYLON.Color3(0.3, 0, 0);
          }
        }
      });

      // Update rotation based on surroundings
      if (isValid) {
        // Only recalculate rotation if we've moved to a new grid position
        const posKey = `${gridX},${gridZ}`;
        if (this.lastValidPosition !== posKey) {
          this.lastValidPosition = posKey;
          this.lastValidRotation = this.findBestRotation(gridX, gridZ);
        }
        
        const targetRotation = this.lastValidRotation;
        
        // Force Euler angles
        this.previewMesh.rotationQuaternion = null;
        
        // Smoothly interpolate to the target rotation
        const currentAngle = this.previewMesh.rotation.y;
        let angleDiff = targetRotation - currentAngle;
        
        // Normalize angle difference to [-PI, PI]
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        // Smooth interpolation with slower rotation
        const smoothing = 0.15; // Slower, more stable rotation
        const newAngle = currentAngle + angleDiff * smoothing;
        
        // Apply rotation
        this.previewMesh.rotation.y = newAngle;
        this.placementRotation = targetRotation; // Store target rotation for placement
      }
    }
  },
  
  // Add particle effect to a specific building
  addParticleEffect: function(building, effectType, anchorName = "particle_anchor", options = {}) {
    if (window.fx && building) {
      return window.fx.attachParticleEffect(building, effectType, anchorName, options);
    }
    return null;
  },
  
  // Remove particle effects from a building
  removeParticleEffects: function(building, effectType = null) {
    if (window.fx && building) {
      window.fx.removeParticleEffects(building, effectType);
    }
  },
  
  // Get all buildings with particle effects
  getBuildingsWithEffects: function() {
    return gameBuildings.filter(building => building.particleEffects && building.particleEffects.length > 0);
  }
};

// Export for use in other files
if (typeof window !== 'undefined') {
  window.BuildingTypes = BuildingTypes;
  window.Building = Building;
  window.gameBuildings = gameBuildings;
  window.placeBuilding = placeBuilding;
  window.placeAgora = placeAgora;
  window.initBuildings = initBuildings;
  window.updateBuildings = updateBuildings;
  window.buildingSystem = buildingSystem;
  window.assignVillagerToWork = assignVillagerToWork;
  window.processBuildingCompletion = processBuildingCompletion;
  
  // Debug logging
  // console.log('🏗️ Building system loaded:', {
  //   buildingTypes: Object.keys(BuildingTypes),
  //   buildingSystem: !!buildingSystem,
  //   placeBuilding: !!placeBuilding
  // });
  
  // Auto-start building initialization
  setTimeout(autoInitBuildings, 2500); // Wait a bit after units initialize
  
  // Test function to create a village for testing villager spawning
  window.testVillageSpawn = function() {
    // console.log('🏘️ Creating test village for villager spawning...');
    
    if (!window.gfx || !window.gfx.scene) {
      // console.error('❌ Scene not ready for village creation');
      return;
    }
    
    // Create a village at a random position near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const villageX = Math.floor(cameraPos.x / TILE_SIZE) + 5;
    const villageZ = Math.floor(cameraPos.z / TILE_SIZE) + 5;
    
    const village = placeBuilding('village', villageX, villageZ, window.gfx.scene);
    
    if (village) {
      // Set the village as complete so it can start spawning
      village.buildProgress = 1.0;
      village.lastSpawnTick = 0; // Allow immediate spawning
      
      // console.log(`🏘️ Test village created at (${villageX}, ${villageZ}) - will spawn villagers every 60 seconds`);
      // console.log('🏘️ Village properties:', {
      //   spawnsVillagers: village.spawnsVillagers,
      //   spawnInterval: village.spawnInterval,
      //   maxVillagers: village.maxVillagers,
      //   spawnRadius: village.spawnRadius
      // });
    }
  };
  
  // Function to check village spawn status
  window.checkVillageStatus = function() {
    const villages = gameBuildings.filter(building => building.spawnsVillagers);
    // console.log(`🏘️ Found ${villages.length} villages:`);
    
    villages.forEach((village, index) => {
      const timeSinceLastSpawn = Date.now() - village.lastSpawnTime;
      const timeUntilNextSpawn = village.spawnInterval - timeSinceLastSpawn;
      
      // console.log(`🏘️ Village ${index + 1}:`, {
      //   position: `(${village.position.x.toFixed(1)}, ${village.position.z.toFixed(1)})`,
      //   spawnedVillagers: village.spawnedVillagers,
      //   maxVillagers: village.maxVillagers,
      //   buildProgress: village.buildProgress,
      //   timeSinceLastSpawn: `${(timeSinceLastSpawn / 1000).toFixed(1)}s`,
      //   timeUntilNextSpawn: timeUntilNextSpawn > 0 ? `${(timeUntilNextSpawn / 1000).toFixed(1)}s` : 'Ready to spawn!'
      // });
    });
  };
  
  // Function to create test work buildings
  window.testWorkBuildings = function() {
    // console.log('🔨 Creating test work buildings...');
    
    if (!window.gfx || !window.gfx.scene) {
      // console.error('❌ Scene not ready for building creation');
      return;
    }
    
    // Create a camp near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const campX = Math.floor(cameraPos.x / TILE_SIZE) + 3;
    const campZ = Math.floor(cameraPos.z / TILE_SIZE) + 3;
    
    const camp = placeBuilding('camp', campX, campZ, window.gfx.scene);
    if (camp) {
      camp.buildProgress = 1.0; // Complete the building
      // console.log(`🔨 Test camp created at (${campX}, ${campZ})`);
    }
    
    // Create a farm nearby
    const farmX = campX + 2;
    const farmZ = campZ + 2;
    
    const farm = placeBuilding('farm', farmX, farmZ, window.gfx.scene);
    if (farm) {
      farm.buildProgress = 1.0; // Complete the building
      // console.log(`🌾 Test farm created at (${farmX}, ${farmZ})`);
    }
    
    // console.log('🔨 Test buildings created - villagers should automatically start working!');
  };
  
  // Function to check work building status
  window.checkWorkStatus = function() {
    const workBuildings = gameBuildings.filter(building => building.needsWorkers);
    // console.log(`🔨 Found ${workBuildings.length} work buildings:`);
    
    workBuildings.forEach((building, index) => {
      const timeSinceLastWork = Date.now() - building.lastWorkTime;
      const timeUntilNextWork = building.workInterval - timeSinceLastWork;
      
      // console.log(`🔨 ${building.name} ${index + 1}:`, {
      //   position: `(${building.position.x.toFixed(1)}, ${building.position.z.toFixed(1)})`,
      //   assignedWorkers: building.assignedWorkers.length,
      //   maxWorkers: building.maxWorkers,
      //   workType: building.workType,
      //   workOutput: building.workOutput,
      //   buildProgress: building.buildProgress,
      //   timeSinceLastWork: `${(timeSinceLastWork / 1000).toFixed(1)}s`,
      //   timeUntilNextWork: timeUntilNextWork > 0 ? `${(timeUntilNextWork / 1000).toFixed(1)}s` : 'Ready to work!'
      // });
    });
  };
  
  // Function to check player resources
  window.checkResources = function() {
    if (window.player && window.player.getResources) {
      const resources = window.player.getResources();
      // console.log('💰 Player resources:', resources);
    } else {
      // console.error('❌ Player or resource system not available');
    }
  };
  
  // DIAGNOSTIC: Function to debug work assignment issues
  window.debugWorkAssignment = function() {
    console.log('=== WORK ASSIGNMENT DEBUG ===');
    console.log(`Player ID: ${window.player?.id}`);
    console.log(`Opponent ID: ${window.opponent?.id}`);
    console.log(`Game exists: ${!!window.game}`);
    console.log(`\n--- BUILDINGS ---`);
    
    gameBuildings.forEach((building, i) => {
      if (building.needsWorkers) {
        const normalizedOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
        const normalizedPlayerId = window.player?.id?.length > 6 ? window.player.id.slice(-6) : window.player?.id;
        const isPlayerBuilding = normalizedOwner === normalizedPlayerId;
        
        console.log(`\nBuilding ${i}: ${building.name} (${building.type})`);
        console.log(`  Owner: ${building.owner} (normalized: ${normalizedOwner})`);
        console.log(`  Is player's: ${isPlayerBuilding}`);
        console.log(`  Workers: ${building.assignedWorkers.length}/${building.maxWorkers}`);
        console.log(`  Work type: ${building.workType}`);
        console.log(`  Resources: ${building.availableResources?.length || 0} tiles`);
        console.log(`  Build progress: ${building.buildProgress}`);
      }
    });
    
    console.log(`\n--- VILLAGERS ---`);
    const villagers = gameUnits.filter(u => u.type === 'villager');
    console.log(`Total villagers: ${villagers.length}`);
    console.log(`Player villagers: ${window.player?.units.filter(u => u.type === 'villager').length || 0}`);
    console.log(`Opponent villagers: ${window.opponent?.units.filter(u => u.type === 'villager').length || 0}`);
    
    villagers.slice(0, 5).forEach((v, i) => {
      const normalizedOwner = v.owner?.length > 6 ? v.owner.slice(-6) : v.owner;
      const behavior = window.behaviorManager?.getBehavior(v);
      const behaviorName = behavior ? behavior.constructor.name : 'none';
      console.log(`\nVillager ${i}: owner=${v.owner} (normalized: ${normalizedOwner})`);
      console.log(`  Behavior: ${behaviorName}`);
      console.log(`  Assigned building: ${v.assignedBuilding?.name || 'none'}`);
      console.log(`  In player.units: ${window.player?.units.includes(v) || false}`);
      console.log(`  In opponent.units: ${window.opponent?.units.includes(v) || false}`);
    });
  };
  
  // DIAGNOSTIC: Function to debug why villagers aren't being assigned
  window.debugVillagerAssignment = function() {
    console.log('=== VILLAGER ASSIGNMENT DEBUG ===');
    console.log(`Player ID: ${window.player?.id}`);
    console.log(`Player units: ${window.player?.units.length}`);
    console.log(`Game units: ${window.gameUnits?.length}`);
    
    // Find player's camp
    const playerCamp = gameBuildings.find(b => b.type === 'camp' && b.owner === window.player?.id);
    if (!playerCamp) {
      console.log('❌ No player camp found!');
      return;
    }
    
    console.log(`\nPlayer Camp: ${playerCamp.name} at (${playerCamp.position.x.toFixed(1)}, ${playerCamp.position.z.toFixed(1)})`);
    console.log(`  Workers: ${playerCamp.assignedWorkers.length}/${playerCamp.maxWorkers}`);
    console.log(`  Resources: ${playerCamp.availableResources?.length || 0}`);
    
    // Check all player villagers
    console.log(`\n--- PLAYER VILLAGERS ---`);
    let idleCount = 0;
    window.player.units.filter(u => u.type === 'villager').forEach((villager, i) => {
      const dx = villager.pb?.state?.loc?.x - playerCamp.position.x;
      const dz = villager.pb?.state?.loc?.z - playerCamp.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const currentBehavior = window.behaviorManager?.getBehavior(villager);
      const behaviorName = currentBehavior?.constructor?.name || 'none';
      const isIdle = !currentBehavior || behaviorName === 'LingerBehavior';
      
      if (isIdle) idleCount++;
      
      console.log(`  ${i+1}. ${villager.name || 'Villager'}`);
      console.log(`     Position: (${villager.pb?.state?.loc?.x.toFixed(1)}, ${villager.pb?.state?.loc?.z.toFixed(1)})`);
      console.log(`     Distance to camp: ${distance.toFixed(1)} units`);
      console.log(`     Behavior: ${behaviorName}`);
      console.log(`     Is idle: ${isIdle}`);
      console.log(`     Owner: ${villager.owner}`);
      console.log(`     Assigned building: ${villager.assignedBuilding?.name || 'none'}`);
    });
    
    console.log(`\nTotal idle villagers: ${idleCount}`);
    console.log(`Search radius: ${(playerCamp.workRadius || 20) * TILE_SIZE} world units`);
  };
  
  // Function to test resource display
  window.testResourceDisplay = function() {
    // console.log('💰 Testing resource display...');
    
    if (!window.player) {
      // console.error('❌ Player not available');
      return;
    }
    
    // Add some test resources
    window.player.addResource('food', 50);
    window.player.addResource('wood', 25);
    window.player.addResource('stone', 15);
    window.player.addResource('minerals', 10);
    
    // Force update the display
    if (window.hud && window.hud.updateResourceDisplay) {
      window.hud.updateResourceDisplay();
      // console.log('💰 Resource display updated!');
    } else {
      // console.error('❌ Resource display function not available');
    }
  };
  
  // Function to spawn test engineers
  window.spawnTestEngineers = function() {
    // console.log('🔧 Spawning test engineers...');
    
    if (!window.player || !window.gfx || !window.gfx.scene) {
      // console.error('❌ Player or scene not available');
      return;
    }
    
    // Spawn 2-3 engineers near the camera
    const cameraPos = window.gfx.camera ? window.gfx.camera.position : { x: 0, z: 0 };
    const engineerCount = 2 + Math.floor(Math.random() * 2); // 2-3 engineers
    
    for (let i = 0; i < engineerCount; i++) {
      const angle = (i / engineerCount) * Math.PI * 2;
      const distance = 3 + Math.random() * 2;
      
      const x = cameraPos.x + Math.cos(angle) * distance * TILE_SIZE;
      const z = cameraPos.z + Math.sin(angle) * distance * TILE_SIZE;
      
      const ownerId = window.player?.id;
      const engineer = new Unit('engineer', { x, y: 0, z });
      engineer.owner = ownerId;
      
      // Random rotation
      const randomRotation = Math.random() * Math.PI * 2;
      engineer.rotation = randomRotation;
      if (engineer.pb.state && engineer.pb.state.rot) {
        engineer.pb.state.rot.y = randomRotation;
      }
      
      // Add to player's units
      window.player.units.push(engineer);
      gameUnits.push(engineer);
      
      // console.log(`🔧 Spawned engineer ${i + 1} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
    
    // Spawn the visual models
    if (window.spawnUnitModels) {
      window.spawnUnitModels(window.gfx.scene);
    }
    
    // console.log(`🔧 Spawned ${engineerCount} engineers - they should start working at nearby buildings!`);
  };
  
  
}

// Global functions for showing/hiding building selection radius (fence ring, same style as lasso 3D selection)
let selectedBuildingRadiusFence = null;

window.showBuildingRadius = function(building) {
  if (!building || !building.mesh || !window.gfx || !window.gfx.scene) return;
  
  window.hideBuildingRadius();
  
  const buildingDef = window.BuildingTypes[building.type];
  if (!buildingDef || !buildingDef.workRadius) return;
  
  const TILE_SZ = window.TILE_SIZE || 4;
  const radius = buildingDef.workRadius * TILE_SZ;
  const terrainY = window.getTerrainHeightAtPosition ?
    window.getTerrainHeightAtPosition(building.mesh.position.x, building.mesh.position.z) : 0;
  const material = createWorkRadiusFenceMaterial(window.gfx.scene, 'selectedBuildingRadiusFenceMat');
  const panels = [];
  buildOrUpdateWorkRadiusFencePanels(
    panels,
    window.gfx.scene,
    building.mesh.position.x,
    building.mesh.position.z,
    terrainY,
    radius,
    material,
    'selBldRadiusFence'
  );
  selectedBuildingRadiusFence = { panels, material };
};

window.hideBuildingRadius = function() {
  if (selectedBuildingRadiusFence) {
    disposeWorkRadiusFencePanels(selectedBuildingRadiusFence.panels, selectedBuildingRadiusFence.material);
    selectedBuildingRadiusFence = null;
  }
};
