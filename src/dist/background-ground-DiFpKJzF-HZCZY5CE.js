import{c as T,d as I}from"./chunk-6R3BZD2T.js";import{Ja as F,Me as E,R as _,V as C,X as g,a as u,e as y,g as P,k as s,l as p,m,p as w}from"./chunk-LFLB3D3T.js";var N=`// Background Ground Vertex Shader
// Matches BJS shd_15: DIFFUSE, OPACITYFRESNEL, PREMULTIPLYALPHA (no REFLECTION)

struct MeshUniforms {
  world: mat4x4<f32>,
};

@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) vPositionW: vec3<f32>,
  @location(1) vNormalW: vec3<f32>,
  @location(2) vUV: vec2<f32>,
};

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let finalWorld = mesh.world;
  let worldPos4 = finalWorld * vec4<f32>(input.position, 1.0);
  output.vPositionW = worldPos4.xyz;
  output.clipPos = scene.viewProjection * worldPos4;
  let normalWorld = mat3x3<f32>(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz);
  output.vNormalW = normalize(normalWorld * input.normal);
  output.vUV = input.uv;
  return output;
}
`,W=`// Background Ground Fragment Shader
// Matches BJS shd_16: DIFFUSE, OPACITYFRESNEL, PREMULTIPLYALPHA (no REFLECTION)
// Verified via Spector.GPU capture of BJS scene 1

struct MeshUniforms {
  world: mat4x4<f32>,
  primaryColor: vec3<f32>,
  alpha: f32,
  backgroundCenter: vec3<f32>,
  _pad: f32,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

@group(1) @binding(1) var groundTexture: texture_2d<f32>;
@group(1) @binding(2) var groundSampler: sampler;

struct FragmentInput {
  @location(0) vPositionW: vec3<f32>,
  @location(1) vNormalW: vec3<f32>,
  @location(2) vUV: vec2<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  let normalW = normalize(input.vNormalW);

  // Sample diffuse texture (BJS backgroundGround.png: white RGB, radial alpha gradient)
  let diffuseMap = textureSample(groundTexture, groundSampler, input.vUV);

  // BJS: reflectionColor = vec4(1) (no REFLECTION define)
  let diffuseColor = diffuseMap.rgb;
  let colorBase = max(diffuseColor, vec3<f32>(0.0));
  let mainColor = mesh.primaryColor;
  let finalColor = colorBase * mainColor;

  // Alpha starts from material alpha, multiplied by texture alpha
  var finalAlpha = mesh.alpha * diffuseMap.a;

  // OPACITYFRESNEL \u2014 BJS shd_16 lines 367-370
  let viewAngleToFloor = dot(normalW, normalize(scene.vEyePosition.xyz - mesh.backgroundCenter));
  const startAngle: f32 = 0.1;
  let fadeFactor = clamp(viewAngleToFloor / startAngle, 0.0, 1.0);
  finalAlpha *= fadeFactor * fadeFactor;

  // Image processing (preserves alpha)
  var color = vec4<f32>(finalColor, finalAlpha);
  if (scene.vImageInfos.w >= 0.0) {
    color = applyImageProcessing(color);
  }

  // PREMULTIPLYALPHA \u2014 BJS shd_16 line 373
  color = vec4<f32>(color.rgb * color.a, color.a);

  // Dithering
  color = vec4<f32>(color.rgb + vec3<f32>(dither(input.vPositionW.xy, 0.5)), color.a);
  color = max(color, vec4<f32>(0.0));

  return color;
}
`,V=`
fn applyImageProcessing(result: vec4<f32>) -> vec4<f32> {
var rgb = result.rgb;
rgb *= scene.vImageInfos.x;
const tonemappingCalibration: f32 = 1.590579;
rgb = 1.0 - exp2(-tonemappingCalibration * rgb);
rgb = pow(rgb, vec3<f32>(1.0 / 2.2));
rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
let highContrast = rgb * rgb * (3.0 - 2.0 * rgb);
if (scene.vImageInfos.y < 1.0) {
rgb = mix(vec3<f32>(0.5), rgb, scene.vImageInfos.y);
} else {
rgb = mix(rgb, highContrast, scene.vImageInfos.y - 1.0);
}
rgb = max(rgb, vec3<f32>(0.0));
return vec4<f32>(rgb, result.a);
}
`,O=96;async function q(t,c,n,e,r,a,o=!0){let f=E+V+(o?T:I)+W,b=D(o,f),h=2220446049250313e-31,i=new u(16);i[0]=1,i[5]=h,i[6]=-1,i[9]=1,i[10]=h,i[12]=n[0],i[13]=n[1],i[14]=n[2],i[15]=1;let d=z(t,c),G=k(t,i,e),M=(await Y(t,r,a)).createView(),L=F(t),R=b.createBindGroup(t,G,M,L),S={order:200,isTransparent:!0,bind(A,U){return{renderable:S,pipeline:b.getPipeline(A,U),draw(l){return l.setBindGroup(1,R),l.setVertexBuffer(0,d.posBuffer),l.setVertexBuffer(1,d.normBuffer),l.setVertexBuffer(2,d.uvBuffer),l.setIndexBuffer(d.idxBuffer,"uint16"),l.drawIndexed(d.idxCount),1}}}};return S}var B=new Map,v=null,x=null;function D(t,c){function n(e){let r=e._device;return v&&x===r||(v=r.createBindGroupLayout({label:"ground-material",entries:[{binding:0,visibility:m.VERTEX|m.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:m.FRAGMENT,texture:{sampleType:"float",viewDimension:"2d"}},{binding:2,visibility:m.FRAGMENT,sampler:{type:"filtering"}}]}),x=r),v}return{getPipeline(e,r){let a=e._device;x!==a&&(B.clear(),v=null,x=a);let o=`${+t}|${w(r)}`,f=B.get(o);if(f)return f;let b=a.createShaderModule({code:E+N,label:"ground-vert"}),h=a.createShaderModule({code:c,label:"ground-frag"}),i=a.createRenderPipeline({label:"ground-pipeline",layout:a.createPipelineLayout({bindGroupLayouts:[_(e),n(e)]}),vertex:{module:b,entryPoint:"main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},{arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:"float32x3"}]},{arrayStride:8,attributes:[{shaderLocation:2,offset:0,format:"float32x2"}]}]},fragment:{module:h,entryPoint:"main",targets:[{format:r._colorFormat,blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},depthStencil:{format:r._depthStencilFormat??"depth24plus-stencil8",depthCompare:r._depthCompare??"greater-equal",depthWriteEnabled:!1},multisample:{count:r._sampleCount},primitive:{topology:"triangle-list",cullMode:"back",frontFace:"ccw"}});return B.set(o,i),i},createBindGroup(e,r,a,o){return e._device.createBindGroup({layout:n(e),entries:[{binding:0,resource:{buffer:r}},{binding:1,resource:a},{binding:2,resource:o}]})}}}function z(t,c){let n=c/2,e=new u([-n,-n,0,n,-n,0,n,n,0,-n,n,0]),r=new u([0,0,1,0,0,1,0,0,1,0,0,1]),a=new u([0,0,1,0,1,1,0,1]),o=new y([0,2,1,0,3,2]);return{posBuffer:g(t,e,p.VERTEX),normBuffer:g(t,r,p.VERTEX),uvBuffer:g(t,a,p.VERTEX),idxBuffer:g(t,o,p.INDEX),idxCount:6}}function k(t,c,n){let e=new u(O/4);return e.set(c,0),e[16]=n[0],e[17]=n[1],e[18]=n[2],e[19]=.9,e[20]=0,e[21]=0,e[22]=0,C(t,e)}async function Y(t,c,n){let e=t._device;if(!c){let o=e.createTexture({size:[1,1],format:"rgba8unorm",usage:s.TEXTURE_BINDING|s.COPY_DST});return e.queue.writeTexture({texture:o},new P([255,255,255,255]),{bytesPerRow:4},[1,1]),o}let r=n?await n:await fetch(c).then(o=>o.blob()).then(o=>createImageBitmap(o,{premultiplyAlpha:"none"})),a=e.createTexture({size:[r.width,r.height],format:"rgba8unorm",usage:s.TEXTURE_BINDING|s.COPY_DST|s.RENDER_ATTACHMENT});return e.queue.copyExternalImageToTexture({source:r},{texture:a},[r.width,r.height]),r.close(),a}export{q as buildGroundRenderable};
