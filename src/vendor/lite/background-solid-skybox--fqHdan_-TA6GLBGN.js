import{a as _}from"./chunk-2EVAZFTP.js";import{c as x}from"./chunk-6R3BZD2T.js";import{Me as U,R as g,T as M,V as E,X as b,a as l,e as h,jh as C,l as f,m as p,p as v}from"./chunk-ZBW7LZ4P.js";var I=`// Skybox Fragment Shader \u2014 matches Babylon BackgroundMaterial
// BJS loads a separate CDN skybox texture (backgroundSkybox.dds) that produces
// exactly scene.clearColor when rendered through the BackgroundMaterial pipeline.
// We replicate this by outputting the pre-computed clearColor directly from a UBO.

struct MeshUniforms {
  world: mat4x4<f32>,
  primaryColor: vec3<f32>,
  _pad: f32,
  // Pre-computed sRGB output color for the sky background (= scene.clearColor).
  skyOutputColor: vec3<f32>,
  _pad2: f32,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct FragmentInput {
  @location(0) positionUVW: vec3<f32>,
  @location(1) positionW: vec3<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  var result = vec4<f32>(mesh.skyOutputColor, 1.0);

  // Dithering (enableNoise=true, variance=0.5)
  result = vec4<f32>(result.rgb + vec3<f32>(dither(input.positionW.xy, 0.5)), result.a);
  result = max(result, vec4<f32>(0.0));

  return result;
}
`,O=96;function D(r,e){let t=new l([e,-e,e,-e,-e,e,-e,e,e,e,e,e,e,e,-e,-e,e,-e,-e,-e,-e,e,-e,-e,e,e,-e,e,-e,-e,e,-e,e,e,e,e,-e,e,e,-e,-e,e,-e,-e,-e,-e,e,-e,-e,e,e,-e,e,-e,e,e,-e,e,e,e,e,-e,e,e,-e,-e,-e,-e,-e,-e,-e,e]),n=new h([2,1,0,3,2,0,6,5,4,7,6,4,10,9,8,11,10,8,14,13,12,15,14,12,18,17,16,19,18,16,22,21,20,23,22,20]);return{posBuffer:b(r,t,f.VERTEX),idxBuffer:b(r,n,f.INDEX),idxCount:36}}function L(r){let e=new l(16);return e[0]=1,e[5]=1,e[10]=1,e[15]=1,e[12]=r[0],e[13]=r[1],e[14]=r[2],e}var N=[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}],y=new Map,i=null,m=null;function P(){function r(e){let t=e._device;return i&&m===t||(i=C(e,"skybox-material",p.VERTEX|p.FRAGMENT)),i}return{getPipeline(e,t){let n=e._device;m!==n&&(y.clear(),i=null,m=n);let o=v(t),a=y.get(o);if(a)return a;let d=n.createShaderModule({code:U+_,label:"skybox-vert"}),s=n.createShaderModule({code:x+I,label:"skybox-frag"}),c=n.createRenderPipeline(M({_label:"skybox-pipeline",_engine:e,_bgls:[g(e),r(e)],_vertModule:d,_fragModule:s,_vertexBuffers:N,_format:t._colorFormat,_depthStencilFormat:t._depthStencilFormat,_depthCompare:t._depthCompare,_msaaSamples:t._sampleCount,_depthWriteEnabled:!1}));return y.set(o,c),c},createBindGroup(e,t,n){return e._device.createBindGroup({layout:r(e),entries:[{binding:0,resource:{buffer:t}}]})}}}function A(r,e,t,n,o){let a=r.surface.engine,d=L(n),s=r.clearColor,c=D(a,t),B=P(),F=[s.r,s.g,s.b],w=T(a,d,o,F),G=B.createBindGroup(a,w,e),k={order:0,isTransparent:!1,bind(R,W){return{renderable:k,pipeline:B.getPipeline(R,W),draw(u){return u.setBindGroup(1,G),u.setVertexBuffer(0,c.posBuffer),u.setIndexBuffer(c.idxBuffer,"uint16"),u.drawIndexed(c.idxCount),1}}}};return k}function T(r,e,t,n){let o=new l(O/4);return o.set(e,0),o[16]=t[0],o[17]=t[1],o[18]=t[2],o[20]=n[0],o[21]=n[1],o[22]=n[2],E(r,o)}export{A as buildSolidSkyboxRenderable};
