// Lasso Selection System
// Draws a rectangle on screen and selects units within that area
// Handles: drag selection, single clicks, double clicks

(function(lasso) {
  let isSelecting = false;
  let startPoint = { x: 0, y: 0 };
  let endPoint = { x: 0, y: 0 };
  let selectionBox = null;
  let selectedUnits = [];
  let lassoLineMesh = null; // 3D line mesh for lasso mode
  let lassoLineMaterial = null; // Reused material for the ribbon
  let lassoUpdateCounter = 0; // Throttle 3D lasso updates
  let lastLassoUpdatePointCount = 0; // Track last point count we rendered
  
  // Selection mode: 'rectangle' or 'lasso'
  let selectionMode = 'rectangle';
  let lassoPath = []; // Array of {x, y} screen points for freeform lasso (for 2D and selection)
  let lassoWorldPath = []; // Array of world Vector3 points for 3D rendering
  let lastLassoPoint = null; // Track last recorded point to avoid duplicates
  
  // Configuration
  const DRAG_THRESHOLD = 5; // pixels - minimum movement to start drag
  const CLICK_TIMEOUT = 200; // ms - time to wait before treating as click
  const LASSO_POINT_MIN_DISTANCE = 3; // pixels - minimum distance between lasso points (lower = smoother)
  const LASSO_SIMPLIFY_TOLERANCE = 0.5; // world units - path simplification tolerance
  // const !USE_3D_HUD = true; // Set to false to use 3D fence selection
  
  // State tracking
  let dragStartTime = 0;
  let isDragActive = false;
  let lastClickTime = 0;
  let lastClickPoint = { x: 0, y: 0 };
  
  // RMB tracking during drag operations
  let rmbDownDuringDrag = false;
  let rmbPositionDuringDrag = { x: 0, y: 0 };
  
  // Initialize the lasso system
  lasso.init = function() {
    // console.log("🎯 Lasso selection system initialized");
    // Create selection box mesh (invisible initially)
    createSelectionBox();
    
    // If selection box wasn't created, try again after a short delay
    if (!selectionBox) {
      setTimeout(() => {
        console.log('Retrying selection box initialization...');
        createSelectionBox();
      }, 100);
    }
  };
  
  // Reinitialize lasso when HUD mode changes
  lasso.reinit = function() {
    // console.log('Reinitializing lasso for HUD mode change...');
    
    // Clean up 3D lasso line mesh
    if (lassoLineMesh) {
      lassoLineMesh.dispose();
      lassoLineMesh = null;
    }
    
    // Clean up existing selection box
    if (selectionBox) {
      if (Array.isArray(selectionBox)) {
        // 3D mode cleanup
        selectionBox.forEach(plane => plane.dispose());
      } else if (selectionBox.style) {
        // 2D mode cleanup
        selectionBox.style.display = 'none';
      }
      selectionBox = null;
    }
    
    // Create new selection box for current mode
    createSelectionBox();
    
    // If selection box wasn't created, try again after a short delay
    if (!selectionBox) {
      setTimeout(() => {
        console.log('Retrying selection box reinitialization...');
        createSelectionBox();
      }, 100);
    }
  };
  
  // Create the visual selection box
  function createSelectionBox() {
    if (!USE_3D_HUD) {
      // Get the HTML selection box element
      selectionBox = document.getElementById('lasso-selection-box');
      if (!selectionBox) {
        // console.error('Selection box element not found - 2D lasso selection will not work');
        // console.error('Available elements:', document.querySelectorAll('[id*="lasso"]'));
        selectionBox = null; // Ensure it's explicitly null
        return;
      }
      selectionBox.style.display = 'none';
      // console.log('2D selection box initialized successfully');
      return;
    }
    
    // 3D Selection Box Code
    // Create 4 vertical planes around the edges for a fence-like selection box
    // These will face the camera so they're always visible
    if (!window.gfx || !window.gfx.scene) {
      // console.error('3D selection box creation failed: gfx.scene not available');
      selectionBox = null;
      return;
    }
    
    const lineMaterial = new BABYLON.StandardMaterial("selectionLineMat", window.gfx.scene);
    lineMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1); // Cyan
    lineMaterial.alpha = 0.3; // Semi-transparent
    lineMaterial.emissiveColor = new BABYLON.Color3(0, 0.5, 0.5);
    
    // Create 4 vertical planes for the edges
    const planes = [];
    
    // Top edge (facing north - outward from selection area)
    const topPlane = BABYLON.MeshBuilder.CreatePlane("topPlane", {
      width: 1,
      height: 1
    }, window.gfx.scene);
    topPlane.material = lineMaterial;
    topPlane.rotation.y = 0; // Face north (outward)
    topPlane.position.y = 0.5; // Half height above ground
    topPlane.material.backFaceCulling = false; // Show both sides
    planes.push(topPlane);
    
    // Right edge (facing east - outward from selection area)
    const rightPlane = BABYLON.MeshBuilder.CreatePlane("rightPlane", {
      width: 1,
      height: 1
    }, window.gfx.scene);
    rightPlane.material = lineMaterial;
    rightPlane.rotation.y = Math.PI / 2; // Face east (outward)
    rightPlane.position.y = 0.5; // Half height above ground
    rightPlane.material.backFaceCulling = false; // Show both sides
    planes.push(rightPlane);
    
    // Bottom edge (facing south - outward from selection area)
    const bottomPlane = BABYLON.MeshBuilder.CreatePlane("bottomPlane", {
      width: 1,
      height: 1
    }, window.gfx.scene);
    bottomPlane.material = lineMaterial;
    bottomPlane.rotation.y = Math.PI; // Face south (outward)
    bottomPlane.position.y = 0.5; // Half height above ground
    bottomPlane.material.backFaceCulling = false; // Show both sides
    planes.push(bottomPlane);
    
    // Left edge (facing west - outward from selection area)
    const leftPlane = BABYLON.MeshBuilder.CreatePlane("leftPlane", {
      width: 1,
      height: 1
    }, window.gfx.scene);
    leftPlane.material = lineMaterial;
    leftPlane.rotation.y = -Math.PI / 2; // Face west (outward)
    leftPlane.position.y = 0.5; // Half height above ground
    leftPlane.material.backFaceCulling = false; // Show both sides
    planes.push(leftPlane);
    
    // Store all planes in the selectionBox variable
    selectionBox = planes;
    
    // Make all planes invisible initially
    planes.forEach(plane => {
      plane.isVisible = false;
      plane.isPickable = false;
    });
    
    // console.log("3D fence selection box created successfully with", planes.length, "planes");
  }
  
  // Handle left mouse button down
  lasso.handleLmbDown = function(x, y, e) {
    // Check if we clicked on a UI element - if so, don't start selection
    const clickedElement = document.elementFromPoint(x, y);
    if (clickedElement && (
      clickedElement.closest('.radial-menu-button') ||
      clickedElement.closest('[id^="anchor_"]') ||
      clickedElement.closest('.radial-menu-label') ||
      clickedElement.closest('.lod_slider') ||
      clickedElement.closest('.lod_slider_container') ||
      clickedElement.closest('#lod_slider') ||
      clickedElement.closest('#lod_value') ||
      clickedElement.closest('.binary_switch') ||
      clickedElement.closest('.switch_handle') ||
      clickedElement.closest('#hud_switch') ||
      clickedElement.closest('#shadows_switch') ||
      clickedElement.closest('#menu') ||
      clickedElement.closest('.menu_menu')
    )) {
      // console.log("🎯 Lasso: Clicked on UI element, skipping selection");
      return false;
    }
    
    isSelecting = true; // Start selection mode
    startPoint = { x, y };
    endPoint = { x, y };
    dragStartTime = Date.now();
    isDragActive = false;
    
    // Initialize lasso path
    lassoPath = [{ x, y }];
    lassoWorldPath = []; // Clear world path
    lastLassoPoint = { x, y };
    lassoUpdateCounter = 0; // Reset throttle counter
    lastLassoUpdatePointCount = 0; // Reset point count
    
    // For 3D mode, convert initial point to world coordinates
    if (USE_3D_HUD) {
      const worldPos = screenToWorld(x, y);
      if (worldPos) {
        lassoWorldPath.push(new BABYLON.Vector3(worldPos.x, 1.0, worldPos.z));
      }
    }
    
    // Reset RMB tracking for new drag operation
    rmbDownDuringDrag = false;
    rmbPositionDuringDrag = { x: 0, y: 0 };
    
    // console.log("🎯 Lasso: Mouse down at", { x, y, event: e });
    
    // Show selection box at start point
    if (selectionBox) {
      if (USE_3D_HUD) {
        // 3D mode - selectionBox should be an array of planes
        if (Array.isArray(selectionBox)) {
          // Only show planes for rectangle mode, not lasso mode
          if (selectionMode === 'rectangle') {
            selectionBox.forEach(plane => {
              plane.isVisible = true;
            });
          }
        } else {
          // console.error('3D selection box is not an array:', selectionBox);
          return false;
        }
      } else {
        // 2D mode - selectionBox is a single element
        selectionBox.isVisible = true;
      }
      updateSelectionBox();
    } else {
      // console.warn('Selection box not initialized');
      return false;
    }
    
    // Don't claim we're handling the event yet - wait to see if it becomes a drag
    // Return false so the UI system can handle clicks normally
    return false;
  };
  
  // Handle left mouse button move
  lasso.handleLmbMove = function(x, y) {
    if (!isSelecting) return;
    
    endPoint = { x, y };
    
    // Check if we've moved enough to start dragging
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > DRAG_THRESHOLD && !isDragActive) {
      isDragActive = true;
      // console.log("🎯 Lasso: Drag started at distance", distance);
    }
    
    // For lasso mode, record path points (record as soon as we start moving, not just after drag becomes "active")
    if (isSelecting && selectionMode === 'lasso') {
      // Only add point if it's far enough from the last point
      if (lastLassoPoint) {
        const dx = x - lastLassoPoint.x;
        const dy = y - lastLassoPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist >= LASSO_POINT_MIN_DISTANCE) {
          lassoPath.push({ x, y });
          lastLassoPoint = { x, y };
          
          // For 3D mode, also convert to world coordinates NOW (not later)
          if (USE_3D_HUD) {
            const worldPos = screenToWorld(x, y);
            if (worldPos) {
              lassoWorldPath.push(new BABYLON.Vector3(worldPos.x, 1.0, worldPos.z));
            }
          }
        }
      } else {
        lassoPath.push({ x, y });
        lastLassoPoint = { x, y };
        
        // For 3D mode, also convert to world coordinates NOW
        if (USE_3D_HUD) {
          const worldPos = screenToWorld(x, y);
          if (worldPos) {
            lassoWorldPath.push(new BABYLON.Vector3(worldPos.x, 1.0, worldPos.z));
          }
        }
      }
    }
    
    // Update visual selection box
    if (isSelecting && selectionBox) {
      // For 3D lasso mode, update very infrequently to show progress without accordion
      if (USE_3D_HUD && selectionMode === 'lasso') {
        const pointsSinceLastUpdate = lassoWorldPath.length - lastLassoUpdatePointCount;
        if (pointsSinceLastUpdate >= 5) { // Update more often now that updates are cheaper
          lastLassoUpdatePointCount = lassoWorldPath.length;
          updateSelectionBox();
        }
      } else {
        // 2D and rectangle modes update live
        updateSelectionBox();
      }
    }
  };
  
  // Handle left mouse button up
  lasso.handleLmbUp = function(x, y) {
    if (!isSelecting) return;
    
    endPoint = { x, y };
    
    // Check if this was a drag or a click
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // console.log("🎯 Lasso: Mouse up analysis:", { 
    //   distance, 
    //   threshold: DRAG_THRESHOLD, 
    //   isDragActive, 
    //   wasDrag: distance > DRAG_THRESHOLD && isDragActive 
    // });
    
    if (distance > DRAG_THRESHOLD && isDragActive) {
      // This was a drag - perform area selection
      
      // Force final lasso update to show complete path
      if (USE_3D_HUD && selectionMode === 'lasso' && selectionBox) {
        lastLassoUpdatePointCount = lassoWorldPath.length; // Mark as updated
        updateSelectionBox();
      }
      
      performAreaSelection();
      
      // Delay cleanup to allow RMB events to detect recent lasso activity
      setTimeout(() => {
        cleanupSelection();
      }, 100); // 100ms delay
    } else {
      // This was a click - don't handle it here, let UI system handle it
      // Clean up immediately for clicks
      cleanupSelection();
    }
  };
  
  // Check if selection is currently active
  lasso.isSelectionActive = function() {
    return isSelecting;
  };
  
  // Check if the lasso system actually performed a drag selection
  lasso.wasDragSelection = function() {
    return isDragActive;
  };
  
  // Check if the current click should be handled by the lasso system (i.e., it was a drag)
  lasso.shouldHandleClick = function() {
    // console.log("🎯 Lasso: shouldHandleClick called, isDragActive:", isDragActive);
    return isDragActive;
  };
  
  // Handle RMB events during drag operations
  lasso.handleRmbDown = function(x, y, e) {
    if (isSelecting && isDragActive) {
      rmbDownDuringDrag = true;
      rmbPositionDuringDrag = { x, y };
      // console.log("🎯 Lasso: RMB DOWN during drag at", { x, y });
      return true; // Claim this RMB event
    }
    return false; // Let UI system handle it
  };
  
  lasso.handleRmbUp = function(x, y, e) {
    if (rmbDownDuringDrag) {
      rmbDownDuringDrag = false;
      // console.log("🎯 Lasso: RMB UP during drag at", { x, y });
      return true; // Claim this RMB event
    }
    return false; // Let UI system handle it
  };
  
  lasso.handleRmbMove = function(x, y, e) {
    if (rmbDownDuringDrag && isSelecting && isDragActive) {
      rmbPositionDuringDrag = { x, y };
      // console.log("🎯 Lasso: RMB MOVE during drag at", { x, y });
      return true; // Claim this RMB event
    }
    return false; // Let UI system handle it
  };
  
  // Check if RMB is currently active during drag
  lasso.isRmbActiveDuringDrag = function() {
    return rmbDownDuringDrag && isSelecting && isDragActive;
  };
  
  // Get RMB position during drag
  lasso.getRmbPositionDuringDrag = function() {
    return rmbPositionDuringDrag;
  };
  
  // Update 3D lasso line mesh
  function updateLassoLine3D() {
    if (!window.gfx || !window.gfx.scene) return;
    if (lassoWorldPath.length < 3) return;

    const worldPoints = simplifyWorldPath(lassoWorldPath, LASSO_SIMPLIFY_TOLERANCE);
    
    // Need at least 2 points to draw
    if (worldPoints.length < 2) return;
    
    // Create a VERTICAL FENCE/WALL following the simplified perimeter path
    const FENCE_HEIGHT = 3; // Tall fence
    
    // Create bottom and top paths for the ribbon (vertical wall)
    const bottomPath = worldPoints.map(p => new BABYLON.Vector3(p.x, 0, p.z)); // On ground
    const topPath = worldPoints.map(p => new BABYLON.Vector3(p.x, FENCE_HEIGHT, p.z)); // At height
    
    const pathArray = [bottomPath, topPath];
    const ribbonOptions = {
      pathArray,
      closePath: true,
      closeArray: false,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      updatable: true
    };
    
    const scene = window.gfx.scene;
    
    if (!lassoLineMesh || lassoLineMesh.isDisposed()) {
      lassoLineMesh = BABYLON.MeshBuilder.CreateRibbon("lassoFence", ribbonOptions, scene);
      lassoLineMesh.isPickable = false;
      lassoLineMesh.renderingGroupId = 3; // Render on top of everything
      
      if (!lassoLineMaterial || lassoLineMaterial.isDisposed?.()) {
        lassoLineMaterial = new BABYLON.StandardMaterial("lassoMat", scene);
        lassoLineMaterial.emissiveColor = new BABYLON.Color3(0, 2, 2); // Maximum brightness cyan
        lassoLineMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1);
        lassoLineMaterial.alpha = 0.5; // Semi-transparent
        lassoLineMaterial.disableLighting = true;
        lassoLineMaterial.backFaceCulling = false; // Show both sides
      }
      
      lassoLineMesh.material = lassoLineMaterial;
      
      if (window.gfx.glowLayer && !lassoLineMesh.__lassoGlowAdded) {
        window.gfx.glowLayer.addIncludedOnlyMesh(lassoLineMesh);
        lassoLineMesh.__lassoGlowAdded = true;
      }
    } else {
      BABYLON.MeshBuilder.CreateRibbon(null, { ...ribbonOptions, instance: lassoLineMesh }, scene);
    }
  }
  
  // Update the visual selection box
  function updateSelectionBox() {
    if (!selectionBox) {
      // console.warn('Selection box not initialized');
      return;
    }
    
    if (!window.gfx) return;

    if (!USE_3D_HUD) {
      // 2D mode - selectionBox should be an HTML element
      if (!selectionBox.style) {
        // console.error('Selection box is not an HTML element in 2D mode');
        return;
      }
      
      if (selectionMode === 'lasso' && lassoPath.length > 2) {
        // Draw lasso path using clip-path
        const pathString = lassoPath.map((p, i) => `${p.x}px ${p.y}px`).join(', ');
        selectionBox.style.display = 'block';
        selectionBox.style.left = '0px';
        selectionBox.style.top = '0px';
        selectionBox.style.width = '100%';
        selectionBox.style.height = '100%';
        selectionBox.style.clipPath = `polygon(${pathString})`;
        selectionBox.style.webkitClipPath = `polygon(${pathString})`;
      } else {
        // Rectangle mode or not enough points yet
        // Clear clip-path
        selectionBox.style.clipPath = 'none';
        selectionBox.style.webkitClipPath = 'none';
        
        // Calculate rectangle dimensions
        const left = Math.min(startPoint.x, endPoint.x);
        const top = Math.min(startPoint.y, endPoint.y);
        const width = Math.abs(endPoint.x - startPoint.x);
        const height = Math.abs(endPoint.y - startPoint.y);
        
        // Batch style updates
        const style = selectionBox.style;
        style.display = 'block';
        style.left = left + 'px';
        style.top = top + 'px';
        style.width = width + 'px';
        style.height = height + 'px';
      }
      return;
    }

    // 3D Selection Box Code
    if (!window.gfx.camera) return;
    
    // Check if we're in lasso mode with enough points
    if (selectionMode === 'lasso' && lassoPath.length > 2) {
      // Use line mesh for lasso in 3D
      updateLassoLine3D();
      return;
    }
    
    // Rectangle mode - use planes
    if (!Array.isArray(selectionBox)) return;
    
    // Get the four corners of our 2D selection box in screen space
    const corners = {
      topLeft: { x: Math.min(startPoint.x, endPoint.x), y: Math.min(startPoint.y, endPoint.y) },
      topRight: { x: Math.max(startPoint.x, endPoint.x), y: Math.min(startPoint.y, endPoint.y) },
      bottomLeft: { x: Math.min(startPoint.x, endPoint.x), y: Math.max(startPoint.y, endPoint.y) },
      bottomRight: { x: Math.max(startPoint.x, endPoint.x), y: Math.max(startPoint.y, endPoint.y) }
    };
    
    // Project all corners to world space
    const worldCorners = {
      topLeft: screenToWorld(corners.topLeft.x, corners.topLeft.y),
      topRight: screenToWorld(corners.topRight.x, corners.topRight.y),
      bottomLeft: screenToWorld(corners.bottomLeft.x, corners.bottomLeft.y),
      bottomRight: screenToWorld(corners.bottomRight.x, corners.bottomRight.y)
    };
    
    if (!worldCorners.topLeft || !worldCorners.topRight || 
        !worldCorners.bottomLeft || !worldCorners.bottomRight) return;
    
    // // console.log("🎯 3D fence selection update:", { 
    //   start: startWorld, 
    //   end: endWorld, 
    //   center: { x: centerX, z: centerZ }, 
    //   size: { width, height } 
    // });
    
    // Update each plane to form the fence around the selection area
    const [topPlane, rightPlane, bottomPlane, leftPlane] = selectionBox;
    
    // Calculate lengths for each edge
    const topLength = BABYLON.Vector3.Distance(
      new BABYLON.Vector3(worldCorners.topLeft.x, 0, worldCorners.topLeft.z),
      new BABYLON.Vector3(worldCorners.topRight.x, 0, worldCorners.topRight.z)
    );
    const rightLength = BABYLON.Vector3.Distance(
      new BABYLON.Vector3(worldCorners.topRight.x, 0, worldCorners.topRight.z),
      new BABYLON.Vector3(worldCorners.bottomRight.x, 0, worldCorners.bottomRight.z)
    );
    const bottomLength = BABYLON.Vector3.Distance(
      new BABYLON.Vector3(worldCorners.bottomLeft.x, 0, worldCorners.bottomLeft.z),
      new BABYLON.Vector3(worldCorners.bottomRight.x, 0, worldCorners.bottomRight.z)
    );
    const leftLength = BABYLON.Vector3.Distance(
      new BABYLON.Vector3(worldCorners.topLeft.x, 0, worldCorners.topLeft.z),
      new BABYLON.Vector3(worldCorners.bottomLeft.x, 0, worldCorners.bottomLeft.z)
    );
    
    const FENCE_HEIGHT = 2; // Height of the selection fence

    // Right edge - lay flat on ground
    rightPlane.position.x = (worldCorners.topRight.x + worldCorners.bottomRight.x) / 2;
    rightPlane.position.z = (worldCorners.topRight.z + worldCorners.bottomRight.z) / 2;
    rightPlane.position.y = FENCE_HEIGHT / 2; // Raise up
    rightPlane.scaling.x = Math.max(rightLength, 0.1);
    rightPlane.rotation.x = -Math.PI/2; // Lay flat
    rightPlane.rotation.y = Math.atan2(
      worldCorners.bottomRight.x - worldCorners.topRight.x,
      worldCorners.bottomRight.z - worldCorners.topRight.z
    ) + Math.PI / 2;
    rightPlane.isVisible = true;
    
    // Left edge - lay flat on ground
    leftPlane.position.x = (worldCorners.topLeft.x + worldCorners.bottomLeft.x) / 2;
    leftPlane.position.z = (worldCorners.topLeft.z + worldCorners.bottomLeft.z) / 2;
    leftPlane.position.y = FENCE_HEIGHT / 2; // Raise up
    leftPlane.scaling.x = Math.max(leftLength, 0.1);
    leftPlane.rotation.x = -Math.PI/2; // Lay flat
    leftPlane.rotation.y = Math.atan2(
      worldCorners.bottomLeft.x - worldCorners.topLeft.x,
      worldCorners.bottomLeft.z - worldCorners.topLeft.z
    ) - Math.PI / 2;
    leftPlane.isVisible = true;

    // Top edge - vertical plane connecting left and right at top
    topPlane.position.x = (worldCorners.topLeft.x + worldCorners.topRight.x) / 2;
    topPlane.position.z = (worldCorners.topLeft.z + worldCorners.topRight.z) / 2;
    topPlane.position.y = FENCE_HEIGHT / 2; // Center at same height as sides
    topPlane.scaling.x = Math.max(topLength, 0.1);
    topPlane.rotation.y = Math.atan2(
      worldCorners.topRight.x - worldCorners.topLeft.x,
      worldCorners.topRight.z - worldCorners.topLeft.z
    ) + Math.PI/2; // Add 90 degrees to align plane with edge
    topPlane.isVisible = true;
    
    // Bottom edge - vertical plane connecting left and right at bottom
    bottomPlane.position.x = (worldCorners.bottomLeft.x + worldCorners.bottomRight.x) / 2;
    bottomPlane.position.z = (worldCorners.bottomLeft.z + worldCorners.bottomRight.z) / 2;
    bottomPlane.position.y = FENCE_HEIGHT / 2; // Center at same height as sides
    bottomPlane.scaling.x = Math.max(bottomLength, 0.1);
    bottomPlane.rotation.y = Math.atan2(
      worldCorners.bottomRight.x - worldCorners.bottomLeft.x,
      worldCorners.bottomRight.z - worldCorners.bottomLeft.z
    ) + Math.PI + Math.PI/2; // Add 90 degrees to align plane with edge
    bottomPlane.isVisible = true;
    leftPlane.isVisible = true;
    
    // console.log("🎯 3D fence selection updated");
  }
  
  // Convert screen coordinates to world coordinates
  function screenToWorld(screenX, screenY) {
    if (!window.gfx || !window.gfx.camera || !window.gfx.scene) return null;
    
    // console.log("🎯 Creating ray for screen coords:", { x: screenX, y: screenY });
    // console.log("🎯 Camera position:", window.gfx.camera.position);
    // console.log("🎯 Camera rotation:", window.gfx.camera.rotation);
    
    // Create picking ray
    const ray = window.gfx.scene.createPickingRay(
      screenX, 
      screenY, 
      BABYLON.Matrix.Identity(), 
      window.gfx.camera
    );
    
    // console.log("🎯 Ray created:", { origin: ray.origin, direction: ray.direction });
    
    // Pick against ground plane (y = 0) using the correct API
    const groundPlane = new BABYLON.Plane(0, 1, 0, 0);
    const intersection = ray.intersectsPlane(groundPlane);
    
    // console.log("🎯 Ground plane intersection:", intersection);
    
    if (intersection) {
      const worldPos = ray.origin.add(ray.direction.scale(intersection));
      // console.log("🎯 Screen to world:", { screen: { x: screenX, y: screenY }, world: worldPos });
      return worldPos;
    }
    
    console.warn("🎯 Screen to world failed for:", { x: screenX, y: screenY });
    return null;
  }
  
  // Perform area selection based on selection box
  function performAreaSelection() {
    if (!window.player || !window.player.units || !window.gfx || !window.gfx.scene) return;
    
    // Clear current selection
    window.player.clearSelection();
    
    // Get selection box bounds in screen space
    const minX = Math.min(startPoint.x, endPoint.x);
    const maxX = Math.max(startPoint.x, endPoint.x);
    const minY = Math.min(startPoint.y, endPoint.y);
    const maxY = Math.max(startPoint.y, endPoint.y);
    
    // Find units within selection area by checking their screen positions
    let selectedCount = 0;
    window.player.units.forEach(unit => {
      if (unit.mesh && unit.pb && unit.pb.state) {
        // Get unit's world position
        const worldPos = unit.mesh.position;
        
        // Project world position to screen coordinates
        const screenPos = BABYLON.Vector3.Project(
          worldPos,
          BABYLON.Matrix.Identity(),
          window.gfx.scene.getTransformMatrix(),
          window.gfx.camera.viewport.toGlobal(
            window.gfx.engine.getRenderWidth(),
            window.gfx.engine.getRenderHeight()
          )
        );
        
        // Check if screen position is within selection area
        let isInside = false;
        if (selectionMode === 'lasso' && lassoPath.length > 2) {
          // Use polygon test for lasso mode
          isInside = isPointInPolygon(screenPos, lassoPath);
        } else {
          // Use rectangle test for rectangle mode
          isInside = (screenPos.x >= minX && screenPos.x <= maxX && 
                      screenPos.y >= minY && screenPos.y <= maxY);
        }
        
        if (isInside) {
          window.player.selectUnit(unit);
          selectedCount++;
        }
      }
    });
    
    // console.log(`🎯 Selected ${selectedCount} units in ${selectionMode} mode`);
  }
  
  // Handle single click on unit
  function handleSingleClick(x, y) {
    if (!window.player) return;
    
    // Clear current selection
    window.player.clearSelection();
    
    // Find unit at click position
    const unit = findUnitAtPosition(x, y);
    if (unit) {
      window.player.selectUnit(unit);
      // console.log(`🎯 Lasso: Selected unit ${unit.name || unit.type}`);
    }
  }
  
  // Handle double click - select all units of same type
  function handleDoubleClick(x, y) {
    if (!window.player) return;
    
    // Find unit at click position
    const unit = findUnitAtPosition(x, y);
    if (unit) {
      window.player.selectAllUnitsOfType(unit.type);
    }
  }
  
  // Find unit at screen position
  function findUnitAtPosition(screenX, screenY) {
    if (!window.gfx || !window.gfx.scene || !window.player || !window.player.units) return null;
    
    // Create picking ray
    const ray = window.gfx.scene.createPickingRay(
      screenX, 
      screenY, 
      BABYLON.Matrix.Identity(), 
      window.gfx.camera
    );
    
    // Check each unit for intersection
    let closestUnit = null;
    let closestDistance = Infinity;
    
    window.player.units.forEach(unit => {
      if (unit.mesh && unit.mesh.isPickable) {
        const pickResult = ray.intersectsMesh(unit.mesh);
        if (pickResult.hit && pickResult.distance < closestDistance) {
          closestUnit = unit;
          closestDistance = pickResult.distance;
        }
      }
    });
    
    return closestUnit;
  }
  
  // Clean up selection state
  function cleanupSelection() {
    isSelecting = false;
    isDragActive = false;
    
    // Clear lasso path
    lassoPath = [];
    lassoWorldPath = [];
    lastLassoPoint = null;
    
    // Dispose 3D lasso line mesh
    if (lassoLineMesh) {
      if (window.gfx?.glowLayer && lassoLineMesh.__lassoGlowAdded) {
        window.gfx.glowLayer.removeIncludedOnlyMesh?.(lassoLineMesh);
        lassoLineMesh.__lassoGlowAdded = false;
      }
      lassoLineMesh.dispose();
      lassoLineMesh = null;
    }
    
    if (!USE_3D_HUD) {
      if (selectionBox) {
        selectionBox.style.display = 'none';
        // Clear clip-path for lasso mode
        selectionBox.style.clipPath = 'none';
        selectionBox.style.webkitClipPath = 'none';
      }
    } else {
      // Hide all selection fence planes
      if (selectionBox && Array.isArray(selectionBox)) {
        selectionBox.forEach(plane => {
          plane.isVisible = false;
        });
      }
    }
    
    // console.log("🎯 Lasso: Selection cleanup complete");
  }
  
  // Set selection mode
  lasso.setMode = function(mode) {
    if (mode === 'rectangle' || mode === 'lasso') {
      selectionMode = mode;
      // console.log(`🎯 Selection mode changed to: ${mode}`);
    } else {
      console.warn(`🎯 Invalid selection mode: ${mode}`);
    }
  };
  
  // Get current selection mode
  lasso.getMode = function() {
    return selectionMode;
  };
  
  // Simplify the drawn world-space path while preserving vertex order
  function simplifyWorldPath(points, tolerance = 0.5) {
    if (!points || points.length === 0) return [];
    
    if (points.length <= 2) {
      return points.map(p => p.clone());
    }
    
    // Remove consecutive duplicates and clone to avoid mutating original points
    const deduped = [];
    const DUP_EPSILON_SQ = 0.00001;
    for (const point of points) {
      if (
        deduped.length === 0 ||
        BABYLON.Vector3.DistanceSquared(point, deduped[deduped.length - 1]) > DUP_EPSILON_SQ
      ) {
        deduped.push(point.clone());
      }
    }
    
    if (deduped.length <= 2) {
      return deduped;
    }
    
    // For closed paths, remove trailing duplicate of the first point
    if (BABYLON.Vector3.DistanceSquared(deduped[0], deduped[deduped.length - 1]) < DUP_EPSILON_SQ) {
      deduped.pop();
    }
    
    if (deduped.length <= 2) {
      return deduped;
    }
    
    const simplified = simplifyPathRDP(deduped, tolerance);
    return simplified.length >= 2 ? simplified : deduped;
  }
  
  function simplifyPathRDP(points, tolerance) {
    const tolSq = tolerance * tolerance;
    const lastIndex = points.length - 1;
    const stack = [[0, lastIndex]];
    const keep = new Array(points.length).fill(false);
    keep[0] = true;
    keep[lastIndex] = true;
    
    while (stack.length > 0) {
      const [startIdx, endIdx] = stack.pop();
      let maxDistSq = 0;
      let maxIndex = -1;
      
      for (let i = startIdx + 1; i < endIdx; i++) {
        const distSq = pointSegmentDistanceSq(points[i], points[startIdx], points[endIdx]);
        if (distSq > maxDistSq) {
          maxDistSq = distSq;
          maxIndex = i;
        }
      }
      
      if (maxIndex !== -1 && maxDistSq > tolSq) {
        keep[maxIndex] = true;
        stack.push([startIdx, maxIndex]);
        stack.push([maxIndex, endIdx]);
      }
    }
    
    const simplified = [];
    for (let i = 0; i < points.length; i++) {
      if (keep[i]) {
        simplified.push(points[i]);
      }
    }
    
    return simplified;
  }
  
  function pointSegmentDistanceSq(point, start, end) {
    const ax = start.x;
    const az = start.z;
    const bx = end.x;
    const bz = end.z;
    const px = point.x;
    const pz = point.z;
    
    const abx = bx - ax;
    const abz = bz - az;
    const apx = px - ax;
    const apz = pz - az;
    const abLenSq = abx * abx + abz * abz;
    
    if (abLenSq === 0) {
      return apx * apx + apz * apz;
    }
    
    let t = (apx * abx + apz * abz) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    
    const closestX = ax + abx * t;
    const closestZ = az + abz * t;
    
    const dx = px - closestX;
    const dz = pz - closestZ;
    
    return dx * dx + dz * dz;
  }
  
  // Point-in-polygon test using ray casting algorithm
  function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      
      const intersect = ((yi > point.y) !== (yj > point.y))
          && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  
  // Dispose of lasso resources
  lasso.dispose = function() {
    // Dispose 3D lasso line mesh
    if (lassoLineMesh) {
      if (window.gfx?.glowLayer && lassoLineMesh.__lassoGlowAdded) {
        window.gfx.glowLayer.removeIncludedOnlyMesh?.(lassoLineMesh);
        lassoLineMesh.__lassoGlowAdded = false;
      }
      lassoLineMesh.dispose();
      lassoLineMesh = null;
    }
    
    if (!USE_3D_HUD) {
      if (selectionBox) {
        selectionBox.style.display = 'none';
        selectionBox = null;
      }
    } else {
      if (selectionBox) {
        selectionBox.forEach(plane => plane.dispose());
        selectionBox = null;
      }
    }
    // console.log("🎯 Lasso: Resources disposed");
  };
  
})(window.lassoSelection = {});


