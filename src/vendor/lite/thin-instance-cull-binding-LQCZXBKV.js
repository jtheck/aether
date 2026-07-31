import{a as O}from"./chunk-QSHY3N37.js";import{c as I}from"./chunk-OHUUFLWP.js";import"./chunk-IJL5AUX4.js";import{c as M}from"./chunk-JIVGNFPA.js";import"./chunk-OG424QW5.js";import"./chunk-W6HAXV2Z.js";import"./chunk-2BH75LVA.js";import{a as S,c as m}from"./chunk-RYWGU6XF.js";import{b as _}from"./chunk-VCOYERVR.js";var W=64,R=192,U=44,k=24,X=40,N=45,Y=20,z=`
struct CullParams{planes:array<vec4<f32>,6>,meshWorld:mat4x4<f32>,localSphere:vec4<f32>,count:u32,boundsPad:f32};
@group(0)@binding(0)var<storage,read> srcMatrices:array<mat4x4<f32>>;
@group(0)@binding(1)var<storage,read_write> dstMatrices:array<mat4x4<f32>>;
@group(0)@binding(2)var<storage,read_write> args:array<atomic<u32>>;
@group(0)@binding(3)var<uniform> params:CullParams;
fn visible(world:mat4x4<f32>)->bool{
let center=(world*vec4<f32>(params.localSphere.xyz,1.0)).xyz;
let sx=length(world[0].xyz);
let sy=length(world[1].xyz);
let sz=length(world[2].xyz);
let radius=params.localSphere.w*max(max(sx,sy),sz)+params.boundsPad+0.0001;
for(var i=0u;i<6u;i++){
let p=params.planes[i];
if(dot(p.xyz,center)+p.w < -radius){return false;}
}
return true;
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid:vec3<u32>){
let i=gid.x;
if(i>=params.count){return;}
let world=params.meshWorld*srcMatrices[i];
if(!visible(world)){return;}
let outIndex=atomicAdd(&args[1],1u);
dstMatrices[outIndex]=srcMatrices[i];
}`,V=`${z}
@group(0)@binding(4)var<storage,read> srcColors:array<vec4<f32>>;
@group(0)@binding(5)var<storage,read_write> dstColors:array<vec4<f32>>;
@compute @workgroup_size(64)
fn mainColor(@builtin(global_invocation_id) gid:vec3<u32>){
let i=gid.x;
if(i>=params.count){return;}
let world=params.meshWorld*srcMatrices[i];
if(!visible(world)){return;}
let outIndex=atomicAdd(&args[1],1u);
dstMatrices[outIndex]=srcMatrices[i];
dstColors[outIndex]=srcColors[i];
}`,G=null,P=null,E=null,h=null;function A(e){h??=new WeakMap;let r=h.get(e);if(r)return r;let i=[],l=0;return r={reset(){l=0},flush(n){if(l===0)return;let u=n._currentEncoder.beginComputePass(),f=null;for(let a=0;a<l;a++){let o=i[a];o.pipeline!==f&&(u.setPipeline(o.pipeline),f=o.pipeline),u.setBindGroup(0,o.bindGroup),u.dispatchWorkgroups(o.workgroupsX)}u.end()},destroy(){i.length=0,l=0,h?.delete(e)},queue(n){i[l++]=n}},h.set(e,r),r}function F(){let e=new ArrayBuffer(R);return{_capacity:0,_visibleMatrixBuffer:null,_visibleColorBuffer:null,_argsBuffer:null,_paramsBuffer:null,_bindGroup:null,_srcMatrixBuffer:null,_srcColorBuffer:null,_hasColor:!1,_localSphereReady:!1,_localSphere:new S(4),_paramsBytes:e,_paramsF32:new S(e),_paramsU32:new m(e),_argsData:new m(5),_drawBuffers:null,_indexCount:-1,_active:!1}}function L(e){e._visibleMatrixBuffer?.destroy(),e._visibleColorBuffer?.destroy(),e._argsBuffer?.destroy(),e._paramsBuffer?.destroy(),e._visibleMatrixBuffer=null,e._visibleColorBuffer=null,e._argsBuffer=null,e._paramsBuffer=null,e._bindGroup=null,e._drawBuffers=null}function D(e,r,i,l,n,u,f,a){let o=f._camera;if(!n._gpuCullingEnabled||!o||i.visible===!1||n.count===0||u&&!n.colors)return C(r,!1),r._drawBuffers=null,null;let c=i._cpuPositions;if(!r._localSphereReady||r._localPositions!==c||r._localBoundMin!==i.boundMin||r._localBoundMax!==i.boundMax){if(!K(i,r._localSphere))return C(r,!1),r._drawBuffers=null,null;r._localSphereReady=!0,r._localPositions=c,r._localBoundMin=i.boundMin,r._localBoundMax=i.boundMax}O(e,n,u);let p=n._gpuBuffer,s=u?n._colorGpuBuffer:null;if(!p||u&&!s)return C(r,!1),r._drawBuffers=null,null;q(e,r,n._capacity,u);let w=r._visibleMatrixBuffer,B=u?r._visibleColorBuffer:null,t=r._argsBuffer,d=r._paramsBuffer,g=H(e,u);if(r._bindGroup===null||r._srcMatrixBuffer!==p||r._srcColorBuffer!==s||r._hasColor!==u){let y=[{binding:0,resource:{buffer:p}},{binding:1,resource:{buffer:w}},{binding:2,resource:{buffer:t}},{binding:3,resource:{buffer:d}}];u&&y.push({binding:4,resource:{buffer:s}},{binding:5,resource:{buffer:B}}),r._bindGroup=e._device.createBindGroup({layout:g.getBindGroupLayout(0),entries:y}),r._srcMatrixBuffer=p,r._srcColorBuffer=s,r._hasColor=u}let b=o.viewport,v=f.targetWidth/f.targetHeight*(b?b.width/b.height:1);Z(e,r,i,l.indexCount,n.count,o,v);let T={pipeline:g,bindGroup:r._bindGroup,workgroupsX:Math.ceil(n.count/W)};if(a)a.queue(T);else{let y=e._currentEncoder.beginComputePass();y.setPipeline(g),y.setBindGroup(0,r._bindGroup),y.dispatchWorkgroups(T.workgroupsX),y.end()}return r._drawBuffers={matrixBuffer:w,colorBuffer:B},C(r,!0),{drawBuffers:r._drawBuffers,argsBuffer:t}}function q(e,r,i,l){let n=e._device;r._capacity<i?(r._visibleMatrixBuffer?.destroy(),r._visibleColorBuffer?.destroy(),r._visibleMatrixBuffer=n.createBuffer({size:Math.max(i*64,4),usage:_.VERTEX|_.STORAGE}),r._visibleColorBuffer=l?n.createBuffer({size:Math.max(i*16,4),usage:_.VERTEX|_.STORAGE}):null,r._capacity=i,r._bindGroup=null,r._drawBuffers=null,M()):l&&!r._visibleColorBuffer&&(r._visibleColorBuffer=n.createBuffer({size:Math.max(r._capacity*16,4),usage:_.VERTEX|_.STORAGE}),r._bindGroup=null,r._drawBuffers=null,M()),r._argsBuffer||(r._argsBuffer=n.createBuffer({size:Y,usage:_.INDIRECT|_.STORAGE|_.COPY_DST})),r._paramsBuffer||(r._paramsBuffer=n.createBuffer({size:R,usage:_.UNIFORM|_.COPY_DST}))}function H(e,r){let i=e._device;return G!==i&&(G=i,P=null,E=null),r?(E??=i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:V}),entryPoint:"mainColor"}}),E):(P??=i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:z}),entryPoint:"main"}}),P)}function Z(e,r,i,l,n,u,f){let a=r._paramsF32,o=I(u,f);if(j(a,o),a.set(i.worldMatrix,k),a.set(r._localSphere,X),r._paramsU32[U]=n,a[N]=i.thinInstances?._cullBoundsPad??0,r._indexCount!==l){let c=r._argsData;c[0]=l,c[1]=0,c[2]=0,c[3]=0,c[4]=0,e._device.queue.writeBuffer(r._argsBuffer,0,c.buffer,c.byteOffset,c.byteLength),r._indexCount=l}else e._currentEncoder.clearBuffer(r._argsBuffer,4,4);e._device.queue.writeBuffer(r._paramsBuffer,0,r._paramsBytes)}function C(e,r){e._active!==r&&(e._active=r,M())}function j(e,r){x(e,0,r[3]+r[0],r[7]+r[4],r[11]+r[8],r[15]+r[12]),x(e,4,r[3]-r[0],r[7]-r[4],r[11]-r[8],r[15]-r[12]),x(e,8,r[3]+r[1],r[7]+r[5],r[11]+r[9],r[15]+r[13]),x(e,12,r[3]-r[1],r[7]-r[5],r[11]-r[9],r[15]-r[13]),x(e,16,r[2],r[6],r[10],r[14]),x(e,20,r[3]-r[2],r[7]-r[6],r[11]-r[10],r[15]-r[14])}function x(e,r,i,l,n,u){let f=1/Math.hypot(i,l,n);e[r]=i*f,e[r+1]=l*f,e[r+2]=n*f,e[r+3]=u*f}function K(e,r){let i=e._cpuPositions;if(!i||i.length<3)return!1;let l=1/0,n=1/0,u=1/0,f=-1/0,a=-1/0,o=-1/0;for(let d=0;d<i.length;d+=3){let g=i[d],b=i[d+1],v=i[d+2];g<l&&(l=g),g>f&&(f=g),b<n&&(n=b),b>a&&(a=b),v<u&&(u=v),v>o&&(o=v)}if(!isFinite(l))return!1;let c=(l+f)*.5,p=(n+a)*.5,s=(u+o)*.5,w=f-c,B=a-p,t=o-s;return r[0]=c,r[1]=p,r[2]=s,r[3]=Math.hypot(w,B,t),!0}function ur(e,r,i,l,n,u,f,a){let o=i.thinInstances;if(u||!o?._gpuCullingEnabled)return;let c=e,p=c._tiCullStates??=new WeakMap,s=p.get(a);if(s)s._localSphereReady=!1;else{s=F(),p.set(a,s);let t=s;r._meshDisposables.get(i)?.push(()=>{L(t)})}let w=A(a),B={cullDrawBufs:null,_args:null,_updateBatch:w,update(t){f?.(t);let d=D(l,s,i,i._gpu,o,n,t,w);B.cullDrawBufs=d?.drawBuffers??null,B._args=d?.argsBuffer??null},draw(t,d,g){B._args?t.drawIndexedIndirect(B._args,0):o._drawArgsBuffer?t.drawIndexedIndirect(o._drawArgsBuffer,0):t.drawIndexed(d,g)}};return B}export{ur as tryBind};
