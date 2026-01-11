// Unit Speech Bubble System
// Displays text above units with nice animations

const UnitSpeech = {
  activeSpeechBubbles: [],
  
  // Speech library - random phrases units can say
  speechLibrary: {
    select: [
      'Ready!',
      'Yes?',
      'Orders?',
      'Awaiting command',
      'At your service'
    ],
    move: [
      'Moving out',
      'On my way',
      'Yes sir',
      'Right away',
      'Understood'
    ],
    attack: [
      'Attacking!',
      'For glory!',
      'Charge!',
      'To battle!',
      'Engaging enemy'
    ],
    gather: [
      'Gathering',
      'On it',
      'Will do',
      'Collecting resources',
      'Working'
    ],
    build: [
      'Building',
      'Constructing',
      'Right away',
      'On the job',
      'Will build'
    ],
    complete: [
      'Done!',
      'Complete',
      'Finished',
      'Task complete',
      'Ready for orders'
    ],
    damage: [
      'Under attack!',
      'Help!',
      'Taking damage!',
      'We\'re hit!',
      'Need backup!'
    ]
  },

  // Initialize the speech system
  init: function(scene) {
    if (!window.MSDFText) {
      console.error('MSDFText not loaded');
      return;
    }
    
    window.MSDFText.init(scene);
    console.log('✨ Unit speech system initialized');
  },

  // Show speech bubble above a unit
  showSpeech: async function(unit, text, duration = 2000, options = {}) {
    if (!unit || !unit.mesh || !window.MSDFText || !window.MSDFText.fontData) {
      return;
    }
    
    // Remove any existing speech bubble for this unit
    this.clearSpeech(unit);
    
    const opts = {
      fontSize: options.fontSize || 1.0,
      color: options.color || new BABYLON.Color3(1, 1, 1),
      backgroundColor: options.backgroundColor || new BABYLON.Color3(0.05, 0.05, 0.05),
      yOffset: options.yOffset || 3.0, // Height above unit
      fadeIn: options.fadeIn !== false,
      fadeOut: options.fadeOut !== false,
      ...options
    };
    
    // Create the text mesh using MSDF (async)
    const textMesh = await window.MSDFText.createText(text, {
      fontSize: opts.fontSize,
      color: opts.color,
      alpha: opts.fadeIn ? 0 : 1,
      align: 'center'
    });
    
    if (!textMesh) return;
    
    // Store unit reference for manual positioning
    textMesh._followUnit = unit;
    textMesh._yOffset = opts.yOffset;
    
    // Initialize position immediately using physics body if available
    // Position directly above unit (no X/Z offset for proper 3D positioning)
    if (unit.pb && unit.pb.state && unit.pb.state.loc) {
      textMesh.position = new BABYLON.Vector3(
        unit.pb.state.loc.x,
        unit.pb.state.loc.y + opts.yOffset,
        unit.pb.state.loc.z
      );
    } else if (unit.mesh && unit.mesh.position) {
      textMesh.position = new BABYLON.Vector3(
        unit.mesh.position.x,
        unit.mesh.position.y + opts.yOffset,
        unit.mesh.position.z
      );
    }
    
    // Store speech data (no background bubble)
    const speechData = {
      unit: unit,
      textMesh: textMesh,
      bubble: null,
      bubbleMat: null,
      startTime: Date.now(),
      duration: duration,
      fadeIn: opts.fadeIn,
      fadeOut: opts.fadeOut,
      fadeInDuration: 200,
      fadeOutDuration: 300
    };
    
    unit.speechBubble = speechData;
    this.activeSpeechBubbles.push(speechData);
    
    return speechData;
  },

  // Show a random speech from a category
  showRandomSpeech: async function(unit, category, duration = 2000) {
    if (!this.speechLibrary[category]) {
      console.warn(`Unknown speech category: ${category}`);
      return;
    }
    
    const phrases = this.speechLibrary[category];
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    return await this.showSpeech(unit, text, duration);
  },

  // Clear speech bubble for a unit
  clearSpeech: function(unit) {
    if (!unit || !unit.speechBubble) return;
    
    const index = this.activeSpeechBubbles.indexOf(unit.speechBubble);
    if (index !== -1) {
      this.activeSpeechBubbles.splice(index, 1);
    }
    
    if (unit.speechBubble.textMesh) {
      window.MSDFText.disposeText(unit.speechBubble.textMesh);
    }
    if (unit.speechBubble.bubble) {
      if (unit.speechBubble.bubble.material) {
        unit.speechBubble.bubble.material.dispose();
      }
      unit.speechBubble.bubble.dispose();
    }
    
    unit.speechBubble = null;
  },

  // Update all speech bubbles (call this in game loop)
  update: function() {
    const now = Date.now();
    const toRemove = [];
    
    // Get camera matrices for text rendering
    const camera = window.gfx?.camera;
    if (!camera) return;
    
    const viewMatrix = camera.getViewMatrix();
    const projectionMatrix = camera.getProjectionMatrix();
    
    for (let i = 0; i < this.activeSpeechBubbles.length; i++) {
      const speech = this.activeSpeechBubbles[i];
      const elapsed = now - speech.startTime;
      
      // Update position to follow unit smoothly (no parenting = no jitter)
      // Position directly above unit in world space - billboard handles screen facing
      if (speech.textMesh && speech.textMesh._followUnit) {
        const unit = speech.textMesh._followUnit;
        
        // Check if unit still exists (not destroyed/removed)
        if (!unit || unit._disposed) {
          // Unit was destroyed, remove this speech bubble
          this.clearSpeech(unit);
          toRemove.push(i);
          continue;
        }
        
        // CRITICAL: Use physics body position during wander behavior (syncs before mesh)
        // This prevents text from getting stuck when units wander
        if (unit.pb && unit.pb.state && unit.pb.state.loc) {
          speech.textMesh.position.x = unit.pb.state.loc.x;
          speech.textMesh.position.y = unit.pb.state.loc.y + speech.textMesh._yOffset;
          speech.textMesh.position.z = unit.pb.state.loc.z;
        } else if (unit.mesh && unit.mesh.position) {
          speech.textMesh.position.copyFrom(unit.mesh.position);
          speech.textMesh.position.y += speech.textMesh._yOffset;
        } else {
          // No valid position source - log this unusual case
          console.warn('💬 Speech bubble has no valid position source:', unit.type, unit.name);
        }
      }
      
      // Render text if it's a TextRenderer
      if (speech.textMesh && speech.textMesh.render) {
        speech.textMesh.render(viewMatrix, projectionMatrix);
      }
      
      // Fade in
      if (speech.fadeIn && elapsed < speech.fadeInDuration) {
        const alpha = elapsed / speech.fadeInDuration;
        window.MSDFText.setTextAlpha(speech.textMesh, alpha);
        if (speech.bubbleMat) {
          speech.bubbleMat.alpha = alpha * 0.75;
        }
      }
      // Fade out
      else if (speech.fadeOut && elapsed > speech.duration - speech.fadeOutDuration) {
        const fadeProgress = (elapsed - (speech.duration - speech.fadeOutDuration)) / speech.fadeOutDuration;
        const alpha = 1 - fadeProgress;
        window.MSDFText.setTextAlpha(speech.textMesh, alpha);
        if (speech.bubbleMat) {
          speech.bubbleMat.alpha = alpha * 0.75;
        }
        
        // Also float up slightly during fade
        if (speech.textMesh && speech.textMesh._yOffset !== undefined) {
          speech.textMesh._yOffset += 0.015;
        }
      }
      
      // Remove expired bubbles
      if (elapsed > speech.duration) {
        this.clearSpeech(speech.unit);
        toRemove.push(i);
      }
    }
    
    // Clean up removed bubbles
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.activeSpeechBubbles.splice(toRemove[i], 1);
    }
  },

  // Show damage number above unit
  showDamage: function(unit, damage) {
    if (!unit || !unit.mesh) return;
    
    const text = `-${Math.round(damage)}`;
    this.showSpeech(unit, text, 1500, {
      fontSize: 1.2,
      color: new BABYLON.Color3(1, 0.2, 0.2), // Red
      backgroundColor: new BABYLON.Color3(0, 0, 0),
      yOffset: 2.5
    });
  },

  // Show heal number above unit
  showHeal: function(unit, amount) {
    if (!unit || !unit.mesh) return;
    
    const text = `+${Math.round(amount)}`;
    this.showSpeech(unit, text, 1500, {
      fontSize: 1.0,
      color: new BABYLON.Color3(0.2, 1, 0.2), // Green
      backgroundColor: new BABYLON.Color3(0, 0, 0),
      yOffset: 2.5
    });
  }
};

// Export
window.UnitSpeech = UnitSpeech;
