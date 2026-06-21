import{b as g}from"./chunk-6R3BZD2T.js";import{Me as f,R as x,T as h,V as y,m as s,p as S}from"./chunk-ZBW7LZ4P.js";var B=`// Skybox CubeMap Vertex Shader
// Passes object-space position (for cube texture lookup) and world-space position.

struct MeshUniforms {
  world: mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> mesh: MeshUniforms;

struct VertexOutput {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) vPositionW: vec3<f32>,
  @location(1) vPositionLocal: vec3<f32>,
  @location(2) vFogDistance: vec3<f32>,
};

@vertex
fn main(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
) -> VertexOutput {
  var out: VertexOutput;
  let worldPos = mesh.world * vec4<f32>(position, 1.0);
  out.vPositionW = worldPos.xyz;
  out.vPositionLocal = position;
  out.clipPos = scene.viewProjection * worldPos;
  out.vFogDistance = (scene.view * worldPos).xyz;
  return out;
}
`,P=`// Skybox CubeMap Fragment Shader
// Samples cube texture using object-space position as lookup direction.
// Matches Babylon StandardMaterial with REFLECTION + REFLECTIONMAP_SKYBOX.

@group(1) @binding(1) var cubeTexture: texture_cube<f32>;
@group(1) @binding(2) var cubeSampler: sampler;

struct FragmentInput {
  @location(0) vPositionW: vec3<f32>,
  @location(1) vPositionLocal: vec3<f32>,
  @location(2) vFogDistance: vec3<f32>,
};

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  // SKYBOX_MODE: use object-space position as cube lookup direction
  let lookupDir = normalize(input.vPositionLocal);
  var color = textureSample(cubeTexture, cubeSampler, lookupDir);

  // Apply fog
  if (scene.vFogInfos.x > 0.0) {
    let fog = calcFogFactor(input.vFogDistance);
    color = vec4<f32>(mix(scene.vFogColor.rgb, color.rgb, fog), color.a);
  }

  return color;
}
`;function F(i,e,l,a){let o=i._device,c=o.createBindGroupLayout({label:"skybox-cm-mesh",entries:[{binding:0,visibility:s.VERTEX,buffer:{type:"uniform"}},{binding:1,visibility:s.FRAGMENT,texture:{sampleType:"float",viewDimension:"cube"}},{binding:2,visibility:s.FRAGMENT,sampler:{}}]}),u=y(i,e),p=o.createBindGroup({layout:c,entries:[{binding:0,resource:{buffer:u}},{binding:1,resource:l},{binding:2,resource:a}]}),n=o.createShaderModule({code:f+B,label:"skybox-cm-vert"}),M=o.createShaderModule({code:f+g+P,label:"skybox-cm-frag"}),t={getPipeline(d,r){let m=S(r),b=t.pipelines.get(m);if(b)return b;let v=d._device.createRenderPipeline(h({_label:"skybox-cubemap-pipeline",_engine:d,_bgls:[x(d),t.meshBindGroupLayout],_vertModule:t.vertModule,_fragModule:t.fragModule,_vertexBuffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},{arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:"float32x3"}]}],_format:r._colorFormat,_depthStencilFormat:r._depthStencilFormat,_depthCompare:r._depthCompare,_msaaSamples:r._sampleCount,_cullMode:"none"}));return t.pipelines.set(m,v),v},meshBindGroup:p,meshUBO:u,meshBindGroupLayout:c,vertModule:n,fragModule:M,pipelines:new Map};return t}function G(i,e){let l=i.surface.engine,a=F(l,e.worldMatrix,e.cubeView,e.cubeSampler),o={order:0,isTransparent:!1,bind(c,u){let p=a.getPipeline(c,u);return{renderable:o,pipeline:p,draw(n){return n.setBindGroup(1,a.meshBindGroup),n.setVertexBuffer(0,e.posBuffer),n.setVertexBuffer(1,e.normBuffer),n.setIndexBuffer(e.idxBuffer,"uint32"),n.drawIndexed(e.idxCount),1}}}};return o}export{G as buildSkyboxRenderable};
