


// Unit type definitions - all unit attributes in one place
const UnitTypes = {
  // NPCs and Creatures
  villager: {
    name: "Villager",
    category: "npc",
    model: "assets/models/villager.glb",
    scale: 0.5, // Made bigger so they're visible
    health: 50,
    speed: 2,
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
    size: 0.8,
    cost: { food: 20, wood: 10 },
    abilities: ["scout", "stealth"],
    description: "Fast reconnaissance unit with stealth capabilities"
  },
  
  tree_guardian: {
    name: "Tree Guardian",
    category: "military", 
    model: "assets/models/tree.glb",
    scale: 0.8,
    health: 150,
    speed: 1,
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
    size: 1,
    cost: { food: 30, stone: 15 },
    abilities: ["build", "repair", "fortify"],
    description: "Specialized construction unit with enhanced building abilities"
  }
};

// Unit constructor that uses the definitions
function Unit(unitType, position, options = {}) {
    const def = UnitTypes[unitType];
    if (!def) {
        console.error(`Unknown unit type: ${unitType}`);
        return null;
    }
    
    // Copy all properties from definition
    Object.assign(this, def);
    
    // Unit instance properties
    this.type = unitType; // Store the original unit type
    this.id = options.id || Math.random().toString(36).substr(2, 9);
    this.position = position || { x: 0, y: 0, z: 0 };
    this.currentHealth = this.health;
    this.level = options.level || 1;
    this.experience = options.experience || 0;
    this.owner = options.owner || 'player';
    this.state = 'idle'; // idle, moving, attacking, working, etc.
    this.target = null;
    this.inventory = options.inventory || {};
    
    // Physics body
    this.pb = new PBody();
    
    // Sync physics body position with unit position
    if (this.pb.state && this.pb.state.loc) {
        this.pb.state.loc.x = this.position.x;
        this.pb.state.loc.y = this.position.y;
        this.pb.state.loc.z = this.position.z;
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

// Global units arrays
const gameUnits = []; // All units combined (for rendering)
const neutralUnits = []; // Wild/neutral units only

// Sprinkle units across the terrain
function sprinkleUnits() {
    console.log("Sprinkling units across the terrain...");
    
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
    
    console.log(`Created ${gameUnits.length} units`);
}

// Spawn visual models for all units
function spawnUnitModels(scene) {
    console.log("Spawning visual models for units...");
    
    gameUnits.forEach(unit => {
        if (!unit.mesh && window.gfx && window.gfx.getModel) {
            // Load the 3D model for this unit
            // console.log(`🎮 Loading model ${unit.model} for ${unit.name} (scale: ${unit.scale})`);
            window.gfx.getModel(unit.model, scene).then(model => {
                unit.mesh = model.root;
                unit.mesh.scaling = new BABYLON.Vector3(unit.scale, unit.scale, unit.scale);
                
                // Make unit meshes pickable for selection
                unit.mesh.isPickable = true;
                unit.mesh.getChildMeshes().forEach(child => {
                    child.isPickable = true;
                });
                
                // Initial position from physics body
                if (unit.pb && unit.pb.state && unit.pb.state.loc) {
                    unit.mesh.position.x = unit.pb.state.loc.x;
                    unit.mesh.position.y = unit.pb.state.loc.y;
                    unit.mesh.position.z = unit.pb.state.loc.z;
                    // console.log(`📍 ${unit.name} positioned at (${unit.mesh.position.x.toFixed(1)}, ${unit.mesh.position.y.toFixed(1)}, ${unit.mesh.position.z.toFixed(1)}) with scale ${unit.scale}`);
                }
                
                // Apply random rotation
                if (unit.rotation !== undefined) {
                    unit.mesh.rotation.y = unit.rotation;
                }
                
                // console.log(`✅ Successfully spawned ${unit.name} model at`, unit.pb.state.loc);
            }).catch(err => {
                console.warn(`Failed to load model for ${unit.name}:`, err);
            });
        }
    });
}

// Update unit logic, AI, and behaviors
function updateUnits(deltaTime) {
    gameUnits.forEach(unit => {
        if (!unit.pb || !unit.pb.state) return;
        
        // Update unit behaviors based on type
        if (unit.name.includes('Tortle')) {
            // Tortles get random turning impulses
            const turnTimeOffset = unit.id.charCodeAt(1) * 50;
            const turnCycle = Math.sin((Date.now() + turnTimeOffset) * 0.00008); // Very slow
            
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
    const currentTime = Date.now(); // Cache time for performance
    gameUnits.forEach((unit, index) => {
        if (unit.mesh && unit.pb && unit.pb.state) {
            // Visual follows physics - position
            if (unit.pb.state.loc) {
                unit.mesh.position.x = unit.pb.state.loc.x;
                unit.mesh.position.z = unit.pb.state.loc.z;
                
                // Flying units get altitude boost
                if (unit.abilities && unit.abilities.includes('fly')) {
                    // Add some flying height with slight bobbing
                    const flyHeight = 8 + getCachedSin(currentTime * 0.002 + unit.id.charCodeAt(0)) * 1.5;
                    unit.mesh.position.y = unit.pb.state.loc.y + flyHeight;
                    
                    // Birds fly in circles
                    if (unit.type === 'bird_messenger') {
                        // Get unique time offset and radius for this bird
                        const timeOffset = unit.id.charCodeAt(0) * 100;
                        const radiusOffset = unit.id.charCodeAt(1) || 0;
                        const radius = 4 + (radiusOffset % 4); // 4-7 unit radius
                        
                        // Calculate circle position using cached time and trig
                        const circleTime = currentTime * 0.0008 + timeOffset; // Slow circular movement
                        const circleX = getCachedCos(circleTime) * radius;
                        const circleZ = getCachedSin(circleTime) * radius;
                        
                        // Debug removed - circular movement confirmed working
                        
                        // Update position (relative to spawn point stored in mesh data)
                        if (!unit.mesh.spawnPoint) {
                            unit.mesh.spawnPoint = { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
                        }
                        
                        // Update both physics and visual position to avoid fighting
                        const newX = unit.mesh.spawnPoint.x + circleX;
                        const newZ = unit.mesh.spawnPoint.z + circleZ;
                        
                        unit.pb.state.loc.x = newX;
                        unit.pb.state.loc.z = newZ;
                        unit.mesh.position.x = newX;
                        unit.mesh.position.z = newZ;
                        
                        // Face flight direction (tangent to circle) - add 90° to fix wing-first issue
                        const facingAngle = (-circleTime * 0.5 + Math.PI / 2 + Math.PI /4) % (Math.PI * 2);
                        
                        // Update physics body rotation (this probably drives the visual)
                        unit.pb.state.rot.y = facingAngle;
                        
                        // Also try mesh rotation as backup
                        unit.mesh.rotationQuaternion = null;
                        unit.mesh.rotation.y = facingAngle;
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
                        
                    } else {
                        // Only frogs and villagers hop
                        let hopFrequency, hopAmplitude;
                        if (unit.name.includes('Frog')) {
                            // Each frog gets a unique hop frequency stretch factor
                            const stretchFactor = 0.7 + (unit.id.charCodeAt(2) % 100) / 100 * 0.6; // 0.7x to 1.3x speed
                            hopFrequency = 0.0012 * stretchFactor; // Individual hop timing!
                            hopAmplitude = 1.2;
                        } else if (unit.name.includes('Villager')) {
                            hopFrequency = 0.0003; // Occasional subtle hops
                            hopAmplitude = 0.4;
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
            
            // Visual follows physics - rotation (force Euler angles, disable quaternions)
            if (unit.pb.state.rot) {
                // Disable quaternion rotation to force Euler angles
                unit.mesh.rotationQuaternion = null;
                
                // Visual follows physics rotation directly (logic updates handle behavior)
                unit.mesh.rotation.x = unit.pb.state.rot.x;
                unit.mesh.rotation.y = unit.pb.state.rot.y;
                unit.mesh.rotation.z = unit.pb.state.rot.z;
                
                // Also rotate child meshes (where the actual geometry is)
                unit.mesh.getChildren().forEach(child => {
                    if (child.rotation) {
                        child.rotationQuaternion = null; // Disable quaternions
                        child.rotation.x = unit.pb.state.rot.x;
                        child.rotation.y = unit.pb.state.rot.y;
                        child.rotation.z = unit.pb.state.rot.z;
                    }
                });
            }
        }
    });
}

// Debug function to check current mesh rotations
function debugUnitRotations() {
    console.log("Current unit rotations:");
    gameUnits.slice(0, 5).forEach((unit, i) => {
        if (unit.mesh) {
            console.log(`Unit ${i}: pb.rot.y=${unit.pb.state.rot.y.toFixed(2)}, mesh.rot.y=${unit.mesh.rotation.y.toFixed(2)}, mesh.name=${unit.mesh.name}`);
            console.log(`  Children count: ${unit.mesh.getChildren().length}`);
            unit.mesh.getChildren().forEach((child, ci) => {
                if (child.rotation) {
                    console.log(`    Child ${ci}: ${child.name}, rot.y=${child.rotation.y.toFixed(2)}`);
                }
            });
        }
    });
}


// Clear and respawn all units
function respawnUnits(scene) {
    gameUnits.length = 0; // Clear existing units
    sprinkleUnits();
    spawnUnitModels(scene);
}

// Spawn villagers around the player's agora
function spawnAgoraVillagers() {
    console.log("🏘️ spawnAgoraVillagers called!");
    
    if (!window.player || !window.player.agora) {
        console.warn("❌ Player or agora not found for villager spawning");
        return;
    }
    
    if (!TILE_SIZE) {
        console.warn("❌ TILE_SIZE not defined");
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
        
        // console.log(`🏘️ Spawned villager ${i+1} at agora`);
    }
    
    // console.log(`✅ Spawned ${villagerCount} villagers around the agora`);
}

// Auto-initialize units when the scene is ready
function autoInitUnits() {
    if (window.gfx && window.gfx.scene) {
        console.log("Auto-initializing units...");
        sprinkleUnits(); // Neutral units spread across map
        spawnUnitModels(window.gfx.scene);
    } else {
        // Try again in 1 second if scene isn't ready
        setTimeout(autoInitUnits, 1000);
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.UnitTypes = UnitTypes;
    window.Unit = Unit;
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
    
    // Auto-start the initialization
    setTimeout(autoInitUnits, 2000); // Wait 2 seconds for scene to be ready
}