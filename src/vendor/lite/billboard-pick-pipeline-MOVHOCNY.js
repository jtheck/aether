import{c as p}from"./chunk-4DJLFLZ5.js";import{a as S}from"./chunk-HCJJMIZH.js";import"./chunk-S7UMTK7H.js";import{a as m}from"./chunk-OHUUFLWP.js";import"./chunk-IJL5AUX4.js";import{a as v,c as g}from"./chunk-RYWGU6XF.js";import{b as u,c as d,d as _}from"./chunk-VCOYERVR.js";var B=48,E=0,F=12,P=20,O=28,I=36,y=40,h=new Uint16Array([0,1,2,0,2,3]);function R(e,o,i,t,n,r){n[0]=e[0],n[1]=e[4],n[2]=e[8],r[3]=o,n[4]=e[1],n[5]=e[5],n[6]=e[9],n[7]=i,n[8]=t[0],n[9]=t[1],n[10]=t[2]}function L(e){switch(e){case"facing":return`fn basis() -> B {
let r = normalize(bb.camRight);
let u = normalize(bb.camUp);
return B(r, -u);
}`;case"axis-locked":return`fn basis() -> B {
let a = normalize(bb.axis);
let cr = normalize(bb.camRight);
let pr = cr - a * dot(cr, a);
let pl = length(pr);
let f = select(vec3f(0, 0, 1), vec3f(1, 0, 0), abs(a.z) > 0.999);
let fr = cross(a, f);
let r = select(fr / max(length(fr), 1e-4), pr / max(pl, 1e-4), pl > 1e-4);
return B(r, -a);
}`}}function M(e,o){let i=o?`@group(1) @binding(1) var atlasTex: texture_2d<f32>;
@group(1) @binding(2) var atlasSamp: sampler;`:"",t=o?`,
@location(1) uv: vec2f`:"",n=o?"out.uv = mix(in.a, in.b, q);":"",r=o?`let s = textureSample(atlasTex, atlasSamp, in.uv);
if (s.a < bb.cutoff) {
discard;
}`:"";return`struct PickScene { viewProjection: mat4x4f };
@group(0) @binding(0) var<uniform> scene: PickScene;
struct BB {
camRight: vec3f,
baseId: u32,
camUp: vec3f,
cutoff: f32,
axis: vec3f,
_pad: f32,
};
@group(1) @binding(0) var<uniform> bb: BB;
${i}
struct B { r: vec3f, u: vec3f };
${L(e)}
struct I {
@builtin(vertex_index) vid: u32,
@builtin(instance_index) iid: u32,
@location(0) p: vec3f,
@location(1) s: vec2f,
@location(2) a: vec2f,
@location(3) b: vec2f,
@location(4) r: f32,
@location(5) o: vec2f,
};
struct O {
@builtin(position) p: vec4f,
@location(0) @interpolate(flat) pickId: u32${t}
};
@vertex
fn vs(in: I) -> O {
let q = vec2f(select(0.0, 1.0, in.vid == 1u || in.vid == 2u), select(0.0, 1.0, in.vid >= 2u));
let l = (q - in.o) * in.s;
let cr = cos(in.r);
let sr = sin(in.r);
let rot = vec2f(l.x * cr - l.y * sr, l.x * sr + l.y * cr);
let bs = basis();
let wp = in.p + bs.r * rot.x + bs.u * rot.y;
var out: O;
out.p = scene.viewProjection * vec4f(wp, 1);
out.pickId = bb.baseId + in.iid;
${n}
return out;
}
struct FsOut { @location(0) color: vec4f, @location(1) depth: vec4f };
@fragment
fn fs(in: O) -> FsOut {
${r}
let id = in.pickId;
let r = f32((id >> 16u) & 0xFFu) / 255.0;
let g = f32((id >> 8u) & 0xFFu) / 255.0;
let b = f32(id & 0xFFu) / 255.0;
return FsOut(vec4f(r, g, b, 1.0), vec4f(in.p.z, 0.0, 0.0, 0.0));
}`}var b=null;function x(e){return b&&b.device===e._device||(b={device:e._device,pipelines:new Map,bgls:new Map}),b}function k(e,o,i){let t=i?"cutout":"plain",n=o.bgls.get(t);if(!n){let r=[{binding:0,visibility:d.VERTEX|d.FRAGMENT,buffer:{type:"uniform"}}];i&&(r.push({binding:1,visibility:d.FRAGMENT,texture:{sampleType:"float"}}),r.push({binding:2,visibility:d.FRAGMENT,sampler:{type:"filtering"}})),n=e._device.createBindGroupLayout({label:`billboard-pick-bgl-${t}`,entries:r}),o.bgls.set(t,n)}return n}function w(e,o){let i=x(e),t=o._orientation,n=o._depthMode==="cutout",r=`${t}|${n?1:0}`,c=i.pipelines.get(r);if(c)return c;let a=e._device,l=a.createShaderModule({label:`billboard-pick-${r}`,code:M(t,n)}),f=k(e,i,n),s=a.createRenderPipeline({label:`billboard-pick-pipeline-${r}`,layout:a.createPipelineLayout({bindGroupLayouts:[S(e),f]}),vertex:{module:l,entryPoint:"vs",buffers:[{arrayStride:p,stepMode:"instance",attributes:[{shaderLocation:0,offset:E,format:"float32x3"},{shaderLocation:1,offset:F,format:"float32x2"},{shaderLocation:2,offset:P,format:"float32x2"},{shaderLocation:3,offset:O,format:"float32x2"},{shaderLocation:4,offset:I,format:"float32"},{shaderLocation:5,offset:y,format:"float32x2"}]}]},fragment:{module:l,entryPoint:"fs",targets:[{format:"rgba8unorm",writeMask:_.ALL},{format:"r32float"}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthCompare:"greater",depthWriteEnabled:!0},multisample:{count:1}});return i.pipelines.set(r,s),s}function A(e,o){let i=e._device,t=x(e),n=o._depthMode==="cutout",r=i.createBuffer({label:"billboard-pick-ubo",size:B,usage:u.UNIFORM|u.COPY_DST}),c=new ArrayBuffer(B),a=Math.max(1,o._capacity),l=i.createBuffer({label:"billboard-pick-instances",size:a*p,usage:u.VERTEX|u.COPY_DST}),f=i.createBuffer({label:"billboard-pick-indices",size:h.byteLength,usage:u.INDEX|u.COPY_DST});i.queue.writeBuffer(f,0,h);let s=[{binding:0,resource:{buffer:r}}];n&&(s.push({binding:1,resource:o.atlas.texture.view}),s.push({binding:2,resource:o.atlas.texture.sampler}));let T=i.createBindGroup({label:"billboard-pick-bg",layout:k(e,t,n),entries:s});return{ubo:r,uboScratch:c,uboF32:new v(c),uboU32:new g(c),instanceBuffer:l,instanceCapacity:a,indexBuffer:f,bindGroup:T}}function C(e){e.ubo.destroy(),e.instanceBuffer.destroy(),e.indexBuffer.destroy()}function D(e,o,i,t,n,r){let c=o._device,a=i.count;if(a===0)return;i._capacity>t.instanceCapacity&&(t.instanceBuffer.destroy(),t.instanceCapacity=i._capacity,t.instanceBuffer=c.createBuffer({label:"billboard-pick-instances",size:t.instanceCapacity*p,usage:u.VERTEX|u.COPY_DST}));let l=i._instanceData;c.queue.writeBuffer(t.instanceBuffer,0,l.buffer,l.byteOffset,a*p);let f=i._depthMode==="cutout"?i.alphaCutoff:0;R(r,n,f,i._axis,t.uboF32,t.uboU32),c.queue.writeBuffer(t.ubo,0,t.uboScratch,0,B),e.setPipeline(w(o,i)),e.setBindGroup(1,t.bindGroup),e.setIndexBuffer(t.indexBuffer,"uint16"),e.setVertexBuffer(0,t.instanceBuffer),e.drawIndexed(6,a)}function G(e,o,i,t){e.pass.setBindGroup(0,e.sceneBG),D(e.pass,e.engine,o,i,t,m(e.camera))}function V(e){let o=null;return{draw(i,t){let n=e.count;return!e.visible||n===0||(o??=A(i.engine,e),G(i,e,o,t)),t+n},resolve(i,t){i._spritePick={system:e,spriteIndex:t,pickedPoint:i.pickedPoint,distance:i.distance}},dispose(){o&&(C(o),o=null)}}}export{A as createBillboardPickResources,V as createPickContributor,C as disposeBillboardPickResources,D as drawBillboardForPicking,G as drawBillboardSystemForPicking,R as packBillboardPickUbo};
