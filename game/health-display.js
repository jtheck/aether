// 3-Dot Health Display System
// Visual health representation with 3 dots instead of numeric values

(function() {
  'use strict';

  // Create 3-dot health display for a unit or building
  window.createHealthDots = function(entity) {
    if (!entity.mesh || !window.gfx || !window.gfx.scene) return;
    
    const scene = window.gfx.scene;
    const dotCount = 3;
    
    // Special handling for Agoras - bigger, more prominent health display
    const isAgora = entity.type === 'agora';
    const isBuilding = entity.gridX !== undefined || (entity.mesh && entity.mesh.isBuilding);
    
    const dotSpacing = isAgora ? 0.8 : 0.4; // 2x spacing for Agoras
    const dotRadius = isAgora ? 0.24 : 0.12; // 2x size for Agoras
    const totalWidth = (dotCount - 1) * dotSpacing;
    const yOffset = isAgora ? 10 : (isBuilding ? 6 : 3); // Agoras highest, buildings mid, units low
    
    // Create container for dots
    const container = new BABYLON.TransformNode('healthDotsContainer', scene);
    container.parent = entity.mesh;
    container.position.y = yOffset;
    
    entity.healthDots = [];
    entity.healthDotsContainer = container;
    
    // Create 3 dots
    for (let i = 0; i < dotCount; i++) {
      const dot = BABYLON.MeshBuilder.CreateSphere(`healthDot_${i}`, {
        diameter: dotRadius * 2,
        segments: 8
      }, scene);
      
      // Position dots horizontally
      const xPos = (i * dotSpacing) - (totalWidth / 2);
      dot.position.x = xPos;
      dot.parent = container;
      
      // Create material
      const dotMat = new BABYLON.StandardMaterial(`healthDotMat_${i}`, scene);
      dotMat.emissiveColor = new BABYLON.Color3(0, 1, 0); // Start green
      dotMat.diffuseColor = new BABYLON.Color3(0, 1, 0);
      dot.material = dotMat;
      dot.isPickable = false;
      
      // Billboard mode so dots always face camera
      dot.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      
      entity.healthDots.push(dot);
    }
    
    // Update initial health display
    updateHealthDots(entity);
    
    // Hide health dots by default for units (buildings keep them visible)
    if (!isBuilding) {
      container.setEnabled(false);
    }
  };
  
  // Show health dots for a unit
  window.showHealthDots = function(entity) {
    if (entity.healthDotsContainer) {
      entity.healthDotsContainer.setEnabled(true);
    }
  };
  
  // Hide health dots for a unit
  window.hideHealthDots = function(entity) {
    if (entity.healthDotsContainer) {
      entity.healthDotsContainer.setEnabled(false);
    }
  };
  
  // Update health dots based on current health
  window.updateHealthDots = function(entity) {
    if (!entity.healthDots || entity.healthDots.length !== 3) return;
    
    const maxHealth = entity.maxHealth || 100;
    const currentHealth = Math.max(0, entity.health || 0);
    const healthPercent = currentHealth / maxHealth;
    
    // Calculate how many dots should be filled
    // 100-67% = 3 dots, 66-34% = 2 dots, 33-1% = 1 dot, 0% = 0 dots
    let filledDots;
    if (healthPercent > 0.66) filledDots = 3;
    else if (healthPercent > 0.33) filledDots = 2;
    else if (healthPercent > 0) filledDots = 1;
    else filledDots = 0;
    
    // Update each dot
    entity.healthDots.forEach((dot, index) => {
      const isFilled = index < filledDots;
      const mat = dot.material;
      
      if (isFilled) {
        // Filled dot - color based on health
        if (filledDots === 3) {
          // All dots filled - green
          mat.emissiveColor = new BABYLON.Color3(0, 1, 0);
          mat.diffuseColor = new BABYLON.Color3(0, 1, 0);
        } else if (filledDots === 2) {
          // 2 dots - yellow/orange
          mat.emissiveColor = new BABYLON.Color3(1, 0.8, 0);
          mat.diffuseColor = new BABYLON.Color3(1, 0.8, 0);
        } else {
          // 1 dot - red
          mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
          mat.diffuseColor = new BABYLON.Color3(1, 0, 0);
        }
        mat.alpha = 1.0;
      } else {
        // Empty dot - dark gray
        mat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mat.alpha = 0.5;
      }
    });
  };
  
  // Dispose health dots (cleanup)
  window.disposeHealthDots = function(entity) {
    if (entity.healthDots) {
      entity.healthDots.forEach(dot => {
        if (dot.material) dot.material.dispose();
        dot.dispose();
      });
      entity.healthDots = [];
    }
    if (entity.healthDotsContainer) {
      entity.healthDotsContainer.dispose();
      entity.healthDotsContainer = null;
    }
  };
  
})();
