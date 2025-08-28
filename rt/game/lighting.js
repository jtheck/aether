// Orbital Lighting System - Day/Night Cycle with Sun and Moon
(function(lighting) {
  
  // Lighting configuration
  let config = {
    sunTime: 0.4,        // Independent sun position (0-1) - morning sun
    moonTime: 0.6,       // Independent moon position (0-1) - afternoon moon
    cycleSpeed: 0.001,   // How fast time progresses (adjust for faster/slower days)
    orbitRadius: 200,    // How far the lights orbit from center
    orbitHeight: 100,    // Maximum height of the orbit
    orbitTilt: 0.3,      // Tilt of the orbital plane (0 = flat, 1 = vertical)
    autoAdvance: false   // Whether time automatically progresses
  };
  
  // Light references
  let lights = {
    sun: null,
    moon: null,
    ambient: null,
    scene: null
  };
  
  // Initialize the orbital lighting system
  lighting.init = function(scene) {
    lights.scene = scene;
    
    // Create sun (directional light)
    lights.sun = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(0, -1, 0), scene);
    lights.sun.intensity = 0.9;
    lights.sun.specularScale = 1.0; // Increase for better reflections
    lights.sun.diffuse = new BABYLON.Color3(1, 0.95, 0.8); // Warm sunlight
    lights.sun.specular = new BABYLON.Color3(1, 0.95, 0.8); // Match diffuse for proper reflections
    
    // Create moon as ambient lighting (this is what we actually see as moonlight)
    lights.moon = new BABYLON.HemisphericLight("moonLight", new BABYLON.Vector3(0, 1, 0), scene);
    lights.moon.intensity = 0.2;
    lights.moon.diffuse = new BABYLON.Color3(0.7, 0.8, 1); // Cool moonlight
    lights.moon.specular = new BABYLON.Color3(0.7, 0.8, 1);
    
    // Set ambient color for additional base lighting
    scene.ambientColor = new BABYLON.Color3(0.1, 0.1, 0.15);
    
    // Set initial positions
    updateOrbitalPositions();
    
    console.log('Orbital lighting system initialized');
  };
  
  // Configure the orbital system
  lighting.configure = function(newConfig) {
    Object.assign(config, newConfig);
    if (lights.scene) {
      updateOrbitalPositions();
    }
  };
  
  // Update orbital positions based on time of day
  function updateOrbitalPositions() {
    if (!lights.sun || !lights.moon) return;
    
    // Calculate sun position independently
    const sunAngle = (config.sunTime - 0.25) * Math.PI * 2; // -0.25 offset so 0.5 = zenith
    
    // Calculate sun's imaginary position on the orbital plane
    const sunX = Math.cos(sunAngle) * config.orbitRadius;
    const sunY = Math.sin(sunAngle) * config.orbitHeight;
    const sunZ = Math.cos(sunAngle) * config.orbitRadius * config.orbitTilt;
    
    // Sun direction: from imaginary orbital position pointing toward center (0,0,0)
    const sunDirection = new BABYLON.Vector3(-sunX, -sunY, -sunZ).normalize();
    lights.sun.direction = sunDirection;
    
    // Calculate moon position independently  
    const moonAngle = (config.moonTime - 0.25) * Math.PI * 2; // Same calculation as sun
    const moonX = Math.cos(moonAngle) * config.orbitRadius;
    const moonY = Math.sin(moonAngle) * config.orbitHeight;
    const moonZ = Math.cos(moonAngle) * config.orbitRadius * config.orbitTilt;
    
    // Moon direction: HemisphericLight direction follows orbital movement
    const moonDirection = new BABYLON.Vector3(moonX, moonY, moonZ).normalize();
    lights.moon.direction.copyFrom(moonDirection);
    
    // Adjust light intensities based on each light's height above horizon
    const sunHeightFactor = Math.sin(sunAngle); // -1 to 1, negative when below horizon
    const moonHeightFactor = Math.sin(moonAngle); // -1 to 1, negative when below horizon
    
    const sunDayFactor = Math.max(0, sunHeightFactor); // 0 to 1 (sun visible)
    const moonNightFactor = Math.max(0, moonHeightFactor); // 0 to 1 (moon visible)
    
    // Sun intensity based on its position
    lights.sun.intensity = sunDayFactor * 0.9;
    
    // Moon intensity based on its position
    lights.moon.intensity = 0.1 + (moonNightFactor * 0.3);
    
    // Sky color changes based on dominant light (use sun for sky color)
    updateSkyColor(sunDayFactor, Math.max(0, -sunHeightFactor));
  }
  
  // Update sky color based on time of day
  function updateSkyColor(dayFactor, nightFactor) {
    if (!lights.scene) return;
    
    // Interpolate between day and night sky colors
    const dayColor = new BABYLON.Color3(0.5, 0.7, 1); // Light blue
    const nightColor = new BABYLON.Color3(0.02, 0.03, 0.15); // Dark blue
    const sunsetColor = new BABYLON.Color3(0.8, 0.4, 0.2); // Orange
    
    // Create sunset/sunrise effect when sun is near horizon
    const sunsetFactor = Math.max(0, 1 - Math.abs(dayFactor - 0.3) * 3);
    
    let skyColor = dayColor.scale(dayFactor)
                          .add(nightColor.scale(nightFactor))
                          .add(sunsetColor.scale(sunsetFactor * 0.3));
    
    lights.scene.clearColor = skyColor;
  }
  
  // Update the lighting system (call from main loop)
  lighting.update = function(deltaTime) {
    if (config.autoAdvance) {
      config.timeOfDay += config.cycleSpeed * deltaTime;
      if (config.timeOfDay > 1) config.timeOfDay -= 1; // Wrap around
    }
    
    updateOrbitalPositions();
  };
  
  // Get current time info
  lighting.getTimeInfo = function() {
    return {
      timeOfDay: config.timeOfDay,
      isDaytime: config.timeOfDay > 0.25 && config.timeOfDay < 0.75,
      sunAngle: config.timeOfDay * Math.PI * 2,
      phase: getTimePhase()
    };
  };
  
  // Get descriptive time phase
  function getTimePhase() {
    const t = config.timeOfDay;
    if (t < 0.2 || t > 0.8) return 'night';
    if (t < 0.3) return 'dawn';
    if (t < 0.7) return 'day';
    return 'dusk';
  }
  
  // Set sun position independently (0-1)
  lighting.setSunTime = function(time) {
    config.sunTime = Math.max(0, Math.min(1, time));
    updateOrbitalPositions();
  };
  
  // Set moon position independently (0-1)
  lighting.setMoonTime = function(time) {
    config.moonTime = Math.max(0, Math.min(1, time));
    updateOrbitalPositions();
  };
  
  // Set both at once for convenience
  lighting.setBothTimes = function(sunTime, moonTime) {
    config.sunTime = Math.max(0, Math.min(1, sunTime));
    config.moonTime = Math.max(0, Math.min(1, moonTime));
    updateOrbitalPositions();
  };
  
  // Legacy method - sets sun time for backward compatibility
  lighting.setTimeOfDay = function(time) {
    lighting.setSunTime(time);
  };
  
  // Toggle auto-advance
  lighting.toggleAutoAdvance = function() {
    config.autoAdvance = !config.autoAdvance;
    console.log('Time auto-advance:', config.autoAdvance ? 'enabled' : 'disabled');
  };
  
}(window.lighting = window.lighting || {}));
