// HUD System - Radial Menu and UI Elements
(function(hud) {
  
  // Radial menu state
  let radialMenu = null;
  
  // Minimap system state
  let minimapIndicators = [];
  let minimapContainer = null;
  let radialMenuVisible = false;
  let radialMenuItems = [];
  let currentMenuLevel = 'main'; // Track which menu level we're in
  let menuStack = []; // Stack to track menu navigation
  let menuCameraOffset = null; // Relative position offset from camera
  let menuCameraLocalPos = null; // Position in camera's local coordinate system
  let beforeRenderObserver = null; // Scene observer for camera updates
  let currentAnchor = null; // Track which anchor the menu is currently at
  
  // Menu definitions with sub-categories
  let menuDefinitions = {
    main: [],
    build: [
      { text: "Barracks", icon: "🏛️", callback: () => console.log("Build Barracks!"), color: new BABYLON.Color3(0.4, 0.8, 0.4) },
      { text: "Factory", icon: "🏭", callback: () => console.log("Build Factory!"), color: new BABYLON.Color3(0.6, 0.6, 0.6) },
      { text: "Tower", icon: "🗼", callback: () => console.log("Build Tower!"), color: new BABYLON.Color3(0.8, 0.6, 0.4) },
      { text: "Wall", icon: "🧱", callback: () => console.log("Build Wall!"), color: new BABYLON.Color3(0.5, 0.5, 0.5) }
    ],
    attack: [
      { text: "Strike", icon: "⚡", callback: () => console.log("Lightning Strike!"), color: new BABYLON.Color3(1, 1, 0) },
      { text: "Charge", icon: "🐎", callback: () => console.log("Cavalry Charge!"), color: new BABYLON.Color3(0.8, 0.4, 0.2) },
      { text: "Siege", icon: "🏹", callback: () => console.log("Siege Attack!"), color: new BABYLON.Color3(0.6, 0.3, 0.1) },
      { text: "Bombard", icon: "💣", callback: () => console.log("Bombardment!"), color: new BABYLON.Color3(0.9, 0.1, 0.1) }
    ],
    move: [
      { text: "March", icon: "🚶", callback: () => console.log("March Formation!"), color: new BABYLON.Color3(0.2, 0.6, 1) },
      { text: "Patrol", icon: "👁️", callback: () => console.log("Patrol Route!"), color: new BABYLON.Color3(0.4, 0.4, 1) },
      { text: "Retreat", icon: "🏃", callback: () => console.log("Tactical Retreat!"), color: new BABYLON.Color3(0.6, 0.2, 0.8) },
      { text: "Flank", icon: "↗️", callback: () => console.log("Flanking Maneuver!"), color: new BABYLON.Color3(0.8, 0.2, 0.6) }
    ],
    info: [
      { text: "Stats", icon: "📊", callback: () => console.log("Unit Stats!"), color: new BABYLON.Color3(1, 0.8, 0.2) },
      { text: "Health", icon: "❤️", callback: () => console.log("Health Status!"), color: new BABYLON.Color3(1, 0.2, 0.2) },
      { text: "Upgrade", icon: "⬆️", callback: () => {/* Unit upgrade logic */}, color: new BABYLON.Color3(0.2, 1, 0.8) },
      { text: "History", icon: "📜", callback: () => console.log("Battle History!"), color: new BABYLON.Color3(0.6, 0.4, 0.2) }
    ],
    magic: [
      { text: "Fireball", icon: "🔥", callback: () => fx.createExplosion(new BABYLON.Vector3(0, 0, 0)), color: new BABYLON.Color3(1, 0.4, 0) },
      { text: "Heal", icon: "✨", callback: () => console.log("Healing Magic!"), color: new BABYLON.Color3(0.2, 1, 0.2) },
      { text: "Shield", icon: "🛡️", callback: () => console.log("Protection Spell!"), color: new BABYLON.Color3(0.6, 0.6, 1) },
      { text: "Teleport", icon: "🌀", callback: () => console.log("Teleportation!"), color: new BABYLON.Color3(0.8, 0.2, 0.8) }
    ]
  };
  
  // Radial menu configuration
  let menuConfig = {
    distance: 3,        // Distance from camera (world units)
    scale: 0.6,         // Overall scale multiplier - smaller menu
    screenOffsetX: 0,   // Screen offset (-1 to 1, where 0 = center)
    screenOffsetY: -0.6, // Screen offset (-1 to 1, where 0 = center) - negative = bottom
    itemRadius: 1.5,    // How far items spread from center
    centerSize: 0.3,    // Size of center sphere
    itemSize: 0.25      // Size of menu item cubes - made smaller
  };
  
  // Initialize HUD system
  hud.init = function(scene, camera, canvas) {
    console.log('HUD system initialized');
    hud.scene = scene;
    hud.camera = camera;
    hud.canvas = canvas;
    
    // Create radial menu container
    createRadialMenu();
    
    // Initialize minimap system
    initMinimap();
    
    // Set up middle mouse button handling
    setupMiddleMouseControl();
  };
  
  // Configure radial menu appearance and positioning
  hud.configureRadialMenu = function(config) {
    // Update configuration with provided values
    Object.assign(menuConfig, config);
    
    // Update existing menu if it exists
    if (radialMenu) {
      radialMenu.scaling.setAll(menuConfig.scale);
      
      // Update center sphere size if it exists
      if (hud.centerMesh) {
        const newSize = menuConfig.centerSize / 0.3; // Original was 0.3
        hud.centerMesh.scaling.setAll(newSize);
      }
      
      // Update menu item sizes
      radialMenuItems.forEach(item => {
        if (item.mesh) {
          const newSize = menuConfig.itemSize / 0.4; // Original was 0.4
          item.mesh.scaling.setAll(newSize);
        }
      });
    }
    
    console.log('Radial menu configured:', menuConfig);
  };
  
  // Set up middle mouse button and spacebar control for radial menu
  function setupMiddleMouseControl() {
    if (!hud.canvas) return;
    
    hud.canvas.addEventListener('pointerdown', function(e) {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        
        const rect = hud.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (radialMenuVisible) {
          // Menu is already open - determine which anchor this click would select
          const anchors = {
            top: { x: rect.width / 2, y: rect.height * 0.1 },
            bottom: { x: rect.width / 2, y: rect.height * 0.9 },
            left: { x: rect.width * 0.1, y: rect.height / 2 },
            right: { x: rect.width * 0.9, y: rect.height / 2 }
          };
          
          let minDist = Infinity;
          let closestAnchor = 'bottom';
          
          for (const [name, pos] of Object.entries(anchors)) {
            const dist = Math.sqrt((x - pos.x)**2 + (y - pos.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestAnchor = name;
            }
          }
          
          if (closestAnchor === currentAnchor) {
            // Same anchor - close menu
            hud.hideRadialMenu();
          } else {
            // Different anchor - move menu
            hud.showRadialMenu(x, y);
          }
        } else {
          // Menu not open - show it
          hud.showRadialMenu(x, y);
        }
      }
    });
    
    // Don't auto-close menu on left/right clicks anymore
    // Menu items handle their own clicks via 3D mesh picking
    // Only middle-click and spacebar control the menu now
    
    // Add spacebar support
    document.addEventListener('keydown', function(e) {
      if (e.code === 'Space') {
        e.preventDefault();
        
        if (radialMenuVisible) {
          hud.hideRadialMenu();
        } else {
          // Show with configured screen offset when using spacebar
          const rect = hud.canvas.getBoundingClientRect();
          const centerX = rect.width / 2 + (menuConfig.screenOffsetX * rect.width / 2);
          const centerY = rect.height / 2 - (menuConfig.screenOffsetY * rect.height / 2); // Flipped: negative Y = bottom
          hud.showRadialMenu(centerX, centerY);
        }
      }
    });
    
    console.log('Middle mouse button and spacebar control set up for radial menu');
  }
  
  // Create the radial menu with 3D meshes
  function createRadialMenu() {
    if (!hud.scene) return;
    
    // Create parent node for the entire radial menu
    radialMenu = new BABYLON.TransformNode("radialMenuRoot", hud.scene);
    radialMenu.setEnabled(false); // Start hidden
    
    // Make the entire menu billboard mode
    radialMenu.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    
    // Create center mesh - a glowing sphere
    const centerMesh = BABYLON.MeshBuilder.CreateSphere("radialCenter", {diameter: 0.3}, hud.scene);
    const centerMaterial = new BABYLON.StandardMaterial("centerMat", hud.scene);
    centerMaterial.emissiveColor = new BABYLON.Color3(0.2, 0.8, 1); // Cyan glow
    centerMaterial.disableLighting = true;
    centerMesh.material = centerMaterial;
    centerMesh.parent = radialMenu;
    
    // Render on top of terrain
    centerMesh.renderingGroupId = 1;
    
    // Store center mesh reference
    hud.centerMesh = centerMesh;
    
    console.log('3D Radial menu created with billboard mode');
  }
  
  // Show radial menu at specific anchor point
  hud.showRadialMenu = function(screenX, screenY, forceAnchor = null) {
    if (!radialMenu || !hud.camera) return;
    
    const rect = hud.canvas.getBoundingClientRect();
    
    // Define the 4 anchor points closer to screen edges
    const anchors = {
      top: { x: rect.width / 2, y: rect.height * 0.1 },
      bottom: { x: rect.width / 2, y: rect.height * 0.9 },
      left: { x: rect.width * 0.1, y: rect.height / 2 },
      right: { x: rect.width * 0.9, y: rect.height / 2 }
    };
    
    // Determine which anchor to use
    let selectedAnchor;
    let closestAnchor = 'bottom'; // Always default to bottom
    
    if (forceAnchor) {
      selectedAnchor = anchors[forceAnchor];
      currentAnchor = forceAnchor;
    } else {
      // Find closest anchor to click position
      let minDist = Infinity;
      
      for (const [name, pos] of Object.entries(anchors)) {
        const dist = Math.sqrt((screenX - pos.x)**2 + (screenY - pos.y)**2);
        if (dist < minDist) {
          minDist = dist;
          closestAnchor = name;
        }
      }
      
      // Ensure we always have a valid anchor
      selectedAnchor = anchors[closestAnchor] || anchors['bottom'];
      currentAnchor = closestAnchor || 'bottom'; // Track which anchor we're using
    }
    
    // Convert anchor screen coordinates to world position (original working logic)
    const ray = hud.scene.createPickingRay(selectedAnchor.x, selectedAnchor.y, BABYLON.Matrix.Identity(), hud.camera);
    const menuPosition = ray.origin.add(ray.direction.scale(menuConfig.distance));
    
    // Position the radial menu in world space
    radialMenu.position.copyFrom(menuPosition);
    radialMenu.parent = null; // Clear any existing parent
    
    // Capture position in camera's local coordinate system for rotation-stable tracking
    const cameraForward = hud.camera.getForwardRay().direction.normalize();
    const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
    const cameraUp = BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize();
    
    // Convert world position to camera-local coordinates
    const offsetFromCamera = menuPosition.subtract(hud.camera.position);
    menuCameraLocalPos = {
      forward: BABYLON.Vector3.Dot(offsetFromCamera, cameraForward),
      right: BABYLON.Vector3.Dot(offsetFromCamera, cameraRight),
      up: BABYLON.Vector3.Dot(offsetFromCamera, cameraUp)
    };
    
    // Always register fresh beforeRender observer for perfect camera sync
    if (beforeRenderObserver) {
      hud.scene.onBeforeRenderObservable.remove(beforeRenderObserver);
    }
    beforeRenderObserver = hud.scene.onBeforeRenderObservable.add(() => {
      if (radialMenuVisible && radialMenu && menuCameraLocalPos && hud.camera) {
        // Use camera position directly for radial menu - position and orientation must match
        const cameraForward = hud.camera.getForwardRay().direction.normalize();
        const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
        const cameraUp = BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize();
        
        const newPosition = hud.camera.position
          .add(cameraForward.scale(menuCameraLocalPos.forward))
          .add(cameraRight.scale(menuCameraLocalPos.right))
          .add(cameraUp.scale(menuCameraLocalPos.up));
          
        radialMenu.position.copyFrom(newPosition);
      }
    });
    
    radialMenu.scaling.setAll(menuConfig.scale);
    radialMenu.setEnabled(true);
    radialMenuVisible = true;
    
    // Animate menu items based on original click position for spreading logic
    animateMenuItems(screenX, screenY);
    
    // Radial menu positioned and shown
  };
  
  // Hide radial menu
  hud.hideRadialMenu = function() {
    if (!radialMenu) return;
    
    radialMenu.setEnabled(false);
    radialMenuVisible = false;
    currentAnchor = null; // Clear current anchor
    
    // Clean up camera tracking observer
    if (beforeRenderObserver) {
      hud.scene.onBeforeRenderObservable.remove(beforeRenderObserver);
      beforeRenderObserver = null;
    }
    
    // Radial menu hidden and cleaned up
  };
  
  // Animate menu items spreading out from center
  function animateMenuItems(screenX, screenY) {
    const rect = hud.canvas.getBoundingClientRect();
    
    // Use the anchor that was already determined to set spread direction
    let anchorAngle = null;
    
    // Convert current anchor to spread direction (items spread AWAY from edges)
    if (currentAnchor === 'top') {
      anchorAngle = 3*Math.PI/2; // 270° = down (away from top)
    } else if (currentAnchor === 'bottom') {
      anchorAngle = Math.PI/2; // 90° = up (away from bottom)
    } else if (currentAnchor === 'left') {
      anchorAngle = 0; // 0° = right (away from left)
    } else if (currentAnchor === 'right') {
      anchorAngle = Math.PI; // 180° = left (away from right)
    } else {
      // Fallback to bottom behavior if somehow no anchor is set
      anchorAngle = Math.PI/2; // 90° = up
    }
    
    // If anchored, use a smaller arc centered on the anchor direction
    let availableStart = 0;
    let availableEnd = 2 * Math.PI;
    let availableArc = 2 * Math.PI;
    
    if (anchorAngle !== null) {
      const halfSpread = Math.PI/2.2; // ~82° each side = ~164° total arc (bigger spread)
      availableStart = anchorAngle - halfSpread;
      availableEnd = anchorAngle + halfSpread;
      availableArc = halfSpread * 2; // ~164° total arc
    }
    
    radialMenuItems.forEach((item, index) => {
      if (!item.mesh) return;
      
      // Distribute items only within the available arc
      // Use smaller radius when in center, larger when near edges for better visibility
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const distanceFromCenter = Math.sqrt((screenX - centerX)**2 + (screenY - centerY)**2);
      const maxDistance = Math.sqrt((rect.width/2)**2 + (rect.height/2)**2);
      const distanceFactor = distanceFromCenter / maxDistance; // 0 = center, 1 = corner
      
      const radius = 0.8 + (distanceFactor * 0.6); // 0.8 in center, 1.4 near edges (smaller overall)
      const angleStep = availableArc / radialMenuItems.length;
      const angle = availableStart + (index * angleStep) + (angleStep / 2); // Center items in their segments
      
      // Standard circle math: 0° = right, 90° = up, etc.
      const targetX = Math.cos(angle) * radius;
      const targetY = Math.sin(angle) * radius; 
      const targetZ = 0; // Keep items in the menu's local plane
      
      // Start at final position but tiny scale
      item.mesh.position.set(targetX, targetY, targetZ);
      item.mesh.scaling.setAll(0.01); // Start very small
      
      // Animate scale growing out with bounce
      const scaleAnimation = new BABYLON.Animation(
        `menuGrow${index}`,
        "scaling",
        60, // 60 fps
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      // Create scale keyframes with staggered timing
      const startFrame = index * 2; // Stagger each item by 2 frames
      const endFrame = startFrame + 12; // Grow over 12 frames
      
      const scaleKeys = [
        { frame: startFrame, value: new BABYLON.Vector3(0.01, 0.01, 0.01) },
        { frame: endFrame, value: new BABYLON.Vector3(1, 1, 1) }
      ];
      scaleAnimation.setKeys(scaleKeys);
      
      // Add satisfying bounce-out easing
      const easingFunction = new BABYLON.BounceEase();
      easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
      scaleAnimation.setEasingFunction(easingFunction);
      
      // Apply animation to mesh and start it
      item.mesh.animations = [scaleAnimation];
      hud.scene.beginAnimation(item.mesh, 0, endFrame + 2, false);
    });
  }
  
  // Toggle radial menu visibility
  hud.toggleRadialMenu = function(screenX, screenY) {
    if (radialMenuVisible) {
      hud.hideRadialMenu();
    } else {
      hud.showRadialMenu(screenX, screenY);
    }
  };
  
  // Navigate to a sub-menu
  hud.showSubMenu = function(menuLevel, screenX, screenY) {
    if (!menuDefinitions[menuLevel]) {
      console.warn('Menu level not found:', menuLevel);
      return;
    }
    
    // Save current position in navigation stack
    menuStack.push({level: currentMenuLevel, items: [...radialMenuItems]});
    
    // Switch to new menu level
    currentMenuLevel = menuLevel;
    
    // Clear current items and load new ones
    clearMenuItems();
    loadMenuLevel(menuLevel);
    
    // Show the menu at the same position
    if (radialMenuVisible) {
      animateMenuItems(screenX, screenY);
    }
    
    console.log('Switched to sub-menu:', menuLevel);
  };
  
  // Go back to previous menu level
  hud.goBackMenu = function(screenX, screenY) {
    if (menuStack.length === 0) {
      hud.hideRadialMenu();
      return;
    }
    
    // Restore previous menu level
    const previous = menuStack.pop();
    currentMenuLevel = previous.level;
    
    // Clear current items and restore previous ones
    clearMenuItems();
    radialMenuItems = previous.items;
    
    // Re-create meshes for restored items
    radialMenuItems.forEach(item => {
      if (!item.mesh) {
        createMenuItemMesh(item);
      }
    });
    
    // Re-animate the menu
    if (radialMenuVisible) {
      animateMenuItems(screenX, screenY);
    }
    
    console.log('Returned to menu level:', currentMenuLevel);
  };
  
  // Clear all menu item meshes
  function clearMenuItems() {
    radialMenuItems.forEach(item => {
      if (item.mesh) {
        item.mesh.dispose();
      }
    });
    radialMenuItems = [];
  }
  
  // Load menu items for a specific level
  function loadMenuLevel(level) {
    const items = menuDefinitions[level] || [];
    
    // Add back button for sub-menus
    if (level !== 'main') {
      hud.addRadialMenuItem("Back", "↩️", () => hud.goBackMenu(), new BABYLON.Color3(0.5, 0.5, 0.5));
    }
    
    // Add all items for this level
    items.forEach(itemDef => {
      hud.addRadialMenuItem(itemDef.text, itemDef.icon, itemDef.callback, itemDef.color);
    });
  }
  
  // Add item to radial menu
  hud.addRadialMenuItem = function(text, icon, callback, color) {
    const item = {
      text: text,
      icon: icon,
      callback: callback,
      color: color || new BABYLON.Color3(0.8, 0.4, 0.1), // Default orange
      angle: radialMenuItems.length * (360 / 8), // Distribute up to 8 items around circle
      mesh: null
    };
    
    radialMenuItems.push(item);
    
    // Create 3D mesh for this item
    createMenuItemMesh(item);
  };
  
  // Create 3D mesh for a menu item
  function createMenuItemMesh(item) {
    if (!hud.scene || !radialMenu) return;
    
    // Create a simple box for the menu item
    const mesh = BABYLON.MeshBuilder.CreateBox(`menuItem_${item.text}`, {size: 0.4}, hud.scene);
    
    // Create material with the item's color
    const material = new BABYLON.StandardMaterial(`menuMat_${item.text}`, hud.scene);
    material.emissiveColor = item.color;
    material.disableLighting = true;
    mesh.material = material;
    
    // Parent to radial menu
    mesh.parent = radialMenu;
    
    // Render on top of terrain
    mesh.renderingGroupId = 1;
    
    // Make it clickable
    mesh.isPickable = true;
    mesh.actionManager = new BABYLON.ActionManager(hud.scene);
    mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPickTrigger,
      () => {
        if (item.callback) {
          item.callback();
        }
        hud.hideRadialMenu();
      }
    ));
    
    // Store mesh reference
    item.mesh = mesh;
    
    // Start at center position (will animate out when shown)
    mesh.position.set(0, 0, 0);
  }
  
  // Check if point is inside radial menu
  hud.isPointInRadialMenu = function(screenX, screenY) {
    if (!radialMenuVisible || !radialMenu) return false;
    
    const centerX = radialMenu.leftInPixels + 100;
    const centerY = radialMenu.topInPixels + 100;
    const distance = Math.sqrt((screenX - centerX) ** 2 + (screenY - centerY) ** 2);
    
    return distance <= 100; // Within menu radius
  };
  
  // Default menu items
  hud.setupDefaultRadialMenu = function() {
    hud.addRadialMenuItem("Build", "🏗️", () => console.log("Build selected"));
    hud.addRadialMenuItem("Attack", "⚔️", () => console.log("Attack selected"));
    hud.addRadialMenuItem("Move", "👣", () => console.log("Move selected"));
    hud.addRadialMenuItem("Info", "ℹ️", () => console.log("Info selected"));
  };
  
  // Initialize the minimap edge indicator system
  function initMinimap() {
    console.log("🗺️ Initializing minimap system...");
    
    // Create 3D container for minimap indicators (like radial menu)
    minimapContainer = new BABYLON.TransformNode("MinimapContainer", hud.scene);
    
    // Minimap will be updated from main render loop after camera lerp
    console.log("✅ Minimap will update after camera positioning");
    
    console.log("✅ Minimap system ready");
  }
  
  // Update minimap indicators by moving existing spheres
  function updateMinimap() {
    if (!hud.camera || !window.player || !window.player.units) return;
    
    let indicatorIndex = 0;
    
    // Process each player unit
    window.player.units.forEach((unit, index) => {
      if (!unit.mesh || !unit.pb.state.loc) return;
      
      const unitWorldPos = new BABYLON.Vector3(
        unit.pb.state.loc.x,
        unit.pb.state.loc.y,
        unit.pb.state.loc.z
      );
      
      // Check if unit is visible in camera frustum
      if (!isUnitInFrustum(unitWorldPos)) {
        // Unit is outside view, update or create edge indicator
        updateEdgeIndicator(unit, indicatorIndex, unitWorldPos);
        indicatorIndex++;
      }
    });
    
    // Hide any extra indicators we're not using
    for (let i = indicatorIndex; i < minimapIndicators.length; i++) {
      minimapIndicators[i].setEnabled(false);
    }
  }
  
  // Check if unit is visible in camera frustum
  function isUnitInFrustum(unitWorldPos) {
    // Project world position to screen space
    const screenPos = BABYLON.Vector3.Project(
      unitWorldPos,
      BABYLON.Matrix.Identity(),
      hud.scene.getTransformMatrix(),
      hud.camera.viewport
    );
    
    // Check if it's within screen bounds (0-1 range with small margin)
    const margin = 0.05;
    return screenPos.x >= -margin && screenPos.x <= 1 + margin &&
           screenPos.y >= -margin && screenPos.y <= 1 + margin &&
           screenPos.z >= 0 && screenPos.z <= 1;
  }
  
  // Update or create a screen edge indicator for off-screen units
  function updateEdgeIndicator(unit, index, unitWorldPos) {
    const rect = hud.canvas.getBoundingClientRect();
    
    // Use cameraTarget position if available for instant tracking, otherwise use camera position
    const currentCameraPos = window.gfx && window.gfx.cameraTarget 
      ? window.gfx.cameraTarget.position 
      : hud.camera.position;
    const toUnit = unitWorldPos.subtract(currentCameraPos).normalize();
    const cameraForward = hud.camera.getForwardRay().direction.normalize();
    const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
    const cameraUp = BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize();
    
    // Project unit direction onto current camera plane
    const rightDot = -BABYLON.Vector3.Dot(toUnit, cameraRight); // Flip to correct left/right
    const upDot = BABYLON.Vector3.Dot(toUnit, cameraUp);
    
    // Fixed buffer distance from screen edges (like anchor system)
    let edgePos;
    const buffer = 30; // Fixed pixel distance from screen edge
    
    // Clamp the dot values to determine direction
    const clampedRightDot = Math.max(-1, Math.min(1, rightDot));
    const clampedUpDot = Math.max(-1, Math.min(1, upDot));
    
    if (Math.abs(clampedRightDot) > Math.abs(clampedUpDot)) {
      // RAIL: Left or right edge with fixed buffer
      if (clampedRightDot > 0) {
        // RIGHT RAIL - fixed distance from right edge
        edgePos = {
          x: rect.width - buffer, // Fixed buffer from right edge
          y: Math.max(buffer, Math.min(rect.height - buffer, 
              rect.height * (0.5 + clampedUpDot * 0.4))) // Centered with movement range
        };
      } else {
        // LEFT RAIL - fixed distance from left edge
        edgePos = {
          x: buffer, // Fixed buffer from left edge
          y: Math.max(buffer, Math.min(rect.height - buffer, 
              rect.height * (0.5 + clampedUpDot * 0.4))) // Centered with movement range
        };
      }
    } else {
      // RAIL: Top or bottom edge with fixed buffer
      if (clampedUpDot > 0) {
        // TOP RAIL - fixed distance from top edge
        edgePos = {
          x: Math.max(buffer, Math.min(rect.width - buffer, 
              rect.width * (0.5 + clampedRightDot * 0.4))), // Centered with movement range
          y: buffer // Fixed buffer from top edge
        };
      } else {
        // BOTTOM RAIL - fixed distance from bottom edge
        edgePos = {
          x: Math.max(buffer, Math.min(rect.width - buffer, 
              rect.width * (0.5 + clampedRightDot * 0.4))), // Centered with movement range
          y: rect.height - buffer // Fixed buffer from bottom edge
        };
      }
    }
    
    // Use same screen-to-world positioning as radial menu for consistent results
    const ray = hud.scene.createPickingRay(edgePos.x, edgePos.y, BABYLON.Matrix.Identity(), hud.camera);
    const worldPos = ray.origin.add(ray.direction.scale(menuConfig.distance)); // Same distance as radial menu
    
    // Check if this unit is selected
    const isSelected = window.ai && window.ai.getCurrentSelection && 
                      window.ai.getCurrentSelection().includes(unit);
    
    // Reuse existing indicator or create new one
    let indicator;
    if (index < minimapIndicators.length) {
      // Reuse existing sphere
      indicator = minimapIndicators[index];
      indicator.setEnabled(true);
    } else {
      // Create new sphere
      indicator = BABYLON.MeshBuilder.CreateSphere(`minimap_${index}`, {diameter: 0.15}, hud.scene);
      
      // Create material that will be updated below
      const material = new BABYLON.StandardMaterial(`minimap_mat_${index}`, hud.scene);
      material.disableLighting = true; // Make them glow like the center sphere
      indicator.material = material;
      
      minimapIndicators.push(indicator);
    }
    
    // Update colors based on selection status
    if (isSelected) {
      // Selected units: bright yellow/gold
      indicator.material.diffuseColor = new BABYLON.Color3(1, 1, 0);
      indicator.material.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
      indicator.scaling = new BABYLON.Vector3(1.5, 1.5, 1.5); // Make selected units bigger
    } else {
      // Unselected units: normal green
      indicator.material.diffuseColor = new BABYLON.Color3(0, 1, 0);
      indicator.material.emissiveColor = new BABYLON.Color3(0, 0.8, 0);
      indicator.scaling = new BABYLON.Vector3(1, 1, 1); // Normal size
    }
    
    // Set position directly for instant response - no catchup lag
    indicator.position.copyFrom(worldPos);
    
    // Store edge info for this unit
    unit.hudCoord = { edgePos, rightDot, upDot };
  }
  
  // Clear all minimap indicators
  function clearMinimapIndicators() {
    minimapIndicators.forEach(indicator => {
      indicator.dispose();
    });
    minimapIndicators = [];
  }

  // Expose minimap update function
  hud.updateMinimap = updateMinimap;
  
  // Dispose of HUD resources
  hud.dispose = function() {
    if (beforeRenderObserver) {
      hud.scene.onBeforeRenderObservable.remove(beforeRenderObserver);
      beforeRenderObserver = null;
    }
    
    // Clean up minimap
    clearMinimapIndicators();
    if (minimapContainer) {
      minimapContainer.dispose();
    }
  };
  
}(window.hud = window.hud || {}));
