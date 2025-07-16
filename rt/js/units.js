class Unit {
  constructor(scene, type, position, team) {
    this.scene = scene;
    this.type = type;
    this.team = team;
    this.position = position.clone();
    this.targetPosition = position.clone();
    this.isSelected = false;
    this.isMoving = false;
    this.speed = this.getUnitSpeed();
    this.health = this.getUnitHealth();
    this.maxHealth = this.health;
    
    // Create the unit mesh
    this.mesh = this.createUnitMesh();
    this.mesh.position = this.position;
    
    // Store original material for selection highlighting
    this.originalMaterial = this.mesh.material.clone();
    
    // Movement path
    this.path = [];
    this.pathIndex = 0;
  }
  
  getUnitSpeed() {
    switch (this.type) {
      case 'infantry': return 0.15; // 3x faster
      case 'tank': return 0.12; // 4x faster
      case 'artillery': return 0.08; // 4x faster
      default: return 0.12;
    }
  }
  
  getUnitHealth() {
    switch (this.type) {
      case 'infantry': return 100;
      case 'tank': return 300;
      case 'artillery': return 150;
      default: return 100;
    }
  }
  
  createUnitMesh() {
    let mesh;
    const material = new BABYLON.StandardMaterial(`unitMat_${this.type}_${this.team}`, this.scene);
    
    switch (this.type) {
      case 'infantry':
        // Small box for infantry
        mesh = BABYLON.MeshBuilder.CreateBox(`unit_${this.type}`, {
          width: 0.3,
          height: 0.6,
          depth: 0.3
        }, this.scene);
        material.diffuseColor = this.team === 'blue' ? 
          new BABYLON.Color3(0.2, 0.4, 0.8) : 
          new BABYLON.Color3(0.8, 0.2, 0.2);
        break;
        
      case 'tank':
        // Larger box for tank
        mesh = BABYLON.MeshBuilder.CreateBox(`unit_${this.type}`, {
          width: 0.8,
          height: 0.4,
          depth: 1.2
        }, this.scene);
        material.diffuseColor = this.team === 'blue' ? 
          new BABYLON.Color3(0.1, 0.3, 0.7) : 
          new BABYLON.Color3(0.7, 0.1, 0.1);
        break;
        
      case 'artillery':
        // Cylinder for artillery
        mesh = BABYLON.MeshBuilder.CreateCylinder(`unit_${this.type}`, {
          height: 0.6,
          diameter: 0.5
        }, this.scene);
        material.diffuseColor = this.team === 'blue' ? 
          new BABYLON.Color3(0.3, 0.5, 0.9) : 
          new BABYLON.Color3(0.9, 0.3, 0.3);
        break;
        
      default:
        mesh = BABYLON.MeshBuilder.CreateBox(`unit_${this.type}`, {
          width: 0.4,
          height: 0.5,
          depth: 0.4
        }, this.scene);
        material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
    }
    
    material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    mesh.material = material;
    
    return mesh;
  }
  
  select() {
    this.isSelected = true;
    // Highlight selected unit
    this.mesh.material.diffuseColor = new BABYLON.Color3(1, 1, 0); // Yellow
  }
  
  deselect() {
    this.isSelected = false;
    // Restore original material
    this.mesh.material.diffuseColor = this.originalMaterial.diffuseColor;
  }
  
  moveTo(targetPos) {
    this.targetPosition = targetPos.clone();
    this.isMoving = true;
    this.path = [this.position.clone(), this.targetPosition.clone()];
    this.pathIndex = 0;
  }
  
  update(deltaTime) {
    if (this.isMoving) {
      this.updateMovement(deltaTime);
    }
  }
  
  updateMovement(deltaTime) {
    const direction = this.targetPosition.subtract(this.position);
    const distance = direction.length();
    
    if (distance < 0.1) {
      // Reached target
      this.position = this.targetPosition.clone();
      this.isMoving = false;
      return;
    }
    
    // Move towards target
    direction.normalize();
    const movement = direction.scale(this.speed * deltaTime * 60); // 60 FPS compensation
    
    if (movement.length() > distance) {
      // Don't overshoot
      this.position = this.targetPosition.clone();
    } else {
      this.position.addInPlace(movement);
    }
    
    // Update mesh position
    this.mesh.position = this.position;
    
    // Rotate unit to face movement direction
    if (direction.length() > 0.01) {
      const angle = Math.atan2(direction.x, direction.z);
      this.mesh.rotation.y = angle;
    }
  }
  
  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    return this.health <= 0;
  }
  
  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }
  
  getHealthPercentage() {
    return this.health / this.maxHealth;
  }
  
  dispose() {
    if (this.mesh) {
      this.mesh.dispose();
    }
  }
}

class UnitManager {
  constructor(scene, terrainGenerator) {
    this.scene = scene;
    this.terrainGenerator = terrainGenerator;
    this.units = new Map();
    this.selectedUnits = new Set();
    this.nextUnitId = 1;
  }
  
  createUnit(type, position, team) {
    const unitId = this.nextUnitId++;
    const unit = new Unit(this.scene, type, position, team);
    this.units.set(unitId, unit);
    return unitId;
  }
  
  createUnitGroup(types, positions, team) {
    const unitIds = [];
    types.forEach((type, index) => {
      const unitId = this.createUnit(type, positions[index], team);
      unitIds.push(unitId);
    });
    return unitIds;
  }
  
  selectUnit(unitId) {
    // Deselect all units first
    this.deselectAllUnits();
    
    const unit = this.units.get(unitId);
    if (unit) {
      unit.select();
      this.selectedUnits.add(unitId);
    }
  }
  
  selectUnits(unitIds) {
    this.deselectAllUnits();
    unitIds.forEach(unitId => {
      const unit = this.units.get(unitId);
      if (unit) {
        unit.select();
        this.selectedUnits.add(unitId);
      }
    });
  }
  
  deselectUnit(unitId) {
    const unit = this.units.get(unitId);
    if (unit && this.selectedUnits.has(unitId)) {
      unit.deselect();
      this.selectedUnits.delete(unitId);
    }
  }
  
  deselectAllUnits() {
    this.selectedUnits.forEach(unitId => {
      const unit = this.units.get(unitId);
      if (unit) {
        unit.deselect();
      }
    });
    this.selectedUnits.clear();
  }
  
  moveSelectedUnits(targetPosition) {
    this.selectedUnits.forEach(unitId => {
      const unit = this.units.get(unitId);
      if (unit) {
        // Add some spread to prevent units from stacking
        const spread = 2;
        const offsetX = (Math.random() - 0.5) * spread;
        const offsetZ = (Math.random() - 0.5) * spread;
        const spreadTarget = targetPosition.add(new BABYLON.Vector3(offsetX, 0, offsetZ));
        unit.moveTo(spreadTarget);
      }
    });
  }
  
  update(deltaTime) {
    this.units.forEach(unit => {
      unit.update(deltaTime);
    });
  }
  
  getUnitsAtPosition(position, radius = 1) {
    const unitsAtPosition = [];
    this.units.forEach((unit, unitId) => {
      const distance = BABYLON.Vector3.Distance(unit.position, position);
      if (distance <= radius) {
        unitsAtPosition.push({ unitId, unit, distance });
      }
    });
    return unitsAtPosition.sort((a, b) => a.distance - b.distance);
  }
  
  getSelectedUnitsInfo() {
    const info = [];
    this.selectedUnits.forEach(unitId => {
      const unit = this.units.get(unitId);
      if (unit) {
        info.push({
          id: unitId,
          type: unit.type,
          team: unit.team,
          health: unit.health,
          maxHealth: unit.maxHealth,
          position: unit.position,
          isMoving: unit.isMoving
        });
      }
    });
    return info;
  }
  
  getAllUnitsInfo() {
    const info = [];
    this.units.forEach((unit, unitId) => {
      info.push({
        id: unitId,
        type: unit.type,
        team: unit.team,
        health: unit.health,
        maxHealth: unit.maxHealth,
        position: unit.position,
        isSelected: this.selectedUnits.has(unitId),
        isMoving: unit.isMoving
      });
    });
    return info;
  }
  
  removeUnit(unitId) {
    const unit = this.units.get(unitId);
    if (unit) {
      unit.dispose();
      this.units.delete(unitId);
      this.selectedUnits.delete(unitId);
    }
  }
  
  dispose() {
    this.units.forEach(unit => {
      unit.dispose();
    });
    this.units.clear();
    this.selectedUnits.clear();
  }
} 