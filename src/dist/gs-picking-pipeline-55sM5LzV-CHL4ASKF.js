import{Lf as _,M as B,N as k,Uf as G,Vf as w,a as b,kh as x,l as u,m as s,z as y}from"./chunk-LFLB3D3T.js";var p=null;function A(){return _(`
struct GsPickScene { pickMatrix: mat4x4<f32> };
@group(0) @binding(0) var<uniform> gsPickScene: GsPickScene;

struct U {
  world: mat4x4<f32>,
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
  viewport: vec2<f32>,
  focal: vec2<f32>,
  dataSize: vec2<f32>,
  alpha: f32,
  _pad: f32,
};
@group(1) @binding(0) var<uniform> u: U;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var centersTex: texture_2d<f32>;
@group(1) @binding(3) var covATex: texture_2d<f32>;
@group(1) @binding(4) var covBTex: texture_2d<f32>;
@group(1) @binding(5) var colorsTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) vColor: vec4<f32>,
  @location(1) vPos: vec2<f32>,
};

fn dataUv(idx: f32) -> vec2<f32> {
  let y = floor(idx / u.dataSize.x);
  let x = idx - y * u.dataSize.x;
  return vec2<f32>((x + 0.5) / u.dataSize.x, (y + 0.5) / u.dataSize.y);
}

@vertex
fn vs(@location(0) corner: vec2<f32>, @location(1) splatIndex: f32) -> VOut {
  var out: VOut;
  let uv = dataUv(splatIndex);
  let center = textureSampleLevel(centersTex, samp, uv, 0.0).xyz;
  let color  = textureSampleLevel(colorsTex,  samp, uv, 0.0);
  let covA   = textureSampleLevel(covATex,    samp, uv, 0.0).xyz;
  let covB   = textureSampleLevel(covBTex,    samp, uv, 0.0).xyz;

  let worldPos  = u.world * vec4<f32>(center, 1.0);
  let modelView = u.view  * u.world;
  let camspace  = u.view  * worldPos;
  let pos2d     = u.projection * camspace;

  let bounds = 1.2 * pos2d.w;
  if (pos2d.z < 0.0
      || pos2d.x < -bounds || pos2d.x > bounds
      || pos2d.y < -bounds || pos2d.y > bounds) {
    out.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.vColor = vec4<f32>(0.0);
    out.vPos = vec2<f32>(0.0);
    return out;
  }

  let Vrk = mat3x3<f32>(
    vec3<f32>(covA.x, covA.y, covA.z),
    vec3<f32>(covA.y, covB.x, covB.y),
    vec3<f32>(covA.z, covB.y, covB.z));

  let invZ  = 1.0 / camspace.z;
  let invZ2 = invZ * invZ;
  let J = mat3x3<f32>(
    vec3<f32>(u.focal.x * invZ, 0.0, -u.focal.x * camspace.x * invZ2),
    vec3<f32>(0.0, u.focal.y * invZ, -u.focal.y * camspace.y * invZ2),
    vec3<f32>(0.0, 0.0, 0.0));

  let mv3 = mat3x3<f32>(modelView[0].xyz, modelView[1].xyz, modelView[2].xyz);
  let T = transpose(mv3) * J;
  var cov2d = transpose(T) * Vrk * T;

  let kernelSize: f32 = 0.3;
  cov2d[0][0] += kernelSize;
  cov2d[1][1] += kernelSize;

  let mid = (cov2d[0][0] + cov2d[1][1]) * 0.5;
  let dxy = (cov2d[0][0] - cov2d[1][1]) * 0.5;
  let radius = length(vec2<f32>(dxy, cov2d[0][1]));
  let epsilon: f32 = 0.0001;
  let lambda1 = mid + radius + epsilon;
  let lambda2 = mid - radius + epsilon;
  if (lambda2 < 0.0) {
    out.pos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.vColor = vec4<f32>(0.0);
    out.vPos = vec2<f32>(0.0);
    return out;
  }

  let diag = normalize(vec2<f32>(cov2d[0][1], lambda1 - cov2d[0][0]));
  let majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diag;
  let minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2<f32>(diag.y, -diag.x);

  let vCenter = pos2d.xy;
  out.pos = gsPickScene.pickMatrix * vec4<f32>(
    vCenter + (corner.x * majorAxis + corner.y * minorAxis) * pos2d.w / u.viewport,
    pos2d.z, pos2d.w);
  out.vColor = vec4<f32>(color.rgb, color.a * u.alpha);
  out.vPos = corner;
  return out;
}

/*GS_FRAGMENT_DEFINITIONS*/
struct FsOut { @location(0) color: vec4<f32>, @location(1) depth: vec4<f32> };
@fragment
fn fs(in: VOut) -> FsOut {
  /*GS_FRAGMENT_MAIN_BEGIN*/
  let A = -dot(in.vPos, in.vPos);
  var finalColor: vec4<f32>;
  if (A > -4.0) {
    let B = exp(A) * in.vColor.a;
    finalColor = vec4<f32>(in.vColor.rgb, B);
  } else {
    finalColor = vec4<f32>(0.0);
  }
  /*GS_FRAGMENT_BEFORE_FRAGCOLOR*/
  /*GS_FRAGMENT_MAIN_END*/
  return FsOut(finalColor, vec4<f32>(in.pos.z, 0.0, 0.0, 0.0));
}
`,[G])}function m(e){let i=e._device;if(p&&p.device===i)return p;let r=i.createBindGroupLayout({label:"gs-picking-mesh-bgl",entries:[{binding:0,visibility:s.VERTEX|s.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:s.VERTEX,sampler:{type:"non-filtering"}},{binding:2,visibility:s.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:s.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:s.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:s.VERTEX,texture:{sampleType:"unfilterable-float"}}]}),o=i.createBindGroupLayout({label:"gs-picking-pick-bgl",entries:[{binding:0,visibility:s.FRAGMENT,buffer:{type:"uniform"}}]}),t=i.createShaderModule({label:"gs-picking-shader",code:A()}),a=i.createRenderPipeline({label:"gs-picking-pipeline",layout:i.createPipelineLayout({bindGroupLayouts:[x(e),r,o]}),vertex:{module:t,entryPoint:"vs",buffers:[{arrayStride:8,stepMode:"vertex",attributes:[{shaderLocation:0,offset:0,format:"float32x2"}]},{arrayStride:4,stepMode:"instance",attributes:[{shaderLocation:1,offset:0,format:"float32"}]}]},fragment:{module:t,entryPoint:"fs",targets:[{format:"rgba8unorm"},{format:"r32float"}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthCompare:"less",depthWriteEnabled:!0},multisample:{count:1}}),n=i.createBuffer({size:64,usage:u.UNIFORM|u.COPY_DST,label:"gs-picking-scene-ubo"}),d=i.createBindGroup({label:"gs-picking-scene-bg",layout:x(e),entries:[{binding:0,resource:{buffer:n}}]});return p={device:i,pipeline:a,meshBGL:r,pickingBGL:o,pickMatrixUbo:n,sceneBG:d},p}function M(e,i,r){let o=m(i);i._device.queue.writeBuffer(o.pickMatrixUbo,0,r.buffer,r.byteOffset,r.byteLength),e.setBindGroup(0,o.sceneBG)}function V(e,i){let r=e._device,o=m(e),t=224,a=r.createBuffer({size:t,usage:u.UNIFORM|u.COPY_DST,label:"gs-picking-mesh-ubo"}),n=new b(t/4);n[52]=i.textureWidth,n[53]=i.textureHeight,n[54]=1;let d=r.createBindGroup({label:"gs-picking-mesh-bg",layout:o.meshBGL,entries:[{binding:0,resource:{buffer:a}},{binding:1,resource:i._gs._sampler},{binding:2,resource:i._gs._centersView},{binding:3,resource:i._gs._covAView},{binding:4,resource:i._gs._covBView},{binding:5,resource:i._gs._colorsView}]}),v=r.createBuffer({size:16,usage:u.UNIFORM|u.COPY_DST,label:"gs-picking-color-ubo"}),f=new b(4),l=r.createBindGroup({label:"gs-picking-color-bg",layout:o.pickingBGL,entries:[{binding:0,resource:{buffer:v}}]});return{meshUbo:a,meshBG:d,pickingUbo:v,pickingBG:l,meshCpu:n,pickingCpu:f}}function R(e){e.meshUbo.destroy(),e.pickingUbo.destroy()}function F(e,i,r,o,t,a,n,d){let v=m(i),f=r.camera;if(!f)return;let l=y(i),S=(n||l.width)/(d||l.height),T=B(f),g=k(f,S),h=o.worldMatrix,c=t.meshCpu;c.set(h,0),c.set(T,16),c.set(g,32),c[48]=l.width,c[49]=l.height,c[50]=l.width*.5*g[0],c[51]=l.height*.5*g[5],i._device.queue.writeBuffer(t.meshUbo,0,c.buffer,0,c.byteLength);let[P,C,z]=w(a);t.pickingCpu[0]=P,t.pickingCpu[1]=C,t.pickingCpu[2]=z,t.pickingCpu[3]=0,i._device.queue.writeBuffer(t.pickingUbo,0,t.pickingCpu.buffer,0,16),e.setPipeline(v.pipeline),e.setBindGroup(1,t.meshBG),e.setBindGroup(2,t.pickingBG),e.setVertexBuffer(0,o._gs._quadBuffer),e.setVertexBuffer(1,o._gs._splatIndexBuffer),e.setIndexBuffer(o._gs._indexBuffer,"uint16"),e.drawIndexed(6,o.vertexCount)}function O(e,i,r,o,t){let a=2*(i+.5)/o-1,n=1-2*(r+.5)/t;e[0]=o,e[1]=0,e[2]=0,e[3]=0,e[4]=0,e[5]=t,e[6]=0,e[7]=0,e[8]=0,e[9]=0,e[10]=1,e[11]=0,e[12]=-a*o,e[13]=-n*t,e[14]=0,e[15]=1}export{O as computeGsPickMatrix,V as createGsPickMeshResources,R as disposeGsPickMeshResources,F as drawGsForPicking,M as gsPickWritePickMatrixAndBind};
