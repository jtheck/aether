// Initialize detailed tooltips from saved preference (default true)
window.DETAILED_TOOLTIPS = localStorage.getItem('detailedTooltips') !== 'false';

// Menu configuration and state
const BUTTON_SPACING = 60; // Distance between buttons in pixels
const ARC_ANGLE = 120; // Total angle of the arc in degrees
const ANIMATION_DELAY = 24; // Delay between each button animation in ms
const ARC_SPACING = 60; // Distance between successive arcs

const menu = {
  units: {
    // Arc 1: Basic/Support units
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
    mycorrhizae: { arc: 3 },
    dirigible: { arc: 3 },
    shaman: { arc: 3 }
  },
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
let radialMenu2DTouchHoverEl = null;

function clearRadialMenu2DTouchHover() {
  if (radialMenu2DTouchHoverEl) {
    radialMenu2DTouchHoverEl.classList.remove('touch-hover');
    radialMenu2DTouchHoverEl = null;
  }
}

function onDocumentPointerMoveFor2DMenuHover(e) {
  if (USE_3D_HUD) return;
  if (!e.buttons) return;
  if (!activeButtons.length) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const btn = el && el.closest('.radial-menu-button');
  if (radialMenu2DTouchHoverEl && radialMenu2DTouchHoverEl !== btn) {
    radialMenu2DTouchHoverEl.classList.remove('touch-hover');
    radialMenu2DTouchHoverEl = null;
  }
  if (btn && activeButtons.includes(btn) && btn.classList.contains('visible')) {
    btn.classList.add('touch-hover');
    radialMenu2DTouchHoverEl = btn;
  } else if (radialMenu2DTouchHoverEl) {
    radialMenu2DTouchHoverEl.classList.remove('touch-hover');
    radialMenu2DTouchHoverEl = null;
  }
}

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

  // Check if this is a building or unit button and add cost information + prerequisite/affordability styling
  let displayLabel = label;
  if (menuPath.length >= 2) {
    const category = menuPath[0];
    const itemType = menuPath[menuPath.length - 1];

    if (category === 'buildings') {
      const costInfo = formatBuildingCost(itemType);
      if (costInfo) {
        displayLabel = `${label}\n${costInfo}`;
      }

      // Check prerequisites first (grey), then affordability (red)
      if (!hasPrerequisitesBuilding(itemType)) {
        button.classList.add('prerequisites-not-met');
      } else if (!canAffordBuilding(itemType)) {
        button.classList.add('cannot-afford');
      }
    } else if (category === 'units') {
      const costInfo = formatUnitCost(itemType);
      if (costInfo) {
        displayLabel = `${label}\n${costInfo}`;
      }

      // Check prerequisites first (grey), then affordability (red)
      if (!hasPrerequisitesUnit(itemType)) {
        button.classList.add('prerequisites-not-met');
      } else if (!canAffordUnit(itemType)) {
        button.classList.add('cannot-afford');
      }
    } else if (category === 'research') {
      const costInfo = formatResearchCost(itemType);
      if (costInfo) {
        displayLabel = `${label}\n${costInfo}`;
      }

      // Check prerequisites first (grey), then affordability (red)
      if (!hasPrerequisitesResearch(itemType)) {
        button.classList.add('prerequisites-not-met');
      } else if (!canAffordResearch(itemType)) {
        button.classList.add('cannot-afford');
      }
    }
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'radial-menu-label';
  tooltip.textContent = displayLabel;
  button.appendChild(tooltip);

  // Add detailed info panel for leaf items when detailed tooltips are enabled
  if (window.DETAILED_TOOLTIPS && menuPath.length >= 2) {
    const category = menuPath[0];
    const itemType = menuPath[menuPath.length - 1];
    let detailHTML = null;

    if (category === 'units' && window.UnitTypes && window.UnitTypes[itemType]) {
      const u = window.UnitTypes[itemType];
      const abilitiesStr = u.abilities ? u.abilities.join(', ') : '';
      detailHTML =
        (u.description ? `<div style="color:#ccc;margin-bottom:6px">${u.description}</div>` : '') +
        `<div style="color:#aaa">❤️ ${u.health} &nbsp; 🏃 ${u.speed}${abilitiesStr ? `<br>${abilitiesStr}` : ''}</div>`;
    } else if (category === 'buildings' && window.BuildingTypes && window.BuildingTypes[itemType]) {
      const b = window.BuildingTypes[itemType];
      if (b.description) detailHTML = `<div style="color:#ccc">${b.description}</div>`;
    } else if (category === 'research' && window.UpgradeTypes && window.UpgradeTypes[itemType]) {
      const r = window.UpgradeTypes[itemType];
      const timeSec = r.researchTime ? `⏱️ ${Math.round(r.researchTime / 1000)}s` : '';
      detailHTML =
        (r.description ? `<div style="color:#ccc;margin-bottom:6px">${r.description}</div>` : '') +
        (timeSec ? `<div style="color:#aaa">${timeSec}</div>` : '');
    }

    if (detailHTML) {
      const detail = document.createElement('div');
      detail.className = 'radial-menu-detail';
      detail.innerHTML = detailHTML;
      button.appendChild(detail);
    }
  }
  
  // Hover opens submenus on desktop (touch uses press only)
  button.addEventListener('pointerenter', (e) => {
    if (typeof USE_3D_HUD !== 'undefined' && USE_3D_HUD) return;
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    if (!button.classList.contains('visible')) return;
    menuOpenedAt = Date.now();
    window.menuOpenedAt = menuOpenedAt;
    openSubmenuForButtonIfApplicable(button);
  });
  
  // Add pointerdown handler for nested menus (works better with touch)
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Mark menu interaction to prevent immediate close
    menuOpenedAt = Date.now();
    window.menuOpenedAt = menuOpenedAt;
    
    if (openSubmenuForButtonIfApplicable(button)) {
      return;
    }
    
    // Leaf node — no submenu
    const path = JSON.parse(button.dataset.menuPath);
    const [category, ...itemPath] = path;

    if (category === 'buildings' && window.buildingSystem) {
      const buildingType = itemPath[itemPath.length - 1];

      hideButtons(activeButtons);
      activeButtons = [];
      window.suppressTerrainPointerUpUntil = Date.now() + 320;

      window.buildingSystem.cancelPlacement();
      window.buildingSystem.selectBuilding(buildingType);
    } else {
      if (window.buildingSystem && window.buildingSystem.isPlacing) {
        window.buildingSystem.cancelPlacement();
      }
    }

    if (category === 'units' && typeof window.recruitUnit === 'function' && window.player) {
      const unitType = itemPath[itemPath.length - 1];
      window.recruitUnit(unitType);
    } else {
      // console.log('Selected:', path);
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

// Expand submenu for a button if it has child items (used by click and hover)
function openSubmenuForButtonIfApplicable(button) {
  const path = JSON.parse(button.dataset.menuPath);
  const submenu = getSubmenuFromPath(path);
  const submenuKeys = submenu
    ? Object.keys(submenu).filter((k) => k !== 'arc' && k !== 'callback')
    : [];
  if (submenuKeys.length === 0) return false;
  const filteredSubmenu = {};
  submenuKeys.forEach((k) => {
    filteredSubmenu[k] = submenu[k];
  });
  showSubmenu(button, filteredSubmenu);
  return true;
}

// Hide buttons
function hideButtons(buttons) {
  clearRadialMenu2DTouchHover();
  buttons.forEach((button) => {
    button.classList.remove('visible');
    button.remove();
  });
}

// Format building cost for display
function formatBuildingCost(buildingType) {
  if (!window.BuildingTypes || !window.BuildingTypes[buildingType]) {
    return '';
  }

  const building = window.BuildingTypes[buildingType];
  if (!building.cost) {
    return '';
  }

  const costEntries = Object.entries(building.cost);
  if (costEntries.length === 0) {
    return '';
  }

  const resourceIcons = {
    wood: '🌳',
    stone: '🪨',
    minerals: '💎',
    food: '🍖'
  };

  const costStrings = costEntries.map(([resource, amount]) => {
    const icon = resourceIcons[resource] || resource;
    return `${icon}${amount}`;
  });

  return costStrings.join(' ');
}

// Format research cost for display
function formatResearchCost(researchType) {
  if (!window.UpgradeTypes || !window.UpgradeTypes[researchType]) {
    return '';
  }

  const research = window.UpgradeTypes[researchType];
  if (!research.cost) {
    return '';
  }

  const costEntries = Object.entries(research.cost);
  if (costEntries.length === 0) {
    return '';
  }

  const resourceIcons = {
    wood: '🌳',
    stone: '🪨',
    minerals: '💎',
    food: '🍖'
  };

  const costStrings = costEntries.map(([resource, amount]) => {
    const icon = resourceIcons[resource] || resource;
    return `${icon}${amount}`;
  });

  return costStrings.join(' ');
}

// Check if player can afford research
function canAffordResearch(researchType) {
  if (!window.UpgradeTypes || !window.UpgradeTypes[researchType]) {
    return true; // Assume affordable if research type not found
  }

  if (!window.player || !window.player.resources) {
    return true; // Assume affordable if no player data
  }

  const research = window.UpgradeTypes[researchType];
  if (!research.cost) {
    return true; // No cost means always affordable
  }

  const playerResources = window.player.resources;

  // Check each required resource
  for (const [resource, amount] of Object.entries(research.cost)) {
    const playerAmount = playerResources[resource] || 0;
    if (playerAmount < amount) {
      return false;
    }
  }

  return true; // All resources available
}

// Check if player can afford a building
function canAffordBuilding(buildingType) {
  if (!window.BuildingTypes || !window.BuildingTypes[buildingType]) {
    return true; // Assume affordable if building type not found
  }

  if (!window.player || !window.player.resources) {
    return true; // Assume affordable if no player data
  }

  const building = window.BuildingTypes[buildingType];
  if (!building.cost) {
    return true; // No cost means always affordable
  }

  const playerResources = window.player.resources;

  // Check each required resource
  for (const [resource, amount] of Object.entries(building.cost)) {
    const playerAmount = playerResources[resource] || 0;
    if (playerAmount < amount) {
      return false; // Can't afford
    }
  }

  return true; // Can afford
}

// Format unit cost for display
function formatUnitCost(unitType) {
  if (!window.UnitTypes || !window.UnitTypes[unitType]) {
    return '';
  }

  const unit = window.UnitTypes[unitType];
  if (!unit.cost) {
    return '';
  }

  const costEntries = Object.entries(unit.cost);
  if (costEntries.length === 0) {
    return '';
  }

  const resourceIcons = {
    wood: '🌳',
    stone: '🪨',
    minerals: '💎',
    food: '🍖'
  };

  const costStrings = costEntries.map(([resource, amount]) => {
    const icon = resourceIcons[resource] || resource;
    return `${icon}${amount}`;
  });

  return costStrings.join(' ');
}

// Check if player can afford a unit
function canAffordUnit(unitType) {
  if (!window.UnitTypes || !window.UnitTypes[unitType]) {
    return true; // Assume affordable if unit type not found
  }

  if (!window.player || !window.player.resources) {
    return true; // Assume affordable if no player data
  }

  const unit = window.UnitTypes[unitType];
  if (!unit.cost) {
    return true; // No cost means always affordable
  }

  const playerResources = window.player.resources;

  // Check each required resource
  for (const [resource, amount] of Object.entries(unit.cost)) {
    const playerAmount = playerResources[resource] || 0;
    if (playerAmount < amount) {
      return false; // Can't afford
    }
  }

  return true; // Can afford
}

// Check if player meets prerequisites for a building
function hasPrerequisitesBuilding(buildingType) {
  if (!window.BuildingTypes || !window.BuildingTypes[buildingType]) {
    return true; // Assume available if building type not found
  }

  if (!window.player) {
    return true; // Assume available if no player data
  }

  const building = window.BuildingTypes[buildingType];

  // Check for building prerequisites (direct requires array)
  if (building.requires && building.requires.length > 0) {
    for (const requiredBuilding of building.requires) {
      const hasBuilding = window.player.buildings.some(b => b.type === requiredBuilding);
      if (!hasBuilding) {
        return false;
      }
    }
  }

  // Check for structured prerequisites object
  if (!building.prerequisites) {
    return true; // No prerequisites means always available
  }

  const prereqs = building.prerequisites;

  // Check required buildings
  if (prereqs.buildings) {
    for (const requiredBuilding of prereqs.buildings) {
      const hasBuilding = window.player.buildings.some(b => b.type === requiredBuilding);
      if (!hasBuilding) {
        return false;
      }
    }
  }

  // Check required research/tech
  if (prereqs.research) {
    for (const requiredResearch of prereqs.research) {
      const hasResearch = window.player.research && window.player.research.includes(requiredResearch);
      if (!hasResearch) {
        return false;
      }
    }
  }

  // Check required professions/units
  if (prereqs.units) {
    for (const requiredUnit of prereqs.units) {
      const hasUnit = window.player.units.some(u => u.type === requiredUnit);
      if (!hasUnit) {
        return false;
      }
    }
  }

  return true; // All prerequisites met
}

// Check if player meets prerequisites for research
function hasPrerequisitesResearch(researchType) {
  if (!window.UpgradeTypes || !window.UpgradeTypes[researchType]) {
    return true; // Assume available if research type not found
  }

  if (!window.player) {
    return true; // Assume available if no player data
  }

  const research = window.UpgradeTypes[researchType];
  if (!research.requires || research.requires.length === 0) {
    return true; // No building requirements means always available
  }

  // Check required buildings
  for (const requiredBuilding of research.requires) {
    const hasBuilding = window.player.buildings.some(b => b.type === requiredBuilding);
    if (!hasBuilding) {
      return false;
    }
  }

  return true; // All building prerequisites met
}

// Update menu button states when buildings/research change
function updateMenuButtonStates() {
  // Get all menu buttons
  const menuButtons = document.querySelectorAll('.radial-menu-button');

  menuButtons.forEach(button => {
    if (!button.dataset.menuPath) return;

    const menuPath = JSON.parse(button.dataset.menuPath);
    if (menuPath.length < 2) return;

    const category = menuPath[0];
    const itemType = menuPath[menuPath.length - 1];

    // Remove existing state classes
    button.classList.remove('prerequisites-not-met', 'cannot-afford');

    // Check new state
    if (category === 'buildings') {
      if (!hasPrerequisitesBuilding(itemType)) {
        button.classList.add('prerequisites-not-met');
      } else if (!canAffordBuilding(itemType)) {
        button.classList.add('cannot-afford');
      }
    } else if (category === 'units') {
      if (!hasPrerequisitesUnit(itemType)) {
        button.classList.add('prerequisites-not-met');
      } else if (!canAffordUnit(itemType)) {
        button.classList.add('cannot-afford');
      }
    } else if (category === 'research') {
      if (!hasPrerequisitesResearch(itemType)) {
        button.classList.add('prerequisites-not-met');
      } else if (!canAffordResearch(itemType)) {
        button.classList.add('cannot-afford');
      }
    }
  });
}

// Check if player meets prerequisites for a unit
function hasPrerequisitesUnit(unitType) {
  if (!window.UnitTypes || !window.UnitTypes[unitType]) {
    return true; // Assume available if unit type not found
  }

  if (!window.player) {
    return true; // Assume available if no player data
  }

  const unit = window.UnitTypes[unitType];
  if (!unit.prerequisites) {
    return true; // No prerequisites means always available
  }

  const prereqs = unit.prerequisites;

  // Check required buildings
  if (prereqs.buildings) {
    for (const requiredBuilding of prereqs.buildings) {
      const hasBuilding = window.player.buildings.some(b => b.type === requiredBuilding);
      if (!hasBuilding) {
        return false;
      }
    }
  }

  // Check required research/tech
  if (prereqs.research) {
    for (const requiredResearch of prereqs.research) {
      const hasResearch = window.player.research && window.player.research.includes(requiredResearch);
      if (!hasResearch) {
        return false;
      }
    }
  }

  // Check required professions/units
  if (prereqs.units) {
    for (const requiredUnit of prereqs.units) {
      const hasUnit = window.player.units.some(u => u.type === requiredUnit);
      if (!hasUnit) {
        return false;
      }
    }
  }

  return true; // All prerequisites met
}

// Atlas cell positions matching gfx.js
const MENU_ATLAS_CELLS = {
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

const MENU_TYPE_ALIASES = {
  mycorrhizae: 'myco', grove: 'trees',
  buildings: 'agora', units: 'warrior', research: 'wizard',
};

function getSpriteIconHTML(key) {
  const atlasKey = MENU_TYPE_ALIASES[key] || key;
  const cell = MENU_ATLAS_CELLS[atlasKey];
  if (!cell) return null;
  const bgX = cell[0] * 100 / 7;
  const bgY = cell[1] * 100 / 7;
  return `<div class="sprite-icon" style="background-position:${bgX.toFixed(2)}% ${bgY.toFixed(2)}%"></div>`;
}

// Emoji fallbacks for items without atlas entries
const EMOJI_ICONS = {
  scribes: '📝', prospecting: '⛏️', patronage: '👑', stewardship: '🏛️',
  drayage: '🚛', artillery: '💣', armor: '🛡️',
  home: '🏠',
};

function getIconForItem(key) {
  return getSpriteIconHTML(key) || EMOJI_ICONS[key] || '❓';
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

  document.addEventListener('pointermove', onDocumentPointerMoveFor2DMenuHover, { passive: true });
  document.addEventListener('pointerup', clearRadialMenu2DTouchHover, true);
  document.addEventListener('pointercancel', clearRadialMenu2DTouchHover, true);
}

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', initMenu);

// Expose globally for HUD mode switching and spacebar handler
window.initMenu = initMenu;
window.menu = menu;
window.activeButtons = activeButtons;
window.showSubmenu = showSubmenu;
window.menuDepth = menuDepth;
window.menuOpenedAt = menuOpenedAt;
window.createMenuButton = createMenuButton;
window.showButtonsInArc = showButtonsInArc;
window.hideButtons = hideButtons;
window.getIconForItem = getIconForItem;
window.canAffordBuilding = canAffordBuilding;
window.formatUnitCost = formatUnitCost;
window.formatBuildingCost = formatBuildingCost;
window.formatResearchCost = formatResearchCost;
window.canAffordUnit = canAffordUnit;
window.canAffordResearch = canAffordResearch;
window.hasPrerequisitesBuilding = hasPrerequisitesBuilding;
window.hasPrerequisitesUnit = hasPrerequisitesUnit;
window.hasPrerequisitesResearch = hasPrerequisitesResearch;
window.updateMenuButtonStates = updateMenuButtonStates;

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function getMissingPrerequisites(category, itemKey) {
  const missing = [];
  const player = window.player;
  if (!player) return '';

  let prereqs = null;
  let requires = null;

  if (category === 'buildings') {
    const b = window.BuildingTypes && window.BuildingTypes[itemKey];
    if (!b) return '';
    prereqs = b.prerequisites;
    requires = b.requires;
  } else if (category === 'units') {
    const u = window.UnitTypes && window.UnitTypes[itemKey];
    if (!u) return '';
    prereqs = u.prerequisites;
  } else if (category === 'research') {
    const r = window.UpgradeTypes && window.UpgradeTypes[itemKey];
    if (!r) return '';
    requires = r.requires;
  }

  if (requires) {
    for (const req of requires) {
      if (!player.buildings.some(b => b.type === req)) missing.push(capitalize(req));
    }
  }

  if (prereqs) {
    if (prereqs.buildings) {
      for (const req of prereqs.buildings) {
        if (!player.buildings.some(b => b.type === req)) missing.push(capitalize(req));
      }
    }
    if (prereqs.research) {
      for (const req of prereqs.research) {
        if (!(player.research && player.research.includes(req))) missing.push(capitalize(req));
      }
    }
    if (prereqs.units) {
      for (const req of prereqs.units) {
        if (!player.units.some(u => u.type === req)) missing.push(capitalize(req));
      }
    }
  }

  return missing.length > 0 ? 'Requires: ' + missing.join(', ') : 'Requires prerequisite';
}
window.getMissingPrerequisites = getMissingPrerequisites;

// Debug function to show player's current state
window.debugPlayerState = function() {
  console.log('🎮 PLAYER STATE DEBUG:');
  console.log('🏗️ Buildings:', window.player?.buildings?.map(b => b.type) || 'None');
  console.log('🔬 Research:', window.player?.research || 'None');
  console.log('👥 Units:', window.player?.units?.length || 0, 'units');

  console.log('\n📋 MENU AVAILABILITY:');

  // Check some key examples
  const examples = [
    { type: 'engineer', category: 'units', prereq: 'village' },
    { type: 'warrior', category: 'units', prereq: 'barracks' },
    { type: 'wagon', category: 'units', prereq: 'workshop' },
    { type: 'scribes', category: 'research', prereq: 'workshop' },
    { type: 'tavern', category: 'buildings', prereq: 'village' },
    { type: 'barracks', category: 'buildings', prereq: 'farm' }
  ];

  // Show ALL research and their requirements
  console.log('\n🔬 ALL RESEARCH REQUIREMENTS:');
  const researchKeys = ['scribes', 'prospecting', 'patronage', 'stewardship', 'drayage', 'artillery', 'armor'];
  researchKeys.forEach(researchKey => {
    const hasPrereqs = window.hasPrerequisitesResearch(researchKey);
    const canAfford = window.canAffordResearch(researchKey);
    const research = window.UpgradeTypes[researchKey];
    const requirements = research?.requires?.join(', ') || 'none';

    const status = hasPrereqs ? (canAfford ? '✅ AVAILABLE' : '💰 CAN\'T AFFORD') : '🚫 MISSING PREREQ';
    console.log(`${researchKey}: ${status} (needs buildings: ${requirements})`);
  });

  console.log('\n🏗️ KEY UNIT REQUIREMENTS:');
  const unitExamples = [
    { type: 'warlock', prereq: 'tavern' },
    { type: 'wizard', prereq: 'tower' },
    { type: 'priest', prereq: 'church' },
    { type: 'wagon', prereq: 'workshop' }
  ];

  unitExamples.forEach(example => {
    const hasPrereqs = window.hasPrerequisitesUnit(example.type);
    const canAfford = window.canAffordUnit(example.type);
    const status = hasPrereqs ? (canAfford ? '✅ AVAILABLE' : '💰 CAN\'T AFFORD') : '🚫 MISSING PREREQ';
    console.log(`${example.type}: ${status} (needs: ${example.prereq})`);
  });

  examples.forEach(example => {
    let hasPrereqs = false;
    let canAfford = false;

    if (example.category === 'units') {
      hasPrereqs = window.hasPrerequisitesUnit(example.type);
      canAfford = window.canAffordUnit(example.type);
    } else if (example.category === 'buildings') {
      hasPrereqs = window.hasPrerequisitesBuilding(example.type);
      canAfford = window.canAffordBuilding(example.type);
    } else if (example.category === 'research') {
      hasPrereqs = window.hasPrerequisitesResearch(example.type);
      canAfford = window.canAffordResearch(example.type);
    }

    const status = hasPrereqs ? (canAfford ? '✅ AVAILABLE' : '💰 CAN\'T AFFORD') : '🚫 MISSING PREREQ';
    console.log(`${example.type} (${example.category}): ${status} (needs: ${example.prereq})`);
  });
};