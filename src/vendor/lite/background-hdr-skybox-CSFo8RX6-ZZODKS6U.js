import{a as g}from"./chunk-2EVAZFTP.js";import{a as b}from"./chunk-AZ55UI6O.js";import{V as v,Ve as h,X as p,a as s,e as x,l as m}from"./chunk-2GVZXICG.js";var U=`// HDR Skybox Fragment Shader \u2014 samples HDR environment cubemap with image processing.
// Used when scene has an HDR environment rendered as the background.
// Matches BJS BackgroundMaterial: cubemap at LOD 0 + exposure + gamma + contrast.

struct MeshUniforms {
  world: mat4x4<f32>,
  primaryColor: vec3<f32>,
  _pad: f32,
  skyOutputColor: vec3<f32>,
  _pad2: f32,
  exposureLinear: f32,
  contrast: f32,
  _pad3: f32,
  _pad4: f32,
};

@group(1) @binding(0) var<uniform> mesh: MeshUniforms;
@group(1) @binding(1) var envCubemap: texture_cube<f32>;
@group(1) @binding(2) var envSampler: sampler;

struct FragmentInput {
  @location(0) positionUVW: vec3<f32>,
  @location(1) positionW: vec3<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let dir = normalize(input.positionUVW);
  var color = textureSampleLevel(envCubemap, envSampler, dir, 0.0).rgb;

  // Image processing: exposure \u2192 gamma \u2192 contrast (matches BJS applyImageProcessing)
  color *= mesh.exposureLinear;
  color = pow(color, vec3<f32>(1.0 / 2.2));
  color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

  let highContrast = color * color * (3.0 - 2.0 * color);
  if (mesh.contrast < 1.0) { color = mix(vec3<f32>(0.5), color, mesh.contrast); }
  else { color = mix(color, highContrast, mesh.contrast - 1.0); }
  color = max(color, vec3<f32>(0.0));

  return vec4<f32>(color, 1.0);
}
`,_=112;function I(n,e){let o=new s([e,-e,e,-e,-e,e,-e,e,e,e,e,e,e,e,-e,-e,e,-e,-e,-e,-e,e,-e,-e,e,e,-e,e,-e,-e,e,-e,e,e,e,e,-e,e,e,-e,-e,e,-e,-e,-e,-e,e,-e,-e,e,e,-e,e,-e,e,e,-e,e,e,e,e,-e,e,e,-e,-e,-e,-e,-e,-e,-e,e]),t=new x([2,1,0,3,2,0,6,5,4,7,6,4,10,9,8,11,10,8,14,13,12,15,14,12,18,17,16,19,18,16,22,21,20,23,22,20]);return{posBuffer:p(n,o,m.VERTEX),idxBuffer:p(n,t,m.INDEX),idxCount:36}}function M(n){let e=new s(16);return e[0]=1,e[5]=1,e[10]=1,e[15]=1,e[12]=n[0],e[13]=n[1],e[14]=n[2],e}function E(n,e,o,t,i){let a=n.surface.engine,r=M(t),u=n.clearColor,f=I(a,o),l=b("skybox-hdr",h+g,U),B=C(a,r,i,[u.r,u.g,u.b],n.imageProcessing.exposure,n.imageProcessing.contrast),k=l.createBindGroup(a,B,e.specularCubeView,e.cubeSampler),d={order:0,isTransparent:!1,bind(w,y){return{renderable:d,pipeline:l.getPipeline(w,y),draw(c){return c.setBindGroup(1,k),c.setVertexBuffer(0,f.posBuffer),c.setIndexBuffer(f.idxBuffer,"uint16"),c.drawIndexed(f.idxCount),1}}}};return d}function C(n,e,o,t,i,a){let r=new s(_/4);return r.set(e,0),r[16]=o[0],r[17]=o[1],r[18]=o[2],r[20]=t[0],r[21]=t[1],r[22]=t[2],r[24]=i,r[25]=a,v(n,r)}export{E as buildHdrSkyboxRenderable};
