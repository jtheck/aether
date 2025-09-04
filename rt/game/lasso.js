// Lasso Selection System
// Draws a rectangle on screen and selects units within that area
// Handles: drag selection, single clicks, double clicks

(function(lasso) {
  let isSelecting = false;
  let startPoint = { x: 0, y: 0 };
  let endPoint = { x: 0, y: 0 };
  let selectionBox = null;
  let selectedUnits = [];
  
  // Configuration
  const DRAG_THRESHOLD = 5; // pixels - minimum movement to start drag
  const CLICK_TIMEOUT = 200; // ms - time to wait before treating as click
  // const USE_2D_SELECTION = true; // Set to false to use 3D fence selection
  
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
  };
  
  // Create the visual selection box
  function createSelectionBox() {
    if (USE_2D_SELECTION) {
      // Get the HTML selection box element
      selectionBox = document.getElementById('lasso-selection-box');
      if (!selectionBox) {
        console.error('Selection box element not found');
        return;
      }
      selectionBox.style.display = 'none';
      return;
    }
    
    // 3D Selection Box Code
    // Create 4 vertical planes around the edges for a fence-like selection box
    // These will face the camera so they're always visible
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
    
    // console.log("🎯 3D fence selection box created (camera-facing)");
  }
  
  // Handle left mouse button down
  lasso.handleLmbDown = function(x, y, e) {
    isSelecting = true; // Start selection mode
    startPoint = { x, y };
    endPoint = { x, y };
    dragStartTime = Date.now();
    isDragActive = false;
    
    // Reset RMB tracking for new drag operation
    rmbDownDuringDrag = false;
    rmbPositionDuringDrag = { x: 0, y: 0 };
    
    // console.log("🎯 Lasso: Mouse down at", { x, y, event: e });
    
    // Show selection box at start point
    if (selectionBox) {
      selectionBox.isVisible = true;
      updateSelectionBox();
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
    
    // Update visual selection box
    if (isDragActive && selectionBox) {
      updateSelectionBox();
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
    
    console.log("🎯 Lasso: Mouse up analysis:", { 
      distance, 
      threshold: DRAG_THRESHOLD, 
      isDragActive, 
      wasDrag: distance > DRAG_THRESHOLD && isDragActive 
    });
    
    if (distance > DRAG_THRESHOLD && isDragActive) {
      // This was a drag - perform area selection
      // console.log("🎯 Lasso: Drag completed, selecting units in area");
      performAreaSelection();
      
      // Delay cleanup to allow RMB events to detect recent lasso activity
      setTimeout(() => {
        cleanupSelection();
      }, 100); // 100ms delay
    } else {
      // This was a click - don't handle it here, let UI system handle it
      // console.log("🎯 Lasso: Click detected, letting UI system handle it");
      
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
      console.log("🎯 Lasso: RMB DOWN during drag at", { x, y });
      return true; // Claim this RMB event
    }
    return false; // Let UI system handle it
  };
  
  lasso.handleRmbUp = function(x, y, e) {
    if (rmbDownDuringDrag) {
      rmbDownDuringDrag = false;
      console.log("🎯 Lasso: RMB UP during drag at", { x, y });
      return true; // Claim this RMB event
    }
    return false; // Let UI system handle it
  };
  
  lasso.handleRmbMove = function(x, y, e) {
    if (rmbDownDuringDrag && isSelecting && isDragActive) {
      rmbPositionDuringDrag = { x, y };
      console.log("🎯 Lasso: RMB MOVE during drag at", { x, y });
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
  
  // Update the visual selection box
  function updateSelectionBox() {
    if (!selectionBox || !window.gfx) return;

    if (USE_2D_SELECTION) {
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
      return;
    }

    // 3D Selection Box Code
    if (!Array.isArray(selectionBox) || !window.gfx.camera) return;
    
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
    
    // console.warn("🎯 Screen to world failed for:", { x: screenX, y: screenY });
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
        
        // Check if screen position is within selection box
        if (screenPos.x >= minX && screenPos.x <= maxX && 
            screenPos.y >= minY && screenPos.y <= maxY) {
          window.player.selectUnit(unit);
          selectedCount++;
        }
      }
    });
    
    // console.log(`🎯 Lasso: Selected ${selectedCount} units in screen area`);
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
    
    if (USE_2D_SELECTION) {
      if (selectionBox) {
        selectionBox.style.display = 'none';
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
  
  // Dispose of lasso resources
  lasso.dispose = function() {
    if (USE_2D_SELECTION) {
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


