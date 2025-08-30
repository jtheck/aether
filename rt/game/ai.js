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
            console.log(`🌍 ${this.unit.name || this.unit.type} finished lingering, becoming idle`);
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
            
            // Apply to physics body
            this.unit.pb.state.vel.x = direction.x * 2; // Walk speed
            this.unit.pb.state.vel.z = direction.z * 2;
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
            console.log(`🎯 Unit ${this.unit.name || this.unit.type} arrived at destination (${this.targetPoint.x.toFixed(1)}, ${this.targetPoint.z.toFixed(1)})`);
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

// Apply impulse in movement direction
this.unit.pb.imp.x += direction.x * 3; // Adjust strength as needed
this.unit.pb.imp.z += direction.z * 3;
        
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
        
        // Initialize velocity if it doesn't exist
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
        
 // Apply impulse to physics body for immediate movement
if (!this.unit.pb.imp) {
    this.unit.pb.imp = { x: 0, y: 0, z: 0 };
}

// Apply impulse in movement direction
this.unit.pb.imp.x += direction.x * this.params.runSpeed; // Adjust strength as needed
this.unit.pb.imp.z += direction.z * this.params.runSpeed;
        
    
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
        
        console.log(`🌍 ${unit.name || unit.type} wander behavior created at (${this.spawnPoint.x.toFixed(1)}, ${this.spawnPoint.z.toFixed(1)})`);
    }
    
    step() {
        const elapsed = Date.now() - this.startTime;
        
        // Complete after duration
        if (elapsed > this.params.wanderDuration) {
            console.log(`🌍 ${this.unit.name || this.unit.type} finished wandering`);
            return true;
        }
        
        // Change direction every 3-5 seconds
        if (elapsed - this.wanderTime > 3000 + Math.random() * 2000) {
            this.currentDirection = this.getRandomDirection();
            this.wanderTime = elapsed;
            console.log(`🌍 ${this.unit.name || this.unit.type} changed wander direction to (${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)})`);
        }
        
        // Apply movement in current direction
        this.applyWanderMovement();
        
        // Occasional micro-movements
        if (Math.random() < this.params.microMoveChance * 0.016) { // Adjust for 60Hz
            this.applyMicroMovement();
        }
        
        // Debug: log wander status occasionally
        if (Math.random() < 0.005) { // 0.5% chance to log
            console.log(`🌍 ${this.unit.name || this.unit.type} wandering: elapsed=${(elapsed/1000).toFixed(1)}s, direction=(${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)})`);
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
        
        // Initialize velocity if it doesn't exist (like WalkBehavior does)
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
        
        // Apply impulse for movement (like WalkBehavior does)
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }
        
        // Apply impulse in current direction (stronger like WalkBehavior)
        this.unit.pb.imp.x += this.currentDirection.x * 2.0; // Increased from 0.2 to 2.0
        this.unit.pb.imp.z += this.currentDirection.z * 2.0;
        
        // Also set velocity for smooth movement
        this.unit.pb.state.vel.x = this.currentDirection.x * this.params.wanderSpeed;
        this.unit.pb.state.vel.z = this.currentDirection.z * this.params.wanderSpeed;
        
        // Use rotation impulse for smooth turning
        if (!this.unit.pb.rotImp) {
            this.unit.pb.rotImp = { x: 0, y: 0, z: 0 };
        }
        
        // Calculate target rotation
        const targetRotation = Math.atan2(this.currentDirection.x, this.currentDirection.z);
        const currentRotation = this.unit.pb.state.rot.y;
        
        // Calculate shortest rotation direction
        let rotationDiff = targetRotation - currentRotation;
        if (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
        if (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;
        
        // Apply rotation impulse
        this.unit.pb.rotImp.y += rotationDiff * 0.08; // Gentle turning
        
        // Debug logging for wander movement
        if (Math.random() < 0.01) { // 1% chance to log
            console.log(`🌍 ${this.unit.name || this.unit.type} wandering: dir(${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)}), pos(${this.unit.pb.state.loc.x.toFixed(1)}, ${this.unit.pb.state.loc.z.toFixed(1)})`);
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
            console.log(`🎯 Set ${unit.name || unit.type} behavior to: ${behaviorType}, total behaviors: ${this.behaviors.size}`);
        } else {
            console.warn(`⚠️ Failed to create behavior for ${unit.name || unit.type}, type: ${behaviorType}`);
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
            console.log(`🎯 Stepping ${this.behaviors.size} behaviors`);
        }
        
        this.behaviors.forEach((behavior, unit) => {
            if (behavior) {
                const completed = behavior.step();
                if (completed) {
                    // Behavior completed, remove behavior (don't auto-fallback to linger)
                    console.log(`🎯 Behavior completed for unit ${unit.name || unit.type}, removing behavior`);
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
            console.log(`🎯 ${unit.name || unit.type} behavior query: ${behavior ? behavior.constructor.name : 'none'}`);
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
    
    console.log('🔥🔥🔥 AI Behavior System initialized:', {
        behaviorManager: !!window.behaviorManager,
        behaviors: ['linger', 'walk', 'run', 'wander'],
        updateIdleUnits: !!window.updateIdleUnits
    });
    
    // Also export Game class if it exists
    if (window.Game) {
        console.log('🔥🔥🔥 Game class found and available');
    } else {
        console.log('🔥🔥🔥 Game class not yet loaded');
    }
    
    // Export the updateIdleUnits function
    window.updateIdleUnits = updateIdleUnits;
    
    // Test function for wander behavior
    window.testWanderBehavior = function() {
        console.log('🧪 Testing wander behavior...');
        
        if (!window.behaviorManager) {
            console.error('❌ Behavior manager not available');
            return;
        }
        
        if (!window.gameUnits || window.gameUnits.length === 0) {
            console.error('❌ No game units available');
            return;
        }
        
        // Find a villager to test with
        const villager = window.gameUnits.find(unit => unit.type === 'villager');
        if (!villager) {
            console.error('❌ No villagers found');
            return;
        }
        
        console.log(`🧪 Testing with villager: ${villager.name || villager.type}`);
        console.log(`🧪 Current behavior: ${window.behaviorManager.getBehavior(villager) ? window.behaviorManager.getBehavior(villager).constructor.name : 'none'}`);
        
        // Force a wander behavior
        window.behaviorManager.setBehavior(villager, 'wander', {
            wanderArea: { x: 5, z: 5 },
            wanderDuration: 10000,
            microMoveChance: 0.3,
            wanderSpeed: 1.5
        });
        
        console.log(`🧪 Set wander behavior, new behavior: ${window.behaviorManager.getBehavior(villager) ? window.behaviorManager.getBehavior(villager).constructor.name : 'none'}`);
    };
}

// Idle unit management system
function updateIdleUnits() {
    if (!window.behaviorManager || !window.gameUnits) return;
    
    let idleCount = 0;
    let wanderAttempts = 0;
    
    // Debug: log when function is called
    if (Math.random() < 0.05) { // 5% chance to log
        console.log(`🌍 updateIdleUnits called, total units: ${gameUnits.length}`);
    }
    
    gameUnits.forEach(unit => {
        // Only process units with no active behavior
        if (!window.behaviorManager.getBehavior(unit)) {
            idleCount++;
            
            // Random chance to start wandering (5% chance per second)
            if (Math.random() < 0.05) {
                wanderAttempts++;
                console.log(`🌍 ${unit.name || unit.type} starting idle wander (attempt ${wanderAttempts})`);
                
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
        console.log(`🌍 Idle units: ${idleCount}, Wander attempts: ${wanderAttempts}`);
    }
}
