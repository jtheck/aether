class InputHandler {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.canvas = document.getElementById('rt-canvas');
    
    // Debug: Check if canvas is found
    if (!this.canvas) {
      console.error('Canvas element with ID "rt-canvas" not found!');
    } else {
  
    }
    
    // Camera Controls:
    // - Mouse wheel: Zoom in/out
    // - Middle mouse button (wheel click) + drag: Rotate camera
    // - Left mouse button: Select units (no lasso)
    // - Right mouse button: Move selected units
    // - Arrow keys: Pan camera
    // - [ and ] keys: Rotate camera left/right
    // - Touch gestures: Multi-touch pan/rotate/zoom + lasso selection
    
    // PERFORMANCE OPTIMIZATION: Add caching for expensive operations
    this._screenPosCache = new Map();
    this._cacheFrame = 0;
    this._maxCacheAge = 5; // Cache for 5 frames
    
    // Track gesture state to prevent lasso during gestures
    this._isInGesture = false;
    this._gestureStartTime = 0;
    this._gestureResetTimer = null;
    // Mouse lasso state
    this._mouseLassoPending = false; // left down but not moved beyond threshold
    this._mouseLassoActive = false;  // actively drawing lasso
    this._mouseDownX = 0;
    this._mouseDownY = 0;
    this._lassoMoveThresholdSq = 36; // 6px threshold squared
    // Right-click state for unit movement
    this._rightClickX = undefined;
    this._rightClickY = undefined;
    
    // Setup mouse events FIRST, before FTXX
    this.setupMouseEvents();
    
    // Initialize FTXX Pointer
    this.initFTXXPointer();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Setup keyboard events
    this.setupKeyboardEvents();
    
    // Lasso selection initialization check removed for cleaner code
  }
  

  
  // PERFORMANCE OPTIMIZATION: Fast math utilities
  _fastDistanceSquared(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }
  
  // PERFORMANCE OPTIMIZATION: Cached world-to-screen conversion
  _getCachedScreenPosition(worldPosition) {
    const cacheKey = `${worldPosition.x.toFixed(2)}_${worldPosition.y.toFixed(2)}_${worldPosition.z.toFixed(2)}`;
    const cached = this._screenPosCache.get(cacheKey);
    
    if (cached && (this._cacheFrame - cached.frame) < this._maxCacheAge) {
      return cached.position;
    }
    
    const screenPos = this.worldToScreen(worldPosition);
    if (screenPos) {
      this._screenPosCache.set(cacheKey, {
        position: screenPos,
        frame: this._cacheFrame
      });
    }
    
    return screenPos;
  }
  
  // PERFORMANCE OPTIMIZATION: Clear old cache entries
  _cleanupCache() {
    const cutoffFrame = this._cacheFrame - this._maxCacheAge;
    for (const [key, value] of this._screenPosCache.entries()) {
      if (value.frame < cutoffFrame) {
        this._screenPosCache.delete(key);
      }
    }
  }
  
  getUnitIdFromMesh(mesh) {
    if (!this.game.unitManager) return null;
    
    // Check if the mesh is a unit
    for (const [unitId, unit] of this.game.unitManager.units) {
      if (unit.mesh === mesh) {
        return unitId;
      }
      // Check if it's a child of the unit (for unit parts)
      if (unit.mesh.getChildMeshes && unit.mesh.getChildMeshes().includes(mesh)) {
        return unitId;
      }
    }
    return null;
  }
  
  // PERFORMANCE OPTIMIZATION: Optimized proximity search with early exit and squared distance
  findUnitByProximity(screenX, screenY, maxDistance = 50) {
    if (!this.game.unitManager) return null;
    

    
    // PERFORMANCE OPTIMIZATION: Use squared distance to avoid Math.sqrt
    const maxDistanceSquared = maxDistance * maxDistance;
    let closestUnitId = null;
    let closestDistanceSquared = Infinity;
    
    // PERFORMANCE OPTIMIZATION: Increment cache frame for cleanup
    this._cacheFrame++;
    if (this._cacheFrame % 30 === 0) { // Cleanup every 30 frames
      this._cleanupCache();
    }
    
    for (const [unitId, unit] of this.game.unitManager.units) {
      // PERFORMANCE OPTIMIZATION: Use cached screen position
      const screenPos = this._getCachedScreenPosition(unit.mesh.position);
      if (!screenPos) continue;
      
      // PERFORMANCE OPTIMIZATION: Use fast squared distance calculation
      const distanceSquared = this._fastDistanceSquared(screenX, screenY, screenPos.x, screenPos.y);
      
      // PERFORMANCE OPTIMIZATION: Early exit if within range and closer than previous
      if (distanceSquared <= maxDistanceSquared && distanceSquared < closestDistanceSquared) {
        closestDistanceSquared = distanceSquared;
        closestUnitId = unitId;
        
        // PERFORMANCE OPTIMIZATION: Early exit if very close (within 10 pixels)
        if (distanceSquared <= 100) {
          return unitId;
        }
      }
    }
    
    if (closestUnitId) {
      return closestUnitId;
    }
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
  
  screenToWorld(screenX, screenY) {
    const camera = this.scene.activeCamera;
    const canvas = this.scene.getEngine().getRenderingCanvas();
    
    if (!canvas) return null;
    
    // For ArcRotateCamera, we need to use the scene's picking system
    const pickResult = this.scene.pick(screenX, screenY);
    
    if (pickResult.hit) {
      // If we hit something, use that point
      return pickResult.pickedPoint;
    } else {
      // If we didn't hit anything, create a ray and intersect with ground plane
      const ray = this.scene.createPickingRay(screenX, screenY, BABYLON.Matrix.Identity(), camera);
      const groundPlane = new BABYLON.Plane(0, 1, 0, 0);
      const intersection = BABYLON.Ray.IntersectsPlane(ray, groundPlane);
      
      if (intersection) {
        return intersection;
      }
    }
    
    return null;
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

      }
      
      // Arrow keys for camera panning (move camera target to pan the map)
      const camera = this.scene.activeCamera;
      const panSpeed = 0.1;
      
      switch (evt.key) {
        case 'ArrowLeft':
          // Move camera target left relative to camera view
          const cameraRight = camera.getDirection(BABYLON.Axis.X);
          camera.target.addInPlace(cameraRight.scale(-panSpeed));
          break;
        case 'ArrowRight':
          // Move camera target right relative to camera view
          const cameraRight2 = camera.getDirection(BABYLON.Axis.X);
          camera.target.addInPlace(cameraRight2.scale(panSpeed));
          break;
        case 'ArrowUp':
          // Move camera target backward relative to camera view
          const cameraForward = camera.getDirection(BABYLON.Axis.Z);
          camera.target.addInPlace(cameraForward.scale(-panSpeed));
          break;
        case 'ArrowDown':
          // Move camera target forward relative to camera view
          const cameraForward2 = camera.getDirection(BABYLON.Axis.Z);
          camera.target.addInPlace(cameraForward2.scale(panSpeed));
          break;
        case '[':
          // Rotate camera left (decrease alpha)
          if (camera && typeof camera.alpha !== 'undefined') {
            camera.alpha -= 0.1;
    
          }
          break;
        case ']':
          // Rotate camera right (increase alpha)
          if (camera && typeof camera.alpha !== 'undefined') {
            camera.alpha += 0.1;
    
          }
          break;
      }
    });
  }
  
  dispose() {
    // Clean up event listeners
    if (this.ftxx && this.canvas) {
      this.ftxx.off(this.canvas, ['tap', 'longpress', 'transform', 'pointerdown', 'pointermove', 'pointerup']);
    }
    
    // PERFORMANCE OPTIMIZATION: Clear cache
    this._screenPosCache.clear();
  }
  
  // Setup mouse events BEFORE FTXX, using pointer events + capture for robustness
  setupMouseEvents() {
    const canvas = this.canvas;
    if (!canvas) return;

    // Ensure middle-button drag works reliably across browsers:
    // - Use pointer events
    // - Use setPointerCapture to keep receiving moves
    // - Check e.buttons bitmask during move (middle = 4)

    const onPointerDown = (e) => {

      
      if (e.pointerType === 'mouse') {
        // Left button: selection (no lasso)
        if (e.button === 0) {

          // Prepare for lasso; start pending and activate on movement threshold
          this._mouseLassoPending = true;
          this._mouseLassoActive = false;
          this._mouseDownX = e.clientX;
          this._mouseDownY = e.clientY;
          try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
          return;
        }
        // Right button: unit movement
        if (e.button === 2) {

          // Store right-click position for movement
          this._rightClickX = e.clientX;
          this._rightClickY = e.clientY;
          try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault(); // Prevent context menu
          e.stopPropagation();
          return;
        }
        // Middle button: start rotation
        if (e.button === 1) {

          this.isMiddleMouseDown = true;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          canvas.style.cursor = 'grabbing';
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };

    const onPointerMove = (e) => {


      // Handle middle mouse rotation first
      const isMiddleHeld = (e.pointerType === 'mouse') && ((e.buttons & 4) === 4);
      if (isMiddleHeld || this.isMiddleMouseDown) {
        this.handleMiddleMouseMove({
          type: 'mousemove',
          button: 1,
          clientX: e.clientX,
          clientY: e.clientY,
          target: e.target,
          currentTarget: e.currentTarget,
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation()
        });
        return;
      }

      // Handle left-button lasso activation and updates when not in a gesture
      const isLeftHeld = (e.pointerType === 'mouse') && ((e.buttons & 1) === 1);
      if (isLeftHeld && !this._isInGesture) {

        
        if (this._mouseLassoPending && !this._mouseLassoActive) {
          const dx = e.clientX - this._mouseDownX;
          const dy = e.clientY - this._mouseDownY;
          const distanceSq = dx*dx + dy*dy;

          
          if (distanceSq >= this._lassoMoveThresholdSq) {

            this._mouseLassoActive = true;
            this.startLasso(this._mouseDownX, this._mouseDownY);
          }
        }
        
        if (this._mouseLassoActive) {

          this.updateLasso(e.clientX, e.clientY);
        }
      }
    };

    const onPointerUp = (e) => {

      
      if (e.pointerType === 'mouse' && e.button === 1) {
        this.handleMiddleMouseUp({
          type: 'mouseup',
          button: 1,
          clientX: e.clientX,
          clientY: e.clientY,
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation()
        });
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      // Finish lasso on left button up
      if (e.pointerType === 'mouse' && e.button === 0) {

        if (this._mouseLassoActive) {

          this.endLasso(e.clientX, e.clientY);
        } else if (this._mouseLassoPending) {

          // Treat as tap/click select if no drag occurred
          this.handleTap(e.clientX, e.clientY);
        }
        this._mouseLassoPending = false;
        this._mouseLassoActive = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }

      // Handle right button up for unit movement
      if (e.pointerType === 'mouse' && e.button === 2) {

        // Execute unit movement to the right-click position
        if (this._rightClickX !== undefined && this._rightClickY !== undefined) {
          this.handleRightClick(this._rightClickX, this._rightClickY);
        }
        this._rightClickX = undefined;
        this._rightClickY = undefined;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', onPointerMove, { capture: true });
    canvas.addEventListener('pointerup', onPointerUp, { capture: true });
    canvas.addEventListener('pointercancel', onPointerUp, { capture: true });
    
    // Prevent context menu on right-click to enable unit movement
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true });

    // Smooth zoom on wheel
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.handleMouseWheel(e);
    }, { capture: true, passive: false });
  }
  
  // Create a test button to verify mouse events are working
  createTestButton() {
    const testButton = document.createElement('button');
    testButton.textContent = 'TEST MOUSE EVENTS';
    testButton.style.position = 'fixed';
    testButton.style.top = '10px';
    testButton.style.right = '10px';
    testButton.style.zIndex = '9999';
    testButton.style.padding = '10px';
    testButton.style.backgroundColor = 'red';
    testButton.style.color = 'white';
    testButton.style.border = 'none';
    testButton.style.cursor = 'pointer';
    
    testButton.addEventListener('click', (e) => {

      alert('Mouse events are working! Now try middle mouse button on canvas.');
    });
    
    testButton.addEventListener('mousedown', (e) => {

    });
    
    document.body.appendChild(testButton);

  }

  // Initialize FTXX Pointer library
  initFTXXPointer() {
    // Configure FTXX to only handle touch events, not mouse events
    try {
      this.ftxx = window.ftxxPointer.init({
        preventDefault: false, // Don't prevent default mouse events
        passive: true, // Make events passive
        disableContextMenu: false, // Allow context menu
        preventViewportScaling: false, // Don't prevent scaling
        skipMouseEvents: true, // Skip mouse events to prevent interference with camera rotation
        // Minimal gesture configuration
        gestureThresholds: { pan: 999, rotation: 999, zoom: 999 }, // Very high thresholds to disable gestures
        gestureSensitivity: { pan: 0, rotation: 0, zoom: 0 }, // Zero sensitivity
        tap: { threshold: 999, timeout: 999999 }, // Disable tap detection
        longpress: { timeout: 999999 }, // Disable longpress
        debug: false // Disable debug to reduce console spam
      });
      
      // Debug: Check if FTXX is initialized
      if (this.ftxx) {
    
      } else {
        console.error('Failed to initialize FTXX Pointer');
      }
    } catch (error) {
      console.error('Error initializing FTXX Pointer:', error);
      this.ftxx = null;
    }
  }
  
  // Setup event listeners for touch and pointer events
  setupEventListeners() {
    if (!this.ftxx || !this.canvas) return;
    
    // Only handle touch events, not pointer events that could interfere with mouse
    // Handle tap events for unit selection
    this.ftxx.on(this.canvas, 'tap', (event) => {
      if (event.pointers.length === 1) {
        const pointer = event.pointers[0];
        this.handleTap(pointer.x, pointer.y);
      }
    });
    
    // Handle longpress events for context menus or special actions
    this.ftxx.on(this.canvas, 'longpress', (event) => {
      if (event.pointers.length === 1) {
        const pointer = event.pointers[0];
        this.handleLongPress(pointer.x, pointer.y);
      }
    });
    
    // Handle unified transform events (pan + rotate + zoom) for multi-touch gestures
    this.ftxx.on(this.canvas, 'transform', (event) => {
      // Cancel any active lasso when gesture starts
      if (!this._isInGesture && this.game && this.game.lassoSelection) {
        this.game.lassoSelection.endLasso();
      }
      this._isInGesture = true;
      
      // Clear any existing reset timer
      if (this._gestureResetTimer) {
        clearTimeout(this._gestureResetTimer);
      }
      
      this.handleTransform(event);
    });
    
    // Note: Individual gesture events (pinch, pan, rotate) are not emitted by ftxx_pointer
    // The library only emits unified 'transform' events that combine all gestures
    
    // Handle touch events for lasso selection (restore selection functionality)
    this.ftxx.on(this.canvas, 'touchstart', (event) => {
      // Start lasso selection only on single touch (not during gestures)
      if (event.pointers.length === 1 && !this._isInGesture) {
        this.startLasso(event.pointers[0].x, event.pointers[0].y);
      }
    });
    
    this.ftxx.on(this.canvas, 'touchmove', (event) => {
      // Update lasso selection only on single touch drag (not during gestures)
      if (event.pointers.length === 1 && !this._isInGesture) {
        this.updateLasso(event.pointers[0].x, event.pointers[0].y);
      }
    });
    
    this.ftxx.on(this.canvas, 'touchend', (event) => {
      // End lasso selection only on single touch release (not during gestures)
      if (event.pointers.length === 1 && !this._isInGesture) {
        this.endLasso(event.pointers[0].x, event.pointers[0].y);
      }
      // Reset gesture state when all pointers are released
      if (event.pointers.length === 0) {
        this._isInGesture = false;
        // Reset lasso system after gesture ends
        if (this.game && this.game.lassoSelection) {
          this.game.lassoSelection.disable();
          this.game.lassoSelection.enable();
        }
      } else if (this._isInGesture && event.pointers.length === 1) {
        // If we're in a gesture and only one pointer remains, set a timer to reset
        if (this._gestureResetTimer) {
          clearTimeout(this._gestureResetTimer);
        }
        this._gestureResetTimer = setTimeout(() => {
          this._isInGesture = false;
          if (this.game && this.game.lassoSelection) {
            this.game.lassoSelection.disable();
            this.game.lassoSelection.enable();
          }
        }, 500); // Reset after 500ms of inactivity
      }
    });

    // Add mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.handleMouseWheel(e);
    });
  }
  
  // Handle tap events for unit selection (left-click)
  handleTap(x, y) {
    // Find unit at tap position
    const unitId = this.findUnitByProximity(x, y);
    
    if (unitId) {
      // Select the unit
      if (this.game.unitManager) {
        this.game.unitManager.selectUnit(unitId);
      }
    } else {
      // Left-click on empty space deselects units
      if (this.game.unitManager) {
        this.game.unitManager.deselectAllUnits();
      }
      if (this.game) {
        this.game.deselectAll();
      }
    }
  }
  
  // Handle right-click events for unit movement
  handleRightClick(x, y) {
    // Right-click on empty space moves selected units
    if (this.game.unitManager && this.game.unitManager.selectedUnits && this.game.unitManager.selectedUnits.size > 0) {
      // Convert screen coordinates to world coordinates for movement
      const worldPos = this.screenToWorld(x, y);
      if (worldPos) {
        // Use the unit manager's move method for proper animation
        this.game.unitManager.moveSelectedUnits(worldPos);
      }
    }
  }

  // Handle long press events
  handleLongPress(x, y) {
    // Find unit at long press position
    const unitId = this.findUnitByProximity(x, y);
    
    if (unitId) {
      // Could trigger context menu or special actions for the unit
      // TODO: Implement context menu or special actions
    }
  }
  

  

  
  // Handle unified transform events (pan + rotate + zoom) for multi-touch gestures
  handleTransform(event) {
    const camera = this.scene.activeCamera;
    
    // Transform events are always multi-touch gestures, so we don't need to check pointer count
    // The ftxx library only emits transform events for 2+ finger gestures
    
    // Camera movement speeds - panning, zooming, and rotating
    const panSpeed = 0.02; // Increased from 0.005 for more panning
    const rotateSpeed = 0.5; // Speed for rotation around Y axis
    const zoomSpeed = 0.3; // Reduced zoom speed to prevent accidental zooming during panning
    
    // Handle panning (move camera target relative to camera view direction)
    if (event.deltaX || event.deltaY) {
      // Calculate the pan direction relative to camera view
      const panDirection = new BABYLON.Vector3();
      
      // Get camera's right vector for left/right panning relative to camera view
      const cameraRight = camera.getDirection(BABYLON.Axis.X);
      panDirection.addInPlace(cameraRight.scale(-event.deltaX * panSpeed));
      
      // Get camera's forward vector for forward/backward panning relative to camera view
      const cameraForward = camera.getDirection(BABYLON.Axis.Z);
      panDirection.addInPlace(cameraForward.scale(event.deltaY * panSpeed));
      
      // Move the camera target (which moves the map) - only in X-Z plane
      camera.target.x += panDirection.x;
      camera.target.z += panDirection.z;
      // Keep Y position unchanged to stay in X-Z plane
    }
    
    // Handle rotation (rotate camera around Y axis)
    if (event.deltaRotation) {
      camera.alpha += event.deltaRotation * rotateSpeed;
    }
    
    // Handle zooming (pinch to zoom) - reduced threshold for more sensitive zooming
    if (event.deltaScale && event.deltaScale !== 1) {
      if (Math.abs(event.deltaScale - 1) > 0.005) { // Reduced threshold from 0.1 to 0.005
        camera.radius /= event.deltaScale;
        // Clamp camera radius to reasonable bounds
        camera.radius = Math.max(1, Math.min(50, camera.radius));
      }
    }
  }
  
  // Lasso selection methods
  startLasso(x, y) {
    // Start lasso selection
    if (this.game && this.game.lassoSelection && !this._isInGesture) {
      this.game.lassoSelection.startLasso(x, y);
    }
  }
  
  updateLasso(x, y) {
    // Update lasso selection
    if (this.game && this.game.lassoSelection && !this._isInGesture) {
      this.game.lassoSelection.updateLasso(x, y);
    }
  }
  
  endLasso(x, y) {
    // End lasso selection
    if (this.game && this.game.lassoSelection && !this._isInGesture) {
      this.game.lassoSelection.endLasso(x, y);
    }
  }

  handleMouseWheel(e) {
    const camera = this.scene.activeCamera;
    if (!camera || !camera.radius) return;
    
    // Zoom in/out with mouse wheel
    const zoomSpeed = 0.1;
    const delta = e.deltaY > 0 ? 1 : -1;
    const newRadius = camera.radius + (delta * zoomSpeed * camera.radius);
    
    // Clamp to camera limits
    if (newRadius >= camera.lowerRadiusLimit && newRadius <= camera.upperRadiusLimit) {
      camera.radius = newRadius;
    }
  }

  handleMiddleMouseDown(e) {
    if (!this.scene || !this.scene.activeCamera) {
      console.error("No scene or active camera found!");
      return;
    }
    
    this.isMiddleMouseDown = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.canvas.style.cursor = 'grabbing';
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
  }

  handleMiddleMouseMove(e) {
    if (!this.isMiddleMouseDown) {
      return;
    }
    
    const camera = this.scene.activeCamera;
    
    if (!camera) {
      console.warn("No active camera found for rotation");
      return;
    }
    
    if (typeof camera.alpha === 'undefined' || typeof camera.beta === 'undefined') {
      console.warn("Camera doesn't support rotation (alpha/beta properties missing)");
      return;
    }
    
    const deltaX = e.clientX - this.lastMouseX;
    const deltaY = e.clientY - this.lastMouseY;
    
    // Rotate camera around target with proper sensitivity
    const sensitivity = 0.01;
    
    camera.alpha -= deltaX * sensitivity; // Negative for intuitive rotation
    camera.beta += deltaY * sensitivity;
    
    // Clamp beta to prevent camera flipping
    camera.beta = Math.max(0.1, Math.min(Math.PI - 0.1, camera.beta));
    
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
  }

  handleMiddleMouseUp(e) {
    this.isMiddleMouseDown = false;
    this.canvas.style.cursor = 'default';
    
    // Prevent default behavior
    e.preventDefault();
    e.stopPropagation();
  }
} 