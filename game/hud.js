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
  let pendingModelLoads = new Set(); // Track pending async model loads to cancel if menu closes
  
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
              // Convert the first selected villager that isn't already being converted
              targetVillager = selectedVillagers.find(v => !v.isConverting);
            } else {
              // Find a villager near the agora that isn't already being converted
              const agoraBuilding = window.gameBuildings?.find(b => b.type === 'agora' && b.owner === normalizedPlayerId);
              if (agoraBuilding) {
                const agoraPos = { x: agoraBuilding.gridX * TILE_SIZE, z: agoraBuilding.gridZ * TILE_SIZE };
                
                // Filter out units that are already being converted, then sort by distance
                const availableVillagers = myVillagers.filter(v => !v.isConverting);
                availableVillagers.sort((a, b) => {
                  const distA = Math.sqrt(Math.pow(a.position.x - agoraPos.x, 2) + Math.pow(a.position.z - agoraPos.z, 2));
                  const distB = Math.sqrt(Math.pow(b.position.x - agoraPos.x, 2) + Math.pow(b.position.z - agoraPos.z, 2));
                  return distA - distB;
                });
                
                targetVillager = availableVillagers[0]; // Closest available villager
              } else {
                // No agora, just pick first available villager
                targetVillager = myVillagers.find(v => !v.isConverting);
              }
            }
            
            if (targetVillager) {
              // Mark as converting to prevent duplicate commands
              targetVillager.isConverting = true;
              
              window.currentMatch.submitCommand({
                type: 'convert',
                playerId: window.player.id,
                unitId: targetVillager.id,
                targetType: 'brigand'
              });
              
              // Clear the flag after a short delay (longer than typical command processing)
              setTimeout(() => {
                targetVillager.isConverting = false;
              }, 500);
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
        callback: () => {
          if (window.rallyUnitsToAgora) {
            window.rallyUnitsToAgora();
          } else {
            console.warn('❌ Rally function not available');
          }
        }
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
          const anchorMap3D = { 
            n: 'top', 
            s: 'bottom', 
            w: 'left',   // west anchor (left side) → left menu position
            e: 'right'   // east anchor (right side) → right menu position
          };
          const anchorName = anchorMap3D[closestAnchor] || 'bottom';
          
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
    // Middle mouse, spacebar, and B key all open the menu at closest anchor
    
    // Add spacebar and B key support - opens menu at closest anchor based on HUD mode
    document.addEventListener('keydown', function(e) {
      if (e.code === 'Space' || e.code === 'KeyB') {
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
          const anchorMap3D = { 
            n: 'top', 
            s: 'bottom', 
            w: 'left',   // west anchor (left side) → left menu position
            e: 'right'   // east anchor (right side) → right menu position
          };
          const anchorName = anchorMap3D[closestAnchor] || 'bottom';
          
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
    
    // Rotate 180° around Y to "turn around" - flip left/right
    radialMenu.rotation.y = Math.PI;
    
    // Don't use billboard mode when parented to camera - causes rotation issues
    // radialMenu.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    
    // Create center mesh - invisible click target FAR behind menu items
    const centerMesh = BABYLON.MeshBuilder.CreateSphere("radialCenter", {diameter: 0.01}, hud.scene);
    const centerMaterial = new BABYLON.StandardMaterial("centerMat", hud.scene);
    centerMaterial.alpha = 0; // Invisible
    centerMesh.material = centerMaterial;
    centerMesh.isVisible = false; // Completely invisible
    centerMesh.parent = radialMenu;
    
    // Position center mesh FAR BEHIND the menu items
    centerMesh.position.set(0, 0, -2.0);
    
    // Make center mesh pickable for click detection
    centerMesh.isPickable = true;
    
    // Render behind menu items
    centerMesh.renderingGroupId = 0;
    
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
      left: { x: rect.width * 0.1, y: rect.height / 2 },   // left menu at left position (10%)
      right: { x: rect.width * 0.9, y: rect.height / 2 }   // right menu at right position (90%)
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
    
    // Parent directly to camera like minimap does - no chasing!
    radialMenu.parent = hud.camera;
    
    // Calculate local position offset from camera
    const offsetFromCamera = menuPosition.subtract(hud.camera.position);
    const cameraForward = hud.camera.getForwardRay().direction.normalize();
    const cameraRight = BABYLON.Vector3.Cross(cameraForward, hud.camera.upVector).normalize();
    const cameraUp = BABYLON.Vector3.Cross(cameraRight, cameraForward).normalize();
    
    // Set local position in camera space
    const localForward = BABYLON.Vector3.Dot(offsetFromCamera, cameraForward);
    const localRight = BABYLON.Vector3.Dot(offsetFromCamera, cameraRight);
    const localUp = BABYLON.Vector3.Dot(offsetFromCamera, cameraUp);
    
    // Flip the right axis because ray picking inverts left/right
    radialMenu.position.set(-localRight, localUp, localForward);
    
    radialMenu.scaling.setAll(menuConfig.scale);
    radialMenu.setEnabled(true);
    radialMenuVisible = true;
    
    // console.log('🎯 Radial menu shown - currentMenuLevel:', currentMenuLevel, 'anchor:', currentAnchor);
    
    // Initialize main menu layout (only creates items if they don't exist)
    initializeMainMenuLayout();
    
    // Re-enable main menu item meshes
    radialMenuItems.forEach(item => {
      if (item.mesh) {
        item.mesh.setEnabled(true);
      }
    });
    
    // Animate menu items based on original click position for spreading logic
    animateMenuItems(screenX, screenY);
    
    // COMPLETELY DISABLE center mesh until we fix clicking
    setTimeout(() => {
      if (hud.centerMesh) {
        hud.centerMesh.isPickable = false;
        hud.centerMesh.setEnabled(false);
      }
    }, 200);
    
    // Radial menu positioned and shown
  };
  
  // Hide radial menu
  hud.hideRadialMenu = function() {
    if (!radialMenu) return;

    // Cancel any pending async model loads
    pendingModelLoads.clear();

    radialMenu.setEnabled(false);
    radialMenuVisible = false;
    currentAnchor = null; // Clear current anchor

    // Unparent from camera
    radialMenu.parent = null;

    // Hide meshes but DON'T dispose them (we'll reuse them next time)
    radialMenuItems.forEach(item => {
      if (item.mesh) {
        item.mesh.setEnabled(false);
      }
    });
    
    // Clear only submenu items, keep main menu items cached
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    submenuItems.forEach(item => {
      if (item.mesh) {
        // Dispose recursively to clean up all children
        item.mesh.getChildMeshes().forEach(child => {
          if (child.material) child.material.dispose();
          child.dispose();
        });
        if (item.mesh.material) item.mesh.material.dispose();
        item.mesh.dispose();
      }
      // Dispose click sphere if it exists
      if (item.clickSphere) {
        item.clickSphere.dispose();
      }
    });
    radialMenuItems = radialMenuItems.filter(item => !item.isSubItem);
    
    // Reset menu level
    currentMenuLevel = 'main';
    
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
      anchorAngle = Math.PI; // 180° = left (categories spread correctly)
    } else if (currentAnchor === 'right') {
      anchorAngle = 0; // 0° = right (categories spread correctly)
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
      
      // Get the normalized scale (stored when model loaded) or use 1.0 as fallback
      const finalScale = item.normalizedScale || 1.0;
      const startScale = finalScale * 0.01; // Start very small relative to final scale
      
      item.mesh.scaling.setAll(startScale);
      
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
        { frame: startFrame, value: new BABYLON.Vector3(startScale, startScale, startScale) },
        { frame: endFrame, value: new BABYLON.Vector3(finalScale, finalScale, finalScale) }
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
    
    // Pre-calculate total submenu items for proper angle distribution
    const totalSubmenuItems = submenuItems.length;
    
    // Add each submenu item (will be marked as submenu item automatically)
    submenuItems.forEach(([key, value], index) => {
      const itemName = key.charAt(0).toUpperCase() + key.slice(1); // Capitalize first letter
      const icon = getIconForItem(key);
      const color = getColorForCategory(menuLevel);
      
      // Add as submenu item (isSubItem will be true because currentMenuLevel !== 'main')
      // Pass total count so angle calculation is consistent
      hud.addRadialMenuItem(itemName, icon, value.callback, color, totalSubmenuItems);
    });
    
    // No back button needed
    
    // Positions are calculated correctly in addRadialMenuItem, no need to reposition
    // positionSubmenuItemsInArc(validScreenX, validScreenY);
    
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
    // Cancel any pending async model loads
    pendingModelLoads.clear();
    
    // Find and remove only submenu items
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    submenuItems.forEach(item => {
      if (item.mesh) {
        // Dispose recursively to clean up all children
        item.mesh.getChildMeshes().forEach(child => {
          if (child.material) child.material.dispose();
          child.dispose();
        });
        if (item.mesh.material) item.mesh.material.dispose();
        item.mesh.dispose();
      }
      // Dispose click sphere if it exists
      if (item.clickSphere) {
        item.clickSphere.dispose();
      }
    });
    
    // Remove submenu items from the array
    radialMenuItems = radialMenuItems.filter(item => !item.isSubItem);
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
        // Left anchor: FLIP angle for submenu options to spread right
        buttonAngle = 0; // 0° = flip to make options spread right
        break;
      case 'right':
        // Right anchor: FLIP angle for submenu options to spread left
        buttonAngle = Math.PI; // 180° = flip to make options spread left
        break;
      default:
        // Fallback to bottom behavior
        buttonAngle = Math.PI / 2; // 90° = up
        break;
    }
    
    // Spread submenu items in an arc around the button-to-center direction
    const arcSpread = Math.PI / 3; // 60 degrees total spread
    let startAngle = buttonAngle - arcSpread / 2;
    let endAngle = buttonAngle + arcSpread / 2;
    
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
      
      // Get the normalized scale (stored when model loaded) or use 1.0 as fallback
      const finalScale = item.normalizedScale || 1.0;
      const startScale = finalScale * 0.01; // Start very small relative to final scale
      const bounceScale = finalScale * 1.2; // Bounce 20% larger
      
      item.mesh.scaling.setAll(startScale);
      
      // Animate scale growing out with bounce
      const scaleAnimation = new BABYLON.Animation(
        `submenuGrow${index}`,
        "scaling",
        60, // 60 fps
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      const keyFrames = [];
      keyFrames.push({ frame: 0, value: new BABYLON.Vector3(startScale, startScale, startScale) });
      keyFrames.push({ frame: 30, value: new BABYLON.Vector3(bounceScale, bounceScale, bounceScale) }); // Bounce
      keyFrames.push({ frame: 60, value: new BABYLON.Vector3(finalScale, finalScale, finalScale) }); // Settle to normalized scale
      
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
      anchorAngle = Math.PI; // 180° = left (categories spread correctly)
    } else if (currentAnchor === 'right') {
      anchorAngle = 0; // 0° = right (categories spread correctly)
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
      
      // Get the normalized scale (stored when model loaded) or use 1.0 as fallback
      const finalScale = item.normalizedScale || 1.0;
      const startScale = finalScale * 0.01; // Start very small relative to final scale
      const bounceScale = finalScale * 1.2; // Bounce 20% larger
      
      item.mesh.scaling.setAll(startScale);
      
      // Animate scale growing out with bounce
      const scaleAnimation = new BABYLON.Animation(
        `menuGrow${index}`,
        "scaling",
        60, // 60 fps
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      const keyFrames = [];
      keyFrames.push({ frame: 0, value: new BABYLON.Vector3(startScale, startScale, startScale) });
      keyFrames.push({ frame: 30, value: new BABYLON.Vector3(bounceScale, bounceScale, bounceScale) }); // Bounce
      keyFrames.push({ frame: 60, value: new BABYLON.Vector3(finalScale, finalScale, finalScale) }); // Settle to normalized scale
      
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
    // XY plane (camera-local), parent has 180° Y rotation
    const x = Math.cos(radians) * item.radius;
    const y = Math.sin(radians) * item.radius;
    const z = -menuConfig.distance * 0.5; // Negative Z to face camera after Y rotation
    
    // Position at negative Z to face camera after parent Y rotation
    return new BABYLON.Vector3(x, y, z);
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
      }, new BABYLON.Color3(0.2, 0.6, 1), null, 'assets/models/gnome.glb'); // Blue with gnome model
      
      hud.addRadialMenuItem("Research", "🔬", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("research");
      }, new BABYLON.Color3(1, 1, 0), null, 'assets/models/mushroom.glb'); // Yellow with mushroom model
      
      hud.addRadialMenuItem("Rally", "🚩", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("rally");
      }, new BABYLON.Color3(1, 0, 0), null, 'assets/models/flag.glb'); // Red with flag model
    }
    
    // Recalculate and position main menu items based on current anchor
    const anchorDirection = getAnchorDirection();
    const baseAngle = calculateBaseAngleForAnchor(anchorDirection);
    const angleSpread = 240; // Wider arc (was 180)
    const angleStep = angleSpread / 3; // 4 items, 3 gaps
    
    console.log(`🔵 Repositioning main menu - anchor: ${anchorDirection}, baseAngle: ${baseAngle}`);
    
    // First pass: Update all angles/radius
    radialMenuItems.forEach((item, index) => {
      if (!item.isSubItem) {
        // Recalculate angle based on current anchor (like submenus do)
        let orderIndex = 0;
        if (item.text === "Rally") orderIndex = 0;
        else if (item.text === "Buildings") orderIndex = 1;
        else if (item.text === "Units") orderIndex = 2;
        else if (item.text === "Research") orderIndex = 3;
        
        // ALWAYS update angle/radius, even if mesh doesn't exist yet
        item.angle = baseAngle + (orderIndex * angleStep) - (angleSpread / 2);
        item.radius = menuConfig.itemRadius * 0.25; // Closer to edge (was 0.3)
      }
    });
    
    // Second pass: Position and show any meshes that exist (including ones that just loaded)
    radialMenuItems.forEach((item, index) => {
      if (!item.isSubItem && item.mesh) {
        const pos = calculateMainItemPosition(item, 0, 0);
        console.log(`  ${item.text}: angle=${item.angle.toFixed(1)}°, pos=(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}), scaling=${item.mesh.scaling.x.toFixed(2)}, hasSphere=${!!item.clickSphere}`);
        item.mesh.position.copyFrom(pos);
        
        // Update clickSphere scale if it exists
        if (item.clickSphere) {
          const parentScale = item.mesh.scaling.x;
          item.clickSphere.scaling.setAll(1.0 / parentScale);
          // Make clickSphere visible now that it's properly positioned
          item.clickSphere.isVisible = true;
          item.clickSphere.setEnabled(true);
        }
        
        // Make main menu items visible now that they're properly positioned
        item.mesh.isVisible = true;
        if (typeof item.mesh.setEnabled === 'function') {
          item.mesh.setEnabled(true);
        }
        item.mesh.getChildMeshes().forEach(m => {
          m.isVisible = true;
          m.visibility = 1.0;
          // Only enable if it's a proper mesh with isEnabled
          if (typeof m.setEnabled === 'function' && 'isEnabled' in m) {
            m.setEnabled(true);
          }
        });
        
        // Ensure main menu items are visible (don't change scale - it's normalized)
        if (item.mesh.material) {
          item.mesh.material.alpha = 1.0;
        }
      } else if (!item.isSubItem && !item.mesh) {
        console.log(`  ${item.text}: angle=${item.angle.toFixed(1)}° set, mesh not loaded yet`);
      }
    });
    
    // console.log('✅ Main menu initialized with', radialMenuItems.filter(item => !item.isSubItem).length, 'main categories');
  }
  
  // Add item to radial menu - DIRECTIONAL SYSTEM
  hud.addRadialMenuItem = function(text, icon, callback, color, totalCount, modelPath) {
    const isSubmenu = currentMenuLevel !== 'main';
    const currentIndex = radialMenuItems.filter(item => item.isSubItem === isSubmenu).length;
    // Use provided totalCount (for submenus) or calculate it (for main menu)
    const totalItemsOfType = totalCount || (currentIndex + 1);
    
    // Get the anchor direction for both main menu and submenu
    const anchorDirection = getAnchorDirection();
    const baseAngle = calculateBaseAngleForAnchor(anchorDirection);
    
    let angle, radius;
    
    if (isSubmenu) {
      // For submenu items, spread them in an arc centered on the base angle (toward screen center)
      const angleSpread = 120; // 120 degree spread for submenu (was 60°)
      const angleStep = totalItemsOfType > 1 ? angleSpread / (totalItemsOfType - 1) : 0;
      angle = baseAngle - (angleSpread / 2) + (currentIndex * angleStep);
      radius = menuConfig.itemRadius * 0.4; // Much closer to center (was 0.8, too far!)
    } else {
      // Main menu items (Buildings, Units, Research, Rally)
      // Don't position them here - they'll be positioned in showRadialMenu based on anchor
      // Use placeholder values that will be overridden
      angle = 0;
      radius = 0.1; // Tiny radius so they're hidden at center if they appear before repositioning
    }
    
    // Make both main menu and submenu items smaller
    const scale = isSubmenu ? 0.7 : 0.5;
    
    const item = {
      text: text,
      icon: icon,
      callback: callback,
      color: color || new BABYLON.Color3(0.8, 0.4, 0.1), // Default orange
      angle: angle,
      radius: radius,
      scale: scale,
      isSubItem: isSubmenu, // Mark as submenu item if not in main menu
      menuCategory: currentMenuLevel, // Store which menu this belongs to (units, buildings, etc.)
      customModelPath: modelPath, // Optional custom model for category buttons
      mesh: null
    };
    
    radialMenuItems.push(item);
    
    // Create 3D mesh for this item
    createMenuItemMesh(item);
  };
  
  // Helper function to set up click handlers on a mesh
  function setupMeshClickHandler(mesh, item) {
    if (!mesh || !item) return;
    
    // Setup click handling on root mesh
    mesh.actionManager = new BABYLON.ActionManager(hud.scene);
    mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPickTrigger,
      () => {
        const originalScale = mesh.scaling.clone();
        mesh.scaling.scaleInPlace(1.3);
        setTimeout(() => {
          mesh.scaling.copyFrom(originalScale);
        }, 150);
        
        if (item.callback) {
          item.callback();
        }
      }
    ));
    
    // Also set up on all child meshes
    const childMeshes = mesh.getChildMeshes();
    childMeshes.forEach((m, idx) => {
      m.actionManager = new BABYLON.ActionManager(hud.scene);
      m.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickTrigger,
        () => {
          const originalScale = mesh.scaling.clone();
          mesh.scaling.scaleInPlace(1.3);
          setTimeout(() => {
            mesh.scaling.copyFrom(originalScale);
          }, 150);
          
          if (item.callback) {
            item.callback();
          }
        }
      ));
    });
  }
  
  // Create 3D mesh for a menu item
  function createMenuItemMesh(item) {
    if (!hud.scene || !radialMenu) return;
    
    // If mesh already exists, just re-enable it and ensure action manager is set up
    if (item.mesh && !item.mesh.isDisposed()) {
      item.mesh.setEnabled(true);
      
      // Ensure action manager is set up (might have been cleared)
      if (!item.mesh.actionManager) {
        setupMeshClickHandler(item.mesh, item);
      }
      return;
    }
    
    // Try to load actual 3D model for units and buildings
    const itemKey = item.text.toLowerCase();
    let modelPath = null;
    let menuScale = 0.005; // Tiny default
    
    // Priority 1: Custom model path for category buttons
    if (item.customModelPath) {
      modelPath = item.customModelPath;
      menuScale = 0.01; // Good size for category models
    }
    // Priority 2: Special case: Buildings category button uses agora model
    else if (item.text === "Buildings" && !item.isSubItem) {
      modelPath = "assets/models/agora.glb";
      menuScale = 0.005;
    }
    // Priority 3: Check if this is a unit or building and get its model path
    // Use item.menuCategory which is stored at creation time
    else if (item.menuCategory === 'units' && window.UnitTypes && window.UnitTypes[itemKey]) {
      modelPath = window.UnitTypes[itemKey].model;
      menuScale = 0.08; // Small units for menu
    } else if (item.menuCategory === 'buildings' && window.BuildingTypes && window.BuildingTypes[itemKey]) {
      modelPath = window.BuildingTypes[itemKey].model;
      menuScale = 0.005; // MUCH smaller buildings for menu (10x smaller)
    }
    
    // Load the 3D model
    if (modelPath && window.gfx && window.gfx.getModel) {
      const loadId = `${item.text}_${Date.now()}`;
      pendingModelLoads.add(loadId);
      
      window.gfx.getModel(modelPath, hud.scene).then(model => {
        // Check if this load is still valid (menu might have closed)
        if (!pendingModelLoads.has(loadId)) {
          // Menu closed or changed - dispose the loaded model
          model.root.dispose();
          return;
        }
        pendingModelLoads.delete(loadId);
        
        const mesh = model.root;
        mesh.name = `menuItem_${item.text}`;
        
        // Auto-normalize size based on bounding box
        const boundingInfo = mesh.getHierarchyBoundingVectors(true);
        const size = boundingInfo.max.subtract(boundingInfo.min);
        const maxDimension = Math.max(size.x, size.y, size.z);
        
        // Target size for menu items (in world units)
        // Treat Buildings category button as a building for scale normalization
        const isBuilding = item.menuCategory === 'buildings' || (item.text === "Buildings" && !item.isSubItem);
        const isCustomCategory = item.customModelPath && !item.isSubItem;
        const targetSize = isCustomCategory ? 0.35 : (item.menuCategory === 'units' ? 0.4 : 0.3); // Custom categories slightly bigger than buildings
        const normalizedScale = maxDimension > 0 ? targetSize / maxDimension : menuScale;
        
        // Store normalized scale so animations can use it instead of hardcoded 1.0
        item.normalizedScale = normalizedScale;
        
        mesh.scaling = new BABYLON.Vector3(normalizedScale, normalizedScale, normalizedScale);
        
        // IMPORTANT: Clear rotationQuaternion so we can use Euler angles
        mesh.rotationQuaternion = null;
        
        // Different rotation for buildings vs units vs custom category models
        if (item.menuCategory === 'buildings' || (item.text === "Buildings" && !item.isSubItem)) {
          // Buildings: face camera and tilt for top-down view
          mesh.rotation.y = Math.PI;
          mesh.rotation.x = -Math.PI / 4; // 45 degree tilt forward
        } else if (item.customModelPath && !item.isSubItem) {
          // Custom category models: face camera
          mesh.rotation.y = Math.PI;
          mesh.rotation.x = 0;
        } else {
          // Units: try no Y rotation (units might be modeled facing forward already)
          mesh.rotation.y = 0;
          mesh.rotation.x = 0;
        }
        
        // Make model visible but not pickable
        // For main menu items, start invisible until repositioned in showRadialMenu
        mesh.isVisible = item.isSubItem ? true : false;
        mesh.setEnabled(item.isSubItem ? true : false);
        mesh.isPickable = false;
        mesh.renderingGroupId = 2;
        
        mesh.getChildMeshes().forEach(m => {
          // For main menu items, start invisible until repositioned in showRadialMenu
          m.isVisible = item.isSubItem ? true : false;
          m.visibility = item.isSubItem ? 1.0 : 0;
          m.setEnabled(item.isSubItem ? true : false);
          m.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
          m.isPickable = false; // Children not pickable - sphere handles it
          m.renderingGroupId = 2;
          
          // Make it glow so it's visible in the HUD scene
          if (m.material) {
            m.material.emissiveColor = new BABYLON.Color3(0.8, 0.8, 0.8);
          }
        });
        
        // Create visible sphere for easier clicking (simplest geometry)
        // Make submenu items slightly larger to compensate for being further from center
        const sphereDiameter = item.isSubItem ? 0.35 : 0.27;
        const clickSphere = BABYLON.MeshBuilder.CreateSphere(`clickSphere_${item.text}`, {
          diameter: sphereDiameter
        }, hud.scene);
        
        clickSphere.parent = mesh; // Parent to mesh so it follows the model
        clickSphere.isPickable = true;
        clickSphere.renderingGroupId = 3;
        
        // For main menu items, start invisible until repositioned
        clickSphere.isVisible = item.isSubItem ? true : false;
        clickSphere.setEnabled(item.isSubItem ? true : false);
        
        // Make sphere visible with item color for debugging
        const sphereMat = new BABYLON.StandardMaterial(`sphereMat_${item.text}`, hud.scene);
        sphereMat.emissiveColor = item.color;
        sphereMat.alpha = 0.5;
        clickSphere.material = sphereMat;
        
        // Position sphere at model's visual center (bounding box center)
        const sphereBounds = mesh.getHierarchyBoundingVectors(true);
        const center = sphereBounds.max.add(sphereBounds.min).scale(0.5);
        clickSphere.position.copyFrom(center);
        
        // Make sphere scale independent of parent mesh scale
        const parentScale = mesh.scaling.x; // All axes should be uniform
        const targetSphereWorldSize = 5.0; // Desired world size
        clickSphere.scaling.setAll(1.0 / parentScale); // Compensate for parent scale
        
        // Set up click handlers on sphere
        clickSphere.actionManager = new BABYLON.ActionManager(hud.scene);
        
        clickSphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
          BABYLON.ActionManager.OnPointerOverTrigger,
          () => {
            hud.scene.hoverCursor = 'pointer';
            // Small scale up and rotation on hover
            mesh.scaling.scaleInPlace(1.1); // Subtle 10% increase
            if (!mesh._originalRotation) {
              mesh._originalRotation = mesh.rotation.clone();
            }
            mesh.rotation.y += 0.2; // Turn/rotate instead of tilt
          }
        ));
        
        clickSphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
          BABYLON.ActionManager.OnPointerOutTrigger,
          () => {
            hud.scene.hoverCursor = 'default';
            // Scale back down and restore rotation
            mesh.scaling.scaleInPlace(1 / 1.1);
            if (mesh._originalRotation) {
              mesh.rotation.copyFrom(mesh._originalRotation);
            }
          }
        ));
        
        clickSphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
          BABYLON.ActionManager.OnPickDownTrigger,
          (evt) => {
            // Prevent click from propagating to terrain
            if (evt && evt.sourceEvent) {
              evt.sourceEvent.stopPropagation();
              evt.sourceEvent.preventDefault();
            }
            
            if (item.callback) {
              item.callback();
            }
            if (item.text === "Back") {
              hud.hideRadialMenu();
            }
          }
        ));
        
        // Store references for cleanup
        item.mesh = mesh;
        item.clickSphere = clickSphere;
        
        // Parent to radial menu - this makes it move with the camera
        mesh.parent = radialMenu;
        
        // Position using stored angle/radius
        // For submenu items, position immediately
        // For main menu items, DON'T auto-position - let showRadialMenu handle it
        if (item.isSubItem && item.angle !== undefined && item.radius !== undefined) {
          const position = calculateMenuItemPosition(item);
          mesh.position.copyFrom(position);
          console.log(`📦 Submenu model loaded for ${item.text}, positioned at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
        } else if (!item.isSubItem) {
          // Main menu item - leave at origin until showRadialMenu positions it
          mesh.position.set(0, 0, 0);
          console.log(`📦 Main menu model loaded for ${item.text}, waiting for showRadialMenu to position`);
        }
        
        // If this is a main menu item and menu is currently visible, position and show it now
        // BUT only if angle/radius have been set to real values (not placeholders)
        if (!item.isSubItem && radialMenuVisible && item.angle !== 0 && item.radius > 0.1) {
          // Position using stored angle/radius (set by showRadialMenu)
          const position = calculateMenuItemPosition(item);
          mesh.position.copyFrom(position);
          console.log(`📦 Late-loaded ${item.text} positioned at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
          
          // Update clickSphere scale
          if (item.clickSphere) {
            const parentScale = mesh.scaling.x;
            item.clickSphere.scaling.setAll(1.0 / parentScale);
            item.clickSphere.isVisible = true;
            item.clickSphere.setEnabled(true);
          }
          
          // Make visible now that it's positioned
          mesh.isVisible = true;
          if (typeof mesh.setEnabled === 'function') {
            mesh.setEnabled(true);
          }
          mesh.getChildMeshes().forEach(m => {
            m.isVisible = true;
            m.visibility = 1.0;
            // Only enable if it's a proper mesh with isEnabled
            if (typeof m.setEnabled === 'function' && 'isEnabled' in m) {
              m.setEnabled(true);
            }
          });
        } else if (!item.isSubItem) {
          console.log(`📦 ${item.text} loaded but waiting for real angle/radius (angle=${item.angle}, radius=${item.radius?.toFixed(2)})`);
        }
      }).catch(err => {
        console.warn(`Failed to load model for ${item.text}, using fallback cube`, err);
        createFallbackCube(item);
      });
    } else {
      // Fall back to cube for research, rally, and other items
      createFallbackCube(item);
    }
  }
  
  // Create fallback cube mesh for menu items
  function createFallbackCube(item) {
    if (!hud.scene || !radialMenu) return;
    
    const baseSize = 0.4;
    const finalSize = item.scale ? baseSize * item.scale : baseSize;
    const mesh = BABYLON.MeshBuilder.CreateBox(`menuItem_${item.text}`, {size: finalSize}, hud.scene);
    
    // Store normalized scale for fallback cubes
    // Cubes are created at the correct size (finalSize), so mesh.scaling should be 1.0
    // The item.scale is already baked into the geometry size, not the mesh scale
    item.normalizedScale = 1.0;
    
    // Create material with the item's color
    const material = new BABYLON.StandardMaterial(`menuMat_${item.text}`, hud.scene);
    material.emissiveColor = item.color;
    material.disableLighting = true;
    mesh.material = material;
    
    // Parent to radial menu
    mesh.parent = radialMenu;
    
    // Render on top of terrain
    mesh.renderingGroupId = 1;
    
    // For main menu items, start invisible until repositioned
    mesh.isVisible = item.isSubItem ? true : false;
    mesh.setEnabled(item.isSubItem ? true : false);
    
    // Make cube not pickable - sphere will handle it
    mesh.isPickable = false;
    
    // Create visible sphere for easier clicking (same as model items)
    const clickSphere = BABYLON.MeshBuilder.CreateSphere(`clickSphere_${item.text}`, {
      diameter: 0.27  // Smaller click target
    }, hud.scene);
    
    clickSphere.parent = mesh; // Parent to mesh so it follows the cube
    clickSphere.isPickable = true;
    clickSphere.renderingGroupId = 3;
    
    // For main menu items, start invisible until repositioned
    clickSphere.isVisible = item.isSubItem ? true : false;
    clickSphere.setEnabled(item.isSubItem ? true : false);
    
    // Make sphere visible with item color for debugging
    const sphereMat = new BABYLON.StandardMaterial(`sphereMat_${item.text}`, hud.scene);
    sphereMat.emissiveColor = item.color;
    sphereMat.alpha = 0.5;
    clickSphere.material = sphereMat;
    
    // Position sphere at cube center (cubes are centered at origin)
    clickSphere.position.set(0, 0, 0);
    
    // Cubes don't have varying scale, so sphere scale is already consistent
    // (Keep at 1.0 since cube mesh scale is always uniform)
    
    // Set up click handlers on sphere
    clickSphere.actionManager = new BABYLON.ActionManager(hud.scene);
    
    // Add hover effect with rotation
    clickSphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPointerOverTrigger,
      () => {
        hud.scene.hoverCursor = 'pointer';
        // Small scale up and rotation on hover
        mesh.scaling.scaleInPlace(1.1); // Subtle 10% increase
        if (!mesh._originalRotation) {
          mesh._originalRotation = mesh.rotation.clone();
        }
        mesh.rotation.y += 0.2; // Turn/rotate instead of tilt
      }
    ));
    
    clickSphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPointerOutTrigger,
      () => {
        hud.scene.hoverCursor = 'default';
        // Scale back down and restore rotation
        mesh.scaling.scaleInPlace(1 / 1.1);
        if (mesh._originalRotation) {
          mesh.rotation.copyFrom(mesh._originalRotation);
        }
      }
    ));
    
    clickSphere.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnPickDownTrigger,
      (evt) => {
        // Prevent click from propagating to terrain
        if (evt && evt.sourceEvent) {
          evt.sourceEvent.stopPropagation();
          evt.sourceEvent.preventDefault();
        }
        
        // Visual feedback - briefly scale up the clicked item
        const originalScale = mesh.scaling.clone();
        mesh.scaling.scaleInPlace(1.3);
        setTimeout(() => {
          mesh.scaling.copyFrom(originalScale);
        }, 150);
        
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
    
    // Store mesh and sphere references
    item.mesh = mesh;
    item.clickSphere = clickSphere;
    
    // Position cube in XY plane (facing camera when parented to camera)
    // Angles are already calculated to point toward screen center
    if (item.angle !== undefined && item.radius !== undefined) {
      const angleRad = item.angle * (Math.PI / 180);
      const x = Math.cos(angleRad) * item.radius;
      const y = Math.sin(angleRad) * item.radius;
      let z = -menuConfig.distance * 0.5; // Negative Z to face camera after Y rotation
      
      mesh.position.set(x, y, z);
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
        
        // Check if unit is behind the camera (negative forward dot product)
        // CRITICAL: Units behind camera must ALWAYS appear at bottom of minimap, regardless of distance
        // When far behind, upDot can flip signs causing jumping - we prevent this by checking forwardDot first
        const forwardDot = BABYLON.Vector3.Dot(toUnit, cameraForward);
        const isBehind = forwardDot <= 0; // <= includes units directly to the side as "behind" for minimap purposes
        
        // Map to nearest corner (corners are primary positions)
        // Find which corner this direction is closest to
        let cornerX = rightDot > 0 ? 'r' : 'l'; // right or left
        // CRITICAL: If unit is behind camera (forwardDot <= 0), ALWAYS force it to bottom.
        // This prevents jumping between top/bottom when units are far behind.
        // Only units clearly in front (forwardDot > 0) use upDot to determine top/bottom
        let cornerY = isBehind ? 'b' : (upDot > 0 ? 't' : 'b'); // top or bottom
        let corner = `corner-${cornerY}${cornerX}`;
        
        // Determine which edge we're on based on which direction is MORE extreme
        // Compare the raw absolute dot products - higher = more extreme in that direction
        // For units behind camera, use absolute value of upDot but ensure cornerY stays 'b'
        const absRight = Math.abs(rightDot);
        // When behind, we still need absUp for edge spread calculations, but cornerY is already forced to 'b'
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
  
  // Generate consistent offset based on unit type so they don't stack perfectly
  function getTypeOffset(unitType) {
    // Simple hash of unit type to generate consistent offsets
    let hash = 0;
    for (let i = 0; i < unitType.length; i++) {
      hash = ((hash << 5) - hash) + unitType.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Convert hash to small horizontal offset only (spread left/right, not up/down)
    const offsetMagnitude = 0.08; // Smaller offset for subtle separation
    const xOffset = ((hash % 100) / 100 - 0.5) * 2 * offsetMagnitude;
    
    return { x: xOffset, y: 0 }; // Only offset horizontally
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
    
    // Project group average world position into screen space and then
    // intersect the ray from screen center to that point with the
    // screen rectangle. This keeps indicators on the edges without
    // pinning them to corners or jumping across the middle.
    const projected = BABYLON.Vector3.Project(
      group.avgPosition,
      BABYLON.Matrix.Identity(),
      hud.scene.getTransformMatrix(),
      hud.camera.viewport
    );
    
    const unitCount = group.units.length;
    const hasSelection = group.units.some(u => window.player && window.player.isUnitSelected(u));
    
    const buffer = 30; // Fixed pixel distance from screen edge
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const halfW = centerX - buffer;
    const halfH = centerY - buffer;
    
    // Target position in pixels (may be off-screen)
    const targetX = projected.x * rect.width;
    const targetY = projected.y * rect.height;
    
    // Direction from screen center toward the unit
    let dirX = targetX - centerX;
    let dirY = targetY - centerY;
    
    // Avoid degenerate zero-length direction
    if (dirX === 0 && dirY === 0) {
      dirY = -1;
    }
    
    const absDx = Math.abs(dirX);
    const absDy = Math.abs(dirY);
    
    // Scale factor needed to hit each edge
    const tX = absDx > 0 ? halfW / absDx : Number.POSITIVE_INFINITY;
    const tY = absDy > 0 ? halfH / absDy : Number.POSITIVE_INFINITY;
    const t = Math.min(tX, tY);
    
    // Final edge position in pixels
    const edgePos = {
      x: centerX + dirX * t,
      y: centerY + dirY * t
    };
    
    // Work out which edge we hit and a 0–1 spread along that edge so we can
    // keep the existing tilt/rotation behavior.
    let cornerX, cornerY, spreadDir, spreadFactor;
    if (tX < tY) {
      // Hit left/right edge
      cornerX = dirX > 0 ? 'r' : 'l';
      cornerY = dirY < 0 ? 't' : 'b';
      spreadDir = 'v'; // spread vertically along edge
      // Map from top (-halfH) .. bottom (+halfH) to 0..1
      const relY = edgePos.y - (centerY - halfH);
      spreadFactor = relY / (2 * halfH);
    } else {
      // Hit top/bottom edge
      cornerY = dirY > 0 ? 'b' : 't';
      cornerX = dirX < 0 ? 'l' : 'r';
      spreadDir = 'h'; // spread horizontally along edge
      // Map from left (-halfW) .. right (+halfW) to 0..1
      const relX = edgePos.x - (centerX - halfW);
      spreadFactor = relX / (2 * halfW);
    }
    
    // Clamp spread factor to [0,1] for safety
    spreadFactor = Math.min(1, Math.max(0, spreadFactor));
    
    // Calculate position in camera-local space (since indicators are parented to camera)
    const ray = hud.scene.createPickingRay(edgePos.x, edgePos.y, BABYLON.Matrix.Identity(), hud.camera);
    const worldPos = ray.origin.add(ray.direction.scale(menuConfig.distance)); // Same distance as radial menu
    
    // Convert world position to camera-local coordinates using inverse camera matrix
    const cameraMatrix = hud.camera.getWorldMatrix();
    const inverseCameraMatrix = BABYLON.Matrix.Invert(cameraMatrix);
    const localPos = BABYLON.Vector3.TransformCoordinates(worldPos, inverseCameraMatrix);
    
    // Add type-based offset so different unit types don't stack perfectly
    const typeOffset = getTypeOffset(group.type);
    localPos.x += typeOffset.x;
    localPos.y += typeOffset.y;
    
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
        indicator.scaling = new BABYLON.Vector3(0.05, 0.05, 0.05); // 1/3 size for edge indicators
        indicator.isPickable = true;
        indicator.linkedGroup = group;
        
        // Parent to camera so they move automatically!
        indicator.parent = hud.camera;
        
        // Don't use billboard - we'll manually rotate them to face screen center
        
        // Make it glow/stand out and set up click handlers
        indicator.getChildMeshes().forEach(mesh => {
          if (mesh.material) {
            mesh.material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.3);
          }
          // Ensure child meshes are pickable
          mesh.isPickable = true;
          
          // Set up action manager on each child (root has no geometry)
          mesh.actionManager = new BABYLON.ActionManager(hud.scene);
          mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnPickDownTrigger,
            (evt) => {
              const linkedGroup = indicator.linkedGroup;
              if (!linkedGroup || !window.player) return;
              
              // Select all units in this group
              window.player.clearSelection();
              linkedGroup.units.forEach(unit => {
                window.player.selectUnit(unit);
              });
              
              evt.skipNextObservers = true;
            }
          ));
          
          // Add hover cursor
          mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnPointerOverTrigger,
            () => {
              hud.scene.hoverCursor = 'pointer';
            }
          ));
          
          mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnPointerOutTrigger,
            () => {
              hud.scene.hoverCursor = 'default';
            }
          ));
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
      indicator.scaling = new BABYLON.Vector3(0.07, 0.07, 0.07); // Slightly bigger when selected (was 0.05)
      
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
      indicator.scaling = new BABYLON.Vector3(0.05, 0.05, 0.05); // 1/3 size
      
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
    
    // Click handlers are set up on child meshes during creation (root has no geometry)
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
  
  // Enable shadows (helper function)
  hud.enableShadows = function() {
    const switchElement = document.getElementById('shadows_switch');
    const handle = document.getElementById('shadows_handle');
    
    // Turn shadows on (right position)
    if (switchElement) {
      switchElement.style.background = '#4CAF50';
      switchElement.dataset.on = 'true';
    }
    if (handle) {
      handle.style.left = '27px';
    }
    
    // Enable shadows
    window.SHADOWS_ENABLED = true;
    
    // Force initialize shadow generator if it doesn't exist
    if (window.gfx) {
      if (!window.gfx.shadowGenerator) {
        // Force initialize shadows (bypass stability checks)
        if (window.gfx.forceInitializeShadows) {
          window.gfx.forceInitializeShadows();
        } else if (window.gfx.autoInitializeShadows) {
          window.gfx.autoInitializeShadows();
        }
        
        // Apply current LOD setting to shadow resolution
        try {
          const savedLOD = localStorage.getItem('lodLevel');
          const lodLevel = savedLOD ? parseInt(savedLOD) : 50;
          if (window.gfx.shadowGenerator && window.gfx.onLODDistanceUpdate) {
            window.gfx.onLODDistanceUpdate(lodLevel);
          }
        } catch (e) {
          // Ignore LOD application errors
        }
      }
      
      // Update all meshes to receive shadows
      if (window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows(true); // Force re-add
      }
    }
    
    // Save preference
    localStorage.setItem('shadowsEnabled', 'true');
    
    // console.log('✅ Shadows enabled');
    if (window.gfx && window.gfx.shadowGenerator) {
      const casterCount = window.gfx.shadowGenerator.getShadowMap().renderList.length;
      // console.log(`   Shadow generator active with ${casterCount} casters`);
    }
  };
  
  // Toggle shadows on/off
  hud.toggleShadowsMode = function() {
    const switchElement = document.getElementById('shadows_switch');
    const handle = document.getElementById('shadows_handle');
    
    if (!switchElement || !handle) {
      console.warn('Shadow switch elements not found');
      return;
    }
    
    const isOn = switchElement.dataset.on === 'true';
    // console.log('🎭 Toggling shadows from', isOn ? 'ON' : 'OFF', 'to', isOn ? 'OFF' : 'ON');
    
    if (isOn) {
      // Turn shadows off (left position)
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      
      // Disable shadows
      window.SHADOWS_ENABLED = false;
      
      // Immediately set receiveShadows = false on all meshes (fast, visual change)
      if (window.gfx && window.gfx.scene) {
        window.gfx.scene.meshes.forEach(mesh => {
          // Skip terrain/background/UI meshes
          const isBackgroundMesh = mesh.name.includes('mountain') ||
                                   mesh.name.includes('terrain') ||
                                   mesh.name.includes('table') ||
                                   mesh.name.includes('Mesh') ||
                                   mesh.name.includes('UI');
          
          if (!isBackgroundMesh) {
            mesh.receiveShadows = false;
            if (mesh.getChildMeshes) {
              mesh.getChildMeshes().forEach(child => child.receiveShadows = false);
            }
          }
        });
      }
      
      // Also flush shadow casters from the generator so disabling has a real perf impact
      if (window.gfx && window.gfx.shadowGenerator && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows(); // With SHADOWS_ENABLED = false, this removes casters
      }
      
      // Save preference
      localStorage.setItem('shadowsEnabled', 'false');
      // console.log('✅ Shadows disabled');
    } else {
      // Delegate to shared enableShadows helper for consistent behavior
      if (hud.enableShadows) {
        hud.enableShadows();
      }
    }
  };
  
  // Fix mountains if they got corrupted
  hud.fixMountains = function() {
    if (window.gfx && window.gfx.mountains && window.gfx.mountains.dispose) {
      console.log('🏔️ Recreating mountains...');
      window.gfx.mountains.dispose();
      window.gfx.mountains = null;
    }
    
    // Recreate mountains
    if (window.gfx && window.gfx.scene && window.liveField) {
      const fieldDim = Math.max(window.liveField.width, window.liveField.height);
      // Call the createSimpleMountains function - need to expose it first
      if (window.gfx.recreateMountains) {
        window.gfx.recreateMountains();
      }
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
    
    // console.log('🎭 Initializing shadows mode. Saved preference:', savedShadows);
    
    if (!switchElement || !handle) {
      console.warn('⚠️ Shadow switch elements not found during initialization');
      return;
    }
    
    // Default to shadows ON if not explicitly disabled
    if (savedShadows === 'false') {
      // Set to shadows off (explicitly disabled)
      switchElement.style.background = '#ccc';
      switchElement.dataset.on = 'false';
      handle.style.left = '2px';
      
      window.SHADOWS_ENABLED = false;
      
      // Update all meshes to not receive shadows (only if a generator exists)
      if (window.gfx && window.gfx.shadowGenerator && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // console.log('✅ Initialized to shadows OFF');
    } else {
      // Default to shadows ON (either saved as 'true' or not set)
      window.SHADOWS_ENABLED = true;
      
      // Use the shared helper so startup and toggles behave identically
      if (hud.enableShadows) {
        hud.enableShadows();
      }
      
      // console.log('✅ Initialized to shadows ON');
    }
  };

  hud.toggleSelectionMode = function() {
    const switchElement = document.getElementById('selection_switch');
    const handle = document.getElementById('selection_handle');
    const label = document.getElementById('selection_mode_label');
    const isOn = switchElement.dataset.on === 'true';
    
    if (isOn) {
      // Switch to Rectangle (left position)
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      label.textContent = 'Rectangle';
      
      // Update selection mode
      if (window.lassoSelection) {
        window.lassoSelection.setMode('rectangle');
      }
      
      // Save preference
      localStorage.setItem('selectionMode', 'rectangle');
    } else {
      // Switch to Lasso (right position)
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      label.textContent = 'Lasso';
      
      // Update selection mode
      if (window.lassoSelection) {
        window.lassoSelection.setMode('lasso');
      }
      
      // Save preference
      localStorage.setItem('selectionMode', 'lasso');
    }
  };

  hud.initializeSelectionMode = function() {
    // Set initial selection mode to rectangle (default)
    if (window.lassoSelection && typeof window.lassoSelection.setMode === 'function') {
      window.lassoSelection.setMode('rectangle');
    } else {
      console.warn('Lasso selection system not ready for mode initialization');
    }
    
    const savedMode = localStorage.getItem('selectionMode');
    const switchElement = document.getElementById('selection_switch');
    const handle = document.getElementById('selection_handle');
    const label = document.getElementById('selection_mode_label');
    
    if (savedMode === 'lasso') {
      // Set to lasso mode
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      label.textContent = 'Lasso';
      
      if (window.lassoSelection) {
        window.lassoSelection.setMode('lasso');
      }
    } else {
      // Default to rectangle
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      label.textContent = 'Rectangle';
      
      if (window.lassoSelection) {
        window.lassoSelection.setMode('rectangle');
      }
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
    // In camera-local coordinates: 0°=right, 90°=up, 180°=left, 270°=down
    // Items should spread TOWARD screen center from their anchor edge
    // NOTE: We flipped the camera right axis, so left/right need to be flipped here too
    switch (anchor) {
      case 'top':
        return 270; // Point down toward center (flipped by Y rotation from 90°)
      case 'bottom':
        return 90; // Point up toward center (flipped by Y rotation from 270°)
      case 'left':
        return 180; // Point right/inward toward center
      case 'right':
        return 0; // Point left/inward toward center
      default:
        return 90; // Default to bottom behavior
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
