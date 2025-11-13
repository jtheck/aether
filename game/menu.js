// Menu configuration and state
const BUTTON_SPACING = 60; // Distance between buttons in pixels
const ARC_ANGLE = 120; // Total angle of the arc in degrees
const ANIMATION_DELAY = 24; // Delay between each button animation in ms
const ARC_SPACING = 60; // Distance between successive arcs

const menu = {
  buildings: {
    camp: {},
    village: {},
    farm: {},
    tower: {}
  },
  units: {
    // Original units
    monk: {},
    wizard: {},
    engineer: {},
    brigand: {},
    // Nature units
    // villager: {},
    // frog_scout: {},
    // tree_guardian: {},
    // mushroom_mage: {},
    // bird_messenger: {},
    // gnome_builder: {}
  },
  research: {
    scribes: {},
    drayage: {},
    prospecting: {}
  },
  rally: {
    home: {}
  }
};

// Track menu state
let currentAnchor = null;
let activeButtons = [];
let menuDepth = 0;

// Calculate button positions along an arc
function calculateArcPositions(anchorX, anchorY, numButtons, depth = 0, direction = 'w') {
  const positions = [];
  const angleStep = ARC_ANGLE / (numButtons - 1);
  let startAngle;
  
  // Adjust the arc's orientation based on anchor direction
  switch(direction) {
    case 'n': // Point downward
      startAngle = 90 - (ARC_ANGLE / 2);
      break;
    case 's': // Point upward
      startAngle = 270 - (ARC_ANGLE / 2);
      break;
    case 'e': // Point leftward
      startAngle = 180 - (ARC_ANGLE / 2);
      break;
    case 'w': // Point rightward
    default:
      startAngle = -ARC_ANGLE / 2;
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
  
  // Add click handler for nested menus
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const path = JSON.parse(button.dataset.menuPath);
    const submenu = getSubmenuFromPath(path);
    
    // If has submenu items, show them
    if (submenu && Object.keys(submenu).length > 0) {
      showSubmenu(button, submenu);
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

// Show buttons in an arc animation
function showButtonsInArc(buttons, anchorX, anchorY, depth = 0, direction = 'w') {
  const positions = calculateArcPositions(anchorX, anchorY, buttons.length, depth, direction);
  
  buttons.forEach((button, index) => {
    // Position button
    button.style.left = `${anchorX}px`;
    button.style.top = `${anchorY}px`;
    
    // Trigger animation after a delay
    setTimeout(() => {
      button.style.left = `${positions[index].x}px`;
      button.style.top = `${positions[index].y}px`;
      button.classList.add('visible');
    }, index * ANIMATION_DELAY);
    
    activeButtons.push(button);
  });
}

// Show submenu for a button
function showSubmenu(parentButton, submenuItems) {
  const rect = parentButton.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const depth = parseInt(parentButton.dataset.depth) + 1;
  
  // Hide any buttons at the same or deeper depth
  const buttonsToHide = activeButtons.filter(button => 
    parseInt(button.dataset.depth) >= depth
  );
  hideButtons(buttonsToHide);
  activeButtons = activeButtons.filter(button => 
    parseInt(button.dataset.depth) < depth
  );
  
  // Create submenu buttons
  const buttons = Object.entries(submenuItems).map(([key, value]) => {
    const path = JSON.parse(parentButton.dataset.menuPath);
    path.push(key);
    return createMenuButton(
      `menu-${path.join('-')}`,
      getIconForItem(key),
      key,
      path,
      depth
    );
  });
  
  // Show new buttons in arc
  showButtonsInArc(buttons, x, y, depth, currentAnchor.direction);
}

// Hide buttons with animation
function hideButtons(buttons) {
  buttons.forEach((button, index) => {
    setTimeout(() => {
      button.classList.remove('visible');
      setTimeout(() => button.remove(), 200); // Remove after transition
    }, index * ANIMATION_DELAY);
  });
}

// Get icon for menu item
function getIconForItem(key) {
  const icons = {
    // Original units
    monk: '🙏',
    wizard: '🧙',
    engineer: '🔧',
    brigand: '🗡️',
    // Nature units
    villager: '👤',
    frog_scout: '🐸',
    tree_guardian: '🌳',
    mushroom_mage: '🍄',
    bird_messenger: '🐦',
    gnome_builder: '👷',
    
    // Buildings
    camp: '⛺',
    tower: '🗼',
    village: '🏘️',
    farm: '🌾',
    
    // Research
    scribes: '📚',
    drayage: '🔬',
    
    // Default icons for categories
    units: '👥',
    buildings: '🏗️',
    research: '📚',
    rally: '🚩'
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
    anchor.addEventListener('click', (e) => {
      e.stopPropagation();
      
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
        showButtonsInArc(buttons, x, y, 0, direction);
      }
    });
  });
  
  // Click outside to close
  document.addEventListener('click', (e) => {
    // Don't close menu if we're in building placement mode
    if (window.buildingSystem && window.buildingSystem.isPlacing) {
      return;
    }
    
    hideButtons(activeButtons);
    activeButtons = [];
    menuDepth = 0;
    currentAnchor = null;
  });
}

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', initMenu);