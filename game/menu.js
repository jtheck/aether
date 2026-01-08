// Menu configuration and state
const BUTTON_SPACING = 60; // Distance between buttons in pixels
const ARC_ANGLE = 120; // Total angle of the arc in degrees
const ANIMATION_DELAY = 24; // Delay between each button animation in ms
const ARC_SPACING = 60; // Distance between successive arcs

const menu = {
  buildings: {
    // Arc 1: Basic structures
    camp: { arc: 1 },
    village: { arc: 1 },
    tower: { arc: 1 },
    silo: { arc: 1 },
    farm: { arc: 1 },
    mine: { arc: 1 },
    // Arc 2: Intermediate structures
    lab: { arc: 2 },
    tavern: { arc: 2 },
    moonwell: { arc: 2 },
    barracks: { arc: 2 },
    workshop: { arc: 2 },
    // Arc 3: Advanced structures
    factory: { arc: 3 },
    church: { arc: 3 },
    well: { arc: 3 },
    perch: { arc: 3 },
    grove: { arc: 3 }
  },
  units: {
    // Arc 1: Basic/Support units
    villager: { arc: 1 },
    monk: { arc: 1 },
    engineer: { arc: 1 },
    wizard: { arc: 1 },
    // Arc 2: Combat units
    warrior: { arc: 2 },
    archer: { arc: 2 },
    warlock: { arc: 2 },
    wagon: { arc: 2 },
    // Arc 3: Advanced units
    apc: { arc: 3 },
    priest: { arc: 3 },
    mycologist: { arc: 3 },
    dirigible: { arc: 3 },
    shaman: { arc: 3 }
  },
  research: {
    // Arc 1: Economy/Infrastructure
    scribes: { arc: 1 },
    prospecting: { arc: 1 },
    patronage: { arc: 1 },
    stewardship: { arc: 1 },
    // Arc 2: Military
    drayage: { arc: 2 },
    artillery: { arc: 2 },
    armor: { arc: 2 }
  }
};

// Track menu state
let currentAnchor = null;
let activeButtons = [];
let menuDepth = 0;
let menuOpenedAt = 0; // Track when menu was last opened to prevent immediate close

// Expose state variables globally
window.currentAnchor = currentAnchor;
window.activeButtons = activeButtons;
window.menuDepth = menuDepth;
window.menuOpenedAt = menuOpenedAt;

// Global function to set currentAnchor (for spacebar handler)
window.setCurrentAnchor = function(anchor) {
  currentAnchor = anchor;
  window.currentAnchor = currentAnchor;
};

// Calculate button positions along an arc
function calculateArcPositions(anchorX, anchorY, numButtons, depth = 0, direction = 'w') {
  const positions = [];
  
  let dynamicArcAngle, angleStep;
  
  if (depth === 0) {
    // Main menu: use full arc spread
    dynamicArcAngle = ARC_ANGLE;
    angleStep = numButtons > 1 ? ARC_ANGLE / (numButtons - 1) : 0;
  } else {
    // Submenus: fixed spacing between items, but cap total spread
    const ITEM_SPACING = 28; // degrees between each button
    const idealSpread = (numButtons - 1) * ITEM_SPACING;
    dynamicArcAngle = Math.min(ARC_ANGLE, idealSpread);
    // If we hit the cap, shrink spacing proportionally to fit
    angleStep = numButtons > 1 ? dynamicArcAngle / (numButtons - 1) : 0;
  }
  
  let startAngle;
  
  // Adjust the arc's orientation based on anchor direction
  switch(direction) {
    case 'n': // Point downward
      startAngle = 90 - (dynamicArcAngle / 2);
      break;
    case 's': // Point upward
      startAngle = 270 - (dynamicArcAngle / 2);
      break;
    case 'e': // Point leftward
      startAngle = 180 - (dynamicArcAngle / 2);
      break;
    case 'w': // Point rightward
    default:
      startAngle = -dynamicArcAngle / 2;
      break;
  }
  
  const radius = BUTTON_SPACING + (depth * ARC_SPACING);
  
  for (let i = 0; i < numButtons; i++) {
    const angle = (startAngle + i * angleStep) * (Math.PI / 180);
    const x = anchorX + Math.cos(angle) * radius;
    const y = anchorY + Math.sin(angle) * radius;
    positions.push({ x, y });
  }
  
  return positions;
}

// Create a menu button
function createMenuButton(id, icon, label, menuPath = [], depth = 0) {
  const button = document.createElement('div');
  button.id = id;
  button.className = 'radial-menu-button';
  button.innerHTML = icon;
  button.dataset.menuPath = JSON.stringify(menuPath);
  button.dataset.depth = depth;
  
  const tooltip = document.createElement('div');
  tooltip.className = 'radial-menu-label';
  tooltip.textContent = label;
  button.appendChild(tooltip);
  
  // Add pointerdown handler for nested menus (works better with touch)
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Mark menu interaction to prevent immediate close
    menuOpenedAt = Date.now();
    window.menuOpenedAt = menuOpenedAt;
    
    const path = JSON.parse(button.dataset.menuPath);
    const submenu = getSubmenuFromPath(path);
    
    // Check if this has actual submenu items (ignore metadata like 'arc', 'callback')
    const submenuKeys = submenu ? Object.keys(submenu).filter(k => k !== 'arc' && k !== 'callback') : [];
    
    // If has submenu items, show them
    if (submenuKeys.length > 0) {
      // Filter out metadata before showing submenu
      const filteredSubmenu = {};
      submenuKeys.forEach(k => filteredSubmenu[k] = submenu[k]);
      showSubmenu(button, filteredSubmenu);
    } else {
      // Handle leaf node selection
      const [category, ...itemPath] = path;
      
      if (category === 'buildings' && window.buildingSystem) {
        // Get the actual building type from the path
        const buildingType = itemPath[itemPath.length - 1];
        
        // Clean up any existing preview before starting new placement
        window.buildingSystem.cancelPlacement();
        // Start building placement mode
        window.buildingSystem.selectBuilding(buildingType);
      } else {
        // For non-building menu items, exit building placement mode if currently placing
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          window.buildingSystem.cancelPlacement();
        }
      }
      
      if (category === 'units' && window.Unit && window.player && window.player.agora) {
        // Get the unit type from the path
        const unitType = itemPath[itemPath.length - 1];
        
        // Wizards are recruited directly, other units transform from villagers
        if (unitType === 'wizard' || unitType === 'monk' || unitType === 'engineer') {
          // Use unified recruit function (handles both single/multiplayer)
          window.recruitUnit(unitType);
        } else {
          // Use convert command system (same as HUD for consistency)
          if (window.currentMatch && window.player) {
            const normalizedPlayerId = window.player.id.slice(-6);
            const myVillagers = window.player.units.filter(u => u.type === 'villager' && u.owner === normalizedPlayerId);
            
            if (myVillagers.length === 0) {
              console.log('❌ No villagers available to convert to ' + unitType);
              return;
            }
            
            // Prefer selected villagers, otherwise pick first available
            const selectedVillagers = window.player.selectedUnits.filter(u => u.type === 'villager' && u.owner === normalizedPlayerId);
            const targetVillager = selectedVillagers.length > 0 ? selectedVillagers[0] : myVillagers[0];
            
            window.currentMatch.submitCommand({
              type: 'convert',
              playerId: window.player.id,
              unitId: targetVillager.id,
              targetType: unitType
            });
          } else {
            console.warn('❌ Cannot convert unit: No active match');
          }
        }
      } else {
        // console.log('Selected:', path);
        // TODO: Handle other selection actions
      }
    }
  });
  
  document.body.appendChild(button);
  return button;
}

// Get submenu object from path array
function getSubmenuFromPath(path) {
  let current = menu;
  for (const key of path) {
    current = current[key];
  }
  return current;
}

// Show buttons in an arc
function showButtonsInArc(buttons, anchorX, anchorY, depth = 0, direction = 'w') {
  const positions = calculateArcPositions(anchorX, anchorY, buttons.length, depth, direction);
  
  buttons.forEach((button, index) => {
    // Position button immediately
    button.style.left = `${positions[index].x}px`;
    button.style.top = `${positions[index].y}px`;
    button.classList.add('visible');
    
    activeButtons.push(button);
  });
}

// Show submenu for a button
function showSubmenu(parentButton, submenuItems) {
  // Use the root anchor position instead of parent button position
  const anchor = currentAnchor || window.currentAnchor;
  if (!anchor) {
    console.warn('No anchor available for submenu');
    return;
  }
  
  const x = anchor.x;
  const y = anchor.y;
  const baseDepth = parseInt(parentButton.dataset.depth) + 1;
  
  // Hide any buttons at the same or deeper depth
  const buttonsToHide = activeButtons.filter(button => 
    parseInt(button.dataset.depth) >= baseDepth
  );
  hideButtons(buttonsToHide);
  activeButtons = activeButtons.filter(button =>
    parseInt(button.dataset.depth) < baseDepth
  );
  window.activeButtons = activeButtons;
  
  // Group submenu items by arc number
  const arcGroups = new Map();
  Object.entries(submenuItems).forEach(([key, value]) => {
    const arcNum = (value && value.arc) || 1;
    if (!arcGroups.has(arcNum)) {
      arcGroups.set(arcNum, []);
    }
    arcGroups.get(arcNum).push({ key, value });
  });
  
  // Create and position buttons for each arc
  arcGroups.forEach((items, arcNum) => {
    // Each arc gets a different depth (arc 1 = baseDepth, arc 2 = baseDepth+1, etc.)
    const arcDepth = baseDepth + (arcNum - 1);
    
    const buttons = items.map(({ key, value }) => {
    const path = JSON.parse(parentButton.dataset.menuPath);
    path.push(key);
    return createMenuButton(
      `menu-${path.join('-')}`,
      getIconForItem(key),
      key,
      path,
        arcDepth
    );
  });
  
    // Show this arc's buttons
    showButtonsInArc(buttons, x, y, arcDepth, anchor.direction);
  });
}

// Hide buttons
function hideButtons(buttons) {
  buttons.forEach((button) => {
    button.classList.remove('visible');
    button.remove();
  });
}

// Get icon for menu item
function getIconForItem(key) {
  const icons = {
    // Units - Arc 1 (Basic/Support)
    villager: '👤',
    monk: '🧘',
    engineer: '🔧',
    wizard: '🧙',
    // Units - Arc 2 (Combat)
    warrior: '⚔️',
    archer: '🏹',
    warlock: '🔮',
    wagon: '🛒',
    // Units - Arc 3 (Advanced)
    apc: '🚐',
    priest: '⛪',
    mycologist: '🍄',
    dirigible: '🎈',
    shaman: '🪶',
    
    // Buildings - Arc 1 (Basic)
    camp: '⛺',
    village: '🏘️',
    tower: '🗼',
    silo: '🏛️',
    farm: '🌾',
    mine: '⛏️',
    // Buildings - Arc 2 (Intermediate)
    lab: '🔬',
    tavern: '🍺',
    moonwell: '🌙',
    barracks: '🏰',
    workshop: '🔨',
    // Buildings - Arc 3 (Advanced)
    factory: '🏭',
    church: '⛪',
    well: '💧',
    perch: '🪺',
    grove: '🌳',
    
    // Research - Arc 1 (Economy/Infrastructure)
    scribes: '📝',
    prospecting: '⛏️',
    patronage: '👑',
    stewardship: '🏛️',
    // Research - Arc 2 (Military)
    drayage: '🚛',
    artillery: '💣',
    armor: '🛡️',
    
    // Default icons for categories
    units: '👥',
    buildings: '🏗️',
    research: '📚'
  };
  
  return icons[key] || '❓';
}

// Initialize the menu system
function initMenu() {
  // Only initialize 2D menu if not using 3D HUD
  if (USE_3D_HUD) {
    return;
  }
  
  // Add click handlers to anchor points
  const anchors = {
    n: document.getElementById('anchor_n'),
    s: document.getElementById('anchor_s'),
    e: document.getElementById('anchor_e'),
    w: document.getElementById('anchor_w')
  };
  
  Object.entries(anchors).forEach(([direction, anchor]) => {
    anchor.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Mark menu as just opened
      menuOpenedAt = Date.now();
      window.menuOpenedAt = menuOpenedAt;
      
      // Exit building placement mode if currently placing
      if (window.buildingSystem && window.buildingSystem.isPlacing) {
        window.buildingSystem.cancelPlacement();
      }
      
      if (USE_3D_HUD) {
        // 3D HUD mode - show 3D radial menu
        const rect = anchor.getBoundingClientRect();
        const canvasRect = window.gfx ? window.gfx.canvas.getBoundingClientRect() : { left: 0, top: 0 };
        const x = rect.left + rect.width / 2 - canvasRect.left;
        const y = rect.top + rect.height / 2 - canvasRect.top;
        
        // Convert direction to anchor name for 3D menu
        const anchorMap = { n: 'top', s: 'bottom', e: 'right', w: 'left' };
        const anchorName = anchorMap[direction] || 'bottom';
        
        // Show 3D menu at this anchor
        if (window.hud && window.hud.showRadialMenu) {
          window.hud.showRadialMenu(x, y, anchorName);
        }
      } else {
        // 2D HUD mode - show 2D radial menu
        const rect = anchor.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        
        // Hide any visible buttons first
        hideButtons(activeButtons);
        activeButtons = [];
        menuDepth = 0;
        window.activeButtons = activeButtons;
        window.menuDepth = menuDepth;
        
        // Create and show top-level buttons
        const buttons = Object.entries(menu).map(([key, value]) => {
          return createMenuButton(
            `menu-${key}`,
            getIconForItem(key),
            key,
            [key],
            0
          );
        });
        
        currentAnchor = { x, y, direction };
        window.currentAnchor = currentAnchor;
        showButtonsInArc(buttons, x, y, 0, direction);
      }
    });
  });
  
  // Click outside to close (but not immediately after opening)
  document.addEventListener('click', (e) => {
    // Don't close menu if we're in building placement mode
    if (window.buildingSystem && window.buildingSystem.isPlacing) {
      return;
    }
    
    // Don't close if menu was just opened (prevents pointerdown open -> click close)
    if (Date.now() - menuOpenedAt < 300) {
      return;
    }
    
    // Don't close if clicking on a menu button
    if (e.target.closest('.radial-menu-button') || e.target.closest('.menu_anchor')) {
      return;
    }
    
    hideButtons(activeButtons);
    activeButtons = [];
    menuDepth = 0;
    currentAnchor = null;
    window.activeButtons = activeButtons;
    window.menuDepth = menuDepth;
    window.currentAnchor = currentAnchor;
  });
}

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', initMenu);

// Expose globally for HUD mode switching and spacebar handler
window.initMenu = initMenu;
window.menu = menu;
window.activeButtons = activeButtons;
window.menuDepth = menuDepth;
window.menuOpenedAt = menuOpenedAt;
window.createMenuButton = createMenuButton;
window.showButtonsInArc = showButtonsInArc;
window.hideButtons = hideButtons;
window.getIconForItem = getIconForItem;