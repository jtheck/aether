// Orbital Lighting System - Day/Night Cycle with Sun and Moon
(function(lighting) {
  
  // Lighting configuration
  let config = {
    sunTime: 0.4,        // Sun position (0-1) - morning sun
    cycleSpeed: 0.0002667,  // Faster day/night cycle (1 full day = ~1 hour)
    orbitRadius: 200,    // How far the sun orbits from center
    orbitHeight: 100,    // Maximum height of the orbit
    orbitTilt: 0.3,      // Tilt of the orbital plane (0 = flat, 1 = vertical)
    autoAdvance: true,   // Enable slow day/night cycle
    updateInterval: 5000 // Update lighting every 5 seconds for testing (5000ms)
  };
  
  // Light references
  let lights = {
    sun: null,
    moon: null,
    ambient: null,
    scene: null
  };
  
  // Timing for lighting updates
  let lastLightingUpdate = 0;
  
  // Initialize the orbital lighting system
  lighting.init = function(scene) {
    lights.scene = scene;
    
    // Create sun (directional light)
    lights.sun = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(0, -1, 0), scene);
    lights.sun.intensity = 1.2; // Increased from 0.9 to compensate for no moon
    lights.sun.specularScale = 1.0; // Increase for better reflections
    lights.sun.diffuse = new BABYLON.Color3(1, 0.95, 0.8); // Warm sunlight
    lights.sun.specular = new ColorHex("#222222"); // Match diffuse for proper reflections
    
    // Moon light removed for better performance and simpler lighting
    // The scene ambient color provides sufficient base lighting
    lights.moon = null;
    
    // Set ambient color for additional base lighting (increased to compensate for no moon)
    scene.ambientColor = new BABYLON.Color3(0.25, 0.25, 0.3);
    
    // Set initial positions
    updateOrbitalPositions();
    
    // console.log('Orbital lighting system initialized');
  };
  
  // Configure the orbital system
  lighting.configure = function(newConfig) {
    Object.assign(config, newConfig);
    if (lights.scene) {
      updateOrbitalPositions();
    }
  };

  // Set sun to a daytime angle for good shadows without being too dark
  lighting.setDramaticSunAngle = function() {
    // Set sun to daytime hours only - avoid early morning/late evening darkness
    const daytimeTimes = [0.4, 0.45, 0.5, 0.55, 0.6]; // Solid daytime range
    
    // DETERMINISTIC: Use field seed instead of Math.random() for multiplayer sync
    const seed = (window.liveField && window.liveField.seed) || (window.mapSeed) || 12345;
    const seededIndex = Math.abs(seed) % daytimeTimes.length;
    const selectedTime = daytimeTimes[seededIndex];
    
    lighting.setSunTime(selectedTime);
    // console.log(`🌅 Set daytime sun angle at time: ${selectedTime.toFixed(2)} (seed: ${seed}, index: ${seededIndex})`);
  };
  
  // Update orbital positions based on time of day
  function updateOrbitalPositions() {
    if (!lights.sun) return;
    
    // Calculate sun position independently
    const sunAngle = (config.sunTime - 0.25) * Math.PI * 2; // -0.25 offset so 0.5 = zenith
    
    // Calculate sun's imaginary position on the orbital plane
    const sunX = Math.cos(sunAngle) * config.orbitRadius;
    const sunY = Math.sin(sunAngle) * config.orbitHeight;
    const sunZ = Math.sin(sunAngle) * config.orbitRadius * config.orbitTilt; // Use sin for Z to create proper orbital path
    
    // Sun direction: from imaginary orbital position pointing toward center (0,0,0)
    // Add slight offset to create more interesting shadow angles (northern hemisphere effect)
    const sunDirection = new BABYLON.Vector3(-sunX, -sunY, -sunZ).normalize();
    
    // Add a subtle bias to the sun direction for more interesting shadows
    sunDirection.x += 0.05; // Subtle eastward bias
    sunDirection.z += 0.02; // Subtle northward bias
    
    lights.sun.direction = sunDirection.normalize();
    
    // Adjust light intensity based on sun's height above horizon
    const sunHeightFactor = Math.sin(sunAngle); // -1 to 1, negative when below horizon
    const sunDayFactor = Math.max(0.5, sunHeightFactor); // Minimum 0.5 to ensure bright daytime
    
    // Sun intensity based on its position - ensure bright daytime
    lights.sun.intensity = Math.max(1.2, sunDayFactor * 1.4); // Minimum 1.2 intensity for bright daytime
    
    // Sky color changes based on dominant light (use sun for sky color)
    updateSkyColor(sunDayFactor, Math.max(0, -sunHeightFactor));
  }
  
  // Update sky color based on time of day - more dynamic and interesting
  function updateSkyColor(dayFactor, nightFactor) {
    if (!lights.scene) return;
    
    // Define a richer color palette for different times of day
    const dawnColor = new BABYLON.Color3(0.9, 0.6, 0.4);    // Warm orange-pink dawn
    const sunriseColor = new BABYLON.Color3(1.0, 0.7, 0.5); // Bright orange sunrise
    const morningColor = new BABYLON.Color3(0.6, 0.8, 1.0); // Cool blue morning
    const noonColor = new BABYLON.Color3(0.4, 0.6, 0.9);    // Deep blue noon
    const afternoonColor = new BABYLON.Color3(0.5, 0.7, 0.9); // Light blue afternoon
    const sunsetColor = new BABYLON.Color3(1.0, 0.5, 0.3);  // Vibrant orange sunset
    const twilightColor = new BABYLON.Color3(0.3, 0.2, 0.4); // Purple twilight
    const nightColor = new BABYLON.Color3(0.05, 0.05, 0.15); // Dark blue night
    
    let skyColor;
    
    // Create smooth transitions between different times of day
    if (dayFactor < 0.1) {
      // Night to dawn (0-0.1)
      const t = dayFactor * 10;
      skyColor = nightColor.scale(1 - t).add(dawnColor.scale(t));
    } else if (dayFactor < 0.2) {
      // Dawn to sunrise (0.1-0.2)
      const t = (dayFactor - 0.1) * 10;
      skyColor = dawnColor.scale(1 - t).add(sunriseColor.scale(t));
    } else if (dayFactor < 0.3) {
      // Sunrise to morning (0.2-0.3)
      const t = (dayFactor - 0.2) * 10;
      skyColor = sunriseColor.scale(1 - t).add(morningColor.scale(t));
    } else if (dayFactor < 0.5) {
      // Morning to noon (0.3-0.5)
      const t = (dayFactor - 0.3) * 5;
      skyColor = morningColor.scale(1 - t).add(noonColor.scale(t));
    } else if (dayFactor < 0.7) {
      // Noon to afternoon (0.5-0.7)
      const t = (dayFactor - 0.5) * 5;
      skyColor = noonColor.scale(1 - t).add(afternoonColor.scale(t));
    } else if (dayFactor < 0.8) {
      // Afternoon to sunset (0.7-0.8)
      const t = (dayFactor - 0.7) * 10;
      skyColor = afternoonColor.scale(1 - t).add(sunsetColor.scale(t));
    } else if (dayFactor < 0.9) {
      // Sunset to twilight (0.8-0.9)
      const t = (dayFactor - 0.8) * 10;
      skyColor = sunsetColor.scale(1 - t).add(twilightColor.scale(t));
    } else {
      // Twilight to night (0.9-1.0)
      const t = (dayFactor - 0.9) * 10;
      skyColor = twilightColor.scale(1 - t).add(nightColor.scale(t));
    }
    
    lights.scene.clearColor = skyColor;
  }
  
  // Update the lighting system (call from main loop)
  lighting.update = function(deltaTime) {
    if (config.autoAdvance) {
      const currentTime = Date.now();
      
      // Only update lighting every 30 seconds to avoid constant shadow recalculations
      if (currentTime - lastLightingUpdate >= config.updateInterval) {
        config.timeOfDay += config.cycleSpeed * deltaTime;
        if (config.timeOfDay > 1) config.timeOfDay -= 1; // Wrap around
        updateOrbitalPositions(); // Only update when time is actually advancing
        lastLightingUpdate = currentTime;
        
        // Debug: log when lighting updates
        console.log(`🌅 Lighting updated - Time of day: ${config.timeOfDay.toFixed(3)}`);
      }
    }
    // Don't call updateOrbitalPositions() every frame when autoAdvance is false
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
  
  // Set sun position (0-1)
  lighting.setSunTime = function(time) {
    config.sunTime = Math.max(0, Math.min(1, time));
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
  
  // Test different sky colors (for debugging)
  lighting.testSkyColors = function() {
    console.log('Testing sky colors...');
    const testTimes = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 0.9, 1.0];
    testTimes.forEach(time => {
      const dayFactor = Math.max(0, Math.sin((time - 0.25) * Math.PI * 2));
      updateSkyColor(dayFactor, Math.max(0, -dayFactor));
      console.log(`Time ${time}: dayFactor ${dayFactor.toFixed(2)}`);
    });
  };
  
  // Expose lights object for external access
  lighting.lights = lights;
  
}(window.lighting = window.lighting || {}));
