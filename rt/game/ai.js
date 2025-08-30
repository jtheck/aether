// AI Behavior System for Units
// Each behavior has a step() method that gets called every physics tick

class Behavior {
    constructor(unit, params = {}) {
        this.unit = unit;
        this.params = params;
        this.completed = false;
    }
    
    step() {
        // Override in subclasses
        return false; // Return true if behavior is complete
    }
    
    isComplete() {
        return this.completed;
    }
    
    // Reusable movement function that handles impulse, rotation, and forward momentum
    applyMovementWithRotation(direction, impulseStrength = 3.0) {
        if (!this.unit.pb || !this.unit.pb.state) return;
        
        // Initialize physics properties if they don't exist
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }
        if (!this.unit.pb.rotImp) {
            this.unit.pb.rotImp = { x: 0, y: 0, z: 0 };
        }
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
        
        // Apply impulse in movement direction
        this.unit.pb.imp.x += direction.x * impulseStrength;
        this.unit.pb.imp.z += direction.z * impulseStrength;
        
        // Calculate target rotation to face movement direction
        let targetRotation = Math.atan2(direction.x, direction.z);
        
        // Apply model orientation offset if specified
        if (this.unit.modelOrientation) {
            targetRotation += this.unit.modelOrientation;
        }
        
        const currentRotation = this.unit.pb.state.rot.y || 0;
        
        // Calculate shortest rotation direction
        let rotationDiff = targetRotation - currentRotation;
        if (Math.abs(rotationDiff) > Math.PI) {
            rotationDiff = rotationDiff > 0 ? rotationDiff - Math.PI * 2 : rotationDiff + Math.PI * 2;
        }
        
        // Get unit rotation speed (default to 10.0 for snappy turning)
        let rotationSpeed = this.unit.rotationSpeed || 2.0;
        
        // Flying units get reduced rotation speed to prevent spinning
        if (this.unit.abilities && this.unit.abilities.includes('fly')) {
            rotationSpeed *= 0.05; // 5% of normal rotation speed for flying units (super gentle)
        }
        
        // Birds doing circular flight should use their own rotation system
        if (this.unit.type === 'bird_messenger') {
            rotationSpeed *= 0.01; // 1% of normal rotation speed for birds (barely any rotation from movement system)
        }
        
        // Apply rotation impulse for snappy turning
        this.unit.pb.rotImp.y += rotationDiff * rotationSpeed;
        
        // Forward momentum boost - units move faster when going forward
        const forwardSpeed = Math.abs(direction.x) + Math.abs(direction.z); // How "forward" the movement is
        const momentumBoost = 1.0 + (forwardSpeed * 0.3); // Up to 30% speed boost for forward movement
        
        // Apply momentum boost to velocity
        this.unit.pb.state.vel.x = direction.x * impulseStrength * momentumBoost;
        this.unit.pb.state.vel.z = direction.z * impulseStrength * momentumBoost;
        
        // Debug logging occasionally
        if (Math.random() < 0.01) { // 1% chance to log
            // console.log(`🎯 ${this.unit.name || this.unit.type} movement: dir(${direction.x.toFixed(2)}, ${direction.z.toFixed(2)}), rot(${rotationDiff.toFixed(2)}), rotSpeed(${rotationSpeed.toFixed(1)}), boost(${momentumBoost.toFixed(2)})`);
        }
    }
}

class LingerBehavior extends Behavior {
    constructor(unit, params = {}) {
        super(unit, {
            radius: 5,           // Stay within this radius
            wanderChance: 0.02,  // 2% chance to wander each tick
            wanderDistance: 2,   // How far to wander
            ...params
        });
        
        this.centerPoint = unit.pb.state.loc.clone();
        this.lastWanderTime = 0;
        this.wanderInterval = 3000; // Wander every 3 seconds
    }
    
    step() {
        const currentTime = Date.now();
        
        // Occasionally wander around
        if (currentTime - this.lastWanderTime > this.wanderInterval) {
            this.wander();
            this.lastWanderTime = currentTime;
        }
        
        // Check if we've wandered too far from center
        const dx = this.unit.pb.state.loc.x - this.centerPoint.x;
        const dz = this.unit.pb.state.loc.z - this.centerPoint.z;
        const distanceFromCenter = Math.sqrt(dx * dx + dz * dz);
        if (distanceFromCenter > this.params.radius) {
            // Move back toward center
            this.moveToward(this.centerPoint);
        }
        
        // Occasionally complete linger behavior to allow wandering
        if (Math.random() < 0.001) { // 0.1% chance per tick (roughly every 10 seconds at 60Hz)
            // console.log(`🌍 ${this.unit.name || this.unit.type} finished lingering, becoming idle`);
            return true; // Complete the behavior
        }
        
        return false; // Usually keep lingering
    }
    
    wander() {
        const randomAngle = Math.random() * Math.PI * 2;
        const wanderPoint = {
            x: this.centerPoint.x + Math.cos(randomAngle) * this.params.wanderDistance,
            z: this.centerPoint.z + Math.sin(randomAngle) * this.params.wanderDistance
        };
        
        this.moveToward(wanderPoint);
    }
    
    moveToward(target) {
        if (!this.unit.pb || !this.unit.pb.state) return;
        
        // Initialize velocity if it doesn't exist
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
        
        const direction = {
            x: target.x - this.unit.pb.state.loc.x,
            z: target.z - this.unit.pb.state.loc.z
        };
        
        const distance = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (distance > 0.1) {
                    // Normalize and apply movement
        direction.x /= distance;
        direction.z /= distance;
        
        // Apply movement with rotation and forward momentum boost
        this.applyMovementWithRotation(direction, 2.0);
        }
    }
}

class WalkBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 1.5,  // Consider arrived when within this distance
            walkSpeed: 2,        // Movement speed
            ...params
        });
        
        this.targetPoint = targetPoint;
    }
    
    step() {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        
        const currentPos = this.unit.pb.state.loc;
        const dx = this.targetPoint.x - currentPos.x;
        const dz = this.targetPoint.z - currentPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= this.params.arrivalRadius) {
            // Arrived at destination
            this.completed = true;
            // console.log(`🎯 Unit ${this.unit.name || this.unit.type} arrived at destination (${this.targetPoint.x.toFixed(1)}, ${this.targetPoint.z.toFixed(1)})`);
            return true;
        }
        
        // Move toward target
        const direction = {
            x: this.targetPoint.x - currentPos.x,
            z: this.targetPoint.z - currentPos.z
        };
        
        // Normalize direction
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        direction.x /= length;
        direction.z /= length;
        
        // Initialize velocity if it doesn't exist
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
                
        // Apply impulse to physics body for immediate movement
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }

        // Track that this unit was moved by player
        this.unit.lastMoveTime = Date.now();
        
        // Apply movement with rotation and forward momentum boost
        this.applyMovementWithRotation(direction, 3.0);
                
        return false;
    }
}

class RunBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 1.5,
            runSpeed: 28,         // Faster than walk
            ...params
        });
        
        this.targetPoint = targetPoint;
    }
    
    step() {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        
        const currentPos = this.unit.pb.state.loc;
        const dx = this.targetPoint.x - currentPos.x;
        const dz = this.targetPoint.z - currentPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= this.params.arrivalRadius) {
            this.completed = true;
            return true;
        }
        
        // Move toward target at run speed
        const direction = {
            x: this.targetPoint.x - currentPos.x,
            z: this.targetPoint.z - currentPos.z
        };
        
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        direction.x /= length;
        direction.z /= length;
        
        // Track that this unit was moved by player
        this.unit.lastMoveTime = Date.now();
        
        // Apply movement with rotation and forward momentum boost
        this.applyMovementWithRotation(direction, this.params.runSpeed);
        
        return false;
    }
}


class WanderBehavior extends Behavior {
    constructor(unit, params = {}) {
        super(unit, {
            wanderArea: { x: 8, z: 8 }, // 8x8 unit area around spawn point
            wanderDuration: 8000 + Math.random() * 4000, // 8-12 seconds
            microMoveChance: 0.3, // 30% chance per second
            wanderSpeed: 1, // Slower than walking
            ...params
        });
        
        // Safety check for physics body
        if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) {
            console.error(`❌ ${unit.name || unit.type} missing physics body for wander behavior`);
            return;
        }
        
        this.startTime = Date.now();
        this.currentDirection = this.getRandomDirection();
        this.wanderTime = 0;
        this.spawnPoint = { 
            x: unit.pb.state.loc.x, 
            y: unit.pb.state.loc.y, 
            z: unit.pb.state.loc.z 
        }; // Remember where unit started
        
        // console.log(`🌍 ${unit.name || unit.type} wander behavior created at (${this.spawnPoint.x.toFixed(1)}, ${this.spawnPoint.z.toFixed(1)})`);
    }
    
    step() {
        const elapsed = Date.now() - this.startTime;
        
        // Complete after duration
        if (elapsed > this.params.wanderDuration) {
            // console.log(`🌍 ${this.unit.name || this.unit.type} finished wandering`);
            // Track when this unit finished wandering
            this.unit.lastWanderTime = Date.now();
            return true;
        }
        
        // Change direction every 3-5 seconds
        if (elapsed - this.wanderTime > 3000 + Math.random() * 2000) {
            this.currentDirection = this.getRandomDirection();
            this.wanderTime = elapsed;
            // console.log(`🌍 ${this.unit.name || this.unit.type} changed wander direction to (${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)})`);
        }
        
        // Apply movement in current direction
        this.applyWanderMovement();
        
        // Occasional micro-movements
        if (Math.random() < this.params.microMoveChance * 0.016) { // Adjust for 60Hz
            this.applyMicroMovement();
        }
        
        // Debug: log wander status occasionally
        if (Math.random() < 0.005) { // 0.5% chance to log
            // console.log(`🌍 ${this.unit.name || this.unit.type} wandering: elapsed=${(elapsed/1000).toFixed(1)}s, direction=(${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)})`);
        }
        
        return false;
    }
    
    getRandomDirection() {
        const angle = Math.random() * Math.PI * 2;
        return {
            x: Math.cos(angle),
            z: Math.sin(angle)
        };
    }
    
    applyWanderMovement() {
        if (!this.unit.pb || !this.unit.pb.state) {
            console.warn(`⚠️ ${this.unit.name || this.unit.type} missing physics body or state`);
            return;
        }
        
        if (!this.unit.pb.state.loc) {
            console.warn(`⚠️ ${this.unit.name || this.unit.type} missing physics body location`);
            return;
        }
        
        // Check if we're still within wander area
        const dx = this.unit.pb.state.loc.x - this.spawnPoint.x;
        const dz = this.unit.pb.state.loc.z - this.spawnPoint.z;
        
        if (Math.abs(dx) > this.params.wanderArea.x / 2 || 
            Math.abs(dz) > this.params.wanderArea.z / 2) {
            // Head back toward spawn point
            const backDirection = {
                x: this.spawnPoint.x - this.unit.pb.state.loc.x,
                z: this.spawnPoint.z - this.unit.pb.state.loc.z
            };
            
            const distance = Math.sqrt(backDirection.x * backDirection.x + backDirection.z * backDirection.z);
            if (distance > 0.1) {
                backDirection.x /= distance;
                backDirection.z /= distance;
                this.currentDirection = backDirection;
            }
        }
        
        // Apply movement with rotation and forward momentum boost
        this.applyMovementWithRotation(this.currentDirection, this.params.wanderSpeed);
        
        // Debug logging for wander movement
        if (Math.random() < 0.01) { // 1% chance to log
            // console.log(`🌍 ${this.unit.name || this.unit.type} wandering: dir(${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)}), pos(${this.unit.pb.state.loc.x.toFixed(1)}, ${this.unit.pb.state.loc.z.toFixed(1)})`);
        }
    }
    
    applyMicroMovement() {
        if (!this.unit.pb || !this.unit.pb.state) return;
        
        // Small random movement
        const microDirection = this.getRandomDirection();
        
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }
        
        // Very small impulse for micro-movement
        this.unit.pb.imp.x += microDirection.x * 0.05;
        this.unit.pb.imp.z += microDirection.z * 0.05;
    }
}


// Behavior manager for units
class UnitBehaviorManager {
    constructor() {
        this.behaviors = new Map(); // unit -> current behavior
    }
    
    // Set a unit's active behavior
    setBehavior(unit, behaviorType, params = {}) {
        let behavior;
        
        switch (behaviorType) {
            case 'linger':
                behavior = new LingerBehavior(unit, params);
                break;
            case 'walk':
                if (params.targetPoint) {
                    behavior = new WalkBehavior(unit, params.targetPoint, params);
                }
                break;
            case 'run':
                if (params.targetPoint) {
                    behavior = new RunBehavior(unit, params.targetPoint, params);
                }
                break;
            case 'wander':
                behavior = new WanderBehavior(unit, params);
                break;
            default:
                console.warn(`Unknown behavior type: ${behaviorType}`);
                return;
        }
        
        if (behavior) {
            this.behaviors.set(unit, behavior);
            // console.log(`🎯 Set ${unit.name || unit.type} behavior to: ${behaviorType}, total behaviors: ${this.behaviors.size}`);
        } else {
            // console.warn(`⚠️ Failed to create behavior for ${unit.name || unit.type}, type: ${behaviorType}`);
        }
    }
    
    // Step all unit behaviors (called every physics tick)
    stepBehaviors() {
        if (this.behaviors.size === 0) {
            // console.log('🔥🔥🔥 No behaviors to step');
            return;
        }
        
        // Debug: log behavior count occasionally
        if (Math.random() < 0.01) { // 1% chance to log
            // console.log(`🎯 Stepping ${this.behaviors.size} behaviors`);
        }
        
        this.behaviors.forEach((behavior, unit) => {
            if (behavior) {
                const completed = behavior.step();
                if (completed) {
                    // Behavior completed, remove behavior (don't auto-fallback to linger)
                    // console.log(`🎯 Behavior completed for unit ${unit.name || unit.type}, removing behavior`);
                    this.behaviors.delete(unit);
                }
            }
        });
    }
    
    // Get a unit's current behavior
    getBehavior(unit) {
        const behavior = this.behaviors.get(unit);
        // Debug: log behavior queries occasionally
        if (Math.random() < 0.001) { // 0.1% chance to log
            // console.log(`🎯 ${unit.name || unit.type} behavior query: ${behavior ? behavior.constructor.name : 'none'}`);
        }
        return behavior;
    }
    
    // Clear a unit's behavior (fall back to linger)
    clearBehavior(unit) {
        this.behaviors.delete(unit);
        this.setBehavior(unit, 'linger');
    }
}

// Global behavior manager instance
const behaviorManager = new UnitBehaviorManager();

// Export for use in other files
if (typeof window !== 'undefined') {
    window.behaviorManager = behaviorManager;
    window.Behavior = Behavior;
    window.LingerBehavior = LingerBehavior;
    window.WalkBehavior = WalkBehavior;
    window.RunBehavior = RunBehavior;
    window.WanderBehavior = WanderBehavior;
    
    // // console.log('🔥🔥🔥 AI Behavior System initialized:', {
    //     behaviorManager: !!window.behaviorManager,
    //     behaviors: ['linger', 'walk', 'run', 'wander'],
    //     updateIdleUnits: !!window.updateIdleUnits
    // });
    
    // Also export Game class if it exists
    if (window.Game) {
        // console.log('🔥🔥🔥 Game class found and available');
    } else {
        // console.log('🔥🔥🔥 Game class not yet loaded');
    }
    
    // Export the updateIdleUnits function
    window.updateIdleUnits = updateIdleUnits;
    
    // Test function for wander behavior
    window.testWanderBehavior = function() {
        // console.log('🧪 Testing wander behavior...');
        
        if (!window.behaviorManager) {
            // console.error('❌ Behavior manager not available');
            return;
        }
        
        if (!window.gameUnits || window.gameUnits.length === 0) {
            // console.error('❌ No game units available');
            return;
        }
        
        // Find a villager to test with
        const villager = window.gameUnits.find(unit => unit.type === 'villager');
        if (!villager) {
            console.error('❌ No villagers found');
            return;
        }
        
        //  console.log(`🧪 Testing with villager: ${villager.name || villager.type}`);
        // console.log(`🧪 Current behavior: ${window.behaviorManager.getBehavior(villager) ? window.behaviorManager.getBehavior(villager).constructor.name : 'none'}`);
        
        // Force a wander behavior
        window.behaviorManager.setBehavior(villager, 'wander', {
            wanderArea: { x: 5, z: 5 },
            wanderDuration: 10000,
            microMoveChance: 0.3,
            wanderSpeed: 1.5
        });
        
        // console.log(`🧪 Set wander behavior, new behavior: ${window.behaviorManager.getBehavior(villager) ? window.behaviorManager.getBehavior(villager).constructor.name : 'none'}`);
    };
    
    // Test function for rotation speeds
    window.testRotationSpeeds = function() {
        // console.log ('🔄 Testing rotation speeds...');
        
        if (!window.gameUnits || window.gameUnits.length === 0) {
            console.error('❌ No game units available');
            return;
        }
        
        window.gameUnits.forEach(unit => {
            // console.log(`🔄 ${unit.name || unit.type}: speed=${unit.speed}, rotationSpeed=${unit.rotationSpeed || 'default (10.0)'}`);
        });
    };
    
    // Function to adjust unit rotation speed in-game
    window.setUnitRotationSpeed = function(unitType, newRotationSpeed) {
        if (!window.gameUnits) {
            // console.error('❌ No game units available');
            return;
        }
        
        let updatedCount = 0;
        window.gameUnits.forEach(unit => {
            if (unit.type === unitType) {
                unit.rotationSpeed = newRotationSpeed;
                updatedCount++;
            }
        });
        
        // console.log(`🔄 Updated ${updatedCount} ${unitType} units to rotation speed: ${newRotationSpeed}`);
    };
    
    // Function to adjust wander delays globally
    window.setWanderDelays = function(minWanderDelay = 3000, minMoveDelay = 5000, wanderChance = 0.02) {
        // Store these as global variables so updateIdleUnits can access them
        window.WANDER_DELAYS = {
            minWanderDelay: minWanderDelay,
            minMoveDelay: minMoveDelay,
            wanderChance: wanderChance
        };
        
        // console.log(`🌍 Set wander delays: ${minWanderDelay}ms between wanders, ${minMoveDelay}ms after moves, ${(wanderChance * 100).toFixed(1)}% chance per second`);
    };
    
    // Function to check current wander delays
    window.getWanderDelays = function() {
        if (window.WANDER_DELAYS) {
            // console.log(`🌍 Current wander delays:`, window.WANDER_DELAYS);
        } else {
            // console.log(`🌍 Using default wander delays: 3000ms between wanders, 5000ms after moves, 2% chance per second`);
        }
    };
    
    // Function to adjust unit model orientation in-game
    window.setUnitModelOrientation = function(unitType, orientationOffset) {
        if (!window.gameUnits) {
            // console.error('❌ No game units available');
            return;
        }
        
        let updatedCount = 0;
        window.gameUnits.forEach(unit => {
            if (unit.type === unitType) {
                unit.modelOrientation = orientationOffset;
                updatedCount++;
            }
        });
        
            // console.log(`🎯 Updated ${updatedCount} ${unitType} units to model orientation: ${(orientationOffset * 180 / Math.PI).toFixed(1)}°`);
            // console.log(`🎯 Orientation offset: ${orientationOffset} radians`);
    };
    
    // Function to test different orientations
    window.testVillagerOrientation = function() {
        // console.log('🧪 Testing villager orientation...');
        
        if (!window.gameUnits) {
            // console.error('❌ No game units available');
            return;
        }
        
        const villagers = window.gameUnits.filter(unit => unit.type === 'villager');
        if (villagers.length === 0) {
            // console.error('❌ No villagers found');
            return;
        }
        
        // console.log(`🧪 Found ${villagers.length} villagers`);
        villagers.forEach((villager, index) => {
            // console.log(`🧪 Villager ${index + 1}: modelOrientation = ${villager.modelOrientation || 'none'} (${((villager.modelOrientation || 0) * 180 / Math.PI).toFixed(1)}°)`);
        });
        
        console.log('🧪 Try these orientations:');
        console.log('🧪 0° = Math.PI * 0');
        console.log('🧪 90° = Math.PI / 2');
        console.log('🧪 180° = Math.PI');
        console.log('🧪 270° = Math.PI * 1.5');
        console.log('🧪 Example: window.setUnitModelOrientation("villager", Math.PI / 2)');
    };
    
    // Function to find and debug birds
    window.findBirds = function() {
        // console.log('🐦 Searching for birds...');
        
        if (!window.gameUnits) {
            console.error('❌ No game units available');
            return;
        }
        
        const birds = window.gameUnits.filter(unit => unit.type === 'bird_messenger');
        if (birds.length === 0) {
            // console.log('🐦 No birds found in gameUnits');
            
            // Check if birds exist in neutralUnits
            if (window.neutralUnits) {
                const neutralBirds = window.neutralUnits.filter(unit => unit.type === 'bird_messenger');
                // console.log(`🐦 Found ${neutralBirds.length} birds in neutralUnits`);
                neutralBirds.forEach((bird, index) => {
                    // console.log(`🐦 Neutral Bird ${index + 1}:`, {
                    //     id: bird.id,
                    //     position: bird.pb?.state?.loc,
                    //     hasMesh: !!bird.mesh,
                    //     meshPosition: bird.mesh?.position
                    // });
                });
            }
            
            // Check if birds exist in player units
            if (window.player && window.player.units) {
                const playerBirds = window.player.units.filter(unit => unit.type === 'bird_messenger');
                // console.log(`🐦 Found ${playerBirds.length} birds in player units`);
            }
            
            return;
        }
        
        // console.log(`🐦 Found ${birds.length} birds in gameUnits`);
        birds.forEach((bird, index) => {
            // console.log(`🐦 Bird ${index + 1}:`, {
            //     id: bird.id,
            //     type: bird.type,
            //     position: bird.pb?.state?.loc,
            //     hasMesh: !!bird.mesh,
            //     meshPosition: bird.mesh?.position,
            //     hasPhysics: !!bird.pb,
            //     hasState: !!bird.pb?.state
            // });
        });
    };
    
    // Function to force spawn a bird for testing
    window.spawnTestBird = function() {
        // console.log('🐦 Spawning test bird...');
        
        if (!window.gameUnits || !window.Unit) {
            // console.error('❌ Cannot spawn bird - missing dependencies');
            return;
        }
        
        // Create a bird at a random position
        const testBird = new window.Unit('bird_messenger', {
            x: Math.random() * 20 - 10,
            y: 0,
            z: Math.random() * 20 - 10
        });
        
        // Add to game units
        window.gameUnits.push(testBird);
        
        // Spawn the visual model
        if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
            window.spawnUnitModels(window.gfx.scene);
        }
        
        // console.log('🐦 Test bird spawned! Use window.findBirds() to locate it');
    };
    
    // Function to reset bird spawn points if they get corrupted
    window.resetBirdSpawnPoints = function() {
        // console.log('🐦 Resetting bird spawn points...');
        
        if (!window.gameUnits) {
            // console.error('❌ No game units available');
            return;
        }
        
        const birds = window.gameUnits.filter(unit => unit.type === 'bird_messenger');
        if (birds.length === 0) {
            // console.log('🐦 No birds found to reset');
            return;
        }
        
        let resetCount = 0;
        birds.forEach(bird => {
            if (bird.mesh && bird.pb && bird.pb.state && bird.pb.state.loc) {
                // Reset spawn point to current physics position
                bird.mesh.spawnPoint = { 
                    x: bird.pb.state.loc.x, 
                    z: bird.pb.state.loc.z 
                };
                resetCount++;
                // console.log(`🐦 Reset bird ${bird.id} spawn point to (${bird.mesh.spawnPoint.x.toFixed(1)}, ${bird.mesh.spawnPoint.z.toFixed(1)})`);
            }
        });
        
        // console.log(`🐦 Reset ${resetCount} bird spawn points`);
    };
}

// Idle unit management system
function updateIdleUnits() {
    if (!window.behaviorManager || !window.gameUnits) return;
    
    let idleCount = 0;
    let wanderAttempts = 0;
    
    // Debug: log when function is called
    if (Math.random() < 0.05) { // 5% chance to log
        // console.log(`🌍 updateIdleUnits called, total units: ${gameUnits.length}`);
    }
    
    gameUnits.forEach(unit => {
        // Only process units with no active behavior
        if (!window.behaviorManager.getBehavior(unit)) {
            idleCount++;
            
            // Initialize wander delay tracking if it doesn't exist
            if (!unit.lastWanderTime) {
                unit.lastWanderTime = 0;
            }
            if (!unit.lastMoveTime) {
                unit.lastMoveTime = 0;
            }
            
            const currentTime = Date.now();
            const timeSinceWander = currentTime - unit.lastWanderTime;
            const timeSinceMove = currentTime - unit.lastMoveTime;
            
            // Wander delay logic:
            // - Must wait at least 3 seconds after last wander
            // - Must wait at least 5 seconds after last move command
            // - Random chance to wander (reduced from 5% to 2% per second)
            const minWanderDelay = window.WANDER_DELAYS?.minWanderDelay || 3000; // 3 seconds between wanders
            const minMoveDelay = window.WANDER_DELAYS?.minMoveDelay || 5000;   // 5 seconds after move commands
            const wanderChance = window.WANDER_DELAYS?.wanderChance || 0.02;   // 2% chance per second (reduced from 5%)
            
            if (timeSinceWander > minWanderDelay && 
                timeSinceMove > minMoveDelay && 
                Math.random() < wanderChance) {
                
                wanderAttempts++;
                // console.log(`🌍 ${unit.name || unit.type} starting idle wander after ${(timeSinceWander/1000).toFixed(1)}s rest (attempt ${wanderAttempts})`);
                
                // Update last wander time
                unit.lastWanderTime = currentTime;
                
                // Set wander behavior with unit-specific parameters
                window.behaviorManager.setBehavior(unit, 'wander', {
                    wanderArea: { 
                        x: 6 + Math.random() * 4, // 6-10 unit area
                        z: 6 + Math.random() * 4 
                    },
                    wanderDuration: 8000 + Math.random() * 4000, // 8-12 seconds
                    microMoveChance: 0.2 + Math.random() * 0.2, // 20-40% chance
                    wanderSpeed: 1.2 + Math.random() * 0.6 // 1.2-1.8 speed
                });
            }
        }
    });
    
    // Debug logging for idle units
    if (idleCount > 0 && Math.random() < 0.1) { // 10% chance to log
        // console.log(`🌍 Idle units: ${idleCount}, Wander attempts: ${wanderAttempts}`);
    }
}
