import{a as m,b as x,c as y}from"./chunk-4DJLFLZ5.js";import{a as V}from"./chunk-OHUUFLWP.js";import"./chunk-IJL5AUX4.js";import{a as U}from"./chunk-TJTLC5SD.js";import{b as R,c as P}from"./chunk-62N6XONL.js";import{a as F}from"./chunk-ELPVK4L2.js";import"./chunk-2BH75LVA.js";import{a as S,c as O,e as A}from"./chunk-RYWGU6XF.js";import{b as I,c as M,d as T}from"./chunk-VCOYERVR.js";var j={transparent:{index:0,writeEnabled:!1},cutout:{index:1,writeEnabled:!0}},J=0,Q=12,tt=20,et=28,it=36,ot=40,nt=48,h=32,rt=h/4,G=new A([0,1,2,0,2,3]);function g(t){return j[t]}function at(t){switch(t){case"facing":return`struct B {
r: vec3f,
u: vec3f,
};
fn basis(_a: vec3f) -> B {
let r = normalize(vec3f(scene.view[0][0], scene.view[1][0], scene.view[2][0]));
let u = normalize(vec3f(scene.view[0][1], scene.view[1][1], scene.view[2][1]));
return B(r, -u);
}`;case"axis-locked":return`struct B {
r: vec3f,
u: vec3f,
};
fn basis(_a: vec3f) -> B {
let a = normalize(billboards.axisAndCutoff.xyz);
let cr = normalize(vec3f(scene.view[0][0], scene.view[1][0], scene.view[2][0]));
let pr = cr - a * dot(cr, a);
let pl = length(pr);
let f = select(vec3f(0, 0, 1), vec3f(1, 0, 0), abs(a.z) > 0.999);
let fr = cross(a, f);
let r = select(fr / max(length(fr), 1e-4), pr / max(pl, 1e-4), pl > 1e-4);
return B(r, -a);
}`}}function st(t){return t==="cutout"?`@fragment
fn fs(in: O) -> @location(0) vec4f {
let s = textureSample(atlasTex, atlasSamp, in.uv);
if (s.a < billboards.axisAndCutoff.w) {
discard;
}
return s * in.tint * billboards.opacityMul;
}`:`@fragment
fn fs(in: O) -> @location(0) vec4f {
let s = textureSample(atlasTex, atlasSamp, in.uv);
return s * in.tint * billboards.opacityMul;
}`}function ct(t,e){return`${U}
struct S {
opacityMul: vec4f,
axisAndCutoff: vec4f,
};
@group(1) @binding(0) var<uniform> billboards: S;
@group(1) @binding(1) var atlasTex: texture_2d<f32>;
@group(1) @binding(2) var atlasSamp: sampler;
${at(t)}
struct I {
@builtin(vertex_index) vid: u32,
@location(0) p: vec3f,
@location(1) s: vec2f,
@location(2) a: vec2f,
@location(3) b: vec2f,
@location(4) r: f32,
@location(5) o: vec2f,
@location(6) c: vec4f,
};
struct O {
@builtin(position) p: vec4f,
@location(0) uv: vec2f,
@location(1) tint: vec4f,
};
@vertex
fn vs(in: I) -> O {
let q = vec2f(select(0.0, 1.0, in.vid == 1u || in.vid == 2u), select(0.0, 1.0, in.vid >= 2u));
let l = (q - in.o) * in.s;
let cr = cos(in.r);
let sr = sin(in.r);
let r = vec2f(l.x * cr - l.y * sr, l.x * sr + l.y * cr);
let b = basis(in.p);
let wp = in.p + b.r * r.x + b.u * r.y;
var out: O;
out.p = scene.viewProjection * vec4f(wp, 1);
out.uv = mix(in.a, in.b, q);
out.tint = in.c;
return out;
}
${st(e)}`}function $(){return{_devices:new WeakMap}}function Y(t){t._devices=new WeakMap}function k(t,e,i,o,n,r,a){let s=ft(t,e),c=g(n._depthMode),u=m()?.pipelineKeyPart(n)??"",l=`${i}:${o}:${n._orientation}:${n.blendMode._key}:${c.index}:${r}:${u}`,d=s._pipelines.get(l);if(d)return d;let p=lt(t,s,i,o,n,r,a);return s._pipelines.set(l,p),p}function D(t,e,i){return t.createBuffer({label:i,size:e._capacity*y,usage:I.VERTEX|I.COPY_DST})}function N(){return{_capacity:0,_sortedInstanceData:new S(0),_sortIndices:new O(0),_sortDepths:new S(0)}}function q(t,e,i,o,n,r=0,a=0,s=0){let c=e.count;if(c===0){e._dirtyMin=0,e._dirtyMax=0;return}X(o,c);let u=e._instanceData,l=o._sortedInstanceData,d=o._sortIndices,p=o._sortDepths;for(let f=0;f<c;f++){let _=f*x,B=u[_]-r,v=u[_+1]-a,w=u[_+2]-s;d[f]=f,p[f]=n[2]*B+n[6]*v+n[10]*w+n[14]}d.subarray(0,c).sort((f,_)=>p[_]-p[f]||f-_);for(let f=0;f<c;f++){let _=d[f]*x,B=f*x;l[B]=u[_]-r,l[B+1]=u[_+1]-a,l[B+2]=u[_+2]-s;for(let v=3;v<x;v++)l[B+v]=u[_+v]}t.queue.writeBuffer(i,0,l.buffer,l.byteOffset,c*y),e._dirtyMin=0,e._dirtyMax=0}function W(t,e,i,o,n){return o>=e._capacity?{buffer:i,capacity:o,reallocated:!1}:(i.destroy(),{buffer:D(t,e,n),capacity:e._capacity,reallocated:!0})}function z(t,e,i,o,n=0,r=0,a=0,s=null){if(o===e._version)return o;if(e.count===0)return e._dirtyMin=0,e._dirtyMax=0,e._version;if((n!==0||r!==0||a!==0)&&s){let l=e.count;X(s,l);let d=e._instanceData,p=s._sortedInstanceData;for(let f=0;f<l;f++){let _=f*x;p[_]=d[_]-n,p[_+1]=d[_+1]-r,p[_+2]=d[_+2]-a;for(let B=3;B<x;B++)p[_+B]=d[_+B]}return t.queue.writeBuffer(i,0,p.buffer,p.byteOffset,l*y),e._dirtyMin=0,e._dirtyMax=0,e._version}let c,u;if(o===-1?(c=0,u=e.count):(c=e._dirtyMin,u=Math.min(e._dirtyMax,e.count)),u>c){let l=c*y,d=(u-c)*y;t.queue.writeBuffer(i,l,e._instanceData.buffer,e._instanceData.byteOffset+l,d)}return e._dirtyMin=0,e._dirtyMax=0,e._version}function X(t,e){t._capacity>=e||(t._capacity=e,t._sortedInstanceData=new S(e*x),t._sortIndices=new O(e),t._sortDepths=new S(e))}function H(t,e){let i=t.opacity;t.blendMode._premultipliedOpacity?(e[0]=i,e[1]=i,e[2]=i,e[3]=i):(e[0]=1,e[1]=1,e[2]=1,e[3]=i),e[4]=t._axis[0],e[5]=t._axis[1],e[6]=t._axis[2],e[7]=t.alphaCutoff}function Z(t,e,i,o,n){let r=n;if(!r){for(let a=0;a<rt;a++)if(o[a]!==i[a]){r=!0;break}}r&&(t.queue.writeBuffer(e,0,i.buffer,i.byteOffset,h),o.set(i))}function K(t,e,i,o,n){let r=i.atlas.texture,a=[{binding:0,resource:{buffer:o}},{binding:1,resource:r.view},{binding:2,resource:r.sampler}];if(n)for(let s of m().bindEntries(n,3))a.push(s);return t._device.createBindGroup({layout:e.getBindGroupLayout(1),entries:a})}function ft(t,e){let i=e._devices.get(t._device);return i||(i={_shaderModules:new Map,_pipelines:new Map},e._devices.set(t._device,i)),i}function ut(t,e,i){let o=i._orientation,n=i._depthMode,r=m()?.shaderModule(t,i);if(r)return r;let a=`${o}:${g(n).index}`,s=e._shaderModules.get(a);return s||(s=t._device.createShaderModule({code:ct(o,n)}),e._shaderModules.set(a,s)),s}function lt(t,e,i,o,n,r,a){let s=t._device,c=g(n._depthMode),u=ut(t,e,n),l=[{binding:0,visibility:M.VERTEX|M.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:M.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:M.FRAGMENT,sampler:{type:"filtering"}}],d=m()?.layoutEntries(n,3);if(d)for(let f of d)l.push(f);let p=s.createBindGroupLayout({entries:l});return s.createRenderPipeline({label:`${n._orientation}-billboard-sprite-pipeline`,layout:s.createPipelineLayout({bindGroupLayouts:[a,p]}),vertex:{module:u,entryPoint:"vs",buffers:[{arrayStride:y,stepMode:"instance",attributes:[{shaderLocation:0,offset:J,format:"float32x3"},{shaderLocation:1,offset:Q,format:"float32x2"},{shaderLocation:2,offset:tt,format:"float32x2"},{shaderLocation:3,offset:et,format:"float32x2"},{shaderLocation:4,offset:it,format:"float32"},{shaderLocation:5,offset:ot,format:"float32x2"},{shaderLocation:6,offset:nt,format:"float32x4"}]}]},fragment:{module:u,entryPoint:"fs",targets:[n.blendMode._descriptor?{format:i,blend:n.blendMode._descriptor,writeMask:T.ALL}:{format:i,writeMask:T.ALL}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:r,depthCompare:"greater-equal",depthWriteEnabled:c.writeEnabled},multisample:{count:o}})}var E=null,C=0;function _t(){return E??=$(),C++,E}function dt(){C!==0&&(C--,C===0&&E&&(Y(E),E=null))}function Dt(t,e){let i=P(t,G,I.INDEX),o=R(t,h,`${e._orientation}-billboard-system-ubo`),n=D(t._device,e,`${e._orientation}-billboard-instances`),r=m()?.createLayerFx(t,`${e._orientation}-billboard-fx-ubo`,e)??null,a=e._depthMode==="transparent",s={order:e.order,isTransparent:a,_direct:!a,_engine:t,_system:e,_indexBuffer:i,_uniformBuffer:o,_instanceBuffer:n,_instanceBufferCapacity:e._capacity,_instanceSortScratch:N(),_pipelineCache:_t(),_bindGroups:new Map,_uploadedVersion:-1,_uploadedCamera:null,_uploadedCameraViewVersion:-1,_uploadedSorted:!1,_centerVersion:-1,_drawableCount:0,_uboUploaded:!1,_lastUbo:new S(h/4),_scratchUbo:new S(h/4),_fx:r,_disposed:!1,_worldCenter:[0,0,0],bind(c,u){return pt(s,c,u)}};return b(s),{renderable:s,dispose(){mt(s)}}}function pt(t,e,i){if(!i._depthStencilFormat)throw new Error("BillboardSpriteSystem requires a depth-stencil render target.");let o=i._sampleCount===1?1:4,n=k(e,t._pipelineCache,i._colorFormat,o,t._system,i._depthStencilFormat,F(e)),r=t._bindGroups.get(n);return r||(r=K(e,n,t._system,t._uniformBuffer,t._fx),t._bindGroups.set(n,r)),{renderable:t,pipeline:n,update(a){Bt(t,a)},draw(a){return vt(t,r,a)}}}function Bt(t,e){if(t._disposed)return;if(b(t),!t._system.visible||t._system.count===0){t._system.count===0&&(t._system._dirtyMin=0,t._system._dirtyMax=0,t._uploadedVersion=t._system._version,t._uploadedSorted=!1);return}t._fx&&m().updateFx(t._fx,t._system,t._engine._currentDelta);let i=W(t._engine._device,t._system,t._instanceBuffer,t._instanceBufferCapacity,`${t._system._orientation}-billboard-instances`);i.reallocated&&(t._instanceBuffer=i.buffer,t._instanceBufferCapacity=i.capacity,t._uploadedVersion=-1,t._uploadedCamera=null,t._uploadedCameraViewVersion=-1,t._uploadedSorted=!1);let o=e._camera,n=t._engine.useFloatingOrigin&&o!=null,r=0,a=0,s=0;if(n){let c=o.worldMatrix;r=c[12],a=c[13],s=c[14]}if(t._system._depthMode==="transparent"&&o){let c=V(o);(!t._uploadedSorted||t._uploadedVersion!==t._system._version||t._uploadedCamera!==o||t._uploadedCameraViewVersion!==o.worldMatrixVersion)&&(q(t._engine._device,t._system,t._instanceBuffer,t._instanceSortScratch,c,r,a,s),t._uploadedVersion=t._system._version,t._uploadedCamera=o,t._uploadedCameraViewVersion=o.worldMatrixVersion,t._uploadedSorted=!0)}else{let c=t._uploadedSorted?-1:t._uploadedVersion;n&&(t._uploadedCamera!==o||t._uploadedCameraViewVersion!==o.worldMatrixVersion)&&(c=-1),t._uploadedVersion=z(t._engine._device,t._system,t._instanceBuffer,c,r,a,s,t._instanceSortScratch),n?(t._uploadedCamera=o,t._uploadedCameraViewVersion=o.worldMatrixVersion):(t._uploadedCamera=null,t._uploadedCameraViewVersion=-1),t._uploadedSorted=!1}H(t._system,t._scratchUbo),Z(t._engine._device,t._uniformBuffer,t._scratchUbo,t._lastUbo,!t._uboUploaded),t._uboUploaded=!0}function b(t){let e=t._system;if(t._centerVersion===e._version)return;let i=t._worldCenter;if(e.count===0){i[0]=0,i[1]=0,i[2]=0,t._drawableCount=0,t._centerVersion=e._version;return}let o=e._instanceData,n=e._instanceFloatsPerSprite,r=1/0,a=1/0,s=1/0,c=-1/0,u=-1/0,l=-1/0,d=0;for(let p=0;p<e.count;p++){let f=p*n,_=o[f+3],B=o[f+4];if(_===0||B===0)continue;let v=o[f],w=o[f+1],L=o[f+2];v<r&&(r=v),w<a&&(a=w),L<s&&(s=L),v>c&&(c=v),w>u&&(u=w),L>l&&(l=L),d++}d===0?(i[0]=0,i[1]=0,i[2]=0):(i[0]=(r+c)*.5,i[1]=(a+u)*.5,i[2]=(s+l)*.5),t._drawableCount=d,t._centerVersion=e._version}function vt(t,e,i){return t._disposed||(b(t),!t._system.visible||t._system.count===0||t._drawableCount===0)?0:(i.setBindGroup(1,e),i.setIndexBuffer(t._indexBuffer,"uint16"),i.setVertexBuffer(0,t._instanceBuffer),i.drawIndexed(6,t._system.count,0,0,0),1)}function mt(t){t._disposed||(t._disposed=!0,t._instanceBuffer.destroy(),t._uniformBuffer.destroy(),t._indexBuffer.destroy(),t._fx&&m().disposeFx(t._fx),t._bindGroups.clear(),dt())}export{Dt as buildBillboardRenderable};
