// Simple, robust projectile system (no instancing, no scene gymnastics)
// Focus: arrows/rocks actually appear and move, with basic pooling.

(function(projectiles) {
  let scene = null;
  const activeProjectiles = [];
  const MAX_ACTIVE_PROJECTILES = 128;
  const DEBUG_PROJECTILES = true; // set true to see console traces
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
  };

  // Optional simple mesh pool per type
  const projectilePools = {
    arrow: [],
    flaming_arrow: [],
    rock: [],
    bullet: [],
    spell: [],
  };

  projectiles.init = function (gameScene) {
    scene = gameScene;
    if (DEBUG_PROJECTILES) {
      console.log("[PROJECTILES] init with scene", !!scene);
    }
  };

  projectiles.fire = function (options) {
    if (!scene) {
      if (DEBUG_PROJECTILES) {
        console.warn("[PROJECTILES] fire called without scene");
      }
      return null;
    }

    const {
      type = "arrow",
      from,
      to,
      damage = 10,
      owner = null,
      speed = null,
      onHit = null,
      onMiss = null,
    } = options || {};

    const def = ProjectileTypes[type];
    if (!def) {
      if (DEBUG_PROJECTILES) console.warn("[PROJECTILES] unknown type", type);
      return null;
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

    mesh.position.copyFrom(from);
    mesh.setEnabled(true);
    mesh.isVisible = true;

    // Aim arrow-like types toward the target so you can see them
    if (type === "arrow" || type === "flaming_arrow") {
      mesh.lookAt(to);
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
      lifetime: dist / projSpeed + 1.0, // small buffer
      onHit,
      onMiss,
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
    if (!scene || !deltaTime || deltaTime <= 0 || activeProjectiles.length === 0) {
      return;
    }

    for (let i = activeProjectiles.length - 1; i >= 0; i--) {
      const p = activeProjectiles[i];
      if (!p.active || !p.mesh || p.mesh.isDisposed) {
        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
        continue;
      }

      p.elapsed += deltaTime;
      if (p.elapsed > p.lifetime) {
        handleMiss(p);
        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
        continue;
      }

      // Movement - simple linear interpolation from from -> to over lifetime.
      const t = Math.min(p.elapsed / p.lifetime, 1);
      const newPos = BABYLON.Vector3.Lerp(p.from, p.to, t);

      if (DEBUG_PROJECTILES && p.elapsed < 0.5) {
        console.log("[PROJECTILES] move", {
          t,
          from: p.from,
          to: p.to,
          newPos,
        });
      }

      p.mesh.position.copyFrom(newPos);

      // Check for hit near the target or along the arc
      const traveled = BABYLON.Vector3.Distance(p.from, p.mesh.position);
      if (traveled >= p.distance * 0.95) {
        const hitPos = p.mesh.position.clone();
        const hitUnit = checkUnitCollision(hitPos, p.owner);
        if (hitUnit) {
          if (p.onHit) {
            p.onHit(hitUnit, hitPos);
          } else {
            applyDamage(hitUnit, p.damage, p.owner);
          }
          // Add a physics "bop" so impacts feel punchy
          bopUnitFromProjectile(hitUnit, hitPos, 150);
          createImpactEffect(p.type, hitPos);
        } else if (p.onMiss) {
          p.onMiss(hitPos);
        }

        destroyProjectile(p);
        activeProjectiles.splice(i, 1);
      }
    }
  };

  projectiles.cleanup = function () {
    activeProjectiles.forEach(destroyProjectile);
    activeProjectiles.length = 0;
    Object.keys(projectilePools).forEach((t) => (projectilePools[t].length = 0));
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
    const pool = projectilePools[type] || (projectilePools[type] = []);
    let mesh = pool.pop();
    if (mesh && !mesh.isDisposed) {
      return mesh;
    }

    // Create a very visible debug geometry per projectile so we can be sure
    // they are on-screen. We can shrink/tune later once we confirm behavior.
    const diameter = type === "rock" ? 3 : 2; // big glowing blobs for now
    mesh = BABYLON.MeshBuilder.CreateSphere(
      `proj_${type}_${Date.now()}`,
      {
        diameter,
        segments: 8,
      },
      scene
    );

    const mat = new BABYLON.StandardMaterial(`proj_${type}_mat`, scene);
    mat.emissiveColor = def.color;
    mat.diffuseColor = def.color;
    mesh.material = mat;

    mesh.isPickable = false;
    mesh.doNotSerialize = true;
    mesh.renderingGroupId = 2; // draw over most world meshes
    mesh.alwaysSelectAsActiveMesh = true;

    return mesh;
  }

  function destroyProjectile(p) {
    p.active = false;
    if (p.mesh && !p.mesh.isDisposed) {
      // Return to pool instead of disposing
      const pool = projectilePools[p.type] || (projectilePools[p.type] = []);
      p.mesh.setEnabled(false);
      p.mesh.isVisible = false;
      pool.push(p.mesh);
    }
  }

  function handleMiss(p) {
    if (p.onMiss) {
      p.onMiss(p.mesh.position.clone());
    }
  }

  function checkUnitCollision(position, ownerId) {
    if (!window.gameUnits || !window.gameUnits.length) return null;

    const COLLISION_RADIUS = 1.0;

    for (const unit of window.gameUnits) {
      if (!unit || !unit.pb || !unit.pb.state || !unit.pb.state.loc) continue;
      if (unit.owner === ownerId) continue;
      if (!unit.health || unit.health <= 0) continue;

      const unitPos = new BABYLON.Vector3(
        unit.pb.state.loc.x,
        unit.pb.state.loc.y || 0,
        unit.pb.state.loc.z
      );

      const d = BABYLON.Vector3.Distance(position, unitPos);
      if (d <= COLLISION_RADIUS) return unit;
    }

    return null;
  }

  function applyDamage(unit, damage, attackerOwner) {
    if (!unit) return;
    if (typeof unit.health !== "number") return;

    unit.health = Math.max(0, unit.health - (damage || 0));

    if (unit.health <= 0 && typeof window.onUnitDeath === "function") {
      window.onUnitDeath(unit, attackerOwner);
    }
  }

  // Give a unit a physics "bop" using its PBody impulse.
  function bopUnitFromProjectile(unit, hitPosition, power) {
    if (!unit || !unit.pb || !unit.pb.imp || !unit.pb.state || !unit.pb.state.loc) {
      return;
    }

    const unitPos = unit.pb.state.loc.clone();
    let dir = unitPos.subtract(hitPosition);
    if (dir.lengthSquared() < 0.0001) {
      // Fallback: tiny random push if we're exactly on top
      dir = new BABYLON.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
    }
    dir.normalize();

    const strength = power || 150;
    unit.pb.imp.addInPlace(dir.scale(strength));
  }

  function createImpactEffect(projectileType, position) {
    if (!window.fx) return;

    const def = ProjectileTypes[projectileType];
    if (!def) return;

    switch (def.impactEffect) {
      case "hit":
        window.fx.createParticleEffect("particle", position, {
          scale: 0.2,
          emitRate: 20,
        });
        break;
      case "fire_hit":
        window.fx.createParticleEffect("fire", position, {
          scale: 0.3,
          emitRate: 30,
        });
        break;
      case "spark":
        window.fx.createParticleEffect("particle", position, {
          scale: 0.15,
          emitRate: 15,
        });
        break;
      case "magic_explosion":
        window.fx.createParticleEffect("magefire", position, {
          scale: 0.4,
          emitRate: 40,
        });
        break;
      case "rock_impact":
        window.fx.createParticleEffect("smoke", position, {
          scale: 0.5,
          emitRate: 50,
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

