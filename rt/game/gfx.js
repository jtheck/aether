





(function(gfx) {
  gfx.canvas; // HTML Canvas
  gfx.engine; // BABYLON Engine
  let engineOptions = {};
  gfx.scene;
  gfx.camera;
  gfx.cameraTarget;

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
      billboardMaterial.diffuseTexture = new BABYLON.Texture('assets/textures/atlas-hd.png', scene);
      
      // Enable transparency for PNG alpha channel
      billboardMaterial.diffuseTexture.hasAlpha = true;
      billboardMaterial.useAlphaFromDiffuseTexture = true;
      billboardMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
      
      // Softer lighting for more rounded appearance
      billboardMaterial.ambientColor = new BABYLON.Color3(0.7, 0.7, 0.7); // More ambient light
      billboardMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.9); // Softer diffuse
      billboardMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1); // Reduce harsh specular
      billboardMaterial.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15); // Slight self-illumination
      
      billboardMaterial.backFaceCulling = false;
      
      console.log('Billboard atlas material initialized with atlas-hd.png, transparency, and soft lighting');
    }
  }
  
  // Get or create instanced mesh for a specific model type
  function getBillboardMasterMesh(modelPath, scene) {
    // Determine model type from path
    let modelType = 'other';
    if (modelPath.includes('tree')) modelType = 'tree';
    else if (modelPath.includes('gate')) modelType = 'gate';
    else if (modelPath.includes('windvane')) modelType = 'windvane';
    else if (modelPath.includes('tortle')) modelType = 'tortle';
    else if (modelPath.includes('birdy')) modelType = 'birdy';
    else if (modelPath.includes('mushroom')) modelType = 'mushroom';
    else if (modelPath.includes('frog')) modelType = 'frog';
    
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
      
      console.log(`Created billboard master mesh for type: ${modelType}`);
    }
    
    return billboardInstancedMeshes.get(modelType);
  }
  
  // Get UV coordinates for model type (cached for performance)
  const modelUVCache = new Map();
  function getModelUV(modelPath) {
    if (modelUVCache.has(modelPath)) {
      return modelUVCache.get(modelPath);
    }
    
    const cellSize = 1/8;
    let cellX = 0, cellY = 0;
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
    } else {
      cellX = 7; cellY = 0; // Others - eighth cell
    }
    
    // UV coordinates for a quad - flipped V to fix upside-down
    const u1 = cellX * cellSize;
    const u2 = (cellX + 1) * cellSize;
    const v1 = 1.0;  // top of texture (flipped)
    const v2 = 0.0;  // bottom of texture (flipped)
    
    const uvs = [
      u1, v2,  // bottom-left
      u2, v2,  // bottom-right  
      u2, v1,  // top-right
      u1, v1   // top-left
    ];
    
    console.log(`Model ${modelPath} -> Cell ${cellX} -> UVs: ${u1.toFixed(3)}-${u2.toFixed(3)}`);
    
    modelUVCache.set(modelPath, uvs);
    return uvs;
  }

  // Get a billboard instance from the pool (optimized)
  function getBillboardInstance(modelPath, position, scale, scene) {
    // Determine model type
    let modelType = 'other';
    if (modelPath.includes('tree')) modelType = 'tree';
    else if (modelPath.includes('gate')) modelType = 'gate';
    else if (modelPath.includes('windvane')) modelType = 'windvane';
    else if (modelPath.includes('tortle')) modelType = 'tortle';
    else if (modelPath.includes('birdy')) modelType = 'birdy';
    else if (modelPath.includes('mushroom')) modelType = 'mushroom';
    else if (modelPath.includes('frog')) modelType = 'frog';
    
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
    instance.position.y += 2.0; // Lift billboard up so bottom edge sits on ground level
    
    // No pivot point adjustment needed - position handles ground placement
    
    instance.scaling.x = scale;
    instance.scaling.y = scale;
    instance.scaling.z = 1;
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
      model.root.rotation.y = rotation;
      model.root.scaling.x = scale;
      model.root.scaling.y = scale;
      model.root.scaling.z = scale;
      model.root.setEnabled(true);
      return Promise.resolve(model);
    } else {
      // Create new instance if pool is empty
      return getModel(modelPath, scene).then(model => {
        model.root.position.copyFrom(position);
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

  // Model placement rules for different tile types
  const modelRules = {
    // Grass tiles (0-15) - trees, mushrooms, etc.
    5: { // GRASS_IN
      models: [
        { path: "assets/models/mushroom.glb", chance: 0.1, scale: 0.1, billboardScale: 0.5, lodDistance: 75 },
        // { path: "assets/models/ae.glb", chance: 0.05, scale: 0.1 }
        { path: "assets/models/tortle.glb", chance: 0.32, scale: 0.1, billboardScale: 1, lodDistance: 75 },
        { path: "assets/models/frog.glb", chance: 0.39, scale: 0.1, billboardScale: 0.5, lodDistance: 50 },

        { path: "assets/models/tree.glb", chance: 0.3, scale: 1, billboardScale: 2, lodDistance: 200 }

      ]
    },
    // Dirt tiles (20-35) - rocks, gates, etc.
    25: { // DIRT_IN
      models: [
        { path: "assets/models/gate.glb", chance: 0.08, scale: .01, billboardScale: 1.5, lodDistance: 100 },
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
    const BATCH_SIZE = 2; // Load max 1 model per frame to prevent hitches
    
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
          });
          
          // Add LOD billboard - let LOD system manage all visibility
          addLODBillboard(model, task.scene, task.modelRule, gfx.camera ? gfx.camera.position : null);
          
          // Start with 3D model disabled - LOD system will enable what's needed
          model.root.setEnabled(false);
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
        rule.models.forEach(modelRule => {
          // Random chance to place model
          if (Math.random() < modelRule.chance) {
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
              modelPath: modelRule.path,
              scene: scene,
              position: position,
              rotation: rotation,
              scale: modelRule.scale,
              chunk: chunk,
              models: models,
              modelRule: modelRule
            });
          }
        });
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
      
      // Determine which material to use based on tile type
      let materialKey;
      if (tile.type >= 80) {
        materialKey = 'water'; // Water atlas (types 80-95)
      } else if (tile.type >= 60) {
        materialKey = 'sand';  // Sand atlas (types 60-75)
      } else if (tile.type >= 40) {
        materialKey = 'rock';  // Rock atlas (types 40-55)
      } else if (tile.type >= 20) {
        materialKey = 'dirt';  // Dirt atlas (types 20-35)
      } else {
        materialKey = 'grass'; // Grass atlas (types 0-15)
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
      
      // UV coordinates (u, v) - increased offset to prevent seams
      const u1 = tileCol * 0.25 + 0.01;
      const u2 = (tileCol + 1) * 0.25 - 0.01;
      const v1 = tileRow * 0.25 + 0.01;
      const v2 = (tileRow + 1) * 0.25 - 0.01;
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
        
        vertexDataObj.applyToMesh(meshes[key]);
        
        // Compute normals after applying vertex data
        const normals = new Array(data.verts.length);
        BABYLON.VertexData.ComputeNormals(data.verts, data.indices, normals);
        meshes[key].setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
        
        meshes[key].material = sharedMaterials[key]; // Use shared materials
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
        gfx.showWorldAxes(1024, gfx.scene, new Vec3(0,0,0));
      }
      
      // Initialize HUD system after scene and camera are ready
      if (window.hud && gfx.camera && gfx.canvas) {
        hud.init(gfx.scene, gfx.camera, gfx.canvas);
        
        // Set up main radial menu categories (these will expand into sub-menus)
        hud.addRadialMenuItem("Build", "🏗️", () => hud.showSubMenu("build"), new BABYLON.Color3(0, 1, 0)); // Green
        hud.addRadialMenuItem("Attack", "⚔️", () => hud.showSubMenu("attack"), new BABYLON.Color3(1, 0, 0)); // Red
        hud.addRadialMenuItem("Move", "👣", () => hud.showSubMenu("move"), new BABYLON.Color3(0, 0, 1)); // Blue
        hud.addRadialMenuItem("Info", "ℹ️", () => hud.showSubMenu("info"), new BABYLON.Color3(1, 1, 0)); // Yellow
        hud.addRadialMenuItem("Magic", "🔮", () => hud.showSubMenu("magic"), new BABYLON.Color3(0.8, 0, 1)); // Purple
        
        console.log("HUD initialized with default radial menu");
      }
      
      gfx.engine.runRenderLoop(mainRenderLoop);


    });
  }

  function mainRenderLoop(){
    gfx.scene.render();
    
    // Player physics and position updates are now handled in the game loop
    // This render loop only handles rendering and chunk management
    
    // Super fast camera snap - get there immediately, no catchup lag
    if (window.cameraTargetDestination && gfx.cameraTarget) {
      const lerpSpeed = 0.9; // Ultra fast - basically instant
      gfx.cameraTarget.position.x = BABYLON.Scalar.Lerp(gfx.cameraTarget.position.x, window.cameraTargetDestination.x, lerpSpeed);
      gfx.cameraTarget.position.z = BABYLON.Scalar.Lerp(gfx.cameraTarget.position.z, window.cameraTargetDestination.z, lerpSpeed);
      
      // Much tighter tolerance - stop immediately when close
      const distance = BABYLON.Vector3.Distance(gfx.cameraTarget.position, window.cameraTargetDestination);
      if (distance < 0.01) {
        // Snap to exact position and stop
        gfx.cameraTarget.position.x = window.cameraTargetDestination.x;
        gfx.cameraTarget.position.z = window.cameraTargetDestination.z;
        window.cameraTargetDestination = null;
      }
    }
    
    // Update unit logic and behaviors
    if (window.updateUnits) {
      updateUnits(0.016); // ~60fps deltaTime
    }
    
    // Update unit mesh positions and rotations
    if (window.updateUnitMeshes) {
      updateUnitMeshes();
    }
    
    // Update LOD system based on camera position
    if (gfx.camera) {
      updateLOD(gfx.camera.position);
    }
    
    // Update minimap AFTER camera position is finalized
    if (window.hud && window.hud.updateMinimap) {
      window.hud.updateMinimap();
    }
    
    // Update visible chunks around camera target
    if (liveField && gfx.cameraTarget) {
      const targetPos = gfx.cameraTarget.position || gfx.cameraTarget;
      liveField.updateVisibleChunks(targetPos.x, targetPos.z); // Use field's default radius
      
      // Create meshes for chunks that need them
      for (const [key, chunk] of liveField.chunks) {
        if (chunk.needsMesh) {
          const [chunkX, chunkZ] = key.split(',').map(Number);
          liveField.createChunkMesh(chunkX, chunkZ, gfx.scene, createTerrainMesh);
        }
        
        // Load models for chunks that need them (lazy loading)
        if (chunk.needsModels && chunk.mesh) {
          chunk.models = placeModelsOnChunk(chunk, gfx.scene);
          chunk.needsModels = false;
        }
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
      console.log('Using forge camera');
    } else {
      gfx.camera = gfx.makeCamera(scene);
      console.log('Using regular camera');
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
      console.log('Set lighting - Sun:', randomSunTime.toFixed(2), 'Moon:', randomMoonTime.toFixed(2));
      
      console.log('Orbital lighting system ready - use lighting.setTimeOfDay(0-1) to adjust');
    }

    // Initialize FX system
    if (window.fx) {
      fx.init(scene);
      fx.setupBarrelLauncher();
      console.log('FX system ready - press T for explosions!');
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








const box = BABYLON.MeshBuilder.CreateBox("box", {size: 1}, scene);

// Note: showWorldAxis is called after scene is ready, not during module initialization



  };





  
  gfx.makeCamera = function(scene) {
    let radius = 0;
    let camera = new BABYLON.ArcRotateCamera("zCamera", -2.5, 1.25, radius, new Vec3(0, 0, 0), scene);
    gfx.cameraTarget = new BABYLON.TransformNode("zCameraFocus");
    camera.lockedTarget = gfx.cameraTarget;
    camera.attachControl(gfx.canvas, true);

    // Camera setup complete

    camera.upperRadiusLimit = 9111;
    camera.lowerRadiusLimit = 25;
    camera.maxZ = 9111; // max render distance
    camera.minZ = 1.5; // minimum render distance
    camera.fov = .8; // default .8
 

    camera.wheelPrecision = 1.15;
    camera.wheelDeltaPercentage = .02;
    // camera.pinchDeltaPercentage = .02;
    camera.inertia = .6;
    camera.angularSensibilityX *= .5;
    camera.angularSensibilityY *= .5;

    return camera;
  };
  
  // Create a forge-specific universal camera for map editing
  gfx.makeForgeCamera = function(scene) {
    // Create a universal camera for forge editing - start high above for top-down view
    let camera = new BABYLON.UniversalCamera("forgeCamera", new Vec3(0, 200, 0), scene);
    
    // Set up camera properties for forge editing
    camera.fov = 0.8;
    camera.minZ = 1;
    camera.maxZ = 9001;
    
    // Camera controls
    camera.keysUp.push(87);    // W key
    camera.keysDown.push(83);  // S key
    camera.keysLeft.push(65);  // A key
    camera.keysRight.push(68); // D key
    camera.keysUpward.push(81);   // Q key (rotate up)
    camera.keysDownward.push(69); // E key (rotate down)
    
    // Make keyboard movement MUCH faster
    camera.speed = 2.0;        // Base movement speed
    camera.angularSpeed = 0.5; // Rotation speed
    
    // Mouse controls
    camera.attachControl(gfx.canvas, true);
    
    // Adjust sensitivity for precise editing - MUCH faster now!
    camera.angularSensibilityX = 5; // 10x faster mouse look
    camera.angularSensibilityY = 5; // 10x faster mouse look
    
    // Pan and zoom settings - MUCH faster now!
    camera.panningSensibility = 5; // 10x faster panning
    camera.wheelPrecision = 0.1; // 5x faster zoom (lower = faster)
    
    // Disable inertia for precise control
    camera.inertia = 0;
    
    // Enable right-click panning
    camera.panningInertia = 0;
    
    // Set up camera constraints for forge editing
    camera.lowerRadiusLimit = 5;   // Minimum zoom distance
    camera.upperRadiusLimit = 500; // Maximum zoom distance for larger field
    
    // Set initial position and target
    camera.setTarget(new Vec3(0, 0, 0));
    
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


