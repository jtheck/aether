// Rarely-run: bundle @babylonjs/lite into vendor/lite/ (~6 MB total, code-split once).
// Re-run when package.json @babylonjs/lite version changes - not on every app edit.

import esbuild from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { gzipSync } from 'zlib';
import { join } from 'path';

mkdirSync('vendor/lite', { recursive: true });
// Drop leftover dynamic-import chunks from older Lite versions.
for (const f of readdirSync('vendor/lite')) {
  rmSync(join('vendor/lite', f), { force: true, recursive: true });
}

// Gameplay patches apply to Lite source during the bundle, before minify.
// Each one must match exactly once or the build fails.
const LITE_PATCHES = [
  {
    // Lite clamps each cascade's far plane to the caster AABB. The ground is a
    // receiver only, so the cast shadow lands past that plane and PCF drops it.
    // Keep the near pull and leave the far plane on the camera frustum.
    file: /csm-shadow-task-hooks\.js$/,
    from: /if \(cMinZ <= viewMaxZ\) \{\s*viewMinZ = Math\.min\(viewMinZ, cMinZ\);\s*viewMaxZ = Math\.min\(viewMaxZ, cMaxZ\);\s*\}/,
    to: 'if (cMinZ < viewMaxZ) { viewMinZ = Math.min(viewMinZ, cMinZ); }',
  },
  {
    // Cascade index is compared against scene.view of whichever camera draws
    // the color pass. In XR that is the eye, while the maps are fitted to the
    // two-eye stand-in on scene.camera. The eye's near slice then samples an
    // empty map and the ground under the headset comes back fully lit.
    file: /csm-shadow-task-hooks\.js$/,
    from: 'import { _cameraChangeKey, getEffectiveAspectRatio, getViewProjectionMatrix } from "../camera/camera.js";',
    to: 'import { _cameraChangeKey, getEffectiveAspectRatio, getViewMatrix, getViewProjectionMatrix } from "../camera/camera.js";',
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: '_uboData: /* @__PURE__ */ new Float32Array(80),',
    to: '_uboData: /* @__PURE__ */ new Float32Array(96),',
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: `_writeCsmUbo(state._uboData, cascades, cfg);
	sg._version++;`,
    to: `_writeCsmUbo(state._uboData, cascades, cfg);
	state._uboData.set(getViewMatrix(camera), 80);
	sg._version++;`,
  },
  {
    // Unit meshes are omitted from the cascade fit so a walking army does not
    // move the projection under a still tree map.
    file: /csm-shadow-task-hooks\.js$/,
    from: `	for (const mesh of casterMeshes) {
		const ti = mesh.thinInstances;`,
    to: `	for (const mesh of casterMeshes) {
		if (mesh._shadowDynamic) continue;
		const ti = mesh.thinInstances;`,
  },
  {
    // Dynamic casters (units) and still casters (trees, buildings) get their
    // own depth array. The receiver takes the darker of the two, so a pose
    // does not clear the forest and a zoom does not drop unit shadows.
    file: /csm-shadow-task-hooks\.js$/,
    from: `		for (const mesh of casterMeshes) {
			const material = mesh.material;
			if (material && i <= (mesh._shadowMaxCascade ?? i)) addMeshToTask(task, mesh, { material: getNoColorView(material, materialViews) });
		}
		tasks.push(task);
		cameras.push(camera);
	}
	const compositeTask = {
		record() {
			for (const t of tasks) t.record();
		},
		execute() {
			let draws = 0;
			for (const t of tasks) draws += t.execute?.() ?? 0;
			return draws;
		},
		dispose() {
			for (const t of tasks) t.dispose();
		}
	};`,
    to: `		for (const mesh of casterMeshes) {
			const material = mesh.material;
			if (material && mesh._shadowDynamic && i <= (mesh._shadowMaxCascade ?? i)) addMeshToTask(task, mesh, { material: getNoColorView(material, materialViews) });
		}
		tasks.push(task);
		cameras.push(camera);
	}
	const stillTasks = [];
	for (let i = 0; i < n; i++) {
		const layerView = sg._stillDepthTexture.createView({
			dimension: "2d",
			baseArrayLayer: i,
			arrayLayerCount: 1
		});
		const rt = {
			_descriptor: {
				size: { width: cfg._mapSize, height: cfg._mapSize },
				dFormat: "depth32float",
				depthClearValue: 1,
				depthCompare: "less-equal",
				samples: 1
			},
			_colorTexture: null,
			_colorView: null,
			_depthTexture: sg._stillDepthTexture,
			_depthView: layerView,
			_width: cfg._mapSize,
			_height: cfg._mapSize,
			_eager: true,
			_ownsDepthTexture: false
		};
		const stillTask = createRenderTask({
			name: \`csmStill\${i}\`,
			rt,
			clr: true,
			cam: cameras[i],
			autoMirror: false,
			_skipClusteredLights: true
		}, engine, scene);
		for (const mesh of casterMeshes) {
			const material = mesh.material;
			if (material && !mesh._shadowDynamic && i <= (mesh._shadowMaxCascade ?? i)) addMeshToTask(stillTask, mesh, { material: getNoColorView(material, materialViews) });
		}
		stillTasks.push(stillTask);
	}
	const compositeTask = {
		record() {
			for (const t of tasks) t.record();
			for (const t of stillTasks) t.record();
		},
		execute() {
			let draws = 0;
			let staticVersion = 0;
			// The list closed over at task creation is the boot set. Trees and
			// buildings join later, and a still map keyed off the boot set stays
			// stale until the camera moves.
			const stillCasters = sg._shadowTaskState?._casterMeshes ?? casterMeshes;
			for (const mesh of stillCasters) {
				if (mesh._shadowDynamic) continue;
				const ti = mesh.thinInstances;
				staticVersion += (mesh.worldMatrixVersion || 0) + ((ti && ti._version) || 0);
			}
			const camKey = _cameraChangeKey(scene.camera);
			const camAspect = getEffectiveAspectRatio(scene, scene.camera);
			if (sg._stillCamKey !== camKey || sg._stillCamAspect !== camAspect || sg._stillCasters !== stillCasters || sg._stillStaticVersion !== staticVersion) {
				sg._stillCamKey = camKey;
				sg._stillCamAspect = camAspect;
				sg._stillCasters = stillCasters;
				sg._stillStaticVersion = staticVersion;
				for (const t of stillTasks) draws += t.execute?.() ?? 0;
			}
			for (const t of tasks) draws += t.execute?.() ?? 0;
			return draws;
		},
		dispose() {
			for (const t of tasks) t.dispose();
			for (const t of stillTasks) t.dispose();
		}
	};`,
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: '		_cascadeScratch: _createCascadeScratch(n)\n	};',
    to: '		_cascadeScratch: _createCascadeScratch(n),\n		_stillTasks: stillTasks\n	};',
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: '	if (drop.size) for (const task of tasks) _dropTaskMeshes(task, drop);',
    to: '	if (drop.size) {\n		for (const task of tasks) _dropTaskMeshes(task, drop);\n		for (const task of state._stillTasks ?? []) _dropTaskMeshes(task, drop);\n	}',
  },
  {
    file: /csm-shadow-task-hooks\.js$/,
    from: `			for (let c = 0; c < tasks.length && c <= (maxCascade ?? c); c++) {
				const task = tasks[c];
				_enableTaskMeshPopulation(task);
				task._pendingMeshes.push({
					mesh,
					material: view ?? material
				});
			}`,
    to: `			const bucket = mesh._shadowDynamic ? tasks : (state._stillTasks ?? tasks);
			for (let c = 0; c < bucket.length && c <= (maxCascade ?? c); c++) {
				const task = bucket[c];
				_enableTaskMeshPopulation(task);
				task._pendingMeshes.push({
					mesh,
					material: view ?? material
				});
			}`,
  },
  {
    file: /csm-directional-shadow-generator\.js$/,
    from: '_shadowUBO: createUniformBuffer(engine, /* @__PURE__ */ new Float32Array(80)),',
    to: '_shadowUBO: createUniformBuffer(engine, /* @__PURE__ */ new Float32Array(96)),',
  },
  {
    // Second depth array for trees and buildings. Units keep _depthTexture.
    file: /csm-directional-shadow-generator\.js$/,
    from: `	const depthTexture = device.createTexture({
		size: {
			width: mapSize,
			height: mapSize,
			depthOrArrayLayers: numCascades
		},
		format: "depth32float",
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
	});`,
    to: `	const depthTexture = device.createTexture({
		size: {
			width: mapSize,
			height: mapSize,
			depthOrArrayLayers: numCascades
		},
		format: "depth32float",
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
	});
	const stillDepthTexture = device.createTexture({
		size: {
			width: mapSize,
			height: mapSize,
			depthOrArrayLayers: numCascades
		},
		format: "depth32float",
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
	});`,
  },
  {
    file: /csm-directional-shadow-generator\.js$/,
    from: '		_depthTexture: depthTexture,',
    to: '		_depthTexture: depthTexture,\n		_stillDepthTexture: stillDepthTexture,',
  },
  {
    file: /csm-shadow-fragment-core\.js$/,
    from: 'csmParams:vec4<f32>};',
    to: 'csmParams:vec4<f32>,fitView:mat4x4<f32>};',
  },
  {
    file: /csm-shadow-fragment-core\.js$/,
    from: 'diff=csmInfo${suffix}.viewFrustumZ[i]-viewZ;',
    to: 'diff=csmInfo${suffix}.viewFrustumZ[i]-(csmInfo${suffix}.fitView*worldPos).z;',
  },
  {
    // Tree/building depth. Sampled with the same cascade fit as the unit map.
    file: /csm-shadow-fragment-core\.js$/,
    from: `		}, {
			_name: \`csmInfo\${suffix}\`,
			_type: { _kind: "uniform-buffer" },
			_group: "shadow",
			_visibility: STAGE_FRAGMENT
		});`,
    to: `		}, {
			_name: \`csmInfo\${suffix}\`,
			_type: { _kind: "uniform-buffer" },
			_group: "shadow",
			_visibility: STAGE_FRAGMENT
		}, {
			_name: \`csmStillTex\${suffix}\`,
			_type: {
				_kind: "texture",
				_textureType: "texture_depth_2d_array",
				_sampleType: "depth"
			},
			_group: "shadow",
			_visibility: STAGE_FRAGMENT
		});`,
  },
  {
    file: /csm-shadow-fragment-core\.js$/,
    from: 'sh/=144.0;sh=mix(csmInfo${suffix}.shadowsInfo.x,1.0,sh);return computeFallOffCsm${suffix}(sh,clipSpace.xy,csmInfo${suffix}.shadowsInfo.w);',
    to: 'var stillSh=0.0;stillSh+=uvw0.x*uvw0.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[0],v[0]),layer,depthRef);stillSh+=uvw1.x*uvw0.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[1],v[0]),layer,depthRef);stillSh+=uvw2.x*uvw0.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[2],v[0]),layer,depthRef);stillSh+=uvw0.x*uvw1.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[0],v[1]),layer,depthRef);stillSh+=uvw1.x*uvw1.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[1],v[1]),layer,depthRef);stillSh+=uvw2.x*uvw1.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[2],v[1]),layer,depthRef);stillSh+=uvw0.x*uvw2.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[0],v[2]),layer,depthRef);stillSh+=uvw1.x*uvw2.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[1],v[2]),layer,depthRef);stillSh+=uvw2.x*uvw2.y*textureSampleCompareLevel(csmStillTex${suffix},csmComp${suffix},base+vec2<f32>(u[2],v[2]),layer,depthRef);sh/=144.0;stillSh/=144.0;sh=mix(csmInfo${suffix}.shadowsInfo.x,1.0,sh);stillSh=mix(csmInfo${suffix}.shadowsInfo.x,1.0,stillSh);let dyn=computeFallOffCsm${suffix}(sh,clipSpace.xy,csmInfo${suffix}.shadowsInfo.w);let still=computeFallOffCsm${suffix}(stillSh,clipSpace.xy,csmInfo${suffix}.shadowsInfo.w);return min(dyn,still);',
  },
  {
    file: /material-shadow-bindings\.js$/,
    from: `			}, {
				binding: entries.length + 2,
				resource: { buffer: gen._shadowUBO }
			});`,
    to: `			}, {
				binding: entries.length + 2,
				resource: { buffer: gen._shadowUBO }
			}, {
				binding: entries.length + 3,
				resource: gen._stillDepthTexture.createView()
			});`,
  },
  {
    file: /pbr-geometry-view-.*\.js$/,
    from: `			entries.push({
				binding: b++,
				resource: { buffer: sg._shadowUBO }
			});`,
    to: `			entries.push({
				binding: b++,
				resource: { buffer: sg._shadowUBO }
			});
			entries.push({
				binding: b++,
				resource: sg._stillDepthTexture.createView()
			});`,
  },
  {
    // Standard materials only compile shadow sampling when some mesh in that
    // build already receives shadows. Swapping the board drops the old grass
    // before the new grass exists, so the rebuild omits the shadow map.
    // Compile it whenever a shadow light exists; receiveShadows still decides
    // who samples it.
    file: /standard-group-builder\.js$/,
    from: 'const hasShadow = meshes.some((m) => m.receiveShadows) && scene.lights.some((l) => !!l.shadowGenerator);',
    to: 'const hasShadow = scene.lights.some((l) => !!l.shadowGenerator);',
  },
  {
    // Lit standard materials wrote linear light into the unorm canvas, so the
    // board ignored the exposure grade PBR uses. Diffuse takes most of the
    // exposure above 1. The sun sheen takes less. Unlit overlays are a
    // different shader string and stay as authored.
    file: /standard-template\.js$/,
    from: 'var color=vec4<f32>(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor,alpha);',
    to: 'let litGrade=1.0+(scene.vImageInfos.x-1.0)*0.9;let specGrade=1.0+(scene.vImageInfos.x-1.0)*0.65;var color=vec4<f32>(finalDiffuse*baseAmbientColor*litGrade+(finalSpecular+reflectionColor)*specGrade,alpha);',
  },
  {
    // Standard materials hardcode the diffuse texture level at 1. Terrain sets
    // diffuseLevel so the lawn can sit darker than the rails and haul props.
    file: /standard-renderable\.js$/,
    from: 'const textureLevel = (features & 127) !== 0 ? 1 : 0;',
    to: 'const textureLevel = (features & 127) !== 0 ? (mat.diffuseLevel ?? 1) : 0;',
  },
  {
    // Atlas materials set atlasGrid to their cells per side. The shader keeps
    // each sample's filter footprint inside the cell, so a tile can show its
    // whole cell without mip and anisotropic taps reaching the neighbour cell.
    file: /standard-pipeline\.js$/,
    from: 'data[21] = mat.reflectionCoordMode;',
    to: 'data[21] = mat.reflectionCoordMode;\n\tdata[22] = mat.atlasGrid ?? 0;',
  },
  {
    file: /standard-template\.js$/,
    from: 'const helpers = _disableLighting ? "" : LIGHTING_FN;',
    to: 'const helpers = (_disableLighting ? "" : LIGHTING_FN) + (_needsUV ? "fn stdAtlasCell(t:texture_2d<f32>,s:sampler,uv:vec2<f32>,grid:f32)->vec4<f32>{let dx=dpdx(uv);let dy=dpdy(uv);let size=vec2<f32>(textureDimensions(t));let ax=length(dx*size);let ay=length(dy*size);let lod=clamp(log2(max(min(ax,ay),max(ax,ay)*0.125)),0.0,f32(textureNumLevels(t)-1u));let cell=1.0/grid;let pad=min(0.5*(abs(dx)+abs(dy))+exp2(lod)/size,vec2<f32>(0.5*cell));let lo=floor(uv*grid)*cell;return textureSampleGrad(t,s,clamp(uv,lo+pad,lo+cell-pad),dx,dy);}" : "");',
  },
  {
    file: /standard-template\.js$/,
    from: 'let _ds=textureSample(dT,dS,${_diffuseUsesUV2 ? "input.vv" : "input.vu"});',
    to: 'var _ds:vec4<f32>;if(mat._0>0.0){_ds=stdAtlasCell(dT,dS,${_diffuseUsesUV2 ? "input.vv" : "input.vu"},mat._0);}else{_ds=textureSample(dT,dS,${_diffuseUsesUV2 ? "input.vv" : "input.vu"});}',
  },
  {
    file: /std-emissive-fragment\.js$/,
    from: 'emissiveContrib=mat.ec+textureSample(eT,eS,input.vu).rgb*mat.tl;',
    to: 'if(mat._0>0.0){emissiveContrib=mat.ec+stdAtlasCell(eT,eS,input.vu,mat._0).rgb*mat.tl;}else{emissiveContrib=mat.ec+textureSample(eT,eS,input.vu).rgb*mat.tl;}',
  },
  {
    // The XR frame only runs scene._update and the eye tasks. The shadow
    // task lives in the canvas frame graph, which is stopped in XR, so the
    // maps froze on the last desktop frame.
    file: /xr-session\.js$/,
    from: 'ctx.scene._update();',
    to: 'ctx.scene._update(); for (const t of ctx.scene._frameGraph._tasks) if (t.name === "shadow") t.execute?.();',
  },
  {
    // Shader-material meshes keep one system UBO shared by both eye tasks,
    // written with queue.writeBuffer. In one submit the last eye's matrices
    // win for both eyes. Submit per eye so each sees its own write.
    file: /xr-session\.js$/,
    from: 'unit.task.execute?.();',
    to: 'unit.task.execute?.(); if (i < views.length - 1) { eng._device.queue.submit([eng._currentEncoder.finish()]); eng._currentEncoder = eng._device.createCommandEncoder({ label: "xr-eye" }); }',
  },
  {
    file: /xr-session\.js$/,
    from: 'eng._device.queue.submit([encoder.finish()]);',
    to: 'const lastEncoder = eng._currentEncoder; eng._device.queue.submit([lastEncoder.finish()]);',
  },
  {
    file: /xr-session\.js$/,
    from: 'eng._gpuTaskTimerResolve?.(encoder);',
    to: 'eng._gpuTaskTimerResolve?.(lastEncoder);',
  },
];

function liteGameplayPatches() {
  const pending = new Set(LITE_PATCHES);
  return {
    name: 'aether-lite-patches',
    setup(build) {
      build.onLoad({ filter: /csm-shadow-task-hooks\.js$|csm-shadow-fragment-core\.js$|csm-directional-shadow-generator\.js$|standard-group-builder\.js$|standard-template\.js$|standard-renderable\.js$|standard-pipeline\.js$|std-emissive-fragment\.js$|xr-session\.js$|material-shadow-bindings\.js$|pbr-geometry-view-.*\.js$/ }, (args) => {
        const patches = LITE_PATCHES.filter((p) => p.file.test(args.path));
        if (!patches.length) return null;
        let src = readFileSync(args.path, 'utf8');
        for (const patch of patches) {
          const hits = typeof patch.from === 'string'
            ? (src.split(patch.from).length - 1)
            : (src.match(new RegExp(patch.from.source, 'g')) || []).length;
          if (hits !== 1) {
            throw new Error(`Lite patch expected 1 match in ${args.path}, found ${hits}`);
          }
          pending.delete(patch);
          src = src.replace(patch.from, patch.to);
        }
        return { contents: src, loader: 'js' };
      });
      build.onEnd(() => {
        if (pending.size) {
          const names = [...pending].map((p) => p.file.source);
          throw new Error(`Lite patches never applied: ${names.join(', ')}`);
        }
      });
    },
  };
}

// splitting:false - VAT's _registerPbrExt must share the same pbr-flags
// module instance as the dynamically-imported PBR pipeline. With splitting,
// attachVat registered into a duplicate map and VAT never entered the shader
// (bind/T-pose crowds, missing skinned prims).
await esbuild.build({
  entryPoints: ['render/liteVendor.js'],
  bundle: true,
  format: 'esm',
  splitting: false,
  minify: true,
  outfile: 'vendor/lite/liteVendor.js',
  platform: 'browser',
  target: 'es2022',
  loader: { '.wasm': 'file' },
  logLevel: 'info',
  plugins: [liteGameplayPatches()],
});

let total = 0;
let totalGz = 0;
for (const f of readdirSync('vendor/lite')) {
  if (!f.endsWith('.js') && !f.endsWith('.wasm')) continue;
  const buf = readFileSync(join('vendor/lite', f));
  total += buf.length;
  if (f.endsWith('.js')) totalGz += gzipSync(buf).length;
}
console.log(`\nvendor/lite/ - ${(total / 1024 / 1024).toFixed(2)} MB raw JS+WASM  (~${(totalGz / 1024 / 1024).toFixed(2)} MB gzip JS)`);
