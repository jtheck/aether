





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







// 1. Create a single ground mesh
const ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 4, height: 4, subdivisions: 4}, scene);

// 2. Create a simple material using the atlas texture
const groundMaterial = new BABYLON.StandardMaterial("groundMaterial", scene);

// 3. Load your atlas texture
const atlasTexture = new BABYLON.Texture("assets/textures/atlas.png", scene);

// 4. Set up the atlas texture to show one 1024x1024 tile
// atlasTexture.uScale = 4.0;  // 4096/1024 = 4 tiles wide
// atlasTexture.vScale = 4.0;  // 4096/1024 = 4 tiles tall

// 5. Apply the atlas texture to the material
groundMaterial.diffuseTexture = atlasTexture;

// 6. Apply the material to the ground
ground.material = groundMaterial;

// 7. Set texture coordinates directly on the mesh for pixel-perfect tiles
ground.texture = atlasTexture;
// Shrink tiles slightly to prevent bleeding (subtract tiny amount from both sides)
ground.texture.uScale = 0.25 - 0.002;  // 0.002 = 0.001 from each side
ground.texture.vScale = 0.25 - 0.002;  // 0.002 = 0.001 from each side

// 8. Add keyboard controls to cycle through tiles
let currentTile = 0;
const totalTiles = 16;

scene.onKeyboardObservable.add((kbInfo) => {
    if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
        if (kbInfo.event.code === "ArrowRight") {
            currentTile = (currentTile + 1) % totalTiles;
            updateTile();
        } else if (kbInfo.event.code === "ArrowLeft") {
            currentTile = (currentTile - 1 + totalTiles) % totalTiles;
            updateTile();
        } else if (kbInfo.event.code === "Space") {
            currentTile = 0; // Reset to first tile
            updateTile();
        }
    }
});

function updateTile() {
    // Calculate UV offset for current tile
    const row = Math.floor(currentTile / 4);
    const col = currentTile % 4;
    
    // Center the smaller tile within its grid cell
    ground.texture.uOffset = col * 0.25 + 0.2;  // +0.001 to center the smaller tile
    ground.texture.vOffset = row * 0.25 + 0.2;  // +0.001 to center the smaller tile
    
    console.log(`Showing tile ${currentTile} (row ${row}, col ${col})`);
}

// Initialize with first tile
updateTile();

// Create 10x10 grid as a single mesh with custom UVs for atlas mapping
const tileSize = 4; // Size of each tile in world units

// Create one material with the atlas texture
const terrainMaterial = new BABYLON.StandardMaterial("terrainMaterial", scene);
const terrainAtlasTexture = new BABYLON.Texture("assets/textures/atlas.png", scene);
terrainMaterial.diffuseTexture = terrainAtlasTexture;

// No texture scaling needed - we control UVs directly in the vertex data
// terrainAtlasTexture.uScale = 1.0;  // Default scale
// terrainAtlasTexture.vScale = 1.0;  // Default scale

// Create vertex data for 10x10 grid
const verts = [];
const uvs = [];
const indices = [];

// Generate vertices and UVs for each tile
for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
        // Random atlas tile (0-15)
        const randomTile = Math.floor(Math.random() * 16);
        const tileRow = Math.floor(randomTile / 4);
        const tileCol = randomTile % 4;
        
        // Calculate world positions for this tile
        const x1 = col * tileSize;
        const x2 = (col + 1) * tileSize;
        const z1 = row * tileSize;
        const z2 = (row + 1) * tileSize;
        
        // Calculate UV coordinates for this atlas tile (with bleeding prevention)
        const u1 = tileCol * 0.25 + 0.025;
        const u2 = (tileCol + 1) * 0.25 - 0.025;
        const v1 = tileRow * 0.25 + 0.025;
        const v2 = (tileRow + 1) * 0.25 - 0.025;
        
        // Add 4 vertices for this tile (counter-clockwise)
        const baseIndex = (row * 10 + col) * 4;
        
        // Vertex positions (x, y, z)
        verts.push(x1, 0, z1);  // Bottom-left
        verts.push(x2, 0, z1);  // Bottom-right
        verts.push(x2, 0, z2);  // Top-right
        verts.push(x1, 0, z2);  // Top-left
        
        // UV coordinates (u, v)
        uvs.push(u1, v1);  // Bottom-left
        uvs.push(u2, v1);  // Bottom-right
        uvs.push(u2, v2);  // Top-right
        uvs.push(u1, v2);  // Top-left
        
        // Add indices for 2 triangles (counter-clockwise)
        indices.push(baseIndex, baseIndex + 1, baseIndex + 2);     // First triangle
        indices.push(baseIndex, baseIndex + 2, baseIndex + 3);     // Second triangle
    }
}

// Create the mesh with custom geometry
const terrainMesh = new BABYLON.Mesh("terrainMesh", scene);
const vertexData = new BABYLON.VertexData();
vertexData.positions = verts;
vertexData.indices = indices;
vertexData.uvs = uvs;
vertexData.applyToMesh(terrainMesh);

// Apply the material
terrainMesh.material = terrainMaterial;

console.log(`Created single terrain mesh with ${verts.length / 4} tiles!`);
console.log("Each tile maps to different atlas region via custom UVs");
console.log("One mesh, one material, one texture - efficient rendering!");

const box = BABYLON.MeshBuilder.CreateBox("box", {size: 1}, scene);

gfx.showWorldAxis(32, scene, new Vec3(0,0,0));



  }





  
  gfx.makeCamera = function(scene) {
    let radius = 0;
    let camera = new BABYLON.ArcRotateCamera("zCamera", -2.5, 1.25, radius, new Vec3(0, 0, 0), scene);
    gfx.cameraTarget = new BABYLON.TransformNode("zCameraFocus");
    camera.lockedTarget = gfx.cameraTarget;
    camera.attachControl(gfx.canvas, true);


    camera.upperRadiusLimit = 111;
    camera.lowerRadiusLimit = 5;
    camera.maxZ = 111; // max render distance
    camera.minZ = .5; // minimum render distance
    camera.fov = .8; // default .8
 

    camera.wheelPrecision = 1.15;
    camera.wheelDeltaPercentage = .02;
    // camera.pinchDeltaPercentage = .02;
    camera.inertia = .6;
    camera.angularSensibilityX *= .5;
    camera.angularSensibilityY *= .5;

    return camera;
  }

}(window.gfx = window.gfx || {}));


