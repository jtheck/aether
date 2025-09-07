// Particle Effects System
// 
// A simple, reusable particle system that can be attached to buildings using named anchor meshes.
// 
// Usage Examples:
// 
// 1. Create a particle effect at a position:
//    fx.createParticleEffect('fire', new BABYLON.Vector3(0, 0, 0));
// 
// 2. Attach particle effect to a building using named anchor:
//    fx.attachParticleEffect(building, 'fire', 'fire_anchor', { emitRate: 50 });
// 
// 3. Scale particle effects (0.1 = tiny, 1.0 = normal, 2.0 = huge):
//    fx.attachParticleEffect(building, 'fire', 'fire_anchor', { scale: 0.3 }); // Small campfire
//    fx.createParticleEffect('fire', position, { scale: 2.0 }); // Raging inferno
// 
// 4. Remove particle effects from a building:
//    fx.removeParticleEffects(building, 'fire'); // Remove specific effect
//    fx.removeParticleEffects(building); // Remove all effects
// 
// 5. Test particle effects:
//    fx.setupParticleTesting(); // Enable keyboard shortcuts
//    // Press F for all effects, B for building effects, 1 for fire, 2 for smoke
// 
// Available presets: 'fire', 'smoke'
// You can add custom presets with fx.addParticlePreset(name, preset)
//
(function(fx) {
  
  let scene = null;
  
  // Particle effect presets
  const ParticlePresets = {
    fire: {
      texture: "assets/images/explosion.png",
      emitRate: 49,
      minSize: .2,
      maxSize: .4,
      minLifeTime: 1.5,
      maxLifeTime: 3.0,
      minEmitPower: 2,  // Reduced outward velocity
      maxEmitPower: 8,   // Reduced outward velocity
      minInitialRotation: -Math.PI,
      maxInitialRotation: Math.PI,
      blendMode: BABYLON.ParticleSystem.BLENDMODE_MULTIPLYADD,
      // Add upward bias for fire direction
      direction1: new BABYLON.Vector3(0, 1, 0),  // Primary upward direction
      direction2: new BABYLON.Vector3(0, 1, 0),  // Secondary upward direction
      minEmitBox: new BABYLON.Vector3(-0.1, 0, -0.1),  // Small horizontal spread
      maxEmitBox: new BABYLON.Vector3(0.1, 0, 0.1),     // Small horizontal spread
      colorGradients: [
        { time: 0.0, color: new BABYLON.Color4(1, 1, 1, 0) },
        { time: 0.1, color: new BABYLON.Color4(1, 1, 1, 1) },
        { time: 0.9, color: new BABYLON.Color4(1, 1, 1, 1) },
        { time: 1.0, color: new BABYLON.Color4(1, 1, 1, 0) }
      ],
      rampGradients: [
        { time: 0.0, color: new BABYLON.Color3(1, 1, 1) },
        { time: 0.2, color: new BABYLON.Color3(1, 0.8, 0.2) },
        { time: 0.5, color: new BABYLON.Color3(1, 0.4, 0.1) },
        { time: 0.8, color: new BABYLON.Color3(0.8, 0.2, 0.1) },
        { time: 1.0, color: new BABYLON.Color3(0.3, 0.1, 0.1) }
      ],
      useRampGradients: true,
      limitVelocityGradients: [
        { time: 0, limit: 12 },    // Reduced max velocity
        { time: 0.3, limit: 8 },   // Slower decay
        { time: 0.7, limit: 3 },   // Gentle slowdown
        { time: 1.0, limit: 1 }    // Very slow at end
      ],
      limitVelocityDamping: 0.95   // Less aggressive damping
    },
    smoke: {
      texture: "assets/images/explosion.png",
      emitRate: 50,
      minSize: 3,
      maxSize: .6,
      minLifeTime: 2.0,
      maxLifeTime: 4.0,
      minEmitPower: 2,
      maxEmitPower: 8,
      minInitialRotation: -Math.PI,
      maxInitialRotation: Math.PI,
      blendMode: BABYLON.ParticleSystem.BLENDMODE_STANDARD,
      colorGradients: [
        { time: 0.0, color: new BABYLON.Color4(0.8, 0.8, 0.8, 0) },
        { time: 0.1, color: new BABYLON.Color4(0.8, 0.8, 0.8, 0.8) },
        { time: 0.9, color: new BABYLON.Color4(0.6, 0.6, 0.6, 0.4) },
        { time: 1.0, color: new BABYLON.Color4(0.4, 0.4, 0.4, 0) }
      ],
      rampGradients: [
        { time: 0.0, color: new BABYLON.Color3(0.9, 0.9, 0.9) },
        { time: 0.5, color: new BABYLON.Color3(0.6, 0.6, 0.6) },
        { time: 1.0, color: new BABYLON.Color3(0.3, 0.3, 0.3) }
      ],
      useRampGradients: true,
      limitVelocityGradients: [
        { time: 0, limit: 15 },
        { time: 0.3, limit: 8 },
        { time: 1.0, limit: 2 }
      ],
      limitVelocityDamping: 0.95
    },
    torch: {
      texture: "assets/images/explosion.png",
      emitRate: 30,
      minSize: 0.1,
      maxSize: 0.3,
      minLifeTime: 1.0,
      maxLifeTime: 2.0,
      minEmitPower: 1,
      maxEmitPower: 4,
      minInitialRotation: -Math.PI,
      maxInitialRotation: Math.PI,
      blendMode: BABYLON.ParticleSystem.BLENDMODE_MULTIPLYADD,
      // Upward torch flame
      direction1: new BABYLON.Vector3(0, 1, 0),
      direction2: new BABYLON.Vector3(0, 1, 0),
      minEmitBox: new BABYLON.Vector3(-0.05, 0, -0.05),
      maxEmitBox: new BABYLON.Vector3(0.05, 0, 0.05),
      colorGradients: [
        { time: 0.0, color: new BABYLON.Color4(1, 1, 1, 0) },
        { time: 0.1, color: new BABYLON.Color4(1, 1, 1, 1) },
        { time: 0.9, color: new BABYLON.Color4(1, 1, 1, 1) },
        { time: 1.0, color: new BABYLON.Color4(1, 1, 1, 0) }
      ],
      rampGradients: [
        { time: 0.0, color: new BABYLON.Color3(1, 0.9, 0.8) },
        { time: 0.3, color: new BABYLON.Color3(1, 0.6, 0.2) },
        { time: 0.7, color: new BABYLON.Color3(0.8, 0.3, 0.1) },
        { time: 1.0, color: new BABYLON.Color3(0.4, 0.1, 0.05) }
      ],
      useRampGradients: true,
      limitVelocityGradients: [
        { time: 0, limit: 8 },
        { time: 0.5, limit: 4 },
        { time: 1.0, limit: 1 }
      ],
      limitVelocityDamping: 0.9
    },
    particle: {
      texture: "assets/images/explosion.png",
      emitRate: 20,
      minSize: 0.1,
      maxSize: 0.2,
      minLifeTime: 1.0,
      maxLifeTime: 2.0,
      minEmitPower: 1,
      maxEmitPower: 3,
      minInitialRotation: -Math.PI,
      maxInitialRotation: Math.PI,
      blendMode: BABYLON.ParticleSystem.BLENDMODE_STANDARD,
      colorGradients: [
        { time: 0.0, color: new BABYLON.Color4(1, 1, 1, 0) },
        { time: 0.1, color: new BABYLON.Color4(1, 1, 1, 0.8) },
        { time: 0.9, color: new BABYLON.Color4(1, 1, 1, 0.4) },
        { time: 1.0, color: new BABYLON.Color4(1, 1, 1, 0) }
      ],
      rampGradients: [
        { time: 0.0, color: new BABYLON.Color3(0.8, 0.8, 0.8) },
        { time: 0.5, color: new BABYLON.Color3(0.6, 0.6, 0.6) },
        { time: 1.0, color: new BABYLON.Color3(0.4, 0.4, 0.4) }
      ],
      useRampGradients: true,
      limitVelocityGradients: [
        { time: 0, limit: 6 },
        { time: 0.5, limit: 3 },
        { time: 1.0, limit: 1 }
      ],
      limitVelocityDamping: 0.95
    }
  };
  
  // Initialize the FX system
  fx.init = function(gameScene) {
    scene = gameScene;
    // console.log('FX system initialized');
    
    // Enable particle testing with keyboard shortcuts
    fx.setupParticleTesting();
  };
  
  // Launch barrel explosion on T key
  function LaunchBarrel() {
    if(event.keyCode == 84) { // T key
      // Create random position
      var min = -10.0;
      var max = 10.0;
      var randPosX = Math.random() * (max - min) + min;
      var randPosZ = Math.random() * (max - min) + min;
      Explode(new BABYLON.Vector3(randPosX, 0.0, randPosZ));
    }
  }
  
  // Create explosion at impact point
  function Explode(impact, scale = 1.0) {
    // Create default particle systems
    var fireBlast = BABYLON.ParticleHelper.CreateDefault(impact, 100 * scale);

    // Emitter
    var fireBlastHemisphere = fireBlast.createHemisphericEmitter(.2 * scale, 0);

    // Set emission rate
    fireBlast.emitRate = 5000 * scale;

    // Start size
    fireBlast.minSize = 1 * scale;
    fireBlast.maxSize = 2 * scale;

    // Lifetime
    fireBlast.minLifeTime = 1 * scale;
    fireBlast.maxLifeTime = 3 * scale;

    // Emission power
    fireBlast.minEmitPower = 30 * scale;
    fireBlast.maxEmitPower = 60 * scale;

    // Limit velocity over time
    fireBlast.addLimitVelocityGradient(0, 40);
    fireBlast.addLimitVelocityGradient(0.120, 12.983);
    fireBlast.addLimitVelocityGradient(0.445, 1.780);
    fireBlast.addLimitVelocityGradient(0.691, 0.502);
    fireBlast.addLimitVelocityGradient(0.930, 0.05);
    fireBlast.addLimitVelocityGradient(1.0, 0);

    fireBlast.limitVelocityDamping = 0.9;

    // Start rotation
    fireBlast.minInitialRotation = -Math.PI / 2;
    fireBlast.maxInitialRotation = Math.PI / 2;

    // Texture
    fireBlast.particleTexture = new BABYLON.Texture("assets/images/explosion.png", scene);
    fireBlast.blendMode = BABYLON.ParticleSystem.BLENDMODE_MULTIPLYADD; 

    // Color over life
    fireBlast.addColorGradient(0.0, new BABYLON.Color4(1, 1, 1, 0));
    fireBlast.addColorGradient(0.1, new BABYLON.Color4(1, 1, 1, 1));
    fireBlast.addColorGradient(0.9, new BABYLON.Color4(1, 1, 1, 1));
    fireBlast.addColorGradient(1.0, new BABYLON.Color4(1, 1, 1, 0));

    // Defines the color ramp to apply
    fireBlast.addRampGradient(0.0, new BABYLON.Color3(1, 1, 1));
    fireBlast.addRampGradient(0.09, new BABYLON.Color3(209/255, 204/255, 15/255));
    fireBlast.addRampGradient(0.18, new BABYLON.Color3(221/255, 120/255, 14/255));
    fireBlast.addRampGradient(0.28, new BABYLON.Color3(200/255, 43/255, 18/255));
    fireBlast.addRampGradient(0.47, new BABYLON.Color3(115/255, 22/255, 15/255));
    fireBlast.addRampGradient(0.88, new BABYLON.Color3(14/255, 14/255, 14/255));
    fireBlast.addRampGradient(1.0, new BABYLON.Color3(14/255, 14/255, 14/255));
    fireBlast.useRampGradients = true;

    // Defines the color remapper over time
    fireBlast.addColorRemapGradient(0, 0, 0.1);
    fireBlast.addColorRemapGradient(0.2, 0.1, 0.8);
    fireBlast.addColorRemapGradient(0.3, 0.2, 0.85);
    fireBlast.addColorRemapGradient(0.35, 0.4, 0.85);
    fireBlast.addColorRemapGradient(0.4, 0.5, 0.9);
    fireBlast.addColorRemapGradient(0.5, 0.95, 1.0);
    fireBlast.addColorRemapGradient(1.0, 0.95, 1.0);

    // Particle system start
    fireBlast.start(30);
    fireBlast.targetStopDuration = .4;

    // Animation update speed
    fireBlast.updateSpeed = 1/60;

    // Rendering order
    fireBlast.renderingGroupId = 1;
  }
  
  // Apply scale to particle options
  function applyParticleScale(options, preset) {
    const scale = options.scale || 1.0;
    const scaledOptions = Object.assign({}, options);
    
    // Scale particle properties
    if (preset.emitRate) scaledOptions.emitRate = (options.emitRate || preset.emitRate) * scale;
    if (preset.minSize) scaledOptions.minSize = (options.minSize || preset.minSize) * scale;
    if (preset.maxSize) scaledOptions.maxSize = (options.maxSize || preset.maxSize) * scale;
    if (preset.minEmitPower) scaledOptions.minEmitPower = (options.minEmitPower || preset.minEmitPower) * scale;
    if (preset.maxEmitPower) scaledOptions.maxEmitPower = (options.maxEmitPower || preset.maxEmitPower) * scale;
    if (preset.hemisphereRadius) scaledOptions.hemisphereRadius = (options.hemisphereRadius || preset.hemisphereRadius) * scale;
    
    return scaledOptions;
  }
  
  // Create a particle system from a preset
  function createParticleSystem(preset, position, options = {}) {
    if (!scene) {
      console.warn('FX system not initialized');
      return null;
    }
    
    const config = Object.assign({}, preset, options);
    const particleCount = config.particleCount || 100;
    
    // Create particle system
    const particleSystem = new BABYLON.ParticleSystem("particleSystem", particleCount, scene);
    
    // Set emitter - use point emitter for fire (more upward), hemispheric for others
    let emitter;
    if (config.direction1 && config.direction2) {
      // Use point emitter for fire effects (more control over direction)
      emitter = particleSystem.createPointEmitter(config.direction1, config.direction2);
    } else {
      // Use hemispheric emitter for other effects
      emitter = particleSystem.createHemisphericEmitter(config.hemisphereRadius || 0.2, 0);
    }
    particleSystem.emitter = emitter;
    particleSystem.emitter.position = position.clone();
    
    // Set emit box for directional control
    if (config.minEmitBox && config.maxEmitBox) {
      particleSystem.minEmitBox = config.minEmitBox;
      particleSystem.maxEmitBox = config.maxEmitBox;
    }
    
    // Basic properties
    particleSystem.emitRate = config.emitRate;
    particleSystem.minSize = config.minSize;
    particleSystem.maxSize = config.maxSize;
    particleSystem.minLifeTime = config.minLifeTime;
    particleSystem.maxLifeTime = config.maxLifeTime;
    particleSystem.minEmitPower = config.minEmitPower;
    particleSystem.maxEmitPower = config.maxEmitPower;
    particleSystem.minInitialRotation = config.minInitialRotation;
    particleSystem.maxInitialRotation = config.maxInitialRotation;
    particleSystem.blendMode = config.blendMode;
    
    // Texture
    if (config.texture) {
      particleSystem.particleTexture = new BABYLON.Texture(config.texture, scene);
    }
    
    // Color gradients
    if (config.colorGradients) {
      config.colorGradients.forEach(gradient => {
        particleSystem.addColorGradient(gradient.time, gradient.color);
      });
    }
    
    // Ramp gradients
    if (config.rampGradients) {
      config.rampGradients.forEach(gradient => {
        particleSystem.addRampGradient(gradient.time, gradient.color);
      });
      particleSystem.useRampGradients = config.useRampGradients || false;
    }
    
    // Velocity limits
    if (config.limitVelocityGradients) {
      config.limitVelocityGradients.forEach(gradient => {
        particleSystem.addLimitVelocityGradient(gradient.time, gradient.limit);
      });
      particleSystem.limitVelocityDamping = config.limitVelocityDamping || 0.9;
    }
    
    // Rendering order
    particleSystem.renderingGroupId = config.renderingGroupId || 1;
    
    return particleSystem;
  }
  
  // Attach multiple particle effects to a building
  fx.attachMultipleParticleEffects = function(building, effects) {
    if (!building || !building.mesh) {
      console.warn('Building or building mesh not found');
      return [];
    }
    
    const attachedEffects = [];
    
    effects.forEach(effect => {
      const particleSystem = fx.attachParticleEffect(
        building, 
        effect.type, 
        effect.anchor, 
        effect.options || {}
      );
      
      if (particleSystem) {
        attachedEffects.push(particleSystem);
      }
    });
    
    // console.log(`🔥 Attached ${attachedEffects.length} particle effects to ${building.name}`);
    return attachedEffects;
  };
  
  // Attach particle effect to a building using named anchor mesh
  fx.attachParticleEffect = function(building, effectType, anchorName = "particle_anchor", options = {}) {
    if (!building || !building.mesh) {
      // console.warn('Building or building mesh not found');
      return null;
    }
    
    const preset = ParticlePresets[effectType];
    if (!preset) {
      // console.warn(`Particle preset '${effectType}' not found`);
      return null;
    }
    
    // Find the anchor mesh by name
    let anchorMesh = null;
    if (anchorName) {
      anchorMesh = findMeshByName(building.mesh, anchorName);
      if (!anchorMesh) {
        // console.warn(`Anchor mesh '${anchorName}' not found in building ${building.name}`);
        // console.log(`Available meshes in ${building.name}:`);
        debugMeshNames(building.mesh);
        
        // Try alternative names
        const alternatives = ['fire_anchor', 'smoke_anchor', 'torch_anchor', 'particle_anchor', 'anchor', 'empty'];
        for (let altName of alternatives) {
          const altMesh = findMeshByName(building.mesh, altName);
          if (altMesh) {
            // console.log(`Found alternative anchor: '${altName}', using that instead`);
            anchorMesh = altMesh;
            break;
          }
        }
        
        // Final fallback - skip if no suitable anchor found
        if (!anchorMesh) {
          // console.log(`No suitable anchor found for ${building.name}, skipping particle effect`);
          return null;
        }
      }
    } else {
      anchorMesh = building.mesh;
    }
    
    // Get anchor position
    const anchorPosition = anchorMesh.getAbsolutePosition();
    
    // Apply scale to options
    const scaledOptions = applyParticleScale(options, preset);
    
    // Create particle system
    const particleSystem = createParticleSystem(preset, anchorPosition, scaledOptions);
    if (!particleSystem) {
      return null;
    }
    
    // Make the particle system follow the anchor mesh
    particleSystem.emitter = anchorMesh;
    
    // Store reference on building
    if (!building.particleEffects) {
      building.particleEffects = [];
    }
    building.particleEffects.push({
      system: particleSystem,
      type: effectType,
      anchor: anchorName
    });
    
    // Start the particle system
    particleSystem.start();
    
    // console.log(`🔥 Attached ${effectType} particle effect to ${building.name} at anchor '${anchorName}' (scale: ${options.scale || 1.0})`);
    return particleSystem;
  }
  
  // Find a mesh by name in a hierarchy
  function findMeshByName(rootMesh, name) {
    // Check exact match first
    if (rootMesh.name === name) {
      return rootMesh;
    }
    
    // Check for "Clone of " prefix (from model instancing)
    if (rootMesh.name === `Clone of ${name}`) {
      return rootMesh;
    }
    
    // Check for Blender duplicate naming patterns (smoke_anchor.001, smoke_anchor.002, etc.)
    if (rootMesh.name.startsWith(name + '.') && /^\d+$/.test(rootMesh.name.substring(name.length + 1))) {
      return rootMesh;
    }
    
    // Check for "Clone of " + Blender duplicate pattern
    if (rootMesh.name.startsWith(`Clone of ${name}.`) && /^\d+$/.test(rootMesh.name.substring(`Clone of ${name}.`.length))) {
      return rootMesh;
    }
    
    // Check if the name ends with the target name (for other prefixes)
    if (rootMesh.name.endsWith(name)) {
      return rootMesh;
    }
    
    for (let child of rootMesh.getChildMeshes()) {
      const found = findMeshByName(child, name);
      if (found) {
        return found;
      }
    }
    
    return null;
  }
  
  // Debug function to list all mesh names in a building
  function debugMeshNames(rootMesh, depth = 0) {
    const indent = "  ".repeat(depth);
    // console.log(`${indent}Mesh: "${rootMesh.name}" (${rootMesh.constructor.name})`);
    
    for (let child of rootMesh.getChildMeshes()) {
      debugMeshNames(child, depth + 1);
    }
  }
  
  // Remove particle effects from a building
  fx.removeParticleEffects = function(building, effectType = null) {
    if (!building || !building.particleEffects) {
      return;
    }
    
    const effectsToRemove = effectType 
      ? building.particleEffects.filter(effect => effect.type === effectType)
      : building.particleEffects;
    
    effectsToRemove.forEach(effect => {
      effect.system.stop();
      effect.system.dispose();
    });
    
    if (effectType) {
      building.particleEffects = building.particleEffects.filter(effect => effect.type !== effectType);
    } else {
      building.particleEffects = [];
    }
    
    console.log(`🔥 Removed ${effectType || 'all'} particle effects from ${building.name}`);
  }
  
  // Create a simple particle effect at a position
  fx.createParticleEffect = function(effectType, position, options = {}) {
    const preset = ParticlePresets[effectType];
    if (!preset) {
      console.warn(`Particle preset '${effectType}' not found`);
      return null;
    }
    
    // Apply scale to options
    const scaledOptions = applyParticleScale(options, preset);
    
    const particleSystem = createParticleSystem(preset, position, scaledOptions);
    if (particleSystem) {
      particleSystem.start();
    }
    
    return particleSystem;
  }
  
  // Public API for creating explosions
  fx.createExplosion = function(position, scale = 1.0) {
    if (!scene) {
      // console.warn('FX system not initialized');
      return;
    }
    // console.log(`💥 Creating explosion with scale: ${scale}`);
    Explode(position, scale);
  };
  
  // Public API for launching barrel (spacebar)
  fx.setupBarrelLauncher = function() {
    document.addEventListener('keydown', LaunchBarrel);
  };
  
  // Setup explosion scale testing with keyboard shortcuts
  fx.setupExplosionScaleTesting = function() {
    document.addEventListener('keydown', function(e) {
      // Test different explosion scales with number keys
      if (e.key >= '1' && e.key <= '9') {
        const scale = parseFloat(e.key);
        const position = new BABYLON.Vector3(0, 0, 0);
        console.log(`🎮 Testing explosion scale ${scale} at position ${position}`);
        fx.createExplosion(position, scale);
      }
    });
    // console.log('💥 Explosion scale testing enabled! Press 1-9 for different scales');
  };
  
  // Setup particle effect testing with keyboard shortcuts
  fx.setupParticleTesting = function() {
    document.addEventListener('keydown', function(e) {
      // Test particle effects with F key
      if (e.key === 'f' || e.key === 'F') {
        const position = new BABYLON.Vector3(0, 0, 0);
        // console.log('🔥 Testing particle effects (F key)');
        fx.testParticleEffects(position);
      }
      
      // Test building particle effects with B key
      if (e.key === 'b' || e.key === 'B') {
        // console.log('🏗️ Testing building particle effects (B key)');
        fx.testBuildingEffects();
      }
      
      // P key - Explosion at mouse position that damages buildings
      if (e.key === 'p' || e.key === 'P') {
        fx.explodeAtMouse();
      }
      
      // Test individual effects
      if (e.key === '1') {
        const position = new BABYLON.Vector3(0, 0, 0);
        fx.createParticleEffect('fire', position);
        // console.log('🔥 Created fire effect');
      }
      
      if (e.key === '2') {
        const position = new BABYLON.Vector3(0, 0, 0);
        fx.createParticleEffect('smoke', position);
        // console.log('💨 Created smoke effect');
      }
    });
    // console.log('🔥 Particle testing enabled! Press F for all effects, B for building effects, P for explosion at mouse, 1 for fire, 2 for smoke');
  };
  
  // Get available particle effect types
  fx.getAvailableEffects = function() {
    return Object.keys(ParticlePresets);
  };
  
  // Add a new particle preset
  fx.addParticlePreset = function(name, preset) {
    ParticlePresets[name] = preset;
    // console.log(`🔥 Added particle preset: ${name}`);
  };
  
  // Test particle effects (for debugging)
  fx.testParticleEffects = function(position = new BABYLON.Vector3(0, 0, 0)) {
    if (!scene) {
      console.warn('FX system not initialized');
      return;
    }
    
    // console.log('🔥 Testing particle effects...');
    
    // Test fire effect
    setTimeout(() => {
      fx.createParticleEffect('fire', position.clone().add(new BABYLON.Vector3(-5, 0, 0)));
    }, 0);
    
    // Test smoke effect
    setTimeout(() => {
      fx.createParticleEffect('smoke', position.clone().add(new BABYLON.Vector3(5, 0, 0)));
    }, 1000);
  };
  
  // Test building particle effects
  fx.testBuildingEffects = function() {
    if (!window.gameBuildings || window.gameBuildings.length === 0) {
      console.warn('No buildings available for testing');
      return;
    }
    
    // console.log('🔥 Testing building particle effects...');
    
    // Test with the first building
    const building = window.gameBuildings[0];
    if (building) {
      // Add fire effect
      fx.attachParticleEffect(building, 'fire', 'fire_anchor', {
        emitRate: 50,
        minSize: 2,
        maxSize: 4
      });
      
      // Add smoke effect after 2 seconds
      setTimeout(() => {
        fx.attachParticleEffect(building, 'smoke', 'smoke_anchor', {
          emitRate: 30,
          minSize: 3,
          maxSize: 5
        });
      }, 2000);
    }
  };
  
  // Debug function to inspect building mesh structure
  fx.debugBuildingMeshes = function(buildingName = null) {
    if (!window.gameBuildings || window.gameBuildings.length === 0) {
      console.warn('No buildings available for debugging');
      return;
    }
    
    const buildings = buildingName 
      ? window.gameBuildings.filter(b => b.name.toLowerCase().includes(buildingName.toLowerCase()))
      : window.gameBuildings;
    
    if (buildings.length === 0) {
      console.warn(`No buildings found matching '${buildingName}'`);
      return;
    }
    
    buildings.forEach(building => {
      // console.log(`\n🏗️ Building: ${building.name}`);
      // console.log('Mesh hierarchy:');
      debugMeshNames(building.mesh);
    });
  };
  
  // Explode at mouse position and damage nearby buildings
  fx.explodeAtMouse = function() {
    // console.log('💥 P key pressed - attempting explosion at mouse position');
    
    if (!scene || !window.gfx || !window.gfx.camera) {
      // console.warn('Scene or camera not available for explosion');
      return;
    }
    
    // console.log(`Mouse position: ${scene.pointerX}, ${scene.pointerY}`);
    
    // Get mouse position in world coordinates
    const pickInfo = scene.pick(scene.pointerX, scene.pointerY);
    let explosionPosition;
    
    if (pickInfo && pickInfo.pickedPoint) {
      explosionPosition = pickInfo.pickedPoint;
      // console.log('Picked point:', explosionPosition);
    } else {
      // Fallback: project mouse to ground plane
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, window.gfx.camera);
      const groundY = 0;
      const t = (groundY - ray.origin.y) / ray.direction.y;
      explosionPosition = ray.origin.add(ray.direction.scale(t));
      // console.log('Ray projected to ground:', explosionPosition);
    }
    
    // console.log(`💥 Exploding at mouse position:`, explosionPosition);
    
    // Create explosion effect
    fx.createExplosion(explosionPosition, 1.0);
    
    // Damage nearby buildings
    const explosionRadius = 15; // Damage radius
    const damageAmount = 33; // 1/3 of building health
    
    if (window.gameBuildings && window.gameBuildings.length > 0) {
      // console.log(`Checking ${window.gameBuildings.length} buildings for damage`);
      
      window.gameBuildings.forEach(building => {
        if (!building.mesh) {
          // console.log(`Building ${building.name} has no mesh, skipping`);
          return;
        }
        
        const buildingPos = building.mesh.getAbsolutePosition();
        const distance = BABYLON.Vector3.Distance(explosionPosition, buildingPos);
        
        // console.log(`Building ${building.name} at distance ${distance.toFixed(2)} (radius: ${explosionRadius})`);
        
        if (distance <= explosionRadius) {
          // Calculate damage based on distance
          const damageMultiplier = 1 - (distance / explosionRadius);
          const actualDamage = Math.floor(damageAmount * damageMultiplier);
          
          // Apply damage
          building.health = Math.max(0, building.health - actualDamage);
          
          // console.log(`💥 Damaged ${building.name}: ${actualDamage} damage (${building.health}/${building.maxHealth} health remaining)`);
          
          // Add damage effects
          addBuildingDamageEffects(building);
          
          // Check if building should be destroyed
          if (building.health <= 0) {
            destroyBuilding(building);
          }
        }
      });
    } else {
      // console.log('No buildings found to damage');
    }
  };
  
  // Add damage effects to a building
  function addBuildingDamageEffects(building) {
    if (!building.mesh) return;
    
    // Find available anchor points first
    const availableAnchors = [];
    building.mesh.getChildMeshes().forEach(mesh => {
      if (mesh.name.toLowerCase().includes('anchor')) {
        availableAnchors.push(mesh.name);
      }
    });
    
    // console.log(`📍 Available anchors for ${building.name}:`, availableAnchors);
    
    // Helper to find best matching anchor
    function findBestAnchor(preferredTypes) {
      for (const type of preferredTypes) {
        const match = availableAnchors.find(name => 
          name.toLowerCase().includes(type.toLowerCase()));
        if (match) return match;
      }
      // Fallback to any anchor if no matches
      return availableAnchors[0];
    }
    
    // Add fire effect for damaged buildings
    if (building.health < building.maxHealth * 0.5) {
      const hasFire = building.particleEffects && 
                     building.particleEffects.some(effect => effect.type === 'fire');
      if (!hasFire && availableAnchors.length > 0) {
        // Try to find best fire anchor
        const fireAnchor = findBestAnchor(['fire_anchor', 'particle_anchor', 'smoke_anchor']);
        if (fireAnchor) {
          // console.log(`🔥 Using ${fireAnchor} for fire effect on ${building.name}`);
          fx.attachParticleEffect(building, 'fire', fireAnchor, {
            scale: 0.5,
            emitRate: 30,
            minSize: 0.5,
            maxSize: 1.0
          });
        }
      }
    }
    
    // Add smoke effect for damaged buildings
    if (building.health < building.maxHealth * 0.8) {
      const hasSmoke = building.particleEffects && 
                      building.particleEffects.some(effect => effect.type === 'smoke');
      if (!hasSmoke && availableAnchors.length > 0) {
        // Try to find best smoke anchor
        const smokeAnchor = findBestAnchor(['smoke_anchor', 'particle_anchor', 'fire_anchor']);
        if (smokeAnchor) {
          console.log(`💨 Using ${smokeAnchor} for smoke effect on ${building.name}`);
          fx.attachParticleEffect(building, 'smoke', smokeAnchor, {
            scale: 0.8,
            emitRate: 40,
            minSize: 1.0,
            maxSize: 2.0
          });
        }
      }
    }
  }
  
  // "Graveyard" to hold destroyed buildings
  const destroyedBuildings = new Set();

  // Destroy a building completely
  function destroyBuilding(building) {
    if (!building || destroyedBuildings.has(building)) return;
    
    // console.log(`💥 Destroying building: ${building.name}`);
    
    try {
      // Store position for effects
      const position = building.position ? new BABYLON.Vector3(building.position.x, building.position.y, building.position.z) : null;

      // 1. Handle any existing particle effects first
      if (building.particleEffects) {
        building.particleEffects.forEach(effect => {
          if (effect.system) {
            effect.system.emitter = null; // Detach from mesh first
            effect.system.stop();
            effect.system.dispose();
          }
        });
        building.particleEffects = [];
      }

      // 2. Check for and cleanup any scene particle systems using this mesh
      if (scene && building.mesh) {
        scene.particleSystems.slice().forEach(system => {
          // Check if system is using this building's mesh or any of its children
          const isUsingMesh = system.emitter === building.mesh || 
                            building.mesh.getChildMeshes().some(mesh => system.emitter === mesh);
          if (isUsingMesh) {
            system.emitter = null; // Detach from mesh
            system.stop();
            system.dispose();
          }
        });
      }

      // 3. Move the building and all its parts far away
      if (building.mesh) {
        const allMeshes = [building.mesh, ...building.mesh.getChildMeshes()];
        allMeshes.forEach(mesh => {
          // Move way below ground
          mesh.position.y = -10000;
          // Scale to 0
          mesh.scaling = new BABYLON.Vector3(0.0001, 0.0001, 0.0001); // Tiny but not quite 0
          // Disable picking and collisions
          mesh.isPickable = false;
          mesh.checkCollisions = false;
          // Disable all animations
          if (scene) {
            scene.stopAnimation(mesh);
          }
          // Clear any observers
          mesh.observers = [];
        });
      }

      // 2. Remove from game buildings array
      if (window.gameBuildings) {
        const index = window.gameBuildings.indexOf(building);
        if (index > -1) {
          window.gameBuildings.splice(index, 1);
        }
      }

      // 3. Clear worker references
      if (building.assignedWorkers) {
        building.assignedWorkers.forEach(worker => {
          worker.assignedBuilding = null;
          if (window.behaviorManager) {
            window.behaviorManager.clearBehavior(worker);
          }
        });
        building.assignedWorkers = [];
      }

      // 4. Mark as destroyed
      destroyedBuildings.add(building);
      building.isDestroyed = true;

      // 5. Create destruction effects at the original position
      if (position) {
        requestAnimationFrame(() => {
          fx.createExplosion(position, 0.8);
          fx.createParticleEffect('smoke', position, { scale: 1.5, emitRate: 100 });
          fx.createParticleEffect('fire', position, { scale: 1.2, emitRate: 80 });
        });
      }

      console.log(`🗑️ Building ${building.name} hidden and marked as destroyed`);

    } catch (error) {
      console.error('Error during building destruction:', error);
    }
  };
  
  // Clean up
  fx.dispose = function() {
    document.removeEventListener('keydown', LaunchBarrel);
  };
  
}(window.fx = window.fx || {}));
