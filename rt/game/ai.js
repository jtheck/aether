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
        
        return false; // Linger never completes
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
            runSpeed: 4,         // Faster than walk
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
        
        this.unit.pb.state.vel.x = direction.x * this.params.runSpeed;
        this.unit.pb.state.vel.z = direction.z * this.params.runSpeed;
        
        return false;
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
            default:
                console.warn(`Unknown behavior type: ${behaviorType}`);
                return;
        }
        
        if (behavior) {
            this.behaviors.set(unit, behavior);
            console.log(`🎯 Set ${unit.name || unit.type} behavior to: ${behaviorType}, total behaviors: ${this.behaviors.size}`);
        }
    }
    
    // Step all unit behaviors (called every physics tick)
    stepBehaviors() {
        if (this.behaviors.size === 0) {
            // console.log('🔥🔥🔥 No behaviors to step');
            return;
        }
        
        this.behaviors.forEach((behavior, unit) => {
            if (behavior) {
                // console.log(`🔥🔥🔥 Stepping ${this.behaviors.size} behaviors`);
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
        return this.behaviors.get(unit);
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
    
    // console.log('🔥🔥🔥 AI Behavior System initialized:', {
    //     behaviorManager: !!window.behaviorManager,
    //     behaviors: ['linger', 'walk', 'run']
    // });
    
    // Also export Game class if it exists
    if (window.Game) {
        // console.log('🔥🔥🔥 Game class found and available');
    } else {
        // console.log('🔥🔥🔥 Game class not yet loaded');
    }
}
