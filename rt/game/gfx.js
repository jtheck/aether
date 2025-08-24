





(function(gfx) {
  gfx.canvas; // HTML Canvas
  gfx.engine; // BABYLON Engine
  let engineOptions = {};
  gfx.scene;
  gfx.camera;
  gfx.cameraTarget;


  gfx.init = function() {
    gfx.canvas = document.getElementById('canvas');
    gfx.engine = new BABYLON.Engine(gfx.canvas, false, engineOptions, false);
    gfx.scene = new BABYLON.Scene(gfx.engine);
    gfx.makeScene(gfx.scene);

  
    gfx.scene.whenReadyAsync().then(function() {
      gfx.engine.runRenderLoop(mainRenderLoop);


    });
  }

  function mainRenderLoop(){
    gfx.scene.render();

  }

  gfx.makeScene = function(scene) {
    gfx.camera = gfx.makeCamera();

    scene.ambientColor = new ColorHex('#696969'); // ambient
    let direction = new Vec3(.45, .87, 1).negate(); // sun
    let lightDirectional = new BABYLON.DirectionalLight("*DirectionalLight", direction, scene);
    lightDirectional.position = new Vec3(-50, 30, -12.5);
    lightDirectional.intensity = .12;//.67;
    lightDirectional.diffuse = new ColorHex('#FEFDFB');
    
    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);


    scene.clearColor = ColorHex("#050731"); // purp







// 1. Create the ground mesh
const ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 100, height: 100, subdivisions: 32}, scene);

// 2. Create a standard material
const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", scene);

// 3. Create and assign a tiling diffuse texture
const groundTexture = new BABYLON.Texture("assets/textures/grassy.webp", scene);
groundTexture.uScale = 10.0; // Tile the texture 10 times across the width
groundTexture.vScale = 10.0; // Tile the texture 10 times across the height
groundMaterial.diffuseTexture = groundTexture;

// 4. Create and assign a tiling normal map (CRUCIAL!)
const groundNormalTexture = new BABYLON.Texture("assets/textures/sandy.webp", scene);
groundNormalTexture.uScale = 10.0;
groundNormalTexture.vScale = 10.0;
groundMaterial.bumpTexture = groundNormalTexture;
// groundMaterial.invertNormalMapX = true; // Sometimes needed
// groundMaterial.invertNormalMapY = true; // depending on your map

// 5. Assign the material to the ground
ground.material = groundMaterial;


const box = BABYLON.MeshBuilder.CreateBox("box", {size: 1}, scene);




  }

  gfx.makeCamera = function(scene) {
    let radius = 0;
    let camera = new BABYLON.ArcRotateCamera("zCamera", -2.5, 1.25, radius, new Vec3(0, 0, 0), scene);
    gfx.cameraTarget = new BABYLON.TransformNode("zCameraFocus");
    camera.lockedTarget = gfx.cameraTarget;
    camera.attachControl(gfx.canvas, true);
    camera.lowerRadiusLimit = 5;
    return camera;
  }

}(window.gfx = window.gfx || {}));


