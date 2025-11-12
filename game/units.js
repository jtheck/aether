

// Multiplayer interpolation settings
const REMOTE_UNIT_INTERPOLATION_SPEED = 0.2; // Competitive smoothing - quick catch-up without jarring snaps

// Unit type definitions - all unit attributes in one place
const UnitTypes = {
  // NPCs and Creatures
  villager: {
    name: "Villager",
    category: "npc",
    model: "assets/models/villager.glb",
    scale: 0.5, // Made bigger so they're visible
    health: 50,
    speed: 20,
    rotationSpeed: 3.0, // Snappy turning for responsive movement
    // modelOrientation: Math.PI * 1.5, // 270 degrees - flipped around to face forward
    size: 1,
    cost: { food: 25 },
    abilities: ["gather", "build"],
    description: "Basic civilian unit that can gather resources and construct buildings"
  },
  
  frog_scout: {
    name: "Frog Scout", 
    category: "military",
    model: "assets/models/frog.glb",
    scale: 0.12,
    health: 30,
    speed: 4,
    rotationSpeed: 5.0, // Very fast turning for agile scouts
    size: 0.8,
    cost: { food: 20, wood: 10 },
    abilities: ["scout", "stealth"],
    description: "Fast reconnaissance unit with stealth capabilities"
  },
  
  tree_guardian: {
    name: "Tree Guardian",
    category: "military", 
    model: "assets/models/trees.glb",
    scale: .8,
    health: 150,
    speed: 1,
    rotationSpeed: 5.0, // Slow turning for massive units
    size: 2,
    cost: { wood: 50, stone: 25 },
    abilities: ["defend", "root_slam"],
    description: "Massive defensive unit with area attack abilities"
  },
  
  mushroom_mage: {
    name: "Mushroom Mage",
    category: "caster",
    model: "assets/models/mushroom.glb", 
    scale: 0.15,
    health: 40,
    speed: 1.5,
    rotationSpeed: 12.0, // Medium turning for casters
    size: 1,
    cost: { food: 30, magic: 20 },
    abilities: ["heal", "poison_cloud", "grow"],
    description: "Support unit that can heal allies and cast nature magic"
  },
  
  bird_messenger: {
    name: "Bird Messenger",
    category: "utility",
    model: "assets/models/birdy.glb",
    scale: 0.08,
    health: 20,
    speed: 8,
    rotationSpeed: 30.0, // Very fast turning for agile birds
    size: 0.5,
    cost: { food: 15 },
    abilities: ["fly", "message", "scout"],
    description: "Flying unit for communication and aerial reconnaissance"
  },
  
  // Workers
  gnome_builder: {
    name: "Gnome Builder",
    category: "worker",
    model: "assets/models/gnome.glb",
    scale: 0.12,
    health: 60,
    speed: 2,
    rotationSpeed: 18.0, // Fast turning for skilled workers
    size: 1,
    cost: { food: 30, stone: 15 },
    abilities: ["build", "repair", "fortify"],
    description: "Specialized construction unit with enhanced building abilities"
  },

  // Your original units
  monk: {
    name: "Monk",
    category: "support",
    model: "assets/models/monk.glb",
    scale: 0.5,
    health: 45,
    speed: 25,
    rotationSpeed: 8.0,
    size: 1,
    cost: { food: 25, magic: 15 },
    abilities: ["heal", "bless", "convert"],
    description: "Holy unit with healing and conversion abilities"
  },

  wizard: {
    name: "Wizard",
    category: "caster",
    model: "assets/models/wizard.glb",
    scale: 0.5,
    health: 40,
    speed: 50,
    rotationSpeed: 10.0,
    size: 1,
    cost: { food: 30, magic: 25 },
    abilities: ["fireball", "teleport", "shield"],
    description: "Powerful magic user with offensive spells"
  },

  engineer: {
    name: "Engineer",
    category: "worker",
    model: "assets/models/engineer.glb",
    scale: 0.5,
    health: 50,
    speed: 21.0,
    rotationSpeed: 4.0,
    size: 1,
    cost: { food: 35, stone: 20 },
    abilities: ["build", "repair", "upgrade"],
    description: "Advanced builder with special upgrade abilities"
  },

  brigand: {
    name: "Brigand",
    category: "military",
    model: "assets/models/brigand.glb",
    scale: 0.5,
    health: 65,
    speed: 31.0,
    rotationSpeed: 4.0,
    size: 1,
    cost: { food: 40, wood: 15 },
    abilities: ["sneak", "ambush", "steal"],
    description: "Stealthy unit specializing in ambush tactics"
  }
};

// Simple LOD system - just update frequency based on distance
const LOD_DISTANCES = {
  NEAR: 150,   // Update every frame (increased from 100)
  FAR: 450,    // Update every 3rd frame (increased from 300)
  HIDDEN: 600  // Hide completely beyond this distance (increased from 400)
};

// Special LOD distances for flying units (they should be visible from further away)
const FLYING_LOD_DISTANCES = {
  NEAR: 300,   // Update every frame (increased from 200)
  FAR: 900,    // Update every 3rd frame (increased from 600)
  HIDDEN: 1200 // Hide completely beyond this distance (increased from 800)
};

// Unit constructor that uses the definitions
function Unit(unitType, position, options = {}) {
    const def = UnitTypes[unitType];
    if (!def) {
        // console.error(`Unknown unit type: ${unitType}`);
        return null;
    }
    
    // Copy all properties from definition
    Object.assign(this, def);
    
    // Unit instance properties
    this.type = unitType; // Store the original unit type
    // Generate deterministic IDs in multiplayer using match seed + unit count
    this.id = options.id || (window.isMultiplayer && window.currentMatch ? 
        `unit-${window.currentMatch.mapSeed}-${(window.gameUnits?.length || 0)}` : 
        Math.random().toString(36).substr(2, 9));
    this.position = position || { x: 0, y: 0, z: 0 };
    this.currentHealth = options.currentHealth !== undefined ? options.currentHealth : this.health;
    this.level = options.level || 1;
    this.experience = options.experience || 0;
    this.owner = options.owner || 'player';
    this.state = 'idle'; // idle, moving, attacking, working, etc.
    this.target = null;
    this.inventory = options.inventory || {};
    
    // Simple LOD properties
    this.distanceToCamera = 0;
    this.lastUpdateFrame = 0;
    
    // Visual interpolation for smooth remote player movement
    this.visualPosition = null; // Current visual position (for interpolation)
    this.interpolationSpeed = REMOTE_UNIT_INTERPOLATION_SPEED;
    
    // Physics body
    this.pb = new PBody();
    
    // Sync physics body position with unit position
    if (this.pb.state && this.pb.state.loc) {
        this.pb.state.loc.x = this.position.x;
        this.pb.state.loc.y = Number.isFinite(this.position.y) ? this.position.y : 0;
        this.pb.state.loc.z = this.position.z;
        
        // Ensure position Y is valid
        if (!Number.isFinite(this.position.y)) {
            console.warn(`⚠️ Unit ${this.name} created with invalid Y position, fixing to 0`);
            this.position.y = 0;
        }
    }
    
    // Initialize rotation in physics body
    if (this.pb.state && !this.pb.state.rot) {
        this.pb.state.rot = { x: 0, y: 0, z: 0 };
    }
    
    // 3D model reference (will be set when spawned)
    this.mesh = null;
    
    // console.log(`Created ${this.name} at position`, this.position);
}

// Helper function to get unit definition by type
function getUnitDef(unitType) {
    return UnitTypes[unitType];
}

// Helper function to list all unit types in a category
function getUnitsByCategory(category) {
    return Object.keys(UnitTypes).filter(type => UnitTypes[type].category === category);
}

// Simple LOD: check if unit should update this frame
function shouldUpdateUnit(unit, currentFrame) {
    // Use squared distance for performance (avoid sqrt)
    const distanceSquared = unit.distanceToCameraSquared || 0;
    
    // Neutral units get much more aggressive LOD to improve performance
    if (unit.owner === 'neutral') {
        const NEUTRAL_LOD_DISTANCES_SQ = {
            NEAR: 100 * 100,    // 10000
            FAR: 250 * 250,     // 62500
            HIDDEN: 400 * 400   // 160000
        };
        
        if (distanceSquared <= NEUTRAL_LOD_DISTANCES_SQ.NEAR) {
            return (currentFrame - unit.lastUpdateFrame) >= 1; // Update every 2nd frame
        } else if (distanceSquared <= NEUTRAL_LOD_DISTANCES_SQ.FAR) {
            return (currentFrame - unit.lastUpdateFrame) >= 5; // Update every 6th frame
        } else if (distanceSquared <= NEUTRAL_LOD_DISTANCES_SQ.HIDDEN) {
            return (currentFrame - unit.lastUpdateFrame) >= 15; // Update every 16th frame
        } else {
            return false; // Hidden - never update
        }
    }
    
    // Player units use tiered update rates but ALWAYS update (never skip completely)
    const distances = (unit.abilities && unit.abilities.includes('fly')) ? FLYING_LOD_DISTANCES : LOD_DISTANCES;
    const distancesSquared = {
        NEAR: distances.NEAR * distances.NEAR,
        FAR: distances.FAR * distances.FAR,
        HIDDEN: distances.HIDDEN * distances.HIDDEN
    };
    
    if (distanceSquared <= distancesSquared.NEAR) {
        return true; // Update every frame (close up)
    } else if (distanceSquared <= distancesSquared.FAR) {
        return (currentFrame - unit.lastUpdateFrame) >= 1; // Update every 2nd frame (medium distance)
    } else if (distanceSquared <= distancesSquared.HIDDEN) {
        return (currentFrame - unit.lastUpdateFrame) >= 2; // Update every 3rd frame (far away)
    } else {
        // VERY FAR: Still update frequently enough to see smooth movement (every 3rd frame)
        // This keeps distant armies visible and moving smoothly for strategic gameplay
        return (currentFrame - unit.lastUpdateFrame) >= 2;
    }
}

// Calculate distance to camera for LOD and hide/show units
function updateUnitDistances() {
    const cameraPosition = window.gfx && window.gfx.camera ? window.gfx.camera.position : null;
    if (!cameraPosition) return;
    
    // Cache camera position for performance
    const camX = cameraPosition.x;
    const camZ = cameraPosition.z;
    
    // Pre-calculate squared distances for comparison (avoid sqrt)
    const NEUTRAL_HIDE_DISTANCE_SQ = 400 * 400; // 160000
    const LOD_HIDDEN_DISTANCE_SQ = LOD_DISTANCES.HIDDEN * LOD_DISTANCES.HIDDEN; // 360000
    const NEAR_DISTANCE_SQ = LOD_DISTANCES.NEAR * LOD_DISTANCES.NEAR; // 22500
    const FAR_DISTANCE_SQ = LOD_DISTANCES.FAR * LOD_DISTANCES.FAR; // 202500
    const FLYING_NEAR_DISTANCE_SQ = FLYING_LOD_DISTANCES.NEAR * FLYING_LOD_DISTANCES.NEAR; // 90000
    const FLYING_FAR_DISTANCE_SQ = FLYING_LOD_DISTANCES.FAR * FLYING_LOD_DISTANCES.FAR; // 810000
    const FLYING_HIDDEN_DISTANCE_SQ = FLYING_LOD_DISTANCES.HIDDEN * FLYING_LOD_DISTANCES.HIDDEN; // 1440000
    
    gameUnits.forEach(unit => {
        if (unit.pb && unit.pb.state && unit.pb.state.loc) {
            const dx = unit.pb.state.loc.x - camX;
            const dz = unit.pb.state.loc.z - camZ;
            const distanceSquared = dx * dx + dz * dz;
            
            // Store squared distance for LOD calculations (only calculate sqrt when needed)
            unit.distanceToCameraSquared = distanceSquared;
            unit.distanceToCamera = Math.sqrt(distanceSquared); // Only calculate sqrt when actually needed
            
            // Hide/show units based on distance (using squared distances for comparison)
            if (unit.mesh) {
                // GAMEPLAY UNITS (player/AI) - ALWAYS VISIBLE for strategic gameplay
                // You need to see where your armies are at all zoom levels!
                if (unit.owner !== 'neutral') {
                    unit.mesh.setEnabled(true);
                }
                // DECORATIVE UNITS (neutral wildlife) - Aggressive culling for performance
                else if (unit.owner === 'neutral') {
                    if (distanceSquared > NEUTRAL_HIDE_DISTANCE_SQ) {
                        unit.mesh.setEnabled(false);
                    } else {
                        unit.mesh.setEnabled(true);
                    }
                }
            }
        }
    });
}

// Add particle effects to units based on their type
function addUnitParticleEffects(unit) {
  if (!window.fx || !unit.mesh) {
    return;
  }
  
  // Add particle effects based on unit type
  switch (unit.type.toLowerCase()) {
    case 'brigand':
      // Add torch effects for brigand (multiple anchors)
      window.fx.attachMultipleParticleEffects(unit, [
        { type: 'torch', anchor: 'torch_anchor.001', options: { scale: 0.2 } },
        { type: 'torch', anchor: 'torch_anchor.002', options: { scale: 0.2 } }
      ]);
      break;
      
    case 'wizard':
      // Add magical particle effect for wizard (uses single particle_anchor)
      window.fx.attachParticleEffect(unit, 'magefire', 'particle_anchor', {
        scale: 0.4,
        emitRate: 25
      });
      break;
      
    case 'monk':
      // Add subtle holy particle effect for monk
      window.fx.attachParticleEffect(unit, 'particle', 'holy_anchor', {
        scale: 0.2,
        emitRate: 10,
        minSize: 0.1,
        maxSize: 0.2
      });
      break;
      
    case 'engineer':
      // Add subtle smoke effect for engineer (workshop)
      window.fx.attachParticleEffect(unit, 'smoke', 'workshop_anchor', {
        scale: 0.1,
        emitRate: 5,
        minSize: 0.1,
        maxSize: 0.2
      });
      break;
      
    // Add more unit types as needed
    default:
      // No default particle effects for other units
      break;
  }
}

// Global units arrays
const gameUnits = []; // All units combined (for rendering)
const neutralUnits = []; // Wild/neutral units only

// Sprinkle units across the terrain
function sprinkleUnits() {
    // MULTIPLAYER: Skip neutral unit spawning to prevent desync
    // Neutral units use non-deterministic Math.random() which causes desync
    if (window.isMultiplayer) {
        // console.log('🚫 Skipping neutral unit spawning in multiplayer (prevents desync)');
        return;
    }
    
    // console.log("Sprinkling units across the terrain...");
    
    const unitTypes = ['frog_scout', 'mushroom_mage', 'bird_messenger']; // No villagers in neutral spawn
    
    // Spread units across the whole field using actual field dimensions in world coordinates
    const fieldWidth = window.liveField ? window.liveField.width : 66;
    const fieldHeight = window.liveField ? window.liveField.height : 66;
    const tileSpacing = 8; // Much wider spacing to reduce memory usage
    const worldSpacing = tileSpacing * TILE_SIZE; // Convert to world units
    
    for (let x = worldSpacing; x < (fieldWidth - tileSpacing) * TILE_SIZE; x += worldSpacing) {
        for (let z = worldSpacing; z < (fieldHeight - tileSpacing) * TILE_SIZE; z += worldSpacing) {
            // Only spawn unit 50% of the time to further reduce count
            if (Math.random() < 0.5) {
                continue;
            }
            
            // Random unit type
            const randomType = unitTypes[Math.floor(Math.random() * unitTypes.length)];
            
            // Add some random offset within the grid cell (in world units)
            const offsetX = (Math.random() - 0.5) * TILE_SIZE * 1.5;
            const offsetZ = (Math.random() - 0.5) * TILE_SIZE * 1.5;
            
            const unit = new Unit(randomType, {
                x: x + offsetX, 
                y: 0, 
                z: z + offsetZ
            });
            
            // Set as neutral unit
            unit.owner = 'neutral';
            
            // Add random rotation to the unit and physics body
            const randomRotation = Math.random() * Math.PI * 2;
            unit.rotation = randomRotation;
            if (unit.pb.state && unit.pb.state.rot) {
                unit.pb.state.rot.y = randomRotation;
                // console.log(`Unit ${unit.name} rotation set to:`, randomRotation, 'rad =', (randomRotation * 180/Math.PI).toFixed(1), 'deg');
            }
            
            // Add to neutral units AND gameUnits for rendering
            neutralUnits.push(unit);
            gameUnits.push(unit);
        }
    }
    
    // console.log(`Created ${gameUnits.length} units`);
}

// Spawn visual models for all units (only for units without meshes)
function spawnUnitModels(scene) {
    // console.log(`🎨 spawnUnitModels() called - ${gameUnits.length} units to process`);
    
    let unitsNeedingMeshes = 0;
    gameUnits.forEach(unit => {
        if (!unit.mesh && window.gfx && window.gfx.getModel) {
            unitsNeedingMeshes++;
            // Load the 3D model for this unit
            // console.log(`🎮 Loading model ${unit.model} for ${unit.name} (owner: ${unit.owner}, scale: ${unit.scale})`);
            window.gfx.getModel(unit.model, scene).then(model => {
                unit.mesh = model.root;
                unit.mesh.scaling = new BABYLON.Vector3(unit.scale, unit.scale, unit.scale);
                
                // Make unit meshes pickable for selection
                unit.mesh.isPickable = true;
                // console.log(`✅ Mesh loaded and set pickable for ${unit.name} (owner: ${unit.owner})`);
                
                // Set up shadows for unit mesh
                if (window.gfx && window.gfx.setupMeshShadows) {
                    window.gfx.setupMeshShadows(unit.mesh);
                }
                
                // Handle child meshes - preserve their original rotations
                unit.mesh.getChildMeshes().forEach(mesh => {
                    mesh.isPickable = true;
                    // console.log(`  ↳ Child mesh also set pickable: ${mesh.name}`);
                    
                    // Store their original rotations if they have them
                    if (mesh.rotationQuaternion) {
                        const quaternion = mesh.rotationQuaternion.clone();
                        mesh.rotationQuaternion = null;
                        mesh.originalRotation = quaternion.toEulerAngles();
                        mesh.rotation.copyFrom(mesh.originalRotation);
                    }
                });
                
                // Create selection indicator (glowing ring)
                createSelectionIndicator(unit);
                
                // Initial position from physics body
                if (unit.pb && unit.pb.state && unit.pb.state.loc) {
                    unit.mesh.position.x = unit.pb.state.loc.x;
                    unit.mesh.position.y = Number.isFinite(unit.pb.state.loc.y) ? unit.pb.state.loc.y : 0;
                    unit.mesh.position.z = unit.pb.state.loc.z;
                    
                    // Fix NaN in physics body if found
                    if (!Number.isFinite(unit.pb.state.loc.y)) {
                        console.warn(`⚠️ Fixed NaN Y position for ${unit.name}, setting to 0`);
                        unit.pb.state.loc.y = 0;
                    }
                    // console.log(`📍 ${unit.name} positioned at (${unit.mesh.position.x.toFixed(1)}, ${unit.mesh.position.y.toFixed(1)}, ${unit.mesh.position.z.toFixed(1)}) with scale ${unit.scale}`);
                }
                
                // Apply random rotation
                if (unit.rotation !== undefined) {
                    unit.mesh.rotation.y = unit.rotation;
                }
                
                // Initialize default linger behavior
                if (window.behaviorManager) {
                    window.behaviorManager.setBehavior(unit, 'linger');
                    // console.log(`🎯 ${unit.name || unit.type} initialized with linger behavior`);
                } else {
                    // console.warn(`⚠️ Behavior manager not available for ${unit.name || unit.type}`);
                }
                
                // Add particle effects to units
                addUnitParticleEffects(unit);
                
                // Apply team colors to the unit
                if (window.applyTeamColorsToMesh) {
                    const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(unit.owner) : '#4A90E2';
                    window.applyTeamColorsToMesh(unit.mesh, teamColor);
                }
                
                // console.log(`✅ Successfully spawned ${unit.name} model at`, unit.pb.state.loc);
            }).catch(err => {
                // console.warn(`Failed to load model for ${unit.name}:`, err);
            });
        }
    });
    
    if (unitsNeedingMeshes > 0) {
        // console.log(`✅ Spawning meshes for ${unitsNeedingMeshes}/${gameUnits.length} units`);
    }
}

// Create a selection indicator for a unit
function createSelectionIndicator(unit) {
    if (!unit.mesh || !window.gfx || !window.gfx.scene) return;
    
    // Create a ring around the unit for selection indicator
    const ring = BABYLON.MeshBuilder.CreateTorus("selectionRing", {
        diameter: 2.5,
        thickness: 0.06,
        tessellation: 16
    }, window.gfx.scene);
    
    // Create glowing material
    const ringMaterial = new BABYLON.StandardMaterial("selectionRingMat", window.gfx.scene);
    ringMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1); // Cyan to match selection box
    ringMaterial.emissiveColor = new BABYLON.Color3(0, 0.5, 0.5);
    ringMaterial.alpha = 0.8;
    
    ring.material = ringMaterial;
    ring.isVisible = false; // Hidden by default
    ring.isPickable = false; // Don't interfere with unit selection
    
    // Position ring around the unit
    ring.position.y = 0.1; // Slightly above ground
    ring.parent = unit.mesh; // Parent to unit so it moves with it
    
    // Store reference to the selection indicator
    unit.selectionIndicator = ring;
    
    // console.log(`🎯 Created selection indicator for ${unit.name}`);
}

// Update selection indicators for all units
function updateSelectionIndicators() {
    if (!window.player || !window.player.units) return;
    
    const selectedUnits = window.player.getSelectedUnits();
    
    // Update all units' selection indicators
    window.player.units.forEach(unit => {
        if (unit.selectionIndicator) {
            const isSelected = selectedUnits.includes(unit);
            unit.selectionIndicator.isVisible = isSelected;
            
            // Add some animation for selected units
            if (isSelected) {
                // Rotate the ring slowly
                unit.selectionIndicator.rotation.y += 0.02;
                
                // Pulse the alpha slightly
                const pulse = Math.sin(Date.now() * 0.005) * 0.2 + 0.8;
                unit.selectionIndicator.material.alpha = pulse;
            }
        }
    });
}

// Update unit logic, AI, and behaviors
function updateUnits(deltaTime) {
    const currentFrame = window.frameCounter || 0;
    
    // Update distances for LOD
    updateUnitDistances();
    
    // Update selection indicators once per frame (not per unit)
    updateSelectionIndicators();
    
    // // Step all unit behaviors (this handles movement commands)
    // if (window.behaviorManager) {
    //     window.behaviorManager.stepBehaviors();
    // }
    
    gameUnits.forEach(unit => {
        if (!unit.pb || !unit.pb.state) return;
        
        // Check if this unit should update this frame based on LOD
        if (!shouldUpdateUnit(unit, currentFrame)) {
            return; // Skip this unit this frame
        }
        
        // Mark this unit as updated
        unit.lastUpdateFrame = currentFrame;
        
        // Update unit behaviors based on type
        if (unit.name.includes('Tortle')) {
            // Tortles get random turning impulses (use cached time)
            const turnTimeOffset = unit.id.charCodeAt(1) * 50;
            const turnCycle = Math.sin((currentTime + turnTimeOffset) * 0.00008); // Very slow
            
            // Only apply impulse when cycle is near peaks/valleys (occasional turns)
            if (Math.abs(turnCycle) > 0.95) {
                const turnImpulse = Math.sign(turnCycle) * 0.001; // Small angular impulse
                
                // Initialize angular velocity if it doesn't exist
                if (!unit.pb.state.angularVel) {
                    unit.pb.state.angularVel = { x: 0, y: 0, z: 0 };
                }
                
                // Apply turning impulse to angular velocity
                unit.pb.state.angularVel.y += turnImpulse;
            }
            
            // Apply angular velocity to rotation (with damping)
            if (unit.pb.state.angularVel) {
                unit.pb.state.rot.y += unit.pb.state.angularVel.y * deltaTime;
                
                // Angular damping (tortles slow down naturally)
                unit.pb.state.angularVel.y *= 0.98; // 2% damping per frame
            }
        }
        
        // Add more unit AI/behavior updates here
        // - Movement towards targets
        // - State changes (idle -> moving -> attacking)
        // - Resource gathering
        // - Combat logic
        // etc.
    });
}

// Pre-calculate sin/cos lookup table for performance
const ANGLE_CACHE_SIZE = 360;
const sinCache = new Array(ANGLE_CACHE_SIZE);
const cosCache = new Array(ANGLE_CACHE_SIZE);
for (let i = 0; i < ANGLE_CACHE_SIZE; i++) {
    const angle = (i / ANGLE_CACHE_SIZE) * Math.PI * 2;
    sinCache[i] = Math.sin(angle);
    cosCache[i] = Math.cos(angle);
}

function getCachedSin(angle) {
    const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.floor((normalizedAngle / (Math.PI * 2)) * ANGLE_CACHE_SIZE);
    return sinCache[index];
}

function getCachedCos(angle) {
    const normalizedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.floor((normalizedAngle / (Math.PI * 2)) * ANGLE_CACHE_SIZE);
    return cosCache[index];
}

// Update unit mesh positions and rotations every frame
function updateUnitMeshes() {
    const currentTime = window.cachedTime || Date.now(); // Use cached time for performance
    const currentFrame = window.frameCounter || 0;
    
    gameUnits.forEach((unit, index) => {
        if (unit.mesh && unit.pb && unit.pb.state) {
            // GAMEPLAY UNITS (player/AI) - ALWAYS update mesh position every frame for smooth movement
            // NEUTRAL UNITS - Use LOD to skip frames for performance
            if (unit.owner === 'neutral' && !shouldUpdateUnit(unit, currentFrame)) {
                return; // Skip neutral units based on LOD
            }
            
            // Check if unit has active behavior - if so, skip animation system
            const hasActiveBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
            
            // Visual follows physics - position
            if (unit.pb.state.loc) {
                // MULTIPLAYER INTERPOLATION: For remote players, smoothly interpolate visual position
                const isRemoteUnit = window.isMultiplayer && unit.owner !== 'neutral' && 
                                     unit.owner !== window.player?.id?.slice(-6);
                
                if (isRemoteUnit) {
                    // Initialize visual position on first frame
                    if (!unit.visualPosition) {
                        unit.visualPosition = {
                            x: unit.pb.state.loc.x,
                            z: unit.pb.state.loc.z
                        };
                    }
                    
                    // Smoothly interpolate towards physics position
                    const dx = unit.pb.state.loc.x - unit.visualPosition.x;
                    const dz = unit.pb.state.loc.z - unit.visualPosition.z;
                    const distSq = dx * dx + dz * dz;
                    
                    // If very far away (> 10 units), snap immediately (probably teleported)
                    if (distSq > 100) {
                        unit.visualPosition.x = unit.pb.state.loc.x;
                        unit.visualPosition.z = unit.pb.state.loc.z;
                    } else {
                        // Smooth interpolation
                        unit.visualPosition.x += dx * unit.interpolationSpeed;
                        unit.visualPosition.z += dz * unit.interpolationSpeed;
                    }
                    
                    // Set mesh to interpolated position
                    unit.mesh.position.x = unit.visualPosition.x;
                    unit.mesh.position.z = unit.visualPosition.z;
                } else {
                    // Local player or neutral units: direct physics → visual
                    unit.mesh.position.x = unit.pb.state.loc.x;
                    unit.mesh.position.z = unit.pb.state.loc.z;
                }
                
                // Skip animation system for units with active behaviors
                if (hasActiveBehavior) {
                    // Just set Y position and continue to rotation
                    unit.mesh.position.y = unit.pb.state.loc.y;
                } else {
                    // Flying units get altitude boost
                    if (unit.abilities && unit.abilities.includes('fly')) {
                        // Add some flying height with slight bobbing
                        const flyHeight = 8 + getCachedSin(currentTime * 0.002 + unit.id.charCodeAt(0)) * 1.5;
                        unit.mesh.position.y = unit.pb.state.loc.y + flyHeight;
                        
                        // Birds fly in circles
                        if (unit.type === 'bird_messenger') {
                            // Debug: log bird status occasionally
                            if (Math.random() < 0.01) { // 1% chance to log
                                // console.log(`🐦 Bird ${unit.id}: physics=${!!unit.pb}, state=${!!unit.pb?.state}, loc=${!!unit.pb?.state?.loc}, rot=${!!unit.pb?.state?.rot}`);
                            }
                            
                            // Get unique time offset and radius for this bird
                            const timeOffset = unit.id.charCodeAt(0) * 100;
                            const radiusOffset = unit.id.charCodeAt(1) || 0;
                            const radius = 4 + (radiusOffset % 4); // 4-7 unit radius
                            
                            // Calculate circle position using cached time and trig
                            const circleTime = currentTime * 0.0008 + timeOffset; // Slow circular movement
                            const circleX = getCachedCos(circleTime) * radius;
                            const circleZ = getCachedSin(circleTime) * radius;
                            
                            // Update position (relative to spawn point stored in mesh data)
                            if (!unit.mesh.spawnPoint) {
                                // Store the original spawn point permanently
                                unit.mesh.spawnPoint = { 
                                    x: unit.pb.state.loc.x, 
                                    z: unit.pb.state.loc.z 
                                };
                                // console.log(`🐦 Bird ${unit.id} set permanent spawn point at (${unit.mesh.spawnPoint.x.toFixed(1)}, ${unit.mesh.spawnPoint.z.toFixed(1)})`);
                            }
                            
                            // Debug: log if spawn point changes unexpectedly
                            if (unit.mesh.spawnPoint && Math.random() < 0.001) { // 0.1% chance to log
                                const currentSpawn = unit.mesh.spawnPoint;
                                const expectedSpawn = { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
                                const distance = Math.sqrt(
                                    Math.pow(currentSpawn.x - expectedSpawn.x, 2) + 
                                    Math.pow(currentSpawn.z - expectedSpawn.z, 2)
                                );
                                
                                if (distance > 10) { // If spawn point is more than 10 units from expected
                                    // console.warn(`🐦 Bird ${unit.id} spawn point may have drifted! Current: (${currentSpawn.x.toFixed(1)}, ${currentSpawn.z.toFixed(1)}), Expected: (${expectedSpawn.x.toFixed(1)}, ${expectedSpawn.z.toFixed(1)}), Distance: ${distance.toFixed(1)}`);
                                }
                            }
                            
                            // Update both physics and visual position to avoid fighting
                            const newX = unit.mesh.spawnPoint.x + circleX;
                            const newZ = unit.mesh.spawnPoint.z + circleZ;
                            
                            // Safety check for physics body
                            if (unit.pb && unit.pb.state && unit.pb.state.loc) {
                                unit.pb.state.loc.x = newX;
                                unit.pb.state.loc.z = newZ;
                                unit.mesh.position.x = newX;
                                unit.mesh.position.z = newZ;
                                
                                // Face flight direction (tangent to circle) - add 90° to fix wing-first issue
                                const facingAngle = (-circleTime * 0.5 + Math.PI / 2 + Math.PI /4) % (Math.PI * 2);
                                
                                // Use rotation impulse system instead of directly setting rotation
                                // This works with our new movement system and prevents spinning
                                if (!unit.pb.rotImp) {
                                    unit.pb.rotImp = { x: 0, y: 0, z: 0 };
                                }
                                
                                // Calculate rotation difference and apply as impulse
                                const currentRotation = unit.pb.state.rot.y || 0;
                                let rotationDiff = facingAngle - currentRotation;
                                
                                // Handle angle wrapping
                                if (Math.abs(rotationDiff) > Math.PI) {
                                    rotationDiff = rotationDiff > 0 ? rotationDiff - Math.PI * 2 : rotationDiff + Math.PI * 2;
                                }
                                
                                // Apply rotation impulse (very gentle turning for smooth circular flight)
                                unit.pb.rotImp.y += rotationDiff * 0.1; // Super gentle for smooth bird flight
                                
                                // Don't set mesh rotation directly - let physics handle it
                                unit.mesh.rotationQuaternion = null;
                            } else {
                                // console.warn(`🐦 Bird ${unit.id} missing physics body or state!`);
                            }
                        }
                    } else {
                        // Ground units with occasional hopping
                        let hopHeight = 0;
                        
                        // Different behavior by unit type
                        if (unit.name.includes('Mushroom')) {
                            // Mushrooms breathe (scale) instead of hop
                            const breatheTimeOffset = unit.id.charCodeAt(0) * 50;
                            const breatheCycle = Math.sin((Date.now() + breatheTimeOffset) * 0.001); // Slow breathing
                            const scaleVariation = 1.0 + (breatheCycle * 0.08); // ±8% size variation
                            
                            unit.mesh.scaling.setAll(unit.scale * scaleVariation);
                            unit.mesh.position.y = unit.pb.state.loc.y; // No hopping
                            
                        } else if (unit.name.includes('Tortle')) {
                            // Tortles don't hop - they're slow and steady, just pivot occasionally
                            unit.mesh.position.y = unit.pb.state.loc.y; // No hopping - stay on ground!
                            
                            // Reset scaling to base scale (no breathing like mushrooms)
                            unit.mesh.scaling.setAll(unit.scale);
                            
                        } else if (unit.name.includes('Villager')) {
                            // Villagers don't hop - they're working or idle standing
                            unit.mesh.position.y = unit.pb.state.loc.y; // No hopping
                            
                        } else {
                            // Only frogs hop
                            let hopFrequency, hopAmplitude;
                            if (unit.name.includes('Frog')) {
                                // Each frog gets a unique hop frequency stretch factor
                                const stretchFactor = 0.7 + (unit.id.charCodeAt(2) % 100) / 100 * 0.6; // 0.7x to 1.3x speed
                                hopFrequency = 0.0012 * stretchFactor; // Individual hop timing!
                                hopAmplitude = 1.2;
                            } else {
                                // Other units (if any) get rare tiny hops
                                hopFrequency = 0.0002;
                                hopAmplitude = 0.3;
                            }
                            
                            // Create a pulsing hop pattern based on time and unit ID
                            const timeOffset = unit.id.charCodeAt(0) * 100;
                            const hopCycle = Math.sin((Date.now() + timeOffset) * hopFrequency);
                            
                            // Only hop when the sine wave is positive and above threshold
                            if (hopCycle > 0.7) {
                                // Quick hop up and down
                                const hopPhase = (hopCycle - 0.7) / 0.3; // Normalize to 0-1
                                hopHeight = Math.sin(hopPhase * Math.PI) * hopAmplitude;
                            }
                            
                            unit.mesh.position.y = unit.pb.state.loc.y + hopHeight;
                        }
                    }
                }
            }
            
            // Visual follows physics - rotation (force Euler angles, disable quaternions)
            if (unit.pb.state.rot) {
                // Disable quaternion rotation to force Euler angles
                unit.mesh.rotationQuaternion = null;
                
                // Visual follows physics rotation directly (logic updates handle behavior)
                unit.mesh.rotation.x = unit.pb.state.rot.x;
                unit.mesh.rotation.y = unit.pb.state.rot.y;
                unit.mesh.rotation.z = unit.pb.state.rot.z;
                
                // Apply model orientation offset if specified (for units like villagers that need to face forward)
                if (unit.modelOrientation) {
                    unit.mesh.rotation.y += unit.modelOrientation;
                }
                
                            // Handle child meshes - preserve their original rotations
            unit.mesh.getChildMeshes().forEach(mesh => {
                if (mesh.rotationQuaternion) {
                    // Store their original rotations if they have them
                    if (!mesh.originalRotation) {
                        const quaternion = mesh.rotationQuaternion.clone();
                        mesh.rotationQuaternion = null;
                        mesh.originalRotation = quaternion.toEulerAngles();
                        mesh.rotation.copyFrom(mesh.originalRotation);
                    }
                }
            });
            }
        }
    });
}

// Debug function to check current mesh rotations
function debugUnitRotations() {
    // console.log("Current unit rotations:");
    gameUnits.slice(0, 5).forEach((unit, i) => {
        if (unit.mesh) {
            // console.log(`Unit ${i}: pb.rot.y=${unit.pb.state.rot.y.toFixed(2)}, mesh.rot.y=${unit.mesh.rotation.y.toFixed(2)}, mesh.name=${unit.mesh.name}`);
            // console.log(`  Children count: ${unit.mesh.getChildren().length}`);
            unit.mesh.getChildren().forEach((child, ci) => {
                if (child.rotation) {
                    // console.log(`    Child ${ci}: ${child.name}, rot.y=${child.rotation.y.toFixed(2)}`);
                }
            });
        }
    });
}

// Debug function to show LOD statistics
function debugLODStats() {
    const stats = { NEAR: 0, FAR: 0, VERY_FAR: 0, HIDDEN: 0 };
    let totalUnits = 0;
    
    gameUnits.forEach(unit => {
        if (unit.distanceToCamera <= LOD_DISTANCES.NEAR) {
            stats.NEAR++;
        } else if (unit.distanceToCamera <= LOD_DISTANCES.FAR) {
            stats.FAR++;
        } else if (unit.distanceToCamera <= LOD_DISTANCES.HIDDEN) {
            stats.VERY_FAR++;
        } else {
            stats.HIDDEN++;
        }
        totalUnits++;
    });
    
    // console.log(`LOD Stats (${totalUnits} total units):`);
    // console.log(`  NEAR (≤${LOD_DISTANCES.NEAR}): ${stats.NEAR} units (${((stats.NEAR/totalUnits)*100).toFixed(1)}%)`);
    // console.log(`  FAR (≤${LOD_DISTANCES.FAR}): ${stats.FAR} units (${((stats.FAR/totalUnits)*100).toFixed(1)}%)`);
    // console.log(`  VERY_FAR (≤${LOD_DISTANCES.HIDDEN}): ${stats.VERY_FAR} units (${((stats.VERY_FAR/totalUnits)*100).toFixed(1)}%)`);
    // console.log(`  HIDDEN (>${LOD_DISTANCES.HIDDEN}): ${stats.HIDDEN} units (${((stats.HIDDEN/totalUnits)*100).toFixed(1)}%)`);
}


// Destroy a unit completely with particle cleanup
function destroyUnit(unit) {
    // console.log(`💥 Destroying unit: ${unit.name || unit.type}`);
    
    // Add destruction effects
    if (unit.mesh) {
        const pos = unit.mesh.getAbsolutePosition();
        
        // Create destruction explosion (smaller than building)
        if (window.fx) {
            window.fx.createExplosion(pos, 0.3);
        }
    }
    
    // Remove particle effects
    if (window.fx) {
        window.fx.removeParticleEffects(unit);
    }
    
    // Remove from behavior manager
    if (window.behaviorManager && window.behaviorManager.behaviors) {
        window.behaviorManager.behaviors.delete(unit);
    }
    
    // Remove from scene
    if (unit.mesh) {
        unit.mesh.dispose();
    }
    
    // Remove from global units array
    const globalIndex = gameUnits.indexOf(unit);
    if (globalIndex > -1) {
        gameUnits.splice(globalIndex, 1);
    }
    
    // Remove from player units if applicable
    if (window.player && window.player.units) {
        const playerIndex = window.player.units.indexOf(unit);
        if (playerIndex > -1) {
            window.player.units.splice(playerIndex, 1);
        }
    }
    
    // Remove from opponent units if applicable
    if (window.opponent && window.opponent.units) {
        const opponentIndex = window.opponent.units.indexOf(unit);
        if (opponentIndex > -1) {
            window.opponent.units.splice(opponentIndex, 1);
        }
    }
    
    // console.log(`🗑️ Unit ${unit.name || unit.type} completely destroyed`);
}

// Clear and respawn all units
function respawnUnits(scene) {
    // Properly destroy all existing units with cleanup
    gameUnits.forEach(unit => {
        destroyUnit(unit);
    });
    
    gameUnits.length = 0; // Clear the array
    sprinkleUnits();
    spawnUnitModels(scene);
}

// Spawn villagers around the player's agora
function spawnAgoraVillagers() {
    // console.log("🏘️ spawnAgoraVillagers called!");
    
    if (!window.player || !window.player.agora) {
        // console.warn("❌ Player or agora not found for villager spawning");
        return;
    }
    
    if (!TILE_SIZE) {
        // console.warn("❌ TILE_SIZE not defined");
        return;
    }
    
    const agoraX = window.player.agora.x * TILE_SIZE;
    const agoraZ = window.player.agora.y * TILE_SIZE;
    
    // console.log(`📍 Agora at (${agoraX}, ${agoraZ}), spawning villagers...`);
    
    // Spawn 8-12 villagers around the agora
    const villagerCount = 8 + Math.floor(Math.random() * 5);
    // console.log(`👥 Will spawn ${villagerCount} villagers`);
    
    for (let i = 0; i < villagerCount; i++) {
        // Random position around agora (within 3-6 tiles)
        const angle = (i / villagerCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        const distance = 3 + Math.random() * 3;
        
        const x = agoraX + Math.cos(angle) * distance * TILE_SIZE;
        const z = agoraZ + Math.sin(angle) * distance * TILE_SIZE;
        
        const villager = new Unit('villager', { x, y: 0, z });
        villager.owner = 'player';
        
        // Random rotation
        const randomRotation = Math.random() * Math.PI * 2;
        villager.rotation = randomRotation;
        if (villager.pb.state && villager.pb.state.rot) {
            villager.pb.state.rot.y = randomRotation;
        }
        
        // Add to player's units
        window.player.units.push(villager);
        gameUnits.push(villager); // Also add to global array for rendering (but NOT neutralUnits)
        
        // console.log(`🏘️ Spawned villager ${i+1} at agora, total villagers: ${window.player.units.length}`);
    }
    
    // console.log(`✅ Spawned ${villagerCount} villagers around the agora`);
}

// Auto-initialize units when the scene is ready (MENU SCENE ONLY)
let autoInitDisabled = false; // Flag to permanently disable auto-init once a match starts

function autoInitUnits() {
    // CRITICAL: Only auto-spawn neutral units in menu scene, NOT during actual matches
    if (autoInitDisabled || window.game || window.currentMatch || window.isMultiplayer) {
        // console.log('🚫 Skipping autoInitUnits - match is active or disabled');
        return;
    }
    
    if (window.gfx && window.gfx.scene) {
        console.log("🎨 Auto-initializing neutral units for menu scene...");
        sprinkleUnits(); // Neutral units spread across map
        spawnUnitModels(window.gfx.scene);
    } else {
        // Try again in 1 second if scene isn't ready
        setTimeout(autoInitUnits, 1000);
    }
}

// Recruit a unit (handles both single-player and multiplayer)
function recruitUnit(unitType, options = {}) {
  // MULTIPLAYER: Use synchronized train command
  if (window.isMultiplayer && window.currentMatch && window.player) {
    const normalizedPlayerId = window.player.id?.length > 6 ? window.player.id.slice(-6) : window.player.id;
    
    const agoraBuilding = window.playerBuildings?.find(b => {
      const normalizedOwner = b.owner?.length > 6 ? b.owner.slice(-6) : b.owner;
      return b.type === 'agora' && normalizedOwner === normalizedPlayerId;
    });
    
    if (agoraBuilding) {
      // CRITICAL: Always use normalized player ID in commands
      window.currentMatch.submitCommand({
        type: 'train',
        playerId: normalizedPlayerId,  // Use normalized ID, not window.player.id
        buildingId: agoraBuilding.id,
        unitType: unitType
      });
      return true;
    } else {
      console.warn(`❌ Cannot recruit ${unitType}: No agora found`);
      return false;
    }
  }
  
  // SINGLE-PLAYER: Create directly at agora
  if (window.player && window.player.agora) {
    const agoraX = window.player.agora.x * TILE_SIZE;
    const agoraZ = window.player.agora.y * TILE_SIZE;
    
    const unit = new Unit(unitType, { x: agoraX, y: 0, z: agoraZ });
    unit.owner = 'player';
    
    const randomRotation = Math.random() * Math.PI * 2;
    unit.rotation = randomRotation;
    if (unit.pb && unit.pb.state && unit.pb.state.rot) {
      unit.pb.state.rot.y = randomRotation;
    }
    
    window.player.units.push(unit);
    window.gameUnits.push(unit);
    
    if (window.gfx && window.gfx.scene) {
      window.spawnUnitModels(window.gfx.scene);
    }
    return true;
  }
  
  return false;
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.UnitTypes = UnitTypes;
    window.Unit = Unit;
    window.recruitUnit = recruitUnit;
    window.spawnAgoraVillagers = spawnAgoraVillagers;
    window.getUnitDef = getUnitDef;
    window.getUnitsByCategory = getUnitsByCategory;
    window.gameUnits = gameUnits; // All units (for rendering)
    window.neutralUnits = neutralUnits; // Just neutral units
    window.sprinkleUnits = sprinkleUnits;
    window.spawnUnitModels = spawnUnitModels;
    window.updateUnits = updateUnits;
    window.updateUnitMeshes = updateUnitMeshes;
    window.respawnUnits = respawnUnits;
    window.debugUnitRotations = debugUnitRotations;
    window.destroyUnit = destroyUnit;
    
    // LOD system exports
    window.LOD_DISTANCES = LOD_DISTANCES;
    window.debugLODStats = debugLODStats;
    window.updateUnitDistances = updateUnitDistances;
    
    // Export auto-init control
    Object.defineProperty(window, 'autoInitDisabled', {
      get: () => autoInitDisabled,
      set: (value) => { autoInitDisabled = value; },
      configurable: true
    });
    
    // Auto-start the initialization
    setTimeout(autoInitUnits, 2000); // Wait 2 seconds for scene to be ready
}



// Apply team colors using material replacement
function applyTeamColorsToMesh(mesh, teamColor) {
  if (!mesh || !teamColor) return false;
  
  const scene = mesh.getScene();
  if (!scene) return false;
  
  let changed = false;
  
  // Parse the team color
  const cleanColor = teamColor.replace('#', '');
  const r = parseInt(cleanColor.substr(0, 2), 16) / 255;
  const g = parseInt(cleanColor.substr(2, 2), 16) / 255;
  const b = parseInt(cleanColor.substr(4, 2), 16) / 255;
  const color = new BABYLON.Color3(r, g, b);
  
  // Check main mesh
  if (mesh.material && mesh.material.name && mesh.material.name.includes('TeamColor')) {
    const teamMaterial = mesh.material.clone(`team_${teamColor}_${Date.now()}`);
    
    // Apply team color with disabled lighting
    teamMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
    teamMaterial.emissiveColor = color.scale(0.4);
    teamMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
    teamMaterial.roughness = 1.0;
    teamMaterial.metallic = 0.0;
    teamMaterial.disableLighting = true;
    
    // Disable textures
    teamMaterial.diffuseTexture = null;
    teamMaterial.emissiveTexture = null;
    teamMaterial.specularTexture = null;
    teamMaterial.normalTexture = null;
    teamMaterial.ambientTexture = null;
    
    mesh.material = teamMaterial;
    changed = true;
  }
  
  // Check child meshes
  if (mesh.getChildMeshes) {
    mesh.getChildMeshes().forEach((childMesh) => {
      if (childMesh.material && childMesh.material.name && childMesh.material.name.includes('TeamColor')) {
        const teamMaterial = childMesh.material.clone(`team_${teamColor}_${Date.now()}`);
        
        // Apply team color with disabled lighting
        teamMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        teamMaterial.emissiveColor = color.scale(0.4);
        teamMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        teamMaterial.roughness = 1.0;
        teamMaterial.metallic = 0.0;
        teamMaterial.disableLighting = true;
        
        // Disable textures
        teamMaterial.diffuseTexture = null;
        teamMaterial.emissiveTexture = null;
        teamMaterial.specularTexture = null;
        teamMaterial.normalTexture = null;
        teamMaterial.ambientTexture = null;
        
        childMesh.material = teamMaterial;
        changed = true;
      }
    });
  }
  
  return changed;
}


// Apply team colors to all units and buildings
function applyTeamColorsToAll() {
  let processedCount = 0;
  
  // Apply to all units
  if (window.gameUnits) {
    window.gameUnits.forEach(unit => {
      if (unit.mesh) {
        const teamColor = getTeamColorForOwner(unit.owner || 'neutral');
        const changed = applyTeamColorsToMesh(unit.mesh, teamColor);
        if (changed) processedCount++;
      }
    });
  }
  
  // Apply to all buildings
  if (window.gameBuildings) {
    window.gameBuildings.forEach(building => {
      if (building.mesh) {
        const teamColor = getTeamColorForOwner(building.owner || 'neutral');
        const changed = applyTeamColorsToMesh(building.mesh, teamColor);
        if (changed) processedCount++;
      }
    });
  }
  
  return processedCount;
}

// Get team color for an owner
function getTeamColorForOwner(owner) {
  if (owner === 'player') {
    return window.player ? window.player.color : '#4A90E2';
  }
  
  const teamColors = {
    'opponent': '#E24A4A',  // Red
    'neutral': '#8A8A8A'    // Gray
  };
  
  return teamColors[owner] || teamColors.neutral;
}


// Export team color functions
if (typeof window !== 'undefined') {
    window.applyTeamColorsToAll = applyTeamColorsToAll;
    window.applyTeamColorsToMesh = applyTeamColorsToMesh;
    window.getTeamColorForOwner = getTeamColorForOwner;
}