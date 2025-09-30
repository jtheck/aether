// Team Color System for Models and Buildings
// Provides consistent team coloring across all game objects

// Predefined team color palettes
const TEAM_COLORS = {
  player: {
    primary: '#4A90E2',    // Blue
    secondary: '#2E5B8A',  // Darker blue
    accent: '#7BB3F0',     // Light blue
    name: 'Player'
  },
  opponent: {
    primary: '#E24A4A',    // Red
    secondary: '#8A2E2E',  // Darker red
    accent: '#F07B7B',     // Light red
    name: 'Opponent'
  },
  neutral: {
    primary: '#8A8A8A',    // Gray
    secondary: '#5A5A5A',  // Darker gray
    accent: '#AAAAAA',     // Light gray
    name: 'Neutral'
  },
  team3: {
    primary: '#4AE24A',    // Green
    secondary: '#2E8A2E',  // Darker green
    accent: '#7BF07B',     // Light green
    name: 'Team 3'
  },
  team4: {
    primary: '#E2E24A',    // Yellow
    secondary: '#8A8A2E',  // Darker yellow
    accent: '#F0F07B',     // Light yellow
    name: 'Team 4'
  },
  team5: {
    primary: '#E24AE2',    // Magenta
    secondary: '#8A2E8A',  // Darker magenta
    accent: '#F07BF0',     // Light magenta
    name: 'Team 5'
  },
  team6: {
    primary: '#4AE2E2',    // Cyan
    secondary: '#2E8A8A',  // Darker cyan
    accent: '#7BF0F0',     // Light cyan
    name: 'Team 6'
  }
};

// Material cache to avoid creating duplicate materials
const teamMaterialCache = new Map();

// Get team color information
function getTeamColor(teamId) {
  return TEAM_COLORS[teamId] || TEAM_COLORS.neutral;
}

// Create or get cached team material
function getTeamMaterial(teamId, materialType = 'standard', scene) {
  if (!scene) {
    console.warn('Scene not provided for team material creation');
    return null;
  }

  const cacheKey = `${teamId}_${materialType}`;
  
  if (teamMaterialCache.has(cacheKey)) {
    return teamMaterialCache.get(cacheKey);
  }

  const teamColor = getTeamColor(teamId);
  let material;

  switch (materialType) {
    case 'standard':
      material = new BABYLON.StandardMaterial(`team_${teamId}_standard`, scene);
      material.diffuseColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', ''));
      material.emissiveColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', '')).scale(0.1);
      material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
      material.specularPower = 32;
      break;

    case 'emissive':
      material = new BABYLON.StandardMaterial(`team_${teamId}_emissive`, scene);
      material.diffuseColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', ''));
      material.emissiveColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', '')).scale(0.3);
      material.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      material.specularPower = 64;
      break;

    case 'accent':
      material = new BABYLON.StandardMaterial(`team_${teamId}_accent`, scene);
      material.diffuseColor = BABYLON.Color3.FromHexString(teamColor.accent.replace('#', ''));
      material.emissiveColor = BABYLON.Color3.FromHexString(teamColor.accent.replace('#', '')).scale(0.15);
      material.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
      material.specularPower = 48;
      break;

    case 'secondary':
      material = new BABYLON.StandardMaterial(`team_${teamId}_secondary`, scene);
      material.diffuseColor = BABYLON.Color3.FromHexString(teamColor.secondary.replace('#', ''));
      material.emissiveColor = BABYLON.Color3.FromHexString(teamColor.secondary.replace('#', '')).scale(0.05);
      material.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
      material.specularPower = 16;
      break;

    default:
      material = new BABYLON.StandardMaterial(`team_${teamId}_default`, scene);
      material.diffuseColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', ''));
      break;
  }

  // Cache the material
  teamMaterialCache.set(cacheKey, material);
  return material;
}

// Apply team colors to a mesh and its children
function applyTeamColors(mesh, teamId, options = {}) {
  if (!mesh || !teamId) return;

  const scene = mesh.getScene();
  if (!scene) return;

  const {
    materialType = 'standard',
    applyToChildren = true,
    preserveOriginalMaterials = false,
    colorIntensity = 1.0
  } = options;

  // Apply to main mesh
  if (!preserveOriginalMaterials) {
    const teamMaterial = getTeamMaterial(teamId, materialType, scene);
    if (teamMaterial) {
      // Clone the material to avoid affecting other meshes
      const clonedMaterial = teamMaterial.clone(`team_${teamId}_${mesh.name}_${Date.now()}`);
      
      // Adjust color intensity
      if (colorIntensity !== 1.0) {
        clonedMaterial.diffuseColor = clonedMaterial.diffuseColor.scale(colorIntensity);
        clonedMaterial.emissiveColor = clonedMaterial.emissiveColor.scale(colorIntensity);
      }
      
      mesh.material = clonedMaterial;
    }
  }

  // Apply to child meshes
  if (applyToChildren && mesh.getChildMeshes) {
    mesh.getChildMeshes().forEach((childMesh, index) => {
      // Skip certain child meshes that shouldn't be colored (like UI elements)
      if (shouldSkipChildMesh(childMesh)) return;

      if (!preserveOriginalMaterials) {
        const childMaterialType = getChildMaterialType(childMesh.name, materialType);
        const childTeamMaterial = getTeamMaterial(teamId, childMaterialType, scene);
        
        if (childTeamMaterial) {
          const clonedChildMaterial = childTeamMaterial.clone(`team_${teamId}_${childMesh.name}_${Date.now()}`);
          
          // Adjust color intensity
          if (colorIntensity !== 1.0) {
            clonedChildMaterial.diffuseColor = clonedChildMaterial.diffuseColor.scale(colorIntensity);
            clonedChildMaterial.emissiveColor = clonedChildMaterial.emissiveColor.scale(colorIntensity);
          }
          
          childMesh.material = clonedChildMaterial;
        }
      }
    });
  }
}

// Determine if a child mesh should be skipped from team coloring
function shouldSkipChildMesh(mesh) {
  const skipPatterns = [
    'selectionRing',
    'SelectionRing',
    'indicator',
    'Indicator',
    'UI',
    'ui',
    'HUD',
    'hud',
    'billboard',
    'Billboard'
  ];
  
  return skipPatterns.some(pattern => mesh.name.includes(pattern));
}

// Determine material type for child meshes based on their name
function getChildMaterialType(meshName, parentMaterialType) {
  const name = meshName.toLowerCase();
  
  // Special parts that should use accent colors
  if (name.includes('flag') || name.includes('banner') || name.includes('emblem')) {
    return 'accent';
  }
  
  // Special parts that should use secondary colors
  if (name.includes('trim') || name.includes('border') || name.includes('edge')) {
    return 'secondary';
  }
  
  // Special parts that should be more emissive
  if (name.includes('light') || name.includes('glow') || name.includes('torch')) {
    return 'emissive';
  }
  
  // Default to parent material type
  return parentMaterialType;
}

// Create team-colored selection indicator
function createTeamSelectionIndicator(unit, teamId) {
  if (!unit.mesh || !window.gfx || !window.gfx.scene) return;
  
  const scene = window.gfx.scene;
  const teamColor = getTeamColor(teamId);
  
  // Create a ring around the unit for selection indicator
  const ring = BABYLON.MeshBuilder.CreateTorus("selectionRing", {
    diameter: 2.5,
    thickness: 0.06,
    tessellation: 16
  }, scene);
  
  // Create team-colored material
  const ringMaterial = new BABYLON.StandardMaterial("teamSelectionRingMat", scene);
  ringMaterial.diffuseColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', ''));
  ringMaterial.emissiveColor = BABYLON.Color3.FromHexString(teamColor.primary.replace('#', '')).scale(0.5);
  ringMaterial.alpha = 0.8;
  
  ring.material = ringMaterial;
  ring.isVisible = false; // Hidden by default
  ring.isPickable = false; // Don't interfere with unit selection
  
  // Position ring around the unit
  ring.position.y = 0.1; // Slightly above ground
  ring.parent = unit.mesh; // Parent to unit so it moves with it
  
  // Store reference to the selection indicator
  unit.selectionIndicator = ring;
}

// Update team colors for existing units and buildings
function updateTeamColors() {
  // Update units
  if (window.gameUnits) {
    window.gameUnits.forEach(unit => {
      if (unit.mesh && unit.owner) {
        applyTeamColors(unit.mesh, unit.owner, {
          materialType: 'standard',
          applyToChildren: true,
          preserveOriginalMaterials: false
        });
      }
    });
  }
  
  // Update buildings
  if (window.gameBuildings) {
    window.gameBuildings.forEach(building => {
      if (building.mesh && building.owner) {
        applyTeamColors(building.mesh, building.owner, {
          materialType: 'standard',
          applyToChildren: true,
          preserveOriginalMaterials: false
        });
      }
    });
  }
}

// Get team color for UI display
function getTeamColorForUI(teamId) {
  return getTeamColor(teamId).primary;
}

// Get team name for UI display
function getTeamName(teamId) {
  return getTeamColor(teamId).name;
}

// Clear material cache (useful for memory management)
function clearTeamMaterialCache() {
  teamMaterialCache.forEach(material => {
    if (material.dispose) {
      material.dispose();
    }
  });
  teamMaterialCache.clear();
}

// Export functions for use in other files
if (typeof window !== 'undefined') {
  window.TEAM_COLORS = TEAM_COLORS;
  window.getTeamColor = getTeamColor;
  window.getTeamMaterial = getTeamMaterial;
  window.applyTeamColors = applyTeamColors;
  window.createTeamSelectionIndicator = createTeamSelectionIndicator;
  window.updateTeamColors = updateTeamColors;
  window.getTeamColorForUI = getTeamColorForUI;
  window.getTeamName = getTeamName;
  window.clearTeamMaterialCache = clearTeamMaterialCache;
}
