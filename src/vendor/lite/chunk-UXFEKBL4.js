function d(l,p){let u=[],o=[],f=[],h=[],a=[];for(let t of p){let s=t.lightIndex,e=`_${s}`;u.push({_name:`vPosFromLight${e}`,_type:"vec4<f32>"},{_name:`vDepthMetric${e}`,_type:"f32"}),t.shadowType==="pcf"?o.push({_name:`shadowTex${e}`,_type:{_kind:"texture",_textureType:"texture_depth_2d",_sampleType:"depth"},_group:"shadow",_visibility:2},{_name:`shadowComp${e}`,_type:{_kind:"sampler",_samplerType:"sampler_comparison"},_group:"shadow",_visibility:2}):o.push({_name:`shadowTex${e}`,_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_group:"shadow",_visibility:2},{_name:`shadowSamp${e}`,_type:{_kind:"sampler",_samplerType:"sampler"},_group:"shadow",_visibility:2}),o.push({_name:`shadowInfo${e}`,_type:{_kind:"uniform-buffer"},_group:"shadow",_visibility:3}),f.push(`out.vPosFromLight${e} = shadowInfo${e}.lightMatrix * worldPos4;`,`out.vDepthMetric${e} = (out.vPosFromLight${e}.z + shadowInfo${e}.depthValues.x) / shadowInfo${e}.depthValues.y;`),t.shadowType==="pcf"?h.push(`shadowFactors[${s}] = computeShadowPCF${e}(input.vPosFromLight${e}, input.vDepthMetric${e}, shadowInfo${e}.shadowsInfo.x, shadowInfo${e}.shadowsInfo.y, shadowInfo${e}.shadowsInfo.z);`):h.push(`shadowFactors[${s}] = computeShadowESM${e}(input.vPosFromLight${e}, input.vDepthMetric${e}, shadowInfo${e}.shadowsInfo.x, shadowInfo${e}.shadowsInfo.z, shadowInfo${e}.shadowsInfo.w);`)}for(let t of p){let e=`_${t.lightIndex}`;a.push(`struct shadowInfo${e}Uniforms { lightMatrix: mat4x4<f32>, depthValues: vec4<f32>, shadowsInfo: vec4<f32> };`),t.shadowType==="pcf"?a.push(`
fn computeShadowPCF${e}(posFromLight: vec4<f32>, depthMetric: f32, darkness: f32, mapSz: f32, invMapSz: f32) -> f32 {
let clipSpace = posFromLight.xyz / posFromLight.w;
let uv = vec2<f32>(0.5 * clipSpace.x + 0.5, 0.5 - 0.5 * clipSpace.y);
if (depthMetric < 0.0 || depthMetric > 1.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
let depthRef = clamp(clipSpace.z, 0.0, 1.0);
var tc = uv * mapSz + 0.5;
let st = fract(tc);
let base = (floor(tc) - 0.5) * invMapSz;
let uvw0 = 4.0 - 3.0 * st;
let uvw1 = vec2<f32>(7.0);
let uvw2 = 1.0 + 3.0 * st;
let u = vec3<f32>((3.0 - 2.0 * st.x) / uvw0.x - 2.0, (3.0 + st.x) / uvw1.x, st.x / uvw2.x + 2.0) * invMapSz;
let v = vec3<f32>((3.0 - 2.0 * st.y) / uvw0.y - 2.0, (3.0 + st.y) / uvw1.y, st.y / uvw2.y + 2.0) * invMapSz;
var sh = 0.0;
sh += uvw0.x * uvw0.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[0], v[0]), depthRef);
sh += uvw1.x * uvw0.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[1], v[0]), depthRef);
sh += uvw2.x * uvw0.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[2], v[0]), depthRef);
sh += uvw0.x * uvw1.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[0], v[1]), depthRef);
sh += uvw1.x * uvw1.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[1], v[1]), depthRef);
sh += uvw2.x * uvw1.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[2], v[1]), depthRef);
sh += uvw0.x * uvw2.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[0], v[2]), depthRef);
sh += uvw1.x * uvw2.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[1], v[2]), depthRef);
sh += uvw2.x * uvw2.y * textureSampleCompareLevel(shadowTex${e}, shadowComp${e}, base + vec2<f32>(u[2], v[2]), depthRef);
sh /= 144.0;
return mix(darkness, 1.0, sh);
}`):a.push(`
fn computeFallOff${e}(value: f32, clipSpace: vec2<f32>, frustumEdgeFalloff: f32) -> f32 {
let mask = smoothstep(1.0 - frustumEdgeFalloff, 1.00000012, clamp(dot(clipSpace, clipSpace), 0.0, 1.0));
return mix(value, 1.0, mask);
}
fn computeShadowESM${e}(posFromLight: vec4<f32>, depthMetric: f32, darkness: f32, depthScale: f32, frustumEdgeFalloff: f32) -> f32 {
let clipSpace = posFromLight.xyz / posFromLight.w;
let uv = vec2<f32>(0.5 * clipSpace.x + 0.5, 0.5 - 0.5 * clipSpace.y);
if (depthMetric < 0.0 || depthMetric > 1.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
let shadowPixelDepth = clamp(depthMetric, 0.0, 1.0);
let shadowMapSample = textureSampleLevel(shadowTex${e}, shadowSamp${e}, uv, 0.0).x;
let esm = 1.0 - clamp(exp(min(87.0, depthScale * shadowPixelDepth)) * shadowMapSample, 0.0, 1.0 - darkness);
return computeFallOff${e}(esm, clipSpace.xy, frustumEdgeFalloff);
}`)}let r=[];for(let t of p){let s=`_${t.lightIndex}`;r.push(`struct shadowInfo${s}Uniforms { lightMatrix: mat4x4<f32>, depthValues: vec4<f32>, shadowsInfo: vec4<f32> };`)}return{_id:l,_varyings:u,_bindings:o,_helperFunctions:a.join(`
`),_vertexHelperFunctions:r.join(`
`),_vertexSlots:{VB:f.join(`
`)},_fragmentSlots:{AD:h.join(`
`)}}}export{d as a};
