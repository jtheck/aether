

// Multiplayer interpolation settings
const REMOTE_UNIT_INTERPOLATION_SPEED = 0.5; // Fast interpolation for remote units (50% per frame = responsive, matches local units)
const LOCAL_UNIT_INTERPOLATION_SPEED = 0.5; // Faster interpolation for local units (50% per frame = nearly instant)

// Unit type definitions - all unit attributes in one place
const UnitTypes = {
  
  // ═══════════════════════════════════════════════════════════════
  // CIVILIAN & WORKER UNITS
  // ═══════════════════════════════════════════════════════════════
  
  villager: {
    name: "Villager",
    category: "civilian",
    model: "assets/models/villager.glb",
    scale: 0.5,
    health: 50,
    speed: 80,
    rotationSpeed: 3.0,
    size: 1,
    cost: { food: 15 },
    abilities: ["gather", "build"],
    upgradeTo: "brigand",
    description: "Basic civilian unit that can gather resources and construct buildings",
    notes: "DEFEAT: Runs home crying, needs time to recover at village before working again"
  },

  brigand: {
    name: "Brigand",
    category: "civilian",
    model: "assets/models/brigand.glb",
    scale: 0.5,
    health: 65,
    speed: 31,
    rotationSpeed: 4.0,
    size: 1,
    cost: { food: 20, wood: 10 },
    abilities: ["gather", "build", "sneak"],
    upgradeFrom: "villager",
    description: "Upgraded villager with stealth capabilities and faster movement",
    notes: "DEFEAT: Flees into the woods, might return later as a nuisance to both sides"
  },

  engineer: {
    name: "Engineer",
    category: "worker",
    model: "assets/models/engineer.glb",
    scale: 0.5,
    health: 50,
    speed: 21,
    rotationSpeed: 4.0,
    size: 1,
    cost: { food: 35, stone: 20 },
    abilities: ["build", "repair"],
    upgradeTo: "architect",
    description: "Skilled builder who can construct advanced structures",
    notes: "DEFEAT: Drops tools and surrenders, can be 'hired' by the victor"
  },

  architect: {
    name: "Architect",
    category: "worker",
    model: "assets/models/engineer.glb", // TODO: unique model
    scale: 0.5,
    health: 60,
    speed: 21,
    rotationSpeed: 4.0,
    size: 1,
    cost: { food: 50, stone: 40 },
    abilities: ["build", "repair", "fortify"],
    upgradeFrom: "engineer",
    description: "Master builder who can fortify and upgrade buildings",
    notes: "DEFEAT: Dramatically faints onto blueprints, revives at workshop"
  },

  // ═══════════════════════════════════════════════════════════════
  // SUPPORT UNITS
  // ═══════════════════════════════════════════════════════════════

  monk: {
    name: "Monk",
    category: "support",
    model: "assets/models/monk.glb",
    scale: 0.5,
    health: 45,
    speed: 35,
    rotationSpeed: 8.0,
    size: 1,
    cost: { food: 20, wood: 10 },
    abilities: ["heal", "kick"],
    upgradeTo: "paladin",
    description: "Holy warrior with healing abilities and powerful kicks",
    notes: "DEFEAT: Sits down to meditate, becomes invulnerable but useless until meditation ends"
  },

  paladin: {
    name: "Paladin",
    category: "support",
    model: "assets/models/paladin.glb",
    scale: 0.55,
    health: 80,
    speed: 28,
    rotationSpeed: 6.0,
    size: 1,
    cost: { food: 40, wood: 30 },
    abilities: ["heal", "kick", "bless", "shield"],
    upgradeFrom: "monk",
    description: "Elite holy warrior with enhanced healing and protective auras",
    notes: "DEFEAT: Kneels in prayer, glows briefly, then teleports back to church"
  },

  // ═══════════════════════════════════════════════════════════════
  // CASTER UNITS
  // ═══════════════════════════════════════════════════════════════

  wizard: {
    name: "Wizard",
    category: "caster",
    model: "assets/models/wizard.glb",
    scale: 0.5,
    health: 40,
    speed: 30,
    rotationSpeed: 8.0,
    size: 1,
    cost: { food: 30, wood: 20 },
    abilities: ["fireball", "teleport"],
    upgradeTo: "elemental",
    description: "Powerful magic user with offensive spells",
    notes: "DEFEAT: POOF! Teleports away in a puff of smoke, reappears at lab"
  },

  elemental: {
    name: "Elemental",
    category: "caster",
    model: "assets/models/elemental.glb",
    scale: 0.6,
    health: 70,
    speed: 35,
    rotationSpeed: 8.0,
    size: 1,
    cost: { food: 50, wood: 50 },
    abilities: ["fireball", "teleport", "storm", "summon"],
    upgradeFrom: "wizard",
    description: "Ascended wizard wielding raw elemental forces",
    notes: "DEFEAT: Dissolves into swirling elemental particles, reforms at moon well"
  },

  warlock: {
    name: "Warlock",
    category: "caster",
    model: "assets/models/warlock.glb",
    scale: 0.5,
    health: 45,
    speed: 25,
    rotationSpeed: 6.0,
    size: 1,
    cost: { food: 35, wood: 30 },
    abilities: ["curse", "drain", "hex"],
    spawner: "tavern",
    upgradeTo: "geomancer",
    description: "Dark caster specializing in curses and life drain",
    notes: "DEFEAT: Sinks into shadow portal, sulks at tavern for a while"
  },

  geomancer: {
    name: "Geomancer",
    category: "caster",
    model: "assets/models/wizard.glb", // TODO: unique model
    scale: 0.55,
    health: 65,
    speed: 25,
    rotationSpeed: 6.0,
    size: 1,
    cost: { food: 55, wood: 60 },
    abilities: ["curse", "drain", "earthquake", "terraform"],
    spawner: "tavern",
    upgradeFrom: "warlock",
    description: "Master of earth magic who can reshape the battlefield",
    notes: "DEFEAT: Turns to stone briefly, crumbles, reforms from nearby rocks"
  },

  // ═══════════════════════════════════════════════════════════════
  // MILITARY UNITS (Barracks)
  // ═══════════════════════════════════════════════════════════════

  warrior: {
    name: "Warrior",
    category: "military",
    model: "assets/models/warrior.glb",
    scale: 0.5,
    health: 80,
    speed: 22,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 25, wood: 15 },
    abilities: ["melee", "charge"],
    spawner: "barracks",
    prerequisites: {
      buildings: ["barracks"]
    },
    upgradeTo: "champion",
    description: "Frontline melee fighter with heavy armor",
    notes: "DEFEAT: Drops weapon, raises hands in surrender, walks to nearest barracks"
  },

  champion: {
    name: "Champion",
    category: "military",
    model: "assets/models/brigand.glb", // TODO: unique model
    scale: 0.55,
    health: 120,
    speed: 24,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 45, wood: 40 },
    abilities: ["melee", "charge", "rally", "cleave"],
    spawner: "barracks",
    upgradeFrom: "warrior",
    description: "Elite warrior who inspires nearby allies",
    notes: "DEFEAT: Salutes opponent respectfully, limps off dramatically to recover honor"
  },

  archer: {
    name: "Archer",
    category: "military",
    model: "assets/models/archer.glb",
    scale: 0.5,
    health: 45,
    speed: 26,
    rotationSpeed: 6.0,
    size: 1,
    cost: { food: 20, wood: 25 },
    abilities: ["ranged", "volley"],
    spawner: "barracks",
    prerequisites: {
      buildings: ["barracks"]
    },
    upgradeTo: "ballister",
    description: "Ranged unit effective against light units",
    notes: "DEFEAT: Bow snaps comically, runs away embarrassed"
  },

  ballister: {
    name: "Ballister",
    category: "military",
    model: "assets/models/brigand.glb", // TODO: unique model
    scale: 0.5,
    health: 55,
    speed: 24,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 35, wood: 45, stone: 10 },
    abilities: ["ranged", "volley", "siege"],
    spawner: "barracks",
    upgradeFrom: "archer",
    description: "Heavy crossbow specialist effective against buildings",
    notes: "DEFEAT: Crossbow jams and explodes harmlessly, retreats to workshop for repairs"
  },

  // ═══════════════════════════════════════════════════════════════
  // VEHICLE UNITS
  // ═══════════════════════════════════════════════════════════════

  wagon: {
    name: "Wagon",
    category: "vehicle",
    model: "assets/models/wagon.glb",
    scale: 0.4,
    health: 60,
    speed: 18,
    rotationSpeed: 2.0,
    size: 2,
    cost: { wood: 40, stone: 10 },
    abilities: ["transport", "deploy"],
    upgradeTo: "war_wagon",
    description: "Transport vehicle that can carry units and resources",
    notes: "DEFEAT: Wheels fall off cartoonishly, driver runs away, can be repaired"
  },

  war_wagon: {
    name: "War Wagon",
    category: "vehicle",
    model: "assets/models/camp.glb", // TODO: unique model
    scale: 0.45,
    health: 100,
    speed: 16,
    rotationSpeed: 2.0,
    size: 2,
    cost: { wood: 70, stone: 25 },
    abilities: ["transport", "deploy", "ranged"],
    upgradeFrom: "wagon",
    description: "Armored wagon with mounted weapons",
    notes: "DEFEAT: Crew bails out with parachutes(?!), wagon rolls away empty"
  },

  // ═══════════════════════════════════════════════════════════════
  // ELEMENTAL UNITS - AIR (Perch) 🌀
  // ═══════════════════════════════════════════════════════════════

  dirigible: {
    name: "Dirigible",
    category: "air",
    element: "air",
    model: "assets/models/dirigible.glb",
    scale: 0.5,
    health: 70,
    speed: 35,
    rotationSpeed: 3.0,
    size: 2,
    cost: { wood: 70 },
    abilities: ["fly", "scout", "transport"],
    spawner: "perch",
    upgradeTo: "war_balloon",
    description: "Floating airship for scouting and transport",
    notes: "DEFEAT: 🌀 Deflates slowly with sad whistle sound, drifts back to perch"
  },

  war_balloon: {
    name: "War Balloon",
    category: "air",
    element: "air",
    model: "assets/models/camp.glb", // TODO: unique model
    scale: 0.55,
    health: 100,
    speed: 30,
    rotationSpeed: 2.5,
    size: 2,
    cost: { wood: 120, stone: 20 },
    abilities: ["fly", "bomb", "transport"],
    spawner: "perch",
    upgradeFrom: "dirigible",
    description: "Armed airship that rains destruction from above",
    notes: "DEFEAT: 🌀 Pops dramatically, crew floats down on tiny parachutes"
  },

  // ═══════════════════════════════════════════════════════════════
  // ELEMENTAL UNITS - FIRE (Factory) 🔥
  // ═══════════════════════════════════════════════════════════════

  apc: {
    name: "APC",
    category: "vehicle",
    element: "fire",
    model: "assets/models/apc.glb",
    scale: 0.5,
    health: 90,
    speed: 28,
    rotationSpeed: 3.0,
    size: 2,
    cost: { wood: 30, stone: 40 },
    abilities: ["transport", "armor"],
    spawner: "factory",
    prerequisites: {
      buildings: ["factory"]
    },
    upgradeTo: "tank",
    description: "Armored personnel carrier for rapid deployment",
    notes: "DEFEAT: 🔥 Engine sputters out with smoke, crew exits coughing, towed back to factory"
  },

  tank: {
    name: "Tank",
    category: "vehicle",
    element: "fire",
    model: "assets/models/camp.glb", // TODO: unique model
    scale: 0.6,
    health: 150,
    speed: 20,
    rotationSpeed: 2.0,
    size: 2,
    cost: { wood: 50, stone: 70 },
    abilities: ["siege", "armor", "cannon"],
    spawner: "factory",
    upgradeFrom: "apc",
    description: "Heavy armored unit with devastating firepower",
    notes: "DEFEAT: 🔥 Overheats spectacularly, steam everywhere, crew evacuates safely"
  },

  // ═══════════════════════════════════════════════════════════════
  // ELEMENTAL UNITS - SPIRIT (Church) ✨
  // ═══════════════════════════════════════════════════════════════

  priest: {
    name: "Priest",
    category: "support",
    element: "spirit",
    model: "assets/models/priest.glb",
    scale: 0.5,
    health: 40,
    speed: 22,
    rotationSpeed: 6.0,
    size: 1,
    cost: { food: 25, wood: 40 },
    abilities: ["heal", "bless", "resurrect"],
    spawner: "church",
    upgradeTo: "valkyrie",
    description: "Divine healer who can bring back fallen allies",
    notes: "DEFEAT: ✨ Soul visibly exits body, floats up, body walks zombie-like back to church"
  },

  valkyrie: {
    name: "Valkyrie",
    category: "support",
    element: "spirit",
    model: "assets/models/monk.glb", // TODO: unique model
    scale: 0.55,
    health: 75,
    speed: 30,
    rotationSpeed: 7.0,
    size: 1,
    cost: { food: 45, wood: 80 },
    abilities: ["heal", "fly", "smite", "resurrect"],
    spawner: "church",
    upgradeFrom: "priest",
    description: "Angelic warrior who soars into battle",
    notes: "DEFEAT: ✨ Wings fold gracefully, ascends in beam of light back to the heavens (church)"
  },

  // ═══════════════════════════════════════════════════════════════
  // ELEMENTAL UNITS - WATER (Well) 💧
  // ═══════════════════════════════════════════════════════════════

  mycorrhizae: {
    name: "Myco",
    category: "caster",
    element: "water",
    model: "assets/models/myco.glb",
    scale: 0.5,
    health: 50,
    speed: 20,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 30, wood: 30 },
    abilities: ["poison", "spore", "grow"],
    spawner: "well",
    upgradeTo: "alchemist",
    description: "Fungus expert who weaponizes spores and toxins",
    notes: "DEFEAT: 💧 Dissolves into a puddle of spores, regrows at well over time"
  },

  alchemist: {
    name: "Alchemist",
    category: "caster",
    element: "water",
    model: "assets/models/wizard.glb", // TODO: unique model
    scale: 0.5,
    health: 60,
    speed: 22,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 50, wood: 70 },
    abilities: ["poison", "transmute", "potion", "explosion"],
    spawner: "well",
    upgradeFrom: "mycorrhizae",
    description: "Master of potions and chemical warfare",
    notes: "DEFEAT: 💧 Drinks emergency potion, turns into frog temporarily, hops back to well"
  },

  // ═══════════════════════════════════════════════════════════════
  // ELEMENTAL UNITS - EARTH (Grove) 🌿
  // ═══════════════════════════════════════════════════════════════

  shaman: {
    name: "Shaman",
    category: "caster",
    element: "earth",
    model: "assets/models/shaman.glb",
    scale: 0.5,
    health: 55,
    speed: 22,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 25, wood: 30 },
    abilities: ["nature", "root", "summon_beast"],
    spawner: "grove",
    upgradeTo: "druid",
    description: "Nature mystic who commands plants and beasts",
    notes: "DEFEAT: 🌿 Transforms into small woodland creature, scurries back to grove"
  },

  druid: {
    name: "Druid",
    category: "caster",
    element: "earth",
    model: "assets/models/wizard.glb", // TODO: unique model
    scale: 0.55,
    health: 75,
    speed: 24,
    rotationSpeed: 5.0,
    size: 1,
    cost: { food: 45, wood: 65 },
    abilities: ["nature", "entangle", "shapeshift", "regrowth"],
    spawner: "grove",
    upgradeFrom: "shaman",
    description: "Master of nature who can transform and heal the land",
    notes: "DEFEAT: 🌿 Becomes a tree temporarily, roots grow toward grove, uproots and walks home"
  }
};

// Initialize upgrade abilities for units
function initializeUpgradeAbilities() {
  // Add upgrade abilities dynamically based on upgradeTo property
  for (const [unitType, unitDef] of Object.entries(UnitTypes)) {
    if (unitDef.upgradeTo) {
      const upgradeDef = UnitTypes[unitDef.upgradeTo];
      if (!upgradeDef) continue;
      
      // Create abilities array if it doesn't exist or if it's just strings
      if (!Array.isArray(unitDef.actionAbilities)) {
        unitDef.actionAbilities = [];
      }
      
      // Add the upgrade ability
      unitDef.actionAbilities.push({
        name: `Become ${upgradeDef.name}`,
        icon: unitType === 'villager' ? '🗡️' : unitType === 'engineer' ? '📐' : unitType === 'monk' ? '⚔️' : '⬆️',
        color: 'rgba(200,150,50,0.95)',
        shadowColor: 'rgba(200,150,50,0.6)',
        cost: upgradeDef.cost || {},
        execute: function() {
          // This will be called when the ability is activated
          if (!window.player || !window.player.selectedUnits) return;
          
          const unitsToUpgrade = window.player.selectedUnits.filter(u => u.type === unitType);
          
          for (const unit of unitsToUpgrade) {
            // Check if player has resources
            const cost = upgradeDef.cost || {};
            let canAfford = true;
            const costText = [];
            
            if (window.player.resources) {
              for (const [resource, amount] of Object.entries(cost)) {
                if ((window.player.resources[resource] || 0) < amount) {
                  canAfford = false;
                }
                costText.push(`${amount} ${resource}`);
              }
            }
            
            if (!canAfford) {
              console.log(`Cannot afford to upgrade ${unit.name} to ${upgradeDef.name}. Cost: ${costText.join(', ')}`);
              continue;
            }
            
            // Deduct resources
            if (window.player.resources) {
              for (const [resource, amount] of Object.entries(cost)) {
                window.player.resources[resource] -= amount;
              }
            }
            
            // Perform the upgrade
            console.log(`🔄 Upgrading ${unit.name || unitType} to ${upgradeDef.name}!`);
            
            // Store position and other properties
            const pos = unit.mesh ? unit.mesh.position.clone() : { x: unit.x, y: unit.y || 0, z: unit.z };
            const owner = unit.owner;
            const rotation = unit.rotation || 0;
            
            // Remove old unit from arrays
            if (window.player && window.player.units) {
              const idx = window.player.units.indexOf(unit);
              if (idx > -1) window.player.units.splice(idx, 1);
            }
            if (window.gameUnits) {
              const idx = window.gameUnits.indexOf(unit);
              if (idx > -1) window.gameUnits.splice(idx, 1);
            }
            
            // Dispose old mesh
            if (unit.mesh) {
              unit.mesh.dispose();
              unit.mesh = null;
            }
            
            // Create new upgraded unit
            const newUnit = new Unit(unitDef.upgradeTo, pos);
            newUnit.owner = owner;
            newUnit.rotation = rotation;
            
            // Add to player's units
            if (window.player && window.player.units) {
              window.player.units.push(newUnit);
            }
            if (window.gameUnits) {
              window.gameUnits.push(newUnit);
            }
            
            // Spawn the 3D model
            if (window.gfx && window.gfx.scene && window.spawnUnitModels) {
              window.spawnUnitModels(window.gfx.scene);
            }
            
            console.log(`✅ Upgraded to ${upgradeDef.name}!`);
          }
        }
      });
    }
  }
}

// Call initialization
initializeUpgradeAbilities();

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

// Ground offset for unit positioning - adjust if units float or clip through terrain
// Negative values sink units down, positive values lift them up
// With correct triangular interpolation, this should be 0 or very small
const UNIT_GROUND_OFFSET = 0;

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
    // Generate deterministic IDs in multiplayer using match seed + unit counter
    // CRITICAL: If id is provided in options (even if undefined), use it
    // If id is NOT in options at all, then increment unitCounter
    // This prevents double-incrementing when callers explicitly pass id: undefined
    if ('id' in options) {
        // ID was explicitly provided (even if undefined/null)
        this.id = options.id || Math.random().toString(36).substr(2, 9);
    } else if (window.isMultiplayer && window.currentMatch) {
        // CRITICAL: Increment counter BEFORE using it to ensure deterministic IDs
        // Only increment if id was NOT provided in options
        const unitIndex = window.currentMatch.unitCounter++;
        this.id = `unit-${window.currentMatch.mapSeed}-${unitIndex}`;
    } else {
        // Single-player: use random ID
        this.id = Math.random().toString(36).substr(2, 9);
    }
    
    // CRITICAL: Generate permanent deterministic offset for this unit based on ID
    // This creates visual variety and prevents stacking while maintaining determinism
    // Larger offset creates more chaotic, spread-out appearance
    // CRITICAL: Ensure ID is set before calculating offset (should always be set by this point)
    const unitIdForHash = this.id || '';
    if (!unitIdForHash) {
        console.warn(`⚠️ Unit created without ID! Type: ${unitType}, Options:`, options);
    }
    const unitIdHash = unitIdForHash.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const offsetAngle = (unitIdHash % 628) / 100; // 0 to ~6.28 (2π)
    const offsetDistance = ((unitIdHash * 7) % 1000) / 1000 * 1.5; // 0 to 1.5 units (increased for more spread)
    // CRITICAL: Round to fixed precision to ensure deterministic floating point results
    this.personalityOffset = {
        x: Math.round(Math.cos(offsetAngle) * offsetDistance * 1000) / 1000,
        z: Math.round(Math.sin(offsetAngle) * offsetDistance * 1000) / 1000
    };
    
    this.position = position || { x: 0, y: 0, z: 0 };
    this.currentHealth = options.currentHealth !== undefined ? options.currentHealth : this.health;
    this.level = options.level || 1;
    this.experience = options.experience || 0;
    this.owner = options.owner; // CRITICAL: No default owner - must be explicitly set!
    this.state = 'idle'; // idle, moving, attacking, working, etc.
    this.target = null;
    this.inventory = options.inventory || {};
    
    // Simple LOD properties
    this.distanceToCamera = 0;
    this.lastUpdateFrame = 0;
    
    // Visual interpolation for smooth remote player movement
    // Initialize visual position to match physics position
    this.visualPosition = position ? { x: position.x, y: position.y || 0, z: position.z } : null;
    this.interpolationSpeed = REMOTE_UNIT_INTERPOLATION_SPEED;
    this.isLocalUnit = false; // Will be set based on ownership
    
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
    
    // Check if unit is on agora platform immediately (for newly created units)
    // This ensures units spawn at correct height without needing to move first
    // Note: This check also happens in updateUnits() for units that move
    if (window.gameBuildings && window.gameBuildings.length > 0 && this.pb && this.pb.state && this.pb.state.loc) {
        for (const building of window.gameBuildings) {
            if (building.type === 'agora' && building.platformHeight !== undefined && building.position) {
                const dx = this.pb.state.loc.x - building.position.x;
                const dz = this.pb.state.loc.z - building.position.z;
                const distSq = dx * dx + dz * dz;
                const platformRadius = building.platformRadius || 8;
                const platformRadiusSq = platformRadius * platformRadius;
                
                if (distSq <= platformRadiusSq) {
                    const agoraUnitOffset = 0.75;
                    this.pb.state.loc.y = building.platformHeight + agoraUnitOffset;
                    if (this.pb.state.vel) {
                        this.pb.state.vel.y = 0;
                    }
                    break;
                }
            }
        }
    }
    
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
    
    // Use window.gameUnits (the actual array being used) instead of local gameUnits
    const unitsToUpdate = window.gameUnits || gameUnits;
    
    unitsToUpdate.forEach(unit => {
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
                // CRITICAL: Always enable mesh for player/AI units, even if stealthed (stealth just reduces visibility/alpha)
                if (unit.owner !== 'neutral') {
                    unit.mesh.setEnabled(true);
                    
                    // CRITICAL: Ensure stealthed units are still visible (just semi-transparent)
                    // If a unit has isStealthed flag but mesh visibility is too low, restore it
                    // This fixes the issue where remote monks become invisible
                    if (unit.isStealthed && unit.mesh.visibility !== undefined && unit.mesh.visibility < 0.3) {
                        // Ensure stealth visibility is at least 0.4 (semi-transparent, not invisible)
                        unit.mesh.visibility = Math.max(0.4, unit.mesh.visibility);
                    }
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

// Counter for menu scene unit IDs (ensures unique fake IDs)
let menuUnitCounter = 0;

// Helper function to check if a unit is a menu scene unit (has fake ID)
function isMenuSceneUnit(unit) {
    return unit && unit.id && unit.id.startsWith('menu_unit_');
}

// Sprinkle units across the terrain
function sprinkleUnits() {
    // MULTIPLAYER: Skip neutral unit spawning to prevent desync
    // Neutral units use non-deterministic Math.random() which causes desync
    if (window.isMultiplayer) {
        // console.log('🚫 Skipping neutral unit spawning in multiplayer (prevents desync)');
        return;
    }
    
    // Reset counter each time we sprinkle (fresh menu scene)
    menuUnitCounter = 0;
    
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
            
            // Generate explicit fake ID for menu scene unit (prevents conflicts with real units)
            const fakeId = `menu_unit_${menuUnitCounter++}`;
            
            const unit = new Unit(randomType, {
                x: x + offsetX, 
                y: 0, 
                z: z + offsetZ
            }, {
                id: fakeId  // Explicit fake ID for menu scene units
            });
            
            // Skip if unit type doesn't exist (was commented out)
            if (!unit) {
                continue;
            }
            
            // Set as neutral unit
            unit.owner = 'neutral';
            
            // Add random rotation to the unit and physics body
            const randomRotation = Math.random() * Math.PI * 2;
            unit.rotation = randomRotation;
            if (unit.pb && unit.pb.state && unit.pb.state.rot) {
                unit.pb.state.rot.y = randomRotation;
                // console.log(`Unit ${unit.name} rotation set to:`, randomRotation, 'rad =', (randomRotation * 180/Math.PI).toFixed(1), 'deg');
            }
            
            // Add to neutral units AND gameUnits for rendering
            neutralUnits.push(unit);
            gameUnits.push(unit);
            
            // Assign wander behavior for menu scene units (they'll wander around)
            if (window.behaviorManager && unit.pb && unit.pb.state && unit.pb.state.loc) {
                // Use a larger wander area and longer duration for menu scene units
                window.behaviorManager.setBehavior(unit, 'wander', {
                    wanderArea: { x: 12, z: 12 }, // 12x12 unit area around spawn point
                    wanderDuration: 15000 + Math.random() * 10000, // 15-25 seconds
                    microMoveChance: 0.25, // 25% chance per second
                    wanderSpeed: (unit.speed || 20) * 1.2 // 120% of unit's base speed
                });
            }
        }
    }
    
    // console.log(`Created ${gameUnits.length} units`);
}

// Spawn visual models for all units (only for units without meshes)
function spawnUnitModels(scene) {
    const units = window.gameUnits || gameUnits;
    // console.log(`🎨 spawnUnitModels() called - ${units.length} units to process`);
    // console.log(`🔍 window.gfx exists: ${!!window.gfx}, getModel exists: ${!!window.gfx?.getModel}`);
    
    let unitsNeedingMeshes = 0;
    units.forEach(unit => {
        if (!unit.mesh && window.gfx && window.gfx.getModel) {
            unitsNeedingMeshes++;
            // Load the 3D model for this unit
            // console.log(`🎮 Loading model ${unit.model} for ${unit.name} (owner: ${unit.owner}, scale: ${unit.scale})`);
            window.gfx.getModel(unit.model, scene).then(model => {
                // console.log(`✅ Model loaded for ${unit.name}!`);
                unit.mesh = model.root;
                unit.mesh.scaling = new BABYLON.Vector3(unit.scale, unit.scale, unit.scale);
                
                // Store animation groups for walk/idle animation switching
                if (model.animationGroups && model.animationGroups.length > 0) {
                    unit.animationGroups = {};
                    model.animationGroups.forEach(group => {
                        // Babylon prefixes cloned animations with "Clone of " - strip it
                        let name = group.name.toLowerCase();
                        if (name.startsWith('clone of ')) {
                            name = name.substring(9);
                        }
                        unit.animationGroups[name] = group;
                    });
                    unit.currentAnimation = null;
                    
                    // Start idle animation immediately to avoid T-pose
                    if (unit.animationGroups['idle']) {
                        unit.animationGroups['idle'].start(true);
                        unit.currentAnimation = 'idle';
                    }
                }
                
                // Enable the mesh (getModel disables it by default to prevent flash)
                // Only call setEnabled if the method exists (mesh vs transform node)
                if (typeof unit.mesh.setEnabled === 'function') {
                    unit.mesh.setEnabled(true);
                }
                
                // Make unit meshes pickable for selection
                unit.mesh.isPickable = true;
                // console.log(`✅ Mesh loaded and set pickable for ${unit.name} (owner: ${unit.owner})`);
                
                // Set up shadows for unit mesh
                if (window.gfx && window.gfx.setupMeshShadows) {
                    window.gfx.setupMeshShadows(unit.mesh);
                }
                
                // Create blob shadow for this unit (will be visible only in blob mode)
                if (window.gfx && window.gfx.createBlobShadow) {
                    window.gfx.createBlobShadow(unit);
                    // Set initial position
                    if (window.gfx.updateBlobShadow) {
                        window.gfx.updateBlobShadow(unit);
                    }
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
                    // Initialize visual position to match physics position
                    if (!unit.visualPosition) {
                        unit.visualPosition = {
                            x: unit.pb.state.loc.x,
                            y: Number.isFinite(unit.pb.state.loc.y) ? unit.pb.state.loc.y : 0,
                            z: unit.pb.state.loc.z
                        };
                    }
                    
                    unit.mesh.position.x = unit.pb.state.loc.x;
                    unit.mesh.position.y = Number.isFinite(unit.pb.state.loc.y) ? unit.pb.state.loc.y : 0;
                    unit.mesh.position.z = unit.pb.state.loc.z;
                    
                    // Fix NaN in physics body if found
                    if (!Number.isFinite(unit.pb.state.loc.y)) {
                        console.warn(`⚠️ Fixed NaN Y position for ${unit.name}, setting to 0`);
                        unit.pb.state.loc.y = 0;
                        if (unit.visualPosition) {
                            unit.visualPosition.y = 0;
                        }
                    }
                    // console.log(`📍 ${unit.name} positioned at (${unit.mesh.position.x.toFixed(1)}, ${unit.mesh.position.y.toFixed(1)}, ${unit.mesh.position.z.toFixed(1)}) with scale ${unit.scale}`);
                }
                
                // Apply random rotation
                if (unit.rotation !== undefined) {
                    unit.mesh.rotation.y = unit.rotation;
                }
                
                // DON'T initialize linger behavior at spawn!
                // Units should start IDLE so they can be auto-assigned to buildings
                // Linger behavior will be set after player commands them
                // console.log(`🎯 ${unit.name || unit.type} spawned without behavior (idle for auto-work)`);
                
                // Add particle effects to units
                addUnitParticleEffects(unit);
                
                // Apply team colors to the unit
                if (window.applyTeamColorsToMesh) {
                    const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(unit.owner) : '#4A90E2';
                    window.applyTeamColorsToMesh(unit.mesh, teamColor);
                }
                
                // console.log(`✅ Successfully spawned ${unit.name} model at`, unit.pb.state.loc);
            }).catch(err => {
                console.warn(`❌ Failed to load model for ${unit.name}:`, err);
            });
        }
    });
    
    if (unitsNeedingMeshes > 0) {
        // console.log(`✅ Spawning meshes for ${unitsNeedingMeshes}/${units.length} units`);
    } else {
        // console.log(`⚠️ No units needed meshes! Total units: ${units.length}`);
    }
}

// Create a selection indicator for a unit
function createSelectionIndicator(unit) {
    if (!unit.mesh || !window.gfx || !window.gfx.scene) return;
    
    // Create a ring around the unit for selection indicator
    const ring = BABYLON.MeshBuilder.CreateTorus("selectionRing", {
        diameter: 3.5,
        thickness: 0.15,
        tessellation: 16
    }, window.gfx.scene);
    
    // Create glowing material
    const ringMaterial = new BABYLON.StandardMaterial("selectionRingMat", window.gfx.scene);
    ringMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1); // Cyan to match selection box
    ringMaterial.emissiveColor = new BABYLON.Color3(0, 0.5, 0.5);
    ringMaterial.alpha = 1.0;
    
    ring.material = ringMaterial;
    ring.isVisible = false; // Hidden by default
    ring.isPickable = false; // Don't interfere with unit selection
    
    // Position ring around the unit
    ring.position.y = 0.1; // Slightly above ground
    ring.parent = unit.mesh; // Parent to unit so it moves with it
    
    // Store reference to the selection indicator
    unit.selectionIndicator = ring;
    
    // Create health dots for the unit
    if (window.createHealthDots) {
        window.createHealthDots(unit);
    }
    
    // console.log(`🎯 Created selection indicator for ${unit.name}`);
}

// Update selection indicators for all units
function updateSelectionIndicators() {
    if (!window.player) return;
    
    // Defensive check for replay mode where player might not have all methods
    if (typeof window.player.getSelectedUnits !== 'function') return;
    
    const selectedUnits = window.player.getSelectedUnits();
    
    // Update all units in the game (including opponents), not just player's units
    const allUnits = window.gameUnits || (window.player.units || []);
    
    allUnits.forEach(unit => {
        const isSelected = selectedUnits.includes(unit);
        
        if (unit.selectionIndicator) {
            unit.selectionIndicator.isVisible = isSelected;
            
            // Add some animation for selected units
            if (isSelected) {
                // Rotate the ring slowly
                unit.selectionIndicator.rotation.y += 0.02;
                
                // Keep fully opaque for performance (no alpha pulsing)
                unit.selectionIndicator.material.alpha = 1.0;
            }
        }
        
        // Show health dots for selected units, hide for others
        if (window.showHealthDots && window.hideHealthDots) {
            if (isSelected) {
                window.showHealthDots(unit);
                window.updateHealthDots(unit);
            } else {
                window.hideHealthDots(unit);
            }
        }
    });
}

// Helper function to get accurate terrain height using bilinear interpolation
// Uses precomputed height grid for fast lookups (much faster than calling getHeightVariation 4x)
// Exposed globally for use by building placement and other systems
// PERFORMANCE OPTIMIZED: Caches field references, simplifies bounds checks, optimizes interpolation
window.getTerrainHeightAtPosition = (function() {
    // Cache constants and field reference to avoid repeated property lookups
    const TILE_SIZE = window.TILE_SIZE || 4;
    const TILE_SIZE_INV = 1 / TILE_SIZE; // Pre-calculate inverse for faster division
    
    // Per-frame cache for building preview (avoids redundant calculations)
    let lastPreviewX = Infinity;
    let lastPreviewZ = Infinity;
    let lastPreviewHeight = 0;
    
    return function getTerrainHeightAtPosition(worldX, worldZ) {
        if (!window.liveField) {
            return 0;
        }
        
        const field = window.liveField;
        const heightGrid = field._heightGrid;
        
        // Ensure height grid is built (lazy initialization if needed)
        if (!heightGrid) {
            if (field._buildHeightGrid) {
                field._buildHeightGrid();
                // Retry after building
                if (!field._heightGrid) return 0;
            } else {
                // Fallback if grid building method doesn't exist yet
                if (field.getHeightVariation) {
                    const gridX = worldX * TILE_SIZE_INV;
                    const gridZ = worldZ * TILE_SIZE_INV;
                    return field.getHeightVariation(gridX, gridZ);
                }
                return 0;
            }
        }
        
        // Fast cache check for building preview (same position = same height)
        if (worldX === lastPreviewX && worldZ === lastPreviewZ) {
            return lastPreviewHeight;
        }
        
        // Convert world coordinates to tile grid coordinates (using cached inverse)
        const gridX = worldX * TILE_SIZE_INV;
        const gridZ = worldZ * TILE_SIZE_INV;
        
        // Get integer tile coordinates (tile indices for array lookup)
        const tileX = gridX | 0; // Fast floor using bitwise OR (faster than Math.floor for positive numbers)
        const tileZ = gridZ | 0;
        
        // Early bounds check - if out of bounds, return 0
        const fieldWidth = field.width;
        const fieldHeight = field.height;
        if (tileX < 0 || tileX >= fieldWidth || tileZ < 0 || tileZ >= fieldHeight) {
            return 0;
        }
        
        // Get fractional position within tile (0-1) - optimized calculation
        const fx = gridX - tileX;
        const fz = gridZ - tileZ;
        
        // Clamp tile indices for bilinear interpolation (handle edge cases)
        // Height grid now includes far corners: [0..width] x [0..height]
        const tx0 = tileX;
        const tz0 = tileZ;
        const tx1 = tileX + 1 <= fieldWidth ? tileX + 1 : tx0;
        const tz1 = tileZ + 1 <= fieldHeight ? tileZ + 1 : tz0;
        
        // Fast array lookups from precomputed height grid (with bounds safety)
        const row0 = heightGrid[tx0];
        const row1 = heightGrid[tx1];
        const h00 = (row0 && row0[tz0] !== undefined) ? row0[tz0] : 0; // bottom-left
        const h10 = (row1 && row1[tz0] !== undefined) ? row1[tz0] : h00; // bottom-right
        const h01 = (row0 && row0[tz1] !== undefined) ? row0[tz1] : h00; // top-left
        const h11 = (row1 && row1[tz1] !== undefined) ? row1[tz1] : h00; // top-right
        
        // TRIANGULAR interpolation to match GPU terrain rendering
        // The terrain mesh splits each quad into 2 triangles with diagonal from (0,0) to (1,1)
        // Triangle 1: bottom-left, bottom-right, top-right (when fx >= fz)
        // Triangle 2: bottom-left, top-right, top-left (when fx < fz)
        let result;
        if (fx >= fz) {
            // Triangle 1: barycentric interpolation between h00, h10, h11
            result = (1 - fx) * h00 + (fx - fz) * h10 + fz * h11;
        } else {
            // Triangle 2: barycentric interpolation between h00, h11, h01
            result = (1 - fz) * h00 + fx * h11 + (fz - fx) * h01;
        }
        
        // Cache result for building preview (likely to be called again with same position)
        lastPreviewX = worldX;
        lastPreviewZ = worldZ;
        lastPreviewHeight = result;
        
        return result;
    };
})();

// Update unit logic, AI, and behaviors
function updateUnits(deltaTime) {
    const currentFrame = window.frameCounter || 0;
    
    // Update distances for LOD
    updateUnitDistances();
    
    // Update selection indicators once per frame (not per unit)
    updateSelectionIndicators();
    
    // Step all unit behaviors (this handles movement commands)
    // In P2P multiplayer, behaviors are deterministic (using match.tick), so we can
    // safely simulate all units locally. Network sync provides drift correction.
    if (window.behaviorManager) {
        window.behaviorManager.stepBehaviors();
    }
    
    // CRITICAL: Sort units by ID for deterministic iteration order in multiplayer
    // This ensures both clients process units in the same order, preventing position drift
    const unitsToUpdate = (window.gameUnits || gameUnits).slice();
    if (window.isMultiplayer) {
        unitsToUpdate.sort((a, b) => window.deterministicStringCompare(a.id || '', b.id || ''));
    }
    
    unitsToUpdate.forEach(unit => {
        if (!unit.pb || !unit.pb.state) return;
        
        // GAMEPLAY UNITS (player/AI) - ALWAYS update physics for smooth movement
        // NEUTRAL UNITS - Use LOD to skip frames for performance
        const isGameplayUnit = unit.owner && unit.owner !== 'neutral';
        
        if (!isGameplayUnit && !shouldUpdateUnit(unit, currentFrame)) {
            return; // Skip neutral units based on LOD
        }
        
        // Mark this unit as updated
        unit.lastUpdateFrame = currentFrame;
        
        // PHYSICS INTEGRATION: Apply impulses and velocities to position and rotation
        // NOTE: We handle all physics here instead of pb.integrate() to avoid double integration
        if (!unit.pb.imp) unit.pb.imp = { x: 0, y: 0, z: 0 };
        if (!unit.pb.state.vel) unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        if (!unit.pb.rotImp) unit.pb.rotImp = { x: 0, y: 0, z: 0 };
        if (!unit.pb.rotVel) unit.pb.rotVel = { x: 0, y: 0, z: 0 };
        
        // Apply impulse to velocity
        unit.pb.state.vel.x += unit.pb.imp.x;
        unit.pb.state.vel.z += unit.pb.imp.z;
        
        // Apply rotation impulse to rotation velocity
        unit.pb.rotVel.y += unit.pb.rotImp.y;
        
        // Clear impulses (they're one-time forces)
        unit.pb.imp.x = 0;
        unit.pb.imp.z = 0;
        unit.pb.rotImp.x = 0;
        unit.pb.rotImp.y = 0;
        unit.pb.rotImp.z = 0;
        
        // Apply velocity to position (deltaTime is already fixed timestep from game.js)
        unit.pb.state.loc.x += unit.pb.state.vel.x * deltaTime;
        unit.pb.state.loc.z += unit.pb.state.vel.z * deltaTime;
        
        // BOUNDARY ENFORCEMENT: Prevent units from walking off table or into blocked tiles
        const field = window.liveField;
        if (field) {
            const TILE_SIZE = window.TILE_SIZE || 4;
            const oldTileX = Math.floor((unit.pb.state.loc.x - unit.pb.state.vel.x * deltaTime) / TILE_SIZE);
            const oldTileZ = Math.floor((unit.pb.state.loc.z - unit.pb.state.vel.z * deltaTime) / TILE_SIZE);
            const newTileX = Math.floor(unit.pb.state.loc.x / TILE_SIZE);
            const newTileZ = Math.floor(unit.pb.state.loc.z / TILE_SIZE);
            
            // Check if tile is blocked (rocks, deep water)
            // CRITICAL: Only block if moving FROM passable TO impassable (can escape water, can't enter it)
            const wasPassable = !field.isPassable || field.isPassable(oldTileX, oldTileZ);
            const isPassable = !field.isPassable || field.isPassable(newTileX, newTileZ);
            
            if (wasPassable && !isPassable) {
                // Unit is trying to move from passable to impassable - block it
                unit.pb.state.loc.x -= unit.pb.state.vel.x * deltaTime;
                unit.pb.state.loc.z -= unit.pb.state.vel.z * deltaTime;
                unit.pb.state.vel.x = 0;
                unit.pb.state.vel.z = 0;
            }
            // If already in impassable tile (wasPassable=false), allow movement to escape
            
            // Check if off the table (chunk mask) - only if we have custom shapes
            if (field.chunkMask && field.chunkSize) {
                const chunkX = Math.floor(newTileX / field.chunkSize);
                const chunkZ = Math.floor(newTileZ / field.chunkSize);
                const chunkKey = `${chunkX},${chunkZ}`;
                
                // Only enforce if this chunk is explicitly disabled
                // Don't block units at chunk boundaries within enabled area
                if (field.chunkMask.get(chunkKey) === false) {
                    // Try to push unit back into valid area instead of hard stop
                    const chunkWorldX = chunkX * field.chunkSize * TILE_SIZE;
                    const chunkWorldZ = chunkZ * field.chunkSize * TILE_SIZE;
                    const chunkWorldSize = field.chunkSize * TILE_SIZE;
                    
                    // Find nearest valid chunk and nudge toward it
                    let nudgeX = 0, nudgeZ = 0;
                    const margin = TILE_SIZE * 0.5;
                    
                    // Check adjacent chunks for valid ones
                    if (field.chunkMask.get(`${chunkX - 1},${chunkZ}`) !== false) nudgeX = -margin;
                    else if (field.chunkMask.get(`${chunkX + 1},${chunkZ}`) !== false) nudgeX = margin;
                    if (field.chunkMask.get(`${chunkX},${chunkZ - 1}`) !== false) nudgeZ = -margin;
                    else if (field.chunkMask.get(`${chunkX},${chunkZ + 1}`) !== false) nudgeZ = margin;
                    
                    if (nudgeX !== 0 || nudgeZ !== 0) {
                        unit.pb.state.loc.x += nudgeX;
                        unit.pb.state.loc.z += nudgeZ;
                    } else {
                        // No adjacent valid chunk, just revert
                        unit.pb.state.loc.x -= unit.pb.state.vel.x * deltaTime;
                        unit.pb.state.loc.z -= unit.pb.state.vel.z * deltaTime;
                    }
                    unit.pb.state.vel.x = 0;
                    unit.pb.state.vel.z = 0;
                }
            }
            
            // Clamp to field bounds as final safety net
            const maxX = (field.width - 0.5) * TILE_SIZE;
            const maxZ = (field.height - 0.5) * TILE_SIZE;
            unit.pb.state.loc.x = Math.max(TILE_SIZE * 0.5, Math.min(maxX, unit.pb.state.loc.x));
            unit.pb.state.loc.z = Math.max(TILE_SIZE * 0.5, Math.min(maxZ, unit.pb.state.loc.z));
        }
        
        // CRITICAL: Apply smooth position correction for P2P sync
        // Only apply corrections when unit is NOT actively moving to prevent fighting with movement commands
        // Position correction modifies physics body, visual interpolation will smooth it out
        if (unit._positionCorrection) {
          // Check if unit has an active movement behavior (walk/run)
          const hasActiveBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
          const behaviorType = hasActiveBehavior ? hasActiveBehavior.constructor?.name : null;
          const isMovementBehavior = behaviorType === 'WalkBehavior' || behaviorType === 'RunBehavior';
          
          // CRITICAL: Only apply position corrections when unit is idle
          // Active movement behaviors control velocity directly - corrections would fight with them
          if (!isMovementBehavior) {
            const correction = unit._positionCorrection;
            const currentX = unit.pb.state.loc.x;
            const currentZ = unit.pb.state.loc.z;
            
            // Lerp towards authoritative position (reduced strength to prevent speedups)
            const errorX = correction.targetX - currentX;
            const errorZ = correction.targetZ - currentZ;
            const errorDistance = Math.sqrt(errorX * errorX + errorZ * errorZ);
            
            // Reduced correction strength: max 0.2 (was 0.5) to prevent units from moving faster than normal
            // This ensures corrections don't cause speedups - units should move at their normal speed
            const maxStrength = 0.2; // Cap at 20% per frame to prevent speedups
            const adaptiveStrength = Math.min(correction.strength, maxStrength);
            
            unit.pb.state.loc.x += errorX * adaptiveStrength;
            unit.pb.state.loc.z += errorZ * adaptiveStrength;
            
            // Check if we're close enough to stop correcting (within 0.15 units)
            const remainingError = Math.sqrt(
              (correction.targetX - unit.pb.state.loc.x) * (correction.targetX - unit.pb.state.loc.x) +
              (correction.targetZ - unit.pb.state.loc.z) * (correction.targetZ - unit.pb.state.loc.z)
            );
            
            if (remainingError < 0.15) {
              // Close enough - snap to exact position and remove correction
              unit.pb.state.loc.x = correction.targetX;
              unit.pb.state.loc.z = correction.targetZ;
              delete unit._positionCorrection;
            }
          } else {
            // Unit is actively moving - cancel correction to let movement behavior control speed
            // The checkpoint sync will re-apply corrections when unit stops moving
            delete unit._positionCorrection;
          }
        }
        
        // Check if unit has active movement behavior - if so, behavior controls rotation directly
        const activeBehaviorForRot = window.behaviorManager && window.behaviorManager.getBehavior(unit);
        const behaviorTypeForRot = activeBehaviorForRot ? activeBehaviorForRot.constructor?.name : null;
        
        // These behaviors use applyMovementWithRotation() which sets rotation directly
        const movementBehaviors = [
            'WalkBehavior', 'RunBehavior', 'LingerBehavior', 'WorkBehavior', 
            'WanderBehavior', 'AttackBuildingBehavior', 'EatBehavior'
        ];
        const isMovementBehavior = movementBehaviors.includes(behaviorTypeForRot);
        
        if (!isMovementBehavior) {
            // Only apply rotation velocity for non-movement behaviors
            unit.pb.state.rot.y += unit.pb.rotVel.y * deltaTime;
            unit.pb.rotVel.y *= 0.9; // 10% damping per physics step
        } else {
            // Movement behavior controls rotation - clear any residual rotation velocity
            unit.pb.rotVel.y = 0;
        }
        
        // Update Y position to match terrain height (with bilinear interpolation)
        // Add offset so units stand ON the terrain surface, not embedded in it
        // Note: Units typically have their origin at their base/feet, so we need enough offset
        // PERFORMANCE: Use LOD to skip expensive terrain height calculations for distant units
        if (true) {
            const loc = unit.pb.state.loc;
            
            // LOD: Skip expensive terrain height calculation for distant units
            // Only update terrain height for units within reasonable distance
            const distanceSq = unit.distanceToCameraSquared || Infinity;
            const TERRAIN_HEIGHT_LOD_DISTANCE_SQ = 40000; // 200 units squared (skip beyond this)
            
            if (distanceSq > TERRAIN_HEIGHT_LOD_DISTANCE_SQ) {
                // Unit is far away - keep last known height or use cached value
                // Don't recalculate terrain height (expensive!)
                if (unit._lastTerrainHeight !== undefined) {
                    unit.pb.state.loc.y = unit._lastTerrainHeight;
                    unit.pb.state.vel.y = 0;
                }
                // If no cached height, leave Y as-is (will be set when unit gets closer)
            } else {
                // Unit is close enough - calculate terrain height
                const lastTerrainHeight = unit._lastTerrainHeight;
                const lastTerrainX = unit._lastTerrainX || 0;
                const lastTerrainZ = unit._lastTerrainZ || 0;
                
                // Only recalculate if unit moved more than 0.1 units (significant movement)
                const dx = Math.abs(loc.x - lastTerrainX);
                const dz = Math.abs(loc.z - lastTerrainZ);
                let terrainHeight;
                
                if (lastTerrainHeight !== undefined && dx < 0.1 && dz < 0.1) {
                    // Unit hasn't moved much, reuse cached height
                    terrainHeight = lastTerrainHeight;
                } else {
                    // Unit moved significantly, recalculate terrain height
                    terrainHeight = getTerrainHeightAtPosition(loc.x, loc.z);
                    unit._lastTerrainHeight = terrainHeight;
                    unit._lastTerrainX = loc.x;
                    unit._lastTerrainZ = loc.z;
                }
                
                // Apply ground offset to ensure units sit ON the terrain
                const newY = terrainHeight + UNIT_GROUND_OFFSET;
                
                // CRITICAL: Set Y position AFTER velocity is applied, and ensure vel.y stays 0
                // This prevents integrate() from overwriting our terrain height
                unit.pb.state.vel.y = 0; // Ensure no Y velocity
                unit.pb.state.loc.y = newY;
            }
        }
        
        // Apply damping to velocity (units slow down naturally)
        // CRITICAL: Damping is per physics step, not per frame
        // With physics steps capped to 1 per frame in multiplayer, this ensures deterministic damping
        // CRITICAL: Round velocity after damping to prevent floating-point drift accumulation
        // CRITICAL: NEVER apply damping if unit has active movement behavior
        // Active behaviors (walk, run, work) set velocity each frame - damping would fight them and cause pause
        const hasActiveBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
        const behaviorType = hasActiveBehavior ? hasActiveBehavior.constructor?.name : null;
        const isIdleBehavior = !hasActiveBehavior || behaviorType === 'LingerBehavior';
        const damping = 0.96; // 4% friction per physics step (reduced for smoother movement)
        
        if (isIdleBehavior) {
            // Only apply damping when unit is truly idle (no active movement behavior)
            // This allows units to slow down naturally when not commanded
            unit.pb.state.vel.x = Math.round((unit.pb.state.vel.x * damping) * 1000) / 1000;
            unit.pb.state.vel.z = Math.round((unit.pb.state.vel.z * damping) * 1000) / 1000;
        }
        // Keep Y velocity at 0 (terrain height is handled directly, not via velocity)
        unit.pb.state.vel.y = 0;
        
        // Apply fake vertical arc animation for units kicked by monks
        // Only apply arc if unit is not on a platform (platforms handle their own Y)
        // CRITICAL: Use tick-based timing for deterministic animation
        // Check if unit is on a platform (agora)
        let onPlatform = false;
        if (window.gameBuildings && window.gameBuildings.length > 0 && unit.pb && unit.pb.state && unit.pb.state.loc) {
            for (const building of window.gameBuildings) {
                if (building.type === 'agora' && building.platformHeight !== undefined && building.position) {
                    const dx = unit.pb.state.loc.x - building.position.x;
                    const dz = unit.pb.state.loc.z - building.position.z;
                    const distSq = dx * dx + dz * dz;
                    const platformRadius = building.platformRadius || 8;
                    const platformRadiusSq = platformRadius * platformRadius;
                    
                    if (distSq <= platformRadiusSq) {
                        onPlatform = true;
                        break;
                    }
                }
            }
        }
        
        if (unit._monkKickArc && !onPlatform) {
            const arc = unit._monkKickArc;
            const currentTick = window.currentMatch?.tick || 0;
            const elapsedTicks = currentTick - arc.startTick;
            const progress = Math.min(elapsedTicks / arc.durationTicks, 1.0);
            
            if (progress >= 1.0) {
                // Arc complete, remove it
                delete unit._monkKickArc;
                unit.pb.state.loc.y = arc.startY;
            } else {
                // Calculate arc height using parabolic curve (up then down)
                // y = -4h * (t - 0.5)^2 + h, where h is peak height and t is 0-1
                const arcHeight = -4 * arc.peakHeight * Math.pow(progress - 0.5, 2) + arc.peakHeight;
                unit.pb.state.loc.y = arc.startY + arcHeight;
            }
        } else if (unit._monkKickArc && onPlatform) {
            // If unit gets on platform during arc, cancel the arc
            delete unit._monkKickArc;
        }
        
        // Auto monk kick: bop away nearby enemies as often as cooldown allows
        if (unit.type === 'monk') {
            maybeAutoMonkKick(unit);
        }
        
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
                // deltaTime is already fixed timestep from game.js
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

// Constants for monk auto-kick behavior
// Radius for detecting nearby enemies to kick (monks' legs are only so long!)
const MONK_KICK_AUTO_RADIUS = 2.5; // Reduced from 5 - realistic leg reach
const MONK_KICK_AUTO_RADIUS_SQ = MONK_KICK_AUTO_RADIUS * MONK_KICK_AUTO_RADIUS;
// Strong knock-back so enemies get clearly pushed away
const MONK_KICK_AUTO_POWER = 250; // Increased from 180 to make kicks more visible

// Automatically push units out of the way when monk gets a move command (but NOT while wandering)
// This can be called when a move command is issued, or continuously during movement
function maybeAutoMonkKick(unit, forceCheck = false) {
    if (!window.gameUnits || !unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) {
        return;
    }
    
    const currentTick = window.currentMatch?.tick || 0;
    const ticksPerSecond = window.net?.TICK_RATE || 20;
    const KICK_INTERVAL_TICKS = Math.max(1, Math.floor((1500 / 1000) * ticksPerSecond)); // 1.5s in ticks
    
    // If forceCheck is true (called from move command), skip behavior checks and just kick nearby units
    let isManualMovement = true; // Default to true when forceCheck is true
    let hasVelocity = true; // Default to true when forceCheck is true
    
    if (!forceCheck) {
        // Check what behavior the monk has - only kick on manual movement commands (walk/run)
        const currentBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
        const behaviorName = currentBehavior?.constructor?.name;
        
        // Don't kick while wandering - only kick on manual movement commands
        if (behaviorName === 'WanderBehavior') {
            return;
        }
        
        // Only kick if monk has WalkBehavior or RunBehavior (manual movement commands)
        isManualMovement = behaviorName === 'WalkBehavior' || behaviorName === 'RunBehavior';
        
        // Also check if monk is actually moving (has velocity)
        hasVelocity = unit.pb.state.vel && 
                      (Math.abs(unit.pb.state.vel.x) > 0.05 || Math.abs(unit.pb.state.vel.z) > 0.05);
        
        // Only push units if monk is moving from a manual command (walk/run behavior)
        if (!isManualMovement || !hasVelocity) {
            return;
        }
        
        // Periodic kicking while moving - check cooldown
        const lastKickTick = unit._lastPeriodicKickTick ?? -Infinity;
        if (currentTick - lastKickTick < KICK_INTERVAL_TICKS) {
            return; // Still on cooldown
        }
        
        // Update last kick tick deterministically
        unit._lastPeriodicKickTick = currentTick;
    }
    
    const origin = unit.pb.state.loc;
    let kickedAny = false;
    let nearbyUnits = 0;
    
    // Look for any unit within push radius (monks kick everyone except other monks!)
    for (const other of window.gameUnits) {
        if (!other || other === unit) continue;
        if (!other.pb || !other.pb.state || !other.pb.state.loc) continue;
        
        // Monks can't kick other monks (they're immune to kicks)
        if (other.type === 'monk') continue;
        
        // Monks kick everyone else - allies, enemies, and neutrals!
        // (No owner check - monks are peaceful but pushy)
        
        const dx = other.pb.state.loc.x - origin.x;
        const dz = other.pb.state.loc.z - origin.z;
        const distSq = dx * dx + dz * dz;
        
        if (distSq <= MONK_KICK_AUTO_RADIUS_SQ) {
            nearbyUnits++;
            
            if (distSq > 0.01 && other.pb && other.pb.imp) {
                // Ensure impulse object exists and is valid
                if (!other.pb.imp.x) other.pb.imp.x = 0;
                if (!other.pb.imp.z) other.pb.imp.z = 0;
                
                // Calculate push direction (away from monk)
                const dist = Math.sqrt(distSq);
                const dirX = dx / dist;
                const dirZ = dz / dist;
                
                // Apply push impulse directly (smooth continuous pushing)
                // Use distance-based falloff so close enemies get pushed harder
                const falloff = 1.0 - (dist / MONK_KICK_AUTO_RADIUS);
                const pushStrength = MONK_KICK_AUTO_POWER * falloff;
                
                other.pb.imp.x += dirX * pushStrength;
                other.pb.imp.z += dirZ * pushStrength;
                
                // Add fake vertical arc animation to kicked unit
                // CRITICAL: Use tick-based timing for deterministic animation
                if (!other._monkKickArc) {
                    const tickRate = 20; // Match net.TICK_RATE
                    other._monkKickArc = {
                        startTick: currentTick,
                        durationTicks: Math.floor(400 / 1000 * tickRate), // 400ms → ticks (8 ticks at 20Hz)
                        peakHeight: 2.0, // Peak height of arc
                        startY: other.pb.state.loc.y || 0
                    };
                }
                
                kickedAny = true;
                
                // Debug: log when kicking
                if (!window.isMultiplayer && Math.random() < 0.1) { // 10% chance to log (single-player only)
                    console.log(`👊 Monk ${unit.id} kicked ${other.type || other.name} at distance ${dist.toFixed(2)}, push=${pushStrength.toFixed(1)}`);
                }
            }
        }
    }
    
    // DISABLED: Particle effects cause mesh corruption (same issue as projectile impacts)
    // Create cloud effect at monk position when kicking
    // if (kickedAny && window.fx) {
    //     // Only create effects if monk has a valid mesh (with extra safety checks)
    //     if (unit.mesh && unit.pb && unit.pb.state && unit.pb.state.loc) {
    //         try {
    //             // Use physics position instead of mesh position (more reliable)
    //             const monkPos = new BABYLON.Vector3(
    //                 unit.pb.state.loc.x,
    //                 unit.pb.state.loc.y,
    //                 unit.pb.state.loc.z
    //             );
    //             
    //             // Create cloudy/smoky effect instead of explosion
    //             if (window.fx.createParticleEffect) {
    //                 window.fx.createParticleEffect('smoke', monkPos, {
    //                     scale: 0.4,
    //                     emitRate: 30,
    //                     minSize: 0.3,
    //                     maxSize: 0.6
    //                 });
    //             }
    //         } catch (e) {
    //             // Visual only, ignore errors silently
    //             // console.warn('Monk kick visual effect error:', e);
    //         }
    //     }
    // }
    
    // Debug: log if monk is moving but no units nearby
    if (!window.isMultiplayer && isManualMovement && hasVelocity && nearbyUnits === 0 && Math.random() < 0.01) {
        // console.log(`👊 Monk ${unit.id} moving but no units in ${MONK_KICK_AUTO_RADIUS} unit radius`);
    }
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
    
    const units = window.gameUnits || gameUnits;
    units.forEach((unit, index) => {
        if (unit.mesh && unit.pb && unit.pb.state) {
            // GAMEPLAY UNITS (player/AI) - ALWAYS update mesh position every frame for smooth movement
            // NEUTRAL UNITS - Use LOD to skip frames for performance
            if (unit.owner === 'neutral' && !shouldUpdateUnit(unit, currentFrame)) {
                return; // Skip neutral units based on LOD
            }
            
            // Check if unit has active behavior - if so, skip animation system
            const hasActiveBehavior = window.behaviorManager && window.behaviorManager.getBehavior(unit);
            
            // Visual follows physics - position with smooth interpolation for remote units
            // Local units (owned by us) follow physics directly for instant responsiveness
            // Remote units (owned by others) use visual interpolation to smooth network updates
            if (unit.pb.state.loc) {
                // Determine if this is a local unit (owned by us) or remote unit (owned by other player)
                const localPlayerId = window.currentMatch?.localPlayerId || window.player?.id;
                const normalizedLocalId = localPlayerId?.slice ? localPlayerId.slice(-6) : localPlayerId;
                const unitOwnerId = unit.owner?.slice ? unit.owner.slice(-6) : unit.owner;
                const isLocalUnit = normalizedLocalId && unitOwnerId === normalizedLocalId;
                
                // Initialize visual position if needed
                if (!unit.visualPosition) {
                    unit.visualPosition = {
                        x: unit.pb.state.loc.x,
                        y: unit.pb.state.loc.y,
                        z: unit.pb.state.loc.z
                    };
                }
                
                // Choose interpolation speed based on unit ownership
                const interpolationSpeed = isLocalUnit ? LOCAL_UNIT_INTERPOLATION_SPEED : REMOTE_UNIT_INTERPOLATION_SPEED;
                
                // Smoothly interpolate visual position towards physics position
                const targetX = unit.pb.state.loc.x;
                const targetZ = unit.pb.state.loc.z;
                const targetY = unit.pb.state.loc.y;
                
                // Calculate interpolation
                const dx = targetX - unit.visualPosition.x;
                const dz = targetZ - unit.visualPosition.z;
                const dy = targetY - unit.visualPosition.y;
                
                // Apply interpolation
                unit.visualPosition.x += dx * interpolationSpeed;
                unit.visualPosition.z += dz * interpolationSpeed;
                unit.visualPosition.y += dy * interpolationSpeed;
                
                // Update mesh position from visual position (smooth interpolation)
                unit.mesh.position.x = unit.visualPosition.x;
                unit.mesh.position.z = unit.visualPosition.z;
                
                // Handle walk/idle animation switching based on movement
                if (unit.animationGroups && unit.pb.state.vel) {
                    const vel = unit.pb.state.vel;
                    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
                    const isMoving = speed > 0.5; // Threshold to avoid jitter
                    
                    const targetAnim = isMoving ? 'walk_cycle' : 'idle';
                    
                    if (unit.currentAnimation !== targetAnim) {
                        // Stop current animation
                        if (unit.currentAnimation && unit.animationGroups[unit.currentAnimation]) {
                            unit.animationGroups[unit.currentAnimation].stop();
                        }
                        
                        // Start new animation if available
                        if (unit.animationGroups[targetAnim]) {
                            unit.animationGroups[targetAnim].start(true); // true = loop
                            unit.currentAnimation = targetAnim;
                        }
                    }
                }
                
                // CRITICAL: Ensure mesh is enabled for all player/AI units (not just neutral)
                // This fixes the issue where remote monks become invisible
                if (unit.owner !== 'neutral' && unit.mesh && typeof unit.mesh.setEnabled === 'function') {
                    unit.mesh.setEnabled(true);
                }
                
                // CRITICAL: Ensure stealthed units are still visible (just semi-transparent)
                // If a unit has isStealthed flag but mesh visibility is too low, restore it
                // This fixes the issue where remote monks become invisible
                if (unit.isStealthed && unit.mesh && unit.mesh.visibility !== undefined && unit.mesh.visibility < 0.3) {
                    // Ensure stealth visibility is at least 0.4 (semi-transparent, not invisible)
                    unit.mesh.visibility = Math.max(0.4, unit.mesh.visibility);
                }
                
                // Skip animation system for units with active behaviors
                if (hasActiveBehavior) {
                    // ALWAYS use visual Y position - updateUnits() handles terrain height, platforms, and arc animations
                    // Visual position smoothly follows physics Y position
                    unit.mesh.position.y = unit.visualPosition.y;
                } else {
                    // Units without behaviors: use terrain height (no bobbing/hopping)
                    // Special cases: birds fly in circles, mushrooms breathe
                    
                    // Flying units get altitude boost
                    if (unit.abilities && unit.abilities.includes('fly')) {
                        const flyHeight = 8; // Fixed height, no bobbing
                        const terrainHeight = unit.pb && unit.pb.state && unit.pb.state.loc ? 
                            window.getTerrainHeightAtPosition(unit.pb.state.loc.x, unit.pb.state.loc.z) : 0;
                        unit.mesh.position.y = terrainHeight + flyHeight;
                        
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
                        // Ground units: use terrain height (no bobbing/hopping)
                        // Check if unit is in monk kick arc animation
                        if (unit._monkKickArc) {
                            // Use arc Y position directly (already calculated in updateUnits)
                            unit.mesh.position.y = unit.pb.state.loc.y;
                        } else {
                            // Get terrain height
                            const terrainHeight = unit.pb && unit.pb.state && unit.pb.state.loc ? 
                                window.getTerrainHeightAtPosition(unit.pb.state.loc.x, unit.pb.state.loc.z) : 0;
                            
                            // Special case: Mushrooms breathe (scale animation only, no position change)
                            if (unit.name.includes('Mushroom')) {
                                const breatheTimeOffset = unit.id.charCodeAt(0) * 50;
                                const breatheCycle = Math.sin((Date.now() + breatheTimeOffset) * 0.001); // Slow breathing
                                const scaleVariation = 1.0 + (breatheCycle * 0.08); // ±8% size variation
                                unit.mesh.scaling.setAll(unit.scale * scaleVariation);
                            } else {
                                // Reset scaling to base scale for all other units
                                unit.mesh.scaling.setAll(unit.scale);
                            }
                            
                            // All ground units stick to terrain (no hopping/bobbing)
                            unit.mesh.position.y = terrainHeight + UNIT_GROUND_OFFSET;
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
    // Don't spawn meshes for menu scene neutral units - they're decorative only
    // spawnUnitModels(scene);
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
        const ownerId = window.player?.id;
        villager.owner = ownerId;
        
        // Random rotation
        const randomRotation = Math.random() * Math.PI * 2;
        villager.rotation = randomRotation;
        if (villager.pb.state && villager.pb.state.rot) {
            villager.pb.state.rot.y = randomRotation;
        }
        
        // Add to player's units
        window.player.units.push(villager);
        gameUnits.push(villager); // Also add to global array for rendering (but NOT neutralUnits)
        
        // CRITICAL: Give initial villagers a linger behavior so they can be auto-assigned to work
        if (window.behaviorManager) {
          window.behaviorManager.setBehavior(villager, 'linger', {
            center: { x: villager.pb.state.loc.x, z: villager.pb.state.loc.z },
            radius: 50,  // Large radius - villagers can roam freely
            wanderDistance: 2.0,  // How far they walk each step
            wanderInterval: 30000  // Pick new target every 30 seconds (very relaxed)
          });
        }
        
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
        sprinkleUnits(); // Neutral units spread across map
        // Don't spawn meshes for menu scene neutral units - they're decorative only
        // spawnUnitModels(window.gfx.scene);
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
    
    const agoraBuilding = window.gameBuildings?.find(b => {
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
    
    const ownerId = window.player?.id;
    const unit = new Unit(unitType, { x: agoraX, y: 0, z: agoraZ });
    unit.owner = ownerId;
    
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

// Rally nearby units to the agora (for any player, defaults to window.player)
function rallyUnitsToAgora(radiusInTiles = 30, targetPlayer = null) {
  // Use provided player or default to window.player
  const player = targetPlayer || window.player;
  
  if (!player || !player.agora) {
    console.warn('❌ Cannot rally: Player or agora not found');
    return;
  }
  
  const TILE_SIZE = window.TILE_SIZE || 4;
  const normalizedPlayerId = player.id?.length > 6 ? player.id.slice(-6) : player.id;
  const OCCUPATION_RADIUS = 5; // Tiles (matches match.js)
  
  // Get agora world position and building
  let agoraWorldPos;
  let agoraBuilding = null;
  
  // Try to get position from building first (more accurate)
  agoraBuilding = window.gameBuildings?.find(b => {
    if (!b || b.type !== 'agora') return false;
    const normalizedOwner = b.owner?.length > 6 ? b.owner.slice(-6) : b.owner;
    return normalizedOwner === normalizedPlayerId;
  });
  
  if (agoraBuilding && agoraBuilding.position) {
    agoraWorldPos = {
      x: agoraBuilding.position.x,
      y: 0,
      z: agoraBuilding.position.z
    };
  } else {
    // Fallback to player.agora tile coordinates
    agoraWorldPos = {
      x: player.agora.x * TILE_SIZE,
      y: 0,
      z: player.agora.y * TILE_SIZE
    };
  }
  
  // Check if agora is under attack (contested)
  const isContested = agoraBuilding?.contested || false;
  let targetVillagerCount = 2; // Default: rally 2 villagers
  
  if (isContested && agoraBuilding && window.currentMatch) {
    // Count enemy attackers within occupation radius
    const agoraTileX = agoraBuilding.gridX || Math.floor(agoraWorldPos.x / TILE_SIZE);
    const agoraTileZ = agoraBuilding.gridZ || Math.floor(agoraWorldPos.z / TILE_SIZE);
    
    let attackerCount = 0;
    
    // Count enemy units within occupation radius
    if (window.currentMatch.players) {
      window.currentMatch.players.forEach(otherPlayer => {
        const otherPid = otherPlayer.id || otherPlayer;
        const normalizedOtherPid = otherPid.length > 6 ? otherPid.slice(-6) : otherPid;
        
        // Skip self and eliminated players
        if (normalizedOtherPid === normalizedPlayerId) return;
        if (window.currentMatch.eliminatedPlayers?.has(otherPid)) return;
        
        // Count units near agora
        otherPlayer.units?.forEach(unit => {
          if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) return;
          
          const unitTileX = unit.pb.state.loc.x / TILE_SIZE;
          const unitTileZ = unit.pb.state.loc.z / TILE_SIZE;
          
          const dx = unitTileX - agoraTileX;
          const dz = unitTileZ - agoraTileZ;
          const distance = Math.sqrt(dx * dx + dz * dz);
          
          if (distance <= OCCUPATION_RADIUS) {
            attackerCount++;
          }
        });
      });
    }
    
    // Calculate how many defenders needed: attackers need 2x defenders to capture
    // So we need at least attackerCount / 2 defenders, plus 1 more to negate
    const defendersNeeded = Math.ceil(attackerCount / 2) + 1;
    targetVillagerCount = defendersNeeded;
    
    console.log(`🚩 Agora under attack! ${attackerCount} attackers detected, rallying ${targetVillagerCount} villagers`);
  }
  
  // Find nearby VILLAGERS owned by the player, sorted by distance
  const nearbyVillagers = [];
  const radiusInWorldUnits = radiusInTiles * TILE_SIZE;
  const radiusSquared = radiusInWorldUnits * radiusInWorldUnits;
  
  // Search through all game units
  for (const unit of (window.gameUnits || [])) {
    if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
    
    // Only select villagers
    if (unit.type !== 'villager') continue;
    
    // Check ownership
    const normalizedUnitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
    if (normalizedUnitOwner !== normalizedPlayerId) continue;
    
    // Calculate distance squared (avoid sqrt for performance)
    const dx = unit.pb.state.loc.x - agoraWorldPos.x;
    const dz = unit.pb.state.loc.z - agoraWorldPos.z;
    const distanceSquared = dx * dx + dz * dz;
    
    if (distanceSquared <= radiusSquared) {
      // Calculate actual distance for sorting
      const distance = Math.sqrt(distanceSquared);
      nearbyVillagers.push({ unit, distance });
    }
  }
  
  // Sort by distance (closest first)
  nearbyVillagers.sort((a, b) => a.distance - b.distance);
  
  // Take only the needed amount
  const unitsToRally = nearbyVillagers.slice(0, targetVillagerCount).map(v => v.unit);
  
  if (unitsToRally.length === 0) {
    console.log(`🚩 No villagers found within ${radiusInTiles} tiles of agora`);
    return;
  }
  
  // Move units to agora using match command system
  if (window.currentMatch) {
    const unitIds = unitsToRally.map(u => u.id);
    // CRITICAL: Include starting positions to prevent teleporting on other client
    const startPositions = {};
    unitsToRally.forEach(u => {
      if (u.pb && u.pb.state && u.pb.state.loc) {
        startPositions[u.id] = { x: u.pb.state.loc.x, z: u.pb.state.loc.z };
      }
    });
    window.currentMatch.submitCommand({
      type: 'move',
      playerId: player.id,
      unitIds: unitIds,
      startPositions: startPositions,
      target: agoraWorldPos
    });
    const playerName = player.name || (player === window.player ? 'Player' : 'AI');
    console.log(`🚩 Rallying ${unitsToRally.length} villagers to agora for ${playerName}`);
  } else{
    // Single player fallback - move units directly
    if (window.behaviorManager && window.WalkBehavior) {
      unitsToRally.forEach(unit => {
        window.behaviorManager.setBehavior(unit, 'walk', { targetPoint: agoraWorldPos });
      });
      const playerName = player.name || (player === window.player ? 'Player' : 'AI');
      console.log(`🚩 Rallying ${unitsToRally.length} villagers to agora for ${playerName} (single player)`);
    } else {
      console.warn('❌ Cannot rally: Match system or behavior manager not available');
    }
  }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.UnitTypes = UnitTypes;
    window.Unit = Unit;
    window.recruitUnit = recruitUnit;
    window.spawnAgoraVillagers = spawnAgoraVillagers;
    window.rallyUnitsToAgora = rallyUnitsToAgora;
    window.getUnitDef = getUnitDef;
    window.getUnitsByCategory = getUnitsByCategory;
    
    // CRITICAL: Never reassign these arrays if a multiplayer match is active!
    // During match start, we clear the arrays and repopulate them.
    // If this code runs again (hot reload), it would replace the cleared array with the old stale one.
    if (!window.isMultiplayer || !window.currentMatch) {
        window.gameUnits = gameUnits; // All units (for rendering)
        window.neutralUnits = neutralUnits; // Just neutral units
    } else {
        // Match is active - just sync the internal arrays with window arrays
        // This ensures updateUnits() uses the correct array reference
        console.log(`⚠️ units.js export block ran during active match - syncing arrays instead of replacing`);
    }
    
    window.sprinkleUnits = sprinkleUnits;
    window.spawnUnitModels = spawnUnitModels;
    window.updateUnits = updateUnits;
    window.updateUnitMeshes = updateUnitMeshes;
    window.respawnUnits = respawnUnits;
    window.debugUnitRotations = debugUnitRotations;
    window.destroyUnit = destroyUnit;
    window.maybeAutoMonkKick = maybeAutoMonkKick; // Export monk kick function
    window.isMenuSceneUnit = isMenuSceneUnit; // Export helper to identify menu scene units
    
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
    
    // Auto-start the initialization - DISABLED: No longer spawning decorative menu scene units
    // setTimeout(autoInitUnits, 2000); // Wait 2 seconds for scene to be ready
}



// Apply team colors using material replacement
function applyTeamColorsToMesh(mesh, teamColor) {
  if (!mesh || !teamColor) return false;
  
  const scene = mesh.getScene();
  if (!scene) return false;
  
  let changed = false;
  
  // Ensure teamColor is a string (handle Color3 objects or other types)
  let colorString = teamColor;
  if (typeof teamColor !== 'string') {
    // If it's a Color3 object, convert to hex string
    if (teamColor.r !== undefined && teamColor.g !== undefined && teamColor.b !== undefined) {
      const r = Math.round(teamColor.r * 255).toString(16).padStart(2, '0');
      const g = Math.round(teamColor.g * 255).toString(16).padStart(2, '0');
      const b = Math.round(teamColor.b * 255).toString(16).padStart(2, '0');
      colorString = `#${r}${g}${b}`;
    } else {
      // Fallback to default color if we can't convert
      colorString = '#4A90E2';
    }
  }
  
  // Parse the team color
  const cleanColor = colorString.replace('#', '');
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
  // Helper to ensure we always return a string
  const ensureString = (color) => {
    if (typeof color === 'string') return color;
    // If it's a Color3 object, convert to hex string
    if (color && color.r !== undefined && color.g !== undefined && color.b !== undefined) {
      const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
      const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
      const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    return null;
  };
  
  // Check if this is the local player (by ID, not string 'player')
  const localPlayerId = window.player?.id || window.currentMatch?.localPlayerId;
  if (owner === localPlayerId) {
    const color = window.player?.color || window.currentPlayerColor || '#4A90E2';
    return ensureString(color) || '#4A90E2'; // Blue for local player
  }
  
  // Check if this is the opponent
  const opponentId = window.opponent?.id;
  if (owner === opponentId || owner === 'opponent') {
    const color = window.opponent?.color || '#E24A4A';
    return ensureString(color) || '#E24A4A'; // Red for opponent
  }
  
  // Check if this is an AI player or any player in the match
  if (window.currentMatch?.players) {
    // Try exact match first
    let matchPlayer = window.currentMatch.players.find(p => p.id === owner);
    
    // If no exact match, try matching by suffix (last 6 chars)
    if (!matchPlayer && owner && owner.length >= 6) {
      matchPlayer = window.currentMatch.players.find(p => {
        if (!p.id) return false;
        // Check if player ID ends with the owner ID (e.g., "local-player-cxhvhb" ends with "cxhvhb")
        return p.id.endsWith(owner) || p.id.endsWith(`-${owner}`);
      });
    }
    
    // If still no match, try if owner is full ID and player ID is shortened
    if (!matchPlayer && owner) {
      matchPlayer = window.currentMatch.players.find(p => {
        if (!p.id) return false;
        return owner.endsWith(p.id) || owner.endsWith(`-${p.id}`);
      });
    }
    
    if (matchPlayer && matchPlayer.color) {
      return ensureString(matchPlayer.color) || '#8A8A8A';
    }
  }
  
  // Fallback for any other player IDs
  const teamColors = {
    'neutral': '#8A8A8A'    // Gray
  };
  
  return teamColors[owner] || teamColors.neutral;
}


// Refresh colors for all units (call this after match start to fix any wrong colors)
function refreshAllUnitColors() {
  console.log('🎨 Refreshing unit colors...');
  let refreshed = 0;
  
  if (window.gameUnits) {
    window.gameUnits.forEach(unit => {
      if (unit.mesh && unit.owner) {
        const teamColor = getTeamColorForOwner(unit.owner);
        const changed = applyTeamColorsToMesh(unit.mesh, teamColor);
        if (changed) {
          refreshed++;
        }
      }
    });
  }
  
  console.log(`✅ Refreshed colors for ${refreshed} units`);
  return refreshed;
}

// Export team color functions
if (typeof window !== 'undefined') {
    window.applyTeamColorsToAll = applyTeamColorsToAll;
    window.applyTeamColorsToMesh = applyTeamColorsToMesh;
    window.getTeamColorForOwner = getTeamColorForOwner;
    window.refreshAllUnitColors = refreshAllUnitColors;
}