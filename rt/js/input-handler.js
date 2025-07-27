class InputHandler {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.canvas = document.getElementById('rt-canvas');
    
    console.log('🎯 InputHandler constructor - canvas found:', !!this.canvas);
    console.log('🎯 InputHandler constructor - window.ftxxPointer available:', !!window.ftxxPointer);
    
    // Initialize FTXX Pointer
    this.initFTXXPointer();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Setup keyboard events
    this.setupKeyboardEvents();
  }
  
  initFTXXPointer() {
    // Initialize the FTXX Pointer library
    console.log('🎯 Initializing FTXX Pointer...');
    console.log('🎯 window.ftxxPointer available:', !!window.ftxxPointer);
    
    if (window.ftxxPointer) {
      this.ftxx = window.ftxxPointer;
      console.log('🎯 FTXX Pointer version:', this.ftxx.version);
      
      // Only initialize if not already initialized
      if (!this.ftxx._state.isInitialized) {
        console.log('🎯 Initializing FTXX Pointer with custom config...');
        this.ftxx.init({
          preventDefault: true,
          passive: false,
          gestureThresholds: {
            zoom: 3,      // Lower threshold for more responsive zoom
            pan: 1,       // Very low threshold for immediate pan response
            rotation: 0.03 // Lower threshold for more responsive rotation
          }
        });
      } else {
        console.log('🎯 FTXX Pointer already initialized');
      }
      
      // Detect mobile device
      this.isMobile = this.detectMobile();
      
      if (this.isMobile) {
        console.log('🧭 FTXX Pointer initialized for mobile device');
        this.adjustForMobile();
      } else {
        console.log('🧭 FTXX Pointer initialized for desktop');
      }
    } else {
      console.warn('FTXX Pointer library not found, falling back to standard events');
    }
  }
  
  detectMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }
  
  adjustForMobile() {
    // Add mobile-specific CSS classes
    document.body.classList.add('mobile-device');
    
    // Adjust camera sensitivity for touch
    const camera = this.scene.activeCamera;
    if (camera) {
      camera.panningSensibility = 2000; // More sensitive for touch
      camera.wheelPrecision = 100; // More sensitive zoom
    }
  }
  
  setupEventListeners() {
    if (this.ftxx) {
      // Use FTXX Pointer for unified input handling
      this.setupFTXXEvents();
    } else {
      console.error('FTXX Pointer library not found - input handling disabled');
    }
  }
  
  setupFTXXEvents() {
    console.log('🎯 Setting up FTXX events on canvas:', this.canvas);
    
    // Tap events for quick actions
    this.ftxx.on(this.canvas, 'tap', (evt) => {
      this.handleTap(evt);
    });
    
    // Long press events for context menus
    this.ftxx.on(this.canvas, 'longpress', (evt) => {
      this.handleLongPress(evt);
    });
    
    // Wheel events for zoom
    this.ftxx.on(this.canvas, 'wheel', (evt) => {
      this.handleWheel(evt);
    });
    
    // Gesture events from FTXX Pointer
    this.ftxx.on(this.canvas, 'pinch', (evt) => {
      console.log('🎯 Pinch event received:', evt);
      this.handlePinch(evt);
    });
    
    this.ftxx.on(this.canvas, 'pan', (evt) => {
      console.log('🎯 Pan event received:', evt);
      console.log('🎯 Pan event details:', {
        deltaX: evt.deltaX,
        deltaY: evt.deltaY,
        centerX: evt.centerX,
        centerY: evt.centerY,
        type: evt.type
      });
      this.handlePan(evt);
    });
    
    this.ftxx.on(this.canvas, 'rotate', (evt) => {
      console.log('🎯 Rotate event received:', evt);
      this.handleRotate(evt);
    });
    
    // Add pointer events for lasso selection and other interactions
    this.ftxx.on(this.canvas, 'pointerdown', (evt) => {
      console.log('🎯 Pointer down event received:', evt);
      if (evt.pointers && evt.pointers.length === 1) {
        const pointer = evt.pointers[0];
        // Start lasso selection on single pointer down
        if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
          this.game.lassoSelection.startLasso(pointer.x, pointer.y);
        }
      }
    });
    
    this.ftxx.on(this.canvas, 'pointermove', (evt) => {
      if (evt.pointers && evt.pointers.length === 1) {
        const pointer = evt.pointers[0];
        // Update lasso selection during pointer move
        if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
          this.game.lassoSelection.updateLasso(pointer.x, pointer.y);
        }
      }
    });
    
    this.ftxx.on(this.canvas, 'pointerup', (evt) => {
      console.log('🎯 Pointer up event received:', evt);
      if (evt.pointers && evt.pointers.length === 0) {
        // End lasso selection on pointer up
        if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
          this.game.lassoSelection.endLasso();
        }
      }
    });
    
    console.log('🎯 FTXX events setup complete');
  }
  

  

  

  
  handleTap(evt) {
    console.log('🎯 Tap event received:', evt);
    
    // Handle tap for both mouse and touch
    if (evt.pointers && evt.pointers.length === 1) {
      const pointer = evt.pointers[0];
      console.log('🎯 Processing tap at:', pointer.x, pointer.y);
      this.handleLeftClick(pointer.x, pointer.y);
    } else if (evt.x !== undefined && evt.y !== undefined) {
      // Handle direct coordinates
      console.log('🎯 Processing tap at:', evt.x, evt.y);
      this.handleLeftClick(evt.x, evt.y);
    }
  }
  
  handleLongPress(evt) {
    if (!evt.pointers || evt.pointers.length === 0) {
      return;
    }
    
    const pointer = evt.pointers[0];
    if (!pointer) {
      return;
    }
    
    // Handle long press (context menu, etc.)
    console.log('Long press detected at:', pointer.x, pointer.y);
    
    // Could implement context menu here
    // For now, just deselect all units
    if (this.game.unitManager) {
      this.game.unitManager.deselectAllUnits();
    }
  }
  
  handleLeftClick(screenX, screenY) {
    console.log(`🎯 handleLeftClick called at (${screenX}, ${screenY})`);
    const pickResult = this.scene.pick(screenX, screenY);
    
    console.log('🎯 Pick result:', {
      hit: pickResult.hit,
      pickedMesh: pickResult.pickedMesh?.name || 'none',
      pickedPoint: pickResult.pickedPoint
    });
    
    if (pickResult.hit) {
      const hitObject = pickResult.pickedMesh;
      console.log('🎯 Hit object:', hitObject.name || 'unnamed');
      
      // Check if it's a unit
      if (this.game.unitManager) {
        let unitId = this.getUnitIdFromMesh(hitObject);
        console.log('🎯 Unit ID found by mesh:', unitId);
        
        // If no unit found by mesh, try proximity-based detection
        if (unitId === null) {
          unitId = this.findUnitByProximity(screenX, screenY);
          console.log('🎯 Unit ID found by proximity:', unitId);
        }
        
        if (unitId !== null) {
          console.log('🎯 Processing unit selection for unit ID:', unitId);
          console.log('🎯 Currently selected units:', Array.from(this.game.unitManager.selectedUnits));
          
          // Check if this unit is already selected
          if (this.game.unitManager.selectedUnits.has(unitId)) {
            console.log('🎯 Deselecting unit:', unitId);
            // If clicking on already selected unit, deselect it
            this.game.unitManager.deselectUnit(unitId);
          } else {
            console.log('🎯 Selecting unit:', unitId);
            // Select single unit (deselects others)
            this.game.unitManager.selectUnit(unitId);
          }
          console.log('🎯 Selected units after operation:', Array.from(this.game.unitManager.selectedUnits));
          return;
        }
        
        // Check if it's terrain or other objects
        if (this.game.unitManager.selectedUnits.size > 0) {
          // Move selected units
          const targetPosition = pickResult.pickedPoint;
          targetPosition.y = Math.max(0.5, targetPosition.y + 0.5);
          this.game.unitManager.moveSelectedUnits(targetPosition);
          return;
        }
      }
      
      // Check if it's one of our game objects
      if (this.game.gameObjects && this.game.gameObjects.has(hitObject)) {
        this.game.selectObject(hitObject);
        return;
      }
    }
    
    console.log('🎯 Clicked on empty space - checking for nearby units first');
    
    // Before starting selection, check if there are any units nearby
    const nearbyUnitId = this.findUnitByProximity(screenX, screenY, 30); // Smaller radius for more precise selection
    if (nearbyUnitId !== null) {
      console.log('🎯 Found nearby unit, selecting it instead of starting selection');
      if (this.game.unitManager.selectedUnits.has(nearbyUnitId)) {
        this.game.unitManager.deselectUnit(nearbyUnitId);
      } else {
        this.game.unitManager.selectUnit(nearbyUnitId);
      }
      return;
    }
    
    console.log('🎯 No nearby units found - starting lasso selection');
    
    // Clicked on empty space - deselect all units
    if (this.game.unitManager) {
      this.game.unitManager.deselectAllUnits();
    }
    if (this.game) {
      this.game.deselectAll();
    }
    
    // Start lasso selection on empty space
    console.log('🎯 Starting lasso selection');
    if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
      this.game.lassoSelection.startLasso(screenX, screenY);
    } else {
      console.log('🎯 Lasso selection not available or not enabled');
    }
  }
  
  handleWheel(evt) {
    // Prevent browser zoom
    evt.preventDefault();
    
    const camera = this.scene.activeCamera;
    const zoomSpeed = 0.1;
    
    // Handle both FTXX Pointer wheel events and regular wheel events
    let zoomDelta;
    if (evt.wheel) {
      // FTXX Pointer wheel event
      zoomDelta = evt.wheel.deltaY * zoomSpeed;
    } else {
      // Regular wheel event
      zoomDelta = evt.deltaY * zoomSpeed;
    }
    
    camera.radius += zoomDelta;
    camera.radius = Math.max(camera.lowerRadiusLimit, Math.min(camera.upperRadiusLimit, camera.radius));
  }
  
  handlePinch(evt) {
    // Handle pinch-to-zoom gesture
    const camera = this.scene.activeCamera;
    const zoomSpeed = 0.5; // Increased sensitivity for better zoom
    
    // Use the scale from FTXX Pointer
    const scaleFactor = evt.scale;
    
    // Calculate zoom delta - scale > 1 means zoom in (reduce radius), scale < 1 means zoom out (increase radius)
    const zoomDelta = (scaleFactor - 1) * zoomSpeed * camera.radius;
    
    // Apply zoom - subtract for zoom in, add for zoom out
    camera.radius -= zoomDelta;
    
    // Only clamp if we're outside the limits
    if (camera.radius < camera.lowerRadiusLimit) {
      camera.radius = camera.lowerRadiusLimit;
    } else if (camera.radius > camera.upperRadiusLimit) {
      camera.radius = camera.upperRadiusLimit;
    }
    
    console.log('🎯 Pinch gesture:', { scale: evt.scale, zoomDelta, radius: camera.radius, limits: [camera.lowerRadiusLimit, camera.upperRadiusLimit] });
    
    // Prevent default behavior
    if (evt.preventDefault) {
      evt.preventDefault();
    }
  }
  
  handlePan(evt) {
    // Handle two-finger pan gesture to move the camera target
    const camera = this.scene.activeCamera;
    const panSpeed = 0.05; // Increased sensitivity for better responsiveness
    
    // Get the pan deltas from the event - handle different event structures
    let deltaX = 0;
    let deltaY = 0;
    
    if (evt.deltaX !== undefined && evt.deltaY !== undefined) {
      deltaX = evt.deltaX;
      deltaY = evt.deltaY;
    } else if (evt.delta && evt.delta.x !== undefined && evt.delta.y !== undefined) {
      deltaX = evt.delta.x;
      deltaY = evt.delta.y;
    } else if (evt.movementX !== undefined && evt.movementY !== undefined) {
      deltaX = evt.movementX;
      deltaY = evt.movementY;
    }
    
    // Calculate world space movement based on camera's current orientation
    // We need to convert screen space movement to world space movement
    const worldPanSpeed = panSpeed * camera.radius * 0.01; // Scale with camera distance
    
    // Calculate the right and forward vectors in world space
    const right = new BABYLON.Vector3(
      Math.cos(camera.alpha), 
      0, 
      -Math.sin(camera.alpha)
    );
    
    const forward = new BABYLON.Vector3(
      Math.sin(camera.alpha), 
      0, 
      Math.cos(camera.alpha)
    );
    
    // Calculate the pan movement in world space
    const panX = right.scale(-deltaX * worldPanSpeed);
    const panZ = forward.scale(-deltaY * worldPanSpeed);
    
    // Apply the pan movement to the camera target
    camera.target.addInPlace(panX);
    camera.target.addInPlace(panZ);
    
    console.log('🎯 Two-finger pan:', { 
      deltaX, 
      deltaY, 
      worldPanSpeed,
      target: camera.target.clone(),
      cameraRadius: camera.radius,
      eventKeys: Object.keys(evt)
    });
    
    // Prevent default browser behavior
    if (evt.preventDefault) {
      evt.preventDefault();
    }
  }
  
  handleRotate(evt) {
    // Handle two-finger rotate gesture - fix to actually work
    const camera = this.scene.activeCamera;
    const rotationSpeed = 0.3; // Reduced sensitivity for stability
    
    // Rotate the camera around the target
    camera.alpha += evt.rotation * rotationSpeed;
    
    console.log('🎯 Rotate gesture:', { rotation: evt.rotation, alpha: camera.alpha });
    
    // Prevent default behavior
    if (evt.preventDefault) {
      evt.preventDefault();
    }
  }
  
  getUnitIdFromMesh(mesh) {
    if (!this.game.unitManager) return null;
    
    console.log('getUnitIdFromMesh called with mesh:', mesh.name || 'unnamed');
    console.log('Total units in manager:', this.game.unitManager.units.size);
    
    // Check if the mesh is a unit
    for (const [unitId, unit] of this.game.unitManager.units) {
      console.log(`Checking unit ${unitId}:`, unit.mesh.name || 'unnamed');
      if (unit.mesh === mesh) {
        console.log(`Found match! Unit ${unitId}`);
        return unitId;
      }
      // Check if it's a child of the unit (for unit parts)
      if (unit.mesh.getChildMeshes && unit.mesh.getChildMeshes().includes(mesh)) {
        console.log(`Found child match! Unit ${unitId}`);
        return unitId;
      }
    }
    console.log('No unit found for this mesh');
    return null;
  }
  
  // Alternative method to find units by proximity to touch point
  findUnitByProximity(screenX, screenY, maxDistance = 50) {
    if (!this.game.unitManager) return null;
    
    console.log('🎯 Finding unit by proximity at:', screenX, screenY);
    
    for (const [unitId, unit] of this.game.unitManager.units) {
      // Convert unit world position to screen coordinates
      const screenPos = this.worldToScreen(unit.mesh.position);
      if (screenPos) {
        const distance = Math.sqrt(
          Math.pow(screenX - screenPos.x, 2) + 
          Math.pow(screenY - screenPos.y, 2)
        );
        
        if (distance <= maxDistance) {
          console.log(`🎯 Found unit ${unitId} at distance ${distance}`);
          return unitId;
        }
      }
    }
    
    console.log('🎯 No unit found by proximity');
    return null;
  }
  
  worldToScreen(worldPosition) {
    const camera = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    
    if (!canvas) return null;
    
    const screenPosition = BABYLON.Vector3.Project(
      worldPosition,
      BABYLON.Matrix.Identity(),
      this.scene.getTransformMatrix(),
      camera.viewport.toGlobal(canvas.width, canvas.height)
    );
    
    return {
      x: screenPosition.x,
      y: screenPosition.y
    };
  }
  
  // Add keyboard event handling
  setupKeyboardEvents() {
    // Escape key to deselect
    document.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape') {
        if (this.game.unitManager) {
          this.game.unitManager.deselectAllUnits();
        }
        if (this.game) {
          this.game.deselectAll();
        }
        console.log('Deselected all units (Escape key)');
      }
      
      // Arrow keys for camera panning (alpha only, like two-finger pan)
      const camera = this.scene.activeCamera;
      const panSpeed = 0.1;
      
      switch (evt.key) {
        case 'ArrowLeft':
          camera.alpha -= panSpeed;
          console.log('🎯 Arrow key pan: left');
          break;
        case 'ArrowRight':
          camera.alpha += panSpeed;
          console.log('🎯 Arrow key pan: right');
          break;
        case 'ArrowUp':
          // Could add beta movement here if needed, but keeping consistent with touch
          console.log('🎯 Arrow key pan: up (no beta movement)');
          break;
        case 'ArrowDown':
          // Could add beta movement here if needed, but keeping consistent with touch
          console.log('🎯 Arrow key pan: down (no beta movement)');
          break;
      }
    });
  }
  
  dispose() {
    // Clean up event listeners
    if (this.ftxx && this.canvas) {
      this.ftxx.off(this.canvas, ['tap', 'longpress', 'wheel', 'pinch', 'pan', 'rotate']);
    }
  }
} 