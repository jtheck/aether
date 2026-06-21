import{a as C}from"./chunk-NDJKA7QB.js";import{c as D,d as k}from"./chunk-6R3BZD2T.js";import{Ha as V,Me as B,V as E,X as y,a as x,d as _,e as M,g as T,k as g,l as w}from"./chunk-ZBW7LZ4P.js";var W=`// DDS Skybox Vertex Shader \u2014 standard world transform.
// positionUVW uses local position for cube direction lookup.

struct MeshUniforms {
  world: mat4x4<f32>,
};

@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) positionUVW: vec3<f32>,
  @location(1) positionW: vec3<f32>,
};

@vertex
fn main(@location(0) position: vec3<f32>) -> VertexOutput {
  var output: VertexOutput;
  output.positionUVW = position;
  let worldPos = (mesh.world * vec4<f32>(position, 1.0)).xyz;
  output.positionW = worldPos;
  output.clipPos = scene.viewProjection * vec4<f32>(worldPos, 1.0);
  return output;
}
`,I=`// DDS Cube Skybox Fragment Shader \u2014 samples DDS cube texture with BJS image processing.
// Used by scenes that load backgroundSkybox.dds (createDefaultEnvironment).
// Pipeline: exposure \u2192 Reinhard tonemap \u2192 gamma \u2192 contrast \u2192 dither.

struct MeshUniforms {
  world: mat4x4<f32>,
  primaryColor: vec3<f32>,
  exposureLinear: f32,
  contrast: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
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

  // BJS BackgroundMaterial: colorBase = reflectionColor.rgb * primaryColor.rgb
  color *= mesh.primaryColor;

  if (scene.vImageInfos.w >= 0.0) {
    // Exposure
    color *= mesh.exposureLinear;
    // Reinhard tonemap (matches BJS toneMappingType 0)
    color = 1.0 - exp2(-1.590579 * color);
    // Gamma
    color = pow(color, vec3<f32>(1.0 / 2.2));
    color = saturate(color);

    // Contrast
    let highContrast = color * color * (3.0 - 2.0 * color);
    color = mix(color, highContrast, mesh.contrast - 1.0);

    // Dithering (enableNoise=true, variance=0.5)
    color = color + vec3<f32>(dither(input.positionW.xy, 0.5));
    color = max(color, vec3<f32>(0.0));
  }

  return vec4<f32>(color, 1.0);
}
`,R=96,O="https://assets.babylonjs.com/core/environments/backgroundSkybox.dds";function F(n,e){let t=new x([e,-e,e,-e,-e,e,-e,e,e,e,e,e,e,e,-e,-e,e,-e,-e,-e,-e,e,-e,-e,e,e,-e,e,-e,-e,e,-e,e,e,e,e,-e,e,e,-e,-e,e,-e,-e,-e,-e,e,-e,-e,e,e,-e,e,-e,e,e,-e,e,e,e,e,-e,e,e,-e,-e,-e,-e,-e,-e,-e,e]),r=new M([2,1,0,3,2,0,6,5,4,7,6,4,10,9,8,11,10,8,14,13,12,15,14,12,18,17,16,19,18,16,22,21,20,23,22,20]);return{posBuffer:y(n,t,w.VERTEX),idxBuffer:y(n,r,w.INDEX),idxCount:36}}function L(n){let e=new x(16);return e[0]=1,e[5]=1,e[10]=1,e[15]=1,e[12]=n[0],e[13]=n[1],e[14]=n[2],e}async function j(n,e,t,r,s,o=!0){let i=n.surface.engine,l=L(t),d=F(i,e),{cubeView:p,sampler:U}=await G(i,s??O),m=B+(o?D:k)+I,f=C(o?"skybox-dds":"skybox-dds0",B+W,m),h=P(i,l,r,n.imageProcessing.exposure,n.imageProcessing.contrast),v=f.createBindGroup(i,h,p,U),c={order:0,isTransparent:!1,bind(u,a){return{renderable:c,pipeline:f.getPipeline(u,a),draw(b){return b.setBindGroup(1,v),b.setVertexBuffer(0,d.posBuffer),b.setIndexBuffer(d.idxBuffer,"uint16"),b.drawIndexed(d.idxCount),1}}}};return c}function P(n,e,t,r,s){let o=new x(R/4);return o.set(e,0),o[16]=t[0],o[17]=t[1],o[18]=t[2],o[19]=r,o[20]=s,E(n,o)}async function G(n,e){let t=n._device,r=await(await fetch(e)).arrayBuffer(),s=new _(r,0,32),o=s[3],i=s[4],l=Math.max(s[7],1),d=s[21]===808540228?148:128,p=new T(r,d),m=t.createTexture({size:[o,i,6],format:"rgba16float",mipLevelCount:l,usage:g.TEXTURE_BINDING|g.COPY_DST|g.RENDER_ATTACHMENT,dimension:"2d"}),f=0;for(let c=0;c<6;c++)for(let u=0;u<l;u++){let a=Math.max(o>>u,1);t.queue.writeTexture({texture:m,origin:{x:0,y:0,z:c},mipLevel:u},p.buffer,{offset:p.byteOffset+f,bytesPerRow:a*8},{width:a,height:a}),f+=a*a*8}let h=m.createView({dimension:"cube"}),v=V(n,{magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge",maxAnisotropy:4});return{cubeView:h,sampler:v}}export{j as buildDdsSkyboxRenderable};
