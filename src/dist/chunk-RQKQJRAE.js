import{b as C}from"./chunk-6R3BZD2T.js";import{a as F}from"./chunk-G2HNJD3U.js";import{$ as M,R as V,S as w,Ud as D,V as A,Xg as X,Y as g,_ as O,_d as $,a as G,be as z,ce as I,cf as k,ge as W,he as N,je as B,le as b,o as T,oe as H,p as P,pe as U,qe as R}from"./chunk-ZBW7LZ4P.js";var se=1,S=2,ie=`
fn computeLighting(viewDir: vec3<f32>, N: vec3<f32>, L: LightEntry, g: f32, P: vec3<f32>) -> array<vec3<f32>, 2> {
var lv: vec3<f32>;
var a: f32 = 1.0;
let t = u32(L.vLightData.w);
if (t == 3u) {
let nl = 0.5 + 0.5 * dot(N, normalize(L.vLightData.xyz));
let diff = mix(L.vLightDirection.xyz, L.vLightDiffuse.rgb, nl);
let h = normalize(viewDir + normalize(L.vLightData.xyz));
var s = pow(max(0.0, dot(N, h)), max(1.0, g));
return array<vec3<f32>, 2>(diff, s * L.vLightSpecular.rgb);
}
if (t == 1u) {
lv = normalize(-L.vLightData.xyz);
} else {
let d = L.vLightData.xyz - P;
a = max(0.0, 1.0 - length(d) / L.vLightDiffuse.a);
lv = normalize(d);
if (t == 2u) {
let c = max(0.0, dot(L.vLightDirection.xyz, -lv));
if (c >= L.vLightDirection.w) { a *= max(0.0, pow(c, L.vLightSpecular.a)); } else { a = 0.0; }
}
}
let nl = max(0.0, dot(N, lv));
let diff = nl * L.vLightDiffuse.rgb * a;
let h = normalize(viewDir + lv);
var s = max(0.0, dot(N, h));
s = pow(s, max(1.0, g));
return array<vec3<f32>, 2>(diff, s * L.vLightSpecular.rgb * a);
}
`;function ne(e,t=""){let{_diffuse:a,_needsUV:i,_needsUV2:o,_diffuseUsesUV2:n,_disableLighting:r,_noColorOutput:c,_esmShadowOutput:v}=e,f=[{_name:"position",_type:"vec3<f32>",_gpuFormat:"float32x3",_arrayStride:12},{_name:"normal",_type:"vec3<f32>",_gpuFormat:"float32x3",_arrayStride:12}];i&&f.push({_name:"uv",_type:"vec2<f32>",_gpuFormat:"float32x2",_arrayStride:8}),o&&f.push({_name:"uv2",_type:"vec2<f32>",_gpuFormat:"float32x2",_arrayStride:8});let d=[{_name:"vp",_type:"vec3<f32>"},{_name:"vn",_type:"vec3<f32>"},{_name:"vf",_type:"vec3<f32>"}];i&&d.push({_name:"vu",_type:"vec2<f32>"}),o&&d.push({_name:"vv",_type:"vec2<f32>"});let l=[{_name:"world",_type:"mat4x4<f32>"}];O(l);let u=[{_name:"mat",_type:{_kind:"uniform-buffer"},_visibility:S}];a&&u.push({_name:"dT",_type:{_kind:"texture",_textureType:"texture_2d<f32>"},_visibility:S},{_name:"dS",_type:{_kind:"sampler",_samplerType:"sampler"},_visibility:S}),i&&u.push({_name:"up",_type:{_kind:"uniform-buffer"},_visibility:se}),v&&u.push({_name:"shadowParams",_type:{_kind:"uniform-buffer"},_visibility:S});let p=`/*SU*/
/*MU*/
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
${i?"struct upUniforms { u: vec4<f32>, }":""}
/*VH*/
/*VD*/
/*VO*/
@vertex fn main(
/*VP*/
) -> VertexOutput {
var out: VertexOutput;
/*VR*/
var finalWorld = mesh.world;
/*VW*/
let worldPos4 = finalWorld * vec4<f32>(position, 1.0);
out.vp = worldPos4.xyz;
let normalWorld = mat3x3<f32>(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz);
out.vn = normalize(normalWorld * normal);
out.clipPos = scene.viewProjection * worldPos4;
out.vf = (scene.view * worldPos4).xyz;
${i?"out.vu = uv * up.u.xy + up.u.zw;":""}
${o?"out.vv = uv2;":""}
/*VB*/
return out;
}`,L=`
struct LightEntry { vLightData: vec4<f32>, vLightDiffuse: vec4<f32>, vLightSpecular: vec4<f32>, vLightDirection: vec4<f32> };
struct lightsUniforms { count: u32, _p0: u32, _p1: u32, _p2: u32, lights: array<LightEntry, ${g}> };
@group(0) @binding(1) var<uniform> lights: lightsUniforms;
`,K=`
struct matUniforms {
dc: vec4<f32>,
sc: vec4<f32>,
ec: vec3<f32>,
bs: f32,
ac: vec3<f32>,
tl: f32,
ambTexLvl: f32,
lmLvl: f32,
opLvl: f32,
aCut: f32,
rLvl: f32,
rCm: f32,
_0: f32,
_1: f32,
};
`,j=r?C:C+ie,J=`@fragment fn main(input: FragmentInput)${c?"":" -> @location(0) vec4<f32>"} {`,Q=r?"":"let viewDirectionW = normalize(scene.vEyePosition.xyz - input.vp);",q=r?"":"var normalW = normalize(input.vn);",Z="var alpha = mat.dc.a;",ee=a?`let _ds = textureSample(dT, dS, ${n?"input.vv":"input.vu"});
if (_ds.a < mat.aCut) { discard; }
var baseColor = _ds.rgb * mat.tl;`:"var baseColor = vec3<f32>(1.0, 1.0, 1.0);",te="let diffuseColor = mat.dc.rgb;",oe="var emissiveContrib = mat.ec;",re=r?"":"var specularColor = mat.sc.rgb;",x;r?x="var color = vec4<f32>(clamp(emissiveContrib * diffuseColor, vec3<f32>(0.0), vec3<f32>(1.0)) * baseColor, alpha);":x=`var glossiness = mat.sc.a;
var diffuseBase = vec3<f32>(0.0);
var specularBase = vec3<f32>(0.0);
var shadowFactors = array<f32, ${g}>(${new Array(g).fill("1.0").join(", ")});
var baseAmbientColor = vec3<f32>(1.0, 1.0, 1.0);
var reflectionColor = vec3<f32>(0.0);
let lc = min(mesh.lc, ${g}u);
/*AD*/
for (var li = 0u; li < lc; li++) {
let lightIndex = mli(li);
let r = computeLighting(viewDirectionW, normalW, lights.lights[lightIndex], glossiness, input.vp);
let sf = shadowFactors[lightIndex];
diffuseBase += r[0] * sf;
specularBase += r[1] * sf;
}
let finalDiffuse = clamp(diffuseBase * diffuseColor + emissiveContrib + mat.ac, vec3<f32>(0.0), vec3<f32>(1.0)) * baseColor;
let finalSpecular = specularBase * specularColor;
var color = vec4<f32>(finalDiffuse * baseAmbientColor + finalSpecular + reflectionColor, alpha);`;let ae=`/*SU*/
${L}
${K}
${v?"struct shadowParamsUniforms { biasAndScale: vec4<f32>, depthValues: vec4<f32>, }":""}
/*MU*/
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
${r?"":M("mesh")}
${j}
/*HF*/
/*FB*/
/*FI*/
${J}
/*SV*/
${Q}
${q}
/*AC*/
${Z}
${ee}
${te}
${oe}
${re}
/*AT*/
${c?"return;":v?t:""}
${x}
/*BC*/
color = vec4<f32>(max(color.rgb, vec3<f32>(0.0)), color.a);
if (scene.vFogInfos.x > 0.0) {
let fog = calcFogFactor(input.vf);
color = vec4<f32>(mix(scene.vFogColor.rgb, color.rgb, fog), color.a);
}
/*BA*/
${c?"":"return color;"}
}`;return{_vertexTemplate:p,_fragmentTemplate:ae,_baseMeshUboFields:l,_baseVertexAttributes:f,_baseVaryings:d,_baseBindings:u}}function ce(e,t=0,a=[],i=""){let o=r=>(e&r)!==0,n=ne({_diffuse:o(D),_needsUV:o(U),_needsUV2:o(R),_diffuseUsesUV2:o(I),_disableLighting:o(W),_noColorOutput:o(B),_esmShadowOutput:o(b)},i);return F(n,a)}var y=new Map,_=null,E=null;function le(){return _||(_=new Map),_}function Y(e){E!==e._device&&(y.clear(),_?.clear(),w(),E=e._device)}function de(){y.clear(),_?.clear(),w(),E=null}function pe(e,t,a,i=[],o="",n=""){Y(e);let r=k(t,a,o),c=y.get(r);if(c)return c;let v=le(),f=v.get(r);f||(f=ce(t,a,i,n),v.set(r,f));let d=e._device,l=d.createBindGroupLayout(f._meshBGLDescriptor),u=null;(a&X)!==0&&f._shadowBGLDescriptor&&(u=d.createBindGroupLayout(f._shadowBGLDescriptor));let s={_features:t,_meshFeatures:a,_meshBGL:l,_shadowBGL:u,_composed:f,_pipelines:new Map};return y.set(r,s),s}function _e(e,t,a){Y(e);let i=P(t),o=a._pipelines.get(i);if(o)return o;let n=e._device,r=a._composed,c=a._features,v=V(e),f=a._shadowBGL?[v,a._meshBGL,a._shadowBGL]:[v,a._meshBGL],d=n.createShaderModule({code:r._vertexWGSL}),l=(c&B)!==0,u=(c&b)!==0,m=!t._colorFormat&&!l?null:n.createShaderModule({code:r._fragmentWGSL}),s=!u&&((c&$)!==0||(c&N)!==0),h=l?null:s?{format:t._colorFormat,blend:{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha"}}}:{format:t._colorFormat},p=n.createRenderPipeline({layout:n.createPipelineLayout({bindGroupLayouts:f}),vertex:{module:d,entryPoint:"main",buffers:r._vertexBufferLayouts},...m?{fragment:{module:m,entryPoint:"main",targets:h?[h]:[]}}:{},...t._depthStencilFormat?{depthStencil:{format:t._depthStencilFormat,depthCompare:t._depthCompare??T,depthWriteEnabled:l||u||!s}}:{},multisample:{count:t._sampleCount},primitive:{topology:"triangle-list",cullMode:c&z?"none":"back",frontFace:"ccw"}});return a._pipelines.set(i,p),p}function me(e,t,a,i,o){var n;let r=e._device,c=t._features,v=(c&U)!==0,f=(c&D)!==0,d=(c&b)!==0,l=0,u=[{binding:l++,resource:{buffer:a}},{binding:l++,resource:{buffer:i}}];if(f){let s=o.diffuseTexture;u.push({binding:l++,resource:s.texture.createView()},{binding:l++,resource:s.sampler})}if(v){let s=new G(4),h=o.uvScale[0],p=o.uvScale[1],L=0;(n=o.diffuseTexture)!=null&&n.invertY&&(L=p,p=-p),s[0]=h,s[1]=p,s[2]=0,s[3]=L,u.push({binding:l++,resource:{buffer:A(e,s)}})}d&&u.push({binding:l++,resource:{buffer:o._esmShadowParamsUBO}});let m=H();for(let s of m)c&s._feature&&s._bind&&(l=s._bind(o,u,l));return r.createBindGroup({layout:t._meshBGL,entries:u})}function he(e,t,a){let{diffuseColor:i,specularColor:o,emissiveColor:n,ambientColor:r}=t;e[0]=i[0],e[1]=i[1],e[2]=i[2],e[3]=t.alpha,e[4]=o[0],e[5]=o[1],e[6]=o[2],e[7]=t.specularPower,e[8]=n[0],e[9]=n[1],e[10]=n[2],e[11]=1/t.bumpLevel,e[12]=r[0],e[13]=r[1],e[14]=r[2],e[15]=a,e[16]=t.ambientTexLevel,e[17]=t.lightmapLevel,e[18]=t.opacityLevel,e[19]=t.alphaCutOff,e[20]=t.reflectionLevel,e[21]=t.reflectionCoordMode}export{ce as a,de as b,pe as c,_e as d,me as e,he as f};
