class InputHandler {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.canvas = document.getElementById('rt-canvas');
    
    // Input state
    this.isDragging = false;
    this.isCameraPanning = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.pointerStartTime = 0;
    this.longPressTimeout = null;
    this.longPressDelay = 500; // ms
    this.tapHandled = false; // Flag to prevent long press after tap
    this.touchLocked = false; // Flag to prevent multiple rapid touches
    
    // Touch tracking for mobile
    this.touchStartX = undefined;
    this.touchStartY = undefined;
    this.touchStartTime = undefined;
    
    // Initialize FTXX Pointer
    this.initFTXXPointer();
    
    // Setup event listeners
    this.setupEventListeners();
  }
  
  initFTXXPointer() {
    // Initialize the FTXX Pointer library
    if (window.ftxxPointer) {
      this.ftxx = window.ftxxPointer;
      
      // Only initialize if not already initialized
      if (!this.ftxx._state.isInitialized) {
        this.ftxx.init({
          preventDefault: true,
          passive: false
        });
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
    // Adjust settings for mobile devices
    this.longPressDelay = 800; // Longer long press delay on mobile to avoid conflicts with taps
    
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
      // Fallback to Babylon.js pointer observable
      this.setupBabylonEvents();
    }
  }
  
  setupFTXXEvents() {
    // Pointer down events
    this.ftxx.on(this.canvas, 'pointerdown', (evt) => {
      this.handlePointerDown(evt);
    });
    
    // Pointer move events
    this.ftxx.on(this.canvas, 'pointermove', (evt) => {
      this.handlePointerMove(evt);
    });
    
    // Pointer up events
    this.ftxx.on(this.canvas, 'pointerup', (evt) => {
      this.handlePointerUp(evt);
    });
    
    // Tap events for quick actions - disabled for touch devices to avoid conflicts
    // We handle taps manually in handlePointerUp for better control
    if (!this.isMobile) {
      this.ftxx.on(this.canvas, 'tap', (evt) => {
        this.handleTap(evt);
      });
    }
    
    // Long press events for context menus - disabled for touch devices to avoid conflicts
    // We handle long press manually in handlePointerDown for better control
    if (!this.isMobile) {
      this.ftxx.on(this.canvas, 'longpress', (evt) => {
        this.handleLongPress(evt);
      });
    }
    
    // Wheel events for zoom
    this.ftxx.on(this.canvas, 'wheel', (evt) => {
      this.handleWheel(evt);
    });
  }
  
  setupBabylonEvents() {
    // Fallback to Babylon.js pointer observable
    this.pointerObserver = this.scene.onPointerObservable.add((evt) => {
      if (evt.type === BABYLON.PointerEventTypes.POINTERDOWN) {
        this.handlePointerDown({
          pointers: [{ x: evt.event.clientX, y: evt.event.clientY, type: 'mouse' }],
          originalEvent: evt.event
        });
      } else if (evt.type === BABYLON.PointerEventTypes.POINTERMOVE) {
        this.handlePointerMove({
          pointers: [{ x: evt.event.clientX, y: evt.event.clientY, type: 'mouse' }],
          originalEvent: evt.event
        });
      } else if (evt.type === BABYLON.PointerEventTypes.POINTERUP) {
        this.handlePointerUp({
          pointers: [{ x: evt.event.clientX, y: evt.event.clientY, type: 'mouse' }],
          originalEvent: evt.event
        });
      } else if (evt.type === BABYLON.PointerEventTypes.POINTERWHEEL) {
        this.handleWheel(evt.event);
      }
    });
    
    // Add wheel event listener for Babylon.js fallback
    this.canvas.addEventListener('wheel', (evt) => {
      this.handleWheel(evt);
    }, { passive: false });
  }
  
  handlePointerDown(evt) {
    const pointer = evt.pointers[0];
    this.lastPointerX = pointer.x;
    this.lastPointerY = pointer.y;
    this.pointerStartTime = Date.now();
    
    // Handle multi-touch gestures
    if (evt.pointers.length === 2) {
      this.handleTwoFingerGesture(evt);
      return;
    }
    
    // Handle different pointer types
    if (pointer.type === 'touch') {
      // Check if touch is locked (prevent rapid touches)
      if (this.touchLocked) {
        console.log('Touch ignored - touch is locked');
        return;
      }
      
      // Touch input - don't immediately start dragging
      // Wait to see if it's a tap or drag
      this.touchStartX = pointer.x;
      this.touchStartY = pointer.y;
      this.touchStartTime = Date.now();
      this.tapHandled = false; // Reset tap handled flag
      this.touchLocked = true; // Lock touch to prevent rapid touches
      
      console.log(`Touch down at (${pointer.x}, ${pointer.y})`);
      
      // Start long press timer for touch (delayed to avoid conflicts with taps)
      this.longPressTimeout = setTimeout(() => {
        this.handleLongPress(evt);
      }, this.longPressDelay);
      console.log(`Long press timer started for touch (${this.longPressDelay}ms)`);
      
      // Prevent default touch behaviors on mobile
      if (evt.preventDefault) {
        evt.preventDefault();
      }
    } else if (pointer.type === 'mouse') {
      // Mouse input - check button
      const originalEvent = evt.originalEvent;
      if (originalEvent.button === 0) { // Left mouse button
        this.handleLeftClick(pointer.x, pointer.y);
        this.isDragging = true;
        
        // Start long press timer for mouse
        this.longPressTimeout = setTimeout(() => {
          this.handleLongPress(evt);
        }, this.longPressDelay);
        console.log(`Long press timer started for mouse (${this.longPressDelay}ms)`);
      } else if (originalEvent.button === 1) { // Middle mouse button
        this.isCameraPanning = true;
      }
    }
  }
  
  handlePointerMove(evt) {
    const pointer = evt.pointers[0];
    
    // Handle touch dragging detection
    if (pointer.type === 'touch' && this.touchStartX !== undefined) {
      const moveDistance = Math.sqrt(
        Math.pow(pointer.x - this.touchStartX, 2) + 
        Math.pow(pointer.y - this.touchStartY, 2)
      );
      
      // If moved more than threshold, start dragging
      if (moveDistance > 10 && !this.isDragging && !this.isCameraPanning) {
        // Check if we're over a unit or empty space
        const pickResult = this.scene.pick(this.touchStartX, this.touchStartY);
        
        if (pickResult.hit) {
          const hitObject = pickResult.pickedMesh;
          const unitId = this.getUnitIdFromMesh(hitObject);
          
          if (unitId !== null) {
            // Dragging over a unit - start selection
            this.handleLeftClick(this.touchStartX, this.touchStartY);
            this.isDragging = true;
          } else {
            // Dragging over empty space - start camera panning
            this.isCameraPanning = true;
          }
        } else {
          // Dragging over empty space - start camera panning
          this.isCameraPanning = true;
        }
      }
    }
    
    if (this.isDragging && this.game.selectionMode === 'rectangle') {
      // Update rectangle selection
      if (this.game.selectionRectangle && this.game.selectionRectangle.isEnabled) {
        this.game.selectionRectangle.updateSelection(pointer.x, pointer.y);
      }
    } else if (this.isDragging && this.game.selectionMode === 'lasso') {
      // Update lasso selection
      if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
        this.game.lassoSelection.updateLasso(pointer.x, pointer.y);
      }
    } else if (this.isCameraPanning) {
      // Camera panning
      const deltaX = pointer.x - this.lastPointerX;
      const deltaY = pointer.y - this.lastPointerY;
      
      const camera = this.scene.activeCamera;
      const panSpeed = 0.01;
      
      camera.alpha -= deltaX * panSpeed;
      camera.beta += deltaY * panSpeed;
    }
    
    this.lastPointerX = pointer.x;
    this.lastPointerY = pointer.y;
  }
  
  handlePointerUp(evt) {
    // Check if there are any pointers before accessing the first one
    if (!evt.pointers || evt.pointers.length === 0) {
      // Clear gesture tracking when all fingers are lifted
      this.gestureStart = null;
      return;
    }
    
    const pointer = evt.pointers[0];
    
    // Clear long press timer
    if (this.longPressTimeout) {
      clearTimeout(this.longPressTimeout);
      this.longPressTimeout = null;
      console.log('Long press timer cleared');
    }
    
    // Clear gesture tracking when all fingers are lifted
    if (evt.pointers.length === 0) {
      this.gestureStart = null;
    }
    
    // Handle touch tap detection
    if (pointer && pointer.type === 'touch' && this.touchStartX !== undefined) {
      const moveDistance = Math.sqrt(
        Math.pow(pointer.x - this.touchStartX, 2) + 
        Math.pow(pointer.y - this.touchStartY, 2)
      );
      const touchDuration = Date.now() - this.touchStartTime;
      
      console.log(`Touch up: distance=${moveDistance.toFixed(2)}, duration=${touchDuration}ms, isDragging=${this.isDragging}, isCameraPanning=${this.isCameraPanning}, tapHandled=${this.tapHandled}`);
      
      // If it's a quick tap (short distance, short duration), handle as tap
      if (moveDistance < 15 && touchDuration < 500 && !this.isDragging && !this.isCameraPanning) {
        console.log('Touch detected as tap, calling handleLeftClick');
        this.tapHandled = true; // Mark that we handled a tap
        
        // Immediately clear the long press timer since we're handling this as a tap
        if (this.longPressTimeout) {
          clearTimeout(this.longPressTimeout);
          this.longPressTimeout = null;
          console.log('Long press timer cleared due to tap detection');
        }
        
        this.handleLeftClick(pointer.x, pointer.y);
      }
      
      // Clear touch start data
      this.touchStartX = undefined;
      this.touchStartY = undefined;
      this.touchStartTime = undefined;
      
      // Reset flags after a short delay to allow for next touch
      setTimeout(() => {
        this.tapHandled = false;
        this.touchLocked = false;
        console.log('Touch flags reset');
      }, 200);
    }
    
    if (this.isDragging) {
      // End selection
      if (this.game.selectionMode === 'rectangle') {
        if (this.game.selectionRectangle && this.game.selectionRectangle.isEnabled) {
          this.game.selectionRectangle.endSelection();
        }
      } else if (this.game.selectionMode === 'lasso') {
        if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
          this.game.lassoSelection.endLasso();
        }
      }
      this.isDragging = false;
    }
    
    if (this.isCameraPanning) {
      this.isCameraPanning = false;
    }
  }
  
  handleTap(evt) {
    // Handle quick tap (no drag) - only for non-touch devices
    // Touch devices handle taps in handlePointerUp
    if (!this.isDragging && evt.pointers && evt.pointers.length > 0) {
      const pointer = evt.pointers[0];
      if (pointer && pointer.type !== 'touch') {
        this.handleLeftClick(pointer.x, pointer.y);
      }
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
    
    // Don't handle long press if we already handled a tap
    if (this.tapHandled) {
      console.log('Long press ignored - tap was already handled');
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
    console.log(`handleLeftClick called at (${screenX}, ${screenY})`);
    const pickResult = this.scene.pick(screenX, screenY);
    
    if (pickResult.hit) {
      const hitObject = pickResult.pickedMesh;
      console.log('Hit object:', hitObject.name || 'unnamed');
      
      // Check if it's a unit
      if (this.game.unitManager) {
        const unitId = this.getUnitIdFromMesh(hitObject);
        console.log('Unit ID found:', unitId);
        if (unitId !== null) {
          // Check if this unit is already selected
          if (this.game.unitManager.selectedUnits.has(unitId)) {
            // If clicking on already selected unit, deselect it
            this.game.unitManager.deselectUnit(unitId);
          } else {
            // Select single unit (deselects others)
            this.game.unitManager.selectUnit(unitId);
          }
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
    
    // Clicked on empty space - deselect all units
    if (this.game.unitManager) {
      this.game.unitManager.deselectAllUnits();
    }
    if (this.game) {
      this.game.deselectAll();
    }
    
    // Start selection on empty space
    if (this.game.selectionMode === 'rectangle') {
      if (this.game.selectionRectangle && this.game.selectionRectangle.isEnabled) {
        this.game.selectionRectangle.startSelection(screenX, screenY);
      }
    } else if (this.game.selectionMode === 'lasso') {
      if (this.game.lassoSelection && this.game.lassoSelection.isEnabled) {
        this.game.lassoSelection.startLasso(screenX, screenY);
      }
    }
  }
  
  handleWheel(evt) {
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
  
  handleTwoFingerGesture(evt) {
    // Handle pinch-to-zoom and two-finger pan
    if (evt.pointers.length === 2) {
      const pointer1 = evt.pointers[0];
      const pointer2 = evt.pointers[1];
      
      // Calculate distance between fingers
      const distance = Math.sqrt(
        Math.pow(pointer2.x - pointer1.x, 2) + 
        Math.pow(pointer2.y - pointer1.y, 2)
      );
      
      // Calculate center point
      const centerX = (pointer1.x + pointer2.x) / 2;
      const centerY = (pointer1.y + pointer2.y) / 2;
      
      // Store initial values for gesture tracking
      if (!this.gestureStart) {
        this.gestureStart = {
          distance: distance,
          centerX: centerX,
          centerY: centerY
        };
      }
      
      // Calculate zoom factor
      const zoomFactor = distance / this.gestureStart.distance;
      const camera = this.scene.activeCamera;
      
      // Apply zoom
      const newRadius = camera.radius / zoomFactor;
      camera.radius = Math.max(camera.lowerRadiusLimit, Math.min(camera.upperRadiusLimit, newRadius));
      
      // Update gesture start for next frame
      this.gestureStart.distance = distance;
      this.gestureStart.centerX = centerX;
      this.gestureStart.centerY = centerY;
      
      // Prevent default behavior
      if (evt.preventDefault) {
        evt.preventDefault();
      }
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
    });
  }
  
  dispose() {
    // Clean up event listeners
    if (this.ftxx && this.canvas) {
      this.ftxx.off(this.canvas, ['pointerdown', 'pointermove', 'pointerup', 'tap', 'longpress', 'wheel']);
    }
    
    if (this.pointerObserver) {
      this.scene.onPointerObservable.remove(this.pointerObserver);
    }
    
    // Remove wheel event listener
    if (this.canvas) {
      this.canvas.removeEventListener('wheel', this.handleWheel);
    }
  }
} 