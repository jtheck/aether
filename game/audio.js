// Audio Engine V2 - Babylon.js Audio System
// Handles all audio playback including villager movement sounds

(function(aud) {
  let audioEngine = null;
  let villagerMoveSounds = []; // Array of villager sounds for randomization
  let villagerBaseVolumes = [1.0, 0.85]; // Base volume multipliers for each sound (villager.ogg = 1.0, villager2.ogg = 0.85)
  let soundsLoaded = false;
  let currentVolume = 0.5; // Default 50%
  let spatialAudioEnabled = false; // Default to off for performance

  // Initialize the AudioEngineV2
  aud.init = async function() {
    try {
      // console.log('🎵 Initializing AudioEngineV2...'); // Commented out for cleaner logs

      // Create the audio engine
      audioEngine = await BABYLON.CreateAudioEngineAsync({
        audioContextOptions: {
          latencyHint: 'interactive'
        }
      });

      // Load saved volume setting (default to 25%)
      const savedVolume = localStorage.getItem('volumeLevel');
      const volumeLevel = savedVolume ? parseInt(savedVolume) : 25;
      aud.setVolume(volumeLevel);

      // Load saved spatial audio setting (default to false for performance)
      const savedSpatial = localStorage.getItem('spatialAudio');
      spatialAudioEnabled = savedSpatial === 'true';
      // console.log('🎵 Spatial audio loaded from prefs:', spatialAudioEnabled); // Commented out for cleaner logs

      // Babylon.js automatically handles audio listener positioning
      // console.log('🎵 Audio system initialized'); // Commented out for cleaner logs

      // Load all sound files
      await aud.loadSounds();


    } catch (error) {
      console.error('❌ Failed to initialize AudioEngineV2:', error);
      console.warn('⚠️ Audio will be disabled. This is normal if Web Audio API is not supported.');
    }
  };

  // Load sound files
  aud.loadSounds = async function() {
    if (!audioEngine) {
      console.log('🎵 No audioEngine available for loading sounds');
      return;
    }

    try {
      // Create basic sound options
      const soundOptions = {
        volume: currentVolume,
        loop: false,
        autoplay: false
      };

      // console.log('🎵 Creating villager sounds:', soundOptions); // Commented out for cleaner logs

      // Load both villager sound variants
      const sound1 = await BABYLON.CreateSoundAsync(
        "villager_move_1",
        "assets/sounds/units/villager.ogg",
        window.gfx?.scene,
        null, // callback
        soundOptions
      );

      const sound2 = await BABYLON.CreateSoundAsync(
        "villager_move_2",
        "assets/sounds/units/villager2.ogg",
        window.gfx?.scene,
        null, // callback
        soundOptions
      );

      villagerMoveSounds = [sound1, sound2];
      // console.log('🎵 Loaded', villagerMoveSounds.length, 'villager sound variants'); // Commented out for cleaner logs

      soundsLoaded = true;
      // console.log('🎵 All sounds loaded successfully'); // Commented out for cleaner logs

    } catch (error) {
      console.error('❌ Failed to load sounds:', error);
      // Continue without sounds - the game will still work
    }
  };

  // Set volume level (0-100)
  aud.setVolume = function(level) {
    currentVolume = Math.max(0, Math.min(1, level / 100)); // Convert 0-100 to 0-1

    // Apply volume to audio engine (try different methods)
    if (audioEngine) {
      try {
        // Try setGlobalVolume first
        if (typeof audioEngine.setGlobalVolume === 'function') {
          audioEngine.setGlobalVolume(currentVolume);
        }
        // Try setVolume
        else if (typeof audioEngine.setVolume === 'function') {
          audioEngine.setVolume(currentVolume);
        }
        // Try volume property
        else if (audioEngine.volume !== undefined) {
          audioEngine.volume = currentVolume;
        }
        // Try _volume property
        else if (audioEngine._volume !== undefined) {
          audioEngine._volume = currentVolume;
        }
        // Last resort: access Web Audio API directly
        else if (audioEngine.audioContext && audioEngine.audioContext.destination) {
          // This is a fallback that may not work
          console.log('Using Web Audio API fallback for volume');
        }
      } catch (error) {
        console.warn('Failed to set volume:', error.message);
      }
    }
  };

  // Set spatial audio mode (on/off)
  aud.setSpatialMode = function(enabled) {
    const wasEnabled = spatialAudioEnabled;
    spatialAudioEnabled = enabled;
    // console.log('🎵 Spatial audio:', enabled ? 'ENABLED' : 'DISABLED'); // Commented out for cleaner logs

    // Note: Currently sounds are created with spatial options at load time
    // Dynamic switching would require recreating sounds
    if (wasEnabled !== enabled) {
      // console.log('🎵 Spatial mode changed - may require page reload for full effect'); // Commented out for cleaner logs
    }
  };

  // Test spatial audio with a distant sound
  aud.testDistantSound = function() {
    if (!villagerMoveSound || !window.gfx?.camera?.position) {
      console.log('🎵 Cannot test - audio not ready');
      return;
    }

    console.log('🎵 Testing spatial audio with distant sound...');

    // Simulate a unit 100 units away
    const camPos = window.gfx.camera.position;
    const mockUnit = {
      pb: {
        state: {
          loc: {
            x: camPos.x + 100,
            y: camPos.y,
            z: camPos.z
          }
        }
      }
    };

    // This will use the same spatial logic as normal sounds
    aud.playVillagerMove(mockUnit);
  };

  // Play villager movement command sound
  aud.playVillagerMove = function(unit) {
    if (!audioEngine || !soundsLoaded || villagerMoveSounds.length === 0) {
      console.log('🎵 Audio not ready:', {audioEngine: !!audioEngine, soundsLoaded, villagerSounds: villagerMoveSounds.length});
      return; // Silent fail if audio not ready
    }

    if (currentVolume === 0) {
      console.log('🎵 Master volume is 0 (muted) - currentVolume:', currentVolume);
      return; // Silent fail if muted
    }

    // console.log('🎵 playVillagerMove called with spatial:', spatialAudioEnabled, 'unit:', !!unit); // Commented out for cleaner logs

    try {
      // Calculate effective volume (master volume * spatial attenuation)
      let effectiveVolume = currentVolume;

      if (spatialAudioEnabled && unit && unit.pb && unit.pb.state && unit.pb.state.loc && window.gfx?.camera?.position) {
        const position = unit.pb.state.loc;
        const camPos = window.gfx.camera.position;
        const dx = position.x - camPos.x;
        const dy = (position.y || 0) - camPos.y;
        const dz = position.z - camPos.z;
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

        // Gradual linear falloff: full volume within 10 units, silent at 200 units
        const refDistance = 10;
        const maxDistance = 200;
        if (distance <= refDistance) {
          effectiveVolume = currentVolume;
        } else if (distance >= maxDistance) {
          effectiveVolume = 0;
        } else {
          const attenuation = 1.0 - ((distance - refDistance) / (maxDistance - refDistance));
          effectiveVolume = currentVolume * attenuation;
        }

        // console.log('🎵 Distance:', distance.toFixed(1), 'units → effective volume:', (effectiveVolume * 100).toFixed(0) + '%'); // Commented out for cleaner logs
      }

      // Play sound with calculated volume
      if (effectiveVolume > 0.01) { // Only play if audible
        // console.log('🎵 Playing with effective volume:', (effectiveVolume * 100).toFixed(0) + '%'); // Commented out for cleaner logs

        try {
          // Randomly select between the two villager sounds
          const soundIndex = Math.floor(Math.random() * villagerMoveSounds.length);
          const selectedSound = villagerMoveSounds[soundIndex];
          const baseVolume = villagerBaseVolumes[soundIndex];

          // Apply base volume multiplier to the effective volume
          const finalVolume = effectiveVolume * baseVolume;
          selectedSound.volume = finalVolume;
          selectedSound.play();
          // console.log('🎵 PLAYING: Villager sound', soundIndex + 1, 'with base volume', (baseVolume * 100).toFixed(0) + '% → final volume:', (finalVolume * 100).toFixed(0) + '%'); // Commented out for cleaner logs

        } catch (soundError) {
          console.warn('🎵 Sound playback failed:', soundError.message);
        }
      } else {
        console.log('🎵 Sound too quiet to play (effective volume:', (effectiveVolume * 100).toFixed(2) + '%)');
      }

    } catch (error) {
      console.warn('🎵 Audio playback error:', error.message);
    }

  };

  // Get the audio engine instance
  aud.getAudioEngine = function() {
    return audioEngine;
  };

  // Check if audio is ready
  aud.isReady = function() {
    return audioEngine && soundsLoaded;
  };

  // Expose test function to global scope for manual testing
  if (typeof window !== 'undefined') {
    window.testSpatialAudio = aud.testDistantSound;
  }

})(window.aud = window.aud || {});