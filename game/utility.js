




gfx.makeTable = function(scene){
  // Create materials for different table parts
  const cornerMat = new BABYLON.StandardMaterial("cornerMat", scene);
  cornerMat.diffuseColor = new BABYLON.Color3(0.4, 0.2, 0.1); // Dark brown for corners
  cornerMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  
  const sideMat = new BABYLON.StandardMaterial("sideMat", scene);
  sideMat.diffuseColor = new BABYLON.Color3(0.6, 0.3, 0.15); // Medium brown for sides
  sideMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  
  const topMat = new BABYLON.StandardMaterial("topMat", scene);
  topMat.diffuseColor = new BABYLON.Color3(0.5, 0.25, 0.12); // Slightly darker brown for tops
  topMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  
  const floorMat = new BABYLON.StandardMaterial("floorMat", scene);
  floorMat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.1); // Dark green for the playing surface
  floorMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  // Create parent mesh for the entire table
  const tableParent = new BABYLON.TransformNode("tableParent", scene);

  const tableParts = {
    SW: {
      mesh: BABYLON.MeshBuilder.CreateBox("SW", {size: 1}, scene), 
    },
    SE: {
      mesh: BABYLON.MeshBuilder.CreateBox("SE", {size: 1}, scene), 
    },
    NE: {
      mesh: BABYLON.MeshBuilder.CreateBox("NE", {size: 1}, scene),
    },
    NW: { 
      mesh: BABYLON.MeshBuilder.CreateBox("NW", {size: 1}, scene),
    },
    N: {
      mesh: BABYLON.MeshBuilder.CreateBox("N", {size: 1}, scene),
    },
    E: {
      mesh: BABYLON.MeshBuilder.CreateBox("E", {size: 1}, scene),
    },
    S: {
      mesh: BABYLON.MeshBuilder.CreateBox("S", {size: 1}, scene),
    },
    W: {
      mesh: BABYLON.MeshBuilder.CreateBox("W", {size: 1}, scene),
    },
    NT: {
      mesh: BABYLON.MeshBuilder.CreateBox("NT", {size: 1}, scene),
    },
    ET: {
      mesh: BABYLON.MeshBuilder.CreateBox("ET", {size: 1}, scene),
    },
    ST: {
      mesh: BABYLON.MeshBuilder.CreateBox("ST", {size: 1}, scene),
    },
    WT: {
      mesh: BABYLON.MeshBuilder.CreateBox("WT", {size: 1}, scene),
    },
    FLOOR: {
      mesh: BABYLON.MeshBuilder.CreateBox("FLOOR", {size: 1}, scene),
    },
    // Store materials for later use
    materials: {
      corner: cornerMat,
      side: sideMat,
      top: topMat,
      floor: floorMat
    }
  };

  // Parent all table parts to the table parent
  Object.values(tableParts).forEach(part => {
    if (part.mesh) {
      part.mesh.setParent(tableParent);
    }
  });

  // Return both the parent and the parts
  return {
    parent: tableParent,
    parts: tableParts
  };
}


gfx.stretchTable = function(table) {
  let fieldWidth = liveField.width;
  let fieldHeight = liveField.height;

  const width = fieldWidth * TILE_SIZE;
  const height = fieldHeight * TILE_SIZE;

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const borderThickness = 3.8;
  // Access table parts through the new structure
  const parts = table.parts;
  
  // Corners
  let cy=.1;
  parts.SW.mesh.position.set(0, cy, 0);
  parts.SE.mesh.position.set(width, cy, 0);
  parts.NE.mesh.position.set(width, cy, height);
  parts.NW.mesh.position.set(0, cy, height);
  let s = 6.9;
  let sh = 2.1;
  parts.SW.mesh.scaling.set(s,sh,s);
  parts.SE.mesh.scaling.set(s,sh,s);
  parts.NE.mesh.scaling.set(s,sh,s);
  parts.NW.mesh.scaling.set(s,sh,s);

  parts.FLOOR.mesh.position.set(halfWidth,-.777,halfHeight);
  parts.FLOOR.mesh.scaling.set(width,.40,height);
  
  // Apply materials to table parts
  parts.SW.mesh.material = parts.materials.corner;
  parts.SE.mesh.material = parts.materials.corner;
  parts.NE.mesh.material = parts.materials.corner;
  parts.NW.mesh.material = parts.materials.corner;
  
  parts.N.mesh.material = parts.materials.side;
  parts.E.mesh.material = parts.materials.side;
  parts.S.mesh.material = parts.materials.side;
  parts.W.mesh.material = parts.materials.side;
  
  parts.NT.mesh.material = parts.materials.top;
  parts.ET.mesh.material = parts.materials.top;
  parts.ST.mesh.material = parts.materials.top;
  parts.WT.mesh.material = parts.materials.top;
  
  parts.FLOOR.mesh.material = parts.materials.floor;

  if (liveField.width >= 128){
    parts.NT.mesh.scaling.set(s,sh,s);
    parts.ST.mesh.scaling.set(s,sh,s);
    parts.NT.mesh.position.set(halfWidth, cy, height);
    parts.ST.mesh.position.set(halfWidth, cy, 0);
    
    parts.NT.mesh.isVisible = true;
    parts.ST.mesh.isVisible = true;
  } else {
    parts.NT.mesh.isVisible = false;
    parts.ST.mesh.isVisible = false;
  }
  if (liveField.height >= 128){
    parts.ET.mesh.scaling.set(s,sh,s);
    parts.WT.mesh.scaling.set(s,sh,s);
    parts.ET.mesh.position.set(height, cy, halfHeight);
    parts.WT.mesh.position.set(0, cy, halfHeight);
    
    parts.ET.mesh.isVisible = true;
    parts.WT.mesh.isVisible = true;
  } else {
    parts.ET.mesh.isVisible = false;
    parts.WT.mesh.isVisible = false;
  }






  let yy= .3;
  let rr=.11;
  let ss=.6;
  // Side stretches
  parts.S.mesh.position.set(halfWidth, yy, height);
  parts.S.mesh.scaling.set(width, ss, borderThickness);
  parts.S.mesh.rotation.set(rr, 0,0);

  parts.N.mesh.position.set(halfWidth, yy, 0);
  parts.N.mesh.scaling.set(width, ss, borderThickness);
  parts.N.mesh.rotation.set(-rr, 0,0);

  
  parts.E.mesh.position.set(width, yy, halfHeight);
  parts.E.mesh.scaling.set(borderThickness, ss, height);
  parts.E.mesh.rotation.set(0,0,-rr);

  parts.W.mesh.position.set(0, yy, halfHeight);
  parts.W.mesh.scaling.set(borderThickness, ss, height);
  parts.W.mesh.rotation.set(0,0,rr);






}



Function.prototype.debounce = function (threshold, execAsap) {
  let func = this, timeout;
  return function debounced() {
      let obj = this, args = arguments;
      function delayed() {
          if (!execAsap) func.apply(obj, args);
          timeout = null;
      }
      if (timeout) clearTimeout(timeout);
      else if (execAsap) func.apply(obj, args);
      timeout = setTimeout(delayed, threshold || 100);
  };
};




