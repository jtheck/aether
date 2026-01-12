// Lasso Selection System
// Draws a rectangle on screen and selects units within that area
// Handles: drag selection, single clicks, double clicks

(function(lasso) {
  let isSelecting = false;
  let isPotentialDrag = false; // Track if mousedown happened but drag hasn't started yet
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
  const DRAG_THRESHOLD = 19; // pixels - minimum movement to start drag
  const CLICK_TIMEOUT = 200; // ms - time to wait before treating as click
  const LASSO_POINT_MIN_DISTANCE = 3; // pixels - minimum distance between lasso points (lower = smoother)
  const LASSO_SIMPLIFY_TOLERANCE = 0.5; // world units - path simplification tolerance
  // const !USE_3D_HUD = true; // Set to false to use 3D fence selection
  
  // State tracking
  let dragStartTime = 0;
  let isDragActive = false;
  let lastClickTime = 0;
  let lastClickPoint = { x: 0, y: 0 };
  let lastLassoDownTime = 0; // Track when lasso mousedown happened
  
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
    
    // Clean up lasso fence panels
    if (typeof disposeLassoFencePanels === 'function') {
      disposeLassoFencePanels();
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
    lineMaterial.alpha = 1.0; // Opaque
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
    
    // Check if this might be a double-click (very recent mousedown)
    // If we had a mousedown very recently (< 300ms), don't start lasso to avoid double-click issues
    const currentTime = Date.now();
    const timeSinceLastDown = currentTime - lastLassoDownTime;
    if (timeSinceLastDown < 300 && lastLassoDownTime > 0) {
      // This might be a double-click - don't start lasso
      // console.log("🎯 Lasso: Potential double-click detected, skipping lasso");
      return false;
    }
    lastLassoDownTime = currentTime;
    
    // Don't start selection mode yet - wait until we detect actual dragging
    // Just store the starting point for potential drag detection
    isSelecting = false; // Don't activate until drag is detected
    isPotentialDrag = true; // Track that we have a mousedown that might become a drag
    startPoint = { x, y };
    endPoint = { x, y };
    dragStartTime = Date.now();
    isDragActive = false;
    
    // Initialize lasso path (but don't show anything yet)
    lassoPath = [{ x, y }];
    lassoWorldPath = []; // Clear world path
    lastLassoPoint = { x, y };
    lassoUpdateCounter = 0; // Reset throttle counter
    lastLassoUpdatePointCount = 0; // Reset point count
    
    // For 3D mode, convert initial point to world coordinates (but don't show yet)
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
    
    // DON'T show selection box yet - wait for actual drag
    // Selection box will be shown in handleLmbMove when drag is detected
    
    // Don't claim we're handling the event yet - wait to see if it becomes a drag
    // Return false so the UI system can handle clicks normally
    return false;
  };
  
  // Handle left mouse button move
  lasso.handleLmbMove = function(x, y) {
    // If we haven't started selecting yet, check if we should start (drag detected)
    if (!isSelecting && isPotentialDrag) {
      // Check if we've moved enough to start dragging
      const dx = x - startPoint.x;
      const dy = y - startPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > DRAG_THRESHOLD) {
        // Now we've detected a drag - start the selection
        isSelecting = true;
        isDragActive = true;
        
        // Hide radial menu when drag starts
        if (window.hud && window.hud.hideRadialMenu) {
          window.hud.hideRadialMenu();
        }
        
        // Show selection box now that we're actually dragging
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
            }
          } else {
            // 2D mode - selectionBox is a single element
            selectionBox.isVisible = true;
          }
        }
        
        // console.log("🎯 Lasso: Drag started at distance", distance);
      } else {
        // Not enough movement yet - don't start selection
        return;
      }
    }
    
    endPoint = { x, y };
    
    // Check if we've moved enough to start dragging (for already-active selections)
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > DRAG_THRESHOLD && !isDragActive) {
      isDragActive = true;
      
      // Hide radial menu when drag starts
      if (window.hud && window.hud.hideRadialMenu) {
        window.hud.hideRadialMenu();
      }
      
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
      // For 3D lasso mode, update frequently for smooth feedback
      if (USE_3D_HUD && selectionMode === 'lasso') {
        const pointsSinceLastUpdate = lassoWorldPath.length - lastLassoUpdatePointCount;
        if (pointsSinceLastUpdate >= 1) { // Update every point for responsive feel
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
    // console.log(`🎯 handleLmbUp called at (${x}, ${y}), isSelecting=${isSelecting}, isPotentialDrag=${isPotentialDrag}`);
    
    // Always clean up isPotentialDrag on mouseup, even if selection never started
    const hadPotentialDrag = isPotentialDrag;
    
    // If selection never started (no drag detected), just clean up silently
    if (!isSelecting && !isPotentialDrag) {
      // Nothing to clean up
      // console.log(`🎯 handleLmbUp: No selection or potential drag, returning false`);
      return false;
    }
    
    if (!isSelecting) {
      // console.log(`🎯 handleLmbUp: Not selecting, treating as click`);
      
      // We had a mousedown but never started dragging - this is a click!
      // Handle single click selection for units/buildings
      const clickDuration = Date.now() - dragStartTime;
      const isDoubleClick = (Date.now() - lastClickTime < 400) && 
                           (Math.abs(x - lastClickPoint.x) < 40) && 
                           (Math.abs(y - lastClickPoint.y) < 40);
      
      // console.log(`🎯 Click analysis: duration=${clickDuration}ms, timeout=${CLICK_TIMEOUT}ms, isDouble=${isDoubleClick}`);
      
      let handledEntityClick = false;
      
      if (clickDuration < CLICK_TIMEOUT) {
        // Try to find entity at click position
        // console.log(`🎯 Looking for entity at (${x}, ${y})`);
        handledEntityClick = handleSingleClick(x, y);
      } else {
        // console.log(`🎯 Click too slow (${clickDuration}ms > ${CLICK_TIMEOUT}ms), not handling`);
      }
      
      // Update last click tracking
      lastClickTime = Date.now();
      lastClickPoint = { x, y };
      
      // Clean up lasso state
      isPotentialDrag = false;
      startPoint = { x: 0, y: 0 };
      endPoint = { x: 0, y: 0 };
      isDragActive = false;
      lassoPath = [];
      lassoWorldPath = [];
      lastLassoPoint = null;
      lastLassoDownTime = 0; // Reset timing
      
      // console.log(`🎯 Lasso handleLmbUp (click): returning ${handledEntityClick}`);
      
      // Return true if we selected an entity (suppress move command)
      // Return false if empty click (allow move command)
      return handledEntityClick;
    }
    
    endPoint = { x, y };
    
    // Check if this was a drag or a click
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Store whether this was a drag selection BEFORE cleanup (which resets isDragActive)
    const wasDragSelection = distance > DRAG_THRESHOLD && isDragActive;
    
    // console.log("🎯 Lasso: Mouse up analysis:", { 
    //   distance, 
    //   threshold: DRAG_THRESHOLD, 
    //   isDragActive, 
    //   wasDrag: wasDragSelection 
    // });
    
    if (wasDragSelection) {
      // This was a drag - perform area selection
      
      // Force final lasso update to show complete path
      if (USE_3D_HUD && selectionMode === 'lasso' && selectionBox) {
        lastLassoUpdatePointCount = lassoWorldPath.length; // Mark as updated
        updateSelectionBox();
      }
      
      performAreaSelection();
      
      // Clean up immediately so the rectangle/hud stops following the cursor
      cleanupSelection();
      
      // Return true to indicate a drag selection was performed
      return true;
    } else {
      // This was a click with drag movement, but below the drag threshold
      // Already handled above in the !isSelecting block
      cleanupSelection();
      return false;
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
  
  // Lasso fence panels - array of planes for each segment
  let lassoFencePanels = [];
  
  // Update 3D lasso - creates individual fence panels between consecutive points
  function updateLassoLine3D() {
    if (!window.gfx || !window.gfx.scene) return;
    if (lassoWorldPath.length < 2) return;

    // Use raw path directly (no RDP simplification)
    const worldPoints = lassoWorldPath;
    
    // Need at least 2 points
    if (worldPoints.length < 2) return;
    
    const FENCE_HEIGHT = 1.25;
    const scene = window.gfx.scene;
    
    // Create material if needed
    if (!lassoLineMaterial || lassoLineMaterial.isDisposed?.()) {
      lassoLineMaterial = new BABYLON.StandardMaterial("lassoMat", scene);
      lassoLineMaterial.emissiveColor = new BABYLON.Color3(0, 1, 1);
      lassoLineMaterial.diffuseColor = new BABYLON.Color3(0, 1, 1);
      lassoLineMaterial.alpha = 0.8;
      lassoLineMaterial.disableLighting = true;
      lassoLineMaterial.backFaceCulling = false;
    }
    
    // Create/update fence panels between consecutive points
    const numSegments = worldPoints.length; // Include closing segment
    
    // Dispose extra panels if we have too many
    while (lassoFencePanels.length > numSegments) {
      const panel = lassoFencePanels.pop();
      if (panel && !panel.isDisposed()) panel.dispose();
    }
    
    // Create or update each panel
    for (let i = 0; i < numSegments; i++) {
      const p1 = worldPoints[i];
      const p2 = worldPoints[(i + 1) % worldPoints.length]; // Wrap to close loop
      
      // Calculate panel properties
      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      
      if (length < 0.01) continue; // Skip tiny segments
      
      const centerX = (p1.x + p2.x) / 2;
      const centerZ = (p1.z + p2.z) / 2;
      const angle = Math.atan2(dx, dz) + Math.PI / 2; // Rotate to align with segment
      
      let panel = lassoFencePanels[i];
      
      if (!panel || panel.isDisposed()) {
        // Create new panel
        panel = BABYLON.MeshBuilder.CreatePlane(`lassoPanel_${i}`, {
          width: 1,
          height: 1
        }, scene);
        panel.material = lassoLineMaterial;
        panel.isPickable = false;
        panel.renderingGroupId = 3;
        lassoFencePanels[i] = panel;
        
        if (window.gfx.glowLayer) {
          window.gfx.glowLayer.addIncludedOnlyMesh(panel);
        }
      }
      
      // Position and scale the panel
      panel.position.x = centerX;
      panel.position.y = FENCE_HEIGHT / 2;
      panel.position.z = centerZ;
      panel.scaling.x = length;
      panel.scaling.y = FENCE_HEIGHT;
      panel.rotation.x = 0;
      panel.rotation.y = angle;
      panel.isVisible = true;
    }
    
    // Hide any extra panels
    for (let i = numSegments; i < lassoFencePanels.length; i++) {
      if (lassoFencePanels[i]) lassoFencePanels[i].isVisible = false;
    }
  }
  
  // Clean up lasso fence panels
  function disposeLassoFencePanels() {
    lassoFencePanels.forEach(panel => {
      if (panel && !panel.isDisposed()) {
        if (window.gfx?.glowLayer) {
          window.gfx.glowLayer.removeIncludedOnlyMesh?.(panel);
        }
        panel.dispose();
      }
    });
    lassoFencePanels = [];
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
    
    const FENCE_HEIGHT = 1.25; // Height of the selection fence

    // All planes are VERTICAL fences
    // scaling.x = length along ground, scaling.y = fence height
    // rotation.y = atan2 of edge direction + PI/2 to align plane WIDTH with edge
    
    // Top edge - vertical fence along top of selection
    topPlane.position.x = (worldCorners.topLeft.x + worldCorners.topRight.x) / 2;
    topPlane.position.z = (worldCorners.topLeft.z + worldCorners.topRight.z) / 2;
    topPlane.position.y = FENCE_HEIGHT / 2;
    topPlane.scaling.x = Math.max(topLength, 0.1);
    topPlane.scaling.y = FENCE_HEIGHT;
    topPlane.rotation.x = 0;
    topPlane.rotation.y = Math.atan2(
      worldCorners.topRight.x - worldCorners.topLeft.x,
      worldCorners.topRight.z - worldCorners.topLeft.z
    ) + Math.PI / 2; // +90° to align width with edge
    topPlane.isVisible = true;
    
    // Bottom edge - vertical fence along bottom of selection
    bottomPlane.position.x = (worldCorners.bottomLeft.x + worldCorners.bottomRight.x) / 2;
    bottomPlane.position.z = (worldCorners.bottomLeft.z + worldCorners.bottomRight.z) / 2;
    bottomPlane.position.y = FENCE_HEIGHT / 2;
    bottomPlane.scaling.x = Math.max(bottomLength, 0.1);
    bottomPlane.scaling.y = FENCE_HEIGHT;
    bottomPlane.rotation.x = 0;
    bottomPlane.rotation.y = Math.atan2(
      worldCorners.bottomRight.x - worldCorners.bottomLeft.x,
      worldCorners.bottomRight.z - worldCorners.bottomLeft.z
    ) + Math.PI / 2; // +90° to align width with edge
    bottomPlane.isVisible = true;

    // Right edge - vertical fence along right of selection
    rightPlane.position.x = (worldCorners.topRight.x + worldCorners.bottomRight.x) / 2;
    rightPlane.position.z = (worldCorners.topRight.z + worldCorners.bottomRight.z) / 2;
    rightPlane.position.y = FENCE_HEIGHT / 2;
    rightPlane.scaling.x = Math.max(rightLength, 0.1);
    rightPlane.scaling.y = FENCE_HEIGHT;
    rightPlane.rotation.x = 0;
    rightPlane.rotation.y = Math.atan2(
      worldCorners.bottomRight.x - worldCorners.topRight.x,
      worldCorners.bottomRight.z - worldCorners.topRight.z
    ) + Math.PI / 2; // +90° to align width with edge
    rightPlane.isVisible = true;
    
    // Left edge - vertical fence along left of selection
    leftPlane.position.x = (worldCorners.topLeft.x + worldCorners.bottomLeft.x) / 2;
    leftPlane.position.z = (worldCorners.topLeft.z + worldCorners.bottomLeft.z) / 2;
    leftPlane.position.y = FENCE_HEIGHT / 2;
    leftPlane.scaling.x = Math.max(leftLength, 0.1);
    leftPlane.scaling.y = FENCE_HEIGHT;
    leftPlane.rotation.x = 0;
    leftPlane.rotation.y = Math.atan2(
      worldCorners.bottomLeft.x - worldCorners.topLeft.x,
      worldCorners.bottomLeft.z - worldCorners.topLeft.z
    ) + Math.PI / 2; // +90° to align width with edge
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
  
  // Handle single click on unit or building
  function handleSingleClick(x, y) {
    // console.log(`🎯 handleSingleClick called at (${x}, ${y})`);
    
    if (!window.player) {
      console.log(`🎯 handleSingleClick: no window.player`);
      return false;
    }
    
    const hasSelectedUnits = window.player.selectedUnits && window.player.selectedUnits.length > 0;
    
    // Check for unit first (units are smaller and should take priority)
    const unit = findUnitAtPosition(x, y);
    if (unit) {
      window.player.clearSelection();
      window.player.selectUnit(unit);
      console.log(`🎯 Lasso: Clicked unit ${unit.name || unit.type}, selected`);
      
      // Show speech bubble when unit is selected
      const ownerMatches = unit.owner === window.player.id || 
                          window.player.id?.endsWith(unit.owner) ||
                          unit.owner?.endsWith(window.player.id);
      if (window.UnitSpeech && ownerMatches) {
        window.UnitSpeech.showRandomSpeech(unit, 'select', 2000);
      }
      
      return true; // Suppress move command - we clicked on a unit
    }
    
    // Check for building if no unit was clicked
    const building = findBuildingAtPosition(x, y);
    if (building) {
      // If we have units selected, treat building as a move target (don't select it)
      if (hasSelectedUnits) {
        console.log(`🏗️ Lasso: Clicked building ${building.type} with units selected, allowing move command`);
        return false; // Allow move command to building
      } else {
        // No units selected - select the building
        window.player.clearSelection();
        if (window.player.selectBuilding) {
          window.player.selectBuilding(building);
          console.log(`🏗️ Lasso: Clicked building ${building.type}, selected`);
          return true; // Suppress move command - we're selecting the building
        }
        return false;
      }
    }
    
    // Clicked on empty terrain - DON'T clear selection, allow move command
    // console.log(`🎯 Lasso: Clicked empty terrain, allowing move command`);
    return false; // Allow move command to terrain
  }
  
  // Handle double click - select all units of same type
  function handleDoubleClick(x, y) {
    if (!window.player) return;
    
    // Find unit at click position
    const unit = findUnitAtPosition(x, y);
    if (unit) {
      window.player.selectAllUnitsOfType(unit.type);
      
      // Show speech for one of the selected units
      const ownerMatches = unit.owner === window.player.id || 
                          window.player.id?.endsWith(unit.owner) ||
                          unit.owner?.endsWith(window.player.id);
      if (window.UnitSpeech && ownerMatches) {
        window.UnitSpeech.showRandomSpeech(unit, 'select', 2000);
      }
    }
  }
  
  // Find unit at screen position
  function findUnitAtPosition(screenX, screenY) {
    if (!window.gfx || !window.gfx.scene) {
      return null;
    }
    
    // Get all units in the game (player + opponents)
    const allUnits = window.gameUnits || (window.player?.units || []);
    
    if (allUnits.length === 0) {
      return null;
    }
    
    // Pick with a predicate that ignores terrain/buildings
    const pickResult = window.gfx.scene.pick(screenX, screenY, (mesh) => {
      // Ignore terrain meshes
      if (mesh.name && (mesh.name.includes('terrain') || mesh.name.includes('Mesh') || mesh.name.includes('ground'))) {
        return false;
      }
      // Ignore building meshes
      if (mesh.isBuilding) {
        return false;
      }
      // Only pick pickable meshes
      return mesh.isPickable;
    });
    
    if (!pickResult.hit || !pickResult.pickedMesh) {
      return null;
    }
    
    // Check if the picked mesh belongs to ANY unit (including enemies)
    let pickedUnit = null;
    
    // Walk up the mesh hierarchy to find the root
    let currentMesh = pickResult.pickedMesh;
    while (currentMesh) {
      // Check if this mesh is a unit's root mesh
      for (const unit of allUnits) {
        if (unit.mesh === currentMesh) {
          pickedUnit = unit;
          break;
        }
      }
      if (pickedUnit) break;
      currentMesh = currentMesh.parent;
    }
    
    // console.log(`🎯 Unit pick: mesh="${pickResult.pickedMesh.name}", found: ${pickedUnit?.type || 'none'}, owner: ${pickedUnit?.owner || 'none'}`);
    
    return pickedUnit;
  }
  
  // Find building at screen position
  function findBuildingAtPosition(screenX, screenY) {
    if (!window.gfx || !window.gfx.scene) {
      console.log('🎯 findBuildingAtPosition: missing gfx/scene');
      return null;
    }
    
    // Get buildings from either forge mode or game mode
    const buildings = window.buildingSystem?.buildings || window.gameBuildings;
    
    if (!buildings || buildings.length === 0) {
      console.log('🎯 findBuildingAtPosition: no buildings found');
      return null;
    }
    
    // console.log(`🎯 findBuildingAtPosition: checking ${buildings.length} buildings`);
    
    // Pick with a predicate that ignores terrain
    const pickResult = window.gfx.scene.pick(screenX, screenY, (mesh) => {
      // Ignore terrain meshes
      if (mesh.name && (mesh.name.includes('terrain') || mesh.name.includes('Mesh') || mesh.name.includes('ground'))) {
        return false;
      }
      // Pick building meshes (they're marked with isBuilding = true)
      if (mesh.isBuilding) {
        // console.log(`🎯 Found building mesh: ${mesh.name}, pickable: ${mesh.isPickable}`);
        return mesh.isPickable;
      }
      return false;
    });
    
    // console.log(`🎯 Building pick result: hit=${pickResult.hit}, mesh=${pickResult.pickedMesh?.name}`);
    
    if (!pickResult.hit || !pickResult.pickedMesh) {
      return null;
    }
    
    // Find which building this mesh belongs to
    let pickedBuilding = null;
    let currentMesh = pickResult.pickedMesh;
    
    while (currentMesh) {
      for (const building of buildings) {
        if (building.mesh === currentMesh) {
          pickedBuilding = building;
          console.log(`🎯 Matched to building: ${building.type}`);
          break;
        }
      }
      if (pickedBuilding) break;
      currentMesh = currentMesh.parent;
    }
    
    console.log(`🎯 Building pick final: ${pickedBuilding?.type || 'none'}`);
    
    return pickedBuilding;
  }
  
  // Clean up selection state
  function cleanupSelection() {
    isSelecting = false;
    isPotentialDrag = false;
    isDragActive = false;
    lastLassoDownTime = 0; // Reset timing
    
    // Hide radial menu when drag ends
    if (window.hud && window.hud.hideRadialMenu) {
      window.hud.hideRadialMenu();
    }
    
    // Clear lasso path
    lassoPath = [];
    lassoWorldPath = [];
    lastLassoPoint = null;
    
    // Dispose 3D lasso fence panels
    disposeLassoFencePanels();
    
    // Dispose old ribbon mesh if exists
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

    // Reset RMB drag tracking to avoid sticky right-click state after lasso
    rmbDownDuringDrag = false;
    rmbPositionDuringDrag = { x: 0, y: 0 };
    
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
  
  // Cancel/cleanup current selection (public method)
  lasso.cleanupSelection = function() {
    cleanupSelection();
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
    // Dispose 3D lasso fence panels
    disposeLassoFencePanels();
    
    // Dispose old ribbon mesh if exists
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


