// Particle Effects System
(function(fx) {
  
  let scene = null;
  
  // Initialize the FX system
  fx.init = function(gameScene) {
    scene = gameScene;
    console.log('FX system initialized');
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
  function Explode(impact) {
    // Create default particle systems
    var fireBlast = BABYLON.ParticleHelper.CreateDefault(impact, 100);

    // Emitter
    var fireBlastHemisphere = fireBlast.createHemisphericEmitter(.2, 0);

    // Set emission rate
    fireBlast.emitRate = 5000;

    // Start size
    fireBlast.minSize = 6;
    fireBlast.maxSize = 12;

    // Lifetime
    fireBlast.minLifeTime = 1;
    fireBlast.maxLifeTime = 3;

    // Emission power
    fireBlast.minEmitPower = 30;
    fireBlast.maxEmitPower = 60;

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
  
  // Public API for creating explosions
  fx.createExplosion = function(position) {
    if (!scene) {
      console.warn('FX system not initialized');
      return;
    }
    Explode(position);
  };
  
  // Public API for launching barrel (spacebar)
  fx.setupBarrelLauncher = function() {
    document.addEventListener('keydown', LaunchBarrel);
  };
  
  // Clean up
  fx.dispose = function() {
    document.removeEventListener('keydown', LaunchBarrel);
  };
  
}(window.fx = window.fx || {}));
