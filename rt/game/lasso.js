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
  
  // State tracking
  let dragStartTime = 0;
  let isDragActive = false;
  let lastClickTime = 0;
  let lastClickPoint = { x: 0, y: 0 };
  
  // Initialize the lasso system
  lasso.init = function() {
    // console.log("🎯 Lasso selection system initialized");
    // Create selection box mesh (invisible initially)
    createSelectionBox();
  };
  
  // Create the visual selection box
  function createSelectionBox() {
    if (!window.gfx || !window.gfx.scene) return;
    
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
    } else {
      // This was a click - don't handle it here, let UI system handle it
      // console.log("🎯 Lasso: Click detected, letting UI system handle it");
    }
    
    // Clean up selection state
    cleanupSelection();
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
  
  // Update the visual selection box
  function updateSelectionBox() {
    if (!selectionBox || !Array.isArray(selectionBox) || !window.gfx || !window.gfx.camera) return;
    
    // Convert screen coordinates to world coordinates for positioning
    const startWorld = screenToWorld(startPoint.x, startPoint.y);
    const endWorld = screenToWorld(endPoint.x, endPoint.y);
    
    if (!startWorld || !endWorld) return;
    
    // Calculate box dimensions and position
    const centerX = (startWorld.x + endWorld.x) / 2;
    const centerZ = (startWorld.z + endWorld.z) / 2;
    const width = Math.abs(endWorld.x - startWorld.x);
    const height = Math.abs(endWorld.z - startWorld.z);
    
    // // console.log("🎯 3D fence selection update:", { 
    //   start: startWorld, 
    //   end: endWorld, 
    //   center: { x: centerX, z: centerZ }, 
    //   size: { width, height } 
    // });
    
    // Update each plane to form the fence around the selection area
    const [topPlane, rightPlane, bottomPlane, leftPlane] = selectionBox;
    
    // Top edge (camera-facing plane)
    topPlane.position.x = centerX;
    topPlane.position.z = centerZ - height/2;
    topPlane.scaling.x = Math.max(width, 0.1);
    topPlane.isVisible = true;
    
    // Right edge (camera-facing plane)
    rightPlane.position.x = centerX + width/2;
    rightPlane.position.z = centerZ;
    rightPlane.scaling.x = Math.max(height, 0.1);
    rightPlane.isVisible = true;
    
    // Bottom edge (camera-facing plane)
    bottomPlane.position.x = centerX;
    bottomPlane.position.z = centerZ + height/2;
    bottomPlane.scaling.x = Math.max(width, 0.1);
    bottomPlane.isVisible = true;
    
    // Left edge (camera-facing plane)
    leftPlane.position.x = centerX - width/2;
    leftPlane.position.z = centerZ;
    leftPlane.scaling.x = Math.max(height, 0.1);
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
    if (!window.player || !window.player.units) return;
    
    // Clear current selection
    window.player.clearSelection();
    
    // Get selection box bounds in world coordinates
    const startWorld = screenToWorld(startPoint.x, startPoint.y);
    const endWorld = screenToWorld(endPoint.x, endPoint.y);
    
    if (!startWorld || !endWorld) return;
    
    const minX = Math.min(startWorld.x, endWorld.x);
    const maxX = Math.max(startWorld.x, endWorld.x);
    const minZ = Math.min(startWorld.z, endWorld.z);
    const maxZ = Math.max(startWorld.z, endWorld.z);
    
    // console.log("🎯 Lasso: Selection area:", { minX, maxX, minZ, maxZ });
    
    // Find units within selection area
    let selectedCount = 0;
    window.player.units.forEach(unit => {
      if (unit.pb && unit.pb.state && unit.pb.state.loc) {
        const unitX = unit.pb.state.loc.x;
        const unitZ = unit.pb.state.loc.z;
        
        if (unitX >= minX && unitX <= maxX && unitZ >= minZ && unitZ <= maxZ) {
          window.player.selectUnit(unit);
          selectedCount++;
        }
      }
    });
    
    // console.log(`🎯 Lasso: Selected ${selectedCount} units in area`);
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
    
    // Hide all selection fence planes
    if (selectionBox && Array.isArray(selectionBox)) {
      selectionBox.forEach(plane => {
        plane.isVisible = false;
      });
    }
    
    // console.log("🎯 Lasso: Selection cleanup complete");
  }
  
  // Dispose of lasso resources
  lasso.dispose = function() {
    if (selectionBox) {
      selectionBox.dispose();
      selectionBox = null;
    }
    // console.log("🎯 Lasso: Resources disposed");
  };
  
})(window.lassoSelection = {});


