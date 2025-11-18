// Fix the IIFE structure - ensure the file starts with:
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
  const CHUNKS_PER_FRAME = 20; // Process 20 chunks per frame for much faster loading

  // Load textures at the top so they're available everywhere
  let grassAtlasTexture, dirtAtlasTexture, rockAtlasTexture, sandAtlasTexture, waterAtlasTexture;
  let grassWaterAtlasTexture, grassDirtAtlasTexture, dirtWaterAtlasTexture; // Terrain transition atlases
  
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
            
            // CRITICAL: Disable the model immediately to prevent flash before LOD kicks in
            result.rootNodes.forEach(n => n.setEnabled(false));

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
  
  // Expose lodModels for debugging (keep reference, don't reassign)
  Object.defineProperty(gfx, 'lodModels', {
    get: function() { return lodModels; }
  });
  
  // Model instance pools for reuse
  const modelPools = new Map(); // path -> array of available instances
  const activeModels = new Map(); // chunkKey -> array of model instances in use
  
  // Function to clean up models when chunk unloads
  function cleanupChunkModels(chunkKey) {
    const models = activeModels.get(chunkKey);
    if (models) {
      // OPTIMIZATION: Build a Set of model roots to remove for O(1) lookup
      const modelsToRemove = new Set(models.map(m => m.model.root));
      
      // Return models to pool
      models.forEach(modelInfo => {
        returnModelToPool(modelInfo.model, modelInfo.path);
      });
      
      // OPTIMIZATION: Remove models in one pass instead of repeated findIndex + splice
      // Mark models for removal first, then filter
      const billboardsToReturn = [];
      let i = lodModels.length;
      while (i--) {
        if (modelsToRemove.has(lodModels[i].model)) {
          const lod = lodModels[i];
          if (lod.billboard) {
            billboardsToReturn.push(lod.billboard);
          }
          // Remove by swapping with last element and popping (O(1) removal)
          lodModels[i] = lodModels[lodModels.length - 1];
          lodModels.pop();
        }
      }
      
      // Return billboards to pool after cleanup
      billboardsToReturn.forEach(billboard => returnBillboardInstance(billboard));
      
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
  
  // LOD update throttling - moved to updateLOD function (frame-based instead of time-based)

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
      billboardMaterial.specularColor = new BABYLON.Color3(0.2, 0.2, 0.18); // Subtle specular for natural look
      billboardMaterial.specularPower = 64; // Moderate specular power
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
      
      // CRITICAL: Keep model disabled - LOD system will enable it based on distance
      // This prevents the flash of full detail at far distances
      model.root.setEnabled(false);
      
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
  function addLODBillboard(model, scene, modelRule, cameraPosition, chunkKey = null) {
    let billboard = null;
    let lodType = 'billboard'; // default behavior
    const modelPath = modelRule.path;
    const customLodDistance = modelRule.lodDistance || LOD_DISTANCE;
    
    // Use instanced billboard system for all models
    const scale = modelRule.billboardScale || 1;
    
    billboard = getBillboardInstance(modelPath, model.root.position, scale, scene);
    billboard.setEnabled(false); // Start with billboard disabled
    
    // Store for manual LOD management
    lodModels.push({
      model: model.root,
      billboard: billboard,
      lodType: lodType,
      lodDistance: customLodDistance,
      cullDistance: modelRule.cullDistance || customLodDistance * 2,
      // Store original values for LOD scaling
      originalLodDistance: customLodDistance,
      originalCullDistance: modelRule.cullDistance || customLodDistance * 2,
      chunkKey: chunkKey, // For chunk-based LOD grouping
      isStatic: !!chunkKey // Static scenery if it has a chunk
    });
    
    // Apply current LOD multiplier to new model if LOD system is active
    const lastLod = lodModels[lodModels.length - 1];
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      let currentMultiplier;
      
      // During loading, use minimum LOD (0.3x multiplier)
      if (loadingLODActive && !loadingComplete) {
        currentMultiplier = 0.3; // Minimum LOD during loading
      } else {
        currentMultiplier = window.hud.getCurrentLODMultiplier();
      }
      
      if (currentMultiplier !== 1.0) {
        lastLod.lodDistance = lastLod.originalLodDistance * currentMultiplier;
        lastLod.cullDistance = lastLod.originalCullDistance * currentMultiplier;
      }
    }
    
    // CRITICAL: Immediately evaluate and set correct initial state
    // This prevents any flash of full detail at far distances
    if (cameraPosition) {
      const modelPos = model.root.absolutePosition || model.root.position;
      const dx = cameraPosition.x - modelPos.x;
      const dy = cameraPosition.y - modelPos.y;
      const dz = cameraPosition.z - modelPos.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      const lodDistanceSquared = lastLod.lodDistance * lastLod.lodDistance;
      const cullDistanceSquared = lastLod.cullDistance * lastLod.cullDistance;
      
      if (distanceSquared > cullDistanceSquared) {
        // Very far - cull everything
        model.root.setEnabled(false);
        billboard.setEnabled(false);
      } else if (distanceSquared > lodDistanceSquared) {
        // Medium distance - show billboard only
        model.root.setEnabled(false);
        billboard.setEnabled(true);
      } else {
        // Close - show full model
        model.root.setEnabled(true);
        billboard.setEnabled(false);
      }
    } else {
      // No camera position provided - default to disabled until LOD system updates
      model.root.setEnabled(false);
      billboard.setEnabled(false);
    }
  }

  // Throttle LOD updates - only check every N frames for massive perf boost
  let lodFrameCounter = 0;
  const LOD_UPDATE_INTERVAL = 3; // Only update every 3rd frame (66% CPU savings!)

  // Manual LOD update function - called each frame
  function updateLOD(cameraPosition) {
    // Skip LOD updates during batch loading to prevent flickering
    if (skipLODUpdates) return;
    
    // OPTIMIZATION: Only update LOD every 3 frames - still feels instant at 60fps
    lodFrameCounter++;
    if (lodFrameCounter < LOD_UPDATE_INTERVAL) return;
    lodFrameCounter = 0;
    
    // Quick distance calculation using squared distance (no sqrt)
    const camX = cameraPosition.x;
    const camY = cameraPosition.y; 
    const camZ = cameraPosition.z;
    
    // OPTIMIZATION: Group static models by chunk, check distance to chunk center once
    const chunkResults = new Map(); // Cache chunk distance results
    
    // Process all models every frame for immediate response
    lodModels.forEach(lod => {
      // SKIP building placement previews - they should always be visible!
      if (lod.model && lod.model.metadata && lod.model.metadata.isPreview) {
        return;
      }
      
      let distanceSquared, lodDistanceSquared, cullDistanceSquared;
      
      // OPTIMIZATION: For static scenery (has chunkKey), check distance to chunk center once
      if (lod.isStatic && lod.chunkKey) {
        if (!chunkResults.has(lod.chunkKey)) {
          // First model in this chunk - calculate chunk center distance
          const [chunkX, chunkZ] = lod.chunkKey.split(',').map(Number);
          const chunkCenterX = (chunkX * 16 + 8) * TILE_SIZE; // 16 tiles per chunk, centered
          const chunkCenterZ = (chunkZ * 16 + 8) * TILE_SIZE;
          const dx = camX - chunkCenterX;
          const dy = camY - 0; // Ground level
          const dz = camZ - chunkCenterZ;
          chunkResults.set(lod.chunkKey, dx * dx + dy * dy + dz * dz);
        }
        distanceSquared = chunkResults.get(lod.chunkKey);
      } else {
        // Dynamic models (units, buildings) - check individual distance
      const modelPos = lod.model.absolutePosition || lod.model.position;
      const dx = camX - modelPos.x;
      const dy = camY - modelPos.y;
      const dz = camZ - modelPos.z;
        distanceSquared = dx * dx + dy * dy + dz * dz;
      }
      
      lodDistanceSquared = lod.lodDistance * lod.lodDistance;
      cullDistanceSquared = (lod.cullDistance || lod.lodDistance * 2) * (lod.cullDistance || lod.lodDistance * 2);
      
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
  
  // Expose updateLOD for immediate updates (e.g., when camera teleports)
  gfx.forceUpdateLOD = function(cameraPosition) {
    updateLOD(cameraPosition);
  };
  
  // Force-load chunks immediately around a position (for match start)
  gfx.forceLoadChunks = function(x, z) {
    if (!liveField) return;
    
    // console.log(`🗺️ Force-loading chunks around (${x.toFixed(1)}, ${z.toFixed(1)})`);
    
    // Clear the chunk queue AND model queue to prioritize immediate loading
    chunkQueue.length = 0;
    modelLoadQueue.length = 0;
    
    // Update visible chunks (marks them as needsMesh)
    liveField.updateVisibleChunks(x, z);
    
    // Calculate player chunk position for distance sorting
    const playerChunkX = Math.floor(x / (liveField.chunkSize * TILE_SIZE));
    const playerChunkZ = Math.floor(z / (liveField.chunkSize * TILE_SIZE));
    
    // Sort chunks by distance from player (closest first)
    const chunksToLoad = [];
    for (const [key, chunk] of liveField.chunks) {
      if (chunk.needsMesh || chunk.needsModels) {
        const [chunkX, chunkZ] = key.split(',').map(Number);
        const dx = chunkX - playerChunkX;
        const dz = chunkZ - playerChunkZ;
        const distanceSquared = dx * dx + dz * dz;
        chunksToLoad.push({ key, chunk, chunkX, chunkZ, distanceSquared });
      }
    }
    
    // Sort by distance (closest first)
    chunksToLoad.sort((a, b) => a.distanceSquared - b.distanceSquared);
    
    // Immediately create meshes for all chunks (closest first)
    let meshesLoaded = 0;
    
    for (const item of chunksToLoad) {
      // Create terrain mesh if needed
      if (item.chunk.needsMesh) {
        liveField.createChunkMesh(item.chunkX, item.chunkZ, gfx.scene, createTerrainMesh);
        meshesLoaded++;
        // Mark that models need to be placed now that mesh exists
        item.chunk.needsModels = true;
      }
      
      // Queue models (they'll be placed in queue)
      if (item.chunk.needsModels && item.chunk.mesh) {
        item.chunk.models = placeDecorationsOnChunk(item.chunk, gfx.scene); // NEW: Use pass system
        item.chunk.needsModels = false;
      }
    }
    
    // console.log(`✅ Force-loaded ${meshesLoaded} chunks, queued ${modelLoadQueue.length} models`);
    
    // Process all queued models immediately with promises
    const modelPromises = [];
    const queueCopy = [...modelLoadQueue];
    modelLoadQueue.length = 0; // Clear queue
    
    for (const task of queueCopy) {
      const promise = getPooledModel(task.modelPath, task.scene, task.position, task.rotation, task.scale)
        .then(model => {
          // Set up shadows
          if (window.gfx && window.gfx.setupMeshShadows) {
            window.gfx.setupMeshShadows(model.root);
          }
          
          task.models.push(model);
          model.root.parent = task.chunk.mesh;
          model.root.setEnabled(false); // Start disabled, LOD will enable
          
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
            if (mesh.material && mesh.material.emissiveColor) {
              mesh.material.emissiveColor = new BABYLON.Color3(0, 0, 0);
            }
          });
          
          // Add to LOD system with spawn camera position - it will set correct initial state
          addLODBillboard(model, task.scene, task.modelRule, {x, y: 9, z});
        })
        .catch(err => console.warn('Model loading failed during force load:', err));
      
      modelPromises.push(promise);
    }
    
    // Wait for all models to load, then update LOD
    Promise.all(modelPromises).then(() => {
      // console.log(`✅ Loaded ${modelPromises.length} models for force-loaded chunks`);
      // console.log(`📊 LOD system has ${lodModels.length} models total`);
      
      // CRITICAL: Force LOD update IMMEDIATELY after placing all models
      const camPos = {x, y: 9, z};
      // console.log(`🎯 Camera position for LOD update: (${x.toFixed(1)}, 9, ${z.toFixed(1)})`);
      
      // Debug: Check first few models
      let closeCount = 0, mediumCount = 0, farCount = 0;
      lodModels.forEach(lod => {
        const modelPos = lod.model.absolutePosition || lod.model.position;
        const dx = x - modelPos.x;
        const dy = 9 - modelPos.y;
        const dz = z - modelPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < lod.lodDistance) closeCount++;
        else if (dist < (lod.cullDistance || lod.lodDistance * 2)) mediumCount++;
        else farCount++;
      });
      
      // console.log(`📐 Distance check: ${closeCount} close, ${mediumCount} medium, ${farCount} far (LOD dist: ${lodModels[0]?.lodDistance || 'unknown'})`);
      
      updateLOD(camPos);
      // console.log('🎨 LOD state updated - close models should now be visible!');
    });
  };
  
  // Clear all LOD models (called when starting a new match)
  gfx.clearLODModels = function() {
    // console.log('🗑️ Clearing LOD system for new match...');
    
    // Dispose billboards before clearing
    lodModels.forEach(lod => {
      if (lod.billboard && lod.billboard.dispose) {
        lod.billboard.dispose();
      }
    });
    
    // Clear the array
    lodModels.length = 0;
    
    // CRITICAL: Reset all LOD system flags to ensure clean state
    // BUT preserve loadingLODCurrent - menu calibration should carry over!
    skipLODUpdates = false;
    loadingLODActive = false;
    loadingComplete = false;
    // loadingLODCurrent = 0; // DON'T RESET - preserve menu LOD setting!
    isProcessingQueue = false;
    
    // Clear any pending model loads
    modelLoadQueue.length = 0;
    
    // console.log(`✅ LOD system reset complete - preserved menu LOD at ${loadingLODCurrent}%`);
  };

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
          gfx.shadowGenerator.usePoissonSampling = true; // Enable Poisson sampling for visible shadows
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
    // Dirt tiles (20-35) - NO DECORATIONS FOR NOW (system needs redesign)
    15: { // DIRT_IN
      models: [
        // Decorations disabled - terrain should be visible
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
  // Since menu uses saved LOD, game inherits it - no ramping needed!
  function startLODRampUp() {
    if (loadingComplete) return; // Already started
    
    loadingComplete = true;
    
    // Get user's saved LOD setting
    const savedLOD = localStorage.getItem('lodLevel');
    const targetLOD = savedLOD ? parseInt(savedLOD) : 50;
    
    // Menu scene already set this LOD - just maintain it for consistency
    // "What you see in menu is what you get in-game!"
    loadingLODCurrent = targetLOD;
    loadingLODTarget = targetLOD;
    loadingLODActive = false; // No ramping needed - already at target
    
    // console.log(`🚀 Game starting! Maintaining menu LOD at ${targetLOD}% (no ramping - calibration scene)`);
  }
  
  // Expose function to start LOD ramp when game begins
  gfx.startGameLOD = startLODRampUp;
  
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
          
          // Add LOD billboard with chunk info for grouped checking
          addLODBillboard(model, task.scene, task.modelRule, gfx.cameraTarget ? gfx.cameraTarget.position : null, chunkKey);
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

  // NEW: Decoration pass system - places models using noise-based clustering
  function placeDecorationsOnChunk(chunk, scene) {
    // console.log(`🎯 placeDecorationsOnChunk called for chunk (${chunk.chunkX},${chunk.chunkZ})`);
    const models = [];
    const field = window.liveField;
    if (!field) {
      // console.log('⚠️ No field for decorations');
      return models;
    }
    
    // console.log(`✅ Field found, seed: ${field.seed}, terrainTypes length: ${field.terrainTypes?.length}`);
    const fieldSeed = field.seed || 12345;
    let rockCount = 0;
    let treeCount = 0;
    const occupiedTiles = new Set(); // Track which tiles have features
    const spawnZoneRadius = field.spawnZoneRadius || 6; // Radius to clear around spawns
    
    // Helper: Simple deterministic hash for tile placement
    function tileHash(x, y, seed) {
      let hash = seed;
      hash = hash ^ (x * 374761393);
      hash = hash ^ (y * 668265263);
      hash = (hash ^ (hash >>> 16)) * 0x85ebca6b;
      hash = (hash ^ (hash >>> 13)) * 0xc2b2ae35;
      hash = hash ^ (hash >>> 16);
      return Math.abs(hash >>> 0) / 4294967296; // 0-1
    }
    
    // PASS 1: Mountains (rocks) - on dirt terrain (barren/rocky areas)
    let dirtTileCount = 0;
    let rockNoisePassCount = 0;
    let sampleNoiseValues = [];
    
    chunk.tiles.forEach((tile, index) => {
      const localX = index % (chunk.endX - chunk.startX);
      const localZ = Math.floor(index / (chunk.endX - chunk.startX));
      const gridX = chunk.startX + localX;
      const gridZ = chunk.startZ + localZ;
      const terrainIndex = gridZ * field.width + gridX;
      const terrainType = field.terrainTypes[terrainIndex];
      
      // Skip spawn zones (keep them clear for agoras)
      if (field.isInSpawnZone && field.isInSpawnZone(gridX, gridZ)) return;
      
      // Only place rocks on dirt (type 2) - rocky/mountainous terrain
      if (terrainType !== 2) return;
      dirtTileCount++;
      
      // Simple per-tile hash for rock placement (~3% of dirt tiles get rocks)
      const rockRoll = tileHash(gridX, gridZ, fieldSeed + 1000);
      
      // Sample first 5 hash values for debugging
      if (sampleNoiseValues.length < 5) {
        sampleNoiseValues.push(rockRoll.toFixed(3));
      }
      
      // Place rocks on ~3% of grass tiles
      if (rockRoll < 0.03) {
        rockNoisePassCount++;
        
        // Mark tile as occupied
        const tileKey = `${gridX},${gridZ}`;
        occupiedTiles.add(tileKey);
        
        // Pick rock size based on REGION not individual tile (creates cohesive clusters)
        // Divide by 5 means 5x5 tile regions get same size category
        const regionX = Math.floor(gridX / 5);
        const regionZ = Math.floor(gridZ / 5);
        const sizeRoll = tileHash(regionX, regionZ, fieldSeed + 2000);
        
        let modelPath, scale, billboardScale;
        if (sizeRoll < 0.3) {
          // Small rocks (30%)
          modelPath = "assets/models/rocks_plain.glb";
          scale = 3.0;
          billboardScale = 3;
        } else if (sizeRoll < 0.7) {
          // Medium rocks (40%)
          modelPath = "assets/models/rocks_moss.glb";
          scale = 7.5;
          billboardScale = 5.9;
        } else {
          // Large rocks (30%)
          modelPath = "assets/models/rocks_snow.glb";
          scale = 11.5;
          billboardScale = 7.5;
        }
        
        // Place the rock at proper height for this tile
        const worldX = gridX * TILE_SIZE;
        const worldZ = gridZ * TILE_SIZE;
        
        // Get height variation for this tile position (rolling hills)
        const tileHeight = field.getHeightVariation ? field.getHeightVariation(gridX, gridZ) : 0;
        
        let hash = fieldSeed + gridX * 73856093 + gridZ * 19349663;
        hash = (hash * 1664525 + 1013904223) >>> 0;
        const offsetX = ((hash % 1000) / 1000 - 0.5) * 0.6;
        hash = (hash * 1664525 + 1013904223) >>> 0;
        const offsetZ = ((hash % 1000) / 1000 - 0.5) * 0.6;
        
        const position = new BABYLON.Vector3(worldX + offsetX, tileHeight, worldZ + offsetZ);
        hash = (hash * 1664525 + 1013904223) >>> 0;
        const rotation = ((hash % 628) / 100);
        
        // Queue the rock model for loading
        initBillboardAtlas(scene);
        modelLoadQueue.push({
          modelPath: modelPath,
          scene: scene,
          position: position,
          rotation: rotation,
          scale: scale,
          chunk: chunk,
          models: models,
          modelRule: { path: modelPath, scale: scale, billboardScale: billboardScale, lodDistance: 200 }
        });
        rockCount++;
      }
    });
    
    // console.log(`  🏔️ PASS 1: ${dirtTileCount} dirt tiles, ${rockNoisePassCount} passed roll (~3%), ${rockCount} rocks placed`);
    // console.log(`  📊 Sample rock hash values: [${sampleNoiseValues.join(', ')}]`);
    
    // PASS 2: Forests (trees) - only on unoccupied grass tiles
    chunk.tiles.forEach((tile, index) => {
      const localX = index % (chunk.endX - chunk.startX);
      const localZ = Math.floor(index / (chunk.endX - chunk.startX));
      const gridX = chunk.startX + localX;
      const gridZ = chunk.startZ + localZ;
      const terrainIndex = gridZ * field.width + gridX;
      const terrainType = field.terrainTypes[terrainIndex];
      
      // Skip spawn zones (keep them clear for agoras)
      if (field.isInSpawnZone && field.isInSpawnZone(gridX, gridZ)) return;
      
      // Only place trees on grass (type 3)
      if (terrainType !== 3) return;
      
      // Check if tile is already occupied by a rock
      const tileKey = `${gridX},${gridZ}`;
      if (occupiedTiles.has(tileKey)) return; // Skip occupied tiles
      
      // Simple per-tile hash for tree placement (~20% of grass tiles get trees)
      const treeRoll = tileHash(gridX, gridZ, fieldSeed + 3000);
      
      // Place trees on ~20% of grass tiles (but only on unoccupied tiles)
      if (treeRoll < 0.20) {
        // Mark tile as occupied
        occupiedTiles.add(tileKey);
        
        const worldX = gridX * TILE_SIZE;
        const worldZ = gridZ * TILE_SIZE;
        
        // Get height variation for this tile position (rolling hills)
        const tileHeight = field.getHeightVariation ? field.getHeightVariation(gridX, gridZ) : 0;
        
        let hash = fieldSeed + gridX * 13579 + gridZ * 24680; // Different hash for trees
        hash = (hash * 1664525 + 1013904223) >>> 0;
        const offsetX = ((hash % 1000) / 1000 - 0.5) * 0.6;
        hash = (hash * 1664525 + 1013904223) >>> 0;
        const offsetZ = ((hash % 1000) / 1000 - 0.5) * 0.6;
        
        const position = new BABYLON.Vector3(worldX + offsetX, tileHeight, worldZ + offsetZ);
        hash = (hash * 1664525 + 1013904223) >>> 0;
        const rotation = ((hash % 628) / 100);
        
        // Queue the tree model for loading
        initBillboardAtlas(scene);
        modelLoadQueue.push({
          modelPath: "assets/models/trees.glb",
          scene: scene,
          position: position,
          rotation: rotation,
          scale: 0.9,
          chunk: chunk,
          models: models,
          modelRule: { path: "assets/models/trees.glb", scale: 0.9, billboardScale: 3, lodDistance: 170 }
        });
        treeCount++;
      }
    });
    
    // console.log(`  🌲 PASS 2: ${treeCount} trees placed (~20% of unoccupied grass tiles)`);
    
    // Debug logging
    // console.log(`  ✅ TOTAL: ${rockCount} rocks, ${treeCount} trees`);
    
    // Start processing the model queue if not already running
    if (!isProcessingQueue && modelLoadQueue.length > 0) {
      requestAnimationFrame(processModelQueue);
    }
    
    return models;
  }
  
  // OLD SYSTEM: Function to place models on a chunk (now uses batched loading)
  function placeModelsOnChunk(chunk, scene) {
    const models = [];
    
    chunk.tiles.forEach((tile, index) => {
      const localX = index % (chunk.endX - chunk.startX);
      const localZ = Math.floor(index / (chunk.endX - chunk.startX));
      
      // Calculate world position for this tile
      const worldX = (chunk.startX + localX) * TILE_SIZE;
      const worldZ = (chunk.startZ + localZ) * TILE_SIZE;
      
      // Check terrain type for model rules (not tile.type which is wang tile variant)
      // Get actual terrain type from field's terrainTypes array
      const gridX = chunk.startX + localX;
      const gridZ = chunk.startZ + localZ;
      const terrainIndex = gridZ * window.liveField.width + gridX;
      const terrainType = window.liveField.terrainTypes[terrainIndex];
      
      // Map terrain type to old tile type IDs for model rules
      // Type 3 = grass (80%) → tile type 5 (trees/mushrooms)
      // Type 2 = dirt (20%) → tile type 15 (gates)
      const modelTileType = terrainType === 3 ? 5 : terrainType === 2 ? 15 : null;
      
      const rule = modelRules[modelTileType];
      if (rule) {
        // Only place one model per tile - pick randomly from available models
        let selectedModel = null;
        
        // CRITICAL: Use deterministic RNG from field for multiplayer sync
        const fieldSeed = window.liveField?.seed || 12345;
        // gridX and gridZ already calculated above for terrain lookup
        let hash = fieldSeed + gridX * 73856093 + gridZ * 19349663;
        hash = ((hash << 13) ^ hash) >>> 0;
        hash = (hash * (hash * hash * 15731 + 789221) + 1376312589) >>> 0;
        const deterministicRandom = (hash % 10000) / 10000; // 0-1
        
        // Go through models and test chance, but stop at first success
        for (const modelRule of rule.models) {
          if (deterministicRandom < modelRule.chance) {
            selectedModel = modelRule;
            break; // Only place one model per tile
          }
        }
        
        // If a model was selected, place it
        if (selectedModel) {
          // Add some randomness to position within tile (deterministic)
          hash = (hash * 1664525 + 1013904223) >>> 0;
          const offsetX = ((hash % 1000) / 1000 - 0.5) * 0.6;
          hash = (hash * 1664525 + 1013904223) >>> 0;
          const offsetZ = ((hash % 1000) / 1000 - 0.5) * 0.6;
          const position = new BABYLON.Vector3(
            worldX + offsetX, 
            0, 
            worldZ + offsetZ
          );
          
          // Random rotation (deterministic)
          hash = (hash * 1664525 + 1013904223) >>> 0;
          const rotation = ((hash % 628) / 100); // 0 to 2π
          
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
      water: { texture: waterAtlasTexture, name: 'water' },
      grassWater: { texture: grassWaterAtlasTexture, name: 'grassWater' },
      grassDirt: { texture: grassDirtAtlasTexture, name: 'grassDirt' },
      dirtWater: { texture: dirtWaterAtlasTexture || grassDirtAtlasTexture, name: 'dirtWater' } // Fallback if not available
    };
    
    // Use shared materials (create if they don't exist yet)
    if (!sharedMaterials.grass) {
      sharedMaterials.grass = new BABYLON.StandardMaterial("grassMaterial", scene);
      sharedMaterials.grass.diffuseTexture = grassAtlasTexture;
      sharedMaterials.grass.specularColor = new BABYLON.Color3(0.15, 0.15, 0.12); // Subtle specular for natural look
      sharedMaterials.grass.specularPower = 48; // Moderate specular power
    }
    if (!sharedMaterials.dirt) {
      sharedMaterials.dirt = new BABYLON.StandardMaterial("dirtMaterial", scene);
      sharedMaterials.dirt.diffuseTexture = dirtAtlasTexture;
      sharedMaterials.dirt.specularColor = new BABYLON.Color3(0.12, 0.12, 0.1); // Subtle specular
      sharedMaterials.dirt.specularPower = 40; // Moderate specular power
    }
    if (!sharedMaterials.rock) {
      sharedMaterials.rock = new BABYLON.StandardMaterial("rockMaterial", scene);
      sharedMaterials.rock.diffuseTexture = rockAtlasTexture;
      sharedMaterials.rock.specularColor = new BABYLON.Color3(0.25, 0.25, 0.22); // Moderate reflectivity for rocks
      sharedMaterials.rock.specularPower = 80; // Moderate specular power for rocks
    }
    if (!sharedMaterials.sand) {
      sharedMaterials.sand = new BABYLON.StandardMaterial("sandMaterial", scene);
      sharedMaterials.sand.diffuseTexture = sandAtlasTexture;
      sharedMaterials.sand.specularColor = new BABYLON.Color3(0.18, 0.18, 0.15); // Subtle specular
      sharedMaterials.sand.specularPower = 48; // Moderate specular power
    }
    if (!sharedMaterials.water) {
      sharedMaterials.water = new BABYLON.StandardMaterial("waterMaterial", scene);
      sharedMaterials.water.diffuseTexture = waterAtlasTexture;
      sharedMaterials.water.specularColor = new BABYLON.Color3(0.5, 0.5, 0.6); // Moderate reflectivity for water
      sharedMaterials.water.specularPower = 128; // Moderate specular power for water
    }
    if (!sharedMaterials.grassWater) {
      sharedMaterials.grassWater = new BABYLON.StandardMaterial("grassWaterMaterial", scene);
      sharedMaterials.grassWater.diffuseTexture = grassWaterAtlasTexture;
      sharedMaterials.grassWater.specularColor = new BABYLON.Color3(0.25, 0.25, 0.3); // Moderate reflectivity for water edges
      sharedMaterials.grassWater.specularPower = 80;
    }
    if (!sharedMaterials.grassDirt) {
      sharedMaterials.grassDirt = new BABYLON.StandardMaterial("grassDirtMaterial", scene);
      sharedMaterials.grassDirt.diffuseTexture = grassDirtAtlasTexture;
      sharedMaterials.grassDirt.specularColor = new BABYLON.Color3(0.12, 0.12, 0.1); // Subtle specular
      sharedMaterials.grassDirt.specularPower = 40;
    }
    if (!sharedMaterials.dirtWater && dirtWaterAtlasTexture) {
      sharedMaterials.dirtWater = new BABYLON.StandardMaterial("dirtWaterMaterial", scene);
      sharedMaterials.dirtWater.diffuseTexture = dirtWaterAtlasTexture;
      sharedMaterials.dirtWater.specularColor = new BABYLON.Color3(0.22, 0.22, 0.28); // Moderate reflectivity for water edges
      sharedMaterials.dirtWater.specularPower = 80;
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
      
      // Atlas grid size: 4x4 = 16 tiles (0.25 per tile) or 8x8 = 64 tiles (0.125 per tile)
      // If tiles look "double scale", try changing this to 8 for 8x8 atlas
      const atlasGridSize = 4; // 4x4 grid (change to 8 for 8x8 atlas)
      const uvScale = 1.0 / atlasGridSize; // 0.25 for 4x4, 0.125 for 8x8
      const maxRow = atlasGridSize - 1; // 3 for 4x4, 7 for 8x8
      
      // Pre-calculate UV coordinates to avoid repeated calculations
      const u1 = tileCol * uvScale + 0.01;
      const u2 = (tileCol + 1) * uvScale - 0.01;
      // Flip V coordinates (V=0 is at top in UV space)
      const v1 = (maxRow - tileRow) * uvScale + 0.01;
      const v2 = (maxRow - tileRow + 1) * uvScale - 0.01;
      
      // Determine which material to use based on tile's atlas name
      // Terrain transition atlases: atlas-grass-dirt (water atlases use grass-dirt as fallback)
      let materialKey = 'grass'; // default fallback
      if(tile.atlasName === 'atlas-grass-water') {
        materialKey = 'grassWater';
      } else if(tile.atlasName === 'atlas-grass-dirt') {
        materialKey = 'grassDirt';
      } else if(tile.atlasName === 'atlas-dirt-water') {
        materialKey = 'dirtWater';
      } else if(tile.atlasName === 'atlas-water') {
        materialKey = 'water'; // legacy support
      } else if(tile.atlasName === 'atlas-grass') {
        materialKey = 'grass'; // legacy support
      }
      
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
        // Ensure material exists before assigning to prevent undefined material errors
        if (!sharedMaterials[key]) {
          // Fallback: create material on the fly if it doesn't exist
          const texture = materials[key]?.texture || grassAtlasTexture;
          sharedMaterials[key] = new BABYLON.StandardMaterial(`${key}Material`, scene);
          sharedMaterials[key].diffuseTexture = texture;
          sharedMaterials[key].specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
          sharedMaterials[key].specularPower = 32;
        }
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
    
    // Initialize loading LOD system - use saved setting for menu
    // Menu scene is your calibration scene - what you see is what you get in-game!
    const savedLOD = localStorage.getItem('lodLevel');
    const menuLOD = savedLOD ? parseInt(savedLOD) : 50;
    
    loadingLODActive = false; // Disabled during menu
    loadingLODCurrent = menuLOD; // Use saved setting (or default 50)
    loadingComplete = false;
    
    // Set initial LOD to saved setting for consistent menu rendering
    if (window.hud && window.hud.updateLODDistances) {
      window.hud.updateLODDistances(menuLOD);
      // console.log(`🎚️ Menu LOD initialized to saved setting: ${menuLOD}%`);
    }
    
    // Load textures now that we have a scene
    // Terrain transition atlases
    grassDirtAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass-dirt.png", gfx.scene);
    
    // Legacy/fallback textures (using new atlases as fallbacks)
    grassAtlasTexture = grassDirtAtlasTexture; // Use grass-dirt as fallback
    dirtAtlasTexture = grassDirtAtlasTexture;
    rockAtlasTexture = new BABYLON.Texture("assets/textures/atlas-hd.png", gfx.scene);
    sandAtlasTexture = grassDirtAtlasTexture;
    // Water atlases use grass-dirt as fallback (water textures not used)
    grassWaterAtlasTexture = grassDirtAtlasTexture;
    dirtWaterAtlasTexture = grassDirtAtlasTexture;
    waterAtlasTexture = grassDirtAtlasTexture;

    gfx.makeScene(gfx.scene);

    // Debug function to show a single quad with atlas texture
    gfx.testAtlasQuad = function(tileType = 6, atlasName = 'atlas-grass-dirt', position = new BABYLON.Vector3(10, 2, 0)) {
      if (!gfx.scene) {
        console.warn('Scene not initialized');
        return;
      }
      
      // Get the correct texture
      let texture = grassDirtAtlasTexture;
      // All atlases use grass-dirt texture (water atlases not used)
      
      // Create material
      const material = new BABYLON.StandardMaterial('testAtlasMat', gfx.scene);
      material.diffuseTexture = texture;
      material.backFaceCulling = false;
      
      // Calculate UV coordinates (same logic as createTerrainMesh)
      const atlasGridSize = 4; // 4x4 grid
      const uvScale = 1.0 / atlasGridSize; // 0.25
      const maxRow = atlasGridSize - 1; // 3
      
      // Calculate row/col from tile type
      const tileRow = Math.floor(tileType / atlasGridSize);
      const tileCol = tileType % atlasGridSize;
      
      // Exact 1:1 mapping - no padding to see pure tile
      const u1 = tileCol * uvScale;
      const u2 = (tileCol + 1) * uvScale;
      const v1 = (maxRow - tileRow) * uvScale;
      const v2 = (maxRow - tileRow + 1) * uvScale;
      
      console.log(`🔍 Testing tile type ${tileType} from ${atlasName} - 1:1 mapping`);
      console.log(`   Row: ${tileRow}, Col: ${tileCol}`);
      console.log(`   UV: (${u1.toFixed(6)}, ${v1.toFixed(6)}) to (${u2.toFixed(6)}, ${v2.toFixed(6)})`);
      console.log(`   UV Scale: ${uvScale} (${atlasGridSize}x${atlasGridSize} grid)`);
      
      // Create a plane mesh - exactly 1 tile size
      const plane = BABYLON.MeshBuilder.CreatePlane('testAtlasQuad', {
        size: TILE_SIZE, // Exactly 1 tile size
        width: TILE_SIZE,
        height: TILE_SIZE
      }, gfx.scene);
      
      plane.position = position;
      plane.material = material;
      
      // Rotate plane flat to the ground (90 degrees around X axis)
      plane.rotation.x = Math.PI / 2;
      
      // Set UV coordinates manually
      const vertexData = BABYLON.VertexData.ExtractFromMesh(plane);
      const uvs = vertexData.uvs;
      
      // Plane has 4 vertices, each with 2 UV coordinates
      // Order: bottom-left, bottom-right, top-left, top-right
      uvs[0] = u1; uvs[1] = v2; // bottom-left
      uvs[2] = u2; uvs[3] = v2; // bottom-right
      uvs[4] = u1; uvs[5] = v1; // top-left
      uvs[6] = u2; uvs[7] = v1; // top-right
      
      vertexData.uvs = uvs;
      vertexData.applyToMesh(plane);
      
      console.log(`✅ Created test quad at position (${position.x}, ${position.y}, ${position.z})`);
      console.log(`   Use: gfx.testAtlasQuad(tileType, atlasName, position)`);
      console.log(`   Example: gfx.testAtlasQuad(6, 'atlas-grass-dirt', new BABYLON.Vector3(10, 1, 0))`);
      
      return plane;
    };

    // Start render loop immediately - don't wait for scene.whenReadyAsync()
    gfx.engine.runRenderLoop(mainRenderLoop);
    // console.log('🎬 Render loop started - camera interactive immediately');
  
    gfx.scene.whenReadyAsync().then(function() {
      // Add world axis after scene is ready
      if (gfx.showWorldAxes) {
        // gfx.showWorldAxes(1024, gfx.scene, new Vec3(0,0,0));
      }
      
      // Load cursor frog indicator (deferred - not needed for menu)
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
        
        // DON'T apply saved LOD on startup - let the loading LOD system handle it!
        // Menu uses LOD 50 by default, games ramp from low to saved setting.
        // The saved setting is only applied when:
        // 1. Game finishes loading (via startLODRampUp)
        // 2. User opens settings menu (via initLODSlider)
        
        // Try to initialize LOD slider (will fail if settings menu not opened yet)
        if (hud.initLODSlider) {
          hud.initLODSlider();
        }
        
        // Only initialize 3D HUD if USE_3D_HUD is true
        if (USE_3D_HUD) {
          // console.log("🎮 3D HUD initialized - main menu items will be created when first shown");
        }
      }

      // Initialize lasso selection system
      if (window.lassoSelection && window.lassoSelection.init) {
        window.lassoSelection.init();
        // console.log("🎯 Lasso selection system initialized");
      }
      
      // console.log('✅ Scene fully loaded and ready');

      // CREATE MOUNTAINS HERE - after field.js is guaranteed loaded
      // console.log('🌄 Creating simple mountains in scene.');
      // console.log('whenReady - field ready: true');
      // console.log('🏔️ Creating distant mountain vista far below');
      // console.log(`🏔️ Mountain vista params: field=${fieldSize}x${fieldSize}, plane size=${planeSize}`);
      // console.log(`🏔️ Modifying ${totalVertices} vertices for vista`);
      // console.log('🏔️ Mountain material created - grey with progressive randomness');
      // console.log('🏔️ Mountain vista ready - flat center with increasing randomness outward!');
      // console.log('🌅 Creating horizon line for distant vista');
      // console.log('🌅 Horizon line created - enhances sense of vast distance');
      // console.log('🌄 Simple mountains created successfully');
      // console.log(`🌄 Creating subtle low-relief mountains`);

      // In the scene.whenReady callback (around line 1373), re-enable the mountain creation:
      if (gfx.scene && window.liveField) {
        gfx.mountains = createSimpleMountains(gfx.scene, window.liveField.width);
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

    // SAFETY: Check scene and engine validity before rendering
    if (!gfx.scene || !gfx.engine) {
      console.warn('Scene or engine not available, skipping render');
      return;
    }

    // SAFETY: Validate active camera
    if (!gfx.scene.activeCamera) {
      console.warn('No active camera, skipping render');
      return;
    }

    // SAFETY: Check for corrupted meshes before rendering
    try {
      // Quick validation of all meshes
      if (gfx.scene.meshes) {
        let corruptedMeshes = 0;
        gfx.scene.meshes.forEach((mesh, index) => {
          try {
            // Check if mesh has valid position
            if (!Number.isFinite(mesh.position.x) || !Number.isFinite(mesh.position.y) || !Number.isFinite(mesh.position.z)) {
              console.warn(`Mesh ${mesh.name || 'unnamed'} at index ${index} has invalid position:`, mesh.position);
              mesh.position = new BABYLON.Vector3(0, 0, 0); // Reset position
              corruptedMeshes++;
            }
            
            // Check if mesh isPickable is valid
            if (typeof mesh.isPickable !== 'boolean') {
              console.warn(`Mesh ${mesh.name || 'unnamed'} has invalid isPickable:`, mesh.isPickable);
              mesh.isPickable = false;
              corruptedMeshes++;
            }
            
            // Check material validity
            if (mesh.material && typeof mesh.material !== 'object') {
              console.warn(`Mesh ${mesh.name || 'unnamed'} has invalid material:`, mesh.material);
              mesh.material = null;
              corruptedMeshes++;
            }
            
          } catch (meshError) {
            console.warn(`Error validating mesh ${mesh.name || 'unnamed'}:`, meshError);
            corruptedMeshes++;
          }
        });
        
        if (corruptedMeshes > 0) {
          console.warn(`Found ${corruptedMeshes} corrupted meshes, fixed automatically`);
        }
      }
      
      // SAFETY: Validate particle systems - DISABLED - was too aggressive and killing healthy particles
      // This validation was stopping particles during normal building placement animations
      // Particles have their own error handling and cleanup in fx.js
      //
      // if (gfx.scene.particleSystems) {
      //   let corruptedParticles = 0;
      //   gfx.scene.particleSystems.forEach((system, index) => {
      //     try {
      //       if (!system.emitter || typeof system.emitter !== 'object') {
      //         console.warn(`Particle system ${index} has invalid emitter:`, system.emitter);
      //         system.emitter = new BABYLON.Vector3(0, 0, 0);
      //         corruptedParticles++;
      //       }
      //     } catch (particleError) {
      //       console.warn(`Particle system ${index} validation error:`, particleError);
      //       corruptedParticles++;
      //     }
      //   });
      // }
      
    } catch (validationError) {
      console.error('Error during pre-render validation:', validationError);
    }

    // SAFETY: Wrap the actual render call
    try {
      gfx.scene.render();
    } catch (renderError) {
      console.error('CRITICAL: Scene render failed!', renderError);
      console.error('Render error stack:', renderError.stack);
      
      // Emergency cleanup - try to identify and fix the problematic mesh
      if (gfx.scene.meshes) {
        console.log('Emergency mesh cleanup - checking all meshes...');
        gfx.scene.meshes.forEach((mesh, index) => {
          try {
            // Temporarily disable mesh to isolate the problem
            mesh.setEnabled(false);
            console.log(`Disabled mesh ${index}: ${mesh.name || 'unnamed'}`);
          } catch (disableError) {
            console.warn(`Could not disable mesh ${index}:`, disableError);
          }
        });
      }
      
      // Try rendering without problematic elements
      try {
        // Disable all particle systems temporarily
        if (gfx.scene.particleSystems) {
          gfx.scene.particleSystems.forEach(system => {
            if (system.isStarted()) {
              system.stop();
            }
          });
        }
        
        // Try rendering again
        gfx.scene.render();
        console.log('Emergency render succeeded after cleanup');
        
      } catch (secondRenderError) {
        console.error('Emergency render also failed:', secondRenderError);
        // Last resort - restart the engine
        if (gfx.engine && gfx.canvas) {
          console.log('Restarting render loop as last resort...');
          gfx.engine.stopRenderLoop();
          setTimeout(() => {
            if (gfx.engine && gfx.canvas) {
              gfx.engine.runRenderLoop(mainRenderLoop);
            }
          }, 1000);
        }
      }
    }

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
    
    // Update LOD system based on camera TARGET position (same as chunks)
    // Use cameraTarget instead of camera.position so LOD and chunks are centered the same
    if (gfx.cameraTarget) {
      updateLOD(gfx.cameraTarget.position);
      
      // Update particle LOD - stop/start particles based on distance
      if (window.fx && window.fx.updateParticleLOD) {
        window.fx.updateParticleLOD(gfx.cameraTarget.position);
      }
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
    // Always update positions (cheap) but throttle grouping logic (expensive)
    if (window.hud && window.hud.updateMinimap) {
      if (!this._minimapFrameCounter) this._minimapFrameCounter = 0;
      this._minimapFrameCounter++;
      const fullUpdate = this._minimapFrameCounter >= 5;
      if (fullUpdate) {
        this._minimapFrameCounter = 0;
      }
      window.hud.updateMinimap(fullUpdate); // Pass flag for full vs position-only update
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
          item.chunk.models = placeDecorationsOnChunk(item.chunk, gfx.scene); // NEW: Use pass system
          item.chunk.needsModels = false;
        }
        
        processed++;
      }
    }
    
    // Update FPS if settings menu is visible (minimal impact)
    if (DRAW_FPS && document.getElementById('fps_meter') && document.getElementById('settings_menu').style.display !== 'none') {
        document.getElementById('fps_meter').innerHTML = Math.round(gfx.engine.getFps()) + ' FPS';
    }
    
    // Periodic performance diagnostics (every 5 seconds)
    if (!window._lastPerfLog) window._lastPerfLog = 0;
    if (window.frameCounter && window.frameCounter % 300 === 0 && Date.now() - window._lastPerfLog > 5000) {
      window._lastPerfLog = Date.now();
      const fps = Math.round(gfx.engine.getFps());
      const chunks = window.liveField ? window.liveField.chunks.size : 0;
      const lodCount = lodModels.length;
      const meshCount = gfx.scene.meshes.length;
      if (fps < 30) {
        console.log(`⚠️ Performance: ${fps} FPS | Chunks: ${chunks} | LOD models: ${lodCount} | Total meshes: ${meshCount}`);
      }
    }

    // NEW: Update camera from keyboard/mouse/touch velocity (ESDF, arrows, RMB pan)
    if (typeof ui !== 'undefined' && ui.updateCameraFromVelocity) {
      ui.updateCameraFromVelocity();
    }

    // SAFETY: Validate active camera
    if (gfx.scene.activeCamera) {
      gfx.scene.render();
    } else {
      console.warn('No active camera, skipping render');
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
    
    // NOW sync camera rotation targets - gfx.camera is assigned and ready
    if (window.ui && window.ui.syncCameraRotationTargets) {
      window.ui.syncCameraRotationTargets();
    } else {
      // Fallback: enable camera controls immediately if ui isn't ready yet
      if (window.ui && window.ui.enableCameraControls) {
        window.ui.enableCameraControls();
      }
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
      
      // Ensure lighting is enabled (safety check)
      if (lighting.restoreLighting) {
        lighting.restoreLighting();
      }
      
      // console.log('Orbital lighting system ready - use lighting.setTimeOfDay(0-1) to adjust');
      
      // Auto-initialize shadows when scene is stable (no fixed delay)
      // console.log('🎭 Starting shadow initialization with stability checks...');
      setTimeout(() => {
        if (gfx.autoInitializeShadows) {
          gfx.autoInitializeShadows();
        }
        // Ensure lighting is still enabled after shadow initialization
        if (lighting.restoreLighting) {
          lighting.restoreLighting();
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
            // Ensure lighting is still enabled after shadow initialization
            if (lighting.restoreLighting) {
              lighting.restoreLighting();
            }
          }, 1000);
        });
      }
    }

    // Create table first
    gfx.table = gfx.makeTable(scene);
    
    // Pre-stretch table to default field size to prevent visual jump
    // This happens before first render for clean initial display
    if (gfx.table && gfx.table.parts && gfx.table.parts.SW && gfx.stretchTable) {
      // Table will be stretched properly when field loads, this is just initial positioning
      // Using default 128x128 field size for initial frame
      // console.log('📐 Pre-positioning table for clean initial render');
    }
    
  // Store shadow state globally - enable shadows by default
  window.SHADOWS_ENABLED = true;
  
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
    maxShadowDistance: 500, // Maximum distance for shadow casting (increased for better visibility)
    nearShadowDistance: 200, // Distance for high quality shadows
    farShadowDistance: 400, // Distance for low quality shadows
    cullingDistance: 600, // Distance beyond which no shadows are cast
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
          gfx.shadowGenerator.useBlurExponentialShadowMap = false; // Disable blur
          gfx.shadowGenerator.usePoissonSampling = true; // Poisson sampling (most stable)
          gfx.shadowGenerator.darkness = 0.6; // Lighter shadows, less harsh
          gfx.shadowGenerator.setTransparencyShadow(false); // Disable transparency for better performance
          gfx.shadowGenerator.bias = 0.0001; // Slightly higher to reduce artifacts
          gfx.shadowGenerator.normalBias = 0.05; // Higher to reduce edge artifacts
          gfx.shadowGenerator.depthScale = 25; // Lower for softer depth transitions
          gfx.shadowGenerator.filter = BABYLON.ShadowGenerator.FILTER_POISSON; // Explicit filter mode
          
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
        console.log('⚠️ Shadows disabled, skipping initialization');
        return;
      }

      // Check if shadow generator already exists
      if (gfx.shadowGenerator) {
        console.log('✅ Shadow generator already exists');
        // Still update meshes in case new ones were added
        if (gfx.updateAllMeshShadows) {
          gfx.updateAllMeshShadows();
        }
        return;
      }

      // Check if scene is stable (but don't wait too long)
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
        console.log('   Shadow casters:', gfx.shadowGenerator.getShadowMap().renderList.length);
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

    // Add this after the initializeShadowGenerator function (around line 1424)
    
    // Dynamic shadow resolution based on LOD level
    gfx.getShadowResolutionForLOD = function(lodLevel = 50) {
      if (lodLevel <= 30) {
        return 512;  // Low-end profile: minimal GPU usage
      } else if (lodLevel <= 70) {
        return 1024; // Medium: default balance
      } else {
        return 2048; // High-end: sharper shadows
      }
    };
    
    // Modified reconfigureShadowGenerator - now silent
    gfx.reconfigureShadowGenerator = function(lodLevel) {
      if (!window.SHADOWS_ENABLED || !gfx.shadowGenerator || !window.lighting?.lights?.sun) {
        return; // Skip if disabled or not ready
      }
      
      // Debounce: only reconfigure if LOD changed by more than 5%
      const changeThreshold = 5;
      if (Math.abs(lodLevel - gfx.lastLODLevel) < changeThreshold) {
        return; // Small change, skip reconfiguration
      }
      
      const newRes = gfx.getShadowResolutionForLOD(lodLevel);
      const currentRes = gfx.shadowGenerator.getShadowMap().getSize().width;
      
      if (newRes === currentRes) {
        gfx.lastLODLevel = lodLevel; // Still update tracking
        return; // No change needed
      }
      
      try {
        // Dispose old generator
        gfx.shadowGenerator.dispose();
        
        // Create new one with updated res and same settings as initializeShadowGenerator
        gfx.shadowGenerator = new BABYLON.ShadowGenerator(newRes, window.lighting.lights.sun);
        gfx.shadowGenerator.useBlurExponentialShadowMap = false; // Disable blur
        gfx.shadowGenerator.usePoissonSampling = true; // Poisson sampling (most stable)
        gfx.shadowGenerator.darkness = 0.6; // Lighter shadows, less harsh
        gfx.shadowGenerator.setTransparencyShadow(false); // Disable transparency for better performance
        gfx.shadowGenerator.bias = 0.0001; // Slightly higher to reduce artifacts
        gfx.shadowGenerator.normalBias = 0.05; // Higher to reduce edge artifacts
        gfx.shadowGenerator.depthScale = 25; // Lower for softer depth transitions
        gfx.shadowGenerator.filter = BABYLON.ShadowGenerator.FILTER_POISSON; // Explicit filter mode
        gfx.shadowGenerator.minDistance = 0.1;
        gfx.shadowGenerator.maxDistance = 1500;
        
        // Re-add all current shadow casters with force
        gfx.updateAllMeshShadows(true); // true = force re-add
        
        gfx.lastLODLevel = lodLevel;
        
        // Low-end profile tip tracking (silent)
        if (lodLevel <= 30 && !gfx.lastLowEndTip) {
          gfx.lastLowEndTip = true;
        } else if (lodLevel > 30) {
          gfx.lastLowEndTip = false; // Reset tip for next low-end activation
        }
        
      } catch (error) {
        // Fallback: try to reinitialize (silent)
        gfx.initializeShadowGenerator();
      }
    };
    
    // Hook for HUD LOD changes - export this for hud.js to call
    gfx.onLODDistanceUpdate = function(lodValue) {
      gfx.reconfigureShadowGenerator(lodValue);
    };
    
    // Modified updateAllMeshShadows - now with logging for debugging
    gfx.updateAllMeshShadows = function(forceReadd = false) {
      if (!gfx.scene) {
        console.warn('⚠️ No scene available for shadow update');
        return;
      }
      
      // Don't skip if shadows are disabled - we need to remove them!
      if (!window.SHADOWS_ENABLED && !gfx.shadowGenerator) {
        // Only skip if shadows are off AND there's no shadow generator to clean up
        console.log('⚠️ Shadows disabled and no generator to clean up');
        return;
      }
      
      if (window.SHADOWS_ENABLED && !gfx.shadowGenerator) {
        console.warn('⚠️ No shadow generator, cannot enable shadows');
        return;
      }
      
      let shadowCasterCount = 0;
      let receiveShadowCount = 0;
      let removedCount = 0;
      
      gfx.scene.meshes.forEach(mesh => {
        // Skip UI elements and background meshes
        const isUIMesh = mesh.name.includes('table') || 
                        mesh.name.includes('UI') ||
                        mesh.name.includes('radial') ||
                        mesh.name.includes('HUD') ||
                        mesh.name.includes('hud') ||
                        mesh.name.includes('minimap') ||
                        mesh.name.includes('mountain') || // Skip mountains!
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
                          mesh.parent.name.includes('Minimap') ||
                          mesh.parent.name.includes('mountain') // Skip mountain children
                        ));
        if (isUIMesh) return;
        
        // All game meshes can receive shadows (or not)
        mesh.receiveShadows = window.SHADOWS_ENABLED;
        if (window.SHADOWS_ENABLED) receiveShadowCount++;
        
        // Only non-terrain meshes should cast shadows
        const isTerrainMesh = mesh.name.includes('terrainMesh') || mesh.name.includes('Mesh');
        
        if (window.SHADOWS_ENABLED && !isTerrainMesh && gfx.shadowGenerator) {
          if (forceReadd) {
            // Force re-add: remove first, then add to ensure it's in the new generator
            gfx.shadowGenerator.removeShadowCaster(mesh);
            gfx.shadowGenerator.addShadowCaster(mesh);
            shadowCasterCount++;
          } else {
            // Normal mode: only add if not already a caster
            if (!gfx.shadowGenerator.getShadowMap().renderList.includes(mesh)) {
              gfx.shadowGenerator.addShadowCaster(mesh);
              shadowCasterCount++;
            }
          }
        } else if (gfx.shadowGenerator && !window.SHADOWS_ENABLED) {
          // Remove from shadow casters when disabled
          gfx.shadowGenerator.removeShadowCaster(mesh);
          removedCount++;
        }
        
        // Handle child meshes
        if (mesh.getChildMeshes) {
          mesh.getChildMeshes().forEach(child => {
            child.receiveShadows = window.SHADOWS_ENABLED;
            if (window.SHADOWS_ENABLED && !isTerrainMesh && forceReadd && gfx.shadowGenerator) {
              gfx.shadowGenerator.removeShadowCaster(child);
              gfx.shadowGenerator.addShadowCaster(child);
              shadowCasterCount++;
            } else if (window.SHADOWS_ENABLED && !isTerrainMesh && !forceReadd && gfx.shadowGenerator) {
              if (!gfx.shadowGenerator.getShadowMap().renderList.includes(child)) {
                gfx.shadowGenerator.addShadowCaster(child);
                shadowCasterCount++;
              }
            } else if (gfx.shadowGenerator && !window.SHADOWS_ENABLED) {
              // Remove child from shadow casters when disabled
              gfx.shadowGenerator.removeShadowCaster(child);
              removedCount++;
            }
          });
        }
      });
      
      // Log shadow stats for debugging
      if (window.SHADOWS_ENABLED && gfx.shadowGenerator) {
        const totalCasters = gfx.shadowGenerator.getShadowMap().renderList.length;
        console.log(`🎭 Shadow update: ${shadowCasterCount} new casters, ${receiveShadowCount} receivers, ${totalCasters} total casters`);
      } else if (!window.SHADOWS_ENABLED && gfx.shadowGenerator) {
        const totalCasters = gfx.shadowGenerator.getShadowMap().renderList.length;
        console.log(`🎭 Shadows disabled: removed ${removedCount} meshes, ${totalCasters} casters remaining`);
      }
    };

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
    
    // CRITICAL: Position camera at the default player agora location
    // Default player agora is at (15, 15) in tile coordinates (see player.js line 40)
    // This is where the agora spawns in both menu scene and games
    const defaultAgoraX = 15;
    const defaultAgoraZ = 15;
    const initialX = defaultAgoraX * TILE_SIZE;
    const initialZ = defaultAgoraZ * TILE_SIZE;
    const initialY = 9;
    
    let camera = new BABYLON.ArcRotateCamera("zCamera", -2.5, 0.9, radius, new Vec3(initialX, initialY, initialZ), scene);
    gfx.cameraTarget = new BABYLON.TransformNode("zCameraFocus");
    gfx.cameraTarget.position.set(initialX, initialY, initialZ);
    // Lock camera to target; we will drive the target via an anchor with lerp
    camera.lockedTarget = gfx.cameraTarget;
    // Initialize camera anchor (desired target position)
    window.cameraAnchor = gfx.cameraTarget.position.clone();
    
    // console.log(`📷 Camera initialized at player agora: (${initialX}, ${initialZ})`);
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
    
    // Disable built-in keyboard input (ArcRotateCamera has WASD for target movement by default)
    if (camera.inputs && camera.inputs.attached && camera.inputs.attached.keyboard) {
      try { camera.inputs.attached.keyboard.detachControl(); } catch (e) {}
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

    // NOTE: Don't call syncCameraRotationTargets here - gfx.camera isn't assigned yet!
    // It will be called after this function returns and gfx.camera is assigned

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
  
  // Clear chunk queue when switching fields
  gfx.clearChunkQueue = function() {
    chunkQueue.length = 0;
  };
  
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

  // Add this function after the createTerrainMesh function (around line 1289) and before gfx.init

  // Expose mountain recreation function
  gfx.recreateMountains = function() {
    if (gfx.mountains && gfx.mountains.dispose) {
      gfx.mountains.dispose();
    }
    const fieldDim = window.liveField ? Math.max(window.liveField.width, window.liveField.height) : 64;
    gfx.mountains = createSimpleMountains(gfx.scene, fieldDim);
    console.log('🏔️ Mountains recreated');
  };
  
  // Simple mountain background using Babylon's ground mesh with procedural height simulation
  // Creates a distant mountain vista far below, like looking down at an endless landscape from high above
  function createSimpleMountains(scene, fieldSize = 64) {
    // console.log('🏔️ Creating distant mountain vista far below');
    
    if (!scene) {
      // console.error('❌ Scene not available for mountains');
      return null;
    }
    
    // Simple parameters for reliable generation
    const actualFieldWidth = window.liveField ? window.liveField.width * TILE_SIZE : fieldSize * TILE_SIZE;
    const actualFieldHeight = window.liveField ? window.liveField.height * TILE_SIZE : fieldSize * TILE_SIZE;
    const fieldCenterX = actualFieldWidth / 2;
    const fieldCenterZ = actualFieldHeight / 2;
    
    // One large plane with lower resolution
    const mountainSize = Math.max(actualFieldWidth, actualFieldHeight) * 6; // Large plane
    const subdivisions = 32; // Lower resolution for smooth gradient
    
    // console.log(`🏔️ Mountain vista params: field=${actualFieldWidth}x${actualFieldHeight}, plane size=${mountainSize}`);
    
    // Create one big plane
    const mountainGround = BABYLON.MeshBuilder.CreateGround("mountainGround", {width: mountainSize, height: mountainSize, subdivisions: subdivisions}, scene);
    
    // Position - VERY FAR below the table to create vista effect
    mountainGround.position.x = fieldCenterX;
    mountainGround.position.z = fieldCenterZ;
    mountainGround.position.y = -200; // Massive depth for distant mountain vista
    
    // Get positions for modification
    const positions = mountainGround.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    if (!positions) {
      // console.error('❌ Could not get positions');
      return mountainGround;
    }
    
    const numVertices = positions.length / 3;
    // console.log(`🏔️ Modifying ${numVertices} vertices for vista`);
    
    // Seed for consistent noise
    const seed = window.liveField ? window.liveField.seed : 42;
    
    // Simple terrain: flat at center, increasing randomness and height outward
    for (let i = 0; i < numVertices; i++) {
      let x = positions[i * 3];
      let z = positions[i * 3 + 2];
      
      // Distance from field center
      const distFromCenter = Math.sqrt((x - fieldCenterX) ** 2 + (z - fieldCenterZ) ** 2);
      const maxDist = mountainSize / 2;
      const normalizedDist = Math.min(1, distFromCenter / maxDist);
      
      let height = 0;
      
      // Only add height if not in the center
      if (normalizedDist > 0.1) {
        // Base height increases with distance
        const baseHeight = normalizedDist * 150; // Max height 150
        
        // Random noise increases with distance
        const noiseStrength = normalizedDist; // 0 at center, 1 at edges
        
        // Simple hash-based random noise
        let hashX = Math.floor(x);
        let hashZ = Math.floor(z);
        let hash = seed;
        hash = ((hash << 13) ^ hash) >>> 0;
        hash = ((hash * (hash * hash * 15731 + 789221) + 1376312589 + hashX * 73856093 + hashZ * 19349663) & 0xffffffff) >>> 0;
        
        const randomNoise = (Math.sin(hash * 0.5) + Math.sin(hash * 0.1) * 0.5) * noiseStrength * 80; // Random offset increases outward
        
        height = baseHeight + randomNoise;
      }
      
      positions[i * 3 + 1] = height;
    }
    
    // Apply positions and recalculate normals for proper lighting
    mountainGround.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
    mountainGround.createNormals(false); // Recalculate normals for proper lighting
    
    // Dark phthalo green material - much darker
    const mat = new BABYLON.StandardMaterial("mountainVistaMat", scene);
    mat.diffuseColor = new BABYLON.Color3(0.05, 0.08, 0.1); // Very dark phthalo green
    mat.specularColor = new BABYLON.Color3(0.03, 0.05, 0.06); // Very low specularity
    mat.ambientColor = new BABYLON.Color3(0.1, 0.13, 0.15); // Dark ambient
    mat.alpha = 1.0;
    mat.backFaceCulling = false;
    mat.depthWrite = true;

    // No texture - solid color
    mat.diffuseTexture = null;

    // console.log('🏔️ Mountain material created - grey with progressive randomness');
    
    mountainGround.material = mat;
    
    // Render in background group
    mountainGround.renderingGroupId = 0;
    mountainGround.isPickable = false;
    mountainGround.isVisible = true;
    
    // Add to shadow generator for subtle depth effects
    if (window.gfx && window.gfx.shadowGenerator) {
      try {
        window.gfx.shadowGenerator.addShadowCaster(mountainGround, false);
        // console.log(`🏔️ Mountain vista added to shadow receiver`);
      } catch (e) {
        // console.log(`⚠️ Could not add vista to shadow receiver:`, e.message);
      }
    }
    
    // console.log('🏔️ Mountain vista ready - flat center with increasing randomness outward!');
    
    // Create a horizon plane to show the distant mountains meeting the sky
    // This creates visual reference for the vast distance below
    const horizon = createHorizon(scene, fieldCenterX, fieldCenterZ, mountainSize);
    if (horizon) {
      horizon.parent = mountainGround;
      // Optional: Make horizon receive shadows if shadowGenerator exists
      if (window.gfx && window.gfx.shadowGenerator) {
        window.gfx.shadowGenerator.addShadowCaster(horizon, false);
      }
    }
    
    return mountainGround;
  }
  
  // Create a subtle horizon line/band to show where distant mountains meet sky
  function createHorizon(scene, centerX, centerZ, mountainSize) {
    // console.log('🌅 Creating horizon line for distant vista');
    
    // Create a large thin plane at a height between camera and mountains
    // This creates a visual "line" at the horizon
    const horizonSize = mountainSize * 1.5;
    const horizonPlane = BABYLON.MeshBuilder.CreateGround("horizon", 
      {width: horizonSize, height: horizonSize, subdivisions: 4}, scene);
    
    // Position at a mid-distance - creates the horizon "line" effect
    horizonPlane.position.x = centerX;
    horizonPlane.position.z = centerZ;
    horizonPlane.position.y = -80; // Between camera (9) and mountains (-200)
    
    // Create horizon material - dark solid band
    const horizonMat = new BABYLON.StandardMaterial("horizonMat", scene);
    horizonMat.diffuseColor = new BABYLON.Color3(0.9, 0.89, 0.9); // Dark grey-green like mountains but lighter
    // horizonMat.ambientColor = new BABYLON.Color3(0.23, 0.23, 0.28); // Ambient for depth
    // horizonMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Low shine
    // horizonMat.emissiveColor = new BABYLON.Color3(0.05, 0.06, 0.06); // Subtle glow for visibility
    horizonMat.alpha = 0.2; // Solid, no transparency
    horizonMat.backFaceCulling = false;
    horizonMat.depthWrite = true;
    
    horizonPlane.material = horizonMat;
    horizonPlane.renderingGroupId = 0; // Render with background
    horizonPlane.isPickable = false;
    horizonPlane.isVisible = true; // Make the horizon band visible
    
    // console.log('🌅 Horizon line created - enhances sense of vast distance');
    return horizonPlane;
  }

  // Fix the scene.whenReadyAsync mountain creation with better error handling:
  // console.log('🌄 Creating subtle low-relief mountains');
  if (gfx.scene && typeof BABYLON !== 'undefined') {
    try {
      const fieldDim = window.liveField ? Math.max(window.liveField.width, window.liveField.height) : 64;
      gfx.mountains = createSimpleMountains(gfx.scene, fieldDim);
      if (gfx.mountains) {
        // console.log(`✅ Subtle mountains created successfully for ${fieldDim} field`);
      } else {
        // console.error('❌ Mountain creation returned null');
      }
    } catch (mountainError) {
      // console.error('❌ Mountain creation failed:', mountainError);
    }
  } else {
    // console.error('❌ Scene or Babylon.js not available for mountains');
  }

  // Ensure no lingering createMountainTerrain references - the function should be completely gone
  // If any errors mention createMountainTerrain, the old function definition needs manual removal



})(window.gfx = window.gfx || {});


