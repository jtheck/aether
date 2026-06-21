import{a as h}from"./chunk-GUAFLABN.js";import{O as m,a as M,c as S,l as c}from"./chunk-ZBW7LZ4P.js";var I=64,O=192,R=44,G=24,P=40,z=20,T=`
struct CullParams{planes:array<vec4<f32>,6>,meshWorld:mat4x4<f32>,localSphere:vec4<f32>,count:u32};
@group(0)@binding(0)var<storage,read> srcMatrices:array<mat4x4<f32>>;
@group(0)@binding(1)var<storage,read_write> dstMatrices:array<mat4x4<f32>>;
@group(0)@binding(2)var<storage,read_write> args:array<atomic<u32>>;
@group(0)@binding(3)var<uniform> params:CullParams;
fn visible(world:mat4x4<f32>)->bool{
let center=(world*vec4<f32>(params.localSphere.xyz,1.0)).xyz;
let sx=length(world[0].xyz);
let sy=length(world[1].xyz);
let sz=length(world[2].xyz);
let radius=params.localSphere.w*max(max(sx,sy),sz)+0.0001;
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
}`,L=`${T}
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
}`,E=null,x=null,C=null;function F(){let e=new ArrayBuffer(O);return{_capacity:0,_visibleMatrixBuffer:null,_visibleColorBuffer:null,_argsBuffer:null,_paramsBuffer:null,_bindGroup:null,_srcMatrixBuffer:null,_srcColorBuffer:null,_hasColor:!1,_localSphereReady:!1,_localSphere:new M(4),_paramsBytes:e,_paramsF32:new M(e),_paramsU32:new S(e),_argsData:new S(5),_drawBuffers:null}}function A(e){var r,i,o,l;(r=e._visibleMatrixBuffer)==null||r.destroy(),(i=e._visibleColorBuffer)==null||i.destroy(),(o=e._argsBuffer)==null||o.destroy(),(l=e._paramsBuffer)==null||l.destroy(),e._visibleMatrixBuffer=null,e._visibleColorBuffer=null,e._argsBuffer=null,e._paramsBuffer=null,e._bindGroup=null,e._drawBuffers=null}function D(e,r,i,o,l,n,u){let a=u._camera;if(!l._gpuCullingEnabled||!a||i.visible===!1||l.count===0||n&&!l.colors||!r._localSphereReady&&!X(i,r._localSphere))return r._drawBuffers=null,null;r._localSphereReady=!0,h(e,l,n);let s=l._gpuBuffer,f=n?l._colorGpuBuffer:null;if(!s||n&&!f)return r._drawBuffers=null,null;U(e,r,l._capacity,n);let d=r._visibleMatrixBuffer,t=n?r._visibleColorBuffer:null,_=r._argsBuffer,y=r._paramsBuffer,w=W(e,n);if(r._bindGroup===null||r._srcMatrixBuffer!==s||r._srcColorBuffer!==f||r._hasColor!==n){let g=[{binding:0,resource:{buffer:s}},{binding:1,resource:{buffer:d}},{binding:2,resource:{buffer:_}},{binding:3,resource:{buffer:y}}];n&&g.push({binding:4,resource:{buffer:f}},{binding:5,resource:{buffer:t}}),r._bindGroup=e._device.createBindGroup({layout:w.getBindGroupLayout(0),entries:g}),r._srcMatrixBuffer=s,r._srcColorBuffer=f,r._hasColor=n}let p=a.viewport,v=u.targetWidth/u.targetHeight*(p?p.width/p.height:1);N(e,r,i,o.indexCount,l.count,a,v);let B=e._currentEncoder.beginComputePass();return B.setPipeline(w),B.setBindGroup(0,r._bindGroup),B.dispatchWorkgroups(Math.ceil(l.count/I)),B.end(),r._drawBuffers={matrixBuffer:d,colorBuffer:t},{drawBuffers:r._drawBuffers,argsBuffer:_}}function U(e,r,i,o){var l,n;let u=e._device;r._capacity<i?((l=r._visibleMatrixBuffer)==null||l.destroy(),(n=r._visibleColorBuffer)==null||n.destroy(),r._visibleMatrixBuffer=u.createBuffer({size:Math.max(i*64,4),usage:c.VERTEX|c.STORAGE}),r._visibleColorBuffer=o?u.createBuffer({size:Math.max(i*16,4),usage:c.VERTEX|c.STORAGE}):null,r._capacity=i,r._bindGroup=null,r._drawBuffers=null):o&&!r._visibleColorBuffer&&(r._visibleColorBuffer=u.createBuffer({size:Math.max(r._capacity*16,4),usage:c.VERTEX|c.STORAGE}),r._bindGroup=null,r._drawBuffers=null),r._argsBuffer||(r._argsBuffer=u.createBuffer({size:z,usage:c.INDIRECT|c.STORAGE|c.COPY_DST})),r._paramsBuffer||(r._paramsBuffer=u.createBuffer({size:O,usage:c.UNIFORM|c.COPY_DST}))}function W(e,r){let i=e._device;return E!==i&&(E=i,x=null,C=null),r?(C??(C=i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:L}),entryPoint:"mainColor"}})),C):(x??(x=i.createComputePipeline({layout:"auto",compute:{module:i.createShaderModule({code:T}),entryPoint:"main"}})),x)}function N(e,r,i,o,l,n,u){let a=r._paramsF32,s=m(n,u);Y(a,s),a.set(i.worldMatrix,G),a.set(r._localSphere,P),r._paramsU32[R]=l;let f=r._argsData;f[0]=o,f[1]=0,f[2]=0,f[3]=0,f[4]=0,e._device.queue.writeBuffer(r._argsBuffer,0,f.buffer,f.byteOffset,f.byteLength),e._device.queue.writeBuffer(r._paramsBuffer,0,r._paramsBytes)}function Y(e,r){b(e,0,r[3]+r[0],r[7]+r[4],r[11]+r[8],r[15]+r[12]),b(e,4,r[3]-r[0],r[7]-r[4],r[11]-r[8],r[15]-r[12]),b(e,8,r[3]+r[1],r[7]+r[5],r[11]+r[9],r[15]+r[13]),b(e,12,r[3]-r[1],r[7]-r[5],r[11]-r[9],r[15]-r[13]),b(e,16,r[2],r[6],r[10],r[14]),b(e,20,r[3]-r[2],r[7]-r[6],r[11]-r[10],r[15]-r[14])}function b(e,r,i,o,l,n){let u=1/Math.hypot(i,o,l);e[r]=i*u,e[r+1]=o*u,e[r+2]=l*u,e[r+3]=n*u}function X(e,r){let i=e._cpuPositions;if(!i||i.length<3)return!1;let o=1/0,l=1/0,n=1/0,u=-1/0,a=-1/0,s=-1/0;for(let p=0;p<i.length;p+=3){let v=i[p],B=i[p+1],g=i[p+2];v<o&&(o=v),v>u&&(u=v),B<l&&(l=B),B>a&&(a=B),g<n&&(n=g),g>s&&(s=g)}if(!isFinite(o))return!1;let f=(o+u)*.5,d=(l+a)*.5,t=(n+s)*.5,_=u-f,y=a-d,w=s-t;return r[0]=f,r[1]=d,r[2]=t,r[3]=Math.hypot(_,y,w),!0}function H(e,r,i,o,l,n,u){var a;let s=i.thinInstances;if(n||!s?._gpuCullingEnabled)return;e._direct=!0;let f=F();(a=r._meshDisposables.get(i))==null||a.push(()=>{A(f)});let d={cullDrawBufs:null,_args:null,update(t){u?.(t);let _=D(o,f,i,i._gpu,s,l,t);d.cullDrawBufs=_?.drawBuffers??null,d._args=_?.argsBuffer??null},draw(t,_,y){d._args?t.drawIndexedIndirect(d._args,0):t.drawIndexed(_,y)}};return d}export{H as tryBind};
