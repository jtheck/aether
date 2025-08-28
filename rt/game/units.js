


// Unit type definitions - all unit attributes in one place
const UnitTypes = {
  // NPCs and Creatures
  villager: {
    name: "Villager",
    category: "npc",
    model: "assets/models/tortle.glb",
    scale: 0.1,
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
    
    console.log(`Created ${this.name} at position`, this.position);
}

// Helper function to get unit definition by type
function getUnitDef(unitType) {
    return UnitTypes[unitType];
}

// Helper function to list all unit types in a category
function getUnitsByCategory(category) {
    return Object.keys(UnitTypes).filter(type => UnitTypes[type].category === category);
}

// Global units array
const gameUnits = [];

// Sprinkle units across the terrain
function sprinkleUnits() {
    console.log("Sprinkling units across the terrain...");
    
    const unitTypes = ['villager', 'frog_scout', 'mushroom_mage', 'bird_messenger'];
    
    // Spread units from (0,0) to (10,10) 
    for (let x = 1; x <= 10; x += 2) {
        for (let z = 1; z <= 10; z += 2) {
            // Random unit type
            const randomType = unitTypes[Math.floor(Math.random() * unitTypes.length)];
            
            // Add some random offset within the grid cell
            const offsetX = (Math.random() - 0.5) * 1.5;
            const offsetZ = (Math.random() - 0.5) * 1.5;
            
            const unit = new Unit(randomType, {
                x: x + offsetX, 
                y: 0, 
                z: z + offsetZ
            });
            
            // Add random rotation to the unit and physics body
            const randomRotation = Math.random() * Math.PI * 2;
            unit.rotation = randomRotation;
            if (unit.pb.state && unit.pb.state.rot) {
                unit.pb.state.rot.y = randomRotation;
                console.log(`Unit ${unit.name} rotation set to:`, randomRotation, 'rad =', (randomRotation * 180/Math.PI).toFixed(1), 'deg');
            }
            
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
            window.gfx.getModel(unit.model, scene).then(model => {
                unit.mesh = model.root;
                unit.mesh.scaling = new BABYLON.Vector3(unit.scale, unit.scale, unit.scale);
                
                // Initial position from physics body
                if (unit.pb && unit.pb.state && unit.pb.state.loc) {
                    unit.mesh.position.x = unit.pb.state.loc.x;
                    unit.mesh.position.y = unit.pb.state.loc.y;
                    unit.mesh.position.z = unit.pb.state.loc.z;
                }
                
                // Apply random rotation
                if (unit.rotation !== undefined) {
                    unit.mesh.rotation.y = unit.rotation;
                }
                
                console.log(`Spawned model for ${unit.name} at`, unit.pb.state.loc);
            }).catch(err => {
                console.warn(`Failed to load model for ${unit.name}:`, err);
            });
        }
    });
}

// Update unit mesh positions and rotations every frame
function updateUnitMeshes() {
    gameUnits.forEach((unit, index) => {
        if (unit.mesh && unit.pb && unit.pb.state) {
            // Visual follows physics - position
            if (unit.pb.state.loc) {
                unit.mesh.position.x = unit.pb.state.loc.x;
                unit.mesh.position.z = unit.pb.state.loc.z;
                
                // Flying units get altitude boost
                if (unit.abilities && unit.abilities.includes('fly')) {
                    // Add some flying height with slight bobbing
                    const flyHeight = 8 + Math.sin(Date.now() * 0.002 + unit.id.charCodeAt(0)) * 1.5;
                    unit.mesh.position.y = unit.pb.state.loc.y + flyHeight;
                } else {
                    unit.mesh.position.y = unit.pb.state.loc.y;
                }
            }
            
            // Visual follows physics - rotation (force Euler angles, disable quaternions)
            if (unit.pb.state.rot) {
                // Disable quaternion rotation to force Euler angles
                unit.mesh.rotationQuaternion = null;
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

// Auto-initialize units when the scene is ready
function autoInitUnits() {
    if (window.gfx && window.gfx.scene) {
        console.log("Auto-initializing units...");
        sprinkleUnits();
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
    window.getUnitDef = getUnitDef;
    window.getUnitsByCategory = getUnitsByCategory;
    window.gameUnits = gameUnits;
    window.sprinkleUnits = sprinkleUnits;
    window.spawnUnitModels = spawnUnitModels;
    window.updateUnitMeshes = updateUnitMeshes;
    window.respawnUnits = respawnUnits;
    window.debugUnitRotations = debugUnitRotations;
    
    // Auto-start the initialization
    setTimeout(autoInitUnits, 2000); // Wait 2 seconds for scene to be ready
}