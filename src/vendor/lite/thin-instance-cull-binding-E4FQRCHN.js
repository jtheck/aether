import{a as m}from"./chunk-YRHD54JR.js";import{c as h}from"./chunk-OHUUFLWP.js";import"./chunk-IJL5AUX4.js";import"./chunk-W6HAXV2Z.js";import{a as x,c as C}from"./chunk-RYWGU6XF.js";import{b as t}from"./chunk-VCOYERVR.js";var G=64,E=192,z=44,F=24,L=40,A=45,D=20,O=`
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
}`,U=`${O}
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
}`,T=null,S=null,M=null;function P(){let e=new ArrayBuffer(E);return{_capacity:0,_visibleMatrixBuffer:null,_visibleColorBuffer:null,_argsBuffer:null,_paramsBuffer:null,_bindGroup:null,_srcMatrixBuffer:null,_srcColorBuffer:null,_hasColor:!1,_localSphereReady:!1,_localSphere:new x(4),_paramsBytes:e,_paramsF32:new x(e),_paramsU32:new C(e),_argsData:new C(5),_drawBuffers:null}}function I(e){e._visibleMatrixBuffer?.destroy(),e._visibleColorBuffer?.destroy(),e._argsBuffer?.destroy(),e._paramsBuffer?.destroy(),e._visibleMatrixBuffer=null,e._visibleColorBuffer=null,e._argsBuffer=null,e._paramsBuffer=null,e._bindGroup=null,e._drawBuffers=null}function R(e,r,i,f,u,n,o){let a=o._camera;if(!u._gpuCullingEnabled||!a||i.visible===!1||u.count===0||n&&!u.colors||!r._localSphereReady&&!k(i,r._localSphere))return r._drawBuffers=null,null;r._localSphereReady=!0,m(e,u,n);let s=u._gpuBuffer,l=n?u._colorGpuBuffer:null;if(!s||n&&!l)return r._drawBuffers=null,null;W(e,r,u._capacity,n);let b=r._visibleMatrixBuffer,c=n?r._visibleColorBuffer:null,p=r._argsBuffer,d=r._paramsBuffer,B=N(e,n);if(r._bindGroup===null||r._srcMatrixBuffer!==s||r._srcColorBuffer!==l||r._hasColor!==n){let y=[{binding:0,resource:{buffer:s}},{binding:1,resource:{buffer:b}},{binding:2,resource:{buffer:p}},{binding:3,resource:{buffer:d}}];n&&y.push({binding:4,resource:{buffer:l}},{binding:5,resource:{buffer:c}}),r._bindGroup=e._device.createBindGroup({layout:B.getBindGroupLayout(0),entries:y}),r._srcMatrixBuffer=s,r._srcColorBuffer=l,r._hasColor=n}let _=a.viewport,w=o.targetWidth/o.targetHeight*(_?_.width/_.height:1);Y(e,r,i,f.indexCount,u.count,a,w);let g=e._currentEncoder.beginComputePass();return g.setPipeline(B),g.setBindGroup(0,r._bindGroup),g.dispatchWorkgroups(Math.ceil(u.count/G)),g.end(),r._drawBuffers={matrixBuffer:b,colorBuffer:c},{drawBuffers:r._drawBuffers,argsBuffer:p}}function W(e,r,i,f){let u=e._device;r._capacity<i?(r._visibleMatrixBuffer?.destroy(),r._visibleColorBuffer?.destroy(),r._visibleMatrixBuffer=u.createBuffer({size:Math.max(i*64,4),usage:t.VERTEX|t.STORAGE}),r._visibleColorBuffer=f?u.createBuffer({size:Math.max(i*16,4),usage:t.VERTEX|t.STORAGE}):null,r._capacity=i,r._bindGroup=null,r._drawBuffers=null):f&&!r._visibleColorBuffer&&(r._visibleColorBuffer=u.createBuffer({size:Math.max(r._capacity*16,4),usage:t.VERTEX|t.STORAGE}),r._bindGroup=null,r._drawBuffers=null),r._argsBuffer||(r._argsBuffer=u.createBuffer({size:D,usage:t.INDIRECT|t.STORAGE|t.COPY_DST})),r._paramsBuffer||(r._paramsBuffer=u.createBuffer({size:E,usage:t.UNIFORM|t.COPY_DST}))}function N(e,r){let i=e._device;return T!==i&&(T=i,S=null,M=null),r?(M??=i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:U}),entryPoint:"mainColor"}}),M):(S??=i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:O}),entryPoint:"main"}}),S)}function Y(e,r,i,f,u,n,o){let a=r._paramsF32,s=h(n,o);X(a,s),a.set(i.worldMatrix,F),a.set(r._localSphere,L),r._paramsU32[z]=u,a[A]=i.thinInstances?._cullBoundsPad??0;let l=r._argsData;l[0]=f,l[1]=0,l[2]=0,l[3]=0,l[4]=0,e._device.queue.writeBuffer(r._argsBuffer,0,l.buffer,l.byteOffset,l.byteLength),e._device.queue.writeBuffer(r._paramsBuffer,0,r._paramsBytes)}function X(e,r){v(e,0,r[3]+r[0],r[7]+r[4],r[11]+r[8],r[15]+r[12]),v(e,4,r[3]-r[0],r[7]-r[4],r[11]-r[8],r[15]-r[12]),v(e,8,r[3]+r[1],r[7]+r[5],r[11]+r[9],r[15]+r[13]),v(e,12,r[3]-r[1],r[7]-r[5],r[11]-r[9],r[15]-r[13]),v(e,16,r[2],r[6],r[10],r[14]),v(e,20,r[3]-r[2],r[7]-r[6],r[11]-r[10],r[15]-r[14])}function v(e,r,i,f,u,n){let o=1/Math.hypot(i,f,u);e[r]=i*o,e[r+1]=f*o,e[r+2]=u*o,e[r+3]=n*o}function k(e,r){let i=e._cpuPositions;if(!i||i.length<3)return!1;let f=1/0,u=1/0,n=1/0,o=-1/0,a=-1/0,s=-1/0;for(let _=0;_<i.length;_+=3){let w=i[_],g=i[_+1],y=i[_+2];w<f&&(f=w),w>o&&(o=w),g<u&&(u=g),g>a&&(a=g),y<n&&(n=y),y>s&&(s=y)}if(!isFinite(f))return!1;let l=(f+o)*.5,b=(u+a)*.5,c=(n+s)*.5,p=o-l,d=a-b,B=s-c;return r[0]=l,r[1]=b,r[2]=c,r[3]=Math.hypot(p,d,B),!0}function $(e,r,i,f,u,n,o,a){let s=i.thinInstances;if(n||!s?._gpuCullingEnabled)return;e._direct=!0;let l=e,b=l._tiCullStates??=new WeakMap,c=b.get(a);if(c)c._localSphereReady=!1;else{c=P(),b.set(a,c);let d=c;r._meshDisposables.get(i)?.push(()=>{I(d)})}let p={cullDrawBufs:null,_args:null,update(d){o?.(d);let B=R(f,c,i,i._gpu,s,u,d);p.cullDrawBufs=B?.drawBuffers??null,p._args=B?.argsBuffer??null},draw(d,B,_){p._args?d.drawIndexedIndirect(p._args,0):d.drawIndexed(B,_)}};return p}export{$ as tryBind};
