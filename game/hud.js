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
  /** 0–1 from camera zoom (smoothstep); used for HUD offset fade */
  let minimapZoomSmooth = 0;
  /** 0–1, biased up when zoom is far — tier checks use this so “max zoom” stacks hardest */
  let minimapMergeT = 0;
  /** lower = merge sooner; PER_TYPE = one pile per unit type off-screen */
  const MINIMAP_MERGE_PER_TYPE = 0.34;
  const MINIMAP_MERGE_COARSE = 0.13;
  const MINIMAP_MERGE_ONE_BUCKET = 0.07;
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
      // Arc 1: Basic structures
      camp: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('camp');
        }
        },
        arc: 1
      },
      village: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('village');
          }
      },
        arc: 1
      },
      tower: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('tower');
        }
        },
        arc: 1
      },
      silo: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('silo');
          }
        },
        arc: 1
      },
      farm: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('farm');
          }
        },
        arc: 1
      },
      mine: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('mine');
          }
        },
        arc: 1
      },
      // Arc 2: Intermediate structures
      lab: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('lab');
          }
        },
        arc: 2
      },
      tavern: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('tavern');
          }
        },
        arc: 2
      },
      moonwell: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('moonwell');
          }
        },
        arc: 2
      },
      barracks: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('barracks');
          }
        },
        arc: 2
      },
      workshop: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('workshop');
          }
        },
        arc: 2
      },
      // Arc 3: Advanced structures
      factory: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('factory');
          }
        },
        arc: 3
      },
      church: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('church');
          }
        },
        arc: 3
      },
      well: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('well');
          }
        },
        arc: 3
      },
      perch: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('perch');
          }
        },
        arc: 3
      },
      grove: {
        callback: () => {
          if (window.buildingSystem) {
            window.buildingSystem.cancelPlacement();
            window.buildingSystem.selectBuilding('grove');
          }
        },
        arc: 3
      }
    },
    units: {
      // Arc 1: Basic/Support units
      monk: {
        callback: () => window.recruitUnit('monk'),
        arc: 1
      },
      engineer: {
        callback: () => window.recruitUnit('engineer'),
        arc: 1
      },
      wizard: {
        callback: () => window.recruitUnit('wizard'),
        arc: 1
      },
      // Arc 2: Combat units
      warrior: {
        callback: () => window.recruitUnit('warrior'),
        arc: 2
      },
      archer: {
        callback: () => window.recruitUnit('archer'),
        arc: 2
      },
      warlock: {
        callback: () => window.recruitUnit('warlock'),
        arc: 2
      },
      wagon: {
        callback: () => window.recruitUnit('wagon'),
        arc: 2
      },
      // Arc 3: Advanced units
      apc: {
        callback: () => window.recruitUnit('apc'),
        arc: 3
      },
      priest: {
        callback: () => window.recruitUnit('priest'),
        arc: 3
      },
      mycorrhizae: {
        callback: () => window.recruitUnit('mycorrhizae'),
        arc: 3
      },
      dirigible: {
        callback: () => window.recruitUnit('dirigible'),
        arc: 3
      },
      shaman: {
        callback: () => window.recruitUnit('shaman'),
        arc: 3
      }
    },
    research: {
      // Arc 1: Economy/Infrastructure upgrades
      scribes: {
        callback: () => console.log("Research: Scribes selected"),
        arc: 1
      },
      prospecting: {
        callback: () => console.log("Research: Prospecting selected"),
        arc: 1,
        prerequisites: {
          units: ["engineer"]
        }
      },
      patronage: {
        callback: () => console.log("Research: Patronage selected"),
        arc: 1
      },
      stewardship: {
        callback: () => console.log("Research: Stewardship selected"),
        arc: 1
      },
      // Arc 2: Military upgrades
      drayage: {
        callback: () => console.log("Research: Drayage selected"),
        arc: 2
      },
      artillery: {
        callback: () => console.log("Research: Artillery selected"),
        arc: 2
      },
      armor: {
        callback: () => console.log("Research: Armor selected"),
        arc: 2
      }
    }
  };
  
  // Radial menu configuration - TWEAK THESE VALUES
  let menuConfig = {
    distance: 3,        // Distance from camera (world units)
    scale: 0.5,         // Overall scale multiplier - smaller menu
    screenOffsetX: 0,   // Screen offset (-1 to 1, where 0 = center)
    screenOffsetY: -0.6, // Screen offset (-1 to 1, where 0 = center) - negative = bottom
    itemRadius: 1.5,    // How far items spread from center
    centerSize: 0.3,    // Size of center sphere
    itemSize: 0.25,     // Size of menu item cubes - made smaller
    
    // === ARC & POSITIONING ===
    anchorOffset: -0.11,   // How far anchor is OFF screen (negative = past edge, 0 = edge)
    arcAngle: 90,         // Main menu arc spread in degrees (smaller = tighter curve)
    buttonRadius: 0.9,     // Main menu distance from anchor (first concentric circle)
    submenuArcAngle: 90,  // Submenu arc spread in degrees
    submenuRadius: 1.3     // Submenu distance from anchor (second concentric circle)
  }; 
  
  // Initialize HUD system
  hud.init = function(scene, camera, canvas) {
    // console.log('HUD system initialized');
    hud.scene = scene;
    hud.camera = camera;
    hud.canvas = canvas;
    
    // Create radial menu container
    createRadialMenu();

    // Create 3D anchor indicators (if in 3D mode)
    if (window.USE_3D_HUD) {
      hud.createAnchorIndicators();
    } else {
      console.log('🎮 Skipping anchor indicators during HUD init (2D mode)');
    }

    // Initialize minimap system
    initMinimap();
    initMenuHoverDetection();

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
        if (item.container) {
          const newSize = menuConfig.itemSize / 0.4; // Original was 0.4
          item.container.scaling.setAll(newSize);
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
          // 3D HUD mode - find closest screen edge to mouse position
          const canvasRect = hud.canvas.getBoundingClientRect();
          const mouseX = currentMousePosition.x;
          const mouseY = currentMousePosition.y;

          // Define screen edge positions (same as 3D anchor creation)
          const screenEdges = {
            top: { x: canvasRect.width / 2, y: 35, name: 'top' },
            bottom: { x: canvasRect.width / 2, y: canvasRect.height - 35, name: 'bottom' },
            left: { x: 35, y: canvasRect.height / 2, name: 'left' },
            right: { x: canvasRect.width - 35, y: canvasRect.height / 2, name: 'right' }
          };

          // Find closest screen edge to mouse position
          let minDist = Infinity;
          let closestEdge = screenEdges.bottom; // Default to bottom

          for (const edge of Object.values(screenEdges)) {
            const dist = Math.sqrt((mouseX - edge.x)**2 + (mouseY - edge.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestEdge = edge;
            }
          }

          // Show 3D menu at closest screen edge
          console.log(`🖱️ Middle mouse: opening 3D menu at ${closestEdge.name} edge (mouse at ${mouseX}, ${mouseY})`);
          hud.showRadialMenu(mouseX, mouseY, closestEdge.name);
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
          
          // Simulate pointerdown on the closest anchor (anchors listen for pointerdown, not click)
          if (anchors[closestAnchor]) {
            console.log(`🖱️ Middle mouse 2D: triggering pointerdown on ${closestAnchor} anchor`);
            // Create and dispatch a pointerdown event
            const pointerEvent = new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: 'mouse',
              clientX: currentMousePosition.x,
              clientY: currentMousePosition.y
            });
            anchors[closestAnchor].dispatchEvent(pointerEvent);
          } else {
            console.log('❌ Middle mouse 2D: No anchor found');
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
          // 3D HUD mode - find closest screen edge to mouse position
          const canvasRect = hud.canvas.getBoundingClientRect();
          const mouseX = currentMousePosition.x;
          const mouseY = currentMousePosition.y;

          // Define screen edge positions (same as 3D anchor creation)
          const screenEdges = {
            top: { x: canvasRect.width / 2, y: 35, name: 'top' },
            bottom: { x: canvasRect.width / 2, y: canvasRect.height - 35, name: 'bottom' },
            left: { x: 35, y: canvasRect.height / 2, name: 'left' },
            right: { x: canvasRect.width - 35, y: canvasRect.height / 2, name: 'right' }
          };

          // Find closest screen edge to mouse position
          let minDist = Infinity;
          let closestEdge = screenEdges.bottom; // Default to bottom

          for (const edge of Object.values(screenEdges)) {
            const dist = Math.sqrt((mouseX - edge.x)**2 + (mouseY - edge.y)**2);
            if (dist < minDist) {
              minDist = dist;
              closestEdge = edge;
            }
          }

          // Show 3D menu at closest screen edge
          if (e.code === 'KeyB') {
            // 'B' key - open buildings submenu directly
            console.log(`🏗️ B key: opening buildings submenu at ${closestEdge.name} edge`);
            hud.showRadialMenu(mouseX, mouseY, closestEdge.name);
            // Wait for main menu to initialize, then show buildings submenu
            setTimeout(() => {
              hud.showSubMenu('buildings', mouseX, mouseY);
            }, 50);
          } else {
            // Spacebar - open main menu
            console.log(`🎯 Spacebar: opening 3D menu at ${closestEdge.name} edge (mouse at ${mouseX}, ${mouseY})`);
            hud.showRadialMenu(mouseX, mouseY, closestEdge.name);
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
          
          // Show 2D menu directly at the closest anchor position
          if (anchorPositions[closestAnchor]) {
            const pos = anchorPositions[closestAnchor];

            // Mark menu as just opened
            if (window.menuOpenedAt !== undefined) window.menuOpenedAt = Date.now();

            // Exit building placement mode if currently placing
            if (window.buildingSystem && window.buildingSystem.isPlacing) {
              window.buildingSystem.cancelPlacement();
            }

            // Hide any visible buttons first
            if (window.hideButtons && window.activeButtons) {
              window.hideButtons(window.activeButtons);
              if (window.activeButtons) window.activeButtons.length = 0;
              if (window.menuDepth !== undefined) window.menuDepth = 0;
            }

            // If 'B' key pressed, show buildings submenu directly
            if (e.code === 'KeyB' && window.menu && window.menu.buildings) {
              console.log('🏗️ B key: opening buildings submenu (2D mode)');
              if (window.setCurrentAnchor) {
                window.setCurrentAnchor({ x: pos.x, y: pos.y, direction: closestAnchor });
              }
              
              // Create a temporary parent button to pass to showSubmenu
              const tempParentButton = document.createElement('div');
              tempParentButton.dataset.depth = '0';
              tempParentButton.dataset.menuPath = JSON.stringify(['buildings']);
              
              // Call showSubmenu to display buildings with proper multi-arc layout
              if (window.showSubmenu) {
                window.showSubmenu(tempParentButton, window.menu.buildings);
              }
            } else {
              // Spacebar - create and show top-level buttons
              if (window.menu && window.createMenuButton && window.showButtonsInArc) {
                const buttons = Object.entries(window.menu).map(([key, value]) => {
                  return window.createMenuButton(
                    `menu-${key}`,
                    window.getIconForItem ? window.getIconForItem(key) : key,
                    key,
                    [key],
                    0
                  );
                });

                if (window.setCurrentAnchor) {
                  window.setCurrentAnchor({ x: pos.x, y: pos.y, direction: closestAnchor });
                }
                window.showButtonsInArc(buttons, pos.x, pos.y, 0, closestAnchor);
              }
            }
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


    // console.log('🎯 3D anchor indicators created for all 4 screen edges');

    // console.log('3D Radial menu created with billboard mode');
  }

  // Create 3D anchor indicators (fixed markers at screen edges, always visible in 3D mode)
  hud.createAnchorIndicators = function() {
    // Only create if camera exists
    if (!hud.camera) {
      return;
    }

    if (hud.anchorIndicators) {
      // Clean up existing indicators
      Object.values(hud.anchorIndicators).forEach(indicator => {
        if (indicator) indicator.dispose();
      });
    }

      if (hud.camera) {
      }

    hud.anchorIndicators = {};
    const anchorMaterial = new BABYLON.StandardMaterial("anchorMat", hud.scene);
    // anchorMaterial.diffuseColor = new BABYLON.Color3(1,1,1); // Light gray
    anchorMaterial.emissiveColor = new BABYLON.Color3(1,1,1); // Subtle gray glow
    // anchorMaterial.specularColor = new BABYLON.Color3(0.4, 0.4, 0.4); // Low specular
    anchorMaterial.alpha = 0.1; // More transparent
    anchorMaterial.disableLighting = true; // Don't be affected by scene lighting

    // Position indicators at moderate distance from screen edges
    const screenEdges = {
      top: { x: hud.canvas.width / 2, y: 35 }, // Top edge, moderate inset
      bottom: { x: hud.canvas.width / 2, y: hud.canvas.height - 35 }, // Bottom edge, moderate inset
      left: { x: 35, y: hud.canvas.height / 2 }, // Left edge, moderate inset
      right: { x: hud.canvas.width - 35, y: hud.canvas.height / 2 } // Right edge, moderate inset
    };

    for (const [name, screenPos] of Object.entries(screenEdges)) {
      const indicator = BABYLON.MeshBuilder.CreateSphere(`anchor_${name}`, {diameter: 0.10, segments: 4}, hud.scene);
      indicator.material = anchorMaterial.clone(`anchorMat_${name}`);
      indicator.isPickable = true; // Make clickable
      indicator.renderingGroupId = 0;

      // Parent to camera for automatic following
      indicator.parent = hud.camera;

      // Calculate local position relative to camera using screen coordinates
      const updateLocalPosition = function() {
        if (hud.camera && hud.canvas) {
          // Convert screen position to camera-relative coordinates
          const rect = hud.canvas.getBoundingClientRect();
          const normalizedX = (screenPos.x / rect.width) * 2 - 1; // -1 to 1
          const normalizedY = 1 - (screenPos.y / rect.height) * 2; // 1 to -1 (flip Y)

          // Use camera's field of view and aspect ratio to calculate position
          const fov = hud.camera.fov;
          const aspect = rect.width / rect.height;

          const distance = menuConfig.distance;
          const localX = normalizedX * distance * Math.tan(fov/2) * aspect;
          const localY = normalizedY * distance * Math.tan(fov/2);
          const localZ = distance;

          indicator.position.set(localX, localY, localZ);
        }
      };

      // Update position initially
      updateLocalPosition();

      // Add click handler to open radial menu
      indicator.actionManager = new BABYLON.ActionManager(hud.scene);
      indicator.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () => {
          // Don't show menu if we just panned or are currently panning
          if (window.rmbJustPanned || window.lassoSelection?.isSelectionActive?.()) {
            console.log(`🎯 Anchor ${name} click suppressed (panning or selecting)`);
            return;
          }
          
          console.log(`🎯 Anchor ${name} clicked - opening radial menu`);
          // Close any existing menu first
          if (radialMenuVisible) {
            hud.hideRadialMenu();
          }
          // Open radial menu at this anchor's screen position
          hud.showRadialMenu(screenPos.x, screenPos.y, name);
        })
      );

      // Always visible when in 3D HUD mode
      indicator.setEnabled(window.USE_3D_HUD || false);

      hud.anchorIndicators[name] = indicator;
    }

  };

  // Show radial menu at specific anchor point
  hud.showRadialMenu = function(screenX, screenY, forceAnchor = null) {
    if (!radialMenu || !hud.camera) return;
    
    // Don't show if we just panned - this is a safeguard
    if (window.rmbJustPanned) {
      console.log(`🎯 showRadialMenu suppressed (just panned)`);
      return;
    }
    
    const rect = hud.canvas.getBoundingClientRect();
    
    // Define the 4 anchor points - anchorOffset controls how far off screen
    // Negative = past edge (off screen), 0 = at edge, positive = inside screen
    const off = menuConfig.anchorOffset;
    const anchors = {
      top: { x: rect.width / 2, y: rect.height * off },
      bottom: { x: rect.width / 2, y: rect.height * (1 - off) },
      left: { x: rect.width * off, y: rect.height / 2 },
      right: { x: rect.width * (1 - off), y: rect.height / 2 }
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
    
    console.log(`🎯 showRadialMenu - BEFORE init: items=${radialMenuItems.length}, anchor=${currentAnchor}`);
    
    // Initialize main menu layout (only creates items if they don't exist)
    initializeMainMenuLayout();
    
    console.log(`🎯 showRadialMenu - AFTER init: items=${radialMenuItems.length}`);
    
    // Re-enable main menu item containers and refresh availability
    radialMenuItems.forEach(item => {
      if (item.container) {
        item.container.setEnabled(true);
      }
    });
    update3DMenuStates();
    
    // Animate menu items based on original click position for spreading logic
    animateMenuItems(screenX, screenY);
    
    // COMPLETELY DISABLE center mesh until we fix clicking
    if (hud.centerMesh) {
      hud.centerMesh.isPickable = false;
      hud.centerMesh.setEnabled(false);
    }
    
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

    // Hide containers but DON'T dispose them (we'll reuse them next time)
    radialMenuItems.forEach(item => {
      if (item.container) {
        item.container.setEnabled(false);
      }
    });
    
    // Clear only submenu items, keep main menu items cached
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    submenuItems.forEach(item => {
      // Dispose container (disposes all children including mesh)
      if (item.container) {
        item.container.dispose();
      }
      // Also clean up individual refs if container didn't exist
      if (item.mesh && !item.mesh.isDisposed()) {
        item.mesh.getChildMeshes().forEach(child => {
          if (child.material) child.material.dispose();
          child.dispose();
        });
        if (item.mesh.material) item.mesh.material.dispose();
        item.mesh.dispose();
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
  
  // Animate menu items spreading out from anchor toward screen center
  // Mirrors the 2D menu logic from menu.js exactly
  function animateMenuItems(screenX, screenY) {
    // Arc emanates from edge toward center - use config values
    const ARC_ANGLE = menuConfig.arcAngle;
    const BUTTON_RADIUS = menuConfig.buttonRadius;
    
    // Get direction from anchor (matching 2D menu's n/s/e/w system)
    let direction;
    switch (currentAnchor) {
      case 'top': direction = 'n'; break;
      case 'bottom': direction = 's'; break;
      case 'left': direction = 'w'; break;
      case 'right': direction = 'e'; break;
      default: direction = 's'; break; // Default to bottom
    }
    
    // Calculate start angle based on direction
    // Arc points TOWARD screen center from the edge
    // NOTE: 3D has Y-up, and we need to account for the radialMenu's 180° Y rotation
    let startAngle;
    switch (direction) {
      case 'n': // Top anchor - arc points downward toward center
        startAngle = 270 - (ARC_ANGLE / 2);
        break;
      case 's': // Bottom anchor - arc points upward toward center
        startAngle = 90 - (ARC_ANGLE / 2);
        break;
      case 'e': // Right anchor - arc points leftward toward center (flip for Y rotation)
        startAngle = 0 - (ARC_ANGLE / 2);
        break;
      case 'w': // Left anchor - arc points rightward toward center (flip for Y rotation)
      default:
        startAngle = 180 - (ARC_ANGLE / 2);
        break;
    }
    
    // Get main menu items only
    const mainMenuItems = radialMenuItems.filter(item => !item.isSubItem);
    const numButtons = mainMenuItems.length;
    
    // Calculate angle step (matching 2D menu: divide arc by numButtons-1, or 0 if single item)
    const angleStep = numButtons > 1 ? ARC_ANGLE / (numButtons - 1) : 0;
    
    console.log(`🎯 animateMenuItems: anchor=${currentAnchor}, direction=${direction}, startAngle=${startAngle}°, items=${numButtons}`);
    
    mainMenuItems.forEach((item, index) => {
      if (!item.container) return;
      
      // Calculate angle for this button (same as 2D menu)
      const angleDeg = startAngle + (index * angleStep);
      const angleRad = angleDeg * (Math.PI / 180);
      
      // Calculate position (same math as 2D menu, but in 3D space)
      const targetX = Math.cos(angleRad) * BUTTON_RADIUS;
      const targetY = Math.sin(angleRad) * BUTTON_RADIUS;
      const targetZ = -menuConfig.distance * 0.5; // In front of camera
      
      console.log(`  📍 ${item.text}: angle=${angleDeg.toFixed(1)}°, pos=(${targetX.toFixed(2)}, ${targetY.toFixed(2)}), normalizedScale=${item.normalizedScale}`);
      
      // RESET container state before positioning
      item.container.scaling.setAll(1.0);
      item.container.position.set(0, 0, 0);
      
      // Position container at target
      item.container.position.set(targetX, targetY, targetZ);
      
      // Set scale directly without animation
      item.container.scaling.setAll(1.0);
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
    hideTooltip();
    
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
      // Pass total count and arc number for multi-arc layouts
      hud.addRadialMenuItem(itemName, icon, value.callback, color, totalSubmenuItems, null, value.arc);
    });
    
    // No back button needed
    
    // Position submenu items in an arc
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
      'research': 'Research'
    };
    return names[menuLevel] || menuLevel;
  }
  
  // Get icon for menu item - only used for text fallback, sprites are primary
  function getIconForItem(key) {
    const fallbacks = {
      scribes: '📝', prospecting: '⛏️', patronage: '👑', stewardship: '🏛️',
      drayage: '🚛', artillery: '💣', armor: '🛡️', home: '🏠',
    };
    return fallbacks[key] || '❓';
  }
  
  // Get color for category (mirrors 2D menu colors)
  function getColorForCategory(category) {
    const colors = {
      'buildings': new BABYLON.Color3(0, 1, 0), // Green
      'units': new BABYLON.Color3(0.2, 0.6, 1), // Blue
      'research': new BABYLON.Color3(1, 1, 0) // Yellow
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
      // Dispose container (this disposes all children including mesh)
      if (item.container && !item.container.isDisposed()) {
        item.container.dispose();
      }
    });
    
    // Remove submenu items from the array
    radialMenuItems = radialMenuItems.filter(item => !item.isSubItem);
  }
  
  // Position submenu items in an arc relative to the CLICKED CATEGORY BUTTON
  // Supports multiple arcs via item.arc property (1 = inner, 2 = outer, etc.)
  function positionSubmenuItemsInArc(screenX, screenY) {
    const rect = hud.canvas.getBoundingClientRect();
    
    // Use the clicked category button position (screenX, screenY) as the anchor
    const buttonX = screenX;
    const buttonY = screenY;
    
    // Calculate the correct direction based on the current anchor
    // Submenus should spread AWAY from the screen edge where the anchor is
    let buttonAngle;
    // Convert anchor to angle (matching main menu's Y-up flipped coordinates)
    switch (currentAnchor) {
      case 'top':
        buttonAngle = 3 * Math.PI / 2; // 270° = down
        break;
      case 'bottom':
        buttonAngle = Math.PI / 2; // 90° = up
        break;
      case 'left':
        // Flipped for radialMenu's Y rotation
        buttonAngle = Math.PI; // 180° = spread right (toward center)
        break;
      case 'right':
        // Flipped for radialMenu's Y rotation
        buttonAngle = 0; // 0° = spread left (toward center)
        break;
      default:
        buttonAngle = Math.PI / 2;
        break;
    }
    
    // Spread submenu items in a gentle arc - use config values
    const arcSpread = menuConfig.submenuArcAngle * (Math.PI / 180);
    
    const submenuItems = radialMenuItems.filter(item => item.isSubItem);
    
    // Group items by arc number (default to arc 1 if not specified)
    const arcGroups = new Map();
    submenuItems.forEach(item => {
      const arcNum = item.arc || 1;
      if (!arcGroups.has(arcNum)) {
        arcGroups.set(arcNum, []);
      }
      arcGroups.get(arcNum).push(item);
    });
    
    // Base radius and spacing between arcs
    const BASE_RADIUS = menuConfig.submenuRadius;
    const ARC_SPACING = 0.4; // Distance between successive arcs
    
    // Position each arc group
    arcGroups.forEach((items, arcNum) => {
      // Calculate radius for this arc (arc 1 = base, arc 2 = base + spacing, etc.)
      const arcRadius = BASE_RADIUS + (arcNum - 1) * ARC_SPACING;
      
      // Fixed spacing between items, but cap total spread
      const ITEM_SPACING = 28 * (Math.PI / 180); // 28 degrees between each button
      const idealSpread = (items.length - 1) * ITEM_SPACING;
      
      // Cap at max arc spread, and shrink spacing proportionally if needed
      const itemSpread = Math.min(arcSpread, idealSpread);
      const actualSpacing = items.length > 1 ? itemSpread / (items.length - 1) : 0;
      
      const startAngle = buttonAngle - itemSpread / 2;
      const endAngle = buttonAngle + itemSpread / 2;
      
      items.forEach((item, index) => {
      if (!item.container) return;
      
        // Calculate angle for this item within its arc
      let angle;
        if (items.length === 1) {
        angle = (startAngle + endAngle) / 2;
      } else {
          const angleStep = (endAngle - startAngle) / (items.length - 1);
        angle = startAngle + (index * angleStep);
      }
      
      if (isNaN(angle)) {
        console.warn(`⚠️ Invalid angle for submenu item ${index}: ${angle}`);
        return;
      }
      
        // Calculate position using the arc-specific radius
        const targetX = Math.cos(angle) * arcRadius;
        const targetY = Math.sin(angle) * arcRadius;
      const targetZ = -menuConfig.distance * 0.5;
      
        // console.log(`  📍 Submenu ${item.text} (arc ${arcNum}): angle=${(angle * 180 / Math.PI).toFixed(1)}°, radius=${arcRadius.toFixed(2)}, pos=(${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
      
      // Reset and position container
      item.container.scaling.setAll(1.0);
      item.container.position.set(targetX, targetY, targetZ);
      });
    });
  }
  
  
  // Retract a button (remove it immediately)
  function retractButton(item) {
    if (!item.container) return;
    
    // Dispose immediately without animation
    item.container.dispose();
  }
  
  // Position all items at the same anchor with same spread
  function positionItemsAtAnchor(screenX, screenY) {
    radialMenuItems.forEach((item, index) => {
      if (item.container) {
        const position = calculateMenuItemPosition(item);
        item.container.position.copyFrom(position);
      }
    });
  }
  
  // Position expanded menu items immediately
  function animateExpandedMenu(screenX, screenY) {
    radialMenuItems.forEach((item, index) => {
      if (!item.container) return;
      
      if (item.isSubItem) {
        const targetPos = calculateExpandedItemPosition(item, screenX, screenY);
        
        // Set position directly without animation
        item.container.position.copyFrom(targetPos);
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
  
  // Position menu items back to main level immediately
  function animateMenuCollapse(screenX, screenY) {
    restoreMainMenuItems();
    
    radialMenuItems.forEach((item, index) => {
      if (!item.container) return;
      
      const targetPos = calculateMenuItemPosition(item);
      
      // Set position directly without animation
      item.container.position.copyFrom(targetPos);
    });
  }
  
  // Restore main menu items to full size immediately
  function restoreMainMenuItems() {
    radialMenuItems.forEach(item => {
      if (!item.isSubItem && item.container) {
        // Set scale directly without animation
        item.container.scaling.setAll(1.0);
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
  
  // Clear all menu item containers
  function clearMenuItems() {
    radialMenuItems.forEach(item => {
      if (item.container) {
        item.container.dispose();
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
      
      // Create main menu items: units, buildings (middle), research
      hud.addRadialMenuItem("Units", "👥", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("units");
      }, new BABYLON.Color3(0.2, 0.6, 1), null, 'assets/models/gnome.glb'); // Blue with gnome model

      hud.addRadialMenuItem("Buildings", "🏗️", () => hud.showSubMenu("buildings"), new BABYLON.Color3(0, 1, 0)); // Green - in the middle

      hud.addRadialMenuItem("Research", "🔬", () => {
        // Exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
        hud.showSubMenu("research");
      }, new BABYLON.Color3(1, 1, 0), null, 'assets/models/mushroom.glb'); // Yellow with mushroom model
    }
    
    // Ensure containers are enabled (positioning is handled by animateMenuItems)
    radialMenuItems.forEach((item, index) => {
      if (!item.isSubItem && item.container) {
        item.container.setEnabled(true);
        
        // If mesh loaded, ensure it's visible too
        if (item.mesh) {
          item.mesh.isVisible = true;
          item.mesh.setEnabled(true);
        }
      }
    });
    
    // console.log('✅ Main menu initialized with', radialMenuItems.filter(item => !item.isSubItem).length, 'main categories');
  }
  
  // Add item to radial menu - DIRECTIONAL SYSTEM
  hud.addRadialMenuItem = function(text, icon, callback, color, totalCount, modelPath, arcNumber) {
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
      arc: arcNumber || 1, // Which arc to place this item in (1 = inner, 2 = outer, etc.)
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
        // No animation on click
        
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
  // Key principle: Create container IMMEDIATELY (synchronously)
  // Model loads async and parents to container - position is already correct
  // Models themselves are pickable (no separate hit spheres needed)
  function createMenuItemMesh(item) {
    if (!hud.scene || !radialMenu) return;
    
    // If container already exists, just re-enable it
    if (item.container && !item.container.isDisposed()) {
      item.container.setEnabled(true);
      if (item.mesh) item.mesh.setEnabled(true);
      return;
    }
    
    // === STEP 1: Create container IMMEDIATELY (synchronous) ===
    const container = new BABYLON.TransformNode(`menuContainer_${item.text}`, hud.scene);
    container.parent = radialMenu;
    item.container = container;
    item.normalizedScale = 1.0; // Default, updated when model loads
    
    // === STEP 2: Helper to make any mesh clickable for this item ===
    function setupMeshActions(mesh) {
      mesh.isPickable = true;
      mesh.actionManager = new BABYLON.ActionManager(hud.scene);
      
      mesh.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickDownTrigger,
        (evt) => {
          if (evt && evt.sourceEvent) {
            evt.sourceEvent.stopPropagation();
            evt.sourceEvent.preventDefault();
          }
          if (item.callback) item.callback();
          if (item.text === "Back") hud.hideRadialMenu();
        }
      ));
    }
    
    // Store the setup function on item for use when mesh loads
    item.setupMeshActions = setupMeshActions;
    
    // === STEP 3: Create hitbox IMMEDIATELY (synchronous) so it's clickable right away ===
    // Don't wait for model to load - create a clickable hitbox now
    const HITBOX_SIZE = 0.4;
    const hitbox = BABYLON.MeshBuilder.CreateBox(`hitbox_${item.text}`, {
      width: HITBOX_SIZE,
      height: HITBOX_SIZE,
      depth: HITBOX_SIZE
    }, hud.scene);
    
    hitbox.parent = container;
    hitbox.position.set(0, 0, 0);
    hitbox.isVisible = true;
    hitbox.isPickable = true;
    hitbox.renderingGroupId = 3;
    
    // Make hitbox nearly invisible but pickable
    const hitboxMat = new BABYLON.StandardMaterial(`hitboxMat_${item.text}`, hud.scene);
    hitboxMat.alpha = 0.01;
    hitboxMat.disableLighting = true;
    hitbox.material = hitboxMat;
    
    // Make hitbox clickable immediately
    setupMeshActions(hitbox);
    item.hitbox = hitbox;
    
    // === STEP 4: Create atlas sprite for menu item (synchronous, no model loading) ===
    const itemKey = item.text.toLowerCase();
    let spriteType = null;

    if (item.customModelPath) {
      spriteType = window.gfx.ATLAS_TYPE_ALIASES[itemKey] || itemKey;
    } else if (item.text === "Buildings" && !item.isSubItem) {
      spriteType = 'buildings';
    } else if (item.menuCategory === 'units') {
      spriteType = itemKey;
    } else if (item.menuCategory === 'buildings') {
      spriteType = itemKey;
    } else {
      spriteType = itemKey;
    }

    const sprite = window.gfx && window.gfx.createAtlasSprite
      ? window.gfx.createAtlasSprite(spriteType, hud.scene, 0.4)
      : null;

    if (sprite) {
      sprite.name = `menuItem_${item.text}`;
      sprite.parent = container;
      sprite.position.set(0, 0, 0);
      sprite.renderingGroupId = 2;
      sprite.isVisible = true;
      sprite.setEnabled(true);
      sprite.isPickable = false;
      item.mesh = sprite;
      item.normalizedScale = 1.0;
    } else {
      createFallbackMeshInContainer(item, container);
    }

    // Apply availability styling
    applyMenuItemAvailability(item);
  }
  
  // Create fallback cube inside an existing container
  function createFallbackMeshInContainer(item, container) {
    const baseSize = 0.4;
    const finalSize = item.scale ? baseSize * item.scale : baseSize;
    const mesh = BABYLON.MeshBuilder.CreateBox(`menuItem_${item.text}`, {size: finalSize}, hud.scene);
    
    const material = new BABYLON.StandardMaterial(`menuMat_${item.text}`, hud.scene);
    material.emissiveColor = item.color;
    material.disableLighting = true;
    mesh.material = material;
    
    mesh.parent = container;
    mesh.position.set(0, 0, 0);
    mesh.renderingGroupId = 1;
    mesh.isVisible = true;
    mesh.setEnabled(true);
    mesh.isPickable = false;
    
    item.mesh = mesh;
    item.normalizedScale = 1.0;
  }

  // === 3D Menu Tooltip (in-scene) ===
  let tooltipPlane = null;
  let tooltipTexture = null;
  let tooltipCurrentItem = null;
  let hoveredItem = null;
  let hoveredContainer = null;

  function getTooltipPlane() {
    if (tooltipPlane && !tooltipPlane.isDisposed()) return tooltipPlane;
    tooltipPlane = BABYLON.MeshBuilder.CreatePlane('menuTooltip3D', { width: 0.7, height: 0.22 }, hud.scene);
    const mat = new BABYLON.StandardMaterial('menuTooltipMat', hud.scene);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    tooltipTexture = new BABYLON.DynamicTexture('menuTooltipTex', { width: 512, height: 160 }, hud.scene);
    mat.diffuseTexture = tooltipTexture;
    mat.opacityTexture = tooltipTexture;
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    tooltipPlane.material = mat;
    tooltipPlane.parent = hud.camera;
    tooltipPlane.renderingGroupId = 3;
    tooltipPlane.isPickable = false;
    tooltipPlane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    tooltipPlane.setEnabled(false);
    return tooltipPlane;
  }

  function showTooltipForItem(item) {
    if (tooltipCurrentItem === item) return;
    tooltipCurrentItem = item;

    const plane = getTooltipPlane();
    const tex = tooltipTexture;
    const ctx = tex.getContext();
    tex.clear();

    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 160, 14);
    ctx.fill();

    const itemKey = item.text.toLowerCase();
    let label = item.text;
    let costStr = '';
    let statusStr = '';

    if (item.menuCategory === 'buildings') {
      if (window.formatBuildingCost) costStr = window.formatBuildingCost(itemKey);
      if (item.availabilityState === 'locked') statusStr = window.getMissingPrerequisites ? window.getMissingPrerequisites('buildings', itemKey) : 'Requires prerequisite';
    } else if (item.menuCategory === 'units') {
      if (window.formatUnitCost) costStr = window.formatUnitCost(itemKey);
      if (item.availabilityState === 'locked') statusStr = window.getMissingPrerequisites ? window.getMissingPrerequisites('units', itemKey) : 'Requires prerequisite';
    } else if (item.menuCategory === 'research') {
      if (window.formatResearchCost) costStr = window.formatResearchCost(itemKey);
      if (item.availabilityState === 'locked') statusStr = window.getMissingPrerequisites ? window.getMissingPrerequisites('research', itemKey) : 'Requires prerequisite';
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = 'bold 36px Arial';
    ctx.fillStyle = 'white';
    let yPos = costStr || statusStr ? 45 : 80;
    ctx.fillText(label, 256, yPos);

    if (costStr) {
      ctx.font = '28px Arial';
      ctx.fillStyle = '#ddd';
      ctx.fillText(costStr, 256, 95);
    }

    if (statusStr) {
      ctx.font = '24px Arial';
      ctx.fillStyle = item.availabilityState === 'locked' ? '#999' : '#f88';
      ctx.fillText(statusStr, 256, costStr ? 135 : 115);
    }

    tex.update();

    // Position above the hovered item's container in camera-local space
    if (item.container && !item.container.isDisposed()) {
      const itemWorldPos = item.container.absolutePosition;
      const cameraMatrix = BABYLON.Matrix.Invert(hud.camera.getWorldMatrix());
      const localPos = BABYLON.Vector3.TransformCoordinates(itemWorldPos, cameraMatrix);
      plane.position.set(localPos.x, localPos.y + 0.32, localPos.z);
    }

    plane.setEnabled(true);
  }

  function hideTooltip() {
    if (tooltipPlane && !tooltipPlane.isDisposed()) tooltipPlane.setEnabled(false);
    tooltipCurrentItem = null;
    if (hoveredContainer) {
      hoveredContainer.scaling.setAll(1.0);
      hoveredContainer = null;
    }
    hoveredItem = null;
    if (hud.scene) hud.scene.hoverCursor = 'default';
  }

  // Find which menu item owns a given mesh (hitbox lookup)
  function findMenuItemByMesh(mesh) {
    if (!mesh) return null;
    for (const item of radialMenuItems) {
      if (item.hitbox === mesh) return item;
    }
    return null;
  }

  function meshBelongsToRadialMenu(mesh) {
    if (!mesh || !radialMenu) return false;
    let n = mesh;
    while (n) {
      if (n === radialMenu) return true;
      n = n.parent;
    }
    return false;
  }

  /** True if a client point hits pickable 3D radial menu geometry (canvas picks game first otherwise). */
  hud.isTouchOverOpenRadialMenu = function(clientX, clientY) {
    if (!radialMenuVisible || !hud.scene || !hud.canvas || !radialMenu || !window.USE_3D_HUD) return false;
    const rect = hud.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return false;
    const pick = hud.scene.pick(x, y, (m) => m.isPickable && meshBelongsToRadialMenu(m));
    return !!(pick && pick.hit);
  };

  function applyRadialMenuHoverAtCanvas(offsetX, offsetY) {
    if (!radialMenuVisible || !hud.scene) return;

    const pick = hud.scene.pick(
      offsetX,
      offsetY,
      (m) => m.isPickable && m.name.startsWith('hitbox_')
    );

    const hitMesh = pick && pick.hit ? pick.pickedMesh : null;
    const item = findMenuItemByMesh(hitMesh);

    if (item && item !== hoveredItem) {
      if (hoveredContainer) hoveredContainer.scaling.setAll(1.0);

      hoveredItem = item;
      hoveredContainer = item.container;
      if (hoveredContainer) hoveredContainer.scaling.setAll(1.15);
      if (hud.scene) hud.scene.hoverCursor = 'pointer';
      showTooltipForItem(item);
    } else if (!item && hoveredItem) {
      hideTooltip();
    }
  }

  /** Drive the same hover + cost tooltip as mouse move, using screen client coordinates (touch). */
  hud.updateRadialMenuHoverAtClient = function(clientX, clientY) {
    if (!hud.canvas || !radialMenuVisible) return;
    const rect = hud.canvas.getBoundingClientRect();
    applyRadialMenuHoverAtCanvas(clientX - rect.left, clientY - rect.top);
  };

  /** Call when a menu-bound touch lifts so scale/tooltip matches mouse-out. */
  hud.clearRadialMenuHoverHighlight = function() {
    hideTooltip();
  };

  // Scene pointer observable for hover detection - only active when menu is visible
  function initMenuHoverDetection() {
    if (!hud.scene) return;
    hud.scene.onPointerObservable.add((pointerInfo) => {
      if (!radialMenuVisible) return;
      if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERMOVE) return;

      applyRadialMenuHoverAtCanvas(pointerInfo.event.offsetX, pointerInfo.event.offsetY);
    });
  }

  // Hide tooltip when menu closes
  const origHideRadialMenu = hud.hideRadialMenu;
  hud.hideRadialMenu = function() {
    hideTooltip();
    if (window.touch && typeof window.touch.clear3DRadialMenuTouchPointers === 'function') {
      window.touch.clear3DRadialMenuTouchPointers();
    }
    if (origHideRadialMenu) origHideRadialMenu.apply(this, arguments);
  };

  // Check availability and apply visual treatment to a 3D menu item
  function applyMenuItemAvailability(item) {
    if (!item.mesh || !item.menuCategory) return;
    const itemKey = item.text.toLowerCase();
    
    let hasPrereqs = true;
    let canAfford = true;

    if (item.menuCategory === 'buildings') {
      if (window.hasPrerequisitesBuilding) hasPrereqs = window.hasPrerequisitesBuilding(itemKey);
      if (window.canAffordBuilding) canAfford = window.canAffordBuilding(itemKey);
    } else if (item.menuCategory === 'units') {
      if (window.hasPrerequisitesUnit) hasPrereqs = window.hasPrerequisitesUnit(itemKey);
      if (window.canAffordUnit) canAfford = window.canAffordUnit(itemKey);
    } else if (item.menuCategory === 'research') {
      if (window.hasPrerequisitesResearch) hasPrereqs = window.hasPrerequisitesResearch(itemKey);
      if (window.canAffordResearch) canAfford = window.canAffordResearch(itemKey);
    } else {
      return;
    }

    const mat = item.mesh.material;
    if (!mat) return;

    if (!hasPrereqs) {
      // Greyed out - dark desaturated tint
      mat.emissiveColor = new BABYLON.Color3(0.25, 0.25, 0.25);
      if (mat.diffuseTexture) mat.diffuseTexture.level = 0.3;
      item.availabilityState = 'locked';
    } else if (!canAfford) {
      // Red tint - can see what it is but clearly marked
      mat.emissiveColor = new BABYLON.Color3(0.8, 0.25, 0.25);
      if (mat.diffuseTexture) mat.diffuseTexture.level = 1.0;
      item.availabilityState = 'expensive';
    } else {
      // Available - full brightness
      mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
      if (mat.diffuseTexture) mat.diffuseTexture.level = 1.0;
      item.availabilityState = 'available';
    }
  }

  // Refresh availability on all current 3D menu items
  function update3DMenuStates() {
    radialMenuItems.forEach(item => applyMenuItemAvailability(item));
  }

  hud.update3DMenuStates = update3DMenuStates;
  
  
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
      mineralsElement.textContent = `💎 ${resources.minerals || 0}`;
    }
    
    // Update population display (count of player units)
    const popElement = document.getElementById('stat_pop');
    if (popElement && window.player.units) {
      const population = window.player.units.length;
      popElement.textContent = `👥 ${population}`;
    }
  }

  // Atlas cell positions for selection panel sprites
  const SEL_ATLAS_CELLS = {
    trees: [0,0], rocks_plain: [1,0], rocks_moss: [2,0], rocks_snow: [3,0],
    mushroom: [4,0], tortle: [5,0], birdy: [6,0], frog: [7,0],
    windvane: [0,1], flag: [1,1], agora: [2,1], camp: [3,1],
    village: [4,1], farm: [5,1], silo: [6,1], tower: [7,1],
    mine: [0,2], tavern: [1,2], moonwell: [2,2], barracks: [3,2],
    lab: [4,2], workshop: [5,2], factory: [6,2], church: [7,2],
    well: [0,3], perch: [1,3], villager: [2,3], brigand: [3,3],
    engineer: [4,3], monk: [5,3], wizard: [6,3], warlock: [7,3],
    warrior: [0,4], archer: [1,4], priest: [2,4], shaman: [3,4],
    myco: [4,4], wagon: [5,4], dirigible: [6,4], apc: [7,4],
  };

  const SEL_TYPE_ALIASES = {
    mycorrhizae: 'myco', grove: 'trees',
    architect: 'engineer', geomancer: 'wizard', druid: 'wizard', alchemist: 'wizard',
    champion: 'brigand', ballister: 'brigand', paladin: 'warrior',
    valkyrie: 'monk', elemental: 'wizard',
    war_wagon: 'wagon', war_balloon: 'dirigible', tank: 'apc',
    frog_scout: 'frog', bird_messenger: 'birdy', mushroom_mage: 'myco',
    scout: 'villager', rider: 'brigand', infantry: 'warrior',
    crossbowman: 'archer', knight: 'warrior', catapult: 'wagon',
    ballista: 'archer', gnome: 'villager',
  };

  function getSelSpriteHTML(unitType) {
    const key = SEL_TYPE_ALIASES[unitType] || unitType;
    const cell = SEL_ATLAS_CELLS[key];
    if (!cell) return null;
    const bgX = cell[0] * 100 / 7;
    const bgY = cell[1] * 100 / 7;
    return `<div class="sprite-icon sprite-icon-sm" style="background-position:${bgX.toFixed(2)}% ${bgY.toFixed(2)}%"></div>`;
  }

  function getUnitIconForSelection(unitType) {
    return getSelSpriteHTML(unitType) || '👤';
  }

  // Update 2D selection panel: one icon per unit type + count
  function updateSelectionPanel() {
    if (window.USE_3D_HUD) return; // Only in 2D HUD mode
    const panel = document.getElementById('selection_panel');
    if (!panel) return;
    if (!window.player || typeof window.player.getSelectedUnits !== 'function') {
      panel.innerHTML = '';
      return;
    }
    const selected = window.player.getSelectedUnits();
    if (selected.length === 0) {
      panel.innerHTML = '';
      return;
    }
    // Group by type only
    const byType = new Map();
    selected.forEach(unit => {
      const t = unit.type || 'unknown';
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(unit);
    });
    const items = [];
    for (const [type, units] of byType) {
      const icon = getUnitIconForSelection(type);
      const count = units.length;
      const typeName = (window.UnitTypes && window.UnitTypes[type]) ? window.UnitTypes[type].name : type;
      const label = (count === 1 && units[0].getDisplayName) ? units[0].getDisplayName() : typeName;
      items.push(`<span class="selection_panel_item" title="${typeName}">${icon} ${count}<br><span class="selection_panel_label">${label}</span></span>`);
    }
    panel.innerHTML = items.join('');
  }

  hud.updateSelectionPanel = updateSelectionPanel;

  // ===== 3D SELECTION PANEL (mirrors 2D selection panel, for 3D HUD mode) =====
  let selectionPanel3DItems = [];

  function _isDisposed(obj) {
    if (!obj) return true;
    return typeof obj.isDisposed === 'function' ? obj.isDisposed() : (obj.isDisposed === true);
  }

  // Convert screen pixels to camera-local position (same formula as anchors - they work)
  function screenToCameraLocal(screenX, screenY) {
    if (!hud.camera || !hud.canvas) return new BABYLON.Vector3(0, 0, menuConfig.distance);
    const rect = hud.canvas.getBoundingClientRect();
    const normalizedX = (screenX / rect.width) * 2 - 1;   // -1 to 1
    const normalizedY = 1 - (screenY / rect.height) * 2; // 1 to -1 (flip Y)
    const fov = hud.camera.fov;
    const aspect = rect.width / rect.height;
    const distance = menuConfig.distance;
    return new BABYLON.Vector3(
      normalizedX * distance * Math.tan(fov / 2) * aspect,
      normalizedY * distance * Math.tan(fov / 2),
      distance
    );
  }

  function dispose3DSelectionPanel() {
    selectionPanel3DItems.forEach(item => {
      if (item.container && !_isDisposed(item.container)) item.container.dispose();
      if (item.plane && !_isDisposed(item.plane)) item.plane.dispose();
      if (item.texture && !_isDisposed(item.texture)) item.texture.dispose();
    });
    selectionPanel3DItems = [];
  }

  function update3DSelectionPanel() {
    if (!window.USE_3D_HUD) return;
    if (!window.player || typeof window.player.getSelectedUnits !== 'function') {
      dispose3DSelectionPanel();
      return;
    }
    const selected = window.player.getSelectedUnits();
    if (selected.length === 0) {
      dispose3DSelectionPanel();
      return;
    }
    const byType = new Map();
    selected.forEach(unit => {
      const t = unit.type || 'unknown';
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(unit);
    });
    const entries = Array.from(byType.entries()).map(([type, units]) => [type, units.length, units]);
    if (!hud.scene || !hud.camera) return;

    const ITEM_WIDTH = 0.14;
    const ITEM_HEIGHT = 0.14;
    const ITEM_PX_WIDTH = 80;
    const BASE_X = 85;
    const BASE_Y = 35;

    for (let i = 0; i < entries.length; i++) {
      const [type, count, units] = entries[i];
      const icon = getUnitIconForSelection(type);
      const typeName = (window.UnitTypes && window.UnitTypes[type]) ? window.UnitTypes[type].name : type;
      const label = (count === 1 && units[0].getDisplayName) ? units[0].getDisplayName() : typeName;

      const screenX = BASE_X + i * ITEM_PX_WIDTH;
      const screenY = BASE_Y;
      const localPos = screenToCameraLocal(screenX, screenY);

      let item = selectionPanel3DItems[i];
      if (!item || item.type !== type || item.count !== count) {
        if (item) {
          if (item.container && !_isDisposed(item.container)) item.container.dispose();
          if (item.plane && !_isDisposed(item.plane)) item.plane.dispose();
          if (item.texture && !_isDisposed(item.texture)) item.texture.dispose();
        }
        // Each item gets its own container at its own position - avoids rotation, works with camera
        const container = new BABYLON.TransformNode(`SelectionPanel3D_${i}`, hud.scene);
        container.parent = hud.camera;
        container.position.copyFrom(localPos);

        const plane = BABYLON.MeshBuilder.CreatePlane(`SelectionPanel3D_item_${i}`, {
          width: ITEM_WIDTH,
          height: ITEM_HEIGHT
        }, hud.scene);
        const mat = new BABYLON.StandardMaterial(`SelectionPanel3D_mat_${i}`, hud.scene);
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mat.emissiveColor = new BABYLON.Color3(0.6, 0.6, 0.6);
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        mat.depthWrite = false;
        const texture = new BABYLON.DynamicTexture(`SelectionPanel3D_tex_${i}`, 128, hud.scene);
        mat.diffuseTexture = texture;
        mat.opacityTexture = texture;
        plane.material = mat;
        plane.parent = container;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;
        plane.renderingGroupId = 2;
        item = { container, plane, texture, type, count };
        selectionPanel3DItems[i] = item;
      }

      if (item.container) item.container.position.copyFrom(localPos);

      const ctx = item.texture.getContext();
      item.texture.clear();
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, 128, 128);

      // Draw atlas sprite onto canvas if available
      const atlasImg = window.gfx && window.gfx.getAtlasImage ? window.gfx.getAtlasImage() : null;
      const selKey = SEL_TYPE_ALIASES[type] || type;
      const selCell = SEL_ATLAS_CELLS[selKey];
      if (atlasImg && selCell) {
        const cellPx = atlasImg.width / 8;
        const sx = selCell[0] * cellPx, sy = selCell[1] * cellPx;
        ctx.drawImage(atlasImg, sx, sy, cellPx, cellPx, 14, 2, 56, 56);
      }

      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 22px Arial";
      ctx.fillText(`x${count}`, 64, 80);
      ctx.font = "14px Arial";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(label, 64, 105);
      item.texture.update();
      item.plane.setEnabled(true);
    }

    for (let i = entries.length; i < selectionPanel3DItems.length; i++) {
      const it = selectionPanel3DItems[i];
      if (it.container && !_isDisposed(it.container)) it.container.dispose();
      if (it.plane && !_isDisposed(it.plane)) it.plane.dispose();
      if (it.texture && !_isDisposed(it.texture)) it.texture.dispose();
    }
    selectionPanel3DItems.length = entries.length;
  }

  hud.update3DSelectionPanel = update3DSelectionPanel;
  hud.dispose3DSelectionPanel = dispose3DSelectionPanel;

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

    // Zoomed out (large arc-rotate radius) → merge edge icons harder; zoomed in → keep spread
    let z = 0;
    const cam = hud.camera;
    if (cam && typeof cam.radius === 'number' &&
        typeof cam.lowerRadiusLimit === 'number' && typeof cam.upperRadiusLimit === 'number') {
      const span = cam.upperRadiusLimit - cam.lowerRadiusLimit;
      z = span > 1e-6 ? (cam.radius - cam.lowerRadiusLimit) / span : 0;
      z = Math.min(1, Math.max(0, z));
    }
    minimapZoomSmooth = z * z * (3 - 2 * z); // smoothstep — stable HUD polish
    // Extra weight at high z so “especially far” collapses stacks; stays gentle when zoomed in
    minimapMergeT = Math.min(1, minimapZoomSmooth + Math.pow(z, 2.15) * 0.68);

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
        const baseCorner = `corner-${cornerY}${cornerX}`;

        let corner;
        let edgeSpread = 0;

        if (minimapMergeT >= MINIMAP_MERGE_PER_TYPE) {
          // Fully zoomed out: one edge marker per unit type (centroid picks the edge)
          corner = 'off';
        } else if (minimapMergeT >= MINIMAP_MERGE_COARSE) {
          // Mid–zoom out: merge along whole edges / quadrants — no v/h micro-buckets
          corner = baseCorner;
        } else {
          // Zoomed in: keep positional spread, but still fewer buckets when partly zoomed
          const absRight = Math.abs(rightDot);
          const absUp = Math.abs(upDot);
          const totalMag = absRight + absUp;

          const rightNorm = absRight / totalMag;
          const upNorm = absUp / totalMag;

          const cornerThreshold = 0.42 + 0.08 * (minimapMergeT / Math.max(0.001, MINIMAP_MERGE_COARSE));
          const EDGE_SPREAD_BUCKETS = minimapMergeT < MINIMAP_MERGE_ONE_BUCKET ? 3 : 1;

          let spreadDir;
          if (rightNorm > cornerThreshold && rightNorm < (1 - cornerThreshold) &&
              upNorm > cornerThreshold && upNorm < (1 - cornerThreshold)) {
            spreadDir = rightNorm > upNorm ? 'v' : 'h';
            edgeSpread = 0;
            corner = `${baseCorner}_${spreadDir}0`;
          } else if (rightNorm > upNorm) {
            spreadDir = 'v';
            edgeSpread = Math.max(0, (rightNorm - (1 - cornerThreshold)) / cornerThreshold);
            const bucket = Math.min(
              EDGE_SPREAD_BUCKETS - 1,
              Math.floor(edgeSpread * EDGE_SPREAD_BUCKETS + 1e-6)
            );
            corner = `${baseCorner}_v${bucket}`;
          } else {
            spreadDir = 'h';
            edgeSpread = Math.max(0, (upNorm - (1 - cornerThreshold)) / cornerThreshold);
            const bucket = Math.min(
              EDGE_SPREAD_BUCKETS - 1,
              Math.floor(edgeSpread * EDGE_SPREAD_BUCKETS + 1e-6)
            );
            corner = `${baseCorner}_h${bucket}`;
          }
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
  function getTypeOffset(unitType, mergeStrength) {
    const t = typeof mergeStrength === 'number' ? mergeStrength : minimapMergeT;
    if (t >= MINIMAP_MERGE_COARSE) return { x: 0, y: 0 };

    let hash = 0;
    for (let i = 0; i < unitType.length; i++) {
      hash = ((hash << 5) - hash) + unitType.charCodeAt(i);
      hash = hash & hash;
    }

    const offsetMagnitude = 0.045 * (1 - t * 1.35);
    const xOffset = ((hash % 100) / 100 - 0.5) * 2 * Math.max(0, offsetMagnitude);
    return { x: xOffset, y: 0 };
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
    
    // Check if unit is behind camera - projection becomes unstable/inverted
    // projected.z < 0 or > 1 means unit is outside the view frustum depth
    // For behind-camera units, we use camera-space vectors instead of screen projection
    const isBehindCamera = projected.z < 0 || projected.z > 1;
    
    let dirX, dirY;
    if (isBehindCamera) {
      // Unit is behind camera - use camera-space vectors for stable direction
      // This prevents jumping when camera angle changes
      const rightDot = -BABYLON.Vector3.Dot(toUnit, cameraRight);
      const upDot = BABYLON.Vector3.Dot(toUnit, cameraUp);
      const forwardDot = BABYLON.Vector3.Dot(toUnit, cameraForward);
      
      // For behind-camera units, we need to flip the direction
      // (they project to opposite side in screen space)
      // rightDot: positive = unit is to our right
      // upDot: positive = unit is above us (in camera space)
      // forwardDot: negative = behind camera
      
      // Map to screen direction (invert because behind camera)
      // Also force behind-camera units toward bottom of screen for intuitive navigation
      dirX = rightDot * halfW;
      // For units behind camera, bias strongly toward bottom edge
      // Use a blend: mostly bottom, but still respect left/right positioning
      const behindBias = Math.min(1, Math.abs(forwardDot) * 2); // How "behind" (0-1)
      dirY = halfH * (0.5 + behindBias * 0.5); // Push toward bottom
    } else {
      // Target position in pixels (may be off-screen but in front of camera)
      const targetX = projected.x * rect.width;
      const targetY = projected.y * rect.height;
      
      // Direction from screen center toward the unit
      dirX = targetX - centerX;
      dirY = targetY - centerY;
    }
    
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
    const typeOffset = getTypeOffset(group.type, minimapMergeT);
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
      // Create new indicator using atlas sprite (lightweight billboard)
      if (!window.gfx) return;

      const spriteType = group.type;
      indicator = window.gfx.createAtlasSprite(spriteType, hud.scene, 0.25, { billboard: false });
      if (!indicator) return;

      indicator.name = `edgeIndicator_${index}`;
      indicator.isPickable = true;
      indicator.linkedGroup = group;
      indicator.parent = hud.camera;
      indicator.renderingGroupId = 2;

      indicator.actionManager = new BABYLON.ActionManager(hud.scene);
      indicator.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPickDownTrigger,
        (evt) => {
          const linkedGroup = indicator.linkedGroup;
          if (!linkedGroup || !window.player) return;
          window.player.clearSelection();
          linkedGroup.units.forEach(unit => {
            window.player.selectUnit(unit);
          });
          evt.skipNextObservers = true;
        }
      ));
      indicator.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPointerOverTrigger,
        () => { hud.scene.hoverCursor = 'pointer'; }
      ));
      indicator.actionManager.registerAction(new BABYLON.ExecuteCodeAction(
        BABYLON.ActionManager.OnPointerOutTrigger,
        () => { hud.scene.hoverCursor = 'default'; }
      ));

      minimapIndicators[index] = indicator;
    }
    
    // Update visual based on selection status (sprite has material directly, no child meshes)
    if (hasSelection) {
      if (indicator.material) {
        indicator.material.emissiveColor = new BABYLON.Color3(1, 0.9, 0.5);
      }
      indicator.scaling.setAll(1.25);
    } else {
      if (indicator.material) {
        indicator.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
      }
      indicator.scaling.setAll(1.0);
    }
    
    // Smoothly interpolate to new position (lerp for smooth movement)
    if (!indicator.targetPosition) {
      indicator.targetPosition = localPos.clone();
      indicator.position.copyFrom(localPos);
    } else {
      indicator.targetPosition.copyFrom(localPos);
    }
    
    // Manually face the sprite toward the camera (at local origin since parented to camera)
    // Billboard mode can't be used here - it conflicts with camera parenting
    indicator.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    indicator.rotation.y = Math.atan2(localPos.x, localPos.z) + Math.PI;
    indicator.rotation.x = 0;
    indicator.rotation.z = 0;
    
    // Add/update count badge if group has multiple units
    if (unitCount > 1) {
      if (!indicator.countBadge) {
        // Create count badge (text plane)
        const plane = BABYLON.MeshBuilder.CreatePlane(`countBadge_${index}`, {size: 0.14}, hud.scene);
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
        plane.position.y = 0.15; // Above sprite
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        
        indicator.countBadge = plane;
        indicator.badgeTexture = texture;
      }
      
      // Update badge text
      const texture = indicator.badgeTexture;
      texture.clear();
      const ctx = texture.getContext();
      ctx.font = "bold 26px Arial";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(unitCount.toString(), 32, 32);
      texture.update();
      indicator.countBadge.setEnabled(true);
    } else if (indicator.countBadge) {
      indicator.countBadge.setEnabled(false);
    }
    
    // Click handlers are set up on the sprite plane during creation
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
  
  // Shadow mode labels: 0=Off, 1=Low (solid blobs), 2=Med (gradient blobs), 3=Full
  const SHADOW_LABELS = ['Off', 'Low', 'Med', 'Full'];
  
  // Initialize Shadow slider
  hud.initShadowSlider = function() {
    const slider = document.getElementById('shadow_slider');
    const valueDisplay = document.getElementById('shadow_value');
    
    if (!slider || !valueDisplay) {
      return;
    }
    
    // Load saved shadow setting or use default (2 = Med)
    const savedShadow = localStorage.getItem('shadowMode');
    const initialValue = savedShadow ? parseInt(savedShadow) : 2;
    slider.value = initialValue;
    valueDisplay.textContent = SHADOW_LABELS[initialValue];
    
    // Apply shadow setting
    hud.updateShadowMode(initialValue);
    
    // Track current mode for boundary detection
    let lastAppliedMode = initialValue;
    
    // Add event listener for slider changes
    slider.addEventListener('input', function() {
      const value = parseInt(this.value);
      valueDisplay.textContent = SHADOW_LABELS[value];
      
      // Check if we're crossing the instance/shadow boundary
      // Instanced modes: 0, 1, 2 (Off, Low, Med) - Full mode: 3
      const wasInstanced = lastAppliedMode < 3;
      const willBeInstanced = value < 3;
      const crossingBoundary = wasInstanced !== willBeInstanced;
      
      // Save setting
      localStorage.setItem('shadowMode', value.toString());
      
      // Apply shadow mode
      hud.updateShadowMode(value);
      
      // If crossing boundary, reload resource models dynamically
      if (crossingBoundary && window.gfx && window.gfx.reloadResourceModels) {
        console.log('[Shadows] Crossing instance/shadow boundary, reloading resources...');
        window.gfx.reloadResourceModels();
      }
      
      lastAppliedMode = value;
    });
  };
  
  // Update shadow mode: 0=Off, 1=Low (solid blobs), 2=Med (gradient blobs), 3=Full
  hud.updateShadowMode = function(mode) {
    window.SHADOW_MODE = mode; // 0=Off, 1=Low, 2=Med, 3=Full
    
    if (mode === 0) {
      // Off - disable all shadows
      window.SHADOWS_ENABLED = false;
      
      // Disable full shadows
      if (window.gfx && window.gfx.scene) {
        window.gfx.scene.meshes.forEach(mesh => {
          mesh.receiveShadows = false;
          if (mesh.getChildMeshes) {
            mesh.getChildMeshes().forEach(child => child.receiveShadows = false);
          }
        });
      }
      
      // Flush shadow casters
      if (window.gfx && window.gfx.shadowGenerator && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // Hide all blob shadows
      if (window.gfx && window.gfx.setBlobShadowsVisible) {
        window.gfx.setBlobShadowsVisible(false);
      }
      
      // Enable thin instance mode for static scenery (perf boost!)
      if (window.gfx && window.gfx.setThinInstanceMode) {
        window.gfx.setThinInstanceMode(true);
      }
      
    } else if (mode === 1 || mode === 2) {
      // Low/Med - blob shadows (solid or gradient)
      window.SHADOWS_ENABLED = false;
      
      // Disable full shadows
      if (window.gfx && window.gfx.scene) {
        window.gfx.scene.meshes.forEach(mesh => {
          mesh.receiveShadows = false;
          if (mesh.getChildMeshes) {
            mesh.getChildMeshes().forEach(child => child.receiveShadows = false);
          }
        });
      }
      
      // Flush shadow casters
      if (window.gfx && window.gfx.shadowGenerator && window.gfx.updateAllMeshShadows) {
        window.gfx.updateAllMeshShadows();
      }
      
      // Set blob shadow style (1=solid, 2=gradient)
      if (window.gfx && window.gfx.setBlobShadowStyle) {
        window.gfx.setBlobShadowStyle(mode === 1 ? 'solid' : 'gradient');
      }
      
      // Show blob shadows
      if (window.gfx && window.gfx.setBlobShadowsVisible) {
        window.gfx.setBlobShadowsVisible(true);
      }
      
      // Create blob shadows for existing units
      if (window.gfx && window.gfx.createBlobShadowsForAllUnits) {
        window.gfx.createBlobShadowsForAllUnits();
      }
      
      // Enable thin instance mode for static scenery (perf boost!)
      if (window.gfx && window.gfx.setThinInstanceMode) {
        window.gfx.setThinInstanceMode(true);
      }
      
    } else if (mode === 3) {
      // Full - proper shadow mapping
      window.SHADOWS_ENABLED = true;
      
      // Disable thin instance mode (need individual meshes for shadow mapping)
      if (window.gfx && window.gfx.setThinInstanceMode) {
        window.gfx.setThinInstanceMode(false);
      }
      
      // Hide blob shadows
      if (window.gfx && window.gfx.setBlobShadowsVisible) {
        window.gfx.setBlobShadowsVisible(false);
      }
      
      // Initialize shadow generator if needed
      if (window.gfx) {
        if (!window.gfx.shadowGenerator) {
          if (window.gfx.forceInitializeShadows) {
            window.gfx.forceInitializeShadows();
          } else if (window.gfx.autoInitializeShadows) {
            window.gfx.autoInitializeShadows();
          }
        }
        
        // Update all meshes to receive shadows
        if (window.gfx.updateAllMeshShadows) {
          window.gfx.updateAllMeshShadows(true);
        }
      }
    }
  };
  
  // Legacy function for compatibility
  hud.enableShadows = function() {
    hud.updateShadowMode(3); // Full shadows
    localStorage.setItem('shadowMode', '3');
  };
  
  // Legacy toggle function (now uses slider internally)
  hud.toggleShadowsMode = function() {
    const currentMode = window.SHADOW_MODE || 2;
    const newMode = currentMode === 0 ? 3 : 0;
    hud.updateShadowMode(newMode);
    localStorage.setItem('shadowMode', newMode.toString());
    
    // Update slider if it exists
    const slider = document.getElementById('shadow_slider');
    const valueDisplay = document.getElementById('shadow_value');
    if (slider) slider.value = newMode;
    if (valueDisplay) valueDisplay.textContent = SHADOW_LABELS[newMode];
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

  // Initialize Volume slider (requires DOM elements to exist)
  hud.initVolumeSlider = function() {
    const slider = document.getElementById('volume_slider');
    const valueDisplay = document.getElementById('volume_value');

    if (!slider || !valueDisplay) {
      // console.warn('🔊 Volume slider elements not found, will sync when settings menu opens');
      return;
    }

    // Load saved volume setting or use default (25%)
    const savedVolume = localStorage.getItem('volumeLevel');
    const initialValue = savedVolume ? parseInt(savedVolume) : 25;
    slider.value = initialValue;
    valueDisplay.textContent = initialValue + '%';

    // Apply volume setting
    hud.updateVolumeLevel(initialValue);

    // Add event listener for slider changes
    slider.addEventListener('input', function() {
      const value = parseInt(this.value);
      valueDisplay.textContent = value + '%';

      // Update volume level
      hud.updateVolumeLevel(value);

      // Save setting
      localStorage.setItem('volumeLevel', value.toString());

      // Update slider background color
      hud.updateSliderColor(slider, value);
    });

    // Add change event listener for when user releases mouse
    slider.addEventListener('change', function() {
      const value = parseInt(this.value);
      // Ensure the final value is properly saved
      localStorage.setItem('volumeLevel', value.toString());
    });

    // Set initial color
    hud.updateSliderColor(slider, initialValue);
  };

  // Update volume level (0 = muted, 100 = full volume)
  hud.updateVolumeLevel = function(level) {
    // Store the volume level for audio system to use
    window.currentVolumeLevel = level;

    // If audio system exists, update it
    if (window.aud && window.aud.setVolume) {
      window.aud.setVolume(level);
    }
  };

  // Get current volume level for new audio
  hud.getCurrentVolumeLevel = function() {
    const savedVolume = localStorage.getItem('volumeLevel');
    const level = savedVolume ? parseInt(savedVolume) : 50;
    return level;
  };

  // Get current LOD multiplier for new models
  hud.getCurrentLODMultiplier = function() {
    const savedLOD = localStorage.getItem('lodLevel');
    const level = savedLOD ? parseInt(savedLOD) : 50;
    return 0.3 + (level / 100) * 1.4; // Range from 0.3x to 1.7x
  };

  // Update LOD distances based on slider value (0-100)
  hud.updateLODDistances = function(value) {
    // Level 0 = BILLBOARD ONLY MODE (for low-end mobile devices)
    // Level 1-50 = lower LOD (closer distances)
    // Level 50 = default LOD (current distances)
    // Level 100 = maximum LOD (very far distances)
    
    // Billboard-only mode at 0%
    if (value === 0) {
      if (window.gfx && window.gfx.setBillboardOnlyMode) {
        window.gfx.setBillboardOnlyMode(true);
      }
      // Remove mountains/horizon entirely at LOD 0
      if (window.gfx && window.gfx.removeMountains) {
        window.gfx.removeMountains();
      }
      // console.log('🖼️ LOD 0%: Billboard-only mode enabled for low-end devices');
      return;
    } else {
      // Disable billboard-only mode when slider moves above 0
      if (window.gfx && window.gfx.setBillboardOnlyMode && window.gfx.isBillboardOnlyMode && window.gfx.isBillboardOnlyMode()) {
        window.gfx.setBillboardOnlyMode(false);
      }
      // If mountains were removed at LOD 0, recreate when moving above 0
      if (window.gfx && window.gfx.recreateMountains && !window.gfx.mountains) {
        window.gfx.recreateMountains();
      }
    }
    
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
    
    // Update unit billboard swap distance
    if (window.updateUnitBillboardDistance) {
      window.updateUnitBillboardDistance(multiplier);
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

  // Anti-aliasing slider labels
  const AA_LABELS = ['Off', 'FXAA', 'MSAA 2x', 'MSAA 4x'];
  
  // Track the MSAA level that was applied when engine was created
  let engineMSAALevel = null;
  
  // Initialize Anti-Aliasing slider
  hud.initAASlider = function() {
    const slider = document.getElementById('aa_slider');
    const valueDisplay = document.getElementById('aa_value');
    
    if (!slider || !valueDisplay) {
      return;
    }
    
    // Load saved AA setting or use default (0 = off)
    const savedAA = localStorage.getItem('aaLevel');
    const initialValue = savedAA ? parseInt(savedAA) : 0;
    slider.value = initialValue;
    valueDisplay.textContent = AA_LABELS[initialValue];
    
    // Remember the MSAA level the engine was created with
    if (engineMSAALevel === null) {
      engineMSAALevel = window.gfx && window.gfx.getAALevel ? window.gfx.getAALevel() : 0;
    }
    
    // Check if reload notice should be shown initially
    hud.updateAAReloadNotice(initialValue);
    
    // Add event listener for slider changes
    slider.addEventListener('input', function() {
      const value = parseInt(this.value);
      valueDisplay.textContent = AA_LABELS[value];
      
      // Apply antialiasing setting
      hud.updateAntialiasing(value);
      
      // Save setting
      localStorage.setItem('aaLevel', value.toString());
      
      // Update reload notice
      hud.updateAAReloadNotice(value);
    });
  };
  
  // Check if reload is needed for MSAA setting and update notice
  hud.updateAAReloadNotice = function(newValue) {
    const notice = document.getElementById('aa_reload_notice');
    if (!notice) return;
    
    // Get the MSAA level the engine was created with
    const currentEngineMSAA = engineMSAALevel !== null ? engineMSAALevel : 
      (window.gfx && window.gfx.getAALevel ? window.gfx.getAALevel() : 0);
    
    // Compare MSAA states: both are MSAA (>=2), or neither is MSAA (<2)
    const newIsMSAA = newValue >= 2;
    const currentIsMSAA = currentEngineMSAA >= 2;
    const sameLevel = newValue === currentEngineMSAA;
    
    const needsReload = newIsMSAA !== currentIsMSAA || (newIsMSAA && !sameLevel);
    notice.style.display = needsReload ? 'block' : 'none';
  };
  
  // Update antialiasing based on slider value (0-3)
  // 0 = Off, 1 = FXAA, 2 = MSAA 2x, 3 = MSAA 4x
  hud.updateAntialiasing = function(value) {
    if (window.gfx && window.gfx.setAntialiasing) {
      window.gfx.setAntialiasing(value);
    }
  };
  
  // Get saved AA level for engine initialization
  hud.getSavedAALevel = function() {
    const savedAA = localStorage.getItem('aaLevel');
    return savedAA ? parseInt(savedAA) : 0;
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

      // Hide 3D anchor indicators and dispose 3D selection panel when switching to 2D mode
      console.log('🔄 Switching to 2D mode - hiding 3D anchors, showing 2D anchors');
      if (hud.anchorIndicators) {
        Object.values(hud.anchorIndicators).forEach(indicator => {
          if (indicator) indicator.setEnabled(false);
        });
        console.log('✅ Hid 3D anchor indicators');
      } else {
        console.log('ℹ️ No 3D anchor indicators to hide');
      }
      if (hud.dispose3DSelectionPanel) hud.dispose3DSelectionPanel();

      // Show 2D anchors
      ['anchor_n', 'anchor_s', 'anchor_e', 'anchor_w'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'block';
      });
      console.log('✅ Showed 2D anchor elements');

      // Reinitialize lasso for new mode
      if (window.lassoSelection && window.lassoSelection.reinit) {
        window.lassoSelection.reinit();
      }

      // Reinitialize 2D menu system since we switched to 2D mode
      if (window.initMenu) {
        window.initMenu();
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

      // Create/show 3D anchor indicators and hide 2D anchors when switching to 3D mode
      console.log('🔄 Switching to 3D mode - creating 3D anchors, hiding 2D anchors');
      if (hud.createAnchorIndicators) {
        hud.createAnchorIndicators();
      } else {
        console.log('❌ createAnchorIndicators function not found');
      }

      // Hide 2D anchors and clear selection panel (3D mode has its own indicators)
      ['anchor_n', 'anchor_s', 'anchor_e', 'anchor_w'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
      });
      const panel = document.getElementById('selection_panel');
      if (panel) panel.innerHTML = '';

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

      // Create/show 3D anchor indicators and hide 2D anchors when initializing to 3D mode
      if (hud.createAnchorIndicators) {
        hud.createAnchorIndicators();
      } else {
        console.log('❌ createAnchorIndicators function not found during init');
      }

      // Hide 2D anchors and clear selection panel
      ['anchor_n', 'anchor_s', 'anchor_e', 'anchor_w'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
      });
      const panel = document.getElementById('selection_panel');
      if (panel) panel.innerHTML = '';

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

      // Hide 3D anchor indicators and show 2D anchors when initializing to 2D mode
      console.log('🎮 Initializing to 2D mode - hiding 3D anchors, showing 2D anchors');
      if (hud.anchorIndicators) {
        Object.values(hud.anchorIndicators).forEach(indicator => {
          if (indicator) indicator.setEnabled(false);
        });
        console.log('✅ Hid 3D anchor indicators during init');
      } else {
        console.log('ℹ️ No 3D anchor indicators to hide during init');
      }

      // Show 2D anchors
      ['anchor_n', 'anchor_s', 'anchor_e', 'anchor_w'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'block';
      });
      console.log('✅ Showed 2D anchor elements during init');

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
  // NOTE: This must NOT depend on opening the settings menu.
  // It is safe to call before the slider DOM exists.
  hud.initializeShadowsMode = function() {
    // Determine shadow mode from localStorage (0=Off, 1=Low, 2=Med, 3=Full)
    // and apply it immediately so gameplay visuals don't depend on settings UI.
    let initialMode = 2;
    try {
      const savedMode = localStorage.getItem('shadowMode');
      if (savedMode !== null) {
        initialMode = parseInt(savedMode);
      } else {
        // Check legacy setting
        const legacyShadows = localStorage.getItem('shadowsEnabled');
        initialMode = (legacyShadows === 'false') ? 0 : 2;
      }
    } catch (e) {
      initialMode = 2;
    }

    // Apply immediately (this also sets window.SHADOW_MODE / window.SHADOWS_ENABLED)
    if (hud.updateShadowMode) {
      hud.updateShadowMode(initialMode);
    } else {
      window.SHADOW_MODE = initialMode;
      window.SHADOWS_ENABLED = (initialMode === 3);
    }
    
    // Legacy code below (kept for reference)
    const savedShadows = localStorage.getItem('shadowsEnabled');
    const switchElement = document.getElementById('shadows_switch');
    const handle = document.getElementById('shadows_handle');
    
    if (!switchElement || !handle) {
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

  // Toggle spatial audio on/off
  hud.toggleSpatialAudio = function() {
    const switchElement = document.getElementById('spatial_switch');
    const handle = document.getElementById('spatial_handle');
    const label = document.getElementById('spatial_mode_label');
    const isOn = switchElement.dataset.on === 'true';

    if (isOn) {
      // Switch to Off (left position)
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      label.textContent = 'Off';

      // Update spatial audio mode
      if (window.aud) {
        window.aud.setSpatialMode(false);
      }

      // Save preference
      localStorage.setItem('spatialAudio', 'false');
    } else {
      // Switch to On (right position)
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      label.textContent = 'On';

      // Update spatial audio mode
      if (window.aud) {
        window.aud.setSpatialMode(true);
      }

      // Save preference
      localStorage.setItem('spatialAudio', 'true');
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

  hud.initializeSpatialAudio = function() {
    const savedSpatial = localStorage.getItem('spatialAudio');
    const switchElement = document.getElementById('spatial_switch');
    const handle = document.getElementById('spatial_handle');
    const label = document.getElementById('spatial_mode_label');

    // Default to off for performance
    const isEnabled = savedSpatial === 'true';

    if (isEnabled) {
      // Set to On
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      label.textContent = 'On';
    } else {
      // Set to Off (default)
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      label.textContent = 'Off';
    }

    // Apply the setting
    if (window.aud) {
      window.aud.setSpatialMode(isEnabled);
    }
  };

  hud.toggleTooltips = function() {
    const switchElement = document.getElementById('tooltip_switch');
    const handle = document.getElementById('tooltip_handle');
    const isOn = switchElement.dataset.on === 'true';

    if (isOn) {
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
      window.DETAILED_TOOLTIPS = false;
      localStorage.setItem('detailedTooltips', 'false');
    } else {
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
      window.DETAILED_TOOLTIPS = true;
      localStorage.setItem('detailedTooltips', 'true');
    }
  };

  hud.initializeTooltips = function() {
    const saved = localStorage.getItem('detailedTooltips');
    const isEnabled = saved !== 'false'; // default true
    const switchElement = document.getElementById('tooltip_switch');
    const handle = document.getElementById('tooltip_handle');

    if (!switchElement || !handle) return;

    if (isEnabled) {
      switchElement.style.background = '#4CAF50';
      handle.style.left = '27px';
      switchElement.dataset.on = 'true';
    } else {
      switchElement.style.background = '#ccc';
      handle.style.left = '2px';
      switchElement.dataset.on = 'false';
    }

    window.DETAILED_TOOLTIPS = isEnabled;
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
    
    // Hide both 3D radial menu and 2D menu so they don't block building placement
    hud.hideRadialMenu();
    
    // Hide 2D menu buttons if they exist
    if (window.activeButtons && window.hideButtons) {
      window.hideButtons(window.activeButtons);
      window.activeButtons = [];
    }
    
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
  
  // Position camp options immediately
  function animateCampOptions() {
    radialMenuItems.forEach(item => {
      if (item.isCampOption && item.container) {
        const targetPos = calculateExpandedItemPosition(item, 0, 0);
        
        // Set position directly without animation
        item.container.position.copyFrom(targetPos);
      }
    });
  }
  
  // Hide buildings menu when camp is selected
  function hideBuildingsMenu() {
    radialMenuItems.forEach(item => {
      if (item.isSubItem && !item.isCampOption && item.container) {
        // Scale down immediately without animation
        item.container.scaling.setAll(0.3);
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
