// HUD System - Radial Menu and UI Elements
// 
// Key Features:
// - 3D radial menu with sub-categories
// - Menu stays open after selecting options (except Back button)
// - Visual feedback on item selection
// - Comprehensive building, combat, movement, info, and magic options
// - Manual close option on main menu
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
    main: { title: "Main Menu", items: [] },
    units: { 
      title: "👥 Units", 
      items: [
        { text: "Select All", icon: "🎯", callback: () => hud.selectAllUnits(), color: new BABYLON.Color3(0.2, 0.6, 1) },
        { text: "Deselect", icon: "❌", callback: () => hud.deselectAllUnits(), color: new BABYLON.Color3(0.8, 0.2, 0.2) },
        { text: "Formation", icon: "⚔️", callback: () => hud.setUnitFormation(), color: new BABYLON.Color3(0.6, 0.4, 0.8) },
        { text: "Upgrade", icon: "⬆️", callback: () => hud.upgradeUnits(), color: new BABYLON.Color3(0.2, 0.8, 0.4) }
      ]
    },
    buildings: { 
      title: "🏗️ Buildings", 
      items: [
        { text: "Camp", icon: "⛺", callback: () => hud.startBuildingPlacement("camp"), color: new BABYLON.Color3(0.4, 0.8, 0.4) },
        { text: "Barracks", icon: "🏛️", callback: () => hud.startBuildingPlacement("barracks"), color: new BABYLON.Color3(0.6, 0.6, 0.6) },
        { text: "Tower", icon: "🗼", callback: () => hud.startBuildingPlacement("tower"), color: new BABYLON.Color3(0.8, 0.6, 0.4) },
        { text: "Wall", icon: "🧱", callback: () => hud.startBuildingPlacement("wall"), color: new BABYLON.Color3(0.5, 0.5, 0.5) }
      ]
    },
    research: { 
      title: "🔬 Research", 
      items: [
        { text: "Weapons", icon: "⚔️", callback: () => hud.researchWeapons(), color: new BABYLON.Color3(1, 0.4, 0.2) },
        { text: "Armor", icon: "🛡️", callback: () => hud.researchArmor(), color: new BABYLON.Color3(0.4, 0.6, 1) },
        { text: "Speed", icon: "⚡", callback: () => hud.researchSpeed(), color: new BABYLON.Color3(1, 1, 0.4) },
        { text: "Efficiency", icon: "⚙️", callback: () => hud.researchEfficiency(), color: new BABYLON.Color3(0.6, 0.4, 0.8) }
      ]
    },
    rally: { 
      title: "🚩 Rally", 
      items: [
        { text: "Set Point", icon: "📍", callback: () => hud.setRallyPoint(), color: new BABYLON.Color3(1, 0.2, 0.2) },
        { text: "Clear", icon: "🗑️", callback: () => hud.clearRallyPoint(), color: new BABYLON.Color3(0.6, 0.6, 0.6) },
        { text: "Patrol", icon: "👁️", callback: () => hud.setPatrolRoute(), color: new BABYLON.Color3(0.2, 0.6, 1) },
        { text: "Defend", icon: "🛡️", callback: () => hud.setDefenseMode(), color: new BABYLON.Color3(0.8, 0.4, 0.2) }
      ]
    }
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
    
    // Initialize building system
    initBuildingSystem();
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
    const centerMesh = BABYLON.MeshBuilder.CreateSphere("radialCenter", {diameter: 0.15}, hud.scene);
    const centerMaterial = new BABYLON.StandardMaterial("centerMat", hud.scene);
    centerMaterial.emissiveColor = new BABYLON.Color3(0.2, 0.8, 1); // Cyan glow
    centerMaterial.disableLighting = true;
    centerMesh.material = centerMaterial;
    centerMesh.parent = radialMenu;
    
    // Position center mesh at origin (0,0,0) relative to radial menu
    centerMesh.position.set(0, 0, 0);
    
    // Make center mesh pickable for click detection
    centerMesh.isPickable = true;
    
    // Render on top of terrain
    centerMesh.renderingGroupId = 1;
    
    // Store center mesh reference
    hud.centerMesh = centerMesh;
    
    console.log('🎯 Center mesh created at position (0,0,0) with diameter 0.15');
    
    // Store center mesh reference
    hud.centerMesh = centerMesh;
    
    // Don't make center mesh clickable yet - will be enabled after menu opens
    centerMesh.isPickable = false;
    
    console.log('🎯 Center mesh created at position (0,0,0) with diameter 0.15');
    
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
    
    console.log('🎯 Radial menu shown - currentMenuLevel:', currentMenuLevel, 'anchor:', currentAnchor);
    
    // Always initialize main menu layout when showing the menu
    // This ensures we always start with the 4 main categories
    initializeMainMenuLayout();
    
    // Animate menu items based on original click position for spreading logic
    animateMenuItems(screenX, screenY);
    
    // Enable center mesh clickability AFTER menu is fully opened
    setTimeout(() => {
      if (hud.centerMesh) {
        hud.centerMesh.isPickable = true;
        
        // Add click detection for center mesh
        hud.centerMesh.actionManager = new BABYLON.ActionManager(hud.scene);
        hud.centerMesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
          BABYLON.ActionManager.OnPickTrigger,
          function() {
            if (radialMenuVisible) {
              console.log('🎯 Center mesh clicked - currentMenuLevel:', currentMenuLevel);
              // Only close menu if we're at the root level (main menu)
              if (currentMenuLevel === 'main') {
                console.log('🎯 Center mesh clicked - closing radial menu');
                hud.hideRadialMenu();
              } else {
                console.log('🎯 Center mesh clicked in submenu - going back to main');
                hud.goBackMenu();
              }
            }
          }
        ));
        
        console.log('🎯 Center mesh click handler enabled');
      }
    }, 200); // 200ms delay to ensure menu is fully opened
    
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
  
  // Navigate to a sub-menu - CLEAN TREE SYSTEM
  hud.showSubMenu = function(menuLevel, screenX, screenY) {
    if (!menuDefinitions[menuLevel]) {
      console.warn('Menu level not found:', menuLevel);
      return;
    }
    
    console.log('🌳 Navigating to sub-menu:', menuLevel);
    
    // Save current position in navigation stack
    menuStack.push({level: currentMenuLevel, items: [...radialMenuItems]});
    
    // Switch to new menu level
    currentMenuLevel = menuLevel;
    
    // Retract all buttons except the clicked one, then spread new items
    retractAndExpand(menuLevel, screenX, screenY);
    
    console.log('✅ Sub-menu loaded:', menuLevel);
  };
  
  // Retract all buttons except clicked one, then expand new items
  function retractAndExpand(menuLevel, screenX, screenY) {
    const menuData = menuDefinitions[menuLevel];
    if (!menuData || !menuData.items) {
      console.warn('Submenu data not found:', menuLevel);
      return;
    }
    
    // Find the clicked button to keep at anchor
    const clickedButton = radialMenuItems.find(item => item.text === getCategoryName(menuLevel));
    
    // Retract all other buttons
    radialMenuItems.forEach(item => {
      if (item.mesh && item !== clickedButton) {
        retractButton(item);
      }
    });
    
    // Clear the menu items array, keeping only the clicked button
    const keptButton = clickedButton ? [clickedButton] : [];
    radialMenuItems = keptButton;
    
    // Add new submenu items
    const subItems = menuData.items;
    subItems.forEach((itemDef, index) => {
      // Check if this item has a callback (end action) or is a submenu
      if (itemDef.callback) {
        // This is an end action - add it normally
        hud.addRadialMenuItem(itemDef.text, itemDef.icon, itemDef.callback, itemDef.color);
      } else if (itemDef.submenu) {
        // This is a submenu - add it with navigation callback
        hud.addRadialMenuItem(itemDef.text, itemDef.icon, () => {
          hud.showSubMenu(itemDef.submenu, screenX, screenY);
        }, itemDef.color);
      } else {
        // Fallback - treat as end action
        hud.addRadialMenuItem(itemDef.text, itemDef.icon, () => {
          console.log(`🎯 Executed: ${itemDef.text}`);
        }, itemDef.color);
      }
    });
    
    // Add back button
    hud.addRadialMenuItem("Back", "↩️", () => hud.goBackMenu(screenX, screenY), new BABYLON.Color3(0.5, 0.5, 0.5));
    
    // Position all items at the same anchor with same spread
    positionItemsAtAnchor(screenX, screenY);
  }
  
  // Get the display name for a menu level
  function getCategoryName(menuLevel) {
    const names = {
      'units': 'Units',
      'buildings': 'Buildings', 
      'research': 'Research',
      'rally': 'Rally'
    };
    return names[menuLevel] || menuLevel;
  }
  
  // Retract a button (animate it away)
  function retractButton(item) {
    if (!item.mesh) return;
    
    // Animate button scaling down and fading out
    const retractAnimation = new BABYLON.Animation(
      "retractButton",
      "scaling",
      15,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    
    const keyFrames = [];
    keyFrames.push({ frame: 0, value: new BABYLON.Vector3(1, 1, 1) });
    keyFrames.push({ frame: 15, value: new BABYLON.Vector3(0, 0, 0) });
    
    retractAnimation.setKeys(keyFrames);
    
    // Add easing for smooth retraction
    const easingFunction = new BABYLON.QuadraticEase();
    easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEIN);
    retractAnimation.setEasingFunction(easingFunction);
    
    item.mesh.animations = [retractAnimation];
    hud.scene.beginAnimation(item.mesh, 0, 15, false);
    
    // Dispose of the mesh after animation
    setTimeout(() => {
      if (item.mesh) {
        item.mesh.dispose();
      }
    }, 150);
  }
  
  // Position all items at the same anchor with same spread
  function positionItemsAtAnchor(screenX, screenY) {
    // Get the current anchor direction
    const anchorDirection = getAnchorDirection();
    const baseAngle = calculateBaseAngleForAnchor(anchorDirection);
    
    // Position items in a 180° arc spread, same as main menu
    const totalItems = radialMenuItems.length;
    const angleSpread = 180;
    const angleStep = angleSpread / Math.max(totalItems - 1, 1);
    
    // Use larger radius for submenu items to avoid center overlap
    const radius = currentMenuLevel === 'main' ? Math.max(menuConfig.itemRadius, 1.0) : Math.max(menuConfig.itemRadius * 1.5, 1.5);
    
    radialMenuItems.forEach((item, index) => {
      if (item.mesh) {
        // Spread items across 180° arc from the anchor direction
        let angle = baseAngle + (index * angleStep) - (angleSpread / 2);
        
        // Normalize angle to 0-360 range
        while (angle < 0) angle += 360;
        while (angle >= 360) angle -= 360;
        
        const radians = (angle * Math.PI) / 180;
        const x = Math.sin(radians) * radius;
        const z = Math.cos(radians) * radius;
        
        item.mesh.position.set(x, 0, z);
        console.log(`📍 Positioned ${item.text} at angle ${angle.toFixed(1)}° (${x.toFixed(2)}, ${z.toFixed(2)}) - radius: ${radius}`);
      }
    });
  }
  
  // Animate expanded menu items
  function animateExpandedMenu(screenX, screenY) {
    radialMenuItems.forEach((item, index) => {
      if (!item.mesh) return;
      
      if (item.isSubItem) {
        // Sub-items animate from center outward
        const targetPos = calculateExpandedItemPosition(item, screenX, screenY);
        
        // Start from center
        item.mesh.position.set(0, 0, 0);
        
        // Animate to expanded position
        const animation = new BABYLON.Animation(
          "expandItem",
          "position",
          30,
          BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        
        const keyFrames = [];
        keyFrames.push({ frame: 0, value: new BABYLON.Vector3(0, 0, 0) });
        keyFrames.push({ frame: 30, value: targetPos });
        
        animation.setKeys(keyFrames);
        
        // Add easing for smooth expansion
        const easingFunction = new BABYLON.QuadraticEase();
        easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        animation.setEasingFunction(easingFunction);
        
        item.mesh.animations = [animation];
        hud.scene.beginAnimation(item.mesh, 0, 30, false);
      }
    });
  }
  
  // Calculate position for expanded sub-items
  function calculateExpandedItemPosition(item, screenX, screenY) {
    if (item.text === "Back") {
      return new BABYLON.Vector3(0, 0, 0); // Center
    }
    
    const radians = (item.angle * Math.PI) / 180;
    const x = Math.sin(radians) * item.radius;
    const z = Math.cos(radians) * item.radius;
    
    return new BABYLON.Vector3(x, 0, z);
  }
  
  // Go back to previous menu level - STABLE SYSTEM
  hud.goBackMenu = function(screenX, screenY) {
    if (menuStack.length === 0) {
      // If we're at the root, return to main menu
      console.log('🔄 Returning to main menu');
      returnToMainMenu(screenX, screenY);
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
    
    // Re-animate the menu with collapse effect
    if (radialMenuVisible) {
      animateMenuCollapse(screenX, screenY);
    }
    
    console.log('🔄 Returned to menu level:', currentMenuLevel);
  };
  
  // Return to main menu - STABLE SYSTEM
  function returnToMainMenu(screenX, screenY) {
    console.log('🏠 Returning to main menu with 4 main categories');
    
    // Clear the menu stack completely
    menuStack = [];
    
    // Reset to main menu level
    currentMenuLevel = 'main';
    
    // Clear all current items
    clearMenuItems();
    
    // Re-add only the main menu items (these are set up in gfx.js)
    if (window.hud && window.hud.addRadialMenuItem) {
      // The main menu items are already added in gfx.js, so we just need to reinitialize
      initializeMainMenuLayout();
    }
    
    // Re-animate the main menu
    if (radialMenuVisible) {
      animateMenuItems(screenX, screenY);
    }
    
    console.log('✅ Main menu restored with 4 main categories');
  }
  
  // Animate menu collapse back to main level - DREAM SYSTEM
  function animateMenuCollapse(screenX, screenY) {
    // First, restore main menu items to full size
    restoreMainMenuItems();
    
    radialMenuItems.forEach((item, index) => {
      if (!item.mesh) return;
      
      // Animate from current position back to main menu positions
      const targetPos = calculateMainItemPosition(item, screenX, screenY);
      
      const animation = new BABYLON.Animation(
        "collapseItem",
        "position",
        20,
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      const keyFrames = [];
      keyFrames.push({ frame: 0, value: item.mesh.position.clone() });
      keyFrames.push({ frame: 20, value: targetPos });
      
      animation.setKeys(keyFrames);
      
      // Add easing for smooth collapse
      const easingFunction = new BABYLON.QuadraticEase();
      easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEIN);
      animation.setEasingFunction(easingFunction);
      
      item.mesh.animations = [animation];
      hud.scene.beginAnimation(item.mesh, 0, 20, false);
    });
  }
  
  // Restore main menu items to full size when returning from submenu
  function restoreMainMenuItems() {
    radialMenuItems.forEach(item => {
      if (!item.isSubItem && item.mesh) {
        // Animate restoring to full size
        const restoreAnimation = new BABYLON.Animation(
          "restoreMainItem",
          "scaling",
          20,
          BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        
        const keyFrames = [];
        keyFrames.push({ frame: 0, value: new BABYLON.Vector3(0.5, 0.5, 0.5) });
        keyFrames.push({ frame: 20, value: new BABYLON.Vector3(1, 1, 1) });
        
        restoreAnimation.setKeys(keyFrames);
        
        // Add easing for smooth restoration
        const easingFunction = new BABYLON.QuadraticEase();
        easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        restoreAnimation.setEasingFunction(easingFunction);
        
        item.mesh.animations = [restoreAnimation];
        hud.scene.beginAnimation(item.mesh, 0, 20, false);
      }
    });
  }
  
  // Calculate position for main menu items
  function calculateMainItemPosition(item, screenX, screenY) {
    const radians = (item.angle * Math.PI) / 180;
    // Ensure main menu items are positioned far enough from center to avoid overlap
    const safeRadius = Math.max(menuConfig.itemRadius, 1.0); // At least 1.0 units from center
    const x = Math.sin(radians) * safeRadius;
    const z = Math.cos(radians) * safeRadius;
    
    console.log(`📍 Main menu item "${item.text}" positioned at (${x.toFixed(2)}, ${z.toFixed(2)}) - radius: ${safeRadius}`);
    
    return new BABYLON.Vector3(x, 0, z);
  }
  
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
    const menuData = menuDefinitions[level];
    if (!menuData) {
      console.warn('Menu level not found:', level);
      return;
    }
    
    const items = menuData.items || [];
    
    // Add back button for sub-menus
    if (level !== 'main') {
      hud.addRadialMenuItem("Back", "↩️", () => hud.goBackMenu(), new BABYLON.Color3(0.5, 0.5, 0.5));
    }
    
    // Add close menu button for main menu
    if (level === 'main') {
      hud.addRadialMenuItem("Close", "❌", () => hud.hideRadialMenu(), new BABYLON.Color3(0.8, 0.2, 0.2));
    }
    
    // Add all items for this level
    items.forEach(itemDef => {
      hud.addRadialMenuItem(itemDef.text, itemDef.icon, itemDef.callback, itemDef.color);
    });
  }
  
  // Initialize main menu layout (called when menu is first shown) - STABLE SYSTEM
  function initializeMainMenuLayout() {
    console.log('🏠 Initializing main menu with 4 main categories');
    
    // Clear any existing submenu items to ensure clean main menu
    clearSubmenuItems();
    
    // Reset to main menu level
    currentMenuLevel = 'main';
    
    // Position main menu items in a circle
    radialMenuItems.forEach((item, index) => {
      if (!item.isSubItem && item.mesh) {
        const pos = calculateMainItemPosition(item, 0, 0);
        item.mesh.position.copyFrom(pos);
        
        // Ensure main menu items are at full scale and visible
        item.mesh.scaling.setAll(1.0);
        if (item.mesh.material) {
          item.mesh.material.alpha = 1.0;
        }
        
        console.log(`📍 Main menu item "${item.text}" positioned at (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`);
      }
    });
    
    console.log('✅ Main menu initialized with', radialMenuItems.filter(item => !item.isSubItem).length, 'main categories');
  }
  
  // Clear any submenu items to ensure clean main menu
  function clearSubmenuItems() {
    // Store submenu items before filtering
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    
    // Remove submenu items from the array
    radialMenuItems = radialMenuItems.filter(item => !item.isSubItem);
    
    // Clean up any existing submenu meshes
    submenuItems.forEach(item => {
      if (item.mesh) {
        item.mesh.dispose();
      }
    });
  }
  
  // Add item to radial menu - DIRECTIONAL SYSTEM
  hud.addRadialMenuItem = function(text, icon, callback, color) {
    // Calculate angle based on total items (including this one)
    const totalItems = radialMenuItems.length + 1;
    
    // Get the current anchor direction to determine starting angle
    const anchorDirection = getAnchorDirection();
    const baseAngle = calculateBaseAngleForAnchor(anchorDirection);
    
    // Spread items across 180° arc, starting from anchor direction
    const angleSpread = 180;
    const angleStep = angleSpread / (Math.max(totalItems, 4) - 1);
    const angle = baseAngle + ((totalItems - 1) * angleStep) - (angleSpread / 2);
    
    console.log(`🎯 Adding menu item "${text}" at angle ${angle.toFixed(1)}° (anchor: ${anchorDirection}, base: ${baseAngle}°)`);
    
    const item = {
      text: text,
      icon: icon,
      callback: callback,
      color: color || new BABYLON.Color3(0.8, 0.4, 0.1), // Default orange
      angle: angle,
      radius: menuConfig.itemRadius, // Use config radius for main menu items
      isSubItem: false, // Mark as main menu item
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
        // Prevent event propagation to center mesh
        event?.stopPropagation?.();
        
        // Visual feedback - briefly scale up the clicked item
        const originalScale = mesh.scaling.clone();
        mesh.scaling.scaleInPlace(1.3);
        setTimeout(() => {
          mesh.scaling.copyFrom(originalScale);
        }, 150);
        
        console.log(`🎯 Menu item "${item.text}" clicked - executing callback`);
        
        if (item.callback) {
          item.callback();
        }
        
        // Only hide menu for "Back" button, keep it open for other actions
        if (item.text === "Back") {
          hud.hideRadialMenu();
        }
      }
    ));
    
    // Store mesh reference
    item.mesh = mesh;
    
    // Position based on item type
    if (item.isSubItem) {
      // Sub-items start at center (will expand outward)
      mesh.position.set(0, 0, 0);
    } else {
      // Main menu items start at their final positions
      const pos = calculateMainItemPosition(item, 0, 0);
      mesh.position.copyFrom(pos);
    }
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
    
    // Check if this unit is selected using player's selection system
    const isSelected = window.player && window.player.isUnitSelected(unit);
    
    // Reuse existing indicator or create new one
    let indicator;
    if (index < minimapIndicators.length) {
      // Reuse existing sphere
      indicator = minimapIndicators[index];
      indicator.setEnabled(true);
      
      // Update the linked unit reference for reused indicators
      indicator.linkedUnit = unit;
    } else {
      // Create new sphere
      indicator = BABYLON.MeshBuilder.CreateSphere(`minimap_${index}`, {diameter: 0.15}, hud.scene);
      
      // Create material that will be updated below
      const material = new BABYLON.StandardMaterial(`minimap_mat_${index}`, hud.scene);
      material.disableLighting = true; // Make them glow like the center sphere
      indicator.material = material;
      
      // Make indicator clickable for unit selection
      indicator.isPickable = true;
      
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
    
          // Add click functionality to the indicator (only for newly created ones)
      if (!indicator.actionManager) {
        indicator.actionManager = new BABYLON.ActionManager(hud.scene);
        
        // Store direct reference to the unit this indicator represents
        indicator.linkedUnit = unit;
        
        // Add double-click detection for "select all of type"
        let lastClickTime = 0;
        const DOUBLE_CLICK_DELAY = 300;
        
        // Single click action - select the unit
        indicator.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
          BABYLON.ActionManager.OnPickTrigger,
          function() {
            const currentTime = Date.now();
            const linkedUnit = indicator.linkedUnit; // Get the unit from the indicator
            
            if (currentTime - lastClickTime < DOUBLE_CLICK_DELAY) {
              // Double-click detected! Select all units of this type
              console.log(`🔄 Double-clicked minimap indicator for ${linkedUnit.name} (${linkedUnit.type}) - selecting all units of this type`);
              
              // Use player's selection system for double-click functionality
              if (window.player && window.player.selectAllUnitsOfType) {
                window.player.selectAllUnitsOfType(linkedUnit.type);
              }
              
              lastClickTime = 0; // Reset for next double-click
            } else {
              // Single click - select just this unit
              console.log(`🗺️ Minimap indicator clicked for unit: ${linkedUnit.name}`);
              
              // Use player's selection system for single-click unit selection
              if (window.player && window.player.selectUnit) {
                // Clear current selection and select just this unit
                window.player.clearSelection();
                window.player.selectUnit(linkedUnit);
              }
              
              lastClickTime = currentTime;
              
              // IMPORTANT: Return true to prevent the click from propagating to terrain
              return true;
            }
          }
        ));
      }
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
  
  // ===== BUILDING SYSTEM =====
  
  // Building system state
  let buildingMode = false;
  let currentBuildingType = null;
  let buildingPreview = null;
  
  // Initialize building system
  function initBuildingSystem() {
    console.log('🏗️ Building system initialized');
  }
  
  // Start building placement mode - DREAM SYSTEM
  hud.startBuildingPlacement = function(buildingType) {
    console.log(`🏗️ Starting building placement for: ${buildingType}`);
    buildingMode = true;
    currentBuildingType = buildingType;
    
    if (buildingType === 'camp') {
      console.log('⛺ Camp placement mode activated! Click to place your camp.');
      
      // Expand the camp menu with building options
      expandCampBuildingMenu();
      
      // Hide the main buildings menu temporarily
      hideBuildingsMenu();
    }
  }
  
  // Expand camp building menu with placement options - DIRECTIONAL SYSTEM
  function expandCampBuildingMenu() {
    // Find the Buildings button to get its angle and anchor direction
    const buildingsButton = radialMenuItems.find(item => item.text === "Buildings");
    if (!buildingsButton) {
      console.warn('Buildings button not found for camp expansion');
      return;
    }
    
    // Get the anchor direction from the current menu position
    const anchorDirection = getAnchorDirection();
    console.log('🏗️ Expanding camp from Buildings button at angle:', buildingsButton.angle, 'Anchor direction:', anchorDirection);
    
    // Create camp building options
    const campOptions = [
      { text: "Place Camp", icon: "📍", callback: () => activateCampPlacement(), color: new BABYLON.Color3(0.4, 0.8, 0.4) },
      { text: "Cancel", icon: "❌", callback: () => cancelCampPlacement(), color: new BABYLON.Color3(0.8, 0.2, 0.2) }
    ];
    
    // Calculate the base angle for camp options based on anchor direction
    const baseAngle = calculateBaseAngleForAnchor(anchorDirection);
    const angleSpread = 120; // Spread camp options across 120° arc
    
    // Add camp options in expanded radius, following anchor direction
    campOptions.forEach((option, index) => {
      // Calculate angle relative to anchor direction
      const relativeAngle = baseAngle + (index * (angleSpread / (campOptions.length - 1))) - (angleSpread / 2);
      const expandedRadius = menuConfig.itemRadius * 3.5; // Even further out than buildings
      
      const campOption = {
        text: option.text,
        icon: option.icon,
        callback: option.callback,
        color: option.color,
        angle: relativeAngle,
        radius: expandedRadius,
        isSubItem: true,
        isCampOption: true, // Mark as camp-specific option
        mesh: null
      };
      
      radialMenuItems.push(campOption);
      createMenuItemMesh(campOption);
    });
    
    // Animate camp options expanding outward
    animateCampOptions();
  }
  
  // Get the current anchor direction for the menu
  function getAnchorDirection() {
    return currentAnchor || 'bottom'; // Default to bottom if not set
  }
  
  // Calculate base angle for submenu items based on anchor direction
  function calculateBaseAngleForAnchor(anchor) {
    switch (anchor) {
      case 'top':
        return 90; // Downward (away from top edge)
      case 'bottom':
        return 270; // Upward (away from bottom edge)
      case 'left':
        return 0; // Rightward (away from left edge)
      case 'right':
        return 180; // Leftward (away from right edge)
      default:
        return 270; // Default to upward (bottom anchor)
    }
  }
  
  // Animate camp options expanding outward
  function animateCampOptions() {
    radialMenuItems.forEach(item => {
      if (item.isCampOption && item.mesh) {
        const targetPos = calculateExpandedItemPosition(item, 0, 0);
        
        // Start from center
        item.mesh.position.set(0, 0, 0);
        
        // Animate to expanded position
        const animation = new BABYLON.Animation(
          "expandCampOption",
          "position",
          30,
          BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        
        const keyFrames = [];
        keyFrames.push({ frame: 0, value: new BABYLON.Vector3(0, 0, 0) });
        keyFrames.push({ frame: 30, value: targetPos });
        
        animation.setKeys(keyFrames);
        
        // Add easing for smooth expansion
        const easingFunction = new BABYLON.QuadraticEase();
        easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        animation.setEasingFunction(easingFunction);
        
        item.mesh.animations = [animation];
        hud.scene.beginAnimation(item.mesh, 0, 30, false);
      }
    });
  }
  
  // Hide buildings menu when camp is selected
  function hideBuildingsMenu() {
    radialMenuItems.forEach(item => {
      if (item.isSubItem && !item.isCampOption && item.mesh) {
        // Fade out buildings menu items
        const fadeAnimation = new BABYLON.Animation(
          "fadeBuildings",
          "material.alpha",
          15,
          BABYLON.Animation.ANIMATIONTYPE_FLOAT,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        
        const keyFrames = [];
        keyFrames.push({ frame: 0, value: 1.0 });
        keyFrames.push({ frame: 15, value: 0.3 });
        
        fadeAnimation.setKeys(keyFrames);
        
        item.mesh.animations = [fadeAnimation];
        hud.scene.beginAnimation(item.mesh, 0, 15, false);
      }
    });
  }
  
  // Activate camp placement mode
  function activateCampPlacement() {
    console.log('⛺ Camp placement mode activated! Click on terrain to place your camp.');
    
    // Set up click handler for terrain placement
    if (hud.canvas) {
      hud.canvas.addEventListener('click', handleCampPlacementClick);
    }
    
    // Show placement instructions
    showCampPlacementInstructions();
  }
  
  // Handle camp placement clicks
  function handleCampPlacementClick(event) {
    if (!buildingMode || currentBuildingType !== 'camp') return;
    
    // Get click position in world coordinates
    const rect = hud.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Raycast to get world position
    const ray = hud.scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), hud.camera);
    const hit = hud.scene.pickWithRay(ray);
    
    if (hit && hit.pickedMesh && hit.pickedMesh.name.includes('Mesh')) {
      // Place camp at clicked position
      placeCamp(hit.pickedPoint);
      
      // Exit building mode
      exitBuildingMode();
    }
  }
  
  // Place the camp building
  function placeCamp(position) {
    console.log(`⛺ Placing camp at position:`, position.toString());
    
    // Create a simple camp mesh
    const camp = BABYLON.MeshBuilder.CreateCylinder('camp', { height: 1.5, diameter: 2 }, hud.scene);
    const material = new BABYLON.StandardMaterial('campMaterial', hud.scene);
    material.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.4); // Brown
    camp.material = material;
    camp.position.copyFrom(position);
    camp.position.y = 0.75; // Half height to sit on ground
    
    // Add tent structure on top
    const tent = BABYLON.MeshBuilder.CreateCone('tent', { height: 1, diameter: 1.8 }, hud.scene);
    tent.material = material;
    tent.position.y = 1.5;
    tent.parent = camp;
    
    console.log('✅ Camp placed successfully!');
    
    // You can add more camp logic here:
    // - Add to building list
    // - Trigger camp effects
    // - Spawn camp-related units
    // - etc.
  }
  
  // Cancel camp placement
  function cancelCampPlacement() {
    console.log('❌ Camp placement cancelled');
    exitBuildingMode();
  }
  
  // Exit building mode and return to main menu
  function exitBuildingMode() {
    console.log('🏗️ Exiting building mode');
    
    // Reset building system state
    buildingMode = false;
    currentBuildingType = null;
    
    // Remove click handler for building placement
    if (hud.canvas) {
      hud.canvas.removeEventListener('click', handleCampPlacementClick);
    }
    
    // Return to main menu
    returnToMainMenu(0, 0);
  }
  
  // Show camp placement instructions
  function showCampPlacementInstructions() {
    console.log('📋 Click on terrain to place your camp. The camp will provide shelter and basic resources.');
  }
  
  // ===== UNIT MANAGEMENT FUNCTIONS =====
  
  hud.selectAllUnits = function() {
    console.log('👥 Selecting all units');
    if (window.player && window.player.selectAllUnits) {
      window.player.selectAllUnits();
    }
  }
  
  hud.deselectAllUnits = function() {
    console.log('❌ Deselecting all units');
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
    }
  }
  
  hud.setUnitFormation = function() {
    console.log('⚔️ Setting unit formation');
  }
  
  hud.upgradeUnits = function() {
    console.log('⬆️ Upgrading units');
  }
  
  // ===== RESEARCH FUNCTIONS =====
  
  hud.researchWeapons = function() {
    console.log('⚔️ Researching weapons');
  }
  
  hud.researchArmor = function() {
    console.log('🛡️ Researching armor');
  }
  
  hud.researchSpeed = function() {
    console.log('⚡ Researching speed');
  }
  
  hud.researchEfficiency = function() {
    console.log('⚙️ Researching efficiency');
  }
  
  // ===== RALLY FUNCTIONS =====
  
  hud.setRallyPoint = function() {
    console.log('📍 Setting rally point');
  }
  
  hud.clearRallyPoint = function() {
    console.log('🗑️ Clearing rally point');
  }
  
  hud.setPatrolRoute = function() {
    console.log('👁️ Setting patrol route');
  }
  
  hud.setDefenseMode = function() {
    console.log('🛡️ Setting defense mode');
  }
  
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
