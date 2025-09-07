





(function(gfx) {
  gfx.canvas; // HTML Canvas
  gfx.engine; // BABYLON Engine
  let engineOptions = {};
  gfx.scene;
  gfx.camera;
  gfx.cameraTarget;
  gfx.cursorFrog; // Frog model to show cursor position
  gfx.table;

  // Progressive chunk loading queue
  const chunkQueue = [];
  const CHUNKS_PER_FRAME = 3; // Process 3 chunks per frame for faster loading

  // Load textures at the top so they're available everywhere
  let grassAtlasTexture, dirtAtlasTexture, rockAtlasTexture, sandAtlasTexture, waterAtlasTexture;
  
  // Create shared materials once (reused across all chunks)
  let sharedMaterials = {};
  
  // Model loading and cloning system
  const modelPromises = new Map();
  const cloneCount = {};

  function getModel(path, scene) {
    if (!modelPromises.has(path)) {
      const loadPromise = BABYLON.SceneLoader.LoadAssetContainerAsync(path, undefined, scene)
        .then(container => {
          return () => {
            const result = container.instantiateModelsToScene();
            const count = (cloneCount[path] = (cloneCount[path] || 0) + 1);
            
            // Give each clone a unique name
            result.rootNodes.forEach(n => n.name += `_${count}`);
            
            // Stop any animations by default
            result.animationGroups.forEach(g => g.stop());

            // Cleanup function for this clone
            const dispose = () => {
              result.animationGroups.forEach(g => g.stop());
              result.animationGroups.forEach(g => g.dispose());
              result.rootNodes.forEach(n => n.dispose());
              result.skeletons.forEach(s => s.dispose());
            };

            return {
              root: result.rootNodes[0],
              nodes: result.rootNodes,
              animationGroups: result.animationGroups,
              skeletons: result.skeletons,
              dispose
            };
          };
        });
      modelPromises.set(path, loadPromise);
    }

    return modelPromises.get(path).then(cloneFn => cloneFn());
  }

  // Helper function to place models on terrain
  function placeModelOnTile(modelPath, scene, position, rotation = 0, scale = 1) {
    return getModel(modelPath, scene).then(model => {
      model.root.position = position;
      model.root.rotation.y = rotation;
      model.root.scaling = new BABYLON.Vector3(scale, scale, scale);
      return model;
    });
  }

  // Store all models with billboards for manual LOD management
  const lodModels = [];
  
  // Model instance pools for reuse
  const modelPools = new Map(); // path -> array of available instances
  const activeModels = new Map(); // chunkKey -> array of model instances in use
  
  // Function to clean up models when chunk unloads
  function cleanupChunkModels(chunkKey) {
    const models = activeModels.get(chunkKey);
    if (models) {
      models.forEach(modelInfo => {
        // Return model to pool instead of disposing
        returnModelToPool(modelInfo.model, modelInfo.path);
        
        // Remove from LOD tracking and return billboard to pool
        const lodIndex = lodModels.findIndex(lod => lod.model === modelInfo.model.root);
        if (lodIndex !== -1) {
          const lod = lodModels[lodIndex];
          if (lod.billboard) {
            returnBillboardInstance(lod.billboard);
          }
          lodModels.splice(lodIndex, 1);
        }
      });
      activeModels.delete(chunkKey);
    }
  }
  
  // Billboard texture atlas (single texture with all billboard sprites)
  // Atlas layout: 8 columns x 8 rows = 64 total slots
  // Row 0: tree, gate, windvane, tortle, birdy, mushroom, frog, flag
  // Row 1: rocks_plain, rocks_moss, rocks_snow, windmill, factory, gnome, villager, ae
  // Row 2: trees, agora, [unused slots 2-7]
  // Rows 3-7: [unused] - reserved for future models
  let billboardAtlas = null;
  let billboardMaterial = null;
  
  // Instanced billboard system for performance - separate mesh per model type
  const billboardInstancedMeshes = new Map(); // modelType -> master mesh
  const billboardInstances = []; // Track all billboard instances
  const billboardInstancePools = new Map(); // modelType -> pool of disabled instances
  let billboardInstanceIndex = 0;
  
  // LOD distance tweaker - adjust this to change when models switch to billboards
  let LOD_DISTANCE = 225; // Units - models switch to billboards beyond this distance
  
  // LOD update throttling
  let lastLODUpdate = 0;
  const LOD_UPDATE_INTERVAL = 100; // Update LOD every 100ms instead of every frame
  let lodUpdateIndex = 0; // For batching LOD updates

  // Initialize billboard atlas and material
  function initBillboardAtlas(scene) {
    if (!billboardMaterial) {
      // Create a single shared material for all billboards
      billboardMaterial = new BABYLON.StandardMaterial('billboardAtlasMat', scene);
      
      // Use the atlas-hd texture for billboards
      // Expected format: 8 columns x 8 rows (64 total slots) for 1024x1024 texture
      // Each slot should be 128x128 pixels for optimal quality
      // Current usage: ~20 slots, plenty of room for expansion
      billboardMaterial.diffuseTexture = new BABYLON.Texture('assets/textures/atlas-hd.png', scene);
      
      // Enable transparency for PNG alpha channel
      billboardMaterial.diffuseTexture.hasAlpha = true;
      billboardMaterial.useAlphaFromDiffuseTexture = true;
      billboardMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      
      // Softer lighting for more rounded appearance
      billboardMaterial.ambientColor = new BABYLON.Color3(0.7, 0.7, 0.7); // More ambient light
      billboardMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.9); // Softer diffuse
      billboardMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Reduce harsh specular
      billboardMaterial.emissiveColor = new BABYLON.Color3(.36, .35, .35); // More self-illumination for visibility
      
      billboardMaterial.backFaceCulling = false;
      
      // console.log('Billboard atlas material initialized with atlas-hd.png, transparency, and soft lighting');
    }
  }
  
  // Get or create instanced mesh for a specific model type
  function getBillboardMasterMesh(modelPath, scene) {
    // Determine model type from path - expanded to handle more model types
    let modelType = 'other';
    if (modelPath.includes('tree')) modelType = 'tree';
    else if (modelPath.includes('gate')) modelType = 'gate';
    else if (modelPath.includes('windvane')) modelType = 'windvane';
    else if (modelPath.includes('tortle')) modelType = 'tortle';
    else if (modelPath.includes('birdy')) modelType = 'birdy';
    else if (modelPath.includes('mushroom')) modelType = 'mushroom';
    else if (modelPath.includes('frog')) modelType = 'frog';
    else if (modelPath.includes('flag')) modelType = 'flag';
    else if (modelPath.includes('rocks_plain')) modelType = 'rocks_plain';
    else if (modelPath.includes('rocks_moss')) modelType = 'rocks_moss';
    else if (modelPath.includes('rocks_snow')) modelType = 'rocks_snow';
    else if (modelPath.includes('windmill')) modelType = 'windmill';
    else if (modelPath.includes('factory')) modelType = 'factory';
    else if (modelPath.includes('gnome')) modelType = 'gnome';
    else if (modelPath.includes('villager')) modelType = 'villager';
    else if (modelPath.includes('ae')) modelType = 'ae';
    else if (modelPath.includes('trees')) modelType = 'trees';
    else if (modelPath.includes('agora')) modelType = 'agora';
    
    // Create master mesh for this type if it doesn't exist
    if (!billboardInstancedMeshes.has(modelType)) {
      const masterMesh = BABYLON.MeshBuilder.CreatePlane(`billboardMaster_${modelType}`, {width: 3, height: 3}, scene);
      masterMesh.material = billboardMaterial;
      masterMesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      
      // Set the correct UV coordinates for this model type
      masterMesh.setVerticesData(BABYLON.VertexBuffer.UVKind, getModelUV(modelPath));
      masterMesh.setEnabled(false); // Hide the master mesh
      
      billboardInstancedMeshes.set(modelType, masterMesh);
      billboardInstancePools.set(modelType, []); // Initialize pool for this type
      
      // console.log(`Created billboard master mesh for type: ${modelType}`);
    }
    
    return billboardInstancedMeshes.get(modelType);
  }
  
  // Get UV coordinates for model type (cached for performance)
  const modelUVCache = new Map();
  function getModelUV(modelPath) {
    if (modelUVCache.has(modelPath)) {
      return modelUVCache.get(modelPath);
    }
    
    // 1024x1024 atlas: 8 columns x 8 rows = 64 total slots
    const cellSizeX = 1/8;  // 8 columns
    const cellSizeY = 1/8;  // 8 rows
    let cellX = 0, cellY = 0;
    
    // Row 0: Basic models
    if (modelPath.includes('tree')) {
      cellX = 0; cellY = 0; // Trees - first cell
    } else if (modelPath.includes('gate')) {
      cellX = 1; cellY = 0; // Gates - second cell
    } else if (modelPath.includes('windvane')) {
      cellX = 2; cellY = 0; // Windvanes - third cell
    } else if (modelPath.includes('tortle')) {
      cellX = 3; cellY = 0; // Tortles - fourth cell
    } else if (modelPath.includes('birdy')) {
      cellX = 4; cellY = 0; // Birds - fifth cell
    } else if (modelPath.includes('mushroom')) {
      cellX = 5; cellY = 0; // Mushrooms - sixth cell
    } else if (modelPath.includes('frog')) {
      cellX = 6; cellY = 0; // Frogs - seventh cell
    } else if (modelPath.includes('flag')) {
      cellX = 7; cellY = 0; // Flags - eighth cell
    }
    // Row 1: Rock variants and structures
    else if (modelPath.includes('rocks_plain')) {
      cellX = 0; cellY = 1; // Plain rocks
    } else if (modelPath.includes('rocks_moss')) {
      cellX = 1; cellY = 1; // Mossy rocks
    } else if (modelPath.includes('rocks_snow')) {
      cellX = 2; cellY = 1; // Snowy rocks
    } else if (modelPath.includes('windmill')) {
      cellX = 3; cellY = 1; // Windmill
    } else if (modelPath.includes('factory')) {
      cellX = 4; cellY = 1; // Factory
    } else if (modelPath.includes('gnome')) {
      cellX = 5; cellY = 1; // Gnome
    } else if (modelPath.includes('villager')) {
      cellX = 6; cellY = 1; // Villager
    } else if (modelPath.includes('ae')) {
      cellX = 7; cellY = 1; // AE model
    }
    // Row 2: Additional models and variants
    else if (modelPath.includes('trees')) {
      cellX = 0; cellY = 2; // Trees (plural)
    } else if (modelPath.includes('agora')) {
      cellX = 1; cellY = 2; // Agora
    } else {
      // Default to first slot of row 3 for any other models
      cellX = 0; cellY = 3;
    }
    
    // UV coordinates for a quad - flipped V to fix upside-down
    const u1 = cellX * cellSizeX;
    const u2 = (cellX + 1) * cellSizeX;
    const v1 = 1.0 - (cellY * cellSizeY);      // top of texture (flipped)
    const v2 = 1.0 - ((cellY + 1) * cellSizeY); // bottom of texture (flipped)
    
    const uvs = [
      u1, v2,  // bottom-left
      u2, v2,  // bottom-right  
      u2, v1,  // top-right
      u1, v1   // top-left
    ];
    
    // console.log(`Model ${modelPath} -> Cell (${cellX},${cellY}) -> UVs: ${u1.toFixed(3)}-${u2.toFixed(3)}, ${v1.toFixed(3)}-${v2.toFixed(3)}`);
    
    modelUVCache.set(modelPath, uvs);
    return uvs;
  }

  // Get a billboard instance from the pool (optimized)
  function getBillboardInstance(modelPath, position, scale, scene) {
    // Determine model type - expanded to handle more model types
    let modelType = 'other';
    if (modelPath.includes('tree')) modelType = 'tree';
    else if (modelPath.includes('gate')) modelType = 'gate';
    else if (modelPath.includes('windvane')) modelType = 'windvane';
    else if (modelPath.includes('tortle')) modelType = 'tortle';
    else if (modelPath.includes('birdy')) modelType = 'birdy';
    else if (modelPath.includes('mushroom')) modelType = 'mushroom';
    else if (modelPath.includes('frog')) modelType = 'frog';
    else if (modelPath.includes('flag')) modelType = 'flag';
    else if (modelPath.includes('rocks_plain')) modelType = 'rocks_plain';
    else if (modelPath.includes('rocks_moss')) modelType = 'rocks_moss';
    else if (modelPath.includes('rocks_snow')) modelType = 'rocks_snow';
    else if (modelPath.includes('windmill')) modelType = 'windmill';
    else if (modelPath.includes('factory')) modelType = 'factory';
    else if (modelPath.includes('gnome')) modelType = 'gnome';
    else if (modelPath.includes('villager')) modelType = 'villager';
    else if (modelPath.includes('ae')) modelType = 'ae';
    else if (modelPath.includes('trees')) modelType = 'trees';
    else if (modelPath.includes('agora')) modelType = 'agora';
    
    // Get the master mesh for this type
    const masterMesh = getBillboardMasterMesh(modelPath, scene);
    
    // Get pool for this type
    const pool = billboardInstancePools.get(modelType);
    let instance;
    
    // Try to get from type-specific pool first (fastest)
    if (pool.length > 0) {
      instance = pool.pop();
    } else {
      // Create new instance if pool is empty
      instance = masterMesh.createInstance(`billboard_${modelType}_${billboardInstanceIndex++}`);
      billboardInstances.push(instance);
    }
    
    // Configure the instance (reuse existing objects to avoid GC)
    instance.position.copyFrom(position);
    
    // Set pivot to bottom of billboard so scaling keeps it grounded
    instance.setPivotPoint(new BABYLON.Vector3(0, -0.5, 0)); // Bottom of unit plane
    
    // Random rotation variation - just 180° flip for horizontal variety
    // const shouldRotate = Math.random() < 0.5; // 50% chance to rotate 180°
    
    instance.scaling.x = scale;
    instance.scaling.y = scale;
    instance.scaling.z = 1;
    
    // Rotate 180 degrees around Y axis for variation
    instance.rotationQuaternion = null; // Force Euler angles
    // instance.rotation.y = shouldRotate ? Math.PI : 0;
    instance.isPickable = false; // Make billboards non-pickable too
    instance.setEnabled(true);
    
    return instance;
  }
  
  // Return a billboard instance to the pool (optimized)
  function returnBillboardInstance(instance) {
    instance.setEnabled(false);
    
    // Determine which pool to return to based on instance name
    const instanceName = instance.name;
    if (instanceName.includes('_tree_')) billboardInstancePools.get('tree').push(instance);
    else if (instanceName.includes('_gate_')) billboardInstancePools.get('gate').push(instance);
    else if (instanceName.includes('_windvane_')) billboardInstancePools.get('windvane').push(instance);
    else if (instanceName.includes('_tortle_')) billboardInstancePools.get('tortle').push(instance);
    else if (instanceName.includes('_birdy_')) billboardInstancePools.get('birdy').push(instance);
    else if (instanceName.includes('_mushroom_')) billboardInstancePools.get('mushroom').push(instance);
    else if (instanceName.includes('_frog_')) billboardInstancePools.get('frog').push(instance);
    else if (instanceName.includes('_flag_')) billboardInstancePools.get('flag').push(instance);
    else if (instanceName.includes('_rocks_plain_')) billboardInstancePools.get('rocks_plain').push(instance);
    else if (instanceName.includes('_rocks_moss_')) billboardInstancePools.get('rocks_moss').push(instance);
    else if (instanceName.includes('_rocks_snow_')) billboardInstancePools.get('rocks_snow').push(instance);
    else if (instanceName.includes('_windmill_')) billboardInstancePools.get('windmill').push(instance);
    else if (instanceName.includes('_factory_')) billboardInstancePools.get('factory').push(instance);
    else if (instanceName.includes('_gnome_')) billboardInstancePools.get('gnome').push(instance);
    else if (instanceName.includes('_villager_')) billboardInstancePools.get('villager').push(instance);
    else if (instanceName.includes('_ae_')) billboardInstancePools.get('ae').push(instance);
    else if (instanceName.includes('_trees_')) billboardInstancePools.get('trees').push(instance);
    else if (instanceName.includes('_agora_')) billboardInstancePools.get('agora').push(instance);
    else billboardInstancePools.get('other').push(instance);
  }

  // Get or create a model instance from the pool
  function getPooledModel(modelPath, scene, position, rotation, scale) {
    const chunkKey = 'temp'; // We'll fix this when we integrate with chunks
    
    // Get pool for this model type
    if (!modelPools.has(modelPath)) {
      modelPools.set(modelPath, []);
    }
    
    const pool = modelPools.get(modelPath);
    
    // Try to reuse an existing instance
    if (pool.length > 0) {
      const model = pool.pop();
      model.root.position.copyFrom(position);
      // Disable quaternions like we do with units/buildings
      model.root.rotationQuaternion = null;
      model.root.rotation.y = rotation;
      
      // Set pivot to bottom before scaling so models stay grounded
      model.root.setPivotPoint(new BABYLON.Vector3(0, 0, 0));
      model.root.scaling.x = scale;
      model.root.scaling.y = scale;
      model.root.scaling.z = scale;
      model.root.setEnabled(true);
      return Promise.resolve(model);
    } else {
      // Create new instance if pool is empty
      return getModel(modelPath, scene).then(model => {
        model.root.position.copyFrom(position);
        // Disable quaternions like we do with units/buildings
        model.root.rotationQuaternion = null;
        model.root.rotation.y = rotation;
        model.root.scaling.x = scale;
        model.root.scaling.y = scale;
        model.root.scaling.z = scale;
        return model;
      });
    }
  }

  // Return a model instance to the pool for reuse
  function returnModelToPool(model, modelPath) {
    model.root.setEnabled(false);
    model.root.parent = null; // Unparent it
    
    if (!modelPools.has(modelPath)) {
      modelPools.set(modelPath, []);
    }
    
    modelPools.get(modelPath).push(model);
  }

  // Add LOD billboard for distant viewing
  function addLODBillboard(model, scene, modelRule, cameraPosition) {
    let billboard = null;
    let lodType = 'billboard'; // default behavior
    const modelPath = modelRule.path;
    const customLodDistance = modelRule.lodDistance || LOD_DISTANCE;
    
    // Use instanced billboard system for all models
    const scale = modelRule.billboardScale || 1;
    
    billboard = getBillboardInstance(modelPath, model.root.position, scale, scene);
    billboard.setEnabled(false); // Start with billboard disabled - LOD system will manage visibility
    
    // Store for manual LOD management
    lodModels.push({
      model: model.root,
      billboard: billboard,
      lodType: lodType,
      lodDistance: customLodDistance,
      cullDistance: modelRule.cullDistance || customLodDistance * 2
    });
    
    // console.log('Created LOD for:', modelPath, 'Type:', lodType, 'Distance:', customLodDistance, 'Initial state:', cameraPosition ? (BABYLON.Vector3.Distance(cameraPosition, model.root.position) > customLodDistance ? 'LOD' : '3D') : 'Unknown');
  }

  // Manual LOD update function - called each frame
  function updateLOD(cameraPosition) {
    // Skip LOD updates during batch loading to prevent flickering
    if (skipLODUpdates) return;
    
    // Quick distance calculation using squared distance (no sqrt)
    const camX = cameraPosition.x;
    const camY = cameraPosition.y; 
    const camZ = cameraPosition.z;
    
    // Process all models every frame for immediate response
    lodModels.forEach(lod => {
      const modelPos = lod.model.position;
      const dx = camX - modelPos.x;
      const dy = camY - modelPos.y;
      const dz = camZ - modelPos.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const lodDistanceSquared = lod.lodDistance * lod.lodDistance;
      const cullDistanceSquared = (lod.cullDistance || lod.lodDistance * 2) * (lod.cullDistance || lod.lodDistance * 2);
      
      if (distanceSquared > cullDistanceSquared) {
        // Very far away - completely cull everything for performance
        lod.model.setEnabled(false);
        if (lod.billboard) {
          lod.billboard.setEnabled(false);
        }
        
      } else if (distanceSquared > lodDistanceSquared) {
        // Medium distance - show billboard, hide model
        lod.model.setEnabled(false);
        
        if (lod.lodType === 'billboard' && lod.billboard) {
          lod.billboard.setEnabled(true);
        }
        
      } else {
        // Close up - show model, hide billboard
        lod.model.setEnabled(true);
        if (lod.billboard) {
          lod.billboard.setEnabled(false);
        }
      }
    });
  }
let pov1 = 170;
let pov2 = 240;
  // Model rules for different tile types
  const modelRules = {
    // Grass tiles (0-15) - trees, mushrooms, etc.
    5: { // GRASS_IN
      models: [
        // Ordered rarest to most common for priority spawning - THICKER SPAWNS
        { path: "assets/models/mushroom.glb", chance: 0.2, scale: 0.1, billboardScale: 0.5, lodDistance: pov1 }, // 20% - rare finds
        { path: "assets/models/rocks_plain.glb", chance: 0.3, scale: 3.0, billboardScale: 3, lodDistance: pov1 }, // 30% - plain rocks
        { path: "assets/models/rocks_moss.glb", chance: 0.4, scale: 7.5, billboardScale: 5.9, lodDistance: pov2 }, // 40% - moss rocks
        { path: "assets/models/trees.glb", chance: 0.75, scale: .9, billboardScale: 3, lodDistance: pov1 }, // 70% - THICK FORESTS!
        { path: "assets/models/tortle.glb", chance: 0.5, scale: 0.1, billboardScale: 11, lodDistance: pov1 }, // 50% - more tortles
        { path: "assets/models/frog.glb", chance: 0.6, scale: 0.1, billboardScale: 0.5, lodDistance: pov1 }, // 60% - more frogs
        { path: "assets/models/rocks_snow.glb", chance: 0.95, scale: 11.5, billboardScale: 7.5, lodDistance: pov2 } // 95% - snow everywhere!

      ]
    },
    // Dirt tiles (20-35) - rocks, gates, etc.
    15: { // DIRT_IN
      models: [
        { path: "assets/models/trees.glb", chance: 0.5, scale: 1.15, billboardScale: 2, lodDistance: 200 }, // 70% - THICK FORESTS!

        { path: "assets/models/gate.glb", chance: 0.08, scale: .1, billboardScale: 1.2, lodDistance: 100 },
      ]
    },
    // Rock tiles (40-55) - more rocks, windvanes
    45: { // ROCK_IN
      models: [
        { path: "assets/models/windvane.glb", chance: 0.015, scale: 0.009, billboardScale: 2, lodDistance: 120 },
        // { path: "assets/models/ae.glb", chance: 0.1, scale: 0.8 }
      ]
    },
    // Sand tiles (60-75) - tortles, birdies
    65: { // SAND_IN
      models: [
        { path: "assets/models/tortle.glb", chance: 0.12, scale: 0.01, billboardScale: 0.5, lodDistance: 30 },
        { path: "assets/models/birdy.glb", chance: 0.08, scale: 0.07, billboardScale: 1, lodDistance: 40 }
      ]
    },
    // Water tiles (80-95) - frogs, boats
    85: { // WATER_IN
      models: [
        { path: "assets/models/frog.glb", chance: 0.02, scale: 0.1, billboardScale: 0.5, lodDistance: 35 },
        // { path: "assets/models/ae.glb", chance: 0.05, scale: 0.1 }
      ]
    }
  };

  // Model loading queue to prevent blocking
  const modelLoadQueue = [];
  let isProcessingQueue = false;
  let skipLODUpdates = false; // Flag to prevent LOD flickering during loading
  
  // Process model loading queue in batches to prevent blocking
  function processModelQueue() {
    if (isProcessingQueue || modelLoadQueue.length === 0) return;
    
    isProcessingQueue = true;
    skipLODUpdates = true; // Prevent LOD flickering during batch loading
    const BATCH_SIZE = 4; // Load max 1 model per frame to prevent hitches
    
    for (let i = 0; i < Math.min(BATCH_SIZE, modelLoadQueue.length); i++) {
      const task = modelLoadQueue.shift();
      
      getPooledModel(task.modelPath, task.scene, task.position, task.rotation, task.scale)
        .then(model => {
          // All the same model setup logic
          task.models.push(model);
          model.root.parent = task.chunk.mesh;
          
          // Start model hidden - LOD will determine visibility
          model.root.setEnabled(false);
          
          const chunkKey = `${task.chunk.chunkX},${task.chunk.chunkZ}`;
          if (!activeModels.has(chunkKey)) {
            activeModels.set(chunkKey, []);
          }
          activeModels.get(chunkKey).push({
            model: model,
            path: task.modelPath
          });
          
          model.root.isPickable = false;
          model.root.getChildMeshes().forEach(mesh => {
            mesh.isPickable = false;
            
            // Ensure models receive proper lighting
            if (mesh.material) {
              // mesh.material.disableLighting = false; // Enable lighting
              if (mesh.material.emissiveColor) {
                // Reduce emissive so it doesn't glow in the dark
                mesh.material.emissiveColor = new BABYLON.Color3(0, 0, 0);
              }
            }
          });
          
          // Add LOD billboard first
          addLODBillboard(model, task.scene, task.modelRule, gfx.camera ? gfx.camera.position : null);
          
          // Immediately set correct LOD state based on current camera position
          if (gfx.camera) {
            const modelPos = model.root.position;
            const camPos = gfx.camera.position;
            const dx = camPos.x - modelPos.x;
            const dy = camPos.y - modelPos.y;
            const dz = camPos.z - modelPos.z;
            const distanceSquared = dx * dx + dy * dy + dz * dz;
            const lodDistanceSquared = task.modelRule.lodDistance * task.modelRule.lodDistance;
            
            // Find the LOD entry we just created to enable the right part
            const lodEntry = lodModels[lodModels.length - 1]; // Last added entry
            
            // Set initial state based on distance
            if (distanceSquared > lodDistanceSquared) {
              // Far away - start with billboard enabled, model disabled
              model.root.setEnabled(false);
              if (lodEntry && lodEntry.billboard) {
                lodEntry.billboard.setEnabled(true);
              }
            } else {
              // Close - start with 3D model enabled, billboard disabled
              model.root.setEnabled(true);
              if (lodEntry && lodEntry.billboard) {
                lodEntry.billboard.setEnabled(false);
              }
            }
          } else {
            // No camera yet - start disabled
            model.root.setEnabled(false);
          }
        })
        .catch(err => console.warn('Model loading failed:', err));
    }
    
    isProcessingQueue = false;
    
    // Continue processing next frame if queue not empty
    if (modelLoadQueue.length > 0) {
      requestAnimationFrame(processModelQueue);
    } else {
      // Re-enable LOD updates when queue is empty
      skipLODUpdates = false;
    }
  }

  // Function to queue models for a chunk individually (prevents snap-in)
  function queueModelsForChunk(chunk, scene) {
    chunk.tiles.forEach((tile, index) => {
      const localX = index % (chunk.endX - chunk.startX);
      const localZ = Math.floor(index / (chunk.endX - chunk.startX));
      
      // Calculate world position for this tile
      const worldX = (chunk.startX + localX) * TILE_SIZE;
      const worldZ = (chunk.startZ + localZ) * TILE_SIZE;
      
      // Check if this tile type has model rules
      const rules = modelRules[tile.type];
      if (rules && rules.length > 0) {
        // Try to place a model (only one per tile)
        for (const rule of rules) {
          if (Math.random() < rule.chance) {
            // Add this model to the queue instead of placing immediately
            addModelToQueue(rule.path, new BABYLON.Vector3(worldX, 0, worldZ), rule.scale, scene);
            break; // Only one model per tile
          }
        }
      }
    });
  }

  // Function to place models on a chunk (now uses batched loading)
  function placeModelsOnChunk(chunk, scene) {
    const models = [];
    
    chunk.tiles.forEach((tile, index) => {
      const localX = index % (chunk.endX - chunk.startX);
      const localZ = Math.floor(index / (chunk.endX - chunk.startX));
      
      // Calculate world position for this tile
      const worldX = (chunk.startX + localX) * TILE_SIZE;
      const worldZ = (chunk.startZ + localZ) * TILE_SIZE;
      
      // Check if this tile type has model rules
      const rule = modelRules[tile.type];
      if (rule) {
        // Only place one model per tile - pick randomly from available models
        let selectedModel = null;
        
        // Go through models and test chance, but stop at first success
        for (const modelRule of rule.models) {
          if (Math.random() < modelRule.chance) {
            selectedModel = modelRule;
            break; // Only place one model per tile
          }
        }
        
        // If a model was selected, place it
        if (selectedModel) {
          // Add some randomness to position within tile
          const offsetX = (Math.random() - 0.5) * 0.6;
          const offsetZ = (Math.random() - 0.5) * 0.6;
          const position = new BABYLON.Vector3(
            worldX + offsetX, 
            0, 
            worldZ + offsetZ
          );
          
          // Random rotation
          const rotation = Math.random() * Math.PI * 2;
          
          // Initialize billboard atlas if needed
          initBillboardAtlas(scene);
          
          // Queue model for batched loading instead of loading immediately
          modelLoadQueue.push({
            modelPath: selectedModel.path,
            scene: scene,
            position: position,
            rotation: rotation,
            scale: selectedModel.scale,
            chunk: chunk,
            models: models,
            modelRule: selectedModel
          });
        }
      }
    });
    
    // Start processing the model queue if not already running
    if (!isProcessingQueue && modelLoadQueue.length > 0) {
      requestAnimationFrame(processModelQueue);
    }
    
    return models;
  }

  // Create terrain mesh function (moved to top so it's available everywhere)
  // const tileSize = 4; // Size of each tile in world units
  function createTerrainMesh(scene, chunk, tileSize = TILE_SIZE) { // Use TILE_SIZE constant
    // Define all available materials
    const materials = {
      grass: { texture: grassAtlasTexture, name: 'grass' },
      dirt: { texture: dirtAtlasTexture, name: 'dirt' },
      rock: { texture: rockAtlasTexture, name: 'rock' },
      sand: { texture: sandAtlasTexture, name: 'sand' },
      water: { texture: waterAtlasTexture, name: 'water' }
    };
    
    // Use shared materials (create if they don't exist yet)
    if (!sharedMaterials.grass) {
      sharedMaterials.grass = new BABYLON.StandardMaterial("grassMaterial", scene);
      sharedMaterials.grass.diffuseTexture = grassAtlasTexture;
    }
    if (!sharedMaterials.dirt) {
      sharedMaterials.dirt = new BABYLON.StandardMaterial("dirtMaterial", scene);
      sharedMaterials.dirt.diffuseTexture = dirtAtlasTexture;
    }
    if (!sharedMaterials.rock) {
      sharedMaterials.rock = new BABYLON.StandardMaterial("rockMaterial", scene);
      sharedMaterials.rock.diffuseTexture = rockAtlasTexture;
    }
    if (!sharedMaterials.sand) {
      sharedMaterials.sand = new BABYLON.StandardMaterial("sandMaterial", scene);
      sharedMaterials.sand.diffuseTexture = sandAtlasTexture;
    }
    if (!sharedMaterials.water) {
      sharedMaterials.water = new BABYLON.StandardMaterial("waterMaterial", scene);
      sharedMaterials.water.diffuseTexture = waterAtlasTexture;
    }
    

    // Dynamic mesh and data storage
    const meshes = {};
    const vertexData = {};
    
    // Initialize arrays for each material (but don't create meshes yet)
    Object.keys(materials).forEach(key => {
      vertexData[key] = {
        verts: [], uvs: [], indices: [],
        index: 0
      };
    });
    
    // Pre-calculate material lookup table for faster tile type to material mapping
    const materialLookup = new Array(96); // 0-95 tile types
    for (let i = 0; i < 96; i++) {
      if (i >= 80) {
        materialLookup[i] = 'water';
      } else if (i >= 60) {
        materialLookup[i] = 'sand';
      } else if (i >= 40) {
        materialLookup[i] = 'rock';
      } else if (i >= 20) {
        materialLookup[i] = 'dirt';
      } else {
        materialLookup[i] = 'grass';
      }
    }

    // Generate vertices and UVs for each tile in the chunk
    for (let i = 0; i < chunk.tiles.length; i++) {
      const tile = chunk.tiles[i];
      const localX = i % (chunk.endX - chunk.startX);
      const localZ = Math.floor(i / (chunk.endX - chunk.startX));
      
      // Calculate world positions for this tile
      const x1 = (chunk.startX + localX) * tileSize;
      const x2 = (chunk.startX + localX + 1) * tileSize;
      const z1 = (chunk.startZ + localZ) * tileSize;
      const z2 = (chunk.startZ + localZ + 1) * tileSize;
      
      // Use the pre-calculated atlas coordinates from the Tile object
      const tileRow = tile.atlasRow;
      const tileCol = tile.atlasCol;
      
      // Pre-calculate UV coordinates to avoid repeated calculations
      const u1 = tileCol * 0.25 + 0.01;
      const u2 = (tileCol + 1) * 0.25 - 0.01;
      const v1 = tileRow * 0.25 + 0.01;
      const v2 = (tileRow + 1) * 0.25 - 0.01;
      
      // Determine which material to use based on tile type (using lookup table)
      const materialKey = materialLookup[tile.type];
      
      // Add to the appropriate mesh
      const data = vertexData[materialKey];
      const baseIndex = data.index * 4;
      
      // Get height variation for each corner vertex individually
      let height1 = 0, height2 = 0, height3 = 0, height4 = 0;
      if (chunk.field) {
        const worldX1 = chunk.startX + localX;
        const worldZ1 = chunk.startZ + localZ;
        const worldX2 = chunk.startX + localX + 1;
        const worldZ2 = chunk.startZ + localZ + 1;
        
        // Calculate height for each corner vertex
        height1 = chunk.field.getHeightVariation(worldX1, worldZ1); // bottom-left
        height2 = chunk.field.getHeightVariation(worldX2, worldZ1); // bottom-right  
        height3 = chunk.field.getHeightVariation(worldX2, worldZ2); // top-right
        height4 = chunk.field.getHeightVariation(worldX1, worldZ2); // top-left
      }
      
      // Vertex positions (x, y, z) with individual height variation for each corner
      data.verts.push(x1, height1, z1, x2, height2, z1, x2, height3, z2, x1, height4, z2);
      
      // UV coordinates (u, v) - pre-calculated above
      data.uvs.push(u1, v1, u2, v1, u2, v2, u1, v2);
      
      // Indices for 2 triangles
      data.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
      
      data.index++;
    }

    // Create and apply vertex data to each mesh that has tiles
    Object.keys(vertexData).forEach(key => {
      const data = vertexData[key];
      if (data.verts.length > 0) {
        // Only create mesh when we actually have tiles for this material
        meshes[key] = new BABYLON.Mesh(`${key}Mesh`, scene);
        
        const vertexDataObj = new BABYLON.VertexData();
        vertexDataObj.positions = data.verts;
        vertexDataObj.indices = data.indices;
        vertexDataObj.uvs = data.uvs;
        
        // Apply vertex data first
        vertexDataObj.applyToMesh(meshes[key]);
        
        // Compute normals more efficiently
        const normals = new Array(data.verts.length);
        BABYLON.VertexData.ComputeNormals(data.verts, data.indices, normals);
        meshes[key].setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
        
        // Assign material (pre-created shared materials)
        meshes[key].material = sharedMaterials[key];
      }
    });

    // Create a parent mesh to hold all material meshes
    const terrainMesh = new BABYLON.Mesh("terrainMesh", scene);
    Object.keys(meshes).forEach(key => {
      if (vertexData[key].verts.length > 0) {
        meshes[key].parent = terrainMesh;
      }
    });

    // Debug mesh properties
    const totalTiles = Object.values(vertexData).reduce((sum, data) => sum + data.index, 0);
    
    // Return the mesh immediately - models will be loaded lazily
    return terrainMesh;
  }

  gfx.init = function() {
    gfx.canvas = document.getElementById('canvas');
    gfx.engine = new BABYLON.Engine(gfx.canvas, false, engineOptions, false);
    gfx.scene = new BABYLON.Scene(gfx.engine);
    
    // Load textures now that we have a scene
    grassAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass.png", gfx.scene);
    dirtAtlasTexture = new BABYLON.Texture("assets/textures/atlas-dirt.png", gfx.scene);
    rockAtlasTexture = new BABYLON.Texture("assets/textures/atlas-rock.png", gfx.scene);
    sandAtlasTexture = new BABYLON.Texture("assets/textures/atlas-sand.png", gfx.scene);
    waterAtlasTexture = new BABYLON.Texture("assets/textures/atlas-water.png", gfx.scene);

    gfx.makeScene(gfx.scene);

  
    gfx.scene.whenReadyAsync().then(function() {
      // Add world axis after scene is ready
      if (gfx.showWorldAxes) {
        // gfx.showWorldAxes(1024, gfx.scene, new Vec3(0,0,0));
      }
      
      // Load cursor frog indicator
      BABYLON.SceneLoader.LoadAssetContainerAsync("assets/models/frog.glb", undefined, gfx.scene)
        .then(container => {
          const result = container.instantiateModelsToScene();
          gfx.cursorFrog = result.rootNodes[0];
          gfx.cursorFrog.scaling = new BABYLON.Vector3(.2, .2, .2); // Make it visible
          gfx.cursorFrog.position.y = 1; // Float above ground
          // console.log("Cursor frog loaded");
        })
        .catch(error => {
          // console.warn("Could not load cursor frog:", error);
        });
      
      // Initialize HUD system after scene and camera are ready
      if (window.hud && gfx.camera && gfx.canvas) {
        hud.init(gfx.scene, gfx.camera, gfx.canvas);
        
        // Only initialize 3D HUD if USE_3D_HUD is true
        if (USE_3D_HUD) {
          console.log("🎮 3D HUD initialized - main menu items will be created when first shown");
        }
      }
      
      gfx.engine.runRenderLoop(mainRenderLoop);

      // Initialize lasso selection system
      if (window.lassoSelection && window.lassoSelection.init) {
        window.lassoSelection.init();
        // console.log("🎯 Lasso selection system initialized");
      }

    });
  }

  function mainRenderLoop(){
    // Increment frame counter for LOD system
    window.frameCounter = (window.frameCounter || 0) + 1;
    
    // Guard camera params before rendering to avoid NaNs breaking frustum
    if (gfx.camera) {
      if (!Number.isFinite(gfx.camera.alpha)) gfx.camera.alpha = 0;
      if (!Number.isFinite(gfx.camera.beta)) gfx.camera.beta = 0.9;
      if (!Number.isFinite(gfx.camera.radius)) gfx.camera.radius = 60;
      gfx.camera.beta = Math.max(0.2, Math.min(1.5, gfx.camera.beta));
      if (typeof gfx.camera.lowerRadiusLimit === 'number' && typeof gfx.camera.upperRadiusLimit === 'number') {
        gfx.camera.radius = Math.max(gfx.camera.lowerRadiusLimit, Math.min(gfx.camera.upperRadiusLimit, gfx.camera.radius));
      }
      // Clamp camera position finite as a safety
      if (!Number.isFinite(gfx.camera.position.x)) gfx.camera.position.x = 0;
      if (!Number.isFinite(gfx.camera.position.y)) gfx.camera.position.y = 30;
      if (!Number.isFinite(gfx.camera.position.z)) gfx.camera.position.z = 0;
    }

    gfx.scene.render();

    // Initialize camera limits based on field scale (once liveField is ready)
    if (!window._cameraLimitsSet && window.liveField && gfx.camera) {
      const worldWidth = Math.max(1, window.liveField.width || 256);
      const worldHeight = Math.max(1, window.liveField.height || 256);
      const maxDim = Math.max(worldWidth, worldHeight);
      const minDim = Math.min(worldWidth, worldHeight);

      // Set dynamic zoom limits relative to field size
      gfx.camera.lowerRadiusLimit = Math.max(5, minDim * 0.05);
      gfx.camera.upperRadiusLimit = Math.max(50, maxDim * 2.5);

      // Clamp current radius into new limits
      if (typeof gfx.camera.radius === 'number') {
        gfx.camera.radius = Math.max(gfx.camera.lowerRadiusLimit, Math.min(gfx.camera.upperRadiusLimit, gfx.camera.radius));
      }

      window._cameraLimitsSet = true;
    }
    
    // Player physics and position updates are now handled in the game loop
    // This render loop only handles rendering and chunk management
    
    // Anchor-driven camera: lerp target toward anchor every frame
    if (gfx.cameraTarget) {
      // Initialize anchor if missing
      if (!window.cameraAnchor) {
        window.cameraAnchor = gfx.cameraTarget.position.clone();
      }
      const cameraLerpSpeed = 0.12; // responsive pan toward anchor
      gfx.cameraTarget.position.x = BABYLON.Scalar.Lerp(gfx.cameraTarget.position.x, window.cameraAnchor.x, cameraLerpSpeed);
      gfx.cameraTarget.position.z = BABYLON.Scalar.Lerp(gfx.cameraTarget.position.z, window.cameraAnchor.z, cameraLerpSpeed);
      gfx.cameraTarget.position.y = 9;
      // Safety clamp camera target to field bounds
      const tileSize = (window.TILE_SIZE || 4);
      const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
      const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
      const margin = 2 * tileSize;
      const minX = margin, minZ = margin;
      const maxX = Math.max(minX, w - margin);
      const maxZ = Math.max(minZ, h - margin);
      gfx.cameraTarget.position.x = Math.max(minX, Math.min(maxX, gfx.cameraTarget.position.x));
      gfx.cameraTarget.position.z = Math.max(minZ, Math.min(maxZ, gfx.cameraTarget.position.z));
      if (window.debugPan) {
        try {
          console.log('[TARGET]', {
            anchor: { x: +window.cameraAnchor.x.toFixed(3), z: +window.cameraAnchor.z.toFixed(3) },
            target: { x: +gfx.cameraTarget.position.x.toFixed(3), z: +gfx.cameraTarget.position.z.toFixed(3) }
          });
        } catch (e) {}
      }
    }
    
    // Keep camera target at fixed height
    if (gfx.cameraTarget) {
      gfx.cameraTarget.position.y = 9;
    }

    // Update cursor frog position to show the cursor destination
    if (gfx.cursorFrog && window.cameraTargetDestination) {
      gfx.cursorFrog.position.x = window.cameraTargetDestination.x;
      gfx.cursorFrog.position.z = window.cameraTargetDestination.z;
    }
    
    // Update unit logic and behaviors
    if (window.updateUnits) {
      updateUnits(0.016); // ~60fps deltaTime
    }
    // Update unit mesh positions and rotations
    if (window.updateUnitMeshes) {
      updateUnitMeshes();
    }
    
    // Update building logic (villager spawning, etc.)
    if (window.updateBuildings) {
      updateBuildings(0.016); // ~60fps deltaTime
    }
    
    // Update LOD system based on camera position
    if (gfx.camera) {
      updateLOD(gfx.camera.position);
    }
    
    // Update camera rotation smoothly
    if (window.ui && window.ui.updateCameraRotation) {
      window.ui.updateCameraRotation();
    }
    
    // Update minimap AFTER camera position is finalized
    if (window.hud && window.hud.updateMinimap) {
      window.hud.updateMinimap();
    }
    
    // Update resource display
    if (window.hud && window.hud.updateResourceDisplay) {
      window.hud.updateResourceDisplay();
    }
    
    // Update visible chunks around camera target
    if (liveField && gfx.cameraTarget) {
      const targetPos = gfx.cameraTarget.position || gfx.cameraTarget;
      liveField.updateVisibleChunks(targetPos.x, targetPos.z); // Use field's default radius
      
      // Add chunks that need processing to the queue (don't process them all at once)
      for (const [key, chunk] of liveField.chunks) {
        if (chunk.needsMesh && !chunkQueue.some(item => item.key === key && item.type === 'mesh')) {
          const [chunkX, chunkZ] = key.split(',').map(Number);
          chunkQueue.push({ key, chunk, chunkX, chunkZ, type: 'mesh' });
        }
        
        if (chunk.needsModels && chunk.mesh && !chunkQueue.some(item => item.key === key && item.type === 'models')) {
          chunkQueue.push({ key, chunk, type: 'models' });
        }
      }
      
      // Process only a limited number of chunks per frame
      let processed = 0;
      while (chunkQueue.length > 0 && processed < CHUNKS_PER_FRAME) {
        const item = chunkQueue.shift();
        
        if (item.type === 'mesh') {
          liveField.createChunkMesh(item.chunkX, item.chunkZ, gfx.scene, createTerrainMesh);
        } else if (item.type === 'models') {
          item.chunk.models = placeModelsOnChunk(item.chunk, gfx.scene);
          item.chunk.needsModels = false;
        }
        
        processed++;
      }
    }
    
    // Update FPS if settings menu is visible (minimal impact)
    if (DRAW_FPS && document.getElementById('fps_meter') && document.getElementById('settings_menu').style.display !== 'none') {
        document.getElementById('fps_meter').innerHTML = Math.round(gfx.engine.getFps()) + ' FPS';
    }
  }

  gfx.makeScene = function(scene) {
    // Use forge camera if in forge mode, otherwise use regular camera
    if (window.ENABLE_FORGE) {
      gfx.camera = gfx.makeForgeCamera(scene);
      // console.log('Using forge camera');
    } else {
      gfx.camera = gfx.makeCamera(scene);
      // console.log('Using regular camera');
    }

    // Initialize orbital lighting system (without auto-movement)
    if (window.lighting) {
      lighting.init(scene);
      
      // Set up a nice default lighting position (afternoon)
      lighting.configure({
        autoAdvance: false,  // No automatic movement
        orbitRadius: 200,
        orbitHeight: 100,
        orbitTilt: 0.2
      });
      // Generate random variations for sun and moon within 0.4-0.6 range
      const minTime = 0.4;
      const maxTime = 0.6;
      
      const randomSunTime = minTime + Math.random() * (maxTime - minTime);
      const randomMoonTime = minTime + Math.random() * (maxTime - minTime);
      
      lighting.setBothTimes(randomSunTime, randomMoonTime);
      // console.log('Set lighting - Sun:', randomSunTime.toFixed(2), 'Moon:', randomMoonTime.toFixed(2));
      
      // console.log('Orbital lighting system ready - use lighting.setTimeOfDay(0-1) to adjust');
    }

    // Initialize FX system
    if (window.fx) {
      fx.init(scene);
      fx.setupBarrelLauncher();
      // console.log('FX system ready - press T for explosions!');
    } else {
      // Fallback to basic lighting if lighting.js not loaded
      scene.ambientColor = new ColorHex('#696969');
      let direction = new Vec3(.45, .87, 1).negate();
      let lightDirectional = new BABYLON.DirectionalLight("*DirectionalLight", direction, scene);
      lightDirectional.intensity = .9;
      lightDirectional.specularScale = .2;
      
      let light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);
      light.intensity = .9;
      light.specularScale = .5;
      scene.clearColor = ColorHex("#050731");
    }





    gfx.table = gfx.makeTable(scene);

  };




  
  gfx.makeCamera = function(scene) {
    let radius = 0;
    // Set better default camera angle: alpha=-2.5 (horizontal), beta=0.9 (looking slightly down, not straight down)
    let camera = new BABYLON.ArcRotateCamera("zCamera", -2.5, 0.9, radius, new Vec3(0, 0, 0), scene);
    gfx.cameraTarget = new BABYLON.TransformNode("zCameraFocus");
    gfx.cameraTarget.position.y = 9;
    // Lock camera to target; we will drive the target via an anchor with lerp
    camera.lockedTarget = gfx.cameraTarget;
    // Initialize camera anchor (desired target position)
    window.cameraAnchor = gfx.cameraTarget.position.clone();
    // Attach camera controls but we will disable built-in pointer inputs to avoid conflicts with custom gestures
    camera.attachControl(gfx.canvas, false); // false = don't prevent default events
    
    // Remove built-in pointer input (mouse/touch orbit/pinch) to prevent double transforms with our gesture system
    if (camera.inputs && camera.inputs.attached && camera.inputs.attached.pointers) {
      try { camera.inputs.attached.pointers.detachControl(); } catch (e) {}
    }

    // Disable built-in wheel input since we're handling both rotation and zoom manually
    if (camera.inputs && camera.inputs.attached.mousewheel) {
      camera.inputs.attached.mousewheel.detachControl();
    }

    // Camera setup complete

    camera.upperRadiusLimit = 222;
    camera.lowerRadiusLimit = 1;
    camera.upperBetaLimit = 2.0; // Limit how high you can look (prevent going too high)
    camera.lowerBetaLimit = 0.4; // Limit how low you can look (prevent looking straight down)
    camera.maxZ = 50000; // extend far plane to avoid terrain popping on wide zoom
    camera.minZ = 0.1; // allow closer near plane for low zoom
    camera.fov = .8; // default .8

    // Safety clamps
    const clampCamera = () => {
      if (!camera) return;
      // Ensure finite camera parameters to prevent scene disappearing
      if (!Number.isFinite(camera.alpha)) camera.alpha = 0;
      if (!Number.isFinite(camera.beta)) camera.beta = 0.9;
      if (!Number.isFinite(camera.radius)) camera.radius = 60;
      // Keep beta reasonable
      camera.beta = Math.max(0.2, Math.min(1.5, camera.beta));
      // Keep radius within limits
      if (typeof camera.lowerRadiusLimit === 'number' && typeof camera.upperRadiusLimit === 'number') {
        camera.radius = Math.max(camera.lowerRadiusLimit, Math.min(camera.upperRadiusLimit, camera.radius));
      }
    };
    // Clamp on init
    clampCamera();

    // Prevent browser/touch default gestures on the canvas
    if (gfx.canvas) {
      try { gfx.canvas.style.touchAction = 'none'; } catch (e) {}
    }
 

    camera.wheelPrecision = 1.15;
    camera.wheelDeltaPercentage = .02;
    // camera.pinchDeltaPercentage = .02;
    camera.inertia = .6;
    camera.angularSensibilityX *= .5;
    camera.angularSensibilityY *= .5;

    // Sync camera rotation targets for smooth wheel control
    if (window.ui && window.ui.syncCameraRotationTargets) {
      window.ui.syncCameraRotationTargets();
    }

    return camera;
  };
  
  // Create a forge-specific universal camera for map editing
  gfx.makeForgeCamera = function(scene) {
    // Create a universal camera for forge editing - start high above for top-down view
    let camera = new BABYLON.UniversalCamera("forgeCamera", new Vec3(0, 200, 0), scene);
    
    // // Set up camera properties for forge editing
    // camera.fov = 0.8;
    // camera.minZ = 1;
    // camera.maxZ = 2001;
    
    // // Camera controls
    // camera.keysUp.push(87);    // W key
    // camera.keysDown.push(83);  // S key
    // camera.keysLeft.push(65);  // A key
    // camera.keysRight.push(68); // D key
    // camera.keysUpward.push(81);   // Q key (rotate up)
    // camera.keysDownward.push(69); // E key (rotate down)
    
    // // Make keyboard movement MUCH faster
    // camera.speed = 2.0;        // Base movement speed
    // camera.angularSpeed = 0.5; // Rotation speed
    
    // // Mouse controls
    // camera.attachControl(gfx.canvas, true);
    
    // // Adjust sensitivity for precise editing - MUCH faster now!
    // camera.angularSensibilityX = 5; // 10x faster mouse look
    // camera.angularSensibilityY = 5; // 10x faster mouse look
    
    // // Pan and zoom settings - MUCH faster now!
    // camera.panningSensibility = 5; // 10x faster panning
    // camera.wheelPrecision = 0.1; // 5x faster zoom (lower = faster)
    
    // // Disable inertia for precise control
    // camera.inertia = 0;
    
    // // Enable right-click panning
    // camera.panningInertia = 0;
    
    // // Set up camera constraints for forge editing
    // camera.lowerRadiusLimit = 2;   // Minimum zoom distance
    // camera.upperRadiusLimit = 200; // Maximum zoom distance for larger field
    // camera.upperBetaLimit = 1.29;
    // camera.beta = 1;
    // // Set initial position and target
    // camera.setTarget(new Vec3(0, 0, 0));
    
    return camera;
  };

  // Expose getModel function publicly
  gfx.getModel = getModel;
  
  // Expose model cleanup function for chunk management
  gfx.cleanupChunkModels = cleanupChunkModels;
  
  // Add showWorldAxis function
  gfx.showWorldAxes = function(size, scene, pos) {
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

}(window.gfx = window.gfx || {}));


