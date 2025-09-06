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
        
        // Use unit's speed property if available, otherwise use impulseStrength
        const effectiveSpeed = this.unit.speed ? this.unit.speed * 0.1 : impulseStrength; // Scale down speed for physics
        
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
        this.unit.pb.state.vel.x = direction.x * effectiveSpeed * momentumBoost;
        this.unit.pb.state.vel.z = direction.z * effectiveSpeed * momentumBoost;
        
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
        this.applyMovementWithRotation(direction, (this.unit.speed || 20) * 0.1);
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
        this.applyMovementWithRotation(direction, (this.unit.speed || 20) * 0.15);
                
        return false;
    }
}

class RunBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 1.5,
            runSpeed: (unit.speed || 20) * 1.5,  // 1.5x faster than unit's base speed
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


class WorkBehavior extends Behavior {
    constructor(unit, building, params = {}) {
        super(unit, {
            workDuration: 30000, // Work for 30 seconds before taking a break
            breakDuration: 5000, // 5 second break
            workSpeed: (unit.speed || 20) * 0.15, // 20% of unit's base speed for working
            ...params
        });
        
        this.building = building;
        this.workStartTime = Date.now();
        this.isOnBreak = false;
        this.breakStartTime = 0;
    }
    
    step() {
        const currentTime = Date.now();
        const elapsed = currentTime - this.workStartTime;
        
        // Check if we should take a break
        if (!this.isOnBreak && elapsed > this.params.workDuration) {
            this.isOnBreak = true;
            this.breakStartTime = currentTime;
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
        const angle = (Date.now() * 0.001) % (Math.PI * 2); // Slow rotation
        const distance = workRadius * TILE_SIZE * 0.5; // Half radius for closer work
        
        const workX = this.building.position.x + Math.cos(angle) * distance;
        const workZ = this.building.position.z + Math.sin(angle) * distance;
        
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
        this.returnStartTime = 0;
        this.resourceIndicator = null; // Visual indicator when carrying resources
        this.gatheredResourceType = null; // What resource this worker is carrying
        this.gatheredResourceAmount = 0; // How much of that resource
    }
    
    step() {
        const currentTime = Date.now();
        
        // Handle different gather states
        switch (this.gatherState) {
            case 'seeking':
                this.seekResources();
                break;
            case 'gathering':
                this.gatherResources(currentTime);
                break;
            case 'returning':
                this.returnToCamp(currentTime);
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
    
    seekResources() {
        if (!this.building || !this.building.position) return;
        
        // Find nearest resource within gather radius
        const nearestResource = this.findNearestResource();
        
        if (nearestResource) {
            this.gatherTarget = nearestResource;
            this.gatherState = 'gathering';
            this.gatherStartTime = Date.now();
            
            // console.log(`🔍 ${this.unit.name || this.unit.type} seeking ${nearestResource.type} at (${nearestResource.x.toFixed(1)}, ${nearestResource.z.toFixed(1)})`);
            
            // Move to resource
            const direction = {
                x: nearestResource.x - this.unit.pb.state.loc.x,
                z: nearestResource.z - this.unit.pb.state.loc.z
            };
            
            const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
            if (length > 0.1) {
                direction.x /= length;
                direction.z /= length;
                this.applyMovementWithRotation(direction, this.params.workSpeed);
            }
        } else {
            // No resources found, just wander around camp
            // console.log(`⚠️ ${this.unit.name || this.unit.type} found no resources near ${this.building.name}`);
            super.performWork();
        }
    }
    
    gatherResources(currentTime) {
        if (!this.gatherTarget) {
            this.gatherState = 'seeking';
            return;
        }
        
        // Check if we've reached the resource
        const dx = this.gatherTarget.x - this.unit.pb.state.loc.x;
        const dz = this.gatherTarget.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance < TILE_SIZE * 0.5) {
            // We're at the resource, stay and gather
            const gatherProgress = (currentTime - this.gatherStartTime) / this.params.gatherDuration;
            if (gatherProgress < 1.0) {
                // console.log(`⛏️ ${this.unit.name || this.unit.type} gathering ${this.gatherTarget.type} (${Math.floor(gatherProgress * 100)}%)`);
            }
            
            if (currentTime - this.gatherStartTime > this.params.gatherDuration) {
                // Finished gathering, return to camp
                // console.log(`📦 ${this.unit.name || this.unit.type} finished gathering ${this.gatherTarget.type}, returning to camp`);
                this.gatherState = 'returning';
                this.returnStartTime = currentTime;
                
                // Store what was gathered
                this.gatheredResourceType = this.gatherTarget.type;
                this.gatheredResourceAmount = this.gatherTarget.amount || 1; // Default to 1 if no amount specified
                
                // Create visual indicator for carrying resources
                this.createResourceIndicator(this.gatherTarget.type);
                
                this.gatherTarget = null;
            }
            // Just stay put while gathering
        } else {
            // Move towards resource
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
    }
    
    returnToCamp(currentTime) {
        if (!this.building || !this.building.position) return;
        
        // Move back to camp
        const dx = this.building.position.x - this.unit.pb.state.loc.x;
        const dz = this.building.position.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Get much closer to camp for drop-off (within 0.5 tiles)
        if (distance > TILE_SIZE * 0.5) {
            // Move towards camp
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
            // console.log(`🏃 ${this.unit.name || this.unit.type} returning to camp (${distance.toFixed(1)}m away)`);
        } else {
            // We're back at camp, stay briefly then seek more resources
            if (currentTime - this.returnStartTime > this.params.returnDuration) {
                // console.log(`✅ ${this.unit.name || this.unit.type} dropped off resources at camp`);
                
                // Actually add resources to player when worker returns
                this.addGatheredResources();
                
                this.gatherState = 'seeking';
                
                // Remove visual indicator when dropping off resources
                this.removeResourceIndicator();
            }
            // Just stay put while at camp
        }
    }
    
    findNearestResource() {
        if (!this.building || !this.building.position) return null;
        
        // Use the building's detected available resources
        const availableResources = this.building.availableResources || [];
        if (availableResources.length === 0) return null;
        
        // Pick any available resource (not necessarily the nearest)
        // This spreads workers out across different resource tiles
        const randomIndex = Math.floor(Math.random() * availableResources.length);
        const resource = availableResources[randomIndex];
        
        return {
            x: resource.worldX,
            z: resource.worldZ,
            type: resource.type,
            amount: resource.amount
        };
    }
    
    createResourceIndicator(resourceType) {
        if (!this.unit.mesh || this.resourceIndicator) return;
        
        // Create a simple floating icon above the unit
        const indicator = BABYLON.MeshBuilder.CreateSphere("resourceIndicator", {
            diameter: 0.3
        }, window.gfx.scene);
        
        // Position above the unit
        indicator.position = new BABYLON.Vector3(0, 2.5, 0);
        indicator.parent = this.unit.mesh;
        
        // Color based on resource type
        const material = new BABYLON.StandardMaterial("resourceIndicatorMaterial", window.gfx.scene);
        if (resourceType === 'wood') {
            material.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1); // Brown for wood
            material.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0.02);
        } else if (resourceType === 'stone') {
            material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Gray for stone
            material.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        }
        material.alpha = 0.8;
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
        
        // Add the specific resources this worker gathered
        if (window.player && window.player.addResource) {
            window.player.addResource(this.gatheredResourceType, this.gatheredResourceAmount);
            // console.log(`💰 ${this.unit.name || this.unit.type} delivered ${this.gatheredResourceAmount} ${this.gatheredResourceType} to player`);
        }
        
        // Reset gathered resources
        this.gatheredResourceType = null;
        this.gatheredResourceAmount = 0;
    }
    
    findResourceNodes(resourceType, centerPos, radius) {
        // For now, generate some mock resource nodes around the area
        // In a real implementation, you'd query your terrain system for actual resources
        const resources = [];
        const numResources = 3 + Math.floor(Math.random() * 3); // 3-5 resources
        
        for (let i = 0; i < numResources; i++) {
            const angle = (i / numResources) * Math.PI * 2 + Math.random() * 0.5;
            const distance = (Math.random() * 0.7 + 0.3) * radius; // 30-100% of radius
            
            resources.push({
                x: centerPos.x + Math.cos(angle) * distance,
                z: centerPos.z + Math.sin(angle) * distance,
                type: resourceType
            });
        }
        
        return resources;
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
        
        this.patrolPoints = [];
        this.currentPatrolIndex = 0;
        this.patrolDirection = 1; // 1 for forward, -1 for backward
        this.generatePatrolPoints();
    }
    
    step() {
        const currentTime = Date.now();
        
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
            
            // Occasionally reverse direction for more natural movement
            if (Math.random() < 0.1) { // 10% chance
                this.patrolDirection *= -1;
            }
        } else {
            // Move towards current patrol point
            const direction = { x: dx / distance, z: dz / distance };
            this.applyMovementWithRotation(direction, this.params.workSpeed * this.params.patrolSpeed);
        }
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
        const currentTime = Date.now();
        
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
            this.inspectionTarget = nearestBuilding;
            this.currentState = 'inspecting';
            this.inspectionStartTime = Date.now();
            
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
        
        if (distance < TILE_SIZE * 1.5) {
            // We're at the building, inspect and repair it
            if (currentTime - this.inspectionStartTime > this.params.inspectionDuration) {
                // Apply engineer's effects:
                // 1. Repair to full health
                this.inspectionTarget.health = this.inspectionTarget.maxHealth || 100;
                
                // 2. Apply efficiency boost
                if (!this.inspectionTarget.engineerBoostUntil) {
                    this.inspectionTarget.engineerBoostUntil = 0;
                }
                // Set boost for 30 seconds
                this.inspectionTarget.engineerBoostUntil = currentTime + 30000;
                this.inspectionTarget.engineerBoostAmount = 1.2; // 20% boost
                
                // Finished inspecting, mark as visited and return to base
                this.visitedBuildings.add(this.inspectionTarget.id);
                this.currentState = 'returning';
                this.inspectionTarget = null;
                
                // console.log(`🔧 Engineer repaired building and applied 20% efficiency boost for 30 seconds`);
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
        
        const inspectionRadius = this.params.inspectionRadius * TILE_SIZE;
        let nearestBuilding = null;
        let nearestDistance = Infinity;
        
        // Look through all buildings
        for (const building of gameBuildings) {
            if (!building.position) continue;
            if (building.id === this.building.id) continue; // Don't inspect own building
            if (this.visitedBuildings.has(building.id)) continue; // Already visited recently
            
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
        super(unit, {
            wanderArea: { x: 8, z: 8 }, // 8x8 unit area around spawn point
            wanderDuration: 8000 + Math.random() * 4000, // 8-12 seconds
            microMoveChance: 0.3, // 30% chance per second
            wanderSpeed: (unit.speed || 20) * 0.3, // 30% of unit's base speed for wandering
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

// EatBehavior - Villagers occasionally need to eat
class TransformBehavior extends Behavior {
    constructor(unit, params = {}) {
        super(unit, {
            transformDuration: 3000, // Takes 3 seconds to transform
            transformType: null, // What to transform into
            revertDelay: 60000, // Brigands revert after 60 seconds of inactivity
            ...params
        });
        
        this.startTime = Date.now();
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
        const currentTime = Date.now();
        const elapsed = currentTime - this.startTime;
        
        // If we haven't transformed yet and enough time has passed, transform the unit
        if (!this.hasTransformed && elapsed > this.params.transformDuration) {
            this.transformUnit();
        }
        
        // Keep behavior active for brigands to track inactivity
        if (this.params.transformType === 'brigand' && this.hasTransformed) {
            // Check if brigand has been inactive
            const timeSinceLastAction = currentTime - (this.unit.lastMoveTime || 0);
            if (timeSinceLastAction > this.params.revertDelay) {
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
        
        // Create the new unit
        const newUnit = new Unit(this.params.transformType, {
            x: originalPos.x,
            y: originalPos.y,
            z: originalPos.z
        });
        
        // Copy over important properties
        newUnit.owner = owner;
        newUnit.pb.state.rot.copyFrom(originalRot);
        
        // Add to appropriate unit arrays
        if (owner === 'player' && window.player) {
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
        
        // Clean up old unit's mesh
        if (this.unit.mesh) {
            this.unit.mesh.dispose();
        }
        
        // Spawn visual model for new unit
        if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
            window.spawnUnitModels(window.gfx.scene);
        }
        
        // Update unit reference
        this.unit = newUnit;
        this.hasTransformed = true;
        
        // For brigands, initialize activity tracking
        if (this.params.transformType === 'brigand') {
            this.unit.lastMoveTime = Date.now();
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
        if (owner === 'player' && window.player) {
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
        
        // Clean up old unit's mesh
        if (this.unit.mesh) {
            this.unit.mesh.dispose();
        }
        
        // Spawn visual model for new villager
        if (window.spawnUnitModels && window.gfx && window.gfx.scene) {
            window.spawnUnitModels(window.gfx.scene);
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
        
        this.startTime = Date.now();
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
        const currentTime = Date.now();
        const elapsed = currentTime - this.startTime;
        
        // If we haven't eaten yet and have been "eating" for a second, consume the food
        if (!this.hasEaten && elapsed > 1000) {
            this.consumeFood();
        }
        
        // Finish eating after duration
        if (elapsed > this.params.eatingDuration) {
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
                
                // Pick a random direction far away
                const angle = Math.random() * Math.PI * 2;
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
        const currentTime = Date.now();
        
        // Initialize unit tracking properties if they don't exist
        if (!unit.lastWanderTime) unit.lastWanderTime = 0;
        if (!unit.lastMoveTime) unit.lastMoveTime = 0;
        if (!unit.lastEatTime) unit.lastEatTime = 0;
        
        // Check if villager needs to eat (0.02% chance per second, at least 180 seconds since last meal)
        if (unit.type === 'villager' && 
            currentTime - unit.lastEatTime > 180000 && // At least 3 minutes between meals
            Math.random() < 0.0002) { // 0.02% chance per second
            
            // Set eating behavior
            window.behaviorManager.setBehavior(unit, 'eat');
            unit.lastEatTime = currentTime;
            return; // Skip other behavior checks
        }
        
        // Only process units with no active behavior
        if (!window.behaviorManager.getBehavior(unit)) {
            idleCount++;
            
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
                    wanderSpeed: (unit.speed || 20) * (0.3 + Math.random() * 0.2) // 30-50% of unit's base speed
                });
            }
        }
    });
    
    // Debug logging for idle units
    if (idleCount > 0 && Math.random() < 0.1) { // 10% chance to log
        // console.log(`🌍 Idle units: ${idleCount}, Wander attempts: ${wanderAttempts}`);
    }
}
