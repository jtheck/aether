





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
    
    // Billboards don't cast shadows - they're just 2D sprites
    
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
      
      // Set up shadows for the model
      if (window.gfx && window.gfx.setupMeshShadows) {
        window.gfx.setupMeshShadows(model.root);
      }
      
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
        
        // Set up shadows for the model
        if (window.gfx && window.gfx.setupMeshShadows) {
          window.gfx.setupMeshShadows(model.root);
        }
        
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
      cullDistance: modelRule.cullDistance || customLodDistance * 2,
      // Store original values for LOD scaling
      originalLodDistance: customLodDistance,
      originalCullDistance: modelRule.cullDistance || customLodDistance * 2
    });
    
    // Apply current LOD multiplier to new model if LOD system is active
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      let currentMultiplier;
      
      // During loading, use minimum LOD (0.3x multiplier)
      if (loadingLODActive && !loadingComplete) {
        currentMultiplier = 0.3; // Minimum LOD during loading
      } else {
        currentMultiplier = window.hud.getCurrentLODMultiplier();
      }
      
      if (currentMultiplier !== 1.0) {
        const lastLod = lodModels[lodModels.length - 1];
        lastLod.lodDistance = lastLod.originalLodDistance * currentMultiplier;
        lastLod.cullDistance = lastLod.originalCullDistance * currentMultiplier;
      }
    }
    
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

  // Update LOD distances for graphics system
  gfx.updateLODDistances = function(multiplier) {
    // Update model LOD distances
    if (lodModels) {
      lodModels.forEach(lod => {
        // Scale LOD distances based on multiplier
        lod.lodDistance = (lod.originalLodDistance || lod.lodDistance) * multiplier;
        lod.cullDistance = (lod.originalCullDistance || lod.cullDistance || lod.lodDistance * 2) * multiplier;
      });
      
      // console.log(`🎚️ Updated LOD distances for ${lodModels.length} models with multiplier ${multiplier.toFixed(2)}`);
    }
    
    // Update terrain chunk loading distance
    if (window.liveField && window.liveField.updateVisibleChunks) {
      // Store the original load distance if not already stored
      if (!window.liveField.originalLoadDistance) {
        window.liveField.originalLoadDistance = 4; // Default load distance
      }
      
      // Update load distance based on LOD level
      const newLoadDistance = Math.round(window.liveField.originalLoadDistance * multiplier);
      window.liveField.currentLoadDistance = Math.max(2, Math.min(8, newLoadDistance)); // Clamp between 2-8
    }
    
    // Update shadow quality based on LOD level
    if (gfx.shadowGenerator) {
      // Store original shadow map size if not already stored
      if (!gfx.originalShadowMapSize) {
        gfx.originalShadowMapSize = 1024; // Default shadow map size
      }
      
      // Calculate new shadow map size based on LOD level
      let newShadowMapSize;
      if (multiplier < 0.5) {
        newShadowMapSize = 512; // Low LOD = lower quality shadows
      } else if (multiplier < 0.8) {
        newShadowMapSize = 1024; // Medium LOD = medium quality shadows
      } else {
        newShadowMapSize = 2048; // High LOD = high quality shadows
      }
      
      // Only update if shadow map size changed
      if (gfx.shadowGenerator.getShadowMap().getSize().width !== newShadowMapSize) {
        gfx.shadowGenerator.dispose();
        if (window.lighting && window.lighting.lights && window.lighting.lights.sun) {
          gfx.shadowGenerator = new BABYLON.ShadowGenerator(newShadowMapSize, window.lighting.lights.sun);
          gfx.shadowGenerator.useBlurExponentialShadowMap = false;
          gfx.shadowGenerator.darkness = 0.8;
          gfx.shadowGenerator.setTransparencyShadow(false);
          gfx.shadowGenerator.bias = 0.00001;
          gfx.shadowGenerator.normalBias = 0.02;
          gfx.shadowGenerator.depthScale = 50;
          gfx.shadowGenerator.minDistance = 0.1;
          gfx.shadowGenerator.maxDistance = 1500 * multiplier; // Scale shadow distance (increased by 50%)
          
          // Re-add all meshes to shadow generator
          if (gfx.updateAllMeshShadows) {
            gfx.updateAllMeshShadows();
          }
          
          // console.log(`🎚️ Shadow quality updated: ${newShadowMapSize}x${newShadowMapSize} map, max distance: ${1000 * multiplier}`);
        }
      }
    }
    
    // Update terrain detail level
    if (window.liveField) {
      // Store original height variation if not already stored
      if (!window.liveField.originalHeightVariation) {
        window.liveField.originalHeightVariation = 0.11; // Default height variation
      }
      
      // Scale height variation based on LOD level
      window.liveField.currentHeightVariation = window.liveField.originalHeightVariation * multiplier;
    }
    
    // console.log(`🎚️ Graphics LOD updated: multiplier=${multiplier.toFixed(2)}, terrain chunks=${window.liveField?.currentLoadDistance || 4}, shadow map=${gfx.shadowGenerator?.getShadowMap()?.getSize()?.width || 'N/A'}`);
  };

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
  
  // Loading LOD system - start at minimum, ramp up to user setting
  let loadingLODActive = true;
  let loadingLODTarget = 50; // Default LOD level to ramp up to
  let loadingLODCurrent = 0; // Start at minimum LOD
  let loadingLODRampSpeed = 2; // LOD levels per second
  let loadingComplete = false;
  
  // Function to start LOD ramp-up after loading is complete
  function startLODRampUp() {
    if (loadingComplete) return; // Already started
    
    loadingComplete = true;
    loadingLODActive = true;
    
    // Get user's saved LOD setting
    const savedLOD = localStorage.getItem('lodLevel');
    loadingLODTarget = savedLOD ? parseInt(savedLOD) : 50;
    
    console.log(`🚀 Loading complete! Starting LOD ramp-up from ${loadingLODCurrent} to ${loadingLODTarget}`);
  }
  
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
          // Set up shadows for the model
          if (window.gfx && window.gfx.setupMeshShadows) {
            window.gfx.setupMeshShadows(model.root);
          }
          
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
      
      // Check if loading is complete (no more models in queue)
      if (!loadingComplete) {
        // Small delay to ensure all models are processed
        setTimeout(() => {
          if (modelLoadQueue.length === 0) {
            startLODRampUp();
          }
        }, 1000);
      }
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
      sharedMaterials.grass.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Reduce reflectivity
      sharedMaterials.grass.specularPower = 32; // Reduce specular power
    }
    if (!sharedMaterials.dirt) {
      sharedMaterials.dirt = new BABYLON.StandardMaterial("dirtMaterial", scene);
      sharedMaterials.dirt.diffuseTexture = dirtAtlasTexture;
      sharedMaterials.dirt.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Reduce reflectivity
      sharedMaterials.dirt.specularPower = 32; // Reduce specular power
    }
    if (!sharedMaterials.rock) {
      sharedMaterials.rock = new BABYLON.StandardMaterial("rockMaterial", scene);
      sharedMaterials.rock.diffuseTexture = rockAtlasTexture;
      sharedMaterials.rock.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2); // Slightly more reflective for rocks
      sharedMaterials.rock.specularPower = 64; // Higher specular power for rocks
    }
    if (!sharedMaterials.sand) {
      sharedMaterials.sand = new BABYLON.StandardMaterial("sandMaterial", scene);
      sharedMaterials.sand.diffuseTexture = sandAtlasTexture;
      sharedMaterials.sand.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Reduce reflectivity
      sharedMaterials.sand.specularPower = 32; // Reduce specular power
    }
    if (!sharedMaterials.water) {
      sharedMaterials.water = new BABYLON.StandardMaterial("waterMaterial", scene);
      sharedMaterials.water.diffuseTexture = waterAtlasTexture;
      sharedMaterials.water.specularColor = new BABYLON.Color3(0.8, 0.8, 0.9); // Water can be more reflective
      sharedMaterials.water.specularPower = 128; // Higher specular power for water
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
        
        // Set up shadows for this mesh (terrain receives shadows but doesn't cast them)
        gfx.setupMeshShadows(meshes[key], false);
      }
    });

    // Create a parent mesh to hold all material meshes
    const terrainMesh = new BABYLON.Mesh("terrainMesh", scene);
    Object.keys(meshes).forEach(key => {
      if (vertexData[key].verts.length > 0) {
        meshes[key].parent = terrainMesh;
      }
    });
    
    // Set up shadows for the parent terrain mesh (terrain receives shadows but doesn't cast them)
    gfx.setupMeshShadows(terrainMesh, false);

    // Debug mesh properties
    const totalTiles = Object.values(vertexData).reduce((sum, data) => sum + data.index, 0);
    
    // Return the mesh immediately - models will be loaded lazily
    return terrainMesh;
  }

  gfx.init = function() {
    gfx.canvas = document.getElementById('canvas');
    gfx.engine = new BABYLON.Engine(gfx.canvas, false, engineOptions, false);
    gfx.scene = new BABYLON.Scene(gfx.engine);
    
    // Initialize loading LOD system - start at minimum LOD
    loadingLODActive = true;
    loadingLODCurrent = 0;
    loadingComplete = false;
    
    // Set initial LOD to minimum during loading
    if (window.hud && window.hud.updateLODDistances) {
      window.hud.updateLODDistances(0); // Start at minimum LOD
    }
    
    // Load textures now that we have a scene
    grassAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass.png", gfx.scene);
    dirtAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass.png", gfx.scene); // Using grass as fallback
    rockAtlasTexture = new BABYLON.Texture("assets/textures/atlas-hd.png", gfx.scene); // Using hd as fallback
    sandAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass.png", gfx.scene); // Using grass as fallback
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
        
        // Initialize LOD slider
        if (hud.initLODSlider) {
          hud.initLODSlider();
        }
        
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
    
    // Cache current time for performance (used by units, etc.)
    window.cachedTime = Date.now();
    
    // Guard camera params before rendering to avoid NaNs breaking frustum
    if (gfx.camera) {
      if (!Number.isFinite(gfx.camera.alpha)) gfx.camera.alpha = 0;
      if (!Number.isFinite(gfx.camera.beta)) gfx.camera.beta = 0.9;
      if (!Number.isFinite(gfx.camera.radius)) gfx.camera.radius = 80;
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
      gfx.camera.lowerRadiusLimit = Math.max(35, minDim * 0.25);  // Increased minimum to keep camera further from ground
      gfx.camera.upperRadiusLimit = Math.max(300, maxDim * 3.0); // Increased maximum for better horizon view

      // Clamp current radius into new limits
      if (typeof gfx.camera.radius === 'number') {
        gfx.camera.radius = Math.max(gfx.camera.lowerRadiusLimit, Math.min(gfx.camera.upperRadiusLimit, gfx.camera.radius));
      }

      window._cameraLimitsSet = true;
    }
    
    // Player physics and position updates are now handled in the game loop
    // This render loop only handles rendering and chunk management
    
    // Keep camera target at fixed height (panning now handled by velocity system)
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
    
    // Handle loading LOD ramp-up
    if (loadingLODActive && loadingComplete) {
      const deltaTime = 0.016; // ~60fps
      const rampAmount = loadingLODRampSpeed * deltaTime;
      
      if (loadingLODCurrent < loadingLODTarget) {
        loadingLODCurrent = Math.min(loadingLODTarget, loadingLODCurrent + rampAmount);
        
        // Update LOD distances with current loading level
        if (window.hud && window.hud.updateLODDistances) {
          window.hud.updateLODDistances(Math.round(loadingLODCurrent));
        }
        
        // Check if ramp-up is complete
        if (loadingLODCurrent >= loadingLODTarget) {
          loadingLODActive = false;
          console.log(`✅ LOD ramp-up complete! Reached target level ${loadingLODTarget}`);
        }
      }
    }
    
    // Update shadow LoD system for performance optimization
    if (gfx.updateShadowLOD) {
      gfx.updateShadowLOD();
    }
    
    // Update shadow performance monitoring
    if (gfx.shadowPerformanceMonitor) {
      gfx.shadowPerformanceMonitor.update();
    }
    
    // Update lighting system (only when autoAdvance is enabled)
    if (window.lighting && window.lighting.update) {
      window.lighting.update(0.016); // ~60fps deltaTime
    } else {
      // Debug: check if lighting system is available
      if (!window.lighting) {
        console.log('⚠️ Lighting system not available');
      } else if (!window.lighting.update) {
        console.log('⚠️ Lighting update function not available');
      }
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
      
      // Set up daytime lighting (good shadows but always bright)
      lighting.configure({
        autoAdvance: false,  // No automatic movement
        orbitRadius: 200,
        orbitHeight: 100,
        orbitTilt: 0.25  // Lower tilt to keep sun higher in sky
      });
      // Generate random sun position in solid daytime range
      const minTime = 0.4;   // Mid-morning
      const maxTime = 0.6;   // Mid-afternoon
      
      // Use dramatic sun angle for better shadows
      lighting.setDramaticSunAngle();
      
      // console.log('Orbital lighting system ready - use lighting.setTimeOfDay(0-1) to adjust');
      
      // Auto-initialize shadows when scene is stable (no fixed delay)
      // console.log('🎭 Starting shadow initialization with stability checks...');
      setTimeout(() => {
        if (gfx.autoInitializeShadows) {
          gfx.autoInitializeShadows();
        }
      }, 1000);
      
      // Additional fallback - initialize shadows when scene is fully loaded
      if (gfx.scene.onReadyObservable) {
        gfx.scene.onReadyObservable.addOnce(() => {
          // console.log('🎭 Scene fully loaded, checking stability for shadows...');
          setTimeout(() => {
            if (gfx.autoInitializeShadows) {
              gfx.autoInitializeShadows();
            }
          }, 1000);
        });
      }
    }

    // Create table first
    gfx.table = gfx.makeTable(scene);
    
  // Store shadow state globally
  window.SHADOWS_ENABLED = false;
  
  // Scene stability tracking
  gfx.sceneStability = {
    isStable: false,
    stabilityCheckInterval: 1000, // Check every 1 second
    lastStabilityCheck: 0,
    consecutiveStableFrames: 0,
    requiredStableFrames: 10, // Need 10 consecutive stable frames
    lastMeshCount: 0,
    lastFrameTime: 0,
    stabilityThreshold: 16.67 // 60fps = 16.67ms per frame
  };
  
  // Shadow LoD configuration - increased by 50% for better visibility
  gfx.shadowLODConfig = {
    enabled: true,
    maxShadowDistance: 123.75, // Maximum distance for shadow casting (82.5 * 1.5)
    nearShadowDistance: 49.5, // Distance for high quality shadows (33 * 1.5)
    farShadowDistance: 99, // Distance for low quality shadows (66 * 1.5)
    cullingDistance: 148.5, // Distance beyond which no shadows are cast (99 * 1.5)
    updateInterval: 100 // Update shadow casters every 100ms
  };
  
  // Shadow LoD tracking
  gfx.lastShadowUpdate = 0;
    
    // Initialize shadow generator after lighting system is ready
    gfx.initializeShadowGenerator = function() {
      if (window.lighting && window.lighting.lights && window.lighting.lights.sun) {
        const sunLight = window.lighting.lights.sun;
        // console.log('Initializing shadow generator with sun light:', sunLight.name);
        
        try {
          gfx.shadowGenerator = new BABYLON.ShadowGenerator(1024, sunLight);
          gfx.shadowGenerator.useBlurExponentialShadowMap = false; // Disable blur for sharper shadows
          gfx.shadowGenerator.darkness = 0.8; // Make shadows darker and more visible
          gfx.shadowGenerator.setTransparencyShadow(false); // Disable transparency for better performance
          gfx.shadowGenerator.bias = 0.00001; // Reduce shadow acne
          gfx.shadowGenerator.normalBias = 0.02; // Reduce shadow acne
          gfx.shadowGenerator.depthScale = 50; // Better depth scaling
          
          // Set near and far planes for shadow rendering
          gfx.shadowGenerator.minDistance = 0.1;
          gfx.shadowGenerator.maxDistance = 1500; // Increased by 50% for better visibility
          
          // Set up automatic shadow updates for new meshes
          gfx.scene.onNewMeshAddedObservable.add(gfx.autoUpdateShadows);
          
          // console.log('Shadow generator initialized successfully');
          return true;
        } catch (error) {
          console.warn('Failed to initialize shadow generator:', error);
          gfx.shadowGenerator = null;
          return false;
        }
      } else {
        // console.log('No sun light available - shadow generator not created');
        gfx.shadowGenerator = null;
        return false;
      }
    };

    // Check if scene is stable for shadow initialization
    gfx.checkSceneStability = function() {
      const currentTime = Date.now();
      const currentFrameTime = currentTime - gfx.sceneStability.lastFrameTime;
      gfx.sceneStability.lastFrameTime = currentTime;
      
      // Check if enough time has passed since last check
      if (currentTime - gfx.sceneStability.lastStabilityCheck < gfx.sceneStability.stabilityCheckInterval) {
        return gfx.sceneStability.isStable;
      }
      
      gfx.sceneStability.lastStabilityCheck = currentTime;
      
      // Check if scene exists and has meshes
      if (!gfx.scene || gfx.scene.meshes.length === 0) {
        gfx.sceneStability.consecutiveStableFrames = 0;
        return false;
      }
      
      // Check if scene is still loading
      if (gfx.scene.isLoading) {
        gfx.sceneStability.consecutiveStableFrames = 0;
        return false;
      }
      
      // Check if mesh count is stable (not growing rapidly)
      const currentMeshCount = gfx.scene.meshes.length;
      const meshCountChanged = currentMeshCount !== gfx.sceneStability.lastMeshCount;
      gfx.sceneStability.lastMeshCount = currentMeshCount;
      
      // Check if frame rate is stable (not dropping below threshold)
      const frameRateStable = currentFrameTime <= gfx.sceneStability.stabilityThreshold;
      
      // Check if lighting system is ready
      const lightingReady = window.lighting && window.lighting.lights && window.lighting.lights.sun;
      
      if (meshCountChanged || !frameRateStable || !lightingReady) {
        gfx.sceneStability.consecutiveStableFrames = 0;
        return false;
      }
      
      // Increment stable frames
      gfx.sceneStability.consecutiveStableFrames++;
      
      // Check if we've reached the required stable frames
      if (gfx.sceneStability.consecutiveStableFrames >= gfx.sceneStability.requiredStableFrames) {
        gfx.sceneStability.isStable = true;
        console.log('✅ Scene is stable! Ready for shadow initialization.');
        return true;
      }
      
      return false;
    };

    // Auto-initialize shadows with stability checks
    gfx.autoInitializeShadows = function() {
      // Check if shadows are enabled
      if (!window.SHADOWS_ENABLED) {
        return;
      }

      // Check if shadow generator already exists
      if (gfx.shadowGenerator) {
        return;
      }

      // Check if scene is stable
      if (!gfx.checkSceneStability()) {
        console.log('⏳ Scene not stable yet, retrying shadow init in 1 second...');
        setTimeout(() => gfx.autoInitializeShadows(), 1000);
        return;
      }

      // Try to initialize shadows
      console.log('🎭 Scene is stable! Initializing shadows (scene has', gfx.scene.meshes.length, 'meshes)...');
      const success = gfx.initializeShadowGenerator();
      
      if (success) {
        // Update all existing meshes to receive shadows
        if (gfx.updateAllMeshShadows) {
          gfx.updateAllMeshShadows();
        }
        console.log('✅ Shadows initialized and applied to', gfx.scene.meshes.length, 'meshes');
      } else {
        // Retry after a longer delay
        console.log('⏳ Shadow initialization failed, retrying in 2 seconds...');
        setTimeout(() => gfx.autoInitializeShadows(), 2000);
      }
    };

    // Force shadow initialization (bypass stability checks)
    gfx.forceInitializeShadows = function() {
      console.log('🎭 Force initializing shadows...');
      gfx.sceneStability.isStable = true; // Mark as stable
      gfx.autoInitializeShadows();
    };

    // Reset stability tracking (useful for debugging)
    gfx.resetStabilityTracking = function() {
      gfx.sceneStability.isStable = false;
      gfx.sceneStability.consecutiveStableFrames = 0;
      gfx.sceneStability.lastMeshCount = 0;
      gfx.sceneStability.lastFrameTime = 0;
      console.log('🔄 Stability tracking reset');
    };
    
    // console.log('Shadow generator initialized (disabled by default)');

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





  };
  
  // Helper function to set up shadows for a mesh with LoD support
  gfx.setupMeshShadows = function(mesh, shouldCastShadows = true) {
    if (!mesh || !gfx.shadowGenerator) return;
    
    // Skip UI elements and indicators
      const isUIMesh = mesh.name.includes('table') || 
                      mesh.name.includes('UI') || 
                      mesh.name.includes('menu') ||
                      mesh.name.includes('Indicator') ||
                      mesh.name.includes('indicator') ||
                      mesh.name.includes('HUD') ||
                      mesh.name.includes('hud') ||
                      mesh.name.includes('minimap') ||
                      mesh.name.includes('Minimap') ||
                      mesh.name.includes('radial') ||
                      mesh.name.includes('Radial') ||
                      mesh.name.includes('selectionRing') ||
                      mesh.name.includes('SelectionRing') ||
                      mesh.name.includes('billboard') ||
                      mesh.name.includes('Billboard') ||
                      mesh.name.includes('center') ||
                      mesh.name.includes('Center') ||
                      mesh.name.includes('anchor') ||
                      mesh.name.includes('Anchor') ||
                      (mesh.name.length === 1 && ['N', 'E', 'S', 'W'].includes(mesh.name)) ||
                      (mesh.name.length === 2 && ['SW', 'SE', 'NE', 'NW', 'NT', 'ET', 'ST', 'WT'].includes(mesh.name)) ||
                      (mesh.parent && mesh.parent.name && (
                        mesh.parent.name.includes('table') ||
                        mesh.parent.name.includes('radial') ||
                        mesh.parent.name.includes('Radial') ||
                        mesh.parent.name.includes('HUD') ||
                        mesh.parent.name.includes('hud') ||
                        mesh.parent.name.includes('minimap') ||
                        mesh.parent.name.includes('Minimap')
                      ));
    if (isUIMesh) return;
    
    // Always set receiveShadows based on current state
    mesh.receiveShadows = window.SHADOWS_ENABLED;
    
    // Mesh will be tracked by the existing LOD system
    
    // Only add to shadow generator if shadows are enabled and it should cast shadows
    if (window.SHADOWS_ENABLED && shouldCastShadows) {
      gfx.shadowGenerator.addShadowCaster(mesh);
    }
    
    // Handle child meshes recursively
    if (mesh.getChildMeshes) {
      mesh.getChildMeshes().forEach(childMesh => {
        // Skip UI child meshes too
        const isUIChild = childMesh.name.includes('selectionRing') ||
                         childMesh.name.includes('SelectionRing') ||
                         childMesh.name.includes('Indicator') ||
                         childMesh.name.includes('indicator') ||
                         childMesh.name.includes('HUD') ||
                         childMesh.name.includes('hud') ||
                         childMesh.name.includes('minimap') ||
                         childMesh.name.includes('Minimap') ||
                         childMesh.name.includes('radial') ||
                         childMesh.name.includes('Radial') ||
                         childMesh.name.includes('center') ||
                         childMesh.name.includes('Center') ||
                         childMesh.name.includes('anchor') ||
                         childMesh.name.includes('Anchor');
        if (isUIChild) return;
        
        childMesh.receiveShadows = window.SHADOWS_ENABLED;
        if (window.SHADOWS_ENABLED && shouldCastShadows) {
          gfx.shadowGenerator.addShadowCaster(childMesh);
        }
      });
    }
  };
  
  // Auto-update shadows when new meshes are added (called from scene.onNewMeshAddedObservable)
  gfx.autoUpdateShadows = function(mesh) {
    if (!mesh || !gfx.shadowGenerator || !window.SHADOWS_ENABLED) return;
    
    // Small delay to ensure mesh is fully initialized
    setTimeout(() => {
      gfx.setupMeshShadows(mesh);
    }, 10);
  };
  
  // Force refresh all shadows (useful for debugging or after major scene changes)
  gfx.refreshAllShadows = function() {
    if (!gfx.scene || !gfx.shadowGenerator) return;
    
    console.log('Refreshing all shadows...');
    gfx.updateAllMeshShadows();
  };
  
  // Helper function to update all meshes when shadow state changes
  gfx.updateAllMeshShadows = function() {
    if (!gfx.scene || !gfx.shadowGenerator) {
      console.log('Shadow generator not available - shadows disabled');
      return;
    }
    
    // Shadow caster tracking is now handled by the existing LOD system
    
    let shadowCasterCount = 0;
    
    gfx.scene.meshes.forEach(mesh => {
      // Skip UI elements - check if mesh is part of UI system
      const isUIMesh = mesh.name.includes('table') || 
                      mesh.name.includes('UI') || 
                      mesh.name.includes('menu') ||
                      mesh.name.includes('Indicator') ||
                      mesh.name.includes('indicator') ||
                      mesh.name.includes('HUD') ||
                      mesh.name.includes('hud') ||
                      mesh.name.includes('minimap') ||
                      mesh.name.includes('Minimap') ||
                      mesh.name.includes('radial') ||
                      mesh.name.includes('Radial') ||
                      mesh.name.includes('selectionRing') ||
                      mesh.name.includes('SelectionRing') ||
                      mesh.name.includes('billboard') ||
                      mesh.name.includes('Billboard') ||
                      mesh.name.includes('center') ||
                      mesh.name.includes('Center') ||
                      mesh.name.includes('anchor') ||
                      mesh.name.includes('Anchor') ||
                      // Single letter directional indicators (N, E, S, W)
                      (mesh.name.length === 1 && ['N', 'E', 'S', 'W'].includes(mesh.name)) ||
                      // Two letter directional indicators (SW, SE, NE, NW, etc.)
                      (mesh.name.length === 2 && ['SW', 'SE', 'NE', 'NW', 'NT', 'ET', 'ST', 'WT'].includes(mesh.name)) ||
                      // Check if mesh is a child of a UI parent
                      (mesh.parent && mesh.parent.name && (
                        mesh.parent.name.includes('table') ||
                        mesh.parent.name.includes('radial') ||
                        mesh.parent.name.includes('Radial') ||
                        mesh.parent.name.includes('HUD') ||
                        mesh.parent.name.includes('hud') ||
                        mesh.parent.name.includes('minimap') ||
                        mesh.parent.name.includes('Minimap')
                      ));
      if (isUIMesh) return;
      
      // All game meshes can receive shadows
      mesh.receiveShadows = window.SHADOWS_ENABLED;
      
      // Only non-terrain meshes should cast shadows
      const isTerrainMesh = mesh.name.includes('terrainMesh') || mesh.name.includes('Mesh');
      
      if (window.SHADOWS_ENABLED && !isTerrainMesh) {
        // Add to shadow generator immediately
        gfx.shadowGenerator.addShadowCaster(mesh);
        shadowCasterCount++;
      } else {
        gfx.shadowGenerator.removeShadowCaster(mesh);
      }
      
      // Handle child meshes
      if (mesh.getChildMeshes) {
        mesh.getChildMeshes().forEach(childMesh => {
          // Skip UI child meshes
            const isUIChild = childMesh.name.includes('selectionRing') ||
                             childMesh.name.includes('SelectionRing') ||
                             childMesh.name.includes('Indicator') ||
                             childMesh.name.includes('indicator') ||
                             childMesh.name.includes('HUD') ||
                             childMesh.name.includes('hud') ||
                             childMesh.name.includes('minimap') ||
                             childMesh.name.includes('Minimap') ||
                             childMesh.name.includes('radial') ||
                             childMesh.name.includes('Radial') ||
                             childMesh.name.includes('center') ||
                             childMesh.name.includes('Center') ||
                             childMesh.name.includes('anchor') ||
                             childMesh.name.includes('Anchor');
          if (isUIChild) return;
          
          childMesh.receiveShadows = window.SHADOWS_ENABLED;
          if (window.SHADOWS_ENABLED && !isTerrainMesh) {
            gfx.shadowGenerator.addShadowCaster(childMesh);
            shadowCasterCount++;
          } else {
            gfx.shadowGenerator.removeShadowCaster(childMesh);
          }
        });
      }
    });
    
    // console.log('Shadows', window.SHADOWS_ENABLED ? 'enabled' : 'disabled', '- Shadow casters:', shadowCasterCount);
  };
  
  // LoD-based shadow caster management - integrated with existing LOD system
  gfx.updateShadowLOD = function() {
    if (!gfx.shadowGenerator || !window.SHADOWS_ENABLED || !gfx.shadowLODConfig.enabled) return;
    
    const currentTime = Date.now();
    if (currentTime - gfx.lastShadowUpdate < gfx.shadowLODConfig.updateInterval) return;
    
    gfx.lastShadowUpdate = currentTime;
    
    // Use the same camera position as the existing LOD system
    const camera = gfx.camera;
    if (!camera) return;
    
    const cameraPos = camera.position;
    let activeShadowCasters = 0;
    let culledShadowCasters = 0;
    
    // Use the existing lodModels array for shadow LoD
    lodModels.forEach(lod => {
      if (!lod.model || !lod.model.position) return;
      
      // Calculate full 3D distance (same as existing LOD system)
      const distance = BABYLON.Vector3.Distance(cameraPos, lod.model.position);
      
      // Check if mesh is currently a shadow caster
      const isCurrentlyCasting = gfx.shadowGenerator.getShadowMap().renderList.includes(lod.model);
      
      if (distance <= gfx.shadowLODConfig.maxShadowDistance) {
        // Should cast shadows
        if (!isCurrentlyCasting) {
          gfx.shadowGenerator.addShadowCaster(lod.model);
          activeShadowCasters++;
        }
      } else {
        // Too far, remove from shadow casters
        if (isCurrentlyCasting) {
          gfx.shadowGenerator.removeShadowCaster(lod.model);
          culledShadowCasters++;
        }
      }
    });
    
    // // Debug info (only log when there are changes)
    // if (culledShadowCasters > 0) {
    //   console.log(`Shadow LoD: Culled ${culledShadowCasters} distant shadow casters, ${activeShadowCasters} active`);
    // }
  };
  
  // Configure shadow LoD settings
  gfx.configureShadowLOD = function(config) {
    Object.assign(gfx.shadowLODConfig, config);
    console.log('Shadow LoD configured:', gfx.shadowLODConfig);
  };
  
  // Get current shadow LoD statistics
  gfx.getShadowLODStats = function() {
    const activeCasters = gfx.shadowGenerator ? gfx.shadowGenerator.getShadowMap().renderList.length : 0;
    const totalCasters = lodModels.length;
    const fieldSize = window.liveField ? Math.max(window.liveField.width, window.liveField.height) : 0;
    
    return {
      activeShadowCasters: activeCasters,
      totalShadowCasters: totalCasters,
      culledShadowCasters: totalCasters - activeCasters,
      fieldSize: fieldSize,
      lodEnabled: gfx.shadowLODConfig.enabled,
      config: gfx.shadowLODConfig
    };
  };
  
  // Performance monitoring for shadow system
  gfx.shadowPerformanceMonitor = {
    frameCount: 0,
    lastFPS: 0,
    shadowUpdateCount: 0,
    lastUpdateTime: 0,
    
    update: function() {
      this.frameCount++;
      this.shadowUpdateCount++;
      
      // Calculate FPS every 60 frames
      if (this.frameCount % 60 === 0) {
        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastUpdateTime;
        this.lastFPS = 60000 / deltaTime; // 60 frames / time in ms * 1000
        this.lastUpdateTime = currentTime;
        
        // Log performance info if FPS is low
        if (this.lastFPS < 30) {
          const stats = gfx.getShadowLODStats();
          // console.log(`⚠️ Low FPS: ${this.lastFPS.toFixed(1)} - Shadow casters: ${stats.activeShadowCasters}/${stats.totalShadowCasters} (${stats.culledShadowCasters} culled)`);
        }
      }
    },
    
    getStats: function() {
      const stats = gfx.getShadowLODStats();
      return {
        fps: this.lastFPS,
        activeShadowCasters: stats.activeShadowCasters,
        totalShadowCasters: stats.totalShadowCasters,
        culledShadowCasters: stats.culledShadowCasters,
        shadowUpdateCount: this.shadowUpdateCount
      };
    }
  };




  
  gfx.makeCamera = function(scene) {
    let radius = 80; // Start at a good middle distance within the zoom range
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

    camera.upperRadiusLimit = 300; // Increased for better horizon view
    camera.lowerRadiusLimit = 35;  // Increased minimum to keep camera further from ground
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
      if (!Number.isFinite(camera.radius)) camera.radius = 80;
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

  // Expose LOD ramp-up function
  gfx.startLODRampUp = startLODRampUp;

}(window.gfx = window.gfx || {}));


