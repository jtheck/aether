// AI Behavior System for Units
// Each behavior has a step() method that gets called every physics tick

// CRITICAL: Deterministic RNG utility for multiplayer synchronization
// Uses unit ID or other deterministic values to generate consistent random numbers across clients
function createDeterministicRNG(seed) {
    let state = seed;
    return function() {
        // Simple LCG (Linear Congruential Generator) - deterministic and fast
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296; // Returns 0-1
    };
}

// Get deterministic random value for a unit based on its ID and optional context
// This ensures the same unit will always get the same "random" value for a given context
function getUnitDeterministicRandom(unit, context = '') {
    if (!unit || !unit.id) {
        console.warn('⚠️ getUnitDeterministicRandom called without unit or unit.id, using fallback');
        return 0.5; // Fallback to middle value
    }
    
    // Hash unit ID + context string to get a seed
    const combined = unit.id + context;
    const hash = combined.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    // Use match tick as additional entropy if available (for time-based randomness)
    const tickComponent = window.currentMatch?.tick || 0;
    const finalSeed = hash + tickComponent;
    
    // Generate single random value from seed
    const rng = createDeterministicRNG(finalSeed);
    return rng();
}

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
        
        // TUNED: Balanced movement - responsive but smooth (not teleporting)
        // If impulseStrength is a number >= 10, treat it as an absolute speed value (for wander behaviors)
        // Otherwise, use the normal calculation
        const effectiveSpeed = (impulseStrength >= 10) 
            ? impulseStrength * 0.08  // Direct speed value (e.g., 10 speed = 0.8 effective)
            : (this.unit.speed ? this.unit.speed * 0.08 : impulseStrength * 0.8);
        
        // Apply impulse in movement direction
        this.unit.pb.imp.x += direction.x * effectiveSpeed;
        this.unit.pb.imp.z += direction.z * effectiveSpeed;
        
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
        
        // Get unit rotation speed (default to higher value for snappy turning)
        // Increased default for more responsive turning - units should face direction quickly
        let rotationSpeed = this.unit.rotationSpeed || 3.0; // Increased from 2.0 for snappier turning
        
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
        // CRITICAL: Round to fixed precision for deterministic results
        const forwardSpeed = Math.abs(direction.x) + Math.abs(direction.z); // How "forward" the movement is
        const momentumBoost = Math.round((1.0 + (forwardSpeed * 0.3)) * 1000) / 1000; // Round to 3 decimal places
        
        // CRITICAL: Don't overwrite velocity directly - use impulses instead for deterministic physics
        // Setting velocity directly can conflict with physics integration and cause desyncs
        // The impulse system ensures deterministic accumulation across clients
        // Note: The velocity setting below is kept for backward compatibility but should be removed
        // The impulse system (lines 75-76) is the primary movement mechanism
        
        // CRITICAL: Always set velocity immediately when starting movement to prevent pause
        // The impulse system handles ongoing movement, but we need immediate velocity for responsiveness
        // Only skip if velocity is already very close AND unit is already moving (to prevent micro-adjustments)
        const targetVelX = direction.x * effectiveSpeed * momentumBoost;
        const targetVelZ = direction.z * effectiveSpeed * momentumBoost;
        
        const currentVelX = this.unit.pb.state.vel.x || 0;
        const currentVelZ = this.unit.pb.state.vel.z || 0;
        const currentSpeed = Math.sqrt(currentVelX * currentVelX + currentVelZ * currentVelZ);
        
        // CRITICAL: Always set velocity immediately for responsive movement
        // Player commands should result in instant movement - no conditions, no delays
        // The impulse system provides ongoing acceleration, but we need immediate velocity
        // to prevent any pause when starting movement or changing direction
        // ALWAYS update velocity when behavior is active - let behavior control movement completely
        this.unit.pb.state.vel.x = Math.round(targetVelX * 1000) / 1000;
        this.unit.pb.state.vel.z = Math.round(targetVelZ * 1000) / 1000;
        
        // Debug logging (disabled for performance)
        // console.log(`🎯 ${this.unit.name || this.unit.type} movement: dir(${direction.x.toFixed(2)}, ${direction.z.toFixed(2)}), rot(${rotationDiff.toFixed(2)}), rotSpeed(${rotationSpeed.toFixed(1)}), boost(${momentumBoost.toFixed(2)})`);

    }
}

class LingerBehavior extends Behavior {
    constructor(unit, params = {}) {
        const radius = params.radius || 5;
        super(unit, {
            radius: radius,           // Stay within this radius
            wanderChance: 0.02,  // 2% chance to wander each tick
            wanderDistance: params.wanderDistance || 4,   // How far to wander (nice big walks)
            ...params
        });
        
        // Use custom center if provided, otherwise use current position
        this.centerPoint = params.center || { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
        
        // Use tick-based timing for multiplayer sync instead of Date.now()
        // Add deterministic offset based on unit ID so units don't all wander in sync
        const unitIdHash = (unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const tickOffset = -(unitIdHash % 480); // Spread over 0-8 seconds (480 ticks at 60 tps)
        this.lastWanderTick = (window.currentMatch?.tick || 0) + tickOffset;
        this.wanderInterval = params.wanderInterval || 5000; // Pick new target every 5 seconds (longer walks)
        
        // Also add slight variation to wander interval (deterministic)
        const intervalVariation = (unitIdHash % 3000) - 1500; // ±1.5 seconds
        this.wanderInterval += intervalVariation;
        
        // Current wander target (persistent between steps)
        this.currentTarget = null;
    }
    
    step() {
        // Use tick-based timing for multiplayer sync
        const currentTick = window.currentMatch?.tick || 0;
        const ticksSinceWander = currentTick - this.lastWanderTick;
        const tickRate = 20; // Match net.TICK_RATE
        const wanderIntervalTicks = Math.floor(this.wanderInterval / 1000 * tickRate); // Convert ms to ticks (20 ticks/sec)
        
        // Check if we've been moved far from center (player command)
        const dx = this.unit.pb.state.loc.x - this.centerPoint.x;
        const dz = this.unit.pb.state.loc.z - this.centerPoint.z;
        const distanceFromCenter = Math.sqrt(dx * dx + dz * dz);
        
        // If moved far away (more than 2x radius), update center point to current location
        if (distanceFromCenter > this.params.radius * 2) {
            this.centerPoint = { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z };
            this.currentTarget = null; // Pick new target on next interval
            this.lastWanderTick = currentTick; // Reset timer
        }
        
        // Pick a new wander target every wanderInterval (only when timer expires)
        if (ticksSinceWander > wanderIntervalTicks) {
            this.pickNewWanderTarget();
            this.lastWanderTick = currentTick;
        }
        
        // Move toward current target if we have one
        if (this.currentTarget) {
            this.moveToward(this.currentTarget);
        }
        
        // Never auto-complete linger behavior for player/AI units (let commands override it)
        // This prevents units from becoming truly "idle" and losing their anti-stacking behavior
        return false;
    }
    
    pickNewWanderTarget() {
        // CRITICAL: Use deterministic angle based on tick + unit ID for multiplayer sync
        const currentTick = window.currentMatch?.tick || 0;
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        // Multiply by a large prime to spread out sequential IDs, then add tick for time variation
        const randomAngle = ((unitIdHash * 7919 + currentTick * 31) % 628) / 100; // 0 to 2π (6.28)
        
        this.currentTarget = {
            x: this.centerPoint.x + Math.cos(randomAngle) * this.params.wanderDistance,
            z: this.centerPoint.z + Math.sin(randomAngle) * this.params.wanderDistance
        };
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
        
        // CRITICAL FIX: Lower "close enough" threshold to 0.05 so they keep moving until very close
        // This prevents stop-go behavior where they stop too early
        if (distance > 0.05) {
            // Normalize and apply movement
            direction.x /= distance;
            direction.z /= distance;
            
        // Apply movement with rotation and forward momentum boost
        this.applyMovementWithRotation(direction, 2.4); // Super slow, very relaxed pace (20% speed)
        } else {
            // Very close to target - STOP and wait for next interval
            // Clear the target so they stand still until wanderInterval elapses
            this.currentTarget = null;
        }
    }
}

class WalkBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 0.3,  // Stop very close to target point (reduced from 1.5)
            walkSpeed: 20,       // Normal walking speed
            ...params
        });
        
        this.targetPoint = targetPoint;
    }
    
    step() {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        
        const field = window.liveField;
        const TILE_SIZE = window.TILE_SIZE || 4;
        
        // CRITICAL: Apply unit's personality offset to target for visual variety
        // This prevents all units from converging to the exact same spot
        // RE-ENABLED: Personality offset is deterministic (based on unit ID) and properly rounded
        // This ensures both clients calculate identical offsets, preventing desyncs
        const personalityOffset = this.unit.personalityOffset || { x: 0, z: 0 };
        // Round offset to ensure deterministic results (personalityOffset is already rounded, but double-check)
        const roundedOffset = {
            x: Math.round(personalityOffset.x * 1000) / 1000,
            z: Math.round(personalityOffset.z * 1000) / 1000
        };
        const adjustedTarget = {
            x: Math.round((this.targetPoint.x + roundedOffset.x) * 1000) / 1000,
            z: Math.round((this.targetPoint.z + roundedOffset.z) * 1000) / 1000
        };
        
        const currentPos = this.unit.pb.state.loc;
        const dx = adjustedTarget.x - currentPos.x;
        const dz = adjustedTarget.z - currentPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= this.params.arrivalRadius) {
            // Arrived at destination
            this.completed = true;
            return true;
        }
        
        // Move toward target (with personality offset applied)
        const direction = {
            x: adjustedTarget.x - currentPos.x,
            z: adjustedTarget.z - currentPos.z
        };
        
        // Normalize direction
        // CRITICAL: Round to fixed precision to prevent floating-point differences
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (length > 0.001) { // Avoid division by zero
            direction.x = Math.round((direction.x / length) * 10000) / 10000;
            direction.z = Math.round((direction.z / length) * 10000) / 10000;
        } else {
            direction.x = 0;
            direction.z = 0;
        }
        
        // TERRAIN CHECKS: Blocked tiles, slow tiles, table boundaries
        let speedMultiplier = 1.0;
        
        if (field) {
            // Calculate next step position (look ahead ~1 tile)
            const lookAheadDist = TILE_SIZE * 0.5;
            const nextX = currentPos.x + direction.x * lookAheadDist;
            const nextZ = currentPos.z + direction.z * lookAheadDist;
            const nextTileX = Math.floor(nextX / TILE_SIZE);
            const nextTileZ = Math.floor(nextZ / TILE_SIZE);
            
            // Check if next tile is blocked (rocks, deep water)
            if (field.isPassable && !field.isPassable(nextTileX, nextTileZ)) {
                // Blocked! Stop movement and complete behavior
                this.completed = true;
                return true;
            }
            
            // Check if next tile is off the table (chunk mask)
            if (field.chunkMask && field.chunkSize) {
                const chunkX = Math.floor(nextTileX / field.chunkSize);
                const chunkZ = Math.floor(nextTileZ / field.chunkSize);
                const chunkKey = `${chunkX},${chunkZ}`;
                if (field.chunkMask.get(chunkKey) === false) {
                    // Off the table! Stop movement
                    this.completed = true;
                    return true;
                }
            }
            
            // Check current tile for slow effect (trees)
            const currentTileX = Math.floor(currentPos.x / TILE_SIZE);
            const currentTileZ = Math.floor(currentPos.z / TILE_SIZE);
            if (field.getSpeedMultiplier) {
                speedMultiplier = field.getSpeedMultiplier(currentTileX, currentTileZ);
            }
        }
        
        // Initialize velocity if it doesn't exist
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
                
        // Apply impulse to physics body for immediate movement
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }

        // Track that this unit was moved (use tick-based time for multiplayer sync)
        // CRITICAL: Don't use Date.now() here - it breaks multiplayer sync!
        // Instead use match tick if available, or skip entirely
        if (window.currentMatch && window.currentMatch.tick) {
            this.unit.lastMoveTick = window.currentMatch.tick;
        }
        
        // Apply movement with rotation and forward momentum boost
        // Apply speed multiplier for slow tiles (trees = 50% speed)
        const effectiveSpeed = this.params.walkSpeed * speedMultiplier;
        this.applyMovementWithRotation(direction, effectiveSpeed);
                
        return false;
    }
}

class RunBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 0.3,  // Stop very close to target point (reduced from 1.5)
            runSpeed: 35,  // Faster running speed
            ...params
        });
        
        this.targetPoint = targetPoint;
    }
    
    step() {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        
        const field = window.liveField;
        const TILE_SIZE = window.TILE_SIZE || 4;
        
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
        
        // TERRAIN CHECKS: Blocked tiles, slow tiles, table boundaries
        let speedMultiplier = 1.0;
        
        if (field) {
            // Calculate next step position (look ahead ~1 tile)
            const lookAheadDist = TILE_SIZE * 0.5;
            const nextX = currentPos.x + direction.x * lookAheadDist;
            const nextZ = currentPos.z + direction.z * lookAheadDist;
            const nextTileX = Math.floor(nextX / TILE_SIZE);
            const nextTileZ = Math.floor(nextZ / TILE_SIZE);
            
            // Check if next tile is blocked (rocks, deep water)
            if (field.isPassable && !field.isPassable(nextTileX, nextTileZ)) {
                // Blocked! Stop movement and complete behavior
                this.completed = true;
                return true;
            }
            
            // Check if next tile is off the table (chunk mask)
            if (field.chunkMask && field.chunkSize) {
                const chunkX = Math.floor(nextTileX / field.chunkSize);
                const chunkZ = Math.floor(nextTileZ / field.chunkSize);
                const chunkKey = `${chunkX},${chunkZ}`;
                if (field.chunkMask.get(chunkKey) === false) {
                    // Off the table! Stop movement
                    this.completed = true;
                    return true;
                }
            }
            
            // Check current tile for slow effect (trees)
            const currentTileX = Math.floor(currentPos.x / TILE_SIZE);
            const currentTileZ = Math.floor(currentPos.z / TILE_SIZE);
            if (field.getSpeedMultiplier) {
                speedMultiplier = field.getSpeedMultiplier(currentTileX, currentTileZ);
            }
        }
        
        // Track that this unit was moved (use tick-based time for multiplayer sync)
        if (window.currentMatch && window.currentMatch.tick) {
            this.unit.lastMoveTick = window.currentMatch.tick;
        }
        
        // Apply movement with rotation and forward momentum boost
        // Apply speed multiplier for slow tiles (trees = 50% speed)
        const effectiveSpeed = this.params.runSpeed * speedMultiplier;
        this.applyMovementWithRotation(direction, effectiveSpeed);
        
        return false;
    }
}


class WorkBehavior extends Behavior {
    constructor(unit, building, params = {}) {
        super(unit, {
            workDuration: 30000, // Work for 30 seconds before taking a break
            breakDuration: 5000, // 5 second break
            workSpeed: 18, // Gentle work speed for smooth movement
            ...params
        });
        
        this.building = building;
        this.workStartTick = window.currentMatch?.tick || 0;
        this.isOnBreak = false;
        this.breakStartTick = 0;
    }
    
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        const elapsedTicks = currentTick - this.workStartTick;
        const currentTime = currentTick * 50; // Convert to ms for compatibility
        const elapsed = elapsedTicks * 50;
        
        // Check if we should take a break
        if (!this.isOnBreak && elapsed > this.params.workDuration) {
            this.isOnBreak = true;
            this.breakStartTick = currentTick;
            // console.log(`🔨 ${this.unit.name || this.unit.type} taking a break from work`);
            return false;
        }
        
        // Check if break is over
        if (this.isOnBreak && (currentTime - this.breakStartTime) > this.params.breakDuration) {
            this.isOnBreak = false;
            this.workStartTime = currentTime;
            // console.log(`🔨 ${this.unit.name || this.unit.type} returning to work`);
            return false;
        }
        
        // If on break, just stay near the building
        if (this.isOnBreak) {
            this.stayNearBuilding();
        } else {
            // Work behavior - move around the building area
            this.performWork();
        }
        
        return false; // Keep working
    }
    
    performWork() {
        if (!this.building || !this.building.position) return;
        
        // Move around the building in a small area
        const workRadius = 2; // Work within 2 tiles of building
        const angle = ((window.currentMatch?.tick || 0) * 0.05) % (Math.PI * 2); // Deterministic slow rotation
        const distance = workRadius * TILE_SIZE * 0.5; // Half radius for closer work
        
        // CRITICAL: Round work position to prevent floating-point drift accumulation
        // Round to 0.01 precision (1cm) to keep positions synchronized
        const workX = Math.round((this.building.position.x + Math.cos(angle) * distance) * 100) / 100;
        const workZ = Math.round((this.building.position.z + Math.sin(angle) * distance) * 100) / 100;
        
        const direction = {
            x: workX - this.unit.pb.state.loc.x,
            z: workZ - this.unit.pb.state.loc.z
        };
        
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (length > 0.1) {
            direction.x /= length;
            direction.z /= length;
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
    }
    
    stayNearBuilding() {
        if (!this.building || !this.building.position) return;
        
        // Stay close to the building during break
        const dx = this.building.position.x - this.unit.pb.state.loc.x;
        const dz = this.building.position.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > TILE_SIZE * 1.5) {
            // Move closer to building
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed * 0.5);
        }
    }
}

class GatherWorkBehavior extends WorkBehavior {
    constructor(unit, building, params = {}) {
        super(unit, building, {
            workType: "gather",
            gatherRadius: 9, // How far to look for resources
            gatherDuration: 15000, // How long to gather (15 seconds)
            returnDuration: 3000, // How long to stay at camp (3 seconds)
            ...params
        });
        
        this.gatherState = 'seeking'; // seeking, gathering, returning
        this.gatherTarget = null;
        this.gatherStartTime = 0;
        this.gatherStartTick = 0; // CRITICAL: Tick-based timing for deterministic gathering
        this.returnStartTime = 0;
        this.returnStartTick = 0; // CRITICAL: Tick-based timing for deterministic drop-off
        // CRITICAL: Initialize seekStartTick deterministically to current tick
        // Workers are assigned at the same tick on both clients (via command system)
        // This ensures stagger delays are consistent across clients
        const currentTick = window.currentMatch?.tick || 0;
        this.seekStartTick = currentTick;
        this.resourceIndicator = null; // Visual indicator when carrying resources
        this.gatheredResourceType = null; // What resource this worker is carrying
        this.gatheredResourceAmount = 0; // How much of that resource
    }
    
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        const currentTime = currentTick * 50; // Convert to ms for compatibility
        
        // Handle different gather states
        switch (this.gatherState) {
            case 'seeking':
                this.seekResources(currentTime);
                break;
            case 'gathering':
                this.gatherResources(currentTime, currentTick);
                break;
            case 'returning':
                this.returnToCamp(currentTime, currentTick);
                break;
        }
        
        return false; // Keep working
    }
    
    // Called when worker is reassigned - handle any carried resources
    onReassignment() {
        // If worker is carrying resources, drop them off first
        if (this.gatheredResourceType && this.gatheredResourceAmount > 0) {
            // console.log(`🔄 ${this.unit.name || this.unit.type} reassigned while carrying ${this.gatheredResourceAmount} ${this.gatheredResourceType}, dropping off first`);
            this.addGatheredResources();
            this.removeResourceIndicator();
        }
    }
    
    seekResources(currentTime) {
        if (!this.building || !this.building.position) return;
        
        // CRITICAL: Add deterministic delay based on unit ID to stagger when villagers start seeking
        // This prevents all villagers from starting to move at exactly the same time
        const currentTick = window.currentMatch?.tick || 0;
        // Use deterministic random for better distribution and more natural variation
        const seekDelayTicks = Math.floor(getUnitDeterministicRandom(this.unit, 'seek_delay') * 30); // 0-29 tick delay (0-0.5 seconds at 60Hz)
        
        // CRITICAL: seekStartTick is initialized in constructor deterministically
        // If somehow it's null, initialize it (shouldn't happen, but safety check)
        if (this.seekStartTick === null || this.seekStartTick === undefined) {
            this.seekStartTick = currentTick;
        }
        const ticksSinceSeekStart = currentTick - this.seekStartTick;
        
        // Find nearest resource within gather radius (only search occasionally for performance)
        // Add unit-specific stagger to the search interval using deterministic random
        const baseSearchInterval = 40; // Base search every 40 ticks (~0.67 seconds at 60Hz)
        const searchVariation = Math.floor(getUnitDeterministicRandom(this.unit, 'search_interval') * 20); // 0-19 tick variation
        const searchInterval = baseSearchInterval + searchVariation; // 40-59 ticks, unique per unit
        const shouldSearch = !this.gatherTarget || ticksSinceSeekStart >= searchInterval || ticksSinceSeekStart % searchInterval === 0;
        
        if (shouldSearch) {
            const nearestResource = this.findNearestResource();
            if (nearestResource) {
                this.gatherTarget = nearestResource;
                // Reset seek start tick when we find a target
                this.seekStartTick = null;
            }
        }
        
        if (this.gatherTarget) {
            // CRITICAL: Apply unit's personality offset to resource target for visual variety
            // This prevents all workers from standing in the exact same spot
            // RE-ENABLED: Personality offset is deterministic (based on unit ID) and properly rounded
            // This ensures both clients calculate identical offsets, preventing desyncs
            const personalityOffset = this.unit.personalityOffset || { x: 0, z: 0 };
            const roundedOffset = {
                x: Math.round(personalityOffset.x * 1000) / 1000,
                z: Math.round(personalityOffset.z * 1000) / 1000
            };
            const adjustedResourceTarget = {
                x: Math.round((this.gatherTarget.x + roundedOffset.x) * 1000) / 1000,
                z: Math.round((this.gatherTarget.z + roundedOffset.z) * 1000) / 1000
            };
            
            // Continuously move toward resource target (with offset)
            const dx = adjustedResourceTarget.x - this.unit.pb.state.loc.x;
            const dz = adjustedResourceTarget.z - this.unit.pb.state.loc.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            // Once we reach the resource, switch to gathering state
            // CRITICAL: Use a slightly larger threshold and round distance to prevent floating-point precision issues
            // This ensures workers on both clients reach the resource at the same tick
            const arrivalThreshold = TILE_SIZE * 0.6; // Slightly larger threshold for determinism
            const roundedDistance = Math.round(distance * 100) / 100; // Round to 2 decimal places
            
            if (roundedDistance < arrivalThreshold) {
                this.gatherState = 'gathering';
                const currentTick = window.currentMatch?.tick || 0;
                // CRITICAL: Use tick-based timing for deterministic gathering
                // CRITICAL: Only set gatherStartTick if not already set to prevent resetting on subsequent frames
                if (!this.gatherStartTick || this.gatherStartTick === 0) {
                    this.gatherStartTime = currentTick * 50; // Convert tick to ms for compatibility
                    this.gatherStartTick = currentTick; // Store tick for deterministic completion check
                }
                // Store which resource we're gathering from for depletion tracking
                this.lastGatheredResource = { x: this.gatherTarget.x, z: this.gatherTarget.z };
                // console.log(`🔍 ${this.unit.name || this.unit.type} reached ${this.gatherTarget.type}, starting to gather`);
            } else {
                // Keep moving toward resource every frame (with offset applied)
                // CRITICAL: Round direction to fixed precision for deterministic movement
                const direction = { 
                    x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0, 
                    z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0 
                };
                this.applyMovementWithRotation(direction, this.params.workSpeed);
            }
        } else {
            // No resources found - check if camp truly has no available resources
            const availableResources = this.building.availableResources || [];
            const hasAvailableResources = availableResources.some(r => 
                !r.depleted && r.remaining > 0 && r.depletionTick === undefined &&
                (!window.isResourceTileDepleted || !window.isResourceTileDepleted(r.gridX, r.gridZ))
            );
            
            if (!hasAvailableResources) {
                // Camp has no resources - transition to idle so villager can be reassigned
                if (!this.noResourceWarningShown) {
                    console.log(`ℹ️ ${this.unit.name || this.unit.type} camp has no resources, transitioning to idle`);
                    this.noResourceWarningShown = true;
                }
                
                // Clear assignment to this building
                if (this.building && this.building.assignedWorkers) {
                    const idx = this.building.assignedWorkers.indexOf(this.unit);
                    if (idx > -1) {
                        this.building.assignedWorkers.splice(idx, 1);
                    }
                }
                this.unit.assignedBuilding = null;
                
                // Drop off any resources being carried
                if (this.gatheredResourceType && this.gatheredResourceAmount > 0) {
                    this.addGatheredResources();
                    this.removeResourceIndicator();
                }
                
                // Transition to idle behavior (linger)
                if (window.behaviorManager && this.unit.pb && this.unit.pb.state && this.unit.pb.state.loc) {
                    window.behaviorManager.setBehavior(this.unit, 'linger', {
                        center: { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z },
                        radius: 50,
                        wanderDistance: 2.0,
                        wanderInterval: 30000
                    });
                }
                return; // Exit - behavior has changed
            } else {
                // Resources exist but we couldn't find one (might be temporarily unavailable)
                // Keep searching but don't spam warnings
                super.performWork();
            }
        }
    }
    
    gatherResources(currentTime, currentTick) {
        if (!this.gatherTarget) {
            this.gatherState = 'seeking';
            return;
        }
        
        // Continuously check position and move if needed
        const dx = this.gatherTarget.x - this.unit.pb.state.loc.x;
        const dz = this.gatherTarget.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < TILE_SIZE * 0.5) {
            // We're at the resource, gathering in place
            // CRITICAL: Use tick-based timing for deterministic gathering completion
            // Convert gatherDuration from ms to ticks (20 ticks per second at 20Hz)
            const tickRate = 20; // Match net.TICK_RATE
            const gatherDurationTicks = Math.floor(this.params.gatherDuration / 1000 * tickRate);
            // CRITICAL: gatherStartTick must always be set - no fallback to ensure determinism
            if (!this.gatherStartTick) {
                this.gatherStartTick = currentTick;
            }
            const elapsedTicks = currentTick - this.gatherStartTick;
            
            const gatherProgress = elapsedTicks / gatherDurationTicks;
            if (gatherProgress < 1.0) {
                // console.log(`⛏️ ${this.unit.name || this.unit.type} gathering ${this.gatherTarget.type} (${Math.floor(gatherProgress * 100)}%)`);
            }
            
            // CRITICAL: Complete gathering based on ticks, not time, for deterministic sync
            if (elapsedTicks >= gatherDurationTicks) {
                // Finished gathering, return to camp
                // console.log(`📦 ${this.unit.name || this.unit.type} finished gathering ${this.gatherTarget.type}, returning to camp`);
                this.gatherState = 'returning';
                this.returnStartTime = currentTime;
                this.returnStartTick = currentTick; // Store tick for deterministic return timing
                
                // Store what was gathered
                this.gatheredResourceType = this.gatherTarget.type;
                this.gatheredResourceAmount = this.gatherTarget.amount || 1; // Default to 1 if no amount specified
                
                // Create visual indicator for carrying resources
                this.createResourceIndicator(this.gatherTarget.type);
                
                this.gatherTarget = null;
            }
            // Stay put while gathering (no movement)
        } else {
            // Keep moving towards resource every frame until we reach it
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
    }
    
    returnToCamp(currentTime, currentTick) {
        if (!this.building || !this.building.position) return;
        
        // CRITICAL: Apply unit's personality offset to camp position for visual variety
        // This prevents all workers from converging to the exact same spot at camp
        // RE-ENABLED: Personality offset is deterministic (based on unit ID) and properly rounded
        // This ensures both clients calculate identical offsets, preventing desyncs
        const personalityOffset = this.unit.personalityOffset || { x: 0, z: 0 };
        const roundedOffset = {
            x: Math.round(personalityOffset.x * 1000) / 1000,
            z: Math.round(personalityOffset.z * 1000) / 1000
        };
        const adjustedCampPosition = {
            x: Math.round((this.building.position.x + roundedOffset.x) * 1000) / 1000,
            z: Math.round((this.building.position.z + roundedOffset.z) * 1000) / 1000
        };
        
        // Continuously move back to camp every frame (with offset)
        const dx = adjustedCampPosition.x - this.unit.pb.state.loc.x;
        const dz = adjustedCampPosition.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Get much closer to camp for drop-off (within 0.5 tiles)
        if (distance > TILE_SIZE * 0.5) {
            // Keep moving towards camp every frame (with offset)
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
            // console.log(`🏃 ${this.unit.name || this.unit.type} returning to camp (${distance.toFixed(1)}m away)`);
        } else {
            // We're at camp - wait briefly then seek more resources
            // CRITICAL: Use tick-based timing for deterministic drop-off
            // Convert returnDuration from ms to ticks (20 ticks per second at 20Hz)
            const tickRate = 20; // Match net.TICK_RATE
            const returnDurationTicks = Math.floor(this.params.returnDuration / 1000 * tickRate);
            // CRITICAL: returnStartTick must always be set - initialize if missing to ensure determinism
            if (!this.returnStartTick) {
                this.returnStartTick = currentTick;
            }
            const elapsedTicks = currentTick - this.returnStartTick;
            
            // CRITICAL: Add deterministic delay based on unit ID to stagger villager actions
            // This prevents all villagers from acting in perfect synchronization
            const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const staggerDelayTicks = (unitIdHash % 10); // 0-9 tick delay (0-0.45 seconds at 20Hz)
            const totalReturnDurationTicks = returnDurationTicks + staggerDelayTicks;
            
            if (elapsedTicks >= totalReturnDurationTicks) {
                // console.log(`✅ ${this.unit.name || this.unit.type} dropped off resources at camp`);
                
                // Actually add resources to player when worker returns
                this.addGatheredResources();
                
                // Note: Removed tripsMade increment - it caused desyncs in multiplayer
                // Workers now stick to their assigned resource based on unit ID hash
                
                this.gatherState = 'seeking';
                this.gatherTarget = null; // Clear old target
                this.seekStartTick = null; // Reset seek start tick for stagger delay
                
                // Remove visual indicator when dropping off resources
                this.removeResourceIndicator();
            }
            // Just stay put at camp while waiting (no movement)
        }
    }
    
    findNearestResource() {
        if (!this.building || !this.building.position) return null;
        
        // Use the building's detected available resources
        let availableResources = this.building.availableResources || [];
        if (availableResources.length === 0) return null;
        
        // CRITICAL: Ensure resources are sorted deterministically
        // Prioritize stone over wood to balance resource gathering, then by gridX, gridZ
        // This prevents workers from always depleting wood first
        const sortedResources = availableResources.length > 1 ? 
            availableResources.slice().sort((a, b) => {
                // First priority: resource type (stone before wood)
                if (a.type !== b.type) {
                    if (a.type === 'stone') return -1;
                    if (b.type === 'stone') return 1;
                    // Both are wood or both are stone, continue to position sorting
                }
                // Second priority: grid position (deterministic)
                if (a.gridX !== b.gridX) return a.gridX - b.gridX;
                return a.gridZ - b.gridZ;
            }) : availableResources;
        
        // CRITICAL: Use a stable, deterministic resource selection for multiplayer sync
        // Pick resource based ONLY on unit ID hash so workers stick with their assigned resource
        // Use originalResourceCount if available to ensure consistent selection even after depletion
        // This ensures both clients select the same resource for the same worker
        
        // Initialize originalResourceCount if missing (for camps built before the fix)
        if (!this.building.originalResourceCount && sortedResources.length > 0) {
            this.building.originalResourceCount = sortedResources.length;
        }
        
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const resourceListLength = this.building.originalResourceCount || sortedResources.length;
        const resourceIndex = unitIdHash % resourceListLength;
        
        // Get resource from sorted list using original count for index calculation
        // Skip depleted resources by wrapping around deterministically
        // CRITICAL: Use originalResourceCount for index calculation to ensure consistency
        // CRITICAL: sortedResources should always have the same length as originalResourceCount
        // (resources are marked as depleted, not removed from array)
        let resource = null;
        let attempts = 0;
        const maxAttempts = resourceListLength; // Use original count, not current array length
        
        // CRITICAL: Ensure sortedResources array matches expected length
        // If it doesn't, something went wrong (resources shouldn't be removed, only marked depleted)
        if (sortedResources.length !== resourceListLength) {
            console.warn(`⚠️ availableResources length (${sortedResources.length}) doesn't match originalResourceCount (${resourceListLength})! This can cause desyncs.`);
        }
        
        // Try to find an available resource starting from calculated index
        // Wrap around deterministically using originalResourceCount
        while (attempts < maxAttempts && (!resource || resource.depleted || resource.remaining <= 0 || resource.depletionTick !== undefined)) {
            const wrappedIndex = (resourceIndex + attempts) % resourceListLength;
            // CRITICAL: Use wrappedIndex directly - sortedResources should match originalResourceCount length
            if (wrappedIndex < sortedResources.length) {
                const candidate = sortedResources[wrappedIndex];
                // CRITICAL: Don't select resources scheduled for depletion (even if not yet marked as depleted)
                // Also check global depletion state - resources can be depleted by other camps
                // This ensures both clients select the same available resources
                const isGloballyDepleted = window.isResourceTileDepleted && 
                    window.isResourceTileDepleted(candidate.gridX, candidate.gridZ);
                if (candidate && !candidate.depleted && candidate.remaining > 0 && 
                    candidate.depletionTick === undefined && !isGloballyDepleted) {
                    resource = candidate;
                    break;
                }
            }
            attempts++;
        }
        
        // If no resource found, return null
        if (!resource || resource.depleted || resource.remaining <= 0) {
            return null;
        }
        
        // Track resource assignment (silently)
        // CRITICAL: Use !== undefined to handle resourceIndex === 0 correctly
        if (this.lastResourceIndex === undefined || this.lastResourceIndex !== resourceIndex) {
            this.lastResourceIndex = resourceIndex;
        }
        
        return {
            x: resource.worldX,
            z: resource.worldZ,
            type: resource.type,
            amount: resource.amount
        };
    }
    
    createResourceIndicator(resourceType) {
        if (!this.unit.mesh || this.resourceIndicator) return;
        
        let indicator;
        const material = new BABYLON.StandardMaterial("resourceIndicatorMaterial", window.gfx.scene);
        
        if (resourceType === 'wood') {
            // Create a log (cylinder) for wood - 6x bigger!
            indicator = BABYLON.MeshBuilder.CreateCylinder("resourceIndicator", {
                height: 4.8,  // 0.8 * 6
                diameter: 1.5  // 0.25 * 6
            }, window.gfx.scene);
            
            // Rotate log to be horizontal (lying on head)
            indicator.rotation.z = Math.PI / 2; // Rotate 90 degrees around Z axis
            
            material.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1); // Brown for wood
            material.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0.02);
        } else if (resourceType === 'stone') {
            // Create a box (rock) for stone - 6x bigger and angular!
            indicator = BABYLON.MeshBuilder.CreateBox("resourceIndicator", {
                width: 3.0,   // 0.5 * 6
                height: 2.4,  // 0.4 * 6
                depth: 2.7    // 0.45 * 6
            }, window.gfx.scene);
            
            // Add slight rotation to make it look more natural/irregular
            indicator.rotation.x = Math.PI * 0.15;
            indicator.rotation.z = Math.PI * 0.1;
            
            material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Gray for stone
            material.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        } else {
            // Fallback to sphere for other resource types
            indicator = BABYLON.MeshBuilder.CreateSphere("resourceIndicator", {
                diameter: 0.3
            }, window.gfx.scene);
            
            material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            material.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        }
        
        // Position above the unit's head
        indicator.position = new BABYLON.Vector3(0, 2.5, 0);
        indicator.parent = this.unit.mesh;
        
        material.alpha = 0.9;
        indicator.material = material;
        
        // Add a subtle glow effect
        indicator.renderingGroupId = 1; // Render after main scene
        
        this.resourceIndicator = indicator;
        // console.log(`💎 Created ${resourceType} indicator for ${this.unit.name || this.unit.type}`);
    }
    
    removeResourceIndicator() {
        if (this.resourceIndicator) {
            this.resourceIndicator.dispose();
            this.resourceIndicator = null;
            // console.log(`🗑️ Removed resource indicator from ${this.unit.name || this.unit.type}`);
        }
    }
    
    addGatheredResources() {
        if (!this.gatheredResourceType || this.gatheredResourceAmount <= 0) return;
        
        // Map resource types to player resource names
        const resourceTypeMap = {
            'minerals': 'magic', // Small rocks give 'minerals' but player resources use 'magic'
            'wood': 'wood',
            'stone': 'stone',
            'food': 'food'
        };
        
        const playerResourceType = resourceTypeMap[this.gatheredResourceType] || this.gatheredResourceType;
        
        // Add the specific resources this worker gathered to their owner (not always window.player!)
        const owner = findPlayerByUnitOwner(this.unit.owner);
        if (owner && owner.addResource) {
            owner.addResource(playerResourceType, this.gatheredResourceAmount);
            // console.log(`💰 ${this.unit.name || this.unit.type} delivered ${this.gatheredResourceAmount} ${playerResourceType} to ${owner.name || owner.id}`);
        }
        
        // RESOURCE DEPLETION: Queue decrement to be applied at sync checkpoint
        // CRITICAL: Don't apply immediately - queue for sync checkpoint to ensure both clients apply at same tick
        if (this.building && this.building.availableResources && this.lastGatheredResource) {
            // Find the resource tile this worker gathered from
            const resourceTile = this.building.availableResources.find(r => 
                r.worldX === this.lastGatheredResource.x && 
                r.worldZ === this.lastGatheredResource.z
            );
            
            if (resourceTile && resourceTile.remaining !== undefined && window.currentMatch) {
                const currentTick = window.currentMatch.tick;
                
                // Queue the decrement to be processed at the next sync checkpoint
                // CRITICAL: Include the tick when queued so we only process decrements from previous interval
                // This ensures both clients apply decrements at the same tick, preventing desyncs
                window.currentMatch.pendingResourceDecrements.push({
                    buildingId: this.building.id,
                    gridX: resourceTile.gridX,
                    gridZ: resourceTile.gridZ,
                    amount: this.gatheredResourceAmount,
                    queuedAtTick: currentTick // Track when this was queued
                });
            }
        }
        
        // Reset gathered resources
        this.gatheredResourceType = null;
        this.gatheredResourceAmount = 0;
        this.lastGatheredResource = null;
    }
}

class FarmWorkBehavior extends WorkBehavior {
    constructor(unit, building, params = {}) {
        super(unit, building, {
            workType: "farm",
            workDuration: 45000, // Farm work takes longer
            breakDuration: 8000, // Longer breaks for farming
            patrolRadius: 1.9, // How far from building to patrol (reduced by 50%)
            patrolSpeed: 0.5, // Slower patrol speed
            ...params
        });
        
        // CRITICAL: Initialize workStartTime for break timing (parent uses workStartTick)
        const currentTick = window.currentMatch?.tick || 0;
        this.workStartTime = currentTick * 50; // Convert to ms
        this.breakStartTime = 0;
        
        this.patrolPoints = [];
        this.currentPatrolIndex = 0;
        this.patrolDirection = 1; // 1 for forward, -1 for backward
        this.generatePatrolPoints();
    }
    
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        const currentTime = currentTick * 50; // Convert to ms for compatibility
        
        // Check if we should take a break
        if (!this.isOnBreak && (currentTime - this.workStartTime) > this.params.workDuration) {
            this.isOnBreak = true;
            this.breakStartTime = currentTime;
            return false;
        }
        
        // Check if break is over
        if (this.isOnBreak && (currentTime - this.breakStartTime) > this.params.breakDuration) {
            this.isOnBreak = false;
            this.workStartTime = currentTime;
            return false;
        }
        
        // If on break, stay near building
        if (this.isOnBreak) {
            this.stayNearBuilding();
        } else {
            // Patrol the farm perimeter
            this.patrolPerimeter();
        }
        
        return false; // Keep working
    }
    
    generatePatrolPoints() {
        if (!this.building || !this.building.position) return;
        
        this.patrolPoints = [];
        const centerX = this.building.position.x;
        const centerZ = this.building.position.z;
        const radius = this.params.patrolRadius * TILE_SIZE;
        
        // Create 8 patrol points around the perimeter
        const numPoints = 8;
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * Math.PI * 2;
            const x = centerX + Math.cos(angle) * radius;
            const z = centerZ + Math.sin(angle) * radius;
            
            this.patrolPoints.push({ x, z });
        }
    }
    
    patrolPerimeter() {
        if (this.patrolPoints.length === 0) {
            this.generatePatrolPoints();
            return;
        }
        
        const currentPoint = this.patrolPoints[this.currentPatrolIndex];
        const dx = currentPoint.x - this.unit.pb.state.loc.x;
        const dz = currentPoint.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < TILE_SIZE * 0.3) {
            // Reached current patrol point, move to next
            this.currentPatrolIndex += this.patrolDirection;
            
            // Handle wrapping around
            if (this.currentPatrolIndex >= this.patrolPoints.length) {
                this.currentPatrolIndex = 0;
            } else if (this.currentPatrolIndex < 0) {
                this.currentPatrolIndex = this.patrolPoints.length - 1;
            }
            
            // Occasionally reverse direction for more natural movement (deterministic)
            const currentTick = window.currentMatch?.tick || 0;
            const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            if (((currentTick + unitIdHash) % 100) < 10) { // 10% chance based on tick
                this.patrolDirection *= -1;
            }
        } else {
            // Move towards current patrol point
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed * this.params.patrolSpeed);
        }
    }
}

class BuildWorkBehavior extends WorkBehavior {
    constructor(unit, building, params = {}) {
        super(unit, building, {
            workType: "build",
            workSpeed: 18, // Same as regular work speed
            ...params
        });
    }
    
    step() {
        if (!this.building || !this.building.position) return false;
        
        // Check if building is complete
        if (this.building.buildProgress >= 1.0) {
            // Building is complete, this behavior should end
            return true;
        }
        
        // Move around the building construction site
        const workRadius = 2; // Work within 2 tiles of building
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const currentTick = window.currentMatch?.tick || 0;
        // Use deterministic angle based on unit ID and tick for multiplayer sync
        // CRITICAL: Round angle calculation to prevent floating-point drift
        const angle = ((currentTick * 0.05) + (unitIdHash % 100) * 0.1) % (Math.PI * 2);
        const distance = workRadius * TILE_SIZE * 0.5; // Half radius for closer work
        
        // CRITICAL: Round work position to prevent floating-point drift accumulation
        // Round to 0.01 precision (1cm) to keep positions synchronized
        const workX = Math.round((this.building.position.x + Math.cos(angle) * distance) * 100) / 100;
        const workZ = Math.round((this.building.position.z + Math.sin(angle) * distance) * 100) / 100;
        
        const direction = {
            x: workX - this.unit.pb.state.loc.x,
            z: workZ - this.unit.pb.state.loc.z
        };
        
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (length > 0.1) {
            direction.x /= length;
            direction.z /= length;
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
        
        return false; // Keep building
    }
}

class AttackBuildingBehavior extends Behavior {
    constructor(unit, building, params = {}) {
        const TILE_SIZE = window.TILE_SIZE || 4;
        super(unit, {
            attackRange: 2.0 * TILE_SIZE, // Attack within 2 tiles
            attackDamage: 5, // Damage per attack
            attackCooldown: 2000, // 2 seconds between attacks
            ...params
        });
        
        this.building = building;
        this.lastAttackTime = 0;
        this.attackCooldownTicks = Math.floor(this.params.attackCooldown / 50); // Convert ms to ticks
    }
    
    step() {
        if (!this.building || !this.building.position) return true; // Building gone, stop attacking
        
        // Check if building is destroyed
        if (!this.building.health || this.building.health <= 0) {
            return true; // Building destroyed, stop attacking
        }
        
        // Don't require mesh - buildings under construction might not have mesh yet
        // Just check if building still exists in gameBuildings
        if (window.gameBuildings && !window.gameBuildings.includes(this.building)) {
            return true; // Building removed from game
        }
        
        const currentTick = window.currentMatch?.tick || 0;
        const unitPos = this.unit.pb?.state?.loc;
        if (!unitPos) return false;
        
        // Calculate distance to building
        const dx = this.building.position.x - unitPos.x;
        const dz = this.building.position.z - unitPos.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // If within attack range, attack the building
        if (distance <= this.params.attackRange) {
            // Face the building
            const targetAngle = Math.atan2(dx, dz);
            const currentRotation = this.unit.pb.state.rot.y || 0;
            let rotationDiff = targetAngle - currentRotation;
            
            // Handle angle wrapping
            if (Math.abs(rotationDiff) > Math.PI) {
                rotationDiff = rotationDiff > 0 ? rotationDiff - Math.PI * 2 : rotationDiff + Math.PI * 2;
            }
            
            // Initialize rotation impulse if needed
            if (!this.unit.pb.rotImp) {
                this.unit.pb.rotImp = { x: 0, y: 0, z: 0 };
            }
            
            // Check attack cooldown
            const ticksSinceLastAttack = currentTick - this.lastAttackTime;
            const isAttacking = ticksSinceLastAttack < this.attackCooldownTicks * 0.3; // First 30% of cooldown is "attacking"
            
            if (ticksSinceLastAttack >= this.attackCooldownTicks) {
                // Attack the building
                const oldHealth = this.building.health;
                this.building.health = Math.max(0, this.building.health - this.params.attackDamage);
                this.lastAttackTime = currentTick;
                
                console.log(`💥 Brigand ${this.unit.id} attacked ${this.building.name || this.building.type}: ${oldHealth} -> ${this.building.health} health`);
                
                // Add damage effects
                if (window.fx && window.fx.addBuildingDamageEffects) {
                    window.fx.addBuildingDamageEffects(this.building);
                }
                
                // SPECIAL: Brigands set buildings on fire when attacking
                if (this.unit.type === 'brigand' && window.fx && this.building.mesh) {
                    // Check if building already has fire
                    const hasFire = this.building.particleEffects && 
                                   this.building.particleEffects.some(effect => effect.type === 'fire');
                    if (!hasFire) {
                        // Set building on fire!
                        window.fx.attachParticleEffect(this.building, 'fire', 'fire_anchor', {
                            scale: 0.6, // Moderate fire
                            emitRate: 40,
                            minSize: 0.8,
                            maxSize: 1.5
                        });
                        console.log(`🔥 Brigand set ${this.building.name || this.building.type} on fire!`);
                    }
                }
                
                // Check if building should be destroyed
                if (this.building.health <= 0 && window.fx && window.fx.destroyBuilding) {
                    console.log(`💀 Building ${this.building.name || this.building.type} destroyed!`);
                    window.fx.destroyBuilding(this.building);
                }
            }
            
            // Spin animation when attacking!
            if (isAttacking) {
                // Fast spinning during attack animation
                const spinSpeed = 0.5; // Fast spin
                this.unit.pb.rotImp.y += spinSpeed;
            } else {
                // Face building when not actively attacking
                this.unit.pb.rotImp.y += rotationDiff * 5.0; // Fast rotation to face target
            }
            
            // Stay in place while attacking (small circular movement to look natural)
            const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const angle = ((currentTick * 0.15) + (unitIdHash % 100) * 0.01) % (Math.PI * 2);
            const smallRadius = 0.8; // Slightly larger movement radius
            const moveX = this.building.position.x + Math.cos(angle) * smallRadius;
            const moveZ = this.building.position.z + Math.sin(angle) * smallRadius;
            
            const direction = {
                x: moveX - unitPos.x,
                z: moveZ - unitPos.z
            };
            
            const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
            if (length > 0.05) {
                direction.x /= length;
                direction.z /= length;
                this.applyMovementWithRotation(direction, this.unit.speed * 0.4); // Moderate movement while attacking
            }
        } else {
            // Move towards building
            const direction = {
                x: dx / distance,
                z: dz / distance
            };
            this.applyMovementWithRotation(direction, this.unit.speed || 20);
        }
        
        return false; // Keep attacking
    }
}

class EngineerWorkBehavior extends WorkBehavior {
    constructor(unit, building, params = {}) {
        super(unit, building, {
            workType: "engineer",
            workDuration: 60000, // Engineers work longer
            breakDuration: 10000, // Longer breaks
            inspectionRadius: 12, // How far to look for buildings to inspect
            inspectionDuration: 20000, // How long to inspect each building
            ...params
        });
        
        this.inspectionTarget = null;
        this.inspectionStartTime = 0;
        this.visitedBuildings = new Set();
        this.currentState = 'seeking'; // seeking, inspecting, returning
    }
    
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        const currentTime = currentTick * 50; // Convert to ms for compatibility
        
        // Handle different engineer states
        switch (this.currentState) {
            case 'seeking':
                this.seekBuildingsToInspect();
                break;
            case 'inspecting':
                this.inspectBuilding(currentTime);
                break;
            case 'returning':
                this.returnToBase(currentTime);
                break;
        }
        
        return false; // Keep working
    }
    
    seekBuildingsToInspect() {
        if (!this.building || !this.building.position) return;
        
        // Find nearest building to inspect
        const nearestBuilding = this.findNearestBuildingToInspect();
        
        if (nearestBuilding) {
            const currentTick = window.currentMatch?.tick || 0;
            const currentTime = currentTick * 50; // Convert to ms for compatibility
            
            this.inspectionTarget = nearestBuilding;
            this.currentState = 'inspecting';
            this.inspectionStartTime = currentTime;
            
            // Move to building
            const direction = {
                x: nearestBuilding.position.x - this.unit.pb.state.loc.x,
                z: nearestBuilding.position.z - this.unit.pb.state.loc.z
            };
            
            const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
            if (length > 0.1) {
                direction.x /= length;
                direction.z /= length;
                this.applyMovementWithRotation(direction, this.params.workSpeed);
            }
        } else {
            // No buildings to inspect, just wander around base
            super.performWork();
        }
    }
    
    inspectBuilding(currentTime) {
        if (!this.inspectionTarget) {
            this.currentState = 'seeking';
            return;
        }
        
        // Check if we've reached the building
        const dx = this.inspectionTarget.position.x - this.unit.pb.state.loc.x;
        const dz = this.inspectionTarget.position.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        const TILE_SIZE = window.TILE_SIZE || 4;
        if (distance < TILE_SIZE * 1.5) {
            // We're at the building, inspect and repair it
            if (currentTime - this.inspectionStartTime > this.params.inspectionDuration) {
                const currentTick = window.currentMatch?.tick || 0;
                const engineerOwner = this.unit.owner?.length > 6 ? this.unit.owner.slice(-6) : this.unit.owner;
                
                // SPECIAL: Handle camps - redirect idle villagers and check if empty
                if (this.inspectionTarget.type === 'camp') {
                    // 1. Find idle villagers at this camp
                    const idleVillagers = [];
                    const campWorkRadius = (this.inspectionTarget.workRadius || 7) * TILE_SIZE;
                    
                    for (const unit of (window.gameUnits || [])) {
                        if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
                        if (unit.type !== 'villager') continue;
                        
                        // Check ownership
                        const unitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
                        if (unitOwner !== engineerOwner) continue;
                        
                        // Check if idle (no behavior or just linger)
                        const behavior = window.behaviorManager ? window.behaviorManager.getBehavior(unit) : null;
                        const isIdle = !behavior || behavior.constructor.name === 'LingerBehavior';
                        if (!isIdle) continue;
                        
                        // Check distance from camp
                        const unitDx = unit.pb.state.loc.x - this.inspectionTarget.position.x;
                        const unitDz = unit.pb.state.loc.z - this.inspectionTarget.position.z;
                        const unitDistance = Math.sqrt(unitDx * unitDx + unitDz * unitDz);
                        
                        if (unitDistance <= campWorkRadius) {
                            idleVillagers.push(unit);
                        }
                    }
                    
                    // 2. Find other buildings that need workers
                    const buildingsNeedingWorkers = [];
                    const allBuildings = window.gameBuildings || [];
                    
                    for (const building of allBuildings) {
                        if (!building.position || !building.needsWorkers) continue;
                        if (building.id === this.inspectionTarget.id) continue; // Skip current camp
                        if (building.type === 'agora') continue; // Skip agora
                        
                        // Check ownership
                        const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
                        if (buildingOwner !== engineerOwner) continue;
                        
                        // Check if building needs more workers
                        const workerCount = building.assignedWorkers?.length || 0;
                        if (workerCount < building.maxWorkers) {
                            buildingsNeedingWorkers.push(building);
                        }
                    }
                    
                    // 3. Redirect idle villagers to other buildings
                    if (idleVillagers.length > 0 && buildingsNeedingWorkers.length > 0) {
                        // Sort buildings by priority (camps with resources > farms > empty camps)
                        buildingsNeedingWorkers.sort((a, b) => {
                            const aHasResources = (a.availableResources?.length || 0) > 0;
                            const bHasResources = (b.availableResources?.length || 0) > 0;
                            if (aHasResources && !bHasResources) return -1;
                            if (!aHasResources && bHasResources) return 1;
                            if (a.type === 'farm' && b.type !== 'farm') return -1;
                            if (a.type !== 'farm' && b.type === 'farm') return 1;
                            return 0;
                        });
                        
                        let redirected = 0;
                        let buildingIndex = 0;
                        
                        for (const villager of idleVillagers) {
                            // Find next building that needs workers
                            let targetBuilding = null;
                            while (buildingIndex < buildingsNeedingWorkers.length) {
                                const candidate = buildingsNeedingWorkers[buildingIndex];
                                const workerCount = candidate.assignedWorkers?.length || 0;
                                if (workerCount < candidate.maxWorkers) {
                                    targetBuilding = candidate;
                                    break;
                                }
                                buildingIndex++;
                            }
                            
                            if (!targetBuilding) break; // No more buildings need workers
                            
                            // Redirect villager using command system
                            if (window.currentMatch && window.assignVillagerToWork) {
                                // Remove from old camp's workers if assigned
                                if (villager.assignedBuilding) {
                                    const oldBuilding = villager.assignedBuilding;
                                    if (oldBuilding.assignedWorkers) {
                                        const idx = oldBuilding.assignedWorkers.indexOf(villager);
                                        if (idx > -1) oldBuilding.assignedWorkers.splice(idx, 1);
                                    }
                                }
                                
                                // Assign to new building
                                if (window.assignVillagerToWork(villager, targetBuilding)) {
                                    redirected++;
                                    console.log(`🔧 Engineer redirected villager from empty camp to ${targetBuilding.name || targetBuilding.type}`);
                                    
                                    // Check if this building is now full, move to next
                                    const newWorkerCount = targetBuilding.assignedWorkers?.length || 0;
                                    if (newWorkerCount >= targetBuilding.maxWorkers) {
                                        buildingIndex++;
                                    }
                                }
                            }
                        }
                        
                        if (redirected > 0) {
                            console.log(`🔧 Engineer redirected ${redirected} idle villager(s) to other buildings`);
                        }
                    }
                    
                    // 4. Check if camp is empty (no workers, no resources)
                    const campWorkers = this.inspectionTarget.assignedWorkers?.length || 0;
                    const campResources = this.inspectionTarget.availableResources?.length || 0;
                    
                    if (campWorkers === 0 && campResources === 0) {
                        // Deconstruct empty camp and refund 5 wood
                        // Find player by owner ID (check multiple ways)
                        let player = null;
                        
                        // Try to find player from match system
                        if (window.currentMatch && window.currentMatch.players) {
                            for (const p of window.currentMatch.players) {
                                const pId = p.id || p;
                                const normalizedPId = pId.length > 6 ? pId.slice(-6) : pId;
                                if (normalizedPId === engineerOwner) {
                                    player = p;
                                    break;
                                }
                            }
                        }
                        
                        // Fallback to window.player if it matches
                        if (!player && window.player) {
                            const normalizedPlayerId = window.player.id?.length > 6 ? window.player.id.slice(-6) : window.player.id;
                            if (normalizedPlayerId === engineerOwner) {
                                player = window.player;
                            }
                        }
                        
                        if (player && player.addResource) {
                            player.addResource('wood', 5);
                            console.log(`🔧 Engineer deconstructed empty camp and refunded 5 wood`);
                        }
                        
                        // Remove building from game
                        if (window.fx && window.fx.destroyBuilding) {
                            window.fx.destroyBuilding(this.inspectionTarget);
                        } else {
                            // Fallback: manual removal
                            if (window.gameBuildings) {
                                const idx = window.gameBuildings.indexOf(this.inspectionTarget);
                                if (idx > -1) window.gameBuildings.splice(idx, 1);
                            }
                            
                            // Remove from player's buildings
                            if (player && player.buildings) {
                                const idx = player.buildings.indexOf(this.inspectionTarget);
                                if (idx > -1) player.buildings.splice(idx, 1);
                            }
                            
                            // Hide mesh
                            if (this.inspectionTarget.mesh) {
                                this.inspectionTarget.mesh.setEnabled(false);
                                this.inspectionTarget.mesh.position.y = -10000;
                            }
                        }
                        
                        // Don't mark as visited since it's gone
                        this.currentState = 'seeking';
                        this.inspectionTarget = null;
                        return;
                    }
                }
                
                // SPECIAL: Handle villages - redirect idle villagers to far away camps/buildings
                if (this.inspectionTarget.spawnsVillagers) {
                    // 1. Find idle villagers near this village
                    const idleVillagers = [];
                    const villageRadius = 15 * TILE_SIZE; // Larger radius since villagers spawn around villages
                    
                    for (const unit of (window.gameUnits || [])) {
                        if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
                        if (unit.type !== 'villager') continue;
                        
                        // Check ownership
                        const unitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
                        if (unitOwner !== engineerOwner) continue;
                        
                        // Check if idle (no behavior or just linger)
                        const behavior = window.behaviorManager ? window.behaviorManager.getBehavior(unit) : null;
                        const isIdle = !behavior || behavior.constructor.name === 'LingerBehavior';
                        if (!isIdle) continue;
                        
                        // Don't redirect villagers that just got a player move command
                        if (unit.lastPlayerMoveTick !== undefined) {
                            const ticksSincePlayerMove = currentTick - unit.lastPlayerMoveTick;
                            if (ticksSincePlayerMove < 60) {
                                continue; // Skip - player just moved them
                            }
                        }
                        
                        // Check distance from village
                        const unitDx = unit.pb.state.loc.x - this.inspectionTarget.position.x;
                        const unitDz = unit.pb.state.loc.z - this.inspectionTarget.position.z;
                        const unitDistance = Math.sqrt(unitDx * unitDx + unitDz * unitDz);
                        
                        if (unitDistance <= villageRadius) {
                            idleVillagers.push(unit);
                        }
                    }
                    
                    // 2. Find camps/buildings that need workers (especially far away ones)
                    const buildingsNeedingWorkers = [];
                    const allBuildings = window.gameBuildings || [];
                    
                    for (const building of allBuildings) {
                        if (!building.position || !building.needsWorkers) continue;
                        if (building.id === this.inspectionTarget.id) continue; // Skip current village
                        if (building.type === 'agora') continue; // Skip agora
                        if (building.spawnsVillagers) continue; // Skip other villages
                        
                        // Check ownership
                        const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
                        if (buildingOwner !== engineerOwner) continue;
                        
                        // Only consider completed buildings
                        if (building.buildProgress !== undefined && building.buildProgress < 1.0) continue;
                        
                        // Check if building needs more workers
                        const workerCount = building.assignedWorkers?.length || 0;
                        if (workerCount < building.maxWorkers) {
                            // Calculate distance from village to prioritize far away buildings
                            const buildingDx = building.position.x - this.inspectionTarget.position.x;
                            const buildingDz = building.position.z - this.inspectionTarget.position.z;
                            const buildingDistance = Math.sqrt(buildingDx * buildingDx + buildingDz * buildingDz);
                            
                            buildingsNeedingWorkers.push({
                                building: building,
                                distance: buildingDistance
                            });
                        }
                    }
                    
                    // 3. Redirect idle villagers to far away camps/buildings
                    if (idleVillagers.length > 0 && buildingsNeedingWorkers.length > 0) {
                        // Sort buildings by distance (far away first) and priority (camps with resources > farms > empty camps)
                        buildingsNeedingWorkers.sort((a, b) => {
                            // First priority: distance (far away first, but only if reasonably far)
                            const minDistance = 10 * TILE_SIZE; // Only prioritize if at least 10 tiles away
                            const aIsFar = a.distance >= minDistance;
                            const bIsFar = b.distance >= minDistance;
                            if (aIsFar && !bIsFar) return -1;
                            if (!aIsFar && bIsFar) return 1;
                            
                            // If both are far or both are close, prioritize by distance (farther = better)
                            if (aIsFar && bIsFar && Math.abs(a.distance - b.distance) > 2 * TILE_SIZE) {
                                return b.distance - a.distance; // Farther first
                            }
                            
                            // Then by resource priority
                            const aHasResources = (a.building.availableResources?.length || 0) > 0;
                            const bHasResources = (b.building.availableResources?.length || 0) > 0;
                            if (aHasResources && !bHasResources) return -1;
                            if (!aHasResources && bHasResources) return 1;
                            if (a.building.type === 'farm' && b.building.type !== 'farm') return -1;
                            if (a.building.type !== 'farm' && b.building.type === 'farm') return 1;
                            
                            return 0;
                        });
                        
                        let redirected = 0;
                        let buildingIndex = 0;
                        
                        for (const villager of idleVillagers) {
                            // Find next building that needs workers
                            let targetBuilding = null;
                            while (buildingIndex < buildingsNeedingWorkers.length) {
                                const candidate = buildingsNeedingWorkers[buildingIndex].building;
                                const workerCount = candidate.assignedWorkers?.length || 0;
                                if (workerCount < candidate.maxWorkers) {
                                    targetBuilding = candidate;
                                    break;
                                }
                                buildingIndex++;
                            }
                            
                            if (!targetBuilding) break; // No more buildings need workers
                            
                            // Redirect villager using command system
                            if (window.currentMatch && window.assignVillagerToWork) {
                                // Remove from old building's workers if assigned
                                if (villager.assignedBuilding) {
                                    const oldBuilding = villager.assignedBuilding;
                                    if (oldBuilding.assignedWorkers) {
                                        const idx = oldBuilding.assignedWorkers.indexOf(villager);
                                        if (idx > -1) oldBuilding.assignedWorkers.splice(idx, 1);
                                    }
                                }
                                
                                // Assign to new building
                                if (window.assignVillagerToWork(villager, targetBuilding)) {
                                    redirected++;
                                    const distance = buildingsNeedingWorkers[buildingIndex].distance;
                                    console.log(`🔧 Engineer sent villager from village to ${targetBuilding.name || targetBuilding.type} (${Math.round(distance / TILE_SIZE)} tiles away)`);
                                    
                                    // Check if this building is now full, move to next
                                    const newWorkerCount = targetBuilding.assignedWorkers?.length || 0;
                                    if (newWorkerCount >= targetBuilding.maxWorkers) {
                                        buildingIndex++;
                                    }
                                }
                            }
                        }
                        
                        if (redirected > 0) {
                            console.log(`🔧 Engineer sent ${redirected} idle villager(s) from village to camps/buildings`);
                        }
                    }
                }
                
                // Apply engineer's effects for non-camps or camps that aren't empty:
                // 1. Repair to full health
                if (this.inspectionTarget.maxHealth !== undefined) {
                    this.inspectionTarget.health = this.inspectionTarget.maxHealth;
                } else if (this.inspectionTarget.currentHealth !== undefined) {
                    // Some buildings use currentHealth instead
                    this.inspectionTarget.currentHealth = 100;
                }
                
                // 2. Apply efficiency boost (use tick-based time for consistency)
                const boostDurationTicks = Math.floor(30000 / 50); // 30 seconds in ticks (50ms per tick)
                this.inspectionTarget.engineerBoostUntil = currentTick + boostDurationTicks;
                this.inspectionTarget.engineerBoostAmount = 1.5; // 50% boost (matches building code expectation)
                
                // Finished inspecting, mark as visited and return to base
                this.visitedBuildings.add(this.inspectionTarget.id);
                this.currentState = 'returning';
                this.inspectionTarget = null;
                
                // console.log(`🔧 Engineer repaired building and applied 50% efficiency boost for 30 seconds`);
            }
            // Just stay put while inspecting
        } else {
            // Move towards building
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
    }
    
    returnToBase(currentTime) {
        if (!this.building || !this.building.position) return;
        
        const TILE_SIZE = window.TILE_SIZE || 4;
        
        // Move back to base building
        const dx = this.building.position.x - this.unit.pb.state.loc.x;
        const dz = this.building.position.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance > TILE_SIZE * 2) {
            // Move towards base
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        } else {
            // We're back at base, start seeking again
            this.currentState = 'seeking';
        }
    }
    
    findNearestBuildingToInspect() {
        if (!this.building || !this.building.position) return null;
        
        const TILE_SIZE = window.TILE_SIZE || 4;
        const inspectionRadius = this.params.inspectionRadius * TILE_SIZE;
        let nearestBuilding = null;
        let nearestDistance = Infinity;
        
        // Get the engineer's owner (normalized)
        const engineerOwner = this.unit.owner?.length > 6 ? this.unit.owner.slice(-6) : this.unit.owner;
        
        // Look through all buildings
        const allBuildings = window.gameBuildings || [];
        for (const building of allBuildings) {
            if (!building.position) continue;
            if (building.id === this.building.id) continue; // Don't inspect own building
            if (this.visitedBuildings.has(building.id)) continue; // Already visited recently
            
            // Only inspect buildings owned by the same player
            const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
            if (buildingOwner !== engineerOwner) continue;
            
            // Skip agora (no need to inspect)
            if (building.type === 'agora') continue;
            
            const dx = building.position.x - this.building.position.x;
            const dz = building.position.z - this.building.position.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            
            if (distance <= inspectionRadius && distance < nearestDistance) {
                nearestBuilding = building;
                nearestDistance = distance;
            }
        }
        
        // If no unvisited buildings, reset visited list and try again
        if (!nearestBuilding && this.visitedBuildings.size > 0) {
            this.visitedBuildings.clear();
            return this.findNearestBuildingToInspect();
        }
        
        return nearestBuilding;
    }
}

class WanderBehavior extends Behavior {
    constructor(unit, params = {}) {
        // CRITICAL: Use deterministic random for wander duration in multiplayer
        const deterministicRandom = getUnitDeterministicRandom(unit, 'wander_duration');
        
        super(unit, {
            wanderArea: { x: 8, z: 8 }, // 8x8 unit area around spawn point
            wanderDuration: 8000 + deterministicRandom * 4000, // 8-12 seconds (deterministic)
            microMoveChance: 0.3, // 30% chance per second
            wanderSpeed: (unit.speed || 20) * 1.5, // 150% of unit's base speed for wandering (increased from 30%)
            ...params
        });
        
        // Safety check for physics body
        if (!unit.pb || !unit.pb.state || !unit.pb.state.loc) {
            console.error(`❌ ${unit.name || unit.type} missing physics body for wander behavior`);
            return;
        }
        
        this.startTick = window.currentMatch?.tick || 0;
        this.startTime = window.currentMatch ? null : Date.now(); // Use time in menu scene
        this.currentDirection = this.getRandomDirection();
        this.wanderTimeTicks = 0;
        this.lastDirectionChangeFrame = window.frameCounter || 0;
        this.spawnPoint = { 
            x: unit.pb.state.loc.x, 
            y: unit.pb.state.loc.y, 
            z: unit.pb.state.loc.z 
        }; // Remember where unit started
        
        // console.log(`🌍 ${unit.name || unit.type} wander behavior created at (${this.spawnPoint.x.toFixed(1)}, ${this.spawnPoint.z.toFixed(1)})`);
    }
    
    step() {
        const hasMatch = !!window.currentMatch;
        let elapsed;
        const currentTick = hasMatch ? window.currentMatch.tick : 0; // Define currentTick outside if block
        
        if (hasMatch) {
            // Use tick-based timing in matches (deterministic)
            const elapsedTicks = currentTick - this.startTick;
            elapsed = elapsedTicks * 50; // Convert to ms
        } else {
            // Use time-based timing in menu scene
            elapsed = Date.now() - this.startTime;
        }
        
        // Complete after duration
        if (elapsed > this.params.wanderDuration) {
            // console.log(`🌍 ${this.unit.name || this.unit.type} finished wandering`);
            // Track when this unit finished wandering (use ticks in multiplayer)
            if (hasMatch) {
                this.unit.lastWanderTick = currentTick;
            }
            return true;
        }
        
        // Change direction periodically
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        let shouldChangeDirection = false;
        
        if (hasMatch) {
            // Deterministic direction changes based on ticks
            // currentTick already defined above
            const ticksSinceDirectionChange = currentTick - this.wanderTimeTicks;
            const directionChangeInterval = 60 + ((currentTick + unitIdHash) % 40); // 60-100 ticks (3-5 seconds)
            shouldChangeDirection = ticksSinceDirectionChange > directionChangeInterval;
            if (shouldChangeDirection) {
                this.wanderTimeTicks = currentTick;
            }
        } else {
            // Time-based direction changes in menu scene (every 3-5 seconds)
            const framesSinceChange = (window.frameCounter || 0) - this.lastDirectionChangeFrame;
            // Use unit ID hash for variety (add 1 to avoid 0 which would give same interval for all)
            const directionChangeIntervalFrames = 180 + ((unitIdHash + 1) % 120); // 180-300 frames (3-5 seconds at 60fps)
            shouldChangeDirection = framesSinceChange > directionChangeIntervalFrames;
            if (shouldChangeDirection) {
                this.lastDirectionChangeFrame = window.frameCounter || 0;
            }
        }
        
        if (shouldChangeDirection) {
            this.currentDirection = this.getRandomDirection();
            // console.log(`🌍 ${this.unit.name || this.unit.type} changed wander direction to (${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)})`);
        }
        
        // Apply movement in current direction
        this.applyWanderMovement();
        
        // Occasional micro-movements
        if (hasMatch) {
            // Deterministic micro-movements in matches
            const currentTick = window.currentMatch.tick;
            const microMoveThreshold = this.params.microMoveChance * 0.016 * 1000; // Scale to 0-1000
            if (((currentTick + unitIdHash) % 1000) < microMoveThreshold) {
                this.applyMicroMovement();
            }
        } else {
            // Deterministic micro-movements in menu scene (use frame counter + unit hash)
            const frame = window.frameCounter || 0;
            const microMoveThreshold = this.params.microMoveChance * 16; // Scale to 0-1000 range
            if (((frame + unitIdHash) % 1000) < microMoveThreshold) {
                this.applyMicroMovement();
            }
        }
        
        // Debug: log wander status (disabled for performance)
        // console.log(`🌍 ${this.unit.name || this.unit.type} wandering: elapsed=${(elapsed/1000).toFixed(1)}s, direction=(${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)})`);
        
        return false;
    }
    
    getRandomDirection() {
        // Use deterministic angle based on tick and unit ID (or random in menu scene)
        const hasMatch = !!window.currentMatch;
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        let angle;
        
        if (hasMatch) {
            const currentTick = window.currentMatch.tick;
            angle = ((currentTick + unitIdHash) % 628) / 100; // 0 to 2π (6.28)
        } else {
            // Use frame counter + unit hash for pseudo-random but changing direction in menu scene
            const frame = window.frameCounter || 0;
            angle = ((frame * 0.1 + unitIdHash) % 628) / 100; // Slowly changing angle
        }
        
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
        // CRITICAL: Use the wanderSpeed from params (which is properly set for monks)
        // The applyMovementWithRotation function uses the second parameter as impulseStrength,
        // but we need to scale it properly for the actual speed
        const effectiveSpeed = this.params.wanderSpeed || (this.unit.speed || 20) * 0.5;
        this.applyMovementWithRotation(this.currentDirection, effectiveSpeed);
        
        // Debug logging for wander movement (disabled for performance)
        // console.log(`🌍 ${this.unit.name || this.unit.type} wandering: dir(${this.currentDirection.x.toFixed(2)}, ${this.currentDirection.z.toFixed(2)}), pos(${this.unit.pb.state.loc.x.toFixed(1)}, ${this.unit.pb.state.loc.z.toFixed(1)}), speed=${effectiveSpeed.toFixed(1)}`);
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


// Helper to find player by unit owner ID (handles ID normalization)
function findPlayerByUnitOwner(ownerId) {
    if (!ownerId) return null;
    
    // Try exact match first
    if (window.player && window.player.id === ownerId) return window.player;
    
    // Try normalized match (last 6 chars)
    const normalizeId = (id) => id?.length > 6 ? id.slice(-6) : id;
    const normalizedOwnerId = normalizeId(ownerId);
    
    if (window.player && normalizeId(window.player.id) === normalizedOwnerId) {
        return window.player;
    }
    
    // Check match players (includes AI opponents)
    if (window.currentMatch && window.currentMatch.players) {
        const owner = window.currentMatch.players.find(p => {
            const playerId = p.id || p;
            return normalizeId(playerId) === normalizedOwnerId;
        });
        return owner;
    }
    
    return null;
}

// Behavior manager for units
class UnitBehaviorManager {
    constructor() {
        this.behaviors = new Map(); // unit -> current behavior
    }
    
    // Set a unit's active behavior
    setBehavior(unit, behaviorType, params = {}) {
        // Handle special-ability cooldowns (tick-based)
        const currentTick = window.currentMatch?.tick || 0;
        unit._abilityCooldowns = unit._abilityCooldowns || {};
        
        // Special abilities are modifiers - they don't replace existing behaviors
        const specialAbilities = ['brigand_sprint', 'monk_stealth', 'monk_kick', 'wizard_cast', 'engineer_productivity_boost'];
        const isSpecialAbility = specialAbilities.includes(behaviorType);
        
        if (isSpecialAbility) {
            const nextReadyTick = unit._abilityCooldowns[behaviorType] || 0;
            if (currentTick < nextReadyTick) {
                // On cooldown, ignore
                return;
            }
            // For special abilities, add them as modifiers instead of replacing behavior
            this.addSpecialAbilityModifier(unit, behaviorType, params);
            return;
        }
        
        // Special abilities are now modifiers that don't prevent movement commands
        // They enhance existing behaviors rather than replacing them
        
        // If unit has an existing behavior, call onReassignment if it exists
        const currentBehavior = this.behaviors.get(unit);
        if (currentBehavior && currentBehavior.onReassignment) {
            currentBehavior.onReassignment();
        }
        
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
            case 'work':
                if (params.building) {
                    behavior = new WorkBehavior(unit, params.building, params);
                }
                break;
            case 'gather_work':
                if (params.building) {
                    behavior = new GatherWorkBehavior(unit, params.building, params);
                }
                break;
            case 'farm_work':
                if (params.building) {
                    behavior = new FarmWorkBehavior(unit, params.building, params);
                }
                break;
            case 'build_work':
                if (params.building) {
                    behavior = new BuildWorkBehavior(unit, params.building, params);
                }
                break;
            case 'attack_building':
                if (params.building) {
                    behavior = new AttackBuildingBehavior(unit, params.building, params);
                }
                break;
            case 'engineer_work':
                if (params.building) {
                    behavior = new EngineerWorkBehavior(unit, params.building, params);
                }
                break;
            case 'eat':
                behavior = new EatBehavior(unit, params);
                break;
            case 'transform':
                behavior = new TransformBehavior(unit, params);
                break;
            default:
                console.warn(`Unknown behavior type: ${behaviorType}`);
                return;
        }
        
        if (behavior) {
            // CRITICAL: Smart transition - check if unit is already moving in similar direction
            // If so, smoothly update target instead of resetting velocity (prevents jerky movement)
            const wasMovingBehavior = currentBehavior && 
                (currentBehavior instanceof WalkBehavior || currentBehavior instanceof RunBehavior);
            const isNewMovingBehavior = behavior instanceof WalkBehavior || behavior instanceof RunBehavior;
            
            if (wasMovingBehavior && isNewMovingBehavior && unit.pb && unit.pb.state) {
                // Unit is already moving - check if new target is similar direction
                const currentVelX = unit.pb.state.vel.x || 0;
                const currentVelZ = unit.pb.state.vel.z || 0;
                const currentSpeed = Math.sqrt(currentVelX * currentVelX + currentVelZ * currentVelZ);
                
                if (currentSpeed > 0.1 && params.targetPoint) {
                    // Unit is moving - calculate direction to new target
                    const currentPos = unit.pb.state.loc;
                    const dx = params.targetPoint.x - currentPos.x;
                    const dz = params.targetPoint.z - currentPos.z;
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    
                    if (distance > 0.1) {
                        // Normalize new direction
                        const newDirX = dx / distance;
                        const newDirZ = dz / distance;
                        
                        // Normalize current velocity direction
                        const currentDirX = currentVelX / currentSpeed;
                        const currentDirZ = currentVelZ / currentSpeed;
                        
                        // Calculate dot product to check if directions are similar
                        const dotProduct = currentDirX * newDirX + currentDirZ * newDirZ;
                        
                        // If directions are similar (dot product > 0.7, ~45 degrees), smooth transition
                        // Don't reset velocity - let the new behavior smoothly adjust direction
                        if (dotProduct > 0.7) {
                            // Similar direction - just update target, keep velocity for smooth transition
                            this.behaviors.set(unit, behavior);
                            return; // Skip velocity reset - smooth transition
                        }
                    }
                }
            }
            
            // CRITICAL: Immediately replace old behavior with new one
            // This ensures player commands override any existing behavior instantly
            this.behaviors.set(unit, behavior);
            
            // CRITICAL: Only reset velocity if unit is stopped or changing direction significantly
            // This prevents jerky movement when unit is already moving in similar direction
            if ((behaviorType === 'walk' || behaviorType === 'run') && unit.pb && unit.pb.state) {
                if (!unit.pb.state.vel) unit.pb.state.vel = { x: 0, y: 0, z: 0 };
                const currentSpeed = Math.sqrt(
                    (unit.pb.state.vel.x || 0) ** 2 + (unit.pb.state.vel.z || 0) ** 2
                );
                
                // Only reset velocity if unit is stopped or very slow
                // If unit is already moving, let the new behavior smoothly adjust direction
                if (currentSpeed < 0.1) {
                    // Unit is stopped - clear velocity so behavior can set it fresh
                    unit.pb.state.vel.x = 0;
                    unit.pb.state.vel.z = 0;
                }
                // Otherwise, keep current velocity and let behavior smoothly adjust direction
            }
            
            // console.log(`🎯 Set ${unit.name || unit.type} behavior to: ${behaviorType}, total behaviors: ${this.behaviors.size}`);
        } else {
            // console.warn(`⚠️ Failed to create behavior for ${unit.name || unit.type}, type: ${behaviorType}`);
        }
    }
    
    // Step all unit behaviors (called every physics tick)
    stepBehaviors() {
        this.stepBehaviorsFiltered(() => true); // Step all behaviors
    }
    
    // Step behaviors with filter (for multiplayer - skip remote units)
    stepBehaviorsFiltered(filterFn) {
        if (this.behaviors.size === 0) {
            // console.log('🔥🔥🔥 No behaviors to step');
            return;
        }
        
        // Debug: log behavior count occasionally (disabled for performance)
        // if (Math.random() < 0.01) { // 1% chance to log
        //     // console.log(`🎯 Stepping ${this.behaviors.size} behaviors`);
        // }
        
        // CRITICAL: Sort behaviors by unit ID for deterministic iteration order in multiplayer
        // This ensures both clients process behaviors in the same order, preventing position drift
        const behaviorEntries = Array.from(this.behaviors.entries());
        if (window.isMultiplayer) {
            behaviorEntries.sort((a, b) => {
                const unitA = a[1]?.unit || a[0];
                const unitB = b[1]?.unit || b[0];
                const idA = unitA?.id || '';
                const idB = unitB?.id || '';
                return idA.localeCompare(idB);
            });
        }
        
        behaviorEntries.forEach(([unit, behavior]) => {
            // Skip if filter returns false (e.g., remote player units in multiplayer)
            if (!filterFn(unit)) {
                return;
            }
            
            // Skip behavior updates for neutral units that are far away (use squared distance)
            if (unit.owner === 'neutral' && unit.distanceToCameraSquared > 90000) { // 300^2
                return; // Skip behavior stepping for distant neutral units
            }
            
            if (behavior) {
                const completed = behavior.step();
                if (completed) {
                    this.behaviors.delete(unit);
                    
                    // After movement completes, give units a subtle idle/linger behavior to spread out
                    // Only apply to player/AI units that just finished moving (not working/gathering)
                    const isPlayerUnit = unit.owner !== 'neutral';
                    const wasMoving = behavior instanceof WalkBehavior || behavior instanceof RunBehavior;
                    
                    if (isPlayerUnit && wasMoving && unit.pb && unit.pb.state) {
                        // Form up units after arrival instead of random wandering
                        // This looks much cleaner and more military
                        const formationPos = getFormationPosition(unit);
                        
                        if (formationPos) {
                            // Check if we're already at formation position
                            const dx = formationPos.x - unit.pb.state.loc.x;
                            const dz = formationPos.z - unit.pb.state.loc.z;
                            const distToFormation = Math.sqrt(dx * dx + dz * dz);
                            
                            if (distToFormation > 1.0) {
                                // Move to formation position
                                this.setBehavior(unit, 'walk', {
                                    targetPoint: formationPos,
                                    arrivalRadius: 0.8
                                });
                            } else {
                                // Already at formation - just linger in place
                                this.setBehavior(unit, 'linger', { 
                                    center: { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z }, 
                                    radius: 50,  // Can roam freely
                                    wanderDistance: 2.0,
                                    wanderInterval: 30000  // Match idle villager pace
                                });
                            }
                        } else {
                            // Solo unit - just linger in place
                            const arrivalPoint = { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z };
                            this.setBehavior(unit, 'linger', { 
                                center: arrivalPoint, 
                                radius: 50,  // Can roam freely
                                wanderDistance: 2.0,
                                wanderInterval: 30000  // Match idle villager pace
                            });
                        }
                    }
                }
            }
            
            // Step special ability modifiers
            if (unit._specialModifiers) {
                Object.keys(unit._specialModifiers).forEach(modifierType => {
                    const modifier = unit._specialModifiers[modifierType];
                    if (modifier && modifier.step()) {
                        // Modifier completed, remove it
                        delete unit._specialModifiers[modifierType];
                        if (modifier.onReassignment) {
                            modifier.onReassignment();
                        }
                    }
                });
            }
        });
    }
    
    // Get a unit's current behavior
    getBehavior(unit) {
        const behavior = this.behaviors.get(unit);
        // Debug: log behavior queries (disabled for performance)
        // console.log(`🎯 ${unit.name || unit.type} behavior query: ${behavior ? behavior.constructor.name : 'none'}`);
        return behavior;
    }
    
    // Clear a unit's behavior (fall back to linger)
    clearBehavior(unit) {
        this.behaviors.delete(unit);
        this.setBehavior(unit, 'linger');
    }
    
    // Add a special ability as a modifier (doesn't replace existing behavior)
    addSpecialAbilityModifier(unit, abilityType, params = {}) {
        // Store the modifier on the unit
        unit._specialModifiers = unit._specialModifiers || {};
        
        // Create the modifier behavior
        let modifier;
        switch (abilityType) {
            case 'brigand_sprint':
                modifier = new BrigandSprintBehavior(unit, params);
                break;
            case 'monk_stealth':
                modifier = new MonkStealthBehavior(unit, params);
                break;
            case 'monk_kick':
                modifier = new MonkKickBehavior(unit, params);
                break;
            case 'wizard_cast':
                modifier = new WizardCastBehavior(unit, params);
                break;
            case 'engineer_productivity_boost':
                modifier = new EngineerProductivityBoostBehavior(unit, params);
                break;
        }
        
        if (modifier) {
            unit._specialModifiers[abilityType] = modifier;
            // Set cooldown (tick-based)
            const currentTick = window.currentMatch?.tick || 0;
            const abilityCooldownTicks = {
                'wizard_cast': 60,      // 3000ms / 50ms = 60 ticks
                'monk_stealth': 160,    // 8000ms / 50ms = 160 ticks
                'monk_kick': 40,        // 2000ms / 50ms = 40 ticks (kick as often as possible)
                'brigand_sprint': 120,  // 6000ms / 50ms = 120 ticks
                'engineer_productivity_boost': 100  // 5000ms / 50ms = 100 ticks
            };
            unit._abilityCooldowns[abilityType] = currentTick + abilityCooldownTicks[abilityType];
        }
    }
    
}

// Minimal special behaviors
class BrigandSprintBehavior {
    constructor(unit, params = {}) {
        this.unit = unit;
        this.params = params;
        // DETERMINISTIC: Use tick-based timing
        const currentTick = window.currentMatch?.tick || 0;
        this.startTick = currentTick;
        this.durationTicks = (params.duration || 6000) / 50; // Convert ms to ticks
        this.mult = params.speedMultiplier || 2.0;
        // Store and use a consistent base speed so repeated sprints don't drift
        if (typeof unit._baseSpeed === 'undefined') {
            unit._baseSpeed = unit.speed || 4;
        }
        this.baseSpeed = unit._baseSpeed;
        unit.speed = this.baseSpeed * this.mult;
    }
    
    step() {
        // Just check if sprint duration is over - let normal movement behaviors handle movement
        const currentTick = window.currentMatch?.tick || 0;
        if ((currentTick - this.startTick) > this.durationTicks) {
            this.unit.speed = this.baseSpeed;
            return true;
        }
        return false;
    }
    
    onReassignment() {
        // Ensure speed is restored if this behavior is interrupted/replaced
        this.unit.speed = this.baseSpeed;
    }
}

class MonkStealthBehavior {
    constructor(unit, params = {}) {
        this.unit = unit;
        this.params = params;
        // DETERMINISTIC: Use tick-based timing
        const currentTick = window.currentMatch?.tick || 0;
        this.startTick = currentTick;
        this.durationTicks = (params.duration || 4000) / 50; // Convert ms to ticks
        // Apply stealth flag and simple visual hint if available
        unit.isStealthed = true;
        if (unit.mesh) {
            unit._origAlpha = unit.mesh.visibility !== undefined ? unit.mesh.visibility : 1;
            unit.mesh.visibility = 0.4;
        }
    }
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        if ((currentTick - this.startTick) > this.durationTicks) {
            this.unit.isStealthed = false;
            if (this.unit.mesh && this.unit._origAlpha !== undefined) {
                this.unit.mesh.visibility = this.unit._origAlpha;
            }
            return true;
        }
        return false;
    }
    onReassignment() {
        // Restore immediately if interrupted
        this.unit.isStealthed = false;
        if (this.unit.mesh && this.unit._origAlpha !== undefined) {
            this.unit.mesh.visibility = this.unit._origAlpha;
        }
    }
}

// Monk kick: radial knock-back around the monk using existing PBody physics.
class MonkKickBehavior {
    constructor(unit, params = {}) {
        this.unit = unit;
        this.params = params;
        this.executed = false;
    }
    step() {
        if (this.executed) {
            return true;
        }
        this.executed = true;

        const radius = this.params.radius || 4;
        const basePower = this.params.power || 160;

        if (!this.unit.pb || !this.unit.pb.state || !this.unit.pb.state.loc) {
            return true;
        }

        const origin = this.unit.pb.state.loc.clone();
        let kickedAny = false;

        if (Array.isArray(window.gameUnits)) {
            window.gameUnits.forEach(other => {
                if (!other || other === this.unit) return;
                if (!other.pb || !other.pb.state || !other.pb.state.loc || !other.pb.imp) return;
                if (other.owner === this.unit.owner) return; // don't kick allies

                const pos = other.pb.state.loc.clone();
                const dx = pos.x - origin.x;
                const dz = pos.z - origin.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist <= 0 || dist > radius) return;

                const dir = new BABYLON.Vector3(dx / dist, 0, dz / dist);
                // Linear falloff so close targets get hit harder
                const strength = basePower * (1 - dist / radius);
                other.pb.imp.addInPlace(dir.scale(strength));
                
                // Add fake vertical arc animation to kicked unit
                // CRITICAL: Use tick-based timing for deterministic animation
                if (!other._monkKickArc) {
                    const currentTick = window.currentMatch?.tick || 0;
                    const tickRate = 20; // Match net.TICK_RATE
                    other._monkKickArc = {
                        startTick: currentTick,
                        durationTicks: Math.floor(400 / 1000 * tickRate), // 400ms → ticks (8 ticks at 20Hz)
                        peakHeight: 2.0, // Peak height of arc
                        startY: other.pb.state.loc.y || 0
                    };
                }
                
                kickedAny = true;
            });
        }

        // Create sparkle effect at monk position when kicking
        if (kickedAny && window.fx && window.fx.createParticleEffect) {
            try {
                const p = this.unit.mesh ? this.unit.mesh.position.clone() : origin.clone();
                // Create sparkle effect (bright particles)
                window.fx.createParticleEffect('particle', p, {
                    scale: 0.4,
                    emitRate: 40,
                    minSize: 0.2,
                    maxSize: 0.4
                });
            } catch (e) {
                // Visual only, ignore errors
            }
        }

        return true; // one-shot ability
    }
    onReassignment() {
        this.executed = true;
    }
}

class WizardCastBehavior {
    constructor(unit, params = {}) {
        this.unit = unit;
        this.params = params;
        // DETERMINISTIC: Use tick-based timing
        const currentTick = window.currentMatch?.tick || 0;
        this.startTick = currentTick;
        this.durationTicks = 40; // 2000ms / 50ms = 40 ticks
        // Optional: spawn simple VFX at target or unit position if available
        if (window.fx && window.fx.createExplosion) {
            const p = params.targetPoint ? new BABYLON.Vector3(params.targetPoint.x, 0, params.targetPoint.z) : (unit.mesh ? unit.mesh.position.clone() : new BABYLON.Vector3(0,0,0));
            try { 
                window.fx.createExplosion(p, 0.2);
            } catch (e) {
                console.error('Explosion creation failed:', e);
            }
        }
    }
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        return (currentTick - this.startTick) > this.durationTicks;
    }
}

class EngineerProductivityBoostBehavior {
    constructor(unit, params = {}) {
        this.unit = unit;
        this.params = params;
        // DETERMINISTIC: Use tick-based timing
        const currentTick = window.currentMatch?.tick || 0;
        this.startTick = currentTick;
        this.durationTicks = (params.duration || 7000) / 50; // Convert ms to ticks
        this.radius = params.radius || 6;
        this.bonus = params.bonus || 1.5;
    }
    
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        if ((currentTick - this.startTick) > this.durationTicks) {
            return true;
        }
        return false;
    }
}

// Global behavior manager instance
const behaviorManager = new UnitBehaviorManager();

// EatBehavior - Villagers occasionally need to eat
class TransformBehavior extends Behavior {
    constructor(unit, params = {}) {
        super(unit, {
            transformDuration: 3000, // Takes 3 seconds to transform (3000ms = 60 ticks at 20Hz)
            transformType: null, // What to transform into
            revertDelay: 60000, // Brigands revert after 60 seconds of inactivity
            ...params
        });
        
        // CRITICAL: TransformBehavior should NOT be used in multiplayer!
        // In multiplayer, use the 'convert' command system instead
        if (window.isMultiplayer) {
            console.error('❌ TransformBehavior should not be used in multiplayer! Use convert command instead.');
            this.disabled = true;
            return;
        }
        
        // CRITICAL: Use tick-based timing instead of Date.now() for determinism
        const currentTick = window.currentMatch?.tick || 0;
        this.startTick = currentTick;
        this.transformIndicator = null;
        this.hasTransformed = false;
        
        // Store previous behavior to resume after transforming
        this.previousBehavior = window.behaviorManager.getBehavior(unit);
        if (this.previousBehavior) {
            window.behaviorManager.behaviors.delete(unit);
        }
        
        // Create visual indicator for transforming
        this.createTransformIndicator();
    }
    
    step() {
        // Skip if disabled (e.g., in multiplayer)
        if (this.disabled) {
            return true; // Complete immediately
        }
        
        // DETERMINISTIC: Use tick-based timing
        const currentTick = window.currentMatch?.tick || 0;
        const ticksElapsed = currentTick - this.startTick;
        const msElapsed = ticksElapsed * 50; // Convert ticks to ms (20Hz = 50ms per tick)
        
        // If we haven't transformed yet and enough time has passed, transform the unit
        if (!this.hasTransformed && msElapsed > this.params.transformDuration) {
            this.transformUnit();
        }
        
        // Keep behavior active for brigands to track inactivity
        if (this.params.transformType === 'brigand' && this.hasTransformed) {
            // Check if brigand has been inactive (use tick-based timing)
            const ticksSinceLastMove = currentTick - (this.unit.lastMoveTick || 0);
            const msSinceLastMove = ticksSinceLastMove * 50;
            if (msSinceLastMove > this.params.revertDelay) {
                // Revert back to villager
                this.revertToVillager();
                return true; // Complete the behavior
            }
            return false; // Keep monitoring brigand activity
        }
        
        // For other transformations, complete after transforming
        if (this.hasTransformed) {
            this.removeTransformIndicator();
            return true;
        }
        
        return false;
    }
    
    transformUnit() {
        if (!this.params.transformType) return;
        
        // Store original position and physics state
        const originalPos = this.unit.pb.state.loc.clone();
        const originalRot = this.unit.pb.state.rot.clone();
        
        // Store owner and other important properties
        const owner = this.unit.owner;
        
        // CRITICAL: Pass owner in constructor options
        const newUnit = new Unit(this.params.transformType, {
            x: originalPos.x,
            y: originalPos.y,
            z: originalPos.z
        }, { owner: owner });
        
        // Copy over rotation
        newUnit.pb.state.rot.copyFrom(originalRot);
        
        // Add to appropriate unit arrays
        if (owner === window.player?.id && window.player) {
            // Remove old unit from player's array
            const index = window.player.units.indexOf(this.unit);
            if (index > -1) {
                window.player.units.splice(index, 1);
            }
            window.player.units.push(newUnit);
        }
        
        // Remove old unit from game units
        const gameIndex = window.gameUnits.indexOf(this.unit);
        if (gameIndex > -1) {
            window.gameUnits.splice(gameIndex, 1);
        }
        window.gameUnits.push(newUnit);
        
        // Clean up old unit's mesh and selection indicator
        if (this.unit.mesh) {
            // Dispose of selection indicator first
            if (this.unit.selectionIndicator) {
                this.unit.selectionIndicator.dispose();
                this.unit.selectionIndicator = null;
            }
            
            // Dispose of the mesh
            this.unit.mesh.dispose();
            this.unit.mesh = null;
        }
        
        // Spawn visual model for new unit immediately
        if (window.gfx && window.gfx.scene && window.gfx.getModel) {
            window.gfx.getModel(newUnit.model, window.gfx.scene).then(model => {
                newUnit.mesh = model.root;
                newUnit.mesh.scaling = new BABYLON.Vector3(newUnit.scale, newUnit.scale, newUnit.scale);
                
                // Make unit mesh pickable for selection
                newUnit.mesh.isPickable = true;
                
                // Handle child meshes
                newUnit.mesh.getChildMeshes().forEach(mesh => {
                    mesh.isPickable = true;
                    
                    if (mesh.rotationQuaternion) {
                        const quaternion = mesh.rotationQuaternion.clone();
                        mesh.rotationQuaternion = null;
                        mesh.originalRotation = quaternion.toEulerAngles();
                        mesh.rotation.copyFrom(mesh.originalRotation);
                    }
                });
                
                // Create selection indicator
                if (window.createSelectionIndicator) {
                    window.createSelectionIndicator(newUnit);
                }
                
                // Set position and rotation
                if (newUnit.pb && newUnit.pb.state && newUnit.pb.state.loc) {
                    newUnit.mesh.position.x = newUnit.pb.state.loc.x;
                    newUnit.mesh.position.y = newUnit.pb.state.loc.y;
                    newUnit.mesh.position.z = newUnit.pb.state.loc.z;
                }
                
                if (newUnit.pb && newUnit.pb.state && newUnit.pb.state.rot) {
                    newUnit.mesh.rotationQuaternion = null;
                    newUnit.mesh.rotation.y = newUnit.pb.state.rot.y;
                }
                
                // Apply team colors to the transformed unit
                if (window.applyTeamColorsToMesh) {
                    const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(newUnit.owner) : '#4A90E2';
                    window.applyTeamColorsToMesh(newUnit.mesh, teamColor);
                }
            }).catch(error => {
                console.warn('Failed to load transformed unit model:', error);
            });
        }
        
        // Update unit reference
        this.unit = newUnit;
        this.hasTransformed = true;
        
        // For brigands, initialize activity tracking (use tick-based time)
        if (this.params.transformType === 'brigand' && window.currentMatch && window.currentMatch.tick) {
            this.unit.lastMoveTick = window.currentMatch.tick;
        }
    }
    
    revertToVillager() {
        // Similar to transform but always goes back to villager
        const originalPos = this.unit.pb.state.loc.clone();
        const originalRot = this.unit.pb.state.rot.clone();
        const owner = this.unit.owner;
        
        // Create new villager
        const newVillager = new Unit('villager', {
            x: originalPos.x,
            y: originalPos.y,
            z: originalPos.z
        });
        
        // Copy over important properties
        newVillager.owner = owner;
        newVillager.pb.state.rot.copyFrom(originalRot);
        
        // Update unit arrays
        if (owner === window.player?.id && window.player) {
            const index = window.player.units.indexOf(this.unit);
            if (index > -1) {
                window.player.units.splice(index, 1);
            }
            window.player.units.push(newVillager);
        }
        
        const gameIndex = window.gameUnits.indexOf(this.unit);
        if (gameIndex > -1) {
            window.gameUnits.splice(gameIndex, 1);
        }
        window.gameUnits.push(newVillager);
        
        // Clean up old unit's mesh and selection indicator
        if (this.unit.mesh) {
            // Dispose of selection indicator first
            if (this.unit.selectionIndicator) {
                this.unit.selectionIndicator.dispose();
                this.unit.selectionIndicator = null;
            }
            
            // Dispose of the mesh
            this.unit.mesh.dispose();
            this.unit.mesh = null;
        }
        
        // Spawn visual model for new villager immediately
        if (window.gfx && window.gfx.scene && window.gfx.getModel) {
            window.gfx.getModel(newVillager.model, window.gfx.scene).then(model => {
                newVillager.mesh = model.root;
                newVillager.mesh.scaling = new BABYLON.Vector3(newVillager.scale, newVillager.scale, newVillager.scale);
                
                // Make unit mesh pickable for selection
                newVillager.mesh.isPickable = true;
                
                // Handle child meshes
                newVillager.mesh.getChildMeshes().forEach(mesh => {
                    mesh.isPickable = true;
                    
                    if (mesh.rotationQuaternion) {
                        const quaternion = mesh.rotationQuaternion.clone();
                        mesh.rotationQuaternion = null;
                        mesh.originalRotation = quaternion.toEulerAngles();
                        mesh.rotation.copyFrom(mesh.originalRotation);
                    }
                });
                
                // Create selection indicator
                if (window.createSelectionIndicator) {
                    window.createSelectionIndicator(newVillager);
                }
                
                // Set position and rotation
                if (newVillager.pb && newVillager.pb.state && newVillager.pb.state.loc) {
                    newVillager.mesh.position.x = newVillager.pb.state.loc.x;
                    newVillager.mesh.position.y = newVillager.pb.state.loc.y;
                    newVillager.mesh.position.z = newVillager.pb.state.loc.z;
                }
                
                if (newVillager.pb && newVillager.pb.state && newVillager.pb.state.rot) {
                    newVillager.mesh.rotationQuaternion = null;
                    newVillager.mesh.rotation.y = newVillager.pb.state.rot.y;
                }
                
                // Apply team colors to the reverted villager
                if (window.applyTeamColorsToMesh) {
                    const teamColor = window.getTeamColorForOwner ? window.getTeamColorForOwner(newVillager.owner) : '#4A90E2';
                    window.applyTeamColorsToMesh(newVillager.mesh, teamColor);
                }
            }).catch(error => {
                console.warn('Failed to load reverted villager model:', error);
            });
        }
    }
    
    createTransformIndicator() {
        if (!this.unit.mesh || this.transformIndicator) return;
        
        // Create a simple floating icon above the unit
        const indicator = BABYLON.MeshBuilder.CreateSphere("transformIndicator", {
            diameter: 0.3
        }, window.gfx.scene);
        
        // Position above the unit (higher than resource indicators)
        indicator.position = new BABYLON.Vector3(0, 3.0, 0);
        indicator.parent = this.unit.mesh;
        
        // Color based on transform type
        const material = new BABYLON.StandardMaterial("transformIndicatorMaterial", window.gfx.scene);
        switch (this.params.transformType) {
            case 'monk':
                material.diffuseColor = new BABYLON.Color3(1, 1, 0.5); // Gold for monk
                material.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.2);
                break;
            case 'engineer':
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 1); // Blue for engineer
                material.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.5);
                break;
            case 'brigand':
                material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2); // Red for brigand
                material.emissiveColor = new BABYLON.Color3(0.4, 0.1, 0.1);
                break;
            default:
                material.diffuseColor = new BABYLON.Color3(1, 1, 1);
                material.emissiveColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        }
        material.alpha = 0.9;
        indicator.material = material;
        
        // Add a subtle glow effect
        indicator.renderingGroupId = 1;
        
        this.transformIndicator = indicator;
    }
    
    removeTransformIndicator() {
        if (this.transformIndicator) {
            this.transformIndicator.dispose();
            this.transformIndicator = null;
        }
    }
    
    onReassignment() {
        this.removeTransformIndicator();
    }
}

class EatBehavior extends Behavior {
    constructor(unit, params = {}) {
        super(unit, {
            eatingDuration: 5000, // Takes 5 seconds to eat
            foodCost: 1, // How much food is consumed
            ...params
        });
        
        // CRITICAL: Use tick-based timing for deterministic eating
        this.startTick = window.currentMatch?.tick || 0;
        this.foodIndicator = null;
        this.hasEaten = false;
        
        // Store previous behavior to resume after eating
        this.previousBehavior = window.behaviorManager.getBehavior(unit);
        if (this.previousBehavior) {
            window.behaviorManager.behaviors.delete(unit);
        }
        
        // Create visual indicator for eating
        this.createFoodIndicator();
    }
    
    // Called when behavior is forcibly changed
    onReassignment() {
        this.removeFoodIndicator();
    }
    
    step() {
        // CRITICAL: Use tick-based timing for deterministic eating
        const currentTick = window.currentMatch?.tick || 0;
        const elapsedTicks = currentTick - this.startTick;
        const oneSecondInTicks = 60; // 60 ticks at 60Hz = 1 second
        
        // If we haven't eaten yet and have been "eating" for a second, consume the food
        if (!this.hasEaten && elapsedTicks > oneSecondInTicks) {
            this.consumeFood();
        }
        
        // Finish eating after duration (convert ms to ticks: 5000ms / 50ms per tick = 100 ticks)
        const durationInTicks = Math.floor(this.params.eatingDuration / 50);
        if (elapsedTicks > durationInTicks) {
            this.removeFoodIndicator();
            
            // Resume previous behavior if it exists
            if (this.previousBehavior) {
                window.behaviorManager.behaviors.set(this.unit, this.previousBehavior);
            }
            
            return true; // Behavior complete
        }
        
        return false; // Keep eating
    }
    
    consumeFood() {
        if (window.player && window.player.removeResource) {
            if (window.player.removeResource('food', this.params.foodCost)) {
                this.hasEaten = true;
                // console.log(`🍎 ${this.unit.name || this.unit.type} ate ${this.params.foodCost} food`);
            } else {
                // No food available! Time to leave
                console.log("😢 No food! Villager is leaving...");
                
                // Clean up any work assignments
                if (this.unit.assignedBuilding) {
                    const building = this.unit.assignedBuilding;
                    building.assignedWorkers = building.assignedWorkers.filter(w => w !== this.unit);
                    this.unit.assignedBuilding = null;
                }
                
                // Pick a deterministic direction far away based on unit ID
                const deterministicRandom = getUnitDeterministicRandom(this.unit, 'walkaway_direction');
                const angle = deterministicRandom * Math.PI * 2;
                const distance = 50 * TILE_SIZE; // Walk really far!
                const targetX = this.unit.pb.state.loc.x + Math.cos(angle) * distance;
                const targetZ = this.unit.pb.state.loc.z + Math.sin(angle) * distance;
                
                // Start walking away sadly
                window.behaviorManager.setBehavior(this.unit, 'walk', {
                    targetPoint: { x: targetX, z: targetZ },
                    walkSpeed: 0.5 // Walk slowly, dejectedly
                });
                
                // Remove from player's units and game units
                if (window.player) {
                    window.player.units = window.player.units.filter(u => u !== this.unit);
                }
                window.gameUnits = window.gameUnits.filter(u => u !== this.unit);
                
                // Clean up the unit's mesh
                if (this.unit.mesh) {
                    this.unit.mesh.dispose();
                }
                
                // Clean up food indicator
                this.removeFoodIndicator();
                return true;
            }
        }
    }
    
    createFoodIndicator() {
        if (!this.unit.mesh || this.foodIndicator) return;
        
        // Create a simple floating icon above the unit
        const indicator = BABYLON.MeshBuilder.CreateSphere("foodIndicator", {
            diameter: 0.3
        }, window.gfx.scene);
        
        // Position above the unit (higher than resource indicators)
        indicator.position = new BABYLON.Vector3(0, 3.0, 0);
        indicator.parent = this.unit.mesh;
        
        // Food color (red/brown apple-like color)
        const material = new BABYLON.StandardMaterial("foodIndicatorMaterial", window.gfx.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.1);
        material.emissiveColor = new BABYLON.Color3(0.2, 0.05, 0.02);
        material.alpha = 0.9;
        indicator.material = material;
        
        // Add a subtle glow effect
        indicator.renderingGroupId = 1;
        
        this.foodIndicator = indicator;
    }
    
    removeFoodIndicator() {
        if (this.foodIndicator) {
            this.foodIndicator.dispose();
            this.foodIndicator = null;
        }
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.behaviorManager = behaviorManager;
    window.Behavior = Behavior;
    window.LingerBehavior = LingerBehavior;
    window.WalkBehavior = WalkBehavior;
    window.RunBehavior = RunBehavior;
    window.WanderBehavior = WanderBehavior;
    window.WorkBehavior = WorkBehavior;
    window.GatherWorkBehavior = GatherWorkBehavior;
    window.FarmWorkBehavior = FarmWorkBehavior;
    window.BuildWorkBehavior = BuildWorkBehavior;
    window.EngineerWorkBehavior = EngineerWorkBehavior;
    window.EatBehavior = EatBehavior;
    
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

// Formation system - arrange units in neat formations after moving
function getFormationPosition(unit) {
    if (!unit || !unit.pb || !unit.pb.state) return null;
    
    // Find all units near this one that just finished moving (within 10 units)
    const nearbyUnits = window.gameUnits.filter(other => {
        if (!other.pb || !other.pb.state) return false;
        if (other.owner !== unit.owner) return false; // Same owner only
        if (other === unit) return false;
        
        const dx = other.pb.state.loc.x - unit.pb.state.loc.x;
        const dz = other.pb.state.loc.z - unit.pb.state.loc.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        return dist < 15; // Within 15 units
    });
    
    // Calculate centroid (center point of the group)
    let centerX = unit.pb.state.loc.x;
    let centerZ = unit.pb.state.loc.z;
    let count = 1;
    
    nearbyUnits.forEach(other => {
        centerX += other.pb.state.loc.x;
        centerZ += other.pb.state.loc.z;
        count++;
    });
    
    centerX /= count;
    centerZ /= count;
    
    // If alone, just stay put and linger
    if (count <= 1) return null;
    
    // Calculate formation position based on unit's index in the group
    // Create a nice grid formation
    const unitsPerRow = Math.ceil(Math.sqrt(count));
    const spacing = 2.5; // Distance between units
    
    // Determine this unit's index in sorted order (for deterministic formation)
    const sortedUnits = [unit, ...nearbyUnits].sort((a, b) => {
        return a.id.localeCompare(b.id); // Sort by ID for consistency
    });
    
    const unitIndex = sortedUnits.indexOf(unit);
    const row = Math.floor(unitIndex / unitsPerRow);
    const col = unitIndex % unitsPerRow;
    
    // Offset from center
    const rowOffset = (row - (Math.ceil(count / unitsPerRow) - 1) / 2) * spacing;
    const colOffset = (col - (unitsPerRow - 1) / 2) * spacing;
    
    return {
        x: centerX + colOffset,
        z: centerZ + rowOffset
    };
}

// Idle unit management system
function updateIdleUnits() {
    if (!window.behaviorManager || !window.gameUnits) return;
    
    let idleCount = 0;
    let wanderAttempts = 0;
    
    // Debug: log when function is called (disabled for performance)
    // if (Math.random() < 0.05) { // 5% chance to log
    //     // console.log(`🌍 updateIdleUnits called, total units: ${gameUnits.length}`);
    // }
    
    // CRITICAL: Use tick-based timing for deterministic behavior in multiplayer
    const currentTick = window.currentMatch?.tick || 0;
    
    // DIAGNOSTIC: Count units without IDs
    let unitsWithoutIds = 0;
    const gameUnits = window.gameUnits; // CRITICAL: Use window.gameUnits, not the module-level gameUnits from units.js!
    gameUnits.forEach(unit => {
        // CRITICAL: Skip units without IDs (shouldn't happen anymore, but safety check)
        if (!unit.id) {
            unitsWithoutIds++;
            return; // Can't use deterministic random without ID
        }
        
        // Skip menu scene units - they already have wander behaviors assigned
        if (unit.id && unit.id.startsWith('menu_unit_')) {
            return;
        }
        
        // Skip idle updates for neutral units that are far away (use squared distance)
        if (unit.owner === 'neutral' && unit.distanceToCameraSquared > 90000) { // 300^2
            return; // Skip idle updates for distant neutral units
        }
        
        // Initialize unit tracking properties if they don't exist (use ticks, not time)
        if (!unit.lastWanderTick) unit.lastWanderTick = 0;
        if (!unit.lastMoveTick) unit.lastMoveTick = 0;
        if (!unit.lastEatTick) unit.lastEatTick = 0;
        
        // Check if villager needs to eat (every 60 seconds, with small random variation)
        if (unit.type === 'villager') {
            const ticksSinceLastEat = currentTick - unit.lastEatTick;
            const baseEatIntervalTicks = 60 * 60; // 60 seconds * 60 ticks/sec = 3600 ticks
            const randomVariationTicks = 10 * 60; // 10 seconds * 60 ticks/sec = 600 ticks
            // CRITICAL: Use deterministic random for eating interval in multiplayer
            const deterministicRandom = getUnitDeterministicRandom(unit, 'eat_interval');
            const eatIntervalTicks = baseEatIntervalTicks + (deterministicRandom * randomVariationTicks * 2 - randomVariationTicks);
            
            if (ticksSinceLastEat > eatIntervalTicks) {
                // Set eating behavior
                window.behaviorManager.setBehavior(unit, 'eat');
                unit.lastEatTick = currentTick;
                return; // Skip other behavior checks
            }
        }
        
        // Brigands: Attack nearby enemy buildings (but respect player commands!)
        if (unit.type === 'brigand') {
            const currentBehavior = window.behaviorManager.getBehavior(unit);
            
            // CRITICAL: Respect player commands - don't auto-attack if player just moved them
            const ticksSincePlayerMove = unit.lastPlayerMoveTick !== undefined 
                ? (currentTick - unit.lastPlayerMoveTick) 
                : Infinity;
            const shouldRespectPlayerCommand = ticksSincePlayerMove < 120; // 6 seconds at 20Hz
            
            // Only auto-attack if idle (no behavior) or if player hasn't given recent commands
            // Don't interrupt player commands or existing attack behaviors
            if ((!currentBehavior || currentBehavior.constructor.name === 'LingerBehavior') && !shouldRespectPlayerCommand) {
                const TILE_SIZE = window.TILE_SIZE || 4;
                const attackRange = 8 * TILE_SIZE; // 8 tiles in world units (reduced from 25 - brigands should attack nearby buildings, not rush across map)
                let nearestEnemyBuilding = null;
                let nearestDistance = attackRange;
                
                // Find nearest enemy building
                if (window.gameBuildings && unit.pb?.state?.loc) {
                    const unitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
                    const unitX = unit.pb.state.loc.x;
                    const unitZ = unit.pb.state.loc.z;
                    
                    for (const building of window.gameBuildings) {
                        if (!building || !building.position) continue;
                        // Don't require mesh - buildings under construction might not have mesh yet
                        if (!building.health || building.health <= 0) continue; // Skip destroyed buildings
                        
                        // Check if building is enemy (different owner)
                        const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
                        if (!buildingOwner || buildingOwner === unitOwner) continue; // Skip friendly buildings or buildings with no owner
                        
                        // Calculate distance
                        const dx = building.position.x - unitX;
                        const dz = building.position.z - unitZ;
                        const distance = Math.sqrt(dx * dx + dz * dz);
                        
                        if (distance < nearestDistance) {
                            nearestDistance = distance;
                            nearestEnemyBuilding = building;
                        }
                    }
                }
                
                // If found enemy building nearby, attack it (interrupts other behaviors)
                if (nearestEnemyBuilding) {
                    console.log(`⚔️ Brigand ${unit.id} attacking ${nearestEnemyBuilding.name || nearestEnemyBuilding.type} at distance ${nearestDistance.toFixed(1)}`);
                    window.behaviorManager.setBehavior(unit, 'attack_building', {
                        building: nearestEnemyBuilding
                    });
                    // Skip wander logic for brigands attacking buildings - return early from forEach iteration
                    return;
                }
            }
        }
        
        // Only process units with no active behavior
        if (!window.behaviorManager.getBehavior(unit)) {
            idleCount++;
            
            // CRITICAL: Use tick-based timing for deterministic wander behavior
            const ticksSinceWander = currentTick - unit.lastWanderTick;
            const ticksSinceMove = currentTick - unit.lastMoveTick;
            
            // Wander delay logic:
            // - Must wait at least 3 seconds after last wander
            // - Must wait at least 5 seconds after last move command
            // - Random chance to wander (reduced from 5% to 2% per second)
            const tickRate = 20; // Match net.TICK_RATE
            const minWanderDelayTicks = Math.floor((window.WANDER_DELAYS?.minWanderDelay || 3000) / 1000 * tickRate); // 3 sec → 60 ticks
            const minMoveDelayTicks = Math.floor((window.WANDER_DELAYS?.minMoveDelay || 5000) / 1000 * tickRate);   // 5 sec → 100 ticks
            const wanderChance = window.WANDER_DELAYS?.wanderChance || 0.02;   // 2% chance per second (reduced from 5%)
            
            // Monks get much more aggressive wander behavior - they should wander almost immediately when idle
            const isMonk = unit.type === 'monk';
            const monkMinWanderDelayTicks = Math.floor(1000 / 1000 * tickRate); // 1 sec → 20 ticks
            const monkMinMoveDelayTicks = Math.floor(2000 / 1000 * tickRate);   // 2 sec → 40 ticks
            const monkWanderChance = 0.15;   // 15% chance per second for monks (much higher)
            
            const effectiveMinWanderDelay = isMonk ? monkMinWanderDelayTicks : minWanderDelayTicks;
            const effectiveMinMoveDelay = isMonk ? monkMinMoveDelayTicks : minMoveDelayTicks;
            const effectiveWanderChance = isMonk ? monkWanderChance : wanderChance;
            
            // CRITICAL: Use deterministic random for wander chance in multiplayer
            const wanderChanceRandom = getUnitDeterministicRandom(unit, 'wander_chance');
            
            if (ticksSinceWander > effectiveMinWanderDelay && 
                ticksSinceMove > effectiveMinMoveDelay && 
                wanderChanceRandom < effectiveWanderChance) {
                
                wanderAttempts++;
                // console.log(`🌍 ${unit.name || unit.type} starting idle wander after ${(ticksSinceWander/60).toFixed(1)}s rest (attempt ${wanderAttempts})`);
                
                // Update last wander tick
                unit.lastWanderTick = currentTick;
                
                // CRITICAL: Use deterministic random for wander parameters in multiplayer
                const durationRandom = getUnitDeterministicRandom(unit, 'wander_duration_idle');
                const areaRandomX = getUnitDeterministicRandom(unit, 'wander_area_x');
                const areaRandomZ = getUnitDeterministicRandom(unit, 'wander_area_z');
                const microMoveRandom = getUnitDeterministicRandom(unit, 'wander_micromove');
                const speedRandom = getUnitDeterministicRandom(unit, 'wander_speed');
                
                // Set wander behavior with unit-specific parameters
                if (isMonk) {
                    // Monks: pace wide areas, not tied closely to any center
                    // Long, slow, contemplative wandering
                    window.behaviorManager.setBehavior(unit, 'wander', {
                        wanderArea: {
                            x: 60, // Large wander area so they can roam far
                            z: 60
                        },
                        wanderDuration: 40000 + durationRandom * 20000, // 40-60 seconds of roaming (deterministic)
                        microMoveChance: 0.35, // Fairly active pacing
                        wanderSpeed: (unit.speed || 25) * 0.4 // Slow, contemplative walking pace (40% of base speed = 10)
                    });
                } else {
                    window.behaviorManager.setBehavior(unit, 'wander', {
                        wanderArea: { 
                            x: 6 + areaRandomX * 4, // 6-10 unit area (deterministic)
                            z: 6 + areaRandomZ * 4 
                        },
                        wanderDuration: 8000 + durationRandom * 4000, // 8-12 seconds (deterministic)
                        microMoveChance: 0.2 + microMoveRandom * 0.2, // 20-40% chance (deterministic)
                        wanderSpeed: (unit.speed || 20) * (0.3 + speedRandom * 0.2) // 30-50% of unit's base speed (deterministic)
                    });
                }
            }
        }
    });
    
    // Debug logging for idle units (only log once per second to avoid spam)
    if (unitsWithoutIds > 0 && window.isMultiplayer && currentTick % 60 === 0) {
        console.warn(`⚠️ updateIdleUnits: ${unitsWithoutIds}/${gameUnits.length} units without IDs - menu scene contamination!`);
        
        // DIAGNOSTIC: Show details about units without IDs
        const sample = gameUnits.find(u => !u.id);
        if (sample) {
            console.log(`   Sample unit without ID:`, {
                type: sample.type,
                name: sample.name,
                owner: sample.owner,
                hasId: !!sample.id,
                hasMesh: !!sample.mesh,
                hasPB: !!sample.pb
            });
        }
        
        // Check if gameUnits array reference matches what we stored
        if (window._initialGameUnitsRef && gameUnits !== window._initialGameUnitsRef) {
            console.error(`   ❌ gameUnits array REFERENCE changed!`);
        }
    }
    // if (idleCount > 0 && Math.random() < 0.1) { // 10% chance to log
    //     console.log(`🌍 Idle units: ${idleCount}, Wander attempts: ${wanderAttempts}`);
    // }
}
