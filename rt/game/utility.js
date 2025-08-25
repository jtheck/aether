







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




gfx.showWorldAxis = function(size, scene, pos) {
  if (!pos) pos = new Vec3(0,0,0);
  var size = size || 1;
  var axisX = BABYLON.Mesh.CreateLines("~~dev_axisX", [
      BABYLON.Vector3.Zero(), new BABYLON.Vector3(size, 0, 0), new BABYLON.Vector3(size * 0.95, 0.05 * size, 0),
      new BABYLON.Vector3(size, 0, 0), new BABYLON.Vector3(size * 0.95, -0.05 * size, 0)
      ], scene);
  axisX.position.addInPlace(pos);
  axisX.color = new BABYLON.Color3(1, 0, 0);
  var axisY = BABYLON.Mesh.CreateLines("~~dev_axisY", [
      BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, size, 0), new BABYLON.Vector3( -0.05 * size, size * 0.95, 0),
      new BABYLON.Vector3(0, size, 0), new BABYLON.Vector3( 0.05 * size, size * 0.95, 0)
      ], scene);
  axisY.position.addInPlace(pos);
  axisY.color = new BABYLON.Color3(0, 1, 0);
  var axisZ = BABYLON.Mesh.CreateLines("~~dev_axisZ", [
      BABYLON.Vector3.Zero(), new BABYLON.Vector3(0, 0, size), new BABYLON.Vector3( 0 , -0.05 * size, size * 0.95),
      new BABYLON.Vector3(0, 0, size), new BABYLON.Vector3( 0, 0.05 * size, size * 0.95)
      ], scene);
  axisZ.position.addInPlace(pos);
  axisZ.color = new BABYLON.Color3(0, 0, 1);
};