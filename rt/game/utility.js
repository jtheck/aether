




gfx.makeTable = function(scene){
  return {
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
      mesh: BABYLON.MeshBuilder.CreateBox("W", {size: 1}, scene),
    }};
}


gfx.stretchTable = function(table) {
  let fieldWidth = liveField.width;
  let fieldHeight = liveField.height;

  const width = fieldWidth * TILE_SIZE;
  const height = fieldHeight * TILE_SIZE;

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const borderThickness = 3.8;
  // Corners
  let cy=.1;
  table.SW.mesh.position.set(0, cy, 0);
  table.SE.mesh.position.set(width, cy, 0);
  table.NE.mesh.position.set(width, cy, height);
  table.NW.mesh.position.set(0, cy, height);
  let s = 6.9;
  let sh = 2.1;
  table.SW.mesh.scaling.set(s,sh,s);
  table.SE.mesh.scaling.set(s,sh,s);
  table.NE.mesh.scaling.set(s,sh,s);
  table.NW.mesh.scaling.set(s,sh,s);

  table.FLOOR.mesh.position.set(halfWidth,-.5,halfHeight);
  table.FLOOR.mesh.scaling.set(width,.40,height);
  // const floorMat = new BABYLON.PBRMaterial("floorMat", gfx.scene);
  // floorMat.specularColor = new BABYLON.Color3(0.07, 0.07, 0.07);
  // floorMat.diffuseColor = new ColorHex("#123524"); // Remove diffuse
  // floorMat.specularColor = new BABYLON.Color3(1,1,1); // Remove diffuse
  // floorMat.metallic = 0.0; // Non-metallic
  // floorMat.roughness = 0.8; // Slightly rough finish
  // floorMat.disableLighting = false; // Keep this false for emissive to work

  if (liveField.width >= 128){
    table.NT.mesh.scaling.set(s,sh,s);
    table.ST.mesh.scaling.set(s,sh,s);
    table.NT.mesh.position.set(halfWidth, cy, height);
    table.ST.mesh.position.set(halfWidth, cy, 0);
    
    table.NT.mesh.isVisible = true;
    table.ST.mesh.isVisible = true;
  } else {
    table.NT.mesh.isVisible = false;
    table.ST.mesh.isVisible = false;
  }
  if (liveField.height >= 128){
    table.ET.mesh.scaling.set(s,sh,s);
    table.WT.mesh.scaling.set(s,sh,s);
    table.ET.mesh.position.set(height, cy, halfHeight);
    table.WT.mesh.position.set(0, cy, halfHeight);

    table.ET.mesh.isVisible = true;
    table.WT.mesh.isVisible = true;
  } else {
    table.ET.mesh.isVisible = false;
    table.WT.mesh.isVisible = false;
  }





  // table.FLOOR.mesh.material = floorMat;

  let yy= .3;
  let rr=.11;
  let ss=.6;
  // Side stretches
  table.S.mesh.position.set(halfWidth, yy, height);
  table.S.mesh.scaling.set(width, ss, borderThickness);
  table.S.mesh.rotation.set(rr, 0,0);

  table.N.mesh.position.set(halfWidth, yy, 0);
  table.N.mesh.scaling.set(width, ss, borderThickness);
  table.N.mesh.rotation.set(-rr, 0,0);

  
  table.E.mesh.position.set(width, yy, halfHeight);
  table.E.mesh.scaling.set(borderThickness, ss, height);
  table.E.mesh.rotation.set(0,0,-rr);

  table.W.mesh.position.set(0, yy, halfHeight);
  table.W.mesh.scaling.set(borderThickness, ss, height);
  table.W.mesh.rotation.set(0,0,rr);






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




