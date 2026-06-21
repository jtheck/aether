import{Y as f,m as s}from"./chunk-2GVZXICG.js";var c=`array<f32, ${f}>`,$=`${c}(${new Array(f).fill("1.0").join(", ")})`;function g(d,w,h){let l=[],n=[],u=[];for(let t of d){let e=`_${t.lightIndex}`;h.some(a=>a._name===`vPosFromLight${e}`)||h.push({_name:`vPosFromLight${e}`,_type:"vec4<f32>"}),h.some(a=>a._name===`vDepthMetric${e}`)||h.push({_name:`vDepthMetric${e}`,_type:"f32"})}let m=["let _shadowWp4 = meshU.world * vec4<f32>(in.position, 1.0);"],o=[`var _sf = ${$};`],r=w;for(let t of d){let e=`_${t.lightIndex}`,a=t.lightIndex,p=r++,i=r++,v=r++,x=t.shadowType;l.push({_lightIndex:a,_texBinding:p,_sampBinding:i,_uboBinding:v,_shadowType:x}),n.push(`struct shadowInfo${e}Uniforms { lightMatrix: mat4x4<f32>, depthValues: vec4<f32>, shadowsInfo: vec4<f32> };`,`@group(1) @binding(${v}) var<uniform> shadowInfo${e}: shadowInfo${e}Uniforms;`),t.shadowType==="pcf"?(n.push(`@group(1) @binding(${p}) var shadowTex${e}: texture_depth_2d;`,`@group(1) @binding(${i}) var shadowComp${e}: sampler_comparison;`,`fn computeShadowPCF${e}(posFromLight: vec4<f32>, depthMetric: f32, darkness: f32, mapSz: f32, invMapSz: f32) -> f32 {
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
}`),o.push(`_sf[${t.lightIndex}] = computeShadowPCF${e}(input.vPosFromLight${e}, input.vDepthMetric${e}, shadowInfo${e}.shadowsInfo.x, shadowInfo${e}.shadowsInfo.y, shadowInfo${e}.shadowsInfo.z);`),u.push({binding:p,visibility:s.FRAGMENT,texture:{sampleType:"depth",viewDimension:"2d"}},{binding:i,visibility:s.FRAGMENT,sampler:{type:"comparison"}})):(n.push(`@group(1) @binding(${p}) var shadowTex${e}: texture_2d<f32>;`,`@group(1) @binding(${i}) var shadowSamp${e}: sampler;`,`fn computeFallOff${e}(value: f32, clipSpace: vec2<f32>, frustumEdgeFalloff: f32) -> f32 {
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
}`),o.push(`_sf[${t.lightIndex}] = computeShadowESM${e}(input.vPosFromLight${e}, input.vDepthMetric${e}, shadowInfo${e}.shadowsInfo.x, shadowInfo${e}.shadowsInfo.z, shadowInfo${e}.shadowsInfo.w);`),u.push({binding:p,visibility:s.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d"}},{binding:i,visibility:s.FRAGMENT,sampler:{type:"filtering"}})),m.push(`out.vPosFromLight${e} = shadowInfo${e}.lightMatrix * _shadowWp4;`,`out.vDepthMetric${e} = (out.vPosFromLight${e}.z + shadowInfo${e}.depthValues.x) / shadowInfo${e}.depthValues.y;`),u.push({binding:v,visibility:s.VERTEX|s.FRAGMENT,buffer:{type:"uniform",minBindingSize:96}})}return o.push(`for (var _i = 0u; _i < ${f}u; _i++) { _sf[_i] = mix(1.0, _sf[_i], meshU.receivesShadow.x); }`),o.push("return _sf;"),{_bindings:l,_wgslDecls:n.join(`
`),_fragmentHelper:`fn nme_computeShadowFactors(input: VertexOut) -> ${c} {
    ${o.join(`
    `)}
}`,_vertexInject:m.join(`
    `),_bglEntries:u,_bindingCount:d.length*3}}export{g as emitShadow};
