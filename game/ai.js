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
// CRITICAL: includeTick should be FALSE for probability checks (wander chance, etc.)
// and TRUE only for time-varying selections (pick new target, etc.)
function getUnitDeterministicRandom(unit, context = '', includeTick = false) {
    if (!unit || !unit.id) {
        console.warn('⚠️ getUnitDeterministicRandom called without unit or unit.id, using fallback');
        return 0.5; // Fallback to middle value
    }
    
    // Hash unit ID + context string to get a seed
    const combined = unit.id + context;
    const hash = combined.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    // CRITICAL: Only include tick if explicitly requested (for time-varying randomness)
    // For probability checks (wander chance, etc.), DO NOT include tick!
    const tickComponent = includeTick ? (window.currentMatch?.tick || 0) : 0;
    const finalSeed = hash + tickComponent;
    
    // Generate single random value from seed
    const rng = createDeterministicRNG(finalSeed);
    return rng();
}

function snapWorldPosToTileCenter(pos, tileSize) {
    return {
        x: (Math.floor(pos.x / tileSize) + 0.5) * tileSize,
        z: (Math.floor(pos.z / tileSize) + 0.5) * tileSize
    };
}

function getStableWorldSample(pos, precision = 10) {
    return {
        x: Math.round(pos.x * precision) / precision,
        z: Math.round(pos.z * precision) / precision
    };
}

function getStableDistanceSq(a, b, precision = 10) {
    const qa = getStableWorldSample(a, precision);
    const qb = getStableWorldSample(b, precision);
    const dx = qb.x - qa.x;
    const dz = qb.z - qa.z;
    return Math.round((dx * dx + dz * dz) * 1000) / 1000;
}

function isInSameTile(a, b, tileSize) {
    return Math.floor(a.x / tileSize) === Math.floor(b.x / tileSize) &&
        Math.floor(a.z / tileSize) === Math.floor(b.z / tileSize);
}

function getStablePathQuery(start, end, tileSize) {
    return {
        start: snapWorldPosToTileCenter(start, tileSize),
        end: snapWorldPosToTileCenter(end, tileSize)
    };
}

function getCurrentMatchTick() {
    return window.currentMatch?.tick || 0;
}

function msToTicks(ms, fallbackTicks = 0) {
    if (!Number.isFinite(ms)) return fallbackTicks;
    return Math.max(1, Math.floor(ms / 50));
}

function getAbilityDurationTicks(params = {}, spec = {}) {
    if (Number.isFinite(params.durationTicks)) return Math.max(1, params.durationTicks);
    if (Number.isFinite(params.duration)) return msToTicks(params.duration);
    if (Number.isFinite(spec.durationTicks)) return Math.max(1, spec.durationTicks);
    if (Number.isFinite(spec.duration)) return msToTicks(spec.duration);
    return 0;
}

function getAbilityPointTarget(params = {}, fallback = null) {
    const source = params.targetPoint || params.point || fallback;
    if (!source) return null;
    const x = source.x !== undefined ? source.x : source._x;
    const z = source.z !== undefined ? source.z : source._z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    return { x, z };
}

function getUnitWorldPoint(unit) {
    const loc = unit?.pb?.state?.loc || unit?.position || { x: 0, z: 0 };
    return {
        x: Number.isFinite(loc.x) ? loc.x : 0,
        z: Number.isFinite(loc.z) ? loc.z : 0
    };
}

function createWorldVector(point, y = 0) {
    return new BABYLON.Vector3(point?.x || 0, y, point?.z || 0);
}

function isUnitAlive(unit) {
    if (!unit || unit.dead || unit._disposed) return false;
    const health = Number.isFinite(unit.currentHealth) ? unit.currentHealth : unit.health;
    return !Number.isFinite(health) || health > 0;
}

function getDeterministicUnitsSnapshot() {
    const units = (window.gameUnits || []).slice();
    units.sort((a, b) => window.deterministicStringCompare
        ? window.deterministicStringCompare(a?.id || '', b?.id || '')
        : String(a?.id || '').localeCompare(String(b?.id || '')));
    return units;
}

function getDeterministicBuildingsSnapshot() {
    const buildings = (window.gameBuildings || []).slice();
    buildings.sort((a, b) => window.deterministicStringCompare
        ? window.deterministicStringCompare(a?.id || '', b?.id || '')
        : String(a?.id || '').localeCompare(String(b?.id || '')));
    return buildings;
}

function isHostileToUnit(sourceUnit, otherUnit) {
    if (!sourceUnit || !otherUnit) return false;
    if (window.currentMatch?.areOwnersHostile) {
        return window.currentMatch.areOwnersHostile(otherUnit.owner, sourceUnit.owner);
    }
    return otherUnit.owner !== sourceUnit.owner;
}

function isHostileToBuilding(sourceUnit, building) {
    if (!sourceUnit || !building) return false;
    if (window.currentMatch?.areOwnersHostile) {
        return window.currentMatch.areOwnersHostile(building.owner, sourceUnit.owner);
    }
    return !!building.owner && building.owner !== sourceUnit.owner;
}

function getUnitsInRadius(centerPoint, radius, predicate = () => true) {
    const radiusSq = radius * radius;
    return getDeterministicUnitsSnapshot().filter(unit => {
        if (!isUnitAlive(unit)) return false;
        if (!unit?.pb?.state?.loc) return false;
        if (!predicate(unit)) return false;
        return getStableDistanceSq(centerPoint, unit.pb.state.loc) <= radiusSq;
    });
}

function getHostileBuildingsInRadius(sourceUnit, centerPoint, radius) {
    const radiusSq = radius * radius;
    return getDeterministicBuildingsSnapshot().filter(building => {
        if (!building || building.isDestroyed || building.type === 'agora') return false;
        const health = Number.isFinite(building.health) ? building.health : building.currentHealth;
        if (Number.isFinite(health) && health <= 0) return false;
        if (!building.position) return false;
        if (!isHostileToBuilding(sourceUnit, building)) return false;
        return getStableDistanceSq(centerPoint, building.position) <= radiusSq;
    });
}

function ensureUnitAbilityStatState(unit) {
    if (!unit) return { bases: {}, modifiers: {} };
    if (!unit._abilityStatState) {
        unit._abilityStatState = {
            bases: {},
            modifiers: {}
        };
    }
    return unit._abilityStatState;
}

function getUnitBaseStat(unit, stat) {
    const state = ensureUnitAbilityStatState(unit);
    if (!Number.isFinite(state.bases[stat])) {
        const unitDef = window.UnitTypes?.[unit?.type] || {};
        const currentValue = unit?.[stat];
        const fallbackValue = unitDef?.[stat];
        state.bases[stat] = Number.isFinite(currentValue)
            ? currentValue
            : (Number.isFinite(fallbackValue) ? fallbackValue : 0);
    }
    return state.bases[stat];
}

function recomputeUnitStat(unit, stat) {
    if (!unit) return;
    const state = ensureUnitAbilityStatState(unit);
    const baseValue = getUnitBaseStat(unit, stat);
    const modifiers = Object.values(state.modifiers[stat] || {});
    let multiplier = 1;
    let additive = 0;
    modifiers.forEach(modifier => {
        if (Number.isFinite(modifier?.multiplier)) multiplier *= modifier.multiplier;
        if (Number.isFinite(modifier?.additive)) additive += modifier.additive;
    });
    unit[stat] = Math.round((baseValue * multiplier + additive) * 1000) / 1000;
}

function setUnitStatModifier(unit, stat, sourceKey, modifier = {}) {
    if (!unit || !stat || !sourceKey) return;
    const state = ensureUnitAbilityStatState(unit);
    if (!state.modifiers[stat]) {
        state.modifiers[stat] = {};
    }
    state.modifiers[stat][sourceKey] = {
        multiplier: Number.isFinite(modifier.multiplier) ? modifier.multiplier : 1,
        additive: Number.isFinite(modifier.additive) ? modifier.additive : 0
    };
    recomputeUnitStat(unit, stat);
}

function clearUnitStatModifier(unit, stat, sourceKey) {
    const state = unit?._abilityStatState;
    if (!state?.modifiers?.[stat]?.[sourceKey]) return;
    delete state.modifiers[stat][sourceKey];
    recomputeUnitStat(unit, stat);
}

function getUnitCommandAbilitySpecs(unit) {
    if (!unit || !window.UnitAbilityRegistry?.listSpecs) return [];
    const unitDef = window.UnitTypes?.[unit.type] || {};
    const configuredIds = Array.isArray(unitDef.commandAbilities) ? unitDef.commandAbilities : [];
    const configuredSet = new Set(configuredIds);
    return window.UnitAbilityRegistry
        .listSpecs()
        .filter(spec => {
            if (!spec?.commandable) return false;
            if (configuredSet.has(spec.id)) return true;
            return Array.isArray(spec.allowedUnitTypes) && spec.allowedUnitTypes.includes(unit.type);
        })
        .sort((a, b) => {
            const aOrder = Number.isFinite(a?.order) ? a.order : 999;
            const bOrder = Number.isFinite(b?.order) ? b.order : 999;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return window.deterministicStringCompare
                ? window.deterministicStringCompare(a?.id || '', b?.id || '')
                : String(a?.id || '').localeCompare(String(b?.id || ''));
        });
}

function getPrimaryUnitCommandAbility(unit) {
    const unitDef = window.UnitTypes?.[unit?.type] || {};
    const preferredId = unitDef.primaryAbilityId || null;
    const specs = getUnitCommandAbilitySpecs(unit);
    if (preferredId) {
        const preferred = specs.find(spec => spec.id === preferredId);
        if (preferred) return preferred;
    }
    return specs.find(spec => spec.primary !== false) || specs[0] || null;
}

function canUnitUseAbility(unit, abilityId) {
    return getUnitCommandAbilitySpecs(unit).some(spec => spec.id === abilityId);
}

function buildAbilityParamsForUnit(unit, abilityId, worldPos) {
    const spec = window.UnitAbilityRegistry?.getSpec?.(abilityId);
    if (!spec) return null;
    const defaultParams = { ...(spec.defaultParams || {}) };
    if (typeof spec.buildParams === 'function') {
        const builtParams = spec.buildParams(unit, worldPos);
        if (builtParams === null) return null;
        return {
            ...defaultParams,
            ...(builtParams || {})
        };
    }
    const params = defaultParams;
    if (spec.targetType === 'point') {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        params.targetPoint = targetPoint;
    }
    return params;
}

function hashStringDeterministically(value = '') {
    return String(value).split('').reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 0);
}

function hashTileWithSeed(gridX, gridZ, seed = 0) {
    let hash = (seed + gridX * 374761393 + gridZ * 668265263) >>> 0;
    hash = (hash ^ (hash >>> 13)) >>> 0;
    hash = (hash * 1274126177) >>> 0;
    hash = (hash ^ (hash >>> 16)) >>> 0;
    return hash / 4294967296;
}

function getStableAbilityCenterPoint(point) {
    const normalized = getAbilityPointTarget({ targetPoint: point });
    if (!normalized) return null;
    return {
        x: Math.round(normalized.x * 1000) / 1000,
        z: Math.round(normalized.z * 1000) / 1000
    };
}

function getTileCenterWorld(gridX, gridZ, tileSize = window.TILE_SIZE || 4) {
    return {
        x: (gridX + 0.5) * tileSize,
        z: (gridZ + 0.5) * tileSize
    };
}

function getWoodResourceTilesInRadius(centerPoint, radius) {
    const field = window.liveField;
    const tileSize = window.TILE_SIZE || 4;
    if (!field || !window.buildingSystem?.checkTileForResources) return [];

    const radiusSq = radius * radius;
    const minGridX = Math.max(0, Math.floor((centerPoint.x - radius) / tileSize) - 1);
    const maxGridX = Math.min(field.width - 1, Math.ceil((centerPoint.x + radius) / tileSize) + 1);
    const minGridZ = Math.max(0, Math.floor((centerPoint.z - radius) / tileSize) - 1);
    const maxGridZ = Math.min(field.height - 1, Math.ceil((centerPoint.z + radius) / tileSize) + 1);
    const results = [];

    for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ++) {
            const resourceInfo = window.buildingSystem.checkTileForResources(gridX, gridZ, false);
            if (!resourceInfo || resourceInfo.type !== 'wood') continue;

            const tileCenter = getTileCenterWorld(gridX, gridZ, tileSize);
            const distanceSq = getStableDistanceSq(tileCenter, centerPoint, 1000);
            if (distanceSq > radiusSq) continue;

            results.push({
                ...resourceInfo,
                gridX,
                gridZ,
                worldX: tileCenter.x,
                worldZ: tileCenter.z,
                distanceSq
            });
        }
    }

    results.sort((a, b) => {
        if (a.gridX !== b.gridX) return a.gridX - b.gridX;
        return a.gridZ - b.gridZ;
    });
    return results;
}

function getSporeGrowthSeedTiles(sourceUnit, centerPoint, params = {}) {
    const field = window.liveField;
    const tileSize = window.TILE_SIZE || 4;
    if (!field) return [];

    const outerRadius = params.outerRadius || tileSize * 3.5;
    const ringMinRadius = Number.isFinite(params.seedRingMinRadius)
        ? params.seedRingMinRadius
        : Math.max(tileSize, outerRadius * 0.65);
    const ringMaxRadius = Number.isFinite(params.seedRingMaxRadius)
        ? params.seedRingMaxRadius
        : (outerRadius + tileSize * 0.35);
    const maxSeedCount = Math.max(1, Number.isFinite(params.maxSeedCount)
        ? params.maxSeedCount
        : Math.round((outerRadius / tileSize) * 4));
    const seedChance = Number.isFinite(params.seedChance) ? params.seedChance : 0.38;
    const ringMinSq = ringMinRadius * ringMinRadius;
    const ringMaxSq = ringMaxRadius * ringMaxRadius;
    const baseSeed = (
        hashStringDeterministically(sourceUnit?.id || sourceUnit?.type || 'spore') +
        Math.round(centerPoint.x * 10) * 31 +
        Math.round(centerPoint.z * 10) * 17 +
        getCurrentMatchTick() * 13
    ) >>> 0;

    const minGridX = Math.max(0, Math.floor((centerPoint.x - ringMaxRadius) / tileSize) - 1);
    const maxGridX = Math.min(field.width - 1, Math.ceil((centerPoint.x + ringMaxRadius) / tileSize) + 1);
    const minGridZ = Math.max(0, Math.floor((centerPoint.z - ringMaxRadius) / tileSize) - 1);
    const maxGridZ = Math.min(field.height - 1, Math.ceil((centerPoint.z + ringMaxRadius) / tileSize) + 1);
    const candidates = [];

    for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
        for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ++) {
            const tileCenter = getTileCenterWorld(gridX, gridZ, tileSize);
            const distanceSq = getStableDistanceSq(tileCenter, centerPoint, 1000);
            if (distanceSq < ringMinSq || distanceSq > ringMaxSq) continue;
            if (!window.canGrowTreeAt?.(gridX, gridZ)) continue;

            const seedRoll = hashTileWithSeed(gridX, gridZ, baseSeed);
            const ringOffset = Math.abs(Math.sqrt(distanceSq) - outerRadius);
            candidates.push({
                gridX,
                gridZ,
                tileCenter,
                seedRoll,
                ringOffset
            });
        }
    }

    candidates.sort((a, b) => {
        if (a.seedRoll !== b.seedRoll) return a.seedRoll - b.seedRoll;
        if (a.ringOffset !== b.ringOffset) return a.ringOffset - b.ringOffset;
        if (a.gridX !== b.gridX) return a.gridX - b.gridX;
        return a.gridZ - b.gridZ;
    });

    const selected = candidates.filter(candidate => candidate.seedRoll <= seedChance).slice(0, maxSeedCount);
    if (selected.length > 0) {
        return selected;
    }
    return candidates.slice(0, Math.min(3, maxSeedCount));
}

function executeSporeBloomEffect(sourceUnit, centerPoint, params = {}) {
    const stableCenter = getStableAbilityCenterPoint(centerPoint || getUnitWorldPoint(sourceUnit));
    if (!stableCenter) return { destroyedTrees: 0, growthSeeds: 0, creditedWood: 0 };

    const tileSize = window.TILE_SIZE || 4;
    const match = window.currentMatch;
    const outerRadius = params.outerRadius || tileSize * 3.5;
    const innerRadius = Number.isFinite(params.innerRadius) ? params.innerRadius : outerRadius * 0.5;
    const growthDelayTicks = Math.max(1, Number.isFinite(params.growthDelayTicks) ? params.growthDelayTicks : 90);
    const growthDurationMs = Math.max(1000, Number.isFinite(params.growthDurationMs) ? params.growthDurationMs : 7000);
    const treeRemaining = Number.isFinite(params.treeRemaining) ? params.treeRemaining : 28;
    const innerWoodAmount = Number.isFinite(params.innerWoodAmount) ? params.innerWoodAmount : 7;
    const innerRadiusSq = innerRadius * innerRadius;
    const destroyedTreeTiles = getWoodResourceTilesInRadius(stableCenter, outerRadius);

    let creditedWood = 0;
    destroyedTreeTiles.forEach(tree => {
        const key = `${tree.gridX},${tree.gridZ}`;
        if (tree.distanceSq <= innerRadiusSq) {
            creditedWood += innerWoodAmount;
        }
        if (match?.resourceRemaining) {
            match.resourceRemaining.set(key, 0);
        }
        if (match?._scheduledDepletions) {
            match._scheduledDepletions.delete(key);
        }
        window.removeResourceModel?.(tree.gridX, tree.gridZ, { skipPathingRebuild: true });
    });

    if (destroyedTreeTiles.length > 0 && window.gfx?.rebuildFieldResourcePathing) {
        window.gfx.rebuildFieldResourcePathing(window.liveField);
    }

    if (creditedWood > 0) {
        if (match?.queueResourceCredit) {
            match.queueResourceCredit(sourceUnit?.owner, 'wood', creditedWood, getCurrentMatchTick());
        } else {
            const ownerPlayer = window.findPlayerByUnitOwner?.(sourceUnit?.owner);
            ownerPlayer?.addResource?.('wood', creditedWood);
        }
    }

    const growthSeeds = getSporeGrowthSeedTiles(sourceUnit, stableCenter, {
        ...params,
        outerRadius
    });

    growthSeeds.forEach((seed, index) => {
        const growAtTick = getCurrentMatchTick() + growthDelayTicks + (index % 3) * 4;
        window.gfx?.setResourceTileEffect?.(seed.gridX, seed.gridZ, 'growth_preview', 'mushroom_ring', {
            yOffset: 0.03,
            scale: 1.0
        });
        if (match?.queueResourceGrowth) {
            match.queueResourceGrowth({
                gridX: seed.gridX,
                gridZ: seed.gridZ,
                resourceType: 'trees',
                growAtTick,
                remaining: treeRemaining,
                growthInitialScale: 0.12,
                growthDurationMs
            });
        } else {
            window.gfx?.clearResourceTileEffect?.(seed.gridX, seed.gridZ, 'growth_preview');
            window.growTreeAt?.(seed.gridX, seed.gridZ, {
                remaining: treeRemaining,
                growthAnimation: {
                    initialScale: 0.12,
                    durationMs: growthDurationMs
                }
            });
        }
    });

    return {
        destroyedTrees: destroyedTreeTiles.length,
        growthSeeds: growthSeeds.length,
        creditedWood
    };
}

window.executeSporeBloomEffect = executeSporeBloomEffect;

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
        
        // Use a continuous speed mapping for all behaviors.
        // The previous branch at impulseStrength<10 created discontinuous speed jumps
        // (some calls ignored the provided value entirely), which produced visible
        // fast/slow pulses during behavior transitions.
        const speedInput = Number.isFinite(impulseStrength) ? impulseStrength : (this.unit.speed || 20);
        const effectiveSpeed = Math.max(0, speedInput) * 0.08;
        
        // Movement is driven entirely by setting velocity below.
        // Do NOT also add an impulse — the physics loop does vel += imp,
        // which would double the speed and cause overshooting.
        
        // Calculate target rotation to face movement direction
        // Note: modelOrientation offset is applied in updateUnitMeshes(), not here
        const targetRotation = Math.atan2(direction.x, direction.z);
        const currentRotation = this.unit.pb.state.rot.y || 0;
        
        // Calculate shortest rotation direction
        let rotationDiff = targetRotation - currentRotation;
        if (Math.abs(rotationDiff) > Math.PI) {
            rotationDiff = rotationDiff > 0 ? rotationDiff - Math.PI * 2 : rotationDiff + Math.PI * 2;
        }
        
        // Snap rotation directly to target - no lerping, no spring, instant facing
        // Flying units and birds get slower turning
        let rotationSpeed = 1.0; // Full snap by default
        
        if (this.unit.abilities && this.unit.abilities.includes('fly')) {
            rotationSpeed = 0.15; // Slow for flying units
        }
        if (this.unit.type === 'bird_messenger') {
            rotationSpeed = 0.05; // Very slow for birds
        }
        
        // Apply rotation directly
        this.unit.pb.state.rot.y = currentRotation + rotationDiff * rotationSpeed;
        
        // CRITICAL: Clear rotation velocity AND impulse to prevent physics system from fighting us
        if (this.unit.pb.rotVel) {
            this.unit.pb.rotVel.y = 0;
        }
        if (this.unit.pb.rotImp) {
            this.unit.pb.rotImp.y = 0;
        }
        
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

    // Shared pathfinding navigation for any behavior.
    // Call once per step with the target position. Returns true when arrived.
    navigateTo(target, speed) {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        const field = window.liveField;
        const TILE_SIZE = window.TILE_SIZE || 4;
        const pos = this.unit.pb.state.loc;

        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const distSq = getStableDistanceSq(pos, target);
        const arrivalRadiusSq = Math.round(((TILE_SIZE * 0.75) * (TILE_SIZE * 0.75)) * 1000) / 1000;
        if (isInSameTile(pos, target, TILE_SIZE) || distSq <= arrivalRadiusSq) return true; // arrived

        // Flying units: straight line, no pathfinding
        if (this.unit.abilities && this.unit.abilities.includes('fly')) {
            const dist = Math.sqrt(distSq);
            if (dist > 0.001) {
                this.applyMovementWithRotation({
                    x: Math.round((dx / dist) * 10000) / 10000,
                    z: Math.round((dz / dist) * 10000) / 10000
                }, speed);
            }
            return false;
        }

        // Lazy path calculation
        if (!this._navPath && !this._navChecked && field && field.findPath) {
            this._navChecked = true;
            const pathQuery = getStablePathQuery(pos, target, TILE_SIZE);
            this._navDirectClear = this._isDirectClear(pathQuery.start, pathQuery.end, field, TILE_SIZE);
            if (!this._navDirectClear) {
                this._navPath = field.findPath(
                    pathQuery.start.x,
                    pathQuery.start.z,
                    pathQuery.end.x,
                    pathQuery.end.z
                );
                this._navIdx = 0;
            }
        }

        // If pathfinding failed and no clear line of sight, don't blindly walk
        // toward the target (which causes units to pile up at boundaries).
        if (!this._navPath && !this._navDirectClear && this._navChecked) {
            return false;
        }

        let cur = target;
        if (this._navPath && this._navIdx < this._navPath.length) {
            cur = this._navPath[this._navIdx];
            const waypointRadiusSq = Math.round((TILE_SIZE * TILE_SIZE * 0.25) * 1000) / 1000;
            if (isInSameTile(pos, cur, TILE_SIZE) || getStableDistanceSq(pos, cur) <= waypointRadiusSq) {
                this._navIdx++;
                cur = this._navIdx < this._navPath.length ? this._navPath[this._navIdx] : target;
            }
        }

        const tdx = cur.x - pos.x;
        const tdz = cur.z - pos.z;
        const tlen = Math.sqrt(getStableDistanceSq(pos, cur));
        if (tlen > 0.001) {
            this.applyMovementWithRotation({
                x: Math.round((tdx / tlen) * 10000) / 10000,
                z: Math.round((tdz / tlen) * 10000) / 10000
            }, speed);
        }
        return false;
    }

    // Clear cached navigation when target changes
    resetNav() {
        this._navPath = null;
        this._navIdx = 0;
        this._navChecked = false;
        this._navDirectClear = false;
    }

    _isDirectClear(start, end, field, tileSize) {
        const x0 = start.x / tileSize, z0 = start.z / tileSize;
        const x1 = end.x / tileSize, z1 = end.z / tileSize;
        let tx = Math.floor(x0), tz = Math.floor(z0);
        const ex = Math.floor(x1), ez = Math.floor(z1);
        const ddx = x1 - x0, ddz = z1 - z0;
        const sx = ddx > 0 ? 1 : (ddx < 0 ? -1 : 0);
        const sz = ddz > 0 ? 1 : (ddz < 0 ? -1 : 0);
        const tdx = ddx !== 0 ? Math.abs(1 / ddx) : Infinity;
        const tdz = ddz !== 0 ? Math.abs(1 / ddz) : Infinity;
        let tmx = ddx !== 0 ? (ddx > 0 ? (tx + 1 - x0) : (x0 - tx)) * tdx : Infinity;
        let tmz = ddz !== 0 ? (ddz > 0 ? (tz + 1 - z0) : (z0 - tz)) * tdz : Infinity;
        const maxS = Math.abs(ex - tx) + Math.abs(ez - tz) + 4;
        for (let i = 0; i < maxS; i++) {
            if (!field.isPassable(tx, tz)) return false;
            if (tx === ex && tz === ez) break;
            if (tmx < tmz) { tmx += tdx; tx += sx; }
            else if (tmz < tmx) { tmz += tdz; tz += sz; }
            else {
                if (!field.isPassable(tx + sx, tz)) return false;
                if (!field.isPassable(tx, tz + sz)) return false;
                tmx += tdx; tmz += tdz; tx += sx; tz += sz;
            }
        }
        return true;
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
        
        // CRITICAL: If params.startImmediately is false, set lastWanderTick to current tick
        // This prevents immediate wandering when created after movement completion
        // Otherwise, use fixed reference point for units spawned at game start
        if (params.startImmediately === false) {
            this.lastWanderTick = (window.currentMatch?.tick || 0);
        } else {
            // Use fixed reference point (-1000) for initial spawns to ensure determinism
            this.lastWanderTick = -1000 + tickOffset;
        }
        
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
        const distanceFromCenter = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, this.centerPoint));
        
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
        // CRITICAL: Use deterministic angle based on unit ID + wander count for multiplayer sync
        // DO NOT use currentTick directly as it may differ between clients by 1-2 ticks
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        
        // Track how many times this behavior has wandered for time variation
        if (!this._wanderCount) this._wanderCount = 0;
        this._wanderCount++;
        
        // Multiply by large primes to spread out sequential IDs and wander counts
        const randomAngle = ((unitIdHash * 7919 + this._wanderCount * 31) % 628) / 100; // 0 to 2π (6.28)
        
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
        
        const distance = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, target));
        
        // Only walk if target is reasonably far (> 2 units)
        // This prevents jittering from tiny wander movements
        if (distance > 2.0) {
            // Normalize and apply movement
            direction.x = Math.round((direction.x / distance) * 10000) / 10000;
            direction.z = Math.round((direction.z / distance) * 10000) / 10000;
            
        // Apply movement with rotation and forward momentum boost
        this.applyMovementWithRotation(direction, 2.4); // Super slow, very relaxed pace (20% speed)
        } else {
            // Target too close - just stop and wait
            this.currentTarget = null;
            
            // Clear velocity to ensure unit stops completely
            if (this.unit.pb && this.unit.pb.imp) {
                this.unit.pb.imp.x = 0;
                this.unit.pb.imp.z = 0;
            }
        }
    }
}

class WalkBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 0.5,
            walkSpeed: unit.speed || 20,
            ...params
        });
        
        this.targetPoint = targetPoint;
        this.path = null;
        this.pathIndex = 0;
        this.pathCalculated = false;
        this._stuckTicks = 0;
        this._lastPos = null;
        this._repathCount = 0;
        this._isFlying = unit.abilities && unit.abilities.includes('fly');
        if (this._isFlying && unit.pb && unit.pb.state) {
            this._flyStartX = unit.pb.state.loc.x;
            this._flyStartZ = unit.pb.state.loc.z;
            // Deterministic arc direction from unit ID char codes
            let idSum = 0;
            if (unit.id) { for (let i = 0; i < unit.id.length; i++) idSum += unit.id.charCodeAt(i); }
            this._flyArcSign = (idSum % 2 === 0) ? 1 : -1;
        }
    }
    
    step() {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        
        const currentPos = this.unit.pb.state.loc;
        
        const personalityOffset = this.params.applyPersonalityOffset === false
            ? { x: 0, z: 0 }
            : (this.unit.personalityOffset || { x: 0, z: 0 });
        const roundedOffset = {
            x: Math.round(personalityOffset.x * 1000) / 1000,
            z: Math.round(personalityOffset.z * 1000) / 1000
        };
        const finalTarget = {
            x: Math.round((this.targetPoint.x + roundedOffset.x) * 1000) / 1000,
            z: Math.round((this.targetPoint.z + roundedOffset.z) * 1000) / 1000
        };

        // Check if arrived at final destination
        const dx = finalTarget.x - currentPos.x;
        const dz = finalTarget.z - currentPos.z;
        const arrivalRadiusSq = this.params.arrivalRadius * this.params.arrivalRadius;
        const distanceSq = getStableDistanceSq(currentPos, finalTarget);
        
        if (distanceSq <= arrivalRadiusSq) {
            if (this.unit.pb.imp) {
                this.unit.pb.imp.x = 0;
                this.unit.pb.imp.z = 0;
            }
            if (this.unit.pb.state.vel) {
                this.unit.pb.state.vel.x = 0;
                this.unit.pb.state.vel.z = 0;
            }
            this.unit.pb.state.loc.x = finalTarget.x;
            this.unit.pb.state.loc.z = finalTarget.z;
            this.completed = true;
            return true;
        }

        // Flying units: skip A*, fly direct with gentle arc, ignore terrain slowdown
        if (this._isFlying) {
            const distance = Math.sqrt(dx * dx + dz * dz);
            return this._stepFlying(currentPos, finalTarget, distance);
        }

        // --- Ground unit pathing below ---
        const field = window.liveField;
        const TILE_SIZE = window.TILE_SIZE || 4;
        
        // Stuck detection: if barely moved in 30 ticks, force A* re-path
        if (this._lastPos && this._repathCount < 5) {
            const stableCurrentPos = getStableWorldSample(currentPos);
            const movedDx = stableCurrentPos.x - this._lastPos.x;
            const movedDz = stableCurrentPos.z - this._lastPos.z;
            if (movedDx * movedDx + movedDz * movedDz < 0.01) {
                this._stuckTicks++;
            } else {
                this._stuckTicks = 0;
            }
            if (this._stuckTicks > 30) {
                this._stuckTicks = 0;
                this._repathCount++;
                this.pathCalculated = false;
                this._forcePathfind = true;
            }
        }
        this._lastPos = getStableWorldSample(currentPos);
        
        if (!this.pathCalculated && field && field.findPath) {
            this.pathCalculated = true;
            const pathQuery = getStablePathQuery(currentPos, finalTarget, TILE_SIZE);
            
            const directClear = this._forcePathfind ? false
                : this.isDirectPathClear(pathQuery.start, pathQuery.end, field, TILE_SIZE);
            this._forcePathfind = false;
            
            if (!directClear) {
                this.path = field.findPath(
                    pathQuery.start.x,
                    pathQuery.start.z,
                    pathQuery.end.x,
                    pathQuery.end.z
                );
                this.pathIndex = 0;
                
                if (!this.path) {
                    this.completed = true;
                    return true;
                }
            } else {
                this.path = null;
            }
        }
        
        // Determine current target (waypoint or final destination)
        let currentTarget;
        if (this.path && this.pathIndex < this.path.length) {
            currentTarget = this.path[this.pathIndex];
            
            const waypointRadiusSq = Math.round((TILE_SIZE * TILE_SIZE * 0.25) * 1000) / 1000;
            const wpReached = isInSameTile(currentPos, currentTarget, TILE_SIZE) ||
                getStableDistanceSq(currentPos, currentTarget) <= waypointRadiusSq;
            
            if (wpReached) {
                this.pathIndex++;
                if (this.pathIndex >= this.path.length) {
                    const remainingSq = getStableDistanceSq(currentPos, finalTarget);
                    if (remainingSq > (TILE_SIZE * 2) * (TILE_SIZE * 2) && this._repathCount < 5) {
                        this._repathCount++;
                        this.pathCalculated = false;
                        this._forcePathfind = true;
                    }
                    currentTarget = finalTarget;
                } else {
                    currentTarget = this.path[this.pathIndex];
                }
            }
        } else {
            currentTarget = finalTarget;
        }
        
        // Move toward current target
        const direction = {
            x: currentTarget.x - currentPos.x,
            z: currentTarget.z - currentPos.z
        };
        
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (length > 0.001) {
            direction.x = Math.round((direction.x / length) * 10000) / 10000;
            direction.z = Math.round((direction.z / length) * 10000) / 10000;
        } else {
            direction.x = 0;
            direction.z = 0;
        }
        
        // Terrain slow effect (trees) -- ground units only
        let speedMultiplier = 1.0;
        if (field && field.getSpeedMultiplier) {
            const currentTileX = Math.floor(currentPos.x / TILE_SIZE);
            const currentTileZ = Math.floor(currentPos.z / TILE_SIZE);
            speedMultiplier = field.getSpeedMultiplier(currentTileX, currentTileZ);
        }
        
        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }

        if (window.currentMatch && window.currentMatch.tick) {
            this.unit.lastMoveTick = window.currentMatch.tick;
        }
        
        const effectiveSpeed = this.params.walkSpeed * speedMultiplier;
        this.applyMovementWithRotation(direction, effectiveSpeed);

        return false;
    }

    _stepFlying(currentPos, finalTarget, distance) {
        // Direct vector to target
        let dirX = finalTarget.x - currentPos.x;
        let dirZ = finalTarget.z - currentPos.z;

        // Apply gentle arc: perpendicular offset that peaks at journey midpoint
        const totalDx = finalTarget.x - this._flyStartX;
        const totalDz = finalTarget.z - this._flyStartZ;
        const totalDist = Math.sqrt(totalDx * totalDx + totalDz * totalDz);

        if (totalDist > 5) {
            // Progress: 0 at start, 1 at destination
            const traveled = Math.sqrt(
                (currentPos.x - this._flyStartX) * (currentPos.x - this._flyStartX) +
                (currentPos.z - this._flyStartZ) * (currentPos.z - this._flyStartZ)
            );
            const progress = Math.min(traveled / totalDist, 1.0);
            // Sine curve peaks at 0.5 progress
            const arcStrength = Math.sin(progress * Math.PI) * 0.12 * this._flyArcSign;
            // Perpendicular to travel direction (rotate 90 degrees)
            const perpX = -totalDz / totalDist;
            const perpZ = totalDx / totalDist;
            dirX += perpX * arcStrength * totalDist;
            dirZ += perpZ * arcStrength * totalDist;
        }

        const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (length > 0.001) {
            dirX = Math.round((dirX / length) * 10000) / 10000;
            dirZ = Math.round((dirZ / length) * 10000) / 10000;
        } else {
            dirX = 0;
            dirZ = 0;
        }

        if (!this.unit.pb.state.vel) {
            this.unit.pb.state.vel = { x: 0, y: 0, z: 0 };
        }
        if (!this.unit.pb.imp) {
            this.unit.pb.imp = { x: 0, y: 0, z: 0 };
        }

        if (window.currentMatch && window.currentMatch.tick) {
            this.unit.lastMoveTick = window.currentMatch.tick;
        }

        this.applyMovementWithRotation({ x: dirX, z: dirZ }, this.params.walkSpeed);
        return false;
    }
    
    // Grid-exact line of sight using Amanatides-Woo traversal.
    // Checks every tile the line passes through -- no sampling gaps.
    isDirectPathClear(start, end, field, tileSize) {
        const x0 = start.x / tileSize;
        const z0 = start.z / tileSize;
        const x1 = end.x / tileSize;
        const z1 = end.z / tileSize;

        let tileX = Math.floor(x0);
        let tileZ = Math.floor(z0);
        const endTileX = Math.floor(x1);
        const endTileZ = Math.floor(z1);

        const dx = x1 - x0;
        const dz = z1 - z0;

        const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

        const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
        const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

        let tMaxX = dx !== 0
            ? (dx > 0 ? (tileX + 1 - x0) : (x0 - tileX)) * tDeltaX
            : Infinity;
        let tMaxZ = dz !== 0
            ? (dz > 0 ? (tileZ + 1 - z0) : (z0 - tileZ)) * tDeltaZ
            : Infinity;

        const maxSteps = Math.abs(endTileX - tileX) + Math.abs(endTileZ - tileZ) + 4;

        for (let i = 0; i < maxSteps; i++) {
            if (!field.isPassable(tileX, tileZ)) return false;

            if (field.chunkMask && field.chunkSize) {
                const cx = Math.floor(tileX / field.chunkSize);
                const cz = Math.floor(tileZ / field.chunkSize);
                if (field.chunkMask.get(`${cx},${cz}`) === false) return false;
            }

            if (tileX === endTileX && tileZ === endTileZ) break;

            if (tMaxX < tMaxZ) {
                tMaxX += tDeltaX;
                tileX += stepX;
            } else if (tMaxZ < tMaxX) {
                tMaxZ += tDeltaZ;
                tileZ += stepZ;
            } else {
                // Ray crosses a tile corner -- check both adjacent tiles too
                if (!field.isPassable(tileX + stepX, tileZ)) return false;
                if (!field.isPassable(tileX, tileZ + stepZ)) return false;
                tMaxX += tDeltaX;
                tMaxZ += tDeltaZ;
                tileX += stepX;
                tileZ += stepZ;
            }
        }
        return true;
    }
}

class RunBehavior extends Behavior {
    constructor(unit, targetPoint, params = {}) {
        super(unit, {
            arrivalRadius: 0.3,
            runSpeed: (unit.speed || 20) * 1.5,
            ...params
        });
        
        this.targetPoint = targetPoint;
        this.path = null;
        this.pathIndex = 0;
        this.pathCalculated = false;
        this._stuckTicks = 0;
        this._lastPos = null;
        this._repathCount = 0;
    }
    
    step() {
        if (!this.unit.pb || !this.unit.pb.state) return true;
        
        const field = window.liveField;
        const TILE_SIZE = window.TILE_SIZE || 4;
        const currentPos = this.unit.pb.state.loc;
        
        // Stuck detection: if barely moved in 30 ticks, force A* re-path
        if (this._lastPos && this._repathCount < 5) {
            const stableCurrentPos = getStableWorldSample(currentPos);
            const movedDx = stableCurrentPos.x - this._lastPos.x;
            const movedDz = stableCurrentPos.z - this._lastPos.z;
            if (movedDx * movedDx + movedDz * movedDz < 0.01) {
                this._stuckTicks++;
            } else {
                this._stuckTicks = 0;
            }
            if (this._stuckTicks > 30) {
                this._stuckTicks = 0;
                this._repathCount++;
                this.pathCalculated = false;
                this._forcePathfind = true;
            }
        }
        this._lastPos = getStableWorldSample(currentPos);
        
        if (!this.pathCalculated && field && field.findPath) {
            this.pathCalculated = true;
            const pathQuery = getStablePathQuery(currentPos, this.targetPoint, TILE_SIZE);
            
            const directClear = this._forcePathfind ? false
                : this.isDirectPathClear(pathQuery.start, pathQuery.end, field, TILE_SIZE);
            this._forcePathfind = false;
            
            if (!directClear) {
                this.path = field.findPath(
                    pathQuery.start.x,
                    pathQuery.start.z,
                    pathQuery.end.x,
                    pathQuery.end.z
                );
                this.pathIndex = 0;
                
                if (!this.path) {
                    this.completed = true;
                    return true;
                }
            } else {
                this.path = null;
            }
        }
        
        // Determine current target (waypoint or final)
        let currentTarget;
        if (this.path && this.pathIndex < this.path.length) {
            currentTarget = this.path[this.pathIndex];
            
            const waypointRadiusSq = Math.round((TILE_SIZE * TILE_SIZE * 0.25) * 1000) / 1000;
            const wpReached = isInSameTile(currentPos, currentTarget, TILE_SIZE) ||
                getStableDistanceSq(currentPos, currentTarget) <= waypointRadiusSq;
            
            if (wpReached) {
                this.pathIndex++;
                if (this.pathIndex >= this.path.length) {
                    const remainingSq = getStableDistanceSq(currentPos, this.targetPoint);
                    if (remainingSq > (TILE_SIZE * 2) * (TILE_SIZE * 2) && this._repathCount < 5) {
                        this._repathCount++;
                        this.pathCalculated = false;
                        this._forcePathfind = true;
                    }
                    currentTarget = this.targetPoint;
                } else {
                    currentTarget = this.path[this.pathIndex];
                }
            }
        } else {
            currentTarget = this.targetPoint;
        }
        
        const dx = this.targetPoint.x - currentPos.x;
        const dz = this.targetPoint.z - currentPos.z;
        const arrivalRadiusSq = this.params.arrivalRadius * this.params.arrivalRadius;
        const distanceSq = getStableDistanceSq(currentPos, this.targetPoint);
        
        if (distanceSq <= arrivalRadiusSq) {
            if (this.unit.pb.imp) {
                this.unit.pb.imp.x = 0;
                this.unit.pb.imp.z = 0;
            }
            if (this.unit.pb.state.vel) {
                this.unit.pb.state.vel.x = 0;
                this.unit.pb.state.vel.z = 0;
            }
            this.unit.pb.state.loc.x = this.targetPoint.x;
            this.unit.pb.state.loc.z = this.targetPoint.z;
            this.completed = true;
            return true;
        }
        
        // Move toward current target
        const direction = {
            x: currentTarget.x - currentPos.x,
            z: currentTarget.z - currentPos.z
        };
        
        const length = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (length > 0.001) {
            direction.x = Math.round((direction.x / length) * 10000) / 10000;
            direction.z = Math.round((direction.z / length) * 10000) / 10000;
        } else {
            direction.x = 0;
            direction.z = 0;
        }
        
        // Check current tile for slow effect
        let speedMultiplier = 1.0;
        if (field && field.getSpeedMultiplier) {
            const currentTileX = Math.floor(currentPos.x / TILE_SIZE);
            const currentTileZ = Math.floor(currentPos.z / TILE_SIZE);
            speedMultiplier = field.getSpeedMultiplier(currentTileX, currentTileZ);
        }
        
        // Track movement
        if (window.currentMatch && window.currentMatch.tick) {
            this.unit.lastMoveTick = window.currentMatch.tick;
        }
        
        const effectiveSpeed = this.params.runSpeed * speedMultiplier;
        this.applyMovementWithRotation(direction, effectiveSpeed);
        
        return false;
    }
    
    isDirectPathClear(start, end, field, tileSize) {
        const x0 = start.x / tileSize;
        const z0 = start.z / tileSize;
        const x1 = end.x / tileSize;
        const z1 = end.z / tileSize;

        let tileX = Math.floor(x0);
        let tileZ = Math.floor(z0);
        const endTileX = Math.floor(x1);
        const endTileZ = Math.floor(z1);

        const dx = x1 - x0;
        const dz = z1 - z0;

        const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
        const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

        const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
        const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

        let tMaxX = dx !== 0
            ? (dx > 0 ? (tileX + 1 - x0) : (x0 - tileX)) * tDeltaX
            : Infinity;
        let tMaxZ = dz !== 0
            ? (dz > 0 ? (tileZ + 1 - z0) : (z0 - tileZ)) * tDeltaZ
            : Infinity;

        const maxSteps = Math.abs(endTileX - tileX) + Math.abs(endTileZ - tileZ) + 4;

        for (let i = 0; i < maxSteps; i++) {
            if (!field.isPassable(tileX, tileZ)) return false;

            if (field.chunkMask && field.chunkSize) {
                const cx = Math.floor(tileX / field.chunkSize);
                const cz = Math.floor(tileZ / field.chunkSize);
                if (field.chunkMask.get(`${cx},${cz}`) === false) return false;
            }

            if (tileX === endTileX && tileZ === endTileZ) break;

            if (tMaxX < tMaxZ) {
                tMaxX += tDeltaX;
                tileX += stepX;
            } else if (tMaxZ < tMaxX) {
                tMaxZ += tDeltaZ;
                tileZ += stepZ;
            } else {
                if (!field.isPassable(tileX + stepX, tileZ)) return false;
                if (!field.isPassable(tileX, tileZ + stepZ)) return false;
                tMaxX += tDeltaX;
                tMaxZ += tDeltaZ;
                tileX += stepX;
                tileZ += stepZ;
            }
        }
        return true;
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
        
        const lengthSq = getStableDistanceSq(this.unit.pb.state.loc, { x: workX, z: workZ });
        const moveThresholdSq = 0.01;
        if (lengthSq > moveThresholdSq) {
            const length = Math.sqrt(lengthSq);
            direction.x = length > 0.001 ? Math.round((direction.x / length) * 10000) / 10000 : 0;
            direction.z = length > 0.001 ? Math.round((direction.z / length) * 10000) / 10000 : 0;
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
    }
    
    stayNearBuilding() {
        if (!this.building || !this.building.position) return;
        
        // Stay close to the building during break
        const dx = this.building.position.x - this.unit.pb.state.loc.x;
        const dz = this.building.position.z - this.unit.pb.state.loc.z;
        const distanceSq = getStableDistanceSq(this.unit.pb.state.loc, this.building.position);
        const breakRadiusSq = Math.round(((TILE_SIZE * 1.5) * (TILE_SIZE * 1.5)) * 1000) / 1000;
        
        if (distanceSq > breakRadiusSq) {
            // Move closer to building
            const distance = Math.sqrt(distanceSq);
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
            this.applyMovementWithRotation(direction, this.params.workSpeed * 0.5);
        }
    }
}

class GatherWorkBehavior extends WorkBehavior {
    constructor(unit, building, params = {}) {
        // CRITICAL: Use building's productionWorkRadius if available, otherwise default to 9
        const buildingDef = building.type ? window.BuildingTypes[building.type] : null;
        const defaultGatherRadius = buildingDef?.productionWorkRadius || buildingDef?.workRadius || 9;
        
        super(unit, building, {
            workType: "gather",
            gatherRadius: defaultGatherRadius, // How far to look for resources (from building definition)
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
        this.resourceTypes = params.resourceTypes || null; // Optional filter: only gather these types

        const TILE_SIZE = window.TILE_SIZE || 4;
        const unitIdHash = (unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const idleAngle = ((unitIdHash % 12) / 12) * Math.PI * 2;
        const idleDistance = TILE_SIZE * 1.15;
        this.idleSeekX = Math.round((building.position.x + Math.cos(idleAngle) * idleDistance) * 100) / 100;
        this.idleSeekZ = Math.round((building.position.z + Math.sin(idleAngle) * idleDistance) * 100) / 100;
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

    moveToIdleSeekSpot() {
        if (!this.unit?.pb?.state?.loc) return;

        const TILE_SIZE = window.TILE_SIZE || 4;
        const idleTarget = { x: this.idleSeekX, z: this.idleSeekZ };
        const currentPos = this.unit.pb.state.loc;
        const arrivalRadiusSq = Math.round((TILE_SIZE * TILE_SIZE * 0.2) * 1000) / 1000;

        if (isInSameTile(currentPos, idleTarget, TILE_SIZE) || getStableDistanceSq(currentPos, idleTarget) <= arrivalRadiusSq) {
            this.holdDeterministicPosition(idleTarget);
            return;
        }

        const dx = idleTarget.x - currentPos.x;
        const dz = idleTarget.z - currentPos.z;
        const distanceSq = getStableDistanceSq(currentPos, idleTarget);
        const distance = Math.sqrt(distanceSq);
        const direction = {
            x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
            z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
        };
        this.applyMovementWithRotation(direction, this.params.workSpeed * 0.6);
    }

    holdDeterministicPosition(targetPoint) {
        const unitLoc = this.unit?.pb?.state?.loc;
        if (!unitLoc || !targetPoint) return;

        const snapX = Math.round(targetPoint.x * 1000) / 1000;
        const snapZ = Math.round(targetPoint.z * 1000) / 1000;

        if (this.unit.pb.imp) {
            this.unit.pb.imp.x = 0;
            this.unit.pb.imp.z = 0;
        }
        if (this.unit.pb.state.vel) {
            this.unit.pb.state.vel.x = 0;
            this.unit.pb.state.vel.z = 0;
        }

        unitLoc.x = snapX;
        unitLoc.z = snapZ;

        if (this.unit.position) {
            this.unit.position.x = snapX;
            this.unit.position.z = snapZ;
        }
        if (this.unit.visualPosition) {
            this.unit.visualPosition.x = snapX;
            this.unit.visualPosition.z = snapZ;
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
            const distanceSq = getStableDistanceSq(this.unit.pb.state.loc, adjustedResourceTarget);
            
            // Once we reach the resource, switch to gathering state
            // CRITICAL: Use a slightly larger threshold and round distance to prevent floating-point precision issues
            // This ensures workers on both clients reach the resource at the same tick
            const arrivalThresholdSq = Math.round(((TILE_SIZE * 0.6) * (TILE_SIZE * 0.6)) * 1000) / 1000;
            
            if (isInSameTile(this.unit.pb.state.loc, adjustedResourceTarget, TILE_SIZE) || distanceSq <= arrivalThresholdSq) {
                this.holdDeterministicPosition(adjustedResourceTarget);
                this.gatherState = 'gathering';
                const currentTick = window.currentMatch?.tick || 0;
                // CRITICAL: Use tick-based timing for deterministic gathering
                // CRITICAL: Only set gatherStartTick if not already set to prevent resetting on subsequent frames
                if (!this.gatherStartTick || this.gatherStartTick === 0) {
                    this.gatherStartTime = currentTick * 50; // Convert tick to ms for compatibility
                    this.gatherStartTick = currentTick; // Store tick for deterministic completion check
                }
                // Store which resource we're gathering from for depletion tracking
                this.lastGatheredResource = { x: this.gatherTarget.x, z: this.gatherTarget.z, gridX: this.gatherTarget.gridX, gridZ: this.gatherTarget.gridZ };
                // console.log(`🔍 ${this.unit.name || this.unit.type} reached ${this.gatherTarget.type}, starting to gather`);
            } else {
                // Keep moving toward resource every frame (with offset applied)
                // CRITICAL: Round direction to fixed precision for deterministic movement
                const distance = Math.sqrt(distanceSq);
                const direction = { 
                    x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0, 
                    z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0 
                };
                this.applyMovementWithRotation(direction, this.params.workSpeed);
            }
        } else {
            // No resources found: hold a fixed deterministic idle spot near camp
            // rather than endlessly orbiting, which can accumulate drift over time.
            this.moveToIdleSeekSpot();
        }
    }
    
    gatherResources(currentTime, currentTick) {
        if (!this.gatherTarget) {
            this.gatherState = 'seeking';
            return;
        }

        const personalityOffset = this.unit.personalityOffset || { x: 0, z: 0 };
        const roundedOffset = {
            x: Math.round(personalityOffset.x * 1000) / 1000,
            z: Math.round(personalityOffset.z * 1000) / 1000
        };
        const adjustedGatherTarget = {
            x: Math.round((this.gatherTarget.x + roundedOffset.x) * 1000) / 1000,
            z: Math.round((this.gatherTarget.z + roundedOffset.z) * 1000) / 1000
        };
        
        // Continuously check position and move if needed
        const dx = adjustedGatherTarget.x - this.unit.pb.state.loc.x;
        const dz = adjustedGatherTarget.z - this.unit.pb.state.loc.z;
        const distanceSq = getStableDistanceSq(this.unit.pb.state.loc, adjustedGatherTarget);
        const gatherArrivalRadiusSq = Math.round((TILE_SIZE * TILE_SIZE * 0.25) * 1000) / 1000;
        
        if (isInSameTile(this.unit.pb.state.loc, adjustedGatherTarget, TILE_SIZE) || distanceSq <= gatherArrivalRadiusSq) {
            this.holdDeterministicPosition(adjustedGatherTarget);
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
                
                // Clear any old path data so we calculate a fresh path
                this.returnPath = null;
                this.returnWaypointIndex = 0;
                
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
            const distance = Math.sqrt(distanceSq);
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
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
        const distanceSq = getStableDistanceSq(this.unit.pb.state.loc, adjustedCampPosition);
        const campArrivalRadiusSq = Math.round((TILE_SIZE * TILE_SIZE * 0.25) * 1000) / 1000;
        
        // Get much closer to camp for drop-off (within 0.5 tiles)
        if (!isInSameTile(this.unit.pb.state.loc, adjustedCampPosition, TILE_SIZE) && distanceSq > campArrivalRadiusSq) {
            // Calculate path if we don't have one yet (using pathfinding to avoid mountains)
            if (!this.returnPath || this.returnPath.length === 0) {
                if (window.liveField && window.liveField.findPath) {
                    const pathQuery = getStablePathQuery(this.unit.pb.state.loc, adjustedCampPosition, TILE_SIZE);
                    this.returnPath = window.liveField.findPath(
                        pathQuery.start.x,
                        pathQuery.start.z,
                        pathQuery.end.x,
                        pathQuery.end.z
                    );
                    
                    if (this.returnPath && this.returnPath.length > 0) {
                        this.returnWaypointIndex = 0;
                    } else {
                        // No path found, try direct movement as fallback
                        this.returnPath = [adjustedCampPosition];
                        this.returnWaypointIndex = 0;
                    }
                } else {
                    // No pathfinding available, use direct movement
                    this.returnPath = [adjustedCampPosition];
                    this.returnWaypointIndex = 0;
                }
            }
            
            // Follow the path
            if (this.returnPath && this.returnWaypointIndex < this.returnPath.length) {
                const waypoint = this.returnPath[this.returnWaypointIndex];
                const wpDx = waypoint.x - this.unit.pb.state.loc.x;
                const wpDz = waypoint.z - this.unit.pb.state.loc.z;
                const wpDistanceSq = getStableDistanceSq(this.unit.pb.state.loc, waypoint);
                
                // Check if we reached current waypoint
                if (isInSameTile(this.unit.pb.state.loc, waypoint, TILE_SIZE) || wpDistanceSq <= campArrivalRadiusSq) {
                    this.returnWaypointIndex++;
                } else {
                    // Move toward current waypoint
                    const wpDistance = Math.sqrt(wpDistanceSq);
                    const direction = {
                        x: wpDistance > 0.001 ? Math.round((wpDx / wpDistance) * 10000) / 10000 : 0,
                        z: wpDistance > 0.001 ? Math.round((wpDz / wpDistance) * 10000) / 10000 : 0
                    };
                    this.applyMovementWithRotation(direction, this.params.workSpeed);
                }
            }
        } else {
            // We're at camp - wait briefly then seek more resources
            this.holdDeterministicPosition(adjustedCampPosition);
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
                
                // Clear path data for next trip
                this.returnPath = null;
                this.returnWaypointIndex = 0;
                
                // Remove visual indicator when dropping off resources
                this.removeResourceIndicator();
            }
            // Just stay put at camp while waiting (no movement)
        }
    }
    
    scanNearbyResources() {
        if (!this.building || !this.building.position) return [];
        
        const field = window.liveField;
        if (!field) return [];
        
        const resources = [];
        const campGridX = Math.floor(this.building.position.x / TILE_SIZE);
        const campGridZ = Math.floor(this.building.position.z / TILE_SIZE);
        
        // Use gatherRadius from params (defaults to building's productionWorkRadius)
        const searchRadius = this.params.gatherRadius || 9;
        
        // Debug logging disabled for cleaner console
        // const shouldDebug = !this._lastScanLog || (Date.now() - this._lastScanLog) > 3000;
        const shouldDebug = false;
        
        for (let x = campGridX - searchRadius; x <= campGridX + searchRadius; x++) {
            for (let z = campGridZ - searchRadius; z <= campGridZ + searchRadius; z++) {
                // Skip out of bounds
                if (x < 0 || z < 0 || x >= field.width || z >= field.height) continue;
                
                // Use checkTileForResources from buildingSystem (deterministic hash-based detection)
                // This matches the exact same logic as gfx.js uses to place resources
                const resourceInfo = window.buildingSystem?.checkTileForResources(x, z, false);
                
                if (resourceInfo) {
                    if (this.resourceTypes && !this.resourceTypes.includes(resourceInfo.type)) continue;
                    const worldX = (x + 0.5) * TILE_SIZE; // Center of tile
                    const worldZ = (z + 0.5) * TILE_SIZE;
                    
                    // Calculate model offset to match gfx.js placement
                    // Trees (wood) and rocks (stone/minerals) use different hash seeds
                    const fieldSeed = field.seed || 0;
                    let hashSeed;
                    if (resourceInfo.type === 'wood') {
                        // Trees use this hash seed (must match gfx.js)
                        hashSeed = fieldSeed + x * 13579 + z * 24680;
                    } else {
                        // Rocks use this hash seed (must match gfx.js)
                        hashSeed = fieldSeed + x * 73856093 + z * 19349663;
                    }
                    
                    // Same LCG hash as gfx.js
                    let hash = hashSeed;
                    hash = (hash * 1664525 + 1013904223) >>> 0;
                    const offsetX = ((hash % 1000) / 1000 - 0.5) * 0.6;
                    hash = (hash * 1664525 + 1013904223) >>> 0;
                    const offsetZ = ((hash % 1000) / 1000 - 0.5) * 0.6;
                    
                    // Apply model offset to world position
                    const modelWorldX = worldX + offsetX;
                    const modelWorldZ = worldZ + offsetZ;
                    
                    // Check distance (use tile center for radius check)
                    const dx = worldX - this.building.position.x;
                    const dz = worldZ - this.building.position.z;
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    
                    if (distance <= searchRadius * TILE_SIZE) {
                        resources.push({
                            gridX: x,
                            gridZ: z,
                            worldX: modelWorldX,  // Use model position for pathing
                            worldZ: modelWorldZ,
                            x: modelWorldX,
                            z: modelWorldZ,
                            type: resourceInfo.type,
                            amount: resourceInfo.amount,
                            remaining: resourceInfo.remaining
                        });
                    }
                }
            }
        }
        
        if (shouldDebug) {
            console.log(`   Found ${resources.length} resources`);
            if (resources.length > 0) {
                console.log(`   First 3:`, resources.slice(0, 3).map(r => `${r.type} at (${r.gridX},${r.gridZ})`));
            }
        }
        
        return resources;
    }
    
    findNearestResource() {
        if (!this.building || !this.building.position) return null;
        
        // Dynamically scan for resources instead of using pre-scanned list
        // This allows working with respawning resources
        const availableResources = this.scanNearbyResources();
        if (availableResources.length === 0) return null;
        
        // CRITICAL: Ensure resources are sorted deterministically
        // Prioritize stone/minerals over wood to balance resource gathering, then by gridX, gridZ
        // This prevents workers from always depleting wood first
        const sortedResources = availableResources.length > 1 ? 
            availableResources.slice().sort((a, b) => {
                // First priority: resource type (stone/minerals before wood)
                if (a.type !== b.type) {
                    if (a.type === 'stone' || a.type === 'minerals') return -1;
                    if (b.type === 'stone' || b.type === 'minerals') return 1;
                    // Both are wood or both are stone/minerals, continue to position sorting
                }
                // Second priority: grid position (deterministic)
                if (a.gridX !== b.gridX) return a.gridX - b.gridX;
                return a.gridZ - b.gridZ;
            }) : availableResources;
        
        // CRITICAL: Use a stable, deterministic resource selection for multiplayer sync
        // Pick resource based ONLY on unit ID hash so workers stick with their assigned resource
        const unitIdHash = (this.unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const resourceListLength = sortedResources.length;
        const resourceIndex = unitIdHash % Math.max(resourceListLength, 1);
        
        // Try to find an available resource starting from calculated index
        // Wrap around deterministically
        let resource = null;
        let attempts = 0;
        const maxAttempts = resourceListLength;
        
        while (attempts < maxAttempts && !resource) {
            const wrappedIndex = (resourceIndex + attempts) % Math.max(resourceListLength, 1);
            if (wrappedIndex < sortedResources.length) {
                const candidate = sortedResources[wrappedIndex];
                // Resources from scanNearbyResources are already validated (not depleted, in bounds)
                resource = candidate;
                break;
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
            gridX: resource.gridX,
            gridZ: resource.gridZ,
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
        } else if (resourceType === 'stone' || resourceType === 'minerals') {
            // Create a box (rock) for stone/minerals - 6x bigger and angular!
            indicator = BABYLON.MeshBuilder.CreateBox("resourceIndicator", {
                width: 3.0,   // 0.5 * 6
                height: 2.4,  // 0.4 * 6
                depth: 2.7    // 0.45 * 6
            }, window.gfx.scene);
            
            // Add slight rotation to make it look more natural/irregular
            indicator.rotation.x = Math.PI * 0.15;
            indicator.rotation.z = Math.PI * 0.1;
            
            if (resourceType === 'minerals') {
                material.diffuseColor = new BABYLON.Color3(0.7, 0.6, 0.8); // Purple-ish for minerals/gems
                material.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0.2);
            } else {
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Gray for stone
                material.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            }
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
        
        material.alpha = 1.0;
        indicator.material = material;
        
        // Add a subtle glow effect
        indicator.renderingGroupId = 1; // Render after main scene
        
        this.resourceIndicator = indicator;
        // Expand blob shadow to include the big resource on head
        const carryRadius = (resourceType === 'wood' || resourceType === 'stone' || resourceType === 'minerals') ? 1.25 : 0.7;
        if (window.gfx && window.gfx.setBlobShadowRadius) {
            window.gfx.setBlobShadowRadius(this.unit, carryRadius);
        }
        // console.log(`💎 Created ${resourceType} indicator for ${this.unit.name || this.unit.type}`);
    }
    
    removeResourceIndicator() {
        if (this.resourceIndicator) {
            this.resourceIndicator.dispose();
            this.resourceIndicator = null;
            if (window.gfx && window.gfx.setBlobShadowRadius) {
                window.gfx.setBlobShadowRadius(this.unit, null);
            }
            // console.log(`🗑️ Removed resource indicator from ${this.unit.name || this.unit.type}`);
        }
    }
    
    addGatheredResources() {
        if (!this.gatheredResourceType || this.gatheredResourceAmount <= 0) return;
        
        // Map resource types to player resource names
        const resourceTypeMap = {
            'minerals': 'minerals',
            'wood': 'wood',
            'stone': 'stone',
            'food': 'food'
        };
        
        const playerResourceType = resourceTypeMap[this.gatheredResourceType] || this.gatheredResourceType;
        
        // Add the specific resources this worker gathered to their owner (not always window.player!)
        const owner = findPlayerByUnitOwner(this.unit.owner);
        const match = window.currentMatch;
        if (match && typeof match.queueResourceCredit === 'function') {
            match.queueResourceCredit(this.unit.owner, playerResourceType, this.gatheredResourceAmount, match.tick || 0);
        } else if (owner && owner.addResource) {
            owner.addResource(playerResourceType, this.gatheredResourceAmount);
        }
        
        // RESOURCE DEPLETION: Queue decrement to be applied at sync checkpoint
        if (this.lastGatheredResource && match) {
            if (!Array.isArray(match.pendingResourceDecrements)) {
                match.pendingResourceDecrements = [];
            }
            const currentTick = match.tick || 0;
            match.pendingResourceDecrements.push({
                gridX: this.lastGatheredResource.gridX,
                gridZ: this.lastGatheredResource.gridZ,
                amount: this.gatheredResourceAmount,
                queuedAtTick: currentTick
            });
        }
        
        // Reset gathered resources
        this.gatheredResourceType = null;
        this.gatheredResourceAmount = 0;
        this.lastGatheredResource = null;
    }
}

// Manual Gather Behavior - for when player clicks a specific resource
class ManualGatherBehavior extends Behavior {
    constructor(unit, targetResource, params = {}) {
        super(unit, {
            gatherDuration: 15000, // How long to gather (15 seconds)
            workSpeed: 0.5,
            ...params
        });
        
        this.gatherState = 'seeking'; // seeking, gathering, returning
        this.gatherTarget = {
            x: targetResource.x,
            z: targetResource.z,
            gridX: targetResource.gridX,
            gridZ: targetResource.gridZ,
            type: targetResource.type,
            amount: targetResource.amount
        };
        this.gatherStartTime = 0;
        this.gatherStartTick = 0;
        this.resourceIndicator = null;
        this.gatheredResourceType = targetResource.type || 'wood'; // Use passed type
        this.gatheredResourceAmount = targetResource.amount || 1;  // Use passed amount
        
        // console.log(`🪓 ${unit.type} manually gathering ${this.gatheredResourceAmount} ${this.gatheredResourceType} from (${targetResource.gridX}, ${targetResource.gridZ}) at world pos (${this.gatherTarget.x.toFixed(1)}, ${this.gatherTarget.z.toFixed(1)})`);
        // console.log(`   Unit current position: (${unit.pb?.state?.loc?.x.toFixed(1) || '?'}, ${unit.pb?.state?.loc?.z.toFixed(1) || '?'})`);
    }
    
    step() {
        const currentTick = window.currentMatch?.tick || 0;
        const currentTime = currentTick * 50; // Convert to ms
        
        // Check if resource is depleted
        const isDepleted = window.isResourceTileDepleted && 
            window.isResourceTileDepleted(this.gatherTarget.gridX, this.gatherTarget.gridZ);
        
        if (isDepleted) {
            // console.log(`🪓 Resource depleted, going idle`);
            
            // Remove resource indicator
            this.removeResourceIndicator();
            
            if (window.behaviorManager) {
                window.behaviorManager.setBehavior(this.unit, 'linger', {
                    center: { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z },
                    radius: 5,
                    wanderDistance: 2.0,
                    wanderInterval: 30000
                });
            }
            return true; // Complete
        }
        
        // Handle gathering states
        switch (this.gatherState) {
            case 'seeking':
                this.seekResource(currentTime, currentTick);
                break;
            case 'gathering':
                this.gatherResource(currentTime, currentTick);
                break;
            case 'returning':
                return this.returnResource(currentTime, currentTick);
        }
        
        return false; // Keep working
    }
    
    // CRITICAL: Handle interruption - keep resources for later return
    onReassignment() {
        const currentTick = window.currentMatch?.tick || 0;
        if (this.gatheredResourceType && this.gatheredResourceAmount > 0) {
            console.log(`🔄 [T${currentTick}] ${this.unit.id?.slice(-6)} interrupted while carrying ${this.gatheredResourceAmount} ${this.gatheredResourceType}, will return later`);
            
            // Store the carried resources on the unit itself so they persist
            this.unit.carriedResourceType = this.gatheredResourceType;
            this.unit.carriedResourceAmount = this.gatheredResourceAmount;
            
            // Keep the visual indicator - it will be cleaned up when resources are eventually deposited
            // Don't clear: this.removeResourceIndicator();
        }
    }
    
    seekResource(currentTime, currentTick) {
        if (!this.gatherTarget) return;
        
        const dx = this.gatherTarget.x - this.unit.pb.state.loc.x;
        const dz = this.gatherTarget.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        const TILE_SIZE = window.TILE_SIZE || 4;
        const arrivalThreshold = TILE_SIZE * 2.5;
        
        if (distance < arrivalThreshold) {
            this.gatherState = 'gathering';
            this.gatherStartTime = currentTime;
            this.gatherStartTick = currentTick;
            this._seekStuckTicks = 0;
            
            if (this.unit.pb) {
                if (this.unit.pb.imp) {
                    this.unit.pb.imp.x = 0;
                    this.unit.pb.imp.z = 0;
                }
                if (this.unit.pb.state && this.unit.pb.state.vel) {
                    this.unit.pb.state.vel.x = 0;
                    this.unit.pb.state.vel.z = 0;
                }
            }
        } else {
            // Stuck detection: if unit barely moved, try re-pathing or give up
            if (!this._seekStuckTicks) this._seekStuckTicks = 0;
            if (!this._seekRepathCount) this._seekRepathCount = 0;
            
            if (this._seekLastPos) {
                const movedDx = this.unit.pb.state.loc.x - this._seekLastPos.x;
                const movedDz = this.unit.pb.state.loc.z - this._seekLastPos.z;
                if (movedDx * movedDx + movedDz * movedDz < 0.01) {
                    this._seekStuckTicks++;
                } else {
                    this._seekStuckTicks = 0;
                }
                
                if (this._seekStuckTicks > 40) {
                    this._seekStuckTicks = 0;
                    this._seekRepathCount++;
                    this.resetNav();
                    
                    if (this._seekRepathCount >= 3) {
                        // Can't reach this resource — go idle instead of hugging the edge
                        if (window.behaviorManager) {
                            window.behaviorManager.setBehavior(this.unit, 'linger', {
                                center: { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z },
                                radius: 5,
                                wanderDistance: 2.0,
                                wanderInterval: 30000
                            });
                        }
                        return;
                    }
                }
            }
            this._seekLastPos = { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z };
            
            const moveSpeed = this.unit.speed || 20;
            this.navigateTo(this.gatherTarget, moveSpeed);
        }
    }
    
    gatherResource(currentTime, currentTick) {
        const tickRate = 20; // Match net.TICK_RATE
        const gatherDurationTicks = Math.floor(this.params.gatherDuration / 1000 * tickRate);
        const ticksGathering = currentTick - this.gatherStartTick;
        
        // Log progress every second
        if (!this._gatherLogTimer || Date.now() - this._gatherLogTimer > 1000) {
            this._gatherLogTimer = Date.now();
            const progress = Math.min(100, (ticksGathering / gatherDurationTicks * 100));
        }
        
        if (ticksGathering >= gatherDurationTicks) {
            // Gathering complete! Start returning
            // console.log(`🪓 ${this.unit.type} finished gathering ${this.gatheredResourceAmount} ${this.gatheredResourceType}, returning to base`);
            
            // Queue resource decrement at sync checkpoint
            const match = window.currentMatch;
            if (match) {
                if (!Array.isArray(match.pendingResourceDecrements)) {
                    match.pendingResourceDecrements = [];
                }
                match.pendingResourceDecrements.push({
                    gridX: this.gatherTarget.gridX,
                    gridZ: this.gatherTarget.gridZ,
                    amount: this.gatheredResourceAmount,
                    queuedAtTick: currentTick
                });
            }
            
            // NOW create the resource indicator visual (after gathering, not before)
            this.resourceIndicator = this.createResourceIndicator(this.gatheredResourceType);
            
            // Transition to returning state
            this.gatherState = 'returning';
            this.returnStartTick = currentTick;
            
            // Clear any old path data so we calculate a fresh path
            this.returnPath = null;
            this.returnWaypointIndex = 0;
            
            // Keep resource indicator visible while returning
        }
        
        // Stay at resource location while gathering
        return false;
    }
    
    returnResource(currentTime, currentTick) {
        const loc = this.unit.pb?.state?.loc;
        
        // Find player's agora or closest building to deposit at
        const owner = findPlayerByUnitOwner(this.unit.owner);
        if (!owner || !owner.agora) {
            // No base found, just deposit immediately
            // console.log(`💰 [T${currentTick}] ${this.unit.id?.slice(-6)} depositing ${this.gatheredResourceAmount} ${this.gatheredResourceType} (no agora) at (${loc?.x.toFixed(1)}, ${loc?.z.toFixed(1)})`);
            if (window.currentMatch && typeof window.currentMatch.queueResourceCredit === 'function') {
                window.currentMatch.queueResourceCredit(this.unit.owner, this.gatheredResourceType, this.gatheredResourceAmount, currentTick);
            } else if (owner && owner.addResource) {
                owner.addResource(this.gatheredResourceType, this.gatheredResourceAmount);
            }
            this.removeResourceIndicator();
            
            // Check if original resource is depleted
            const isDepleted = window.isResourceTileDepleted && 
                window.isResourceTileDepleted(this.gatherTarget.gridX, this.gatherTarget.gridZ);
            
            if (isDepleted) {
                // Resource is gone, go idle
                console.log(`🛑 [T${currentTick}] ${this.unit.id?.slice(-6)} resource depleted, going idle`);
                if (window.behaviorManager) {
                    window.behaviorManager.setBehavior(this.unit, 'linger', {
                        center: { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z },
                        radius: 5,
                        wanderDistance: 2.0,
                        wanderInterval: 30000,
                        startImmediately: false
                    });
                }
                return true;
            }
            
            this.gatherState = 'seeking';
            this.resetNav();
            return false;
        }
        
        const TILE_SIZE = window.TILE_SIZE || 4;
        const agoraX = owner.agora.x * TILE_SIZE;
        const agoraZ = owner.agora.y * TILE_SIZE;
        
        const dx = agoraX - this.unit.pb.state.loc.x;
        const dz = agoraZ - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        const depositRange = TILE_SIZE * 3; // Within 3 tiles of agora
        
        if (distance < depositRange) {
            // Arrived! Deposit resources
            // console.log(`💰 [T${currentTick}] ${this.unit.id?.slice(-6)} depositing ${this.gatheredResourceAmount} ${this.gatheredResourceType} at agora, dist=${distance.toFixed(1)}`);
            if (window.currentMatch && typeof window.currentMatch.queueResourceCredit === 'function') {
                window.currentMatch.queueResourceCredit(this.unit.owner, this.gatheredResourceType, this.gatheredResourceAmount, currentTick);
            } else if (owner && owner.addResource) {
                owner.addResource(this.gatheredResourceType, this.gatheredResourceAmount);
            }
            this.removeResourceIndicator();
            
            // Check if original resource is depleted
            const isDepleted = window.isResourceTileDepleted && 
                window.isResourceTileDepleted(this.gatherTarget.gridX, this.gatherTarget.gridZ);
            
            if (isDepleted) {
                // Resource is gone, go idle
                console.log(`🛑 [T${currentTick}] ${this.unit.id?.slice(-6)} resource depleted, going idle`);
                if (window.behaviorManager) {
                    window.behaviorManager.setBehavior(this.unit, 'linger', {
                        center: { x: this.unit.pb.state.loc.x, z: this.unit.pb.state.loc.z },
                        radius: 5,
                        wanderDistance: 2.0,
                        wanderInterval: 30000,
                        startImmediately: false
                    });
                }
                return true;
            }
            
            this.gatherState = 'seeking';
            this.returnPath = null;
            this.returnWaypointIndex = 0;
            this.resetNav();
            return false;
        }
        
        // Calculate path if we don't have one yet
        if (!this.returnPath || this.returnPath.length === 0) {
            if (window.liveField && window.liveField.findPath) {
                const unitX = this.unit.pb.state.loc.x;
                const unitZ = this.unit.pb.state.loc.z;
                this.returnPath = window.liveField.findPath(unitX, unitZ, agoraX, agoraZ);
                
                if (this.returnPath && this.returnPath.length > 0) {
                    this.returnWaypointIndex = 0;
                    console.log(`🗺️ ${this.unit.type} calculated return path with ${this.returnPath.length} waypoints`);
                } else {
                    // No path found, try direct movement
                    console.warn(`⚠️ ${this.unit.type} couldn't find path to agora, trying direct movement`);
                    this.returnPath = [{ x: agoraX, z: agoraZ }];
                    this.returnWaypointIndex = 0;
                }
            } else {
                // No pathfinding available, use direct movement
                this.returnPath = [{ x: agoraX, z: agoraZ }];
                this.returnWaypointIndex = 0;
            }
        }
        
        // Follow the path
        if (this.returnPath && this.returnWaypointIndex < this.returnPath.length) {
            const waypoint = this.returnPath[this.returnWaypointIndex];
            const wpDx = waypoint.x - this.unit.pb.state.loc.x;
            const wpDz = waypoint.z - this.unit.pb.state.loc.z;
            const wpDistance = Math.sqrt(wpDx * wpDx + wpDz * wpDz);
            
            // Check if we reached current waypoint
            if (wpDistance < TILE_SIZE * 0.5) {
                this.returnWaypointIndex++;
                if (this.returnWaypointIndex < this.returnPath.length) {
                    console.log(`🚶 ${this.unit.type} reached waypoint ${this.returnWaypointIndex}/${this.returnPath.length}`);
                }
            } else {
                // Move toward current waypoint
                const direction = {
                    x: wpDx / wpDistance,
                    z: wpDz / wpDistance
                };
                this.applyMovementWithRotation(direction, this.unit.speed || 20);
            }
        }
        
        return false;
    }
    
    createResourceIndicator(resourceType) {
        if (!this.unit.mesh || this.resourceIndicator) return null;
        
        let indicator;
        const material = new BABYLON.StandardMaterial("resourceIndicatorMaterial", window.gfx.scene);
        
        if (resourceType === 'wood') {
            // Create a log (cylinder) for wood
            indicator = BABYLON.MeshBuilder.CreateCylinder("resourceIndicator", {
                height: 4.8,
                diameter: 1.5
            }, window.gfx.scene);
            
            // Rotate log to be horizontal
            indicator.rotation.z = Math.PI / 2;
            
            material.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1); // Brown for wood
            material.emissiveColor = new BABYLON.Color3(0.1, 0.05, 0.02);
        } else if (resourceType === 'stone' || resourceType === 'minerals') {
            // Create a box (rock) for stone/minerals
            indicator = BABYLON.MeshBuilder.CreateBox("resourceIndicator", {
                width: 3.0,
                height: 2.4,
                depth: 2.7
            }, window.gfx.scene);
            
            // Add slight rotation
            indicator.rotation.x = Math.PI * 0.15;
            indicator.rotation.z = Math.PI * 0.1;
            
            if (resourceType === 'minerals') {
                material.diffuseColor = new BABYLON.Color3(0.7, 0.6, 0.8); // Purple-ish for minerals/gems
                material.emissiveColor = new BABYLON.Color3(0.2, 0.15, 0.2);
            } else {
                material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5); // Gray for stone
                material.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
            }
        } else {
            // Fallback to sphere
            indicator = BABYLON.MeshBuilder.CreateSphere("resourceIndicator", {
                diameter: 0.3
            }, window.gfx.scene);
            
            material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            material.emissiveColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        }
        
        // Position above the unit's head
        indicator.position = new BABYLON.Vector3(0, 2.5, 0);
        indicator.parent = this.unit.mesh;
        
        material.alpha = 1.0;
        indicator.material = material;
        indicator.renderingGroupId = 1;
        
        // Expand blob shadow to include the big resource on head
        const carryRadius = (resourceType === 'wood' || resourceType === 'stone' || resourceType === 'minerals') ? 1.25 : 0.7;
        if (window.gfx && window.gfx.setBlobShadowRadius) {
            window.gfx.setBlobShadowRadius(this.unit, carryRadius);
        }
        
        return indicator;
    }
    
    removeResourceIndicator() {
        if (this.resourceIndicator) {
            this.resourceIndicator.dispose();
            if (this.resourceIndicator.material) {
                this.resourceIndicator.material.dispose();
            }
            this.resourceIndicator = null;
            if (window.gfx && window.gfx.setBlobShadowRadius) {
                window.gfx.setBlobShadowRadius(this.unit, null);
            }
        }
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
        const distance = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, currentPoint));
        
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
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
            this.applyMovementWithRotation(direction, this.params.workSpeed * this.params.patrolSpeed);
        }
    }
}

class BuildWorkBehavior extends WorkBehavior {
    constructor(unit, building, params = {}) {
        super(unit, building, {
            workType: "build",
            workSpeed: 12, // Slower so they actually reach and stay at the site
            ...params
        });
        // Fixed work position per unit - no orbiting; villagers walk there and stay
        const TILE_SIZE = window.TILE_SIZE || 4;
        const unitIdHash = (unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const angle = ((unitIdHash % 8) / 8) * Math.PI * 2; // 8 positions around the building
        const dist = TILE_SIZE * 1.2; // ~1.2 tiles from building center
        this.workX = Math.round((building.position.x + Math.cos(angle) * dist) * 100) / 100;
        this.workZ = Math.round((building.position.z + Math.sin(angle) * dist) * 100) / 100;
    }
    
    step() {
        if (!this.building || !this.building.position) return false;
        
        // Only leave build mode after the synchronized completion transition.
        if (this.building.completionProcessed) {
            return true;
        }
        
        // Walk to fixed work spot and stay there (no orbiting)
        const TILE_SIZE = window.TILE_SIZE || 4;
        const dx = this.workX - this.unit.pb.state.loc.x;
        const dz = this.workZ - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, { x: this.workX, z: this.workZ }));
        const arriveThreshold = TILE_SIZE * 0.4; // Consider "at work" when within 0.4 tiles
        
        if (distance > arriveThreshold) {
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
        // Else: already at work spot, stay put - construction progress comes from assignedWorkers count
        
        return false; // Keep building
    }
}

class AttackBuildingBehavior extends Behavior {
    constructor(unit, building, params = {}) {
        const TILE_SIZE = window.TILE_SIZE || 4;
        super(unit, {
            attackRange: 2.0 * TILE_SIZE, // Attack within 2 tiles
            attackDamage: unit.attackDamage || 5, // Damage per attack
            attackCooldown: 2000, // 2 seconds between attacks
            ...params
        });
        
        this.building = building;
        this.lastAttackTime = 0;
        this.attackCooldownTicks = Math.floor(this.params.attackCooldown / 50); // Convert ms to ticks
    }
    
    step() {
        if (!this.building || !this.building.position) return true; // Building gone, stop attacking

        // Agoras are capture points, not destructible attack targets.
        if (this.building.type === 'agora') {
            return true;
        }
        
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
        const distance = Math.sqrt(getStableDistanceSq(unitPos, this.building.position));
        
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
                this.unit.pb.state.rot.y += 0.3; // Direct rotation for spin
            } else {
                // Face building when not actively attacking - direct lerp, no spring
                this.unit.pb.state.rot.y = currentRotation + rotationDiff * 0.3;
            }
            
            // Clear rotation velocity to prevent residual spinning
            if (this.unit.pb.rotVel) {
                this.unit.pb.rotVel.y = 0;
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
            
            const length = Math.sqrt(getStableDistanceSq(unitPos, { x: moveX, z: moveZ }));
            if (length > 0.05) {
                direction.x = Math.round((direction.x / length) * 10000) / 10000;
                direction.z = Math.round((direction.z / length) * 10000) / 10000;
                this.applyMovementWithRotation(direction, this.unit.speed * 0.4); // Moderate movement while attacking
            }
        } else {
            // Move towards building
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
            this.applyMovementWithRotation(direction, this.unit.speed || 20);
        }
        
        return false; // Keep attacking
    }
}

class AttackUnitBehavior extends Behavior {
    constructor(unit, targetUnit, params = {}) {
        const TILE_SIZE = window.TILE_SIZE || 4;
        const unitDef = window.UnitTypes?.[unit.type] || {};
        super(unit, {
            attackRange: (unit.attackRange || unitDef.attackRange || 2.5) * TILE_SIZE,
            attackDamage: unit.attackDamage || unitDef.attackDamage || 5,
            attackCooldown: unitDef.attackCooldown || 1500,
            attackType: unitDef.attackType || 'melee',
            ...params
        });

        this.targetUnit = targetUnit;
        this.lastAttackTick = 0;
        this.cooldownTicks = Math.floor(this.params.attackCooldown / 50);
    }

    step() {
        const target = this.targetUnit;
        if (!target || target.dead || target._disposed) return true;
        if (typeof target.health === 'number' && target.health <= 0) return true;

        const targetLoc = target.pb?.state?.loc;
        const unitLoc = this.unit.pb?.state?.loc;
        if (!targetLoc || !unitLoc) return false;

        // Check target is still in the game
        if (window.gameUnits && !window.gameUnits.includes(target)) return true;

        const dx = targetLoc.x - unitLoc.x;
        const dz = targetLoc.z - unitLoc.z;
        const distance = Math.sqrt(getStableDistanceSq(unitLoc, targetLoc));
        const currentTick = window.currentMatch?.tick || 0;

        if (distance <= this.params.attackRange) {
            // Face the target
            const targetAngle = Math.atan2(dx, dz);
            const currentRot = this.unit.pb.state.rot?.y || 0;
            let rotDiff = targetAngle - currentRot;
            if (Math.abs(rotDiff) > Math.PI) {
                rotDiff = rotDiff > 0 ? rotDiff - Math.PI * 2 : rotDiff + Math.PI * 2;
            }
            if (!this.unit.pb.rotImp) this.unit.pb.rotImp = { x: 0, y: 0, z: 0 };

            const ticksSinceAttack = currentTick - this.lastAttackTick;

            if (ticksSinceAttack >= this.cooldownTicks) {
                this.lastAttackTick = currentTick;

                if (this.params.attackType === 'ranged' && window.projectiles) {
                    const from = new BABYLON.Vector3(unitLoc.x, 1.5, unitLoc.z);
                    const to = new BABYLON.Vector3(targetLoc.x, 1.0, targetLoc.z);
                    if (window.projectiles.applyImpact) {
                        window.projectiles.applyImpact({
                            unit: target,
                            attackerOwner: this.unit.owner,
                            damage: this.params.attackDamage,
                            sourcePosition: from,
                            bopStrength: 35,
                            fallbackDirection: new BABYLON.Vector3(dx, 0, dz)
                        });
                    }
                    window.projectiles.fire({
                        type: 'arrow',
                        from: from,
                        to: to,
                        damage: this.params.attackDamage,
                        owner: this.unit.owner,
                        gameplayImpact: false
                    });
                } else {
                    // Melee: apply damage directly
                    const newHealth = Math.max(0, (target.currentHealth ?? target.health ?? 0) - this.params.attackDamage);
                    if (typeof target.health === 'number') target.health = newHealth;
                    if (typeof target.currentHealth === 'number') target.currentHealth = newHealth;

                    if (window.UnitSpeech && window.UnitSpeech.showDamage) {
                        window.UnitSpeech.showDamage(target, this.params.attackDamage);
                    }

                    // Bop the target for impact feel
                    if (target.pb && target.pb.imp && distance > 0.01) {
                        const bopStrength = 120;
                        const ndx = dx / distance;
                        const ndz = dz / distance;
                        target.pb.imp.x += ndx * bopStrength;
                        target.pb.imp.z += ndz * bopStrength;
                    }

                    if (newHealth <= 0 && typeof window.onUnitDeath === 'function') {
                        window.onUnitDeath(target, this.unit.owner);
                    }
                }
            }

            // Spin animation during attack wind-up
            const isSwinging = ticksSinceAttack < this.cooldownTicks * 0.3;
            if (isSwinging) {
                this.unit.pb.state.rot.y += 0.3;
            } else {
                this.unit.pb.state.rot.y = currentRot + rotDiff * 0.3;
            }
            if (this.unit.pb.rotVel) this.unit.pb.rotVel.y = 0;

            // Orbit slightly to look natural in melee
            if (this.params.attackType === 'melee') {
                const idHash = (this.unit.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
                const angle = ((currentTick * 0.12) + (idHash % 100) * 0.01) % (Math.PI * 2);
                const orbitR = 1.2;
                const orbitX = targetLoc.x + Math.cos(angle) * orbitR;
                const orbitZ = targetLoc.z + Math.sin(angle) * orbitR;
                const dir = { x: orbitX - unitLoc.x, z: orbitZ - unitLoc.z };
                const len = Math.sqrt(getStableDistanceSq(unitLoc, { x: orbitX, z: orbitZ }));
                if (len > 0.05) {
                    dir.x = Math.round((dir.x / len) * 10000) / 10000;
                    dir.z = Math.round((dir.z / len) * 10000) / 10000;
                    this.applyMovementWithRotation(dir, this.unit.speed * 0.35);
                }
            }
        } else {
            // Move towards target
            const dir = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
            const chaseSpeed = this.params.attackType === 'ranged'
                ? (this.unit.speed || 20) * 0.7
                : (this.unit.speed || 20);
            this.applyMovementWithRotation(dir, chaseSpeed);
        }

        return false;
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
            
            const length = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, nearestBuilding.position));
            if (length > 0.1) {
                direction.x = Math.round((direction.x / length) * 10000) / 10000;
                direction.z = Math.round((direction.z / length) * 10000) / 10000;
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
        const distance = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, this.inspectionTarget.position));
        
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
                        
                        if (window.currentMatch && typeof window.currentMatch.queueResourceCredit === 'function') {
                            window.currentMatch.queueResourceCredit(engineerOwner, 'wood', 5, window.currentMatch.tick || 0);
                        } else if (player && player.addResource) {
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
                        
                        // Only consider buildings that have completed their synchronized transition.
                        if (!building.completionProcessed) continue;
                        
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
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
            this.applyMovementWithRotation(direction, this.params.workSpeed);
        }
    }
    
    returnToBase(currentTime) {
        if (!this.building || !this.building.position) return;
        
        const TILE_SIZE = window.TILE_SIZE || 4;
        
        // Move back to base building
        const dx = this.building.position.x - this.unit.pb.state.loc.x;
        const dz = this.building.position.z - this.unit.pb.state.loc.z;
        const distance = Math.sqrt(getStableDistanceSq(this.unit.pb.state.loc, this.building.position));
        
        if (distance > TILE_SIZE * 2) {
            // Move towards base
            const direction = {
                x: distance > 0.001 ? Math.round((dx / distance) * 10000) / 10000 : 0,
                z: distance > 0.001 ? Math.round((dz / distance) * 10000) / 10000 : 0
            };
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
            
            const distance = Math.sqrt(getStableDistanceSq(this.building.position, building.position));
            
            if (distance <= inspectionRadius && (
                distance < nearestDistance ||
                (distance === nearestDistance && window.deterministicStringCompare((building.id || ''), (nearestBuilding?.id || '')) < 0)
            )) {
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
        
        // CRITICAL: Use fixed reference tick (0) to ensure determinism across clients
        // If we use current tick, behaviors created at different times will diverge
        this.startTick = 0;
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

function getDebugUnitIdentity(unit) {
    if (!unit) return null;
    if (!window.__nextDebugUnitObjectId) {
        window.__nextDebugUnitObjectId = 1;
    }
    if (!unit._debugObjectId) {
        unit._debugObjectId = `obj-${window.__nextDebugUnitObjectId++}`;
    }
    return unit._debugObjectId;
}

window.getDebugUnitIdentity = getDebugUnitIdentity;

// Behavior manager for units
class UnitBehaviorManager {
    constructor() {
        this.behaviors = new Map(); // unit -> current behavior
    }
    
    // Set a unit's active behavior
    setBehavior(unit, behaviorType, params = {}) {
        // Handle registry-driven abilities as modifiers/effects.
        const currentTick = getCurrentMatchTick();
        unit._abilityCooldowns = unit._abilityCooldowns || {};
        const abilitySpec = window.UnitAbilityRegistry?.getSpec?.(behaviorType);

        if (abilitySpec) {
            const nextReadyTick = unit._abilityCooldowns[behaviorType] || 0;
            if (currentTick < nextReadyTick) {
                return;
            }
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
            case 'manual_gather':
                if (params.targetResource) {
                    behavior = new ManualGatherBehavior(unit, params.targetResource, params);
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
            case 'attack_unit':
                if (params.target || params.targetUnit) {
                    behavior = new AttackUnitBehavior(unit, params.target || params.targetUnit, params);
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
            this.traceBehaviorMutation('setBehavior', unit, {
                newBehavior: behavior.constructor?.name || behaviorType,
                previousBehavior: currentBehavior?.constructor?.name || 'none'
            });
            // CRITICAL: Smart transition - check if unit is already moving in similar direction
            // If so, smoothly update target instead of resetting velocity (prevents jerky movement)
            const wasMovingBehavior = currentBehavior && 
                (currentBehavior instanceof WalkBehavior || currentBehavior instanceof RunBehavior);
            const isNewMovingBehavior = behavior instanceof WalkBehavior || behavior instanceof RunBehavior;
            
            const deterministicReset = params.forceDeterministicReset === true;
            if (!deterministicReset && wasMovingBehavior && isNewMovingBehavior && unit.pb && unit.pb.state) {
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
                if (deterministicReset) {
                    unit.pb.state.vel.x = 0;
                    unit.pb.state.vel.z = 0;
                    if (!unit.pb.imp) unit.pb.imp = { x: 0, y: 0, z: 0 };
                    unit.pb.imp.x = 0;
                    unit.pb.imp.z = 0;
                    if (!unit.pb.rotImp) unit.pb.rotImp = { x: 0, y: 0, z: 0 };
                    unit.pb.rotImp.x = 0;
                    unit.pb.rotImp.y = 0;
                    unit.pb.rotImp.z = 0;
                    if (!unit.pb.rotVel) unit.pb.rotVel = { x: 0, y: 0, z: 0 };
                    unit.pb.rotVel.x = 0;
                    unit.pb.rotVel.y = 0;
                    unit.pb.rotVel.z = 0;
                    return;
                }
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

    traceBehaviorMutation(stage, unit, details = {}) {
        if (!window.currentMatch?.isLiveMultiplayerMatch?.() || !unit) return;
        const normalizeId = (id) => {
            if (!id) return '';
            const str = typeof id === 'string' ? id : String(id);
            return str.length > 6 ? str.slice(-6) : str;
        };
        const currentBehavior = this.behaviors.get(unit);
        console.log(`🧠 BEHAVIOR TRACE ${stage}`, {
            tick: window.currentMatch?.tick || 0,
            unitId: unit.id || null,
            objectId: getDebugUnitIdentity(unit),
            owner: unit.owner || null,
            ownerNorm: normalizeId(unit.owner || ''),
            localPlayerId: window.currentMatch?.localPlayerId || null,
            localPlayerNorm: normalizeId(window.currentMatch?.localPlayerId || ''),
            windowPlayerId: window.player?.id || null,
            windowPlayerNorm: normalizeId(window.player?.id || ''),
            currentBehavior: currentBehavior?.constructor?.name || 'none',
            ...details
        });
    }

    deleteBehaviorDirect(unit, stage = 'direct-delete', details = {}) {
        if (!unit) return;
        this.traceBehaviorMutation(stage, unit, {
            previousBehavior: this.behaviors.get(unit)?.constructor?.name || 'none',
            ...details
        });
        this.behaviors.delete(unit);
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
                return window.deterministicStringCompare(idA, idB);
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
                    // Only delete if the behavior hasn't been replaced during step()
                    // (e.g. EatBehavior restores a previous behavior before completing)
                    if (this.behaviors.get(unit) === behavior) {
                        this.traceBehaviorMutation('step-complete-delete', unit, {
                            completedBehavior: behavior?.constructor?.name || 'unknown'
                        });
                        this.deleteBehaviorDirect(unit, 'step-complete-delete-apply', {
                            completedBehavior: behavior?.constructor?.name || 'unknown'
                        });
                    }
                    
                    // After movement completes, give units a subtle idle/linger behavior to spread out
                    // Only apply to player/AI units that just finished moving (not working/gathering)
                    const isPlayerUnit = unit.owner !== 'neutral';
                    const wasMoving = behavior instanceof WalkBehavior || behavior instanceof RunBehavior;
                    
                    if (isPlayerUnit && wasMoving && unit.pb && unit.pb.state) {
                        const currentTick = window.currentMatch?.tick || 0;
                        const loc = unit.pb.state.loc;
                        
                        // Just linger where they arrive
                        // TODO: Add proper resource return behavior when idle
                        this.setBehavior(unit, 'linger', { 
                            center: { x: loc.x, z: loc.z }, 
                            radius: 50,  // Can roam freely
                            wanderDistance: 2.0,
                            wanderInterval: 30000,  // Match idle villager pace
                            startImmediately: false  // Don't wander immediately after arrival
                        });
                    }
                }
            }
            
            // Step special ability modifiers
            if (unit._specialModifiers) {
                const modifierTypes = Object.keys(unit._specialModifiers).sort((a, b) => window.deterministicStringCompare
                    ? window.deterministicStringCompare(a, b)
                    : a.localeCompare(b));
                modifierTypes.forEach(modifierType => {
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
        this.deleteBehaviorDirect(unit, 'clearBehavior-delete');
        this.setBehavior(unit, 'linger');
    }
    
    // Add a special ability as a modifier (doesn't replace existing behavior)
    addSpecialAbilityModifier(unit, abilityType, params = {}) {
        unit._specialModifiers = unit._specialModifiers || {};
        const abilitySpec = window.UnitAbilityRegistry?.getSpec?.(abilityType);
        if (!abilitySpec || typeof abilitySpec.createRuntime !== 'function') {
            return;
        }

        const previousModifier = unit._specialModifiers[abilityType];
        if (previousModifier?.onReassignment) {
            previousModifier.onReassignment();
        }

        const modifier = abilitySpec.createRuntime(unit, params, abilitySpec);
        if (modifier) {
            unit._specialModifiers[abilityType] = modifier;
            const currentTick = getCurrentMatchTick();
            const cooldownTicks = Number.isFinite(abilitySpec.cooldownTicks) ? abilitySpec.cooldownTicks : 0;
            unit._abilityCooldowns[abilityType] = currentTick + cooldownTicks;
        }
    }
    
}

// Ability effect families
function holdUnitPosition(unit) {
    const loc = unit?.pb?.state?.loc;
    const manager = window.behaviorManager || behaviorManager;
    if (!loc || !manager) return;
    manager.setBehavior(unit, 'linger', {
        center: { x: loc.x, z: loc.z },
        radius: 0.01,
        wanderDistance: 0.01,
        wanderInterval: 999999,
        startImmediately: false
    });
    if (unit.pb?.state?.vel) {
        unit.pb.state.vel.x = 0;
        unit.pb.state.vel.z = 0;
    }
}

function applyDirectDamage(unit, damage, attackerOwner) {
    if (!unit || !Number.isFinite(damage) || damage <= 0) return;
    const current = Number.isFinite(unit.currentHealth) ? unit.currentHealth : unit.health;
    if (!Number.isFinite(current)) return;
    const next = Math.max(0, current - damage);
    if (typeof unit.health === 'number') unit.health = next;
    if (typeof unit.currentHealth === 'number') unit.currentHealth = next;
    if (window.UnitSpeech?.showDamage) {
        window.UnitSpeech.showDamage(unit, damage);
    }
    if (next <= 0 && typeof window.onUnitDeath === 'function') {
        window.onUnitDeath(unit, attackerOwner);
    }
}

function applyUnitHealing(unit, amount) {
    if (!isUnitAlive(unit) || !Number.isFinite(amount) || amount <= 0) return 0;
    const maxHealth = Number.isFinite(unit.maxHealth)
        ? unit.maxHealth
        : (window.UnitTypes?.[unit.type]?.health || unit.health || 0);
    const current = Number.isFinite(unit.currentHealth)
        ? unit.currentHealth
        : (Number.isFinite(unit.health) ? unit.health : maxHealth);
    if (!Number.isFinite(maxHealth) || maxHealth <= 0 || !Number.isFinite(current)) return 0;
    const next = Math.min(maxHealth, current + amount);
    const healed = Math.max(0, next - current);
    if (healed <= 0) return 0;
    if (typeof unit.health === 'number') unit.health = next;
    if (typeof unit.currentHealth === 'number') unit.currentHealth = next;
    if (window.UnitSpeech?.showHeal) {
        window.UnitSpeech.showHeal(unit, healed);
    }
    return healed;
}

function createAbilityPulseFx(point, effectType = 'particle', options = {}) {
    if ((!window.fx?.createParticleEffect && !window.fx?.createTransientParticleEffect) || !point) return;
    try {
        const effectOptions = Object.assign({}, options);
        if (!Number.isFinite(effectOptions.durationMs)) {
            effectOptions.durationMs = 450;
        }
        if (effectOptions.durationMs > 0 && window.fx?.createTransientParticleEffect) {
            window.fx.createTransientParticleEffect(effectType, createWorldVector(point), effectOptions);
        } else {
            delete effectOptions.durationMs;
            window.fx.createParticleEffect(effectType, createWorldVector(point), effectOptions);
        }
    } catch (_) {
        // Visual only
    }
}

function applyAreaImpactFromPoint(sourceUnit, centerPoint, radius, damage, options = {}) {
    const sourcePosition = options.sourcePosition || centerPoint;
    const bopStrength = Number.isFinite(options.bopStrength) ? options.bopStrength : 0;
    const targets = getUnitsInRadius(centerPoint, radius, other => other !== sourceUnit && isHostileToUnit(sourceUnit, other));
    targets.forEach(target => {
        const targetLoc = target.pb?.state?.loc;
        const fallbackDirection = targetLoc
            ? new BABYLON.Vector3(targetLoc.x - centerPoint.x, 0, targetLoc.z - centerPoint.z)
            : null;
        if (window.projectiles?.applyImpact) {
            window.projectiles.applyImpact({
                unit: target,
                attackerOwner: sourceUnit?.owner || null,
                damage,
                sourcePosition: createWorldVector(sourcePosition),
                bopStrength,
                fallbackDirection
            });
        } else {
            applyDirectDamage(target, damage, sourceUnit?.owner || null);
            if (bopStrength > 0 && target?.pb?.imp && fallbackDirection?.lengthSquared() > 0.0001) {
                target.pb.imp.addInPlace(fallbackDirection.normalize().scale(bopStrength));
            }
        }
    });
    return targets;
}

function applyAreaBuildingImpactFromPoint(sourceUnit, centerPoint, radius, damage, options = {}) {
    const targets = getHostileBuildingsInRadius(sourceUnit, centerPoint, radius);
    targets.forEach(building => {
        const current = Number.isFinite(building.health) ? building.health : building.currentHealth;
        if (!Number.isFinite(current)) return;
        const next = Math.max(0, current - damage);
        if (typeof building.health === 'number') building.health = next;
        if (typeof building.currentHealth === 'number') building.currentHealth = next;
        if (!options.skipDamageFx && window.fx?.addBuildingDamageEffects) {
            window.fx.addBuildingDamageEffects(building);
        }
        if (next <= 0 && window.fx?.destroyBuilding) {
            window.fx.destroyBuilding(building);
        }
    });
    return targets;
}

function executeFireballImpact(sourceUnit, centerPoint, params = {}) {
    const stableCenter = getStableAbilityCenterPoint(centerPoint || getUnitWorldPoint(sourceUnit));
    if (!stableCenter) {
        return { hitUnits: 0, hitBuildings: 0, ignitedTrees: 0 };
    }

    const impactRadius = params.impactRadius || ((window.TILE_SIZE || 4) * 1.25);
    const unitDamage = Math.max(1, Math.round(params.unitDamage || (sourceUnit?.attackDamage || 11) * 1.35));
    const buildingDamage = Math.max(unitDamage, Math.round(params.buildingDamage || unitDamage * 1.6));
    const burnDurationTicks = Math.max(1, Number.isFinite(params.burnDurationTicks) ? params.burnDurationTicks : 120);
    const burnIntervalTicks = Math.max(1, Number.isFinite(params.burnIntervalTicks) ? params.burnIntervalTicks : 20);
    const buildingBurnDamage = Math.max(1, Number.isFinite(params.buildingBurnDamage) ? params.buildingBurnDamage : 6);
    const treeBurnDamage = Math.max(1, Number.isFinite(params.treeBurnDamage) ? params.treeBurnDamage : 4);

    const hitUnits = applyAreaImpactFromPoint(sourceUnit, stableCenter, impactRadius, unitDamage, {
        sourcePosition: getUnitWorldPoint(sourceUnit),
        bopStrength: Number.isFinite(params.bopStrength) ? params.bopStrength : 45
    });
    const hitBuildings = applyAreaBuildingImpactFromPoint(sourceUnit, stableCenter, impactRadius, buildingDamage, {
        skipDamageFx: true
    });

    const match = window.currentMatch;
    let ignitedTrees = 0;
    if (match?.igniteTreesInRadius) {
        ignitedTrees = match.igniteTreesInRadius(stableCenter, Number.isFinite(params.treeIgniteRadius) ? params.treeIgniteRadius : impactRadius, {
            burnDurationTicks,
            burnIntervalTicks,
            treeBurnDamage
        });
    }
    if (match?.igniteBuilding) {
        hitBuildings.forEach(building => {
            if (!building || building.isDestroyed || !Number.isFinite(building.health) || building.health <= 0) return;
            match.igniteBuilding(building, {
                burnDurationTicks,
                burnIntervalTicks,
                buildingBurnDamage
            });
        });
    }

    return {
        hitUnits: hitUnits.length,
        hitBuildings: hitBuildings.length,
        ignitedTrees
    };
}

function applyAreaHealFromPoint(sourceUnit, centerPoint, radius, amount, options = {}) {
    const includeSelf = options.includeSelf !== false;
    const targets = getUnitsInRadius(centerPoint, radius, other => {
        if (!includeSelf && other === sourceUnit) return false;
        return other.owner === sourceUnit.owner;
    });
    let healedAny = false;
    targets.forEach(target => {
        if (applyUnitHealing(target, amount) > 0) {
            healedAny = true;
        }
    });
    return healedAny;
}

const VOLLEY_PATTERN_OFFSETS = [
    { x: 0, z: 0 },
    { x: -1, z: 0 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: 0, z: 1 },
    { x: -0.75, z: -0.75 },
    { x: 0.75, z: -0.75 },
    { x: -0.75, z: 0.75 },
    { x: 0.75, z: 0.75 }
];

function getVolleyOffset(index, radius) {
    const basis = VOLLEY_PATTERN_OFFSETS[index % VOLLEY_PATTERN_OFFSETS.length];
    const ring = Math.floor(index / VOLLEY_PATTERN_OFFSETS.length);
    const scale = radius * (1 + ring * 0.35);
    return {
        x: basis.x * scale,
        z: basis.z * scale
    };
}

class TimedModifierEffect {
    constructor(unit, params = {}, spec = {}) {
        this.unit = unit;
        this.params = params;
        this.spec = spec;
        this.startTick = getCurrentMatchTick();
        this.durationTicks = getAbilityDurationTicks(params, spec);
        this._initialized = false;
        this._cleanedUp = false;
    }

    initialize() {
        if (this._initialized) return this;
        this._initialized = true;
        if (typeof this.onStart === 'function') {
            this.onStart();
        }
        return this;
    }

    isExpired(currentTick) {
        return this.durationTicks > 0 && (currentTick - this.startTick) > this.durationTicks;
    }

    cleanup() {
        if (this._cleanedUp) return;
        this._cleanedUp = true;
        if (typeof this.onEnd === 'function') {
            this.onEnd();
        }
    }

    step() {
        this.initialize();
        const currentTick = getCurrentMatchTick();
        if (typeof this.onActiveTick === 'function' && this.onActiveTick(currentTick) === true) {
            this.cleanup();
            return true;
        }
        if (this.isExpired(currentTick)) {
            this.cleanup();
            return true;
        }
        return false;
    }

    onReassignment() {
        this.cleanup();
    }
}

class PointCastEffect extends TimedModifierEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.targetPoint = getAbilityPointTarget(params, getUnitWorldPoint(unit));
        this.castDelayTicks = Number.isFinite(params.castDelayTicks)
            ? params.castDelayTicks
            : (Number.isFinite(spec.castDelayTicks) ? spec.castDelayTicks : 0);
        this.lockMovementDuringCast = params.lockMovementDuringCast ?? spec.lockMovementDuringCast ?? false;
        this._castStarted = false;
    }

    onStart() {
        if (this.lockMovementDuringCast) {
            holdUnitPosition(this.unit);
        }
    }

    onActiveTick(currentTick) {
        const elapsed = currentTick - this.startTick;
        if (!this._castStarted && elapsed >= this.castDelayTicks) {
            this._castStarted = true;
            if (typeof this.onCastStart === 'function') {
                this.onCastStart(currentTick, elapsed);
            }
        }
        if (typeof this.onCastTick === 'function') {
            return this.onCastTick(currentTick, elapsed);
        }
        return false;
    }
}

class AreaPulseEffect extends TimedModifierEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.pulseIntervalTicks = Math.max(1, Number.isFinite(params.pulseIntervalTicks)
            ? params.pulseIntervalTicks
            : (Number.isFinite(spec.pulseIntervalTicks) ? spec.pulseIntervalTicks : 1));
        this.maxPulses = Math.max(1, Number.isFinite(params.maxPulses)
            ? params.maxPulses
            : (Number.isFinite(spec.maxPulses) ? spec.maxPulses : 1));
        this.initialDelayTicks = Math.max(0, Number.isFinite(params.initialDelayTicks)
            ? params.initialDelayTicks
            : (Number.isFinite(spec.initialDelayTicks) ? spec.initialDelayTicks : 0));
        this._nextPulseTick = this.startTick + this.initialDelayTicks;
        this._pulsesEmitted = 0;
        if (!this.durationTicks) {
            this.durationTicks = this.initialDelayTicks + (this.pulseIntervalTicks * this.maxPulses);
        }
    }

    onActiveTick(currentTick) {
        while (this._pulsesEmitted < this.maxPulses && currentTick >= this._nextPulseTick) {
            if (typeof this.emitPulse === 'function') {
                this.emitPulse(currentTick, this._pulsesEmitted);
            }
            this._pulsesEmitted += 1;
            this._nextPulseTick += this.pulseIntervalTicks;
        }
        return this._pulsesEmitted >= this.maxPulses;
    }
}

class BrigandSprintBehavior extends TimedModifierEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.speedMultiplier = params.speedMultiplier || 2.0;
        this.targetPoint = getAbilityPointTarget(params);
        this.modifierKey = `${spec.id || 'brigand_sprint'}:${unit.id}:${this.startTick}`;
    }

    onStart() {
        setUnitStatModifier(this.unit, 'speed', this.modifierKey, { multiplier: this.speedMultiplier });
        if (this.targetPoint) {
            const manager = window.behaviorManager || behaviorManager;
            manager?.setBehavior(this.unit, 'run', {
                targetPoint: this.targetPoint,
                applyPersonalityOffset: false,
                forceDeterministicReset: true
            });
        }
    }

    onEnd() {
        clearUnitStatModifier(this.unit, 'speed', this.modifierKey);
    }
}

class MonkStealthBehavior extends TimedModifierEffect {
    onStart() {
        this.unit.isStealthed = true;
        if (this.unit.mesh) {
            this.unit._origAlpha = this.unit.mesh.visibility !== undefined ? this.unit.mesh.visibility : 1;
            this.unit.mesh.visibility = 0.4;
        }
    }

    onEnd() {
        this.unit.isStealthed = false;
        if (this.unit.mesh && this.unit._origAlpha !== undefined) {
            this.unit.mesh.visibility = this.unit._origAlpha;
        }
    }
}

class MonkKickBehavior extends AreaPulseEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, {
            maxPulses: 1,
            pulseIntervalTicks: 1,
            initialDelayTicks: 0,
            ...params
        }, spec);
        this.radius = params.radius || 4;
        this.basePower = params.power || 160;
    }

    emitPulse() {
        if (!this.unit?.pb?.state?.loc) return;
        const origin = this.unit.pb.state.loc.clone();
        const targets = getUnitsInRadius(origin, this.radius, other => other !== this.unit && isHostileToUnit(this.unit, other));
        targets.forEach(other => {
            if (!other?.pb?.state?.loc || !other?.pb?.imp) return;
            const pos = other.pb.state.loc.clone();
            const dx = pos.x - origin.x;
            const dz = pos.z - origin.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= 0 || dist > this.radius) return;

            const dir = new BABYLON.Vector3(dx / dist, 0, dz / dist);
            const strength = this.basePower * (1 - dist / this.radius);
            other.pb.imp.addInPlace(dir.scale(strength));

            if (!other._monkKickArc) {
                other._monkKickArc = {
                    startTick: getCurrentMatchTick(),
                    durationTicks: Math.floor(400 / 1000 * 20),
                    peakHeight: 2.0,
                    startY: other.pb.state.loc.y || 0
                };
            }
        });

        if (targets.length > 0) {
            createAbilityPulseFx(getUnitWorldPoint(this.unit), 'particle', {
                scale: 0.4,
                emitRate: 40,
                minSize: 0.2,
                maxSize: 0.4
            });
        }
    }
}

class ChargeBehavior extends TimedModifierEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.targetPoint = getAbilityPointTarget(params, getUnitWorldPoint(unit));
        this.speedMultiplier = params.speedMultiplier || 1.9;
        this.impactRadius = params.impactRadius || ((window.TILE_SIZE || 4) * 0.75);
        this.damageMultiplier = params.damageMultiplier || 1.65;
        this.bopStrength = params.bopStrength || 130;
        this.impactResolveRadius = params.impactResolveRadius || this.impactRadius;
        this.hasResolvedImpact = false;
        this.modifierKey = `${spec.id || 'charge'}:${unit.id}:${this.startTick}`;
    }

    onStart() {
        setUnitStatModifier(this.unit, 'speed', this.modifierKey, { multiplier: this.speedMultiplier });
        const manager = window.behaviorManager || behaviorManager;
        if (this.targetPoint && manager) {
            manager.setBehavior(this.unit, 'run', {
                targetPoint: this.targetPoint,
                applyPersonalityOffset: false,
                forceDeterministicReset: true
            });
        }
    }

    onActiveTick() {
        const loc = this.unit?.pb?.state?.loc;
        if (!loc) return true;
        if (!this.targetPoint) {
            return true;
        }

        if (getStableDistanceSq(loc, this.targetPoint) <= this.impactResolveRadius * this.impactResolveRadius) {
            return this.resolveImpactAtTargetPoint();
        }

        return false;
    }

    resolveImpactAtTargetPoint() {
        if (this.hasResolvedImpact || !this.targetPoint) {
            return true;
        }
        this.hasResolvedImpact = true;

        const impactPoint = {
            x: Math.round(this.targetPoint.x * 1000) / 1000,
            z: Math.round(this.targetPoint.z * 1000) / 1000
        };
        const targets = getUnitsInRadius(impactPoint, this.impactRadius, other => other !== this.unit && isHostileToUnit(this.unit, other));

        if (targets.length > 0) {
            const impactDamage = Math.max(1, Math.round((this.unit.attackDamage || 10) * this.damageMultiplier));
            applyAreaImpactFromPoint(this.unit, impactPoint, this.impactRadius, impactDamage, {
                sourcePosition: getUnitWorldPoint(this.unit),
                bopStrength: this.bopStrength
            });
            createAbilityPulseFx(impactPoint, 'particle', {
                scale: 0.35,
                emitRate: 30,
                minSize: 0.2,
                maxSize: 0.35
            });
            const target = targets[0];
            const manager = window.behaviorManager || behaviorManager;
            manager?.setBehavior(this.unit, 'attack_unit', {
                target,
                targetUnit: target
            });
        }

        return true;
    }

    onEnd() {
        clearUnitStatModifier(this.unit, 'speed', this.modifierKey);
    }
}

class VolleyBehavior extends PointCastEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.shotCount = params.shotCount || 5;
        this.shotIntervalTicks = Math.max(1, params.shotIntervalTicks || 3);
        this.impactRadius = params.impactRadius || ((window.TILE_SIZE || 4) * 0.75);
        this.patternRadius = params.patternRadius || ((window.TILE_SIZE || 4) * 0.6);
        this.damage = Math.max(1, Math.round(params.damage || (unit.attackDamage || 8) * 0.8));
        this.projectileType = params.projectileType || 'arrow';
        this._shotsFired = 0;
        if (!this.durationTicks) {
            this.durationTicks = this.castDelayTicks + (this.shotIntervalTicks * (this.shotCount + 1));
        }
    }

    fireShot(shotIndex) {
        const origin = this.unit?.pb?.state?.loc;
        if (!origin || !this.targetPoint) return;
        const offset = getVolleyOffset(shotIndex, this.patternRadius);
        const impactPoint = {
            x: this.targetPoint.x + offset.x,
            z: this.targetPoint.z + offset.z
        };
        if (window.projectiles?.fire) {
            window.projectiles.fire({
                type: this.projectileType,
                from: new BABYLON.Vector3(origin.x, 1.5, origin.z),
                to: new BABYLON.Vector3(impactPoint.x, 1.0, impactPoint.z),
                damage: this.damage,
                owner: this.unit.owner,
                gameplayImpact: false
            });
        }
        applyAreaImpactFromPoint(this.unit, impactPoint, this.impactRadius, this.damage, {
            sourcePosition: getUnitWorldPoint(this.unit),
            bopStrength: 35
        });
        createAbilityPulseFx(impactPoint, 'particle', {
            scale: 0.25,
            emitRate: 22,
            minSize: 0.12,
            maxSize: 0.3
        });
    }

    onCastTick(currentTick) {
        if (!this._castStarted) return false;
        const elapsedSinceCast = currentTick - (this.startTick + this.castDelayTicks);
        while (this._shotsFired < this.shotCount && elapsedSinceCast >= this._shotsFired * this.shotIntervalTicks) {
            this.fireShot(this._shotsFired);
            this._shotsFired += 1;
        }
        return this._shotsFired >= this.shotCount;
    }
}

class WizardCastBehavior extends PointCastEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        if (!this.durationTicks) {
            this.durationTicks = 40;
        }
    }

    onCastStart() {
        const point = this.targetPoint || getUnitWorldPoint(this.unit);
        if (window.fx?.createExplosion) {
            try {
                window.fx.createExplosion(createWorldVector(point), 0.2);
            } catch (e) {
                console.error('Explosion creation failed:', e);
            }
        }
    }
}

class FireballBehavior extends PointCastEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.projectileType = params.projectileType || 'fireball';
        this.projectileSpeed = Number.isFinite(params.projectileSpeed) ? params.projectileSpeed : 14;
        this.projectileLifetimePadding = Number.isFinite(params.projectileLifetimePadding) ? params.projectileLifetimePadding : 0.15;
        this.impactDelayTicks = this.computeImpactDelayTicks();
        this._impactResolved = false;
        this._impactFxPlayed = false;
        this.durationTicks = Math.max(this.durationTicks || 0, this.castDelayTicks + this.impactDelayTicks + 2);
    }

    computeImpactDelayTicks() {
        const origin = this.unit?.pb?.state?.loc;
        if (!origin || !this.targetPoint) return 1;
        const distance = Math.sqrt(getStableDistanceSq(origin, this.targetPoint));
        const totalTravelSeconds = (distance / Math.max(0.1, this.projectileSpeed)) + this.projectileLifetimePadding;
        return Math.max(1, Math.round(totalTravelSeconds * (window.net?.TICK_RATE || 20)));
    }

    playImpactFx(point) {
        if (this._impactFxPlayed) return;
        this._impactFxPlayed = true;
        if (window.fx?.createExplosion) {
            window.fx.createExplosion(createWorldVector(point, 0.35), 0.35);
        }
        createAbilityPulseFx(point, 'burn_fire', {
            scale: 0.42,
            emitRate: 34,
            minSize: 0.18,
            maxSize: 0.42,
            durationMs: 500
        });
    }

    onCastStart() {
        const origin = this.unit?.pb?.state?.loc;
        if (!origin || !this.targetPoint || !window.projectiles?.fire) return;

        window.projectiles.fire({
            type: this.projectileType,
            from: new BABYLON.Vector3(origin.x, 1.6, origin.z),
            to: new BABYLON.Vector3(this.targetPoint.x, 0.8, this.targetPoint.z),
            owner: this.unit.owner,
            gameplayImpact: false,
            speed: this.projectileSpeed,
            lifetimePadding: this.projectileLifetimePadding,
            onMiss: (hitPos) => {
                this.playImpactFx({ x: hitPos.x, z: hitPos.z });
            }
        });
    }

    onCastTick(currentTick, elapsed) {
        if (!this._castStarted) return false;
        if (!this._impactResolved && elapsed >= (this.castDelayTicks + this.impactDelayTicks)) {
            const impactPoint = this.targetPoint || getUnitWorldPoint(this.unit);
            this.playImpactFx(impactPoint);
            executeFireballImpact(this.unit, impactPoint, this.params);
            this._impactResolved = true;
        }
        return this._impactResolved;
    }
}

class SporeBloomBehavior extends PointCastEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this._resolved = false;
        if (!this.durationTicks) {
            this.durationTicks = this.castDelayTicks + 2;
        }
    }

    onCastStart() {
        executeSporeBloomEffect(this.unit, this.targetPoint || getUnitWorldPoint(this.unit), this.params);
        this._resolved = true;
    }

    onCastTick() {
        return this._resolved;
    }
}

class HealPulseBehavior extends AreaPulseEffect {
    constructor(unit, params = {}, spec = {}) {
        super(unit, params, spec);
        this.radius = params.radius || ((window.TILE_SIZE || 4) * 2.5);
        this.healAmount = params.healAmount || 6;
        this.includeSelf = params.includeSelf !== false;
    }

    emitPulse() {
        const centerPoint = getUnitWorldPoint(this.unit);
        const healedAny = applyAreaHealFromPoint(this.unit, centerPoint, this.radius, this.healAmount, {
            includeSelf: this.includeSelf
        });
        if (healedAny) {
            createAbilityPulseFx(centerPoint, 'particle', {
                scale: 0.35,
                emitRate: 28,
                minSize: 0.18,
                maxSize: 0.32
            });
        }
    }
}

class EngineerProductivityBoostBehavior extends TimedModifierEffect {}

const registeredAbilitySpecs = {};

function registerAbilitySpec(spec) {
    if (!spec?.id) return null;
    registeredAbilitySpecs[spec.id] = spec;
    return spec;
}

const UnitAbilityRegistry = {
    registerSpec: registerAbilitySpec,
    getSpec(id) {
        return registeredAbilitySpecs[id] || null;
    },
    listSpecs() {
        return Object.values(registeredAbilitySpecs);
    }
};

registerAbilitySpec({
    id: 'brigand_sprint',
    label: 'Sprint',
    icon: '💨',
    order: 20,
    commandable: true,
    primary: true,
    targetType: 'point',
    executionKind: 'timed_modifier',
    cooldownTicks: 120,
    durationTicks: 120,
    allowedUnitTypes: ['brigand'],
    buildParams(unit, worldPos) {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        return { targetPoint, speedMultiplier: 2.0 };
    },
    createRuntime(unit, params, spec) {
        return new BrigandSprintBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'monk_stealth',
    label: 'Stealth',
    icon: '👤',
    order: 50,
    commandable: false,
    targetType: 'self',
    executionKind: 'timed_modifier',
    cooldownTicks: 160,
    durationTicks: 80,
    buildParams() {
        return {};
    },
    createRuntime(unit, params, spec) {
        return new MonkStealthBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'monk_kick',
    label: 'Kick',
    icon: '🦶',
    order: 60,
    commandable: true,
    primary: false,
    targetType: 'self',
    executionKind: 'area_pulse',
    cooldownTicks: 40,
    allowedUnitTypes: ['monk', 'paladin'],
    defaultParams: {
        radius: (window.TILE_SIZE || 4),
        power: 160
    },
    buildParams() {
        return {};
    },
    createRuntime(unit, params, spec) {
        return new MonkKickBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'wizard_cast',
    label: 'Arc Blast',
    icon: '✨',
    order: 30,
    commandable: true,
    primary: true,
    targetType: 'point',
    executionKind: 'point_cast',
    cooldownTicks: 60,
    durationTicks: 40,
    castDelayTicks: 4,
    allowedUnitTypes: ['wizard'],
    buildParams(unit, worldPos) {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        return { targetPoint };
    },
    createRuntime(unit, params, spec) {
        return new WizardCastBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'warlock_fireball',
    label: 'Fireball',
    icon: '🔥',
    order: 14,
    commandable: true,
    primary: true,
    targetType: 'point',
    executionKind: 'point_cast',
    cooldownTicks: 95,
    castDelayTicks: 5,
    durationTicks: 32,
    lockMovementDuringCast: true,
    allowedUnitTypes: ['warlock'],
    buildParams(unit, worldPos) {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        return {
            targetPoint,
            projectileType: 'fireball',
            projectileSpeed: 14,
            projectileLifetimePadding: 0.15,
            impactRadius: (window.TILE_SIZE || 4) * 1.25,
            treeIgniteRadius: (window.TILE_SIZE || 4) * 1.35,
            unitDamage: Math.max(1, Math.round((unit?.attackDamage || 11) * 1.35)),
            buildingDamage: Math.max(1, Math.round((unit?.attackDamage || 11) * 2.0)),
            burnDurationTicks: 120,
            burnIntervalTicks: 20,
            buildingBurnDamage: 6,
            treeBurnDamage: 4,
            bopStrength: 45
        };
    },
    createRuntime(unit, params, spec) {
        return new FireballBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'spore_bloom',
    label: 'Spore',
    icon: '🍄',
    order: 12,
    commandable: true,
    primary: true,
    targetType: 'point',
    executionKind: 'point_cast',
    cooldownTicks: 120,
    durationTicks: 12,
    castDelayTicks: 6,
    lockMovementDuringCast: true,
    allowedUnitTypes: ['mycorrhizae'],
    buildParams(unit, worldPos) {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        return {
            targetPoint,
            outerRadius: (window.TILE_SIZE || 4) * 3.5,
            innerRadius: (window.TILE_SIZE || 4) * 1.75,
            innerWoodAmount: 7,
            maxSeedCount: 8,
            growthDelayTicks: 90,
            treeRemaining: 28,
            seedChance: 0.42
        };
    },
    createRuntime(unit, params, spec) {
        return new SporeBloomBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'engineer_productivity_boost',
    label: 'Boost',
    icon: '🔧',
    order: 70,
    commandable: true,
    primary: true,
    targetType: 'self',
    executionKind: 'timed_modifier',
    cooldownTicks: 100,
    durationTicks: 140,
    allowedUnitTypes: ['engineer'],
    buildParams() {
        return {};
    },
    createRuntime(unit, params, spec) {
        return new EngineerProductivityBoostBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'charge',
    label: 'Charge',
    icon: '⚔️',
    order: 10,
    commandable: true,
    primary: true,
    targetType: 'point',
    executionKind: 'timed_modifier',
    cooldownTicks: 80,
    durationTicks: 30,
    allowedUnitTypes: ['warrior', 'champion'],
    buildParams(unit, worldPos) {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        const isChampion = unit?.type === 'champion';
        return {
            targetPoint,
            durationTicks: isChampion ? 36 : 30,
            speedMultiplier: isChampion ? 2.15 : 1.9,
            damageMultiplier: isChampion ? 1.95 : 1.65,
            impactRadius: (window.TILE_SIZE || 4) * (isChampion ? 0.95 : 0.75),
            bopStrength: isChampion ? 160 : 130
        };
    },
    createRuntime(unit, params, spec) {
        return new ChargeBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'volley',
    label: 'Volley',
    icon: '🏹',
    order: 10,
    commandable: true,
    primary: true,
    targetType: 'point',
    executionKind: 'point_cast',
    cooldownTicks: 90,
    durationTicks: 30,
    castDelayTicks: 5,
    lockMovementDuringCast: true,
    allowedUnitTypes: ['archer', 'ballister'],
    buildParams(unit, worldPos) {
        const targetPoint = getAbilityPointTarget({ targetPoint: worldPos });
        if (!targetPoint) return null;
        const isBallister = unit?.type === 'ballister';
        return {
            targetPoint,
            shotCount: isBallister ? 7 : 5,
            shotIntervalTicks: isBallister ? 2 : 3,
            impactRadius: (window.TILE_SIZE || 4) * (isBallister ? 1.05 : 0.75),
            patternRadius: (window.TILE_SIZE || 4) * (isBallister ? 0.9 : 0.6),
            damage: Math.max(1, Math.round((unit.attackDamage || (isBallister ? 14 : 8)) * (isBallister ? 0.85 : 0.7))),
            projectileType: 'arrow'
        };
    },
    createRuntime(unit, params, spec) {
        return new VolleyBehavior(unit, params, spec).initialize();
    }
});

registerAbilitySpec({
    id: 'heal_pulse',
    label: 'Heal Pulse',
    icon: '💚',
    order: 15,
    commandable: true,
    primary: true,
    targetType: 'self',
    executionKind: 'area_pulse',
    cooldownTicks: 100,
    pulseIntervalTicks: 6,
    maxPulses: 3,
    allowedUnitTypes: ['monk', 'paladin', 'priest', 'valkyrie'],
    buildParams(unit) {
        const type = unit?.type || '';
        if (type === 'paladin') {
            return {
                radius: (window.TILE_SIZE || 4) * 3.0,
                healAmount: 8,
                maxPulses: 4,
                pulseIntervalTicks: 5
            };
        }
        if (type === 'priest' || type === 'valkyrie') {
            return {
                radius: (window.TILE_SIZE || 4) * 3.2,
                healAmount: 9,
                maxPulses: 4,
                pulseIntervalTicks: 5
            };
        }
        return {
            radius: (window.TILE_SIZE || 4) * 2.5,
            healAmount: 6,
            maxPulses: 3,
            pulseIntervalTicks: 6
        };
    },
    createRuntime(unit, params, spec) {
        return new HealPulseBehavior(unit, params, spec).initialize();
    }
});

window.UnitAbilityRegistry = UnitAbilityRegistry;
window.getUnitCommandAbilitySpecs = getUnitCommandAbilitySpecs;
window.getPrimaryUnitCommandAbility = getPrimaryUnitCommandAbility;
window.buildAbilityParamsForUnit = buildAbilityParamsForUnit;
window.canUnitUseAbility = canUnitUseAbility;

// Global behavior manager instance
const behaviorManager = new UnitBehaviorManager();

// EatBehavior - Villagers occasionally need to eat
class TransformBehavior extends Behavior {
    constructor(unit, params = {}) {
        super(unit, {
            transformDuration: 3000, // Takes 3 seconds to transform (3000ms = 60 ticks at 20Hz)
            transformType: null, // What to transform into
            revertDelay: 20000, // Brigands revert after 20 seconds of inactivity
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
            if (window.behaviorManager.deleteBehaviorDirect) {
                window.behaviorManager.deleteBehaviorDirect(unit, 'transform-delete-previous');
            } else {
                window.behaviorManager.behaviors.delete(unit);
            }
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
            if (window.disposeUnitSelectionIndicator) {
                window.disposeUnitSelectionIndicator(this.unit);
            } else if (this.unit.selectionIndicator) {
                this.unit.selectionIndicator.dispose();
                this.unit.selectionIndicator = null;
            }
            if (window.disposeHealthDots) {
                window.disposeHealthDots(this.unit);
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
                
                // Create blob shadow for this unit
                if (window.gfx && window.gfx.createBlobShadow) {
                    window.gfx.createBlobShadow(newUnit);
                    if (window.gfx.updateBlobShadow) {
                        window.gfx.updateBlobShadow(newUnit);
                    }
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
            if (window.disposeUnitSelectionIndicator) {
                window.disposeUnitSelectionIndicator(this.unit);
            } else if (this.unit.selectionIndicator) {
                this.unit.selectionIndicator.dispose();
                this.unit.selectionIndicator = null;
            }
            if (window.disposeHealthDots) {
                window.disposeHealthDots(this.unit);
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
                
                // Store animation groups for walk/idle animation switching
                if (model.animationGroups && model.animationGroups.length > 0) {
                    newVillager.animationGroups = {};
                    model.animationGroups.forEach(group => {
                        // Babylon prefixes cloned animations with "Clone of " - strip it
                        let name = group.name.toLowerCase();
                        if (name.startsWith('clone of ')) {
                            name = name.substring(9);
                        }
                        newVillager.animationGroups[name] = group;
                    });
                    newVillager.currentAnimation = null;
                    
                    // Start idle animation immediately to avoid T-pose
                    if (newVillager.animationGroups['idle']) {
                        newVillager.animationGroups['idle'].start(true);
                        newVillager.currentAnimation = 'idle';
                    }
                }
                
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
                
                // Create blob shadow for this unit
                if (window.gfx && window.gfx.createBlobShadow) {
                    window.gfx.createBlobShadow(newVillager);
                    if (window.gfx.updateBlobShadow) {
                        window.gfx.updateBlobShadow(newVillager);
                    }
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
        material.alpha = 1.0;
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
            if (window.behaviorManager.deleteBehaviorDirect) {
                window.behaviorManager.deleteBehaviorDirect(unit, 'eat-delete-previous');
            } else {
                window.behaviorManager.behaviors.delete(unit);
            }
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
        const isAdventureMode = window.currentMatch?.gameType === 'adventure' || window.gameType === 'adventure';
        if (isAdventureMode) {
            this.hasEaten = true;
            return;
        }

        const ownerPlayer = findPlayerByUnitOwner(this.unit.owner);
        const removeFood = () => {
            if (!ownerPlayer) return false;
            if (typeof ownerPlayer.removeResource === 'function') {
                return ownerPlayer.removeResource('food', this.params.foodCost);
            }
            if (ownerPlayer.resources && typeof ownerPlayer.resources.food === 'number' &&
                ownerPlayer.resources.food >= this.params.foodCost) {
                ownerPlayer.resources.food -= this.params.foodCost;
                return true;
            }
            return false;
        };

        if (ownerPlayer) {
            if (removeFood()) {
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
                
                // Remove from the owning player's units and global units in place
                if (ownerPlayer.units) {
                    const ownerIndex = ownerPlayer.units.indexOf(this.unit);
                    if (ownerIndex > -1) {
                        ownerPlayer.units.splice(ownerIndex, 1);
                    }
                }
                if (Array.isArray(window.gameUnits)) {
                    const gameUnitIndex = window.gameUnits.indexOf(this.unit);
                    if (gameUnitIndex > -1) {
                        window.gameUnits.splice(gameUnitIndex, 1);
                    }
                }
                
                if (window.disposeHealthDots) {
                    window.disposeHealthDots(this.unit);
                }
                // Clean up the unit's mesh
                if (this.unit.mesh) {
                    this.unit.mesh.dispose();
                }
                
                // Clean up food indicator
                this.removeFoodIndicator();
                return true;
            }
        } else {
            console.warn(`⚠️ Could not resolve food owner for unit ${this.unit?.id || 'unknown'} (owner=${this.unit?.owner || 'none'})`);
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
        material.alpha = 1.0;
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
    window.findPlayerByUnitOwner = findPlayerByUnitOwner;
    window.WorkBehavior = WorkBehavior;
    window.GatherWorkBehavior = GatherWorkBehavior;
    window.FarmWorkBehavior = FarmWorkBehavior;
    window.BuildWorkBehavior = BuildWorkBehavior;
    window.EngineerWorkBehavior = EngineerWorkBehavior;
    window.EatBehavior = EatBehavior;
    window.AttackUnitBehavior = AttackUnitBehavior;
    
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
        return window.deterministicStringCompare(a.id, b.id); // Sort by ID for consistency
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
        // Don't interrupt work behaviors (building, gathering, farming, etc.)
        if (unit.type === 'villager' && window.currentMatch?.gameType !== 'adventure' && window.gameType !== 'adventure') {
            const currentBehForEat = window.behaviorManager.getBehavior(unit);
            const isWorking = currentBehForEat && (
                currentBehForEat.constructor.name === 'BuildWorkBehavior' ||
                currentBehForEat.constructor.name === 'GatherWorkBehavior' ||
                currentBehForEat.constructor.name === 'FarmWorkBehavior' ||
                currentBehForEat.constructor.name === 'WorkBehavior' ||
                currentBehForEat.constructor.name === 'ManualGatherBehavior' ||
                currentBehForEat.constructor.name === 'WalkBehavior' ||
                currentBehForEat.constructor.name === 'RunBehavior' ||
                currentBehForEat.constructor.name === 'AttackBuildingBehavior'
            );
            if (!isWorking) {
                const ticksSinceLastEat = currentTick - unit.lastEatTick;
                const baseEatIntervalTicks = 60 * 60; // 60 seconds * 60 ticks/sec = 3600 ticks
                const randomVariationTicks = 10 * 60; // 10 seconds * 60 ticks/sec = 600 ticks
                // CRITICAL: Use deterministic random for eating interval in multiplayer
                const deterministicRandom = getUnitDeterministicRandom(unit, 'eat_interval');
                const eatIntervalTicks = baseEatIntervalTicks + (deterministicRandom * randomVariationTicks * 2 - randomVariationTicks);
                
                if (ticksSinceLastEat > eatIntervalTicks) {
                    window.behaviorManager.setBehavior(unit, 'eat');
                    unit.lastEatTick = currentTick;
                    return;
                }
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
                    const sortedBuildings = window.gameBuildings
                        .slice()
                        .sort((a, b) => window.deterministicStringCompare(a.id || '', b.id || ''));

                    for (const building of sortedBuildings) {
                        if (!building || !building.position) continue;
                        if (building.type === 'agora') continue;
                        // Don't require mesh - buildings under construction might not have mesh yet
                        if (!building.health || building.health <= 0) continue; // Skip destroyed buildings
                        
                        // Check if building is enemy (different owner)
                        const buildingOwner = building.owner?.length > 6 ? building.owner.slice(-6) : building.owner;
                        const isHostileBuilding = window.currentMatch?.areOwnersHostile
                            ? window.currentMatch.areOwnersHostile(buildingOwner, unitOwner)
                            : (!!buildingOwner && buildingOwner !== unitOwner);
                        if (!isHostileBuilding) continue; // Skip friendly buildings or buildings with no owner
                        
                        // Calculate distance
                        const distance = Math.sqrt(getStableDistanceSq({ x: unitX, z: unitZ }, building.position));
                        
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
        
        // Auto-aggro: combat-capable units engage nearby enemies
        const unitDef = window.UnitTypes?.[unit.type];
        if (unitDef && unitDef.aggroRange > 0 && unitDef.attackDamage > 0) {
            const curBeh = window.behaviorManager.getBehavior(unit);
            const behName = curBeh?.constructor?.name;
            const isPassive = !curBeh || behName === 'LingerBehavior' || behName === 'WanderBehavior';

            // Respect recent player move commands
            const ticksSincePlayerCmd = unit.lastPlayerMoveTick !== undefined
                ? (currentTick - unit.lastPlayerMoveTick)
                : Infinity;
            const respectPlayer = ticksSincePlayerCmd < 120; // 6 seconds at 20Hz

            if (isPassive && !respectPlayer && unit.pb?.state?.loc) {
                const TILE_SIZE = window.TILE_SIZE || 4;
                const aggroWorld = unitDef.aggroRange * TILE_SIZE;
                const aggroSq = aggroWorld * aggroWorld;
                const ux = unit.pb.state.loc.x;
                const uz = unit.pb.state.loc.z;
                const unitOwner = unit.owner?.length > 6 ? unit.owner.slice(-6) : unit.owner;
                let nearestEnemy = null;
                let nearestDistSq = aggroSq;
                const sortedEnemyCandidates = gameUnits
                    .filter(other => !!other)
                    .sort((a, b) => window.deterministicStringCompare(a.id || '', b.id || ''));

                for (let i = 0; i < sortedEnemyCandidates.length; i++) {
                    const other = sortedEnemyCandidates[i];
                    if (!other || other === unit || other.dead || other._disposed) continue;
                    if (typeof other.health === 'number' && other.health <= 0) continue;
                    const otherOwner = other.owner?.length > 6 ? other.owner.slice(-6) : other.owner;
                    const isHostileUnit = window.currentMatch?.areOwnersHostile
                        ? window.currentMatch.areOwnersHostile(otherOwner, unitOwner)
                        : (!!otherOwner && otherOwner !== unitOwner && otherOwner !== 'neutral');
                    if (!isHostileUnit) continue;
                    const oLoc = other.pb?.state?.loc;
                    if (!oLoc) continue;
                    const dSq = getStableDistanceSq({ x: ux, z: uz }, oLoc);
                    if (dSq < nearestDistSq) {
                        nearestDistSq = dSq;
                        nearestEnemy = other;
                    }
                }

                if (nearestEnemy) {
                    window.behaviorManager.setBehavior(unit, 'attack_unit', {
                        target: nearestEnemy
                    });
                    return;
                }
            }
        }

        // Only process units with no active behavior (or safe-to-replace behaviors like linger/wander)
        const currentBehavior = window.behaviorManager.getBehavior(unit);
        
        // CRITICAL: Don't interrupt direct player commands with auto-wander!
        if (currentBehavior) {
            const behaviorName = currentBehavior.constructor.name;
            if (behaviorName === 'ManualGatherBehavior' || 
                behaviorName === 'WalkBehavior' || 
                behaviorName === 'RunBehavior' ||
                behaviorName === 'AttackBuildingBehavior' ||
                behaviorName === 'AttackUnitBehavior') {
                return;
            }
        }
        
        if (!currentBehavior) {
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
