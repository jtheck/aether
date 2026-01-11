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
  
  // Antialiasing state
  let fxaaPostProcess = null;
  let currentAALevel = 0; // 0=Off, 1=FXAA, 2=MSAA2x, 3=MSAA4x

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
            // Only call setEnabled on nodes that have it (meshes, not transform nodes)
            result.rootNodes.forEach(n => {
              if (typeof n.setEnabled === 'function') {
                n.setEnabled(false);
              }
            });
            
            // CRITICAL FIX: Walk all descendants and remove TransformNodes from scene.meshes
            // instantiateModelsToScene adds ALL child nodes to scene.meshes, including TransformNodes
            // which don't have isEnabled as a function and crash the renderer
            result.rootNodes.forEach(root => {
              const allDescendants = root.getDescendants(false);
              allDescendants.forEach(node => {
                // If this node is in scene.meshes but doesn't have isEnabled as a FUNCTION, remove it
                if (typeof node.isEnabled !== 'function' && scene.meshes.includes(node)) {
                  const idx = scene.meshes.indexOf(node);
                  scene.meshes.splice(idx, 1);
                  console.warn(`🔧 Removed TransformNode from scene.meshes: ${node.name}`);
                }
              });
            });

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
  const pendingResourceTiles = new Set();  // Tiles currently waiting for a resource model to finish loading
  
  // GPU Instancing for static resources (trees, rocks)
  // Uses Babylon's createInstance() for shared geometry/material = fewer draw calls
  const instanceMasters = new Map(); // path -> { root, meshes: [mesh, mesh, ...] }
  const instancedModels = new Map(); // instance -> { path, instances: [InstancedMesh, ...] }
  const INSTANCED_MODELS = ['trees.glb', 'rocks_plain.glb', 'rocks_moss.glb', 'rocks_snow.glb'];
  
  // Function to clean up models when chunk unloads
  function cleanupChunkModels(chunkKey) {
    const models = activeModels.get(chunkKey);
    if (models) {
      // OPTIMIZATION: Build a Set of model roots to remove for O(1) lookup
      const modelsToRemove = new Set(models.map(m => m.model.root));
      
      // Return models to pool
      models.forEach(modelInfo => {
        unlinkMeshFromResourceRegistry(modelInfo.model?.root);
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
          // Unregister from thin instance system
          if (gfx.unregisterThinInstance) {
            gfx.unregisterThinInstance(lod);
          }
          // Remove by swapping with last element and popping (O(1) removal)
          lodModels[i] = lodModels[lodModels.length - 1];
          lodModels.pop();
        }
      }
      
      // Return billboards to pool after cleanup
      billboardsToReturn.forEach(billboard => returnBillboardInstance(billboard));
      
      activeModels.delete(chunkKey);
      
      // Clear any pending resource placements for this chunk's tiles
      const chunkData = window.liveField?.chunks?.get(chunkKey);
      if (chunkData) {
        for (let x = chunkData.startX; x < chunkData.endX; x++) {
          for (let z = chunkData.startZ; z < chunkData.endZ; z++) {
            pendingResourceTiles.delete(`${x},${z}`);
          }
        }
      }
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
  
  // Billboard-only mode - for low-end devices or large maps in editor
  // When true, never show 3D models, only billboards
  let BILLBOARD_ONLY_MODE = false;
  
  // Expose billboard mode for settings/forge
  gfx.setBillboardOnlyMode = function(enabled) {
    BILLBOARD_ONLY_MODE = enabled;
    // console.log(`🖼️ Billboard-only mode: ${enabled ? 'ON' : 'OFF'}`);

    // Immediately update all existing models - no frame delay
    lodModels.forEach(lod => {
      // Skip disposed meshes
      if (!lod.model || lod.model.isDisposed()) return;
      
      if (enabled) {
        // Billboard mode: ALWAYS hide model, show billboard
        lod.model.setEnabled(false);
        if (lod.billboard) lod.billboard.setEnabled(true);
      } else {
        // Normal mode: temporarily enable model, LOD will correct on next update
        // Don't enable both - just let LOD system handle the transition
        if (lod.billboard) lod.billboard.setEnabled(false);
        lod.model.setEnabled(true);
      }
    });
    
    // Force immediate LOD update on next frame (reset counter to trigger update)
    lodFrameCounter = LOD_UPDATE_INTERVAL;
    
    // For non-billboard mode, force an immediate LOD check to set proper states
    if (!enabled && gfx.camera) {
      const camPos = gfx.cameraTarget ? gfx.cameraTarget.position : gfx.camera.position;
      if (camPos) {
        // Bypass throttle for immediate update
        const savedCounter = lodFrameCounter;
        lodFrameCounter = LOD_UPDATE_INTERVAL;
        updateLOD(camPos);
        lodFrameCounter = savedCounter;
      }
    }
  };
  
  gfx.isBillboardOnlyMode = function() {
    return BILLBOARD_ONLY_MODE;
  };
  
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
    // Check if we should use GPU instancing for this model type
    const useInstance = shouldUseInstancing(modelPath);
    
    if (useInstance) {
      return getOrCreateInstanceMaster(modelPath, scene).then(master => {
        const instancedModel = createInstancedModel(master, position, rotation, scale);
        
        // CRITICAL: Keep model disabled - LOD system will enable it based on distance
        instancedModel.root.setEnabled(false);
        
        // Mark as instanced for proper cleanup
        instancedModel.isInstanced = true;
        instancedModel.masterPath = modelPath;
        
        // Track instance counts per model type
        if (!window._instanceCounts) window._instanceCounts = {};
        window._instanceCounts[modelPath] = (window._instanceCounts[modelPath] || 0) + 1;
        
        return instancedModel;
      });
    }
    
    // Original pooling logic for non-instanced models
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
    // Handle instanced models - just dispose them (they're cheap to recreate)
    if (model.isInstanced) {
      disposeInstancedModel(model);
      return;
    }
    
    // Original pooling logic for non-instanced models
    model.root.setEnabled(false);
    model.root.parent = null; // Unparent it
    
    if (!modelPools.has(modelPath)) {
      modelPools.set(modelPath, []);
    }
    
    modelPools.get(modelPath).push(model);
  }
  
  // Check if a model path should use GPU instancing
  function shouldUseInstancing(modelPath) {
    // Only use instancing when NOT using full shadows (shadow mapping doesn't work well with instances)
    if (window.SHADOW_MODE === 3) return false;
    const shouldInstance = INSTANCED_MODELS.some(name => modelPath.includes(name));
    return shouldInstance;
  }
  
  // Pending master creation Promises (to prevent race conditions)
  const pendingMasters = new Map();
  
  // Get or create a master mesh for instancing
  function getOrCreateInstanceMaster(modelPath, scene) {
    // Already have a master? Return it immediately
    if (instanceMasters.has(modelPath)) {
      return Promise.resolve(instanceMasters.get(modelPath));
    }
    
    // Already loading a master? Wait for that same Promise (prevents race conditions)
    if (pendingMasters.has(modelPath)) {
      return pendingMasters.get(modelPath);
    }
    
    // We're the first to request this model - create the master
    console.log('[Instancing] Creating master for:', modelPath);
    
    const loadPromise = getModel(modelPath, scene).then(model => {
      // Find all meshes with geometry in the hierarchy
      const meshes = [];
      if (model.root.getChildMeshes) {
        model.root.getChildMeshes().forEach(mesh => {
          if (mesh.getTotalVertices && mesh.getTotalVertices() > 0) {
            meshes.push(mesh);
          }
        });
      }
      
      // Position master far away (instances will have their own positions)
      model.root.position.set(0, -1000, 0);
      model.root.setEnabled(true); // Master must be enabled for instances to render
      
      const master = {
        root: model.root,
        meshes: meshes,
        model: model
      };
      
      instanceMasters.set(modelPath, master);
      pendingMasters.delete(modelPath);
      console.log('[Instancing] Master ready:', modelPath, 'with', meshes.length, 'meshes');
      
      return master;
    });
    
    // Store IMMEDIATELY - before returning, so parallel synchronous calls will see it
    pendingMasters.set(modelPath, loadPromise);
    
    return loadPromise;
  }
  
  // Create an instanced copy of a master mesh
  function createInstancedModel(master, position, rotation, scale) {
    const instances = [];
    
    // Create a container TransformNode to hold all instances
    const container = new BABYLON.TransformNode(`instContainer_${Date.now()}`, gfx.scene);
    
    // Get the master root's world matrix inverse to compute relative transforms
    // This accounts for the master being positioned at (0, -1000, 0)
    const masterRoot = master.root;
    masterRoot.computeWorldMatrix(true);
    const masterWorldMatrixInverse = masterRoot.getWorldMatrix().clone().invert();
    
    // Create instance for each mesh in the master
    // CRITICAL: Compute FULL transform relative to master root (accounts for hierarchy)
    master.meshes.forEach((mesh, index) => {
      const instance = mesh.createInstance(`inst_${mesh.name}_${Date.now()}_${index}`);
      instance.isPickable = false;
      
      // Compute mesh's world matrix relative to the master root
      // This captures ALL parent transforms in the hierarchy
      mesh.computeWorldMatrix(true);
      const meshWorldMatrix = mesh.getWorldMatrix();
      const relativeMatrix = meshWorldMatrix.multiply(masterWorldMatrixInverse);
      
      // Decompose to get position, rotation, scale relative to master root
      const relativePos = new BABYLON.Vector3();
      const relativeRot = new BABYLON.Quaternion();
      const relativeScale = new BABYLON.Vector3();
      relativeMatrix.decompose(relativeScale, relativeRot, relativePos);
      
      // Apply the relative transform to the instance
      instance.position.copyFrom(relativePos);
      instance.rotationQuaternion = relativeRot;
      instance.scaling.copyFrom(relativeScale);
      
      instance.parent = container;
      instances.push(instance);
    });
    
    // Set container transform - this applies to all child instances
    container.position.copyFrom(position);
    container.rotationQuaternion = null;
    container.rotation.y = rotation;
    container.scaling.set(scale, scale, scale);
    
    return {
      root: container,
      instances: instances,
      masterPath: master.root.name
    };
  }
  
  // Debug: log instancing stats
  window.logInstanceStats = function() {
    console.log('[Instancing] Mode:', window.SHADOW_MODE < 3 ? 'INSTANCED' : 'CLONED');
    console.log('[Instancing] Masters:', instanceMasters.size);
    instanceMasters.forEach((master, path) => {
      const instanceCount = window._instanceCounts?.[path] || 0;
      // Check actual Babylon instance count on the master meshes
      let actualInstances = 0;
      master.meshes.forEach(mesh => {
        if (mesh.instances) {
          actualInstances += mesh.instances.length;
        }
      });
      console.log(`  ${path}: tracked=${instanceCount}, actual=${actualInstances}`);
    });
    console.log('[Instancing] Total tracked:', Object.values(window._instanceCounts || {}).reduce((a,b) => a+b, 0));
    
    // Count all instanced meshes in scene (use isAnInstance property)
    let totalInstancedMeshes = 0;
    let masterMeshesWithInstances = 0;
    gfx.scene.meshes.forEach(mesh => {
      if (mesh.isAnInstance) {
        totalInstancedMeshes++;
      }
      if (mesh.instances && mesh.instances.length > 0) {
        masterMeshesWithInstances++;
      }
    });
    console.log('[Instancing] Instanced meshes (isAnInstance):', totalInstancedMeshes);
    console.log('[Instancing] Master meshes with instances:', masterMeshesWithInstances);
    
    // Draw call estimate - instances share draw calls with their master
    const regularMeshes = gfx.scene.meshes.filter(m => m.isEnabled() && m.isVisible && m.getTotalVertices && m.getTotalVertices() > 0 && !m.isAnInstance).length;
    console.log('[Instancing] Non-instanced enabled meshes:', regularMeshes);
    console.log('[Instancing] Estimated draw calls:', regularMeshes + masterMeshesWithInstances, '(masters batch their instances)');
  };
  
  // Reload all resource models (used when switching between instanced and shadow modes)
  gfx.reloadResourceModels = function() {
    console.log('[Instancing] Reloading all resource models...');
    
    // Clear instance tracking
    window._instanceCounts = {};
    
    // FIRST: Dispose ALL InstancedMesh objects in the scene (they reference the masters)
    const instancesToDispose = gfx.scene.meshes.filter(m => m.isAnInstance);
    console.log('[Instancing] Disposing', instancesToDispose.length, 'instanced meshes...');
    instancesToDispose.forEach(inst => {
      if (!inst.isDisposed()) {
        inst.dispose();
      }
    });
    
    // Dispose all instance masters (after their instances are gone)
    instanceMasters.forEach((master, path) => {
      // Dispose each mesh in the master (source meshes for instances)
      if (master.meshes) {
        master.meshes.forEach(mesh => {
          if (mesh && !mesh.isDisposed()) {
            mesh.dispose();
          }
        });
      }
      // Dispose the root
      if (master.root && !master.root.isDisposed()) {
        master.root.dispose();
      }
    });
    instanceMasters.clear();
    pendingMasters.clear();
    
    // Clear model pools for resource types
    INSTANCED_MODELS.forEach(modelName => {
      modelPools.forEach((pool, path) => {
        if (path.includes(modelName)) {
          pool.forEach(model => {
            if (model.dispose) model.dispose();
            else if (model.root && model.root.dispose) model.root.dispose();
          });
          modelPools.delete(path);
        }
      });
    });
    
    // Dispose all resource models from active chunks and LOD system
    const resourcesToReload = [];
    
    // Collect info about models to reload from LOD system
    lodModels.forEach(lod => {
      if (lod.modelPath && INSTANCED_MODELS.some(name => lod.modelPath.includes(name))) {
        resourcesToReload.push({
          position: lod.model.getAbsolutePosition().clone(),
          rotation: lod.originalRotation || 0,
          scale: lod.originalScale || 1,
          modelPath: lod.modelPath,
          modelRule: lod.modelRule,
          chunkKey: lod.chunkKey
        });
        
        // Dispose container and its children (including any instances)
        if (lod.model) {
          lod.model.getChildMeshes().forEach(child => {
            if (!child.isDisposed()) child.dispose();
          });
          if (!lod.model.isDisposed()) lod.model.dispose();
        }
        if (lod.billboard && !lod.billboard.isDisposed()) {
          lod.billboard.dispose();
        }
      }
    });
    
    // Remove disposed models from LOD system
    for (let i = lodModels.length - 1; i >= 0; i--) {
      if (lodModels[i].modelPath && INSTANCED_MODELS.some(name => lodModels[i].modelPath.includes(name))) {
        lodModels.splice(i, 1);
      }
    }
    
    // Clear from activeModels
    activeModels.forEach((models, chunkKey) => {
      for (let i = models.length - 1; i >= 0; i--) {
        if (models[i].path && INSTANCED_MODELS.some(name => models[i].path.includes(name))) {
          models.splice(i, 1);
        }
      }
    });
    
    console.log(`[Instancing] Cleared ${resourcesToReload.length} resource models, reloading...`);
    
    // Reload all resources with new mode
    resourcesToReload.forEach(info => {
      getPooledModel(info.modelPath, gfx.scene, info.position, info.rotation, info.scale)
        .then(model => {
          model.root.setEnabled(false); // Start disabled for LOD
          
          // Re-add to LOD system
          addLODBillboard(model, gfx.scene, info.modelRule || { path: info.modelPath }, gfx.camera.position, info.chunkKey);
          
          // Set up shadows if in full mode
          if (window.SHADOW_MODE === 3 && window.gfx.setupMeshShadows) {
            window.gfx.setupMeshShadows(model.root);
          }
        })
        .catch(err => console.warn('Failed to reload resource:', err));
    });
    
    // Force LOD update
    setTimeout(() => {
      updateLOD(gfx.camera.position);
      console.log('[Instancing] Resource reload complete');
    }, 500);
  };
  
  // Dispose an instanced model
  function disposeInstancedModel(instancedModel) {
    if (instancedModel.instances) {
      instancedModel.instances.forEach(inst => {
        if (inst && !inst.isDisposed()) {
          inst.dispose();
        }
      });
    }
    if (instancedModel.root && !instancedModel.root.isDisposed()) {
      instancedModel.root.dispose();
    }
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
    // Determine decoration type from model path
    let decorType = 'decoration';
    if (modelPath.includes('tree')) decorType = 'tree';
    else if (modelPath.includes('rock')) decorType = 'rock';
    
    // Read rotation from model - it should already be set by getPooledModel
    const storedRotation = model.root.rotation ? model.root.rotation.y : 0;
    const storedScale = model.root.scaling ? Math.abs(model.root.scaling.x) : 1;
    
    const lodEntry = {
      model: model.root,
      billboard: billboard,
      lodType: lodType,
      decorType: decorType, // 'tree', 'rock', or 'decoration'
      modelPath: modelPath,
      modelRule: modelRule, // Store for reload
      lodDistance: customLodDistance,
      cullDistance: modelRule.cullDistance || customLodDistance * 2,
      // Store original values for LOD scaling
      originalLodDistance: customLodDistance,
      originalCullDistance: modelRule.cullDistance || customLodDistance * 2,
      chunkKey: chunkKey, // For chunk-based LOD grouping
      isStatic: !!chunkKey, // Static scenery if it has a chunk
      // Store rotation for deterministic reload
      originalRotation: storedRotation,
      originalScale: storedScale
    };
    lodModels.push(lodEntry);
    
    // Create blob shadow for decoration models (trees, rocks, etc)
    // Check current shadow mode - modes 1 and 2 use blob shadows
    const shouldHaveBlobShadow = chunkKey && (window.SHADOW_MODE === 1 || window.SHADOW_MODE === 2);
    if (shouldHaveBlobShadow) {
      const decorObj = {
        type: decorType,
        name: decorType,
        mesh: model.root,
        modelPath: modelPath
      };
      gfx.createBlobShadow(decorObj);
      gfx.updateBlobShadow(decorObj); // Set initial position
      lodEntry.blobShadowObj = decorObj; // Track for cleanup
    }
    
    // Register for thin instancing if in non-shadow mode
    if (chunkKey && gfx.registerThinInstance) {
      gfx.registerThinInstance(lodEntry, model.root, modelPath);
    }
    
    // Apply current LOD multiplier to new model if LOD system is active
    const lastLod = lodModels[lodModels.length - 1];
    if (window.hud && window.hud.getCurrentLODMultiplier) {
      const TILE_SIZE = window.TILE_SIZE || 4;
      const CHUNK_WORLD_SIZE = 16 * TILE_SIZE; // 64 world units per chunk
      
      let currentMultiplier;
      
      // During loading, use minimum LOD (0.3x multiplier)
      if (loadingLODActive && !loadingComplete) {
        currentMultiplier = 0.3; // Minimum LOD during loading
      } else {
        currentMultiplier = window.hud.getCurrentLODMultiplier();
      }
      
      // Calculate terrain distance cap
      const loadDistance = window.liveField?.currentLoadDistance || 6;
      const terrainWorldDistance = loadDistance * CHUNK_WORLD_SIZE;
      const resourceCullCap = terrainWorldDistance * 0.7; // Match updateLODDistances
      const resourceLodCap = resourceCullCap * 0.5;
      
      // Scale distances by multiplier, then cap to terrain bounds
      const scaledLodDistance = lastLod.originalLodDistance * currentMultiplier;
      const scaledCullDistance = lastLod.originalCullDistance * currentMultiplier;
      
      lastLod.lodDistance = Math.min(scaledLodDistance, resourceLodCap);
      lastLod.cullDistance = Math.min(scaledCullDistance, resourceCullCap);
    }
    
    // CRITICAL: Immediately evaluate and set correct initial state
    // This prevents any flash of full detail at far distances
    
    // PRIORITY 1: Billboard-only mode - ALWAYS show billboard, NEVER show model
    if (BILLBOARD_ONLY_MODE) {
      model.root.setEnabled(false);
      billboard.setEnabled(true);
      return; // Skip all distance calculations
    }
    
    // PRIORITY 2: Distance-based LOD (only when NOT in billboard-only mode)
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
  const LOD_UPDATE_INTERVAL = 5; // Only update every 5th frame (~80% CPU savings!) - Still feels instant at 60fps

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
      
      // SKIP disposed meshes (they've been removed from the scene)
      if (!lod.model || lod.model.isDisposed()) {
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
      
      // Skip thin-instance-managed models - they're rendered via thin instances
      if (lod._thinInstanceManaged) {
        lod.model.setEnabled(false);
        if (lod.billboard) {
          lod.billboard.setEnabled(false);
        }
        return; // Skip normal LOD processing
      }
      
      if (distanceSquared > cullDistanceSquared) {
        // Very far away - completely cull everything for performance
        lod.model.setEnabled(false);
        if (lod.billboard) {
          lod.billboard.setEnabled(false);
        }
        
      } else if (BILLBOARD_ONLY_MODE) {
        // Billboard-only mode - never show 3D models, always billboards
        lod.model.setEnabled(false);
        if (lod.billboard) {
          lod.billboard.setEnabled(true);
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
    // CRITICAL: Always use window.liveField to get the current field reference
    // (the global liveField variable may not be updated when a new match starts)
    const field = window.liveField;
    if (!field) return;
    
    // console.log(`🗺️ Force-loading chunks around (${x.toFixed(1)}, ${z.toFixed(1)})`);
    
    // Clear the chunk queue AND model queue to prioritize immediate loading
    chunkQueue.length = 0;
    modelLoadQueue.length = 0;
    
    // Update visible chunks (marks them as needsMesh)
    field.updateVisibleChunks(x, z);
    
    // Calculate player chunk position for distance sorting
    const playerChunkX = Math.floor(x / (field.chunkSize * TILE_SIZE));
    const playerChunkZ = Math.floor(z / (field.chunkSize * TILE_SIZE));
    
    // Sort chunks by distance from player (closest first)
    const chunksToLoad = [];
    for (const [key, chunk] of field.chunks) {
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
        field.createChunkMesh(item.chunkX, item.chunkZ, gfx.scene, createTerrainMesh);
        meshesLoaded++;
        // Mark that models need to be placed now that mesh exists (skip in forge mode)
        if (!window.isForgeMode) {
          item.chunk.needsModels = true;
        }
      }
      
      // Queue models (they'll be placed in queue) - skip in forge mode
      if (!window.isForgeMode && item.chunk.needsModels && item.chunk.mesh) {
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
          
          // Make resource models (rocks and trees) pickable for click commands
          const isResourceModel = task.modelPath.includes('rock') || task.modelPath.includes('tree');
          model.root.isPickable = isResourceModel;
          model.root.getChildMeshes().forEach(mesh => {
            mesh.isPickable = isResourceModel;
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
    
    // CRITICAL: Dispose BOTH billboards AND models completely
    // Just disabling them isn't enough - they remain in the scene and can be re-enabled
    lodModels.forEach(lod => {
      // Dispose billboard
      if (lod.billboard && lod.billboard.dispose) {
        lod.billboard.dispose();
      }
      // Dispose the actual model mesh
      if (lod.model && lod.model.dispose) {
        lod.model.dispose();
      }
      // Clean up blob shadow if exists
      if (lod.blobShadowObj) {
        gfx.removeBlobShadow(lod.blobShadowObj);
      }
    });
    
    // Clear the LOD tracking array
    lodModels.length = 0;
    
    // CRITICAL: Clear activeModels - these track which models belong to which chunks
    // Without clearing this, old chunk references persist and cause ghost models
    activeModels.forEach((models, chunkKey) => {
      models.forEach(modelInfo => {
        if (modelInfo.model && modelInfo.model.root && modelInfo.model.root.dispose) {
          modelInfo.model.root.dispose();
        }
      });
    });
    activeModels.clear();
    
    // Clear all model pools - we need a fresh start, not recycled menu models
    modelPools.forEach((pool, path) => {
      pool.forEach(model => {
        if (model && model.root && model.root.dispose) {
          model.root.dispose();
        }
      });
    });
    modelPools.clear();
    
    // CRITICAL: Clear instance masters for fresh instancing in new match
    instanceMasters.forEach((master, path) => {
      if (master.root && !master.root.isDisposed()) {
        master.root.dispose();
      }
    });
    instanceMasters.clear();
    pendingMasters.clear();
    window._instanceCounts = {};
    
    // Clear billboard instances
    billboardInstances.forEach(instance => {
      if (instance && instance.dispose) {
        instance.dispose();
      }
    });
    billboardInstances.length = 0;
    billboardInstancedMeshes.clear();
    
    // CRITICAL: Clear shadow generator render list for fresh start
    if (gfx.shadowGenerator) {
      const renderList = gfx.shadowGenerator.getShadowMap().renderList;
      renderList.length = 0; // Clear all shadow casters
      
      // Force shadow map to refresh (clears any cached shadow data)
      gfx.shadowGenerator.getShadowMap().refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      setTimeout(() => {
        if (gfx.shadowGenerator && gfx.shadowGenerator.getShadowMap()) {
          gfx.shadowGenerator.getShadowMap().refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
        }
      }, 100);
    }
    
    // CRITICAL: Clear blob shadow tracking for fresh start
    if (gfx.clearAllBlobShadows) {
      gfx.clearAllBlobShadows();
    }
    
    // CRITICAL: Reset all LOD system flags to ensure clean state
    // BUT preserve loadingLODCurrent - menu calibration should carry over!
    skipLODUpdates = false;
    loadingLODActive = false;
    loadingComplete = false;
    // loadingLODCurrent = 0; // DON'T RESET - preserve menu LOD setting!
    isProcessingQueue = false;
    
    // Clear any pending model loads and chunk queue
    modelLoadQueue.length = 0;
    chunkQueue.length = 0;
    
    // console.log(`✅ LOD system fully reset - all models disposed`);
    
    // Re-apply shadow mode from saved preference after a delay
    // This ensures new models get the correct shadow treatment
    setTimeout(() => {
      if (window.hud && window.hud.updateShadowMode && window.SHADOW_MODE !== undefined) {
        window.hud.updateShadowMode(window.SHADOW_MODE);
      }
    }, 500);
  };

  // Update LOD distances for graphics system
  gfx.updateLODDistances = function(multiplier) {
    const TILE_SIZE = window.TILE_SIZE || 4;
    const CHUNK_SIZE = 16; // tiles per chunk
    const CHUNK_WORLD_SIZE = CHUNK_SIZE * TILE_SIZE; // 64 world units per chunk
    
    // Update terrain chunk loading distance FIRST so we know the terrain bounds
    let terrainWorldDistance = 6 * CHUNK_WORLD_SIZE; // Default 384 units (increased for bigger ground-only zone)
    if (window.liveField && window.liveField.updateVisibleChunks) {
      // Store the original load distance if not already stored
      if (!window.liveField.originalLoadDistance) {
        window.liveField.originalLoadDistance = 6; // Base load distance (increased from 4)
      }
      
      // Update load distance based on LOD level
      const newLoadDistance = Math.round(window.liveField.originalLoadDistance * multiplier);
      window.liveField.currentLoadDistance = Math.max(3, Math.min(12, newLoadDistance)); // Clamp between 3-12 (increased range)
      terrainWorldDistance = window.liveField.currentLoadDistance * CHUNK_WORLD_SIZE;
    }
    
    // Resource cull should end BEFORE terrain to create a "ground only" zone at edges
    // This gives a nice fade-out effect where you see ground extending beyond resources
    const resourceCullCap = terrainWorldDistance * 0.7; // Resources fade out at 70% of terrain distance
    const resourceLodCap = resourceCullCap * 0.5; // Switch to billboards at 50% of cull distance
    
    // Update model LOD distances
    if (lodModels) {
      lodModels.forEach(lod => {
        // Scale LOD distances based on multiplier
        const scaledLodDistance = (lod.originalLodDistance || lod.lodDistance) * multiplier;
        const scaledCullDistance = (lod.originalCullDistance || lod.cullDistance || lod.lodDistance * 2) * multiplier;
        
        // Cap to terrain bounds to ensure resources never extend beyond ground
        lod.lodDistance = Math.min(scaledLodDistance, resourceLodCap);
        lod.cullDistance = Math.min(scaledCullDistance, resourceCullCap);
      });
      
      // console.log(`🎚️ Updated LOD distances for ${lodModels.length} models (terrain=${terrainWorldDistance}, resourceCap=${resourceCullCap.toFixed(0)})`);
    }
    
    // Update shadow quality based on LOD level - use centralized reconfigure
    // Convert multiplier (0.3-1.7) back to LOD percentage (0-100)
    // Formula was: multiplier = 0.3 + (level / 100) * 1.4
    // Inverse: level = (multiplier - 0.3) / 1.4 * 100
    if (gfx.shadowGenerator && window.SHADOWS_ENABLED) {
      const lodLevel = Math.round(((multiplier - 0.3) / 1.4) * 100);
      if (gfx.reconfigureShadowGenerator) {
        gfx.reconfigureShadowGenerator(lodLevel);
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
      const isResourceTask = (task.modelPath.includes('trees.glb') || task.modelPath.includes('rocks_')) &&
        task.gridX !== undefined && task.gridZ !== undefined;
      const resourceKey = isResourceTask ? `${task.gridX},${task.gridZ}` : null;
      
      getPooledModel(task.modelPath, task.scene, task.position, task.rotation, task.scale)
        .then(model => {
          // Set up shadows for the model
          if (window.gfx && window.gfx.setupMeshShadows) {
            window.gfx.setupMeshShadows(model.root);
          }
          
          // Register resource models for depletion system (trees and rocks only)
          if (resourceKey) {
            resourceModelRegistry.set(resourceKey, model.root);
            pendingResourceTiles.delete(resourceKey);
            model.root.metadata = model.root.metadata || {};
            model.root.metadata.resourceTileKey = resourceKey;
            model.root.metadata.modelPath = task.modelPath; // Store model path for respawn detection
            
            // PERFORMANCE: Freeze resource meshes since they're static until depleted
            // This is a huge win - resources never move/rotate/scale until harvested
            if (model.root.freezeWorldMatrix) {
              model.root.freezeWorldMatrix();
              model.root.metadata.isFrozen = true;
            }
            // Also freeze child meshes
            model.root.getChildMeshes && model.root.getChildMeshes().forEach(childMesh => {
              if (childMesh.freezeWorldMatrix) {
                childMesh.freezeWorldMatrix();
              }
            });
          }
          
          // All the same model setup logic
          task.models.push(model);
          model.root.parent = task.chunk.mesh;
          
          // Start model hidden - LOD will determine visibility
          // But in forge mode, show immediately (unless billboard-only mode)
          if (ENABLE_FORGE) {
            const showModel = !BILLBOARD_ONLY_MODE;
            model.root.setEnabled(showModel);
            model.root.getChildMeshes().forEach(m => m.setEnabled(showModel));
          } else {
            model.root.setEnabled(false);
          }
          
          const chunkKey = `${task.chunk.chunkX},${task.chunk.chunkZ}`;
          if (!activeModels.has(chunkKey)) {
            activeModels.set(chunkKey, []);
          }
          activeModels.get(chunkKey).push({
            model: model,
            path: task.modelPath
          });
          
          // Make resource models (rocks and trees) pickable for click commands
          const isResourceModel = task.modelPath.includes('rock') || task.modelPath.includes('tree');
          model.root.isPickable = isResourceModel;
          model.root.getChildMeshes().forEach(mesh => {
            mesh.isPickable = isResourceModel;
            
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
          // In forge mode, still create billboard (needed for billboard-only mode)
          addLODBillboard(model, task.scene, task.modelRule, gfx.cameraTarget ? gfx.cameraTarget.position : null, chunkKey);
          
          // In forge mode with billboard-only, show billboard immediately
          if (ENABLE_FORGE && BILLBOARD_ONLY_MODE) {
            const lodEntry = lodModels.find(l => l.model === model.root);
            if (lodEntry && lodEntry.billboard) {
              lodEntry.billboard.setEnabled(true);
            }
          }
        })
        .catch(err => {
          console.warn('Model loading failed:', err);
          if (resourceKey) {
            pendingResourceTiles.delete(resourceKey);
          }
        });
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
      
      // Calculate world position for this tile (centered on tile)
      const worldX = (chunk.startX + localX + 0.5) * TILE_SIZE;
      const worldZ = (chunk.startZ + localZ + 0.5) * TILE_SIZE;
      
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

  // Global registry of resource models by grid position for depletion system
  const resourceModelRegistry = new Map(); // key: "gridX,gridZ", value: mesh
  
  // Global registry of depleted resource tiles (prevents chunks from recreating them)
  // Map stores: "gridX,gridZ" -> { originalGridX, originalGridZ, felledTime, isTree }
  const depletedResourceTiles = new Map(); // Map of "gridX,gridZ" strings to depletion info
  
  // Function to check if a tile has been depleted
  window.isResourceTileDepleted = function(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    return depletedResourceTiles.has(key);
  };
  
  // Function to mark a tile as depleted (for loading custom maps with erased resources)
  window.markResourceTileDepleted = function(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    depletedResourceTiles.set(key, {
      originalGridX: gridX,
      originalGridZ: gridZ,
      felledTime: Date.now(),
      isTree: true  // Assume tree for map-erased resources
    });
  };
  
  // Function to place a manual resource at a position (for loading custom maps)
  // resourceType: 'trees', 'rocks_plain', 'rocks_moss', 'rocks_snow'
  window.placeManualResource = function(gridX, gridZ, resourceType) {
    const field = window.liveField;
    if (!field || !gfx.scene) return;
    
    const resourcePaths = {
      trees: { path: 'assets/models/trees.glb', scale: 0.9 },
      rocks_plain: { path: 'assets/models/rocks_plain.glb', scale: 3.0 },
      rocks_moss: { path: 'assets/models/rocks_moss.glb', scale: 7.5 },
      rocks_snow: { path: 'assets/models/rocks_snow.glb', scale: 11.5 }
    };
    
    const resInfo = resourcePaths[resourceType];
    if (!resInfo) return;
    
    const worldX = (gridX + 0.5) * TILE_SIZE;
    const worldZ = (gridZ + 0.5) * TILE_SIZE;
    const worldY = field.getHeightVariation ? field.getHeightVariation(gridX, gridZ) : 0;
    
    // Queue the model for loading
    initBillboardAtlas(gfx.scene);
    modelLoadQueue.push({
      modelPath: resInfo.path,
      scene: gfx.scene,
      position: new Vec3(worldX, worldY, worldZ),
      rotation: Math.random() * Math.PI * 2,
      scale: resInfo.scale,
      chunk: null,  // Not associated with a chunk
      models: [],
      modelRule: resInfo,
      gridX: gridX,
      gridZ: gridZ
    });
    
    // Start processing queue if not running
    if (!isProcessingQueue && modelLoadQueue.length > 0) {
      requestAnimationFrame(processModelQueue);
    }
  };
  
  // Function to get respawn position for a depleted tree (further from camp)
  function getRespawnPosition(originalGridX, originalGridZ) {
    if (!window.gameBuildings) return null;
    
    const originalWorldX = originalGridX * TILE_SIZE;
    const originalWorldZ = originalGridZ * TILE_SIZE;
    
    // Find nearest camp
    let nearestCamp = null;
    let nearestDistSq = Infinity;
    for (const building of window.gameBuildings) {
      if (building.type === 'camp' && building.position) {
        const dx = originalWorldX - building.position.x;
        const dz = originalWorldZ - building.position.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestCamp = building;
        }
      }
    }
    
    if (!nearestCamp) return null; // No camp found, can't calculate offset
    
    // Calculate direction away from camp
    const campDx = originalWorldX - nearestCamp.position.x;
    const campDz = originalWorldZ - nearestCamp.position.z;
    const campDist = Math.sqrt(campDx * campDx + campDz * campDz);
    
    if (campDist < 0.1) return null; // Too close to camp center
    
    // Normalize direction
    const dirX = campDx / campDist;
    const dirZ = campDz / campDist;
    
    // Move 2-3 tiles further from camp (deterministic based on position)
    const field = window.liveField;
    const fieldSeed = field ? field.seed : 12345;
    let hash = fieldSeed + originalGridX * 13579 + originalGridZ * 24680;
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const offsetFactor = 2 + ((hash % 1000) / 1000); // 2-3 tiles (deterministic)
    const offsetDistance = offsetFactor * TILE_SIZE;
    const newWorldX = originalWorldX + dirX * offsetDistance;
    const newWorldZ = originalWorldZ + dirZ * offsetDistance;
    
    // Convert back to grid coordinates
    const newGridX = Math.round(newWorldX / TILE_SIZE);
    const newGridZ = Math.round(newWorldZ / TILE_SIZE);
    
    // Bounds check (field already declared above)
    if (!field || newGridX < 0 || newGridX >= field.width || newGridZ < 0 || newGridZ >= field.height) {
      return null;
    }
    
    // CRITICAL: Check chunk mask for custom map shapes - don't respawn trees in disabled chunks (off the table)
    if (field.chunkMask && field.chunkSize) {
      const chunkX = Math.floor(newGridX / field.chunkSize);
      const chunkZ = Math.floor(newGridZ / field.chunkSize);
      if (field.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
        return null; // Respawn position is in a disabled chunk (off the table)
      }
    }
    
    // Return centered world positions for consistency with other resource placement
    return { gridX: newGridX, gridZ: newGridZ, worldX: (newGridX + 0.5) * TILE_SIZE, worldZ: (newGridZ + 0.5) * TILE_SIZE };
  }
  
  // DEBUG: Manual command to remove nearest tree to camera
  window.debugRemoveNearestTree = function() {
    if (!gfx.cameraTarget || !gfx.cameraTarget.position) {
      console.log('❌ No camera found');
      return;
    }
    
    const camPos = gfx.cameraTarget.position;
    let nearestTree = null;
    let nearestDist = Infinity;
    
    // Find nearest tree in registry
    for (const [key, mesh] of resourceModelRegistry.entries()) {
      const pos = mesh.getAbsolutePosition();
      const dx = pos.x - camPos.x;
      const dz = pos.z - camPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestTree = { key, mesh, pos };
      }
    }
    
    if (nearestTree) {
      const [gridX, gridZ] = nearestTree.key.split(',').map(Number);
      console.log(`🎯 Removing nearest tree at grid(${gridX},${gridZ}), world(${nearestTree.pos.x.toFixed(1)},${nearestTree.pos.z.toFixed(1)}), distance: ${nearestDist.toFixed(1)} units`);
      window.removeResourceModel(gridX, gridZ);
    } else {
      console.log('❌ No trees found in registry');
    }
  };
  
  function removeModelFromLOD(modelRoot) {
    if (!modelRoot) return;
    for (let i = lodModels.length - 1; i >= 0; i--) {
      const lod = lodModels[i];
      if (lod.model === modelRoot) {
        if (lod.billboard) {
          lod.billboard.setEnabled(false);
          returnBillboardInstance(lod.billboard);
        }
        // Clean up blob shadow if it exists
        if (lod.blobShadowObj) {
          gfx.removeBlobShadow(lod.blobShadowObj);
        }
        lodModels[i] = lodModels[lodModels.length - 1];
        lodModels.pop();
        break;
      }
    }
  }
  
  function unlinkMeshFromResourceRegistry(mesh) {
    if (!mesh) return;
    const metaKey = mesh.metadata?.resourceTileKey;
    if (metaKey && resourceModelRegistry.get(metaKey) === mesh) {
      resourceModelRegistry.delete(metaKey);
      pendingResourceTiles.delete(metaKey);
    } else {
      for (const [key, value] of resourceModelRegistry.entries()) {
        if (value === mesh) {
          resourceModelRegistry.delete(key);
          pendingResourceTiles.delete(key);
          break;
        }
      }
    }
    if (mesh.metadata && mesh.metadata.resourceTileKey) {
      delete mesh.metadata.resourceTileKey;
    }
  }
  
  function cleanupDuplicateResourceMeshes(gridX, gridZ, primaryMesh = null) {
    let removedCount = 0;
    for (const [chunkKey, models] of activeModels.entries()) {
      for (let i = models.length - 1; i >= 0; i--) {
        const modelInfo = models[i];
        if (!modelInfo.model || !modelInfo.model.root) continue;
        const root = modelInfo.model.root;
        if (primaryMesh && root === primaryMesh) continue;
        
        const modelPos = root.getAbsolutePosition();
        const modelGridX = Math.round(modelPos.x / TILE_SIZE);
        const modelGridZ = Math.round(modelPos.z / TILE_SIZE);
        
        if (modelGridX === gridX && modelGridZ === gridZ) {
          removeModelFromLOD(root);
          unlinkMeshFromResourceRegistry(root);
          returnModelToPool(modelInfo.model, modelInfo.path);
          models.splice(i, 1);
          removedCount++;
        }
      }
      
      if (models.length === 0) {
        activeModels.delete(chunkKey);
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 Removed ${removedCount} stray resource models at (${gridX}, ${gridZ})`);
    }
  }
  
  // Function to remove a resource model when depleted
  window.removeResourceModel = function(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    let mesh = resourceModelRegistry.get(key);
    
    // If not found in registry, search through activeModels to find it
    if (!mesh) {
      // Search through all chunks to find the model at this grid position
      for (const [chunkKey, models] of activeModels.entries()) {
        for (const modelInfo of models) {
          if (modelInfo.model && modelInfo.model.root) {
            // Check if it's a tree or rock model first
            if (modelInfo.path && (modelInfo.path.includes('trees.glb') || modelInfo.path.includes('rocks_'))) {
              // Use WORLD position, not local position (mesh is parented to chunk)
              const modelPos = modelInfo.model.root.getAbsolutePosition();
              const modelGridX = Math.round(modelPos.x / TILE_SIZE);
              const modelGridZ = Math.round(modelPos.z / TILE_SIZE);
              
              // Check if this model is at the target grid position
              if (modelGridX === gridX && modelGridZ === gridZ) {
                mesh = modelInfo.model.root;
                // Register it for future lookups
                resourceModelRegistry.set(key, mesh);
                break;
              }
            }
          }
        }
        if (mesh) break;
      }
    }
    
    if (mesh) {
      // PERFORMANCE: Unfreeze mesh before animating it
      // Frozen meshes can't be animated, so we need to unfreeze before the sink animation
      if (mesh.metadata && mesh.metadata.isFrozen && mesh.unfreezeWorldMatrix) {
        mesh.unfreezeWorldMatrix();
        mesh.metadata.isFrozen = false;
        // Also unfreeze child meshes
        mesh.getChildMeshes && mesh.getChildMeshes().forEach(childMesh => {
          if (childMesh.unfreezeWorldMatrix) {
            childMesh.unfreezeWorldMatrix();
          }
        });
      }
      
      // Remove the billboard from LOD system if it exists
      removeModelFromLOD(mesh);
      
      // Remove from activeModels tracking
      for (const [chunkKey, models] of activeModels.entries()) {
        for (let i = models.length - 1; i >= 0; i--) {
          if (models[i].model && models[i].model.root === mesh) {
            models.splice(i, 1);
            break;
          }
        }
        if (models.length === 0) {
          activeModels.delete(chunkKey);
        }
      }
      
      // Smooth animation - sink the tree into the ground
      const startY = mesh.position.y;
      const targetY = startY - 8; // Sink 8 units down
      const duration = 1000; // 1 second
      const startTime = Date.now();
      
      const animateSink = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease in - accelerate as it falls
        const easeIn = progress * progress;
        
        // Update Y position only
        mesh.position.y = startY + (targetY - startY) * easeIn;
        
        if (progress < 1) {
          requestAnimationFrame(animateSink);
           } else {
             // Animation done - disable it completely
             mesh.setEnabled(false);
             // Also disable all child meshes to ensure no visual remnants
             mesh.getChildren().forEach(child => {
               if (child.setEnabled) {
                 child.setEnabled(false);
               }
             });
           }
      };
      
      // Mark as depleted immediately - store original position for respawn
      resourceModelRegistry.delete(key);
      pendingResourceTiles.delete(key);
      if (mesh.metadata && mesh.metadata.resourceTileKey === key) {
        delete mesh.metadata.resourceTileKey;
      }
      
      // Check if this is a tree (for respawn logic)
      const isTree = mesh.metadata && mesh.metadata.modelPath && mesh.metadata.modelPath.includes('trees.glb');
      
      // Store depletion info with original position and timestamp
      depletedResourceTiles.set(key, {
        originalGridX: gridX,
        originalGridZ: gridZ,
        felledTime: Date.now(),
        isTree: isTree
      });
      
      // Clean up any stray duplicates that may exist at this tile
      cleanupDuplicateResourceMeshes(gridX, gridZ, mesh);
      
      // Start animation
      animateSink();
    } else {
      // No registered mesh - still try to clean up any stray duplicates
      cleanupDuplicateResourceMeshes(gridX, gridZ);
    }
  };
  
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
    
    // Helper: Get footprint radius based on scale
    function getFootprintRadius(scale) {
      if (scale >= 10) return 2;  // Large rocks (scale 11.5)
      if (scale >= 6) return 1;   // Mossy rocks (scale 7.5)
      return 0;                    // Plain rocks, trees
    }
    
    // Helper: Check if any tile in a footprint is occupied
    function isFootprintOccupied(gridX, gridZ, radius) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.sqrt(dx*dx + dz*dz) <= radius + 0.5) {
            if (occupiedTiles.has(`${gridX + dx},${gridZ + dz}`)) return true;
          }
        }
      }
      return false;
    }
    
    // Helper: Mark all tiles in a footprint as occupied
    function markFootprintOccupied(gridX, gridZ, radius) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.sqrt(dx*dx + dz*dz) <= radius + 0.5) {
            occupiedTiles.add(`${gridX + dx},${gridZ + dz}`);
          }
        }
      }
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
      
      // Bounds check: ensure grid coordinates are within field boundaries
      if (gridX < 0 || gridX >= field.width || gridZ < 0 || gridZ >= field.height) {
        return; // Skip tiles outside field bounds
      }
      
      // CRITICAL: Check chunk mask for custom map shapes - don't place resources in disabled chunks (off the table)
      if (field.chunkMask && field.chunkSize) {
        const chunkX = Math.floor(gridX / field.chunkSize);
        const chunkZ = Math.floor(gridZ / field.chunkSize);
        if (field.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
          return; // Skip tiles in disabled chunks (off the table)
        }
      }
      
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
        // Skip if this tile has been depleted
        const tileKey = `${gridX},${gridZ}`;
        if (depletedResourceTiles.has(tileKey)) {
          return; // Don't recreate depleted resources
        }
        
        // Skip if a rock already exists at this grid position (prevents duplicates across chunks)
        if (resourceModelRegistry.has(tileKey)) {
          return; // Rock already placed here
        }
        
        // Skip if a rock for this tile is already loading
        if (pendingResourceTiles.has(tileKey)) {
          return;
        }
        
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
        
        // Check footprint overlap before placing
        const footprintRadius = getFootprintRadius(scale);
        if (isFootprintOccupied(gridX, gridZ, footprintRadius)) {
          return; // Skip - would overlap with existing resource
        }
        
        rockNoisePassCount++;
        
        // Mark all tiles in footprint as occupied
        markFootprintOccupied(gridX, gridZ, footprintRadius);
        
        // Place the rock at proper height for this tile (centered on tile)
        const worldX = (gridX + 0.5) * TILE_SIZE;
        const worldZ = (gridZ + 0.5) * TILE_SIZE;
        
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
          modelRule: { path: modelPath, scale: scale, billboardScale: billboardScale, lodDistance: 200 },
          gridX: gridX, // For resource depletion tracking
          gridZ: gridZ
        });
        pendingResourceTiles.add(tileKey);
        
        // Block pathfinding for rock footprint
        if (field.blockFootprint) {
          field.blockFootprint(gridX, gridZ, footprintRadius);
        }
        
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
      
      // Bounds check: ensure grid coordinates are within field boundaries
      if (gridX < 0 || gridX >= field.width || gridZ < 0 || gridZ >= field.height) {
        return; // Skip tiles outside field bounds
      }
      
      // CRITICAL: Check chunk mask for custom map shapes - don't place resources in disabled chunks (off the table)
      if (field.chunkMask && field.chunkSize) {
        const chunkX = Math.floor(gridX / field.chunkSize);
        const chunkZ = Math.floor(gridZ / field.chunkSize);
        if (field.chunkMask.get(`${chunkX},${chunkZ}`) === false) {
          return; // Skip tiles in disabled chunks (off the table)
        }
      }
      
      const terrainIndex = gridZ * field.width + gridX;
      const terrainType = field.terrainTypes[terrainIndex];
      
      // Skip spawn zones (keep them clear for agoras)
      if (field.isInSpawnZone && field.isInSpawnZone(gridX, gridZ)) return;
      
      // Place trees on grass (type 3) and dirt (type 2), skip water
      if (terrainType !== 3 && terrainType !== 2) return;
      
      // Check if tile is already occupied by a rock
      const tileKey = `${gridX},${gridZ}`;
      if (occupiedTiles.has(tileKey)) return; // Skip occupied tiles
      
      // Different spawn rates: 20% on grass, 5% on dirt
      const treeSpawnRate = terrainType === 3 ? 0.20 : 0.05;
      
      // Skip trees near camps - they should grow further out
      const worldX = (gridX + 0.5) * TILE_SIZE;
      const worldZ = (gridZ + 0.5) * TILE_SIZE;
      if (window.gameBuildings) {
        let tooCloseToCamp = false;
        for (const building of window.gameBuildings) {
          if (building.type === 'camp' && building.position) {
            const campWorkRadius = (window.BuildingTypes && window.BuildingTypes.camp && window.BuildingTypes.camp.workRadius) || 5;
            const exclusionRadius = (campWorkRadius + 3) * TILE_SIZE; // Work radius + 3 extra tiles buffer
            const dx = worldX - building.position.x;
            const dz = worldZ - building.position.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq < exclusionRadius * exclusionRadius) {
              tooCloseToCamp = true;
              break;
            }
          }
        }
        if (tooCloseToCamp) return; // Skip placing trees near camps
      }
      
      // Simple per-tile hash for tree placement
      const treeRoll = tileHash(gridX, gridZ, fieldSeed + 3000);
      
      // Place trees based on terrain-specific spawn rate
      if (treeRoll < treeSpawnRate) {
        // Check if this tile was depleted - if so, try to respawn further from camp
        const depletionInfo = depletedResourceTiles.get(tileKey);
        if (depletionInfo && depletionInfo.isTree) {
          // Tree was felled here - respawn it further from camp
          const respawnPos = getRespawnPosition(depletionInfo.originalGridX, depletionInfo.originalGridZ);
          if (respawnPos) {
            // Use the respawn position instead
            const respawnKey = `${respawnPos.gridX},${respawnPos.gridZ}`;
            
            // Skip if respawn position is already occupied or depleted
            if (occupiedTiles.has(respawnKey) || depletedResourceTiles.has(respawnKey) || 
                resourceModelRegistry.has(respawnKey) || pendingResourceTiles.has(respawnKey)) {
              return; // Can't respawn here
            }
            
            // Check terrain at respawn position
            const respawnTerrainIndex = respawnPos.gridZ * field.width + respawnPos.gridX;
            if (respawnTerrainIndex >= 0 && respawnTerrainIndex < field.terrainTypes.length) {
              const respawnTerrainType = field.terrainTypes[respawnTerrainIndex];
              if (respawnTerrainType === 3) { // Grass - good for trees
                // Mark respawn position as occupied
                occupiedTiles.add(respawnKey);
                
                // Get height variation for respawn position
                const tileHeight = field.getHeightVariation ? field.getHeightVariation(respawnPos.gridX, respawnPos.gridZ) : 0;
                
                // Generate offset for respawn position
                let hash = fieldSeed + respawnPos.gridX * 13579 + respawnPos.gridZ * 24680;
                hash = (hash * 1664525 + 1013904223) >>> 0;
                const offsetX = ((hash % 1000) / 1000 - 0.5) * 0.6;
                hash = (hash * 1664525 + 1013904223) >>> 0;
                const offsetZ = ((hash % 1000) / 1000 - 0.5) * 0.6;
                
                const position = new BABYLON.Vector3(respawnPos.worldX + offsetX, tileHeight, respawnPos.worldZ + offsetZ);
                hash = (hash * 1664525 + 1013904223) >>> 0;
                const rotation = ((hash % 628) / 100);
                
                // Queue the respawned tree model
                initBillboardAtlas(scene);
                modelLoadQueue.push({
                  modelPath: "assets/models/trees.glb",
                  scene: scene,
                  position: position,
                  rotation: rotation,
                  scale: 0.9,
                  chunk: chunk,
                  models: models,
                  modelRule: { path: "assets/models/trees.glb", scale: 0.9, billboardScale: 3, lodDistance: 170 },
                  gridX: respawnPos.gridX,
                  gridZ: respawnPos.gridZ
                });
                pendingResourceTiles.add(respawnKey);
                treeCount++;
                
                // Remove from depleted list since we've respawned it
                depletedResourceTiles.delete(tileKey);
                
                return; // Done respawning
              }
            }
          }
          // If respawn failed, skip this tile (don't place tree at original location)
          return;
        } else if (depletedResourceTiles.has(tileKey)) {
          // Other depleted resource (rock), don't recreate
          return;
        }
        
        // Skip if a tree already exists at this grid position (prevents duplicates across chunks)
        if (resourceModelRegistry.has(tileKey)) {
          return; // Tree already placed here
        }
        
        // Skip if a tree for this tile is already loading
        if (pendingResourceTiles.has(tileKey)) {
          return;
        }
        
        // Mark tile as occupied
        occupiedTiles.add(tileKey);
        
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
          modelRule: { path: "assets/models/trees.glb", scale: 0.9, billboardScale: 3, lodDistance: 170 },
          gridX: gridX, // For resource depletion tracking
          gridZ: gridZ
        });
        pendingResourceTiles.add(tileKey);
        
        // Mark tile as slow for pathfinding (trees slow movement)
        if (field.slowTile) {
          field.slowTile(gridX, gridZ);
        }
        
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
      
      // Calculate world position for this tile (centered on tile)
      const worldX = (chunk.startX + localX + 0.5) * TILE_SIZE;
      const worldZ = (chunk.startZ + localZ + 0.5) * TILE_SIZE;
      
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
      
      // Skip undefined tiles (shouldn't happen but be defensive)
      if (!tile) continue;
      
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
        const waterLevel = -0.3;
        
        // Check if this tile is water (terrain type 1)
        const tileIndex = worldZ1 * chunk.field.width + worldX1;
        const isWater = chunk.field.terrainTypes && chunk.field.terrainTypes[tileIndex] === 1;
        
        if (isWater) {
          // Water is perfectly flat at a constant level
          height1 = height2 = height3 = height4 = waterLevel;
        } else {
          // Calculate height for each corner vertex
          height1 = chunk.field.getHeightVariation(worldX1, worldZ1); // bottom-left
          height2 = chunk.field.getHeightVariation(worldX2, worldZ1); // bottom-right  
          height3 = chunk.field.getHeightVariation(worldX2, worldZ2); // top-right
          height4 = chunk.field.getHeightVariation(worldX1, worldZ2); // top-left
          
          // Check each corner - if it touches a water tile, snap to water level
          // This creates smooth shorelines without seams
          const field = chunk.field;
          const w = field.width;
          const h = field.height;
          const terrainTypes = field.terrainTypes;
          
          // Helper to check if a position has water
          const hasWater = (x, z) => {
            if (x < 0 || x >= w || z < 0 || z >= h) return false;
            return terrainTypes[z * w + x] === 1;
          };
          
          // Corner 1 (bottom-left at worldX1, worldZ1) - shared with tiles to left and below
          if (hasWater(worldX1, worldZ1) || hasWater(worldX1 - 1, worldZ1) || 
              hasWater(worldX1, worldZ1 - 1) || hasWater(worldX1 - 1, worldZ1 - 1)) {
            height1 = waterLevel;
          }
          
          // Corner 2 (bottom-right at worldX2, worldZ1) - shared with tiles to right and below
          if (hasWater(worldX2, worldZ1) || hasWater(worldX2 - 1, worldZ1) ||
              hasWater(worldX2, worldZ1 - 1) || hasWater(worldX2 - 1, worldZ1 - 1)) {
            height2 = waterLevel;
          }
          
          // Corner 3 (top-right at worldX2, worldZ2) - shared with tiles to right and above
          if (hasWater(worldX2, worldZ2) || hasWater(worldX2 - 1, worldZ2) ||
              hasWater(worldX2, worldZ2 - 1) || hasWater(worldX2 - 1, worldZ2 - 1)) {
            height3 = waterLevel;
          }
          
          // Corner 4 (top-left at worldX1, worldZ2) - shared with tiles to left and above
          if (hasWater(worldX1, worldZ2) || hasWater(worldX1 - 1, worldZ2) ||
              hasWater(worldX1, worldZ2 - 1) || hasWater(worldX1 - 1, worldZ2 - 1)) {
            height4 = waterLevel;
          }
        }
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
        
        // Compute normals
        const normals = new Array(data.verts.length);
        BABYLON.VertexData.ComputeNormals(data.verts, data.indices, normals);
        meshes[key].setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
        
        // OPTIONAL: Smooth normal blending for softer lighting transitions at tile edges
        // Uncomment the code below to blend flat and smooth normals
        /*
        // Compute flat normals first
        const flatNormals = new Array(data.verts.length);
        BABYLON.VertexData.ComputeNormals(data.verts, data.indices, flatNormals);
        
        // Compute smooth normals by sampling terrain gradient
        const smoothNormals = [];
        for (let i = 0; i < data.verts.length; i += 3) {
          const x = data.verts[i];
          const z = data.verts[i + 2];
          
          // Sample terrain height around this vertex to get smooth normal
          const sampleDist = 0.5; // Distance to sample for gradient
          const heightL = chunk.field ? chunk.field.getHeightVariation(x / tileSize - sampleDist, z / tileSize) : 0;
          const heightR = chunk.field ? chunk.field.getHeightVariation(x / tileSize + sampleDist, z / tileSize) : 0;
          const heightD = chunk.field ? chunk.field.getHeightVariation(x / tileSize, z / tileSize - sampleDist) : 0;
          const heightU = chunk.field ? chunk.field.getHeightVariation(x / tileSize, z / tileSize + sampleDist) : 0;
          
          // Calculate normal from height gradient
          const dx = heightL - heightR;
          const dz = heightD - heightU;
          const length = Math.sqrt(dx * dx + 1 + dz * dz);
          
          // Normalized smooth normal
          smoothNormals.push(dx / length, 1 / length, dz / length);
        }
        
        // Blend between flat and smooth normals (just a touch of smoothing at edges)
        const blendFactor = 0.12; // Adjust this: 0=completely flat, 1=completely smooth
        const blendedNormals = [];
        for (let i = 0; i < flatNormals.length; i += 3) {
          const nx = flatNormals[i] * (1 - blendFactor) + smoothNormals[i] * blendFactor;
          const ny = flatNormals[i + 1] * (1 - blendFactor) + smoothNormals[i + 1] * blendFactor;
          const nz = flatNormals[i + 2] * (1 - blendFactor) + smoothNormals[i + 2] * blendFactor;
          
          // Re-normalize the blended normal
          const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
          blendedNormals.push(nx / length, ny / length, nz / length);
        }
        
        meshes[key].setVerticesData(BABYLON.VertexBuffer.NormalKind, blendedNormals);
        */
        
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
        
        // PERFORMANCE: Freeze static terrain mesh to skip transform updates
        // Terrain never moves, so this is a huge optimization
        if (meshes[key].freezeWorldMatrix) {
          meshes[key].freezeWorldMatrix();
        }
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
    
    // PERFORMANCE: Freeze parent terrain mesh too
    if (terrainMesh.freezeWorldMatrix) {
      terrainMesh.freezeWorldMatrix();
    }

    // Debug mesh properties
    const totalTiles = Object.values(vertexData).reduce((sum, data) => sum + data.index, 0);
    
    // Return the mesh immediately - models will be loaded lazily
    return terrainMesh;
  }

  gfx.init = function() {
    gfx.canvas = document.getElementById('canvas');
    
    // ========================================
    // ANTIALIASING SETUP (before engine creation)
    // ========================================
    // Load saved AA setting - MSAA must be set at engine creation time
    const savedAA = localStorage.getItem('aaLevel');
    currentAALevel = savedAA ? parseInt(savedAA) : 0;
    
    // Configure MSAA if selected (requires engine recreation to change)
    if (currentAALevel >= 2) {
      engineOptions.antialias = true;
      engineOptions.antialiasing = true;
      // MSAA 2x = 2 samples, MSAA 4x = 4 samples
      const samples = currentAALevel === 2 ? 2 : 4;
      engineOptions.samples = samples;
    }
    
    // ========================================
    // ENGINE PERFORMANCE OPTIMIZATIONS
    // ========================================
    gfx.engine = new BABYLON.Engine(gfx.canvas, currentAALevel >= 2, engineOptions, false);
    
    // Disable offline support to reduce overhead
    gfx.engine.enableOfflineSupport = false;
    
    // Prevent context lost handling (reduces checks)
    gfx.engine.doNotHandleContextLost = true;
    
    // Optimize depth testing
    gfx.engine.depthCullingState.depthTest = true;
    gfx.engine.depthCullingState.depthMask = true;
    
    // ========================================
    gfx.scene = new BABYLON.Scene(gfx.engine);
    
    // ========================================
    // PERFORMANCE OPTIMIZATIONS
    // ========================================
    
    // Disable expensive picking on pointer move - we only need click picking
    gfx.scene.skipPointerMovePicking = true;
    
    // Disable frustum clipping for better performance (BJS will still cull based on camera)
    gfx.scene.skipFrustumClipping = false; // Keep this for proper culling
    
    // Reduce the number of times materials are checked for changes
    gfx.scene.blockMaterialDirtyMechanism = false; // Keep false to allow updates when needed
    
    // Disable automatic scene clearing if we're rendering a skybox (we don't use skybox)
    // Keep autoclear enabled for proper rendering
    gfx.scene.autoClear = true;
    gfx.scene.autoClearDepthAndStencil = true;
    
    // Use constant deterministic mode to reduce overhead
    gfx.scene.constantlyUpdateMeshUnderPointer = false;
    
    // Optimize render targets
    gfx.scene.renderTargetsEnabled = true; // Keep enabled for shadows
    
    // Optimize particle systems
    gfx.scene.particlesEnabled = true;
    
    // Optimize sprite rendering
    gfx.scene.spritesEnabled = false; // We use billboards, not sprites
    
    // Optimize texture loading
    gfx.scene.useDelayedTextureLoading = false; // Immediate loading is better for our use case
    
    // ========================================
    
    // Ensure shadows are globally allowed on the scene
    gfx.scene.shadowsEnabled = true;
    
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
    
    // Initialize MSDF text and speech system (async)
    if (window.MSDFText && window.MSDFText.init) {
      window.MSDFText.init(gfx.scene).then(() => {
        if (window.UnitSpeech && window.UnitSpeech.init) {
          window.UnitSpeech.init(gfx.scene);
        }
      }).catch(err => {
        console.error('Failed to initialize MSDF text:', err);
      });
    }
    
    // Load textures now that we have a scene
    // Terrain transition atlases
    grassDirtAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass-dirt.png", gfx.scene);
    
    // Legacy/fallback textures (using new atlases as fallbacks)
    grassAtlasTexture = grassDirtAtlasTexture; // Use grass-dirt as fallback
    dirtAtlasTexture = grassDirtAtlasTexture;
    rockAtlasTexture = new BABYLON.Texture("assets/textures/atlas-hd.png", gfx.scene);
    sandAtlasTexture = grassDirtAtlasTexture;
    // Water transition atlases
    grassWaterAtlasTexture = new BABYLON.Texture("assets/textures/atlas-grass-water.png", gfx.scene);
    dirtWaterAtlasTexture = grassDirtAtlasTexture; // Fallback - we avoid dirt-water adjacency
    waterAtlasTexture = grassWaterAtlasTexture; // Pure water uses grass-water atlas

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

  // CRITICAL: Intercept scene.addMesh to validate all meshes as they're added
  if (gfx.scene && !gfx.scene._meshAddIntercepted) {
    const originalAddMesh = gfx.scene.addMesh;
    if (originalAddMesh) {
      gfx.scene.addMesh = function(mesh) {
        const hasIsEnabledFn = mesh && (typeof mesh.isEnabled === 'function');
        if (!mesh || !hasIsEnabledFn) {
          console.error('🚨🚨🚨 BLOCKED INVALID MESH FROM BEING ADDED:', {
            name: mesh?.name,
            type: mesh?.constructor?.name,
            hasIsEnabledFn,
            stack: new Error().stack
          });
          return; // Don't add it!
        }
        return originalAddMesh.call(this, mesh);
      };
      gfx.scene._meshAddIntercepted = true;
      console.log('✅ Scene.addMesh intercepted for validation');
    }
  }

  function mainRenderLoop(){
    // Log once to confirm code is running
    if (!window._renderLoopConfirmed) {
      // console.log('✅ mainRenderLoop code is running (new version)');
      window._renderLoopConfirmed = true;
    }
    
    // AGGRESSIVE: Filter scene.meshes on EVERY frame to catch corruption
    // Check for BOTH setEnabled AND isEnabled FUNCTION (the error is about isEnabled!)
    if (gfx.scene && gfx.scene.meshes) {
      const before = gfx.scene.meshes.length;
      gfx.scene.meshes = gfx.scene.meshes.filter(m => {
        if (!m) {
          console.error(`🚨🚨🚨 REMOVING NULL/UNDEFINED MESH`);
          return false;
        }
        
        // Check for isEnabled as a FUNCTION (this is what Babylon calls internally!)
        const hasIsEnabled = typeof m.isEnabled === 'function';
        const hasSetEnabled = typeof m.setEnabled === 'function';
        
        if (!hasIsEnabled) {
          console.error(`🚨🚨🚨 REMOVING MESH WITHOUT isEnabled FUNCTION:`, {
            name: m.name || 'null',
            type: m.constructor?.name || 'null',
            hasIsEnabled,
            hasSetEnabled: hasSetEnabled,
            keys: Object.keys(m).slice(0, 10)
          });
          return false;
        }
        
        return true;
      });
      const after = gfx.scene.meshes.length;
      if (before !== after) {
        console.error(`🚨 Cleaned ${before - after} invalid meshes from scene`);
      }
    }
    
    // Increment frame counter for LOD system
    window.frameCounter = (window.frameCounter || 0) + 1;
    
    // Cache current time for performance (used by units, etc.)
    window.cachedTime = Date.now();
    
    // Guard camera params before rendering to avoid NaNs breaking frustum
    if (gfx.camera) {
      if (!Number.isFinite(gfx.camera.alpha)) gfx.camera.alpha = 0;
      if (!Number.isFinite(gfx.camera.beta)) gfx.camera.beta = 1.1;
      if (!Number.isFinite(gfx.camera.radius)) gfx.camera.radius = 80;
      if (typeof gfx.camera.lowerBetaLimit === 'number' && typeof gfx.camera.upperBetaLimit === 'number') {
        gfx.camera.beta = Math.max(gfx.camera.lowerBetaLimit, Math.min(gfx.camera.upperBetaLimit, gfx.camera.beta));
      } else {
        gfx.camera.beta = Math.max(0.2, Math.min(1.5, gfx.camera.beta));
      }
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

    // SAFETY: Validate scene.meshes before render
    const invalidMeshesBeforeRender = [];
    if (gfx.scene.meshes) {
      gfx.scene.meshes.forEach((mesh, index) => {
        if (!mesh || typeof mesh.setEnabled !== 'function') {
          invalidMeshesBeforeRender.push({ 
            index, 
            name: mesh?.name || 'unnamed',
            type: mesh?.constructor?.name || 'unknown',
            hasSetEnabled: typeof mesh?.setEnabled
          });
        }
      });
    }
    
    if (invalidMeshesBeforeRender.length > 0) {
      console.error(`🚨 FOUND ${invalidMeshesBeforeRender.length} INVALID MESHES BEFORE RENDER:`, invalidMeshesBeforeRender);
      console.error('Invalid mesh details:', JSON.stringify(invalidMeshesBeforeRender, null, 2));
      
      // Remove them from the scene
      const beforeCount = gfx.scene.meshes.length;
      gfx.scene.meshes = gfx.scene.meshes.filter(m => m && typeof m.setEnabled === 'function');
      const afterCount = gfx.scene.meshes.length;
      console.log(`✅ Cleaned scene.meshes - removed ${beforeCount - afterCount} invalid meshes, now has ${afterCount} valid meshes`);
    }

    // NUCLEAR: Force Babylon to rebuild its internal active meshes cache every frame
    // This prevents stale references to disposed/invalid meshes
    try {
      if (gfx.scene._activeMeshes && gfx.scene._activeMeshes.reset) {
        gfx.scene._activeMeshes.reset();
      }
      if (gfx.scene._activeIndices && gfx.scene._activeIndices.reset) {
        gfx.scene._activeIndices.reset();
      }
      if (gfx.scene._activeParticleSystems && gfx.scene._activeParticleSystems.reset) {
        gfx.scene._activeParticleSystems.reset();
      }
      
      // Alternative: Set dirty flag to force recomputation
      if (gfx.scene._activeMeshesFrozen !== undefined) {
        gfx.scene._activeMeshesFrozen = false;
      }
    } catch (cacheError) {
      // Silently ignore cache reset errors
    }

    // SAFETY: Log mesh count before render
    if (window.frameCounter % 60 === 0) {
      // console.log(`Frame ${window.frameCounter}: ${gfx.scene.meshes.length} meshes in scene`);
    }

    // Update blob shadows if in blob mode (Low=1 or Med=2)
    if ((window.SHADOW_MODE === 1 || window.SHADOW_MODE === 2) && gfx.updateAllBlobShadows) {
      gfx.updateAllBlobShadows();
    }
    
    // Update thin instance scenery if in non-shadow mode
    if (window.SHADOW_MODE !== 3 && gfx.updateThinInstances) {
      gfx.updateThinInstances();
    }
    
    // SAFETY: Wrap the actual render call
    try {
      gfx.scene.render();
    } catch (renderError) {
      console.error('CRITICAL: Scene render failed!', renderError);
      console.error('Render error stack:', renderError.stack);
      console.error('Scene has', gfx.scene.meshes.length, 'meshes');
      console.error('First 10 meshes:', gfx.scene.meshes.slice(0, 10).map(m => ({
        name: m?.name,
        type: m?.constructor?.name,
        hasIsEnabled: 'isEnabled' in m
      })));
      
      // Emergency cleanup - try to identify and fix the problematic mesh
      if (gfx.scene.meshes) {
        console.log('Emergency mesh cleanup - checking all meshes...');
        // Filter out invalid meshes first
        const validMeshes = [];
        const invalidMeshes = [];
        
        gfx.scene.meshes.forEach((mesh, index) => {
          try {
            // Check if it's a valid mesh with isEnabled method
            if (mesh && typeof mesh.setEnabled === 'function') {
              validMeshes.push(mesh);
              // Temporarily disable mesh to isolate the problem
              mesh.setEnabled(false);
              console.log(`Disabled mesh ${index}: ${mesh.name || 'unnamed'}`);
            } else {
              invalidMeshes.push({ index, mesh, name: mesh?.name || 'unnamed' });
              console.warn(`Invalid mesh at index ${index}:`, mesh);
            }
          } catch (disableError) {
            console.warn(`Could not disable mesh ${index}:`, disableError);
            invalidMeshes.push({ index, mesh, error: disableError });
          }
        });
        
        // Remove invalid meshes from scene
        invalidMeshes.forEach(({ mesh }) => {
          try {
            if (mesh && gfx.scene) {
              gfx.scene.removeMesh(mesh, true);
            }
          } catch (e) {
            console.warn('Error removing invalid mesh:', e);
          }
        });
        
        if (invalidMeshes.length > 0) {
          console.warn(`Removed ${invalidMeshes.length} invalid meshes from scene`);
        }
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
      gfx.camera.upperRadiusLimit = Math.max(150, maxDim * 1.5); // Reduced maximum to keep camera closer to ground

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
    
    // Update unit mesh positions and rotations
    // NOTE: Unit logic/behaviors/buildings are updated in game.js physics loop
    // MENU SCENE: Use simple game loop with fixed timestep physics for menu scene units
    if (!window.game && !window.currentMatch) {
      // Initialize menu scene game loop state if needed
      if (!gfx.menuGameLoop) {
        gfx.menuGameLoop = {
          lastTime: performance.now(),
          physicsTime: 0,
          physicsTimestep: 1/60, // Fixed 60Hz physics (16.67ms)
          frameCounter: 0
        };
      }
      
      // Calculate delta time
      const currentTime = performance.now();
      const deltaTime = Math.min((currentTime - gfx.menuGameLoop.lastTime) / 1000, 0.1); // Cap at 100ms
      gfx.menuGameLoop.lastTime = currentTime;
      gfx.menuGameLoop.frameCounter++;
      
      // Make frame counter globally available
      window.frameCounter = gfx.menuGameLoop.frameCounter;
      
      // Accumulate time for physics
      gfx.menuGameLoop.physicsTime += deltaTime;
      
      // Run physics at fixed timestep (60Hz)
      const maxPhysicsSteps = 10; // Cap steps per frame
      let physicsSteps = 0;
      while (gfx.menuGameLoop.physicsTime >= gfx.menuGameLoop.physicsTimestep && physicsSteps < maxPhysicsSteps) {
        physicsSteps++;
        
        // Update units and their behaviors (this applies impulses)
        if (window.updateUnits) {
          window.updateUnits(gfx.menuGameLoop.physicsTimestep);
        }
        
        // Update player physics (cosmetic frog movement)
        if (window.player && window.player.pbody && window.player.pbody.integrate) {
          window.player.pbody.integrate(gfx.menuGameLoop.physicsTimestep, true, true);
        }
        
        // Step physics time forward
        gfx.menuGameLoop.physicsTime -= gfx.menuGameLoop.physicsTimestep;
      }
    } else {
      // Game/match is active - clear menu loop state
      if (gfx.menuGameLoop) {
        delete gfx.menuGameLoop;
      }
    }
    
    if (window.updateUnitMeshes) {
      updateUnitMeshes();
    }
    
    // Update LOD system based on camera TARGET position (same as chunks)
    // Use cameraTarget instead of camera.position so LOD and chunks are centered the same
    if (gfx.cameraTarget) {
      updateLOD(gfx.cameraTarget.position);
      
      // PERFORMANCE: Throttle particle LOD updates - only update every 30 frames
      // Particles don't need frequent LOD checks, this saves CPU
      if (!this._particleLODCounter) this._particleLODCounter = 0;
      this._particleLODCounter++;
      if (this._particleLODCounter >= 30 && window.fx && window.fx.updateParticleLOD) {
        window.fx.updateParticleLOD(gfx.cameraTarget.position);
        this._particleLODCounter = 0;
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
    
    // Update lighting system - pass camera position for shadow frustum following
    if (window.lighting && window.lighting.update) {
      const cameraPos = gfx.cameraTarget ? gfx.cameraTarget.position : null;
      window.lighting.update(0.016, cameraPos); // ~60fps deltaTime + camera position
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
    // PERFORMANCE: Throttle minimap updates - only update every 10 frames for better FPS
    // Minimap doesn't need 60fps updates, 6fps is plenty smooth for a strategic view
    if (window.hud && window.hud.updateMinimap) {
      if (!this._minimapFrameCounter) this._minimapFrameCounter = 0;
      this._minimapFrameCounter++;
      const fullUpdate = this._minimapFrameCounter >= 10; // Increased from 5 to 10
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
    // CRITICAL: Always use window.liveField to get the current field reference
    // (ensures we use the new field after match starts, not the stale menu field)
    const currentField = window.liveField;
    if (currentField && gfx.cameraTarget) {
      const targetPos = gfx.cameraTarget.position || gfx.cameraTarget;
      currentField.updateVisibleChunks(targetPos.x, targetPos.z); // Use field's default radius
      
      // Add chunks that need processing to the queue (don't process them all at once)
      const TILE_SIZE = window.TILE_SIZE || 4;
      const playerChunkX = Math.floor(targetPos.x / (currentField.chunkSize * TILE_SIZE));
      const playerChunkZ = Math.floor(targetPos.z / (currentField.chunkSize * TILE_SIZE));
      
      for (const [key, chunk] of currentField.chunks) {
        if (chunk.needsMesh && !chunkQueue.some(item => item.key === key && item.type === 'mesh')) {
          const [chunkX, chunkZ] = key.split(',').map(Number);
          const dx = chunkX - playerChunkX;
          const dz = chunkZ - playerChunkZ;
          const distSq = dx * dx + dz * dz;
          chunkQueue.push({ key, chunk, chunkX, chunkZ, type: 'mesh', distSq });
        }
        
        // Skip automatic model placement in forge mode - forge handles resources manually
        if (!window.isForgeMode && chunk.needsModels && chunk.mesh && !chunkQueue.some(item => item.key === key && item.type === 'models')) {
          const [chunkX, chunkZ] = key.split(',').map(Number);
          const dx = chunkX - playerChunkX;
          const dz = chunkZ - playerChunkZ;
          const distSq = dx * dx + dz * dz;
          chunkQueue.push({ key, chunk, chunkX, chunkZ, type: 'models', distSq });
        }
      }
      
      // Sort queue by distance (closest first) so visible chunks load before distant ones
      chunkQueue.sort((a, b) => a.distSq - b.distSq);
      
      // Process only a limited number of chunks per frame
      let processed = 0;
      while (chunkQueue.length > 0 && processed < CHUNKS_PER_FRAME) {
        const item = chunkQueue.shift();
        
        if (item.type === 'mesh') {
          currentField.createChunkMesh(item.chunkX, item.chunkZ, gfx.scene, createTerrainMesh);
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
      // Performance warning removed - only show errors
      // if (fps < 30) {
      //   console.log(`⚠️ Performance: ${fps} FPS | Chunks: ${chunks} | LOD models: ${lodCount} | Total meshes: ${meshCount}`);
      // }
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
    
    // Initialize FXAA post-process if selected
    if (currentAALevel === 1) {
      fxaaPostProcess = new BABYLON.FxaaPostProcess("fxaa", 1.0, gfx.camera);
    }

    // Initialize orbital lighting system (without auto-movement)
    if (window.lighting) {
      lighting.init(scene);
      
      // Set up daytime lighting (good shadows without over-darkening the ground)
      lighting.configure({
        autoAdvance: false,  // No automatic movement
        orbitRadius: 220,
        orbitHeight: 90,   // Moderate height - keeps shadows defined without being too low
        orbitTilt: 0.3     // Balanced tilt for a clear lateral angle
      });
      // Pick an initial sun time:
      // 1) use saved preference if present
      // 2) otherwise pick a deterministic daytime value from the field seed
      const savedSunTime = localStorage.getItem('sunTime');
      let initialSunTime;
      if (savedSunTime !== null && !isNaN(parseFloat(savedSunTime))) {
        initialSunTime = Math.max(0, Math.min(1, parseFloat(savedSunTime)));
      } else {
        const seed = (window.liveField && window.liveField.seed) ? window.liveField.seed : Math.random() * 1000;
        // Map seed to a stable daytime window [0.42, 0.62]
        initialSunTime = 0.42 + ((seed * 0.137) % 0.20);
      }
      // Apply chosen sun time (avoids the repeated peach dawn/dusk look)
      lighting.setSunTime(initialSunTime);
      
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

    // Respect saved shadow preference as early as possible
    // Initialize shadow mode from saved setting
    // 0 = Off, 1 = Low (solid blobs), 2 = Med (gradient blobs), 3 = Full
    try {
      const savedShadowMode = localStorage.getItem('shadowMode');
      if (savedShadowMode !== null) {
        window.SHADOW_MODE = parseInt(savedShadowMode);
      } else {
        // Migrate from old shadowsEnabled setting
        const oldShadowSetting = localStorage.getItem('shadowsEnabled');
        if (oldShadowSetting === 'false') {
          window.SHADOW_MODE = 0; // Off
        } else {
          window.SHADOW_MODE = 2; // Med (default)
        }
      }
      window.SHADOWS_ENABLED = window.SHADOW_MODE === 3;
    } catch (e) {
      // Fallback if localStorage is unavailable
      window.SHADOW_MODE = 2;
      window.SHADOWS_ENABLED = false;
    }
    
    // Set initial blob shadow visibility and style based on shadow mode
    blobShadowsVisible = (window.SHADOW_MODE === 1 || window.SHADOW_MODE === 2);
    blobShadowStyle = (window.SHADOW_MODE === 1) ? 'solid' : 'gradient';
    
    // DON'T set thinInstanceMode here - let updateShadowMode() handle it
    // after the shadow slider is properly initialized
    // thinInstanceMode will be set by hud.updateShadowMode() when settings load

    // Create table first
    gfx.table = gfx.makeTable(scene);
    
    // Pre-stretch table to default field size to prevent visual jump
    // This happens before first render for clean initial display
    if (gfx.table && gfx.table.parts && gfx.table.parts.SW && gfx.stretchTable) {
      // Table will be stretched properly when field loads, this is just initial positioning
      // Using default 128x128 field size for initial frame
      // console.log('📐 Pre-positioning table for clean initial render');
    }
    
  // Scene stability tracking
  gfx.sceneStability = {
    isStable: false,
    stabilityCheckInterval: 100, // Check every 100ms (was 1000)
    lastStabilityCheck: 0,
    consecutiveStableFrames: 0,
    requiredStableFrames: 2, // Need 2 consecutive stable checks (was 3)
    lastMeshCount: 0,
    lastFrameTime: 0,
    stabilityThreshold: 16.67 // Kept for backwards compatibility (no longer used)
  };
  
  // Shadow LoD configuration - creates buffer zone between shadows and billboards
  // Zone layout: [0-maxShadowDistance] 3D+shadows → [maxShadowDistance-170] 3D no shadows → [170+] billboards
  // CRITICAL: maxShadowDistance should be LARGER than frustum so frustumEdgeFalloff can fade naturally
  // We cull shadow casters beyond the frustum for performance, but the fade happens at frustum edge
  gfx.shadowLODConfig = {
    enabled: true,
    // These are DEFAULT values - they get updated by updateShadowDistancesForLOD()
    maxShadowDistance: 130, // Cull shadow casters beyond frustum edge (for perf)
    nearShadowDistance: 50, // Close range for full quality shadows
    farShadowDistance: 90, // Medium range shadows
    cullingDistance: 150, // Stop shadow calculations entirely here
    updateInterval: 250 // Update shadow casters every 250ms
  };
  
  // Update shadow distances based on current LOD level
  // CRITICAL: frustumEdgeFalloff fades at the FRUSTUM boundary
  // So: frustum < maxShadowDistance (casters extend past frustum for fade to work)
  // And: maxShadowDistance < billboardStart (no shadows on billboards)
  gfx.updateShadowDistancesForLOD = function(lodLevel) {
    if (!gfx.shadowLODConfig) return;
    
    // Calculate the same terrain-based caps used by resource LOD
    const TILE_SIZE = window.TILE_SIZE || 4;
    const CHUNK_WORLD_SIZE = 16 * TILE_SIZE;
    const multiplier = 0.3 + (lodLevel / 100) * 1.4; // Same formula as hud.getCurrentLODMultiplier
    
    const loadDistance = Math.max(3, Math.min(12, Math.round(6 * multiplier)));
    const terrainWorldDistance = loadDistance * CHUNK_WORLD_SIZE;
    const resourceCullCap = terrainWorldDistance * 0.7; // Where billboards cull (match above)
    const resourceLodCap = resourceCullCap * 0.5; // Where billboards START (3D ends)
    
    // Shadow frustum should be ~60% of billboard start distance
    // maxShadowDistance should be ~80% (casters extend past frustum for fade)
    // This leaves 20% of 3D zone with no shadows as buffer before billboards
    const shadowFrustum = resourceLodCap * 0.6; // Frustum edge where fade happens
    const shadowCull = resourceLodCap * 0.8; // Cull casters here (past frustum, so fade works)
    
    // Store the frustum size so configureShadowGeneratorSettings can use it
    gfx.shadowLODConfig.frustumSize = shadowFrustum;
    gfx.shadowLODConfig.maxShadowDistance = shadowCull;
    gfx.shadowLODConfig.nearShadowDistance = shadowFrustum * 0.5;
    gfx.shadowLODConfig.farShadowDistance = shadowFrustum * 0.8;
    gfx.shadowLODConfig.cullingDistance = shadowCull * 1.1;
    
    // console.log(`🌑 Shadow LOD: frustum=${shadowFrustum.toFixed(0)}, cull=${shadowCull.toFixed(0)}, billboards@${resourceLodCap.toFixed(0)}`);
  };
  
  // Shadow LoD tracking
  gfx.lastShadowUpdate = 0;
    
    // Initialize shadow generator after lighting system is ready
    gfx.initializeShadowGenerator = function() {
      if (window.lighting && window.lighting.lights && window.lighting.lights.sun) {
        const sunLight = window.lighting.lights.sun;
        // console.log('Initializing shadow generator with sun light:', sunLight.name);
        
        try {
          // Pick initial shadow resolution based on saved LOD (or default 100 for refined shadows)
          let initialLOD = 100; // Default to high quality (2048 resolution) for refined shadows
          try {
            const savedLOD = localStorage.getItem('lodLevel');
            if (savedLOD) {
              const parsed = parseInt(savedLOD);
              if (!Number.isNaN(parsed)) {
                initialLOD = parsed;
              }
            }
          } catch (e) {
            // Ignore LOD lookup errors and fall back to default
          }
          const initialShadowRes = gfx.getShadowResolutionForLOD
            ? gfx.getShadowResolutionForLOD(initialLOD)
            : 2048; // Default to refined shadows (2048) if function not available

          gfx.shadowGenerator = new BABYLON.ShadowGenerator(initialShadowRes, sunLight);
          // Apply centralized quality settings so visuals match reconfigureShadowGenerator
          gfx.configureShadowGeneratorSettings(gfx.shadowGenerator, initialLOD);
          
          // Initialize lastLODLevel to prevent unnecessary reconfiguration when settings menu opens
          gfx.lastLODLevel = initialLOD;
          
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
      
      // If we've already marked the scene as stable (e.g. via forceInitializeShadows),
      // trust that and return true immediately.
      if (gfx.sceneStability.isStable) {
        return true;
      }
      
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
      
      // Check if lighting system is ready
      const lightingReady = window.lighting && window.lighting.lights && window.lighting.lights.sun;
      
      if (!lightingReady) {
        gfx.sceneStability.consecutiveStableFrames = 0;
        return false;
      }
      
      if (meshCountChanged) {
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
        // console.log('⚠️ Shadows disabled, skipping initialization');
        return;
      }

      // Check if shadow generator already exists
      if (gfx.shadowGenerator) {
        // console.log('✅ Shadow generator already exists');
        // Still update meshes in case new ones were added
        if (gfx.updateAllMeshShadows) {
          gfx.updateAllMeshShadows();
        }
        return;
      }

      // Check if scene is stable (but don't wait too long)
      if (!gfx.checkSceneStability()) {
        // console.log('⏳ Scene not stable yet, retrying shadow init...');
        setTimeout(() => gfx.autoInitializeShadows(), 150);
        return;
      }

      // Try to initialize shadows
      // console.log('🎭 Scene is stable! Initializing shadows (scene has', gfx.scene.meshes.length, 'meshes)...');
      const success = gfx.initializeShadowGenerator();
      
      if (success) {
        // Update all existing meshes to receive shadows
        if (gfx.updateAllMeshShadows) {
          gfx.updateAllMeshShadows();
        }
        // console.log('✅ Shadows initialized and applied to', gfx.scene.meshes.length, 'meshes');
        // console.log('   Shadow casters:', gfx.shadowGenerator.getShadowMap().renderList.length);
      } else {
        // Retry after a short delay
        // console.log('⏳ Shadow initialization failed, retrying...');
        setTimeout(() => gfx.autoInitializeShadows(), 300);
      }
    };

    // Force shadow initialization (bypass stability checks)
    gfx.forceInitializeShadows = function() {
      // console.log('🎭 Force initializing shadows...');
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
      
      // Initialize projectiles system
      if (window.projectiles && window.projectiles.init) {
        window.projectiles.init(scene);
      }
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
    // Minimum 1024 to avoid PCF striping artifacts
    gfx.getShadowResolutionForLOD = function(lodLevel = 100) {
      if (lodLevel <= 30) {
        return 1024;  // Low-end: minimum usable with PCF
      } else if (lodLevel <= 70) {
        return 1024; // Medium: balanced
      } else {
        return 2048; // High-end: sharper shadows
      }
    };

    // Centralized shadow generator quality settings so init/reconfigure stay in sync
    gfx.configureShadowGeneratorSettings = function(generator, lodLevel = 100) {
      if (!generator) return;
      
      // PERFORMANCE: Use PCF with MEDIUM quality for better FPS
      // QUALITY_HIGH is expensive, MEDIUM gives 95% of the visual quality with better perf
      generator.usePercentageCloserFiltering = true;
      generator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
      
      // Disable other shadow modes
      generator.useExponentialShadowMap = false;
      generator.useBlurExponentialShadowMap = false;
      generator.useCloseExponentialShadowMap = false;
      generator.usePoissonSampling = false;
      
      // PERFORMANCE: Enable contact hardening shadows for better quality at lower res
      generator.useContactHardeningShadow = false; // Disable for now, can be expensive
      
      // PERFORMANCE: Optimize shadow map refresh
      generator.forceBackFacesOnly = false; // Keep default for better quality
      
      // darkness: 0 = black shadows, 1 = invisible shadows  
      generator.darkness = 0;                       // Full black shadows for maximum visibility
      generator.bias = 0.001;                       // Lower bias - less "peter panning" (shadow detachment)
      generator.normalBias = 0.005;                 // Lower normal bias for tighter shadows
      
      // CRITICAL: Calculate shadow distances FIRST so we know the frustum size
      if (gfx.updateShadowDistancesForLOD) {
        gfx.updateShadowDistancesForLOD(lodLevel);
      }
      
      // CRITICAL: Set up the shadow camera frustum for directional light
      const light = generator.getLight();
      if (light && light.getClassName() === "DirectionalLight") {
        // Disable auto-extend - use fixed frustum instead
        light.autoUpdateExtends = false;
        light.autoCalcShadowZBounds = false;
        
        // Use dynamically calculated frustum size based on LOD and terrain
        // Frustum is SMALLER than shadow cull distance so frustumEdgeFalloff fades at edge
        const frustumSize = gfx.shadowLODConfig?.frustumSize || 80;
        
        light.orthoLeft = -frustumSize;
        light.orthoRight = frustumSize;
        light.orthoTop = frustumSize;
        light.orthoBottom = -frustumSize;
        
        // Set Z bounds for shadow depth
        light.shadowMinZ = 0;
        light.shadowMaxZ = 400;
      }
      
      // Don't render back faces only - some models need front face shadows
      generator.forceBackFacesOnly = false;
      
      // Fade shadows at the edge of the frustum to prevent hard cutoffs/streaks
      generator.frustumEdgeFalloff = 1.0;
      
      // No transparency shadows for performance
      generator.setTransparencyShadow(false);
    };
    
    // Handler called when LOD slider changes - reconfigures shadows to match
    gfx.onLODDistanceUpdate = function(lodLevel) {
      // Only reconfigure if shadows are enabled
      if (window.SHADOWS_ENABLED && gfx.shadowGenerator) {
        gfx.reconfigureShadowGenerator(lodLevel);
      }
    };
    
    // Modified reconfigureShadowGenerator - now silent
    gfx.reconfigureShadowGenerator = function(lodLevel) {
      if (!window.SHADOWS_ENABLED || !gfx.shadowGenerator || !window.lighting?.lights?.sun) {
        return; // Skip if disabled or not ready
      }
      
      const newRes = gfx.getShadowResolutionForLOD(lodLevel);
      const currentRes = gfx.shadowGenerator.getShadowMap().getSize().width;
      
      // If resolution matches and lastLODLevel is set, check if we need to reconfigure
      if (newRes === currentRes) {
        // If lastLODLevel is undefined, just set it without reconfiguring
        if (gfx.lastLODLevel === undefined) {
          gfx.lastLODLevel = lodLevel;
        } else {
          // Debounce: only reconfigure if LOD changed by more than 5%
          const changeThreshold = 5;
          if (Math.abs(lodLevel - gfx.lastLODLevel) < changeThreshold) {
            return; // Small change, skip reconfiguration
          }
        }
        gfx.lastLODLevel = lodLevel; // Update tracking
        return; // No change needed
      }
      
      // Debounce: only reconfigure if LOD changed by more than 5% (and resolution differs)
      const changeThreshold = 5;
      if (gfx.lastLODLevel !== undefined && Math.abs(lodLevel - gfx.lastLODLevel) < changeThreshold) {
        return; // Small change, skip reconfiguration
      }
      
      try {
        // Dispose old generator
        gfx.shadowGenerator.dispose();
        
        // Create new one with updated res and consistent quality settings
        gfx.shadowGenerator = new BABYLON.ShadowGenerator(newRes, window.lighting.lights.sun);
        gfx.configureShadowGeneratorSettings(gfx.shadowGenerator, lodLevel);
        
        // Re-add all current shadow casters with force
        gfx.updateAllMeshShadows(true); // true = force re-add
        
        gfx.lastLODLevel = lodLevel;
        
        // Calculate frustum size for logging
        const frustumSize = lodLevel <= 30 ? 60 : (lodLevel <= 70 ? 80 : 110);
        // console.log(`🎭 Shadows reconfigured for LOD ${lodLevel}: ${newRes}x${newRes} resolution, ${frustumSize*2}x${frustumSize*2} coverage`);

        // Low-end profile tip tracking (silent)
        if (lodLevel <= 30 && !gfx.lastLowEndTip) {
          gfx.lastLowEndTip = true;
        } else if (lodLevel > 30) {
          gfx.lastLowEndTip = false; // Reset tip for next low-end activation
        }
        
      } catch (error) {
        // Fallback: try to reinitialize (silent) with current lighting
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
        // For table: skip floor/underside parts, but allow edges/sides/corners to receive shadows
        const isTableFloor = mesh.name === 'FLOOR' || mesh.name.includes('floor_') || mesh.name.includes('tableFloor');
        // Table sides (N,E,S,W), corners (SW,SE,NE,NW), and tops (NT,ET,ST,WT) should receive shadows
        const isTableSideOrCorner = 
          (mesh.name.length === 1 && ['N', 'E', 'S', 'W'].includes(mesh.name)) ||
          (mesh.name.length === 2 && ['SW', 'SE', 'NE', 'NW', 'NT', 'ET', 'ST', 'WT'].includes(mesh.name)) ||
          mesh.name.includes('edge_') || mesh.name.includes('corner_');
        const isUIMesh = isTableFloor ||
                        (mesh.name.includes('table') && !isTableSideOrCorner) ||
                        mesh.name.includes('UI') ||
                        mesh.name.includes('radial') ||
                        mesh.name.includes('HUD') ||
                        mesh.name.includes('hud') ||
                        mesh.name.includes('minimap') ||
                        mesh.name.includes('mountain') || // Skip mountains!
                        mesh.name.includes('Mountain') || // Skip mountains!
                        mesh.name.includes('horizon') || // Skip horizon!
                        mesh.name.includes('vista') || // Skip vista elements!
                        // Check if mesh is a child of a UI parent
                        // Skip children of background/UI elements (but not table children since sides should receive shadows)
                        (mesh.parent && mesh.parent.name && (
                          mesh.parent.name.includes('radial') ||
                          mesh.parent.name.includes('Radial') ||
                          mesh.parent.name.includes('HUD') ||
                          mesh.parent.name.includes('hud') ||
                          mesh.parent.name.includes('minimap') ||
                          mesh.parent.name.includes('Minimap') ||
                          mesh.parent.name.includes('mountain') || // Skip mountain children
                          mesh.parent.name.includes('horizon') // Skip horizon children
                        ));
        if (isUIMesh) return;
        
        // All game meshes can receive shadows (or not) - skip instanced meshes
        if (!mesh.isAnInstance) {
          mesh.receiveShadows = window.SHADOWS_ENABLED;
        }
        if (window.SHADOWS_ENABLED) receiveShadowCount++;
        
        // Only non-terrain meshes should cast shadows
        // Also skip __root__ nodes which are empty containers from glTF imports
        const isTerrainMesh = mesh.name.includes('terrainMesh') || mesh.name.includes('Mesh');
        const isRootNode = mesh.name.includes('__root__');
        
        if (window.SHADOWS_ENABLED && !isTerrainMesh && !isRootNode && gfx.shadowGenerator) {
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
            // Skip instanced meshes - they can't receive shadows
            if (child.isAnInstance) return;
            child.receiveShadows = window.SHADOWS_ENABLED;
            const isChildRoot = child.name.includes('__root__');
            if (window.SHADOWS_ENABLED && !isTerrainMesh && !isRootNode && !isChildRoot && forceReadd && gfx.shadowGenerator) {
              gfx.shadowGenerator.removeShadowCaster(child);
              gfx.shadowGenerator.addShadowCaster(child);
              shadowCasterCount++;
            } else if (window.SHADOWS_ENABLED && !isTerrainMesh && !isRootNode && !isChildRoot && !forceReadd && gfx.shadowGenerator) {
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
        // console.log(`🎭 Shadow update: ${shadowCasterCount} new casters, ${receiveShadowCount} receivers, ${totalCasters} total casters`);
      } else if (!window.SHADOWS_ENABLED && gfx.shadowGenerator) {
        const totalCasters = gfx.shadowGenerator.getShadowMap().renderList.length;
        // console.log(`🎭 Shadows disabled: removed ${removedCount} meshes, ${totalCasters} casters remaining`);
      }
    };

  };
  
  // Helper function to set up shadows for a mesh with LoD support
  gfx.setupMeshShadows = function(mesh, shouldCastShadows = true) {
    if (!mesh) return;
    
    // ALWAYS set receiveShadows even if generator doesn't exist yet
    // (the generator may be created later and updateAllMeshShadows will handle casters)
    
    // Skip UI elements, indicators, and background elements
    // For table: skip floor/underside, but allow sides/corners to receive shadows
      const isTableFloor = mesh.name === 'FLOOR' || mesh.name.includes('floor_') || mesh.name.includes('tableFloor');
      // Table sides (N,E,S,W), corners (SW,SE,NE,NW), and tops (NT,ET,ST,WT) should receive shadows
      const isTableSideOrCorner = 
        (mesh.name.length === 1 && ['N', 'E', 'S', 'W'].includes(mesh.name)) ||
        (mesh.name.length === 2 && ['SW', 'SE', 'NE', 'NW', 'NT', 'ET', 'ST', 'WT'].includes(mesh.name)) ||
        mesh.name.includes('edge_') || mesh.name.includes('corner_');
      const isUIMesh = isTableFloor ||
                      (mesh.name.includes('table') && !isTableSideOrCorner) ||
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
                      mesh.name.includes('mountain') || // Skip mountains!
                      mesh.name.includes('Mountain') ||
                      mesh.name.includes('horizon') || // Skip horizon!
                      mesh.name.includes('vista') || // Skip vista!
                      // Skip children of background/UI elements
                      (mesh.parent && mesh.parent.name && (
                        mesh.parent.name.includes('radial') ||
                        mesh.parent.name.includes('Radial') ||
                        mesh.parent.name.includes('HUD') ||
                        mesh.parent.name.includes('hud') ||
                        mesh.parent.name.includes('minimap') ||
                        mesh.parent.name.includes('Minimap') ||
                        mesh.parent.name.includes('mountain') ||
                        mesh.parent.name.includes('horizon')
                      ));
    if (isUIMesh) return;
    
    // Always set receiveShadows based on current state (skip instanced meshes)
    if (!mesh.isAnInstance) {
      mesh.receiveShadows = window.SHADOWS_ENABLED;
    }
    
    // Mesh will be tracked by the existing LOD system
    
    // Only add to shadow generator if shadows are enabled, should cast, AND generator exists
    if (window.SHADOWS_ENABLED && shouldCastShadows && gfx.shadowGenerator) {
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
        if (childMesh.isAnInstance) return; // Skip instanced meshes
        
        childMesh.receiveShadows = window.SHADOWS_ENABLED;
        if (window.SHADOWS_ENABLED && shouldCastShadows && gfx.shadowGenerator) {
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
  
  // DEBUG: Camera pivot/target diagnostics
  gfx.debugCamera = function() {
    console.log('=== CAMERA DIAGNOSTICS ===');
    
    if (!gfx.camera) {
      console.log('❌ No camera');
      return;
    }
    
    const cam = gfx.camera;
    const target = gfx.cameraTarget;
    
    console.log('Camera position:', cam.position);
    console.log('Camera alpha (horizontal rotation):', cam.alpha?.toFixed(2));
    console.log('Camera beta (vertical angle):', cam.beta?.toFixed(2));
    console.log('Camera radius (zoom distance):', cam.radius?.toFixed(2));
    
    if (target) {
      console.log('Camera target (pivot point):', target.position);
      console.log('  X:', target.position.x?.toFixed(2));
      console.log('  Y:', target.position.y?.toFixed(2), '(fixed height)');
      console.log('  Z:', target.position.z?.toFixed(2));
    }
    
    if (window.cameraAnchor) {
      console.log('Camera anchor (desired target):', window.cameraAnchor);
    }
    
    // Field info
    if (window.liveField) {
      const TILE_SIZE = window.TILE_SIZE || 4;
      const fieldCenterX = (window.liveField.width * TILE_SIZE) / 2;
      const fieldCenterZ = (window.liveField.height * TILE_SIZE) / 2;
      console.log('Field size:', window.liveField.width, 'x', window.liveField.height, 'tiles');
      console.log('Field center (world):', fieldCenterX.toFixed(2), fieldCenterZ.toFixed(2));
      
      if (target) {
        const offsetX = target.position.x - fieldCenterX;
        const offsetZ = target.position.z - fieldCenterZ;
        console.log('Camera offset from field center:', offsetX.toFixed(2), offsetZ.toFixed(2));
      }
    }
    
    console.log('=== END CAMERA DIAGNOSTICS ===');
  };
  
  // DEBUG: Comprehensive shadow diagnostics
  gfx.debugShadows = function() {
    console.log('=== SHADOW DIAGNOSTICS ===');
    console.log('SHADOWS_ENABLED:', window.SHADOWS_ENABLED);
    console.log('scene.shadowsEnabled:', gfx.scene?.shadowsEnabled);
    console.log('shadowGenerator exists:', !!gfx.shadowGenerator);
    
    if (gfx.shadowGenerator) {
      const sg = gfx.shadowGenerator;
      const shadowMap = sg.getShadowMap();
      console.log('Shadow map size:', shadowMap?.getSize());
      console.log('Shadow casters count:', shadowMap?.renderList?.length);
      console.log('First 5 casters:', shadowMap?.renderList?.slice(0, 5).map(m => m.name));
      console.log('darkness:', sg.darkness);
      console.log('bias:', sg.bias);
      console.log('normalBias:', sg.normalBias);
      console.log('usePercentageCloserFiltering:', sg.usePercentageCloserFiltering);
      console.log('useExponentialShadowMap:', sg.useExponentialShadowMap);
      console.log('useBlurExponentialShadowMap:', sg.useBlurExponentialShadowMap);
      console.log('usePoissonSampling:', sg.usePoissonSampling);
      console.log('forceBackFacesOnly:', sg.forceBackFacesOnly);
      
      // Check the light
      const light = sg.getLight();
      console.log('Light:', light?.name);
      console.log('Light enabled:', light?.isEnabled());
      console.log('Light shadowEnabled:', light?.shadowEnabled);
      console.log('Light direction:', light?.direction);
      console.log('Light position:', light?.position);
      console.log('Light shadowMinZ:', light?.shadowMinZ);
      console.log('Light shadowMaxZ:', light?.shadowMaxZ);
      console.log('Light shadowOrthoScale:', light?.shadowOrthoScale);
      console.log('Light autoUpdateExtends:', light?.autoUpdateExtends);
      console.log('Light autoCalcShadowZBounds:', light?.autoCalcShadowZBounds);
      
      // Check shadow camera
      const shadowCamera = sg.getShadowMap()?.getScene()?.activeCamera;
      console.log('Shadow map active:', shadowMap?.isReady());
    }
    
    // Check terrain meshes
    const terrainMeshes = gfx.scene?.meshes.filter(m => m.name.includes('terrain') || m.name.includes('grass') || m.name.includes('Mesh'));
    console.log('Terrain-like meshes:', terrainMeshes?.length);
    if (terrainMeshes?.length > 0) {
      const sample = terrainMeshes[0];
      console.log('Sample terrain mesh:', sample.name);
      console.log('  receiveShadows:', sample.receiveShadows);
      console.log('  isVisible:', sample.isVisible);
      console.log('  material:', sample.material?.name);
    }
    
    // Check model meshes (potential casters)
    const modelMeshes = gfx.scene?.meshes.filter(m => 
      !m.name.includes('terrain') && 
      !m.name.includes('Mesh') && 
      !m.name.includes('table') &&
      !m.name.includes('ground') &&
      m.isVisible
    );
    console.log('Potential shadow caster meshes:', modelMeshes?.length);
    if (modelMeshes?.length > 0) {
      console.log('First 5 model meshes:', modelMeshes.slice(0, 5).map(m => ({
        name: m.name,
        receiveShadows: m.receiveShadows,
        isVisible: m.isVisible,
        isEnabled: m.isEnabled()
      })));
    }
    
    console.log('=== END DIAGNOSTICS ===');
  };
  
  // LoD-based shadow caster management - integrated with existing LOD system
  gfx.updateShadowLOD = function() {
    if (!gfx.shadowGenerator || !window.SHADOWS_ENABLED || !gfx.shadowLODConfig.enabled) return;
    
    const currentTime = Date.now();
    if (currentTime - gfx.lastShadowUpdate < gfx.shadowLODConfig.updateInterval) return;
    
    gfx.lastShadowUpdate = currentTime;
    
    // Use camera TARGET position (ground level) not camera position (high up when zoomed out)
    // This prevents shadows from disappearing just because you zoomed out
    const targetPos = gfx.cameraTarget ? gfx.cameraTarget.position : gfx.camera?.position;
    if (!targetPos) return;
    
    let activeShadowCasters = 0;
    let culledShadowCasters = 0;
    
    // Use the existing lodModels array for shadow LoD
    lodModels.forEach(lod => {
      if (!lod.model || !lod.model.position) return;
      
      // Calculate 2D distance (XZ plane) - shadows are about ground coverage, not camera height
      const dx = targetPos.x - lod.model.position.x;
      const dz = targetPos.z - lod.model.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
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
    // Set better default camera angle: alpha=-2.5 (horizontal), beta=1.1 (looking down more)
    
    // CRITICAL: Position camera at the default player agora location
    // Default player agora is at (15, 15) in tile coordinates (see player.js line 40)
    // This is where the agora spawns in both menu scene and games
    const defaultAgoraX = 15;
    const defaultAgoraZ = 15;
    const initialX = defaultAgoraX * TILE_SIZE;
    const initialZ = defaultAgoraZ * TILE_SIZE;
    const initialY = 9;
    
    let camera = new BABYLON.ArcRotateCamera("zCamera", -2.5, 1.1, radius, new Vec3(initialX, initialY, initialZ), scene);
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

    camera.upperRadiusLimit = 150; // Reduced for closer zoom out
    camera.lowerRadiusLimit = 21;  // Closer minimum zoom (39% closer than before)
    camera.upperBetaLimit = 1.2; // Reduced to prevent looking too high when zoomed out
    camera.lowerBetaLimit = 0.5; // Allow looking more down when zoomed out
    camera.maxZ = 50000; // extend far plane to avoid terrain popping on wide zoom
    camera.minZ = 0.1; // allow closer near plane for low zoom
    camera.fov = .8; // default .8

    // Safety clamps
    const clampCamera = () => {
      if (!camera) return;
      // Ensure finite camera parameters to prevent scene disappearing
      if (!Number.isFinite(camera.alpha)) camera.alpha = 0;
      if (!Number.isFinite(camera.beta)) camera.beta = 1.1;
      if (!Number.isFinite(camera.radius)) camera.radius = 80;
      // Keep beta reasonable
      if (typeof camera.lowerBetaLimit === 'number' && typeof camera.upperBetaLimit === 'number') {
        camera.beta = Math.max(camera.lowerBetaLimit, Math.min(camera.upperBetaLimit, camera.beta));
      } else {
        camera.beta = Math.max(0.2, Math.min(1.5, camera.beta));
      }
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
    // Position above the map center looking down
    const field = window.liveField;
    const centerX = field ? (field.width * TILE_SIZE) / 2 : 128;
    const centerZ = field ? (field.height * TILE_SIZE) / 2 : 128;
    
    let camera = new BABYLON.UniversalCamera("forgeCamera", new Vec3(centerX, 150, centerZ), scene);
    
    // Look down at the terrain (pitch down ~60 degrees)
    camera.rotation.x = Math.PI / 3; // 60 degrees down
    camera.rotation.y = 0;
    
    // Camera settings
    camera.fov = 0.8;
    camera.minZ = 1;
    camera.maxZ = 2000;
    
    // Disable all built-in controls - forge.js will handle input
    camera.inputs.clear();
    
    return camera;
  };

  // Expose getModel function publicly
  gfx.getModel = getModel;
  
  // Expose createTerrainMesh for forge
  gfx.createTerrainMesh = createTerrainMesh;
  
  // Expose placeDecorationsOnChunk for forge
  gfx.placeDecorationsOnChunk = placeDecorationsOnChunk;
  
  // Expose model cleanup function for chunk management
  gfx.cleanupChunkModels = cleanupChunkModels;
  
  // Clear chunk queue when switching fields
  gfx.clearChunkQueue = function() {
    chunkQueue.length = 0;
  };
  
  // Clear resource registries when starting a new match
  gfx.clearResourceRegistries = function() {
    // CRITICAL: Actually DISPOSE all registered resource meshes, not just disable them
    // Disabling leaves them in the scene and they can reappear when LOD updates
    let disposedCount = 0;
    for (const [key, mesh] of resourceModelRegistry.entries()) {
      if (mesh && mesh.dispose) {
        mesh.dispose();
        disposedCount++;
      }
    }
    
    resourceModelRegistry.clear();
    pendingResourceTiles.clear();
    depletedResourceTiles.clear();
    
    // console.log(`✅ Resource registries cleared - disposed ${disposedCount} resource meshes`);
  };
  
  // Dynamic table parts storage (for custom map shapes)
  gfx._dynamicTableParts = [];
  
  // Rebuild table to match chunk mask shape (for custom maps)
  gfx.rebuildTableFromChunkMask = function() {
    const field = window.liveField;
    if (!field || !field.chunkMask || !gfx.scene) return;
    
    console.log('🔄 Rebuilding table from chunk mask...');
    
    // Dispose old dynamic table parts
    if (gfx._dynamicTableParts) {
      gfx._dynamicTableParts.forEach(m => {
        if (m && m.dispose) m.dispose();
      });
    }
    gfx._dynamicTableParts = [];
    
    // Hide the original static table parts
    const table = gfx.table;
    if (table && table.parts) {
      Object.values(table.parts).forEach(part => {
        if (part && part.mesh) part.mesh.isVisible = false;
      });
    }
    
    const chunkWorldSize = field.chunkSize * TILE_SIZE;
    const chunksX = Math.ceil(field.width / field.chunkSize);
    const chunksZ = Math.ceil(field.height / field.chunkSize);
    
    // Find boundary edges by checking each chunk's neighbors
    const edges = [];
    const corners = [];
    
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = `${cx},${cz}`;
        if (field.chunkMask.get(key) === false) continue;
        
        const neighbors = {
          N: cz < chunksZ - 1 ? field.chunkMask.get(`${cx},${cz + 1}`) !== false : false,
          S: cz > 0 ? field.chunkMask.get(`${cx},${cz - 1}`) !== false : false,
          E: cx < chunksX - 1 ? field.chunkMask.get(`${cx + 1},${cz}`) !== false : false,
          W: cx > 0 ? field.chunkMask.get(`${cx - 1},${cz}`) !== false : false
        };
        
        if (!neighbors.N) edges.push({ cx, cz, dir: 'N' });
        if (!neighbors.S) edges.push({ cx, cz, dir: 'S' });
        if (!neighbors.E) edges.push({ cx, cz, dir: 'E' });
        if (!neighbors.W) edges.push({ cx, cz, dir: 'W' });
        
        // Convex corners
        if (!neighbors.N && !neighbors.E) corners.push({ cx, cz, type: 'convex', corner: 'NE' });
        if (!neighbors.N && !neighbors.W) corners.push({ cx, cz, type: 'convex', corner: 'NW' });
        if (!neighbors.S && !neighbors.E) corners.push({ cx, cz, type: 'convex', corner: 'SE' });
        if (!neighbors.S && !neighbors.W) corners.push({ cx, cz, type: 'convex', corner: 'SW' });
        
        // Concave corners
        const diagNE = (cx < chunksX - 1 && cz < chunksZ - 1) ? field.chunkMask.get(`${cx + 1},${cz + 1}`) !== false : false;
        const diagNW = (cx > 0 && cz < chunksZ - 1) ? field.chunkMask.get(`${cx - 1},${cz + 1}`) !== false : false;
        const diagSE = (cx < chunksX - 1 && cz > 0) ? field.chunkMask.get(`${cx + 1},${cz - 1}`) !== false : false;
        const diagSW = (cx > 0 && cz > 0) ? field.chunkMask.get(`${cx - 1},${cz - 1}`) !== false : false;
        
        if (neighbors.N && neighbors.E && !diagNE) corners.push({ cx, cz, type: 'concave', corner: 'NE' });
        if (neighbors.N && neighbors.W && !diagNW) corners.push({ cx, cz, type: 'concave', corner: 'NW' });
        if (neighbors.S && neighbors.E && !diagSE) corners.push({ cx, cz, type: 'concave', corner: 'SE' });
        if (neighbors.S && neighbors.W && !diagSW) corners.push({ cx, cz, type: 'concave', corner: 'SW' });
      }
    }
    
    console.log(`   Found ${edges.length} edges, ${corners.length} corners`);
    
    // Get materials from original table
    const edgeMat = table?.parts?.materials?.side;
    const cornerMat = table?.parts?.materials?.corner;
    const floorMat = table?.parts?.materials?.floor;
    
    // Edge dimensions - extended down to cover gap to floor (floor is at Y=-0.777)
    // Original: height=1.2, Y=0.5 → bottom at -0.1, top at 1.1
    // New: keep top at 1.1, extend bottom to -0.9 (below floor)
    const edgeHeight = 2.0;    // Taller to reach below floor
    const edgeThickness = 4.0;
    const edgeY = 0.1;         // Lower center point to extend bottom down
    const edgeAngle = 0.11;
    
    // Create edge pieces
    edges.forEach(edge => {
      const worldX = edge.cx * chunkWorldSize;
      const worldZ = edge.cz * chunkWorldSize;
      
      const mesh = BABYLON.MeshBuilder.CreateBox(`edge_${edge.cx}_${edge.cz}_${edge.dir}`, { size: 1 }, gfx.scene);
      if (edgeMat) mesh.material = edgeMat;
      
      switch (edge.dir) {
        case 'N':
          mesh.position.set(worldX + chunkWorldSize / 2, edgeY, worldZ + chunkWorldSize);
          mesh.scaling.set(chunkWorldSize, edgeHeight, edgeThickness);
          mesh.rotation.set(edgeAngle, 0, 0);
          break;
        case 'S':
          mesh.position.set(worldX + chunkWorldSize / 2, edgeY, worldZ);
          mesh.scaling.set(chunkWorldSize, edgeHeight, edgeThickness);
          mesh.rotation.set(-edgeAngle, 0, 0);
          break;
        case 'E':
          mesh.position.set(worldX + chunkWorldSize, edgeY, worldZ + chunkWorldSize / 2);
          mesh.scaling.set(edgeThickness, edgeHeight, chunkWorldSize);
          mesh.rotation.set(0, 0, -edgeAngle);
          break;
        case 'W':
          mesh.position.set(worldX, edgeY, worldZ + chunkWorldSize / 2);
          mesh.scaling.set(edgeThickness, edgeHeight, chunkWorldSize);
          mesh.rotation.set(0, 0, edgeAngle);
          break;
      }
      
      gfx._dynamicTableParts.push(mesh);
    });
    
    // Create corner pieces - extended down to match edges
    const cornerSize = 7.0;
    const cornerHeight = 4.0;  // Taller to extend below floor
    const cornerY = -0.1;      // Lower center point
    
    corners.forEach(corner => {
      const worldX = corner.cx * chunkWorldSize;
      const worldZ = corner.cz * chunkWorldSize;
      
      const mesh = BABYLON.MeshBuilder.CreateBox(`corner_${corner.cx}_${corner.cz}_${corner.corner}`, { size: 1 }, gfx.scene);
      if (cornerMat) mesh.material = cornerMat;
      mesh.scaling.set(cornerSize, cornerHeight, cornerSize);
      
      let px = worldX, pz = worldZ;
      if (corner.corner.includes('E')) px += chunkWorldSize;
      if (corner.corner.includes('N')) pz += chunkWorldSize;
      
      mesh.position.set(px, cornerY, pz);
      gfx._dynamicTableParts.push(mesh);
    });
    
    // Create floor for enabled chunks
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const key = `${cx},${cz}`;
        if (field.chunkMask.get(key) === false) continue;
        
        const worldX = cx * chunkWorldSize;
        const worldZ = cz * chunkWorldSize;
        
        const floor = BABYLON.MeshBuilder.CreateBox(`floor_${cx}_${cz}`, { size: 1 }, gfx.scene);
        if (floorMat) floor.material = floorMat;
        floor.position.set(worldX + chunkWorldSize / 2, -0.777, worldZ + chunkWorldSize / 2);
        floor.scaling.set(chunkWorldSize, 0.4, chunkWorldSize);
        
        gfx._dynamicTableParts.push(floor);
      }
    }
    
    console.log(`✅ Table rebuilt with ${gfx._dynamicTableParts.length} pieces`);
  };
  
  // Check if chunk mask has any disabled chunks (non-rectangular map)
  gfx.hasCustomTableShape = function() {
    const field = window.liveField;
    if (!field || !field.chunkMask) return false;
    
    for (const [key, enabled] of field.chunkMask) {
      if (enabled === false) return true;
    }
    return false;
  };
  
  // Debug helper to check tree state at a grid position
  window.debugTreeAt = function(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    console.log(`🔍 Tree at (${gridX}, ${gridZ}):`);
    console.log('  Registry:', resourceModelRegistry.has(key) ? 'EXISTS' : 'MISSING');
    console.log('  Depleted:', depletedResourceTiles.has(key) ? 'YES' : 'NO');
    
    if (resourceModelRegistry.has(key)) {
      const mesh = resourceModelRegistry.get(key);
      console.log('  Position:', mesh.getAbsolutePosition());
      console.log('  Enabled:', mesh.isEnabled());
      console.log('  Visible:', mesh.isVisible);
      console.log('  Children:', mesh.getChildren().length);
      mesh.getChildren().forEach((child, i) => {
        console.log(`    Child ${i}:`, child.name, 'enabled:', child.isEnabled());
      });
    }
    
    // Check if there are nearby trees
    console.log('  Nearby trees:');
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const nearKey = `${gridX + dx},${gridZ + dz}`;
        if (resourceModelRegistry.has(nearKey)) {
          const nearMesh = resourceModelRegistry.get(nearKey);
          const pos = nearMesh.getAbsolutePosition();
          console.log(`    (${gridX + dx}, ${gridZ + dz}): enabled=${nearMesh.isEnabled()}, pos=(${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
        }
      }
    }
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
    // console.log('🏔️ Mountains recreated');
  };
  
  // Simple mountain background using Babylon's ground mesh with procedural height simulation
  // Creates a distant mountain vista far below, like looking down at an endless landscape from high above
  function createSimpleMountains(scene, fieldSize = 64) {
    // Skip creation entirely if LOD is set to 0 (billboard-only mode)
    const savedLOD = localStorage.getItem('lodLevel');
    if (savedLOD && parseInt(savedLOD) === 0) {
      return null;
    }
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
    const subdivisions = 32; // Keep poly count modest
    
    // console.log(`🏔️ Mountain vista params: field=${actualFieldWidth}x${actualFieldHeight}, plane size=${mountainSize}`);
    
    // Create one big plane
    const mountainGround = BABYLON.MeshBuilder.CreateGround("mountainGround", {width: mountainSize, height: mountainSize, subdivisions: subdivisions}, scene);
    
    // Position - VERY FAR below the table to create vista effect
    mountainGround.position.x = fieldCenterX;
    mountainGround.position.z = fieldCenterZ;
    mountainGround.position.y = -170; // Lower to avoid intersecting table
    
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
      const distanceCurve = Math.pow(normalizedDist, 0.85); // Slightly stronger central presence
      
      let height = 0;
      
      // Only add height if not in the center
      // Base height keeps some relief near center, grows outward
      const baseHeight = (0.25 + distanceCurve * 0.75) * 140; // Lower amplitude to keep below table
      
      // Random noise - always present, stronger outward
      const noiseStrength = 0.6 + distanceCurve * 1.0; // Some variation even in center
      let hashX = Math.floor(x);
      let hashZ = Math.floor(z);
      let hash = seed;
      hash = ((hash << 13) ^ hash) >>> 0;
      hash = ((hash * (hash * hash * 15731 + 789221) + 1376312589 + hashX * 73856093 + hashZ * 19349663) & 0xffffffff) >>> 0;
      const randomNoise = (Math.sin(hash * 0.5) + Math.sin(hash * 0.1) * 0.5) * noiseStrength * 60;
      
      // High-frequency jagged component for sharper peaks
      const jagged = (Math.abs(Math.sin(x * 0.08 + z * 0.06 + seed * 0.2)) - 0.5) * noiseStrength * 40;
      
      // Cross-axis ridges for more isotropic relief (avoid one-direction waves)
      const ridge = (Math.sin(x * 0.014 + seed * 0.1) + Math.sin(z * 0.014 + seed * 0.13)) * distanceCurve * 32;
      
      // Add small high-frequency jitter that is not distance-weighted to break flat rims
      const jitter = (Math.sin(x * 0.21 + seed * 0.7) + Math.sin(z * 0.23 + seed * 0.9)) * 12;
      
      height = baseHeight + randomNoise + jagged + ridge + jitter;
      
      // Cap to avoid intersecting the table plane (looser cap to preserve edge relief)
      height = Math.min(height, 170);
      
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
    
    // Mountains are background elements - don't involve in shadows at all
    mountainGround.receiveShadows = false;
    
    // console.log('🏔️ Mountain vista ready - flat center with increasing randomness outward!');
    
    // Create a horizon plane to show the distant mountains meeting the sky
    // This creates visual reference for the vast distance below
    const horizon = createHorizon(scene, fieldCenterX, fieldCenterZ, mountainSize);
    if (horizon) {
      horizon.position.y = -69; // Explicit world height for visible mist
      window.gfx.horizon = horizon; // Track for later removal
      // Horizon is a background element - don't involve it in shadows at all
      horizon.receiveShadows = false;
    }
    
    return mountainGround;
  }

  // Remove mountains and horizon if present
  gfx.removeMountains = function() {
    if (gfx.mountains && gfx.mountains.dispose) {
      try { gfx.mountains.dispose(); } catch (e) {}
    }
    gfx.mountains = null;
    if (gfx.horizon && gfx.horizon.dispose) {
      try { gfx.horizon.dispose(); } catch (e) {}
    }
    gfx.horizon = null;
  };
  
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
    horizonPlane.position.y = 100; // World height for mist band
    
    // Create horizon material - dark solid band
    const horizonMat = new BABYLON.StandardMaterial("horizonMat", scene);
    horizonMat.diffuseColor = new BABYLON.Color3(0.75, 0.82, 0.9); // Cool mist tint
    horizonMat.emissiveColor = new BABYLON.Color3(0.35, 0.45, 0.55); // Glow to read as haze
    horizonMat.alpha = 1.0; // Opaque band (no transparency)
    horizonMat.backFaceCulling = false;
    horizonMat.disableLighting = true; // Keep color consistent as a fog bank
    horizonMat.depthWrite = true; // Opaque draw, relies on color/lighting instead of alpha
    
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

  // Animate a model sinking into the ground (used for clearing)
  function animateModelSink(mesh, delay = 0) {
    if (!mesh) return;
    
    // Unfreeze if frozen (frozen meshes can't be animated)
    if (mesh.metadata && mesh.metadata.isFrozen && mesh.unfreezeWorldMatrix) {
      mesh.unfreezeWorldMatrix();
      mesh.metadata.isFrozen = false;
      mesh.getChildMeshes && mesh.getChildMeshes().forEach(childMesh => {
        if (childMesh.unfreezeWorldMatrix) {
          childMesh.unfreezeWorldMatrix();
        }
      });
    }
    
    const startY = mesh.position.y;
    const targetY = startY - 8; // Sink 8 units down
    const duration = 800; // 0.8 seconds
    let startTime = null;
    
    const animateSink = () => {
      if (startTime === null) {
        startTime = Date.now();
      }
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease in - accelerate as it falls
      const easeIn = progress * progress;
      
      // Update Y position
      mesh.position.y = startY + (targetY - startY) * easeIn;
      
      if (progress < 1) {
        requestAnimationFrame(animateSink);
      } else {
        // Animation done - disable completely
        mesh.setEnabled(false);
        mesh.getChildren && mesh.getChildren().forEach(child => {
          if (child.setEnabled) {
            child.setEnabled(false);
          }
        });
      }
    };
    
    // Start after delay (staggered effect)
    if (delay > 0) {
      setTimeout(animateSink, delay);
    } else {
      animateSink();
    }
  }
  
  // Clear resource models (rocks, trees) from a circular area with animation
  // Used by demo mode to create a clear spawn zone
  gfx.clearModelsInArea = function(centerX, centerZ, radius) {
    const TILE_SIZE = window.TILE_SIZE || 4;
    const radiusWorld = radius * TILE_SIZE;
    const radiusSq = radiusWorld * radiusWorld;
    
    let removedCount = 0;
    const modelsToAnimate = [];
    
    // Iterate through all active models and collect those in the area
    activeModels.forEach((models, chunkKey) => {
      const modelsToKeep = [];
      
      models.forEach(modelInfo => {
        if (!modelInfo.model || !modelInfo.model.root) {
          modelsToKeep.push(modelInfo);
          return;
        }
        
        const pos = modelInfo.model.root.position;
        const dx = pos.x - centerX * TILE_SIZE;
        const dz = pos.z - centerZ * TILE_SIZE;
        const distSq = dx * dx + dz * dz;
        
        if (distSq <= radiusSq) {
          // Collect for animated removal
          const dist = Math.sqrt(distSq);
          modelsToAnimate.push({ modelInfo, dist, chunkKey });
          removedCount++;
        } else {
          modelsToKeep.push(modelInfo);
        }
      });
      
      // Update the active models for this chunk (remove the ones we're animating)
      if (modelsToKeep.length > 0) {
        activeModels.set(chunkKey, modelsToKeep);
      } else {
        activeModels.delete(chunkKey);
      }
    });
    
    // Sort by distance from center - center models sink first (ripple effect)
    modelsToAnimate.sort((a, b) => a.dist - b.dist);
    
    // Animate each model with staggered delay
    modelsToAnimate.forEach((item, index) => {
      const mesh = item.modelInfo.model.root;
      const delay = index * 50; // 50ms stagger between each model
      
      // Remove from LOD tracking immediately (use function that also cleans up blob shadows)
      removeModelFromLOD(mesh);
      
      // Start the sink animation
      animateModelSink(mesh, delay);
    });
    
    // Also animate billboard instances in the area
    let billboardsRemoved = 0;
    for (let i = billboardInstances.length - 1; i >= 0; i--) {
      const instance = billboardInstances[i];
      if (!instance || !instance.position) continue;
      
      const dx = instance.position.x - centerX * TILE_SIZE;
      const dz = instance.position.z - centerZ * TILE_SIZE;
      const distSq = dx * dx + dz * dz;
      
      if (distSq <= radiusSq) {
        // Disable/hide the billboard (no animation for these, they're 2D)
        if (instance.setEnabled) {
          instance.setEnabled(false);
        }
        billboardsRemoved++;
      }
    }
    
    if (removedCount > 0 || billboardsRemoved > 0) {
      console.log(`🧹 Animating ${removedCount} models sinking from area at (${centerX}, ${centerZ}) radius ${radius}`);
    }
    
    return removedCount + billboardsRemoved;
  };

  // ========================================
  // BLOB SHADOW SYSTEM
  // ========================================
  // Cheap circular shadows under units (alternative to shadow mapping)
  // Uses thin instances for efficient rendering of many shadows
  
  let blobShadowMaterialGradient = null;
  let blobShadowMaterialSolid = null;
  let blobShadowTexture = null;
  let blobShadowsVisible = false;
  let blobShadowStyle = 'gradient'; // 'solid' or 'gradient'
  
  // Thin instance data
  let blobShadowSourceMesh = null; // Single source mesh for all instances
  const blobShadowUnits = []; // Array of units with blob shadows
  const blobShadowRadii = new Map(); // unit -> radius
  let blobShadowsDirty = false; // Need to rebuild instance buffer
  
  // Create a gradient shadow texture (dark center, fading edges)
  function getBlobShadowTexture() {
    if (!blobShadowTexture && gfx.scene) {
      const size = 64;
      blobShadowTexture = new BABYLON.DynamicTexture("blobShadowTex", size, gfx.scene, false);
      const ctx = blobShadowTexture.getContext();
      
      // Create radial gradient - dark center fading to transparent
      const centerX = size / 2;
      const centerY = size / 2;
      const radius = size / 2;
      
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');   // Darker center
      gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.65)'); // Darker mid
      gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.35)'); // Darker fade
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');      // Transparent edge
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      
      blobShadowTexture.update();
      blobShadowTexture.hasAlpha = true;
    }
    return blobShadowTexture;
  }
  
  // Create the gradient blob shadow material (with alpha/transparency)
  function getBlobShadowMaterialGradient() {
    if (!blobShadowMaterialGradient && gfx.scene) {
      blobShadowMaterialGradient = new BABYLON.StandardMaterial("blobShadowMatGradient", gfx.scene);
      blobShadowMaterialGradient.diffuseTexture = getBlobShadowTexture();
      blobShadowMaterialGradient.diffuseTexture.hasAlpha = true;
      blobShadowMaterialGradient.useAlphaFromDiffuseTexture = true;
      blobShadowMaterialGradient.emissiveColor = new BABYLON.Color3(0, 0, 0);
      blobShadowMaterialGradient.specularColor = new BABYLON.Color3(0, 0, 0);
      blobShadowMaterialGradient.backFaceCulling = false;
      blobShadowMaterialGradient.disableLighting = true;
      blobShadowMaterialGradient.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    }
    return blobShadowMaterialGradient;
  }
  
  // Create the solid blob shadow material (no transparency - cheapest)
  function getBlobShadowMaterialSolid() {
    if (!blobShadowMaterialSolid && gfx.scene) {
      blobShadowMaterialSolid = new BABYLON.StandardMaterial("blobShadowMatSolid", gfx.scene);
      // Dark gray-green to blend with grass (not pure black)
      blobShadowMaterialSolid.diffuseColor = new BABYLON.Color3(0.15, 0.18, 0.12);
      blobShadowMaterialSolid.emissiveColor = new BABYLON.Color3(0.08, 0.1, 0.06);
      blobShadowMaterialSolid.specularColor = new BABYLON.Color3(0, 0, 0);
      blobShadowMaterialSolid.backFaceCulling = false;
      blobShadowMaterialSolid.disableLighting = true;
    }
    return blobShadowMaterialSolid;
  }
  
  // Get the appropriate material based on current style
  function getBlobShadowMaterial() {
    return blobShadowStyle === 'solid' ? getBlobShadowMaterialSolid() : getBlobShadowMaterialGradient();
  }
  
  // Get or create the source mesh for thin instances
  function getOrCreateSourceMesh() {
    if (blobShadowSourceMesh && !blobShadowSourceMesh.isDisposed()) {
      // Update material if style changed
      blobShadowSourceMesh.material = getBlobShadowMaterial();
      return blobShadowSourceMesh;
    }
    
    // Use a ground plane - it's already flat, no rotation needed
    // This avoids matrix rotation complexity with thin instances
    blobShadowSourceMesh = BABYLON.MeshBuilder.CreateGround("blobShadowSource", {
      width: 1,
      height: 1
    }, gfx.scene);
    
    blobShadowSourceMesh.material = getBlobShadowMaterial();
    blobShadowSourceMesh.isPickable = false;
    blobShadowSourceMesh.receiveShadows = false;
    blobShadowSourceMesh.renderingGroupId = 0;
    // Disable frustum culling - instances can be anywhere
    blobShadowSourceMesh.alwaysSelectAsActiveMesh = true;
    
    return blobShadowSourceMesh;
  }
  
  // Calculate shadow radius for a unit
  function getShadowRadius(unit) {
    let shadowRadius = 0.6;
    const unitType = unit.type || unit.name || '';
    
    if (unitType === 'building' || unitType.includes('building')) {
      shadowRadius = 1.8;
    } else if (unit.isFlying) {
      shadowRadius = 0.45;
    } else if (unitType === 'frog' || unitType === 'villager' || unitType === 'gnome') {
      shadowRadius = 0.38;
    } else if (unitType === 'monk' || unitType === 'wizard' || unitType === 'engineer') {
      shadowRadius = 0.52;
    } else if (unitType === 'tree' || unitType.includes('tree')) {
      shadowRadius = 2;
    } else if (unitType === 'rock' || unitType.includes('rock')) {
      // Different rock types have different sizes
      const modelPath = unit.modelPath || '';
      if (modelPath.includes('snow')) {
        shadowRadius = 8.0;   // Snowy rocks are huge
      } else if (modelPath.includes('moss')) {
        shadowRadius = 4.5;   // Mossy rocks are medium
      } else {
        shadowRadius = 2.5;   // Plain rocks are small
      }
    }
    
    // Gradient mode shadows are bigger (75% larger than solid)
    if (blobShadowStyle === 'gradient') {
      shadowRadius *= 1.75;
    }
    
    return shadowRadius;
  }
  
  // Set blob shadow style
  gfx.setBlobShadowStyle = function(style) {
    if (blobShadowStyle === style) return;
    blobShadowStyle = style;
    
    // Force texture regeneration for new settings
    if (blobShadowTexture) {
      blobShadowTexture.dispose();
      blobShadowTexture = null;
    }
    if (blobShadowMaterialGradient) {
      blobShadowMaterialGradient.dispose();
      blobShadowMaterialGradient = null;
    }
    
    // Update source mesh material
    if (blobShadowSourceMesh && !blobShadowSourceMesh.isDisposed()) {
      blobShadowSourceMesh.material = getBlobShadowMaterial();
    }
    
    // Recalculate all radii for new style
    blobShadowUnits.forEach(unit => {
      blobShadowRadii.set(unit, getShadowRadius(unit));
    });
    
    blobShadowsDirty = true;
  };
  
  // Register a unit for blob shadow
  gfx.createBlobShadow = function(unit) {
    if (!unit || !gfx.scene) return;
    
    // Don't create duplicates
    if (blobShadowRadii.has(unit)) return;
    
    const radius = getShadowRadius(unit);
    blobShadowRadii.set(unit, radius);
    blobShadowUnits.push(unit);
    unit.blobShadow = true;
    
    blobShadowsDirty = true;
  };
  
  // Debug: log blob shadow stats
  window.logBlobShadowStats = function() {
    console.log('[BlobShadows] Total registered:', blobShadowUnits.length);
    console.log('[BlobShadows] Visible:', blobShadowsVisible);
    console.log('[BlobShadows] Style:', blobShadowStyle);
    
    const typeCounts = {};
    blobShadowUnits.forEach(unit => {
      const t = unit.type || unit.name || 'unknown';
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    console.log('[BlobShadows] By type:', typeCounts);
  };
  
  // Remove blob shadow for a unit
  gfx.removeBlobShadow = function(unit) {
    if (!unit) return;
    
    const idx = blobShadowUnits.indexOf(unit);
    if (idx > -1) {
      blobShadowUnits.splice(idx, 1);
    }
    blobShadowRadii.delete(unit);
    unit.blobShadow = null;
    
    blobShadowsDirty = true;
  };
  
  // Update blob shadow (no-op for thin instances - done in batch)
  gfx.updateBlobShadow = function(unit) {
    // Thin instances are updated all at once in updateAllBlobShadows
  };
  
  // Set visibility of all blob shadows
  gfx.setBlobShadowsVisible = function(visible) {
    blobShadowsVisible = visible;
    if (blobShadowSourceMesh && !blobShadowSourceMesh.isDisposed()) {
      blobShadowSourceMesh.setEnabled(visible && blobShadowUnits.length > 0);
    }
  };
  
  // Clear all blob shadows (called when starting a new match)
  gfx.clearAllBlobShadows = function() {
    blobShadowUnits.length = 0;
    blobShadowRadii.clear();
    blobShadowsDirty = true;
    
    // Hide the source mesh
    if (blobShadowSourceMesh && !blobShadowSourceMesh.isDisposed()) {
      blobShadowSourceMesh.thinInstanceCount = 0;
      blobShadowSourceMesh.setEnabled(false);
    }
  };
  
  // Create blob shadows for all existing units and decorations
  gfx.createBlobShadowsForAllUnits = function() {
    // FIRST: Clean up any stale blob shadow entries (disposed meshes, etc)
    // This prevents stacking when called multiple times
    for (let i = blobShadowUnits.length - 1; i >= 0; i--) {
      const unit = blobShadowUnits[i];
      const mesh = unit.mesh;
      // Remove if mesh is disposed or missing
      if (!mesh || (mesh.isDisposed && mesh.isDisposed())) {
        blobShadowUnits.splice(i, 1);
        blobShadowRadii.delete(unit);
      }
    }
    
    // Create for game units
    const units = window.gameUnits || [];
    units.forEach(unit => {
      if (unit.mesh && !blobShadowRadii.has(unit)) {
        gfx.createBlobShadow(unit);
      }
    });
    
    // Create for decoration models (trees, rocks, etc)
    lodModels.forEach(lod => {
      // Check if existing blobShadowObj still has valid mesh
      if (lod.blobShadowObj && lod.blobShadowObj.mesh) {
        const mesh = lod.blobShadowObj.mesh;
        if (mesh.isDisposed && mesh.isDisposed()) {
          // Mesh was disposed, clear the reference
          blobShadowRadii.delete(lod.blobShadowObj);
          lod.blobShadowObj = null;
        }
      }
      
      if (lod.isStatic && lod.model && !lod.blobShadowObj) {
        const decorObj = {
          type: lod.decorType || 'decoration',
          name: lod.decorType || 'decoration',
          mesh: lod.model,
          modelPath: lod.modelPath || ''
        };
        gfx.createBlobShadow(decorObj);
        lod.blobShadowObj = decorObj;
      }
    });
  };
  
  // Update all blob shadow positions using thin instances
  gfx.updateAllBlobShadows = function() {
    if (!blobShadowsVisible || blobShadowUnits.length === 0) {
      // Hide source mesh if no shadows
      if (blobShadowSourceMesh && !blobShadowSourceMesh.isDisposed()) {
        blobShadowSourceMesh.setEnabled(false);
      }
      return;
    }
    
    const source = getOrCreateSourceMesh();
    
    // Get camera TARGET for LOD culling (not position - camera is up in the air!)
    // Use the point the camera is looking at on the ground
    let camX = 0, camZ = 0;
    if (gfx.cameraTarget && gfx.cameraTarget.position) {
      // Use camera target (ground level)
      camX = gfx.cameraTarget.position.x;
      camZ = gfx.cameraTarget.position.z;
    } else if (gfx.camera && gfx.camera.target) {
      // Fallback to camera.target if available
      camX = gfx.camera.target.x;
      camZ = gfx.camera.target.z;
    } else if (gfx.camera && gfx.camera.position) {
      // Last resort - use camera position (will be offset)
      camX = gfx.camera.position.x;
      camZ = gfx.camera.position.z;
    }
    
    // Shadow cull distance - match LOD system
    // Use current LOD multiplier if available
    const baseCullDist = 80;
    const lodMultiplier = (window.hud && window.hud.getCurrentLODMultiplier) 
      ? window.hud.getCurrentLODMultiplier() 
      : 1.0;
    const cullDistSq = Math.pow(baseCullDist * lodMultiplier, 2);
    
    // Calculate sun direction and rotation once for all shadows
    let sunDirX = 0.7, sunDirZ = 0.7; // Default direction
    let sunAngle = Math.PI / 4; // Default 45 degree angle
    const shadowStretch = 2.0; // Stretch factor in sun direction (more elongated)
    
    if (window.lighting && window.lighting.lights && window.lighting.lights.sun) {
      const sunDir = window.lighting.lights.sun.direction;
      const len = Math.sqrt(sunDir.x * sunDir.x + sunDir.z * sunDir.z);
      if (len > 0.01) {
        sunDirX = sunDir.x / len;
        sunDirZ = sunDir.z / len;
        sunAngle = Math.atan2(sunDir.x, sunDir.z);
      }
    }
    
    // Offset distances based on object height (taller = further shadow)
    const OFFSET_UNIT = 0.3;     // Short units - close to feet
    const OFFSET_ROCK = 1.2;     // Medium height rocks
    const OFFSET_TREE = 2.5;     // Tall trees - shadow far from trunk
    
    // Pre-compute rotation quaternion for sun direction
    const sunRotation = BABYLON.Quaternion.FromEulerAngles(0, sunAngle, 0);
    
    // Build instance matrices
    const matrices = new Float32Array(blobShadowUnits.length * 16);
    const tempMatrix = BABYLON.Matrix.Identity();
    const scaling = BABYLON.Vector3.Zero();
    const position = BABYLON.Vector3.Zero();
    let visibleCount = 0;
    
    for (let i = 0; i < blobShadowUnits.length; i++) {
      const unit = blobShadowUnits[i];
      const radius = blobShadowRadii.get(unit) || 0.6;
      
      // Get unit position
      let x = 0, z = 0;
      if (unit.mesh && unit.mesh.position) {
        x = unit.mesh.position.x;
        z = unit.mesh.position.z;
      } else if (unit.pb && unit.pb.state && unit.pb.state.loc) {
        x = unit.pb.state.loc.x;
        z = unit.pb.state.loc.z;
      }
      
      // Check distance for LOD culling
      const dx = x - camX;
      const dz = z - camZ;
      const distSq = dx * dx + dz * dz;
      
      if (distSq > cullDistSq) {
        // Too far - skip this shadow entirely
        continue;
      }
      
      // Choose offset based on object type (taller objects = further shadow)
      const unitType = unit.type || unit.name || '';
      let offsetDist = OFFSET_UNIT;
      if (unitType === 'tree' || unitType.includes('tree')) {
        offsetDist = OFFSET_TREE;
      } else if (unitType === 'rock' || unitType.includes('rock')) {
        offsetDist = OFFSET_ROCK;
      }
      
      const shadowX = x + sunDirX * offsetDist;
      const shadowZ = z + sunDirZ * offsetDist;
      
      // Get terrain height
      let terrainY = 0;
      if (window.getTerrainHeightAtPosition) {
        terrainY = window.getTerrainHeightAtPosition(shadowX, shadowZ);
      }
      
      // Scale by radius * 2 (ground mesh is 1x1, we want diameter)
      // Stretch in sun direction for more realistic look
      const size = radius * 2;
      const stretchedWidth = size;                    // Width perpendicular to sun
      const stretchedLength = size * shadowStretch;   // Length in sun direction
      scaling.set(stretchedWidth, 1, stretchedLength);
      position.set(shadowX, terrainY + 0.15, shadowZ);
      
      // Compose matrix with sun-aligned rotation for stretched shadows
      BABYLON.Matrix.ComposeToRef(scaling, sunRotation, position, tempMatrix);
      tempMatrix.copyToArray(matrices, visibleCount * 16);
      visibleCount++;
    }
    
    // Update thin instances with only visible shadows
    if (visibleCount > 0) {
      source.setEnabled(true);
      // Create a trimmed array if not all shadows are visible
      const finalMatrices = visibleCount === blobShadowUnits.length 
        ? matrices 
        : matrices.slice(0, visibleCount * 16);
      source.thinInstanceSetBuffer("matrix", finalMatrices, 16, false);
    } else {
      source.setEnabled(false);
    }
  };

  // ========================================
  // THIN INSTANCE SCENERY SYSTEM
  // ========================================
  // Uses thin instances for static scenery (trees, rocks) when not using full shadows
  // This dramatically reduces draw calls for dense forests/rock fields
  
  let thinInstanceMode = false; // Enabled when shadow mode is Off/Low/Med
  const thinInstanceSources = new Map(); // modelPath -> { mesh, material, instances: [] }
  const thinInstanceData = new Map(); // lodEntry -> { path, position, rotation, scale }
  let thinInstancesDirty = false;
  
  // Model paths that support thin instancing
  const THIN_INSTANCE_MODELS = [
    'assets/models/trees.glb',
    'assets/models/rocks_plain.glb',
    'assets/models/rocks_moss.glb',
    'assets/models/rocks_snow.glb'
  ];
  
  // Check if a model path supports thin instancing
  function supportsThinInstancing(path) {
    return THIN_INSTANCE_MODELS.some(p => path.includes(p.replace('assets/models/', '')));
  }
  
  // Enable/disable thin instance mode based on shadow setting
  // NOTE: Thin instancing is DISABLED for now - needs more debugging
  // The issue is that source meshes aren't rendering despite being enabled
  gfx.setThinInstanceMode = function(enabled) {
    // DISABLED: Just return immediately, don't enable thin instances
    // This allows normal model rendering to continue working
    if (true) return;
    
    if (thinInstanceMode === enabled) return;
    console.log('[ThinInstance] setThinInstanceMode:', enabled);
    thinInstanceMode = enabled;
    
    if (enabled) {
      // FIRST PASS: Create source meshes from visible models BEFORE hiding them
      lodModels.forEach(lod => {
        if (lod.isStatic && lod.modelPath && supportsThinInstancing(lod.modelPath)) {
          const model = lod.model;
          if (model && (!model.isDisposed || !model.isDisposed())) {
            // Create source mesh if we don't have one for this model type
            if (!thinInstanceSources.has(lod.modelPath)) {
              getOrCreateThinInstanceSource(lod.modelPath, model);
            }
          }
        }
      });
      
      // SECOND PASS: Store instance data and hide individual models
      lodModels.forEach(lod => {
        if (lod.isStatic && lod.modelPath && supportsThinInstancing(lod.modelPath)) {
          const model = lod.model;
          if (model && (!model.isDisposed || !model.isDisposed())) {
            // Get world position
            let pos;
            if (model.getAbsolutePosition) {
              pos = model.getAbsolutePosition();
            } else if (model.position) {
              pos = model.position;
            } else {
              pos = { x: 0, y: 0, z: 0 };
            }
            
            // Get rotation
            let rot = 0;
            if (model.rotation && model.rotation.y !== undefined) {
              rot = model.rotation.y;
            } else if (model.rotationQuaternion) {
              rot = model.rotationQuaternion.toEulerAngles().y;
            }
            
            // Get scale
            let scale = 1;
            if (model.scaling && model.scaling.x !== undefined) {
              scale = model.scaling.x;
            }
            
            thinInstanceData.set(lod, {
              path: lod.modelPath,
              x: pos.x,
              y: pos.y,
              z: pos.z,
              rotation: rot,
              scale: scale
            });
            
            // Hide the individual model
            if (model.setEnabled) {
              model.setEnabled(false);
            }
            lod._thinInstanceManaged = true;
          }
        }
      });
      
      console.log('[ThinInstance] Enabled with', thinInstanceData.size, 'instances and', thinInstanceSources.size, 'sources');
      thinInstancesDirty = true;
    } else {
      // Switch back to individual models
      console.log('[ThinInstance] Disabling - restoring', lodModels.filter(l => l._thinInstanceManaged).length, 'models');
      lodModels.forEach(lod => {
        if (lod._thinInstanceManaged) {
          lod._thinInstanceManaged = false;
          // Model visibility will be restored by normal LOD update
        }
      });
      thinInstanceData.clear();
      
      // Dispose all thin instance sources completely
      thinInstanceSources.forEach((source, path) => {
        if (source.mesh && !source.mesh.isDisposed()) {
          source.mesh.dispose();
        }
      });
      thinInstanceSources.clear();
    }
  };
  
  // Register a static model for thin instancing (called when model loads)
  gfx.registerThinInstance = function(lod, model, modelPath) {
    if (!thinInstanceMode || !supportsThinInstancing(modelPath)) return false;
    if (!model || (model.isDisposed && model.isDisposed())) return false;
    
    // Get world position - works for both Mesh and TransformNode
    let pos;
    if (model.getAbsolutePosition) {
      pos = model.getAbsolutePosition();
    } else if (model.position) {
      pos = model.position;
    } else {
      pos = { x: 0, y: 0, z: 0 };
    }
    
    // Get rotation - check multiple possible locations
    let rot = 0;
    if (model.rotation && model.rotation.y !== undefined) {
      rot = model.rotation.y;
    } else if (model.rotationQuaternion) {
      rot = model.rotationQuaternion.toEulerAngles().y;
    }
    
    // Get scale
    let scale = 1;
    if (model.scaling && model.scaling.x !== undefined) {
      scale = model.scaling.x;
    }
    
    thinInstanceData.set(lod, {
      path: modelPath,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rotation: rot,
      scale: scale
    });
    
    lod._thinInstanceManaged = true;
    if (model.setEnabled) {
      model.setEnabled(false);
    }
    thinInstancesDirty = true;
    
    return true;
  };
  
  // Unregister a model from thin instancing (called when chunk unloads)
  gfx.unregisterThinInstance = function(lod) {
    if (thinInstanceData.has(lod)) {
      thinInstanceData.delete(lod);
      thinInstancesDirty = true;
    }
  };
  
  // Get or create source mesh for a model type
  // For GLB models, we find the first child with geometry and use that
  function getOrCreateThinInstanceSource(modelPath, referenceMesh) {
    if (thinInstanceSources.has(modelPath)) {
      const existing = thinInstanceSources.get(modelPath);
      if (existing.mesh && !existing.mesh.isDisposed()) {
        return existing;
      }
    }
    
    if (!referenceMesh) return null;
    
    // Find all meshes with geometry in the hierarchy
    let meshes = [];
    if (referenceMesh.getChildMeshes) {
      meshes = referenceMesh.getChildMeshes().filter(m => 
        m.getTotalVertices && m.getTotalVertices() > 0
      );
    }
    if (meshes.length === 0 && referenceMesh.getTotalVertices && referenceMesh.getTotalVertices() > 0) {
      meshes = [referenceMesh];
    }
    
    if (meshes.length === 0) return null;
    
    // Clone the first mesh with geometry as the source
    const originalMesh = meshes[0];
    const sourceMesh = originalMesh.clone(`thinSource_${modelPath.replace(/[\/\.]/g, '_')}`, null);
    
    if (!sourceMesh) return null;
    
    // Make geometry unique so thin instances work properly
    sourceMesh.makeGeometryUnique();
    
    // Reset transform - thin instances provide their own world transforms via matrices
    // Position source mesh at origin with unit scale
    sourceMesh.position.set(0, 0, 0);
    sourceMesh.rotation.set(0, 0, 0);
    sourceMesh.scaling.set(1, 1, 1);
    
    // Configure for thin instances
    sourceMesh.isPickable = false;
    sourceMesh.receiveShadows = false;
    sourceMesh.alwaysSelectAsActiveMesh = true; // Required for thin instances to render
    sourceMesh.setEnabled(true);
    
    // Note: The source mesh will render at origin, but it's small and at ground level
    // Thin instances render at their specified positions from the matrix buffer
    
    // Use absolute values for scale to avoid flipped meshes
    let origScale = new BABYLON.Vector3(1, 1, 1);
    if (originalMesh.scaling) {
      origScale.x = Math.abs(originalMesh.scaling.x);
      origScale.y = Math.abs(originalMesh.scaling.y);
      origScale.z = Math.abs(originalMesh.scaling.z);
    }
    
    const source = {
      mesh: sourceMesh,
      originalScale: origScale
    };
    
    thinInstanceSources.set(modelPath, source);
    console.log('[ThinInstance] Created source for:', modelPath, 'origScale:', origScale.x.toFixed(2), origScale.y.toFixed(2), origScale.z.toFixed(2));
    return source;
  }
  
  // Debug: log thin instance stats occasionally
  let thinInstanceDebugCounter = 0;
  
  // Update all thin instances (called in render loop)
  gfx.updateThinInstances = function() {
    if (!thinInstanceMode || thinInstanceData.size === 0) {
      // Hide all sources when not in thin instance mode
      thinInstanceSources.forEach(source => {
        if (source.mesh && !source.mesh.isDisposed()) {
          source.mesh.setEnabled(false);
        }
      });
      return;
    }
    
    // Debug logging every 5 seconds
    thinInstanceDebugCounter++;
    if (thinInstanceDebugCounter % 300 === 1) {
      console.log('[ThinInstance] Mode:', thinInstanceMode, 'Data:', thinInstanceData.size, 'Sources:', thinInstanceSources.size);
    }
    
    // Get camera for LOD culling
    let camX = 0, camZ = 0;
    if (gfx.camera && gfx.camera.position) {
      camX = gfx.camera.position.x;
      camZ = gfx.camera.position.z;
    }
    
    // Cull distance - use LOD distance for trees/rocks
    const baseCullDist = 100;
    const lodMultiplier = (window.hud && window.hud.getCurrentLODMultiplier) 
      ? window.hud.getCurrentLODMultiplier() 
      : 1.0;
    const cullDistSq = Math.pow(baseCullDist * lodMultiplier, 2);
    
    // Group instances by model path and find reference meshes
    const instancesByPath = new Map();
    const refMeshesByPath = new Map();
    
    thinInstanceData.forEach((data, lod) => {
      // Distance culling
      const dx = data.x - camX;
      const dz = data.z - camZ;
      const distSq = dx * dx + dz * dz;
      
      if (distSq > cullDistSq) return; // Skip distant instances
      
      if (!instancesByPath.has(data.path)) {
        instancesByPath.set(data.path, []);
      }
      instancesByPath.get(data.path).push(data);
      
      // Store reference mesh if we don't have a source yet
      if (!thinInstanceSources.has(data.path) && lod.model && !lod.model.isDisposed()) {
        refMeshesByPath.set(data.path, lod.model);
      }
    });
    
    // Create sources from reference meshes if needed
    refMeshesByPath.forEach((refMesh, path) => {
      if (!thinInstanceSources.has(path)) {
        getOrCreateThinInstanceSource(path, refMesh);
      }
    });
    
    // Hide sources that have no visible instances
    thinInstanceSources.forEach((source, path) => {
      if (!instancesByPath.has(path) || instancesByPath.get(path).length === 0) {
        if (source.mesh && !source.mesh.isDisposed()) {
          source.mesh.setEnabled(false);
        }
      }
    });
    
    // Update each source mesh's thin instances
    instancesByPath.forEach((instances, path) => {
      const source = thinInstanceSources.get(path);
      if (!source || !source.mesh || source.mesh.isDisposed()) return;
      
      if (instances.length === 0) {
        source.mesh.setEnabled(false);
        return;
      }
      
      // Build matrix buffer
      const matrices = new Float32Array(instances.length * 16);
      const tempMatrix = BABYLON.Matrix.Identity();
      const scaling = BABYLON.Vector3.Zero();
      const position = BABYLON.Vector3.Zero();
      const rotationQuat = BABYLON.Quaternion.Identity();
      
      // Account for original mesh scale
      const origScale = source.originalScale || new BABYLON.Vector3(1, 1, 1);
      
      for (let i = 0; i < instances.length; i++) {
        const inst = instances[i];
        
        position.set(inst.x, inst.y, inst.z);
        // Combine instance scale with original mesh scale
        scaling.set(
          inst.scale * origScale.x,
          inst.scale * origScale.y,
          inst.scale * origScale.z
        );
        BABYLON.Quaternion.RotationYawPitchRollToRef(inst.rotation, 0, 0, rotationQuat);
        
        BABYLON.Matrix.ComposeToRef(scaling, rotationQuat, position, tempMatrix);
        tempMatrix.copyToArray(matrices, i * 16);
      }
      
      // Force enable the source mesh - use _isEnabled directly to bypass any parent checks
      source.mesh._isEnabled = true;
      source.mesh.isVisible = true;
      
      source.mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
      
      const isEnabledAfter = source.mesh.isEnabled();
      
      // Debug: log instance details and verify buffer
      if (thinInstanceDebugCounter % 300 === 1 && instances.length > 0) {
        console.log('[ThinInstance] Rendering', instances.length, 'of', path, 
          'first at:', instances[0].x.toFixed(1), instances[0].y.toFixed(1), instances[0].z.toFixed(1),
          'scale:', instances[0].scale.toFixed(2),
          'thinInstanceCount:', source.mesh.thinInstanceCount,
          'enabled after setEnabled:', wasEnabled, '-> after buffer:', isEnabledAfter,
          'material:', source.mesh.material ? source.mesh.material.name : 'NONE',
          'vertices:', source.mesh.getTotalVertices ? source.mesh.getTotalVertices() : 'N/A',
          'parent:', source.mesh.parent ? source.mesh.parent.name : 'NONE');
      }
    });
    
    thinInstancesDirty = false;
  };
  
  // Check if thin instance mode is active
  gfx.isThinInstanceMode = function() {
    return thinInstanceMode;
  };

  // ========================================
  // ANTIALIASING CONTROLS
  // ========================================
  // Set antialiasing level: 0=Off, 1=FXAA, 2=MSAA 2x, 3=MSAA 4x
  gfx.setAntialiasing = function(level) {
    const prevLevel = currentAALevel;
    currentAALevel = level;
    
    // Handle FXAA (post-process, can toggle at runtime)
    if (level === 1) {
      // Enable FXAA
      if (!fxaaPostProcess && gfx.camera) {
        fxaaPostProcess = new BABYLON.FxaaPostProcess("fxaa", 1.0, gfx.camera);
      }
    } else {
      // Disable FXAA
      if (fxaaPostProcess) {
        fxaaPostProcess.dispose();
        fxaaPostProcess = null;
      }
    }
    
    // MSAA changes require engine recreation - just save the setting
    // The change will take effect on next page load
    if ((level >= 2 && prevLevel < 2) || (level < 2 && prevLevel >= 2) || 
        (level >= 2 && prevLevel >= 2 && level !== prevLevel)) {
      // MSAA setting changed - notify user if needed
      // console.log(`⚙️ MSAA setting changed to ${level >= 2 ? (level === 2 ? '2x' : '4x') : 'Off'}. Reload page to apply.`);
    }
  };
  
  // Get current AA level
  gfx.getAALevel = function() {
    return currentAALevel;
  };

})(window.gfx = window.gfx || {});


