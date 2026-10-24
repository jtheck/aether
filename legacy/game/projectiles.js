// Simple, robust projectile system (no instancing, no scene gymnastics)
// Focus: arrows/rocks actually appear and move, with basic pooling.

(function(projectiles) {
  let scene = null;
  const activeProjectiles = [];
  const MAX_ACTIVE_PROJECTILES = 128;
  const DEBUG_PROJECTILES = false; // set true to see console traces
  const ENABLE_PROJECTILE_IMPACT_FX = false; // TEMP: disable impact FX to avoid Babylon crashes on hit
  let debugTick = 0;

  const ProjectileTypes = {
    arrow: {
      speed: 20,
      gravity: 0, // disable arc for now, simple straight-line so we can debug
      size: 0.4,
      color: new BABYLON.Color3(0.5, 0.3, 0.1),
      impactEffect: "hit",
    },
    flaming_arrow: {
      speed: 18,
      gravity: 15,
      size: 0.4,
      color: new BABYLON.Color3(1, 0.5, 0),
      impactEffect: "fire_hit",
    },
    rock: {
      speed: 15,
      gravity: 20,
      size: 0.6,
      color: new BABYLON.Color3(0.4, 0.4, 0.4),
      impactEffect: "rock_impact",
    },
    bullet: {
      speed: 40,
      gravity: 0,
      size: 0.1,
      color: new BABYLON.Color3(0.8, 0.8, 0.8),
      impactEffect: "spark",
    },
    spell: {
      speed: 12,
      gravity: 0,
      size: 0.5,
      color: new BABYLON.Color3(0.5, 0.3, 1),
      impactEffect: "magic_explosion",
    },
    fireball: {
      speed: 14,
      gravity: 0,
      size: 0.75,
      color: new BABYLON.Color3(1, 0.35, 0.05),
      impactEffect: "fire_hit",
      lifetimePadding: 0.15,
    },
  };

  // Optional simple mesh pool per type
  const projectilePools = {
    arrow: [],
    flaming_arrow: [],
    rock: [],
    bullet: [],
    spell: [],
    fireball: [],
  };

  // Shared materials (created once, reused for all projectiles of that type)
  const projectileMaterials = {};

  projectiles.init = function (gameScene) {
    scene = gameScene;
    
    // Create shared materials for each projectile type
    if (scene) {
      Object.keys(ProjectileTypes).forEach(type => {
        const def = ProjectileTypes[type];
        const mat = new BABYLON.StandardMaterial(`proj_${type}_mat_shared`, scene);
        mat.emissiveColor = def.color;
        mat.diffuseColor = def.color;
        mat.freeze(); // Optimize - material won't change
        projectileMaterials[type] = mat;
      });
    }
    
    if (DEBUG_PROJECTILES) {
      console.log("[PROJECTILES] init with scene", !!scene, "materials:", Object.keys(projectileMaterials).length);
    }
  };

  projectiles.fire = function (options) {
    if (!scene) {
      if (DEBUG_PROJECTILES) {
        console.warn("[PROJECTILES] fire called without scene");
      }
      return null;
    }
    
    // Make sure materials are initialized
    if (Object.keys(projectileMaterials).length === 0) {
      console.warn("[PROJECTILES] Materials not initialized, re-initializing");
      projectiles.init(scene);
    }

    const {
      type = "arrow",
      from,
      to,
      damage = 10,
      owner = null,
      speed = null,
      lifetimePadding = null,
      gameplayImpact = true,
      onHit = null,
      onMiss = null,
    } = options || {};

    const def = ProjectileTypes[type];
    if (!def) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] unknown type", type);
      return null;
    }
    if (!projectileMaterials[type] && scene) {
      const mat = new BABYLON.StandardMaterial(`proj_${type}_mat_shared`, scene);
      mat.emissiveColor = def.color;
      mat.diffuseColor = def.color;
      mat.freeze();
      projectileMaterials[type] = mat;
    }
    if (!from || !to) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] missing from/to", { from, to });
      return null;
    }

    const dir = to.clone().subtract(from);
    const dist = dir.length();
    if (!dist || dist < 0.1) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] target too close", dist);
      return null;
    }

    dir.normalize();
    const projSpeed = speed || def.speed;

    // Cap active projectiles so we never explode the scene
    if (activeProjectiles.length >= MAX_ACTIVE_PROJECTILES) {
      // Kill oldest ones
      const toKill = activeProjectiles.splice(0, 8);
      toKill.forEach(destroyProjectile);
    }

    const mesh = getOrCreateProjectileMesh(type, def);
    if (!mesh) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] failed to get mesh for type", type);
      return null;
    }

    // Validate mesh before using
    if (typeof mesh.setEnabled !== 'function') {
      console.error('[PROJECTILES] Mesh is missing setEnabled method!', mesh);
      return null;
    }

    try {
      mesh.position.copyFrom(from);
      mesh.setEnabled(true);
      mesh.isVisible = true;
    } catch (e) {
      console.error('[PROJECTILES] Error setting up mesh:', e);
      return null;
    }
    
    // Reset rotation from any previous use (important for pooled meshes)
    mesh.rotationQuaternion = null;
    mesh.rotation.set(0, 0, 0);

    // Aim arrow-like types toward the target so you can see them
    if (type === "arrow" || type === "flaming_arrow") {
      // Use the already-calculated and normalized direction vector
      // Calculate rotation to point the cylinder (which points along Y) toward target
      const up = BABYLON.Vector3.Up();
      const angle = Math.acos(BABYLON.Vector3.Dot(up, dir));
      const axis = BABYLON.Vector3.Cross(up, dir);
      if (axis.lengthSquared() > 0.0001) {
        axis.normalize();
        mesh.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);
      }
    }

    const projectile = {
      mesh,
      type,
      owner,
      damage,
      direction: dir,
      speed: projSpeed,
      gravity: def.gravity || 0,
      verticalVelocity: 0,
      from: from.clone(),
      to: to.clone(),
      distance: dist,
      elapsed: 0,
      lifetime: dist / projSpeed + (lifetimePadding ?? def.lifetimePadding ?? 1.0),
      onHit,
      onMiss,
      gameplayImpact,
      active: true,
    };

    activeProjectiles.push(projectile);

    if (DEBUG_PROJECTILES) {
      console.log("[PROJECTILES] fired", {
        type,
        from: { x: from.x, y: from.y, z: from.z },
        to: { x: to.x, y: to.y, z: to.z },
        dist: dist.toFixed(1),
        speed: projSpeed,
      });
    }

    return projectile;
  };

  projectiles.update = function (deltaTime) {
    if (!scene) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] update: no scene");
      return;
    }
    if (!deltaTime || deltaTime <= 0) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] update: invalid deltaTime", deltaTime);
      return;
    }
    if (activeProjectiles.length === 0) {
      return;
    }

    // Debug: log every 60 frames
    if (DEBUG_PROJECTILES && debugTick++ % 60 === 0) {
      console.log(`[PROJECTILES] Updating ${activeProjectiles.length} projectiles, dt=${deltaTime.toFixed(4)}s`);
    }

    for (let i = activeProjectiles.length - 1; i >= 0; i--) {
      const p = activeProjectiles[i];
      
      // Debug: Check projectile state
      if (DEBUG_PROJECTILES && debugTick % 60 === 1) {
        console.log(`[PROJECTILES] Checking projectile ${i}:`, {
          active: p.active,
          hasMesh: !!p.mesh,
          isDisposed: p.mesh ? (typeof p.mesh.isDisposed === 'function' ? p.mesh.isDisposed() : p.mesh.isDisposed) : 'no mesh',
          elapsed: p.elapsed,
          lifetime: p.lifetime
        });
      }
      
      // Quick validation without calling expensive methods
      if (!p.active || !p.mesh) {
        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
        continue;
      }
      
      // Only check isDisposed if mesh looks suspicious (rare case)
      if (typeof p.mesh.setEnabled !== 'function') {
        if (DEBUG_PROJECTILES) {
          console.warn("[PROJECTILES] Destroying projectile with invalid mesh");
        }
        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
        continue;
      }

      p.elapsed += deltaTime;
      
      if (p.elapsed > p.lifetime) {
        if (DEBUG_PROJECTILES) {
          console.log(`[PROJECTILES] Projectile expired (elapsed ${p.elapsed.toFixed(2)}s > lifetime ${p.lifetime.toFixed(2)}s)`);
        }
        handleMiss(p);
        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
        continue;
      }

      // Movement - simple linear interpolation from from -> to over lifetime.
      const t = Math.min(p.elapsed / p.lifetime, 1);
      const newPos = BABYLON.Vector3.Lerp(p.from, p.to, t);
      
      // Debug movement (only create clone if actually debugging)
      if (DEBUG_PROJECTILES && p.elapsed < 0.5) {
        const oldPos = p.mesh.position.clone();
        p.mesh.position.copyFrom(newPos);
        console.log(`[PROJECTILES] MOVE t=${t.toFixed(3)}, elapsed=${p.elapsed.toFixed(3)}/${p.lifetime.toFixed(3)}, pos: (${oldPos.x.toFixed(1)},${oldPos.y.toFixed(1)},${oldPos.z.toFixed(1)}) -> (${newPos.x.toFixed(1)},${newPos.y.toFixed(1)},${newPos.z.toFixed(1)})`);
      } else {
        p.mesh.position.copyFrom(newPos);
      }

      // Check for hit when projectile is near the end (cheaper than distance calculation)
      // Using t (interpolation factor) is more efficient than calculating distance
      if (t >= 0.95) {
        const hitPos = p.mesh.position.clone();
        if (p.gameplayImpact) {
          const hitUnit = checkUnitCollision(hitPos, p.owner);
          if (hitUnit) {
            if (p.onHit) {
              p.onHit(hitUnit, hitPos);
            } else {
              applyDamage(hitUnit, p.damage, p.owner);
            }
            bopUnitFromProjectile(hitUnit, p.from, 240, p.direction);
            if (ENABLE_PROJECTILE_IMPACT_FX) {
              createImpactEffect(p.type, hitPos);
            }
          } else if (p.onMiss) {
            p.onMiss(hitPos);
          }
        } else if (p.onMiss) {
          p.onMiss(hitPos);
        }

        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
      }
    }
  };

  projectiles.cleanup = function () {
    // Dispose all active projectiles and clear pools/materials
    const count = activeProjectiles.length;
    activeProjectiles.forEach(p => {
      destroyProjectile(p);
    });
    activeProjectiles.length = 0;

    // Dispose any pooled meshes so we fully reset state
    Object.keys(projectilePools).forEach(type => {
      const pool = projectilePools[type];
      if (!Array.isArray(pool)) return;

      pool.forEach(mesh => {
        if (!mesh) return;
        try {
          const isDisposed = typeof mesh.isDisposed === "function"
            ? mesh.isDisposed()
            : mesh.isDisposed === true;
          if (!isDisposed && typeof mesh.dispose === "function") {
            mesh.dispose();
          }
        } catch (e) {
          console.warn('[PROJECTILES] Error disposing pooled mesh:', e);
        }
      });
      pool.length = 0;
    });
    
    // Dispose shared materials
    Object.values(projectileMaterials).forEach(mat => {
      if (mat && typeof mat.dispose === 'function') {
        try {
          mat.dispose();
        } catch (e) {
          console.warn('[PROJECTILES] Error disposing material:', e);
        }
      }
    });
    Object.keys(projectileMaterials).forEach(key => delete projectileMaterials[key]);
    
    console.log('[PROJECTILES] Cleanup complete - disposed', count, 'projectiles, pooled meshes, and materials');
  };

  projectiles.getStats = function () {
    return {
      active: activeProjectiles.length,
      types: Object.keys(ProjectileTypes),
    };
  };

  projectiles.addType = function (name, config) {
    ProjectileTypes[name] = config;
    projectilePools[name] = projectilePools[name] || [];
  };

  // --- helpers ---

  function getOrCreateProjectileMesh(type, def) {
    let mesh = null;

    // Try to reuse a pooled mesh first for this type
    const pool = projectilePools[type];
    if (pool && pool.length > 0) {
      while (pool.length && !mesh) {
        const candidate = pool.pop();
        if (!candidate) continue;

        // Skip meshes that have been disposed
        const isDisposed = typeof candidate.isDisposed === "function"
          ? candidate.isDisposed()
          : candidate.isDisposed === true;
        if (isDisposed) {
          try {
            if (typeof candidate.dispose === "function") {
              candidate.dispose();
            }
          } catch (e) {
            console.warn("[PROJECTILES] Error disposing stale pooled mesh:", e);
          }
          continue;
        }

        mesh = candidate;
      }
    }

    // If no pooled mesh, create an appropriately sized projectile mesh
    if (!mesh) {
      const diameter = def.size || 0.4;
      
      // For arrows, create a cylinder shape (points along Y-axis by default)
      if (type === "arrow" || type === "flaming_arrow") {
        mesh = BABYLON.MeshBuilder.CreateCylinder(
          `proj_${type}_${Date.now()}`,
          {
            height: 1.5,
            diameterTop: 0.05,
            diameterBottom: 0.1,
            tessellation: 6,
          },
          scene
        );
        // Rotation will be set when fired using rotationQuaternion
      } else if (type === "rock") {
        // Rocks use a slightly irregular sphere
        mesh = BABYLON.MeshBuilder.CreateSphere(
          `proj_${type}_${Date.now()}`,
          {
            diameter,
            segments: 6,
          },
          scene
        );
      } else {
        // Default sphere for other projectile types
        mesh = BABYLON.MeshBuilder.CreateSphere(
          `proj_${type}_${Date.now()}`,
          {
            diameter,
            segments: 8,
          },
          scene
        );
      }
    }

    // Use shared material instead of creating new one every time
    const sharedMat = projectileMaterials[type];
    if (sharedMat) {
      mesh.material = sharedMat;
    } else {
      console.warn('[PROJECTILES] No shared material for type', type);
    }

    mesh.isPickable = false;
    mesh.doNotSerialize = true;
    mesh.renderingGroupId = 2; // draw over most world meshes
    
    // Validate the mesh is properly set up
    if (typeof mesh.setEnabled !== 'function') {
      console.error('[PROJECTILES] Created mesh is invalid - no setEnabled!', mesh);
      if (mesh.dispose) mesh.dispose();
      return null;
    }
    // CRITICAL: Check for isEnabled as a FUNCTION (Babylon calls this internally)
    if (typeof mesh.isEnabled !== 'function') {
      console.error('[PROJECTILES] Created mesh is missing isEnabled FUNCTION!', {
        name: mesh.name,
        type: mesh.constructor?.name,
        hasSetEnabled: typeof mesh.setEnabled,
        isEnabledType: typeof mesh.isEnabled,
        keys: Object.keys(mesh).slice(0, 20)
      });
      if (mesh.dispose) mesh.dispose();
      return null;
    }

    // Projectiles are fine - no need to log
    return mesh;
  }

  function destroyProjectile(p) {
    if (!p) return;

    p.active = false;

    const mesh = p.mesh;
    p.mesh = null;

    if (!mesh) return;

    try {
      const isDisposed = typeof mesh.isDisposed === "function"
        ? mesh.isDisposed()
        : mesh.isDisposed === true;

      // If already disposed, nothing we can do
      if (isDisposed) {
        return;
      }

      const pool = projectilePools[p.type];

      if (pool) {
        // Reset visual/transform state before pooling
        if (mesh.rotationQuaternion) {
          mesh.rotationQuaternion = null;
        }
        if (mesh.rotation) {
          mesh.rotation.set(0, 0, 0);
        }
        if (mesh.position) {
          // Park it far below the world so it never flashes
          mesh.position.set(0, -9999, 0);
        }

        if (typeof mesh.setEnabled === "function") {
          mesh.setEnabled(false);
        }
        mesh.isVisible = false;

        // Keep pool size bounded so we don't leak memory
        const MAX_POOL_SIZE = MAX_ACTIVE_PROJECTILES;
        if (pool.length < MAX_POOL_SIZE) {
          pool.push(mesh);
        } else if (typeof mesh.dispose === "function") {
          mesh.dispose();
        }
      } else if (typeof mesh.dispose === "function") {
        // Fallback: just dispose if no pool is defined
        mesh.dispose();
      }
    } catch (e) {
      console.warn('[PROJECTILES] Error cleaning up projectile mesh:', e);
      try {
        if (typeof mesh.dispose === "function") {
          mesh.dispose();
        }
      } catch (inner) {
        console.warn('[PROJECTILES] Error disposing mesh after cleanup error:', inner);
      }
    }
  }

  function handleMiss(p) {
    if (p.onMiss && p.mesh && p.mesh.position) {
      try {
        p.onMiss(p.mesh.position.clone());
      } catch (e) {
        console.warn('[PROJECTILES] Error in onMiss callback:', e);
      }
    }
  }

  function checkUnitCollision(position, ownerId) {
    if (!window.gameUnits || !window.gameUnits.length) return null;

    const COLLISION_RADIUS = 1.0;
    const COLLISION_RADIUS_SQ = COLLISION_RADIUS * COLLISION_RADIUS; // Avoid sqrt

    for (const unit of window.gameUnits) {
      if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
      const isHostile = window.currentMatch?.areOwnersHostile
        ? window.currentMatch.areOwnersHostile(unit.owner, ownerId)
        : (unit.owner !== ownerId);
      if (!isHostile) continue;
      if (!unit.health || unit.health <= 0) continue;

      const loc = unit.pb.state.loc;
      
      // Fast squared distance check (no sqrt needed)
      const dx = loc.x - position.x;
      const dy = (loc.y || 0) - position.y;
      const dz = loc.z - position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      
      if (distSq <= COLLISION_RADIUS_SQ) return unit;
    }

    return null;
  }

  function applyDamage(unit, damage, attackerOwner, options = {}) {
    if (!unit) return null;
    if (typeof window.resolveIncomingUnitDamage === "function") {
      return window.resolveIncomingUnitDamage(unit, damage, {
        ...options,
        attackerOwner
      });
    }
    const hasHealth = typeof unit.health === "number";
    const hasCurrentHealth = typeof unit.currentHealth === "number";
    if (!hasHealth && !hasCurrentHealth) return null;

    const baseHealth = hasCurrentHealth ? unit.currentHealth : unit.health;
    const newHealth = Math.max(0, baseHealth - (damage || 0));
    if (hasHealth) unit.health = newHealth;
    if (hasCurrentHealth) unit.currentHealth = newHealth;

    if ((damage || 0) > 0 && options.showDamageSpeech !== false && window.UnitSpeech && window.UnitSpeech.showDamage) {
      window.UnitSpeech.showDamage(unit, damage || 0);
    }

    if (newHealth <= 0 && typeof window.onUnitDeath === "function") {
      window.onUnitDeath(unit, attackerOwner, {
        unit,
        attackerOwner,
        damageType: typeof options.damageType === "string" ? options.damageType : "physical",
        rawDamage: damage || 0,
        mitigated: 0,
        absorbed: 0,
        appliedDamage: damage || 0,
        preventedDamage: 0,
        killed: true,
        healthBefore: baseHealth,
        healthAfter: newHealth
      });
    }
    return {
      unit,
      attackerOwner,
      damageType: typeof options.damageType === "string" ? options.damageType : "physical",
      rawDamage: damage || 0,
      mitigated: 0,
      absorbed: 0,
      appliedDamage: damage || 0,
      preventedDamage: 0,
      killed: newHealth <= 0,
      healthBefore: baseHealth,
      healthAfter: newHealth
    };
  }

  // Give a unit a physics "bop" using its PBody impulse.
  function bopUnitFromProjectile(unit, sourcePosition, power, fallbackDirection) {
    if (!unit || !unit.pb || !unit.pb.imp || !unit.pb.state || !unit.pb.state.loc) {
      return;
    }

    const unitPos = unit.pb.state.loc.clone();
    let dir = sourcePosition ? unitPos.subtract(sourcePosition) : BABYLON.Vector3.Zero();
    if (dir.lengthSquared() < 0.0001) {
      if (fallbackDirection && fallbackDirection.lengthSquared && fallbackDirection.lengthSquared() > 0.0001) {
        dir = fallbackDirection.clone ? fallbackDirection.clone() : new BABYLON.Vector3(fallbackDirection.x || 0, fallbackDirection.y || 0, fallbackDirection.z || 0);
      } else {
        const idHash = (unit.id || '').split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const angle = (idHash % 360) * (Math.PI / 180);
        dir = new BABYLON.Vector3(Math.cos(angle), 0, Math.sin(angle));
      }
    }
    dir.normalize();

    const strength = power || 150;
    unit.pb.imp.addInPlace(dir.scale(strength));
  }

  projectiles.applyImpact = function(options) {
    const {
      unit,
      attackerOwner = null,
      damage = 0,
      damageType = "physical",
      sourcePosition = null,
      bopStrength = 0,
      fallbackDirection = null
    } = options || {};
    if (!unit) return null;
    const result = applyDamage(unit, damage, attackerOwner, { damageType });
    if (bopStrength > 0) {
      bopUnitFromProjectile(unit, sourcePosition, bopStrength, fallbackDirection);
    }
    return result;
  }

  function createImpactEffect(projectileType, position) {
    if (!window.fx) return;

    const def = ProjectileTypes[projectileType];
    if (!def) return;

    const spawnImpactFx = (effectType, options = {}) => {
      if (window.fx.createTransientParticleEffect) {
        return window.fx.createTransientParticleEffect(effectType, position, options);
      }
      const fallbackOptions = Object.assign({}, options);
      delete fallbackOptions.durationMs;
      return window.fx.createParticleEffect(effectType, position, fallbackOptions);
    };

    switch (def.impactEffect) {
      case "hit":
        spawnImpactFx("particle", {
          scale: 0.2,
          emitRate: 20,
          durationMs: 220
        });
        break;
      case "fire_hit":
        spawnImpactFx("burn_fire", {
          scale: 0.35,
          emitRate: 30,
          minSize: 0.16,
          maxSize: 0.38,
          durationMs: 420
        });
        break;
      case "spark":
        spawnImpactFx("particle", {
          scale: 0.15,
          emitRate: 15,
          durationMs: 180
        });
        break;
      case "magic_explosion":
        spawnImpactFx("magefire", {
          scale: 0.4,
          emitRate: 40,
          durationMs: 450
        });
        break;
      case "rock_impact":
        spawnImpactFx("smoke", {
          scale: 0.5,
          emitRate: 50,
          durationMs: 650
        });
        window.fx.createExplosion(position, 0.3);
        break;
    }
  }
})(window.projectiles = window.projectiles || {});

// ---------------------------------------------------------------------------
// Debug / test helpers – callable from browser console
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // Emergency cleanup if projectiles break the scene
  window.cleanupProjectiles = window.cleanupProjectiles || function() {
    if (window.projectiles && window.projectiles.cleanup) {
      window.projectiles.cleanup();
      console.log('✅ Projectiles cleaned up');
    } else {
      console.warn('Projectiles system not available');
    }
  };

  // Trigger a monk radial kick using the physics/behavior system
  window.testMonkKick = window.testMonkKick || function(options = {}) {
    const radius = options.radius || 4;
    const power = options.power || 160;

    if (!window.behaviorManager) {
      console.warn("behaviorManager not ready");
      return;
    }

    let monk = null;

    // Prefer a selected monk if available
    if (window.player && typeof window.player.getSelectedUnits === "function") {
      const selected = window.player.getSelectedUnits() || [];
      monk = selected.find(u => /monk/i.test(u.type || u.name || ""));
    }

    // Fallback: first monk in gameUnits
    if (!monk && Array.isArray(window.gameUnits)) {
      monk = window.gameUnits.find(u => u && /monk/i.test(u.type || u.name || ""));
    }

    if (!monk) {
      console.warn("No monk unit found to kick with");
      return;
    }

    window.behaviorManager.setBehavior(monk, "monk_kick", {
      radius,
      power
    });

    console.log("Triggered monk kick for", monk.id || monk.name || monk.type, "radius", radius, "power", power);
  };

  // Test a simple projectile from point A to point B
  window.testProjectile = window.testProjectile || function(fromX, fromZ, toX, toZ) {
    fromX = fromX || 0;
    fromZ = fromZ || 0;
    toX = toX || 10;
    toZ = toZ || 10;
    
    const BAB = window.BABYLON;
    if (!BAB || !window.projectiles) {
      console.warn("BABYLON or projectiles not ready");
      return;
    }
    
    const from = new BAB.Vector3(fromX, 2, fromZ);
    const to = new BAB.Vector3(toX, 2, toZ);
    
    const proj = window.projectiles.fire({
      type: 'arrow',
      from: from,
      to: to,
      damage: 10,
      owner: null
    });
    
    console.log("Test projectile fired from", from, "to", to, "result:", !!proj);
    console.log("Active projectiles:", window.projectiles.getStats());
    return proj;
  };

  // Force a tower to fire an arrow at the nearest enemy unit
  window.testTowerShoot = window.testTowerShoot || function() {
    if (!window.projectiles || !window.projectiles.fire) {
      console.warn("projectiles system not ready");
      return;
    }
    if (!Array.isArray(window.gameBuildings) || !Array.isArray(window.gameUnits)) {
      console.warn("gameBuildings or gameUnits not ready");
      return;
    }

    const BAB = window.BABYLON;
    if (!BAB || !BAB.Vector3) {
      console.warn("BABYLON namespace not ready");
      return;
    }

    // Find a tower
    const tower = window.gameBuildings.find(b => b && b.type === "tower");
    if (!tower) {
      console.warn("No tower building found");
      return;
    }

    const towerPos = tower.mesh
      ? tower.mesh.getAbsolutePosition()
      : new BAB.Vector3(tower.position.x, tower.position.y || 2, tower.position.z);

    // Find nearest enemy unit
    let nearestEnemy = null;
    let nearestDist = Infinity;

    window.gameUnits.forEach(unit => {
      if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) return;
      if (tower.owner && unit.owner === tower.owner) return;
      if (!unit.health || unit.health <= 0) return;

      const pos = unit.pb.state.loc;
      const dx = pos.x - towerPos.x;
      const dz = pos.z - towerPos.z;
      const d2 = dx * dx + dz * dz;

      if (d2 < nearestDist) {
        nearestDist = d2;
        nearestEnemy = unit;
      }
    });

    if (!nearestEnemy) {
      console.warn("No enemy unit found for tower to shoot");
      return;
    }

    const targetPos = new BAB.Vector3(
      nearestEnemy.pb.state.loc.x,
      nearestEnemy.pb.state.loc.y || 0.5,
      nearestEnemy.pb.state.loc.z
    );

    const shotFrom = towerPos.clone().add(new BAB.Vector3(0, 2, 0));

    const proj = window.projectiles.fire({
      type: "arrow",
      from: shotFrom,
      to: targetPos,
      damage: tower.attackDamage || 15,
      owner: tower.owner || null
    });

    console.log("Tower test shot", {
      tower: tower.name || tower.type,
      from: shotFrom,
      to: targetPos,
      projectile: !!proj
    });
  };
}

