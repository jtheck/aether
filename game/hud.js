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
  
  // Track current mouse position for space key handler
  let currentMousePosition = { x: 0, y: 0 };
  
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
  
  // Menu definitions with sub-categories - mirrors the 2D menu structure
  let menuDefinitions = {
    buildings: {
      camp: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('camp');
          }
        }
      },
      village: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('village');
          }
        }
      },
      farm: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('farm');
          }
        }
      },
      tower: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('tower');
          }
        }
      }
    },
    units: {
      monk: {
        callback: () => window.recruitUnit('monk')
      },
      wizard: {
        callback: () => window.recruitUnit('wizard')
      },
      engineer: {
        callback: () => window.recruitUnit('engineer')
      },
      brigand: {
        callback: () => {
          // Submit convert command to turn a villager into a brigand
          if (window.currentMatch && window.player) {
            // Find a villager to convert
            // Priority: 1) Selected villagers, 2) Nearby unselected villagers
            const normalizedPlayerId = window.player.id.slice(-6);
            const myVillagers = window.player.units.filter(u => u.type === 'villager' && u.owner === normalizedPlayerId);
            
            if (myVillagers.length === 0) {
              console.log('❌ No villagers available to convert to brigand');
              return;
            }
            
            // Check selected villagers first
            const selectedVillagers = window.player.selectedUnits.filter(u => u.type === 'villager' && u.owner === normalizedPlayerId);
            let targetVillager = null;
            
            if (selectedVillagers.length > 0) {
              // Convert the first selected villager
              targetVillager = selectedVillagers[0];
            } else {
              // Find a random villager near the agora
              const agoraBuilding = window.playerBuildings?.find(b => b.type === 'agora' && b.owner === normalizedPlayerId);
              if (agoraBuilding) {
                const agoraPos = { x: agoraBuilding.gridX * TILE_SIZE, z: agoraBuilding.gridZ * TILE_SIZE };
                
                // Sort by distance to agora
                myVillagers.sort((a, b) => {
                  const distA = Math.sqrt(Math.pow(a.position.x - agoraPos.x, 2) + Math.pow(a.position.z - agoraPos.z, 2));
                  const distB = Math.sqrt(Math.pow(b.position.x - agoraPos.x, 2) + Math.pow(b.position.z - agoraPos.z, 2));
                  return distA - distB;
                });
                
                targetVillager = myVillagers[0]; // Closest villager
              } else {
                // No agora, just pick first villager
                targetVillager = myVillagers[0];
              }
            }
            
            if (targetVillager) {
              window.currentMatch.submitCommand({
                type: 'convert',
                playerId: window.player.id,
                unitId: targetVillager.id,
                targetType: 'brigand'
              });
            }
          }
        }
      }
    },
    research: {
      scribes: {
        callback: () => console.log("Research: Scribes selected")
      },
      drayage: {
        callback: () => console.log("Research: Drayage selected")
      },
      prospecting: {
        callback: () => console.log("Research: Prospecting selected")
      }
    },
    rally: {
      home: {
        callback: () => console.log("Rally: Home selected")
      }
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
    // console.log('HUD system initialized');
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
    
    // console.log('Radial menu configured:', menuConfig);
  };
  
  // Set up middle mouse button and spacebar control for radial menu
  function setupMiddleMouseControl() {
    if (!hud.canvas) return;
    
    // Track mouse position for space key handler
    hud.canvas.addEventListener('mousemove', function(e) {
      const rect = hud.canvas.getBoundingClientRect();
      currentMousePosition.x = e.clientX - rect.left;
      currentMousePosition.y = e.clientY - rect.top;
    });
    
    hud.canvas.addEventListener('pointerdown', function(e) {
      if (e.button === 1) { // Middle mouse button
        e.preventDefault();
        
        if (USE_3D_HUD) {
          // 3D HUD mode - show 3D radial menu
          const anchors = {
            n: document.getElementById('anchor_n'),
            s: document.getElementById('anchor_s'),
            e: document.getElementById('anchor_e'),
            w: document.getElementById('anchor_w')
          };
          
          // Get anchor positions
          const anchorPositions = {};
          for (const [direction, anchor] of Object.entries(anchors)) {
            if (anchor) {
              const rect = anchor.getBoundingClientRect();
              const canvasRect = hud.canvas.getBoundingClientRect();
              anchorPositions[direction] = {
                x: rect.left + rect.width / 2 - canvasRect.left,
                y: rect.top + rect.height / 2 - canvasRect.top
              };
            }
          }
          
          // Find closest anchor to current mouse position
          let minDist = Infinity;
          let closestAnchor = 's'; // Default to south if no anchors found
          
          for (const [direction, pos] of Object.entries(anchorPositions)) {
            const dist = Math.sqrt((currentMousePosition.x - pos.x)**2 + (currentMousePosition.y - pos.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestAnchor = direction;
            }
          }
          
          // Convert direction to anchor name for 3D menu
          const anchorMap = { n: 'top', s: 'bottom', e: 'right', w: 'left' };
          const anchorName = anchorMap[closestAnchor] || 'bottom';
          
          // Show 3D menu at closest anchor
          if (anchorPositions[closestAnchor]) {
            hud.showRadialMenu(anchorPositions[closestAnchor].x, anchorPositions[closestAnchor].y, anchorName);
          }
        } else {
          // 2D HUD mode - find closest anchor and trigger 2D menu
          const anchors = {
            n: document.getElementById('anchor_n'),
            s: document.getElementById('anchor_s'),
            e: document.getElementById('anchor_e'),
            w: document.getElementById('anchor_w')
          };
          
          // Get anchor positions
          const anchorPositions = {};
          for (const [direction, anchor] of Object.entries(anchors)) {
            if (anchor) {
              const rect = anchor.getBoundingClientRect();
              anchorPositions[direction] = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              };
            }
          }
          
          // Find closest anchor to current mouse position
          let minDist = Infinity;
          let closestAnchor = 's'; // Default to south if no anchors found
          
          for (const [direction, pos] of Object.entries(anchorPositions)) {
            const dist = Math.sqrt((currentMousePosition.x - pos.x)**2 + (currentMousePosition.y - pos.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestAnchor = direction;
            }
          }
          
          // Click the closest anchor
          if (anchors[closestAnchor]) {
            anchors[closestAnchor].click();
          }
        }
      }
    });
    
    // Don't auto-close menu on left/right clicks anymore
    // Menu items handle their own clicks via 3D mesh picking
    // Middle mouse and spacebar both open the menu at closest anchor
    
    // Add spacebar support - opens menu at closest anchor based on HUD mode
    document.addEventListener('keydown', function(e) {
      if (e.code === 'Space') {
        e.preventDefault();
        
        if (USE_3D_HUD) {
          // 3D HUD mode - show 3D radial menu
          const anchors = {
            n: document.getElementById('anchor_n'),
            s: document.getElementById('anchor_s'),
            e: document.getElementById('anchor_e'),
            w: document.getElementById('anchor_w')
          };
          
          // Get anchor positions
          const anchorPositions = {};
          for (const [direction, anchor] of Object.entries(anchors)) {
            if (anchor) {
              const rect = anchor.getBoundingClientRect();
              const canvasRect = hud.canvas.getBoundingClientRect();
              anchorPositions[direction] = {
                x: rect.left + rect.width / 2 - canvasRect.left,
                y: rect.top + rect.height / 2 - canvasRect.top
              };
            }
          }
          
          // Find closest anchor to current mouse position
          let minDist = Infinity;
          let closestAnchor = 's'; // Default to south if no anchors found
          
          for (const [direction, pos] of Object.entries(anchorPositions)) {
            const dist = Math.sqrt((currentMousePosition.x - pos.x)**2 + (currentMousePosition.y - pos.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestAnchor = direction;
            }
          }
          
          // Convert direction to anchor name for 3D menu
          const anchorMap = { n: 'top', s: 'bottom', e: 'right', w: 'left' };
          const anchorName = anchorMap[closestAnchor] || 'bottom';
          
          // Show 3D menu at closest anchor
          if (anchorPositions[closestAnchor]) {
            hud.showRadialMenu(anchorPositions[closestAnchor].x, anchorPositions[closestAnchor].y, anchorName);
          }
        } else {
          // 2D HUD mode - find closest anchor and trigger 2D menu
          const anchors = {
            n: document.getElementById('anchor_n'),
            s: document.getElementById('anchor_s'),
            e: document.getElementById('anchor_e'),
            w: document.getElementById('anchor_w')
          };
          
          // Get anchor positions
          const anchorPositions = {};
          for (const [direction, anchor] of Object.entries(anchors)) {
            if (anchor) {
              const rect = anchor.getBoundingClientRect();
              anchorPositions[direction] = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
              };
            }
          }
          
          // Find closest anchor to current mouse position
          let minDist = Infinity;
          let closestAnchor = 's'; // Default to south if no anchors found
          
          for (const [direction, pos] of Object.entries(anchorPositions)) {
            const dist = Math.sqrt((currentMousePosition.x - pos.x)**2 + (currentMousePosition.y - pos.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestAnchor = direction;
            }
          }
          
          // Click the closest anchor
          if (anchors[closestAnchor]) {
            anchors[closestAnchor].click();
          }
        }
      }
    });
    
    // console.log('Middle mouse button and spacebar control set up for radial menu');
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
    
    // console.log('🎯 Center mesh created at position (0,0,0) with diameter 0.15');
    
    // Store center mesh reference
    hud.centerMesh = centerMesh;
    
    // Don't make center mesh clickable yet - will be enabled after menu opens
    centerMesh.isPickable = false;
    
    // console.log('🎯 Center mesh created at position (0,0,0) with diameter 0.15');
    
    // console.log('3D Radial menu created with billboard mode');
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
    
    // console.log('🎯 Radial menu shown - currentMenuLevel:', currentMenuLevel, 'anchor:', currentAnchor);
    
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
              // console.log('🎯 Center mesh clicked - closing radial menu');
              // Center mesh always closes the menu, no back button behavior
              hud.hideRadialMenu();
            }
          }
        ));
        
        // console.log('🎯 Center mesh click handler enabled');
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
  
  // Check if radial menu is visible
  hud.isRadialMenuVisible = function() {
    return radialMenuVisible;
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
      
      const radius = item.radius || (0.8 + (distanceFactor * 0.6)); // Use item's radius, fallback to calculated radius
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
      console.warn('3D Menu level not found:', menuLevel);
      return;
    }
    
    // If screenX/screenY are NaN or invalid, we need to get the actual button position
    let validScreenX = screenX;
    let validScreenY = screenY;
    
    if (isNaN(screenX) || isNaN(screenY) || screenX === undefined || screenY === undefined) {
      // We need to find the actual position of the clicked button
      // For now, use the center of the screen as fallback
      const rect = hud.canvas.getBoundingClientRect();
      validScreenX = rect.width / 2;
      validScreenY = rect.height / 2;
      // console.log(`🎯 Using fallback coordinates: (${validScreenX}, ${validScreenY}) - need to get actual button position`);
    }
    
    // console.log('🌳 3D Menu: Navigating to sub-menu:', menuLevel, 'using clicked button at:', validScreenX, validScreenY);
    
    // Save current position in navigation stack
    menuStack.push({level: currentMenuLevel, items: [...radialMenuItems]});
    
    // Switch to new menu level
    currentMenuLevel = menuLevel;
    
    // Clear only submenu items, keep main menu items
    clearSubmenuItems();
    
    // Create submenu items that spread out from the clicked button
    const submenuData = menuDefinitions[menuLevel];
    const submenuItems = Object.entries(submenuData);
    
    // Add each submenu item (will be marked as submenu item automatically)
    submenuItems.forEach(([key, value]) => {
      const itemName = key.charAt(0).toUpperCase() + key.slice(1); // Capitalize first letter
      const icon = getIconForItem(key);
      const color = getColorForCategory(menuLevel);
      
      // Add as submenu item (isSubItem will be true because currentMenuLevel !== 'main')
      hud.addRadialMenuItem(itemName, icon, value.callback, color);
    });
    
    // No back button needed
    
    // Position all items in an arc like the main menu, but spread from the anchor
    positionSubmenuItemsInArc(validScreenX, validScreenY);
    
    // console.log('✅ Sub-menu loaded:', menuLevel);
  };
  
  // Retract all buttons except clicked one, then expand new items
  function retractAndExpand(menuLevel, screenX, screenY) {
    const menuData = menuDefinitions[menuLevel];
    if (!menuData || !menuData.items) {
      // console.warn('Submenu data not found:', menuLevel);
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
          // Exit building placement mode if currently placing and this is not a building submenu
          if (window.buildingSystem && window.buildingSystem.isPlacing && itemDef.submenu !== 'buildings') {
            window.buildingSystem.cancelPlacement();
          }
          hud.showSubMenu(itemDef.submenu, screenX, screenY);
        }, itemDef.color);
      } else {
        // Fallback - treat as end action
        hud.addRadialMenuItem(itemDef.text, itemDef.icon, () => {
          // console.log(`🎯 Executed: ${itemDef.text}`);
        }, itemDef.color);
      }
    });
    
    // Add back button
    // No back button needed
    
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
  
  // Get icon for menu item (mirrors 2D menu icons)
  function getIconForItem(key) {
    const icons = {
      // Buildings
      camp: '⛺',
      village: '🏘️',
      farm: '🚜',
      tower: '🗼',
      
      // Units
      monk: '🧘',
      wizard: '🧙',
      engineer: '🔧',
      brigand: '⚔️',
      
      // Research
      scribes: '📝',
      drayage: '🚛',
      prospecting: '⛏️',
      
      // Rally
      home: '🏠',
      
      // Default icons for categories
      units: '👥',
      buildings: '🏗️',
      research: '📚',
      rally: '🚩'
    };
    
    return icons[key] || '❓';
  }
  
  // Get color for category (mirrors 2D menu colors)
  function getColorForCategory(category) {
    const colors = {
      'buildings': new BABYLON.Color3(0, 1, 0), // Green
      'units': new BABYLON.Color3(0.2, 0.6, 1), // Blue
      'research': new BABYLON.Color3(1, 1, 0), // Yellow
      'rally': new BABYLON.Color3(1, 0, 0) // Red
    };
    return colors[category] || new BABYLON.Color3(0.5, 0.5, 0.5); // Default gray
  }
  
  // Clear all menu items
  function clearMenuItems() {
    radialMenuItems.forEach(item => {
      if (item.mesh) {
        item.mesh.dispose();
      }
    });
    radialMenuItems = [];
  }
  
  // Clear only submenu items, keep main menu items
  function clearSubmenuItems() {
    // Find and remove only submenu items
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    submenuItems.forEach(item => {
      if (item.mesh) {
        item.mesh.dispose();
      }
    });
    
    // Remove submenu items from the array
    radialMenuItems = radialMenuItems.filter(item => !item.isSubItem);
    
    // console.log(`🧹 Cleared ${submenuItems.length} submenu items, kept ${radialMenuItems.length} main menu items`);
  }
  
  // Position submenu items in an arc relative to the CLICKED CATEGORY BUTTON
  function positionSubmenuItemsInArc(screenX, screenY) {
    const rect = hud.canvas.getBoundingClientRect();
    
    // Use the clicked category button position (screenX, screenY) as the anchor
    const buttonX = screenX;
    const buttonY = screenY;
    
    // console.log(`🎯 Submenu positioning using CLICKED CATEGORY BUTTON at (${buttonX}, ${buttonY})`);
    // console.log(`🔍 DEBUG: currentAnchor = "${currentAnchor}", screenX = ${screenX}, screenY = ${screenY}`);
    
    // Calculate the correct direction based on the current anchor
    // Submenus should spread AWAY from the screen edge where the anchor is
    let buttonAngle;
    switch (currentAnchor) {
      case 'top':
        // Top anchor: submenus should spread DOWN (away from top edge)
        buttonAngle = 3 * Math.PI / 2; // 270° = down
        break;
      case 'bottom':
        // Bottom anchor: submenus should spread UP (away from bottom edge)
        buttonAngle = Math.PI / 2; // 90° = up
        break;
      case 'left':
        // Left anchor: submenus should spread RIGHT (away from left edge)
        buttonAngle = 0; // 0° = right
        break;
      case 'right':
        // Right anchor: submenus should spread LEFT (away from right edge)
        buttonAngle = Math.PI; // 180° = left
        break;
      default:
        // Fallback to bottom behavior
        buttonAngle = Math.PI / 2; // 90° = up
        break;
    }
    
    // console.log(`🔍 Using anchor-based angle: ${buttonAngle} (${currentAnchor} anchor)`);
    
    // Spread submenu items in an arc around the button-to-center direction
    const arcSpread = Math.PI / 3; // 60 degrees total spread
    const startAngle = buttonAngle - arcSpread / 2;
    const endAngle = buttonAngle + arcSpread / 2;
    
    // console.log(`🔍 Arc spread: ${arcSpread}, Start: ${startAngle}, End: ${endAngle}`);
    
    // Only position submenu items, keep main menu items in their original positions
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    
    submenuItems.forEach((item, index) => {
      if (!item.mesh) return;
      
      // Calculate angle for this item
      let angle;
      if (submenuItems.length === 1) {
        // Single item - place it directly in the center of the arc
        angle = (startAngle + endAngle) / 2;
      } else {
        // Multiple items - spread them across the arc
        const angleStep = (endAngle - startAngle) / (submenuItems.length - 1);
        angle = startAngle + (index * angleStep);
      }
      
      // console.log(`🔍 Submenu item ${index}: angle=${angle} (${submenuItems.length} items)`);
      
      // Validate angle
      if (isNaN(angle)) {
        console.warn(`⚠️ Invalid angle for submenu item ${index}: ${angle}`);
        return;
      }
      
      // Calculate position in 3D world space relative to the clicked button
      const radius = item.radius || 1.5; // Use item's radius, fallback to 1.5
      const itemX = Math.cos(angle) * radius;
      const itemY = Math.sin(angle) * radius;
      const itemZ = 0; // Keep items in the same plane
      
      // console.log(`🔍 Submenu item ${index}: calculated position (${itemX}, ${itemY}, ${itemZ})`);
      
      // Position the item in 3D space relative to the radial menu position
      item.mesh.position.set(itemX, itemY, itemZ);
      item.mesh.scaling.setAll(0.01); // Start very small
      
      // Animate scale growing out with bounce
      const scaleAnimation = new BABYLON.Animation(
        `submenuGrow${index}`,
        "scaling",
        60, // 60 fps
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      const keyFrames = [];
      keyFrames.push({ frame: 0, value: new BABYLON.Vector3(0.01, 0.01, 0.01) });
      keyFrames.push({ frame: 30, value: new BABYLON.Vector3(1.2, 1.2, 1.2) }); // Bounce
      keyFrames.push({ frame: 60, value: new BABYLON.Vector3(1, 1, 1) }); // Settle
      
      scaleAnimation.setKeys(keyFrames);
      
      // Add easing for smooth bounce
      const easingFunction = new BABYLON.CubicEase();
      easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
      scaleAnimation.setEasingFunction(easingFunction);
      
      item.mesh.animations = [scaleAnimation];
      hud.scene.beginAnimation(item.mesh, 0, 60, false);
      
      // console.log(`📍 Submenu item "${item.text}" positioned at 3D world (${itemX.toFixed(2)}, ${itemY.toFixed(2)}, ${itemZ.toFixed(2)}) relative to clicked button`);
    });
  }
  
  // Position items in an arc (like the main menu)
  function positionItemsInArc(screenX, screenY) {
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
      
      const keyFrames = [];
      keyFrames.push({ frame: 0, value: new BABYLON.Vector3(0.01, 0.01, 0.01) });
      keyFrames.push({ frame: 30, value: new BABYLON.Vector3(1.2, 1.2, 1.2) }); // Bounce
      keyFrames.push({ frame: 60, value: new BABYLON.Vector3(1, 1, 1) }); // Settle
      
      scaleAnimation.setKeys(keyFrames);
      
      // Add easing for smooth bounce
      const easingFunction = new BABYLON.CubicEase();
      easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
      scaleAnimation.setEasingFunction(easingFunction);
      
      item.mesh.animations = [scaleAnimation];
      hud.scene.beginAnimation(item.mesh, 0, 60, false);
    });
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
    // Use the unified positioning function for all items
    radialMenuItems.forEach((item, index) => {
      if (item.mesh) {
        // Use the same positioning logic as main menu items
        const position = calculateMenuItemPosition(item);
        item.mesh.position.copyFrom(position);
        // console.log(`📍 Positioned ${item.text} at angle ${item.angle.toFixed(1)}° (${position.x.toFixed(2)}, 0, ${position.z.toFixed(2)}) - radius: ${item.radius} - plane: Y=0`);
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
      // console.log('🔄 Returning to main menu');
      returnToMainMenu(screenX, screenY);
      return;
    }
    
    // Restore previous menu level
    const previous = menuStack.pop();
    currentMenuLevel = previous.level;
    
    // Clear only submenu items, keep main menu items
    clearSubmenuItems();
    
    // If going back to main menu, we don't need to restore items
    if (currentMenuLevel === 'main') {
      console.log('🔄 Back to main menu - main menu items should already be visible');
    } else {
      // Restore previous menu items
      radialMenuItems = previous.items;
    }
    
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
    
    // console.log('🔄 Returned to menu level:', currentMenuLevel);
  };
  
  // Return to main menu - STABLE SYSTEM
  function returnToMainMenu(screenX, screenY) {
    // console.log('🏠 Returning to main menu with 4 main categories');
    
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
    
    // console.log('✅ Main menu restored with 4 main categories');
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
  
  // Calculate position for menu items (unified for main menu and submenu)
  function calculateMenuItemPosition(item) {
    const radians = (item.angle * Math.PI) / 180;
    const x = Math.sin(radians) * item.radius;
    const z = Math.cos(radians) * item.radius;
    
    // console.log(`🔍 calculateMenuItemPosition: "${item.text}" angle=${item.angle}°, radius=${item.radius}, pos=(${x.toFixed(2)}, ${z.toFixed(2)})`);
    
    // All items sit on the same Y=0 plane
    return new BABYLON.Vector3(x, 0, z);
  }
  
  // Calculate position for main menu items (legacy function for compatibility)
  function calculateMainItemPosition(item, screenX, screenY) {
    const position = calculateMenuItemPosition(item);
    // console.log(`📍 Main menu item "${item.text}" positioned at (${position.x.toFixed(2)}, 0, ${position.z.toFixed(2)}) - radius: ${item.radius} - plane: Y=0`);
    return position;
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
      // No back button needed
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
    // console.log('🏠 Initializing main menu with 4 main categories');
    
    // Clear any existing submenu items to ensure clean main menu
    clearSubmenuItems();
    
    // Reset to main menu level
    currentMenuLevel = 'main';
    
    // If no main menu items exist, create them
    if (radialMenuItems.length === 0) {
      // console.log('🎮 Creating main menu items...');
      
      // Create main menu items in same order as 2D menu: buildings, units, research, rally
      hud.addRadialMenuItem("Buildings", "🏗️", () => hud.showSubMenu("buildings"), new BABYLON.Color3(0, 1, 0)); // Green
      
      hud.addRadialMenuItem("Units", "👥", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("units");
      }, new BABYLON.Color3(0.2, 0.6, 1)); // Blue
      
      hud.addRadialMenuItem("Research", "🔬", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("research");
      }, new BABYLON.Color3(1, 1, 0)); // Yellow
      
      hud.addRadialMenuItem("Rally", "🚩", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("rally");
      }, new BABYLON.Color3(1, 0, 0)); // Red
    }
    
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
        
        // console.log(`📍 Main menu item "${item.text}" positioned at (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`);
      }
    });
    
    // console.log('✅ Main menu initialized with', radialMenuItems.filter(item => !item.isSubItem).length, 'main categories');
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
    const currentIndex = radialMenuItems.length; // Index of current item being added
    
    // Get the current anchor direction to determine starting angle
    const anchorDirection = getAnchorDirection();
    const baseAngle = calculateBaseAngleForAnchor(anchorDirection);
    
    // Spread items across 180° arc, starting from anchor direction
    // Use the same order as 2D menu: buildings, units, research, rally
    const angleSpread = 180;
    const angleStep = angleSpread / (Math.max(totalItems, 4) - 1);
    
    // Map the order to match 2D menu bottom anchor: rally=0, buildings=1, units=2, research=3
    let orderIndex = currentIndex;
    if (text === "Rally") orderIndex = 0;
    else if (text === "Buildings") orderIndex = 1;
    else if (text === "Units") orderIndex = 2;
    else if (text === "Research") orderIndex = 3;
    
    const angle = baseAngle + (orderIndex * angleStep) - (angleSpread / 2);
    
    // Use larger radius for submenu items to avoid center overlap
    const isSubmenu = currentMenuLevel !== 'main';
    const radius = isSubmenu ? menuConfig.itemRadius * 0.8 : menuConfig.itemRadius * 0.3; // Median distance for main menu
    
    // console.log(`🎯 Item "${text}": isSubmenu=${isSubmenu}, radius=${radius}, baseRadius=${menuConfig.itemRadius}`);
    
    // Make both main menu and submenu items smaller
    const scale = isSubmenu ? 0.7 : 0.5;
    
    // console.log(`🎯 Adding menu item "${text}" at angle ${angle.toFixed(1)}° (anchor: ${anchorDirection}, base: ${baseAngle}°, radius: ${radius}, submenu: ${isSubmenu})`);
    
    const item = {
      text: text,
      icon: icon,
      callback: callback,
      color: color || new BABYLON.Color3(0.8, 0.4, 0.1), // Default orange
      angle: angle,
      radius: radius,
      scale: scale,
      isSubItem: isSubmenu, // Mark as submenu item if not in main menu
      mesh: null
    };
    
    radialMenuItems.push(item);
    
    // Create 3D mesh for this item
    createMenuItemMesh(item);
  };
  
  // Create 3D mesh for a menu item
  function createMenuItemMesh(item) {
    if (!hud.scene || !radialMenu) return;
    
    // Create a simple box for the menu item with proper scaling
    const baseSize = 0.4;
    const finalSize = item.scale ? baseSize * item.scale : baseSize;
    const mesh = BABYLON.MeshBuilder.CreateBox(`menuItem_${item.text}`, {size: finalSize}, hud.scene);
    
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
        
        // console.log(`🎯 Menu item "${item.text}" clicked - executing callback`);
        
        if (item.callback) {
          // Exit building placement mode if currently placing (for non-building items)
          if (window.buildingSystem && window.buildingSystem.isPlacing && !item.text.toLowerCase().includes('building')) {
            window.buildingSystem.cancelPlacement();
          }
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
    // console.log("🗺️ Initializing minimap system...");
    
    // Create 3D container for minimap indicators (like radial menu)
    minimapContainer = new BABYLON.TransformNode("MinimapContainer", hud.scene);
    
    // Minimap will be updated from main render loop after camera lerp
    // console.log("✅ Minimap will update after camera positioning");
    
    // console.log("✅ Minimap system ready");
  }
  
  // Update resource display in the UI
  function updateResourceDisplay() {
    if (!window.player || !window.player.getResources) return;
    
    const resources = window.player.getResources();
    
    // Update food display
    const foodElement = document.getElementById('stat_food');
    if (foodElement) {
      foodElement.textContent = `🍎 ${resources.food || 0}`;
    }
    
    // Update wood display
    const woodElement = document.getElementById('stat_wood');
    if (woodElement) {
      woodElement.textContent = `🪵 ${resources.wood || 0}`;
    }
    
    // Update stone display
    const stoneElement = document.getElementById('stat_stone');
    if (stoneElement) {
      stoneElement.textContent = `🪨 ${resources.stone || 0}`;
    }
    
    // Update minerals display (using magic as minerals for now)
    const mineralsElement = document.getElementById('stat_minerals');
    if (mineralsElement) {
      mineralsElement.textContent = `💎 ${resources.magic || 0}`;
    }
    
    // Update population display (count of player units)
    const popElement = document.getElementById('stat_pop');
    if (popElement && window.player.units) {
      const population = window.player.units.length;
      popElement.textContent = `👥 ${population}`;
    }
  }

  // Store active groups for position-only updates
  let activeGroups = new Map();
  
  // Update minimap indicators - group by type and direction
  function updateMinimap(fullUpdate = true) {
    if (!hud.camera || !window.player || !window.player.units) return;
    
    // FAST PATH: Smoothly interpolate existing indicators toward their targets (every frame)
    if (!fullUpdate) {
      minimapIndicators.forEach(indicator => {
        if (indicator && indicator.targetPosition && indicator.isEnabled()) {
          // Smooth lerp toward target position (0.3 = smooth but responsive)
          indicator.position = BABYLON.Vector3.Lerp(indicator.position, indicator.targetPosition, 0.3);
        }
      });
      return;
    }
    
    // SLOW PATH: Recalculate groups and frustum checks (every 5 frames)
    // Group off-screen units by type and direction (continuous spread from corners)
    const groups = new Map(); // Key: "type_direction", Value: {type, direction, units[], position}
    
    // Process each player unit
    window.player.units.forEach((unit) => {
      if (!unit.mesh || !unit.pb.state.loc) return;
      
      const unitWorldPos = new BABYLON.Vector3(
        unit.pb.state.loc.x,
        unit.pb.state.loc.y,
        unit.pb.state.loc.z
      );
      
      // Check if unit is visible in camera frustum
      if (!isUnitInFrustum(unitWorldPos)) {
        // Determine which edge (for grouping) but keep precise position
        const toUnit = unitWorldPos.subtract(window.gfx.cameraTarget?.position || hud.camera.position).normalize();
        const cameraForward = hud.camera.getForwardRay().direction.normalize();
        const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
        const cameraUp = BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize();
        const rightDot = -BABYLON.Vector3.Dot(toUnit, cameraRight);
        const upDot = BABYLON.Vector3.Dot(toUnit, cameraUp);
        
        // Map to nearest corner (corners are primary positions)
        // Find which corner this direction is closest to
        let cornerX = rightDot > 0 ? 'r' : 'l'; // right or left
        let cornerY = upDot > 0 ? 't' : 'b'; // top or bottom
        let corner = `corner-${cornerY}${cornerX}`;
        
        // Determine which edge we're on based on which direction is MORE extreme
        // Compare the raw absolute dot products - higher = more extreme in that direction
        const absRight = Math.abs(rightDot);
        const absUp = Math.abs(upDot);
        const totalMag = absRight + absUp;
        
        // Normalize to 0-1 scale
        const rightNorm = absRight / totalMag; // 0 = pure vertical, 1 = pure horizontal
        const upNorm = absUp / totalMag;       // 0 = pure horizontal, 1 = pure vertical
        
        // At 45° corner: both are 0.5
        // At cardinal edge: one is ~1, other is ~0
        // Add deadzone around 0.5 to lock to corners
        const cornerThreshold = 0.35; // Lock to corner if both are between 0.35-0.65
        
        let edgeSpread, spreadDir;
        if (rightNorm > cornerThreshold && rightNorm < (1 - cornerThreshold) &&
            upNorm > cornerThreshold && upNorm < (1 - cornerThreshold)) {
          // Near 45° diagonal - lock to corner
          // Pick a consistent spread direction (doesn't matter since spread=0)
          spreadDir = rightNorm > upNorm ? 'v' : 'h';
          edgeSpread = 0;
          corner = `${corner}_${spreadDir}0`;
        } else if (rightNorm > upNorm) {
          // More horizontal = on LEFT/RIGHT edge, spread VERTICALLY along that edge
          spreadDir = 'v';
          // Remap: 0.65 -> 0, 1.0 -> 1
          edgeSpread = Math.max(0, (rightNorm - (1 - cornerThreshold)) / cornerThreshold);
          const bucket = Math.round(edgeSpread * 20);
          corner = `${corner}_v${bucket}`;
        } else {
          // More vertical = on TOP/BOTTOM edge, spread HORIZONTALLY along that edge
          spreadDir = 'h';
          // Remap: 0.65 -> 0, 1.0 -> 1
          edgeSpread = Math.max(0, (upNorm - (1 - cornerThreshold)) / cornerThreshold);
          const bucket = Math.round(edgeSpread * 20);
          corner = `${corner}_h${bucket}`;
        }
        
        // Group by type AND corner spread position
        const groupKey = `${unit.type}_${corner}`;
        
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            type: unit.type,
            position: corner,
            cornerX: cornerX,
            cornerY: cornerY,
            edgeSpread: edgeSpread,
            units: [],
            avgPosition: unitWorldPos.clone()
          });
        }
        
        const group = groups.get(groupKey);
        group.units.push(unit);
        // Update average position and spread (proper averaging)
        const count = group.units.length;
        group.avgPosition = group.avgPosition.scale((count - 1) / count).add(unitWorldPos.scale(1 / count));
        // Average the continuous spread value too for smooth positioning
        group.edgeSpread = (group.edgeSpread * (count - 1) + edgeSpread) / count;
      }
    });
    
    // Create/update indicators for each group
    let indicatorIndex = 0;
    for (const [groupKey, group] of groups) {
      updateGroupIndicator(group, indicatorIndex);
      indicatorIndex++;
    }
    
    // Store groups for fast position-only updates
    activeGroups = groups;
    
    // Hide any extra indicators we're not using
    for (let i = indicatorIndex; i < minimapIndicators.length; i++) {
      if (minimapIndicators[i]) {
        minimapIndicators[i].setEnabled(false);
        // Hide count badge if it exists
        if (minimapIndicators[i].countBadge) {
          minimapIndicators[i].countBadge.setEnabled(false);
        }
      }
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
  
  // Get compass direction from camera to unit (N, NE, E, SE, S, SW, W, NW)
  function getCompassDirection(unitWorldPos) {
    const currentCameraPos = window.gfx && window.gfx.cameraTarget 
      ? window.gfx.cameraTarget.position 
      : hud.camera.position;
    const toUnit = unitWorldPos.subtract(currentCameraPos).normalize();
    const cameraForward = hud.camera.getForwardRay().direction.normalize();
    const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
    
    const rightDot = -BABYLON.Vector3.Dot(toUnit, cameraRight);
    const upDot = BABYLON.Vector3.Dot(toUnit, BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize());
    
    // 8-way compass directions
    const angle = Math.atan2(rightDot, upDot);
    const octant = Math.round(8 * angle / (2 * Math.PI) + 8) % 8;
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[octant];
  }
  
  // Update or create a group indicator using actual unit model
  function updateGroupIndicator(group, index) {
    const rect = hud.canvas.getBoundingClientRect();
    
    // Use cameraTarget position if available for instant tracking, otherwise use camera position
    const currentCameraPos = window.gfx && window.gfx.cameraTarget 
      ? window.gfx.cameraTarget.position 
      : hud.camera.position;
    const toUnit = group.avgPosition.subtract(currentCameraPos).normalize();
    const cameraForward = hud.camera.getForwardRay().direction.normalize();
    const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
    const cameraUp = BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize();
    
    // Project unit direction onto current camera plane
    const rightDot = -BABYLON.Vector3.Dot(toUnit, cameraRight); // Flip to correct left/right
    const upDot = BABYLON.Vector3.Dot(toUnit, cameraUp);
    
    const unitCount = group.units.length;
    const hasSelection = group.units.some(u => window.player && window.player.isUnitSelected(u));
    
    // Position based on corner with spread
    let edgePos;
    const buffer = 30; // Fixed pixel distance from screen edge
    
    // Parse position to get corner and spread direction
    const positionMatch = group.position.match(/corner-([tb])([lr])_([vh])(\d+)/);
    if (!positionMatch) {
      // Fallback to simple corner
      const simpleMatch = group.position.match(/corner-([tb])([lr])/);
      if (!simpleMatch) return;
      const [, cornerY, cornerX] = simpleMatch;
      const spreadDir = 'v';
    } else {
      var [, cornerY, cornerX, spreadDir] = positionMatch;
    }
    
    // Use the continuous spread value from the group (0-1) for smooth positioning
    const spreadFactor = group.edgeSpread; // Already 0-1 continuous value
    
    // Start at the corner
    let baseX = cornerX === 'r' ? rect.width - buffer : buffer;
    let baseY = cornerY === 't' ? buffer : rect.height - buffer;
    if (spreadDir === 'h') {
      // Spread horizontally from corner to middle of edge
      const targetX = rect.width / 2; // Move toward center
      baseX = baseX + (targetX - baseX) * spreadFactor; // Full spread to middle
    } else {
      // Spread vertically from corner to middle of edge
      const targetY = rect.height / 2; // Move toward center
      baseY = baseY + (targetY - baseY) * spreadFactor; // Full spread to middle
    }
    
    edgePos = { x: baseX, y: baseY };
    
    // Calculate rotation values for tilt
    const clampedRightDot = cornerX === 'r' ? 1 : -1;
    const clampedUpDot = cornerY === 't' ? 1 : -1;
    
    // Calculate position in camera-local space (since indicators are parented to camera)
    const ray = hud.scene.createPickingRay(edgePos.x, edgePos.y, BABYLON.Matrix.Identity(), hud.camera);
    const worldPos = ray.origin.add(ray.direction.scale(menuConfig.distance)); // Same distance as radial menu
    
    // Convert world position to camera-local coordinates using inverse camera matrix
    const cameraMatrix = hud.camera.getWorldMatrix();
    const inverseCameraMatrix = BABYLON.Matrix.Invert(cameraMatrix);
    const localPos = BABYLON.Vector3.TransformCoordinates(worldPos, inverseCameraMatrix);
    
    // Reuse existing indicator or create new one
    let indicator;
    if (index < minimapIndicators.length && minimapIndicators[index]) {
      // Reuse existing indicator
      indicator = minimapIndicators[index];
      indicator.setEnabled(true);
      
      // Update the linked group reference
      indicator.linkedGroup = group;
    } else {
      // Create new indicator using actual unit model
      const unitType = window.UnitTypes[group.type];
      if (!unitType || !window.gfx) return;
      
      // Load the unit model asynchronously
      window.gfx.getModel(unitType.model, hud.scene).then(model => {
        indicator = model.root;
        indicator.name = `edgeIndicator_${index}`;
        indicator.scaling = new BABYLON.Vector3(0.15, 0.15, 0.15); // Smaller for edge indicators
        indicator.isPickable = true;
        indicator.linkedGroup = group;
        
        // Parent to camera so they move automatically!
        indicator.parent = hud.camera;
        
        // Don't use billboard - we'll manually rotate them to face screen center
        
        // Make it glow/stand out
        indicator.getChildMeshes().forEach(mesh => {
          if (mesh.material) {
            mesh.material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);
          }
          // Ensure child meshes are pickable too
          mesh.isPickable = true;
        });
        
        // Add selection ring (like units have)
        const ring = BABYLON.MeshBuilder.CreateTorus(`selectionRing_${index}`, {
          diameter: 0.3,
          thickness: 0.02,
          tessellation: 16
        }, hud.scene);
        const ringMat = new BABYLON.StandardMaterial(`ringMat_${index}`, hud.scene);
        ringMat.emissiveColor = new BABYLON.Color3(0, 1, 0);
        ringMat.disableLighting = true;
        ring.material = ringMat;
        ring.rotation.x = Math.PI / 2; // Lay flat
        ring.position.y = -0.05; // Just below unit
        ring.parent = indicator;
        ring.setEnabled(false); // Hidden by default
        ring.isPickable = false; // Don't block clicks to parent
        indicator.selectionRing = ring;
        
        minimapIndicators[index] = indicator;
      }).catch(err => {
        console.warn(`Failed to load edge indicator model for ${group.type}:`, err);
      });
      return; // Skip rest of update until model loads
    }
    
    // Update visual based on selection status
    if (hasSelection) {
      // Has selected units: bright yellow glow + show ring
      indicator.getChildMeshes().forEach(mesh => {
        if (mesh.material && mesh.material.emissiveColor) {
          mesh.material.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
        }
      });
      indicator.scaling = new BABYLON.Vector3(0.2, 0.2, 0.2); // Slightly bigger when selected
      
      // Show yellow selection ring
      if (indicator.selectionRing) {
        indicator.selectionRing.setEnabled(true);
        indicator.selectionRing.material.emissiveColor = new BABYLON.Color3(1, 1, 0);
      }
    } else {
      // Normal green glow + hide ring
      indicator.getChildMeshes().forEach(mesh => {
        if (mesh.material && mesh.material.emissiveColor) {
          mesh.material.emissiveColor = new BABYLON.Color3(0, 0.8, 0);
        }
      });
      indicator.scaling = new BABYLON.Vector3(0.15, 0.15, 0.15); // Normal size
      
      // Hide selection ring
      if (indicator.selectionRing) {
        indicator.selectionRing.setEnabled(false);
      }
    }
    
    // Smoothly interpolate to new position (lerp for smooth movement)
    if (!indicator.targetPosition) {
      indicator.targetPosition = localPos.clone();
      indicator.position.copyFrom(localPos);
    } else {
      indicator.targetPosition.copyFrom(localPos);
    }
    
    // Simple rotation based on which edge they're on
    // Reset rotation first
    indicator.rotation = BABYLON.Vector3.Zero();
    
    // Face toward camera origin (they're parented to camera, so face "backward" toward 0,0,0)
    indicator.rotation.y = Math.atan2(localPos.x, localPos.z) + Math.PI; // +PI to face inward
    
    // Tilt based on position along edge from corner
    // Interpolate rotation between corner angle and edge angle
    // (spreadFactor is continuous 0-1 value from group.edgeSpread)
    
    // Determine corner base angle (45° diagonals)
    let cornerAngle;
    if (cornerX === 'r' && cornerY === 't') cornerAngle = -Math.PI * 3/4; // TR
    else if (cornerX === 'l' && cornerY === 't') cornerAngle = Math.PI * 3/4; // TL
    else if (cornerX === 'r' && cornerY === 'b') cornerAngle = -Math.PI / 4; // BR
    else cornerAngle = Math.PI / 4; // BL
    
    // Determine target edge angle (90° cardinals)
    let edgeAngle;
    if (spreadDir === 'h') {
      // Spreading horizontally - target top or bottom edge
      edgeAngle = cornerY === 't' ? Math.PI : 0; // Top or bottom
    } else {
      // Spreading vertically - target left or right edge
      edgeAngle = cornerX === 'r' ? -Math.PI / 2 : Math.PI / 2; // Right or left
    }
    
    // Interpolate between corner and edge angle
    // Normalize the angle difference to take shortest path (fixes gimbal lock at top-right)
    let angleDiff = edgeAngle - cornerAngle;
    // Wrap to -π to π range
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    indicator.rotation.z = cornerAngle + angleDiff * spreadFactor;
    
    // Add/update count badge if group has multiple units
    if (unitCount > 1) {
      if (!indicator.countBadge) {
        // Create count badge (text plane)
        const plane = BABYLON.MeshBuilder.CreatePlane(`countBadge_${index}`, {size: 0.2}, hud.scene);
        const badgeMat = new BABYLON.StandardMaterial(`badgeMat_${index}`, hud.scene);
        badgeMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        badgeMat.emissiveColor = new BABYLON.Color3(1, 1, 0);
        badgeMat.disableLighting = true;
        
        // Create dynamic texture for the number
        const texture = new BABYLON.DynamicTexture(`badgeTexture_${index}`, 64, hud.scene);
        badgeMat.diffuseTexture = texture;
        badgeMat.opacityTexture = texture;
        plane.material = badgeMat;
        
        plane.parent = indicator;
        plane.position.y = 0.3; // Above unit model
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera
        
        indicator.countBadge = plane;
        indicator.badgeTexture = texture;
      }
      
      // Update badge text
      const texture = indicator.badgeTexture;
      texture.clear();
      const ctx = texture.getContext();
      ctx.font = "bold 48px Arial";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(unitCount.toString(), 32, 32);
      texture.update();
      indicator.countBadge.setEnabled(true);
    } else if (indicator.countBadge) {
      indicator.countBadge.setEnabled(false);
    }
    
    // Add/update click functionality to select the group
    if (!indicator.actionManager) {
      indicator.actionManager = new BABYLON.ActionManager(hud.scene);
    }
    
    // Clear old actions and re-register (in case linkedGroup changed)
    indicator.actionManager.actions = [];
    
    // CLICK - Select all units in the group
    indicator.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPickTrigger,
      function(evt) {
        const linkedGroup = indicator.linkedGroup;
        if (!linkedGroup || !window.player) return;
        
        console.log(`🎯 Edge indicator clicked! Selecting ${linkedGroup.units.length} ${linkedGroup.type}(s)`);
        
        // Select all units in this group
        window.player.clearSelection();
        linkedGroup.units.forEach(unit => {
          window.player.selectUnit(unit);
        });
        
        // Prevent click from propagating to terrain/radial menu
        evt.skipNextObservers = true;
      }
    ));
  }
  
  // Clear all minimap indicators
  function clearMinimapIndicators() {
    minimapIndicators.forEach(indicator => {
      if (indicator) {
        // Dispose selection ring if it exists
        if (indicator.selectionRing) {
          indicator.selectionRing.dispose();
        }
        // Dispose count badge if it exists
        if (indicator.countBadge) {
          indicator.countBadge.dispose();
        }
        if (indicator.badgeTexture) {
          indicator.badgeTexture.dispose();
        }
        indicator.dispose();
      }
    });
    minimapIndicators = [];
  }

  // Expose minimap update function
  hud.updateMinimap = updateMinimap;
  
  // Expose resource display update function
  hud.updateResourceDisplay = updateResourceDisplay;
  
  // Expose radialMenu for external access
  hud.radialMenu = radialMenu;
  
  // ===== HUD MODE SELECTION =====
  
  // Toggle shadows on/off
  hud.toggleShadowsMode = function() {
    const switchElement = document.getElementById('shadows_switch');
    const handle = document.getElementById('shadows_handle');
    const isOn = switchElement.dataset.on === 'true';
    
    if (isOn) {
      // Turn shadows off (left position)
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      
      // Disable shadows
      window.SHADOWS_ENABLED = false;
      
      // Update all meshes to not receive shadows
      if (window.gfx && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // Save preference
      localStorage.setItem('shadowsEnabled', 'false');
      // console.log('Shadows disabled');
    } else {
      // Turn shadows on (right position)
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      
      // Enable shadows
      window.SHADOWS_ENABLED = true;
      
      // Initialize shadow generator if it doesn't exist
      if (window.gfx && window.gfx.autoInitializeShadows) {
        window.gfx.autoInitializeShadows();
      }
      
      // Update all meshes to receive shadows
      if (window.gfx && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // Save preference
      localStorage.setItem('shadowsEnabled', 'true');
    }
  };
  
  // Initialize LOD slider (requires DOM elements to exist)
  hud.initLODSlider = function() {
    const slider = document.getElementById('lod_slider');
    const valueDisplay = document.getElementById('lod_value');
    
    // console.log('🎚️ Initializing LOD slider:', { slider: !!slider, valueDisplay: !!valueDisplay });
    
    if (!slider || !valueDisplay) {
      // console.warn('🎚️ LOD slider elements not found, will sync when settings menu opens');
      return;
    }
    
    // Load saved LOD setting or use default
    const savedLOD = localStorage.getItem('lodLevel');
    const initialValue = savedLOD ? parseInt(savedLOD) : 50;
    slider.value = initialValue;
    valueDisplay.textContent = initialValue + '%';
    
    // Apply LOD setting (this also happens at startup via applySavedLODSetting)
    hud.updateLODDistances(initialValue);
    
    // Add event listener for slider changes
    slider.addEventListener('input', function() {
      const value = parseInt(this.value);
      // console.log('🎚️ LOD slider changed to:', value);
      valueDisplay.textContent = value + '%';
      
      // Update LOD distances
      hud.updateLODDistances(value);
      
      // Save setting
      localStorage.setItem('lodLevel', value.toString());
      
      // Update slider background color
      hud.updateSliderColor(slider, value);
    });
    
    // Add change event listener for when user releases mouse
    slider.addEventListener('change', function() {
      const value = parseInt(this.value);
      // Ensure the final value is properly saved
      localStorage.setItem('lodLevel', value.toString());
    });
    

    // Set initial color
    hud.updateSliderColor(slider, initialValue);
  };
  
  // Get current LOD multiplier for new models
  hud.getCurrentLODMultiplier = function() {
    const savedLOD = localStorage.getItem('lodLevel');
    const level = savedLOD ? parseInt(savedLOD) : 50;
    return 0.3 + (level / 100) * 1.4; // Range from 0.3x to 1.7x
  };

  // Update LOD distances based on slider value (0-100)
  hud.updateLODDistances = function(value) {
    // Level 0 = minimum LOD (very close distances)
    // Level 50 = default LOD (current distances)
    // Level 100 = maximum LOD (very far distances)
    
    const multiplier = 0.3 + (value / 100) * 1.4; // Range from 0.3x to 1.7x
    
    // Update unit LOD distances
    if (window.LOD_DISTANCES) {
      window.LOD_DISTANCES.NEAR = Math.round(150 * multiplier);
      window.LOD_DISTANCES.FAR = Math.round(450 * multiplier);
      window.LOD_DISTANCES.HIDDEN = Math.round(600 * multiplier);
    }
    
    // Update flying unit LOD distances
    if (window.FLYING_LOD_DISTANCES) {
      window.FLYING_LOD_DISTANCES.NEAR = Math.round(300 * multiplier);
      window.FLYING_LOD_DISTANCES.FAR = Math.round(900 * multiplier);
      window.FLYING_LOD_DISTANCES.HIDDEN = Math.round(1200 * multiplier);
    }
    
    // Update graphics LOD distances if they exist
    if (window.gfx && window.gfx.updateLODDistances) {
      window.gfx.updateLODDistances(multiplier);
    }
    
    // NEW: Reconfigure shadows based on new LOD level
    if (window.gfx && window.gfx.onLODDistanceUpdate) {
      window.gfx.onLODDistanceUpdate(value);
    }
    
    // Log for debugging (can remove later)
    // console.log(`🎚️ LOD updated to ${value}% (multiplier: ${multiplier.toFixed(2)})`);
  };
  
  // Update slider background color based on value
  hud.updateSliderColor = function(slider, value) {
    // Remove existing color classes
    slider.classList.remove('lod-low', 'lod-medium-low', 'lod-medium', 'lod-medium-high', 'lod-high');
    
    // Add appropriate color class
    if (value <= 20) {
      slider.classList.add('lod-low');
    } else if (value <= 40) {
      slider.classList.add('lod-medium-low');
    } else if (value <= 60) {
      slider.classList.add('lod-medium');
    } else if (value <= 80) {
      slider.classList.add('lod-medium-high');
    } else {
      slider.classList.add('lod-high');
    }
  };

  // Toggle between 2D and 3D HUD modes
  hud.toggleHUDMode = function() {
    const switchElement = document.getElementById('hud_switch');
    const handle = document.getElementById('hud_handle');
    const isOn = switchElement.dataset.on === 'true';
    
    if (isOn) {
      // Switch to 2D HUD (left position)
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      
      // Update HUD constants
      window.USE_3D_HUD = false;
      
      // Reinitialize lasso for new mode
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
      }
      
      // Save preference
      localStorage.setItem('hudMode', '2d');
      // console.log('Switched to 2D HUD - Value:', {
      //   USE_3D_HUD: window.USE_3D_HUD
      // });
    } else {
      // Switch to 3D HUD (right position)
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      
      // Update HUD constants
      window.USE_3D_HUD = true;
      
      // Reinitialize lasso for new mode
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
      }
      
      // Save preference
      localStorage.setItem('hudMode', '3d');
      // console.log('Switched to 3D HUD - Value:', {
      //   USE_3D_HUD: window.USE_3D_HUD
      // });
    }
  };
  
  // Initialize HUD mode from saved preference or default
  hud.initializeHUDMode = function() {
    const savedMode = localStorage.getItem('hudMode');
    const switchElement = document.getElementById('hud_switch');
    const handle = document.getElementById('hud_handle');
    
    if (savedMode === '3d') {
      // Set to 3D HUD
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      
      window.USE_3D_HUD = true;
      
      // Reinitialize lasso for new mode
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
      }
      
      // console.log('Initialized to 3D HUD - Value:', {
      //   USE_3D_HUD: window.USE_3D_HUD
      // });
    } else {
      // Default to 2D HUD
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      
      window.USE_3D_HUD = false;
      
      // Reinitialize lasso for new mode
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
      }
      
      // console.log('Initialized to 2D HUD - Value:', {
      //   USE_3D_HUD: window.USE_3D_HUD
      // });
    }
  };
  
  // Initialize shadows mode from saved preference or default
  hud.initializeShadowsMode = function() {
    const savedShadows = localStorage.getItem('shadowsEnabled');
    const switchElement = document.getElementById('shadows_switch');
    const handle = document.getElementById('shadows_handle');
    
    if (savedShadows === 'true') {
      // Set to shadows on
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      
      window.SHADOWS_ENABLED = true;
      
      // Initialize shadow generator if it doesn't exist
      if (window.gfx && window.gfx.autoInitializeShadows) {
        window.gfx.autoInitializeShadows();
      }
      
      // Update all meshes to receive shadows
      if (window.gfx && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // console.log('Initialized to shadows ON');
    } else {
      // Default to shadows off
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      
      window.SHADOWS_ENABLED = false;
      
      // Update all meshes to not receive shadows
      if (window.gfx && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // console.log('Initialized to shadows OFF');
    }
  };
  
  // ===== BUILDING SYSTEM =====
  
  // Building system state
  let buildingMode = false;
  let currentBuildingType = null;
  let buildingPreview = null;
  
  // Initialize building system
  function initBuildingSystem() {
    // console.log('🏗️ Building system initialized');
  }
  
  // Start building placement mode - DREAM SYSTEM
  hud.startBuildingPlacement = function(buildingType) {
    // console.log(`🏗️ Starting building placement for: ${buildingType}`);
    buildingMode = true;
    currentBuildingType = buildingType;
    
    if (buildingType === 'camp') {
      // console.log('⛺ Camp placement mode activated! Click to place your camp.');
      
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
      // console.warn('Buildings button not found for camp expansion');
      return;
    }
    
    // Get the anchor direction from the current menu position
    const anchorDirection = getAnchorDirection();
    // console.log('🏗️ Expanding camp from Buildings button at angle:', buildingsButton.angle, 'Anchor direction:', anchorDirection);
    
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
    // console.log('⛺ Camp placement mode activated! Click on terrain to place your camp.');
    
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
    // console.log(`⛺ Placing camp at position:`, position.toString());
    
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
    
    // console.log('✅ Camp placed successfully!');
    
    // You can add more camp logic here:
    // - Add to building list
    // - Trigger camp effects
    // - Spawn camp-related units
    // - etc.
  }
  
  // Cancel camp placement
  function cancelCampPlacement() {
    // console.log('❌ Camp placement cancelled');
    exitBuildingMode();
  }
  
  // Exit building mode and return to main menu
  function exitBuildingMode() {
    // console.log('🏗️ Exiting building mode');
    
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
    // console.log('📋 Click on terrain to place your camp. The camp will provide shelter and basic resources.');
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
