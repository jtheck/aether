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
    lights.sun.specularScale = 0.8; // Moderate specular for subtle reflections
    lights.sun.diffuse = new BABYLON.Color3(1, 0.95, 0.8); // Warm sunlight
    lights.sun.specular = new BABYLON.Color3(0.6, 0.55, 0.5); // Moderate warm specular for subtle sun reflections
    
    // Ensure sun can cast shadows
    lights.sun.shadowEnabled = true;
    // Provide a generous shadow range to cover the whole battlefield
    if (typeof lights.sun.shadowMinZ === 'number') {
      lights.sun.shadowMinZ = -500;
    }
    if (typeof lights.sun.shadowMaxZ === 'number') {
      lights.sun.shadowMaxZ = 2000;
    }
    
    // Ensure light is enabled
    if (lights.sun.setEnabled) {
      lights.sun.setEnabled(true);
    }
    lights.sun.enabled = true;
    
    // Moon light removed for better performance and simpler lighting
    // The scene ambient color provides sufficient base lighting
    lights.moon = null;
    
    // Set ambient color for additional base lighting (slightly brighter so ground isn't too dark)
    scene.ambientColor = new BABYLON.Color3(0.3, 0.3, 0.35);
    
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

  // Set sun to a strong, angled daytime position for clearly visible shadows
  lighting.setDramaticSunAngle = function() {
    // Use a fixed, slightly off‑noon angle so shadows are clearly visible
    // without the sun feeling extremely low on the horizon.
    const selectedTime = 0.4; // Firm mid‑morning angle
    lighting.setSunTime(selectedTime);
    // console.log(`🌅 Set daytime sun angle at fixed time: ${selectedTime.toFixed(2)}`);
  };
  
  // Update orbital positions based on time of day
  function updateOrbitalPositions(cameraPosition) {
    if (!lights.sun) return;
    
    // Ensure light is enabled
    if (lights.sun.setEnabled) {
      lights.sun.setEnabled(true);
    }
    lights.sun.enabled = true;
    
    // Calculate sun position independently
    const sunAngle = (config.sunTime - 0.25) * Math.PI * 2; // -0.25 offset so 0.5 = zenith
    
    // Calculate sun's imaginary position on the orbital plane
    const sunX = Math.cos(sunAngle) * config.orbitRadius;
    const sunY = Math.sin(sunAngle) * config.orbitHeight;
    const sunZ = Math.sin(sunAngle) * config.orbitRadius * config.orbitTilt; // Use sin for Z to create proper orbital path
    
    // CRITICAL: Set the light's position - center it over the camera view for shadows
    // This makes shadows follow the player around the battlefield
    const shadowCenter = cameraPosition || new BABYLON.Vector3(0, 0, 0);
    lights.sun.position = new BABYLON.Vector3(
      shadowCenter.x + sunX,
      shadowCenter.y + sunY,
      shadowCenter.z + sunZ
    );
    
    // Sun direction: from imaginary orbital position pointing toward the shadow center
    const sunDirection = new BABYLON.Vector3(-sunX, -sunY, -sunZ).normalize();
    
    // Add a subtle bias to the sun direction for more interesting shadows
    sunDirection.x += 0.05; // Subtle eastward bias
    sunDirection.z += 0.02; // Subtle northward bias
    
    lights.sun.direction = sunDirection.normalize();
    
    // Adjust light intensity based on sun's height above horizon
    const sunHeightFactor = Math.sin(sunAngle); // -1 to 1, negative when below horizon
    const sunDayFactor = Math.max(0.5, sunHeightFactor); // Minimum 0.5 to ensure bright daytime
    
    // Sun intensity based on its position - ensure bright daytime
    // Ensure minimum intensity of 1.2 for visible lighting
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
  lighting.update = function(deltaTime, cameraPosition) {
    if (config.autoAdvance) {
      const currentTime = Date.now();
      
      // Only update lighting every 30 seconds to avoid constant shadow recalculations
      if (currentTime - lastLightingUpdate >= config.updateInterval) {
        config.timeOfDay += config.cycleSpeed * deltaTime;
        if (config.timeOfDay > 1) config.timeOfDay -= 1; // Wrap around
        updateOrbitalPositions(cameraPosition); // Only update when time is actually advancing
        lastLightingUpdate = currentTime;
        
        // Debug: log when lighting updates
        console.log(`🌅 Lighting updated - Time of day: ${config.timeOfDay.toFixed(3)}`);
      }
    }
    // Update shadow camera position every frame if camera moved
    if (cameraPosition && window.SHADOWS_ENABLED) {
      updateOrbitalPositions(cameraPosition);
    }
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
  
  // Restore/enable lighting if it got disabled
  lighting.restoreLighting = function() {
    if (!lights.sun) {
      console.warn('Sun light does not exist - cannot restore lighting');
      return false;
    }
    
    // Ensure light is enabled
    if (lights.sun.setEnabled) {
      lights.sun.setEnabled(true);
    }
    lights.sun.enabled = true;
    
    // Ensure minimum intensity
    if (lights.sun.intensity < 1.0) {
      lights.sun.intensity = 1.2;
    }
    
    // Ensure specular is moderate for subtle reflections
    lights.sun.specularScale = 0.8;
    lights.sun.specular = new BABYLON.Color3(0.6, 0.55, 0.5);
    
    // Update positions to ensure everything is correct
    updateOrbitalPositions();
    
    // console.log('✅ Lighting restored - sun enabled:', lights.sun.enabled, 'intensity:', lights.sun.intensity, 'specular:', lights.sun.specular);
    return true;
  };
  
  // Expose lights object for external access
  lighting.lights = lights;
  
}(window.lighting = window.lighting || {}));
