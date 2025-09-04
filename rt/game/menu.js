// Menu configuration and state
const BUTTON_SPACING = 60; // Distance between buttons in pixels
const ARC_ANGLE = 120; // Total angle of the arc in degrees
const ANIMATION_DELAY = 30; // Delay between each button animation in ms
const ARC_SPACING = 70; // Distance between successive arcs

const menu = {
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
  buildings: {
    camp: {},
    village: {},
    farm: {},
    tower: {}
  },
  research: {
    scribes: {},
    drayage: {},
    prospecting: {}
  },
  rally: {
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
      } else if (category === 'units' && window.Unit && window.player && window.player.agora) {
        // Get the unit type from the path
        const unitType = itemPath[itemPath.length - 1];
        
        // Get agora position
        const agoraX = window.player.agora.x * TILE_SIZE;
        const agoraZ = window.player.agora.y * TILE_SIZE;
        
        // Create unit at agora
        const unit = new window.Unit(unitType, { x: agoraX, y: 0, z: agoraZ });
        unit.owner = 'player';
        
        // Random rotation
        const randomRotation = Math.random() * Math.PI * 2;
        unit.rotation = randomRotation;
        if (unit.pb.state && unit.pb.state.rot) {
          unit.pb.state.rot.y = randomRotation;
        }
        
        // Add to player's units and global array
        window.player.units.push(unit);
        window.gameUnits.push(unit);
        
        // Spawn the model
        if (window.gfx && window.gfx.scene) {
          window.spawnUnitModels(window.gfx.scene);
        }
        
        console.log(`✨ Created ${unit.name} at agora`);
      } else {
        console.log('Selected:', path);
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